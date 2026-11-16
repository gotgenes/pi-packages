---
issue: 1056
issue_title: "pi-permission-system: an unquoted computed word in a wrapper's options can split into the command the core-reader exemption never judged"
---

# A computed word in a wrapper's options keeps the floor

## Release Recommendation

**Release:** ship independently

Phase 15's roadmap step for this issue is tagged `Release: independent` and belongs to no release batch; the behavior step is a `fix:` that closes a fail-open in the wrapper floor exemption.

## Problem Statement

`floorExemptionOf` lifts the indirection floor when the command the wrapper peel locates proves a read (`core-reader`).
The peel reads each wrapper layer's words by their source text and never asks whether a word is literal.
The shell splits and globs an unquoted computed word before the wrapper runs, so one word in an option, an option's value, a leading operand, or a `NAME=value` argument can become several, and one of them can be the command that really runs.

What the agent and the user see, under `bash: {"*": "allow", "rm *": "deny"}`: the agent runs `sudo -u $U cat x`, the gate allows it silently as `core-reader` judged by `cat x`, and with `U="root rm y"` root runs `rm y cat x`, which the `rm *` deny never saw.
The execution-modifier clause already refuses this shape (`isAdmittedModifierLayer`); its sibling clause never got the same guard.

## Goals

- A peeled wrapper layer carrying any computed word after the wrapper name (an option, a value, a leading operand, `--`, or a `NAME=value` word, quoted or unquoted) earns no floor exemption, for either reason.
- One literal-word rule, read once in `floorExemptionOf`, so the `core-reader` and `execution-modifier` clauses cannot disagree about a layer.
- The false documented claim that "an environment assignment does not split" in a wrapper's argument position is removed from ADR 0013, `docs/configuration.md`, and `docs/architecture/architecture.md`.
- Under `bash: {"*": "allow", "rm *": "deny"}`, every row of the issue's table asks with `<indirection-bash-wrapper>`.
- Not breaking: `fix(pi-permission-system):`, matching [#1042] and [#1053], which tightened the same exemption (operator decision at the planning gate).
  No default, config shape, or output shape changes; a shape the floor should always have held now asks.

## Non-Goals

- Admitting a double-quoted computed word (`"$U"`) or an always-one-word one (`"$(…)"`).
  The operator chose to refuse every computed word; ADR 0013's 2026-09-29 amendment already holds that a quoted parameter expansion may split (a nameref to an array) or vanish (`"$@"`).
- The `command_name` word reading `computed: true` from `WordReader.argWord` (`isSpelledExactly` has no `command_name` case).
  Nothing reads the command name's `computed` bit today: the path speller skips `command_name` tokens (`bash-path-resolver.ts`), and every layer scan already starts at index 1.
  The guard skips index 0 with a comment saying why; changing the adapter is not needed for this fix.
- `scripts/measure-wrapper-transparency.mjs` keeps transcribing the old core-reader admission.
  Its figures are dated snapshots, and the measured cost of this guard is 1 of 532 indirection units (see Design Overview), below the script's stated run-to-run drift.
- [#1057] (GNU `time`'s abbreviated options and the remaining table wrappers' grammars) and [#1064] (a bare `env` keeps no floor), which reuses this step's guard.
- A table wrapper (`nice`, `time`, `timeout`, `stdbuf`, `setsid`) executing a `NAME=value` word as its command is [#1057]'s grammar territory; this step only stops a computed one from earning an exemption.
- PR [#971] (lifting the floor for a rule that pins the inner command) touches the same exemption from the opposite direction and is not affected.

## Background

- `src/access-intent/bash/wrapper-analysis.ts`
  - `floorExemptionOf(words, statement)` classifies the unit, runs `unwrapIndirection`, and refuses an opaque payload, an empty peel, or an `OPAQUE_COMMAND_LINE_WRAPPERS` layer.
    It then answers `core-reader` when the inner command proves a read with no write-proving redirect, else `execution-modifier` when `onlyModifiesExecution` holds.
  - `unwrapIndirection`'s `peeled` holds each layer's words before its inner command: the wrapper name, its options, values, `NAME=value` words, and any leading operand.
  - `isAdmittedModifierLayer(layer)` walks words from index 1.
    It `continue`s past an `isEnvironmentAssignment` word **before** its `computed` check, then refuses a computed word and a computed value of a value-taking option.
    It is also called by `generalizesLayer` for session patterns, whose caller `sessionCommandIndex` returns `null` when any whitespace token is computed (`literalWordsOf` + `SHELL_SYNTAX`).
- `src/access-intent/bash/node-text.ts`: `ArgWord.computed` is set for any part only running decides, and for a spelling the shell rewrites (an escape, a glob, a brace expansion, an ANSI-C string).
  `$HOME`/`$PWD` resolve while the program leaves them alone, so `sudo -u $HOME cat x` is literal, and a rebound `HOME` makes it computed ([#995]).
- `src/access-intent/bash/command-enumeration.ts`: `readCommandUnit` builds each `CommandWord` from `scope.words.argWord(node)`; `makeCommandUnit` calls `floorExemptionOf` once per unit.
- `src/handlers/gates/bash-command.ts`: `resolveWrapperUnit` reads `cmd.floorExemption`; only a unit whose own text resolved `allow` reaches it, so the exemption can never weaken an explicit rule.
- ADR 0013 §11 and its 2026-10-05 amendment state the two clauses; `docs/configuration.md` § Wrapper transparency lists their conditions for users.

## Design Overview

### How the evidence was produced

All measurements ran through the real parse and gate (`BashProgram.parseSync` → `resolveBashCommandCheck`, `BashProgram.parse` → `commands()[i].floorExemption`) in disposable spike tests, since deleted.

- The issue's seven rows reproduce on `main` (allow, `core-reader`), as do `sudo -u * cat x`, `sudo -u {root,rm} cat x`, `sudo -u r\oot cat x`, `sudo -u "$U" cat x`, `sudo -u "$@" cat x`, `env -u$U cat x`, `sudo -u $U -- cat x`, `find . -name *.ts -exec cat {} +`, and the nested `timeout 5 sudo -u $U cat x`; `time FOO=$Y pnpm test` earns `execution-modifier`.
- A prototype of the guard refused all of them and kept `core-reader` for `sudo -u root cat x`, `sudo -u ~ cat x`, `sudo -u $HOME cat x`, `sudo -u root cat $X`, `xargs -I{} cat {}`, `xargs -I {} cat {}`, `find . -name '*.ts' -exec cat {} +`, and `env HOME=~ cat x` (measured).
- A prototype scanning from index 0 floored every wrapper, `sudo -u root cat x` included, because the outermost `command_name` word reads `computed: true` (measured).
- Organic corpus: 11,206 distinct bash commands from the local review log yield 532 indirection units.
  The prototype changes exactly one: `env -i HOME="$HOME" PATH="$PATH" TERM=dumb true` (`core-reader` → floor, from `"$PATH"`); zero `execution-modifier` units change (measured).
- With the guard alone, and with the guard plus Step 3's removal, the full package suite stays green: 183 files, 6079 tests (measured).
- Shell facts, bash 5.3.20: with `Y="1 rm y"`, `env FOO=$Y cat x` and `nice FOO=$Y cat x` print `[env|nice][FOO=1][rm][y][cat][x]`; with `arr=(root rm y); declare -n U='arr[@]'`, `sudo -u "$U" cat x` yields `[sudo][-u][root][rm][y][cat][x]`; with no positional parameters, `sudo -u "$@" cat rm` yields `[sudo][-u][cat][rm]`, as does an empty unquoted `$U`.

### The rule

A peeled layer earns no exemption when any word after its wrapper name is computed.
Index 0 is skipped because a wrapper name is matched by its text against a fixed vocabulary, so a computed spelling (`"sudo"`, `$SUDO`, `s\udo`) never classifies as a wrapper, and the adapter reads the outermost name as computed regardless.
The inner command's own words are not scanned: `sudo -u root cat $X` runs `cat` whatever `$X` splits into, and the core's argument-independence (and `proveCommandEffect`'s computed-word guards) already cover them.

```typescript
// floorExemptionOf, the shared preconditions:
if (
  unwrapped.kind === "opaque" ||
  unwrapped.peeled.length === 0 ||
  unwrapped.peeled.some(runsOpaqueCommandLine) ||
  unwrapped.peeled.some(carriesComputedWord)
) {
  return undefined;
}

/** True when the shell may rewrite a word a peeled layer passes its wrapper. */
function carriesComputedWord(layer: readonly CommandWord[]): boolean {
  return layer.slice(1).some((word) => word.computed);
}
```

The name `carriesComputedWord` is a suggestion; the implementing session may choose another that reads as a refusal beside `runsOpaqueCommandLine`.

### One rule for both clauses

The guard sits among the shared preconditions, so it covers `execution-modifier` too.
`isAdmittedModifierLayer`'s two `computed` checks then guard nothing on the floor path, and on the session path `sessionCommandIndex` refuses every computed token before `generalizesLayer` runs (assessor-verified; Step 1 pins it).
Step 3 removes them, which also retires the assignment exemption: a computed `NAME=value` on a modifier layer (`time FOO=$Y pnpm test`) keeps the floor from Step 2 on.

### Edge cases (each tested in the named step)

- Option value, separate and attached: `sudo -u $U cat x`, `doas -u $U cat x`, `env -u $U cat x`, `env -u$U cat x`, `xargs -n $N cat` (Step 2).
- Leading operand: `timeout $D cat x` (Step 2).
- `NAME=value`: `sudo FOO=$Y cat x`, `env FOO=$Y cat x`, `env PATH="$PATH:/x" cat x`, `time FOO=$Y pnpm test` (Step 2).
- Quoted: `sudo -u "$U" cat x`, `sudo -u "$(whoami)" cat x`, `sudo -u "$@" cat x` (Step 2).
- Glob, brace, escape: `sudo -u * cat x`, `sudo -u {root,rm} cat x`, `sudo -u r\oot cat x`, `find . -name *.ts -exec cat {} +` (Step 2).
- After `--`: `sudo -u $U -- cat x` (Step 2).
- Nested layer, inner and outer: `timeout 5 sudo -u $U cat x`, `sudo -u $U timeout 5 cat x` (Step 2).
- Rebound `HOME`: `HOME="a rm"; sudo -u $HOME cat x` (Step 2).
- Literal layers that keep `core-reader`: `sudo -u root cat x`, `sudo -u ~ cat x`, `sudo -u $HOME cat x`, `sudo -u root cat $X`, `xargs -I{} cat {}`, `xargs -I {} cat {}`, `find . -name '*.ts' -exec cat {} +`, `env HOME=~ cat x`; and `time FOO=1 pnpm test` keeps `execution-modifier` (Step 1).
- Session patterns keep the whole command for `nice -n $N mytool a` and `nice FOO=$Y mytool a` (Step 1).

## Module-Level Changes

- `src/access-intent/bash/wrapper-analysis.ts`
  - `floorExemptionOf`: the `carriesComputedWord` precondition; its doc comment's condition list gains the literal-layer condition (Step 2).
  - New private `carriesComputedWord`, placed below `floorExemptionOf` beside `runsOpaqueCommandLine` (Step 2).
  - `isAdmittedModifierLayer`: drop both `computed` checks and the comment above the first (Step 3).
  - `onlyModifiesExecution` doc comment: condition 2 loses its literal-word sentences, which now belong to `floorExemptionOf` (Step 3).
- `test/access-intent/bash/program.test.ts`: a new nested `describe("a computed word in a wrapper's options")` under `describe("floor exemption")`, with the literal pins (Step 1) and the refusal rows (Step 2); the existing flat `does not exempt the modifier unit of …` table is unchanged.
- `test/presentation/pattern-suggest.test.ts`: two rows in `keeps the whole command when generalizing is unproven` (Step 1).
- `test/handlers/gates/bash-command.test.ts`: a new `describe("resolveBashCommandCheck: a computed word in a wrapper's options")` holding the issue's outcome table (Step 2).
- `test/access-intent/bash/wrapper-analysis.test.ts`: refusal rows for the `$` classes under `describe("floorExemptionOf")`, which the `words()` stand-in models (Step 2).
- `docs/decisions/0013-permission-policy-model.md`: a new dated amendment (the literal-word rule holds for both clauses; a `NAME=value` word in a wrapper's argument position splits); the 2026-10-05 amendment's "(an environment assignment, which does not split, is exempt)" parenthetical is replaced with a pointer to the new amendment (Step 4).
- `docs/configuration.md` § A wrapper running a pure reader: "All four" becomes five, the new condition being that every word before the command it runs is written literally, with one example; § A wrapper that only modifies execution, item 2: drop "(an environment assignment, which the shell does not split, may be computed)" (Step 4).
- `docs/architecture/architecture.md`: the `wrapper-analysis.ts` module entry (the literal rule is a shared precondition, not modifier-only, and the assignment clause goes); the step heading `#### ✅ [#1056] …`, the Mermaid node `S1056["✅ #1056<br/>…"]`, and a `Landed:` note (Step 4).

Predicted unchanged, with the claim each rests on:

- `src/access-intent/bash/command-enumeration.ts`: `floorExemptionOf`'s signature does not change.
- `src/handlers/gates/bash-command.ts`: it reads `cmd.floorExemption` only.
- `src/access-intent/bash/node-text.ts`: no new `ArgWord` bit (the operator declined the one-word admission).
- `src/presentation/pattern-suggest.ts`: `sessionCommandIndex`'s up-front computed refusal already covers what Step 3 removes.
- `test/handlers/gates/bash-command-metamorphic.test.ts`: its modifier floors (`timeout $D pnpm test`, `nice -n $N pnpm test`) stay green and become pins of the shared guard after Step 3 (measured).
- `.pi/skills/package-pi-permission-system/SKILL.md` and `packages/pi-permission-system/README.md`: neither names the literal rule or the assignment exemption (grepped).

## Test Impact Analysis

1. New tests the change enables: real-parse refusal rows for glob, brace, escape, quoted, and nested shapes on the core-reader path, which had no literal-word test at all.
2. Redundant tests: none.
   The modifier rows in `program.test.ts` (`timeout {5,sudo} rm x`, `timeout $D rm x`, `nice -n$N rm x`, …) and the metamorphic floors keep their claims; after Step 3 they pin the shared guard instead of `isAdmittedModifierLayer`.
3. Tests that stay as-is: every existing `floorExemptionOf`, sudo/env/xargs/doas grammar, and session-pattern test; the prototype ran the full suite green.

## Invariants at risk

- [#963] Outcome: `time pnpm run lint >/tmp/lintout.txt 2>&1` resolves as `pnpm run lint` does; `time sudo rm -rf x` and `timeout 5 bash -c '…'` still floor.
  Pinned by `program.test.ts` "exempts an execution modifier whose statement redirects to a file" and `bash-command-metamorphic.test.ts`'s floors; constituency: users relying on modifier transparency, whose literal shapes the corpus shows unchanged (0 of 211 `execution-modifier` units change, measured).
- [#1027] Outcome: `time (rm -rf /tmp/x)` reaches an `rm *` deny; pinned by `program.test.ts` "exempts a timed subshell, whose commands are units of their own" (the enumerator passes its own exemption, which bypasses `floorExemptionOf`).
- [#1053] Outcome: `xargs -R 1 cat rm x` and `xargs -S 255 cat` resolve by `cat`'s rule; pinned by `bash-command.test.ts` "resolves by the pure reader it runs" (literal layers, unchanged).
- Session patterns never generalize past a computed word: pinned by `pattern-suggest.test.ts`'s existing `timeout $T mytool a` row plus Step 1's two rows.
  Measured on `main`: deleting `sessionCommandIndex`'s computed refusal turns `nice FOO=$Y mytool a` and `timeout $T mytool a` red but leaves `nice -n $N mytool a` green (still refused by `isAdmittedModifierLayer`); with Step 3 applied, the same deletion turns all three red.

## TDD Order

1. `test(pi-permission-system): pin the literal wrapper layers and session patterns a computed-word guard must leave alone`
   - Surface: `program.test.ts` new `describe("a computed word in a wrapper's options")` › `describe("keeps the exemption for a literal layer")`, with `core-reader` rows `sudo -u root cat x`, `sudo -u ~ cat x`, `sudo -u $HOME cat x`, `sudo -u root cat $X`, `xargs -I{} cat {}`, `xargs -I {} cat {}`, `find . -name '*.ts' -exec cat {} +`, `env HOME=~ cat x`, and an `execution-modifier` row `time FOO=1 pnpm test`; `pattern-suggest.test.ts` rows `["shell syntax", "nice -n $N mytool a"]` and `["shell syntax", "nice FOO=$Y mytool a"]`.
   - All green on `main`, as Tidy First's pin of what Step 2's index boundary and Step 3's removal must preserve.
   - Killing mutations, applied to `main` for the pins and recorded:
     - Add `unwrapped.peeled.some((layer) => layer.some((word) => word.computed))` to `floorExemptionOf`'s refusal (scanning from index 0): every `core-reader` pin goes red (measured: `sudo -u root cat x` floors).
     - Delete `if (words.some((word) => word.computed)) return null;` in `sessionCommandIndex`: `nice FOO=$Y mytool a` goes red (measured: suggests `nice FOO=$Y mytool *`); `nice -n $N mytool a` stays green on `main` and is a pin for Step 3.
2. `fix(pi-permission-system): a computed word in a wrapper's options keeps the indirection floor`
   - Red: `program.test.ts` › `describe("loses the exemption for a computed layer word")` with every Step-2 edge case above, expecting `undefined` for the wrapper unit (for the `HOME="a rm"; …` row, assert the `sudo` unit's entry); `bash-command.test.ts` new describe, the issue's seven rows plus `sudo -u "$U" cat x`, each `ask` with `<indirection-bash-wrapper>` under `{"*": "allow", "rm *": "deny"}`; `wrapper-analysis.test.ts` rows `sudo -u $U cat x`, `env FOO=$Y cat x`, `timeout $D cat x` (not `core-reader`) and `time FOO=$Y pnpm test` (`undefined`).
   - Green: the `carriesComputedWord` precondition, and `floorExemptionOf`'s doc comment gains the condition (each option, value, operand, and `NAME=value` word on every layer is literal, since the shell splits or expands a computed one, as `sudo -u $U cat x` with `U="root rm y"` runs `rm`).
   - Killing mutations:
     - Delete the new precondition: every core-reader refusal row goes red; `time FOO=$Y pnpm test` goes red too (the modifier's assignment skip admits it); the modifier rows stay green, still guarded by `isAdmittedModifierLayer` until Step 3.
     - Make `carriesComputedWord` skip words where `isEnvironmentAssignment(word.text)`: the `sudo FOO=$Y`, `env FOO=$Y`, `env PATH="$PATH:/x"`, and `time FOO=$Y` rows go red.
     - Make the precondition read only `unwrapped.peeled[0]`: `timeout 5 sudo -u $U cat x` goes red.
     - Make `carriesComputedWord` scan `layer` from index 0: Step 1's pins go red.
3. `refactor(pi-permission-system): read the literal-word rule once for both floor exemptions`
   - Remove `isAdmittedModifierLayer`'s `if (layer[index].computed) return false;` (with its comment) and the value word's `if (layer[index]?.computed) return false;`; move `onlyModifiesExecution`'s literal-word sentences out of its condition 2.
   - Verify: the full suite green (measured on the prototype: 6079 tests).
   - Mutation check (the guard is now the only pin): with this step applied, deleting Step 2's precondition turns 12 existing tests red, the 8 `does not exempt the modifier unit of …` rows in `program.test.ts` and 4 metamorphic floors (measured), and deleting `sessionCommandIndex`'s computed refusal turns `nice -n $N mytool a` red (measured).
4. `docs(pi-permission-system): one literal-word rule for both wrapper floor exemptions`
   - ADR 0013's new amendment dated by `date -u +%F` at implementation time, and the 2026-10-05 parenthetical replaced; `docs/configuration.md`'s two sections; `docs/architecture/architecture.md`'s module entry, the `✅` on the step heading and Mermaid node, and a `Landed:` note naming these commits.
   - Verify: `pnpm exec rumdl check` on the three files; `rg -n "does not split" packages/pi-permission-system/docs` reports only `configuration.md`'s unrelated chain-operator sentence.

No `Co-authored-by:` trailer: the mechanism comes from the operator's own issue.

## Risks and Mitigations

- **A literal shape users rely on starts prompting.**
  Mitigation: measured at 1 of 532 indirection units in the review-log corpus (`env -i HOME="$HOME" PATH="$PATH" TERM=dumb true`), and Step 1 pins the common literal shapes, including `xargs -I{} cat {}`, whose `{}` is a brace the adapter could have read as computed but does not.
- **The index-0 skip hides a computed wrapper name.**
  Mitigation: a computed name never classifies as a wrapper (text match against a fixed vocabulary), so no layer exists for it; Step 2's "scan from index 0" mutation and Step 1's pins hold the boundary.
- **Step 3 opens the session path.**
  Mitigation: the absence was spiked, not argued; with Step 3 applied, deleting `sessionCommandIndex`'s refusal turns the Step 1 pin red, and leaving it in place keeps the suite green (measured).
- **The ADR's 2026-10-05 text is edited in place.**
  Mitigation: the edit replaces the parenthetical with a pointer to the new amendment rather than silently rewriting it, so the record says when and why the rule changed.

## Open Questions

- None.
  [#1064] will reuse the precondition for its no-command exemption; its plan decides whether that exemption sits before or after the guard.

[#963]: https://github.com/gotgenes/pi-packages/issues/963
[#971]: https://github.com/gotgenes/pi-packages/pull/971
[#995]: https://github.com/gotgenes/pi-packages/issues/995
[#1027]: https://github.com/gotgenes/pi-packages/issues/1027
[#1042]: https://github.com/gotgenes/pi-packages/issues/1042
[#1053]: https://github.com/gotgenes/pi-packages/issues/1053
[#1057]: https://github.com/gotgenes/pi-packages/issues/1057
[#1064]: https://github.com/gotgenes/pi-packages/issues/1064
