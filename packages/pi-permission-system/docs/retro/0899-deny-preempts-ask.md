---
issue: 899
issue_title: "pi-permission-system: an ask on an earlier gate pre-empts an unconditional deny on a later one"
---

# Retro: #899 — an ask on an earlier gate pre-empts an unconditional deny on a later one

## Stage: Planning (2026-09-11T07:17:33Z)

### Session summary

Reproduced the defect through `makeHandler` with the issue's literal command, spiked two candidate fixes against the full suite, gated the semantics with the operator, ran a Tidy-First assessment, and committed `docs/plans/0899-deny-preempts-ask.md`.
The plan is four steps: a preparatory `refactor:` extracting `preResolvedCheckOf` from `GateRunner.runDescriptor`, a preparatory `test:` sharing a surface-denying resolver fixture, the `fix:` itself (produce all six gate results, then run them deny-first), and a `docs:` step.
Filed [#915] for the neighboring multiple-ask defect and recorded its Phase 15 disposition.

### Observations

- **The issue's own diagnosis was wrong about the cost, and it mattered.**
  The issue (and the roadmap entry derived from it) says the fix must hoist the permission resolve out of `GateRunner.runDescriptor`, calling that "the bulk of the work".
  Reading all six gate producers showed the resolve is already hoisted — five carry `preCheck`, `skill-read` carries `preResolved`, and `runDescriptor`'s `resolver.resolve` branch is unreachable from this pipeline.
  That collapsed the change from a runner restructure to a ~25-line pipeline edit, and it dissolved the roadmap's stated reason for deferring the issue (that it wanted to move with the deferred `runDescriptor` split).

- **Spiking both candidate rules before the gate was what made the gate answerable.**
  Option A (pre-empt only the prompt) and option B (run only the denying gate) decide identically in every case; the entire difference is which records a denied call leaves.
  Measuring both against the real suite — 4157/4157 for A, 4156/4157 for B — turned an abstract choice into one concrete artifact: the `external_directory_write` allow decision event that B stops emitting.

- **The first gate framing was rejected, correctly, for leading with a test count.**
  The operator's reply — "Is the recommendation for A simply to avoid changing tests?"
  — was right: a suite delta is a proxy, not a reason.
  Re-gating on *what the log shows for a pre-empted call* got a decision immediately.
  Lesson for future gates: when two options are outcome-equivalent, name the artifact that differs, not the measurement that detected it.

- **Option C was raised by the operator and declined on substance, not scope.**
  Collapsing two `ask` gates into one prompt drops a distinct authorization question (boundary-crossing vs. command execution), and it does not even reduce total prompts for anyone who grants for the session — it defers the second prompt to the next call.
  Measured: `cat /etc/hosts` under `external_directory: {"*": "ask"}` plus `bash: {"*": "ask"}` escalates twice, with payload kinds `bash_external_directory` and `tool`.
  Filed as [#915] with the coalesce-rather-than-drop design recorded, so the next reader of the gate loop does not rediscover it.

- **The Tidy-First assessor's rejection was overridden, and the reason is worth keeping.**
  It declined to extract the `preCheck`/`preResolved` precedence read shared with `runner.ts`, on the ground that the design summary declared `runner.ts` out of scope — a premise this planning session had supplied, not a decision.
  Its own reasoning agreed the duplication was real ("a shared function is the textbook fix for 'must mirror'").
  The extraction became Step 1.
  Lesson: a scope boundary asserted in the assessor's prompt comes back as a constraint in its verdict; state boundaries as *decisions with reasons* or not at all.

- **ADR 0013 turned out to support the change rather than caution against it.**
  The issue flagged §4's avoidance of cross-surface interaction. §4 is about bare-family sugar; §5 says most-restrictive composition between the boundary rule and the pattern surfaces "is the correct consequence of that difference rather than an arbitrary precedence rule".
  The pipeline was implementing half the documented rule (`ask` > `allow`) and not the other half (`deny` > `ask`) — which reframed the work as completing the model instead of amending it, and made the docs-only treatment the operator chose the obviously right one.

#### Deferred tidyings

- `src/handlers/gates/runner.ts` — the full `runDescriptor` split (into resolution, fast paths, and gate application phases) stays deferred, as the roadmap's `#### Deferred tidyings swept` list already records.
  Step 1 extracts one reader from it; it is not that split.
- `src/handlers/gates/tool-call-gate-pipeline.test.ts` / `test/helpers/gate-fixtures.ts` — a `makeMockBashProgram` variant returning non-empty `pathRuleCandidates()`/`externalAccesses()`, so the two bash path gates are reachable in a pipeline unit test rather than only at the handler level.
  Declined as Optional by the assessor and not needed by this plan's matrix.

## Stage: Implementation — TDD (2026-09-11T07:49:11Z)

### Session summary

Five commits: the two Tidy-First preparatory steps (`preResolvedCheckOf` extraction, the shared `makeSurfaceDenyingResolver` fixture), the `fix:` itself, the `docs:` step, and one unplanned `test:` commit pinning a newly-reachable fail-closed path.
`ToolCallGatePipeline.evaluate` now produces all six gates before running any and runs an unconditionally denying one first, so a command the policy forbids is refused without an unanswerable prompt.
Test count 4157 → 4177 (+20), with one existing test rewritten rather than added.
Pre-completion reviewer: **PASS** (two rounds — the second scoped to the delta commit).

### Observations

- **Every plan prediction held, including the measured breakage.**
  The plan named exactly one existing test that would break (`external-directory-integration.test.ts`'s `emits separate decision events…`), and exactly that one broke, for exactly the predicted reason.
  Spiking both candidate rules at planning time is what bought that — the rewrite was a known cost before the first line was written rather than a mid-cycle surprise.

- **One mutation prediction was wrong, and the direction is worth remembering.**
  The plan claimed the `isUnconditionalDeny`-returns-`false` mutation would leave the `orderDenyFirst` unit tests green, treating them as an independent equivalence class.
  It killed three of them, because `orderDenyFirst` calls the predicate on the very `GateResult` values those tests construct — the two are one class, not two.
  Over-discrimination, not a coverage gap: the stability mutation still killed exactly one test, which is the claim those tests exist to pin.
  Lesson: a mutation table's equivalence classes must be derived from the *call graph*, not from the function names.

- **The reviewer's "structural guarantee, not a gap" was worth converting into a test.**
  Round one flagged that no test pinned a producer throwing from inside the new eager loop, then argued the boundary's mechanism makes it safe anyway.
  The plan's own Risks section had already said this risk must be **spiked**, not inferred — so it was, and the spike became a permanent pin.

- **The first draft of that pin did not discriminate, and only writing the mutation revealed it.**
  It denied the `read` surface (producer 6), so the old lazy loop reached the throwing producer 5 first either way and the test passed against both versions.
  Denying `path_read` (producer 2's surface for a read tool) is what makes the block land ahead of producer 5.
  This is the exact failure mode the "authored after Green never had a Red step" rule exists to catch, and it was caught only because the mutation was actually applied rather than reasoned about.

- **The `source !== "session"` clause is unreachable today, deliberately.**
  `SessionRules` records only `action: "allow"`, so a session-sourced `deny` cannot exist; the reviewer confirmed this from the producer rather than from test survival.
  It is kept because it makes `isUnconditionalDeny` correct on its own terms rather than by way of a distant invariant, and because it errs toward today's behavior by declining to pre-empt.

- **One lint warning arrived a commit late.**
  Step 1 left `PermissionCheckResult` unused in `runner.ts`; Biome reports unused imports at *warning* level, which exits 0, so `pnpm run lint` passed at that commit and the finding only surfaced under the `grep -c 'lint/'` count at the docs step.
  Fixed by amending the `fix:` commit (nothing pushed).
  The count-the-findings habit is what caught it — the exit code never would have.

- **No roadmap step to mark.**
  Issue #899 shipped from the roadmap's open-issue sweep list, not as a numbered Phase 15 step, so there is no `✅` to flip.
  The sweep entry was corrected in place instead: its recorded deferral rationale predicted a mechanism (hoisting resolution out of `GateRunner.runDescriptor`) that planning measured to be already done.

## Stage: Sync (worktree) (2026-09-11T07:50:47Z)

### Session summary

Pre-push checks pass clean (`pnpm run lint`: no findings; `pnpm fallow dead-code`: no issues, 337 entry points).
No deferred work rides this branch — the plan's Release Recommendation is `ship independently`, and the neighboring multiple-ask defect is filed separately as [#915] with its own Phase 15 disposition already recorded.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-899--/2026-09-11T06-50-03-457Z_01a08f3a-ff40-7111-8cb0-b7d4c85e71a7.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

Nothing further to add beyond the TDD stage note above — this is a clean handoff to the root session.

[#915]: https://github.com/gotgenes/pi-packages/issues/915
