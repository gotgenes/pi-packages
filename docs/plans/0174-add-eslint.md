---
issue: 174
issue_title: "Add ESLint for type-aware lint rules and import path enforcement"
---

# Add ESLint for type-aware lint rules and import path enforcement

## Problem Statement

Biome handles formatting and basic lint well, but it cannot enforce two categories of rules that cost tokens and review cycles:

1. Import path enforcement — nothing prevents `from "../X"` relative imports when `#src/` aliases exist.
Issue #164 burned significant effort on manual import path fixups that a lint rule would have caught instantly. 46 cross-directory relative imports remain in `src/` directories across three packages.

2. Type-aware lint rules — Biome has no type synthesizer, so it cannot enforce rules like `no-unsafe-argument`, `no-floating-promises`, or `no-misused-promises`.
The "avoid `any`" standard in AGENTS.md has no tooling enforcement.

## Goals

- Add ESLint alongside Biome (not replacing it) with a flat config at the repo root.
- Enforce `#src/` aliases over cross-directory relative imports with a custom inline rule that supports `--fix`.
- Enable `typescript-eslint` type-aware rules matching the RepOne config pattern.
- Wire ESLint into pre-commit hooks (`prek.toml`) and CI.
- Fix all existing violations (relative imports + type-aware rule violations).
- Fix `pi-subagents` missing `"type": "module"` in `package.json`.
- Normalize `lint` scripts across all six packages to include ESLint.

## Non-Goals

- Replacing Biome — Biome continues to own formatting, import sorting, and non-type-aware lint.
- Adding third-party ESLint plugins — the import rule is a custom inline rule; type-aware rules come from first-party `typescript-eslint`.
- Per-package ESLint configs — a single root config covers all packages.
- Adding ESLint as a pi-autoformat built-in formatter — users can configure `eslint --fix` as a custom formatter via pi-autoformat settings if desired.

## Background

### Existing tooling

| Tool  | Scope                                           | Config                                                     |
| ----- | ----------------------------------------------- | ---------------------------------------------------------- |
| Biome | Formatting, import sorting, non-type-aware lint | `biome.json` (root)                                        |
| rumdl | Markdown lint                                   | per-package `lint:md` scripts                              |
| tsc   | Type checking (`--noEmit`)                      | per-package `tsconfig.json` extending `tsconfig.base.json` |
| prek  | Pre-commit hooks                                | `prek.toml` (root)                                         |

### Import alias convention

All packages except `pi-session-tools` (single-file, no subdirectories) use `#src/*` and `#test/*` subpath imports defined in both `package.json` `imports` and `tsconfig.json` `paths`.
Issue #157 (closed) normalized most imports but 46 cross-directory relative imports remain in `src/`:

- `pi-permission-system`: 22
- `pi-github-tools`: 19
- `pi-colgrep`: 5

Plus 5 in `pi-subagents/test/`.

### `any` usage in source

~20 `: any` and ~7 `as any` in `src/` files, concentrated in `pi-subagents` (Pi SDK boundary types lacking proper exports). ~27 `any` usages in `test/` files (mock construction for untyped Pi SDK interfaces).

### RepOne reference configs

`~/tinyigsoftware/repone/cdk/eslint.config.js` provides the proven template: `recommendedTypeChecked` + `stylisticTypeChecked` + cherry-picked `strictTypeChecked` rules.
Our config follows this pattern but omits `js.configs.recommended` to avoid overlap with Biome.

### Package consistency issues

`pi-subagents` is missing `"type": "module"` in `package.json`.
All packages need a consistent `lint` script pattern that includes ESLint.

## Design Overview

### Config structure

A single `eslint.config.js` at the repo root using ESLint's flat config format.
Uses `import.meta.dirname` (available since the root `package.json` has `"type": "module"`).

The config uses `typescript-eslint`'s `projectService: true` to automatically discover each package's `tsconfig.json` for type-aware rules.

### Avoiding overlap with Biome

Use `tseslint.configs.recommendedTypeCheckedOnly` and `tseslint.configs.stylisticTypeCheckedOnly` presets, which include only the rules that require type information — skipping base rules Biome already covers.
If these `-Only` presets are not available in the flat config API, fall back to the full presets and explicitly disable the overlapping base rules (e.g., `@typescript-eslint/no-unused-vars`, `@typescript-eslint/no-explicit-any`).

### Cherry-picked `strictTypeChecked` rules

Match the RepOne cdk config exactly:

```typescript
// High-value: catches real bugs
"@typescript-eslint/no-deprecated": "error",
"@typescript-eslint/no-unnecessary-condition": "error",
"@typescript-eslint/no-misused-spread": "error",
"@typescript-eslint/no-mixed-enums": "error",
"@typescript-eslint/use-unknown-in-catch-callback-variable": "error",
"@typescript-eslint/return-await": ["error", "error-handling-correctness-only"],
"@typescript-eslint/no-unnecessary-type-conversion": "error",

// Medium-value: enforces good patterns
"@typescript-eslint/no-confusing-void-expression": "error",
"@typescript-eslint/no-invalid-void-type": "error",
"@typescript-eslint/no-non-null-asserted-nullish-coalescing": "error",
"@typescript-eslint/prefer-literal-enum-member": "error",
"@typescript-eslint/related-getter-setter-pairs": "error",
"@typescript-eslint/no-dynamic-delete": "error",
"@typescript-eslint/no-extraneous-class": "error",

// Low-value but zero-cost
"@typescript-eslint/no-unnecessary-boolean-literal-compare": "error",
"@typescript-eslint/no-unnecessary-template-expression": "error",
"@typescript-eslint/no-unnecessary-type-arguments": "error",
"@typescript-eslint/no-meaningless-void-operator": "error",
"@typescript-eslint/no-useless-constructor": "error",
"@typescript-eslint/no-useless-default-assignment": "error",
"@typescript-eslint/prefer-reduce-type-parameter": "error",
"@typescript-eslint/prefer-return-this-type": "error",
"@typescript-eslint/unified-signatures": "error",
```

### Custom import path rule

An inline ESLint rule defined directly in `eslint.config.js` — no third-party plugin dependency.
Both plugins the issue mentions (`eslint-plugin-paths`, `eslint-plugin-no-relative-import-paths`) use legacy config patterns, CommonJS, and deprecated ESLint APIs.

The custom rule:

1. Flags any import starting with `../` in files under `packages/*/src/` or `packages/*/test/`.
2. Auto-fixes by resolving the relative path, finding the package's `src/` or `test/` root, and rewriting to `#src/...` or `#test/...`.
3. Allows same-directory `./` imports (these are fine and idiomatic).

Sketch of the fix logic:

```typescript
import path from "node:path";

function createFix(fixer, node, filePath, configDir) {
  const importPath = node.source.value;
  const resolved = path.resolve(path.dirname(filePath), importPath);
  const relative = path.relative(configDir, resolved);
  // relative is e.g. "packages/pi-colgrep/src/lib/args"
  const match = relative.match(/^packages\/[^/]+\/(src|test)\/(.+)$/);
  if (!match) return null;
  const [, dir, rest] = match;
  const alias = `#${dir}/${rest}`;
  return fixer.replaceText(node.source, `"${alias}"`);
}
```

The rule applies only to `packages/*/src/**` and `packages/*/test/**` via the config's `files` array.
`pi-session-tools` is excluded (single-file package, no subpath imports).

### Test file overrides

Test files need relaxed rules for `any` usage, matching Biome's existing relaxation:

```typescript
{
  files: ["packages/*/test/**/*.ts"],
  rules: {
    "@typescript-eslint/no-unsafe-argument": "off",
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-unsafe-member-access": "off",
    "@typescript-eslint/no-unsafe-return": "off",
    "@typescript-eslint/no-explicit-any": "off",
  },
}
```

### Tool responsibilities after this change

| Tool   | Scope                                           | When                                |
| ------ | ----------------------------------------------- | ----------------------------------- |
| Biome  | Formatting, import sorting, non-type-aware lint | Save / pre-commit                   |
| ESLint | Type-aware rules + import path enforcement      | Pre-commit + CI                     |
| tsc    | Type checking (`--noEmit`)                      | Pre-commit + CI                     |
| rumdl  | Markdown lint                                   | Per-package `lint:md` + root `lint` |

## Module-Level Changes

### New files

1. `eslint.config.js` — flat config with `typescript-eslint` presets, cherry-picked strict rules, custom import rule, and test file overrides.

### Modified files

1. `package.json` (root) — add `eslint`, `@eslint/js`, `typescript-eslint`, and `globals` to `devDependencies`; update `lint` script to include ESLint.
2. `pnpm-workspace.yaml` — add `eslint`, `@eslint/js`, `typescript-eslint`, and `globals` to `catalog:` for version centralization.
3. `prek.toml` — add ESLint pre-commit hook entry.
4. `.github/workflows/ci.yml` — the root `lint` script already runs in CI; no separate step needed if the root `lint` script includes ESLint.
5. `packages/pi-subagents/package.json` — add `"type": "module"`.
6. `packages/*/package.json` (all six) — normalize `lint` scripts to include ESLint.
   Target pattern: `"lint": "biome check . && eslint . && pnpm run lint:md"` (or without `lint:md` for `pi-session-tools`).
7. `packages/pi-colgrep/src/tools/colgrep.ts` — fix 5 relative imports to use `#src/`.
8. `packages/pi-github-tools/src/tools/*.ts` — fix 19 relative imports to use `#src/`.
9. `packages/pi-permission-system/src/**/*.ts` — fix 22 relative imports to use `#src/`.
10. `packages/pi-subagents/test/**/*.ts` — fix 5 relative imports to use `#test/` or `#src/`.
11. Source files across packages — fix any type-aware ESLint violations (likely `no-unsafe-*` in `pi-subagents` SDK boundary code, requiring targeted `eslint-disable` comments).

## Test Impact Analysis

This change adds tooling configuration, not library code.
The custom import rule is defined inline in `eslint.config.js` and is validated by running ESLint against the codebase itself — it does not need a separate unit test suite.
Existing tests must continue to pass unchanged; the type-aware rules may surface issues in test files, handled by the test file override block.

## Build Order

This is a build/config change, not a TDD change.
Steps are ordered to maintain a green build at each commit.

1. Add `"type": "module"` to `packages/pi-subagents/package.json`.
   Commit: `fix(pi-subagents): add missing "type": "module" to package.json`.

2. Fix all 51 cross-directory relative imports across `src/` and `test/` to use `#src/` / `#test/` aliases.
   Run `pnpm run check` and `pnpm -r run test` to verify.
   Commit: `refactor: replace relative parent imports with #src/#test aliases`.

3. Add ESLint dependencies to root `package.json` and `pnpm-workspace.yaml` catalog.
   Run `pnpm install`.
   Commit: `build: add eslint and typescript-eslint dependencies`.

4. Create `eslint.config.js` with:
   - `typescript-eslint` type-aware presets (only-type-checked variants if available, full presets with Biome-overlapping rules disabled otherwise)
   - Cherry-picked `strictTypeChecked` rules from RepOne config
   - Custom inline `no-parent-relative-imports` rule with auto-fix
   - Test file overrides relaxing `no-unsafe-*` rules
   - Ignores for `dist/`, `node_modules/`, `coverage/`, `.pi/`

   Run `pnpm exec eslint .` and fix any violations (likely targeted `eslint-disable` comments for Pi SDK boundary `any` in `pi-subagents/src/`).
   Commit: `feat: add eslint config with type-aware rules and import enforcement`.

5. Normalize `lint` scripts in all six `packages/*/package.json` to include `eslint .`.
   Update root `package.json` `lint` script to include `eslint .`.
   Run `pnpm run lint` to verify.
   Commit: `build: add eslint to lint scripts across all packages`.

6. Add ESLint hook to `prek.toml`.
   Commit: `build: add eslint pre-commit hook`.

## Risks and Mitigations

1. **`projectService` performance in monorepo** — `typescript-eslint`'s `projectService: true` discovers per-package tsconfigs automatically, but type-checking 6 packages on every lint run may be slow.
   Mitigation: ESLint pre-commit hook should scope to staged files only (prek supports `{filenames}` placeholder).
   If too slow, `projectService` can be configured with `maximumDefaultProjectFileMatch_ts_EXPERIMENTAL` to limit scope.

2. **Pi SDK types lack proper exports** — `pi-subagents` uses `as any` at SDK boundaries because Pi's `ExtensionAPI` runtime context doesn't expose typed interfaces for session managers, model registries, etc.
   Mitigation: targeted `// eslint-disable-next-line` comments on the ~7 `as any` casts in `pi-subagents/src/`, with a `TODO` referencing upstream Pi SDK type improvements.

3. **`recommendedTypeCheckedOnly` flat config availability** — this preset may not be exposed in `typescript-eslint`'s flat config API.
   Mitigation: fall back to the full `recommendedTypeChecked` preset and explicitly disable overlapping rules (`no-unused-vars`, `no-explicit-any`, etc.) that Biome handles.

4. **`no-floating-promises` false positives** — fire-and-forget patterns using `void fn()` are already used in `pi-permission-system` and will satisfy `no-floating-promises`.
   Other intentional fire-and-forget calls may need `void` prefix.

5. **`no-confusing-void-expression` in Pi event handlers** — Pi extension event handlers often return `void` from arrow functions.
   Mitigation: if noisy, add `allowArrowShorthand: true` option to the rule config.

## Open Questions

1. Should `eslint --fix` be added to the suggested pi-autoformat config in the README, or left as a user-level concern?
   Deferred — the plan wires ESLint into pre-commit and CI; pi-autoformat integration is a follow-up.

2. When Biome ships `useConsistentImportPaths` (biomejs/biome#5936), should the custom ESLint rule be removed?
   Deferred — the custom rule is ~50 lines and zero-dependency; removing it is trivial when the time comes.
