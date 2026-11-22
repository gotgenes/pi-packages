---
issue: 110
issue_title: "refactor: split external-directory.ts into focused modules"
---

# Retro: #110 — split external-directory into focused modules

## Final Retrospective (2026-05-07T16:15:00Z)

### Session summary

Split `src/external-directory.ts` (~760 lines, 4 concerns) into `src/node-modules-discovery.ts`, `src/path-utils.ts` (extended from #109), `src/handlers/gates/external-directory-messages.ts`, and `src/handlers/gates/bash-path-extractor.ts`.
Initially preserved the original file as a barrel re-export; the user's post-ship question exposed the barrel added no value, leading to a follow-up commit that deleted it and colocated gate-specific modules with their consumers.
Released as v5.6.3 with zero behavioral change.

### Observations

#### What went well

- **Sequencing with #109 paid off.**
  The user asked whether to do #109 or #110 first; recommending #109 first meant `path-utils.ts` already existed when #110 started, eliminating a `path-classification.ts` that would have been immediately renamed.
- **TDD extraction was clean.**
  5 steps, all green at every commit.
  The incremental extract-then-re-export-from-barrel pattern meant no downstream test ever broke during the extraction.
- **Post-ship review caught the real abstraction gap.**
  The user's question "is what we really need a higher level abstraction?" took ~10 minutes of import analysis to answer definitively.
  The follow-up commit was small (12 files, +24/−49 lines) because the extraction was already done — only import paths changed.

#### What caused friction (agent side)

- `premature-convergence` — The plan specified "keep `external-directory.ts` as a barrel re-export" without analyzing whether any consumer actually needed the aggregation.
  Every consumer used symbols from 1–2 underlying modules; no consumer needed all 20+ symbols together.
  The barrel was "these things used to be in one file" masquerading as an API boundary.
  Impact: one extra commit after the issue was closed and shipped, plus re-running CI.
  User-caught.
- `instruction-violation` — Wrote `#109` at the start of a markdown line in the updated plan, which markdownlint parsed as an ATX H1 heading (same issue as #109 retro).
  Required a commit retry after the pre-commit hook caught it.
  Impact: one failed commit attempt, minor.
  Self-identified via hook output.

#### What caused friction (user side)

- The user's post-ship question was the most valuable intervention in the session — it transformed a mechanical refactoring into a module-placement decision.
  Earlier involvement (e.g., during planning) could have avoided the barrel entirely, but the cost was low since the follow-up was small.
