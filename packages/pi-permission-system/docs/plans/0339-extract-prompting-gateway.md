---
issue: 339
issue_title: "Extract a context-owning PromptingGateway; collapse the prompt twins"
---

# Extract a context-owning PromptingGateway; collapse the prompt twins

## Problem Statement

`PermissionSession` fuses two unrelated jobs: it owns the mutable session state (context, caches, rules, skill entries) and it plays the prompting role for the gate runner.
The prompting job arrives as two context-bound method twins.
`canPrompt(ctx)` takes the context per call; `canConfirm()` reads the stored context.
`prompt(ctx, details)` takes the context per call; `promptPermission(details)` reads the stored context.
The second member of each pair exists only to bind the stored context, so the class carries four prompting methods where two would do.

The cost lands in the tests.
`makeSession` re-implements the production `canConfirm` / `promptPermission` delegations as closures and threads `undefined as unknown as ExtensionContext` through them because the mock has no real context.
`GateRunner(session, session, session, reporter)` passes one object as three roles, so the prompting role cannot be substituted independently.

This is Phase 4 Step 6 (Track C: split the session), addressing Finding 2 in the architecture roadmap.
It depends on Step 1 ([#334], closed — the injected `PermissionManager` made the session constructable).
It runs parallel with Step 7 ([#340]); both feed Step 8 ([#341]).

## Goals

- Add `src/prompting-gateway.ts`: a `PromptingGateway` collaborator that owns the stored context and exposes a single context-bound prompting pair, `canConfirm()` / `prompt(details)`.
- Move the "can we prompt?" policy (UI / subagent / yolo) into the gateway so the `index.ts` `canRequestPermissionConfirmation` closure disappears (index closures 11 → 10).
- `GateRunner` receives the gateway for the prompting role; `PermissionSession` no longer plays `GatePrompter`.
- Collapse the `canPrompt`/`canConfirm` and `prompt`/`promptPermission` twins into the single context-bound pair on the gateway.
- Rename the `GatePrompter` prompting method `promptPermission` → `prompt` to match the collapsed pair.
- Behavior-preserving: identical runtime decisions; the change relocates collaboration, not logic.

## Non-Goals

- Extracting the `PermissionResolver` role ([#340], Step 7) — that is the parallel track.
- Retiring the fig-leaf role interfaces (`GateHandlerSession`, `AgentPrepSession`, `SessionLifecycleSession`) or splitting `makeSession` per-collaborator ([#341], Step 8).
- Consolidating the session's own context store with the gateway's (see Risks); the session still owns `this.context` for `getRuntimeContext` / `reload` / `logResolvedConfigPaths`.
- Touching `permission-event-rpc.ts`, `lifecycle.ts`, `before-agent-start.ts`, or the logger notify sink — all keep reading `session.getRuntimeContext()` unchanged.

## Background

Relevant modules:

- `src/permission-session.ts` — the god object.
  Today its constructor takes a `PermissionSessionRuntimeDeps` bag (`{ canRequestPermissionConfirmation, prompter }`).
  Its prompting methods are `canPrompt(ctx)`, `prompt(ctx, details)`, `canConfirm()`, `promptPermission(details)`.
  Its `activate(ctx)` already drives a collaborator's lifecycle (`this.forwarding.start(ctx)`); `deactivate()` mirrors it.
  It still needs `this.context` after this change for `getRuntimeContext()`, `reload()` (reads `this.context?.cwd`), and `logResolvedConfigPaths()`.
- `src/gate-prompter.ts` — the `GatePrompter` role interface (`canConfirm()` + `promptPermission(details)`).
  This is already the *collapsed* contract the runner sees; the twins live only on the session.
- `src/handlers/gates/runner.ts` — `GateRunner` calls `this.prompter.canConfirm()` and `this.prompter.promptPermission(...)`.
- `src/permission-prompter.ts` — `PermissionPrompterApi.prompt(ctx, details)` and `PromptPermissionDetails`; the gateway delegates the actual prompt here.
- `src/yolo-mode.ts` — `canResolveAskPermissionRequest({ config, hasUI, isSubagent })`.
- `src/subagent-context.ts` — `isSubagentExecutionContext(ctx, subagentSessionsDir, registry)`.
- `src/index.ts` — the composition root; constructs the session, the gateway-to-be, and `new GateRunner(session, session, session, reporter)`.

Constraints from `AGENTS.md` and the package skill that apply:

- Keep Pi SDK imports at the edges; the gateway is an SDK consumer (it holds `ExtensionContext`), which is allowed.
- A non-`async` method declared `Promise<T>` must `return Promise.reject(...)`, never `throw` (testing skill; preserves the existing throw-when-unactivated contract under `rejects.toThrow`).
- Lift-and-shift large test files: never rewrite an entire large test file in one step.
- When removing fields from a shared test type, every constructor of that type breaks in the same commit — fold those fixture updates together.
- When a roadmap step ships, mark it `✓ complete` in `docs/architecture/architecture.md` (ship-time action, noted here for completeness).

## Design Overview

### The gateway

`PromptingGateway` owns the stored context and absorbs both the prompting action and the "can we prompt?" policy.
Absorbing the policy is what lets the `index.ts` `canRequestPermissionConfirmation` closure disappear: the gateway computes the decision from its own deps rather than receiving a pre-bound closure.

```typescript
export interface PromptingGatewayDeps {
  /** Read current config for the yolo-mode branch of the can-prompt policy. */
  config: ConfigReader;
  /** Static path used to detect a forwarding subagent context. */
  subagentSessionsDir: string;
  /** Process-global registry used to detect a registered child session. */
  registry?: SubagentSessionRegistry;
  /** Resolves the permission decision: direct UI dialog or forwarded to parent. */
  prompter: PermissionPrompterApi;
}

/** The lifecycle slice of the gateway that PermissionSession drives. */
export interface PromptingGatewayLifecycle {
  activate(ctx: ExtensionContext): void;
  deactivate(): void;
}

export class PromptingGateway implements GatePrompter, PromptingGatewayLifecycle {
  private context: ExtensionContext | null = null;

  constructor(private readonly deps: PromptingGatewayDeps) {}

  activate(ctx: ExtensionContext): void {
    this.context = ctx;
  }

  deactivate(): void {
    this.context = null;
  }

  canConfirm(): boolean {
    if (this.context === null) return false;
    return canResolveAskPermissionRequest({
      config: this.deps.config.current(),
      hasUI: this.context.hasUI,
      isSubagent: isSubagentExecutionContext(
        this.context,
        this.deps.subagentSessionsDir,
        this.deps.registry,
      ),
    });
  }

  prompt(
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision> {
    if (this.context === null) {
      return Promise.reject(
        new Error("prompt called before the session was activated"),
      );
    }
    return this.deps.prompter.prompt(this.context, details);
  }
}
```

The four deps are all used (`config` + `subagentSessionsDir` + `registry` by `canConfirm`; `prompter` by `prompt`), so the bag passes the dependency-width check.
The method is named `prompt` here; until the rename cycle lands it carries the current `GatePrompter` name `promptPermission` (see TDD Order).

### The session loses the prompting role

`PermissionSession` drops `implements GatePrompter`, deletes all four prompting methods, deletes `PermissionSessionRuntimeDeps`, and replaces the `runtimeDeps` constructor parameter with a `PromptingGatewayLifecycle` collaborator it forwards to:

```typescript
activate(ctx: ExtensionContext): void {
  this.context = ctx;
  this.forwarding.start(ctx);
  this.gateway.activate(ctx);   // new: mirrors the forwarding lifecycle
}

deactivate(): void {
  this.context = null;
  this.forwarding.stop();
  this.gateway.deactivate();    // new
}
```

The session keeps `this.context` for its remaining readers.
Forwarding through `activate`/`deactivate` is the only wiring the gateway needs, and it reuses the exact pattern already in place for `ForwardingController` — the session is the lifecycle coordinator that brings its collaborators online.
This is why the change stays inside the four target files: every existing `session.activate(ctx)` call site (the two handlers, `before-agent-start`, `resetForNewSession`) gets gateway activation for free.

### Composition root

```typescript
const gateway = new PromptingGateway({
  config: configStore,
  subagentSessionsDir: paths.subagentSessionsDir,
  registry: subagentRegistry,
  prompter,
});

const session = new PermissionSession(
  paths, logger, forwardingManager, permissionManager, sessionRules, configStore,
  gateway,                         // was the runtimeDeps bag
);

const gateRunner = new GateRunner(session, session, gateway, reporter);
```

`index.ts` drops the `canRequestPermissionConfirmation` closure and its now-unused imports of `isSubagentExecutionContext` and `canResolveAskPermissionRequest` (both relocate into the gateway).
`PermissionPrompter` is still built in `index.ts` and handed to the gateway.

### Design-review check

- Dependency width: `PromptingGatewayDeps` has 4 fields, every one read.
  Pass.
- Law of Demeter: `this.deps.prompter.prompt(...)` and `this.deps.config.current()` are one-level calls on injected role interfaces, not stranger reach-throughs.
  Pass.
- Output arguments: none; `canConfirm` returns a value, `prompt` returns a Promise.
  Pass.
- Tell-Don't-Ask: the session *tells* the gateway to activate/deactivate (mirrors `forwarding.start/stop`), rather than the gateway asking the session for context.
  Pass.
- Procedure-splitting guard: the gateway owns state (`context`) and returns values; it is a genuine collaborator, not a relocated statement block.
  Pass.

## Module-Level Changes

Production:

- `src/prompting-gateway.ts` (new) — `PromptingGateway`, `PromptingGatewayDeps`, `PromptingGatewayLifecycle`.
- `src/gate-prompter.ts` — rename the method `promptPermission` → `prompt` on `GatePrompter`.
- `src/handlers/gates/runner.ts` — `this.prompter.promptPermission(...)` → `this.prompter.prompt(...)`.
- `src/permission-session.ts` — remove `implements GatePrompter`; delete `canPrompt`, `prompt`, `canConfirm`, `promptPermission`; delete `PermissionSessionRuntimeDeps` and the `runtimeDeps` field; add a `gateway: PromptingGatewayLifecycle` constructor parameter and forward it in `activate`/`deactivate`; drop the now-unused imports (`GatePrompter`, `PermissionPrompterApi`, `PromptPermissionDetails`, `PermissionPromptDecision`).
  `ExtensionContext` stays (still used by `activate`, `getRuntimeContext`, `resolveAgentName`).
- `src/index.ts` — construct `PromptingGateway`; pass it to `PermissionSession` and as `GateRunner`'s third argument; delete the `canRequestPermissionConfirmation` closure; drop the `isSubagentExecutionContext` and `canResolveAskPermissionRequest` imports.

Tests:

- `test/prompting-gateway.test.ts` (new) — unit tests for the gateway.
- `test/permission-session.test.ts` — delete `makeRuntimeDeps` and the four prompting `describe` blocks (`canConfirm`, `promptPermission`, `canPrompt`, `prompt`); pass a `PromptingGatewayLifecycle` mock through `createSession`; add assertions that `activate`/`deactivate` forward to the gateway.
- `test/helpers/handler-fixtures.ts` — `MockGateHandlerSession` drops `& GatePrompter` but keeps `canPrompt`/`prompt`/`canConfirm`/`promptPermission` as explicit test-only extras during the migration; `makeHandler` builds a bridged prompter (delegating to those extras), accepts a `prompter?` override, returns `prompter`, and passes it as `GateRunner`'s third argument.
  Final cleanup later removes the extras, the casts, and the bridge.
- `test/helpers/gate-fixtures.ts` — rename the `makeGateRunner` `promptPermission` override key → `prompt`.
- `test/handlers/gates/runner.test.ts` — rename `promptPermission` → `prompt` (~12 call sites).
- `test/handlers/input.test.ts`, `test/handlers/input-events.test.ts`, `test/handlers/tool-call-events.test.ts`, `test/handlers/external-directory-integration.test.ts` — migrate prompting steering/assertions from the session to the prompter.
- `test/handlers/external-directory-session-dedup.test.ts` — its local `makeStatefulSession` + `makeHandlerForSession` migrate the same way; `session.prompt` assertions → `prompter.prompt`.

Docs:

- `docs/architecture/architecture.md` — add a `prompting-gateway.ts` entry to the module layout (around line 495); update the `gate-prompter.ts` line to `canConfirm() + prompt(details)`; update the `permission-session.ts` line to drop `GatePrompter` from the implements list and note prompting moved to `PromptingGateway` ([#339]); note the index-closure count 11 → 10.
  Mark roadmap Step 6 `✓ complete` at ship time.
- `.pi/skills/package-pi-permission-system/SKILL.md` — update the `handler-fixtures.ts` description: `makeSession` no longer carries prompting; `makeHandler` exposes a `prompter` mock for the `GatePrompter` role.

## Test Impact Analysis

1. New tests the extraction enables — `test/prompting-gateway.test.ts` can unit-test the prompting role directly, with no session fixture:
   - `canConfirm()` returns `false` before `activate`; after `activate`, returns `true`/`false` across the UI / subagent / yolo-mode permutations of `canResolveAskPermissionRequest` — previously only reachable through the session's `runtimeDeps` closure.
   - `prompt(details)` delegates to `deps.prompter.prompt(ctx, details)` with the stored context, and rejects with the unactivated-session error before `activate`.
   - `activate`/`deactivate` set and clear the stored context (observable via `canConfirm`).
2. Tests that become redundant — the `canConfirm` / `promptPermission` / `canPrompt` / `prompt` `describe` blocks in `permission-session.test.ts` move to the gateway test; `makeSession`'s prompting closures and `undefined as unknown as ExtensionContext` casts are deleted in the final cleanup cycle.
3. Tests that must stay as-is — the rest of `permission-session.test.ts` (state, lifecycle, config, resolve, skill entries); `runner.test.ts` (it exercises the prompting role through the `GatePrompter` mock, now `prompt`); the handler suites (they assert end-to-end gate behavior, now steered through the prompter).

## TDD Order

The pivot is `MockGateHandlerSession`: removing fields from it breaks every constructor at once.
Lift-and-shift keeps the session's prompting fields alive as test-only extras with a bridge in `makeHandler`, migrates the handler suites file-by-file, then removes the extras last.

1. Add the gateway (additive).
   Surface: `test/prompting-gateway.test.ts`.
   Covers `canConfirm` permutations, `prompt` delegation + rejection, `activate`/`deactivate`.
   Implement `src/prompting-gateway.ts` (method named `promptPermission` to satisfy the current `GatePrompter`); add the module-layout entry to `architecture.md`.
   Not wired yet.
   Commit: `feat: add context-owning PromptingGateway`.

2. Wire the gateway; the session sheds the prompting role.
   Surface: `permission-session.ts`, `index.ts`, `permission-session.test.ts`, `handler-fixtures.ts`, `external-directory-session-dedup.test.ts` (local fixtures only).
   Session drops `GatePrompter` + the four methods + `runtimeDeps`, gains the gateway param, forwards in `activate`/`deactivate`; `index.ts` constructs the gateway and passes it to the session and `GateRunner`; `permission-session.test.ts` loses `makeRuntimeDeps` and the prompting blocks and gains forwarding assertions; the shared fixtures decouple `MockGateHandlerSession` from `GatePrompter`, add the bridged `prompter` (delegating to the retained extras) and the `prompter?` override, and pass it as `GateRunner`'s third arg.
   Handler test *cases* stay green via the bridge.
   Update the `permission-session.ts` line in `architecture.md`.
   Run `pnpm run check` immediately (shared-interface change with a single index call site).
   Commit: `refactor: extract prompting into PromptingGateway; session sheds the prompting role`.

3. Rename the `GatePrompter` method `promptPermission` → `prompt`.
   Surface: `gate-prompter.ts`, `runner.ts`, `prompting-gateway.ts`, `gate-fixtures.ts`, `runner.test.ts`, the `makeHandler` bridge.
   Update the `gate-prompter.ts` line in `architecture.md`.
   Commit: `refactor: rename GatePrompter.promptPermission to prompt`.

4. Migrate `input.test.ts` to steer/assert the prompter.
   Commit: `test: steer prompting via the gateway in input handler tests`.

5. Migrate `input-events.test.ts`.
   Commit: `test: steer prompting via the gateway in input-event tests`.

6. Migrate `tool-call-events.test.ts`.
   Commit: `test: steer prompting via the gateway in tool-call-event tests`.

7. Migrate `external-directory-integration.test.ts`.
   Commit: `test: steer prompting via the gateway in external-directory tests`.

8. Migrate `external-directory-session-dedup.test.ts` (cases + its local `makeStatefulSession`/`makeHandlerForSession`).
   Commit: `test: steer prompting via the gateway in session-dedup tests`.

9. Final cleanup — drop the bridge.
   Surface: `handler-fixtures.ts` (and the dedup local fixtures): remove the `canPrompt`/`prompt`/`canConfirm`/`promptPermission` extras and the `undefined as unknown as ExtensionContext` casts; `makeHandler`'s default `prompter` becomes a clean `GatePrompter` mock; update the `SKILL.md` fixture description.
   Commit: `test: drop session prompting fixtures and undefined-context casts`.

Smaller adjacent test files (e.g. `input.test.ts` and `input-events.test.ts`) may be grouped into a single cycle if each diff stays small; the large suites (`external-directory-integration`, `external-directory-session-dedup`) stay one-per-cycle.

## Risks and Mitigations

- Dual context store — both the session (`this.context`) and the gateway hold a context.
  Mitigation: the single `activate`/`deactivate` path keeps them synchronized; the session's copy serves only `getRuntimeContext`/`reload`/`logResolvedConfigPaths`, which are out of scope here.
  Note it as a Step 8 ([#341]) consolidation candidate.
- Big-bang fixture break — removing `GatePrompter` fields from `MockGateHandlerSession` could ripple through every handler suite at once.
  Mitigation: the lift-and-shift bridge keeps the extras alive until the suites are migrated; the type change in step 2 only touches the fixtures, not the cases.
- Behavior drift in the relocated can-prompt policy — moving `canResolveAskPermissionRequest` into the gateway could subtly change the decision.
  Mitigation: the gateway's `canConfirm` reproduces the exact closure (`config.current()`, `ctx.hasUI`, `isSubagentExecutionContext(ctx, subagentSessionsDir, registry)`); the new unit tests assert each permutation.
- Transitional dead code — the gateway is exported but unwired after step 1.
  Mitigation: `pnpm fallow dead-code` runs at pre-completion, after step 2 wires it.

## Open Questions

- None blocking.
  Consolidating the dual context store and splitting `makeSession` per-collaborator are explicitly deferred to Step 8 ([#341]).

[#334]: https://github.com/gotgenes/pi-packages/issues/334
[#339]: https://github.com/gotgenes/pi-packages/issues/339
[#340]: https://github.com/gotgenes/pi-packages/issues/340
[#341]: https://github.com/gotgenes/pi-packages/issues/341
