---
issue: 1053
issue_title: "pi-permission-system: env and xargs option gaps misplace the wrapped command, and env -C earns core-reader with a moved cwd"
---

# `env`, `xargs`, and `doas` find their inner command by their real option grammar

## Release Recommendation

**Release:** ship independently

Phase 15's roadmap step for this issue is tagged `Release: independent` and belongs to no release batch; every behavior step is a `fix:` that closes a fail-open in the wrapper peel.

## Problem Statement

The wrapper peel in `src/access-intent/bash/wrapper-analysis.ts` finds a wrapper's inner command by skipping its options, consuming a following value only for the options `VALUE_TAKING_FLAGS` lists.
Since [#803], `floorExemptionOf` judges the command that peel names, so a wrong table entry decides which rule resolves the unit: when the misplaced word is a pure-reader core word, the unit earns `core-reader` and resolves by the wrong command's rule.
[#1042] fixed this for `sudo` with a getopt-faithful grammar; this issue is the same class on `env` and `xargs`, plus an audit of the other wrappers.

`env -C`/`--chdir` is the second half: it parses correctly today, but moving the working directory moves where the inner command's relative operands resolve, so the path surfaces judge `shadow` against the agent's cwd while `env -C /etc cat shadow` reads `/etc/shadow`.

Planning's audit found the class wider than the issue's rows (see Design Overview), including two wrappers (`watch`, GNU `parallel`) that hand their command line to a shell, so a core-looking first word stands for a program the peel never parsed.

## Goals

- `env`, `xargs`, and `doas` locate their inner command through [#1042]'s `GETOPT_GRAMMARS` dispatch, each grammar admitted row by row from a real binary's `--help`, `man` page, or optstring (verified at planning time, below); anything unlisted refuses the peel.
- `env -C`/`--chdir`, `-S`/`--split-string`, `-P` (BSD altpath), `-a`/`--argv0` (GNU), and `--env0-from` refuse the peel (operator decision: refuse all three binary-selecting options); `xargs -J` refuses; `doas -s` and `-C` refuse.
- GNU's optional-argument options (`xargs -i`, `-l`, `-e`, `--replace[=R]`, `--eof[=END]`; `env --block-signal[=SIG]` and kin) take only an attached value, never the next word.
- `xargs` and `doas` do not skip `NAME=value` words (they exec such a word as the command); `env` and `sudo` still do.
- A lone `env -` ends `env`'s options (it clears the environment).
- `watch`, `parallel`, `rush`, and `rust-parallel` never earn the `core-reader` exemption; their display peel (`executedUnitOf`) and payload query (`inlineShellPayloadIndex`) are unchanged.
- Under `bash: {"*": "allow", "rm *": "deny"}`, every row of the "Today" table below asks with `<indirection-bash-wrapper>`, while `xargs grep foo`, `xargs -0 -n1 grep foo`, `xargs -I{} cat {}`, `env -i cat x`, `env -u FOO cat x`, and `doas -u root cat x` keep `core-reader`.
- Not breaking: `fix:` (the roadmap's tag); it tightens fail-opens, and every newly floored shape has 0 organic hits in the local review log (measured, below).

## Non-Goals

- The remaining table-walk wrappers (`time`, `timeout`, `nice`, `stdbuf`, `flock`, `setsid`) and GNU `time`'s abbreviated `--out`/`--form` (`env time --out cat rm x` earns `core-reader` and runs `rm x`): filed as [#1057], deferred to a later phase (operator decision).
- An unquoted computed word in a peeled layer's options (`env -u $U cat x`, `xargs -n $N cat`): [#1056], the next Phase 15 step, which reshapes the same peel.
- `env PATH=/x cat …` stays exempt: planting a binary on that path needs an earlier write the gate already judges, and refusing it is a different decision from refusing `-P` (pre-existing, unchanged).
- `watch -x` (exec instead of `sh -c`) is not admitted back: one refusal set is simpler than a per-option exception for a 0-hit shape.
- Display accuracy for `parallel`/`rush`/`rust-parallel` (`parallel -j 4 cat ::: x` names `4 cat ::: x`): they keep their table reading, and the refusal makes the exemption question moot.
- A per-rule or config lever lifting the floor: [#680]'s and PR [#971]'s question, as in [#1042].
- The shared structured command description replacing per-command grammars: the [#963] retro's phase-handoff candidate, unchanged.
- `scripts/measure-wrapper-transparency.mjs`: it transcribes the wrapper tables deliberately so a re-run stays comparable to its recorded figures; predicted unchanged.

## Background

`wrapper-analysis.ts` (872 lines) owns the wrapper vocabulary.
`innerCommandIndex(words)` returns where a wrapper layer's inner command starts, or `-1`; since [#1042] it dispatches a wrapper with a `GETOPT_GRAMMARS` entry to `getoptInnerIndex` and every other wrapper to `tableInnerIndex`.
`getoptInnerIndex` walks options (`shortClusterWords`, `longOptionWords`, `resolveLongOption`), then skips `NAME=value` words unconditionally, then answers the command's index; a lone `-` stops the option walk and is taken as the command.

Consumers of the peel, all treating `-1` as "no peel":

- `unwrapIndirection` → `floorExemptionOf` (gate) and `executedUnitOf` (display).
- `inlineShellPayloadIndex` (payload masking, the [#923] rule that it peels exactly as `executedUnitOf` does).
- PR [#971] (third-party, open) calls `innerCommandIndex` for its `xargs` pin, so it inherits the grammar.
- PR [#1054] (third-party, open) reads `VALUE_TAKING_FLAGS.get("xargs")` directly in a new session-prefix walk; it would need the grammar after this lands.

`VALUE_TAKING_FLAGS` has exactly two readers (verified by the Tidy-First assessor): `tableInnerIndex` and `admittedValueTaking`, and the latter runs only for `EXECUTION_MODIFIER_FLAGS` names (`time`/`timeout`/`nice`/`stdbuf`/`setsid`), so dropping the `env`, `xargs`, and `doas` rows cannot change the [#963] modifier clause.

The gate (`resolveWrapperUnit` in `src/handlers/gates/bash-command.ts`) resolves an exempt unit by `executedUnit`'s text on the `bash` surface, which is why a misplaced inner command bypasses an `rm *` deny; no change is needed there.

## Design Overview

### How the evidence was produced

- **Gate decisions** are measured through the real code path: a disposable Vitest spike ran `BashProgram.parseSync` → `resolveBashCommandCheck` with a real `PermissionResolver` over `createInMemoryManager`, policy `bash: {"*": "allow", "rm *": "deny"}`, on current `main` (95 shapes); the spike was deleted afterwards.
- **What really runs** is measured live, never read from documentation alone:
  - BSD `env`/`xargs` on this macOS 26.6 host (`/usr/bin/env`, `/usr/bin/xargs`).
  - GNU `env` as Homebrew's `genv` (coreutils 9.12).
  - GNU `xargs` (findutils 4.9.0), procps `watch`, util-linux `flock`/`setsid`, GNU `time`, GNU `parallel` (20231122), and `opendoas` in a disposable `ubuntu:24.04` container (`--rm`; `--network none` except where `apt-get` installed `time`, `parallel`, `opendoas`; `doas` ran as root inside the container under a throwaway `permit nopass root` rule).
  - Probes used `echo`/`pwd`/`touch /tmp/W` as the inner command; nothing privileged ran on the host.
- **Exposure** is measured against the live review log (`~/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl`, 23,921 lines, 13,873 bash entries).
  The only `env -P`, `env -S`, and `xargs -J` entries are the probes from the session that filed this issue (2026-10-09T01:56Z); every other newly floored shape has 0 hits.
  `watch`, `parallel`, `rush`, `rust-parallel`, and `doas` have 0 real invocations (their matches are prose inside other commands).

### Today

Every row allows by `*` with `floorExemption: "core-reader"`:

| Command                                                                          | `executedUnit` | What really runs                                             |
| -------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------ |
| `env -P cat rm x`                                                                | `cat rm x`     | `rm x`, searched for in `cat` (BSD)                          |
| `env -Srm cat`                                                                   | `cat`          | `rm cat` (`-S` splits its value into words)                  |
| `env -C /etc cat shadow`, `env --chdir /etc cat shadow`, `env -C/etc cat shadow` | `cat shadow`   | `cat /etc/shadow`                                            |
| `env -a cat rm x`, `env --argv0 cat rm x`, `env --a cat rm x`                    | `cat rm x`     | `rm x` with argv0 `cat` (GNU)                                |
| `xargs -J cat rm x`                                                              | `cat rm x`     | `rm x` (BSD `-J replstr`)                                    |
| `xargs -i rm cat x`, `xargs -l rm cat x`                                         | `cat x`        | `rm cat x` (GNU: `-i`/`-l` take only an attached value)      |
| `watch cat x \; rm y`                                                            | `cat x`        | `sh -c "cat x ; rm y"` (verified: a `touch` probe ran)       |
| `parallel cat x \; rm y ::: a`                                                   | `cat x`        | the same: GNU `parallel` runs its command through a shell    |
| `doas -a cat rm x`                                                               | `cat rm x`     | `rm x` as root (OpenBSD `-a style`; `opendoas` rejects `-a`) |
| `sudo env -C /etc cat shadow`                                                    | `cat shadow`   | `cat /etc/shadow` as root                                    |

Shapes that ask today only by accident, and whose corrected reading was checked against what then runs (the issue's constraint):

| Command                                         | Today              | After         | Why the exemption is then correct                                                                                                                    |
| ----------------------------------------------- | ------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `xargs -R 1 cat rm x`, `xargs -S 255 cat`       | ask (`1 cat rm x`) | `core-reader` | Without `-I`, both BSD and GNU `xargs` exit with a usage error and run nothing; with `-I` they run exactly `cat rm x`                                |
| `xargs -I {} -R 1 cat rm x`                     | ask                | `core-reader` | runs `cat rm x`; `-I` replaces nothing in the utility position on BSD or GNU (verified: `echo pwd \| xargs -I % %` → `%: No such file or directory`) |
| `xargs --max-args 1 cat`, `xargs --max-a 1 cat` | ask                | `core-reader` | runs `cat`                                                                                                                                           |
| `env --un FOO cat x`, `env -iu FOO cat rm x`    | ask                | `core-reader` | runs `cat x` / `cat rm x`                                                                                                                            |

### Verified grammar facts

`env` (BSD optstring `-0C:iP:S:u:v`, from `strings /usr/bin/env`; no long options; options are recognized only before `NAME=value`):

- `env -L foo true` → `illegal option -- L`; `env --chdir /tmp pwd` → `illegal option -- c` (BSD has no long options).
- `env -C/etc pwd` and `env -P/bin echo hi` work attached; `env - …` clears the environment and runs the command; `env FOO=1 -i true` → `-i: No such file or directory`.

GNU `env` (`genv --help`, coreutils 9.12):

- Short `-a ARG`, `-i`, `-0`, `-u NAME`, `-C DIR`, `-S S`, `-v`; long `argv0`, `ignore-environment`, `env0-from`, `null`, `unset`, `chdir`, `split-string`, `block-signal[=SIG]`, `default-signal[=SIG]`, `ignore-signal[=SIG]`, `list-signal-handling`, `debug`, `help`, `version`.
- `genv --ignore-signal PIPE echo x` → `'PIPE': No such file or directory` (optional argument, attached only); `genv --i …` and `genv --d …` → ambiguous; `genv --ch /etc pwd` → `/private/etc`; `genv -a cat echo hi` → `hi`.

`xargs` (BSD optstring `+0E:I:J:L:n:oP:pR:S:s:rtx`, long `exit interactive max-args max-chars max-procs no-run-if-empty null verbose`, from `strings /usr/bin/xargs`; GNU findutils 4.9.0 `xargs --help` in the container):

- GNU adds `-a FILE`, `-d CHAR`, `-e[END]`, `-i[R]`, `-l[N]`, `--arg-file`, `--delimiter`, `--eof[=END]`, `--replace[=R]`, `--max-lines`, `--open-tty`, `--process-slot-var`, `--show-limits`, `--help`, `--version`.
- `echo q | xargs -i echo pwd {}` → `pwd q` and `xargs -l echo x` → `x q` (GNU: optional, attached only).
- `echo pwd | xargs -J % %` → `/tmp` (BSD: `-J` replaces the utility position when it equals the replstr).
- `echo q | xargs FOO=1 echo` → `FOO=1: No such file or directory` on both.
- `echo q | xargs -n1t echo` → `-n 1t: invalid` (a value letter takes the rest of its cluster); `xargs --max-a 1 echo` and `--ver` work on BSD.
- No short letter has different arities on the two platforms, and BSD's long names are a subset of GNU's.

`doas` (`opendoas`, `usage: doas [-Lns] [-C config] [-u user] command [args]`):

- `doas echo -n hi` → `hi` (no option permutation), `doas -nu root echo clustered`, `doas -uroot echo attached`, and `doas -- echo dd` work.
- `doas FOO=1 echo x` → `FOO=1: command not found`; `doas -a x …` → `invalid option -- 'a'`; `doas -C /etc/doas.conf echo hi` → `permit nopass` (checks the config, runs nothing); `doas -s echo hi` → usage error.

### The grammar shape

[#1042]'s `GetoptGrammar` gains one arity and two fields; each field arrives in the step whose grammar first gives its non-default value a user (the Tidy-First assessor's sequencing).

```typescript
/** How a getopt-parsed wrapper treats one of its options. */
type OptionArity = "flag" | "value" | "optional" | "refuse";

interface GetoptGrammar {
  readonly short: ReadonlyMap<string, OptionArity>;
  readonly long: ReadonlyMap<string, OptionArity>;
  /** Whether `NAME=value` words after the options are assignments to skip. */
  readonly assignments: boolean;
  /** Whether a lone `-` is an option that ends the option walk (`env -`). */
  readonly loneDashEndsOptions: boolean;
}
```

- `"optional"` (getopt's `::`): in a short cluster it ends the cluster, taking the rest as its value (`-i{}`), and never consumes the next word (`-i rm cat x`); as a long option it accepts `=value` and never consumes the next word, exactly as `"flag"` does.
- `assignments`: `sudo` and `env` `true`; `xargs` and `doas` `false`.
- `loneDashEndsOptions`: `env` `true` (exact for GNU, which stops parsing at `-`; conservative for BSD, which keeps parsing, since `env - -i cat` then names `-i cat` and keeps the floor); the other three `false` (today's behavior: `-` is the command).

Grammars (one `Map` row per option; anything absent refuses):

- `ENV_GRAMMAR` — short `0 i v` flag, `u` value, `C P S a` refuse; long `ignore-environment null list-signal-handling debug help version` flag, `unset` value, `block-signal default-signal ignore-signal` optional, `chdir split-string argv0 env0-from` refuse.
- `XARGS_GRAMMAR` — short `0 o p r t x` flag, `E I L P R S a d n s` value, `e i l` optional, `J` refuse; long `null interactive no-run-if-empty open-tty show-limits verbose exit help version` flag, `arg-file delimiter max-lines max-args max-procs max-chars process-slot-var` value, `eof replace` optional.
- `DOAS_GRAMMAR` — short `L n` flag, `u` value, `C s` refuse; no long options.
- Every refusing row carries a one-line reason, as `SUDO_GRAMMAR`'s do: `-C` moves where relative operands resolve; `-S` splits one word into several, so the command is built at run time; `-P`, `-a`, and `--env0-from` choose which binary the named command is (an altpath, an argv0 a multi-call binary dispatches on, an environment that may set `PATH`); `xargs -J` puts input in the utility position when it equals the replstr; `doas -C` checks a config and runs nothing, and `-s` runs a shell.
- Long abbreviations resolve against every key of the union, refusing ones included, as [#1042] settled: a prefix unique on BSD but ambiguous in the union (`--ver`: `verbose`/`version`, `--e`: `eof`/`exit`) refuses, which costs only a prompt.

`VALUE_TAKING_FLAGS` loses the `env`, `xargs`, and `doas` rows, leaving `timeout`, `nice`, `time`, `stdbuf`, `watch`, `flock`; its doc comment's `xargs -J cat rm x` example moves to a remaining wrapper, and it names [#1057] as the place those rows go next.

### The scan

`getoptInnerIndex` gains two branches; the shape stays [#1042]'s:

```typescript
if (word === "-") {
  if (grammar.loneDashEndsOptions) { index++; break; }
  break;                                  // `-` is the command, as today
}
// … option walk unchanged …
while (grammar.assignments && index < words.length && isEnvironmentAssignment(words[index].text)) {
  index++;
}
```

`shortClusterWords` returns `1` on an `"optional"` letter; `longOptionWords` treats `"optional"` as `"flag"`.

### Wrappers whose command line the peel does not see

`watch` (without `-x`) and GNU `parallel` run their command line through a shell (both verified in the container), and `rush` and `rust-parallel` are template-building parallelizers with no local binary to verify their evaluation model, so all four refuse the exemption fail-closed.

```typescript
/** Wrappers whose executed command line is not the words the peel sees. */
const OPAQUE_COMMAND_LINE_WRAPPERS = new Set(["watch", "parallel", "rush", "rust-parallel"]);

// floorExemptionOf, beside the existing opaque refusal:
if (
  unwrapped.kind === "opaque" ||
  unwrapped.peeled.length === 0 ||
  unwrapped.peeled.some(runsOpaqueCommandLine)
) {
  return undefined;
}
```

The refusal is checked over every peeled layer, so `sudo watch cat x` and `timeout 5 watch cat x` refuse too.
It sits before both reasons for readability; the Tidy-First assessor confirmed that is behavior-equivalent to guarding only `core-reader`, since none of the four is an execution modifier.
`executedUnitOf` and `inlineShellPayloadIndex` keep peeling these wrappers, so display and payload masking are unchanged: this is ADR 0013 §11's "opaque payloads keep the floor", applied to a payload that arrives as a command line instead of a `-c` argument.

### Edge cases (each tested in the named step)

- Nested refusal: `sudo env -C /etc cat shadow` keeps the floor and `executedUnitOf` names `env -C /etc cat shadow` (step 3).
- Payload consistency ([#923]): `env -C /tmp bash -c 'x'` → `inlineShellPayloadIndex` `-1` beside `executedUnitOf` `null`; `env -i bash -c 'x'` still answers `4` (step 3).
- `xargs -J % bash -c 'x'` → `-1` (step 1).
- A lone `-`: `env - cat x` → `cat x`, exempt; `env - -i cat x` → `executedUnitOf` `null`, not exempt (step 3).
- Unlisted letter or long option: `xargs -Z cat x`, `env -Z cat x`, `doas --user root cat x` → refuse (steps 1, 3, 4).

## Module-Level Changes

- `src/access-intent/bash/wrapper-analysis.ts`
  - Step 1: add the `"optional"` arity (`shortClusterWords`, `longOptionWords`, and the `OptionArity` doc), the `assignments` field (`SUDO_GRAMMAR` gains `assignments: true`), a seed `XARGS_GRAMMAR`, and its `GETOPT_GRAMMARS` entry; drop the `xargs` row from `VALUE_TAKING_FLAGS`; correct `getoptInnerIndex`'s "sudo's `+` optstring" doc and `VALUE_TAKING_FLAGS`'s `xargs -J` example.
  - Step 2: complete `XARGS_GRAMMAR`.
  - Step 3: add `loneDashEndsOptions` (`false` on `SUDO_GRAMMAR` and `XARGS_GRAMMAR`), `ENV_GRAMMAR`, and its entry; drop the `env` row.
  - Step 4: add `DOAS_GRAMMAR` and its entry; drop the `doas` row.
  - Step 5: add `OPAQUE_COMMAND_LINE_WRAPPERS`, a private `runsOpaqueCommandLine(layer)`, and the refusal in `floorExemptionOf`; extend `floorExemptionOf`'s doc comment (condition 2 now names a command line handed to a shell).
- `test/access-intent/bash/wrapper-analysis.test.ts`: new `describe("an xargs layer")`, `describe("an env layer")`, and `describe("a doas layer")` blocks under `executedUnitOf`, `floorExemptionOf`, and `inlineShellPayloadIndex`, beside each `describe("a sudo layer")` (steps 1–4); a `floorExemptionOf` `describe("a wrapper whose command line the peel does not see")` (step 5); a `sudo FOO=1 cat x` row pinning `SUDO_GRAMMAR.assignments` (step 1).
- `test/handlers/gates/bash-command.test.ts`: new `describe("resolveBashCommandCheck: env, xargs, and doas option grammars")` beside the sudo block, reusing `decide` (steps 1–5).
- `test/access-intent/bash/program.test.ts`: the `rust-parallel echo`, `rush echo`, and `watch ls` rows move into the preceding "flags %s as an indirection wrapper" `it.each` (no `floorExemption`), and the "running a pure reader" block is deleted (step 5).
- `docs/configuration.md` (step 6):
  - "A wrapper running a pure reader", clause 2: `watch`, `parallel`, `rush`, and `rust-parallel` hand their command line to a shell (or are unverified), so they never qualify.
  - "Declarations and privilege": after the `sudo` paragraph, a paragraph that `env`, `xargs`, and `doas` are read by their own grammars, naming the refusing modes.
- `docs/architecture/architecture.md` (step 6):
  - The `wrapper-analysis.ts` module-tree entry: `GETOPT_GRAMMARS` covers `sudo`/`env`/`xargs`/`doas`, the `"optional"` arity, the `assignments` and lone-dash fields, the `OPAQUE_COMMAND_LINE_WRAPPERS` refusal, and the verification source widened from "a local `man` page" to "a local binary, `man` page, or disposable container".
  - This issue's roadmap step: `✅` on its heading and Mermaid node `S1053`, its `Target:`/`Outcome:` widened to `doas` and the four wrappers (operator decision, scope B), and a `Landed:` note quoting steps 1–5's subjects.

Predicted unchanged, each a falsifiable claim:

- `src/handlers/gates/bash-command.ts`, `src/access-intent/bash/command-enumeration.ts`, `src/types.ts`: every consumer already treats `-1` as "no peel", and `FloorExemption` gains no value.
- `test/logging/command-redaction.test.ts`: its `xargs -I{} sh -c '…'` and `env MY_KEY=… deploy` shapes peel identically (`-I{}` is one word; `env` still skips assignments).
- `test/service/bash-advisory-check.test.ts`, `test/access-intent/bash/shell-variable-expansion.test.ts` (`env -i HOME="…"`): same peel.
- Existing `wrapper-analysis.test.ts` pins: `xargs -0 -n1 grep foo`, `xargs -I{} rm {}`, `xargs -I{} basename {}`, `xargs --unknown-opt` (→ `null`, now by refusal rather than running out), `sudo timeout 5 xargs --unknown-opt`, `env FOO=bar grep foo`, `time env A=1 pnpm test`, `time xargs pnpm test`, and `watch -n 2 ls` → `ls` (display unchanged).
- `docs/decisions/0013-permission-policy-model.md`: §11's "opaque payloads … and any wrapper whose inner command is unresolvable … keep the floor" covers every refusal here.
- `README.md`, `docs/configuration.md` line 567 (the wrapper list), `.pi/skills/package-pi-permission-system/SKILL.md`: they name wrappers and the two exemptions, not option tables.
- `scripts/measure-wrapper-transparency.mjs` (see Non-Goals).

No new import edge: every addition is private to `wrapper-analysis.ts`.

## Test Impact Analysis

- New tests the change enables: per-shape assertions on each grammar through the exported `executedUnitOf`, `floorExemptionOf`, and `inlineShellPayloadIndex`; the scanner stays private, tested through those consumers as [#1042]'s is.
- Redundant tests: none.
- Tests that change: `program.test.ts`'s three `core-reader` pins on `rust-parallel echo`, `rush echo`, and `watch ls` flip in step 5; they were [#803]'s default rather than a decision (its plan meant to keep inline-shell payloads floored).
- Tests that stay as-is: every `sudo` block ([#1042]), the execution-modifier blocks ([#963]), and the existing `xargs`/`env` pins listed under Module-Level Changes.

## Invariants at risk

- [#803] (core-reader exemption): a wrapped pure reader stays exempt for the shapes people use: `xargs grep foo` (195 log hits), `xargs -n1 basename`, `xargs -I{} grep -l …`, `xargs -0 cat`, `env -u X …`, `env -i HOME=… …`.
  Pinned by `wrapper-analysis.test.ts` "a wrapper running a proven pure reader" and `program.test.ts` (`xargs grep foo`); steps 1–3 add `xargs -0r grep foo`, `xargs -I{} cat {}`, `env -i cat x`, and `env -u FOO cat x` to the gate block with a real resolver.
- [#963] (execution-modifier clause): `time env A=1 pnpm test` and `time xargs pnpm test` stay refused (`wrapper-analysis.test.ts` "an execution modifier > refused"); `admittedValueTaking` reads no dropped row.
- [#923] (the payload query peels as `executedUnitOf` does): `xargs -I{} sh -c '…'` keeps its payload index (`wrapper-analysis.test.ts`, `command-redaction.test.ts`); steps 1 and 3 add the refused pairs (`-1` beside `null`).
- [#1042] (`sudo` grammar): `SUDO_GRAMMAR` gains only `assignments: true` and `loneDashEndsOptions: false`, today's behavior; every sudo block stays green, and step 1 pins `sudo FOO=1 cat x`.

## TDD Order

1. `fix(pi-permission-system): xargs -J and GNU xargs -i/-l no longer earn the pure-reader exemption for the wrong command`
   - Red, in `wrapper-analysis.test.ts` and `bash-command.test.ts` (policy `{"*": "allow", "rm *": "deny"}`):
     - Refused (`floorExemptionOf` → `undefined`, `executedUnitOf` → `null`, gate → ask `<indirection-bash-wrapper>`): `xargs -J cat rm x`, `xargs -J % cat %`, `xargs -Z cat x` (unlisted).
     - Payload: `inlineShellPayloadIndex("xargs -J % bash -c 'x'")` → `-1`.
     - Optional, attached only: `xargs -i rm cat x` and `xargs -l rm cat x` → `executedUnitOf` = `rm cat x`, not exempt, gate ask; `xargs -i{} cat {}` and `xargs -l1 cat x` → `core-reader`; `xargs --replace cat x` and `xargs --replace=% cat %` → `core-reader`.
     - No assignments: `xargs FOO=1 cat` → `executedUnitOf` = `FOO=1 cat`, not exempt.
     - Value consumed: `xargs --max-args 1 cat` → `core-reader` (asks today by accident).
     - Kept: `xargs -0r grep foo`, `xargs -I{} cat {}`, `xargs -n1 cat x` → gate allow, `core-reader`.
     - `sudo FOO=1 cat x` → `core-reader` (pins `SUDO_GRAMMAR.assignments`).
   - Green: `"optional"` arity; `assignments` field (`SUDO_GRAMMAR` `true`); seed `XARGS_GRAMMAR` (short `0 r t` flag, `n I P` value, `i l` optional, `J` refuse; long `null` flag, `max-args` value, `replace` optional; `assignments: false`); the `GETOPT_GRAMMARS` entry; drop the `xargs` table row; the two doc-comment corrections.
   - Killing mutations, one per class:
     - Delete the `xargs` entry from `GETOPT_GRAMMARS` → `xargs -J cat rm x` and `xargs -i rm cat x` exempt again (kills the refused and optional classes).
     - Make a short `"optional"` letter consume the next word when it ends its cluster → `xargs -i rm cat x` names `cat x` (kills the short-optional tests).
     - Make a long `"optional"` consume the next word without `=` → `xargs --replace cat x` names `x` (kills the long-optional test).
     - Skip assignments regardless of the field → `xargs FOO=1 cat` exempt (kills the no-assignment test).
     - Set `SUDO_GRAMMAR.assignments` to `false` → `sudo FOO=1 cat x` loses the exemption (kills the sudo pin).
2. `fix(pi-permission-system): xargs reads every option its BSD and GNU manuals list`
   - Verify one row first: `strings /usr/bin/xargs | grep -E '^\+0'` printed `+0E:I:J:L:n:oP:pR:S:s:rtx` at planning, and `docker run --rm --network none ubuntu:24.04 xargs --help` printed the GNU listing quoted in the Design Overview; re-run both and fill the rows from their output, not from the Design Overview's list.
   - Red:
     - Admitted value rows: `xargs -E END cat x`, `xargs -L 2 cat`, `xargs -s 100 cat`, `xargs -d x cat`, `xargs -a f cat`, `xargs --arg-file f cat`, `xargs --process-slot-var V cat`, `xargs --max-a 1 cat` → `core-reader`.
     - The issue's accidental holds, checked: `xargs -R 1 cat rm x`, `xargs -S 255 cat`, `xargs -I {} -R 1 cat rm x` → `core-reader` (gate allow; see the Design Overview table for why each is correct).
     - Flags: `xargs -p cat`, `xargs -o cat`, `xargs -x cat`, `xargs -tn1 cat x` → `core-reader`.
     - Optional `e`: `xargs -e rm cat x` → names `rm cat x`, not exempt; `xargs -eEND cat x` → `core-reader`.
     - Ambiguous abbreviations refuse: `xargs --ver cat`, `xargs --e cat`.
   - Green: complete `XARGS_GRAMMAR` per the Design Overview.
   - Killing mutations:
     - Change `R` to `"flag"` → `xargs -I {} -R 1 cat rm x` names `1 cat rm x` (kills the value class; repeat per value row whose test survives).
     - Remove the `d` row → `xargs -d x cat` refuses (kills the admitted class).
     - Change `e` to `"value"` → `xargs -e rm cat x` names `cat x` and is exempt (kills the optional row).
3. `fix(pi-permission-system): env's chdir, split-string, altpath, and argv0 modes keep the indirection floor`
   - Verify one row first: `man env | col -b | sed -n '/^SYNOPSIS/,/^DESCRIPTION/p'` (BSD) and `genv --help` (GNU) printed the facts quoted in the Design Overview; re-run both and fill the rows from their output.
   - Red:
     - Refused, one `it.each` row per refusing option: `env -C /etc cat shadow`, `env -C/etc cat shadow`, `env --chdir /etc cat shadow`, `env --chdir=/etc cat shadow`, `env --ch /etc cat shadow`, `env -iC /etc cat shadow`, `env -Srm cat`, `env --split-string rm cat`, `env -P cat rm x`, `env -P/bin cat x`, `env -a cat rm x`, `env --argv0 cat rm x`, `env --a cat rm x`, `env --env0-from /dev/null cat x`.
     - Unlisted and ambiguous refuse: `env -Z cat x`, `env --i cat x`, `env --d cat x`.
     - Nested: `sudo env -C /etc cat shadow` → not exempt, `executedUnitOf` = `env -C /etc cat shadow`.
     - Payload: `env -C /tmp bash -c 'x'` → `-1` beside `executedUnitOf` `null`; `env -i bash -c 'x'` → `4`.
     - Kept: `env -i cat x`, `env -u FOO cat x`, `env -uFOO cat x`, `env --unset FOO cat x`, `env --un FOO cat x`, `env -iu FOO cat rm x` (→ `cat rm x`), `env FOO=1 cat x`, `env -i HOME=/h cat x`, `env --ignore-signal cat x`, `env --ignore-signal=PIPE cat x`, `env -v cat x`, `env --debug cat x` → `core-reader`.
     - Lone dash: `env - cat x` → `cat x`, exempt; `env - -i cat x` → `null`, not exempt.
     - Gate: every refused row above asks with `<indirection-bash-wrapper>`; `env -i cat x` and `env - cat x` allow by `*` with `core-reader`.
   - Green: `loneDashEndsOptions` (`false` on `SUDO_GRAMMAR` and `XARGS_GRAMMAR`), the lone-dash branch, `ENV_GRAMMAR` with a reason on each refusing row, its entry; drop the `env` table row.
     The lone-dash branch lands with its only user rather than ahead of it, so no step carries an unreachable branch.
   - Killing mutations:
     - Change each refusing row in turn to the arity that would make it transparent (`C`, `P`, `S`, `a` → `"value"`; `chdir`, `split-string`, `argv0`, `env0-from` → `"value"`), each killed by its own row.
     - Set `ENV_GRAMMAR.loneDashEndsOptions` to `false` → `env - cat x` names `- cat x` → `null` (kills the lone-dash test).
     - Make the lone dash continue the option walk instead of ending it → `env - -i cat x` exempt (kills the GNU-ending test).
     - Set `ENV_GRAMMAR.assignments` to `false` → `env FOO=1 cat x` loses the exemption.
4. `fix(pi-permission-system): doas -a, -C, and -s keep the indirection floor`
   - Verify one row first: `docker run --rm ubuntu:24.04 sh -c 'apt-get update -qq && apt-get install -y -qq opendoas >/dev/null && doas'` printed `usage: doas [-Lns] [-C config] [-u user] command [args]`; re-run it and fill the rows from that line.
   - Red:
     - Refused: `doas -a cat rm x`, `doas -C /etc/doas.conf cat x`, `doas -s cat x`, `doas --user root cat x` → `undefined`/`null`; gate asks.
     - Kept: `doas cat x`, `doas -u root cat x`, `doas -uroot cat x`, `doas -nu root cat x`, `doas -- cat x` → `core-reader`.
     - No assignments: `doas FOO=1 cat x` → names `FOO=1 cat x`, not exempt.
   - Green: `DOAS_GRAMMAR` (`assignments: false`, `loneDashEndsOptions: false`), its entry; drop the `doas` table row.
   - Killing mutations: delete the `doas` entry → `doas -a cat rm x` exempt; change `C` to `"value"` → `doas -C /etc/doas.conf cat x` exempt; set `assignments` to `true` → `doas FOO=1 cat x` exempt.
5. `fix(pi-permission-system): watch and the parallelizers no longer earn the pure-reader exemption`
   - Red:
     - `floorExemptionOf` → `undefined`: `watch cat x`, `watch -x cat x`, `parallel cat ::: a`, `rush cat`, `rust-parallel cat`, `sudo watch cat x`, `timeout 5 watch cat x`.
     - Display unchanged: `executedUnitOf("watch -n 2 ls")` stays `ls` (existing pin).
     - Gate: `watch cat x \; rm y` and `parallel cat x \; rm y ::: a` ask with `<indirection-bash-wrapper>`.
     - `program.test.ts`: move `rust-parallel echo`, `rush echo`, and `watch ls` into the "flags %s as an indirection wrapper" `it.each` (no `floorExemption`) and delete the "running a pure reader" block, in this commit.
   - Green: `OPAQUE_COMMAND_LINE_WRAPPERS` (a comment on why each member is there: verified shell evaluation for `watch`/`parallel`, no local binary for `rush`/`rust-parallel`), `runsOpaqueCommandLine`, the refusal, and the doc-comment update.
   - Killing mutations: delete the `.some(runsOpaqueCommandLine)` clause → every row exempt again; remove each member of the set in turn, each killed by its own row; make the check read only the outermost layer → `sudo watch cat x` exempt.
6. `docs(pi-permission-system): document the env, xargs, doas, and command-line wrapper floors`
   - `docs/configuration.md`: clause 2 of "A wrapper running a pure reader" and the "Declarations and privilege" paragraph.
   - `docs/architecture/architecture.md`: the `wrapper-analysis.ts` entry; this step's `✅` on its heading and Mermaid node `S1053`, its widened `Target:`/`Outcome:`, and a `Landed:` note quoting steps 1–5's subjects.
   - Verify: `pnpm exec rumdl check` on both files.

## Risks and Mitigations

- **A refused shape costs relief someone relies on.**
  Mitigation: measured 0 organic occurrences of any newly floored shape in 13,873 bash review-log entries; the override is a prompt approval or `yoloMode`.
- **A union grammar admits an option one platform rejects.**
  Mitigation: that platform's tool exits with a usage error and runs nothing, while the peel names what runs where the option is valid; no short letter has different arities across the two platforms (verified for `env` and `xargs`).
- **A grammar row is wrong for a build not checked** (busybox `env`/`xargs`, OpenBSD `doas`).
  Mitigation: an unlisted option refuses, so a missing row costs a prompt, never a bypass; OpenBSD's `-a` is unlisted and refuses.
- **Payload masking narrows for refused shapes** (`env -C dir bash -c '…'`, `xargs -J % bash -c '…'` answer `-1`).
  Mitigation: the [#923] rule requires the payload query and `executedUnitOf` to agree, as [#1042] accepted for `sudo -e`; 0 log hits.
- **PR [#1054] reads `VALUE_TAKING_FLAGS.get("xargs")` and loses its row.**
  Mitigation: flag it on that PR at ship time; its walk should read the grammar.
  PR [#971]'s `innerCommandIndex` call keeps its signature and `-1` contract.
- **[#1056] reshapes the same peel next.**
  Mitigation: it is sequenced after this step; nothing here touches the `computed` bit.

## Open Questions

- Whether [#1057]'s move of the remaining table wrappers can delete `tableInnerIndex` outright once `watch`, `flock`, and the parallelizers have grammars: settled when that issue plans.

[#680]: https://github.com/gotgenes/pi-packages/issues/680
[#803]: https://github.com/gotgenes/pi-packages/issues/803
[#923]: https://github.com/gotgenes/pi-packages/issues/923
[#963]: https://github.com/gotgenes/pi-packages/issues/963
[#971]: https://github.com/gotgenes/pi-packages/pull/971
[#1042]: https://github.com/gotgenes/pi-packages/issues/1042
[#1054]: https://github.com/gotgenes/pi-packages/pull/1054
[#1056]: https://github.com/gotgenes/pi-packages/issues/1056
[#1057]: https://github.com/gotgenes/pi-packages/issues/1057
