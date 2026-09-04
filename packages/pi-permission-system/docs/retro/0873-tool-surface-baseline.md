---
issue: 873
issue_title: "denied tools remain removed after policy is relaxed in the same session"
---

# Retro: #873 — denied tools remain removed after policy is relaxed in the same session

## Stage: Planning (2026-09-04T17:46:45Z)

### Session summary

Confirmed the reporter's diagnosis in `src/handlers/before-agent-start.ts` — `getActive()` → filter → `setActive()` makes each turn's output the next turn's input, so the effective tool surface can only shrink.
Settled on a per-session `ToolSurfaceBaseline` that recomputes `Effective = Baseline ∩ Policy` each turn, owned by `PermissionSession` and reset on session start/shutdown but deliberately **not** on config reload.
Wrote `packages/pi-permission-system/docs/plans/0873-tool-surface-baseline.md` with six TDD steps, two of them Tidy-First preparations to the test fixtures.

### Observations

- The issue is third-party (`Jak-o`), so the `ask_user` gate covered direction as well as design.
  The operator chose the in-package baseline fix, accepting the one-turn prompt lag, with debug-stream logging only.
- **A gate option I offered turned out to be non-viable.**
  I proposed re-sourcing the prompt from `ctx.getSystemPrompt()` after `setActive` to eliminate the one-turn `Available tools:` lag.
  Checking `dist/core/extensions/runner.js:749-752` in the pinned 0.79.1 bundle afterwards showed `getSystemPrompt` is **shadowed** inside `emitBeforeAgentStart` to return the chained `currentSystemPrompt` — i.e. exactly `event.systemPrompt`.
  I had verified the `agent-session.js` half (`setActiveToolsByName` rebuilds the base prompt) but not the runner half that actually serves the accessor.
  Lesson: verifying that a seam *exists* and that its *implementation* does what you want are two reads, and the second one is where the option died.
  The correction was reported before the plan was written; the operator's answer was unaffected.
- The operator asked whether there is precedent for modifying the prompt and what it costs packages like `pi-anthropic-auth`.
  There is: [#437] made the returned override byte-stable across turns precisely for the provider prompt cache, and `docs/configuration.md:1170` records it.
  A policy relax is an intentional cache transition of the same class plan `0437` already enumerates for a mid-session agent switch — but the one-turn lag makes it **two** prefix invalidations instead of one (tools block on the relax turn, system prompt on the next).
  Recorded in the plan's Invariants section rather than treated as a blocker.
- **The Tidy-First assessor caught a real design error.**
  My design summary claimed `skillEntries` is cleared in two places and proposed following that precedent; it is cleared in three, including `reload()`.
  Following the precedent there would have reseeded the baseline from the already-filtered set on every config reload — reintroducing [#873] at exactly the moment it matters.
  The plan now carves `reload()` out explicitly and pins it with a killing mutation.
- The assessor also found that neither `makeToolRegistry` double models the `setActive` → `getActive` feedback loop, so the regression test could not have been written faithfully.
  That became TDD steps 1-2.
- Added one hardening clause not in the issue: a withheld tool that Pi unregisters is forgotten, so it cannot be resurrected if it is later re-registered inactive ([#385]'s contract).
  The conjunct is restricted to *withheld* entries so a degenerate `getAll()` can never drop a currently-active tool.
- No follow-up issues filed.
  The upstream "intended vs effective tool set" accessor was offered as a gate option and not chosen, so filing it would be speculative.

[#385]: https://github.com/gotgenes/pi-packages/issues/385
[#437]: https://github.com/gotgenes/pi-packages/issues/437
