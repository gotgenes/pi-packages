---
issue: 787
issue_title: "pi-permission-system: re-emit permissions:ready at the first before_agent_start (ADR 0012 decision 3, the ready latch)"
---

# Retro: #787 — The ready latch

## Stage: Planning (2026-08-21T17:49:34Z)

### Session summary

Planned [ADR 0012] decision 3 — the ready latch — as `packages/pi-permission-system/docs/plans/0787-ready-latch.md`.
The plan lands the latch inside `PermissionServiceLifecycle` (a `ReadyAnnouncer` role beside `ServiceLifecycle`, a once-per-activation flag, one private `emitReady` shared by both emissions) and triggers it from `before_agent_start` through a new `SessionTurnPrep` collaborator extracted from `AgentPrepHandler` in a preparatory `refactor:` commit.
Four TDD steps: the Tidy First extraction, the uncalled announcer, the wiring plus the composition-root emission-count test, then the doc-contract update.

### Observations

- **Three wiring shapes were put to the operator**, and the seam-into-`AgentPrepHandler` option won.
  A second `pi.on("before_agent_start", …)` is legal — verified in the installed `@earendil-works/pi-coding-agent@0.79.1` that `pi.on` appends to a per-event list and the runner iterates all of them — but `test/helpers/make-fake-pi.ts` keys handlers in a `Map<string, RecordedHandler>`, so a second registration would silently overwrite the first in every composition-root test.
- **The operator's worry about `AgentPrepHandler`'s growing responsibilities changed the plan's shape.**
  Rather than a fifth constructor dependency, the plan opens with a Tidy First extraction (`SessionTurnPrep`: warm trigger, `session.activate`, trust-gated `refreshConfig`, then the announcement), leaving the handler at four dependencies and one job.
  The operator explicitly chose in-scope over a separate preceding issue.
- **Breaking-change question, answered no.** The payload type is unchanged, an unguarded consumer's duplicate registration surfaces as bus-caught stderr noise, and — decisively — the same hazard already exists today, since `activate` emits on every `session_start` including `/reload`, which `docs/cross-extension-api.md` documents.
  The latch makes an existing failure class common, not a new one, matching [ADR 0012] decision 7's minor-with-callout classification.
- **Release stays `mid-batch — defer`.**
  [#699]'s plan and retro already fixed [#789] as the batch tail, so `/ship-issue` lands this on `main` and leaves the release-please PR carrying [#699]'s unreleased `feat:` commits open.
- **Two semantics decided rather than asked:** the payload is recomputed from the passed `ctx` on both emissions (one code path, no captured replay), and the latch re-arms on every `activate` so a reload generation gets its own post-`session_start` emission.
- **Test-drift hazard flagged for implementation:** `makeSetup` in `before-agent-start.test.ts` must build a **real** `SessionTurnPrep` over the same real session.
  A `{ prepare: vi.fn() }` double would skip `session.activate`, and the surviving prompt-sanitization assertions depend on an activated session's path normalizer.
- No follow-up issues filed: the only candidate (renaming `AgentPrepHandler`) is recorded as an Open Question, and `pi-permission-system` has no open improvement phase, so the `roadmap-fit` skill exits at its first step.

## Stage: Implementation — TDD (2026-08-21T18:06:50Z)

### Session summary

Landed the ready latch in four commits, exactly the plan's TDD order: extract `SessionTurnPrep` from `AgentPrepHandler` (`refactor:`), add the once-per-session `ReadyAnnouncer` to `PermissionServiceLifecycle` (`refactor:`, no caller yet), wire the trigger and pin the emission count at the composition root (`feat:`), then update the channel-contract docs (`docs:`).
The pi-permission-system suite went from 3215 to 3227 tests (+12: 7 new in `session-turn-prep.test.ts` after the 4 moved lifecycle tests, 5 in `service-lifecycle.test.ts`, 2 in `composition-root.test.ts`, 1 delegation test replacing the 4 moved ones in `before-agent-start.test.ts`).
All deterministic gates green at each commit; the pre-completion reviewer returned **PASS**.

### Observations

- **The Tidy First assessor found no additional preparatory work** and verified the plan's own claims instead — `PermissionSession` matches `TurnPrepSession` exactly, both constructor call-site counts were as measured, and the `ReadyAnnouncer`-beside-`ServiceLifecycle` dual-role shape already had a precedent in `SessionLifecycleHandler`'s dependency on the narrow `ServiceLifecycle`.
  It also confirmed `make-fake-pi.ts` needed no change for the new composition-root test: `before_agent_start` was already registered and in `EXPECTED_HANDLERS`, just never fired by any existing test.
- **The plan's named test-drift hazard was real and the mitigation held.**
  `makeSetup` in `before-agent-start.test.ts` builds a real `SessionTurnPrep` over the same real session, so the surviving prompt-sanitization assertions still run against an activated session.
  When step 3 added the announcer parameter, that fixture failed loudly (`Cannot read properties of undefined`) — a stub double would have silently skipped `session.activate` instead.
- **Deviation:** `src/handlers/index.ts` (the handlers barrel) was not in the plan's Module-Level Changes table but had to export `SessionTurnPrep` for `index.ts` to import it from the barrel per the `code-design` barrel rule.
  One line, no behavior; the reviewer confirmed it as the only gap.
- **Latch semantics pinned at two levels.**
  The unit tests own the guard (`announces only once per session`, `announces again after a further activate re-arms the latch`, `announces even when no activate preceded it`, `recomputes the facts from the ctx it is handed`); the composition-root tests own the observable count (2 emissions for one generation across two turns, 4 across a reload).
- **The docs step widened slightly beyond "correctness edits":** the Ready Event example in `docs/cross-extension-api.md` now shows the guarded registration plus its `session_shutdown` disposal, since the contract's whole obligation on a consumer is that guard.
  The wholesale rewrite stays with [#789].
- **Release unchanged:** `mid-batch — defer`.
  The release-please PR [#790] is still open and must stay so until [#789] lands, or the keyed channel ships without the latch.
- **Wrong-path friction:** one `Edit` was rejected by the permission gate for a hand-built absolute path missing the `packages/` segment — the repo-relative form is the reliable one, as `AGENTS.md` says.

[ADR 0012]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0012-cross-node-extension-contract.md
[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#789]: https://github.com/gotgenes/pi-packages/issues/789
[#790]: https://github.com/gotgenes/pi-packages/pull/790
