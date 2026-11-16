---
issue: 1080
issue_title: "pi-subagents: get_subagent_result reports a queued agent's Duration as running time"
---

# Retro: #1080 — pi-subagents: get_subagent_result reports a queued agent's Duration as running time

## Stage: Planning (2026-10-24T15:14:02Z)

### Session summary

Reproduced the defect with a disposable spike through `GetResultTool.execute`.
It also surfaced a sibling the issue omits: a run stopped while queued reports its queue time as `Duration: 5.0s`.
The operator chose to show the queue time rather than hide it, with the same `queued <seconds>` wording for both cases, rendered by one private `formatRunDuration` helper that `buildReport` and `buildGetResultDetails` call, leaving the shared `formatDuration` untouched.
The plan is one `fix:` step plus the roadmap landing step; the `/subagents:sessions` navigator's identical defect for a queued resume was filed as [#1085] and dispositioned as a new Phase 23 step after this one.

### Observations

- The operator answered the first rendering gate (word / omit / relabeled queue time) with "can we show the queue time?"; a second gate settled the wording among three measured shapes, choosing `Duration: queued 5.0s` because it keeps `AgentReport.duration` a single string.
- The spike's first `stopped.abort()` left the run queued; a queued run is stopped with `Subagent.stopQueued()`, not `abort()`.
- The spike seeded `startedAt`, so the claim that a never-admitted run's `startedAt` is its enqueue time rests on reading `subagent-run.ts` and `Subagent.resume`, as the plan's Risks section says.
- The Tidy-First assessor recommended nothing; its optional fixture-string update in `get-result-report.test.ts` (`"130.0s (running)"` beside `status: "queued"`) is folded into the fix step.
- Rejected: a `neverStarted` predicate on `RunOutcome`.
  It would have one caller, and the other sites branch on `queued` and `stoppedWhileQueued` as separate arms.
- The first draft of [#1085] named the navigator command `/agents`; `pi.registerCommand` shows it is `/subagents:sessions`, and the issue was edited before the disposition was recorded.

#### Deferred tidyings

- `src/tools/get-result-tool.ts`: `buildReport` and `buildGetResultDetails` still compute about eight fields identically; this is already recorded under [#947]'s deferred tidyings.

## Stage: Implementation — TDD (2026-10-24T15:24:14Z)

### Session summary

Both plan steps landed: the `fix(pi-subagents)` commit adding `formatRunDuration` (called from `buildReport` and `buildGetResultDetails`) with four tests, and the roadmap landing (`✅` on the heading and the `S1080` node, widened `Outcome:`, `Landed:` note).
The pi-subagents suite went from 2179 to 2183 tests (+4); `check`, root lint, and `fallow dead-code` stayed green.

### Observations

- No deviations from the plan; the `get-result-report.test.ts` fixture string was updated in the fix commit as planned.
- Red came up exactly as predicted: the three queued and stopped-while-queued tests failed, and the started-run control passed.
- Every planned killing mutation turned exactly the predicted tests red.
  The `condition true` mutation was applied as the compared literal `status !== "error"` (true for every fixture status), which avoids Biome's `noConstantCondition` noise that [#1079]'s TDD stage hit.
  An extra mutation that reverted only the report-site call turned the two report-text assertions red, so each relocated call site is pinned separately.
- The `Duration stat` tests reuse `queuedAgent()` under fake timers at `vi.setSystemTime(6_000)`, which works with the fixture's default `startedAt` of `1000`; no fixture change was needed.
- Pre-completion reviewer: PASS.
  Its evidence-provenance section noted that the plan's scenario table comes from a seeded spike with n=1; the plan already labels it that way.

## Stage: Sync (worktree) (2026-10-24T15:42:34Z)

### Session summary

Pre-push `pnpm run lint` and `pnpm fallow dead-code` passed from the worktree root.
The plan's marker is `**Release:** ship independently`, with one `fix(pi-subagents):` commit (a patch); [#1085] (the session navigator's label for a queued resume) is filed and recorded as the next Phase 23 step, so it is not part of this land.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-1080--/2026-10-18T16-30-57-891Z_01a14fda-2162-7490-b648-27128e6a4b9f.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

- The TDD stage's pre-completion review was PASS with no open WARN, so nothing is carried to `/ship`.

## Stage: Final Retrospective (2026-10-24T15:51:35Z)

### Session summary

The worktree lane ran end to end with no rework: plan, TDD, and sync in the peer session, then a fast-forward land, green CI, the #1080 close, and the `pi-subagents-v25.0.2` release at the root.
The fix adds a private `formatRunDuration` helper in `src/tools/get-result-tool.ts`, so a queued or stopped-while-queued agent reads `Duration: queued <seconds>`.
The sibling defect in `/subagents:sessions` is filed as [#1085] and queued as the next Phase 23 step.

### Observations

#### What went well

- The planning spike drove `GetResultTool.execute` against a real gated scheduler and surfaced the stopped-while-queued case the issue omits, before the design gate rather than after it.
- The TDD stage applied five planned killing mutations plus one unplanned control (reverting only the report-site call), each restored from a `/tmp/green.ts` copy with `diff -q` confirming the restore; no mutation leaked into a commit.
- The ship ran on its happy path: `merge-base --is-ancestor` predicted the fast-forward, both root gates passed on the merged tree, and the release needed no re-dispatch.

#### What caused friction (agent side)

- `missing-context` — the first draft of [#1085], and the planning gate's Non-Goals note, named the navigator command `/agents` from memory; a `registerCommand` grep after filing showed it is `/subagents:sessions`.
  Self-identified.
  Impact: one `gh issue edit` of the title and body; caught before the roadmap disposition recorded it.
- `other` — the spike first stopped the queued run with `abort()`, which leaves it queued; `stopQueued()` is the queued-run lever.
  Impact: one extra spike run.
- `other` — the sync stage spent two calls on the transcript path: the prompt's `ls -t` session-directory recipe, then `PI_SESSION_FILE` to confirm the newest file was the live one.
  Impact: one extra tool call, no rework.

#### What caused friction (user side)

- None observed; the operator's involvement was the two rendering gates in planning and the #1085 disposition, all strategic decisions.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `anthropic/claude-opus-5-5`, sync on `anthropic/claude-sonnet-5-5`; both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `anthropic/claude-sonnet-5-5` per their own transcripts.
  The split fits the work: judgment-heavy design on the stronger model, mechanical sync and checklist review on the cheaper one.
- **Feedback-loop gap analysis** — verification was incremental: baseline gates before Red, a targeted `vitest run -t "Duration stat"` after each mutation, package `check` before the `fix:` commit, and the full gates before review.

### Changes made

1. `.pi/prompts/sync-worktree.md` step 2: replaced the `ls -t` session-directory recipe and its stall caveat with `echo "$PI_SESSION_FILE"`, which Pi's bash tool sets from the session manager; an empty result falls back to the root's `list_session_files`.

[#947]: https://github.com/gotgenes/pi-packages/issues/947
[#1079]: https://github.com/gotgenes/pi-packages/issues/1079
[#1085]: https://github.com/gotgenes/pi-packages/issues/1085
