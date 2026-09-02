---
issue: 813
issue_title: "pi-permission-system: let a bash session approval choose its direction width"
---

# The user chooses a session grant's direction width

## Release Recommendation

**Release:** ship independently

Phase 14's `Release batches` subsection lists Step 11 under "Independently releasable" with the rationale `feat:` — a new prompt affordance the user acts on.
It belongs to no batch: the affordance relieves a prompt the moment it lands, and nothing else in the phase waits on it.

## Problem Statement

Since [#807] a bash gate proves an effect per path token, and since [#810] a session approval records each pattern on the surface its own proof named.
That is correct under [ADR 0013](../decisions/0013-permission-policy-model.md) §3–§4 — the two directions are independent bits, not tiers — and it costs a prompt in the read-after-write flow:

1. `echo hello > /tmp/out.txt` — the redirect proves a write, so the grant lands on `external_directory_write`.
2. `cat /tmp/out.txt` — a read is the other bit, so the write grant does not cover it and the gate asks again.

The user has no way to say "and reads too" at the moment they answer, so the only way past the second prompt is to answer it.
Pinned today by the `the read/write axis narrows a session grant (#807)` block in `test/handlers/external-directory-session-dedup.test.ts`.

The remedy is an affordance, not a policy change: `SessionRules.approve` already sugar-expands a bare family key onto both directional members, so "both directions" needs no new expansion machinery — only a way for the prompt to select it, and a way for that selection to reach the site that records the grant.

## Goals

- The ask prompt offers a **both-directions** session grant beside the proven-direction one, whenever the ask's approval is widenable.
- The narrow, proven-direction grant stays the default: a user who never notices the second option is never granted more than the prompt named.
- The chosen width reaches `GateRunner`'s recording site, and rides the forwarded-permission response so a subagent's ask records at the width the parent's human chose.
- Both session rows name the direction and the target, so the two options contrast on a stated axis.
- The forwarded whole-session scope label stops naming one grant out of several — the residual [#810]'s plan deferred here.
- The review log records which width was chosen.

This change is **not breaking**.
It adds one optional field to the decision and one to the forwarded response, changes no default, and alters no resolution the existing surfaces produce.
Suggested commit types are `refactor:` / `fix:` / `feat:` / `docs:` accordingly — no `!`.

## Non-Goals

- **Widening the session-approval *pattern*** — [#604] asks for a broader glob (repo root, N levels up).
  That is a different axis and a different decision; this change touches only the direction.
- **A config knob for the affordance.**
  The width option is offered whenever the ask qualifies; there is no setting to suppress or pre-select it, and none was asked for.
- **A new `PermissionDecisionState` value.**
  Verified against the published tag: `readForwardedPermissionResponse` at `pi-permission-system-v30.0.0` gates on `isPermissionDecisionState(parsed.state)` and returns `null` for an unrecognized value, so a skewed child would ignore the response and poll to the full `forwardingTimeoutMs` (ten minutes) rather than lose one field.
  The width therefore travels as an optional orthogonal field.
- **Mixed-direction asks.**
  When one ask's grants name both a read and a write (only `bash-external-directory.ts` can produce that), no width option is offered and today's behavior is preserved.
  A label naming a single direction would be false, and a label naming both would describe the widened grant rather than the narrow one.
- **A distinct bus resolution.**
  The `permissions:decision` event keeps `user_approved_for_session` at either width.
  ADR 0011 §6 makes that channel the narrowest renderer, and the width is a property of the grant recorded locally, not of the verdict.
- **Non-directional surfaces.**
  `bash`, `mcp`, `skill`, and the per-tool surfaces carry no capability axis, so they show four options exactly as today.
- **[#751]** — the `select`/`input` fallback's lack of a route to the complete request is untouched; the fallback gains the width option and nothing else.
- **An ADR amendment.**
  ADR 0013 §4 already makes the bare family key a policy source's legal spelling, and §9 already binds a session approval to that rule; ADR 0011's row budget governs the payload render, not the option list the component appends after it.

## Background

### Where a session grant is built, chosen, and recorded

Four gates produce a directional `SessionApproval`, each through `capabilitySurfaceForEffect` / `capabilitySurfaceForTool` (`src/access-intent/path-surfaces.ts`):

| Gate                               | Surface family       | Grants per ask       |
| ---------------------------------- | -------------------- | -------------------- |
| `gates/path.ts`                    | `path`               | 1                    |
| `gates/external-directory.ts`      | `external_directory` | 1                    |
| `gates/bash-path.ts`               | `path`               | 1                    |
| `gates/bash-external-directory.ts` | `external_directory` | 1 per uncovered path |

The affordance itself is decided in exactly one place: `buildRequestOptions` (`src/authority/local-user-authorizer.ts`) already reads `details.sessionApproval.grants` to decide whether to offer the forwarded scope step.
No gate changes.

The chosen width is applied in exactly one place: `GateRunner.runDescriptor` step 6 (`src/handlers/gates/runner.ts`), which calls `recorder.recordSessionApproval(descriptor.sessionApproval)`.

### Measured: how often the affordance would appear

Scanned this machine's review log (`~/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl`), deduplicated by `requestId` over the window since the first directional entry (2026-08-27T01:45:50Z, when [#807] landed) through 2026-09-02:

| Ask surface                        | Distinct asks | Share |
| ---------------------------------- | ------------- | ----- |
| `external_directory_read`          | 40            | 37.4% |
| `bash`                             | 51            | 47.7% |
| `external_directory` (bare family) | 16            | 15.0% |
| `external_directory_write`         | 0             | 0%    |
| `path_read` / `path_write`         | 0             | 0%    |
| **Total**                          | **107**       |       |

Two facts follow.
The affordance would appear on 37.4% of asks — frequent enough that its row cost is real.
And the issue's own motivating example did not occur in the window: every directional ask was read-proven, so the widening on offer is the mirror case — a read grant that a later write would not cover.
That measurement is what settled the symmetry question below; it is scoped to this commit and this machine's usage, and is not a claim about the population.

### Constraints from AGENTS.md and the package skill

- A bare family key is load-time sugar and `SessionRules.approve` expands it the same way a config key is expanded — pinned by `test/session-rules.test.ts` "covers both directions when evaluated, so an approval is not half-granted".
  Widening therefore means naming the family surface, never adding a second rule shape.
- The family vocabulary lives in `src/access-intent/path-surfaces.ts` and derives the four surface names from a family set plus a suffix list, so each name is spelled exactly once.
  The new direction word must derive from that same list, not from a second literal.
- The published `PromptPermissionDetails` reaches `ForwardedSessionApproval` from the declaration bundle; this change adds no field there, so no public type moves.
- `docs/architecture/architecture.md` inline-describes `permission-gate.ts` as "`canGrantForSession` in, `forSession` out"; the preparatory step below changes that sentence and must update the module-tree entry in the same commit.

### Adjacent open work

- [#604] (widen the *pattern*) wants an affordance in the same prompt region.
  This plan adds one option row, keyed `b`, and leaves `y`/`s`/`n`/`r` untouched, so a later pattern-width affordance has room and a precedent to follow.
- PR [#757] (`Villoh`, open) wraps `permission-prompt-component.ts` in a bordered panel.
  It changes no decision model and carries no diagnosis for this issue, but it edits the same file — a rebase cost, not a design input.

## Design Overview

### The operator's decisions

Settled at a clarification gate, with the measurement above as the substance:

1. **Shape** — a conditional fifth option row, hotkey `b`, placed after `s`, so a widenable ask renders `y, s, b, n, r`.
   One keystroke, no extra step, and it composes with the existing forwarded scope step (`b` reaches it exactly as `s` does).
2. **Symmetry** — offered on any directional ask, read-proven or write-proven.
   The wide width is exactly what a pre-[#807] grant had, so this restores it by choice rather than by default.
3. **Labels** — both session rows name the direction and the target, with a count when there are several grants.

```text
  (y) Yes
▶ (s) Yes, allow writes to "/tmp/*" for this session
  (b) Yes, allow reads and writes to "/tmp/*" for this session
  (n) No
  (r) No, provide reason
```

### The offer rule

A width option is offered when **every** grant in the approval is directional **and** they all name the same direction.

This is the precise reading of the issue's "when a gate proves a single direction".
A single-grant ask (three of the four gates) always qualifies when directional.
A multi-path bash external-directory ask qualifies when its paths agree, and keeps today's behavior when they do not.

### Types

```typescript
// src/approval-grant.ts — the grant vocabulary's home
export type SessionGrantWidth = "proven" | "family";

/** The direction every grant proves, or null when they disagree or any is non-directional. */
export function provenDirectionOf(
  grants: readonly ApprovalGrant[],
): CapabilityDirection | null;

// src/access-intent/path-surfaces.ts — derived from the existing suffix list
export type CapabilityDirection = "read" | "write";
export function capabilityDirectionOf(surface: string): CapabilityDirection | null;

// src/session-approval.ts — Tell-Don't-Ask: the value object widens itself
export class SessionApproval {
  /** `"proven"` returns this; `"family"` returns a copy with each grant's surface folded to its family. */
  atWidth(width: SessionGrantWidth): SessionApproval;
}

// src/authority/permission-dialog.ts — orthogonal to `state`, absent means "proven"
export type PermissionPromptDecision = {
  approved: boolean;
  state: PermissionDecisionState;
  sessionGrantWidth?: SessionGrantWidth;
  // …unchanged fields
};

export interface RequestPermissionOptions {
  sessionLabel?: string;
  /** Present iff the ask is widenable; its label is the `b` row. */
  sessionWidth?: { label: string };
  sessionScope?: { subagentLabel: string; servingSessionLabel: string };
}

// src/permission-gate.ts — one field, no illegal state (see the preparatory step)
export type PermissionGateResult =
  | { action: "allow"; decidedBy: DecisionSource; sessionGrant?: { width: SessionGrantWidth } }
  | { action: "block"; decidedBy: DecisionSource; reason: string };

// src/authority/permission-forwarding.ts — optional for skew tolerance
export type ForwardedPermissionResponse = {
  sessionGrantWidth?: SessionGrantWidth;
  // …unchanged fields
};
```

### The consumer's call site

The recording site reads as one sentence — the runner holds a width and an approval and tells the approval to produce itself at that width:

```typescript
// GateRunner.runDescriptor, step 6
const sessionGrant =
  gateResult.action === "allow" ? gateResult.sessionGrant : undefined;
if (sessionGrant && descriptor.sessionApproval) {
  this.recorder.recordSessionApproval(
    descriptor.sessionApproval.atWidth(sessionGrant.width),
  );
}
```

The runner never inspects a grant's surface, and `SessionRules` is unchanged: it still records each grant on the surface the grant names, and the family name it now sometimes receives is the sugar it already expands.

The offer site is symmetrical — it asks the grant vocabulary a question and hands the labeller the answer:

```typescript
// buildRequestOptions, src/authority/local-user-authorizer.ts
const grants = details.sessionApproval?.grants ?? [];
const direction = provenDirectionOf(grants);
const width = direction
  ? buildDirectionalSessionLabels(direction, describeGrantTarget(grants))
  : null;
```

### The dialog model's width lifecycle

`PromptViewState` gains `grantWidth: SessionGrantWidth`, and its whole lifecycle is one step's business:

- **Initialized** to `"proven"` by `initialPromptState`.
- **Set** at `commit`: `"proven"` for key `s`, `"family"` for key `b`.
- **Read** when the decision is emitted — directly on `commit` for a non-forwarded ask, or at the scope step's `confirm` for a forwarded one, where it rides alongside `approved_for_session` / `approved_for_serving_session`.
- **Reset** to `"proven"` when the scope or reason step cancels back to the decision step, so a backed-out `b` cannot leak into a following `s`.

The visible key set becomes a function of `PromptModelConfig`: `["y", "s", …(widthLabel ? ["b"] : []), "n", "r"]`.
`shiftKey` traverses that set, and a hotkey outside it is ignored.

### The `select`/`input` fallback

`requestPermissionDecisionFromUi` (`src/authority/permission-dialog.ts`) is a **third** representation of the option roster — plain label strings for `ui.select()`, not hotkeys — which the Tidy-First assessment correctly flagged as structurally different from the model/component pair.
It is not folded into the same abstraction.
It gains the width label as a fifth string in its existing array when `options.sessionWidth` is set, selects the same `sessionGrantWidth: "family"`, and continues into the scope select exactly as the session option does.

### Skew on the forwarded response

Verified by reading the shipped code, not inferred:

```bash
git show pi-permission-system-v30.0.0:packages/pi-permission-system/src/authority/forwarding-io.ts
```

`readForwardedPermissionResponse` at v30.0.0 validates `approved`, `state`, and `responderSessionId`, then rebuilds an allowlist of known fields.
So:

- **Newer parent → v30.0.0 child:** the extra `sessionGrantWidth` key is dropped on read, and the child records the narrow grant.
- **v30.0.0 parent → newer child:** the field is absent, and the reader's default is `"proven"`.

Both directions degrade to the least-privilege width, and neither rejects the response.
No upgrade ordering is required — which is exactly what a new `state` value would have cost.

### Labels

`src/pattern-suggest.ts` keeps the label vocabulary:

```typescript
export function describeGrantTarget(grants: readonly ApprovalGrant[]): string;
// 1 grant → `"/tmp/*"` (quoted); N grants → `3 paths`

export function buildDirectionalSessionLabels(
  direction: CapabilityDirection,
  target: string,
): { sessionLabel: string; widenedLabel: string };
// → `Yes, allow writes to "/tmp/*" for this session`
// → `Yes, allow reads and writes to "/tmp/*" for this session`
```

`buildForwardedScopeLabels` is reshaped to take the grants rather than one grant's `(surface, pattern)`, resolving [#810]'s deferred residual: it names the shared **family** (`external_directory`) rather than a directional member, and the target description rather than `grants[0].pattern`.
The family, not the member, is what stays true whichever width the human picks — the scope labels are built before the dialog runs and cannot vary with a choice made inside it.

A widenable ask never carries `details.sessionLabel`: only `gates/tool.ts` sets one, and its surfaces are tool names, which carry no capability axis.
`buildRequestOptions` prefers the grant-derived labels when the ask is widenable and falls through to today's behavior otherwise.

## Module-Level Changes

### Production

| File                                           | Change                                                                                                                                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/access-intent/path-surfaces.ts`           | Add `CapabilityDirection` and `capabilityDirectionOf`, derived from the existing suffix list so the direction words are spelled once.                                                                      |
| `src/approval-grant.ts`                        | Add `SessionGrantWidth`, `widenGrant`, and `provenDirectionOf`.                                                                                                                                            |
| `src/session-approval.ts`                      | Add `atWidth(width)`.                                                                                                                                                                                      |
| `src/pattern-suggest.ts`                       | Add `describeGrantTarget` and `buildDirectionalSessionLabels`; reshape `buildForwardedScopeLabels` to take `readonly ApprovalGrant[]`.                                                                     |
| `src/permission-gate.ts`                       | Replace the allow arm's `forSession?: true` with `sessionGrant?: { width: SessionGrantWidth }`; read `decision.sessionGrantWidth` when the human granted for the session.                                  |
| `src/handlers/gates/runner.ts`                 | Read `gateResult.sessionGrant` and record `descriptor.sessionApproval.atWidth(...)`.                                                                                                                       |
| `src/authority/permission-dialog.ts`           | Add `sessionGrantWidth` to `PermissionPromptDecision`; add `sessionWidth` to `RequestPermissionOptions`; offer the fifth option in the `select` fallback.                                                  |
| `src/authority/permission-prompt-decision.ts`  | `PromptKey` gains `"b"`; export the visible-key order as a function of `PromptModelConfig`; add `widthLabel` to `PromptModelConfig`, `grantWidth` to `PromptViewState`, and a `b` entry to `OPTION_VERBS`. |
| `src/authority/permission-prompt-component.ts` | Delete its local `OPTION_ORDER`, import the model's; render the `b` row and its label; pass `widthLabel` through `presentInlinePermissionPrompt`.                                                          |
| `src/authority/local-user-authorizer.ts`       | `buildRequestOptions` composes `sessionLabel`, `sessionWidth`, and `sessionScope` instead of returning one of them.                                                                                        |
| `src/authority/permission-prompter.ts`         | Record `sessionGrantWidth` on the terminal review entry.                                                                                                                                                   |
| `src/authority/permission-forwarding.ts`       | Add `sessionGrantWidth?: SessionGrantWidth` to `ForwardedPermissionResponse`.                                                                                                                              |
| `src/authority/forwarding-io.ts`               | Write the field; reconstruct it on read behind a value guard that drops an unrecognized value.                                                                                                             |
| `src/authority/forwarded-request-server.ts`    | Write the field into the response JSON; `applyGrantScope` records the serving-node grant at the chosen width.                                                                                              |
| `src/authority/approval-escalator.ts`          | No edit expected — `relayDecision` spreads the response onto the decision — but verified in the step that lands the wire.                                                                                  |

### Documentation

| File                                                     | Change                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/session-approvals.md`                              | "four options" → the conditional fifth; a new section on grant direction and the width choice (also answering [#810]'s second deferred question — yes, the direction is documented now that the user chooses it).                                                                                                                               |
| `docs/configuration.md`                                  | The hotkey table at line 125 gains the `b` row.                                                                                                                                                                                                                                                                                                 |
| `README.md`                                              | The inline hotkey list at line 68 gains `b`.                                                                                                                                                                                                                                                                                                    |
| `docs/decisions/0006-forwarded-grant-scope-selection.md` | Grep for "four-option prompt" — the skew paragraph describes a base prompt whose size is now conditional.                                                                                                                                                                                                                                       |
| `docs/architecture/architecture.md`                      | Module-tree entries for `pattern-suggest.ts`, `approval-grant.ts`, `session-approval.ts`, `permission-gate.ts` (its "`forSession` out" sentence), `local-user-authorizer.ts`, `permission-dialog.ts`, `permission-prompt-decision.ts`, `permission-prompt-component.ts`; Step 11 heading `✅` + its Mermaid node `S11` `✅` + a `Landed:` note. |
| `.pi/skills/package-pi-permission-system/SKILL.md`       | The sentence "A bash session approval is narrowed to the proven direction … (#813 is the affordance to widen it at the prompt)" becomes a statement of the shipped affordance.                                                                                                                                                                  |

### Greps to run before finalizing each step

- `grep -rn 'forSession' packages/pi-permission-system/src packages/pi-permission-system/test packages/pi-permission-system/docs` — the preparatory representation change.
- `grep -rn 'buildForwardedScopeLabels' packages/pi-permission-system/src packages/pi-permission-system/test` — the reshaped signature.
- `grep -rn 'OPTION_ORDER' packages/pi-permission-system/src packages/pi-permission-system/test` — the roster single-sourcing.
- `grep -rln 'state: "approved_for_session"' packages/pi-permission-system/test` — every fixture producing a session decision, which the new optional field must not disturb.
- `grep -rn 'four options\|four-option\|y. approve' packages/pi-permission-system/README.md packages/pi-permission-system/docs .pi/skills/` — the prose that counts the options.

No health-metric row in the Phase 14 table names Step 11, so none is recomputed here.

## Test Impact Analysis

### New tests the change enables

- `capabilityDirectionOf`, `provenDirectionOf`, `widenGrant`, and `SessionApproval.atWidth` are pure and unit-testable directly, including the mixed-direction and non-directional cases that decide whether the option appears at all.
- `buildRequestOptions` becomes testable for the offer rule without driving a dialog.
- The dialog model gains coverage for a conditional key set — previously the roster was a module constant no test could vary.

### Existing tests that must stay green unchanged

The three tests in `the read/write axis narrows a session grant (#807)` (`test/handlers/external-directory-session-dedup.test.ts:147`) drive a real `PermissionSession` + `PermissionResolver` + `SessionRules` with a prompter stub that returns `state: "approved_for_session"` and **no** width field.
They therefore exercise the default path end to end, and their staying green with no edit is the evidence that the default is untouched.
Do not edit them.

`test/session-rules.test.ts`'s `directional sugar expansion` block and `records each grant on its own surface when they disagree` pin the two facts widening depends on: a family surface expands to both members, and each grant keeps its own surface.

### Redundant tests

None.
Nothing this change adds supersedes an existing assertion; every touched test file gains cases rather than losing them.

### The label surface

`describeGrantTarget` and `buildDirectionalSessionLabels` are string functions with a small input domain — one grant, several grants, each direction — and the reshaped `buildForwardedScopeLabels` adds the named-agent and anonymous-agent cases it already covers.
All belong in `test/pattern-suggest.test.ts` beside the existing label tests.

## Invariants at Risk

| Invariant                                                                            | Where it lives                                                                                     | How this plan keeps it                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A session grant is never wider than the direction the prompt named (Step 2, [#807]). | `test/handlers/external-directory-session-dedup.test.ts:147`, three tests over real collaborators. | The default width is `"proven"`; the wide width exists only when a human selects it. The three tests are not edited, and step 4's killing mutation is defined so that hardcoding the family width turns them red. |
| An approval records each pattern on its own surface (Step 10, [#810]).               | `test/session-rules.test.ts:187`; `test/session-approval.test.ts`.                                 | `atWidth("family")` maps each grant individually through `widenGrant`; a mutation returning a single-grant approval is named in step 3.                                                                           |
| A bare family approval covers both directions when evaluated.                        | `test/session-rules.test.ts:106` ("an approval is not half-granted").                              | This is the mechanism widening relies on; it is read, not changed. Step 4's integration test re-establishes it end to end through the gate.                                                                       |
| The pre-[#810] forwarded **request** shape is rejected, not normalized.              | `asForwardedSessionApproval`, `test/authority/forwarding-io.test.ts`.                              | Untouched: this change edits the **response** reader only.                                                                                                                                                        |
| A forwarded ask's `s` reaches the scope step (ADR 0006).                             | `test/authority/permission-prompt-decision.test.ts` scope-step tests.                              | `b` must reach it identically; step 7 names a mutation that drops the carried width at the scope step.                                                                                                            |
| The option list is four rows for a non-widenable ask.                                | New assertion in step 7.                                                                           | Quantitative and cheap: today 4, and 5 only when `sessionWidth` is set. Measured share of asks that would show five: 37.4% (107 distinct asks, 2026-08-27 → 2026-09-02).                                          |

## TDD Order

Steps 1 and 2 are the Tidy-First assessment's Recommended preparatory refactorings, placed ahead of the work each prepares.
Steps 3 through 5 land the mechanism with nothing producing the wide width yet, so the affordance ships in exactly one commit (step 7) and no intermediate commit leaves a user pressing a key that does nothing.

1. **`refactor(pi-permission-system): single-source the prompt's option order`** Both `permission-prompt-decision.ts` and `permission-prompt-component.ts` declare an identical `OPTION_ORDER`.
   Export it from the model (as a function of `PromptModelConfig`, so step 7's conditional key set has one home) and delete the component's copy.
   Prepares: step 7 would otherwise write the conditional-visibility logic twice.
   Tests: the existing model and component suites, unedited.
   Killing mutation: reverse the exported order — the component's row-order assertions must fail, proving the component now reads the model's array.

2. **`refactor(pi-permission-system): give the gate result one session-grant field`** Introduce `SessionGrantWidth` in `src/approval-grant.ts` and replace `PermissionGateResult`'s `forSession?: true` with `sessionGrant?: { width: SessionGrantWidth }`, always `"proven"` for now.
   Update `applyPermissionGate`, `GateRunner`'s two read sites, `test/permission-gate.test.ts`, and the `permission-gate.ts` module-tree sentence in `docs/architecture/architecture.md`.
   Prepares: step 4 would otherwise add a second optional field that can contradict the first.
   Behavior-preserving; the only legal states today (absent, or granted-at-proven) are unchanged.
   Killing mutation: make `applyPermissionGate` set `sessionGrant` regardless of `canGrantForSession` — `permission-gate.test.ts`'s three negative assertions must fail.

3. **`refactor(pi-permission-system): add the grant-width vocabulary`** Add `CapabilityDirection` / `capabilityDirectionOf` (`path-surfaces.ts`, derived from the existing suffix list), `widenGrant` / `provenDirectionOf` (`approval-grant.ts`), and `SessionApproval.atWidth` (`session-approval.ts`).
   Nothing imports them yet, so the commit is `refactor:` however new the code is.
   Tests: `test/access-intent/path-surfaces.test.ts`, `test/session-approval.test.ts`, and a new `test/approval-grant.test.ts` — each direction, a non-directional surface, a single grant, several agreeing grants, several disagreeing grants, an empty list.
   Killing mutations, one per equivalence class:
   - Make `atWidth` return `this` unconditionally → the widened-surface tests in `session-approval.test.ts` fail; the `"proven"` test stays green.
   - Make `provenDirectionOf` return the first grant's direction without checking the rest → the disagreeing-grants test fails; the agreeing-grants test stays green.
   - Make `capabilityDirectionOf` return `"read"` for any surface ending in `_read` without checking the family → the `my_tool_read` case fails.

4. **`refactor(pi-permission-system): record a session grant at the decision's width`** `applyPermissionGate` reads `decision.sessionGrantWidth` into `sessionGrant.width`; `GateRunner` records `descriptor.sessionApproval.atWidth(...)`.
   Still unobservable: no producer emits `"family"` until step 7.
   Tests: `test/permission-gate.test.ts` (a decision carrying `"family"` yields that width, one carrying nothing yields `"proven"`), `test/handlers/gates/runner.test.ts` (`recordSessionApproval` receives family-surfaced grants for a wide decision and directional ones otherwise), and a new case in `test/handlers/external-directory-session-dedup.test.ts` driving a prompter stub that returns `sessionGrantWidth: "family"` — `echo hello > /tmp/out.txt` then `cat /tmp/out.txt` must prompt **once**.
   Killing mutations:
   - Drop the `.atWidth(...)` call, recording the approval unchanged → the new integration test fails while the three [#807] narrowing tests stay green.
     That pairing is the discrimination; a mutation that reddens both would prove nothing.
   - Hardcode `width: "family"` in `applyPermissionGate` → the three [#807] narrowing tests fail.

5. **`refactor(pi-permission-system): carry the grant width on the forwarded response`** Add the optional field to `ForwardedPermissionResponse`, write it in `forwarded-request-server.ts`, reconstruct it behind a value guard in `readForwardedPermissionResponse`, and honor it in `applyGrantScope`.
   Confirm `relayDecision` needs no edit.
   Tests: `test/authority/forwarding-io.test.ts` (round-trip; an unrecognized value is dropped and the response is still accepted; an absent field yields `"proven"`), `test/authority/forwarded-request-server.test.ts` (a whole-serving-session grant at the family width records family-surfaced grants), `test/authority/approval-escalator.test.ts` (the relayed decision carries the width).
   Killing mutations:
   - Omit the field from the response writer → the round-trip test fails.
   - Make the reader accept any string → the unrecognized-value test fails.
   - Make `applyGrantScope` record `SessionApproval.forGrants(grants)` without the width → the serving-node widened test fails.

6. **`fix(pi-permission-system): name every path in a forwarded whole-session scope label`** Add `describeGrantTarget` and `buildDirectionalSessionLabels`; reshape `buildForwardedScopeLabels` to take the grants and name the shared family plus the target description.
   Update its one call site in `local-user-authorizer.ts` in the same commit — the signature change is a compile error otherwise.
   This is [#810]'s deferred residual, and it is user-observable on its own.
   Tests: `test/pattern-suggest.test.ts` (one grant, three grants, named and anonymous agent, both directions), `test/authority/local-user-authorizer.test.ts` (the label reaches the options).
   Killing mutation: make `describeGrantTarget` always quote `grants[0].pattern` → the three-grant test fails; the single-grant test stays green.

7. **`feat(pi-permission-system): offer a both-directions session grant at the ask prompt`** The shipping commit: `PromptKey` gains `"b"`; the visible key set becomes config-derived; `commit` and the scope step carry `grantWidth`; the component renders the row; the `select` fallback gains its fifth string; `buildRequestOptions` composes the three option groups; `PermissionPrompter` records `sessionGrantWidth` on the terminal review entry.
   Tests: `test/authority/permission-prompt-decision.test.ts` (the key set with and without `widthLabel`; `b` commits `"family"`; `b` reaches the scope step and the width survives it; cancelling back to the decision step resets to `"proven"`; nav wraps over five keys and over four), `test/authority/permission-prompt-component.test.ts` (the row is rendered only when offered; the hotkey commits), `test/authority/permission-dialog.test.ts` (the fallback's fifth option; it continues into the scope select), `test/authority/local-user-authorizer.test.ts` (offered for agreeing directional grants; not offered for mixed, non-directional, or absent grants), `test/authority/permission-prompter.test.ts` (the review entry names the width).
   Killing mutations, one per class:
   - Always include `"b"` in the visible set → the not-offered component and model tests fail; the offered ones stay green.
   - Make `commit("b")` omit `sessionGrantWidth` → the model's width test fails; its `state` assertion stays green, which is the point of naming this one.
   - Make the scope step emit a fresh `"proven"` instead of `state.grantWidth` → the forwarded-carry test fails.
   - Make `buildRequestOptions` read `provenDirectionOf([grants[0]])` → the mixed-direction not-offered test fails.

8. **`docs(pi-permission-system): document the session-grant direction width`** All rows in the Documentation table above, including the Step 11 `✅` marks (heading and Mermaid node `S11`) and its `Landed:` note, per the package skill's rule that the step-mark lands in the implementation doc-update commit.
   The `Landed:` note must correct the roadmap's `Outcome:` line: it promised the review log's `decidedBy` would name the chosen width, but `decidedBy` answers *who decided*, and the width is a property of the grant.
   The width is recorded as its own field on the terminal review entry instead.
   Verification: `pnpm exec rumdl check` on every edited markdown file, and `pnpm run lint` for the skill file.

Run `pnpm run check`, `pnpm run lint`, `pnpm -r run test`, `pnpm fallow dead-code`, and `pnpm --filter @gotgenes/pi-permission-system run verify:public-types` before the final handoff.

## Risks and Mitigations

| Risk                                                                                                                           | Mitigation                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A user presses `b` from habit and grants writes they did not intend.                                                           | The narrow row precedes it and the initial highlight is `y`, so `b` is never reachable by a single confirm. `doublePressToConfirm` arms `b` like every other key, and the label states both directions and the target explicitly rather than saying "wider".                                                 |
| Widening a read-proven grant is the larger privilege jump, and the measurement says that is the case that will actually occur. | It is opt-in, per-ask, and session-scoped — never persisted, cleared at `session_shutdown`. It grants no more than the bare family key a user could already write in config, which is the width every pre-[#807] grant had. The symmetry was put to the operator with this measurement in hand.              |
| The width is silently lost across a version-skewed parent/child pair.                                                          | Verified against `pi-permission-system-v30.0.0`'s shipped reader rather than argued: an added key is dropped by the allowlist rebuild and an absent one defaults to `"proven"`, so both skew directions degrade to least privilege and the response is never rejected. Pinned by the reader tests in step 5. |
| A mixed-direction ask shows no width option, and a user reads that as a bug.                                                   | Stated as a Non-Goal here, documented in `docs/session-approvals.md`, and given its own not-offered test in step 7 so the boundary is deliberate rather than incidental.                                                                                                                                     |
| Step 7's edits span the model, the component, and the fallback, where an assertion could pass under both widths.               | Every step names its killing mutation, and step 7's four are chosen one per equivalence class — a mutation that leaves a test green is a finding.                                                                                                                                                            |
| PR [#757] rebases onto a changed `permission-prompt-component.ts`.                                                             | A mechanical conflict in the render function, not a design conflict: the panel wraps the rows this change adds to. Noted for ship time, not addressed here.                                                                                                                                                  |
| The affordance's row cost is misjudged because the option list was assumed to sit under ADR 0011's row budget.                 | It does not: `renderPromptDialog` is budgeted at `promptMaxRows`, and the component appends the option rows after it. The fifth row is additive to the viewport and appears on a measured 37.4% of asks; that is the cost the operator accepted at the gate.                                                 |

## Open Questions

- Whether the width choice should ever have a config default (always-narrow, always-offer-wide, or pre-selected).
  Nothing asks for it, and a default that pre-selects the wide width would defeat the "never granted more than the prompt named" property.
  Deferred until someone asks; not filed.

[#604]: https://github.com/gotgenes/pi-packages/issues/604
[#751]: https://github.com/gotgenes/pi-packages/issues/751
[#757]: https://github.com/gotgenes/pi-packages/pull/757
[#807]: https://github.com/gotgenes/pi-packages/issues/807
[#810]: https://github.com/gotgenes/pi-packages/issues/810
