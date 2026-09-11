---
status: accepted
date: 2026-07-15
---

# 0007 — Model-assisted permission judge as an Authorizer chain

## Status

Accepted.
This decision settles the design of a case-by-case model judge ([#472]); it does not implement it.
[#472] stays open, tracking the implementation, and carries this ADR.
It supersedes the reverted ADR 0007 attempted under [#581].
Amended 2026-08-14 with §7 (one chain per node), which settles where a subagent's ask is adjudicated ([#727]).

## Context

`yoloMode` is the only non-static path in a permission decision today: a single boolean that rewrites every `ask` rule to `allow` at composition time (`origin: "yolo"`), suppressing prompts while preserving hard denies.
It is all-or-nothing — it cannot approve one clearly safe `ask` and still prompt on the rest.

[#472] asks for a case-by-case judge: a light model (e.g. Claude Haiku) that participates in a decision, deciding per ask.
It was deferred by name in Phases 9 and 10.
[#581] then attempted a decision record but treated it as transcription of the architecture doc's settled `ModelTriageAuthorizer` prose — an ask-only, allow-or-escalate decorator — and that ADR was found premature and reverted.
An ADR's value is the deliberation behind it; the prose itself was the wrong input.

Two concrete use cases, surfaced during the [#581] retro, show the real design is broader than — and in one respect contradicts — the reverted prose:

1. **Reject errant "typo" paths automatically.**
   Models frequently invoke tools against a malformed path (e.g. `…/pi-permission-system/packages/pi-permission-system/src/x.ts`, where the first segment should be `pi-packages`).
   These land as `external_directory` asks that a human hand-denies one by one.
   A light model should review such asks, *defer* the ones that do not match a configured typo pattern, and *deny* the ones that do — returning a teaching reason (wrong path; correct location) so the invoking model self-corrects.
2. **Adjudicate opaque bash commands.**
   Commands the deterministic parser cannot decompose (`bash -c "…"`, `eval`, unparseable constructs) floor to `ask` via sentinels.
   A model should decompose the opaque command, query the deterministic engine per sub-command, and *allow* if clearly fine, *deny* if it hits a denied path, or *defer* if it cannot decide confidently.

The enabling premise is that nothing constrains an `Authorizer` to be deterministic.
`LocalUserAuthorizer` is already a non-deterministic oracle — the human — and the determinism principle governs *recorded* authority (`evaluate()`), never the live-authority layer (ADR `docs/decisions/0005-serving-authorizer-provenance.md`).
A model can hold the `Authorizer` role on the same terms.

## Decision

Model the live-authority layer as a **Chain of Responsibility**, and place the model judge in it as a non-terminal link.

### 1. Verdict range is `allow | deny | defer`

Each link either decides (`allow` / `deny`) or defers to the next link.
This is a superset of the reverted ADR's ask-only allow-or-escalate framing: use case 1 is deny-first, and an `Authorizer` already denies (the human does; `DenyingAuthorizer` always does), so a model in that role can deny an ask too.
A `deny` carries an optional `reason` — the teaching signal use case 1 needs.

```typescript
type AuthorizerVerdict =
  | { kind: "allow" }
  | { kind: "deny"; reason?: string }
  | { kind: "defer" };
```

### 2. The terminal link cannot defer

The chain ends at a terminal that must decide; until it does, the system pauses.
Today that terminal is the human (`LocalUserAuthorizer`), the headless `DenyingAuthorizer`, or `ParentAuthorizer` (terminal *for its node* — it forwards up and returns the parent node's `allow | deny`, the multi-hop recursion).

The invariant is enforced **at the type level**, not by a runtime assertion: a terminal returns only `allow | deny`, so a link that could defer cannot occupy the terminal slot.

```typescript
/** A non-terminal chain link: may decide or defer. */
interface Authorizer {
  authorize(details: PromptPermissionDetails, query: PermissionQuery, log: AuthorizerLog): Promise<AuthorizerVerdict>;
}

/** The terminal link: structurally cannot defer. */
interface TerminalAuthorizer {
  authorize(details: PromptPermissionDetails, query: PermissionQuery): Promise<TerminalVerdict>;
}
// TerminalVerdict = { kind: "allow" } | { kind: "deny"; reason?: string }
```

`selectAuthorizer` (which returns a single `Authorizer` today) generalizes to `composeAuthorizerChain`: registered non-terminal links, then the context-selected terminal last.
The terminal selection is unchanged.

### 3. The query capability is injected, not imported

A link never reaches for the cross-extension `PermissionsService` via `Symbol.for()` (a Law-of-Demeter reach-through to a global).
The chain injects a narrow, session-scoped `PermissionQuery` into each link at `authorize` time — a projection limited to what a link needs (ISP), backed by the same resolver the gates use so it answers at gate parity.

```typescript
/** Narrow, injected projection of PermissionsService. */
interface PermissionQuery {
  checkPermission(surface: string, value?: string, agentName?: string): PermissionCheckResult;
  getToolPermission(toolName: string, agentName?: string): PermissionState;
}
```

The tool-augmented adjudication (use case 2) exposes these primitives to the model *as tools*: the model decomposes an opaque command and calls `checkPermission("bash", subCommand)` / `checkPermission("external_directory", token)` per piece; the deterministic engine answers every sub-question.
The model's non-determinism is confined to *how it decomposes*, never *what the rules decide* — determinism-of-decision survives at the leaf.

#### The review-log seam is injected the same way

A link is handed a second narrow capability at `authorize` time: an `AuthorizerLog`, for recording its decision trail.
The motivation is observability — without it a link's verdict (especially a `defer`) is unobservable, so a misbehaving link deferring every ask is indistinguishable from a link never running (the `pi-permission-model-judge` auth-failure that motivated this addition).
The seam follows the same injection discipline as `PermissionQuery`: a link never reaches for the session logger via `Symbol.for()`; the chain owner passes the session's own logger straight through, so a link's entries land in the same `pi-permission-system-permission-review.jsonl` as the gate decisions, keyed by `requestId`.

```typescript
/** Narrow, injected review-log seam. */
interface AuthorizerLog {
  review(event: string, details?: Record<string, unknown>): void; // durable, default-on audit entry
  debug(event: string, details?: Record<string, unknown>): void; // verbose detail, gated by `debugLog`
}
```

The seam only *records*; it grants no authority and cannot alter a verdict, so it is inert with respect to the bounded-delegation invariant below.

### 4. Named-capability registration, opt-in activation

Registration mirrors `registerToolAccessExtractor`: a downstream extension offers a **named** capability on the published service.

```typescript
registerAuthorizer(name: string, authorize: Authorizer["authorize"]): () => void;
```

The downstream extension registers in a `permissions:ready` handler, so registration is robust to load order and survives `/reload`; it must land before the session's first ask.
Composition then reads the operator's configured chain and binds names to registered capabilities.

Three invariants govern the seam:

1. **Config order wins, never registration order.**
   Chain order is security-relevant (an allow-capable link ahead of a deny-capable one changes outcomes), so it is deterministic operator policy — never a function of nondeterministic extension load order.
2. **Skipping any non-terminal link is always fail-safe.**
   A missing or unregistered configured name removes only allow/deny *shortcuts*; the ask still reaches the terminal.
   Absence of a judge means *more* prompting, never less — so a missing name is skipped with a warning.
3. **Registration alone grants no authority.**
   A registered link decides nothing until the operator names it in the `authorizerChain` config — the opt-in activation model.
   Installing a judge extension does not silently hand it decision authority.

### 5. Config split: policy here, mechanism downstream

Two independent extension config files, joined only by the link name — no merged schema.
This package declares and *enforces* the safety policy; the downstream extension declares and *uses* the model mechanism.

```jsonc
// pi-permission-system config.json — operator-owned policy (read + enforced HERE)
{
  "authorizerChain": ["model-judge"],
  "modelDelegation": {
    "allowedSurfaces": ["bash"],
    "excludedSurfaces": ["external_directory"] // + secret-shaped path always excluded
  }
}
```

```jsonc
// pi-permission-model-judge config.json — downstream-owned mechanism (read THERE)
{ "provider": "anthropic", "model": "claude-haiku-…", "instructions": "…", "timeoutMs": 5000 }
```

The bounded-delegation policy is enforced at an **enforcement checkpoint** the chain owner (this package) applies to every verdict: a link's `allow` on an excluded surface is downgraded to `defer`.
So the safety envelope lives where it is enforced, and a buggy or over-eager external judge can never exceed the operator's policy.
This package holds no model-prompt config it does not read (the "declared-but-unread config is a maintenance trap" priority).

### 6. Two slices, a capability gradient

Both use cases are the *same* judge link; they differ only by which verdicts are enabled and how much envelope guards them.

| Aspect       | Slice 1 — deny-first reviewer (use case 1)                     | Slice 2 — allow-capable adjudicator (use case 2)                                                                  |
| ------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Verdicts     | `deny`, `defer`                                                | `+ allow`                                                                                                         |
| Risk         | strictly more restrictive — always safe                        | loosens privilege — needs full envelope                                                                           |
| Envelope     | fail-closed only (unreachable/uncertain → defer)               | + hard exclusions, audit `origin:"authorizer:model"`, non-persistence, off by default, bounded-delegation ruleset |
| Failure mode | a wrong deny — recoverable (agent self-corrects on the reason) | decomposition infidelity — mis-split obfuscation (`bash -c "safe; evil"`) allowed on the safe piece alone         |

The "a tool-augmented model can never grant more than the engine grants for the pieces it identifies" safety property holds *only if decomposition is faithful*.
Obfuscation is the residual risk, and it is exactly why slice 2 is gated behind the whole envelope while slice 1 needs almost none.
The gradient is the argument for shipping deny-first.

### 7. One chain per node

An ask is adjudicated by exactly one node's chain: the node whose terminal decides it.

A node with UI (`LocalUserAuthorizer`) and a headless node with no reachable authority (`DenyingAuthorizer`) both decide locally, so both run their chain.
Since [#909] a node with UI is the first of those only while it names no parent session that is draining its inbox; when it does name one, it relays and the clause below governs it instead.
The rule is unchanged — what narrowed is which nodes are terminal-local.
A subagent node whose terminal is `ParentAuthorizer` does not decide — it relays the ask to a serving node, which resolves it against its own recorded authority and escalates it through its own chain over the same child-fixed facts ([#635]).
So a relaying node resolves no links, and its terminal's forwarding *is* how the ask reaches a chain.

This is a consequence of §2's terminal-for-its-node framing, made explicit because the observable behavior contradicted it: a child's chain resolution found no links (a child cannot host one — [#699]) and reported each configured name as a fail-safe skip, which reads as the configured judge never running.
It runs; it runs one hop up.

The rule is not merely descriptive of the current implementation.
Running links on a relaying node as well would adjudicate one ask twice — the same link, over the same facts, once in the child and again on the serving node — with a second model call and a second latency, and would let a link decide an ask the serving node's policy owns.

Two review-log records make the placement observable, since a deferring link decides nothing and otherwise leaves no evidence it was consulted:

- `authorizer_chain_resolved` — an adjudicating node's resolved link names, recorded before any of them runs.
- `authorizer_chain_delegated` — a relaying node's configured names, recorded as deliberately not run.

This leaves `authorizer_chain_unregistered_link` meaning what it says: a name the adjudicating node could not resolve, which is a real misconfiguration.

The rule also settles the shape of [#699]'s fix: a sibling extension should skip registering a link in a registered child rather than registering one that would never be consulted.

### Relationship to `evaluate()` and rule-driven promotion

The judge sits on the ask-*consuming* side of `evaluate()`, distinct from the ask-*producing* side (rule-driven promotion, [#509]).
Rule-driven promotion produces the fail-safe false-positive ask (`git grep id_rsa` prompts); the judge dismisses it on the consuming side without hard-coding per-command file-argument tables.
The two compose cleanly: a promoted token emits the same structured descriptor a prefixed path does, so a link needs no promotion-specific knowledge.

## Consequences

- [#472] carries a linked, settled ADR and becomes schedulable in a future phase on its own merits.
- The `Authorizer` role generalizes from a single per-session selection into a composed chain; `selectAuthorizer` becomes the terminal-selection step of `composeAuthorizerChain`, and the interface gains a `defer` verdict and an injected `PermissionQuery`.
- The chain is the **one** live-authority extensibility seam.
  A model judge is a non-terminal link; a future terminal-replacement backend (a chat-bot or remote reviewer *as* the authority) is the same seam's terminal role.
  This subsumes the architecture doc's separately-sketched "pluggable escalation seam" — registering a link *is* the seam, not a mechanism beside it.
- The review log gains a fourth grant provenance (`authorizer:model`, slice 2) alongside human, policy, and yolo.
- **Dogfooding is slice 1's acceptance criterion.**
  A first-party package in this monorepo (`packages/pi-permission-model-judge`) implements the deny-first typo-path reviewer against the real seam.
  This is a design safeguard, not a demo: the [#267] history guard warns that an inbound registration surface nobody consumes goes vacant; a first-party consumer registering `"model-judge"` on day one makes `registerAuthorizer` born consumed, and its own config file exercises the config split end to end.
  The concrete issue is filed by the next `/plan-improvements` pass when the phase is scoped.
- No code, config, schema, or default changes in this documentation step.

### Rejected alternatives

- **Ask-only, allow-or-escalate verdict range** (the reverted ADR).
  Rejected: use case 1 is deny-first, and an `Authorizer` already denies, so confining a model link to allow-or-escalate cannot express the typo-path reviewer.
- **A single terminal instead of a chain.**
  Rejected: the judge fundamentally decides *some* asks and hands the rest to the real authority — it needs a successor.
  A chain with a non-deferring terminal models exactly this, and the operator's mental model was a chain, not a decorated singleton.
- **The judge imports `PermissionsService` via `Symbol.for()`.**
  Rejected: a Law-of-Demeter reach-through to a global, and it forces the external extension to import two surfaces.
  Injecting a narrow `PermissionQuery` gives one import and an ISP-clean contract.
- **Opt-out activation** (a registered link joins the chain automatically; config can only disable it).
  Rejected: it lets a loaded extension gain decision authority unless explicitly disabled, and lets load order influence security-relevant chain order.
  Opt-in (config names the chain) is least-privilege by construction.
- **A process-global `AuthorizerRegistry`, so a child resolves its parent's links** ([#727]).
  Rejected: it converts every deferring ask into two link runs, and lets a link's verdict short-circuit before the serving node ever sees the request — a privilege change dressed as a plumbing fix.
  The forwarding round trip is not the cost being avoided; the serving node resolves the request against its own ruleset regardless.
- **The model applies the ruleset itself, or emits a static intent.**
  Rejected: the former couples the model to rule semantics; the latter weakens determinism.
  Tool-augmented decomposition keeps the model decoupled from rule semantics (a rule edit is honored automatically) and confines its non-determinism to decomposition.

### Accepted limitations

- **Open implementation parameters.**
  Model provider, prompt, confidence threshold, and timeout are deliberately left to [#472] and the downstream package — they are tuning and mechanism, not architecture.
- **[#472]'s decomposition is deferred.**
  Whether [#472] splits into staged issues (chain infrastructure; deny-first slice; allow-capable slice; the dogfood package) is [#472]'s own planning decision, sequenced by the next `/plan-improvements` pass.
- **Terminal-replacement registration is deferred.**
  Registering a backend *as* the terminal authority is the chain seam's other role, built when a real non-subagent backend needs it — not now.
- **The pre-`evaluate()` classifier stays out of scope.**
  A model that *classifies* access intent before `evaluate()` feeds *recorded* authority and weakens the "same `(toolName, input)` yields the same ruling" property more subtly than this live-authority judge; it warrants its own decision record (see the architecture doc's "Beyond the target: a non-deterministic access-intent classifier").

[#267]: https://github.com/gotgenes/pi-packages/issues/267
[#472]: https://github.com/gotgenes/pi-packages/issues/472
[#509]: https://github.com/gotgenes/pi-packages/issues/509
[#581]: https://github.com/gotgenes/pi-packages/issues/581
[#635]: https://github.com/gotgenes/pi-packages/issues/635
[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#727]: https://github.com/gotgenes/pi-packages/issues/727
[#909]: https://github.com/gotgenes/pi-packages/issues/909
