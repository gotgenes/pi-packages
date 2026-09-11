---
issue: 885
issue_title: "pi-subagents: expose resume on SubagentsService"
---

# Expose resume on `SubagentsService`

## Release Recommendation

**Release:** ship independently

Phase 22 Step 16 carries `Release: independent` in the architecture roadmap, and the batch list names it among the independently releasable steps.
The step lands a `feat:` on the service contract (semver-minor under [decision 0005](../decisions/0005-subagent-record-admission-policy.md)'s produced-not-implemented direction), which is an unhidden release vehicle on its own.

## Problem Statement

`SubagentManager.resume` has exactly one caller — `AgentTool`'s resume branch — so a resume can originate only from a parent model's tool call.
No extension can continue a child: not a UI affordance, not a keybinding, not an event handler.

The door is also unequal to its siblings.
`AgentTool` decides whether a resume is allowed (reading `Subagent.resumeRefusal`) and words each refusal, while `SubagentManager.resume` guards on `isSessionReady()` alone and collapses every other reason into `undefined`.
A second front door routed through the manager as it stands would resume a child whose workspace has been torn down.

Neither door refuses a resume of a **still-running** agent at all ([#896]).
`resetForResume()` rewinds the record and `resumeTurnLoop` starts while the original `runTurnLoop` is still awaiting the same session; the original run's promise handle is orphaned and its eventual `completeRun()` fires in the middle of the resumed run.
The window is reachable: `ask_parent` records the question during the run, and `get_subagent_result` in the interval before the child's turn ends renders the ask-back affordance naming that exact resume call.

Finally, a resume that starts without a tool call emits nothing ([#832]).
`subagents:resumed` fires only when a resumed run *terminates*, so a UI can learn that a child went back to running only by polling `getRecord`.

## Goals

- A consuming extension can resume a child through `SubagentsService`, and learns why a refused resume was refused.
- Both front doors read one refusal policy from one place — the four `AgentTool` owns today plus the still-running one from [#896].
- A resume of a still-running agent is refused at both doors, and no carrier advertises one.
- A resume start is observable on the event bus, from either door ([#832]).
- A service caller declares per call whether it will carry the resumed outcome to the parent, so the completion nudge is suppressed only when something else is delivering.
- **Not breaking.**
  The service gains a method (semver-minor: `SubagentsService` is produced by this package and read by consumers, never implemented by them).
  The still-running refusal changes observable tool behavior — a `subagent({ resume })` call on a running agent now returns a refusal instead of starting a second turn loop — but that is a `fix:` for state corruption, not a contract change, so no `!` and no `BREAKING CHANGE:` footer.

## Non-Goals

- **A pre-call resumability query on the public surface.**
  A consumer still cannot ask, before calling, whether an agent is resumable: `SubagentRecord` carries `status` but neither `sessionReleased` nor `workspaceDisposed`, so a UI cannot grey out a Resume affordance.
  The operator flagged this as interesting at the design gate and it was deliberately left out of this step; filed as [#912].
- **Making `abort(id)` cancel an in-flight resume.**
  `Subagent.resume` deliberately does not route through `this.abortController` (an agent aborted on its original run would have a pre-aborted controller), so `abort(id)` marks a resumed record `stopped` while its turn loop keeps running.
  Pre-existing on the tool door; this plan mitigates it for the new door by accepting a caller `signal`, and files the defect itself as [#913].
- **A general delivery-claim API.**
  [#897] proposes `claimDelivery(id)` / `releaseDelivery(id)` for any external carrier.
  This plan adds a per-call `claimOutcome` option on `resume` only, which the resume path needs for its own timing reason (the claim must land before the synchronous `resetForResume()`); it neither implements nor forecloses [#897].
- **Reworking `notification.ts` or the nudge's truncation.**
  Untouched.
- **`waitUntilSettled` as a separate service method.**
  The returned promise resolves when the resumed run settles, which is the whole of what such a method would offer.

## Background

Relevant modules, as of `2eea3c6f`:

| Module                                           | Role in this change                                                                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `src/lifecycle/subagent-manager.ts`              | `resume()` (line ~358) — the choke point that gains the refusal policy; `SubagentManagerObserver`; `buildObserver()` |
| `src/lifecycle/subagent.ts`                      | `resumeRefusal` getter (line ~218); `SubagentLifecycleObserver`; `resume()`/`runResume()`; `claim()`/`release()`     |
| `src/tools/agent-tool.ts`                        | The resume branch (lines ~90–125) and `resumeRefusalMessage()` (line ~276) — the wording, which stays here           |
| `src/service/service.ts`                         | The public contract: `SubagentsService`, `SubagentRecord`, `SUBAGENT_EVENTS`                                         |
| `src/service/service-adapter.ts`                 | `SubagentManagerLike` and the `Subagent` → `SubagentRecord` mapping                                                  |
| `src/observation/outcome-delivery.ts`            | `renderQuestionAffordance` and `RESUME_REFUSAL_CLAUSES` — the affordance that must agree with the door               |
| `src/observation/subagent-events-observer.ts`    | Emits the lifecycle channels; `subagents:resumed` fires at resume *end*                                              |
| `src/observation/composite-subagent-observer.ts` | Fans manager notifications out to the events observer and the widget                                                 |

The issue body predates two landed steps and is stale in two places, both verified against the code above:

- The refusal **policy** already moved onto the record in Step 15 ([#878]): `Subagent.resumeRefusal` composes the three facts and `AgentTool` holds only an exhaustive `switch` over them.
  What has *not* moved is the **check** — the manager still never consults it.
- `subagents:resumed` already exists; it reports a terminal resume, not a starting one.

Constraints from `AGENTS.md` that apply:

- Architecture-doc module-tree entries describe current behavior and cite an issue only when the ref encodes an active constraint, so the rewritten entries carry no `#885` ref.
- A landed plan is a historical artifact: `docs/plans/0878-resume-affordance-honesty.md` and `docs/plans/0903-exactly-once-mid-run-update-delivery.md` are not rewritten.
- The public surface changes, so `pnpm --filter @gotgenes/pi-subagents run verify:public-types` must run before the final commit.

## Design Overview

### One refusal vocabulary, two front doors

`Subagent.resumeRefusal` stays the single predicate.
It gains a fourth member, checked first:

```typescript
export type ResumeRefusal =
  | "still-running"
  | "no-session"
  | "session-released"
  | "workspace-disposed";

get resumeRefusal(): ResumeRefusal | undefined {
  if (this.isRunning()) return "still-running";
  if (!this.isSessionReady()) return this._sessionReleased ? "session-released" : "no-session";
  if (this.workspaceDisposed) return "workspace-disposed";
  return undefined;
}
```

`isRunning()` rather than `isActive()`: a queued agent has never had a session, so it already refuses as `no-session`, which is true of it.
Running-first also covers the window inside `run()` between `markRunning` and session creation, where the record is running with no session yet — `still-running` describes that better than `no-session` does.

`SubagentManager.resume` becomes the choke point that reads it:

```typescript
export type ResumeRefusalReason = ResumeRefusal | "unknown-agent";

export type ResumeOutcome =
  | { kind: "resumed"; record: Subagent }
  | { kind: "refused"; reason: ResumeRefusalReason };

export interface ResumeCallOptions {
  signal?: AbortSignal;
  /** The caller will deliver this outcome; claim it so nothing announces it. */
  claimOutcome?: boolean;
}

async resume(id: string, prompt: string, options: ResumeCallOptions = {}): Promise<ResumeOutcome> {
  const agent = this.agents.get(id);
  if (!agent) return { kind: "refused", reason: "unknown-agent" };
  const refusal = agent.resumeRefusal;
  if (refusal) return { kind: "refused", reason: refusal };
  // Before the resume starts: resetForResume runs synchronously inside
  // resume(), so a claim made afterwards would miss the terminal edge.
  if (options.claimOutcome) agent.claim();
  await agent.resume(prompt, options.signal);
  return { kind: "resumed", record: agent };
}
```

`unknown-agent` widens the union at the manager layer only, because it is the one refusal that is not a fact about a record.
`AgentTool`'s branch then holds no policy at all:

```typescript
const outcome = await this.manager.resume(id, prompt, { signal, claimOutcome: true });
if (outcome.kind === "refused") return textResult(resumeRefusalMessage(outcome.reason, id));
outcome.record.markConsumed();
return textResult(/* … */);
```

Two things disappear with it: the `getRecord` pre-read, and the `release()` on a failed resume.
The release branch becomes unreachable — nothing awaits between the refusal check and `agent.resume()`, and `Subagent.resume` rejects only for a missing session, which `resumeRefusal` has already excluded.
`Subagent.runResume` captures every other error into `failResume`, so a resumed run that *fails* is still `{ kind: "resumed" }` with `status: "error"` on the record: a refusal means the run never started, not that it went badly.

### The public method

```typescript
/** Why a resume was refused. */
export type { ResumeRefusal } from "#src/lifecycle/subagent";
export type { ResumeRefusalReason } from "#src/lifecycle/subagent-manager";

export interface ResumeOptions {
  /**
   * Declare that the caller will deliver the resumed outcome to the parent,
   * suppressing the completion nudge for it. Default false — an unclaimed
   * resume is announced exactly as a background completion is.
   */
  claimOutcome?: boolean;
  /**
   * Cancels the resumed turn loop. `abort(id)` does not: a resume does not run
   * under the record's own abort controller.
   */
  signal?: AbortSignal;
}

export type ResumeResult =
  | { kind: "resumed"; record: SubagentRecord }
  | { kind: "refused"; reason: ResumeRefusalReason };

/**
 * Resume a settled agent with a new prompt. Resolves when the resumed run
 * reaches a terminal state, carrying the terminal snapshot.
 */
resume(id: string, prompt: string, options?: ResumeOptions): Promise<ResumeResult>;
```

Internal `…Outcome` / public `…Result` follows the package's existing split between the live-record layer and the by-value snapshot layer (`AgentSpawnConfig`/`SpawnOptions`, `Subagent`/`SubagentRecord`).
The adapter is a delegation plus the `toSubagentRecord` map `getRecord` already uses:

```typescript
async resume(id: string, prompt: string, options?: ResumeOptions): Promise<ResumeResult> {
  const outcome = await this.manager.resume(id, prompt, {
    claimOutcome: options?.claimOutcome,
    signal: options?.signal,
  });
  return outcome.kind === "refused"
    ? outcome
    : { kind: "resumed", record: toSubagentRecord(outcome.record) };
}
```

Consumer call site, for the Tell-Don't-Ask check — the consumer asks nothing of the record to decide:

```typescript
const svc = getSubagentsService();
const result = await svc?.resume(id, "Answer: use the staging config.", { claimOutcome: true });
if (result?.kind === "refused") ui.notify(`Cannot resume: ${result.reason}`);
else if (result) pushToParent(result.record.result ?? "");
```

### The resume-start event

`SubagentLifecycleObserver` gains `onResumeStarted?(agent)`, fired from `runResume()` immediately after `resetForResume()` — so it fires for **both** doors, which is what closes [#832] rather than covering only the new one.
The manager's observer gains a **required** `onSubagentResuming(record)` (the widget wants the repaint: the record has just flipped back to running), the composite fans it out, and `SubagentEventsObserver` emits:

```typescript
onSubagentResuming(record: Subagent): void {
  this.emit("subagents:resuming", {
    id: record.id,
    type: record.type,
    description: record.description,
  });
}
```

Payload is the `{ id, type, description }` triad `subagents:started` already uses, not `buildEventData(record)`: at resume start the record has just been rewound, so the metrics half of that payload carries nothing worth reporting.
A new channel rather than a second `subagents:started`, for the reason `docs/plans/0466-resume-completion-signalling.md` gave for splitting `subagents:resumed` off `subagents:completed` — existing subscribers keep their once-per-run semantics.

### The affordance for a running child

`renderQuestionAffordance` gains a third branch.
Transient and permanent are different claims, not one claim with a parameter, so the existing clause table narrows rather than growing a fourth row:

```typescript
const RESUME_REFUSAL_CLAUSES: Record<Exclude<ResumeRefusal, "still-running">, string> = { /* unchanged */ };
```

The permanent branch keeps its wording ("can no longer be answered … Spawn a new agent").
The transient branch says the child is not finished and points at the pull that waits, and — deliberately — names no `resume:` call, so the `resume:`-token absence assertion holds for **all four** reasons rather than three:

```text
This agent asked a question before it finished running, so it cannot be resumed yet:

  Which config?

Wait for it to settle — get_subagent_result with wait: true returns when it does — then answer it.
```

`AgentTool`'s door message for the same reason names `steer_subagent`, which is the tool for reaching a running child ([#896]'s own suggestion); the affordance does not, because a steer is not an answer to the question — it is a message into a turn that is already ending.

### Edge cases

- **A resumed run that fails.**
  `{ kind: "resumed" }`; the snapshot carries `status: "error"` and `error`.
  Refusal means "did not start".
- **An unclaimed service resume.**
  The completion nudge announces the resumed outcome, exactly as it announces a background completion.
  This is the default, and it is why `claimOutcome` defaults to false.
- **A claimed service resume whose caller never delivers.**
  The outcome is claimed and never announced.
  The caller owns that; `release()` is not exposed here (see [#897] for the general case).
- **A resume of an agent whose session is being released mid-flight.**
  The sweep releases only terminal records, and `resumeRefusal` is read synchronously before `agent.resume()` — no await between the two.
- **A previous run's withheld update.**
  See Risks: an unclaimed resume can let the prior run's parked updates announce.
  Already priced by `docs/plans/0903-exactly-once-mid-run-update-delivery.md`, though not by its "once" — the withheld queue does not collapse updates per record.

## Module-Level Changes

| File                                                                                                        | Change                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lifecycle/subagent.ts`                                                                                 | `ResumeRefusal` gains `"still-running"`; the getter checks `isRunning()` first and its doc comment gains the ordering reason; `SubagentLifecycleObserver` gains `onResumeStarted?`; `runResume()` fires it after `resetForResume()`                                                                                                                                                                             |
| `src/lifecycle/subagent-manager.ts`                                                                         | New exported `ResumeRefusalReason`, `ResumeOutcome`, `ResumeCallOptions`; `resume()` reads `agent.resumeRefusal`, owns the claim, and returns the outcome; `SubagentManagerObserver` gains required `onSubagentResuming`; `buildObserver()` gains one guarded clause                                                                                                                                            |
| `src/tools/agent-tool.ts`                                                                                   | Resume branch extracted to `private async resumeExisting()` (prep), then rewired to the manager outcome — losing the `getRecord` pre-read, the `resumeRefusal` read, the `claim()`/`release()` pair, and the unreachable "Failed to resume" branch; `AgentToolManager.resume` re-typed; `resumeRefusalMessage()` gains `"unknown-agent"` (the existing not-found sentence, moved in) and `"still-running"` arms |
| `src/service/service.ts`                                                                                    | `resume()` on `SubagentsService`; new `ResumeOptions`, `ResumeResult`; re-exports `ResumeRefusal` and `ResumeRefusalReason`; `SUBAGENT_EVENTS.RESUMING`                                                                                                                                                                                                                                                         |
| `src/service/service-adapter.ts`                                                                            | `SubagentManagerLike.resume` re-typed; new `resume()` delegating and mapping through `toSubagentRecord`                                                                                                                                                                                                                                                                                                         |
| `src/observation/outcome-delivery.ts`                                                                       | `RESUME_REFUSAL_CLAUSES` narrows to `Exclude<ResumeRefusal, "still-running">`; `renderQuestionAffordance` gains the transient branch; the module comment's affordance paragraph gains the not-yet case                                                                                                                                                                                                          |
| `src/observation/subagent-events-observer.ts`                                                               | New `onSubagentResuming` emitting `subagents:resuming`                                                                                                                                                                                                                                                                                                                                                          |
| `src/observation/composite-subagent-observer.ts`                                                            | New `onSubagentResuming` fan-out clause                                                                                                                                                                                                                                                                                                                                                                         |
| `src/ui/agent-widget.ts`                                                                                    | New `onSubagentResuming(_record)` calling `update()`, beside `onSubagentResumed`                                                                                                                                                                                                                                                                                                                                |
| `test/helpers/make-deps.ts`                                                                                 | The manager fixture's `resume:` mock returns the outcome shape; new `mockResumeRecord(deps, overrides?)` builder                                                                                                                                                                                                                                                                                                |
| `test/helpers/make-deps.test.ts`                                                                            | Its `resume resolves to a completed record` test calls the mock **positionally** and asserts on the bare return — both change with the signature                                                                                                                                                                                                                                                                |
| `test/tools/agent-tool.test.ts`                                                                             | The 19-test flat `resume path` block is nested into refused/accepted (prep), then the refused half drives `manager.resume` outcomes instead of crafted records                                                                                                                                                                                                                                                  |
| `test/lifecycle/subagent-manager.test.ts`                                                                   | New refusal, claim, and `onSubagentResuming` tests; the existing resume tests never read `resume()`'s return value, so they need no edit                                                                                                                                                                                                                                                                        |
| `test/lifecycle/subagent.test.ts`                                                                           | New `still-running` refusal test; new `onResumeStarted` firing test                                                                                                                                                                                                                                                                                                                                             |
| `test/service/service-adapter.test.ts`                                                                      | New `resume` delegation, refusal pass-through, snapshot-mapping, and `claimOutcome` tests                                                                                                                                                                                                                                                                                                                       |
| `test/observation/outcome-delivery.test.ts`                                                                 | New transient-branch tests; the `names no resume call for any reason` loop gains `"still-running"`                                                                                                                                                                                                                                                                                                              |
| `test/observation/subagent-events-observer.test.ts`, `test/observation/composite-subagent-observer.test.ts` | New channel-emit and fan-out tests; `makeDelegate()` gains the stub                                                                                                                                                                                                                                                                                                                                             |
| `test/ui/agent-widget.test.ts`                                                                              | New repaint-on-resuming test                                                                                                                                                                                                                                                                                                                                                                                    |
| `README.md`                                                                                                 | Events table gains `subagents:resuming`; the `Event bus` parenthetical (line ~35) gains `resuming`; the `For Extension Authors` service paragraph names `resume`                                                                                                                                                                                                                                                |
| `docs/architecture/architecture.md`                                                                         | `SubagentsService` interface bullet gains `resume`; lifecycle-events table gains the row; Step 16 `✅` heading, `Landed:` note, and Mermaid node; module-tree entries for the eight changed `src/` modules                                                                                                                                                                                                      |
| `.pi/skills/package-pi-subagents/SKILL.md`                                                                  | The public-exports table's `spawn/abort/steer/workspace seam` description gains `resume`                                                                                                                                                                                                                                                                                                                        |

**Predicted unchanged, with the claim each rests on:**

- `src/observation/notification.ts` — the nudge reads `record.claimed` / `record.consumed`, and this change sets those through the same `Subagent.claim()` the tool door already used.
- `src/lifecycle/subagent-state.ts` — no new state; `still-running` is derived from `status`, which the value object already owns.
- `src/tools/get-result-report.ts` and `src/tools/get-result-tool.ts` — both declare and pass `resumeRefusal: ResumeRefusal | undefined`; widening the union is source-compatible at a type *reference*, and the report's rendering is `outcome-delivery.ts`'s job.
- `src/tools/foreground-runner.ts` — a foreground run is not a resume.
- `src/ui/session-navigation.ts` — reads `isSessionReady()` directly for transcript mounting, which this change does not touch.

Grep sweep run at planning time: `resumeRefusal`, `ResumeRefusal`, `manager.resume`, `\.resume\(`, and `resume:` across `src/`, `test/`, `docs/`, and `.pi/skills/` — the table above is the closure.
`docs/configuration.md` names no resume mechanism and is unchanged.

## Test Impact Analysis

**New tests the change enables.**
Refusal coverage moves down a layer: `SubagentManager.resume` can be driven directly for all five reasons, where today the only way to exercise a refusal is through `AgentTool.execute` with a crafted record.
The claim decision likewise becomes directly testable at the manager (claimed-before-the-loop-starts), which the tool door could only assert indirectly.

**Tests that become thinner.**
Five of `agent-tool.test.ts`'s resume tests currently build a `Subagent` whose state produces the refusal they want; after the rewiring they mock `manager.resume` returning `{ kind: "refused", reason }`.
They stay — the wording is the tool's own responsibility and is exactly what they assert — but they stop depending on record construction.

**Tests that must stay as they are.**
`subagent-manager.test.ts`'s existing resume tests (usage accumulation, `resumeTurnLoop` delegation, `onSubagentResumed` firing for both spawn modes) exercise the resumed run itself, not the door, and never read `resume()`'s return value.
`outcome-delivery.test.ts`'s permanent-refusal tests pin Step 15's invariant and are untouched by the new branch.

**Token-absence predicate.**
`renderQuestionAffordance`'s new transient text is specified above; applying `not.toContain("resume:")` to that literal passes, and the existing loop is widened from three reasons to all four rather than left at three.
The predicate is also applied to the door's new `still-running` sentence, which is a tool result rather than an affordance and legitimately names `steer_subagent`.

## Invariants at risk

| Invariant (source)                                                                                  | Pinned by                                                                                                                                                                                               | This change                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 15 ([#878]): no carrier names a resume the extension would refuse                              | `test/observation/outcome-delivery.test.ts` (`names no resume call for any reason`), plus the **required** `resumeRefusal` field on `OutcomeAddenda` / `AgentReport` making an omission a compile error | Extended, not weakened: the union widens, the required field forces every carrier to keep passing it, and the loop is widened to the new member                                                      |
| Step 14 ([#872]): an update is routed by `record.claimed`, and the lifecycle event fires either way | `test/lifecycle/subagent.test.ts` update-channel tests; `test/observation/notification.test.ts`                                                                                                         | An unclaimed service resume is the first unclaimed *blocking-free* resume. New test: a service resume without `claimOutcome` leaves `record.claimed` false, so its mid-run updates stay announceable |
| Step 21 ([#903]): every update reaches the parent exactly once                                      | `test/observation/notification.test.ts`                                                                                                                                                                 | One accepted regression window, priced below                                                                                                                                                         |
| Step 7 ([#798]): the foreground result text carries the resume handle                               | `test/tools/foreground-runner.test.ts` (`resume: "agent-5"`)                                                                                                                                            | Untouched — the foreground path is not a resume                                                                                                                                                      |
| [ADR 0005]: `SubagentRecord` admits no live objects                                                 | `test/service/service-adapter.test.ts`                                                                                                                                                                  | Held: `ResumeResult` carries a `toSubagentRecord` snapshot, never the `Subagent`. New test asserts the returned record has no methods (`toEqual` against the full expected snapshot)                 |

The [#903] window, quoted from its own plan, is the one this step makes reachable:

> `resetForResume` clears the ledger; the claim deliberately survives, so a claimed resume's stale queue entry is declined by `canAnnounceUpdate` and a service-initiated unclaimed resume ([#885], unshipped) would announce a previous run's message once.

Accepted rather than fixed: the message in question was **never delivered to the parent**, and the child is live again when it lands, so announcing it is the correct outcome rather than a duplicate.

The quoted "once" is the predecessor plan's wording, and this plan does not inherit it as a bound.
`NotificationManager.pending` holds one entry per update with no per-record collapse — unlike `withholdCompletion`, which does collapse, and which `notification.test.ts`'s "keeps every update, because two updates are two facts" pins for the update path.
So a child that sent several updates inside one withheld parent turn can flush all of them after an unclaimed resume.
What is bounded is the **content**: every such message is one the parent has not seen, on a child that is running again.
Recorded here so the next reader finds it priced rather than missed (pre-completion review, #885).

## TDD Order

1. **`refactor(pi-subagents): extract the Agent tool's resume branch`** Lift `execute()`'s `if (params.resume) { … }` body verbatim into `private async resumeExisting(id, prompt, signal, detailBase)`, called from the same place.
   Prepares step 5, whose diff then replaces one small method instead of interleaving with `execute()`'s config resolution and spawn branches.
   No new tests; the existing 19 resume tests must stay green.
   Killing mutation: delete the `resumeExisting` call from `execute()` — the whole resume group reddens.

2. **`test(pi-subagents): group the Agent tool's resume tests by refused and accepted`** Nest the flat `AgentTool — resume path` block into `describe("refused")` (5 tests) and `describe("accepted")` (the rest), assertions unchanged.
   Prepares step 5, which rewrites the two halves differently — the refused half stops building records, the accepted half only re-wraps its mock value.
   Emit the opening `describe(` and its closing `});` as two entries of one `Edit` call, anchored on unique surrounding lines, and verify with `grep -n '^describe\|^});'`.

3. **`test(pi-subagents): add a resume-mock builder to the tool fixture`** Add `mockResumeRecord(deps, overrides?)` to `test/helpers/make-deps.ts`, owning the `deps.manager.resume = vi.fn().mockResolvedValue(…)` assignment and returning the built `Subagent`; migrate the nine inline sites plus the fixture default.
   Prepares step 5: the outcome wrap then changes one helper body rather than ten call sites.

4. **`fix(pi-subagents): refuse to resume an agent that is still running`** — closes [#896]'s half.
   Red: `test/lifecycle/subagent.test.ts` — a running record reports `resumeRefusal === "still-running"`; `test/tools/agent-tool.test.ts` — `subagent({ resume })` on a running agent returns the refusal sentence and never calls `manager.resume`; `test/observation/outcome-delivery.test.ts` — the transient affordance says the child is not finished, names no `resume:` call, and the four-reason loop passes.
   Green: the `"still-running"` member, the getter's leading check, the narrowed clause record, the new render branch, and the two new `resumeRefusalMessage` arms (the switch is exhaustive, so this is a compile error until it is).
   Killing mutations — one per class: (a) delete the `isRunning()` arm from the getter → the record test and the door test redden, the affordance unit test stays green; (b) make `renderQuestionAffordance` fall through to the permanent branch for `still-running` → the transient-wording test reddens, the door test stays green.

5. **`refactor(pi-subagents): move the resume refusal check to the manager choke point`** Red: `test/lifecycle/subagent-manager.test.ts` — `resume()` returns `{ kind: "refused", reason }` for unknown id, still-running, no-session, session-released, and workspace-disposed, and `{ kind: "resumed", record }` otherwise; `claimOutcome: true` leaves the record claimed **before** the turn loop resolves (drive it with a `resumeTurnLoop` that never settles and assert `record.claimed` synchronously).
   Green: the outcome types, the rewritten `resume()`, `AgentTool.resumeExisting` reading the outcome, the re-typed `AgentToolManager`/`SubagentManagerLike`, and the fixture updates from steps 3 and 4.
   The interface change and every consumer land in one commit — `tsc` will not allow otherwise.
   Behavior through the tool door is unchanged, hence `refactor:`.
   Killing mutations: (a) restore `if (!agent?.isSessionReady()) return …` in place of the `resumeRefusal` read → the workspace-disposed and still-running manager tests redden; (b) move `agent.claimOutcome`'s `claim()` to after the `await` → the synchronous claim test reddens; (c) drop the claim entirely → the tool door's "claims the outcome before resuming" test reddens.

6. **`feat(pi-subagents): let an extension resume a subagent through the service`** Red: `test/service/service-adapter.test.ts` — `resume` delegates to the manager, passes `claimOutcome`/`signal` through, returns the refusal verbatim, and maps a resumed record through `toSubagentRecord` (assert the full snapshot with `toEqual`, so a live `Subagent` cannot pass).
   Green: `ResumeOptions`, `ResumeResult`, the re-exported reason types, the interface method, and the adapter body.
   Then run `pnpm --filter @gotgenes/pi-subagents run verify:public-types`.
   Killing mutations: (a) return `outcome` unmapped for the resumed arm → the snapshot test reddens; (b) drop `claimOutcome` from the forwarded options → the pass-through test reddens.

7. **`feat(pi-subagents): emit an event when a subagent resume starts`** — closes [#832].
   Red: `test/lifecycle/subagent.test.ts` — `onResumeStarted` fires once, after the record reads `running` again; `test/observation/subagent-events-observer.test.ts` — `onSubagentResuming` emits `subagents:resuming` with the `{ id, type, description }` payload and persists nothing; `test/observation/composite-subagent-observer.test.ts` — the fan-out reaches every delegate and isolates a throw; `test/ui/agent-widget.test.ts` — the widget repaints.
   Green: the optional lifecycle hook, the fired call in `runResume()`, the required manager-observer member, the `buildObserver` clause, the composite clause, the widget method, the channel constant, and the emit.
   Killing mutations: (a) delete the `onResumeStarted` call in `runResume()` → the firing test and the emit test redden; (b) emit `SUBAGENT_EVENTS.RESUMED` instead of `RESUMING` → the channel assertion reddens; (c) delete the composite's new clause — the relocation this step adds is as unpinned at its new site as anywhere → the fan-out test reddens.

8. **`docs(pi-subagents): document the service resume door and the resuming event`** README (events table, `Event bus` parenthetical, extension-authors paragraph), `docs/architecture/architecture.md` (service interface bullet, lifecycle-events row, Step 16 `✅` heading + `Landed:` note + Mermaid node, module-tree entries for the eight changed modules), and the `package-pi-subagents` skill's public-exports row.
   Verify: `pnpm exec rumdl check` on each edited markdown file, and `pnpm run lint` unpiped.

## Risks and Mitigations

| Risk                                                                        | Mitigation                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The still-running refusal reddens unrelated tests that resume a fixture     | Measured at planning time: `createTestSubagent()` defaults to `status: "completed"`, and `get-result-report.test.ts` builds DTOs with an explicit `resumeRefusal`. Step 4 is where any surprise surfaces, before the interface churn |
| An unclaimed resume lets the previous run's parked updates announce         | Accepted and priced above — each message was never delivered and the child is live again; the queue does not collapse them per record                                                                                                |
| A claiming service caller that never delivers silently swallows the outcome | `claimOutcome` defaults to false, so the failure mode requires an explicit opt-in; the doc comment states the obligation. The general release path is [#897]'s, not this step's                                                      |
| `abort(id)` cannot cancel an in-flight service resume                       | `ResumeOptions.signal` gives the caller the same lever the tool door has; the underlying defect is filed as [#913] and the doc comment names it rather than implying `abort` works                                                   |
| Widening `ResumeRefusal` fails open somewhere that reads it loosely         | It cannot: the `AgentTool` switch is exhaustive, `RESUME_REFUSAL_CLAUSES` is a total `Record`, and `OutcomeAddenda.resumeRefusal` is required. All three are compile errors until handled — the property Step 15 built them for      |
| `verify:public-types` fails on a type the rollup cannot inline              | Run it in step 6, immediately after the surface change, rather than at the end                                                                                                                                                       |

## Open Questions

- Whether a consumer should be able to ask about resumability **before** calling — filed as [#912], deliberately out of this step.
- Whether `releaseDelivery` (the counterpart to a claim) belongs on the service at all, or only as part of [#897]'s general pair.
  This plan takes no position; `claimOutcome` is scoped to one call and needs no release, because the resume it claims is the one it awaits.

[#798]: https://github.com/gotgenes/pi-packages/issues/798
[#832]: https://github.com/gotgenes/pi-packages/issues/832
[#872]: https://github.com/gotgenes/pi-packages/issues/872
[#878]: https://github.com/gotgenes/pi-packages/issues/878
[#896]: https://github.com/gotgenes/pi-packages/issues/896
[#897]: https://github.com/gotgenes/pi-packages/issues/897
[#903]: https://github.com/gotgenes/pi-packages/issues/903
[#912]: https://github.com/gotgenes/pi-packages/issues/912
[#913]: https://github.com/gotgenes/pi-packages/issues/913
[ADR 0005]: ../decisions/0005-subagent-record-admission-policy.md
