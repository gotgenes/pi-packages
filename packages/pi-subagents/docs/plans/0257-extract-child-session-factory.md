---
issue: 257
issue_title: "Extract ChildSessionFactory from runner"
---

# Extract ChildSessionFactory from runner

> Superseded — issue #257 was closed `not_planned`.
> Planning this extraction exposed that worktree isolation does not belong in the core; see [ADR-0002] and the reclaimed Phase 16 roadmap in [`docs/architecture/architecture.md`](../architecture/architecture.md).
> The structural goal is recovered by #265.
> This plan is retained for historical context only.

## Problem Statement

`runAgent()` in `src/lifecycle/agent-runner.ts` conflates two concerns.
The first is session *creation* — platform plumbing: env detection, config assembly, resource-loader construction, session-manager creation, `createSession()`, permission-bridge registration, `bindExtensions()`, and the post-bind recursion-guard tool filter.
The second is session *interaction* — prompting, turn tracking, soft/hard turn-limit enforcement, response collection, and abort forwarding.

This is Phase 16, Step 2 of the agent-collaborator architecture (`docs/architecture/architecture.md`).
The step extracts the creation concern into a narrow `ChildSessionFactory` collaborator so session creation becomes independently testable and so `permission-bridge.ts` is imported by the factory rather than the runner.
This is a lift-and-shift: `runAgent()` keeps its signature and delegates creation to the factory internally.
`Agent` is not touched — that is Step 3 (#258).

## Goals

- Define `ChildSessionFactory` (one method, `create(cwd?)`) and `ChildSessionResult` in a new module `src/lifecycle/child-session-factory.ts`.
- Move the session-creation block out of `runAgent()` into a `ConcreteChildSessionFactory` class bound per-agent with creation config.
- Move the `permission-bridge.ts` imports (`registerChildSession` / `unregisterChildSession`) and the recursion-guard helpers (`EXCLUDED_TOOL_NAMES`, `filterActiveTools`) from `agent-runner.ts` into the factory.
- Expose teardown as a `cleanup()` function on the result so the runner (and, in Step 3, `Agent`) never imports the permission bridge.
- Keep `runAgent()`'s signature `(snapshot, type, prompt, options, deps)` stable so the existing runner test suite continues to pass through delegation.
- Add factory-level unit tests for session creation.

This change is **not** breaking to any published API — `runAgent`, `RunnerDeps`, the IO interfaces, and the new factory types are all internal to the package.

## Non-Goals

- No changes to `Agent` (`src/lifecycle/agent.ts`), `AgentManager`, or the tools — Step 3 (#258) makes `Agent` own the session and call `factory.create()`.
- No `ConcreteAgentRunner.createFactory()` method yet — see the Design Overview decision below; it is added in Step 3 when `AgentManager` becomes its consumer.
- No removal of `runAgent`, `resumeAgent`, `RunOptions`, `RunResult`, or the runner concept — that is Step 4 (#259).
- No relocation of the session-creation IO interfaces (`RunnerIO`, `RunnerDeps`, `EnvironmentIO`, `SessionFactoryIO`, `CreateSessionOptions`, `ResourceLoaderOptions`, `ResourceLoaderLike`, `SessionManagerLike`) out of `agent-runner.ts` — they stay put to minimize churn; their home is revisited when the runner dissolves in Step 4.
- No change to `assembleSessionConfig`, `session-config.ts`, `worktree-isolation.ts`, or the permission-bridge module itself.

## Background

Relevant modules:

- `src/lifecycle/agent-runner.ts` — `runAgent()` performs creation (effectiveCwd resolution, `detectEnv`, `assembleSessionConfig`, `createResourceLoader`+`reload`, `deriveSessionDir`, `createSessionManager`+`newSession`, `createSession`, `registerChildSession`, `bindExtensions`, post-bind `filterActiveTools`) then interaction (turn-tracking subscription, `collectResponseText`, `forwardAbortSignal`, `prompt`, finally `unregisterChildSession`, build `RunResult`).
  Holds the IO interfaces and `RunnerDeps`; `ConcreteAgentRunner.run()` delegates to `runAgent(..., this.deps)`.
- `src/lifecycle/permission-bridge.ts` — `registerChildSession` / `unregisterChildSession`; no-ops when pi-permission-system is absent.
  Currently imported only by `agent-runner.ts`.
- `src/session/session-config.ts` — `assembleSessionConfig()` returns `SessionConfig` with `effectiveCwd`, `systemPrompt`, `toolNames`, `extensions`, `thinkingLevel`, `noSkills`, and `agentMaxTurns` (= `agentConfig.maxTurns`).
- `src/lifecycle/agent.ts` — `Agent.run()` calls `this._runner.run(...)`; `Agent` imports `RunResult` from the runner.
  Unchanged in this step.
- `src/index.ts:136-166` — constructs `runnerDeps: RunnerDeps` and `new ConcreteAgentRunner(runnerDeps)`.
  Unchanged.

Existing tests touching the runner:

- `test/lifecycle/agent-runner.test.ts` (313 lines) — final-output capture, `bindExtensions` ordering, cwd/agentDir wiring, AGENTS.md suppression, `sessionFile` in `RunResult`, `newSession` with `parentSession`, `defaultMaxTurns`/`graceTurns` enforcement, resume fallback, and a permission-bridge describe block (register-before-bind, unregister-on-success, unregister-on-throw, sessionDir-as-key, agentName/parentSessionId).
  All exercise `runAgent()` directly via the `createRunnerIO()` helper and a `vi.mock("#src/lifecycle/permission-bridge")`.
- `test/lifecycle/agent-runner-extension-tools.test.ts` — the post-bind recursion guard (`setActiveToolsByName` ordering, EXCLUDED filtering, `extensions: false` skip).
- `test/lifecycle/agent-runner-settings.test.ts` — `normalizeMaxTurns` only.
- `test/lifecycle/concrete-agent-runner.test.ts` — `ConcreteAgentRunner.run()`/`resume()` delegation.
- `test/helpers/runner-io.ts` — `createRunnerIO()`, `createAgentLookup()`, `createRunnerDeps()` shared stubs.

AGENTS.md / skill constraints that apply:

- ES2024 target; Biome (not Prettier) formats; tabs (match `permission-bridge.ts`/`worktree-isolation.ts` style — new file uses tabs).
- Tests use `vi.hoisted(...)` for module-level mocks (the permission-bridge mock pattern already exists).
- fallow flags exports/members with no production consumer — drives the `createFactory` deferral decision below and the requirement that the factory have a production consumer (`runAgent`) by the end of the work.
- The full vitest suite must pass before publishing.

## Design Overview

### Decision model

`runAgent()` keeps its signature.
Internally it constructs a `ConcreteChildSessionFactory` from the creation-relevant inputs plus `deps`, calls `factory.create(options.context.cwd)` to obtain `{ session, outputFile, cleanup, agentMaxTurns }`, then runs the unchanged interaction logic.
The `finally` block calls `cleanup()` instead of `unregisterChildSession(sessionDir)`.
`RunResult.sessionFile` comes from the factory's `outputFile` instead of a second `sessionManager.getSessionFile()` call at the end (same value — `getSessionFile()` is stable after `newSession()`; the existing test asserts the constant `/sessions/child.jsonl`).

### Data shapes

```typescript
// src/lifecycle/child-session-factory.ts
import type { Model } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { RunnerDeps } from "#src/lifecycle/agent-runner";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import type { ParentSessionInfo, SubagentType, ThinkingLevel } from "#src/types";

/** Per-agent session-creation config, bound at factory construction. */
export interface ChildSessionConfig {
	snapshot: ParentSnapshot;
	type: SubagentType;
	model?: Model<any>;
	isolated?: boolean;
	thinkingLevel?: ThinkingLevel;
	parentSession?: ParentSessionInfo;
}

/** Result of creating a configured child session. */
export interface ChildSessionResult {
	session: AgentSession;
	/** Path to the persisted session JSONL file, if persisted. */
	outputFile?: string;
	/** Tear down creation side effects (permission-bridge unregister). */
	cleanup: () => void;
	/**
	 * Per-agent configured max turns (from agentConfig.maxTurns) for the
	 * caller's turn-limit enforcement. Crosses the creation/interaction seam
	 * because it is computed during config assembly but consumed by the run loop.
	 */
	agentMaxTurns?: number;
}

/** Creates a configured child AgentSession. Narrow: one method. */
export interface ChildSessionFactory {
	create(cwd?: string): Promise<ChildSessionResult>;
}

export class ConcreteChildSessionFactory implements ChildSessionFactory {
	constructor(
		private readonly config: ChildSessionConfig,
		private readonly deps: RunnerDeps,
	) {}

	async create(cwd?: string): Promise<ChildSessionResult> { /* lifted creation block */ }
}
```

Two deliberate refinements of the issue's sketch, both forced by the lift-and-shift and documented here:

1. `ChildSessionResult` adds `agentMaxTurns?: number`.
   The turn-limit resolution `normalizeMaxTurns(options.maxTurns ?? cfg.agentMaxTurns ?? options.defaultMaxTurns)` lives in the interaction half (`runAgent`), but `cfg.agentMaxTurns` is only known after `assembleSessionConfig`, which moves into the factory.
   The narrowest way to carry it across the seam is a single field on the result (ISP — not the whole `SessionConfig`).
   It remains useful in Step 3 when `Agent` owns turn enforcement.
2. `ChildSessionConfig` is narrow — only the six creation inputs.
   The issue's target lists `prompt`, `maxTurns`, and `getRunConfig` as bound config, but those are interaction concerns; binding them now would violate ISP for a factory whose only job is creation.
   They stay in `runAgent`'s `options` and migrate to the factory's config only if/when Step 3 needs them there.

### Why `ConcreteAgentRunner.createFactory()` is deferred to Step 3

The issue describes the runner gaining `createFactory(config)`.
Adding it in this step produces an unused class member: `runAgent()` builds the factory directly (it is a free function with `deps`, not a runner instance), and `AgentManager` — the eventual caller of `createFactory` — is not wired to it until Step 3. fallow flags unused class members.
Adding it now would require either a `// fallow-ignore` suppression or rewiring `ConcreteAgentRunner.run()` to take a factory, which would change `runAgent`'s signature and force a premature rewrite of the 313-line runner test file.
Deferring `createFactory` to Step 3 keeps this step a clean, fallow-green lift-and-shift and aligns with the architecture's "Agent is not changed yet" framing.
The factory still has a production consumer in this step — `runAgent` — so the new class is not dead.

### Consumer call-site sketch (Tell-Don't-Ask)

`runAgent()` after extraction (interaction only):

```typescript
const factory = new ConcreteChildSessionFactory(
	{
		snapshot,
		type,
		model: options.model,
		isolated: options.isolated,
		thinkingLevel: options.thinkingLevel,
		parentSession: options.context.parentSession,
	},
	deps,
);
const { session, outputFile, cleanup, agentMaxTurns } = await factory.create(options.context.cwd);

options.onSessionCreated?.(session);
const maxTurns = normalizeMaxTurns(options.maxTurns ?? agentMaxTurns ?? options.defaultMaxTurns);
// ... turn-tracking subscription, collector, abort forwarding ...
try {
	await session.prompt(effectivePrompt);
} finally {
	unsubTurns();
	collector.unsubscribe();
	cleanupAbort();
	cleanup(); // was: unregisterChildSession(sessionDir)
}
return { responseText, session, aborted, steered: softLimitReached, sessionFile: outputFile };
```

`runAgent` tells the factory "create me a session" and tells the result "clean up" — no reach-through, no bridge import.

### Extracted-module interaction with upstream dependencies

`ConcreteChildSessionFactory.create()` is the verbatim creation block, re-rooted onto `this.config` / `this.deps`.
It carries no output-argument mutation or reverse-search patterns from the original (the block already only reads from `deps.io` and returns a session).
The one in-place dependency it touches — `sessionManager` from `deps.io.createSessionManager` — is local to `create()`, captured in the returned `outputFile` and `cleanup` closure (which closes over `sessionDir`).
The upstream API (`deps.io`, `assembleSessionConfig`, the permission-bridge functions) needs no changes; nothing about the seam requires fixing an upstream gap first.

The factory reads four of `ParentSnapshot`'s fields (`cwd`, `systemPrompt`, `model`, `modelRegistry`); `parentContext` stays with `runAgent` for the prompt prefix.
Passing the cohesive `ParentSnapshot` value object whole is appropriate.

### Edge cases

- `cwd` omitted → `create()` falls back to `snapshot.cwd`, identical to today's `options.context.cwd ?? snapshot.cwd`.
- `extensions: false` → factory skips the recursion-guard filter (`setActiveToolsByName` not called), identical to today.
- `prompt()` throws → `runAgent`'s `finally` still calls `cleanup()`, so `unregisterChildSession` runs (existing "unregisters even when prompt throws" test preserved).
- pi-permission-system absent → register/unregister remain no-ops (bridge behavior unchanged).

## Module-Level Changes

- New: `src/lifecycle/child-session-factory.ts`
  - `ChildSessionConfig`, `ChildSessionResult`, `ChildSessionFactory` interfaces.
  - `ConcreteChildSessionFactory` class with the lifted `create(cwd?)` body.
  - Moved here from `agent-runner.ts`: the `registerChildSession` / `unregisterChildSession` imports, the `EXCLUDED_TOOL_NAMES` constant, and the `filterActiveTools` helper.
  - Imports (type-only) `RunnerDeps` from `agent-runner.ts` — type-only, so no runtime import cycle; the runtime arrow is one-way (`agent-runner` imports the factory class as a value).
- Changed: `src/lifecycle/agent-runner.ts`
  - Remove the permission-bridge import, `EXCLUDED_TOOL_NAMES`, and `filterActiveTools`.
  - Add `import { ConcreteChildSessionFactory } from "#src/lifecycle/child-session-factory"`.
  - `runAgent()`: replace the creation block (effectiveCwd → post-bind filter) with `new ConcreteChildSessionFactory(...).create(options.context.cwd)`; resolve `maxTurns` from the returned `agentMaxTurns`; call `cleanup()` in the `finally`; set `RunResult.sessionFile = outputFile`.
  - Keep `RunnerDeps`, all IO interfaces, `RunResult`, `RunOptions`, `normalizeMaxTurns`, `collectResponseText`, `getLastAssistantText`, `forwardAbortSignal`, `resumeAgent`, `getAgentConversation`, and `ConcreteAgentRunner` unchanged.
  - Check the unused-import set after the move: `AgentSession` and `assembleSessionConfig`/`AssemblerIO` may no longer be referenced in `agent-runner.ts` once creation leaves; remove any now-dead imports (the factory imports them instead).
- Doc updates (`docs/architecture/architecture.md`):
  - Lifecycle subgraph (≈ lines 54-60): add a `ChildSessionFactory` node; rewire the `AgentRunner --> SessionConfig` edge to `AgentRunner --> ChildSessionFactory --> SessionConfig` (the subscribe edges from observers stay on `AgentRunner`).
  - Layout listing (≈ lines 270-280): add `child-session-factory.ts   child session creation (env, config assembly, bind, tool filter)`; update the `agent-runner.ts` line to "turn loop, results (creation delegated to ChildSessionFactory)".
  - Component dependency bullets (≈ lines 354-357): update the `agent-runner` bullet and add a `child-session-factory` bullet.
  - The fallow health snapshot (dated table, ≈ line 925) is left unchanged — it is a point-in-time fallow dump regenerated at phase boundaries, not per-step.
- Doc update (`.pi/skills/package-pi-subagents/SKILL.md`): Lifecycle domain row — add `child-session-factory.ts`; bump the Lifecycle module count (9 → 10) and the total file count (56 → 57).

Removed/moved symbols and their consumers (grepped across `src/` and `test/`):

- `EXCLUDED_TOOL_NAMES`, `filterActiveTools` — private to `agent-runner.ts`, no other consumer; moved (not deleted) into the factory.
- `registerChildSession` / `unregisterChildSession` imports — only `agent-runner.ts` imported them in `src/`; the import moves to the factory.
  The test mock `vi.mock("#src/lifecycle/permission-bridge")` is path-based and continues to intercept the factory's import unchanged.
- No exported symbol is removed, so no excess-property or dangling-import breakage in `src/`.

## Test Impact Analysis

1. New unit tests enabled by the extraction (`test/lifecycle/child-session-factory.test.ts`, using `createRunnerDeps()` + a session stub):
   - register-before-`bindExtensions` ordering; register key = `sessionDir`; `agentName`/`parentSessionId` forwarded.
   - `cleanup()` calls `unregisterChildSession(sessionDir)`.
   - effective cwd/agentDir wiring into the loader and settings manager; AGENTS.md/CLAUDE.md/APPEND_SYSTEM suppression.
   - `newSession` called with `parentSession`.
   - `outputFile` = persisted session file; `agentMaxTurns` surfaced from the assembled config.
   - post-bind recursion guard: `setActiveToolsByName` once after bind; includes extension tool when `extensions: true`; excludes `EXCLUDED_TOOL_NAMES`; `extensions: false` skips the filter (migrated from `agent-runner-extension-tools.test.ts`).
2. Existing tests that become redundant / can be trimmed: the pure-creation assertions in `agent-runner.test.ts` (cwd/agentDir wiring, AGENTS.md suppression, `newSession` with `parentSession`, the permission "registers before bind"/"registers with sessionDir key"/"agentName+parentSessionId" cases) duplicate the new factory tests once migrated; the `agent-runner-extension-tools.test.ts` recursion-guard block moves to the factory test.
   These all currently pass through `runAgent → factory` delegation, so trimming is cleanup, not a correctness fix.
3. Existing tests that must stay (genuinely exercise the interaction layer or the delegation seam): `agent-runner.test.ts` keeps final-output capture + fallback, `defaultMaxTurns`/`graceTurns`/`maxTurns`-precedence enforcement, resume fallback, "binds extensions before prompting" (the create-then-prompt ordering is `runAgent`'s orchestration), "returns `sessionFile` in `RunResult`" (verifies `runAgent` surfaces `outputFile`), and "unregisters after success"/"unregisters even when prompt throws" (verify `runAgent` calls `cleanup()`).
   `agent-runner-settings.test.ts` (`normalizeMaxTurns`) and `concrete-agent-runner.test.ts` (`run`/`resume` delegation) are untouched.

## TDD Order

1. Add `ChildSessionFactory` with factory-level unit tests.
   Surface: `test/lifecycle/child-session-factory.test.ts`.
   Covers the creation behaviors and the recursion-guard cases listed in Test Impact #1.
   Implement `src/lifecycle/child-session-factory.ts` (interfaces + `ConcreteChildSessionFactory`, with the permission-bridge import and tool-filter helpers).
   The factory is standalone here — `runAgent` still has its own creation copy — so `pnpm fallow dead-code` will transiently flag `ConcreteChildSessionFactory` (consumed in step 2); that is expected and resolved by the next commit.
   Commit: `test(pi-subagents): add ChildSessionFactory creation tests` then `feat(pi-subagents): add ChildSessionFactory for child session creation`.
2. Delegate session creation from `runAgent()` to the factory.
   Rewire `runAgent()` to construct the factory and call `create()`; remove the creation block, the permission-bridge import, `EXCLUDED_TOOL_NAMES`, and `filterActiveTools` from `agent-runner.ts`; resolve `maxTurns` from `agentMaxTurns`; call `cleanup()` in `finally`; set `sessionFile = outputFile`.
   Trim the now-redundant creation tests from `agent-runner.test.ts` and migrate the recursion-guard block out of `agent-runner-extension-tools.test.ts` into the factory test (Test Impact #2).
   The factory now has a production consumer; `pnpm fallow dead-code` is clean.
   Run `pnpm run check` immediately (the creation extraction touches the runner's import surface).
   Commit: `refactor(pi-subagents): runAgent delegates session creation to ChildSessionFactory`.
3. Update the architecture doc and package skill.
   `docs/architecture/architecture.md` (lifecycle subgraph, layout listing, component bullets) and `.pi/skills/package-pi-subagents/SKILL.md` (Lifecycle row + counts).
   Commit: `docs(pi-subagents): reflect ChildSessionFactory extraction in architecture`.

After all steps: `pnpm run check`, `pnpm run lint`, `pnpm -r run test`, `pnpm fallow dead-code`.

## Risks and Mitigations

- Risk: a type-only import of `RunnerDeps` from `agent-runner.ts` into the factory while `agent-runner.ts` value-imports the factory looks circular.
  Mitigation: `import type` is fully erased, so the only runtime arrow is `agent-runner → child-session-factory`; verified by `pnpm run check` after step 2.
- Risk: `RunResult.sessionFile` changes from a late `sessionManager.getSessionFile()` to the factory's `outputFile`.
  Mitigation: `getSessionFile()` is stable after `newSession()`; the existing assertion (`/sessions/child.jsonl`) and the persisted-file test both pass — confirmed by the runner suite in step 2.
- Risk: the permission-bridge module mock stops intercepting after the import moves.
  Mitigation: `vi.mock()` is path-based; the factory imports the same `#src/lifecycle/permission-bridge` path, so the existing mock applies to the factory's calls.
- Risk: trimming/migrating tests across `agent-runner.test.ts` and `agent-runner-extension-tools.test.ts` accidentally drops coverage.
  Mitigation: every trimmed assertion has an equivalent in the new factory test; the suite is the safety net (`pnpm -r run test`).
- Risk: leftover dead imports in `agent-runner.ts` after the creation block leaves.
  Mitigation: step 2 ends with `pnpm run check` + `pnpm run lint`, which flag unused imports.

## Open Questions

- Whether `ChildSessionResult.agentMaxTurns` should become a fully-resolved `maxTurns` (combining `options.maxTurns` / `defaultMaxTurns`) once Step 3 binds `getRunConfig` into the factory config.
  Deferred: keep the raw per-agent value for now; revisit when `Agent` owns turn enforcement.
- Whether the session-creation IO interfaces (`RunnerIO`, `RunnerDeps`, `EnvironmentIO`, `SessionFactoryIO`, `CreateSessionOptions`, etc.) should move from `agent-runner.ts` into `child-session-factory.ts`.
  Deferred to Step 4, when the runner dissolves and the natural home for these creation contracts is the factory module.
- Whether `ConcreteAgentRunner.createFactory()` lands in Step 3 (when `AgentManager` consumes it) exactly as the issue describes.
  Deferred to Step 3 per the Design Overview rationale.

[ADR-0002]: ../decisions/0002-extensions-on-a-minimal-core.md
