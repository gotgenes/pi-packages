---
issue: 164
issue_title: "refactor(pi-subagents): reorganize source into domain directories"
---

# Reorganize `pi-subagents` source into domain directories

## Problem Statement

The `src/` directory has 26 files at the root level spanning four ungrouped domains (`config`, `session`, `lifecycle`, `observation`) plus two more (`service`, kept-root files).
The domain model is documented in `docs/architecture/architecture.md`, but only three domains (`tools/`, `ui/`, `handlers/`) have directories.
The flat layout makes it hard to reason about domain boundaries and navigate to related files.

## Goals

- Move the 26 flat `src/` domain files into five new subdirectories (`config/`, `session/`, `lifecycle/`, `observation/`, `service/`).
- Mirror the new structure in `test/` by moving the 25 corresponding test files.
- Update every import path (relative imports in `src/`; `#src/` aliases in `test/`).
- Leave `index.ts`, `runtime.ts`, `types.ts`, `settings.ts`, `debug.ts` at the `src/` root.
- Preserve all existing behavior — no logic changes, no interface changes, no test logic changes.

## Non-Goals

- Moving `handlers/`, `tools/`, or `ui/` — these directories already exist.
- Consolidating the three UI test files (`conversation-viewer.test.ts`, `display.test.ts`, `widget-renderer.test.ts`) that are misplaced at `test/` root — pre-existing inconsistency, out of scope.
- Any refactoring of module interfaces or logic — this is a pure filesystem reorganization.

## Background

Issue #157 (completed) removed all `.js` suffixes from relative imports and introduced `#src/*` path aliases in `tsconfig.json` and `vitest.config.ts`.
This cleanup makes the current reorganization straightforward:

- `src/` files use short relative imports (`"./X"`, `"../X"`) with no suffix noise.
- `test/` files use `#src/X` alias imports; after the move they become `#src/domain/X`.
  No `../../src/` depth changes are needed in test files.

`vitest.config.ts` uses `include: ["test/**/*.test.ts"]` so moved test files are automatically discovered in subdirectories without config changes.

## Design Overview

### Target layout

```text
src/
  config/           agent-types, default-agents, custom-agents, invocation-config
  session/          session-config, prompts, context, memory, skill-loader, env, model-resolver, session-dir
  lifecycle/        agent-manager, agent-runner, agent-record, parent-snapshot,
                    execution-state, worktree, worktree-state, usage
  observation/      record-observer, notification, notification-state, renderer
  service/          service, service-adapter
  handlers/         (unchanged)
  tools/            (unchanged)
  ui/               (unchanged)
  index.ts          (unchanged)
  runtime.ts        (unchanged)
  types.ts          (unchanged)
  settings.ts       (unchanged)
  debug.ts          (unchanged)

test/
  config/           agent-types.test.ts, custom-agents.test.ts, invocation-config.test.ts
  session/          env.test.ts, memory.test.ts, model-resolver.test.ts, prompts.test.ts,
                    session-config.test.ts, session-dir.test.ts, skill-loader.test.ts
  lifecycle/        agent-manager.test.ts, agent-record.test.ts, agent-runner.test.ts,
                    agent-runner-extension-tools.test.ts, agent-runner-settings.test.ts,
                    parent-snapshot.test.ts, usage.test.ts, worktree.test.ts, worktree-state.test.ts
  observation/      notification.test.ts, notification-state.test.ts, record-observer.test.ts,
                    renderer.test.ts
  service/          service.test.ts, service-adapter.test.ts
  handlers/         (unchanged)
  helpers/          (unchanged)
  tools/            (unchanged)
  ui/               (unchanged)
  (root)            debug.test.ts, display.test.ts, conversation-viewer.test.ts,
                    widget-renderer.test.ts, print-mode.test.ts, runtime.test.ts, settings.test.ts
```

### Import-path update rules

When a file at `src/X.ts` moves to `src/domain/X.ts`, three sets of paths change:

1. **Moved file's own imports** — previously `"./Y"` becomes:
   - `"./Y"` if `Y` is in the same domain directory
   - `"../Y"` if `Y` stays at the `src/` root (`debug`, `types`, `runtime`)
   - `"../other-domain/Y"` if `Y` moves to a different domain

2. **`src/` consumers** — files in `tools/`, `ui/`, or at the root that previously imported `"../X"` or `"./X"` update to `"../domain/X"` or `"./domain/X"` respectively.

3. **`test/` consumers** — `#src/X` aliases become `#src/domain/X`; relative test-helper imports like `"./helpers/mock-session"` become `"../helpers/mock-session"` for files that move one level deeper.

### Circular dependency between `lifecycle` and `observation`

`lifecycle/agent-manager.ts` imports `observation/notification-state` and `observation/record-observer`; `observation/record-observer.ts` imports `lifecycle/agent-manager` and `lifecycle/agent-record`.
These two domains must be moved in the same commit to avoid a broken intermediate state.

### Commit ordering

To keep each commit green, the commits follow dependency order:

1. `config/` — no cross-domain `src/` deps (imports only `debug`, `types`)
2. `session/` — no cross-domain `src/` deps (imports only `debug`, `types`, siblings)
3. `lifecycle/` + `observation/` together — circular cross-dependency
4. `service/` — depends on `lifecycle/` and `session/`, both already moved

## Module-Level Changes

### Step 1 — `config/`

New directory `src/config/`, `test/config/`.

**Files moved (src):** `agent-types.ts`, `custom-agents.ts`, `default-agents.ts`, `invocation-config.ts`.

**Files moved (test):** `agent-types.test.ts`, `custom-agents.test.ts`, `invocation-config.test.ts`.

**Imports updated inside moved `src/` files:**

| File                          | Old import           | New import                                |
| ----------------------------- | -------------------- | ----------------------------------------- |
| `config/agent-types.ts`       | `"./default-agents"` | `"./default-agents"` (sibling, unchanged) |
| `config/agent-types.ts`       | `"./types"`          | `"../types"`                              |
| `config/custom-agents.ts`     | `"./agent-types"`    | `"./agent-types"` (sibling, unchanged)    |
| `config/custom-agents.ts`     | `"./debug"`          | `"../debug"`                              |
| `config/custom-agents.ts`     | `"./types"`          | `"../types"`                              |
| `config/default-agents.ts`    | `"./types"`          | `"../types"`                              |
| `config/invocation-config.ts` | `"./types"`          | `"../types"`                              |

**Consumers updated (src):**

| Consumer                          | Old import               | New import                                  |
| --------------------------------- | ------------------------ | ------------------------------------------- |
| `src/agent-manager.ts`            | `"./agent-types"`        | `"./config/agent-types"`                    |
| `src/agent-runner.ts`             | `"./agent-types"`        | `"./config/agent-types"`                    |
| `src/index.ts`                    | `"./agent-types"`        | `"./config/agent-types"`                    |
| `src/index.ts`                    | `"./custom-agents"`      | `"./config/custom-agents"`                  |
| `src/index.ts`                    | `"./invocation-config"`  | (now via `spawn-config` — no direct import) |
| `src/tools/agent-tool.ts`         | `"../agent-types"`       | `"../config/agent-types"`                   |
| `src/tools/get-result-tool.ts`    | `"../agent-types"`       | `"../config/agent-types"`                   |
| `src/tools/helpers.ts`            | `"../agent-types"`       | `"../config/agent-types"`                   |
| `src/tools/spawn-config.ts`       | `"../agent-types"`       | `"../config/agent-types"`                   |
| `src/tools/spawn-config.ts`       | `"../invocation-config"` | `"../config/invocation-config"`             |
| `src/ui/agent-config-editor.ts`   | `"../agent-types"`       | `"../config/agent-types"`                   |
| `src/ui/agent-creation-wizard.ts` | `"../agent-types"`       | `"../config/agent-types"`                   |
| `src/ui/agent-menu.ts`            | `"../agent-types"`       | `"../config/agent-types"`                   |
| `src/ui/agent-widget.ts`          | `"../agent-types"`       | `"../config/agent-types"`                   |
| `src/ui/conversation-viewer.ts`   | `"../agent-types"`       | `"../config/agent-types"`                   |
| `src/ui/display.ts`               | `"../agent-types"`       | `"../config/agent-types"`                   |

**Consumers updated (test):** All `#src/agent-types` → `#src/config/agent-types`; `#src/custom-agents` → `#src/config/custom-agents`; `#src/invocation-config` → `#src/config/invocation-config`.

**Test file relative-import fix:** Test files moving from `test/` root to `test/config/` must update `"./helpers/..."` → `"../helpers/..."` (none of the three config test files use helpers, so no update needed here).

---

### Step 2 — `session/`

New directory `src/session/`, `test/session/`.

**Files moved (src):** `context.ts`, `env.ts`, `memory.ts`, `model-resolver.ts`, `prompts.ts`, `session-config.ts`, `session-dir.ts`, `skill-loader.ts`.

**Files moved (test):** `env.test.ts`, `memory.test.ts`, `model-resolver.test.ts`, `prompts.test.ts`, `session-config.test.ts`, `session-dir.test.ts`, `skill-loader.test.ts`.

**Imports updated inside moved `src/` files:**

| File                        | Old                | New                          |
| --------------------------- | ------------------ | ---------------------------- |
| `session/env.ts`            | `"./debug"`        | `"../debug"`                 |
| `session/env.ts`            | `"./types"`        | `"../types"`                 |
| `session/memory.ts`         | `"./debug"`        | `"../debug"`                 |
| `session/memory.ts`         | `"./types"`        | `"../types"`                 |
| `session/prompts.ts`        | `"./env"`          | `"./env"` (sibling)          |
| `session/prompts.ts`        | `"./types"`        | `"../types"`                 |
| `session/session-config.ts` | `"./env"`          | `"./env"` (sibling)          |
| `session/session-config.ts` | `"./prompts"`      | `"./prompts"` (sibling)      |
| `session/session-config.ts` | `"./skill-loader"` | `"./skill-loader"` (sibling) |
| `session/session-config.ts` | `"./types"`        | `"../types"`                 |
| `session/skill-loader.ts`   | `"./debug"`        | `"../debug"`                 |
| `session/skill-loader.ts`   | `"./memory"`       | `"./memory"` (sibling)       |

`context.ts`, `model-resolver.ts`, `session-dir.ts` have no internal relative imports.

**Consumers updated (src):**

| Consumer                        | Old import            | New import                                       |
| ------------------------------- | --------------------- | ------------------------------------------------ |
| `src/agent-runner.ts`           | `"./context"`         | `"./session/context"`                            |
| `src/agent-runner.ts`           | `"./env"`             | `"./session/env"`                                |
| `src/agent-runner.ts`           | `"./session-config"`  | `"./session/session-config"`                     |
| `src/index.ts`                  | `"./env"`             | `"./session/env"`                                |
| `src/index.ts`                  | `"./memory"`          | `"./session/memory"`                             |
| `src/index.ts`                  | `"./model-resolver"`  | `"./session/model-resolver"`                     |
| `src/index.ts`                  | `"./prompts"`         | `"./session/prompts"`                            |
| `src/index.ts`                  | `"./session-config"`  | (no direct import in index.ts — used via runner) |
| `src/index.ts`                  | `"./session-dir"`     | `"./session/session-dir"`                        |
| `src/index.ts`                  | `"./skill-loader"`    | `"./session/skill-loader"`                       |
| `src/parent-snapshot.ts`        | `"./context"`         | `"./session/context"`                            |
| `src/tools/spawn-config.ts`     | `"../model-resolver"` | `"../session/model-resolver"`                    |
| `src/ui/agent-menu.ts`          | `"../model-resolver"` | `"../session/model-resolver"`                    |
| `src/ui/conversation-viewer.ts` | `"../context"`        | `"../session/context"`                           |

**Consumers updated (test):** `#src/env` → `#src/session/env`; `#src/memory` → `#src/session/memory`; `#src/model-resolver` → `#src/session/model-resolver`; `#src/prompts` → `#src/session/prompts`; `#src/session-config` → `#src/session/session-config`; `#src/session-dir` → `#src/session/session-dir`; `#src/skill-loader` → `#src/session/skill-loader`.

**Test file relative-import fix:** Moved test files update `"./helpers/..."` → `"../helpers/..."`.
Check: none of the seven session test files import test helpers, so no update needed.

---

### Step 3 — `lifecycle/` + `observation/` (single commit)

New directories `src/lifecycle/`, `src/observation/`, `test/lifecycle/`, `test/observation/`.

**Files moved (src/lifecycle):** `agent-manager.ts`, `agent-record.ts`, `agent-runner.ts`, `execution-state.ts`, `parent-snapshot.ts`, `usage.ts`, `worktree-state.ts`, `worktree.ts`.

**Files moved (src/observation):** `notification.ts`, `notification-state.ts`, `record-observer.ts`, `renderer.ts`.

**Files moved (test/lifecycle):** `agent-manager.test.ts`, `agent-record.test.ts`, `agent-runner.test.ts`, `agent-runner-extension-tools.test.ts`, `agent-runner-settings.test.ts`, `parent-snapshot.test.ts`, `usage.test.ts`, `worktree.test.ts`, `worktree-state.test.ts`.

**Files moved (test/observation):** `notification.test.ts`, `notification-state.test.ts`, `record-observer.test.ts`, `renderer.test.ts`.

**Imports updated inside moved `src/lifecycle/` files:**

| File                           | Old                      | New                                   |
| ------------------------------ | ------------------------ | ------------------------------------- |
| `lifecycle/agent-manager.ts`   | `"./agent-record"`       | `"./agent-record"` (sibling)          |
| `lifecycle/agent-manager.ts`   | `"./agent-runner"`       | `"./agent-runner"` (sibling)          |
| `lifecycle/agent-manager.ts`   | `"./agent-types"`        | `"../config/agent-types"`             |
| `lifecycle/agent-manager.ts`   | `"./debug"`              | `"../debug"`                          |
| `lifecycle/agent-manager.ts`   | `"./notification-state"` | `"../observation/notification-state"` |
| `lifecycle/agent-manager.ts`   | `"./parent-snapshot"`    | `"./parent-snapshot"` (sibling)       |
| `lifecycle/agent-manager.ts`   | `"./record-observer"`    | `"../observation/record-observer"`    |
| `lifecycle/agent-manager.ts`   | `"./runtime"`            | `"../runtime"`                        |
| `lifecycle/agent-manager.ts`   | `"./types"`              | `"../types"`                          |
| `lifecycle/agent-manager.ts`   | `"./worktree"`           | `"./worktree"` (sibling)              |
| `lifecycle/agent-manager.ts`   | `"./worktree-state"`     | `"./worktree-state"` (sibling)        |
| `lifecycle/agent-record.ts`    | `"./execution-state"`    | `"./execution-state"` (sibling)       |
| `lifecycle/agent-record.ts`    | `"./notification-state"` | `"../observation/notification-state"` |
| `lifecycle/agent-record.ts`    | `"./types"`              | `"../types"`                          |
| `lifecycle/agent-record.ts`    | `"./usage"`              | `"./usage"` (sibling)                 |
| `lifecycle/agent-record.ts`    | `"./worktree-state"`     | `"./worktree-state"` (sibling)        |
| `lifecycle/agent-runner.ts`    | `"./agent-types"`        | `"../config/agent-types"`             |
| `lifecycle/agent-runner.ts`    | `"./context"`            | `"../session/context"`                |
| `lifecycle/agent-runner.ts`    | `"./env"`                | `"../session/env"`                    |
| `lifecycle/agent-runner.ts`    | `"./parent-snapshot"`    | `"./parent-snapshot"` (sibling)       |
| `lifecycle/agent-runner.ts`    | `"./session-config"`     | `"../session/session-config"`         |
| `lifecycle/agent-runner.ts`    | `"./types"`              | `"../types"`                          |
| `lifecycle/parent-snapshot.ts` | `"./context"`            | `"../session/context"`                |
| `lifecycle/worktree.ts`        | `"./debug"`              | `"../debug"`                          |
| `lifecycle/worktree-state.ts`  | `"./worktree"`           | `"./worktree"` (sibling)              |

`execution-state.ts`, `usage.ts` have no internal relative imports.

**Imports updated inside moved `src/observation/` files:**

| File                             | Old                             | New                              |
| -------------------------------- | ------------------------------- | -------------------------------- |
| `observation/notification.ts`    | `"./debug"`                     | `"../debug"`                     |
| `observation/notification.ts`    | `"./types"`                     | `"../types"`                     |
| `observation/notification.ts`    | `"./ui/agent-activity-tracker"` | `"../ui/agent-activity-tracker"` |
| `observation/notification.ts`    | `"./usage"`                     | `"../lifecycle/usage"`           |
| `observation/record-observer.ts` | `"./agent-manager"`             | `"../lifecycle/agent-manager"`   |
| `observation/record-observer.ts` | `"./agent-record"`              | `"../lifecycle/agent-record"`    |
| `observation/renderer.ts`        | `"./notification"`              | `"./notification"` (sibling)     |
| `observation/renderer.ts`        | `"./ui/display"`                | `"../ui/display"`                |

`notification-state.ts` has no internal relative imports.

**Consumers updated (src):**

| Consumer                           | Old import                             | New import                         |
| ---------------------------------- | -------------------------------------- | ---------------------------------- |
| `src/index.ts`                     | `"./agent-manager"`                    | `"./lifecycle/agent-manager"`      |
| `src/index.ts`                     | `"./agent-runner"`                     | `"./lifecycle/agent-runner"`       |
| `src/index.ts`                     | `"./parent-snapshot"`                  | `"./lifecycle/parent-snapshot"`    |
| `src/index.ts`                     | `"./worktree"`                         | `"./lifecycle/worktree"`           |
| `src/index.ts`                     | `"./notification"`                     | `"./observation/notification"`     |
| `src/index.ts`                     | `"./record-observer"`                  | (not imported directly from index) |
| `src/index.ts`                     | `"./renderer"`                         | `"./observation/renderer"`         |
| `src/runtime.ts`                   | (no changes — only imports from `ui/`) | —                                  |
| `src/types.ts`                     | `"./agent-record"`                     | `"./lifecycle/agent-record"`       |
| `src/tools/agent-tool.ts`          | `"../agent-manager"`                   | `"../lifecycle/agent-manager"`     |
| `src/tools/agent-tool.ts`          | `"../parent-snapshot"`                 | `"../lifecycle/parent-snapshot"`   |
| `src/tools/background-spawner.ts`  | `"../agent-manager"`                   | `"../lifecycle/agent-manager"`     |
| `src/tools/background-spawner.ts`  | `"../parent-snapshot"`                 | `"../lifecycle/parent-snapshot"`   |
| `src/tools/foreground-runner.ts`   | `"../agent-manager"`                   | `"../lifecycle/agent-manager"`     |
| `src/tools/foreground-runner.ts`   | `"../parent-snapshot"`                 | `"../lifecycle/parent-snapshot"`   |
| `src/tools/get-result-tool.ts`     | `"../usage"`                           | `"../lifecycle/usage"`             |
| `src/tools/helpers.ts`             | `"../usage"`                           | `"../lifecycle/usage"`             |
| `src/tools/spawn-config.ts`        | `"../agent-runner"`                    | `"../lifecycle/agent-runner"`      |
| `src/tools/steer-tool.ts`          | `"../usage"`                           | `"../lifecycle/usage"`             |
| `src/ui/agent-activity-tracker.ts` | `"../usage"`                           | `"../lifecycle/usage"`             |
| `src/ui/agent-creation-wizard.ts`  | `"../parent-snapshot"`                 | `"../lifecycle/parent-snapshot"`   |
| `src/ui/agent-menu.ts`             | `"../parent-snapshot"`                 | `"../lifecycle/parent-snapshot"`   |
| `src/ui/agent-widget.ts`           | `"../agent-manager"`                   | `"../lifecycle/agent-manager"`     |
| `src/ui/conversation-viewer.ts`    | `"../usage"`                           | `"../lifecycle/usage"`             |
| `src/ui/widget-renderer.ts`        | `"../usage"`                           | `"../lifecycle/usage"`             |

**Consumers updated (test):** `#src/agent-manager` → `#src/lifecycle/agent-manager`; `#src/agent-record` → `#src/lifecycle/agent-record`; `#src/agent-runner` → `#src/lifecycle/agent-runner`; `#src/parent-snapshot` → `#src/lifecycle/parent-snapshot`; `#src/usage` → `#src/lifecycle/usage`; `#src/worktree` → `#src/lifecycle/worktree`; `#src/worktree-state` → `#src/lifecycle/worktree-state`; `#src/notification` → `#src/observation/notification`; `#src/notification-state` → `#src/observation/notification-state`; `#src/record-observer` → `#src/observation/record-observer`; `#src/renderer` → `#src/observation/renderer`.

**Test file relative-import fix:** Moved test files update `"./helpers/..."` → `"../helpers/..."` where used.
Check: `agent-manager.test.ts`, `agent-record.test.ts`, `agent-runner.test.ts`, `agent-runner-extension-tools.test.ts`, `agent-runner-settings.test.ts`, `record-observer.test.ts` all import test helpers via `"./helpers/..."` — these must change to `"../helpers/..."` after the move.

---

### Step 4 — `service/`

New directory `src/service/`, `test/service/`.

**Files moved (src):** `service.ts`, `service-adapter.ts`.

**Files moved (test):** `service.test.ts`, `service-adapter.test.ts`.

**Imports updated inside moved `src/` files:**

| File                         | Old                   | New                              |
| ---------------------------- | --------------------- | -------------------------------- |
| `service/service.ts`         | `"./usage"`           | `"../lifecycle/usage"`           |
| `service/service-adapter.ts` | `"./model-resolver"`  | `"../session/model-resolver"`    |
| `service/service-adapter.ts` | `"./parent-snapshot"` | `"../lifecycle/parent-snapshot"` |
| `service/service-adapter.ts` | `"./service"`         | `"./service"` (sibling)          |
| `service/service-adapter.ts` | `"./types"`           | `"../types"`                     |

**Consumers updated (src):**

| Consumer       | Old import            | New import                    |
| -------------- | --------------------- | ----------------------------- |
| `src/index.ts` | `"./service"`         | `"./service/service"`         |
| `src/index.ts` | `"./service-adapter"` | `"./service/service-adapter"` |

**Consumers updated (test):** `#src/service` → `#src/service/service`; `#src/service-adapter` → `#src/service/service-adapter`.

**Test file relative-import fix:** `service-adapter.test.ts` uses `"./helpers/make-record"` and `"./helpers/mock-session"` — update to `"../helpers/make-record"` and `"../helpers/mock-session"`.

---

### Unchanged files

Root `src/` files `index.ts`, `runtime.ts`, `types.ts`, `settings.ts`, `debug.ts` stay in place.
`src/handlers/`, `src/tools/`, `src/ui/` stay in place (their imports update as consumers above).
`test/helpers/`, `test/handlers/`, `test/tools/`, `test/ui/` stay in place.

## Test Impact Analysis

This is a pure filesystem reorganization.
No new unit tests are enabled or required.
No existing tests become redundant.
No test logic changes — only file locations and import specifiers change.

The test suite passes before and after; the green-on-each-commit discipline verifies that every import path update is correct before the next domain is moved.

## TDD Order

There is no red/green cycle for new behavior.
Each step follows: move files → fix imports → verify green → commit.

### Step 1 — Move `config/` domain

- Create `src/config/`, `test/config/`
- `git mv` 4 `src/` files into `src/config/`
- `git mv` 3 `test/` files into `test/config/`
- Update imports per the Module-Level Changes table for `config/`
- Run `pnpm run check && pnpm run test` — must be green
- Commit: `refactor: move config domain modules into src/config/ (#164)`

### Step 2 — Move `session/` domain

- Create `src/session/`, `test/session/`
- `git mv` 8 `src/` files into `src/session/`
- `git mv` 7 `test/` files into `test/session/`
- Update imports per the Module-Level Changes table for `session/`
- Run `pnpm run check && pnpm run test` — must be green
- Commit: `refactor: move session domain modules into src/session/ (#164)`

### Step 3 — Move `lifecycle/` + `observation/` domains (single commit)

- Create `src/lifecycle/`, `src/observation/`, `test/lifecycle/`, `test/observation/`
- `git mv` 8 `src/lifecycle/` files, 4 `src/observation/` files
- `git mv` 9 `test/lifecycle/` files, 4 `test/observation/` files
- Update imports per both tables in the Module-Level Changes section
- Update `src/types.ts` re-export path
- Run `pnpm run check && pnpm run test` — must be green
- Commit: `refactor: move lifecycle and observation domain modules (#164)`

### Step 4 — Move `service/` domain

- Create `src/service/`, `test/service/`
- `git mv` 2 `src/` files into `src/service/`
- `git mv` 2 `test/` files into `test/service/`
- Update imports per the Module-Level Changes table for `service/`
- Run `pnpm run check && pnpm run test` — must be green
- Commit: `refactor: move service domain modules into src/service/ (#164)`

## Risks and Mitigations

| Risk                                                      | Mitigation                                                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Missed import path breaks the build                       | `pnpm run check` (`tsc --noEmit`) catches all unresolved paths before tests run                                |
| Test file not auto-discovered after move                  | `vitest.config.ts` uses `"test/**/*.test.ts"` glob — subdirectory files are included automatically             |
| `git mv` history not preserved for renamed + edited files | Use `git mv` for the move, then edit the file; git tracks the rename even with content edits                   |
| Step 3 is large (25 file moves)                           | All changes are mechanical with no logic edits; import tables above enumerate every update                     |
| Forgotten consumer in `tools/`, `ui/`, or `index.ts`      | TypeScript's `noEmit` check will fail on any un-updated import; the check step is mandatory before each commit |

## Open Questions

None — the issue scope is fully specified and #157 resolved the prerequisite import cleanup.
