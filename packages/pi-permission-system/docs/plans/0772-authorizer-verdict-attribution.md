---
issue: 772
issue_title: "pi-permission-system: an authorizerChain link's verdict is broadcast as user_approved / user_denied"
---

# Attribute a permission decision to what actually decided it

## Release Recommendation

**Release:** ship independently

Phase 14 Step 5 carries `Release: independent` in `docs/architecture/architecture.md`, and it is a member of no release batch.
The step's own bump note ("possibly `feat!:`") is settled below as breaking, so this ships as a major on its own.

## Problem Statement

The `permissions:decision` broadcast reports `resolution: "user_approved"` / `"user_denied"` for asks no human ever saw.

`deriveResolution` (`src/handlers/gates/helpers.ts`) maps an `ask` gate resolved to `allow` onto `user_approved` unless the decision carried a session approval or the yolo flag, and to `user_denied` unless it carried `confirmationUnavailable`.
The `authorizerChain` runs inside `AskEscalator.escalate`, so `GateRunner.runDescriptor` never learns that a link answered — it captures only `autoApproved` and `confirmationUnavailable` off the returned decision, and `decidedBy` is not among them.

Since [#726] the review log records the truth: a chain-link decision is stamped `{ kind: "authorizer", name, verdict, reason }` at the site that decided it.
The bus event and the agent-facing denial text are the two records that re-guess it, and they guess "the user".

The issue's own comment shows the live instance: the dogfooded `model-judge` link auto-denied a mistyped path, and the agent was told `[pi-permission-system] The user denied this 'external_directory' call …`, while the review log for the same `requestId` recorded `decidedBy: { kind: "authorizer", name: "model-judge" }`.

Measured against a 12,281-line local review log — every terminal entry written since [#726] shipped:

| `decidedBy.kind`           | Entries                       | Reported today as                                 |
| -------------------------- | ----------------------------- | ------------------------------------------------- |
| `authorizer`               | 13 (all `model-judge` denies) | `user_denied` + "The user denied this …"          |
| `forwarded` → inner `rule` | 57 terminal (all allows)      | `user_approved`                                   |
| `forwarded` → inner `user` | 11 terminal                   | `user_approved` / `user_denied` (correct by luck) |

So the same defect one hop away is the larger population: 57 decisions a **rule in the parent session** made are broadcast as the operator's approval.

## Goals

- `permissions:decision` names what actually decided, on both the local gate path and the serving node's path, by reading the `decidedBy` stamp instead of re-deriving from booleans.
- `PermissionDecisionResolution` gains `authorizer_allowed` and `authorizer_denied`.
- A `forwarded` decision is attributed to the decider **inside** the responding session, so a parent rule reads `policy_allow` / `policy_deny` and a parent human still reads `user_approved` / `user_denied`.
- The agent-facing denial text names the authorizer link that refused the call instead of the user.
- **This change is breaking.**
  The resolution reported for an existing decision changes (not only new values added), and `PermissionDecisionResolution` is public — it is inlined into `dist/public.d.ts` through `PermissionDecisionEvent`, so the widened union breaks a consumer's exhaustive `switch` at compile time.
  Ships as `feat(pi-permission-system)!:` with a `BREAKING CHANGE:` footer.
- A new `DecisionSource` variant added later becomes a compile error at both mapping sites rather than a silent `user_approved`.

## Non-Goals

- **The agent-facing text for a forwarded denial the parent's rule or a gate error decided** stays on `renderUserDenial`.
  Rendering the rule case honestly needs the parent's pattern and origin, which live only on the response's `decidedBy` — the child's `PromptPayload.request.matchedPattern` is the pattern that raised the *child's* ask — so whether those facts may reach the requesting agent is an ADR 0011 §6 disclosure decision, not a formatting choice.
  Filed as [#844] and adopted as Phase 14 Step 15.
- **Converting the bypass gates to build their resolution through the new mapper.**
  `describeExternalDirectoryGate` and the two bash session-approval bypasses already stamp their decider and emit their literal resolution at one site each; routing them through the mapper changes nothing observable and touches three more files.
- **An ADR 0011 amendment.**
  §7's rule — "the agent renderer identifies the call; it does not reproduce it" — is unchanged, and the new renderer obeys it: it adds the decider's name (operator config), never the call's input.
- **The review log's own `resolution` field.**
  It records the decision *state* (`approved` / `denied_with_reason`), with `decidedBy` already beside it; it is not a `PermissionDecisionResolution` and needs no change.
- **Exporting `PermissionDecisionResolution` by name from `service.ts`.**
  It is already reachable through `PermissionDecisionEvent`; a speculative re-export is dead weight fallow would flag.

## Background

- `src/authority/decision-source.ts` owns the `DecisionSource` union (`user | authorizer | rule | session_approval | yolo | infrastructure_read | unavailable | gate_error | forwarded`) and the depth-bounded tolerant guard `asDecisionSource`.
  The file's stated discipline is that the guard lives beside its type so a new variant updates the neighbour; `MAX_DECISION_SOURCE_DEPTH` is 4.
- `PermissionPromptDecision` (`src/authority/permission-dialog.ts`) requires `decidedBy`, so every escalation result already carries one.
  `ParentAuthorizer.relayDecision` wraps a responder's answer as `{ kind: "forwarded", responderSessionId, decision }`, with `decision: null` only when an older responder sent none.
- `ForwardedRequestServer.resolveDecision` answers a request its recorded authority resolves with `decidedBy: { kind: "rule", … }`, and its `escalateAsk` catch answers with `{ kind: "gate_error", reason }`.
  Its private `servedResolution` already reads `decidedBy.kind` — but only for `gate_error`, falling back to the same user-shaped guesses for everything else.
- `applyPermissionGate` (`src/permission-gate.ts`) picks the agent-facing denial text with one boolean: `decision.confirmationUnavailable ? messages.unavailableReason : messages.userDeniedReason`.
  That is the [#719] distinction ("a user who was never asked denied nothing"), and it is the only decider fact the gate consults.
- **`decision.autoApproved` has no production producer.**
  `grep -rn 'autoApproved' src` finds the declaration, `deriveResolution`'s parameter, and the runner's capture — no assignment.
  Yolo short-circuits ahead of escalation (`resolveYoloGrant`, [#712]/[#526]), so an `ask` never reaches a prompt under yolo.
  It is set only by test doubles, and it is not on the forwarded wire (`ForwardedPermissionResponse` has no such field).
- AGENTS.md constraints that bite here: a step removing an export breaks every importer at the type level in that commit, so extraction and all consumer/test updates fold into one step; `pnpm fallow dead-code` gates `unused-exports` as an error, so a new export cannot land a commit ahead of its first consumer.

## Design Overview

Two derivations become one reading of the stamp.

### 1. Unwrapping the hop

`effectiveDecider` joins `asDecisionSource` in `src/authority/decision-source.ts`:

```typescript
/**
 * The decider a `forwarded` hop is standing in for: the innermost non-forwarded
 * source, or the hop itself when the responder sent none.
 */
export function effectiveDecider(source: DecisionSource): DecisionSource;
```

Bounded by `MAX_DECISION_SOURCE_DEPTH` with a counted `for` loop, never `while (true)`.
`responderSessionId` — *where* the decision was made — is deliberately dropped here: the bus event's `forwarding` context carries requester identity for a **served** decision, and ADR 0011 §6 keeps requester identity beyond it off the channel.
What this function answers is *what* decided.

### 2. One total mapping

New `src/authority/decision-resolution.ts`:

```typescript
export function resolutionFor(
  decidedBy: DecisionSource,
  outcome: { approved: boolean; forSession: boolean },
): PermissionDecisionResolution;
```

A `never`-exhaustive `switch` over `effectiveDecider(decidedBy).kind`:

| Decider                         | `approved: true`                                                    | `approved: false`          |
| ------------------------------- | ------------------------------------------------------------------- | -------------------------- |
| `rule`                          | `policy_allow`                                                      | `policy_deny`              |
| `session_approval`              | `session_approved`                                                  | `session_approved`         |
| `infrastructure_read`           | `infrastructure_auto_allowed`                                       | —                          |
| `yolo`                          | `auto_approved`                                                     | —                          |
| `user`                          | `user_approved_for_session` when `forSession`, else `user_approved` | `user_denied`              |
| `authorizer`                    | `authorizer_allowed`                                                | `authorizer_denied`        |
| `unavailable`                   | —                                                                   | `confirmation_unavailable` |
| `gate_error`                    | —                                                                   | `gate_error`               |
| `forwarded` (inner `null` only) | `user_approved`                                                     | `user_denied`              |

`forSession` stays an *outcome* bit supplied by the caller rather than a decider fact: `{ kind: "user", via }` does not record scope, and both call sites already compute it (the runner from `gateResult.sessionApproval`, the serving node from `decision.state`).
The `forwarded`-with-`null`-inner arm preserves today's behavior for a version-skewed responder, which is the fail-soft direction.

The module lives beside `decision-source.ts` because both consumers are authority-layer, and `permission-events.ts` is the *public contract* file — putting a mapper there would pull an authority import into the package's declared surface.

### 3. The two call sites

`GateRunner.runDescriptor` collapses its two closure captures into one:

```typescript
let promptDecision: PermissionPromptDecision | null = null;
const decidedByRule: DecisionSource = { kind: "rule", surface, pattern, origin };
// … promptForApproval: async () => (promptDecision = await this.prompter.escalate(…))
resolutionFor(promptDecision?.decidedBy ?? decidedByRule, {
  approved: gateResult.action === "allow",
  forSession: hasSessionApproval,
});
```

`decidedByRule` is the literal the method already builds for `applyPermissionGate`, hoisted to a `const`.
The non-prompting arms keep their values by construction: `state: "allow"` → `policy_allow`, `state: "deny"` → `policy_deny`.
The yolo fast path calls `resolutionFor({ kind: "yolo", pattern }, { approved: true, forSession: false })` — reusing the same record it already writes to the review log, so the log and the bus cannot disagree about a yolo grant.

`buildServedDecisionEvent` calls `resolutionFor(decision.decidedBy, { approved, forSession })` and `servedResolution` is deleted.
`deriveResolution` is deleted; `helpers.ts` keeps its other three exports.

`decision.autoApproved` is removed from `PermissionPromptDecision`: nothing produces it, and the `yolo` decider is now how an auto-approval names itself.

### 4. The agent-facing text

`src/presentation/agent-renderer.ts` gains the link-naming renderer and a decider dispatch:

```typescript
export function renderAuthorizerDenial(
  payload: PromptPayload,
  linkName: string,
  denialReason: string | null,
  budget: AgentRenderBudget = DEFAULT_RENDER_BUDGET,
): string;

/** The refusal render this decision earns, chosen by what decided it. */
export function renderRefusal(
  payload: PromptPayload,
  decidedBy: DecisionSource,
  denialReason: string | null,
  budget: AgentRenderBudget = DEFAULT_RENDER_BUDGET,
): string;
```

`renderRefusal` switches exhaustively over `effectiveDecider(decidedBy).kind`: `authorizer` → the new renderer, `unavailable` → `renderUnavailableDenial`, and the remaining kinds → `renderUserDenial`, with the `rule` and `gate_error` cases named in a comment against [#844].
No `default` arm, so a new `DecisionSource` variant is a compile error rather than a silent user attribution.

The rendered sentence, for the issue's reported case:

```text
[pi-permission-system] The 'model-judge' authorizer denied this 'external_directory' call for tool 'read' for path
'/Users/…/service.test.ts': outside working directory '/Users/…/pi-packages'. Reason: Doubled package segment detected….
```

The link name is operator configuration, not agent input, so it is not capped — the same treatment `matchedPattern` gets in `ruleClause`.

`renderRefusal` takes a `DecisionSource` and a reason string rather than the whole `PermissionPromptDecision`: those are the only two fields it reads (ISP), and it keeps the presentation module free of the decision type.

`PermissionGateParams.messages` drops from three entries to two:

```typescript
messages: {
  denyReason: string;
  refusedReason: (decision: PermissionPromptDecision) => string;
};
```

The `confirmationUnavailable` branch leaves `applyPermissionGate` entirely — selecting the render is now a decider dispatch with one home (OCP), not a boolean the gate re-decides.
The runner supplies `refusedReason: (d) => renderRefusal(payload, d.decidedBy, d.denialReason ?? null)`.

## Module-Level Changes

| File                                                                                                          | Change                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/permission-events.ts`                                                                                    | `PermissionDecisionResolution` gains `"authorizer_allowed"` and `"authorizer_denied"`, each on its own line with a doc comment                                                                                   |
| `src/authority/decision-source.ts`                                                                            | adds exported `effectiveDecider`, bounded by `MAX_DECISION_SOURCE_DEPTH`                                                                                                                                         |
| `src/authority/decision-resolution.ts`                                                                        | **new** — `resolutionFor`, the total mapping                                                                                                                                                                     |
| `src/handlers/gates/helpers.ts`                                                                               | `deriveResolution` deleted (its only two call sites move); `deriveDecisionValue`, `buildDecisionEvent`, `resolveYoloGrant` untouched                                                                             |
| `src/handlers/gates/runner.ts`                                                                                | two `let` captures → one `promptDecision`; `decidedByRule` hoisted to a `const`; both `deriveResolution` calls → `resolutionFor`; `messages` bag rebuilt around `refusedReason`                                  |
| `src/permission-gate.ts`                                                                                      | `messages` 3 → 2 entries; the `confirmationUnavailable` render branch removed                                                                                                                                    |
| `src/presentation/agent-renderer.ts`                                                                          | adds `renderAuthorizerDenial` + `renderRefusal`; the three existing renderers keep their signatures                                                                                                              |
| `src/authority/forwarded-request-server.ts`                                                                   | private `servedResolution` deleted; `buildServedDecisionEvent` calls `resolutionFor`                                                                                                                             |
| `src/authority/permission-dialog.ts`                                                                          | `autoApproved?: true` removed from `PermissionPromptDecision`                                                                                                                                                    |
| `test/helpers/decision-fixtures.ts`                                                                           | adds `DECIDED_BY_AUTHORIZER`, the sibling of `DECIDED_BY_HUMAN`                                                                                                                                                  |
| `test/authority/decision-resolution.test.ts`                                                                  | **new**                                                                                                                                                                                                          |
| `test/authority/decision-source.test.ts`                                                                      | `effectiveDecider` cases                                                                                                                                                                                         |
| `test/handlers/gates/helpers.test.ts`                                                                         | `describe("deriveResolution")` (lines 56–99, 8 tests) deleted                                                                                                                                                    |
| `test/handlers/gates/runner.test.ts`                                                                          | `decidedBy` supplied on four denial fixtures; the `autoApproved` test rewritten around a `yolo` decider; authorizer-path assertions added                                                                        |
| `test/permission-gate.test.ts`                                                                                | `unavailableDecision`'s contradictory `DECIDED_BY_HUMAN` corrected; `messages` bag assertions follow the 3 → 2 shape                                                                                             |
| `test/handlers/tool-call-events.test.ts`, `test/handlers/input-events.test.ts`, `test/handlers/input.test.ts` | same fixture corrections; the two `autoApproved: true` decisions rewritten                                                                                                                                       |
| `test/presentation/agent-renderer.test.ts`                                                                    | `renderAuthorizerDenial` + `renderRefusal` dispatch cases                                                                                                                                                        |
| `test/authority/forwarded-request-server.test.ts`                                                             | an authorizer-decided served ask broadcasts `authorizer_denied`                                                                                                                                                  |
| `docs/cross-extension-api.md`                                                                                 | two rows in the **Resolution Values** table; a sentence that a forwarded decision is attributed to the decider inside the responding session                                                                     |
| `docs/architecture/architecture.md`                                                                           | module-tree entries for `helpers.ts`, `agent-renderer.ts`, `decision-source.ts`, `permission-dialog.ts`, plus a new `decision-resolution.ts` line; Step 5 `✅` on heading and Mermaid node with a `Landed:` note |
| `.pi/skills/package-pi-permission-system/SKILL.md`                                                            | the sentence naming `PermissionGateParams.unavailableReason` / `userDeniedReason` (line 102) is stale once the bag becomes `refusedReason`                                                                       |

Greps run to build this list: `deriveResolution` / `servedResolution` / `autoApproved` / `renderUserDenial` / `renderUnavailableDenial` / `user_approved` / `user_denied` / `PermissionDecisionResolution` across `src/`, `test/`, `docs/`, `README.md`, and the whole `.pi/skills/` tree.
`README.md` names no resolution value and no renderer, so it is unaffected.
`docs/cross-extension-api.md` ships in the tarball (`files` includes `docs/*.md`), so its table is a published contract.

## Test Impact Analysis

**Newly possible.**
`resolutionFor` is directly unit-testable across all nine `DecisionSource` kinds and the forwarded-unwrap cases — impossible before, because `deriveResolution` took no decider at all and its five-boolean signature could not express "a link decided this".
`effectiveDecider` gets its own cases, including the depth bound and the `null`-inner hop.
`renderRefusal` gets dispatch tests that assert which sentence each decider earns.

**Newly redundant.**
The 8-test `describe("deriveResolution")` block in `helpers.test.ts` is deleted with the function.
The Tidy-First assessor verified that no test body there survives the signature change — every one calls the 5-argument form — so there is no move-only commit to make; the coverage is rewritten at higher fidelity in `decision-resolution.test.ts` in the same step that deletes it.

**Must stay.**
`runner.test.ts`'s gate-level assertions pin the *wiring* (which decision reaches the mapper, and that the request id is stamped once), not the mapping.
`forwarded-request-server.test.ts`'s served-broadcast tests pin the [#610] contract that a serving node emits one terminal decision per escalated ask.
`permission-gate.test.ts`'s deny-arm tests pin the policy path, which no longer routes through any message dispatch at all.

## Invariants at risk

| Invariant                                                                                                                          | Pinned by                                                                                                                                                                                            | Risk here                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#726]: `decidedBy` is stamped at the site that decides, never inferred from an event name or a resolution                         | `test/authority/permission-prompter.test.ts`, `test/authority/authorizer-chain.test.ts` ("names the deciding link"), `test/logging.test.ts` (nested provenance survives the width cap and redaction) | This change reads the stamp in one more place; it must not begin *writing* one. No new `decidedBy` producer appears in any step.                                                                                                                                                                                                                                                                                                |
| [#719]: an absent-authority denial is not reported as a user denial                                                                | `test/permission-gate.test.ts` "returns block with unavailable reason when the decision is confirmation-unavailable"; `runner.test.ts` at ~540 and ~557                                              | Step 4 moves that dispatch out of `applyPermissionGate` and into `renderRefusal`. The gate test's own fixture pairs `confirmationUnavailable: true` with `decidedBy: DECIDED_BY_HUMAN`, which would resolve to the *user* render under the new dispatch — a contradictory fixture that pins nothing once the dispatch reads `decidedBy`. Step 1 corrects it before the dispatch exists, so the test keeps testing its own name. |
| [#610]: a serving node broadcasts one terminal decision per escalated forwarded ask, and a failed escalation resolves `gate_error` | `forwarded-request-server.test.ts` "broadcasts a failed escalation as gate_error", "broadcasts an unreachable authority as confirmation_unavailable"                                                 | `servedResolution` is deleted; `resolutionFor`'s `gate_error` and `unavailable` arms must reproduce both exactly. Both tests already carry a correct `decidedBy`, so they pin the replacement without edits.                                                                                                                                                                                                                    |
| [#712]/[#526]: a yolo grant resolves `auto_approved` with the ask's matched pattern preserved                                      | `runner.test.ts` yolo fast-path tests; `tool-call-events.test.ts`                                                                                                                                    | The yolo call site changes from a five-boolean call to a `{ kind: "yolo" }` decider. Same value, different route.                                                                                                                                                                                                                                                                                                               |
| Phase 14 health metric: authorizer resolution values in `permission-events.ts`                                                     | `grep -cE 'authorizer_allowed\|authorizer_denied' packages/pi-permission-system/src/permission-events.ts`                                                                                            | **Measured baseline today: 0.** Predicted after Step 2: **2** — one line per union member. The step must use the roadmap's spelling or update the metric row in the same commit.                                                                                                                                                                                                                                                |

Quantitative prediction for the behavior change, from the 12,281-line review log measured above: 13 previously-`user_denied` decisions become `authorizer_denied`, and of 68 terminal `forwarded` decisions, 57 become `policy_allow` while 11 keep their user attribution.
No decision changes its `result` (`allow`/`deny`); only the `resolution` label and, for the 13, the agent-facing sentence.

## TDD Order

1. **`test(pi-permission-system): stamp the real decider on the prompt-decision fixtures`** Correct every escalation fixture whose `decidedBy` contradicts, or is missing from, what a real producer would stamp: `runner.test.ts` (~313, ~542, ~559, ~577), `permission-gate.test.ts` (~83), `tool-call-events.test.ts` (~207), `input-events.test.ts` (~131), `input.test.ts` (~130).
   A `confirmationUnavailable: true` decision gets `{ kind: "unavailable", reason }` — the shape `DenyingAuthorizer` and `ParentAuthorizer.abandon` actually produce — not `DECIDED_BY_HUMAN`.
   Leave the three `autoApproved: true` sites alone; the steps below rewrite them.
   Prepares the friction the Tidy-First assessor found: once `resolutionFor` and `renderRefusal` read `decidedBy`, these fixtures would either fail or silently misresolve, and fixing them inside the behavior commit would hide which failures were real.
   Green before and after — nothing reads `decidedBy` for dispatch yet.
   Verify: `pnpm --filter @gotgenes/pi-permission-system run test` unchanged.

2. **`feat(pi-permission-system)!: broadcast the decider that actually resolved a permission ask`** Red: new `test/authority/decision-resolution.test.ts` covering all nine decider kinds plus the forwarded unwrap; `effectiveDecider` cases in `decision-source.test.ts` (a one-hop rule, a two-hop chain, the depth bound, the `null`-inner hop); `runner.test.ts` asserting `authorizer_allowed` / `authorizer_denied` for a link-decided ask and `policy_allow` for a forwarded rule allow; `forwarded-request-server.test.ts` asserting a link-decided served ask broadcasts `authorizer_denied`.
   Adds `DECIDED_BY_AUTHORIZER` to `test/helpers/decision-fixtures.ts` in this step rather than a preparatory one, because `fallow dead-code` errors on an export with no consumer.
   Green: the union members, `effectiveDecider`, `decision-resolution.ts`, both call sites rewired, `deriveResolution` and `servedResolution` deleted with their tests.
   The three `autoApproved: true` decisions become `decidedBy: { kind: "yolo", pattern }` in the same commit — their assertions are unchanged, only the route to `auto_approved` is.
   Everything lands together because deleting `deriveResolution` breaks its importers at the type level in this commit.
   Killing mutations, one per equivalence class:
   - Make `resolutionFor`'s `authorizer` arm return `outcome.approved ? "user_approved" : "user_denied"` → the authorizer cases in `decision-resolution.test.ts`, the runner assertion, and the served assertion go red; the forwarded cases stay green.
   - Make `effectiveDecider` return its argument unchanged → the forwarded-unwrap cases and the runner's `policy_allow` assertion go red; the authorizer cases stay green.
   - Make `resolutionFor`'s `rule` arm return `policy_allow` unconditionally → the `policy_deny` case goes red alone.
   Footer: `BREAKING CHANGE:` naming the two new values, the changed attribution for chain-decided and forwarded decisions, and the remediation (handle the new values; a consumer counting `user_denied` as human interactions now gets the accurate count).
   Verify: `pnpm run check`, `pnpm run lint`, the package suite, and `grep -cE 'authorizer_allowed|authorizer_denied' src/permission-events.ts` → 2.

3. **`refactor(pi-permission-system): drop the never-produced autoApproved decision flag`** Remove `autoApproved?: true` from `PermissionPromptDecision` and the now-orphaned literals left in the fixtures.
   Nothing reads it after Step 2 and nothing in `src/` ever wrote it, so this is a type-level removal with no behavior change.
   No killing mutation — a refactor step.
   Verify: `grep -rn 'autoApproved' src test` → no matches; `pnpm run check` and the package suite green.

4. **`fix(pi-permission-system): tell the agent which authorizer refused its call`** Red: `agent-renderer.test.ts` cases for `renderAuthorizerDenial` (with and without a reason, and with the boundary/provenance clauses) and for `renderRefusal`'s dispatch (authorizer → names the link, unavailable → the no-UI sentence, user → unchanged); a `runner.test.ts` assertion that a link-denied gate's block reason names the link.
   Green: the two new exports, `PermissionGateParams.messages` reduced to `{ denyReason, refusedReason }`, the `confirmationUnavailable` branch removed from `applyPermissionGate`, and the runner supplying `refusedReason`.
   The gate's interface change and its consumers land together for the same type-level reason as Step 2.
   Killing mutations:
   - Make `renderRefusal`'s `authorizer` arm fall through to `renderUserDenial` → the new dispatch cases and the runner block-reason assertion go red; the unavailable case stays green.
   - Make the `unavailable` arm fall through to `renderUserDenial` → the [#719] regression tests go red alone.
   Verify: `pnpm run check`, `pnpm run lint`, the package suite.

5. **`docs(pi-permission-system): record decision attribution and mark Phase 14 Step 5 complete`** `docs/cross-extension-api.md`: two rows in the Resolution Values table and the forwarded-attribution sentence.
   `docs/architecture/architecture.md`: the five module-tree entries, and Step 5 marked `✅` on both its heading and its Mermaid node with a `Landed:` note recording what the delivered design did differently from the step's `Target:` line — a total mapping over `DecisionSource` rather than one added branch, and the forwarded unwrap the Target did not name.
   `.pi/skills/package-pi-permission-system/SKILL.md`: the `unavailableReason` / `userDeniedReason` sentence.
   Verify: `pnpm exec rumdl check` on each edited file; confirm no doc still describes `deriveResolution` or the three-entry `messages` bag.

## Risks and Mitigations

| Risk                                                                                                         | Mitigation                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A downstream consumer's exhaustive `switch` over `resolution` stops compiling                                | Intended and priced: `feat!:` with a `BREAKING CHANGE:` footer naming both new values and the remediation. The union is already public through `PermissionDecisionEvent`.  |
| Attributing 57 forwarded allows to `policy_allow` surprises a consumer that treated them as human approvals  | The new label is the accurate one, and the footer says so explicitly. A consumer wanting "a human was involved somewhere" now has a correct signal instead of a false one. |
| Deleting `servedResolution` silently regresses the [#610] `gate_error` or `confirmation_unavailable` mapping | Both are pinned by named tests that already carry a correct `decidedBy`, so they exercise `resolutionFor` without edits. Listed under Invariants at risk.                  |
| Removing `autoApproved` breaks a forwarded response from an older parent                                     | Verified against `ForwardedPermissionResponse`: the field is not on the wire, so no version-skewed payload can carry it.                                                   |
| The Step 4 dispatch reads a fixture's `decidedBy` that contradicts the test's own name                       | Step 1 corrects every such fixture before the dispatch exists, and lands green so a later failure is unambiguously the behavior change.                                    |
| The roadmap's health-metric grep breaks if the values are spelled differently                                | The names are fixed by the operator's naming decision and match the roadmap's own spelling; Step 2 verifies the grep reads 2.                                              |

## Open Questions

- Should `PermissionDecisionResolution` be exported by name from `service.ts` so a consumer can annotate a variable of its own, as `PromptRequestFacts` and friends already are?
  Deferred until asked — the type is reachable through `PermissionDecisionEvent`, and a speculative re-export is what `fallow dead-code` flags.

[#526]: https://github.com/gotgenes/pi-packages/issues/526
[#610]: https://github.com/gotgenes/pi-packages/issues/610
[#712]: https://github.com/gotgenes/pi-packages/issues/712
[#719]: https://github.com/gotgenes/pi-packages/issues/719
[#726]: https://github.com/gotgenes/pi-packages/issues/726
[#844]: https://github.com/gotgenes/pi-packages/issues/844
