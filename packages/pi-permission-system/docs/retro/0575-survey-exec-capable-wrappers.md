---
issue: 575
issue_title: "pi-permission-system: survey other exec-capable CLI rewrites for indirection-wrapper flooring"
---

# Retro: #575 — survey exec-capable CLI rewrites for indirection-wrapper flooring

## Stage: Planning (2026-07-14T21:26:44Z)

### Session summary

Planned Phase 11 Step 6: survey modern exec-capable CLI rewrites and extend `INDIRECTION_WRAPPER_NAMES` (`src/access-intent/bash/command-enumeration.ts`) so an inner command cannot ride a permissive `allow` on the wrapper text, following [#490].
Researched every candidate's exec behavior, then confirmed the adoption inventory with the operator via `ask_user`.
Plan filed at `docs/plans/0575-survey-exec-capable-wrappers.md`; two TDD cycles (one `fix:`, one `docs:`).

### Observations

- Web research classified each candidate by the criterion "does it run an inner command per input or as a subcommand?": adopt `parallel`/`rust-parallel`/`rush` (parallelizers), `doas` (sudo rewrite), `setsid`/`stdbuf`/`watch`/`flock` (prefix wrappers); reject `sad` (batch file editor), `fselect` (SQL file search), `runiq` (line dedupe) as non-exec.
- `ask_user` confirmed the operator adopts all 8 always-invoke wrappers and **declines** `gargs` (exec-capable but niche); rejection notes stay plan-only (no issue comment).
- None of the adopted tools is flag-gated like `find`/`fd` — each always invokes its command — so all go into `INDIRECTION_WRAPPER_NAMES`, none into `EXEC_CONDITIONAL_WRAPPERS`.
- Per the [#490] retro, the floor half needs no code beyond the set edit: `WRAPPER_SENTINEL` already carries the `indirection` key and the advisory path reuses `resolveBashCommandCheck`, so the entire change is 8 strings + classifier tests + docs.
- Behavior-tightening `fix:` (not breaking), matching the [#490] precedent — the floor only clamps `allow` → `ask`, never overrides `deny`.
- Doc surfaces that hard-enumerate the inventory and must be updated: `docs/configuration.md` (line ~329) and the package skill's Debugging list.
  Surfaces using a `…` ellipsis (`README.md`, `bash-command.ts`, `program.ts`, `architecture.md` lines 756/761) stay accurate without edits.
- Release: **ship independently** (Step 6 is `Release: independent`; not a member of the "shell-tool-aliases" batch).

## Stage: Implementation — TDD (2026-07-14T21:35:00Z)

### Session summary

Implemented the single planned TDD cycle plus the docs commit: added 8 always-invoke wrappers (`parallel`/`rust-parallel`/`rush`/`doas`/`setsid`/`stdbuf`/`watch`/`flock`) to `INDIRECTION_WRAPPER_NAMES` in `command-enumeration.ts`, pinned by 8 new `program.test.ts` classifier rows, then synced the `configuration.md` and package-skill enumerations and marked Phase 11 Step 6 `✅`.
Test count went 2464 → 2472 (+8); `check`, root `lint`, and `fallow dead-code` all green; no lockfile changes.
Pre-completion reviewer returned **PASS**.

### Observations

- The change fell out exactly as planned — as the [#490] retro predicted, the floor half needed zero code beyond the `Set` edit (the `WRAPPER_SENTINEL` `indirection` key and advisory reuse were already in place), so the whole production change was 8 strings.
- Tidy-First assessor recommended nothing: both target files were already shaped for a straight append (the `Set` literal carries an "extend this set" doc comment; the `it.each` table has an established tuple form).
- No deviations from the plan.
  All five Module-Level Changes files were touched; the plan's "deliberately not edited" ellipsis surfaces (`README.md`, `bash-command.ts`, `program.ts`, `architecture.md` 756/761) were confirmed still accurate and left alone.
- `rust-parallel`'s hyphen matches the set entry verbatim (`basename` splits only on `/`), confirmed green by its classifier row.
- Pre-completion reviewer: **PASS**, no warnings.

## Stage: Final Retrospective (2026-07-14T21:51:21Z)

### Session summary

Shipped #575 across three stages (plan → TDD → ship) in a single continuous session with zero rework: five commits (one `fix`, three `docs`, one plan), +8 tests, PASS review, released as `pi-permission-system-v20.7.2`.
The issue was a survey/evaluation follow-up to #490, and its predecessor's retro had already de-risked the design (the floor mechanism was fully wired), so the whole change reduced to eight strings appended to one `Set` plus matching test rows and doc-enumeration syncs.
Friction was effectively nil; the session is a clean baseline for the "well-scoped follow-up executes mechanically" pattern.

### Observations

#### What went well

- **The #490 retro paid forward directly.**
  Planning read `docs/retro/0490-floor-indirection-wrappers.md` and lifted two load-bearing facts from it: the floor half needs no code beyond the `Set` edit (the `WRAPPER_SENTINEL` `indirection` key and advisory reuse already exist), and the change is a behavior-tightening `fix:` not a breaking change.
  Both held exactly, so the plan's "entire production change is 8 strings" prediction was literally true — a cross-session context bridge working as designed.
- **Grounded the survey with `web_search` before deciding.**
  Three `web_search` batches classified every candidate by the single criterion "does it run an inner command per input or as a subcommand?" — confirming `sad`/`fselect`/`runiq` are non-exec (reject) and `flock` has a bare-fd form that over-floors (accepted edge), rather than guessing from tool names.
  The evidence then fed a crisp `ask_user` inventory confirmation.
- **Smooth handling of the release-PR `UNSTABLE` edge case.**
  `release_pr_merge` refused on `merge_state: UNSTABLE`; per the ship prompt's step 6.4, checked `statusCheckRollup` (a non-empty rollup with a check `IN_PROGRESS`), waited it out via `ci_watch` (~180s), then retried `release_pr_merge` successfully — never fell back to `gh pr merge` while a check was running.

#### What caused friction (agent side)

- `other` — during the ship stage I ran `git rev-parse HEAD | wc -c` and `git rev-parse abddb7b7 | wc -c` to "verify" a SHA after a false-alarm worry that 41 characters was too long (41 = 40 hex + newline, entirely normal).
  Impact: two throwaway bash calls, no rework — a momentary over-verification reflex, not a systemic gap.
  Self-identified.

#### What caused friction (user side)

- None.
  The operator's single `ask_user` interaction (adopt the 8 wrappers, decline `gargs`, plan-only rejection notes) was a clean, decisive inventory confirmation with no back-and-forth.

### Diagnostic details

- **Model-performance correlation** — two subagent dispatches, both on `anthropic/claude-sonnet-5`: `tidy-first-assessor` (read-only, returned "nothing warranted" in 27.5s) and `pre-completion-reviewer` (judgment-heavy: design, cross-step invariants, Mermaid validation, 119.6s / 27 tool uses).
  Both appropriate matches; no mismatch.
  The parent session ran mostly on `claude-opus-4-8` with a brief `claude-sonnet-5` stint — operator's choice, no correlation concern.
- **Escalation-delay tracking** — no `rabbit-hole` friction; the longest same-topic run was the two-call SHA-length check above, well under the 5-call flag.
- **Unused-tool detection** — none; `web_search` (survey) and the two subagents were the right tools and were used.
- **Feedback-loop gap analysis** — no gap: `vitest` ran after Red and after Green, and `check`/`lint`/`fallow dead-code` ran after the docs commit — incremental, not end-loaded.

### Changes made

1. `packages/pi-permission-system/docs/retro/0575-survey-exec-capable-wrappers.md` — this Final Retrospective stage entry.
   No `AGENTS.md` or prompt changes: the session was clean with no actionable friction, and the two candidate rule changes (a tidy-first "trivial change" carve-out; an anti-SHA-re-verification note) were considered and rejected as judgment-creep / one-off noise.

[#490]: https://github.com/gotgenes/pi-packages/issues/490
