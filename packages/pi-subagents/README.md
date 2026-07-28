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
- **Session resume** — pick up where an agent left off, preserving full conversation context
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

## Default Agent Types

| Type              | Tools                      | Model                         | Prompt Mode            | Description                                                                                      |
| ----------------- | -------------------------- | ----------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| `general-purpose` | all 7                      | inherit                       | `append` (parent twin) | Inherits the parent's full system prompt — same rules, CLAUDE.md, project conventions            |
| `Explore`         | read, bash, grep, find, ls | haiku (falls back to inherit) | `replace`              | Fast codebase exploration (read-only); inherits the parent prompt as a base                      |
| `Plan`            | read, bash, grep, find, ls | inherit                       | `replace`              | Software architect for implementation planning (read-only); inherits the parent prompt as a base |

The `general-purpose` agent is a **parent twin** — it receives the parent's entire system prompt plus a sub-agent context bridge, so it follows the same rules the parent does.
Explore and Plan use `replace` mode: the parent prompt is the cacheable base and their specialist read-only instructions are appended last, giving them the final say.

In every mode, a child that runs somewhere other than the parent — one given an isolated workspace by a `WorkspaceProvider` — does not inherit the parent's `Current working directory:` footer.
That line is stripped from the inherited prompt, leaving the fresh footer Pi appends for the child session's own directory as the single, correct claim; without the strip, the child follows the parent's path instead.
A child sharing the parent's directory inherits the prompt untouched, so its prefix stays byte-identical to the parent's.

Default agents can be **overridden** by creating a `.md` file with the same name (e.g. `.pi/agents/general-purpose.md`), or **disabled** per-project with `enabled: false` frontmatter.

## Custom Agents

Define custom agent types by creating `.md` files.
The filename becomes the agent type name.
Any name is allowed — using a default agent's name overrides it.

Agents are discovered from two locations (higher priority wins):

| Priority    | Location                                                                         | Scope                         |
| ----------- | -------------------------------------------------------------------------------- | ----------------------------- |
| 1 (highest) | `.pi/agents/<name>.md`                                                           | Project — per-repo agents     |
| 2           | `$PI_CODING_AGENT_DIR/agents/<name>.md` (default `~/.pi/agent/agents/<name>.md`) | Global — available everywhere |

Project-level agents override global ones with the same name, so you can customize a global agent for a specific project.
The global location follows the upstream `PI_CODING_AGENT_DIR` env var — set it to relocate all pi-coding-agent state (agents, skills, settings) to a custom directory.

### Example: `.pi/agents/auditor.md`

```markdown
---
description: Security Code Reviewer
tools: read, grep, find, bash
model: anthropic/claude-opus-4-6
thinking: high
max_turns: 30
---

You are a security auditor.
Review code for vulnerabilities including:

- Injection flaws (SQL, command, XSS)
- Authentication and authorization issues
- Sensitive data exposure
- Insecure configurations

Report findings with file paths, line numbers, severity, and remediation advice.
```

Then spawn it like any built-in type:

```text
subagent({ subagent_type: "auditor", prompt: "Review the auth module", description: "Security audit" })
```

### Frontmatter Fields

All fields are optional — sensible defaults for everything.

| Field               | Default        | Description                                                                                                                                                                                                                                                                                                             |
| ------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`       | filename       | Agent description shown in tool listings                                                                                                                                                                                                                                                                                |
| `display_name`      | —              | Display name for UI (e.g. widget, agent list)                                                                                                                                                                                                                                                                           |
| `tools`             | all 7          | Comma-separated built-in tools: read, bash, edit, write, grep, find, ls. `none` for no tools                                                                                                                                                                                                                            |
| `model`             | inherit parent | Model — `provider/modelId` or fuzzy name (`"haiku"`, `"sonnet"`)                                                                                                                                                                                                                                                        |
| `thinking`          | inherit        | off, minimal, low, medium, high, xhigh                                                                                                                                                                                                                                                                                  |
| `max_turns`         | unlimited      | Max agentic turns before graceful shutdown. `0` or omit for unlimited                                                                                                                                                                                                                                                   |
| `prompt_mode`       | `append`       | `replace`: parent prompt is the cacheable base; body is appended last with full control (no `<sub_agent_context>` bridge, no `<agent_instructions>` wrapper). `append`: parent prompt is the base; body is wrapped in `<agent_instructions>` and a sub-agent context bridge is injected (agent acts as a "parent twin") |
| `inherit_context`   | `false`        | Fork parent conversation into agent                                                                                                                                                                                                                                                                                     |
| `run_in_background` | `false`        | Run in background by default                                                                                                                                                                                                                                                                                            |
| `enabled`           | `true`         | Set to `false` to disable an agent (useful for hiding a default agent per-project)                                                                                                                                                                                                                                      |

Frontmatter is authoritative.
If an agent file sets `model`, `thinking`, `max_turns`, `inherit_context`, or `run_in_background`, those values are locked for that agent.
`subagent` tool parameters only fill fields the agent config leaves unspecified.

## Tools

### `subagent`

Launch a sub-agent.

| Parameter           | Type         | Required | Description                                                      |
| ------------------- | ------------ | -------- | ---------------------------------------------------------------- |
| `prompt`            | string       | yes      | The task for the agent                                           |
| `description`       | string       | yes      | Short 3-5 word summary (shown in UI)                             |
| `subagent_type`     | string       | yes      | Agent type (built-in or custom)                                  |
| `model`             | string       | no       | Model — `provider/modelId` or fuzzy name (`"haiku"`, `"sonnet"`) |
| `thinking`          | string       | no       | Thinking level: off, minimal, low, medium, high, xhigh           |
| `max_turns`         | number       | no       | Max agentic turns. Omit for unlimited (default)                  |
| `run_in_background` | boolean      | no       | Run without blocking                                             |
| `resume`            | string       | no       | Agent ID to resume a previous session                            |
| `inherit_context`   | boolean      | no       | Fork parent conversation into agent                              |

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
Changes persist across pi restarts (see [Persistent Settings](#persistent-settings)).

### `/subagents:sessions`

Pick any subagent — running, or completed with its live session already released — and read its full session transcript in pi's native per-entry viewer.
Read-only: no steering, no session takeover (steering lives in the `steer_subagent` tool and the background widget).

Creating and editing agent definitions is not a command — write an agent `.md` file in your editor, or ask a pi session to generate one (see [Custom Agents](#custom-agents)).

## Graceful Max Turns

Instead of hard-aborting at the turn limit, agents get a graceful shutdown:

1. At `max_turns` — steering message: *"Wrap up immediately — provide your final answer now."*
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

## Persistent Settings

Runtime tuning values set via `/subagents:settings` (max concurrency, default max turns, grace turns, the two session-retention windows, and the abort-on-interrupt policy) persist across pi restarts.
A completed subagent's record is kept for the whole parent session (so `get_subagent_result` never misses); only its heavy in-memory session is released — after `consumedSessionRetentionMinutes` once the result has been collected, or after the `unconsumedSessionRetentionMinutes` safety cap if it never was.
Two files, merged on load:

- **Global:** `~/.pi/agent/subagents.json` — your machine-wide defaults.
  Edit by hand; the `/subagents:settings` command never writes here.
- **Project:** `<cwd>/.pi/subagents.json` — per-project overrides.
  Written by `/subagents:settings`.

**Precedence:** project overrides global on any field present in both.
Missing fields fall back to the hardcoded defaults (max concurrency `4`, default max turns unlimited, grace turns `5`, consumed-session retention `10` minutes, unconsumed-session retention `720` minutes, abort-all-on-interrupt `true`).

**Example — global defaults for a beefy machine:**

```bash
mkdir -p ~/.pi/agent
cat > ~/.pi/agent/subagents.json <<'EOF'
{
  "maxConcurrent": 16,
  "graceTurns": 10,
  "unconsumedSessionRetentionMinutes": 1440,
  "abortAllOnInterrupt": false
}
EOF
```

Every project now starts with concurrency 16, grace 10, and ESC left to the parent, without ever touching the command.
Individual projects can still override via `/subagents:settings`.

**Failure behavior:** missing file is silent; malformed JSON logs a `[pi-subagents] Ignoring malformed settings at …` warning to stderr; invalid/out-of-range field values are dropped per-field; write failures downgrade the `/subagents:settings` toast to a warning with `(session only; failed to persist)`.

### Abort on interrupt

By default, pressing ESC to interrupt the parent agent also aborts every subagent.
Set `abortAllOnInterrupt` to `false` (or flip it from `/subagents:settings`) to keep background and queued subagents running when you interrupt the parent — useful when you spawn long background work and then want to steer the parent without losing it.

A foreground agent aborts on ESC regardless of this setting.
It holds the parent's own run signal for the duration of its blocking tool call, so the interrupt reaches it directly; the policy governs background and queued agents.

The policy is read at the moment ESC fires, so flipping it mid-session applies to the very next interrupt.

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
Children now always inherit the parent's skills and extensions, so the `isolated`, `extensions`, and `skills` frontmatter keys no longer exist.

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

## Architecture

This extension is a minimal, composable core: it owns agent spawning, execution, and result retrieval, and exposes a typed `SubagentsService` plus lifecycle events that other extensions build on.

See [`docs/architecture/architecture.md`](./docs/architecture/architecture.md) for the full architecture document — design principles, domain decomposition, module dependency flow, Mermaid diagrams, and the improvement roadmap.

## Relationship to upstream

This package is an independently maintained hard fork of [`tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents) by [@tintinweb](https://github.com/tintinweb).
It has diverged substantially in scope and architecture: a minimal core with a typed service API and lifecycle events, with tool-restriction policy and worktree isolation delegated to companion packages.
Upstream remains the batteries-included option, keeping scheduling, cross-extension RPC, model-scope enforcement, and a built-in tool denylist in a single package.

See [Comparison with upstream](./docs/comparison-with-upstream.md) for a full feature-by-feature comparison against the current upstream release and guidance on which to choose.

## License

MIT — [tintinweb](https://github.com/tintinweb) (upstream) and [Chris Lasher](https://github.com/gotgenes) (fork)
