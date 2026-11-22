---
issue: 556
issue_title: "pi-permission-system: dissolve canConfirm() — the ask path always escalates to the Authorizer"
---

# Dissolve `canConfirm()` — the ask path always escalates to the `Authorizer`

## Release Recommendation

**Release:** ship independently

Phase 9 Step 2 is tagged `Release: independent` in the architecture roadmap (`architecture.md` line 884).
This lands as a `refactor:` (hidden changelog type), so it does not cut a release on its own — it lands on `main` and auto-batches into the next `feat:`/`fix:`/unhidden-`docs:` release.
It is not a member of any release batch, so there is nothing to defer or coordinate at ship time.

## Problem Statement

"Can anyone answer this ask?" is currently a boolean pre-check smeared across five modules.
`GateRunner` asks `GatePrompter.canConfirm()` before prompting; `applyPermissionGate` re-branches on the same boolean to short-circuit `ask` into a block; `deriveResolution` reads it a third time to distinguish `user_denied` from `confirmation_unavailable`; and `AuthorizerSelection` recomputes `hasUI || isSubagent` at `activate` to feed it (`canConfirm` appears 15 times across 5 modules in `src/`).

Phase 9 Step 1 ([#555]) already introduced the `Authorizer` role and its three implementations, including `DenyingAuthorizer` — the least-privilege authority for a session with no reachable authority.
With that in place, "absent authority" is no longer a boolean to smear: it is an `Authorizer` that answers, by denying.
This step dissolves `canConfirm()`: the `ask` path always escalates to the session's selected `Authorizer`, and the `DenyingAuthorizer`'s deny answer carries a marker that drives the `confirmation_unavailable` resolution.

## Goals

- Delete `src/gate-prompter.ts` (the two-method `GatePrompter` role interface).
- `src/permission-gate.ts`: drop the `canConfirm` param; the `ask` branch always awaits `promptForApproval()`.
- `src/handlers/gates/runner.ts`: drop the `this.prompter.canConfirm()` pre-check; the gate role collapses to a single-method escalation seam.
- `src/handlers/gates/helpers.ts`: `deriveResolution` derives `confirmation_unavailable` from a marker on the decision (mirroring the existing `autoApproved` marker) instead of a `canConfirm` boolean.
- `canConfirm` occurrences in `src/` drop 15 → 0.

## Non-Goals

- Rebuilding the serving side (`ForwardedRequestServer`) onto `evaluate()` + a serving `Authorizer` — that is Phase 9 Step 3 ([#557]), a disjoint Track-B step.
- The `ModelTriageAuthorizer` decorator ([#472]) — deferred to a later phase with its own decision record.
- Moving yolo into the ruleset — already landed ([#526], [#527]); untouched here.
- Any change to the cross-extension `permissions:decision` broadcast shape — the `confirmation_unavailable` resolution value is preserved.

## Background

Relevant modules (all in `packages/pi-permission-system/`):

- `src/gate-prompter.ts` — the `GatePrompter` interface: `canConfirm(): boolean` + `prompt(details): Promise<PermissionPromptDecision>`.
  `GateRunner` depends on it; `AuthorizerSelection` implements it.
- `src/authority/authorizer-selection.ts` — `AuthorizerSelection` (the Step 1 rewrite of `PromptingGateway`): selects the `Authorizer` once per activation via `selectAuthorizer`, and today also recomputes `this.confirmable = ctx.hasUI || detection.isSubagent(ctx)` transitionally to keep `canConfirm()` byte-identical until this step.
- `src/authority/authorizer.ts` — `selectAuthorizer(ctx, deps)`: `hasUI` → `LocalUserAuthorizer`; `isSubagent` → `ParentAuthorizer`; else → `DenyingAuthorizer`.
- `src/authority/denying-authorizer.ts` — `DenyingAuthorizer.authorize()` returns `{ approved: false, state: "denied" }`.
- `src/authority/permission-prompter.ts` — `PermissionPrompter.prompt(authorizer, details)`: brackets the ask with `permission_request.waiting` → `authorizer.authorize(details)` → `permission_request.approved`/`denied`.
- `src/permission-gate.ts` — `applyPermissionGate(params)`: pure deny/ask/allow decision function; today the `ask` branch short-circuits to a block when `!canConfirm`.
- `src/handlers/gates/runner.ts` — `GateRunner.runDescriptor`: computes `canConfirm`, builds messages, calls `applyPermissionGate`, emits the decision event.
- `src/handlers/gates/helpers.ts` — `deriveResolution(state, action, hasSession, canConfirm, autoApproved)`.
- `src/permission-dialog.ts` — `PermissionPromptDecision`, which already carries the `autoApproved?: true` marker precedent.

Key fact about when `DenyingAuthorizer` is selected: only when **`!ctx.hasUI` AND `!detection.isSubagent(ctx)`** — a no-UI, non-subagent (headless-root) session.
A subagent with a live parent registration selects `ParentAuthorizer` (authority is reachable up the tree), and a UI session selects `LocalUserAuthorizer`.
So `DenyingAuthorizer` is the genuinely-unreachable case: an automated/CI/hook-driven `pi` run with no interactive UI and no parent to escalate to, where an `ask` has no one to answer it — least privilege denies it.
Today this path is **unreachable at runtime** because `canConfirm()` (= `false` here) short-circuits before the prompt; this step makes it reachable.

Constraint from AGENTS.md / the package skill: `docs/architecture/architecture.md` names internal symbols in narrative prose and a module tree, and `.pi/skills/package-pi-permission-system/SKILL.md` documents the test fixtures by their interface types — both must be updated when `GatePrompter` is removed.
The package convention is to mark the completed roadmap step (`✅` on the heading and the Mermaid node) in the implementation doc-update commit, not a deferred ship commit.

## Design Overview

### Decision: uniform escalation (no special-casing)

The `ask` path becomes uniform: it always escalates to the selected `Authorizer` through `PermissionPrompter`, with no pre-check and no bypass branch.
The `DenyingAuthorizer` flows through `PermissionPrompter` exactly like `LocalUserAuthorizer` and `ParentAuthorizer` — `PermissionPrompter` is **not** changed to special-case it.
This is the purest expression of the target model ("every `Authorizer` answers; the `DenyingAuthorizer` by denying") and dissolves `canConfirm` to zero occurrences with zero replacement predicates.

Consequence for the review log (accepted — see the Decide gate below): the unavailable path is no longer recorded as a single `permission_request.blocked` / `confirmation_unavailable` entry.
It is now recorded as `permission_request.waiting` + `permission_request.denied`, identical in shape to a user denial — except the `denied` entry's `resolution` is preserved as `confirmation_unavailable` (see "Preserve the signal" below).
The standalone gate-written `blocked` / `confirmation_unavailable` review entry is removed; the gate still writes `blocked` / `policy_denied` for the `deny` **state** (unchanged).

The cross-extension `permissions:decision` broadcast is unchanged: it still emits `resolution: "confirmation_unavailable"` for this path, derived from the marker.

### The marker

`PermissionPromptDecision` gains a `confirmationUnavailable?: true` marker, mirroring the existing `autoApproved?: true`:

```typescript
export type PermissionPromptDecision = {
  approved: boolean;
  state: PermissionDecisionState;
  denialReason?: string;
  /** True when yolo mode auto-approved this decision (consumed by deriveResolution). */
  autoApproved?: true;
  /**
   * True when no live authority was reachable and the DenyingAuthorizer denied
   * this ask. Consumed by deriveResolution (decision event) and by the gate
   * (block reason) and PermissionPrompter (review-entry resolution).
   */
  confirmationUnavailable?: true;
};
```

`DenyingAuthorizer.authorize()` sets it:

```typescript
authorize(): Promise<PermissionPromptDecision> {
  return Promise.resolve({
    approved: false,
    state: "denied",
    confirmationUnavailable: true,
  });
}
```

### Preserve the signal in the review entry

`PermissionPrompter.prompt` writes the outcome entry with `resolution: decision.state` today.
Change the denied branch to surface the marker so the "nobody could answer" diagnostic survives in the review log, not just the decision event:

```typescript
this.writeReviewEntry(decision.approved ? "..." : "permission_request.denied", {
  ...details,
  resolution: decision.confirmationUnavailable
    ? "confirmation_unavailable"
    : decision.state,
  denialReason: decision.denialReason,
});
```

A normal denial (no marker) is unchanged (`resolution: decision.state`).

### The gate role collapses to a single-method escalation seam

Deleting `GatePrompter` removes the two-method interface `GateRunner` held.
The gate no longer needs `canConfirm()`; it needs only to escalate an ask and receive a decision.
Introduce a single-method role interface, co-located with its implementer in `authorizer-selection.ts` (parallel to the existing `AuthorizerSelectionLifecycle`):

```typescript
/** The ask-escalation seam GateRunner depends on: escalate to the session's Authorizer. */
export interface AskEscalator {
  escalate(details: PromptPermissionDetails): Promise<PermissionPromptDecision>;
}
```

`AuthorizerSelection` implements it (renaming its public `prompt(details)` → `escalate(details)`; the internal delegation to `PermissionPrompter.prompt(authorizer, details)` keeps its name, which now reads as `escalate()` calling `prompt()` — clear disambiguation).
It drops `implements GatePrompter`, the `canConfirm()` method, the `confirmable` field, and the `this.confirmable = …` computation in `activate`/`deactivate`.
`selectAuthorizer` already encodes the liveness decision in *which* authorizer it returns, so no separate predicate remains.

`GateRunner`'s consumer call site (Tell-Don't-Ask, single method — no reach-through):

```typescript
// runner.runDescriptor — no canConfirm pre-check; always escalate.
let confirmationUnavailable = false;
const gateResult = await applyPermissionGate({
  state: check.state,
  sessionApproval: descriptor.sessionApproval?.toGateApproval(),
  promptForApproval: async () => {
    const decision = await this.prompter.escalate({
      requestId: toolCallId,
      ...descriptor.promptDetails,
    });
    autoApproved = decision.autoApproved === true;
    confirmationUnavailable = decision.confirmationUnavailable === true;
    return decision;
  },
  writeLog: (event, details) => this.reporter.writeReviewLog(event, details),
  logContext: { ...descriptor.logContext, agentName },
  messages,
});
// … emitDecision(… deriveResolution(check.state, gateResult.action,
//                     hasSessionApproval, confirmationUnavailable, autoApproved))
```

### The gate: always prompt; block reason keyed off the marker

`applyPermissionGate` drops the `canConfirm` param and the `!canConfirm` short-circuit.
The `ask` branch always prompts; on a denial it picks the block reason from the marker:

```typescript
if (state === "ask") {
  const decision = await promptForApproval();
  if (!decision.approved) {
    return {
      action: "block",
      reason: decision.confirmationUnavailable
        ? messages.unavailableReason
        : messages.userDeniedReason(decision),
    };
  }
  if (decision.state === "approved_for_session" && params.sessionApproval) {
    return { action: "allow", sessionApproval: params.sessionApproval };
  }
}
```

`writeLog` and `messages` (all three reasons: `denyReason`, `unavailableReason`, `userDeniedReason`) are still needed — `writeLog` for the `deny`-state `blocked` / `policy_denied` entry, `messages.unavailableReason` for the marker-driven block reason.

### `deriveResolution`: marker replaces `canConfirm`

```typescript
export function deriveResolution(
  state: "allow" | "deny" | "ask",
  action: "allow" | "block",
  hasSession: boolean,
  confirmationUnavailable: boolean,
  autoApproved = false,
): PermissionDecisionResolution {
  if (state === "allow") return autoApproved ? "auto_approved" : "policy_allow";
  if (state === "deny") return "policy_deny";
  // state === "ask"
  if (action === "allow") {
    if (autoApproved) return "auto_approved";
    return hasSession ? "user_approved_for_session" : "user_approved";
  }
  return confirmationUnavailable ? "confirmation_unavailable" : "user_denied";
}
```

Only the 4th parameter's meaning flips (`canConfirm` → `confirmationUnavailable`) and the final ternary inverts; the positional shape is otherwise unchanged, so the runner call site updates in place.

## Module-Level Changes

### `src/` (all in Step 2 unless noted)

- `src/permission-dialog.ts` — **Step 1**: add `confirmationUnavailable?: true` to `PermissionPromptDecision`.
- `src/authority/denying-authorizer.ts` — **Step 1**: return `{ approved: false, state: "denied", confirmationUnavailable: true }`; update the class doc comment.
- `src/authority/permission-prompter.ts` — **Step 1**: denied-entry `resolution` surfaces the marker.
- `src/gate-prompter.ts` — **DELETE**.
- `src/authority/authorizer-selection.ts` — introduce `AskEscalator`; `AuthorizerSelection implements AskEscalator, AuthorizerSelectionLifecycle`; remove `canConfirm()`, the `confirmable` field, and its `activate`/`deactivate` assignments; rename `prompt` → `escalate`; drop the `GatePrompter` import; update the class/method doc comments.
- `src/handlers/gates/runner.ts` — remove the `const canConfirm = this.prompter.canConfirm()` line; change the `prompter` field type `GatePrompter` → `AskEscalator`; call `this.prompter.escalate(...)`; capture `confirmationUnavailable` in the `promptForApproval` closure; drop `canConfirm` from the `applyPermissionGate` call; pass `confirmationUnavailable` to `deriveResolution`; update the `GatePrompter` import to `AskEscalator`.
- `src/permission-gate.ts` — remove `canConfirm` from `PermissionGateParams`; rewrite the `ask` branch (always prompt; block reason via the marker); remove the `!canConfirm` block-and-log arm; update the `promptForApproval` doc comment (drop "and canConfirm is true").
- `src/handlers/gates/helpers.ts` — `deriveResolution`: 4th param `canConfirm` → `confirmationUnavailable`; invert the final ternary; update the JSDoc `@param`.

`index.ts` is **unchanged**: it constructs `AuthorizerSelection` and passes it to `GateRunner` by value; `AuthorizerSelection` still satisfies the (now single-method) role, so only the static type flows differently.
`permission-session.ts` is **unchanged**: it depends on `AuthorizerSelectionLifecycle` (activate/deactivate), not `GatePrompter`.

Grep confirmation (no other `GatePrompter`/`canConfirm` consumers in `src/`): the only `src/` importers of `GatePrompter` are `authorizer-selection.ts` and `runner.ts`; the only `canConfirm` `src/` sites are `authorizer-selection.ts`, `gate-prompter.ts`, `permission-gate.ts`, `runner.ts`, `helpers.ts` — all listed above.

### Docs (Step 3 — same commit that marks the roadmap step complete)

- `docs/architecture/architecture.md`:
  - Module tree (line ~739): remove the `gate-prompter.ts` entry.
  - `runner.ts` tree entry (line ~766): `GatePrompter (AuthorizerSelection, #555)` → `AskEscalator (AuthorizerSelection)`.
  - `authorizer-selection.ts` tree entry (line ~824): "context-owning `GatePrompter` implementation … delegates `prompt(details)`" → `AskEscalator` / `escalate(details)`.
  - Target-model narrative (lines ~497, ~554, ~580): note `canConfirm()` is now dissolved (was "survives as a transitional predicate").
  - Roadmap Step 2 (lines ~882–886): `✅` on the heading; correct the **Outcome** line — the unavailable path is now `waiting` + `denied` (`resolution: confirmation_unavailable`), the standalone `blocked` entry is removed, and the decision event keeps `confirmation_unavailable` — **not** "byte-identical to today" (design decision: uniform escalation over log-shape preservation).
  - Mermaid node `S2` (line ~919): `✅ Step 2 (#556)`.
  - Leave the phase-exit metrics table (lines ~859–860) as-is — it is a target table (Phase-8-exit vs Phase-9-target), not a running tally, and Phase 9 is not complete (Steps 3, 4 remain), matching the #555 precedent.
- `docs/architecture/permission-prompter.md` (lines ~73–74): `authorizerSelection implements GatePrompter … canConfirm()/prompt(details) role` → implements `AskEscalator`; `GateRunner` calls `this.prompter.escalate(details)`; note step 2's `DenyingAuthorizer` is now reachable and denies with the `confirmationUnavailable` marker (and that the denied review entry surfaces `resolution: confirmation_unavailable`).
- `.pi/skills/package-pi-permission-system/SKILL.md` (line ~145): the `handler-fixtures.ts` description `prompter: GatePrompter` → `prompter: AskEscalator`.

Historical records (`docs/plans/*`, `docs/retro/*`, `docs/architecture/history/*`) are not edited — they are point-in-time records.

## Test Impact Analysis

New unit tests enabled:

1. `DenyingAuthorizer` returns the `confirmationUnavailable` marker (`test/authority/denying-authorizer.test.ts`).
2. `PermissionPrompter` surfaces the marker as `resolution: confirmation_unavailable` in the denied entry while leaving a plain denial as `resolution: denied` (`test/authority/permission-prompter.test.ts`).
3. Uniform escalation is now reachable end-to-end: a `DenyingAuthorizer`-style decision drives `waiting` + `denied` review entries, a `confirmation_unavailable` decision event, and an `unavailable`-reason block — asserted via the runner and external-directory integration suites through a marker-returning `escalate` stub.

Redundant / simplified tests:

- `test/authority/authorizer-selection.test.ts` — the entire `describe("canConfirm", …)` block (lines ~88–126, ~199–209) is removed (the method is gone); update the file header comment.
- `test/permission-gate.test.ts` — the `ask branch — unavailable` cases keyed on `canConfirm: false` are rewritten to drive the unavailable outcome from a `confirmationUnavailable` decision returned by `promptForApproval`; the "does not call promptForApproval when canConfirm is false" assertion is deleted (the `ask` branch now always prompts).
- `test/handlers/gates/helpers.test.ts` — the two `deriveResolution` ask+block cases swap the 4th arg semantics (`canConfirm` → `confirmationUnavailable`) and update the test names.

Tests that must stay (genuinely exercise the preserved layer):

- `test/authority/permission-prompter.test.ts` waiting-before-outcome ordering — the bracketing is **not** reordered; this invariant must stay green.
- `test/handlers/gates/runner.test.ts` and `test/handlers/external-directory-integration.test.ts` `confirmation_unavailable` decision-event assertions — still valid, now marker-driven.
- The yolo `auto_approved` single-entry path ([#526]) — untouched; must stay green.

## Invariants at Risk

This step touches the ask-path bracketing and the `DenyingAuthorizer`, both refactored in [#555].
[#555]'s documented invariants and their pinning tests:

- **Review-log bracketing order** (`waiting` before the authorizer is consulted) — pinned by `test/authority/permission-prompter.test.ts` ("logs permission_request.waiting before the outcome").
  Preserved: `PermissionPrompter.prompt` is not reordered.
- **`DenyingAuthorizer`/`ParentAuthorizer` do not emit the UI-prompt event** — pinned by the Step 1 "does-not-emit" assertions.
  Preserved: the marker addition adds no UI event; `DenyingAuthorizer.authorize` still only denies.
- **yolo emits a single `auto_approved` entry** ([#526]) — pinned in the runner yolo fast-path tests.
  Preserved: the yolo fast-path is upstream of the gate and untouched.
- **`confirmation_unavailable` decision-event resolution still emitted** — pinned by `test/handlers/gates/runner.test.ts` and the external-directory integration suite; re-pointed at the marker in Step 2.

The one **deliberate** change to a prior outcome: [#555]/the roadmap described the unavailable path as a single `blocked` / `confirmation_unavailable` review entry.
Uniform escalation changes it to `waiting` + `denied` (`resolution: confirmation_unavailable`).
This is an intentional design decision (recorded in the Decide gate), and the architecture roadmap's Step 2 **Outcome** line is corrected to match in Step 3 — so a later reader does not treat the old "byte-identical" wording as a regressed invariant.

## TDD Order

1. **Add the `confirmationUnavailable` marker (preparatory, additive).**
   Red→green across three unit surfaces: `PermissionPromptDecision` gains the field; `DenyingAuthorizer.authorize` returns it; `PermissionPrompter`'s denied entry surfaces `resolution: confirmation_unavailable` when the marker is set (and `denied` otherwise).
   Nothing else breaks — the field is new and the `DenyingAuthorizer` path is still unreachable in production (this is the tidy-first "make the change that makes the change easy").
   Tests: `test/authority/denying-authorizer.test.ts`, `test/authority/permission-prompter.test.ts`.
   Commit: `refactor(pi-permission-system): mark DenyingAuthorizer decisions confirmation-unavailable`.

2. **Dissolve `canConfirm()` — atomic (interface removal + all consumers + all tests).**
   Deleting `GatePrompter`, removing `canConfirm` from `PermissionGateParams`, and changing `deriveResolution`'s signature each break `runner.ts` and its tests at the type level simultaneously, so they land together (per the testing-skill export-removal rule).
   - `src/`: delete `gate-prompter.ts`; add `AskEscalator` + rework `authorizer-selection.ts`; rewire `runner.ts`, `permission-gate.ts`, `helpers.ts` as in Module-Level Changes.
   - Migrate every test/fixture off the two-method `{ canConfirm, prompt }` mock: `test/helpers/gate-fixtures.ts` (drop the `canConfirm` option; single-method `{ escalate }` role; retype `GatePrompter["prompt"]` → `AskEscalator["escalate"]`), `test/helpers/handler-fixtures.ts` (`prompter: AskEscalator`; default stub is `{ escalate }`), `test/helpers/external-directory-fixtures.ts` (the "unavailable" prompter returns a `confirmationUnavailable` decision from `escalate` rather than `canConfirm: false`), and the per-file `vi.fn<GatePrompter["prompt"]>()` sites in `test/handlers/{input,input-events,tool-call,tool-call-events}.test.ts` → `AskEscalator["escalate"]`.
   - Update `test/permission-gate.test.ts`, `test/handlers/gates/helpers.test.ts`, `test/authority/authorizer-selection.test.ts` per Test Impact Analysis.
   - The `GatePrompter["prompt"]` → `AskEscalator["escalate"]` retype and the `prompt:` → `escalate:` mock-key rename are single-line per-symbol edits (safe to script per AGENTS.md; no multi-line regex).
   Run `pnpm run check` immediately after this commit (shared-interface + export removal).
   Commit: `refactor(pi-permission-system): dissolve canConfirm; the ask path always escalates`.

3. **Docs + roadmap completion.**
   Update `architecture.md` (tree, narrative, Step 2 `✅` heading + Mermaid node, corrected Outcome line), `permission-prompter.md`, and the package SKILL fixture note per Module-Level Changes.
   Commit: `docs(pi-permission-system): mark Phase 9 Step 2 complete; dissolve canConfirm`.

## Risks and Mitigations

- **Review-log output changes for the unavailable path.**
  Accepted at the Decide gate (operator prioritized a coherent codebase over log-shape stability).
  Mitigation: the `confirmation_unavailable` resolution is preserved in both the decision event and the review-log `denied` entry, so the diagnostic signal survives; the Step 3 doc correction records the change so it is not later mistaken for a regression.
- **Large atomic Step 2 (interface deletion fans out to ~10 test files).**
  Mitigation: Step 1 shrinks it by pre-landing the marker; the fan-out edits are mechanical single-token retypes; `pnpm run check` runs immediately after the commit; the full suite runs before the docs commit.
- **A hidden third consumer of `GatePrompter`/`canConfirm`.**
  Mitigation: the grep in Module-Level Changes enumerates every `src/` importer and every `canConfirm` `src/` site; `tsc` will reject any missed consumer after `gate-prompter.ts` is deleted.

## Open Questions

None — the two design forks (uniform escalation vs. bracketing-bypass; preserve vs. collapse the review-log signal) were resolved at the Decide gate: **uniform escalation + preserve the signal in the review entry.**
No follow-up issues are filed; the deferred work ([#557] Step 3, [#472] `ModelTriageAuthorizer`) already has tracking issues.

[#472]: https://github.com/gotgenes/pi-packages/issues/472
[#526]: https://github.com/gotgenes/pi-packages/issues/526
[#527]: https://github.com/gotgenes/pi-packages/issues/527
[#555]: https://github.com/gotgenes/pi-packages/issues/555
[#557]: https://github.com/gotgenes/pi-packages/issues/557
