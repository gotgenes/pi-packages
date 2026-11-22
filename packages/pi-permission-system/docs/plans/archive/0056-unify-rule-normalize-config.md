---
issue: 56
issue_title: "Unify Rule type and normalize config into flat Ruleset"
---

# Unify Rule type and normalize config into flat Ruleset

## Problem Statement

After #55 extracted `evaluate()`, the codebase has two representations of permission rules:

1. The `Rule` / `Ruleset` types used by `evaluate()` in `src/rule.ts`.
2. The legacy per-surface types (`ToolPermissions`, `BashPermissions`, `SkillPermissions`, `SpecialPermissions`) — all `Record<string, PermissionState>` — used by config loading, merging, and compiled pattern caches in `PermissionManager`.

`PermissionManager` still maintains separate compiled pattern arrays per surface (`compiledBash`, `compiledMcp`, `compiledSkills`, `compiledSpecial`) and a separate `BashFilter` class, even though `evaluate()` handles all surfaces uniformly.
The `compiledToRuleset()` bridge in `checkPermission()` converts between these representations on every call — an adapter that exists only because config loading hasn't caught up with the evaluation model.

## Goals

- Add `normalizeConfig()` in `src/normalize.ts` that converts the on-disk config shape into a flat `Ruleset` at load time.
- Replace `mergePermissions()` (per-category object spread) with array concatenation of `Ruleset` values — later scopes' rules appear last and take priority via last-match-wins.
- Extract per-surface default policy into `src/defaults.ts`, kept separate from the `Ruleset` (see Design Overview for rationale).
- Remove `BashFilter` class — `evaluate("bash", command, rules)` replaces it.
- Remove `ToolPermissions`, `BashPermissions`, `SkillPermissions`, `SpecialPermissions` type aliases from `src/types.ts`.
- Remove `GlobalPermissionConfig` and `AgentPermissions` interfaces — each config scope becomes a `Ruleset` at runtime.
- Preserve all existing external behavior: on-disk config format, `PermissionCheckResult` return type, `checkPermission()` / `getToolPermission()` public API, MCP baseline auto-allow, and two-phase tool filtering.

## Non-Goals

- Changing the on-disk config JSON format (preserved exactly).
- Replacing `SessionApprovalCache` with session rules (deferred to #57).
- Extracting event handlers (#42) or eliminating module-scope state (#43).
- Pre-compiling regex patterns inside normalized `Rule` objects — `wildcardMatch()` per-call is fast enough for current ruleset sizes and this can be optimized in a follow-up.
- Changing the JSON schema or example config — no user-facing config changes.

## Background

### Permission surfaces involved

All: tools (read, write, edit, bash, grep, find, ls, plus extension tools), bash, mcp, skills, special (external_directory).

### Relevant modules

| Module                                     | Role                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `src/permission-manager.ts`                | Config loading, merge, `checkPermission()`, `getToolPermission()`            |
| `src/rule.ts`                              | `Rule`, `Ruleset`, `evaluate()`, `getDefaultAction()` — introduced in #55    |
| `src/wildcard-matcher.ts`                  | `wildcardMatch()`, compiled pattern infrastructure                           |
| `src/bash-filter.ts`                       | `BashFilter` class — already unused in `checkPermission()` post-#55          |
| `src/config-loader.ts`                     | `UnifiedPermissionConfig`, `loadUnifiedConfig()`, `normalizeUnifiedConfig()` |
| `src/types.ts`                             | Per-surface type aliases, `AgentPermissions`, `GlobalPermissionConfig`       |
| `docs/architecture/target-architecture.md` | Target `normalizeConfig()` shape and module layout                           |

### Current flow (post-#55)

1. `resolvePermissions(agentName)` loads four config scopes (global, project, agent frontmatter, project-agent frontmatter) into per-surface `Record<string, PermissionState>` maps.
2. `mergePermissions()` shallow-spreads maps per category across scopes.
3. Compiled pattern arrays are built per surface (`compiledBash`, `compiledMcp`, etc.).
4. `checkPermission()` converts compiled patterns into temporary `Ruleset` values via `compiledToRuleset()`, then calls `evaluate()`.

### What changes

Step 4's on-the-fly conversion moves to step 1 — `normalizeConfig()` produces a `Ruleset` at load time.
Steps 2–3 collapse into array concatenation.
Step 4 calls `evaluate()` directly against the merged `Ruleset`.

## Design Overview

### Surface naming: tool-name-as-surface

Following the issue proposal and target architecture, tool names and special keys become surfaces:

```typescript
// tools.read: "allow" → tool name is the surface
{ surface: "read", pattern: "*", action: "allow" }

// bash["git *"]: "ask" → "bash" is the surface, command is the pattern
{ surface: "bash", pattern: "git *", action: "ask" }

// special.external_directory: "ask" → special key is the surface
{ surface: "external_directory", pattern: "*", action: "ask" }
```

This means `tools.bash: "allow"` normalizes to `{ surface: "bash", pattern: "*", action: "allow" }` — a bash catch-all.
This naturally preserves the current dual-purpose behavior where `tools.bash` controls both tool exposure (phase 1) and bash command fallback (phase 2).
Similarly, `tools.mcp: "allow"` → `{ surface: "mcp", pattern: "*", action: "allow" }`.

### `normalizeConfig()` (`src/normalize.ts`)

```typescript
import type { PermissionState } from "./types";
import type { Rule, Ruleset } from "./rule";

interface NormalizableConfig {
  tools?: Record<string, PermissionState>;
  bash?: Record<string, PermissionState>;
  mcp?: Record<string, PermissionState>;
  skills?: Record<string, PermissionState>;
  special?: Record<string, PermissionState>;
}

/**
 * Convert the on-disk config shape into a flat Ruleset.
 *
 * Ordering within a scope:
 * 1. tools entries (tool-name-as-surface, pattern "*")
 * 2. bash entries (surface "bash", pattern = command glob)
 * 3. mcp entries (surface "mcp", pattern = target glob)
 * 4. skills entries (surface "skill", pattern = skill glob)
 * 5. special entries (key-as-surface, pattern "*")
 *
 * defaultPolicy is NOT included — handled separately (see below).
 */
export function normalizeConfig(config: NormalizableConfig): Ruleset {
  const rules: Ruleset = [];

  for (const [name, action] of Object.entries(config.tools ?? {}))
    rules.push({ surface: name, pattern: "*", action });

  for (const [pattern, action] of Object.entries(config.bash ?? {}))
    rules.push({ surface: "bash", pattern, action });

  for (const [pattern, action] of Object.entries(config.mcp ?? {}))
    rules.push({ surface: "mcp", pattern, action });

  for (const [pattern, action] of Object.entries(config.skills ?? {}))
    rules.push({ surface: "skill", pattern, action });

  for (const [name, action] of Object.entries(config.special ?? {}))
    rules.push({ surface: name, pattern: "*", action });

  return rules;
}
```

### Why `defaultPolicy` stays separate from the Ruleset

`defaultPolicy` cannot be fully represented as catch-all rules in the `Ruleset` because:

1. `defaultPolicy.tools` would need to match ALL tool-name surfaces (read, write, edit, bash, grep, find, ls, plus unknown extension tools).
   No single rule surface pattern can match exactly "all tool names" without also matching bash/mcp/skill surfaces.
2. `defaultPolicy.special` has the same problem — special keys (e.g., `external_directory`) become their own surfaces.
3. MCP baseline auto-allow depends on distinguishing "no rule matched" from "a defaultPolicy catch-all matched."
   If `defaultPolicy.mcp` were a catch-all in the ruleset, it would always match and prevent the baseline heuristic from firing.

`defaultPolicy` is loaded and merged separately as `PermissionDefaultPolicy` (shallow spread across scopes, same as today).
When `evaluate()` returns a synthetic default (no rule matched), `checkPermission()` consults the merged `defaultPolicy` for the appropriate surface fallback.

Note: `defaultPolicy.bash`, `defaultPolicy.mcp`, and `defaultPolicy.skills` COULD be represented as catch-all rules (they have fixed surface names), but excluding them preserves MCP baseline auto-allow and keeps all defaults in one place.
Once MCP baseline auto-allow is formalized as explicit rules (#57), defaults can optionally move into the ruleset.

### `src/defaults.ts`

```typescript
import type { PermissionDefaultPolicy, PermissionState } from "./types";

export const DEFAULT_POLICY: PermissionDefaultPolicy = {
  tools: "ask",
  bash: "ask",
  mcp: "ask",
  skills: "ask",
  special: "ask",
};

/**
 * Map a surface name used in evaluate() to the corresponding
 * defaultPolicy key. Returns undefined for unknown surfaces.
 */
const SURFACE_TO_DEFAULT_KEY: Record<string, keyof PermissionDefaultPolicy> = {
  bash: "bash",
  mcp: "mcp",
  skill: "skill",
  // tool-name surfaces (read, write, edit, etc.) and special-key surfaces
  // (external_directory) do not have dedicated keys — they fall back to
  // "tools" or "special" respectively via getSurfaceDefault().
};

/**
 * Resolve the default action for a surface, consulting merged defaults.
 */
export function getSurfaceDefault(
  surface: string,
  defaults: PermissionDefaultPolicy,
  specialKeys: ReadonlySet<string>,
): PermissionState {
  const key = SURFACE_TO_DEFAULT_KEY[surface];
  if (key) return defaults[key];
  if (specialKeys.has(surface)) return defaults.special;
  return defaults.tools;
}
```

### Merge

```typescript
// Config normalization produces a Ruleset per scope
const globalRules = normalizeConfig(globalConfig);
const projectRules = normalizeConfig(projectConfig);
const agentRules = normalizeConfig(agentFrontmatter);
const projectAgentRules = normalizeConfig(projectAgentFrontmatter);

// Concatenation — later scopes appear last → higher priority via last-match-wins
const mergedRules = [
  ...globalRules,
  ...projectRules,
  ...agentRules,
  ...projectAgentRules,
];

// Defaults merged separately (shallow spread, same as today)
const mergedDefaults = {
  ...DEFAULT_POLICY,
  ...globalDefaults,
  ...projectDefaults,
  ...agentDefaults,
  ...projectAgentDefaults,
};
```

### Simplified `ResolvedPermissions`

```typescript
type ResolvedPermissions = {
  rules: Ruleset;
  defaults: PermissionDefaultPolicy;
  configuredMcpServerNames: readonly string[];
  // merged.mcp is still needed for MCP baseline auto-allow heuristic
  // (checks whether ANY mcp rule has action "allow")
  hasAnyMcpAllowRule: boolean;
};
```

### Simplified `checkPermission()`

Each surface branch reduces to `evaluate()` + default fallback:

```typescript
// Tools (read, write, edit, grep, find, ls, extension tools)
const rule = evaluate(normalizedToolName, "*", rules);
const explicit = rules.includes(rule);
return { state: explicit ? rule.action : defaults.tools, source: explicit ? "tool" : "default" };

// Bash
const rule = evaluate("bash", command, rules);
const explicit = rules.includes(rule);
return { state: explicit ? rule.action : defaults.bash, source: explicit ? "bash" : "default" };

// Skills
const rule = evaluate("skill", skillName, rules);
const explicit = rules.includes(rule);
return { state: explicit ? rule.action : defaults.skills, source: explicit ? "skill" : "default" };

// Special (external_directory)
const rule = evaluate(normalizedToolName, "*", rules);
const explicit = rules.includes(rule);
return { state: explicit ? rule.action : defaults.special, source: explicit ? "special" : "default" };

// MCP — multi-name loop preserved, baseline auto-allow preserved
for (const target of mcpTargets) {
  const rule = evaluate("mcp", target, rules);
  if (rules.includes(rule)) return { state: rule.action, source: "mcp" };
}
// ... baseline auto-allow heuristic ...
return { state: defaults.mcp, source: "default" };
```

### Simplified `getToolPermission()`

```typescript
getToolPermission(toolName: string, agentName?: string): PermissionState {
  const { rules, defaults } = this.resolvePermissions(agentName);
  const rule = evaluate(normalizedToolName, "*", rules);
  if (rules.includes(rule)) return rule.action;
  if (SPECIAL_PERMISSION_KEYS.has(normalizedToolName)) return defaults.special;
  return defaults.tools;
}
```

### Edge cases

1. **MCP baseline auto-allow**: preserved.
   `hasAnyMcpAllowRule` is derived from the merged `Ruleset` by checking if any rule with `surface: "mcp"` has `action: "allow"`.
   The heuristic fires only when no explicit rule matched AND no catch-all (from `tools.mcp`) matched.
2. **`tools.bash` dual-purpose**: preserved naturally.
   `tools.bash: "allow"` → `{ surface: "bash", pattern: "*", action: "allow" }` is a bash catch-all.
   Phase 1 (`getToolPermission("bash")`) matches it → tool exposed.
   Phase 2 (`evaluate("bash", command, ...)`) uses it as fallback for unmatched commands.
3. **`getBashPermissions()` removal**: the method returns `merged.bash` which no longer exists in the simplified model.
   It has no callers outside `permission-manager.ts` and can be removed.
4. **`normalizeRawPermission()` (frontmatter parsing)**: updated to return a shape compatible with `normalizeConfig()` input.
   Its deprecated-key detection and top-level shorthand logic are preserved.
5. **Compiled regex caching**: deferred.
   `evaluate()` uses `wildcardMatch()` which compiles a regex per call.
   This is fast enough for current ruleset sizes (< 1μs per pattern).
   Pre-compiled rules can be introduced in a follow-up if profiling shows a need.
6. **`source` field in `PermissionCheckResult`**: preserved with the same values.
   `"tool"` for tool-surface matches, `"bash"` for bash matches, `"mcp"` for MCP matches, `"skill"` for skill matches, `"special"` for special matches, `"default"` when no rule matched.

### Behavioral difference: `getToolPermission()` now sees command-level catch-alls

With tool-name-as-surface, `getToolPermission("bash")` calls `evaluate("bash", "*", rules)`.
If the user has `bash: { "*": "allow" }` (a command-level catch-all), this matches and returns `"allow"` — exposing the bash tool.

Previously, `getToolPermission("bash")` only checked `tools.bash` and `defaultPolicy.bash`, ignoring command-level patterns.
The new behavior is more consistent: if every bash command is allowed via a catch-all, the tool should be exposed.
Conversely, if `bash: { "*": "deny" }`, the tool is hidden — which is better UX than showing a tool that always fails.

## Module-Level Changes

### `src/normalize.ts` (new)

- Export `normalizeConfig(config): Ruleset`.
- Export `NormalizableConfig` interface (subset of `UnifiedPermissionConfig` covering only policy fields).
- Pure module — no IO, imports only `./rule` and `./types`.

### `src/defaults.ts` (new)

- Export `DEFAULT_POLICY: PermissionDefaultPolicy`.
- Export `getSurfaceDefault(surface, defaults, specialKeys): PermissionState`.
- Export `mergeDefaults(...partials): PermissionDefaultPolicy`.
- Move `DEFAULT_POLICY` constant from `permission-manager.ts`.
- Move `normalizePolicy()` / `normalizePartialPolicy()` here as `mergeDefaults()`.

### `src/rule.ts` (modified)

- Remove `SURFACE_DEFAULTS` and `getDefaultAction()` — moved to `src/defaults.ts` as `getSurfaceDefault()`.
- `evaluate()` accepts an optional `defaultAction` parameter (defaults to `"ask"`) instead of calling `getDefaultAction()`.
  This keeps `evaluate()` pure without depending on `defaults.ts`.

### `src/permission-manager.ts` (modified — major)

- Remove `compiledToRuleset()` helper.
- Remove `compilePermissionPatternsFromSources()` helper.
- Remove `findCompiledPermissionMatch()` / `findCompiledPermissionMatchForNames()` helpers.
- Remove `mergePermissions()` — replaced by array concatenation.
- Remove `normalizePolicy()` / `normalizePartialPolicy()` — moved to `defaults.ts`.
- Remove `normalizePermissionRecord()` — `normalizeConfig()` handles this.
- Remove `BashFilter` import and usage.
- Simplify `ResolvedPermissions` to `{ rules: Ruleset, defaults: PermissionDefaultPolicy, hasAnyMcpAllowRule: boolean }`.
- Simplify `resolvePermissions()`: call `normalizeConfig()` per scope, concatenate, merge defaults.
- Simplify `checkPermission()`: direct `evaluate()` calls against merged ruleset, no more per-surface compiled pattern intermediary.
- Simplify `getToolPermission()`: single `evaluate()` call + default fallback.
- Remove `getBashPermissions()` (dead method, no external callers).
- Update `normalizeRawPermission()` to return a shape compatible with `normalizeConfig()` input.
- Update config caches to store `Ruleset` + defaults per scope instead of `GlobalPermissionConfig` / `AgentPermissions`.

### `src/bash-filter.ts` (removed)

- `BashFilter` class is already dead code in `checkPermission()` (destructured as `_bashFilter` since #55).
- All functionality replaced by `evaluate("bash", command, rules)`.

### `src/types.ts` (modified)

- Remove `ToolPermissions`, `BashPermissions`, `SkillPermissions`, `SpecialPermissions` type aliases.
- Remove `AgentPermissions` interface.
- Remove `GlobalPermissionConfig` interface.
- Keep `PermissionState`, `BuiltInToolName`, `PermissionDefaultPolicy`, `PermissionCheckResult`.
- Keep `SpecialPermissionName` (used for type-level documentation).

### `src/wildcard-matcher.ts` (no change)

- `wildcardMatch()`, `compileWildcardPattern()`, etc. remain as-is.
- `compileWildcardPatternEntries()` and `findCompiledWildcardMatch()` may become unused after this change — removal deferred to a cleanup pass.

### `src/config-loader.ts` (no change)

- `UnifiedPermissionConfig` and loading functions unchanged.
- `normalizeConfig()` in `src/normalize.ts` takes the loaded config as input.

### `schemas/permissions.schema.json` (no change)

- On-disk format unchanged.

### `config/config.example.json` (no change)

- Example config unchanged.

### Tests

| File                                         | Change                                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `tests/normalize.test.ts` (new)              | Unit tests for `normalizeConfig()`: per-surface conversion, ordering, edge cases                                              |
| `tests/defaults.test.ts` (new)               | Unit tests for `getSurfaceDefault()`, `mergeDefaults()`                                                                       |
| `tests/rule.test.ts` (modified)              | Update `evaluate()` tests for optional `defaultAction` parameter; remove `getDefaultAction` tests (moved to defaults.test.ts) |
| `tests/permission-system.test.ts` (modified) | Update to remove `GlobalPermissionConfig`/`AgentPermissions` references; remove `BashFilter` test; adapt helper functions     |
| `tests/bash-filter.test.ts` (removed)        | Covered by `normalize.test.ts` + `rule.test.ts` + `permission-system.test.ts`                                                 |
| `tests/session-start.test.ts` (modified)     | Update `GlobalPermissionConfig` references                                                                                    |

## TDD Order

### Phase 1: New modules (additive, no existing code changes)

1. **test: normalizeConfig converts tools entries to tool-name-as-surface rules** Red: test that `normalizeConfig({ tools: { read: "allow", write: "deny" } })` produces `[{ surface: "read", pattern: "*", action: "allow" }, { surface: "write", pattern: "*", action: "deny" }]`.
   Green: implement `normalizeConfig()` tools path in `src/normalize.ts`.
   `test: normalizeConfig tools entries`

2. **test: normalizeConfig converts bash entries to surface "bash" rules** Red: test `normalizeConfig({ bash: { "git *": "allow", "rm -rf *": "deny" } })` produces bash rules.
   Green: implement bash path.
   `test: normalizeConfig bash entries`

3. **test: normalizeConfig converts mcp, skills, special entries** Red: test all remaining surfaces.
   Verify special keys become their own surface (`external_directory`).
   Green: implement remaining paths.
   `test: normalizeConfig mcp, skills, special entries`

4. **test: normalizeConfig ordering — tools before bash/mcp/skills/special** Red: test that with `{ tools: { bash: "allow" }, bash: { "git *": "ask" } }`, the tools catch-all appears before the bash-specific rule.
   Green: already passes from implementation order.
   `test: normalizeConfig rule ordering`

5. **test: normalizeConfig empty/missing sections produce empty ruleset** Red: test `normalizeConfig({})` returns `[]`.
   Green: already passes.
   `test: normalizeConfig empty config`

6. **test: getSurfaceDefault returns correct defaults for each surface category** Red: test that `getSurfaceDefault("bash", defaults, specialKeys)` returns `defaults.bash`, tool surfaces return `defaults.tools`, special surfaces return `defaults.special`.
   Green: implement `getSurfaceDefault()` in `src/defaults.ts`.
   `test: getSurfaceDefault per-surface dispatch`

7. **test: mergeDefaults shallow-merges partial policies** Red: test that `mergeDefaults(globalDefaults, projectDefaults)` produces correct merged result.
   Green: implement `mergeDefaults()` in `src/defaults.ts`.
   `test: mergeDefaults shallow merge`

8. **feat: add normalizeConfig and defaults modules** Commit the new modules (`src/normalize.ts`, `src/defaults.ts`) and their tests.
   `feat: add normalizeConfig and defaults modules`

### Phase 2: Update evaluate() signature

1. **test: update evaluate() tests for optional defaultAction parameter** Red→Green: update `tests/rule.test.ts` — `evaluate()` now accepts an optional `defaultAction` instead of calling `getDefaultAction()`.
   Move `getDefaultAction()` tests to `tests/defaults.test.ts`.
   `test: evaluate with optional defaultAction parameter`

2. **feat: evaluate() accepts optional defaultAction** Change `evaluate()` signature to accept `defaultAction?: PermissionState`.
   When no rule matches, use `defaultAction ?? "ask"` instead of `getDefaultAction(surface)`.
   Remove `getDefaultAction()` and `SURFACE_DEFAULTS` from `src/rule.ts`.
   `feat: evaluate accepts optional defaultAction parameter`

### Phase 3: Refactor PermissionManager internals

1. **refactor: update permission-system.test.ts helpers for new types** Update test helper functions that construct `GlobalPermissionConfig` / `AgentPermissions` to use `UnifiedPermissionConfig` or inline `Record<string, PermissionState>`.
   Remove the `BashFilter` test from `permission-system.test.ts`.
   All tests should still pass (helpers produce equivalent data).
   `test: update permission-system test helpers for new types`

2. **refactor: resolvePermissions uses normalizeConfig and array concat** Replace per-surface compiled pattern arrays with `normalizeConfig()` per scope.
   Replace `mergePermissions()` with array concatenation.
   Replace per-scope `GlobalPermissionConfig` / `AgentPermissions` caches with `Ruleset` + defaults.
   Simplify `ResolvedPermissions` type.
   Run full test suite.
   `refactor: resolvePermissions uses normalizeConfig and array concat`

3. **refactor: checkPermission uses merged Ruleset directly** Remove `compiledToRuleset()`.
   Each surface branch calls `evaluate()` against the merged ruleset.
   Fallback uses `getSurfaceDefault()`.
   MCP baseline auto-allow logic preserved (uses `hasAnyMcpAllowRule`).
   Run full test suite.
   `refactor: checkPermission uses merged Ruleset directly`

4. **refactor: getToolPermission uses evaluate** Replace the per-surface `if/else if` chain with a single `evaluate()` call + `getSurfaceDefault()` fallback.
   Run full test suite.
   `refactor: getToolPermission uses evaluate`

### Phase 4: Remove dead code

1. **refactor: remove BashFilter class** Delete `src/bash-filter.ts`.
   Delete `tests/bash-filter.test.ts`.
   Remove import from `permission-manager.ts`.
   Run full test suite.
   `refactor: remove BashFilter class`

2. **refactor: remove per-surface type aliases** Remove `ToolPermissions`, `BashPermissions`, `SkillPermissions`, `SpecialPermissions` from `src/types.ts`.
   Remove `AgentPermissions`, `GlobalPermissionConfig` from `src/types.ts`.
   Update all remaining imports (tests, other modules).
   Run `pnpm run build` (typecheck).
   `refactor: remove per-surface type aliases and wrapper interfaces`

3. **refactor: remove getBashPermissions dead method** Remove `getBashPermissions()` from `PermissionManager` (no callers).
   Run full test suite.
   `refactor: remove getBashPermissions dead method`

4. **refactor: remove unused compiled-pattern helpers** If `compilePermissionPatternsFromSources()`, `findCompiledPermissionMatch()`, `findCompiledPermissionMatchForNames()` are now unused, remove them.
   Check whether `compileWildcardPatternEntries()`, `compileWildcardPatterns()`, `findCompiledWildcardMatch()`, `findCompiledWildcardMatchForNames()` in `wildcard-matcher.ts` still have callers.
   Remove any that are dead.
   Run full test suite + `pnpm run build`.
   `refactor: remove unused compiled-pattern helpers`

### Phase 5: Docs and verification

1. **docs: update target architecture to mark #56 complete** Update `docs/architecture/target-architecture.md` refactoring sequence to mark #56 as done.
   `docs: mark #56 complete in target architecture`

2. **verify: full build and test suite** Run `pnpm run build` and `npx vitest run`.
   Confirm no regressions.
   `chore: verify clean build after config normalization refactor`

## Risks and Mitigations

| Risk                                                                          | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Could this silently weaken a permission?                                      | No new `"allow"` path is introduced. When no rule matches, `getSurfaceDefault()` consults the merged `defaultPolicy` which defaults to `"ask"` (least privilege). The `evaluate()` fallback is `"ask"`. Each refactor step runs the full test suite.                                                                                                                                                                                                                |
| Semantic change: `getToolPermission()` now considers command-level catch-alls | With tool-name-as-surface, `getToolPermission("bash")` can match `bash: { "*": "allow" }`. This is more consistent (don't expose a tool if all commands are denied) and strictly tighter or equivalent. Covered by existing tests + new normalize tests.                                                                                                                                                                                                            |
| MCP baseline auto-allow could be bypassed                                     | `defaultPolicy` is NOT included in the ruleset, so `evaluate("mcp", target, rules)` returns synthetic default when no explicit/tools.mcp rule matches — baseline heuristic fires as before. Explicit test coverage for this path.                                                                                                                                                                                                                                   |
| `tools.bash` dual-purpose semantic drift                                      | `tools.bash: "allow"` normalizes to `{ surface: "bash", pattern: "*", action: "allow" }` — a bash catch-all. This naturally preserves both tool exposure and command fallback. Edge case: `tools.bash: "deny"` + `bash: { "*": "allow" }` now exposes the tool (bash catch-all overrides tools entry). Previously, `tools.bash: "deny"` always hid the tool. This contradictory config is likely a user error, and the new behavior is arguable. Add explicit test. |
| Large test file churn in permission-system.test.ts                            | Step 11 updates test helpers BEFORE refactoring production code. Changes are mechanical (type alias replacement). Intermediate commits keep the suite green.                                                                                                                                                                                                                                                                                                        |
| Performance regression from losing compiled regex cache                       | `wildcardMatch()` compiles a regex per call (~1μs). For typical rulesets (< 50 rules), total overhead is < 50μs per permission check. Acceptable. Pre-compiled rules deferred to follow-up if needed.                                                                                                                                                                                                                                                               |
| `normalizeRawPermission()` (frontmatter) diverges from `normalizeConfig()`    | Both share the same input shape (`NormalizableConfig`). `normalizeRawPermission()` handles raw YAML parsing + deprecated keys, then passes the validated shape to `normalizeConfig()`. Tested explicitly.                                                                                                                                                                                                                                                           |

## Open Questions

- **Should `evaluate()` accept `defaultAction` as a parameter or keep calling `getDefaultAction()`?**
  Plan proposes parameter — cleaner for testing and keeps `evaluate()` independent of `defaults.ts`.
  Final decision during implementation.
- **Should unused `compileWildcardPatternEntries` / `findCompiledWildcardMatch` exports be removed in this PR?**
  They may be used by other modules not yet migrated to `evaluate()`.
  Removal is in step 18 but gated on checking callers.
- **Should `normalizeConfig()` accept raw `Record<string, unknown>` or the already-validated `Record<string, PermissionState>` sub-objects?**
  Plan uses the validated shape (`NormalizableConfig`).
  Raw validation stays in `config-loader.ts` / `normalizeRawPermission()`.
