---
issue: 1118
issue_title: "pi-permission-system: replace yolo with auto-approve, a terminal after the authorizer chain"
---

# Auto-approve replaces yolo as a terminal after the authorizer chain

## Release Recommendation

**Release:** ship independently

The Phase 16 roadmap tags this step `Release: independent`, and its `Release batches` subsection says there is no batch.
It is a `feat!:` release: the `yoloMode` key stops being read, the published `"yolo"` origin value is removed, and chain links now see asks that yolo used to hide.
The preparatory `test:`/`refactor:` steps cut no release.

## Problem Statement

Yolo rewrites every `ask` to `allow` before the authorizer chain runs, at three sites: `rewriteAsksToYolo` at composition (`PermissionManager.check`), `resolveYoloGrant` at `GateRunner`'s fast path for asks synthesized after resolution, and `honorChildFloor`'s yolo arm at a serving node.
So no authorizer link ever sees an ask under yolo; in [#799]'s second comment, the reviewer link received nothing for six hours.
Its only setter is the `yoloMode` config key, which the `/permission-system` modal writes to the global file, so one session's toggle reaches every running session.

ADR 0016 §5 (`docs/decisions/0016-policy-channels.md`, status accepted) decided the replacement: **auto-approve**, a terminal the mirror of `DenyingAuthorizer`, selected per session, reached after the links, set in memory by an in-session command or the `--auto-approve` launch flag, and scoped at a serving node by requester ([#1031]).

## Goals

- An ask every configured link defers is allowed by the auto-approve terminal instead of prompted, when this session's auto-approve covers it; links run first and see every ask.
- A `deny` (rule or link) is never overridden: a rule deny decides before escalation, and the terminal only answers what reaches it.
- Setters, both in memory for this session or process:
  - `--auto-approve`, a boolean launch flag registered with `pi.registerFlag()`, read at `session_start` (the loader fills flag values after the factory runs), covering `own` and `forwarded` asks;
  - `/permission-system:auto-approve`, a command that turns on or off one scope at a time: `own` asks, `forwarded` asks, or `agent <name>` (one requesting agent); the `/permission-system` modal's toggle drives the same state.
- A headless node (no UI) serves its subagents' forwarded asks while its auto-approve covers them, so `pi -p --auto-approve` with subagents keeps working (operator decision).
- The review log attributes each grant to its setter: `decidedBy: { kind: "auto_approve", setter: "flag" | "command", scope: "own" | "forwarded" | "agent" }` (ADR 0016 K5); the `permissions:decision` event keeps `resolution: "auto_approved"`.
- The `yoloMode` key is no longer read; a config that sets it is warned "no longer read; use `--auto-approve` or `/permission-system:auto-approve`", and is **not** rejected.
- The status bar shows `auto-approve` while any scope is on.
- **Breaking** (`feat(pi-permission-system)!:` with a `BREAKING CHANGE:` footer):
  - `yoloMode` stops taking effect on upgrade, with no user edit;
  - the `"yolo"` value leaves `RuleOrigin` and the decision event's `origin` field with **no replacement** (operator decision): an auto-approved ask reports the origin of the rule that asked, exactly as a human approval does, and the decider lives on `decidedBy`;
  - chain links now receive asks under auto-approve;
  - `PermissionsService` queries answer `ask` where yolo made them answer `allow`;
  - the review log records an auto-approval as `permission_request.waiting` + `permission_request.approved` (`decidedBy` above) instead of one `permission_request.auto_approved` entry, and a served forwarded ask as `forwarded_permission.prompted` + `forwarded_permission.approved` instead of `forwarded_permission.auto_approved` with `origin: "yolo"`.
- Ride-alongs named by the roadmap step: issue [#868] (the `authorizerChain` element's schema description) and a `bootExtension` helper replacing the 80 `as unknown as ExtensionAPI` casts in `test/composition-root.test.ts` (measured: `grep -c 'as unknown as ExtensionAPI'` printed 80; the roadmap's 79 predates a later test).

## Non-Goals

- Unrestricted mode, the deny-overriding operation ([#1119], ADR 0016 §6); it reuses this step's flag and command plumbing.
- Self-protection, including making an agent's bash launch of `pi --auto-approve` an `ask` ([#1121]).
- Channel attribution beyond `decidedBy`'s setter ([#1124]).
- Renaming `/permission-system` or the modal into the namespace ([#1103]); this step registers only its own command there.
- Rejecting a config that still sets `yoloMode`: it stays schema-valid (deprecated), following the `toolInputPreviewMaxLength` precedent, because a rejected global file becomes an empty scope.
- Removing `yoloMode` from an existing file on `reset` or a knob save; the warning tells the operator to remove it.
- Auto-approve at a relaying node: ADR 0016 §5 sets it at the serving node, so a node whose terminal relays never consults its own auto-approve (it records why, see Design Overview).
- Persisting auto-approve across `/new`, `/resume`, or `/reload`: the command's state lives in the factory closure and resets; the flag is re-read at every `session_start`.
- The `forwarded_permission.prompted` event name for an ask a terminal answers without a human; renaming review-log events is out of scope.
- Fixing Pi's CLI parse that lets a boolean extension flag swallow the next positional argument (see Risks); this step documents the safe spellings.

## Background

- **Authority spine.**
  `AuthorizerSelection` (`src/authority/authorizer-selection.ts`) runs `selectAuthorizer` once per activation and composes `composeAuthorizerChain(links, authority.terminal, …)` per ask in `escalate`.
  `SelectedAuthority.adjudicatesLocally` is false for a relaying node, which resolves no links (ADR 0007 §7).
  `DenyingAuthorizer` (`src/authority/denying-authorizer.ts`) is the 25-line terminal this one mirrors.
- **Serving.**
  `ForwardedRequestServer.resolveDecision` resolves a forwarded intent through `ServingPolicy`; an `ask` escalates through the same `AuthorizerSelection`, with `details.forwarding` carrying `requesterAgentName`/`requesterSessionId` (`buildForwardedAskDetails`).
  That provenance is what the `forwarded` and `agent` scopes read.
- **Serving eligibility** is `hasUI` alone (`ForwardingManager.start`, `src/authority/forwarding-manager.ts`; documented in `docs/architecture/architecture.md` line ~550).
- **Flags.**
  `pi.registerFlag(name, {type, description, default?})` and `pi.getFlag(name)` exist on the pinned Pi 1.0.0 `ExtensionAPI`; CLI values are written into `runtime.flagValues` after the factory runs, and an in-process child's runtime starts with an empty map (`agent-session.js` `_buildRuntime`), so the flag is per process and no child inherits it.
  `reload` carries flag values over (`previousFlagValues`).
- **Status bar.**
  Today `syncPermissionSystemStatus` (`src/config/status.ts`) sets `"yolo"` from config, called by `PermissionSession.refreshConfig` (every `session_start` and `before_agent_start`) and `ConfigStore.save`; `SessionLifecycleHandler.handleSessionShutdown` clears the key.
- **Deprecated-key precedent.**
  `toolInputPreviewMaxLength` stays in `unifiedConfigSchema` with `deprecated: true`, stays in `mergeUnifiedConfigs`' merge loop, and `detectDeprecatedPreviewCaps(merged)` warns (`src/config/config-loader.ts`).
- **Zones.**
  `config/` may not import `authority/` (`.fallowrc.json`), so the modal drives auto-approve through a structural interface declared in `config/`; `authority/` may import `config/` and `session/`.
- **Package skill constraints that apply:** `docs/architecture/architecture.md` inline-copies `RuleOrigin` (update with it); `docs/cross-extension-api.md` documents the event's `origin`/`resolution`; config changes keep schema, example, `docs/configuration.md`, and README aligned; composition-root tests clear the `Symbol.for()` slots and stub `PI_CODING_AGENT_DIR`.
- **Reference implementations.**
  PR [#990] (ReStranger) built a session-scoped `/yolo` toggle over `yoloMode`; issue [#720] (maksimr) asked for the launch flag.
  This plan adopts both mechanisms, renamed and moved after the chain.

## Design Overview

### Flow

```text
gate ─► resolve (recorded authority) ─┬─ allow / deny ──────────────► decided (auto-approve never consulted)
                                      └─ ask (rule, or synthesized floor/sentinel)
                                            └─ AuthorizerSelection.escalate
                                                  ├─ relaying node: no links, ParentAuthorizer
                                                  │     (records auto_approve_delegated when auto-approve would have covered it)
                                                  └─ adjudicating node: links ─defer─► AutoApprovingAuthorizer
                                                                                     ├─ covered → allow, decidedBy auto_approve
                                                                                     └─ not covered → inner terminal (human / Denying)
```

Under the old design the `ask` never left "resolve": the rewrite turned it into `allow` (origin `yolo`), and the gate's 2b fast path caught synthesized asks.

### Data shapes

```typescript
// src/authority/auto-approval.ts
export type AutoApproveSetter = "flag" | "command";
export type AutoApproveScope =
  | { kind: "own" } // an ask raised by this node's own gates (no details.forwarding)
  | { kind: "forwarded" } // any ask a child forwarded here
  | { kind: "agent"; agentName: string }; // a forwarded ask whose requesterAgentName matches

// src/authority/decision-source.ts — replaces { kind: "yolo"; pattern }
| { kind: "auto_approve"; setter: AutoApproveSetter; scope: AutoApproveScope["kind"] }
```

The agent name is not repeated on `decidedBy`: the local record and the forwarded wire both already carry the requesting agent.

### `AutoApproval` (session state) and `AutoApprovingAuthorizer` (terminal)

`AutoApproval` owns one session's scopes, each remembering its setter, keyed `own` / `forwarded` / `agent:<name>`.
It is constructed in the factory with a `readLaunchFlag: () => boolean` thunk over `pi.getFlag("auto-approve")`, so a session switch, which re-invokes the factory, starts it empty.

- `applyLaunchFlag(ctx)` — at `session_start`, when the flag is set, enables `own` and `forwarded` with setter `flag`; then syncs the status bar.
- `enable(scope, ctx)` / `disable(scope | undefined, ctx)` — the command's edits (setter `command`); `disable()` with no scope clears all, including flag-set scopes.
  Each syncs the status bar.
- `grantFor(details): DecisionSource | null` — the coverage decision: an own ask (no `details.forwarding`) matches `own`; a forwarded ask matches `agent:<requesterAgentName>` first, then `forwarded`.
  Pure over its state and the details, so it is unit-tested as a value.
- `answersForwardedAsks(): boolean` — `forwarded` or any `agent` scope is on; the headless-serving reader.
- `isActive()`, `describe()` (the `status` text), and `syncStatus(ctx)` / `clearStatus(ctx)` (`ctx.ui.setStatus(EXTENSION_ID, "auto-approve" | undefined)`, guarded by `hasUI`).

`AutoApprovingAuthorizer implements TerminalAuthorizer` wraps an inner terminal and reads the live state on every `authorize`, so a toggle applies to the next ask:

```typescript
authorize(details) {
  const decidedBy = this.approval.grantFor(details);
  return decidedBy === null
    ? this.inner.authorize(details)
    : Promise.resolve({ approved: true, state: "approved", decidedBy });
}
```

It records no session grant and emits no `permissions:ui_prompt` (no human is asked), matching the documented contract for `auto_approved`.

### Selection

`AuthorizerSelectionConstructorDeps` gains `autoApproval` typed as a narrow role (`grantFor` only).
`escalate` composes the chain over `this.terminalFor(authority, requestId, details)`, a private beside `linksFor`:

- an adjudicating node gets `new AutoApprovingAuthorizer(authority.terminal, autoApproval)`;
- a relaying node keeps `authority.terminal` and, when `grantFor(details)` would have answered, records `auto_approve_delegated` with the request id, mirroring `authorizer_chain_delegated`.

Call site from the consumer's side: `composeAuthorizerChain(this.linksFor(authority, id), this.terminalFor(authority, id, details), query, logger)`.
The selection tells the terminal to authorize; it never asks the approval whether to skip the chain.

### Setters

- `index.ts` registers `pi.registerFlag("auto-approve", { type: "boolean", description })` and `registerAutoApproveCommand(pi, { approval, role: authorizerSelection })` (`src/authority/auto-approve-command.ts`).
- Command grammar: `/permission-system:auto-approve on [own|forwarded|agent <name>]` (bare `on` = `own` + `forwarded`), `off [own|forwarded|agent <name>]` (bare `off` = all), `status` (also the no-argument form; a relaxation is never toggled by a bare command), `help`; an unknown argument prints usage as a warning.
  Argument completions follow `config-modal.ts`'s `getArgumentCompletions`.
  When `role.adjudicatesLocally()` is false, an `on` still records the scope (the role can change at the next activation, #909) and warns that this session relays its asks, so auto-approve applies only while it decides its own.
- `SessionLifecycleHandler` gains an eighth collaborator, a narrow `AutoApproveLifecycle` role (`applyLaunchFlag(ctx)`, `clearStatus(ctx)`).
  `handleSessionStart` calls `applyLaunchFlag(ctx)` **before** `session.resetForNewSession`, so `ForwardingManager.start`, which `resetForNewSession` reaches through `activate`, already sees a flag-set `forwarded` scope.
  `handleSessionShutdown`'s status clear moves onto the role, dropping the handler's `#src/config/status` import.
  A second `pi.on("session_start")` is not an option: `test/session-start.test.ts` pins exactly one registration.
- The modal's yolo row becomes "Auto-approve (this session)", values `on`/`off`, current value `isActive()`; `on` enables `own` + `forwarded`, `off` disables all, both setter `command`.
  It drives `AutoApproval` through `SessionAutoApproveToggle` (declared in `config-modal.ts`; `AutoApproval` `implements` it so fallow's member liveness sees the use).
  `/permission-system show` appends `autoApprove=<describe()>`.

### Headless serving

`ForwardingManagerDeps` gains `servesWithoutUI: () => boolean`, wired to `autoApproval.answersForwardedAsks()`.
`start(ctx)` serves when `ctx.hasUI || servesWithoutUI()`, re-evaluated on every call, so `off forwarded` stops a headless node serving at its next turn event.
It must not read `AdjudicationRole`: `PermissionSession.activate` calls `forwarding.start` before `authorizerSelection.activate`, so the role would be the previous activation's.
A headless root is `DenyingAuthorizer` + `adjudicatesLocally: true`, so its escalation of a forwarded ask reaches `AutoApprovingAuthorizer`; an uncovered forwarded ask (say, `agent reviewer` on and another agent asking) is denied by `DenyingAuthorizer`, as it is answered today when no human is reachable.
The serving node of a headless child is an in-process registry entry or an out-of-process heartbeat; both are published by `ForwardingManager`, so neither channel changes.

### Retiring yolo

- `rewriteAsksToYolo` (`src/policy/rule.ts`), `PermissionManagerOptions.isYoloEnabled` and `YOLO_DISABLED` (`permission-manager.ts`), `resolveYoloGrant` and step 2b (`handlers/gates/helpers.ts`, `runner.ts`), and `honorChildFloor`'s yolo arm with `ResolverServingPolicy`'s `isYoloEnabled` param (`policy/serving-policy.ts`) are deleted; `GateRunner` loses its fifth constructor param.
- A child-raised floor at the serving node now always clamps a rule `allow` to `ask`; the ask then reaches the serving terminal, which auto-approves it when `forwarded` (or the agent) is covered.
- The fail-closed floor (`allow`→`ask`, origin `fail-closed`) is no longer re-permitted at composition; its asks reach the terminal like any other.
- `"yolo"` leaves `RuleOrigin` (no replacement); `{ kind: "yolo" }` leaves `DecisionSource` and its narrowing.
  An older parent never put `{ kind: "yolo" }` on the forwarding wire (its served grants were `{ kind: "rule", origin: "yolo" }`), and an unknown `kind` narrows to `decision: null`, the fail-soft "forwarded" attribution, so no version-skew path is lost.
- `yoloMode` leaves `PermissionSystemExtensionConfig`, `DEFAULT_EXTENSION_CONFIG`, `RUNTIME_KNOB_KEYS`, `runtimeKnobValues`, `normalizePermissionSystemConfig`, and `ConfigStore`'s `config.loaded` debug line; `isYoloModeEnabled` is deleted.
  It **stays** in `unifiedConfigSchema` (`deprecated: true`, descriptions say it is ignored) and in `mergeUnifiedConfigs`' boolean loop, so `detectRetiredYoloMode(merged)` sees it.
- Status: `src/config/status.ts` is deleted; `ConfigStore.save` and `PermissionSession.refreshConfig` stop syncing (status is no longer config-derived); `AutoApproval` owns the key.

### Edge cases stated as behavior (each tested)

| Behavior                                                                                                                  | Step |
| ------------------------------------------------------------------------------------------------------------------------- | ---- |
| A rule `deny` under auto-approve still blocks, for a plain ask and for a wrapper-floored bash command                     | 6    |
| A wrapper-floored and an unparseable bash ask are auto-approved under the flag (the [#712] contract, now at the terminal) | 6    |
| A configured link runs before the terminal and its `deny` stands under auto-approve                                       | 5    |
| A relaying node never auto-approves; it records `auto_approve_delegated`                                                  | 5    |
| An own ask is not covered by `forwarded`; a forwarded ask is not covered by `own`; `agent X` covers only X                | 4    |
| `off` with no scope clears flag-set scopes too                                                                            | 4    |
| A toggle applies to the next ask without re-activation                                                                    | 5    |
| The flag is read at `session_start`, before the forwarding manager starts                                                 | 6, 7 |
| A headless node stops serving after `off forwarded`                                                                       | 7    |
| A config setting `yoloMode: true` is warned and has no effect                                                             | 8    |

## Module-Level Changes

New:

- `src/authority/auto-approval.ts` — `AutoApproval`, `AutoApprovingAuthorizer`, `AutoApproveScope`, `AutoApproveSetter`.
- `src/authority/auto-approve-command.ts` — `registerAutoApproveCommand`, its pure argument parser.
- `test/authority/auto-approval.test.ts`, `test/authority/auto-approve-command.test.ts`.

Changed (`src/`):

- `src/authority/decision-source.ts` — `auto_approve` variant and narrowing; `yolo` variant removed (step 8).
- `src/authority/decision-resolution.ts` — `auto_approve` → `auto_approved`; `yolo` arm removed.
- `src/presentation/agent-renderer.ts` — the never-refuses arm names `auto_approve` instead of `yolo`.
- `src/authority/authorizer-selection.ts` — `autoApproval` dep, `terminalFor`.
- `src/authority/forwarding-manager.ts` — `servesWithoutUI` dep and eligibility.
- `src/handlers/lifecycle.ts` — `AutoApproveLifecycle` collaborator; status-key import removed.
- `src/index.ts` — flag, command, `AutoApproval`, wiring into selection, forwarding manager, lifecycle, modal; `isYoloEnabled` closure and its four consumers removed.
- `src/handlers/gates/runner.ts`, `src/handlers/gates/helpers.ts`, `src/handlers/gates/descriptor.ts` (comment) — yolo fast path removed.
- `src/policy/permission-manager.ts`, `src/policy/rule.ts` (also `floorAllowsToAsk`'s `{@link rewriteAsksToYolo}`), `src/policy/serving-policy.ts`.
- `src/config/extension-config.ts`, `src/config/config-schema.ts` (`yoloMode` deprecated; `authorizerChain` element `.meta` for [#868]), `src/config/config-loader.ts` (`detectRetiredYoloMode`; doc comments), `src/config/config-modal.ts`, `src/config/config-store.ts` (status sync and `yoloMode` debug field and doc removed), `src/session/permission-session.ts` (status sync removed), `src/handlers/session-turn-prep.ts` (comment).
- `src/authority/permission-prompter.ts` and `src/authority/forwarded-request-server.ts` — doc comments naming yolo.
- `src/config/status.ts` — deleted.

Changed (other package files):

- `schemas/permissions.schema.json` (regenerated, never hand-edited), `config/config.example.json` (drop `yoloMode`).

Changed (`test/`):

- `test/helpers/make-fake-pi.ts` (`bootExtension`, `flags` option, `registerFlag`/`getFlag`), `test/composition-root.test.ts`, `test/session-start.test.ts` and `test/service/permission-events.test.ts` (hand-rolled factory fakes gain `registerFlag`/`getFlag`).
- `test/helpers/gate-fixtures.ts` (`yolo`/`isYoloEnabled` overrides), `test/helpers/handler-fixtures.ts` (`yolo` override, `GateRunner` ctor), `test/helpers/external-directory-fixtures.ts` (`GateRunner` ctor), `test/helpers/manager-harness.ts` (`createManagerFromPaths`' `isYoloEnabled`), `test/helpers/authorizer-fixtures.ts` (`makeAuthorizerSelectionDeps`).
- `test/authority/authorizer-selection.test.ts`, `forwarding-manager.test.ts`, `forwarded-request-server.test.ts`, `decision-source.test.ts`, `decision-resolution.test.ts`.
- `test/handlers/gates/runner.test.ts`, `test/handlers/gates/helpers.test.ts`, `test/handlers/lifecycle.test.ts`, `test/handlers/tool-call-events.test.ts`, `test/handlers/input-events.test.ts`.
- `test/policy/permission-manager.test.ts` (`describe("yolo")`), `test/policy/rule.test.ts`, `test/policy/serving-policy.test.ts`.
- `test/config/extension-config.test.ts`, `config-loader.test.ts`, `config-modal.test.ts`, `config-store.test.ts`, `config-file-writer.test.ts` (writes `yoloMode` as sample knob data), `config-schema.test.ts`, `config-pipeline.test.ts`, `config-reporter.test.ts`, `status.test.ts` (deleted), `test/session/permission-session.test.ts`.

Docs (step 10):

- `docs/architecture/architecture.md`: § "yolo is recorded authority" rewritten as the auto-approve terminal; the scope table row (line ~59); the inline `RuleOrigin` listing; the authority-model intro, "three context predicates" sentence, and the escalation text diagram (add the auto-approve terminal); § "Fail-closed on an invalid non-global scope" ("two overlays stack"); the model-judge "survives the yolo rewrite" sentence; resolved-direction item 3 ("inherits … yolo"); the serving-eligibility sentence (line ~550); module-tree entries for `auto-approval.ts`, `auto-approve-command.ts`, `authorizer-selection.ts`, `forwarding-manager.ts`, `lifecycle.ts`, `runner.ts`, `helpers.ts`, `serving-policy.ts`, `decision-source.ts`, `extension-config.ts`, and the removed `status.ts`; the roadmap's `[#1118]` step `✅` (heading and Mermaid node `S1118`) with a `Landed:` note, and the health-metrics rows it moves.
- `docs/glossary.md`: the `Yolo` entry becomes `Auto-approve`; `origin`, `channel`, `runtime knob`, `decidedBy`, and fail-closed entries that name yolo.
- `docs/configuration.md`: lines naming `yoloMode` (~15, 59, 69, 80, 132, 152, 643–649, 1335) and a new "Auto-approve" section (flag, command grammar, scopes, headless serving, safe flag spellings).
- `docs/cross-extension-api.md`: the `auto_approved` row; `origin` no longer takes `yolo`.
- `docs/subagent-integration.md`: "The main interactive session polls" (~line 149) gains the headless auto-approve server.
- `README.md`: an Upgrading entry "The major after 44.x — auto-approve replaces yolo" (published version 44.0.2, from `pnpm view`); the 22.0.0 entry's `yoloMode` example stays (historical).
- `.pi/skills/package-pi-permission-system/SKILL.md`: line ~112 (`yoloMode` re-permits the floor), ~238 (`createManagerFromPaths` `isYoloEnabled`), ~240 (the manager test's yolo concern).

Predicted unchanged, with the claim each rests on:

- `src/authority/authorizer-chain.ts` — the terminal slot already takes any `TerminalAuthorizer`.
- `src/authority/delegation-envelope.ts` — it caps links, not terminals.
- `src/service/permission-events.ts` — `auto_approved` stays a `PermissionDecisionResolution`.
- `docs/decisions/*` — decision records are historical.

## Test Impact Analysis

New tests the design enables:

- `AutoApproval.grantFor` as a value over scope × details (own/forwarded/agent, setter retained, precedence), with no gate or UI.
- `AutoApprovingAuthorizer` as a terminal in isolation, like `denying-authorizer.test.ts`.
- `AuthorizerSelection` composition: a link's verdict before the terminal under auto-approve, and the relaying node's `auto_approve_delegated` record.

Tests that become redundant and are deleted (step 8):

- `describe("yolo")` in `test/policy/permission-manager.test.ts` (the rewrite no longer exists; the fail-closed-plus-yolo cases go with it).
- `rewriteAsksToYolo` cases in `test/policy/rule.test.ts`, `resolveYoloGrant` cases in `test/handlers/gates/helpers.test.ts`, the 2b fast-path cases in `runner.test.ts` (7 sites using `yolo`/`isYoloEnabled`), the yolo arm in `serving-policy.test.ts`, the yolo knob in config tests, and `status.test.ts`.
- `describe("yolo grants asks synthesized after resolution")` in `composition-root.test.ts` (lines ~2364–2460): its five cases are re-expressed under `--auto-approve` in step 6 first, so coverage of the [#712] contract never drops.

Tests that stay as-is because they exercise the layer itself:

- `denying-authorizer.test.ts`, `authorizer-chain.test.ts`, `delegation-envelope.test.ts`, the non-yolo `serving-policy.test.ts` floor cases (the clamp itself is unchanged), and `forwarded-request-server.test.ts`'s rule paths.

## Invariants at risk

| Invariant (source)                                                                                                                                                                                      | Constituency                           | Pinned by                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An `ask` synthesized after resolution (wrapper floor, `<unparseable-bash-command>`, `<unparsed-bash-subtree>`) is approved under the relaxation, and a `deny` is not ([#712]; `architecture.md` § yolo) | operators running relaxed              | today `composition-root.test.ts` "yolo grants asks synthesized after resolution" (real factory, real gates); step 6 adds the same five cases under the flag before step 8 deletes the yolo ones |
| A child-raised floor is honored at the serving node: a serving `allow` rule does not answer it ([#1029])                                                                                                | operators with permissive parent rules | `serving-policy.test.ts` floor cases (real `ResolverServingPolicy` over a resolver fixture); step 8 rewrites the yolo arm's case to assert the clamp holds unconditionally                      |
| One chain per node: a relaying node resolves no links (ADR 0007 §7)                                                                                                                                     | link authors                           | `authorizer-selection.test.ts` "relaying node" cases; step 5 adds that it also skips auto-approve                                                                                               |
| Session approvals do not leak across same-cwd session switches                                                                                                                                          | every operator                         | `composition-root.test.ts` "session approvals do not leak…"; step 6 adds the same for auto-approve state (command `on`, session switch, next ask prompts)                                       |
| `decidedBy` is stamped at the deciding site (#726)                                                                                                                                                      | review-log auditors                    | step 4's terminal test asserts the full `decidedBy` record                                                                                                                                      |
| Deny-preserving: a deny never reaches a terminal                                                                                                                                                        | every operator                         | `runner.test.ts` deny path (`applyPermissionGate` blocks without escalating); step 6 adds a composition-root case with the flag on                                                              |

No quantitative invariant (prefix, budget, latency) is touched.

## TDD Order

Each step runs `pnpm --filter @gotgenes/pi-permission-system exec vitest run <files> && pnpm --filter @gotgenes/pi-permission-system run check` before committing; steps 5, 6, and 8 run the full package suite.

1. **`test(pi-permission-system): boot the extension through one helper in composition-root tests`** (roadmap ride-along).
   Add `bootExtension(pi?: FakePi, options?)` to `test/helpers/make-fake-pi.ts`, holding the one `as unknown as ExtensionAPI` cast; migrate the 80 casts in `composition-root.test.ts`.
   Give `makeFakePi` a `flags?: Record<string, boolean | string>` option backing `getFlag`, and a recording `registerFlag`.
   Verify: `grep -c 'as unknown as ExtensionAPI' test/composition-root.test.ts` prints 0; suite green, test count unchanged.
   Killing mutation: none (pure refactor of test wiring); confirm the count is unchanged instead.

2. **`test(pi-permission-system): give the hand-rolled factory fakes registerFlag and getFlag`.**
   `test/session-start.test.ts` (two fakes, which must stay hand-rolled because they count `session_start` registrations) gains `registerFlag`/`getFlag` stubs; `test/service/permission-events.test.ts:~278` moves onto `makeFakePi({ events })` + `bootExtension`.
   Prepares step 6, whose factory-time `registerFlag` would otherwise throw in these files.
   Killing mutation: none (wiring only).

3. **`test(pi-permission-system): drop the yolo fixture options no test reads`.**
   Remove `makeHandler`'s `yolo` override (`handler-fixtures.ts`, 0 callers per the assessor; re-derive with `grep -rn 'yolo:' test --include=*.ts`) and `createManagerFromPaths`' `isYoloEnabled` option (`manager-harness.ts`, 0 callers).
   The second matters: it is spread into `new PermissionManager({...})`, so removing the option in step 8 would not make `tsc` flag it.
   Update the package skill's `createManagerFromPaths` line in the same commit.

4. **`refactor(pi-permission-system): add the auto-approve decider and its terminal`.**
   Add `auto_approve` to `DecisionSource` (beside `yolo` for now) with its narrowing, `resolutionFor`'s `auto_approved` arm, and the agent-renderer's never-refuses arm.
   Retarget the escalator stubs in `test/handlers/tool-call-events.test.ts` (~263–287) and `test/handlers/input-events.test.ts` (~153–175) from `{ kind: "yolo", pattern: "*" }` to an `auto_approve` record, since that stub already models the new terminal's answer.
   Add `src/authority/auto-approval.ts` (`AutoApproval`, `AutoApprovingAuthorizer`) with no consumer yet, so `refactor:`.
   Tests (`auto-approval.test.ts`, `decision-source.test.ts`, `decision-resolution.test.ts`):
   - `grantFor` per scope: own ask × {own, forwarded, agent} on; forwarded ask (agent `reviewer`) × {own, forwarded, agent reviewer, agent other}; precedence agent-before-forwarded reports `scope: "agent"`; setter retained; `disable()` clears a flag-set scope; `answersForwardedAsks` for forwarded and for an agent scope.
   - The terminal allows a covered ask with the full `decidedBy`, and delegates an uncovered one to the inner terminal (assert the inner mock's call).
   - `asDecisionSource` round-trips the record and rejects a bad `setter`/`scope`.
   Killing mutations:
   - scope matching: make `grantFor` ignore `details.forwarding` (treat every ask as own) — the forwarded-vs-own cases go red;
   - agent filter: compare `agentName` with `!==` inverted — the "agent other" case goes red;
   - delegation: make `AutoApprovingAuthorizer.authorize` return the grant unconditionally — the uncovered case goes red;
   - narrowing: accept any `setter` string — the rejection case goes red.

5. **`refactor(pi-permission-system): compose auto-approve over a locally adjudicating terminal`.**
   `AuthorizerSelectionConstructorDeps.autoApproval` (narrow `grantFor` role), `terminalFor`, `auto_approve_delegated`; `makeAuthorizerSelectionDeps` gains a default empty approval; `index.ts` constructs `AutoApproval` (with a `() => false` flag thunk until step 6) and passes it.
   Production state is always empty here, so no observable change: `refactor:`.
   Tests (`authorizer-selection.test.ts`, real `AutoApproval`, registered link via `registerLink`):
   - covered own ask with no links is allowed with `decidedBy.kind === "auto_approve"`; uncovered reaches the prompter's terminal;
   - a link that denies still denies with auto-approve on; a link that defers is consulted (its spy called) before the auto-approval;
   - a relaying node (`ctx.hasUI` false, subagent detection true) with `own` on reaches `ParentAuthorizer` and logs `auto_approve_delegated`;
   - enabling a scope after `activate` applies to the next `escalate` without re-activation.
   Killing mutations: wrap the terminal for a relaying node too (relaying case red); compose the auto-approver ahead of the links (link-deny case red); capture `grantFor`'s answer at `activate` instead of per ask (the toggle case red).

6. **`feat(pi-permission-system): auto-approve asks with --auto-approve or /permission-system:auto-approve`.**
   Register the flag; add `src/authority/auto-approve-command.ts`; `SessionLifecycleHandler` gains `AutoApproveLifecycle` (`applyLaunchFlag` before `resetForNewSession`, `clearStatus` at shutdown); `AutoApproval` owns the status key.
   In the same commit, **move status ownership**: delete `src/config/status.ts` and the syncs in `ConfigStore.save` and `PermissionSession.refreshConfig`, which would otherwise erase the auto-approve indicator on every `before_agent_start` (`session-turn-prep.ts` → `refreshConfig`).
   Between this commit and step 8, yolo still works but loses its `yolo` status indicator.
   Update `status.test.ts` (delete), `permission-session.test.ts`, `config-store.test.ts`, and `lifecycle.test.ts` for the moved status.
   Tests:
   - `auto-approve-command.test.ts`: the pure parser over every grammar form, `agent` without a name → usage warning; the handler enables/disables and syncs status; the relaying warning when `adjudicatesLocally()` is false.
   - `lifecycle.test.ts`: `applyLaunchFlag` is called before `resetForNewSession` (call order); `clearStatus` at shutdown.
   - `composition-root.test.ts` via `bootExtension({ flags: { "auto-approve": true } })`: the flag is registered; a rule-`ask` bash command is allowed with no prompt, review entry `permission_request.approved` with `decidedBy` `{ kind: "auto_approve", setter: "flag", scope: "own" }`; a configured link (registered through the service on `permissions:ready`) is called first; the five [#712] cases (indirection wrapper and unparseable approved, denied wrapper and denied unparseable blocked, wrapper floored to a prompt with the flag off); a rule `deny` blocks; the command `on own` then a session switch (factory re-run) prompts again.
   Killing mutations:
   - flag read: make `applyLaunchFlag` ignore `readLaunchFlag()` — the composition-root flag cases go red;
   - ordering: call `applyLaunchFlag` after `resetForNewSession` — the lifecycle call-order test goes red;
   - command: map bare `on` to `own` only — the parser case for bare `on` goes red;
   - status: drop `syncStatus` from `enable` — the handler's status assertion goes red.
   Commit trailers (final paragraph, below `Refs #1118`):

   ```text
   Co-authored-by: ReStranger <restranger@disroot.org>
   Co-authored-by: maksimr <616193+maksimr@users.noreply.github.com>
   ```

7. **`feat(pi-permission-system): a headless session serves forwarded asks while auto-approve covers them`.**
   `ForwardingManagerDeps.servesWithoutUI`, wired to `autoApproval.answersForwardedAsks()` in `index.ts`.
   Tests:
   - `forwarding-manager.test.ts`: a `hasUI: false` ctx with the reader true starts serving (`markServing` called); with it false stops; flipping it false then calling `start` again stops serving.
   - `composition-root.test.ts`: a headless parent booted with the flag serves an in-process headless child's forwarded ask: the child's `tool_call` resolves allowed, and the parent's review log records `decidedBy` `{ kind: "auto_approve", setter: "flag", scope: "forwarded" }` (follow the skill's forwarding round-trip recipe, but let the parent's own poll answer).
   Killing mutation: keep `if (!ctx.hasUI) { this.stop(); return; }` unchanged (ignore the reader) — the headless-serving cases go red.

8. **`feat(pi-permission-system)!: auto-approve replaces yolo`.**
   Delete `rewriteAsksToYolo`, `isYoloEnabled` (manager option, `GateRunner` param, `ResolverServingPolicy` param, the `index.ts` closure), `resolveYoloGrant` and step 2b, `honorChildFloor`'s yolo arm, `"yolo"` in `RuleOrigin`, `{ kind: "yolo" }` in `DecisionSource`, and `isYoloModeEnabled`; remove `yoloMode` from the runtime config, knob list, `config.example.json`, and `ConfigStore`'s debug line; mark it deprecated in the schema and regenerate (`pnpm run gen:schema`); add `detectRetiredYoloMode`.
   Replace the modal's yolo row with the session toggle: first extract `openSettingsModal`'s inline `onChange` into a named `applyChange(id, value)` (assessor's optional tidy, folded here because the extraction exists only to give the new row its branch), declare `SessionAutoApproveToggle`, and have `AutoApproval` `implements` it.
   Fold every consumer and test in this one commit, since it removes exports: the yolo tests listed under Test Impact Analysis, `gate-fixtures.ts`' `yolo`/`isYoloEnabled`, the `GateRunner` constructions in `handler-fixtures.ts` and `external-directory-fixtures.ts`, the yolo describe in `composition-root.test.ts`, `config-file-writer.test.ts`' `yoloMode` sample knob (use another knob), and `serving-policy.test.ts` (the floor clamps to `ask` whatever the mode).
   Tests:
   - `config-loader.test.ts`: `yoloMode: true` in global, and in a trusted project, yields the "no longer read" issue; absent yields none; the file still validates (no fail-closed floor).
   - `composition-root.test.ts`: `yoloMode: true` in the global file with no flag, and a rule-`ask` bash command, prompts (the stub prompter is called), and the warning is reported once.
   - `config-modal.test.ts`: toggling the auto-approve row calls `setAll(true)`/`setAll(false)` and writes no file (`save` not called); the knob rows still save.
   Killing mutations: leave the `index.ts` reader passing `isYoloModeEnabled(config)` into a retained manager option (the composition-root prompt case goes red); drop `"yoloMode"` from `mergeUnifiedConfigs`' loop (the warning cases go red, the precedent's trap); make the modal row call `config.save` (the no-file case goes red).
   Commit body names each break; footer:

   ```text
   BREAKING CHANGE: the yoloMode config key is no longer read; launch with
   `pi --auto-approve` or run `/permission-system:auto-approve on`. The "yolo"
   origin value is removed: an auto-approved decision reports the asking
   rule's origin with resolution auto_approved, and the review log names the
   setter in decidedBy. Authorizer chain links now see asks under
   auto-approve, and PermissionsService answers ask where yolo answered allow.
   ```

9. **`feat(pi-permission-system): the config schema describes each authorizerChain entry`** (roadmap ride-along, issue [#868]).
   Attach `.meta({ description, markdownDescription })` to `authorizerChain`'s item schema: the value is the name a link registered through `PermissionsService.registerAuthorizer(name, authorize)`, not a package name; the first-party link registers as `model-judge`; an unregistered name is skipped fail-safe.
   Add `examples: [["model-judge"]]` on the array, then `pnpm run gen:schema`.
   Tests: `config-schema.test.ts`'s parity test, plus one assertion that the generated `authorizerChain.items` carries a `description` naming `model-judge`.
   Killing mutation: drop the item `.meta` — the new assertion goes red.
   Placed after step 8 so the two schema regenerations do not interleave.

10. **`docs(pi-permission-system): document auto-approve and retire yolo from the docs`.**
   Every Docs item under Module-Level Changes, including the roadmap `✅`, `Landed:` note, and health-metric recomputes (`rewriteAsksToYolo` 2 → 0, `resolveYoloGrant` 2 → 0, `registerFlag` 0 → 1; the namespaced-command row greps `config-modal.ts` and stays 0, owned by [#1103]).
   Before committing, grep `packages/pi-permission-system/docs`, `README.md`, and `.pi/skills/` for `yolo`, `yoloMode`, `isYoloEnabled`, and `resolveYoloGrant`; the only survivors should be `docs/decisions/`, `docs/plans/`, `docs/retro/`, `docs/architecture/history/`, the README's 22.0.0 entry, and the deprecated schema description.

## Risks and Mitigations

- **Pi's CLI parse swallows a positional after a boolean extension flag.**
  Measured against the pinned 1.0.0 `parseArgs`: `["--auto-approve", "fix the bug"]` yields `messages: []` and flag value `"fix the bug"` (which `agent-session-services` then coerces to `true`), while `["fix the bug", "--auto-approve"]` and `["--auto-approve", "-p", "fix the bug"]` keep the message; Pi's `main` checkout parses the same way.
  Mitigation: `docs/configuration.md` and the README Upgrading entry show `pi --auto-approve` alone or after the message; reporting upstream is an Open Question.
- **A headless node that serves now drains forwarded asks it cannot answer** (an uncovered requester under an `agent` scope).
  Those are denied by `DenyingAuthorizer`, the same answer the child gets today when nobody serves, but promptly instead of after the ~2 s abandonment.
- **Links now see every ask under auto-approve**, including a burst a judge never saw before.
  This is the decided behavior (ADR 0016 §5); the CHANGELOG footer names it.
- **Step 6 leaves yolo without a status indicator until step 8.**
  Both land before a release is dispatched; the alternative, a status composer, would be deleted in step 8.
- **Conflict with PR [#983]**, which edits `authorizer-selection.ts`, `config-schema.ts`, `extension-config.ts`, and `index.ts`.
  It is a reference PR, not merged here; whichever lands second rebases.
- **[#1142]** (modal toggle copies project knob values) interacts with the knob list this step shrinks; it is folded into [#1122] and unaffected by removing one knob.

## Open Questions

- Whether to report the boolean-flag parse to `earendil-works/pi` (read its issue template and AI-submission policy first); this plan only documents the safe spelling.
- Whether `forwarded_permission.prompted` should be renamed for asks a terminal answers without a human; deferred until a reader asks.
- At ship time, close [#720], [#1031], and PR [#990] with a credit comment; PR [#671] is already declined by ADR 0016.

[#712]: https://github.com/gotgenes/pi-packages/issues/712
[#720]: https://github.com/gotgenes/pi-packages/issues/720
[#799]: https://github.com/gotgenes/pi-packages/issues/799
[#868]: https://github.com/gotgenes/pi-packages/issues/868
[#983]: https://github.com/gotgenes/pi-packages/pull/983
[#990]: https://github.com/gotgenes/pi-packages/pull/990
[#671]: https://github.com/gotgenes/pi-packages/pull/671
[#1029]: https://github.com/gotgenes/pi-packages/issues/1029
[#1031]: https://github.com/gotgenes/pi-packages/issues/1031
[#1103]: https://github.com/gotgenes/pi-packages/issues/1103
[#1119]: https://github.com/gotgenes/pi-packages/issues/1119
[#1121]: https://github.com/gotgenes/pi-packages/issues/1121
[#1122]: https://github.com/gotgenes/pi-packages/issues/1122
[#1124]: https://github.com/gotgenes/pi-packages/issues/1124
[#1142]: https://github.com/gotgenes/pi-packages/issues/1142
