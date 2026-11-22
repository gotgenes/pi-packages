---
issue: 568
issue_title: "Tool-kind classification decided once at the normalize boundary (extraction family)"
---

# Tool-kind classification decided once at the normalize boundary (extraction family)

## Release Recommendation

**Release:** mid-batch — defer (batch "tool-kind-dispatch"); confirm at ship time

This is Phase 10 Step 1 of the pi-permission-system roadmap, the head of the two-step batch "tool-kind-dispatch" whose tail is Step 2 ([#569]).
The batch ships together, so this step lands on `main` but does not cut a release on its own.
It is a `refactor:` change (a hidden changelog type), so it auto-batches into the next `feat:`/`fix:`/unhidden-`docs:` release regardless — the rationale here does not claim it will cut a release.

## Problem Statement

The extraction question — "what does this invocation access: a bash command, an MCP target, or a path?" — is re-derived by silent string comparison (`toolName === "bash"`, `toolName === "mcp"`, `source === "mcp"`) at 21 production sites across 8 modules ([#561]).
This is a Category C repeated-discriminator / OCP flaw: the same domain decision is re-decided at every consumer, so adding a tool kind or changing what "MCP-ness" means requires finding and editing every site, and a missed site diverges silently — there is no compiler-enforced exhaustive dispatch, just scattered `===` comparisons.
`fallow dupes` is structurally blind to it (one-line comparisons never form a token-run clone); the repeated-discriminator grep sweep is the only detector.

This step captures the classification once in a new `access-intent/tool-kind.ts` and migrates the **extraction-family** consumers onto it.
The **presentation-family** consumers (prompts, previews, denial messages, decision values) follow in Step 2 ([#569]).

## Goals

- Introduce `src/access-intent/tool-kind.ts` owning a `ToolKind` discriminated classification and its single dispatch point, `classifyToolKind(toolName)`.
- Migrate the five extraction consumers named in the roadmap to ask the classification instead of re-checking the raw string: `input-normalizer.ts`, `tool-input-path.ts`, `handlers/gates/tool.ts`, `handlers/gates/tool-call-gate-pipeline.ts`, `permission-manager.ts`.
- Keep `permission-manager.ts` string-based: `tool-kind.ts` returns plain data (a string union), imports no `AccessPath`, and stays safe to consume there per `docs/decisions/0002-path-values-string-boundary.md`.
- Preserve behavior exactly — this is a pure internal refactor with no observable change to decisions, output, or config.
  Not a breaking change.

## Non-Goals

- The presentation family (`tool-preview-formatter.ts`, `permission-prompts.ts`, `denial-messages.ts`, `handlers/gates/helpers.ts::deriveDecisionValue`, and `denial-messages.ts::isMcpCheck`) — deferred to Step 2 ([#569]).
- `input-normalizer.ts::buildInputForSurface` (the `surface === "bash"` / `"skill"` / `"external_directory"` inverse reconstruction) is **not** migrated: it dispatches on path/service **surface** names, not tool names, and `external_directory` has no `ToolKind` variant, so `classifyToolKind` would drop that branch.
  It is outside the extraction-discriminator family (it is not a grep-counted site) and stays as-is.
- `PathFlavor` / win32 discriminator work ([#562], Step 3), advisory bash decomposition ([#309], Step 4), indirection wrappers ([#490], Step 5), and the docs recipe ([#521], Step 6) are separate roadmap steps.

## Background

The extraction consumers and their exact discriminator sites (the official recompute grep, `toolName === "(bash|mcp)"|source === "mcp"`, run 2026-07-10):

| Module                                      | Sites    | Role                                                                          |
| ------------------------------------------- | -------- | ----------------------------------------------------------------------------- |
| `input-normalizer.ts`                       | 122, 138 | `normalizeInput` — builds the `(surface, values, resultExtras)` triple        |
| `tool-input-path.ts`                        | 34, 44   | `getToolInputPath` — extracts the filesystem path for the cross-cutting gates |
| `handlers/gates/tool.ts`                    | 26, 27   | `deriveSuggestionValue` — the session-approval suggestion value               |
| `handlers/gates/tool-call-gate-pipeline.ts` | 80, 162  | bash-parse guard + `resolvePerToolCheck` bash branch                          |
| `permission-manager.ts`                     | 448, 455 | `deriveSource` — maps a matched rule + tool to `PermissionCheckResult.source` |

That is 10 extraction sites; the remaining 11 (in `denial-messages.ts`, `tool-preview-formatter.ts`, `permission-prompts.ts`, `handlers/gates/helpers.ts`) are the presentation family Step 2 clears.

The classification set is fixed by the existing surfaces:

- `bash` — its own token-based path gates; extraction product is the command string.
- `mcp` — extraction product is the qualified target string(s).
- `skill` — a distinct surface `normalizeInput` and `deriveSource` treat specially.
- path-bearing built-ins (`read`/`write`/`edit`/`grep`/`find`/`ls`, the `PATH_BEARING_TOOLS` set in `path-surfaces.ts`) — extraction product is `input.path`.
- everything else (extension tools, and the `external_directory`/`path` special surfaces that reach `deriveSource` as normalized names).

Two AGENTS.md constraints apply:

- `permission-manager.ts` carries an ESLint `no-restricted-imports` rule (`eslint.config.js`) forbidding any import of `access-intent/access-path`.
  `tool-kind.ts` imports only `PATH_BEARING_TOOLS` (from `path-surfaces.ts`, a pure module), so importing `classifyToolKind` there does not breach the boundary.
  `tool-kind.ts` must stay `AccessPath`-free to keep this true.
- When the roadmap step completes, the implementation doc-update commit marks Phase 10 Step 1 `✅` on both its heading and its Mermaid node in `docs/architecture/architecture.md`, per the package skill — not a deferred ship commit.

## Design Overview

### The classification

`tool-kind.ts` owns a string-union `ToolKind` and one dispatch function.
A plain string union (not a rich product object carrying the extracted command/target/path) is the right granularity:

- A rich product would have to be built with the MCP server-name list (`createMcpPermissionTargets`), the tool-access extractor registry, and the `PathNormalizer`/`AccessPath` — but `deriveSource` and the pipeline's bash guard have none of those in hand, and pulling `AccessPath` into `tool-kind.ts` would breach the ADR-0002 boundary permission-manager depends on.
- The string union keeps the classifier a pure, plain-data function every consumer can call, while each consumer builds its own product by dispatching on the shared kind.
  The classification is the single missing dispatch point ([#561]); the per-kind products stay where their dependencies live.

```typescript
// src/access-intent/tool-kind.ts
import { PATH_BEARING_TOOLS } from "#src/path-surfaces";

/** What a tool invocation accesses, decided once from the tool name. */
export type ToolKind = "bash" | "mcp" | "skill" | "path" | "extension";

export function classifyToolKind(toolName: string): ToolKind {
  const name = toolName.trim();
  if (name === "bash") return "bash";
  if (name === "mcp") return "mcp";
  if (name === "skill") return "skill";
  if (PATH_BEARING_TOOLS.has(name)) return "path";
  return "extension";
}
```

`tool-kind.ts` is `AccessPath`-free (its only import is the pure `PATH_BEARING_TOOLS` set), so it is plain data safe for `permission-manager.ts` to consume — the ADR-0002 constraint holds.

### Why this is decide-once, not procedure-splitting

The refactor introduces a genuine new collaborator (`classifyToolKind`, the dispatch point that did not exist) and gives behavior to data (a `ToolKind` union the consumers dispatch on via exhaustive `switch`).
Adding a new tool kind then means editing `classifyToolKind` plus the exhaustive switches the compiler flags — an OCP win over silent `===` comparisons that a new variant sails past.
This is the design-review skill's accepted resolution for a repeated discriminator: capture the decision once at the boundary and hand consumers its product.

### Consumer call sites (Tell-Don't-Ask preserved)

Each consumer replaces its inline `toolName === "bash"` chain with a `switch` (or single comparison) on the shared classification.
Representative sketches:

```typescript
// input-normalizer.ts — normalizeInput
switch (classifyToolKind(toolName)) {
  case "skill":     return { surface: "skill", values: [skillName ?? "*"], resultExtras: {} };
  case "bash":      return { surface: "bash", values: [matchValue], resultExtras: { command } };
  case "mcp":       return { surface: "mcp", values: mcpTargets, resultExtras: { target } };
  case "path":
  case "extension": return { surface: toolName, values: ["*"], resultExtras: {} };
}
```

```typescript
// tool-input-path.ts — getToolInputPath
switch (classifyToolKind(toolName)) {
  case "bash":      return null;                                             // own token gates
  case "path":      return getNonEmptyString(record.path);
  case "mcp":       return getNonEmptyString(toRecord(record.arguments).path);
  case "skill":                                                             // no path; default
  case "extension": return getNonEmptyString((extractors?.get(toolName) ?? ((r) => r.path))(record));
}
```

```typescript
// handlers/gates/tool.ts — deriveSuggestionValue (accessPath stays here; tool-kind.ts stays AccessPath-free)
switch (classifyToolKind(tcc.toolName)) {
  case "bash": return check.command ?? "";
  case "mcp":  return check.target ?? "mcp";
  default:     return accessPath ? accessPath.value() : "*";
}
```

`deriveSource` keeps its `SPECIAL_PERMISSION_KEYS` check (the `external_directory`/`path` surfaces classify as `extension`, then the special-key check maps them to `"special"`), and dispatches the remaining arms on `classifyToolKind`.
`getPathBearingToolPath` becomes `classifyToolKind(toolName) === "path"`.
The pipeline's two bash guards become `classifyToolKind(tcc.toolName) === "bash"` (compute the kind once at the top of `evaluate`).
`buildCheckResult`'s `surface === "mcp"` target-shaping becomes `classifyToolKind(surface) === "mcp"` for consistency.

### Observed redundancy: `getToolPermission`

`getToolPermission` (permission-manager) branches on `normalizedToolName === "bash"` / `"mcp"` / `"skill"` (not grep-counted — the variable is `normalizedToolName`, not `toolName`), but every branch — including the `SPECIAL` and default arms — evaluates the identical expression `evaluate(normalizedToolName, "*", composedRules, this.platform).action`.
The branching is provably dead.
Collapsing the whole body to that single return is a behavior-identical simplification folded into the `permission-manager` migration step, covered by the existing `getToolPermission` tests.
It removes a discriminator without needing `classifyToolKind`.

### Metric note

The roadmap's recompute grep keys literally on `toolName ===` / `source ===`.
Migrated consumers dispatch on a `classifyToolKind(...)`/`kind`-named value, and `classifyToolKind` itself compares a `name`-named local, so none of the migrated code matches the grep — extraction-family sites drop to 0 and the total falls from 21 to 11 (presentation only), within the Step 1 target of ≤ 12.
The Phase 10 end-state target (≤ 4, all in `tool-kind.ts`) is reached only after Step 2.

## Module-Level Changes

- **`src/access-intent/tool-kind.ts`** (new) — `ToolKind` union + `classifyToolKind`; imports only `PATH_BEARING_TOOLS`.
- **`src/input-normalizer.ts`** — `normalizeInput` dispatches on `classifyToolKind`; `buildInputForSurface` unchanged (see Non-Goals).
- **`src/tool-input-path.ts`** — `getToolInputPath` and `getPathBearingToolPath` dispatch on `classifyToolKind`.
- **`src/handlers/gates/tool.ts`** — `deriveSuggestionValue` dispatches on `classifyToolKind` (AccessPath handling stays local).
- **`src/handlers/gates/tool-call-gate-pipeline.ts`** — the bash-parse guard (`evaluate`) and `resolvePerToolCheck` bash branch use `classifyToolKind(tcc.toolName) === "bash"`, computed once.
- **`src/permission-manager.ts`** — `deriveSource` and `buildCheckResult` (`surface === "mcp"`) dispatch on `classifyToolKind`; `getToolPermission` collapses its dead branches.
  Imports `classifyToolKind` (allowed — it is not `access-path`).
- **`test/access-intent/tool-kind.test.ts`** (new) — unit tests for `classifyToolKind`.
- **`docs/architecture/architecture.md`** — add a `tool-kind.ts` entry under `access-intent/` in the module-layout tree; mark Phase 10 Step 1 `✅` on its heading and Mermaid node; annotate the "Tool-kind discriminator sites" metric row that the extraction family is cleared (presentation remains until Step 2).

No public `exports`, event channel, or `Symbol.for()` surface changes — so no `docs/`-tree or README grep beyond the architecture doc is needed.
`classifyToolKind` is not a cross-extension API; no user-facing doc references it.

## Test Impact Analysis

1. **New tests enabled.**
   The classification was inlined at 10 sites and untestable in isolation.
   `test/access-intent/tool-kind.test.ts` pins it directly: `bash`/`mcp`/`skill`, each member of `PATH_BEARING_TOOLS` → `path`, an arbitrary extension tool → `extension`, and whitespace-trim (`" bash "` → `bash`).
2. **Redundant tests.**
   None become fully redundant.
   Per-consumer "is this bash/mcp?" behavior is now also covered indirectly by the classifier test, but the consumer tests assert the consumer's *product* (surface/values/extras, path, suggestion value, source) — the refactor must preserve those, so they stay.
3. **Tests that must stay as-is.**
   `input-normalizer.test.ts`, `tool-input-path.test.ts`, `handlers/gates/tool.test.ts`, `handlers/gates/tool-call-gate-pipeline.test.ts`, and `permission-manager-unified.test.ts` exercise the extraction products the refactor keeps invariant — they are the characterization safety net.

Before each migration, confirm the touched branch has characterization coverage; add a red characterization test only where a branch is uncovered (candidates: `getToolInputPath("skill", …)` → default path; `deriveSource` for the `external_directory`/`path` special surfaces and for an extension tool at the default layer).

## Invariants at risk

The refactor touches surfaces earlier phases refactored; each invariant is pinned by an existing test:

- **Extraction products unchanged** — `normalizeInput`'s `(surface, values, resultExtras)` ([#478]), `getToolInputPath`'s per-kind path ([#502]), `deriveSource`'s source mapping, and the pipeline's single-parse bash guard.
  Pinned by the five test files above.
- **ADR-0002 string boundary** — `permission-manager.ts` must not import `AccessPath`.
  Pinned by the `no-restricted-imports` ESLint rule (`eslint.config.js`); `tool-kind.ts` staying `AccessPath`-free keeps `classifyToolKind` a legal import.
- **Special-surface source** — `external_directory`/`path` still resolve to `source: "special"`.
  Ensure a characterization test covers it before migrating `deriveSource`.

## TDD Order

Each migration is behavior-preserving under the existing green suite; only the new module carries a true red.
Run `pnpm run check` after each step (shared-type / interface touch) and the full package suite before committing (shared helpers).

1. **Introduce `tool-kind.ts` + migrate the first consumer.**
   Red: `test/access-intent/tool-kind.test.ts` (module absent).
   Green: implement `classifyToolKind`, then migrate `tool-input-path.ts` (`getToolInputPath`, `getPathBearingToolPath`) so the export has a production consumer immediately (avoids a `fallow dead-code` failure on an unwired export).
   `tool-input-path.test.ts` stays green.
   Commit: `refactor(pi-permission-system): add tool-kind classification and migrate tool-input-path`.
2. **Migrate `normalizeInput`.**
   Refactor `input-normalizer.ts::normalizeInput` to the `classifyToolKind` switch; `input-normalizer.test.ts` green.
   Commit: `refactor(pi-permission-system): normalize input via tool-kind classification`.
3. **Migrate `permission-manager.ts`.**
   `deriveSource` + `buildCheckResult` (`surface === "mcp"`) dispatch on `classifyToolKind`; collapse `getToolPermission`'s dead branches.
   Add the special-surface / extension-default source characterization test first if uncovered.
   `permission-manager-unified.test.ts` and `permission-manager-yolo.test.ts` green; run `pnpm run check` (shared-type consumer).
   Commit: `refactor(pi-permission-system): derive check-result source via tool-kind`.
4. **Migrate the gate consumers.**
   `handlers/gates/tool.ts::deriveSuggestionValue` and `tool-call-gate-pipeline.ts` (compute the kind once, replace both bash guards).
   `tool.test.ts` and `tool-call-gate-pipeline.test.ts` green.
   Commit: `refactor(pi-permission-system): classify tool kind in the tool-call gate pipeline`.
5. **Record the roadmap step.**
   Update `docs/architecture/architecture.md`: add `tool-kind.ts` to the `access-intent/` module tree, mark Phase 10 Step 1 `✅` (heading + Mermaid node), annotate the metric row.
   Verify the extraction-family recompute returns 0.
   Commit: `docs(pi-permission-system): record Phase 10 Step 1 tool-kind classification`.

## Risks and Mitigations

- **Exhaustiveness drift.**
  A future `ToolKind` variant must reach every switch.
  Mitigation: use exhaustive `switch` statements (or a `never`-typed default) in `normalizeInput`, `getToolInputPath`, and `deriveSource` so a new variant is a compile error, not a silent fall-through.
- **`getToolInputPath` skill branch.**
  `skill` currently falls to the default `record.path` extraction; the migration must fold `skill` into the same arm as `extension`, not into `bash`/`path`/`mcp`.
  Mitigation: characterization test for `getToolInputPath("skill", …)` → `null`.
- **`deriveSource` special surfaces.**
  `external_directory`/`path` classify as `extension`; the `SPECIAL_PERMISSION_KEYS` check must run and map them to `"special"`.
  Mitigation: keep the special-key check ahead of the default arm; characterization test.
- **Unwired export → `fallow dead-code`.**
  CI gates on it.
  Mitigation: fold the first consumer into the introduction commit (Step 1) so `classifyToolKind` never lands unused.
- **ADR-0002 breach.**
  Mitigation: `tool-kind.ts` imports only `PATH_BEARING_TOOLS`; the existing ESLint rule guards `permission-manager.ts`.
  Confirm `pnpm run lint` passes after Step 3.

## Open Questions

- None blocking.
  `getToolPermission`'s dead-branch collapse is included as a behavior-identical simplification; if review prefers to keep it out of a classification-focused refactor, it can drop to a one-line follow-up without affecting the rest.

[#309]: https://github.com/gotgenes/pi-packages/issues/309
[#478]: https://github.com/gotgenes/pi-packages/issues/478
[#490]: https://github.com/gotgenes/pi-packages/issues/490
[#502]: https://github.com/gotgenes/pi-packages/issues/502
[#521]: https://github.com/gotgenes/pi-packages/issues/521
[#561]: https://github.com/gotgenes/pi-packages/issues/561
[#562]: https://github.com/gotgenes/pi-packages/issues/562
[#569]: https://github.com/gotgenes/pi-packages/issues/569
