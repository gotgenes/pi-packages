---
issue: 1039
issue_title: "pi-permission-system: exact allow for sudo -n true still triggers the indirection-wrapper ask"
---

# Retro: #1039 — pi-permission-system: exact allow for sudo -n true still triggers the indirection-wrapper ask

## Stage: Planning (2026-10-08T04:06:23Z)

### Session summary

Reproduced the third-party report through the real parser and `PermissionResolver` with a disposable spike, then put four directions to the operator: admit no-ops to the core (A), an exact-literal wrapper rule lifting the floor (B), both, or decline.
The operator chose A, a data-only addition of `true`, `false`, `:` to `coreAdmissions()`, and the plan was committed with a two-step TDD Order (feat + docs).

### Observations

- A full-suite spike with the admission group added measured 2 failures out of 5668, both the `PURE_READER_CORE` parity tests; no other behavior assertion moves.
- Finding surfaced in the gate: an exempt wrapper resolves by the *inner* command's rule, so under `{"*": "ask", "sudo -n pwd": "allow"}` `sudo -n pwd` already asks today, and `sudo -n true` will do the same after this change.
  No config line can make a wrapper unit's own exact allow stand; that was direction B, declined, and it overlaps open PR #971 (rnavarro's `xargs` rule-pinning).
- Direction B would have needed an ADR 0013 §11 amendment ("v1 exemption is package-audited only").
- The Tidy-First assessor recommended no preparatory tidyings and caught that `docs/configuration.md`'s roster list must change in the same commit as the code (doc-parity test); sorted order puts `:` first and `false` before `fd`.
- `Co-authored-by: aisensiy` is recorded in Step 1's commit message because the report's source pointer named the missing core admission the fix adds.
- No follow-up issues filed; no roadmap step references #1039, so it ships independently.

## Stage: Implementation — TDD (2026-10-08T05:46:13Z)

### Session summary

Both plan steps landed: the `feat` commit admitting `true`, `false`, `:` to `coreAdmissions()` with tests in four files plus the doc roster, and the `docs` commit adding the `sudo -n true` example and the 26-word roster count.
The `pi-permission-system` suite went from 5668 to 5688 tests (+20), all green, with check, lint, and `fallow dead-code` clean.

### Observations

- The plan's third killing mutation (drop the `PATH_SEPARATORS` check in `isBareCoreWord`) was vacuous: the exact-set lookup already rejects `./true` and `/bin/true`, so the guard is redundant for these inputs and every test survived.
  The discriminating mutation for that class is basenaming the head word (`PURE_READER_CORE.has(headWord.split("/").at(-1))`), which killed all six path-qualified negatives, the four new ones and the two existing `xargs ./grep`/`xargs /usr/bin/grep` ones.
- Red differed slightly from the plan: the doc-parity test stays green until the code changes, because it compares the doc to `PURE_READER_CORE`, not to `ROSTER`; it went red under the delete-the-group mutation as expected.
- An extra unplanned mutation (ignore `writesViaRedirect` in `floorExemptionOf`) confirmed the `sudo true > /tmp/x` row pins the redirect refusal.
- Pre-completion reviewer: PASS.
  Its non-blocking observation was a pre-existing fail-open: `sudo -e` (sudoedit) operands are peeled as an inner command, so `sudo -e cat` earns `core-reader`.
  Filed as #1042; the operator dispositioned it as a new Phase 15 step directly after #1027 (committed separately as the roadmap bookkeeping commit).
- The base ref handed to the reviewer was not resolved with `git rev-parse` and did not exist; the reviewer fell back to the plan commit's parent.
  Resolve the SHA before dispatch.

## Stage: Final Retrospective (2026-10-08T06:00:01Z)

### Session summary

One session carried #1039 through planning, TDD, ship, and retro: three shell no-ops (`true`, `false`, `:`) joined `PURE_READER_CORE`, so `sudo -n true` and its siblings resolve by their own `bash` rule, and `pi-permission-system` 40.1.0 released.
The pre-completion review surfaced a pre-existing sudoedit fail-open, filed as #1042 and placed in Phase 15 after #1027.

### Observations

#### What went well

- The planning spike ran the issue's policy through the real `BashProgram.parseSync` + `PermissionResolver` twice, on `main` and with the roster row added, and its result table became the `bash-command.test.ts` rows almost verbatim; the TDD stage wrote no case the plan had not already measured.
- A 27-second full-suite run with the data row added, at planning time, bounded the blast radius to the two parity tests before the plan was written, so the TDD stage had no surprise breakage.
- Handing the pre-completion reviewer a re-derivation mandate (enumerate your own wrapper shapes, not the tests') is what surfaced `sudo -e` (#1042), a finding no test in the range could have shown.
- The direction gate led with the measured table, including the non-obvious strict-catch-all row, and the operator answered in one pass.

#### What caused friction (agent side)

- `instruction-violation` (self-identified): typed the pre-completion base ref (`8a4d3d0b`) instead of pasting `git rev-parse 8cc6996f^` output; the SHA did not exist.
  AGENTS.md principle 4 and the `pre-completion` skill Step 1 both already require resolving it.
  Impact: none; the reviewer detected it and used the plan commit's parent.
- `premature-convergence` (self-identified): the plan's third killing mutation deleted the `PATH_SEPARATORS` guard in `isBareCoreWord`, which is redundant with the exact-set lookup for every input the tests use, so it killed nothing.
  The `testing` skill already says a guard-deleting mutation must first name what observably changes without the guard.
  Impact: one extra mutation run in TDD to find the discriminating one (basenaming the head word).
- `missing-context` (self-identified): the plan predicted the doc-parity test would go red at the Red step, but it compares the doc to `PURE_READER_CORE`, not to the test's `ROSTER`, so it only reddens once the code changes.
  Impact: none beyond a note.
- `instruction-violation` (self-identified): the first plan draft claimed a skill grep that had not been run and defined `[#1039]` for the doc's own issue; both were fixed before the plan commit.
  Impact: one extra edit.
- `other`: the retro's model-attribution lens counted `"model"` fields with `grep` over the session file rather than `read_session`, against the lens's own instruction.
  Impact: none; the counts (79 Opus turns across planning, TDD and retro, 13 Sonnet turns in ship) agree with the inline labels `read_session` rendered.
- `other`: this retro entry's em-dashes arrived as bare newlines, splitting every labeled bullet and the two diagnostic bullets; the `rg -n --multiline` scan the `markdown-conventions` skill prescribes caught it, and a scripted pass rejoined them with colons.
  Impact: one repair pass.

#### What caused friction (user side)

- None observed; both `ask_user` gates (direction, #1042 disposition) were answered in one pass.

### Diagnostic details

- **Model-performance correlation**: planning, TDD, and retro ran on `claude-opus-5-5`; ship ran on `claude-sonnet-5-5`, which fits its mechanical CI/release steps.
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `claude-sonnet-5-5` per their transcripts; the reviewer's judgment work produced the #1042 finding, so no mismatch.
- **Feedback-loop gap analysis**: verification was incremental: a full-suite spike at planning, a per-file Red/Green run, four mutation runs, and a package suite + `check` before the feat commit, then the root gates.

### Changes made

1. None beyond this retro entry; the operator confirmed that every friction point violated a rule already stated in `AGENTS.md`, the `pre-completion` skill, the `testing` skill, or the `markdown-conventions` skill.
