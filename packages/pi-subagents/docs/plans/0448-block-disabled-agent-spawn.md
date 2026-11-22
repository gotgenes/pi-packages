---
issue: 448
issue_title: "`enabled: false` does not prevent explicitly spawning disabled agents"
---

# Honor `enabled: false` in the spawn path and tool-description list

## Release Recommendation

**Release:** ship independently

This is a standalone bug fix.
It is not referenced by any step in `packages/pi-subagents/docs/architecture/architecture.md`, so it carries no `Release:` batch tag and should ship on its own.

## Problem Statement

In `@gotgenes/pi-subagents`, setting `enabled: false` on a custom agent override (e.g. `.pi/agents/Plan.md`) hides the agent from `getAvailableTypes()` — so it disappears from the `subagent_type` available-types list — but does **not** prevent it from being spawned when named explicitly via `subagent_type: "Plan"`.

This contradicts both the README ("disabled per-project with `enabled: false`") and the inline registry comment in `agent-types.ts` ("Disabled agents are kept but excluded from spawning").

The root cause is that the spawn resolution path (`resolveSpawnConfig`) calls `registry.resolveType()`, which delegates to `resolveKey()` and only checks key existence, never `enabled`.
The registry already has an `isValidType()` method that checks `enabled`, but it is not used in the spawn path.

A secondary inconsistency: `buildTypeListText()` (the subagent tool description) lists agents via `getDefaultAgentNames()` / `getUserAgentNames()`, which filter by `isDefault` only, not `enabled`.
So a disabled agent still appears in the "Default agents" / "Custom agents" sections of the tool description, even though it is correctly excluded from the `subagent_type` parameter's available-types line.

## Goals

- A disabled agent named explicitly via `subagent_type` is **not** spawned.
  Instead, the spawn returns an explicit error: `Agent type "<Name>" is disabled` (operator-confirmed behavior over the fallback alternative).
- The error uses the registry's canonical key for the name, so case-insensitive input (`plan` → `Plan`) reports the canonical casing.
- Disabled agents no longer appear in the "Default agents" / "Custom agents" sections of the subagent tool description, making the tool description consistent with the `subagent_type` available-types line.
- Genuinely unknown types continue to fall back to `general-purpose` (unchanged).
- Enabled types continue to resolve and spawn exactly as before (unchanged).

This is a **behavior change** but **not a breaking change**: explicit spawning of a disabled agent was buggy, undocumented behavior that contradicted the documented contract.
The fix makes the code match what the README and registry comment already promise.
Commit messages use `fix:`.

## Non-Goals

- No change to the lenient unknown-type fallback (`fellBack` → `general-purpose`).
  Disabled is distinct from unknown: a disabled type is a known agent that the operator deliberately turned off, so an explicit error is more informative than a silent fallback.
- No change to `resolveAgentConfig()`'s handling of disabled configs.
  The UI (`display.ts`, `agent-menu.ts`, `agent-config-editor.ts`) deliberately resolves disabled configs to display, edit, and re-enable them; that behavior must be preserved.
- No change to the `/agents` menu, which lists disabled agents (marked `✕`) via `getAllTypes()` — intentional and unaffected.
- No README rewrite: the README already states that `enabled: false` disables an agent for spawning, so it is now accurate.
  (An optional one-line note documenting the error message is in Open Questions.)

## Background

Relevant modules:

- `src/config/agent-types.ts` — `AgentTypeRegistry`.
  - `resolveType(name)` → `resolveKey(name)`: returns the canonical key for any existing agent, **ignoring `enabled`**.
  - `isValidType(type)`: resolves the key and returns `false` when the config has `enabled === false` (or the key is unknown).
    Already exists, already tested, **not used in the spawn path**.
  - `resolveAgentConfig(type)`: returns the config for an existing key (including disabled) or falls back to `general-purpose`.
    Used by both the spawn path and the UI.
  - `getDefaultAgentNames()` / `getUserAgentNames()`: filter by `isDefault`, not `enabled`.
    Sole consumer is `buildTypeListText` (verified by grep across `src/` and `test/`).

- `src/tools/spawn-config.ts` — `resolveSpawnConfig(params, registry, modelInfo, settings)`.
  Pure function returning `ResolvedSpawnConfig | SpawnConfigError`.
  Lines 80-83 resolve the type:

  ```typescript
  const rawType = params.subagent_type as SubagentType;
  const resolved = registry.resolveType(rawType);
  const subagentType = resolved ?? "general-purpose";
  const fellBack = resolved === undefined;
  ```

- `src/tools/helpers.ts` — `buildTypeListText(registry, agentDir)` and the `TypeListRegistry` interface (extends `AgentConfigLookup`, so `resolveAgentConfig` is already available on it).

- `src/tools/agent-tool.ts` — `AgentTool.execute` already short-circuits on a config error: `if ("error" in config) return textResult(config.error);`.
  So returning `SpawnConfigError` from `resolveSpawnConfig` is sufficient to surface the message to the model with no further wiring.

AGENTS.md / package constraints that apply:

- Pi-subagents is a minimal core with no policy enforcement.
  This fix is **not** policy — it enforces the agent's own `enabled` flag, which is part of the registry's documented contract, not a cross-cutting tool/skill restriction (those live in `@gotgenes/pi-permission-system`).
- Biome handles formatting; no Prettier.

## Design Overview

Two localized, independent changes.
Neither introduces a new collaborator, widens a dependency bag, or changes layer wiring, so the design-review structural checklist finds nothing to flag.

### 1. Spawn-path gate (explicit error for disabled types)

In `resolveSpawnConfig`, after resolving the canonical key, gate on `enabled` before falling back.
The check reuses the registry's existing `isValidType`, which already encodes "exists and enabled":

```typescript
const rawType = params.subagent_type as SubagentType;
const resolved = registry.resolveType(rawType);

// A known-but-disabled type is an explicit error, not a silent fallback.
if (resolved !== undefined && !registry.isValidType(resolved)) {
  return { error: `Agent type "${resolved}" is disabled` };
}

const subagentType = resolved ?? "general-purpose";
const fellBack = resolved === undefined;
```

Decision model:

| `subagent_type` input     | `resolveType` | `isValidType(resolved)` | Outcome                                                        |
| ------------------------- | ------------- | ----------------------- | -------------------------------------------------------------- |
| enabled agent (`Explore`) | `"Explore"`   | `true`                  | resolves, spawns (unchanged)                                   |
| disabled agent (`Plan`)   | `"Plan"`      | `false`                 | error: `Agent type "Plan" is disabled`                         |
| unknown (`foo`)           | `undefined`   | not reached             | falls back to `general-purpose`, `fellBack = true` (unchanged) |

`isValidType(resolved)` re-runs `resolveKey` on an already-canonical key — a negligible, correct lookup.
Because the gate runs first, `resolveAgentConfig(subagentType)` downstream is only ever reached for enabled or unknown types, so its disabled-config behavior (kept for the UI) is never exercised on the spawn path.

This keeps the gate at the spawn boundary and leaves `resolveType` and `resolveAgentConfig` untouched, preserving every UI consumer that relies on resolving disabled agents.

### 2. Tool-description list filter

In `buildTypeListText`, filter both name lists by `enabled` before rendering.
`resolveAgentConfig(name)` returns the disabled config (with `enabled === false`) for a disabled name, so the predicate is straightforward:

```typescript
const isEnabled = (name: string) => registry.resolveAgentConfig(name).enabled !== false;
const defaultNames = registry.getDefaultAgentNames().filter(isEnabled);
const userNames = registry.getUserAgentNames().filter(isEnabled);
```

This localizes the fix to the one consumer that needs it, preserves the `getDefaultAgentNames` / `getUserAgentNames` method semantics (they still answer "which names are default / user"), and makes the tool description consistent with the `subagent_type` available-types line (both now exclude disabled agents).

`TypeListRegistry` already extends `AgentConfigLookup`, so `resolveAgentConfig` is in scope; no interface change.

## Module-Level Changes

- `src/tools/spawn-config.ts` — add the disabled-type gate in `resolveSpawnConfig` (3 lines) before the `subagentType` / `fellBack` assignment.
  No signature or return-type change (`SpawnConfigError` already supported).
- `src/tools/helpers.ts` — add the `isEnabled` predicate and `.filter(isEnabled)` to the two name lists in `buildTypeListText`.
  No signature or interface change.
- `src/config/agent-types.ts` — no code change.
  The inline comment "Disabled agents are kept but excluded from spawning" becomes accurate without edit; the `resolveType` JSDoc already says "Returns the canonical key or undefined" (unchanged behavior).

No architecture-doc, ADR, or SKILL changes:

- `grep -rn "448" docs/` and the architecture roadmap show no reference to this issue → no roadmap/health-table update.
- No file is added, removed, or moved → no layout-listing update.
- The `package-pi-subagents` SKILL describes domains and phases, not the `resolveType`/`isValidType` mechanics, so the reworded-prose grep (`enabled`, `resolveType`, `spawning`) surfaces nothing that this fix invalidates.
- README is already consistent (see Non-Goals); no edit.

## Test Impact Analysis

This is a small behavior fix, not an extraction, so no existing tests become redundant.

1. **New tests enabled** — both target surfaces are pure and already directly tested:
   - `resolveSpawnConfig` disabled-type error path (`test/tools/spawn-config.test.ts`).
   - `buildTypeListText` disabled-exclusion path (`test/tools/helpers.test.ts`).
2. **Redundant tests** — none.
   The existing `agent-types.test.ts` case "returns config for disabled type (no fallback for existing disabled)" stays as-is: it pins `resolveAgentConfig`'s disabled behavior, which the UI depends on and this fix deliberately does not change.
3. **Tests that must stay** — `agent-types.test.ts` `isValidType` "returns false for disabled agents" and `getAvailableTypes` "excludes disabled agents" already pin the registry primitives the gate reuses; keep them.

## Invariants at risk

This change touches the spawn-resolution and tool-description surfaces but does not regress any prior phase's documented outcome:

- `resolveAgentConfig` disabled-config behavior is pinned by `test/config/agent-types.test.ts` → "returns config for disabled type (no fallback for existing disabled)".
  The plan leaves `resolveAgentConfig` unchanged; this test must stay green.
- The unknown-type fallback is pinned by `test/tools/spawn-config.test.ts` → "falls back to general-purpose for unknown agent type".
  The gate runs only for `resolved !== undefined`, so the unknown path is untouched; this test must stay green.
- The UI's disabled-agent listing (`getAllTypes`) is pinned by `test/config/agent-types.test.ts` → `getAllTypes` "includes disabled agents"; unaffected.

## TDD Order

1. **Red→Green: spawn-path disabled error.**
   Test surface: `test/tools/spawn-config.test.ts`, `resolveSpawnConfig — type resolution` describe block.
   Add two cases: (a) a registry with a disabled `Plan` override returns `{ error: 'Agent type "Plan" is disabled' }` for `subagent_type: "Plan"`; (b) case-insensitive input `subagent_type: "plan"` reports the canonical `"Plan"` in the message.
   Build the registry with `new AgentTypeRegistry(() => new Map([["Plan", makeAgentConfig({ name: "Plan", enabled: false })]]))` (mirror the `agent-types.test.ts` fixture shape).
   Then add the gate to `resolveSpawnConfig`.
   Verify the existing "falls back to general-purpose for unknown agent type" and "resolves a known agent type" cases stay green (unknown/enabled paths unchanged).
   Commit: `fix(pi-subagents): return an error when spawning a disabled agent type (#448)`.

2. **Red→Green: tool-description excludes disabled agents.**
   Test surface: `test/tools/helpers.test.ts`, `buildTypeListText` describe block.
   Add a case: a registry whose `defaults`/`users` include a name resolving to `{ enabled: false }` omits that name from the rendered list (assert `.not.toContain`).
   Extend the `makeRegistry` stub's `resolve` to return `enabled` (the stub currently returns only `description`/`model`; add `enabled` so the predicate can read it).
   Then add the `isEnabled` filter to `buildTypeListText`.
   Verify the existing "lists default agents", "adds Custom agents section", and "omits Custom agents section" cases stay green (their stubs resolve to enabled configs by default).
   Commit: `fix(pi-subagents): exclude disabled agents from the subagent tool description (#448)`.

3. **Verify: full check + suite.**
   Run `pnpm --filter @gotgenes/pi-subagents run check`, `pnpm --filter @gotgenes/pi-subagents run lint`, `pnpm --filter @gotgenes/pi-subagents run test`, and `pnpm fallow dead-code`.
   No new commit unless a fix is needed.

## Risks and Mitigations

- **Risk:** changing `resolveType` directly would break UI consumers (`agent-config-editor.ts`, `agent-menu.ts`) that intentionally resolve disabled agents.
  **Mitigation:** the gate lives in `resolveSpawnConfig`, not in `resolveType`; `resolveType` and `resolveAgentConfig` are unchanged.
- **Risk:** an operator currently relying on the buggy behavior (explicitly spawning a disabled agent) gets an error after upgrade.
  **Mitigation:** this is the documented, intended contract; the error message is explicit and actionable ("…is disabled"), and the operator can re-enable via the `/agents` menu or by removing `enabled: false`.
- **Risk:** the `buildTypeListText` filter could accidentally hide enabled agents if `resolveAgentConfig` returned a wrong config.
  **Mitigation:** `resolveAgentConfig(name)` for a name already in the registry returns that exact config; the predicate only excludes `enabled === false`.
  Existing `buildTypeListText` tests (which resolve to enabled configs) guard against over-filtering.

## Open Questions

- Should the README's `## For Extension Authors` or the agent-config table gain a one-line note that an explicit `subagent_type` for a disabled agent now errors?
  Deferred — the README already states `enabled: false` disables the agent; the error message is self-explanatory.
  Revisit only if a user asks why the spawn errored.
