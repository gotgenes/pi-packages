---
issue: 591
issue_title: "pi-permission-system: design the model-assisted permission judge (tool-augmented, deny-first, extensible)"
---

# ADR 0007 — model-assisted permission judge as an Authorizer chain

## Release Recommendation

**Release:** ship independently

This is Phase 11 Step 7, tagged `Release: independent` in the roadmap.
It is a documentation-only decision record: it touches `docs/decisions/` and `docs/architecture/`, both release-please `exclude-paths`, so it cuts no physical release on its own — the same finding [#581] reached before it was reverted.
The design it records is implemented later under [#472], which releases on its own merits.

## Problem Statement

[#472] asks for a case-by-case judge that participates in a permission decision alongside the static rule engine and `yoloMode`, deciding per ask rather than blanket-approving.
It was deferred by name in Phases 9 and 10; [#581] then attempted the decision record but treated it as transcription of the architecture doc's settled `ModelTriageAuthorizer` prose, and that ADR was found premature and reverted.
Two concrete use cases surfaced during the [#581] retro show the real design is broader than — and in one respect contradicts — the reverted prose:

1. **Reject errant "typo" paths automatically.**
   A light model reviews `external_directory` asks, *defers* the ones that do not match a configured typo pattern, and *denies* the ones that do — returning a teaching reason (wrong path; correct location) so the invoking model self-corrects.
2. **Adjudicate opaque bash commands.**
   Commands the deterministic parser cannot decompose (`bash -c "…"`, `eval`, unparseable constructs) floor to `ask` via sentinels.
   A model decomposes the opaque command, queries the deterministic engine per sub-command, and *allows* if clearly fine, *denies* if it hits a denied path, or *defers* if it cannot decide confidently.

This issue is the design gate for [#472] and supersedes [#581].
The deliverable is a decision, not code — so the design below was settled interactively with the operator, not inferred from the existing prose.

## Goals

- Record `docs/decisions/0007-model-judge-authorizer-chain-adr.md` settling the full design across both use cases, so [#472] becomes schedulable on its own merits.
- Establish the verdict range as `allow | deny | defer` — a superset of the reverted ADR's allow-or-escalate framing, driven by use case 1 being deny-first.
- Model the live-authority layer as a **Chain of Responsibility**: each link decides or defers; the terminal link cannot defer and pauses the system until it decides (today, the human).
- Keep the package model-agnostic: it makes no LLM call, exposes a named-capability registration seam plus an injected query capability, and owns only the safety policy it enforces.
- Reconcile the architecture doc's `Discriminating delegation` and `pluggable escalation seam` sections with the chain model, and mark Step 7 complete.
- Record the **dogfooding objective** as slice 1's acceptance criterion: a first-party monorepo package (e.g. `packages/pi-permission-model-judge`) implementing the deny-first typo-path reviewer, so the `registerAuthorizer` seam is born consumed (the [#267] vacant-surface guard) and the config split proves itself concretely.

## Non-Goals

- Implementing the judge, the chain, the `defer` verdict, the registration seam, or the downstream extension — that is [#472]'s, which this ADR unblocks.
- Deciding [#472]'s implementation decomposition (chain infrastructure, deny-first slice, allow-capable slice, the downstream orchestrator package) — that is [#472]'s own `/plan-issue`.
- Building registration for **terminal-replacement** backends (a chat-bot or remote reviewer *as* the authority, not a non-terminal link) — the same seam's other role, built when a real non-subagent backend needs it.
- The non-deterministic access-intent classifier that reshapes intent *before* `evaluate()` — a different seam feeding recorded authority; it keeps its own future decision record and stays out of scope.
- Any `src/`, `test/`, `README.md`, `config.example.json`, or `schemas/` change — no runtime surface references the not-yet-built symbols (verified: `ModelTriageAuthorizer` appears only in `docs/`).

## Background

- `Authorizer` (`src/authority/authorizer.ts`) is the live-authority role: `authorize(details) → Promise<PermissionPromptDecision>`, one method, returning `allow | deny` — there is **no `defer` verdict today**.
- `selectAuthorizer(ctx, deps)` performs a hardcoded three-way dispatch, returning a **single** `Authorizer`: `hasUI` → `LocalUserAuthorizer` (human, decides); `isSubagent` → `ParentAuthorizer` (forwards up to the parent node's authority); else → `DenyingAuthorizer` (headless, always denies).
  Evaluated once per session activation (`AuthorizerSelection.activate`).
  So the chain is effectively length 1 today.
- `PermissionsService` (`src/service.ts`), published via `Symbol.for()` and consumed cross-extension, already answers the query primitives the judge needs: `checkPermission(surface, value?, agentName?)` is "is this external?" (`external_directory`), "what does this bash resolve to / does it hit a deny?" (`bash`, decomposed at gate parity via `resolveBashAdvisoryCheck`, [#309]), and per-surface rule queries; `getToolPermission` answers tool-level state.
- `registerToolAccessExtractor(toolName, extractor)` / `registerToolInputFormatter(toolName, formatter)` are the established named-capability registration seams this design mirrors.
- ADR 0005 (`docs/decisions/0005-serving-authorizer-provenance.md`) established that determinism governs *recorded* authority (`evaluate()`), never the *live*-authority layer — the enabling premise for a non-deterministic model holding an `Authorizer` role.

Standing constraints from AGENTS.md and the package skill that the ADR must honor:

- Registration must land synchronously and be visible before the session's first ask; cross-session visibility rides `globalThis` + `Symbol.for()` (the [#296] bus-split lesson).
- `permissions:ready` is emitted when the service is (re)published, surviving `/reload`.
- Default to least privilege: a session no live authority claims selects `DenyingAuthorizer`.
- A declared config field not read at runtime is a maintenance trap — so this package must not hold model-prompt config it never reads.
- The arch doc inline-copies `rule.ts` types; this design changes no rule type, so that listing is untouched.

## Design Overview

The ADR records the following settled design.
It is documentation; the TypeScript below is the design the ADR commits to, for [#472] to build.

### 1. The live-authority layer is a Chain of Responsibility

Each link either decides (`allow` / `deny`) or defers to the next link.
The terminal link cannot defer; the chain ends there and the system pauses until it decides.

```typescript
type AuthorizerVerdict =
  | { kind: "allow" }
  | { kind: "deny"; reason?: string } // reason is the teaching signal (use case 1)
  | { kind: "defer" };

/** A non-terminal chain link: may decide or defer. */
interface Authorizer {
  authorize(
    details: PromptPermissionDetails,
    query: PermissionQuery,
  ): Promise<AuthorizerVerdict>;
}

/** The terminal link: structurally cannot defer. */
interface TerminalAuthorizer {
  authorize(
    details: PromptPermissionDetails,
    query: PermissionQuery,
  ): Promise<TerminalVerdict>; // { kind: "allow" } | { kind: "deny"; reason? }
}
```

The "terminal cannot defer" invariant is **enforced at the type level**: `TerminalAuthorizer` returns only `allow | deny`, so a link that could defer cannot occupy the terminal slot — violating it is a compile error, not a runtime assertion.
`LocalUserAuthorizer` and `DenyingAuthorizer` are `TerminalAuthorizer`s; `ModelTriageAuthorizer` is an `Authorizer` (non-terminal).
`ParentAuthorizer` is terminal *for its node* — it forwards up and returns the parent node's `allow | deny`, which is the multi-hop recursion ("a node's terminal hands off to the parent node's chain").

### 2. Chain composition: registered links, then the context-selected terminal

`selectAuthorizer` (single terminal) generalizes to `composeAuthorizerChain` (ordered non-terminal links + terminal).
The terminal keeps today's context selection unchanged.

```typescript
function composeAuthorizerChain(
  ctx: ExtensionContext,
  configuredChain: string[], // operator policy: ordered link NAMES
  registry: AuthorizerRegistry,
  query: PermissionQuery,
  policy: DelegationPolicy,
): AuthorizerChain {
  const links = configuredChain
    .map((name) => registry.get(name) ?? warnSkip(name)) // missing → skip, fail-safe
    .filter((link): link is Authorizer => link !== undefined);
  return new AuthorizerChain(links, selectTerminal(ctx), policy); // terminal last
}
```

The chain walks links until one decides, then applies the enforcement checkpoint, then falls to the terminal:

```typescript
async authorize(details: PromptPermissionDetails): Promise<TerminalVerdict> {
  for (const link of this.links) {
    const verdict = await link.authorize(details, this.query);
    if (verdict.kind === "deny") return verdict;
    if (verdict.kind === "allow") {
      // Enforcement checkpoint (owned HERE, not the link):
      // an allow on an excluded surface is downgraded to defer.
      if (this.policy.isDelegationExcluded(details.surface)) continue;
      return verdict;
    }
    // defer -> next link
  }
  return this.terminal.authorize(details, this.query); // never defers
}
```

Three invariants fall out and belong in the ADR:

1. **Config order wins, never registration order.**
   Chain order is security-relevant (an allow-capable link ahead of a deny-capable one changes outcomes), so it is deterministic operator policy — never a function of nondeterministic extension load order.
2. **Skipping any non-terminal link is always fail-safe.**
   A missing or unregistered link removes only allow/deny *shortcuts*; the ask still reaches the terminal.
   Absence of a judge means *more* prompting, never less.
3. **Registration alone grants no authority.**
   A link decides nothing until the operator names it in `authorizerChain` — the opt-in activation model.

### 3. The query capability is injected, not imported

The judge never reaches for `PermissionsService` via `Symbol.for()` (a Law-of-Demeter reach-through to a global).
The chain injects a narrow, session-scoped `PermissionQuery` into each link at `authorize` time — a projection of `PermissionsService` limited to what a link needs (ISP), backed by the same resolver the gates use so it answers at gate parity.

```typescript
/** Narrow, injected projection of PermissionsService. */
interface PermissionQuery {
  checkPermission(surface: string, value?: string, agentName?: string): PermissionCheckResult;
  getToolPermission(toolName: string, agentName?: string): PermissionState;
}
```

The tool-augmented adjudication (use case 2) exposes these primitives to the model *as tools*: the model decomposes an opaque command and calls `checkPermission("bash", subCommand)` / `checkPermission("external_directory", token)` per piece; the deterministic engine answers every sub-question.
The model's non-determinism is confined to *how it decomposes*, never *what the rules decide* — determinism-of-decision survives at the leaf.

### 4. Named-capability registration, opt-in activation, `permissions:ready` hook

Registration mirrors `registerToolAccessExtractor`: a downstream extension offers a **named** capability.
The `PermissionsService` interface gains one method:

```typescript
registerAuthorizer(name: string, authorize: Authorizer["authorize"]): () => void;
```

The consumer call site (the downstream `pi-permission-model-judge` extension) registers in a `permissions:ready` handler so it is robust to load order and survives `/reload`:

```typescript
pi.events.on("permissions:ready", () => {
  const orchestrator = createOrchestrator(myConfig); // reads model/provider/prompt HERE
  getPermissionsService()?.registerAuthorizer("model-judge", (details, query) =>
    orchestrator.judge(details, query), // query injected; no service reach-through
  );
});
```

The ordering contract the ADR fixes:

```text
1. load     pi-permission-system publishes PermissionsService + emits `permissions:ready`
2. register downstream (on `permissions:ready`) offers registerAuthorizer("model-judge", fn)
              → parked in the registry; grants NO authority yet
3. compose  per session, pi-permission-system reads config.authorizerChain and binds
              names → registered capabilities; a name with no registration is skipped + warned
4. ask      chain walked; each link gets injected PermissionQuery; enforcement checkpoint
              downgrades an excluded-surface allow to defer; terminal always decides
```

### 5. Config split: policy here, mechanism downstream

Two independent extension config files, joined only by the link name — no merged schema.
This package declares and *enforces* the safety policy; the downstream extension declares and *uses* the model mechanism.

```jsonc
// pi-permission-system config.json — operator-owned policy (read + enforced HERE)
{
  "authorizerChain": ["model-judge"],           // ordered link names; the activation gate
  "modelDelegation": {
    "allowedSurfaces": ["bash"],
    "excludedSurfaces": ["external_directory"]   // + secret-shaped path always excluded
  }
}
```

```jsonc
// pi-permission-model-judge config.json — downstream-owned mechanism (read THERE)
{ "provider": "anthropic", "model": "claude-haiku-…", "instructions": "…", "timeoutMs": 5000 }
```

The bounded-delegation policy is enforced at the chain's checkpoint (§2), so a buggy or over-eager external judge can never exceed what the operator's policy permits.
This is why the split is safe: policy lives where it is enforced; mechanism lives where the LLM call is made.

### 6. Two slices, a capability gradient

Both use cases are the *same* `ModelTriageAuthorizer` link; they differ only by which verdicts are enabled and how much envelope guards them.

| Aspect       | Slice 1 — deny-first reviewer (use case 1)                     | Slice 2 — allow-capable adjudicator (use case 2)                                                                  |
| ------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Verdicts     | `deny`, `defer`                                                | `+ allow`                                                                                                         |
| Risk         | strictly more restrictive — always safe                        | loosens privilege — needs full envelope                                                                           |
| Envelope     | fail-closed only (unreachable/uncertain → defer)               | + hard exclusions, audit `origin:"authorizer:model"`, non-persistence, off by default, bounded-delegation ruleset |
| Failure mode | a wrong deny — recoverable (agent self-corrects on the reason) | decomposition infidelity — mis-split obfuscation (`bash -c "safe; evil"`) allowed on the safe piece alone         |

The ADR states plainly that the "can never grant more than the engine grants for the pieces it identifies" safety property holds *only if decomposition is faithful*; obfuscation is the residual risk, and it is exactly why slice 2 is gated behind the whole envelope while slice 1 needs almost none.
The gradient is the argument for shipping deny-first.

Slice 1 is validated by **dogfooding**: a first-party extension in this monorepo (e.g. `packages/pi-permission-model-judge`) implementing the typo-path reviewer against the real seam.
This is a design safeguard, not just a demo — the arch doc's [#267] history guard warns that an inbound registration surface nobody consumes goes vacant; a first-party consumer registering `"model-judge"` on day one makes `registerAuthorizer` born consumed, and its own config file (provider/model/instructions) exercises the config split end to end.
The ADR's Consequences section names this objective; the concrete issue is filed by the next `/plan-improvements` pass when the phase is scoped.

### Relationship to `evaluate()` and rule-driven promotion

The judge sits on the ask-*consuming* side of `evaluate()`, distinct from the ask-*producing* side (rule-driven promotion, [#509]).
Rule-driven promotion produces the fail-safe false-positive ask (`git grep id_rsa` prompts); the judge dismisses it on the consuming side without hard-coding per-command file-argument tables.
The two compose cleanly: a promoted token emits the same structured descriptor a prefixed path does, so a link needs no promotion-specific knowledge.

## Module-Level Changes

Documentation only.
No `src/`, `test/`, `README.md`, config, or schema change.

- **New:** `packages/pi-permission-system/docs/decisions/0007-model-judge-authorizer-chain-adr.md` — the ADR recording §1–§6, rejected alternatives (opt-out activation; judge imports `PermissionsService`; a single terminal instead of a chain; ask-only allow-or-escalate verdict range), and accepted limitations ([#472] owns provider/prompt/threshold/timeout tuning, the slice decomposition, and the downstream package; terminal-replacement registration deferred; the pre-`evaluate()` classifier keeps its own future ADR).
  The Consequences section names the dogfooding objective: slice 1 is accepted by a first-party monorepo judge extension registering against the real seam.
  The reverted 0007 slot is free, so this is ADR 0007.
- **Changed:** `packages/pi-permission-system/docs/architecture/architecture.md`
  - Rewrite the `Discriminating delegation: a model Authorizer` section (line ~604): the chain model, verdict range `allow | deny | defer`, deny-first two-slice gradient, injected `PermissionQuery`, opt-in named registration, config split — superseding the ask-only allow-or-escalate framing.
  - Reconcile the `Beyond the target: a pluggable escalation seam` section (line ~681): it is now *subsumed* by the chain — registering a link is the seam; a terminal-replacement backend is the same seam's terminal role, deferred (not a mechanism beside the chain).
  - Leave the `Beyond the target: a non-deterministic access-intent classifier` section (line ~668) intact — still out of scope with its own future ADR.
  - Reword the aspirational-extension-points sentence (line ~499): the model-triage `Authorizer` and the pluggable escalation seam are now designed (link ADR 0007); the classifier remains aspirational.
  - Reconcile the `Resolved direction` recursion language (line ~633+) from "a node's `Authorizer`" to the chain framing where the terminal hands off to the parent node's chain.
  - Mark Phase 11 Step 7 complete: `✅` on the `#### Step 7:` heading and the `S7` Mermaid node, and link ADR 0007 from both the step target and the `Discriminating delegation` section.
  - Update the [#472] deferral dispositions (lines ~900, ~1041) to record that [#472] now carries this ADR and is schedulable.
- **Not edited:** `docs/architecture/history/phase-8|9|10-*.md`, `docs/plans/0509|0555|0556|0557|0581-*.md`, `docs/retro/0581-*.md`, `docs/retro/phase-9-*.md` — these are frozen point-in-time records that mention `ModelTriageAuthorizer`; they are not live design docs and must not be rewritten.

## Test Impact Analysis

Not applicable in this issue — the deliverable is a decision record with no code.
The tests the design *enables for [#472]* (recorded here so [#472]'s TDD plan inherits them): a chain walk that stops at the first deciding link; the `defer` verdict advancing the cursor; the terminal-cannot-defer type constraint; a missing configured link name skipping fail-safe; the enforcement checkpoint downgrading an excluded-surface `allow` to `defer`; opt-in activation (a registered-but-unconfigured link deciding nothing); and the injected `PermissionQuery` answering at gate parity.

## Invariants at risk

This is the exact failure mode that reverted [#581]: an internally consistent ADR that contradicts un-reconciled prose elsewhere in the architecture doc.
The pre-completion reviewer must confirm cross-doc consistency, not just the ADR's internal coherence.

- **Cross-doc verdict-range consistency.**
  The pre-revert `Discriminating delegation` prose frames the judge as ask-only, allow-or-escalate; the new design is `allow | deny | defer`.
  Grep the whole architecture doc for stale framing before finalizing: `grep -nE "ask-only|allow-or-escalate|escalate|ModelTriageAuthorizer|quarantine|a model .Authorizer" architecture.md`. ([#581] missed the non-persistence parenthetical at line ~627 because its grep targeted one section; sweep the whole file.)
- **Recursion language.**
  The `Resolved direction` and `the recursion` passages describe "a node's `Authorizer`"; under the chain they describe a node's *chain* whose terminal hands off upward.
  Both must read consistently.
- **Aspirational list.**
  Line ~499 lists the model-triage Authorizer and the pluggable escalation seam as aspirational; ADR 0007 designs both, so the list must move them to "designed, pending [#472]."

## Build Order

Documentation-only, so `/build-plan` (no red→green cycles).
Numbered `docs:` commits, each leaving the docs internally consistent.

1. **Author the ADR.**
   Write `docs/decisions/0007-model-judge-authorizer-chain-adr.md` (§1–§6, rejected alternatives, accepted limitations, reference-link definitions).
   Verify with `pnpm exec rumdl check` on the new file.
   Commit: `docs(pi-permission-system): record ADR 0007 for the model-judge Authorizer chain (#591)`.
2. **Reconcile the architecture doc and mark Step 7 complete.**
   Rewrite `Discriminating delegation`, reconcile the `pluggable escalation seam` and `Resolved direction` sections and the aspirational list, mark Step 7 `✅` (heading + `S7` node), link ADR 0007, and update the [#472] dispositions — in one commit so the doc is never half-reconciled.
   Run the whole-file grep from *Invariants at risk* to confirm no stale framing remains, and verify the four Mermaid diagrams still render.
   Commit: `docs(pi-permission-system): reconcile architecture with ADR 0007 and mark Phase 11 Step 7 (#591)`.

Marking Step 7 completes all seven Phase 11 steps.
Flipping the Phase 11 heading to `(complete)` and extracting its detail to `history/phase-11-*.md` is a distinct phase-close activity (the pattern Phases 9–10 follow), out of scope here — route it to `/finish-phase` as [#581] did.

## Risks and Mitigations

- **Risk: another transcription-not-decision slip.**
  Mitigated: the design above was settled interactively (chain model, injected query, opt-in activation, config split) rather than lifted from the reverted prose; the ADR records *why* each fork went the way it did (rejected alternatives), which is the deliberation an ADR exists to carry.
- **Risk: the ADR over-commits implementation detail that belongs to [#472].**
  Mitigated: provider/prompt/threshold/timeout, the slice decomposition, and the downstream package are explicit accepted-limitations deferred to [#472]; the ADR settles architecture and safety envelope only.
- **Risk: stale architecture-doc prose survives reconciliation (the [#581] failure).**
  Mitigated: the *Invariants at risk* whole-file grep and the pre-completion reviewer's cross-doc check.
- **Risk: scope creep into building the chain.**
  Mitigated: Non-Goals fences this to docs; no `src/`/`test/` change; [#472] implements.

## Open Questions

- **[#472]'s implementation decomposition.**
  This design is materially larger than [#472]'s original "support a case-by-case judge" framing (a chain refactor of the Authorizer spine + `defer` verdict + named registration + injected `PermissionQuery` + config + two judge slices + a new downstream orchestrator package).
  The next `/plan-improvements` pass sequences this: [#472]'s decomposition (chain infrastructure; deny-first slice; allow-capable slice) plus the dogfood extension become roadmap-step candidates, and the dogfood-extension issue is filed there — deferred deliberately, not filed speculatively here.
  The dogfood extension lives in this monorepo as a new package (per the AGENTS.md new-package checklist), settled during planning.
- **Terminal-replacement registration.**
  Registering a backend *as* the terminal authority (a chat-bot / remote reviewer replacing the human) is the chain seam's other role, deferred until a real non-subagent backend needs it; noted in the ADR as future, not filed.

[#267]: https://github.com/gotgenes/pi-packages/issues/267
[#296]: https://github.com/gotgenes/pi-packages/issues/296
[#309]: https://github.com/gotgenes/pi-packages/issues/309
[#472]: https://github.com/gotgenes/pi-packages/issues/472
[#509]: https://github.com/gotgenes/pi-packages/issues/509
[#581]: https://github.com/gotgenes/pi-packages/issues/581
