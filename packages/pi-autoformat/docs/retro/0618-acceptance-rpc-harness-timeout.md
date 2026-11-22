---
issue: 618
issue_title: "pi-autoformat: real-CLI acceptance tests flake under concurrent workspace test runs"
---

# Retro: #618 — Real-CLI acceptance harness timeout

## Stage: Planning (2026-05-24T00:00:00Z)

### Session summary

Planned the fix for the real-`pi`-CLI acceptance flake: the harness `timeoutMs = 10_000` in `test/helpers/rpc.ts` blows under `pnpm -r run test` cross-package contention.
The operator chose direction A (raise the harness timeout) with an env-overridable raised default.
Plan raises the default to 30 s, adds an env-parameterized `resolveRpcTimeoutMs` / `rpcVitestTimeoutMs` seam gated on `PI_AUTOFORMAT_RPC_TIMEOUT_MS`, derives each acceptance file's Vitest budget from the harness timeout plus a margin, and documents the knob in `docs/testing.md`.

### Observations

- Issue #67 already touched this surface but explicitly deferred the harness `timeoutMs` change ("Non-Goals: Changing `runRpcSession`'s internal `timeoutMs` default") — #618 is that deferred decision.
  Issue #67's "Vitest budget must exceed harness budget" invariant lived only in plan prose; this plan makes it structural (budget = harness + margin) and pins it with a unit assertion.
- Two files spawn the real CLI (`acceptance.test.ts`, `acceptance-event-bus.test.ts`) — matching the "2 flakes" in the #596/#597 retros.
  `fallback-acceptance.test.ts` is named "acceptance" but does not spawn the CLI, so it is out of scope.
- Rejected directions: retry-once (B) adds control flow and doubles worst-case failure time; in-package serialization (C) cannot fix cross-package contention since `pnpm -r` runs each package's vitest as its own process.
  Both noted as future levers in Non-Goals; the cross-package root cause is mitigated, not removed.
- Release: ship independently — the substantive change is `test:`-scoped (hidden changelog type); the shipped `docs/testing.md` update (`docs(pi-autoformat):`, `docs/*.md` is in the `files` allowlist) is the unhidden type that carries the release.
- Env name follows the package's `PI_AUTOFORMAT_` convention (`PI_AUTOFORMAT_RECORDER_LOG`, `PI_AUTOFORMAT_LLM_TESTS`).
- No architecture roadmap exists for pi-autoformat, so no `✅` step-mark / Mermaid node doc update applies.

## Stage: Implementation — TDD (2026-05-24T00:00:00Z)

### Session summary

Implemented all three planned TDD steps: added an env-overridable `resolveRpcTimeoutMs`/`rpcVitestTimeoutMs` seam to `test/helpers/rpc.ts` (10 new unit tests), wired both real-CLI acceptance tests (`acceptance.test.ts`, `acceptance-event-bus.test.ts`) to derive their Vitest budgets from it, and documented the `PI_AUTOFORMAT_RPC_TIMEOUT_MS` override in `docs/testing.md`.
Test count rose from 296 to 306 (`+10`, all in the new `rpc.test.ts`); no existing tests changed behavior.

### Observations

- The green-baseline check reproduced the exact flake this issue targets: `pnpm run test` (root, concurrent) failed both real-CLI acceptance tests with `timed out after 10000ms`/`15000ms`, while a standalone `pnpm --filter @gotgenes/pi-autoformat exec vitest run` of the same two files was green.
  Treated this as confirming (not blocking) the baseline, per the plan's own problem statement, rather than a pre-existing unrelated failure to fix first.
- The Tidy-First assessor found nothing to prepare — the change is small and localized (two pure functions, a one-line default swap, two literal-to-call-site swaps, an additive docs subsection) with no existing structural strain.
- After the full change, `pnpm run test` at the repo root was green on the first post-implementation run (no flake reproduced) — expected, since 30 s + margin gives much more headroom than 10-15 s, though this single run is not proof the flake is gone under all load conditions.
- No deviations from the plan; all TDD steps and Module-Level Changes landed exactly as designed.
- Pre-completion reviewer: **PASS**.
  One WARN: the plan's Non-Goals names three deferred alternatives (retry-once, in-package serialization, workspace-level `pnpm -r` serialization) with no filed issue number — non-blocking since they were framed as rejected/deferred alternatives, not committed follow-up work, but worth filing if the 30 s default later proves insufficient.

## Stage: Final Retrospective (2026-07-19T00:32:09Z)

### Session summary

Ran Planning, TDD, and Ship for #618 in one continuous session, landing `pi-autoformat` 5.1.7.
The change (env-overridable 30 s RPC harness timeout, structural Vitest-budget derivation, documented `PI_AUTOFORMAT_RPC_TIMEOUT_MS` knob) landed exactly as planned with no rework; the only friction was a self-inflicted tool-call detour during the release-PR merge and an over-broad `git log` in the stacked-release check.

### Observations

#### What went well

- The TDD green-baseline `pnpm run test` reproduced the exact flake #618 targets — both real-CLI acceptance tests timed out under the concurrent workspace run, while a standalone re-run was green.
  Correctly classified this as "the failing test IS the bug I am fixing," confirmed it with the standalone-green re-run, and proceeded rather than treating it as a pre-existing blocker to fix first.
  This is the failure mode #67/#596/#597 kept mis-attributing; recognizing it inline is the payoff of the plan's problem-statement framing.
- Verification cadence was healthy: per-step `vitest run <file>` + `check` after each TDD cycle, then full-suite + `check` + `lint` + `fallow` at the end — no end-loaded verification gap.
- The `tidy-first-assessor` correctly returned "nothing to prepare" for a genuinely small change (two pure functions, a default swap, two literal-to-call-site swaps), and `pre-completion-reviewer` returned a clean PASS — both subagents used appropriately, neither over-reached.

#### What caused friction (agent side)

- `instruction-violation` (not self-identified) — at ship step 6.4 the release PR merge returned `UNSTABLE` with a check `IN_PROGRESS`; the prompt says to re-poll `statusCheckRollup` and retry `release_pr_merge`, but I reached for `ci_find`/`ci_watch` instead.
  Compounding it, I passed `expected_sha: "$(gh pr view 619 --json headRefOid -q .headRefOid)"` to the `ci_find` tool — tool parameters are not shell-expanded, so it searched for the literal `$(...)` string and timed out after 125 s (7 retries).
  Impact: ~125 s wasted plus 2 extra tool calls (a separate `gh` to fetch the SHA, then a re-run of `ci_find`) before the merge went through.
- `missing-context` (minor) — the stacked-release check ran `git log --oneline pi-autoformat-v5.1.6..HEAD` unscoped; because the package tag was many releases old, the range spanned every package's commits and returned 853 lines (hit the 50 KB truncation cap).
  Re-scoping to `-- packages/pi-autoformat/` gave the 9 relevant commits.
  Impact: added friction, one extra command, no rework.

#### What caused friction (user side)

- None.
  The operator drove model selection throughout (the session hopped across `opus-4-8`, `sonnet-5`, `deepseek-v4-flash`, `fable-5`, and `haiku-4-5`) but this steering caused no quality regression in the output.

### Diagnostic details

- **Model-performance correlation** — Both subagent dispatches ran on their frontmatter-configured models and matched task weight: `tidy-first-assessor` (read-only, small-change triage) and `pre-completion-reviewer` (judgment-heavy quality gate, returned a thorough PASS).
  No mismatch (reasoning-weak model on judgment work, or high-cost model on mechanical work) observed.
- **Escalation-delay tracking** — The `ci_find` timeout was a single failed tool call corrected immediately; no >5-call same-error rabbit-hole occurred.
- **Feedback-loop gap analysis** — Verification ran incrementally after every change, not only at the end; no gap.

### Changes made

1. `.pi/prompts/ship-issue.md` — scoped step 4b's stacked-release `git log` to `-- packages/<pkg>/` so an old package tag no longer dumps every package's commits and truncates the output.
