---
status: accepted
date: 2026-07-09
---

# 0006 — Grant-scope selection on forwarded approvals

## Status

Accepted.

## Context

A subagent with no UI escalates an `ask` up the tree; the serving (parent/root) session drains its inbox and a human decides ([#557], ADR-0005).
When that human approves "for this session," the ruling could land only on the **requesting subagent**: the response rides back to the child, whose `GateRunner` records the pattern into the child's own `SessionRules`.
The human had no way to record the ruling at the **serving scope**, so a grant meant to cover the parent and all its subagents had to be re-approved per child ([resolved direction](../architecture/architecture.md#resolved-direction) 4, Phase 9 Step 4).

## Decision

Offer the human a scope when approving a forwarded request "for this session," and record a whole-session grant on the serving node.

1. **The child rides its suggestion along.**
   `GateRunner` already computes a `SessionApproval` (surface + one-or-more patterns) for the ask.
   It now flows on `PromptPermissionDetails.sessionApproval` (via `SessionApproval.toForwardedData()`) into the `ForwardedPermissionRequest.sessionApproval` field the child writes.
   The field is optional and read tolerantly, so an older child (no suggestion) simply offers no scope choice.

2. **A two-step dialog.**
   The base decision prompt is unchanged.
   Choosing "for this session" opens a second `select` — subagent-only (listed first, the least-privilege default) vs the whole session — but only for a forwarded ask that carries a suggestion.
   A cancelled scope select defaults to subagent-only.
   `LocalUserAuthorizer` builds the scope labels (`buildForwardedScopeLabels`) and is still the single `permissions:ui_prompt` emit site; the emit fires once before the first select, so the [#292] non-degraded broadcast is unaffected.

3. **Whole-session grants record on the serving node only.**
   The dialog returns a serving-node-internal `approved_for_serving_session` state.
   `ForwardedRequestServer.applyGrantScope` records the child's suggested pattern into the serving session's `SessionRules` — the same instance the resolver and gate runner read — then translates the response to a plain `approved`.
   The child records nothing; its next identical action re-forwards and resolves as recorded authority (the [#557] serve-time evaluation auto-approves it).
   A subagent-only grant (`approved_for_session`) passes through untouched — the child records, exactly as before.

The serving node is the single source of truth for a whole-session grant.
Because the serving `SessionRules` is shared, the grant governs the parent's own actions immediately and future forwarded resolutions for free.

### The `approved_for_serving_session` state

It is serving-node-internal: produced by the dialog, consumed by `ForwardedRequestServer`, and translated to `approved` before any response is written, so it never reaches disk or the child.
It is a member of `PermissionDecisionState` (and `isPermissionDecisionState`, for guard completeness); the on-disk `ForwardedPermissionResponse.state` stays within the four legacy values.

### Rejected alternatives

- **Record on both the serving node and the requesting child.**
  Rejected: two copies blur the scope, and the subagent-only vs whole-session distinction collapses to "does the parent also hold a copy."
  Serving-node-only keeps a single source of truth; the child re-forwards and auto-approves.
- **A `grantScope` marker on an `approved_for_session` decision.**
  Rejected: the server must translate the response to `approved` for the whole-session case anyway (so the child does not double-record), and a state that says "subagent" while a marker says "serving" is less honest than a distinct state.
- **Inline scope options in the base dialog (a five-option prompt).**
  Rejected in favor of the operator's two-step choice: the base prompt stays byte-identical for every local ask, and the scope question appears only when it applies.

## Consequences

- A human can grant a forwarded request for the whole serving session; the parent and its subagents then resolve it without a second prompt.
- The default (subagent-only, pre-selected) preserves today's behavior exactly; this ships as `feat:`, not a breaking change.
- The forwarded request and response formats gain one optional field each, read tolerantly — an upgrade needs no config edit and tolerates version skew.

### Amendment (2026-09-02, [#810]): the suggestion carries a surface per pattern, and skew now drops it

Decision 1 above describes the child's suggestion as "surface + one-or-more patterns", relayed via `SessionApproval.toForwardedData()` and rebuilt with `SessionApproval.multiple`.
That shape could not survive [#807], which proves a read/write direction per bash path token: an ask whose uncovered paths disagreed had to record them all on the bare family, granting both directions on every pattern.

`ForwardedSessionApproval` now carries `grants`, an array of `{ surface, pattern }`, and the serving node rebuilds with `SessionApproval.forGrants`.

The tolerant read is **not** preserved for the old shape, which reverses the third Consequence bullet above for this field.
The reason is that the wire file was the smaller of the two breaks: the type is structurally reachable from the published declaration bundle through `PromptPermissionDetails`, which is what a third-party `Authorizer` chain link receives, so replacing its fields is a compile-time break for a consumer whether or not two processes ever skew.
With tolerance no longer buying non-breaking status, the strictest shape was taken and this ships as `feat!:`.

Skew therefore drops the suggestion in **both** directions.
The degradation is bounded and was verified against the published tag rather than assumed: `sessionApproval` is not in `readForwardedPermissionRequest`'s required set at v29.3.0, so a skewed request is still accepted and still prompts.
What is lost is the second dialog step — the human sees the base decision prompt, and "for this session" records on the requesting subagent, which is the least-privilege default this ADR already chose.
A whole-session grant is never made wider by skew, only unavailable, so no upgrade ordering is required.

### Accepted limitations

- **Cross-cwd / cross-surface re-resolution is best-effort.**
  A recorded whole-session path grant matches a child's later forward only when cwd and surface align — the pre-existing single-surface/cross-cwd limitation from ADR-0005 (`docs/decisions/0005-serving-authorizer-provenance.md`), tracked in [#565].
  An imperfect match lands on `ask` → prompt, never a silent grant.
- **Three-way scope (root / parent / requesting subagent) is not shipped.**
  The tree is depth-2 today, so "parent" and "root" coincide and the dialog offers two scopes.
  The three-way split waits on multi-hop escalation — admitted-not-shipped, the same shape as the escalation chain.

[#292]: https://github.com/gotgenes/pi-packages/issues/292
[#807]: https://github.com/gotgenes/pi-packages/issues/807
[#810]: https://github.com/gotgenes/pi-packages/issues/810
[#557]: https://github.com/gotgenes/pi-packages/issues/557
[#565]: https://github.com/gotgenes/pi-packages/issues/565
