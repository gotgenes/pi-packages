---
issue: 426
issue_title: "pi-subagents: consolidate residual test clone families"
---

# Retro: #426 — pi-subagents: consolidate residual test clone families

## Stage: Planning (2026-06-18T17:48:42Z)

### Session summary

Produced a numbered plan (`docs/plans/0426-consolidate-residual-test-clone-families.md`) for consolidating the residual test clone families in four named `pi-subagents` test files.
Ran `fallow dupes` to enumerate the live clone groups: 24 test clone groups package-wide, of which the four target files (`test/settings.test.ts` + `test/layered-settings.test.ts`, `test/lifecycle/create-subagent-session.test.ts`, `test/ui/agent-config-editor.test.ts`) contribute exactly 10 — consolidating them lands at 14, below the issue's `<15` target.
The plan is a test-only refactor verified by the existing suite staying green plus a falling fallow clone count; the follow-up is `/build-plan` (no red→green behavior cycles).

### Observations

- Release: ship independently — the Phase 18 roadmap step 7 carries no `Release: batch` tag and is explicitly "independent of the disentanglement spine."
- The `testing` skill's rule "do not wrap the system-under-test call in a helper to eliminate a duplication-metric clone" drove the design: consolidate *arrange* only, keep every `loadSettings`/`createSubagentSession`/`showAgentDetail` act written out.
  For `agent-config-editor` menu cases, `it.each` is the right tool — it keeps the act visible in the table body rather than hiding it in a helper.
- Three independent consolidations: (1) a new shared `test/helpers/tmp-settings-dirs.ts` fixture for the cross-file settings tmp-dir scaffolding (with paired self-test, per the `test/helpers/*.test.ts` convention); (2) file-local `arrangeFactory`/`defaultDeps` for the `create-subagent-session` post-bind-guard block; (3) `it.each` table + hoisted `filePath` for `agent-config-editor`.
- Scope deliberately excludes: the production clone in `src/ui/agent-config-editor.ts` (test-only issue), the cross-package `vitest.config.ts` clone, the `5d8dbd48` group spanning `subagent-manager.test.ts` ↔ `subagent.test.ts` (neither is a target file), and all other non-target test clone families.
- Key risk flagged for build: removing inline `writeGlobal`/`writeProject` may orphan fs imports (`mkdtempSync`/`rmSync`/`mkdirSync`/`writeFileSync`/`tmpdir`/`join`); Biome `noUnusedImports` is warning-level, so step 4 runs `pnpm fallow dead-code` as the backstop.
- Markdown lint gotcha hit during planning: bare `#N` inline mentions are fine, but reference-style `[#N]` link defs trip `MD053` unless a matching bracket reference exists in the body — kept only the `[#427]` cross-link def.

## Stage: Implementation — Build (2026-06-18T18:14:01Z)

### Session summary

Executed all four refactor steps plus the architecture doc-flip across four commits.
Extracted two shared test fixtures (`test/helpers/tmp-settings-dirs.ts`, `test/helpers/capture-warn.ts`, each with a paired self-test) and table-drove the `create-subagent-session` post-bind and `agent-config-editor` menu/confirm-remove cases into `it.each`.
Dropped pi-subagents test clone groups from 24 to 14 (below the `<15` target); full suite green at 1047 tests (was 1038), type check and lint clean, `fallow dead-code` clean.

### Observations

- Pre-completion reviewer: PASS (deterministic checks, assertion-strength preservation, act-visibility, and no-coverage-drop all verified).
- Deviation 1 — the settings fixture exposes a `dispose()` method instead of the plan's separate `disposeSettingsDirs()` function (Tell-Don't-Ask; the fixture disposes itself).
- Deviation 2 — added `test/helpers/capture-warn.ts` (`captureWarn`) beyond the plan's tmp-dir-only fixture.
  The plan's Step 1 verify listed clone group `4003c0e7` (the `console.warn` spy try/finally boilerplate) as expected-gone, but the tmp-dir fixture alone did not address it; the warn-capture helper does, and migrating the spy tests in both files cleared it.
  Squarely within the issue's "extract shared fixtures for the clone families" intent.
- Deviation 3 — Step 2's first pass (arrange helpers only) left a transient arrange+assert clone (`62899223`) between the two adjacent post-bind membership tests; folding the three membership cases into one `it.each` with a strong `toEqual` (replacing the prior `toContain` checks) cleared it.
- Used destructure-to-locals in `settings.test.ts`/`layered-settings.test.ts` (e.g. `({ globalDir: agentDir, projectDir: cwd, ... } = dirs)`) rather than the plan's `dirs.X` member-access sketch — keeps the existing terse test bodies unchanged and lowers edit risk.
- Dropped one brittle `captureWarn` self-test ("suppresses real stderr") that was actually exercising `vi.spyOn`'s restore-to-original semantics with nested spies, not the helper's behavior.
- The risk flagged at planning (orphaned `node:fs`/`node:os` imports after removing inline `writeGlobal`/`writeProject`) materialized only in `layered-settings.test.ts` (`mkdtempSync`/`rmSync`/`tmpdir`/`vi` became unused); removed them, and `fallow dead-code` confirmed clean.

## Stage: Final Retrospective (2026-06-18T18:31:04Z)

### Session summary

Planned, built, and shipped #426 in one continuous session: extracted two shared test fixtures (`tmp-settings-dirs.ts`, `capture-warn.ts`) and table-drove four clone families into `it.each`, dropping pi-subagents test clone groups from 24 to 14.
CI green, issue closed, no release cut (all `test:`/`docs:` commits batch until the next `feat`/`fix`).
Execution was clean overall; the one recurring friction was the plan over-predicting which clone fingerprints each change would clear.

### Observations

#### What went well

- **Metric-driven feedback loop.**
  Each build step re-ran `pnpm fallow dupes` and checked the targeted fingerprints (`21d1fb01`, `4003c0e7`, `48ff1484`, …) disappeared before committing.
  This caught the two prediction gaps (below) immediately rather than at pre-completion, and turned a fuzzy "reduce duplication" goal into a precise per-step pass/fail.
- **`it.each` strengthened assertions while consolidating.**
  Folding the `create-subagent-session` post-bind cases into a table let the merged test assert `toEqual(expected)` on the full post-bind set, replacing the prior weaker `toContain` checks — consolidation improved coverage rather than just moving lines.
- **Pre-completion reviewer verified the real risk.**
  For a test-refactor the central risk is silent coverage loss; the reviewer explicitly confirmed former-`it`-count equals row-count for every `it.each` and that each act stayed explicit.
  PASS with nothing to fix.

#### What caused friction (agent side)

- `missing-context` (planning) — the plan's Step 1 *verify* listed clone group `4003c0e7` (the `console.warn` spy try/finally boilerplate) as expected-gone, but the Step 1 *design* only described the tmp-dir fixture, which does not touch that clone.
  The build discovered the gap and added `capture-warn.ts` + migrated ~7 spy tests mid-step.
  Impact: one unplanned helper (with self-test) folded into the same commit; no follow-up commit, but the plan-vs-build mismatch was real.
- `wrong-abstraction` (build, self-corrected) — Step 2's first pass applied arrange helpers (`arrangeFactory`/`defaultDeps`) alone, which left a *new* transient clone (`62899223`) between the two adjacent post-bind tests.
  Folding the three membership cases into one `it.each` cleared it.
  Impact: one extra edit+verify iteration within the step; caught by the same-step `fallow dupes` run.
- `other` (build, trivial) — wrote a brittle `captureWarn` self-test ("suppresses real stderr") that asserted `vi.spyOn` nested-restore semantics rather than the helper's behavior; the test failed immediately and was dropped.
  Impact: ~2 tool calls, no rework downstream.
- `other` (ship, trivial) — `git log | grep -P` failed on macOS BSD grep; retried with `grep -o`.
  Impact: one retry.

#### What caused friction (user side)

- None.
  The session ran end-to-end (plan → build → ship → retro) without a mid-course correction; the prompts carried enough structure that no strategic intervention was needed.

### Diagnostic details

- **Model-performance correlation** — the entire `/ship-issue` stage ran on `opencode-go/deepseek-v4-flash` (a reasoning-weak model), covering judgment-bearing steps: release-coordination decision, stacked-release detection, and close-comment synthesis.
  It executed correctly because `/ship-issue` is heavily proceduralized (deterministic checks, explicit decision tree), so the weak model followed the rails without error.
  Planning/build ran on stronger models (`opus-4-8`/`sonnet-4-6`); retro on `opus-4-8`.
  No quality defect resulted, but ship-issue does carry real judgment — worth noting that its proceduralization is what absorbed the model mismatch.
- **Escalation-delay tracking** — no `rabbit-hole`; the two prediction-gap fixes resolved in 1–2 tool calls each via the per-step `fallow dupes` check.
  No sequence exceeded the 5-call flag.
- **Unused-tool detection** — none needed; scope was small and fully understood from the planning-stage file reads.
  `fallow dupes` was the right and sufficient tool.
- **Feedback-loop gap analysis** — verification ran *incrementally*: `pnpm run check` + `vitest run <file>` + `pnpm fallow dupes` after every step, full suite + `fallow dead-code` at the end.
  No end-only verification gap.

### Changes made

1. `.pi/prompts/plan-issue.md` — added a cross-section consistency rule under **Module-Level Changes**: when a plan step's verify criterion names a static-analysis finding (clone fingerprint, dead-code symbol, complexity target) as resolved, the design or Module-Level Changes must map the change that clears it.
   Motivated by the Step 1 `4003c0e7` prediction gap (the verify step listed it as expected-gone but the design did not address it, forcing the mid-build `capture-warn.ts` addition).
