---
issue: 1079
issue_title: "pi-subagents: get_subagent_result reports \"No output.\" for an agent still queued behind maxConcurrent"
---

# Say a queued agent has not started in its `get_subagent_result` report

## Release Recommendation

**Release:** ship independently

This issue's roadmap step (Phase 23, after [#1013]) is tagged `Release: independent`, and the phase has no release batches.
Steps 2 and 3 are `fix(pi-subagents):` commits that change only the text of one tool's report, so the release is a patch.

## Problem Statement

A background agent spawned at `maxConcurrent` capacity waits in the `queued` status until a running agent frees a slot, and since [#1013] a background resume at capacity does too.
While it waits, `get_subagent_result` tells the parent nothing true about it.
The report body reads `No output.`, the same text a run that finished with an empty result gets, so a parent can read it as "the agent ran and produced nothing".
A bounded wait (`wait: true, timeout: N`) that expires on a queued agent adds a note that says the agent "is still running" and that "waiting again will not unstick it", and points at a transcript a fresh queued spawn does not have.
For a queued agent, waiting is precisely what unsticks it.

## Goals

- A queued agent's report body says it is queued, has not started, and is waiting for a concurrency slot, and points at `wait: true` the way the running body does.
- A bounded wait that expires on a queued agent says the agent is still queued, starts when a running agent frees a slot, and that waiting again is how to collect its result.
- The running agent's body and bounded-wait note stay byte-identical.

The change is **not breaking**: no type, default, or published field changes, and the only observable difference is the wording of two pieces of `get_subagent_result` text for a status that was previously misdescribed.

## Non-Goals

- **The `Duration` stat of a queued agent's report.**
  It renders time since spawn with a `(running)` suffix, because a run's `startedAt` is its construction time until `start()` resets it.
  Deferred by operator decision to [#1080], which the roadmap carries as the next step.
- **The `timeout` parameter description** in `get-result-tool.ts` ("if its progress is unchanged since your last check, do not simply wait again").
  It is general guidance in the tool definition, which every parent session's prompt carries; the per-report note this plan changes is what speaks to the specific queued agent, and it overrides the general guidance for that case.
- **`STATUS_MEANINGS` gaining a `queued` entry.**
  That table feeds `renderStatusLabel` and `renderStatusNote`, which describe terminal statuses; a queued entry would change the `Status:` header line and the foreground carriers' framing.
- **Other carriers.**
  `foreground-runner.ts` and `agent-tool.ts` (`resumeExisting`) call `renderOutcomeBody` only after `await record.promise`, and the completion nudge fires only on a terminal status, so none of them can observe a queued run; both files are predicted unchanged.

## Background

- `src/observation/outcome-delivery.ts` — `renderOutcomeBody(outcome: OutcomeBody)` is the shared body every carrier wraps.
  It has arms for `running`, `error`, and `stoppedWhileQueued` (a queued run that was stopped, whose status is `stopped`), then falls back to the trimmed result or `No output.` (the truthiness fallback from [#889]).
  A queued run carries `result: undefined`, so it falls through to `No output.`.
- `src/tools/get-result-report.ts` — `formatAgentReport` composes the `get_subagent_result` text: header, `renderReportBody` (a pass-through to `renderOutcomeBody`), the addenda tail, and then, when `waitExpiredAfter` is set, the private `renderWaitExpired(seconds)`, whose text is written for a running agent only.
- `src/tools/get-result-tool.ts` — `collectOutcome` waits with `record.waitUntilSettled`; a run still active at the bound (`isActive()` covers `queued`, per `isActiveStatus` in `lifecycle/subagent-state.ts`) releases the claim and sets `waitExpiredAfter`.
  `buildReport` copies `outcome.status` into the report, so a queued run reaches both renderers with `status: "queued"`.
- Only `get_subagent_result` can show a queued run, as Non-Goals argues.

## Design Overview

### Observed scenario (the parent's terms)

Reproduced through `GetResultTool.execute` with a disposable spike (deleted after the run): a `createTestSubagent({ status: "queued", result: undefined, completedAt: undefined, startedAt: Date.now() })` scheduled on a `gatedScheduler()` whose slot never opens, read once without waiting and once with `wait: true, timeout: 5` under fake timers.
Measured output:

```text
# get_subagent_result { agent_id }
Agent: agent-1
Type: Agent | Status: queued | Tool uses: 3 | 1.0k token | Duration: 0.0s (running)
Description: Test task

No output.

# get_subagent_result { agent_id, wait: true, timeout: 5 }
...
No output.

This wait ended after its 5s timeout. The agent was not stopped and is still running.
If its progress has not changed since your last check, waiting again will not unstick it: read its transcript, steer it with steer_subagent, or tell the user it appears stuck.
```

The `Duration` line is [#1080]'s.

### Body: a queued arm

`renderOutcomeBody` gains one arm, placed directly after the `running` arm:

```typescript
if (outcome.status === "queued")
	return (
		"Agent is queued and has not started; it is waiting for a concurrency slot (maxConcurrent). " +
		"Use wait: true or check back later."
	);
```

The wording is the operator's choice at the planning gate.
`OutcomeBody` does not change: it already carries `status`.
The arm precedes the `stoppedWhileQueued` arm, but the two cannot both apply: a stopped-while-queued run's status is `stopped`.
The function's doc comment ("a running note, an error line, a never-started note, or the trimmed result") gains "a queued note".

### Bounded-wait note: status-aware

`renderWaitExpired(seconds)` becomes `renderWaitExpired(seconds, status)`, called from `formatAgentReport` with `report.status`.
It stays private to `get-result-report.ts` with that one call site.
The running text stays byte-identical; a queued run gets its own two-line text:

```text
This wait ended after its 120s timeout. The agent was not stopped and is still queued: it has not started, and starts when a running agent finishes and frees a concurrency slot.
Waiting again is how to collect its result; if the running agents are not making progress, check on them instead.
```

The two texts differ in every clause after the first sentence's opening, so the function is a two-literal branch on `status === "queued"` rather than a shared prefix with a discriminated tail.
`AgentReport.waitExpiredAfter`'s doc comment ("with the agent still running") becomes "with the agent still queued or running".

### Edge cases and where each is pinned

| Case                                           | Behavior                                                                                  | Pinned in                                                                                                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Queued, read without waiting                   | Body is the queued note, never `No output.`; outcome stays unconsumed                     | Step 2 (`get-result-tool.test.ts`)                                                                                                              |
| Queued, `result` is `""` or `undefined`        | Queued note (the arm precedes the fallback)                                               | Step 2 (`outcome-delivery.test.ts`)                                                                                                             |
| Queued, bounded wait expires                   | Queued body plus the queued wait note, never the running note; claim released, unconsumed | Step 3 (`get-result-report.test.ts`, `get-result-tool.test.ts`)                                                                                 |
| Running, bounded wait expires                  | Running note, byte-identical                                                              | Existing exact-text test in `get-result-report.test.ts` (`a wait that ended at its bound`) and `EXPIRY_NOTE` tests in `get-result-tool.test.ts` |
| Queued, then admitted during an unbounded wait | Reports the finished result, as today                                                     | Existing `waits for a queued agent when wait=true`                                                                                              |
| Stopped while queued                           | Never-started note, unchanged                                                             | Existing tests in `outcome-delivery.test.ts` and `get-result-report.test.ts`                                                                    |

## Module-Level Changes

- `src/observation/outcome-delivery.ts` — `renderOutcomeBody` gains the queued arm; its doc comment names the queued note.
- `src/tools/get-result-report.ts` — `renderWaitExpired` takes the status and gains the queued text; `formatAgentReport` passes `report.status`; `waitExpiredAfter`'s doc comment names the queued case.
- `test/observation/outcome-delivery.test.ts` — queued cases under `describe("renderOutcomeBody")`.
- `test/tools/get-result-report.test.ts` — a queued `renderReportBody` case and a queued exact-text case under `describe("a wait that ended at its bound")`.
- `test/tools/get-result-tool.test.ts` — a file-level `queuedAgent()` fixture (Step 1), a queued no-wait report test, and a queued bounded-wait test in `describe("GetResultTool — bounded wait")`.
- `docs/architecture/architecture.md` — at implementation completion, the `#### [#1079]` heading and its Mermaid node `S1079` gain `✅`, the step's `Target:` gains `src/tools/get-result-report.ts` (`renderWaitExpired`), and a `Landed:` note records both arms.
  The module-tree entries for `outcome-delivery.ts` and `get-result-report.ts` describe the modules generically and are predicted unchanged.

Predicted unchanged, with the claim each rests on:

- `src/tools/foreground-runner.ts`, `src/tools/agent-tool.ts` — they render a body only after the run settles.
- `src/tools/get-result-tool.ts` — `buildReport` already passes `status` and `waitExpiredAfter`; no new field is needed.
- `README.md`, `docs/configuration.md`, `.pi/skills/package-pi-subagents/SKILL.md` — a grep for `No output`, `still running`, and `Use wait: true` across them found no quotation of the report text this plan changes.

## Test Impact Analysis

1. New tests: unit cases for the queued body and the queued wait note, plus two end-to-end tests through `GetResultTool.execute` that pin the text a parent actually receives.
2. No existing test becomes redundant; the end-to-end tests cover the wiring (`buildReport` → `formatAgentReport`) the unit tests cannot.
3. The existing running exact-text test and the `EXPIRY_NOTE` tests stay as-is: they pin the running note's byte-identity, the invariant the status branch puts at risk.

**False-green hazard.**
`createTestSubagent` defaults `result` to `"All done."` and `completedAt` to `2000` (`test/helpers/make-subagent.ts`), so a queued fixture that omits them renders `All done.` and a completed-looking duration, and a pre-fix `No output.` assertion could never fire.
The measured spike first rendered `All done.` for exactly this reason.
The Step 1 fixture sets both to `undefined` (`seeded()` honors an explicit `undefined`), and each new end-to-end test asserts the queued note **and** `not.toContain("No output.")`.

## Invariants at risk

- [#947]'s `Landed:` note: "an expired wait releases its claim and leaves the agent running, and the report ... say[s] so."
  Pinned for running agents by `get-result-report.test.ts` (`says the agent was not stopped and what to do instead of waiting again, before the transcript pointer`, an exact-text `toBe`) and `get-result-tool.test.ts` (`returns at the bound with the agent still running and its outcome uncollected`, which also asserts `claimed`/`consumed` false).
  Both drive real renderers (no mock of the layer under change); Step 3's killing mutation 2 confirms the running test discriminates.
- [#889]'s empty-result fallback: a completed run with `""` or `undefined` result still reads `No output.`.
  Pinned by the existing `falls back to No output ...` tests in `outcome-delivery.test.ts`, which pass `status: "completed"` (the `makeOutcome` default) and are untouched by a `queued` arm.

## TDD Order

1. **`test(pi-subagents): share a queued-agent fixture in get-result-tool tests`**
   - Add a file-level `queuedAgent(responseText = "Done.")` helper to `test/tools/get-result-tool.test.ts` that builds a `createTestSubagent({ status: "queued", result: undefined, completedAt: undefined, execution })` whose stub turn loop resolves with `responseText`, schedules it on `gatedScheduler()`, and returns `{ record, openSlot, manager }`.
   - Migrate the two inline queued setups (`claims the outcome for the duration of a wait` and `waits for a queued agent when wait=true`) to it.
   - Prepares the friction of Steps 2 and 3, which would otherwise add the third and fourth copies of this five-line setup, and fixes the false-green defaults in one place.
   - Verify: the file's suite stays green and unchanged in count; no killing mutation, since no new test is added.
2. **`fix(pi-subagents): say a queued agent has not started instead of "No output."`**
   - `outcome-delivery.test.ts`: `renderOutcomeBody(makeOutcome({ status: "queued", result: undefined }))` and the same with `result: ""` each `toBe` the queued note.
   - `get-result-report.test.ts`: `renderReportBody(makeReport({ status: "queued", result: undefined }))` `toBe` the queued note.
   - `get-result-tool.test.ts` (in `describe("GetResultTool")`): `queuedAgent()`, `execute` without wait; the text contains `"\n\n" + <queued note>`, does not contain `No output.`, and `record.consumed` stays `false`.
   - Green: add the arm and update the doc comment.
   - Killing mutation: delete the `if (outcome.status === "queued") return ...;` arm from `renderOutcomeBody`; all four new tests go red, rendering `No output.`.
3. **`fix(pi-subagents): tell a parent whose wait expired on a queued agent that waiting again is how to collect it`**
   - `get-result-report.test.ts` (under `describe("a wait that ended at its bound")`): `formatAgentReport(makeReport({ status: "queued", result: undefined, duration: "130.0s (running)", waitExpiredAfter: 120 }))` `toBe` the full report, header through the queued wait note; the duration string is whatever `makeReport` is handed, so this does not pin [#1080]'s stat.
   - `get-result-tool.test.ts` (in `describe("GetResultTool — bounded wait")`): `queuedAgent()`, `execute` with `wait: true, timeout: 120`, advance 120 s; the text contains the queued wait note, does not contain `EXPIRY_NOTE`, `record.status` is `queued`, and `claimed`/`consumed` are `false`.
     Leave the gate closed; a closed gate holds no timer.
   - Green: thread `status` into `renderWaitExpired`, add the queued literal, update the `waitExpiredAfter` doc comment.
   - Killing mutation 1 (queued class): make `renderWaitExpired` ignore `status` and always return the running text; both new tests go red, and the existing running tests stay green.
   - Killing mutation 2 (running class): invert the branch to `status !== "queued"`; the existing running exact-text test and the `EXPIRY_NOTE` tool tests go red, confirming they pin the running note's byte-identity.
4. **`docs(pi-subagents): mark #1079 landed`** — the architecture-doc updates listed in Module-Level Changes.

## Risks and Mitigations

- **A queued test passes on the fixture's defaults rather than the fix.**
  Mitigated by Step 1's explicit `result: undefined, completedAt: undefined` and the `not.toContain("No output.")` assertions; Step 2's mutation confirms the red.
- **The running wait note drifts while adding the branch.**
  Mitigated by the existing exact-text `toBe` and by Step 3's mutation 2.
- **"Waiting again" advice for a queued agent can loop if every running agent is stuck.**
  The note's second clause directs the parent to the running agents when they are not progressing, and [#947]'s per-running-agent `Progress:` line gives it the means to check.

## Open Questions

None.

[#889]: https://github.com/gotgenes/pi-packages/issues/889
[#947]: https://github.com/gotgenes/pi-packages/issues/947
[#1013]: https://github.com/gotgenes/pi-packages/issues/1013
[#1080]: https://github.com/gotgenes/pi-packages/issues/1080
