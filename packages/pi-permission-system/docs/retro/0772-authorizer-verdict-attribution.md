---
issue: 772
issue_title: "pi-permission-system: an authorizerChain link's verdict is broadcast as user_approved / user_denied"
---

# Retro: #772 — an authorizerChain link's verdict is broadcast as user_approved / user_denied

## Stage: Planning (2026-08-30T05:14:37Z)

### Session summary

Traced the mis-attribution to three sites that re-derive the decider from booleans instead of reading the `decidedBy` stamp #726 added: `deriveResolution` (`src/handlers/gates/helpers.ts`), `servedResolution` (`src/authority/forwarded-request-server.ts`), and the `confirmationUnavailable` branch in `applyPermissionGate` that picks the agent-facing denial text.
Measured the real blast radius against the local review log rather than arguing it, put the scope, semver, and naming to the operator, ran the Tidy-First assessor, filed the deferred half as issue #844 (adopted as Phase 14 Step 15), and wrote a five-step plan.

### Observations

- **The measurement reframed the issue.**
  The issue and the roadmap step both describe the `authorizerChain` case.
  Counting `decidedBy` kinds across the 12,281-line review log found 13 authorizer-decided entries — and 68 terminal `forwarded` entries, 57 of them decided by a **rule in the parent session** and broadcast as `user_approved`.
  The same defect one hop away is five times the population, and it was invisible from the issue body.
  Worth repeating on any attribution issue: count the log before scoping.
- **Scope, semver, and naming went to one gate.**
  Operator chose the widest scope (bus event, agent-facing text, and the forwarded unwrap), `feat!:` with a `BREAKING CHANGE:` footer, and the issue's own `authorizer_allowed` / `authorizer_denied` spelling (matching `AuthorizerVerdict`'s `allow | deny`, not `user_approved`'s consent verb).
- **Two arms were deliberately left out, and the reason is structural.**
  A forwarded denial the parent's *rule* decided cannot be rendered honestly from the child's payload: `PromptPayload.request.matchedPattern` is the pattern that raised the **child's** ask, not the parent's deny rule, and the parent's pattern and origin live only on the response's `decidedBy`.
  Whether those may reach the requesting agent is an ADR 0011 §6 disclosure decision, so it is issue #844 rather than a formatting tweak folded in here.
  The `gate_error` arm went with it: both are forwarding-only and have zero occurrences in the log.
- **The bus half unwraps `forwarded`; the text half does not.**
  That asymmetry is deliberate (the bus carries no pattern, so it raises no disclosure question) but it is the plan's least obvious decision, and #844's body records the disagreement it leaves behind.
- **`decision.autoApproved` turned out to be dead.**
  No code in `src/` ever sets it — yolo short-circuits ahead of escalation (#712/#526) — and it is not on the forwarded wire.
  Only test doubles produce it, which is why three tests assert a resolution no production path can reach.
  Its removal became step 3 rather than a follow-up, since this change is what makes it unreferenced.
- **A contradictory fixture was pinning nothing.**
  `test/permission-gate.test.ts`'s unavailable decision pairs `confirmationUnavailable: true` with `decidedBy: DECIDED_BY_HUMAN`.
  Harmless while dispatch reads the boolean; under the planned dispatch it would select the *user* render inside a test named for the unavailable one.
  The Tidy-First assessor found the same class in `runner.test.ts` independently, and the correction leads the plan as step 1.
- **`fallow dead-code` constrains the step order.**
  `unused-exports` is an `error`, so the assessor's recommended standalone fixture commit (`DECIDED_BY_AUTHORIZER`) and the new `resolutionFor`/`effectiveDecider` exports cannot land a commit ahead of their first consumer.
  Accepted the recommendation but merged it into the step that consumes it, and said so in the plan.
- **Design shape:** one exported `resolutionFor(decidedBy, outcome)` with a `never`-exhaustive switch replaces two parallel derivations, so a `DecisionSource` variant added later is a compile error at both sites instead of a silent `user_approved`.
  `forSession` stays an outcome bit the caller supplies — `{ kind: "user", via }` records no scope.

#### Deferred tidyings

- `test/handlers/gates/runner.test.ts` — 11 `escalate: vi.fn()` override sites mix the untyped and typed (`vi.fn<AskEscalator["escalate"]>()`) forms; the typed form would have caught the missing-`decidedBy` fixture gap at compile time.
  Converting only the 5 this change touches is inconsistent, and converting all 11 is unrelated friction.
  Assessor marked it Optional; left for a craftsmanship pass.
- `src/handlers/gates/runner.ts` — `runDescriptor`'s six numbered phases in one ~130-line method (the craftsmanship scout's Phase 14 finding, and the tidy-first prep Step 2 dropped).
  The assessor rejected splitting it here too: this change's edits are narrow and none is blocked by the single-method shape, so extraction would be churn with no friction driving it.
