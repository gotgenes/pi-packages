---
issue: 812
issue_title: "pi-subagents: runtime-registered providers (e.g. pi-claude-bridge) unresolvable in child sessions"
pr: 811
---

# Retro: #812 — Runtime-registered providers unresolvable in child sessions

## Stage: PR Review (2026-08-29T01:15:56Z)

### Session summary

[PR #811](https://github.com/gotgenes/pi-packages/pull/811) from @georgeharker reports that a subagent cannot resolve any provider registered at runtime via `pi.registerProvider` — `pi-claude-bridge` is the common trigger, failing every child with `No API key found for claude-bridge`.
The defect is real and reproduces on current `main`: Pi 0.80.8 replaced `createAgentSession`'s `modelRegistry` option with `modelRuntime`, so the child silently builds a fresh `ModelRuntime` that carries none of the parent's runtime registrations.
The operator chose to **adopt the capability with a simplified design**: rather than forwarding the parent's runtime instance through a private-field reach (the PR's mechanism), replay the parent's runtime registrations onto a fresh child runtime using only public `ModelRegistry` API.

### Evaluation

#### Verify gate — defect confirmed

Pi's own changelog, `## [0.80.8] - 2026-07-16`, states: "Replaced the SDK's `CreateAgentSessionOptions.authStorage` and `modelRegistry` options with the async `modelRuntime` option."
Confirmed in both installed surfaces — `0.80.5` (our pinned devDependency) declares `modelRegistry?: ModelRegistry` and no `modelRuntime`; `0.84.3` (the `pi` that actually runs) declares `modelRuntime?: ModelRuntime` and no `modelRegistry`.

Reproduced with a scratch script against the installed 0.84.3 bundle (since deleted): a provider registered at runtime on a parent `ModelRuntime`, then a child session created each way.

```text
parent registry sees provider: true
PR-base  (modelRegistry only): child sees claude-bridge = false / sameInstance=false
PR-fix   (modelRuntime)      : child sees claude-bridge = true  / sameInstance=true
```

The real boundary is `packages/pi-subagents/src/index.ts:119-125`, which the PR touches.
Runtime registrations live in per-instance maps (`model-runtime.ts:135-136`, `extensionProviders` and `nativeExtensionProviders`), and `sdk.ts:180` builds a fresh `ModelRuntime.create()` whenever `modelRuntime` is absent — so the child's `getAuth()` throws the reported error verbatim.
Not already fixed: `git log -S modelRuntime -- packages/pi-subagents/src/index.ts` is empty on `main`.

#### Checks run

On a scratch worktree of the PR branch: `pnpm run check` passed, `pnpm run lint` passed with zero `lint/` findings, and the pi-subagents suite passed 68 files / 1230 tests.
The PR's own claim of passing checks holds.

#### What is valuable

The diagnosis is correct and precisely located, and the version-straddling guard is functional rather than speculative — `0.80.5`'s `ModelRegistry` has no `runtime` field, so the PR's conditional spread genuinely no-ops on the pinned SDK.

#### What we would change

1. **No test, in an untestable location.**
   The PR is one file, +12/−0, source only.
   `packages/pi-subagents/test/` has no `index` test file, and the package's convention (`SessionFactoryIO`, `EnvironmentIO`, `createLoaderSettingsManager`) is narrow structural contracts testable with plain stubs.
   A source-only bug fix is not eligible for adopt-as-is.
2. **Law of Demeter violation.**
   `ModelRegistry.runtime` is `private readonly` (`model-registry.ts:33`), and the PR reaches it through a duplicated `as unknown as { runtime?: unknown }` cast plus an `as never`.
3. **Shared mutable provider state.**
   Forwarding the parent's runtime instance means every child shares it (`sameInstance=true`), so a child-loaded extension calling `pi.registerProvider`/`unregisterProvider` mutates the parent's pool (`agent-session.ts:2649-2657`).
   No teardown hazard — `AgentSession.dispose()` does not dispose the runtime — and `agentDir` is identical for parent and child (`create-subagent-session.ts:181`), so no auth-scope divergence.

#### The private-field gap is intentional, and the facade already covers us

`sdk.md:1177-1178` and `ModelRegistry`'s own doc comment draw the line deliberately: `ModelRuntime` is the SDK-application surface, `ModelRegistry` is the synchronous extension facade.
`ExtensionContext` therefore exposes `modelRegistry` only — no `session`, no `modelRuntime`. pi-subagents is the unanticipated case, an extension that behaves like an SDK application.

On Pi ≥ 0.80.8 the facade nonetheless exposes everything required, as public API: a public `constructor(runtime: ModelRuntime)`, plus `getRegisteredProviderIds()`, `getRegisteredProviderConfig(id)`, and `getRegisteredNativeProvider(id)`.
`model-runtime.ts:441` shows `getRegisteredProviderIds()` returns exactly `extensionProviders ∪ nativeExtensionProviders` — precisely the set a fresh child runtime lacks.

The replay alternative was verified end-to-end against the installed 0.84.3, covering both registration kinds:

```text
before replay, child sees: claude-bridge=false native-bridge=false
after  replay, child sees: claude-bridge=true  native-bridge=true
session runtime sees claude-bridge: true
ISOLATION — child is a distinct instance:            true
ISOLATION — parent unaffected by child registration: true
ISOLATION — parent survives child unregister:        true
```

`0.80.5`'s `ModelRegistry` has a `private constructor()` and none of the `getRegistered*` accessors, so the replay path requires ≥ 0.80.8 — the same floor the SDK-pin decision independently selected.

### Decision and attribution

**Direction — adopt the capability, plan a simplified design.**
Use PR #811 as reference, not as the merge target.

Agreed scope:

1. **Mechanism — replay, not instance-forwarding.**
   Build a fresh child `ModelRuntime` and replay the parent's runtime registrations onto it through public `ModelRegistry` API.
   No private-field reach, and the child's provider pool is isolated from the parent's.
2. **Seam — extract and test it.**
   The replay belongs in a named module taking a narrow structural source (`getRegisteredProviderIds`, `getRegisteredProviderConfig`, `getRegisteredNativeProvider`) and a register target, matching the package's `SessionFactoryIO` convention.
   `index.ts` keeps a one-line call.
   Ship a regression test that fails without the fix — exercising the injected seam, not ambient host behavior.
3. **SDK pin — bump and narrow.**
   Move the `@earendil-works/pi-coding-agent` devDependency to `0.84.4` and narrow the peer range from `>=0.80.5` to `>=0.80.8`.
   This deletes the two-option straddle and is what makes the public replay path available.
   Narrowing a published peer range is breaking for users on `0.80.5`–`0.80.7`, so the change carries a `!` and a migration note.
4. **Semantics — snapshot at spawn.**
   A provider registered in the parent *after* a child spawns will not appear in that running child.
   This is the committed contract, consistent with how `ParentSnapshot` already captures cwd, model, and system prompt at spawn.
   Document it in `docs/configuration.md`.

Non-goals: no upstream Pi issue — the extension facade intentionally withholds `ModelRuntime` and already exposes sufficient public API, so we work within the split rather than around it.
No dual-mechanism fallback path.

**Attribution.**
Every implementation and docs commit for this issue carries, in its final paragraph:

```text
Co-authored-by: George Harker <george@georgeharker.com>
```

The PR close comment thanks `@georgeharker` by name, links the implementing SHA(s), and credits the diagnosis — the root-cause analysis pinpointing the 0.80.8 option rename is what made the fix tractable.
Reference the PR as `Refs #811`, never `Closes #811`.
