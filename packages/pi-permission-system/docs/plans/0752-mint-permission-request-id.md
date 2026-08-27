---
issue: 752
issue_title: "pi-permission-system: mint a permission request id at creation and carry it on every decision"
---

# Mint a permission request id at creation and carry it on every decision

## Release Recommendation

**Release:** ship independently

Phase 13 Step 9 carries `Release: independent` in the roadmap's Release batches subsection, and it is a member of no batch.
The work lands as `feat:` commits, so it cuts a release on its own.
It must land **before** Step 3 ([#745]), which edits a different interface in the same `src/permission-events.ts` file.

## Problem Statement

This package has no permission request id.
It has three conventions, and none of them covers a request that never prompts.

| Path              | Id today                                                         | Site                                                 |
| ----------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| tool-call gates   | **borrowed** `tcc.toolCallId` — the SDK's id, never minted       | `src/handlers/gates/runner.ts:162`                   |
| skill-input gate  | minted `skill-input-<ts>-<rand>-<pid>`                           | `src/handlers/gates/skill-input-gate-pipeline.ts:86` |
| forwarded request | a **fresh** `<ts>-<rand>-<pid>`, discarding the id it was handed | `src/authority/approval-escalator.ts:253`            |

The id also attaches at the *ask*, not at request creation.
`GateRunner.runDescriptor` sets `requestId` only inside `promptForApproval`, so every non-prompting resolution — session-approved, yolo auto-approve, infrastructure auto-allow, policy block — carries no request id at all.
And `PermissionDecisionEvent` has seven fields, none of them an id, so the terminal event of every permission request is uncorrelatable.

The issue's measurement, from a 7.3 MB review log (9 417 entries) restricted to the last 14 days (766 entries): 452 entries — `session_approved` ×422, `infrastructure_auto_allowed` ×24, `blocked` ×6 — carry `toolCallId` but never `requestId`.

## Goals

- Mint one id per permission request at request creation, in `GateRunner.run`, shared by the bypass and descriptor branches.
- Carry it on every review-log write the runner performs, whatever the resolution.
- Add it to `PermissionDecisionEvent`, so the terminal broadcast of a permission request is correlatable.
- Collapse the three id conventions to one: the forwarding edge adopts the id it is handed rather than minting a third, and `createSkillInputRequestId` is deleted.
- Give the gate-error boundary entry a minted id too, so no `permission_request.*` write is id-less.
- Keep `toolCallId` flowing untouched as the join back to the Pi transcript, and close the one review-log write that omits it (`skill-read.ts`).

Not breaking.
`PermissionDecisionEvent` gains a field, which its documented stability guarantee permits.
See [Is this breaking?](#is-this-breaking) for the one observable change that needs a changelog note but not a major bump.

## Non-Goals

- **The missing `permissions:decision` on the gate-error path.**
  A thrown gate blocks the tool call and writes a review entry, but emits no terminal event — the only blocking path that does not.
  Filed as [#753] during this planning session and deferred there; this plan only mints the id that issue will carry.
- **`decidedBy` provenance** — Phase 13 Step 6 ([#726]).
  *Which request* and *what decided it* are the same audit question and both enrich the review-log write path, so they land in sequence, not concurrently.
- **Cross-session prompt/decision correlation** — Phase 13 Step 10 ([#610]).
  This plan is the local foundation it needs; the parent-side terminal emit stays there.
- **The payload/`message` swap on the forwarded wire and the `ui_prompt` broadcast** — Phase 13 Step 3 ([#745]).
  This plan touches `src/permission-events.ts` and `src/authority/approval-escalator.ts`, which that step also rewrites; the two must not run concurrently.
- **Adding `toolCallId` to `PermissionDecisionEvent` or `PermissionUiPromptEvent`.**
  Decided against: the decision event correlates to the review log by `requestId`, and the review log is where the transcript join lives.
- **Rewriting the review-log entries' other fields.**
  `logContext` composition, redaction, and the `resolution` vocabulary are unchanged.

## Background

### The runner is the one request-creation point

`GateRunner.run(gate, agentName, toolCallId)` (`src/handlers/gates/runner.ts`) is called from exactly two sites: `ToolCallGatePipeline.evaluate` (once per gate producer, six per tool call) and `SkillInputGatePipeline.evaluate`.
Every permission request this package raises passes through it.

`toolCallId` has exactly **one** reader inside the runner: `requestId: toolCallId` at line 162.
Every descriptor already carries `toolCallId` in its own `promptDetails` and `logContext` — `bash-path.ts`, `bash-external-directory.ts`, `external-directory.ts`, `path.ts`, `tool.ts`, and `skill-read.ts`'s `promptDetails`.
So once the runner mints its own id, **the third parameter has no reader left**: it is deleted, not narrowed to `string | null` as the issue proposes.

The one gap that parameter would otherwise cover is `skill-read.ts`'s `logContext`, which omits `toolCallId` while its `promptDetails` carries it.
That is a one-line fix in the gate module, not a reason to keep a relay parameter.

### The write paths are four, not three

| Site                                    | Event                                                     | Reached by                                                |
| --------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| `runner.ts:60`                          | `gate.log.event` (bypass)                                 | infrastructure auto-allow, all-session-covered bash paths |
| `runner.ts:99`                          | `permission_request.session_approved`                     | descriptor session-hit fast path                          |
| `runner.ts:123`                         | `permission_request.auto_approved`                        | yolo grant                                                |
| `runner.ts:173` → `applyPermissionGate` | `permission_request.blocked`, `resolution: policy_denied` | config-level deny                                         |

The fourth is written by `applyPermissionGate` (`src/permission-gate.ts:52`) from the `logContext` object the runner hands it, so injecting the id into that one object covers it without touching the gate function.

### `GateBypass.decision` has one construction site, not three

The issue and the roadmap both say "the three descriptor-built event literals (`bash-external-directory.ts`, `bash-path.ts`, `external-directory.ts`)".
Only **one** `GateBypass` carries a `decision`: the Pi infrastructure-read bypass at `src/handlers/gates/external-directory.ts:59`.
The other two bypasses carry a `log` and no `decision`, and `decision: { surface, value }` on a `GateDescriptor` is a different, two-field shape that this change does not touch.

### The forwarding edge already discards the id it is handed

`ParentAuthorizer.authorize` receives `PromptPermissionDetails` and never reads `requestId` — the tests name their fixture value `"unused-by-parent-authorizer"`.
`buildForwardedRequest` mints a fresh `<ts>-<rand>-<pid>` for the wire `id`, which names the request and response files and which the serving node then adopts as its own ask's `requestId` (`forwarded-request-server.ts:100`).

### Constraints from `AGENTS.md` and the package skill

- A module no code imports yet is dead code; `pnpm fallow dead-code` gates CI.
  So the new mint module cannot land as a standalone pure-addition commit — it lands with its first caller.
- Adding a **required** field to a shared interface breaks inline literal constructors at compile time, so those call sites fold into the same commit.
- The roadmap's step-mark (`✅` on the heading and the Mermaid node), the `Landed:` note, and the stale health-metric rows land in the implementation doc-update commit, not at ship time.

## Design Overview

### One mint, one home

```typescript
// src/permission-request-id.ts
import { randomUUID } from "node:crypto";

/**
 * Mint the id that identifies one permission request from creation to its
 * terminal decision.
 *
 * Distinct from the host's `toolCallId`, which stays alongside it as the join
 * back to the Pi transcript: one tool call raises up to six requests.
 */
export function createPermissionRequestId(): string {
  return `perm-${randomUUID()}`;
}
```

The `perm-` prefix makes the id self-identifying in a review log that also carries SDK tool-call ids (`toolu_…`) and, until this change lands, two other mint formats.

UUIDv7 was considered and declined: Node has no v7.
`crypto.randomUUID({ version: 7 })` does not throw — it silently ignores the option and returns a v4, verified on Node v26.7.0 (`0d29880d-a1ec-4e44-a356-6da665db3cef`, version nibble `4`).
The package's `engines` is `>=22`, so v7 would mean either a new runtime dependency on a security-sensitive extension or a hand-rolled layout, and what it buys is external time-ordering that the append-only, per-entry-timestamped review log does not need.

### The runner mints once and injects at two points

```typescript
async run(gate: GateResult, agentName: string | null): Promise<GateOutcome> {
  if (!gate) return { action: "allow" };
  const requestId = createPermissionRequestId();
  if (isGateBypass(gate)) {
    if (gate.log) {
      this.reporter.writeReviewLog(gate.log.event, { ...gate.log.details, requestId });
    }
    if (gate.decision) this.emitDecision(requestId, gate.decision);
    return { action: "allow" };
  }
  return this.runDescriptor(gate, agentName, requestId);
}
```

`runDescriptor` builds its log context once — `const logContext = { ...descriptor.logContext, agentName, requestId }` — and uses it for the `session_approved` write, the `auto_approved` write, and the object handed to `applyPermissionGate`, which covers the `policy_denied` write.
It passes `requestId` to `prompter.escalate` where `toolCallId` is passed today.

A single private helper is the sole injection point for the event:

```typescript
private emitDecision(requestId: string, facts: DecisionEventFacts): void {
  this.reporter.emitDecision({ requestId, ...facts });
}
```

`buildDecisionEvent` keeps its five parameters and narrows its return type to `DecisionEventFacts`; `GateBypass.decision` narrows to the same type.
Both the bypass branch and the three descriptor emits then flow through one stamping site, so a future emit cannot forget the id.

```typescript
// src/handlers/gates/descriptor.ts
/** A decision event's facts, before the runner stamps the request id it minted. */
export type DecisionEventFacts = Omit<PermissionDecisionEvent, "requestId">;
```

It lives in `descriptor.ts` rather than `permission-events.ts` because it is a gate-layer projection — the shape a gate can produce without knowing the id — not part of the published event contract.

### The forwarding edge adopts the id it is handed

`ForwardedRequestFacts` gains `requestId: string`; `authorize` passes `details.requestId`; `buildForwardedRequest` uses it as the wire `id` and deletes its own mint.
One id then runs end to end: the child's request → the request and response filenames → the serving node's `PromptPermissionDetails.requestId` → the serving node's own prompt and decision.

Consumer sketch at the edge:

```typescript
// ParentAuthorizer.authorize
return this.waitForForwardedApproval(this.ctx, {
  requestId: details.requestId,   // adopted, not re-minted
  message: details.message,
  display: { source: uiPrompt.source, surface: uiPrompt.surface, value: uiPrompt.value },
  sessionApproval: details.sessionApproval,
  accessIntent: details.accessIntent,
});
```

One guard is warranted by the change itself.
Today the wire `id` is always locally minted, so an inbound id never becomes an **outbound** filename.
After adoption it can: at a relay hop, `details.requestId` is `request.id`, read from a JSON file on disk that `forwarding-io.ts` validates only as `typeof parsed.id === "string"`.
`buildForwardedRequest` therefore falls back to a fresh `createPermissionRequestId()` when the adopted id does not match `/^[A-Za-z0-9._-]+$/`.

This makes [#745]'s planned `requesterRequestId` wire field redundant — the wire `id` **is** the child's request id — so that committed plan gets an amending note in this change's doc commit.

### The gate-error boundary

`createFailClosedToolCall`'s `catch` mints an id and names it on the `permission_request.blocked` / `gate_error` entry.

That introduces a call into the fail-closed catch body, which is the package's headline invariant (#452): the SDK's `emitToolCall` does not catch a throwing handler, so anything that throws out of this `catch` means the command runs ungated.
`randomUUID()` throws only when there is no entropy source, but the invariant should not rest on that.
The recording work in the `catch` — `audit.recordError()`, the mint, `writeReviewLog` — is wrapped in a nested `try`/`catch` that swallows, leaving `return { block: true, reason: … }` unconditional.
That strengthens the guarantee beyond today's, where the same block is unprotected.

### Is this breaking?

No, and the reasoning is worth recording because one observable value does change.

`permissions:ui_prompt.requestId` today equals the SDK `toolCallId` for a tool-call ask; after this it is a minted `perm-…`.
The event carries no `toolCallId` field, so a consumer that had been joining that broadcast to the Pi transcript through `requestId` loses the join.
But the documented contract is "Unique ID for the permission request being prompted" — the equality was coincidental and never documented, and one tool call legitimately raises up to six distinct requests, so the old value was not even unique per request.
`PermissionDecisionEvent` gains a field, which its stability guarantee explicitly permits.
The forwarded-request `id` changes format, but it is an internal wire artifact with no consumer contract and no format validation on either side, so version skew is safe in both directions.

Ships as `feat:` with a changelog-visible note on the `ui_prompt` value change, not `feat!:`.

## Module-Level Changes

### Source

| File                                              | Change                                                                                                                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/permission-request-id.ts`                    | **New.** `createPermissionRequestId()` → `perm-<randomUUID()>`                                                                                                                                                                                         |
| `src/handlers/gates/runner.ts`                    | `run(gate, agentName)` — third parameter deleted; mint once at the top; inject into the bypass log write and the descriptor's single `logContext`; escalate with the minted id; new private `emitDecision(requestId, facts)` as the sole stamping site |
| `src/handlers/gates/descriptor.ts`                | New `DecisionEventFacts` type alias; `GateBypass.decision?: DecisionEventFacts`                                                                                                                                                                        |
| `src/handlers/gates/helpers.ts`                   | `buildDecisionEvent` return type → `DecisionEventFacts` (signature otherwise unchanged)                                                                                                                                                                |
| `src/handlers/gates/skill-input-gate-pipeline.ts` | Delete `createSkillInputRequestId`; `evaluate` calls `runner.run(descriptor, agentName)`                                                                                                                                                               |
| `src/handlers/gates/tool-call-gate-pipeline.ts`   | `runner.run(await produce(), tcc.agentName)` — drops the `tcc.toolCallId` argument                                                                                                                                                                     |
| `src/handlers/gates/skill-read.ts`                | Add `toolCallId: tcc.toolCallId` to `logContext`, matching every other tool-call gate                                                                                                                                                                  |
| `src/permission-events.ts`                        | `PermissionDecisionEvent` gains required `requestId: string`                                                                                                                                                                                           |
| `src/authority/approval-escalator.ts`             | `ForwardedRequestFacts` gains `requestId: string`; `authorize` relays `details.requestId`; `buildForwardedRequest` adopts it as the wire `id` behind a filename-safety guard and deletes its `Math.random` mint                                        |
| `src/handlers/tool-call-boundary.ts`              | Mint a request id in the `catch` and name it on the `gate_error` entry; wrap the catch's recording work so nothing in it can defeat the block                                                                                                          |

### Tests

| File                                                    | Change                                                                                                                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/permission-request-id.test.ts`                    | **New.** Prefix and uniqueness, relocated from the `createSkillInputRequestId` cases                                                                                                 |
| `test/handlers/gates/runner.test.ts`                    | Rewrite `"passes requestId from toolCallId to prompt"`; new cases pinning one id across all four write paths, the escalate call, and the decision event; two runs mint different ids |
| `test/handlers/gates/skill-input-gate-pipeline.test.ts` | Drop the `createSkillInputRequestId` import and its two cases; `runner.run` asserted with two arguments                                                                              |
| `test/handlers/gates/external-directory.test.ts`        | The infrastructure bypass's `decision` no longer carries a `requestId` (the runner stamps it)                                                                                        |
| `test/decision-reporter.test.ts`                        | `makeDecisionEvent` literal gains `requestId` (required field — compile error otherwise)                                                                                             |
| `test/permission-events.test.ts`                        | Same for its local decision-event factory; a case asserting the emitted payload carries `requestId`                                                                                  |
| `test/authority/approval-escalator.test.ts`             | Fixture `requestId` renamed from `"unused-by-parent-authorizer"`; the written request's `id` equals `details.requestId`; an unsafe id falls back to a fresh mint                     |
| `test/handlers/tool-call-boundary.test.ts`              | The `gate_error` entry carries a `perm-` `requestId`; a throwing reporter still yields `{ block: true }`                                                                             |
| `test/handlers/gates/helpers.test.ts`                   | `buildDecisionEvent` returns facts without a `requestId`                                                                                                                             |

Everything else asserting decision events uses `toMatchObject` / `objectContaining` (verified across `test/handlers/tool-call-events.test.ts`, `test/handlers/input-events.test.ts`, `test/handlers/external-directory-integration.test.ts`), so an added field does not break them.

### Documentation

| File                                             | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/cross-extension-api.md`                    | Add the `requestId` row to the `permissions:decision` payload-fields table; note on the `ui_prompt` `requestId` row that it is a minted request id, not the SDK tool-call id                                                                                                                                                                                                                                                                                                                           |
| `docs/architecture/architecture.md`              | `✅` on the Step 9 heading and its Mermaid node, plus a `Landed:` note; module-tree entries for `runner.ts` (signature), `skill-input-gate-pipeline.ts` (mint removed), `approval-escalator.ts` (adopts the handed id), `tool-call-boundary.ts` (minted id on the `gate_error` entry), and a new `permission-request-id.ts` entry; correct the Step 9 `Target:` text (one bypass decision literal, not three; parameter deleted, not narrowed); fix the mint-site recompute command and the metric row |
| `docs/plans/0745-cross-boundary-payload-swap.md` | Amending note: the wire `id` now **is** the child's request id, so the planned `requesterRequestId` field and its TDD step are redundant                                                                                                                                                                                                                                                                                                                                                               |

### Health metrics

Both baselines measured at planning time.

| Metric                                          | Baseline | Predicted |
| ----------------------------------------------- | -------- | --------- |
| Request-id mint sites in `src/`                 | 2        | 1         |
| `requestId` lines in `src/permission-events.ts` | 1        | 2         |

The roadmap's recompute command for the first is `grep -rn "Math.random().toString(36)" … | wc -l`, which under this design goes 2 → **0**, not 2 → 1: both ad-hoc mints are deleted and the one replacement uses `randomUUID`.
The row's intent — one mint site — is unchanged, so the command is corrected to `grep -rnE "Math\.random\(\)\.toString\(36\)|randomUUID" packages/pi-permission-system/src --include="*.ts" | wc -l`, which reads 2 today and 1 after.

The second is a line count, so the new field's doc comment must not repeat the token `requestId`, and `DecisionEventFacts` must not live in `permission-events.ts` — the layering argument above already places it in `descriptor.ts`, and this is the check that confirms it.

## Test Impact Analysis

1. **Newly possible.**
   `createPermissionRequestId` is directly testable for format and uniqueness — the same two properties `createSkillInputRequestId` had, now covering every surface rather than skill-input alone.
   The correlation property is newly assertable at all: within one `runner.run`, the id on the review-log write and the id on the decision event can be read off the two mocks and compared, which no test could do before because the non-prompting paths carried no id.
2. **Newly redundant.**
   `test/handlers/gates/skill-input-gate-pipeline.test.ts`'s two `createSkillInputRequestId` cases are removed with the function; their coverage moves to `test/permission-request-id.test.ts`.
   `runner.test.ts:320` (`"passes requestId from toolCallId to prompt"`) pins the behavior being removed and is rewritten rather than kept.
3. **Must stay as-is.**
   `test/authority/approval-escalator.test.ts`'s round-trip cases read `request.id` dynamically from the written file, so they keep exercising the wire path unchanged; only the new assertion about *where the id came from* is added.
   Every `toMatchObject` decision-event assertion across the handler tests stays: they pin the surface/value/resolution contract this change must not disturb.

## Invariants at risk

| Invariant                                                       | Source                                                  | Pinned by                                                                                                                                                                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message` is byte-identical to the pre-[#744] assemblers        | Step 1 `Landed:`                                        | `test/presentation/legacy-message.test.ts` — untouched; this plan changes no presentation module                                                                                                                                        |
| A 200-line here-string ask renders within the 24-row default    | Step 2 `Landed:`                                        | `test/presentation/dialog-renderer.test.ts` — untouched, same reason                                                                                                                                                                    |
| Fail-closed: a thrown gate blocks, never allows                 | #452, `tool-call-boundary.ts`                           | `test/handlers/tool-call-boundary.test.ts` "blocks fail-closed when the gate throws" — **strengthened** here by a new case pinning that a throwing reporter still yields `{ block: true }`, since this change adds work to that `catch` |
| A forwarded request's `id` names its request and response files | `approval-escalator.ts` / `forwarded-request-server.ts` | `test/authority/approval-escalator.test.ts` round-trips — plus the new filename-safety guard case                                                                                                                                       |
| One prompt per gate, not per tool call                          | implicit in `ToolCallGatePipeline`'s six producers      | The minted-id change makes this observable for the first time: a tool call now yields up to six distinct `requestId`s where it yielded one repeated `toolCallId`                                                                        |

No quantitative invariant (byte count, row budget, token budget, latency) is touched.

## TDD Order

1. **Mint at request creation and carry it on every review-log write.**
   Red: `test/handlers/gates/runner.test.ts` — the id escalated to the prompter matches `/^perm-/` and is not the tool call id; the same id appears on the bypass log write, `session_approved`, `auto_approved`, and the `policy_denied` write; two `run` calls mint different ids.
   `test/permission-request-id.test.ts` — prefix and uniqueness.
   Green: add `src/permission-request-id.ts`; `GateRunner.run(gate, agentName)` mints once and injects; delete `createSkillInputRequestId`; update both pipeline call sites; add `toolCallId` to `skill-read.ts`'s `logContext`.
   The deletion, the signature change, and both call sites are one commit because removing the export and the parameter breaks the type check otherwise.
   `feat(pi-permission-system): mint a permission request id at request creation`
2. **`requestId` on `PermissionDecisionEvent`.**
   Red: `test/permission-events.test.ts` — the emitted payload carries `requestId`; `test/handlers/gates/runner.test.ts` — the decision event's id equals the review entry's on the session-hit, yolo, gate-result, and bypass paths.
   Green: add the required field; introduce `DecisionEventFacts` in `descriptor.ts`; narrow `GateBypass.decision` and `buildDecisionEvent`'s return type; add the runner's private `emitDecision`.
   The two full-literal test factories (`test/decision-reporter.test.ts:31`, `test/permission-events.test.ts:120`) and `test/handlers/gates/external-directory.test.ts`'s bypass literal fold in — a new required field is a compile error at each.
   `feat(pi-permission-system): carry the request id on permissions:decision`
3. **The forwarding edge adopts the id it is handed.**
   Red: `test/authority/approval-escalator.test.ts` — the written request's `id` equals `details.requestId`; a `requestId` containing a path separator falls back to a freshly minted id.
   Green: `ForwardedRequestFacts.requestId`, the relay in `authorize`, the adoption plus safety guard in `buildForwardedRequest`, and the deletion of its `Math.random` mint.
   `feat(pi-permission-system): adopt the requester's request id as the forwarded request id`
4. **The gate-error boundary.**
   Red: `test/handlers/tool-call-boundary.test.ts` — the `gate_error` entry carries a `perm-` `requestId`; two errored calls carry different ids; a reporter that throws still yields `{ block: true }`.
   Green: mint in the `catch`, name it on the entry, and wrap the recording work.
   `feat(pi-permission-system): give the gate-error review entry a request id`
5. **Documentation.**
   The `docs/cross-extension-api.md` table rows, the architecture step-mark and `Landed:` note, the module-tree entries, the corrected Step 9 `Target:` text and mint-site recompute command, and the amending note on [#745]'s plan.
   `docs(pi-permission-system): record the minted request id in the API and architecture docs`

## Risks and Mitigations

| Risk                                                                             | Mitigation                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `catch`-body throw defeats fail-closed and lets a command run ungated          | The mint and the review write are wrapped in a nested swallowing `try`; the `{ block: true }` return is unconditional; a new test pins it with a throwing reporter                                                    |
| An inbound, unvalidated request id becomes an outbound filename at a relay hop   | `buildForwardedRequest` falls back to a fresh mint unless the adopted id matches `/^[A-Za-z0-9._-]+$/`; tested                                                                                                        |
| A consumer joining `permissions:ui_prompt.requestId` to the Pi transcript breaks | Documented in the changelog note and in `docs/cross-extension-api.md`; the equality was never a documented contract, and the old value was not unique per request                                                     |
| A later emit site forgets to stamp the id                                        | `GateBypass.decision` and `buildDecisionEvent` both produce `DecisionEventFacts`, which is not assignable to `PermissionDecisionEvent`, so the compiler routes every emit through the runner's single stamping helper |
| The mint module lands with no importer and trips `pnpm fallow dead-code` in CI   | It lands in step 1 together with its first caller, never as a standalone pure-addition commit                                                                                                                         |
| Concurrent work on [#745] or [#721] collides                                     | Step 9 lands before Step 3 (`src/permission-events.ts`) and is sequenced against Step 5 (`src/authority/approval-escalator.ts`); the roadmap's Track E note already records this                                      |
| The corrected metric-row grep drifts from what actually landed                   | Both the baseline and the predicted value were measured at planning time and are recomputed in the step 5 doc commit                                                                                                  |

## Open Questions

- **Does [#745] still need `requesterRequestId`?**
  Under step 3 the wire `id` *is* the child's request id, so the field is redundant.
  Step 5 records that in [#745]'s plan rather than silently leaving a superseded TDD step in a committed document.
  If [#745] later finds a case where the two must differ — a relay that re-identifies the request — the field returns with a recorded reason.
- **Should the `gate_error` path emit a terminal decision event?**
  Deferred to [#753], filed during this planning session.
  Until it lands, the minted boundary id appears on exactly one review entry and joins to nothing else.
- **Does a per-gate id change how [#610] correlates?**
  A tool call now raises up to six ids where it raised one repeated `toolCallId`.
  That is the correct granularity — one id per permission request — but [#610]'s parent-side emit should be planned against it explicitly rather than assuming one id per tool call.

[#610]: https://github.com/gotgenes/pi-packages/issues/610
[#721]: https://github.com/gotgenes/pi-packages/issues/721
[#726]: https://github.com/gotgenes/pi-packages/issues/726
[#744]: https://github.com/gotgenes/pi-packages/issues/744
[#745]: https://github.com/gotgenes/pi-packages/issues/745
[#753]: https://github.com/gotgenes/pi-packages/issues/753
