---
issue: 844
issue_title: "pi-permission-system: a forwarded denial decided by the parent's rule or a gate error is rendered to the child's agent as the user's denial"
---

# Tell the child's agent what actually refused its forwarded call

## Release Recommendation

**Release:** ship independently

Phase 14 Step 15 carries `Release: independent` in `docs/architecture/architecture.md`, and it is a member of no release batch.
The three behavior steps below are `fix:` commits, so the merge cuts a release on its own.

## Problem Statement

A subagent's ask is forwarded to the parent.
The parent's `ForwardedRequestServer.resolveDecision` answers it from the parent's own ruleset with `{ approved: false, state: "denied", decidedBy: { kind: "rule", surface, pattern, origin } }`, or — when the parent-side escalation throws — with `{ kind: "gate_error", reason }`.
`ParentAuthorizer.relayDecision` nests either under `{ kind: "forwarded", … }`, and `renderRefusal` unwraps it and drops both into the fall-through group that renders `renderUserDenial`:

```text
[pi-permission-system] The user denied this 'bash' call (rule 'git push*').
```

Two things are wrong with that sentence.
No human at the parent ever saw the ask, and `(rule 'git push*')` is the **child's** own ask rule — the rule that made the call an `ask` — not the parent's deny rule.

Since [#772] the bus event for the same request already reports `policy_deny`, because `resolutionFor` unwraps the hop.
So the two records this package writes about one request disagree, in exactly the cases [#772] set out to reconcile.
[#772] deferred these two arms deliberately: naming the serving node's rule needs facts that live only on the response's `decidedBy`, and whether those may reach the requesting agent is an ADR 0011 §6 disclosure question rather than a formatting choice.

## Goals

- A forwarded refusal a rule in the serving session decided reads as a policy denial that names **that** rule's pattern, not as the user's denial naming the child's ask rule.
- A forwarded refusal whose serving-side escalation threw reads as an authority failure that blocked fail-closed, carrying the stamped error text.
- Both sentences say the decision was made in the session serving the request, derived from the forwarding frame rather than asserted.
- The operator's deny-with-reason text reaches the requesting agent, so the new policy-denial render has a producer for its reason clause instead of a permanently empty one.
- The disclosure decision is written into ADR 0011 as a numbered section, not left in a plan.
- **This change is not breaking.**
  It changes agent-facing prose and adds an optional field's producer on an existing wire field.
  No exported type, config key, default, resolution value, or wire shape changes; `PermissionDecisionResolution` and the `permissions:decision` payload are untouched.
  Ships as `fix(pi-permission-system):`.

## Non-Goals

- **The `permissions:decision` broadcast.**
  It already reports `policy_deny` / `gate_error` for these decisions ([#772]), and it deliberately carries no decider and no pattern — the bus is the narrowest renderer (ADR 0011 §6).
  Nothing on that channel changes.
- **Naming the responder session id in the agent-facing text.**
  [#772] dropped `responderSessionId` in `effectiveDecider` on purpose: the hop answers *where*, and the render answers *what*.
  The new sentences say "the session serving this request" and never an id.
- **Naming the serving rule's `origin` scope.**
  No renderer names `origin` today, and adding it in this one arm would newly disclose which of the operator's config scopes the parent runs under.
  Settled with the operator at the planning gate (option B, not C).
- **Moving `session_approval`, `infrastructure_read`, `yolo`, or a `forwarded` hop with a `null` inner decision off `renderUserDenial`.**
  The first three never refuse, and the last is a version-skewed parent that named no decider — "the user denied it" is the fail-soft answer there, unchanged.
- **The local fail-closed boundary's message.**
  `createFailClosedToolCall` (`src/handlers/tool-call-boundary.ts`) renders its own `formatGateErrorReason` string and never routes through `renderRefusal`; it is out of scope.
- **`src/authority/decision-source.ts`.**
  `effectiveDecider` already returns exactly what the dispatch needs, and the outer frame is already at the call site.
  No new `DecisionSource` variant, no guard change.

## Background

### The frame is already at the call site

The whole chain from the serving node's answer to the agent's sentence was traced; no new information has to be plumbed anywhere.

| Step | Site                                                                         | What it does to `decidedBy`                                                                                       |
| ---- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1    | `ForwardedRequestServer.resolveDecision` (`forwarded-request-server.ts:446`) | stamps `{ kind: "rule", surface, pattern, origin }`, or `{ kind: "gate_error", reason }` in `escalateAsk`'s catch |
| 2    | `recordForwardedDecision`                                                    | writes it onto `ForwardedPermissionResponse.decidedBy`                                                            |
| 3    | `readForwardedPermissionResponse` (`forwarding-io.ts:437`)                   | reads it back through `asDecisionSource`                                                                          |
| 4    | `ParentAuthorizer.relayDecision` (`approval-escalator.ts:139`)               | wraps it as `{ kind: "forwarded", responderSessionId, decision }`                                                 |
| 5    | `authorizer-selection.ts` / `delegation-envelope.ts`                         | nothing — neither writes `decidedBy` on the terminal path                                                         |
| 6    | `applyPermissionGate` (`permission-gate.ts:100`)                             | hands the whole decision to `messages.refusedReason(decision)`                                                    |
| 7    | `runner.ts:194`                                                              | calls `renderRefusal(payload, decision.decidedBy, decision.denialReason ?? null)`                                 |

So `renderRefusal`'s second argument **is** the outer `forwarded` frame.
It is `effectiveDecider(decidedBy)` on the function's first line that discards it.

The parent's rule facts therefore already cross the hop, and they are already persisted in the **child's own review log** — `PermissionPrompter` writes `decidedBy` on the `permission_request.denied` entry (`permission-prompter.ts:135`).
The undecided part was never whether they cross, only whether they reach the agent's context.

### The reason clause has no producer today

`resolveDecision`'s recorded-authority deny arm returns `{ approved: false, state: "denied", decidedBy }` and never copies `check.reason` — the operator's text from a `{"action": "deny", "reason": "…"}` rule.
Locally that same text is rendered: `runner.ts:193` passes `check.reason ?? null` into `renderPolicyDenial`.
`ForwardedPermissionResponse.denialReason` already exists on the wire and `readForwardedPermissionResponse` already copies it, so carrying it is a producer-side gap only, with no reader or schema change.

### Existing renderer shape

`src/presentation/agent-renderer.ts` has one dispatch (`renderRefusal`) over four renderers.
All four call the module-private `identification(payload, budget, callWord)`, whose last joined clause is an unconditional `ruleClause(payload)` built from `payload.request.matchedPattern` and `payload.request.commandContext`.
`renderUnavailableDenial` deliberately omits `boundaryClause`/`provenanceClause` — pinned by "omits the escaped boundary, which no retry shape would change".

### Constraints from AGENTS.md and the package skill that bite here

- ADR 0011 §7: the agent renderer identifies the call and never reproduces it.
  Neither new render may touch `payload.request.value`; `flaggedClause` already skips `bash`.
- `pnpm fallow dead-code` errors on `unused-exports`, so a new exported renderer cannot land a commit ahead of the dispatch that calls it.
- Module-tree entries in `docs/architecture/architecture.md` describe current behavior; an issue ref belongs there only when it encodes an active constraint.

### Latency of the defect

[#772] measured 12,281 review-log lines: of 68 terminal `forwarded` decisions, 57 were rule-**approved** and 11 human-decided.
Zero were rule-denied and zero were `gate_error`.
So neither arm has fired in practice; it becomes reachable the moment a parent's config denies something a subagent asks for.
This is a correctness fix on a latent path, not a regression report.

## Design Overview

### 1. What the two arms render

Worked example, the scenario the issue describes.
A subagent runs `git push --force` under its own `bash: {"git push*": "ask"}`; the parent denies under a project-scope `bash: {"git push --force*": {"action": "deny", "reason": "force pushes are blocked"}}`.

|       | Rendered to the child's agent                                                                                                                                    |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| today | `[pi-permission-system] The user denied this 'bash' call (rule 'git push*').`                                                                                    |
| after | `[pi-permission-system] A policy rule in the session serving this request denied this 'bash' call (rule 'git push --force*'). Reason: force pushes are blocked.` |

The serving rule's pattern **replaces** the payload's own `matchedPattern` in the rule clause, matching `renderPolicyDenial`'s convention that the rendered rule is the one that decided.
The payload's `commandContext` is kept: it is a fact about the call (`inside a command substitution`), not about the rule, and it is what makes the flagged unit intelligible.

The `gate_error` sentence, for a serving-side escalation that threw:

```text
[pi-permission-system] The permission authority in the session serving this request failed to answer this 'bash' call (rule 'rm *'), so it was blocked (fail-closed). Reason: Cannot read properties of undefined.
```

It keeps the payload's own rule clause — the ask's rule is the only rule involved, since nothing at the serving node matched — and omits `boundaryClause`/`provenanceClause` for the reason `renderUnavailableDenial` does: no retry shape would change them.
Its reason comes from `decidedBy.reason`, not `denialReason`, because that is the field the producer writes and the field the review log records; a divergent `denialReason` would be a second story about one failure.

### 2. The locality fact

`renderRefusal` keeps the outer frame alongside the unwrapped decider:

```typescript
const decider = effectiveDecider(decidedBy);
const decidedElsewhere = decidedBy.kind === "forwarded";
```

A boolean is the right width: the responder session id is deliberately undisclosed, so the only thing the sentence can say is *that* another session decided.
When it is `false` the clause is omitted (`A policy rule denied this 'bash' call (rule '…')`), which keeps the render honest by construction rather than by an invariant no type enforces.
Both arms are forwarding-only today — a local policy deny takes the `denyReason` path and the local fail-closed boundary has its own message — but the exhaustive switch must handle a bare `rule` / `gate_error` anyway, and this is what it should say when it does.

### 3. The two new renderers

```typescript
/** The rule that refused an escalated ask, and where it sat. */
export interface EscalatedRule {
  /** The pattern the deciding node's rule matched; `null` when none was recorded. */
  readonly pattern: string | null;
  /** Whether that node was reached through a forwarding hop. */
  readonly decidedElsewhere: boolean;
}

export function renderEscalatedPolicyDenial(
  payload: PromptPayload,
  rule: EscalatedRule,
  denialReason: string | null,
  budget?: AgentRenderBudget,
): string;

/** The escalation failure that blocked an ask fail-closed, and where it happened. */
export interface GateFailure {
  /** The error text stamped on `decidedBy`, which carries the detail on this path. */
  readonly reason: string;
  readonly decidedElsewhere: boolean;
}

export function renderGateErrorDenial(
  payload: PromptPayload,
  failure: GateFailure,
  budget?: AgentRenderBudget,
): string;
```

Each takes the payload plus the one fact bundle its decider contributes, mirroring `renderAuthorizerDenial(payload, linkName, denialReason, budget)`.
Bundling `decidedElsewhere` into the fact object rather than adding a positional boolean keeps the arity at three-plus-default and gives the flag a documented name at the type.
Neither renderer sees a `DecisionSource`: `renderRefusal` projects, so the presentation module keeps reading only what it renders (ISP), exactly as `renderAuthorizerDenial` takes a `linkName` rather than the `authorizer` variant.

The dispatch, at the call site:

```typescript
case "rule":
  return renderEscalatedPolicyDenial(
    payload,
    { pattern: decider.pattern, decidedElsewhere },
    denialReason,
    budget,
  );
case "gate_error":
  return renderGateErrorDenial(
    payload,
    { reason: decider.reason, decidedElsewhere },
    budget,
  );
```

A shared private `servingClause(decidedElsewhere)` returns `" in the session serving this request"` or `""`, so the two sentences cannot drift about how they name the hop.

### 4. Parameterizing the rule clause (preparatory)

The Tidy-First assessor found one blocking friction and it is real: `identification()` appends `ruleClause(payload)` unconditionally, so the new policy arm cannot get "identification with a *different* rule" without duplicating `identification`'s body.

Two private signatures change, with byte-identical output:

```typescript
function ruleClause(
  pattern: string | null,
  commandContext: BashCommandContext | null,
): string;

function identification(
  payload: PromptPayload,
  budget: AgentRenderBudget,
  callWord: string,
  ruleText: string,
): string;
```

The four existing renderers pass `ruleClause(payload.request.matchedPattern, payload.request.commandContext)`; the new policy arm passes `ruleClause(rule.pattern, payload.request.commandContext)`.
Both helpers are file-private — `grep` finds no reader of either name outside `agent-renderer.ts` — so the refactor is fully contained and needs no test edits.

This adopts the assessor's recommendation with one correction to it.
The assessor rejected generalizing `ruleClause` on the grounds that the `rule` decider carries no `commandContext`, so the arm's clause would be a one-line literal.
That reasoning holds for the *pattern*, which does come from the decider, but not for the context, which comes from the **payload** either way — so the generalization is the shared shape, not an invented discriminator.

### 5. Carrying the deny reason

`resolveDecision`'s recorded-authority deny arm reuses the existing factory instead of hand-building its literal:

```typescript
return approved
  ? { approved: true, state: "approved", decidedBy }
  : { ...createDeniedPermissionDecision(check.reason), decidedBy };
```

`createDeniedPermissionDecision` (`src/authority/permission-dialog.ts:68`) returns an `UnattributedDecision` — precisely "a denial before its decider is known" — normalizing the reason (trim, drop empty) and selecting `denied_with_reason` when one survives, `denied` when none does.
That state is safe here: `grep -rn 'denied_with_reason' src` finds only its own declaration, the factory, and the state guard, so nothing branches on it, and `resolutionFor` reads `decidedBy` rather than `state`, so the resolution stays `policy_deny`.

No wire or reader change: `ForwardedPermissionResponse.denialReason` already exists, `recordForwardedDecision` already writes `decision.denialReason`, and `readForwardedPermissionResponse` already copies it.

### 6. The ADR amendment

The roadmap names the disclosure question as the step's real work, so it is recorded where a future proposal will be judged against it, not only in this plan.
`docs/decisions/0011-prompt-presentation-contract.md` gains a numbered section stating what a forwarded refusal may tell the requesting agent:

- **Permitted:** the deciding node's matched rule pattern, its own deny-with-reason text, its escalation error text, and the fact that the decision was made in the session serving the request.
  The first three are operator configuration or this package's own error text — the same class §7 already permits for a local denial — and they already cross the hop into the requesting session's review log.
- **Withheld:** the responder session id, and the rule's `origin` scope.
  Both are facts about the serving node rather than about the refused call, and no renderer discloses `origin` today.
- **Unchanged:** the `permissions:decision` broadcast stays the narrowest renderer under §6; none of the above reaches it.

## Module-Level Changes

| File                                                  | Change                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/presentation/agent-renderer.ts`                  | private `ruleClause` takes `(pattern, commandContext)`; private `identification` takes the rule text as a 4th parameter; adds exported `renderEscalatedPolicyDenial` + `EscalatedRule` and `renderGateErrorDenial` + `GateFailure`; adds private `servingClause`; `renderRefusal` keeps `decidedElsewhere` and moves `rule` / `gate_error` out of the fall-through group and drops the `#844` comment |
| `src/authority/forwarded-request-server.ts`           | `resolveDecision`'s deny arm spreads `createDeniedPermissionDecision(check.reason)`; adds the import                                                                                                                                                                                                                                                                                                  |
| `test/presentation/agent-renderer.test.ts`            | new `describe("renderEscalatedPolicyDenial")` and `describe("renderGateErrorDenial")` blocks; the `renderRefusal` block's "falls back to the user attribution for a decider it cannot render honestly" test (lines 490–501) is replaced by the two real dispatch cases                                                                                                                                |
| `test/handlers/gates/runner.test.ts`                  | block-path assertions that a forwarded rule-denied gate names the serving rule and not the user, and that a forwarded `gate_error` names the authority failure                                                                                                                                                                                                                                        |
| `test/authority/forwarded-request-server.test.ts`     | the auto-deny test (line 190) asserts the written response carries the rule's reason; a sibling asserts a reasonless rule still writes `state: "denied"` with no `denialReason`                                                                                                                                                                                                                       |
| `docs/decisions/0011-prompt-presentation-contract.md` | new numbered section recording the forwarded-refusal disclosure boundary                                                                                                                                                                                                                                                                                                                              |
| `docs/architecture/architecture.md`                   | `agent-renderer.ts` module-tree entry (line 915) names the two new renderers and the locality fact; `forwarded-request-server.ts` entry (line 949) notes the deny arm carries the rule's reason; Step 15 marked `✅` on its heading and its Mermaid node with a `Landed:` note, and its `Outcome:` metric corrected                                                                                   |
| `.pi/skills/package-pi-permission-system/SKILL.md`    | the `renderRefusal` sentence (line ~103) is stale once the dispatch also reads the outer frame                                                                                                                                                                                                                                                                                                        |

Greps run to build this list: `renderRefusal`, `renderUserDenial`, `renderPolicyDenial`, `renderUnavailableDenial`, `renderAuthorizerDenial`, `identification`, `ruleClause`, `denialReason`, `denied_with_reason`, `gate_error`, and `"The user denied"` across `src/`, `test/`, `docs/`, `README.md`, and the whole `.pi/skills/` tree.
`README.md` names no renderer and quotes no denial text.
`docs/cross-extension-api.md` documents the bus event's resolution values, none of which change.
`docs/subagent-integration.md` documents the announcement contract and does not enumerate the response file's fields, so it is unaffected by the reason carry.
`docs/decisions/` is not in the package's `files` allowlist, so the ADR amendment ships to the repo only.

## Test Impact Analysis

**Newly possible.**
`renderEscalatedPolicyDenial` and `renderGateErrorDenial` are directly unit-testable across the axes that matter — pattern present vs. `null`, reason present vs. absent, and `decidedElsewhere` true vs. false — which was impossible while both deciders fell through to `renderUserDenial` and the render had no way to receive a pattern that was not the payload's.
The reason carry gets its own assertion at the producer, where the file the child polls for is the observable.

**Newly redundant.**
`renderRefusal`'s "falls back to the user attribution for a decider it cannot render honestly" (lines 490–501) pins today's deliberately-wrong answer and its comment says so ("Left as today's text pending #844").
Replacing it is the behavior change, not a preparation for it.
Nothing else is superseded: the authorizer, user, unavailable, and forwarded-authorizer dispatch cases all keep testing arms this change does not touch.

**Must stay.**
`agent-renderer.test.ts`'s whole existing suite is the safety net for the preparatory refactor — every assertion must produce byte-identical output across step 1.
`runner.test.ts`'s "emits policy_allow when a rule in the serving session answered the forwarded ask" pins the [#772] allow-side mapping, which is untouched.
`forwarded-request-server.test.ts`'s "broadcasts nothing when recorded authority resolves the request" pins the [#610] silence invariant that step 3 must not disturb while editing the same arm.

## Invariants at risk

| Invariant                                                                                                                                    | Pinned by                                                                                                                                          | Risk here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#772]: which refusal sentence the agent gets is dispatched once, on the decider, exhaustively and with no `default`                         | `agent-renderer.test.ts` `describe("renderRefusal")`; `runner.test.ts` "names the authorizer link that refused, not the user"                      | Steps 4 and 5 edit that switch. The authorizer, user, and unavailable arms must keep their exact sentences, and no `default` may be introduced to absorb the two new arms.                                                                                                                                                                                                                                                                                                                                                                                                               |
| [#719]: an absent-authority denial is not reported as a user denial                                                                          | `permission-gate.test.ts` "returns block with unavailable reason when the decision is confirmation-unavailable"; `runner.test.ts` at ~540 and ~557 | The `unavailable` arm and `renderUnavailableDenial`'s signature are untouched, but the `identification` refactor in step 1 passes through it. Its omission of `boundaryClause` is pinned by "omits the escaped boundary, which no retry shape would change".                                                                                                                                                                                                                                                                                                                             |
| [#610]: a serving node broadcasts one terminal decision per escalated ask, and a recorded-authority resolution stays silent on both channels | `forwarded-request-server.test.ts` "broadcasts nothing when recorded authority resolves the request" (line 1251)                                   | Step 3 edits the recorded-authority arm — the one that must stay silent. The test runs unchanged and pins it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ADR 0011 §7: the renderer identifies the call and never reproduces it                                                                        | `agent-renderer.test.ts` "never echoes the command" tests on each renderer                                                                         | Both new renderers get their own "never echoes the command" case. Neither reads `payload.request.value`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [#746]: one payload, one renderer per consumer; a render change is a renderer change                                                         | the whole `agent-renderer.test.ts` suite                                                                                                           | Step 1 changes two private signatures with byte-identical output; the unchanged suite is the measurement, not the argument.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Phase 14 Step 15 `Outcome:` metric                                                                                                           | `grep -c 'case "rule"' packages/pi-permission-system/src/presentation/agent-renderer.ts`                                                           | **Measured baseline today: 1, not the 0 the roadmap predicts** — [#772]'s fall-through group already lists `case "rule":`, so the metric reads 1 before the change and ≥ 1 after and cannot discriminate. Step 6 replaces it with `grep -c 'renderEscalatedPolicyDenial' packages/pi-permission-system/src/presentation/agent-renderer.ts`, measured **0** today and predicted **2** after (the declaration plus the dispatch call site). The `### Health metrics` table has no Step 15 row — it was fixed at the phase-open baseline before Step 15 existed — so nothing there changes. |

## TDD Order

1. **`refactor(pi-permission-system): parameterize the agent renderer's rule clause`** Change private `ruleClause(payload)` to `ruleClause(pattern, commandContext)` and private `identification(payload, budget, callWord)` to take the rule text as a fourth parameter; update the four existing renderers to pass `ruleClause(payload.request.matchedPattern, payload.request.commandContext)`.
   Prepares the friction the Tidy-First assessor found: without it, step 4's arm can only get "identification with a different rule" by duplicating `identification`'s body.
   No test edits — output is byte-identical, and the unchanged suite is the verification.
   No killing mutation; this is a refactor step.
   Verify: `pnpm --filter @gotgenes/pi-permission-system run test` green with no test-file diff; `pnpm run check`.

2. **`docs(pi-permission-system): record what a forwarded refusal may disclose (ADR 0011)`** Add the numbered section to `docs/decisions/0011-prompt-presentation-contract.md` described in Design Overview §6 — permitted, withheld, and unchanged — citing this issue.
   Lands before the code so the disclosure boundary is written down before it is implemented, and so steps 4 and 5 are reviewable against it.
   Verify: `pnpm exec rumdl check packages/pi-permission-system/docs/decisions/0011-prompt-presentation-contract.md`.

3. **`fix(pi-permission-system): carry a serving session's deny reason to the requesting agent`** Red: in `test/authority/forwarded-request-server.test.ts`, extend the auto-deny test (line 190) so the matched rule carries `{"action": "deny", "reason": "force pushes are blocked"}` and assert the written response file carries that `denialReason` with `state: "denied_with_reason"`; add a sibling asserting a reasonless deny still writes `state: "denied"` and no `denialReason`.
   Green: `resolveDecision`'s deny arm spreads `createDeniedPermissionDecision(check.reason)` beside `decidedBy`.
   Killing mutation: make the deny arm return `{ approved: false, state: "denied", decidedBy }` unconditionally → the reason-carrying test goes red and the reasonless one stays green.
   Verify: `pnpm run check`; the package suite; confirm "broadcasts nothing when recorded authority resolves the request" is still green.

4. **`fix(pi-permission-system): name the rule that refused a forwarded call instead of blaming the user`** Red: new `describe("renderEscalatedPolicyDenial")` in `agent-renderer.test.ts` covering a forwarded deny with a pattern, with and without a reason, a `null` pattern, a local (`decidedElsewhere: false`) deny, a bash payload's nested command context surviving the pattern substitution, and "never echoes the command"; a `renderRefusal` dispatch case replacing "falls back to the user attribution…"; a `runner.test.ts` block-path assertion that a forwarded rule-denied gate's reason names the serving rule, does **not** contain `The user denied`, and does not name the child's own ask pattern.
   Green: `EscalatedRule`, `renderEscalatedPolicyDenial`, `servingClause`, the `decidedElsewhere` capture, and the `rule` arm leaving the fall-through group.
   The renderer and its dispatch land together because `fallow dead-code` errors on an export with no consumer.
   Killing mutations, one per equivalence class:
   - Make the `rule` arm fall through to `renderUserDenial` → the dispatch case and the runner block-path assertion go red; the authorizer and unavailable cases stay green.
   - Make `renderEscalatedPolicyDenial` build its clause from `payload.request.matchedPattern` instead of `rule.pattern` → the pattern-substitution cases go red alone (this is the defect's core, and the one a passing-under-both assertion would hide, so the runner assertion checks the child's pattern is **absent**, not only that the serving one is present).
   - Make `servingClause` return `""` unconditionally → the forwarded cases go red and the `decidedElsewhere: false` case stays green.
   Verify: `pnpm run check`, `pnpm run lint`, the package suite.

5. **`fix(pi-permission-system): tell the agent when the serving session's permission authority failed to answer`** Red: new `describe("renderGateErrorDenial")` covering forwarded and local wording, the reason clause fed from `decidedBy.reason`, the omitted boundary clause, and "never echoes the command"; a `renderRefusal` dispatch case; a `runner.test.ts` block-path assertion for a forwarded `gate_error` decision.
   Green: `GateFailure`, `renderGateErrorDenial`, and the `gate_error` arm leaving the fall-through group; delete the `#844` comment from the remaining fall-through group.
   Killing mutations:
   - Make the `gate_error` arm fall through to `renderUserDenial` → the new dispatch case and the runner assertion go red; step 4's rule cases stay green.
   - Make `renderGateErrorDenial` read its reason from the `denialReason` argument instead of `failure.reason` → the reason-clause case goes red alone, since `denialReason` is absent on this path.
   Verify: `pnpm run check`, `pnpm run lint`, the package suite, `pnpm fallow dead-code`.

6. **`docs(pi-permission-system): record forwarded refusal attribution and mark Phase 14 Step 15 complete`** `docs/architecture/architecture.md`: the `agent-renderer.ts` and `forwarded-request-server.ts` module-tree entries; Step 15 `✅` on its heading and its Mermaid node; a `Landed:` note recording what the delivered design did differently from the `Target:` line — the disclosure question answered as "name the pattern, withhold the origin and the responder id", the locality derived from the forwarding frame rather than assumed, and the deny-reason carry the Target did not name; the corrected `Outcome:` metric.
   `.pi/skills/package-pi-permission-system/SKILL.md`: the `renderRefusal` sentence, which now also reads the outer frame.
   Verify: `pnpm exec rumdl check` on each edited file; `grep -c 'renderEscalatedPolicyDenial' packages/pi-permission-system/src/presentation/agent-renderer.ts` reads 2; confirm no doc still says the `rule` and `gate_error` arms are deferred.

## Risks and Mitigations

| Risk                                                                                                                       | Mitigation                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The preparatory refactor silently changes an existing render (a dropped or doubled space where the rule clause was joined) | `identification` keeps the `filter(clause => clause !== "").join(" ")` and receives the clause as an array element, so an empty rule text is filtered exactly as before. Step 1 lands with no test-file diff, so any drift is a red assertion rather than a reviewed one. |
| Substituting the serving pattern silently drops the payload's `commandContext`                                             | `ruleClause` is generalized rather than reimplemented, so the context comes from the payload on both paths; step 4 has an explicit bash-context case.                                                                                                                     |
| Naming the serving rule discloses parent configuration the operator did not intend to share                                | Settled at the planning gate and recorded as an ADR 0011 section in step 2. The facts already cross the hop into the child's review log; `origin` and the responder session id stay withheld.                                                                             |
| `state: "denied_with_reason"` on a rule deny reads as a human's "No, provide reason"                                       | Verified nothing branches on it: `grep -rn 'denied_with_reason' src` finds only the union member, the factory, and the state guard, and `resolutionFor` reads `decidedBy`, so the resolution stays `policy_deny`.                                                         |
| Neither arm has ever fired, so a wrong sentence would ship unobserved                                                      | Both arms are covered at three levels — renderer unit tests, `renderRefusal` dispatch, and a `runner.test.ts` block-path assertion through the real gate — and each step names the mutation that must turn them red.                                                      |
| The roadmap's Step 15 `Outcome:` grep reads 1 at baseline and cannot verify the step                                       | Measured at planning time and called out under Invariants at risk; step 6 replaces it with a metric that discriminates (0 → 2).                                                                                                                                           |

## Open Questions

None.
The disclosure question the roadmap flagged is settled at the planning gate and recorded as an ADR section in step 2; the reason-carry scope question is settled as an in-plan step rather than a follow-up.
No follow-up issues are filed by this plan.

[#610]: https://github.com/gotgenes/pi-packages/issues/610
[#719]: https://github.com/gotgenes/pi-packages/issues/719
[#746]: https://github.com/gotgenes/pi-packages/issues/746
[#772]: https://github.com/gotgenes/pi-packages/issues/772
