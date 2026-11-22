---
issue: 35
issue_title: "Align #21 test files with updated mock-cleanup and node:* default-export rules"
---

# Retro: #35 — Align #21 test files with updated mock-cleanup and node:\* default-export rules

## Final Retrospective (2026-05-03T05:58:17Z)

### Session summary

Planned, implemented, and shipped a test-infrastructure cleanup that brought four test files written in #21 into conformance with two AGENTS.md rules added during the #21 retro.
All four files were updated in four atomic commits; `npx vitest run` and `npm run build` stayed green throughout; the release-please PR for v3.0.2 was merged at the end.

### Observations

#### What went well

- **Nuance caught at plan time, not implementation time.**
  The plan identified upfront that `compileWildcardPatterns` has a non-trivial default implementation in its `vi.mock()` factory (it transforms a patterns object into a compiled array), and that `mockReset()` would wipe it — meaning `mockClear()` was the right call for that stub while `mockReset()` was fine for the others.
  Catching this during planning prevented a mid-implementation red-herring debugging pass.

- **Atomic per-file commits.**
  One commit per test file made the CI history clean and each step independently revertable.

#### What caused friction (agent side)

None observed.
The issue was tightly scoped, the plan was accurate, and the implementation matched the design exactly.

#### What caused friction (user side)

- The user asked whether the `mockClear` vs `mockReset` distinction was from authoritative sources before confirming the AGENTS.md sharpening.
  The existing rule wrote `(or .mockClear())` parenthetically without explaining when to choose either option, which left room for doubt.
  Impact: one extra round-trip before the retro change was confirmed; no rework.

### Broader pattern

This issue was a retroactive cleanup of rules added during the #21 retro.
The sequence — (1) add rule to `AGENTS.md`, (2) notice existing files violate it, (3) file a follow-up issue — is the correct pattern.
One refinement worth noting: the moment a new testing rule is added to `AGENTS.md`, a quick scan for pre-existing violations and an immediate follow-up issue (if any are found) would collapse steps 2 and 3 into the retro that adds the rule.

### Changes made

1. Sharpened the `mockReset` vs `mockClear` rule in `AGENTS.md` § Testing (lines 107–109): replaced the parenthetical "(or `.mockClear()`)" with two explicit sentences explaining when to use each, sourced from official Vitest documentation.
2. Created `docs/retro/0035-align-test-mock-cleanup-rules.md` (this file).
