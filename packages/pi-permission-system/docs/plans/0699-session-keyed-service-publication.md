---
issue: 699
issue_title: "pi-permission-system: Sibling authorizer extensions cannot detect registered child sessions → spurious \"already registered\" on every subagent start"
---

# Session-keyed service publication and the vacant link cell

## Release Recommendation

**Release:** mid-batch — defer (batch "ADR 0012 cross-node contract"); confirm at ship time

[ADR 0012] decision 7 stages the whole contract as **one minor release**: the keyed publication and locator, the ready-payload fields, the ready latch ([#787]), the vacant-cell record, and the accessor deprecation.
Shipping this issue's mechanisms without the latch would leave the dual-path registration workaround alive, which is the thing the contract exists to kill.
So the release-please PR stays unmerged until [#787] lands and [#789] has rewritten `docs/cross-extension-api.md`; [#788] (the judge migration) then consumes the released version.
There is no open improvement phase in this package, so no roadmap `Release:` tag governs this issue — the batch is the ADR's staging, not a roadmap batch.

## Problem Statement

[#699] reports that a sibling authorizer extension loaded into an in-process subagent child calls `getPermissionsService().registerAuthorizer(...)`, reaches the **parent's** service, and throws `An authorizer is already registered for '<name>'.` on every subagent start.

Planning for [#786] showed the throw is the loud half of a wider gap, and [ADR 0012] settled the contract.
The quiet half is worse: the service carries three registries read by *different* nodes.
A child runs its own gates and fixes an ask's facts before forwarding ([#635]), so a child needs its own extractors and formatters — an in-process child's sibling registering into the parent's service therefore gets the duplicate throw parent-side **and** a missing extractor child-side, silently weakening `path` / `external_directory` gating for custom-path extension tools in that child.

This issue is the implementation home for [ADR 0012] decisions 2 and 4, plus the accessor-deprecation warning that decision 7 assigns to the decision-2 work.
The reporter's original proposals (an exported child detector, a typed duplicate-registration error) are superseded by the contract: a detector-keyed fix is process-specific by construction, and a post-contract duplicate is a genuine author bug that should surface raw.

## Goals

- Each node publishes its `PermissionsService` into a process-global map keyed by its own session id, and a keyed locator becomes the supported way to obtain a node's service for registration and queries (decision 2).
- `PermissionsReadyEvent` carries the two plain facts a consumer needs: `sessionId` (the locator key) and `adjudicatesLocally` (whether this node's chain runs or it relays).
- A link registered on a relaying node is accepted, returns a working disposer, and is recorded in the review log as a vacant link cell — never silently vacant (decision 4).
- The zero-arg `getPermissionsService()` keeps working unchanged and emits a once-guarded runtime `DeprecationWarning` naming the keyed replacement (decision 7).
- The legacy root slot keeps its [#302] guard behavior verbatim, so nothing published today changes shape.

Not breaking.
Every change is additive: a new locator beside the old accessor, fields added to a deliberately-empty payload, a new review-log event type, and a runtime warning with no behavior change.
Removal of the zero-arg accessor is deferred to an unscheduled future major.

## Non-Goals

- **The ready latch** — re-emitting `permissions:ready` at the first `before_agent_start` is [#787], shipping in the same minor.
- **The `pi-permission-model-judge` migration** — [#788]; this issue leaves that package on the legacy accessor, where it keeps working (and emits one deprecation warning per process until migrated).
- **The `docs/cross-extension-api.md` rewrite** — [#789] rewrites it wholesale once the latch lands; this issue makes only the correctness edits listed in Module-Level Changes.
- **The subagent adapter convention and loading-asymmetry docs** — [ADR 0012] decisions 5 and 6, also [#789].
- **Machine-readable duplicate-registration error codes** — declined by decision 4; `AuthorizerRegistry.register` keeps throwing a bare `Error`, and PR [#702] is closed as superseded at ship time.
- **Requester-context facts-widening** — letting a link distinguish a forwarded ask is named in the ADR's Consequences as a future extension needing its own deliberation.
- **Removing the zero-arg accessor** — future major, contingent on downstream migration.

## Background

Relevant current mechanism, all re-read at planning time:

| Module                                  | What it does today                                                                                                                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/service.ts`                        | The package's public entry (`exports` `default`). One `Symbol.for("…:service")` slot plus `publishPermissionsService` / `getPermissionsService` / `unpublishPermissionsService` (identity compare-and-delete since [#302]). |
| `src/service-lifecycle.ts`              | `PermissionServiceLifecycle.activate(ctx)` publishes unless `detection.isRegisteredChild(ctx)`, then emits ready unconditionally; `teardown()` runs subscriptions, then unpublishes.                                        |
| `src/permission-events.ts`              | `PermissionsReadyEvent = Record<string, never>`; `emitReadyEvent(events)` builds the empty payload itself.                                                                                                                  |
| `src/authority/authorizer-selection.ts` | `activate(ctx)` stores the `SelectedAuthority` from `selectAuthorizer`; `linksFor` resolves no links and logs `authorizer_chain_delegated` when `!authority.adjudicatesLocally`.                                            |
| `src/authority/authorizer-registry.ts`  | `AuthorizerRegistry` (`AuthorizerLookup` + `AuthorizerRegistrar`); one instance in `index.ts`; throw-on-duplicate, identity-guarded disposer.                                                                               |
| `src/handlers/lifecycle.ts`             | `handleSessionStart` calls `session.resetForNewSession(ctx, …)` — which calls `authorizerSelection.activate(ctx)` — **before** `serviceLifecycle.activate(ctx)`.                                                            |
| `src/authority/subagent-context.ts`     | `isRegisteredSubagentChild` already reads `ctx.sessionManager.getSessionId()` inside a `try`/`catch`, treating an unavailable id as "not a child".                                                                          |

Constraints from `AGENTS.md` and the package skill that bind this change:

- The SDK bus hands `pi.events.on` handlers **only the payload** — there is no `ctx` at `permissions:ready`, which is why the fact must travel as data.
- `Symbol.for()` + `globalThis` is the only cross-extension channel that survives jiti isolation; `getSubagentSessionRegistry()` / `getServingSessionRegistry()` are the two existing precedents for a process-global store behind an accessor.
- `src/service.ts` is bundled into a self-contained `dist/public.d.ts`; `scripts/verify-public-types.sh` (run in CI) greps that bundle for an explicit symbol list.
- Composition-root tests must clear every `Symbol.for()` slot the factory mutates in `afterEach`.
- ADR 0007 §7 (one chain per node) stands unamended: a relaying node resolves no links.

## Design Overview

### The keyed store and locator

One new process-global slot holds a `Map<string, PermissionsService>` keyed by session id, beside the existing single root slot:

```typescript
// src/service.ts
const SESSION_SERVICES_KEY = Symbol.for(
  "@gotgenes/pi-permission-system:session-services",
);

export function publishPermissionsServiceForSession(
  sessionId: string,
  service: PermissionsService,
): void;

/** The supported way to obtain a node's service, for registration and queries. */
export function getPermissionsServiceForSession(
  sessionId: string,
): PermissionsService | undefined;

/** Identity compare-and-delete, mirroring `unpublishPermissionsService`. */
export function unpublishPermissionsServiceForSession(
  sessionId: string,
  service: PermissionsService,
): void;
```

The name is a distinct symbol rather than an overload of `getPermissionsService`, decided at the planning gate: the whole zero-arg function then carries `@deprecated` (editors strike it through, and the future-major removal is a clean delete), and a consumer holding `string | undefined` cannot silently land on the deprecated path.

The map is not exported; tests clear the slot through `Symbol.for(...)` directly, the pattern `composition-root.test.ts` and `subagent-registry.test.ts` already use for the other global slots.

### The ready payload

```typescript
// src/permission-events.ts
export interface PermissionsReadyEvent {
  /**
   * The emitting node's session id — the key for
   * `getPermissionsServiceForSession`. `null` when the host did not expose one,
   * in which case this node published no keyed service.
   */
  sessionId: string | null;
  /**
   * Whether this node's authorizer chain runs (`true`) or the node relays its
   * asks to a serving node (`false`, ADR 0007 §7). A link registered on a
   * relaying node is accepted but never consulted.
   */
  adjudicatesLocally: boolean;
}

export function emitReadyEvent(
  events: PermissionEventBus,
  event: PermissionsReadyEvent,
): void;
```

`sessionId` is nullable by the gate's decision: this package already reads `getSessionId()` defensively, `ForwardedPromptContext.requesterSessionId: string | null` is the precedent in the same file, and forcing the consumer's null check gives it a safe no-op instead of a call with `undefined`.
`emitReadyEvent` gains the payload parameter, matching its two siblings (`emitUiPromptEvent` / `emitDecisionEvent`), which take the event they emit.

### Where the two facts come from

`readSessionId` becomes a shared, defensive read; `adjudicatesLocally` comes from a new one-method seam on the selection that already owns the answer:

```typescript
// src/authority/authorizer-selection.ts
export interface AdjudicationRole {
  adjudicatesLocally(): boolean;
}
```

`AuthorizerSelection` implements it as `this.authority?.adjudicatesLocally ?? true`.
The `?? true` branch is unreachable in production (`authorizerSelection.activate` runs inside `resetForNewSession`, before `serviceLifecycle.activate` — verified in `handlers/lifecycle.ts`), and `true` is the fail-soft direction: it says "register everywhere", which the accept-and-observe rule makes harmless.
Deriving the role from `detection.isSubagent(ctx)` instead would be wrong — `selectAuthorizer` tests `hasUI` first, so a subagent with its own UI adjudicates locally.

The lifecycle then reads as:

```typescript
activate(ctx: ExtensionContext): void {
  const sessionId = readSessionId(ctx);
  if (sessionId !== null) {
    publishPermissionsServiceForSession(sessionId, this.service);
    this.publishedSessionId = sessionId;
  }
  if (!this.detection.isRegisteredChild(ctx)) {
    publishPermissionsService(this.service);
  }
  emitReadyEvent(this.events, {
    sessionId,
    adjudicatesLocally: this.role.adjudicatesLocally(),
  });
}
```

`teardown()` removes the keyed entry it published (identity-guarded, by the remembered key) before the existing identity-scoped legacy unpublish.
Remembering the key rather than re-reading a ctx keeps teardown correct when `activate` ran twice with different ids; a superseded `/reload` generation still cannot evict the fresh one, because both deletes compare identity.

`PermissionServiceLifecycle`'s constructor grows from four collaborators to five (`service`, `detection`, `role`, `events`, `subscriptions`).
That is at the design-review width limit, and each addition is a single-method seam rather than a data bag, so no intermediate abstraction is introduced: `RegisteredChildDetector` answers "may this node own the root slot", `AdjudicationRole` answers "does this node's chain run" — two different questions with two different owners.

### Decision 4: accept and observe

The registrar surface is decorated rather than the registry changed, so `AuthorizerRegistry` keeps its single responsibility (storage, throw-on-duplicate) and `LocalPermissionsService` is untouched — it already depends on the narrow `AuthorizerRegistrar`:

```typescript
// src/authority/authorizer-registry.ts
export class ObservedAuthorizerRegistrar implements AuthorizerRegistrar {
  constructor(
    private readonly registrar: AuthorizerRegistrar,
    private readonly role: AdjudicationRole,
    private readonly logger: ReviewLogger,
  ) {}

  register(name: string, authorize: Authorizer["authorize"]): () => void {
    const dispose = this.registrar.register(name, authorize);
    if (!this.role.adjudicatesLocally()) {
      this.logger.review("authorizer_link_vacant", { name });
    }
    return dispose;
  }
}
```

The record is written **after** a successful registration, so a duplicate still throws exactly as before and never produces a vacancy record.
The event name `authorizer_link_vacant` was chosen at the planning gate over `authorizer_registration_delegated`: it names the ADR's own term and states the fact from the link's point of view (accepted here, never consulted here), while the per-ask sibling `authorizer_chain_delegated` keeps describing where adjudication went.
The record carries only `{ name }`, matching the fields `authorizer_chain_delegated` records (no session id — no review-log entry carries one today).

Consumer call site the contract must make small, which is [#788]'s test of it:

```typescript
pi.events.on(PERMISSIONS_READY_CHANNEL, (data) => {
  const { sessionId } = data as PermissionsReadyEvent;
  if (dispose || !sessionId) return;
  const service = getPermissionsServiceForSession(sessionId);
  dispose = service?.registerAuthorizer(LINK_NAME, authorize);
});
```

No `adjudicatesLocally` branch appears here on purpose: registering everywhere is the correct default, and the relaying node accepts and records it.

### The deprecation warning

```typescript
let warnedDeprecatedAccessor = false;

/** @deprecated Use `getPermissionsServiceForSession(sessionId)`. */
export function getPermissionsService(): PermissionsService | undefined {
  if (!warnedDeprecatedAccessor) {
    warnedDeprecatedAccessor = true;
    process.emitWarning(<message naming the keyed replacement and the doc link>, {
      type: "DeprecationWarning",
      code: "PI_PERMISSION_SYSTEM_DEP0001",
    });
  }
  return readRootService();
}
```

The `code` is package-prefixed because bare `DEP0xxx` codes are reserved for Node core; the package-prefixed form is the established third-party convention (e.g. the MongoDB driver's `MONGODB DRIVER` prefix), and it makes `process.on("warning")` filtering possible for an operator.
`unpublishPermissionsService` switches to the internal `readRootService()` so the package's own teardown never trips its own deprecation.
The guard is module-scoped, so under jiti isolation it fires once per consumer module copy per process — which is the intent (`--trace-deprecation` then hands that author a stack to their own call site).

### Node shapes after the change

| Node                                          | Keyed publish         | Legacy root slot                    | Ready payload               |
| --------------------------------------------- | --------------------- | ----------------------------------- | --------------------------- |
| Root interactive / headless CI                | yes, under its id     | yes (unchanged)                     | `adjudicatesLocally: true`  |
| In-process subagent child (registry-detected) | yes, under its own id | skipped ([#302] guard, unchanged)   | `adjudicatesLocally: false` |
| Own-process subagent child (env-detected)     | yes, under its own id | yes, in its own process (unchanged) | `adjudicatesLocally: false` |
| Any node whose host exposes no session id     | skipped               | per the guard above                 | `sessionId: null`           |

## Module-Level Changes

Source:

- `src/session-identity.ts` — **new**.
  `SessionIdentityContext` (`{ sessionManager: { getSessionId(): string } }`) and `readSessionId(ctx): string | null` — the defensive read (`try`/`catch`, empty string → `null`) currently inlined in `isRegisteredSubagentChild`.
- `src/authority/subagent-context.ts` — `isRegisteredSubagentChild` delegates its id read to `readSessionId`; `SubagentDetectionContext` stays as-is (it also reads `getSessionDir`).
- `src/service.ts` — add `SESSION_SERVICES_KEY`, the keyed map accessor, and the `publishPermissionsServiceForSession` / `getPermissionsServiceForSession` / `unpublishPermissionsServiceForSession` trio; add the internal `readRootService()`; add the `@deprecated` tag and once-guarded `process.emitWarning` to `getPermissionsService()`; update the module header, which currently describes a single slot.
- `src/permission-events.ts` — `PermissionsReadyEvent` becomes an interface with `sessionId` and `adjudicatesLocally`; `emitReadyEvent(events, event)` takes the payload; update the `PERMISSIONS_READY_CHANNEL` doc comment ("after the service is published") to name the keyed publication.
- `src/authority/authorizer-selection.ts` — export `AdjudicationRole`; `AuthorizerSelection` implements `adjudicatesLocally()`.
- `src/authority/authorizer-registry.ts` — add `ObservedAuthorizerRegistrar`; extend the module header to record accept-and-observe ([ADR 0012] decision 4).
- `src/service-lifecycle.ts` — `PermissionServiceLifecycle` takes the `AdjudicationRole` seam, publishes keyed in `activate`, remembers its published key, unpublishes it in `teardown`, and emits the ready payload; rewrite the class doc comment (it currently states the single-slot [#302] story).
- `src/index.ts` — wrap `authorizerRegistry` in `ObservedAuthorizerRegistrar(authorizerRegistry, authorizerSelection, logger)` for the `LocalPermissionsService` argument (the chain's `authorizerRegistry` lookup keeps the raw registry), and pass `authorizerSelection` into `PermissionServiceLifecycle`; update the two wiring comments that describe single-slot publication.

Tooling and docs:

- `scripts/verify-public-types.sh` — add `getPermissionsServiceForSession`, `publishPermissionsServiceForSession`, and `unpublishPermissionsServiceForSession` to the symbol list grepped out of `dist/public.d.ts`.
- `docs/architecture/architecture.md` — rewrite §"Cross-extension service accessor" (currently: "the behavior described in this section is current until those decisions are implemented") for keyed publication, the ready facts, and the deprecated zero-arg accessor; update the module-tree entries for `service.ts`, `service-lifecycle.ts`, `permission-events.ts`, and `authority/authorizer-registry.ts`; add `session-identity.ts`.
- `docs/cross-extension-api.md` — minimal correctness edits only (the wholesale rewrite is [#789]): the Quick Start snippet, the "How It Works" paragraph that says a child resolves the parent's service, the `permissions:ready` row of the Channel Reference table, and the "Ready Event" section.
- `docs/configuration.md` (the `registerAuthorizer` instruction), `README.md` (the authorizer-chain paragraph), and `docs/guides/permission-frontmatter-for-subagent-extensions.md` (the `getPermissionsService()` example) — swap the prescribed call to the keyed locator with the `permissions:ready` `sessionId`.
- `.pi/skills/package-pi-permission-system/SKILL.md` — §Cross-Extension Integration: the "sole cross-extension policy/prompt surface" sentence, the `PermissionServiceLifecycle` ownership sentence, and the `AuthorizerRegistry` throw-on-duplicate note (now accept-and-observe on a relaying node).

Grep sweeps run at planning time: `getPermissionsService|publishPermissionsService|unpublishPermissionsService` across `packages/`, `.pi/`, and all docs; `PermissionsReadyEvent|PERMISSIONS_READY_CHANNEL|permissions:ready` across the same.
The only cross-package consumer is `packages/pi-permission-model-judge` (`src/extension.ts`, `test/extension.test.ts`), which uses the legacy accessor and keeps working unchanged — its migration is [#788].
No `docs/subagent-integration.md`, `troubleshooting.md`, or `session-approvals.md` hit.

## Test Impact Analysis

New unit tests the change enables:

1. `test/session-identity.test.ts` — `readSessionId` returns the id, `null` when `getSessionId` throws, `null` for an empty id.
   Previously this branch was only reachable through `isRegisteredSubagentChild`.
2. `test/service.test.ts` — a keyed describe block: publish/get round-trip, per-key isolation (two nodes, two services), identity-guarded unpublish (a stale generation cannot evict a fresh publication), unknown key → `undefined`, and the deprecation warning (emitted once; `process.emitWarning` spied; the once-guard tested via `vi.resetModules()` + dynamic import so the module-scoped flag is fresh).
3. `test/authority/authorizer-selection.test.ts` — `adjudicatesLocally()` reports `true` for a UI node, `false` for a relaying subagent node, `true` for a headless non-subagent node, and `true` before activation.
4. `test/authority/authorizer-registry.test.ts` — `ObservedAuthorizerRegistrar`: delegates registration and returns the underlying disposer, writes `authorizer_link_vacant` with the link name only when the node relays, writes nothing when it adjudicates, and does not write when the underlying `register` throws.

Existing tests that change (none become redundant):

- `test/service-lifecycle.test.ts` — the five `activate` cases gain keyed-publication assertions plus the ready-payload facts; `teardown` gains the keyed removal and its ordering.
  The `vi.mock("#src/service")` factory must list the new exports.
- `test/permission-events.test.ts` — "emits an empty payload" becomes "emits the node facts"; the two composition-level ready assertions gain payload checks.
- `test/helpers/handler-fixtures.ts` — `makeCtx`'s `sessionManager` gains `getSessionId` (it has `getSessionDir` and `getEntries` but no id today, so every lifecycle test currently resolves `null`).
  The read is defensive, so the 18 hand-built `as unknown as ExtensionContext` literals do not break; only tests asserting a keyed publish need an id.
- `test/composition-root.test.ts` — `afterEach` clears the new `Symbol.for("…:session-services")` slot; two new integration proofs (below).

Tests that must stay exactly as they are, because they pin the legacy contract this change deliberately preserves:

- `composition-root.test.ts` "keeps the parent's service published across the child's lifecycle" ([#302]).
- `composition-root.test.ts` "publishes the service before emitting permissions:ready" — extended with the keyed publication, not replaced.
- `service.test.ts`'s legacy publish/get/unpublish block, including the child-unpublish no-op.
- `packages/pi-permission-model-judge/test/extension.test.ts` — untouched; it proves the legacy path still serves an unmigrated consumer.

Two composition-root proofs carry the issue's two defects:

1. **The reported symptom.**
   A parent and an in-process child both run the factory; after both `session_start`s, the child's keyed service is a *different* object from the parent's, and `getPermissionsServiceForSession(childId)!.registerAuthorizer("model-judge", …)` does not throw after the parent registered the same name.
2. **The quiet defect.**
   A `ToolAccessExtractor` registered into the **child's** keyed service is consulted by the child's own `path` / `external_directory` gates — the same shape as the existing `ffgrep` extractor test at the root, run against a child ctx.

## Invariants at risk

| Invariant                                                        | Source                                        | Pinned by                                                                                                                                           |
| ---------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A child's shutdown never wipes a live parent's service           | [#302]                                        | `composition-root.test.ts` "keeps the parent's service published across the child's lifecycle"; `service.test.ts` identity-guard cases              |
| A consumer reacting to ready can immediately resolve the service | [#302] plan / `permission-events.ts` contract | `composition-root.test.ts` "publishes the service before emitting permissions:ready" — extend to assert the keyed slot is populated before the emit |
| One chain per node: a relaying node resolves no links            | ADR 0007 §7, [#727]                           | `authorizer-selection.test.ts` delegated/resolved cases — decision 4 adds a registration-time record only, and must not touch `linksFor`            |
| Duplicate registration in one node still throws                  | `AuthorizerRegistry`                          | `authorizer-registry.test.ts` throw-on-duplicate; the decorator logs only after a successful `register`                                             |
| The gates and the service share one registry per node            | [#297] wiring contracts                       | `composition-root.test.ts` formatter/extractor sharing tests, now also exercised through the keyed locator                                          |

The change is not quantitative — no byte budget, latency, or cache characteristic is at stake — so no baseline measurement applies.
The one measurable claim is the public bundle's symbol list, which `pnpm --filter @gotgenes/pi-permission-system run verify:public-types` checks in CI.

## TDD Order

1. **`refactor:` extract the session-id read.**
   Red: `test/session-identity.test.ts` for `readSessionId`.
   Green: add `src/session-identity.ts`; `isRegisteredSubagentChild` delegates to it; add `getSessionId` to `makeCtx`.
   Commit: `refactor(pi-permission-system): extract readSessionId from subagent detection (#699)`.

2. **`refactor:` the session-keyed publication trio.**
   Red: the keyed block in `test/service.test.ts` (publish/get, per-key isolation, identity-guarded unpublish, unknown key).
   Green: add the slot, the map accessor, and the three functions to `src/service.ts`; add the three symbols to `scripts/verify-public-types.sh`.
   Nothing imports them yet, so a user observes no behavior change — hence `refactor:`, per the commit-typing rule.
   Commit: `refactor(pi-permission-system): add session-keyed service publication accessors (#699)`.

3. **`refactor:` the adjudication-role seam.**
   Red: `adjudicatesLocally()` cases in `test/authority/authorizer-selection.test.ts`.
   Green: export `AdjudicationRole`; implement the accessor on `AuthorizerSelection`.
   Commit: `refactor(pi-permission-system): expose the node's adjudication role (#699)`.

4. **`feat:` publish per node and carry the facts on ready.**
   Red: `test/service-lifecycle.test.ts` keyed-publication and payload cases; `test/permission-events.test.ts` payload case; the composition-root proof that a child publishes its own service and a sibling's `registerAuthorizer` into it does not throw.
   Green: `emitReadyEvent(events, event)`; `PermissionsReadyEvent` fields; `PermissionServiceLifecycle` keyed publish/teardown plus the `AdjudicationRole` dep; `index.ts` wiring; `composition-root.test.ts` `afterEach` slot clearing.
   The `emitReadyEvent` signature change breaks its sole caller and its tests at the type level, so events, lifecycle, and wiring land in this one commit.
   Commit: `feat(pi-permission-system): publish each node's service under its own session id (#699)`.

5. **`feat:` accept and observe a vacant link cell.**
   Red: `ObservedAuthorizerRegistrar` cases in `test/authority/authorizer-registry.test.ts`; a composition-root assertion that a link registered on a relaying child lands in the child's registry and writes `authorizer_link_vacant`.
   Green: the decorator plus the one-line `index.ts` wiring.
   Commit: `feat(pi-permission-system): record a vacant link cell on a relaying node (#699)`.

6. **`feat:` deprecate the zero-arg accessor.**
   Red: `test/service.test.ts` — the warning is emitted once, with `type: "DeprecationWarning"` and the package code, and `unpublishPermissionsService` does not trigger it.
   Green: `readRootService()`, the `@deprecated` tag, and the once-guarded `process.emitWarning`.
   Commit: `feat(pi-permission-system): deprecate the zero-arg service accessor (#699)`.

7. **`test:` prove the quiet defect is closed.**
   Red→green in one commit is not possible here (the mechanism already landed), so this is a characterization test: a `ToolAccessExtractor` registered into a child's keyed service is consulted by the child's own path gates.
   Commit: `test(pi-permission-system): pin child-side extractor registration through the keyed service (#699)`.

8. **`docs:` align the shipped docs and the skill.**
   The architecture doc (§Cross-extension service accessor, module tree), the four accessor-prescription sites, and `.pi/skills/package-pi-permission-system/SKILL.md`.
   Commit: `docs(pi-permission-system): document session-keyed service publication (#699)`.

## Risks and Mitigations

| Risk                                                                                                         | Mitigation                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A host that exposes no session id gets no keyed service, so a sibling in that node cannot register anywhere  | The legacy root slot still publishes under the unchanged guard, and `sessionId: null` tells the consumer to stand down rather than call with `undefined`. The condition is unreachable against the real SDK (`getSessionId(): string`). |
| An unmigrated consumer (including this repo's own `pi-permission-model-judge`) trips the deprecation warning | Warning only; behavior unchanged. Once-guarded per module copy, `--no-deprecation` silences it, and [#788] migrates the in-repo consumer inside the same release batch.                                                                 |
| The 18 hand-built ctx literals in `test/` lack `getSessionId` and would silently resolve `null`              | The read is defensive by design; `makeCtx` gains the method in step 1, and only the tests that assert a keyed publish need an id — a `null` elsewhere exercises the fallback path deliberately.                                         |
| `PermissionServiceLifecycle` grows to five collaborators                                                     | Each is a single-method seam answering a distinct question; the design-review checklist was run and found no field cluster worth an intermediate abstraction. Revisit if a sixth appears.                                               |
| Two live keyed entries for one node after a `/reload`                                                        | `activate` remembers the key it published and `teardown` deletes by identity, so a superseded generation cannot evict the fresh publication and cannot leave a foreign entry behind.                                                    |
| The vacancy record becomes noise on a busy relaying node                                                     | It is written once per registration, not per ask — bounded by the number of link-registering extensions loaded in that child.                                                                                                           |

## Open Questions

- Whether a `code` property on the duplicate-registration error is ever wanted.
  [ADR 0012] decision 4 declines it now (a post-contract duplicate is a genuine author bug); it is additive and can land the moment a real consumer need appears.
- When the zero-arg `getPermissionsService()` is removed.
  Unscheduled future major, contingent on downstream migration; the deprecation window costs nothing.
- Whether `docs/cross-extension-api.md`'s minimal edits here survive [#789]'s rewrite intact, or are superseded wholesale.
  Either is fine — the edits exist so no shipped doc prescribes a warning-emitting path between the two lands.

[ADR 0012]: ../decisions/0012-cross-node-extension-contract.md
[#297]: https://github.com/gotgenes/pi-packages/issues/297
[#302]: https://github.com/gotgenes/pi-packages/issues/302
[#635]: https://github.com/gotgenes/pi-packages/issues/635
[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#702]: https://github.com/gotgenes/pi-packages/pull/702
[#727]: https://github.com/gotgenes/pi-packages/issues/727
[#786]: https://github.com/gotgenes/pi-packages/issues/786
[#787]: https://github.com/gotgenes/pi-packages/issues/787
[#788]: https://github.com/gotgenes/pi-packages/issues/788
[#789]: https://github.com/gotgenes/pi-packages/issues/789
