---
issue: 231
issue_title: "Push exec/registry relay deps to runner construction (Phase 15, Step 3)"
---

# Push exec/registry relay deps to runner construction

## Problem Statement

`AgentManager` receives `exec` and `registry` in its constructor but never uses them directly.
They are stored as fields solely to relay them into `runner.run()` via the `RunContext` parameter.
This makes `AgentManager` wider than necessary and prevents the runner from being self-contained — a prerequisite for #229 (Agent.run() absorbs startAgent).

## Goals

- Move `exec` and `registry` from `AgentManager` construction to `ConcreteAgentRunner` construction.
- Remove `exec` and `registry` from `AgentManagerOptions` (7 → 5 fields).
- Remove `exec` and `registry` from `RunContext` (4 → 2 fields).
- Group runner-owned dependencies in a `RunnerDeps` interface: `{ io, exec, registry }`.
- Replace `runAgent()`'s `io: RunnerIO` parameter with `deps: RunnerDeps`.

## Non-Goals

- Dissolving `RunContext` entirely — it shrinks to `{ cwd?, parentSession? }`, which is still a coherent per-call grouping.
  Issue #229 will likely dissolve it when `Agent.run()` calls the runner directly.
- Changing the `AgentRunner` interface's `run()` signature — callers continue to pass `RunOptions` with `context: RunContext`.
  `ConcreteAgentRunner` merges its stored deps before calling `runAgent()`.
- Touching `resume()` or `resumeAgent()` — they don't use `exec` or `registry`.

## Background

Issue #169 extracted `RunContext` from `RunOptions` to group the 4 parent-context fields: `exec`, `registry`, `cwd`, `parentSession`.
The doc comment describes them as "parent environment and identity" fields.
However, 2 of the 4 fields (`exec`, `registry`) are static — identical across every `run()` call — while the other 2 (`cwd`, `parentSession`) vary per spawn.
The static pair are relay-only dependencies on `AgentManager`: stored at construction, never read, only forwarded.

From the code-design skill, this is a **parameter relay** smell: intermediaries (`AgentManager`) carry fields they never use, only to thread them to the endpoint (`runAgent`).
The fix: put them on the object the endpoint owns — the runner.

### Key references

- `src/lifecycle/agent-manager.ts` — stores `exec` and `registry`, relays them at lines 193–194.
- `src/lifecycle/agent-runner.ts` — `RunContext` interface (line 125), `ConcreteAgentRunner` class (line 189), `runAgent()` free function (line 236).
- `src/index.ts` — constructs both `ConcreteAgentRunner` and `AgentManager` (lines 148–157).
- Phase 15 roadmap in `docs/architecture/architecture.md` § Step 3.

## Design Overview

### RunnerDeps — grouping runner-owned dependencies

A new `RunnerDeps` interface groups the three dependencies that the runner owns:

```typescript
export interface RunnerDeps {
  io: RunnerIO;
  exec: ShellExec;
  registry: AgentConfigLookup;
}
```

`ConcreteAgentRunner` takes `RunnerDeps` at construction:

```typescript
export class ConcreteAgentRunner implements AgentRunner {
  constructor(private readonly deps: RunnerDeps) {}

  run(snapshot, type, prompt, options) {
    return runAgent(snapshot, type, prompt, options, this.deps);
  }
}
```

`runAgent()` changes its last parameter from `io: RunnerIO` to `deps: RunnerDeps`:

```typescript
export async function runAgent(
  snapshot: ParentSnapshot,
  type: SubagentType,
  prompt: string,
  options: RunOptions,
  deps: RunnerDeps,
): Promise<RunResult> {
  const effectiveCwd = options.context?.cwd ?? snapshot.cwd;
  const env = await deps.io.detectEnv(deps.exec, effectiveCwd);
  // ...
  const cfg = assembleSessionConfig(type, ..., deps.registry, deps.io.assemblerIO);
  // ...
}
```

### RunContext shrinks

`RunContext` loses `exec` and `registry`:

```typescript
export interface RunContext {
  /** Override working directory (e.g. for worktree isolation). */
  cwd?: string;
  /** Parent session identity (file path + session ID). */
  parentSession?: ParentSessionInfo;
}
```

The `AgentRunner.run()` interface is unchanged — callers still pass `RunOptions` with `context: RunContext`.
`ConcreteAgentRunner.run()` reads `exec` and `registry` from its own `deps` instead of from `options.context`.

### AgentManager loses 2 fields

`AgentManagerOptions` removes `exec` and `registry`.
`AgentManager` removes the corresponding private fields and the `this.exec` / `this.registry` relay in `startAgent()`.
The `context` object constructed in `startAgent()` shrinks from 4 fields to 2:

```typescript
context: {
  cwd: record.worktreeState?.path,
  parentSession: options.parentSession,
},
```

### Wiring in index.ts

```typescript
const runner = new ConcreteAgentRunner({
  io: runnerIO,
  exec: (cmd, args, opts) => pi.exec(cmd, args, opts),
  registry,
});

const manager = new AgentManager({
  runner,
  worktrees: new GitWorktreeManager(process.cwd()),
  observer,
  getMaxConcurrent: () => settings.maxConcurrent,
  getRunConfig: () => settings,
});
```

## Module-Level Changes

### `src/lifecycle/agent-runner.ts`

1. Add `RunnerDeps` interface (exported): `{ io: RunnerIO; exec: ShellExec; registry: AgentConfigLookup }`.
2. Remove `exec` and `registry` from `RunContext`.
   Update doc comment to reflect the 2 remaining per-call fields.
3. Update `ConcreteAgentRunner` constructor: accept `RunnerDeps` instead of `RunnerIO`.
4. Update `ConcreteAgentRunner.run()`: pass `this.deps` to `runAgent()`.
5. Update `runAgent()`: change last parameter from `io: RunnerIO` to `deps: RunnerDeps`.
   Replace `io.` references with `deps.io.`, `options.context.exec` with `deps.exec`, `options.context.registry` with `deps.registry`.

### `src/lifecycle/agent-manager.ts`

1. Remove `exec: ShellExec` and `registry: AgentTypeRegistry` from `AgentManagerOptions`.
2. Remove `private readonly exec` and `private readonly registry` fields from `AgentManager`.
3. Remove assignment of `this.exec` and `this.registry` in the constructor.
4. Remove `exec: this.exec` and `registry: this.registry` from the `context` object in `startAgent()`.
5. Remove `ShellExec` and `AgentTypeRegistry` imports (verify no other references first).

### `src/index.ts`

1. Move `exec` and `registry` from the `AgentManager` constructor call to `ConcreteAgentRunner`: `new ConcreteAgentRunner({ io: runnerIO, exec: ..., registry })`.
2. Remove `exec` and `registry` from the `AgentManager({...})` constructor argument.

### `test/lifecycle/agent-runner.test.ts`

1. Update all `runAgent(..., io)` calls to `runAgent(..., { io, exec, registry: mockAgentLookup })`.
2. Remove `exec` and `registry` from `context:` objects in `RunOptions`.
   `context: { exec, registry: mockAgentLookup }` → `context: {}` or `{}`.

### `test/lifecycle/agent-runner-extension-tools.test.ts`

1. Same pattern as `agent-runner.test.ts`: update `runAgent(..., io)` last param and strip `exec`/`registry` from `context:`.

### `test/lifecycle/concrete-agent-runner.test.ts`

1. Update `new ConcreteAgentRunner(io)` → `new ConcreteAgentRunner({ io, exec: vi.fn(), registry })`.
2. Remove `exec` and `registry` from the `context:` in `runner.run()` call options.

### `test/lifecycle/agent-manager.test.ts`

1. Remove `exec: vi.fn()` and `registry: testRegistry` from `createManager()` factory.
2. Remove the `testRegistry` construction and `AgentTypeRegistry` import if no other references exist.

### `test/helpers/runner-io.ts`

1. No structural changes needed — `createRunnerIO()` returns the `RunnerIO` shape, which is unchanged.
   However, add a `createRunnerDeps()` convenience factory that bundles `{ io: createRunnerIO(), exec: vi.fn(), registry: createAgentLookup() }` for runner test files.

### `docs/architecture/architecture.md`

1. Update the `RunContext` code block in § "RunOptions (12 fields → extract RunContext)" to show only `cwd` and `parentSession`.
2. Update the field-count description (4 → 2 per-call fields).
3. Mark Step 3 as complete in the Phase 15 roadmap.

## Test Impact Analysis

1. No new test surfaces are needed — this is a pure mechanical refactoring (moving constructor parameters).
   The existing runner and manager test suites fully cover the behavior.
2. No existing tests become redundant — all tests exercise the same interactions, just with deps flowing through a different path.
3. Existing `agent-manager.test.ts` tests remain as-is in coverage scope.
   They verify `AgentManager` behavior (spawning, queueing, abort, etc.) independent of runner deps.
4. Existing `agent-runner.test.ts` and `concrete-agent-runner.test.ts` tests remain.
   They verify `runAgent()` and `ConcreteAgentRunner` behavior.
   Call-site patterns change but assertions stay the same.

## TDD Order

1. **Add `RunnerDeps` interface and update `runAgent()` parameter** — define `RunnerDeps`, change `runAgent()`'s last param from `io` to `deps`, update internal references.
   Update `agent-runner.test.ts` and `agent-runner-extension-tools.test.ts` call sites.
   Commit: `refactor: add RunnerDeps and update runAgent parameter (#231)`

2. **Update `ConcreteAgentRunner` to accept `RunnerDeps`** — change constructor from `RunnerIO` to `RunnerDeps`, update `.run()` to pass `this.deps`.
   Update `concrete-agent-runner.test.ts`.
   Add `createRunnerDeps()` helper to `test/helpers/runner-io.ts`.
   Commit: `refactor: ConcreteAgentRunner accepts RunnerDeps (#231)`

3. **Remove `exec` and `registry` from `RunContext`** — shrink the interface to 2 fields, update doc comment.
   Strip `exec`/`registry` from `context:` in all runner test call sites.
   Run `pnpm run check` to verify no stale references.
   Commit: `refactor: remove exec and registry from RunContext (#231)`

4. **Remove `exec` and `registry` from `AgentManager`** — remove from `AgentManagerOptions`, remove class fields, remove relay in `startAgent()`, clean up imports.
   Update `agent-manager.test.ts` factory.
   Commit: `refactor: remove relay deps from AgentManager (#231)`

5. **Update wiring in `index.ts`** — move `exec` and `registry` from `AgentManager` construction to `ConcreteAgentRunner` construction.
   Commit: `refactor: wire exec and registry to ConcreteAgentRunner (#231)`

6. **Update architecture docs** — update `RunContext` description and field counts, mark Step 3 complete.
   Commit: `docs: update architecture for runner self-contained (#231)`

## Risks and Mitigations

1. **Test churn** — ~20 `runAgent()` call sites change their last parameter pattern.
   Mitigation: mechanical find-and-replace; assertions stay identical.
2. **Step ordering** — Steps 3 and 4 both remove `exec`/`registry` from different types.
   If done in the wrong order, intermediate commits may not type-check.
   Mitigation: Step 1–2 add the new path (`deps`), Step 3 removes from `RunContext` (runner side), Step 4 removes from `AgentManager` (manager side), Step 5 wires them together.
   Each commit is independently valid.
3. **Import cleanup** — removing `exec`/`registry` from `AgentManager` may leave unused imports (`ShellExec`, `AgentTypeRegistry`).
   Mitigation: grep for other usages before removing; `pnpm run check` catches unused imports.

## Open Questions

- None — the issue scope is narrow and the design is straightforward.
