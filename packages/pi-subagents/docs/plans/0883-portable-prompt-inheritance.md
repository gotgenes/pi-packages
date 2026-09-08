---
issue: 883
issue_title: "pi-subagents: subagents on a Claude-Agent-SDK provider (pi-claude-bridge) get 400 \"Third-party apps now draw from your extra usage\" — the inherited parent prompt is the trigger"
---

# Portable prompt inheritance for children whose provider re-homes the prompt

## Release Recommendation

**Release:** ship independently

Issue #883 is not a step in any improvement roadmap — `architecture.md` carries no `[#883]` reference — so it is not a member of a release batch.
The change is a `feat:` on the settings surface plus the prompt assembler, independent of the Phase 22 spine.

## Problem Statement

A child session embeds its parent's assembled system prompt as its own identity ([ADR 0006], [ADR 0008]).
That identity opens with Pi's base preamble, which includes the documentation-routing line naming `custom providers (docs/custom-provider.md)` and `pi packages (docs/packages.md)`.

For a child whose provider **re-homes** the prompt into another harness — `pi-claude-bridge` projects it onto Claude Code's preset as an `--append-system-prompt` — that text leaves Pi and reaches Anthropic's subscription OAuth gate, which scores those two phrases together and classifies the request as a third-party app.
The child is refused with `400 Third-party apps now draw from your extra usage` while its parent, on the same provider and token, passes.

The inherited prefix pays where a host reuses a prefix over the system text.
It cannot pay where the prompt is re-homed as an append onto a foreign preset, and there it is actively harmful.
A child on such a provider should inherit the parent's **portable** parts — the operator-authored layers — rather than Pi's harness base.

## Goals

- Add a `portable` prompt-inheritance strategy: the child's identity is built from the parent's operator-authored prompt parts (context files, custom prompt, append prompt) instead of the assembled prompt.
- Select the strategy from the **child's resolved model provider**, via a `promptInheritance` map in `subagents.json`.
- Keep `full` the default, so no existing child's prompt changes on upgrade.
- Never let opting into `portable` silently re-embed the harness base it exists to avoid: an absent or whitespace-only capture falls back to `genericBase`, never to the full prompt.

This change is **not breaking**.
The default is unchanged, the settings key is additive, and every interface grows by optional fields only.
Commit type is `feat:`, with no `BREAKING CHANGE:` footer.

## Non-Goals

- **No `inherit_prompt` agent frontmatter.**
  PR [#884] ranks frontmatter above the provider rule, which resolves wrongly under a per-spawn `model:` override — an agent pinned to a bridge model keeps `portable` when spawned onto raw Anthropic.
  An agent has no opinion about prompt inheritance; a transport has a requirement.
  `src/config/custom-agents.ts`, `src/config/agent-types.ts`, and `test/config/custom-agents.test.ts` are predicted unchanged for this reason.
- **No global `default` arm on the setting.**
  A `default: "portable"` would silently switch every child, including a local-model child whose shared prefix [#180] and [#400] exist to create and [#890] just restored.
  A re-homing host is per-provider by definition, so the map alone expresses every real case.
- **No change to the default strategy.**
  Flipping to `portable` would change every child's prompt on a routine upgrade with no user edit, and for a user without `@gotgenes/pi-permission-system` it would trade [#901]'s wrong tool list for no tool list at all — which is [#901]'s call, not this change's side effect.
- **No tool-docs work.**
  [ADR 0008] and `pi-permission-system`'s [ADR 0014] relocate each session's tool surface past the layers a child inherits, so a portable child gets honest tool docs from its own node; [#901] owns the case where that extension is absent.
- **No provenance marker or side channel.**
  Any marker placed before the inherited text ends the shared prefix [#180] and [#400] protect.
  `pi-claude-bridge` PR [bridge#89] fixes the projection on its own side.
- **No provider-declared policy.**
  `ProviderConfigInput` in the pinned SDK `0.84.4` (`dist/core/provider-composer.d.ts`) carries `name`, `baseUrl`, `apiKey`, `api`, `streamSimple`, `headers`, `authHeader`, `oauth`, `models`, and `refreshModels` — no policy field.
  A provider cannot declare that it re-homes prompts, so the settings map is the available seam rather than the preferred one.
- **No worktree-specific handling.**
  A worktree child's failure was measured to be `pi-permission-system`'s in-place prompt rewrite, fixed by [#890] — not an unreachable capture map.
- **No fix for `genericBase`'s capability claim.**
  Tracked as [#904] and scheduled as Phase 22 Step 20.

## Background

### How a child's identity is built today

`buildAgentPrompt` (`src/session/prompts.ts`) places the inherited identity first in both prompt modes, then the `<active_agent>` tag, the environment block, and the agent's own instructions.
The identity is `inheritedIdentity(parentPrompt, parentCwd)`, which cuts the parent's prompt at the first per-session layer — the `<available_skills>` catalogue, else the `Current working directory:` footer — and returns what precedes it byte for byte ([ADR 0006], Refs [#640], [#801]).
When no parent prompt is available it falls back to the module-local `genericBase`.

The parent prompt reaching that function is the **post-extension** one.
`buildParentSnapshot` records `ctx.getSystemPrompt()` (`src/lifecycle/parent-snapshot.ts:40`), which returns `agent.state.systemPrompt` — assigned from `before_agent_start`'s `result.systemPrompt`.
So `pi-permission-system`'s tool-surface relocation is already applied, and the relocated block sits past the cwd footer, outside the cut.

### Why the capture seam is `before_agent_start`

The portable parts are Pi's own `BuildSystemPromptOptions`, reachable only through `ctx.getSystemPromptOptions()` — which `createCommandContext()` attaches and the ordinary event context this package holds from `session_start` does not.
The pinned `0.84.4` declarations agree: it is declared on `ExtensionCommandContext`, and only optionally on the internal `ExtensionContextActions`.
`before_agent_start`'s event payload carries the same object (`emitBeforeAgentStart(…, this._baseSystemPromptOptions)`), so capturing it there is the only available route.
This package registers no `before_agent_start` handler today; [ADR 0008]'s [#901] residual anticipated adding one.

### Which parts are portable

`_baseSystemPromptOptions` is assembled once per turn in Pi's `_rebuildSystemPrompt`.
Three of its fields are operator-authored and travel safely into another harness:

- `contextFiles` — `AGENTS.md` and kin.
  These must ride along: `createSubagentSession` builds the child's loader with `noContextFiles: true` (`src/lifecycle/create-subagent-session.ts`), so a portable child would otherwise see no project instructions at all.
- `customPrompt` — the loader's `--system-prompt`.
- `appendSystemPrompt` — the loader's append registrations.

`promptGuidelines` is **deliberately excluded**, correcting PR [#884], which includes it.
Pi derives it per session from the tools actually in the registry:

```typescript
const toolGuidelines = this._toolPromptGuidelines.get(name);
if (toolGuidelines) {
  promptGuidelines.push(...toolGuidelines);
}
```

Inheriting the parent's would assert guidance for the parent's tools to a child that may hold none of them — the exact defect [ADR 0008] removed when it deleted the `<sub_agent_context>` block for naming `edit` and `write` to a child with neither.
`skills` is excluded for the same reason [ADR 0006] cuts the catalogue: the child loads its own.
`selectedTools` and `toolSnippets` are excluded because the tool surface is node-local prose ([ADR 0014]).

What remains is a clean boundary: **the portable identity is the operator's own text, and nothing Pi or a tool contributed.**

### Constraints from AGENTS.md

- Commit type follows what a user can observe.
  A module nothing consumes yet is `refactor:` however new it is; the commit that wires it up carries the `feat:`.
- The exclusion-policy precedent: policy is resolved at the composition root in `index.ts` and reaches `createSubagentSession` as a ready-made settings view, so the assembly factory stays policy-free (Refs [#696]).
  The provider is known only inside `assembleSessionConfig`, so the ready-made view here is a resolver function rather than a resolved value.

## Design Overview

### Strategy selection

One new type, in `src/types.ts` so neither `settings.ts` nor `prompts.ts` imports the other:

```typescript
/** How a child adopts its parent's prompt as its own identity. */
export type PromptInheritance = "full" | "portable";
```

The setting is a flat map keyed by provider id:

```jsonc
{ "promptInheritance": { "claude-bridge": "portable" } }
```

Every provider not listed resolves to `"full"`.
`SettingsManager` owns the lookup rather than exposing the map, so the interpretation has one home:

```typescript
promptInheritanceFor(provider: string | undefined): PromptInheritance {
  if (provider === undefined) return "full";
  return this._promptInheritance[provider] ?? "full";
}
```

The composition root hands `createSubagentSession` the resolver, mirroring the `excludedExtensionPackages` settings-view convention:

```typescript
const subagentSessionDeps: SubagentSessionDeps = {
  // …
  resolvePromptInheritance: (provider) => settings.promptInheritanceFor(provider),
};
```

`assembleSessionConfig` then resolves the model first — the two computations are independent, and `resolveDefaultModel` reads only `ctx.parentModel`, `ctx.modelRegistry`, and `agentConfig.model` — and hands `buildAgentPrompt` the settled strategy:

```typescript
const model = options.model ?? resolveDefaultModel(ctx.parentModel, ctx.modelRegistry, agentConfig.model);
const strategy = ctx.resolvePromptInheritance?.(model?.provider) ?? "full";
const systemPrompt = io.buildAgentPrompt(agentConfig, effectiveCwd, env, {
  systemPrompt: ctx.parentSystemPrompt,
  cwd: ctx.cwd,
  strategy,
  portablePrompt: ctx.parentPortablePrompt,
});
```

### The identity branch

`InheritedPrompt` grows two optional fields:

```typescript
export interface InheritedPrompt {
  /** The parent agent's effective system prompt. */
  systemPrompt: string;
  /** The parent's working directory — the cwd its prompt footer names. */
  cwd: string;
  /** Which identity the child adopts. Absent means `"full"`, the default. */
  strategy?: PromptInheritance;
  /** The parent's portable parts; may be absent even under `"portable"`. */
  portablePrompt?: string;
}
```

and `buildAgentPrompt`'s existing one-line selection becomes:

```typescript
const identity = inherited ? adoptedIdentity(inherited) : genericBase;
```

```typescript
function adoptedIdentity(inherited: InheritedPrompt): string {
  if (inherited.strategy !== "portable") {
    return inheritedIdentity(inherited.systemPrompt, inherited.cwd);
  }
  // An absent or whitespace-only capture falls back to the generic base, never
  // to the full prompt — opting into portable must never silently re-embed the
  // harness base it exists to avoid.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- || intentional: a whitespace-only capture must fall back too
  return inherited.portablePrompt?.trim() || genericBase;
}
```

Optionality is not vacant here: `"full"` genuinely is the strategy for every provider a user does not list, and defaulting at this single site keeps the ~29 existing `{ systemPrompt, cwd }` construction sites in `prompts.test.ts` valid.

The `full` path is untouched, which is what preserves [ADR 0008]'s guarantee.

### Rendering the portable identity

`buildPortablePrompt` composes the three operator-authored layers in **Pi's own order**, so the result is byte-identical to what `buildSystemPrompt` produces for a session with a custom prompt and no tools or skills (`../pi/packages/coding-agent/src/core/system-prompt.ts:48-63`):

```text
<customPrompt>

<appendSystemPrompt>

<project_context>

Project-specific instructions and guidelines:

<project_instructions path="…">
…
</project_instructions>

</project_context>
```

Each section is omitted when its input is absent; the whole is `trimEnd()`ed, matching `inheritedIdentity`.
`undefined` is returned when nothing survives, which is what routes the empty case to `genericBase`.

This corrects two things in PR [#884]'s `buildPortablePrompt`: it emitted the parts in the wrong order (context files first) and omitted Pi's `Project-specific instructions and guidelines:` lead-in.
Rendering from parts rather than slicing the assembled string is the principle [#890] settled on.

### Capture and snapshot

```typescript
/** The parent session's operator-authored prompt parts, as Pi reports them. */
export interface ParentPromptOptions {
  contextFiles?: Array<{ path: string; content: string }>;
  customPrompt?: string;
  appendSystemPrompt?: string;
}
```

`SubagentRuntime` holds the latest capture and threads it into the snapshot:

```typescript
pi.on("before_agent_start", (event) => {
  runtime.setSystemPromptOptions(event.systemPromptOptions);
});
```

`buildParentSnapshot(ctx, inheritContext, promptOptions?)` renders it once, at spawn time, into `ParentSnapshot.portablePrompt` — so a queued child captures the parent's state as it was when the spawn was requested, consistent with the snapshot's existing contract.

Three positionals is within local convention: the sibling `buildAgentPrompt(config, cwd, env, inherited?)` has four, and `assembleSessionConfig` has six.

### The unresolved-model residual is unreachable

Provider-only selection has no backstop when a child resolves no model, so the PR-review decision made measuring its reachability a plan-time task.
Measured: `ctx.model` is `agent.state.model`, and Pi leaves it `undefined` only when `findInitialModel` finds none — the `formatNoModelsAvailableMessage()` branch in `core/sdk.ts:211-223`, meaning **no authenticated model exists at all**.
Such a parent cannot run a turn, so it emits no `before_agent_start`, holds no capture, and cannot spawn a child that makes an API call.

The other two paths keep a provider: `resolveDefaultModel` returns `parentModel` when the agent's `model:` string does not resolve, and a per-spawn `options.model` is a `Model<any>` that always carries `.provider`.

**No diagnostic is warranted**, and the `provider === undefined → "full"` arm is a defensive default rather than a reachable case.

### Scope: `portable` is for re-homing hosts only

Documented, not enforced.
Pointing `portable` at a provider that does *not* re-home the prompt is worse than `full`, and the worked counter-example belongs in `docs/configuration.md`:

`@gotgenes/pi-anthropic-auth` shapes the OAuth system prompt by locating Pi's role line —

```typescript
const prefixIdx = systemPrompt.indexOf(PI_DEFAULT_PROMPT_PREFIX);
if (prefixIdx === -1) return systemPrompt;
```

— and replacing the span through the preamble terminator with `MINIMAL_ANTHROPIC_OAUTH_PROMPT` plus the sanitized remainder, which removes the `Pi documentation` block and with it #883's trigger.
A portable child has no role line, so shaping returns unchanged: nothing is stripped (there is nothing to strip) but the child also never receives the minimal neutral prompt.
Combined with `general-purpose`'s `systemPrompt: ""`, such a child would run with `AGENTS.md`, an `<active_agent>` tag, an environment block, and no role framing.
Under `full` the same stack already produces `portable`'s intended outcome and supplies role framing as well.

## Module-Level Changes

### Source

| File                                       | Change                                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`                             | Add `export type PromptInheritance = "full" \| "portable"`                                                                                                                                                                                                                                         |
| `src/settings.ts`                          | `SubagentsSettings.promptInheritance?` and `SettingsSnapshot.promptInheritance?` (both `Record<string, PromptInheritance>`); a `sanitize()` block shaped like the `excludedExtensionPackages` one; `SettingsManager._promptInheritance` assigned unconditionally on load; `promptInheritanceFor()` |
| `src/lifecycle/parent-snapshot.ts`         | Export `ParentPromptOptions`; add `ParentSnapshot.portablePrompt?`; module-private `buildPortablePrompt`; third parameter on `buildParentSnapshot`                                                                                                                                                 |
| `src/runtime.ts`                           | `lastPromptOptions` field, `setSystemPromptOptions()`, threaded through `buildSnapshot()`                                                                                                                                                                                                          |
| `src/lifecycle/create-subagent-session.ts` | `SubagentSessionDeps.resolvePromptInheritance`; pass `parentPortablePrompt` and the resolver into the `AssemblerContext`                                                                                                                                                                           |
| `src/session/session-config.ts`            | `AssemblerContext.parentPortablePrompt?` and `.resolvePromptInheritance?`; model resolution moves above prompt building; strategy resolved and passed                                                                                                                                              |
| `src/session/prompts.ts`                   | `InheritedPrompt.strategy?` and `.portablePrompt?`; `adoptedIdentity` helper below `buildAgentPrompt`                                                                                                                                                                                              |
| `src/index.ts`                             | `pi.on("before_agent_start")` capture handler; `resolvePromptInheritance` in the deps literal                                                                                                                                                                                                      |

### Docs

| File                                                             | Change                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/configuration.md`                                          | `promptInheritance` row in the settings table; a *Portable inheritance (opt-in)* subsection with the strategy table, the provider-keyed example, and the re-homing-only scope with the `pi-anthropic-auth` counter-example |
| `docs/decisions/0009-portable-inheritance-is-provider-scoped.md` | New ADR: two strategies, why the key is the provider and not the agent, why the default does not flip, why `promptGuidelines` is excluded                                                                                  |
| `docs/decisions/0008-inherited-region-is-shared-parts.md`        | A Consequences bullet pointing at 0009                                                                                                                                                                                     |
| `docs/architecture/architecture.md`                              | `prompts.ts` module-tree entry gains the two strategies; `parent-snapshot.ts` entry gains the portable capture                                                                                                             |
| `.pi/skills/package-pi-subagents/SKILL.md`                       | The inherited-prompt paragraph describes only the identity cut; add the provider-scoped `portable` alternative                                                                                                             |

The architecture-doc entries state current behavior and cite [ADR 0009] rather than issue numbers, per the module-tree convention.

### Predicted unchanged

- `src/config/custom-agents.ts`, `src/config/agent-types.ts`, `test/config/custom-agents.test.ts` — no frontmatter key is added, so the frontmatter parser and its schema are untouched.
- The roadmap's `grep -c 'available_skills' src/session/prompts.ts` health row stays at **3** (measured baseline: 3) — the change adds a branch above `inheritedIdentity` and edits none of the catalogue anchors.
- `src/session/provider-inheritance.ts` — the child's provider registrations are replayed exactly as before; only the strategy lookup reads the provider id.

### Symbol sweep

No export is removed or renamed, so the removal greps do not apply.
`ParentSnapshot`, `InheritedPrompt`, `AssemblerContext`, `SubagentSessionDeps`, `SubagentsSettings`, and `SettingsSnapshot` all grow by **optional** fields, so no construction site breaks at the type level.
`SettingsSnapshot` gaining an optional field needs no `test/` sweep for a `promptInheritance: undefined` literal — the field never existed.

## Test Impact Analysis

New unit tests the change enables, none of which were previously expressible:

- `settings.test.ts` — the map's sanitization (unknown strategy dropped, non-object rejected, absent when empty), round-tripping through `snapshot()`, and `promptInheritanceFor`'s three arms.
- `parent-snapshot.test.ts` — `buildPortablePrompt`'s section order and its byte-exact `<project_context>` rendering, each section's omission when its input is absent, and `undefined` when nothing survives.
- `prompts.test.ts` — a new `describe("portable inheritance")` sibling of the existing `describe("shared prefix with the parent")`: a portable child carries neither Pi's role line nor the documentation-routing line; the empty and whitespace-only captures fall back to `genericBase`; a `full` child is unaffected.
- `session-config.test.ts` — the strategy is resolved from the **child's** provider, including the per-spawn `options.model` override case, which is the case PR [#884]'s frontmatter-first order gets wrong.

No existing test becomes redundant.
The `describe("shared prefix with the parent")` block must stay exactly as it is — it pins the invariant this change must not disturb.

One mechanical consequence, flagged by the Tidy-First assessment: `runtime.test.ts`'s two `expect(mockBuildParentSnapshot).toHaveBeenCalledWith(ctx, true)` assertions gain a third argument once `buildSnapshot` threads the capture.

## Invariants at risk

| Invariant                                                             | Constituency                                                                                                                  | Pinned by                                                                       | Status                                                                                     |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| A `full` child opens with the parent's identity verbatim ([ADR 0008]) | Hosts that reuse a prefix over the system text — [#180]'s local-inference reporter, who measured 8,333 shared tokens at ~40 s | `describe("shared prefix with the parent")`, `test/session/prompts.test.ts:732` | Holds — `full` is the default and its code path is untouched                               |
| The identity is cut at the first per-session layer ([ADR 0006])       | Workspace-isolated children ([#640]) and children with their own skill catalogue ([#801])                                     | The catalogue/footer cases in `prompts.test.ts`                                 | Holds — `inheritedIdentity` is unmodified                                                  |
| Per-session tool prose sits outside the inherited region ([ADR 0014]) | `pi-permission-system` and every child whose tool set is narrowed                                                             | `pi-permission-system`'s own suite                                              | Holds — a portable identity contains no tool prose at all, so there is nothing to relocate |
| The exclusion policy is resolved at the composition root ([#696])     | The assembly factory, which must stay policy-free                                                                             | `test/lifecycle/create-subagent-session.test.ts`                                | Holds — the resolver is injected the same way                                              |

The quantitative form of the first invariant: the `full` identity's byte length and content are unchanged, because `adoptedIdentity` delegates to `inheritedIdentity` untouched when `strategy !== "portable"`, and `strategy` is absent at every existing call site.
The verification is the existing block staying green, plus the killing mutation in Step 5 that must **not** turn it red.

## TDD Order

1. **`refactor:` — the provider-keyed inheritance setting.**
   Add `PromptInheritance` to `src/types.ts`; add the field to `SubagentsSettings` and `SettingsSnapshot`; extend `sanitize()` with a block shaped like the `excludedExtensionPackages` one; add `_promptInheritance` (assigned unconditionally on load, so removing the key from disk clears it) and `promptInheritanceFor()`.
   Nothing reads it yet, so nothing is observable — hence `refactor:`.
   Tests: `test/settings.test.ts`.
   *Killing mutations:* make `promptInheritanceFor` return `"full"` unconditionally — the listed-provider test must go red; and let `sanitize()` copy the raw object through unfiltered — the unknown-strategy-dropped test must go red.
   Suggested subject: `refactor(pi-subagents): add the provider-keyed promptInheritance setting`.

2. **`refactor:` — capture and render the parent's portable parts.**
   Add `ParentPromptOptions`, `buildPortablePrompt`, `ParentSnapshot.portablePrompt`, and the third parameter on `buildParentSnapshot`.
   Still unconsumed.
   Tests: `test/lifecycle/parent-snapshot.test.ts`.
   *Killing mutations:* return `undefined` from `buildPortablePrompt` unconditionally — every render test red; drop the `Project-specific instructions and guidelines:` lead-in — the byte-exact `<project_context>` test red; swap the `customPrompt`/`contextFiles` order — the section-order test red.
   Suggested subject: `refactor(pi-subagents): render the parent's portable prompt parts into the snapshot`.

3. **`refactor:` — hold the latest prompt-options capture on the runtime.**
   Add `lastPromptOptions` and `setSystemPromptOptions()`; thread it through `buildSnapshot()`.
   Update `runtime.test.ts`'s two `toHaveBeenCalledWith(ctx, true)` assertions in this step.
   *Killing mutation:* have `buildSnapshot` pass `undefined` as the third argument — the "snapshot carries the captured options" test red.
   Suggested subject: `refactor(pi-subagents): hold the parent's latest prompt options on the runtime`.

4. **`refactor:` — the portable identity branch in the prompt assembler.**
   Add `strategy?`/`portablePrompt?` to `InheritedPrompt` and the `adoptedIdentity` helper below `buildAgentPrompt`.
   No caller passes `strategy` yet.
   Tests: a new `describe("portable inheritance")` in `test/session/prompts.test.ts`.
   *Killing mutations, one per equivalence class:* make the portable branch fall through to `inheritedIdentity` — the "carries neither the role line nor the documentation-routing line" tests red, the `full` tests green; return `""` instead of `genericBase` on an empty capture — the fail-safe test red; change `||` to `??` — the whitespace-only test red, the absent-capture test green.
   Suggested subject: `refactor(pi-subagents): add the portable identity branch to buildAgentPrompt`.

5. **`refactor:` — resolve the model before building the prompt.**
   Move `assembleSessionConfig`'s model-resolution block above its prompt-building block.
   A pure reorder of two independent computations, landed on its own so the wiring step that needs the provider is a small diff against a green tree.
   No new tests; the existing `session-config.test.ts` suite is the pin, and the `describe("shared prefix with the parent")` block must stay green.
   Suggested subject: `refactor(pi-subagents): resolve the child model before assembling its prompt`.

6. **`feat:` — a child on a re-homing provider inherits only portable parts.**
   The wiring, and the first commit with observable behavior: `AssemblerContext.parentPortablePrompt`/`.resolvePromptInheritance`, the strategy resolution and hand-off in `assembleSessionConfig`, `SubagentSessionDeps.resolvePromptInheritance`, the pass-through in `create-subagent-session.ts`, and in `index.ts` both the `before_agent_start` capture handler and the resolver entry in the deps literal.
   Tests: `test/session/session-config.test.ts` and `test/lifecycle/create-subagent-session.test.ts`.
   *Killing mutations:* hardcode `"full"` in place of the `resolvePromptInheritance(model?.provider)` call — the "child on a configured provider gets the portable identity" test red; pass `ctx.parentModel?.provider` instead of `model?.provider` — the per-spawn `model:` override test red; delete the `pi.on("before_agent_start")` registration at its new site — the capture-wiring test red.
   Suggested subject: `feat(pi-subagents): inherit only portable prompt parts on a re-homing provider`.

7. **`docs:` — record the strategy and its scope.**
   `docs/configuration.md`, ADR 0009, the Consequences bullet on ADR 0008, the two `architecture.md` module-tree entries, and the `package-pi-subagents` skill paragraph.
   Suggested subject: `docs(pi-subagents): document provider-scoped portable prompt inheritance`.

Every implementation and docs commit in this plan carries, as the final paragraph of its body:

```text
Co-authored-by: George Harker <george@george-graphics.co.uk>
```

Reference the PR as `Refs #884`, never `Closes #884`.

## Risks and Mitigations

| Risk                                                                                                                                                                                    | Mitigation                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A portable child whose parent has no `AGENTS.md`, custom prompt, or append prompt falls back to `genericBase`, which claims write and exec capability it may not hold                   | Real, and filed: [#904], scheduled as Phase 22 Step 20. `docs/configuration.md` names the condition                                                                                                           |
| Provider ids are coarser than the phenomenon — `pi-anthropic-auth` re-registers the existing `anthropic` id rather than minting one, so a wrapper is indistinguishable from the raw API | Accepted and documented. The user is describing their own stack, and it is no worse than frontmatter, which cannot see the provider at all                                                                    |
| `portable` pointed at a non-re-homing provider produces a child with no role framing                                                                                                    | Documented with the `pi-anthropic-auth` worked counter-example rather than enforced — the SDK exposes no way to identify a re-homing provider                                                                 |
| Pi's `<project_context>` rendering drifts, and the hand-rolled copy diverges                                                                                                            | A byte-exact test pins the format against the shape cited from `core/system-prompt.ts:55-63`. Divergence surfaces as a failing test rather than a silently malformed prompt                                   |
| A capture from a prior turn is stale by spawn time                                                                                                                                      | The snapshot's existing contract already fixes parent state at spawn time; the capture is refreshed on every `before_agent_start`, so it is at most one turn old — the same currency as `systemPrompt` itself |
| The `before_agent_start` handler is this package's first, and overlaps the mechanism [#901] anticipates                                                                                 | Additive: the handler stores a capture and returns nothing, so [#901] can extend it rather than compete with it                                                                                               |

## Open Questions

None blocking.

`pi-claude-bridge` PR [bridge#89] would fix the projection downstream for bridge users specifically.
If it lands, `portable` remains warranted for any other re-homing host with no projection to fix — which is the narrowed warrant this plan implements, not a reason to defer.

[#180]: https://github.com/gotgenes/pi-packages/issues/180
[#400]: https://github.com/gotgenes/pi-packages/issues/400
[#640]: https://github.com/gotgenes/pi-packages/issues/640
[#696]: https://github.com/gotgenes/pi-packages/issues/696
[#801]: https://github.com/gotgenes/pi-packages/issues/801
[#884]: https://github.com/gotgenes/pi-packages/pull/884
[#890]: https://github.com/gotgenes/pi-packages/issues/890
[#901]: https://github.com/gotgenes/pi-packages/issues/901
[#904]: https://github.com/gotgenes/pi-packages/issues/904
[ADR 0006]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/docs/decisions/0006-inherited-prompt-is-identity-only.md
[ADR 0008]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/docs/decisions/0008-inherited-region-is-shared-parts.md
[ADR 0009]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/docs/decisions/0009-portable-inheritance-is-provider-scoped.md
[ADR 0014]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0014-tool-surface-is-node-local-prose.md
[bridge#89]: https://github.com/elidickinson/pi-claude-bridge/pull/89
