---
issue: 264
issue_title: "Remove isolated / extensions:false / noSkills from core"
---

# Remove the extension-lifecycle-control axis from the core

## Problem Statement

The core still carries an extension-lifecycle-control axis - `isolated`, `extensions: false`, and `noSkills` - that lets a spawn blanket-disable a child's extensions and skills.
Per [ADR-0002], this is policy that does not belong in a minimal orchestrator.
Deny-at-use (the in-child permission layer, shipped in Step 1 / #261) already covers what `isolated` pretended to do for tools.
Prevent-load (refusing to bind an extension for true sandboxing) is genuinely generative and is deliberately left as a *latent, un-built* provider seam - we do not ship a vacant hook.

This is Phase 16, Step 4.
With the axis gone, children always load the parent's extensions and skills, and the recursion guard - which currently gates on `cfg.extensions` - becomes unconditional.

## Goals

- Remove `isolated` from the spawn API, `SubagentsService`, the lifecycle plumbing, and the config assembler.
- Remove the `extensions` boolean from `AgentConfig` and the assembler (children always inherit extensions).
- Remove `noSkills` from the assembler and the resource-loader options.
- Collapse the skill-curation axis symmetrically: remove `AgentConfig.skills` and the skill-**preload** path (`skill-loader.ts`, `safe-fs.ts`, `preloadSkills`, `PromptExtras`, `extras.skillBlocks`).
  Children always load Pi's full skill system, exactly as `skills: true` does today.
- Make the recursion guard unconditional - it always strips `subagent` / `get_subagent_result` / `steer_subagent` from children, keyed off the core's own tool names.
- This is a **breaking** change: the public `SpawnOptions.isolated` field and the `isolated:` / `extensions:` / `skills:` custom-agent frontmatter keys are removed.
  Suggested commits use `feat!:`.

## Non-Goals

- Born-complete child execution / dissolving the runner - that is Step 5 (#265) and depends on this step.
  `RunOptions`, `runAgent`, `ConcreteAgentRunner`, and `Agent.run()` survive this issue (with `isolated` removed from them).
- Shipping a prevent-load provider seam — [ADR-0002] leaves it latent until a real consumer needs it.
- Changing `builtinToolNames` (the `tools:` frontmatter allowlist) - that is a separate, surviving concern.
- Changing deny-at-use behavior in `@gotgenes/pi-permission-system` - already in place from #261.

## Background

Relevant modules and how they relate:

- `src/types.ts` - declares `AgentConfig` (`extensions`, `skills`, `isolated`) and `AgentInvocation` (`isolated`).
- `src/config/default-agents.ts` - the three embedded agents set `extensions: true`, `skills: true`.
- `src/config/custom-agents.ts` - parses `extensions` / `skills` / `isolated` from `.md` frontmatter via `resolveBoolExtensions` and `inheritField`.
- `src/config/invocation-config.ts` - merges `isolated` from agent config + tool params.
- `src/config/agent-types.ts` - an absolute-fallback `AgentConfig` literal sets `extensions: true`, `skills: true`.
- `src/session/session-config.ts` - `assembleSessionConfig` derives `extensions`/`skills` from `options.isolated`, calls `io.preloadSkills` when `skills` is `string[]`, and computes `noSkills`.
  Returns `SessionConfig.{ extensions, noSkills, extras }`.
- `src/session/prompts.ts` - `buildAgentPrompt` injects `extras.skillBlocks` as `# Preloaded Skill:` sections; `PromptExtras` carries only `skillBlocks` (memory was removed in #185).
- `src/session/skill-loader.ts` - `preloadSkills` reads named skill files from disk; consumes `safe-fs.ts`.
- `src/session/safe-fs.ts` - symlink/path-traversal guards; **only consumer is `skill-loader.ts`**.
- `src/lifecycle/agent-runner.ts` - `RunOptions.isolated` flows into the assembler; `createResourceLoader` is called with `noExtensions: !cfg.extensions` and `noSkills: cfg.noSkills`; the recursion guard runs only `if (cfg.extensions)`.
  `ResourceLoaderOptions` (a local narrow interface, not the SDK type) declares `noExtensions?` / `noSkills?`.
- `src/lifecycle/agent.ts` - `AgentInit.isolated`, the `_isolated` field, and `isolated:` in the `runner.run(...)` call.
- `src/lifecycle/agent-manager.ts` - `AgentSpawnConfig.isolated` and its pass-through to `new Agent(...)`.
- `src/tools/{agent-tool,spawn-config,foreground-runner,background-spawner}.ts` - tool schema `isolated`, `SpawnExecution.isolated`, and pass-through.
- `src/service/{service,service-adapter}.ts` - public `SpawnOptions.isolated` and its pass-through to the manager.
- `src/ui/{display,agent-config-editor,agent-creation-wizard}.ts` - `isolated` tag, eject-content emission, and generation-prompt template text.
- `src/index.ts` - wires `preloadSkills` and `buildAgentPrompt` into `assemblerIO`.

AGENTS.md constraints that apply:

- Conventional Commits; breaking changes use `feat!:`.
- Do not edit `CHANGELOG.md` (release-please owns it).
- When removing an export, grep all `src/` and `test/` for the symbol before finalizing (done below).
- When adding/removing a module, check `docs/architecture/` for layout listings and complexity tables that reference it (done below - Mermaid + tree + field tables).
- One-sentence-per-line markdown; sequential numbering restarting per heading.

## Design Overview

This is a **symmetric collapse**, not a refactor.
Two parallel axes leave the core together:

| Axis       | Today                                                          | After                                         |
| ---------- | -------------------------------------------------------------- | --------------------------------------------- |
| Extensions | `extensions: true \| false`; `isolated` forces `false`         | always inherit (field gone)                   |
| Skills     | `skills: true \| string[] \| false`; `isolated` forces `false` | always inherit full skill system (field gone) |

The `skills` field collapses for the same reason `extensions` does: `noSkills` is the single mechanism behind **both** restriction modes (`skills: false` → no skills; `skills: string[]` → only those, preloaded into the prompt with the SDK loader suppressed).
Removing `noSkills` without removing `AgentConfig.skills` would leave a field that silently stops restricting - a `string[]` agent would get its baked-in skills *plus* the full system.
[ADR-0002] says children always load the parent’s skills, which is exactly the `skills: true` path; the other two values are skill curation/policy and leave the core.

### Assembler after collapse

`assembleSessionConfig` loses the `isolated` branch, the `preloadSkills` block, and the `noSkills`/`extensions`/`extras` outputs:

```typescript
export interface AssemblerOptions {
  cwd?: string;
  model?: unknown;
  thinkingLevel?: ThinkingLevel;
  // isolated removed
}

export interface SessionConfig {
  effectiveCwd: string;
  systemPrompt: string;
  toolNames: string[];
  model: unknown;
  thinkingLevel: ThinkingLevel | undefined;
  agentMaxTurns: number | undefined;
  // extensions, noSkills, extras removed
}
```

`AssemblerIO` drops `preloadSkills`, keeping only `buildAgentPrompt` (now called without `extras`).

### Runner after collapse

The resource-loader call drops the two suppression flags, and the guard runs unconditionally:

```typescript
const loader = deps.io.createResourceLoader({
  cwd: cfg.effectiveCwd,
  agentDir,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
  systemPromptOverride: () => cfg.systemPrompt,
  appendSystemPromptOverride: () => [],
  // noExtensions, noSkills removed
});
// ...
await session.bindExtensions({});
// Recursion guard - now unconditional (children always load extensions).
const filtered = filterActiveTools(session.getActiveToolNames());
session.setActiveToolsByName(filtered);
```

`ResourceLoaderOptions` drops `noExtensions?` / `noSkills?` (a local narrow interface - removing the latent fields keeps us honest per [ADR-0002]’s “no vacant hooks”).

### Call-site sketch - recursion guard (Tell-Don't-Ask check)

The guard already asks the session for its active tools and tells it the filtered set - unchanged except for removing the `if`.
No new collaborator, no reach-through; the only structural change is that `cfg.extensions` is no longer consulted, so `SessionConfig` no longer needs to expose it.
This is a narrowing of the assembler's output contract, which is the desired direction.

### Edge cases

- Append-mode agents: `parentSystemPrompt` still embeds parent context via `systemPromptOverride`; nothing about that path depends on skills/extensions flags.
- Custom agents with legacy `extensions:` / `skills:` / `isolated:` frontmatter: the keys are silently ignored after this change (no parse, no warning).
  `resolveBoolExtensions` already warned on the deprecated allowlist syntax; that warning path is removed with the parser.
- The absolute-fallback `AgentConfig` in `agent-types.ts` drops `extensions`/`skills` like every other construction site.

## Module-Level Changes

### Source - `isolated` axis

- `src/types.ts` - remove `AgentConfig.isolated`, `AgentInvocation.isolated`.
- `src/config/invocation-config.ts` - remove `isolated` from `AgentInvocationParams` and the return object.
- `src/config/custom-agents.ts` - remove the `isolated:` frontmatter parse.
- `src/session/session-config.ts` - remove `AssemblerOptions.isolated` and the `options.isolated ? false : ...` derivation (read `agentConfig.extensions`/`agentConfig.skills` directly, for now).
- `src/lifecycle/agent-runner.ts` - remove `RunOptions.isolated` and the `isolated:` argument passed to `assembleSessionConfig`.
- `src/lifecycle/agent.ts` - remove `AgentInit.isolated`, the `_isolated` field + constructor assignment, and `isolated:` in the `runner.run(...)` call.
- `src/lifecycle/agent-manager.ts` - remove `AgentSpawnConfig.isolated` and its pass-through to `new Agent(...)`.
- `src/tools/agent-tool.ts` - remove the `isolated` schema property.
- `src/tools/spawn-config.ts` - remove `SpawnExecution.isolated`, the `const isolated = resolvedConfig.isolated`, `isolated` in `agentInvocation`, and `isolated` in the `execution` return.
- `src/tools/foreground-runner.ts` / `src/tools/background-spawner.ts` - remove `isolated: execution.isolated`.
- `src/service/service.ts` - remove `SpawnOptions.isolated`.
- `src/service/service-adapter.ts` - remove `isolated: options?.isolated` from the `manager.spawn(...)` call.
- `src/ui/display.ts` - remove `if (invocation.isolated) tags.push("isolated")` and the `isolated` mention in the JSDoc example.
- `src/ui/agent-config-editor.ts` - remove the `isolated: true` line from `buildEjectContent`.
- `src/ui/agent-creation-wizard.ts` - remove the `isolated:` template line and the "Set isolated: true ..." guideline.

### Source - `extensions` axis + unconditional guard

- `src/types.ts` - remove `AgentConfig.extensions`.
- `src/config/default-agents.ts` - remove `extensions: true` from all three agents.
- `src/config/agent-types.ts` - remove `extensions: true` from the absolute-fallback literal.
- `src/config/custom-agents.ts` - remove the `extensions:` frontmatter parse and delete `resolveBoolExtensions`.
- `src/session/session-config.ts` - remove `SessionConfig.extensions` and stop assigning it.
- `src/lifecycle/agent-runner.ts` - remove `ResourceLoaderOptions.noExtensions`, drop `noExtensions` from the `createResourceLoader` call, and make the recursion guard unconditional (delete `if (cfg.extensions)`); update the explanatory comment.
- `src/ui/agent-config-editor.ts` - remove the `extensions: false` line from `buildEjectContent`.
- `src/ui/agent-creation-wizard.ts` - remove the `extensions:` template line.

### Source - `skills` axis + preload path

- `src/types.ts` - remove `AgentConfig.skills`.
- `src/config/default-agents.ts` - remove `skills: true` from all three agents.
- `src/config/agent-types.ts` - remove `skills: true` from the absolute-fallback literal.
- `src/config/custom-agents.ts` - remove the `skills:` frontmatter parse and delete `inheritField` (its only remaining callers are `skills`/`extensions`; `csvList`, `parseCsvField`, `str`, `nonNegativeInt` stay - `csvList` still serves `tools:`).
- `src/session/session-config.ts` - remove `AssemblerIO.preloadSkills`, `SessionConfig.noSkills`, `SessionConfig.extras`, the `extras`/`preloadSkills` block, and the `extras` argument to `buildAgentPrompt`.
- `src/session/prompts.ts` - remove `PromptExtras`, the `extras` parameter, and the `extrasSuffix` logic.
- `src/session/skill-loader.ts` - **delete** (export `preloadSkills`, `PreloadedSkill`).
- `src/session/safe-fs.ts` - **delete** (sole consumer was `skill-loader.ts`).
- `src/lifecycle/agent-runner.ts` - remove `ResourceLoaderOptions.noSkills` and drop `noSkills` from the `createResourceLoader` call.
- `src/index.ts` - remove the `preloadSkills` import and its `assemblerIO.preloadSkills` wiring.
- `src/ui/agent-config-editor.ts` - remove the `skills: false` / `skills: <list>` lines from `buildEjectContent`.
- `src/ui/agent-creation-wizard.ts` - remove the `skills:` template line.

### Tests

- `test/session/skill-loader.test.ts` - **delete**.
- `test/session/safe-fs.test.ts` - **delete**.
- `test/session/session-config.test.ts` - remove the `isolated`-mode `describe`, the `noSkills` assertions, and the preload tests; keep model-resolution and prompt-assembly assertions.
- `test/session/prompts.test.ts` - remove `isolated`/`extensions`/`skills` from `AgentConfig` fixtures and any `skillBlocks`/`extras` cases.
- `test/config/invocation-config.test.ts` - remove `isolated` cases and fixture fields.
- `test/config/custom-agents.test.ts` - remove `extensions` / `skills` / `isolated` frontmatter-parsing tests.
- `test/config/agent-types.test.ts` - remove `extensions` / `skills` / `isolated` from fixtures.
- `test/lifecycle/agent-runner-extension-tools.test.ts` - remove `extensions`/`skills`/`isolated` from the mock config; delete the "extensions: false skips the filter entirely" test; keep/adjust the post-bind guard tests to assert the guard runs unconditionally.
- `test/tools/spawn-config.test.ts` - remove the "sets isolated from params" test and `isolated` fixture fields.
- `test/tools/background-spawner.test.ts` / `test/tools/foreground-runner.test.ts` - remove `isolated` from fixtures and `agentInvocation` assertions.
- `test/tools/result-renderer.test.ts` - remove the `"isolated"` tag case.
- `test/ui/agent-config-editor.test.ts` - remove the `isolated` / `extensions: false` eject-emission tests.
- `test/display.test.ts` - remove `extensions`/`skills` from `AgentConfig` fixtures.
- `test/helpers/runner-io.ts` - remove `extensions`/`skills`/`isolated` from `DEFAULT_AGENT_CONFIG`.
- `test/helpers/runner-io.test.ts` - remove the `config.extensions`/`config.skills` assertions and the `extensions: true` override case.
- `test/helpers/ui-stubs.ts` - remove `extensions: true` / `skills: true` from the stub `AgentConfig`.

### Docs

- `docs/architecture/architecture.md` - remove the `SafeFs` and `SkillLoader` nodes from the session-domain Mermaid subgraph; remove `safe-fs.ts` and `skill-loader.ts` from the directory-tree listing; drop `isolated` from the `SpawnOptions` field list (≈ line 418) and the `RunOptions` field list (≈ line 651); mark Phase 16 Step 4 (#264) done in the roadmap and update the "Children always load the parent's extensions and skills" note; reflect the smaller session domain (8 → 6 modules).
- `.pi/skills/package-pi-subagents/SKILL.md` - update the Session domain row (module count 8 → 6, drop `safe-fs.ts` / `skill-loader.ts` from the file list).

## Test Impact Analysis

1. New coverage enabled - minimal (this is a removal).
   The one behavioral assertion worth strengthening: the post-bind recursion guard now runs **unconditionally**.
   Update `agent-runner-extension-tools.test.ts` so a case that previously relied on `extensions: true` instead asserts the guard always calls `setActiveToolsByName` and always excludes `EXCLUDED_TOOL_NAMES`, with no config dependence.
2. Tests that become redundant and are removed - `skill-loader.test.ts` and `safe-fs.test.ts` (modules deleted); the `isolated`-mode `describe` in `session-config.test.ts`; the "extensions: false skips the filter entirely" case; `isolated` parameter tests in `spawn-config.test.ts` / `invocation-config.test.ts`; `extensions` / `skills` frontmatter-parsing tests in `custom-agents.test.ts`.
3. Tests that must stay (genuinely exercise surviving layers) - prompt assembly (`prompts.test.ts`, minus `extras`); model resolution in `session-config.test.ts`; the post-bind guard ordering tests (adjusted, not removed); custom-agent `tools:` parsing (`csvList` survives).

## TDD Order

Each cycle ends green (`pnpm run check` + `pnpm -r run test`).
Because removing a field from `AgentConfig` / `AgentInvocation` breaks every reader and every object-literal construction site at once (TS excess-property + property-access), each cycle folds its test updates into the same commit (per the testing skill's removal rule).
The three axes are split so each commit stays reviewable and leaves the repo compiling.

1. Remove the `isolated` axis end-to-end.
   Surface: `types.ts` (`AgentConfig.isolated`, `AgentInvocation.isolated`), `invocation-config.ts`, `custom-agents.ts` (parse only), `session-config.ts` (`AssemblerOptions.isolated` + derivation), `agent-runner.ts` (`RunOptions.isolated`), `agent.ts`, `agent-manager.ts`, `tools/*`, `service*.ts`, `ui/*` (isolated bits), plus all listed tests.
   After: `extensions`/`skills`/`noSkills` still function; the assembler reads `agentConfig.extensions`/`agentConfig.skills` directly.
   Commit: `feat!: remove isolated from the subagent spawn API and lifecycle (#264)`.
2. Remove the `extensions` axis; make the recursion guard unconditional.
   Surface: `types.ts` (`AgentConfig.extensions`), `default-agents.ts`, `agent-types.ts` (fallback), `custom-agents.ts` (parse + delete `resolveBoolExtensions`), `session-config.ts` (`SessionConfig.extensions`), `agent-runner.ts` (`ResourceLoaderOptions.noExtensions`, drop `noExtensions` arg, unconditional guard), `ui/agent-config-editor.ts` + `ui/agent-creation-wizard.ts` (extensions bits), plus tests (including the guard-always-runs update and deleting the "skips filter" case).
   Commit: `feat!: always inherit extensions; make the recursion guard unconditional (#264)`.
3. Remove the `skills` axis, `noSkills`, and the skill-preload path.
   Surface: `types.ts` (`AgentConfig.skills`), `default-agents.ts`, `agent-types.ts` (fallback), `custom-agents.ts` (parse + delete `inheritField`), `session-config.ts` (`AssemblerIO.preloadSkills`, `SessionConfig.noSkills`/`extras`, preload block, `buildAgentPrompt` call), `prompts.ts` (`PromptExtras`/`extras`/`extrasSuffix`), delete `skill-loader.ts` + `safe-fs.ts`, `agent-runner.ts` (`ResourceLoaderOptions.noSkills`, drop arg), `index.ts` (wiring), `ui/*` (skills bits), plus tests (delete `skill-loader.test.ts` + `safe-fs.test.ts`).
   Commit: `feat!: always inherit skills; remove noSkills and the skill-preload path (#264)`.
4. Update the architecture doc and package skill.
   Surface: `docs/architecture/architecture.md` (Mermaid session subgraph, directory tree, `SpawnOptions`/`RunOptions` field lists, roadmap status), `.pi/skills/package-pi-subagents/SKILL.md` (session domain row).
   Commit: `docs: record removal of the extension-lifecycle-control axis (#264)`.

## Risks and Mitigations

- Risk: `resolveBoolExtensions` / `inheritField` deletion removes a helper still used elsewhere.
  Mitigation: greps confirm `resolveBoolExtensions` is used only by the removed `extensions` parse, and `inheritField` only by `extensions`/`skills`; `csvList`/`parseCsvField` (used by `tools:`) stay.
- Risk: deleting `safe-fs.ts` orphans an import.
  Mitigation: grep confirms `skill-loader.ts` is its sole consumer; `safe-fs.test.ts` is deleted in the same cycle.
- Risk: removing `SpawnOptions.isolated` breaks a published consumer of the service.
  Mitigation: this is an intentional breaking change ([ADR-0002]); `feat!:` triggers a major bump via release-please.
  The public type surface is verified by `pnpm run verify:public-types` after Step 3.
- Risk: skill behavior silently changes for agents that relied on `skills: string[]` curation.
  Mitigation: documented in Goals as breaking; children now inherit the full skill system, which is strictly more capable, and deny-at-use governs what they may act on.
- Risk: a test file is touched in multiple cycles (e.g. `runner-io.ts`).
  Mitigation: each cycle removes only the field it owns; ordering is fixed (isolated → extensions → skills) so no cycle leaves a dangling reference.

## Open Questions

- Should custom-agent `.md` files with now-defunct `extensions:` / `skills:` / `isolated:` frontmatter emit a one-time deprecation warning, or be silently ignored?
  Deferred: silent-ignore matches the Phase 14 precedent for the removed `disallowed_tools` field; revisit only if users report confusion.
- Does `verify:public-types` need a new negative assertion that `isolated` is absent from `SpawnOptions`?
  Deferred to Step 3 implementation - the existing consumer type-check will fail if a stale field lingers.

[ADR-0002]: ../decisions/0002-extensions-on-a-minimal-core.md
