---
issue: 1064
issue_title: "pi-permission-system: a bare `env` that runs no command should not take the indirection floor"
---

# Retro: #1064 — a bare `env` that runs no command should not take the indirection floor

## Stage: Planning (2026-10-16T00:43:21Z)

### Session summary

Reproduced the issue's table on `main` through `BashProgram.parseSync` and `resolveBashCommandCheck` in a disposable spike, verified bare-form behavior on BSD `env` and GNU `genv` 9.12, and measured 33 of 278 `<indirection-bash-wrapper>` waiting entries in the local review log deciding on a bare `env`.
The operator chose a grammar field (`bareFormRunsNothing`, `true` only on `ENV_GRAMMAR`) and a third `FloorExemption` member, `"no-command"`.
The plan is six steps: two Tidy-First preparations, a `refactor:` that names the exemption, the `fix:` gate branch in `resolveWrapperUnit`, a measurement-script step, and docs.

### Observations

- Declassifying a bare `env` in `classifyWrapperWords` was rejected before the gate, not offered: `sessionCommandIndex` would answer `0`, the session suggestion would widen to `env *`, and a session grant skips the floor, so it would cover `env rm -rf x`.
- `resolveWrapperUnit` reads `cmd.floorExemption && cmd.executedUnit`, and a bare `env` has no `executedUnit`, so an exemption from `floorExemptionOf` alone still floors; the gate needs its own branch (Step 4).
  That makes Step 3 a fail-closed `refactor:` interim.
- The Tidy-First assessor recommended extracting `getoptWalkEnd` rather than changing `getoptInnerIndex`'s `-1` contract, and hoisting the test helper `exemptionOf`; both became Steps 1–2.
  It verified that no `Record<FloorExemption, …>` or exhaustive switch exists.
- A first-draft killing mutation ("treat a refusing arity as a flag") would not have killed `env -C /tmp`, because the next word then reads as a command; corrected to "treat it as a value".
- Nested no-command forms (`sudo env`, `time env`) stay floored; the review log holds zero asks for them, so no follow-up issue was filed.

## Stage: Implementation — TDD (2026-10-16T02:31:31Z)

### Session summary

All six planned steps landed, plus one `fix:` and one `docs:` commit from the pre-completion review: `floorExemptionOf` answers `no-command` for a bare `env`, and `resolveWrapperUnit` resolves it by its own rule.
The `pi-permission-system` suite went from 6122 to 6187 tests (+65).
The pre-completion reviewer returned FAIL in round 1 and PASS on the delta round.

### Observations

- Round-1 FAIL: BSD `env` (macOS `/usr/bin/env`) has no long options and reads `--unset FOO` as `-`, then `-u nset`, then runs `FOO`, while `ENV_GRAMMAR` gave `--unset` GNU's separate-value arity.
  So `env --unset sh` earned the new `no-command` exemption, a bypass this change introduced; and `env --unset rm cat x` earned `core-reader` by `cat`'s rule, a fail-open already on `main` from #1053.
  The operator chose the grammar fix: a new `"attached"` `OptionArity` for `--unset` (only `--unset=FOO` admitted), which closes both directions.
  The planning spike verified bare forms on BSD with short options only; no long option was ever run on BSD, which is exactly where the two implementations part.
- The operator kept the basename rule for a path-qualified `env` (`./env`), matching the core-reader clause (the reviewer's round-1 WARN).
- Plan misprediction in Step 4: replacing `base.state === "allow"` with `true` does not redden the explicit `env: ask`/`deny` pins, because the `no-command` branch returns `base` unchanged.
  Two mechanisms protect those pins at once (only an `allow` reaches `resolveWrapperUnit`, and the branch returns the unit's own result); mutating both reddens them.
- The arm mutation for `"attached"` (a detached value falling through as one word) killed only the `executedUnitOf` row at first, since that reading is BSD's.
  `env --unset cat x` was added as the discriminating row: GNU unsets `cat` and runs `x` (verified with `genv --unset cat pwd`).
- The measurement figure moved from 34/357 to 37/363 between runs, because this session's own `env` probes were real asks in the review log; the docs cite the later run.
- Environment: the global mise `node` shim lost its version mid-session, so prek's node-based hooks failed with "No version is set for shim: node".
  Commits ran with pnpm's node (`/opt/homebrew/Cellar/node/26.12.0/bin`) prefixed on `PATH`, so every hook still ran; no `--no-verify`.
- Pre-completion reviewer: FAIL (round 1, fixed as above), then PASS (delta round, 30,164 `env` word lists executed on BSD and GNU with zero violations).

## Stage: Final Retrospective (2026-10-16T02:43:09Z)

### Session summary

One session ran all four stages (plan, TDD, ship, retro) on trunk.
`pi-permission-system` 40.2.2 shipped the `no-command` floor exemption for a bare `env` and, from the pre-completion review, the `"attached"` arity for `env --unset`, which also closed a BSD fail-open #1053 had left on `main`.
CI and the release run were green on the first attempt.

### Observations

#### What went well

- The pre-completion reviewer acted as a combinatorial oracle sweep: it executed 230 (round 1), then 30,164 (round 2) `env` word lists against the real `/usr/bin/env` and `genv` binaries on the host and caught a floor bypass that the unit tests, the plan's spike, and the Tidy-First assessor all missed.
  This is the first time in this phase that the review's evidence came from running the dependency rather than reading it.
- The fix was put at the grammar (`"attached"` arity) rather than as a guard in `namesNoCommand`, so one data row closed both the new bypass and the pre-existing inner-command mis-location; the operator chose it from a two-option gate in one round.
- When the global mise `node` shim lost its version, commits ran with pnpm's node on `PATH`, keeping every hook live instead of reaching for `--no-verify`.

#### What caused friction (agent side)

- `instruction-violation` (reviewer-caught) — the planning spike hand-picked BSD rows (short options only) although both oracles (`/usr/bin/env`, `genv`) were installed, and the `testing` skill already says to sweep an external oracle combinatorially rather than by hand-picked rows (#979).
  The plan's edge-case table then listed `--help`, `--block-signal`, and `--unset=FOO` as `no-command` from the grammar alone, under a Design Overview headed "measured".
  BSD `env` has no long options and reads `--unset FOO` as `-u nset`, then runs `FOO`.
  Impact: a round-1 FAIL (~48 minutes of review), an `ask_user` round, one `fix:` and one `docs:` commit, a ~28-minute delta review, and a figure re-run.
- `missing-context` — #1053's grammar constraint ("a union of BSD and GNU rows only where no option differs in arity") was read as covering long options, when BSD has none to compare; this session inherited the gap rather than checking it.
  Impact: folded into the item above; the pre-existing `env --unset rm cat x` fail-open shipped with #1053 and was fixed here.
- `other` — Step 4's planned killing mutation for the explicit `env: ask`/`deny` pins (replace `base.state === "allow"` with `true`) could not redden them: the `no-command` branch returns `base` unchanged, so two mechanisms protect the pins at once.
  The `testing` skill's guard-mutation rule (#965) already says to name what changes without the guard; self-identified at Verify.
  Impact: two extra mutation runs, no rework.
- `other` — twice emitted `\u2014`/`\u00a7` escapes in an `Edit` body; one `oldText` failed and was retried with the literal character, one `newText` was decoded by the hook.
  Impact: one failed `Edit` call.

#### What caused friction (user side)

- Nothing notable: the operator answered each of the three gates (design, FAIL fix, path-qualified `env`) in one round.

### Diagnostic details

- **Model-performance correlation** — the main session ran `anthropic/claude-opus-5-5` throughout; the `tidy-first-assessor` and both `pre-completion-reviewer` rounds ran `anthropic/claude-sonnet-5-5` (from their transcripts).
  The reviewer's real-binary sweep was the session's highest-value judgment work and sonnet carried it; no mismatch.
- **Unused-tool detection** — the BSD miss needed no subagent: both oracle binaries were on the host during planning, and a planning spike sweeping every `ENV_GRAMMAR` long name on each would have taken under a minute.
- **Feedback-loop gap analysis** — `check` ran after every TDD step and the full package suite before each `refactor:`/`fix:` commit; no gap.

### Changes made

1. `.pi/skills/package-pi-permission-system/SKILL.md`: Implementation Priorities gains a rule that a wrapper option grammar unioning BSD and GNU is verified by running both installed binaries over every option it lists, long names included.
2. `.pi/skills/testing/SKILL.md`: the external-oracle sweep rule's trigger now names an installed binary whose behavior a grammar or table transcribes, beside an equivalent spelling.
