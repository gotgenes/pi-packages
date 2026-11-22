---
issue: 307
issue_title: "Project a running effective working directory across cd's onto bash path candidates"
---

# Project a running effective working directory onto bash path candidates

## Problem Statement

The bash external-directory guard resolves every relative path candidate in a command against a single base.
`BashProgram.parse()` records one `leadingCdTarget` — the argument of the very first command, and only when that first command is `cd` — and `externalPaths(cwd)` resolves all candidates against `cwd` joined with that one target.

This single-base model is wrong in both directions.
It over-prompts on benign multi-`cd` paths, and — worse — it can miss a real escape.
For `cd nested/deep && cd .. && cat ../../etc/passwd` the real effective directory is `cwd/nested`, so `../../etc/passwd` escapes to `cwd/../etc/passwd` and should be flagged; today we resolve against `cwd/nested/deep` (the first `cd` only), which collapses back inside `cwd` and sails through.

The fix is to project the effective working directory at each point in the command stream onto that point's path candidates.
The effective directory is stateful: it starts at `cwd`, each current-shell `cd <literal>` mutates it for subsequent commands, and subshell / brace-group / pipeline / background contexts scope changes that must not leak.
A relative candidate must resolve against the directory in force *where it appears*, not against one base for the whole string.

## Goals

- Retire the single `leadingCdTarget: string | undefined` in favor of a per-candidate effective base.
- Tier 1 — fold a sequence of top-level current-shell `cd <literal>` commands (joined by `&&`, `||`, `;`, or a newline) into a running effective directory, and resolve each candidate against the directory in force where it appears.
- Tier 2 — model subshell `( … )` and command/process-substitution scoping with a directory-frame stack (a `cd` inside resets on exit), persist a `cd` inside a `{ … }` brace group (brace groups run in the current shell), and ensure `cd`s inside pipelines (`a | b`) and backgrounded commands (`a &`) never update the running directory.
- Conservative bail — when a `cd` target is not a static literal (`cd "$DIR"`, `cd $(…)`, `cd -`), the effective directory becomes unknown; subsequent **relative** candidates are treated as potentially external and flagged (least-privilege).
- Preserve `pathTokens()` exactly — it is cwd-independent and must not change.
- This change makes external-directory decisions more precise; it is a behavior change (more escapes caught, occasional new prompts), surfaced via `feat:` commits.

## Non-Goals

- Variable- or substitution-valued `cd` targets, `pushd` / `popd`, `cd -` / `$OLDPWD`, `CDPATH` — these only mark the effective directory unknown (the conservative bail), they are not resolved.
- Modeling `&&` / `||` success or failure — assume each `cd` may take effect.
- Symlink resolution, physical vs. logical paths (`cd -P`).
- `eval`, sourced scripts, functions, aliases.
- Folding `cd` state inside control-flow bodies (`if` / `while` / `for` / `case`) and function definitions — their candidates are collected against the base in force at entry, but their internal `cd`s do not fold (deferred, conservative).
- Changing the command-pattern slice (`commands()` / `resolveBashCommandCheck`) or the `BashCommand` model — this issue touches only the path-candidate slice.
- Changing `pathTokens()` output or the two extractor facades' signatures.

## Background

Relevant modules (all changes are private to `bash-program.ts` plus its tests):

- `src/handlers/gates/bash-program.ts` — `BashProgram.parse(command)` walks the AST once, today producing `rawTokens: string[]`, `leadingCdTarget: string | undefined`, and `commandUnits: BashCommand[]`.
  `externalPaths(cwd)` resolves every `rawTokens` candidate against `computeEffectiveResolveBase(leadingCdTarget, cwd)`; `pathTokens()` rule-classifies the same `rawTokens` (cwd-independent).
  `extractLeadingCdTarget` (via `findFirstCommand`, which descends only `program` / `list` and takes the first command) and `computeEffectiveResolveBase` are the two private helpers this issue retires.
- `src/handlers/gates/bash-token-classification.ts` — `classifyTokenAsPathCandidate` (strict: accepts a token only if it starts with `/`, starts with `~/`, or contains `..`) and `classifyTokenAsRuleCandidate` (broader).
  This is the load-bearing fact: the strict external-directory classifier never accepts a bare relative filename (`x`, `src/foo.ts`), so the effective base only ever changes the resolution of `..`-containing relative candidates.
- `src/handlers/gates/bash-path-extractor.ts` — `extractExternalPathsFromBashCommand(command, cwd)` / `extractTokensForPathRules(command)` facades over `BashProgram`; signatures unchanged.
- `src/handlers/gates/bash-external-directory.ts` / `bash-path.ts` — the two gates; they call `bashProgram.externalPaths(cwd)` / `.pathTokens()`.
  Neither gate signature changes.
- `src/path-utils.ts` — `normalizePathForComparison(candidate, base)` = `resolve(base, candidate)` + normalize; `isPathWithinDirectory`, `isSafeSystemPath` unchanged.

Constraints from `AGENTS.md` / the package skill that apply:

- Default to least privilege; silent over-matching is a permission bypass — the conservative-bail decision (flag unknown-base relatives) follows this.
- Do not read `process.cwd()` inside the walk — `cwd` is already a parameter of `externalPaths(cwd)`, and the parse-time walk computes only a relative offset, never resolving against `cwd`.
- New / changed `BashProgram` methods keep the `// fallow-ignore-next-line unused-class-member` suppression (private-ctor false positive).
- Run `pnpm run check` immediately after each interface-changing step; run the full suite after any step that touches the shared walk.

AST facts (verified during planning with disposable `web-tree-sitter` probes):

| Input                          | Tree (relevant shape)                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `cd a && cd b && cat x`        | `program > list > [list > [command, &&, command], &&, command]` (left-associative)              |
| `mkdir d && cd d && cat x`     | same `list` nesting; `cd` is the second command                                                 |
| `cd a & cat x`                 | `program > [command, ·&, command]` — `&` is an anonymous token *after* the backgrounded command |
| `cat a \| cd b`                | `program > pipeline > [command, \|, command]`                                                   |
| `( cd sub && cat y ) && cat z` | `program > list > [subshell > list, &&, command]`                                               |
| `cd a && { cd b; cat c; }`     | `program > list > [command, &&, compound_statement > [command, command]]`                       |
| `echo $(cd q && cat r)`        | `command > command_name > [echo, command_substitution > list]`                                  |
| `cat $(cd s; pwd) y`           | `command > [command_name, command_substitution, word "y"]` — `y` is an outer-scope sibling      |

`&` (background) is distinguished from `&&` / `||` / `;` by the anonymous operator token type that follows a command — the cd-fold honors `&&` / `||` / `;` / newline and skips `&`.

## Design Overview

### What actually changes

Because the strict classifier only admits absolute, `~/`, and `..`-relative tokens, and absolute / `~/` tokens are independent of the working directory, the effective base affects exactly one class of candidate: **`..`-containing relative paths**.
The entire feature is "resolve `..`-relative external-directory candidates against the effective directory in force where they appear, and flag them conservatively when that directory is unknown."
`pathTokens()` never resolves against a base, so it is provably unaffected.

### Per-candidate effective base

`rawTokens: readonly string[]` and `leadingCdTarget: string | undefined` are replaced by a single list of candidates carrying their projected base:

```typescript
// src/handlers/gates/bash-program.ts

/**
 * The working directory in force where a path candidate appears, expressed as
 * an offset to be joined with `cwd` at resolution time (the walk never sees
 * `cwd`). `known` carries a relative-or-absolute offset string built by folding
 * `cd` literals ("" = cwd); `unknown` marks a non-literal `cd` that made the
 * effective directory unresolvable.
 */
type EffectiveBase =
  | { readonly kind: "known"; readonly offset: string }
  | { readonly kind: "unknown" };

interface PathCandidate {
  readonly token: string;
  readonly base: EffectiveBase;
}
```

The constructor stores `rawCandidates: readonly PathCandidate[]` in place of `rawTokens` + `leadingCdTarget`; `commandUnits` is unchanged.

### Slices derive from the one list

```typescript
pathTokens(): string[] {
  // Identical to today: rule-classify + dedup over the candidate tokens,
  // ignoring base. Source order and token set are unchanged.
}

externalPaths(cwd: string): string[] {
  const normalizedCwd = normalizePathForComparison(cwd, cwd);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { token, base } of this.rawCandidates) {
    const candidate = classifyTokenAsPathCandidate(token);
    if (!candidate) continue;

    // Unknown base + relative candidate → conservative: always external.
    if (base.kind === "unknown" && isRelativeCandidate(candidate)) {
      pushExternalForDisplay(candidate, cwd, seen, out); // resolve vs cwd for display, never suppress
      continue;
    }

    const resolveBase = base.kind === "known" ? resolve(cwd, base.offset) : cwd;
    const normalized = normalizePathForComparison(candidate, resolveBase);
    if (!normalized) continue;
    if (
      normalizedCwd !== "" &&
      !isSafeSystemPath(normalized) &&
      !isPathWithinDirectory(normalized, normalizedCwd) &&
      !seen.has(normalized)
    ) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}
```

`isRelativeCandidate(c)` = `!c.startsWith("/") && !c.startsWith("~")` (absolute and `~/` are base-independent and resolve normally even under an unknown base).
`resolve(cwd, base.offset)` handles both a relative offset (`"nested"` → `cwd/nested`) and an absolute offset (`"/abs"` → `/abs`, ignoring `cwd`).
The old `computeEffectiveResolveBase` escape-to-`cwd` fallback is dropped: a `cd` that escapes `cwd` is now tracked faithfully, so candidates after it resolve against the (external) effective directory and are flagged — which is the desired least-privilege behavior and the whole point of the missed-escape fix.

### The base-threading walk

`collectPathCandidateTokens(node): string[]` is replaced by `collectPathCandidates(rootNode): PathCandidate[]`, a single recursive walk that threads an `EffectiveBase` and emits each candidate tagged with the base in force.
The leaf token collectors (`collectCommandTokens`, `collectGenericCommandTokens`, `collectPatternCommandTokens`, `collectRedirectTokens`) keep their existing token-selection logic so the candidate **set and order are unchanged** — they are wrapped to (a) tag direct-argument tokens with the current base and (b) hand nested substitution / subshell subtrees back to the scoped walk rather than flat-collecting them.

Threading rules by node type:

- `program` / `list` / `compound_statement` (current-shell sequences) — fold left: the offset flows through children in source order; a child's returned offset becomes the next child's input.
  A brace group `{ … }` therefore persists its internal `cd`s to following siblings (it runs in the current shell).
- `command` — emit the command's direct path candidates tagged with the current base; recurse into nested command/process substitutions with a *scoped copy* of the base (interior `cd`s do not leak out, but interior tokens inherit and may fold within the substitution).
  If the command is `cd <literal>` at a current-shell position, return the folded offset (`join(offset, literal)`, or the literal if absolute); if it is `cd` with a non-literal target, return `{ kind: "unknown" }`; otherwise return the input base unchanged.
  A command's own `cd`-argument candidate is emitted with the *pre-update* base (the directory the `cd` runs from).
- `redirected_statement` — emit the redirect-target candidates with the current base; fold the inner command and return its offset.
- `pipeline` — every member runs in a subshell: walk each member with a scoped copy of the base (collecting its candidates) and discard the returned offset; return the input base unchanged.
- backgrounded command (a statement followed by the anonymous `&` token) — walk it scoped and discard its offset; return the input base unchanged.
- `subshell` `( … )` — push a frame: walk the interior starting from the current base, discard the returned offset (pop); return the input base unchanged.
- command/process substitution `$(…)` / `` `…` `` / `<(…)` / `>(…)` — scoped like a subshell; interior tokens inherit the enclosing base and may fold within, but the offset does not leak to the enclosing command.
- control-flow bodies and function definitions — collect interior candidates against the entry base, do not fold their internal `cd`s (conservative, deferred).

`isNamed` / `SKIP_SUBTREE_TYPES` guards are preserved exactly so heredoc bodies, comments, and operator tokens are skipped as today.

### Worked examples

- `cd nested/deep && cd .. && cat ../../etc/passwd` (cwd = `/p`): seg1 offset `nested/deep` (`nested/deep` is not a `..`/abs candidate, not flagged); seg2 candidate `..` resolves vs `/p/nested/deep` → `/p/nested` (inside, not flagged), offset folds to `nested`; seg3 candidate `../../etc/passwd` resolves vs `/p/nested` → `/p/../etc/passwd` → **outside `/p` → flagged**.
  The escape is now caught.
- `mkdir d && cd d && cat ../x`: `cd d` is the second command but current-shell, so it folds; `../x` resolves vs `cwd/d` → `cwd/x` inside → not flagged.
- `( cd sub && cat ../x ) && cat ../y`: inside the subshell `../x` resolves vs `cwd/sub` → `cwd/x` inside (not flagged); the subshell `cd` is popped, so `../y` resolves vs `cwd` → `cwd/../y` → flagged.
- `cd a & cat ../x`: `cd a` is backgrounded → does not fold; `../x` resolves vs `cwd` → flagged.
- `cd "$DIR" && cat ../x`: non-literal `cd` → base unknown; `../x` is relative → **flagged conservatively**; a sibling `cat /etc/hosts` (absolute) still resolves normally and is flagged on its own merits.

### Design-review notes

- Dependency width: `rawCandidates` replaces two fields (`rawTokens` + `leadingCdTarget`) with one; `externalPaths` / `pathTokens` each consume it fully.
  No gate signature changes, so no dependency-bag widening crosses a module boundary.
- Law of Demeter: gates still call `bashProgram.externalPaths(cwd)` / `.pathTokens()` — methods on the injected collaborator.
- The `BashCommand` model is deliberately **not** extended with path candidates, despite the forward note in the [#308] plan.
  The cwd-frame grouping needed here descends into brace groups and substitution interiors and folds `cd` state, whereas `commands()` emits brace groups whole and emits nested commands as separate rule units — different descent semantics.
  Conflating them would force a discriminator and leak one slice's descent policy into the other; keeping the path-candidate walk as its own derivation of the shared single parse honors the [#308] anti-drift goal (one parse, two faithful slices) without the wrong abstraction.

## Module-Level Changes

1. `src/handlers/gates/bash-program.ts`:
   - Add the `EffectiveBase` type and `PathCandidate` interface (module-private).
   - Constructor: replace `rawTokens` + `leadingCdTarget` parameters with `rawCandidates: readonly PathCandidate[]`.
   - `parse()`: call the new `collectPathCandidates(rootNode)`; remove the `extractLeadingCdTarget(...)` call.
   - `pathTokens()`: iterate `rawCandidates`, rule-classify `token`, dedup (behavior identical).
   - `externalPaths(cwd)`: resolve per-candidate base as above; add `isRelativeCandidate` + the unknown-base conservative branch; remove the `computeEffectiveResolveBase` call.
   - Replace `collectPathCandidateTokens` with the base-threading `collectPathCandidates` walk and its scope-aware helpers; wrap the existing leaf collectors to tag tokens and delegate nested subtrees.
   - Remove `findFirstCommand`, `extractLeadingCdTarget`, and `computeEffectiveResolveBase` (sole callers removed in this file).
   - Keep the `// fallow-ignore-next-line unused-class-member` suppressions on `pathTokens` / `externalPaths`.
2. `test/handlers/gates/bash-program.test.ts` — extend the `externalPaths` describe with the new cases (multi-`cd` fold, `cd`-not-first, missed-escape, subshell scoping + non-leak, brace-group persistence, pipeline / background non-leak, unknown-base conservative + absolute-still-normal).
3. `test/bash-external-directory.test.ts` — in the `leading cd prefix` describe, re-frame the two tests whose comments encode the retired single-`cd`/fallback model and strengthen their assertions to the new resolved paths:
   - `"cd is not first command: cd is ignored"` → the second `cd` now folds; rename to reflect sequential-fold semantics and assert the resolved escape path.
   - `"cd to external dir: paths after cd are still checked against cwd"` → faithful tracking now resolves against `/tmp`; update the comment and assert the new resolved path (`/etc/hosts`) plus the `/tmp` candidate.
   The single-leading-`cd` regression tests stay green unchanged (a single leading `cd` is the one-element case of the fold).
4. `docs/architecture/architecture.md` — update the `bash-program.ts` listing line: `externalPaths(cwd)` projects a running effective working directory across a sequence of current-shell `cd`s with subshell / brace-group / pipeline / background scoping and a conservative unknown-base bail (retiring the single `leadingCdTarget`); note that `pathTokens()` is unchanged.

No `README.md`, `docs/configuration.md`, schema, or example-config changes — no config surface changes.
`docs/architecture/v3-architecture.md` is historical narrative, left unchanged.

## Test Impact Analysis

1. New unit coverage enabled — the per-candidate base makes each Tier directly testable at the `BashProgram.externalPaths` boundary: sequential fold, `cd`-not-first fold, the missed-escape regression, each Tier-2 scope (subshell frame, brace-group persistence, pipeline / background non-leak), and the unknown-base conservative branch (relative flagged, absolute normal).
   These were previously impossible because the single `leadingCdTarget` collapsed all of them to one base.
2. Tests that become redundant — none are deleted.
   Two `leading cd prefix` tests are re-framed (their loose `length > 0` assertions stay green by coincidence, but their comments/titles asserted the retired model); strengthening them to exact resolved paths turns a coincidental pass into documentation of the new behavior.
3. Tests that must stay as-is — the single-leading-`cd` regression and within-cwd cases in `bash-external-directory.test.ts`, the entire `extractTokensForPathRules` / `pathTokens` block (cwd-independent, must not move), and the `commands()` / gate / tool-call suites (this issue does not touch the command-pattern slice).
   The 1027-line characterization suite is the primary guard that `pathTokens` and the unchanged-base candidate set did not drift.

## TDD Order

1. `feat: fold sequential current-shell cd into the bash effective directory` — introduce `EffectiveBase` / `PathCandidate`, replace `rawTokens` + `leadingCdTarget` with `rawCandidates`, build the base-threading `collectPathCandidates` walk handling current-shell `cd` folding over `&&` / `||` / `;` / newline while **excluding** backgrounded (`&`) and pipeline-member `cd`s, and resolve per-base in `externalPaths`; subshell / brace-group / substitution interiors inherit the outer base without folding their internal `cd`s (correct Tier-1 conservative behavior).
   Retire `findFirstCommand` / `extractLeadingCdTarget` / `computeEffectiveResolveBase`.
   Add the multi-`cd`, `cd`-not-first, missed-escape, and pipeline / background non-leak tests; re-frame the two `bash-external-directory.test.ts` tests.
   This is one atomic step: the `rawTokens` → `rawCandidates` representation change breaks both `pathTokens` and `externalPaths` internally at once.
   Run `pnpm run check`, then the full suite.
2. `feat: scope cd inside subshells and persist it across brace groups` — extend the walk so subshell `( … )` and command/process-substitution interiors fold their internal `cd`s within a popped frame, and brace groups `{ … }` persist their `cd`s to following current-shell siblings.
   Add the subshell-internal fold, subshell non-leak, brace-group persistence, and substitution-internal scoping tests.
   Run `pnpm run check`, then the full suite.
3. `feat: flag relative paths conservatively after a non-literal cd` — mark a non-literal `cd` target (`cd "$DIR"`, `cd $(…)`, `cd -`) as `{ kind: "unknown" }`, propagate it through subsequent current-shell commands, and in `externalPaths` flag relative candidates under an unknown base unconditionally while resolving absolute / `~/` candidates normally.
   Add the unknown-base conservative tests (relative flagged, absolute still normal, `cd -` unknown).
   Run `pnpm run check`, then the full suite.
4. `docs: document effective-cwd projection in the bash gate architecture` — update the `bash-program.ts` architecture listing line.

After step 3, a bash command's external-directory candidates each resolve against the effective directory in force where they appear, with a conservative bail on unknowable directories.

## Risks and Mitigations

1. The base-threading walk drifts the candidate set, changing `pathTokens` or an unchanged-base `externalPaths` result — Mitigation: the leaf collectors keep their exact token-selection logic; the 1027-line characterization suite plus the `pathTokens` unit cases assert the set and order are unchanged.
   Run the full suite after steps 1–3.
2. Left-associative `list` nesting is mis-ordered, folding `cd`s out of source order — Mitigation: the walk recurses `list` children in order and threads the offset through nested `list` nodes; the AST nesting was probed during planning and the multi-`cd` test asserts source-order fold.
3. Background `&` is mis-detected as a current-shell separator, leaking a backgrounded `cd` — Mitigation: the fold inspects the anonymous operator token following each command and folds only on `&&` / `||` / `;` / newline; a dedicated `cd a & cat ../x` non-leak test guards it.
4. The dropped escape-to-`cwd` fallback changes a previously-green assertion — Mitigation: the only affected tests are the two re-framed `leading cd prefix` cases; both are updated in step 1 with strengthened assertions, and the change is the intended faithful-tracking fix.
5. Conservative unknown-base over-prompts on common benign relatives — Mitigation: the strict classifier already excludes bare relative filenames, so only `..`-containing relatives under an unknown `cd` are flagged — a narrow, genuinely-ambiguous set; the decision was confirmed with the owner (least-privilege).
6. fallow flags `pathTokens` / `externalPaths` as unused class members (private-ctor false positive) — Mitigation: carry the existing `// fallow-ignore-next-line unused-class-member` suppressions; run `pnpm fallow dead-code` from the repo root before committing.

## Open Questions

- Whether the substitution-internal `cd` fold (Tier 2) is worth its small added walk complexity given how rare `echo $(cd q && cat ../r)` is in practice.
  Planned in because it falls out of the same recursive frame mechanism that subshells need; if it proves to add disproportionate branching during implementation, it can be reduced to "substitution interiors inherit the outer base without internal folding" (still conservative) without affecting Tiers 1 or the unknown-base bail.

[#308]: https://github.com/gotgenes/pi-packages/issues/308
