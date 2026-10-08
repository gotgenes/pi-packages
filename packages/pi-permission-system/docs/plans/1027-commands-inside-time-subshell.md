---
issue: 1027
issue_title: "pi-permission-system: commands inside `time ( … )` are not enumerated as units"
---

# The commands inside `time ( … )` are units

## Release Recommendation

**Release:** ship independently

The Phase 15 roadmap step for #1027 carries `Release: independent`, and the `Release batches` subsection lists it among the independently releasable steps (`fix:`), outside the "declared-effects" batch.

## Problem Statement

`tree-sitter-bash` (0.25.1, the latest release) has no `time` keyword.
It parses `time (rm -rf /tmp/x)` as a `command` named `time` whose only argument is a `subshell`, so the enumerator emits one opaque unit for the whole line and never descends the subshell.
The commands inside are not gated on their own rules: a `bash: {"rm *": "deny"}` never reaches the `rm`.
The shape stays fail-closed only because `time` is an indirection wrapper and [#963]'s literal-head guard refuses the `execution-modifier` exemption when the inner head is shell syntax, so every `time ( … )` asks with `<indirection-bash-wrapper>`, and the ask names the whole subshell.
That is 10 asks in the local review log (measured: 10 `permission_request.waiting` entries whose command starts `time (`, 2026-10-08), for example `time (pnpm run lint >/tmp/l.log 2>&1)`.

The path surface has a narrower form of the same gap.
`BashPathResolver` already collects the tokens inside `time ( … )` with each inner command's effect, but walks them as one command's tokens, so a `cd` inside the subshell never folds.
Measured: `time (cd /tmp && cat ./x)` resolves `./x` to `<cwd>/x`, while the bare `(cd /tmp && cat ./x)` resolves it to `/tmp/x`.

## Goals

- Enumerate the commands inside `time ( … )` as units, each in `context: "subshell"`, exactly as a bare `( … )` statement's commands are enumerated, so an inner `deny` reaches them.
- Keep the `time ( … )` unit emitted (the never-weaker whole emit) and give it `floorExemption: "execution-modifier"`, so it resolves by its `executedUnit` text `( … )` the way a bare subshell's whole emit resolves, and an explicit `time *` `deny` or `ask` still decides first (operator decision, option A).
- Walk the subshell of `time ( … )` as a subshell on the path surface: its `cd`s fold within it and reset on exit.
- Non-breaking, per the roadmap step's `Commit type: fix:` and [#963]'s precedent: a permissive config stops asking about a `time ( … )` whose commands it allows, and an inner `deny` now denies where it asked.

## Non-Goals

- `time { …; }`, `time -p ( … )`, `time for …`, `time ! …`, and every other `time` shape the grammar misreads stay floored (fail-closed), filed as [#1043] and deferred to a later phase (operator decision).
  The brace group is split across sibling `command` nodes, so recovering it needs a span re-parse mechanism; the review log holds no `time {` ask (measured: 0 in 23,641 lines).
- A `subshell` argument of any command other than `time` (`sudo (rm x)`, `nice (rm x)`) is not descended.
  Bash rejects those as syntax errors and runs nothing, and only `time` is a keyword that takes a compound command; they keep the indirection floor they have today.
- No change to `wrapper-analysis.ts`'s behavior: its literal-head guard still refuses `(…)` as a head at the word level, which is correct there, since a word list cannot know whether the enumerator descended the subshell.
  The timed-subshell exemption is decided in the enumerator, which does know.
- [#971] (third-party PR, lifting the indirection floor for a rule that pins the inner command) touches the floor's policy, not enumeration; it is unaffected and not a close target.
- [#1042] (`sudo -e` operands) is the next roadmap step, on the `wrapper-analysis.ts` peel; this plan does not touch the peel.

## Background

- `src/access-intent/bash/command-enumeration.ts` — `collectCommandsInto`'s `command` branch pushes `makeCommandUnit(node, scope)` and then `collectHostedCommands(node, scope, out)`, which visits command and process substitutions only.
  `NESTED_EXECUTION_CONTEXTS` deliberately omits `subshell`; the `subshell` branch emits a bare subshell whole and then `descendCommandChildren(node, { ...scope, context: "subshell" }, out)`.
  The private `commandWordNodes` is the word filter (named children minus `variable_assignment` and `REDIRECT_NODE_TYPES`) shared by `readCommandUnit` and `inlineShellPayloadNode`; its doc comment warns that two copies of that filter are how two walks come to disagree.
- `src/access-intent/bash/wrapper-analysis.ts` — `floorExemptionOf` answers `"execution-modifier"` only when the inner head is a literal command name (`onlyModifiesExecution` condition 4), which `(rm …)` is not.
- `src/handlers/gates/bash-command.ts` — `resolveWrapperUnit` resolves an exempt wrapper unit by `resolveOnBashSurface(cmd.executedUnit)`; only a unit whose own text resolved `allow` reaches it, so an explicit `time *` `deny`/`ask` decides before any inner rule is read.
  A bare subshell's whole emit `( … )` is decided by the same `bash` rules, so the exempt `time ( … )` unit is decided exactly as the bare subshell's whole emit.
- `src/access-intent/bash/bash-path-resolver.ts` — `walkForCandidates`' `case "command"` tags `collectCommandTokens(node)` against the incoming base and folds a `cd`; its `case "subshell"` walks the interior as a current-shell sequence and discards the folded base.
- `src/access-intent/bash/nested-execution.ts` — the single vocabulary both bash surfaces share for what counts as a nested execution (#741); it imports only types today.

Measured shapes (`BashProgram.parse` at `7c040366`, spike since deleted):

```text
time (rm -rf /tmp/x)        (command name:"time" (subshell (command …)))
time (rm x) > /tmp/out      (redirected_statement (command name:"time" (subshell …)) (file_redirect …))
2>./err time (rm x)         (command (file_redirect …) name:"time" (subshell …))      ← redirect hosted in the command
A=1 time (rm x)             (command (variable_assignment) name:"time" (subshell …))
"time" (rm x)               (command name:(string "time") (subshell …))                ← quoted: not the keyword
time -p (rm -rf /tmp/x)     (command name:"time" (ERROR "-p") (subshell …))            ← parseUnresolved floor
time (rm x) (ls y)          (ERROR (command "time" (subshell …))) (subshell …)         ← ERROR, emitted whole
```

## Design Overview

### One recognizer, two consumers

`nested-execution.ts` gains `timedSubshellOf(command: TSNode): TSNode | null`.
It returns the `subshell` node when the command's words, from the shared `commandWordNodes` filter, are exactly a `command_name` whose text is `time` followed by one `subshell`; otherwise `null`.

- The text test is on the node's source text, so a quoted `"time"` or an escaped `\time` (neither is the keyword in bash) is not recognized.
- Redirects and assignment prefixes are outside the words, so `2>./err time (rm x)` and `A=1 time (rm x)` are recognized.
  Bash rejects both as syntax errors (a prefix stops `time` being a keyword), so descending them only adds units to a command that never runs, which is the fail-closed direction.
- A `time -p ( … )` or `time ls ( … )` has an `ERROR` word between, so it is not recognized and keeps today's parse-unresolved floor.

`commandWordNodes` moves from `command-enumeration.ts` to `nested-execution.ts` (exported) so the recognizer and the enumerator read one filter.
`nested-execution.ts` then imports `REDIRECT_NODE_TYPES` from `redirect-analysis.ts`; no cycle (checked by reading the import lines: `redirect-analysis.ts` → `command-effects.ts`, `parse-health.ts`, `parser.ts` (type), `#src/access-intent/effect`, `#src/path/safe-system-paths`; `command-effects.ts` → `awk-invocation.ts`, `sed-invocation.ts`, none of which imports `nested-execution.ts`).
Same directory, so `fallow guard` allows the edge.

### Command surface

The `command` branch of `collectCommandsInto`:

```ts
if (node.type === "command") {
  const timed = timedSubshellOf(node);
  out.push(makeCommandUnit(node, scope, timed === null ? undefined : "execution-modifier"));
  if (timed === null) { collectHostedCommands(node, scope, out); return; }
  forEachChildExcept(node, timed, (child) => collectHostedCommands(child, scope, out));
  descendCommandChildren(timed, { ...redirectedScope(node, scope), context: "subshell" }, out);
  return;
}
```

- `makeCommandUnit` gains an explicit floor-exemption override; when given, it replaces `floorExemptionOf`'s answer.
  The `command` branch stays the single site that knows about timed subshells.
- `collectHostedCommands` runs over the command's children **except** the subshell, so a substitution inside the subshell (`time (echo $(rm x))`) is emitted once, by the descent, and one in a hosted redirect (`2>$(rm y) time (rm x)`) is still emitted.
- The subshell's commands run under the command's redirect scope with `context: "subshell"`, as a bare `( … ) > out` does.
- `parseUnresolved` needs no special handling: `unresolvedScope` already marks the command when anything beneath it failed, and `floorUnparsedUnit` floors independently of the exemption.

The resulting units (prototype run, measured):

```text
time (rm -rf /tmp/x)
  { text: "time (rm -rf /tmp/x)", wrapperKind: "indirection", executedUnit: "(rm -rf /tmp/x)", floorExemption: "execution-modifier" }
  { text: "rm -rf /tmp/x", context: "subshell" }
time (pnpm run lint >/tmp/l.log 2>&1)
  { text: "time (pnpm run lint >/tmp/l.log 2>&1)", …, floorExemption: "execution-modifier" }
  { text: "pnpm run lint", context: "subshell" }
```

Decisions under `bash: {"*": "allow", "rm *": "deny"}`:

| Command                                 | Before                                | After                               |
| --------------------------------------- | ------------------------------------- | ----------------------------------- |
| `time (pnpm run lint >/tmp/l.log 2>&1)` | ask (`<indirection-bash-wrapper>`)    | allow                               |
| `time (rm -rf /tmp/x)`                  | ask                                   | deny (inner `rm` unit)              |
| `time (sudo rm x)`                      | ask                                   | ask (inner `sudo` unit's own floor) |
| `time { rm -rf /tmp/x; }`               | ask                                   | ask (unchanged, [#1043])            |
| `time -p (rm x)`                        | ask (`<unparsed-bash-subtree>`/floor) | unchanged                           |
| `sudo (rm x)`                           | ask                                   | unchanged                           |

A `time *: ask` rule keeps `time ( … )` asking, and `time *: deny` denies it, because `resolveCommandUnit` reads the unit's own rule before the wrapper branch.

### Path surface

`walkForCandidates`' `case "command"` checks the recognizer first:

```ts
case "command": {
  const timed = timedSubshellOf(node);
  if (timed !== null) return this.walkTimedSubshell(node, timed, base, out);
  tagTokens(collectCommandTokens(node, this.words), base, out);
  return this.foldCd(node, base);
}
```

`walkTimedSubshell` tags the tokens of each named child other than the `command_name` and the subshell (a hosted redirect such as `2>./err`) through `collectPathCandidateTokens`, walks the subshell with `this.walkForCandidates(timed, base, out)` (whose `subshell` case folds within and discards), and returns `base`: `time` itself is not a `cd`, and a subshell `cd` does not leak.
Effects are unchanged: each inner command's tokens already carry that command's proof today (measured: `cat ./x` inside `time ( … )` is `read`/`core`), and the walk reaches the same `collectCommandTokens` per inner command.

Measured with the prototype:

```text
time (cd /tmp && cat ./x)   ./x → /tmp/x   (was <cwd>/x; matches the bare subshell)
time (cd /tmp) && cat ./x   ./x → <cwd>/x  (unchanged: the subshell's cd does not leak)
```

### Edge cases and the step that tests each

| Edge case                                                   | Behavior                                    | Step |
| ----------------------------------------------------------- | ------------------------------------------- | ---- |
| Substitution inside the subshell                            | emitted once                                | 2    |
| Substitution in a hosted redirect (`2>$(rm y) time (rm x)`) | emitted                                     | 2    |
| Nested `time ( (rm x) )`                                    | inner subshell whole + its command          | 2    |
| `"time" (rm x)`, `sudo (rm x)`, `nice (rm x)`               | not recognized; one floored unit            | 2    |
| `time -p (rm x)`                                            | not recognized; parse-unresolved, unchanged | 2    |
| `time *: ask` / `time *: deny`                              | ask / deny                                  | 2    |
| `cd` inside the subshell                                    | folds for later commands in it              | 3    |
| `cd` inside, command after                                  | does not leak                               | 3    |
| Hosted redirect target `2>./err time (rm x)`                | projected as a write                        | 3    |

## Module-Level Changes

- `src/access-intent/bash/nested-execution.ts` — gains exported `commandWordNodes` (moved, doc comment kept) and `timedSubshellOf`; imports `REDIRECT_NODE_TYPES` from `./redirect-analysis`.
- `src/access-intent/bash/command-enumeration.ts` — imports `commandWordNodes` and `timedSubshellOf`; the `command` branch descends a timed subshell; `makeCommandUnit` takes an optional floor-exemption override; `collectCommands`' doc comment names the `time ( … )` descent; `BashCommand`'s doc unchanged.
- `src/access-intent/bash/bash-path-resolver.ts` — `case "command"` dispatches a timed subshell to a new private `walkTimedSubshell`; the `collectPathCandidates` doc comment gains the shape.
- `src/access-intent/bash/wrapper-analysis.ts` — doc comment only: `onlyModifiesExecution` condition 4's "`time ( … )` reach here with shell syntax" sentence becomes "the enumerator exempts a `time ( … )` whose subshell it descends; the word-level guard still refuses `{` and `(`".
  Behavior predicted unchanged; rests on `wrapper-analysis.test.ts` rows `time { rm -rf /tmp/x; }` / `time (rm -rf /tmp/x)` (word-level `exemptionOf`) staying green.
- `src/handlers/gates/bash-command.ts` — predicted **unchanged**: the exempt unit takes the existing `resolveWrapperUnit` path, and the inner units take the ordinary one (prototype: full suite 5687 passed, 2 failed, both the rows listed below).
- `test/access-intent/bash/nested-execution.test.ts` — `timedSubshellOf` rows.
- `test/access-intent/bash/program.test.ts` — `commands` rows for the timed subshell; the `floor exemption` row `time (rm -rf /tmp/x)` (line ~1498) moves from "does not exempt" to an exempt row; the `time { rm -rf /tmp/x; }` row (~1519) stays, its comment now citing [#1043].
- `test/access-intent/bash/program-external-accesses.test.ts` — `cd` fold rows beside the bare-subshell ones (~795–812).
- `test/access-intent/bash/program.test.ts` `pathRuleCandidates` — hosted-redirect row.
- `test/handlers/gates/bash-command-metamorphic.test.ts` — `time (rm -rf /tmp/x)` leaves the floor list (~409, it now denies); a new describe pins the timed subshell against the bare subshell.
- `test/access-intent/bash/wrapper-analysis.test.ts` — predicted unchanged (word-level).
- `docs/architecture/architecture.md` — the `nested-execution.ts`, `command-enumeration.ts`, `bash-path-resolver.ts`, and `wrapper-analysis.ts` module-tree entries (the last's "so `time { …; }` and `time ( … )` keep the floor (#1027)" constraint becomes "`time { …; }` keeps the floor (#1043); `time ( … )` is exempted by the enumerator, which descends its subshell"); the #1027 step heading and its Mermaid node `S1027` gain `✅`, with a `Landed:` note.
- `docs/decisions/0013-permission-policy-model.md` — the literal-head guard bullet's "The subshell form keeps the floor until its inner commands are enumerated (#1027)" becomes the enumerated, exempted behavior, with `time { …; }` still floored ([#1043]).
- `docs/configuration.md` — item 4 of the execution-modifier list ("`time ( … )` and `time { …; }` stay floored") becomes: `time ( … )` is decided by the commands inside it, `time { …; }` stays floored.
- `.pi/skills/package-pi-permission-system/SKILL.md` — predicted unchanged: its fail-closed sentence names the execution-modifier exemption generically (grepped: no `time (` / `time {` mention).
- `README.md` — predicted unchanged (grepped: no `time (` / `time {` mention).

## Test Impact Analysis

1. New tests the change enables: `timedSubshellOf` is unit-testable over parsed trees; the timed-subshell metamorphic equality (`time (X)` decides as `(X)`) is new.
2. Redundant tests: none; the bare-subshell tests stay as the oracle the timed tests are compared against.
3. Tests that stay as-is: `wrapper-analysis.test.ts`'s word-level `time (rm -rf /tmp/x)` row (the word layer still refuses it), and every other execution-modifier floor row in the metamorphic file.
4. Tests that flip, measured with the prototype: exactly `program.test.ts` "does not exempt the modifier unit of time (rm -rf /tmp/x)" and `bash-command-metamorphic.test.ts` "floors time (rm -rf /tmp/x) rather than resolving a misread inner command" (now `deny`).
   Both are rewritten in step 2, the step that flips them.

## Invariants at risk

| Invariant (source)                                                                      | Constituency       | Pinned by                                                                              |
| --------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------- |
| A modifier-wrapped command decides as the bare one ([#963] Outcome)                     | permissive configs | metamorphic "an execution modifier inherits the verdict" (unchanged rows)              |
| `time sudo rm`, `timeout --sig KILL 5 rm`, `time { …; }` keep the floor ([#963] guards) | everyone           | metamorphic floor list minus the one moved row                                         |
| The whole statement stays emitted beside its inner units ([#306] never-weaker)          | a `time *` rule    | step 2 `toEqual` unit rows + `time *: deny` row                                        |
| A command in a hosted redirect still runs and is enumerated ([#741])                    | deny rules         | step 2 `2>$(rm y) time (rm x)` row                                                     |
| A parse-unresolved statement floors ([#840])                                            | everyone           | step 2 `time -p (rm x)` row                                                            |
| Each asking unit is forwarded with its own floor ([#1029], [#1030])                     | subagent parents   | existing `bash-command.test.ts` asking-unit tests (the inner units are ordinary units) |
| A subshell `cd` resets on exit (#393/#454 fold)                                         | path rules         | step 3 `time ( cd sub ) && cat ../y` row                                               |

## TDD Order

1. **`refactor(pi-permission-system): share the command word filter from nested-execution.ts`** Move `commandWordNodes` from `command-enumeration.ts` to `nested-execution.ts` (export it, keep its doc comment) and import it back; add the `REDIRECT_NODE_TYPES` import.
   Prepares the recognizer: it is the filter's second consumer, and the doc comment forbids a second copy.
   No new tests; `command-enumeration.test.ts` and `program.test.ts` stay green.
   Verify: `pnpm --filter @gotgenes/pi-permission-system exec vitest run test/access-intent/bash && pnpm --filter @gotgenes/pi-permission-system run check`, and `pnpm --silent fallow dead-code` reports no cycle.
   Re-read the moved function against the `code-design` skill before committing.

2. **`fix(pi-permission-system): commands inside time ( … ) are gated on their own rules`**
   Red, then green, in one commit (the recognizer has no consumer without the wiring):
   - `nested-execution.test.ts` — `timedSubshellOf` returns the subshell's text for `time (rm x)`, `time (rm x) > /tmp/out` (on the inner `command`), `2>./err time (rm x)`, `A=1 time (rm x)`; `null` for `"time" (rm x)`, `sudo (rm x)`, `time $(rm x)`, `time -p (rm x)`, `time ls (rm x)`, `time pnpm test`.
   - `program.test.ts` `commands` — full `toEqual` unit lists for `time (rm -rf /tmp/x)`, `time (grep -l foo a | wc -l)`, `time (echo $(rm x))` (`rm x` exactly once), `2>$(rm y) time (rm x)` (`rm y` emitted), `time ( (rm x) )`; `sudo (rm x)` and `nice (rm x)` stay a single unit; `time -p (rm x)` stays a single `parseUnresolved` unit.
   - `program.test.ts` `floor exemption` — move `time (rm -rf /tmp/x)` out of the "does not exempt" table into an exempt row asserting `["execution-modifier", undefined]`; recomment the `time { …; }` row to cite [#1043].
   - `bash-command-metamorphic.test.ts` — remove `time (rm -rf /tmp/x)` from the floor list; new `describe("bash command gate — a timed subshell decides as the bare subshell")`: for the four existing `cases`, `decide(\`time (${bare})\`)` equals `decide(\`(${bare})\`)` equals `state`; `time (rm -rf /tmp/x)` under `makePrefixResolver("rm", "deny")` is `deny`; `time (pnpm run lint >/tmp/l.log 2>&1)` under `makeKeyedResolver([])` is `allow`; `makePrefixResolver("time", "ask")` keeps `time (pnpm test)` at `ask`, and `"deny"` denies it.
   - Green: `timedSubshellOf`; the `command` branch and `makeCommandUnit` override per Design Overview; doc comments on `collectCommands` and `onlyModifiesExecution` condition 4.
   - Killing mutations (one per class):
     - Delete the `descendCommandChildren(timed, …)` call → the unit-list rows and the `rm *` deny metamorphic row go red.
     - Pass `undefined` instead of `"execution-modifier"` to `makeCommandUnit` → the exempt row, the lint-run `allow` row, and the `allow` metamorphic case go red.
     - Call `collectHostedCommands(node, scope, out)` over the whole command → `time (echo $(rm x))` goes red (duplicate `rm x`).
     - Skip `collectHostedCommands` for the non-subshell children → `2>$(rm y) time (rm x)` goes red.
     - Drop the `text === "time"` test in `timedSubshellOf` → `sudo (rm x)`, `nice (rm x)`, `"time" (rm x)` go red.
     - Drop `context: "subshell"` from the descent scope → the unit-list rows go red.
   - Verify: the four test files, then the full package suite (the change touches shared enumeration), then `check`.

3. **`fix(pi-permission-system): a cd inside time ( … ) resolves the paths after it in that subshell`**
   - `program-external-accesses.test.ts`, beside the bare-subshell rows: `time ( cd sub && cat ../x )` has no external access (red today: `/projects/x`); `time ( cd sub ) && cat ../y` names `/projects/y` (invariant pin; green before and after).
   - `program.test.ts` `pathRuleCandidates`: `2>./err time (rm x)` keeps `./err` with the syntax-proven `write` effect.
   - Green: `walkTimedSubshell` and the `case "command"` dispatch.
   - Killing mutations:
     - Delete the timed branch in `case "command"` → the `cd sub && cat ../x` row goes red.
     - Return the subshell walk's folded base instead of `base` (make `walkTimedSubshell` thread the base through a `walkCurrentShellSequence(timed, …)` return) → the `( cd sub ) && cat ../y` pin goes red.
     - Skip the non-subshell children in `walkTimedSubshell` → the `./err` row goes red.
   - Verify: the two files, the full package suite, `check`, `pnpm --silent fallow dead-code`.

4. **`docs(pi-permission-system): document the timed-subshell descent and mark #1027 complete`** The `architecture.md` module-tree entries, the #1027 step `✅` (heading and Mermaid node `S1027`) with its `Landed:` note, ADR 0013's guard bullet, and `docs/configuration.md` item 4, per Module-Level Changes.
   Verify: `pnpm exec rumdl check` on each edited file; grep `docs/` for `keep the floor` / `stay floored` beside `time (` to confirm no stale sentence remains.

## Risks and Mitigations

| Risk                                                                                        | Mitigation                                                                                                                                                       |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The exemption relieves a shape whose inner commands were not all enumerated                 | The exemption is set only when the recognizer matched, which is exactly when the descent runs; `parseUnresolved` floors independently (step 2 `time -p` row).    |
| A substitution inside the subshell is double-counted, listing a unit twice in `askingUnits` | Hosted-command collection excludes the subshell (step 2 mutation 3).                                                                                             |
| Descending a syntax-error shape (`A=1 time (x)`)                                            | Adds units only; bash runs nothing; more-restrictive direction.                                                                                                  |
| The path walk changes effect attribution                                                    | The walk reaches the same `collectCommandTokens` per inner command (measured unchanged effects in the prototype); step 3's `./err` row pins the hosted redirect. |
| Doc drift: three docs state `time ( … )` stays floored                                      | Step 4 names each sentence; grep verification.                                                                                                                   |

## Open Questions

- None blocking.
  Whether `time -p ( … )` deserves recovery is [#1043]'s question.

[#306]: https://github.com/gotgenes/pi-packages/issues/306
[#741]: https://github.com/gotgenes/pi-packages/issues/741
[#840]: https://github.com/gotgenes/pi-packages/issues/840
[#963]: https://github.com/gotgenes/pi-packages/issues/963
[#971]: https://github.com/gotgenes/pi-packages/pull/971
[#1029]: https://github.com/gotgenes/pi-packages/issues/1029
[#1030]: https://github.com/gotgenes/pi-packages/issues/1030
[#1042]: https://github.com/gotgenes/pi-packages/issues/1042
[#1043]: https://github.com/gotgenes/pi-packages/issues/1043
