---
issue: 147
issue_title: "Per-tool path patterns for path-bearing tools"
---

# Retro: #147 — Per-tool path patterns for path-bearing tools

## Final Retrospective (2026-05-13T20:45:00-04:00)

### Session summary

Designed and shipped per-tool path patterns for path-bearing tools (`read`, `write`, `edit`, `find`, `grep`, `ls`) in a single session.
The design phase was the bulk of the work — exploring OpenCode's model, nested bash rules with additive evaluation, a universal `path` surface, and ultimately converging on a minimal `normalizeInput` change.
The implementation was ~10 lines of production code; the rest was tests, docs, and gate-composition verification.
Filed #148 (path-aware bash rules) as a follow-on.

### Observations

#### What went well

- **Design exploration produced a better outcome than the original issue.**
  The user's redirections ("why make external paths special?", "bash is fundamentally opaque to read vs write") steered the design away from tool-type keys in `external_directory` toward per-tool path patterns — a cleaner, more general solution.
  Two GitHub issues were filed (#147, #148) that together cover more ground than the original #144.
- **`ask_user` earned its keep.**
  Two calls surfaced genuine design forks (tool-keys-vs-path-patterns, compound-vs-simple keys).
  The user's free-text responses ("I don't actually know" / "I like the clean separation") were more valuable than any preset option.
- **Tiny implementation, large impact.**
  The change to `normalizeInput` was ~10 lines.
  The existing `evaluate()` / `evaluateFirst()` / `wildcardMatch()` machinery already supported arbitrary pattern matching — no new evaluation logic was needed.

#### What caused friction (agent side)

1. `missing-context` — Skipped `docs/configuration.md` and `docs/opencode-compatibility.md` during the docs step despite the plan's Module-Level Changes table listing 7 files.
   Updated only 4 (schema, example config, README, architecture.md).
   User caught it with "Did we update the configuration.md document too?"
   Impact: follow-up commit after CI passed and release merged. (user-caught)

2. `missing-context` — Every config example that set `"write": "deny"` or `"write": "ask"` omitted `"edit"`.
   The `edit` tool is a real Pi tool that modifies files, but it's easy to forget because it's less commonly referenced.
   User caught it with "Then shouldn't our examples show it?"
   Impact: follow-up commit touching 3 files. (user-caught)

3. `wrong-abstraction` — When asked "can the user allow reading all external paths but not `~/.ssh/*`?", I analyzed the gates in isolation and claimed there were gaps.
   The user showed the OpenCode example and I realized the two-gate composition (`external_directory` + per-tool rules) already works correctly.
   Impact: added confusion to the conversation but no rework. (user-caught)

#### What caused friction (user side)

- The user's early exploration of nested bash rules and a universal `path` surface was valuable design work, but it extended the design phase significantly before converging on the simpler per-tool path patterns scope.
  This was appropriate given the design space, but earlier convergence on "what's the minimal viable scope?" could have shortened the session.
  Not a criticism — the exploration produced #148 as a well-scoped follow-on.

### Changes made

1. `.pi/prompts/tdd-plan.md` — Added explicit cross-check step (step 4) in "After the last TDD step": verify all files listed in the plan's Module-Level Changes table were actually touched.
2. `AGENTS.md` — Added rule: when a config example sets a policy for `write`, include the same policy for `edit`.
