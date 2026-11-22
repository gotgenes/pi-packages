---
issue: 10
issue_title: "Consolidate config into .pi/extensions/pi-permission-system/config.json (match pi-autoformat convention)"
---

# Consolidate config layout

## Problem Statement

The extension currently splits configuration across two unrelated files and paths:

1. A **policy file** (`~/.pi/agent/pi-permissions.jsonc` / `<cwd>/.pi/agent/pi-permissions.jsonc`) holding permission rules.
2. An **extension runtime config** (`<extension-install-dir>/config.json`) holding knobs like `debugLog`, `permissionReviewLog`, and `yoloMode`.

This split makes "what does this project allow?" hard to answer by looking in one place.
The runtime config lives inside the install directory, which is read-only for npm-installed extensions and has no project-scope counterpart.
The project policy path (`.pi/agent/`) does not match the convention used by other Pi extensions.

Issue #10 proposes consolidating both surfaces into a single file per scope, at the path convention established by `pi-autoformat`.

## Goals

- `feat!:` — single config file per scope at the conventional `extensions/<id>/` path.
- Global: `~/.pi/agent/extensions/pi-permission-system/config.json` (respects `PI_CODING_AGENT_DIR`).
- Project: `<cwd>/.pi/extensions/pi-permission-system/config.json`.
- Per-agent frontmatter: unchanged.
- Project overrides global; per-agent frontmatter overrides both.
- Deep-merge for object-shaped fields (`defaultPolicy`, `tools`, `bash`, `mcp`, `skills`, `special`); replace for scalar fields (`debugLog`, `yoloMode`, `permissionReviewLog`).
- Tolerant of legacy paths for one release: detect legacy files, emit a non-fatal config issue per occurrence, merge values into the new shape.
- Schema, example config, README, AGENTS.md, and loader all updated in lockstep.
- JSONC comment stripping retained (the existing `stripJsonComments` is already used; keeping it costs nothing).

## Non-Goals

- Changing the per-agent frontmatter format.
- Changing the `/permission-system` slash command name or event channel names.
- Dropping legacy-path support entirely (separate follow-up issue, one release later).
- Adding a `pi permission-system migrate` subcommand.
- Deciding the fate of the event channel (#20).

## Background

### Dependencies

- **#22** (relax on-disk identity rule) — **closed / landed**.
  AGENTS.md already permits config and log path divergence from upstream.
- **#20** (document or delete event channel) — open, orthogonal.
  This plan does not touch event channels.

### Permission surfaces affected

All surfaces are affected indirectly because the policy that governs every surface (tools, bash, mcp, skills, special, external_directory) moves to a new file path.
No permission *semantics* change — the same `(policy, request) → decision` functions are preserved.

### Relevant modules

| Module                            | Role today                                                                                                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/extension-config.ts`         | Loads/saves runtime config from `<extension-root>/config.json`. Defines `CONFIG_PATH`, `LOGS_DIR`, log paths.                                                                                    |
| `src/permission-manager.ts`       | Loads policy from `~/.pi/agent/pi-permissions.jsonc` (global) and `<cwd>/.pi/agent/pi-permissions.jsonc` (project). Merges global → project → per-agent frontmatter. Compiles wildcard patterns. |
| `src/logging.ts`                  | Writes debug and review logs to paths exported by `extension-config.ts`.                                                                                                                         |
| `src/index.ts`                    | Orchestrator. Calls `loadPermissionSystemConfig()`, creates `PermissionManager`, wires events. Derives project paths in `derivePiProjectPaths()`.                                                |
| `src/config-reporter.ts`          | Builds the `config.resolved` log entry listing all loaded paths.                                                                                                                                 |
| `src/config-modal.ts`             | TUI modal for toggling runtime knobs; reads/writes via `extension-config.ts`.                                                                                                                    |
| `src/types.ts`                    | TypeScript types for policy shapes.                                                                                                                                                              |
| `schemas/permissions.schema.json` | JSON Schema for the policy file (currently policy-only).                                                                                                                                         |
| `config/config.example.json`      | Example file (currently policy-only).                                                                                                                                                            |

## Design Overview

### Unified config shape

The new file combines runtime knobs and policy in one object:

```typescript
interface UnifiedPermissionConfig {
  // Runtime knobs (formerly extension-config.ts)
  debugLog?: boolean;
  permissionReviewLog?: boolean;
  yoloMode?: boolean;

  // Policy (formerly pi-permissions.jsonc)
  defaultPolicy?: Partial<PermissionDefaultPolicy>;
  tools?: Record<string, PermissionState>;
  bash?: Record<string, PermissionState>;
  mcp?: Record<string, PermissionState>;
  skills?: Record<string, PermissionState>;
  special?: Record<string, PermissionState>;
}
```

### Path resolution

```typescript
function getGlobalConfigPath(agentDir: string): string {
  return join(agentDir, "extensions", "pi-permission-system", "config.json");
}

function getProjectConfigPath(cwd: string): string {
  return join(cwd, ".pi", "extensions", "pi-permission-system", "config.json");
}
```

Log paths move to the same directory as the global config:

```typescript
function getLogsDir(agentDir: string): string {
  return join(agentDir, "extensions", "pi-permission-system", "logs");
}
```

### Merge precedence (unchanged semantics, new sources)

1. **Global config** — `getGlobalConfigPath(agentDir)`
2. **Project config** — `getProjectConfigPath(cwd)`
3. **Per-agent frontmatter** (global agents dir, then project agents dir)

Object-shaped fields (`defaultPolicy`, `tools`, `bash`, `mcp`, `skills`, `special`) use shallow spread merge (later source wins per-key).
Scalar fields (`debugLog`, `permissionReviewLog`, `yoloMode`) use simple replacement (project overrides global).

### Legacy-path detection

On load, check for:

1. `~/.pi/agent/pi-permissions.jsonc` (legacy global policy)
2. `<cwd>/.pi/agent/pi-permissions.jsonc` (legacy project policy)
3. `<extension-install-dir>/config.json` (legacy runtime config, only when it differs from the new global path)

For each legacy file found:

- Emit a single non-fatal config issue describing the migration (new path, `mv` command).
- Parse and merge its contents into the resolved config at the appropriate precedence level.
- Do not write or delete the legacy file.

### Config modal (TUI)

The `/permission-system` command currently reads/writes `<extension-root>/config.json`.
It must be updated to read/write the **global** config at the new path.
Project-scope runtime knobs become possible for the first time but the TUI does not need to expose them in this change — it continues to target the global file.

### Eliminating `ensurePermissionSystemConfig` auto-creation

Today, `extension-config.ts` auto-creates a default `config.json` in the extension install directory if one does not exist.
With the new layout, the global config directory is user-owned (`~/.pi/agent/extensions/...`).
Auto-creating a file there is acceptable (same as `pi-autoformat` does), but the content should be the unified shape, not just the runtime knobs.

## Module-Level Changes

### `src/config-paths.ts` (new)

Single source of truth for all resolved paths:

- `getGlobalConfigDir(agentDir)`, `getGlobalConfigPath(agentDir)`, `getGlobalLogsDir(agentDir)`
- `getProjectConfigPath(cwd)`
- `getLegacyGlobalPolicyPath(agentDir)`, `getLegacyProjectPolicyPath(cwd)`, `getLegacyExtensionConfigPath(extensionRoot)`
- `DEBUG_LOG_FILENAME`, `REVIEW_LOG_FILENAME`

### `src/config-loader.ts` (new)

Unified loader replacing both the policy-loading logic in `permission-manager.ts` and the runtime-config loading in `extension-config.ts`:

- `loadUnifiedConfig(path): { config: UnifiedPermissionConfig; issues: string[] }`
- `loadAndMergeConfigs(agentDir, cwd, extensionRoot): { global, project, merged, issues }`
- Legacy detection and issue collection.
- JSONC comment stripping (moved from `permission-manager.ts`).

### `src/extension-config.ts` (changed)

- Remove `CONFIG_PATH`, `LOGS_DIR`, `DEBUG_LOG_PATH`, `PERMISSION_REVIEW_LOG_PATH` constants (moved to `config-paths.ts`).
- Remove `ensurePermissionSystemConfig`, `loadPermissionSystemConfig`, `savePermissionSystemConfig` (replaced by `config-loader.ts`).
- Keep `EXTENSION_ID`, `resolveExtensionRoot()`, `normalizePermissionSystemConfig()` (still needed for type normalization).
- Keep `detectMisplacedPermissionKeys()` — repurpose as a validation helper that warns when runtime-only keys appear in a project-scope file intended for policy-only use, or vice versa (optional; may defer).

### `src/permission-manager.ts` (changed)

- Remove `defaultGlobalConfigPath()`, `defaultAgentsDir()`, `stripJsonComments()`.
- Constructor accepts the pre-merged policy (or delegates to `config-loader.ts`).
- `loadGlobalConfig()` and `loadProjectGlobalConfig()` replaced by consuming the unified loader's output.
- Per-agent frontmatter loading stays in `PermissionManager` (unchanged).
- `getResolvedPolicyPaths()` updated to report new paths plus legacy-detection status.

### `src/logging.ts` (changed)

- Accept log paths as constructor/factory arguments instead of importing constants from `extension-config.ts`.
- No change to log format or semantics.

### `src/config-reporter.ts` (changed)

- `buildResolvedConfigLogEntry()` updated to include new paths, legacy-path detection results.

### `src/config-modal.ts` (changed)

- `getConfigPath` callback updated to return the new global config path.
- Save target updated.

### `src/index.ts` (changed)

- `derivePiProjectPaths()` updated to return `.pi/extensions/pi-permission-system/config.json` for the project config and keep `.pi/agent/agents/` for per-agent frontmatter (agents dir path is unchanged).
- Initialization uses `config-loader.ts` to load merged config, then splits into runtime config and policy for their respective consumers.
- Log paths derived from `config-paths.ts`.

### `src/types.ts` (changed)

- Add `UnifiedPermissionConfig` type (or keep in `config-loader.ts` if the type is loader-internal).

### `schemas/permissions.schema.json` (changed)

- Add `debugLog`, `permissionReviewLog`, `yoloMode` as optional properties to the root object.
- Update `$id` to point at the fork's raw GitHub URL.
- Keep all existing policy properties.

### `config/config.example.json` (changed)

- Add runtime knobs (`debugLog`, `permissionReviewLog`, `yoloMode`) alongside the existing policy example.
- Add `$schema` pointer.

### `README.md` (changed)

- Update config-path references throughout.
- Add a "Migration from v1" section with copy-pasteable `mv` commands.

### `AGENTS.md` (changed)

- Update § Configuration to describe the unified config surface.
- Remove the two-surface distinction; document the single file per scope.

### Tests

| File                              | Action                                                                      |
| --------------------------------- | --------------------------------------------------------------------------- |
| `tests/config-paths.test.ts`      | New: path derivation for global, project, legacy.                           |
| `tests/config-loader.test.ts`     | New: loading, merging, JSONC stripping, legacy detection, issue collection. |
| `tests/extension-config.test.ts`  | Changed: remove tests for deleted functions; keep normalization tests.      |
| `tests/permission-system.test.ts` | Changed: update fixture paths to new layout.                                |
| `tests/config-reporter.test.ts`   | Changed: update expected log entry shape.                                   |
| `tests/session-start.test.ts`     | Changed: update path expectations if any.                                   |

## TDD Order

1. **`config-paths.ts` — path derivation** Test: all path functions return expected segments for given `agentDir`/`cwd`/`extensionRoot`.
   Commit: `test: add config-paths derivation tests` Then implement.
   Commit: `feat!: add config-paths module with new layout paths (#10)`

2. **`config-loader.ts` — unified loader (happy path)** Test: `loadUnifiedConfig` parses a valid JSON file into the unified shape; JSONC comments are stripped; unknown keys are ignored.
   Commit: `test: unified config loader happy path` Then implement.
   Commit: `feat: add unified config loader (#10)`

3. **`config-loader.ts` — merge precedence** Test: `loadAndMergeConfigs` deep-merges object fields (project overrides global per-key), replaces scalars, collects issues.
   Commit: `test: config merge precedence for unified loader` Then implement.
   Commit: `feat: implement config merge in unified loader (#10)`

4. **`config-loader.ts` — legacy-path detection** Test: when legacy files exist, loader merges their contents and emits exactly one config issue per legacy file with migration instructions.
   When legacy files do not exist, no issues are emitted.
   Commit: `test: legacy-path detection and migration warnings` Then implement.
   Commit: `feat: detect and merge legacy config paths (#10)`

5. **`extension-config.ts` — remove old load/save, keep normalization** Test: update `extension-config.test.ts` — remove tests for deleted functions, keep normalization tests.
   Commit: `refactor: strip old load/save from extension-config (#10)`

6. **`permission-manager.ts` — consume unified loader** Test: update `permission-system.test.ts` to use new path layout; verify merge precedence is preserved (global → project → per-agent).
   Commit: `test: update permission-manager tests for new config layout` Then implement.
   Commit: `feat!: wire permission-manager to unified config loader (#10)`

7. **`logging.ts` — parameterized log paths** Test: logger uses injected paths, not hardcoded constants.
   Commit: `refactor: parameterize log paths in logging module (#10)`

8. **`config-reporter.ts` — updated log entry** Test: update `config-reporter.test.ts` for new path fields and legacy-detection status.
   Commit: `feat: update config-reporter for consolidated layout (#10)`

9. **`index.ts` — orchestration wiring** Test: update `session-start.test.ts` to verify new paths are passed through.
   Commit: `feat!: wire index.ts to consolidated config layout (#10)`

10. **`config-modal.ts` — TUI save target** Test: modal reads/writes the new global config path.
    Commit: `feat: update config-modal to use new global config path (#10)`

11. **Schema, example, docs** Update `schemas/permissions.schema.json`, `config/config.example.json`, `README.md`, `AGENTS.md`.
    Commit: `docs: update schema, example, and docs for consolidated config (#10)`

## Risks and Mitigations

| Risk                                                    | Mitigation                                                                                                                                                                                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Users lose their existing config silently after upgrade | Legacy-path detection reads old files, merges their values, and emits a TUI warning with a copy-pasteable `mv` command. Config continues to work during the migration window.                                                                                  |
| Legacy detection is buggy and fails to find old files   | Test legacy detection with fixtures for all three legacy paths (global policy, project policy, extension runtime config). Include a test for the case where the old extension-root path equals the new global path (no false positive).                        |
| Could this silently weaken a permission?                | No. The merge semantics are unchanged (spread merge, later source wins per-key). The same policy + same input produces the same decision. Legacy files are merged at the same precedence level they occupied before. Tests verify merge precedence end-to-end. |
| Log files disappear after upgrade                       | Logs move to `~/.pi/agent/extensions/pi-permission-system/logs/`. Old logs in `<extension-root>/logs/` are not deleted or migrated — they remain readable but no new entries are appended. Document this in the migration section.                             |
| `config-modal.ts` writes to wrong path                  | Test that the modal's save target matches the new global config path.                                                                                                                                                                                          |
| Schema drift between unified shape and loader           | Schema, example, and TypeScript types are updated in the same commit (step 11). CI builds (`tsc`) catch type mismatches.                                                                                                                                       |

## Open Questions

- Whether to auto-create a default config at the new global path on first run (like `pi-autoformat` does) or only create on explicit user action.
  Leaning toward auto-create for consistency with `pi-autoformat`, but can defer.
- Whether the config modal should expose a "project scope" toggle.
  Deferred — the modal continues to target the global file only.
- Whether to move the agents dir from `.pi/agent/agents/` to `.pi/extensions/pi-permission-system/agents/`.
  Deferred — the agents dir is a Pi platform convention, not an extension-specific path.
