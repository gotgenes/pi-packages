---
issue: 786
issue_title: "pi-permission-system: decide the cross-node extension contract — node-locality, registration channel, and the subagent adapter convention (ADR 0012)"
---

# ADR 0012 — the cross-node extension contract

## Release Recommendation

**Release:** ship independently

Issue #786 is not a numbered step in `docs/architecture/architecture.md`'s improvement roadmap (all thirteen phases are closed and archived), so there is no `Release:` batch tag to honor.
The deliverable is documentation only: `packages/pi-permission-system/docs/decisions` and `docs/architecture` are both release-please `exclude-paths`, so this cuts no physical release on its own, exactly as the ADR 0009 plan ([#639]) and the ADR 0011 plan ([#737]) did.
The decisions it records are implemented later by downstream issues (starting with [#699]), and those changes release on their own merits.

## Problem Statement

Issue [#699] reports that a sibling authorizer extension in an in-process subagent child calls `getPermissionsService().registerAuthorizer(...)`, reaches the parent's service, and throws a duplicate-registration error twice per subagent start.
Its proposed fixes (an exported child detector, a typed error) treat the throw as the defect.
Planning showed the throw is one symptom of a wider contract gap between three parties — pi-permission-system, subagent implementations, and permission extensions — and the operator directed that the contract be settled as an ADR first, with [#699] re-scoped as a downstream implementation issue.

The deliverable is ADR 0012, settled interactively during the build session.
The [#581] lesson applies in full: the deliberation is the deliverable, and the ADR must record decisions actually made with the operator, not transcribe the sketches produced during this planning conversation.

## Goals

- Record ADR 0012 in `docs/decisions/0012-cross-node-extension-contract.md`, settling the seven-parameter decision set below.
- Hold every decision against the six objectives (O1–O6) the planning deliberation converged on, and record any objective the operator amends or rejects.
- Keep the ADR consistent with the decisions that stand: one chain per node (`docs/decisions/0007-model-judge-authorizer-chain-adr.md` §7) and the inverted subagent dependency (pi-subagents ADR 0002).
- Leave a decision-to-implementation map: which downstream issue implements which decision, starting with [#699].

## Non-Goals

- Implementing anything: no code, config, schema, or default changes in this step.
- Fixing [#699] — it stays open as the first implementation issue of decisions 2 and 4.
- Evaluating or merging PR [#702] — it is assessed against the settled contract afterward, not against [#699]'s option list.
- Changing `@gotgenes/pi-subagents` or `@gotgenes/pi-permission-model-judge` — the judge is the migration test case named in decision 7, and its change lands downstream.
- Filing the downstream implementation issues now — their shape depends on the decisions, so the build session files them after the ADR is accepted (see Build Order step 7).

## Background

### The mechanism, verified

The service published at `Symbol.for("@gotgenes/pi-permission-system:service")` carries three registration surfaces, and they are read by different nodes:

| Registry                           | Read by               | Read at                                                   |
| ---------------------------------- | --------------------- | --------------------------------------------------------- |
| `ToolAccessExtractorRegistry`      | the requesting node   | its own `tool_call` gates (`path` / `external_directory`) |
| `ToolInputFormatterRegistry`       | the requesting node   | payload/preview construction                              |
| `AuthorizerRegistry` (chain links) | the adjudicating node | `AuthorizerSelection.escalate`, per ask                   |

A child session runs its own gates and fixes the ask's facts before forwarding ([#635]), so a child needs its own extractors and formatters.
An in-process child registering into the parent's service therefore gets a duplicate throw parent-side and a missing extractor child-side, where its own gates read — the latter silently weakens path gating for custom-path extension tools in children, a worse defect than the reported one.

The boundary crossing itself: the [#302] guard is one-way.
A registered child does not publish (`PermissionServiceLifecycle.activate`, `src/service-lifecycle.ts`), but the child's consumers still resolve the parent's service object, which cannot know its caller is another session.

Two further facts constrain any fix:

- The SDK event bus hands handlers only the payload (`dist/core/event-bus.d.ts`: `on(channel, handler: (data: unknown) => void)`) — there is no `ctx` argument at `permissions:ready`, so the documented registration site cannot consult a `ctx`-keyed predicate.
  The bus also wraps handlers in `try`/`catch` + `console.error`, which is the "warning per subagent start" [#699] reports.
- `permissions:ready` has no latch: an extension loading after pi-permission-system never sees the broadcast.
  `pi-permission-model-judge` (`src/extension.ts`) registers from both `session_start` and `permissions:ready` behind an idempotency guard for exactly this reason — a workaround for a contract gap, not the documented pattern.

### Process shape changes the symptom, not the question

| Node                                  | Owns its service?          | Hosts a chain?            | `registerAuthorizer` today             |
| ------------------------------------- | -------------------------- | ------------------------- | -------------------------------------- |
| in-process child (registry-detected)  | no — resolves the parent's | no — relays (ADR 0007 §7) | throws, 2× per subagent start          |
| own-process child (env-hint-detected) | yes — its own process slot | no — relays (ADR 0007 §7) | succeeds into a registry nothing reads |

Both node shapes answer "should this node host a link?"
identically: no. Any fix keyed on "am I a registered in-process child" — the shape of [#699]'s Option A and PR [#702] — is process-specific by construction (it reads shared `globalThis` memory that only exists in-process) and leaves the silent case silently wrong.
Conversely, `permissions:ready` is a per-session channel that behaves identically in both shapes.

One counterexample constrains the "links sit at the parent" intuition: `selectAuthorizer` (`src/authority/authorizer.ts`) gives a headless non-subagent node (CI) `DenyingAuthorizer` with `adjudicatesLocally: true` — it runs its chain, and a model judge there is meaningful.
The correct rule is role-scoped, not location-scoped.

### Extension loading is already asymmetric

pi-subagents' `excludedExtensionPackages` (`packages/pi-subagents/src/settings.ts`, applied at the composition root in `src/index.ts`) can exclude packages from child sessions.
Excluding a link-only extension is today's manual workaround for [#699]'s noise; excluding an extractor provider would break the child's own gates.
The contract must make riding along harmless, so exclusion stays an optimization, never a correctness requirement.

### Constraints from repo conventions

- ADR frontmatter carries `status:`; a superseded ADR keeps its historical value (AGENTS.md § Reading this repo's own artifacts).
- `docs/architecture/architecture.md` module-tree and section prose describe current behavior; the ADR records the decision, and only implemented behavior migrates into the architecture doc (per the architecture-doc conventions).
- The stability guarantee in `src/permission-events.ts` ("fields may be added, but existing fields will not be removed or renamed without a semver-major version bump") bounds which candidate mechanisms are additive.

## Design Overview

The ADR's spine is one candidate law plus six dependent parameters.
Nothing below is decided; each parameter lists the candidates the deliberation keeps on the table, and the build session settles them with the operator in sequence.

### Objectives (to be confirmed or amended first)

- **O1 — Safe by construction, not safe-if-you-remember.**
  A new sibling author writes one handler and cannot get it wrong.
- **O2 — Never silently vacant.**
  A registration is honored or impossible — never a no-op nobody notices ([#727]'s lesson).
- **O3 — Process shape invisible to siblings.**
  A permission extension never learns what a subagent is.
- **O4 — Subagent implementations stay ignorant of permissions.**
  ADR 0002's inverted dependency is untouched.
- **O5 — No new cross-extension surface unless it earns its place.**
- **O6 — Out-of-process subagent implementations are first-class.**
  A contract fact must travel on a channel that exists in both shapes.

### Parameter 1 — node-locality as stated law

Candidate statement: facts travel (the forwarded ask, [#635]), code doesn't (registrations never cross a node boundary); each node is self-contained, and the ask channel plus the serving heartbeat are the only inter-node channels.
The codebase is already almost there — policy is config-derived per process, the ask path is cross-process via the filesystem forwarding dir, and every registry is node-local by design.
The single violation is the service accessor crossing the in-process session boundary.
The alternative is to reject the law and make registration cross-process (e.g. transport a child's link registration to the serving node) — kept on the table, with the recorded §7 objections (double adjudication; a link deciding an ask the serving node's policy owns; the serving node already hosts its own instance of the same extension).

### Parameter 2 — the registration channel

How a sibling obtains a service that is truthfully its own node's:

- **Capability on the ready payload** — `PermissionsReadyEvent` carries the emitting node's own service (or nothing where registration is invalid); the consumer never calls the global accessor on the registration path.
- **Role-gated emission** — `permissions:ready` stops firing on nodes where registration is invalid or useless; consumers are fixed without change, at the cost of narrowing the event's published meaning.
- **Advisory payload fields** — additive booleans (`ownsService`, `adjudicatesLocally`); honest but opt-in, which strains O1.
- **Session-keyed accessor redesign** — `getPermissionsService()` (or a successor) answers per-session; the largest contract change.
- Combinations of the above, and in each case: what happens to `getPermissionsService()` (survives for queries, deprecated for registration, or unchanged).

Both facts a candidate needs are computed before the current emit point: `authorizerSelection.activate` runs before `serviceLifecycle.activate` inside `PermissionSession.resetForNewSession`, so `SelectedAuthority.adjudicatesLocally` and the [#302] `ownsService` boolean are both available where `emitReadyEvent` is called.

### Parameter 3 — the ready latch

Candidate: re-emit `permissions:ready` once per session at the first `before_agent_start` (which precedes any tool call, hence any ask), so `permissions:ready` alone is a sufficient registration site and the dual-path workaround dies.
Alternatives: a pull API (query readiness), or no latch (keep the dual-path pattern documented instead of worked around).
Consumer idempotency guards (the judge's `dispose` check) already absorb a repeated emit.

### Parameter 4 — the vacant-link cell

A link registered on a relaying node is never consulted.
Candidates: accept-and-observe (a review-log record mirroring `authorizer_chain_delegated`, keeping O2) or refuse loudly.
Machine-readable duplicate-registration errors ride along here: a Node-convention `code` property (immune to jiti module-identity skew, unlike an exported class and `instanceof`) on the errors thrown by `registerAuthorizer`, `registerToolInputFormatter`, and `registerToolAccessExtractor` — or on none, if detection makes remaining duplicates genuine bugs that should surface raw.

### Parameter 5 — the subagent adapter convention

Name and document the child-announcement contract as the one supported API for subagent implementations: bus events (`subagents:child:session-created` / `disposed`) in-process; env var plus forwarding dir out-of-process.
Today these are one convention documented as two accidents (the architecture doc's "External convention guide" section plus pi-subagents ADR 0002).
The parameter settles what the convention promises, where it lives, and that implementations owe nothing else (O4).

### Parameter 6 — extension-loading asymmetry

The contract statement that permission extensions may ride into child sessions harmlessly, so `excludedExtensionPackages`-style exclusion is an optimization, never a correctness requirement — and the converse warning that excluding an extractor/formatter provider from children weakens the child's own gates.

### Parameter 7 — migration

What changes for existing consumers and whether the cut is staged.
`pi-permission-model-judge` is the only known link registrar and the named test case: under a correct contract its registration code gets smaller (the dual path and its comment go away).
Formatter/extractor consumers are unknown externally; the stability guarantee in `src/permission-events.ts` decides whether each candidate is a minor or major version event, and the ADR records the semver call.

### Decision-to-implementation map (recorded in the ADR's Consequences)

At minimum: [#699] implements decisions 2 and 4; the latch (3) and the judge migration (7) are filed as new issues by the build session once shaped; PR [#702] is evaluated against the contract.

## Module-Level Changes

- `packages/pi-permission-system/docs/decisions/0012-cross-node-extension-contract.md` — new; the ADR (`status: accepted` once settled), carrying context, objectives, the seven decisions with rejected alternatives, and consequences including the decision-to-implementation map.
- `packages/pi-permission-system/docs/decisions/0007-model-judge-authorizer-chain-adr.md` — no edit expected; ADR 0012 cites §7 as an input that stands.
  If a decision genuinely amends §7, the build session records the amendment in 0007's header (the existing "Amended 2026-08-14" pattern) rather than silently contradicting it.
- `packages/pi-permission-system/docs/architecture/architecture.md` — a pointer to ADR 0012 from the "Cross-extension service accessor" section, added only for the decisions that stand; behavioral prose is untouched until implementation lands (architecture docs describe current behavior).
- No `src/`, `test/`, config, or schema changes.
- No README or `docs/cross-extension-api.md` changes — those document current behavior and are updated by the implementation issues.

## Test Impact Analysis

Docs-only; no test cycles.
The testable surface is the set of mechanical claims the ADR rests on, each dry-run during planning; the build session re-verifies before drafting:

- Event-bus handler signature: `cat node_modules/.pnpm/@earendil-works+pi-coding-agent@0.80.5*/node_modules/@earendil-works/pi-coding-agent/dist/core/event-bus.d.ts` — expect `on(channel: string, handler: (data: unknown) => void)`.
- Activation ordering: `grep -n "resetForNewSession" -A 8 packages/pi-permission-system/src/permission-session.ts` — expect `this.authorizerSelection.activate(ctx)` inside `activate`, called before `SessionLifecycleHandler` reaches `serviceLifecycle.activate`.
- Role dispatch: `grep -n "adjudicatesLocally" packages/pi-permission-system/src/authority/authorizer.ts` — expect `true` for the `hasUI` and `DenyingAuthorizer` branches, `false` for the `ParentAuthorizer` branch.
- Loading asymmetry: `grep -n "excludedExtensionPackages" packages/pi-subagents/src/index.ts` — expect the composition-root exclusion wiring.
- Lint: `pnpm exec rumdl check packages/pi-permission-system/docs/decisions/0012-cross-node-extension-contract.md` plus the touched architecture doc.

## Invariants at risk

- **One chain per node** (ADR 0007 §7, pinned by `test/authority/authorizer-selection.test.ts` "a child cannot host a link").
  ADR 0012 must extend, not contradict; any amendment is explicit in 0007's header.
- **Inverted subagent dependency** (pi-subagents ADR 0002; restated in `src/authority/subagent-lifecycle-events.ts`).
  No decision may require pi-subagents to import or know pi-permission-system.
- **The [#302] publish guard** (a child never clobbers the parent's service slot; pinned in `test/composition-root.test.ts`).
  Candidate mechanisms change who *receives* a service, never who publishes to the global slot.
- **The events stability guarantee** (`src/permission-events.ts` header).
  The ADR must classify each adopted mechanism as additive or breaking against it, in writing.

## Build Order

Docs-only — execute with `/build-plan`.
Each deliberation gate presents the substance in a message (worked examples, before/after consumer code, trade-offs) and then puts a short `ask_user` to the operator, per the clarification-gate convention; decisions are recorded in the ADR draft as they are made.

1. Re-verify the four mechanical claims (commands in Test Impact Analysis); fix the plan's premises if any drifted.
   Commit nothing.
2. Gate A — objectives and parameter 1.
   Confirm or amend O1–O6; settle node-locality as law or reject it.
   Everything downstream branches on this.
3. Gate B — parameter 2 (registration channel) and its `getPermissionsService()` disposition, presented with the worked model-judge consumer under each candidate.
4. Gate C — parameters 3 and 4 (latch; vacant cell and error `code` scope).
5. Gate D — parameters 5 and 6 (adapter convention; loading asymmetry statement).
6. Gate E — parameter 7 (migration, semver classification per the stability guarantee, staging).
7. Author `docs/decisions/0012-cross-node-extension-contract.md` from the recorded decisions; add the architecture-doc pointer; lint both.
   Commit: `docs(pi-permission-system): record ADR 0012 — the cross-node extension contract`.
8. File the downstream implementation issues the decisions shaped (latch, judge migration, and any accessor work), re-scope [#699]'s task list against the ADR in a comment, and run the roadmap-fit skill per filed issue.
   Commit the plan/retro cross-reference updates if any: `docs(pi-permission-system): map ADR 0012 decisions to implementation issues`.

## Risks and Mitigations

- **The ADR fossilizes a candidate instead of a deliberation.**
  Mitigation: the [#581] rule is restated in Problem Statement and Build Order — gates first, drafting last; the ADR records rejected alternatives per parameter.
- **Scope creep into implementation.**
  Mitigation: Non-Goals pins zero code changes; the decision-to-implementation map gives every "let's just fix it now" impulse a filed home instead.
- **Contradicting ADR 0007 §7 by accident.**
  Mitigation: listed in Invariants at risk; the build session diffs the drafted decisions against §7 before commit.
- **PR [#702]'s author is left in the dark.**
  Mitigation: already mitigated — the re-scope comment on [#699] links this deliberation; step 8 comments again with the settled contract.
- **The operator's earlier "no vote yet" stance.**
  Mitigation: the gates present substance before options, and parameter 1 is deliberately a two-sided question (adopt or reject the law), not a rubber stamp.

## Open Questions

- Whether `permissions:ready`'s meaning narrows ("you may register here") or stays "the service is resolvable" — settled at Gate B, since it decides the query-only-consumer story in children.
- Whether a relaying node's vacant link registration is accepted-and-observed or refused — Gate C.
- Whether any part of the contract warrants a semver-major cut now versus staged deprecation — Gate E.

[#302]: https://github.com/gotgenes/pi-packages/issues/302
[#581]: https://github.com/gotgenes/pi-packages/issues/581
[#635]: https://github.com/gotgenes/pi-packages/issues/635
[#639]: https://github.com/gotgenes/pi-packages/issues/639
[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#702]: https://github.com/gotgenes/pi-packages/pull/702
[#727]: https://github.com/gotgenes/pi-packages/issues/727
[#737]: https://github.com/gotgenes/pi-packages/issues/737
