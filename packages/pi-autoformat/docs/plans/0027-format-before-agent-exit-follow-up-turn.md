---
issue: 27
issue_title: "Format before agent exit and give the agent a follow-up turn"
---

# Format before agent exit and give the agent a follow-up turn

## Problem Statement

Autoformatting currently runs at `agent_end`, after the agent has fully exited its turn loop.
This causes two problems:

1. The agent discovers dirty state (formatting diffs) it did not produce on its next invocation, leading to confusion or unnecessary corrective actions.
2. In commit-and-push workflows like `/ship-issue`, the agent commits its work before formatting runs, so the pushed commit contains unformatted code.

Both stem from the agent never getting a chance to observe or react to formatting changes.

Additionally, formatter *failures* (syntax errors, missing config) are currently reported only to the human via `ui.notify`.
The agent cannot see or fix these issues, even though it is often best positioned to do so.

Finally, the `formatMode` config field offers three timing modes (`"tool"`, `"prompt"`, `"session"`), but only `"prompt"` is meaningfully useful:

- `"tool"` formats after every tool call — nearly identical to per-turn (93% of turns have one tool call) and actively harmful in multi-tool turns where formatting between edits can corrupt subsequent `oldText` matches.
- `"session"` formats at session shutdown, when the agent is completely gone and cannot react.

Since nobody outside the project uses this extension yet, we can make a clean break.

## Goals

1. Remove the `formatMode` config field entirely.
   The runtime always uses prompt-end timing (the previous `"prompt"` behavior).
   The loader tolerates the legacy key, emits a config issue, and discards the value.
2. After formatting runs at `agent_end`, give the agent one follow-up turn via `pi.sendMessage({ triggerTurn: true })` so it can see which files changed and react.
3. Include formatter failure details (stderr, exit code) in the follow-up message so the agent can attempt to fix issues.
4. Prevent infinite loops: at most one follow-up per user prompt.
5. Expose the follow-up behavior as a new boolean config field (`notifyAgent`), defaulting to `false`.
6. Skip the follow-up turn when the flush produced no groups (nothing to report).

## Non-Goals

1. Byte-level diffing to detect whether the formatter actually changed file content.
   The initial implementation triggers the follow-up whenever the flush produces non-empty groups.
2. Customizing the follow-up message template via config.
3. Making `notifyAgent: true` the default (defer until real-world feedback).

## Background

### Relevant modules

| Module                              | Role                                                                                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/extension.ts`                  | Extension entrypoint. Registers lifecycle handlers (`session_start`, `tool_result`, `agent_end`, `session_shutdown`). Owns `queueFlush()` and result reporting. Has `formatMode` branching in `tool_result` and `agent_end` handlers. |
| `src/formatter-config.ts`           | Defines `FormatMode` type, `AutoformatConfig`, `UserFormatterConfig`, defaults, `createFormatterConfig()`.                                                                                                                            |
| `src/config-loader.ts`              | Loads/merges global+project config, validates `formatMode` values, produces `LoadConfigResult`.                                                                                                                                       |
| `src/prompt-autoformatter.ts`       | `PromptAutoformatter` class. Tracks touched files, runs formatter chains, returns `PromptAutoformatterResult`.                                                                                                                        |
| `src/formatter-executor.ts`         | `BatchRun` type — includes `stdout`, `stderr`, `exitCode` for each formatter invocation.                                                                                                                                              |
| `schemas/pi-autoformat.schema.json` | JSON Schema for config validation. Includes `formatMode` enum.                                                                                                                                                                        |
| `docs/configuration.md`             | User-facing config documentation. Documents `formatMode` and its three values.                                                                                                                                                        |
| `test/extension.test.ts`            | Extension lifecycle tests with `TestPi` harness. Tests for `"tool"`, `"prompt"`, `"session"` modes.                                                                                                                                   |
| `test/config-loader.test.ts`        | Config validation and merge tests.                                                                                                                                                                                                    |

### Pi extension API surface

```typescript
// Current flush trigger
pi.on("agent_end", handler)

// New — triggers a follow-up agent turn
pi.sendMessage<T>(
  message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
  options?: {
    triggerTurn?: boolean;
    deliverAs?: "steer" | "followUp" | "nextTurn";
  }
): void;
```

`pi.sendMessage` is on the `ExtensionAPI` object (the `pi` closure variable), not on the per-event `ExtensionContext`.
No new wiring is needed.

### Session data insights

Analysis of ~1,900 assistant turns:

- 93.4% contain exactly one tool call (sequential across turns, not batched within).
- Average mutation-turn streak: 4.6 turns.
- `formatMode: "tool"` would fire nearly as often as per-turn, with negligible batching benefit and real risk of corrupting multi-tool edits.

## Design Overview

### Removing `formatMode`

Per AGENTS.md deprecation policy: accept the legacy key, emit a single non-fatal config issue describing the removal, and discard the value.

Concrete changes:

1. Drop `FormatMode` type from `src/formatter-config.ts`.
2. Drop `formatMode` from `AutoformatConfig`, `UserFormatterConfig`, `DEFAULT_FORMATTER_CONFIG`, and `createFormatterConfig()`.
3. Drop `formatMode` from `schemas/pi-autoformat.schema.json`.
4. Drop `formatMode` from `docs/configuration.md`.
5. In `src/config-loader.ts`: when `formatMode` key is present in user config, emit a config issue (`formatMode has been removed; prompt-end formatting is now the only mode.`) and discard.
6. In `src/extension.ts`: remove all `formatMode` branching.
   The `tool_result` handler no longer conditionally flushes.
   The `agent_end` handler always flushes.
   The `session_shutdown` handler no longer conditionally flushes (it still cleans up state).
7. Remove tests for `"tool"` and `"session"` mode behaviors; add a test for the legacy-key config issue.

### Sequence with `notifyAgent: true`

```text
Turn N:   agent makes final edits
Turn N+1: agent says "Done!" → agent_end fires
            ↓
          flush formatter (batched, always prompt-end)
            ↓
          flush produced groups?
            ├─ no  → done, no follow-up
            └─ yes → compose message (successes + failures)
                     pi.sendMessage({ customType: "autoformat-notify", ... },
                                    { triggerTurn: true })
            ↓
Turn N+2: agent sees notification, can react (commit, fix failures, acknowledge)
            ↓
          agent_end fires again
            ↓
          flush (any new touched files from Turn N+2?)
            ├─ groups → format them, but do NOT send another follow-up (loop guard)
            └─ empty  → done
```

### Loop guard

A `followUpPending` flag on `SessionState` prevents unbounded re-triggering:

1. On `agent_end` entry: read `followUpPending` into a local, then set it to `false`.
2. After flush: if result has groups AND the locally-read value was `false`, send the message and set `followUpPending = true`.
3. Effect: first `agent_end` → format + notify.
   Second `agent_end` → format if needed, no notify.

The flag resets naturally because step 1 always clears it on entry.

### Follow-up message content

The message body combines successes and failures into one agent-readable block:

```text
[autoformat] Formatted 3 file(s): src/foo.ts, src/bar.ts, README.md

Failures:
  prettier (exit 2) on src/broken.ts:
    stderr: SyntaxError: Unexpected token at line 42
```

Specifics:

- File list truncated at 10, with "… and N more" suffix.
- Failure details include `stderr` (trimmed by the existing `formatterOutput` config limits).
- `stdout` included only when `formatterOutput.onFailure` is `"both"`.
- When all runs succeeded, the failures section is omitted.
- When all runs failed (no successes), the success line is omitted.
- `customType` is `"autoformat-notify"` for identification in session logs and potential custom rendering.

### Config shape

```typescript
// UserFormatterConfig (optional)
notifyAgent?: boolean;

// AutoformatConfig (resolved)
notifyAgent: boolean;  // default: false
```

### `TestPi` harness changes

Add `sendMessage` capture to `TestPi`:

```typescript
readonly sentMessages: Array<{
  message: { customType?: string; content?: string };
  options?: { triggerTurn?: boolean };
}> = [];

readonly sendMessage = ((message: unknown, options?: unknown) => {
  this.sentMessages.push({ message, options });
}) as ExtensionAPI["sendMessage"];
```

## Module-Level Changes

### `src/formatter-config.ts`

1. Remove `FormatMode` type.
2. Remove `formatMode` from `UserFormatterConfig`, `AutoformatConfig`, `DEFAULT_FORMATTER_CONFIG`.
3. Remove `formatMode` from `createFormatterConfig()`.
4. Add `notifyAgent?: boolean` to `UserFormatterConfig`.
5. Add `notifyAgent: boolean` to `AutoformatConfig` (default: `false`).
6. Wire `notifyAgent` through `createFormatterConfig()`.

### `src/config-loader.ts`

1. Remove `validateFormatMode()`.
2. When `formatMode` key is present, emit a config issue and discard.
3. Add `notifyAgent` boolean validation.
4. Wire `notifyAgent` through `mergeUserConfigs()`.

### `schemas/pi-autoformat.schema.json`

1. Remove `formatMode` property.
2. Add `notifyAgent` boolean property.

### `src/extension.ts`

1. Remove `formatMode` branching from `tool_result` handler (no more conditional flush).
2. Remove `formatMode !== "prompt"` guard from `agent_end` handler (always flush).
3. Remove `formatMode === "session"` conditional from `session_shutdown` handler.
4. Add `followUpPending: boolean` to `SessionState`.
5. Extract `buildNotifyMessageContent(result, config): string | undefined` helper.
6. In `agent_end` handler: after flush, conditionally call `pi.sendMessage`.

### `docs/configuration.md`

1. Remove `formatMode` section.
2. Add `notifyAgent` section.

### `README.md`

1. Remove any `formatMode` references.
2. Add `notifyAgent` mention.

### `test/extension.test.ts`

1. Remove tests for `"tool"` mode and `"session"` mode behavior.
2. Remove `formatMode` parameter from `createLoadResult()` helper.
3. Extend `TestPi` with `sendMessage` capture.
4. Add follow-up turn tests.

### `test/config-loader.test.ts`

1. Remove `formatMode` validation tests (valid values, invalid values).
2. Add test for legacy `formatMode` key producing a config issue.
3. Add `notifyAgent` validation tests.

## TDD Order

### 1. Remove `formatMode` from config types and defaults

- **Test surface:** `test/formatter-config.test.ts` or `test/config-loader.test.ts`.
- **Covers:** `FormatMode` type removed; `createFormatterConfig()` no longer accepts or produces `formatMode`; existing tests that reference `formatMode` are updated or removed.
- **Commit:** `feat!: remove formatMode config field (#27)`

### 2. Legacy `formatMode` key tolerance in config loader

- **Test surface:** `test/config-loader.test.ts`.
- **Covers:** Config containing `formatMode: "prompt"` (or any value) is accepted without error but emits a config issue.
  The value is discarded.
- **Commit:** `feat: emit config issue for legacy formatMode key (#27)`

### 3. Remove `formatMode` from JSON schema

- **Test surface:** `test/schema.test.ts`.
- **Covers:** Schema no longer includes `formatMode`.
  Configs with `formatMode` pass validation (via `additionalProperties` tolerance or explicit handling).
- **Commit:** `feat!: remove formatMode from config schema (#27)`

### 4. Remove `formatMode` branching from extension runtime

- **Test surface:** `test/extension.test.ts`.
- **Covers:** Remove `"tool"` and `"session"` mode tests.
  `tool_result` handler no longer flushes.
  `agent_end` always flushes.
  `session_shutdown` no longer conditionally flushes.
  Update `createLoadResult()` helper to drop the `formatMode` parameter.
- **Commit:** `feat!: always use prompt-end formatting (#27)`

### 5. `notifyAgent` config field — types, defaults, schema, loader

- **Test surface:** `test/config-loader.test.ts`, `test/schema.test.ts`.
- **Covers:** Defaults to `false`; user-supplied `true` preserved; schema accepts boolean; non-boolean rejected.
- **Commit:** `feat: add notifyAgent config field (#27)`

### 6. Notification message builder

- **Test surface:** `test/extension.test.ts` (or extracted `test/notify-message.test.ts`).
- **Covers:** Message text with 1 file, 3 files, 11 files (truncation at 10), 0 groups (returns `undefined`).
  Message with mixed success/failure including stderr.
  Message with all-failures (no success line).
- **Commit:** `feat: add buildNotifyMessageContent helper (#27)`

### 7. `TestPi` harness — add `sendMessage` capture

- **Test surface:** `test/extension.test.ts`.
- **Covers:** Refactor only — `TestPi` records `sendMessage` calls.
  No behavioral change to existing tests.
- **Commit:** `test: extend TestPi with sendMessage capture (#27)`

### 8. Follow-up turn on successful flush

- **Test surface:** `test/extension.test.ts`.
- **Covers:** `notifyAgent: true` + flush with successful groups → `pi.sendMessage` called once with `{ triggerTurn: true }`, `customType: "autoformat-notify"`, and message containing file names.
- **Commit:** `feat: send follow-up turn after formatting (#27)`

### 9. Follow-up includes failure details

- **Test surface:** `test/extension.test.ts`.
- **Covers:** Flush with mixed success/failure → follow-up message includes stderr and exit code for failed runs.
- **Commit:** `feat: include formatter failures in follow-up message (#27)`

### 10. No follow-up on empty flush

- **Test surface:** `test/extension.test.ts`.
- **Covers:** Empty flush → `sendMessage` not called.
- **Commit:** `test: no follow-up on empty flush (#27)`

### 11. No follow-up when `notifyAgent` is `false`

- **Test surface:** `test/extension.test.ts`.
- **Covers:** Default config → `sendMessage` not called even with successful groups.
- **Commit:** `test: notifyAgent false suppresses follow-up (#27)`

### 12. Loop guard — at most one follow-up per user prompt

- **Test surface:** `test/extension.test.ts`.
- **Covers:** Simulate two consecutive `agent_end` events.
  `sendMessage` called exactly once.
- **Commit:** `test: follow-up turn loop guard (#27)`

### 13. Follow-up resets across user prompts

- **Test surface:** `test/extension.test.ts`.
- **Covers:** After a full cycle (agent_end → follow-up → agent_end), a new agent_end with fresh tool results triggers a new follow-up.
- **Commit:** `test: follow-up resets across prompts (#27)`

### 14. Documentation

- **Test surface:** Manual review.
- **Covers:** `docs/configuration.md` (remove `formatMode`, add `notifyAgent`), `README.md`, schema description.
- **Commit:** `docs: document notifyAgent and remove formatMode docs (#27)`

## Risks and Mitigations

### Infinite follow-up loop

The `followUpPending` flag ensures at most one follow-up per user prompt.
Even if the follow-up turn triggers new edits, the second `agent_end` formats them but does not re-trigger.

### `sendMessage` in non-interactive mode

`pi.sendMessage` is on `ExtensionAPI`, which is always present.
In RPC/print mode, `triggerTurn` may be a no-op.
The extension sends the message regardless and lets Pi decide delivery.
If problematic, a follow-up can add a `ctx.hasUI` guard.

### Extra token cost

The follow-up turn requires one LLM call.
Usually a short response.
The feature is opt-in (`notifyAgent: false`), so cost-sensitive users are unaffected.

### Agent makes new edits during follow-up

Expected and handled: the second `agent_end` runs the formatter on new touched files.
The loop guard prevents a third follow-up.

## Open Questions

1. Should `notifyAgent` eventually default to `true`?
   Defer until real-world feedback confirms reliability and acceptable token cost.
2. Should the follow-up turn be skipped when formatting produced no byte-level changes?
   Defer — requires reading files before/after, adding I/O overhead.
3. Should the follow-up message include a diff summary (lines changed)?
   Defer — file names and failure details are sufficient for the agent to decide whether to act.
