---
issue: 31
issue_title: "Pre-commit flush: format touched files before agent-initiated git commits"
---

# Turn-end flush with change detection

## Problem Statement

pi-autoformat runs its formatter flush at `agent_end`, which fires after the agent's full turn loop completes.
In TDD and commit-heavy workflows, the agent writes files in one turn and commits them in a later turn.
Because formatting has not yet run, pre-commit hooks (e.g. Biome via prek) reject the commit.
The agent then has to run the formatter manually, re-stage, and retry — wasting tokens and time.

Observed in `pi-permission-system`: 3 of ~10 commits required retry after Biome rejection.

The typical pattern across 4,925 analysed turns:

```text
Turn N:   edit src/foo.ts        (single tool call)
Turn N+1: edit src/bar.ts        (single tool call)
Turn N+2: bash("git add ... \n git commit -m '...'")
```

93.4% of turns contain exactly one tool call.
Writes and commits always occur in separate turns.
Zero instances of same-file edits within a single turn were found across all session data.

## Goals

1. Move the primary formatter flush from `agent_end` to `turn_end` so files are formatted between turns — before any subsequent commit.
2. Detect whether formatting actually changed file content (content hashing before/after) and only notify the agent when changes occurred or the formatter failed.
3. Notify the agent inline via a steering message (`pi.sendMessage` during streaming) so it sees the notification before its next LLM call.
4. Remove the `notifyAgent` config field; turn-end steering replaces the `agent_end` follow-up turn mechanism.
5. Keep `agent_end` as a safety-net flush for any files not yet formatted (e.g. files added via EventBus without a turn loop).

## Non-Goals

1. Re-staging formatted files in the git index — session data shows `git add` and `git commit` always share the same bash command, run in a turn after formatting has already occurred.
2. Command detection for `git commit` at `tool_call` — the turn-end flush makes this unnecessary; the intra-turn write+commit pattern has never occurred in session data.
3. Exposing an explicit flush tool or slash command for agents.
4. Byte-level diffs or line-change summaries in the notification — file names and failure details are sufficient.

## Background

### Session data analysis

| Metric                                     | Count | %     |
| ------------------------------------------ | ----- | ----- |
| Total turns with tools                     | 4,925 | 100%  |
| Single-tool turns                          | 4,515 | 91.7% |
| Multi-tool turns                           | 410   | 8.3%  |
| Same-file edits in same turn               | 0     | 0%    |
| Read-after-write to same file in same turn | 0     | 0%    |
| Write + git commit in same turn            | 0     | 0%    |

The original argument against per-turn formatting was that it could corrupt `Edit` tool `oldText` matching or `Read` tool `offset`/`limit` when a formatter changes a file between two tool calls targeting the same file within a turn.
The session data shows this scenario has never occurred.

### Pi agent loop lifecycle (from source)

```text
OUTER LOOP:
  INNER LOOP (while hasMoreToolCalls || pendingMessages):
    turn_start
      process pendingMessages (steering messages from previous turn)
      LLM generates response
      execute tool calls sequentially:
        beforeToolCall → tool runs → afterToolCall (tool_result)
    turn_end  ← FLUSH HERE, send steering message if changes
      shouldStopAfterTurn? (not used by coding-agent)
      pendingMessages = getSteeringMessages()  ← PICKS UP OUR MESSAGE
  END INNER LOOP

  followUpMessages = getFollowUpMessages()
  if followUp → continue outer loop
  else → break
agent_end  ← SAFETY-NET FLUSH
```

Key properties:

- `turn_end` is fully `await`ed before the next `turn_start`.
- During the turn loop, `isStreaming` is `true`; `pi.sendMessage()` defaults to `agent.steer()`.
- Steering messages are consumed as `pendingMessages` at the start of the next turn, injected before the LLM call.
- When the agent's final turn has no tool calls (text-only), the queue is empty, so the turn-end flush is a no-op and no steering message is sent.

### Relevant modules

| Module                              | Role                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/extension.ts`                  | Extension entrypoint. Lifecycle handlers for `session_start`, `tool_call`, `tool_result`, `agent_end`, `session_shutdown`. Owns `queueFlush()` and reporting. |
| `src/prompt-autoformatter.ts`       | `PromptAutoformatter` class. `flushPrompt()` drains the touched-file queue and runs formatter chains.                                                         |
| `src/formatter-executor.ts`         | `BatchRun` type with `stdout`, `stderr`, `exitCode`. Runs formatter commands.                                                                                 |
| `src/formatter-config.ts`           | `AutoformatConfig` with `notifyAgent` boolean (to be removed). `UserFormatterConfig`.                                                                         |
| `src/config-loader.ts`              | Loads/merges config, validates fields.                                                                                                                        |
| `schemas/pi-autoformat.schema.json` | JSON Schema for config validation.                                                                                                                            |
| `docs/configuration.md`             | User-facing config documentation.                                                                                                                             |
| `test/extension.test.ts`            | Extension lifecycle tests with `TestPi` harness.                                                                                                              |

### Relationship to plan 0027

Plan 0027 introduced `notifyAgent` (default `false`), which sends a follow-up turn at `agent_end` via `pi.sendMessage({ triggerTurn: true })`.
This plan replaces that mechanism: formatting moves to `turn_end` with inline steering, making the `agent_end` follow-up unnecessary.
The `notifyAgent` field is removed per the deprecation policy in AGENTS.md.

## Design Overview

### Flush at `turn_end`

Register a new `turn_end` handler in `src/extension.ts`.
On each `turn_end` event, call `queueFlush(ctx)`.
The queue contains files recorded during the turn's `tool_result` events.
After the flush, the queue is empty; the next turn starts with clean files on disk.

### Content-change detection

Wrap the formatter execution with before/after content hashing to determine which files were actually changed.

Add a `changedFiles` field to `ChainGroupResult`:

```typescript
export type ChainGroupResult = {
  chain: ChainStep[];
  files: string[];
  runs: BatchRun[];
  changedFiles: string[];  // files whose content changed after formatting
};
```

In `flushPrompt()`, before running each chain group's formatter:

1. Read and hash (SHA-256) each input file.
2. Run the formatter.
3. Re-read and hash each file.
4. Populate `changedFiles` with files whose hash differs.

Files that no longer exist after formatting (deleted by the formatter — unusual but possible) are excluded from `changedFiles`.

The hashing cost is 2× reads per formatted file.
These files are small source files already in the OS page cache (just written by the agent moments ago), so the overhead is negligible.

### Steering notification

After the flush, if any files changed or any run failed, compose a steering message and call `pi.sendMessage()`.
During the turn loop, `isStreaming` is `true`, so `sendMessage` defaults to `agent.steer()`.
The message is consumed as `pendingMessages` at the start of the next turn.

Message format:

```text
[autoformat] Formatted 2 file(s): src/foo.ts, src/bar.ts
```

When there are failures:

```text
[autoformat] Formatted 1 file(s): src/foo.ts

Failures:
  biome (exit 1) on src/broken.ts:
    SyntaxError: Unexpected token at line 42
```

When only failures (no successful changes):

```text
[autoformat] Failures:
  biome (exit 1) on src/broken.ts:
    SyntaxError: Unexpected token at line 42
```

File list truncated at 10 with "… and N more" suffix.
Failure details use the existing `formatterOutput` config limits.

No message is sent when:

- The flush processed no files (empty queue).
- The formatter ran but no files changed and no runs failed.

### Removing `notifyAgent`

Per AGENTS.md deprecation policy:

- Remove `notifyAgent` from `AutoformatConfig`, `UserFormatterConfig`, `createFormatterConfig()`.
- Remove from `schemas/pi-autoformat.schema.json` and `docs/configuration.md`.
- In `src/config-loader.ts`: when `notifyAgent` key is present, emit a config issue (`notifyAgent has been removed; the extension now notifies via steering messages at turn end.`) and discard.
- Remove the `agent_end` follow-up turn logic (`followUpPending`, `buildNotifyMessageContent`, `pi.sendMessage({ triggerTurn: true })`).
- Remove `followUpPending` from `SessionState`.

### `agent_end` safety net

The `agent_end` handler still calls `queueFlush(ctx)` as a safety net for files added via EventBus or other non-turn paths.
It no longer sends follow-up turns.
In the normal case, `turn_end` has already drained the queue, so the `agent_end` flush is a no-op.

### `TestPi` harness changes

Add `turn_end` to the `EventName` type.
Keep `sendMessage` capture for steering-message assertions.

## Module-Level Changes

### `src/prompt-autoformatter.ts`

1. Add `changedFiles: string[]` to `ChainGroupResult`.
2. In `flushPrompt()`, hash file contents before and after each chain group execution.
3. Populate `changedFiles` by comparing hashes.

### `src/formatter-config.ts`

1. Remove `notifyAgent` from `UserFormatterConfig` and `AutoformatConfig`.
2. Remove from `DEFAULT_FORMATTER_CONFIG`.
3. Remove from `createFormatterConfig()`.

### `src/config-loader.ts`

1. When `notifyAgent` key is present in user config, emit a config issue and discard.
2. Remove `notifyAgent` validation logic.

### `schemas/pi-autoformat.schema.json`

1. Remove `notifyAgent` property.

### `src/extension.ts`

1. Add a `turn_end` handler that calls `queueFlush(ctx)` and, if the result has changes or failures, sends a steering message via `pi.sendMessage()`.
2. Extract `buildSteeringMessageContent(result): string | undefined` helper (replaces `buildNotifyMessageContent`).
3. Simplify `agent_end` handler: remove `followUpPending` logic, keep safety-net flush only.
4. Remove `followUpPending` from `SessionState`.
5. Remove `buildNotifyMessageContent` (replaced by `buildSteeringMessageContent`).
6. Update `queueFlush` return type if needed to propagate the result for steering decisions.

### `docs/configuration.md`

1. Remove `notifyAgent` section.
2. Add a section explaining turn-end formatting and steering notifications.

### `README.md`

1. Remove `notifyAgent` references.
2. Update description of formatting timing.

### `test/extension.test.ts`

1. Add `turn_end` to `EventName` type in `TestPi`.
2. Add tests for turn-end flush behavior.
3. Add tests for steering message on file changes.
4. Add tests for no steering message when no changes.
5. Add tests for steering message on formatter failure.
6. Remove `notifyAgent`-specific tests (follow-up turn, loop guard, etc.).
7. Update `createLoadResult` helper to drop `notifyAgent`.

### `test/prompt-autoformatter.test.ts`

1. Add tests for `changedFiles` population in `ChainGroupResult`.
2. Test that unchanged files are not in `changedFiles`.
3. Test that failed runs do not populate `changedFiles` (or populate correctly depending on behavior).

### `test/config-loader.test.ts`

1. Add test for legacy `notifyAgent` key producing a config issue.
2. Remove `notifyAgent` validation tests.

## TDD Order

### 1. Content-change detection in `flushPrompt`

- **Test surface:** `test/prompt-autoformatter.test.ts`.
- **Covers:** `changedFiles` populated when formatter changes file content.
  Empty when formatter is a no-op.
  Files that don't exist after formatting are excluded.
- **Commit:** `feat: detect content changes in flushPrompt (#31)`

### 2. Remove `notifyAgent` from config types and defaults

- **Test surface:** `test/formatter-config.test.ts`, `test/config-loader.test.ts`.
- **Covers:** `notifyAgent` removed from types; `createFormatterConfig()` no longer accepts it.
  Legacy key in config emits a config issue and is discarded.
- **Commit:** `feat!: remove notifyAgent config field (#31)`

### 3. Remove `notifyAgent` from JSON schema and docs

- **Test surface:** `test/schema.test.ts`, manual review.
- **Covers:** Schema no longer includes `notifyAgent`.
  Docs updated.
- **Commit:** `feat!: remove notifyAgent from schema and docs (#31)`

### 4. Steering message builder

- **Test surface:** `test/extension.test.ts`.
- **Covers:** Message with 1 changed file, 3 changed files, 11 files (truncation).
  Message with failures.
  Message with mixed changes + failures.
  Returns `undefined` when no changes and no failures.
- **Commit:** `feat: add buildSteeringMessageContent helper (#31)`

### 5. Turn-end flush handler

- **Test surface:** `test/extension.test.ts`.
- **Covers:** `turn_end` event triggers flush.
  Files recorded in `tool_result` are formatted at `turn_end`.
  Queue is empty after flush.
- **Commit:** `feat: flush formatters at turn_end (#31)`

### 6. Steering notification on change

- **Test surface:** `test/extension.test.ts`.
- **Covers:** When flush changes files, `pi.sendMessage` is called with steering content.
  When flush is a no-op (no changes, no failures), no message is sent.
- **Commit:** `feat: send steering notification after turn-end formatting (#31)`

### 7. Steering notification on failure

- **Test surface:** `test/extension.test.ts`.
- **Covers:** When a formatter run fails, steering message includes failure details (stderr, exit code).
- **Commit:** `feat: include failure details in steering notification (#31)`

### 8. Remove `agent_end` follow-up turn logic

- **Test surface:** `test/extension.test.ts`.
- **Covers:** `agent_end` handler no longer calls `pi.sendMessage`.
  `followUpPending` removed from `SessionState`.
  `agent_end` still calls safety-net `queueFlush`.
- **Commit:** `feat!: replace agent_end follow-up with turn-end steering (#31)`

### 9. Agent-end safety-net flush

- **Test surface:** `test/extension.test.ts`.
- **Covers:** Files added via EventBus (no turn loop) are formatted at `agent_end`.
  Files already flushed at `turn_end` are not re-formatted at `agent_end`.
- **Commit:** `test: agent_end safety-net flush (#31)`

### 10. Documentation

- **Test surface:** Manual review.
- **Covers:** `docs/configuration.md` updated.
  `README.md` updated.
- **Commit:** `docs: document turn-end formatting and steering notifications (#31)`

## Risks and Mitigations

### Formatter latency between turns

Formatting at `turn_end` adds latency between turns — the agent waits for the formatter before its next LLM call.
Mitigation: most turns have 1-3 touched files; formatter runs are typically sub-second.
The existing `commandTimeoutMs` config prevents hangs.

### Steering message noise

Even with change detection, active editing sessions may produce frequent "Formatted X" messages.
Mitigation: messages are only sent when content actually changed or a formatter failed.
During long edit streaks where the agent writes already-formatted code, no messages are sent.

### File I/O from content hashing

Reading files before and after formatting doubles the I/O per formatted file.
Mitigation: files are small source files already in the OS page cache.
The hash computation (SHA-256) is negligible for typical file sizes.

### Breaking change: `notifyAgent` removal

Users who set `notifyAgent: true` will see a config issue.
Mitigation: the replacement (turn-end steering) provides strictly better behavior — inline notification during the turn rather than a follow-up turn after the agent finishes.
The deprecation policy (accept, warn, discard) ensures no hard failure.

### `turn_end` not firing for non-turn paths

Files added via EventBus or `session_shutdown` never pass through `turn_end`.
Mitigation: `agent_end` and `session_shutdown` safety-net flushes handle these paths.

## Open Questions

1. Should the steering message include which formatter ran (e.g. "biome formatted src/foo.ts") or just the file list?
   Start with the file list; add formatter names if users find it useful.

2. Should there be a config to disable turn-end formatting entirely (revert to agent-end-only)?
   Defer until someone needs it.
   If needed, the implementation can gate the `turn_end` flush behind a boolean.
