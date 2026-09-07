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

## Stage: Implementation — TDD (2026-09-07T05:56:21Z)

### Session summary

Executed all six TDD Order steps plus one reviewer-driven fixup, in seven commits.
`Subagent.resumeRefusal` is now the single home for the three record-level facts the resume door checks, `AgentTool` switches over it exhaustively, and all four result carriers read it — so an unanswerable question is reported with its reason instead of a `resume` call.
Tests went 1589 → 1611 (+22) across 76 files; `check`, root `lint`, and `fallow dead-code` all clean.

### Observations

- **The plan's wording had a defect only a test could find.**
  The planned `no-session` clause was "it has no session to resume", and the template appends a colon to the clause — producing the literal `resume:`, the exact token the change exists to suppress.
  It was caught by the assertion that iterates all three reasons and asserts `not.toContain("resume:")`, not by anyone reading the string.
  Reworded to "it has no active session", with a comment at the constant saying why.
  Writing the negative assertion as a loop over the whole union, rather than one spot check, is what made this cheap.
- **Two existing assertions were too weak to kill the refactor's mutation.**
  `AgentTool`'s released-session and no-session refusal tests were `toContain` substring matches, so an arm returning the wrong sentence would have passed.
  Tightened to full-string `toBe` inside step 4, which is what made mutation (b) killable.
- **The design's riskiest structural claim held.**
  `src/tools/foreground-runner.ts` and `agent-tool.ts` pass a live `Subagent` into `renderOutcomeAddenda`, and the plan predicted the new **required** field would be satisfied structurally by a getter with no call-site edit.
  `tsc` confirmed it: `foreground-runner.ts` is untouched in the whole change, only its test moved.
  This is why the predicate is a getter and not an `isResumable()` method.
- **The nudge test needed an aborted child, not a completed one.**
  A first draft seeded `pendingQuestion` and ran the agent, but `completeRun`'s `holdForResume` keeps the workspace for a *completed* child with a question — so nothing was disposed and the test would have pinned the wrong state.
  Rewritten to drive `ask_parent` from inside a turn loop returning `aborted: true`, which is the real path that reaches the refusal.
- **Mutation testing found nothing wrong, which is itself the result.**
  All 10 planned mutations killed exactly their predicted equivalence class — suppressing the refusal branch reddened 10 refusal tests and left every resumable test green; forcing it reddened the 5 carrier tests asserting `resume: "<id>"` plus 2 ordering tests.
  Two `toBeUndefined()` tests in step 3 stayed green through Red, so they got their own mutation (return a refusal unconditionally) rather than being taken on trust.
- **Pre-completion reviewer: WARN**, one non-blocking finding, fixed in `b9a39b75`.

#### Reviewer warnings

- `src/session/ask-parent-tool.ts`'s module comment justified recording-without-announcing on the claim that "every result carrier already renders a pending question with the exact resume call" — the universal claim this issue retired.
  It was the one place outside the three planned doc targets that still made it; the plan's own grep covered `README.md`, `docs/configuration.md`, `docs/architecture/`, and `.pi/skills/`, but not `src/` module comments.
  A `src/`-comment sweep for a retired *claim* (as opposed to a removed symbol) is the gap worth remembering.
  The reviewer also noted the child-facing `ask_parent` result text still says the parent "will answer by resuming you"; left as-is deliberately — at the moment a child asks, its session is live and that promise is true.

[#885]: https://github.com/gotgenes/pi-packages/issues/885
[#896]: https://github.com/gotgenes/pi-packages/issues/896
