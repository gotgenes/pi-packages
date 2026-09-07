---
issue: 878
issue_title: "pi-subagents: a released session's question affordance names a resume that will be refused"
---

# Retro: #878 — a released session's question affordance names a resume that will be refused

## Stage: Planning (2026-09-07T05:26:56Z)

### Session summary

Produced `packages/pi-subagents/docs/plans/0878-resume-affordance-honesty.md` for Phase 22 Step 15.
The design adds one `Subagent.resumeRefusal` getter (`"no-session" | "session-released" | "workspace-disposed" | undefined`) that `AgentTool`'s resume branch and all four result carriers read, and gives `renderQuestionAffordance` a third parameter so a non-resumable record still reports its question with a reason-specific clause instead of a `resume:` call.
Filed [#896] for a hazard found while tracing the refusal paths, and recorded its disposition against Phase 22.

### Observations

- **The issue's trigger is not the fastest one.**
  The body names the retention sweep.
  Tracing `completeRun()` showed `holdForResume` is gated on `finalStatus === "completed"`, while `clearPendingQuestion()` deliberately keeps an aborted or steered child's question — so a workspace-backed child that is aborted or steered advertises a refused resume within milliseconds of the run ending, no sweep involved.
  This became the second pinned refusal path and is why the fix cannot be "clear the field at `releaseSession()`".
- **Clearing `pendingQuestion` was rejected on three grounds**, recorded in the plan: it misses the workspace path, it erases the question from `get_subagent_result` and the public `SubagentRecord`, and `resolveRetentionWindow` reads the field.
- **The predicate must be a getter, not a method.**
  `OutcomeAddenda`'s doc comment states that `Subagent` and `AgentReport` both satisfy it structurally, and two carriers (`agent-tool.ts:132`, `foreground-runner.ts:144`) pass the live record straight in.
  A method would not satisfy a field, so the shape of the existing seam decided the shape of the new member.
- **The new field is required, not optional**, on both `OutcomeAddenda` and `AgentReport`.
  The tsconfig sets no `exactOptionalPropertyTypes`, so required is what forces every construction site to be named by `tsc` — chosen deliberately against the fail-open shape this issue is an instance of.
- **Operator gate** — three questions, all recommended options taken: reason-specific close over generic or suppression; one reason-returning getter over a boolean; running-agent hazard out of scope with a follow-up.
- **A boolean predicate was rejected** because `AgentTool` would keep deriving its own three-way split, leaving the rule in two places — the exact shape that produced the bug.
- **Scope handed to Step 16.**
  The refusal *messages* stay in `agent-tool.ts`; only the decision moves.
  [#885] relocates the policy to `SubagentManager`, and [#896] folds in there as a fifth arm of the same union.
- **Baseline measured, not inferred:** 1589 tests / 76 files, green, at `c62cceb4`'s parent.

#### Deferred tidyings

The Tidy-First assessor rejected two candidates as scope creep, both with reasoning the plan accepts:

- `test/lifecycle/subagent.test.ts` describe-tree restructuring — the existing `describe("Subagent — workspaceDisposed", …)` / `releaseSession` pattern already accommodates a sibling block, so no migration is warranted.
- A `resumeRefusal` seam on `SubagentState`/`TestSubagentOptions` — a settable fixture override would test the fake rather than the composition of three real record facts, and would have masked the very fixture gap the assessment found.

Its two **Recommended** items became TDD Order steps 1 and 2 (`sessionReady?: boolean` on `createTestSubagent`, then opting the three affordance fixtures into it).
It confirmed the fixture-gap hypothesis it was handed and named the three tests that would have flipped meaning silently — the finding that most changed the plan's shape.

[#885]: https://github.com/gotgenes/pi-packages/issues/885
[#896]: https://github.com/gotgenes/pi-packages/issues/896
