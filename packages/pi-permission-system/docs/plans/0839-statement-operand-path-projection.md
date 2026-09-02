---
issue: 839
issue_title: "pi-permission-system: a path named as a for/select/case statement operand reaches no path surface"
---

# A path named as a statement's own operand reaches the path surfaces

## Release Recommendation

**Release:** ship independently

This issue is adopted as Phase 14 Step 16 with a `Release: independent` tag (operator decision, recorded in the roadmap's open-issue sweep).
It belongs to no release batch: the capability-axis batch (Steps 1–3) shipped long ago, and this step's relief — a `for`-list path reaching the `external_directory` gate — is immediate and unconditional the moment it lands.
It is a breaking change (`fix!:`), so it wants its own major release rather than riding behind unrelated work.

## Problem Statement

`collectPathCandidateTokens` ([`packages/pi-permission-system/src/access-intent/bash/token-collection.ts`](../../src/access-intent/bash/token-collection.ts)) reads token text only from `command` and `file_redirect` nodes.
Every other node type is descended generically without its own text ever being read.

A path named directly as the operand of a `for`, `select`, or `case` statement is a child of the statement node, not of a `command` node, so it reaches neither the `path` nor the `external_directory` surface.
Verified against a real `tree-sitter-bash` parse at `b68ae447`:

```text
for_statement "for f in /etc/shadow; do cat $f; done"
  'for'
  variable_name "f"
  'in'
  word "/etc/shadow"          <- never read
  ';'
  do_group "do cat $f; done"
    command "cat $f"          <- read, but carries only the unexpanded $f
```

The loop body cannot recover it.
`cat $f` carries only `$f`, which ADR 0009 correctly declines to resolve, so the word list is the sole place the literal appears and nothing gates it.
`for f in ~/other/secret; do cat $f; done` reads a file outside the working directory with no `external_directory` prompt.

The asymmetry is sharpest against the substitution case, which already works: `for f in $(cat /etc/shadow)` projects `/etc/shadow` because the operand belongs to a nested `command`, while the same operand named directly by the statement projects nothing.

`select` parses as `for_statement`, so both spellings are one fix.

## Goals

- A shape-classified token in a `for`/`select` word list reaches the `path` and `external_directory` surfaces exactly as a command operand does, subject to the ordinary classifiers and the existence probe.
- A shape-classified `case` subject does the same.
- The two are one mechanism with two instantiations, not two walkers that can drift apart.
- Every newly collected token carries `UNPROVEN_EFFECT`, so it consults both directional surfaces most-restrictive (ADR 0013 §10's fail-closed base case).
- **This change is breaking.**
  On upgrade, a bash command naming a path-shaped `for`/`select`/`case` operand outside the working directory newly raises an `external_directory` ask where it was previously silent, with no user edit.
  The commits are `fix(pi-permission-system)!:` with `BREAKING CHANGE:` footers.
- The blast radius is measured, and the instrument that produced the number ships with the change.

## Non-Goals

- **`case` patterns.**
  A `case_item`'s pattern words (`a)`, `/etc/*)`) are globs matched against the subject string, not filesystem accesses.
  They stay unread, and a test pins that.
- **The loop variable and a function's own name.**
  `for f in …`'s `variable_name` and `function_definition`'s name are operand words that name no path; they stay unread for the same reason the command enumerator refuses to emit them as command units ([#742]).
- **Resolving `$f` in the loop body.**
  ADR 0009's computed-paths residual is unchanged: the body's `cat $f` still projects nothing, and closing the word list is precisely what makes that acceptable.
- **Glob expansion.**
  `for d in ~/development/pi/pi-*/` is gated by its literal text, not by what the shell expands it to — ADR 0009's accepted glob residual ([#822]), unchanged here.
- **The over-surfacing residual on the `path` surface.**
  Widening projection necessarily admits tokens that are not paths: measured over the local review log, this change adds candidates such as `anomalyco/tap/opencode` (a brew tap name from `for f in oven-sh/bun/bun anomalyco/tap/opencode`) and a whole quoted command string from `for cmd in "grep -c … packages/…/permission-forwarding.ts"`.
  That is the same false-positive class [#859] and [#863] report against the strict classifier, and ADR 0009's layering principle already settles the direction — over-surfacing is recoverable, over-suppression is not.
  Narrowing the classifiers is those issues' work, not this one's.
- **Gating only the `path` surface and not `external_directory`.**
  That variant produces zero new prompts precisely by leaving the reported hole (`for f in ~/other/secret; do cat $f; done`) open, which is the whole issue.
- **`c_style_for_statement`.**
  `for ((i=0; i<3; i++))` carries an arithmetic header with no word list; there is no operand to read.
- **The command surface.**
  `collectCommands` is untouched.
  A `for` statement is already emitted whole and its body descended ([#742]); this change is entirely on the path side.

## Background

### Where the collector stops

`collectPathCandidateTokens` dispatches on node type in a linear if-chain: `command` → `collectCommandTokens`, `file_redirect` → `collectRedirectTokens`, an `EXECUTION_HOST_TYPES` member → `collectHostedExecutionTokens`, a `SKIP_SUBTREE_TYPES` member → nothing, and everything else → a generic descent over all children.
`for_statement` and `case_statement` fall into that generic descent, whose recursion reads no text from a `word` node (a `word` is neither `command` nor `file_redirect`, and it has no children).

`BashPathResolver.walkForCandidates` sends both node types down its `default:` branch, which calls `collectPathCandidateTokens` with the enclosing effective base and does not fold internal `cd`s — so the fix needs no resolver change, and the ordinary `cd`-base, classifier, existence-probe, and dedup machinery applies to the new tokens for free.

### The command surface already answered the sibling question

[#742] taught the enumerator a third question — "is this a *statement*, so descending an enclosing compound reaches it?"
— because a blanket descent of a compound statement's named children emitted `for` word-list entries and `case` subjects as bash **command** units, naming a package as the offending command in a prompt.
The `STATEMENT_TYPES` filter in `command-enumeration.ts` is what excludes them there.

The inverse is tempting and wrong: the non-statement children of a compound are *not* the path operands.
`for f in …`'s `variable_name`, `function_definition`'s name, and a `case_item`'s pattern words are all non-statement children that name no access.
So the path side needs explicit, per-statement-type operand extraction rather than the command side's set, inverted.

### ADR 0009 already names this gap

`docs/decisions/0009-bash-path-projection-completeness-contract.md` records it under "What the projection guarantees" as an explicit exclusion:

> The collector reads text only from `command` and `file_redirect` nodes, so a path named directly as a statement's own word — `for f in /etc/shadow`, `select f in /etc/shadow`, `case /etc/shadow in` — reaches neither surface (this issue).
> That is a known gap, not a covered case.

Closing it moves that paragraph into the guarantees list, which is a change to what the ADR promises and therefore earns a dated amendment (the shape [#821] and [#823] used).

### Measured blast radius

Measured 2026-09-02 by applying the design below as a spike and diffing real `BashProgram.parse` output before and after, over 5191 deduplicated intact bash commands from the local permission review log (truncated entries excluded per the `reviewLogFieldMaxWidth` caveat), session cwd `~/development/pi/pi-packages`:

| Quantity                                                                   | Value                                              |
| -------------------------------------------------------------------------- | -------------------------------------------------- |
| commands whose `pathRuleCandidates()` changes                              | 22 (0.42%)                                         |
| commands whose `externalAccesses()` changes                                | 11 (0.21%)                                         |
| commands that newly prompt or deny under the operator's real global config | 3 (0.058%)                                         |
| commands that stop prompting                                               | 0                                                  |
| `for_statement` nodes in the corpus                                        | 132, contributing 343 argument-typed operand words |
| `case_statement` nodes in the corpus                                       | 1, subject `":$PATH:"` — not path-shaped           |

The three new prompts are `/Users/chris/development/pi` (from `for rel in ../pi ../../pi`), `~/.pi/agent/pi-web-access.json` together with `~/.config/pi-web-access/config.json` (one command), and `~/development/pi/pi-*` (from `for dir in ~/development/pi/pi-*/`).
Everything under `/tmp` is absorbed by that config's `external_directory` allowlist.
The `case` half is zero-cost hardening in this corpus.

For calibration: [#645] shipped `fix!:` for a far larger widening, and [#821] shipped plain `fix:` for 2 newly-surfaced external paths over 3995 commands.
This one sits closer to [#821] in magnitude, and the operator settled the bump as breaking — it changes observable gate behavior on upgrade with no user edit, which is the repo's stated test.

### Constraints from AGENTS.md and the package skill

- The log's `command` field is unredacted but width-capped at 1000 characters with a trailing `…`; a truncated command re-parses as garbage and must be filtered out before any measurement.
- A durable number ships with the instrument that produced it, committed beside the change.
- Node-type names are external facts about the `tree-sitter-bash` grammar, so tests assert against a real parse rather than against a node-type set — the convention `program.test.ts`'s [#742] block already states in a comment.
- The roadmap step's `✅` mark, its Mermaid node, and any stale metric rows land in the implementation doc-update commit, not a deferred ship commit.

## Design Overview

### The two branches

`collectPathCandidateTokens` gains two node-type branches ahead of the `EXECUTION_HOST_TYPES` check:

```typescript
export function collectPathCandidateTokens(node: TSNode): PathToken[] {
  if (node.type === "command") return collectCommandTokens(node);
  if (node.type === "file_redirect") return collectRedirectTokens(node);
  if (node.type === "for_statement")
    return collectStatementOperandTokens(node, "after-in");
  if (node.type === "case_statement")
    return collectStatementOperandTokens(node, "before-in");
  if (EXECUTION_HOST_TYPES.has(node.type)) {
    return collectHostedExecutionTokens(node);
  }
  if (SKIP_SUBTREE_TYPES.has(node.type)) return [];
  // …unchanged generic descent
}
```

### One walker, two instantiations

Both statements partition their children on the anonymous `in` keyword, and each names its operands on one side of it: a `for`/`select` word list follows `in`, and a `case` subject precedes it.
The two are the same question — "read the argument-typed children on the operand side, recurse everything else, search everything for hosted executions" — so they share one private walker parameterized by which side is the operand side, following the precedent `COMMAND_PREFIX_TYPES` sets in `command-enumeration.ts`: name the shared question once rather than spell it twice, so the two cannot drift.

The side is a string union rather than a boolean, so the call sites read as statements about the grammar:

```typescript
/** Which side of a statement's `in` keyword carries its path operands. */
type OperandSide = "before-in" | "after-in";

function collectStatementOperandTokens(
  node: TSNode,
  operandSide: OperandSide,
): PathToken[] {
  const tokens: PathToken[] = [];
  let seenIn = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (!child.isNamed) {
      if (child.type === "in") seenIn = true;
      continue;
    }
    const isOperand =
      (seenIn ? "after-in" : "before-in") === operandSide &&
      ARG_NODE_TYPES.has(child.type);
    if (!isOperand) {
      tokens.push(...collectPathCandidateTokens(child));
      continue;
    }
    tokens.push({ token: resolveNodeText(child), effect: UNPROVEN_EFFECT });
    tokens.push(...collectHostedExecutionTokens(child));
  }
  return tokens;
}
```

Three properties of that loop carry the design, and each is load-bearing:

1. **A non-operand child falls through to the ordinary recursion, not to nothing.**
   This is what keeps `do_group` working: the loop body's commands are reached by `collectPathCandidateTokens`, exactly as today.
   Routing the non-operand side through `collectHostedExecutionTokens` instead would collect only substitution-hosted commands and silently drop every ordinary body command — a regression a `for f in a; do cat /etc/shadow; done` test catches.
2. **An operand-side child outside `ARG_NODE_TYPES` also falls through to the ordinary recursion.**
   A bare `command_substitution` in the word list (`for f in $(cat /etc/shadow)`) is descended for its command exactly as today, so [#741]'s positional-invariance guarantee is preserved rather than re-implemented, and the nested command's tokens keep their own attribution ([#807]) instead of being overwritten with `unproven`.
3. **An operand-side `ARG_NODE_TYPES` child is read *and* searched for hosted executions.**
   A `concatenation` can be both (`for f in $DIR/$(cmd)`), which is the same pairing `collectRedirectTokens` already performs on a redirect destination.

`resolveNodeText` supplies quote removal and the plain `$HOME`/`$PWD` resolution for free, so `for f in "/etc/shadow"` and `for f in $HOME/x` are gated as their literal spellings, consistent with [#694].

### Why the effect is `unproven`

Nothing about a statement operand proves a direction.
No command word owns the token — the `for` keyword is not a program — and no redirect operator names it, so the two proof sources `command-effects.ts` offers both decline.
`UNPROVEN_EFFECT` is the fail-closed base case: the gates consult both directional surfaces most-restrictive, so a `path_read: allow` alone does not silence a `for`-list operand and a `path_write: {"*": "deny"}` read-only posture denies it.

Deriving a direction from the loop body was considered and is not available: the body reaches the token only through `$f`, which ADR 0009 declines to resolve, so any such derivation would be a guess about which body command consumes which list entry.

### What the resolver sees

No change is needed in `bash-path-resolver.ts`.
`walkForCandidates` already routes both node types through its `default:` branch, which tags whatever `collectPathCandidateTokens` returns with the enclosing effective base and does not fold internal `cd`s.
The new tokens therefore inherit, unchanged:

- the `cd`-folded effective base in force at the statement's position, and [#393]'s literal-only treatment under an unknown base;
- both shape classifiers (`classifyTokenAsPathCandidate` for `external_directory`, `classifyTokenAsRuleCandidate` for `path`);
- the existence probe for a bare token ([#645]);
- canonicalization, the outside-cwd boundary decision, and dedup with `mergeTokenEffects`.

A `for`-list token that repeats a path the same command already named folds into the existing entry rather than adding a second prompt row, because the dedup key excludes the effect.

## Module-Level Changes

### Production

- `packages/pi-permission-system/src/access-intent/bash/token-collection.ts`
  - Two new dispatch lines in `collectPathCandidateTokens`.
  - New private `OperandSide` type and `collectStatementOperandTokens` walker, placed in the existing "Private helpers and config" region beside the other collectors, following the file's section-marker convention.
  - The `TokenEffect` import changes from type-only to a value import so `UNPROVEN_EFFECT` can be named.
  - Module doc comment updated: the collector no longer reads text only from command arguments and redirect destinations.

No other `src/` file changes.
`bash-path-resolver.ts`, `command-enumeration.ts`, `nested-execution.ts`, `node-text.ts`, and `token-classification.ts` are read-only context.

### Tests

- `packages/pi-permission-system/test/access-intent/bash/token-collection.test.ts` — a `parseNode(cmd, type)` helper extracted from the duplicated `parseCommandNode` / `parseRedirectNode` wrappers, then a new `describe("statement operands (#839)")` block.
- `packages/pi-permission-system/test/access-intent/bash/program.test.ts` — new cases under `pathRuleCandidates` and `externalPaths`.
- `packages/pi-permission-system/test/bash-external-directory.test.ts` — a new `describe("statement operands (#839)")` sibling pinning the gate-level outcome.

### Instrument

- `packages/pi-permission-system/scripts/measure-statement-operands.mjs` (new) — transcribes the operand extraction and the two shape classifiers, in the style `measure-statement-descent.mjs` establishes and for the reason its header gives, and reports the policy-independent population: intact commands, `for_statement`/`case_statement` node counts, argument-typed operand words, and how many pass each shape classifier.
  Its header records the planning-time before/after slice diff and the policy-evaluated prompt count together with the method that produced them (a spiked `BashProgram` run over the same log, evaluated through `normalizeFlatConfig` + `evaluateAnyValue` against the operator's real global config), so a later reader can falsify rather than argue.

### Documentation

- `packages/pi-permission-system/docs/decisions/0009-bash-path-projection-completeness-contract.md`
  - New dated amendment section, `### Amendment, 2026-09-02 — a statement's own operands are projected`, recording what moved into the guarantees and where the boundary now sits (a `case` pattern, a loop variable, and a function name are still not operands).
  - A new bullet in "What the projection guarantees": a **statement operand** — a `for`/`select` word-list entry or a `case` subject, carrying this issue's reference.
  - The "known gap" paragraph under the positional-invariance note is removed, since it now contradicts the list above it.
- `packages/pi-permission-system/docs/architecture/architecture.md`
  - Module-tree entry for `token-collection.ts` (line ~852): one sentence naming the statement-operand branches and the `in`-partition invariant.
    Per the repo's architecture-doc convention this describes current behavior; the issue ref is carried because the "an operand side falls through to the ordinary recursion" clause is a structural invariant, not provenance.
  - New `#### Step 16: A path named as a statement's own operand reaches the path surfaces` after Step 15, carrying this issue's reference in its heading, in the roadmap's exact step shape (`Cause` lead paragraph, then `Smell` / `Target` / `Outcome` / `Commit type` / `Impact / Risk / Priority`), marked `✅` with a `Landed:` note and a trailing `Release: independent`.
  - Mermaid step-dependency diagram: a new `S16` node with a dashed sequencing edge from `S4` (both touch the statement vocabulary in the same file family; Step 4 landed first, so the edge records the ordering that actually happened).
  - Parallel tracks: Track B extended to name Step 16 beside Steps 4 and 14.
  - Release batches: Step 16 added to the independently-releasable list as `fix!:`.
  - Open-issue sweep dispositions: this issue's bullet rewritten from "deferred to Phase 15 beside [#609]" to its adoption as Step 16 by operator decision, keeping the measurement that motivated the original deferral and recording why the operator overrode it.
  - Health metrics: a new row named "Statement-operand collection in `token-collection.ts`", baseline 0, target ≥ 2, with the recompute command `grep -cE 'for_statement|case_statement' packages/pi-permission-system/src/access-intent/bash/token-collection.ts` added to the list below the table.
    Baseline verified 0 at planning time.
- `.pi/skills/package-pi-permission-system/SKILL.md`
  - The bash-classifier paragraph ("The bash `external_directory` gate only sees tokens that `classifyTokenAsPathCandidate` accepts…") gains a sentence: a `for`/`select` word-list entry and a `case` subject are collected as tokens too, while a `case` pattern and the loop variable are not.
  - The nested-command paragraph (line ~345) is left alone — it describes the command surface's descent, which this change does not touch.

### Greps performed at planning time

- `token-collection` across `docs/`, `README.md`, and `.pi/skills/` — hits at `architecture.md` lines 851, 852, 1046, 1072, 1156, 1539 and `SKILL.md` lines 342, 345, all listed above or deliberately untouched.
- No symbol is removed or renamed, so no consumer or fixture grep is needed.
- No open PR touches `token-collection.ts` (`gh pr list --state open`, checked 2026-09-02).

## Test Impact Analysis

The change adds a collector branch rather than extracting a module, so no existing test becomes redundant and none is removed.

### New tests the change enables

At the collector level (`token-collection.test.ts`), against a real parse:

| Case                                           | Assertion                                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `for f in /etc/shadow; do cat $f; done`        | `/etc/shadow` is collected                                                                            |
| `select f in /etc/shadow; do echo $f; done`    | same, since `select` parses as `for_statement`                                                        |
| `for f in /tmp/a /tmp/b; do echo; done`        | both operands collected, in source order                                                              |
| `for f in "/etc/shadow"; do echo; done`        | quote removal via `resolveNodeText`                                                                   |
| `for f in /etc/shadow; do cat $f; done`        | the loop variable `f` is **not** collected                                                            |
| `for f in a; do cat /etc/shadow; done`         | the body command's operand is still collected                                                         |
| `for f in $(cat /etc/shadow); do echo; done`   | the nested command's operand is collected and keeps its own `read`/`core` attribution, not `unproven` |
| `for f; do cat /etc/shadow; done`              | a word-list-less `for` collects only the body's operands                                              |
| `case /etc/shadow in a) echo b;; esac`         | the subject is collected                                                                              |
| `case $x in /etc/passwd) echo b;; esac`        | the **pattern** is not collected                                                                      |
| `case /etc/shadow in a) cat /etc/hosts;; esac` | the subject and the arm's command operand are both collected                                          |
| any of the above                               | each statement-operand token carries `UNPROVEN_EFFECT`                                                |

At the program level (`program.test.ts`), through `BashProgram.parse`: `pathRuleCandidates()` and `externalAccesses()` for a `for`-list absolute and home-relative operand; an in-cwd relative operand reaching `pathRuleCandidates()` only; and the `cd`-base interaction (`cd /tmp && for f in a.txt; do echo; done` resolves `a.txt` against `/tmp`).

At the gate level (`bash-external-directory.test.ts`): `for f in ~/other/secret; do cat $f; done` produces an `external_directory` ask naming the resolved path, where it previously produced none.

### Tests that must stay as-is

`program.test.ts`'s `describe("commands inside a for loop (#742)")` and `it("leaves a case subject and its patterns unemitted")` exercise `collectCommands`, which this change does not touch.
They are the pins for the invariant that the *command* surface still refuses to emit an operand word as a command unit, and they must keep passing untouched — a green suite there is what proves the two surfaces stayed on opposite sides of the same question.

## Invariants at risk

| Invariant                                                                                                  | Source                                          | Pinned by                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `for` word-list entry, a `case` subject, and a function name are never emitted as bash **command** units | Step 4's `Landed:` note ([#742])                | `program.test.ts`: "emits the body's commands, but not the loop variable or word list"; "leaves a case subject and its patterns unemitted"; "leaves a function's own name unemitted" — all untouched                                                                                          |
| A nested execution's operands are projected wherever the substitution sits, including a `for` word list    | ADR 0009 positional invariance ([#741], [#742]) | **Currently unpinned on the path surface** — `program.test.ts` covers `for f in $(rm x)` only for `commands()`. A new `pathRuleCandidates()` case for `for f in $(cat /etc/shadow)` is added in the same cycle as the mechanism, because the new branch is the first code that could break it |
| A nested command's tokens keep their own command's attribution rather than the enclosing statement's       | [#807]                                          | New effect-attribution case asserting `{ effect: "read", source: "core" }` on `/etc/shadow` in `for f in $(cat /etc/shadow)`, not `unproven`                                                                                                                                                  |
| The loop body's ordinary commands are still walked                                                         | pre-existing generic descent                    | New case `for f in a; do cat /etc/shadow; done` — this is the regression the "non-operand side falls through to the ordinary recursion" property exists to prevent                                                                                                                            |
| A repeated path folds into one prompt entry rather than splitting                                          | [#807] dedup contract                           | Existing dedup tests, plus the design note that the new tokens flow through the unchanged resolver                                                                                                                                                                                            |

The quantitative invariant — how many real commands change behavior — is measured in Background above rather than argued, and the instrument ships with the change so it can be re-run.

## TDD Order

1. **`test:` — extract a node-type-parameterized parse helper.**
   `parseCommandNode` and `parseRedirectNode` in `token-collection.test.ts` are identical but for a literal node type and an error message; the new cases would add a third and fourth near-copy.
   Extract `parseNode(cmd, type)` and make both existing wrappers one-line callers.
   No behavior change; the suite must be green before and after.
   This is the Tidy-First assessor's one recommended preparatory commit, placed here because only the `token-collection.test.ts` step depends on it.
   Commit: `test(pi-permission-system): extract a node-type-parameterized parse helper`.

2. **`fix!:` — a `for`/`select` word-list operand reaches the path surfaces.**
   Red: the `for`/`select` rows of the collector table above, plus the `program.test.ts` `pathRuleCandidates()` / `externalAccesses()` cases, the `cd`-base case, the nested-substitution and effect-attribution cases, and the `bash-external-directory.test.ts` gate case.
   Green: the `for_statement` dispatch line, the `OperandSide` type, and `collectStatementOperandTokens`.
   Killing mutations, one per equivalence class:
   - Delete the `tokens.push({ token: resolveNodeText(child), effect: UNPROVEN_EFFECT })` line — every "operand is collected" test goes red, and nothing else does.
   - Replace the non-operand fall-through `collectPathCandidateTokens(child)` with `collectHostedExecutionTokens(child)` — the `for f in a; do cat /etc/shadow; done` body case goes red while the operand cases stay green.
   - Change the operand-side guard to admit any named child (drop the `ARG_NODE_TYPES.has(child.type)` conjunct) — the `for f in $(cat /etc/shadow)` effect-attribution case goes red, because the substitution's text is then read as a literal token carrying `unproven`.
   - Change `UNPROVEN_EFFECT` to `{ effect: "read", source: "core" }` — the effect assertions go red while the projection assertions stay green.
   `BREAKING CHANGE:` footer: a path-shaped token named as a `for` or `select` word-list operand is now gated by the `path` and `external_directory` surfaces; a command naming such a path outside the working directory newly raises an `external_directory` ask where it was previously silent.
   Commit: `fix(pi-permission-system)!: gate a path named as a for or select loop operand`.

3. **`fix!:` — a `case` subject reaches the path surfaces.**
   The mechanism landed in step 2; this step supplies its second instantiation and the boundary it draws.
   Red: the `case` rows of the collector table, plus a `program.test.ts` case for `case /etc/shadow in a) echo b;; esac`.
   Green: the `case_statement` dispatch line with `"before-in"`.
   Killing mutations:
   - Delete the `case_statement` dispatch line — the `case` subject cases go red, the `for` cases stay green.
   - Change `"before-in"` to `"after-in"` — the "the subject is collected" case goes red **and** the "the pattern is not collected" case goes red, which is the pair that proves the side parameter is doing real work rather than being cosmetic.
   `BREAKING CHANGE:` footer: a path-shaped `case` subject is now gated by the `path` and `external_directory` surfaces.
   Commit: `fix(pi-permission-system)!: gate a path named as a case subject`.

4. **`docs:` — commit the measurement instrument.**
   Add `scripts/measure-statement-operands.mjs` with the header described in Module-Level Changes.
   Verify by running it against the local review log and confirming the reported population matches the numbers this plan cites (132 `for_statement` nodes, 343 argument-typed operand words, 1 `case_statement`), allowing for log growth since planning.
   Commit: `docs(pi-permission-system): commit the instrument behind the statement-operand measurement`.

5. **`docs:` — amend ADR 0009.**
   Add the dated amendment, move the statement-operand case into the guarantees list, and delete the now-contradicted "known gap" paragraph.
   Verify with `pnpm exec rumdl check` on the file and a re-read of the guarantees list for internal consistency.
   Commit: `docs(pi-permission-system): record statement operands as a projection guarantee`.

6. **`docs:` — land the roadmap step and the skill note.**
   `architecture.md`: the Step 16 block with its `✅` marks and `Landed:` note, the Mermaid `S16` node and dashed `S4` edge, the Track B sentence, the Release-batches entry, the rewritten sweep bullet, the module-tree entry for `token-collection.ts`, and the health-metric row plus its recompute command.
   `.pi/skills/package-pi-permission-system/SKILL.md`: the classifier-paragraph sentence.
   Verify: `grep -cE 'for_statement|case_statement' packages/pi-permission-system/src/access-intent/bash/token-collection.ts` reports 2 (the metric row's target), the Mermaid block renders, and `pnpm run lint` is clean.
   Commit: `docs(pi-permission-system): mark Phase 14 Step 16 complete`.

Steps 2 and 3 are the only ones that change behavior; steps 4–6 are documentation and carry no release.

## Risks and Mitigations

| Risk                                                                                                                                          | Mitigation                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The new branch swallows the loop body, so body commands stop being projected — a silent fail-open in the direction the change exists to close | The non-operand fall-through is the ordinary recursion, and the killing mutation for it is named in step 2. The `for f in a; do cat /etc/shadow; done` case is written before the branch exists                                  |
| A substitution in the word list is read as literal text instead of being descended, losing [#741]'s guarantee                                 | The operand-side read is gated on `ARG_NODE_TYPES`, and a `command_substitution` is not a member. Named as a killing mutation, with the effect assertion as the discriminator — the token text alone would look plausible        |
| The `in` keyword is matched by node type and the grammar spells it differently                                                                | Verified against a real parse: tree-sitter-bash emits an anonymous node of type `in` for both statements. The tests parse rather than assert against a node-type set, per the convention `program.test.ts`'s [#742] block states |
| A `for` with no `in` clause (`for f; do …; done`, which iterates `"$@"`) mis-partitions and reads the loop variable                           | `seenIn` stays false for the whole walk, so with `operandSide: "after-in"` nothing is on the operand side and every child falls through to the ordinary recursion — identical to today. Pinned by a test                         |
| The measured prompt count is read as a universal claim                                                                                        | The number is scoped in the plan and in the script header to one corpus, one cwd, and one config, with the method stated. The instrument ships so it can be re-run rather than argued with                                       |
| The change adds false positives on the `path` surface at the same time [#859] and [#863] report false positives on the strict classifier      | Named in Non-Goals with concrete examples from the measurement, and left to those issues. ADR 0009's layering principle already settles the direction                                                                            |

## Open Questions

None blocking.

The classifier-narrowing work that would suppress the new false positives is tracked as [#859] and [#863]; neither is a prerequisite, and neither is made harder by this change — both narrow the shape classifiers, which this change consumes rather than modifies.

[#393]: https://github.com/gotgenes/pi-packages/issues/393
[#609]: https://github.com/gotgenes/pi-packages/issues/609
[#645]: https://github.com/gotgenes/pi-packages/issues/645
[#694]: https://github.com/gotgenes/pi-packages/issues/694
[#741]: https://github.com/gotgenes/pi-packages/issues/741
[#742]: https://github.com/gotgenes/pi-packages/issues/742
[#807]: https://github.com/gotgenes/pi-packages/issues/807
[#821]: https://github.com/gotgenes/pi-packages/issues/821
[#822]: https://github.com/gotgenes/pi-packages/issues/822
[#823]: https://github.com/gotgenes/pi-packages/issues/823
[#859]: https://github.com/gotgenes/pi-packages/issues/859
[#863]: https://github.com/gotgenes/pi-packages/issues/863
