---
issue: 3
issue_title: "Post-v1: support additional Pi mutation tools"
---

# Plan: Additional Pi Mutation Tools (Issue #3)

## Problem Statement

The v1 extension only enqueues touched files for two tool names: Pi's built-in `write` and `edit`.
Any other tool that mutates files — whether provided by another Pi extension, an MCP server, or a future built-in — flows through the `tool_result` event without being recognized, so its outputs are never formatted.

Issue #3 asks us to "support additional Pi mutation tools" without broadening to heuristic file scanning, and to "design a clean touched-file reporting interface for custom tools."

## Goals

- Recognize mutations performed by **non-built-in** tools (extension- or MCP-provided) and feed the resulting paths into the existing prompt-end batching pipeline.
- Provide a low-cost integration path for other extensions: declarative config for the common case, and a small event-bus contract for the dynamic case.
- Keep behavior explicit, opt-in, and predictable.
  No inference, no whole-repo scans.
- Reuse the existing `MutationSourceHandler` plumbing, scope filtering, dedupe, and reporting paths unchanged.

## Non-Goals

- Tracking shell-driven mutations.
  That is Issue #4 and has its own plan (`0004-shell-driven-mutation-coverage.md`).
  The two efforts share the same `TouchedFilesQueue` but are independent.
- Adding a stable, versioned public TypeScript API for cross-extension use.
  We expose only the existing `pi.events` channel; everything else stays internal.
- Inferring mutation intent from tool names, schemas, or output content.
  All recognition is opt-in and explicit.
- Strict-mode failure semantics (Issue #6).

## Background

What we know from `pi-mono` (verified against `packages/coding-agent/src/core/extensions/types.ts` and `event-bus.ts` at the current `main`):

- The complete set of **built-in** Pi tools is `bash | read | edit | write | grep | find | ls`.
  Of those, only `bash`, `edit`, and `write` mutate files.
  `edit` and `write` are already covered; `bash` is reserved for Issue #4.
  **There are no additional built-in mutation tools to wire up.**

- Extensions can register arbitrary tools via `pi.registerTool()`.
  Their results arrive as `CustomToolResultEvent` through the same `tool_result` event we already subscribe to, with the shape:

  ```ts
  {
    type: "tool_result";
    toolName: string;                 // arbitrary
    input: Record<string, unknown>;   // tool's args
    details: unknown;                 // tool-specific payload
    content: (TextContent | ImageContent)[];
    isError: boolean;
  }
  ```

  So extension-provided mutation tools already flow past our `tool_result` handler — we just don't recognize their names or know which input field carries the path(s).

- Pi exposes a shared `pi.events: EventBus` with a stable `emit(channel, data)` / `on(channel, handler)` shape.
  This means we can subscribe to a documented channel without coordinating any new public API on Pi's side.

The extension architecture is already compatible with new mutation sources — `TouchedFilesQueue` accepts a list of `MutationSourceHandler`s and applies scope filtering and dedupe centrally.
The work is in *declaration* and *subscription*.

Relevant existing pieces:

- `src/touched-files-queue.ts` — `MutationSourceHandler` registry, central path normalization and scope filtering.
- `src/extension.ts` — assembles the handler list inside `createDefaultAutoformatter` and wires the `tool_result` event.
- `src/formatter-config.ts` / `src/config-loader.ts` — config shape and precedence.
- `src/shell-mutation-detector.ts` — example of a config-driven handler factory; the new work mirrors its structure.

## Design Overview

Two complementary, independent mutation sources.
Either can be used without the other.
Both feed the existing `TouchedFilesQueue` through new `MutationSourceHandler`s, so scope filtering, dedupe, and prompt-end batching are unchanged.

### Source 1: Config-declared custom tools (default off, primary path)

Users declare which non-built-in tools mutate files and where the path(s) live in the `input` payload:

```jsonc
{
  "customMutationTools": [
    { "toolName": "mcp_files_write", "pathField": "path" },
    { "toolName": "mcp_files_move", "pathField": "destination" },
    { "toolName": "codemod_apply",  "pathFields": ["target", "extraTargets"] }
  ]
}
```

Field semantics:

- `toolName` (string, required): exact match against `event.toolName`.
- `pathField` (string, optional): single dotted path into `event.input`.
  Resolves nested fields, e.g. `"args.path"`.
- `pathFields` (string[], optional): multiple dotted paths.
- For both forms, the resolved value may be a string or a string array; string arrays are flattened.
  Non-string scalars (numbers, booleans, null) are ignored.
  `pathField` and `pathFields` differ only in arity, not in value handling — a tool whose field is sometimes a string and sometimes a string array should not require switching keys.
  *(Refined during test-first implementation: the original draft made `pathField` string-only, which would have forced users to switch to `pathFields` for any tool with a variadic field.*
  *Unifying value handling removes that foot-gun.)*
- Exactly one of `pathField` / `pathFields` is required.
  Specifying both is a config validation error.

Recognition rules:

- Only act on `tool_result` events whose `isError === false`.
- Built-in tool names (`bash`, `edit`, `write`, `read`, `grep`, `find`, `ls`) are rejected at config load with a validation issue.
  `edit` and `write` are already covered; the others are not mutating tools and declaring them would be a configuration mistake.
- Duplicate `toolName` entries are an error at config load.
- Per-handler output is fed into the queue, which applies the standard `formatScope` filter and dedupe.
  No new path-handling logic is added.

This covers the common, declarative case (MCP file servers, simple codemod tools, "rename" tools, etc.) without code changes.

### Source 2: EventBus channel (opt-in, dynamic case)

For tools that compute touched paths dynamically — codegen that emits N files, batch operations, tools whose `input` does not contain the written paths — extensions can emit on a documented channel:

```ts
// In another extension:
pi.events.emit("autoformat:touched", { path: "src/generated/api.ts" });
// or:
pi.events.emit("autoformat:touched", {
  paths: ["src/a.ts", "src/b.ts"]
});
```

Channel contract:

- Channel name: `autoformat:touched`.
- Payload: `{ path: string }` or `{ paths: string[] }`.
  Other shapes are ignored silently (no warnings — this channel is best-effort and we must not log on every emission from misconfigured peers).
- Paths follow the same normalization and scope rules as every other source.
  Out-of-scope paths are dropped silently.
- Emissions are accepted at any time during a session; queued paths are flushed at the next prompt-end (consistent with the default timing model).

Subscribing is feature-flagged in config (default on once the feature ships) so users can disable it if a peer extension misbehaves:

```jsonc
{
  "eventBusMutationChannel": {
    "enabled": true,
    "channel": "autoformat:touched"
  }
}
```

Defaulting to *on* is acceptable here because the channel is a no-op unless a peer extension actually emits on it.
The `channel` override exists for testing and for the rare case of a name collision.

## Configuration

New top-level keys, both extension-owned (per AGENTS.md):

```jsonc
{
  "customMutationTools": [],
  "eventBusMutationChannel": {
    "enabled": true,
    "channel": "autoformat:touched"
  }
}
```

Precedence: project overrides global (existing behavior).
For `customMutationTools`, project replaces global wholesale (consistent with how arrays are currently merged elsewhere — confirm and document).

Aligned updates required (per AGENTS.md):

- `schemas/pi-autoformat.schema.json`
- `docs/configuration.md`
- `README.md`
- TypeScript config types in `src/formatter-config.ts`
- Loader and validation in `src/config-loader.ts`

## Code Changes

1. **Config**
   - Extend `UserFormatterConfig` and `AutoformatConfig` in `src/formatter-config.ts` with `customMutationTools` and `eventBusMutationChannel`.
   - Defaults: empty array, channel enabled with the documented name.
   - Loader validation in `src/config-loader.ts`:
     - Reject built-in tool names.
     - Reject duplicate `toolName` entries.
     - Require exactly one of `pathField` / `pathFields`.
     - Validate dotted-path strings are non-empty.

2. **New module: `src/custom-mutation-tools.ts`**
   - Pure function `extractPathsFromInput(input, fieldSpec)` that resolves dotted paths and flattens string arrays.
   - Factory `createCustomToolHandler(spec): MutationSourceHandler`.
   - Factory `createCustomToolHandlers(specs[]): MutationSourceHandler[]`.
   - No I/O; fully unit-testable.

3. **Extension wiring (`src/extension.ts`)**
   - In `createDefaultAutoformatter`, append handlers from `createCustomToolHandlers(config.customMutationTools)` to the existing handler list, after `writeOrEditHandler` and before the bash detector.
   - Order is irrelevant for correctness (queue dedupes) but stable ordering keeps tests deterministic.

4. **EventBus subscription**
   - Accept the `EventBus` (or a small adapter) through `ExtensionApiLike` so it can be stubbed in tests.
     Today `ExtensionApiLike` only exposes `on` for the lifecycle events; we add an optional `events` field and tolerate its absence.
   - At session start, if `eventBusMutationChannel.enabled`, subscribe to the configured channel and forward valid payloads via `autoformatter.addTouchedPath(...)`.
     Unsubscribe on `session_shutdown`.
   - Payload validation lives in a small pure helper for testing (`parseTouchedPayload(unknown): string[]`).

5. **No changes** to `formatter-executor`, `prompt-autoformatter`, or reporting.
   Both new sources surface through the existing prompt-end summary.

## Testing

Per AGENTS.md, focused tests:

- `extractPathsFromInput`
  - top-level string field → `[value]`
  - nested dotted path resolves
  - missing field → `[]`
  - non-string value → `[]` (no coercion)
  - `pathFields` with a string-array value flattens
  - `pathFields` with mixed string + string-array entries flatten
- `createCustomToolHandler`
  - matching `toolName` produces paths
  - non-matching `toolName` produces `[]`
  - errored tool result is not handled (handler is wired only to successful results in the extension layer; assert at the wiring level)
- Config loader
  - rejects built-in tool names with a clear validation issue
  - rejects duplicate `toolName`
  - rejects entries with both / neither of `pathField`/`pathFields`
  - rejects empty / non-string dotted paths
  - project `customMutationTools` replaces global (does not merge)
  - defaults: empty array, channel enabled
- `parseTouchedPayload`
  - `{ path: "x" }` → `["x"]`
  - `{ paths: ["a", "b"] }` → `["a", "b"]`
  - `{ paths: ["a", 1, null] }` → `["a"]` (drops non-strings)
  - unknown shape → `[]`
  - non-object → `[]`
- Extension integration (`extension.test.ts` style)
  - declared custom tool's `tool_result` event populates touched files and triggers prompt-end formatting
  - paths outside `formatScope` are dropped (delegated to existing queue behavior; one regression test is enough)
  - EventBus emission feeds the queue and survives across multiple prompts
  - disabling `eventBusMutationChannel.enabled` prevents subscription
  - missing `pi.events` does not throw (graceful degrade)

## Rollout

1. Land config schema + loader validation with empty defaults; no behavior change.
2. Land `extractPathsFromInput` and `createCustomToolHandler` with unit tests.
3. Wire custom-tool handlers into `createDefaultAutoformatter`.
4. Add EventBus subscription, gated on the new config flag and on `pi.events` being present.
5. Documentation pass: `docs/configuration.md`, `README.md`, schema, and a short "integration guide for other extensions" snippet covering both sources.
6. Update `docs/plans/0001-initial-implementation-plan.md` to reference the new mutation sources.

## Open Questions

- Do we want to expose **details-based** extraction in addition to `input`-based (e.g., `detailsField`)?
  Some custom tools may report written paths in `event.details` rather than `event.input`.
  Likely yes, but the schema would mirror `pathField`/`pathFields`.
  Defer unless a real consumer needs it; easy to add later.
- Should the EventBus payload also accept `{ paths: string }` (singular in the plural key)?
  Probably no — keep the contract strict and documented.
- Should we provide a tiny "testing helper" module that other extensions can import to construct valid payloads?
  Out of scope for this issue; the contract is small enough to inline.

## Explicitly Deferred

- **Programmatic registration API** (e.g., `pi-autoformat.registerMutationSource(handler)`).
  The EventBus channel covers the dynamic case without locking us into a stable TypeScript API surface.
  We can add a typed wrapper module later if real-world usage shows it is needed.
- **Tool-name pattern matching** (regex / glob over `toolName`).
  The current MCP naming conventions are stable enough that exact match is sufficient.
  Patterns can be added without breaking the existing schema.
- **Auto-discovery from tool schemas.**
  Several MCP tools advertise a `path: string` parameter, and we could heuristically opt them in.
  This is exactly the "implicit, surprising" behavior AGENTS.md warns against; keep declarations explicit.

## Checkpoints / Commits

Following Conventional Commits:

- `feat(config): add customMutationTools and eventBusMutationChannel schema`
- `feat: extract touched paths from declared custom tool inputs`
- `feat: subscribe to autoformat:touched event-bus channel`
- `docs: document custom mutation tool integration`
- `test: cover custom mutation tool handlers and event-bus subscription`
