---
name: package-pi-colgrep
description: |
  Package-specific context for @gotgenes/pi-colgrep.
  Load when working on code, tests, or docs in packages/pi-colgrep/.
---

# pi-colgrep

Pi extension that exposes the [ColGrep](https://github.com/lightonai/next-plaid#colgrep) semantic code-search CLI as an agent tool and keeps its index current across a session.

Read `docs/architecture/architecture.md` before making structural changes — it holds the module map, the index-management lifecycle, and the reindexer state machine.

## Architecture

Two cooperating concerns reach the CLI through one seam:

- **Search path** — the agent invokes the `colgrep` tool (`tools/colgrep.ts` → `lib/search.ts` → `lib/args.ts` + `lib/format.ts`).
- **Index-management path** — the extension warms and refreshes the index (`lib/availability.ts`, `lib/config.ts`, `lib/index-status.ts`, `lib/reindex.ts`).

```text
src/
├── extension.ts          # entry point: wires handlers + /colgrep-reindex, owns session state
├── tool-result.ts        # ok() / err() AgentToolResult builders
├── tools/
│   └── colgrep.ts        # registers the colgrep tool; executeColGrepSearch; rendering
└── lib/                  # SDK-free business logic
    ├── exec.ts           # Exec type — the single seam to process execution
    ├── availability.ts   # AvailabilityState (cached colgrep --version)
    ├── config.ts         # loadConfig (indexOnStartup), config path builders
    ├── index-status.ts   # checkIndexExists + pure indexExistsFromStatus parser
    ├── reindex.ts        # createReindexer: debounce, queue, coalesce, shutdown
    ├── search.ts         # runSearch: build args, exec, format
    ├── args.ts           # buildSearchArgs: SearchParams → CLI argv
    └── format.ts         # formatResults / formatHit: colgrep --json → text
```

## Implementation Priorities

- `src/lib/` must not import from `@earendil-works/pi-coding-agent` — only `extension.ts` and `tools/colgrep.ts` touch Pi types.
  Library modules take an injected `Exec` (the sole seam to the CLI).
- Degrade, never throw: availability checks, index probes, and reindex runs resolve to a safe default (unavailable, no-index, logged failure).
  A missing or failing `colgrep` binary must never block the agent.
- Startup indexing is non-blocking — `session_start` fires `reindexer.runNow()` fire-and-forget.
  Never re-add an `await` there.
- Index only what is searched: the write/edit auto-reindex is gated on `indexExists` (probed once on `session_start` via `colgrep status`).
  Do not proactively index a directory the operator never searches.
- The reindexer serializes all builds: one `colgrep init` at a time.
  `runNow()` coalesces concurrent calls onto the in-flight promise; `shutdown()` awaits it.

## colgrep CLI Facts

- `colgrep search` auto-indexes a missing/stale index on demand.
  Lazy indexing is free; the extension never needs to force an index just so search works.
- `colgrep status <path>` exits `0` whether or not an index exists and has **no** `--json`.
  Parse stdout: the literal `No index found` is the stable negative signal (`indexExistsFromStatus`).
- `colgrep init -y .` is the build/refresh command the reindexer runs.

## Configuration

Extension-owned JSON config, project overriding global:

- Global: `<agentDir>/extensions/pi-colgrep/config.json`
- Project: `<cwd>/.pi/extensions/pi-colgrep/config.json`

`indexOnStartup` (boolean, default `true`): when `false`, no background startup index; the index is built lazily on first search or via `/colgrep-reindex`.
Missing file is silent; malformed file warns and defaults apply.

## Upstream assumptions

The `/upstream-impact` watchlist for this package; the `upstream-watch` skill defines the impact classes.
Paths are relative to the Pi checkout.

| Our assumption                                                                                                                                                     | Upstream file                                                                                                                                                                                          | Breaks as                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| A successful `write` or `edit` `tool_result` is the only reindex signal a file change needs, including calls nested through `ctx.executeTool()`                    | `packages/coding-agent/src/core/agent-session.ts` (`_afterToolCall`, `_executeNestedToolCall`); `packages/coding-agent/src/core/nested-tool-calls.ts`; `packages/coding-agent/src/core/tools/index.ts` | Coverage-gap: a new mutating built-in, a nested path that skips `_afterToolCall`, or a bash-driven edit leaves the index silently stale |
| `err()`'s `isError: true` reaches the model as an error; true from Pi 0.99.0, and the 1.0.0 peer floor admits no host that drops it                                | `packages/agent/src/agent-loop.ts` (`executePreparedToolCall`)                                                                                                                                         | Behavioral-silent: search failures read as success, as they do on every host before 0.99.0                                              |
| `promptSnippet` and `promptGuidelines` from `registerTool` are rendered into the system prompt's tools and rules sections                                          | `packages/coding-agent/src/core/system-prompt.ts` (`buildSystemPromptSections`, `buildRules`)                                                                                                          | Behavioral-silent: the tool still works, but the model loses the colgrep-vs-grep guidance                                               |
| `pi.exec` resolves with `{stdout, stderr, code, killed}` and does not reject on a non-zero exit                                                                    | `packages/coding-agent/src/core/exec.ts` (`execCommand`, `ExecResult`)                                                                                                                                 | Behavioral-silent: availability, index-status, and search error handling misfire                                                        |
| `truncateHead`, `DEFAULT_MAX_LINES`, and `DEFAULT_MAX_BYTES` are root exports with stable semantics                                                                | `packages/coding-agent/src/core/tools/truncate.ts`                                                                                                                                                     | Compile-time on removal; behavioral-silent if the limits change                                                                         |
| `renderCall`/`renderResult` receive a `context.lastComponent` reusable as a `Text` and `renderResult` a `context.isError`, and the theme color names we pass exist | `packages/coding-agent/src/core/extensions/types.ts` (`ToolDefinition.renderResult`); `packages/coding-agent/src/modes/interactive/theme/theme.ts`                                                     | Behavioral-silent, cosmetic: the cast is unchecked                                                                                      |
| `getAgentDir()` honors `PI_CODING_AGENT_DIR`, and `ctx.cwd`/`ctx.ui` are ready at `session_start`                                                                  | `packages/coding-agent/src/config.ts` (`getAgentDir`); `packages/coding-agent/src/core/extensions/types.ts`                                                                                            | Behavioral-silent: the global config is not read                                                                                        |

No test runs against real Pi; every test mocks `pi`, so none is a canary.

## Testing

- Mock the injected `Exec` in `lib/` tests so every test runs offline — no real `colgrep` calls.
- Use Vitest fake timers for `reindex.ts` (debounce/queue).
  Never `vi.runAllTimersAsync()`; advance with a specific duration.
- Extension wiring tests drive the `TestPi` stub and mock `#src/lib/config` via a `vi.hoisted` `loadConfig` stub to control `indexOnStartup` without touching the filesystem.
- Assert non-blocking startup by holding the `init` exec and checking the handler returns with the indexing status still set (not cleared); drain via `session_shutdown` before asserting the cleared status.
