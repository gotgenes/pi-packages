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

## Stage: Sync (worktree) (2026-10-10T04:12:16Z)

### Session summary

`pnpm run lint` and `pnpm fallow dead-code` pass from the worktree root.
The plan's marker is `**Release:** ship independently`; the release will carry the seven `fix:` commits (xargs in three, env, doas, the command-line wrappers, and the `--max-lines` correction).
PR [#1054] reads `VALUE_TAKING_FLAGS.get("xargs")`, a row this change removes, so flag it on that PR at ship time.
Filed follow-ups: [#1057] (deferred to a later phase) and [#1062] (out of scope for Phase 15).

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-1053--/2026-10-09T05-04-48-439Z_01a11f0c-b336-7205-ab49-b78f67d22a17.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

- The pre-completion reviewer's round-1 FAIL (`--max-lines`) was fixed and its delta round returned PASS before sync, so nothing was left open for the root.
- The two reviewer rounds and the planning audit ran live probes in `ubuntu:24.04` containers (`--rm`; `--network none` except for `apt-get`); nothing privileged ran on the host.

## Stage: Final Retrospective (2026-10-10T17:19:17Z)

### Session summary

The root `/ship` fast-forward-merged the 14-commit worktree branch, re-ran `lint` and `fallow dead-code` on the merged tree, and pushed `cf97a349`; CI passed.
It closed #1053 with a comment anchored on the `env` fix, flagged PR [#1054] that its walk must read `GETOPT_GRAMMARS` now that the `xargs` row of `VALUE_TAKING_FLAGS` is gone, and released `pi-permission-system-v40.1.3`.
The worktree and branch were torn down; [#1056] is the next Phase 15 step.

### Observations

#### What went well

- Probing in a throwaway `ubuntu:24.04` container worked well as a verification source for GNU/util-linux tool grammars on a macOS host.
  The planning audit used it to find four bypasses the issue never listed (`env -a`, `xargs -i`/`-l`, `watch`/`parallel` command lines, `doas -a`).
- A scripted per-row arity-flip loop (`/tmp/rowmut.mjs`: flip one `GetoptGrammar` row at a time and rerun the two test files) replaced hand-picked mutations.
  It found rows with no killing test in each grammar.
  It proves each row is *tested*, not that it is *right*; the reviewer's live probe covered that second half.
- The pre-completion reviewer (Sonnet) caught a fail-open regression the implementing session (Opus) introduced and its own mutation loop could not see.
  Its delta round then probed every `xargs` and `env` option, separate and attached, against the binaries.
- The ship ran cleanly: the plan, retro, and sync note carried the release marker and the PR [#1054] flag, so step 2 asked nothing.

#### What caused friction (agent side)

- `missing-context`: planning built each `xargs`/`env` grammar row from `--help`/`man` text and probed live only the shapes in the issue.
  GNU `--help` prints `-L, --max-lines=MAX-LINES`, but the long form takes its value attached only, so step 2 listed it as `"value"` and `xargs --max-lines rm cat x` became `core-reader` while `rm cat x` ran — a regression against the base tree.
  Impact: a review FAIL, one `fix:` commit plus one docs commit, and a second reviewer round (23 tool calls).
- `other`: the plan predicted that deleting the `xargs` `GETOPT_GRAMMARS` entry would kill the `-i`/`-l` tests; the fallback walk happened to read them correctly.
  Impact: none beyond one extra mutation.
- `other`: the `doas` tests were first inserted inside the `env` `describe` block (self-caught before commit), and one `Edit` batch was rejected after `pi-autoformat` reflowed a test row.
  Impact: a few re-reads; no rework.
- `instruction-violation` (self-identified): two `\u2192`/`\u2014` escapes reached authored markdown.
  `pi-autoformat` decoded one, and the other survived inside a code span (which the gate exempts) until a manual `rg`, costing an `--amend`.
  The `markdown-conventions` rule and gates already cover this; it recurred, but nothing new is needed.
- `instruction-violation` (self-identified, ship): the final report said the roadmap's last-step check had not been run, rather than running it.
  The check (one `grep` of the Phase 15 headings) shows [#1056] still open, so no `/finish-phase` was due.
  Impact: none.

#### What caused friction (user side)

- During both reviewer rounds the operator got `external_directory` prompts naming `/xa.sh` and `/probe.sh`, which looked like misparses of `/tmp/…` paths.
  They were the container-side argument of `docker run … sh /probe.sh`, judged as a host path; `/tmp/*` was already allowed, so only that word asked.
  The second report arrived as an unexpanded `[paste #1 +13 lines]` placeholder, so the peer spent about seven tool calls reconstructing the prompt from the review log and the reviewer's transcript.
  Opportunity: when a paste fails to expand, a one-line restatement ("it asked about `/probe.sh`") would have cut that to one call. [#1062] (show the producing word in the prompt) addresses the confusion at its source.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `claude-opus-5-5` (high thinking), sync on `claude-sonnet-5-5` (mechanical; appropriate), ship and retro on `claude-opus-5-5`.
  All three subagents ran `claude-sonnet-5-5`: the tidy-first assessor (6 tool calls), reviewer round 1 (31), and reviewer round 2 (23).
  The judgment-heavy review on Sonnet found the defect the Opus implementer missed, so no mismatch.
- **Escalation-delay tracking** — no rabbit hole; the longest single-question sequence was the `/probe.sh` trace (about seven calls), which ended in a measured answer and a filed issue.
- **Feedback-loop gap analysis** — TDD ran the targeted files after each Red and Green, `check` after each Green, and the full package suite before each commit.
  Sync skipped `check`/`test` after its rebase because only `pi-subagents` commits had landed on `main`; CI on the shipped tip covered it.

### Changes made

1. `.pi/skills/package-pi-permission-system/SKILL.md`: added the rule that a `GetoptGrammar` row's arity is measured against the binary, both separate and attached, never read off `--help` (the `--max-lines` example).

[#1056]: https://github.com/gotgenes/pi-packages/issues/1056
