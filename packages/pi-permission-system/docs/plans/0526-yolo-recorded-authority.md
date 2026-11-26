---
issue: 526
issue_title: "pi-permission-system: move yolo into recorded authority (composition-stage ask→allow rewrite)"
---

# Move yolo into recorded authority (composition-stage ask→allow rewrite)

## Release Recommendation

**Release:** mid-batch — defer (batch "yolo-recorded-authority"); confirm at ship time

This is Phase 8 Step 2, the first member of the `yolo-recorded-authority` release batch (Steps 2, 3; tail = Step 3 / [#527]).
Step 2 relocates the yolo decision with observable review-log/decision-event field changes; Step 3 is its cleanup.
The batch ships together when Step 3 lands, so this issue leaves the release-please PR open.

## Problem Statement

yolo mode is smeared across the prompt path.
`shouldAutoApprovePermissionState` is checked in `PermissionPrompter.prompt` and again in the forwarded-inbox serve arm, and `canResolveAskPermissionRequest`'s yolo arm sits in `PromptingGateway.canConfirm()` — three modules know about yolo on the decision path.
The architecture "yolo is recorded authority" section (since replaced by [Auto-approve is a terminal](../architecture/architecture.md#auto-approve-is-a-terminal)) names yolo as a standing authorization that belongs in the ruleset, not the prompt path.
This step delivers that framing: yolo becomes a composition-stage rewrite over the composed ruleset — every `ask` action becomes `allow`, tagged `origin: "yolo"` — so `evaluate()` is the single yolo decision point.
It is a preparatory step ahead of the full authority spine (Phase 9); it does not build the spine.

## Goals

- Apply the yolo rewrite over the composed ruleset at check time in `PermissionManager.check`, keyed off an injected yolo reader.
  Every matched `ask` rule (including the synthesized universal default) resolves to `allow` tagged `origin: "yolo"`; explicit `deny` passes through untouched (yolo suppresses prompts but preserves hard denies).
- Add `"yolo"` to `RuleOrigin` (additive) and keep the architecture doc's inline `Rule`/`RuleOrigin` listing in sync.
- Preserve review-log and decision-event parity: a yolo-origin `allow` derives resolution `auto_approved`, and the gate runner writes the `permission_request.auto_approved` review-log entry.
- Keep display unchanged: `getComposedConfigRules` / `/permission-system show` and `getToolPermission` keep showing the configured actions, not the rewrite.
- Leave the prompter and gateway yolo arms physically present but unreachable (their removal is [#527]).

This change is **not breaking** in the semver sense — behavior parity holds (a yolo `ask` still auto-approves).
The `origin: "yolo"` value is additive.
Observable review-log/decision-event *field* values change (a yolo grant now carries `origin: "yolo"` and resolves via the composed ruleset), which is why the batch ships as a real (non-hidden) release rather than a test-only change.
Suggested commit type: `feat(pi-permission-system):`.

## Non-Goals

- Deleting the dead prompter/gateway yolo arms and dissolving `yolo-mode.ts` — that is Phase 8 Step 3 ([#527]).
  After this step those arms are unreachable but still compiled; their yolo tests stay green until [#527] removes them.
- The forwarded-inbox serve-arm yolo check (`PermissionForwarder.processInbox`) — it survives Phase 8 and dissolves when serving becomes resolution (Phase 9).
- Threading `origin: "yolo"` through the skill sanitizer → `SkillPromptEntry` → skill-read `preResolved` chain.
  Under yolo the skill sanitizer already resolves a skill's state to `allow` via the yolo-aware `check`, so a skill-read auto-allows with `origin: "builtin"` and logs `policy_allow` rather than `auto_approved`.
  This is an accepted parity nuance (confirmed with the operator): no prompt, no regression, just a diagnostic-label difference for skill-reads.
- The authority spine itself (the `Authorizer` interface, `canConfirm()` dissolution, serving-as-resolution) — Phase 9.

## Background

Relevant modules and how they relate:

- `src/rule.ts` — `RuleOrigin` union, `Rule`/`Ruleset` types, and the pure `evaluate*` functions.
  Home for a new pure `rewriteAsksToYolo(rules)` helper.
- `src/permission-manager.ts` — `PermissionManager implements ScopedPermissionManager`.
  `check(intent, sessionRules?)` is the single resolution entry point ([#478]): it calls `resolvePermissions(agentName)` (cached, keyed by `agentName` + loader stamp), composes `fullRules = [...composedRules, ...sessionRules]`, and delegates to `buildCheckResult`.
  `getComposedConfigRules` and `getToolPermission` read the cache directly and are the display/injection surfaces that must stay yolo-free.
  Constraint (ADR-0002, [#506]): the manager stays string-based and must not import `AccessPath` — a `no-restricted-imports` lint rule guards `permission-manager.ts`.
  `rewriteAsksToYolo` operates on a `Ruleset` (strings only), so it does not breach the boundary.
- `src/permission-resolver.ts` — `PermissionResolver.resolve` / `checkPermission` both delegate to `manager.check`, so every gate, the skill sanitizer, and the cross-extension service/RPC route through the manager (and thus the yolo rewrite).
- `src/handlers/gates/runner.ts` — `GateRunner.runDescriptor` is the single choke point every tool-call and skill-input gate passes through (`ToolCallGatePipeline` and `SkillInputGatePipeline` both call `runner.run`).
  It already has a session-hit fast-path; the yolo fast-path mirrors it.
- `src/handlers/gates/helpers.ts` — `deriveResolution` maps `(state, action, hasSession, canConfirm, autoApproved)` to a `PermissionDecisionResolution`.
  Its `state === "allow"` branch currently returns `policy_allow` unconditionally.
- `src/index.ts` — composition root; `configStore` and `session` are forward-declared `let`s so lazy thunks can close over them.
  `PermissionManager` is constructed before `configStore` is assigned (the store depends on the manager for `policyPaths`).
- `src/yolo-mode.ts` — `isYoloModeEnabled(config)` reads `config.yoloMode`.
  Stays here for this step ([#527] moves it into `extension-config.ts`).

AGENTS.md / skill constraints that apply:

- The architecture doc inline-copies `Rule`/`RuleOrigin`; adding a field to `RuleOrigin` must update that listing (a module-move check misses it).
- Mark the completed roadmap step ✅ (heading + Mermaid node) in the implementation doc-update commit, not a deferred ship commit.
- The manager stays string-based (ADR-0002); no `AccessPath` import.

## Design Overview

### 1. yolo rewrite in the manager (single decision point)

Add a pure helper to `rule.ts`:

```typescript
/** Rewrite every `ask` rule to `allow` tagged `origin: "yolo"`; deny/allow pass through. */
export function rewriteAsksToYolo(rules: Ruleset): Ruleset {
  return rules.map((rule) =>
    rule.action === "ask" ? { ...rule, action: "allow", origin: "yolo" } : rule,
  );
}
```

Inject an optional yolo reader into the manager and apply the rewrite **post-cache**, inside `check()` only:

```typescript
// PermissionManagerOptions gains:
isYoloEnabled?: () => boolean;   // defaults to () => false

// inside check(), after composing fullRules and before buildCheckResult:
const rules = this.isYoloEnabled() ? rewriteAsksToYolo(fullRules) : fullRules;
```

Why post-cache (in `check`), not inside `resolvePermissions`:

- The `resolvedPermissionsCache` is keyed by `agentName` + loader stamp, not yolo state.
  Applying the rewrite to the cached `composedRules` would pollute `getComposedConfigRules` and `getToolPermission`, breaking the display-unchanged goal.
  Rewriting `fullRules` per-call keeps the cache yolo-free and touches only the resolution path.
- The synthesized universal default (`{ surface: "*", pattern: "*", action: "ask", layer: "default" }` from `synthesizeDefaults`) is part of `composedRules`, so an unmatched surface under yolo is rewritten too — no separate default-fallback handling needed.
- The rewrite preserves each rule's `layer` and `pattern`, so `buildCheckResult`'s `matchedPattern` derivation (`config`/`session` layers only) and `deriveSource` are unaffected; only `origin` changes to `"yolo"` and `action` to `"allow"`.

Consumer call-site sketch (`index.ts`), following the existing `getConfig: () => configStore.current()` forward-declared-closure pattern:

```typescript
const permissionManager = new PermissionManager({
  agentDir,
  platform: hostPlatform,
  isYoloEnabled: () => isYoloModeEnabled(configStore.current()),
});
```

The closure captures the forward-declared `configStore` and is only invoked at check time (after assignment), so no TDZ read occurs.
To keep the reference textually after the `let configStore` declaration, relocate the `new PermissionManager(...)` call to just below the forward declarations (it has no earlier consumer); `configStore = new ConfigStore({ policyPaths: permissionManager, ... })` still follows it.

The manager gains no dependency on config types — it holds only a `() => boolean`, keeping yolo knowledge out of the string-based manager (DIP).

### 2. Resolution + review-log parity in the runner

Extend `deriveResolution` so a yolo-origin allow maps to `auto_approved` (the mapping stays centralized in `helpers.ts`):

```typescript
if (state === "allow") return autoApproved ? "auto_approved" : "policy_allow";
```

Existing callers pass `autoApproved` defaulting to `false`, so `policy_allow` is unchanged for a normal allow.

Add a yolo fast-path to `GateRunner.runDescriptor`, placed right after the session-hit fast-path (mirroring its shape):

```typescript
// Composition-stage ask→allow rewrite records origin "yolo" on the matched
// rule. Auto-approve without prompting; preserve today's single
// auto_approved review entry + decision event.
if (check.state === "allow" && check.origin === "yolo") {
  this.reporter.writeReviewLog("permission_request.auto_approved", {
    ...descriptor.logContext,
    agentName,
    resolution: "auto_approved",
  });
  this.reporter.emitDecision(
    buildDecisionEvent(
      descriptor.decision,
      check,
      agentName,
      "allow",
      deriveResolution(check.state, "allow", false, false, true),
    ),
  );
  return { action: "allow" };
}
```

Review-log entry shape (confirmed with operator): the runner writes `{ ...descriptor.logContext, agentName, resolution: "auto_approved" }`, consistent with the runner's `session_approved`/`blocked` entries.
This carries `toolCallId` (not the prompter's `requestId`); the same event name (`permission_request.auto_approved`) is still emitted.
The decision-event channel keeps exact field parity via `buildDecisionEvent`, with `origin` now `"yolo"` for a yolo grant (the intended, batch-acknowledged field change).

Because both `ToolCallGatePipeline` and `SkillInputGatePipeline` funnel through `runner.run`, this one fast-path covers tool, bash, mcp, path, external_directory, and skill-input surfaces uniformly.
The prompter's yolo arm becomes unreachable: under yolo no manager-resolved check returns `ask`, and the skill-read `preResolved` state is already `allow` (resolved by the yolo-aware sanitizer), so no `ask` reaches `applyPermissionGate`'s prompt branch.

### Edge cases

- **Explicit deny under yolo** — `deny` is not `ask`, so it passes through the rewrite; the runner's normal deny path emits `policy_deny`.
  Hard denies survive yolo.
- **Session rules** — the rewrite runs over `fullRules` (composed ∪ session), so a hypothetical session `ask` is also rewritten; session `allow` approvals are unaffected.
- **Cross-extension service/RPC queries** — `LocalPermissionsService` and the event-bus RPC route through `PermissionResolver` → `manager.check`, so under yolo they answer `allow` (origin `yolo`) instead of `ask`.
  This is consistent with "yolo is recorded authority" (under yolo the effective policy *is* allow) and is called out in Risks.
- **Skill-read `preResolved`** — resolves to `allow` (origin `builtin`) via the yolo-aware sanitizer and logs `policy_allow`; see Non-Goals.

## Module-Level Changes

- `src/rule.ts` — add `"yolo"` to the `RuleOrigin` union (update the doc comment's provenance grouping to note yolo as a composition-stage rewrite origin); add exported `rewriteAsksToYolo(rules: Ruleset): Ruleset`.
- `src/permission-manager.ts` — add `isYoloEnabled?: () => boolean` to `PermissionManagerOptions`; store it (default `() => false`); apply `rewriteAsksToYolo(fullRules)` in `check()` when enabled; import `rewriteAsksToYolo` from `./rule`.
  No change to `resolvePermissions`, `getComposedConfigRules`, or `getToolPermission`.
- `src/index.ts` — pass `isYoloEnabled: () => isYoloModeEnabled(configStore.current())` to `PermissionManager`; relocate the `new PermissionManager(...)` call below the `let configStore` forward declaration; import `isYoloModeEnabled` from `./yolo-mode`.
- `src/handlers/gates/helpers.ts` — `deriveResolution`: `state === "allow"` returns `auto_approved` when `autoApproved`, else `policy_allow`.
- `src/handlers/gates/runner.ts` — add the yolo fast-path in `runDescriptor` after the session-hit fast-path.
- `test/helpers/manager-harness.ts` — thread an optional `isYoloEnabled` (or `yolo: boolean`) through the relevant factory (`createManagerWithConfig` / `createManager`) so manager tests can build a yolo-enabled manager.
  Default off — existing callers unaffected.
- `test/rule.test.ts` — unit tests for `rewriteAsksToYolo`.
- `test/permission-manager-*.test.ts` (new or existing manager suite) — yolo rewrite behavior + display-unchanged assertions.
- `test/handlers/gates/helpers.test.ts` — `deriveResolution` yolo case.
- `test/handlers/gates/runner.test.ts` — yolo fast-path behavior.
- `docs/architecture/architecture.md` — update the inline `RuleOrigin` listing (add `| "yolo"` and the comment note); mark Step 2 (#526) ✅ on the step heading and the `S2` Mermaid node.

Docs verified as **not** needing change in this step:

- `docs/cross-extension-api.md` — already documents `auto_approved` ("Yolo mode — approved automatically without dialog") and that it does not emit a `ui_prompt` event.
  Still accurate.
- `docs/architecture/permission-prompter.md` — describes the prompter's yolo arm, which still physically exists after this step (unreachable).
  Its update rides with [#527] when the arm is deleted.
- `README.md` — no `/permission-system` command surface change; grepped for `yolo`/`auto_approved` — no stale command docs.

The "yolo checks on the ask path" health-metric row (Phase 7 close = 3 → target = 1) is **not** flipped in this step: the composition-stage rewrite lands (the 1), but the prompter/gateway arms are removed only in [#527], so the count is not yet reducible.
Leave the metric row for the batch tail.

## Test Impact Analysis

1. **New unit tests enabled by the change:**
   - `rewriteAsksToYolo` as a pure ruleset transform (ask→allow+yolo, deny/allow pass-through, layer/pattern preserved) — previously the yolo decision was an inline boolean in the prompter with no pure seam.
   - `PermissionManager.check` under a yolo reader: an `ask`-resolving intent returns `allow` + `origin: "yolo"`; a `deny` intent stays `deny`; `getComposedConfigRules`/`getToolPermission` still report the configured `ask` (display-unchanged).
   - `GateRunner` yolo fast-path: `allow` + `origin: "yolo"` writes one `permission_request.auto_approved` review entry, emits `auto_approved` with `origin: "yolo"`, and never calls the prompter.
   - `deriveResolution("allow", "allow", false, _, true) === "auto_approved"`.

2. **Tests that become redundant:** none in this step.
   The prompter's yolo tests (`test/permission-prompter.test.ts`) and the handler `auto_approved`-via-prompt tests (`tool-call-events.test.ts`, `input-events.test.ts`) still exercise code that physically exists.
   They are removed/retargeted in [#527] when the prompter arm is deleted.

3. **Tests that must stay as-is:**
   - `test/permission-prompter.test.ts` yolo-mode block — the arm is present (unreachable) until [#527].
   - `test/handlers/{tool-call-events,input-events}.test.ts` `auto_approved` tests — they mock the prompt to return `autoApproved: true`, exercising the runner's `decision.autoApproved` handling, which persists.
   - `test/permission-manager-unified.test.ts` — the shared manager fixtures ([#525]) must stay green after the `manager-harness` extension.

## Invariants at risk

This change touches surfaces earlier Phase 6–8 steps refactored:

- **[#478] single resolution entry point** — `ScopedPermissionManager.check` is the one method.
  The yolo rewrite lives inside `check`, adding no second method.
  Pinned by the existing manager-unified suite and `makeFakePermissionManager`'s single `check` stub.
- **[#506] ADR-0002 string boundary** — `permission-manager.ts` must not import `AccessPath`.
  `rewriteAsksToYolo` is a `Ruleset` transform (strings only).
  Pinned by the `no-restricted-imports` lint rule on the file (`pnpm run lint`).
- **[#525] manager-harness fixtures** — extending the harness with an optional yolo reader must not regress the extracted factories.
  Pinned by `test/permission-manager-unified.test.ts`.
- **Display-unchanged** — `getComposedConfigRules` / `getToolPermission` report configured actions.
  Add an explicit test asserting these return `ask` even when the injected yolo reader is `true` (the invariant lives only in prose otherwise).

## TDD Order

1. **`rewriteAsksToYolo` + `RuleOrigin` (`rule.ts`).**
   Red: `test/rule.test.ts` — `rewriteAsksToYolo` maps `ask`→`allow` with `origin: "yolo"`, passes `deny`/`allow` through unchanged, and preserves `layer`/`pattern`/`surface`.
   Green: add `"yolo"` to `RuleOrigin`; implement `rewriteAsksToYolo`.
   Commit: `feat(pi-permission-system): add yolo rule origin and ask→allow rewrite helper`.

2. **yolo rewrite in `PermissionManager.check` + `index.ts` wiring.**
   Red: manager suite — with `isYoloEnabled: () => true`, a would-be-`ask` `check` returns `allow` + `origin: "yolo"`; a `deny` stays `deny`; `getComposedConfigRules` and `getToolPermission` still report `ask`.
   Extend `manager-harness` to build a yolo-enabled manager.
   Green: add `isYoloEnabled` to `PermissionManagerOptions`; apply `rewriteAsksToYolo(fullRules)` in `check()`; wire the reader in `index.ts` (relocate the manager construction below the `configStore` forward declaration).
   Run `pnpm run check` (options-interface change with a single call site in `index.ts`).
   Commit: `feat(pi-permission-system): rewrite ask rules to yolo-origin allow at check time`.

3. **`deriveResolution` yolo mapping + `GateRunner` fast-path.**
   Red: `helpers.test.ts` — `deriveResolution("allow","allow",false,false,true)` → `"auto_approved"` (existing `policy_allow` case unchanged).
   `runner.test.ts` — `resolveResult: allow` + `origin: "yolo"` writes `permission_request.auto_approved`, emits `auto_approved` with `origin: "yolo"`, returns `allow`, and does not prompt.
   Green: extend `deriveResolution`'s allow branch; add the runner yolo fast-path.
   Commit: `feat(pi-permission-system): auto-approve yolo-origin allow in the gate runner`.

4. **Docs sync + roadmap completion.**
   Update `architecture.md`'s inline `RuleOrigin` listing (add `| "yolo"` and the comment note); mark Step 2 (#526) ✅ on the heading and the `S2` Mermaid node.
   No red/green (docs-only).
   Commit: `docs(pi-permission-system): record yolo origin and mark Phase 8 Step 2 complete`.

## Risks and Mitigations

- **Cross-extension policy queries change under yolo.**
  `PermissionsService` / RPC now answer `allow` (origin `yolo`) for a would-be-`ask` surface when yolo is on.
  Mitigation: this is the intended "recorded authority" semantics (the effective policy under yolo *is* allow).
  Documented here; no consumer in-repo asserts an `ask` answer under yolo.
- **Skill-read logs `policy_allow` under yolo, not `auto_approved`.**
  Accepted parity nuance (operator-confirmed).
  No prompt and no regression — only a diagnostic label difference.
  Documented in Non-Goals.
- **Intermediate-commit review-log gap.**
  Between Step 2 and Step 3, a yolo grant would resolve to `allow` but log `policy_allow` (Step 3 restores `auto_approved`).
  Mitigation: no existing test asserts the production-yolo→auto_approved path at the manager level (the handler auto_approved tests mock the prompt and do not wire the manager's yolo reader), so each commit stays green; Step 3 immediately follows.
- **Forgetting the inline `RuleOrigin` doc update.**
  Mitigation: Step 4 is an explicit, required step; the pre-completion reviewer backstops it.

## Open Questions

None.
The two observable-output forks (review-log entry shape; skill-read reporting) were resolved with the operator during planning — runner `logContext` convention and accept `policy_allow` for skill-reads, respectively.
