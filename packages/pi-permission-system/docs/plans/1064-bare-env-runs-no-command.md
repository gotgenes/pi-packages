---
issue: 1064
issue_title: "pi-permission-system: a bare `env` that runs no command should not take the indirection floor"
---

# A bare `env` that runs no command keeps no floor

## Release Recommendation

**Release:** ship independently

Phase 15's roadmap step for this issue is tagged `Release: independent` and belongs to no release batch.
The behavior step is a `fix:` that removes an over-prompt.

## Problem Statement

The indirection floor ([#490]) exists because a wrapper hides the command that should be gated.
`classifyWrapperWords` flags `env` as `"indirection"` by its name alone, and `floorExemptionOf` looks for a reason to lift the floor only in a peeled inner command.
When `env` names no command, there is nothing to hide, but there is also no inner command to prove a read or to inherit a verdict from, so the floor stays.

What the agent and the user see, under `bash: {"*": "allow"}`: the agent runs `env | rg '^PI_'` to inspect its own environment, and the user gets a permission prompt citing `<indirection-bash-wrapper>`, although nothing was wrapped.
`env cat x`, which does run a command, goes through silently as `core-reader`, and `printenv`, which prints the same thing as a bare `env`, goes through by `*`.
`"env": "allow"` does not help, because the floor raises any `allow`.

## Goals

- When the unit's own `env` option walk (`ENV_GRAMMAR`) consumes every word as an option, an option value, a `NAME=value` assignment, `--`, or a lone `-`, and every word is literal, the unit is resolved by its own `bash` rule (`env …` or `*`) instead of the floor.
- The review log records why: `floorExemption: "no-command"`, a third `FloorExemption` member beside `core-reader` and `execution-modifier` (operator decision at the planning gate).
- The "a bare form runs nothing" fact lives on the grammar as a `bareFormRunsNothing` field, `true` only for `env` (operator decision at the planning gate).
- Under `bash: {"*": "allow"}`, `env`, `env | rg '^PI_'`, `env -0`, `env -i`, `env -u FOO`, `env -`, and `env FOO=1` resolve `allow` by `*`, while `env $X`, `env "$X"`, and `env -S 'rm x'` still ask with `<indirection-bash-wrapper>` (the roadmap step's `Outcome:`).
- An explicit `ask` or `deny` on `env` keeps governing.
- Not breaking: `fix(pi-permission-system):`, matching the roadmap's commit type and the [#963] precedent, which turned floored asks into allows.
  No default, config shape, or output shape changes; the review log's `floorExemption` field gains one value.

## Non-Goals

- Declassifying a bare `env` in `classifyWrapperWords`.
  `sessionCommandIndex` would then answer `0`, `suggestBashPattern("env -u FOO")` would widen to `env *` (`bash-arity.ts`'s default arity 1), and a session grant skips the wrapper floor, so `env *` would cover `env rm -rf x`.
  Today the suggestion is the exact command (measured), and this plan keeps it.
- Nested no-command forms (`sudo env`, `time env`, `nohup env`, `timeout 5 env`).
  They keep the floor: the exemption is read off the unit's own (outermost) layer only.
  The local review log holds no ask for any of them (measured: 0 among the 278 `<indirection-bash-wrapper>` waiting entries).
- A bare form of any other wrapper.
  Bare `xargs` runs `echo`; bare `sudo` and `doas` print usage, `sudo -l` lists privileges, and `doas -L` clears persisted authentication, so their grammars set `bareFormRunsNothing: false`.
  The table-read wrappers (`nohup`, `timeout`, `watch`, …) have no grammar and keep the floor.
- `env 'FOO=1'` (a quoted assignment) keeps the floor: the getopt walk reads a word's source text, so a quoted `NAME=value` reads as the command.
  That is the fail-closed direction, and the same reading [#1053] gives `env 'FOO=1' cat x`.
- `env -u` with its value missing keeps the floor: GNU `env` exits 125 there (measured), and the walk overruns the word list rather than ending on it.
- A refusing option with no command (`env -C /tmp`, `env -P /bin`) keeps the floor, as the issue's constraints require, though real `env` runs nothing there either.
- Making a bare `env` prompt because it prints secrets.
  That is a policy, and the lever already exists: `"env": "ask"` (and `"printenv *": "ask"`) is decided before the floor or the exemption is consulted.
- [#1057] (GNU `time`'s abbreviated options and the table wrappers' grammars), PR [#971] (lifting the floor for a rule that pins `xargs`'s inner command), and [#1055] / [#1063] / [#1065] (session-grant scope in `pattern-suggest.ts`) are untouched.

## Background

- `src/access-intent/bash/wrapper-analysis.ts`
  - `classifyWrapperWords(words)` answers `"indirection"` for any `INDIRECTION_WRAPPER_NAMES` member by basename, `env` included.
  - `floorExemptionOf(words, statement)` returns `undefined` unless the unit is `"indirection"`, then runs `unwrapIndirection` and refuses an opaque payload, an empty peel (`peeled.length === 0`), an `OPAQUE_COMMAND_LINE_WRAPPERS` layer, or a computed word in a peeled layer (`carriesComputedWord`, [#1056]).
    It then answers `core-reader` or `execution-modifier`.
    A bare `env` stops at the empty-peel refusal.
  - `innerCommandIndex(words)` dispatches to `getoptInnerIndex` for a `GETOPT_GRAMMARS` wrapper (`sudo`, `env`, `xargs`, `doas`) and to `tableInnerIndex` otherwise.
    `getoptInnerIndex` ends with `return index < words.length ? index : -1`, so "every word consumed" and "an option refused" both answer `-1`.
    Its only consumer is `innerCommandIndex`, whose two callers (`inlineShellPayloadIndex` and `unwrapIndirection`) both stop on `start === -1 || start >= current.length`.
    Neither function is exported or tested directly.
  - `GetoptGrammar` already carries two per-wrapper facts beside its option tables: `assignments` and `loneDashEndsOptions`.
  - `sessionCommandIndex(tokens)` answers `null` for a bare `env` (the peel never reaches a literal ordinary command), so `suggestBashPattern` keeps the whole command.
- `src/handlers/gates/bash-command.ts`
  - `resolveCommandUnit` sends a wrapper unit to `resolveWrapperUnit` only when its own text resolved `allow` and is not a session grant, so an explicit `ask`/`deny` on `env` never reaches it.
  - `resolveWrapperUnit` computes `const inner = cmd.floorExemption && cmd.executedUnit` and floors when `inner` is falsy.
    A bare `env` has no `executedUnit` (`executedUnitOf` answers `null`), so an exemption alone would still floor.
- `src/types.ts`: `FloorExemption = "core-reader" | "execution-modifier"`, documented as a named reason so "a later source … is an added member rather than a second flag".
  No `Record<FloorExemption, …>` or exhaustive switch exists, so adding a member breaks no type check (verified by the Tidy-First assessor and by grep).
- `src/access-intent/bash/command-enumeration.ts`: `makeCommandUnit` calls `floorExemptionOf(words, redirectedScope(node, scope))` once per unit; `src/handlers/gates/tool.ts`'s `floorExemptionFact` stamps whatever value the check carries onto the log context.
- ADR 0013 §11 says "any wrapper whose inner command is unresolvable (`executedUnitOf` fails to `null`) … keeps the floor"; this change carves a third clause out of that bullet, so it needs an amendment.
- AGENTS.md: pnpm only; Principle 4 (every number below is measured or labeled estimated).

## Design Overview

### How the evidence was produced

All measurements ran through the real parse and gate (`BashProgram.parseSync(…).commands()` → `resolveBashCommandCheck` over a `createInMemoryManager` policy of `bash: {"*": "allow"}`) in a disposable spike test, since deleted.

- Every row of the issue's table reproduces on `main` (measured): `env`, `env | rg '^PI_'`, `env -0`, `env -i`, `env -u FOO`, `env -`, `env FOO=1`, `env $X`, `env "$X"` ask with `<indirection-bash-wrapper>`; `env cat x` allows as `core-reader`; `printenv` allows by `*`.
  So do `env --help`, `env -v`, `env --unset=FOO`, `env --block-signal`, `env -- FOO=1`, `env > /tmp/x`, `sudo env`, `time env`, `nohup env`, `xargs`, `sudo -l`, and `doas -L` (all ask).
- `suggestBashPattern` keeps every bare `env` form whole today (`env -u FOO` → `env -u FOO`) (measured).
- Shell facts on this host (measured): BSD `env` and GNU `genv` 9.12 print the environment and exit 0 for `env -i`, `env -`, `env -u HOME -i FOO=1`, `env -i -- FOO=2`, `genv -i --block-signal FOO=3`, `genv -i --list-signal-handling FOO=4`, `genv -i --debug FOO=5`, and `genv -i -v`; `genv -u` exits 125.
- Review-log frequency (measured, ad-hoc scan of `permission_request.waiting` entries in the local review log, 24,359 lines): 278 entries cite `<indirection-bash-wrapper>`, and in 33 the deciding unit is exactly `env`; none are a bare `env` with options, and none are a nested no-command form.
  Step 5 adds the clause to `scripts/measure-wrapper-transparency.mjs` so the shipped figure comes from the instrument; its per-ask "every floored unit exempt" metric is estimated to land near 33.

### The rule

A unit earns `"no-command"` when all three hold:

1. Its own wrapper (`words[0]`'s basename) has a `GETOPT_GRAMMARS` entry with `bareFormRunsNothing: true` — today only `env`.
2. That grammar's option walk ends exactly at `words.length`: every word was an option, an option's value, a `NAME=value` assignment, `--`, or (for `env`) a lone `-`.
   A refusal (`-S`, `-C`, `-P`, `-a`, `--env0-from`, an unlisted or ambiguous option) answers `-1`, and an overrun (`env -u`, a value-taking option with no value) ends past the end; neither equals `words.length`.
3. No word after the wrapper name is computed — `carriesComputedWord(words)`, the [#1056] literal-word rule, applied to the unit's own words.
   `env -u $X` with `X="FOO rm"` runs `rm`, and `env FOO=$X` with `X="1 rm"` runs `rm`.

`env $X` and `env "$X"` never reach rule 3: `$X` is not an option or an assignment, so the walk ends at index 1, which names a command, and the existing path keeps the floor (the inner head is not a core reader, and `env` is not an execution modifier).

No redirect refusal applies.
The core-reader clause refuses a write-proving redirect because it classifies the unit as a read; this clause classifies nothing, and the unit resolves exactly as `printenv > /tmp/x` does, with the destination gated by the path surfaces — the execution-modifier clause's reasoning (ADR 0013, amendment of 2026-10-05).

The check runs first in `floorExemptionOf`, right after the `"indirection"` guard and before the peel, so it reads the outermost layer only.
It cannot collide with the other two reasons: both need a peeled inner command, and a unit whose walk consumed every word has none.

### Shapes

```typescript
// src/types.ts
export type FloorExemption = "core-reader" | "execution-modifier" | "no-command";

// src/access-intent/bash/wrapper-analysis.ts
interface GetoptGrammar {
  readonly short: ReadonlyMap<string, OptionArity>;
  readonly long: ReadonlyMap<string, OptionArity>;
  readonly assignments: boolean;
  readonly loneDashEndsOptions: boolean;
  /** Whether the wrapper with no command runs nothing (`env` prints the environment). */
  readonly bareFormRunsNothing: boolean;
}
```

The walk split (Step 1) gives the predicate a position to compare instead of a sentinel:

```typescript
function getoptInnerIndex(words, grammar): number {
  const end = getoptWalkEnd(words, grammar); // -1 on a refusal; may be ≥ words.length
  return end !== -1 && end < words.length ? end : -1;
}

function namesNoCommand(words: readonly CommandWord[]): boolean {
  const name = wrapperName(words);
  const grammar = name === undefined ? undefined : GETOPT_GRAMMARS.get(name);
  return (
    grammar?.bareFormRunsNothing === true &&
    getoptWalkEnd(words, grammar) === words.length &&
    !carriesComputedWord(words)
  );
}
```

`floorExemptionOf` gains one line after its classification guard:

```typescript
if (namesNoCommand(words)) return "no-command";
```

`resolveWrapperUnit` gains one branch ahead of the inner-command read, since the unit's own resolve (`base`) is the verdict:

```typescript
if (cmd.floorExemption === "no-command") {
  return { ...base, floorExemption: cmd.floorExemption };
}
```

`base` already carries `command`, `matchedPattern`, and the unit's `spellings` match, so nothing else is restamped.

### Edge cases and where each is tested

| Input                                                                                                                                                                       | Result                                                              | Step                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------- |
| `env`, `env -0`, `env -i`, `env -v`, `env -u FOO`, `env -uFOO`, `env --unset=FOO`, `env -`, `env FOO=1`, `env -i FOO=1`, `env -- FOO=1`, `env --help`, `env --block-signal` | `"no-command"`                                                      | 3                     |
| `env -u $X`, `env FOO=$X`, `env FOO="$X"`                                                                                                                                   | floor (computed)                                                    | 3                     |
| `env $X`, `env "$X"`, `env 'FOO=1'`                                                                                                                                         | floor (a command is named)                                          | 3                     |
| `env -S 'rm x'`, `env -C /tmp`, `env -P /bin`, `env -a x`, `env --env0-from /dev/null`, `env -Z`                                                                            | floor (refused)                                                     | 3                     |
| `env -u`                                                                                                                                                                    | floor (overrun)                                                     | 3                     |
| `xargs`, `sudo -l`, `doas -L`                                                                                                                                               | floor (grammar says the bare form runs something or is not audited) | 3                     |
| `sudo env`, `time env`, `nohup env`                                                                                                                                         | floor (outermost layer only)                                        | 3                     |
| `env > /tmp/x`                                                                                                                                                              | `"no-command"` (no redirect refusal)                                | 3 (program), 4 (gate) |
| `env \| rg '^PI_'` under `*: allow`                                                                                                                                         | `allow` by `*`, no `floor`                                          | 4                     |
| `{"*": "allow", "env": "ask"}` / `"env": "deny"`                                                                                                                            | `ask` / `deny` by `env`                                             | 4                     |
| `suggestBashPattern("env -u FOO")`                                                                                                                                          | `env -u FOO` (unchanged)                                            | 4                     |

### Alternatives considered

- **`env`-specific name check** (`wrapperName(words) === "env"` in `floorExemptionOf`): the same behavior today, but the fact would live in code beside a grammar that already holds `env`'s other per-wrapper facts (`assignments`, `loneDashEndsOptions`); declined at the gate.
- **Clear `wrapperKind` in `makeCommandUnit` for a bare `env`**: no gate change, but `BashCommand.wrapperKind` would then disagree with `classifyWrapperWords`, the drift `wrapper-analysis.ts`'s header names as the reason its questions live together, and the review log would record no reason.
- **Record nothing** (resolve silently): declined at the gate; `FloorExemption`'s doc names the audit trail as its purpose.

## Module-Level Changes

- `src/access-intent/bash/wrapper-analysis.ts`
  - Step 1: extract `getoptWalkEnd(words, grammar)` from `getoptInnerIndex`; `getoptInnerIndex` keeps its contract.
  - Step 3: `GetoptGrammar.bareFormRunsNothing` (`true` on `ENV_GRAMMAR`, `false` on `SUDO_GRAMMAR`, `XARGS_GRAMMAR`, `DOAS_GRAMMAR`); private `namesNoCommand(words)`; `floorExemptionOf`'s first check and its doc comment (a `"no-command"` paragraph); `ENV_GRAMMAR`'s doc gains the sentence on the bare form; the module header's "three wrapper questions" wording is unchanged.
- `src/types.ts` — Step 3: `FloorExemption` gains `"no-command"`, with a doc paragraph.
- `src/handlers/gates/bash-command.ts` — Step 4: `resolveWrapperUnit`'s `"no-command"` branch and its doc comment; the file-header doc's wrapper paragraph names the third reason.
- `test/access-intent/bash/wrapper-analysis.test.ts` — Step 2 hoists `exemptionOf`; Step 3 adds a `describe("a wrapper naming no command")` under `floorExemptionOf`.
- `test/access-intent/bash/program.test.ts` — Step 3 adds `"no-command"` cases to the `floor exemption` describe (`env | rg '^PI_'`, `env > /tmp/x`).
- `test/handlers/gates/bash-command.test.ts` — Step 4 adds `describe("resolveBashCommandCheck: an env naming no command")`.
- `scripts/measure-wrapper-transparency.mjs` — Step 5: score the no-command clause beside the other two.
- `docs/configuration.md` — Step 6: the indirection-wrapper bullet's "two exceptions" sentence (line ~595) becomes three; § Wrapper transparency's "Two kinds" intro (line ~1085) becomes three, and a new `##### A wrapper that runs nothing` subsection follows `##### A wrapper that only modifies execution`, stating the conditions, the `"env": "ask"` lever for a user who wants bare `env` to prompt, and that `printenv` was never floored.
- `docs/decisions/0013-permission-policy-model.md` — Step 6: an `### Amendment, <date> — a wrapper that names no command has no floor to hold` (date from `date -u` when it lands), and §11's "Therefore" list gains the third bullet.
- `docs/architecture/architecture.md` — Step 6:
  - the `wrapper-analysis.ts` module-tree entry (line ~940): `floorExemptionOf`'s answers gain `"no-command"`, and the `GETOPT_GRAMMARS` sentence names `bareFormRunsNothing`;
  - the `bash-command.ts` entry (line ~982): `resolveWrapperUnit` resolves a `no-command` unit by its own rule;
  - the roadmap step heading `#### [#1064] …` and the Mermaid node `S1064` gain `✅`, and the step gains its `Landed:` note.
- Predicted unchanged:
  - `src/presentation/pattern-suggest.ts` and `sessionCommandIndex` — the classification is untouched, so the session suggestion stays the whole command (pinned in Step 4).
  - `src/handlers/gates/tool.ts` — `floorExemptionFact` spreads any member generically.
  - `src/access-intent/bash/command-enumeration.ts` — it relays whatever `floorExemptionOf` answers.
  - `test/handlers/gates/tool.test.ts` — asserts only `core-reader`.
  - `README.md`, `docs/cross-extension-api.md`, and `.pi/skills/package-pi-permission-system/SKILL.md` — none names a `FloorExemption` value (grep).

## Test Impact Analysis

1. New tests enabled: `floorExemptionOf`'s raw answer for bare forms, which `isTransparent` (a `=== "core-reader"` probe) cannot see; Step 2's hoisted `exemptionOf` is what reads it.
2. Redundant tests: none.
   The existing `program.test.ts` pin "is absent when the wrapper names no inner command" uses bare `xargs`, which stays floored, so it stays valid and now pins `XARGS_GRAMMAR.bareFormRunsNothing: false` at the parse level too.
3. Tests that stay as-is: every existing `env` row in `wrapper-analysis.test.ts` (`an env layer`) and `bash-command.test.ts` (`env, xargs, and doas option grammars`, `a computed word in a wrapper's options`) names an inner command, so none changes outcome (grep found no existing test asserting a bare `env`).

## Invariants at risk

- [#1056] — "the literal-word rule is one precondition of `floorExemptionOf`, shared by both reasons."
  The new reason must share it: Step 3's `env -u $X`, `env FOO=$X`, and `env FOO="$X"` cases pin it at the word level, and Step 4 adds `env -u $X` at the gate.
  The existing `a computed word in a wrapper's options` gate tests stay green unchanged.
- [#1053] — `env`'s refusing modes keep the floor.
  Existing tests cover them with an inner command; Step 3 adds the bare forms (`env -S 'rm x'`, `env -C /tmp`, `env -P /bin`, `env -a x`, `env --env0-from /dev/null`).
- [#1033] — a session grant covers one unit, and a wrapper's session pattern never generalizes past an unproven shape.
  Step 4 pins `suggestBashPattern("env -u FOO") === "env -u FOO"` (and `env FOO=1`), the constituency being the user approving "for this session".
- [#963] — the execution-modifier clause requires every layer to be a modifier and the peel to end at a non-wrapper; `time env` keeps the floor (Step 3).
- [#803] / [#490] — an explicit `ask`/`deny` on the wrapper is never weakened; Step 4 pins `"env": "ask"` and `"env": "deny"`.
- [#1029] — a floored ask carries its `floor`; a `no-command` unit is an `allow` and contributes none.
  Step 4 asserts `env | rg '^PI_'` has no `floor`, and the existing `resolveBashCommandCheck: the floor that raised an ask` tests stay green.

## TDD Order

1. `refactor(pi-permission-system): split the getopt option walk's end from the inner-command index`
   - Extract `getoptWalkEnd(words, grammar): number` from `getoptInnerIndex` in `wrapper-analysis.ts`: it returns the index after options, values, `--`/lone `-`, and (for a grammar that takes them) `NAME=value` words — possibly `≥ words.length` — or `-1` on a refusal.
     `getoptInnerIndex` becomes a two-line wrapper keeping its `-1`-when-words-run-out contract, so `innerCommandIndex`, `inlineShellPayloadIndex`, and `unwrapIndirection` are untouched.
   - Prepares Step 3: the no-command predicate needs "the walk ended on the last word", which today collapses into `-1`.
   - No new tests (behavior-preserving); verify `wrapper-analysis.test.ts`, `program.test.ts`, and `bash-command.test.ts` stay green, then `pnpm --filter @gotgenes/pi-permission-system run check`.
2. `test(pi-permission-system): hoist exemptionOf to the floorExemptionOf describe`
   - Move `exemptionOf(unitText, writesViaRedirect = false)` from `describe("an execution modifier")` up to `describe("floorExemptionOf")` scope in `wrapper-analysis.test.ts`; no test changes.
   - Prepares Step 3: the new cases need the raw exemption value, which `isTransparent` cannot report.
3. `refactor(pi-permission-system): name a bare env's floor exemption`
   - `FloorExemption` gains `"no-command"` (`types.ts`, with its doc paragraph); `GetoptGrammar` gains `bareFormRunsNothing` on all four grammars; `namesNoCommand` and `floorExemptionOf`'s first check land, with doc comments.
   - Typed `refactor:`: the gate still floors (`resolveWrapperUnit` reads `cmd.floorExemption && cmd.executedUnit`, and a bare `env` has no `executedUnit`), and `floorToAsk` drops the reason, so no decision or log record changes until Step 4.
     That interim state is fail-closed.
   - Tests, `wrapper-analysis.test.ts` `describe("a wrapper naming no command")` via `exemptionOf`: the Edge-cases table's Step 3 rows (`"no-command"` for the first row, `undefined` for the floor rows); `program.test.ts`'s `floor exemption` describe: `env | rg '^PI_'` → `["no-command", undefined]` and `env > /tmp/x` → `["no-command"]`.
   - Killing mutations:
     - Make `namesNoCommand` return `false` unconditionally → every `"no-command"` row goes red.
     - Drop `!carriesComputedWord(words)` from `namesNoCommand` → `env -u $X`, `env FOO=$X`, `env FOO="$X"` go red.
     - Set `bareFormRunsNothing: true` on `XARGS_GRAMMAR` → `xargs` goes red (and on `SUDO_GRAMMAR` → `sudo -l`; on `DOAS_GRAMMAR` → `doas -L`).
     - Change `=== words.length` to `>= words.length` in `namesNoCommand` → `env -u` goes red.
     - Make `shortClusterWords` and `longOptionWords` treat a `"refuse"` arity as `"value"` (so the refused option swallows the next word and the walk ends on the last one) → `env -S 'rm x'`, `env -C /tmp`, `env -P /bin`, `env -a x`, `env --env0-from /dev/null` go red (existing refusal tests go red too).
     - Move the check after `unwrapIndirection` and pass it `unwrapped.words` → `sudo env` and `time env` go red.
     - Add `&& !statement.writesViaRedirect` to the `namesNoCommand` check → `env > /tmp/x` goes red.
4. `fix(pi-permission-system): a bare env that runs no command resolves by its own rule`
   - `resolveWrapperUnit` returns `{ ...base, floorExemption: cmd.floorExemption }` for `"no-command"`; its doc comment and the file-header wrapper paragraph name the third reason.
   - Tests, `bash-command.test.ts` `describe("resolveBashCommandCheck: an env naming no command")`, policy `{"*": "allow"}`:
     - `describe("resolves by its own rule")`: `env`, `env | rg '^PI_'`, `env -0`, `env -i`, `env -u FOO`, `env -`, `env FOO=1`, `env > /tmp/x` → `state: "allow"`, `matchedPattern: "*"`, `floorExemption: "no-command"`, and `floor` undefined.
     - `describe("keeps the floor")`: `env $X`, `env "$X"`, `env -u $X`, `env -S 'rm x'`, `sudo env` → `ask` with `<indirection-bash-wrapper>`.
     - `describe("an explicit rule on env")`: `{"*": "allow", "env": "ask"}` → `ask` by `env`; `{"*": "allow", "env": "deny"}` → `deny` by `env`.
     - `describe("its session suggestion")`: `suggestBashPattern("env -u FOO")` → `"env -u FOO"`, `suggestBashPattern("env FOO=1")` → `"env FOO=1"`.
   - Killing mutations:
     - Delete the `"no-command"` branch in `resolveWrapperUnit` → every `resolves by its own rule` row goes red (ask with the sentinel).
     - Return `base` without `floorExemption` → the `floorExemption` assertions go red.
     - Make `sessionCommandIndex` answer `0` when `classifyWrapperWords(words)` is `"indirection"` and `floorExemptionOf(words, { writesViaRedirect: false })` is `"no-command"` (declassification) → the session-suggestion rows go red (`env *`).
     - The explicit-rule rows are pins of the existing `base.state === "allow"` guard: replace that guard with `true` in `resolveCommandUnit` → `env: deny` goes red.
5. `docs(pi-permission-system): measure the no-command exemption`
   - `scripts/measure-wrapper-transparency.mjs`: a `namesNoCommand(words)` beside `onlyModifiesExecution`, transcribing `ENV_GRAMMAR`'s option rows and the literal-word screen, counted under `clauses === "all"` and reported as "N of them by the no-command clause alone".
   - Update the script's header comment with the dated run; the run's printed figures are the only ones Step 6 may cite.
6. `docs(pi-permission-system): document the no-command floor exemption`
   - `docs/configuration.md`, ADR 0013 amendment and §11 bullet, `docs/architecture/architecture.md` module-tree entries, the `✅` on the roadmap heading and Mermaid node `S1064`, and the step's `Landed:` note naming Steps 1–5's subjects and Step 5's measured figure.

## Risks and Mitigations

- **A computed word turns a no-command form into a command.**
  Rule 3 reuses `carriesComputedWord`, the rule [#1056] measured and documented; Step 3's computed rows and their mutation pin it.
- **The walk misreads an option arity and ends on the last word while a command was named.**
  Every `ENV_GRAMMAR` row was verified against BSD and GNU `env` in [#1053]; an unlisted option refuses (`-1`), so a missing row costs a prompt, never an allow.
  The one arity that could consume the command's word, a value-taking option, can only end the walk at `words.length` if the value is the last word, which then is a value, not a command.
- **A future grammar sets `bareFormRunsNothing` carelessly.**
  The field's doc says what it asserts (the wrapper with no command executes nothing); `xargs` is the counterexample named in its grammar's doc, and Step 3's `xargs`/`sudo -l`/`doas -L` rows pin the three `false` values.
- **Users relied on the floor to prompt for a bare `env` that prints secrets.**
  The floor was never a policy for that, and `printenv` already passed; Step 6's docs name `"env": "ask"` as the lever, and Step 4 pins that it governs.
- **Step 3's interim state stamps a reason the gate ignores.**
  The gate floors on a missing `executedUnit` until Step 4, which is the fail-closed direction, and Steps 3 and 4 land back to back.

## Open Questions

None.

[#490]: https://github.com/gotgenes/pi-packages/issues/490
[#803]: https://github.com/gotgenes/pi-packages/issues/803
[#963]: https://github.com/gotgenes/pi-packages/issues/963
[#971]: https://github.com/gotgenes/pi-packages/pull/971
[#1029]: https://github.com/gotgenes/pi-packages/issues/1029
[#1033]: https://github.com/gotgenes/pi-packages/issues/1033
[#1053]: https://github.com/gotgenes/pi-packages/issues/1053
[#1055]: https://github.com/gotgenes/pi-packages/issues/1055
[#1056]: https://github.com/gotgenes/pi-packages/issues/1056
[#1057]: https://github.com/gotgenes/pi-packages/issues/1057
[#1063]: https://github.com/gotgenes/pi-packages/issues/1063
[#1065]: https://github.com/gotgenes/pi-packages/issues/1065
