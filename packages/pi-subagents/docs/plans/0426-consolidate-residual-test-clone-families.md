---
issue: 426
issue_title: "pi-subagents: consolidate residual test clone families"
---

# Consolidate residual test clone families

## Release Recommendation

**Release:** ship independently

The architecture roadmap (`docs/architecture/architecture.md`, Phase 18, step 7) tags this issue "Independent of the disentanglement spine — can land at any time" and carries no `Release: batch` annotation.
It is a test-only consolidation with no production-surface change, so it ships on its own.

## Problem Statement

fallow reports a long tail of test clone groups in `pi-subagents` (currently 24 test clone groups across the suite).
A handful of these clone families are stable test scaffolding — tmp-directory setup, repeated arrange-then-act blocks, and near-identical menu-assertion cases — that the Phase 18 disentanglement spine does not rewrite as a side effect.
They warrant their own shared fixtures rather than riding along with a production refactor.

The goal is to extract shared fixtures for the clone families fallow identifies in the four named test files, dropping the package's test clone-group count below 15.

## Goals

- Eliminate the cross-file tmp-directory + `writeGlobal`/`writeProject` duplication between `test/settings.test.ts` and `test/layered-settings.test.ts` via a shared fixture helper.
- Eliminate the three internal clone groups in `test/lifecycle/create-subagent-session.test.ts` by extracting the repeated arrange (factory session + deps) while keeping each `createSubagentSession(...)` act explicit.
- Eliminate the four internal clone groups in `test/ui/agent-config-editor.test.ts` — convert the menu-option-structure cases to a table-driven `it.each` and hoist the shared `filePath`/arrange in the Edit/Delete blocks.
- Land the package below 15 test clone groups (the four files contribute exactly 10 of the current 24 groups → 14 remaining).
- Keep the full `vitest` suite green and the assertion strength unchanged (no behavioral coverage loss).

This change is **not breaking** — it touches only test files and adds test-only helpers; no production module, export, or default changes.

## Non-Goals

- The production-code clone in `src/ui/agent-config-editor.ts` (the `location`/`targetDir`/`targetPath` block, dup `ff960d84`) — the issue scopes to *test* clone families; a production extraction is a separate concern.
- The remaining test clone groups outside the four named files (`subagent-manager.test.ts`, `subagent.test.ts`, `concurrency-limiter.test.ts`, `workspace-bracket.test.ts`, `session-config.test.ts`, `get-result-tool.test.ts`, `spawn-config.test.ts`, `agent-creation-wizard.test.ts`, `agent-file-ops.test.ts`, `agent-menu.test.ts`, `agent-widget.test.ts`).
  The cross-file group `5d8dbd48` (`subagent-manager.test.ts` ↔ `subagent.test.ts`) is explicitly left alone — neither side is a target file.
- The cross-package `vitest.config.ts` clone (`e5e6691e`, 6 instances) — not a `pi-subagents` test-suite group and not in scope.
- Phase 18 step 8 ([#427]), the UI-direction ADR — a separate, later step.

## Background

Relevant existing test-helper conventions live in `packages/pi-subagents/test/helpers/`:

- `make-deps.ts`, `make-spawn-config.ts`, `make-subagent.ts`, `manager-stubs.ts`, `mock-session.ts`, `stub-ctx.ts`, `subagent-session-io.ts`, `ui-stubs.ts` — each exports `createX`/`makeX` factory functions with matching `*.test.ts` self-tests.
- `subagent-session-io.ts` already exports `createFactorySession`, `createSubagentSessionDeps`, `createSubagentSessionIO`, `createAgentLookup`, `createChildLifecycleMock` — the create-subagent-session consolidation builds on these.
- `ui-stubs.ts` already exports `createTestSubagentConfig`, `makeFileOps`, `makeMenuUI` — the agent-config-editor consolidation builds on these.

Constraints from the `testing` skill that shape this plan:

- **Do not wrap the system-under-test call in a helper to eliminate a duplication-metric clone — the repeated act is the test subject, not duplication to remove.**
  Consolidate the *arrange*, not the *act*.
  For `create-subagent-session`, extract the factory-session + deps arrange but keep `await createSubagentSession(...)` written out in each test.
- **Group shared setup in a describe-scoped `beforeEach` and keep the act explicit** when the arrangement is uniform.
- A table-driven `it.each` keeps the act visible in the parameterized body (run once per row) and is the right tool for the menu-option-structure cases — it is not a helper that hides the act.
- Test-only refactors carry the `test:` conventional-commit type.

Each helper module in `test/helpers/` ships a paired `*.test.ts`; any new shared helper follows that convention.

## Design Overview

This is a refactor verified by the existing suite staying green plus a falling fallow clone count — there are no new red→green behavior cycles.
Three independent consolidations, each scoped to its file(s).

### 1. Settings tmp-dir fixture (cross-file)

`test/settings.test.ts` and `test/layered-settings.test.ts` both stand up two `mkdtempSync` directories in `beforeEach`, tear them down in `afterEach`, and define identical `writeGlobal`/`writeProject` helpers (clone groups `21d1fb01`, `4003c0e7` span both files; `4fc062db` is internal to `layered-settings.test.ts`).

Extract a shared fixture into `test/helpers/tmp-settings-dirs.ts`:

```typescript
export interface SettingsDirs {
  globalDir: string; // agentDir / global scope
  projectDir: string; // cwd / project scope
  globalFile: (filename?: string) => string;
  projectFile: (filename?: string) => string;
  writeGlobal: (obj: unknown, filename?: string) => void;
  writeProject: (obj: unknown, filename?: string) => void;
}

// Caller wires it into beforeEach/afterEach:
export function createSettingsDirs(filename: string): SettingsDirs;
export function disposeSettingsDirs(dirs: SettingsDirs): void;
```

Each test file calls `createSettingsDirs(...)` in `beforeEach` and `disposeSettingsDirs(...)` in `afterEach`, then references `dirs.writeGlobal` / `dirs.writeProject`.
`settings.test.ts` uses `"subagents.json"`; `layered-settings.test.ts` uses its `FILENAME` constant.
The malformed-settings warn-assertion clone inside `layered-settings.test.ts` (`4fc062db`, two adjacent `it` blocks) collapses into a single `it.each` over `[malformed-global, malformed-project]` rows that share the spy-assert body.

Interaction sketch (consumer call site, ~5 lines):

```typescript
let dirs: SettingsDirs;
beforeEach(() => { dirs = createSettingsDirs("subagents.json"); });
afterEach(() => { disposeSettingsDirs(dirs); });
it("loads from global when no project file", () => {
  dirs.writeGlobal({ maxConcurrent: 16 });
  expect(loadSettings(dirs.globalDir, dirs.projectDir)).toEqual({ maxConcurrent: 16 });
});
```

The helper owns only filesystem scaffolding (Tell-Don't-Ask: callers ask it to write, not for raw paths to write themselves); it does not import or know about `loadSettings`/`loadLayeredSettings`, so the act stays in the test.

### 2. create-subagent-session arrange helper (internal)

Clone groups `48ff1484`, `c92feb70`, `5fbe9ebb` all live in the `createSubagentSession — post-bind recursion guard` describe block (lines ~204–262).
Each test repeats:

```typescript
const session = createFactorySession({ toolsBeforeBind, toolsAfterBind });
io.createSession.mockResolvedValue({ session });
await createSubagentSession(
  { snapshot: STUB_SNAPSHOT, type: "Explore" },
  createSubagentSessionDeps({ io, exec, registry: mockAgentLookup }),
);
const postBindArgs = session.setActiveToolsByName.mock.calls[0][0];
```

The variation is the factory tool-list config and the assertions; the act is identical.
Add two file-local arrange helpers (the factory mocks differ per test, so a describe-scoped `beforeEach` cannot fully arrange):

```typescript
function arrangeFactory(opts?: Parameters<typeof createFactorySession>[0]) {
  const session = createFactorySession(opts);
  io.createSession.mockResolvedValue({ session });
  return session;
}
function defaultDeps() {
  return createSubagentSessionDeps({ io, exec, registry: mockAgentLookup });
}
```

Each test becomes `const session = arrangeFactory({...}); await createSubagentSession({ snapshot: STUB_SNAPSHOT, type: "Explore" }, defaultDeps());` — the act line stays written out.
The remaining two-line arrange+act sequence falls below fallow's clone threshold.
These helpers stay file-local (one consumer file), so no new `test/helpers/` module is needed.

### 3. agent-config-editor table-driven menu cases (internal)

Clone groups `4ac7b228`, `a8e71e9c` (×3), `e36d2314` cluster in the "Menu option structure" block (lines ~104–139); `23fe1f93` is in the Edit/Delete blocks (~180–210).

- **Menu-option-structure cases** → one `it.each` table.
  Each existing case differs only in (a) the `resolveAgentConfig` mock (default vs. custom vs. disabled) and (b) the expected option array.
  Model the rows as `{ name, config, filePath, expected }` and run the shared act once per row:

  ```typescript
  it.each([
    { name: "default agent, no file", config: testDefaultConfig, filePath: undefined,
      expected: ["Eject (export as .md)", "Disable", "Back"] },
    // …one row per existing menu-structure case…
  ])("shows $name options", async ({ config, filePath, expected }) => {
    vi.spyOn(testRegistry, "resolveAgentConfig").mockReturnValue(config);
    const { editor, ui } = setupDetail([undefined], filePath ? { filePath } : {});
    await editor.showAgentDetail(ui, "test-agent");
    expect((ui.select.mock.calls[0][1] as string[])).toEqual(expected);
  });
  ```

  The act (`editor.showAgentDetail(...)`) stays visible in the table body.

- **Edit/Delete block (`23fe1f93`)** → hoist the shared `const filePath = "/project/.pi/agents/test-agent.md"` to a describe-scoped constant and keep each `await editor.showAgentDetail(...)` act explicit; the residual per-test arrange (`setupDetail`, `ui.editor`/`ui.confirm` resolution) stays inline because it carries the test's intent.

No change to `setupDetail`, `makeEditor`, or `ui-stubs.ts` — they already provide the right arrange seam.

## Module-Level Changes

- `test/helpers/tmp-settings-dirs.ts` — **new**: shared tmp-dir fixture (`createSettingsDirs`, `disposeSettingsDirs`, `SettingsDirs` type, `writeGlobal`/`writeProject`).
- `test/helpers/tmp-settings-dirs.test.ts` — **new**: self-test for the fixture (follows the `test/helpers/*.test.ts` convention — every helper module ships a paired test).
- `test/settings.test.ts` — **changed**: replace inline tmp-dir `beforeEach`/`afterEach`/`writeGlobal`/`writeProject` with the shared fixture.
- `test/layered-settings.test.ts` — **changed**: same fixture swap; fold the two adjacent malformed-settings warn cases into one `it.each`.
- `test/lifecycle/create-subagent-session.test.ts` — **changed**: add file-local `arrangeFactory`/`defaultDeps`; rewrite the post-bind-guard tests to call them while keeping each `createSubagentSession(...)` act explicit.
- `test/ui/agent-config-editor.test.ts` — **changed**: convert the menu-option-structure cases to `it.each`; hoist the shared `filePath` in the Edit/Delete blocks.

No `src/` files change.
No SKILL.md, architecture-doc, or README references to the affected test internals exist to update — these are intra-test fixtures (verified: the architecture roadmap references the *issue* `#426`, not the specific helpers).
The roadmap step's status flips to ✅ in a follow-up doc pass at ship time, not in this plan (consistent with how steps 1–6 were marked).

## Test Impact Analysis

This issue *is* a test-maintenance change, so the standard extraction lens is inverted:

1. **New tests enabled** — only the new `tmp-settings-dirs.test.ts`, a self-test pinning the shared fixture's filesystem behavior (writes land at the right global/project paths; dispose removes both dirs).
   No production seam is newly testable.
2. **Tests becoming redundant** — none are removed outright.
   The two malformed-settings cases in `layered-settings.test.ts` merge into one `it.each` (two rows = same two assertions, no coverage loss); the agent-config-editor menu cases merge into one `it.each` (one row per former case, identical assertions).
   The total assertion set is preserved; only the surrounding arrange is deduplicated.
3. **Tests that must stay as-is** — the act in every consolidated test (`loadSettings`/`loadLayeredSettings`/`createSubagentSession`/`showAgentDetail`) stays written out per the `testing` skill rule; the distinct intent of each Edit/Delete case (write vs. no-write vs. cancel) stays inline.

## Invariants at risk

The four target files belong to surfaces earlier Phase 17/18 steps refactored (`subagent-session-io.ts` fixtures from #378/#412; `create-subagent-session` from #257/#265; `agent-config-editor` UI from the disentanglement spine).
The invariant at risk is purely **coverage preservation** — a consolidation must not silently drop an assertion.
Each consolidation step is gated by:

- The full `vitest` suite staying green (test count must not *drop* except by the deliberate `it.each` merges, whose row count equals the former case count).
- Running `pnpm fallow dupes` after each step to confirm the targeted clone groups disappear and no new ones appear.

No production `Outcome:`/`Landed:` invariant from a prior roadmap step is touched, because no `src/` file changes.

## Refactor Order

These are refactor (not red→green) steps: each makes a consolidation, verifies the suite stays green and the targeted clone groups drop, then commits with `test:`.
Order is independent — the three consolidations do not depend on each other — but listed for clean, reviewable commits.

1. **Shared settings tmp-dir fixture.**
   Add `test/helpers/tmp-settings-dirs.ts` + `tmp-settings-dirs.test.ts`; migrate `test/settings.test.ts` and `test/layered-settings.test.ts` to it; fold the two malformed-settings cases in `layered-settings.test.ts` into one `it.each`.
   Verify: `pnpm --filter @gotgenes/pi-subagents exec vitest run test/settings.test.ts test/layered-settings.test.ts test/helpers/tmp-settings-dirs.test.ts` green; `pnpm fallow dupes` shows `21d1fb01`, `4003c0e7`, `4fc062db` gone.
   Commit: `test: extract shared settings tmp-dir fixture (#426)`.
2. **create-subagent-session arrange helpers.**
   Add file-local `arrangeFactory`/`defaultDeps`; rewrite the post-bind-guard tests to use them with the act kept explicit.
   Verify: `pnpm --filter @gotgenes/pi-subagents exec vitest run test/lifecycle/create-subagent-session.test.ts` green; clone groups `48ff1484`, `c92feb70`, `5fbe9ebb` gone.
   Commit: `test: consolidate create-subagent-session post-bind arrange (#426)`.
3. **agent-config-editor table-driven menu cases.**
   Convert the menu-option-structure cases to `it.each`; hoist the shared `filePath` in the Edit/Delete blocks.
   Verify: `pnpm --filter @gotgenes/pi-subagents exec vitest run test/ui/agent-config-editor.test.ts` green; clone groups `4ac7b228`, `a8e71e9c`, `e36d2314`, `23fe1f93` gone.
   Commit: `test: table-drive agent-config-editor menu cases (#426)`.
4. **Final verification.**
   Run the full suite (`pnpm --filter @gotgenes/pi-subagents exec vitest run`), `pnpm run check`, `pnpm run lint`, `pnpm fallow dead-code` (catch orphaned imports left by removed inline helpers), and `pnpm fallow dupes` to confirm the package's test clone-group count is below 15 (expected: 24 → 14).
   No separate commit unless cleanup is needed.

## Risks and Mitigations

- **Risk: an `it.each` merge silently drops an assertion.**
  Mitigation: map each former `it` to exactly one table row with the same assertions; confirm the post-merge test count equals (old count − merged duplicates) and the suite stays green.
- **Risk: removing an inline `writeGlobal`/`writeProject` leaves an orphaned import** (Biome `noUnusedImports` is warning-level, exit 0).
  Mitigation: step 4 runs `pnpm fallow dead-code`; re-check each migrated file's imports (`mkdirSync`, `writeFileSync`, `mkdtempSync`, `rmSync`, `tmpdir`, `join`) after the fixture swap.
- **Risk: a helper that wraps the act re-introduces the "act is the subject" smell.**
  Mitigation: the design keeps every `loadSettings`/`createSubagentSession`/`showAgentDetail` call written out in the test body; helpers cover arrange only.
- **Risk: the fixture's `filename` parameterization diverges from the two call sites' expectations** (`subagents.json` vs. `FILENAME`).
  Mitigation: `createSettingsDirs(filename)` takes the filename explicitly; the self-test pins both path shapes.

## Open Questions

- Whether to also dissolve the production clone in `src/ui/agent-config-editor.ts` (dup `ff960d84`) — deferred as a Non-Goal; revisit if the Phase 18 UI-direction ADR (#427) reworks that file anyway.
- Whether a shared tmp-dir fixture should live in a cross-package location (other packages stand up similar dirs) — out of scope; keep it `pi-subagents`-local until a second consumer appears.

[#427]: https://github.com/gotgenes/pi-packages/issues/427
