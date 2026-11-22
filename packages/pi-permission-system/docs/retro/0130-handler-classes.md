---
issue: 130
issue_title: "refactor: replace HandlerDeps with handler classes using narrow constructor injection"
---

# Retro: #130 — replace HandlerDeps with handler classes

## Final Retrospective (2026-05-08T02:55:00Z)

### Session summary

Replaced the monolithic `HandlerDeps` interface and free-function handlers with three handler classes (`SessionLifecycleHandler`, `AgentPrepHandler`, `PermissionGateHandler`), each with 2–3 narrow constructor deps.
Absorbed `canPrompt`/`prompt`/`createPermissionRequestId` into `PermissionSession`, added a `ToolRegistry` interface, relocated `PromptPermissionDetails` to `permission-prompter.ts`, and deleted `src/handlers/types.ts`.
Released as v5.11.0.
This completes the full handler decomposition series (#126 → #127 → #128 → #129 → #130).

### Observations

#### What went well

- The 8-step incremental plan converted one handler class at a time, keeping the repo green after every commit.
  Zero rework across all steps.
- The lift-and-shift pattern (introduce new alongside old, migrate, delete old last) worked exactly as designed.
  `HandlerDeps` survived until step 7, so steps 4–6 could each wire their new class in `index.ts` independently.
- Test factory simplification was dramatic: `makeDeps()` with 8 unrelated fields replaced by `new Handler(mockSession, ...)` with 2–3 typed deps.
  No `as unknown as` casts needed for the narrow mocks.
- Full test suite (1288 tests) passed at every step with no behavioral changes, confirming this was a pure refactor.
- The plan correctly identified that `canPrompt`/`prompt` needed to migrate to `PermissionSession` (deferred from #129), preventing a gap when `HandlerDeps` was deleted.

#### What caused friction (agent side)

- `missing-context` — Step 7 (delete `HandlerDeps`) broke `tests/permission-prompter.test.ts` which imported `PromptPermissionDetails` from the deleted `src/handlers/types.ts`.
  The plan's module-level changes table did not list this test file.
  Caught by `pnpm run build`, fixed immediately.
  Impact: one extra build-fix cycle, no rework.
- `missing-context` — Stale `HandlerDeps` references in JSDoc comments across `src/permission-prompter.ts`, `src/session-logger.ts`, `src/forwarding-manager.ts`, and `docs/architecture/permission-prompter.md` were not flagged by the plan.
  Caught during cleanup with `grep`.
  Impact: added friction but no rework — comments were updated in the same commit.
- `other` — Autoformat (Biome) reordered imports in `src/index.ts` between the handler barrel edit and the wiring edit in step 4, causing the second `Edit` call to fail on `oldText` mismatch.
  Required re-reading the file to get the new import order.
  Impact: one extra read + retry, ~10 seconds.

#### What caused friction (user side)

- No friction observed.
  The user's plan was well-scoped and the issue body provided exact class signatures, making implementation straightforward.
