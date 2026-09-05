---
status: accepted
date: 2026-08-20
---

# 0012 — The cross-node extension contract

## Status

Accepted.
Amended 2026-08-21 with decision 7's reclassification ([#794]): the ready latch and the locator's reclaimed spelling both ship as **major**, not the single minor this record originally classified.
Amended 2026-08-30 ([#796]): decision 7's deferred removal is taken — the process-root slot, its reader, and the [#302] child guard are deleted in a further major.
Amended 2026-09-01 ([#793]): decision 1 gains a third category — a **fact-shaping** registration's lookup may cross an in-process node boundary, which closes decision 6's converse hazard for in-process children without moving where any registration lands.
This decision settles the contract between three parties — pi-permission-system, subagent implementations, and sibling permission extensions — for a Pi process that hosts more than one session node.
It fixes the one architectural lie the parties currently work around (a session-boundary-crossing service accessor), names the one supported adapter convention for subagent implementations, and classifies every adopted mechanism against the events stability guarantee.
It composes with `docs/decisions/0007-model-judge-authorizer-chain-adr.md` (whose §7, one chain per node, it reaffirms unamended) and with pi-subagents [ADR-0002] (whose inverted dependency it leaves untouched).
The decisions here are implemented by downstream issues; nothing changes in code with this record.

## Context

### The reported symptom, and the gap behind it

Issue [#699] reports that a sibling authorizer extension loaded into an in-process subagent child calls `getPermissionsService().registerAuthorizer(...)`, reaches the **parent's** service, and throws a duplicate-registration error twice per subagent start.
Its proposed fixes (an exported child detector, a typed error) treat the throw as the defect.
Investigation showed the throw is the loud half of a wider contract gap; the quiet half is worse.

The service carries three registration surfaces, read by different nodes:

| Registry                           | Read by               | Read at                                                   |
| ---------------------------------- | --------------------- | --------------------------------------------------------- |
| `ToolAccessExtractorRegistry`      | the requesting node   | its own `tool_call` gates (`path` / `external_directory`) |
| `ToolInputFormatterRegistry`       | the requesting node   | payload/preview construction                              |
| `AuthorizerRegistry` (chain links) | the adjudicating node | `AuthorizerSelection.escalate`, per ask                   |

A child session runs its own gates and fixes an ask's facts before forwarding ([#635]), so a child needs its own extractors and formatters.
An in-process child's sibling registering into the parent's service therefore gets the duplicate throw parent-side **and** a missing extractor child-side — the latter silently weakens path gating for custom-path extension tools in children, with no symptom at all.

### What a node is

A **node** is one Pi session runtime: one `ExtensionContext`, one event bus, one jiti extension graph, one set of gates, one `PermissionSession`.
It is not a process and not a synonym for subagent: one OS process can host several nodes (a parent and its in-process children share a process and `globalThis`), and the root interactive session, a headless CI session, and a subagent child are all nodes.
Each node that loads pi-permission-system gets its own instance: its own registries, its own gates, its own terminal authorizer selected from its context.

For the forwarding relationship between nodes, the vocabulary is: the **requesting** node raises the ask; a **relaying** node's terminal forwards rather than decides (`adjudicatesLocally: false`); the **serving** node drains a requester's forwarded asks; the **adjudicating** node is the one whose chain and terminal decide.

### The mechanism, verified

Four facts constrain every candidate below, each re-verified against source at build time:

1. The SDK event bus hands handlers only the payload (`on(channel, handler: (data: unknown) => void)`) — there is no `ctx` argument at `permissions:ready`, and the bus wraps handlers in `try`/`catch` + `console.error`, which is the "warning per subagent start" [#699] reports.
2. `authorizerSelection.activate(ctx)` runs inside `PermissionSession.resetForNewSession`, before `SessionLifecycleHandler` reaches `serviceLifecycle.activate(ctx)` — so `adjudicatesLocally` and the node's session id are both available where the ready event is emitted.
3. `selectAuthorizer` is role-scoped, not location-scoped: a headless non-subagent node (CI) gets `DenyingAuthorizer` with `adjudicatesLocally: true` and runs its chain, so "links sit at the parent" is false as a rule.
4. Extension loading is asymmetric today: pi-subagents' `excludedExtensionPackages` can exclude packages from child sessions, and other implementations may load arbitrary sets — the contract must not assume symmetry.

Process shape changes the symptom, not the question.
An in-process child (registry-detected) resolves the parent's service and throws; an own-process child (env-detected) publishes its own service, and a link registration succeeds into a registry nothing reads.
Both node shapes answer "should this node host a consulted link?"
identically: no, because both relay.
Any fix keyed on "am I a registered in-process child" is process-specific by construction and leaves the silent case silently wrong.

### Objectives

The deliberation held every candidate against six objectives, confirmed at the first gate:

- **O1 — Safe by construction, not safe-if-you-remember.**
  A new sibling author writes one handler and cannot get it wrong.
- **O2 — Never silently vacant.**
  A registration is honored or impossible — never a no-op nobody notices ([#727]'s lesson).
- **O3 — Process shape invisible to siblings.**
  A permission extension never learns what a subagent is.
- **O4 — Subagent implementations stay ignorant of permissions.**
  The [ADR-0002] inverted dependency is untouched.
- **O5 — No new cross-extension surface unless it earns its place.**
- **O6 — Out-of-process subagent implementations are first-class.**
  A contract fact must travel on a channel that exists in both shapes.

The operator amended O4's application with a channel rule that also binds decisions 2 and 5: the event bus stays fire-and-forget broadcast, and request/response over the bus (removed once in [#531]) stays removed.

## Decision

### 1. Node-locality is law

Facts travel; code doesn't.
Registrations — extractors, formatters, chain links — never cross a node boundary: each lands in the registry of the node the registrant runs in.
**Recorded authority resolves node-locally; live authority converges at the adjudicating node.**
The forwarded ask (child-fixed facts) and the serving heartbeat are the only inter-node channels, and both already exist in both process shapes.

The recorded/live split is what makes the law principled rather than arbitrary.
A child's own config `allow` resolves locally and never forwards — both the parent's and the worktree's config are the operator's own prior rulings, so node-local resolution of recorded authority is the operator trusting the operator.
Live authority is code deciding now, case by case; that is where oversight matters, and that is what converges at the adjudicating node.

Consequently ADR 0007 §7 (one chain per node) **stands unamended**, and a local/triage adjudication mode — a relaying node's link deciding ahead of forwarding — is rejected on structural grounds.
For a child-side link verdict to honor the serving node's policy layer, either the ask reaches the serving node anyway (a forwarding round-trip, which is the thing local mode exists to avoid), or the serving node's policy is replicated into the child (which goes stale the moment a session approval writes a live session rule at the root), or the bypass is accepted (child-side code authorizing what the parent's policy would deny).
There is no fourth option, and the round-trip a binding local `allow` would save (~0.5 s of polling per hop) is small against the model call it accompanies.

Rejecting local mode dissolves the author-declared-placement axis entirely.
A global-oversight link (an orchestration warden holding cross-tree state) needs adjudicating-node-only placement, and gets it automatically: its registrations on relaying nodes are never consulted.
A stateless triage link (the model judge) runs wherever the node adjudicates, over facts fixed by the requesting node.
Nothing to declare, nothing to get wrong.

Two consequences are recorded rather than hidden: a worktree child cannot locally tune how its own forwarded asks are judged (the serving node's policy owns the ask, deliberately), and a link today cannot tell a forwarded ask from a local one (`requesterCwd`/`principal` stay off the ask details per [#635]).
The second is a named future extension, not a defect — see Consequences.

### 2. The registration channel: session-keyed publication

Each node publishes its service into a process-global map keyed by its own session id (the same `globalThis` + `Symbol.for()` mechanism, one slot generalized to one keyed map), and the keyed locator — `getPermissionsService(sessionId)` in spirit; exact spelling is an implementation detail — is the one supported way to obtain a node's service, for registration **and** queries.
The node's session id travels to consumers as data on the ready event.

`PermissionsReadyEvent` (deliberately empty today, additive by design) gains two fields, both plain facts about the emitting node:

- `sessionId` — the key for the locator.
- `adjudicatesLocally` — whether this node's chain runs (links consulted) or relays (ADR 0007 §7).

The bus stays data-only.
A candidate that carried the service object itself on the ready payload was rejected on channel purity: an event payload is data an unknown consumer can log, serialize, and replay (`docs/decisions/0011-prompt-presentation-contract.md` §6 defines the bus as the narrowest renderer), and a live capability in a payload is not data but a client to a service, working only by the accident that the bus is in-memory.
The bus announces; the locator provides.

The [#302] clobbering hazard dissolves structurally: a child publishes under its own key, so there is nothing to clobber.
The legacy root slot keeps its current guard behavior for compatibility.
In-process extensions share one trust domain (anything can poke `globalThis`), so a sibling passing another node's session id is not a new exposure and is not defended by mechanism.

The process-root reader — spelled `getPermissionsService()` when this record was written, and `getRootPermissionsService()` since [#794] reclaimed the base name for the locator — is **deprecated for registration and queries alike**: it answers "the process root's service", which is the wrong question in every node but the root — in an in-process child it hands back the parent's service, making even a policy query dishonest against the child's own (possibly worktree-local) config.
Its staging is decision 7, whose [#796] amendment removes it outright.
The sentence above about the legacy root slot keeping its guard behavior is superseded there: the slot is gone, so there is no guard left to keep.

### 3. The ready latch

`permissions:ready` is re-emitted once per session at the first `before_agent_start`, which runs after every extension's `session_start` and before any tool call, hence before any ask.
The channel's contract changes from "fires once, at `session_start`" to "fires at least once per session, and may repeat; handlers must be idempotent."

This makes the ready event alone a sufficient registration site.
The dual-path workaround — registering from both `session_start` and `permissions:ready` behind an idempotency guard, because pi-permission-system's `session_start` may run before or after the consumer's — dies, and a consumer's `session_start` handler goes back to doing only what it should (loading config).
A pull alternative (polling the keyed locator from `session_start`) was rejected because it reconstructs the dual path; no latch at all would canonize the workaround as the documented pattern.

### 4. The vacant link cell: accept and observe

A link registered on a relaying node is accepted into that node's registry, returns a working disposer, and is never consulted — and the node records that fact.
A registration-time review-log record (mirroring the per-ask `authorizer_chain_delegated`) names the link and states that this node relays, so the vacancy is operator-visible in the same log that already explains where adjudication went.

Refusing the registration was rejected on three grounds.
First, it re-imposes the placement ceremony decision 1 dissolved: every link author, forever, must branch on `adjudicatesLocally` before registering, converting the default correct pattern (register everywhere; the architecture consults where adjudication happens) into an error.
Second, the blame is misplaced: under §7 the vacancy is the system's routing decision, not an author mistake — a link registration is an offer of capability, like a formatter registered for a tool that is never called, which is also not refused.
Third, "loudly" degrades into the [#699] symptom by mechanism: the registration site is a bus handler, the SDK bus catches throws and `console.error`s them, so refuse-by-throw in a naive consumer is a stderr warning per subagent start — while a result-returning registrar is a breaking signature change and a role-shaped service without `registerAuthorizer` throws `TypeError` at the call site.

O2 is satisfied in the honest sense: its target was silence (a registration vanishing without a trace), not acceptance.
With the registration-time record beside `authorizer_chain_resolved` and `authorizer_chain_delegated`, nothing is silent.

Machine-readable `code` properties on duplicate-registration errors are **not** added now.
Under this contract the accidental cross-node duplicate is gone, so a remaining duplicate (two extensions claiming one link name; double registration in one node) is a genuine author bug that should surface raw.
A `code` is additive and can land later the moment a real consumer need appears; none exists today.

### 5. The subagent adapter convention

The child-announcement contract is named — the **subagent adapter convention** — and is the one supported API between subagent implementations and this package.
An implementation's entire obligation is the announcement:

- **In-process**: emit `subagents:child:session-created` (synchronously, on the same call stack, before `bindExtensions()` — the pre-bind ordering is contract, not implementation detail) with `{ sessionId, parentSessionId? }`, and `subagents:child:disposed` with `{ sessionId }` in the run's `finally`.
  Both are one-way fire-and-forget broadcasts, consistent with the no-RPC-over-bus rule.
- **Out-of-process**: set `PI_SUBAGENT_PARENT_SESSION=<parent-session-id>` in the spawned child's environment.
  Earlier candidates in `SUBAGENT_PARENT_SESSION_ENV_CANDIDATES` are grandfathered for compatibility; new implementations use this name.

Everything else — child detection, terminal selection, fact forwarding, the serving heartbeat, liveness fast-fail — is pi-permission-system's job on both ends, and the implementation never touches it: no import, no service resolution, no permission management (O4).

The convention's canonical home is [docs/subagent-integration.md](../subagent-integration.md).
[ADR-0002] and the architecture doc cross-reference it rather than restating it, ending the current arrangement where the channel names and payload shapes are declared independently in two packages with a comment pleading they stay in sync.

### 6. Loading asymmetry

Permission extensions may ride into child sessions harmlessly, by construction: extractors and formatters land in the child's own registries, where the child's gates read them (necessary, not merely harmless); links land vacant, accepted and observed; nothing throws and nothing warns per start.

Therefore `excludedExtensionPackages`-style exclusion is an optimization, never a correctness requirement.
Excluding a link-only extension from children saves load time; the adjudicating node's instance still judges every descendant ask.

The converse hazard is named: excluding an extractor or formatter **provider** from children weakens the child's own gates — the tool's custom path key goes unextracted, so `path`/`external_directory` gating for that tool silently degrades in the child.
The contract cannot prevent this; it makes the hazard a documented consequence.

Superseded for in-process children by the [#793] amendment below: the hazard needs a *split* between the tool's provider and the extractor's, and a fact-shaping lookup now falls back to the node's ancestors, so the gap cannot open there.
It stands as written for a child in its own process.

No loading symmetry is assumed: implementations may load arbitrary extension sets in children, which is exactly why the three statements above must hold.

### 7. Migration

Classification against the stability guarantee in `src/service/permission-events.ts` ("fields may be added; existing fields will not be removed or renamed without a semver-major version bump") and the service API:

| Change                                                        | Nature                                                          | Classification                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| Keyed publication + keyed locator                             | new lookup beside the old; zero-arg accessor behavior untouched | additive — minor                                                  |
| `sessionId` + `adjudicatesLocally` on `PermissionsReadyEvent` | fields added to a deliberately-empty payload                    | allowed by the guarantee — minor                                  |
| The latch                                                     | "fires once" becomes "at least once, may repeat"                | ~~minor, with a release-note callout~~ **major** (amended [#794]) |
| Vacant-cell registration-time review record                   | new review-log event type                                       | additive — minor                                                  |
| Zero-arg accessor deprecation                                 | runtime warning, no behavior change                             | minor; removal is a future major                                  |
| Reclaiming the locator's spelling ([#794])                    | a published zero-arg signature now requires an argument         | **major** (amended)                                               |
| Removing the process-root slot ([#796])                       | three published exports deleted; the slot stops being written   | **major** (amended)                                               |

The latch callout is the one honest caveat: an unguarded external consumer that registers on every ready emission hits the duplicate-registration throw on the re-emit, surfacing as bus-caught stderr noise rather than breakage.
The documented contract ("a consumer reacting to ready can immediately resolve the service") is preserved and strengthened, so this is classified minor with a "ready handlers must be idempotent" release note, not major.

Everything ships as **one minor release** — the mechanisms are one contract, and shipping the payload fields without the latch (for example) would leave the dual-path pattern alive.
The zero-arg accessor's removal is deferred to an unscheduled future major, contingent on downstream migration.
Deprecation is announced at runtime with `process.emitWarning(..., { type: "DeprecationWarning", code: ... })` (once-guarded) on the zero-arg call path: it fires only when the deprecated path is actually used, per-consumer under jiti module isolation, `--trace-deprecation` hands the author a stack to their own call site, and `--no-deprecation` lets an operator silence it.
The message names the keyed replacement and links the docs.

#### Amendment (2026-08-21, [#794])

Two rows above did not survive contact, and the release is a major.

The latch's severity estimate was wrong in kind, not degree.
The prediction was stderr noise for an unguarded consumer; the observed failure in `pi-permission-model-judge` is a duplicate-registration **throw** on every in-process subagent start, and the throw happens before the consumer's own `dispose` handle is assigned — so the guard never latches and every subsequent emission retries.
The grounds for calling it minor were that `/reload` already re-emitted `permissions:ready`, which made an unguarded consumer already broken.
That is true and beside the point: the latch moved the failure from rare and user-initiated to every session, with no edit on the consumer's part, which is this repository's definition of breaking.

The rename is the second row.
The keyed locator shipped to the working tree as `getPermissionsServiceForSession`, a spelling this record explicitly left open ("exact spelling is an implementation detail").
It was reclaimed before publication, so `getPermissionsService` — a **published** zero-arg function — now requires a session id.
The deprecation window itself is unchanged: the process-root reader survives under `getRootPermissionsService()`, and the "major release now" alternative below, which rejected *removing* it in this cut, still stands.

`pi-permission-model-judge` is the migration test case, and the contract's proof: its registration collapses to config loading in `session_start` plus one ready handler — keyed lookup, `registerAuthorizer`, a `dispose` guard.
The dual path, its explanatory comment, and the ordering caveat all die.
If the migrated code is not smaller than the workaround it replaces, the contract has failed its own test.

#### Amendment (2026-08-21, [#788]): the size test, measured

The migration landed and the test does not pass as written.

Everything the paragraph above predicted structurally is true: `tryRegister`, the `sessionStarted` flag, both call sites, and the nine-line comment explaining the ordering ambiguity are gone — 30 lines of workaround removed.
But 33 arrived in their place, so `src/extension.ts` measured 106 → 109 lines.

The seven lines that tip the balance narrow the ready payload: the SDK bus hands a handler `unknown`, so a consumer must establish that `sessionId` is a string before it can key the locator.
That is decision 2's own cost — the price of moving the node's identity onto the wire as data — and it is charged to every consumer of the keyed channel, not just this one.
A workaround measured against a capability it did not have was the wrong comparison.

The honest restatement: the dual path dies, and the contract removes more machinery than it adds — but not more *lines*, because the channel it replaces the machinery with carries data that has to be read.
A future consumer should expect the same trade.

#### Amendment (2026-08-30, [#796]): the process-root slot is removed

The deferral's condition has been met, so the window closes and the whole mechanism goes — reader, both writers, the `Symbol.for("@gotgenes/pi-permission-system:service")` slot, and the `PI_PERMISSION_SYSTEM_DEP0001` warning with them.
This supersedes the "major release now" alternative below, which rejected removal in the [#699] cut on the grounds that the window cost nothing.
It cost nothing then and it buys nothing now.

The condition fired at [#788]'s ship: `pi-permission-model-judge` 2.0.0 registers through `getPermissionsService(sessionId)` and floors its peer range at `>=27.0.0`, and no package outside `pi-permission-system` references the root-slot API.

The argument that closes the window is a fact about its population rather than about its length.
`getRootPermissionsService` did not exist before `v27.0.0`.
Before that release the root reader was spelled `getPermissionsService()` with no argument, and `v27.0.0` already broke that spelling — a consumer compiled against `v26` gets `undefined` plus `PI_PERMISSION_SYSTEM_WARN0001` today, not the root service.
So the window cannot shelter a legacy population: every possible caller of `getRootPermissionsService()` migrated *after* the deprecation was announced and chose a symbol marked `@deprecated` at first sight over the keyed locator the same migration guide recommends.
A window whose only occupants opted into it after being warned is not protecting anyone.

The removal is a hard delete rather than a tombstone that answers `undefined` and warns.
[#794] set the tombstone precedent with `WARN0001`, for a caller the type checker cannot reach, and that guard survives this cut with its message rewritten to name only the keyed locator.
Applying the same shape to a *removed* export would mean it is not removed: it would answer `undefined` forever, which is a silent behavior change for precisely the consumer the window existed to protect, and it would need its own removal later.
A `TypeError` at the call site, with `WARN0001` and the migration note both naming the replacement, is the honest signal.

The reader and the writer retire together, and the [#302] child guard retires with them.
Removing the reader leaves nothing that reads the slot; removing the write leaves the guard — `if (!this.detection.isRegisteredChild(ctx))` in `PermissionServiceLifecycle.activate` — with nothing to guard.
Decision 2 already dissolved [#302]'s hazard structurally: each node publishes under its own key, so there is nothing to clobber.
So `RegisteredChildDetector` and `SubagentDetection.isRegisteredChild` go, and `PermissionServiceLifecycle` loses its detection dependency; the pure `isRegisteredSubagentChild` stays, because `isSubagentExecutionContext` still calls it.

#### Amendment (2026-08-31, [#792]): an optional third in-process channel

Decision 1 makes gating node-local, which means a child that loads no instance of this package gates nothing — and decision 6 makes that reachable, since `excludedExtensionPackages` may name this package.
The parent's own gating is unaffected, so the hole is invisible from the only session a human is watching.

The obligation in decision 5 is **unchanged**: two in-process events, or one environment variable.
What this amendment adds is an *optional* third in-process channel, `subagents:child:bound` with the same `{ sessionId, parentSessionId? }` payload, emitted after `bindExtensions()` resolves and not at all when it throws.
An implementation that never emits it stays conformant and simply forfeits the alarm; the conformance table scores the two mandatory events as before.

The channel exists because no already-announced moment can answer the question, which was established by reading the code rather than argued:

- `session-created` fires before the child's extensions load, so nothing has published yet either way.
- `disposed` fires *after* the child's `session_shutdown`, which unpublishes the keyed service — so a healthy child is indistinguishable from an unguarded one, and auditing there would false-alarm on every child.
- A deferred sweep of registered children on the parent's next `before_agent_start` is post-hoc by construction: a foreground child runs to completion inside the parent's own tool call, so the earliest such sweep reports a child that has already executed every tool in its allowlist ungated.
  It is also not reliably reachable — a completed child stays registered only until the implementation releases its session, which in `@gotgenes/pi-subagents` is an interval sweep against a configurable retention window, so whether the parent ever sees a given child depends on timing the permission system does not control.

`bindExtensions()` awaits the child's `session_start` emit, so its resolution is the first instant at which "this child published a service" is a settled fact.
That is a seam, not a delay: nothing is slept on and nothing is polled.

The response is a warning, never a refusal, per decision 6's framing and [ADR-0002]'s separation — refusing would be this package overriding a setting that belongs to the implementation, on a configuration the operator chose deliberately.
The parent cannot distinguish deliberate exclusion from a load failure, because both leave the identical absence; the warning names the likelier cause and admits the other rather than asserting one.

#### Amendment (2026-09-01, [#793]): fact-shaping lookups may cross an in-process node boundary

Decision 6 names the converse hazard and states the contract cannot prevent it.
Checked against pi-subagents' actual exclusion semantics, the hazard is narrower than that reads and it *is* preventable for an in-process child.

Excluding a package keeps the tools it registers out of children too, so exclusion normally removes a tool and its extractor together and weakens nothing.
A gap needs a **split** between providers: package A registers tool `deploy` whose path lives under `input.target`, package B registers the extractor for it, and the operator excludes only B. The child then holds `deploy` with its path undeclared, its `path` / `external_directory` gates never run for that call, and the parent gates its own calls correctly — so the weakening is visible nowhere.

Decision 1 splits registrations into recorded authority and live authority.
It is silent on a third category, because that category was assumed complete in every node: **fact-shaping** registrations — extractors and formatters — which turn a call's raw input into a fact about it.
This amendment adds the missing clause.

> A fact-shaping registration, being non-authority, may be **read** across an in-process node boundary to complete a child's own fact-gathering.
> Where a registration lands is unchanged: node-local, in the registry of the node whose extension registered it.

So a child's extractor lookup consults its own registry first and falls back to its ancestors in the same process, and decision 6's "riding along is harmless by construction" now holds unconditionally for in-process children rather than with a caveat no mechanism enforces.

Three properties keep the clause from generalizing into the authority registries, and they are why it is stated by category rather than as an exception:

1. Neither an extractor nor a formatter decides anything, so no authority crosses a boundary.
2. The extractor path is **monotone**: with no extractor the gate does not run at all, and the four path layers compose most-restrictive-wins, so an inherited extractor can only add a check.
   A link has no such property — it can return `allow`.
3. The two cases differ in **declared intent**.
   An extractor appears in no config, so excluding its provider carries no operator statement about a tool's path visibility.
   A link's name is written in `authorizerChain`, so excluding its provider contradicts a statement the operator made — a conflict to resolve, not a capability to restore.

ADR 0007 §7 therefore stands unamended, and there is deliberately no reader for the authorizer registry on `PermissionsService`.
The live-authority case — a locally-adjudicating child skipping a configured link whose provider did not load there, recorded today as `authorizer_chain_unregistered_link` — is a separate question about whether that fail-safe skip should be louder, tracked as [#861].

Two costs are accepted rather than hidden.
A child is no longer explainable from the child alone: the same call can resolve differently if an ancestor's provider is disposed.
That is recorded rather than silent — a decision that used an inherited extractor carries `extractorSource: "inherited"` in the review log.
And the repair is in-process only: an out-of-process child shares no `globalThis` and an extractor is a closure, so the by-hand check in pi-subagents' configuration guide remains the only cover for an implementation that spawns one with an asymmetric extension set.
No current implementation does.

The deeper root is left standing and named here rather than fixed: fact-shaping intent is **declared nowhere**.
An extractor is registered imperatively by whatever package loads, so a node cannot statically know it is missing one — which is why the repair is a runtime resolution rather than a load-time check, and why [#792]'s absent-node alarm is a runtime comparison too.
A capability manifest would change that, at the cost of a large additive surface that existing functional extractors cannot express.

## Consequences

- The [#699] defect family ends structurally: no duplicate throw (the child's sibling registers into the child's own keyed service), no silently weakened child gates (extractors land where the child's gates read), no per-start stderr noise, and the vacancy that remains is recorded where the operator already looks.
- A sibling author's obligation shrinks to one idempotent ready handler; a subagent implementation's obligation shrinks to the announcement; neither ever learns the other exists.
- The decision-to-implementation map:
  - Decisions 2 and 4 — re-scoped onto [#699] (keyed publication and locator, ready-payload fields, vacant-cell observation).
  - Decision 3 — the latch, [#787].
  - Decision 7 — the judge migration in `pi-permission-model-judge`, [#788]; the accessor deprecation warning rides the decision-2 work on [#699].
  - Decisions 5 and 6 — the docs consolidation (adapter convention home, asymmetry statement, cross-extension API rewrite), [#789].
- PR [#702] is evaluated against this contract rather than against [#699]'s option list; its exported-detector approach is superseded by the keyed channel, and its documentation example (`(_event, ctx) => ...`) contradicts the verified SDK handler signature.
- Anticipated extensions, supported by the law and deliberately not decided here: requester-context facts-widening (letting an adjudicating node's link distinguish a forwarded ask and its requester — more facts traveling, additive, but it reverses part of [#635]'s narrowing and needs its own deliberation), and machine-readable duplicate-error codes if a real consumer need appears.
- The architecture doc's "Cross-extension service accessor" section points here; its behavioral prose changes only as the implementation issues land.

## Alternatives considered

### Registration transport (rejected at parameter 1)

Shipping a child's registrations to the serving node.
The serving node already runs its own instance of the same extension (same config, same link name), so the transported link is a duplicate by construction; binding it would double-adjudicate every deferring ask and let child-side code decide asks the serving node's policy owns; for extractors it is worse — the serving node's gates would consult a child's extractor for the serving node's own tool calls.

### Capability on the ready payload (rejected at parameter 2)

The emitting node's service object riding the ready event: one fewer locator call (the strongest O1 shape), rejected because it makes one bus channel semantically alien to its siblings — not loggable, not serializable, meaningful only in memory — and collapses the announce/provide distinction the rest of the contract enforces.

### Role-gated emission (rejected at parameter 2)

Suppressing ready on nodes "where registration is invalid" fails on a fact of the registries: extractors and formatters are valid on every node, links only on adjudicating ones.
One gated channel cannot say both; gating ready off in a child silences extractor providers and reintroduces the silent gate-weakening deliberately.

### Advisory fields only (rejected at parameter 2)

`ownsService`/`adjudicatesLocally` as booleans beside the unchanged zero-arg accessor: honest but opt-in — a naive consumer skips the check and lands in the parent's registry exactly as today.
The facts themselves survive in decision 2; as the sole mechanism they fail O1.

### Refuse the vacant registration (rejected at parameter 4)

Recorded in decision 4: the placement ceremony returns, the blame is misplaced, and the failure surfaces as the same per-start stderr noise this contract exists to eliminate.

### No latch, or a pull API (rejected at parameter 3)

Recorded in decision 3: both reconstruct or canonize the dual-path workaround.

### Major release now (rejected at parameter 7)

Removing the zero-arg accessor in the same cut breaks unknown external consumers of a documented surface with no urgency; the deprecation window costs nothing.
Superseded by decision 7's [#796] amendment: the window turned out to have no legacy population to shelter, so it bought nothing.

[#302]: https://github.com/gotgenes/pi-packages/issues/302
[#531]: https://github.com/gotgenes/pi-packages/issues/531
[#635]: https://github.com/gotgenes/pi-packages/issues/635
[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#702]: https://github.com/gotgenes/pi-packages/pull/702
[#727]: https://github.com/gotgenes/pi-packages/issues/727
[#787]: https://github.com/gotgenes/pi-packages/issues/787
[#788]: https://github.com/gotgenes/pi-packages/issues/788
[#792]: https://github.com/gotgenes/pi-packages/issues/792
[#793]: https://github.com/gotgenes/pi-packages/issues/793
[#789]: https://github.com/gotgenes/pi-packages/issues/789
[#861]: https://github.com/gotgenes/pi-packages/issues/861
[#794]: https://github.com/gotgenes/pi-packages/issues/794
[#796]: https://github.com/gotgenes/pi-packages/issues/796
[ADR-0002]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/docs/decisions/0002-extensions-on-a-minimal-core.md
