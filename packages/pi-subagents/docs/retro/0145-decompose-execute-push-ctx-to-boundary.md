---
issue: 145
issue_title: "Decompose execute and push ExtensionContext to the boundary (Phase 9, Step M)"
---

# Retro: #145 — Decompose execute and push ExtensionContext to the boundary

## Final Retrospective (2026-05-23)

### Session summary

Extracted config resolution into a pure `resolveSpawnConfig` function, injected three collaborators (`buildSnapshot`, `getModelInfo`, `getSessionInfo`) into `createAgentTool` to eliminate `ctx` reads from `execute`, pushed `ParentSnapshot` to `AgentManager`'s public API, and dissolved three small dependency bags (`ForegroundDeps`, `BackgroundDeps`, `AdapterDeps`) into plain parameters.
Released as `pi-subagents-v6.15.0`.

### Observations

#### What went well

- User's two escalating questions ("Are there any other missing collaborators?" → "Hiding dependencies in an object bag still counts as dependencies!") caught a `premature-convergence` before it landed as committed code.
  The reverted partial step 3 attempt was ~4 files of changes that would have needed rework.
  The resulting design (injected collaborators) is meaningfully better than the original plan's mechanical relocation.
- Folding tightly-coupled TDD steps (ctx elimination + params shrinking + deps dissolution) into fewer commits avoided intermediate states with broken types.
  The plan's 12-step sequence would have required lift-and-shift gymnastics; the actual 7-commit sequence was cleaner.

#### What caused friction (agent side)

- `premature-convergence` — the original plan relocated `buildParentSnapshot` calls to `execute` without questioning whether `execute` should read `ctx` at all.
  The existing `code-design` skill has DIP and parameter-relay rules that should have flagged this.
  The `service-adapter.ts` module already demonstrated the getter-injection pattern (`getCtx`, `getModelRegistry`), but I didn't search for it during plan writing.
  Impact: one plan rewrite commit (76bb57b), one reverted partial implementation (~15 minutes of rework).
  User-caught.

- `missing-context` — didn't use `colgrep` during initial plan writing to discover the established getter-injection convention in `service-adapter.ts`.
  Used `grep` exclusively for exact symbol matching.
  When prompted by the user to use `colgrep`, the results were confirmatory rather than revelatory because I'd already read the relevant files by that point.
  The miss was not using it *earlier* for intent-based exploration ("how do existing modules inject session-scoped state?").
  Impact: added friction but no rework — the user's questions surfaced the pattern before code was committed.
  User-caught.

- `instruction-violation` — wrote an inline `import()` type assertion (`session.ctx as import("@earendil-works/pi-coding-agent").ExtensionContext`) in `service-adapter.ts`.
  AGENTS.md says "Use standard top-level imports only."
  Impact: one extra edit round, caught before committing.
  User-caught.

#### What caused friction (user side)

- The user's redirecting questions were well-timed and effective.
  The escalation from "Are there any other missing collaborators?" to the more pointed "Hiding dependencies in an object bag still counts as dependencies!" was the right amount of pressure.
  No friction observed on the user side.

### Changes made

1. `.pi/prompts/plan-issue.md` — added `colgrep` skill loading to the "Load skills" section for code-change plans, so convention discovery happens during exploration rather than after committing to a design.
