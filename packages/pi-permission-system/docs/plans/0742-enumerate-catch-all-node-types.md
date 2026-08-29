---
issue: 742
issue_title: "pi-permission-system: commands inside control-flow bodies, declarations, and test commands are not enumerated against the bash rules"
---

# Enumerate commands in every catch-all node type

## Release Recommendation

**Release:** ship independently

Issue [#742] is Phase 14 Step 4 of the `pi-permission-system` improvement roadmap, and that step carries `Release: independent`.
The roadmap's `Release batches` subsection lists Step 4 under "Independently releasable: Step 4 (`fix:`)", outside the `capability-axis` batch, so this cuts its own release rather than waiting on a batch tail.

## Problem Statement

`collectCommandsInto` (`src/access-intent/bash/command-enumeration.ts`) ends with a catch-all that emits any other named node's whole text as one command unit and never descends into it.
Every command inside an `if` / `while` / `for` / `case` body, a function definition, `local` / `export` / `declare`, `[[ … ]]`, `[ … ]`, `unset`, or a bare `X=$(…)` is therefore matched against the `bash:` rules only as part of the enclosing string.

```text
"if true; then rm y; fi"  =>  [{"text":"if true; then rm y; fi"}]
"local x=$(rm y)"         =>  [{"text":"local x=$(rm y)"}]
"[[ $(rm x) ]]"           =>  [{"text":"[[ $(rm x) ]]"}]
```

An `rm *` deny never fires; the unit falls through to whatever matches the whole compound text, in practice the universal `*`.

This is the last member of the [#306] / [#741] nested-command bypass family.
[#306] deferred control-flow bodies explicitly; [#741] closed redirect targets and heredoc bodies and kept the deferral; [#741]'s pre-completion review then widened this issue with the measured `declaration_command` / `test_command` / `unset_command` / `variable_assignment` table.

ADR 0013 §10 recasts the family as combinator clauses of a recursive verdict fold rather than a series of patches, and names the clause this change writes: *subshell, substitution, heredoc-hosted command — child verdicts propagate up*, extended here to the statement node types.

The path surface has a matching hole in one position.
`collectCommandTokens` skips a `command` node's `command_name` and `variable_assignment` children without searching them for hosted executions, so a substitution in **command-name position** projects no path candidate at all — the `while`-condition shape the issue names as missing both surfaces.

## Goals

- Every command inside a control-flow body or condition, a function definition, or a `{ … }` brace group is enumerated as its own `BashCommand`, in addition to the enclosing statement.
- Every nested execution hosted by a `declaration_command`, `variable_assignment`, `test_command`, or `unset_command` is enumerated, in addition to the enclosing statement.
- A substitution in `command_name` or assignment-prefix position projects its operands onto `path` / `external_directory`, matching every other position (ADR 0009's positional-invariance guarantee).
- The [#306] never-weaker invariant holds unchanged: the enclosing statement is still emitted whole, so more units can only ever produce a more restrictive decision.
- Non-breaking (`fix:`, not `fix!:`).
  Measured against 4276 intact bash commands from the local permission review log: 189 (4.4%) gain command units, and **0** change their `pathRuleCandidates()` or `externalAccesses()`.
  Of the 829 added units, five carry an indirection or opaque wrapper head (`time pnpm run test`, `eval "$c"`, two `xargs …`, one `env -i … zsh -f …`), and those are the only ones that change a decision under the operator's own configured policy — all `allow` → `ask` through the pre-existing wrapper floor.
  None newly deny, and no user needs to edit config.

## Non-Goals

- **A `BashCommandContext` variant for control-flow bodies.**
  A control-flow body runs in the current shell, so it has no distinct execution context to name.
  `BashCommandContext` is a closed enum validated by `BASH_COMMAND_CONTEXTS` in `asPromptPayload` — the tolerant reader a serving node uses on a forwarded request read off disk — so an unknown value makes an older node reject the whole payload (ADR 0012).
  The "why is the gate showing me this fragment" question is served today by the `full command` evidence line (`fullCommandEvidence`, `src/presentation/tool-ask-payload.ts`) and properly by ADR 0013 §10's blame propagation, which the roadmap schedules as a Phase 15 slice.
  Operator decision at the planning gate.
- **Descending an `ERROR` node.**
  Tree-sitter's error recovery *invents* structure, so the node types inside an `ERROR` subtree are not evidence.
  Measured: descending them turns backtick-quoted prose into command units named `ModelRegistry`, `registerProvider`, `unregisterProvider`, `pickAnthropicStreamSimple`, `biome`, `eslint`, `rumdl`, `actionlint` — so a plan mentioning `` `rm -rf node_modules` `` would deny the command writing it.
  This change makes today's emit-whole behavior an explicit branch instead.
- **ADR 0013 §10's fail-closed clause for an unhandled node type.**
  A partial parse failure emits the unparsed blob as an ordinary unit that a permissive fallback allows.
  Flooring it needs a marker on `BashCommand` plus a sentinel in `bash-command.ts` — the verdict fold's behavior, not the enumerator's.
  Filed as [#840] and adopted as Phase 14 Step 14 by operator decision.
- **Statement operand words on the path surface.**
  `for f in /etc/shadow`, `select f in /etc/shadow`, and `case /etc/shadow in` name a path that reaches neither `path` nor `external_directory`, because the collector reads text only from `command` and `file_redirect` nodes.
  Unlike everything in this plan, closing it produces new prompts: 17 of 4401 log commands carry a path-shaped `for`/`case` operand and several resolve outside the working directory.
  Filed as [#839] and deferred to Phase 15 beside [#609].
- **Folding a redirect into the enclosing unit's matched text.**
  [#741] measured 45% of real commands carrying a redirect and put this in its own Non-Goals; unchanged here.
- **Effective-cwd folding inside control-flow bodies.**
  `BashPathResolver.walkForCandidates`'s `default` branch deliberately collects a control-flow subtree's tokens without folding its internal `cd`s.
  That is a separate walk from command enumeration and is untouched.

## Background

### The two walks

The bash sub-domain runs two independent walks over one parse tree, both driven from `BashProgram.parse`:

- `collectCommands` (`command-enumeration.ts`) → the command units matched against `bash:` rules.
- `BashPathResolver.resolve` (`bash-path-resolver.ts`) → `pathRuleCandidates()` and `externalAccesses()`, via `collectPathCandidateTokens` (`token-collection.ts`).

`nested-execution.ts` is the vocabulary they share, added by [#741] so the two cannot disagree about what counts as a nested execution: `NESTED_EXECUTION_CONTEXTS` (substitution node type → `BashCommandContext`), `EXECUTION_HOST_TYPES` (redirects and heredoc bodies — not commands, but able to host one), and `forEachNestedExecution(node, visit)`, which searches **strictly within** a subtree and does not descend past a context it finds.

That strictness is load-bearing and was learned the hard way in [#741]: a substitution that **is** the node handed in (`> $(cmd)`) is not found by it, only one nested inside (`> ${DIR}/$(cmd)`).
`token-collection.ts`'s private `collectHostedExecutionTokens` compensates with an inline `NESTED_EXECUTION_CONTEXTS.has(node.type)` check.
This change needs the identical question in the enumerator, which is why the first step gives it one owner.

### Measured node-type population

Every node type reaching the enumerator's catch-all, across 4401 deduplicated bash commands from the local permission review log at `21283cb5`:

| Node type                        | Commands |
| -------------------------------- | -------- |
| `for_statement` (also `select`)  | 113      |
| `ERROR`                          | 110      |
| `variable_assignment`            | 99       |
| `declaration_command`            | 21       |
| `compound_statement`             | 18       |
| `while_statement` (also `until`) | 8        |
| `function_definition`            | 6        |
| `if_statement`                   | 5        |
| `test_command`                   | 2        |
| `case_statement`                 | 1        |

The `ERROR` row is an artifact of the instrument, not of real traffic.
`writeLine` caps every review-log string at `reviewLogFieldMaxWidth` (1000), so a long heredoc is stored without its terminator and re-parses as garbage: 110 of the 111 `ERROR` commands are truncated log entries.
Excluding them leaves **1 `ERROR` command in 4276 intact ones**, and its units are identical before and after this change.

### External facts about the parser, verified

Probed directly against the installed `tree-sitter-bash` 0.25.1 (npm's latest, so no upgrade lever exists):

| Input                                                    | Parses?   |
| -------------------------------------------------------- | --------- |
| `echo "hi` / `echo 'hi` (unbalanced quote)               | ERROR     |
| `{ echo hi;` (unbalanced brace group)                    | ERROR     |
| `cat <<'EOF'` + body, no terminator                      | ERROR     |
| `if true; then rm y` (no `fi`)                           | ERROR     |
| `for f in a; do rm $f` (no `done`)                       | ERROR     |
| `echo Co-authored-by: A <a@b.net>` (bare angle brackets) | ERROR     |
| `( echo hi` (unbalanced paren)                           | ok        |
| `cat <<'EOF'` + body + `EOF`, no trailing newline        | ok        |
| `git commit -F - <<'MSG' \| tail -4`                     | ok        |
| `git commit -F - <<'MSG' 2>&1`                           | ok        |
| `git commit -F - <<'MSG' 2>&1 \| tail -4`                | **ERROR** |

The last row is the one intact `ERROR` command in the review log, and it is valid bash — a heredoc combined with `2>&1` *and* a pipe is a grammar gap, though each pairing alone parses.
So `ERROR` is usually malformed input but not always, which is precisely why the recovered structure inside one must not be gated on.

Also verified: `select` parses as `for_statement` and `until` as `while_statement`, so each pair is one branch.
A quoted heredoc delimiter still needs no handling — tree-sitter emits a `command_substitution` under `heredoc_body` only for a bare `<<EOF` ([#741]).

### Constraints from AGENTS.md and the package skill

- The two questions "is this node a command?"
  and "can this node host one?"
  are answered by separate sets; conflating them is the bypass [#741] fixed.
  This change adds a third question — "is this node a *statement*, so that descending an enclosing compound reaches it?"
  — and gives it its own set rather than widening either existing one.
- A mid-plan commit must be correct on its own, not just at the end ([#741]'s near-miss on `COMMAND_ENUM_SKIP`).
  The `ERROR` branch must therefore land in the **same commit** as the catch-all's hosted-execution descent, or `ERROR` falls through to a descending catch-all for one commit.
- `docs/architecture/architecture.md` module-tree entries describe current behavior; cite an issue only where the ref encodes an active constraint.
- The roadmap step's `Outcome:` names a metric — `grep -c 'collectHostedCommands'` in the enumerator, 3 → ≥ 4 — and the health-metrics table's `Baseline (2026-08-24)` column is a fixed phase-open snapshot that must not be edited.

## Design Overview

### The enumerator gains a third question

`collectCommandsInto` today asks two questions of a node and dispatches on the answers.
It gains a third, expressed as three new sets beside `COMMAND_ENUM_DESCEND` and `COMMAND_ENUM_SKIP`:

```typescript
/** Compound statements: emitted whole, then descended for their statements. */
const COMPOUND_STATEMENT_TYPES = new Set([
  "if_statement",
  "while_statement", // also `until`
  "for_statement", // also `select`
  "c_style_for_statement",
  "case_statement",
  "function_definition",
  "compound_statement",
  "negated_command",
]);

/** Syntactic groupings inside a compound: descended, never emitted. */
const STATEMENT_GROUP_TYPES = new Set([
  "do_group",
  "case_item",
  "elif_clause",
  "else_clause",
]);

/** Every node type the enumerator recognizes as a statement. */
const STATEMENT_TYPES = new Set([
  "command",
  "redirected_statement",
  "subshell",
  "declaration_command",
  "variable_assignment",
  "test_command",
  "unset_command",
  "ERROR",
  ...COMMAND_ENUM_DESCEND,
  ...COMPOUND_STATEMENT_TYPES,
  ...STATEMENT_GROUP_TYPES,
]);
```

The dispatch gains three branches ahead of the catch-all, and the catch-all itself gains one call:

```typescript
if (COMPOUND_STATEMENT_TYPES.has(node.type)) {
  out.push(makeUnit(node.text, scope)); // never-weaker whole emit
  descendStatementChildren(node, scope, out);
  return;
}

if (STATEMENT_GROUP_TYPES.has(node.type)) {
  descendStatementChildren(node, scope, out);
  return;
}

if (node.type === "ERROR") {
  out.push(makeUnit(node.text, scope)); // recovered structure is not evidence
  return;
}

// Any other named statement: emit whole, and descend for the executions it
// hosts (`local x=$(rm y)`, `[[ $(rm x) ]]`, `unset $(rm x)`, `X=$(rm q)`).
out.push(makeUnit(node.text, scope));
collectHostedCommands(node, out);
```

### Why the descent is filtered

A compound statement's named children are a mix.
`for_statement` carries `variable_name "pkg"` and its word list; `case_statement` carries its subject; `function_definition` carries its name word.
Descending everything emits those as bash command units — measured on real traffic, `pkg`, `pi-colgrep`, `norm`, `/tmp/ca-health.json` and 200 more.
They match nothing but the universal fallback, so they cannot weaken a decision, but a prompt naming `pi-colgrep` as the offending *command* is wrong on its face.

`descendStatementChildren` is therefore the filtered descent, and it is the whole difference between the two:

```typescript
function descendStatementChildren(
  node: TSNode,
  scope: UnitScope,
  out: BashCommand[],
): void {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child?.isNamed) continue;
    if (STATEMENT_TYPES.has(child.type)) collectCommandsInto(child, scope, out);
    else collectHostedCommands(child, out);
  }
}
```

The `else` is not a fallthrough: `for f in $(rm x); do …` hosts a real execution in the word list, and that branch is what reaches it.

`descendCommandChildren` keeps its unfiltered semantics for `program` / `list` / `pipeline` / `redirected_statement` / `subshell`, whose named children are all statements.
That is what preserves today's emit-whole fallback for an unrecognized node type at the top level, `ERROR` among them.

### `UnitScope` is relayed unchanged

A compound statement descends with the **enclosing** scope, not a fresh one.
This matters for [#803]: `redirectedScope` marks `writesViaRedirect` on a `redirected_statement`, and `isTransparentWrapper` reads it to withhold a wrapper's floor exemption.
So in `if true; then xargs grep -l x; fi > out.txt` the inner wrapper unit inherits the write and keeps its floor — over-attributing is the fail-closed direction, exactly as [#803] documented.
Only `collectHostedCommands` starts a fresh scope, because a nested execution's redirect is its own ([#807]).

### One owner for "is, or merely contains, a nested execution"

`forEachNestedExecution` searches strictly within a subtree.
Both surfaces now need the root-inclusive form, so it gets a named owner beside it rather than a second inline check:

```typescript
export function forEachExecutionIn(
  node: TSNode,
  visit: (contextNode: TSNode, context: BashCommandContext) => void,
): void {
  const context = NESTED_EXECUTION_CONTEXTS.get(node.type);
  if (context) visit(node, context);
  else forEachNestedExecution(node, visit);
}
```

`collectHostedCommands` and `collectHostedExecutionTokens` both delegate to it.
Changing the shared traversal's own semantics was considered and rejected in [#741] for the same reason it is rejected here: `forEachNestedExecution`'s strictness is what lets a visitor decide how to treat a context's interior.

### The path surface, in command-name position

`collectCommandTokens` dispatches a `command` node to one of two walkers, and both `continue` past `command_name` and `variable_assignment` without reading them.
For an ordinary command that is right — the head word is not an operand, and an env-var prefix's value is not accessed.
But either child can **host** an execution that really runs, and its operands are candidates:

| Command                                     | Before            | After             |
| ------------------------------------------- | ----------------- | ----------------- |
| `$(cat /etc/shadow)`                        | `[]`              | `["/etc/shadow"]` |
| `` `cat /etc/shadow` ``                     | `[]`              | `["/etc/shadow"]` |
| `while $(cat /etc/shadow); do echo a; done` | `[]`              | `["/etc/shadow"]` |
| `if $(cat /etc/shadow); then echo a; fi`    | `[]`              | `["/etc/shadow"]` |
| `until $(cat /etc/shadow); do echo a; done` | `[]`              | `["/etc/shadow"]` |
| `FOO=$(cat /etc/shadow) echo hi`            | `[]`              | `["/etc/shadow"]` |
| `echo $(cat /etc/shadow)`                   | `["/etc/shadow"]` | `["/etc/shadow"]` |
| `FOO=/etc/shadow echo hi`                   | `[]`              | `[]`              |

The last two rows are the guarantee and the boundary: an argument-position substitution already worked, and a prefix assignment's *literal* value is not an access and stays out.

Both skip sites gain `tokens.push(...collectHostedExecutionTokens(child))`.
The two walkers are different state machines — `collectGenericCommandTokens` sets `seenCommandName` on the `command_name` branch, `collectPatternCommandTokens` combines both types in one test — so the fix lands twice by nature; a shared `COMMAND_PREFIX_TYPES` set names the question once so the two sites do not drift.

A pattern-first command cannot itself have a substitution head (`extractCommandName` would not resolve it to a table entry), but it can carry a prefix assignment, so both walkers need it.

## Module-Level Changes

### `src/access-intent/bash/nested-execution.ts`

- Add exported `forEachExecutionIn(node, visit)` beside `forEachNestedExecution`, documented against it: this one answers "is, or merely contains, a context", the other searches strictly within.

### `src/access-intent/bash/command-enumeration.ts`

- Import `forEachExecutionIn` in place of `forEachNestedExecution`; `collectHostedCommands` delegates to it.
- Add `COMPOUND_STATEMENT_TYPES`, `STATEMENT_GROUP_TYPES`, `STATEMENT_TYPES` beside the existing two sets, under a `── Node-type vocabulary ──` sub-heading so five documented sets stay scannable.
- Add the compound-statement, statement-group, and `ERROR` branches to `collectCommandsInto`; the catch-all gains `collectHostedCommands`.
- Add private `descendStatementChildren`.
- Update `collectCommands`'s doc comment: control-flow bodies and brace groups are no longer "emitted whole without descending (deferred)".

`grep -c 'collectHostedCommands'` in this file goes 3 → 5, clearing the roadmap step's `≥ 4`; the health-metrics `Baseline` column is a fixed snapshot and is not edited.

### `src/access-intent/bash/token-collection.ts`

- Import `forEachExecutionIn`; `collectHostedExecutionTokens` collapses onto it and drops its inline `NESTED_EXECUTION_CONTEXTS.has` check (that import becomes unused and is removed).
- Add a `COMMAND_PREFIX_TYPES` set naming `command_name` / `variable_assignment`.
- `collectGenericCommandTokens` and `collectPatternCommandTokens` each collect hosted executions from a skipped prefix child.

### `test/access-intent/bash/nested-execution.test.ts`

- New `describe("forEachExecutionIn")`: visits a context node handed in directly; delegates for a non-context node; still does not descend past a context.

### `test/access-intent/bash/program.test.ts`

- New `describe`s under the existing `commands()` block, following its `it.each([[command, enclosing, inner], …])` convention (`commands hosted in a redirect target (#741)` is the model).
- Positive cases per statement type; negative cases for the filtered descent (no `for` word-list entry, no `case` subject, no function name) and for `ERROR`.
- One regression case pinning the [#803] scope relay through a compound statement.
- New `pathRuleCandidates` cases for the command-name and prefix-assignment positions.

### `test/access-intent/bash/token-collection.test.ts`

- Cases for a substitution in command-name and prefix-assignment position at the collector level, using the file's existing `parseCommandNode` / `commandTokens` helpers.

### `docs/architecture/architecture.md`

- Mark Step 4 complete: `✅` on the `#### Step 4` heading and on the `S4` Mermaid node, plus a `Landed:` note.
- Module-tree entries for `nested-execution.ts`, `command-enumeration.ts`, and `token-collection.ts` — current behavior only, with a ref only where it encodes an active constraint.

### `docs/decisions/0013-permission-policy-model.md`

- A §10 amendment recording which combinator clauses now exist, that an `ERROR` node's recovered structure is deliberately not descended and why, and that the unhandled-node fail-closed clause is [#840].

### `docs/decisions/0009-bash-path-projection-completeness-contract.md`

- "What the projection guarantees" gains command-name and prefix-assignment position to its positional-invariance sentence.
- A one-sentence known-gap note for [#839], so the guarantee is not read as covering a `for`/`case` statement operand.
  This is the mirror of [#741]'s lesson: there the ADR's wording was readable as *sanctioning* a gap; here it would be readable as *denying* one.

### `.pi/skills/package-pi-permission-system/SKILL.md`

- The nested-command paragraph gains the statement positions.
- The two-questions paragraph gains the third question and the `ERROR` rule.

## Test Impact Analysis

- **Newly possible:** `forEachExecutionIn` is directly unit-testable in `nested-execution.test.ts`, where the root-inclusive behavior previously lived inside a private function in `token-collection.ts` and could only be reached through a whole-program parse.
- **Newly redundant:** none.
  Nothing here removes a layer; every existing assertion still describes behavior the change preserves.
- **Must stay as-is:** every `commands()` test in `program.test.ts`.
  The prototype passed the full suite — 3699 tests, 0 regressions — and that green run is the never-weaker invariant's strongest evidence, so any test that needs editing is a finding, not a chore.
- **Input domain:** the testable surface is the tree-sitter-bash statement grammar, not the shapes one can picture.
  Every node-type row is verified by parsing a real snippet of that construct rather than by asserting the set's contents, and `select`/`until` are covered as their own rows because they parse as `for_statement`/`while_statement`.

## Invariants at risk

| Invariant                                                                                           | Source | Pinned by                                                                                 |
| --------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| The enclosing statement is always emitted whole, so more units are never weaker                     | [#306] | `program.test.ts` — "keeps the never-weaker invariant: a benign inner command stays"      |
| A redirected statement's unit text excludes its redirect                                            | [#741] | `program.test.ts` — "captures the command of a redirected statement without the redirect" |
| A statement that writes through a redirect withholds the floor exemption from every unit beneath it | [#803] | `program.test.ts` — `describe("a statement that writes through a redirect")`, three cases |
| A nested execution's path tokens carry their own command's effect attribution                       | [#807] | `token-collection.test.ts`, `program.test.ts` effect cases                                |

The [#803] row is the one this change extends into new territory: a compound statement is a fourth kind of node beneath a `redirected_statement`, and its existing three cases cover a command, a pipeline, and a subshell.
Step 4 adds a fourth case rather than relying on the scope relay being obviously correct.

Quantitatively, the two path-surface slices are the invariant with a number: `pathRuleCandidates()` and `externalAccesses()` change on **0** of 4276 intact review-log commands, before and after.
That measurement is taken at the commit under test, not carried forward.

## TDD Order

1. **`refactor:` — name the root-inclusive nested-execution question once.**
   Red: `nested-execution.test.ts` gains `describe("forEachExecutionIn")` — visits a `command_substitution` handed in directly, delegates for a `command` node containing one, does not descend past a context it finds.
   Green: add `forEachExecutionIn`; `collectHostedCommands` and `collectHostedExecutionTokens` delegate to it.
   No behavior change — the enumerator's two existing call sites pass `command` and `EXECUTION_HOST_TYPES` nodes, none of which is a context type.
   Prepares: steps 2–5 all need the root-inclusive form, and step 5 would otherwise add a third copy of the inline check.
   Killing mutation: make `forEachExecutionIn` delegate unconditionally to `forEachNestedExecution` — the direct-context test must go red.
   Verify: full package suite unchanged.
   Commit: `refactor(pi-permission-system): name the root-inclusive nested-execution question once`

2. **`fix:` — gate executions hosted by declarations, assignments, tests, and `unset`.**
   Red: `program.test.ts` cases for `local x=$(rm y)`, `export X=$(rm x)`, `declare x=$(rm y)`, `readonly Y=$(rm z)`, `[[ $(rm x) ]]`, `[ $(rm x) ]`, `unset $(rm x)`, `X=$(rm q)` — each asserting the enclosing unit **and** the inner command tagged `command_substitution`; plus an `ERROR` case asserting the unparsed blob is emitted whole with nothing from inside it.
   Green: the catch-all gains `collectHostedCommands`; the `ERROR` branch lands in the **same commit**, since without it `ERROR` falls through to the now-descending catch-all.
   Killing mutations: (a) remove `collectHostedCommands` from the catch-all — the eight host cases go red; (b) delete the `ERROR` branch — the `ERROR` case goes red while the eight stay green.
   Verify: full package suite.
   Commit: `fix(pi-permission-system): gate commands hosted by declarations, test commands, and assignments`

3. **`fix:` — descend a compound statement's statement children.**
   Red: `program.test.ts` cases for `for f in a b; do rm $f; done` (body command emitted; `f`, `a`, `b` **not** emitted) and `for f in $(rm x); do echo $f; done` (word-list substitution reached).
   `for_statement` is the one row that exercises both halves of the filter at once, which is why it leads.
   Green: `COMPOUND_STATEMENT_TYPES` (seeded with `for_statement`), `STATEMENT_GROUP_TYPES` (seeded with `do_group`), `STATEMENT_TYPES`, and `descendStatementChildren`.
   Killing mutations: (a) drop the `STATEMENT_TYPES` filter so `descendStatementChildren` recurses into every named child — the "`f`/`a`/`b` not emitted" assertions go red; (b) remove `do_group` from `STATEMENT_GROUP_TYPES` — the body-command assertion goes red and a `do rm $f; done` unit appears; (c) drop the `else` branch — the word-list substitution case goes red.
   Verify: full package suite.
   Commit: `fix(pi-permission-system): gate commands inside a for loop's body and word list`

4. **`fix:` — the remaining compound statement types.**
   Red: one parsed snippet per row — `if`/`elif`/`else`, `until`, `while`, `select`, `c_style_for_statement`, `case` (subject **not** emitted, `case_item` body emitted), `function_definition` (name word **not** emitted), `compound_statement`, `negated_command` — plus `if $(rm x); then …` for a condition-position substitution, and the [#803] regression case `if true; then xargs grep -l x; fi > out.txt` asserting the inner wrapper keeps its floor.
   Each row is written as its own parse rather than as an assertion about the set's contents, because the node-type names are external facts about the grammar.
   Green: complete the three sets.
   Killing mutations: remove any single node type from `COMPOUND_STATEMENT_TYPES` — only that type's row goes red; remove `case_item`/`elif_clause`/`else_clause` from `STATEMENT_GROUP_TYPES` — only the `case` and `if`-with-`elif` rows go red.
   Verify: full package suite; re-measure the review log and confirm 189/4276 changed and 0 path-slice changes.
   Commit: `fix(pi-permission-system): gate commands inside control-flow bodies and function definitions`

5. **`fix:` — project a substitution's operands from command-name position.**
   Red: `token-collection.test.ts` collector-level cases plus `program.test.ts` `pathRuleCandidates` cases for `$(cat /etc/shadow)`, `` `cat /etc/shadow` ``, `while $(cat /etc/shadow); do …`, `FOO=$(cat /etc/shadow) echo hi`, and `FOO=$(cat /etc/shadow) grep -f p x` (the pattern-first walker); plus a negative case pinning `FOO=/etc/shadow echo hi` at `[]`.
   Green: `COMMAND_PREFIX_TYPES` and the two `collectHostedExecutionTokens` calls.
   Killing mutations: (a) remove the `command_name` collection — the substitution-head rows go red; (b) remove the `variable_assignment` collection — the prefix rows go red; (c) collect the prefix child's own *text* rather than its hosted executions — the `FOO=/etc/shadow` negative case goes red.
   Verify: full package suite; `externalAccesses()` and `pathRuleCandidates()` unchanged across the review log.
   Commit: `fix(pi-permission-system): project a command-name substitution's path operands`

6. **`docs:` — roadmap, ADRs, and package skill.**
   Mark Step 4 `✅` (heading, `S4` Mermaid node, `Landed:` note); refresh the three module-tree entries; amend ADR 0013 §10; extend ADR 0009's positional-invariance sentence and add the [#839] known-gap note; update the package skill's two paragraphs.
   Verify: `pnpm run lint`, `pnpm exec rumdl check`, and the Mermaid node renders.
   Commit: `docs(pi-permission-system): record the enumerator's statement combinators`

## Risks and Mitigations

- **A statement node type missing from a set silently does nothing.**
  These are external facts about the tree-sitter-bash grammar, and a typo (`c_style_for` for `c_style_for_statement`) fails invisibly.
  Mitigation: step 4 writes one parsed snippet per row, and step 3 lands the mechanism against a single row first so a later red is a data defect rather than a mechanism defect.
- **The filtered descent drops a statement child the filter does not name.**
  Mitigation: dropping one is never *weaker* — the enclosing compound is still emitted whole — so the failure mode is an unclosed gap, not a bypass, and the negative tests pin what is deliberately excluded.
- **A prompt regression from unit-count growth.**
  Mitigation: measured, not argued — 189/4276 commands gain units, and of the 829 added units only five carry a wrapper head, which is the only decision change under the operator's real policy (`allow` → `ask` via the pre-existing floor).
  The measurement is re-run at step 4 rather than carried forward from planning.
- **A broken intermediate commit.**
  [#741]'s near-miss was exactly this shape.
  Mitigation: the `ERROR` branch is pinned to step 2's commit in the plan text, and every step ends with the full package suite.
- **`ERROR` handling reads as an accepted fail-open.**
  Mitigation: ADR 0013 §10's amendment records the decision and its measurement, and [#840] carries the floor as Phase 14 Step 14.

## Open Questions

None.
The three design questions — `ERROR` handling, path-surface scope, and the `context` tag — were settled at the planning gate with measurements, and their residuals are filed as [#839] and [#840].

[#306]: https://github.com/gotgenes/pi-packages/issues/306
[#609]: https://github.com/gotgenes/pi-packages/issues/609
[#741]: https://github.com/gotgenes/pi-packages/issues/741
[#803]: https://github.com/gotgenes/pi-packages/issues/803
[#807]: https://github.com/gotgenes/pi-packages/issues/807
[#839]: https://github.com/gotgenes/pi-packages/issues/839
[#840]: https://github.com/gotgenes/pi-packages/issues/840
