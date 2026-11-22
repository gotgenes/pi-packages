---
issue: 444
issue_title: "pi-subagents: shrink the agent widget to background runs only"
---

# Shrink the agent widget to background runs only

## Release Recommendation

**Release:** ship independently

Phase 19 Step 3 ([architecture roadmap][arch]) is tagged `Release: independent` — it is not a member of any release batch.
The change is self-contained to `agent-widget.ts` and its tests, touches no public surface, and ADR-0004 explicitly notes it is "independent of the spike."

## Problem Statement

The above-editor agent widget currently renders every agent — foreground and background alike.
For foreground runs the `subagent` tool's inline `onUpdate` stream already renders live progress, so the widget duplicates that display (ADR-0004 Decision A).
The widget should survive only as the **background-agent status surface**: the one place with no inline tool-call display, which must represent N parallel background agents at once.

There is also a latent inconsistency to fix.
`AgentWidget` calls `manager.listAgents()` at two sites — `update()` (which feeds `seedFinishedAgents`, `assembleWidgetState`, and `clearWidget`) and `renderWidget()` (the tree map).
Filtering at only one site would leave the other rendering foreground agents.

## Goals

- The widget shows only background agents (`record.invocation?.runInBackground === true`); foreground agents never appear.
- Both `listAgents()` call sites are funneled through a single private accessor that applies the background predicate once at the source.
- The foreground/widget duplication called out by ADR-0004 Decision A is eliminated.
- This is a UI behavior refinement, not a public-API or config change — it is **non-breaking** (no exported surface, default, or config shape changes on upgrade).

## Non-Goals

- Relabeling the widget heading from `Agents` to `Background agents` (see Open Questions) — not requested; keep scope tight.
- Any change to `widget-renderer.ts` rendering logic — it has no foreground-specific path; the fix lives entirely at the data source in `agent-widget.ts`.
- Other `listAgents()` consumers (`agent-menu.ts`) — those are removed wholesale by Phase 19 Step 5 ([#442]), out of scope here.
- Native session navigation ([#445], Step 4) and the `/subagents-settings` extraction ([#447], Step 2).

## Background

Relevant modules:

- `src/ui/agent-widget.ts` — `AgentWidget implements SubagentManagerObserver`; self-drives an 80 ms render loop from lifecycle events (Step 4 self-drive, [#423]).
  `update()` reads `manager.listAgents()` into a local `allAgents`, then passes it to `seedFinishedAgents()`, `assembleWidgetState()`, and (on the idle path) `clearWidget()`.
  `renderWidget(tui, theme)` independently calls `manager.listAgents().map(r => this.toWidgetAgent(r))` to build the tree.
- `src/ui/widget-renderer.ts` — pure rendering; `renderWidgetLines()` categorizes agents into running/queued/finished and emits tree lines.
  It has no knowledge of foreground vs. background — it renders whatever list it receives.
- `Subagent.invocation` (`src/lifecycle/subagent.ts`) — a readonly `AgentInvocation | undefined` set once at construction.
  `AgentInvocation.runInBackground` (`src/types.ts`) is the reliable signal: set by `spawn-config.ts` → `AgentInvocation.runInBackground` → stored on `Subagent.invocation`.
- `AgentSummary` (in `agent-widget.ts`) — the minimal `{ id, status, completedAt }` shape consumed by `assembleWidgetState`/`clearWidget`.
  `Subagent` is structurally assignable to it, so the accessor can return `Subagent[]` without an interface change.

Constraint from AGENTS.md / package skill: pi-subagents is a minimal core; this is a consumer-side UI behavior change with no policy or core impact.

## Design Overview

Introduce one private accessor on `AgentWidget` and route both existing call sites through it:

```typescript
/** Background agents only — the widget's sole audience (ADR-0004 Decision A). */
private listBackgroundAgents(): Subagent[] {
  return this.manager
    .listAgents()
    .filter(record => record.invocation?.runInBackground === true);
}
```

Call-site changes:

- `update()` — replace `const allAgents = this.manager.listAgents();` with `const backgroundAgents = this.listBackgroundAgents();` and rename the downstream references (`seedFinishedAgents`, `assembleWidgetState`, `clearWidget`).
- `renderWidget()` — replace `this.manager.listAgents().map(...)` with `this.listBackgroundAgents().map(...)`.

The predicate `record.invocation?.runInBackground === true` is applied exactly once, at the funnel.
`undefined` invocation (or `runInBackground` absent/false) is treated as foreground and excluded.

Edge cases verified:

- **`clearWidget` stale-purge:** it deletes `finishedTurnAge` entries for IDs "no longer in the list."
  Because `seedFinishedAgents` only ever seeds from the background-filtered list, no foreground agent is ever tracked, so purging against the background-only list cannot drop a still-relevant entry — no behavior regression.
- **Queued agents:** the concurrency limiter queues only background agents (foreground bypasses the queue), so they carry `runInBackground === true` and remain visible; the queued-count display stays accurate.
- **All-foreground case:** `update()` sees an empty background list → `assembleWidgetState` reports no active/finished → `clearWidget` → widget never registers.
  `renderWidget()` is consequently never invoked.
- **Mixed case (the latent bug):** one background running + one foreground running → `update()` registers the widget (1 background active); `renderWidget()` must also filter, or it renders both.
  Routing both sites through the accessor closes this.

## Module-Level Changes

- `src/ui/agent-widget.ts` — add private `listBackgroundAgents()`; route `update()` and `renderWidget()` through it; rename the `update()` local `allAgents` → `backgroundAgents`.
- `src/ui/widget-renderer.ts` — **no change.**
  Verified there is no foreground-specific rendering path; filtering at the data source is sufficient.
  Listed only to record the verification.
- `test/ui/agent-widget.test.ts` — migrate existing widget fixtures to set `invocation: { runInBackground: true }` (otherwise the new filter excludes them); add background-only filtering tests.
- `packages/pi-subagents/README.md` — line ~64, change "showing all active agents" → "showing active background agents" (stale prose once foreground is excluded).
- `packages/pi-subagents/docs/architecture/architecture.md` — mark Step 3 ✅ with a `Landed`/`Outcome` note; the `src/ui/agent-widget.ts` tree caption at line ~342 stays accurate (generic "live status widget").

Grep sweep performed for stale references to "all agents" / "showing all active agents" across `src/`, `test/`, `.pi/skills/package-pi-subagents/SKILL.md`, and `docs/`:

- `README.md:64` — stale, updated above.
- `.pi/skills/package-pi-subagents/SKILL.md:57` ("widget ─polls─→ Subagent records (listAgents)") — still accurate (it does poll `listAgents`, now filtered); no edit.
- `docs/comparison-with-upstream.md:29`, `architecture.md:342` — generic "live above-editor widget"; remain accurate.

## Test Impact Analysis

1. **New tests enabled by the change:**
   - `update()` excludes foreground agents — an all-foreground agent list leaves the widget unregistered (`lastContent()` undefined).
   - `renderWidget()` excludes foreground agents — a mixed background+foreground list renders only the background agent's description in the tree (the foreground description is absent).
     This pins the previously-latent two-site inconsistency.
2. **Tests that become redundant:** none are removed.
   The existing widget-behavior fixtures (`makeWidget` in the two `describe` blocks, plus the projection test's `createTestSubagent`) are migrated to set `invocation: { runInBackground: true }` so they continue to exercise the same lifecycle/seeding/self-drive behavior under the new filter.
3. **Tests that must stay as-is:** the `assembleWidgetState` pure-function suite — it calls the pure function directly with `AgentSummary[]`, not through the accessor, so it is unaffected by the filter and continues to pin the counting logic.

## Invariants at risk

This step touches `agent-widget.ts`, which prior phases already refactored.
The fixture migration must keep these invariants pinned (the tests stay, only their `invocation` field is added):

- **Self-drive from lifecycle ([#423]):** `onSubagentStarted`/`onSubagentCreated` start the 80 ms timer and render; `onSubagentCompleted`/`onSubagentCompacted` render.
  Pinned by the "self-drives from lifecycle notifications" describe block — fixtures migrated to background invocation so the manager stub's agents survive the filter.
- **`seedFinishedAgents` idempotency / linger aging ([#374]):** finished agents seed once, age out after 1 turn (errors after 2), and `update()` never advances the age without a turn.
  Pinned by the "update self-seeds finished agents" describe block — fixtures migrated to background invocation.

A later step must not regress these with a green suite; the migration preserves the assertions verbatim apart from the `invocation` field.

## TDD Order

1. **`test:` migrate widget fixtures to background invocation (preparatory / tidy-first).**
   Surface: `test/ui/agent-widget.test.ts`.
   Add `invocation: { runInBackground: true }` to the `makeWidget` agent stubs (both `describe` blocks) and to the projection test's `createTestSubagent` call.
   No production change — the filter does not exist yet, so the field is inert and the suite stays green.
   This makes the next step a clean addition rather than a mass fixture rewrite.
   Commit: `test: set background invocation on agent-widget fixtures (#444)`.
2. **`feat:` filter the widget to background agents only.**
   Red: add (a) an all-foreground list leaves the widget unregistered, and (b) a mixed background+foreground list renders only the background agent in `renderWidget()`.
   Green: add the private `listBackgroundAgents()` accessor; route both `update()` and `renderWidget()` through it; rename the `update()` local to `backgroundAgents`.
   Commit: `feat: shrink agent widget to background runs only (#444)`.
3. **`docs:` update widget docs for background-only behavior.**
   Update `README.md` ("all active agents" → "active background agents") and mark Phase 19 Step 3 ✅ with a `Landed`/`Outcome` note in `docs/architecture/architecture.md`.
   Commit: `docs: note background-only widget in README and roadmap (#444)`.

## Risks and Mitigations

- **Mass test breakage when the filter lands** — every `update()`-driven fixture would be filtered out and assertions would fail.
  Mitigation: TDD step 1 migrates all fixtures first (inert until the filter exists), so step 2 only adds new tests.
- **A foreground agent the operator expected to see disappears** — intended per ADR-0004 Decision A; the inline `onUpdate` stream is authoritative for foreground runs.
- **`clearWidget` stale-purge dropping a relevant entry** — analyzed in Design Overview; foreground agents are never seeded, so purging against the background-only list is correct.

## Open Questions

- Should the widget heading read `Background agents` instead of `Agents`?
  Deferred — not in the issue scope; revisit if the bare label reads as ambiguous in practice.

[arch]: ../architecture/architecture.md
[#442]: https://github.com/gotgenes/pi-packages/issues/442
[#445]: https://github.com/gotgenes/pi-packages/issues/445
[#447]: https://github.com/gotgenes/pi-packages/issues/447
[#423]: https://github.com/gotgenes/pi-packages/issues/423
[#374]: https://github.com/gotgenes/pi-packages/issues/374
