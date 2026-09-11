---
issue: 909
issue_title: "pi-permission-system: honor explicit parent forwarding for subprocess children with their own UI"
---

# A UI session relays its asks to a declared, live parent

## Release Recommendation

**Release:** ship independently

No roadmap step references [#909].
Phase 15's spine is bash token roles, declared effects, and the sandbox seam; this change lives in `authority/`'s authority-selection dispatch, sharing no step's mechanism.
It is the same disposition Phase 15's sweep list already records for [#907], whose forwarding-lifecycle defect this one sits beside.
The change is breaking (`feat!:`), so `./scripts/release/next-version.sh pi-permission-system` will print a major tag once it lands.

## Problem Statement

A human sits at a lead Pi session.
[Pi Herdsman](https://github.com/boadij/pi-herdsman) spawns each managed agent as its **own `pi` process** in a visible Herdr pane — a normal TUI, so `ctx.hasUI === true` — and hands every one of them `PI_SUBAGENT_PARENT_SESSION=<lead-session-id>` (`extension/index.ts:5057-5061`; for an agent spawned *by* an agent, the value is the spawner's own inherited marker, so the whole tree names the root lead).

A pane's agent runs `git status`.
Its project-local `permission: { bash: { "git status": "ask" } }` resolves to `ask`, the child is correctly identified by its `<active_agent>` tag, and the dialog opens **in the pane** — not in the lead.
The human must discover which pane is blocked and answer there, while the session the spawner explicitly named as the forwarding target sits idle.

The reporter's diagnosis is correct as written: `selectAuthorizer` (`src/authority/authorizer.ts`) tests `ctx.hasUI` before subagent detection, so a child with its own UI never reaches the `ParentAuthorizer` arm.
The declared forwarding target is therefore unreachable for any process shape that keeps its child visible.

This issue was filed by [@boadij](https://github.com/boadij), not by the maintainer.
The direction was confirmed with the operator before planning: relay implicitly on a declared parent, and gate the relay on that parent demonstrably serving.

## Goals

- A session with a UI relays its asks to the session named by `PI_SUBAGENT_PARENT_SESSION` (or the in-process registry) when that session is demonstrably draining its forwarded-permission inbox.
- A session with a UI and no live declared parent keeps today's local dialog — including a marker that names the reading session itself, and a parent that has exited, been killed, or stopped polling.
- The decision is re-evaluated per activation, so a pane whose lead exits reverts to its own dialog on the next turn event rather than refusing every tool call.
- Starting or stopping relay is visible in the review log, once per transition rather than once per turn event.

This change **is breaking**.
A configuration that exists today — a UI session whose environment names a live parent — changes where its human is prompted, with no user edit on upgrade.
The commit carrying the behavior is `feat(pi-permission-system)!:` with a `BREAKING CHANGE:` footer naming the opt-out (spawn the child without the parent-session marker).

## Non-Goals

- **Changing serving eligibility.**
  `ForwardingManager.start` stays `ctx.hasUI` alone ([#907]).
  A relaying pane keeps draining its own inbox, which is what lets a `lead → agent → agent` tree relay through the middle hop; `forwardableRequestId` (`approval-escalator.ts`) already guards that hop's inbound id.
- **Changing subagent detection.**
  `isSubagentExecutionContext` keeps answering "is this process a child", unchanged.
  What changes is one consumer: `selectAuthorizer`'s `hasUI` arm.
- **A local "waiting for approval in session X" notice in the relaying pane.**
  A pane that relays emits no `permissions:ui_prompt` of its own — the serving node emits it — so the visible pane shows nothing while it waits.
  That is the same gap [#658] and PR [#693] track (reporting a blocked permission prompt to Herdr), and it is theirs to close, not this change's.
- **A local-dialog fallback for an ask already in flight.**
  If the parent dies between selection and the response poll, the existing grace window fast-fails that one ask as `confirmationUnavailable`; the next activation selects the local dialog.
  Rescuing the in-flight ask needs a composite terminal whose `adjudicatesLocally` is ambiguous mid-ask, which ADR 0007 §7 has no room for.
- **A config key to opt out of relaying.**
  The operator chose the implicit trigger at the clarification gate; a `relayAsksToParentSession` toggle would re-open the same question at a second surface.
  The lever stays the spawner's: a child spawned without the marker adjudicates locally.
- **A new ADR.**
  The rule is one narrowing of an existing statement in ADR 0007 §7 plus a section in the adapter convention's canonical spec (`docs/subagent-integration.md`, ADR 0012 decisions 5–6).
  ADR 0007 §7's substance — one chain per node, a relaying node resolves no links — is untouched.
- **Closing [#722] or [#861].**
  [#722] is a parent that did not drain an inbox at all; [#861] is a locally-adjudicating child skipping a link whose provider did not load there.
  Neither is this dispatch.

## Background

### The three things `hasUI` decides today, and which one moves

| Question                            | Owner                        | Today                                          | After                                                      |
| ----------------------------------- | ---------------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| Does this node drain its own inbox? | `ForwardingManager.start`    | `ctx.hasUI` alone ([#907])                     | unchanged                                                  |
| Is this process a child?            | `isSubagentExecutionContext` | registry, then env hints, then session dir     | unchanged                                                  |
| Who decides this node's asks?       | `selectAuthorizer`           | `hasUI` → local; else child → relay; else deny | `hasUI` → relay when a declared parent is live, else local |

### `selectAuthorizer` and its two collaborators

`selectAuthorizer(ctx, deps)` (`src/authority/authorizer.ts:131-160`) returns a `SelectedAuthority` — `{ terminal, adjudicatesLocally }` — and is called from `AuthorizerSelection.activate`, which `PermissionSession.activate` drives on **every** turn event (`before_agent_start`, each `tool_call`, each skill gate).
So a per-activation decision is already the shape of this seam; nothing needs a new lifecycle hook.

`resolvePermissionForwardingTarget` (`src/authority/permission-forwarding.ts`) answers *which* session to relay to, from the in-process registry or the `SUBAGENT_PARENT_SESSION_ENV_CANDIDATES`, and already skips a candidate naming the reading session itself ([#907]).
`ForwardingLivenessJudge` (`src/authority/forwarding-liveness.ts`) answers *whether that target is draining its inbox*, routing on `PermissionForwardingTarget.source`: the process-global `ServingSessionRegistry` for `"registry"`, the filesystem heartbeat for `"env"`.
Both collaborators are already on `AuthorizerSelectionDeps` (`registry`, `serving`), because `ParentAuthorizer` needs them — so the new arm adds **no** dependency to the bag.

### The dead `self` branch

`resolvePermissionForwardingTarget`'s `options.hasUI` arm returns `{ sessionId: <own>, source: "self" }`.
It has no production caller: its one caller, `ParentAuthorizer.waitForForwardedApproval`, is reached only from a `ParentAuthorizer`, which `selectAuthorizer` constructs only for a no-UI context (the call site hardcodes `isSubagent: true` for the same reason).
The arm and the two `case "self"` arms in `ForwardingLivenessJudge` are exercised only by `test/authority/permission-forwarding.test.ts` and `test/authority/forwarding-liveness.test.ts`.

Under this change that arm becomes actively dangerous: a relaying UI node would resolve **itself** as its target and file requests into the inbox it drains — its own server would then escalate them back to its own terminal.
Removing it is the first preparatory commit.

### Constraints from AGENTS.md and the package skill that bear on this change

- The `permissions:ready` payload carries `adjudicatesLocally`, and the ready latch broadcasts it at most twice per session generation (ADR 0012 decision 3).
  With a per-activation decision that value can now change mid-session.
  It stays correct where it matters: a link registers everywhere and a vacant registration is recorded (ADR 0012 decision 4), and `AuthorizerSelection.linksFor` reads the **live** selection on every ask.
- A relaying node resolves no chain links (ADR 0007 §7) — so a chain link registered in a relaying pane (a model judge, say) becomes vacant, and the lead's chain judges the pane's asks over the child-fixed facts.
  That is the rule working, not a regression, but it is an observable change for a sibling extension and belongs in the docs.
- Review-log volume: selection runs several times per turn, so a per-selection entry would drown the log.
  `ForwardingManager.announceServing` already solved exactly this with a change-only guard; this change mirrors the pattern without extracting a shared helper (the two track different state shapes).

## Design Overview

### The rule

> A node with a UI decides locally **unless** it names another session that is demonstrably draining its forwarded-permission inbox, in which case it relays.

Expressed at the one dispatch point:

```typescript
export function selectAuthorizer(
  ctx: ExtensionContext,
  deps: AuthorizerSelectionDeps,
): SelectedAuthority {
  if (ctx.hasUI) {
    const relayTarget = resolveLiveRelayTarget(ctx, deps);
    if (relayTarget === null) {
      return { terminal: buildLocalUserAuthorizer(ctx, deps), adjudicatesLocally: true };
    }
    return {
      terminal: buildParentAuthorizer(ctx, deps),
      adjudicatesLocally: false,
      relayTarget,
    };
  }
  if (deps.detection.isSubagent(ctx)) {
    return { terminal: buildParentAuthorizer(ctx, deps), adjudicatesLocally: false };
  }
  return { terminal: new DenyingAuthorizer(), adjudicatesLocally: true };
}
```

`resolveLiveRelayTarget` is module-private in `authorizer.ts` — `selectAuthorizer` is its only consumer, so it earns no module of its own:

```typescript
function resolveLiveRelayTarget(
  ctx: ExtensionContext,
  deps: AuthorizerSelectionDeps,
): PermissionForwardingTarget | null {
  const sessionId = getSessionId(ctx);
  const target = resolvePermissionForwardingTarget({
    isSubagent: deps.detection.isSubagent(ctx),
    currentSessionId: sessionId,
    sessionId,
    registry: deps.registry,
  });
  // Only a definite "yes" relays: a UI host that cannot confirm a live parent
  // has a human right here who can answer.
  return target !== null && deps.serving.isServing(target) === true ? target : null;
}
```

Three properties carry the safety argument:

1. **No target, no relay.**
   A lead session with no marker and no registry entry resolves nothing, so it never leaves the local arm.
   A marker naming the reading session itself is already skipped by the resolver ([#907]), so `nicobailon/pi-subagents`' root — which sets its own id in its own process — keeps its dialog.
2. **No live parent, no relay.**
   `isServing` must answer `true`; `false` and `null` both keep the local dialog.
   This is the inverse of `ParentAuthorizer.checkServingLiveness`, which treats `null` as "keep waiting" — correct there (a headless child has no alternative) and wrong here (a human is present).
3. **Re-decided per activation.**
   The selection is rebuilt on every turn event, so the relay is a fact about *now*, not about session start.

### What the headless arm keeps

The `!ctx.hasUI` arm is untouched, including its lack of a liveness gate.
A headless child with no resolvable target must still reach `ParentAuthorizer`, because that is where the diagnostic refusal lives — *"Permission forwarding target session could not be resolved.*
*Checked env vars: …"* — and routing it to `DenyingAuthorizer` instead would replace a specific message with a generic one.
This is why the target resolution stays duplicated between selection and `ParentAuthorizer` rather than being resolved once and handed over: the two callers want different answers for "no target" (local dialog here, informative refusal there).

### `SelectedAuthority.relayTarget`

```typescript
export interface SelectedAuthority {
  readonly terminal: TerminalAuthorizer;
  readonly adjudicatesLocally: boolean;
  /**
   * The target this selection itself verified as live, for the relay-transition
   * record. Absent on the headless relay arm, where the target is resolved per
   * ask by `ParentAuthorizer` rather than at selection.
   */
  readonly relayTarget?: PermissionForwardingTarget;
}
```

Width check (`design-review` §1): the interface goes from 2 fields to 3, one consumer (`AuthorizerSelection`) reads the new one, and it carries the target's `source` as well as its id — so the transition record can distinguish a registry hop from an env hop, which is the same channel-vs-id distinction `forwarded_permission.no_serving_session` already found worth recording.

### Transition record

`AuthorizerSelection.activate` compares the new selection's relay state against the previous one and writes a review entry **only on a change**:

```typescript
activate(ctx: ExtensionContext): void {
  const authority = selectAuthorizer(ctx, this.deps);
  this.recordRelayTransition(authority.relayTarget ?? null);
  this.authority = authority;
}
```

- `forwarded_permission.relay_started` — `{ targetSessionId, channel }` when a node that was deciding locally begins relaying, or when the target changes.
- `forwarded_permission.relay_stopped` — `{ targetSessionId }` when it stops.

Named to pair with `forwarded_permission.serving_started` / `serving_stopped` on the other side of the same exchange, so a stalled or misdirected relay is one `grep` in a single log.
A node that never relays (the lead, a plain session) writes nothing.

### Call-site sketch: the Herdsman pane, end to end

```text
pane activate  -> selectAuthorizer: env marker -> lead id; heartbeat "alive" -> relay
pane ask       -> ParentAuthorizer -> requests/<id>.json in the lead's inbox
lead poll tick -> ForwardedRequestServer: resolve vs recorded authority -> ask -> lead's dialog
lead answers   -> responses/<id>.json -> pane resumes, records decidedBy: {kind: "forwarded", …}
lead exits     -> next pane activation: heartbeat "absent" -> local dialog again
```

### Edge cases

| Case                                                     | Behavior                                                                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Lead switches sessions (withdraw + re-announce, ~1 tick) | An ask landing inside the gap prompts in the pane; visible and answerable, and the next activation relays again                                 |
| Lead exits between selection and the response poll       | That ask fast-fails after the ~2 s grace with `confirmationUnavailable`; the next activation selects the local dialog                           |
| Two UI sessions naming each other                        | Each relays to the other, and each request waits out `forwardingTimeoutMs`; a pathological configuration, recorded as a risk, not guarded       |
| In-process registered child with a UI                    | Relays through the `"registry"` channel; unreachable in production today (see Module-Level Changes) but exercised by the composition-root suite |

## Module-Level Changes

### Production

- `src/authority/permission-forwarding.ts` — remove the `hasUI` option from `resolvePermissionForwardingTarget` and the `"self"` member of `PermissionForwardingTargetSource`; both are dead (Background).
  The self-naming skip (`namesAnotherSession`) stays.
- `src/authority/forwarding-liveness.ts` — remove the two `case "self"` arms from `ForwardingLivenessJudge.isServing` / `describe`.
  `isServing`'s `boolean | null` return is kept: the union still expresses "no channel can answer", and the new selection arm reads it as "do not relay".
- `src/authority/approval-escalator.ts` — drop `hasUI: ctx.hasUI` from the one `resolvePermissionForwardingTarget` call site (~line 223) and reword its adjacent invariant comment.
- `src/authority/authorizer.ts` — extract `buildParentAuthorizer(ctx, deps)` (the 6-field `ParentAuthorizerDeps` literal, currently inline in one arm and needed in two); add module-private `resolveLiveRelayTarget`; add the new `hasUI` arm; add `relayTarget` to `SelectedAuthority` and rewrite the JSDoc that currently reads "a subagent that has its own UI decides locally".
- `src/authority/authorizer-selection.ts` — record relay transitions in `activate`; update the `AdjudicationRole` JSDoc, whose "`selectAuthorizer` tests `hasUI` first, so a subagent with its own UI adjudicates locally" is the exact claim this change narrows.
- `src/authority/subagent-detection.ts` — update `SubagentDetector`'s JSDoc: "Every consumer therefore tests `hasUI` first: `selectAuthorizer` returns before reaching this predicate" is no longer true of the UI arm, which now consults the predicate through the target resolver.
  The predicate's own meaning is unchanged.

Predicted unchanged, with the claim each rests on:

- `src/authority/forwarding-manager.ts` — serving stays `ctx.hasUI` alone; the relay decision reads the serving channel but never writes it.
- `src/service/service-lifecycle.ts` — reads `adjudicatesLocally` through `AdjudicationRole` at emit time, so it picks up the new value with no edit; the only new fact is that the value can differ between the two ready emits.
- `src/handlers/**` — no gate reads the terminal's identity; `GateRunner` escalates through `AskEscalator`.

### Tests

- `test/authority/permission-forwarding.test.ts` — delete the two `hasUI: true` cases and drop the field from the remaining ~14 call sites.
- `test/authority/forwarding-liveness.test.ts` — delete the `SELF_TARGET` fixture and its cases.
- `test/authority/authorizer.test.ts` — neutralize ambient `SUBAGENT_ENV_HINT_KEYS`; rename the two "a subagent with its own UI adjudicates locally" cases to name the reason (no declared parent); add the new relay cases.
- `test/authority/authorizer-selection.test.ts` — neutralize ambient env hints (it shares `makeAuthorizerSelectionDeps`); add the transition-record cases.
- `test/helpers/authorizer-fixtures.ts` — add `neutralizeSubagentEnvHints()` so the loop is not copy-pasted a third time.
- `test/authority/approval-escalator.test.ts` — drop `hasUI` from any `resolvePermissionForwardingTarget` expectations it asserts on.
- `test/composition-root.test.ts` — the `fact-shaping inheritance stops at live authority` test must keep its premise (see Invariants at risk), and gains the end-to-end relay case.
- `test/helpers/forwarding-fixtures.ts` — reuse `publishServingHeartbeat` for the end-to-end case; no new helper expected.

### Docs

- `packages/pi-permission-system/docs/architecture/architecture.md`:
  - the `authorizer.ts` module-tree entry (~line 926), whose "the once-per-activation hasUI/isSubagent/deny dispatch" is now a three-way dispatch with a liveness consult — cite `#909`, which encodes an active constraint;
  - `### The `Authorizer` role` (~line 618) — item 1's "the session has UI; prompt the human here";
  - `## Subagent detection and permission forwarding` (~line 493 and ~line 517) — the "every consumer tests `hasUI` first" sentence, and the parent-session-resolution subsection, which gains the relay rule;
  - `#### Open-issue sweep dispositions` (~line 1074) — add a `[#909]` line (out of scope for Phase 15, same shape as [#907]'s), plus its `[#909]:` definition.
- `packages/pi-permission-system/docs/subagent-integration.md` — the *Out-of-process implementations* section (the paragraph blessing a root that exports the marker) and the *Permission Forwarding* section's opening ("When a delegated or routed subagent runs without direct UI access") both state the old boundary; add the UI-child rule and the liveness condition beside them.
- `packages/pi-permission-system/docs/decisions/0007-model-judge-authorizer-chain-adr.md` §7 — one sentence narrowing "A node with UI (`LocalUserAuthorizer`) … decides locally".
  The ADR is `status: accepted` and its rule is unchanged; only this incidental example is falsified.
- `.pi/skills/package-pi-permission-system/SKILL.md` — the `SessionTurnPrep` paragraph ("do not re-derive that role from `detection.isSubagent(ctx)` — `selectAuthorizer` tests `hasUI` first, so a subagent with its own UI adjudicates locally") and the `ForwardingManager` paragraph's neighboring claim.
- Not touched: `README.md` (greps clean for the forwarding rule — it documents commands and config, not authority selection); `docs/configuration.md:213` ("that is you, the subagent-forwarding path, or a headless deny") stays true as written; `docs/architecture/history/**` and `docs/retro/**` are archives.

## Test Impact Analysis

- **Newly possible.**
  The relay decision is now a pure function of two injected collaborators (`detection` + `serving`) plus `ctx`, so the whole matrix — no marker / self-naming marker / marker with a dead parent / marker with a live parent / registry target — is a unit test over `selectAuthorizer` with no filesystem and no timers.
  Before this change there was nothing to test there: the `hasUI` arm was unconditional.
- **Newly redundant.**
  None.
  The two existing "a subagent with its own UI adjudicates locally" cases stay green as written (their `makeDeps()` resolves no target), but their **names** assert a rule that is no longer universal — they are renamed to name the reason.
- **Must stay as-is.**
  `test/composition-root.test.ts`'s `fact-shaping inheritance stops at live authority`, whose whole point is that a link registered in the parent is not borrowed by a locally-adjudicating child.
  It stays, with its premise repaired (below).
- **Round-trip surface.**
  The end-to-end case follows the package skill's forwarding-test protocol: fire without awaiting, poll the parent's `requests/` dir, write the response, then await — and publish a serving heartbeat (`publishServingHeartbeat`) so the child does not abandon the request in ~2 s.
  Here the heartbeat is load-bearing twice over: it is also the condition the new selection arm reads, so a test that forgets it exercises the *local* arm and silently proves nothing.

## Invariants at risk

- **[#793]'s boundary — live authority is never inherited across nodes.**
  Pinned by `test/composition-root.test.ts`'s `does not resolve an authorizer registered only in the parent`, which the package skill names as the guard that "fails if it is ever wired in".
  The Tidy-First assessment found that this test builds its child with `hasUI: true` **and** registers it in the subagent registry under a parent that is already serving — which is exactly the new relay condition.
  Left alone, the child would relay, `expect(authorize).not.toHaveBeenCalled()` would still pass for the wrong reason, and the test's own comment ("hasUI makes the child adjudicate locally, so its own chain runs — the one shape in which a missing link changes the verdict") would be false.
  Repair: build the **parent** ctx with `hasUI: false` so it publishes its service and its ancestor link but never serves, keeping the child on the local arm for the documented reason.
  The registry registration must stay — `AncestorNodes` walks `parentSessionId`, so removing it would dissolve the ancestor relation the test exists to probe.
- **[#907]'s invariant — a UI host serves its inbox whatever its environment names.**
  Pinned by `test/authority/forwarding-manager.test.ts`'s `it.each(SUBAGENT_ENV_HINT_KEYS)` case.
  This change must not touch `ForwardingManager`; the test is named in the plan so a regression there is a plan violation, not an accident.
- **[#907]'s second invariant — no node resolves itself as its own forwarding target.**
  Pinned by the `namesAnotherSession` cases in `test/authority/permission-forwarding.test.ts`, which the preparatory commit must keep while deleting the `hasUI` cases beside them.
- **ADR 0007 §7 — one chain per node.**
  Pinned by `authorizer-selection.test.ts`'s `authorizer_chain_delegated` cases: a relaying node resolves no links.
  A relaying UI node inherits that behavior for free (it reads `authority.adjudicatesLocally`), and the new tests assert `adjudicatesLocally === false` on the relay arm so the link-resolution path cannot drift from the terminal choice.

## TDD Order

1. **`refactor:` — remove the dead `hasUI` / `"self"` forwarding-target branch.**
   Surface: `src/authority/permission-forwarding.ts`, `src/authority/forwarding-liveness.ts`, `src/authority/approval-escalator.ts`; tests `test/authority/permission-forwarding.test.ts`, `test/authority/forwarding-liveness.test.ts` (delete the two `hasUI: true` cases and the `SELF_TARGET` fixture, drop the field elsewhere).
   Prepares: the new `hasUI` arm calls a resolver that no longer has a parameter it must never set true, and cannot resolve the node to itself.
   Non-behavioral — the removed arm has no production caller — so the full suite is the verification.
   Commit: `refactor(pi-permission-system): drop the unreachable self forwarding target`.
   Killing mutation: none (no behavior added); verify instead that `rg -n '"self"' packages/pi-permission-system/src/authority` returns nothing and the suite is green.

2. **`refactor:` — extract `buildParentAuthorizer` from `selectAuthorizer`.**
   Surface: `src/authority/authorizer.ts`; existing `test/authority/authorizer.test.ts` instance assertions verify it unchanged.
   Prepares: step 4 needs the same 6-field `ParentAuthorizerDeps` literal in a second arm; extracting first keeps that arm one line.
   Commit: `refactor(pi-permission-system): extract buildParentAuthorizer from selectAuthorizer`.
   Killing mutation: none (behavior-identical); the existing `selects ParentAuthorizer …` case must stay green.

3. **`test:` — neutralize ambient subagent env hints in the authorizer fixtures.**
   Surface: `test/helpers/authorizer-fixtures.ts` (new `neutralizeSubagentEnvHints()`), `test/authority/authorizer.test.ts`, `test/authority/authorizer-selection.test.ts` (`beforeEach` / `afterEach` pair, mirroring `approval-escalator.test.ts` and `forwarding-manager.test.ts`).
   Prepares: from step 4 on, both files' UI-context cases read `process.env` through the target resolver; without this they pass or fail on the developer's ambient environment.
   Commit: `test(pi-permission-system): neutralize ambient subagent env hints in authorizer fixtures`.
   Killing mutation: with the helper in place, `vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", "other")` at the top of either file must leave the suite green.

4. **`feat!:` — a UI session relays to a declared, live parent.**
   Surface: `test/authority/authorizer.test.ts` (new cases: env-channel marker + serving parent → `ParentAuthorizer` and `adjudicatesLocally === false`; registry-channel target + serving parent → same; marker naming the reading session → `LocalUserAuthorizer`; marker whose parent reads `absent`/`stale`/`dead_pid` → `LocalUserAuthorizer`; no marker → `LocalUserAuthorizer`; `isServing` answering `null` → `LocalUserAuthorizer`; `hasUI: false` arms unchanged), plus renaming the two existing "own UI adjudicates locally" cases to name the absent parent.
   Implementation: `resolveLiveRelayTarget` + the new `hasUI` arm + `relayTarget` on `SelectedAuthority` in `src/authority/authorizer.ts`; JSDoc rewrites in `authorizer.ts`, `authorizer-selection.ts`, `subagent-detection.ts`.
   Commit: `feat(pi-permission-system)!: prompt in the parent session for a subagent that has its own UI`, with a `BREAKING CHANGE:` footer naming the opt-out (spawn the child without a parent-session marker).
   Killing mutations, one per equivalence class:
   - Drop the `deps.serving.isServing(target) === true` conjunct (relay whenever a target resolves) — must turn the three "parent not serving" cases and the `null` case red, and leave the live-parent cases green.
   - Replace `resolveLiveRelayTarget` with `deps.detection.isSubagent(ctx)` (relay whenever the process looks like a child) — must turn the self-naming-marker case red, since detection answers `true` there while the resolver answers `null`.
   - Restore the unconditional `return LocalUserAuthorizer` — must turn both live-parent cases red.
   - Return `adjudicatesLocally: true` on the new arm — must turn the chain-role assertions red.

5. **`test:` — pin the live-authority boundary and the relay end to end.**
   Surface: `test/composition-root.test.ts`.
   Repair `does not resolve an authorizer registered only in the parent` by building the parent ctx with `hasUI: false` (Invariants at risk), with a comment saying why a serving parent would now change the child's terminal.
   Add an end-to-end case: a `hasUI: true` child whose `PI_SUBAGENT_PARENT_SESSION` names a session with a published heartbeat writes its ask into that session's `requests/` dir instead of prompting locally — following the skill's protocol (fire without awaiting, poll for the request file, write the response, then await).
   Commit: `test(pi-permission-system): pin the live-authority boundary against UI relay`.
   Killing mutations: removing `hasUI: false` from the repaired test's parent ctx must turn it red (its premise is real again); reverting step 4's arm must turn the end-to-end case red.

6. **`feat:` — record relay transitions once per change.**
   Surface: `test/authority/authorizer-selection.test.ts` (a first relaying activation writes `forwarded_permission.relay_started` with the target id and channel; repeated identical activations write nothing more; an activation that stops relaying writes `forwarded_permission.relay_stopped`; a target change writes a stop/start pair; a never-relaying node writes neither).
   Implementation: `recordRelayTransition` in `src/authority/authorizer-selection.ts`, reading `SelectedAuthority.relayTarget`.
   Commit: `feat(pi-permission-system): record when a session starts or stops relaying its asks`.
   Killing mutations: remove the change guard (log on every activation) — must turn the "repeated activations write nothing more" case red; drop the `relayTarget` read and log a bare role change — must turn the target-change case red.

7. **`docs:` — publish the rule.**
   Surface: every file in the Docs subsection of Module-Level Changes.
   Verify with `pnpm exec rumdl check` on the touched files plus a grep that no doc still asserts the old universal ("a subagent with its own UI adjudicates locally"; "every consumer tests `hasUI` first").
   Commit: `docs(pi-permission-system): document relaying from a session that has its own UI`.

## Risks and Mitigations

| Risk                                                                                                   | Mitigation                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A UI `pi` started as a descendant of a marker-carrying process silently relays to a stranger's session | Narrow by construction: it needs both an inherited marker naming *another* session and that session actively serving. The transition record (step 6) names the target the first time it happens, so the surprise is diagnosable in one log line rather than invisible.                                                                 |
| Two UI sessions naming each other ping-pong until `forwardingTimeoutMs`                                | A pathological configuration with no known producer; each hop is asynchronous polling, so nothing blocks a process, and the existing self-target skip already covers the one-node case. Recorded here rather than guarded, because a general cycle guard needs a hop list on the wire — a wire change out of proportion to the hazard. |
| The heartbeat read moves onto the per-turn path                                                        | One `readFileSync` of one small JSON file per activation, on a directory the serving side already rewrites four times a second. No new I/O class; if it ever shows up, the answer is a short-lived cache in `AuthorizerSelection`, not a different design.                                                                             |
| A relaying pane shows nothing while it waits                                                           | Named as a Non-Goal and routed to [#658] / PR [#693], which exist for exactly this signal. The pane's agent still sees the eventual decision and the refusal text.                                                                                                                                                                     |
| `adjudicatesLocally` on `permissions:ready` can go stale mid-session                                   | Consumers use it to decide *whether to register*, and ADR 0012 decision 4 makes registering everywhere correct — a vacancy is recorded, never refused. Consultation reads the live selection per ask. Documented in step 7.                                                                                                            |
| The preparatory removal in step 1 hides a caller I did not find                                        | The step is verified by the full suite, and the removal is a compile-time signature change: any missed caller fails `tsc`, not silently.                                                                                                                                                                                               |

## Open Questions

- Should the selection apply a short grace window (as `ParentAuthorizer` does) before it treats a flapping parent as gone?
  Deferred until someone reports a pane prompting locally during a lead session switch — the current behavior in that window is a visible, answerable dialog, not a failure.
- Should a relaying node refuse to relay a request that arrives in *its* inbox (the two-hop case), rather than passing it upward?
  Today it passes it upward, which is what the `lead → agent → agent` topology needs.
  Revisit only if a cycle is observed in the wild.

[#658]: https://github.com/gotgenes/pi-packages/issues/658
[#693]: https://github.com/gotgenes/pi-packages/pull/693
[#722]: https://github.com/gotgenes/pi-packages/issues/722
[#793]: https://github.com/gotgenes/pi-packages/issues/793
[#861]: https://github.com/gotgenes/pi-packages/issues/861
[#907]: https://github.com/gotgenes/pi-packages/issues/907
