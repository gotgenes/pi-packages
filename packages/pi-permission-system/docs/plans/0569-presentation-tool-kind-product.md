---
issue: 569
issue_title: "Move the presentation family onto the tool-kind product"
---

# Move the presentation family onto the tool-kind product

## Release Recommendation

**Release:** ship now — batch "tool-kind-dispatch" tail (this issue completes the batch)

This is Phase 10 Step 2 of the pi-permission-system roadmap, the **tail** of the two-step batch "tool-kind-dispatch" whose head (Step 1, [#568]) has already landed.
Landing Step 2 completes the batch, so there is no reason to hold it — ship (land on `main`) now.
It is a `refactor:` change (a hidden changelog type), so it does **not** cut a release on its own; it auto-batches into the next `feat:`/`fix:`/unhidden-`docs:` release regardless.
The rationale here does not claim it will cut a release — the "ship now — batch tail" marker means land the coordinated pair's tail, not that a release is emitted.

## Problem Statement

The extraction family migrated onto the `access-intent/tool-kind.ts` classification in Step 1 ([#568]).
The **presentation** family still re-decides the tool kind per formatter by silent string comparison ([#561], Category C repeated-discriminator / OCP):

- `tool-preview-formatter.ts::getToolInputPreviewForLog` — `result.toolName === "bash" || result.toolName === "mcp" || result.source === "mcp"`.
- `permission-prompts.ts` — `formatUnknownToolReason`'s `toolName === "mcp"` MCP hint, `formatAskPrompt`'s `result.toolName === "bash"` bash branch, and its `(result.source === "mcp" || result.toolName === "mcp") && result.target` MCP branch.
- `denial-messages.ts` — two `check.toolName === "bash" && check.command` bash guards plus a private `isMcpCheck()` helper (`(check.source === "mcp" || check.toolName === "mcp") && !!check.target`) called at three sites.
- `handlers/gates/helpers.ts::deriveDecisionValue` — `toolName === "bash"` / `toolName === "mcp"`.

The private `isMcpCheck()` encapsulates the `(source === "mcp" || toolName === "mcp")` MCP-ness derivation, but two sibling call sites — `permission-prompts.ts::formatAskPrompt` and `tool-preview-formatter.ts::getToolInputPreviewForLog` — re-derive the same pattern inline instead of sharing it.
Adding a tool kind, or changing what "MCP-ness" means, requires finding and editing every site, and a missed site diverges silently.

With Step 1 landing the classification at the boundary, the presentation formatters should ask the tool-kind product for their display projection rather than re-checking `toolName`/`source` strings.

## Goals

- Migrate the four presentation consumers named in the roadmap onto `access-intent/tool-kind.ts`: `tool-preview-formatter.ts`, `permission-prompts.ts`, `denial-messages.ts`, `handlers/gates/helpers.ts`.
- Consolidate the `(source === "mcp" || toolName === "mcp")` MCP-ness derivation into a single shared `isMcpCheck` in `tool-kind.ts`; delete the private copy in `denial-messages.ts` so all three denial sites plus the two sibling formatters share one predicate.
- Drive every remaining `toolName`/`source` bash/mcp discriminator through `classifyToolKind` (already exported) or the new shared `isMcpCheck`, so the recompute grep drops the total family from 12 to ≤ 4, all inside `access-intent/tool-kind.ts`.
- Preserve behavior exactly — this is a pure internal refactor with no observable change to prompts, denial messages, log previews, decision values, or config.
  Not a breaking change.

## Non-Goals

- No change to `classifyToolKind` itself, nor to the extraction consumers migrated in Step 1 (`input-normalizer.ts`, `tool-input-path.ts`, `handlers/gates/tool.ts`, `handlers/gates/tool-call-gate-pipeline.ts`, `permission-manager.ts`) — they are already on the product.
- No change to the message text, prompt wording, or log-preview format any formatter emits — the characterization tests must stay green unchanged.
- The `PathFlavor` / win32 discriminator work ([#562], Step 3), advisory bash decomposition ([#309], Step 4), indirection wrappers ([#490], Step 5), and the docs recipe ([#521], Step 6) are separate roadmap steps.

## Background

The Step 1 product (`src/access-intent/tool-kind.ts`) exports:

```typescript
export type ToolKind = "bash" | "mcp" | "skill" | "path" | "extension";
export function classifyToolKind(toolName: string): ToolKind;
```

`classifyToolKind` keys purely on the tool **name**.
The presentation family needs one thing it cannot express: MCP-ness of a *resolved check*, which considers `source === "mcp"` in addition to `toolName === "mcp"`.
`PermissionCheckResult.source` is derived independently of `toolName` (`permission-manager.ts::deriveSource`), and the characterization suite already pins the source-only case:

- `denial-messages.test.ts` "MCP source with target on non-mcp toolName" — `toolCheck("anything", { source: "mcp", target: "server:tool" })` → `"…run MCP target 'server:tool'."`.
- `tool-preview-formatter.test.ts` "returns undefined for mcp source" — `makeResult("some-server:some-tool", { source: "mcp" })` → `undefined`.

So the shared MCP predicate must keep the `source === "mcp"` disjunct; reducing it to `classifyToolKind(toolName) === "mcp"` would regress these two tests.

Constraint from AGENTS.md and Step 1: `permission-manager.ts` carries an ESLint `no-restricted-imports` rule forbidding any import of `access-intent/access-path`, and `tool-kind.ts` must stay `AccessPath`-free so it remains a legal import there.
The new `isMcpCheck` imports nothing new (it reuses `classifyToolKind` and compares `source` to a string literal), so the boundary holds.

The recompute grep (`toolName === "(bash|mcp)"|source === "mcp"`) currently returns 12: one docstring inside `tool-kind.ts` plus the 11 presentation sites above.

## Design Overview

### One shared MCP-ness predicate, target-presence separated

Add a single predicate to `tool-kind.ts` that answers "does this resolved check concern an MCP call?" — nothing more.
Whether a target string is available to *display* is a separate concern that stays at the call sites that need it (SRP):

```typescript
// src/access-intent/tool-kind.ts (added)

/** The resolved-check fields that decide MCP-ness. */
interface McpKindFields {
  toolName: string;
  source: string;
}

/**
 * True when a resolved check concerns an MCP call — either the invoked tool is
 * `mcp`, or the winning rule matched on the `mcp` surface (`source`). The
 * `source` disjunct is why this cannot reduce to `classifyToolKind(toolName)`.
 */
export function isMcpCheck(check: McpKindFields): boolean {
  return check.source === "mcp" || classifyToolKind(check.toolName) === "mcp";
}
```

The param is a narrow structural type (ISP): `PermissionCheckResult` satisfies it structurally (`source` is a union assignable to `string`), so `tool-kind.ts` imports no domain types and stays `AccessPath`-free.

The private `denial-messages.ts::isMcpCheck` currently bakes in `&& !!check.target`.
Separating that out means every call site that needs the target hoists `&& check.target` explicitly — which also gives TypeScript the truthy-narrowing the old `!!check.target` implied.

### Consumer call sites (behavior preserved exactly)

`denial-messages.ts` — three sites, each gaining an explicit `&& check.target` (was folded into the old private helper), plus the two bash guards:

```typescript
// buildToolDenyBody
if (isMcpCheck(check) && check.target) {
  parts.push(`is not permitted to run MCP target '${check.target}'`);
} else {
  parts.push(`is not permitted to run '${check.toolName}'`);
}

// buildUnavailableBody / buildUserDeniedBody — MCP arms
if (isMcpCheck(check) && check.target) { /* MCP-target text */ }

// bash guards (was check.toolName === "bash")
if (classifyToolKind(check.toolName) === "bash" && check.command) { /* … */ }
```

`permission-prompts.ts`:

```typescript
// formatUnknownToolReason — MCP hint (was toolName === "mcp")
const mcpHint = classifyToolKind(toolName) === "mcp" ? "" : " If this was intended…";

// formatAskPrompt — bash branch (was result.toolName === "bash")
if (classifyToolKind(result.toolName) === "bash") { /* bash prompt */ }

// formatAskPrompt — MCP branch (was (source === "mcp" || toolName === "mcp") && target)
if (isMcpCheck(result) && result.target) { /* MCP prompt */ }
```

`tool-preview-formatter.ts::getToolInputPreviewForLog` — the "skip preview because content is surfaced elsewhere" guard is bash **or** MCP-of-a-result (no target requirement, matching the original):

```typescript
if (classifyToolKind(result.toolName) === "bash" || isMcpCheck(result)) {
  return undefined;
}
```

`handlers/gates/helpers.ts::deriveDecisionValue` — an exhaustive `switch` (a future `ToolKind` variant becomes a compile error, the OCP win):

```typescript
switch (classifyToolKind(toolName)) {
  case "bash": return check.command ?? toolName;
  case "mcp": return check.target ?? toolName;
  case "path":
  case "skill":
  case "extension":
    // Preserve the original `if (path) return path; return toolName` — an empty
    // string falls through to toolName, so keep the truthy ternary (not `??`).
    return path ? path : toolName;
}
```

### Why this is decide-once, not procedure-splitting

The refactor removes a genuine repeated discriminator: the `(source === "mcp" || toolName === "mcp")` derivation was re-decided at three-plus sites, and `isMcpCheck` becomes its single home alongside `classifyToolKind`.
Each consumer dispatches on the shared classification instead of re-checking strings; adding a tool kind means editing `tool-kind.ts` plus the exhaustive `switch` the compiler flags.
This is the design-review skill's accepted resolution for a repeated discriminator — capture the decision once at the boundary and hand consumers its product.

### Metric note

The recompute grep keys literally on `toolName === "(bash|mcp)"` / `source === "mcp"`.
Migrated code dispatches on `classifyToolKind(...)` (whose `=== "bash"` / `=== "mcp"` follows a `)`, not the bare `toolName`, so it does not match) or `isMcpCheck(...)`, so the presentation sites drop to 0.
After migration the only matches are inside `access-intent/tool-kind.ts`: the module docstring's `toolName === "bash"` reference and the `source === "mcp"` disjunct in `isMcpCheck` — 2 lines, within the Phase 10 end-state target of ≤ 4.

## Module-Level Changes

- **`src/access-intent/tool-kind.ts`** — add `isMcpCheck(check: { toolName: string; source: string })`; extend the module docstring to note the presentation consumers now dispatch on it too.
  Still imports only `PATH_BEARING_TOOLS`.
- **`src/denial-messages.ts`** — delete the private `isMcpCheck`; import `classifyToolKind` + `isMcpCheck` from `./access-intent/tool-kind`; the three MCP arms become `isMcpCheck(check) && check.target`; the two bash guards become `classifyToolKind(check.toolName) === "bash"`.
- **`src/permission-prompts.ts`** — import `classifyToolKind` + `isMcpCheck`; migrate the MCP hint (`formatUnknownToolReason`), the bash branch, and the MCP branch (`isMcpCheck(result) && result.target`) of `formatAskPrompt`.
- **`src/tool-preview-formatter.ts`** — import `classifyToolKind` + `isMcpCheck`; migrate the `getToolInputPreviewForLog` skip guard.
- **`src/handlers/gates/helpers.ts`** — import `classifyToolKind`; migrate `deriveDecisionValue` to an exhaustive `switch`.
- **`test/access-intent/tool-kind.test.ts`** — add an `isMcpCheck` describe block (toolName-mcp → true, source-mcp on a non-mcp toolName → true, bash → false, plain tool → false).
- **`docs/architecture/architecture.md`** — mark Phase 10 Step 2 `✅` (step heading + `S2` Mermaid node); add a **Landed:** bullet; update the "Tool-kind discriminator sites" metric row to note the target is met (≤ 4, all in `tool-kind.ts`); extend the `tool-kind.ts` module-tree entry (line ~749) to say the presentation consumers (`tool-preview-formatter`, `permission-prompts`, `denial-messages`, `deriveDecisionValue`) dispatch on it via `classifyToolKind`/`isMcpCheck`.

No public `exports`, event channel, or `Symbol.for()` surface changes.
`isMcpCheck` is not a cross-extension API; no user-facing doc, README, or `package-*` SKILL references `isMcpCheck` or the presentation formatters by name (verified by grep — the only `isMcpCheck` mentions are in `src/`, the historical `0568` plan/retro, and the Step 2 roadmap entry being updated here).

## Test Impact Analysis

1. **New tests enabled.**
   `isMcpCheck` becomes independently testable for the first time (it was a private helper inlining the derivation).
   `test/access-intent/tool-kind.test.ts` pins it directly, including the source-only disjunct (`{ toolName: "read", source: "mcp" }` → `true`) that distinguishes it from `classifyToolKind`.
2. **Redundant tests.**
   None become fully redundant.
   The per-consumer characterization tests (`denial-messages.test.ts`, `permission-prompts.test.ts`, `tool-preview-formatter.test.ts`, `helpers.test.ts`) assert each formatter's *output* (message text, prompt string, log preview, decision value), which the refactor keeps invariant, so they remain the safety net.
   The `isMcpCheck` unit test overlaps with them only at the classification layer, not the projection layer.
3. **Tests that must stay as-is.**
   All four presentation characterization suites — in particular `denial-messages.test.ts` "MCP source with target on non-mcp toolName" and `tool-preview-formatter.test.ts` "returns undefined for mcp source", which pin the `source === "mcp"` disjunct the shared predicate must keep.

Before each migration, confirm the touched branch has characterization coverage (verified above — MCP-with-target, MCP-via-source, bash, and generic-tool arms are all covered across the four suites); add a red characterization test only if a gap surfaces.

## Invariants at risk

The refactor touches surfaces earlier phases refactored; each invariant is pinned by an existing test:

- **MCP-ness considers `source`, not just `toolName`** — Step 1's `deriveSource` can set `source: "mcp"` on a result whose `toolName` is a server-qualified string.
  Pinned by `denial-messages.test.ts` "MCP source with target on non-mcp toolName" and `tool-preview-formatter.test.ts` "returns undefined for mcp source".
- **Formatter output text unchanged** — every prompt, denial, unavailable, user-denied, log-preview, and decision-value projection.
  Pinned by the four presentation characterization suites (kept green, unchanged).
- **`deriveDecisionValue` empty-path fallback** — an empty `path` string falls through to `toolName` (the original `if (path)` truthiness).
  Pinned by `helpers.test.ts` "falls back to toolName for path-bearing tools when path is missing"; preserved by the truthy ternary (`path ? path : toolName`), not `??`.
- **ADR-0002 string boundary** — `tool-kind.ts` stays `AccessPath`-free so `isMcpCheck`/`classifyToolKind` remain legal imports package-wide.
  Pinned by the `no-restricted-imports` ESLint rule on `permission-manager.ts` (which does not import the presentation modules, so it is unaffected either way).

## TDD Order

Each migration is behavior-preserving under the existing green suite; only the new `isMcpCheck` unit tests carry a true red.
Run `pnpm run check` after each step and the full package suite before committing.

1. **Add `isMcpCheck` + migrate `denial-messages.ts`.**
   Red: `test/access-intent/tool-kind.test.ts` `isMcpCheck` block (function absent).
   Green: implement `isMcpCheck` in `tool-kind.ts`, then delete the private `denial-messages.ts::isMcpCheck` and migrate its three MCP arms (`isMcpCheck(check) && check.target`) and two bash guards (`classifyToolKind(check.toolName) === "bash"`) in the **same** commit so the export lands with a consumer (avoids a `fallow dead-code` failure on an unwired export).
   `denial-messages.test.ts` stays green.
   Commit: `refactor(pi-permission-system): share MCP-check via tool-kind product in denial messages`.
2. **Migrate `permission-prompts.ts`.**
   `formatUnknownToolReason` MCP hint, `formatAskPrompt` bash branch, and MCP branch (`isMcpCheck(result) && result.target`) dispatch on the product.
   `permission-prompts.test.ts` green.
   Commit: `refactor(pi-permission-system): classify prompt tool kind via tool-kind product`.
3. **Migrate `tool-preview-formatter.ts`.**
   `getToolInputPreviewForLog` skip guard → `classifyToolKind(result.toolName) === "bash" || isMcpCheck(result)`.
   `tool-preview-formatter.test.ts` green.
   Commit: `refactor(pi-permission-system): classify preview tool kind via tool-kind product`.
4. **Migrate `handlers/gates/helpers.ts::deriveDecisionValue`.**
   Exhaustive `switch (classifyToolKind(toolName))`, preserving the empty-path truthy fallback.
   `helpers.test.ts` green.
   Commit: `refactor(pi-permission-system): derive decision value via tool-kind classification`.
5. **Record the roadmap step.**
   Update `docs/architecture/architecture.md`: mark Phase 10 Step 2 `✅` (heading + `S2` Mermaid node), add the **Landed:** bullet, update the "Tool-kind discriminator sites" metric row (target met), extend the `tool-kind.ts` module-tree entry to name the presentation consumers.
   Verify the recompute returns ≤ 4 (expected 2, both inside `tool-kind.ts`).
   Commit: `docs(pi-permission-system): record Phase 10 Step 2 presentation tool-kind migration`.

## Risks and Mitigations

- **Dropping the `source === "mcp"` disjunct.**
  A naive `classifyToolKind(toolName) === "mcp"` replacement would regress the source-only characterization tests.
  Mitigation: `isMcpCheck` keeps the `source === "mcp"` disjunct; the two pinning tests stay green.
- **`&& target` hoist changes a branch.**
  Moving the target guard from the private helper to the call sites must be applied at all three denial sites and the prompt MCP branch.
  Mitigation: enumerate them (three in `denial-messages.ts`, one in `permission-prompts.ts`); `tool-preview-formatter.ts` deliberately omits it (its original had no target check).
  The characterization suites (MCP-with-target unavailable/user-denied/deny arms, MCP-via-source) catch any slip.
- **`deriveDecisionValue` empty-path fallback.**
  `path ?? toolName` would return `""` for an empty path; the original returns `toolName`.
  Mitigation: keep the truthy ternary; `helpers.test.ts` pins it.
- **Unwired export → `fallow dead-code`.**
  Mitigation: fold the first consumer (`denial-messages.ts`) into the `isMcpCheck` introduction commit (Step 1).
- **Exhaustiveness drift.**
  Mitigation: `deriveDecisionValue` uses an exhaustive `switch` with no `default`, so a future `ToolKind` variant is a compile error.

## Open Questions

- None blocking.
  The one design choice (a single no-target `isMcpCheck` with target-presence hoisted to call sites, vs. two predicates) is resolved by SRP and the existing characterization coverage; it is behavior-preserving either way.

[#309]: https://github.com/gotgenes/pi-packages/issues/309
[#490]: https://github.com/gotgenes/pi-packages/issues/490
[#521]: https://github.com/gotgenes/pi-packages/issues/521
[#561]: https://github.com/gotgenes/pi-packages/issues/561
[#562]: https://github.com/gotgenes/pi-packages/issues/562
[#568]: https://github.com/gotgenes/pi-packages/issues/568
