---
issue: 463
issue_title: "pi-subagents: add file-snapshot source to /subagent-sessions for evicted agents"
---

# Retro: #463 — pi-subagents: add file-snapshot source to /subagent-sessions for evicted agents

## Stage: Planning (2026-06-23T00:00:00Z)

### Session summary

Produced a 4-step plan for the Phase 19 Step 4b file-snapshot source: implement `fileSnapshotSource(outputFile, readFile)` in the pure `session-navigation.ts`, broaden the `/subagent-sessions` candidate set to evicted agents, and dual-source the handler by `NavigationEntry.kind`.
The central design fork — how evicted agents enter the picker — was resolved with the operator via `ask_user`.

### Observations

- **Eviction is memory management.**
  The cleanup sweep's `disposeSession()` frees the in-memory message history; the transcript survives only on disk.
  So rendering an evicted agent *always* reads the file (`fileSnapshotSource`) regardless of candidate-set strategy — the strategy only affects the picker *label*.
- **Persisted child sessions carry no `type`/`description`.**
  The JSONL has only the conversation plus a header (`id`, `timestamp`, `cwd`, `parentSession`).
  A directory scan (the issue's literal wording) would therefore produce degraded labels and parse every file per open.
- **Decision: manager-retained descriptors over directory scan.**
  The manager stashes a tiny no-messages `EvictedSubagent` descriptor in `cleanup()` before `removeRecord`, cleared in `clearCompleted()`/`dispose()`.
  Rich labels identical to live entries, bounded memory, no per-open parse.
  Coverage is limited to in-session evictions — which are the sweep's only targets, since a fresh manager per session never reloads prior-process subagents.
  Operator confirmed; an `(evicted)` snapshot marker was also chosen for the label.
- **`NavigationEntry` becomes a discriminated union** (`live` | `evicted`); this breaks the handler, the `index.ts` call site, and both UI test files, so step 3 folds all of them into one commit.
- **SDK-runtime call kept direct.**
  `fileSnapshotSource` calls `parseSessionEntries` / `buildSessionContext` directly rather than injecting them — the injected `readFile` already provides the unit-test seam, and there is no `no-restricted-imports` rule.
- **Transient dead-code risk noted:** `fileSnapshotSource` and `listEvicted()` have no caller until step 3; flagged not to ship before step 3 lands (CI/`fallow` gate the pushed tip).
- Release: independent (Phase 19 Step 4b roadmap tag).

## Stage: Implementation — TDD (2026-06-23T13:00:00Z)

### Session summary

Executed all 4 plan steps in order: (1) `fileSnapshotSource` in the pure `session-navigation.ts`, (2) manager-retained `EvictedSubagent` descriptors (`cleanup` capture, `listEvicted`, `clearCompleted`/`dispose` clear), (3) the breaking `NavigationEntry` discriminated union + handler dual-source + `index.ts` wiring + all test updates in one commit, (4) architecture/ADR doc updates.
Test count went from 1088 to 1099 (+11); full suite, `check`, root `lint`, and `fallow dead-code` all green.

### Observations

- **No deviations from the plan.**
  All steps landed as written; Module-Level Changes matched the touched files exactly.
- **Exploratory probe paid off.**
  A disposable script confirmed `buildSessionContext` auto-detects the leaf with no `leafId`, the `type !== "session"` filter drops the header, and empty entries yield `[]` — validating the `fileSnapshotSource` shape before writing the test.
- **Two ESLint auto-fixes during commit hooks:** a stray `!` non-null assertion in the manager test (step 2) and four `entry?.kind` optional chains on a non-nullish destructured `entry` (`@typescript-eslint/no-unnecessary-condition`, step 3).
  Both fixed and re-committed; `check` + tests confirmed green after.
- **Transient dead code** between steps 1–2 and 3 (predicted in the plan) cleared at the step-3 tip; final `fallow dead-code` is clean.
- **Pre-completion reviewer: PASS** — deterministic checks, code design, test artifacts, Mermaid render, and all three cross-step invariants (no inbound core call, read-only overlay, renderer parity) verified; no follow-ups deferred.

## Stage: Final Retrospective (2026-06-23T17:43:05Z)

### Session summary

Single continuous session carried #463 from planning through ship: a 4-step plan, TDD implementation (+11 tests, 1088→1099), pre-completion PASS, and release of `pi-subagents` v17.5.0.
The defining moment was planning: an `ask_user` design gate plus operator Socratic pushback diverged the candidate-set design from the issue's literal "directory scan" wording to manager-retained descriptors.
Execution was notably clean — no rework, no plan deviations, two auto-fixed lint nits.

### Observations

#### What went well

- **The `ask_user` gate caught a real design fork the issue body got wrong.**
  The issue's "Proposed change" said "enumerate persisted child-session JSONL files" (a directory scan).
  Exploration revealed the persisted session carries no subagent `type`/`description`, so a scan yields degraded labels.
  The gate surfaced descriptors-vs-scan-vs-hybrid; the operator's "why are we evicting at all?" and "tell me more about how the labels degrade" drove a better-grounded decision (descriptors).
  This is the `/plan-issue` "treat Proposed change as a hypothesis" contract working as intended — novel because the divergence was the *enumeration mechanism*, not a surface ambiguity.
- **Exploratory probe before the first TDD test.**
  A disposable script (`explore-session.mjs`, deleted after) confirmed `buildSessionContext` auto-detects the leaf with no `leafId` and the `type !== "session"` filter drops the header — validating the `fileSnapshotSource` shape before any test was written (the `testing` skill's "inspect the actual runtime shape first" rule).
- **The plan predicted transient dead code and sequenced to clear it.**
  `fileSnapshotSource` and `listEvicted()` had no caller until step 3; the plan flagged this and ordered the integration step to close it, so the final `fallow dead-code` gate passed with no surprise suppressions.
- **Pre-completion reviewer ran on `claude-sonnet-4-6`** — model appropriate for the judgment-heavy invariant/design checklist; returned PASS.

#### What caused friction (agent side)

- `other` — the first `ask_user` led with the enumeration mechanism (descriptors/scan/hybrid) before establishing *why eviction creates the problem*.
  The operator's first reply was "Why are we 'evicting' subagents in the first place?", i.e. asking for the framing I already held but had not front-loaded.
  Impact: two extra `ask_user` round-trips before the decision — but they produced a better-understood outcome, so net-positive; no rework.
- `other` (lint nit) — four `entry?.kind` optional chains on a destructured array element tripped `@typescript-eslint/no-unnecessary-condition`, and a stray `!` tripped `no-unnecessary-type-assertion`; both surfaced via the pre-commit hook.
  Impact: two re-commits during steps 2–3, auto-fixed, zero rework.

#### What caused friction (user side)

- None.
  The operator's Socratic questions mid-`ask_user` were the session's highest-value input — they converted a plausible-but-degraded design (scan) into the right one (descriptors).
  If anything, this is a model for how the gate should be used.

### Diagnostic details

- **Model-performance correlation** — the `pre-completion-reviewer` subagent ran on `anthropic/claude-sonnet-4-6` (judgment-heavy review): appropriate, no mismatch.
  Main-thread `model_change` events included a `deepseek-v4-flash` variant; no quality degradation was observed in any artifact (plan, code, tests all clean), so no actionable correlation.
- **Escalation-delay tracking** — no `rabbit-hole` points; longest same-error streak was the two lint auto-fixes, each resolved in one re-commit.
- **Unused-tool detection** — exploration used `colgrep`, `grep`, and a disposable runtime probe; no missed-tool opportunities.
- **Feedback-loop gap analysis** — verification ran incrementally: `pnpm run check` after the shared-interface steps (2 and 3), per-file `vitest` on each red/green cycle, and the full suite + lint + `fallow` before the docs commit.
  No end-only verification.

### Changes made

1. Appended this Final Retrospective stage entry to `packages/pi-subagents/docs/retro/0463-file-snapshot-source-evicted-agents.md`.

No `AGENTS.md` or prompt changes — the session's friction was net-positive (the `ask_user` round-trips) or auto-fixed with zero rework (the lint nits).
Two candidate changes were considered and rejected as noise (a `code-design` note on `entry?.kind` optional chaining; an `ask-user` "why-before-mechanism" guidance already covered by the skill).
