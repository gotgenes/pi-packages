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

[#22]: https://github.com/gotgenes/pi-packages/issues/22
[#789]: https://github.com/gotgenes/pi-packages/issues/789
[#907]: https://github.com/gotgenes/pi-packages/issues/907
[#911]: https://github.com/gotgenes/pi-packages/pull/911
[#914]: https://github.com/gotgenes/pi-packages/issues/914
