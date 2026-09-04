---
issue: 870
issue_title: "pi-subagents: a workspace addendum produced after the result edge is dropped"
---

# Deliver a workspace addendum produced after the result edge

## Release Recommendation

**Release:** ship independently

Phase 22 Step 12 in `packages/pi-subagents/docs/architecture/architecture.md` carries `Release: independent`, and no release batch names it.
The change lands `fix:` commits in both `pi-subagents` and `pi-subagents-worktrees`, so the ship dispatch names both packages.

## Problem Statement

`Workspace.dispose()` returns a `resultAddendum` the core folds into the child's result text, so the string only has a reader while a result is still being assembled.
At every other disposal edge `Subagent.disposeWorkspaceQuietly()` throws it away.

For `@gotgenes/pi-subagents-worktrees` that string is the only thing naming the rescue branch the child's work was committed to:

```text
Changes saved to branch `pi-agent-<id>`. Merge with: `git merge pi-agent-<id>`
```

The preserved-worktree scan does not cover it: that scan reports worktrees left on disk by a *failed* cleanup, and this cleanup succeeds.
The branch is simply orphaned.

## Goals

- A workspace notice produced at an edge with no result text still reaches the parent through the carriers that already report the child's outcome.
- A notice produced after the child's result was delivered is announced to the parent and the user at the moment it is produced.
- A rescue branch nobody was told about is findable in a later session, including after a quit or a crash, where the core has no channel at all.
- Run-end behavior is unchanged: `completeRun()` and `completeResume()` still concatenate the addendum into the result text.
- Not a breaking change.
  No signature, default, or config changes; `WorkspaceProvider`, `Workspace`, `WorkspaceDisposeOutcome`, and `SubagentRecord` are untouched.

## Non-Goals

- **Extending `SubagentRecord`.**
  A branch name is a durable-artifact pointer, which [decision 0005](../../packages/pi-subagents/docs/decisions/0005-subagent-record-admission-policy.md) admits, so the omission is a "no vacant hooks" call rather than a policy one: no consumer outside this package asks for it.
  The new `workspaceNotice` accessor lives on the `Subagent` class, read by the core's own carriers, exactly as [#857]'s `workspaceDisposed` does.
  Revisit condition: a named consumer.
- **A new `pi.events` channel.**
  `SubagentEventsObserver` emits an event for every other hook it relays, but a `subagents:workspace-notice` channel would have no subscriber in this repo or outside it.
  The notice's audience is the parent model and the user, both of which the two chosen carriers reach.
  Revisit condition: a consumer asks.
- **Changing `WorkspaceDisposeOutcome`.**
  An earlier candidate had the core tell the provider that its addendum has no reader, so the provider could act.
  The stateless branch scan makes that field unnecessary — it needs no per-disposal signal and also covers a crash, where no `dispose()` runs at all.
- **A delete affordance for rescue branches.**
  `/subagents-worktrees` stays worktree-scoped.
  The remedy for a branch is `git merge`, which the notice names; the destructive counterpart is `git branch -D` on unmerged work, which is the one thing this package's own comments say nothing should do on the extension's judgment.
- **Changing the retention windows or the sweep.**
  `resolveRetentionWindow` keeps its meaning and defaults.
- **Reconciling the question affordance with a released session.**
  After `releaseSession()` a record keeps its `pendingQuestion`, so `get_subagent_result` still renders "Answer by calling subagent with resume", while `AgentTool` refuses that resume as a released session.
  Verified during planning and pre-existing (it arrives with [#857] and [#858]); filed as [#878].

## Background

### The five drop edges

All five reach `Subagent.disposeWorkspaceQuietly()` in `packages/pi-subagents/src/lifecycle/subagent.ts`, which discards the addendum by design because "these are the paths with no result text left to fold it into".

| Edge                                             | Trigger                | Record still in the manager's map    | `NotificationManager` alive                                                                                                 |
| ------------------------------------------------ | ---------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `failRun`                                        | the child's run throws | yes                                  | yes                                                                                                                         |
| `failResume`                                     | a resume throws        | yes                                  | yes                                                                                                                         |
| `releaseSession` → `disposeHeldWorkspace`        | the retention sweep    | yes                                  | yes                                                                                                                         |
| `disposeSession` via `clearCompleted()`          | `/new`, session switch | no — `removeRecord` deletes it first | yes                                                                                                                         |
| `disposeSession` via `SubagentManager.dispose()` | Pi shutdown            | no — the map is cleared              | no — `SessionLifecycleHandler.handleSessionShutdown` disposes notifications at step 3, before `manager.dispose()` at step 5 |

Two facts sharpen the issue's framing.

1. **The sweep is not the realistic edge.**
   A held workspace implies `pendingQuestion !== undefined`, and `resolveRetentionWindow` takes the short 10-minute branch only when `pendingQuestion === undefined`.
   So a held workspace waits the 720-minute window; in practice the drop happens at a session switch or at quit.
2. **The error paths predate [#857].**
   `failRun` has discarded the addendum since the `WorkspaceBracket` extraction (`1e16137e`, Phase 17), and inline before that.
   `cleanupWorktree` commits a dirty tree whatever the status, so a worktree-backed child that errors mid-run also commits to `pi-agent-<id>` with nobody told.
   The operator scoped this plan to all five edges.

### Why the announcement cannot cover shutdown

Notifications are disposed before the manager at shutdown, deliberately: "no parent run is active at shutdown, so a terminal transition delivers its nudge synchronously and Pi cannot recall it."
That ordering is correct and this plan does not disturb it, which is why the durable half exists.

### Pi's custom-message delivery, read from the pinned SDK

`sendCustomMessage` in `@earendil-works/pi-coding-agent@0.84.4` (`dist/core/agent-session.js:1099`) branches in this order:

```javascript
if (options?.deliverAs === "nextTurn") { this._pendingNextTurnMessages.push(appMessage); }
else if (this.isStreaming && options?.triggerTurn !== false) { /* followUp / steer */ }
else if (options?.triggerTurn) { await this._runAgentPrompt(appMessage); }
else if (this.isStreaming) { this._pendingCustomMessages.push(appMessage); }
else { this._appendCustomMessage(appMessage); }
```

Three consequences the design rests on:

1. `triggerTurn: false` with no `deliverAs` takes one of the last two branches — appended and rendered immediately when the parent is idle, or buffered and flushed by `_flushPendingCustomMessages()` at `turn_end` (`agent-session.js:426`) when it is streaming.
   Either way the message lands in the session, so the parent reads it as context on its next turn, and no turn is started.
2. That path has none of the unrecallable-`followUp` hazard `NotificationManager`'s withheld queue exists for, because it never reaches `agent.followUp()` or `agent.steer()`.
   So the notice needs no parent-run withhold and adds no `PendingAnnouncement` variant.
3. `deliverAs: "nextTurn"` was rejected on this reading: it only buffers, never calls `_appendCustomMessage`, so the user sees nothing and the parent sees it only if it submits another prompt — and the buffer is discarded on quit.

### Constraints from `AGENTS.md`

- The core has no knowledge of git or worktrees; this plan adds none.
- Architecture-doc module-tree entries describe current behavior and carry no issue refs.
- `docs/plans/` and `docs/retro/` are excluded from release scope; `pi-subagents-worktrees` ships only `src`, `README.md`, `CHANGELOG.md`, and `LICENSE`, so a new `src/` module needs no allowlist edit.

## Design Overview

### The rule

> An addendum a quiet disposal produces is captured on the record instead of discarded.
> Every carrier that already reports the child's outcome reports it too.
> When the disposal happens after the result was delivered, the notice is additionally announced on its own.
> A rescue branch that reached none of those is found again by a scan at the next session start.

### Core: capture

`Subagent` gains one private field and one accessor, beside `workspaceDisposed`:

```typescript
private _workspaceNotice?: string;
/** What a quiet disposal reported, when there was no result text to fold it into. */
get workspaceNotice(): string | undefined { return this._workspaceNotice; }

private disposeWorkspaceQuietly(status: SubagentStatus): string {
  try {
    const notice = this.workspaceBracket.dispose({ status, description: this.description });
    if (notice) this._workspaceNotice = notice;
    return notice;
  } catch (err) { debugLog(`workspace dispose (${status})`, err); return ""; }
}
```

Returning the string rather than reading the field back is what makes the announcement fire once.
`disposeHeldWorkspace()` is reachable from both `releaseSession()` and `disposeSession()`, and `WorkspaceBracket.dispose()` is idempotent, so the second call returns `""` while the field still holds the first call's value.

### Core: announce

```typescript
private disposeHeldWorkspace(): void {
  if (this.isActive()) return;
  const notice = this.disposeWorkspaceQuietly(this.status);
  if (notice) this.execution.observer?.onWorkspaceNotice?.(this, notice);
}
```

`failRun()` and `failResume()` call `disposeWorkspaceQuietly` directly and do not announce: their own terminal notification fires immediately afterwards, and it now carries the notice.

The relay chain mirrors the `onUpdateSent` / `onSubagentUpdate` pair [#858] added, one layer at a time:

| Layer                       | Member                                       | Shape                                            |
| --------------------------- | -------------------------------------------- | ------------------------------------------------ |
| `SubagentLifecycleObserver` | `onWorkspaceNotice?(agent, notice)`          | optional                                         |
| `SubagentManagerObserver`   | `onSubagentWorkspaceNotice?(record, notice)` | optional, relayed by `buildObserver()`           |
| `CompositeSubagentObserver` | `onSubagentWorkspaceNotice(record, notice)`  | **required**, optional-chains into each delegate |
| `SubagentEventsObserver`    | `onSubagentWorkspaceNotice(record, notice)`  | calls `notifications.sendWorkspaceNotice(...)`   |

The composite row is the one this design nearly missed, and it is why the chain is spelled out.
`index.ts` wires `new CompositeSubagentObserver([eventsObserver])` as the manager's observer, and the composite implements `SubagentManagerObserver` by explicitly enumerating every method.
An optional member it does not enumerate is dropped with no compiler error, no test failure, and no runtime error — the feature would silently no-op in production while every unit test passed.
Declaring it **required** on the composite is what makes the manager-to-composite hop compile-checked.

### Core: the announcement itself

```typescript
sendWorkspaceNotice(record: Subagent, notice: string): void {
  if (this.disposed) return;
  this.sendMessage(
    {
      customType: "subagent-workspace-notice",
      content: formatWorkspaceNotice(record, notice),
      display: true,
      details: { id: record.id, description: record.description, notice },
    },
    { triggerTurn: false },
  );
}
```

The `disposed` latch is the only gate.
`claimed` and `consumed` both record that the child's *outcome* has an owner, and this is a new fact rather than that outcome told again — the same reasoning `sendUpdate` already carries.
There is no parent-run withhold and no queue entry, per Background fact 2.

### Core: the carriers

`outcome-delivery.ts` gains a pure renderer beside `renderQuestionAffordance`:

```typescript
/** The provider's own wording for where a late-disposed child's work went. Empty when there is none. */
export function renderWorkspaceNotice(notice: string | undefined): string {
  return notice ?? "";
}
```

It is a pass-through today because the addendum arrives fully framed (`\n\n---\n…`), and it is a function so the framing has one home if a carrier ever needs its own.
The four carriers that already compose `renderQuestionAffordance` each gain one term, in the same position — after the outcome body, before the call to action:

```typescript
renderOutcomeBody(record) +
  renderWorkspaceNotice(record.workspaceNotice) +
  renderQuestionAffordance(record.id, record.pendingQuestion),
```

`get-result-report.ts` reads it from a new optional `AgentReport.workspaceNotice`, populated by `GetResultTool.buildReport`, so the report type keeps its "only what the formatter reads" contract.

### Worktrees: the durable half

`git branch --list 'pi-agent-*' --no-merged HEAD --format='%(refname:short)'` was run at planning time against this repo: exit 0, one process, empty output where no such branch exists.
The glob is built from the existing `AGENT_WORKTREE_PREFIX` constant rather than a second hardcoded literal, so the two cannot drift; the constant also covers the `pi-agent-<id>-<timestamp>` fallback name `createBranch` uses on a collision.

`src/rescue-branches.ts` mirrors `src/preserved.ts` exactly — a `find…` that swallows a git failure and returns `[]`, and a `format…Notice` with the same five-item cap — and the existing `session_start` handler gains a second `ctx.ui.notify(..., "warning")` behind the same `ctx.hasUI` gate.

Two properties follow from the scan being stateless rather than edge-driven:

- It covers every drop edge including a hard crash, where no `dispose()` runs at all and no state file would have been written.
- It self-validates: `--no-merged HEAD` means a branch drops off the report the moment its work is merged, so a stale entry is not possible and no clearing rule is needed.

The cost the operator accepted is that it also names a branch the parent *was* told about and never merged.

### Interaction table

| Disposal edge                           | Notice on the record               | Carrier                                                                | Standalone announcement             | Next-session scan |
| --------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------- | ----------------------------------- | ----------------- |
| `completeRun` / `completeResume`        | no — folded into `result` as today | result text                                                            | no                                  | yes, until merged |
| `failRun` / `failResume`                | yes                                | completion nudge, `get_subagent_result`, foreground and resume returns | no                                  | yes, until merged |
| `releaseSession` (sweep)                | yes                                | `get_subagent_result`                                                  | yes                                 | yes, until merged |
| `disposeSession` via `clearCompleted()` | yes, but the record is unreachable | none                                                                   | yes                                 | yes, until merged |
| `disposeSession` via shutdown           | yes, but the record is unreachable | none                                                                   | no — notifications already disposed | yes, until merged |

## Module-Level Changes

### `packages/pi-subagents/src/lifecycle/subagent.ts`

- New `_workspaceNotice` field and `workspaceNotice` getter, documented beside `workspaceDisposed`.
- `disposeWorkspaceQuietly(status)` returns the captured addendum (`""` when none) and records it; its doc comment changes from "the addendum is discarded" to what it now does.
- `disposeHeldWorkspace()` announces a freshly-produced notice through the observer.
- `SubagentLifecycleObserver` gains optional `onWorkspaceNotice?(agent, notice)`.

### `packages/pi-subagents/src/lifecycle/subagent-manager.ts`

- `SubagentManagerObserver` gains optional `onSubagentWorkspaceNotice?(record, notice)`, with the same "a hook nobody supplies is a vacant one" note `onSubagentUpdate` carries.
- `buildObserver()` relays it.

### `packages/pi-subagents/src/observation/composite-subagent-observer.ts`

- New required `onSubagentWorkspaceNotice(record, notice)` dispatching with optional chaining, mirroring `onSubagentUpdate`.

### `packages/pi-subagents/src/observation/subagent-events-observer.ts`

- New `onSubagentWorkspaceNotice(record, notice)` calling `notifications.sendWorkspaceNotice(record, notice)`.
- Announced, never persisted and never emitted as an event — the same shape as `onSubagentUpdate`, minus the `emit`.

### `packages/pi-subagents/src/observation/notification.ts`

- `NotificationSystem` gains `sendWorkspaceNotice`.
- New `WorkspaceNoticeDetails` interface and `formatWorkspaceNotice(record, notice)` producing a `<workspace-notice>` block with `<task-id>`, `<summary>`, and an `escapeXml`-escaped `<notice>`.
- New `NotificationManager.sendWorkspaceNotice`, gated on `disposed` only.
- `buildPointerLines` leads with `renderWorkspaceNotice(record.workspaceNotice)`, so the nudge for a failed run names where the work went before it names how to collect the result.

### `packages/pi-subagents/src/observation/outcome-delivery.ts`

- New exported `renderWorkspaceNotice(notice)`.
- The module doc comment's carrier list gains the standalone notice as a fifth channel, distinguished as carrying a fact about the workspace rather than the outcome.

### `packages/pi-subagents/src/observation/renderer.ts`

- New `createWorkspaceNoticeRenderer()`, reusing `buildPreviewLines` the way `createUpdateRenderer` does.

### `packages/pi-subagents/src/tools/get-result-report.ts`

- `AgentReport` gains optional `workspaceNotice`; `formatAgentReport` appends `renderWorkspaceNotice(...)` between the body and the question affordance.

### `packages/pi-subagents/src/tools/get-result-tool.ts`

- `buildReport` populates `workspaceNotice` from the record.

### `packages/pi-subagents/src/tools/foreground-runner.ts` and `src/tools/agent-tool.ts`

- One `renderWorkspaceNotice(record.workspaceNotice)` term added to each existing concatenation.

### `packages/pi-subagents/src/index.ts`

- Registers the workspace-notice message renderer beside the other two.

### `packages/pi-subagents-worktrees/src/worktree.ts`

- New exported `listUnmergedRescueBranches(cwd)`, beside `listWorktreePaths`, using the private `runGit` helper and building its glob from `AGENT_WORKTREE_PREFIX`.

### `packages/pi-subagents-worktrees/src/rescue-branches.ts` (new)

- `findUnmergedRescueBranches(repoCwd)` — swallows a git failure via `debugLog` and returns `[]`, matching `findPreservedWorktrees`.
- `formatRescueBranchNotice(branches)` — a five-item cap with an "…and N more" tail, naming `git merge <branch>` as the remedy.

### `packages/pi-subagents-worktrees/src/index.ts`

- The existing `session_start` handler gains a second `ctx.ui.notify(..., "warning")` behind the same `ctx.hasUI` gate.

### `packages/pi-subagents-worktrees/README.md`

- A `## Behavior` bullet for the branch warning, beside the existing worktree one at line 55.
- A short paragraph under `## Recovering preserved worktrees` (or a sibling section) for merging a rescue branch, since that section currently speaks only of worktrees on disk.

### `packages/pi-subagents/docs/architecture/architecture.md`

- Module-tree entries: `subagent.ts`, `notification.ts`, `outcome-delivery.ts`, `composite-subagent-observer.ts`, and `subagent-events-observer.ts`.
- Phase 22 Step 12: the `✅` heading mark, the `S12` Mermaid node, and a `Landed:` note.

### Greps performed at planning time

- `resultAddendum` across `src/`, `test/`, and `docs/` — the only non-plan doc hits are `architecture.md`'s Step 10/12 prose and `history/phase-17-core-consolidation.md`, which describes what Phase 17 landed and stays true.
- `addendum` across both packages' `docs/`, both `README.md` files, and `.pi/skills/` — no hit becomes false.
- `.pi/skills/package-pi-subagents/SKILL.md` — the Observation domain row describes `notification.ts` as "announce-only completion nudges (…)".
  It already omits the mid-run updates [#858] added, so it is incomplete rather than made false, and no edit is planned.
- No export is removed or renamed, so the removal greps do not apply.

## Test Impact Analysis

### What the change makes newly testable

- `Subagent.workspaceNotice` gives the error and deferred edges an observable answer to "what did the teardown report?", which today can only be inferred from a `dispose` spy on a stub.
- `disposeWorkspaceQuietly`'s return value makes announce-once directly assertable rather than argued from the bracket's idempotency.

### Existing tests that must change

`test/lifecycle/subagent.test.ts`, "disposes with status error when the turn loop throws", builds its workspace with `resultAddendum: "\nshould be discarded"` and asserts `agent.result` is `undefined`.
That assertion stays green — the notice goes to `workspaceNotice`, not `result` — but the fixture string becomes a lie, so the step that captures the notice renames it and adds the positive assertion.

### Existing tests that stay

Every ask-back and hold test in `subagent.test.ts` runs on paths this change does not touch. "appends the dispose resultAddendum to the result" is the pin for the unchanged run-end behavior and must stay green verbatim. "disposes a held workspace only once across release and teardown" is the existing pin the announce-once test extends rather than replaces.

### Tests that become redundant

None.

### Test-helper gap found at planning time

`makePiParent()` in `test/observation/notification.test.ts` models Pi's delivery as `if (runActive && deliverAs === "followUp") push; else if (opts?.triggerTurn) push;`.
The chosen mode is `triggerTurn: false` with no `deliverAs`, which matches neither branch, so a delivery test written against the helper as-is would record nothing delivered even when `sendMessage` really fired.
That is what makes it a preparatory step rather than a detail: without it, the test asserting the notice is *not* withheld during a parent run passes for the wrong reason.

### Reusable harnesses confirmed

`packages/pi-subagents-worktrees/test/index.test.ts` already has the `startWithService()` / `fakeCtx()` / `handlers.get("session_start")` harness the second `notify()` needs, mocking `#src/preserved` the same way the new module will be mocked.
`test/support/git-fixture.ts`'s `initGitRepo` is directly reusable for the branch-listing tests.
`AgentReport`/`makeReport()` and `TestSubagentOptions`/`createTestSubagent()` already take `Partial<...>` overrides, so a new optional field costs nothing.

### Baseline

Measured at planning time: `pi-subagents` **1514 tests across 76 files**; `pi-subagents-worktrees` **62 tests across 7 files**.
Estimated after: `pi-subagents` 77 files (the renderer and notice tests land in existing files; no new core test file is required beyond none), roughly 25–35 added tests; `pi-subagents-worktrees` 8 files (`rescue-branches.test.ts`), roughly 10–14 added tests.

## Invariants at risk

| Invariant                                                                                  | Source                                               | Pin                                                                                    | Risk here                                                                                                                                                             |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A completed child that declared a question holds its workspace                             | Step 10 ([#857]) `Landed:`                           | `subagent.test.ts` — "holds the workspace when a completed child declared a question"  | The hold condition lives in `completeRun`, which this plan does not touch; opened and confirmed it asserts `dispose` uncalled and `result` addendum-free              |
| The run-end addendum still rides the result text                                           | Step 10 ([#857])                                     | `subagent.test.ts` — "appends the dispose resultAddendum to the result"                | `completeRun`/`completeResume` are untouched by design; this test is the guard                                                                                        |
| A held workspace is disposed exactly once across release and teardown                      | Step 10 ([#857])                                     | `subagent.test.ts` — "disposes a held workspace only once across release and teardown" | `disposeHeldWorkspace` gains an announcement; the returned-string design is what keeps the announcement single, and a new assertion on the observer extends this test |
| `Workspace.dispose()` throws propagate; the best-effort wrap belongs at the call site      | Phase 16 Step 2 (`workspace-bracket.ts` doc comment) | `workspace-bracket.test.ts` — "propagates a throwing dispose (does not swallow)"       | `disposeWorkspaceQuietly` keeps its `try`/`catch` and now returns `""` from the catch                                                                                 |
| An aborted or steered run's declared question is still recorded                            | Step 8 ([#465])                                      | `subagent.test.ts` question tests                                                      | Untouched: no change to `pendingQuestion` handling                                                                                                                    |
| A completion nudge is suppressed once a carrier claimed or the parent consumed the outcome | [#617], [#798]                                       | `notification.test.ts` claim/consumption tests                                         | `sendWorkspaceNotice` deliberately consults neither; the existing `sendCompletion` gates are not modified                                                             |
| Nudges are silenced permanently once the manager is disposed                               | `notification.ts` disposal latch                     | `notification.test.ts` disposal tests                                                  | `sendWorkspaceNotice` honors the same latch, which is also what makes the shutdown edge uncovered by design                                                           |
| A withheld announcement is flushed on `agent_settled` in arrival order                     | [#661]                                               | `notification.test.ts` "parent-turn boundary" block                                    | The notice adds no `PendingAnnouncement` variant, so the queue's shape and ordering are unchanged                                                                     |

## TDD Order

### 1. `test(pi-subagents): model Pi's custom-message delivery branches in the notification test parent`

Preparatory.
Widen `makePiParent()`'s `sendMessage` stub in `test/observation/notification.test.ts` to mirror `sendCustomMessage`'s real branch order, so a `triggerTurn: false` message with no `deliverAs` is recorded as delivered (immediately when idle, at flush when a run is active) rather than dropped.
No production change.

Killing mutation: make the widened branch a no-op — the existing parent-turn-boundary tests stay green and the new branch's own test goes red, which is the point: the helper's gap is invisible to today's suite.

Verify: full `pi-subagents` suite green at 1514.

### 2. `refactor(pi-subagents): capture the addendum a quiet workspace disposal produces`

`Subagent` gains `_workspaceNotice` and the `workspaceNotice` getter; `disposeWorkspaceQuietly` records and returns the addendum.
Nothing outside the tests reads it yet, which is why this is `refactor:`.
Rename the "should be discarded" fixture in the existing turn-loop-throws test and add its positive assertion.

Tests (`test/lifecycle/subagent.test.ts`):

- `workspaceNotice` is `undefined` on a fresh agent, and after a run that completed normally (the addendum went into `result`).
- It holds the addendum after a run whose turn loop threw, after a resume that threw, after `releaseSession()` on a held workspace, and after `disposeSession()` on one.
- It is `undefined` after a quiet disposal whose workspace returned no addendum.

Killing mutations, one per class:

- Make the getter return `undefined` unconditionally → the four positive-capture tests go red; the three negative ones stay green.
- Make it return a constant string → the three negative tests go red; the positive ones stay green.
  A boolean-or-optional accessor needs both directions, per [#857]'s TDD retro.
- Delete the `if (notice)` guard so an empty string is assigned → the "no addendum" test goes red only if it asserts `undefined` rather than falsiness, so assert `toBeUndefined()`.

Verify: `pnpm run check`, then the full `pi-subagents` suite.

### 3. `fix(pi-subagents): tell the parent where a failed child's work was saved`

The carrier half.
`renderWorkspaceNotice` in `outcome-delivery.ts`; `AgentReport.workspaceNotice` and its population in `get-result-tool.ts`; the added term in `get-result-report.ts`, `foreground-runner.ts`, `agent-tool.ts`, and `notification.ts`'s `buildPointerLines`.
After this step the `failRun` and `failResume` edges are fixed, and the sweep edge is fixed for a parent that pulls again.

Tests (`test/observation/outcome-delivery.test.ts`, `test/tools/get-result-report.test.ts`, `test/tools/foreground-runner.test.ts`, `test/tools/agent-tool.test.ts`, `test/observation/notification.test.ts`):

- `renderWorkspaceNotice` returns `""` for `undefined` and the string verbatim otherwise.
- Each of the four carriers includes the notice when the record has one, and is byte-identical to today when it does not.
- In `formatAgentReport` the notice sits between the outcome body and the question affordance.

Killing mutations:

- Make `renderWorkspaceNotice` return `""` unconditionally → the four carrier-inclusion tests go red; the four absent-notice tests stay green.
- Drop the term from `buildPointerLines` only → the nudge test goes red; the other three carriers stay green.
- Move the term after `renderQuestionAffordance` in `formatAgentReport` → the ordering test goes red; the inclusion test stays green.

Verify: `pnpm run check`, full `pi-subagents` suite.

### 4. `refactor(pi-subagents): add a workspace-notice announcement to the notification manager`

`formatWorkspaceNotice`, `WorkspaceNoticeDetails`, `NotificationSystem.sendWorkspaceNotice`, `NotificationManager.sendWorkspaceNotice`, `createWorkspaceNoticeRenderer`, and the `index.ts` renderer registration.
Nothing calls `sendWorkspaceNotice` in production yet, so this is `refactor:`; the renderer registration ships in the same commit because a `customType` with no renderer is a half-wired surface.

Tests (`test/observation/notification.test.ts`, `test/observation/renderer.test.ts`, the composition-root test):

- `formatWorkspaceNotice` emits the block with the id, the description, and an XML-escaped notice.
- `sendWorkspaceNotice` calls `sendMessage` with `triggerTurn: false` and **no** `deliverAs`.
- It fires for a claimed record and for a consumed one — the two gates it deliberately does not consult.
- It is silent once `dispose()` has been called.
- It is delivered while a parent run is active, using the widened helper from step 1 — the pin for "no withhold".
- The renderer returns `undefined` without details and renders the notice text with details.

Killing mutations:

- Add `if (record.consumed) return;` → the consumed and claimed tests go red; the disposal test stays green.
- Delete the `disposed` guard → the disposal test goes red; the rest stay green.
- Change the options to `{ deliverAs: "followUp", triggerTurn: true }` → the options test and the parent-run delivery test go red.

Verify: `pnpm run check`, full `pi-subagents` suite, `pnpm fallow dead-code`.

### 5. `fix(pi-subagents): announce where a late-disposed child's work was saved`

The wiring: `onWorkspaceNotice` on `SubagentLifecycleObserver`, the announcement in `disposeHeldWorkspace`, `onSubagentWorkspaceNotice` on `SubagentManagerObserver` with its `buildObserver()` relay, the required method on `CompositeSubagentObserver`, and `SubagentEventsObserver`'s handler.

Tests (`test/lifecycle/subagent.test.ts`, `test/lifecycle/subagent-manager.test.ts`, `test/observation/composite-subagent-observer.test.ts`, `test/observation/subagent-events-observer.test.ts`):

- A held agent's `releaseSession()` announces once with the addendum; its `disposeSession()` announces once.
- A held agent released **and then** disposed announces exactly once — the pin that the returned string, not the stored field, drives the announcement.
- A running agent's `disposeSession()` announces nothing.
- A quiet disposal with no addendum announces nothing.
- `failRun` and `failResume` do **not** announce — their nudge carries it, and a second channel would double-report.
- `buildObserver()` relays the manager hook; `CompositeSubagentObserver` fans it out to every delegate and survives a delegate that lacks the optional member; `SubagentEventsObserver` calls `sendWorkspaceNotice` and emits no event.

Killing mutations:

- Delete `CompositeSubagentObserver.onSubagentWorkspaceNotice` → the composite fan-out test goes red.
  This is the mutation that matters most: without the test, deleting the method is invisible to `tsc`, to the suite, and at runtime.
- Replace the announcement's argument with `this._workspaceNotice` instead of the returned string → the announce-exactly-once test goes red; the single-edge tests stay green.
- Delete the `!this.isActive()` guard's protection by announcing before it → the running-agent test goes red.
- Add an announcement to `failRun` → the "does not announce" test goes red; the nudge-carries-it test from step 3 stays green.

Verify: `pnpm run check`, full `pi-subagents` suite, `pnpm fallow dead-code`.

### 6. `fix(pi-subagents-worktrees): warn about unmerged rescue branches at session start`

`listUnmergedRescueBranches` in `worktree.ts`, the new `rescue-branches.ts`, and the second `notify()` in the `session_start` handler.
All three land together: an exported git primitive with no consumer would fail `pnpm fallow dead-code` on its own.

Tests (`test/worktree.test.ts`, `test/rescue-branches.test.ts` (new), `test/index.test.ts`):

- Against a real fixture repo (`initGitRepo`): a committed-but-unmerged `pi-agent-*` branch is listed; a merged one is not; a branch without the prefix is not; a repo with none returns `[]`.
- `findUnmergedRescueBranches` returns `[]` and does not throw outside a git repo.
- `formatRescueBranchNotice` names one branch in the singular, caps at five with an "…and N more" tail, and names `git merge`.
- The `session_start` handler notifies for branches, does not notify when there are none, and does nothing at all when `ctx.hasUI` is false.

Killing mutations:

- Drop `--no-merged HEAD` from the git args → the merged-branch test goes red; the unmerged one stays green.
- Replace the `AGENT_WORKTREE_PREFIX`-derived glob with `*` → the unrelated-branch test goes red.
- Delete the `ctx.hasUI` early return → the headless test goes red; the two notify tests stay green.
- Delete the second `notify()` call → the branch-notification test goes red; the existing preserved-worktree test stays green.

Verify: `pnpm run check`, both package suites, `pnpm fallow dead-code`.

### 7. `docs(pi-subagents-worktrees): document the unmerged-branch warning`

The `## Behavior` bullet and the recovery note.

Verify: `pnpm exec rumdl check packages/pi-subagents-worktrees/README.md`.

### 8. `docs(pi-subagents): mark Phase 22 Step 12 complete`

The `✅` heading mark, the `S12` Mermaid node, the `Landed:` note, and the five module-tree entries.

Verify: `pnpm run lint`, and render the Mermaid block per the `mermaid` skill.

## Risks and Mitigations

**The composite observer silently swallows the new hook.**
The single highest risk, and the one the Tidy-First assessment caught in the design rather than in review.
Mitigated structurally by declaring the member **required** on `CompositeSubagentObserver` (so the manager-to-composite hop is compile-checked) and pinned by step 5's fan-out test, whose killing mutation is deleting that method.

**A notice is announced twice.**
`disposeHeldWorkspace` is reachable from both `releaseSession()` and `disposeSession()`, and the retention sweep can be followed by shutdown on the same record.
Mitigated by announcing the value `disposeWorkspaceQuietly` **returns** rather than the stored field, which is empty on the second call because `WorkspaceBracket.dispose()` is idempotent.
Pinned by the release-then-dispose test.

**A notice is reported twice through different channels.**
A failed run's nudge carries the notice (step 3) and could also announce it (step 5).
Prevented by announcing only from `disposeHeldWorkspace`, and pinned by the "`failRun` does not announce" test.

**The branch scan is noisy.**
It names every unmerged `pi-agent-*` branch, including ones the parent was told about.
Accepted by the operator as the price of covering shutdown and crashes with no state file.
Bounded by the five-item cap and by `--no-merged`, which drops a branch the moment its work is merged.

**The scan runs `git` on every session start.**
One extra `git branch --list` in a handler that already runs `git worktree list --porcelain`, behind the same `ctx.hasUI` gate, so no child session pays for it.
Measured at planning time as a single process with exit 0.

**Shutdown remains uncovered in-band, by design.**
Notifications are disposed before the manager, and reordering that would reintroduce the unrecallable-nudge hazard its comment documents.
The scan is the mitigation, and it is the reason the durable half is in this plan rather than deferred.

**`renderWorkspaceNotice` is a pass-through.**
It could be inlined as `(record.workspaceNotice ?? "")` at four sites.
Kept as a function so the four sites stay identical in shape to their `renderQuestionAffordance` neighbour and the framing has one home; the cost is one indirection.

## Open Questions

- Should the standalone notice also carry the child's transcript pointer?
  Deferring: the notice's one job is naming where the work went, and the record is already unreachable at two of the three edges that raise it.
- Should `formatRescueBranchNotice` report a branch's commit date or subject?
  Deferring until someone reports that a bare branch name is not enough to tell two rescue branches apart.
- Should the question affordance be suppressed once a resume would be refused?
  Filed as [#878]; out of scope here.

[#465]: https://github.com/gotgenes/pi-packages/issues/465
[#617]: https://github.com/gotgenes/pi-packages/issues/617
[#661]: https://github.com/gotgenes/pi-packages/issues/661
[#798]: https://github.com/gotgenes/pi-packages/issues/798
[#857]: https://github.com/gotgenes/pi-packages/issues/857
[#858]: https://github.com/gotgenes/pi-packages/issues/858
[#878]: https://github.com/gotgenes/pi-packages/issues/878
