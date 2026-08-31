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

## Stage: Implementation — TDD (2026-08-31T05:20:24Z)

### Session summary

Executed all nine plan steps plus two review-driven doc fixes, in twelve commits. pi-subagents gained the optional `subagents:child:bound` channel, emitted after `bindExtensions()` resolves and not on the throw path; pi-permission-system gained `ChildNodeAudit`, subscribed through the existing `subscribeSubagentLifecycle` dispatcher and wired in `index.ts`.
Test count: pi-permission-system 3783 → 3795 (+12), pi-subagents 1353 → 1357 (+4).
All four gates green (`check`, root `lint`, `test`, `fallow dead-code`).

### Observations

- **A planning claim shipped into an ADR before anyone checked it.**
  The plan asserted that a foreground child is "disposed and unregistered inside the parent's own tool call", and I wrote that into both the ADR 0012 amendment and the architecture doc's `Landed:` note as the reason for rejecting the deferred-sweep seam.
  It is false: `completeRun()` only marks status, and disposal is `SubagentManager`'s 60-second interval sweep against a configurable retention window.
  The `pre-completion-reviewer` caught it and cited the lines.
  I had verified the *other* dead-seam claim (`dispose()` awaiting `session_shutdown` before emitting `disposed`) against the source during planning, and inherited the second one from an inference about `spawnAndWait` awaiting `record.promise` — awaiting completion is not awaiting disposal.
  The corrected objections (post-hoc by construction; reachability depends on a retention window this package does not control) were re-verified by the reviewer against the source before landing.
  The lesson is narrow and repeatable: when a design rejects an alternative, the *rejection* rationale ends up in the durable record too, and it needs the same verification as the chosen path — it is the half nobody exercises.
  The Planning-stage entry above is left as written; this is the correction.
- **The plan's step 2 was mistyped `feat:` and was retyped to `refactor:` during the cycle.**
  The commit adds a publisher method nothing calls, so nothing is observable until step 3 wires it.
  Caught by applying the AGENTS.md rule at commit time rather than at the step-9 changelog preview, which is where it would otherwise have surfaced with the commit three deep.
- **A predicted mutation under-predicted its own blast radius.**
  Step 3's mutation A (move the `bound` emission before `bindExtensions()`) was planned to kill only the ordering case; it killed the rejection case as well, because emitting before the bind also emits on the failure path.
  More discriminating than predicted, so not a finding against the tests — but mutation B (move it into a `finally`) was still needed to show the rejection pin discriminates independently.
- **The composition-root case earned its place explicitly.**
  Inverting the `index.ts` presence thunk left all nine `subagent-lifecycle-events` cases and all eight `child-node-audit` cases green, and killed only the three composition-root cases — confirming the unit files stub the seam and that the integration test is the sole proof of the wiring.
  The plan predicted this and said so in step 5, which is what made the check worth running rather than a formality.
- **Two flaky full-suite failures were host load, not regressions.**
  `out-of-process forwarding liveness > waits for an out-of-process parent whose heartbeat is fresh` and `ParentAuthorizer abandonment > keeps waiting while the in-process target is serving` failed once in a 914-second run, then passed alone — the pattern the package skill documents.
  An A/B swap measured the new composition-root cases at +0.86 s over the pre-change file (12.80 s → 13.66 s), so they are not a flake contributor.
- **The latch needed no re-arm hook**, because the extension factory is re-invoked per session generation — so the auditor is rebuilt on every `/new`, `/resume`, `/fork`, or `/import`.
  This is where it diverges from `PermissionServiceLifecycle.announced`, which re-arms in `activate` because a `reason: "reload"` `session_start` reuses the instance.
  Deliberately not extracted into a shared latch helper: two uses, different semantics.
- **Pre-completion reviewer: WARN** (two rounds).
  Round 1 raised the false ADR claim above plus two module-tree gaps (`child-node-audit.ts` absent from the tree; `pi-subagents` ADR 0002 still enumerating four channels); all fixed in `c8bda0b3`.
  Round 2 confirmed the replacement rationale against the source and found one more stale copy I had missed — `pi-subagents/docs/architecture/architecture.md` duplicates ADR 0002's channel enumeration, so fixing the ADR left the file disagreeing with its own module tree — fixed in `d41ed14e`.
  No blocking findings in either round.

## Stage: Sync (worktree) (2026-08-31T15:40:00Z)

### Session summary

Pre-push checks pass clean: `pnpm run lint` and `pnpm fallow dead-code` both green from the worktree root, no fixes needed.
The plan's `**Release:**` marker is `ship independently` (Phase 14 Step 7 carries no batch tag), so the root should proceed to release without waiting on a sibling.
No deferred work or follow-ups from this issue's implementation — the plan's two Open Questions were recorded as non-directions, nothing filed.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-792--/2026-08-31T03-42-59-315Z_01a055e9-c6f2-789e-9867-87e1fff107c7.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

One judgment call from the TDD stage is still open for the operator: the committed plan retains the original (incorrect) claim that a foreground child is disposed inside the parent's own tool call, with the correction recorded only in this retro's TDD-stage entry rather than edited into the plan itself.
The pre-completion reviewer agreed this matches the repo's "plan as point-in-time snapshot" convention, but flagged it as the operator's call to override at ship or retro time if preferred.
