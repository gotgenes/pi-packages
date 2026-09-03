---
name: package-pi-subagents
description: |
  Package-specific context for @gotgenes/pi-subagents.
  Load when working on code, tests, or docs in packages/pi-subagents/.
---

# pi-subagents

Pi extension that adds a focused, in-process autonomous subagent core to the Pi coding agent.

This package is a **hard fork** of [`tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents).
The fork diverges intentionally from upstream with material scope reduction and a typed API boundary.
See `docs/architecture/architecture.md` for the full decomposition plan and `docs/decisions/0001-deferred-patches.md` (superseded) for the original thin-patch rationale.

The fork carries two original patches from the thin-patch era, still present in the codebase:

1. **Peer-dep rename** - peer dependencies point at `@earendil-works/pi-*` (the active scope) rather than the deprecated `@mariozechner/pi-*` scope.
2. **Patch 3 (active_agent tag)** - `buildAgentPrompt` includes `<active_agent name="${agentConfig.name}"/>` in every assembled child system prompt (both `replace` and `append` modes); the tag follows the cacheable parent-prompt prefix so `@gotgenes/pi-permission-system` can resolve per-agent `permission:` frontmatter inside the child.

Note: Patch 2 (post-bind active-tool re-filter) was simplified in Phase 14 (#239) and retired in #725.
The filter dance is gone: `EXCLUDED_TOOL_NAMES` reaches the SDK as the `excludeTools` denylist at session creation, which it reapplies on every tool-registry rebuild.

A child's **capability** tool set is exactly its agent's `tools:` frontmatter list.
Pi treats the `tools` option to `createAgentSession` as an allowlist and applies it *before* building the session's tool registry, so an extension that calls `registerTool` inside a child succeeds and is then filtered out unless the agent names that tool.
Extension tool names are therefore supported `tools:` entries — that is the documented way to give a child an extension's tool, and `docs/configuration.md` is where the contract lives.

The core installs two child-facing tools of its own on top of that list, in every child regardless of what the agent declares: `ask_parent` (records the child's question, then it ends its turn) and `notify_parent` (one-way mid-run update; background children only, gated on the `midRunUpdates` setting).
The boundary the `tools:` allowlist draws is **capability**, not provenance — neither tool reaches the filesystem, the shell, or the network, so a read-only agent that gains them stays read-only, and #612's and #768's refusals still hold.
They are appended to the allowlist at `createSubagentSession` and passed as SDK `customTools`; both halves are needed, because Pi filters `customTools` through the allowlist and drops an unlisted one with no error.
This replaced the `<question-for-parent>` text marker and its 222-line fence-aware parser (#858) — do not reintroduce a marker protocol.

Upstream PRs for these patches ([#71](https://github.com/tintinweb/pi-subagents/pull/71), [#72](https://github.com/tintinweb/pi-subagents/pull/72), [#73](https://github.com/tintinweb/pi-subagents/pull/73)) are open but the fork continues independently regardless.

`buildAgentPrompt` embeds only the **identity** region of the inherited parent prompt, per `docs/decisions/0006-inherited-prompt-is-identity-only.md`.
Pi's `buildSystemPrompt` ends every prompt with layers it resolves per session — the `<available_skills>` catalogue, then a `Current working directory:` footer — and extensions append further blocks after those from `before_agent_start`, rebuilt from the base prompt every turn.
The child's own session rebuilds all of them, so `inheritedIdentity` cuts the inherited prompt at the first such layer and keeps what precedes it (Refs #640, #801).
The catalogue is identified by position rather than document order: `buildSystemPrompt` writes the cwd footer immediately after it, unconditionally, so Pi's own catalogue is the one whose `</available_skills>` sits on the line before the footer — which keeps a catalogue quoted in a project-context file or in an appended block from being taken for the section, in either direction.
The heading is then found by searching back from that tag; the footer is the cut when the parent resolved no skills, and both anchors match whole lines.
Do not re-add the equal-cwd exception #640 originally carried: the catalogue precedes the footer, so once the catalogue is cut the footer is already past the divergence point and the exception preserves no shared prefix.

## Architecture

See `docs/architecture/architecture.md` for the full architecture document with Mermaid diagrams, domain model, structural analysis, and improvement roadmap.
Refactoring history is preserved in `docs/architecture/history/` (one file per completed phase).

### Domain organization

The extension is organized into seven domains (66 files):

| Domain      | Directory                                                                                                                                                                                                                                                                                           | Modules | Responsibility                                                                                                                                                                                                                                                                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config      | `agent-types.ts`, `default-agents.ts`, `custom-agents.ts`, `invocation-config.ts`, `thinking-level.ts`                                                                                                                                                                                              | 5       | Agent type registry, built-in/custom configs, per-call merge (caller wins unless the agent file declares `locked:`), thinking-level vocabulary                                                                                                                                                                                                                                         |
| Session     | `session-config.ts`, `prompts.ts`, `context.ts`, `conversation.ts`, `content-items.ts`, `env.ts`, `model-resolver.ts`, `package-exclusions.ts`, `provider-inheritance.ts`, `session-dir.ts`, `ask-parent-tool.ts`, `notify-parent-tool.ts`                                                          | 12      | Pure session assembly: prompts, context, conversation rendering, environment, model resolution, child package-extension exclusion, parent provider replay, the core's child-facing tools                                                                                                                                                                                               |
| Lifecycle   | `subagent-manager.ts`, `create-subagent-session.ts`, `subagent-session.ts`, `turn-limits.ts`, `subagent.ts`, `subagent-state.ts`, `run-listeners.ts`, `workspace-bracket.ts`, `concurrency-limiter.ts`, `parent-snapshot.ts`, `child-lifecycle.ts`, `child-shutdown.ts`, `workspace.ts`, `usage.ts` | 14      | Spawn, abort, resume, concurrency admission, session assembly factory, born-complete turn loop, status state machine, lifecycle-state value object, per-subagent behavior, per-run listener handles, workspace prepare/dispose lifecycle, child-lifecycle events, child extension shutdown on disposal, workspace provider seam                                                        |
| Observation | `record-observer.ts`, `notification.ts`, `renderer.ts`, `subagent-events-observer.ts`, `composite-subagent-observer.ts`, `outcome-delivery.ts`                                                                                                                                                      | 6       | Session-event stats, announce-only completion nudges (withheld during the parent's agent run and flushed on `agent_settled`, and silenced permanently once the manager is disposed; gated on the revocable carrier claim, with consumption remaining the one-way latch the sweep times session release from), notification rendering, lifecycle-event emission, multi-observer fan-out |
| Tools       | `tools/`                                                                                                                                                                                                                                                                                            | 9       | LLM-facing tools: Agent, get_subagent_result, steer_subagent, spawn-config, result-renderer, get-result-report, helpers                                                                                                                                                                                                                                                                |
| UI          | `ui/`                                                                                                                                                                                                                                                                                               | 8       | Widget, display helpers, glyph vocabulary, session navigation, transcript content (per-message component blocks with width-cached rows), settings command                                                                                                                                                                                                                              |
| Service     | `service.ts`, `service-adapter.ts`                                                                                                                                                                                                                                                                  | 2       | Cross-extension API boundary via Symbol.for()                                                                                                                                                                                                                                                                                                                                          |

Entry point (`index.ts`), runtime (`runtime.ts`), shared types (`types.ts`), settings (`settings.ts`), debug (`debug.ts`), and event handlers (`handlers/`) sit at the root.

### Module dependency flow

```text
tools/ → SubagentManager → Subagent → createSubagentSession → session-config → [prompts, memory, skills, env]
                                           ↓                                    ↑
                                     SubagentSession            AgentTypeRegistry → [default-agents, custom-agents]

record-observer ─subscribes─→ AgentSession
SubagentManager ─notifies→ CompositeSubagentObserver ─fans out→ [subagent-events-observer, widget]
widget ─polls─→ Subagent records (listAgents)
service-adapter ─wraps─→ SubagentManager
```

## Implementation Priorities

- Follow the phased plan in `docs/architecture/architecture.md`.
- **Open for extension, closed for modification** - pi-subagents is a minimal core that publishes events and a service API.
  Other packages hook into these to add permissions, rendering, or telemetry.
  Pi-subagents has zero knowledge of its consumers - dependency arrows point inward, never outward.
- Narrow core - the extension owns agent spawning, execution, and result retrieval; everything else is a consumer.
- **No policy enforcement** - tool restrictions, skill access control, and extension filtering belong in `@gotgenes/pi-permission-system`, not in this package.
  The `disallowed_tools` frontmatter field and `extensions: string[]` allowlist were removed in Phase 14 (#237, #238, #239).
  Users should use `permission:` frontmatter for tool restrictions.
  The one carve-out is **prevent-load**, which cannot be reduced to observation: the global/project `excludedExtensionPackages` setting keeps named packages' extensions out of children (#696).
  It is package-scoped and settings-scoped only — never per agent type, and never tool permissions.
  The policy is resolved in `index.ts` and reaches `createSubagentSession` as a ready-made settings view, so the assembly factory stays policy-free; keep it that way.
  Excluding a permission extension is an optimization, never a correctness requirement, with one hazard: a tool and its path extractor supplied by *different* packages, with only the extractor's package excluded, leaves that tool ungated in the child (#793).
  `docs/configuration.md` carries the operator-facing condition; the rule itself lives in pi-permission-system's `docs/subagent-integration.md` § Loading asymmetry, which is also the canonical spec for the child-announcement contract ADR 0002 requires.
- Typed API boundary - export `SubagentsService` via `Symbol.for()` accessors so other extensions can spawn agents without importing this package directly (done, #48).
- Remove scheduling subsystem (done); ad-hoc RPC and group-join (done); output-file porting to Pi session format tracked in #61.
- Cherry-pick upstream fixes when they align with this fork's scope; do not track upstream as a merge target.

### Architectural direction

The target architecture is documented in `docs/architecture/architecture.md` under "Architecture direction."
The key phases are:

- **Phase 14** - Strip policy from core: remove `disallowed_tools`, `extensions` filtering, collapse `filterActiveTools` (#237, #238, #239). ✅ Complete
- **Phase 15** - Domain model evolution: `AgentRecord` → `Agent` with behavior, async `startAgent`, observer pattern, `ConcurrencyQueue` (#227-#232).
- **Phase 16** - Invert dependencies (extensions on a minimal core, [ADR-0002]): emit child-session lifecycle events and retire `permission-bridge.ts` (#261); add the `WorkspaceProvider` seam (#262); extract worktrees to `@gotgenes/pi-subagents-worktrees` (#263, supersedes #256); remove `isolated`/`extensions: false`/`noSkills` (#264, later partly readmitted as the settings-scoped `excludedExtensionPackages` prevent-load key, #696); born-complete child execution, dissolve the runner (#265).
  The earlier "agent collaborator architecture" framing was abandoned.
- **Phase 17** - Core consolidation: resolve the `Subagent` record/executor duality (extract `SubagentState`, make execution deps mandatory), replace the concurrency queue with a thunk limiter, extract the manager observer from `index.ts`, consolidate test fixtures (#373-#381).
- **Phase 18** - Reconsider the UI (first principles): the inherited widget, conversation viewer, and `/agents` menu are consumers judged on our principles, not preserved by default.

## Display glyphs

Every semantic display glyph (status icons, turn/compaction indicators, spinner frames, sub-line prefixes) lives in `src/ui/glyphs.ts` — never spelled at a render site.
Before changing or adding one, measure its monospace coverage with the `fc-list` command in that module's doc comment.
Pi's TUI sizes every cell with `get-east-asian-width`, so a glyph that no monospace font covers is drawn by a proportional fallback that overruns its cell and collides with the next column (Refs #669).
East Asian Width does not detect this — the glyph #669 replaced and its replacement are both width 1.
Box-drawing characters are deliberately excluded: they are layout, not vocabulary.

## Code Style

Formatting is handled by Biome (`biome check`, `biome format`).
The repo intentionally does not use Prettier - a top-level `.prettierignore` blocks any harness with project-level write-time Prettier formatting from reformatting files here.

## Public exports

This package publishes two public subpath entries, each with a rolled self-contained `.d.ts`:

| Subpath      | Source                    | Declaration          | Purpose                                                            |
| ------------ | ------------------------- | -------------------- | ------------------------------------------------------------------ |
| `.`          | `src/service/service.ts`  | `dist/public.d.ts`   | Cross-extension service contract: spawn/abort/steer/workspace seam |
| `./settings` | `src/layered-settings.ts` | `dist/settings.d.ts` | Generic layered JSON config loader for `@gotgenes/pi-*` extensions |

Use `loadLayeredSettings<T>({ agentDir, cwd, filename, sanitize, warnLabel })` from `@gotgenes/pi-subagents/settings` to read global + project JSON config with the standard `@gotgenes/pi-*` layering convention.
See the `## For Extension Authors` section of `README.md` for the full wiring example.

What `SubagentRecord` may carry is settled by `docs/decisions/0005-subagent-record-admission-policy.md`, not by a per-field vote: the snapshot admits identity, resolved spawn facts, cumulative metrics, and durable-artifact pointers, and withholds live objects, momentary activity (`activeTools`, `responseText`), package-internal bookkeeping, and display snapshots.
It is produced by this package and read by consumers — never implemented by them — so adding a field is semver-minor while removing or retyping one is semver-major, and the snapshot is by value (copy anything the agent keeps mutating).

## Build

This package is otherwise ship-source (Pi runs `./src/index.ts` directly), but it carries the repo's only build step: type-declaration bundles for both public entries ([ADR-0003]).
`pnpm run build:types` runs `rollup -c rollup.dts.config.mjs` (`rollup-plugin-dts`) to produce `dist/public.d.ts` (service entry) and `dist/settings.d.ts` (settings entry) - internal `#src/*` types inlined, peer-dep types kept external.
The bundles are gitignored, regenerated at `prepack`, and shipped via the `package.json` `files` allowlist.
Never commit `dist/`.
`pnpm run verify:public-types` (`scripts/verify-public-types.sh`, also a CI step) packs the tarball and type-checks a throwaway consumer against both entries - run it after any change to the public surface, the `exports` map, or the rollup config.
Sibling packages consume this one from the **published** registry release (the repo sets `linkWorkspacePackages: false`), not via a workspace symlink - a symlink resolves `exports.types` to the gitignored, unbuilt `dist/*.d.ts`.
See `@gotgenes/pi-subagents-worktrees` for the pattern.

## Testing

The package has an extensive `vitest` suite.
All tests must pass before publishing.
Use `vi.hoisted(...)` for module-level mocks, matching the existing patterns in `test/lifecycle/subagent-session.test.ts`.
Tests that mount Pi's per-entry interactive components (`UserMessageComponent`, `ToolExecutionComponent`, etc., used by `session-navigator.ts`) must call `initTheme(undefined, false)` in `beforeAll` — they read a global theme Pi initializes at startup.
The dependency is component-specific: `AssistantMessageComponent` alone does not trip it, so a one-variant probe gives false confidence.

## Notes for Agents

When working in this package:

1. New features and removals follow the phase plan in `docs/architecture/architecture.md`.
   Document architectural decisions in `docs/decisions/`.
2. The upstream test suite is run periodically as a regression canary for the session assembly core.
3. Modules marked `← removing` or `← replacing` in the architecture doc's current-state listing are slated for deletion - do not add features to them.

[ADR-0002]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/docs/decisions/0002-extensions-on-a-minimal-core.md
[ADR-0003]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/docs/decisions/0003-publish-bundled-type-declarations.md
