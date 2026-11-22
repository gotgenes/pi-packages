---
issue: 321
issue_title: "Continue shared test-fixture extraction for the largest clone families"
---

# Retro: #321 — Continue shared test-fixture extraction for the largest clone families

## Stage: Planning (2026-06-03T21:30:00Z)

### Session summary

Produced a numbered build plan (`docs/plans/0321-continue-shared-test-fixture-extraction.md`) for migrating the four largest remaining test clone families onto the shared `test/helpers/` fixtures.
Grounded the four families in a live `fallow dupes` run (133 clone groups, 7.6%) and confirmed by reading each file that all four already import the shared fixtures — the remaining clones are duplicate local factory definitions plus repeated override expressions, not unmigrated files.
This is a pure test refactor (no `src/` changes), so the next stage is `/build-plan`, with migrate → full-suite-green → commit cycles.

### Observations

- One `ask_user` design decision: how aggressively to extend the shared fixture API.
  User chose **both** — consolidate the duplicate factories AND add convenience shortcuts (`makeSurfaceCheck`, `makeBashCommandCheck`, `makeDenialDescriptor`, `makePathDispatchResolver`, a `makeGateRunner` `resolveResult` option, and a `makeHandler` `tools` shortcut) to hit the sub-6% target.
- Key correctness risk identified: the local `makeSession` in `external-directory-integration.test.ts` diverges from the shared one in two defaults (`getInfrastructureReadDirs` → `[]` vs `["/test/agent", …]`; `checkPermission` → deny vs neutral allow).
  Analysis shows both differences are moot for that file's tests (explicit `checkPermission` everywhere; infra dirs never intersect test paths), but the full-suite green gate after the ext-dir step is the verification.
- Applied the code-design "structural reasons before extracting duplication" heuristic to fence off genuine per-test intent that must stay inline: the per-agent `agentAwareCheck`, `toolName`-alias event literals, multi-condition path dispatch, and the bash regex/pattern values.
- Discovered `makeTcc()` already defaults `input` to `{ command: "cat .env" }`, so many `bash-path.test.ts` clones collapse to a bare `makeTcc()` with no new helper.
- The production refactors this step is "best sequenced after" ([#314], [#317]–[#320]) have all landed — the shared fixtures already import their outputs (`PermissionResolver`, `GateRunner`, the two pipelines, `GateDecisionReporter`), so no soft dependency blocks the work.
- Carried forward the [#288] recurring friction as an explicit per-step instruction: grep each removed symbol before committing, because a stale value import passes `tsc` and the `lint` exit code but is a biome warning.
- Scope guard: `external-directory-session-dedup.test.ts` shares the local-`makeSession` clone family but is the fifth file, outside the issue's named four; flagged as a conditional follow-up issue if the sub-6% target is missed, not scope creep here.

[#288]: https://github.com/gotgenes/pi-packages/issues/288

## Stage: Implementation — Build (2026-06-03T11:40:00Z)

### Session summary

Completed all 5 build steps from the plan: runner gate migration (Step 1), bash-path gate migration (Step 2), tool-call handler migration (Step 3), external-directory integration migration (Step 4), and docs refresh (Step 5).
Test count held steady at 86 files / 1834 tests throughout — pure refactor, no assertions changed.
Pre-completion reviewer returned PASS.

### Observations

- **Step 1** Fixed a TS2783 (`state` specified twice) in the `makeSurfaceCheck` implementation in `handler-fixtures.ts`; resolved by removing the redundant explicit `state: base.state` before the spread, letting `...base` cover it.
  One extra check+fix cycle.
- **Step 2** A pre-commit eslint hook reformatted `gate-fixtures.ts` on the first commit attempt (exit 1); re-staged the auto-fixed file and committed cleanly.
- **Steps 3–4** `makeSurfaceCheck` and `makeExtDirCheck` (a local thin wrapper in `external-directory-integration.test.ts`) replaced the surface-dispatch boilerplate cleanly; no assertion changes needed.
  The shared `makeSession` default `getInfrastructureReadDirs` (`[\u201c/test/agent\u201d, ...]`) did not intersect any ext-dir test path, confirming the planning analysis.
- **Target miss**: duplication landed at 6.6% (122 clone groups), not under 6%.
  The remaining gap is the `external-directory-session-dedup.test.ts` family (local `makeSession`/`makeToolRegistry` clones across ext-dir + session-dedup + handler-fixtures), which was out of the four-file scope.
  A follow-up issue should be filed per the plan’s Open Questions.
- No stale imports or `GateDescriptor`/`makeCheckPermission`/`makeDenialContextDescriptor` leaks found at any step.
- **Reviewer verdict**: PASS — all deterministic checks green, new helpers documented in `SKILL.md`, architecture roadmap updated.

[#314]: https://github.com/gotgenes/pi-packages/issues/314
[#317]: https://github.com/gotgenes/pi-packages/issues/317
[#320]: https://github.com/gotgenes/pi-packages/issues/320

## Stage: Final Retrospective (2026-06-03T22:30:00Z)

### Session summary

Single-day execution of the full lifecycle (plan → build → ship) for the four-family test-fixture extraction.
All 5 build steps landed green with the suite holding at 86 files / 1834 tests, duplication dropped 7.6% → 6.6% (clone groups 133 → 122), and the pre-completion reviewer returned PASS.
No release-please PR was opened because the change is entirely `test:`/`docs:` commits; the issue closed cleanly with no version bump.

### Observations

#### What went well

1. The [#288] recurring friction — stale imports after deleting local factory definitions — was carried forward from the prior retro into the [#321] plan as an explicit per-step instruction (“grep each removed symbol before committing”).
   The build session then had **zero** stale-import slips: every deletion step ran a verifying `grep` (msgs 38, 47, 62) and found only legitimate survivors (`makeResolver`) or doc-comment references.
   This is a prior retro observation closing the loop — a documented friction pattern eliminated by a planning adjustment.
2. The upfront `ask_user` in planning (one decision: “both” — consolidate factories AND add convenience shortcuts) produced zero design churn across all 5 build steps; every helper the plan named was used as specified.
3. Incremental verification was clean: `pnpm run check` + `vitest run` ran after every build step (msgs 37, 46, 53/55, 61, 74), so each commit left the suite green with no broken-baseline commits.
4. The `code-design` “structural reasons before extracting duplication” heuristic was applied at plan time to fence off genuine per-test intent (per-agent `agentAwareCheck`, `toolName`-alias events, multi-condition path dispatch), so no shared helper became a discriminator-laden leaky abstraction.

#### What caused friction (agent side)

1. `other` (tooling) — a `fallow dupes --json` attempt during planning (msg 13) returned exit 2 with an empty file; `fallow` also truncates its plain-text output to the top 10 clone groups, so a follow-up `tee` to capture the full list also came up short (msg 15, error).
   The agent recovered by reading the four target files directly instead of relying on `fallow`'s per-file clone breakdown.
   Impact: ~3 extra exploratory tool calls in planning; no rework, and the direct reads were the higher-fidelity path anyway.
2. `other` (mechanical) — a TS2783 (`state` specified more than once) in the new `makeSurfaceCheck` (msg 53): the explicit `state: base.state` was redundant with the trailing `...base` spread.
   Caught immediately by the post-step `pnpm run check`, fixed in one edit (msg 54).
   Impact: 1 extra check+fix cycle (~2 tool calls); no rework beyond the single line.
3. `other` (tooling) — the first commit of step 2 (msg 48) failed because the pre-commit eslint hook reformatted `gate-fixtures.ts` (import sort); re-staging the auto-fixed file and re-committing succeeded (msg 50).
   Impact: 1 extra add+commit cycle; no rework.

#### What caused friction (user side)

1. None substantive.
   The two `Continue.` nudges in the build session (msgs 42, 45) were mechanical pacing prompts, not redirections — the work was on-track (mid-step-2 migration) at each.

#### Estimation gap (not friction)

1. The plan's stated target was duplication < 6%; the realized figure was 6.6%.
   The gap was foreseen in planning (`external-directory-session-dedup.test.ts` was explicitly scoped out as a fifth family) and handled correctly at build time — the architecture roadmap records the realized 6.6%, and the residual session-dedup family is flagged for a follow-up issue.
   No correction needed; this is an accurate-estimate-with-documented-shortfall, not a miss.

### Diagnostic details

- **Model-performance correlation** — no mismatches.
  Planning + retro ran on `claude-opus-4-8` (judgment-heavy: design decision, plan synthesis, cross-stage retro), the build on `claude-sonnet-4-6` (mechanical migration with type-checking), the pre-completion reviewer subagent on `anthropic/claude-sonnet-4-6` (judgment-heavy review), and shipping on `opencode-go/deepseek-v4-flash` (deterministic checklist).
  Each model matched its task complexity; the cheap flash model on the mechanical ship checklist is appropriate cost optimization.
- **Escalation-delay tracking** — no `rabbit-hole` friction points; the two mechanical issues (TS2783, eslint hook) each resolved in a single cycle, well under the 5-call threshold.
- **Unused-tool detection** — `colgrep` was not used despite the planning prompt recommending it, but the agent knew exact symbol names (`makeSession`, `makeCheckPermission`, etc.), so `grep` and direct file reads were the correct lower-latency choice; no missing-context friction resulted.
- **Feedback-loop gap analysis** — no gaps.
  Verification ran incrementally after each of the 5 build steps, not just at the end.

### Changes made

1. Appended this Final Retrospective stage entry to `packages/pi-permission-system/docs/retro/0321-continue-shared-test-fixture-extraction.md`.
   No prompt or `AGENTS.md` changes — the user chose retro-file-only; the single tooling candidate (a `fallow dupes` truncation/`--json` note) was a single self-recovered instance below the bar for a new rule, recorded here only.
