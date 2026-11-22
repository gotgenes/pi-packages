---
issue: 108
issue_title: "refactor: extract PolicyLoader from PermissionManager"
---

# Retro: #108 — extract PolicyLoader from PermissionManager

## Final Retrospective (2026-05-07T02:00:00Z)

### Session summary

Extracted all file I/O and mtime caching from `PermissionManager` into a new `PolicyLoader` interface + `FilePolicyLoader` class.
Added 34 new tests including 25 in-memory stub tests that exercise merge and evaluation logic without touching the filesystem.
Released as v5.5.0.

### Observations

#### What went well

- The user's intervention during planning — asking to add test impact analysis (what new tests are enabled, what existing tests become redundant) — significantly improved the plan quality.
  This two-question framework ("what can we now test that we couldn't before?" / "what existing tests are now redundant?") is a reusable pattern for extraction refactors.
- The TDD cycle was notably clean for steps 1–3: all tests passed on first attempt.
  The in-memory `PolicyLoader` stub pattern worked exactly as designed, producing 25 tests that are faster, simpler, and more focused than their filesystem-dependent equivalents.
- Backward compatibility was maintained seamlessly — all 1161 pre-existing tests continued to pass after the extraction without any modifications.

#### What caused friction (agent side)

1. `wrong-abstraction` — In TDD step 2, initially used `require()` for lazy-importing `FilePolicyLoader` inside the `PermissionManager` constructor, citing "circular issues."
   There was no circular dependency risk (`policy-loader.ts` does not import from `permission-manager.ts`), and `require()` is inappropriate in an ESM project.
   Self-identified immediately; replaced with a direct static import.
   Impact: no rework commit needed — caught before the file was committed.

2. `missing-context` — In TDD step 4, wrote three tests based on wrong assumptions:
   - **Cache stamp test**: assumed `getCacheStamp()` without an agent name would differ from `getCacheStamp("missing-agent")`, but both produce `"missing"` for the agent slot when no file exists.
     Fixed by creating an actual agent file so the stamps genuinely differ.
   - **YAML frontmatter test**: used inline JSON-in-YAML syntax (`bash: { "git *": allow }`) which the simple YAML parser doesn't handle.
     Fixed by using multi-line YAML.
   - **Config issue test**: assumed an invalid permission value like `"invalid_value"` would trigger a config issue, but `normalizeUnifiedConfig` silently normalizes unknown values.
     Fixed by using malformed JSON that triggers a file-read error.
   Self-identified during test run.
   Impact: one round of test fixes within the same step, no extra commits.

#### What caused friction (user side)

- The user's request to add test impact analysis to the plan was highly valuable but came as a follow-up after the initial plan was committed.
  Integrating this as a standard section in the `/plan-issue` prompt template would avoid the extra round-trip for extraction refactors.

### Changes made

1. `.pi/prompts/plan-issue.md` — added **Test Impact Analysis** as a standard section between Module-Level Changes and TDD Order, covering new tests enabled, redundant tests, and tests that must stay.
