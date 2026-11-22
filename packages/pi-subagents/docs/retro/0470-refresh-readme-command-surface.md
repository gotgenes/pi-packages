---
issue: 470
issue_title: "pi-subagents: README still documents the removed /agents command and omits /subagents:settings and /subagents:sessions"
---

# Retro: #470 — pi-subagents README still documents the removed /agents command

## Stage: Planning (2026-06-23T00:00:00Z)

### Session summary

Planned a docs-only refresh of `packages/pi-subagents/README.md` to replace the removed `/agents` interactive-menu surface with the live `/subagents:settings` and `/subagents:sessions` commands, drop the deleted Conversation viewer feature bullet, and remove the eject customization story (ADR-0004 Decision C).
Verified the current command surface against `src/index.ts` `registerCommand` calls and enumerated every stale reference by grep (lines 21, 119, 228–252, 277–303, 318).
Classified as **ship independently** — not a member of any roadmap step or release batch; the `dissolve-agents` batch already shipped as `pi-subagents-v18.0.0`.

### Observations

- Author is the operator (`gotgenes`), and the issue spells out the stale lines and expected behavior precisely, so the `ask_user` gate was skipped — no design ambiguity.
- This is a `/build-plan` (docs-only) change: one reviewable commit, no red→green cycles, verified by `pnpm run lint` (rumdl) plus a re-grep for stale terms.
- Root cause (from the issue itself): the Phase 19 doc-staleness check keyed on module names (`agent-menu.ts`), not the command names a README documents (`/agents`) — the plan-issue README grep checklist now catches this class.
- Scope deliberately excludes `src/`, tests, `architecture.md`, and the ADRs — all already accurate post-Phase-19.
  Only the README lagged.
- `.pi/skills/package-pi-subagents/SKILL.md` needs no update: it is an implementation-architecture reference that does not document slash commands, and its sole `/agents` mention is past-tense Phase 18 historical context (not a live-command reference).

## Stage: Implementation — Build (2026-06-23T00:00:00Z)

### Session summary

Executed the single-step docs plan in one commit: refreshed `packages/pi-subagents/README.md` to the post-Phase-19 command surface.
Replaced the removed `/agents` interactive-menu surface with `/subagents:settings` and `/subagents:sessions`, dropped the Conversation viewer feature bullet (now a Session transcripts bullet), removed the eject customization story (override + `enabled: false` only), and corrected the `subagents:settings_changed` events-table description.
No `src/`/`test/`/`.ts` files touched; `pnpm run lint` and `pnpm run check` stayed green throughout.

### Observations

- Command table descriptions were copied verbatim from the `registerCommand` calls in `src/index.ts` so the README matches `/help` output.
- The post-edit grep for `/agents` still matches lines 22/119/131/132/137 — all legitimate `.pi/agents/<name>.md` file-path references, not the removed command; `eject`/`wizard`/`conversation viewer` return zero matches.
- Pre-completion reviewer: WARN (non-blocking).
- Reviewer warnings: one finding — the planning-stage retro observation incorrectly claimed `SKILL.md` "already references the new commands."
  The conclusion (no skill update needed) was correct, but the justification was wrong.
  Corrected the planning observation in this same retro commit; `SKILL.md` is an architecture reference that does not document slash commands, so it genuinely needs no update.

## Stage: Final Retrospective (2026-06-23T00:00:00Z)

### Session summary

Single continuous session carried issue #470 from plan through build, ship, and release: a docs-only refresh of `packages/pi-subagents/README.md` to the post-Phase-19 command surface, released as `pi-subagents-v18.0.1`.
Zero rework on the deliverable; the one correction was to a retro observation, not the README.
Clean execution overall, with one prompt-guidance gap surfaced during the release-please merge.

### Observations

#### What went well

- Clean plan→build→ship→release in one session with no rework on the README itself.
  Every stale reference was enumerated by grep during planning and verified gone after the edit; command-table descriptions were copied verbatim from `src/index.ts` `registerCommand` calls.
- The `pre-completion-reviewer` caught a factual inaccuracy in the **planning retro note** (a false claim that `SKILL.md` "already references the new commands"), not in code.
  Novel: the reviewer's doc-accuracy lens extends to the agent's own retro observations, not just the shipped artifact.
  Self-corrected in the same build-retro commit, no deliverable impact.

#### What caused friction (agent side)

- `missing-context` — the planning-stage retro asserted `.pi/skills/package-pi-subagents/SKILL.md` content ("already references the new commands") without grepping the file.
  The claim was false; the conclusion (no skill update needed) happened to be right.
  Impact: reviewer-caught WARN, one-line correction in the build-retro commit, no rework to the README.
  Caught by an existing safety net (the reviewer), so a salience tweak is not warranted — recorded as a reminder to verify file-content claims before writing them into plan/retro notes.
- `other` (prompt-guidance gap, not an agent error) — the release-please PR #471 had a CI `check` job that actually ran, contradicting the `/ship-issue` step 6 assumption that release PRs "typically have no CI runs."
  `release_pr_merge` correctly refused with `merge_state: UNSTABLE` while `statusCheckRollup` showed `check IN_PROGRESS` (a non-empty rollup).
  This is neither the prompt's "empty rollup → merge anyway" case nor its "genuinely blocked → stop" case.
  Impact: handled correctly by polling until the check passed (four `sleep` cycles) then retrying `release_pr_merge`, but the prompt offered no explicit guidance for the in-progress-check case — a future agent could misread `UNSTABLE` + non-empty rollup as blocked (stop) or merge prematurely via `gh pr merge --rebase` while the check runs.

#### What caused friction (user side)

- None.
  The issue was operator-authored and precisely specified; no mid-session redirection was needed.

### Diagnostic details

- **Model-performance correlation** — one subagent dispatch (`pre-completion-reviewer`) on judgment-heavy work (acceptance-criteria verification, doc-staleness checks).
  Appropriate match; it produced an accurate WARN.
- **Escalation-delay tracking** — no rabbit-holes.
  The longest wait was polling the release-PR check (four `sleep` cycles) — legitimate CI waiting, not a stuck loop.
- **Unused-tool detection** — none.
  `grep` (exact symbol matching for `/agents`, `eject`) was the correct tool over `colgrep` for this verification.
- **Feedback-loop gap analysis** — verification ran incrementally: baseline `check`+`lint` before editing, `lint` after the single edit, full suite via the pre-completion reviewer.
  No end-only-verification gap.

### Changes made

1. `.pi/prompts/ship-issue.md` — added a sentence to step 6.4 covering the in-progress-check release-PR case: a non-empty `statusCheckRollup` with a check still `IN_PROGRESS` is neither the empty-rollup (`GITHUB_TOKEN`) merge case nor the genuinely-blocked stop case; wait for the check to finish and retry `release_pr_merge` rather than falling back to `gh pr merge`.
