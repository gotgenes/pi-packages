---
issue: 875
issue_title: "pi-permission-system: a partial bash parse can drop a command unit, so an explicit deny never fires"
---

# Salvage a command a partial bash parse dropped

## Release Recommendation

**Release:** ship independently

No roadmap step references this issue — Phase 15's `#### Open-issue sweep dispositions` list records it as *deferred with recorded rationale (2nd consecutive sweep)*, and the operator has pulled it forward on the strength of the 2026-09-15 triage, which ranks it 2 in Band 1 as a fail-open.
That is the same handling [#861] and [#899] received this phase.
With no `Release:` tag to read, it ships on its own; the plan's `fix:` steps cut a patch.

## Problem Statement

A partial `tree-sitter-bash` parse failure can drop a whole command out of enumeration, so the `bash:` rule that would deny it is never consulted — and, as this planning session measured, the dropped region's path operands reach neither the `path` nor the `external_directory` surface either.

[#840] fails the *verdict* closed: every unit the recovery did produce is marked, and its `allow` is floored to a synthetic `ask` naming the whole command line.
It cannot restore the enumeration, so a configured hard `deny` degrades to an approvable prompt about a *different* command, and a path the user never agreed to expose is gated by nothing at all.

## Goals

- A command the primary parse dropped is enumerated as a command unit, so an explicit `bash:` `deny` on it fires again.
- That command's path operands reach the `path` and `external_directory` surfaces, restoring the ADR 0009 completeness guarantee for them.
- Salvaged units are marked `parseUnresolved`, so [#840]'s existing floor clamps their `allow` to `ask` unchanged — the salvage adds restriction and never removes any.
- Nothing is salvaged from a region whose own re-parse fails, so [#742]'s "recovery invents structure" boundary and [#814]'s unresolvable-redirect refusal both hold unchanged.
- The advisory `checkPermission` path answers at gate parity, as it does for every other bash fail-closed mechanism ([#309]).
- **Not breaking** (`fix:`, no `!`).
  Measured delta over the local review log is **0** changed decisions on 6911 intact commands: all 7 errored commands already `ask` under [#840], and the 7 units the salvage adds (`tail -3` / `tail -4`) match no rule in the measured config and carry no path token.
  The change is monotonically at-least-as-restrictive by construction.
  Precedent: [#840] shipped `fix:` at 2 of 5269, [#821] at 2 of 3995.

## Non-Goals

- **Amending ADR 0013 §10's `ask` to `deny`.**
  The issue's third candidate direction, declined at the clarification gate: it hard-blocks 7 of 6911 real commands with no approval path, and it restores no rule evaluation — `rm -rf /tmp/x` would still be matched against nothing, the whole command merely blocked.
- **A heredoc pre-pass.**
  The issue's second candidate direction, declined at the gate and now also refuted on the facts: eliding only the heredoc *body* does not help, because `<<TAG` + `2>&1` + `|` is what defeats the grammar (measured — `<<'MSG' | rm -rf /tmp/x` parses clean, `<<'MSG' 2>&1 | rm -rf /tmp/x` does not).
  A pre-pass would have to excise the whole `<<TAG … TAG` construct, which is the second hand-rolled notion of a bash program the issue warns about.
- **An upstream grammar fix.**
  `tree-sitter-bash` 0.25.1 is npm's latest and the tracker carries no issue for this combination, so there is no lever today; this change is independent of one arriving later.
- **Descending an `ERROR` subtree.** [#742] settled that; the salvage re-parses a region's *source text* and reads nothing out of the invented tree.
- **Folding a `cd` into a salvaged region's effective base.**
  A salvaged root resolves under an unknown base — see Design Overview — which is conservative in the [#393] sense and leaves a *relative* token in a dropped region unprojected, exactly as today.
  Recorded as an accepted residual in ADR 0009 rather than filed.
- **Changing [#840]'s floor, the wrapper floors ([#481], [#490], [#803]), or the `<unparseable-bash-command>` branch ([#452], [#712]).**
  `src/handlers/gates/bash-command.ts` is untouched: a salvaged unit is an ordinary `BashCommand`.
- **The `bash` surface's migration to structured rules ([#804]) and the sandbox seam ([#892]).**
  A sandbox would subsume the projection, but it is an unlanded ADR; this defect is live today.

## Background

### What the parse actually produces

`tree-sitter-bash` 0.25.1 cannot parse a heredoc redirect combined with `2>&1` **and** a pipe, though each pairing alone is fine (ADR 0013's 2026-08-29 amendment).
Measured this session with the real parser:

```text
git add -A . && git commit -F - <<'MSG' 2>&1 | rm -rf /tmp/x
msg
MSG
```

```text
program [hasError]
  redirected_statement [hasError]
    list                      "git add -A . && git commit -F"
    heredoc_redirect [hasError]
      file_redirect [hasError]   "2>&1 | rm -rf /tmp/x"
        file_descriptor "2"  >& "1"
        ERROR [hasError]  "|"
        word "rm"   word "-rf"   word "/tmp/x"
      heredoc_body  "msg\n"
      heredoc_end   "MSG"
```

The `ERROR` node holds only the `|`.
The dropped command's words are plain `word` siblings of it under `file_redirect`, and `heredoc_redirect` is an `EXECUTION_HOST_TYPES` member — descended for the nested substitutions [#741] made it reach, never read for text — so nothing emits them.

### The measured verdict today

Run against the real `BashProgram` + `resolveBashCommandCheck` with `bash: {"*": "allow", "rm -rf *": "deny"}`:

| Command                                                 | Verdict (measured)                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| `git add -A . && git commit -F - 2>&1 \| rm -rf /tmp/x` | `deny`, `matchedPattern: "rm -rf *"`, `command: "rm -rf /tmp/x"` |
| the same with `<<'MSG' … MSG` before `2>&1`             | `ask`, `matchedPattern: "<unparsed-bash-subtree>"`               |

`bash -n` accepts both.
The prompt the second raises shows a `git commit`, and approving it runs the `rm -rf`.

### The half the issue does not state

The path surfaces lose the same region.
Measured through `BashProgram`:

```text
cat <<'MSG' 2>&1 | cat /etc/shadow
  commands()            [{ text: "cat", parseUnresolved: true }]
  externalAccesses()    []
  pathRuleCandidates()  []
```

ADR 0009 states the projection is a **completeness contract, not a best-effort heuristic**, and its "What the projection deliberately omits" list does not cover this.
So the loss is a bug against that contract, not an accepted residual, and the record needs the same amendment ADR 0013 does.

### Measured population

Local permission review log, this session: 9191 `bash` entries → **6911 distinct intact** commands (333 excluded as truncated by the 1000-character `reviewLogFieldMaxWidth` cap, which re-parses as garbage).

| Quantity                                                | Value     |
| ------------------------------------------------------- | --------- |
| commands whose parse errors                             | 7 (0.10%) |
| of those, salvaging cleanly                             | 7 of 7    |
| salvaged units that are invented rather than real       | 0         |
| new prompts the salvage creates                         | 0         |
| decisions the salvage changes under the measured config | 0         |

Every one of the 7 is the `git commit -F - <<'EOF' 2>&1 | tail -N` shape (or `pnpm run lint …; git add …` chains ending in it), and each salvages exactly its real dropped `tail` command.

### Constraints from AGENTS.md and the package skill

- `parser.ts` is the sole reader of `TSNode.hasError` / `previousSibling`, through `parseUnresolvedAt` (redirect-shaped) and `parseUnresolvedWithin` (subtree only); the salvage asks its question through `parseUnresolvedWithin` and hand-rolls no traversal of either member ([#814], [#840]).
- A module no code imports yet is `refactor:` however new it is; the commit that wires it up carries the `fix:`.
- A new module goes to its named directory when written — `access-intent/bash/` here, since the salvage is policy-free and answers "what is being accessed".

## Design Overview

### The mechanism

When tree-sitter reports an unresolved region, **re-parse the smallest unresolved node's own text as a standalone bash program, and accept the result only if that re-parse is clean.**

Three rules make it up:

1. A **candidate** is a node for which `parseUnresolvedWithin` is true, which is not itself an `ERROR` node, which has no such descendant (so it is the innermost one), and which is not the root passed in.
   The `ERROR` exclusion is [#742]: the traversal never looks inside invented structure for a candidate.
   The root exclusion is behaviour-neutral by construction — re-parsing the root reproduces the same failure — and exists to skip a wasted full re-parse of the ~0.1% of commands whose only failure is program-level.
2. The candidate's `node.text` is re-parsed standalone.
   **If the re-parse reports an error, the candidate is discarded.**
   This is the whole safety argument: invented structure does not re-parse.
3. Each surviving root contributes command units (marked `parseUnresolved: true`) and path candidates, in addition to everything the primary parse produced.
   Nothing is removed, so the result is monotonically at-least-as-restrictive.

Measured behaviour of the guard on every shape the package's tests and corpus hold:

| Input                                         | Candidate                               | Re-parse  | Salvage                                        |
| --------------------------------------------- | --------------------------------------- | --------- | ---------------------------------------------- |
| `git add … <<'MSG' 2>&1 \| rm -rf /tmp/x`     | `file_redirect` `2>&1 \| rm -rf /tmp/x` | clean     | `rm -rf /tmp/x`                                |
| `cat <<'MSG' 2>&1 \| cat /etc/shadow`         | `file_redirect`                         | clean     | `cat /etc/shadow`                              |
| `cat <<'MSG' 2>&1 \| sudo rm -rf /`           | `file_redirect`                         | clean     | `sudo rm -rf /` (indirection wrapper, floored) |
| `cat <<'EOF'\nsee \`rm -rf x\` here` ([#742]) | root only                               | —         | nothing                                        |
| `echo "$(rm x)`                               | root only                               | —         | nothing                                        |
| `for f in a; do rm $f`                        | root only                               | —         | nothing                                        |
| `cat <> rw.txt` ([#814])                      | `file_redirect` `<> rw.txt`             | **dirty** | nothing                                        |
| `cat $(( > out.txt` ([#814])                  | `redirected_statement`                  | **dirty** | nothing                                        |
| `echo hi > out.txt <> rw.txt; rm -rf /tmp/y`  | `file_redirect` `<> rw.txt`             | **dirty** | nothing                                        |

The clean-re-parse guard is load-bearing rather than defensive: measured, dropping it makes `cat <> rw.txt` emit a command unit whose text is `">"`, and `cat $(( > out.txt` emit a duplicate `cat` plus a `"$(("` unit — nonsense strings then matched against the `bash:` patterns.

### The new module

`src/access-intent/bash/unresolved-salvage.ts` owns the candidate walk and the re-parse lifetime.
Its dependency is one narrow interface, not the parser singleton:

```typescript
/** The one parse capability the salvage needs: re-parse a fragment on its own. */
export interface BashReparser {
  parse(input: string): { readonly rootNode: TSNode; delete(): void } | null;
}
```

`BashReparser` is exported from `parser.ts` beside `TSNode`; the private `TSParser` satisfies it structurally and stays private.
Handing the salvage the full `TSParser` would hand it a `delete()` that destroys the shared parser singleton for the rest of the process — a capability it must promise never to use, which is the Tidy-First assessor's ISP finding.

A re-parsed tree must outlive its root's use, so the module's surface is scope-bounded rather than a getter:

```typescript
export function withSalvagedRoots<T>(
  primary: TSNode,
  reparser: BashReparser,
  use: (salvaged: readonly TSNode[]) => T,
): T;
```

It collects candidates, re-parses each, keeps the clean trees alive across the `use` call, and deletes every tree it created in a `finally` — mirroring the `try/finally` the two call sites already run around their own tree.
A caller with no parser (there is none today) is not a case: both call sites hold one.

### The consumer call sites

`BashProgram.parse` is the one place that builds all three slices, so it is the one place the salvage wires in:

```typescript
const tree = parser.parse(command);
if (!tree) return new BashProgram(command, [], [], []);
try {
  return withSalvagedRoots(tree.rootNode, parser, (salvaged) => {
    const { externalAccesses, ruleCandidates } = new BashPathResolver(
      normalizer,
      options?.workdir,
    ).resolve(tree.rootNode, salvaged);
    return new BashProgram(
      command,
      [
        ...collectCommands(tree.rootNode),
        ...salvaged.flatMap(collectSalvagedCommands),
      ],
      externalAccesses,
      ruleCandidates,
    );
  });
} finally {
  tree.delete();
}
```

`parseBashCommandsSync` does the same for the command surface alone (it builds no path slices), which is what keeps the advisory `checkPermission` answer at gate parity ([#309]).

Salvaged units are **appended** rather than merged in source order.
`resolveBashCommandCheck` folds most-restrictive, so order does not reach the verdict, and the prompt displays the whole command string rather than a unit list.

### The enumerator seam

`collectCommands` already forwards straight to `collectCommandsInto(node, TOP_LEVEL_SCOPE, out)`, so the seam exists.
Rather than exporting `UnitScope` — whose `context` and `writesViaRedirect` fields a salvage caller has no business setting — `command-enumeration.ts` gains a second named entry point over the same private walk:

```typescript
/** A region the primary parse could not resolve, re-parsed cleanly on its own. */
const SALVAGED_SCOPE: UnitScope = {
  writesViaRedirect: false,
  parseUnresolved: true,
};

/**
 * Enumerate a salvaged region's command units, each marked as coming from a
 * region the primary parse could not resolve (#875).
 */
export function collectSalvagedCommands(node: TSNode): BashCommand[];
```

Marking is what makes the salvage fail-closed rather than merely additive: a salvaged unit's `allow` is floored to `ask` by the existing `floorUnparsedUnit`, while its `deny` fires.
`writesViaRedirect: false` matches `collectHostedCommands`' existing choice for a nested execution — a redirect established outside the region is not the region's.

### The path-resolver seam

`resolve` already separates collection from projection over one shared candidate array, so the salvaged roots join before projection runs once and share the existing dedup:

```typescript
resolve(
  rootNode: TSNode,
  salvagedRoots: readonly TSNode[] = [],
): ResolvedBashPaths
```

Collecting into the same array — rather than projecting a second `BashPathResolver`'s output and concatenating — is what keeps `cat /etc/hosts <<'M' 2>&1 | cat /etc/hosts` one prompt entry instead of two.

Each salvaged root is walked under the **unknown** effective base, not the workdir-seeded initial one.
The salvaged region's position in the primary tree is known but the `cd` state in force there is not: for `cd /outside && cat <<'M' 2>&1 | cat rel.txt` the candidate is the `file_redirect`, and resolving `rel.txt` against the session cwd would name a *different file* than the one that runs — matching a `path:` allow for the wrong path, which is a fail-open.
[#393]'s unknown-base machinery is exactly the conservatism for this: an absolute or `~` token stays literal-only and a literal-only bash token is treated as unconditionally external, so `/etc/shadow` is still gated, while a bare or relative token is dropped — no worse than today, where the whole region is dropped.

### What the user sees after

For `git add -A . && git commit -F - <<'MSG' 2>&1 | rm -rf /tmp/x` under `bash: {"*": "allow", "rm -rf *": "deny"}`:

|                  | Before                          | After                         |
| ---------------- | ------------------------------- | ----------------------------- |
| Units            | `git add -A .`, `git commit -F` | plus `rm -rf /tmp/x` (marked) |
| Verdict          | `ask`                           | `deny`                        |
| `matchedPattern` | `<unparsed-bash-subtree>`       | `rm -rf *`                    |
| `command`        | the whole command string        | `rm -rf /tmp/x`               |

Under a config with no `deny`, the verdict stays `ask` with `<unparsed-bash-subtree>` — the salvaged unit's `allow` floors like every other marked unit.

## Module-Level Changes

Greps run to build this list: `collectCommands` / `BashPathResolver` / `TSParser` / `parseUnresolvedWithin` / `#875` / `unparsed-bash-subtree` across `src/`, `test/`, `docs/`, `README.md`, and the whole `.pi/skills/` tree; `resolve(tree` and `collectPathCandidates` across `src/` and `test/`.

### Source

- `src/access-intent/bash/parser.ts` — export the new `BashReparser` interface beside `TSNode`; amend the module doc so "the two `parseUnresolved*` predicates" sentence names the salvage as a caller of `parseUnresolvedWithin`.
  `TSParser` stays private; `getParser` / `getWarmBashParser` are unchanged.
- `src/access-intent/bash/unresolved-salvage.ts` — **new**.
  `withSalvagedRoots`, the private innermost-candidate walk, and the clean-re-parse guard.
- `src/access-intent/bash/command-enumeration.ts` — `SALVAGED_SCOPE` and the exported `collectSalvagedCommands`; amend `collectCommands`' doc comment to name the salvage as the other entry point.
- `src/access-intent/bash/bash-path-resolver.ts` — `resolve` takes `salvagedRoots`, walking each under `UNKNOWN_BASE` into the same candidate array before projection; doc comment records why the base is unknown.
- `src/access-intent/bash/program.ts` — `BashProgram.parse` wraps its slice construction in `withSalvagedRoots`, concatenates salvaged units, and passes the roots to `resolve`; amend `commands()`' doc comment for the appended units.
- `src/access-intent/bash/sync-commands.ts` — `parseBashCommandsSync` runs the same salvage for the command surface.

`src/handlers/gates/bash-command.ts` is predicted **unchanged**: a salvaged unit is an ordinary `BashCommand` carrying `parseUnresolved: true`, and `floorUnparsedUnit` already reads that field.
The claim rests on the field being the floor's only input, verified by reading `resolveCommandUnit` this session.

`src/access-intent/bash/nested-execution.ts` is predicted **unchanged**: the salvage never asks what hosts an execution, only what re-parses.

### Tests

- `test/access-intent/bash/unresolved-salvage.test.ts` — **new**.
  The candidate walk, the clean-re-parse guard, the root exclusion, and tree cleanup.
- `test/access-intent/bash/parser.test.ts` — no new case; `BashReparser` is a type.
  Listed because the file imports from `parser.ts` and is where a reader will look.
- `test/access-intent/bash/program.test.ts` (2093 lines) — a `describe("a salvaged region (#875)")` beside the existing `describe("an unparsed ERROR node (#742)")` at ~line 1283, plus path-slice cases in the `pathRuleCandidates` / `externalAccesses` blocks.
  The `#742` block's `.toEqual` literals are the marker's regression witness and are predicted **unchanged** — every input there yields a root-only candidate, so the salvage adds nothing.
- `test/access-intent/bash/sync-commands.test.ts` — advisory-surface parity for the reported command.
- `test/handlers/gates/bash-command-metamorphic.test.ts` — the end-to-end verdict table and the never-weaker property.
- `test/service/bash-advisory-check.test.ts` — the reported command answers `deny` on the warm advisory path when a rule covers the salvaged unit.
- `test/handlers/gates/bash-path-extractor.test.ts` — predicted **unchanged**; listed because it exercises the bash path surface through the facade and would break on a `resolve` signature slip.

### Docs

- `docs/decisions/0013-permission-policy-model.md` — a new dated amendment.
  The 2026-09-04 amendment's closing paragraph enumerates three candidate fixes for [#875] and calls them "all outside this record's fold"; the salvage is a fourth it does not consider, and it is inside the §10 evaluation model because it changes what the fold is given.
  The amendment records the measurement, the mechanism, and the clean-re-parse guard as the property that keeps [#742] intact.
- `docs/decisions/0009-bash-path-projection-completeness-contract.md` — an amendment.
  The dropped region's operands were a completeness-contract *violation* that no "deliberately omits" bullet covered; the salvage closes it, and the unknown-base residual (a relative token in a salvaged region) is added to that list explicitly.
- `docs/configuration.md` — the "Fail-closed behavior" `<unparsed-bash-subtree>` bullet, whose sentence "a partial failure can drop a command from the parse entirely" is the behavior this change removes for the salvageable case.
- `README.md` — the "Fails closed" bullet (line 22), which names the partly-resolved case.
- `.pi/skills/package-pi-permission-system/SKILL.md` — the `parseUnresolvedAt`/`parseUnresolvedWithin` sole-reader sentence (line ~78) gains the salvage as a caller, and the fail-closed paragraph's closing sentence (line ~381) — "The residual is enumeration, not the verdict: a dropped unit still escapes an explicit `deny`, tracked as #875" — is the exact claim this change falsifies.
- `docs/architecture/architecture.md` —
  - a new module-tree entry for `unresolved-salvage.ts`;
  - the `parser.ts` entry (line ~880), whose Constraint sentence asserts the `hasError` boundary and now has a third caller;
  - the `command-enumeration.ts` entry (line ~886), for the second entry point;
  - the `bash-path-resolver.ts` entry (line ~888), for `resolve`'s new parameter and the unknown-base rule;
  - the `program.ts` (line ~893) and `sync-commands.ts` (line ~892) entries;
  - the Phase 15 sweep disposition for [#875] (line ~1099), which records it as deferred — amended the way [#899]'s entry was, naming the pull-forward and what the triage measured.

No health-metric row names this work, and no roadmap step's `✅` mark is owed: this issue is not a numbered step.

## Test Impact Analysis

### New tests the change enables

The candidate walk and the clean-re-parse guard are directly testable for the first time, in `test/access-intent/bash/unresolved-salvage.test.ts`, against real parses rather than through `BashProgram`.
That is where the guard's discrimination lives, and no existing file could host it.

### Tests that become redundant

None.
The `#742` block still pins "emitted whole, never descended" and keeps every assertion.

### Tests that must stay as-is

- `test/access-intent/bash/redirect-analysis.test.ts` — the salvage must not change `parseUnresolvedAt`'s answers or its callers'.
- The `#742` `.toEqual` literals in `program.test.ts` — the change predicts they do not move, which is a falsifiable claim rather than an edit.

### Input domain

The salvage's correctness is a claim about arbitrary malformed input, so the table is drawn from real samples rather than imagined ones: the 7 measured corpus shapes, the adversarial `| rm -rf /tmp/x` and `| cat /etc/shadow` variants, the four malformed families (`echo 'unbalanced`, `if true; then echo hi`, `for f in a b; do echo $f`, `{ echo hi`), both [#742] cases, both [#814] cases, the `cd`-before-salvage shape, and a clean control set.
Every row was run through the real parser this session and its expected answer recorded in the Design Overview table.

## Invariants at risk

| Invariant                                                   | Refs     | Pinned by                                                                                                                      | Risk                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An `ERROR` node is emitted whole and never descended        | [#742]   | `program.test.ts` `describe("an unparsed ERROR node (#742)")` (read this session: three `.toEqual` literals on the full array) | the salvage re-parses source text rather than descending; measured, every `#742` input yields a root-only candidate, so the block is predicted byte-unchanged                                                                                                                                                                                  |
| Recovery's invented structure is never read as commands     | [#742]   | **add a test**: the clean-re-parse guard cases in `unresolved-salvage.test.ts`                                                 | measured, dropping the guard emits `">"` and `"$(("` as command units — the guard is the only thing standing between the salvage and this                                                                                                                                                                                                      |
| An unresolvable redirect proves nothing                     | [#814]   | `redirect-analysis.test.ts`                                                                                                    | `parseUnresolvedAt` is untouched; both `<>` shapes re-parse dirty and salvage nothing, pinned as table rows                                                                                                                                                                                                                                    |
| A marked unit's `allow` floors to `<unparsed-bash-subtree>` | [#840]   | `bash-command.test.ts`                                                                                                         | `bash-command.ts` is unchanged; `collectSalvagedCommands` sets the field the floor reads, pinned by the marker assertion in step 2                                                                                                                                                                                                             |
| A non-empty zero-unit parse fails closed                    | [#452]   | `bash-command.test.ts:137`                                                                                                     | a salvage that turned a zero-unit parse into a non-zero one would skip the `<unparseable-bash-command>` branch; no such shape exists (measured — the one zero-unit-shaped candidate, `<<'M' 2>&1 \| rm …`, is root-only), and the replacement units would all be marked and floored to the same `ask`, so the verdict cannot weaken either way |
| The bash projection is a completeness contract              | ADR 0009 | `program.test.ts` `pathRuleCandidates` blocks                                                                                  | this change *restores* a broken guarantee; the unknown-base residual is recorded in the record rather than left implicit                                                                                                                                                                                                                       |
| A token after a non-literal `cd` stays literal-only         | [#393]   | `program.test.ts` cd-folding cases                                                                                             | salvaged roots are walked under `UNKNOWN_BASE` precisely to honour this; a known base here would name the wrong file                                                                                                                                                                                                                           |
| The advisory path answers at gate parity                    | [#309]   | `test/service/bash-advisory-check.test.ts`                                                                                     | `parseBashCommandsSync` needs the salvage too, or the advisory answer is weaker than the gate; pinned by its own row and a named mutation                                                                                                                                                                                                      |
| Every synthetic `ask` is auto-approved under yolo           | [#712]   | `runner.test.ts:154–219`                                                                                                       | untouched — no new sentinel is introduced                                                                                                                                                                                                                                                                                                      |

Quantitative baseline and prediction, both measured against the local review log this session:

| Metric                                              | Baseline | Predicted after                                       |
| --------------------------------------------------- | -------- | ----------------------------------------------------- |
| Distinct intact corpus commands whose parse errors  | 7        | 7 (unchanged — the salvage does not repair the parse) |
| Of those, enumerating every command that runs       | 0        | 7                                                     |
| Corpus commands whose decision changes              | —        | 0                                                     |
| `grep -c salvage src/access-intent/bash/program.ts` | 0        | ≥ 1                                                   |

## TDD Order

1. **`refactor(pi-permission-system): add the unresolved-region salvage walk`** Includes the Tidy-First assessor's one Recommended preparation — the narrow `BashReparser` export rather than `TSParser` — folded into this commit rather than standing alone, because an exported interface with no importer is a `fallow dead-code` finding for one commit ([#473] recorded the same reasoning for `TSParser` itself).
   The friction it prepares: `unresolved-salvage.ts` would otherwise receive a `delete()` that destroys the shared parser singleton.
   Nothing imports the module from a production path yet, so this is `refactor:` however new it is.
   Red: `test/access-intent/bash/unresolved-salvage.test.ts` — `withSalvagedRoots` yields the `file_redirect` root for the reported command; yields nothing for a clean parse; yields nothing for `cat <> rw.txt`, `cat $(( > out.txt`, `cat <<'EOF'\nsee \`rm -rf x\` here`, `echo "$(rm x)`, and `for f in a; do rm $f`; yields the innermost node rather than an enclosing one; and every tree it created is deleted before it returns.
   Killing mutations:
   - Drop the `!rootNode.hasError` check on the re-parse → the `cat <> rw.txt` and `cat $(( > out.txt` cases go red, and only those.
   - Stop the walk at the outermost unresolved non-`ERROR` node instead of recursing → the reported-command case goes red, because the candidate becomes the whole `redirected_statement`, whose text re-parses dirty.
   - Admit an `ERROR` node as a candidate → the `#742` prose case goes red.
   - Predicted **not** killable: removing the root exclusion leaves every test green, because re-parsing the root reproduces the same failure and the clean guard discards it.
     It is an optimization with no behavioral claim, and the plan says so rather than inventing an assertion for it.

2. **`fix(pi-permission-system): evaluate bash rules against a command a partial parse dropped`** The subject names the observable outcome; it ships to the changelog verbatim.
   `collectSalvagedCommands` in `command-enumeration.ts`, and the wiring in `program.ts` and `sync-commands.ts` for the command surface.
   Red: `program.test.ts` — the reported command's units gain `{ text: "rm -rf /tmp/x", parseUnresolved: true }`; `cat <<'MSG' 2>&1 | sudo rm -rf /` salvages a unit carrying `wrapperKind: "indirection"`; a clean chain is unchanged; the `#742` literals are unchanged.
   `sync-commands.test.ts` — the same units on the warm synchronous path.
   `bash-command-metamorphic.test.ts` — under `{"*": "allow", "rm -rf *": "deny"}` the reported command decides `deny` with `command: "rm -rf /tmp/x"`, and under `{"*": "allow"}` alone it still decides `ask` with `<unparsed-bash-subtree>`.
   `test/service/bash-advisory-check.test.ts` — the warm advisory path agrees with the gate on the same command.
   Killing mutations:
   - Have `collectSalvagedCommands` delegate to `collectCommands` (unmarked scope) → the `parseUnresolved: true` assertions go red, and the `{"*": "allow"}` row flips from `ask` to `allow`.
   - Drop the salvage concat in `program.ts` → every new `program.test.ts` case and the metamorphic `deny` row go red, while `sync-commands.test.ts` stays green.
   - Drop it in `sync-commands.ts` only → the advisory-parity cases go red and nothing else.
     The wiring is duplicated at two sites, so each site needs its own deleting mutation.

3. **`fix(pi-permission-system): project the path operands of a command a partial parse dropped`** `resolve`'s `salvagedRoots` parameter, the unknown-base walk, and the `program.ts` call.
   Red: `program.test.ts` — `cat <<'MSG' 2>&1 | cat /etc/shadow` yields `/etc/shadow` in both `pathRuleCandidates()` and `externalAccesses()`, with the `read` effect `cat` proves; `cat /etc/hosts <<'M' 2>&1 | cat /etc/hosts` yields **one** entry, not two; `cd /outside && cat <<'M' 2>&1 | cat rel.txt` yields no candidate for `rel.txt` (the unknown-base residual, asserted rather than discovered); a clean command's slices are unchanged.
   Killing mutations:
   - Ignore `salvagedRoots` in `resolve` → every new path case goes red.
   - Project the salvaged candidates through a second `BashPathResolver` and concatenate → the `/etc/hosts` duplicate case goes red and only that one.
   - Walk salvaged roots under the initial base instead of `UNKNOWN_BASE` → the `cd /outside` case goes red, because `rel.txt` is then resolved (wrongly) against the session cwd.

4. **`test(pi-permission-system): pin the salvage's never-weaker and anti-invention properties`** The mechanism landed in steps 1–3; this step is the table of real inputs that verifies it, deliberately separate so a table defect does not re-review the mechanism.
   Red: `bash-command-metamorphic.test.ts` — over the full input-domain table above, three properties: (a) every unit text is a substring of the source command, so no unit is invented; (b) the post-salvage unit set is a superset of the pre-salvage one and the decision is never weaker than the pre-salvage decision under the same resolver; (c) a cleanly-parsing command produces no marked unit at all.
   Killing mutation: restrict the candidate rule to `node.type === "file_redirect"` — the shape every corpus occurrence happens to take.
   The three `file_redirect` rows stay green and the property (c) rows stay green, so the table's discrimination rests on carrying a shape the corpus does not contain; the step adds `if true; then cat <<'EOF' 2>&1 | rm -rf /x\nbody\nEOF\nfi` for exactly that, and it goes red.

5. **`docs(pi-permission-system): record the salvage of a dropped bash command`** Every file in Module-Level Changes § Docs, in one commit: both ADR amendments, `docs/configuration.md`, `README.md`, the package skill, and `architecture.md`.
   Verify: `pnpm exec rumdl check` on each edited markdown file, and `grep -c salvage src/access-intent/bash/program.ts` reports at least 1.

## Risks and Mitigations

- **The clean-re-parse guard is the entire safety argument, and it is one boolean.**
  Mitigated by its named killing mutation in step 1, whose failure mode was *measured* rather than asserted: without the guard, `cat <> rw.txt` emits a `">"` command unit.
  The risk was probed in the absent direction, not the present one.
- **A candidate that re-parses clean can still overlap already-emitted units**, duplicating them.
  No corpus occurrence does, and a duplicate is harmless — the verdict fold is most-restrictive and order-independent, the path projections dedup, and the prompt shows the whole command rather than a unit list.
  Recorded rather than defended against, since a dedupe would also hide a genuine repeat.
- **The unknown base under-projects a relative token in a salvaged region.**
  This is a deliberate trade: the alternative resolves it against the wrong directory, which can match an `allow` rule for a file that is not the one being read.
  Today the token is dropped entirely, so the change is still strictly an improvement; it is recorded in ADR 0009's residual list and pinned by the `cd /outside` case in step 3.
- **The salvage runs an extra parse on every errored command.**
  0.10% of real commands error, each costing one re-parse of a short fragment, and the root exclusion removes the full-source re-parse for the malformed families.
  No measurement is claimed beyond the frequency; if it ever matters, the candidate set is already bounded by `hasError`.
- **`tree-sitter-bash` may fix the grammar upstream**, making the salvage dead on this shape.
  It stays correct — a clean parse yields no candidates — and it remains live for whatever the next grammar gap is, which is the point of keying on the parse's health rather than on a construct.
- **The `#742` literals are predicted unchanged, which is a claim rather than an edit.**
  If the prediction is wrong, step 2's red phase surfaces it immediately, and a marker landing on a `#742` input means the candidate walk reached inside invented structure — a design defect, not a literal to update.

## Open Questions

- Whether a future grammar gap will present as something other than an innermost non-`ERROR` node with clean fragment text.
  Nothing decays while waiting: the fallback is [#840]'s floor, which still converts such a case into a prompt naming the whole command.
- Whether the `bash` surface's migration to structured rules ([#804]) changes how a salvaged unit should be blamed.
  Not reopened here; the salvaged unit is an ordinary unit today and would migrate with the rest.

No follow-up issues are filed: every deferral above is either an operator decision recorded at the clarification gate, or an accepted residual written into ADR 0009 rather than tracked.

[#309]: https://github.com/gotgenes/pi-packages/issues/309
[#393]: https://github.com/gotgenes/pi-packages/issues/393
[#452]: https://github.com/gotgenes/pi-packages/issues/452
[#473]: https://github.com/gotgenes/pi-packages/issues/473
[#481]: https://github.com/gotgenes/pi-packages/issues/481
[#490]: https://github.com/gotgenes/pi-packages/issues/490
[#712]: https://github.com/gotgenes/pi-packages/issues/712
[#741]: https://github.com/gotgenes/pi-packages/issues/741
[#742]: https://github.com/gotgenes/pi-packages/issues/742
[#803]: https://github.com/gotgenes/pi-packages/issues/803
[#804]: https://github.com/gotgenes/pi-packages/issues/804
[#814]: https://github.com/gotgenes/pi-packages/issues/814
[#821]: https://github.com/gotgenes/pi-packages/issues/821
[#840]: https://github.com/gotgenes/pi-packages/issues/840
[#861]: https://github.com/gotgenes/pi-packages/issues/861
[#892]: https://github.com/gotgenes/pi-packages/issues/892
[#899]: https://github.com/gotgenes/pi-packages/issues/899
