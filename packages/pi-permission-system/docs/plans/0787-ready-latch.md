---
issue: 787
issue_title: "pi-permission-system: re-emit permissions:ready at the first before_agent_start (ADR 0012 decision 3, the ready latch)"
---

# The ready latch: re-emit `permissions:ready` at the first `before_agent_start`

## Release Recommendation

**Release:** mid-batch — defer (batch "ADR 0012 cross-node contract"); confirm at ship time

[ADR 0012] decision 7 stages the whole contract as **one minor release**: the keyed publication and locator, the ready-payload fields, the vacant-cell record, the accessor deprecation (all landed under [#699]), this latch, and the docs consolidation ([#789]).
The batch tail is [#789], per [#699]'s plan and retro — the release-please PR carrying [#699]'s unreleased `feat:` commits stays unmerged until this issue lands **and** [#789] has rewritten `docs/cross-extension-api.md`.
So `/ship-issue` should land this work on `main` and leave the release-please PR open.

## Problem Statement

`permissions:ready` fires only inside this package's own `session_start`.
Pi runs extensions' `session_start` handlers in load order, so a consumer that needs its own config before it can register — [`@gotgenes/pi-permission-model-judge`][judge] is the live example — cannot know whether this package's `session_start` ran before or after its own.
It must therefore attempt registration from **both** `session_start` and `permissions:ready` behind an idempotency guard, because either one can be the call that completes the pair.

[ADR 0012] decision 3 kills that dual path with a latch: re-emit `permissions:ready` once per session at the first `before_agent_start`, which runs after every extension's `session_start` and before any tool call, hence before any ask.
The channel's contract becomes "fires at least once per session, and may repeat; handlers must be idempotent", which makes the ready event alone a sufficient registration site.

## Goals

- Re-emit `permissions:ready` once per session at the first `before_agent_start`, carrying the same `{ sessionId, adjudicatesLocally }` facts [#699] added.
- Keep the emission a function of one code path, so the two emissions cannot drift in shape.
- Preserve the ordering contract a consumer relies on: at every emission, `getPermissionsServiceForSession(payload.sessionId)` already resolves.
- Update the channel's documented contract (source comments, `docs/cross-extension-api.md`, `docs/architecture/architecture.md`, the package skill) and carry the decision-7 release-note callout.
- Land the latch **without** growing `AgentPrepHandler`: extract the per-turn session preparation it already performs into its own collaborator first (Tidy First), so the latch trigger joins a cohesive routine rather than a fifth constructor dependency on a filtering handler.

Not a breaking change.
The payload type is unchanged, so the `permission-events.ts` stability guarantee ("fields may be added; existing fields will not be removed or renamed") is untouched.
An unguarded consumer that registers on every emission hits the duplicate-registration throw, which the SDK event bus catches and `console.error`s — bus-caught stderr noise, not a broken gate, and its first registration and stored disposer both survive because the throw precedes the assignment.
That failure class also already exists: `activate` emits on every `session_start`, including `/reload`, which `docs/cross-extension-api.md` documents today.
The latch makes an existing hazard common rather than creating a new one, which is exactly how [ADR 0012] decision 7 classifies it: minor, with a release-note callout.

## Non-Goals

- **The judge migration** — collapsing `pi-permission-model-judge`'s dual path onto one idempotent ready handler is [#788], and it consumes the released version.
  This plan changes no code in that package; its existing `if (dispose || …) return` guard already makes the re-emit a no-op.
- **The `docs/cross-extension-api.md` rewrite** — [#789] rewrites that document wholesale (the adapter-convention home and the loading-asymmetry statement, [ADR 0012] decisions 5 and 6).
  This plan makes only the correctness edits and the idempotency callout listed in Module-Level Changes.
- **New payload fields** — the ready payload carries exactly what [#699] gave it.
- **Refusing or coding duplicate registrations** — [ADR 0012] decision 4 settles that a vacant link registration is accepted and observed, and that machine-readable `code` properties wait for a real consumer need.
- **The zero-arg accessor** — its deprecation warning landed with [#699]; removal stays a future major.
- **Renaming `AgentPrepHandler`** — the extraction below narrows it to tool filtering and prompt sanitization, but a rename has a documentation blast radius disproportionate to this change (see Open Questions).

## Background

Relevant modules, as they stand on `main` after [#699]:

- `src/service-lifecycle.ts` — `ServiceLifecycle` interface plus `PermissionServiceLifecycle`.
  `activate(ctx)` publishes the service under `readSessionId(ctx)` (and into the legacy root slot unless this is a registered child, [#302]), then calls `emitReadyEvent(this.events, { sessionId, adjudicatesLocally: this.role.adjudicatesLocally() })`.
  `teardown()` unsubscribes and unpublishes.
- `src/handlers/lifecycle.ts` — `SessionLifecycleHandler.handleSessionStart` calls `serviceLifecycle.activate(ctx)` last, after config refresh and reset.
- `src/handlers/before-agent-start.ts` — `AgentPrepHandler.handle(event, ctx)` is the sole `before_agent_start` handler.
  It runs `warmParser()` (fire-and-forget tree-sitter warm-up, [#309]), `session.activate(ctx)`, `session.refreshConfig(ctx, ctx.isProjectTrusted())` (the trust gate from [#644]), then resolves the agent name, filters the active tool set, and sanitizes the system prompt, returning a `{ systemPrompt }` override.
- `src/permission-events.ts` — channel constants, `PermissionsReadyEvent`, and the throw-swallowing `emitReadyEvent` helper.

Constraints that apply:

- The SDK event bus hands a handler only the payload and wraps it in `try`/`catch` + `console.error` ([ADR 0012] context, fact 1) — so a consumer throw on the re-emit is stderr noise, and our own emit helper additionally swallows listener throws.
- `pi.on` **appends** to a per-event handler list and the runner iterates every one, verified in the installed `@earendil-works/pi-coding-agent@0.79.1` (`dist/core/extensions/loader.js:153`, `dist/core/extensions/runner.js:756`) — a second `pi.on("before_agent_start", …)` would be legal.
  It is nonetheless not the route taken here: `test/helpers/make-fake-pi.ts` records handlers in a `Map<string, RecordedHandler>`, so a second registration would silently overwrite the first in every composition-root test, and migrating the fixture to arrays would also force a decision about what `fire()` returns when several handlers answer.
- Module-scoped state does not reset per session, but everything constructed inside the extension factory does (package skill, "Jiti isolation") — the latch flag lives on the factory-scoped `PermissionServiceLifecycle` instance, not at module scope.
- `AGENTS.md`: do not name an unreleased version in docs; the release-note callout describes the condition, not a version number.

## Design Overview

### 1. Tidy First — extract the per-turn session preparation

`AgentPrepHandler` already performs two unrelated jobs: it prepares the node for the turn about to start (warm the parser, activate the session, refresh config under the trust gate) and it filters tools and sanitizes the prompt.
Hanging the latch trigger off it directly would make that three jobs and five constructor dependencies.
The preparation half is cohesive on its own — everything that must be true before this node answers a question this turn — and the latch trigger belongs precisely there, beside `activate`, not beside tool filtering.

So a preparatory `refactor:` commit lands first, moving those three statements onto a new collaborator with its own narrow session seam:

```typescript
/** The session surface the turn-prep routine drives. */
export interface TurnPrepSession {
  activate(ctx: ExtensionContext): void;
  refreshConfig(ctx: ExtensionContext | undefined, projectTrusted: boolean): void;
}

/** What `AgentPrepHandler` asks for; `SessionTurnPrep` provides it. */
export interface TurnPreparation {
  prepare(ctx: ExtensionContext): void;
}

export class SessionTurnPrep implements TurnPreparation {
  constructor(
    private readonly session: TurnPrepSession,
    private readonly warmParser: () => void,
  ) {}

  prepare(ctx: ExtensionContext): void {
    this.warmParser();
    this.session.activate(ctx);
    this.session.refreshConfig(ctx, ctx.isProjectTrusted());
  }
}
```

`PermissionSession` satisfies `TurnPrepSession` structurally, so `index.ts` passes the same instance it already holds.
`AgentPrepHandler`'s constructor becomes `(turnPrep, session, resolver, toolRegistry)` — still four dependencies, one job — and `handle` opens with `this.turnPrep.prepare(ctx)`.
This is not procedure-splitting: the extracted unit owns a named concern, is depended on through an interface, and gives the latch a home that `AgentPrepHandler` would only have relayed.

### 2. The latch itself

The flag and the emission stay inside `PermissionServiceLifecycle`, which already owns every ready emission.
It gains a second published role, kept separate from `ServiceLifecycle` so `SessionLifecycleHandler` (which only starts and tears down) is not handed a method it must not call:

```typescript
/** Announces this node's ready facts at most once per activation cycle. */
export interface ReadyAnnouncer {
  announceReady(ctx: ExtensionContext): void;
}

export class PermissionServiceLifecycle implements ServiceLifecycle, ReadyAnnouncer {
  private announced = false;

  activate(ctx: ExtensionContext): void {
    this.announced = false; // re-arm: the next before_agent_start announces again
    // …publish keyed slot, publish root slot unless registered child…
    this.emitReady(ctx);
  }

  announceReady(ctx: ExtensionContext): void {
    if (this.announced) return;
    this.announced = true;
    this.emitReady(ctx);
  }

  private emitReady(ctx: ExtensionContext): void {
    emitReadyEvent(this.events, {
      sessionId: readSessionId(ctx),
      adjudicatesLocally: this.role.adjudicatesLocally(),
    });
  }
}
```

Four semantics are settled here:

1. **One code path, one shape.**
   Both emissions go through `emitReady`, which recomputes both facts from the `ctx` it is handed — no captured payload to replay and no second declaration to keep in sync.
2. **Re-arm on every `activate`.**
   A `/reload`, `/new`, or `/resume` runs `session_start` again, so the cycle repeats: one emission at `session_start`, one at the following `before_agent_start`.
   A consumer whose own `session_start` ran after ours still gets a post-everything emission in the new generation.
3. **At least once, even without `activate`.**
   The flag starts `false`, so a node that somehow reaches `before_agent_start` without a `session_start` still announces.
4. **The service resolves at both emissions.** `activate` publishes before emitting, and the latch fires strictly later, so the payload's own `sessionId` is a live key whenever a handler runs.

### 3. Consumer call site

The latch changes nothing structural for a consumer; it removes the need for the second registration site.
The post-latch shape is one idempotent handler:

```typescript
let dispose: (() => void) | undefined;
pi.events.on(PERMISSIONS_READY_CHANNEL, (data) => {
  const { sessionId } = data as PermissionsReadyEvent;
  if (dispose || !sessionId) return; // idempotent: ready may repeat
  dispose = getPermissionsServiceForSession(sessionId)?.registerAuthorizer(name, authorize);
});
```

The `if (dispose …) return` guard is the whole obligation the contract puts on a consumer, and it is what the documentation callout must make explicit.

### 4. Wiring

`index.ts` constructs `SessionTurnPrep` from the session, the warm trigger, and the lifecycle instance (as `ReadyAnnouncer`), and passes it to `AgentPrepHandler`.
The `before_agent_start` registration is unchanged — still one handler, still `agentPrep.handle`.

## Module-Level Changes

Symbol grep performed for every touched name (`AgentPrepHandler`, `PermissionServiceLifecycle`, `emitReadyEvent`, `permissions:ready`) across `src/`, `test/`, `packages/*/docs/`, `.pi/skills/`, and `README.md`; the results are the file list below.
No export is removed or renamed, so no consumer-side breakage exists to sequence.

| File                                               | Change                                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/handlers/session-turn-prep.ts`                | **New.** `TurnPrepSession`, `TurnPreparation`, `SessionTurnPrep` — warm trigger, `session.activate`, trust-gated `refreshConfig`, then the ready announcement.                                                                                                          |
| `src/handlers/before-agent-start.ts`               | `AgentPrepHandler` takes `TurnPreparation` in place of the session/warm-trigger preparation statements; `handle` opens with `this.turnPrep.prepare(ctx)`; class doc comment updated to the new dependency list.                                                         |
| `src/service-lifecycle.ts`                         | New `ReadyAnnouncer` interface; `PermissionServiceLifecycle` implements it, gains the `announced` flag, the private `emitReady`, and re-arms in `activate`; class doc records the latch and the "at least once per session" contract.                                   |
| `src/permission-events.ts`                         | `PERMISSIONS_READY_CHANNEL` and `emitReadyEvent` doc comments restate the contract: emitted at `session_start` after publication and re-emitted at the first `before_agent_start`; at least once per session, may repeat; handlers must be idempotent.                  |
| `src/index.ts`                                     | Construct `SessionTurnPrep(session, warmParser, serviceLifecycle)` and pass it to `AgentPrepHandler`; the comment above `serviceLifecycle` notes it also announces at the latch.                                                                                        |
| `test/handlers/session-turn-prep.test.ts`          | **New.** The four lifecycle assertions moved out of `before-agent-start.test.ts`, plus the announcement trigger.                                                                                                                                                        |
| `test/handlers/before-agent-start.test.ts`         | `makeSetup` builds a **real** `SessionTurnPrep` over the same real session (so no assertion silently loses session activation), and exposes it for a delegation assertion; the four moved tests are deleted.                                                            |
| `test/service-lifecycle.test.ts`                   | New `announceReady` describe block: emits once, no-ops on repeat, re-arms after `activate`, emits without a prior `activate`, recomputes the payload from the passed `ctx`.                                                                                             |
| `test/composition-root.test.ts`                    | New end-to-end latch test: after `session_start`, two `before_agent_start` fires produce exactly one extra emission, and the payload's `sessionId` resolves at each.                                                                                                    |
| `docs/cross-extension-api.md`                      | Correctness edits plus the callout: the "How It Works" sentence naming `session_start` as the emission point, the Channel Reference `When` cell, and the Ready Event section's "It fires once per `session_start`" claim.                                               |
| `docs/architecture/architecture.md`                | §Cross-extension service accessor: drop "the ready latch (decision 3) is not yet [implemented]" and state the latch; module tree entries for `before-agent-start.ts` (new dependency list), `service-lifecycle.ts` (the latch), and a new `session-turn-prep.ts` entry. |
| `.pi/skills/package-pi-permission-system/SKILL.md` | The "still-unimplemented half" sentence loses the latch; the `PermissionServiceLifecycle` paragraph records that the ready emit now happens at `session_start` **and** at the first `before_agent_start`, triggered through `SessionTurnPrep`.                          |

Checked and **not** changed: `README.md` and `docs/subagent-integration.md` (no `permissions:ready` or `before_agent_start` mention), `docs/configuration.md` (its authorizer-registration sentence stays correct under the latch), `docs/decisions/0012-cross-node-extension-contract.md` (an accepted record of the decision, not a status board), and `packages/pi-permission-model-judge/` (its guard already absorbs the re-emit; its migration is [#788]).

## Test Impact Analysis

**What the extraction enables.**
The per-turn preparation sequence — warm, activate, trust-gated refresh, announce — becomes directly unit-testable without constructing a tool registry, a resolver, or a system prompt.
The latch trigger in particular gets a two-line test instead of an assertion buried behind prompt sanitization.

**What becomes redundant.**
The four `AgentPrepHandler.handle` tests that assert lifecycle behavior ("activates the session with ctx", "triggers the bash-parser warm-up", "refreshes config with ctx, gated on project trust", "withholds the project scope when the project is untrusted") move to `session-turn-prep.test.ts` rather than being duplicated.
One replacement stays in `before-agent-start.test.ts` — that `handle` delegates preparation before it reads any session state — because that ordering is the handler's own contract.

**What must stay as-is.**
Every tool-filtering and prompt-sanitization test in `before-agent-start.test.ts` (the `setActive` on every turn, the byte-stable wire prompt, the `Available tools:` narrowing, the per-turn skill filtering).
They depend on a session that has actually been activated, which is why `makeSetup` keeps a real `SessionTurnPrep` instead of a `{ prepare: vi.fn() }` double.

**Measured baseline.**
`test/handlers/before-agent-start.test.ts` is 336 lines; `src/handlers/before-agent-start.ts` is 106.
The only `new AgentPrepHandler(...)` sites are `src/index.ts` and that test's `makeSetup`, and the only `new PermissionServiceLifecycle(...)` sites are `src/index.ts` and `test/service-lifecycle.test.ts` — so no lift-and-shift staging is needed.

## Invariants at risk

| Invariant                                                                                                                              | Source                                                                                       | Pinned by                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| The tree-sitter parser is warmed fire-and-forget on every `before_agent_start`, so the advisory bash path reaches gate parity ([#309]) | `AgentPrepHandler` doc comment                                                               | "triggers the bash-parser warm-up", moved to `session-turn-prep.test.ts`                                                 |
| The mid-session config refresh is gated on project trust and does not re-warn ([#644])                                                 | `AgentPrepHandler` doc comment                                                               | "refreshes config with ctx, gated on project trust" + "withholds the project scope when the project is untrusted", moved |
| The service is published before ready fires, so a handler can resolve the payload's `sessionId` immediately ([#699])                   | `test/composition-root.test.ts`, "publishes the service before emitting `permissions:ready`" | Existing test, plus the new latch test asserting the same at the second emission                                         |
| The active set and prompt override are recomputed every fire, keeping the wire prompt byte-stable                                      | `AgentPrepHandler` doc comment                                                               | "calls setActive on every turn (no dedup gate)", "keeps the wire system prompt byte-stable…" — untouched                 |
| A relaying node reports `adjudicatesLocally: false` on its ready payload ([ADR 0007] §7)                                               | `test/composition-root.test.ts`, "announces the node's session id and chain role"            | Existing test; it fires only `session_start`, so its exact-array assertion still sees one emission                       |

**Quantitative prediction.**
Ready emissions per activation cycle go from **1** (measured: `expect(parentReady).toEqual([{ … }])` in `composition-root.test.ts` after a single `session_start`) to **2** — one at `session_start`, one at the first subsequent `before_agent_start`, regardless of how many turns follow.
The new composition-root test pins the number by firing `before_agent_start` twice and asserting exactly two emissions in total.

## TDD Order

1. **Extract the per-turn preparation.**
   Red: `test/handlers/session-turn-prep.test.ts` asserts `prepare` warms the parser, activates the session with `ctx`, and refreshes config gated on `ctx.isProjectTrusted()`.
   Green: add `src/handlers/session-turn-prep.ts`; `AgentPrepHandler` delegates; `index.ts` and `makeSetup` construct it; delete the four moved tests and add the delegation test.
   Commit: `refactor(pi-permission-system): extract SessionTurnPrep from AgentPrepHandler (#787)`
2. **Add the once-per-session announcer.**
   Red: `test/service-lifecycle.test.ts` asserts `announceReady` emits the node's facts once, no-ops on a second call, emits again after a further `activate`, emits with no prior `activate`, and recomputes `sessionId`/`adjudicatesLocally` from the `ctx` it is passed.
   Green: `ReadyAnnouncer`, the `announced` flag, the private `emitReady`, and the re-arm in `activate`.
   Nothing calls it yet, so this is structural.
   Commit: `refactor(pi-permission-system): add the once-per-session ready announcer (#787)`
3. **Fire the latch at the first `before_agent_start`.**
   Red: `session-turn-prep.test.ts` asserts `prepare` announces with `ctx` after activating; `composition-root.test.ts` fires `session_start` then `before_agent_start` twice and asserts exactly two `permissions:ready` emissions, each with a `sessionId` that resolves through `getPermissionsServiceForSession`.
   Green: `SessionTurnPrep` takes the `ReadyAnnouncer`; `index.ts` passes the lifecycle instance.
   Commit body carries the release-note callout ("`permissions:ready` now fires at least once per session and may repeat; a handler that registers must be idempotent").
   Commit: `feat(pi-permission-system): re-emit permissions:ready at the first before_agent_start (#787)`
4. **Document the contract.**
   No test cycle; update `docs/cross-extension-api.md`, `docs/architecture/architecture.md`, and `.pi/skills/package-pi-permission-system/SKILL.md` per Module-Level Changes (source-comment edits ride steps 1–3).
   Commit: `docs(pi-permission-system): document the ready latch and its idempotency requirement (#787)`

## Risks and Mitigations

| Risk                                                                                | Mitigation                                                                                                                                                                          |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An unguarded external consumer registers twice and throws                           | Bus-caught stderr noise, not breakage; the first registration and disposer survive. Documented contract change plus the decision-7 release-note callout in the step 3 commit body.  |
| The extraction silently drops session activation from the handler's remaining tests | `makeSetup` keeps a **real** `SessionTurnPrep` over the same real session, so the remaining assertions run against an activated session exactly as today.                           |
| The two emissions drift in shape as fields are added later                          | Both go through one private `emitReady`; the service-lifecycle test asserts the payload is recomputed from the passed `ctx`.                                                        |
| An existing exact-equality ready assertion breaks                                   | `composition-root.test.ts`'s ready assertions fire only `session_start`, so they still observe one emission; verified by running the full suite in step 3.                          |
| The in-repo `pi-permission-model-judge` double-registers                            | Its `tryRegister` returns early when `dispose` is set (`packages/pi-permission-model-judge/src/extension.ts`), so the re-emit is a no-op. Its dual path dies with [#788], not here. |
| Release ordering slips and the keyed channel ships without the latch                | The plan's `Release:` marker is `mid-batch — defer`; `/ship-issue` leaves the release-please PR open until [#789] lands.                                                            |

## Open Questions

- **Should `AgentPrepHandler` be renamed** once it is filtering-and-sanitization only?
  Deferred: the name appears across `docs/architecture/architecture.md`, several plans, and the package skill, and the rename buys clarity rather than behavior.
  Revisit if the handler grows again.
- **Should the latch emission be recorded in the debug log?**
  Declined for now — it would add a logger dependency to `PermissionServiceLifecycle` for an event that is already observable on the bus.
  Reconsider if an operator ever needs to distinguish the two emissions from outside the bus.

[ADR 0007]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0007-model-judge-authorizer-chain-adr.md
[ADR 0012]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0012-cross-node-extension-contract.md
[judge]: https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-model-judge
[#302]: https://github.com/gotgenes/pi-packages/issues/302
[#309]: https://github.com/gotgenes/pi-packages/issues/309
[#644]: https://github.com/gotgenes/pi-packages/issues/644
[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#788]: https://github.com/gotgenes/pi-packages/issues/788
[#789]: https://github.com/gotgenes/pi-packages/issues/789
