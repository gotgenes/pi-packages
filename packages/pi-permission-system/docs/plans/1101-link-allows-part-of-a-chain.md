---
issue: 1101
issue_title: "pi-permission-system: dialog shows the unit the authorizer link accepted, not the one still asking"
---

# An authorizer link can allow part of a bash chain and leave the rest to the prompt

## Release Recommendation

**Release:** ship independently

This issue is not a step in any improvement roadmap: `docs/architecture/architecture.md` names neither it nor a phase, and the package has no open phase.
It ships on its own.

## Problem Statement

An authorizer link rules on a whole ask: `allow`, `deny`, or `defer`.
A bash chain's ask covers every unit still asking, so a link that accepts one unit of a chain and not another can only defer.
The reporter's link accepts a plain variable assignment; for `F="a/b.txt c/d.txt" && git commit --dry-run -m x -- $F` it defers because `git commit` still asks.
On 42.0.0 the dialog then named the assignment as `command`, and `(s)` offered the assignment's pattern; nothing pointed at `git commit`, the one thing left for the human.

[#1095] (shipped in 42.1.0) made the dialog name every asking unit.
Measured on current `main` (a disposable spike through the real `ToolCallGatePipeline`, `PermissionResolver`, tree-sitter parse, and `SessionRules`, config `{"*": "allow", bash: {"*": "ask", "git add *": "allow"}}`; n = 1, deterministic path), the reporter's command now prompts:

```text
rule      : *
command   : F="a/b.txt c/d.txt"
also asks : git commit --dry-run -m x -- $F
(s) Yes, allow bash "F="a/b.txt *", "git commit *" for this session
```

`git commit` is named, but the prompt still leads with the unit the link accepted, and the session option still grants that unit's pattern.
The link has no way to say "this part is decided".

## Goals

- A link may return a partial verdict, `{ kind: "allow_units"; units: readonly string[] }`, naming asking units by their command text.
- The chain removes those units from the ask and continues with the narrowed ask: the next link and the terminal see only the units still asking, with the prompt's value, `rule` line, `also asks` lines, session patterns, and session label rebuilt for them.
- When no unit is left, the verdict is a whole allow decided by that link, non-persistent like a link's `allow`.
- A session grant chosen on a narrowed ask records only the narrowed patterns, whoever records it: the local runner, a serving node's whole-session scope, or a forwarded child's own scope.
- The bounded-delegation envelope caps `allow_units` exactly as it caps `allow`.
- Each narrowing is recorded in the review log, naming the link, the units it allowed, and the units left.
- Not breaking.
  The verdict is an additive union member that only a link produces; nothing changes until a link returns it.
  An older pi-permission-system that receives the new kind falls through `decideFromVerdict`'s switch and treats it as `defer`, which is the fail-safe reading.

## Non-Goals

- **`{ kind: "allow", units }` instead of a new kind.**
  Rejected at the planning gate: an older chain would read it as a whole-call `allow`, a fail-open across version skew.
- **A partial `deny`.**
  The call runs as one unit, so denying one unit denies the call; a link's existing `deny` already expresses it.
- **Re-running the gate without the accepted units.**
  It would give exact facts for the new head unit, but a serving node cannot re-run a child's gate, so forwarded asks need the data rebuild anyway, and every link would run twice.
- **The new head unit's `runs`, `context`, and `matched as` lines.**
  Decided at the planning gate: each asking unit gains only its own matched rule.
  A narrowed head unit shows its command and rule, which is what its `also asks` line showed before narrowing, plus the rule.
- **Gate-level records of the ask.**
  The decision event's `value`, the review log's request facts (`renderReviewLogFacts(descriptor.payload)`), and the prompter's `permission_request.waiting`/`approved` entries keep naming the gate's winner, as [#1095] kept them; the narrowing has its own record.
  `src/presentation/review-log-renderer.ts`, `src/authority/permission-prompter.ts`, and `src/handlers/gates/helpers.ts` do not change.
- **Narrowing by the serving node's own rules.**
  A forwarded chain ask still names and grants units the serving session's rules already allow; that is [#1131], which can reuse this plan's `narrowAsk`.
- **Deciding syntax-only units by their contents** ([#1129]).
  It would remove this reporter's ask without a link, but not the general case of a link accepting part of a chain.
- **`pi-permission-model-judge` adopting the verdict.**
  It is deny-first by charter and produces only `deny`/`defer`; `AuthorizerVerdict["kind"]` widens harmlessly in its `DecisionRecord`.

## Background

- `resolveBashCommandCheck` (`src/handlers/gates/bash-command.ts`) resolves each unit, picks the first most restrictive one as the winner, and `withAskingUnits` lists every asking unit in chain order as `AskingBashUnit { command, spellings?, floor? }`.
  The winner of an asking chain is `askingUnits[0]` in practice: ties go to the first unit, and a deny would have won outright.
- `describeToolGate` (`src/handlers/gates/tool.ts`) builds the payload (`buildToolAskPayload`, whose private `otherAskingUnitsFact` lists every asking unit but the first one matching the value), the session option (`suggestBashChainSessionPatterns` for several asking units), and `promptDetails.accessIntent` (`matchValues: [winner]`, `floor`, `askingUnits`).
- `GateRunner.runDescriptor` escalates `{ requestId, payload, ...promptDetails, sessionApproval }` to `AuthorizerSelection.escalate`, which composes the chain per ask (`composeAuthorizerChain`), wrapping each link in `encloseInDelegationEnvelope`.
  The runner records `descriptor.sessionApproval.atWidth(width)` when `applyPermissionGate` reports a `sessionGrant`; it never sees what the chain handed the terminal.
- On a serving node, `ForwardedRequestServer` builds details from the wire (`buildForwardedAskDetails`, no `sessionLabel`), escalates through its own chain, then `applyGrantScope` records `request.sessionApproval.grants` for a whole-session grant, and `recordForwardedDecision` writes the response the child's `ParentAuthorizer` reads; `relayDecision` spreads that response into the child's decision.
  A forwarded `approved_for_session` is recorded by the child's runner from its own descriptor.
- `readForwardedPermissionResponse` (`src/authority/forwarding-io.ts`) rebuilds an allowlist of known fields, so a wire field added without being listed there is dropped.
- The `permissions:ui_prompt` event's top-level `value` comes from `details.value` (forwarded) or `details.command` (local), beside `request: payload.request`.
- `LocalUserAuthorizer.buildRequestOptions` labels the session option from `details.sessionLabel` and the forwarded scope options from `details.sessionApproval.grants`.
- The review-log writer masks every value under a key in `COMMAND_BEARING_LOG_KEYS`, recursing through arrays.
- Package-skill constraints: a new term of art earns a `docs/glossary.md` entry; the `forwarding-io.ts` allowlist rule above; the chain is node-local and a relaying node runs no links (ADR 0007 §7), so narrowing happens only where the chain runs.

## Design Overview

### The verdict

```typescript
export type AuthorizerVerdict =
  | { kind: "allow" }
  | { kind: "deny"; reason?: string }
  | { kind: "defer" }
  /**
   * The named asking units are decided; the ask continues with the rest.
   * Units are named by `details.accessIntent.askingUnits[].command`.
   */
  | { kind: "allow_units"; units: readonly string[] };
```

Units are named by command text, not index: that is what a link reads, and identical text means an identical command, so naming `echo a` settles both units of `echo a; echo a`.

### Narrowing an ask

A new module `src/authority/ask-narrowing.ts` owns the rewrite, as a pure function over data so it serves a local ask and a forwarded one alike:

```typescript
export type NarrowedAsk =
  | { kind: "unchanged" } // no asking unit named (or no askingUnits on the ask)
  | { kind: "settled"; allowedUnits: readonly string[] } // every asking unit named
  | {
      kind: "narrowed";
      details: PromptPermissionDetails;
      allowedUnits: readonly string[];
      remainingUnits: readonly string[];
    };

export function narrowAsk(
  details: PromptPermissionDetails,
  units: readonly string[],
): NarrowedAsk;
```

`narrowed.details` rewrites only the fields that describe the asking units, and each only where the original carried it:

| Field                      | Narrowed value                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `payload`                  | `narrowBashAskPayload(payload, remaining)` (below)                                                |
| `accessIntent.askingUnits` | the remaining units, in chain order                                                               |
| `accessIntent.matchValues` | `[remaining[0].command]`                                                                          |
| `accessIntent.floor`       | the first remaining unit's floor, else absent (`withChainFloor`'s rule over the remaining units)  |
| `sessionApproval`          | `suggestBashChainSessionPatterns(remaining commands)` as grants; absent when it yields no pattern |
| `sessionLabel`             | that suggestion's label, only when the original carried one (a forwarded ask never does)          |
| `command`                  | `remaining[0].command`, only when present (local asks)                                            |
| `value`                    | `remaining[0].command`, only when non-null (forwarded asks)                                       |

`narrowBashAskPayload(payload, remaining: readonly AskingBashUnit[])` in `src/presentation/tool-ask-payload.ts`:

- head unchanged (`remaining[0].command === request.value`): keep every winner fact, rebuild only `otherAskingUnits`;
- head changed: `value = remaining[0].command`, `matchedPattern = remaining[0].matchedPattern ?? null`, `matchedSpelling`, `executedUnit`, `commandContext` = `null`;
- `otherAskingUnits` from the shared `otherAskingUnits(commands, value)` split (first match removed, absent when empty);
- `evidence` and `annotations` unchanged, so the `full command` line stays and `flaggedElements` highlights only the units still asking.

`AskingBashUnit` gains `matchedPattern?: string`, stamped by `withAskingUnits` from each unit's check (a floor sentinel for a floored unit, as the winner's payload shows today), and carried on the forwarding wire.
`ResolverServingPolicy` ignores it.

### The chain

The loop carries the ask it is currently deciding:

```typescript
let current = details;
let narrowed = false;
for (const link of links) {
  const step = stepFromVerdict(link.name, await link.authorize(current, query, log), current, log);
  if (step.kind === "decided") return step.decision;
  narrowed ||= step.details !== current;
  current = step.details;
}
const decision = await terminal.authorize(current);
return narrowed ? withNarrowedGrants(decision, current) : decision;
```

- `allow_units` → `narrowAsk(current, verdict.units)`:
  - `unchanged` → continue with `current` (a defer);
  - `settled` → `authorizer_units_allowed` record, then `{ approved: true, state: "approved", decidedBy: { kind: "authorizer", name, verdict: "allow", reason: null } }`;
  - `narrowed` → `authorizer_units_allowed` record (`requestId`, `link`, `allowedUnits`, `remainingUnits`), continue with `narrowed.details`.
- `withNarrowedGrants` stamps `narrowedGrants` on a session-scoped decision (`approved_for_session` or `approved_for_serving_session`): the narrowed `sessionApproval.grants`, or `[]` when narrowing left none.
  It is stamped `[]` rather than omitted because absence means "the gate's own suggestion", which is the wide grant.
- The decision for the whole call stays the terminal's (`decidedBy` the human, the parent, or the denying terminal); the link's share is its review record, keyed by `requestId` like `authorizer_allow_licensed`.

`encloseInDelegationEnvelope` caps `allow_units` exactly as `allow`: on an excluded surface family it becomes `defer`, unless the ask carries the nothing-on-disk license.
An excluded-surface ask never carries `askingUnits`, so the license branch is reachable but always narrows to `unchanged`.

### The narrowed grant reaches its recorder

`PermissionPromptDecision` gains:

```typescript
/**
 * The grants a session-scoped answer covers when a link narrowed the ask
 * before it was answered. Absent: the gate's own suggestion. Empty: nothing.
 */
narrowedGrants?: readonly ApprovalGrant[];
```

Lifecycle, in one place:

- **Set** by `composeAuthorizerChain` (`withNarrowedGrants`), and on a child by `relayDecision`'s existing spread of the forwarded response.
- **Read** by `applyPermissionGate`, whose `sessionGrant` becomes `{ width, grants? }`; `GateRunner` then records `SessionApproval.forGrants(grants).atWidth(width)` when `grants` is present, else `descriptor.sessionApproval.atWidth(width)`.
  Also read by `ForwardedRequestServer.applyGrantScope`, which records `decision.narrowedGrants ?? request.sessionApproval.grants` and skips the record and its `forwarded_permission.session_recorded` entry when that list is empty.
- **Carried** on `ForwardedPermissionResponse.narrowedGrants?`, written by `recordForwardedDecision` and read by `readForwardedPermissionResponse`.
  A present but malformed list reads as `[]`, which records nothing: a dropped list would fall back to the wide grant.
- **Cleared** where `applyGrantScope` rewrites a whole-session grant to a plain `approved` (it builds a fresh literal), so the child records nothing.

### Edge cases and the steps that test them

| Case                                                                     | Behavior                                                       | Step    |
| ------------------------------------------------------------------------ | -------------------------------------------------------------- | ------- |
| Link names a unit the ask does not list, or the ask has no `askingUnits` | `unchanged`, a defer                                           | 5, 9    |
| Empty `units`                                                            | `unchanged`                                                    | 5       |
| Every asking unit named                                                  | whole allow, decided by the link, non-persistent               | 5, 9    |
| Repeated text (`echo a; echo a`), `echo a` named                         | both settled                                                   | 5       |
| Non-head unit named                                                      | value and winner facts kept, `also asks` shrinks               | 3, 5    |
| Head unit named                                                          | value, rule rebuilt; `runs`/`context`/`matched as` dropped     | 3, 5    |
| Remaining units suggest no pattern                                       | `sessionApproval`/`sessionLabel` dropped; `narrowedGrants: []` | 5, 7, 9 |
| Forwarded details (no `sessionLabel`, non-null `value`)                  | label stays absent, `value` replaced                           | 5       |
| Two links each narrowing                                                 | the second sees the first's narrowed ask                       | 9       |
| `allow_units` on an excluded surface                                     | capped to `defer`                                              | 9       |
| Decision not session-scoped after narrowing                              | no `narrowedGrants`                                            | 9       |
| No link narrows                                                          | decision byte-identical (no `narrowedGrants` key)              | 9       |
| Malformed `narrowedGrants` on the wire                                   | read as `[]`                                                   | 8       |
| Serving whole-session grant on a narrowed ask                            | only narrowed patterns recorded; response carries none         | 8, 9    |
| Child-scope session grant on a narrowed forwarded ask                    | response carries `narrowedGrants`; child records only them     | 8       |
| Secret assignment among the allowed units                                | masked in `authorizer_units_allowed`                           | 9       |

## Module-Level Changes

- `src/types.ts`: `AskingBashUnit.matchedPattern?`.
- `src/handlers/gates/bash-command.ts`: `withAskingUnits` stamps it (conditional spread, absent when the check has none).
- `src/presentation/tool-ask-payload.ts`: extract `otherAskingUnits(commands, value)`; add `narrowBashAskPayload`.
- `src/authority/ask-narrowing.ts` (new): `narrowAsk`, `NarrowedAsk`.
- `src/authority/authorizer.ts`: the `allow_units` member and its doc.
- `src/authority/authorizer-chain.ts`: `decideFromVerdict` becomes a step function returning `decided | continue`; the `allow_units` case; `withNarrowedGrants`.
- `src/authority/delegation-envelope.ts`: cap `allow_units` like `allow`.
- `src/authority/permission-dialog.ts`: `PermissionPromptDecision.narrowedGrants?`.
- `src/policy/permission-gate.ts`: `sessionGrant: { width, grants? }`.
- `src/handlers/gates/runner.ts`: record the decision's grants when present.
- `src/authority/permission-forwarding.ts`: `ForwardedPermissionResponse.narrowedGrants?`.
- `src/authority/forwarding-io.ts`: asking-unit guard and copy read `matchedPattern`; the response reader reads `narrowedGrants` (malformed → `[]`, reusing `asApprovalGrant`).
- `src/authority/forwarded-request-server.ts`: `applyGrantScope` and `recordForwardedDecision`.
- `src/logging/command-redaction.ts`: `allowedUnits`, `remainingUnits` join `COMMAND_BEARING_LOG_KEYS`.
- `test/helpers/prompt-details-fixtures.ts`: `makeBashChainPromptDetails`.
- Docs:
  - `docs/decisions/0007-model-judge-authorizer-chain-adr.md`: §9 amendment (the partial verdict, narrowing, the grant's path back, the version-skew reading), the `amended:` frontmatter date and a Status line, both from `date -u +%Y-%m-%d`.
  - `docs/configuration.md`: an `authorizer_units_allowed` row in the review-records table, and the verdict in the extension-authors paragraph.
  - `docs/glossary.md`: `### Verdict` lists `allow_units`; `### Asking unit` says a link may settle some.
  - `docs/cross-extension-api.md`: the `registerAuthorizer` bullet's verdict list.
  - `docs/session-approvals.md` § Chained commands: a link that settles part of the chain narrows the prompt and its session option.
  - `docs/architecture/architecture.md`: the verdict-range prose and the ASCII chain diagram in § the authorizer chain; module-tree entries for `authorizer.ts`, `authorizer-chain.ts`, `delegation-envelope.ts`, `ask-narrowing.ts` (new), `tool-ask-payload.ts`, `permission-forwarding.ts`, `forwarding-io.ts`, `forwarded-request-server.ts`, `permission-gate.ts`, `runner.ts`, `bash-command.ts`, `command-redaction.ts`.
  - `README.md` line 207: the envelope sentence covers a partial allow.
- Predicted unchanged:
  - `src/policy/serving-policy.ts`: reads `command`, `spellings`, `floor` only.
  - `src/authority/approval-escalator.ts`: `relayDecision` spreads the response, so `narrowedGrants` flows once the reader emits it (step 8 pins it with a test).
  - `src/authority/local-user-authorizer.ts`, `src/service/permission-ui-prompt.ts`: render whatever details they receive.
  - `src/authority/authorizer-selection.ts`: composes the chain; its contract is unchanged.
  - `src/authority/permission-prompter.ts`: returns the chain's decision untouched; its log entries keep the original details (Non-Goals).
  - `src/presentation/dialog-renderer.ts`, `src/presentation/fact-vocabulary.ts`: render the narrowed payload as they render any.
  - `packages/pi-permission-model-judge`: no exhaustive switch on `AuthorizerVerdict`.
  - `docs/decisions/0011-prompt-presentation-contract.md`: its [#1095] amendment already defines a chain's value as the units still asking.

## Test Impact Analysis

1. New tests the change enables:
   - `narrowAsk` over plain data, local and forwarded shapes, in a new `test/authority/ask-narrowing.test.ts`;
   - the chain over a real `AuthorizerSelection` with a registered link and a stubbed `requestPermissionDecision` (`makeAuthorizerSelectionDeps`, `registerLink`, `makeInvokingPrompter` in `test/helpers/authorizer-fixtures.ts`), wired into the real gate stack of `bash-chain-session-approval.test.ts`.
     That file's existing `sessionApprovingGate` stubs `AskEscalator.escalate`, which sits above the chain, so the new case builds its own harness and the existing tests stay as they are.
2. Redundant tests: none.
3. Kept as is: `authorizer-chain.test.ts`'s allow/deny/defer cases; `composition-root.test.ts`'s forwarded chain request (the [#1030] contract, updated in step 2 only for `matchedPattern`).

## Invariants at risk

- **ADR 0007 §5: a link never exceeds the operator's policy.**
  Step 9's envelope test returns `allow_units` on a `path` ask and asserts `defer`.
- **A link's grant is non-persistent.**
  Step 9 asserts a settled `allow_units` decides `state: "approved"`, never a session state.
- **[#1033]: a session grant approves only the units it names.**
  Step 9's integration test approves the narrowed ask for the session and asserts the session rules hold `bash:git commit *` alone.
- **[#1030]: a forwarded ask carries every asking unit and is answered once.**
  Narrowing happens only where the chain runs; the child's request is unchanged.
  `composition-root.test.ts`'s forwarded chain test keeps pinning it (step 2 adds `matchedPattern` to its expected units).
- **An ask no link narrows is unchanged.**
  Step 9 asserts the chain's decision `toStrictEqual` the terminal's when every link defers, so a stray `narrowedGrants` key fails; step 7 asserts the runner records the descriptor's approval when the decision carries none.
- **ADR 0011 §3: the core is never dropped.**
  The narrowed payload's `also asks` lines are rendered by the unchanged `coreFacts`; the dropped `runs`/`context`/`matched as` lines of a new head unit are the operator's decision, recorded in Non-Goals and the ADR 0007 amendment.

## TDD Order

1. **`refactor(pi-permission-system): split a chain's asking units into the value and the others once`**
   - Extract `otherAskingUnits(commands, value)` from `otherAskingUnitsFact` in `tool-ask-payload.ts`, so `narrowBashAskPayload` (step 3) shares the "drop the first match, absent when empty" rule.
   - Verify: `test/presentation/tool-ask-payload.test.ts` stays green (its `echo a; echo a` case pins the rule); no test changes.
2. **`refactor(pi-permission-system): carry each asking unit's own matched rule`**
   - Red: `bash-command.test.ts` chain cases expect `matchedPattern` on each unit (the ten `askingUnits` `toStrictEqual` assertions at lines ~1064–1163 gain it); `forwarding-io.test.ts`: a unit's `matchedPattern` round-trips, and a non-string one drops the intent.
   - Green: the type, `withAskingUnits`, the guard and `copyAskingUnits`; update `composition-root.test.ts`'s two forwarded `askingUnits` expectations in the same commit.
   - Killing mutations: delete the stamp in `withAskingUnits` (kills the bash-command tests); drop the field in `copyAskingUnits` (kills the round-trip); accept any type in the guard (kills the malformed test).
3. **`refactor(pi-permission-system): rebuild a bash ask's payload for the units still asking`**
   - Red, `tool-ask-payload.test.ts` `describe("narrowBashAskPayload")`: head unchanged keeps `executedUnit`/`commandContext` and shrinks `otherAskingUnits`; head changed takes the unit's command and rule and nulls the other three facts; one remaining unit leaves no `otherAskingUnits` key (`toStrictEqual`); evidence unchanged.
   - Green: the function.
     Typed `refactor:` because no consumer calls it until step 9.
   - Killing mutations: keep `payload.request.matchedPattern` when the head changes (kills the head-changed test); rebuild facts even when the head is unchanged (kills the head-unchanged test).
4. **`test(pi-permission-system): build a bash chain ask's details from the gate's own builders`**
   - `makeBashChainPromptDetails(units, overrides?)` in `test/helpers/prompt-details-fixtures.ts`, assembled from `describeToolGate` (or `buildToolAskPayload` plus `suggestBashChainSessionPatterns`) so its payload, `accessIntent`, `sessionApproval`, and `sessionLabel` agree; a forwarded variant drops `sessionLabel` and `command` and sets `value`.
   - Verify: one sanity test that the fixture's `otherAskingUnits` and `askingUnits` agree.
5. **`refactor(pi-permission-system): narrow an ask to the units a link left undecided`**
   - Red, new `test/authority/ask-narrowing.test.ts`, one `describe` per outcome: every row of the edge-case table marked step 5, asserting the full narrowed details with `toStrictEqual` for the local and forwarded fixtures.
   - Green: `src/authority/ask-narrowing.ts`.
     Typed `refactor:` because no consumer calls it until step 9.
   - Killing mutations:
     - filter by the first match only; the repeated-text case reads `narrowed`, not `settled`;
     - keep the original `sessionApproval`; the grants assertion fails;
     - set `sessionLabel` unconditionally; the forwarded case gains a key;
     - skip the `command`/`value` replacement; the display-override assertions fail;
     - keep the original `matchValues`; the access-facts assertion fails.
6. **`refactor(pi-permission-system): let a chain step carry the ask it continues with`**
   - `decideFromVerdict` becomes a step returning `{ kind: "decided"; decision } | { kind: "continue"; details }`, with `defer` continuing on the same details; the loop carries `current`.
     This prepares step 9's single added `case`.
   - Verify: `authorizer-chain.test.ts` green; no test changes.
7. **`refactor(pi-permission-system): record the grants a narrowed answer covers`**
   - Red:
     - `permission-gate.test.ts`: a session decision with `narrowedGrants` yields `sessionGrant.grants`; one without yields no `grants` key; `[]` is kept as `[]`;
     - `runner.test.ts`: an escalation answering with `narrowedGrants` records exactly those grants at the chosen width; one without records the descriptor's approval.
   - Green: the decision field, `applyPermissionGate`, the runner's step 6.
     Typed `refactor:` because no producer sets the field until step 9.
   - Killing mutations: record the descriptor's approval unconditionally (kills the runner test); treat `[]` as absent (kills the empty case).
8. **`refactor(pi-permission-system): carry narrowed grants on the forwarding response`**
   - Red:
     - `forwarding-io.test.ts`: `narrowedGrants` round-trips; a malformed list reads `[]`; absent stays absent;
     - `forwarded-request-server.test.ts`, with an escalator answering a stubbed decision: a whole-session grant carrying `narrowedGrants` records only those and writes a response without them; `[]` records nothing and writes no `session_recorded` entry; a child-scope grant writes them onto the response;
     - `approval-escalator.test.ts`: a response carrying `narrowedGrants` yields a decision carrying them.
   - Green: the response type, the reader, `applyGrantScope`, `recordForwardedDecision`.
   - Killing mutations: drop the reader's copy (kills the round-trip and escalator tests); read a malformed list as absent (kills the malformed test); ignore `decision.narrowedGrants` in `applyGrantScope` (kills the serving test).
9. **`feat(pi-permission-system): an authorizer link can allow part of a bash chain and leave the rest to the prompt`**
   - Red:
     - `authorizer-chain.test.ts` `describe("a partial allow")`: the terminal receives the narrowed details; a second link sees the first's narrowed ask; a settled ask is allowed by the link with `state: "approved"`; an unmatched or non-chain ask defers; `narrowedGrants` stamped on a session-scoped decision, `[]` when no pattern remains, absent when not session-scoped; all-defer decision `toStrictEqual` the terminal's; the `authorizer_units_allowed` record names link, allowed, and remaining units.
     - `delegation-envelope.test.ts`: `allow_units` on a `path` ask becomes `defer`; on `bash` it passes.
     - `command-redaction.test.ts`: `maskCommandFields({ allowedUnits: ["API_KEY=sk-x"] })` masks it, and `remainingUnits` likewise.
     - `bash-chain-session-approval.test.ts` `describe("a link that allows part of a chain")`, with a real `AuthorizerSelection` and a link allowing plain assignments, config `{"*": "allow", bash: {"*": "ask"}}`, command `F="a/b.txt c/d.txt" && git commit --dry-run -m x -- $F`:
       - the dialog stub receives value `git commit --dry-run -m x -- $F`, no `otherAskingUnits`, and the label `Yes, allow bash "git commit *" for this session`;
       - approving for the session leaves the session rules `["bash:git commit *"]`;
       - re-running the command prompts nothing (the link settles the assignment, the grant covers `git commit`).
     - `forwarded-request-server.test.ts`, with a real `AuthorizerSelection` and the same link: the serving dialog receives the narrowed payload, and a whole-session grant records only the narrowed pattern.
   - Green: the verdict member, the chain's `allow_units` case and `withNarrowedGrants`, the envelope cap, the two log keys.
   - Killing mutations:
     - chain: treat `allow_units` as `defer` (kills the narrowing and integration tests);
     - chain: skip `withNarrowedGrants` (kills the stamping and the integration grant assertion);
     - envelope: cap only `kind === "allow"` (kills the envelope test);
     - redaction: remove `allowedUnits` from `COMMAND_BEARING_LOG_KEYS` (kills the masking test).
   - The final commit paragraph carries:

     ```text
     Refs #1101

     Co-authored-by: Raymond Neilson <222078815+rneilson-cerby@users.noreply.github.com>
     ```

10. **`docs(pi-permission-system): document a link's partial allow over a bash chain`**
    - Every doc in Module-Level Changes; the ADR amendment dated from `date -u +%Y-%m-%d`.
    - Verify: `pnpm exec rumdl check` on each file; grep `docs/` and `README.md` for `allow | deny | defer` and confirm every hit now names the partial verdict or is a historical quote.

## Risks and Mitigations

- **Version skew: an older child reading a newer serving node's response.**
  Its allowlisted reader drops `narrowedGrants`, so a child-scope session grant on a narrowed forwarded ask records the full descriptor approval, which includes the patterns of units the link accepted.
  Accepted residual, recorded in the ADR amendment: it needs a newer serving node, an older child, a narrowing link, and the child scope together, and the extra patterns are units the operator's link accepts anyway.
- **A link naming units by text it did not read from the ask.**
  An unmatched name is ignored, and a verdict that matches nothing defers; a link can never settle a unit the ask does not list.
- **A link settling a floored unit (`sudo rm x`).**
  No wider than a link's whole `allow` on the same bash ask, which the envelope already lets through on the `bash` surface.
- **Secrets in the review record.**
  Both unit lists are masked as command-bearing keys (step 9).
- **The prompter's `approved` entry names the original winner while the human approved the narrowed head.**
  The `authorizer_units_allowed` record on the same `requestId` says what narrowed it; the gate-level records are unchanged by design (Non-Goals).

## Open Questions

- None; [#1131] carries the serving-node narrowing.

[#1030]: https://github.com/gotgenes/pi-packages/issues/1030
[#1033]: https://github.com/gotgenes/pi-packages/issues/1033
[#1095]: https://github.com/gotgenes/pi-packages/issues/1095
[#1129]: https://github.com/gotgenes/pi-packages/issues/1129
[#1131]: https://github.com/gotgenes/pi-packages/issues/1131
