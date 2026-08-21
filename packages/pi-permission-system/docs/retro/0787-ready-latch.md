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

[ADR 0012]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0012-cross-node-extension-contract.md
[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#789]: https://github.com/gotgenes/pi-packages/issues/789
