---
issue: 735
issue_title: "permission-forwarding: requests to dead or blocked parent sessions hang for the hardcoded 10-minute timeout"
---

# Deny a permission prompt nobody answers within `promptTimeoutMs`

## Release Recommendation

**Release:** ship independently

Issue #735 is not a step of any improvement phase.
Phase 15 (token roles and declared effects) is open, and its spine is bash token-role loss; this is an `authority/` prompt-lifecycle change that shares no step's mechanism, the same disposition [#965] and [#907] carried.
It also closes [#931], a third-party feature request parked on this issue's timeout question since 2026-09, so it should not wait behind a batch.

## Problem Statement

The issue was filed by a third party against `@gotgenes/pi-permission-system` 20.10.0.
It reports two scenarios where a subagent's forwarded `ask` blocks for the hardcoded ten-minute `PERMISSION_FORWARDING_TIMEOUT_MS` before auto-denying, at ~10 minutes per `ask` surface and 30+ minutes per child, and makes four suggestions.

Most of it has shipped since, verified against `main` during planning:

| Suggestion                                     | Status                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Configurable timeout                        | Shipped as `forwardingTimeoutMs` (`fc6190de`, first in `pi-permission-system-v25.1.0`), read live per ask                                                                                                                                                                                                               |
| 2. Fast-fail on dead targets (scenario 1)      | Shipped: in-process liveness ([#719]) and the out-of-process serving heartbeat ([#721]); a child whose target is not draining abandons after the 2 s `PERMISSION_FORWARDING_SERVING_GRACE_MS`                                                                                                                           |
| 3. Serve while the parent is in a tool call    | The serving poll is a `setInterval` independent of turn state, and dialogs already render mid-turn (every local ask does). The "live parent, still 10 minutes" symptom matches [#907] (nicobailon/pi-subagents exports `PI_SUBAGENT_PARENT_SESSION` in the root, which withdrew serving), fixed in `24b56a21` / v32.0.0 |
| 4. A timeout message that distinguishes causes | Shipped: the denial is `confirmationUnavailable`, reasons name the session (`Session '<id>' did not answer within 600s`, `… is not serving …`), and `forwarded_permission.response_timed_out` / `no_serving_session` carry `targetSessionId`                                                                            |

What remains is the timeout question the operator tied to this issue when parking [#931]: how long an **unanswered** ask waits, what it resolves to, and whether the operator configures it.
Today a forwarded ask to a live, draining parent whose human is away waits the full `forwardingTimeoutMs` (600 s by default), and a local ask in a root session waits indefinitely. [#931] (Echokovo) asks for a configurable auto-reject that tells the model it timed out; its follow-up comment (aoguai) adds the unattended overnight run, asks that local interactive prompts be covered too, and that the timeout be recorded and off by default.

## Goals

- A new optional config key `promptTimeoutMs`: when set, a permission dialog left unanswered that long after it is **shown** is dismissed and the ask is denied.
- Unset (the default) keeps today's behavior exactly: no timer on any dialog.
  The change is **not breaking**; it ships as `feat(pi-permission-system):`.
- The timeout covers every human-facing ask this node presents: the inline TUI dialog and the `select`/`input` fallback, for local asks and for forwarded asks the node serves.
- A timed-out ask is recorded with its own decider, `{ kind: "unanswered", timeoutMs }`, rendered to the agent as "nobody answered", resolved on `permissions:decision` as the new `prompt_unanswered`, and relayed over the existing forwarding response wire.
- Once the human presses a key in the inline dialog, the clock stops: the window bounds an *unattended* prompt and never cuts off someone mid-answer.

## Non-Goals

- **Allowing on timeout.**
  Deny only (operator decision).
  An automatic allow belongs to the `authorizerChain` seam, where an agent approver answers *before* the dialog: [#472] (case-by-case judge), [#620] (allow-capable adjudicator, ADR 0007 slice 2), PR [#983] (`authorizerTrust`), [#698] (AI bash review).
  No follow-up issue is filed for allow-once, by operator decision.
- **Changing `forwardingTimeoutMs`.**
  It stays the child's transport backstop with its 600 s default; option C (lowering it) was declined because the 2 s liveness fast-fail already covers dead parents and a lower default cuts off a deliberating human.
- **Timing a queued ask.**
  The clock starts at presentation, so an ask waiting in the `AskDialogQueue` behind another dialog is not timed; N unattended asks take about N × `promptTimeoutMs` (estimated).
- **Dismissing a forwarded dialog when its child abandons.**
  When the child's `forwardingTimeoutMs` expires first, the parent's dialog lingers until answered or until its own window expires; that is existing behavior, documented here as a reason to set `promptTimeoutMs` below `forwardingTimeoutMs`.
- **The review-log `resolution` column.**
  `PermissionPrompter` derives it from `confirmationUnavailable`, so a timed-out ask logs `resolution: "confirmation_unavailable"`; the entry's `decidedBy: { kind: "unanswered", timeoutMs }` is what distinguishes it.
  Rederiving the column from `decidedBy` is a separate change.
- **A live countdown.**
  The inline dialog names the window in its hint row as static text; the fallback gets no countdown (Pi's `select` `timeout` option would be a second clock racing this one).
- **The `/permission-system` settings modal.**
  `promptTimeoutMs` is file-configured only, like `forwardingTimeoutMs`.
- **[#722].**
  Its root-cause comment is the [#907] diagnosis, already fixed; whether to close it is housekeeping outside this plan (see Open Questions).

## Background

- `LocalUserAuthorizer.authorize` (`src/authority/local-user-authorizer.ts`) admits every human-facing ask through the session's `AskDialogQueue` ([#965]); `present()` runs inside the queued region, emits `permissions:ui_prompt`, and calls the injected `requestPermissionDecision`.
- `requestPermissionDecision` (`src/authority/permission-prompt-component.ts`) is the mode dispatcher: `tui` → `presentInlinePermissionPrompt` (`ctx.ui.custom`), else the `select`/`input` fallback `requestPermissionDecisionFromUi` (`src/authority/permission-dialog.ts`).
  It is the one site that attributes a human answer (`decidedBy: { kind: "user", via }`), per its architecture-doc constraint.
- `PromptPreferences` is read live per prompt through `AuthorizerSelection`'s `getPromptPreferences` thunk built in `src/index.ts`, and spread into `PermissionPromptView`.
- `DecisionSource` (`src/authority/decision-source.ts`) is the stamped provenance; three exhaustive `switch`es consume it with no `default`: `narrowSource` (the tolerant on-disk guard), `resolutionFor` (`decision-resolution.ts`), and `renderRefusal` (`src/presentation/agent-renderer.ts`).
  `PermissionDecisionResolution` (`src/service/permission-events.ts`) is public, exported through `dist/public.d.ts`.
- `ForwardedRequestServer` writes the escalated decision's `decidedBy` to the response file and broadcasts `resolutionFor(decidedBy, …)`; the child reads it back through `asDecisionSource` and relays it as `{ kind: "forwarded", decision }`.
- Pi 1.0.0 (the pinned devDependency) verified in `dist/modes/interactive/interactive-mode.js`:
  - `showExtensionSelector` honors `opts.signal`, resolving `undefined` and hiding the selector on abort; the RPC mode's dialog helper does the same.
  - `showExtensionCustom` hands the factory a `close(result)` guarded by a `closed` flag; it restores the editor (`editorContainer.clear()` + the saved editor) and disposes the component.
- AGENTS.md / package-skill constraints that apply:
  - A new config field goes through `config-schema.ts` → `pnpm run gen:schema` → `extension-config.ts` → `mergeUnifiedConfigs()` (number scalars), and is not added to `DEFAULT_EXTENSION_CONFIG`.
  - `decidedBy` is stamped at the deciding site, never inferred.
  - Default to least privilege: the only timeout action is deny.

## Design Overview

### The flow, with the change placed

```text
local gate ask ─┐
                ├─► AskDialogQueue ─► LocalUserAuthorizer.present ─► requestPermissionDecision
forwarded ask ──┘    (unchanged:        (unchanged)                     │  opens AnswerWindow(promptTimeoutMs)   ◄── new
 (poll tick)          FIFO, untimed)                                    │  arm(signal): inline custom / select   ◄── honor signal
                                                                        ▼
                                              human answers → close window → attribute { user, via }
                                              window expires → abort → arm resolves undefined
                                                             → window.expiredDecision() = { unanswered, timeoutMs }
```

A forwarded ask's dialog runs in the serving node, so the serving node's `promptTimeoutMs` governs it and the `unanswered` decision travels back on the existing response wire.
The child's own `forwardingTimeoutMs` deadline is untouched.

### `AnswerWindow` (new, `src/authority/answer-window.ts`)

A small collaborator owning the window's whole lifecycle: set at presentation, cleared on a human answer or on the first keystroke, read when the arm resolves.

```typescript
export class AnswerWindow {
  /** Opens a window, or a closed null window when `timeoutMs` is undefined. */
  static open(timeoutMs: number | undefined): AnswerWindow;
  /** Aborts when the window expires; `undefined` for the null window. */
  readonly signal: AbortSignal | undefined;
  /** A human answered: stop the clock. Idempotent. */
  close(): void;
  /** The human pressed a key: stop the clock without settling anything. */
  engage(): void;
  /** The decision for an ask this window dismissed: deny, `unanswered`. */
  expiredDecision(): PermissionPromptDecision;
}
```

Lifecycle, stated once:

- **Set:** `open(ms)` creates an `AbortController` and a `setTimeout(ms)` whose callback aborts it; the timer is `unref()`ed so a pending window never holds the process open.
- **Cleared:** `close()` and `engage()` both `clearTimeout`; after either, the signal never aborts.
- **Read:** the dispatcher reads `expiredDecision()` only when an arm resolved `undefined`, which an arm does only on abort.
  `expiredDecision()` returns `{ approved: false, state: "denied", confirmationUnavailable: true, decidedBy: { kind: "unanswered", timeoutMs } }`; on the null window it throws, since reaching it would mean an arm resolved `undefined` with no window open, and a thrown escalation fails closed at the gate boundary.

The dispatcher's call site (after the step 1 tidy collapses it to one attribution):

```typescript
const window = AnswerWindow.open(view.promptTimeoutMs);
const { ask, via } = chooseSurface(view, title, payload, options);
try {
  const answer = await ask(window.signal);
  return answer === undefined ? window.expiredDecision() : attributeToHuman(answer, via);
} finally {
  window.close();
}
```

The window decides (it is the clock), so it stamps its own decider: Tell-Don't-Ask, and the dispatcher stays the single attribution site.

### The arms honor the signal

- **Inline:** `presentInlinePermissionPrompt(view, title, payload, options, signal?)` becomes `custom<UnattributedDecision | undefined>`; the factory registers `signal.addEventListener("abort", () => done(undefined), { once: true })`.
  Pi's `close` is idempotent (`closed` flag), so a human answer racing the abort settles whichever came first.
  `PermissionPromptComponent.handleInput` calls an injected `onEngaged` once (step 7), which the dispatcher wires to `window.engage()`.
- **Fallback:** `requestPermissionDecisionFromUi(ui, title, message, options, signal?)` passes `{ signal }` to each `ui.select` / `ui.input`.
  After each await, an `undefined` with `signal?.aborted` returns `undefined` (dismissed); an `undefined` without an abort keeps today's meaning (cancel → deny).
  `PermissionDecisionUi`'s two signatures gain the optional `opts?: { signal?: AbortSignal }` parameter.
  The `{ signal }` object is always passed (undefined signal for the null window), so the one exact-arity assertion at `permission-prompt-component.test.ts` (`select` `toHaveBeenCalledWith(title, expect.any(Array))`) is updated in step 6.

### The `unanswered` decider

```typescript
| { kind: "unanswered"; timeoutMs: number }
```

- `narrowSource` gains `case "unanswered": return narrowUnanswered(candidate)`, accepting only a positive finite number, all-or-nothing like its siblings.
- `resolutionFor` → `"prompt_unanswered"` (a new `PermissionDecisionResolution` member, documented beside `confirmation_unavailable`).
- `renderRefusal` → new `renderUnansweredDenial(payload, timeoutMs, denialReason, budget)`, rendering "Nobody answered the approval prompt for this … within 60s." through the same `identification` / `boundaryClause` / `provenanceClause` assembly as its siblings (seconds formatted `timeoutMs / 1000`, as `ParentAuthorizer` formats its own).
  A `forwarded` frame wrapping it renders the same sentence, since `renderRefusal` dispatches on `effectiveDecider`.
- `confirmationUnavailable: true` stays set: no human ruled, which is the flag's documented meaning; its doc comment in `permission-dialog.ts` gains the timeout case.
- Version skew: an older child reading `unanswered` off a forwarded response gets `asDecisionSource → undefined`, relays `decision: null`, and renders the user-denial sentence; that is the existing fail-soft for an unknown decider, not a new hazard.

### Config

```jsonc
"promptTimeoutMs": 60000 // optional, int ≥ 1; unset = no timer
```

Named with the `prompt*` prefix its siblings (`promptMaxRows`, `promptFieldMaxWidth`, `promptNotifications`) use.
`PromptPreferences` gains `promptTimeoutMs?: number`, filled by the `getPromptPreferences` thunk in `src/index.ts`, so a config edit applies to the next prompt.

### Edge cases and where each is tested

| Case                                                                       | Behavior                                                              | Step |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---- |
| `promptTimeoutMs` unset                                                    | No timer; dialog waits indefinitely                                   | 6    |
| Human answers before expiry                                                | Human decision; the window never aborts afterwards                    | 6    |
| Window expires on the inline dialog                                        | Dialog closed; `unanswered` decision                                  | 6    |
| Window expires during the fallback's second `select`/`input`               | `unanswered`; the half-made choice is discarded                       | 6    |
| Fallback cancel (`undefined`) without expiry                               | Deny attributed to the human, as today                                | 6    |
| Two queued asks, nobody present                                            | Second ask presents after the first expires, with its own full window | 6    |
| Forwarded ask times out in the serving node                                | Response carries `unanswered`; broadcast is `prompt_unanswered`       | 6    |
| Child reads `unanswered` from a response                                   | Relayed as `forwarded{unanswered}`; renders "nobody answered"         | 3    |
| Malformed `timeoutMs` on disk (missing, `0`, negative, `Infinity`, string) | `asDecisionSource` → `undefined`                                      | 3    |
| Human presses a key, then walks away                                       | Clock stopped; dialog waits                                           | 7    |
| Config edit between prompts                                                | Next prompt uses the new value                                        | 6    |

## Module-Level Changes

- `src/authority/permission-prompt-component.ts`:
  - Step 1: the dispatcher's two arms become private functions behind one `attributeToHuman(await …)`.
  - Step 6: `PromptPreferences.promptTimeoutMs`; the dispatcher opens an `AnswerWindow`; `presentInlinePermissionPrompt` takes a signal and resolves `undefined` on abort.
  - Step 7: the component calls `onEngaged`, and its hint row names the window when one is open.
- `src/authority/local-user-authorizer.ts`: rename the private `unansweredDecision` → `releasedDecision` (step 2); otherwise unchanged.
- `src/authority/decision-source.ts`: the `unanswered` variant, plus `narrowUnanswered` (step 3).
- `src/authority/decision-resolution.ts`: `case "unanswered"` (step 3).
- `src/service/permission-events.ts`: `"prompt_unanswered"` on `PermissionDecisionResolution` (step 3).
- `src/presentation/agent-renderer.ts`: `case "unanswered"` and `renderUnansweredDenial` (step 3).
- `src/config/config-schema.ts`, `src/config/extension-config.ts`, `src/config/config-loader.ts`, `schemas/permissions.schema.json` (generated): `promptTimeoutMs` (step 4).
- `src/authority/answer-window.ts` (new): `AnswerWindow` (step 5).
- `src/authority/permission-dialog.ts`: the fallback's signal threading, the `PermissionDecisionUi` opts parameter, and the `confirmationUnavailable` doc (step 6).
- `src/index.ts`: the `getPromptPreferences` thunk adds `promptTimeoutMs` (step 6).
- Tests:
  - `test/authority/answer-window.test.ts` (new).
  - `test/authority/permission-prompt-component.test.ts`: the `PromptFactory` / `custom` fake widens to `| undefined`, and the L550 arity assertion is updated.
  - `test/authority/permission-dialog.test.ts`.
  - `test/authority/local-user-authorizer.test.ts`: the "one dialog at a time" describe, plus the rename of the release test title.
  - `test/authority/decision-source.test.ts`: the round-trip `variants` list plus the malformed cases.
  - `test/authority/decision-resolution.test.ts`.
  - `test/presentation/agent-renderer.test.ts`.
  - `test/service/permission-events.test.ts`: the "accepts all defined resolution values" list.
  - `test/authority/forwarded-request-server.test.ts`: the "terminal decision broadcast" describe.
  - `test/config/config-loader.test.ts`, `test/config/extension-config.test.ts`, `test/config/config-schema.test.ts`.
  - `test/composition-root.test.ts`: the TUI prompt harness near `makeTuiCtx`.
- Docs (step 8):
  - `docs/configuration.md`: the scalar-merge sentence (line 39), the example block, the option table row.
  - `config/config.example.json`.
  - `docs/cross-extension-api.md`: a `prompt_unanswered` row in the resolution table.
  - `docs/subagent-integration.md` § When nobody answers: the serving node's dialog window vs the child's `forwardingTimeoutMs`.
  - `docs/troubleshooting.md`: a row for "nobody answered … within Ns".
  - `README.md` (lines 68–70, the dialog paragraph).
  - `docs/architecture/architecture.md`:
    - the `decision-source.ts` entry's variant list;
    - the `permission-prompt-component.ts`, `permission-dialog.ts`, and `agent-renderer.ts` entries;
    - a new `answer-window.ts` module-tree entry;
    - § One dialog at a time, whose "[#931] owns" sentence becomes the presentation-clock rule.

### Predicted unchanged, with the claim each rests on

- `src/authority/ask-dialog-queue.ts`: the window lives inside `present()`; the queue's tail advances when `present()` settles, which a dismissal makes happen; no queue API changes.
- `src/authority/approval-escalator.ts` (`ParentAuthorizer`, `abandon`): the child's deadline and its `unavailable` abandonments are untouched; `relayDecision` is variant-agnostic.
- `src/authority/forwarded-request-server.ts`: writes `decision.decidedBy` and calls `resolutionFor` generically; the new variant needs no branch there.
- `src/authority/forwarding-io.ts`: reads `decidedBy` through `asDecisionSource`, which step 3 extends.
- `src/authority/permission-prompter.ts`: resolution column derived from `confirmationUnavailable` (see Non-Goals).
- `src/authority/denying-authorizer.ts`, `src/handlers/lifecycle.ts`: release and no-authority paths stay `unavailable`.
- `.pi/skills/package-pi-permission-system/SKILL.md`: names `forwardingTimeoutMs` only in the forwarding-test recipe, which is unchanged.

## Test Impact Analysis

1. New tests the change enables: `AnswerWindow` in isolation under fake timers (expire, close-before-expire, engage-before-expire, null window), which the dispatcher tests could only reach through a fake `custom`.
2. Redundant tests: none; the existing dispatch, fallback, and queue tests all still describe live behavior.
3. Tests that stay as-is because they exercise the layers this change rides on:
   - `ask-dialog-queue.test.ts`: FIFO and release semantics.
   - the existing `requestPermissionDecision dispatch` tests: the human attribution path, the window's null case.
   - `forwarded-request-server.test.ts` broadcast tests for the other deciders.

## Invariants at risk

| Invariant (source)                                                                                                 | Constituency                          | Pinned by                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Only one of this node's dialogs is mounted at a time ([#965])                                                      | Operators running forwarding children | `ask-dialog-queue.test.ts` `run`; step 6 adds the queued-second-ask test with the real queue and real dispatcher |
| A released ask is never presented later ([#965])                                                                   | Session shutdown                      | `ask-dialog-queue.test.ts` `releaseAll`; unchanged                                                               |
| The dispatcher is the one place a human answer is attributed (architecture `permission-prompt-component.ts` entry) | Audit readers of `decidedBy`          | Step 1 keeps the dispatch tests green; step 6 asserts `{ kind: "user", via }` on an answer before expiry         |
| A user who was never asked is never reported as denying ([#719])                                                   | Agents reading block reasons          | Step 3 `renderUnansweredDenial` tests assert the full sentence, which does not say "user denied"                 |
| A dead or non-serving target fails fast ([#719], [#721])                                                           | Detached children                     | Forwarding-liveness tests; nothing on the child's path changes                                                   |
| Default config changes no behavior                                                                                 | Every existing user                   | Step 6 "unset → still pending after 10 minutes" test                                                             |

## TDD Order

1. **`refactor(pi-permission-system): collapse the prompt dispatcher to one attribution`**
   - Prepares step 6, so the window wraps a single await rather than being written into both arms.
   - Extract the inline arm and the fallback arm (`renderPromptDialog` + `requestPermissionDecisionFromUi`) into private functions of one shape; the dispatcher picks `{ ask, via }` and calls `attributeToHuman(await ask(), via)` once.
   - Test surface: the existing `requestPermissionDecision dispatch` describe in `permission-prompt-component.test.ts`; no new tests.
   - Re-read the moved code against `code-design` before committing.
2. **`refactor(pi-permission-system): name the released-ask decision for what it is`**
   - Prepares step 3: rename `LocalUserAuthorizer`'s private `unansweredDecision` → `releasedDecision` (two references), so "unanswered" names only the new decider.
   - Also rename the release test's title in `local-user-authorizer.test.ts`.
3. **`refactor(pi-permission-system): add the unanswered decider, its resolution, and its refusal`**
   - No producer yet, so `refactor:`; the three exhaustive switches force the variant, guard, resolution, and render into one commit.
   - Tests:
     - `decision-source.test.ts`: round-trip `{ kind: "unanswered", timeoutMs: 60000 }`; reject a missing, `0`, negative, `Infinity`, and string `timeoutMs`; round-trip it nested in `forwarded`.
     - `decision-resolution.test.ts`: `unanswered` → `prompt_unanswered`, bare and under a `forwarded` frame.
     - `agent-renderer.test.ts`: the full sentence for a local and a forwarded-wrapped `unanswered`.
     - `permission-events.test.ts`: add `"prompt_unanswered"` to the resolution list.
   - Killing mutations, one per class:
     - make `narrowSource`'s `case "unanswered"` return `undefined` (kills the round-trips);
     - make `narrowUnanswered` accept `timeoutMs > -1` (kills the `0`/negative cases);
     - make `resolutionFor`'s `case "unanswered"` return `"confirmation_unavailable"` (kills the resolution tests);
     - route `renderRefusal`'s `case "unanswered"` to `renderUnavailableDenial` (kills the render tests).
4. **`refactor(pi-permission-system): accept a promptTimeoutMs config key`**
   - Schema (`.meta` description naming "unset = no timer" and the relation to `forwardingTimeoutMs`), then `pnpm run gen:schema`, `extension-config.ts` field + normalize copy, and the `config-loader.ts` number-scalar list.
   - Tests: the schema rejects `0` and `1.5`; the loader's project scope overrides global; normalize copies the value; normalize leaves it absent when unset (no `undefined` key, per the `deepEqual` rule).
   - Killing mutation: remove `"promptTimeoutMs"` from the `config-loader.ts` number-scalar list (kills the merge test).
5. **`refactor(pi-permission-system): add the AnswerWindow clock`**
   - New module, no consumer yet.
   - `test/authority/answer-window.test.ts` under `vi.useFakeTimers()`:
     - `open(60000)` aborts at 60000 ms and not at 59999;
     - `close()` before expiry → never aborts;
     - `engage()` before expiry → never aborts;
     - `expiredDecision()` returns the full `unanswered` decision;
     - the null window has an undefined signal, and its `expiredDecision()` throws.
   - Killing mutations:
     - make `close()` a no-op (kills close-before-expiry);
     - make `engage()` a no-op (kills engage-before-expiry);
     - make `expiredDecision()` stamp `{ kind: "unavailable", reason: "" }` (kills the decision test).
6. **`feat(pi-permission-system): deny a permission prompt nobody answers within promptTimeoutMs`**
   - Wires `PromptPreferences.promptTimeoutMs` → the `index.ts` thunk → the dispatcher's `AnswerWindow`, and both arms' signal handling.

   - Widen the test file's `PromptFactory`/`custom` fake to `| undefined`, and update the L550 `select` arity assertion, in this commit.

   - Tests:
     - `permission-prompt-component.test.ts`, inline arm under fake timers:
       - expiry yields the `unanswered` decision and Pi's `done` was called;
       - a human answer at 30 s yields the `{ user, dialog }` decision, and advancing past 60 s calls `done` no second time (spy on `done`);
       - unset still pending after 600 000 ms.
     - `permission-prompt-component.test.ts`, fallback arm: `select` receives the signal; abort → `unanswered`; abort during the deny-with-reason `input` → `unanswered`; a plain `undefined` without abort → human deny (existing).
     - `local-user-authorizer.test.ts` "one dialog at a time", using the real `requestPermissionDecision` and the real queue: the first ask expires, then the second presents with its own full window.
     - `forwarded-request-server.test.ts` "terminal decision broadcast": an escalator returning the `unanswered` decision writes it to the response file and broadcasts `prompt_unanswered`.
     - `composition-root.test.ts`, via the `makeTuiCtx` harness with `promptTimeoutMs: 20` (real timers): an unanswered `demo` ask blocks with the "Nobody answered" sentence.

   - Killing mutations:
     - make the dispatcher open `AnswerWindow.open(undefined)` (kills every expiry test);
     - delete the `finally { window.close() }` (kills the answer-then-no-second-`done` test);
     - drop `{ signal }` from the fallback's `ui.select` call (kills the fallback abort test, whose fake resolves `undefined` only when its signal aborts);
     - delete `promptTimeoutMs` from the `index.ts` thunk (kills the composition-root test).

   - Commit footer, last paragraph:

     ```text
     Refs #735, #931

     Co-authored-by: Echokovo <147175121+Echokovo@users.noreply.github.com>
     Co-authored-by: aoguai <34203474+aoguai@users.noreply.github.com>
     Co-authored-by: wangyangyang <19573559+gitwyy@users.noreply.github.com>
     ```

7. **`feat(pi-permission-system): keep a permission prompt open once you start answering it`**
   - The component calls an injected `onEngaged` on its first `handleInput`; the dispatcher wires it to `window.engage()`.
   - The decision-step hint row appends "unanswered: denies after 60s" only while a window is open.
   - Tests (fake timers): press `↓` at 30 s, advance past 60 s → still pending, then answer → the human decision; the hint is present with a window and absent without one.
   - Killing mutations: delete the `onEngaged` call in `handleInput` (kills the still-pending test); render the hint unconditionally (kills the no-window render test).
8. **`docs(pi-permission-system): document promptTimeoutMs and the unanswered decider`**
   - Every doc file listed under Module-Level Changes → Docs.
   - Verify with `pnpm exec rumdl check` on each touched markdown file and `pnpm --filter @gotgenes/pi-permission-system run test -- test/config/config-schema.test.ts` (schema parity).

## Risks and Mitigations

| Risk                                                                                                                                                     | Mitigation                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Another extension mounts a dialog over ours; our expiry's `close` then restores the editor over *its* dialog (Pi's `restoreEditor` clears the container) | Pre-existing exposure ([#965] § One dialog at a time records it, upstream declined to arbitrate in earendil-works/pi#7007); a human answering the displaced dialog does the same today; recorded in the architecture entry, not mitigated |
| A window outlives its session (`session_shutdown` releases the ask, but the dispatcher's timer is still armed)                                           | Timer is `unref()`ed; on expiry it closes a dialog the release already orphaned, which is what a late human answer does today                                                                                                             |
| A present human loses a half-typed reason at expiry                                                                                                      | Step 7 stops the clock on the first keystroke                                                                                                                                                                                             |
| Fake-timer tests false-green because `AbortSignal` listeners fire synchronously                                                                          | Step 5 asserts the 59999/60000 boundary on the window itself, and step 6's tests assert the settled decision, not a tick count (the `testing` skill's "observe not-yet-settled state" rule)                                               |
| An older child mis-renders a relayed `unanswered` as a user denial                                                                                       | Existing fail-soft for an unknown decider; the child blocks either way (deny), so only the sentence differs                                                                                                                               |
| `promptTimeoutMs` ≥ `forwardingTimeoutMs` lets the child abandon first, leaving the parent's dialog up                                                   | Documented in `docs/configuration.md` and `docs/subagent-integration.md`: set the prompt window below the forwarding backstop                                                                                                             |

## Open Questions

- Should [#722] be closed now that [#907] fixed the root misclassification its comment diagnosed?
  It is not part of this change; raise it at `/ship` or the next triage.
- Should the review-log `resolution` column read `decidedBy` instead of `confirmationUnavailable`?
  Deferred until a reader needs it; `decidedBy` already carries the distinction.

[#472]: https://github.com/gotgenes/pi-packages/issues/472
[#620]: https://github.com/gotgenes/pi-packages/issues/620
[#698]: https://github.com/gotgenes/pi-packages/issues/698
[#719]: https://github.com/gotgenes/pi-packages/issues/719
[#721]: https://github.com/gotgenes/pi-packages/issues/721
[#722]: https://github.com/gotgenes/pi-packages/issues/722
[#907]: https://github.com/gotgenes/pi-packages/issues/907
[#931]: https://github.com/gotgenes/pi-packages/issues/931
[#965]: https://github.com/gotgenes/pi-packages/issues/965
[#983]: https://github.com/gotgenes/pi-packages/pull/983
