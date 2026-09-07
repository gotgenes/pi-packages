---
issue: 889
issue_title: "pi-subagents: a child's provider error is reported as a successful, empty completion"
---

# Retro: #889 — pi-subagents: a child's provider error is reported as a successful, empty completion

## Stage: Planning (2026-09-07T06:26:43Z)

### Session summary

Verified the issue's source trace against the installed SDK (`@earendil-works/pi-coding-agent` / `pi-ai` / `pi-agent-core` at `0.84.4`), settled three design decisions at an `ask_user` gate, ran the Tidy-First assessor, and committed `docs/plans/0889-failed-child-run-reports-failed.md` — a six-step plan closing both fail-opens the issue names, plus a transcript pointer on the failed foreground return.
The issue is Phase 22 Step 17, `Release: independent`, landing as `fix:`.

### Observations

#### The throw beat the field

The obvious design — a `failure?: string` field on `TurnLoopResult` that `Subagent.completeRun` branches on — was displaced by having the turn loops **throw**.
`Subagent.run()` and `runResume()` already wrap the turn-loop calls in `try`/`catch` routing to `failRun`/`failResume`, which already reach `markError` → status `error` → `subagents:failed` → the `Agent failed:` branch.
So the mechanism half is one helper plus two `if (failure) throw` lines, `src/lifecycle/subagent.ts` needs zero changes, `resumeTurnLoop` keeps `Promise<string>`, and the shared `test/helpers/mock-session.ts` fixture and its ~12 `mockResolvedValue("…")` sites are untouched.
Worth remembering as a shape: when a package already has a working error path, the cheapest fix for a new failure class is often to *join* it rather than to add a parallel signal.

#### The roadmap's target list named a file the design does not touch

Step 17's `Target:` names `src/lifecycle/child-lifecycle.ts` "(whichever outcome the failed edge comes to publish)".
The adopted design publishes none — the throw precedes the `lifecycle.completed(...)` emit, and a session-factory failure already emits no `completed` either.
Recorded as a predicted-unchanged file with its claim rather than silently dropped.
Confirms the AGENTS.md reading rule: a roadmap `Target:` is the discovery sweep's guess at the blast radius, not a census.

#### `getLastAssistantText` was named as a target and deliberately left alone

Both the roadmap and my first instinct pointed at merging the new stop-reason read with the existing `getLastAssistantText` backward scan.
The Tidy-First assessor rejected it, correctly: `getLastAssistantText` **skips** empty-text assistant messages, and the provider's failure message is exactly a message with no text — reusing that predicate would walk past the erroring message to an unrelated earlier one.
This is the `code-design` skill's "shared predicate, different burden of proof" case, and it would have been a correctness bug dressed as a simplification.

#### Design gate

Three questions, all three recommendations adopted: reuse the existing `error` status (a new `SubagentStatus` member would break consumers' exhaustive switches for no gain), pass `errorMessage` verbatim and uncapped (matching how `record.error` already renders every thrown error), and fix **both** turn loops (the throw-based design makes the resume half nearly free).
Declined at the gate: rendering the child's partial text alongside the error — it is a mid-turn message rather than an answer the child stood behind, and rendering it as the outcome is the confabulation risk the issue exists to close.
The transcript pointer on the failed foreground return is the adopted route to that work instead.

#### Assessor found a touch point my file list missed

`test/helpers/make-subagent.ts` — `createTestSubagent` calls `createSubagentSessionStub()` with no `outputFile` argument, so no fixture can produce a record with a populated `outputFile`.
The transcript-pointer step needs one.
It became preparatory Step 1 rather than inline friction in Step 5.

#### Deferred tidyings

- `test/lifecycle/subagent-session.test.ts` — the assessor offered a `pushAssistantMessage(session, {…})` factory to replace the inlined `{ role: "assistant", content: [{ type: "text", text }] }` literal that `createSession` and `programTurns` each spell out, and that the new error cases would spell a third and fourth time.
  Declined: four short literals is not real friction, and the assessor itself rated it a judgment call rather than a clear win.

#### For the implementing session

- `readTurnFailure` must treat an **absent** `stopReason` as "not a failure".
  The existing test fixture at `test/lifecycle/subagent-session.test.ts` pushes assistant messages with no `stopReason` field at all, so a check written as `!== "stop"` would fail the whole existing suite.
- Step 2's value is in the half that stays green: today's suite passes under both the `??` and the truthiness spelling, so the `result: undefined` case must be asserted to still pass alongside the new `result: ""` case.
- Step 4 asserts at the second call site on purpose.
  A relocated or duplicated line is as unpinned at its new site as at its old one.

## Stage: Implementation — TDD (2026-09-07T17:23:21Z)

### Session summary

Executed all six plan steps as separate commits, plus two follow-on commits from the pre-completion review.
The `pi-subagents` suite went from 1611 to 1628 tests (+17).
Every predicted-unchanged file held — `src/lifecycle/subagent.ts`, `src/lifecycle/child-lifecycle.ts`, `src/lifecycle/subagent-state.ts`, `src/observation/notification.ts`, `src/observation/subagent-events-observer.ts`, `src/service/`, and `test/helpers/mock-session.ts` — which is what the throw-based design was chosen to buy.

### Observations

#### The plan's mutation predictions were right about direction, wrong about magnitude

Step 3's mutation B (`stopReason !== "error"` → `=== "stop"`) was predicted to redden 2 tests and reddened 12.
Both predicted cases were among them; the other 10 were existing tests whose fixtures push assistant messages carrying **no** `stopReason` at all.
The over-kill confirmed the hazard the planning stage flagged rather than contradicting it — an absent `stopReason` really is the dominant shape in this package's fixtures, so a predicate written as "not `stop`" would have failed loudly rather than subtly.
Mutations A (3 red) and C (1 red, the ordering pin) matched exactly.

#### Two `||`-with-disable sites, both load-bearing

`renderOutcomeBody` and `readTurnFailure` both needed `// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing`.
I checked rather than assumed: removing the disable from `renderOutcomeBody` produced a real lint error, so it was not speculative.
In both cases `??` would reintroduce the bug's exact shape — an empty string passing through a nullish guard.
The second site (`msg.errorMessage || PROVIDER_ERROR_WITHOUT_MESSAGE`) matters because `Agent.handleRunFailure` sets `errorMessage: error.message`, which is `""` for a bare `new Error()`.

#### A truncated `Edit` broke the file mid-function

Step 5's first edit ended its `newText` mid-expression and silently dropped the `return textResult(...)` block, leaving an unparseable file.
`pi-autoformat` caught it immediately with a parse error, but the lesson is the one `AGENTS.md` already records: when an edit spans a block's opening and closing, emit both ends or use `Write`.
Repaired by reading the region and re-anchoring rather than retrying the same edit.

#### Pre-completion review found a real residual and a real test gap

Round 1 returned WARN with two findings, both legitimate:

1. A pre-existing gap this change does not reach: `_checkCompaction`'s first-overflow branch strips the errored assistant message from `agent.state.messages` before attempting compaction and restores nothing if the compaction itself fails, so `readTurnFailure` scans past the erased turn and reports a stale-text success.
   Filed as [#898] and dispositioned into Phase 22 as Step 19 by operator decision.
2. The integration block added in `7851905d` drove `agent.run()`, not `agent.resume()`, so it re-verified the already-fixed run path and would have survived a revert of that commit's own change.
   The plan's Step 4 had promised a resume-path integration assertion; commit `9d5afa25` adds it, mutation-verified (removing `failIfProviderErrored` from `resumeTurnLoop` alone turns it red with `Expected: "error"` / `Received: "completed"`).

Round 2 (delta-scoped) returned WARN with one actionable item: [#898]'s body cited the wrong line range for the non-stripping second-attempt branch.
I re-derived the range from the pinned SDK myself rather than transcribing the reviewer's correction, fixed the body, and recorded the correction in a comment.
That re-read also surfaced a lead the first pass missed — `record-observer.ts` already subscribes to `compaction_end` but gates on `!event.aborted && event.result`, so it ignores exactly the failure case Step 19 needs.
Logged in the issue as a lead, not a finding, since whether it fires on the stripping path is unverified.

#### Reviewer warnings

Round 2 WARN, both items closed or accepted:

- [#898] line citation — **fixed** (body corrected, correction commented).
- The resume test's base `vi.fn()` implementation duplicates its first `mockImplementationOnce` and is unreachable.
  The reviewer confirmed it harmless (a third `prompt` call would reuse the first answer rather than fail loudly) and required no action.
  Left as reviewed rather than amended, to avoid landing an unreviewed change in a file the round had just cleared.

#### For the shipping session

- `**Release:** ship independently` — Phase 22 Step 17, four `fix:` commits, all naming user-observable outcomes.
- [#898] is filed and dispositioned; it is **not** closed by this work and must not be swept into #889's close comment.

#### Carried to the final retrospective

Both reviewer dispatches in this session omitted a **search-scope bound**, which `AGENTS.md` requires for a read-only subagent ("`find /` is read-only and still walks every mounted volume, trips the external-directory permission gate", Refs #696).
The round-2 reviewer ran `ls /tmp/mermaid-check*.svg 2>&1; find / -maxdepth 2 -iname 'mermaid-check*'`, which stalled 600 s against the `external_directory` ask and then auto-denied — roughly ten of that round's 953 s.
The guardrail currently lives only in `AGENTS.md` prose, so it depends on the dispatching agent remembering it per call, and it was not remembered twice in one session.
The operator's call was to fix this at retro rather than mid-implementation: the candidate is a standing scope bound in the `.pi/agents/` definitions for `pre-completion-reviewer`, `tidy-first-assessor`, and `craftsmanship-scout`, so it holds by construction instead of by per-dispatch discipline.

Investigating that stall also produced [#899] (see the disposition in `pi-permission-system`'s Phase 15 sweep list): an `ask` on an earlier gate suspends the call before a later gate's unconditional `deny` is consulted, so the operator's `find / *` deny rule never ran even though it matches the chained unit correctly.

## Stage: Final Retrospective (2026-09-07T18:06:01Z)

### Session summary

Planned, implemented, and shipped [#889] end to end in one trunk-lane session: a six-step plan, six TDD commits plus two review-driven follow-ons, `pi-subagents` v21.4.5 released, and Phase 22 Step 17 marked complete.
Two residuals were found and filed rather than folded in — [#898] (a failed compaction hides the turn error it stripped) and [#899] (a `pi-permission-system` gate-ordering defect) — each dispositioned into its package's roadmap at filing time.
The `pi-subagents` suite went from 1611 to 1628 tests.

### Observations

#### What went well

- **A design was displaced by a cheaper one at planning time, and the assessor verified it rather than agreeing with it.**
  The obvious shape — a `failure?: string` field on `TurnLoopResult` — lost to having the turn loops *throw*, which joins the error path `failRun`/`failResume` already implement.
  The `tidy-first-assessor` was asked to check the zero-change prediction for `src/lifecycle/subagent.ts` and confirmed it against the real file.
  Net effect: one helper, two call sites, no new fields, no churn in the shared `test/helpers/mock-session.ts` fixture.
- **The pre-completion reviewer caught a genuinely vacuous test — the failure mode it exists for.**
  The integration block added in `7851905d` drove `agent.run()`, not `agent.resume()`, so it re-verified an already-fixed path and would have survived a revert of its own commit.
  Neither the Red step nor the green suite could have surfaced that; only reading the test against the commit's claim did.
- **A spike disproved my own leading hypothesis during the permission investigation.**
  I expected the compound-command split to be the defect.
  Running the package's real parser showed `BashProgram.commands()` splitting the chain correctly and `find / *` matching the second unit — which relocated the bug from the matcher to gate ordering and produced [#899].

#### What caused friction (agent side)

- `instruction-violation` (user-caught, subagent) — the round-2 `pre-completion-reviewer` ran `ls /tmp/mermaid-check*.svg 2>&1; find / -maxdepth 2 -iname 'mermaid-check*'`.
  Its own definition forbids this by name: `.pi/agents/pre-completion-reviewer.md` § `## Search scope` says "`find /` … is out of bounds" and predicts the exact consequence ("trips the external-directory permission gate").
  Root cause is a **conflict inside that same file**, not disobedience: § 2f step 1 instructs `mmdc -i <file> -o /tmp/mermaid-check.svg`, writing outside the repo, and the scope section then leaves no in-scope way to confirm an artifact the agent was just told to create there.
  Round 1 ran the same `mmdc` command without hunting, so the escalation is intermittent and triggered by uncertainty about whether the output landed.
  Impact: a 600 s permission stall inside a 953 s review, ended by an auto-deny; no rework, and the review's conclusions were unaffected.
- `missing-context` (self-identified) — the disposable spike for [#899] hand-guessed `PathNormalizer`'s constructor and called `wildcardMatch(value, pattern)` with the operands reversed.
  The `testing` skill states the rule directly: a spike constructing a domain object uses the same `test/helpers/` builder the real tests use.
  Impact: two wasted spike iterations (three tool calls).
  Self-caught because *every* probe returned `false`, including `sudo *` — a result too uniform to be real, which is what exposed the harness rather than the policy.
- `other` (tool misuse, self-identified) — a TDD Step 5 `Edit` ended its `newText` mid-expression and silently dropped the `return textResult(...)` block, leaving `src/tools/foreground-runner.ts` unparseable.
  `AGENTS.md` already records the rule (emit both ends of an enclosing block, or use `Write`).
  Impact: one repair cycle; `pi-autoformat` surfaced the parse error immediately.
- `other` (tool misuse, self-identified) — one `Edit` call on `architecture.md` carried stray `oldText2`/`newText2` keys, which `AGENTS.md` documents as silently ignored.
  Impact: none — that entry's own `oldText`/`newText` were valid and all five edits were verified individually — but it is a rule that was in context and still missed.

#### What caused friction (user side)

Nothing that cost time.
Two interventions were unusually well-placed and worth naming as a pattern:

- The `find /` question arrived as a **question, not a correction** ("I thought our config rejects such a command"), which sent me to the review log and the parser instead of to a defensive explanation.
  It produced two durable artifacts: [#899] and this retro's scope-conflict finding.
- Deferring the scope-binding fix to the retro kept the ship clean rather than interleaving an unrelated change into a release.

#### Correction to the TDD stage note

The TDD stage's `#### Carried to the final retrospective` entry claims the guardrail "currently lives only in `AGENTS.md` prose, so it depends on the dispatching agent remembering it per call."
That is **wrong**, and the proposed remedy that followed from it — add a standing scope bound to the agent definitions — would have been pure duplication.
`pre-completion-reviewer.md` has carried a `## Search scope` section all along, naming `find /` explicitly.
The note was written from memory of the `AGENTS.md` rule without opening the agent file; reading it first would have found the § 2f conflict immediately.

### Diagnostic details

- **Model-performance correlation** — all three subagent definitions pin `anthropic/claude-sonnet-5`; the two `pre-completion-reviewer` dispatches and the `tidy-first-assessor` ran there.
  No mismatch: the assessor's judgment call (rejecting the merge of `getLastAssistantText` with the new stop-reason scan, on a burden-of-proof argument) is reasoning-heavy work that `sonnet-5` handled correctly, and both reviewer rounds returned findings that survived scrutiny.
  The ship stage ran entirely on `anthropic/claude-sonnet-5` (verified across 46 consecutive turns) and the retrospective on `anthropic/claude-opus-5` — a cheap model on a deterministic procedure and a strong one on judgment, which is the right allocation.
  I did **not** attribute the planning and TDD stages: pinning the `opus-5` → `sonnet-5` boundary needs a full-transcript read whose context cost outweighed the finding, and extrapolating from the three `model_change` entries alone is exactly the invented attribution [#778] warns against.
- **Escalation-delay tracking** — no sequence exceeded five consecutive tool calls on one error.
  The longest was the [#899] spike at three calls before the uniform-`false` result redirected me to read the signature.
- **Unused-tool detection** — none.
  `colgrep` was used for the permission investigation and located `policy/wildcard-matcher.ts` semantically on the first query.
  The one genuine gap was not a missing tool but an unread file: `.pi/agents/pre-completion-reviewer.md`, which would have answered the scope question directly.
- **Feedback-loop gap analysis** — clean.
  Verification ran per step, not only at the end: per-file `vitest` at each Red and Green, `pnpm run check` after every type-touching step, `pnpm run lint` after each source edit, and the full package suite before each commit.
  Every one of the plan's named killing mutations was applied and reverted before its commit.

### Changes made

1. `.pi/agents/pre-completion-reviewer.md` — § 2f step 1 now states that `mmdc`'s own output is the verdict and the SVG is disposable, removing the reason the agent searched for an artifact it had written outside the repo.
   This resolves the conflict with the file's own `## Search scope` section rather than restating the prohibition, which was already explicit.
2. `packages/pi-subagents/docs/retro/0889-failed-child-run-reports-failed.md` — this Final Retrospective entry, including the correction to the TDD stage's misdiagnosis of where the scope guardrail lives.

Declined by the operator: adding a `## Search scope` section to `.pi/agents/tidy-first-assessor.md` and `.pi/agents/craftsmanship-scout.md`.
Both grant `find` and carry no scope guard, but neither misbehaved this session, so the change was preventive rather than evidence-driven.
If either agent is later observed widening a search past the repo root, the reviewer's existing section is the text to copy.

[#898]: https://github.com/gotgenes/pi-packages/issues/898
[#899]: https://github.com/gotgenes/pi-packages/issues/899
