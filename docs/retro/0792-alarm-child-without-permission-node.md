---
issue: 792
issue_title: "pi-permission-system: alarm when a registered in-process child session has no permission node"
---

# Retro: #792 — Alarm when a registered in-process child session has no permission node

## Stage: Planning (2026-08-31T04:17:50Z)

### Session summary

Produced `docs/plans/0792-alarm-child-without-permission-node.md` (cross-package: `pi-subagents` + `pi-permission-system`).
The design adds an optional fourth child-lifecycle channel `subagents:child:bound`, emitted by `pi-subagents` after `await session.bindExtensions({})` resolves, and a `ChildNodeAudit` collaborator in `pi-permission-system` that asks `getPermissionsService(childSessionId)` on that signal and alarms when the answer is `undefined` — a `child_node_absent` review entry per affected child plus one visible warning per parent session.
The operator settled all four gates on the recommended option: optional third channel, warn rather than refuse, warn-once cadence, hedged message naming `excludedExtensionPackages`.

### Observations

- The issue's hardest open question ("where the check fires — there is no parent-side event for the child's first turn") turned out to be nearly forced once two candidate seams were checked against the code rather than reasoned about.
  Auditing at `subagents:child:disposed` is dead because `SubagentSession.dispose()` awaits the child's `session_shutdown` — which unpublishes the keyed service — **before** emitting `disposed`, so every healthy child would false-alarm.
  Sweeping at the parent's next `before_agent_start` is dead for foreground children, which are disposed and unregistered inside the parent's own `subagent` tool call, before the parent's next turn begins.
  Both findings are measurements against named line numbers, not arguments; they are recorded in the plan's Background so a later reader does not re-litigate them.
- The timing guarantee rests on Pi core: `AgentSession.bindExtensions()` does `await this._extensionRunner.emit(this._sessionStartEvent)`, so when it resolves every child extension's `session_start` has run.
  Read from the `pi` checkout at `../../pi` per AGENTS.md, inline rather than via a subagent, because the claim is the design's load-bearing input.
- The contract cost was the real deliberation: ADR 0012 decision 5 says an implementation's entire obligation is the announcement, and a third channel grows it.
  Making the channel **optional** keeps the mandatory obligation at two events and leaves the conformance table's ✓/✗ meaning intact.
  The population affected is one — only `@gotgenes/pi-subagents` emits the existing two events at all.
- Rejected during design: having `pi-subagents` carry its resolved `excludedExtensionPackages` list on the new payload so the parent could distinguish deliberate exclusion from a load failure.
  It widens the announcement with a settings fact purely to improve message wording; the hedged message was chosen instead.
  Recorded as a non-direction in the plan's Open Questions; nothing filed.
- Rejected during design: a sibling `subscribeChildNodeAudit(events, audit)` module (the Tidy-First assessor's own open question).
  `subagent-lifecycle-events.ts` already owns every channel name and payload shape of the announcement contract, so splitting the subscription would separate `SUBAGENT_CHILD_BOUND` from its only subscriber or duplicate the constant.
- Rejected during design: extracting a shared "re-armed once-per-activation latch" between `PermissionServiceLifecycle.announced` and the new auditor.
  Two uses with different semantics; the auditor's latch needs no re-arm at all, because the extension factory is re-invoked per session generation.
- The Tidy-First assessor found one real preparatory gap (composition-root `makeBaseCtx` cannot capture `ui.notify`) and one contradiction in the target-file list: `packages/pi-subagents/test/helpers/subagent-session-io.ts`'s `createChildLifecycleMock()` must gain `bound` in the **same** commit as the interface widening, since the mock cannot be written before the method exists.
  Both are folded into the TDD Order (steps 1 and 2).
- Step 5's killing-mutation note deliberately says which mutation the step's own tests will **not** kill (the inverted lookup thunk in `index.ts`, which only step 6's composition-root case catches), so a green run at step 5 is not mistaken for coverage of the wiring.

#### Deferred tidyings

- `packages/pi-permission-system/src/handlers/lifecycle.ts` — the `serviceLifecycle` constructor-dep doc comment and the inline comment above `this.serviceLifecycle.activate(ctx)` both still say publication is "skipped for registered subagent children" and that the child is "identified and excluded".
  That stopped being true in #796, which removed the `RegisteredChildDetector` guard.
  Rejected as scope creep for this change; independent one-line doc fix.
