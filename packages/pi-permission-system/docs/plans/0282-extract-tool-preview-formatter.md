---
issue: 282
issue_title: "Extract ToolPreviewFormatter from tool-input-preview.ts"
---

# Extract `ToolPreviewFormatter` from `tool-input-preview.ts`

## Problem Statement

`src/tool-input-preview.ts` is a flat module of 15 exports (3 constants + 12 functions) that mix prompt formatting, log formatting, and text utilities.
The config-dependent formatting functions (`formatToolInputForPrompt`, `sanitizeInlineText`, etc.) read module-level constants (`TOOL_INPUT_PREVIEW_MAX_LENGTH = 200`, `TOOL_TEXT_SUMMARY_MAX_LENGTH = 80`) with no way to receive runtime configuration.

The call chain from `PermissionGateHandler.handleToolCall` -> `describeToolGate` -> `formatAskPrompt` -> `formatToolInputForPrompt` -> `formatJsonInputForPrompt` spans 5 pure-function layers.
Adding configurable limits ([#266]) would require threading two numbers through every layer.

This is prerequisite work for [#266] (configurable preview limits).
Phase 1 of the improvement roadmap in `packages/pi-permission-system/docs/architecture/architecture.md` defines this extraction as Step 1 and Step 2.

## Goals

- Extract a `ToolPreviewFormatter` class from `tool-input-preview.ts` that accepts limits in its constructor.
- Thread the formatter through the gate descriptor chain: `describeToolGate` and `formatAskPrompt` gain a formatter parameter.
- `PermissionGateHandler.handleToolCall` constructs the formatter with default values and passes it to the tool gate.
- Eliminate the module-level `vi.mock("../src/tool-input-preview.js")` in `permission-prompts.test.ts` — tests inject the formatter directly.
- All existing tests pass without behavioral changes.

## Non-Goals

- No configuration fields added to `PermissionSystemExtensionConfig` — that is [#266] Step 3.
- No `register()` formatter extension seam — that is [#283].
- No change to `tool.ts` `describeToolGate`'s return shape, `GateDescriptor`, `GateResult`, or `GateRunnerDeps`.
- No change to the gate pipeline in `permission-gate-handler.ts` (already decomposed by [#285]).
- No renaming of pure utility functions that stay in `tool-input-preview.ts`.

## Background

### Current module boundaries

`src/tool-input-preview.ts` exports 15 items:

| Export                                                       | Category      | Config-dependent?                                   |
| ------------------------------------------------------------ | ------------- | --------------------------------------------------- |
| `TOOL_INPUT_PREVIEW_MAX_LENGTH` (200)                        | constant      | default value                                       |
| `TOOL_INPUT_LOG_PREVIEW_MAX_LENGTH` (1000)                   | constant      | default value                                       |
| `TOOL_TEXT_SUMMARY_MAX_LENGTH` (80)                          | constant      | default value                                       |
| `truncateInlineText(value, maxLength)`                       | pure utility  | no — maxLength is a parameter                       |
| `sanitizeInlineText(value, maxLength?)`                      | formatter     | **yes** — default uses TOOL_TEXT_SUMMARY_MAX_LENGTH |
| `countTextLines(value)`                                      | pure utility  | no                                                  |
| `formatCount(value, singular, plural)`                       | pure utility  | no                                                  |
| `getPromptPath(input)`                                       | pure utility  | no                                                  |
| `formatEditInputForPrompt(input)`                            | pure utility  | no                                                  |
| `formatWriteInputForPrompt(input)`                           | pure utility  | no                                                  |
| `formatReadInputForPrompt(input)`                            | pure utility  | no                                                  |
| `formatSearchInputForPrompt(toolName, input)`                | formatter     | **yes** — calls sanitizeInlineText                  |
| `serializeToolInputPreview(input)`                           | pure utility  | no                                                  |
| `formatJsonInputForPrompt(input)`                            | formatter     | **yes** — uses TOOL_INPUT_PREVIEW_MAX_LENGTH        |
| `formatToolInputForPrompt(toolName, input)`                  | formatter     | **yes** — dispatches to formatJsonInputForPrompt    |
| `formatGenericToolInputForLog(input)`                        | log formatter | **yes** — uses TOOL_INPUT_LOG_PREVIEW_MAX_LENGTH    |
| `getToolInputPreviewForLog(result, input, pathBearingTools)` | log formatter | **yes** — calls config-dependent functions          |
| `getPermissionLogContext(result, input, pathBearingTools)`   | log formatter | **yes** — calls config-dependent functions          |

### Current call chain

```text
PermissionGateHandler.handleToolCall()
  └─ gate producer thunk
       ├─ describeToolGate(tcc, check)
       │    ├─ getPermissionLogContext(check, tcc.input, PATH_BEARING_TOOLS)
       │    │    └─ getToolInputPreviewForLog(result, input, pathBearingTools)
       │    │         ├─ formatToolInputForPrompt(toolName, input)
       │    │         │    └─ formatJsonInputForPrompt(input)
       │    │         │         └─ truncateInlineText(inline, TOOL_INPUT_PREVIEW_MAX_LENGTH)
       │    │         └─ formatGenericToolInputForLog(input)
       │    │              └─ truncateInlineText(inline, TOOL_INPUT_LOG_PREVIEW_MAX_LENGTH)
       │    └─ formatAskPrompt(check, agentName, input)
       │         └─ formatToolInputForPrompt(toolName, input)
       │              └─ formatJsonInputForPrompt(input)
       │                   └─ truncateInlineText(inline, TOOL_INPUT_PREVIEW_MAX_LENGTH)
       └─ toolDescriptor.preCheck = toolCheck
```

### Prior work

[#285] (Phase 2 Step 1) has already decomposed `handleToolCall` into a gate pipeline with a `runGate` helper and `validateRequestedTool` prelude.
The tool gate is now a producer thunk in a `gateProducers` array, making the formatter injection point clean and isolated.

### References

- Architecture roadmap: `packages/pi-permission-system/docs/architecture/architecture.md` lines 543–650.
- Constants and config-dependent functions: `src/tool-input-preview.ts`.
- Gate descriptor: `src/handlers/gates/tool.ts`.
- Ask-prompt formatting: `src/permission-prompts.ts`.
- Handler orchestrator: `src/handlers/permission-gate-handler.ts`.
- Existing tests: `test/tool-input-preview.test.ts`, `test/permission-prompts.test.ts`, `test/handlers/gates/tool.test.ts`.

## Design Overview

### `ToolPreviewFormatter` class (new file: `src/tool-preview-formatter.ts`)

```typescript
export interface ToolPreviewFormatterOptions {
  toolInputPreviewMaxLength: number;
  toolTextSummaryMaxLength: number;
  toolInputLogPreviewMaxLength: number;
}

export class ToolPreviewFormatter {
  constructor(private readonly options: ToolPreviewFormatterOptions) {}

  // Prompt formatting — config-dependent
  formatToolInputForPrompt(toolName: string, input: unknown): string;
  formatJsonInputForPrompt(input: unknown): string;
  formatSearchInputForPrompt(toolName: string, input: Record<string, unknown>): string;
  sanitizeInlineText(value: string, maxLength?: number): string;

  // Log formatting — config-dependent
  formatGenericToolInputForLog(input: unknown): string | undefined;
  getToolInputPreviewForLog(
    result: PermissionCheckResult,
    input: unknown,
    pathBearingTools: ReadonlySet<string>,
  ): string | undefined;
  getPermissionLogContext(
    result: PermissionCheckResult,
    input: unknown,
    pathBearingTools: ReadonlySet<string>,
  ): { command?: string; target?: string; toolInputPreview?: string; origin?: string };
}
```

The constructor is the single config injection point.
All config-dependent methods use `this.options` instead of module-level constants.
`sanitizeInlineText` preserves its optional `maxLength` override parameter — when provided, it bypasses the constructor default.

The class imports pure utilities from `tool-input-preview.ts` as-is (`truncateInlineText`, `serializeToolInputPreview`, `getPromptPath`).

### `tool-input-preview.ts` after extraction

Keeps only: constants, pure utilities, and the tool-specific formatters that are purely structural (no config dependency):

- Module-level constants (`TOOL_INPUT_PREVIEW_MAX_LENGTH`, `TOOL_INPUT_LOG_PREVIEW_MAX_LENGTH`, `TOOL_TEXT_SUMMARY_MAX_LENGTH`)
- `truncateInlineText`, `countTextLines`, `formatCount`, `getPromptPath`
- `serializeToolInputPreview`
- `formatEditInputForPrompt`, `formatWriteInputForPrompt`, `formatReadInputForPrompt`

These functions have no config dependency and no reason to be instance methods.

### Threading through the call chain

`describeToolGate` in `src/handlers/gates/tool.ts`:

```typescript
export function describeToolGate(
  tcc: ToolCallContext,
  check: PermissionCheckResult,
  formatter: ToolPreviewFormatter,
): GateDescriptor {
  const permissionLogContext = formatter.getPermissionLogContext(
    check,
    tcc.input,
    PATH_BEARING_TOOLS,
  );
  // ...
  const askMessage = formatAskPrompt(
    check,
    tcc.agentName ?? undefined,
    tcc.input,
    formatter,
  );
  // ...
}
```

`formatAskPrompt` in `src/permission-prompts.ts`:

```typescript
export function formatAskPrompt(
  result: PermissionCheckResult,
  agentName?: string,
  input?: unknown,
  formatter?: ToolPreviewFormatter,
): string {
  // ... bash and MCP branches unchanged ...
  const inputPreview = formatter
    ? formatter.formatToolInputForPrompt(result.toolName, input)
    : "";
  // ...
}
```

The `formatter` parameter is optional for backward compatibility — `formatAskPrompt` is not called from other entry points today, but keeping it optional avoids a forced change on consumers that don't have a formatter.

`PermissionGateHandler.handleToolCall` in `src/handlers/permission-gate-handler.ts` constructs the formatter once and passes it into the tool gate producer thunk:

```typescript
const formatter = new ToolPreviewFormatter({
  toolInputPreviewMaxLength: TOOL_INPUT_PREVIEW_MAX_LENGTH,
  toolTextSummaryMaxLength: TOOL_TEXT_SUMMARY_MAX_LENGTH,
  toolInputLogPreviewMaxLength: TOOL_INPUT_LOG_PREVIEW_MAX_LENGTH,
});

// Inside the gateProducers array, the last producer:
() => {
  const toolCheck = checkPermission(
    tcc.toolName,
    tcc.input,
    tcc.agentName ?? undefined,
    getSessionRuleset(),
  );
  const toolDescriptor = describeToolGate(tcc, toolCheck, formatter);
  toolDescriptor.preCheck = toolCheck;
  return toolDescriptor;
},
```

When [#266] adds configurable limits, the constructor call changes — the config values replace the defaults.

### Design verification (Tell-Don't-Ask / Law of Demeter)

The formatter is a pure collaborator — it is called from `describeToolGate` to produce formatted strings, and from `formatAskPrompt` to produce input previews.
Neither consumer reaches through the formatter to access its options.
The consumer's call site reads naturally:

```typescript
// tool.ts
const permissionLogContext = formatter.getPermissionLogContext(
  check,
  tcc.input,
  PATH_BEARING_TOOLS,
);
```

The formatter encapsulates its own state (the options) and exposes only the methods that consumers need.
No output arguments, no reverse searches from the original code.

### Edge cases

- `formatAskPrompt` called without a formatter (if a future code path forgets to pass one): the optional parameter defaults to `undefined`, input preview is empty string, prompt still works.
- `sanitizeInlineText` with explicit `maxLength` override: still works because the override parameter bypasses `this.options.toolTextSummaryMaxLength`.
- `getToolInputPreviewForLog` with bash/mcp: returns `undefined` as before — the guard logic is unchanged, just moved to the class method.

## Module-Level Changes

| File                                      | Change                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/tool-preview-formatter.ts`           | **New** — `ToolPreviewFormatter` class + `ToolPreviewFormatterOptions` interface                                                                                                                                                                                            |
| `src/tool-input-preview.ts`               | Remove 7 config-dependent exports (`formatToolInputForPrompt`, `formatJsonInputForPrompt`, `formatSearchInputForPrompt`, `sanitizeInlineText`, `formatGenericToolInputForLog`, `getToolInputPreviewForLog`, `getPermissionLogContext`); keep 8 pure utilities + 3 constants |
| `src/permission-prompts.ts`               | Replace `import { formatToolInputForPrompt }` with `import type { ToolPreviewFormatter }`; add `formatter?: ToolPreviewFormatter` parameter to `formatAskPrompt`                                                                                                            |
| `src/handlers/gates/tool.ts`              | Replace `import { getPermissionLogContext }` with `import type { ToolPreviewFormatter }`; add `formatter: ToolPreviewFormatter` parameter to `describeToolGate`                                                                                                             |
| `src/handlers/permission-gate-handler.ts` | Import `ToolPreviewFormatter` and constants; construct formatter in `handleToolCall` with default values; pass to tool gate producer                                                                                                                                        |
| `test/tool-preview-formatter.test.ts`     | **New** — unit tests for `ToolPreviewFormatter` methods                                                                                                                                                                                                                     |
| `test/tool-input-preview.test.ts`         | Remove imports of the 7 moved functions; remove their test blocks; keep constant and pure-utility tests                                                                                                                                                                     |
| `test/permission-prompts.test.ts`         | Remove `vi.mock("../src/tool-input-preview.js")`; import `ToolPreviewFormatter`; construct real instance or spy; pass as parameter                                                                                                                                          |
| `test/handlers/gates/tool.test.ts`        | Import `ToolPreviewFormatter`; construct a formatter with defaults; pass to `describeToolGate` in each call                                                                                                                                                                 |
| `docs/architecture/architecture.md`       | Update module listing at line ~527: add `tool-preview-formatter.ts`, update `tool-input-preview.ts` description                                                                                                                                                             |

No symbol documented in `.pi/skills/package-pi-permission-system/SKILL.md` is removed — no skill update needed.

No barrel (`src/index.ts`) export changes — the formatter is an internal collaborator, not a public API.

## Test Impact Analysis

1. **New unit tests enabled** (`test/tool-preview-formatter.test.ts`):
   - Constructor stores options correctly.
   - `formatToolInputForPrompt` dispatches tool names correctly (edit/write/read/find/grep/ls/fallback).
   - `formatJsonInputForPrompt` truncates at the configured `toolInputPreviewMaxLength`.
   - `sanitizeInlineText` respects constructor default and explicit override.
   - `formatSearchInputForPrompt` calls `sanitizeInlineText` with config-dependent truncation.
   - `formatGenericToolInputForLog` truncates at `toolInputLogPreviewMaxLength`.
   - `getToolInputPreviewForLog` returns undefined for bash/mcp, path preview for path-bearing tools, JSON preview for others — all with config-dependent truncation.
   - `getPermissionLogContext` returns the correct shape with config-dependent preview.
   These tests were previously impossible without mocking because the constants were module-level.

2. **Tests that become redundant**: The `formatToolInputForPrompt` tests in `tool-input-preview.test.ts` (the `describe("formatToolInputForPrompt")` block) become redundant with the new class-level tests that cover the same dispatch logic.
   They should be removed as part of the extraction to avoid duplication.

3. **Tests that stay as-is**:
   - The constant-value tests in `tool-input-preview.test.ts` (the `describe("constants")` block) stay — the constants remain as default values.
   - The `describeToolGate` integration tests in `tool.test.ts` stay — they exercise the gate descriptor layer that the formatter is threaded through, and pass the formatter as a construction dependency.
   - The `formatAskPrompt` behavioral tests in `permission-prompts.test.ts` stay — they exercise the prompt message logic that is unchanged.
   - The end-to-end handler tests in `tool-call.test.ts` and `tool-call-events.test.ts` stay — they exercise the full pipeline with the formatter injected.

## TDD Order

1. `test:` Add `ToolPreviewFormatter` tests covering all 7 config-dependent methods.
   New file `test/tool-preview-formatter.test.ts` with constructor options, dispatch logic, config-dependent truncation at each of the three limits, and log formatting.
   Commit: `test: add ToolPreviewFormatter tests`

2. `refactor:` Create `src/tool-preview-formatter.ts` with the class; remove the 7 config-dependent exports from `tool-input-preview.ts`.
   Update `test/tool-input-preview.test.ts` — remove `formatToolInputForPrompt` describe block and the 6 other moved-function imports/test blocks; keep constant and pure-utility tests.
   The class is not yet used by any consumer — this step is purely the extraction.
   Commit: `refactor: extract ToolPreviewFormatter class from tool-input-preview`

3. `test:` Update `test/handlers/gates/tool.test.ts` — import `ToolPreviewFormatter`, construct with defaults, pass as third argument to `describeToolGate`.
   The test file is the first consumer; this step proves the type signature works before modifying production code.
   Commit: `test: update tool gate tests with formatter parameter`

4. `refactor:` Thread the formatter through the gate descriptor chain.
   - `src/handlers/gates/tool.ts`: add `formatter` parameter to `describeToolGate`,
     replace `getPermissionLogContext(...)` import with `formatter.getPermissionLogContext(...)`,
     pass formatter to `formatAskPrompt`.
   - `src/permission-prompts.ts`: add `formatter?: ToolPreviewFormatter` parameter
     to `formatAskPrompt`, use `formatter.formatToolInputForPrompt(...)` when present.
   - `src/handlers/permission-gate-handler.ts`: import `ToolPreviewFormatter` and
     the three constants; construct the formatter inside `handleToolCall` with
     default values; pass it to the tool gate producer thunk.

   All existing handler and gate tests remain green.
   Commit: `refactor: thread ToolPreviewFormatter through gate descriptor chain`

5. `test:` Update `test/permission-prompts.test.ts` — remove `vi.mock("../src/tool-input-preview.js")` and the `import { formatToolInputForPrompt }` / `vi.mocked(formatToolInputForPrompt)` lines.
   Import `ToolPreviewFormatter`, construct a real instance with defaults, and pass it as the 4th argument to `formatAskPrompt`.
   The mock-based assertions (`mockedFormatToolInput.mockReturnValue` / `toHaveBeenCalledWith`) become direct assertions on the formatter instance or on the resulting string.
   Commit: `test: replace vi.mock with direct formatter injection in permission-prompts tests`

6. `docs:` Update `docs/architecture/architecture.md` — add `tool-preview-formatter.ts` to the module listing under `src/`; update `tool-input-preview.ts` description from "Loggable context from tool inputs" to "Pure tool-input text utilities (truncation, counting, path extraction) + default constants".
   Mark Phase 1 Steps 1 and 2 as completed in the roadmap steps section.
   Commit: `docs: mark Phase 1 steps 1-2 complete in permission-system architecture`

Steps 3 and 4 follow the lift-and-shift pattern: introduce the class (step 2), then consume it in tests (step 3), then wire it in production (step 4).
This keeps each commit individually reviewable and the type checker satisfied at each boundary.

## Risks and Mitigations

- **Risk:** Forgetting to thread the formatter to all call sites of the moved functions.
  Mitigation: Move the 7 exports from `tool-input-preview.ts`, so TypeScript immediately flags any remaining import at compile time.
  Only two modules import moved functions: `tool.ts` and `permission-prompts.ts`, both updated in step 4.
- **Risk:** Backward compatibility — a third-party extension imports these functions.
  Mitigation: These are internal symbols with no barrel export from `src/index.ts`.
  No external consumer exists.
- **Risk:** `formatAskPrompt` called without a formatter produces different behavior (empty input preview instead of the previously guaranteed preview).
  Mitigation: `formatAskPrompt` is only called from `describeToolGate` (updated) and from tests (updated).
  The optional parameter ensures TypeScript does not force a change on hypothetical future callers, and the empty-string fallback is the safe default (no preview is better than a wrong preview).
- **Risk:** Module-level `vi.mock` removal in `permission-prompts.test.ts` accidentally changes test semantics.
  Mitigation: The mock currently returns `"mocked preview"` unconditionally.
  The injected real formatter will return real previews — tests that check the string content need adjustment to match actual formatting output rather than the constant mock value.
  This is surfaced explicitly in step 5's scope.

## Open Questions

- Whether `TOOL_INPUT_LOG_PREVIEW_MAX_LENGTH` should also become configurable in [#266].
  It is included in `ToolPreviewFormatterOptions` for consistency since the log-formatting methods that use it live on the class.
  If [#266] decides not to expose it in `PermissionSystemExtensionConfig`, the field defaults to 1000 and remains internal.
- Whether the constructor should also be used as a factory for a future
  extension seam (`register()` for custom tool formatters) — deferred to [#283].

[#266]: https://github.com/gotgenes/pi-packages/issues/266
[#283]: https://github.com/gotgenes/pi-packages/issues/283
[#285]: https://github.com/gotgenes/pi-packages/issues/285
