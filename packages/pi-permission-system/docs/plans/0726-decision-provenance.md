---
issue: 726
issue_title: "pi-permission-system: permission decisions record no responder provenance — a human approval is indistinguishable from an auto-approval"
---

# Decision provenance — `decidedBy` on every permission decision

## Release Recommendation

**Release:** ship independently

Phase 13 Step 6 carries `Release: independent` in the roadmap, and the phase's two release batches ("presentation-payload", "presentation-contract") are both closed — Steps 1–4 have landed.
This change is additive to the review log and version-skew tolerant on the forwarding wire, so it ships as a `feat:` on its own.

## Problem Statement

The review log records that a permission request was resolved, but not **what resolved it**.
Every terminal event states an outcome (`approved`, `blocked`, `session_approved`) and a `resolution`, and the decider is left to be inferred from the event name — which works for the fast paths and fails completely on the ask path, where a human at a TUI dialog, a registered `Authorizer` link, an absent-authority denial, and a relayed answer from another session all collapse into the same `{approved, state, denialReason}`.

The reported case is exactly that failure.
A `pre-completion-reviewer` subagent ran `find /`, the `external_directory` gate fired correctly, the ask was forwarded, `forwarded_permission.prompted` was logged, and 21.5 s later `forwarded_permission.approved` appeared.
Three explanations — the operator clicked approve, the prompt rendered somewhere unseen and something else resolved it, an auto-approve path resolved it after the prompt opened — leave byte-identical traces.
For a gate whose entire purpose is the distinction between *the user approved a filesystem-wide read* and *the system approved it on the user's behalf*, "a decision was made" without "by whom" is not an audit record.

Measured on the operator's live 7.44 MB review log (9522 lines): **1432** terminal prompted decisions (1160 `permission_request.approved` + 272 `.denied`) carry no decider, against 8 `authorizer_chain_resolved` and 15 `model_judge.decision` entries — so a chain link *could* have decided some of them, and nothing in the log says whether it did.

The information is not missing; it is discarded.
Each resolution site knows what decided at the moment it decides, and the fact dies before the log write.

## Goals

- Add a `DecisionSource` discriminated union (`decidedBy`) threaded **from each decision site**, never inferred from an event name or a `resolution` value.
- Record it on every terminal review-log entry: the ask path, the session/yolo/infrastructure fast paths, the policy-deny path, the gate-error boundary, and both sides of the forwarding exchange.
- Carry it on `ForwardedPermissionResponse` so a subagent's decision is traceable end to end: the child's own terminal entry names the session that answered **and** what within that session decided.
- Make the field structurally unforgettable — required on `PermissionPromptDecision` and `GateBypass` once the threading is complete, so `tsc` proves every decision names its decider.
- Non-breaking: additive to the review log; the wire field is optional and tolerantly read, so a version-skewed child or parent degrades rather than failing.

## Non-Goals

- **`permissions:decision` bus event.**
  Operator decision at planning time: hold off until the channel's consumers are known.
  `PermissionDecisionEvent` is untouched by this plan, and the roadmap's Step 6 `Outcome:` is corrected to match the narrowed scope.
- **`/permissions` history view** (issue's third suggestion).
  No such view exists — `/permission-system` (`src/config-modal.ts`) is a config modal.
  Nothing to surface into.
- **The cross-ID-space join** (the issue's secondary observation).
  Resolved by [#752]: `ParentAuthorizer` now adopts the requester's `requestId` as the forwarded request's `id`, so `permission_request.*` and `forwarded_permission.*` share one id.
- **Responder agent name on `forwarded_permission.*`** (the rest of the secondary observation).
  The serving node's *human* is the decider on the prompted path; an agent name there names the wrong actor.
  Not planned.
- Collapsing the flat review-log columns (`surface`, `matchedPattern`, `sessionApprovalPattern`) into `decidedBy` — see Open Questions.
- [#753] (the gate-error boundary emits no `permissions:decision`) — filed separately during Step 9, still open, and touching the same boundary.
  This plan writes `decidedBy` onto that boundary's review entry but does not add the missing emit.
- [#610] Step 10 (cross-session prompt/decision correlation), which also enriches the review-log write path.
  The roadmap says land Steps 6 and 10 in sequence, not concurrently.

## Background

### Where decisions are made

| Site                                      | Terminal review event                                 | What decides                   | Recorded today                |
| ----------------------------------------- | ----------------------------------------------------- | ------------------------------ | ----------------------------- |
| `gates/bash-external-directory.ts` bypass | `permission_request.session_approved`                 | session rules                  | no                            |
| `gates/bash-path.ts` bypass               | `permission_request.session_approved`                 | session rules                  | no                            |
| `gates/external-directory.ts` bypass      | `permission_request.infrastructure_auto_allowed`      | infra-read containment         | by event name                 |
| `gates/runner.ts` session fast path       | `permission_request.session_approved`                 | session rule + pattern         | `sessionApprovalPattern` only |
| `gates/runner.ts` yolo fast path          | `permission_request.auto_approved`                    | `yoloMode` / `origin: "yolo"`  | by event name                 |
| `permission-gate.ts` deny arm             | `permission_request.blocked` (`policy_denied`)        | config rule                    | `matchedPattern` only         |
| `permission-gate.ts` allow arm            | *(no entry)*                                          | config rule                    | n/a                           |
| `authority/permission-prompter.ts`        | `permission_request.approved` / `.denied`             | **whoever the chain returned** | **no**                        |
| `handlers/tool-call-boundary.ts`          | `permission_request.blocked` (`gate_error`)           | a thrown gate                  | by `resolution`               |
| `authority/forwarded-request-server.ts`   | `forwarded_permission.auto_approved` / `.auto_denied` | serving node's rules           | by event name                 |
| `authority/forwarded-request-server.ts`   | `forwarded_permission.approved` / `.denied`           | serving node's chain           | **no**                        |
| `authority/approval-escalator.ts`         | `forwarded_permission.response_received`              | the parent — opaque            | `responderSessionId` only     |

A plain policy `allow` writes no review entry at all, so it is out of the log's scope by construction; its provenance would only ever have surfaced on the bus, which this plan excludes.

### Why the ask path loses it

`composeAuthorizerChain` (`src/authority/authorizer-chain.ts`) maps an `AuthorizerVerdict` to a `PermissionPromptDecision` through `decideFromVerdict`, which produces a bare `{approved, state}`.
The link's **name** is available one layer up — `AuthorizerSelection.resolveConfiguredLinks` logs it as `authorizer_chain_resolved` — and is then dropped when each link is wrapped as an anonymous `{ authorize }` object.
So the chain structurally cannot say which link decided, only which links were consulted.

Downstream, `LocalUserAuthorizer` calls `requestPermissionDecision` (`src/authority/permission-prompt-component.ts`), the single place the `mode === "tui"` inline-dialog vs `select`/`input`-fallback dispatch is made.
That dispatcher is where the human's *surface* is known — the pure reducer below it (`permission-prompt-decision.ts`) must not learn about provenance.

### Constraints that already hold

- **`writeLine` bounds and redacts nested values.**
  `capLogFieldWidths` (`src/log-field-cap.ts`) recurses through plain objects and arrays, and `redactedJsonStringify` (`src/log-redaction.ts`) masks by key name through a JSON replacer.
  A nested `decidedBy` is therefore width-capped and key-name redacted with no new work — and no new write path may bypass `writeLine`.
- **Fail-closed at the wire boundary.**
  `decidedBy` arrives off disk in a response file, so its reader is a tolerant `asX`-style guard beside its type (the `asPromptPayload` precedent), and it must be depth-bounded: a recursive guard over untrusted JSON is a stack-overflow surface.
  #752 set this precedent when it validated an adopted request id before letting it name a file.
- **Additive wire fields are version-skew tolerant** (ADR 0011 §9): an older parent sends no `decidedBy`, and the child records `decision: null` inside the forwarded variant rather than rejecting the response.
- **Required beats conventional.**
  Step 1's landed note records the lesson: `PromptPermissionDetails.payload` is required, "making 'every ask carries a complete payload' a compile-time guarantee rather than a convention."
  The same applies here, reached by lift-and-shift.

## Design Overview

### The type

New module `src/authority/decision-source.ts`, beside the decision types it annotates:

```typescript
/**
 * What decided a permission request, recorded at the decision site.
 *
 * Never inferred from an event name or a `resolution` value: each site
 * constructs its own variant, so a new resolution path cannot silently
 * inherit another's provenance.
 */
export type DecisionSource =
  | { kind: "user"; via: "dialog" | "select" }
  | { kind: "authorizer"; name: string; verdict: "allow" | "deny"; reason: string | null }
  | { kind: "rule"; surface: string; pattern: string | null; origin: string | null }
  | { kind: "session_approval"; surface: string; pattern: string | null }
  | { kind: "yolo"; pattern: string | null }
  | { kind: "infrastructure_read" }
  | { kind: "unavailable"; reason: string }
  | { kind: "gate_error"; reason: string }
  | {
      kind: "forwarded";
      responderSessionId: string | null;
      /** The serving node's own source; `null` when it sent none (version skew). */
      decision: DecisionSource | null;
    };
```

The union is **self-contained**: each variant repeats the detail that made it decisive.
On a local review line that duplicates `surface` and the pattern column; across the forwarding boundary it is the only shape that survives, because `ForwardedPermissionResponse` carries no surface, pattern, or origin column to lean on.
`origin` and the link `name` are new facts appearing on a review line for the first time.

The `forwarded` variant is recursive through an object property, which TypeScript resolves lazily; an exhaustive `switch (source.kind)` still type-checks as total.

Measured growth on the operator's 7.44 MB log: 5777 decision-bearing lines at 765 bytes average, `+95` bytes for a `rule` variant and `+134` for a nested forwarded one — a **7.4% worst case**, against the 28.7% #746 removed.

### The seam

`decidedBy` rides the object each site already produces, so no site gains a second thing to remember:

- `PermissionPromptDecision` (`src/authority/permission-dialog.ts`) gains `decidedBy` — every producer of a decision states who produced it.
- `GateBypass` (`src/handlers/gates/descriptor.ts`) gains `decidedBy` — the gate that short-circuits is the decider, and the runner stamps it onto the bypass's log entry (and its decision facts, for the one bypass that carries them).
- `ForwardedPermissionResponse` (`src/authority/permission-forwarding.ts`) gains an optional `decidedBy`.

It is **not** merged into `GateRunner`'s shared `logContext`.
That context holds the facts every resolution of a gate shares; the decider is by definition not shared, so each write stamps its own.

### Call-site sketches

The chain, once links are named:

```typescript
// authorizer-chain.ts — links become { name, authorize }
for (const link of links) {
  const verdict = await link.authorize(details, query, log);
  if (verdict.kind === "defer") continue;
  return decisionFromVerdict(link.name, verdict); // stamps { kind: "authorizer", name, … }
}
return terminal.authorize(details);
```

The relay, on the child:

```typescript
// approval-escalator.ts — the parent's answer, nested under this session's view of it
const response = readForwardedPermissionResponse(this.logger, responsePath);
return response
  ? { ...response, decidedBy: { kind: "forwarded",
      responderSessionId: response.responderSessionId,
      decision: asDecisionSource(response.decidedBy) ?? null } }
  : abandon("The parent session's permission response could not be read");
```

`abandon` already names which path gave up; it becomes `{ kind: "unavailable", reason }` over the same string, so the denial reason and the provenance cannot drift.

The dispatcher, where the human's surface is decided:

```typescript
// permission-prompt-component.ts — requestPermissionDecision
const via = view.mode === "tui" ? "dialog" : "select";
const decision = await (view.mode === "tui" ? presentInline(…) : presentFallback(…));
return { ...decision, decidedBy: { kind: "user", via } };
```

Stamping here rather than inside `reducePrompt` keeps the pure decision model free of provenance and puts `via` exactly where the surface choice is made — the decide-once rule.

### Edge cases

- **Yolo.**
  Two arms reach the yolo fast path: a composition-stage rewrite (`origin: "yolo"` on the matched rule, #526) and an `ask` synthesized after resolution (#712).
  Both are `{ kind: "yolo", pattern }`, where `pattern` is the preserved `matchedPattern` — including a sentinel like `<opaque-bash-wrapper>`, which is what makes a yolo grant over a synthetic ask legible.
- **Grant-scope translation.** `ForwardedRequestServer.applyGrantScope` rewrites `approved_for_serving_session` to a plain `approved`; it must carry `decidedBy` through unchanged, or a whole-session grant loses its decider.
- **Serving-node policy arms.** `resolveDecision` currently reads only `.state` off `policy.resolve(...)`; it takes the whole `PermissionCheckResult` so the `rule` variant can carry `matchedPattern` and `origin`.
- **Escalation failure.**
  The `catch` arm in `resolveDecision` becomes `{ kind: "gate_error", reason }` rather than an unattributed deny.
- **Version skew, both directions.**
  A newer child reading an older parent's response records `decision: null`; an older child reading a newer parent's response ignores the unknown field (its reader is already an allowlist).

## Module-Level Changes

### New

- `src/authority/decision-source.ts` — the `DecisionSource` union, the depth-bounded tolerant guard `asDecisionSource`, and small constructors where a site would otherwise repeat a literal.
- `test/authority/decision-source.test.ts` — guard behavior: each variant round-trips, a malformed variant yields `undefined`, nesting beyond the bound yields `undefined`, an unknown `kind` yields `undefined`.

### Changed

| File                                            | Change                                                                                                                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/authority/permission-dialog.ts`            | `PermissionPromptDecision.decidedBy`; `createDeniedPermissionDecision` takes the source; `requestPermissionDecisionFromUi` stamps `{kind:"user",via:"select"}`                          |
| `src/authority/permission-prompt-component.ts`  | `requestPermissionDecision` stamps `via` at the mode dispatch                                                                                                                           |
| `src/authority/permission-prompt-decision.ts`   | decision literals in `reducePrompt` — stamped by the dispatcher above, so this file changes only if the type requires a placeholder during the transition                               |
| `src/authority/authorizer.ts`                   | `Authorizer` links carry a `name` where the chain consumes them (a `NamedAuthorizer` wrapper; the public `registerAuthorizer` signature is unchanged)                                   |
| `src/authority/authorizer-chain.ts`             | `composeAuthorizerChain` takes named links; `decideFromVerdict` stamps `{kind:"authorizer",name,verdict,reason}`                                                                        |
| `src/authority/authorizer-selection.ts`         | `resolveConfiguredLinks` returns named links instead of anonymous ones                                                                                                                  |
| `src/authority/denying-authorizer.ts`           | `{kind:"unavailable",reason}`                                                                                                                                                           |
| `src/authority/approval-escalator.ts`           | `abandon` stamps `unavailable`; the response path nests the parent's source; `forwarded_permission.response_received` logs `decidedBy`                                                  |
| `src/authority/forwarded-request-server.ts`     | policy arms stamp `rule`; `catch` stamps `gate_error`; `applyGrantScope` preserves it; `recordForwardedDecision` writes it to the log **and** the response file                         |
| `src/authority/permission-forwarding.ts`        | `ForwardedPermissionResponse.decidedBy?: DecisionSource`                                                                                                                                |
| `src/authority/forwarding-io.ts`                | `readForwardedPermissionResponse` admits the field through its tolerant read (an allowlist reader silently drops an unlisted field)                                                     |
| `src/authority/permission-prompter.ts`          | `writeReviewEntry` writes `decidedBy` on the approved/denied entries                                                                                                                    |
| `src/permission-gate.ts`                        | the `deny` arm's `permission_request.blocked` write stamps `rule` — the source is passed in beside `messages`, derived from the resolved check                                          |
| `src/handlers/gates/descriptor.ts`              | `GateBypass.decidedBy`                                                                                                                                                                  |
| `src/handlers/gates/runner.ts`                  | bypass branch merges `gate.decidedBy` into the log entry; session and yolo fast paths stamp their own; the `rule` source is built once from `check` and handed to `applyPermissionGate` |
| `src/handlers/gates/external-directory.ts`      | bypass carries `{kind:"infrastructure_read"}`                                                                                                                                           |
| `src/handlers/gates/bash-external-directory.ts` | bypass carries `{kind:"session_approval",…}`                                                                                                                                            |
| `src/handlers/gates/bash-path.ts`               | bypass carries `{kind:"session_approval",…}`                                                                                                                                            |
| `src/handlers/tool-call-boundary.ts`            | `recordGateError` stamps `{kind:"gate_error",reason}`                                                                                                                                   |

### Test touch points

`decidedBy` becomes a **required** field on `PermissionPromptDecision`, so per the AGENTS.md rule for a new required field on a shared interface, the grep is for *constructors*, not use sites.
Measured: ~150 decision object literals across 19 test files plus 5 helpers — `test/permission-gate.test.ts`, `test/composition-root.test.ts`, `test/authority/{local-user-authorizer,permission-prompt-component,permission-dialog,authorizer-selection,permission-prompter,denying-authorizer,forwarded-request-server,approval-escalator,authorizer-chain,permission-prompt-decision}.test.ts`, `test/handlers/{shell-tool-alias,input,input-events,tool-call,tool-call-events}.test.ts`, `test/handlers/gates/runner.test.ts`, and `test/helpers/{handler,authorizer,external-directory,forwarding,gate}-fixtures.ts`.

Many are `toEqual` **assertions**, which break as soon as production starts setting the field regardless of optionality — so the migration is per-producer, not deferrable.
The TDD order below is decomposed accordingly, and the required-ness flip is isolated to a final step (lift-and-shift; never a single step rewriting a large test file wholesale).

### Doc updates

| File                                               | Change                                                                                                                                                                                                                                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/architecture/architecture.md`                | mark Step 6 `✅` on the heading and the Mermaid node `S6`; add a `Landed:` note; correct the Step 6 `Outcome:` to drop "and decision event" (bus excluded by operator decision); flip the `decidedBy` health-metric row                                                           |
| `docs/architecture/architecture.md` module tree    | new `authority/decision-source.ts` entry; amend the `permission-prompter.ts`, `approval-escalator.ts`, `forwarded-request-server.ts`, and `permission-forwarding.ts` entries to state current behavior (no issue-number provenance trail — only an active constraint earns a ref) |
| `docs/architecture/permission-prompter.md`         | step 3 of the bracket names `decidedBy` alongside the state and denial reason                                                                                                                                                                                                     |
| `docs/subagent-integration.md`                     | the correlatability paragraph gains the provenance half: the child's terminal entry now names the responder **and** what within it decided                                                                                                                                        |
| `.pi/skills/package-pi-permission-system/SKILL.md` | Log-writes section: `decidedBy` is stamped at each decision site, nested and therefore already covered by the recursive width cap and key-name redaction; the wire field is tolerantly read and depth-bounded                                                                     |

The health-metric recompute command is `grep -rn "decidedBy" packages/pi-permission-system/src | wc -l` (baseline **0**, measured at planning time), and the roadmap's own note requires the creating step to use the roadmap's name — which this plan does.
Predicted post-change value: ~20–30 sites (one per decision site plus the type module and the threading points); the row's target is `≥ 1`, so the prediction is not load-bearing, but the row must move off `0`.

## Test Impact Analysis

1. **New unit tests the change enables.**
   `asDecisionSource` is a pure guard with a depth bound — directly unit-testable, as `asPromptPayload` is.
   Each decision site becomes assertable in isolation: `denying-authorizer.test.ts` can pin `{kind:"unavailable"}` without a log fixture, and `authorizer-chain.test.ts` can pin *which* link decided, which no test can express today.
2. **Tests that become redundant.**
   None are removed.
   The existing suites assert outcomes, and provenance is a new orthogonal fact — the assertions are extended, not replaced.
   The one candidate for simplification is `forwarded-request-server.test.ts`'s indirect "which arm ran" checks (currently inferred from the logged event name), which can assert `decidedBy` directly.
3. **Tests that must stay as-is.**
   `permission-gate.test.ts`'s deny/ask/allow branching, `runner.test.ts`'s fast-path ordering, and `approval-escalator.test.ts`'s abandonment paths all exercise control flow this change threads a field through without altering.
   Their existing assertions are the regression guard that threading changed nothing else.

## Invariants at risk

| Invariant                                                                                  | Origin                     | Pinned by                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every review-log line is width-capped and key-name redacted, with no bypass of `writeLine` | Step 4 (#746), ADR 0010    | `test/log-field-cap.test.ts` + `test/logging.test.ts` — **add** a nested-`decidedBy` case: the cap and the mask must reach into the nested object                          |
| One request id runs from the child's gate to the serving node's decision                   | Step 9 (#752)              | `test/authority/approval-escalator.test.ts` id-adoption tests — unchanged; this plan adds a field beside the id, never a second id                                         |
| A forwarded request/response missing a newer field degrades rather than failing            | Step 3 (#745), ADR 0011 §9 | `test/authority/forwarded-request-server.test.ts` version-skew tests — **add** a response with no `decidedBy` yielding `decision: null`                                    |
| A relaying node runs no chain links (one chain per node)                                   | ADR 0007 §7 (#727)         | `test/authority/authorizer-selection.test.ts` — naming the links must not change `linksFor`'s relaying arm, which still returns `[]`                                       |
| The bounded-delegation envelope caps an `allow` on an excluded surface to `defer`          | #635                       | `test/authority/delegation-envelope.test.ts` — the envelope wraps `authorize`; naming links must wrap the **named** value so the cap still applies before the name is read |
| An adopted inbound value cannot steer this process                                         | #752                       | new `decision-source.test.ts` depth-bound case                                                                                                                             |

The quantitative invariant here is log size, measured above: `+7.4%` worst case on a 7.44 MB corpus.
That is a prediction from a real line census, not a prose argument, and the `/tdd-plan` session should re-measure against the finished shape before closing.

## TDD Order

Each cycle is red → green → commit.
`decidedBy` is introduced **optional** and tightened to required in the final code cycle, so no single cycle has to rewrite a large test file wholesale.

1. **The type and its guard.**
   `test/authority/decision-source.test.ts` covers `asDecisionSource` for each variant, malformed input, unknown `kind`, and nesting past the depth bound.
   No production consumer yet.
   `refactor(pi-permission-system): add the decision-source union and its tolerant guard (#726)`
2. **The human decider.**
   `requestPermissionDecision` stamps `{kind:"user",via}` at the mode dispatch; `requestPermissionDecisionFromUi` and `createDeniedPermissionDecision` carry the source; `PermissionPrompter.writeReviewEntry` writes `decidedBy`.
   Tests: `permission-prompt-component.test.ts` (both modes), `permission-dialog.test.ts`, `permission-prompter.test.ts`.
   `feat(pi-permission-system): record the human decider on prompted decisions (#726)`
3. **Named chain links.**
   `composeAuthorizerChain` takes `{name, authorize}` links; `decideFromVerdict` stamps `{kind:"authorizer",name,verdict,reason}`; `AuthorizerSelection.resolveConfiguredLinks` supplies the names, still wrapping each in the delegation envelope.
   The export shape of `composeAuthorizerChain` changes, so its callers and their tests move in this same commit.
   Tests: `authorizer-chain.test.ts`, `authorizer-selection.test.ts`, `delegation-envelope.test.ts`.
   `feat(pi-permission-system): name the authorizer link that decided an ask (#726)`
4. **The unavailable paths.**
   `DenyingAuthorizer` and `ParentAuthorizer.abandon` stamp `{kind:"unavailable",reason}` over the string each already produces.
   Tests: `denying-authorizer.test.ts`, `approval-escalator.test.ts`.
   `feat(pi-permission-system): attribute absent-authority denials (#726)`
5. **The non-prompting local paths.**
   `GateBypass.decidedBy` on the three bypass sites; the runner's session and yolo fast paths; `applyPermissionGate`'s deny arm; `recordGateError`.
   Tests: `runner.test.ts`, `permission-gate.test.ts`, `tool-call-events.test.ts`, `external-directory-fixtures.ts` consumers.
   `feat(pi-permission-system): record the decider on non-prompting resolutions (#726)`
6. **The forwarding wire.**
   `ForwardedPermissionResponse.decidedBy?`; `forwarded-io` admits it; the serving node stamps `rule` / `gate_error` and preserves it through `applyGrantScope`; the child nests it as `{kind:"forwarded",…}` and logs it on `response_received`.
   Includes the version-skew case (`decision: null`).
   Tests: `forwarded-request-server.test.ts`, `approval-escalator.test.ts`, `forwarding-io.test.ts`, and the round-trip in `composition-root.test.ts`.
   `feat(pi-permission-system): carry decision provenance across the forwarding boundary (#726)`
7. **Tighten to required.**
   `decidedBy` becomes required on `PermissionPromptDecision` and `GateBypass`; residual fixtures and mock returns are updated.
   Pure type flip — the behavior is already in place, so this is the compile-time guarantee, not new function.
   `refactor(pi-permission-system): require a decider on every permission decision (#726)`
8. **Nested-value bound regression.**
   Add the nested-`decidedBy` cases to the width-cap and redaction suites, asserting a long nested `reason` is capped and a sensitive-keyed nested value is masked.
   `test(pi-permission-system): pin the width cap and redaction over nested provenance (#726)`
9. **Docs.**
   Architecture module tree, Step 6 `✅` + Mermaid node + `Landed:` note + corrected `Outcome:` + health-metric row; `permission-prompter.md`; `subagent-integration.md`; the package skill.
   `docs(pi-permission-system): record decision provenance and mark Phase 13 Step 6 complete (#726)`

## Risks and Mitigations

| Risk                                                                                              | Mitigation                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A recursive tolerant guard over on-disk JSON is a stack-overflow surface                          | Depth bound in `asDecisionSource`, returning `undefined` past it; covered by a cycle-1 test.  Forwarding is depth-1 by invariant, so the bound costs nothing real                                |
| ~150 decision literals across 24 test files make a one-shot migration a large-blast-radius commit | Per-producer decomposition (cycles 2–6), each touching the files for one decision site; the required-ness flip is isolated to cycle 7                                                            |
| Naming chain links could disturb the delegation envelope or the relaying-node "no links" rule     | Envelope wraps the named link's `authorize`, so the cap still runs before the name is read; `linksFor`'s relaying arm still returns `[]`.  Both pinned by existing tests listed under Invariants |
| Self-contained variants grow the review log                                                       | Measured: +7.4% worst case on a real 7.44 MB corpus, against −28.7% just removed by #746.  Every nested string is already width-capped by `capLogFieldWidths`                                    |
| A nested object could escape the width cap or the key-name mask                                   | It does not — both recurse — but cycle 8 pins it rather than trusting the reading                                                                                                                |
| An authorizer link's `reason` is model-generated text now persisted to the log                    | It already is: `permission_request.denied` writes `denialReason` today.  The bus, which ADR 0011 §6 calls the narrowest renderer, is excluded from this change entirely                          |
| Steps 6 and 10 both enrich the review-log write path                                              | The roadmap says land them in sequence; this plan lands first and #610 rebases onto it                                                                                                           |

## Open Questions

- **Should `permissions:decision` eventually carry `decidedBy`?**
  Deferred by operator decision at planning time: the channel's consumers are not yet known, and the bus is the narrowest renderer under ADR 0011 §6.
  Revisit when a consumer is identified; the shape would likely narrow to kind + decider identity, dropping free-text `reason`.
  Not filed as an issue — it is a watch item, not scheduled work.
- **Should the flat review-log columns collapse into `decidedBy` later?**
  The duplication is `surface`, the pattern column (`matchedPattern` / `sessionApprovalPattern`), `reason`/`denialReason`, and `responderSessionId`/`targetSessionId`.
  If it becomes annoying, the removal is of the **flat columns**, not `decidedBy` — the newer field is the one with no gaps.
  That is mechanical: `renderReviewLogFacts` (`src/presentation/review-log-renderer.ts`) is the single producer of `surface`/`matchedPattern` for all review lines, and `sessionApprovalPattern` has one write site in `runner.ts`.
  It would ship as a `feat!:` with a migration note, the same class as #746 removing `message`.
  Not filed — speculative until the duplication proves costly.
- **Does a `{kind:"authorizer"}` decision want the link's own `model_judge.decision`-style detail inline?**
  No: a link already records its own trail through the injected `AuthorizerLog`, keyed by `requestId`.
  `decidedBy` names *which* link decided; the link's record says *why*.
  Revisit only if a link's trail proves hard to join.

[#610]: https://github.com/gotgenes/pi-packages/issues/610
[#752]: https://github.com/gotgenes/pi-packages/issues/752
[#753]: https://github.com/gotgenes/pi-packages/issues/753
