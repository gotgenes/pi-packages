---
issue: 724
issue_title: "SDK-spawned agents (SubagentsService.spawn) never populate invocation, so they're permanently invisible in the background widget"
---

# Make SDK-spawned agents first-class at the manager choke point

## Release Recommendation

**Release:** ship independently

`packages/pi-subagents/docs/architecture/architecture.md` has no open improvement phase (`grep -n '^## Improvement roadmap — Phase'` returns nothing) and no step references [#724], so there is no `Release:` batch annotation to honor.
The change is a user-visible `fix:` to the public service contract, so it cuts a release on its own.

## Problem Statement

[#724] reports that agents dispatched through `getSubagentsService().spawn(type, prompt, options)` never appear in the background widget or the status bar, even while actively running.
The reporter traced it correctly: `AgentWidget.listBackgroundAgents()` (`src/ui/agent-widget.ts:168`) filters on `record.invocation?.runInBackground === true`, and `SubagentsServiceAdapter.spawn` never builds an `invocation`, so `record.invocation` is `undefined` forever.

The reporter also asks whether the scoping is intentional, tied to [ADR-0004] Decision A framing the widget as "background agents only."
It is not.
Decision A scopes the widget by **execution mode** — "foreground runs suppress it," because the `subagent` tool's inline `onUpdate` stream is authoritative there — and says nothing about who spawned the agent.
An SDK-spawned background agent is squarely inside the widget's stated audience.

The filter is one symptom of a larger gap.
The tool door (`AgentTool` → `resolveSpawnConfig` → `spawnBackground` → `manager.spawn`) runs a config-resolution pipeline that the SDK door (`SubagentsServiceAdapter.spawn` → `manager.spawn`) skips entirely.
Six behaviors diverge:

| Concern                            | Tool door                           | SDK door                      | Observable consequence                                                                                                                                                 |
| ---------------------------------- | ----------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isBackground` on the spawn config | set `true`                          | set from `options.foreground` | none — both set it                                                                                                                                                     |
| `invocation` snapshot              | built (`spawn-config.ts:123`)       | omitted                       | the reported bug: filtered out of the widget forever                                                                                                                   |
| `parentSession`                    | all three fields                    | omitted                       | permission forwarding loses `parentSessionId`; the child session file falls to the `tmpdir()` branch of `deriveSubagentSessionDir`; `record.toolCallId` is `undefined` |
| Type canonicalization              | canonical key stored                | caller's raw string stored    | `svc.spawn("explore", …)` records `type: "explore"`; a typo records the typo while `general-purpose` silently runs                                                     |
| Disabled-agent block ([#448])      | error (`spawn-config.ts:84`)        | spawns silently               | `enabled: false` is unenforced through the public API                                                                                                                  |
| `runInBackground` frontmatter      | honored (`invocation-config.ts:28`) | ignored                       | an agent `.md` declaring a mode does not affect an SDK spawn                                                                                                           |

Two behaviors that look like divergences and are **not** — verified, so the plan does not claim them:

- Agent-frontmatter defaults for model, thinking level, system prompt, and tool list reach the SDK door downstream through `assembleSessionConfig` (`src/session/session-config.ts:152-172`).
- `maxTurns` normalization and the `defaultMaxTurns` setting are applied by `SubagentSession.runTurnLoop` (`src/lifecycle/subagent-session.ts:91-92`), not only by the tool door.

## Goals

- `SubagentManager.spawn` becomes the single choke point that stamps the invariants both doors must share: canonical agent type, disabled-agent rejection, and resolved background mode.
- Background-ness becomes first-class record state (`Subagent.isBackground`) rather than a boolean read off a field documented as a UI-display snapshot.
- The widget renders SDK-spawned background agents.
- SDK-spawned children carry `parentSession`, so permission forwarding can route to the parent and the child session file nests under the parent's.
- `AgentSpawnConfig`'s background field becomes compiler-enforced, so a future fourth front door cannot silently reintroduce this class of bug.

Not breaking.
The public `SubagentsService` interface, `SpawnOptions`, and `SubagentRecord` are unchanged in shape.
`SubagentsServiceAdapter.spawn` gains one new throw condition (disabled agent type) alongside its two existing ones; the tool door's observable behavior does not change at all.

## Non-Goals

- **Changing the tool door's frontmatter precedence.**
  `resolveAgentInvocationConfig` gives agent config priority over the `subagent` tool's parameters for every shared field.
  That is inherited upstream behavior from `tintinweb/pi-subagents` commit `91236678` ("fix(subagents): make agent config authoritative"), whose recorded rationale is a guard against the parent *model* guessing harness knobs it does not understand.
  It is currently over-applied — measured during planning, dispatching `Explore` with `model: "sonnet-5"` runs on `claude-haiku-4-5-20251001`, contradicting the tool's own parameter description and this repo's `AGENTS.md`.
  Narrowing that guard to an explicit frontmatter lock list is [#829], which builds on the `BackgroundRequest` mechanism this plan introduces.
  This plan leaves every door's current policy byte-identical.
- **Capturing `UICtx` outside `tool_execution_start`.**
  The widget is dark for an entire session in which the model never calls a tool, regardless of the roster filter, because `ToolStartHandler` is the only `setUICtx` call site.
  That is [#827]; it carries its own design question (push at `session_start` versus a lazy supplier) and the `finishedTurnAge` aging loose end.
  This plan makes SDK-spawned agents *eligible*; [#827] makes the widget *present*.
- **`WorkspacePrepareContext.invocation`.**
  It stays `undefined` for SDK spawns after this change, because the plan does not build an `invocation` snapshot on the SDK door.
  That field is a vacant hook: introduced by us in `51a99701` with no recorded rationale, and never read — `@gotgenes/pi-subagents-worktrees`, the seam's only consumer, touches it only in a test fixture that sets it to `undefined`.
  Its contents are also unfit for a provider decision: `AgentInvocation.modelName` is a display string (`spawn-config.ts:111-117` — lowercased, `Claude` stripped, `undefined` when equal to the parent's model).
  Removal is [#828], a semver-major change to the public type bundle with its own migration note.
- **Adding `isBackground` to the public `SubagentRecord`.**
  `toSubagentRecord` is a deliberate allowlist, and no divergence above requires the field.
  Adding it as required would break any third party implementing the interface — the same concern PR [#748] raises about `turnCount`/`activeTools`.
- **Reloading the agent registry on the SDK door.**
  `AgentTool.execute` calls `registry.reload()` on every tool call; the SDK door does not, so a custom agent `.md` added mid-session is invisible to `svc.spawn` until the next tool call.
  That is existing behavior — the SDK door already resolves against the same un-reloaded registry instance through `assembleSessionConfig` — and this plan does not change it.

## Background

### The three front doors

All three already pass through `SubagentManager`, which is why it is the right choke point.

```text
AgentTool.execute
  → resolveSpawnConfig (src/tools/spawn-config.ts)   ← type canonicalization, disabled check, invocation snapshot
  → spawnBackground → manager.spawn(…, { isBackground: true, … })
  → runForeground   → manager.spawnAndWait(…)         ← manager.spawn(…, { isBackground: false })

SubagentsServiceAdapter.spawn
  → manager.spawn(…, { isBackground: !foreground, … })  ← no resolution at all
```

### What `isBackground` controls today

`options.isBackground` is read at five sites in `src/lifecycle/subagent-manager.ts` and stored nowhere:

| Line | Effect                                                                   |
| ---- | ------------------------------------------------------------------------ |
| 174  | seeds the record's status: `queued` versus `running`                     |
| 194  | fires `onSubagentCreated` (widget loop start, `subagents:created` event) |
| 198  | routes the run through `ConcurrencyLimiter` versus starting immediately  |
| 142  | gates `onRunFinished` (completion nudge, `subagents:completed`)          |
| 147  | gates `onResumeFinished`                                                 |

The widget then re-derives the same fact from `record.invocation?.runInBackground`.
That is the scattered decision: the manager knows the answer at spawn time and throws it away, so a consumer reconstructs it from a display snapshot that one door forgets to build.

### Why the tool door is a two-step and the SDK door is not

`AgentTool` must know the background mode *before* it calls the manager, because the mode selects the runner: `spawnBackground` (returns immediately) or `runForeground` (streams `onUpdate`, awaits the record).
So `resolveSpawnConfig` merges frontmatter first and the tool's call to the manager reports an already-committed decision.
The SDK door has no such branch — `spawn()` always returns an id.

### Constraints from `AGENTS.md` and the package skill

- **No policy enforcement in core.**
  The disabled-agent check is agent-registry config, not permission policy; "Agent definitions" is an explicit core responsibility in `architecture.md`.
  Moving the check to the manager keeps policy out and keeps a registry invariant in.
- **No vacant hooks.**
  This is why the plan declines to populate `WorkspacePrepareContext.invocation`.
- **Cross-extension composition points inward.**
  The manager gains a narrow registry lookup, an in-package dependency, not an outbound one.

### The doc already claims the edge

`architecture.md:245` states `SubagentManager --> AgentTypeRegistry : resolves types` in the class diagram.
No such edge exists in the code today (`git log -S'registry' -- src/lifecycle/subagent-manager.ts` shows the registry was *removed* from the manager in `aa8b2da6`, #231).
This change makes the diagram true rather than requiring a new edge.

## Design Overview

### The invariant the design rests on

`isBackground` fuses three decisions — scheduling, announcement, and result delivery — and **result delivery is the root**.
A caller that holds the result has already settled the other two: it must not be queued (it is blocking a turn) and needs no announcement (it will see the result).

Frontmatter `runInBackground` is therefore a default for a caller that has *not* committed.
The second axis is caller determinism: the upstream guard exists because an LLM guesses; a programmatic caller does not.

Both facts are expressed by one discriminated union: a door states whether its answer is a commitment or a fallback.

```typescript
// src/config/invocation-config.ts

/** A door's background-mode answer: a commitment it has made, or a default the agent config may fill. */
export type BackgroundRequest =
  | { kind: "explicit"; isBackground: boolean }
  | { kind: "default"; isBackground: boolean };

/** Resolve the effective background mode. Explicit answers are honored verbatim. */
export function resolveBackgroundMode(
  agentConfig: Pick<AgentConfig, "runInBackground">,
  request: BackgroundRequest,
): boolean {
  return request.kind === "explicit"
    ? request.isBackground
    : (agentConfig.runInBackground ?? request.isBackground);
}
```

Producers, and why each is honest:

| Producer                                              | Request                                           | Reason                                                                               |
| ----------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `spawnBackground`                                     | `{ kind: "explicit", isBackground: true }`        | `resolveSpawnConfig` already merged frontmatter and `AgentTool` routed on the result |
| `SubagentManager.spawnAndWait`                        | `{ kind: "explicit", isBackground: false }`       | delivery commitment — the caller holds the promise                                   |
| `SubagentsServiceAdapter.spawn`, `foreground` set     | `{ kind: "explicit", isBackground: !foreground }` | a deterministic caller committed                                                     |
| `SubagentsServiceAdapter.spawn`, `foreground` omitted | `{ kind: "default", isBackground: true }`         | no commitment; config fills, SDK default is background                               |

The tool door is byte-identical after this change.
`AgentTool` routes to `spawnBackground` only when the merged value was `true`, so `resolveBackgroundMode` receives `explicit,true` and returns `true` — the frontmatter branch is never reached from that door.

### The manager's new resolution step

```typescript
// src/lifecycle/subagent-manager.ts

/** The registry slice the manager needs to resolve a spawn. Narrower than AgentConfigLookup (ISP). */
export interface SpawnTypeResolver {
  resolveType(name: string): string | undefined;
  isValidType(type: string): boolean;
  resolveAgentConfig(type: string): AgentConfig;
}

/** A spawn's resolved identity and mode — the invariants every front door shares. */
interface ResolvedSpawn {
  type: SubagentType;
  isBackground: boolean;
}
```

`spawn` and `spawnAndWait` both delegate to one private `create(...)`; only `spawn` resolves.

```typescript
spawn(snapshot, type, prompt, options: AgentSpawnConfig): string {
  const resolved = this.resolveSpawn(type, options.background);
  return this.create(snapshot, resolved, prompt, options);
}

spawnAndWait(snapshot, type, prompt, options: Omit<AgentSpawnConfig, "background">): Promise<Subagent> {
  const resolved = this.resolveSpawn(type, { kind: "explicit", isBackground: false });
  const id = this.create(snapshot, resolved, prompt, { ...options, background: { kind: "explicit", isBackground: false } });
  // …existing await-the-record body, unchanged
}
```

`resolveSpawn` throws on a disabled type, using the message `resolveSpawnConfig` produces today so the tool door's user-visible text is unchanged:

```typescript
private resolveSpawn(type: string, background: BackgroundRequest): ResolvedSpawn {
  const canonical = this.registry.resolveType(type);
  if (canonical !== undefined && !this.registry.isValidType(canonical)) {
    throw new Error(`Agent type "${canonical}" is disabled`);
  }
  const resolvedType = canonical ?? "general-purpose";
  const agentConfig = this.registry.resolveAgentConfig(resolvedType);
  return { type: resolvedType, isBackground: resolveBackgroundMode(agentConfig, background) };
}
```

Both existing callers already catch: `spawnBackground` wraps `manager.spawn` in `try`/`catch` returning `textResult(err.message)` (`background-spawner.ts:32-45`), and `runForeground` does the same around `spawnAndWait` (`foreground-runner.ts:80-104`), clearing its spinner first.
`SubagentsServiceAdapter.spawn` already throws for "No active session" and model-resolution failures, so a third throw fits its documented contract.

### Background-ness as record state

```typescript
// src/lifecycle/subagent.ts
export interface SubagentInit {
  id: string;
  type: SubagentType;
  description: string;
  isBackground: boolean;   // new, required
  invocation?: AgentInvocation;
  execution: SubagentExecution;
  state?: SubagentState;
}

export class Subagent {
  readonly isBackground: boolean;
  // …
}
```

Consumers then ask the object that owns the fact:

```typescript
// src/ui/agent-widget.ts
private listBackgroundAgents(): Subagent[] {
  return this.manager.listAgents().filter(record => record.isBackground);
}
```

```typescript
// src/lifecycle/subagent-manager.ts — buildObserver stops closing over options
onRunFinished: (agent) => {
  if (agent.isBackground) { /* …notify… */ }
},
```

```typescript
// src/observation/subagent-events-observer.ts — stops hardcoding true
this.emit("subagents:created", { id, type, description, isBackground: record.isBackground });
```

The `subagents:created` payload is unchanged in practice: the manager still fires `onSubagentCreated` only for background agents, so the value is still always `true`.
Reading it from the record removes a latent lie rather than changing the contract, so `README.md:218` and `architecture.md:549` need no edit.

`invocation` is left exactly as it is — built by the tool door, consumed by `buildInvocationTags` for the tool's result display.
It stops being load-bearing for the widget, which restores it to the "captured for UI display" role its own doc comment claims.

### `parentSession` on the SDK door

The adapter must not reach through `currentCtx.sessionManager` (Law of Demeter); `SubagentRuntime` already exposes the accessor at `src/runtime.ts:63`.

```typescript
// src/service/service-adapter.ts
export interface ServiceRuntimeLike {
  readonly currentCtx: SessionContext | undefined;
  buildSnapshot(inheritContext: boolean): ParentSnapshot;
  getSessionInfo(): { parentSessionFile: string; parentSessionId: string };   // new
}
```

Call site:

```typescript
const { parentSessionFile, parentSessionId } = this.runtime.getSessionInfo();
return this.manager.spawn(snapshot, type, prompt, {
  description,
  model,
  parentSession: { parentSessionFile, parentSessionId },   // no toolCallId — there is no tool call
  background: options?.foreground === undefined
    ? { kind: "default", isBackground: true }
    : { kind: "explicit", isBackground: !options.foreground },
  // …existing fields
});
```

`toolCallId` is correctly absent: `ParentSessionInfo.toolCallId` is optional and `Subagent.toolCallId` reads it through `execution.parentSession`, so an SDK-spawned record reports `undefined` — which is the truth.

### Design review notes

- **Dependency width.**
  `SpawnTypeResolver` is three methods, all used by `resolveSpawn`.
  It deliberately does not reuse `AgentConfigLookup`, whose slice (`resolveAgentConfig` + `getToolNamesForType`) is a different pair.
- **Law of Demeter.**
  The `getSessionInfo` addition removes the only reach-through the SDK change would otherwise introduce.
- **Scattered decisions.**
  Five `options.isBackground` reads plus the widget's `invocation?.runInBackground` collapse to one resolution point and one record field.
- **Parameter relay.** `background` is not relayed; it is consumed at the manager and replaced by `ResolvedSpawn.isBackground`.
- **Test mock depth.**
  `SubagentManagerLike.spawn` currently types its options `unknown`, which is why `tsc` never noticed the SDK door omitting a field the tool door passes.
  Tidying 1 closes that hole before the change lands.

## Module-Level Changes

Grep results backing this list: `isBackground|runInBackground` across `packages/pi-subagents/docs/` (excluding `plans/`, `retro/`), `packages/pi-subagents/README.md`, and `.pi/skills/` returns `architecture.md:549`, `README.md:218`, `README.md:339`, and `history/phase-19-implement-ui-decisions.md:76,82`.
The two `history/` hits are a completed phase's record and are left untouched by convention.
`README.md:339` describes the frontmatter key from a user's perspective and is unaffected.
No `.pi/skills/` file names any changed symbol.

### Source

| File                                          | Change                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config/invocation-config.ts`             | Add `BackgroundRequest` union and `resolveBackgroundMode`. `resolveAgentInvocationConfig` is untouched.                                                                                                                                                                                                                                                                                                       |
| `src/lifecycle/subagent-manager.ts`           | Add `SpawnTypeResolver` and a `registry` option. Replace `AgentSpawnConfig.isBackground?: boolean` with required `background: BackgroundRequest`. Add private `resolveSpawn` and `create`; `spawn` resolves, `spawnAndWait` stops delegating to `spawn`. Pass `isBackground` into `new Subagent({...})`. `buildObserver` reads `agent.isBackground` at both gates. Lines 174/194/198 read the resolved value. |
| `src/lifecycle/subagent.ts`                   | Add required `isBackground: boolean` to `SubagentInit` and `readonly isBackground` to `Subagent`.                                                                                                                                                                                                                                                                                                             |
| `src/service/service-adapter.ts`              | Narrow `SubagentManagerLike.spawn`'s `options` to `AgentSpawnConfig` (tidying 1). Add `getSessionInfo` to `ServiceRuntimeLike`. Pass `parentSession` and `background`.                                                                                                                                                                                                                                        |
| `src/tools/background-spawner.ts`             | `isBackground: true` → `background: { kind: "explicit", isBackground: true }`.                                                                                                                                                                                                                                                                                                                                |
| `src/tools/foreground-runner.ts`              | `ForegroundManagerDeps.spawnAndWait` opts become `Omit<AgentSpawnConfig, "background">`.                                                                                                                                                                                                                                                                                                                      |
| `src/tools/agent-tool.ts`                     | `AgentToolManager.spawnAndWait` opts become `Omit<AgentSpawnConfig, "background">`.                                                                                                                                                                                                                                                                                                                           |
| `src/tools/spawn-config.ts`                   | Remove the disabled-type check (lines 83-86) and the now-unreachable error path; `SpawnConfigError` remains for model-resolution failure.                                                                                                                                                                                                                                                                     |
| `src/ui/agent-widget.ts`                      | `listBackgroundAgents` filters `record.isBackground`; update the accessor's doc comment.                                                                                                                                                                                                                                                                                                                      |
| `src/observation/subagent-events-observer.ts` | Emit `record.isBackground` instead of the literal `true`.                                                                                                                                                                                                                                                                                                                                                     |
| `src/index.ts`                                | Pass `registry` into `new SubagentManager({...})` (line 163).                                                                                                                                                                                                                                                                                                                                                 |

### Tests

| File                                                                                                             | Change                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/helpers/make-subagent.ts`                                                                                  | `createTestSubagent` gains an `isBackground?: boolean` option defaulting to `true`, and passes it to `new Subagent`.                                                                                                                                                                                                                                                                                         |
| `test/lifecycle/subagent.test.ts`                                                                                | Local `makeSubagent` gains `isBackground` and an optional raw `state?: SubagentState` escape hatch (tidying 2); five direct `new Subagent({...})` sites route through it.                                                                                                                                                                                                                                    |
| `test/lifecycle/subagent-manager.test.ts`                                                                        | Manager stub gains a registry. `spawnBg`/`spawnFg`/`spawnBgWithToolCall` wrappers plus five inline sites (579, 893, 924, 949, 1001) move to `background: {...}`. New cases: canonical type stored, disabled type throws, `default` request honors frontmatter, `explicit` request ignores it, `spawnAndWait` stays foreground for an agent declaring `runInBackground: true`, record carries `isBackground`. |
| `test/tools/spawn-config.test.ts`                                                                                | Delete the two disabled-agent cases (79-103) and the disabled-Plan registry fixture; they move to the manager suite.                                                                                                                                                                                                                                                                                         |
| `test/service/service-adapter.test.ts`                                                                           | Runtime stub gains `getSessionInfo`. New cases: `parentSession` passed; `background` is `default,true` with no option, `explicit` with `foreground` set; disabled type throws.                                                                                                                                                                                                                               |
| `test/ui/agent-widget.test.ts`                                                                                   | Fixtures switch from `invocation: { runInBackground }` to `isBackground` (lines 30, 33, 220, 361, 375, 382).                                                                                                                                                                                                                                                                                                 |
| `test/observation/subagent-events-observer.test.ts`                                                              | Record fixture supplies `isBackground`; the `subagents:created` assertion at 224-234 is unchanged.                                                                                                                                                                                                                                                                                                           |
| `test/tools/background-spawner.test.ts`, `test/tools/foreground-runner.test.ts`, `test/tools/agent-tool.test.ts` | Assertions on the spawn options object move to the `background` shape.                                                                                                                                                                                                                                                                                                                                       |

### Docs

| File                                | Change                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/architecture/architecture.md` | Class diagram: add `+isBackground` to the `Subagent` class block and `+registry` to `SubagentManager`. The `SubagentManager --> AgentTypeRegistry` edge at line 245 already exists and becomes accurate. Module tree (line 336): note that `invocation-config.ts` also resolves the background mode.                                                                                                             |
| `README.md`                         | In `## For Extension Authors`, document `spawn`'s contract: returns an id immediately, throws when there is no active session, when a model string does not resolve, and when the named agent type is disabled; the agent type is canonicalized and an unknown type falls back to `general-purpose`; `foreground` omitted defers to the agent's `run_in_background` frontmatter, `foreground` set wins outright. |
| `docs/configuration.md`             | No change — the `runInBackground` frontmatter key's user-facing meaning is unaffected.                                                                                                                                                                                                                                                                                                                           |

## Test Impact Analysis

**Newly possible.**
`resolveBackgroundMode` is a pure function over a two-variant union and a config field, so all four precedence cases become one-line table tests with no manager, no registry, and no session — previously the precedence lived inside `resolveSpawnConfig`, testable only with a full registry fixture and a params bag.

**Newly required, because a green suite would otherwise hide the regression.**
`test/ui/agent-widget.test.ts:33`'s manager stub returns hand-built objects (`listAgents: () => agents.map(a => ({ invocation: { runInBackground: true }, ...a }))`), never real `Subagent` instances.
It therefore pins the widget's *filter expression* and nothing about how the field arrives.
The end-to-end claim — an SDK spawn produces a record the widget shows — must be pinned in `test/service/service-adapter.test.ts` (the adapter passes a `background` request) and `test/lifecycle/subagent-manager.test.ts` (the manager stamps `isBackground` on the record), not in the widget suite.

**Becomes redundant.**
`test/tools/spawn-config.test.ts:79-103` — the two disabled-agent cases move to the manager suite rather than being edited in place, because the behavior relocates.

**Must stay as-is.**
`test/observation/subagent-events-observer.test.ts:224-234` asserts `subagents:created` carries `isBackground: true`.
The value's provenance changes from a literal to a record read; the assertion is the contract and must not move.

## Invariants at risk

| Invariant                                                        | Source                                  | Pinned by                                                                                                                                              | Action                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Widget shows background agents only; foreground runs suppress it | [ADR-0004] Decision A; phase-19 history | `test/ui/agent-widget.test.ts:355-388` ("does not register the widget when only foreground agents exist"; "renders only background agents when…mixed") | Keep both cases, re-expressed on `isBackground`. They pin the filter's *behavior*, which survives the field swap.                                                                                                                                            |
| `listAgents()` is funnelled through a single background accessor | phase-19 history line 76                | Same file, via the two cases above                                                                                                                     | Preserved — the accessor keeps its single-point role; only its predicate changes.                                                                                                                                                                            |
| Foreground `spawnAndWait` runs immediately and is awaited        | `subagent-manager.ts:214-224`           | `test/lifecycle/subagent-manager.test.ts` foreground cases                                                                                             | New risk introduced by this change: `spawnAndWait` stops delegating to `spawn`, so a bug could route it through the limiter. Add an explicit case that `spawnAndWait` stays foreground even for an agent whose frontmatter declares `runInBackground: true`. |
| The tool door's user-visible disabled-agent error text           | `spawn-config.ts:85`                    | `test/tools/spawn-config.test.ts:89,103`                                                                                                               | Message string is reused verbatim in the manager's throw; the relocated tests assert the same two strings, including canonical casing for case-insensitive input.                                                                                            |
| `subagents:created` payload shape                                | `architecture.md:549`, `README.md:218`  | `test/observation/subagent-events-observer.test.ts:224-234`                                                                                            | Unchanged.                                                                                                                                                                                                                                                   |
| Core holds no policy                                             | `architecture.md` core responsibilities | No test                                                                                                                                                | The disabled check is registry config, not permission policy. Recorded here rather than asserted.                                                                                                                                                            |

No quantitative invariant (prompt prefix bytes, token budget, cache characteristic) is touched.

## TDD Order

1. **`refactor(pi-subagents): type SubagentManagerLike.spawn options as AgentSpawnConfig`** Prepares: the SDK door's options object is currently typed `unknown` at `service-adapter.ts:20`, which is precisely why `tsc` never flagged the omission [#724] reports.
   Narrowing it first means the later `background` field lands as a compile error at the SDK door rather than a test-only failure.
   No test changes; `pnpm run check` is the verification.

2. **`test(pi-subagents): route subagent.test.ts constructions through makeSubagent`** Prepares: `SubagentInit` gains a required `isBackground` in step 5.
   Five sites bypass the file's local `makeSubagent` factory (lines 139, 146, 154, and the `createRunnableAgent` / `createResumableAgent` helpers), so the required field would touch six places instead of one.
   Add an optional raw `state?: SubagentState` escape hatch to `MakeSubagentOptions` — the three inline sites build a `SubagentState` externally and mutate it after construction to test live delegation, which the existing flat-overrides shape cannot express — then convert all five.
   No assertions change; the suite must stay green.

3. **`refactor(pi-subagents): add BackgroundRequest and resolveBackgroundMode`** Red: table tests in a new `test/config/background-mode.test.ts` for all four cases — `explicit,true`; `explicit,false` with frontmatter `true` (explicit wins); `default,true` with frontmatter `false` (frontmatter wins); `default,true` with frontmatter absent (request's own value).
   Green: the union and the pure function in `src/config/invocation-config.ts`.
   Commit as `refactor:`, not `feat:` — no code imports it yet, so nothing is observable until step 4 wires it up, and that step carries the `fix:`.

4. **`fix(pi-subagents): resolve agent type and background mode at the manager choke point`** Red: new cases in `test/lifecycle/subagent-manager.test.ts` — a canonical type is stored for case-variant input; a known-but-disabled type throws with the canonical casing in the message; a `default` request honors frontmatter; an `explicit` request ignores it; `spawnAndWait` stays foreground for an agent declaring `runInBackground: true`.
   Green: `SpawnTypeResolver`, the `registry` option, `resolveSpawn`, the private `create`, `spawnAndWait` no longer delegating to `spawn`, `AgentSpawnConfig.isBackground` → required `background`.
   Same commit, because the field replacement breaks every caller at the type level: `background-spawner.ts`, `foreground-runner.ts`, `agent-tool.ts`'s two narrow interfaces, `service-adapter.ts`, `index.ts`'s manager construction, and their tests.
   Also in this commit: delete the disabled check from `spawn-config.ts`, delete `test/tools/spawn-config.test.ts:79-103` and its disabled-Plan fixture (the behavior relocates, so this is a move, not an edit).

5. **`fix(pi-subagents): stamp background mode on the subagent record`** Red: a manager case asserting the spawned record carries `isBackground` matching the resolved mode; the widget suite's fixtures move from `invocation: { runInBackground }` to `isBackground`, and the two existing filter cases must still pass.
   Green: required `isBackground` on `SubagentInit`, `readonly isBackground` on `Subagent`, the manager stamping it, the widget filtering on it, `buildObserver` reading `agent.isBackground` at both gates, `subagent-events-observer` emitting `record.isBackground`, and `test/helpers/make-subagent.ts` defaulting the option to `true`.
   One commit: the required field breaks every construction site at the type level.

6. **`fix(pi-subagents): pass parentSession through the SDK spawn path`** Red: a `service-adapter.test.ts` case asserting `manager.spawn` receives `parentSession` with the runtime's session id and file, and no `toolCallId`.
   Green: `getSessionInfo` on `ServiceRuntimeLike`, the runtime stub in tests, and the adapter call site.

7. **`docs(pi-subagents): document the SDK spawn contract and the manager's registry edge`** `README.md`'s `## For Extension Authors` gains `spawn`'s throw conditions, type-canonicalization behavior, and `foreground` precedence.
   `architecture.md`'s class diagram gains `+isBackground` on `Subagent` and `+registry` on `SubagentManager`; the module-tree note for `invocation-config.ts` mentions background-mode resolution.
   Verify the Mermaid class diagram renders before committing.

## Risks and Mitigations

| Risk                                                                                          | Mitigation                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spawnAndWait` no longer delegating to `spawn` silently drops a step the delegation performed | Step 4 diffs the two paths explicitly: both must call the same private `create`, and the existing foreground cases plus the new frontmatter-`true` case run before the commit lands.                                                         |
| Moving the disabled check changes the tool door's error text or timing                        | The throw reuses the exact string from `spawn-config.ts:85`, and the relocated tests assert both strings including canonical casing. Timing shifts from before `buildSnapshot` to inside the manager call, which both runners already catch. |
| The widget suite's hand-built stubs let a field-plumbing regression pass green                | Named in Test Impact Analysis: the end-to-end claim is pinned in the adapter and manager suites, which use the real `Subagent`.                                                                                                              |
| A `toMatchObject`/`objectContaining` assertion absorbs a wrong `background` shape             | `test/service/service-adapter.test.ts:257-280` uses `expect.objectContaining`. Re-read those two assertions by hand after step 4 rather than trusting the green run.                                                                         |
| `AgentSpawnConfig.background` required breaks a caller the greps missed                       | `pnpm run check` catches every one — that is the point of making it required, and tidying 1 extends the coverage to the SDK door.                                                                                                            |
| The new `SpawnTypeResolver` duplicates `AgentConfigLookup` and `fallow` flags one as dead     | Both are consumed: `AgentConfigLookup` by seven existing modules, `SpawnTypeResolver` by the manager. Run `pnpm fallow dead-code` before pushing.                                                                                            |

## Open Questions

- Should `SubagentRecord` eventually expose `isBackground` so an SDK consumer can filter its own listing?
  Deferred: no divergence in this plan needs it, and adding it as required is breaking.
  PR [#748] proposes a related widening and raises the same concern; it is the natural place to settle the whole `SubagentRecord` allowlist question at once.
- Should a discarded caller parameter be reported rather than silently dropped?
  That question belongs to [#829], which owns the precedence policy.

[#448]: https://github.com/gotgenes/pi-packages/issues/448
[#724]: https://github.com/gotgenes/pi-packages/issues/724
[#748]: https://github.com/gotgenes/pi-packages/pull/748
[#827]: https://github.com/gotgenes/pi-packages/issues/827
[#828]: https://github.com/gotgenes/pi-packages/issues/828
[#829]: https://github.com/gotgenes/pi-packages/issues/829
[ADR-0004]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/docs/decisions/0004-reconsider-ui-direction.md
