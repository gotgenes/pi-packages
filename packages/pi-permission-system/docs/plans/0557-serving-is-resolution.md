---
issue: 557
issue_title: "pi-permission-system: serving is resolution — rebuild processInbox on evaluate() + the serving session's Authorizer"
---

# Serving is resolution — rebuild `processInbox` on `evaluate()` + the serving session's `Authorizer`

## Release Recommendation

**Release:** ship independently

Phase 9 Step 3 is tagged `Release: independent` in the architecture roadmap, and the roadmap's release-batches note says Steps 3 and 4 each cut a release on landing.
This ships as a `feat:` (behavior change: parent `allow`/`deny` rules now govern children's escalations), so it cuts a release on its own; nothing to defer or coordinate.

## Problem Statement

The serving node (`ForwardedRequestServer.processSingleForwardedRequest`) answers forwarded escalations with bespoke logic: its own yolo check — the last one outside the composed ruleset — and no `evaluate()`, so a parent `allow` or `deny` rule cannot govern a child's escalation.
Every forwarded request that is not yolo-approved goes straight to a dialog, and the server owns its own `permissions:ui_prompt` emission and UI invocation in parallel to the `Authorizer` spine Steps 1–2 built.

Phase 9's resolved direction 1 says serving an escalation from below is identical to resolving an action locally: run `evaluate()` against the serving node's recorded authority, then escalate to the serving session's `Authorizer` on `ask`.

One consequence the issue's phrasing did not spell out (uncovered at the Decide gate, now recorded in the roadmap): the serving path today emits the **non-degraded** forwarded `permissions:ui_prompt` — original `source`, `surface`/`value` projection, populated `forwarding` context — per the [#292] contract hardening documented in `docs/cross-extension-api.md` ("Forwarded prompts are not degraded").
Rerouting the prompt through `LocalUserAuthorizer` naively would re-degrade the broadcast (`forwarding: null`) with a fully green suite.
This plan threads the forwarded provenance through the escalated ask's details so the invariant survives the reroute.

## Goals

- A forwarded request carrying `(surface, value)` resolves against the serving node's composed base ruleset: `allow` (including yolo-rewritten) auto-approves, `deny` auto-denies, `ask` — or missing fields — escalates through the `AskEscalator` seam to the serving session's selected `Authorizer`.
- Behavior change (ships as `feat:`): parent `allow`/`deny` rules now govern children's escalations; yolo inheritance falls out of the yolo-rewritten ruleset with **zero** yolo checks outside the composed ruleset (`isYoloModeEnabled` and the `ConfigReader` dep leave the server).
- The escalated ask carries its forwarded provenance (requester agent/session, original `source`/`surface`/`value`) as data on `PromptPermissionDetails`; `LocalUserAuthorizer` renders it — the non-degraded forwarded `permissions:ui_prompt` broadcast and the `"Permission Required (Subagent)"` dialog title — leaving exactly one `permissions:ui_prompt` emit site.
- One-hop canary: a loud warning when a request arrives from a requester whose registered parent is not the serving session (multi-hop or misrouted; the depth-2 invariant is external — pi-subagents' recursion guard).
- `processSingleForwardedRequest` drops below 60 lines (currently 117).
- The design decisions are recorded in `docs/decisions/0005-serving-authorizer-provenance.md`, with post-ship validation tracked in [#565].

## Non-Goals

- Grant-scope selection on forwarded approvals — Phase 9 Step 4 ([#558]); the dialog is escalated without a `sessionLabel` and whatever decision state comes back rides the response file exactly as today.
- Moving `forwarding-manager.ts` / `permission-forwarding.ts` / `subagent-registry.ts` into `src/authority/` — Phase 9 Step 5 ([#559]).
- The `ModelTriageAuthorizer` ([#472]) — deferred with its own decision record.
- Multi-hop escalation — admitted, not shipped (resolved direction 2); this step adds only the canary.
- Cross-session agent-name semantics: serving evaluates with `agentName` undefined (base ruleset); revisiting that once principal identity lands is part of [#565].
- Redefining the `permissions:ui_prompt` event shape — the cross-extension contract is byte-compatible before and after.

## Background

Relevant modules (all in `packages/pi-permission-system/`):

- `src/authority/forwarded-request-server.ts` — `ForwardedRequestServer` (`InboxProcessor`): drains the inbox, and per request runs the bespoke serve flow (yolo check → `buildForwardedUiPrompt` emission → dialog → response write).
  Deps today: `forwardingDir`, `logger`, `events?`, `requestPermissionDecisionFromUi`, `config: ConfigReader`.
- `src/authority/authorizer-selection.ts` — `AuthorizerSelection`: selects the `Authorizer` once per activation; implements the single-method `AskEscalator` seam (`escalate(details)`) that `GateRunner` already uses, delegating through `PermissionPrompter` (review-log bracketing: `permission_request.waiting` → `authorize` → `approved`/`denied`).
- `src/authority/local-user-authorizer.ts` — `LocalUserAuthorizer.authorize(details)`: `buildDirectUiPrompt(details)` → `emitUiPromptEvent` → dialog with title `"Permission Required"`.
- `src/authority/permission-prompter.ts` — `PromptPermissionDetails` (the ask's data: `requestId`, `source`, `agentName`, `message`, optional display fields).
- `src/permission-ui-prompt.ts` — single source for the `permissions:ui_prompt` contract shape: `buildDirectUiPrompt(DirectPromptInput)` (derives `surface`/`value`, `forwarding: null`) and `buildForwardedUiPrompt(ForwardedPromptInput)` (explicit `surface`/`value`, populated `forwarding`) — the [#292] fidelity split.
- `src/permission-forwarding.ts` — `ForwardedPermissionRequest` carries optional `source`/`surface`/`value` display fields (version-skew tolerant: an older child may omit them; the reader defaults `source` to `"tool_call"`).
- `src/permissions-service.ts` — `LocalPermissionsService.checkPermission(surface, value, agentName)` = `buildAccessIntentForSurface(...)` + `resolver.resolve(intent)`; the resolution semantics serving must reuse.
- `src/input-normalizer.ts` — `buildAccessIntentForSurface(surface, value, pathNormalizer, agentName)`.
- `src/subagent-registry.ts` — `SubagentSessionRegistry.get(sessionId)` → `{ parentSessionId? }`; entries exist only for in-process (pi-subagents) children.
- `src/forwarding-manager.ts` — `ForwardingManager.start(ctx)` already gates polling on `ctx.hasUI && !isSubagent`, so the server's internal `if (!ctx.hasUI) return` is redundant defense: a UI-less session never polls.
- `src/index.ts` — composition root; today constructs `requestServer` **before** `prompter`, `authorizerSelection`, and `resolver`, and `session` (which owns the cwd-bound `PathNormalizer`) after all of them, with `ForwardingManager(subagentDetection, requestServer)` a `session` constructor arg.

Constraints from AGENTS.md / the package skill: `docs/architecture/architecture.md` names these symbols in narrative prose and the module tree; the roadmap step gets its `✅` in the implementation doc-update commit.
The Phase 9 roadmap (amended in `21472cf9` during this planning session) now records the [#292] fidelity invariant on Step 3 and the provenance-as-data sentence in resolved direction 1 — this plan implements exactly that amended step.

## Design Overview

### Decision: provenance is data on the ask, not a second emission path

A forwarded ask is a different *question* than a local ask ("may my child do Y"), so its provenance — requester agent/session, original display projection — belongs on the ask's data (`PromptPermissionDetails`), and the one emit site (`LocalUserAuthorizer`) renders it.
This was checked against the smell taxonomy at the Decide gate:

- Not tramp data: every hop reads or relays it (`ForwardedRequestServer` builds it, `LocalUserAuthorizer` renders it, a future `ParentAuthorizer` hop would forward it — multi-hop-ready with no per-hop special-casing).
- Not a control flag: `LocalUserAuthorizer` does not branch its logic on it; it renders it (event payload + dialog title).
  Absent means a local ask.
- It is the live-authority echo of the principal identity the access-intent direction already requires ("the intent must carry principal identity so a forwarded request is evaluable on the serving node").

Rejected alternatives: server-side event emission with a dialog-only authorizer call (splits the emit+dialog pairing Step 1 gave `LocalUserAuthorizer`, needs an emit-suppressed authorize variant — a genuine control flag — and keeps two emit sites); a per-request decorator authorizer (authorizers are selected once per session; a per-request decorator is the same data flow with object ceremony).

### Type changes

```typescript
// src/authority/permission-prompter.ts
/** Provenance of a forwarded ask: who is really asking, one hop below. */
export interface ForwardedAskProvenance {
  requesterAgentName: string | null;
  requesterSessionId: string | null;
}

export interface PromptPermissionDetails {
  // ... existing fields unchanged ...
  /** Explicit display projection overrides (forwarded asks carry the child's originals). */
  surface?: string | null;
  value?: string | null;
  /** Present iff this ask was forwarded from a subagent. */
  forwarding?: ForwardedAskProvenance;
}
```

`src/permission-ui-prompt.ts` folds the two builders into one — the contract shape keeps a single source:

```typescript
// buildUiPrompt replaces buildDirectUiPrompt + buildForwardedUiPrompt.
export interface UiPromptInput {
  // DirectPromptInput's fields, plus:
  surface?: string | null; // explicit override; falls back to directSurface()
  value?: string | null; // explicit override; falls back to directValue()
  forwarding?: ForwardedPromptContext | null;
}

export function buildUiPrompt(input: UiPromptInput): PermissionUiPromptEvent {
  return {
    requestId: input.requestId,
    source: input.source,
    surface: input.surface !== undefined ? input.surface : directSurface(input),
    value: input.value !== undefined ? input.value : directValue(input),
    agentName: input.agentName,
    message: input.message,
    forwarding: input.forwarding ?? null,
  };
}
```

`PromptPermissionDetails` satisfies `UiPromptInput` structurally (as it satisfies `DirectPromptInput` today), so `LocalUserAuthorizer` still passes `details` straight through — no field-by-field copying:

```typescript
// LocalUserAuthorizer.authorize — renders provenance, no logic branch beyond presentation:
const uiPrompt = buildUiPrompt(details);
emitUiPromptEvent(this.deps.events, uiPrompt);
const title = details.forwarding ? "Permission Required (Subagent)" : "Permission Required";
return this.deps.requestPermissionDecisionFromUi(this.deps.ui, title, details.message, ...);
```

The emitted event is byte-identical to today's for both direct asks (`forwarding: null`, derived projection) and forwarded asks (populated `forwarding`, original `source`/`surface`/`value`, `agentName` = requester agent).

### The server: resolve, then escalate

`ForwardedRequestServer` sheds `events`, `requestPermissionDecisionFromUi`, and `config`; it gains two narrow roles (ISP — exactly the members it reads) and the registry for the canary:

```typescript
/** Recorded-authority view for serving: answer one (surface, value) query on the base ruleset. */
export interface ServingPolicy {
  check(surface: string, value: string | null): PermissionCheckResult;
}

export interface ForwardedRequestServerDeps {
  forwardingDir: string;
  logger: DebugReviewLogger;
  policy: ServingPolicy;
  escalator: AskEscalator;
  /** In-process registry, read by the one-hop canary. */
  registry?: SubagentSessionRegistry;
}
```

Per-request flow (replacing the yolo/dialog body of `processSingleForwardedRequest`):

```typescript
// 1. target-session check (unchanged), then the canary:
const info = this.registry?.get(request.requesterSessionId);
if (info?.parentSessionId && info.parentSessionId !== currentSessionId) {
  logPermissionForwardingWarning(this.logger, `one-hop invariant violated: ...`);
} // warn loudly, keep serving — resolution is still well-defined

// 2. recorded authority first; ask (or unevaluable) escalates:
const state = hasDisplayFields(request)
  ? this.policy.check(request.surface, request.value).state
  : "ask";
let decision: PermissionPromptDecision;
if (state === "allow") {
  decision = { approved: true, state: "approved" }; // review: forwarded_permission.auto_approved
} else if (state === "deny") {
  decision = { approved: false, state: "denied" }; // review: forwarded_permission.auto_denied
} else {
  // review: forwarded_permission.prompted, then escalate (try/catch preserved: failure denies)
  decision = await this.escalator.escalate(buildForwardedAskDetails(request));
}
// 3. response write + request-file cleanup (unchanged)
```

`buildForwardedAskDetails(request)` (module-private) maps the request onto `PromptPermissionDetails`: `requestId: request.id`, `source: request.source ?? "tool_call"` (version-skew default preserved), `agentName: request.requesterAgentName || null`, `message: formatForwardedPermissionPrompt(request)`, `surface`/`value` overrides, and `forwarding: { requesterAgentName, requesterSessionId }`.

Notes:

- **Base ruleset (`agentName` undefined)** — Decide-gate resolution: the child applied its own per-agent overrides before forwarding; the requester's agent name is display-only on the serving node.
  Revisited post-ship in [#565].
- **Missing `(surface, value)` floors to `ask`, even under yolo.**
  An older child's request without display fields cannot be evaluated, so it escalates to a prompt where the old code auto-approved under yolo.
  Accepted version-skew consequence (fail-safe direction); the fields have been carried since [#292].
- **Single-surface re-resolution is best-effort.**
  One `(surface, value)` pair cannot reproduce a child decision that layered multiple checks (e.g. `external_directory` over `path`); an imperfect resolution lands on `ask` → prompt, never a silent grant.
  Known simplification, recorded in ADR-0005 and validated post-ship in [#565].
- **The `if (!ctx.hasUI) return` guard is removed.**
  `ForwardingManager.start` already refuses to poll without UI, so the guard is unreachable defense; removing it is behavior-neutral and completes resolved direction 1's "the `hasUI` guards dissolve into selection."
  `processInbox` keeps its `ForwarderContext` parameter for `getSessionId(ctx)` but no longer touches `ctx.hasUI`/`ctx.ui`.

### Review-log and event deltas (deliberate, observable)

- `forwarded_permission.auto_approved` now fires for any policy `allow` (yolo-rewritten or plain) — same entry name, wider trigger.
- New `forwarded_permission.auto_denied` entry for a policy `deny` (new observable outcome; previously impossible).
- An escalated forwarded ask now *also* produces the `PermissionPrompter` bracketing (`permission_request.waiting`/`approved`/`denied`) around the existing `forwarded_permission.prompted`/`approved`/`denied` entries — the uniform-escalation shape [#556] chose; the serving lifecycle entries record provenance, the ask-path entries record the escalation.
- No `permissions:ui_prompt` is emitted when policy decides (`allow`/`deny`) — previously every non-yolo request emitted one.
  Consumers see prompts only when a human is actually about to be asked (this is the notify-now contract's intent); one sentence added to `docs/cross-extension-api.md`.
- No `permissions:decision` event changes — forwarded serving never emitted one and still does not (the child's gate emits its own).

### Composition root rewiring

`index.ts` construction order becomes: `prompter` → `authorizerSelection` → `resolver` (moved up; deps `permissionManager` + `sessionRules` exist early) → `servingPolicy` → `requestServer` → `ForwardingManager` → `session`.
The `ServingPolicy` is a three-line adapter over the same primitives `LocalPermissionsService.checkPermission` composes:

```typescript
const servingPolicy: ServingPolicy = {
  check: (surface, value) =>
    resolver.resolve(
      buildAccessIntentForSurface(surface, value ?? undefined, session.getPathNormalizer(), undefined),
    ),
};
```

The deferred `session.getPathNormalizer()` read is safe: inbox polling starts at `session_start`, after `session` is assigned — the same deferred-binding precedent as the logger's `notify` sink (documented with the same style of comment).

## Module-Level Changes

- `src/authority/permission-prompter.ts` — add `ForwardedAskProvenance`; add `surface?`/`value?`/`forwarding?` to `PromptPermissionDetails`.
  `PermissionPrompter.writeReviewEntry` is unchanged (the serving-side `forwarded_permission.*` entries already record provenance; keeping the ask-entry shape stable avoids review-log churn for direct asks).
- `src/permission-ui-prompt.ts` — replace `buildDirectUiPrompt` + `buildForwardedUiPrompt` + `DirectPromptInput` + `ForwardedPromptInput` with `buildUiPrompt` + `UiPromptInput` (explicit-override-or-derive semantics above); module doc comment updated.
  Grep confirmation: the only `src/` consumers are `local-user-authorizer.ts` (`buildDirectUiPrompt`) and `forwarded-request-server.ts` (`buildForwardedUiPrompt`); `permission-forwarding.ts` mentions `buildForwardedUiPrompt` only in the `ForwardedPromptDisplay` doc comment (reworded); docs references are point-in-time plans/retros (not edited).
- `src/authority/local-user-authorizer.ts` — `buildUiPrompt(details)`; title keyed on `details.forwarding`; doc comment notes it is the single `permissions:ui_prompt` emit site.
- `src/authority/forwarded-request-server.ts` — deps swap (`policy` + `escalator` + `registry?` in; `events`/`requestPermissionDecisionFromUi`/`config` out); per-request resolve-then-escalate flow; one-hop canary; `buildForwardedAskDetails` helper; remove the `ctx.hasUI` guard, the `isYoloModeEnabled` import, and the `buildForwardedUiPrompt`/`emitUiPromptEvent` emission; `formatForwardedPermissionPrompt` stays (message construction).
- `src/permission-forwarding.ts` — reword the `ForwardedPromptDisplay` doc comment (parent reconstructs the event via the ask's details / `buildUiPrompt`, not `buildForwardedUiPrompt`).
- `src/index.ts` — construction reorder + `servingPolicy` adapter + new `requestServerDeps`; `isYoloModeEnabled` import stays (still used by the yolo command wiring at line 78).
- `docs/cross-extension-api.md` — one sentence in the `permissions:ui_prompt` section: a forwarded request the parent's recorded policy decides (`allow`/`deny`) emits no prompt event; the event fires only when the human is about to be asked.
  The existing "Forwarded prompts are not degraded" paragraph stays true verbatim.
- `docs/decisions/0005-serving-authorizer-provenance.md` — **new** ADR: provenance-as-data decision, rejected alternatives, base-agent-scope, missing-fields/version-skew floor, single-surface fidelity limitation, post-ship validation pointer to [#565] (next free number after 0004).
- `docs/architecture/architecture.md` — module tree: `forwarded-request-server.ts` entry (serving = resolve + escalate; deps), `local-user-authorizer.ts` entry (single emit site, provenance rendering), `permission-ui-prompt.ts` entry (`buildUiPrompt`), `index.ts`/composition notes if the tree names construction order; target-model narrative line ~497 ("serving is not yet rebuilt" → landed); roadmap Step 3 `✅` heading + Mermaid `S3` node; metrics-table rows stay (target table convention, Phase 9 incomplete).
- `.pi/skills/package-pi-permission-system/SKILL.md` — grep confirmed: no forwarded-serving, yolo-check, or ui-prompt-builder mentions; no edit expected (re-verify at implementation time).

Expected fallow deltas: `processSingleForwardedRequest` leaves the largest-functions list (117 → < 60 lines via the dialog/emission body moving out); no new dead code (`buildForwardedUiPrompt`/`ForwardedPromptInput` are removed in the same step as their last consumer).

## Test Impact Analysis

New unit tests enabled:

1. `test/authority/forwarded-request-server.test.ts` — the server is now testable **without UI/dialog stubs**: policy-stub `allow` → approved response written, escalator never called, `forwarded_permission.auto_approved` logged; `deny` → denied response, `auto_denied`; `ask` → escalated with details carrying `forwarding`/`surface`/`value`/`source`-default; missing display fields → escalates without a policy call; escalator rejection → denied response (try/catch preserved); canary warning fires on a mismatched `parentSessionId` and stays silent for an unregistered (external file-based) requester.
2. `test/authority/local-user-authorizer.test.ts` — **the [#292] invariant pin**: forwarded-provenance details emit a populated `forwarding`, the original `source`/`surface`/`value`, and the `"(Subagent)"` title; direct details emit `forwarding: null` with derived projection and the plain title (byte-compatible with today's assertions).
3. `test/permission-ui-prompt.test.ts` — `buildUiPrompt` override-vs-derive semantics, including `surface: null` explicit override vs `surface: undefined` fallback.

Redundant / migrated tests:

- `test/authority/forwarded-request-server.test.ts` — yolo-mode cases (mocking `isYoloModeEnabled`) become policy-stub `allow` cases; the ui-prompt-emission assertions move to the `LocalUserAuthorizer` suite; dialog-invocation assertions become escalator-call assertions; the `!ctx.hasUI` early-return case is deleted (guard removed; `ForwardingManager` owns the gate, already pinned in `test/forwarding-manager.test.ts`).
- `test/permission-ui-prompt.test.ts` — `buildForwardedUiPrompt` cases (version-skew `source` default, null-field handling) are re-expressed against `buildUiPrompt` + the server's `buildForwardedAskDetails` mapping; none are dropped silently.

Tests that must stay (exercise preserved layers):

- Inbox mechanics in the server suite: target-session mismatch cleanup, unreadable-request deletion, responses-dir defensive recreation ([#398]), response-write failure path, empty-location cleanup.
- `test/authority/permission-prompter.test.ts` — bracketing order and marker handling, untouched.
- `test/forwarding-manager.test.ts` — the polling gate (`hasUI && !isSubagent`), now the sole owner of that predicate.

## Invariants at Risk

- **[#292] forwarded-prompt fidelity** (`docs/cross-extension-api.md`; roadmap Step 3 invariant line) — previously pinned only via the server suite's emission assertions, which this change deletes.
  Re-pinned by the new `LocalUserAuthorizer` forwarded-details test **plus** the server test asserting escalated details carry the original display fields — together they compose to the same end-to-end guarantee.
- **[#555] `LocalUserAuthorizer` emits the event before the dialog; `Denying`/`ParentAuthorizer` never emit** — pinned by the existing authorizer suites; the rendering change keeps emit-then-dialog order.
- **[#556] uniform escalation bracketing** (`waiting` before authorize, marker-driven `confirmation_unavailable`) — untouched code; forwarded asks now flow through it, extending rather than altering the invariant.
- **[#398] responses-dir defensive recreation** — the `processInbox` drain loop structure is preserved; the existing test stays green.
- **Escalation requires an activated selection** — `AskEscalator.escalate` rejects when no `Authorizer` has been selected (`selected === null`), and the server's `try`/`catch` maps a rejection to a *denied* response.
  A poll that ran before `session.activate` would therefore silently deny an approvable forwarded request.
  Satisfied today: `PermissionSession.activate(ctx)` calls `authorizerSelection.activate(ctx)`, and inbox polling only begins at `session_start` (via `session.activate`), so selection is always bound before the first drain.
  Pinned by the server suite's escalation cases (which activate before polling) plus the existing `permission-session.test.ts` activate-order coverage — a reorder that broke it would fail those, not just surface at runtime.
- **[#526]/[#527] yolo-as-ruleset** (deny-preserving rewrite, `origin: "yolo"`) — serving now *relies* on it: under yolo, a forwarded request matching an explicit `deny` is now denied where the old bespoke check approved it.
  This is the intended alignment with documented yolo semantics ("suppresses prompts but preserves hard denies"), called out in the `feat:` commit body.

## TDD Order

1. **Provenance rendering (additive; direct behavior unchanged).**
   Red→green: `permission-ui-prompt.test.ts` drives `buildUiPrompt` (override-or-derive, forwarding passthrough) with `buildDirectUiPrompt` kept temporarily as a one-line alias so nothing else breaks; `local-user-authorizer.test.ts` drives the `forwarding`-keyed title + non-degraded event; `PromptPermissionDetails` gains the three fields.
   Production still never sets them — unreachable until step 2 (lift-and-shift).
   Commit: `refactor(pi-permission-system): render forwarded provenance through LocalUserAuthorizer`.
2. **Rebuild the server on policy + escalator (atomic: deps swap fans out to the constructor, index.ts, and the server suite at the type level).**
   Red→green in `forwarded-request-server.test.ts` per Test Impact Analysis: swap `ForwardedRequestServerDeps`, implement resolve-then-escalate + `buildForwardedAskDetails` + canary, drop the `hasUI` guard and yolo/emission/dialog code; rewire `index.ts` (construction reorder + `servingPolicy` adapter).
   Remove `buildForwardedUiPrompt`/`ForwardedPromptInput` and the transitional `buildDirectUiPrompt` alias in the same commit (their last consumers die here; export removal folds consumer updates in — including re-pointing `local-user-authorizer.ts` at `buildUiPrompt` if the alias was used); reword the `ForwardedPromptDisplay` doc comment.
   Run `pnpm run check` and the full package suite immediately after.
   Commit: `feat(pi-permission-system): serve forwarded permissions by resolution and Authorizer escalation (#557)`.
3. **Decision record.**
   Write `docs/decisions/0005-serving-authorizer-provenance.md` (decision, alternatives, accepted limitations, [#565] pointer).
   Commit: `docs(pi-permission-system): record serving-provenance decision (ADR-0005)`.
4. **Docs + roadmap completion.**
   `architecture.md` (tree entries, narrative line ~497, Step 3 `✅` + Mermaid `S3`), `cross-extension-api.md` sentence, SKILL.md re-verify (expected no-op).
   Commit: `docs(pi-permission-system): mark Phase 9 Step 3 complete`.

## Risks and Mitigations

- **Silent contract regression (the reason this plan exists).**
  The [#292] fidelity invariant is now written into the roadmap step, pinned by two composing tests (authorizer emission + server details mapping), and the pre-completion reviewer checks cross-step invariants against documented outcomes.
- **Yolo behavior shift for forwarded denies and legacy requests.**
  Explicit `deny` now wins under yolo (documented yolo semantics; previously the bespoke check approved everything), and field-less legacy requests prompt instead of yolo-approving.
  Both fail toward safety; both are named in the `feat:` commit body and ADR-0005 so the release notes carry them.
- **Deferred `session.getPathNormalizer()` read in the `servingPolicy` adapter.**
  A pre-`session_start` call would throw on the unassigned `session`; mitigated by the polling lifecycle (starts at `session_start`) and the existing composition-root precedent (logger `notify` sink), with the same explanatory comment; the server suite injects its own policy stub so tests cannot mask a wiring mistake — verify once manually in a live parent/child session before ship.
- **Review-log shape changes for forwarded asks** (added `permission_request.*` bracketing, new `auto_denied`).
  Deliberate ([#556]'s uniformity decision extended); recorded in the Design Overview and the ADR; no known consumer parses the review log programmatically.
- **Double review-entry volume could obscure the serving lifecycle.**
  Accepted: the `forwarded_permission.*` entries keep the serving lifecycle greppable on their own; revisit only if real log reading proves noisy ([#565] check 3 will surface it).
- **Inbox drain still serializes on the human response.**
  Routing the `ask` through the `AskEscalator` seam does not change the drain's concurrency: an escalated forwarded request `await`s the human dialog inside the drain, exactly as the old direct `requestPermissionDecisionFromUi` call did, and `ForwardingManager`'s `processing` lock already forbids overlapping drains.
  Not a new concurrency change — the UI surface and the one-dialog-at-a-time serialization are identical before and after; a reviewer should read the escalator swap as behavior-neutral here.

## Open Questions

None blocking — the three design forks (fidelity-preserving threading vs. re-degrade, base vs. requester agent scope, roadmap amendment scope) were resolved at the Decide gate, and the roadmap amendment landed in `21472cf9`.
Post-ship validation of the recorded decisions is tracked in [#565].

[#292]: https://github.com/gotgenes/pi-packages/issues/292
[#398]: https://github.com/gotgenes/pi-packages/issues/398
[#472]: https://github.com/gotgenes/pi-packages/issues/472
[#526]: https://github.com/gotgenes/pi-packages/issues/526
[#527]: https://github.com/gotgenes/pi-packages/issues/527
[#555]: https://github.com/gotgenes/pi-packages/issues/555
[#556]: https://github.com/gotgenes/pi-packages/issues/556
[#558]: https://github.com/gotgenes/pi-packages/issues/558
[#559]: https://github.com/gotgenes/pi-packages/issues/559
[#565]: https://github.com/gotgenes/pi-packages/issues/565
