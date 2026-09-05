---
issue: 871
issue_title: "pi-subagents: an agent declaring tools: none receives all seven built-in tools"
---

# Resolve `tools: none` to no tools

## Release Recommendation

**Release:** ship independently

`architecture.md`'s Phase 22 puts this issue at Step 13, tagged `Release: independent`, and its "Release batches" subsection lists Step 13 among the independently releasable `fix:` steps.
Track E holds Step 13 alone — it corrects the base list Step 11 appends to, but neither step needs the other.
The commit is `fix(pi-subagents):`, an unhidden changelog type, so it cuts a patch on its own from the published 21.4.1.
Nothing is pending for the package at plan time (`./scripts/release/next-version.sh pi-subagents` prints nothing), so this commit is the whole release.

## Problem Statement

An agent whose frontmatter declares `tools: none` runs with all seven built-in tools — `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls` — rather than none.

The frontmatter parser is not the problem.
`custom-agents.ts` resolves `tools: none` to `[]` (`parseListField` returns `undefined` for the single item `none`, and `listField` maps that to `[]`), and `test/config/custom-agents.test.ts` pins it.

The distinction is lost one layer down, in `AgentTypeRegistry.getToolNamesForType`:

```typescript
const names = config?.toolNames?.length ? config.toolNames : [...BUILTIN_TOOL_NAMES];
```

`[].length` is `0`, so a deliberate empty list takes the same branch as an omitted `tools:` key.
A truthiness check cannot distinguish "the author asked for nothing" from "the author asked for nothing in particular".
`assembleSessionConfig` reads that value straight through and it becomes the child session's SDK `tools` allowlist.

It fails open, which is the direction that matters: the tools silently granted include `edit`, `write`, and `bash`.

## Goals

- An agent declaring `tools: none` runs with no capability tools, matching `docs/configuration.md` and the parse-level test that already pins the empty array.
- The omitted-key fallback is unchanged: an agent that declares no `tools:` key still receives all seven built-ins.
- `getToolNamesForType` and `resolveAgentConfig` resolve a type through **one** lookup, so the two cannot disagree about which config a type names.
- The three-valued distinction — absent, empty, listed — is pinned by a test each, and the disabled-agent branch the change also narrows gets its own pin.
- The change is **not breaking** and lands as `fix(pi-subagents):`.
  It restores the behavior `docs/configuration.md:177` already documents (`tools: none # no tools at all`); an agent that "worked" did so on undocumented fail-open behavior, and no agent file in this repo declares `tools: none`.

## Non-Goals

- **Editing `docs/configuration.md`.**
  Its "Tool selection" section already documents the post-fix behavior correctly, including the two names always added on top of the list.
  The code moves to the doc, not the other way round.
- **Freezing or defensive-copying `BUILTIN_TOOL_NAMES`.**
  The constant is handed out by reference in two places (`custom-agents.ts:62` as `listField`'s default, `agent-types.ts:116` in the absolute fallback), which is a latent footgun.
  This change does not activate it: every consumer of `.toolNames` (`session-config.ts:156,178`, `create-subagent-session.ts:256`) reads, spreads, or maps, and none mutates.
  Recorded as a deferred tidying for `/plan-improvements` rather than folded into a `fix:`.
- **Reorganizing the existing `describe("getToolNamesForType")` block.**
  The Tidy-First assessment offered nesting it by concern as Optional and marked it not required; seven flat siblings stay readable and the reorganization would not shrink this change.
- **Validating tool names against `BUILTIN_TOOL_NAMES`.**
  An unknown entry passing through is deliberate — [#725] settled that an extension's tool name is a supported `tools:` entry.
- **Reconsidering the always-added `ask_parent`/`notify_parent` pair.**
  A `tools: none` child still receives them, by [#858]'s design: the allowlist draws a capability boundary, not a provenance one, and neither tool reaches the filesystem, the shell, or the network.

## Background

| Module                                     | Role in the chain                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/config/custom-agents.ts`              | `listField(fm.tools, BUILTIN_TOOL_NAMES)` — omitted key → the seven built-ins; `none`/empty → `[]`; otherwise the listed entries. Correct today. |
| `src/config/agent-types.ts`                | `AgentTypeRegistry.getToolNamesForType` — the defect. Also `resolveAgentConfig`, which resolves the same key with different rules.               |
| `src/session/session-config.ts`            | `assembleSessionConfig` calls `registry.getToolNamesForType(type)` (`:156`) and stores it as `SessionConfig.toolNames` (`:178`). Pass-through.   |
| `src/lifecycle/create-subagent-session.ts` | `tools: [...cfg.toolNames, ...childTools.map((tool) => tool.name)]` (`:256`) — the SDK allowlist, with [#858]'s two child-facing tools appended. |
| `src/lifecycle/subagent-manager.ts`        | `resolveSpawn` (`:293-300`) — the choke point [#724] introduced. Throws for a disabled type; maps an unknown type to `general-purpose`.          |

The trigger is every spawn of such an agent, not a cache invalidation: `getToolNamesForType` is called per spawn from `assembleSessionConfig`, and `AgentTypeRegistry.reload()` re-reads the agent files.

The SDK end honors an empty allowlist.
Read from the compiled source of the pinned `@earendil-works/pi-coding-agent@0.84.4` (`dist/core/sdk.js:141,144`):

```javascript
const allowedToolNames = options.tools ?? (options.noTools === "all" ? [] : undefined);
const initialActiveToolNames = (options.tools ?? (options.noTools ? [] : (configuredDefaultToolNames ?? defaultActiveToolNames))).filter(...);
```

Both are `??`, not a truthiness check, so `[]` reaches the child as "no tools" rather than falling back to the SDK's own defaults.
The fix is not undone one layer further down.

## Design Overview

`getToolNamesForType` today does its own key lookup, its own `enabled` guard, and then the truthiness coalesce:

```typescript
getToolNamesForType(type: string): string[] {
  const key = this.resolveKey(type);
  const raw = key ? this.agents.get(key) : undefined;
  const config = raw?.enabled !== false ? raw : undefined;
  const names = config?.toolNames?.length ? config.toolNames : [...BUILTIN_TOOL_NAMES];
  return names;
}
```

`resolveAgentConfig` resolves the same key with different rules — no `enabled` guard, and an unknown type falls back to `general-purpose`.
The whole body is replaced by one line that delegates to it:

```typescript
getToolNamesForType(type: string): string[] {
  return this.resolveAgentConfig(type).toolNames ?? [...BUILTIN_TOOL_NAMES];
}
```

This drops three things at once: the duplicated `resolveKey`/`agents.get` pair, the `enabled` guard, and the truthiness coalesce.
What remains is the single decision the method exists to make — an absent list means "all built-ins" — expressed with the operator that can see an empty array.

### What changes, input by input

| Input                                     | Today                  | After                                             |
| ----------------------------------------- | ---------------------- | ------------------------------------------------- |
| `toolNames: ["read", "grep"]`             | `["read", "grep"]`     | unchanged                                         |
| `toolNames: []` (`tools: none`)           | all seven — the defect | `[]`                                              |
| `toolNames` absent (`general-purpose`)    | all seven              | unchanged                                         |
| Unknown type                              | all seven              | unchanged, now via the `general-purpose` fallback |
| Disabled agent with `toolNames: ["read"]` | all seven              | `["read"]`                                        |

The last row is the change's second effect and the reason the one-line form is worth more than flipping the operator in place.
The `enabled` guard turned "this agent is disabled" into "give it everything" — a second fail-open of the same shape as the first.
It is unreachable from the spawn path: `SubagentManager.resolveSpawn` throws `Agent type "<name>" is disabled` before assembly, on every front door ([#724]'s choke point), pinned three times in `test/lifecycle/subagent-manager.test.ts` (`:193`, `:204`, `:315`).
Removing it therefore changes no reachable behavior, and if a future door ever bypassed the choke point the method would now fail closed — the disabled agent's own declared list — instead of open.

It also ends a live disagreement: today the same disabled type yields that agent's own prompt and model from `resolveAgentConfig` but everyone's tools from `getToolNamesForType`.
After the change, one lookup answers both.

### Measured, not argued

The issue leaves one question open: "I have not confirmed that no caller depends on the current coalescing."

Spiked at planning time by writing the one-line body into `src/config/agent-types.ts` and running the full package suite, then restoring the file from a backup copy:

| Body                                                                | Suite result                   |
| ------------------------------------------------------------------- | ------------------------------ |
| One-line delegation (the design above)                              | 76 files, 1561 tests, all pass |
| `config?.toolNames ?? [...BUILTIN_TOOL_NAMES]` (operator flip only) | 76 files, 1561 tests, all pass |
| Unchanged (baseline)                                                | 76 files, 1561 tests, all pass |

Nothing depends on the coalescing, and nothing pins the disabled-agent branch either — which is why this plan adds a test for it rather than leaving the narrowing unpinned.

## Module-Level Changes

Greps run before finalizing this list: `getToolNamesForType`, `BUILTIN_TOOL_NAMES`, and `tools: none` across `packages/pi-subagents/src`, `test`, `docs`, `README.md`, and `.pi/skills/`; `toolNames` across `src` and `test`.

Findings that need **no** edit:

- `.pi/skills/package-pi-subagents/SKILL.md:24` — "A child's **capability** tool set is exactly its agent's `tools:` frontmatter list."
  The sentence is aspirational today and simply true after the change; it names none of the symbols involved.
- `README.md:400` — "An agent's `tools:` frontmatter is the only thing that admits a capability tool" — same, prose about the contract, not the resolution.
- `docs/configuration.md:171-180` — documents `tools: none # no tools at all` and the omitted-key fallback.
  Already correct (see Non-Goals).
- `docs/architecture/architecture.md:225` — the class-diagram line `+getToolNamesForType(type): string[]`.
  The signature is unchanged.
- `docs/architecture/architecture.md:339` — the module-tree line `agent-types.ts  AgentTypeRegistry class`.
  Current behavior, unchanged.
- Historical plans and retros under `docs/plans/` and `docs/retro/` that name the symbol are left alone.

### Source

| File                        | Change                                                                                                                                                                                                                                                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config/agent-types.ts` | Replace the body of `getToolNamesForType` (`:94-99`) with `return this.resolveAgentConfig(type).toolNames ?? [...BUILTIN_TOOL_NAMES];`. Update the doc comment: "Get the capability tool names for a type (case-insensitive). An agent that declares no `tools:` key gets the built-ins; one that declares `tools: none` gets nothing." |

No other source file changes.
`resolveKey` keeps three callers (`resolveType`, `isValidType`, `resolveAgentConfig`), so it does not become dead.
`BUILTIN_TOOL_NAMES` keeps its two other references in the same file and its import in `custom-agents.ts`.

### Tests

| File                              | Change                                                                                                                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/config/agent-types.test.ts` | Three new cases in the existing `describe("getToolNamesForType")` block (`:213`). No helper edits: `makeAgentConfig` merges overrides with a spread, not `??`, so `{ toolNames: undefined }` sets the key to `undefined` rather than falling back to the default `["read", "grep"]`. |

The four existing cases in that block stay: `general-purpose` (absent, via `DEFAULT_AGENTS`), `Explore` (listed, via `DEFAULT_AGENTS`), `auditor` (listed, via a user agent), and an unknown type.

### Docs

| File                                | Change                                                                                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/architecture/architecture.md` | Step 13's heading (`:1108`) gains `✅`; the step-dependency Mermaid node `S13` (`:1168`) gains `✅`; a `Landed:` note goes after the step's bullet list and before its `Release: independent` line. |

## Test Impact Analysis

**New tests this enables.**
The registry level is where the three-valued distinction lives, and it had no empty-list case at all — which is exactly why the parse-level test (`custom-agents.test.ts`, "handles `tools: none` → empty array") and the resolution-level behavior could disagree without the suite noticing.
Three cases close it:

1. `tools: none` → `[]` — the defect.
2. No `tools:` key → `BUILTIN_TOOL_NAMES` — the guard against over-narrowing.
3. A disabled agent → its own declared list — the guard-removal pin.

**Tests that become redundant.**
None.
The "listed" leg is already pinned by "returns custom tool names for user agent"; this plan does not add a fourth test duplicating it.

**Tests that must stay as-is.**
`test/lifecycle/create-subagent-session.test.ts`'s "appends over an agent that declared no tools at all" (`:367-378`) drives `createAgentLookup({ toolNames: [] })` and asserts the SDK receives `tools: ["ask_parent"]`.
It **mocks** `AgentConfigLookup`, so it pins the append half of the contract and nothing about resolution — before this change, the shape it hand-mocks was one the real registry could never produce.
After it, the mock and the registry agree, and the two halves of the path are pinned at their own layers.

## Invariants at risk

| Prior step       | Documented outcome                                                                                               | Pin                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 11 ([#858]) | `ask_parent` and `notify_parent` reach every child whatever its agent declares, appended over the resolved list. | `test/lifecycle/create-subagent-session.test.ts:367-378` ("appends over an agent that declared no tools at all") — opened and read; it mocks the lookup, so it pins the append and not the resolution.                                                                                                              |
| Step 1 ([#724])  | Every front door passes through `resolveSpawn`, which rejects a disabled type.                                   | `test/lifecycle/subagent-manager.test.ts:193,204,315` — three `toThrow('Agent type "Plan" is disabled')` assertions across `spawn`, `spawnAndWait`, and the async door. This is the invariant that makes the removed `enabled` guard unreachable; if it ever regressed, the new body fails closed rather than open. |

Neither is quantitative, and neither is weakened: the change narrows what a child can receive and widens nothing.

## TDD Order

### Step 1 — `fix:` resolve `tools: none` to no tools

Red — add three cases to `describe("getToolNamesForType")` in `test/config/agent-types.test.ts`:

1. "returns an empty list for an agent that declared `tools: none`" — a user agent `makeAgentConfig({ name: "silent", toolNames: [] })`; expect `[]`.
   Fails today with the seven built-ins.
2. "returns the built-ins for a user agent that declared no tools key" — `makeAgentConfig({ name: "unrestricted", toolNames: undefined })`; expect `BUILTIN_TOOL_NAMES`.
   **Passes at Red.**
   This is an invariant pin, not a broken probe: it guards the fix against over-narrowing, and its killing mutation below confirms it discriminates.
   Mutate it explicitly before committing, since it never had a genuine red step.
3. "returns a disabled agent's own list rather than the built-ins" — `makeAgentConfig({ name: "retired", toolNames: ["read"], enabled: false })`; expect `["read"]`.
   Fails today with the seven built-ins.

Green — replace the body of `getToolNamesForType` with `return this.resolveAgentConfig(type).toolNames ?? [...BUILTIN_TOOL_NAMES];` and update its doc comment.

Killing mutations, one per equivalence class:

- Restore the truthiness check (`return this.resolveAgentConfig(type).toolNames?.length ? this.resolveAgentConfig(type).toolNames : [...BUILTIN_TOOL_NAMES];`) — must turn case 1 red and leave cases 2 and 3 green.
  This is the mutation that matters: it is the defect itself.
- Make `getToolNamesForType` return `this.resolveAgentConfig(type).toolNames ?? []` — must turn case 2 red and leave cases 1 and 3 green.
  This is case 2's discriminating signal; a green here would mean the pin cannot see over-narrowing.
- Re-add the `enabled` guard (`return this.agents.get(type)?.enabled === false ? [...BUILTIN_TOOL_NAMES] : …`) — must turn case 3 red and leave cases 1 and 2 green.

Verify: `pnpm --filter @gotgenes/pi-subagents run check`, the full package suite (expect 1561 + 3 passing, no pre-existing failure), `pnpm run lint`, and `pnpm fallow dead-code --workspace @gotgenes/pi-subagents` (expect 0 findings — `resolveKey` keeps three callers).

Commit:

```text
fix(pi-subagents): resolve tools: none to no tools

Refs #871
```

### Step 2 — `docs:` mark Phase 22 Step 13 landed

Update `docs/architecture/architecture.md`:

1. Step 13's heading gains `✅`.
2. The step-dependency Mermaid node `S13` gains `✅`.
3. A `Landed:` note after the step's bullet list records that the fix removed two coalescing points rather than one — the truthiness check and the `enabled` guard — by delegating to `resolveAgentConfig`, so the registry resolves a type through a single lookup.

The module-tree entry for `agent-types.ts` is not touched: it describes current behavior and the class's responsibility is unchanged, and per the architecture-doc convention no issue ref belongs there — nothing here is a lint-guarded or ADR-string boundary.

Verify: `pnpm exec rumdl check packages/pi-subagents/docs/architecture/architecture.md`, and render the edited Mermaid block per the `mermaid` skill.

Commit: `docs(pi-subagents): mark Phase 22 Step 13 landed`

## Risks and Mitigations

| Risk                                                                                  | Mitigation                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An existing agent file declaring `tools: none` silently loses its tools on upgrade.   | Real but accepted, and the reason it is `fix:` rather than `fix!:`: the doc has always said `tools: none` means no tools, so the agent was running on a fail-open bug. No agent file in this repo (`.pi/agents/`, `packages/*/.pi/agents/`) declares it — verified by grep. The `fix:` changelog line names the behavior. |
| The empty list is coalesced away again one layer down, inside the SDK.                | Refuted by reading the pinned SDK's compiled `dist/core/sdk.js:141,144`, which uses `??` on `options.tools`. Not inferred from the `.d.ts`, which shows only `tools?: string[]`.                                                                                                                                          |
| Removing the `enabled` guard exposes a live path where a disabled agent is assembled. | It would fail **closed** (the agent's own list), not open, so the removal cannot make any path worse than today. The choke point that makes it unreachable is pinned three times; case 3 pins the new answer directly.                                                                                                    |
| The three new tests pass for the wrong reason.                                        | Each has a named killing mutation above, one per equivalence class, and case 2 — the one that passes at Red — is called out for explicit mutation before commit.                                                                                                                                                          |
| A helper change is needed and cascades into unrelated tests.                          | None is: `makeAgentConfig` spreads its overrides, so `{ toolNames: undefined }` and `{ toolNames: [] }` both work as written, and `enabled: false` is already used by the `isValidType` block. Confirmed by the Tidy-First assessment against the real file.                                                              |

## Open Questions

None.
The Tidy-First assessment returned no Recommended preparatory commits, and its one Optional item (nesting the `describe` block by concern) and one Rejected item (freezing `BUILTIN_TOOL_NAMES`) are both recorded in Non-Goals and the planning stage note.

[#724]: https://github.com/gotgenes/pi-packages/issues/724
[#725]: https://github.com/gotgenes/pi-packages/issues/725
[#858]: https://github.com/gotgenes/pi-packages/issues/858
