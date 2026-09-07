# @gotgenes/pi-subagents

[![npm version](https://img.shields.io/npm/v/@gotgenes/pi-subagents?style=flat&logo=npm&logoColor=white)](https://www.npmjs.com/package/@gotgenes/pi-subagents) [![CI](https://img.shields.io/github/actions/workflow/status/gotgenes/pi-packages/ci.yml?style=flat&logo=github&label=CI)](https://github.com/gotgenes/pi-packages/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![pnpm](https://img.shields.io/badge/pnpm-%3E%3D11-F69220?style=flat&logo=pnpm&logoColor=white)](https://pnpm.io/) [![Pi Package](https://img.shields.io/badge/Pi-Package-6366F1?style=flat)](https://pi.mariozechner.at/)

A [pi](https://pi.dev) extension that gives pi **a focused, in-process sub-agent core** — autonomous agents that run inside the same pi runtime (no spawned subprocesses), plus a typed API and lifecycle events other extensions build on.
Spawn specialized agents that run in isolated sessions — each with its own tools, system prompt, model, and thinking level.
Run them in foreground or background, steer them mid-run, resume completed sessions, and define your own custom agent types.

> Originally forked from [`tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents) by [@tintinweb](https://github.com/tintinweb), now an independently maintained hard fork.
> See [Comparison with upstream](./docs/comparison-with-upstream.md) for a feature-by-feature comparison and guidance on which to choose.

<img width="600" alt="pi-subagents screenshot" src="https://github.com/gotgenes/pi-subagents/raw/main/media/screenshot.png" />

<https://github.com/user-attachments/assets/8685261b-9338-4fea-8dfe-1c590d5df543>

## Features

- **In-process & native** — agents run inside the same pi runtime (no spawned subprocesses), sharing tool names, calling conventions, and UI patterns (`subagent`, `get_subagent_result`, `steer_subagent`) — feels native
- **Parallel background agents** — spawn multiple agents that run concurrently with automatic queuing (configurable concurrency limit, default 4) and individual completion notifications
- **Live widget UI** — persistent above-editor widget with animated spinners, live tool activity, token counts, and colored status icons
- **Session transcripts** — open any subagent's full session transcript (running or with its session released) in pi's native read-only viewer via `/subagents:sessions`
- **Custom agent types** — define agents in `.pi/agents/<name>.md` with YAML frontmatter: custom system prompts, model selection, thinking levels, tool restrictions
- **Mid-run steering** — inject messages into running agents to redirect their work without restarting
- **Session resume** — pick up where an agent left off, preserving full conversation context.
  An agent given an isolated workspace by a `WorkspaceProvider` is resumable while that workspace is live — which, for an agent that ended its turn with a question, lasts until you answer it
- **Ask-back** — an agent that needs information only you have calls `ask_parent` and ends its turn, and every result surfaces the question with the exact `resume` call that answers it; once that agent can no longer be resumed, the result says so and why instead of naming a call that would be refused
- **Mid-run updates** — an agent that finds something material calls `notify_parent` and keeps working, so you hear about a course change rather than only at the end; while you are blocked awaiting that agent the update rides its own result instead
- **Graceful turn limits** — agents get a "wrap up" warning before hard abort, producing clean partial results instead of cut-off output
- **Case-insensitive agent types** — `"explore"`, `"Explore"`, `"EXPLORE"` all work.
  Unknown types fall back to general-purpose with a note
- **Fuzzy model selection** — specify models by name (`"haiku"`, `"sonnet"`) instead of full IDs, with automatic filtering to only available/configured models
- **Context inheritance** — optionally fork the parent conversation into a sub-agent so it knows what's been discussed
- **Styled completion notifications** — background agent results render as themed, compact notification boxes (icon, stats, result preview) instead of raw XML.
  Expandable to show full output
- **Event bus** — lifecycle events (`subagents:created`, `started`, `completed`, `failed`, `resumed`, `steered`, `compacted`) emitted via `pi.events`, enabling other extensions to react to sub-agent activity

## Install

```bash
pi install npm:@gotgenes/pi-subagents
```

Or load directly for development:

```bash
pi -e ./src/index.ts
```

## Quick Start

The parent agent spawns sub-agents using the `subagent` tool:

```text
subagent({
  subagent_type: "Explore",
  prompt: "Find all files that handle authentication",
  description: "Find auth files",
  run_in_background: true,
})
```

Foreground agents block until complete and return results inline.
Background agents return an ID immediately and notify you on completion.

## UI

The extension renders a persistent widget above the editor showing active background agents (foreground runs are rendered inline by the `subagent` tool's progress stream):

```text
● Agents
├─ ⠹ Agent  Refactor auth module · ↻5≤30 · 5 tool uses · 33.8k token (62%) · 12.3s
│    ⎿  editing 2 files…
├─ ⠹ Explore  Find auth files · ↻3 · 3 tool uses · 12.4k token (8%) · 4.1s
│    ⎿  searching…
├─ ⠹ Agent  Long-running task · ↻42 · 38 tool uses · 91.0k token (84% · ⇊2) · 2m17s
│    ⎿  reading…
└─ 2 queued
```

The token field is annotated with two optional signals inside parens:

- **`NN%`** — context-window utilization (color-coded: <70% dim, 70–85% warning, ≥85% error).
  Omitted when the model has no declared `contextWindow`, or briefly right after compaction.
- **`⇊N`** — number of times the session has compacted, when > 0.
  Stays dim; the percent's color carries urgency.

Individual agent results render inline in the conversation:

| State          | Example                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------- |
| **Running**    | `⠹ ↻3≤30 · 3 tool uses · 12.4k token (8%)` / `⎿ searching, reading 3 files…`             |
| **Completed**  | `✓ ↻8 · 5 tool uses · 33.8k token (62%) · 12.3s` / `⎿ Done`                              |
| **Wrapped up** | `✓ ↻50≤50 · 50 tool uses · 89.1k token (84% · ⇊2) · 45.2s` / `⎿ Wrapped up (turn limit)` |
| **Stopped**    | `■ ↻3 · 3 tool uses · 12.4k token (8%)` / `⎿ Stopped`                                    |
| **Error**      | `✗ ↻3 · 3 tool uses · 12.4k token (8%)` / `⎿ Error: timeout`                             |
| **Aborted**    | `✗ ↻55≤50 · 55 tool uses · 102.3k token (95% · ⇊3)` / `⎿ Aborted (max turns exceeded)`   |

Completed results can be expanded (ctrl+o in pi) to show the full agent output inline.

Background agent completion notifications render as styled boxes:

```text
✓ Find auth files completed
  ↻3 · 3 tool uses · 12.4k token · 4.1s
  ⎿  Found 5 files related to authentication...
  transcript: .pi/output/agent-abc123.jsonl
```

The LLM receives structured `<task-notification>` XML for parsing, while the user sees the themed visual.

## Tools

### `subagent`

Launch a sub-agent.

| Parameter           | Type         | Required | Description                                                      |
| ------------------- | ------------ | -------- | ---------------------------------------------------------------- |
| `prompt`            | string       | yes      | The task for the agent                                           |
| `description`       | string       | yes      | Short 3-5 word summary (shown in UI)                             |
| `subagent_type`     | string       | yes      | Agent type (built-in or custom)                                  |
| `model`             | string       | no       | Model — `provider/modelId` or fuzzy name (`"haiku"`, `"sonnet"`) |
| `thinking`          | string       | no       | Thinking level: off, minimal, low, medium, high, xhigh, max      |
| `max_turns`         | number       | no       | Max agentic turns. Omit for the agent's own limit                |
| `run_in_background` | boolean      | no       | Run without blocking                                             |
| `resume`            | string       | no       | Agent ID to resume a previous session                            |
| `inherit_context`   | boolean      | no       | Fork parent conversation into agent                              |

These five parameters win over the agent file's own values, which fill whichever the call leaves unset.
An agent file can withhold one with [`locked`](./docs/configuration.md#locking-fields-against-callers); the result then names the agent and the parameters it ignored.

### `get_subagent_result`

Check status and retrieve results from a background agent.

| Parameter  | Type    | Required | Description                   |
| ---------- | ------- | -------- | ----------------------------- |
| `agent_id` | string  | yes      | Agent ID to check             |
| `wait`     | boolean | no       | Wait for completion           |
| `verbose`  | boolean | no       | Include full conversation log |

### `steer_subagent`

Send a steering message to a running agent.
The message interrupts after the current tool execution.

| Parameter  | Type   | Required | Description                               |
| ---------- | ------ | -------- | ----------------------------------------- |
| `agent_id` | string | yes      | Agent ID to steer                         |
| `message`  | string | yes      | Message to inject into agent conversation |

## Commands

| Command               | Description                                                                         |
| --------------------- | ----------------------------------------------------------------------------------- |
| `/subagents:settings` | Configure subagent settings (concurrency, turn limits, retention, interrupt policy) |
| `/subagents:sessions` | View a subagent's session transcript (read-only)                                    |

### `/subagents:settings`

Interactive list to tune runtime settings — max concurrency, default max turns, grace turns, the two session-retention windows, and whether ESC aborts every subagent.
The numeric settings open an input prompt; the abort-on-ESC entry is a direct flip.
Changes persist across pi restarts (see [Persistent Settings](./docs/configuration.md#persistent-settings)).

### `/subagents:sessions`

Pick any subagent — running, or completed with its live session already released — and read its full session transcript in pi's native per-entry viewer.
Read-only: no steering, no session takeover (steering lives in the `steer_subagent` tool and the background widget).

Creating and editing agent definitions is not a command — write an agent `.md` file in your editor, or ask a pi session to generate one (see [Custom Agents](./docs/configuration.md#custom-agents)).

## Graceful Max Turns

Instead of hard-aborting at the turn limit, agents get a graceful shutdown:

1. At `max_turns` — steering message: _"Wrap up immediately — provide your final answer now."_
2. Up to 5 grace turns to finish cleanly
3. Hard abort only after the grace period

| Status      | Meaning                       | Icon       |
| ----------- | ----------------------------- | ---------- |
| `completed` | Finished naturally            | `✓` green  |
| `steered`   | Hit limit, wrapped up in time | `✓` yellow |
| `aborted`   | Grace period exceeded         | `✗` red    |
| `stopped`   | User-initiated abort          | `■` dim    |

## Concurrency

Background agents are subject to a configurable concurrency limit (default: 4).
Excess agents are automatically queued and start as running agents complete.
The widget shows queued agents as a collapsed count.

Foreground agents bypass the queue — they block the parent anyway.

Stopping a still-queued agent produces the same completion notification a running agent's stop does.
Because that agent never started, the notification says so and offers no result to collect.

## Child session lifecycle

A child session runs in the parent's process but is a full Pi session with its own extension set.
It receives the standard pair of session lifecycle events:

| Event              | When                                                | Reason      |
| ------------------ | --------------------------------------------------- | ----------- |
| `session_start`    | Extensions are bound, before the child's first turn | `"startup"` |
| `session_shutdown` | The child session is disposed                       | `"quit"`    |

Disposal happens when the retention window for a finished agent expires, when completed records are cleared at session start or switch, when the parent session shuts down, or when child extension binding fails partway.
It does **not** happen the moment an agent finishes: the session is retained so the agent can be resumed, per the `consumedSessionRetentionMinutes` and `unconsumedSessionRetentionMinutes` settings above.

The shutdown event is dispatched and awaited **before** the child's `AgentSession` is disposed, so a handler still has a live context and can close what it opened — stdio subprocesses, sockets, timers, file handles.
Each child's shutdown is bounded: a handler that never resolves is abandoned after a few seconds and disposal proceeds, so one misbehaving extension cannot stall the parent's teardown or Pi's exit.

If you author an extension that runs in children, note that its `session_shutdown` handler now fires **once per child session** in addition to once for the parent.
A handler that flushes a log, writes a summary, or closes a shared resource should be safe to run repeatedly within one process.
Before this behavior existed, children fired `session_start` with no matching shutdown, so extension-owned resources accumulated for the life of the parent process.

## Events

Agent lifecycle events are emitted via `pi.events.emit()` so other extensions can react:

| Event                        | When                                                    | Key fields                                                                                                           |
| ---------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `subagents:created`          | Background agent registered                             | `id`, `type`, `description`, `isBackground`                                                                          |
| `subagents:started`          | Agent transitions to running (including queued→running) | `id`, `type`, `description`                                                                                          |
| `subagents:completed`        | Agent finished successfully                             | `id`, `type`, `durationMs`, `tokens` (lifetime `{ input, output, total }`), `toolUses`, `result`                     |
| `subagents:failed`           | Agent errored, stopped, or aborted                      | same as completed + `error`, `status`                                                                                |
| `subagents:resumed`          | Resumed run reached a terminal state (completed/error)  | same as completed + `error`, `status` (`buildEventData` shape) — `status`/`error` discriminate                       |
| `subagents:steered`          | Steering message sent                                   | `id`, `message`                                                                                                      |
| `subagents:compacted`        | Agent's session successfully compacted                  | `id`, `type`, `description`, `reason` (`"manual"` / `"threshold"` / `"overflow"`), `tokensBefore`, `compactionCount` |
| `subagents:settings_loaded`  | Persisted settings applied at extension init            | `settings` (merged global + project)                                                                                 |
| `subagents:settings_changed` | `/subagents:settings` mutation was applied              | `settings`, `persisted` (`boolean` — `false` on write failure)                                                       |

`tokens.total` = `input + output + cacheWrite`.
`cacheRead` is excluded — each turn's `cacheRead` is the cumulative cached prefix re-read on that one API call, so summing per-message would over-count it.
Use `contextUsage.percent` (surfaced as `(NN%)` in the widget) for current context size.

## Worktree Isolation

Worktree isolation lives in a companion package, not this core.
Install [`@gotgenes/pi-subagents-worktrees`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-subagents-worktrees) and list the agent types you want isolated in its `worktreeAgents` config — opted-in agents run in a temporary git worktree, and their changes are saved to a branch on completion.
The earlier `isolation: "worktree"` spawn flag and `isolation:` frontmatter key were removed from the core.

## Removed: agent memory and skill preloading

Persistent agent memory (the `memory:` frontmatter key) and skill preloading (the `skills:` frontmatter key) were removed when the core was slimmed down.
Children inherit the parent's skills and extensions by default, so the `isolated`, `extensions`, and `skills` frontmatter keys no longer exist.
Package-level extension opt-outs live in the [`excludedExtensionPackages`](./docs/configuration.md#excluding-package-extensions-from-children) setting rather than agent frontmatter.

## Migrating from `disallowed_tools`

The `disallowed_tools` frontmatter field has been removed.
Use [`@gotgenes/pi-permission-system`](https://github.com/gotgenes/pi-permission-system)'s `permission:` frontmatter instead — it provides richer semantics (allow/ask/deny vs. binary hide):

```yaml
# Before (no longer supported)
disallowed_tools: bash

# After
permission:
  bash: deny
```

## Permission System Integration

When [`@gotgenes/pi-permission-system`](https://github.com/gotgenes/pi-permission-system) is installed, this extension integrates automatically:

- **Per-agent permission policies** — define `permission:` in agent YAML frontmatter to set allow/ask/deny rules per agent type.
  The permission system resolves the agent name from the `<active_agent>` tag in the child system prompt.
- **Tool filtering** — the permission system's `before_agent_start` handler removes denied tools from the child session before the agent starts.
- **`ask`-state forwarding** — when a child session triggers an `ask` permission, the prompt forwards to the parent session's UI.
  The parent approves or denies, and the child resumes.
- **Deterministic child detection** — this extension publishes `subagents:child:session-created` before `bindExtensions()` fires; the permission system subscribes and registers the child session synchronously, so detection does not rely on env vars or filesystem heuristics.
- **Unguarded children are announced** — this extension also publishes `subagents:child:bound` once a child's extensions have bound; the permission system uses it to notice a child that loaded no permission node of its own — the case [`excludedExtensionPackages`](docs/configuration.md#excluding-package-extensions-from-children) can create — and warns rather than letting it run ungated in silence.

No configuration is required.
When `@gotgenes/pi-permission-system` is not installed, the lifecycle events have no subscriber — a harmless no-op.

## For Extension Authors

This package exposes two public subpath exports for companion extensions to import from the published tarball.

### `@gotgenes/pi-subagents` — cross-extension service contract

Access the subagent service from another extension at runtime:

```typescript
const { getSubagentsService } = await import("@gotgenes/pi-subagents");
const svc = getSubagentsService();
svc?.spawn("Explore", "Check for stale TODOs");
```

Declare this package as an optional peer dependency.
See `src/service/service.ts` for the full `SubagentsService` interface and the `WorkspaceProvider` seam.

#### `spawn` contract

`spawn` returns the new agent's id immediately — it never waits for the run.
Use `getRecord(id)` to poll, `steer` to send a message, and the `subagents:completed` event to learn when it finished.

The agent type is canonicalized, so `"explore"` and `"Explore"` reach the same agent.
An unrecognized type falls back to `general-purpose` rather than throwing, matching the `subagent` tool's behavior.

It throws in four cases:

- there is no active session, so there is no parent to spawn from;
- a `model` string does not resolve against the session's model registry;
- a `thinkingLevel` is not one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`;
- the named agent type exists but is disabled (`enabled: false`).

Agent frontmatter never overrides an option you pass.
It fills `model`, `thinkingLevel`, and `maxTurns` when you omit them; `inheritContext` is the exception, and defaults to `false` whatever the agent file declares.
An agent file's [`locked`](./docs/configuration.md#locking-fields-against-callers) frontmatter does not apply here — it guards against a model guessing harness settings, and an SDK caller is not that.

Background mode follows the caller's degree of commitment.
Omit `foreground` and the agent's own `run_in_background` frontmatter decides, defaulting to background when the agent declares nothing.
Pass `foreground` explicitly and it wins outright, whatever the frontmatter says.

A spawned agent is a first-class citizen of the runtime: it appears in the background widget, carries its parent's session identity so permission prompts route correctly, and nests its session file under the parent's.

#### `getRecord` / `listAgents` contract

Both return `SubagentRecord`, a by-value snapshot: nothing in it changes after you receive it, and writing to it cannot reach the agent.
Poll again for fresh data.

The snapshot carries identity (`id`, `type`, `description`), lifecycle status (`status`, `startedAt`, `completedAt`, `result`, `error`), the resolved spawn facts (`isBackground`, `maxTurns`), cumulative metrics (`toolUses`, `turnCount`, `compactionCount`, `lifetimeUsage`), and `outputFile` — the path to the agent's session JSONL, which you can read with Pi's own `parseSessionEntries`.

It deliberately withholds momentary activity (the tools running right now, the partial response text) and this package's internal bookkeeping.
A pulled snapshot of momentary state would be stale on arrival; [decision 0005](docs/decisions/0005-subagent-record-admission-policy.md) records the full policy and what would reopen it.

`SubagentRecord` and `SubagentsService` are types this package produces and you read — not contracts to implement.
A new field is therefore a minor release; use a cast or a `Partial<>` for a test double rather than implementing either type.

### `@gotgenes/pi-subagents/settings` — layered config loader

Extensions that store configuration in JSON files can use the shared layered loader, which reads a global file (`<agentDir>/<filename>`) and a project file (`<cwd>/.pi/<filename>`) and merges them — project wins on conflicts, missing files are silent, malformed files warn and fall back:

```typescript
import { loadLayeredSettings, type LayeredSettingsSource } from "@gotgenes/pi-subagents/settings";

interface MyConfig { enabled?: boolean; limit?: number }

function sanitize(raw: unknown): Partial<MyConfig> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<MyConfig> = {};
  if (typeof r.enabled === "boolean") out.enabled = r.enabled;
  if (typeof r.limit === "number") out.limit = r.limit;
  return out;
}

const config = loadLayeredSettings<MyConfig>({
  agentDir,          // Pi runtime agent home directory
  cwd,               // project root — project file lives at <cwd>/.pi/<filename>
  filename: "my-extension.json",
  sanitize,
  warnLabel: "my-extension",  // prefix for the malformed-file stderr warning
});
```

`loadLayeredSettings` returns `Partial<T>` (all fields optional); apply your defaults after the call.
It never throws — all error conditions produce a `console.warn` and return `{}`.

### Extensions that append to the system prompt

If your extension appends to the system prompt from a `before_agent_start` handler, your parent-session block does **not** ride into child sessions.
A child inherits only the stable part of the parent's prompt — everything Pi assembled ahead of the skills catalogue — so anything appended after that is dropped.
See [What a child inherits from the parent's prompt](./docs/configuration.md#what-a-child-inherits-from-the-parents-prompt) for the full layer breakdown.

This is usually invisible to you, because your handler runs in the child too: a child binds the parent's extension set, and its turn loop fires `before_agent_start` the same way the parent's does.
An unconditional appender therefore writes a fresh block built for the child's own session — which is what you want, since the parent's copy named the parent's directory, model, and session.

Two cases need care:

- A handler gated on something a child lacks — an interactive UI, a terminal, or state your extension cached at `session_start` — appends nothing in the child.
  That child now carries no block at all, where previously it inherited one built for the parent.
  If your guidance applies to children, make the handler unconditional or derive its inputs from the event context rather than from cached session state.
- An extension excluded from children through [`excludedExtensionPackages`](./docs/configuration.md#excluding-package-extensions-from-children) contributes nothing to a child by design, and no longer leaks its parent-session block in either.

Extensions that _shape_ the prompt at the provider boundary rather than appending to it are unaffected — the region they rewrite is the identity a child inherits verbatim.

## Scope and non-goals

**Purpose.**
A minimal, in-process sub-agent core.
It spawns a child session derived from the parent, runs the turn loop, streams and collects the result, gates concurrency, supports resume, and publishes its lifecycle.
Everything else is a consumer.

**In scope.**
Defects in the surfaces the core already owns, completeness of the public lifecycle-event contract, and internal work toward the minimal-core target.
Anything attaching to the core either subscribes to a lifecycle event, or registers a provider if it must return a value the core consumes — see [ADR-0002](./docs/decisions/0002-extensions-on-a-minimal-core.md).

**Non-goals.**

- _Capability the fork deliberately left behind._
  Scheduling, cross-extension RPC, model-scope enforcement, and a built-in tool denylist belong to upstream — see [Relationship to upstream](#relationship-to-upstream).
- _Policy about what a child may do._
  Tool restriction is allow/ask/deny in a permission layer, not a binary hide in a spawner — see [Migrating from `disallowed_tools`](#migrating-from-disallowed_tools).
- _Widening a child's tool allowlist with **capability** tools on the agent's behalf._
  An agent's `tools:` frontmatter is the only thing that admits a capability tool, and no settings key may name one, because a settings-level list would hand a read-only `Explore` agent write-capable tools from a file its author never saw.
  The core does install its own protocol in every child — the `<active_agent>` tag, the parent-context prefix, and the `ask_parent` / `notify_parent` tools — none of which reaches the filesystem, the shell, or the network.
- _A global run-mode default._
  Foreground or background is a per-invocation argument and a per-agent frontmatter key; a global flip changes every existing agent file at once.
- _Provider seams with no consumer._
  A seam nobody supplies is a speculative abstraction that taxes every reader; the architecture may admit one without shipping it until a real consumer exists.

The [architecture doc](./docs/architecture/architecture.md#scope-and-non-goals) carries the full inventory, including the removed UI surfaces and the reasoning behind each.

**Where adjacent requests belong.**
Tool restriction and per-agent permission policy → [@gotgenes/pi-permission-system](https://www.npmjs.com/package/@gotgenes/pi-permission-system).
Worktree isolation → [@gotgenes/pi-subagents-worktrees](https://www.npmjs.com/package/@gotgenes/pi-subagents-worktrees).
Timed dispatch, telemetry, and alternate UIs → a consumer over the lifecycle events and the typed service.
A batteries-included alternative → upstream [`tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents).

## Documentation

| Document                                                       | Contents                                                                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [Configuration](./docs/configuration.md)                       | Default agent types, custom agent files and their frontmatter fields, and the `subagents.json` settings file   |
| [Architecture](./docs/architecture/architecture.md)            | Design principles, domain decomposition, module dependency flow, Mermaid diagrams, and the improvement roadmap |
| [Comparison with upstream](./docs/comparison-with-upstream.md) | Feature-by-feature comparison against the current upstream release                                             |

## Architecture

This extension is a minimal, composable core: it owns agent spawning, execution, and result retrieval, and exposes a typed `SubagentsService` plus lifecycle events that other extensions build on.

## Relationship to upstream

This package is an independently maintained hard fork of [`tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents) by [@tintinweb](https://github.com/tintinweb).
It has diverged substantially in scope and architecture: a minimal core with a typed service API and lifecycle events, with tool-restriction policy and worktree isolation delegated to companion packages.
Upstream remains the batteries-included option, keeping scheduling, cross-extension RPC, model-scope enforcement, and a built-in tool denylist in a single package.

See [Comparison with upstream](./docs/comparison-with-upstream.md) for a full feature-by-feature comparison against the current upstream release and guidance on which to choose.

## License

MIT — [tintinweb](https://github.com/tintinweb) (upstream) and [Chris Lasher](https://github.com/gotgenes) (fork)
