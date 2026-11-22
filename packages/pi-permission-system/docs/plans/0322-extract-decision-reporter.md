---
issue: 322
issue_title: "Extract a DecisionReporter for permission gate review-log and decision events"
---

# Extract a DecisionReporter for permission gate review-log and decision events

## Problem Statement

In `PermissionGateHandler.handleToolCall`, two of the `GateRunnerDeps` closures report a gate's outcome and always travel together:

```typescript
const emitDecision: GateRunnerDeps["emitDecision"] = (e) =>
  emitDecisionEvent(this.events, e);
// eslint-disable-next-line @typescript-eslint/unbound-method
const writeReviewLog = this.session.logger.review;
```

`writeReviewLog` reaches through the session to `logger.review` — a Law-of-Demeter violation that also forces the `unbound-method` disable.
`emitDecision` wraps the event bus.
Together they form one cohesive role — "report the permission outcome to the review log and the decision channel" — that has no home object today.
The runner fires both on the session-hit path, the final decision path, and (via `applyPermissionGate`'s `writeLog`) the prompt path; the handler's bypass branch fires them too, and `handleInput` repeats the same reach-through and bus-wrap for the `/skill:` path.

This is the second step of the gate-runner collaborator rework: #319 (landed) collapsed the `checkPermission` + `getSessionRuleset` relay into `PermissionResolver`; this issue extracts the reporter role; #323 replaces `GateRunnerDeps` with a `GateRunner` class injected with the role collaborators (resolver, recorder, prompter, reporter); and #325 — the phase capstone — retypes `PermissionGateHandler` against the resulting narrow role interfaces (`PermissionResolver`, `DecisionReporter`, `GatePrompter`, `SessionApprovalRecorder`) instead of the concrete `PermissionSession`, dropping the `as unknown as PermissionSession` test casts.
The `DecisionReporter` interface this plan introduces is one of the four roles #325 consumes, so the architecture doc must thread #325 into the same decomposition chain even though its residual-cluster decomposition is still nebulous.

## Goals

- Define a narrow `DecisionReporter` interface: `writeReviewLog(event, details)` and `emitDecision(event)`.
- Add a `GateDecisionReporter` class that owns the `SessionLogger` and the event bus and implements the interface (`emitDecision` delegates to `emitDecisionEvent`).
- Build it once in `PermissionGateHandler`'s constructor from the session's logger and the event bus.
- Carry the reporter as a single named role in `GateRunnerDeps` (replacing the inline `writeReviewLog` + `emitDecision` members) and use it on the runner's three fire sites and the handler's bypass branch.
- Route `handleInput` through the same reporter instance, removing its duplicate reach-through and bus-wrap.
- Delete the `writeReviewLog`/`emitDecision` closures, the two `unbound-method` eslint-disables on `this.session.logger.review`, and the handler's `emitDecisionEvent` import.
- Keep the change behavior-preserving.

## Non-Goals

- Replacing `GateRunnerDeps` with a `GateRunner` class injected with role collaborators — that is #323.
- Changing any permission decision, log entry, or decision-event payload (`PermissionDecisionEvent` shape is untouched).
- Touching `emitDecisionEvent` itself or the `permissions:decision` channel — the reporter wraps the existing primitive.
- Adding a `DecisionReporter` to `PermissionPrompter`, `permission-event-rpc`, or the forwarder — those carry their own unrelated `writeReviewLog` fields and stay as-is.

## Background

- `src/handlers/permission-gate-handler.ts` builds the `emitDecision`/`writeReviewLog` closures per `handleToolCall`, packs them into the `GateRunnerDeps` bag, and fires them directly in the bypass branch (`runGate`).
  `handleInput` independently calls `emitDecisionEvent(this.events, {...})` and passes `writeLog: this.session.logger.review` (its own `unbound-method` disable) to `applyPermissionGate`.
- `src/handlers/gates/descriptor.ts` declares `interface GateRunnerDeps extends PermissionResolver` with inline `writeReviewLog(event, details)` and `emitDecision(event)` members.
- `src/handlers/gates/runner.ts` (`runGateCheck`) fires `deps.writeReviewLog` (session-hit path + `applyPermissionGate`'s `writeLog`, the latter with an `unbound-method` disable) and `deps.emitDecision` (session-hit path + final decision).
- `src/permission-events.ts` exports `emitDecisionEvent(events, event)` — a try/catch wrapper over `events.emit(PERMISSIONS_DECISION_CHANNEL, event)` that swallows listener throws.
- `src/session-logger.ts` exposes `SessionLogger.review(event, details?)`; `PermissionSession` exposes it as a public `readonly logger: SessionLogger`.
- `src/permission-resolver.ts` is the precedent from #319: a narrow role module the gates and runner depend on.
  `src/permission-prompter.ts` is the precedent for co-locating a role interface and its implementing class in one module.

Constraint from AGENTS.md / `code-design`: keep the new module a pure role (no Pi SDK imports); when a shared interface references a collaborator, type it as the narrow interface, not the concrete class.
Removing the two inline members from `GateRunnerDeps` breaks every consumer at the type level in one commit — the descriptor, runner, handler, fixture, and runner test must move together (see TDD Order).

## Design Overview

One new role module co-locating the interface and its implementation, mirroring `permission-prompter.ts`:

```typescript
// src/decision-reporter.ts
import {
  emitDecisionEvent,
  type PermissionDecisionEvent,
  type PermissionEventBus,
} from "./permission-events";
import type { SessionLogger } from "./session-logger";

/**
 * Reports a permission gate's outcome to the review log and the decision
 * channel. Groups the two side effects that always travel together.
 */
export interface DecisionReporter {
  writeReviewLog(event: string, details: Record<string, unknown>): void;
  emitDecision(event: PermissionDecisionEvent): void;
}

/**
 * Owns the SessionLogger and the event bus; answers "who owns the event bus"
 * — the reporter does, not the session.
 */
export class GateDecisionReporter implements DecisionReporter {
  constructor(
    private readonly logger: SessionLogger,
    private readonly events: PermissionEventBus,
  ) {}

  writeReviewLog(event: string, details: Record<string, unknown>): void {
    this.logger.review(event, details);
  }

  emitDecision(event: PermissionDecisionEvent): void {
    emitDecisionEvent(this.events, event);
  }
}
```

The handler builds it once in the constructor and exposes it as a `DecisionReporter`:

```typescript
private readonly reporter: DecisionReporter;
constructor(
  private readonly session: PermissionSession,
  private readonly events: PermissionEventBus,
  private readonly toolRegistry: ToolRegistry,
  private readonly customFormatters?: ToolInputFormatterLookup,
) {
  this.reporter = new GateDecisionReporter(session.logger, events);
}
```

`session.logger` is read once at construction to *pass* the logger as a dependency — not invoked two hops deep at gate time, so the gate-time reach-through is gone.

`GateRunnerDeps` carries the reporter as one named role instead of two inline methods:

```typescript
export interface GateRunnerDeps extends PermissionResolver {
  recordSessionApproval(approval: SessionApproval): void;
  reporter: DecisionReporter;
  canConfirm(): boolean;
  promptPermission(
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision>;
}
```

The runner fires through the reporter (`deps.reporter.writeReviewLog(...)`, `deps.reporter.emitDecision(...)`); the one callback hand-off to `applyPermissionGate` becomes a plain closure, dropping the `unbound-method` disable:

```typescript
writeLog: (event, details) => deps.reporter.writeReviewLog(event, details),
```

### Why the bag, not a 5th runner parameter

`runGateCheck(descriptor, agentName, toolCallId, deps)` already separates stable collaborators (`deps`) from per-call "extemporaneous data" (`descriptor`, `agentName`, `toolCallId`).
The reporter is a stable collaborator, so it joins the bag alongside `resolve`, `recordSessionApproval`, `canConfirm`, and `promptPermission` rather than becoming a fifth positional parameter.
This is the deliberate intermediate: that the runner now juggles four stable role collaborators plus three per-call arguments is exactly the signal that it wants to be a class constructed with its roles — which is #323's `GateRunner`, where `reporter` becomes a constructor field (`this.reporter.writeReviewLog`) and `deps` dissolves entirely.

### Design-review notes

- Width: `DecisionReporter` has two methods; both consumers (runner, handler bypass/input) use both.
  No unused surface.
- LoD: the gate-time `this.session.logger.review` reach-through is removed.
  The runner gains a mild `deps.reporter.x()` field-then-call on a parameter bag — transitional; #323 makes `reporter` a direct field of the `GateRunner` class.
  Track and watch, resolved by #323.
- Intermediate abstraction: this extraction groups two cohesive side effects, reducing `GateRunnerDeps`' inline members by 2 (replaced by one field).

### Edge cases

- `DecisionReporter.writeReviewLog` requires `details: Record<string, unknown>` (matching the old `GateRunnerDeps` member); `SessionLogger.review`'s `details` is optional, so the required→optional hand-off is sound.
- `handleInput` adoption is byte-identical: `this.reporter.emitDecision(event)` is exactly `emitDecisionEvent(this.events, event)`, and `(e, d) => this.reporter.writeReviewLog(e, d)` is exactly `this.session.logger.review(e, d)`.
- One reporter instance per handler is correct: `logger` and `events` are constructor deps, stable for the handler's lifetime, and the reporter holds no mutable state.

## Module-Level Changes

- `src/decision-reporter.ts` — **new**: `DecisionReporter` interface + `GateDecisionReporter` class.
- `src/handlers/gates/descriptor.ts` — `GateRunnerDeps`: remove the inline `writeReviewLog` and `emitDecision` members; add `reporter: DecisionReporter`; import the interface type.
- `src/handlers/gates/runner.ts` — fire via `deps.reporter.writeReviewLog(...)` / `deps.reporter.emitDecision(...)` on all four sites; replace `writeLog: deps.writeReviewLog` (with its `unbound-method` disable) with the plain closure `writeLog: (event, details) => deps.reporter.writeReviewLog(event, details)`.
- `src/handlers/permission-gate-handler.ts` — build `this.reporter = new GateDecisionReporter(session.logger, events)` in the constructor; set `reporter: this.reporter` in the bag; remove the `emitDecision`/`writeReviewLog` closures (and their `unbound-method` disable); use `this.reporter` in the bypass branch; route `handleInput` through `this.reporter.emitDecision({...})` and `writeLog: (e, d) => this.reporter.writeReviewLog(e, d)` (removing its `unbound-method` disable); drop the now-unused `emitDecisionEvent` import.
- `test/helpers/gate-fixtures.ts` — `makeRunnerDeps`: replace `writeReviewLog`/`emitDecision` with `reporter: { writeReviewLog: vi.fn(), emitDecision: vi.fn() }` (optionally a `makeReporter()` helper).
- `test/handlers/gates/runner.test.ts` — change the ~13 assertion sites from `deps.writeReviewLog`/`deps.emitDecision` to `deps.reporter.writeReviewLog`/`deps.reporter.emitDecision`.
- `test/decision-reporter.test.ts` — **new**: direct unit tests for `GateDecisionReporter`.
- `docs/architecture/architecture.md` — add `decision-reporter.ts` to the `src/` file tree (after `permission-resolver.ts`); update the `descriptor.ts` tree line (`GateRunnerDeps` carries a `DecisionReporter`, no longer inlines `writeReviewLog`/`emitDecision`); mark the `DecisionReporter` portion of the Phase 3 Track C row (line ~788) and the Step 6 Outcome prose ✅; add a `✅ Extract DecisionReporter (#322)` entry to the numbered improvement steps; update the Track C summary row.
  Extend the gate-runner decomposition chain to name #325 as the capstone everywhere it currently stops at #323 — the row 6 narrative, the Step 6 Outcome prose, the Track C summary, and the `S6` Mermaid node (`… → GateRunner (#323) → PermissionGateHandler role-interface retyping (#325)`) — and add the missing `[#325]` link-reference definition.

No public export is removed or renamed: `GateRunnerDeps` stays exported (member swap only), `emitDecisionEvent`/`SessionLogger.review` remain.
A grep confirms `GateRunnerDeps["writeReviewLog"]` / `["emitDecision"]` are referenced only in `permission-gate-handler.ts`, `descriptor.ts`, `runner.ts`, and `gate-fixtures.ts`; the `writeReviewLog` fields on `PermissionPrompterDeps`, `permission-event-rpc`, the forwarder, and `io.ts` belong to separate interfaces and are out of scope.
No `package-*/SKILL.md` references these members.

`test/handlers/{tool-call,tool-call-events,input,input-events}.test.ts` need **no** changes: they drive the handler through the real event bus (`getDecisionEvents` reads `events.emit` on the `permissions:decision` channel) and the `session.logger.review` mock, both of which the reporter routes through identically.

## Test Impact Analysis

1. New tests enabled — `GateDecisionReporter` is now unit-testable in isolation, which the anonymous handler closures never were: `writeReviewLog` delegates to `logger.review(event, details)`; `emitDecision` delegates to `emitDecisionEvent` (emits `event` on `PERMISSIONS_DECISION_CHANNEL`); a throwing decision listener does not propagate (inherited from `emitDecisionEvent`'s try/catch).
2. Redundant/simplified tests — none become redundant.
   `runner.test.ts` keeps every assertion but reshapes the collaborator handle from two flat mocks to one grouped `reporter` mock that mirrors production structure.
3. Tests that stay as-is — the four handler integration test files (they exercise the full gate/input paths through the real bus + logger mock); `permission-events.test.ts`'s `emitDecisionEvent` tests (the underlying primitive the reporter wraps); every gate descriptor test (unaffected by the runner's collaborator shape).

## TDD Order

1. Add the `DecisionReporter` interface + `GateDecisionReporter` class with `test/decision-reporter.test.ts`.
   Surface: `test/decision-reporter.test.ts`.
   Covers: `writeReviewLog` delegates to `logger.review`; `emitDecision` emits on the decision channel; a throwing listener does not propagate.
   No consumers yet — repo stays green.
   Commit: `feat: add DecisionReporter and GateDecisionReporter`.
2. Wire the reporter into the gate runner in one atomic commit (the interface member removal breaks all consumers at the type level): swap `GateRunnerDeps` members for `reporter: DecisionReporter`; fire via `deps.reporter.*` in `runner.ts` (dropping the `unbound-method` disable); build `this.reporter` in the handler constructor, set `reporter` in the bag, use it in the bypass branch, and remove the handler's `emitDecision`/`writeReviewLog` closures + disable; update `makeRunnerDeps`; reshape `runner.test.ts` assertions to `deps.reporter.*`.
   Surface: `test/handlers/gates/runner.test.ts` (+ existing handler tests stay green).
   Commit: `refactor: report gate decisions through DecisionReporter`.
3. Route `handleInput` through `this.reporter`: replace `emitDecisionEvent(this.events, {...})` with `this.reporter.emitDecision({...})` and `writeLog: this.session.logger.review` with `writeLog: (e, d) => this.reporter.writeReviewLog(e, d)`; remove the remaining `unbound-method` disable and the now-unused `emitDecisionEvent` import.
   Surface: existing `test/handlers/{input,input-events}.test.ts` (behavior-preserving — stay green).
   Commit: `refactor: route handleInput review log and decision events through the reporter`.
4. Update `docs/architecture/architecture.md` (file tree entry, `descriptor.ts` tree line, Phase 3 Track C row + Step 6 Outcome, new `#322` step entry, Track C summary, `S6` Mermaid node) and thread #325 into the decomposition chain (row 6 narrative, Step 6 Outcome, Track C summary, `S6` node) plus add its `[#325]` link reference.
   Commit: `docs: record DecisionReporter extraction and the #325 capstone in the architecture roadmap`.

Steps 1 and 3 are independently green; step 2 is the single mandated atomic commit where the `GateRunnerDeps` member swap ripples to the descriptor, runner, handler, fixture, and runner test together.

## Risks and Mitigations

- Interface member removal ripples to every `GateRunnerDeps` consumer in one commit.
  Mitigation: fold descriptor + runner + handler + `gate-fixtures.ts` + `runner.test.ts` into step 2, exactly as AGENTS.md prescribes for export/member removal.
- Behavior drift in `handleInput` adoption (step 3).
  Mitigation: the reporter methods are byte-identical to the inlined calls; rely on the existing `input`/`input-events` tests staying green, and add no payload changes.
- Mild `deps.reporter.x()` LoD reach introduced in the runner.
  Mitigation: transitional only; #323 dissolves the bag into a `GateRunner` class where `reporter` is a direct field.
  Track and watch.
- `makeRunnerDeps` mock gains one level of nesting (`reporter.writeReviewLog`).
  Mitigation: it mirrors production structure and replaces two flat mocks with one grouped mock; a `makeReporter()` helper keeps call sites tidy.

## Open Questions

- The reporter's final home (a `GateRunner` constructor field) and the deletion of `GateRunnerDeps` are deferred to #323; this plan leaves the reporter inside the bag.
- #325's residual-cluster decomposition (which narrow roles absorb `activate`, `resolveAgentName`, `config`, the infrastructure-path getters, `getActiveSkillEntries`, and `createPermissionRequestId`) is unresolved and out of scope here — this plan only adds the `DecisionReporter` role #325 will consume and names #325 in the roadmap.
- Whether `handleInput` should eventually share more of the runner's decision-building (it currently hand-builds its `PermissionDecisionEvent`) is out of scope — only the emit/log side effects move to the reporter here.
