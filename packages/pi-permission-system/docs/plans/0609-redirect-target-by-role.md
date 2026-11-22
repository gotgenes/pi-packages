---
issue: 609
issue_title: "Allow Bash commands without automatically allowing output redirects"
---

# A redirect's target is projected by its role, not its shape

## Release Recommendation

**Release:** ship independently

The Phase 15 roadmap step for #609 is tagged `Release: independent` and belongs to no batch.
It is a `fix!:` and cuts a major on its own.

## Problem Statement

A bash command should not quietly get to create files through `>` just because nothing checks where the file goes.
Issue #609 asked for output redirects to be governed apart from the command.
The direction half of that request shipped with the read/write axis ([#806]) and per-token effect attribution ([#807]): a redirect target is already tagged `write (syntax)` and routed to `path_write` / `external_directory_write`.

Measurement then found a defect underneath, which ADR 0013 records and ADR 0009 contradicts.
A redirect target reaches the path surfaces only when its shape qualifies or the file already exists.
`cat /etc/hosts > out.txt` projects `/etc/hosts` and drops `out.txt`, because the projection runs its shape classifiers and existence probe on the target as if it were an operand of unknown role.
A creating redirect to a bare name is the common case, and it gets past every surface.

The cause is the phase's: the collector knows the token is a redirect target (that is how it attributes the `syntax` write), but `PathToken` carries only the effect, so `BashPathResolver` checks path-hood a second time and gets it wrong.

## Goals

- A redirect's target that the syntax proves names a file reaches both path surfaces whether or not it exists yet, resolved against the effective working directory like any operand.
- This applies to every syntax-proven target, input and output alike (operator decision); the direction still comes from the effect, so `>` lands on `_write` and `<` on `_read`.
- `PathToken` carries a `TokenRole`, stamped where the token is produced; the projection reads the role instead of checking path-hood again.
- ADR 0009's guarantee wording (which says redirect targets are unaffected by the nonexistent-target residual) becomes true.
- **Breaking change:** a bare creating redirect newly reaches `path_write` (and, after a non-literal `cd`, `external_directory_write`).
  A user with an explicit `path`/`path_write` rule can see a new prompt or a new denial; a config with no explicit `path` rule sees none in the working directory.
  Ships as `fix(pi-permission-system)!:` with a `BREAKING CHANGE:` footer.

## Non-Goals

- **Words after a redirect.**
  `tree-sitter-bash` 0.25.1 parses `cmd 2>/dev/null arg` with `arg` as a second `destination` of the redirect.
  This plan admits only the redirect's **first** destination by role; the trailing words keep today's collection exactly (the operator's effect, the shape gate, the probe).
  Their correct attribution, the command-enumeration deny bypass (`git 2>/dev/null push --force` runs under a `git push *` deny), the `find -delete` retraction it hides, and `redirectMayWriteFile`'s reading of them are [#977], dispositioned as the Phase 15 step directly after this one.
- **A computed target** (`> "$OUT"`, `> out-$(date).txt`).
  ADR 0009's computed-paths residual already declines to resolve a value decided at run time; projecting the literal would name `cwd/$OUT`, a file that is not the one written.
  Such a target keeps today's shape gate and probe.
  The nested command inside a substitution target keeps being projected by the existing hosted-execution pass ([#741]).
- **An unresolved redirect** ([#814], e.g. `cat <> rw.txt`): it proves nothing and keeps today's collection, so the role does not apply to it.
- **The two preparatory tidyings the roadmap assigned to this step.**
  The `COMMAND_PREFIX_TYPES` re-spellings sit in functions this change does not edit and moved to [#977]; `bash-path-extractor.ts` has no production caller, so this change adds no case to its test and the question moved to [#978] (operator decision at planning, recorded in the roadmap).
- **`> /dev/null` on the path surface.**
  It is already a `path_write` candidate today (absolute, so the shape gate admits it) and this change does not alter it; [#951] owns the device fact.
- **The gates.**
  `bash-path.ts`, `bash-external-directory.ts`, and `external-directory-policy.ts` are predicted unchanged (see Module-Level Changes).
- **Blame on the ask** ([#881]) and command-effect declarations ([#880]).

## Background

- `src/access-intent/bash/token-collection.ts` — every collector returns `PathToken[]` (`{ token, effect }`), tagged where the token is produced.
  `collectRedirectTokens` reads each `ARG_NODE_TYPES` child of a `file_redirect`, asks `redirectEffectForDestination` for its effect, and also searches each child for hosted executions.
  There are exactly 8 `{ token: … }` construction sites (lines 121, 207, 326, 337, 805, 822, 877, 926).
- `src/access-intent/bash/redirect-analysis.ts` — the one reader of a `file_redirect` node: `redirectEffectForDestination` (a proof for the collector; `UNPROVEN_EFFECT` when `parseUnresolvedAt`) and `redirectMayWriteFile` (a refusal for the wrapper exemption).
- `src/access-intent/bash/node-text.ts` — `resolveNodeText` resolves a plain `$HOME`/`$PWD` through `resolvePlainVariableExpansion` and returns `node.text` for any other expansion or substitution.
- `src/access-intent/bash/bash-path-resolver.ts` — `tagTokens` copies `{ token, effect }` into a private `PathCandidate` with its `EffectiveBase`.
  `projectExternalPaths` runs `classifyTokenAsPathCandidate`, then `probeBareToken`; `projectRuleCandidates` runs `classifyTokenAsRuleCandidate`, then `probeBareToken`.
  The probe returns `null` under an unknown base and for a file that does not exist.
- The gates read `BashProgram.pathRuleCandidates()` / `externalAccesses()`.
  `describeBashPathGate` treats a check whose `matchedPattern` is `undefined` (only the universal default matched) as unrestricted (the [#58] guard ADR 0009 relies on), so an install with no explicit `path` rule gets no new `path` prompt.
  The external gate has no such guard: an unmatched external path resolves on `external_directory*`'s catch-all.
- AGENTS.md constraints that apply: use `pnpm` only; package skill: "Wildcard matching must be explicit and tested — silent over-matching is a permission bypass"; "Default to least privilege".
- Governing records: ADR 0009 (the projection's completeness contract), ADR 0013 §10 and Staging step 4.

## Design Overview

### The role

```typescript
/**
 * What a collected token is, as the collector that produced it established.
 *
 * The role decides candidacy; the effect decides direction. The two are
 * stamped at the same site and never re-derived downstream.
 */
export type TokenRole =
  /** An operand of unknown path-hood: shape and the existence probe decide. */
  | "operand"
  /** A redirect's own target, which the syntax proves names a file. */
  | "redirect-destination";

export interface PathToken {
  readonly token: string;
  readonly effect: TokenEffect;
  readonly role: TokenRole;
}
```

`role` is required, so each of the 8 construction sites states its role and the compiler checks every future one.
`script` is deliberately not a value: [#863]'s interpreter scripts are never emitted as tokens, so no token could carry it.

### Which child is the target

`redirect-analysis.ts` gains the fact [#977] will reuse:

```typescript
/**
 * The child index of the node `redirect` reads or writes: the first named
 * child after the operator. `undefined` when it names none (`>&-`).
 *
 * tree-sitter-bash 0.25.1 declares the destination `repeat1`, so words after
 * it (`grep pat 2>/dev/null f.txt`) are the redirected command's arguments,
 * not further targets (#977).
 */
export function redirectTargetIndex(redirect: TSNode): number | undefined;
```

The descriptor (`2` in `2>`) precedes the operator, so "first named child after the operator" excludes it without a type test.
An index rather than a node, because the collector already iterates by index, and a comparison by index does not depend on whether `child(i)` returns the same wrapper object on each call.

### What makes a target literal

`node-text.ts` gains:

```typescript
/**
 * Whether an argument node's value is decided at run time: it contains a
 * command/process substitution, an arithmetic expansion, or a variable
 * expansion `resolvePlainVariableExpansion` cannot resolve.
 */
export function hasComputedPart(node: TSNode): boolean;
```

`"$HOME/out"` is not computed (it resolves, and its shape already qualifies); `"$OUT"`, `${DIR}/x`, `out-$(date).txt` are; `'$x'` is a literal.

### Stamping at collection

```typescript
export function collectRedirectTokens(node: TSNode): PathToken[] {
  const target = redirectTargetIndex(node);
  const tokens: PathToken[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (ARG_NODE_TYPES.has(child.type)) {
      const effect = redirectEffectForDestination(node, child);
      if (effect) {
        const token = resolveNodeText(child);
        const role = i === target && provesTarget(effect, child, token)
          ? "redirect-destination" : "operand";
        tokens.push({ token, effect, role });
      }
    }
    tokens.push(...collectHostedExecutionTokens(child));
  }
  return tokens;
}
```

`provesTarget` (private, below its caller) holds when the effect's `source` is `"syntax"` (read or write; an unresolved parse or an unknown operator is `unproven`), the node is not `hasComputedPart`, and the token is non-empty (`> ""` is an error in bash, not a file).
Every other collector stamps `"operand"`.

### Reading the role at projection

`PathCandidate` gains `role`; `tagTokens` copies it.
Both projections ask one question first:

```typescript
const shaped = role === "redirect-destination"
  ? token
  : classifyTokenAsRuleCandidate(token, this.normalizer.flavor);
```

(`projectExternalPaths` the same with `classifyTokenAsPathCandidate`.) An admitted token then takes the exact path a shape-qualified candidate takes: `buildRuleCandidatePath` (an unknown base plus a relative token keeps only the literal value, per [#393]), and on the external side the unknown-base branch flags a relative token conservatively while a known base resolves it and applies the containment boundary.
The probe is never consulted for it, and nothing about the effect, the dedup fold (`mergeTokenEffects`), or the public output types changes.

### How the evidence was produced

- **Source:** real input throughout.
  8746 distinct bash commands deduplicated from the live review log (`~/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl`), parsed through the real `BashProgram.parse` with a `posix` `PathNormalizer` at the repo root; gate verdicts through a real `PermissionManager` (`createManagerWithScopes`) and `PermissionResolver`.
- **Prototype:** the design above minus the two helpers' final names, applied at `e26f14000c026795087390ec75b8c71fed46088d`, then reverted.
  Control: the same spike at the same commit with the prototype off.
  The source is deterministic (n = 1 per condition); the existence probe reads the filesystem at the time of the run, so a bare token that happens to exist in the repo root is already projected in both conditions.
- **Corpus diff (measured):** `path` candidates +90 tokens in 60 commands, `external_directory` +97 tokens in 62 commands, **0 lost** on either surface.
  Every gained token is a literal creating-redirect target (`> 1.md`, `> test-ts.mjs`, `> a.py`); the input-redirect half of the rule gained **0** tokens on this corpus, so admitting input targets costs nothing measurable.
  Before the first-destination and literal-target rules were added, the prototype also admitted `-type`, `d`, `--include=*.ts` (trailing words, [#977]) and `$3`, `$tmp`, `$f` (computed targets); both rules are therefore load-bearing.
- **New prompts (measured, gate verdicts before vs after):** under the operator's own global + project config, **2** commands newly ask, both `external_directory_write` after `cd "$D"` / `cd "$T"` on a `mktemp -d` directory; with no config at all, **1**; under `{"*": "allow", "path_write": {"*": "ask"}}`, **28** newly ask on `path`.
- **Deny bypass behind Non-Goal 1 (measured):** `resolveBashCommandCheck` with `bash: {"*": "allow", "git push *": "deny", "find * -delete*": "deny"}` returns `allow` for `git 2>/dev/null push --force` and `find ~/x 2>/dev/null -delete`, and `deny` without the redirect.
- **Migration-note premise (measured):** with `path: {"*": "ask", "*.env": "deny"}` plus `path_write: {"*": "allow"}`, a write to `.env` resolves `allow`: explicit directional entries go after the sugar, and the last match wins.
  So the roadmap's suggested note would lift a user's write denies; the note below does not recommend it.
- **Context for the docs (measured):** the same `path_write: {"*": "ask"}` posture already asks on `path` for 6842 of 8746 commands *before* this change, because an unproven token consults both directions.
  The docs therefore describe what `path_write` governs rather than recommending `{"*": "ask"}` as a redirect-only switch.

## Module-Level Changes

### Source

- `src/access-intent/bash/token-collection.ts` — export `TokenRole`; `PathToken.role` (required); every construction site stamps `"operand"` except the redirect target; `collectRedirectTokens` gains the target index and private `provesTarget`; update the `PathToken` and `collectRedirectTokens` doc comments (the "Collection" / "role" wording, and the note that trailing destinations are [#977]'s).
- `src/access-intent/bash/redirect-analysis.ts` — export `redirectTargetIndex`; module doc mentions the third fact it owns.
  `redirectMayWriteFile` unchanged ([#977]).
- `src/access-intent/bash/node-text.ts` — export `hasComputedPart`.
- `src/access-intent/bash/bash-path-resolver.ts` — `PathCandidate.role`; `tagTokens` copies it; `projectExternalPaths` and `projectRuleCandidates` admit a `redirect-destination` token without classifier or probe; class and method doc comments state the role rule (the class doc's "A bare token that fails both shape gates is admitted when…" paragraph gains the role sentence).

Predicted **unchanged**, each resting on a stated claim:

- `src/handlers/gates/bash-path.ts`, `bash-external-directory.ts`, `external-directory-policy.ts` — they read `BashPathRuleCandidate` / `BashExternalPath`, which do not gain `role`.
- `src/access-intent/bash/program.ts` — it forwards `ResolvedBashPaths` unchanged.
- `src/access-intent/bash/command-enumeration.ts`, `command-effects.ts`, `redirectMayWriteFile` — [#977].
- `src/handlers/gates/bash-path-extractor.ts` and its test — no production caller; [#978].

### Tests

- `test/access-intent/bash/token-collection.test.ts` — step 1's projection helper; step 4's `describe("token role")`.
- `test/access-intent/bash/redirect-analysis.test.ts` — `describe("redirectTargetIndex")`.
- `test/access-intent/bash/node-text.test.ts` — `describe("hasComputedPart")`.
- `test/access-intent/bash/program.test.ts` — a `describe("a redirect's target is projected by its role")` under both `pathRuleCandidates` and `externalPaths`.
- `test/handlers/gates/bash-path.test.ts`, `test/handlers/gates/bash-external-directory.test.ts` — gate-level outcome cases.

### Docs

- `docs/decisions/0009-bash-path-projection-completeness-contract.md` — a new `### Amendment, <date> — a redirect's target is projected by its role` at the top of the amendments (date from `date -u +%F` at implementation), frontmatter `amended:` and the `## Status` line; the guarantee bullet "A **redirect target** (`> out.txt`, `2>/tmp/log`)" gains "its first destination, whether or not the file exists, unless computed"; the residual sentence "Redirect targets, the common creation path, are collected separately and unaffected." is rewritten to say they are guaranteed by role and a trailing word after a redirect is [#977]'s.
- `docs/decisions/0013-permission-policy-model.md` — Staging step 4 gains `— landed ([#609]).` in step 1's form.
- `docs/configuration.md` — the projection bullet at line 742 ("plus redirect targets (`> out.txt`)") gains "including a file the redirect creates"; the direction table section near line 855 gains one sentence that a redirect target reaches its `_write`/`_read` surface whether or not the file exists.
- `docs/architecture/architecture.md` — module-tree entries for `token-collection.ts` (`TokenRole`), `bash-path-resolver.ts` (the role admission beside the probe sentence), `redirect-analysis.ts` (`redirectTargetIndex`), `node-text.ts` (`hasComputedPart`); the Phase 15 roadmap `✅` on the `#### [#609]` heading **and** the `S609` Mermaid node, plus a `Landed:` note with the commit subjects and the re-run corpus figures.
  The two health-metric rows this step creates (`TokenRole` in `token-collection.ts`, `redirect-destination` in `bash-path-resolver.ts`) keep the roadmap's names; the dated baseline column is not edited.
- `.pi/skills/package-pi-permission-system/SKILL.md` — the paragraph at line 298 ("…and a bare filename is promoted into both when the existence probe finds it on disk") gains "and a redirect's literal first destination reaches both by its role".
- `README.md` line 119 is predicted unchanged: it describes direction, which this change does not touch.

## Test Impact Analysis

1. New tests the change enables: `redirectTargetIndex` and `hasComputedPart` are unit-testable on their own; the role is assertable at collection separately from its effect at projection.
2. Tests that become redundant: none.
   The prototype run broke only the 4 `token-collection.test.ts` exact-shape assertions that step 1 routes through its projection; no behavior test in the suite pinned the drop (measured: 4 failed, 4611 passed, with the prototype applied).
3. Tests that stay as they are: `program.test.ts`'s `#741` redirect-hosted operand describe (lines 554–575), its `effect attribution (#807)` redirect cases (line 2155), and `token-collection.test.ts`'s `#814` unresolved-redirect cases (line 1288) all exercise the real collector and resolver and must stay green unmodified.

## Invariants at risk

| Invariant (who it serves)                                                                                         | Pinned by                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#807]: a redirect's operator proof overrides the command's (users with directional grants)                       | `program.test.ts` "carries a redirect's write onto its destination" (real parser + resolver; `node:fs.realpathSync` mocked only)                  |
| [#814]: an unresolved redirect proves nothing (read grants must not cover a read-write open)                      | `token-collection.test.ts` "a redirect the parser could not resolve (#814)"; plus step 5's program-level `cat <> rw.txt` negative                 |
| [#741]: a substitution hosted in a target still projects its command's operands                                   | `program.test.ts` lines 554–575                                                                                                                   |
| A descriptor duplication (`2>&1`) collects no token                                                               | `token-collection.test.ts` "collects no token for a file-descriptor duplication"                                                                  |
| [#393]: an unknown base never resolves a relative token against a guess                                           | step 5's unknown-base cases assert the literal-only rule value and the conservative external flag                                                 |
| ADR 0009's unmatched-promotion guard: no explicit `path` rule, no new `path` prompt (users with no `path` config) | step 5's gate case under the universal default only; the measured corpus figure (0 new `path` prompts with no config) re-run after implementation |
| Quantitative: 0 tokens lost on either surface; gains are only literal creating-redirect targets                   | the corpus spike below, re-run at the post-change commit; figures recorded in the `Landed:` note                                                  |

### The corpus spike

Write this to `packages/pi-permission-system/test/spike-609.test.ts`, run it once at the pre-change commit and once after step 5 with `SPIKE_OUT=/tmp/ext609-<label>.json pnpm --filter @gotgenes/pi-permission-system exec vitest run test/spike-609.test.ts`, diff the two outputs, then delete the spike.

````typescript
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { BashProgram } from "#src/access-intent/bash/program";
import { posixPathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path/path-normalizer";

const LOG = join(
  homedir(),
  ".pi/agent/extensions/pi-permission-system/logs",
  "pi-permission-system-permission-review.jsonl",
);

it("measures", async () => {
  const seen = new Set<string>();
  for (const line of readFileSync(LOG, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (e.toolName !== "bash") continue;
    const c = typeof e.command === "string" ? e.command : undefined;
    if (!c || c.endsWith("…")) continue;
    seen.add(c);
  }
  const n = new PathNormalizer(
    posixPathFlavor,
    "/Users/chris/development/pi/pi-packages",
  );
  const out: Record<string, { ext: string[]; rule: string[] }> = {};
  for (const c of seen) {
    const p = await BashProgram.parse(c, n);
    out[c] = {
      ext: p
        .externalAccesses()
        .map(({ path, effect }) => `${path.value() ?? ""}|${effect.effect}`),
      rule: p
        .pathRuleCandidates()
        .map(({ token, effect }) => `${token}|${effect.effect}`),
    };
  }
  writeFileSync(process.env.SPIKE_OUT ?? "/tmp/ext609.json", JSON.stringify(out));
}, 600_000);
````

The log grows with use, so totals will exceed 8746 on a later run.
Compare classes, not totals: **0 lost** on both surfaces; every gained token a literal redirect target (no leading `-`, no `$`); no gained token that is a word after a redirect's first destination.

## TDD Order

Steps 4 and 5 carry the adopted design and end with this final trailer paragraph, below `Refs #609` (and below the `BREAKING CHANGE:` paragraph in step 5), verified with `git interpret-trailers --parse`:

```text
Co-authored-by: Harrison Crosse <12689177+hcrosse@users.noreply.github.com>
Co-authored-by: Nirmaan J Sarkar <1259713+pikujs@users.noreply.github.com>
```

The first credits #609's mechanism (keep a redirect's provenance through to the gate); the second credits [#785]'s (emit a redirect destination unconditionally, even when bare and not yet existing).

1. **Assert token effects through a projection** — `test/access-intent/bash/token-collection.test.ts`.
   Friction it prepares: a required `role` would otherwise break 19 exact `toEqual` calls across the `statement operands` (`tokensOf`, line 939) and `effect attribution` (`attributedTokens`, line 1181) describes, none of which is about role.
   Add an `effectsOf(tokens)` projection to `{ token, effect }[]` beside `tokenTextsOf`, and route those calls through it; no literal's contents change.
   Verify: suite green; then apply the mutation "make `redirectDestinationEffect` return `UNPROVEN_EFFECT` for an output operator" and confirm "proves a write for an output redirect destination" still goes red through the helper; revert.
   Commit: `test(pi-permission-system): assert collected token effects through a projection`.

2. **Name a redirect's target** — `redirect-analysis.ts` `redirectTargetIndex`; tests in `redirect-analysis.test.ts` asserting `redirect.child(index)?.text`: `> out.txt` → `out.txt`; `grep pat 2>/dev/null f.txt` → `/dev/null`; `cmd 2>&1` → `1`; `echo hi >&-` → `undefined`.
   Killing mutations: "return the index of the **last** named child" kills the `2>/dev/null f.txt` case; "return the index of the first named child" (no operator skip) kills it too by returning the descriptor `2`.
   Commit: `refactor(pi-permission-system): name the child a redirect reads or writes`.

3. **Tell a literal argument from a computed one** — `node-text.ts` `hasComputedPart`; tests in `node-text.test.ts`: `out.txt`, `'$x'`, `"$HOME/out"` → false; `$OUT`, `"$OUT"`, `"${DIR}/x"`, `out-$(date).txt`, `<(cmd)` → true.
   Killing mutations: "return `false` unconditionally" kills `"$OUT"`; "treat every variable expansion as computed (skip `resolvePlainVariableExpansion`)" kills `"$HOME/out"`.
   Commit: `refactor(pi-permission-system): detect an argument whose value is computed at run time`.

4. **Stamp the role at collection** — `token-collection.ts`: `TokenRole`, required `PathToken.role`, all 8 sites, `collectRedirectTokens` + `provesTarget`.
   Run `pnpm run check` after this step; `bash-path-resolver.ts`'s `tagTokens` still destructures `{ token, effect }` and compiles unchanged.
   New `describe("token role")` in `token-collection.test.ts`, asserting `{ token, role }` pairs over `collectPathCandidateTokens`: `cat a > out.txt` → `a` operand, `out.txt` redirect-destination; `sort < in.txt` → redirect-destination; `grep pat 2>/dev/null f.txt` → `/dev/null` redirect-destination, `f.txt` operand; `echo hi > "$OUT"` → operand; `cat <> rw.txt` → operand; `echo hi > ""` → operand; `echo hi > $(cat /etc/shadow)` → `/etc/shadow` operand.
   Killing mutations, one per class: stamp `redirect-destination` on every destination child (kills `f.txt`); drop the `hasComputedPart` clause (kills `"$OUT"`); drop the `syntax`-source clause (kills `<>`); drop the non-empty clause (kills `""`); stamp `"operand"` everywhere (kills `out.txt` and `in.txt`).
   Commit: `refactor(pi-permission-system): record a redirect target's role on its collected token` (no consumer reads the role yet), with the co-author trailer paragraph.

5. **Project by role** — `bash-path-resolver.ts`: `PathCandidate.role`, `tagTokens`, both projections.
   `program.test.ts`, under `pathRuleCandidates` (cwd `/projects/my-app`, which does not exist, so the probe never admits a bare token): `cat /etc/hosts > out.txt` → `{ token: "out.txt", effect: write/syntax }` among the candidates; `sort < in.txt` → `in.txt` read/syntax; `cd "$D" && echo hi > out.txt` → `out.txt` with a literal-only match value; negatives `find /usr 2>/dev/null -type d` (no `-type`, no `d`), `echo hi > "$OUT"` (no `$OUT`), `cat <> rw.txt` (no `rw.txt`).
   Under `externalPaths`: `cd "$D" && echo hi > out.txt` → one external access, effect write; `cd "$D" && sort < in.txt` → effect read; `echo hi > out.txt` with a known base → none (inside cwd).
   `bash-path.test.ts`: `cat x > newfile` with a `path_write: {"*": "ask"}` surface check → a descriptor on `path_write` whose `input.path` is `newfile`; the same command with only the universal default matching → `null`.
   `bash-external-directory.test.ts`: `cd "$D" && echo hi > out.txt` with `external_directory_write` `ask` → a descriptor on `external_directory_write`.
   Killing mutations: "make both projections ignore `role`" kills every positive case; "admit by role in `projectRuleCandidates` only" kills the two unknown-base external cases; "hard-code `role: "operand"` in `tagTokens`" kills every positive case at the program level while step 4's collection tests stay green (the relocated-line check); "admit by role in `projectExternalPaths` only" kills the `path_write` gate case.
   Re-run the corpus spike; confirm the classes in Invariants at risk.
   Commit: `fix(pi-permission-system)!: check a redirect's target against path rules even when the file does not exist yet`, body naming the mechanism, then `Refs #609`, then:

   ```text
   BREAKING CHANGE: a redirect's target now reaches the path and
   external_directory surfaces whether or not the file exists yet, so
   `cat x > newfile` is checked against path_write (and, after a
   non-literal `cd`, external_directory_write) where it previously ran
   unchecked. A config with no explicit path or path_write rule sees no
   new prompt in the working directory. To allow such writes, add allow
   patterns for the destinations you expect to path_write and repeat
   after them any path deny you rely on for writes: an explicit
   path_write entry out-ranks the bare path key, so a lone
   `path_write: {"*": "allow"}` would lift a path deny on writes.
   ```

   and the co-author trailer paragraph last.

6. **Docs** — every file under Module-Level Changes → Docs, including the roadmap `✅` (heading and Mermaid node) and `Landed:` note with the re-run corpus figures.
   Commit: `docs(pi-permission-system): record that a redirect's target is projected by its role`.

## Risks and Mitigations

| Risk                                                                             | Mitigation                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The role admits a word that is not the redirect's target and newly prompts on it | First-destination rule, with a killing mutation; measured that without it the prototype admitted `-type`, `d`, `--include=*.ts`                                                  |
| A computed target is projected as a literal path and matched against rules       | `hasComputedPart` clause, with a killing mutation; measured that without it `$3`, `$tmp`, `$f` were admitted                                                                     |
| An unconfigured install starts prompting on every `> file`                       | Measured: 1 new prompt in 8746 commands with no config; ADR 0009's unmatched-promotion guard covers the `path` side, and the external side changes only after a non-literal `cd` |
| The migration note loosens a user's denies                                       | Measured that `path_write: {"*": "allow"}` lifts a `path` write deny; the footer tells the user to repeat their denies after their allows instead                                |
| Win32: a bare target resolves differently                                        | The admitted token takes the same `forBashToken` / `buildRuleCandidatePath` path a shape-qualified relative token already takes on win32; no new platform branch is introduced   |
| The fix makes [#977] harder by writing around the quirk                          | `redirectTargetIndex` is the seam [#977] reuses; this plan does not change the trailing words' attribution, so [#977] starts from today's behavior plus one named helper         |

## Open Questions

- Whether an input redirect to a nonexistent file (`sort < missing.txt`, a command the shell refuses to run) should be excluded from the role later.
  It is admitted now for one uniform rule, and measured at 0 gained tokens; revisit only if a report surfaces a prompt from it.

[#58]: https://github.com/gotgenes/pi-packages/issues/58
[#393]: https://github.com/gotgenes/pi-packages/issues/393
[#741]: https://github.com/gotgenes/pi-packages/issues/741
[#785]: https://github.com/gotgenes/pi-packages/issues/785
[#806]: https://github.com/gotgenes/pi-packages/issues/806
[#807]: https://github.com/gotgenes/pi-packages/issues/807
[#814]: https://github.com/gotgenes/pi-packages/issues/814
[#863]: https://github.com/gotgenes/pi-packages/issues/863
[#880]: https://github.com/gotgenes/pi-packages/issues/880
[#881]: https://github.com/gotgenes/pi-packages/issues/881
[#951]: https://github.com/gotgenes/pi-packages/issues/951
[#977]: https://github.com/gotgenes/pi-packages/issues/977
[#978]: https://github.com/gotgenes/pi-packages/issues/978
