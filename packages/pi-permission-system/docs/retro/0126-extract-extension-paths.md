---
issue: 126
issue_title: "refactor: extract ExtensionPaths value object from ExtensionRuntime"
---

# Retro: #126 — extract ExtensionPaths value object

## Final Retrospective (2026-05-08T00:20:00Z)

### Session summary

Extracted six immutable path fields from `ExtensionRuntime` into a new `ExtensionPaths` interface and `computeExtensionPaths()` factory in `src/extension-paths.ts`.
Updated `ExtensionRuntime` to `extends ExtensionPaths`, delegated path computation in `createExtensionRuntime`, and narrowed `HandlerDeps.piInfrastructureDirs` to `readonly string[]`.
Shipped as v5.7.0 with zero behavioral change.
11 new unit tests; total suite 1245 tests across 55 files.

### Observations

#### What went well

- **Plan-to-ship pipeline was smooth.**
  Three phases (plan → TDD → ship) completed in a single session with no rework.
  The plan's risk table predicted the exact `readonly string[]` assignability issue and the `discoverGlobalNodeModulesRoot` mock-interception strategy, both of which played out as described.
- **Transitive mock interception worked cleanly.**
  The existing `vi.mock("../src/node-modules-discovery")` in `runtime.test.ts` continued to intercept correctly through `computeExtensionPaths`, avoiding any mock-target migration.
  The plan listed this as the simpler of two options and it proved correct.

#### What caused friction (agent side)

- `missing-context` — The plan's Module-Level Changes section listed `src/handlers/types.ts` as "Unchanged" but the `readonly string[]` narrowing of `piInfrastructureDirs` in `ExtensionPaths` made `HandlerDeps.piInfrastructureDirs: string[]` incompatible at the assignment site in `src/index.ts`.
  Caught by `pnpm run build` during cycle 2.
  Impact: one extra edit to `src/handlers/types.ts` folded into the refactor commit — no rework, added ~30 seconds.
  Self-identified via compiler output.

#### What caused friction (user side)

- None observed.
