---
issue: 88
issue_title: "Track and report provenance of each permission rule"
---

# Plan: Track and report provenance of each permission rule

## Problem Statement

When a permission decision (allow/deny/ask) is made, there is no way to determine which config source contributed the winning rule.
All four config sources — global, project, agent frontmatter, and project-agent frontmatter — are merged into a single `FlatPermissionConfig` before rules are created, so every config rule receives the generic `layer: "config"` label.
Debugging "why is tool X denied?" requires manually inspecting up to four config locations.
The review log records the decision but not its source, and `/permission-system` cannot show where each effective rule came from.

Additionally, the `"override"` value in the `Rule.layer` type union is dead code — introduced in #65, the layer value was removed in #66 but left in the type.
The `deriveSource()` function still has a branch for `layer === "override"` that is unreachable.

## Goals

- Add an optional `origin` field to `Rule` that records which config scope contributed the rule.
- Tag config rules with their origin during the merge loop in `resolvePermissions()`.
- Propagate origin into `PermissionCheckResult` so callers can report it.
- Include origin in review log entries for permission decisions.
- Include origin in `/permission-system show` output when displaying effective policy.
- Remove the dead `"override"` value from the `Rule.layer` type union and its unreachable `deriveSource()` branch.
- Add tests for provenance correctness across merge-precedence scenarios.

## Non-Goals

- Changing the merge-precedence semantics (global → project → agent → project-agent).
  Origin tracking is read-only metadata; it must not alter any permission decision.
- Displaying origin in the interactive permission prompt dialog (deferred — see issue § "Permission dialog").
- Tracking origin for synthesized defaults (`layer: "default"`) or baseline rules (`layer: "baseline"`).
  Only `layer: "config"` rules carry origin.
- Adding origin to session rules (`layer: "session"`).
  Session rules are runtime-only and always come from the current session.

## Background

### Relevant modules

| File                                       | Role                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `src/rule.ts`                              | `Rule` interface, `Ruleset`, `evaluate()`, `evaluateFirst()`                        |
| `src/types.ts`                             | `PermissionCheckResult`, `FlatPermissionConfig`, `ScopeConfig`                      |
| `src/normalize.ts`                         | `normalizeFlatConfig()` — converts flat config to `Ruleset`                         |
| `src/synthesize.ts`                        | `synthesizeDefaults()`, `synthesizeBaseline()`, `composeRuleset()`                  |
| `src/permission-manager.ts`                | `PermissionManager` — `resolvePermissions()`, `checkPermission()`, `deriveSource()` |
| `src/permission-prompter.ts`               | `PermissionPrompter` — writes review log entries with permission details            |
| `src/logging.ts`                           | `createPermissionSystemLogger()` — writes review and debug log lines                |
| `src/config-modal.ts`                      | `/permission-system` slash command handler                                          |
| `docs/architecture/target-architecture.md` | Living architecture doc with `Rule` type definition                                 |

### Permission surfaces involved

All surfaces (tools, bash, mcp, skills, special/external_directory).
Origin is surface-agnostic metadata on `Rule`.

### Current merge flow

`resolvePermissions()` merges four `FlatPermissionConfig` objects using `mergeFlatPermissions()` (deep-shallow merge), normalizes the merged result into rules via `normalizeFlatConfig()`, and stamps every rule with `layer: "config"`.
The origin of each rule is lost at the `mergeFlatPermissions()` step.

## Design Overview

### New `RuleOrigin` type and `Rule.origin` field

```typescript
/** Which config scope contributed a rule. Only set for layer="config". */
export type RuleOrigin = "global" | "project" | "agent" | "project-agent";

export interface Rule {
  surface: string;
  pattern: string;
  action: PermissionState;
  layer?: "default" | "baseline" | "config" | "session"; // "override" removed
  origin?: RuleOrigin;
}
```

### Origin tracking strategy

The current `resolvePermissions()` loop merges flat configs then normalizes.
Changing this to per-scope normalization + concatenation would subtly alter the deep-shallow merge semantics (e.g., when a higher-precedence scope replaces a lower scope's object entry with a string, the lower scope's pattern rules would incorrectly survive as last-match-wins candidates).

Instead, build a parallel **origin map** alongside the existing merge loop — it mirrors `mergeFlatPermissions()` semantics exactly without changing any permission decision:

```typescript
type OriginMap = Map<string, Map<string, RuleOrigin>>;

const origins: OriginMap = new Map();

for (const [scopeName, scope] of [
  ["global", globalConfig],
  ["project", projectConfig],
  ["agent", agentConfig],
  ["project-agent", projectAgentConfig],
] as const) {
  if (!scope.permission) continue;

  for (const [surface, value] of Object.entries(scope.permission)) {
    const baseVal = mergedPermission[surface];
    const bothObjects =
      typeof baseVal === "object" && baseVal !== null &&
      typeof value === "object" && value !== null;

    if (bothObjects) {
      // Shallow merge: new patterns attributed to this scope,
      // existing patterns keep their earlier origin.
      if (!origins.has(surface)) origins.set(surface, new Map());
      for (const pattern of Object.keys(value as Record<string, unknown>)) {
        origins.get(surface)!.set(pattern, scopeName);
      }
    } else {
      // Full replacement: reset all origins for this surface.
      const surfaceOrigins = new Map<string, RuleOrigin>();
      if (typeof value === "string") {
        surfaceOrigins.set("*", scopeName);
      } else if (typeof value === "object" && value !== null) {
        for (const pattern of Object.keys(value as Record<string, unknown>)) {
          surfaceOrigins.set(pattern, scopeName);
        }
      }
      origins.set(surface, surfaceOrigins);
    }
  }

  // Existing merge (unchanged)
  mergedPermission = mergeFlatPermissions(mergedPermission, scope.permission);
}
```

After normalization, stamp each config rule:

```typescript
const configRules: Ruleset = normalizeFlatConfig(permissionWithoutUniversal)
  .map((r): Rule => ({
    ...r,
    layer: "config",
    origin: origins.get(r.surface)?.get(r.pattern),
  }));
```

The universal fallback `permission["*"]` also needs origin tracking.
Track it separately:

```typescript
const universalFallbackOrigin: RuleOrigin | undefined =
  origins.get("*")?.get("*");
```

Pass it to `synthesizeDefaults()` so the synthesized default rule can optionally carry an origin when it came from a user config (not the built-in fallback).

### `PermissionCheckResult.origin`

Add an optional `origin` field to `PermissionCheckResult`:

```typescript
export interface PermissionCheckResult {
  toolName: string;
  state: PermissionState;
  matchedPattern?: string;
  command?: string;
  target?: string;
  source: "tool" | "bash" | "mcp" | "skill" | "special" | "default" | "session";
  /** Which config scope contributed the winning rule (only for config rules). */
  origin?: RuleOrigin;
}
```

In `checkPermission()`, propagate `rule.origin` into the result.

### Review log entries

The review log entries already include fields from `PermissionCheckResult` (via `getPermissionLogContext()` and `PermissionPrompter.writeReviewEntry()`).
Add `origin` to the structured log details wherever a check result is logged.
This requires changes to:

- `src/tool-input-preview.ts` — `getPermissionLogContext()` includes `origin` from the check result.
- `src/permission-gate.ts` — `logContext` type gains an optional `origin` field.
- `src/handlers/tool-call.ts` — pass `origin` through `logContext` in the normal tool permission gate.

### `/permission-system show` output

Extend the `show` subcommand to display the composed config-layer rules with their origins.
Example output:

```text
permission-system: yoloMode=off, permissionReviewLog=on, debugLog=off
  rules: read=allow (global), bash["*"]=allow (global), bash["rm *"]=deny (project), mcp["exa:*"]=allow (agent)
```

This requires `config-modal.ts` to accept a function that returns the composed ruleset (or a formatted summary) from the `PermissionManager`.

### Remove dead `"override"` layer

- Remove `"override"` from the `Rule.layer` union in `src/rule.ts`.
- Remove the `if (rule.layer === "override") return "tool";` branch from `deriveSource()` in `src/permission-manager.ts`.
- Update the `Rule` type in `docs/architecture/target-architecture.md`.

## Module-Level Changes

### `src/rule.ts`

- Add `export type RuleOrigin = "global" | "project" | "agent" | "project-agent";`.
- Add `origin?: RuleOrigin` to the `Rule` interface.
- Remove `"override"` from the `layer` union.

### `src/types.ts`

- Re-export `RuleOrigin` (or import it) and add `origin?: RuleOrigin` to `PermissionCheckResult`.

### `src/normalize.ts`

- No functional changes.
  `normalizeFlatConfig()` returns rules without `layer` or `origin`; callers stamp them.

### `src/synthesize.ts`

- `synthesizeDefaults()` gains an optional `origin` parameter so the universal default rule can carry an origin when it was set by a user config rather than the built-in fallback.

### `src/permission-manager.ts`

- `resolvePermissions()`: build an `OriginMap` alongside the merge loop; stamp config rules with `origin` after normalization.
  Pass `universalFallbackOrigin` to `synthesizeDefaults()`.
- `checkPermission()`: include `rule.origin` in the returned `PermissionCheckResult`.
- `deriveSource()`: remove the `if (rule.layer === "override")` branch and its JSDoc entry.
- `getToolPermission()`: no change — it returns `PermissionState`, not `PermissionCheckResult`.

### `src/tool-input-preview.ts`

- `getPermissionLogContext()`: include `origin` from the check result in the returned log details.

### `src/config-modal.ts`

- `PermissionSystemConfigController`: add an optional `getComposedRules?: () => Ruleset` method.
- `summarizeConfig()`: append a compact rules-with-origin summary when composed rules are available.
- `handleArgs()` `show` branch: pass composed rules into the summary.

### `src/index.ts`

- Pass a `getComposedRules` callback to `registerPermissionSystemCommand` that calls `runtime.permissionManager`.

### `src/handlers/tool-call.ts`

- No structural changes.
  `logContext` objects already spread `getPermissionLogContext(check, ...)`, which will now include `origin`.

### `docs/architecture/target-architecture.md`

- Update `Rule` type definition: remove `"override"` from `layer`, add `origin?: RuleOrigin`.
- Add a note in the "Composed Ruleset" diagram about origin metadata on config rules.

### `tests/`

- `tests/rule.test.ts` — verify `evaluate()` preserves `origin` on matched rules.
- `tests/permission-manager-unified.test.ts` — add provenance tests covering:
  - Single-scope origin attribution.
  - Multi-scope deep-shallow merge (both-object): each pattern's origin is correct.
  - Replacement semantics (string replaces object, object replaces string): origins reset.
  - Universal fallback origin.
  - `PermissionCheckResult.origin` propagation.
- `tests/synthesize.test.ts` — test that `synthesizeDefaults()` passes through an origin when provided.
- `tests/config-modal.test.ts` — test that `show` includes origin annotations when composed rules are available.

## TDD Order

### 1. Remove dead `"override"` layer value

- **Test surface**: `tests/rule.test.ts`, `tests/permission-manager-unified.test.ts` (type-check via `pnpm run build`).
- **What's covered**: `"override"` removed from `Rule.layer` union; `deriveSource()` branch removed; architecture doc updated.
  Existing tests that reference `layer` continue to pass since no test used `"override"`.
- **Commit**: `refactor: remove dead "override" layer value from Rule type`

### 2. Add `RuleOrigin` type and `origin` field to `Rule`

- **Test surface**: `tests/rule.test.ts`.
- **What's covered**: `RuleOrigin` type exported; `Rule.origin` accepted by `evaluate()`; `evaluate()` preserves `origin` on matched rules (new test cases).
- **Commit**: `feat: add RuleOrigin type and origin field to Rule`

### 3. Tag config rules with origin during `resolvePermissions()`

- **Test surface**: `tests/permission-manager-unified.test.ts`.
- **What's covered**: new `describe` block for provenance — single-scope, multi-scope merge, replacement semantics, universal fallback origin.
  Tests call `checkPermission()` and assert `result.origin` values.
  Requires adding `origin` to `PermissionCheckResult` so `checkPermission()` can return it.
- **Commit**: `feat: track and propagate rule origin through checkPermission`

### 4. Propagate origin to `synthesizeDefaults()`

- **Test surface**: `tests/synthesize.test.ts`, `tests/permission-manager-unified.test.ts`.
- **What's covered**: `synthesizeDefaults(universalDefault, origin?)` passes `origin` to the default rule; `checkPermission()` returns origin when the universal fallback was set by a user config.
- **Commit**: `feat: propagate origin to synthesized default rule`

### 5. Include origin in review log entries

- **Test surface**: `tests/handlers/tool-call.test.ts` (or a new `tests/tool-input-preview.test.ts` if not yet covered).
- **What's covered**: `getPermissionLogContext()` includes `origin` from the check result; review log entries contain the winning rule's origin.
- **Commit**: `feat: include rule origin in permission review log entries`

### 6. Display origin in `/permission-system show` output

- **Test surface**: `tests/config-modal.test.ts`.
- **What's covered**: `show` subcommand output includes per-rule origin annotations when composed rules are available; omits them when not.
- **Commit**: `feat: display rule origins in /permission-system show output`

### 7. Update architecture doc

- **Test surface**: manual review only.
- **What's covered**: `docs/architecture/target-architecture.md` updated with `RuleOrigin`, `origin` field, and removal of `"override"`.
- **Commit**: `docs: update target architecture for rule origin provenance`

## Risks and Mitigations

| Risk                                                                                                    | Mitigation                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Origin tracking diverges from merge semantics, causing incorrect attribution.                           | The origin map mirrors `mergeFlatPermissions()` case-by-case (both-objects, string-replaces, object-replaces). Unit tests cover all three merge modes.                                                                                                       |
| Adding `origin` to `Rule` or `PermissionCheckResult` breaks deep-equality assertions in existing tests. | `origin` is optional and only set for config rules. Existing tests that use `makeManager()` with no config will see rules without `origin`, preserving deep equality. Tests with config fixtures may need `origin` in expected values — addressed in step 3. |
| Could this silently weaken a permission?                                                                | No. `origin` is read-only metadata. It is not consumed by `evaluate()`, does not appear in any guard condition, and does not alter any allow/deny/ask decision. The `evaluate()` function's behavior is unchanged.                                           |
| Removing `"override"` layer breaks a runtime path.                                                      | No code path creates a rule with `layer: "override"`. The `deriveSource()` branch is unreachable. Removing both is safe. `pnpm run build` confirms no type errors.                                                                                           |
| `/permission-system show` output becomes noisy with many rules.                                         | Keep the display compact (one line per rule, abbreviated origin labels). If the rule count exceeds a threshold, truncate with a count summary.                                                                                                               |

## Open Questions

- Should the `origin` field also appear on synthesized default and baseline rules (e.g., `origin: "builtin"`)?
  The issue scopes it to `layer: "config"` only; this could be revisited if debugging of defaults becomes a pain point.
- Should origin be exposed in the interactive permission dialog prompt (e.g., "This permission comes from your project config")?
  The issue mentions this as a future benefit but does not include it in scope.
  Deferred.
