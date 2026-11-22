---
issue: 342
issue_title: "Retire the permission-system.test.ts catch-all"
---

# Retro: #342 — Retire the `permission-system.test.ts` catch-all

## Stage: Planning (2026-06-08T02:08:35Z)

### Session summary

Produced a redistribution plan for the 2,785-line `permission-system.test.ts` catch-all (~86 `test()` blocks).
Inventoried every test by fixture usage (`createManager`, `createManagerWithProject`, `new PermissionManager`, and the end-to-end `createToolCallHarness`) and mapped each concern to a co-located destination.
Confirmed all prerequisites are met — Step 8 ([#341]) is closed, so the collaborators are independently constructable.

### Observations

- The catch-all cleanly splits into two families: synchronous config-resolution tests (clear homes, move verbatim) and end-to-end async `tool_call` tests (overlap with existing `makeHandler` / `makeFakePi` handler and composition-root tests).
- Used `ask_user` once on the two genuine ambiguities.
  Decisions: (1) async integration tests — drop-redundant / move-unique rewritten onto `makeHandler`, not promote the heavy `createToolCallHarness`; (2) assertion fidelity — behavior-preserving (adapt to destination fixture), not byte-for-byte.
  These shape the plan toward a smaller, fully co-located suite rather than a faithful-but-heavy lift-and-shift.
- Three source modules (`status.ts`, `logging.ts`, `before-agent-start-cache.ts`) have no co-located test file today; the plan creates `test/status.test.ts`, `test/logging.test.ts`, `test/before-agent-start-cache.test.ts`.
- `createManagerWithProject` (catch-all local helper, 5 callers) is promoted to `test/helpers/manager-harness.ts`.
- This is test-only and behavior-preserving — no red phase.
  Plan recommends executing with `/build-plan`, not `/tdd-plan`, with migration steps as move → run-full-suite → commit (`test:`).
- The largest bucket (~43 tests) lands in `permission-manager-unified.test.ts`; split across two steps (surface-resolution, then session-aware `checkPermission`) to keep commits reviewable.
- Two deferred open questions left for execution: exact home for the unique `session_shutdown clears` case, and `config-store` vs `policy-loader` for `getResolvedPolicyPaths`.
- `design-review` skill judged not applicable — no production interface or wiring changes; only a test fixture is promoted.
- Step 9 of the Phase 4 roadmap in `docs/architecture/architecture.md` must get `✓ complete` in the final step.

[#341]: https://github.com/gotgenes/pi-packages/issues/341

## Stage: Implementation — TDD (2026-06-08T13:09:43Z)

### Session summary

Executed all 9 migration steps from the plan.
76 tests redistributed across 12 destination files; 10 redundant end-to-end async tests dropped.
The 2,785-line `permission-system.test.ts` catch-all was deleted; the suite is now fully co-located at 90 test files, 1813 tests.

### Observations

- No red phase throughout — suite stayed green at every commit, confirming the lift-and-shift approach was correct.
- `pi-autoformat` reflowed several files after edits; re-read before subsequent edits was occasionally needed (no failures resulted).
- The two deferred open questions from planning resolved cleanly: `getResolvedPolicyPaths` landed in `permission-manager-unified.test.ts` (not `config-store.test.ts`) since that file already held all other direct-`PermissionManager` integration tests; the `session_shutdown clears approvals` test landed in `external-directory-session-dedup.test.ts` with inline session wiring (not `composition-root.test.ts`), avoiding the need to set up full `piPermissionSystemExtension` + real config for one test.
- 10 redundant async tests were dropped: 5 path-bearing `tool_call` external_directory tests (covered by `external-directory-integration.test.ts`), 1 bash external_directory `deny` test (covered by `tool-call.test.ts`), 1 generic ask serialization test (rewritten onto `makeHandler`), and 3 session-approval dedup tests (covered by `external-directory-session-dedup.test.ts`).
- The reviewer flagged two documentation WARNs: (1) `package-pi-permission-system` skill didn’t mention the new `createManagerWithProject` export; (2) Step 8 (#341) in `architecture.md` was missing `✓ complete`.
  Both fixed before the final commit.
- `pnpm fallow dead-code` exited zero — no dead exports introduced.
- Pre-completion reviewer: PASS.

## Stage: Final Retrospective (2026-06-08T13:19:34Z)

### Session summary

Shipped issue #342 across four stages (Planning, TDD implementation, Ship, Retrospective): the 2,785-line `permission-system.test.ts` catch-all was dissolved into 12 co-located files, 10 redundant async tests dropped, and the suite is now fully co-located at 90 files / 1813 tests.
This completed Phase 4 (Step 9) of the permission-system structural roadmap.
The execution was notably clean — no rework cycles, no rabbit-holes, and the only friction was a one-shot pre-commit lint auto-fix.

### Observations

#### What went well

- The planning-stage `ask_user` decision (drop-redundant / move-unique for async tests; behavior-preserving assertions) gave the TDD stage a crisp rule to apply.
  All 16 async tests were classified without mid-execution thrashing — 10 dropped, 6 moved — exactly as the rule predicted.
- Incremental verification was exemplary: every one of the 9 migration steps ran the affected test file, then the full suite, then committed.
  The feedback-loop gap lens finds nothing to flag — this is the inverse of the "verify only at the end" anti-pattern.
- The `pre-completion-reviewer` subagent earned its keep: it caught two real documentation gaps (the `manager-harness.ts` skill doc missing the new `createManagerWithProject` export, and a pre-existing missing `✓ complete` on roadmap Step 8) that would otherwise have shipped stale.
- Both planning open questions resolved cleanly at execution time without re-opening the decision (`getResolvedPolicyPaths` → `permission-manager-unified.test.ts`; `session_shutdown clears` → inline-wired test in `external-directory-session-dedup.test.ts`).

#### What caused friction (agent side)

- `instruction-violation` (self-identified) — wrote `vi.mocked(prompter.prompt).mock.calls[0]![0]` with a non-null assertion in `test/handlers/tool-call.test.ts`; the pre-commit `eslint` hook auto-stripped the `!` (`no-unnecessary-type-assertion`, since the tsconfig does not flag the index access), modifying the file and failing the first commit attempt.
  `AGENTS.md` already documents the Biome/ESLint non-null-assertion conflict.
  Impact: 3 extra tool calls (lint check, `git diff`, re-commit) — ~1 min, no test-logic rework; the hook applied the fix automatically.
- `other` (no rework) — `pi-autoformat` reflowed edited files mid-stream, occasionally requiring a re-read before the next edit (already noted in the TDD stage; no failures resulted).

#### What caused friction (user side)

- The plan explicitly recommended executing with `/build-plan` (test-only, no red phase), but the session ran `/tdd-plan`.
  The agent adapted cleanly — treating each step as move → verify → commit without a red phase — so no rework resulted.
  Opportunity, not criticism: when a plan's execution-model recommendation and the chosen slash command diverge, the divergence was harmless here because the two prompts share the verify-and-commit spine.

### Diagnostic details

- **Model-performance correlation** — Planning ran on `anthropic/claude-opus-4-8` (judgment-heavy: inventory, the `ask_user` design decision, plan authoring) — appropriate.
  TDD implementation ran on `anthropic/claude-sonnet-4-6` (mechanical lift-and-shift across 9 steps) — well-matched cost/capability for behavior-preserving moves.
  Ship ran on `opencode-go/deepseek-v4-flash` (push, CI watch, issue close, release check) — mostly mechanical, but Step 4b (multi-issue sequence: release now vs. batch) and the stacked-issue close-detection are genuine judgment points; the flash model handled them correctly here only because the situation was simple (`test:`/`docs:`-only range, no release-please PR, final step of a finished phase).
  Borderline fit — a more capable model would be safer on a ship step that carried a live release-please merge or sibling-issue closes.
  Retrospective ran on `anthropic/claude-opus-4-8` — appropriate for synthesis.
- **Escalation-delay tracking** — no `rabbit-hole` friction; the lint auto-fix resolved in 3 tool calls, well under the 5-call threshold.
- **Unused-tool detection** — no `missing-context` gaps; `grep`/`bash` were correctly preferred over `colgrep` for the catch-all inventory (exact `test()`-block counting and fixture-usage mapping is exact-match work, not semantic search).
- **Feedback-loop gap analysis** — verification ran incrementally after every step, not just at the end; no gap to flag.

### Changes made

1. Added this Final Retrospective stage entry to `packages/pi-permission-system/docs/retro/0342-retire-permission-system-test-catch-all.md`.
   No `AGENTS.md` or prompt changes — the session's single friction point is already covered by `AGENTS.md` and auto-fixed by the pre-commit hook (user confirmed: land retro only).
