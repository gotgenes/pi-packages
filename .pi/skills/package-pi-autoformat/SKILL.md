---
name: package-pi-autoformat
description: |
  Package-specific context for @gotgenes/pi-autoformat.
  Load when working on code, tests, or docs in packages/pi-autoformat/.
---

# pi-autoformat

Pi extension that auto-formats files after agent edits so formatting does not fail late at commit time.

Read `docs/plans/` before making architectural changes.

## Implementation Priorities

- Prefer prompt-end formatting over immediate per-tool formatting unless the task explicitly requires otherwise.
- Favor repository-configured formatter commands over hardcoded formatter behavior.
- Prefer extension-owned config files over Pi `settings.json` keys for package-specific behavior.
- Format only files touched by the agent, not the whole repository.
- Make formatter failures visible, but do not block the original file edit by default.
- Trust formatters to discover their own project configs (most walk up the directory tree natively).
  Do not reimplement formatter-side config resolution inside this extension.
- Treat any declared config field not read by the dispatcher as a maintenance trap.
  Remove it or document its purpose.

## Configuration

- Use extension-owned config files:
  - global: `~/.pi/agent/extensions/pi-autoformat/config.json` (respects `PI_CODING_AGENT_DIR`, resolved via the SDK's `getAgentDir()` at the extension boundary)
  - project: `.pi/extensions/pi-autoformat/config.json`
- Project config overrides global config.
- Do not move package configuration into Pi `settings.json` without explicit discussion.
- Keep `schemas/pi-autoformat.schema.json`, `docs/configuration.md`, `README.md`, and the TypeScript config loader aligned.
- When removing a previously accepted config field, keep the loader tolerant: accept the legacy key, emit a single non-fatal config issue per occurrence describing the deprecation, and discard the value.

## Upstream assumptions

The `/upstream-impact` watchlist for this package; the `upstream-watch` skill defines the impact classes.
Paths are relative to the Pi checkout.

| Our assumption                                                                                                                                          | Upstream file                                                                                                                                                                                                                                                    | Breaks as                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `tool_result` fires for the built-in `write` and `edit` with `event.input.path` a string, including calls nested through `ctx.executeTool()` (codemode) | `packages/coding-agent/src/core/tools/write.ts`, `packages/coding-agent/src/core/tools/edit.ts` (schemas); `packages/coding-agent/src/core/agent-session.ts` (`_afterToolCall`, `_executeNestedToolCall`); `packages/coding-agent/src/core/nested-tool-calls.ts` | Behavioral-silent: a renamed field makes `writeOrEditHandler` match nothing, and the untyped `event.input` hides it from `tsc` |
| `write`, `edit`, and `bash` are the file-mutating built-ins                                                                                             | `packages/coding-agent/src/core/tools/index.ts`                                                                                                                                                                                                                  | Coverage-gap: any other mutator goes unformatted (`powershell` already exists and is unmatched)                                |
| Bash output is readable from the `tool_result` text content parts                                                                                       | `packages/coding-agent/src/core/extensions/types.ts` (`ToolResultEventBase.content`); `packages/coding-agent/src/core/tools/bash.ts`                                                                                                                             | Behavioral-silent: wrapper-command matching sees nothing                                                                       |
| `turn_end` fires after the turn's tool results and is awaited, and a `pi.sendMessage` from it reaches the agent before its next model call              | `packages/coding-agent/src/core/agent-session.ts` (`_dispatchTurnEndBoundary`, `sendCustomMessage`); `packages/coding-agent/src/core/extensions/runner.ts` (`emitBoundary`)                                                                                      | Behavioral-silent: the formatting notice arrives a turn late or races the flush                                                |
| `agent_end` follows the final `turn_end`, so its flush is only a safety net                                                                             | `packages/coding-agent/src/core/agent-session.ts` (`agent_end` emit, `_willRetryAfterAgentEnd`)                                                                                                                                                                  | Behavioral-silent: a retry produces turns after `agent_end`                                                                    |
| `getAgentDir()` honors `PI_CODING_AGENT_DIR`                                                                                                            | `packages/coding-agent/src/config.ts` (`getAgentDir`)                                                                                                                                                                                                            | Behavioral-silent: the global config is not read                                                                               |
| The acceptance harness's CLI flags (`--mode rpc --no-tools --no-extensions --no-session -e`) and the RPC protocol                                       | `packages/coding-agent/src/cli/args.ts`; `packages/coding-agent/src/modes/rpc/rpc-mode.ts`                                                                                                                                                                       | Harness-only: the acceptance suite fails to start                                                                              |

The acceptance suites (`test/acceptance.test.ts`, `test/fallback-acceptance.test.ts`, `test/acceptance-event-bus.test.ts`) drive the real CLI and are the only canaries; every other test stubs `pi`.

## Testing

- Test formatter resolution, execution order, and failure handling.
- Test prompt-end batching behavior.
- Test custom formatter command configuration.
- Test multiple formatter chains for the same file type.
- Test config loading, merge precedence, and validation issues.

Vitest splits this package into two projects.
`pnpm test` runs the `unit` project only, so a green run does **not** exercise the real `pi` CLI; `pnpm run test:acceptance` runs the real-CLI suite and `pnpm run test:all` runs both.
The split keeps those child-process spawns off the workspace-wide `pnpm -r run test`, where they used to time out under load and red a package the session never touched.
When adding a test that calls `runRpcSession`, add its path to `ACCEPTANCE_FILES` in `test/acceptance-files.ts` — `test/project-partition.test.ts` fails if you do not.

## Notes for Agents

Before implementing, understand:

1. The timing tradeoffs between tool-mode and prompt-mode formatting.
2. The need to support repository-specific formatter chains.
3. The chosen config layout and merge precedence.

Do not assume commit-time hooks are an acceptable primary formatting mechanism.
