---
issue: 745
issue_title: "pi-permission-system: replace the forwarded-request and ui_prompt message with the structured payload"
---

# The cross-boundary swap — the payload replaces `message` on the wire and the broadcast

## Release Recommendation

**Release:** mid-batch — defer (batch "presentation-contract"); confirm at ship time

Phase 13 of `docs/architecture/architecture.md` places this issue at Step 3, and the roadmap's `Release batches` subsection reads: **Batch "presentation-contract": Steps 3, 4 (ship together; tail = Step 4; release vehicle = Step 3's `feat!:` breaking release with the `message`-replacement migration note)**.
This issue carries the batch's breaking commits, but Step 4 ([#746]) is the tail — it retires the last `message` reader and lands the review-log renderer that bounds what this change's un-capped evidence would otherwise persist.
Releasing here would publish a major bump whose migration note is only half true, so the release-please PR stays unmerged until [#746] lands.

## Problem Statement

Two consumers still receive a pre-rendered sentence, and each carries its own defect.

The forwarded wire relays the child's prose.
The child assembles its message under *its* configuration, writes it into the request file, and the serving node carries it forward as a single evidence entry — so the parent's own render budget never applies to the child's text.
Consistency across local and forwarded asks is therefore not merely unstated; it is unattainable while the payload crossing the wire is a sentence assembled at the child.

The broadcast over-discloses.
`permissions:ui_prompt` carries the full assembled message, and any loaded extension can observe the bus without the operator having named it.
Every other route to evidence requires that consent — a registered tool-input formatter, or an `Authorizer` link the operator lists in `authorizerChain` — which is why [ADR 0011] §6 makes the bus the narrowest renderer.

The two preview caps are the third loose end.
`toolInputPreviewMaxLength` and `toolTextSummaryMaxLength` bound only the non-bash JSON and search-summary previews, which is why they never bounded the prompt, and keeping them alongside the renderer budgets leaves two layers that both sound like they bound the same thing.

## Goals

- The forwarded request carries `payload: PromptPayload` and no `message`; the child serializes it and the serving node renders the child's own facts under the *parent's* budget.
- A forwarded ask renders identically **in kind** to a local one: the serving node holds the child's real `PromptPayloadKind`, so a forwarded bash ask reads `command : …` exactly as a local one does.
- `permissions:ui_prompt` drops `message` and gains `request: PromptRequestFacts` — the payload's invariant core, verbatim.
  The forwarded provenance (`forwarding.requesterAgentName` / `forwarding.requesterSessionId`) and the display projection (`surface` / `value` / `agentName`) are retained in full: what narrows is evidence, never correlation ([#292], [#610]).
- Version skew is handled per [ADR 0011] §9: a request carrying no payload is rendered from the fields it does carry, and a prompt is never presented empty.
- `toolInputPreviewMaxLength` and `toolTextSummaryMaxLength` stay optional in the schema, their values are ignored, and a config that sets either receives a deprecation notice through the existing config-issue channel.

This change **is breaking**, on three surfaces:

| Surface                                                  | Break                              |
| -------------------------------------------------------- | ---------------------------------- |
| `ForwardedPermissionRequest` (on-disk wire)              | `message` removed; `payload` added |
| `PermissionUiPromptEvent` (`permissions:ui_prompt`)      | `message` removed; `request` added |
| `toolInputPreviewMaxLength` / `toolTextSummaryMaxLength` | accepted but ignored               |

Commits carrying a removal are `feat!:` with a `BREAKING CHANGE:` footer naming the fields that supersede the removed one; the additive lift-and-shift steps ahead of them are plain `feat:`.

## Non-Goals

- The review log and the agent-facing denial renderer — [#746] (Step 4).
  `renderLegacyMessage` survives this change; `PromptPermissionDetails.message` is still what the review log persists.
- Removing the *built-in* preview truncation (`TOOL_INPUT_PREVIEW_MAX_LENGTH` 200, `TOOL_TEXT_SUMMARY_MAX_LENGTH` 80).
  Only the operator-configured values stop taking effect here.
  Un-capping the payload's tool-input evidence would grow the `message` the review log still persists verbatim, against `docs/decisions/0010-permission-log-secret-exposure.md`; [#746] owns the log's own bound and retires the constants once it exists.
  So the payload's completeness for a non-bash tool ask remains a residual, tracked with [#746] and shipping in the same release.
- Salvaging a version-skewed child's legacy `message` string into an evidence entry.
  The wire type drops the field, and the reader stops reconstructing it: a skewed ask renders from `surface`, `value`, and the requester provenance, which is never empty.
- A complete-view affordance for the `select`/`input` fallback.
  [#710]'s plan parked that story here, but nothing in this step creates a keystroke channel for a non-TUI mode; filed as [#751].
- Rendering `annotations`, the annotator registry ([ADR 0011] §8), and the evidence-formatter seam.
  The slot exists and nothing populates it.
- Out-of-process forwarding liveness ([#721], Step 5).
  It also edits `src/authority/approval-escalator.ts`, and the roadmap's Track B note says to land the two in sequence rather than concurrently.
- Anything about the permission request id — Step 9 ([#752]) has landed and settled it, including across the forwarding boundary.
  This step touches no identity code.
- The parent-side terminal decision emit and cross-session prompt/decision correlation — Step 10 ([#610]), which lands after Step 4 with both halves in place.
- Changing what any gate emits.
  Every payload builder is untouched; this step moves an existing payload across two boundaries.

## Background

### Sequencing against the rest of Phase 13

Step 9 ([#752]) has **landed and released** (`3f8d3fd6`), which retires the correlation work this plan originally carried — see "The correlation join" below.
It also already edited `src/permission-events.ts` and `src/authority/approval-escalator.ts`, so this plan is written against the post-[#752] tree and its line references were re-verified there.
Step 5 ([#721]) also edits `src/authority/approval-escalator.ts` and must land before or after this issue, not alongside it.

### What Steps 1 and 2 already built

`PromptPayload` (`src/presentation/prompt-payload.ts`) is the complete structured description of an ask: a `kind` discriminant, a `request` invariant core, complete `evidence`, and an `annotations` slot.
`PromptPermissionDetails.payload` is **required**, so every ask already carries one ([#744]).
`renderPromptDialog` (`src/presentation/dialog-renderer.ts`) renders it for the inline dialog and the `select`/`input` fallback under `promptMaxRows` plus `promptFieldMaxWidth` ([#710]).

The consequence that matters here: the serving node **already** renders through `renderPromptDialog` under its own budget, because `LocalUserAuthorizer` hands `details.payload` to `requestPermissionDecision`.
What is missing is not a renderer but the facts — today `buildForwardedAskPayload` synthesizes a `kind: "forwarded"` payload whose only evidence entry is the child's sentence.
Once the wire carries the child's payload, "the serving node renders the child's facts under the parent's budget" follows without new render code.

### The wire and its tolerant reader

`readForwardedPermissionRequest` (`src/authority/forwarding-io.ts`) is a tolerant `asX`-style parser: it validates a required core, then reconstructs an allowlist of optional fields (`asUiPromptSource`, `asNullableDisplayString`, `asForwardedSessionApproval`, `asForwardedAccessIntent`), dropping anything malformed.
An added field is silently dropped unless the reader is taught it — so `payload` needs an `asPromptPayload` narrowing guard, and the required-core gate must stop demanding `typeof parsed.message === "string"` or a current child's request is rejected outright.

`isPermissionDecisionState` lives in `permission-dialog.ts`, the type's own module, and `forwarding-io.ts` imports it.
`asPromptPayload` follows that precedent and lives beside its type in `src/presentation/prompt-payload.ts`, so a new `request` fact updates the guard next door rather than in a distant reader.

### The broadcast's two vocabularies

`PermissionUiPromptEvent` carries a **display** projection: `surface` is the child's tool name and `value` the normalized display value, chosen in [#292] as "lean by design — not a mirror of the internal review log".
`PromptRequestFacts.surface` is the **gate** surface the rule fired on (`external_directory`, `path`, a tool name).
`buildForwardedAskDetails` already keeps the two distinct and documents why; nesting `request` alongside the flat projection preserves both, and the doc update states the distinction rather than collapsing it.

`requestId` stays top-level: `PromptRequestFacts` carries no id, so the correlation key and the facts do not overlap.

### Constraints from AGENTS.md and the package skill

- The config field path is `config-schema.ts` (with `.meta`) → `pnpm run gen:schema` → `extension-config.ts` → `mergeUnifiedConfigs()`; a field on the runtime type but not the merge intermediate is silently dropped (the #332 / #347 class).
  Here the traversal runs backwards: the field leaves `PermissionSystemExtensionConfig` while staying in the schema and the merge, so the deprecation detector can still see an operator's setting.
- `schemas/permissions.schema.json` is generated; a parity test in `test/config-schema.test.ts` fails on drift.
- Removing a config field entirely would make strict validation reject it fail-closed and empty an operator's policy — hence soft deprecation.
- The forwarding request/response files are mode-restricted but **not** redacted; the parent reads them to render the ask.
  The payload's evidence is the same disclosure class as today's `message`, so this is not a widening.
- A commit is typed by what a user can observe once it lands; a module no code imports yet is `refactor:`.
  CI gates on `pnpm fallow dead-code`, so `asPromptPayload` lands together with its first consumer rather than as a standalone pure addition.

## Design Overview

### The wire

```typescript
export type ForwardedPermissionRequest = {
  id: string;
  createdAt: number;
  requesterSessionId: string;
  targetSessionId: string;
  requesterAgentName: string;
  /**
   * The child's complete prompt payload (ADR 0011 §2). Optional for version-skew
   * tolerance: an older child omits it, and the serving node renders from the
   * display fields it does carry (ADR 0011 §9).
   */
  payload?: PromptPayload;
  source?: PermissionUiPromptSource;
  surface?: string | null;
  value?: string | null;
  sessionApproval?: ForwardedSessionApproval;
  accessIntent?: ForwardedAccessIntent;
};
```

`message: string` is gone.
`PromptPayload` is JSON-safe by construction — every leaf is a string, `null`, or an array of those, and `commandContext` is a string-literal union — which is why [#744] chose `| null` over `| undefined` on the request facts.

`permission-forwarding.ts` gains one import, `#src/presentation/prompt-payload`, whose own only import is `#src/types`.
No cycle: the presentation layer does not import the authority layer.

### The correlation join

**Settled by [#752]; nothing to do here.**

This plan originally carried a `requesterRequestId` wire field to join the child's and the serving node's review-log entries, on the measurement that 53 of 57 `forwarded_permission.request_created` entries named an id appearing on no `permission_request.*` entry.
[#752] closed that gap at the source instead, and better: `ParentAuthorizer` stopped minting a third id and now writes `details.requestId` as the forwarded request's `id` (`forwardableRequestId`, `src/authority/approval-escalator.ts`).
So `ForwardedPermissionRequest.id` **is** the child's request id, and a second relayed field would name the same value twice.

Verified against the post-[#752] tree: `requesterRequestId` appears nowhere in `src/` or `test/`, and the wire type is otherwise unchanged.
This step therefore adds no identity field, and its TDD order has no correlation cycle.

One residual is worth naming rather than discovering during implementation.
`forwardableRequestId` falls back to a fresh mint when the inbound id could not safely name a file — the relay-hop guard — and in exactly that case `id !== details.requestId`, so the join breaks for that one exchange while the `forwarded_permission.request_created` entry logs the wire id alone.
It is [#752]'s residual, not this step's: the fallback is a filename-safety valve, the ids it rejects are ones no current minter produces, and closing it means logging both ids on that entry rather than changing any contract.
Raised in Open Questions; not folded in silently.

### The serving node

`buildForwardedAskPayload` becomes a two-branch projection rather than a synthesizer:

```typescript
export function buildForwardedAskPayload(
  request: ForwardedPermissionRequest,
): PromptPayload {
  const requester = {
    agentName: request.requesterAgentName,
    forwarded: true,
    sessionId: request.requesterSessionId,
  };
  return request.payload
    ? { ...request.payload, request: { ...request.payload.request, requester } }
    : degradedForwardedPayload(request, requester);
}
```

The requester is re-stamped because the child built its payload with `localRequester(agentName)` — `forwarded: false`, `sessionId: null`.
The serving node is the only party that knows the ask arrived over the wire, and the request's own `requesterAgentName` / `requesterSessionId` are the authoritative provenance ([#292]); everything else on the payload is the child's fact and passes through untouched.

The degraded branch keeps `kind: "forwarded"` and builds the request facts from `request.surface` / `request.value` with empty evidence.
The `"forwarded"` kind therefore does not disappear from `PromptPayloadKind` — it narrows to meaning exactly one thing: *this ask arrived without a payload*.

Consequences to carry through:

- `forwardedValueLabel` (`dialog-renderer.ts`) stays, and its comment stops predicting its own dissolution: it now labels the skew render only.
- `renderForwarded` (`legacy-message.ts`) can no longer read a `"requested"` evidence entry, because the degraded payload has none.
  It renders the provenance plus the surface/value it does hold.
- A payload-bearing forwarded ask no longer reaches `renderForwarded` at all — its `kind` is the child's — so the `message` the serving node's review log persists becomes the local-shaped sentence for that kind.
  That is a deliberate consequence of "renders identically in kind", and the review log is [#746]'s surface.

### The broadcast

```typescript
export interface PermissionUiPromptEvent {
  requestId: string;
  source: PermissionUiPromptSource;
  /** Normalized display surface (e.g. "bash", "skill"), when known. */
  surface: string | null;
  /** Normalized display value (command, path, skill name, etc.), when known. */
  value: string | null;
  agentName: string | null;
  /** The ask's invariant core (ADR 0011 §3). No evidence, no annotations. */
  request: PromptRequestFacts;
  forwarding: ForwardedPromptContext | null;
}
```

`DirectPromptInput.message: string` becomes `payload: PromptPayload`, and `buildUiPrompt` projects `request: input.payload.request`.
Both call sites already pass a `PromptPermissionDetails`, which carries a required `payload`, so neither `LocalUserAuthorizer` nor `ParentAuthorizer` changes beyond compiling.

The consumer's call site, to check the shape reads well:

```typescript
pi.events.on("permissions:ui_prompt", (raw) => {
  const event = raw as PermissionUiPromptEvent;
  notify(event.surface, event.value, event.request.matchedPattern);
  // e.g. "bash" "git push" "git *"
});
```

`request` is nested rather than flattened so the event and the payload share one shape: a fact added to `PromptRequestFacts` reaches the bus without a second hand-maintained declaration, the same argument that made `PromptPermissionDetails.payload` required in [#744].

Disclosure check against [ADR 0011] §6: the bus gains `matchedPattern`, `executedUnit`, `invokedToolName`, `commandContext`, and the gate `surface`, and loses the assembled sentence.
`matchedPattern` already rides `permissions:decision`; `executedUnit` is derived from the command, which is already `value` for a bash ask.
For a `write`, an `edit`, or an MCP call the change is a net narrowing — today an incidental preview of up to 200 characters rides `message`, and after this change nothing from `evidence` reaches the bus at all.

`PromptRequestFacts` and `PromptRequester` become part of the public type surface, so `src/service.ts` re-exports them and `scripts/verify-public-types.sh` adds `PromptRequestFacts` to its symbol list.
The declaration bundle already inlines both (`dist/public.d.ts` lines 58–85) via `PromptPermissionDetails`; what is missing is the named export a consumer needs to annotate a variable.

### The preview caps

`resolveToolPreviewLimits` drops its parameter and returns the three built-in constants; `ConfigurablePreviewLimits` goes with it.
The two fields leave `PermissionSystemExtensionConfig` and `normalizePermissionSystemConfig`, so no runtime consumer can read them — the skill's "a declared config field not read at runtime is a maintenance trap" applied deliberately.

They stay in `unifiedConfigSchema` (strict validation must keep accepting them) and stay in `mergeUnifiedConfigs`'s number-scalar loop, so `merged` still carries an operator's setting for the detector to see.

The notice follows `detectPermissiveBashFallback`'s precedent exactly — a pure detector over the merged config, whose caller owns pushing onto the issue list:

```typescript
export function detectDeprecatedPreviewCaps(
  config: UnifiedPermissionConfig,
): string | undefined;
```

`loadPermissionConfigs` pushes its result onto `allIssues` alongside the bash-fallback issue, and it surfaces through `PolicyLoader.getConfigIssues()` → `PermissionManager.getConfigIssues()` → `SessionLifecycleHandler`'s `logger.warn`, which is the existing config-issue channel the issue names.

### Version skew, in both directions

Skew is only reachable for an out-of-process child (`PermissionForwardingTargetSource` `"env"`); an in-process child shares the parent's loaded extension.

| Direction             | Behavior                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New parent, old child | Request has `message`, no `payload`. The relaxed required-core gate accepts it; `asPromptPayload` returns `undefined`; the degraded branch renders provenance + `surface` + `value`. Never empty.                                    |
| Old parent, new child | Request has `payload`, no `message`. The old parser's `typeof parsed.message !== "string"` check rejects it and deletes the file; the child abandons at the forwarding timeout with `confirmationUnavailable`. Safe direction, slow. |

The second row is unavoidable — [ADR 0011] §9 declines to carry both fields indefinitely — so the migration note says to **upgrade the parent session first**.

## Module-Level Changes

### Source

| File                                        | Change                                                                                                                                                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/authority/permission-forwarding.ts`    | `ForwardedPermissionRequest`: remove `message: string`, add `payload?: PromptPayload`; import the payload type                                                                                                                |
| `src/presentation/prompt-payload.ts`        | Add `asPromptPayload(value: unknown): PromptPayload \| undefined` — tolerant narrowing over `kind`, the request facts, `evidence`, and `annotations`                                                                          |
| `src/authority/forwarding-io.ts`            | Drop `message` from the required-core gate and the reconstruction; add `payload: asPromptPayload(parsed.payload)`                                                                                                             |
| `src/authority/approval-escalator.ts`       | `ForwardedRequestFacts.message: string` → `payload: PromptPayload`; `authorize` relays `details.payload`; `buildForwardedRequest` writes it. The `requestId` field and `forwardableRequestId` are [#752]'s and are left alone |
| `src/presentation/forwarded-ask-payload.ts` | Two-branch projection: the child's payload with a re-stamped `requester`, or the degraded `kind: "forwarded"` payload; rewrite the module doc, which currently describes the transition as future                             |
| `src/presentation/legacy-message.ts`        | `renderForwarded` renders provenance + surface/value instead of the removed `"requested"` evidence entry                                                                                                                      |
| `src/presentation/dialog-renderer.ts`       | `forwardedValueLabel`: comment now scopes it to the skew render rather than predicting its dissolution                                                                                                                        |
| `src/permission-events.ts`                  | `PermissionUiPromptEvent`: remove `message: string`, add `request: PromptRequestFacts`                                                                                                                                        |
| `src/permission-ui-prompt.ts`               | `DirectPromptInput.message: string` → `payload: PromptPayload`; `buildUiPrompt` emits `request`                                                                                                                               |
| `src/service.ts`                            | Re-export `PromptPayload`, `PromptPayloadKind`, `PromptRequestFacts`, `PromptRequester`, `PromptEvidence`, `PromptAnnotation`                                                                                                 |
| `src/tool-preview-formatter.ts`             | `resolveToolPreviewLimits()` loses its parameter; remove `ConfigurablePreviewLimits`                                                                                                                                          |
| `src/permission-session.ts`                 | `getToolPreviewLimits()` calls `resolveToolPreviewLimits()` with no argument                                                                                                                                                  |
| `src/extension-config.ts`                   | Remove `toolInputPreviewMaxLength` / `toolTextSummaryMaxLength` from `PermissionSystemExtensionConfig` and `normalizePermissionSystemConfig`                                                                                  |
| `src/config-schema.ts`                      | Mark both caps deprecated in their `.meta({ description, markdownDescription })`                                                                                                                                              |
| `src/config-loader.ts`                      | Add `detectDeprecatedPreviewCaps`; push its notice onto `allIssues`                                                                                                                                                           |

`renderLegacyMessage` itself is otherwise untouched, and every payload builder is untouched.

### Generated, scripts, and config

| File                              | Change                                                      |
| --------------------------------- | ----------------------------------------------------------- |
| `schemas/permissions.schema.json` | Regenerate via `pnpm run gen:schema` after the `.meta` edit |
| `config/config.example.json`      | Remove the two deprecated caps                              |
| `scripts/verify-public-types.sh`  | Add `PromptRequestFacts` to the required-symbol list        |

### Tests

| File                                                                                                                                                                                                                                                                                                                                        | Change                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/helpers/forwarding-fixtures.ts`                                                                                                                                                                                                                                                                                                       | `writeRequest`'s default request drops `message` and gains a `payload`                                                                                                               |
| `test/helpers/prompt-details-fixtures.ts`                                                                                                                                                                                                                                                                                                   | Unchanged — `makePromptDetails` already defaults `payload`; `makePromptPayload` gains the wire-shaped cases the new tests need                                                       |
| `test/authority/forwarding-io.test.ts`                                                                                                                                                                                                                                                                                                      | Round-trip: payload written and read back; malformed payload → `undefined`; legacy `message`-only request still accepted                                                             |
| `test/authority/approval-escalator.test.ts`                                                                                                                                                                                                                                                                                                 | The written request carries `payload` and no `message`; [#752]'s id-adoption cases stay green untouched                                                                              |
| `test/authority/forwarded-request-server.test.ts`                                                                                                                                                                                                                                                                                           | The escalated ask carries the child's payload with a re-stamped requester; a payload-less request escalates the degraded payload                                                     |
| `test/presentation/legacy-message.test.ts`                                                                                                                                                                                                                                                                                                  | Rewrite the `forwarded` cases against the degraded payload; the eight local-kind cases stay untouched (the [#744] byte-identity invariant)                                           |
| `test/presentation/dialog-renderer.test.ts`                                                                                                                                                                                                                                                                                                 | Re-pin the [#710] here-string measurement at the new shape (a forwarded ask carrying a child `kind: "bash"` payload); keep the existing `kind: "forwarded"` cases as the skew render |
| `test/permission-ui-prompt.test.ts`                                                                                                                                                                                                                                                                                                         | `buildUiPrompt` emits `request`, no `message`; `forwarding` / `surface` / `value` / `agentName` unchanged                                                                            |
| `test/permission-events.test.ts`, `test/authority/local-user-authorizer.test.ts`, `test/authority/permission-prompter.test.ts`, `test/composition-root.test.ts`, `test/log-redaction.test.ts`                                                                                                                                               | Update event/detail assertions that name `message`                                                                                                                                   |
| `test/config-loader.test.ts`                                                                                                                                                                                                                                                                                                                | A config setting either cap yields the deprecation notice                                                                                                                            |
| `test/tool-preview-formatter.test.ts`, `test/permission-session.test.ts`, `test/extension-config.test.ts`, `test/config-pipeline.test.ts`, `test/config-store.test.ts`, `test/handlers/gates/tool-call-gate-pipeline.test.ts`, `test/handlers/gates/tool.test.ts`, `test/helpers/gate-fixtures.ts`, `test/helpers/presentation-fixtures.ts` | Drop config-driven limit expectations; the constants still apply                                                                                                                     |
| `test/config-schema.test.ts`                                                                                                                                                                                                                                                                                                                | Schema-parity test re-passes after regeneration                                                                                                                                      |

### Documentation

| File                                               | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/cross-extension-api.md`                      | Payload-fields table: `message` row → `request` row; add a `PromptRequestFacts` table; rewrite the example, which currently reads `event.message`; state the display-projection vs gate-facts distinction                                                                                                                                                                                                                                                                                     |
| `docs/configuration.md`                            | Mark both caps deprecated in the options table and remove them from the example config block                                                                                                                                                                                                                                                                                                                                                                                                  |
| `docs/migration/0745-prompt-payload-contracts.md`  | New: the three breaks, the superseding fields, and the upgrade-the-parent-first ordering                                                                                                                                                                                                                                                                                                                                                                                                      |
| `docs/architecture/architecture.md`                | Mark Step 3 `✅` on its heading and its Mermaid node with a `Landed:` note; flip both `message: string` metric rows to `0 ✅`; rewrite the "Prompt presentation" paragraph at line 388, which asserts the wire, broadcast, and log all still read `message` and that the two caps still bound the previews; update the module-tree entries for `permission-ui-prompt.ts`, `presentation/forwarded-ask-payload.ts`, `presentation/legacy-message.ts`, and `authority/permission-forwarding.ts` |
| `README.md`                                        | No change — its `permissions:ui_prompt` bullet names the channel, not the payload                                                                                                                                                                                                                                                                                                                                                                                                             |
| `.pi/skills/package-pi-permission-system/SKILL.md` | No change — verified: it names the channel and the mode-restricted-not-redacted request files, neither of which this change alters                                                                                                                                                                                                                                                                                                                                                            |

Grep sweeps run at planning time to build this list:

- `grep -rn "message" src test` for every reader of the removed fields.
- `grep -rln "ui_prompt" docs README.md ../../.pi/skills` — the only live docs are `docs/cross-extension-api.md` and `README.md`; every other hit is a historical plan or retro, which is not edited.
- `grep -rn "toolInputPreviewMaxLength\|toolTextSummaryMaxLength" src schemas config docs README.md` for the cap sweep.
- `grep -n "permission-ui-prompt\|permission-forwarding\|forwarded-ask-payload\|legacy-message" docs/architecture/architecture.md` for the module-tree entries.

## Test Impact Analysis

This is a boundary swap rather than an extraction, so the three questions land differently.

**Newly possible tests.**
A forwarded ask can now be asserted at the *fact* level end to end: a child payload written to a request file, read back, and rendered by `renderPromptDialog` under the serving node's budget, with the assertion on the rendered facts rather than on a relayed sentence.
That test was impossible while the wire carried prose — the only observable was the child's string.
The skew branch also becomes directly testable: a request with a malformed payload and one with none at all are two distinct, assertable renders.

**Tests that become redundant.**
None are removed.
The `kind: "forwarded"` dialog-renderer cases look like candidates but are not: they become the skew render's tests, which is a real branch that must keep working.
`test/presentation/legacy-message.test.ts`'s two forwarded cases are rewritten rather than deleted, because the degraded `message` is still what the review log persists until [#746].

**Tests that must stay as-is.**
The eight local-kind cases in `test/presentation/legacy-message.test.ts` are the [#744] byte-identity proof and must not be touched — if a local ask's `message` changes here, something leaked across the boundary this change is supposed to be confined to.
`test/authority/forwarded-request-server.test.ts`'s policy-then-escalate, grant-scope, and one-hop-canary cases exercise resolution, not presentation, and are unaffected except where they assert on details.

## Invariants at risk

| Invariant                                                                                             | Source                                                            | Pinned by                                                                                                                           |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Every ask carries a complete payload; `PromptPermissionDetails.payload` is required                   | [#744] `Landed:`                                                  | The type, plus `test/helpers/prompt-details-fixtures.ts`                                                                            |
| A local ask's `message` is byte-identical to the pre-payload assembler output                         | [#744] `Landed:`                                                  | The eight local-kind cases in `test/presentation/legacy-message.test.ts` — untouched                                                |
| A forwarded ask with pathological input renders inside the 24-row default                             | [#710] `Landed:` (measured 205 rows before, at widths 80/120/160) | `test/presentation/dialog-renderer.test.ts` "bounds the reported forwarded here-string ask (#710)" — **re-pinned at the new shape** |
| A forwarded ask's broadcast stays non-degraded: `requesterAgentName` and `requesterSessionId` present | [#292], built on by [#610]                                        | `test/permission-ui-prompt.test.ts`, `test/permission-events.test.ts`                                                               |
| An `Authorizer` link sees the child's gate facts but not `requesterCwd` / `principal`                 | [#635]                                                            | `test/authority/forwarded-request-server.test.ts`; `toAccessFacts`'s explicit return type                                           |
| The gate's fail-closed behavior is unchanged                                                          | Package invariant                                                 | Existing gate suite; this change touches no gate                                                                                    |

The quantitative one is the third, and it is the one the plan must measure rather than argue.
The [#710] pin renders a hand-built `kind: "forwarded"` payload whose evidence is the child's sentence; after this change the same ask arrives as `kind: "bash"` with the child's real evidence entries, which is a **different input to the same budget**.
The row budget still bounds evidence and `promptFieldMaxWidth` still bounds the core, so the prediction is that the render stays at or below 24 rows — but the TDD step asserts it on the new shape before the old test is edited, so the number is measured, not inferred.

[#635]'s boundary deserves an explicit check because the payload now crosses where it did not before.
`PromptPayload` carries `requester.agentName` and `requester.sessionId`, both of which `details.forwarding` already discloses to a link, and carries neither `requesterCwd` nor `principal`.
So the payload's arrival on the ask details is not a widening; the TDD step asserts the absence rather than assuming it.

## TDD Order

Lift-and-shift on the wire: the payload arrives alongside `message`, the serving node switches to it, and only then is `message` removed.
That keeps each step's blast radius to one contract instead of collapsing the whole wire into one commit.

1. **The wire carries the payload (additive).**
   Red: `test/authority/forwarding-io.test.ts` — a request written with a payload reads it back; a malformed payload reads back `undefined`; a request without one is still valid.
   `test/authority/approval-escalator.test.ts` — the written request file carries `payload`.
   Green: `asPromptPayload` in `prompt-payload.ts`; `payload?: PromptPayload` on `ForwardedPermissionRequest`; `forwarding-io.ts` reconstructs it; `ForwardedRequestFacts` gains `payload`, and `ParentAuthorizer` writes both fields.
   `feat(pi-permission-system): carry the prompt payload on the forwarded-request wire`

2. **The serving node renders the child's facts.**
   Red: `test/authority/forwarded-request-server.test.ts` — the escalated ask's payload is the child's, with `requester` re-stamped to the request's provenance and the child's `kind` preserved; a payload-less request escalates the degraded `forwarded` payload.
   `test/presentation/dialog-renderer.test.ts` — the [#710] here-string measurement at the new shape, asserted **before** the old case is touched.
   Green: `buildForwardedAskPayload`'s two branches.
   `feat(pi-permission-system): render a forwarded ask from the child's own payload`

3. **Remove `message` from the wire.**
   Every importer of the field breaks at the type level in this commit, so the wire type, the reader, the child's write, the degraded legacy render, and the fixtures move together.
   Red: `test/authority/forwarding-io.test.ts` — a legacy `message`-only request is accepted and reconstructs no message; `test/presentation/legacy-message.test.ts` — the rewritten forwarded cases render from surface/value.
   Green: drop `message` from `ForwardedPermissionRequest`, from `readForwardedPermissionRequest`'s gate and reconstruction, and from `ForwardedRequestFacts`; rewrite `renderForwarded`; update `forwardedValueLabel`'s comment and `test/helpers/forwarding-fixtures.ts`.
   `feat(pi-permission-system)!: replace the forwarded-request message with the structured payload`

4. **Narrow the broadcast.**
   Red: `test/permission-ui-prompt.test.ts` — `buildUiPrompt` emits `request` equal to the payload's core and no `message`, with `surface` / `value` / `agentName` / `forwarding` unchanged.
   Green: `PermissionUiPromptEvent.message` → `request`; `DirectPromptInput.message` → `payload`; `service.ts` re-exports; `scripts/verify-public-types.sh` symbol list.
   Consumer-test updates in `test/permission-events.test.ts`, `test/authority/local-user-authorizer.test.ts`, `test/authority/permission-prompter.test.ts`, `test/composition-root.test.ts`, `test/log-redaction.test.ts` ride this commit — the field removal breaks them at compile time.
   `feat(pi-permission-system)!: narrow the ui_prompt broadcast to the request facts`

5. **Soft-deprecate the two preview caps.**
   Red: `test/config-loader.test.ts` — a config setting either cap yields a deprecation notice through `getConfigIssues`, and setting neither yields none; `test/tool-preview-formatter.test.ts` — a configured value no longer changes the limit.
   Green: `detectDeprecatedPreviewCaps`; `resolveToolPreviewLimits()` parameterless; the fields leave `PermissionSystemExtensionConfig`; `.meta` marked deprecated; `pnpm run gen:schema`; `config/config.example.json`.
   `feat(pi-permission-system)!: ignore the deprecated tool-preview caps and notice their use`

6. **Documentation and the roadmap mark.**
   `docs/cross-extension-api.md`, `docs/configuration.md`, the new `docs/migration/0745-prompt-payload-contracts.md`, and `docs/architecture/architecture.md` (Step 3 `✅` on heading and Mermaid node, `Landed:` note, both metric rows to `0 ✅`, the line-388 paragraph, and the four module-tree entries).
   `docs(pi-permission-system): document the payload contracts and mark Phase 13 Step 3 complete`

Verification after each step: `pnpm --filter @gotgenes/pi-permission-system run check`, `run lint`, `run test`.
After step 4, also `pnpm --filter @gotgenes/pi-permission-system run verify:public-types`.
Before the final commit, `pnpm fallow dead-code --workspace @gotgenes/pi-permission-system` and the metric recomputes:

```bash
grep -c "message: string" packages/pi-permission-system/src/authority/permission-forwarding.ts   # 1 -> 0
grep -c "message: string" packages/pi-permission-system/src/permission-ui-prompt.ts              # 1 -> 0
```

Baselines measured this session: both are `1`.
`src/permission-events.ts` also holds one `message: string` and also goes to `0`; it is not a roadmap metric row, but it is part of the same removal and the metric would be dishonest without it.

## Risks and Mitigations

| Risk                                                                                               | Mitigation                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An old parent rejects a new child's request and the child burns the 10-minute timeout              | Only reachable for an out-of-process child; the migration note says upgrade the parent first, and the abandonment already reports `confirmationUnavailable` rather than a user denial ([#719])           |
| The forwarded render regresses past the row budget once real evidence crosses the wire             | Step 2 re-pins the [#710] measurement at the new shape **before** the old case is edited, so the number is measured                                                                                      |
| `asPromptPayload` accepts a partially-malformed payload and the serving node renders corrupt facts | The guard is all-or-nothing, following `asForwardedAccessIntent`'s precedent: any malformed field yields `undefined` and the degraded render, never a half-payload                                       |
| The payload's arrival on the ask details widens what an `Authorizer` link sees                     | The payload carries no `requesterCwd` and no `principal`; a test asserts the absence rather than the design assuming it ([#635])                                                                         |
| A third-party extension reading `event.message` breaks silently                                    | Unavoidable and intended; the migration note names `request.value` and `request.matchedPattern` as the superseding fields, and `docs/cross-extension-api.md` already tells consumers to read defensively |
| The `payload` field is added to the wire type but silently dropped on read                         | The tolerant `asX` reader is treated as a first-class touch point in step 1, with a round-trip test rather than a write-side-only assertion                                                              |
| Landing concurrently with [#721] conflicts in `approval-escalator.ts`                              | The roadmap's Track B note already requires sequencing; this plan restates it and neither issue is in flight                                                                                             |
| Removing the caps' effect grows the review log                                                     | Deliberately out of scope — only the configured values stop applying, and the built-in constants still bound the evidence until [#746] lands the log's own renderer                                      |

## Open Questions

- Whether the degraded skew render should eventually be removed once the version window closes.
  It is cheap to keep and fails safe, so it stays for now; no issue filed.
- Whether `docs/cross-extension-api.md` should publish a stability note distinguishing the display projection (`surface` / `value`) from the gate facts (`request.surface`).
  Planned as prose in the doc update; if consumers conflate them in practice, that becomes a rename discussion, not a doc one.
- The `select`/`input` fallback's complete-view capability, parked here by [#710]'s plan, is filed as [#751] and out of scope.
- Whether `forwarded_permission.request_created` should log the requester's id alongside the wire id, closing the join for the one case where [#752]'s `forwardableRequestId` falls back to a fresh mint.
  It is [#752]'s residual and needs no contract change; this step keeps today's behavior, and Step 10 ([#610]) decides it with the full correlation picture.

[ADR 0011]: ../decisions/0011-prompt-presentation-contract.md
[#292]: https://github.com/gotgenes/pi-packages/issues/292
[#610]: https://github.com/gotgenes/pi-packages/issues/610
[#635]: https://github.com/gotgenes/pi-packages/issues/635
[#710]: https://github.com/gotgenes/pi-packages/issues/710
[#719]: https://github.com/gotgenes/pi-packages/issues/719
[#721]: https://github.com/gotgenes/pi-packages/issues/721
[#744]: https://github.com/gotgenes/pi-packages/issues/744
[#746]: https://github.com/gotgenes/pi-packages/issues/746
[#751]: https://github.com/gotgenes/pi-packages/issues/751
[#752]: https://github.com/gotgenes/pi-packages/issues/752
