---
issue: 1053
issue_title: "pi-permission-system: env and xargs option gaps misplace the wrapped command, and env -C earns core-reader with a moved cwd"
---

# Retro: #1053 — pi-permission-system: env and xargs option gaps misplace the wrapped command, and env -C earns core-reader with a moved cwd

## Stage: Planning (2026-10-09T05:53:08Z)

### Session summary

I reproduced the issue's rows and audited every other wrapper through the real parse and gate, using a disposable spike over 95 shapes.
I verified what really runs live: BSD `env`/`xargs` on the host, GNU `env` as `genv`, and GNU `xargs`, procps `watch`, GNU `parallel`, GNU `time`, and `opendoas` in a throwaway `ubuntu:24.04` container.
The operator chose scope B: `env`, `xargs`, and `doas` grammars on [#1042]'s dispatch, plus refusing the exemption for `watch`, `parallel`, `rush`, and `rust-parallel`.
The operator also chose that env's binary-selecting options (`-P`, `-a`, `--env0-from`) refuse the peel.
The plan has six steps: five `fix:` steps and one docs step.
I filed [#1057] (the remaining table wrappers, including GNU `time --out`), and it was deferred to a later phase.

### Observations

- The audit found more than the issue's rows:
  - GNU `env -a cat rm x` runs `rm x`.
  - GNU `xargs -i rm cat x` and `-l rm cat x` run `rm cat x`: the table consumes the next word, but these options take only an attached value.
  - `watch cat x \; rm y` and `parallel cat x \; rm y ::: a` hand the command line to a shell; a `touch` probe ran in the container.
  - OpenBSD `doas -a cat rm x` runs `rm x` as root.
  - `env time --out cat rm x` runs `rm x`; that one is deferred as [#1057].
- `xargs -I` replaces nothing in the utility position on either BSD or GNU (verified).
  BSD `-J` does, so `-J` refuses rather than getting a new "replstr equals the utility" check.
- `xargs` and `doas` exec a `NAME=value` word as the command, so the grammar gains an `assignments` field.
  A lone `env -` gets `loneDashEndsOptions`.
- GNU's optional-argument options need a fourth `"optional"` arity.
  This answers [#1042]'s open question about whether `GetoptGrammar` needed new fields.
- The issue's accidental holds (`xargs -R 1 cat rm x`, `-S 255 cat`) become exemptions once their values are consumed correctly.
  That is correct: without `-I`, `xargs` exits with a usage error, and with it the command runs exactly `cat rm x`.
- Exposure: 0 organic review-log hits for every newly floored shape (23,921 lines).
  The `env -P`/`-S`/`xargs -J` entries are the probes from the session that filed this issue.
- `program.test.ts` pins `rush echo`/`watch ls`/`rust-parallel echo` as `core-reader`.
  That was [#803]'s default, not a decision, and the pins flip in step 5.
- PR [#1054] (third-party, open) reads `VALUE_TAKING_FLAGS.get("xargs")`, which this plan drops.
  Flag it at ship time.
- The `tidy-first-assessor` recommended no preparatory commit.
  It advised adding each `GetoptGrammar` field in the step whose grammar first needs its non-default value.
  It also reported that `pnpm fallow inspect` fails on a boundary config error (`pi-subagents/*` zones undefined).
  That is unrelated to this change, but the implementing session may hit it.

#### Deferred tidyings

- `src/access-intent/bash/wrapper-analysis.ts`: consolidating `VALUE_TAKING_FLAGS`, `WRITING_OPTIONS`, and `EXECUTION_MODIFIER_FLAGS`.
  The assessor rejected it as scope creep; [#1057] is its natural home.

## Stage: Implementation — TDD (2026-10-10T04:10:51Z)

### Session summary

All six plan steps landed in order.
Three were grammars on [#1042]'s dispatch: `xargs` (in two steps, mechanism with seed rows and then the remaining rows), `env`, and `doas`.
The other three were the `OPAQUE_COMMAND_LINE_WRAPPERS` refusal for `watch`/`parallel`/`rush`/`rust-parallel` and the docs step.
The pre-completion reviewer's round 1 returned **FAIL**, and a seventh `fix:` commit corrected it.
The `pi-permission-system` suite went from 5779 to 5951 tests (+172).

### Observations

- **Reviewer FAIL, fixed:** GNU `xargs --max-lines` takes its value attached only, though `--help` prints `-L, --max-lines=MAX-LINES` like a required argument and the short `-L` does take the next word.
  I had listed it as `"value"`, so `xargs --max-lines rm cat x` was allowed as `core-reader` while `rm cat x` ran; the base tree asked on that shape, so step 2 had opened a regression.
  The fix (`fix(pi-permission-system): GNU xargs --max-lines no longer earns the pure-reader exemption for the wrong command`) makes it `"optional"`, and the delta re-review returned **PASS**.
  That review probed every GNU and BSD `xargs` and `env` option, separate and attached, against the binaries and found no other mismatch.
- **Lesson:** a `--help` line is not the binary's arity.
  My per-row mutation loop proves each row has a killing test, not that the row is right.
  Only running each option, separately and attached, against the binary (as the reviewer did) checks the row itself.
  Planning verified each row against help text and probed only the shapes in the issue.
- **Mutation prediction miss:** the plan said deleting the `xargs` `GETOPT_GRAMMARS` entry would kill the `-i`/`-l` tests.
  It did not: with the table row also dropped, the fallback walk reads `-i` as a flag, which happens to be correct.
  That class is pinned instead by the "short optional consumes the next word" mutation.
- **Added after Green, then mutated:** a per-row arity-flip loop (each `XARGS_GRAMMAR`, `ENV_GRAMMAR`, and `DOAS_GRAMMAR` row flipped in turn) found rows with no killing test.
  The causes were the long flags packed into one chained test row and `-t` tested only inside `-tn1`; `a`/`argv0` were also covered only by a shape a value reading would still floor.
  I added a separate `<flag> cat x` row for each, plus `env -a rm cat x` and `env --argv0 rm cat x`.
  The refuse-to-flag survivors (`S`, `split-string`, `env0-from`) are expected: a flag reading of those doesn't land on a reader either.
- **Mid-session prompt confusion:** during both review rounds the operator got `external_directory` prompts naming `/xa.sh` and then `/probe.sh` for commands that wrote `/tmp/probe.sh`.
  Re-running the reviewer's exact commands through `externalAccesses()` showed the cause.
  `/probe.sh` is the in-container argument of `docker run … sh /probe.sh`, and `/tmp/*` was already allowed, so it was the only uncovered path.
  The prompt was accurate but gave no source context.
  Filed [#1062] for showing the producing word; it is out of scope for Phase 15 (operator decision).
  Container-side paths judged as host paths were not filed: the operator places them with declared command effects or the sandbox phase.
- The `doas` tests were first inserted inside the `env` `executedUnitOf` block and moved to their own `describe` before the commit.
- Pre-completion reviewer: round 1 **FAIL** (`--max-lines`), delta round **PASS**.

[#803]: https://github.com/gotgenes/pi-packages/issues/803
[#1042]: https://github.com/gotgenes/pi-packages/issues/1042
[#1054]: https://github.com/gotgenes/pi-packages/pull/1054
[#1057]: https://github.com/gotgenes/pi-packages/issues/1057
[#1062]: https://github.com/gotgenes/pi-packages/issues/1062
