---
issue: 297
issue_title: "Add composition-root test coverage for pi-permission-system (makeFakePi harness + backfill)"
---

# Retro: #297 — Add composition-root test coverage for pi-permission-system

## Stage: Planning (2026-06-01T16:55:17Z)

### Session summary

Produced a numbered TDD plan to build a `makeFakePi()` harness in `test/helpers/` and backfill six composition-root wiring tests against the real `piPermissionSystemExtension(pi)` factory.
The plan covers the [#296] regression class (registry sharing), handler-registration completeness, shutdown teardown, service/gate formatter-registry sharing, `ready`-after-publish ordering, and a characterization of the suspected multi-instance global-state bug, then a final step consolidating the existing inline `createToolCallHarness` onto the new harness.

### Observations

- Discovered an existing inline `createToolCallHarness` in `test/permission-system.test.ts` (≈line 110) that already runs the real factory with a hand-rolled fake `pi` — but with a **no-op** event bus (not `createEventBus()`), a `Record` of handlers (not an inspectable map), and no `fire()` driver.
  `makeFakePi()` is its generalization; user chose to build standalone first, then fold consolidation into this plan as a final step.
- Key correction carried into the plan: the issue pseudocode keys the subagent registry and the `subagents:child:session-created` payload by `sessionDir`, but the current code (post [#221] / [#296]) keys by `sessionId`.
  `isSubagentExecutionContext` checks `registry.has(ctx.sessionManager.getSessionId())`.
  Tests must use `sessionId`.
- The factory calls `getAgentDir()` internally (via `createExtensionRuntime()` with no `agentDir` option), so every composition-root test must `vi.stubEnv("PI_CODING_AGENT_DIR", <tmpdir>)` and clean **both** `Symbol.for()` global slots (`:service` and `:subagent-registry`) in `afterEach`, or factory runs leak across tests.
  The registry slot has no public unpublish accessor by design, so tests delete it directly (the `subagent-registry.test.ts` pattern).
- User decision: target 6 (suspected latent bug where a child's `session_shutdown` unpublishes the parent's global service) is **characterize-only** — assert current behavior, use `test.fails` for the desired behavior if confirmed, and file a separate fix issue.
- `pnpm exec markdownlint-cli2` is not installed in the workspace; a `rumdl fmt` pre-commit hook handles markdown formatting and passed on commit.
- Next stage is `/tdd-plan` — the plan is structured as red→green→commit cycles.

## Stage: Implementation — TDD (2026-06-01T17:14:15Z)

### Session summary

Completed all 7 planned TDD cycles: built the `makeFakePi()` harness and the six composition-root wiring tests (handler-registration completeness, subagent-registry sharing, shutdown teardown, service/gate formatter sharing, `ready`-after-publish ordering, multi-instance characterization), then consolidated the inline `createToolCallHarness` onto `makeFakePi`.
Test count went from 1662 to 1669 (`+6` passing `+1` expected-fail); the full suite is green and `make-fake-pi.ts` now backs `permission-system.test.ts` as well.

### Observations

- Target 1 (registry sharing) could not use a bare "not blocked" assertion: the forwarding path polls for a parent response with a 10-minute timeout (`PERMISSION_FORWARDING_TIMEOUT_MS`), so a no-response forward times out to a block.
  Implemented a real round-trip: fire the child `tool_call` without awaiting, poll the parent's `requests/` dir for the child's request file, write an approval response, then await.
  This both proves the shared registry (the child detected itself as a subagent and entered forwarding) and completes in well under a second.
- Target 4 (formatter sharing) avoided the `mcp` branch of `formatAskPrompt` (which needs a resolved `result.target`) by registering a formatter for a plain extension tool name (`demo`) and asserting the formatter's marker string appears in the captured `ui.select` title.
  The preview is embedded into the ask message, which becomes the first line of the `ui.select` title.
- Target 6 confirmed the suspected latent bug: a child instance's `session_shutdown` calls `unpublishPermissionsService()`, which deletes the single global service slot, leaving a still-live parent with `getPermissionsService() === undefined`.
  Documented with a passing characterization `it` plus an `it.fails` for the desired behavior, and filed follow-up fix issue #302 (the fix is intentionally out of scope here).
- Consolidation (step 7) was low-risk: `.handlers` was only used in three internal spots of the 2585-line file (`createToolCallHarness`, `cleanup`, `runToolCall`) plus one stray `harness.handlers.session_shutdown` at line ~2320 that the first grep missed; switching the harness to store a `FakePi` and drive handlers via `pi.fire(...)` let the `MockHandler` type be removed.
- Pre-completion reviewer: WARN — one non-blocking finding (the `package-pi-permission-system` skill's Testing section did not list `make-fake-pi.ts`).
  Addressed in a follow-up `docs:` commit that documents the harness and the required global-slot/env cleanup.

## Stage: Final Retrospective (2026-06-01T17:25:56Z)

### Session summary

A single session carried issue #297 cleanly through all four stages: plan → TDD (7 cycles) → ship → retro.
The work delivered the `makeFakePi()` composition-root harness, six wiring tests, and a consolidation of the inline `createToolCallHarness`, confirmed a latent multi-instance global-service bug (filed as #302), and shipped green CI with the issue closed and no release-please bump (test-only commits).

### Observations

#### What went well

- Read-before-write discipline prevented rework on the two trickiest tests.
  Reading `forwarded-permissions/polling.ts` first surfaced the 10-minute `PERMISSION_FORWARDING_TIMEOUT_MS`, which forced a real fire-without-await → poll `requests/` → write response round-trip for target 1 instead of a naive "not blocked" assertion that would have hung.
  Reading `permission-prompts.ts` revealed the `mcp` branch of `formatAskPrompt` needs a resolved `result.target`, so target 4 used a plain extension tool name (`demo`) instead.
- Incremental verification: `pnpm run check` and the affected test file ran after every one of the 7 TDD steps, not just at the end.
  No feedback-loop gap.
- The forwarding round-trip pattern (fire the child `tool_call` without awaiting, poll the parent `requests/` dir, write an approval response, then await) is a novel, reusable technique for exercising the file-based permission-forwarding IPC without hitting its long timeout.
- Target 6's confirm-and-defer flow was clean: a passing characterization `it` documents current behavior, an `it.fails` documents the desired behavior and flips when fixed, and #302 carries the fix out of scope.

#### What caused friction (agent side)

- `missing-context` — during the step-7 consolidation, the enumeration grep for `.handlers` usages was piped through `head -40`, which truncated output and hid a stray `harness.handlers.session_shutdown` at line ~2320 of the 2585-line `permission-system.test.ts`.
  Impact: one failing-test iteration, caught immediately by running the affected test file; ~1 extra tool cycle, no follow-up commit.
  The existing testing-skill "grep all call sites before removal" rules were followed in spirit — the slip was truncating the grep output, an execution detail not worth a durable rule.

#### What caused friction (user side)

- None.
  User involvement was strategic and minimal: two `ask_user` decisions during planning (consolidation scope, and characterize-vs-fix for target 6) set the direction for the whole session, and the "did we find any bugs?" check between ship and retro confirmed the #302 hand-off landed.

### Diagnostic details

- **Model-performance correlation** — the `pre-completion-reviewer` subagent ran on `anthropic/claude-sonnet-4-6` (its frontmatter default), an appropriate fit for judgment-heavy review work; it correctly surfaced the one documentation-staleness WARN.
- **Escalation-delay tracking** — no `rabbit-hole` friction; the single test failure resolved in one iteration.
- **Feedback-loop gap analysis** — verification ran incrementally after each TDD step; no gap.
- **Unused-tool detection** — `colgrep` was barely used during implementation, but exact-symbol `grep`/`Read` were the right tools here (the relevant symbols were already known), so no missed-tool finding.

### Changes made

1. Added the file-based forwarding round-trip test pattern (fire-without-await → poll `requests/` → write `responses/<id>.json` → await) to the Testing section of `.pi/skills/package-pi-permission-system/SKILL.md`, to help the #302 follow-up write composition-root forwarding tests without hitting the 10-minute timeout.
2. Appended this Final Retrospective stage entry to `packages/pi-permission-system/docs/retro/0297-composition-root-test-coverage.md`.

[#221]: https://github.com/gotgenes/pi-packages/issues/221
[#296]: https://github.com/gotgenes/pi-packages/issues/296
