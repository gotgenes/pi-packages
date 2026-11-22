---
issue: 53
issue_title: "Support ~/$HOME expansion in permission config patterns"
---

# Support `~`/`$HOME` expansion in permission config patterns

## Problem Statement

Permission config patterns that reference home-relative paths (e.g., `external_directory` rules, skill globs) require fully expanded absolute paths today.
This makes configs non-portable across machines and users.
Users expect to write `~/development/pi/*` or `$HOME/development/pi/*` and have it match the expanded path at evaluation time.

## Goals

- Expand `~`, `~/...`, `$HOME`, and `$HOME/...` prefixes in rule patterns at normalization time.
- Keep the stored/displayed pattern as the user wrote it (the `Rule.pattern` field retains `~/...` for readability in logs and `matchedPattern`).
- Apply expansion only to the compiled/matching form, not to pattern identity.
- Add an `expandHomePath()` utility function.
- Update schema docs and example config to document the feature.
- Cover edge cases: Windows-style `~\`, bare `~`, `$HOME` alone, patterns without home prefix (no-op).

## Non-Goals

- Environment variable expansion beyond `$HOME` (e.g., `$USER`, `$XDG_CONFIG_HOME`) — out of scope, file a separate issue if needed.
- Expanding `~` in the **value** side of evaluation (tool input paths) — the external-directory handler already does this in `normalizePathForComparison()`.
- Changing the config merge semantics or adding new surfaces.

## Background

### Relevant modules

| Module                      | Role                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/normalize.ts`          | `normalizeFlatConfig()` converts flat permission config into a `Ruleset`.                                |
| `src/rule.ts`               | `evaluate()` calls `wildcardMatch(r.pattern, value)` — patterns must already be in final matchable form. |
| `src/wildcard-matcher.ts`   | `wildcardMatch()` / `compileWildcardPattern()` compile `*`-glob patterns into regexes.                   |
| `src/external-directory.ts` | `normalizePathForComparison()` already expands `~` on the value side (tool input paths).                 |
| `src/input-normalizer.ts`   | For `external_directory`, passes the raw `path` from tool input as the value to evaluate against.        |

### Permission surface involved

Primarily `external_directory` and `special`, but expansion applies generically to any rule pattern that starts with `~` or `$HOME`.
In practice, path-bearing patterns appear in `external_directory` and potentially `bash` command patterns.

### How evaluation works today

1. Config patterns → `normalizeFlatConfig()` → `Rule[]` (pattern stored verbatim).
2. At check time: `evaluate(surface, value, rules)` → `wildcardMatch(rule.pattern, value)`.
3. The value for `external_directory` is the **raw path** from tool input (e.g., `/Users/chris/development/pi/file.ts`).
4. So `rule.pattern` must be an absolute path glob to match — `~/development/pi/*` would fail today.

### Design decision: where to expand

Expansion at **`wildcardMatch()` / `compileWildcardPattern()` time** is the cleanest approach:

- The `Rule.pattern` field retains the user-written form for display in logs and `matchedPattern`.
- The regex used for matching sees the expanded path.
- No changes needed to `normalizeFlatConfig()`, `evaluate()`, or any caller.

## Design Overview

### New utility: `expandHomePath()`

```typescript
// src/expand-home.ts
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Expand `~` and `$HOME` prefixes in a pattern to the OS home directory.
 * Returns the input unchanged if no home prefix is present.
 */
export function expandHomePath(pattern: string): string {
  if (pattern === "~" || pattern === "$HOME") {
    return homedir();
  }
  if (pattern.startsWith("~/") || pattern.startsWith("~\\")) {
    return join(homedir(), pattern.slice(2));
  }
  if (pattern.startsWith("$HOME/") || pattern.startsWith("$HOME\\")) {
    return join(homedir(), pattern.slice(6));
  }
  return pattern;
}
```

### Integration point: `compileWildcardPattern()`

Apply `expandHomePath()` to the pattern before splitting on `*` and building the regex.
The `pattern` field in the returned `CompiledWildcardPattern` retains the original (unexpanded) value.

```typescript
export function compileWildcardPattern<TState>(
  pattern: string,
  state: TState,
): CompiledWildcardPattern<TState> {
  const expanded = expandHomePath(pattern);
  const escaped = expanded
    .split("*")
    .map((part) => escapeRegExp(part))
    .join(".*");

  return {
    pattern,        // original for display
    state,
    regex: new RegExp(`^${escaped}$`, "s"),
  };
}
```

The standalone `wildcardMatch()` function also calls `compileWildcardPattern`, so it inherits expansion automatically.

### Edge cases

- `~` alone → matches exactly `homedir()`.
- `$HOME` alone → matches exactly `homedir()`.
- `~/` → matches `homedir() + "/"` (trailing slash).
- Patterns not starting with `~` or `$HOME` → unchanged (no-op).
- Windows: `~\foo` is handled by the `startsWith("~\\")` branch.

## Module-Level Changes

| File                                       | Change                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `src/expand-home.ts`                       | **New** — `expandHomePath()` utility.                                                      |
| `src/wildcard-matcher.ts`                  | Import `expandHomePath`; apply in `compileWildcardPattern()`.                              |
| `schemas/permissions.schema.json`          | Add `markdownDescription` noting `~`/`$HOME` support in pattern keys.                      |
| `config/config.example.json`               | Add example using `~/...` in `external_directory`.                                         |
| `tests/expand-home.test.ts`                | **New** — unit tests for `expandHomePath()`.                                               |
| `tests/wildcard-matcher.test.ts`           | Add tests for home-expanded patterns via `wildcardMatch()` and `compileWildcardPattern()`. |
| `tests/permission-manager-unified.test.ts` | Integration test: `external_directory` rule with `~/...` pattern matches expanded path.    |
| `docs/architecture/target-architecture.md` | Note home expansion in wildcard-matcher description if applicable.                         |

## TDD Order

1. **test: add expandHomePath unit tests** — `tests/expand-home.test.ts`: covers `~`, `~/path`, `$HOME`, `$HOME/path`, bare `~`, no-op patterns, Windows separator.
2. **feat: implement expandHomePath utility** — `src/expand-home.ts`: pure function, green tests from step 1.
3. **test: add wildcard-matcher home expansion tests** — `tests/wildcard-matcher.test.ts`: `wildcardMatch("~/dev/*", "/Users/chris/dev/foo")` returns true; `compileWildcardPattern("~/dev/*", …).pattern` retains `~/dev/*`.
4. **feat: integrate expandHomePath into compileWildcardPattern** — `src/wildcard-matcher.ts`: import and apply expansion.
   Green tests from step 3.
5. **test: integration test for external_directory with ~ pattern** — `tests/permission-manager-unified.test.ts`: config with `"~/trusted/*": "allow"`, `checkPermission("external_directory", { path: "<homedir>/trusted/repo" })` returns allow.
6. **feat: green integration test (no code change expected)** — Step 4 already makes this pass; confirm and commit together with step 5 if trivial.
7. **docs: update schema and example config** — `schemas/permissions.schema.json`: add note about `~`/`$HOME` expansion in pattern descriptions.
   `config/config.example.json`: add `~/...` example in `external_directory`.

## Risks and Mitigations

| Risk                                                                                                                                                                                                                                                                        | Mitigation                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Could this silently weaken a permission? No — expansion only makes existing explicit patterns matchable. A pattern that previously failed to match (because `~` was not expanded) now correctly matches, which is the user's intent. No new implicit allows are introduced. | Confirm via integration test that only explicitly written `~`-prefixed rules gain match power.                                                                   |
| `homedir()` returns different values across platforms/users                                                                                                                                                                                                                 | This is the intended behavior — portability is the goal. Tests mock `homedir()` to a known value.                                                                |
| Expanding `~` in non-path surfaces (e.g., bash command patterns like `~something`)                                                                                                                                                                                          | Unlikely to cause harm — bash commands starting with `~/` are legitimate path references. Patterns like `~username/` are not supported (documented as non-goal). |
| `$HOME` prefix conflicts with literal `$HOME` in a non-path pattern                                                                                                                                                                                                         | Extremely unlikely in practice. Document that `$HOME` is expanded; users who need a literal `$HOME` prefix can avoid it.                                         |

## Open Questions

- Should `$HOME` expansion also handle the case where the `HOME` env var differs from `os.homedir()`?
  For now, use `os.homedir()` consistently (matches `normalizePathForComparison` behavior).
  Revisit if a user reports a mismatch.
