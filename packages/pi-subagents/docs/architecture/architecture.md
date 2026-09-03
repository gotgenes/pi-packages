# Architecture

This document describes the architecture of the pi-subagents fork: a focused, composable core with a stable API boundary that other extensions can build on.

## Design principles

1. **Narrow core** — the extension owns agent spawning, execution, and result retrieval.
   Everything else is a consumer.
2. **Composable by default** — other extensions can spawn agents, observe their lifecycle, and display their state without importing this package directly.
3. **Typed API boundary** — this package exports a `SubagentsService` interface and `Symbol.for()` accessors (`publishSubagentsService` / `getSubagentsService`).
   Consumers declare this package as an optional peer dependency and use dynamic import for compile-time types.
   The runtime bridge is `Symbol.for("@gotgenes/pi-subagents:service")` on `globalThis` — no separate API package.
4. **No time-based scheduling** — cron-style timed dispatch (upstream's `schedule.ts` subsystem) is removed from the core (#52).
   Timed dispatch is a separate concern that any extension can implement by calling `spawn()` on the published API.
   The max-concurrent admission gate is not scheduling in this sense — concurrency management stays in core.
5. **UI is an in-core, substitutable consumer** — [ADR-0004](../decisions/0004-reconsider-ui-direction.md) records the per-component decision: the widget shrinks to background agents only, the bespoke conversation viewer is replaced by native session navigation, the `/agents` command is dissolved into focused surfaces, and the surviving UI stays in the core as a reactive consumer (not extracted to a separate package).
   Extraction remains an available future option because the composition invariant holds — the core is byte-for-byte identical with or without a given UI consumer.
6. **Snapshot, don't capture** — mutable parent state (ctx, session, model) is read once at spawn time and frozen into a `ParentSnapshot` data object.
   No live references survive past the spawn call.
7. **Subscribe, don't thread** — observation of agent progress uses direct session-event subscription, not callback parameters threaded through multiple layers.
8. **Construct complete** — objects are born with all their dependencies.
   If state isn't available yet, the object that needs it doesn't exist yet.
   No post-construction field writes from external code — if an object can't be instantiated ready-to-go, the prep work hasn't been done and the right dependencies haven't been identified.
9. **State owns its mutations** — mutable state lives in a class whose methods enforce valid transitions and invariants.
   Free functions that mutate module-scoped variables, closure-captured bags-of-functions, and external writes to shared interfaces are replaced by classes that encapsulate the state they manage.
10. **Open for extension, closed for modification** — pi-subagents is a minimal core that publishes events and a service API.
    Other packages (pi-permission-system, a future UI extension, hypothetical OTel integration) hook into these events to add permissions, rendering, or telemetry.
    Pi-subagents has zero knowledge of its consumers — dependency arrows point inward, never outward.

## Scope and non-goals

The README carries a short charter for the boundaries that come up most often.
This is the full inventory, with the decision record or design principle each rests on.

| Non-goal                                                                      | Rests on                                                                                             |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Time-based scheduling (cron / interval / one-shot dispatch)                   | Design principle 4; `history/phase-2-remove-scheduling.md`                                           |
| Ad-hoc cross-extension event RPC (`subagents:rpc:*`)                          | Design principle 3; §"What the core dropped"                                                         |
| Group-join / consolidated completion notifications                            | §"What the core dropped"; `history/phase-3-remove-rpc-groupjoin.md`                                  |
| Model-scope enforcement (an `enabledModels` allowlist in the core)            | `docs/comparison-with-upstream.md` only — the weakest entry here                                     |
| Per-agent tool restriction policy (`disallowed_tools`, a built-in denylist)   | [ADR-0002](../decisions/0002-extensions-on-a-minimal-core.md); §"Child tool selection"               |
| Widening a child's tool allowlist on the agent's behalf                       | §"Child tool selection"; operator position on the additive-key case                                  |
| A global run-mode default                                                     | Operator position; per-agent `run_in_background` already exists                                      |
| Worktree / environment isolation in the core                                  | [ADR-0002](../decisions/0002-extensions-on-a-minimal-core.md) §"What leaves the core"                |
| Persistent agent memory (`memory:`) and skill preloading (`skills:`)          | [ADR-0002](../decisions/0002-extensions-on-a-minimal-core.md); comparison doc                        |
| Per-agent extension lifecycle control (`isolated`, `extensions:`, `noSkills`) | [ADR-0002](../decisions/0002-extensions-on-a-minimal-core.md) and its amendment                      |
| New generative provider seams without a concrete consumer                     | [ADR-0002](../decisions/0002-extensions-on-a-minimal-core.md) §"The governing rule: no vacant hooks" |
| In-viewer steering or interactive child-session takeover                      | [ADR-0004](../decisions/0004-reconsider-ui-direction.md) Addendum criteria 1 and 2                   |
| Bespoke transcript rendering in the core                                      | [ADR-0004](../decisions/0004-reconsider-ui-direction.md) Decision B                                  |
| Agent-definition authoring UI (wizard, config editor, `/agents` menu)         | [ADR-0004](../decisions/0004-reconsider-ui-direction.md) Decision C                                  |
| Duplicating foreground progress in the above-editor widget                    | [ADR-0004](../decisions/0004-reconsider-ui-direction.md) Decision A                                  |
| Propagating the parent's `pi -e <path>` ephemeral extensions to children      | [ADR-0001](../decisions/0001-deferred-patches.md), now superseded — restate before citing            |

Extracting the surviving UI to a separate package is a **not now with criteria**, not a decline: [ADR-0004](../decisions/0004-reconsider-ui-direction.md) Decision D names the revisit conditions.

The following are **not** boundaries.
Pi's client-server split is a deferral pending an upstream capability (`docs/architecture/client-server-opportunities.md`), not a declined direction.
The parity status of the SDK `spawn()` path against the tool path, the stability guarantee carried by the lifecycle event payloads, parent-data redaction for SDK-spawned children, and ownership of `get_subagent_result` presentation are all unstated rather than settled.
`SubagentRecord`'s own guarantee is no longer among them: [decision 0005](../decisions/0005-subagent-record-admission-policy.md) settles what the public snapshot admits and which direction the contract runs.

The reimplement-don't-merge contribution pattern, applied across eight closed pull requests, is a repo-wide process rather than a scope boundary, and is documented in the repository's [contributing guide](https://github.com/gotgenes/pi-packages/blob/main/CONTRIBUTING.md).

## Domain model

The extension is organized around six domains, each responsible for one aspect of managing agents.

```mermaid
flowchart TB
    subgraph config["Config domain"]
        direction TB
        AgentTypeRegistry["AgentTypeRegistry<br/>(registry of agent types)"]
        DefaultAgents["default-agents<br/>(built-in types)"]
        CustomAgents["custom-agents<br/>(user .md files)"]
        InvocationConfig["invocation-config<br/>(per-call merge)"]
        ThinkingLevelModule["thinking-level<br/>(level vocabulary)"]
    end

    subgraph session["Session domain"]
        direction TB
        SessionConfig["assembleSessionConfig<br/>(pure assembler)"]
        Prompts["prompts<br/>(system prompt)"]
        Context["context<br/>(parent history)"]
        Env["env<br/>(git/platform)"]
        ModelResolver["model-resolver<br/>(fuzzy match)"]
        ProviderInheritance["provider-inheritance<br/>(replay parent providers)"]
    end

    subgraph lifecycle["Lifecycle domain"]
        direction TB
        SubagentManager["SubagentManager<br/>(spawn, abort, collection)"]
        ConcurrencyLimiter["ConcurrencyLimiter<br/>(thunk admission gate)"]
        CreateSubagentSession["createSubagentSession<br/>(assembly factory)"]
        SubagentSession["SubagentSession<br/>(turn loop, steer, dispose)"]
        Subagent["Subagent<br/>(status, behavior: abort/steer/run lifecycle)"]
        ParentSnapshot["ParentSnapshot<br/>(frozen parent state)"]
        Workspace["workspace<br/>(provider seam: child cwd + teardown)"]
    end

    subgraph observation["Observation domain"]
        direction TB
        RecordObserver["record-observer<br/>(stats + live activity via events)"]
        Notification["notification<br/>(completion nudges)"]
    end

    subgraph tools["Tools domain"]
        direction TB
        AgentTool["subagent tool<br/>(dispatch)"]
        ResultRenderer["result-renderer<br/>(pure rendering)"]
        SpawnConfig["spawn-config<br/>(resolve params)"]
        FgRunner["foreground-runner"]
        BgSpawner["background-spawner"]
        GetResult["get_subagent_result"]
        Steer["steer_subagent"]
    end

    subgraph ui["UI domain"]
        direction TB
        Widget["agent-widget<br/>(live status)"]
        Sessions["session-navigator<br/>(session view)"]
        Settings["subagents-settings<br/>(settings command)"]
    end

    AgentTool --> SubagentManager
    SubagentManager --> Subagent
    Subagent --> CreateSubagentSession & SubagentSession
    CreateSubagentSession --> SubagentSession
    CreateSubagentSession --> SessionConfig
    SessionConfig --> AgentTypeRegistry
    SessionConfig --> Prompts & Env
    AgentTypeRegistry --> DefaultAgents & CustomAgents
    SpawnConfig --> InvocationConfig & ThinkingLevelModule
    CustomAgents --> ThinkingLevelModule
    RecordObserver -.->|subscribes| SubagentSession
    Widget -.->|polls| SubagentManager
    SubagentManager -.->|notifies| Widget
```

### Key domain types

```mermaid
classDiagram
    class Subagent {
        +id: string
        +type: SubagentType
        +description: string
        +isBackground: boolean
        -state: SubagentState
        -execution: SubagentExecution
        +status: SubagentStatus
        +result?: string
        +error?: string
        +toolUses: number
        +lifetimeUsage: LifetimeUsage
        +subagentSession?: SubagentSession
        +toolCallId?: string
        +markRunning() delegates
        +markCompleted() delegates
        +isActive(): boolean
        +isTerminalError(): boolean
        +isRunning(): boolean
        +canBeSteered(): boolean
        +run()
        +resume(prompt, signal)
        +abort(): boolean
        +waitUntilSettled(signal): Promise~void~
        +steer(message): Promise~SteerOutcome~
        +isSessionReady(): boolean
        +getConversation(): string | undefined
        +getContextPercent(): number | null
        +subscribeToUpdates(fn): unsub | undefined
        +messages: readonly unknown[]
        +completeRun(result)
        +failRun(err)
        +completeResume(result)
        +failResume(err)
        +disposeSession()
    }

    class SubagentState {
        +status: SubagentStatus
        +result?: string
        +error?: string
        +startedAt: number
        +completedAt?: number
        +toolUses: number
        +lifetimeUsage: LifetimeUsage
        +compactionCount: number
        +markRunning() ... markStopped()
        +resetForResume()
        +incrementToolUses()
        +addUsage(delta)
        +incrementCompactions()
        +isActive(): boolean
        +isTerminalError(): boolean
        +isRunning(): boolean
        +canBeSteered(): boolean
    }

    class SubagentExecution {
        +createSubagentSession(params)
        +snapshot: ParentSnapshot
        +prompt: string
        +baseCwd: string
        +observer?: SubagentLifecycleObserver
        +getRunConfig?()
        +getWorkspaceProvider?()
        +model?, maxTurns?, thinkingLevel?
        +parentSession?, signal?
    }

    class SubagentManager {
        -registry: SpawnTypeResolver
        +spawn(snapshot, type, prompt, config)
        +spawnAndWait(snapshot, type, prompt, config)
        +resume(id, prompt, signal)
        +getRecord(id): Subagent
        +listAgents(): Subagent[]
        +abort(id)
    }

    class AgentTypeRegistry {
        +resolveType(type): string
        +resolveAgentConfig(type): AgentConfig
        +reload()
        +getToolNamesForType(type): string[]
    }

    class ParentSnapshot {
        +cwd: string
        +systemPrompt: string
        +model: Model~any~ | undefined
        +modelRegistry: ModelRegistry
        +parentContext?: string
    }

    class SubagentsService {
        +spawn(type, prompt, options?)
        +getRecord(id): SubagentRecord
        +listAgents(): SubagentRecord[]
        +abort(id)
        +steer(id, message)
        +waitForAll()
        +hasRunning(): boolean
    }

    SubagentManager --> Subagent : creates/manages
    Subagent --> SubagentState : owns (private)
    Subagent --> SubagentExecution : runs via (mandatory)
    SubagentManager --> ParentSnapshot : receives at spawn
    SubagentsService --> SubagentManager : wraps via adapter
    SubagentManager --> AgentTypeRegistry : resolves types
```

## Agent lifecycle

```mermaid
stateDiagram-v2
    [*] --> queued : spawn (background, at capacity)
    [*] --> running : spawn (foreground or under limit)
    queued --> running : capacity available
    queued --> stopped : stopQueued() — never started
    running --> completed : all turns finished
    running --> error : unhandled exception
    running --> aborted : max turns reached
    running --> stopped : abort() called
    running --> steered : steer message injected
    steered --> running : continues with message
    completed --> running : resetForResume
    stopped --> running : resetForResume
    error --> running : resetForResume
    aborted --> running : resetForResume
    completed --> [*]
    error --> [*]
    aborted --> [*]
    stopped --> [*]

    note right of running
        markCompleted, markAborted,
        markSteered, and markError
        are no-ops when status is stopped
    end note
```

Note: `markStopped` always succeeds regardless of current status.
Other terminal transitions guard against overwriting `stopped` — once an agent is stopped, only `resetForResume` can return it to `running`.
`stopQueued` composes `markStopped` with a never-started marker and, like `completeRun`/`failRun`, notifies the lifecycle observer — so a queued stop publishes the same events, session entry, and nudge a running stop does.

## Execution flow

```mermaid
sequenceDiagram
    participant LLM as Parent LLM
    participant Tool as subagent tool
    participant Spawn as spawn-config
    participant Mgr as SubagentManager
    participant Ag as Subagent
    participant Factory as createSubagentSession
    participant Asm as assembleSessionConfig
    participant Sub as SubagentSession
    participant Child as Child session

    LLM->>Tool: subagent(type, prompt, ...)
    Tool->>Spawn: resolveSpawnConfig(params)
    Spawn-->>Tool: ResolvedSpawnConfig
    Tool->>Mgr: spawn(snapshot, type, prompt, config)
    Mgr->>Ag: run()
    Ag->>Factory: createSubagentSession(params, deps)
    Factory->>Asm: assembleSessionConfig(type, ctx, opts, env, registry, io)
    Asm-->>Factory: SessionConfig
    Factory->>Child: create session + bind extensions
    Factory-->>Ag: SubagentSession (born complete)
    Note over Ag: record-observer subscribes to session events
    Ag->>Sub: runTurnLoop(prompt, opts)
    Sub->>Child: prompt + drive turn loop
    Child-->>Sub: result text
    Sub-->>Ag: TurnLoopResult
    Ag-->>Mgr: update Subagent
    Mgr-->>Tool: Subagent
    Tool-->>LLM: formatted result
    Note over Mgr: disposeSession() fires `disposed` at cleanup (resume-detectable)
```

## Module organization

The extension's source files are organized into domain directories — `config/`, `session/`, `lifecycle/`, `observation/`, `service/`, `tools/`, `ui/`, and `handlers/` — plus a handful of root-level entry-point and shared modules.

### Current layout

```text
src/
├── index.ts                        entry point, tool registration, event wiring
├── runtime.ts                      SubagentRuntime factory (session-scoped state)
├── types.ts                        shared type definitions
├── settings.ts                     SettingsManager (persistent operational settings)
├── debug.ts                        debug logging utility
├── layered-settings.ts             loadLayeredSettings helper (published as @gotgenes/pi-subagents/settings)
│
├── config/                         agent type definitions and resolution
│   ├── agent-types.ts              AgentTypeRegistry class
│   ├── default-agents.ts           built-in agent configs (general-purpose, Explore, Plan)
│   ├── custom-agents.ts            user-defined agent .md file loader
│   ├── invocation-config.ts        per-call config merge (caller wins unless `locked`); background-mode resolution
│   └── thinking-level.ts           thinking-level vocabulary and parser, wider than pi-ai's `ThinkingLevel`
│
├── session/                        session assembly and preparation
│   ├── session-config.ts           pure assembler (main entry)
│   ├── prompts.ts                  system prompt building; inherits only the parent prompt's identity, cutting the session-resolved tail (ADR 0006)
│   ├── ask-back.ts                 the marker a child declares a question with, and its parser (fence-aware, last block wins)
│   ├── content-items.ts            shared message content parsing (tool-call names, assistant content)
│   ├── context.ts                  parent conversation extraction
│   ├── conversation.ts             render a session's messages as formatted text
│   ├── env.ts                      git/platform detection
│   ├── model-resolver.ts           fuzzy model name resolution
│   ├── package-exclusions.ts       child settings view that disables excluded packages' extensions
│   ├── provider-inheritance.ts     replays the parent's runtime-registered providers onto the child's own runtime, so the child inherits them without sharing the parent's mutable pool
│   └── session-dir.ts              session directory derivation
│
├── lifecycle/                      agent execution and state tracking
│   ├── subagent-manager.ts         collection manager + observer wiring + consumption-aware session-retention sweep
│   ├── create-subagent-session.ts  assembly factory: session creation, spawn-tool denylist, binding
│   ├── subagent-session.ts         born-complete child session: turn loop, steer, shutdown-then-dispose teardown
│   ├── turn-limits.ts              normalizeMaxTurns (turn-count policy)
│   ├── subagent.ts                 owns full execution lifecycle (run, resume, abort, steer, wait-until-settled)
│   ├── subagent-state.ts           lifecycle status + metrics + result-delivery value object (transitions, accumulators, classification predicates); delivery carries a revocable carrier claim and a one-way consumption latch
│   ├── run-listeners.ts            per-run observer-unsub and signal-detach handles
│   ├── workspace-bracket.ts        child workspace prepare/dispose lifecycle; idempotent dispose, reports a torn-down workspace
│   ├── concurrency-limiter.ts       background admission gate: schedules run thunks FIFO against the limit
│   ├── parent-snapshot.ts          immutable spawn-time parent state
│   ├── child-lifecycle.ts          child-execution lifecycle event publisher
│   ├── child-shutdown.ts           bounded session_shutdown emit for a child being disposed
│   ├── workspace.ts                workspace provider seam (generative extension surface)
│   └── usage.ts                    token usage tracking
│
├── observation/                    progress tracking and notification
│   ├── record-observer.ts          session-event stats observer
│   ├── notification.ts             completion nudges (announce-only; gated on the carrier claim, withheld during the parent's agent run, flushed on agent_settled)
│   ├── outcome-delivery.ts         shared outcome rendering every result carrier composes: one status vocabulary in two presentations, body, ask-back affordance
│   ├── renderer.ts                 notification TUI component
│   ├── composite-subagent-observer.ts fans manager notifications out to multiple observers
│   └── subagent-events-observer.ts manager lifecycle observer (event emission + persistence + notification)
│
├── service/                        cross-extension API boundary
│   ├── service.ts                  SubagentsService interface + Symbol.for() accessors
│   └── service-adapter.ts          SubagentsServiceAdapter class wrapping SubagentManager
│
├── tools/                          LLM-facing tool implementations
│   ├── agent-tool.ts               subagent tool definition, validation, dispatch
│   ├── result-renderer.ts          pure per-status result rendering
│   ├── spawn-config.ts             pure config resolution
│   ├── foreground-runner.ts        foreground execution loop
│   ├── background-spawner.ts       background spawn setup
│   ├── get-result-tool.ts          get_subagent_result tool
│   ├── get-result-report.ts        pure get_subagent_result report formatter
│   ├── steer-tool.ts               steer_subagent tool
│   └── helpers.ts                  shared tool utilities
│
├── ui/                             user-facing presentation
│   ├── agent-widget.ts             above-editor live status widget
│   ├── widget-renderer.ts          pure rendering for widget
│   ├── display.ts                  pure formatters and shared types
│   ├── glyphs.ts                   semantic display-glyph vocabulary (monospace-coverage constraint, #669)
│   ├── subagents-settings.ts       /subagents:settings command handler
│   ├── session-navigation.ts       pure session-selection and transcript-source logic
│   ├── session-navigator.ts        /subagents:sessions command handler
│   └── transcript-content.ts       transcript rows: per-message component blocks, width-cached (settles incrementally against Pi's state-before-listeners ordering, #689)
│
└── handlers/                       event handlers
    ├── index.ts                    barrel re-export
    ├── interrupt.ts                turn_start handler — abort all subagents on parent interrupt (ESC), when policy allows
    ├── lifecycle.ts                session_start, session_before_switch, session_shutdown
    └── widget-events.ts            widget's host events — session_start (UI context), turn_start (linger aging), session_shutdown (teardown)
```

### Observation model

Record statistics (tool uses, token usage, compaction counts) and live activity (active tools, response text, turn counts) are updated by `record-observer.ts`, which subscribes directly to session events.
This is the single per-child session subscription — all run state lives on the `Subagent` record.

The widget reads agent state by polling the records exposed via `SubagentManager.listAgents()` every 80 ms; that poll loop is now started by the manager's lifecycle notifications (the widget subscribes as a `SubagentManagerObserver` fanned out through `CompositeSubagentObserver`), not by inbound calls from the spawn tools.
The `/subagents:sessions` navigator reads messages via `Subagent.agentMessages` and subscribes to updates via `Subagent.subscribeToUpdates()` — no direct `AgentSession` reference (#277).

## Cross-extension architecture

```mermaid
flowchart TD
    subgraph core["@gotgenes/pi-subagents"]
        direction TB
        exports["SubagentsService API<br/>publish / getSubagentsService<br/>SubagentRecord, SubagentStatus"]
        engine["Tools: subagent, get_subagent_result,<br/>steer_subagent<br/>SubagentManager, createSubagentSession, SubagentSession"]
        ui_int["Internal UI: widget, session-navigator,<br/>subagents-settings"]
    end

    core -- "Symbol.for on globalThis" --> sched["scheduling extension<br/>(hypothetical)"]
    core -- "Symbol.for on globalThis" --> subui["pi-subagents-ui<br/>(deferred)"]
    core -- "Symbol.for on globalThis" --> future["any future extension"]
```

Consumers call `getSubagentsService()?.spawn(...)` at runtime.
They declare this package as an optional peer dependency and use dynamic import for compile-time types.

### What the core owns

- The three tools: `subagent` (née `Agent`), `get_subagent_result`, `steer_subagent`.
- `SubagentManager` — spawn, abort, resume, collection management, observer wiring.
- `ConcurrencyLimiter` — background admission gate: schedules run thunks FIFO against a configurable concurrency limit.
- `createSubagentSession` — assembly factory: session creation and extension binding; returns a born-complete `SubagentSession`.
- `SubagentSession` — the born-complete child session: drives the turn loop (`runTurnLoop`/`resumeTurnLoop`), steers, and disposes (firing `disposed` at true session disposal, so resume executions are registry-detected).
- `child-lifecycle` — publishes the child-execution lifecycle (`spawning`, `session-created` before `bindExtensions()`, `bound` after it resolves, `completed`, `disposed`) on `pi.events`.
  Reactive consumers subscribe: `@gotgenes/pi-permission-system` registers each child session on `session-created`, audits it for a permission node of its own on `bound`, and unregisters it on `disposed`.
  This replaced the former outbound `permission-bridge` (#261, [ADR-0002]) — the core no longer looks up a named consumer.
- `workspace` — the single generative seam (#262, [ADR-0002]): a registered `WorkspaceProvider` supplies a child's cwd plus bracketed `dispose()` at run-start.
  With no provider, children run in the parent cwd (default unchanged); the git worktree strategy lives behind this seam in `@gotgenes/pi-subagents-worktrees` (#263, the seam's first consumer).
- `session-config` — pure configuration assembler (called by `createSubagentSession`).
- `SubagentRuntime` — session-scoped state bag with methods.
- `ParentSnapshot` — immutable snapshot of parent session state, captured once at spawn time.
- `record-observer` — session-event observer that updates record statistics without callback threading.
- Agent type registry — default agents, custom `.md` file loading.
- Prompt assembly, context extraction, skills, environment.
- Worktree isolation — evicted to `@gotgenes/pi-subagents-worktrees` via the workspace provider seam in Phase 16 (#263, [ADR-0002]); `git` no longer appears in the core.
- Token usage tracking.
- Session directory derivation and persisted `SessionManager` for subagent transcripts.
- Settings persistence.
- Internal UI (widget, `/subagents:sessions` session navigator, `/subagents:settings` command) — the conversation viewer and `/agents` menu were removed in Phase 19 (Steps 5–6, [#442], [#441]) per [ADR-0004].

### Child tool selection

A child's tool set is exactly its agent type's `tools:` list, which `createSubagentSession` hands to the SDK as the session's tool allowlist.
Pi applies that allowlist _before_ it builds the session's tool registry, so an extension loaded in the child registers its tools successfully and they are then filtered out unless the agent named them.
Naming an extension tool in `tools:` is therefore the supported way to give a child access to it, and the documented one ([Configuration](../configuration.md#tool-selection)).

The core does not widen this on the agent's behalf.
Inheriting every extension tool a child registers would hand a read-only agent whatever write-capable tools the parent's extensions happen to publish — a capability decision that belongs to whoever writes the agent file, expressed per agent, not a default.
Tool _restriction_ beyond that stays with `@gotgenes/pi-permission-system`, per [ADR-0002].

The recursion guard is the one name set the core removes unconditionally.
It reaches the SDK as the `excludeTools` denylist, which Pi reapplies on every tool-registry rebuild; filtering the active set once after `bindExtensions` was undone by the next rebuild.

### What the core dropped

- **Scheduling** (`schedule.ts`, `schedule-store.ts`, `ui/schedule-menu.ts`) — removed (#52).
- **Ad-hoc RPC** (`cross-extension-rpc.ts`) — replaced by the typed `SubagentsService` published via `Symbol.for()` (#49).
- **Group join** (`group-join.ts`) — removed (#49).
- **Output file** (`output-file.ts`) — replaced by `session-dir.ts` + `SessionManager.create()` (#61).
- **Callback threading** — the three-layer `on*` callback chain was replaced by direct session-event subscriptions (#100).
- **Live `ctx` capture** — replaced by `ParentSnapshot`, an immutable data object captured once at spawn time (#99).

## SubagentsService

The `SubagentsService` interface, accessor functions, and serializable types are exported from `@gotgenes/pi-subagents` via the `./service` export map entry.
No separate API package is needed.

Consumers declare this package as an optional peer dependency:

```json
{
  "peerDependencies": {
    "@gotgenes/pi-subagents": ">=5.0.0"
  },
  "peerDependenciesMeta": {
    "@gotgenes/pi-subagents": { "optional": true }
  }
}
```

At runtime, consumers use dynamic import for type-safe access to the accessor functions:

```typescript
const { getSubagentsService } = await import("@gotgenes/pi-subagents");
const svc = getSubagentsService();
if (svc) {
  svc.spawn("Explore", "Check for stale TODOs");
}
```

Pi's extension loader creates a fresh `jiti` instance per extension with `moduleCache: false`, so module-scoped singletons don't survive across extensions.
The accessor functions use `Symbol.for("@gotgenes/pi-subagents:service")` on `globalThis`, which is process-global by spec, to bridge this gap.
The dynamic import provides compile-time types; the `Symbol.for()` key is the actual runtime channel.

### Interface

See `src/service.ts` for the canonical definition.
Key types:

- `SubagentsService` — `spawn`, `getRecord`, `listAgents`, `abort`, `steer`, `waitForAll`, `hasRunning`.
- `SubagentRecord` — serializable by-value agent snapshot; admission policy in [decision 0005](../decisions/0005-subagent-record-admission-policy.md).
- `SpawnOptions` — `description`, `model`, `maxTurns`, `thinkingLevel`, `inheritContext`, `foreground`, `bypassQueue`.
- `SUBAGENT_EVENTS` — channel constants for `pi.events` subscriptions.

### Accessor pattern

```typescript
const SERVICE_KEY = Symbol.for("@gotgenes/pi-subagents:service");

export function publishSubagentsService(service: SubagentsService): void {
  (globalThis as Record<symbol, unknown>)[SERVICE_KEY] = service;
}

export function getSubagentsService(): SubagentsService | undefined {
  return (globalThis as Record<symbol, unknown>)[SERVICE_KEY] as
    | SubagentsService
    | undefined;
}
```

If Pi gains a native service registry ([earendil-works/pi#4207]), these accessors can be updated to delegate to `pi.registerService()` / `pi.getService()` internally while keeping the same consumer API.

### Lifecycle events

The core emits events on `pi.events` that any extension can observe:

| Channel               | Payload                                                                             | When                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `subagents:started`   | `{ id, type, description }`                                                         | Agent begins running                                                                      |
| `subagents:completed` | `{ id, type, description, status, result?, error?, toolUses, durationMs, tokens? }` | Agent finishes successfully                                                               |
| `subagents:failed`    | same as `completed` (`buildEventData` shape)                                        | Agent ends in `error`/`stopped`/`aborted`                                                 |
| `subagents:resumed`   | same as `completed` (`buildEventData` shape)                                        | Resumed run reaches a terminal state (`completed`/`error`); `status`/`error` discriminate |
| `subagents:compacted` | `{ id, type, description, reason, tokensBefore, compactionCount }`                  | Child session compacts                                                                    |
| `subagents:created`   | `{ id, type, description, isBackground }`                                           | Background agent created (pre-admission)                                                  |
| `subagents:steered`   | `{ id, message }`                                                                   | Steering message delivered to a running agent                                             |

These are fire-and-forget broadcast events — no request IDs, no reply channels.

## Architecture direction

pi-subagents **is** a minimal orchestrator with inverted dependencies.
The core spawns a child session derived from the parent, runs the turn loop, tracks and streams and collects the result, gates concurrency, supports resume, and **publishes its lifecycle**.
Everything else — permissions, worktree/workspace isolation, UI, telemetry — is an extension that attaches through one of two surfaces and never reaches into the core.
This inversion landed across Phases 14, 16, 18, and 19; the sections below describe the resulting boundary and the deeper direction still being sharpened.

The rationale and the full reasoning chain that led here are recorded in [`docs/decisions/0002-extensions-on-a-minimal-core.md`](../decisions/0002-extensions-on-a-minimal-core.md).

A separate, longer-horizon note — [`client-server-opportunities.md`](./client-server-opportunities.md) — records what Pi's eventual client-server split (Mario Zechner's session-sync unification) would unlock for pi-subagents: viewing live subagent sessions, viewing suspended ones, and operators interacting with a subagent through an editor.
That architecture is not on the near-term roadmap; the note captures the opportunity so it is on record.

### Two extension surfaces

Extensions attach through exactly two surfaces, distinguished by the direction of information flow.

1. **Lifecycle events (observational) — unlimited.**
   The core emits awaited, ordered events for the child-execution lifecycle (`spawning`, `session-created` pre-`bindExtensions`, `bound` post-`bindExtensions`, `completed`, `disposed`).
   Any number of extensions subscribe; handlers return nothing.
   Reactive concerns live here: permission detection, telemetry, UI, notifications.
   Adding a reactive concern never modifies the core.
2. **Provider seams (generative) — rationed.**
   The rare concern that must _inject_ a value the core consumes synchronously registers a provider the core consults.
   Today there is exactly one: the **workspace provider** (returns the child's working directory plus bracketed setup/teardown).
   A provider seam is the only place the core is "open," so the list is kept as small as possible.

The discriminator when deciding how a concern attaches:

- It only needs to **know** what happened → subscribe to a lifecycle event (observational, unlimited).
- It must **return a value the core consumes** → register a provider (generative, rationed).

The governing rule — **no vacant hooks**: the architecture must _admit_ a seam without _shipping_ it until a concrete consumer exists.
A provider seam with no consumer is a speculative abstraction that taxes every reader and that `fallow` flags as dead.
Latent extensibility is the deliverable; a vacant hook is not.

The [first-principles refinement](#first-principles-refinement-and-the-deeper-target) below sharpens this two-surface split.
The awaited, behavior-affecting lifecycle events (notably `session-created` before `bindExtensions`) are _hooks_ — the child's own extension surface applied recursively, generative because the core waits on the handler before deciding what to do next.
The observational surface then carries only fire-and-forget broadcasts of immutable snapshots, which no consumer can use to change the core.

### Core responsibilities (keep)

- **Agent definitions** — name, model, thinking, system prompt, tools list.
- **Prompt composition** — system prompt assembly.
- **Session lifecycle** — create child sessions, bind extensions, run conversation loop, track results.
- **Concurrency management** — queue, abort, resume, max concurrency.
- **Recursion guard** — remove pi-subagents' own three tools from child sessions (prevent infinite nesting).
  With `isolated` removed (#264), the guard is unconditional for every child that reaches binding, rather than gated on `cfg.extensions`.
  This is the core defending its own invariant, keyed off its own tool names — not policy.
- **Package-extension exclusion** — filter the child's package view by the `excludedExtensionPackages` setting before resource loading, so an excluded package's extensions are never imported in children (#696).
  Resolved at the composition root; the assembly factory receives a ready-made settings view and holds no policy.
- **Lifecycle events** — emit awaited, ordered events when child sessions spawn, are created, complete, and are disposed.
- **Workspace provider seam** — accept a registered `WorkspaceProvider` and consult it for the child's cwd; default to the parent's cwd when none is registered.
- **Service API** — publish `SubagentsService` via `Symbol.for()` for cross-extension access.

### Responsibilities removed from the core

These policy and environment concerns were removed so the core stays narrow; each now lives in a consumer or behind the workspace seam:

- **Tool policy** (`disallowed_tools`) and **extension filtering** (`extensions: string[]`) — access control and tool visibility belong in pi-permission-system's `permission:` frontmatter (Phase 14, #237/#238).
- **Worktree isolation** (`GitWorktreeManager`, the `isolation: "worktree"` mode) — one _strategy_ for choosing the child's cwd, evicted to `@gotgenes/pi-subagents-worktrees` (#263), the first consumer of the workspace provider seam.
- **Per-agent extension lifecycle control** (`extensions: false`, `isolated`, `noSkills`) — removed in #264; deny-at-use covers what `isolated` pretended to do for tools.
  Prevent-load ships instead as the global/project `excludedExtensionPackages` setting (#696): a provider seam was declined because no _extension_ wants to supply the policy, which would make the seam a vacant hook.

### Composition model

In the target state, pi-subagents publishes events and a provider seam; other packages hook in:

- **pi-permission-system** (observational) subscribes to child-session lifecycle events, detects subagent execution context in the child, and gates tool calls at runtime.
- **pi-subagents-worktrees** (generative) registers a `WorkspaceProvider` that prepares a git worktree at run-start and tears it down after, supplying the child's cwd.
- **pi-subagents-ui** (future, under reconsideration — see the [first-principles refinement](#first-principles-refinement-and-the-deeper-target)) subscribes to the broadcast and the query/behavior interfaces; the conversation viewer and `/agents` menu were removed in Phase 19 per [ADR-0004]; the surviving UI (widget, session navigator, settings command) stays in-core.
- **Any future extension** (OTel, auditing, cost tracking) subscribes to the same events without pi-subagents knowing.

Composition test: install neither extension, only permissions, only workspaces, or both — the core is byte-for-byte identical in all four cases, and the two extensions never reference each other.

This is achieved across phases: Phase 14 (strip policy), Phase 16 (invert dependencies — extensions on a minimal core), and Phase 18 (reconsider UI).

### First-principles refinement and the deeper target

The two-surface model above is correct but coarse.
Pushing it against our own principles — construct complete, state owns its mutations, tell-don't-ask, dependency inversion — surfaces sharper boundaries that the current code draws through the middle of classes.
This subsection records the deeper target; the steps that realize it are sequenced in later phases.

#### `Subagent` is four conflated domains

The construction duality that motivates Phase 17 — a class that is simultaneously a passive record and an executor — is only the two most visible of four domains fused into one class.
Pulling each apart by asking "who changes this, how often, and who needs to know" surfaces:

1. **Lifecycle state** — status, result, error, timestamps.
   Owned by the subagent; transitions are rare and meaningful; the right outward shape is an immutable snapshot announced on change.
2. **Metrics** — tool uses, token usage, compaction count.
   These are not lifecycle state; they are a projection aggregated over the child session's event stream.
   `record-observer` already computes them — its only error is writing the aggregate back onto the subagent.
3. **The hook surface** — the points where an extension alters or augments the child before and around its run.
   This is the child session's own extension binding (see below), not data on the subagent.
4. **Result delivery** — whether the parent has consumed the result, when to nudge, how the result reaches the caller.
   This domain now has a home: `consumedAt` is a first-class field on `SubagentState`, marked only at the parent-initiated return edges (`get_subagent_result`, foreground return, resume return); the notification layer reads it to suppress a nudge but never owns it, and the retention sweep reads it to time session release (#617).

The ~20 optional constructor fields and the runtime `run()` throws are the pressure these four domains exert on one class.
Separating them is what makes the Phase 17 steps fall out rather than fight back.

#### The subagent is a recursive Pi

A subagent is a child Pi session: created with `createAgentSession`, then `bindExtensions`.
Its extension surface is therefore Pi's extension surface applied recursively — not a bespoke event bus.
What the current doc calls "awaited, ordered lifecycle events" are not observations; they are **hooks**, structurally identical to Pi's own (`session_start`, `tool_execution_start`).
The tell is the awaiting: the core waits for the handler because the handler's completion changes what the core does next — an extension registers before the child binds.
A handler that can change subsequent behavior is generative, not observational, whatever we name the channel.

This splits the current "lifecycle events" surface cleanly in two:

1. **Broadcast** (observational, fire-and-forget) — "this happened; react if you want; you cannot change anything."
   Carries immutable snapshots for telemetry, notification, and any renderer.
   No consumer holds a live `Subagent`.
2. **Hooks** (generative, awaited, ordered) — the recursive Pi extension surface where workspace, permissions, and future concerns attach to the child.
   The `WorkspaceProvider` is one _typed_ hook; the general form is "be an extension of the child session."

The "no vacant hooks" rule still governs the generative side: admit the surface, ship a hook only when a real consumer exists.

#### Reactive versus discrete (not internal versus external)

The axis that decides push versus pull is whether a need is reactive or discrete — never whether the consumer is in-package or out.

- **Reactive** (ambient state that changes underneath you) → subscribe to the broadcast; be told.
  The state-owner announces; the consumer maintains its own read-model; nobody pulls.
- **Discrete** (a one-shot question: current value, full transcript) → pull a query.
  `get_subagent_result`, opening a transcript, and the external `SubagentsService.getRecord` are queries by nature and stay pull, in-package or not.

Behavior is a third interface: **tell by id, with outcomes**.
`steer` and `abort` own their own rules — a non-running agent rejects a steer from inside `steer`, not via a caller's status pre-check — so coordinators never ask-then-tell.

#### Consequences

Two consequences fell straight out, and both cut scope — both have since landed.

1. **The activity/metrics push tier was provisional and is gone.**
   Its only reactive consumer was the inherited widget; treated from first principles, metrics are accumulated by an observer, exposed as a discrete query, and folded into the completion snapshot.
   Phase 18 deleted `AgentActivityTracker` and `ui-observer` and made the widget a pure reactive consumer of lifecycle events — the high-frequency stream did not need to exist.
2. **Phase 18 was "reconsider the UI," not "extract the UI."**
   The widget and `/agents` menu predated the fork; they were consumers judged on our principles, not requirements to preserve.
   [ADR-0004] recorded the per-component verdict and Phase 19 implemented it: the widget shrank to background agents, the bespoke viewer and `/agents` menu were removed, and the surviving UI stays in-core as a reactive consumer.

#### Sibling packages follow the same discipline

`@gotgenes/pi-permission-system` is one of these hooks, and it is subject to the same scrutiny.
Its boundaries deserve the same first-principles treatment: surface its conflated domains, distinguish what it observes from what it injects, and prefer being told over asking.
The recursion principle means a consumer's internal design is not exempt because it lives in another package — the same axes (reactive versus discrete, hook versus broadcast, construct complete) apply across the seam.

#### How we find these boundaries

The boundaries above were not deduced top-down; they were surfaced by friction.
Each place the target got _harder_ to test marked a domain seam drawn through the middle of a class.
That method — testability friction as a boundary probe, with its limits — is recorded in the `improvement-discovery` skill so it outlives this phase.

## Current structural analysis

### Health metrics

| Metric                     | Value                                                                   |
| -------------------------- | ----------------------------------------------------------------------- |
| Health score               | 78/100 (B), end of Phase 21                                             |
| Total LOC                  | 8,836 (63 files)                                                        |
| Dead code                  | 0 files, 0 exports                                                      |
| Maintainability index      | 91.1 (good)                                                             |
| Avg cyclomatic complexity  | 1.3                                                                     |
| P90 cyclomatic complexity  | 2                                                                       |
| Production duplication     | 0 lines                                                                 |
| Test duplication           | retired (fallow 3.2.0 excludes test files; see Phase 20 Step 9 history) |
| Fallow refactoring targets | 0                                                                       |

Recompute `Total LOC` with `find src -name '*.ts' | wc -l` and `cat $(find src -name '*.ts') | wc -l` — it counts `src/` only, so `fallow health`'s package-wide total is the wrong source.
Every other row is a `fallow health` field.

### Dependency bag inventory

The 10+-field dependency bags flagged in prior phases (`ResolvedSpawnConfig`, `AgentSpawnConfig`, `RunOptions`, `SessionConfig`, `SubagentSessionIO`, `SubagentExecution`) were all decomposed into focused value objects; the remaining wide interfaces (`NotificationDetails`, `ResourceLoaderOptions`, `CreateSessionOptions`) are DTO/SDK-boundary types accepted as-is.

### Complexity hotspots

Functions with cyclomatic complexity ≥ 21 (critical threshold):

No functions remain above the critical threshold — all hotspots resolved in Phase 12. 1 function remains at HIGH severity (a test helper, `subagent-manager.test.ts`'s `createManager`); 14 at moderate.
No `src/` function reaches HIGH severity or CRAP ≥ 60 (Phase 20 target met).

### Churn hotspots

Files with highest commit frequency × complexity:

| Score | File                          | Commits | Trend          |
| ----- | ----------------------------- | ------- | -------------- |
| 29.2  | `index.ts`                    | 112     | ▼ cooling      |
| 10.2  | `tools/agent-tool.ts`         | 60      | ▼ cooling      |
| 9.8   | `lifecycle/subagent.ts`       | 22      | ─ stable       |
| 9.0   | `ui/agent-widget.ts`          | 24      | ▼ cooling      |
| 7.9   | `service/service-adapter.ts`  | 17      | ▼ cooling      |
| 7.9   | `tools/foreground-runner.ts`  | 24      | ▼ cooling      |

`index.ts` remains the top churn hotspot but has cooled after the Phase 19 terminal cut removed its four `/agents`-wiring blocks; `lifecycle/subagent.ts` warmed from cooling to stable after Phase 21 Steps 1 and 2 both edited its status guards and resume-termination path, moving it from sixth to third; no `src/` file is currently accelerating.

### Production duplication

Production duplication is 0 lines — the last clone group was eliminated in Phase 19 Step 6 ([#441]).

## Improvement roadmap — Phase 22: Front-door contract parity and delivery fixes

### Findings (planned 2026-08-29)

Phase 22 is trigger-driven: it opens on the bug cluster surfaced by [#724]'s planning audit, not on the calendar.
The primary cause is a coupling/boundary flaw the first-principles section already names: the "Reactive versus discrete (not internal versus external)" refinement rules `SubagentsService` a first-class front door "in-package or not", but the code was never audited against that claim — the `subagent` tool door runs a config-resolution pipeline the SDK door skips entirely, and the audit found six behavioral divergences (widget invisibility, lost `parentSessionId` breaking permission forwarding, an unenforced disabled-agent block, uncanonicalized types, and more).
Four pre-filed issues express the same cause and form the spine: [#724] (parity at the manager choke point — plan already committed at `docs/plans/0724-first-class-sdk-spawns.md`), [#830] (the public snapshot's allowlist has no stated policy), [#829] (frontmatter precedence applies a guard against model guessing to deterministic callers too), and [#828] (a vacant field on the public workspace seam).
Three independent delivery-boundary defects join as side tracks ([#801], [#827], [#798]), and the operator scheduled the ask-back capability ([#465]) now that its prerequisite [#466] landed in Phase 21.

Fallow corroborates but did not source the spine: health 78/100 (B), 0 dead code, 0 duplication, 0 refactoring targets; the repeated-discriminator sweep is clean (`_status !== "stopped"` ×4 all inside the owning `subagent-state.ts`).
The craftsmanship scout found **no concentrated debt**: the fallow large-function flag on `test/settings.test.ts:312` is refuted (a healthy 17-`describe` tree of short behavior-named tests), the hot production files are well-factored linear procedures, and Phase 21's four boy-scout items persist unchanged but stay scattered — no craftsmanship step is warranted.
Phase 21 recorded no ⚠️ metric misses; its one measurement caveat carries forward — recompute the health score with the `--hotspots --targets` form (the bare `--score` form reports 88 A on this workspace and is not comparable to the 78 B baseline).

Trajectory: max step priority ran 15 (Phase 20 band) → 16 (Phase 21) → 16 (this phase), and every prior churn hotspot is cooling or stable.
The operator's cadence decision: keep the regular improvement rotation after this phase.

| Metric                                                                                           | Baseline   | Phase 22 target | Recompute                                                                                                                                               |
| ------------------------------------------------------------------------------------------------ | ---------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health score                                                                                     | 78/100 (B) | ≥ 78 (B)        | `pnpm fallow health --score --hotspots --targets --workspace @gotgenes/pi-subagents`                                                                    |
| `invocation` storage-chain and widget-filter sites (`src/lifecycle/` + `src/ui/agent-widget.ts`) | 8          | 0 ✅            | `grep -rEn 'invocation\??:\|\.invocation\b' packages/pi-subagents/src/lifecycle packages/pi-subagents/src/ui/agent-widget.ts --include='*.ts' \| wc -l` |
| Blanket `agentConfig?.<field> ?? params` precedence merges in `invocation-config.ts`             | 5          | 0 ✅            | `grep -cE 'agentConfig\?\..*\?\?' packages/pi-subagents/src/config/invocation-config.ts`                                                                |
| Foreground result text carries the resume handle (`Agent ID` in `foreground-runner.ts`)          | 0          | ≥ 1 ✅          | `grep -c 'Agent ID' packages/pi-subagents/src/tools/foreground-runner.ts`                                                                               |
| Inherited-prompt skills-block strip present in `prompts.ts`                                      | 0          | 3 ✅            | `grep -c 'available_skills' packages/pi-subagents/src/session/prompts.ts`                                                                               |
| Dead code / production duplication                                                               | 0 / 0      | 0 / 0           | `pnpm fallow dead-code --workspace @gotgenes/pi-subagents` / `pnpm fallow dupes --workspace @gotgenes/pi-subagents`                                     |

The `Agent ID` and `available_skills` rows grep for names the fix has not created yet; Steps 5 and 7 must either use those spellings or update the row in the same commit.
The `agentConfig?.` row counts the mechanism Step 3 replaces; if the adopted locked-fields shape legitimately retains a merge of that spelling, Step 3 updates the row with its rationale.
Steps 2, 6, and 8 have design-dependent shapes and are verified by their plans' pinned regression tests rather than a grep row.

#### Open-issue sweep dispositions

- [#724], [#830], [#829], [#828] — adopted as Steps 1–4 (the pre-discovered front-door cluster; [#724]'s plan is already committed).
- [#801], [#827], [#798] — adopted as Steps 5–7 (independent delivery-boundary bugs).
- [#465] — scheduled as Step 8 by operator decision (2nd sweep; its prerequisite [#466] landed in Phase 21, so it is now actionable).
- [#641] — folded into Step 3 as design input: operator-configured floors versus model-passed values is the same precedence family [#829] settles.
- [#451] — relabeled `scope:repo` and the `pkg:pi-subagents` label dropped (3rd consecutive sweep; it is repo-level CI tooling, not package structure — the relabel ends the per-phase re-sweep without losing the idea).
- [#608], [#519] — deferred with rationale (2nd sweep, explicit): [#608] is an unverified third-party integration ask whose `AsyncLocalStorage` store shape the no-vacant-hooks rule declines without a concrete verified consumer; [#519] is blocked on upstream SDK clarity and is pi-permission-system-primary.
- [#779] — deferred by operator decision (offered as a phase track and declined): boundary-ADR documentation does not gate the bug-cluster spine; note PRs #613 and #740 wait on its foreground-default record.
- [#857] — filed by Step 8's planning; becomes Step 10 by operator decision.
  `completeRun()` disposes the child's workspace and `resume()` never re-prepares it, so a workspace-backed child resumes into a torn-down directory — the same delivery-boundary family as Steps 5–7, and the bound on Step 8's round trip for exactly the agents most likely to hold a worktree.
- [#858] — filed by Step 8's planning; becomes Step 11 by operator decision.
  A child-initiated mid-run channel is the half Step 8's completed-child scope leaves open; the parent-side reply channel (`steer_subagent`) already exists, so the residual is the child's ability to pause and signal.
- [#870] — filed by Step 10's planning; becomes Step 12 by operator decision.
  Step 10 holds a question-ending child's workspace open, moving its disposal to an edge with no result text to carry `resultAddendum`; the post-result delivery channel that fixes it is a peer-sized piece of the same delivery spine, not a line in Step 10's bug fix.
- [#871] — filed by Step 11's planning; becomes Step 13 by operator decision.
  A fail-open one layer below the allowlist Step 11 appends to: `tools: none` parses to an empty list and then resolves to the full built-in set, so an author who asked for no tools receives `edit`, `write`, and `bash`.
  Independent of Step 11's own work, which appends over whatever base list resolution produces.
- [#791] — deferred by operator decision (offered and declined): small self-contained warning, suitable for pickup outside a phase.
- [#733] — deferred: TUI overlay defect requiring SDK-level rendering investigation, unrelated to this phase's cause.
- [#755], [#711], [#636], [#695], [#676], [#660] — deferred: feature/UX requests that do not gate a structural phase ([#660] overlaps [#695]/[#676]).
- [#683] — deferred: glyph-audit polish at boy-scout scale.
- [#849] — filed by Step 6's planning; adopted as Step 9 (Track C, after Step 6).
  The widget's teardown half: `AgentWidget.dispose()` has no call site, so `session_shutdown` leaves the 80 ms interval and the widget/status registrations live.
  A different mechanism from Step 6's acquisition path, so it is a peer step rather than a fold-in.
- [#834] — filed by Step 1's implementation; folded into Step 3.
  Narrowing `SubagentManagerLike.spawn`'s `unknown` options exposed a second hole the typing had hidden — neither door validates `thinking`, and Step 3 already rewrites the precedence for that exact field family on the exact line that holds the unchecked cast.
- [#793], [#792], [#722], [#735] — pi-permission-system-primary; [#564] — pi-github-tools-primary; the `pkg:pi-subagents` labels are contextual and pull no work into this phase.
- Scout inventory (all scattered, persisting from Phase 21) — remains on the `tidy-first` boy-scout path: `settings.ts` `sanitize()` range-check triplication, `mock.calls[N][idx]` indexing (17 sites, 9 files), `createManager()` observer-default merge density, `(manager as any).sweep()` private reach (7 sites, one file), and the `subagent-events-observer.ts` inline `{id, type, description}` payload triad.

### Steps

#### ✅ Step 1: Land first-class SDK spawns at the manager choke point ([#724])

**Cause:** the two front doors were never held to the same contract — `SubagentManager.spawn` is the one point both doors already traverse, but it stamps no invariants, so the tool door's resolution pipeline (canonical type, disabled-agent check, background mode, parent linkage) is skipped by the SDK door.
The widget's `record.invocation?.runInBackground` read is the symptom fallow cannot see: the manager computes background-ness five times and stores it nowhere, so a consumer reconstructs it from a display snapshot one door forgets to build.

- **Smell:** Category C (coupling/boundary flaw; scattered decision).
- **Target:** `src/lifecycle/subagent-manager.ts`, `src/lifecycle/subagent.ts`, `src/service/service-adapter.ts`, `src/tools/spawn-config.ts`, `src/tools/background-spawner.ts`, `src/ui/agent-widget.ts` — per the committed plan `docs/plans/0724-first-class-sdk-spawns.md`.
- **Outcome:** `Subagent.isBackground` is first-class record state; the widget filter reads it; SDK-spawned children carry `parentSession`; the disabled-agent block holds at the choke point; the widget-filter read drops 1 of the 8 `invocation` sites.
- **Commit type:** `fix:` — the phase's first release vehicle.
- **Impact 4 / Risk 2 / Priority 16.**

Release: independent

#### ✅ Step 2: Decide and document the `SubagentRecord` allowlist policy ([#830])

**Cause:** the public snapshot — the discrete-query half of the reactive/discrete split — is produced by an allowlist with no stated admission policy, so every widening (PR #748's `turnCount`/`activeTools`, [#724]'s deferred `isBackground`) re-litigates the same trade-off case by case, including the undecided question of whether third parties implement the interface at all.

- **Smell:** Category C (boundary contract left implicit).
- **Target:** `src/service/service.ts`, `src/service/service-adapter.ts` (`toSubagentRecord`), plus a policy record in this document or a new ADR; PR #748's second commit is the close target for the chosen shape.
- **Outcome:** a written admission policy (what earns a field a place; required versus optional for additions; whether the interface is a contract third parties satisfy), and the specific candidates (`turnCount`, `activeTools`, `outputFile`, `maxTurns`, `responseText`, `consumedAt`, `isBackground`) each dispositioned under it, pinned by updated service tests.
- **Commit type:** `feat:`.
- **Impact 3 / Risk 2 / Priority 12.**

Landed: `docs/decisions/0005-subagent-record-admission-policy.md` states the four admission rules, the four exclusion classes, and the produced-not-implemented contract direction.
`isBackground`, `turnCount`, `maxTurns`, and `outputFile` are admitted; `activeTools`, `responseText`, `consumedAt`, and `stoppedWhileQueued` are declined, and both halves are pinned in `test/service/service-adapter.test.ts`.
The policy's by-value definition also surfaced and fixed a snapshot aliasing the agent's live `lifetimeUsage` accumulator.
The contract direction made the widening semver-minor, so this step left the batch (see `Release batches`).

Release: independent

#### ✅ Step 3: Narrow the frontmatter guard to explicitly locked fields ([#829], with [#834])

**Cause:** upstream's config-wins precedence guards against a non-deterministic _model_ guessing harness knobs, but it was applied as a blanket over every field and every caller — so a deliberate operator override (`model: "sonnet-5"` on `Explore`) is silently discarded alongside a model's guess, contradicting the tool schema and `AGENTS.md`.

- **Smell:** Category C (a decision made at the wrong boundary — per-field policy fused into a single global precedence) plus `bug`.
- **Target:** `src/config/invocation-config.ts`, `src/config/custom-agents.ts` (frontmatter `locked:` shape), `src/tools/agent-tool.ts` (schema text), `src/service/service-adapter.ts` ([#834]'s cast), `docs/configuration.md`.
- **Design input:** [#641]'s operator-configured floors belong to the same precedence family — settle or explicitly exclude it in the step's plan.
  [#834] adds value validation to the same field family: neither door checks the level it receives, so `invocation-config.ts:26` and the mirrored cast at `service-adapter.ts` both widen an arbitrary `string` to `ThinkingLevel`.
  Trace what the SDK does with an unrecognized level before choosing between rejection, warned fallback, and narrowing the public `SpawnOptions.thinkingLevel` union.
  Builds on Step 1's `BackgroundRequest` two-variant mechanism (each door states commitment versus fallback).
- **Outcome:** blanket `agentConfig?.<field> ?? params` merges drop 5 → 0; caller-explicit wins unless the agent file locks the field; a discarded override is reported, not silent; an unsupported `thinking` value no longer reaches the child session unchecked through either door; migration note shipped.
- **Commit type:** `fix(pi-subagents)!:` — semver-major (changes effective model/thinking/turns for agent files relying on the blanket).
- **Impact 4 / Risk 3 / Priority 12.**

Landed: a caller's `subagent` parameter now wins and the agent file fills what the call leaves unset, unless the file declares `locked: true` (every field it sets — the pre-change behavior in one line) or `locked: [<fields>]` (exactly those, including fields it leaves unset).
A discarded override is reported in the tool result, on the background path as well as the foreground one — which also gave the background path the unknown-agent-type note it had never rendered.
The blanket merge row went 5 → 0.
[#834] landed with it: `src/config/thinking-level.ts` owns the level vocabulary, and both doors reject an unrecognized value rather than passing one Pi silently clamps to `off`.
The lock binds the tool door only; [#641] was excluded with rationale (a settings-layer clamp is a different mechanism at a different layer).

Release: batch "front-door-majors"

#### ✅ Step 4: Remove the vacant `WorkspacePrepareContext.invocation` field and its dead storage chain ([#828])

**Cause:** a provider-seam field no consumer has ever read — the exact case the no-vacant-hooks rule names — kept alive by a storage chain (`AgentSpawnConfig.invocation` → `SubagentInit.invocation` → `Subagent.invocation` → seam) whose only other terminal reader Step 1 removes.

- **Smell:** Category A (vacant hook; a dead subsystem once Step 1 lands).
- **Target:** `src/lifecycle/workspace.ts`, `src/lifecycle/subagent-manager.ts`, `src/lifecycle/subagent.ts`, `src/tools/background-spawner.ts`, `src/tools/foreground-runner.ts`, `packages/pi-subagents-worktrees/test/workspace-provider.test.ts`; the `AgentInvocation` type survives as `spawn-config.ts`'s local display snapshot.
- **Hard dependency:** after Step 1 (otherwise the widget read keeps the chain alive and `pnpm fallow dead-code` gates the partial removal).
- **Outcome:** `invocation` storage-chain and widget-filter sites drop 8 → 0; `dist/public.d.ts` loses the field (semver-major with migration note).
- **Commit type:** `refactor(pi-subagents)!:`.
- **Impact 3 / Risk 2 / Priority 12.**

Landed: `WorkspacePrepareContext` now carries exactly the three fields a provider reads (`agentId`, `agentType`, `baseCwd`), and the storage chain behind it — `AgentSpawnConfig.invocation`, `SubagentInit.invocation`, `Subagent.invocation`, and both tool-door producers — is gone.
The storage-chain row went 8 → 0.
The step's premise about the gate was refuted by measurement: a partial removal (the seam field and its call site, chain retained) passes `tsc`, the full suite, and `pnpm fallow dead-code`, so nothing mechanical forced the one-commit shape — only the fact that a half-removed chain leaves the stored-and-unread field the step exists to delete.
The seam-context test was strengthened rather than trimmed: `toHaveBeenCalledWith` compares with `toEqual` semantics, which ignore an explicitly-`undefined` key, so it could not have seen the field return; it now asserts `toStrictEqual` on the recorded call argument.
`AgentInvocation` survives as `spawn-config.ts`'s local display snapshot for the tool result's tags.

Release: batch "front-door-majors"

#### ✅ Step 5: Strip the inherited `available_skills` block from child prompts ([#801])

**Cause:** `buildAgentPrompt` embeds the parent's effective system prompt verbatim for KV-cache reuse, but Pi regenerates per-session appendages for the child — so the child gets two skills blocks, exactly the class [#640] fixed for the cwd footer, where the strip is per-appendage rather than principled.

- **Smell:** Category C (boundary flaw in prompt inheritance) plus `bug`.
- **Target:** `src/session/prompts.ts` (extend the inherited-appendage handling beside `withoutContradictoryCwdFooter`), `test/session/prompts.test.ts`.
- **Design note:** match [#640]'s discipline — strip only when the duplication is real, and preserve the byte-identical cacheable prefix where possible; the step's plan decides whether other Pi-appended blocks belong to the same strip.
- **Outcome:** an assembled child prompt contains one `available_skills` block, pinned by a regression test; the `prompts.ts` grep row goes 0 → ≥ 1.
- **Commit type:** `fix:`.
- **Impact 3 / Risk 2 / Priority 12.**

Landed: the strip is principled rather than per-appendage — `inheritedIdentity` cuts the inherited prompt at the first layer Pi resolves per session and keeps what precedes it, so the catalogue, the cwd footer, and the blocks extensions append from `before_agent_start` all stop at the boundary.
The design note's "strip only when the duplication is real" could not be honored as written: the child's skills are resolved after `buildAgentPrompt` runs, so the two catalogues cannot be compared at assembly time, and every reachable case — identical, cwd-divergent, or a `read`-less agent that gets no catalogue of its own — wants the inherited copy gone.
The answer to "whether other Pi-appended blocks belong to the same strip" is yes, including the extension tail, which costs less shared prefix than excising around it would: nothing remaining in the child's prompt moves out of the cached region, so its prefilled token count is unchanged.
[#640]'s equal-cwd exception was withdrawn as a consequence rather than a choice — the catalogue precedes the footer, so the exception preserved no prefix once the catalogue was cut.
The `prompts.ts` grep row went 0 → 3 (measured).
Recorded as `docs/decisions/0006-inherited-prompt-is-identity-only.md`; [#846] tracks the `@gotgenes/pi-nocd` docs this invalidates.

Release: independent

#### ✅ Step 6: Capture `UICtx` outside the tool-call path so the widget can render ([#827])

**Cause:** temporal coupling — the widget's ability to render is keyed to an unrelated event (`tool_execution_start` is the sole `setUICtx` site), so a session whose model never calls a tool has a permanently dark widget even for agents passing its roster filter; reachable today from any command-driven `SubagentsService.spawn`.

- **Smell:** Category C (coupling/boundary flaw) plus `bug`.
- **Target:** `src/ui/agent-widget.ts`, `src/handlers/tool-start.ts`, `src/index.ts` (composition-root wiring); PR #748's first commit carries candidate approach 1.
- **Design decision at plan time:** push at `session_start` versus a lazy `getUICtx` supplier; either way, settle the `finishedTurnAge` aging loose end (rows currently age only via `onTurnStart`).
  SDK facts pre-verified in the issue against `@earendil-works/pi-coding-agent@0.79.1` (TUI starts before extension init; `ctx.ui` is per-session stable; headless binds `noOpUIContext`) — re-verify against the pinned version at plan time.
- **Outcome:** the widget renders in a session with no model tool call, pinned by a regression test.
- **Commit type:** `fix:`.
- **Impact 3 / Risk 2 / Priority 12.**

Landed: the capture is a push at `session_start`, wired from the composition root as its own registration — Pi fans an event out to every handler an extension registers for it, so the widget's concern did not have to share a lambda with the session-lifecycle one.
The lazy-supplier alternative was refuted before the design gate rather than weighed at it: `ExtensionAPI` exposes no ambient `ui`, only the per-event `ctx.ui`, so a supplier still needs an event-driven capture and only adds an indirection.
The `finishedTurnAge` loose end was settled by retargeting the aging signal to `turn_start` rather than by a wall clock, which also corrected a miscount the move exposed: `onTurnStart` fires once per **tool call** on `tool_execution_start`, so a row seeded mid-turn could age out on the turn's second tool call.
`ToolStartHandler` became `WidgetEventsHandler` with one method per event, and the extension no longer subscribes to `tool_execution_start`.
The history file settled the step's open question: [#423]'s invariant is about inbound calls from **spawn tools**, so the tool-call gate protected nothing and `ToolStartHandler` was merely where a `ctx` was in hand.
Two gaps surfaced that the plan's file list did not name: `test/print-mode.test.ts` carries its own one-handler-per-event fixture and needed the same fan-out fix, and the widget's `turn_start` registration was unpinned — deleting it left all 1352 tests green until a fourth composition-root test was added.
Incidentally closes a timer leak: `clearWidget()` was unreachable while `uiCtx` was undefined, so a background spawn in headless mode left the 80 ms interval running until process exit.
[#849] tracks the teardown half (`AgentWidget.dispose()` has no call site) as Step 9.

Release: independent

#### ✅ Step 7: Deliver the resume handle in foreground results ([#798])

**Cause:** door asymmetry in result delivery — the background path puts the agent ID in the model-visible text and the foreground path leaves it only in renderer `details`, so a foreground child that ends by asking a question cannot be answered; the resume-return edge shares the shape.

- **Smell:** Category C (asymmetric boundary) plus `bug`.
- **Target:** `src/tools/foreground-runner.ts`, `src/tools/agent-tool.ts` (resume-return edge), `src/tools/helpers.ts`.
- **Outcome:** foreground and resume result text carry the agent ID; the `foreground-runner.ts` grep row goes 0 → ≥ 1; pinned by tests.
- **Commit type:** `fix:`.
- **Impact 2 / Risk 1 / Priority 10.**

Landed: all three model-visible delivery edges — the foreground success return, the foreground error return, and the resume-return edge in `AgentTool.execute` — now carry an `Agent ID: <id>` line, spelled as `background-spawner.ts` spells it.
The `foreground-runner.ts` grep row went 0 → 2 (measured; the success and error branches each carry the literal).
The literal is written inline at each site rather than extracted into `helpers.ts`, which the step's target-file list anticipated: the metric row greps the spelling in `foreground-runner.ts` specifically, and the line renders into three different surrounding contexts.
A bare handle was chosen over a restated resume hint, for byte symmetry with the background door and because the tool's own `Guidelines:` block already binds the ID to `resume`.
The step also exposed an unpinned invariant from Step 3: the spawn-notes prefix must lead the result, but the `fellBack` test asserted only containment and was order-blind — it is now an ordering assertion, and a mutation that hoists the ID line above the notes kills it while every containment assertion stays green.

Release: independent

#### ✅ Step 8: Ask-back: let a child's question reach the parent ([#465])

**Cause:** a child that ends its run by asking a question terminates into a dead end — the result channel is fire-and-forget, so the ask-back loop (child question → parent notified → parent resumes with the answer) has no supported path, even though resume itself works and Phase 21's [#466] gave resumed completions first-class events.

- **Smell:** feature with a structural seam (the delivery-domain follow-on the first-principles section anticipates).
- **Target:** to be settled by the step's plan — candidates are the notification layer (`src/observation/`), the result renderers, and the completion event payloads; scheduled by operator decision, design-first.
- **Soft dependency:** after Step 7 (the resume handle must be deliverable before an ask-back nudge is actionable in the foreground path).
- **Outcome:** a completed child whose result is a question is surfaced to the parent as answerable (mechanism per plan), pinned by an end-to-end test.
- **Commit type:** `feat:`.
- **Impact 3 / Risk 3 / Priority 9.**

Landed: the mechanism is a child-declared marker, parsed deterministically at the terminal transition and rendered by every result carrier with the exact `resume` call.
The protocol sits beside `<active_agent>` in a header both prompt modes share, because `Explore` and `Plan` are `promptMode: "replace"` and never receive the `<sub_agent_context>` bridge — the extraction that gave the two branches one home was the step's Tidy-First preparation, and it is why deleting the block now fails both modes' tests instead of one.
The parser ignores fenced regions and takes the last well-formed block, so a child quoting the protocol back does not trip it; the protocol's own example is fenced and its prose names the marker without angle brackets, since a bare opening tag there pairs with the fenced closing one.

Three defects surfaced under the feature and were fixed with it.
The `isBackground` guard on `onRunFinished`/`onResumeFinished` was residue from a branch it once shared with limiter accounting, so foreground children emitted no terminal event and persisted no `subagents:record`; the nudge's suppression moved to a revocable carrier claim, which is structural where the consumption re-check could lose its race on an interrupted turn.
And `get_subagent_result` and the resume return reported nothing for an `aborted`, `steered`, or `stopped` child, so one status vocabulary now backs the two presentations the carriers' differing grammar needs.

The claim is deliberately caller-scoped: `resetForResume` clears `consumedAt` but not the claim, because `runResume` calls it synchronously before `resume()` returns, so a claim cleared there would be dropped before the caller that set it could observe it.

Release: independent

#### ✅ Step 9: Tear the widget down on session shutdown ([#849])

**Cause:** the widget acquires two resources — the 80 ms interval from `ensureTimer()` and the `setWidget`/`setStatus` registrations on the session's `UICtx` — and `AgentWidget.dispose()` releases both, but nothing calls it; the method carries a `fallow-ignore-next-line unused-class-member` comment so the gap stays invisible to dead-code analysis.
Step 6 is the acquisition half of the same lifecycle; this is the release half.

- **Smell:** Category A (a disposal path with no caller) plus `bug`.
- **Target:** `src/handlers/lifecycle.ts` or the widget's own event handler (per the step's plan), `src/index.ts`, `src/ui/agent-widget.ts` (drop the fallow ignore once the method has a call site).
- **Hard dependency:** after Step 6, which decides where the widget's host-event wiring lives.
- **Design decision at plan time:** whether the widget joins `SessionLifecycleHandler`'s dependency set or takes its own `session_shutdown` registration beside Step 6's wiring.
- **Outcome:** `session_shutdown` clears the interval and unregisters the widget, pinned by a composition-root test; the `fallow-ignore` comment on `dispose()` is removed.
- **Commit type:** `fix:`.
- **Impact 2 / Risk 1 / Priority 10.**

Landed: the teardown is `WidgetEventsHandler.handleSessionShutdown()` with its own `session_shutdown` registration, chosen over widening `SessionLifecycleHandler`'s dependency set — the same reasoning Step 6 recorded, and it keeps all three of the widget's host events in one module.
`AgentWidget.dispose()` now also drops its `UICtx`, so `update()` returns at its first line afterwards and disposal is final by construction rather than by call ordering.
That second decision made the first one's ordering unobservable, which the step's plan predicted and the implementation measured: swapping the two `session_shutdown` registrations leaves all 1447 tests green, because dispose-first drops the `UICtx` before the aborts can drive an `update()` and dispose-last runs after the registry is already empty.
The planned ordering test was dropped rather than committed — it survived its own mutation, and `composition-root.test.ts` claims that only it fails when wiring is removed.
The order is kept as defensive intent in an `index.ts` comment.

Two of the step's plan-time claims were wrong in the same direction, both about `fallow dead-code` pinning the wiring.
Fallow counts test call sites, so the `fallow-ignore` comment went stale as soon as the widget's own `dispose()` tests existed — one step earlier than the plan scheduled its removal, and failing in the opposite direction.
For the same reason the gate can never pin production wiring: with the registration deleted and no suppression, fallow reports nothing.
The composition-root tests are the only pin, and they had to be rewritten to become one — a first draft that left the agent running at shutdown passed without the fix, because the abort's notification settles after `manager.dispose()` empties the registry and `update()` then takes its idle path into `clearWidget()`.
Driving the agent to completion first removes that incidental teardown.
The diagnosis and the widget-level assertion set are credited to PR #850.

The plan's own baseline row is wrong and is left as written: it records 1438 tests as 1440 across 75 files rather than 74, having been measured while a disposable spike file was still on disk.
The true baseline was 1438 / 74, and this step ends at 1447 / 74.

Release: independent

#### ✅ Step 10: Re-prepare or refuse a workspace-backed resume ([#857])

**Cause:** `Subagent.completeRun()` disposes the child's workspace on every terminal transition (`workspaceBracket.dispose(...)`, whose addendum it folds into the result), while `resume()` reuses the existing session and never re-prepares one — a boundary plan `0466` drew deliberately for its own scope and never revisited.
A child spawned under a registered `WorkspaceProvider` therefore resumes into a directory the provider has torn down, with no signal.

- **Smell:** Category C (asymmetric lifecycle bracket) plus `bug`.
- **Target:** `src/lifecycle/subagent.ts`, `src/lifecycle/workspace-bracket.ts`, `src/tools/agent-tool.ts` (the resume-refusal message, which already has a released-session precedent).
- **Design decision at plan time:** re-prepare on resume versus refuse with a message, per the `sessionReleased` precedent.
- **Outcome:** a workspace-backed resume either re-prepares its workspace or is refused with a message naming why; pinned by a test with a stub provider.
- **Commit type:** `fix:`.
- **Impact 2 / Risk 2 / Priority 9.**

Landed: both halves, because re-prepare turned out not to be available and refusal alone would have left the ask-back loop closed to exactly the agents the step was filed for.
A completed run that declared a question holds its workspace for the resume that question invites; every other outcome disposes at run end as before, so a stopped child still gets its rescue branch immediately.
The refusal covers the rest, keyed on a workspace actually prepared and disposed rather than on `hasProvider()` — the git-worktree provider declines every agent type outside `worktreeAgents`, so provider-registered is true for nearly every child.

Re-prepare was ruled out on three independent facts, all in the provider rather than the core: the session's cwd is a value frozen at `createSubagentSession` time with no setter, `createWorktree` randomizes the path with a UUID suffix, and a re-prepared worktree checks out the parent's HEAD without the work the first cleanup committed to `pi-agent-<id>` — whose branch name the second cleanup would then collide with.

Disposal is now reachable from four edges, so `WorkspaceBracket.dispose()` releases the workspace before delegating and became idempotent; the flag is raised before the delegate call, because a provider whose teardown throws leaves a workspace no safer to reuse than a clean one.
The deferred edge has no result text to fold `resultAddendum` into, which is the residual [#870] (Step 12) records.

Release: independent

#### Step 11: Child-initiated mid-run channel ([#858])

**Cause:** the parent can reach a running child (`steer_subagent`), but a child that needs information mid-run has no way back — it can only terminate and rely on Step 8's end-and-resume loop, which loses a workspace (Step 10) and expires with the retention window.
A non-terminal one-way message (a material finding mid-run) has no expression at all.

- **Smell:** feature completing Step 8's capability at the half its scope excludes.
- **Target:** to be settled by the step's plan; design-first.
- **Hard dependency:** after Step 8 (the completed-child loop must exist and be exercised before its blocking counterpart is designed) and informed by Step 10.
- **Design decision at plan time:** the child tool allowlist ([#725]) filters any new child-facing tool out of every agent declaring `tools:`, including built-in `Explore` and `Plan` — force-inclusion breaks the documented contract, and per-agent edits do not scale.
  A blocked child also holds its concurrency slot.
- **Outcome:** a running child can signal its parent and receive a reply without terminating (mechanism per plan), pinned by an end-to-end test.
- **Commit type:** `feat:`.
- **Impact 3 / Risk 4 / Priority 7.**

Release: independent

#### Step 12: Deliver a workspace addendum produced after the result edge ([#870])

**Cause:** `Workspace.dispose()` returns a `resultAddendum` the core folds into the child's result text, so the string only has a reader while a result is still being built.
Step 10 holds a question-ending child's workspace open and moves its disposal to `releaseSession()`/`disposeSession()`, where the child's result was delivered long ago — the addendum is produced and dropped.
For `@gotgenes/pi-subagents-worktrees` that string is the only thing naming the rescue branch, and the preserved-worktree scan does not cover a cleanup that succeeded.

- **Smell:** Category C (a value produced at an edge with no channel) plus `bug`.
- **Target:** to be settled by the step's plan — candidates are a completion nudge (`src/observation/notification.ts`), a `child-lifecycle.ts` event, and a record field `get_subagent_result` surfaces.
- **Hard dependency:** after Step 10, which creates the condition.
- **Design decision at plan time:** which channel carries a string produced after the result edge, given that [decision 0005](../decisions/0005-subagent-record-admission-policy.md) withholds momentary activity from `SubagentRecord` but admits durable-artifact pointers.
- **Outcome:** a workspace disposed after its child's result was delivered still reaches the parent or the user, pinned by a test that drives disposal through the retention path.
- **Commit type:** `fix:`.
- **Impact 3 / Risk 3 / Priority 9.**

Release: independent

#### Step 13: Resolve `tools: none` to no tools ([#871])

**Cause:** `AgentTypeRegistry.getToolNamesForType` picks with `config?.toolNames?.length ? config.toolNames : [...BUILTIN_TOOL_NAMES]`, so a deliberate empty list takes the same branch as an omitted key.
The frontmatter parser is correct and `test/config/custom-agents.test.ts` pins `tools: none` to `[]`; the distinction is lost one layer down, and the child session's SDK allowlist becomes the full built-in set.
It fails open — the tools silently granted include `edit`, `write`, and `bash`.

- **Smell:** Category C (a truthiness check standing in for a three-valued distinction) plus `bug`.
- **Target:** `src/config/agent-types.ts` (`getToolNamesForType`), `test/config/agent-types.test.ts`, which covers the omitted-key fallback, an explicit list, and an unknown type but has no empty-list case.
- **Outcome:** an agent declaring `tools: none` runs with no tools and the omitted-key fallback is unchanged, pinned by a test for each of the three inputs (absent, empty, listed).
- **Commit type:** `fix:`.
- **Impact 3 / Risk 1 / Priority 15.**

Release: independent

### Step dependencies

```mermaid
flowchart TD
    S1["✅ Step 1 (#724)<br/>Choke-point parity"] --> S3["✅ Step 3 (#829)<br/>Locked-fields precedence"]
    S1 --> S4["✅ Step 4 (#828)<br/>Remove vacant seam field"]
    S1 -.soft.-> S2["✅ Step 2 (#830)<br/>SubagentRecord policy"]
    S7["✅ Step 7 (#798)<br/>Foreground resume handle"] -.soft.-> S8["✅ Step 8 (#465)<br/>Ask-back"]
    S5["✅ Step 5 (#801)<br/>Skills-block strip"]
    S6["✅ Step 6 (#827)<br/>UICtx capture"] --> S9["✅ Step 9 (#849)<br/>Widget teardown"]
    S8 --> S11["Step 11 (#858)<br/>Mid-run channel"]
    S10["✅ Step 10 (#857)<br/>Workspace-backed resume"] -.informs.-> S11
    S10 --> S12["Step 12 (#870)<br/>Post-result addendum delivery"]
    S13["Step 13 (#871)<br/>Empty tool allowlist"]
```

### Parallel tracks

- **Track A — Front-door contract:** Steps 1 → 2, 3, 4 (the spine; Step 1 unblocks the rest).
- **Track B — Prompt assembly:** Step 5 (fully independent).
- **Track C — Widget lifecycle:** Steps 6 → 9 (independent of the other tracks; Step 6 complements Step 1 — parity makes SDK agents _eligible_, this makes the widget _present_ — and Step 9 releases what Step 6 acquires).
- **Track D — Result delivery and ask-back:** Steps 7 → 8 → 11, with Step 10 → 12 joining as a resume-path fix and the residual it creates, Step 10 also informing Step 11 (Steps 7 → 8 is soft ordering; 8 → 11 and 10 → 12 are hard).
- **Track E — Agent config resolution:** Step 13 (fully independent; it corrects the base list Step 11 appends to, but neither step needs the other).

### Release batches

- **Batch "front-door-majors":** Steps 4, 3 (ship together as one semver-major bump; tail = Step 3).
  Step 3 is `fix!:` and Step 4 is `refactor!:` with a `BREAKING CHANGE:` footer.
  The two landed in the other order, so Step 4 completed the batch: Step 3's release PR stayed open across it, and both breaking changes ship under the one major bump Step 3's `fix!:` opened.
  Step 2 was provisionally batched here in case its required/optional decision came out breaking; it did not — `SubagentRecord` is produced, never implemented, so its widening is semver-minor and it left the batch as the batch's own line anticipated.
- Independently releasable: Steps 1, 2, 5, 6, 7, 8, 9, 10, 11, 12, 13.
  Steps 1, 5, 6, 7, 9, 10, 12, 13 are `fix:`, Step 2 is `feat:`, and Steps 8 and 11 are `feat:` — each an unhidden release vehicle on its own.

## Refactoring history

The architecture above is the product of twenty completed improvement phases; Phase 6 (UI extraction to a separate package) was folded into [ADR-0004] rather than executed.
Each phase's findings, numbered plan, dependency diagram, and health metrics are preserved in a per-phase history file under [`history/`](history/).

| Phase | Theme                                                        | History                                                                                        |
| ----- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 1     | Export SubagentsService API boundary                         | [phase-1-api-boundary.md](history/phase-1-api-boundary.md)                                     |
| 2     | Remove scheduling subsystem                                  | [phase-2-remove-scheduling.md](history/phase-2-remove-scheduling.md)                           |
| 3     | Remove group-join, RPC; replace output-file                  | [phase-3-remove-rpc-groupjoin.md](history/phase-3-remove-rpc-groupjoin.md)                     |
| 4     | Implement and publish SubagentsService                       | [phase-4-implement-service.md](history/phase-4-implement-service.md)                           |
| 5     | Decompose index.ts                                           | [phase-5-decompose-index.md](history/phase-5-decompose-index.md)                               |
| 6     | Extract UI to separate package                               | Superseded by [ADR-0004]                                                                       |
| 7     | Encapsulation and dependency narrowing                       | [phase-7-encapsulation.md](history/phase-7-encapsulation.md)                                   |
| 8     | Testability, display extraction, menu decomposition          | [phase-8-testability.md](history/phase-8-testability.md)                                       |
| 9     | Observation consolidation, ctx elimination                   | [phase-9-observation-ctx.md](history/phase-9-observation-ctx.md)                               |
| 10    | Domain organization, bag decomposition, complexity           | [phase-10-structural-decomposition.md](history/phase-10-structural-decomposition.md)           |
| 11    | Closure factories to classes                                 | [phase-11-closure-to-class.md](history/phase-11-closure-to-class.md)                           |
| 12    | Complexity reduction and test fixture extraction             | [phase-12-complexity-test-fixtures.md](history/phase-12-complexity-test-fixtures.md)           |
| 13    | Remaining structural smells                                  | [phase-13-remaining-smells.md](history/phase-13-remaining-smells.md)                           |
| 14    | Strip policy from core                                       | [phase-14-strip-policy.md](history/phase-14-strip-policy.md)                                   |
| 15    | Domain model evolution                                       | [phase-15-domain-model-evolution.md](history/phase-15-domain-model-evolution.md)               |
| 16    | Invert dependencies (extensions on a minimal core)           | [phase-16-invert-dependencies.md](history/phase-16-invert-dependencies.md)                     |
| 17    | Core consolidation                                           | [phase-17-core-consolidation.md](history/phase-17-core-consolidation.md)                       |
| 18    | Reconsider UI (first principles)                             | [phase-18-reconsider-ui.md](history/phase-18-reconsider-ui.md)                                 |
| 19    | Implement ADR-0004 UI decisions                              | [phase-19-implement-ui-decisions.md](history/phase-19-implement-ui-decisions.md)               |
| 20    | Result delivery extraction and boundary cleanup              | [phase-20-result-delivery.md](history/phase-20-result-delivery.md)                             |
| 21    | Classification predicates, resume completion, model boundary | [phase-21-classification-model-boundary.md](history/phase-21-classification-model-boundary.md) |

### Structural refactoring issues

| Phase                | Issue                                                      | Summary                                                                                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation           | #69, #71, #76, #80                                         | SubagentRuntime, pure assembler, cwd injection, config consolidation                                                                                                                                                    |
| Core decomposition   | #84, #72, #87, #70                                         | WorktreeManager, AgentManager DI, runtime methods, handler extraction                                                                                                                                                   |
| Interface polish     | #66, #77                                                   | SDK types, projectAgentsDir                                                                                                                                                                                             |
| Features             | #61                                                        | JSONL session transcripts                                                                                                                                                                                               |
| AgentManager         | #98, #99, #100, #102                                       | Record state machine, ParentSnapshot, session-event observation, test factory                                                                                                                                           |
| Encapsulation        | #108, #109, #110, #111, #112, #113, #114, #115, #116, #118 | Registry, settings, activity tracker, record lifecycle, observer, spawn options, deps narrowing, tool split, type housekeeping                                                                                          |
| Testability          | #131, #132, #133, #134, #135, #136                         | Shared fixtures, session-config IO, runner SDK boundary, as-any reduction, display extraction, menu decomposition                                                                                                       |
| Observation/ctx      | #144, #145, #146, #147, #148                               | Observation consolidation, execute decomposition, UI context, text wrapping injection, widget rendering split                                                                                                           |
| Phase 10             | #164, #165, #166, #167, #168, #169, #170, #171, #172       | Domain directories, ResolvedSpawnConfig, ParentSessionInfo, RunnerIO split, ToolFilterConfig, RunContext, buildContentLines, renderResult, content-items                                                                |
| Phase 11             | #192, #193, #194, #195, #196                               | SessionContext, runtime queries, interface alignment, tool classes, runner/menu classes, index.ts simplification                                                                                                        |
| Phase 12             | #205, #206, #207, #208                                     | renderWidgetLines, showAgentDetail, widget update, shared test fixtures                                                                                                                                                 |
| Phase 13             | #214, #215, #216, #217, #218, #219                         | Closure-to-class, buildParentContext, startAgent decomp, overwrite guard, settings SDK, test duplication                                                                                                                |
| Phase 14             | #237, #238, #239, #242                                     | Remove disallowed_tools, remove extensions filtering, collapse filterActiveTools, rename Agent to subagent                                                                                                              |
| Phase 15             | #227, #228, #231, #229, #230, #232                         | Agent domain model, async startAgent, runner self-contained, Agent.run(), ConcurrencyQueue, Agent.resume()                                                                                                              |
| Phase 16             | #261, #262, #263, #264, #265                               | Lifecycle events (retire permission-bridge), WorkspaceProvider seam, extract worktrees package, remove isolated, born-complete execution / dissolve runner                                                              |
| Phase 16 (abandoned) | #256 (superseded), #257 (parked), #258, #259 (not planned) | Agent collaborator architecture — replaced by the inversion approach above ([ADR-0002])                                                                                                                                 |
| Phase 17             | #381, #373, #374, #375, #376, #377, #378, #379, #380       | ConcurrencyLimiter, SubagentState, run-start encapsulation, run collaborators, events observer, widget decoupling, lifecycle test fixtures, UI/tools test fixtures, settings-loader extraction                          |
| Phase 17 (follow-on) | #412, #415                                                 | Session-mock builder unification, worktrees settings-helper migration                                                                                                                                                   |
| Phase 18             | #420, #421, #422, #423, #424, #425, #426, #427             | Fold metrics onto record, migrate readers, delete activity tier, widget self-drives, drop widget from tool, reconcile event contract, consolidate test clones, UI-direction ADR                                         |
| Phase 19             | #446, #447, #444, #445, #462, #463, #442, #441, #443       | ADR-0004 spike, settings command, background widget, native session nav slice, TUI renderer, file-snapshot source, dissolve /agents + viewer, remove definition mgmt, consolidate test clones                           |
| Phase 19 (follow-on) | #470                                                       | README refresh for the removed /agents command surface                                                                                                                                                                  |
| Phase 20             | #535, #536, #537, #538, #539, #540, #541, #542, #543       | Extract result delivery, decompose get-result-tool, steer outcome, type model boundary, narrow tui/theme, table-driven settings, decompose notification renderer, full-value SubagentStateInit, consolidate test clones |
| Phase 21             | #563, #466, #611                                           | Classification predicates, resume completion channel, model boundary typing                                                                                                                                             |

Issue #22 (parent-session resolution) has been closed.
Of the tracks recorded under Phase 21's deferred-work dispositions, [#482], [#600], and [#610] have since closed; [#451] was relabeled `scope:repo` at Phase 22 planning; [#465] is scheduled as Phase 22 Step 8; [#519] and [#608] remain open and still do not gate a package structural phase.

## Relationship with upstream

This fork (`@gotgenes/pi-subagents` in the [gotgenes/pi-packages] monorepo) is a hard fork of [tintinweb/pi-subagents].
The decomposition diverges materially from upstream's direction.

The three upstream PRs (#71, #72, #73) remain open.
If they land, upstream gains the peer-dep fix and the two RepOne patches.
This fork continues independently regardless.

Upstream fixes and ideas are cherry-picked when they align with this fork's scope.
The upstream test suite is run periodically as a regression canary for the session assembly core.

[earendil-works/pi#4207]: https://github.com/earendil-works/pi/issues/4207
[gotgenes/pi-packages]: https://github.com/gotgenes/pi-packages
[tintinweb/pi-subagents]: https://github.com/tintinweb/pi-subagents
[#441]: https://github.com/gotgenes/pi-packages/issues/441
[#442]: https://github.com/gotgenes/pi-packages/issues/442
[#451]: https://github.com/gotgenes/pi-packages/issues/451
[#465]: https://github.com/gotgenes/pi-packages/issues/465
[#466]: https://github.com/gotgenes/pi-packages/issues/466
[#482]: https://github.com/gotgenes/pi-packages/issues/482
[#519]: https://github.com/gotgenes/pi-packages/issues/519
[#564]: https://github.com/gotgenes/pi-packages/issues/564
[#600]: https://github.com/gotgenes/pi-packages/issues/600
[#608]: https://github.com/gotgenes/pi-packages/issues/608
[#610]: https://github.com/gotgenes/pi-packages/issues/610
[#636]: https://github.com/gotgenes/pi-packages/issues/636
[#640]: https://github.com/gotgenes/pi-packages/issues/640
[#641]: https://github.com/gotgenes/pi-packages/issues/641
[#660]: https://github.com/gotgenes/pi-packages/issues/660
[#676]: https://github.com/gotgenes/pi-packages/issues/676
[#683]: https://github.com/gotgenes/pi-packages/issues/683
[#695]: https://github.com/gotgenes/pi-packages/issues/695
[#711]: https://github.com/gotgenes/pi-packages/issues/711
[#722]: https://github.com/gotgenes/pi-packages/issues/722
[#724]: https://github.com/gotgenes/pi-packages/issues/724
[#725]: https://github.com/gotgenes/pi-packages/issues/725
[#733]: https://github.com/gotgenes/pi-packages/issues/733
[#735]: https://github.com/gotgenes/pi-packages/issues/735
[#755]: https://github.com/gotgenes/pi-packages/issues/755
[#779]: https://github.com/gotgenes/pi-packages/issues/779
[#791]: https://github.com/gotgenes/pi-packages/issues/791
[#792]: https://github.com/gotgenes/pi-packages/issues/792
[#793]: https://github.com/gotgenes/pi-packages/issues/793
[#798]: https://github.com/gotgenes/pi-packages/issues/798
[#801]: https://github.com/gotgenes/pi-packages/issues/801
[#827]: https://github.com/gotgenes/pi-packages/issues/827
[#849]: https://github.com/gotgenes/pi-packages/issues/849
[#828]: https://github.com/gotgenes/pi-packages/issues/828
[#829]: https://github.com/gotgenes/pi-packages/issues/829
[#830]: https://github.com/gotgenes/pi-packages/issues/830
[#834]: https://github.com/gotgenes/pi-packages/issues/834
[#846]: https://github.com/gotgenes/pi-packages/issues/846
[#857]: https://github.com/gotgenes/pi-packages/issues/857
[#858]: https://github.com/gotgenes/pi-packages/issues/858
[#870]: https://github.com/gotgenes/pi-packages/issues/870
[#871]: https://github.com/gotgenes/pi-packages/issues/871
[ADR-0002]: ../decisions/0002-extensions-on-a-minimal-core.md
[ADR-0004]: ../decisions/0004-reconsider-ui-direction.md
