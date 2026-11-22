---
issue: 72
issue_title: "refactor: dependency-inject AgentManager's collaborators"
---

# Retro: #72 — dependency-inject AgentManager's collaborators

## Final Retrospective (2026-05-20T17:50:00Z)

### Session summary

Defined `AgentRunner` and `WorktreeManager` interfaces, converted `AgentManager`'s 6-positional-parameter constructor to an options bag with injected collaborators, migrated all 19 test sites from `vi.mock()` to `vi.fn()` stubs, and added 7 new DI-enabled tests.
The planning phase required significant user redirection to arrive at the right abstractions; the TDD execution phase was clean with zero rework.
Released as `pi-subagents-v5.6.0`.

### Observations

#### What went well

- The `ask_user` interactions during planning surfaced genuine design decisions (options bag vs positional constructor, lifecycle callback grouping) that the issue body left open.
  The user's responses were substantive and redirecting.
- The user's "make the change that makes the change easy" framing identified #84 (`GitWorktreeManager` extraction) as a prerequisite, which made #72's implementation clean — zero type-shuffling needed.
- The lift-and-shift test migration (Phase B → Phase C) worked exactly as planned: introduce `createManager()` helper under the old constructor, then switch it to the options bag atomically.
  All 19 test sites migrated with no logic changes.
- `Promise.withResolvers` (ES2024) in the new queueing test made controlled async coordination clean — no manual resolve/reject wiring.

#### What caused friction (agent side)

- `wrong-abstraction` — Spent ~4 analysis cycles on "how to move types between files" (`ToolActivity`, `RunOptions`, `WorktreeInfo` → `types.ts`) when the real question was "what objects want to exist?"
  The user had to redirect three times: "are there real objects with state?", "what state IS in AgentRunner?", and "we haven't pulled all the threads."
  Impact: added ~10 minutes of back-and-forth during planning, but ultimately produced a better design (stateful `WorktreeManager` vs stateless `AgentRunner` seam, plus #84 as prep).
  The dependency-graph analysis itself was sound — it confirmed no circular deps — but it answered a question nobody was asking.

- `premature-convergence` — First draft of the plan included `WorktreeManager` extraction as "Phase A step 1" inside #72.
  The user asked "did we create another issue that we need to tackle first?" — pointing out that the prep work should be its own issue.
  Impact: minor rework to update the plan and file #84; no code rework since it was caught during planning. (User-caught.)

#### What caused friction (user side)

- The user's early redirect ("take a step back — does the AgentManager really need six params?") could have been even more direct — e.g., "before we discuss constructor shape, what higher-level abstractions are missing?"
  That said, the Socratic approach ultimately led to a better shared understanding of why `WorktreeManager` is a real object and `AgentRunner` is a seam.

### Changes made

1. Retro file created at `packages/pi-subagents/docs/retro/0072-inject-agent-manager-collaborators.md`.
