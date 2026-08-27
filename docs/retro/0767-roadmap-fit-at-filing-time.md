---
issue: 767
issue_title: "Evaluate spun-off issues for roadmap fit at filing time"
---

# Retro: #767 — Evaluate spun-off issues for roadmap fit at filing time

## Stage: Planning (2026-08-19T23:10:00Z)

### Session summary

Planned the filing-time roadmap-fit gate as a new `roadmap-fit` skill loaded lazily by the four templates that file issues (`/plan-issue`, `/tdd-plan`, `/build-plan`, `/retro`), with the disposition settled by an `ask_user` gate and a `/finish-phase` reconciliation as the backstop.
The issue left its main design question open — shared skill vs. duplicated step vs. `improvement-discovery` — so the plan was written only after an `ask_user` gate settled all three axes (home, decider, backstop).
Plan committed as `docs/plans/0767-roadmap-fit-at-filing-time.md`; the change is docs-only, so the next stage is `/build-plan`.

### Observations

- The operator chose all three recommended options: shared skill, always-ask, `/finish-phase`-only backstop.
  The decisive argument for always-ask was the defer bias: an agent allowed to self-record a "defer" disposition dodges the gate exactly the way that lost [#753].
- Measured rather than estimated two things the plan rests on.
  The detection grep (`^## Improvement roadmap — Phase` across all `packages/*/docs/architecture/architecture.md`) returns nothing today — no package has an open phase, so there is no live roadmap to migrate and the gate ships as a verified no-op at rest.
  The reconciliation query against Phase 13's window (`created:>=2026-08-15`) returns 15 issues, 7 already stepped or dispositioned, leaving 8 residual — enough to justify the grouped-bullet allowance rather than an issue-by-issue interrogation.
- Found a third spelling of the dispositions heading while checking the append target: pi-permission-system Phase 10 used `### Open-issue sweep dispositions`, Phase 13 flattened it to a bold prose lead-in, and pi-subagents Phase 21 used `## Deferred work (explicit dispositions, …)`.
  Standardizing the heading was not in the issue's proposal; it became a goal because the gate's append and the backstop's grep both need a deterministic target.
- Rejected extending `pre-completion-reviewer` §2i: it fires early enough to still fold work in, but it only sees follow-ups a **plan** names, and [#751] — the motivating case — was filed by an implementation step with no plan mention.
- Checked `/finish-phase`'s cross-references before choosing a placement: every reference to it (`AGENTS.md`, `plan-improvements.md`, `retro.md`, `ship-issue.md`, `improvement-discovery/SKILL.md`) names it without a step number, but the file has internal `per Step 4` / `Step 5.2` self-references.
  The reconciliation therefore lands as a subsection inside Step 2 rather than as a new numbered step.
- Release framing: the touched files (`.pi/`, `AGENTS.md`) lie outside every release-please component path, so the change cuts no release at all — "ship independently" means land and close.

## Stage: Implementation — Build (2026-08-20T01:32:46Z)

### Session summary

Executed all five Build Order steps as five `docs:` commits: the new `.pi/skills/roadmap-fit/SKILL.md`, the four filing-site directives (`/plan-issue`, `/tdd-plan`, `/build-plan`, `/retro`), the `#### Open-issue sweep dispositions` heading standardization in `/plan-improvements` and `improvement-discovery`, the `/finish-phase` reconciliation subsection, and the `AGENTS.md` entry.
No deviations from the plan: every file in its Module-Level Changes table landed as described and nothing else was touched.
Pre-completion reviewer: PASS.

### Observations

- Tidy First was skipped per the skill's applicability gate — the plan touches no `src/`/`test/` files.
- Both dry-runs the plan promised reproduced their planning-time measurements: the detection grep (`^## Improvement roadmap — Phase`) matches nothing across all `packages/*/docs/architecture/architecture.md`, so the gate ships as a verified no-op at rest, and the reconciliation query against Phase 13's window still returns the same 15 issues.
- The `improvement-discovery` Output format gained a trailing item 6 rather than absorbing the rule into item 1, because the dispositions list is its own artifact and not part of the health-metrics table; `/plan-improvements`'s own Output item 1 did take the rule in place, since its item 1 is the findings summary the list lives inside.
- One sloppy `Edit` call included a no-op entry (identical `oldText`/`newText`), which still reported as a replaced block.
  Harmless here, but it is the same class of miscount `AGENTS.md` warns about when counting reported blocks against intended edits.
- The reviewer independently confirmed the two structural claims the plan flagged as invariants at risk: `/finish-phase`'s four step self-references (`Step 1`, `per Step 4`, `Step 5.2`, `Step 5.3`) all still resolve, and `/plan-improvements`'s Output items 1–5 were not renumbered.
- Per the `AGENTS.md` stale-prompt rule, none of the edited templates were re-invoked to check the change — this session runs the pre-edit copies.

## Stage: Final Retrospective (2026-08-20T02:05:49Z)

### Session summary

One continuous session carried #767 from planning through ship: a three-axis `ask_user` gate settled the issue's open design question, five `docs:` commits landed the `roadmap-fit` skill and its four filing sites plus the heading standardization and the `/finish-phase` backstop, and the ship closed the issue with no release (every commit sits outside the package tree).
The pre-completion reviewer returned PASS with no findings, and no step required rework.

### Observations

#### What went well

- A docs-only change was given a real executable surface.
  The plan's two prescribed shell commands — the open-phase detection grep and the `/finish-phase` reconciliation query — were dry-run at planning time to establish baselines (no match anywhere; 15 issues returned for Phase 13's window), and the build stage re-ran both as verification.
  A prompt/skill change normally has nothing to run; here the commands the new text *tells a future agent to run* became the test.
- The three-axis `ask_user` (home / decider / backstop) resolved in one round-trip with all three recommendations accepted, because the substance — the size budget, the worked `[#751]` bullet, and the defer-bias argument — went into a message *before* the option list rather than into option descriptions.
- Planning caught that the append target it was about to prescribe did not consistently exist: `Open-issue sweep dispositions` was spelled three ways across two packages' archives (a real heading in Phase 10, a bold prose lead-in in Phase 13, `Deferred work (explicit dispositions, …)` in pi-subagents Phase 21).
  Standardizing the heading was not in the issue's proposal; it became a goal only because the grep-able contract needed one spelling.

#### What caused friction (agent side)

- `other` — one `Edit` call on `.pi/skills/improvement-discovery/SKILL.md` carried a no-op entry (identical `oldText`/`newText`), so the tool reported three replaced blocks for two intended changes.
  Impact: none — both real edits applied and a follow-up read confirmed the result — but it is the same reported-count-versus-intent mismatch `AGENTS.md` warns about for suffixed keys.
- `other` — read the same file twice at different offsets on two occasions (`.pi/prompts/plan-improvements.md` at turns 11–12, then `plan-improvements.md` and `improvement-discovery/SKILL.md` again at turns 59–60).
  Both files are under 300 lines, well inside a single `Read`.
  Impact: four extra tool calls, no rework.
- `instruction-violation` (self-identified) — at ship step 4b, ran `git tag --sort=-creatordate | head -5` before recognizing that a repo-root change has no package tag to derive.
  The template's step 5 warns against deriving a tag unscoped, and its step 4b command (`git log … -- packages/<pkg>/`) silently assumes a `<pkg>` that does not exist for a `docs/plans/` change.
  Impact: one wasted call plus a paragraph of improvised reasoning to reach the answer step 4b's own prose already contains.
- `other` — at ship step 6, spent 35 s on a `release_pr_find` timeout after step 4b had established the push releases nothing.
  Impact: 35 s and one tool call; on reflection the check is correct (a release-please PR can be open from *prior* work, and this push cannot create or cancel one), so the cost is the price of a sound check rather than a defect.

#### What caused friction (user side)

- Nothing to report.
  The single `ask_user` gate was answered decisively, and no correction was needed at any stage.

### Diagnostic details

- **Model-performance correlation** — planning and build ran on `anthropic/claude-opus-5`, ship on `anthropic/claude-sonnet-5`, retro on `anthropic/claude-opus-5`; the `pre-completion-reviewer` subagent ran on `anthropic/claude-sonnet-5` per its frontmatter, appropriate for judgment-heavy read-only review.
  Only `/plan-issue` and `/retro` pin a model; `/build-plan` and `/ship-issue` carry no `model:` frontmatter, so their tier is whatever the session last used — opus-5 for roughly 35 turns of mechanical prompt editing here, and sonnet-5 for the ship because the operator had switched.
  The assignment happened to be reasonable, but it was inherited rather than chosen.
- **Escalation-delay tracking** — no `rabbit-hole` friction points; no sequence exceeded the five-call threshold on a single error.
- **Unused-tool detection** — `colgrep` was never dispatched, correctly: every hunt was an exact phrase or heading in prose files (`Open-issue sweep`, `gh issue create`, `finish-phase`), which the decision table assigns to `grep`.
  No `Explore` dispatch was warranted — each lookup was single-hop.
- **Feedback-loop gap analysis** — verification ran incrementally throughout: `pnpm exec rumdl check` after each of the five build steps, root `pnpm run lint` at the baseline, after the final step, and again pre-push, plus `pnpm fallow dead-code` pre-push.
  No gap.

### Changes made

1. `.pi/prompts/ship-issue.md` — step 4b gained a no-package branch: a repo-root tooling change has no `<pkg>`, so the package-scoped `git log` command is skipped and nothing releases.
2. `.pi/prompts/plan-issue.md` — the Test Impact Analysis bullet now names a prompt/skill change's testable surface: dry-run the shell commands the new text prescribes at planning time and record their expected output for `/build-plan` to re-run.
3. `AGENTS.md` § Shell and search — enumerate an existing prose convention's spellings before making it machine-read, with the three-way `Open-issue sweep dispositions` drift as the example.

Declined: pinning `/ship-issue` to a model (the operator's manual switch already expresses the preference), skipping ship step 6 on a non-releasing push (a release-please PR can be open from prior work), and a rule about reading short files in one pass.

[#751]: https://github.com/gotgenes/pi-packages/issues/751
[#753]: https://github.com/gotgenes/pi-packages/issues/753
