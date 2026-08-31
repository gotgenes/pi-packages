# Comparison with upstream

`@gotgenes/pi-subagents` began as a fork of [`tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents) by [@tintinweb](https://github.com/tintinweb).
The original design — autonomous subagent dispatch, the live widget, the conversation viewer, custom agent types — is the foundation everything here builds on.

It has since become an independently maintained hard fork.
It follows its own architecture, does not track upstream as a merge target, and cherry-picks upstream fixes only when they fit its scope.
This document compares the fork against the current upstream release so you can choose between them.

Versions compared: `@gotgenes/pi-subagents` 16.2.1 and `@tintinweb/pi-subagents` 0.10.3 (current at the time of writing).

## At a glance

| Aspect          | @gotgenes/pi-subagents          | @tintinweb/pi-subagents                 |
| --------------- | ------------------------------- | --------------------------------------- |
| Philosophy      | Minimal, composable core        | Batteries-included, all-in-one          |
| Pi peer scope   | `@earendil-works/pi-*` (>=0.75) | `@earendil-works/pi-*` (>=0.74)         |
| Spawn tool name | `subagent`                      | `Agent`                                 |
| Runtime deps    | `@sinclair/typebox`             | `@sinclair/typebox`, `croner`, `nanoid` |
| License         | MIT                             | MIT                                     |

Both ship TypeScript source directly (Pi runs `./src/index.ts`) and target the same `@earendil-works/pi-*` Pi.
The peer-dep migration that prompted the original fork has since landed upstream, so the Pi scope is no longer a differentiator.

## Common ground

Both extensions provide the same core experience:

- Foreground/background subagents with a live above-editor widget and a conversation viewer.
- Custom agent types defined in `.pi/agents/<name>.md` with YAML frontmatter (system prompt, model, thinking, tools).
- Fuzzy model selection, context inheritance, mid-run steering, session resume, and graceful turn limits.
- A `pi.events` lifecycle bus (`subagents:created`, `started`, `completed`, `failed`, `steered`, `compacted`).

## What upstream has that this fork does not

Upstream is the batteries-included option.
It keeps several subsystems built in that this fork deliberately removed or delegated:

| Capability              | @tintinweb/pi-subagents                           | @gotgenes/pi-subagents                                                                                                                            |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool restrictions       | `disallowed_tools` frontmatter (denylist)         | Delegated — `permission:` via [`@gotgenes/pi-permission-system`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system) |
| Worktree isolation      | Built-in                                          | Delegated — [`@gotgenes/pi-subagents-worktrees`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-subagents-worktrees)               |
| Persistent agent memory | `memory:` frontmatter (project / local / user)    | Removed                                                                                                                                           |
| Skill preloading        | `skills:` frontmatter (preload named skills)      | Removed — children always inherit the parent's skills                                                                                             |
| Scheduling              | Cron / interval / one-shot subagents (`schedule`) | Removed                                                                                                                                           |
| Cross-extension control | `subagents:rpc:*` event RPC                       | Replaced by a typed service (below)                                                                                                               |
| Model-scope enforcement | `enabledModels` allowlist validation              | Not included                                                                                                                                      |
| Notifications           | Smart group-join consolidation                    | Individual per-agent notifications                                                                                                                |

## What this fork adds

This fork is a minimal core that other extensions build on, plus a small companion ecosystem:

- **Typed service API** — `SubagentsService` exposed via `Symbol.for()` accessors, so another extension can spawn and manage subagents without importing this package or relying on ad-hoc event RPC.
- **Child-session lifecycle events** — `subagents:child:spawning` / `session-created` / `bound` / `completed` / `disposed`, with `session-created` firing synchronously before `bindExtensions()` so consumers can register the child session deterministically, and `bound` firing after it resolves so they can observe what the child's extensions installed.
- **`<active_agent>` system-prompt tag** — lets [`@gotgenes/pi-permission-system`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system) resolve per-agent `permission:` frontmatter (allow / ask / deny — richer than a binary denylist) inside the child session.
- **Companion packages** — permission policy and worktree isolation live in dedicated packages rather than the core.
- **Re-architected codebase** — decomposed into seven domains behind a typed public API boundary, backed by ~994 tests.

## Which should I use?

**Use `@tintinweb/pi-subagents`** if you want a single, batteries-included extension with nothing else to install: built-in tool denylist, scheduled / cron subagents, cross-extension RPC, and model-scope enforcement in one package.
It is the canonical upstream and the original.

**Use `@gotgenes/pi-subagents`** if you want a minimal, composable core: richer allow / ask / deny permissions and worktree isolation through companion packages, a typed service plus lifecycle events to build your own extensions on, and an actively refactored codebase — and you do not need built-in scheduling, RPC, or model-scope enforcement.

The spawn tool is named `subagent` here versus `Agent` upstream, so prompts and docs that hard-code the tool name are not drop-in portable between the two.

## Patches contributed upstream

Three of the fork's early changes were opened as PRs against upstream and remain a record of the shared lineage:

1. Peer-dep migration to `@earendil-works/pi-*` — [tintinweb/pi-subagents#71](https://github.com/tintinweb/pi-subagents/pull/71) (upstream has since migrated).
2. Post-`bindExtensions` active-tool re-filter — [tintinweb/pi-subagents#72](https://github.com/tintinweb/pi-subagents/pull/72).
3. `<active_agent>` system-prompt tag — [tintinweb/pi-subagents#73](https://github.com/tintinweb/pi-subagents/pull/73).

The fork has since diverged well beyond these.
