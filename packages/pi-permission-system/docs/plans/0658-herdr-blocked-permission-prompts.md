---
issue: 658
issue_title: "pi-permission-system: report active permission prompts as blocked to Herdr"
---

# Report permission prompts as blocked to Herdr

## Release Recommendation

**Release:** ship independently

No roadmap step references this issue, and the targeted compatibility fix has no dependency on another pending release.
The behavior lands as a `fix:` commit and should cut a patch release for `@gotgenes/pi-permission-system`.

## Problem Statement

When Herdr's Pi lifecycle integration is active, Herdr treats lifecycle reports as authoritative and does not infer a blocked state from the terminal screen.
`pi-permission-system` currently reports a running agent throughout a user-facing permission prompt, so Herdr neither marks the session blocked nor plays its configured request sound.

## Goals

- Emit Herdr's `herdr:blocked` active event immediately before waiting for a human permission decision.
- Always emit the matching inactive event after approval, denial, cancellation, or a thrown error.
- Cover direct prompts and forwarded subagent prompts rendered in the parent UI session through the same `LocalUserAuthorizer` path.
- Make both lifecycle emissions best-effort so a failing listener cannot alter permission enforcement.
- Preserve behavior when Herdr is not installed.

This change is not breaking.
It adds observational event-bus traffic without changing permission policy, prompt decisions, or existing event payloads.

## Non-Goals

- Do not implement the consumer-neutral prompt correlation contract proposed by [#610].
- Do not add a Herdr dependency, configuration field, or runtime discovery mechanism.
- Do not change `permissions:ui_prompt` or `permissions:decision` payloads.
- Do not report policy decisions that resolve without showing a user-facing prompt as blocked.

## Background

`LocalUserAuthorizer.authorize()` is the single point that emits `permissions:ui_prompt` and invokes the active permission UI.
Forwarded requests that require a human decision are escalated into this same parent-session authorizer with their provenance attached, so bracketing this call covers direct and forwarded dialogs without a second path.

The injected `PermissionEventBus` already provides the required event bus and keeps the integration import-free.
The existing permission-event helpers swallow listener failures because observational integrations must not interfere with the gate; the Herdr compatibility emission needs the same failure boundary.

## Design Overview

Convert `LocalUserAuthorizer.authorize()` to `async` and bracket the awaited `requestPermissionDecision()` call:

```typescript
emitHerdrBlockedEvent(events, true);
try {
  return await requestPermissionDecision(...);
} finally {
  emitHerdrBlockedEvent(events, false);
}
```

A file-private `emitHerdrBlockedEvent(events, active)` helper emits the established payloads:

- active: `{ active: true, label: "Permission Required" }`
- inactive: `{ active: false }`

The helper catches listener errors independently for each emission.
It remains private because `herdr:blocked` is Herdr's compatibility convention rather than a new public API owned by this package.

`permissions:ui_prompt` remains first in the sequence.
The active Herdr event then marks the session blocked immediately before the decision dispatcher is invoked, and `finally` clears it after every settlement path.
Concurrent prompts remain balanced because each authorization emits one active and one inactive event; Herdr's integration already reference-counts these pairs.

## Module-Level Changes

- `packages/pi-permission-system/src/authority/local-user-authorizer.ts` — bracket the human decision wait with best-effort Herdr blocked lifecycle emissions and update the class/dependency documentation.
- `packages/pi-permission-system/test/authority/local-user-authorizer.test.ts` — pin direct and forwarded lifecycle ordering, settlement cleanup, rejection cleanup, and listener-failure isolation.
- `packages/pi-permission-system/README.md` — mention that active permission prompts report blocked state to Herdr.
- `packages/pi-permission-system/docs/cross-extension-api.md` — document the Herdr compatibility convention separately from the package-owned permission broadcast contract.
- `packages/pi-permission-system/docs/architecture/architecture.md` — update the `local-user-authorizer.ts` module-tree entry to describe the blocked-state bracket.

## Test Impact Analysis

1. The existing unit seam around `LocalUserAuthorizer` can directly test lifecycle event order and pending state; no new test infrastructure is required.
2. No existing tests become redundant.
3. Existing normalized direct and forwarded `permissions:ui_prompt` assertions remain unchanged because they pin the single-emission and non-degraded-forwarding invariants.

## Invariants at Risk

- `LocalUserAuthorizer` remains the single `permissions:ui_prompt` emit site.
  The existing direct and forwarded event tests continue to pin this behavior.
- Forwarded prompt provenance remains non-degraded on the parent event bus.
  The existing `forwarded provenance` tests remain unchanged, while a new lifecycle assertion proves the Herdr events use that same bus.
- Listener failures remain observational.
  A new test makes `herdr:blocked` emission throw and verifies the permission decision still resolves.
- The returned decision and thrown error remain unchanged.
  Existing return-value coverage stays, and new rejection coverage checks identity of the propagated error.

## TDD Order

1. Add lifecycle tests for a pending direct prompt, a forwarded prompt, a rejected decision, and throwing Herdr listeners; confirm they fail because no `herdr:blocked` events exist; implement the private best-effort emitter and the `try`/`finally` bracket; run the focused test file, type check, and commit as `fix(pi-permission-system): report permission prompts as Herdr blocked (#658)`.
2. Update the README, cross-extension guide, and architecture module tree; lint the Markdown and commit as `docs(pi-permission-system): document Herdr prompt status integration`.

## Risks and Mitigations

- A listener could throw and interrupt the security decision path.
  The private emitter catches each failure, and a unit test pins that isolation.
- A rejected or cancelled prompt could leave Herdr permanently blocked.
  The inactive emission lives in `finally`, with rejection coverage.
- The parent could remain working for forwarded child prompts.
  Forwarded prompts already share `LocalUserAuthorizer`; an explicit forwarded test pins the same lifecycle events on the parent bus.
- A compatibility event could be mistaken for a package-owned stable permission contract.
  Documentation keeps it separate from the three typed `permissions:*` broadcasts, and the emitter remains private.

## Open Questions

None.
The operator explicitly selected the targeted [#658] integration over the broader [#610] contract and a local-only workaround.

[#610]: https://github.com/gotgenes/pi-packages/issues/610
