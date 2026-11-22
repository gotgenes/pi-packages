---
issue: 4
issue_title: "config.json silently drops permission keys (defaultPolicy / bash / tools / ...)"
---

# Warn on misplaced permission keys in `config.json`

## Problem Statement

Users who paste permission-rule keys (`defaultPolicy`, `tools`, `bash`, `mcp`, `skills`, `special`, `external_directory`, `doom_loop`) into the extension's `config.json` get no feedback that those keys are silently ignored.
The file only governs extension runtime settings (`debugLog`, `permissionReviewLog`, `yoloMode`); permission rules belong in `~/.pi/agent/pi-permissions.jsonc`, `<project>/.pi/agent/pi-permissions.jsonc`, or per-agent frontmatter.

## Goals

- Detect permission-rule keys present in `config.json` during load.
- Emit a clear, actionable warning naming the ignored keys and pointing to the correct files.
- Surface the warning via the permission review log and the existing `warning` field on the load result (which callers can display to stderr).
- Produce no warning when `config.json` contains only valid extension keys.

## Non-Goals

- Actually honoring permission rules in `config.json` (two sources of truth is an anti-goal).
- Validating the *values* of unrecognized keys (we only care about their presence).
- Changing the schema of `config.json` or adding new extension settings (separate work).

## Background

### Relevant modules

- `src/extension-config.ts` — `normalizePermissionSystemConfig` strips everything except the three known keys.
  `loadPermissionSystemConfig` returns a `PermissionSystemConfigLoadResult` with an optional `warning` string.
- `src/types.ts` — `AgentPermissions` / `GlobalPermissionConfig` define the permission-rule shape.
- `src/logging.ts` — `PermissionSystemLogger.review()` writes to the review log.

### Permission surface

This is a **config-loading** concern, not a permission-surface change.
No policy semantics, merge precedence, or on-disk identity are affected.

## Design Overview

### Misplaced-key detection

Define a constant set of keys that belong to the permission-policy schema, not the extension config:

```typescript
const PERMISSION_POLICY_KEYS: ReadonlySet<string> = new Set([
  "defaultPolicy",
  "tools",
  "bash",
  "mcp",
  "skills",
  "special",
  "external_directory",
  "doom_loop",
]);
```

### Where detection runs

Inside `normalizePermissionSystemConfig` (or a new companion function it calls), scan the incoming `raw` record for keys in `PERMISSION_POLICY_KEYS`.
Return both the normalized config and an array of misplaced key names (empty array = no problem).

The return type changes from bare `PermissionSystemExtensionConfig` to:

```typescript
interface NormalizeResult {
  config: PermissionSystemExtensionConfig;
  configIssues: string[];
}
```

`loadPermissionSystemConfig` already has a `warning` field; when `configIssues` is non-empty, it builds a human-readable warning message and sets `warning` (appending to any pre-existing warning from `ensurePermissionSystemConfig`).

### Warning message format

```text
config.json contains permission-rule keys that are ignored here: defaultPolicy, bash, tools.
Permission rules belong in ~/.pi/agent/pi-permissions.jsonc, <project>/.pi/agent/pi-permissions.jsonc, or per-agent frontmatter.
See config/config.example.json for the keys config.json supports.
```

### Edge cases

- Unknown keys that are *not* in `PERMISSION_POLICY_KEYS` (e.g. a typo like `debuglog`) — ignored for now; out of scope.
- Empty `config.json` (`{}`) — no warning.
- Multiple misplaced keys — all listed in a single warning.

## Module-Level Changes

### `src/extension-config.ts`

1. Add `PERMISSION_POLICY_KEYS` constant.
2. Extract a `detectMisplacedPermissionKeys(raw: Record<string, unknown>): string[]` function.
3. Change `normalizePermissionSystemConfig` to return `NormalizeResult` (config + configIssues).
4. Update `loadPermissionSystemConfig` to read `configIssues` and build the warning string when non-empty.
5. Combine any pre-existing warning from `ensurePermissionSystemConfig` with the misplaced-key warning (newline-separated).

### `tests/extension-config.test.ts` (new file)

Focused unit tests for the detection and warning path.

### `config/config.example.json`

No changes needed — file already shows only extension keys, which is the correct state.

### `schemas/permissions.schema.json`

No changes — this schema governs the permission-policy file, not `config.json`.

## TDD Order

1. **Red:** test that `detectMisplacedPermissionKeys` returns an empty array for a record with only valid extension keys.
   `test: detectMisplacedPermissionKeys returns [] for clean config`

2. **Green:** implement `detectMisplacedPermissionKeys` and `PERMISSION_POLICY_KEYS`.
   `feat: detect misplaced permission keys in config.json (#4)`

3. **Red:** test that `detectMisplacedPermissionKeys` returns the correct key names when permission-rule keys are present alongside valid keys.
   `test: detectMisplacedPermissionKeys lists misplaced keys`

4. **Green:** already passes from step 2 (or adjust).

5. **Red:** test that `normalizePermissionSystemConfig` returns `configIssues` with misplaced key names.
   `test: normalizePermissionSystemConfig surfaces configIssues`

6. **Green:** update `normalizePermissionSystemConfig` return type and wire in detection.
   `feat: normalizePermissionSystemConfig returns configIssues (#4)`

7. **Red:** test that `loadPermissionSystemConfig` sets `warning` when config contains misplaced keys, and does *not* set `warning` for a clean config.
   `test: loadPermissionSystemConfig warns on misplaced permission keys`

8. **Green:** update `loadPermissionSystemConfig` to build the warning message from `configIssues`.
   `feat: loadPermissionSystemConfig warns on misplaced keys (#4)`

9. **Docs:** update `README.md` if it references `config.json` in a way that could mislead users into putting permission keys there.
   `docs: clarify config.json vs permission-policy file (#4)`

## Risks and Mitigations

| Risk                                                                 | Mitigation                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Warning message is too noisy for users with valid configs            | Warning only fires when misplaced keys are actually present; clean configs produce no output.                                                                                                                                                                                                |
| Could this silently weaken a permission?                             | No — this change only *adds* a warning. Permission resolution logic is untouched; misplaced keys are still ignored exactly as before.                                                                                                                                                        |
| `normalizePermissionSystemConfig` return-type change breaks callers  | All call sites are in this repo (`loadPermissionSystemConfig`, `savePermissionSystemConfig`). Update them in the same commit. `savePermissionSystemConfig` only passes a typed `PermissionSystemExtensionConfig`, so it will never hit misplaced keys — but the type change must be handled. |
| Future extension keys could collide with permission-policy key names | Unlikely (`PERMISSION_POLICY_KEYS` names are domain-specific), but if it happens the key should be removed from the set at that time.                                                                                                                                                        |

## Open Questions

None — the issue's proposed fix is unambiguous and self-contained.
