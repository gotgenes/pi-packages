---
issue: 840
issue_title: "pi-permission-system: an unparsed bash subtree is matched as an ordinary unit instead of failing closed (ADR 0013 §10)"
---

# An unparsed bash subtree fails closed

## Release Recommendation

**Release:** ship independently

Phase 14 Step 14 carries `Release: independent`, and the roadmap's `Release batches` subsection lists Step 14 among the independently releasable steps.
It is a `fix:` (see Goals for the bump classification), so it cuts a patch on its own.

## Problem Statement

ADR 0013 §10 lists one combinator clause per bash parse-tree node type, ending with:

> *Any unhandled node type*: fail closed (`ask`, `unknown`).
> A new syntax form is unsafe until someone writes its combinator.

That clause is unimplemented.
`resolveBashCommandCheck` (`src/handlers/gates/bash-command.ts`) fails closed only when the parse yields **zero** command units — the `<unparseable-bash-command>` sentinel from [#452].
When the parse failure is *partial*, whatever units the recovery produced are matched against the `bash:` patterns like any other string, and under a permissive fallback they resolve `allow`.

## Goals

- A command unit produced from a region the parse could not resolve has its `allow` floored to a synthetic `ask`, so a subtree the fold did not understand cannot ride a permissive `bash: {"*": "allow"}`.
- The prompt names the **whole** command string, so the user sees the text the parse could not resolve rather than the fragment it could.
- An explicit `deny` or `ask` on the unit is left untouched, as with the wrapper floors.
- An allow the user already granted for this session is not re-floored.
- The advisory `checkPermission` path answers at gate parity, as it already does for the other three sentinels ([#309]).
- **Not breaking** (`fix:`, no `!`) — settled by the operator at plan time.
  Measured cost is 2 newly-prompting commands over 5269 intact real ones (0.038%), and both already appear in the review log as `session_approved`, so they raise an ask today by another route.
  This matches [#821]'s classification (2 of 3995, shipped `fix:`) and the roadmap's own prediction for this step, rather than [#839]'s (3 of 5191, settled breaking by explicit operator decision).

## Non-Goals

- **Restoring the dropped command.**
  A partial parse can drop a command unit from enumeration entirely (see Background), and the floor converts the resulting silence into a prompt without restoring an explicit `deny` on the dropped text.
  Filed as [#875], dispositioned as deferred to a later phase.
- **Resolving the whole command string first**, as the `<unparseable-bash-command>` branch does for a zero-unit parse ([#712]).
  That branch resolves the whole string because it has nothing else to resolve; here the fold already carries every unit the recovery produced, and a whole-string resolve would add a second matching surface with no rule reaching it (`rm -rf *` does not match a chain that merely contains `rm -rf`).
- **Descending an `ERROR` subtree.** [#742] settled that tree-sitter's error recovery invents structure, so the blob is emitted whole and never descended; this change reads the parse's *health*, never its recovered shape.
- **Blame propagation and per-node verdict objects** (ADR 0013 §10) — still unwritten, and unchanged here.
- **Changing the existing wrapper floors** ([#481], [#490], [#803]) or the `<unparseable-bash-command>` branch ([#452], [#712]).
- **The `bash` surface's migration to structured rules** ([#804]).

## Background

### What the enumerator does today

`collectCommands` (`src/access-intent/bash/command-enumeration.ts`) walks the parse tree and threads a private `UnitScope` — the enclosing statement's execution `context` and whether it `writesViaRedirect` — down to each emitted `BashCommand`.
An `ERROR` node reached by that walk is emitted whole and never descended ([#742]).

### The issue's diagnosis is measurably incomplete

The issue says the enumerator "emits the unparsed subtree's text as one ordinary unit alongside the units it did recover".
For its own headline command that is not what happens.
Measured with the real parser this session:

```text
git add -A . && git commit -F - <<'MSG' 2>&1 | rm -rf /tmp/x
msg
MSG
```

```text
collectCommands →  [{ text: "git add -A ." }, { text: "git commit -F" }]
```

The `ERROR` sits under `heredoc_redirect → file_redirect`, and `heredoc_redirect` is an `EXECUTION_HOST_TYPES` member — descended for substitutions, never read for text.
So `rm -rf /tmp/x` is in no unit at all.
`bash -n` accepts the script, so it really runs.

### Measured population

Over the local permission review log at planning time: 5636 deduplicated `bash` command strings, 367 excluded as truncated by the 1000-character `reviewLogFieldMaxWidth` cap, leaving **5269 intact**.

| Question                                         | Count      |
| ------------------------------------------------ | ---------- |
| `rootNode.hasError`                              | 2 (0.038%) |
| An `ERROR` node's text emitted as a command unit | **0**      |

Both error commands are the shape above.
The population the roadmap's Target line describes — a marker set on the enumerator's `ERROR` branch — therefore fires **zero** times on real input, and the population it does reach (`echo 'unbalanced`, `if true; then echo hi`, `{ echo hi`) is input `bash -n` rejects, so the shell never runs it.
Step 14's `Outcome:` line counted `ERROR`-node *presence*, not units a floor on that branch would reach.

### Why the grammar fails here

`tree-sitter-bash` 0.25.1 cannot parse a heredoc redirect combined with `2>&1` **and** a pipe, though each pairing alone is fine (ADR 0013's 2026-08-29 amendment). 0.25.1 is npm's latest, so there is no upgrade lever.
The upstream tracker carries an open cluster in this family — [tree-sitter/tree-sitter-bash#334](https://github.com/tree-sitter/tree-sitter-bash/issues/334), [#232](https://github.com/tree-sitter/tree-sitter-bash/issues/232) — but no issue for this exact combination.

### The `hasError` boundary

`parser.ts` documents `parseUnresolvedAt` as the one reader of `TSNode.hasError` and `TSNode.previousSibling`, and `.pi/skills/package-pi-permission-system/SKILL.md` and `architecture.md` both restate it ([#814]).
The enumerator must therefore ask its question through a named predicate exported from `parser.ts`, not by reading `hasError` inline.
It must **not** reuse `parseUnresolvedAt`: that predicate's `previousSibling` clause is redirect-specific — it exists because error recovery strands a discarded `<` ahead of the redirect it belonged to — and a statement whose *predecessor* failed is not itself unparsed.

### The session fast path

`GateRunner.runGateCheck` (`src/handlers/gates/runner.ts`) tests `check.source === "session"` **before** it tests state, and returns `{ action: "allow" }`.
`resolveWrapperUnit` builds its floored result as `{ ...base, state: "ask", matchedPattern }`, so `source: "session"` survives the floor and the runner short-circuits.
The session-grant exemption this plan wants is therefore already the behavior for the wrapper floors, and it comes free here from spreading `...base` the same way.
It is behavior nothing pins today, so this plan adds the test.

## Design Overview

Three edits, no signature changes.

### 1. A named predicate in `parser.ts`

```typescript
/**
 * Whether tree-sitter failed to resolve the syntax anywhere within `node`.
 *
 * The subtree-only question, and the one a walker descending statements asks:
 * a statement carrying an unresolved region is one whose recovered shape is
 * invented rather than observed. {@link parseUnresolvedAt} answers the
 * redirect-shaped question instead, widening to the immediate predecessor
 * because error recovery strands a discarded operator ahead of the redirect it
 * belonged to — which is a fact about redirects, not about statements.
 */
export function parseUnresolvedWithin(node: TSNode): boolean {
  return node.hasError;
}
```

This keeps `parser.ts` the sole reader of `TSNode.hasError`, which is what the [#814] boundary asks for.

### 2. A scope-threaded marker in the enumerator

`UnitScope` gains a third field, alongside the two it already carries for exactly this reason:

```typescript
interface UnitScope {
  readonly context?: BashCommandContext;
  readonly writesViaRedirect: boolean;
  /**
   * True when the enclosing statement carries a region tree-sitter could not
   * resolve, so its recovered shape is invented rather than observed.
   */
  readonly parseUnresolved: boolean;
}
```

`collectCommandsInto` sets it once, at its single entry point, for any node that is **not** a pure container:

```typescript
if (!node.isNamed) return;
if (COMMAND_ENUM_SKIP.has(node.type)) return;
const scope =
  COMMAND_ENUM_DESCEND.has(node.type) || !parseUnresolvedWithin(node)
    ? inherited
    : { ...inherited, parseUnresolved: true };
```

Excluding `program` / `list` / `pipeline` is what makes the marker per-statement rather than per-program: `program.hasError` is true whenever anything failed, so marking there would mark every unit.
With them excluded, `echo hi > out.txt <> rw.txt; rm -rf /tmp/y` marks only `echo hi`.

`BashCommand` gains the matching optional field, and `makeUnit` copies it from the scope exactly as it already copies `context`:

```typescript
/**
 * Set when this unit was emitted from, or beneath, a statement whose parse
 * tree-sitter could not resolve. Its decision is floored to at least `ask`,
 * because the recovered structure is not evidence of what runs (#840).
 */
readonly parseUnresolved?: true;
```

`collectHostedCommands` keeps its fresh scope (`{ context, writesViaRedirect: false }`) unchanged.
A nested execution's own statements are re-entered through `collectCommandsInto` and get their own check, and the enclosing statement's units are marked regardless — so the verdict is the same either way, and the blame is the whole command string.
The metamorphic invariant in TDD step 4 is what verifies that reasoning rather than asserting it.

### 3. The floor in `bash-command.ts`

A fourth sentinel beside the three that exist:

```typescript
const UNPARSED_SUBTREE_SENTINEL = "<unparsed-bash-subtree>";
```

The per-unit resolution, after the wrapper floor:

```typescript
function floorUnparsedUnit(
  cmd: BashCommand,
  command: string,
  resolved: PermissionCheckResult,
): PermissionCheckResult {
  if (!cmd.parseUnresolved || resolved.state !== "allow") return resolved;
  return { ...resolved, command, matchedPattern: UNPARSED_SUBTREE_SENTINEL };
}
```

Three properties carry the safety argument, and each is pinned by a named mutation in TDD step 3:

1. **`command` is the function's own first parameter, the whole command string** — not `cmd.text`.
   The reason for the ask is that part of the command was not understood, so naming the fragment that *was* understood withholds precisely what the user needs.
   `deriveDecisionValue` and `deriveSuggestionValue` both read `check.command`, so this one field decides the prompt text, the decision-event value, the review-log value, and the session-approval pattern at once.
   With `cmd.text` the recorded grant would be `git commit -F` — an exact-match pattern on a fragment, silently covering any later `git commit -F - <<'X' 2>&1 | <anything>`.
2. **Only `allow` is floored**, so an explicit `deny` or `ask` on the unit decides instead.
3. **The result is built by spreading `resolved`**, so `source: "session"` survives to the runner's fast path and a grant the user already gave is honored.

The floor is applied after `resolveWrapperUnit`, so a unit that is both a wrapper and unparsed already carries `state: "ask"` and is left alone — the wrapper sentinel is the more specific diagnosis.

Because the floor is synthesized *after* the resolver returns, `resolveYoloGrant` still reaches it and `yoloMode: true` auto-approves it, exactly as it does the other three sentinels ([#712]).

### Worked example

For `git add -A . && git commit -F - <<'MSG' 2>&1 | rm -rf /tmp/x` under `bash: {"*": "allow"}`:

|                  | Before                          | After                                                  |
| ---------------- | ------------------------------- | ------------------------------------------------------ |
| Units            | `git add -A .`, `git commit -F` | unchanged; `git commit -F` marked                      |
| Verdict          | `allow`                         | `ask`                                                  |
| `matchedPattern` | `*`                             | `<unparsed-bash-subtree>`                              |
| Prompt value     | `git add -A .`                  | the whole command string, including `\| rm -rf /tmp/x` |

## Module-Level Changes

### Source

- `src/access-intent/bash/parser.ts` — add `parseUnresolvedWithin`; amend the module doc and `parseUnresolvedAt`'s doc so "the one place `hasError` and `previousSibling` are read" becomes an accurate statement about the module rather than about one function.
- `src/access-intent/bash/command-enumeration.ts` — `UnitScope.parseUnresolved`; `TOP_LEVEL_SCOPE` gains `parseUnresolved: false`; the entry-point check in `collectCommandsInto`; `BashCommand.parseUnresolved`; `makeUnit` copies it; update `collectCommands`' doc comment.
- `src/handlers/gates/bash-command.ts` — the sentinel constant, `floorUnparsedUnit`, its call from the per-unit resolution, and the `resolveBashCommandCheck` doc comment.

### Tests

- `test/access-intent/bash/parser.test.ts` — `parseUnresolvedWithin`.
- `test/access-intent/bash/program.test.ts` — new marker cases, **plus** its existing `describe("an unparsed ERROR node (#742)")` block (three `it`/`it.each` cases asserting exact `BashCommand[]` literals via `.toEqual`, around line 1283) and the `"emits an unterminated control-flow statement whole"` case, whose inputs are exactly the non-container-with-`hasError` shape the marker now tags.
  Their literals gain the field.
  Found by the Tidy-First assessor; this file was not in the change's originally listed targets.
- `test/handlers/gates/bash-command.test.ts` — a new `describe` for the floor.
- `test/handlers/gates/bash-command-metamorphic.test.ts` — the completeness invariant and the end-to-end verdict table.
- `test/handlers/gates/runner.test.ts` — the fourth sentinel in the yolo table (existing rows at 154–219), and the session fast-path row.
- `test/bash-advisory-check.test.ts` — advisory parity for the reported command.
- `test/presentation/agent-renderer.test.ts` — the sentinel list at 127–129 gains the fourth entry.

### Docs

Greps run to build this list: `<unparseable-bash-command>` / `<opaque-bash-wrapper>` / `<indirection-bash-wrapper>` across `src/`, `test/`, `docs/`, `README.md`, and `.pi/skills/`; `parseUnresolvedAt` / `hasError` / `previousSibling` across `src/`, `docs/`, and `.pi/skills/`; `command-enumeration.ts` and `unparsed` across `architecture.md`.

- `docs/configuration.md` — a bullet in "Fail-closed behavior" (after the `<unparseable-bash-command>` bullet), and the closing "Every synthetic `ask` above — the unparseable sentinel and both wrapper floors" paragraph, which enumerates the sentinels and must gain the fourth.
- `README.md` — the "Fails closed" bullet (line 22), which names the unparseable case and the wrapper floors.
- `.pi/skills/package-pi-permission-system/SKILL.md` — the `parseUnresolvedAt` sole-reader sentence (line 54) and the fail-closed paragraph naming the sentinels (lines 335–336).
- `docs/decisions/0013-permission-policy-model.md` — a new dated amendment.
  The 2026-08-29 amendment's claim that "the unparsed blob is now a first-class unit that a permissive fallback allows" is measurably false for the population that runs, and the "one part of §10 still unwritten" sentence is now stale.
  The amendment records the measurement, the corrected mechanism, and the enumeration residual ([#875]).
- `docs/architecture/architecture.md` —
  - module-tree entry for `parser.ts` (line 847), whose Constraint sentence asserts no other module reads `hasError`;
  - module-tree entry for `command-enumeration.ts` (line 853);
  - module-tree entry for `bash-command.ts` (line 882);
  - the narrative claims at lines 1042 and 1233 that the unparsed blob is a first-class unit and §10's clause is unwritten;
  - Step 14: `✅` on the heading and on the Mermaid node `S14` (line 1584), corrected `Target:`/`Outcome:` lines, and a `Landed:` note recording that the roadmap's Target named a trigger condition that fires zero times on real input.

No health-metric row names this step; its metric lives only in the step's `Outcome:` line.
Baseline verified this session: `grep -c '<unparsed' packages/pi-permission-system/src/handlers/gates/bash-command.ts` is **0** (`<unparseable-` does not match `<unparsed`).
Predicted post-change value: **2** (the constant and its use).

## Test Impact Analysis

- **New tests the change enables.**
  The enumerator has no direct test file today — nothing in `test/` imports `collectCommands`; it is exercised through `BashProgram` (`program.test.ts`) and `parseBashCommandsSync` (`sync-commands.test.ts`).
  This change does not create one; the marker is asserted through `BashProgram.commands()`, where the `#742` cases already live, so the marker and the `#742` invariant are pinned by the same literals.
- **Tests that become redundant.**
  None.
  The `#742` block still pins "emitted whole, never descended"; it gains a field and loses no assertion.
- **Tests that must stay as-is.** `test/access-intent/bash/redirect-analysis.test.ts` — the new predicate must not change `parseUnresolvedAt`'s answers or its callers'.
- **Parser/matcher input domain.**
  The change reads a parse property rather than parsing, but its *coverage* is a claim about the walk, so the input domain is real inputs rather than the ones I can picture.
  TDD step 4 runs the invariant over a table drawn from the corpus shapes measured this session: the two real errored commands, the four malformed families (`echo 'unbalanced`, `if true; then echo hi`, `for f in a b; do echo $f`, `{ echo hi`), the two [#814] shapes (`cat <> rw.txt`, `cat $(( > out.txt`), and a clean control set.

## Invariants at risk

| Invariant                                                                            | Refs           | Pinned by                                                     | Risk                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An `ERROR` node is emitted whole and never descended                                 | [#742]         | `program.test.ts` `describe("an unparsed ERROR node (#742)")` | this change edits those literals; the descent assertion (`taking nothing from inside it`) must survive verbatim                                                                               |
| A non-empty zero-unit parse fails closed to `<unparseable-bash-command>`             | [#452]         | `bash-command.test.ts:137`                                    | untouched branch; the new floor is per-unit and cannot reach it                                                                                                                               |
| An explicit whole-command `deny` is not masked into an approvable ask                | [#712]         | `bash-command.test.ts`                                        | untouched                                                                                                                                                                                     |
| A wrapper's `allow` floors to `<opaque-bash-wrapper>` / `<indirection-bash-wrapper>` | [#481], [#490] | `bash-command.test.ts:226,289,312`                            | the new floor runs after the wrapper floor and only on `allow`, so a wrapper unit already at `ask` is untouched                                                                               |
| A transparent wrapper resolves by its inner command's rule                           | [#803]         | `bash-command.test.ts:445–520`                                | an exempt unit that is *also* unparsed would floor; no such shape exists in the corpus, and flooring it is the fail-closed direction                                                          |
| An unresolvable redirect proves nothing                                              | [#814]         | `redirect-analysis.test.ts`                                   | the new predicate is additive; `parseUnresolvedAt` is unchanged                                                                                                                               |
| `parser.ts` is the sole reader of `TSNode.hasError`                                  | [#814]         | prose only, in three docs                                     | **add a test**: `test/access-intent/bash/parser.test.ts` asserts `parseUnresolvedWithin`, and the enumerator imports it rather than reading `hasError` — the boundary is otherwise unenforced |
| Every synthetic `ask` is auto-approved under yolo                                    | [#712]         | `runner.test.ts:154–219`                                      | the floor must be synthesized after the resolver returns; a fourth row pins it                                                                                                                |
| The advisory path answers at gate parity                                             | [#309]         | `bash-advisory-check.test.ts`                                 | shares `resolveBashCommandCheck`, so it is free; a row pins it                                                                                                                                |

Quantitative baseline and prediction: `grep -c '<unparsed' src/handlers/gates/bash-command.ts` 0 → 2 (measured / predicted).
Newly-prompting commands over the 5269-command corpus: 0 → 2 (measured baseline, predicted after).

## TDD Order

1. **`refactor(pi-permission-system): extract resolveCommandUnit from the per-unit map`** Tidy-First (Recommended): `resolveBashCommandCheck`'s `commands.map` callback already chains three conditional transforms through renamed intermediates (`base` → `floored` → `result`) plus a trailing ternary, and the new floor needs a fourth *and* the outer `command` string, which the callback only closes over.
   Extract the body into `resolveCommandUnit(cmd, command, agentName, resolver)`, mirroring the existing `resolveWrapperUnit` sibling.
   Pure Extract Function, no behavior change; the existing suite is the gate.
   Must lead — the new floor lands inside the extracted function.

2. **`refactor(pi-permission-system): mark command units emitted from an unresolved parse`** The marker alone changes nothing a user can observe, so it is `refactor:` however new the field is.
   Red: `test/access-intent/bash/parser.test.ts` — `parseUnresolvedWithin` answers `true` for a node with an error in its subtree and `false` otherwise, and does **not** answer `true` for a clean node whose predecessor errored (the clause that separates it from `parseUnresolvedAt`).
   `test/access-intent/bash/program.test.ts` — a new `describe`: the `git commit -F` unit of the reported command carries the marker; `rm -rf /tmp/y` in `echo hi > out.txt <> rw.txt; rm -rf /tmp/y` does not; every unit of a cleanly-parsing chain does not; and the existing `#742` literals gain the field.
   Killing mutations:
   - Make `parseUnresolvedWithin` return `false` unconditionally → every new marker assertion in `program.test.ts` goes red, and the `parser.test.ts` true-case goes red.
   - Drop the `COMMAND_ENUM_DESCEND` exclusion from the entry-point check → the clean-sibling case (`rm -rf /tmp/y`) and the clean-chain case go red, while the marked cases stay green.
   - Have `parseUnresolvedWithin` delegate to `parseUnresolvedAt` → the predecessor case in `parser.test.ts` goes red.

3. **`fix(pi-permission-system): prompt on a bash command whose parse could not be resolved`** The subject names the observable outcome; it ships to the changelog verbatim.
   Red: `test/handlers/gates/bash-command.test.ts`, a new `describe` — a marked unit resolving `allow` floors to `ask` with `matchedPattern: "<unparsed-bash-subtree>"` and `command` equal to the whole command string passed as the first argument; a marked unit with an explicit `deny` stays `deny` with its own pattern; a marked unit with an explicit `ask` keeps its own rule pattern; an unmarked unit's `allow` is untouched; a marked unit whose `allow` carries `source: "session"` keeps `source: "session"` through the floor; a unit that is both a wrapper and marked keeps the wrapper sentinel.
   Killing mutations:
   - Drop the `cmd.parseUnresolved` guard → the unmarked-unit case goes red.
   - Set `command: cmd.text` instead of the parameter → the whole-command blame case goes red (and only that one — this is the mutation the design turns on).
   - Floor `deny` as well as `allow` → the explicit-deny case goes red.
   - Build the floored result from a fresh object literal instead of spreading `resolved` → the `source: "session"` case goes red.
   - Apply the floor before `resolveWrapperUnit` → the wrapper-and-marked case goes red.

4. **`test(pi-permission-system): pin the fail-closed floor end to end and its completeness invariant`** The mechanism landed in steps 2–3; this step is the table of external facts that verifies it against real parses, and it is deliberately separate so a table defect does not re-review the mechanism.
   Red: `test/handlers/gates/bash-command-metamorphic.test.ts` — over a table of real inputs (the two measured errored commands, the adversarial `… | rm -rf /tmp/x` variant, the four malformed families, the two [#814] shapes, and a clean control set), two properties: (a) whenever the parse reports an error, `BashProgram.parse(...).commands()` is empty or contains at least one marked unit; (b) under a universal `*: allow` resolver, every errored input decides `ask` and every clean input decides `allow`.
   `test/handlers/gates/runner.test.ts` — the fourth sentinel is auto-approved under yolo, and a floored result carrying `source: "session"` takes the session fast path.
   `test/bash-advisory-check.test.ts` — the reported command answers `ask` with the new sentinel on the warm advisory path.
   `test/presentation/agent-renderer.test.ts` — the sentinel renders in the refusal text like its three siblings.
   Killing mutation: restrict the enumerator's entry-point check to `node.type === "ERROR"` — the roadmap's original Target.
   The two `git commit -F` rows and the adversarial row go red; every malformed row stays green.
   That is the exact discrimination this issue turns on, and no other test in the plan makes it.

5. **`docs(pi-permission-system): record the fail-closed floor for an unresolved bash parse`** Every file in Module-Level Changes § Docs, in one commit: `docs/configuration.md`, `README.md`, the package skill, the ADR 0013 amendment, and `architecture.md` (module-tree entries, the two stale narrative claims, Step 14's `✅` marks on both the heading and the Mermaid node, its corrected `Target:`/`Outcome:`, and its `Landed:` note).
   Verify: `pnpm exec rumdl check` on each edited markdown file, and `grep -c '<unparsed' src/handlers/gates/bash-command.ts` reports 2.

## Risks and Mitigations

- **The marker's coverage is an argument about the walk, not a proof.**
  Unlike a program-level `rootNode.hasError` boolean, a per-statement marker is complete only if every errored parse leaves at least one marked unit or none at all.
  Mitigated by TDD step 4's property (a), run over real inputs rather than invented ones.
  If a shape is found where the parse errored and every unit is clean, the fallback is the program-level trigger, which costs a `BashProgram` accessor, a `parseBashCommandsSync` return-shape change, and a new `resolveBashCommandCheck` parameter.
- **A transparent wrapper ([#803]) that is also unparsed loses its exemption.**
  The floor runs after `resolveWrapperUnit`, so an exempt unit resolved by its inner command's `allow` would then be floored.
  That is the fail-closed direction and no such shape appears in the corpus, but it is a real narrowing of [#803]'s relief and the plan states it rather than discovering it.
- **The session exemption rests on a spread.**
  `{ ...resolved, ... }` is what carries `source: "session"` to the runner's fast path, and nothing in the type system says so.
  Mitigated by the named mutation in step 3 and the runner row in step 4.
- **The `#742` test literals are the marker's regression witness.**
  Adding `parseUnresolved: true` to a `.toEqual` literal is exactly the edit that silently absorbs a wrong marker placement.
  Mitigated because those cases are `.toEqual` on the full array, not `toMatchObject` — a marker on the wrong unit fails.
- **`docs/configuration.md`'s sentinel enumeration is prose with no parity test**, unlike the `PURE_READER_CORE` roster.
  Mitigated only by listing it explicitly in Module-Level Changes.

## Open Questions

- Whether the enumeration residual ([#875]) is ever fixable in-repo, or waits on `tree-sitter-bash`.
  Deferred to a later phase with recorded rationale; nothing decays while waiting, because after this change a human sees the whole command line including the text the parse dropped.
- Whether ADR 0013 §10's `ask` verdict for an unhandled node should ever become `deny`.
  Not reopened here — the record says `ask`, and 2 in 5269 real commands would be blocked with no approval path.

[#309]: https://github.com/gotgenes/pi-packages/issues/309
[#452]: https://github.com/gotgenes/pi-packages/issues/452
[#481]: https://github.com/gotgenes/pi-packages/issues/481
[#490]: https://github.com/gotgenes/pi-packages/issues/490
[#712]: https://github.com/gotgenes/pi-packages/issues/712
[#742]: https://github.com/gotgenes/pi-packages/issues/742
[#803]: https://github.com/gotgenes/pi-packages/issues/803
[#804]: https://github.com/gotgenes/pi-packages/issues/804
[#814]: https://github.com/gotgenes/pi-packages/issues/814
[#821]: https://github.com/gotgenes/pi-packages/issues/821
[#839]: https://github.com/gotgenes/pi-packages/issues/839
[#875]: https://github.com/gotgenes/pi-packages/issues/875
