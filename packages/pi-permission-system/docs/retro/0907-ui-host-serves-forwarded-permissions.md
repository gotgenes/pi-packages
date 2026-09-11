---
issue: 907
issue_title: "pi-permission-system：Root session is detected as a subagent when `PI_SUBAGENT_PARENT_SESSION` names its own id — serving heartbeat withdrawn, every forwarded ask fails closed (nicobailon/pi-subagents interop)"
---

# Retro: #907 — Root session is detected as a subagent when `PI_SUBAGENT_PARENT_SESSION` names its own id

## Stage: Planning (2026-09-11T04:36:16Z)

### Session summary

Planned [#907], a third-party interop report from `@gaop154`: a root interactive session withdraws its forwarded-permission serving heartbeat because `nicobailon/pi-subagents` sets `PI_SUBAGENT_PARENT_SESSION` to the root's own id inside the root process, which `SUBAGENT_ENV_HINT_KEYS` reads as child evidence.
PR [#911] (`@mevatron`) was folded in as a design input rather than reviewed separately; the operator chose to cover all three of the report's findings and to reimplement through this repo's own TDD cycle with `Co-authored-by:` credit.
The plan landed as `docs/plans/0907-ui-host-serves-forwarded-permissions.md` in five steps, and spun off [#914] for the reporter's Windows side observation.

### Observations

The decisive finding was that `isSubagent(ctx)` has exactly **one** reader that can ever see `hasUI === true` — the `ForwardingManager.start` guard.
`selectAuthorizer` returns on `hasUI` before consulting it, and `resolvePermissionForwardingTarget` returns `source: "self"` on `hasUI` without reaching the env candidates.
That turned a predicate fix into a consumer fix: the guard becomes `if (!ctx.hasUI)`, `ForwardingManagerDeps` drops `detection`, and `SubagentDetectionContext` is never widened.
PR [#911] fixes the predicate instead, by comparing the marker against the UI host's own session id.

Reading the upstream source rather than the report is what chose between them.
`nicobailon/pi-subagents` v0.66.0 and v0.67.0 set the marker only from `resetSessionState`, reached only from the `session_start` handler — so after a mid-process session-id change the marker holds the **previous** id and an equality comparison stops matching.
The reporter asserted this as follow-up finding 1; the tag read confirmed it as a property of the upstream code, and `v0.67.0` is byte-identical, so the code has not moved.

Also traced: the guard `!ctx.hasUI || isSubagentExecutionContext(ctx)` dates to `bb9086e0` (MasuRii, 2026-03-07), the original upstream forwarding commit, where the hint list was three "I am a subagent" markers a root could never carry.
[#22] and [#789] folded the parent-session names in later.
Removing the `isSubagent` half is therefore not overturning a deliberated convention — no plan, ADR, or retro records one — it is repairing a condition whose premise expired underneath it.

Finding 1's first half turned out sharper than reported: `ForwardedRequestServer.processInbox` reads the live session id every tick while `ForwardingManager` publishes under the id captured at the last `start(ctx)`, so the announcer and the watcher disagree in **both** directions during the window — a child holding the old id sees a live heartbeat and is then ignored by the watcher, which is the full ten-minute stall rather than a fast-fail.

The defect does not reach this monorepo: `@gotgenes/pi-subagents` sets no `PI_SUBAGENT_*` variable at all, and delegates in-process through the registry channel.
Real defect, different pairing — which set the priority without changing the verdict.

Two smaller verifications worth recording.
`vi.stubEnv(key, undefined)` genuinely deletes the key on the pinned Vitest 4.1.11, measured with a scratch test rather than assumed.
And `architecture.md`'s env-var inventory is stale in the exact row this issue concerns — it still says nicobailon sets no parent-session variable — which became a plan step rather than a footnote.

#### Deferred tidyings

- `test/authority/approval-escalator.test.ts` — four repeated `vi.unstubAllEnvs()` `finally` blocks that a shared `afterEach` would absorb; the assessor declined it as scope creep, and Step 1 adds only the `beforeEach` beside them rather than consolidating.

The assessor's one Recommended item — extract a non-logging `setServingId` from `announceServing` — was **dissolved rather than deferred**.
It assumed the heartbeat migration must stay silent; the design settled that a migration is a rare, diagnosis-worthy event that should log, which is exactly `announceServing`'s existing behavior, so `refreshServing` delegates to it and no extraction is needed.

## Stage: Implementation — TDD (2026-09-11T05:04:54Z)

### Session summary

Executed all five steps of `docs/plans/0907-ui-host-serves-forwarded-permissions.md` — one `test:` env-hygiene step, three `fix:` steps, one `docs:` step — each its own commit with the plan's killing mutations applied and reverted before committing.
Serving eligibility is now `ctx.hasUI` alone, the heartbeat re-resolves the live session id each tick and republishes through `announceServing` on a change, and `resolvePermissionForwardingTarget` skips a candidate naming the requesting session in both channels.
Tests went 4126 → 4147 (+21) in `pi-permission-system`; `check`, root `lint`, full `test`, and `fallow dead-code` all green.

### Observations

The plan held exactly: the changed-file list matches its `Module-Level Changes` table with no additions, and all four predicted-unchanged files held — including `src/authority/subagent-context.ts`, which is the file PR [#911] edits and whose staying untouched was the design's falsifiable claim.

Every mutation killed the predicted set and no more.
Two are worth recording.
The `hasUI`-guard deletion mutation killed four tests (the two `start()` no-UI cases plus two serving-announcement cases) while leaving the new serving-eligibility scenarios green, which is the signal that the guard's two halves are pinned separately rather than by one overlapping assertion.
And `keeps serving the last reachable id when the live id is unreachable` **passed during Red** — today's `refreshServing` re-marks the stored id unconditionally, so an unreachable live id was already harmless.
That is the case the testing skill flags as indistinguishable from a broken probe, so it was mutated explicitly (drop the `normalizePermissionForwardingSessionId` guard); it went red alone, confirming a real invariant pin.

The Step 4 red produced the reported symptom directly: `reports a self-naming marker as unresolvable and writes no request` took 5006 ms before the fix, forwarding to itself and waiting out the serving grace window, and is instant after.

Two facts were confirmed against Pi's own checkout at `../../pi` after the pre-completion reviewer raised them, both mechanism reads rather than pinned-version API claims.
`SessionManager`'s `createSessionId()` is `randomUUID()` and `generateId` is a collision-checked 8-hex id, so two live sessions never share one — closing the reviewer's open question about whether the self-target skip could refuse a legitimate target.
More usefully, `this.sessionId = newSessionId` appears at two sites in `SessionManager`: the session id genuinely mutates **in place** on the same object, with no fresh `ExtensionContext` and no `session_start`.
That is the churn mechanism the reporter asserted in follow-up finding 1, and until this read the evidence for it was the reporter's word plus the upstream env-refresh gap.

The env-hygiene step was verified in the inverse direction, since it repairs no current failure: with an ambient `PI_SUBAGENT_PARENT_SESSION`, 18 tests across three files fail without it and pass with it.

One small deviation, in test mechanics rather than design.
The `hasUI`-guard-deletion mutation was first written as `if (false)`, which Biome rejects as `noConstantCondition` — a lint error is not a discrimination signal.
Rewritten as `if (ctx.hasUI === undefined)`, a compared-literal change that depends on a runtime value, per the guidance to prefer changing a literal over restructuring control flow.

Pre-completion reviewer: **PASS** — ready for `/ship`.
It independently re-derived the narrowed guard (confirming `selectAuthorizer` is the only other `isSubagent` consumer and that it returns on `hasUI` first), traced the #719/#721 invariants to their Phase 13 history entry and confirmed both still hold and are pinned by tests rather than prose, and spot-checked the `nicobailon/pi-subagents` root-process claim at `v0.67.0`.
No WARN findings.

[#22]: https://github.com/gotgenes/pi-packages/issues/22
[#789]: https://github.com/gotgenes/pi-packages/issues/789
[#907]: https://github.com/gotgenes/pi-packages/issues/907
[#911]: https://github.com/gotgenes/pi-packages/pull/911
[#914]: https://github.com/gotgenes/pi-packages/issues/914
