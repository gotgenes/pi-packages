---
issue: 727
issue_title: "pi-permission-system: authorizerChain links are skipped for subagent requests, so configured authorizers never adjudicate them"
---

# One chain per node: settle and record authorizerChain adjudication for subagent asks

## Release Recommendation

**Release:** ship independently

No roadmap step in `docs/architecture/architecture.md` references this issue, so it carries no `Release:` batch tag.
The work is a self-contained log-correctness fix plus an observability addition; nothing downstream waits on it.

## Problem Statement

Every permission ask raised inside an in-process subagent child logs `authorizer_chain_unregistered_link` for each name in `authorizerChain`, immediately before the request is evaluated.
The issue reads that as the configured authorizer never adjudicating a subagent's requests — the requests that arguably need review most, since nobody is watching the subagent.

The measured evidence supports one half of that reading and refutes the other.

| Review-log event                       | Count (measured, 9167-record log) |
| -------------------------------------- | --------------------------------- |
| `permission_request.waiting`           | 1426                              |
| `forwarded_permission.request_created` | 54                                |
| `forwarded_permission.prompted`        | 33                                |
| `authorizer_chain_unregistered_link`   | 43                                |
| `model_judge.decision`                 | 8                                 |

Three findings, all verified against the source:

1. A child's chain is empty by construction.
   `AuthorizerRegistry` is a per-extension-instance object created in `index.ts`, and a child's instance is never filled: a sibling extension in the child resolves `getPermissionsService()` to the *parent's* service, whose registry already owns the name, so `register` throws ([#699]).
   `resolveConfiguredLinks()` therefore skips every configured name and logs the fail-safe warning on every child ask.
2. The parent's chain does adjudicate the forwarded request.
   `ForwardedRequestServer.resolveDecision` escalates an `ask` through `AskEscalator`, wired in `index.ts` to the same `AuthorizerSelection` that owns the parent's chain, with the child-fixed access facts projected onto the ask details ([#635]).
   ADR 0007 §2 already names this shape: `ParentAuthorizer` is "terminal for its node — it forwards up and returns the parent node's `allow | deny`".
3. The missing `model_judge.decision` is not a missing run.
   `typo-reviewer.ts` writes a review-level record only when a candidate path matches a configured typo pattern; a `pattern-miss` goes to the **debug** log, which is off by default ([#626] deliberately scoped it that way).
   `find /` is a pattern-miss, so the link ran and deferred silently.

The 43 warnings are two different populations, which is why the fix must not simply delete the event.
Fifteen sit within 2 s of a `forwarded_permission.request_created` — the child-relay false alarm.
But 2026-08-05 alone contributes 23 warnings against 23 local asks and *zero* forwarding: a session where the link genuinely was not registered, which is exactly what the event exists to report.

So the reported security consequence does not hold, but three real defects do: a false-alarm warning on every child ask, no positive evidence anywhere in the log that a chain was consulted, and semantics that are undocumented enough that the operator could not distinguish the two populations.

## Goals

- Settle and record the adjudication semantics: exactly one node adjudicates an ask, and it is the node whose terminal decides — never a node that relays the ask upward.
- Stop a relaying (subagent) node from reporting its deliberate delegation as a fail-safe skip of unregistered links.
- Record positive evidence per ask of which chain links were consulted, so "did the judge see this request?" is answerable from the review log.
- Pin the parent-side invariant with an end-to-end regression test, so the behavior the issue doubted cannot regress silently.
- Endorse the direction of [#699] in the ADR (a child deliberately hosts no links, so a sibling extension should skip registering in one) without implementing it here.

This change is **not** breaking.
`selectAuthorizer` and `TerminalAuthorizer` are internal — the package's public surface is `dist/public.d.ts` / `src/service.ts`, which export neither.
Adjudication behavior is unchanged; only review-log records change.

## Non-Goals

- Implementing [#699] / superseding [#702].
  The registration surface (a public child detector, a typed duplicate-registration error) is that issue's deliverable; this plan touches no registration code and only records that the ADR now blesses the direction.
- Implementing [#726] (`decidedBy` responder provenance on terminal events).
  This plan records which links were *consulted*, not which mechanism *decided*; the terminal-event provenance shape stays [#726]'s to design.
- Changing `pi-permission-model-judge`'s logging.
  Recording only pattern-matched asks at review level is [#626]'s deliberate choice, and `authorizer_chain_resolved` supplies the "was it consulted" signal without a second firehose.
- Making `AuthorizerRegistry` process-global so a child hosts the parent's links.
  Considered and rejected below.
- Widening the delegation envelope's excluded surfaces ([#684]) or out-of-process forwarding liveness ([#721]).
- Fixing the global-config-path divergence found while tracing this issue, filed as [#732].

## Background

The relevant modules, all under `packages/pi-permission-system/src/authority/`:

- `authorizer.ts` — `selectAuthorizer(ctx, deps): TerminalAuthorizer`, the once-per-activation `hasUI` → `LocalUserAuthorizer` / `isSubagent` → `ParentAuthorizer` / else → `DenyingAuthorizer` dispatch.
- `authorizer-selection.ts` — `AuthorizerSelection`, the `AskEscalator`: stores the selected terminal at `activate`, resolves `authorizerChain` to registered links **per ask** (ADR 0007 §4, so a late `permissions:ready` registration is honored), wraps each in the delegation envelope, composes via `composeAuthorizerChain`, and delegates to `PermissionPrompter`.
- `authorizer-registry.ts` — `AuthorizerRegistry`, one instance per extension factory invocation, exposed cross-extension as `PermissionsService.registerAuthorizer`.
- `authorizer-chain.ts` — `composeAuthorizerChain(links, terminal, query, log)`; zero links returns the terminal instance unchanged (identity).
- `forwarded-request-server.ts` — the serving-down half: resolves a forwarded `ForwardedAccessIntent` against recorded authority, then escalates an `ask` through the injected `AskEscalator`.

Constraints from `AGENTS.md` and the package skill that shape the design:

- The `AuthorizerRegistry` is deliberately **not** process-global, unlike `SubagentSessionRegistry` and `ServingSessionRegistry`.
  Making it global is a security-relevant change, not a plumbing convenience.
- Least privilege: absence of a judge must mean *more* prompting, never less (ADR 0007 invariant 2).
- Config example, schema, `docs/configuration.md`, and `README.md` stay aligned when config-visible behavior changes.
  This change adds no config field, but it does change what `authorizerChain` means on a subagent node, which `docs/configuration.md` documents.

## Design Overview

### The decision: one chain per node

An ask is adjudicated by exactly one node's chain: the node whose terminal decides it.

- A node with UI (`LocalUserAuthorizer`) decides locally, so it runs its chain.
- A headless node with no reachable authority (`DenyingAuthorizer`) decides locally — by denying — so it runs its chain; a link may still deny with a teaching reason, or allow on a non-excluded surface, which is strictly better than the bare `confirmation_unavailable` deny.
- A subagent node whose terminal is `ParentAuthorizer` does **not** decide: it relays the ask to a serving node, which resolves it against its own recorded authority and escalates it through its own chain over the same child-fixed facts ([#635]).
  Resolving links on the relaying node would adjudicate the same ask twice — two model calls, two latencies — for no additional evidence, and would let a link decide an ask the serving node's policy owns.

Rejected alternative: make `AuthorizerRegistry` process-global so a child resolves the parent's links.
It converts every deferring ask into two link runs, and lets a link's `deny`/`allow` short-circuit before the serving node ever sees the request — a privilege change dressed as a plumbing fix.
The forwarding round trip is not the cost being avoided; the serving node has to resolve the request against its own ruleset regardless.

Rejected alternative: change nothing structural and only downgrade the log event to `debug`.
That hides the genuine unregistered-link case (23 of the 43 measured records) behind a log that is off by default, which is the visibility the issue objects to.

### Threading the decision, not the discriminator

`AuthorizerSelection` must not re-derive "is this a relaying node?" from `detection.isSubagent(ctx)` — that decision already has a home in `selectAuthorizer`, and re-deriving it would get the subagent-with-UI case wrong (`selectAuthorizer` tests `hasUI` first, so such a node decides locally).
So `selectAuthorizer` returns its product rather than a bare terminal:

```typescript
// src/authority/authorizer.ts
/** The node's live-authority selection: who decides, and whether this node adjudicates. */
export interface SelectedAuthority {
  /** The terminal that decides this node's asks, or relays them upward. */
  readonly terminal: TerminalAuthorizer;
  /**
   * False when the terminal relays the ask to a serving node: that node runs
   * its own chain over the same child-fixed facts (#635), so resolving links
   * here would adjudicate the ask twice.
   */
  readonly adjudicatesLocally: boolean;
}

export function selectAuthorizer(
  ctx: ExtensionContext,
  deps: AuthorizerSelectionDeps,
): SelectedAuthority;
```

The single consumer is `AuthorizerSelection`, and the interaction stays Tell-Don't-Ask at the escalation edge — the caller destructures a value object it was handed, never interrogates the terminal's class:

```typescript
// src/authority/authorizer-selection.ts (sketch)
escalate(details: PromptPermissionDetails): Promise<PermissionPromptDecision> {
  const authority = this.authority;
  if (authority === null) {
    return Promise.reject(new Error("escalate called before the session was activated"));
  }
  const links = this.linksFor(authority, details.requestId);
  const chain = composeAuthorizerChain(links, authority.terminal, this.deps.getPermissionQuery(), this.deps.logger);
  return this.deps.prompter.prompt(chain, details);
}
```

`linksFor` is the one place the delegation branch lives:

```typescript
private linksFor(authority: SelectedAuthority, requestId: string): Authorizer[] {
  const configured = this.deps.getAuthorizerChain();
  if (configured.length === 0) {
    return [];
  }
  if (!authority.adjudicatesLocally) {
    this.deps.logger.review("authorizer_chain_delegated", { requestId, links: configured });
    return [];
  }
  return this.resolveConfiguredLinks(configured, requestId);
}
```

With zero configured links nothing is logged and `composeAuthorizerChain` still returns the terminal instance, so an operator who configures no chain sees no new records at all.

### Review-log records

Three records, all keyed by the ask's `requestId` (always present on `PromptPermissionDetails`):

| Event                                | Emitted when                                               | Payload                                                                   |
| ------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| `authorizer_chain_resolved`          | an adjudicating node resolved at least one configured name | `{ requestId, links }` — the resolved names, in config order              |
| `authorizer_chain_delegated`         | a relaying node has a non-empty configured chain           | `{ requestId, links }` — the configured names it deliberately did not run |
| `authorizer_chain_unregistered_link` | an adjudicating node cannot resolve a configured name      | `{ requestId, name }` — gains `requestId` so the skip is correlatable     |

`authorizer_chain_resolved` is written before the links run: it records consultation, not outcome.
A link's own verdict trail stays the link's responsibility (ADR 0007 §3's injected `AuthorizerLog`), and the terminal event's "who decided" provenance stays [#726]'s.

Edge cases:

- A mixed chain (`["missing", "present"]`) on an adjudicating node emits both `authorizer_chain_unregistered_link` (for `missing`) and `authorizer_chain_resolved` with `["present"]`.
- A chain whose every name is unregistered emits only the per-name warnings — there is nothing to record as consulted.
- A relaying node emits `authorizer_chain_delegated` and no per-name warning, because no name was skipped: the whole chain was delegated.

## Module-Level Changes

| File                                                      | Change                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/authority/authorizer.ts`                             | Add the `SelectedAuthority` interface; `selectAuthorizer` returns it instead of a bare `TerminalAuthorizer` (`adjudicatesLocally: false` only on the `ParentAuthorizer` arm)                                                                                                                            |
| `src/authority/authorizer-selection.ts`                   | Store `SelectedAuthority \| null` instead of `TerminalAuthorizer \| null`; add `linksFor`; `resolveConfiguredLinks` takes the configured names and `requestId`, adds `requestId` to the unregistered warning, and emits `authorizer_chain_resolved`; `escalate` composes against `authority.terminal`   |
| `test/helpers/authorizer-fixtures.ts`                     | New: `makeAuthorizerSelectionDeps`, `makeInvokingPrompter`, `registerLink`, extracted from `authorizer-selection.test.ts` so a second test file can build a real `AuthorizerSelection`                                                                                                                  |
| `test/authority/authorizer.test.ts`                       | Four `selectAuthorizer(...)` call sites read `.terminal`; new assertions on `adjudicatesLocally` per arm                                                                                                                                                                                                |
| `test/authority/authorizer-selection.test.ts`             | Migrate to the shared fixtures; update the unregistered-link assertion for `requestId`; add the relaying-node and `authorizer_chain_resolved` cases                                                                                                                                                     |
| `test/authority/forwarded-request-server.test.ts`         | New describe: a real `AuthorizerSelection` + real `AuthorizerRegistry` as the server's escalator, pinning that the serving node's chain adjudicates a forwarded ask                                                                                                                                     |
| `docs/decisions/0007-model-judge-authorizer-chain-adr.md` | New `### 7. One chain per node` under `## Decision`; `## Status` records the 2026-08-14 amendment; a rejected-alternatives entry for the process-global registry                                                                                                                                        |
| `docs/architecture/architecture.md`                       | Module-tree entries for `authorizer.ts` (returns `SelectedAuthority`) and `authorizer-selection.ts` (per-ask resolution, the three chain events, the delegation branch); the live-authority narrative near the `selectAuthorizer` / `composeAuthorizerChain` sentence gains the one-chain-per-node rule |
| `docs/architecture/permission-prompter.md`                | The "Relationship to the Authorizer spine" sentence naming `selectAuthorizer(ctx, deps)`'s return                                                                                                                                                                                                       |
| `docs/configuration.md`                                   | The authorizer-chain section gains a paragraph: where the chain runs when a subagent raises the ask, and which record proves it                                                                                                                                                                         |
| `README.md`                                               | One sentence on the `authorizerChain` paragraph pointing at the subagent semantics                                                                                                                                                                                                                      |
| `.pi/skills/package-pi-permission-system/SKILL.md`        | The `AuthorizerSelection.escalate` paragraph — per-ask resolution now branches on the node's chain role, and the three events replace the single `authorizer_chain_unregistered_link` mention                                                                                                           |

Grep verification performed at planning time: `selectAuthorizer` appears in `src/` twice (`authorizer.ts`, `authorizer-selection.ts`), in `test/` once (`authorizer.test.ts`), and in narrative prose in `docs/architecture/architecture.md`, `docs/architecture/permission-prompter.md`, and `docs/decisions/0007-*.md`; `authorizer_chain_unregistered_link` appears in `src/authority/authorizer-selection.ts`, `test/authority/authorizer-selection.test.ts`, and `docs/architecture/architecture.md`.
Historical mentions under `docs/architecture/history/`, `docs/retro/`, and `docs/plans/` are records of what shipped and are not updated.
No public export changes, so `scripts/verify-public-types.sh` needs no edit.

## Test Impact Analysis

New tests the change enables:

- `selectAuthorizer`'s chain role is now an assertable value rather than an inference from the returned class, so the subagent-with-UI case (decides locally despite being a subagent) becomes directly testable.
- A relaying node's escalation can be asserted end to end: zero links composed, the configured link never invoked, one `authorizer_chain_delegated` record.
- The cross-module regression — a forwarded request adjudicated by the serving node's registered chain — was previously unreachable because `forwarded-request-server.test.ts` injects a `{ escalate }` stub for the escalator, so no test ever wired the real chain owner behind it.

Tests that become redundant: none.
The existing `authorizer-selection.test.ts` cases (config order, envelope capping, unregistered skip) all still describe an adjudicating node and stay as-is apart from the `requestId` field.

Tests that must stay: `authorizer-chain.test.ts`'s zero-links identity case, which is now load-bearing for the relaying node (it is how a delegated ask reaches the terminal unchanged), and the `forwarded-request-server.test.ts` child-fixed-facts and bounded-delegation describes, which pin the evidence the serving node's chain judges on.

## Invariants at risk

The change touches the Phase 12 chain surface ([#598], [#599]) and the forwarded-ask edge ([#635]).

| Invariant                                                                                 | Source                    | Pinned by                                                                                                                                           |
| ----------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zero links composes to the terminal instance (identity)                                   | Phase 12 Step 4 `Landed:` | `test/authority/authorizer-chain.test.ts` — existing                                                                                                |
| Config order, not registration order, fixes chain order                                   | ADR 0007 §4 invariant 1   | `authorizer-selection.test.ts` "resolves links in config order" — existing                                                                          |
| Skipping a link is fail-safe: the ask still reaches the terminal                          | ADR 0007 §4 invariant 2   | `authorizer-selection.test.ts` unregistered-name case — existing; extended by the new relaying-node case, where zero links still reach the terminal |
| A forwarded ask reaches the serving node's `Authorizer` with the child-fixed gate surface | [#635]                    | `forwarded-request-server.test.ts` child-fixed-facts describe — existing; strengthened by the new end-to-end chain test                             |
| A relaying node's terminal still forwards and abandons an unserved target                 | [#719]                    | `approval-escalator.test.ts` — untouched; the relay path only loses its (empty) link resolution                                                     |

The one quantitative claim in this plan is record volume, and it is measured, not predicted: at the observed rates the new `authorizer_chain_resolved` record fires on asks that already write `permission_request.waiting` (1426 over ~3 months), and `authorizer_chain_delegated` replaces the 43 existing `authorizer_chain_unregistered_link` records one for one on relaying nodes, at no more than one per ask.

## TDD Order

1. Extract the `AuthorizerSelection` construction fixtures into `test/helpers/authorizer-fixtures.ts` and migrate `authorizer-selection.test.ts` to import them.
   Green throughout — pure test tidying that makes the next step's cross-module test possible.
   Commit: `test(pi-permission-system): extract authorizer-selection fixtures into a shared helper`.
2. Characterization test: a forwarded ask is adjudicated by the serving node's registered chain.
   Wire a real `AuthorizerRegistry` (one deny-with-reason link) and a real `AuthorizerSelection` as `ForwardedRequestServer`'s escalator, with a terminal that fails the test if it is reached; assert the written response carries the link's denial.
   Green on arrival — it pins the invariant the issue doubted before any behavior moves.
   Commit: `test(pi-permission-system): pin serving-node chain adjudication of forwarded asks`.
3. Red: `authorizer.test.ts` asserts `adjudicatesLocally` per dispatch arm.
   Green: add `SelectedAuthority`, change `selectAuthorizer`'s return, update `AuthorizerSelection`'s stored field and `escalate`, and update the four existing `authorizer.test.ts` call sites to read `.terminal` — one commit, since the return-type change breaks every consumer at compile time.
   Commit: `refactor(pi-permission-system): return the node's chain role from selectAuthorizer`.
4. Red: a relaying node with a configured, unregistered chain logs no `authorizer_chain_unregistered_link`, logs one `authorizer_chain_delegated`, composes zero links, and still reaches its terminal.
   Green: add `linksFor` with the delegation branch.
   Commit: `fix(pi-permission-system): stop reporting a delegated subagent chain as unregistered links (#727)`.
5. Red: an adjudicating node logs `authorizer_chain_resolved` with the resolved names, and the unregistered warning carries `requestId`; a node with an empty configured chain logs neither.
   Green: emit the record from `resolveConfiguredLinks` and thread `requestId`.
   Commit: `feat(pi-permission-system): record which chain links were consulted on each ask (#727)`.
6. Documentation: ADR 0007 §7 plus the `## Status` amendment line, the architecture module-tree and narrative entries, `permission-prompter.md`, `docs/configuration.md`, `README.md`, and the package skill.
   Commit: `docs(pi-permission-system): document one-chain-per-node adjudication semantics (#727)`.

## Risks and Mitigations

- Risk: suppressing the warning on a relaying node hides a genuine misconfiguration on that node.
  Mitigation: `authorizer_chain_delegated` names the configured links it did not run, so the configuration is still visible in the log; and the names are only resolvable on the node that adjudicates, which now always reports its own resolution.
- Risk: `authorizer_chain_resolved` adds volume to a log that already carries 9167 records.
  Mitigation: it is emitted only when the operator configured a chain and at least one name resolved — for an operator with no `authorizerChain`, this change adds zero records.
- Risk: the ADR amendment freezes a semantics that [#699]'s fix or a future terminal-replacement link might want to revisit.
  Mitigation: §7 is scoped to the relaying case and states its reason (the serving node judges the same facts), so a future ADR that gives a child its own decidable authority supersedes it on the record rather than contradicting it silently.
- Risk: the step-2 characterization test wires more real collaborators than the file's existing tests, and could become brittle.
  Mitigation: it asserts only the response file's `state`/`denialReason` and that the terminal was not reached — no ordering or timing assertions.

## Open Questions

- The two ID spaces still do not join: `authorizer_chain_delegated` carries the tool-call `requestId` while the adjacent `forwarded_permission.*` records carry the forwarded request id, so correlating a delegated ask to the serving node that answered it remains a timestamp-adjacency exercise.
  [#726] already names the shared-correlation-ID gap; this plan does not close it.
- Whether `authorizer_chain_resolved` should also record each link's verdict is deferred to [#726], which is designing the terminal-event provenance shape.
  Adding it here would ship a second, overlapping provenance mechanism.
- The 2026-08-05 cluster (23 warnings, zero forwarding) is consistent with the model-judge extension not being loaded or configured in that project, which the new records will make unambiguous going forward; [#732] is one concrete way that state can arise.

[#598]: https://github.com/gotgenes/pi-packages/issues/598
[#599]: https://github.com/gotgenes/pi-packages/issues/599
[#626]: https://github.com/gotgenes/pi-packages/issues/626
[#635]: https://github.com/gotgenes/pi-packages/issues/635
[#684]: https://github.com/gotgenes/pi-packages/issues/684
[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#702]: https://github.com/gotgenes/pi-packages/pull/702
[#719]: https://github.com/gotgenes/pi-packages/issues/719
[#721]: https://github.com/gotgenes/pi-packages/issues/721
[#726]: https://github.com/gotgenes/pi-packages/issues/726
[#732]: https://github.com/gotgenes/pi-packages/issues/732
