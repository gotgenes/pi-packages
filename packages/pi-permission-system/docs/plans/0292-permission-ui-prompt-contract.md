---
issue: 292
issue_title: "Harden the permissions:ui_prompt broadcast contract"
---

# Harden the `permissions:ui_prompt` broadcast contract

## Context

PR #292 (`moekyo:feature/permission-prompt-contract`) adds a new cross-extension broadcast, `permissions:ui_prompt`, that fires immediately before the permission system invokes the active user-facing permission UI.
It supersedes PR #253 (`permissions:prompt`); the final tree on #292 contains no trace of the intermediate channel.
The motivating consumer is a notification extension that must alert the user only when they actually need to return and respond to a permission prompt — a boundary that the existing `permissions:decision` event cannot express, because `permissions:decision` fires after resolution and also fires for auto-resolved paths where no human was ever prompted.

The direction, the event-bus composition pattern, the `ctx.hasUI` emit boundary, the exclusion of auto-resolved paths, and the best-effort emission are all correct and align with our design goals.
This plan hardens the contract before adoption.
Delivery: a working branch based on the #292 head, so moekyo's commits remain at the base and their authorship is preserved in history (see Execution starting point).

## Problem statement

The contract as proposed in #292 has five structural issues, ordered by adoption impact.

1. The 14-field payload is hand-constructed in three emit sites (`permission-prompter.ts` via `buildUiPromptEvent`, `permission-event-rpc.ts` inline, `forwarded-permissions/polling.ts` inline) with subtly different rules.
   A public contract's construction must live in one place or it will drift by source.
2. The payload mirrors the internal review-log entry (`writeReviewEntry` writes the same 14 fields): most are `null` for any given source, and `value` is a derived duplicate of `command ?? path ?? target ?? skillName ?? toolName`.
   Forcing the public contract to mirror the internal audit log is an interface-segregation violation and invites the derived field to drift from its sources.
3. Forwarded subagent prompts emit a degraded payload.
   The child holds the structured metadata (`command`/`path`/`toolName`), but it is dropped at the file-forwarding boundary, so the parent emits with `surface: null`, `command: null`, `value: request.message`.
   A consumer sees rich fields for direct prompts and a near-empty payload for forwarded ones.
4. `protocolVersion` is inconsistent across the broadcast family: `permissions:ready` and `permissions:ui_prompt` carry it, `permissions:decision` does not.
   The deeper issue is that a per-payload version on a fire-and-forget broadcast adds little: the published TypeScript types plus package semver define the contract, and a defensive consumer (field-presence checks) is robust to skew without it.
   Version negotiation is only load-bearing for the request/reply RPC envelope.
5. `confirmPermission` gained an emit side effect and a fifth parameter (`uiPromptEvent`), turning a pure routing function into one that also broadcasts, with `message` duplicated between the `message` param and `uiPromptEvent.message`.

## Goals

- Centralize payload construction behind a single tested builder.
- Model the payload as a lean flat interface with a typed `source` discriminant, carrying only the fields the consumer reads.
- Make forwarded prompts carry the same display fields as direct prompts by persisting `source` + `surface` + `value` in the forwarding request.
- Remove `protocolVersion` from all broadcast payloads (it stays only in the RPC envelope), and make every broadcast emit best-effort.
- Remove the emit side effect from `confirmPermission`.
- Keep README, `docs/cross-extension-api.md`, schema/types, and tests aligned.

## Non-goals

- No behavioral change to `permissions:decision` or `permissions:ready` beyond removing `protocolVersion` from their payloads.
- No change to the RPC channels or the RPC envelope (which keeps `protocolVersion`).
- No new permission surface, policy field, or config key.
- No change to the `/permission-system` command name.
- No change to the forwarding directory layout or poll/timeout constants.

## Decisions

These were settled before planning and are fixed inputs to implementation.

| #   | Decision            | Choice                                                   | Rationale                                                                                                            |
| --- | ------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| D1  | Construction        | Single tested builder module                             | One source of truth for a public contract                                                                            |
| D2  | Payload shape       | Lean flat interface, typed `source` discriminant         | No speculative fields; grow later under the additive stability guarantee                                             |
| D3  | Forwarded prompts   | Must not degrade                                         | Notification parity between direct and forwarded                                                                     |
| D4  | Forwarded modeling  | Preserve original `source` + forwarding context          | A forwarded `tool_call` stays `source: "tool_call"` and gains a `forwarding` field                                   |
| D5  | `protocolVersion`   | Remove from all broadcast payloads; keep in RPC envelope | Types + semver define the broadcast contract; per-payload version is ceremony. Breaking for `ready` — no sacred cows |
| D6  | `confirmPermission` | Remove emit side effect                                  | Restore single responsibility                                                                                        |
| D7  | Emit resilience     | All three broadcasts best-effort                         | A throwing listener must not block permission handling                                                               |

## Design

### Event shape: lean flat payload

The payload carries only what the consumer reads — the notify-now signal, a display pair, and forwarding context.
It is a single flat interface with a typed `source` discriminant; there is no union and no per-source `null` fields.
`source` keeps its narrow set; `forwarded_permission` is not a `source` value, because per D4 the forwarding nature is carried orthogonally by the `forwarding` field.

```typescript
export type PermissionUiPromptSource =
  | "tool_call"
  | "skill_input"
  | "skill_read"
  | "rpc_prompt";

/** Present only when the prompt was forwarded from a non-UI subagent. */
export interface ForwardedPromptContext {
  requesterAgentName: string | null;
  requesterSessionId: string | null;
}

export interface PermissionUiPromptEvent {
  requestId: string;
  source: PermissionUiPromptSource;
  /** Normalized display surface (e.g. "bash", "skill"). */
  surface: string | null;
  /** Normalized display value (command, path, skill name, etc.). */
  value: string | null;
  agentName: string | null;
  message: string;
  forwarding: ForwardedPromptContext | null;
}
```

This is the whole contract.
The `surface`/`value` pair is the deliberate display projection that replaces the redundant `command`/`path`/`target`/`skillName`/`toolName`/`toolCallId`/`toolInputPreview`/`sessionLabel` fields from #292 — none of which the notification use case reads.
The stability guarantee is additive, so any of those can be reintroduced in a later minor when a concrete consumer needs them; shipping them now would be speculative fields the package skill flags as a maintenance trap.
Confirm at step 1 that the projection is sufficient for the notification use case before deleting the extra fields.

### Centralized builder

Add `src/permission-ui-prompt.ts` exporting pure builders that map domain inputs to the lean `PermissionUiPromptEvent`, plus the `surface`/`value` normalization currently inlined as `promptSurface`/`promptValue` in the prompter.

- `buildDirectUiPrompt(details: PromptPermissionDetails): PermissionUiPromptEvent` — covers `tool_call` / `skill_input` / `skill_read`.
- `buildRpcUiPrompt(request): PermissionUiPromptEvent` — the `rpc_prompt` source.
- `buildForwardedUiPrompt(request: ForwardedPermissionRequest): PermissionUiPromptEvent` — reconstructs the original source plus `forwarding` context from the persisted request.

All three set the normalized `surface`/`value`.
The three emit sites call a builder and pass the result to `emitUiPromptEvent`; no site hand-rolls the object.
These builders warrant their own tests (they encode normalization and source mapping), which is why they live in a module rather than as file-local helpers.

### Forwarded round-trip: stop the degradation

The metadata is dropped at exactly one point: `confirmPermission` calls `waitForForwardedPermissionApproval(ctx, message, deps)` with only `message`, and the persisted `ForwardedPermissionRequest` carries only `{ id, createdAt, requesterSessionId, targetSessionId, requesterAgentName, message }`.

Fix in three coordinated edits:

1. Extend `ForwardedPermissionRequest` (in `src/permission-forwarding.ts`) with three optional fields — `source`, `surface`, `value` — alongside the existing `message` and `requesterAgentName`.
   The lean payload needs nothing more to reconstruct a full event on the parent side.
   Keep the fields optional and the reader tolerant of their absence: a parent on a newer version may read a request written by an older child during an upgrade.
   When `source` is absent, default it to `"tool_call"` (the dominant forwarded origin) with `surface`/`value` left `null` — the consumer still gets the notify-now signal, `message`, and `forwarding` context.
2. Thread `source`/`surface`/`value` from the prompter through `confirmPermission` into `waitForForwardedPermissionApproval`, which writes them into the request file.
   Consolidate `message` and these display fields into one cohesive `ForwardedPromptInput` object so the relay through `confirmPermission` is a single parameter, not four (see D6).
3. In `processForwardedPermissionRequests`, build the emitted event with `buildForwardedUiPrompt(request)` so the parent emits the original `source`, the `surface`/`value` pair, and a populated `forwarding` context — instead of the degraded inline payload.

### `confirmPermission`: remove the side effect

Restore `confirmPermission` to routing only.

- The direct UI-prompt emit moves to `PermissionPrompter.prompt`, gated on `ctx.hasUI` (the same condition `confirmPermission` branches on), using `buildDirectUiPrompt`.
  When `ctx.hasUI` is false the prompter does not emit; the parent emits later from the forwarded path.
- `confirmPermission` no longer takes `uiPromptEvent` and no longer emits.
  It takes the consolidated `ForwardedPromptInput` (message + `source`/`surface`/`value`) so the forwarded branch can persist it; the UI branch ignores the display fields.
- The RPC handler keeps emitting directly via `buildRpcUiPrompt` (it never routed through `confirmPermission`).

This removes the duplicated `message`, drops the fifth positional parameter, and keeps each emit at its correct boundary: prompter for direct UI, RPC handler for RPC, `processForwardedPermissionRequests` for forwarded.

### `protocolVersion`: remove from broadcasts, keep in the RPC envelope

Remove `protocolVersion` from `PermissionUiPromptEvent` (unreleased) and from `PermissionsReadyEvent` (shipped), and do not add it to `PermissionDecisionEvent`.
Drop it from `emitReadyEvent`'s payload accordingly.
Keep `PERMISSIONS_PROTOCOL_VERSION` exported and keep it in the RPC reply envelope (`PermissionsRpcReply`), where per-call request/reply negotiation is genuinely load-bearing.

Rationale: a per-payload version on a fire-and-forget broadcast is ceremony.
The broadcast contract is defined by the package's published TypeScript types plus semver — a breaking change to any payload is a major version bump.
The one gap is that the publisher and a consumer are independently-versioned sibling extensions, so the consumer cannot observe the publisher's installed version at runtime (type-only imports do not constrain a separately-installed sibling; jiti isolates the modules).
But a runtime version number is the weaker fix for that gap: a defensive consumer that checks field presence is robust to *any* shape skew, not just version-numbered breaks, and needs no version field.
Version negotiation stays where it earns its keep — the request/reply RPC envelope.

Removing `protocolVersion` from `PermissionsReadyEvent` is a breaking change to a released payload, so this lands as a major version bump (see Backwards compatibility).
No sacred cows: `ready` is almost certainly unused as a version source today, and grandfathering it would leave a permanently inconsistent family.

Document for consumers in `docs/cross-extension-api.md`: rely on package semver for the contract, and read defensively rather than version-gating.

```typescript
pi.events.on("permissions:ui_prompt", (raw) => {
  const event = raw as PermissionUiPromptEvent;
  if (typeof event.value !== "string" && typeof event.message !== "string") return;
  notify(event.surface, event.value, event.message);
});
```

### Documentation and exports

- `src/service.ts` already re-exports the prompt types; update them to the lean `PermissionUiPromptEvent`, `PermissionUiPromptSource`, and `ForwardedPromptContext`, and drop the removed variant/field type exports.
- `docs/cross-extension-api.md`: replace the 14-row field table with the lean field table, document `surface`/`value` as the display projection and the `forwarding` field, note that broadcast payloads no longer carry `protocolVersion` (it lives in the RPC envelope), and show the defensive-read consumer pattern above.
  Update the channel reference and any `PermissionsReadyEvent` description that mentions `protocolVersion`.
- `README.md`: keep the one-line feature bullet; ensure wording matches "active user-facing UI prompt".
- `CHANGELOG.md` is owned by release-please — do not edit.

## Execution starting point

This plan is not greenfield: its steps transform the code #292 already added, rather than building from `main`.
Running it from `main` would be incoherent — the 14-field type, the `uiPromptEvent` parameter, and the inline emit sites the steps reshape exist only on the PR branch.

The baseline is therefore already set up on the branch `feat/permission-ui-prompt-contract`:

- Created from the #292 head (`moekyo:feature/permission-prompt-contract`, locally `pr-292`) and rebased onto current `main`.
- The rebase was clean (the only `main` change to this package beyond #292's base was an excluded retro doc).
- moekyo's two commits sit at the base, so their authorship survives in history; our commits land on top.

For each step below, the "before" state is #292's version of the file, not `main`'s.
After implementation, review the net contract delta against `main`:

```bash
git diff main...HEAD -- packages/pi-permission-system
```

Delivery is this branch as its own PR, superseding #292 — no comment exchange required.
Merge with **rebase**, not squash, so each commit's author is preserved on `main`: koxx12-dev (the original `permissions:prompt` commit) and moekyo (the hardening commit) at the base, our commits on top.
The breaking change rides on the step-3 commit's `feat!:` / `BREAKING CHANGE:` footer, which release-please reads off `main` to cut the major — no squash commit or co-author trailers needed.
Close #292 as superseded at ship time.

## Implementation steps

Each step is a TDD unit: write or extend the test first, then the code, then run the package check.

1. Confirm the lean payload shape against this plan, then collapse the 14-field type in `src/permission-events.ts` to the lean `PermissionUiPromptEvent` + `PermissionUiPromptSource` + `ForwardedPromptContext`; update the re-exports in `src/service.ts`.
   Test: type-level and constant tests in `test/permission-events.test.ts`.
2. Add `src/permission-ui-prompt.ts` with `buildDirectUiPrompt`, `buildRpcUiPrompt`, `buildForwardedUiPrompt`, plus the `surface`/`value` normalization.
   Test: new `test/permission-ui-prompt.test.ts` covering each source, the normalized projection, and the `forwarding` field.
3. Remove `protocolVersion` from `PermissionUiPromptEvent` and `PermissionsReadyEvent` (and `emitReadyEvent`'s payload); leave the RPC envelope untouched.
   `PermissionsReadyEvent` becomes empty — alias it to `Record<string, never>` (or drop the payload arg and emit `{}`) to avoid the empty-interface lint rule, and have `emitReadyEvent` emit `{}`.
   Mark the commit breaking (`feat!:` / `BREAKING CHANGE:` footer) so release-please cuts a major.
   Test: update `test/permission-events.test.ts` ready-event and constant assertions; confirm RPC envelope tests still assert `protocolVersion`.
4. Refactor `PermissionPrompter.prompt` to emit directly via `buildDirectUiPrompt` gated on `ctx.hasUI`; stop building/passing `uiPromptEvent`.
   Test: `test/permission-prompter.test.ts` — emits on UI, does not emit on non-UI.
5. Extend `ForwardedPermissionRequest` with `source`/`surface`/`value` and consolidate `confirmPermission` / `waitForForwardedPermissionApproval` onto a single `ForwardedPromptInput`; persist the display fields; remove the emit from `confirmPermission`.
   Test: `test/permission-forwarding.test.ts` — request file carries `source`/`surface`/`value`; tolerant read defaults `source` to `"tool_call"` when absent.
6. Rebuild the parent emit in `processForwardedPermissionRequests` via `buildForwardedUiPrompt`.
   Test: forwarded round-trip emits a non-degraded payload with original source + `forwarding` context (use the fire-without-await + poll-`requests/` pattern from the package skill).
7. Update RPC handler to use `buildRpcUiPrompt`.
   Test: `test/permission-event-rpc.test.ts` — payload has `source: "rpc_prompt"` and the lean fields.
8. Update `docs/cross-extension-api.md` and `README.md`.
   Verify the channel table, the lean field table, and the defensive-read example; run `pnpm --filter @gotgenes/pi-permission-system run lint:md`.
9. Full verification: `pnpm --filter @gotgenes/pi-permission-system check`, `... test`, `pnpm -r run test`, `pnpm fallow dead-code` for the package.

## Testing strategy

- Negative coverage is the contract: auto-resolved paths (`policy_allow`, `policy_deny`, `session_approved`, `infrastructure_auto_allowed`, `auto_approved`) and non-UI child paths must not emit `permissions:ui_prompt`.
  Preserve and extend the existing #292 regression tests.
- Forwarded round-trip uses the documented harness pattern: fire the child `tool_call` without awaiting, poll the parent `requests/` dir, write the approval JSON, then await.
- Builder tests assert the normalized `surface`/`value` projection across each `source` and a populated `forwarding` context for the forwarded builder.
- Tolerant-read test: a `ForwardedPermissionRequest` lacking `source`/`surface`/`value` still produces a valid forwarded event (`source` defaulted to `"tool_call"`, `surface`/`value` `null`).

## Backwards compatibility

- `permissions:ui_prompt` is unreleased; reshaping it is free.
- Removing `protocolVersion` from `PermissionsReadyEvent` is a breaking change to a released payload — this PR lands as a major version bump.
  Commit with a `BREAKING CHANGE:` footer so release-please cuts the major.
- `permissions:decision` is unchanged (it never carried `protocolVersion`).
- The RPC envelope keeps `protocolVersion`; RPC consumers are unaffected.
- `ForwardedPermissionRequest` gains optional `source`/`surface`/`value`; readers tolerate their absence, so a parent/child version skew during upgrade degrades gracefully (`source` defaults to `"tool_call"`, `surface`/`value` `null`) rather than failing.

## Risks and open questions

- Projection sufficiency: the lean payload bets that `surface`/`value`/`message` cover the notification use case and the dropped fields (`toolCallId`, `command`, `path`, etc.) are not needed.
  Confirm at step 1 before deleting them; reintroducing one later is an additive, non-breaking change.
- Relay surface: even consolidated into `ForwardedPromptInput`, the display fields still pass through `confirmPermission` to the forwarded writer.
  This is acceptable because the two endpoints (prompter, forwarded writer) genuinely share the data and `confirmPermission` owns the branch; revisit only if a third forwarded caller appears.
- Coordination: a heavy maintainer rewrite of an open PR should be flagged to moekyo before pushing onto the branch.
</content>
</invoke>
