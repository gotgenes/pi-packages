---
issue: 812
issue_title: "pi-subagents: runtime-registered providers (e.g. pi-claude-bridge) unresolvable in child sessions"
---

# Inherit runtime-registered providers in child sessions

## Release Recommendation

**Release:** ship independently

No roadmap step in `docs/architecture/architecture.md` references this issue, and the package declares no `Release: batch` groupings.
It is a user-facing bug fix that also narrows a published peer range, so it should cut its own release rather than ride someone else's batch.

## Problem Statement

A subagent cannot resolve any model provider that the parent registered at runtime through `pi.registerProvider`.
`pi-claude-bridge` is the common trigger: it registers its provider dynamically, the interactive session works, and every child fails with `No API key found for claude-bridge`.

Pi 0.80.8 replaced `createAgentSession`'s `modelRegistry` option with `modelRuntime`.
The composition root still passes only `modelRegistry`, which newer Pi ignores, so each child builds a fresh `ModelRuntime` from config and `auth.json`.
Runtime registrations live on the runtime instance, not in either file, so the child's pool is missing exactly the providers the parent added at runtime.

## Goals

- A child session resolves every provider the parent registered at runtime, in both registration forms (native provider object and provider config).
- The replay logic lives in a unit-tested module rather than the untested composition root.
- The child's provider pool is **isolated** from the parent's, so a child-loaded extension cannot mutate the parent's registrations.
- Move the package's Pi SDK devDependencies to `0.84.4` and narrow the `@earendil-works/pi-coding-agent` peer floor from `>=0.80.5` to `>=0.80.8`.
  **Corrected during implementation to `>=0.81.0`** — see the note below and the TDD stage entry in the retro.
- **This change is breaking.**
  Narrowing a published peer range drops support for Pi `0.80.5`–`0.80.7`, so the commit carries `fix(pi-subagents)!:` and a `BREAKING CHANGE:` footer.
  The behavioral half is not breaking on its own — a child gains providers it previously lacked and loses none.

## Non-Goals

- **Not adopting [#811] as written.**
  The PR reaches `ModelRegistry`'s `private readonly runtime` field and forwards the parent's runtime *instance* to every child.
  The triage note in `docs/retro/0812-runtime-registered-providers-in-child-sessions.md` records the operator's decision to use the public replay path instead.
- **No live inheritance.**
  A provider registered in the parent *after* a child spawns will not appear in that running child.
  This is the committed contract, not a limitation to revisit — see Design Overview.
- **No upstream Pi issue.**
  The extension facade withholds `ModelRuntime` deliberately (`sdk.md` lines 1177-1178) and already exposes sufficient public API.
- **No SDK bump for sibling packages.**
  The other eight packages pin `0.79.1` and are unaffected by this defect; bumping them is unrelated churn and is not tracked as a follow-up.
- **No change to `createSubagentSession`, `CreateSessionOptions`, or `SessionFactoryIO`.**
  `modelRegistry` stays a field of `CreateSessionOptions` — it becomes the replay *source* rather than a pass-through to the SDK.

## Background

`packages/pi-subagents/src/index.ts` lines 119-125 hold the single `createAgentSession` call site in the package (verified: `grep -rn "createAgentSession" packages/pi-subagents/src/` matches only the import and that call).
Every spawn path — the `subagent` tool, the `SubagentsService` adapter, print mode — funnels through it, so one fix covers all of them.

Pi's own changelog, `## [0.80.8] - 2026-07-16`, states: "Replaced the SDK's `CreateAgentSessionOptions.authStorage` and `modelRegistry` options with the async `modelRuntime` option."
The two installed surfaces confirm it — `0.80.5` declares `modelRegistry?: ModelRegistry` and no `modelRuntime`; `0.84.3` declares `modelRuntime?: ModelRuntime` and no `modelRegistry`.

`sdk.ts` line 180 reads `const modelRuntime = options.modelRuntime ?? (await ModelRuntime.create({ authPath, modelsPath }))`, and `ModelRuntime` keeps runtime registrations in per-instance maps (`model-runtime.ts` lines 135-136, `extensionProviders` and `nativeExtensionProviders`).
`getRegisteredProviderIds()` returns the union of exactly those two maps (`model-runtime.ts` line 441), which is precisely the set a fresh runtime lacks.

The extension-facing split is intentional.
`ModelRegistry`'s doc comment reads "Synchronous compatibility facade exposed to extensions.
Coding-agent internals use `ModelRuntime` directly", and `ExtensionContext` exposes only `modelRegistry` — no `session`, no `modelRuntime`. pi-subagents is the unanticipated case: an extension that behaves like an SDK application.
On `>=0.80.8` the facade nonetheless exposes a public constructor plus the three `getRegistered*` accessors, so no private access is required.

> **Correction (implementation).**
> This is wrong, and the pre-completion reviewer caught it.
> `v0.80.8` added the public constructor, `getRegisteredProviderIds()`, and `getRegisteredProviderConfig()`, but `getRegisteredNativeProvider()` and the `registerProvider(provider)` native overload arrived three days later in `v0.81.0`.
> The shipped peer floor is `>=0.81.0`.
> Every `>=0.80.8` claim below should be read as `>=0.81.0`.

AGENTS.md constraints that apply:

- Changing a `package.json` dependency requires `pnpm install` and the updated `pnpm-lock.yaml` in the same commit, plus any `minimumReleaseAgeExclude` entry pnpm adds to `pnpm-workspace.yaml`.
- A breaking change spells the marker `fix(pi-subagents)!:`, never `fix!(pi-subagents):`.
- A remediation named in a migration note must exist in the real surface.
  Verified with `pi update --help`: `pi update --self` (bare `pi update` is the same) updates Pi itself.

## Design Overview

### Replay, not instance-sharing

Build the child its own `ModelRuntime` and copy the parent's runtime registrations onto it, rather than handing the child the parent's instance.

This costs nothing.
Today `createAgentSession` already calls `ModelRuntime.create()` for every child, because `options.modelRuntime` is always absent.
After the change we make that same call ourselves and the SDK's `??` short-circuits — exactly one runtime construction per child, before and after.

Isolation is the reason to prefer it over instance-sharing.
A child session's extension runner calls `this._modelRuntime.registerProvider` / `unregisterProvider` (`agent-session.ts` lines 2649-2657), so a shared instance lets any child-loaded extension mutate the parent's provider pool.
Verified against the installed 0.84.3: with replay, a child registration does not appear in the parent, and a child `unregisterProvider` leaves the parent's provider intact.

### Snapshot-at-spawn semantics

Replay copies the registrations that exist when the child spawns.
A provider registered in the parent afterwards does not reach an already-running child.

This matches how the package already treats parent state: `ParentSnapshot` freezes cwd, model, and system prompt at spawn.
Document it in `docs/configuration.md` rather than leaving it implicit.

### The seam

A new SDK-free module carries the logic.
Both collaborators are narrow structural interfaces rather than the SDK's `ModelRegistry`, per the `code-design` rule that a shared interface referencing a collaborator should not name the concrete class — `ModelRegistry` carries a private field, which would force test doubles to cast or replicate internals.

They are generic in the provider and config types because the module never inspects those values, and because the SDK does not export `ProviderConfigInput` from its package entry (verified: `dist/index.d.ts` exports `ModelRegistry` and `ModelRuntime`, not the config type).
Generics keep the pass-through type-safe without naming an unexported type.

```typescript
/** Enumerates the providers registered on a session at runtime. */
export interface RegisteredProviderSource<TNative, TConfig> {
  getRegisteredProviderIds(): readonly string[];
  getRegisteredNativeProvider(id: string): TNative | undefined;
  getRegisteredProviderConfig(id: string): TConfig | undefined;
}

/** Accepts provider registrations on behalf of a session. */
export interface ProviderRegistrar<TNative, TConfig> {
  registerNative(provider: TNative): void;
  registerConfigured(id: string, config: TConfig): void;
}

export function inheritRegisteredProviders<TNative, TConfig>(
  source: RegisteredProviderSource<TNative, TConfig>,
  target: ProviderRegistrar<TNative, TConfig>,
): void;
```

The registrar splits `ModelRegistry`'s overloaded `registerProvider` into two distinct method names deliberately.
An overloaded structural method cannot be satisfied by a plain `vi.fn()` without a cast, and the native-versus-configured branch is the part most likely to regress — my verification showed both registration forms occur — so it belongs under test rather than in the untested root.

An id is registered either natively or from config, never both: `registerProvider` deletes from `nativeExtensionProviders` and `registerNativeProvider` deletes from `extensionProviders` (`model-runtime.ts` lines 733-753).
Checking native first and falling through to config is therefore total, and an id resolving to neither is skipped rather than registered empty.

### Composition-root call site

```typescript
createSession: async ({ sessionManager, resourceLoader, modelRegistry, ...rest }) => {
  const childRuntime = await ModelRuntime.create({
    authPath: join(rest.agentDir, "auth.json"),
    modelsPath: join(rest.agentDir, "models.json"),
  });
  const childRegistry = new SdkModelRegistry(childRuntime);
  inheritRegisteredProviders(modelRegistry as SdkModelRegistry, {
    registerNative: (provider) => { childRegistry.registerProvider(provider); },
    registerConfigured: (id, config) => { childRegistry.registerProvider(id, config); },
  });
  return createAgentSession({ ...rest, sessionManager, resourceLoader, modelRuntime: childRuntime });
},
```

The `authPath` / `modelsPath` derivation mirrors `sdk.ts` lines 178-180 exactly.
The lambda becomes `async`; its declared return type was already `Promise<{ session: AgentSession }>`, so `SessionFactoryIO` does not change.
The four-line registrar adapter is the only glue added to the root, comparable to the `createLoaderSettingsManager` lambda already in that object literal.

### Verification already performed

A spike on a scratch worktree confirmed the shape.
After bumping `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `@earendil-works/pi-tui` to `0.84.4`, the **only** type error in the package was the one this change fixes (`src/index.ts(124,11): error TS2353: 'modelRegistry' does not exist in type 'CreateAgentSessionOptions'`).
With the module and rewiring applied, `pnpm --filter @gotgenes/pi-subagents run check` passed and the suite stayed green at 68 files / 1230 tests.
Bumping `pi-coding-agent` alone leaves two `pi-tui` dual-version errors, which is why all three move together.

## Module-Level Changes

| File                                                              | Change                                                                                                                                                                |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/pi-subagents/src/session/provider-inheritance.ts`       | **New.** `inheritRegisteredProviders` plus the two generic structural interfaces. No SDK imports.                                                                     |
| `packages/pi-subagents/test/session/provider-inheritance.test.ts` | **New.** Unit tests for the replay loop against plain stubs.                                                                                                          |
| `packages/pi-subagents/test/composition-root.test.ts`             | **New.** Pins that the root passes `modelRuntime` and replays the parent's registrations. Name follows `packages/pi-permission-system/test/composition-root.test.ts`. |
| `packages/pi-subagents/src/index.ts`                              | Add `join` from `node:path` and `ModelRuntime` to the SDK import; import `inheritRegisteredProviders`; rewrite the `createSession` lambda.                            |
| `packages/pi-subagents/package.json`                              | devDeps `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui` → `0.84.4`; peer `@earendil-works/pi-coding-agent` → `>=0.80.8`.         |
| `pnpm-lock.yaml`                                                  | Regenerated by `pnpm install` in the same commit.                                                                                                                     |
| `pnpm-workspace.yaml`                                             | Stage any `minimumReleaseAgeExclude` entries pnpm adds for the freshly-pinned versions.                                                                               |
| `packages/pi-subagents/docs/architecture/architecture.md`         | Add a Session-domain Mermaid node near line 82 and a module-layout tree entry near lines 344-346.                                                                     |
| `.pi/skills/package-pi-subagents/SKILL.md`                        | Session domain row 9 → 10 modules, list `provider-inheritance.ts`; "seven domains (61 files)" → 62.                                                                   |
| `packages/pi-subagents/docs/configuration.md`                     | New section documenting provider inheritance and its snapshot-at-spawn contract.                                                                                      |

Grep results behind this list:

- No export is removed or renamed, so the removed-symbol sweeps do not apply.
- `grep -rn "modelRuntime" packages/pi-subagents/` matches nothing today — the symbol is new to the package.
- `src` currently holds 61 `.ts` files (`find packages/pi-subagents/src -name '*.ts' | wc -l`), and `src/session/` holds 9, which is what the SKILL.md counts assert.
- `docs/configuration.md` runs to 222 lines and ends inside `## Persistent Settings`.
  Per `markdown-conventions`, read that parent section end to end before inserting, so the new `##` does not reparent the trailing `### Abort on interrupt` content.
- The architecture module tree is a fenced code block, so cite the issue there as a bare `#812` with no reference definition (MD053).

## Test Impact Analysis

**New tests the seam enables.**
The replay loop is currently unreachable — it does not exist, and the equivalent logic in [#811] sits inside `index.ts` where no test can call it.
Extracting it makes these cases plain unit tests over stub objects:

- A configured provider is replayed via `registerConfigured` with its id and config.
- A native provider is replayed via `registerNative`.
- Native takes precedence when both accessors would answer (guards the branch order).
- An id that resolves to neither form is skipped, registering nothing.
- An empty id list registers nothing.
- Registration order follows `getRegisteredProviderIds()`.

**Tests that become redundant.**
None.
Nothing today covers this path.

**Tests that must stay as-is.**
`test/lifecycle/create-subagent-session.test.ts` asserts `io.createSession` receives `expect.objectContaining({ cwd, agentDir })` and `{ settingsManager }`.
Those pin the *factory's* contract, which this change preserves — `createSubagentSession` still hands `modelRegistry` down; only what the root does with it changes.
`test/print-mode.test.ts` loads `#src/index` with a fake `pi` and mocks `createSubagentSession`, so it never reaches `io.createSession` and is unaffected.

**Composition-root test feasibility.**
`test/print-mode.test.ts` establishes the harness: it mocks `#src/lifecycle/create-subagent-session` and invokes the extension factory.
The new composition-root test captures `vi.mocked(createSubagentSession).mock.calls[0][1]` to obtain `subagentSessionDeps`, then calls `deps.io.createSession({...})` directly.
It must stub `ModelRuntime`, `ModelRegistry`, and `createAgentSession` from `@earendil-works/pi-coding-agent` by spreading `await vi.importActual(...)` and overriding only those three, per the `testing` skill — a bare object-literal factory would blank every other export `index.ts` imports.

This test is the one that fails without the fix; the unit tests above pass whether or not the root is wired.

## Invariants at risk

| Invariant                                                            | Pinned by                                                                                                                   | Risk                                                                                                                   |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| The child receives exactly one `ModelRuntime` construction per spawn | `sdk.ts` line 180's `??`, plus the new composition-root test asserting `createAgentSession` received a `modelRuntime`       | Passing `modelRuntime` makes the SDK's fallback dead; forgetting to pass it would silently restore the defect          |
| A child's `agentDir` equals the parent's                             | `create-subagent-session.ts` line 181 (`deps.io.getAgentDir()`) and the existing `objectContaining({ agentDir })` assertion | The runtime's `authPath`/`modelsPath` derive from it; a divergence would change which credentials the child reads      |
| `CreateSessionOptions.modelRegistry` remains the parent registry     | `create-subagent-session.ts` line 218 and `test/lifecycle/create-subagent-session.test.ts`                                  | The replay source; removing it would silently disable inheritance                                                      |
| Child tool allowlist and `excludeTools` behavior ([#725])            | `test/lifecycle/create-subagent-session.test.ts`                                                                            | The `...rest` spread must keep forwarding `tools` / `excludeTools` unchanged; the spike's green suite confirms it does |

The quantitative claim in this plan — one runtime construction per child, before and after — is a reading of `sdk.ts` line 180, not an estimate.
The spike measured the type-check and suite outcomes rather than arguing them.

## TDD Order

1. **`refactor(pi-subagents): add provider-inheritance replay seam`** Red: `test/session/provider-inheritance.test.ts` fails because the module does not exist.
   Green: add `src/session/provider-inheritance.ts` with the two interfaces and the loop.
   Covers every case in Test Impact Analysis.
   The module has no SDK imports, so this lands cleanly while the package still compiles against `0.80.5`, and nothing imports it yet — hence `refactor:`, per the AGENTS.md rule that a module no code imports is `refactor:` however new it is.

2. **`fix(pi-subagents)!: inherit runtime-registered providers in child sessions`** Red: write `test/composition-root.test.ts` first; it fails against the current root, which passes `modelRegistry` and never replays.
   Green: bump the three devDeps to `0.84.4`, narrow the peer floor to `>=0.80.8`, rewire the `createSession` lambda, run `pnpm install`, stage `pnpm-lock.yaml` and any `pnpm-workspace.yaml` change.
   Run `pnpm run check` immediately after committing — the spike showed the bump alone leaves the package failing `tsc`.

   This step cannot be split.
   Bumping the SDK without rewiring leaves `src/index.ts` failing `tsc` on the removed `modelRegistry` option, and rewiring without bumping is impossible because `0.80.5` has neither the `modelRuntime` option nor a public `ModelRegistry` constructor.
   Narrowing the peer range belongs here rather than in a separate commit so no commit on `main` advertises support for a Pi version its own code cannot run on.

   The `BREAKING CHANGE:` footer states that Pi `0.80.5`–`0.80.7` is no longer supported and that the remediation is `pi update --self` (verified against `pi update --help`).
   The published `@gotgenes/pi-subagents@19.3.5` declares `>=0.80.5`, so this narrowing is breaking against a shipped contract, not an unreleased one.

3. **`docs(pi-subagents): document provider inheritance in child sessions`** Update `docs/architecture/architecture.md` (Mermaid node and module tree), `.pi/skills/package-pi-subagents/SKILL.md` (module counts), and `docs/configuration.md` (the new section, including the snapshot-at-spawn contract).
   Run `pnpm exec rumdl check` on each edited file.

Every commit in steps 1-3 carries, as its final paragraph:

```text
Co-authored-by: George Harker <george@georgeharker.com>
```

Reference the PR as `Refs #811` in the body, never `Closes #811`.

## Risks and Mitigations

| Risk                                                                                          | Mitigation                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The `authPath` / `modelsPath` derivation duplicates `sdk.ts` and could drift if Pi changes it | The derivation is two `join` calls against the same `agentDir` the session already receives, and the peer floor pins `>=0.80.8`; a drift would surface as a child reading the wrong credentials, which the composition-root test's asserted arguments make visible |
| Narrowing the peer range strands users on Pi `0.80.5`-`0.80.7`                                | Those versions cannot support the fix at all; the `BREAKING CHANGE:` footer names `pi update --self`, and `19.3.5` remains installable for anyone pinned to old Pi                                                                                                 |
| Mocking three SDK exports in the composition-root test blanks the rest of the module          | Spread `await vi.importActual<typeof import("@earendil-works/pi-coding-agent")>(...)` and override only `ModelRuntime`, `ModelRegistry`, and `createAgentSession`                                                                                                  |
| Bumping to a freshly published `0.84.4` trips pnpm's 24h `minimumReleaseAge` gate             | The repo sets `trustLockfile: true`; stage whatever `minimumReleaseAgeExclude` entries `pnpm install` adds                                                                                                                                                         |
| A future Pi release changes the `getRegistered*` accessors                                    | They are public API; a signature change would fail `tsc` at the composition root, not silently. (The floor claim originally recorded here was wrong — `git tag --contains 9993c9690` covers only two of the three accessors, and the third ships in `v0.81.0`.)    |
| PR [#748] also edits `packages/pi-subagents/src/index.ts`                                     | Different region (widget UI context at `session_start`); rebase conflict is textual at worst, and it remains unmerged                                                                                                                                              |

## Open Questions

None.
The direction, mechanism, SDK-pin decision, and inheritance semantics were all settled at the PR-review gate and are recorded in `docs/retro/0812-runtime-registered-providers-in-child-sessions.md`.

[#725]: https://github.com/gotgenes/pi-packages/issues/725
[#748]: https://github.com/gotgenes/pi-packages/pull/748
[#811]: https://github.com/gotgenes/pi-packages/pull/811
