---
issue: 1003
issue_title: "pi-github-tools, pi-colgrep: `isError: true` results read as success on Pi < 0.99.0"
---

# Retro: #1003 — pi-github-tools, pi-colgrep: `isError: true` results read as success on Pi < 0.99.0

## Stage: Planning (2026-10-04T02:42:57Z)

### Session summary

Verified the diagnosis against the published `pi-agent-core` 0.75.0 tarball and the pinned 0.79.1 `dist/agent-loop.js`: a returned `isError` is discarded, and a thrown error becomes `isError: true`.
Following the operator's decision, the plan raises both packages' peer floor and devDependency pins to Pi 1.0.0 as two `feat!:` steps, and folds in a `fix(pi-colgrep):` so the collapsed renderer shows `✗` for an error.
The plan is at `docs/plans/1003-require-pi-1-0-for-tool-error-flag.md`.

### Observations

- The gate offered three options: throw from `execute`, docs-only, or raise the floor.
  I recommended throwing, since it is Pi's documented convention and works on every host from 0.75.0.
  The operator chose the floor and set it at `1.0.0`, matching `pi-nocd`, `pi-subagents`, and `pi-permission-system`.
- The issue's claim that throwing costs the structured `details` turned out not to apply: both `err()` builders already return `details: undefined`.
- Keeping `err()` avoids a collision with third-party PR #993, whose new test imports `err`.
- I spiked the devDependency bump to `1.0.0` and reverted it.
  `tsc`, lint, and the tests were green for both packages (93 and 116 tests), so no source change is needed for the floor steps.
- The colgrep renderer defect, which drew `✓ no matches` for any error, was found during planning, and the operator chose to fold it in.
  `context.isError` exists from 0.75.0.
- The Tidy-First assessor recommended no preparatory commits.
  It suggested an optional local `captureTool()` test helper, which is folded into step 3's Red.
- The watchlist rows in both package skills already said "from 0.99.0" (commit `3264a775`).
  The plan rewords them for the new floor.

## Stage: Implementation — TDD (2026-10-04T20:46:15Z)

### Session summary

Completed all three TDD steps: the `pi-github-tools` and `pi-colgrep` Pi 1.0.0 floor raises (`feat!:` each, with `BREAKING CHANGE:` footers) and the colgrep collapsed-error renderer fix.
Test count 116 → 119 in `pi-colgrep` (three `renderResult` tests); `pi-github-tools` unchanged at 93.

### Observations

- The floor steps needed no source change, as the planning spike predicted.
- The `renderResult` tests capture the tool from `registerColGrep` with a stub `pi`.
  They pass a stub `lastComponent` with a `setText` spy, because `Text` has no text getter.
- All three planned killing mutations reddened exactly the predicted test.
  An extra mutation, a bare `isError` condition, killed the expanded-error pin.
- The colgrep skill's table edit initially failed the `rumdl fmt` hook because the column padding changed.
  Running `rumdl fmt` fixed it before the commit.
- Pre-completion reviewer: WARN.
  Its one non-blocking note: `captureTool` reads `registerTool.mock.calls[0][0]` by raw index, and `render()` re-registers the tool on every call.

## Stage: Sync (worktree) (2026-10-04T21:24:39Z)

### Session summary

Root `pnpm run lint` and `pnpm fallow dead-code` both pass on the branch.
The plan's marker is `**Release:** ship independently`; dispatch both `pi-github-tools` and `pi-colgrep` (both `feat!:` commits cut a major).

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-1003--/2026-10-04T01-45-53-985Z_01a10496-cc40-7755-9fae-9d6ad8bb9527.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

- No deferred work and no follow-up issues.
- Open third-party PR #993 touches `pi-github-tools` `issue-close` files; it keeps compiling because `err()` is unchanged.

## Stage: Final Retrospective (2026-10-05T03:54:31Z)

### Session summary

The root `/ship` fast-forward-merged the worktree branch, passed root lint and `fallow dead-code`, and got green CI on `28c92c43`.
It closed the issue and released `pi-github-tools-v6.0.0` and `pi-colgrep-v2.0.0` in one dispatch, then tore down the worktree.
Across all four stages the issue ran with no rework commits and no user corrections after the planning gate.

### Observations

#### What went well

- Planning verified the defect against the real surface: the published `pi-agent-core` 0.75.0 tarball and the pinned 0.79.1 `dist/agent-loop.js`, not the type declarations.
  It also disproved one of the issue's own claims (throwing costs `details`) by reading the `err()` builders.
- The devDependency spike to 1.0.0, run during planning and reverted, made the two floor-raise steps mechanical: TDD steps 1 and 2 matched the prediction exactly.
- The colgrep renderer defect (`✓ no matches` for any error) was found while planning, not by a user, and folded in through the operator gate.
- Every killing mutation the plan named reddened the predicted test.

#### What caused friction (agent side)

- `instruction-violation` (self-identified, at retro) — `/ship` step 9 says to re-resolve every hex token in the finished close-comment draft before `issue_close`.
  I resolved the range before drafting and pasted from that output, but did not re-verify the draft itself.
  Impact: none; all three cited SHAs were copied from command output and are reachable from `main`.
- `other` — the ship's final report said I had not checked whether #1003 completed a roadmap phase, instead of running the check. #1003 is triage rank 14 in `docs/triage/2026-10-02-backlog.md`, not a roadmap step, which one `grep` showed at retro time.
  Impact: an open question left in the report; no rework.
- `other` — TDD: the first `fix(pi-colgrep):` commit was rejected by the `rumdl fmt` hook because the skill's table padding changed; `rumdl fmt` then a re-commit fixed it.
  Impact: one extra tool call.

#### What caused friction (user side)

- None.
  The one operator decision (raise the floor instead of throwing) came at the planning gate, where it belonged.

### Diagnostic details

- **Model-performance correlation** — Planning and TDD ran on `claude-opus-5-5`, and the sync stage on `claude-sonnet-5-5`.
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `claude-sonnet-5-5` and produced grounded, file-cited reports.
  No mismatch.
- **Feedback-loop gap analysis** — TDD ran package `check`/`lint`/`test` after each step and the full root suite at the end; no gap.
- **Tool observation** — `ci_watch` printed `[1/1] queued (210s)` after the CI job had completed, and `[3/3] queued` during the release run.
  `formatProgress` in `packages/pi-github-tools/src/lib/ci-helpers.ts` labels any poll with no `in_progress` job as `queued`, including the window after every job has completed and before the run reports completion.

### Changes made

1. Filed [#1026] (`pi-github-tools`: `ci_watch` progress line says "queued" after jobs have completed); `pi-github-tools` has no architecture doc, so no roadmap-fit disposition applies.

[#1026]: https://github.com/gotgenes/pi-packages/issues/1026
