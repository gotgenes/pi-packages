---
issue: 1042
issue_title: "pi-permission-system: sudo -e (sudoedit) operands are peeled as an inner command and can earn the core-reader exemption"
---

# `sudo` finds its inner command by its real option grammar

## Release Recommendation

**Release:** ship independently

Phase 15's roadmap step for this issue is tagged `Release: independent` and belongs to no release batch; it is a `fix:` that closes a fail-open in the wrapper peel.

## Problem Statement

`sudo -e` (sudoedit) and `sudo --edit` run no command: they open each operand in the user's editor and write it back as root.
The wrapper peel in `src/access-intent/bash/wrapper-analysis.ts` skips `-e` as an ordinary flag and takes the next word as the inner command, so `sudo -e cat` earns the `core-reader` floor exemption and resolves by `cat`'s rule rather than the `<indirection-bash-wrapper>` floor.

Planning found the issue is one instance of a wider sudo defect: `innerCommandIndex` consumes a following value only for the short options in `VALUE_TAKING_FLAGS`, and knows nothing of clusters, long options, or getopt abbreviations.
Since [#803], `floorExemptionOf` reads that same peel, so a misplaced inner command is no longer display-only; it decides which rule resolves the unit.

## Goals

- `sudo`'s inner command is found by a getopt-faithful grammar: short clusters (`-nu root`), attached values (`-uedward`, `--user=root`), long options taking a separate value (`--user root`), unique-prefix abbreviations (`--us root`), `--`, and `NAME=value` assignments.
- A `sudo` layer whose mode edits files (`-e`/`--edit`), hands the operand to a shell (`-s`/`--shell`, `-i`/`--login`), or moves where relative operands resolve (`-D`/`--chdir`, `-R`/`--chroot`) refuses the peel: the floor holds, `executedUnitOf` answers `null`, and `inlineShellPayloadIndex` answers `-1`.
- An option the grammar does not list, an ambiguous abbreviation, or an option whose arity this host's `man sudo` does not settle (`-h`) refuses the peel too: fail-closed.
- Under `bash: {"*": "allow", "rm *": "deny"}`, every shape in the measured table below asks with `<indirection-bash-wrapper>`, while `sudo -u root cat x`, `sudo -n true`, and `sudo -uedward cat` keep the `core-reader` exemption.
- Not breaking (operator decision): `fix:`, the roadmap's tag; it tightens a fail-open, and none of the newly floored shapes appears in the local review log (measured: 0 hits in 23,779 entries).

## Non-Goals

- `env`, `xargs`, and the other wrappers' option tables, including `env -C`'s moved cwd: filed as [#1053], a new Phase 15 step directly after this one (operator decision).
- `sudo -l`/`--list` and `-v`/`--validate` run nothing, so peeling past them names a command that never runs; that is conservative (no execution to misjudge) and stays as today.
- A configuration lever to lift the floor for a refused sudo mode: the floor is overridden today only by `yoloMode` or a prompt approval (`docs/configuration.md`, the fail-closed behavior section), and a per-rule floor override is [#680]'s and PR [#971]'s question, not this fix's (operator decision).
- `sudo` invoked as `sudoedit`: it is not an indirection wrapper name, so it already resolves by its own `sudoedit *` rule.
- A shared structured command description replacing the per-command option grammars: the [#963] retro's phase handoff candidate, unchanged here.
- `scripts/measure-wrapper-transparency.mjs`: it transcribes the wrapper tables deliberately so a re-run stays comparable to its recorded figures; predicted unchanged.

## Background

`wrapper-analysis.ts` (678 lines) owns the wrapper vocabulary.
`innerCommandIndex(words)` returns where a wrapper layer's inner command starts, or `-1` when the wrapper's options run out first; it handles the `find`/`fd` exec-flag short-circuit, then walks options with `VALUE_TAKING_FLAGS` and `LEADING_OPERAND_WRAPPERS`.
Its consumers:

- `unwrapIndirection` stops peeling on `-1`, so `floorExemptionOf` sees no peeled layer (answers `undefined`, the floor holds) and `executedUnitOf` falls back to the unit's own text, which `nothingNew` turns into `null`.
- `inlineShellPayloadIndex` answers `-1` on `-1`, so the payload query and `executedUnitOf` stay consistent (the [#923] rule).
- PR [#971] (third-party, open) calls `innerCommandIndex` to lift the floor for a rule pinning the inner command, so it inherits this fix.

`isAdmittedModifierLayer` reads `VALUE_TAKING_FLAGS` through `admittedValueTaking`, but only for `EXECUTION_MODIFIER_FLAGS` names; `sudo` is not one, so dropping its row cannot change what that clause admits.
The doc comment on `VALUE_TAKING_FLAGS` ("Only the display-side extraction reads this ... never a weaker gate") has been false since [#803] made `floorExemptionOf` read the peel.

The gate (`resolveWrapperUnit` in `src/handlers/gates/bash-command.ts`) resolves an exempt unit by `executedUnit`'s text on the `bash` surface, which is why a misplaced inner command (`cat rm x`) bypasses an `rm *` deny.
No change is needed there.

## Design Overview

### How the evidence was produced

Every row below is **measured** through the real code path: a disposable Vitest spike ran `BashProgram.parseSync` → `resolveBashCommandCheck` with a real `PermissionResolver` over `createInMemoryManager`, policy `bash: {"*": "allow", "rm *": "deny"}`, on current `main`; the spike was deleted afterwards.

| Command                                                            | Today                              | `executedUnit`    | What runs                            |
| ------------------------------------------------------------------ | ---------------------------------- | ----------------- | ------------------------------------ |
| `sudo -e cat`, `sudo --edit true`, `sudo -ne cat`, `sudo --ed cat` | allow, `core-reader`               | `cat` / `true`    | the editor writes file `cat` as root |
| `timeout 5 sudo -e cat`                                            | allow, `core-reader`               | `cat`             | same                                 |
| `sudo --user cat rm x`, `sudo --us cat rm x`                       | allow, `core-reader`               | `cat rm x`        | `rm x` as user `cat`                 |
| `sudo -nu cat rm x`                                                | allow, `core-reader`               | `cat rm x`        | `rm x` as user `cat`                 |
| `sudo --chdir cat rm x`, `sudo -D cat rm x`, `sudo -R cat rm x`    | allow, `core-reader`               | `cat rm x`        | `rm x` as root                       |
| `sudo -D /etc cat shadow`                                          | ask (accident: `/etc` is not core) | `/etc cat shadow` | `cat /etc/shadow`                    |
| `sudo -uedward cat`, `sudo --user=cat rm x`                        | allow / ask                        | `cat` / `rm x`    | correct today                        |

`sudo -D /etc cat shadow` is the case a table-only fix would break: consuming `-D`'s value correctly yields `cat shadow`, an exemption, while the path surfaces judge `shadow` against the agent's cwd.
That is why directory-moving modes refuse rather than parse.

The grammar's facts come from this host's `sudo` (`Sudo version 1.9.17p2`), verified live:

- `man sudo | col -b | grep -nE "^ +-[A-Za-z], --|^ +-[A-Za-z] [a-z]"` lists the options (output below, in the TDD Order).
- `sudo -n --list --ed` → `Only one of the -e, -h, -i, -K, -l, -s, -v or -V options may be specified`, so `--ed` is `--edit` (getopt_long abbreviation).
- `sudo --us` → ``option `--us' requires an argument``, so abbreviations resolve and `--user` takes a separate value.
- `sudo -ue` → `unknown user e`, so a value-taking letter ends its cluster and the rest is its value.

### The grammar

One table per grammar-parsed wrapper, mapping every option to an arity; anything absent refuses.

```typescript
/** How a getopt-parsed wrapper treats one of its options. */
type OptionArity = "flag" | "value" | "refuse";

interface GetoptGrammar {
  /** Short letter → arity; an absent letter refuses. */
  readonly short: ReadonlyMap<string, OptionArity>;
  /**
   * Full long name → arity. An abbreviation resolves against **every** key,
   * refusing ones included, as getopt_long does; an absent or ambiguous name
   * refuses.
   */
  readonly long: ReadonlyMap<string, OptionArity>;
}

const GETOPT_GRAMMARS = new Map<string, GetoptGrammar>([["sudo", SUDO_GRAMMAR]]);
```

Resolving abbreviations against every key matters: `--l` is ambiguous in real sudo (`list`, `login`), but resolving against admitted names alone would make it `--list`.

Admitted rows (each verified in this host's `man sudo`):

- Short flags `A B b E H K k l N n P S V v`; short values `C g p T U u`; short refusals `e i s D R h`.
- Long flags `askpass bell background preserve-env set-home help remove-timestamp reset-timestamp list no-update non-interactive preserve-groups stdin version validate`; long values `close-from group prompt other-user command-timeout user`; long refusals `edit login shell chdir chroot host`.
- `--preserve-env=list` takes its value attached only, so `preserve-env` is a flag that accepts `=value`.
- `-h`/`--host` refuse because `-h` alone is help and `-h host` is a remote host, so its arity depends on context this host's docs do not settle.
- `-r`/`-t` (`--role`/`--type`, SELinux builds) are absent from this host's `man sudo`, so they are left unlisted and refuse: a row is admitted only when verified against a local binary (the [#963] precedent).

### The scan

```typescript
function innerCommandIndex(words: readonly CommandWord[]): number {
  const name = wrapperName(words);
  if (name === undefined) return -1;
  const execFlag = execFlagIndex(name, words.slice(1).map((w) => w.text));
  if (execFlag !== -1) return execFlag + 2;
  const grammar = GETOPT_GRAMMARS.get(name);
  return grammar ? getoptInnerIndex(words, grammar) : tableInnerIndex(words, name);
}
```

`getoptInnerIndex` walks from index 1:

- `--` → the next index; `NAME=value` → skip; a word not led by `-` → that index is the inner command.
- `--name[=value]` → resolve `name` (exact, else unique prefix over every key); `refuse` or unresolved → `-1`; `value` without `=` consumes the next word; `flag` accepts an attached `=value`.
- `-xyz` → walk letters; `refuse` or absent → `-1`; `value` ends the cluster, consuming the rest as its value, or the next word when the rest is empty; `flag` continues.

A computed word is handled exactly as today: the walk reads source `text`, and a refusal can only keep a floor.
Words run out → `-1`, as today.

## Module-Level Changes

- `src/access-intent/bash/wrapper-analysis.ts`
  - Step 1: extract the option walk from `innerCommandIndex` into `tableInnerIndex(words, name)`, below it.
  - Step 2: add `OptionArity`, `GetoptGrammar`, `GETOPT_GRAMMARS`, `SUDO_GRAMMAR` (seed rows), and `getoptInnerIndex`; `innerCommandIndex` dispatches; drop the `sudo` row from `VALUE_TAKING_FLAGS` and correct its doc comment (it is read by `floorExemptionOf`'s peel and by `admittedValueTaking`); update `innerCommandIndex`'s doc comment.
  - Step 3: complete `SUDO_GRAMMAR` from the verified listing, with a comment on why each refusing row refuses.
- `test/access-intent/bash/wrapper-analysis.test.ts`: new `describe("a sudo layer")` blocks under `executedUnitOf`, `floorExemptionOf`, and `inlineShellPayloadIndex` (steps 2 and 3).
- `test/handlers/gates/bash-command.test.ts`: new `describe("resolveBashCommandCheck: a sudo layer's own options")` beside the shell no-op block, reusing `decide` (steps 2 and 3).
- `docs/configuration.md`: the "Declarations and privilege" subsection gains a sentence that `sudo`'s edit, shell, login, chdir, and chroot modes keep the floor, and an unlisted option does too (step 4).
- `docs/architecture/architecture.md`: the `wrapper-analysis.ts` module-tree entry names the getopt grammar and its refusal rule; this issue's roadmap step gets `✅` on its heading and its Mermaid node `S1042`, plus a `Landed:` note (step 4).

Predicted unchanged, each a falsifiable claim:

- `src/handlers/gates/bash-command.ts`, `src/access-intent/bash/command-enumeration.ts`, `src/types.ts`: every consumer already treats `-1` as "no peel" (`unwrapIndirection`, `inlineShellPayloadIndex`), confirmed by the Tidy-First assessor's read.
- `test/access-intent/bash/program.test.ts` and `test/service/bash-advisory-check.test.ts`: their sudo shapes (`sudo -u root aws s3 rm`, `timeout -- 5 sudo rm x`) peel identically under the grammar.
- Existing `wrapper-analysis.test.ts` and `bash-command.test.ts` sudo cases (`-u root`, `-n`, `--`, `--unknown-opt`): all 18 sites grepped (`sudo +-[-A-Za-z=]+`) keep their outcome; `time sudo --unknown-opt` now stops at the sudo layer instead of after it, with the same floored result.
- ADR 0013 §11: "any wrapper whose inner command is unresolvable (`executedUnitOf` fails to `null`) keeps the floor" already covers a refused mode.
- `README.md`: names `sudo` only as a floored wrapper, still true.
- `.pi/skills/package-pi-permission-system/SKILL.md`: describes the floor and its two exemptions, not the option tables.

No new import edge: every addition is private to `wrapper-analysis.ts`.

## Test Impact Analysis

- New tests the change enables: per-shape assertions on the sudo grammar through the exported `executedUnitOf`, `floorExemptionOf`, and `inlineShellPayloadIndex`; the scanner stays private, tested through those consumers as the existing walk is.
- Redundant tests: none; the existing sudo cases pin outcomes the grammar must preserve.
- Tests that stay as-is: the `floorExemptionOf` "a wrapper running a proven pure reader" (`sudo grep foo /etc/hosts`, `sudo -n true`), "an execution modifier > refused" (`time sudo rm -rf x`, `time sudo --unknown-opt`), and `inlineShellPayloadIndex` (`sudo -u root bash -c 'x'` → 5) blocks.

## Invariants at risk

- [#803] (core-reader exemption): a sudo-wrapped pure reader stays exempt.
  Pinned by `wrapper-analysis.test.ts` "a wrapper running a proven pure reader" (`sudo grep foo /etc/hosts`, `sudo -n true`) and `bash-command.test.ts` "a wrapper running a shell no-op" (`sudo -n true`, real resolver).
  Constituency: users relying on relief for `sudo cat`-style reads; the measured 0 log hits mean no observed shape loses relief.
- [#963] (execution-modifier clause): a sudo layer is never a modifier; pinned by "an execution modifier > refused" (`time sudo rm -rf x`, `sudo time pnpm test`, `time sudo --unknown-opt`).
- [#923] (payload query peels as `executedUnitOf` does): `sudo -u root bash -c 'x'` → 5 stays pinned; step 2 adds `sudo -e bash -c 'x'` → `-1` beside `executedUnitOf` → `null` for the same unit, so both refuse together.
- [#1027]'s `timeout -- 5 sudo rm x` → `rm x` (`program.test.ts`): `--` handling in the `timeout` table walk is untouched.

## TDD Order

1. `refactor(pi-permission-system): extract the wrapper option walk from innerCommandIndex`
   - Prepares the Tidy-First friction: `innerCommandIndex` mixes the exec-flag short-circuit, the table walk, and `--`/leading-operand handling, so a grammar dispatch would otherwise land inside a 40-line loop.
   - Move the walk into `tableInnerIndex(words, name)` (keeps `operandPending`; no sudo-only parameter).
   - Verify: the full package suite and `pnpm --filter @gotgenes/pi-permission-system run check` stay green with no test edits.
2. `fix(pi-permission-system): sudoedit and sudo's clustered or long options no longer earn the pure-reader exemption`
   - Red, in `wrapper-analysis.test.ts` and `bash-command.test.ts` (policy `{"*": "allow", "rm *": "deny"}`):
     - Refused (`floorExemptionOf` → `undefined`, `executedUnitOf` → `null`, gate → ask `<indirection-bash-wrapper>`): `sudo -e cat`, `sudo --edit true`, `sudo -ne cat`, `sudo --ed cat`, `sudo -Z cat` (unlisted letter).
     - Nested: `timeout 5 sudo -e cat` → `executedUnitOf` = `sudo -e cat`, not exempt.
     - Payload: `inlineShellPayloadIndex("sudo -e bash -c 'x'")` → `-1`.
     - Value consumed: `sudo -nu cat rm x`, `sudo --user cat rm x` → `executedUnitOf` = `rm x`, gate ask.
     - Abbreviation resolves: `sudo --us root cat x` → `core-reader`, `executedUnitOf` = `cat x`.
     - Attached value: `sudo -uedward cat` and `sudo --user=root cat x` → `core-reader`.
   - Green: the grammar types, `getoptInnerIndex`, the dispatch, and a seed `SUDO_GRAMMAR`: short `n` flag, `u g p C U` value, `e` refuse; long `user group` value, `edit` refuse.
     Drop the `sudo` row from `VALUE_TAKING_FLAGS`; correct its doc comment.
   - Killing mutations, one per class:
     - Delete the `GETOPT_GRAMMARS` dispatch line → `sudo -e cat` exempt again (kills the refused class).
     - Make an absent short letter a `flag` → kills `sudo -Z cat`.
     - Make a value-taking letter not consume the next word when it ends a cluster → `sudo -nu cat rm x` exempt (kills the value class).
     - Continue the cluster walk after a value-taking letter → `-uedward` hits `e` and refuses (kills the attached-value test).
     - Require an exact long-name match → `sudo --us root cat x` refuses (kills the abbreviation test).
     - Make a `value` long option without `=` not consume → `sudo --user cat rm x` exempt (kills).
3. `fix(pi-permission-system): sudo's shell, login, chdir, and chroot modes keep the indirection floor`
   - Verify one row first: `man sudo | col -b | grep -nE "^ +-[A-Za-z], --|^ +-[A-Za-z] [a-z]"` printed, at planning time, `-A, --askpass`, `-B, --bell`, `-b, --background`, `-C num, --close-from=num`, `-D directory, --chdir=directory`, `-E, --preserve-env`, `-e, --edit`, `-g group, --group=group`, `-H, --set-home`, `-h, --help`, `-h host, --host=host`, `-i, --login`, `-K, --remove-timestamp`, `-k, --reset-timestamp`, `-l, --list`, `-N, --no-update`, `-n, --non-interactive`, `-P, --preserve-groups`, `-p prompt, --prompt=prompt`, `-R directory, --chroot=directory`, `-S, --stdin`, `-s, --shell`, `-U user, --other-user=user`, `-T timeout, --command-timeout=timeout`, `-u user, --user=user`, `-V, --version`, `-v, --validate`.
     Re-run it and fill the rows from its output, not from this list.
   - Red:
     - Refused, one `it.each` row per mode: `sudo -D /etc cat shadow`, `sudo --chdir /etc cat shadow`, `sudo -R /x cat y`, `sudo -s cat x`, `sudo --shell cat x`, `sudo -i cat x`, `sudo --lo cat x`, `sudo -h host cat x`.
     - Ambiguous abbreviation refuses: `sudo --l cat x` (`list`/`login`), `sudo --pre cat x` (`preserve-env`/`preserve-groups`).
     - Admitted rows stay transparent: `sudo -E cat x`, `sudo -H cat x`, `sudo --preserve-env=PATH cat x`, `sudo -T 5 cat x`, `sudo --close-from 3 cat x` → `core-reader`.
     - Gate: `sudo -D /etc cat shadow` and `sudo -s cat x` ask; `sudo -E cat x` allows by `*` with `core-reader`.
   - Green: complete `SUDO_GRAMMAR` per the Design Overview, with a one-line reason on each refusing row.
   - Killing mutations:
     - Change `D` to `value` → `sudo -D /etc cat shadow` exempt (kills one refused row; repeat per row if a row's test survives).
     - Resolve abbreviations over non-refusing keys only → `sudo --l cat x` becomes `--list` and exempt (kills the full-key-set claim).
     - Remove the `E` row → `sudo -E cat x` refuses (kills the admitted class).
     - Change `T` to `flag` → `sudo -T 5 cat x` names `5 cat x` and loses the exemption (kills the value row).
4. `docs(pi-permission-system): document the sudo modes that keep the indirection floor`
   - `docs/configuration.md` "Declarations and privilege": the sentence on refusing modes and unlisted options.
   - `docs/architecture/architecture.md`: the `wrapper-analysis.ts` entry; `✅` on this issue's step heading and Mermaid node `S1042`; a `Landed:` note quoting the step 2 and 3 subjects.
   - Verify: `pnpm exec rumdl check` on both files.

## Risks and Mitigations

- **A refused mode costs relief someone relies on.**
  Mitigation: measured 0 occurrences of any newly floored shape in 23,779 review-log entries; the override is a prompt approval or `yoloMode`.
- **A grammar row is wrong for another sudo build** (Linux SELinux `-r`/`-t`, a future option).
  Mitigation: an unlisted option refuses, so a missing row costs a prompt, never a bypass; a row is admitted only when verified against a local binary.
- **The scanner diverges from getopt on a shape not modelled** (for example, `-p` with a value led by `-`).
  Mitigation: `-p -x cat` consumes `-x` as the prompt exactly as getopt does, because a `value` letter takes the next word unconditionally; the step 2 value-class tests pin consumption.
- **PR [#971] rebases over a changed `innerCommandIndex`.**
  Mitigation: the function keeps its signature and `-1` contract, so the PR's call site is unaffected.

## Open Questions

- Whether [#1053]'s grammars for `env` and `xargs` share `GetoptGrammar` unchanged or need a leading-operand field: settled when that step plans; this plan adds no field it does not use.

[#680]: https://github.com/gotgenes/pi-packages/issues/680
[#803]: https://github.com/gotgenes/pi-packages/issues/803
[#923]: https://github.com/gotgenes/pi-packages/issues/923
[#963]: https://github.com/gotgenes/pi-packages/issues/963
[#971]: https://github.com/gotgenes/pi-packages/pull/971
[#1027]: https://github.com/gotgenes/pi-packages/issues/1027
[#1053]: https://github.com/gotgenes/pi-packages/issues/1053
