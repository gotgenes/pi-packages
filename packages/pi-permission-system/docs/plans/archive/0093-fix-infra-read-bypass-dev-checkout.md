---
issue: 93
issue_title: "Infrastructure read bypass fails in local development checkout"
---

# Fix infrastructure read bypass in local development checkout

## Problem Statement

`discoverGlobalNodeModulesRoot()` walks up from the extension's own `import.meta.url` to find a `node_modules` ancestor directory.
When the extension is globally installed this works — the walk finds e.g. `/opt/homebrew/lib/node_modules`.
When running from a local development checkout (e.g. `/Users/chris/development/pi/pi-permission-system`), there is no `node_modules` ancestor, so the function returns `null`.
This causes `piInfrastructureDirs` to omit the global `node_modules` root, and skill file reads trigger unexpected external-directory permission prompts.

## Goals

- Make `discoverGlobalNodeModulesRoot()` find the global `node_modules` root even when the extension itself is not installed inside it.
- Eliminate spurious external-directory prompts for skill file reads during local development.
- Keep the existing walk-up-from-self as the primary strategy (zero subprocess overhead for production installs).

## Non-Goals

- Upstream API request for `getGlobalNpmRoot()` — useful but orthogonal (tracked in #48 discussion).
- Changing `piInfrastructureReadPaths` config semantics — the manual workaround stays as-is.
- Multi-package-manager detection — Pi defaults to `npm` for package installation; users with custom `npmCommand` in `settings.json` can use `piInfrastructureReadPaths` for non-npm global roots.

## Background

### Relevant modules

- `src/external-directory.ts` — `discoverGlobalNodeModulesRoot()` (the broken function), `isPiInfrastructureRead()`.
- `src/runtime.ts` — `createExtensionRuntime()` calls `discoverGlobalNodeModulesRoot()` once at construction and stores the result in `piInfrastructureDirs`.
- `src/handlers/tool-call.ts` — combines `piInfrastructureDirs` with `config.piInfrastructureReadPaths` and passes them to `isPiInfrastructureRead()`.

### Permission surface

`special.external_directory` — the external-directory gate for path-bearing tools.

### Existing workaround

Users can add the global `node_modules` path to `piInfrastructureReadPaths` in their config, but this is non-obvious and machine-specific.

### Why the original `createRequire` fallback plan was wrong

The initial plan proposed using `createRequire(import.meta.url)` to resolve `@mariozechner/pi-coding-agent` and walk up from that path.
This fails because from a dev checkout, `createRequire` resolves to the **local** `node_modules/.pnpm/...` (the devDependency copy), not the global root.
Walking up from that path finds pnpm's internal `node_modules`, not `/opt/homebrew/lib/node_modules`.

Verified empirically:

```text
import.meta.resolve('@mariozechner/pi-coding-agent')
→ file:///.../pi-permission-system/node_modules/.pnpm/@mariozechner+pi-coding-agent@0.72.1_.../node_modules/@mariozechner/pi-coding-agent/dist/index.js

Walk-up finds: .../node_modules/.pnpm/.../node_modules  (WRONG — pnpm internal)
Need:          /opt/homebrew/lib/node_modules            (RIGHT — global root)
```

## Design Overview

### Strategy: `npm root -g` subprocess fallback

When the walk-up-from-self strategy returns `null` (no `node_modules` ancestor), fall back to `npm root -g` to discover the global `node_modules` root.

```typescript
export function discoverGlobalNodeModulesRoot(
  fromUrl = import.meta.url,
): string | null {
  // Strategy 1: walk up from own location (covers global installs).
  const fromSelf = walkUpToNodeModules(fromUrl);
  if (fromSelf) return fromSelf;

  // Strategy 2: ask npm for the global root (covers dev checkouts).
  return discoverGlobalNodeModulesViaSubprocess();
}
```

The walk-up loop is extracted to a private `walkUpToNodeModules(fromUrl)` helper.
The subprocess fallback is a separate private function with its own error handling.

### Why `npm root -g`?

- Pi defaults to `npm` for package installation (`getNpmCommand()` returns `{ command: "npm", args: [] }` unless overridden in `settings.json`).
  Skills and extensions installed by Pi live under `npm root -g`.
- `npm` is always available when Node.js is available — it ships with Node.
- The subprocess only runs when the walk-up fails (dev checkout only), so production installs pay zero cost.
- The result is cached in the existing `discoverGlobalNodeModulesRoot()` call (called once at `createExtensionRuntime()` construction).

### Why not multi-PM detection?

Pi's `config.ts` has a `detectInstallMethod()` function with `getGlobalPackageRoots()` that handles npm/pnpm/yarn/bun, but those are not exported and the detection logic relies on `__dirname` being inside `node_modules`.
Replicating that detection is fragile and unnecessary:

- `npm root -g` covers the default Pi installation method.
- Users who override `npmCommand` in `settings.json` to use pnpm/bun already have a non-default setup and can use the existing `piInfrastructureReadPaths` config field.
- The Bun binary case has no global `node_modules` tree — extensions are bundled.

### Subprocess implementation

```typescript
function discoverGlobalNodeModulesViaSubprocess(): string | null {
  try {
    const result = spawnSync("npm", ["root", "-g"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const root = result.stdout?.trim();
    if (result.status === 0 && root && existsSync(root)) {
      return root;
    }
    return null;
  } catch {
    return null;
  }
}
```

Key details:

- `timeout: 5000` — 5 second timeout prevents hanging if npm is broken.
- `stdio: ["ignore", "pipe", "ignore"]` — only capture stdout; discard stdin and stderr.
- `existsSync(root)` — sanity-check the returned path actually exists.
- All failures return `null` — same graceful degradation as today.

### Edge cases

- **npm not installed**: `spawnSync` throws `ENOENT` → caught → returns `null`.
- **npm root -g returns a non-existent path**: `existsSync` check → returns `null`.
- **Bun binary runtime**: walk-up fails (virtual filesystem), npm may not be available → subprocess fails → returns `null`.
  Acceptable — Bun binary bundles extensions.
- **Windows**: `npm root -g` works on Windows.
  `spawnSync` handles cross-platform.
- **NVM / fnm**: `npm root -g` returns the correct root for the active Node version.
- **Custom npm prefix**: `npm root -g` respects the configured prefix.

## Module-Level Changes

### `src/external-directory.ts`

- Extract the walk-up loop body into a private `walkUpToNodeModules(fromUrl: string): string | null` helper.
- Add private `discoverGlobalNodeModulesViaSubprocess(): string | null` function.
- Update `discoverGlobalNodeModulesRoot()` to try walk-up first, then subprocess fallback.
- Add imports: `spawnSync` from `node:child_process`, `existsSync` from `node:fs`.

### `tests/external-directory.test.ts`

- Add tests for the subprocess fallback path:
  - Walk-up-from-self succeeds → returns result without invoking subprocess.
  - Walk-up-from-self fails, `npm root -g` returns a valid path → returns that path.
  - Walk-up-from-self fails, `npm root -g` fails → returns `null`.
  - Walk-up-from-self fails, `npm root -g` returns a non-existent path → returns `null`.

### `tests/runtime.test.ts`

- No changes needed — the existing mock of `discoverGlobalNodeModulesRoot` covers the runtime's consumption of the return value.
  The new fallback logic is internal to `discoverGlobalNodeModulesRoot` and tested in `external-directory.test.ts`.

### No changes needed

- `src/runtime.ts` — no API change; it already calls `discoverGlobalNodeModulesRoot()` and handles `null`.
- `src/handlers/tool-call.ts` — no change; it already combines `piInfrastructureDirs` with config paths.
- `schemas/permissions.schema.json` — no config field changes.
- `config/config.example.json` — no config field changes.
- `docs/architecture/` — no architecture doc describes `discoverGlobalNodeModulesRoot` in detail.

## TDD Order

1. **test: cover `npm root -g` fallback in `discoverGlobalNodeModulesRoot`** Add tests in `tests/external-directory.test.ts`:
   - Walk-up-from-self succeeds → returns result without invoking subprocess.
   - Walk-up-from-self fails, subprocess returns valid path → returns that path.
   - Walk-up-from-self fails, subprocess fails (non-zero exit / throws) → returns `null`.
   - Walk-up-from-self fails, subprocess returns non-existent path → returns `null`.
   Mock `spawnSync` to control subprocess behavior without actually spawning.
   Commit: `test: cover npm root -g fallback for global node_modules discovery`

2. **feat: add `npm root -g` fallback to `discoverGlobalNodeModulesRoot`** Extract `walkUpToNodeModules` helper, add `discoverGlobalNodeModulesViaSubprocess`, wire into `discoverGlobalNodeModulesRoot`.
   Commit: `fix: discover global node_modules root from dev checkout via npm root -g fallback`

3. **docs: note the fallback in README** The README already documents `piInfrastructureReadPaths` as the manual workaround.
   Add a brief note that the automatic discovery now works from dev checkouts via `npm root -g` fallback.
   Commit: `docs: note npm root -g fallback for dev checkout infrastructure reads`

## Risks and Mitigations

| Risk                                                                  | Mitigation                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm root -g` returns an unexpected path, widening the auto-allow set | `existsSync` check validates the path exists. The auto-allow is restricted to `READ_ONLY_PATH_BEARING_TOOLS` via `isPiInfrastructureRead`. Writes are never bypassed.                                                                         |
| Could this silently weaken a permission?                              | No. The change only affects which directories are added to `piInfrastructureDirs`, and only for read-only tools. The directory added is the npm global root — the same directory that production installs already auto-allow via the walk-up. |
| Subprocess hangs or is slow                                           | 5-second timeout. Only runs when walk-up fails (dev checkout only). Production installs never hit this path.                                                                                                                                  |
| npm not available (Bun binary, restricted env)                        | `catch` returns `null`, identical to current behavior. No regression.                                                                                                                                                                         |
| #48 rejected `npm root -g`                                            | #48 rejected it as the *primary* strategy because the walk-up-from-self approach was zero-cost for production. Here it's a *fallback* that only fires from dev checkouts where the walk-up fails. The production path is unchanged.           |

## Open Questions

- Should we log a debug message when the subprocess fallback is used?
  This would help diagnose issues but adds noise.
  Leaning yes — it's a dev-only path and the debug log is opt-in.
