---
issue: 505
issue_title: "pi-permission-system: dissolve the path-utils grab-bag behind AccessPath (Phase 7 Step 4)"
---

# Retro: #505 — Dissolve the `path-utils` grab-bag behind AccessPath (Phase 7 Step 4)

## Stage: Planning (2026-06-29T00:00:00Z)

### Session summary

Produced a numbered plan to dissolve `src/path-utils.ts` (18 symbols, four jobs, accelerating churn hotspot) into six cohesive modules.
Representation derivation relocates into `src/access-intent/path-normalization.ts` as `AccessPath`'s backing; both containment predicates stay together in a focused `src/path-containment.ts`; safe-system paths, infra-read, tool-input extraction, and the surface/tool lookup sets each get their own module.
The plan is `Release: independent` (a `refactor:`/`docs:` change that auto-batches into the next release).

### Observations

- **The "import cycle" the naïve split implies is not fundamental.**
  The operator pushed back on my "derivation vs containment" framing, observing that you should *prepare the data, then ask questions about it* — geometry should not depend on derivation.
  Tracing it: `isPathWithinDirectory` is already pure geometry over prepared operands, and `isPiInfrastructureRead` already receives an already-canonical `accessPath.boundaryValue()`.
  The lone offender is `isPathOutsideWorkingDirectory`, which canonicalizes both operands inline (the only geometry→representation edge).
  Fixing that mis-factoring — pure geometry over prepared operands, with canonicalization pushed up to its single caller `PathNormalizer.isOutsideWorkingDirectory` — collapses the tangle into a strict DAG **and** lets the issue's literal grouping stand (one representation module, one containment module).
- **Everything in `path-utils.ts` is access-side, not config-side.**
  Config rule patterns are never path-derived (a standing Phase 7 Non-goal), so the real seam is representation-for-matching vs geometry-for-boundaries, sharing the `isPathWithinDirectory` primitive.
- **Step 1 is a real behavior-contract change (TDD red→green); Steps 2–7 are pure relocations** verified by the existing suite staying green after each move + importer update.
  `path-utils.test.ts` (695 LOC) splits to mirror the new modules; the `isPiInfrastructureRead` block duplicated with `pi-infrastructure-read.test.ts` consolidates.
- **Doc surface to keep in sync** (implementation doc commit, not deferred to ship): `architecture.md` module tree + Phase 7 Step 4 ✅ + Mermaid `S4` node + findings metric + the "PathNormalizer platform seam" prose, and `SKILL.md`'s two `src/path-utils.ts` references.
  `history/phase-6-*.md` is a frozen snapshot — not edited.
- **Guardrails confirmed:** no `import/no-cycle` lint exists (so the cycle is a design smell, not a CI gate), but the `no-restricted-syntax` `process.platform` guard does — every relocated leaf keeps its injected `platform` parameter.
  `subagent-context.ts` has its own private within-dir helper and is out of scope.
- Next stage: `/tdd-plan` (Step 1 is true TDD; the rest are refactor-relocation steps).

## Stage: Implementation — TDD (2026-06-29T22:00:00Z)

### Session summary

Executed all 8 TDD steps as planned, in one session, with no deviations.
`src/path-utils.ts` is fully dissolved into six cohesive modules (`access-intent/path-normalization.ts`, `path-containment.ts`, `safe-system-paths.ts`, `pi-infrastructure-read.ts`, `tool-input-path.ts`, `path-surfaces.ts`); the 695-LOC `path-utils.test.ts` split to mirror them.
Final state: 109 test files / 2194 tests green (net −8 from baseline 2202 — the `isPiInfrastructureRead` duplicate block consolidated into `pi-infrastructure-read.test.ts`, +3 unique win32 cases re-added, +2 from a new `PATH_SURFACES` describe).

### Observations

- **Step 1's red was nearly hollow** — the `isPathOutsideWorkingDirectory` signature change kept the same arity (3 strings), so value-based tests pass against both old and new code.
  The genuine discriminator is behavioral: the pure function must **not** call `realpathSync` (`expect(realpathSync).not.toHaveBeenCalled()`).
  That assertion failed on old code (2 realpath calls) and passed on new — a real red, per the `testing` skill's "hollow red" warning.
- **Steps 2–7 are relocations, not red→green** — the existing suite is the safety net; each step moved code + updated importers + carried the `describe` block to its new test file, staying green.
  `pnpm run check` (TS2305 on a mis-pointed import) was the real guard, run after each step.
- **The cycle stayed dissolved exactly as planned** — because Step 1 made `isPathOutsideWorkingDirectory` stop calling `canonicalNormalizePathForComparison`, the residual `path-containment.ts` has no representation import, and `path-normalization.ts` imports only the `isPathWithinDirectory` primitive downward.
  Strict DAG; no `import/no-cycle` lint needed to confirm (none exists).
- **`git mv` for Step 7** preserved history for both `path-utils.ts→path-containment.ts` and the test rename.
  `pnpm fallow dead-code` clean (all moves keep their consumers).
- **One autoformat-reflow snag**: a multi-edit `Edit` on `path-utils.test.ts` was rejected because the formatter had reflowed an `expect(...)` onto one line; fell back to a line-ranged `sed` deletion, then re-read to confirm.
  No content lost.
- **Pre-completion reviewer: PASS** — all deterministic checks green (check / lint / 2194 tests / fallow), Mermaid validated via `mmdc`, cross-step invariants (#502/#503/#382/#418/#510/#511) confirmed intact, no stale `path-utils` references in `src`/`test`.
  No WARN/FAIL findings.

## Stage: Final Retrospective (2026-06-30T00:00:00Z)

### Session summary

Shipped #505 end-to-end across planning, TDD, and ship stages: `src/path-utils.ts` dissolved into six cohesive modules, 8 clean commits, pre-completion PASS, CI green, issue closed.
The standout of the whole arc was a planning-stage course-correction by the operator that turned an apparent unavoidable import cycle into a strictly-better DAG honoring the issue's literal module grouping.
The only friction was a ship-stage misprediction of whether release-please would cut a patch, rooted in an oversimplified line in the ship prompt.

### Observations

#### What went well

- **Bidirectional win (the standout)** — during planning I surfaced the "how to break the derivation↔containment cycle" decision via `ask_user` with three module-layout options.
  The operator did not pick one; they asked a *redirecting question* ("why would the implementation of geometry rely on derivation?
  prepare your data, then ask questions about it").
  That reframing revealed the cycle was an artifact of one mis-factored function (`isPathOutsideWorkingDirectory` canonicalizing inline), not fundamental.
  The resulting design is strictly better — a clean DAG that *also* satisfies the issue's literal "one representation module, one containment module" grouping.
  The `ask_user` gate is what made the intervention possible; without surfacing the ambiguity, the operator had nothing to push on.
- **Exemplary incremental verification** — `pnpm run check` plus the targeted `vitest run <file>` ran after *each* of the 8 TDD steps, not just at the end; full suite + root lint + `fallow dead-code` at the close.
  A mis-pointed relocation import would have surfaced as `TS2305` within the same step.
  No feedback-loop gap.
- **"Hollow red" anticipated** — Step 1's signature change kept the same arity (3 strings), so a value-based test would pass against both old and new code.
  I added a behavioral discriminator (`expect(realpathSync).not.toHaveBeenCalled()`) that genuinely failed on the old code — per the `testing` skill's hollow-red warning.

#### What caused friction (agent side)

- `missing-context` — At ship step 4b I predicted release-please *would* cut a patch because the `docs(pi-permission-system):` commit touched `.pi/skills/package-pi-permission-system/SKILL.md`, a "non-excluded path."
  That was wrong: release-please attributes commits to a package only by the `packages/<pkg>/` path prefix, and `.pi/skills/` lives *outside* the package tree, so it is attributed to no package.
  The commit's only in-package file (`docs/architecture/architecture.md`) is in `exclude-paths`.
  Release-please correctly reported "No user facing commits found — skipping," matching the plan's prediction but contradicting my step-4b reasoning.
  Impact: ~5 extra tool calls after `release_pr_find` timed out (`gh pr list`, `ci_list`, two `gh run view --log | grep` passes — the second a very large CI-log read) to rediscover what the plan already stated.
  No rework; wasted effort and context budget.
  Self-identified (worked it out from the log), but rooted in an oversimplified line in `.pi/prompts/ship-issue.md` step 4b ("a `docs:` commit on a non-excluded path **does** cut a patch").

### Diagnostic details

- **Feedback-loop gap analysis** — no gap.
  Verification was incremental (check + targeted test after every step), the ideal pattern; flagged here only as a positive baseline.
- **Escalation-delay tracking** — the ship-stage release investigation ran ~5 consecutive read-only tool calls on the same question before concluding.
  Under the 5-call dispatch threshold and it was investigation, not error-chasing, but the answer was already in the plan and the ship prompt's step-4b intent — the dig was avoidable with a crisper prompt rule (below).
- **Model-performance correlation** — one subagent dispatch (the `pre-completion-reviewer`) doing judgment-heavy work (acceptance criteria, design review, cross-step invariants); appropriate model for the task, no mismatch.
  Nothing else notable.

### Changes made

1. `.pi/prompts/ship-issue.md` (step 4b) — replaced the line "a `docs:` commit on a non-excluded path **does** cut a patch" with a package-prefix-aware rule: a `docs:` commit cuts a patch only when it touches a non-`exclude-paths` file *under `packages/<pkg>/`*; files outside the package tree (`.pi/skills/`, root `AGENTS.md`/`README.md`) are attributed to no package and auto-batch.
   Prevents the ship-stage misprediction documented above.
