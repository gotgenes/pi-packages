---
issue: 326
issue_title: "Unify handleInput's skill-input gate with the GateRunner pipeline"
---

# Unify `handleInput`'s skill-input gate with the `GateRunner` pipeline

## Problem Statement

`PermissionGateHandler.handleInput` gates `/skill:<name>` invocations by hand-rolling the same `check → log → emit → approve` cycle that `GateRunner.runDescriptor` already owns.
It calls `checkPermission` directly, builds its own `applyPermissionGate(...)`, emits its own `permissions:decision` event, and computes the decision `resolution` with a nested, eslint-disabled ternary that re-implements `deriveResolution()`.
This is the worst-CRAP function in the file (79.4, after `handleToolCall` was decomposed in #285) and it reaches straight into `emitDecision` / `writeReviewLog` / `prompt` / `canPrompt` — the very channels that #322 (`DecisionReporter`) and #323 (`GatePrompter`) gave owners.

The duplication is also a maintenance trap: a change to the gate cycle (as in #319's `resolve()` routing) must be made in two places, and the second is easy to miss.

This is preparatory work for #325: collapsing `handleInput` onto the shared runner removes a large part of the handler's dependency on the concrete `PermissionSession`, so the eventual role-interface retyping becomes a small change ("make the change easy, then make the easy change").

## Goals

- Express the skill-input gate as a `GateDescriptor` produced by a pure `describeSkillInputGate(...)` factory and run it through the existing `GateRunner`.
- Delete the inline `applyPermissionGate` block, the nested resolution ternary, and the direct `emitDecision` / `writeReviewLog` / `prompt` / `canPrompt` calls in `handleInput`.
- Preserve the observable decision-event behavior (surface/value/result/resolution) and the deny-time UI warning exactly.
- Make the skill-input gate logic unit-testable in isolation (it is currently reachable only through `handleInput`).

## Non-Goals

- Retyping the `PermissionGateHandler` constructor against role interfaces or dropping the `as unknown as PermissionSession` casts — that is #325.
  This plan keeps the concrete-class constructor and the existing mocks.
- Extracting the tool-call gate pipeline or tightening the `PermissionSession` API (`getToolPreviewLimits`, `getInfrastructureReadDirs`) — that is #327.
- Changing whether skill-input honors session rules.
  `handleInput` resolves via `checkPermission` (no session ruleset); this plan preserves that exactly via `preCheck` (see Open Questions).
- Touching `handleToolCall`.

## Background

Relevant existing modules:

- `src/handlers/permission-gate-handler.ts` — `handleInput` (the code being refactored) and `handleToolCall` (already runs its gates through `this.runner`).
  The constructor already builds `this.runner = new GateRunner(session, session, session, this.reporter)` and `this.reporter = new GateDecisionReporter(session.logger, events)`, so `handleInput` can reuse both with no constructor change.
- `src/handlers/gates/runner.ts` — `GateRunner.run(gate, agentName, toolCallId)` → `runDescriptor`.
  For a `GateDescriptor` with `preCheck` set, it uses that check directly (no `resolver.resolve`), runs `applyPermissionGate`, emits the decision via the reporter, and records session approval only when the descriptor carries a `sessionApproval`.
- `src/handlers/gates/descriptor.ts` — `GateDescriptor` shape (`surface`, `input`, `denialContext`, `promptDetails` (runner adds `requestId`), `logContext`, `decision`, optional `preCheck` / `preResolved` / `sessionApproval`).
- `src/handlers/gates/skill-read.ts` — `describeSkillReadGate`, the sibling factory this one mirrors (it uses `preResolved`; this one uses `preCheck`).
- `src/handlers/gates/helpers.ts` — `deriveResolution(state, action, hasSession, canConfirm, autoApproved)` produces exactly the resolutions `handleInput`'s ternary computes for the no-session case.
- `src/denial-messages.ts` — `DenialContext` discriminated union + three exhaustive body builders (`buildDenyBody` / `buildUnavailableBody` / `buildUserDeniedBody`).
  Adding a `skill_input` variant forces a case in each (TypeScript exhaustiveness — a feature, not a chore).
- `src/permission-prompter.ts` — `PromptPermissionDetails`; `toolCallId` / `toolName` / `skillName` are optional, so the skill-input descriptor's `promptDetails` (`source` / `agentName` / `message` / `skillName`) typechecks.

AGENTS / skill constraints that apply:

- The skill-input deny/unavailable/user-denied **messages will change** (see Design Overview) — a deliberate, behavior-affecting decision, documented in the issue.
  Per the testing skill's TDD rules, any test asserting the old strings must update in the same step as the change.
- `@typescript-eslint/require-await`: `handleInput` keeps an `await this.runner.run(...)`, so it stays `async`.
- There is no `src/handlers/gates/index.ts` barrel; sibling gate factories are imported directly, so the new factory is imported directly too (no speculative re-export).

## Design Overview

### `describeSkillInputGate` factory

A pure factory mirroring `describeSkillReadGate`, but keyed off a caller-supplied raw `preCheck` rather than a skill-entry match:

```typescript
export function describeSkillInputGate(
  skillName: string,
  agentName: string | null,
  preCheck: PermissionCheckResult,
): GateDescriptor {
  const message = formatSkillAskPrompt(skillName, agentName ?? undefined);
  return {
    surface: "skill",
    input: { name: skillName },
    preCheck,
    denialContext: { kind: "skill_input", skillName, agentName: agentName ?? undefined },
    promptDetails: { source: "skill_input", agentName, message, skillName },
    logContext: { source: "skill_input", skillName, agentName, message },
    decision: { surface: "skill", value: skillName },
  };
}
```

It takes only the three values it reads (ISP — no `tcc`, since skill input is not a tool call).

### `handleInput` after the change

```typescript
async handleInput(event: InputPayload, ctx: ExtensionContext): Promise<InputEventResult> {
  this.session.activate(ctx);
  const skillName = extractSkillNameFromInput(event.text);
  if (!skillName) return { action: "continue" };

  const agentName = this.session.resolveAgentName(ctx);
  const check = this.session.checkPermission("skill", { name: skillName }, agentName ?? undefined);

  if (check.state === "deny" && ctx.hasUI) {
    ctx.ui.notify(/* unchanged deny-warning text */, "warning");
  }

  const outcome = await this.runner.run(
    describeSkillInputGate(skillName, agentName, check),
    agentName,
    this.session.createPermissionRequestId("skill-input"),
  );
  return outcome.action === "block" ? { action: "handled" } : { action: "continue" };
}
```

The runner now owns the prompt (`prompter.promptPermission`), the review-log writes, the decision-event emission, and the resolution derivation.

### Why the decision events are preserved exactly

The runner builds the event via `buildDecisionEvent({ surface: "skill", value: skillName }, check, agentName, result, deriveResolution(...))`.
For skill input, `preCheck.source` is never `"session"` (the raw `checkPermission` is called without a session ruleset), so the runner's session-hit fast path is unreachable and `descriptor.sessionApproval` is absent (`hasSession` is always `false`).
`deriveResolution` then yields the identical mapping to `handleInput`'s current ternary:

| `check.state` | gate action | extra      | resolution                |
| ------------- | ----------- | ---------- | ------------------------- |
| `allow`       | allow       | —          | `policy_allow`            |
| `deny`        | block       | —          | `policy_deny`             |
| `ask`         | allow       | autoApprove| `auto_approved`           |
| `ask`         | allow       | —          | `user_approved`           |
| `ask`         | block       | canConfirm | `user_denied`             |
| `ask`         | block       | no UI      | `confirmation_unavailable`|

`origin`, `agentName`, and `matchedPattern` flow from the same `check`, so the full event matches.

### Deliberate change: block-reason messages

Today `handleInput` passes ad-hoc, **tag-less** strings to `applyPermissionGate` (`denyReason` = the ask-prompt text; `unavailableReason` = "Skill requires approval, but no interactive UI is available."; `userDeniedReason` = "User denied skill.").
The runner instead formats messages from `descriptor.denialContext` via `formatDenyReason` / `formatUnavailableReason` / `formatUserDeniedReason`, which prepend the `[pi-permission-system]` tag.
A new `skill_input` `DenialContext` kind supplies bodies consistent with the `skill_read` sibling:

```text
deny:        Current agent is not permitted to access skill '<name>'.
unavailable: Accessing skill '<name>' requires approval, but no interactive UI is available.
userDenied:  User denied access to skill '<name>'.[ Reason: …]
```

These block reasons are not surfaced to the user for input handling (`handleInput` returns `{ action: "handled" }` and discards the reason); they appear only in the review log.
No existing input test asserts them.
The change gives skill input the same `[pi-permission-system]` attribution every other surface already carries.

## Module-Level Changes

- `src/denial-messages.ts` — add a `skill_input` variant to `DenialContext` (`{ kind: "skill_input"; skillName: string; agentName?: string }`) and a matching `case "skill_input":` to `buildDenyBody`, `buildUnavailableBody`, and `buildUserDeniedBody`.
  (Grepped: these three switches are the only ones over `DenialContext.kind`.)
- `src/handlers/gates/skill-input.ts` — **new**: `describeSkillInputGate`.
- `src/handlers/permission-gate-handler.ts` — rewrite `handleInput` to build the descriptor and call `this.runner.run(...)`; delete the inline `applyPermissionGate` block, the nested resolution ternary, and the manual `this.reporter.emitDecision(...)`; remove the now-unused `applyPermissionGate` import (used only here) and drop `formatSkillAskPrompt` from the `#src/permission-prompts` import (moves to the factory).
- `test/handlers/gates/skill-input.test.ts` — **new**: unit tests for the factory (descriptor shape, `preCheck` passthrough, message wiring).
- `test/denial-messages.test.ts` — add `skill_input` cases for the three formatters.
- `test/handlers/input.test.ts` — update the "passes agentName in the prompt permission request" test: prompting now flows through `session.promptPermission(details)` (the runner's `GatePrompter`), so assert on `session.promptPermission` (or the captured details) rather than `session.prompt(ctx, …)`; `expect.anything()` no longer matches the (now context-bound) first argument.
- `test/handlers/input-events.test.ts` — expected to pass **unchanged** (resolutions reproduced by the runner); verify, do not edit.

`docs/architecture/architecture.md` already records this as Phase 3 Step 9 (#326); no further doc edit is needed in this issue.

## Test Impact Analysis

1. **New lower-level tests enabled.**
   The skill-input gate logic was reachable only through `handleInput`; extracting `describeSkillInputGate` makes the descriptor independently unit-testable (`skill-input.test.ts`), and the new `skill_input` `DenialContext` gains direct formatter coverage (`denial-messages.test.ts`).
2. **Redundant tests.**
   None are removed.
   `input-events.test.ts` continues to pin the end-to-end resolutions; with the runner now producing them, those assertions also document that the unified path is equivalent.
   The bespoke-ternary branches are no longer separately reachable, but the event-level tests still cover every resolution.
3. **Tests that must stay as-is.**
   `input.test.ts` (activation, skill-name parsing, allow/deny/ask outcomes, deny-warning notify) and `input-events.test.ts` (decision events) genuinely exercise `handleInput`'s contract and remain the behavioral guard for this refactor.
   `runner.test.ts` is untouched.

## TDD Order

1. **Add the `skill_input` denial context.** (red→green)
   - Test surface: `test/denial-messages.test.ts`.
   - Covered: `formatDenyReason` / `formatUnavailableReason` / `formatUserDeniedReason` for a `skill_input` context produce the three tagged bodies above.
   - Implementation: add the union variant + three switch cases.
   - Commit: `feat: add skill_input denial context (#326)`.
2. **Extract `describeSkillInputGate` and route `handleInput` through the runner.** (red→green→refactor)
   - Test surface: `test/handlers/gates/skill-input.test.ts` (new, factory unit tests) + the existing `test/handlers/input.test.ts` / `input-events.test.ts`.
   - Covered: the factory returns the descriptor shape (surface `skill`, `input.name`, `preCheck` passthrough, `skill_input` denial context, `skill_input` prompt/log source, decision value = skill name); `handleInput` produces the same outcomes and decision events through `this.runner.run(...)`.
   - Implementation: add `src/handlers/gates/skill-input.ts`; rewrite `handleInput`; remove the inline gate, ternary, manual emit, and the `applyPermissionGate` / `formatSkillAskPrompt` handler imports; update the one `input.test.ts` prompt assertion to target `promptPermission`.
   - Run `pnpm --filter @gotgenes/pi-permission-system exec vitest run` (full package suite) and `pnpm run check` before committing — the factory must have a `src` consumer in this same commit (no dead-code window).
   - Commit: `refactor: route handleInput skill-input gate through GateRunner (#326)`.

## Risks and Mitigations

- **Decision-event drift.**
  Mitigated by the resolution table above and by `input-events.test.ts` passing unchanged; if any resolution differs, that suite fails immediately.
- **`preCheck` taking the session-hit path.**
  Cannot occur: skill input calls `checkPermission` without a session ruleset, so `source` is never `"session"`.
  Documented so a future change that adds session rules here is flagged.
- **Block-reason message change.**
  Deliberate (gains the `[pi-permission-system]` tag); not asserted by any input test; surfaced only in the review log; called out in the issue and `denial-messages.test.ts`.
- **`expect.anything()` assertion break.**
  Anticipated; the single affected `input.test.ts` case is updated in Step 2.
- **Unused-import lint after the rewrite.**
  `applyPermissionGate` and `formatSkillAskPrompt` become unused in the handler; both are removed in Step 2 (eslint would otherwise fail).

## Open Questions

- **Should skill input honor session rules?**
  `handleInput` uses raw `checkPermission` (no session ruleset) while every `handleToolCall` gate uses `resolve()` (session-rule-aware).
  This plan preserves the raw behavior via `preCheck`.
  Switching to `resolve()` is a separate, deliberate behavior change and is out of scope here; left as a tracked question on #326.
