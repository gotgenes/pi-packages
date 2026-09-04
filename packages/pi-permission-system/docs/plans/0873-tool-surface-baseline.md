---
issue: 873
issue_title: "denied tools remain removed after policy is relaxed in the same session"
---

# Restore a relaxed tool by recomputing the surface from a session baseline

## Release Recommendation

**Release:** ship independently

No Phase 14 roadmap step references [#873], so it carries no `Release:` batch tag.
It is a self-contained bug fix in `before_agent_start` tool filtering with no dependency on other in-flight work.

## Problem Statement

`AgentPrepHandler.handle()` reads the current active tool set, removes the fully-denied tools, and writes the remainder back:

```typescript
const activeTools = this.toolRegistry.getActive(); // src/handlers/before-agent-start.ts:63
// … filter …
this.toolRegistry.setActive(allowedTools); //          src/handlers/before-agent-start.ts:80
```

Each turn's output becomes the next turn's input, so the effective surface is monotonically non-increasing: `Effective(n+1) = Effective(n) ∩ Policy`.
Once `ls: deny` withholds `ls`, removing that rule and refreshing config on a later turn cannot restore it — `ls` is no longer in the input set.
[#873] reports this on 27.1.0 and 31.0.0 against `@earendil-works/pi-coding-agent@0.84.3`.

The reporter's expected model is `Effective(turn) = BaselineRuntimeSurface ∩ CurrentPolicy`, with the baseline being the surface Pi itself activated — so relaxing a rule restores a tool that Pi had active, while a tool Pi deliberately left inactive stays inactive ([#385]'s restrict-only contract).

The failure is in the restrictive direction, so it is a correctness and lifecycle defect rather than a privilege escalation.

## Goals

- Recompute the effective tool surface each turn from a per-session baseline rather than from the previous turn's output, so relaxing a rule restores a tool within the same Pi session.
- Preserve [#385]'s restrict-only contract: the baseline is seeded only from tool sets Pi itself made active, never from `getAllTools()`.
- Preserve [#437]'s byte-stability invariant: for a stable policy and agent the returned system-prompt override stays byte-identical across turns.
- Keep honoring a deactivation performed by something other than this extension — a tool removed from the active set by another party, and not withheld by us, drops out of the baseline.
- Give the surface change a diagnostic signal, so a future report of this class does not need hand-instrumented `T14_ACTIVE_TOOLS` dumps.

This change is **not breaking**.
For a stable policy the effective surface, the wire tool set, and the returned prompt override are all unchanged; the new behavior appears only on a turn whose policy differs from the turn that withheld a tool.

## Non-Goals

- **Asking Pi for an intended-vs-effective tool-set accessor.**
  The issue's third suggested direction needs SDK support that does not exist: `ExtensionAPI` exposes `getActiveTools()` (currently effective) and `getAllTools()` (whole registry) and nothing between them.
  The operator chose the in-package fix; no upstream issue is filed by this plan.
- **Re-advertising a restored tool in the same turn's `Available tools:` listing.**
  See Risks — this is not reachable from a `before_agent_start` handler, and the lag self-heals on the next turn.
- **Persisting the baseline across Pi restarts.**
  A restart re-derives it from Pi's own startup active set, which is the correct source.
- **Changing `shouldExposeTool` / `isToolFullyDenied` semantics** ([#815]).
  Which tools the policy withholds is unchanged; only the set the policy is applied *to* changes.
- **Changing `ToolRegistry`'s shape** (`src/tool-registry.ts`).
  `getAll` / `getActive` / `setActive` are all already present and sufficient.

## Background

`AgentPrepHandler` (`src/handlers/before-agent-start.ts`) is the `before_agent_start` handler.
Since [#787] it delegates turn preparation to `SessionTurnPrep` and keeps the one job its name describes: filter the active tools, then sanitize the system prompt.
Since [#437] it recomputes and returns the override on **every** fire, with no memoization gate, and the override must be byte-stable across turns for a stable policy so the provider's prompt cache (tools block → system prefix → messages) is not rewritten each turn.
Since [#385] the filtering base is `pi.getActiveTools()`, not `pi.getAllTools()`, so the extension never activates a tool Pi left off.

Relevant SDK mechanics, verified against the pinned `@earendil-works/pi-coding-agent@0.79.1` compiled bundle (not the sibling checkout, which runs ahead of the pin):

- `setActiveToolsByName` resolves each name against the **full** tool registry (`dist/core/agent-session.js:546-552`), so re-adding a name this extension previously withheld does reactivate the tool.
  An unknown name is silently ignored.
- The same method rebuilds the base system prompt from the accepted names and assigns it to `agent.state.systemPrompt` (`dist/core/agent-session.js:553-556`).
- `emitBeforeAgentStart` receives `this._baseSystemPrompt` as an argument evaluated **before** any handler runs (`dist/core/agent-session.js:796`), and threads each handler's returned override into the next handler's `event.systemPrompt` (`dist/core/extensions/runner.js:747, 765, 774-777`).
- Within that emission the ctx handed to handlers has `getSystemPrompt` **shadowed** to return the chained `currentSystemPrompt` (`dist/core/extensions/runner.js:749-752`).
  So `ctx.getSystemPrompt()` inside our handler returns exactly `event.systemPrompt` — Pi's freshly rebuilt base prompt is not reachable from a `before_agent_start` handler at all.

`PermissionSession` (`src/permission-session.ts`) owns per-session mutable state and its lifecycle.
`skillEntries` is the closest precedent for the new state: written by `AgentPrepHandler` each turn, and cleared in **three** places — `resetForNewSession()` (line 110), `shutdown()` (line 120), and `reload()` (line 136).

AGENTS.md constraints that apply:

- Module-scoped mutable state persists across same-cwd session switches, so the baseline must live in per-session state, not at module scope.
- The debug and review logs are distinct streams; tool filtering is not a permission decision, so it belongs on the debug stream.
- `docs/architecture/architecture.md` module-tree entries describe current behavior; cite an issue there only for an active constraint.

## Design Overview

### The recomputation

Hold a per-session baseline of the pre-filter runtime surface and recompute the reporter's own formula each turn.

```typescript
/** What the handler observed about the tool surface this turn. */
export interface ToolSurfaceObservation {
  /** Names Pi reports active right now (`pi.getActiveTools()`). */
  readonly active: readonly string[];
  /** Names Pi currently has registered (`pi.getAllTools()`). */
  readonly registered: ReadonlySet<string>;
}

/** The effective surface for one turn, plus what changed. */
export interface ToolSurfaceResolution {
  /** Names to hand to `setActive`, in baseline order. */
  readonly exposed: readonly string[];
  /** Baseline members the current policy withholds. */
  readonly withheld: readonly string[];
  /** Names withheld on an earlier turn that the current policy restores. */
  readonly restored: readonly string[];
  /** True when the withheld set differs from the previous turn's. */
  readonly changed: boolean;
}

export class ToolSurfaceBaseline {
  resolveExposed(
    observation: ToolSurfaceObservation,
    isExposed: (toolName: string) => boolean,
  ): ToolSurfaceResolution;
  reset(): void;
}
```

`resolveExposed` reconstructs the baseline before applying the policy:

1. Keep each previous-baseline entry that is either still active, or was withheld by us **and** is still registered.
2. Append any newly-observed active name not already in the baseline (a tool another party activated mid-session).
3. Partition the reconstructed baseline with `isExposed`; store it and the new withheld set; return the four facts.

Order is preserved by construction, so the tools block and the `Available tools:` listing keep their positions rather than moving a restored tool to the end.

Why each clause is load-bearing:

- Seeding only from `observation.active` (never `registered`) is what preserves [#385].
  A tool Pi left inactive is never observed, so it never enters the baseline.
- Dropping an entry that is neither active nor withheld-by-us is what lets another extension's deactivation stick.
- The `registered` conjunct applies **only** to withheld entries, so a tool unregistered while we were withholding it is forgotten rather than resurrected if it is later re-registered inactive.
  Restricting the conjunct to withheld entries also fixes the failure direction: a degenerate `getAll()` can only cost restoration candidates, never remove a currently-active tool.

### Ownership and lifecycle

`PermissionSession` composes the baseline internally (no new constructor parameter) and exposes one delegating method, mirroring the `skillEntries` precedent:

```typescript
// src/permission-session.ts
resolveExposedTools(
  observation: ToolSurfaceObservation,
  isExposed: (toolName: string) => boolean,
): ToolSurfaceResolution {
  return this.toolSurfaceBaseline.resolveExposed(observation, isExposed);
}
```

The baseline is cleared in `resetForNewSession()` and `shutdown()` — and deliberately **not** in `reload()`.

This is the one place the `skillEntries` precedent must not be followed.
`reload()` is the config-reload path (`resources_discover` with reason `"reload"`), which is exactly the moment a relaxed policy arrives.
Clearing the baseline there would reseed it from the already-filtered active set and reintroduce [#873] on every reload.
Skill entries are safe to clear because they are recomputed from the prompt each turn; the baseline is not derivable from anything available after the fact.

### The handler

```typescript
// src/handlers/before-agent-start.ts — replaces the loop at lines 63-80
const observation = {
  active: this.toolRegistry.getActive().map(getToolNameFromValue).filter(isPresent),
  registered: new Set(this.toolRegistry.getAll().map(getToolNameFromValue).filter(isPresent)),
};
const surface = this.session.resolveExposedTools(observation, (toolName) =>
  shouldExposeTool(toolName, agentName, (t, a) => this.resolver.isToolFullyDenied(t, a)),
);
this.toolRegistry.setActive([...surface.exposed]);
if (surface.changed) {
  this.logger.debug("tool_surface.changed", {
    exposed: surface.exposed,
    withheld: surface.withheld,
    restored: surface.restored,
  });
}
```

The call site is Tell-Don't-Ask: the handler hands the session an observation and a predicate and receives the answer, rather than reading a baseline out of it and deciding itself.
`shouldExposeTool` keeps its current signature and its direct unit tests.

The handler gains a fifth constructor dependency for the debug log.
It should be a new narrowest seam rather than the full `SessionLogger`:

```typescript
// src/session-logger.ts
export interface DebugLogger {
  debug(event: string, details?: Record<string, unknown>): void;
}
export interface DebugReviewLogger extends ReviewLogger, DebugLogger {}
```

`DebugReviewLogger` keeps its current members, so no existing consumer changes.

The debug entry fires only when the withheld set differs from the previous turn's, so a persistent deny does not write a line per turn.
Tool filtering is not a permission decision, so it does not reach the review stream (ADR 0011 §6).

## Module-Level Changes

### Production

- `src/tool-surface-baseline.ts` — **new**.
  `ToolSurfaceObservation`, `ToolSurfaceResolution`, `ToolSurfaceBaseline`.
  No SDK imports; pure over strings and a predicate.
- `src/permission-session.ts` — compose a `ToolSurfaceBaseline` field; add `resolveExposedTools(...)`; add `this.toolSurfaceBaseline.reset()` to `resetForNewSession()` (line ~110) and `shutdown()` (line ~120).
  Leave `reload()` (line ~132) untouched, with a comment stating why.
- `src/handlers/before-agent-start.ts` — replace the filtering loop (lines 63-80) with the observation/predicate call; add the `DebugLogger` constructor dependency and the change-gated debug entry; update the class doc comment's dependency list.
- `src/session-logger.ts` — add the `DebugLogger` interface and make `DebugReviewLogger` extend both it and `ReviewLogger`.
- `src/index.ts` — pass `logger` to `new AgentPrepHandler(...)` (line ~316); `logger` is already in scope at that site (it is passed to `SessionLifecycleHandler` at line ~301).

Symbol-removal sweep: this change removes no export and renames none, so the removed-symbol greps do not apply.
`ToolRegistry`'s three members all keep their meaning; `getAll()` gains a second production caller.

### Tests

- `test/tool-surface-baseline.test.ts` — **new**; unit tests for the pure class.
- `test/helpers/handler-fixtures.ts` — add a stateful `ToolRegistry` double that feeds `setActive`'s argument back into the next `getActive()` call, seeded from an initial list, as an explicit opt-in beside the existing static `makeToolRegistry`.
- `test/handlers/before-agent-start.test.ts` — drop the local `makeToolRegistry` duplicate (lines 32-39) in favour of the shared one; add the restore regression tests; add the debug-logging tests; thread the new handler dependency through `makeSetup`.
- `test/permission-session.test.ts` — add baseline reset/survival tests alongside the existing `skillEntries` reset tests.
- `test/composition-root.test.ts` — no edit expected; it fires `before_agent_start` through the real factory, so it is the pin on the `index.ts` wiring compiling and running.

### Docs

- `docs/configuration.md` — line 1167's restrict-only bullet gains the baseline sentence (the base is the surface Pi has activated over the session, not the previous turn's filtered output, so relaxing a rule restores the tool without a restart); add a bullet for the one-turn listing lag near line 1169-1170; leave the byte-stability bullet's claim intact but scope it to a stable policy.
- `docs/architecture/architecture.md` — line 834 (`permission-session.ts` tree entry) adds the tool-surface baseline to the owned-state list; line 864 (`before-agent-start.ts` tree entry) replaces "recomputes the active set … every fire" with the baseline recomputation and names the fifth dependency; add a `tool-surface-baseline.ts` tree entry; extend the `### Phase 1: Tool filtering (before_agent_start)` section (line 459) with the baseline model.
  The `reload()`-must-not-reset rule is an active constraint, so it earns its `(#873)` citation in the tree; nothing else does.
- `.pi/skills/package-pi-permission-system/SKILL.md` — line 30's "Hide denied tools from the agent before it starts" bullet gains the baseline rule and the reload carve-out.
  Greps run: `AgentPrepHandler` (one hit in the skill, at line 237, describing the `SessionTurnPrep` extraction — unaffected), `restrict-only` / `already-active` / `getActiveTools` across `docs/` and `README.md` (hits at `docs/configuration.md:1160,1167,1169,1170` only; `README.md` has none).

## Test Impact Analysis

New tests the extraction enables, previously impossible:

- `ToolSurfaceBaseline` is pure over strings and a predicate, so the baseline-reconstruction rules (restrict-only seeding, foreign deactivation, unregistered-withheld forgetting, order preservation, `changed` computation) become direct unit tests instead of two-turn handler integrations.

Existing tests that must stay as-is:

- `does not activate registered tools pi left inactive (find/grep/ls)` — the [#385] pin; it is the reason the baseline seeds from `active` only.
- `keeps the wire system prompt byte-stable across the tool-listing drift between turns` — the [#437] pin.
  Its turn-2 `getActive` mock still returns all four tools, so the baseline is a fixpoint and both turns produce the identical override; predicted unchanged.
- `calls setActive on every turn (no dedup gate)` — pins that no memoization gate returns early.
- The `shouldExposeTool` block — the helper is untouched.

Tests that become redundant: none.
The two-turn tests above use the **static** double deliberately (they pin per-turn recomputation, not the feedback loop), so they keep it.

Fixture gap, and why it is a preparatory step: both `makeToolRegistry` factories (`test/helpers/handler-fixtures.ts:128-138` and the local duplicate at `test/handlers/before-agent-start.test.ts:32-39`) are stateless — `getActive` returns a fixed value regardless of prior `setActive` calls.
Neither can express the `setActive → getActive` feedback loop the bug *is*, so the regression test cannot be written faithfully against them.

## Invariants at risk

| Invariant                                                | Source                               | Pinned by                                                                              | Prediction                                                                                                                                 |
| -------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Restrict-only: never activate a tool Pi left off         | [#385]                               | `does not activate registered tools pi left inactive (find/grep/ls)`                   | Preserved — the baseline seeds only from observed active sets                                                                              |
| Wire prompt byte-stable across turns for a stable policy | [#437], `docs/configuration.md:1170` | `keeps the wire system prompt byte-stable across the tool-listing drift between turns` | Preserved — for a stable policy the baseline reaches a fixpoint on turn 1, so `exposed` and therefore the override are identical each turn |
| A tool is withheld only when its whole surface is denied | [#815]                               | `shouldExposeTool` block                                                               | Untouched — the predicate is unchanged, only its input set changes                                                                         |
| Skill entries cleared on reload                          | [#644]                               | `permission-session.test.ts` `describe("reload")` → `clears skill entries`             | Preserved — `reload()` keeps clearing `skillEntries` and must **not** clear the baseline                                                   |

Quantitative note on the prompt cache.
The provider prefix is tools block → system prompt → messages.
On a relax turn the tools block gains the restored tool immediately, while the `Available tools:` line reappears only on the following turn — so a relax costs **two** prefix invalidations rather than one.
Under a stable policy it costs zero, which is the case the invariant is about.
Plan `0437` already enumerates a mid-session agent switch as an intentional cache transition of the same class.

## TDD Order

1. **`test(pi-permission-system): use the shared tool-registry double in before-agent-start tests`** Prepares the change: the local `makeToolRegistry` at `test/handlers/before-agent-start.test.ts:32-39` duplicates `test/helpers/handler-fixtures.ts`, so the stateful mode step 2 adds would otherwise have to be written twice.
   Delete the local factory, import the shared one, and adjust the `makeSetup()` call sites that relied on the local `[]` defaults.
   Verify: `pnpm --filter @gotgenes/pi-permission-system test` green with no assertion edits.

2. **`test(pi-permission-system): add a stateful tool-registry double that models the setActive feedback loop`** Prepares the change: no existing double feeds `setActive`'s argument back into `getActive()`, so the [#873] regression cannot be expressed.
   Add the opt-in stateful mode to `handler-fixtures.ts` (the static default is unchanged), plus a test of the double itself showing the feedback.
   Killing mutation: make the stateful double ignore its recorded `setActive` argument and keep returning the seed — the double's own test goes red.

3. **`fix(pi-permission-system): restore a tool when its deny rule is relaxed mid-session`** Red first: a two-turn `before-agent-start.test.ts` test over the stateful double — baseline contains `ls`; deny `ls`; assert absent; relax; assert `ls` present again — plus `test/tool-surface-baseline.test.ts` unit tests for reconstruction, order preservation, foreign deactivation, and `changed`.
   Green: add `src/tool-surface-baseline.ts` (without the `registered` conjunct, which is step 4), the `PermissionSession` composition + `resolveExposedTools` + resets in `resetForNewSession`/`shutdown`, and the handler switch.
   Land these together: `resolveExposedTools` and the new module have no other consumer, so splitting them leaves a commit whose new code nothing calls.
   Killing mutations, one per equivalence class:
   - Reconstruct the baseline from `observation.active` alone (drop the withheld union) → the restore regression test and the baseline reconstruction unit tests go red; the [#385] and byte-stability tests stay green.
   - Seed the baseline from `observation.registered` instead of `observation.active` → the [#385] `find/grep/ls` test goes red.
   - Append restored names to the end of `exposed` instead of reinserting them in baseline order → the order-preservation unit test goes red.
   - Keep a baseline entry that is neither active nor withheld-by-us → the foreign-deactivation unit test goes red.
   - Add `this.toolSurfaceBaseline.reset()` to `PermissionSession.reload()` → the "baseline survives a config reload" test goes red (this is the mutation that re-creates [#873]).
   - Delete `this.toolSurfaceBaseline.reset()` from `resetForNewSession()` → the "a new session starts from Pi's active set" test goes red.

4. **`fix(pi-permission-system): forget a withheld tool that Pi has unregistered`** Add `observation.registered` and the withheld-only conjunct.
   Red: a withheld tool that leaves the registry and is later re-registered inactive must not reappear in the active set; and a degenerate empty `registered` must not remove a currently-active tool.
   Killing mutations:
   - Drop the `registered.has(name)` conjunct → the unregistered-withheld test goes red.
   - Apply the conjunct to every baseline entry rather than only withheld ones → the degenerate-`getAll()` test goes red (it would empty the active set).

5. **`feat(pi-permission-system): log tool-surface changes to the debug stream`** Add the `DebugLogger` seam to `src/session-logger.ts`, the fifth `AgentPrepHandler` dependency, the change-gated `tool_surface.changed` entry, and the `index.ts` wiring.
   Killing mutations:
   - Emit the entry unconditionally → the "does not log when the surface is unchanged" test goes red.
   - Never emit → the "logs the withheld and restored names when the surface changes" test goes red.

6. **`docs(pi-permission-system): document the tool-surface baseline`** The `docs/configuration.md`, `docs/architecture/architecture.md`, and `.pi/skills/package-pi-permission-system/SKILL.md` edits listed in Module-Level Changes.
   Verify: `pnpm exec rumdl check` on each edited file, and re-run the greps recorded there to confirm no other passage still describes the previous-output-as-input model.

## Risks and Mitigations

- **A restored tool is not advertised in the same turn's `Available tools:` listing.**
  Pi evaluates `_baseSystemPrompt` before any handler runs, and that prompt was rebuilt last turn from the reduced tool set, so the restored tool's line is absent for one turn.
  The tool is nevertheless in the wire tools array, so it is callable, and the listing self-heals next turn.
  This is not fixable in-extension: `ctx.getSystemPrompt()` is shadowed inside `emitBeforeAgentStart` to return the chained `event.systemPrompt` (`dist/core/extensions/runner.js:749-752`), so Pi's rebuilt base prompt is unreachable, and `sanitizeAvailableToolsSection` is subtractive and cannot synthesize a line.
  Accepted and documented; the skew direction is conservative.

- **The baseline retains a tool another extension deactivated while we were also withholding it.**
  The two deactivations are indistinguishable through `getActiveTools()`.
  The consequence is bounded: it can only surface on a turn where our policy relaxes, and the tool was one Pi had active.
  Documented rather than mechanized.

- **Stale baseline across a session switch.**
  Pi re-invokes the extension factory per session switch, so a fresh handler and session are built — but the reset in `resetForNewSession()` makes the guarantee explicit rather than incidental, and it is pinned by a test.

- **`getAll()` returning nothing degenerate-empties the surface.**
  Mitigated by construction: the `registered` conjunct applies only to withheld entries, so an empty `registered` can cost restoration candidates but can never drop a currently-active tool.
  Step 4 pins this with a test rather than an argument.

- **Debug-log volume.**
  Gated on `changed`, so a stable policy writes one entry on the first turn that withholds anything and nothing thereafter.

## Open Questions

None.
The direction, the prompt-lag handling, and the logging depth were settled at the planning gate; the `reload()` reset question raised by the Tidy-First assessment is answered in Design Overview.

[#385]: https://github.com/gotgenes/pi-packages/issues/385
[#437]: https://github.com/gotgenes/pi-packages/issues/437
[#644]: https://github.com/gotgenes/pi-packages/issues/644
[#787]: https://github.com/gotgenes/pi-packages/issues/787
[#815]: https://github.com/gotgenes/pi-packages/issues/815
[#873]: https://github.com/gotgenes/pi-packages/issues/873
