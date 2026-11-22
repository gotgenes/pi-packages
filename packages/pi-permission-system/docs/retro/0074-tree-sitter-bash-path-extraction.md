---
issue: 74
issue_title: "Replace shell-quote tokenizer with tree-sitter-bash for full AST-based path extraction"
---

# Retro: #74 — Replace shell-quote tokenizer with tree-sitter-bash for full AST-based path extraction

## Final Retrospective (2026-05-04T22:15:00Z)

### Session summary

Replaced `shell-quote` with `web-tree-sitter` + `tree-sitter-bash` for bash command path extraction.
The AST-based walker eliminates heredoc false-positive external-directory prompts while correctly detecting paths in command arguments, redirects, and command substitutions.
Released as v4.2.0.

### Observations

#### What went well

- **Exploratory test script (`tree-sitter-test.mjs`)** — printing AST structures for 17 command shapes before writing the walker made the implementation land green on the first run against all 50+ existing tests.
  Three tool calls for exploration saved an estimated 5–10 debug iterations.
- **TDD step collapsing** — the plan's step 4 ("handle redirect targets if not already covered") had an escape clause.
  The step 2 walker already handled `file_redirect` nodes, and step 3's tests confirmed it immediately.
  No wasted work.
- **Minimal `TSNode`/`TSParser` interfaces** — defining local lean interfaces rather than importing `web-tree-sitter` types kept the module decoupled and aligned with the AGENTS.md rule about lean payload interfaces.
- **Smoke test for live verification** — the user asked to test live, and a quick `smoke-test.ts` with `npx tsx` demonstrated all 7 cases without needing to wire up the full extension runtime.

#### What caused friction (agent side)

- `missing-context` — Did not proactively check `docs/architecture/` for stale descriptions after the feat commit.
  User had to ask "did we update our architecture docs?" and then explicitly reference `target-architecture.md`.
  The architecture docs described the old `shell-quote`-based approach and were not in my mental checklist.
  Impact: two extra user prompts and a follow-up commit.
- `missing-context` — Tried `const Parser = (await import("web-tree-sitter")).default` which returned `undefined`.
  Had to discover that `web-tree-sitter` exports `Parser` and `Language` as named exports, not a default.
  Impact: 2 extra tool calls to debug, no rework to production code (caught during exploratory script phase).
- `scope-drift` (minor, user-directed) — The architecture doc rename to `v3-architecture.md` was beyond the #74 plan scope, but the user explicitly requested it.
  No negative impact.

#### What caused friction (user side)

- The user had to provide local paths to reference codebases (`~/development/pi/pi-mono`, `~/development/opencode/opencode/`) during planning.
  These were essential for understanding how Pi loads extensions and how OpenCode uses tree-sitter.
  Sharing them earlier (or having them in project context) would have saved one round-trip.
- The user pointing out architecture docs was valuable strategic judgment — the plan and TDD template don't mention architecture docs as an update target, and neither did AGENTS.md's alignment rule.

### Changes made

1. Added exploratory-script testing guidance to `AGENTS.md` § Testing.
2. Added `docs/architecture/` to the Module-Level Changes bullet in `.pi/prompts/plan-issue.md` so future plans flag stale architecture descriptions.
