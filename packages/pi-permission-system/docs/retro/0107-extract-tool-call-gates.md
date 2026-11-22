---
issue: 107
issue_title: "refactor: break handleToolCall into per-gate functions"
---

# Retro: #107 — break handleToolCall into per-gate functions

## Final Retrospective (2026-05-07T00:30:00Z)

### Session summary

Extracted four permission gates from a ~600-line `handleToolCall` into `src/handlers/gates/`, added 44 per-gate unit tests, removed 18 redundant integration tests, and wired the orchestrator as a ~30-line chain.
Also added an npm→pnpm shim via `mise.toml` after discovering the project had no enforcement of its declared package manager.
Released as v5.4.0.

### Observations

#### What went well

- The TDD cycle was clean: red→green→commit for each gate, with existing integration tests providing a safety net during the final wiring step.
  All 1165 (later 1147) tests passed at every checkpoint.
- The user's "why do we need deep mocking?" question surfaced the real design issue (`ExtensionRuntime` as a god object, #111) rather than letting us paper over it with `Record<string, any>`.
  This is a good example of asking "why" to get past the surface symptom.
- The npm shim pass-through for `npm root` was a pragmatic solution that let us enforce pnpm without breaking our own startup path.

#### What caused friction (agent side)

1. `instruction-violation` — Used `npm run build`, `npx vitest run`, and `npm run lint:all` throughout all 9 TDD steps despite the project using pnpm exclusively (`pnpm-lock.yaml`, `"packageManager"` in `package.json`).
   User-caught after all steps were complete.
   Impact: no functional breakage (scripts are runner-agnostic), but undermines the pnpm enforcement the session itself added.
   Root cause: `AGENTS.md` and all prompt templates (`tdd-plan.md`, `build-plan.md`) said `npm`/`npx`, and no rule said otherwise.

2. `instruction-violation` — Introduced `Record<string, any>` in gate test factories to work around deep mock typing, violating the "avoid `any`" rule in `AGENTS.md`.
   User-caught.
   Impact: one extra `style:` commit (`eeb9d20`) to replace with `Record<string, unknown>`.

3. `rabbit-hole` — First attempt at the npm shim destroyed positional parameters with `set -- $PATH`, causing `npm root -g` to silently return the wrong path (local instead of global).
   Self-identified on test.
   Impact: two revisions of the shim script before it worked correctly.

4. `missing-context` — Tried to use `isToolCallEventType` from the Pi SDK inside extracted gates by reconstructing a fake event object.
   The SDK checks `event.toolName` but the reconstructed event used `event.name`.
   Self-identified during TDD red→green.
   Impact: minor — removed the SDK call in favor of a direct `tcc.toolName` check, which is simpler anyway.

5. `missing-context` — Forgot `[env]` section header in `mise.toml`, causing `_.path` to have no effect.
   User-caught after restarting Pi.
   Impact: one round-trip of "restart Pi → still broken → fix config → restart again."

#### What caused friction (user side)

- The `npm` vs `pnpm` issue could have been caught earlier if the project had established the pnpm rule in `AGENTS.md` before this session.
  The user noticed it organically mid-session, which led to the productive shim work, but the TDD steps had already landed 9 commits using `npm`.
- The user's sequential "why" questions (deep mocking → `ExtensionRuntime` → existing issues) were highly effective at reaching root cause.
  This pattern of redirecting from symptom to cause saved us from filing a narrow issue (#114) when the real target (#111) already existed.

### Changes made

1. `AGENTS.md` — added pnpm-over-npm rule in § Code Style; fixed `npm run build` → `pnpm run build` and `npx vitest run` → `pnpm vitest run` in § Testing.
2. `.pi/prompts/tdd-plan.md` — replaced all `npx vitest run`, `npm run build`, `npm run lint:all`, `npm run lint:fix` with `pnpm` equivalents.
3. `.pi/prompts/build-plan.md` — same replacements.
4. `.pi/prompts/README.md` — replaced `npm` test/lint script references with `pnpm`.
