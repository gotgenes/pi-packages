---
issue: 869
issue_title: "Ship prompts: /ship-worktree and /ship-issue step 5 have diverged, losing rules on the worktree path"
---

# Retro: #869 — Ship prompts: /ship-worktree and /ship-issue step 5 have diverged

## Stage: Planning (2026-09-05T18:21:25Z)

### Session summary

Measured the real drift between `/ship-issue`, `/ship-worktree`, and `/ship-no-issue`, then took the operator through two clarification gates to settle both mechanism and scope.
The chosen direction is not one of the three the issue proposed: instead of extracting the close step into a shared source, the two prompts merge into a single `/ship <N>` that detects its lane from the presence of an `issue-<N>-*` branch.
Wrote `docs/plans/0869-merge-ship-prompts.md` — eight `docs:` build steps, no test cycles.

### Observations

- **The drift is bidirectional and larger than the issue reports.**
  The issue names two rules lost on the worktree path.
  A section-by-section comparison found 15 asymmetric rules: 11 carried only by `/ship-issue` (including the whole adopted-PR close branch and the entire stacked-release pre-check) and 4 carried only by `/ship-worktree` (including the [#814] rebase-reachability check and the [#849] retro read).
  `/ship-worktree` is not a subset of `/ship-issue`, so "port the trunk rules over" would itself have lost rules.

- **The issue's own option list was superseded at the first gate.**
  All three proposed options (shared skill, delegation, duplication plus a sync check) assumed two prompts remain.
  The premise did not survive pricing: both prompts already run at the root on `main`, and the only structural differences are whether a branch exists to ff-merge, where the plan and retro live, and whether a worktree needs teardown.
  Naming that premise in the gate produced the merge.

- **`skill:` frontmatter was investigated and rejected on a correct objection.**
  The installed `pi-prompt-template-model` v0.12.2 supports a `skill:` key that injects a skill body verbatim before the turn and fails the command if unresolvable — mechanically the strongest sharing option, and offered as the recommendation.
  The operator rejected it because it is an extension feature rather than Pi core.
  The distinction that matters: an ignored `model:` degrades to the session model, while an ignored `skill:` would silently drop the shared step.

- **Plan `0843` line 132 records a false claim about prompt model resolution.**
  It asserts that a `model:` value absent from the registry "falls back silently to the session model".
  Reading `model-selection.ts:117-137` and `index.ts:638-640` in the installed extension shows prompt templates **abort** with `No available model from: …`.
  The silent-fallback rule in `AGENTS.md` is about `.pi/agents/*.md` subagent frontmatter, a different resolver.
  This is recorded in the plan's Background; the stale plan line is historical and is not being rewritten.

- **A comma-separated `model:` list is an acceptable set, not a preference.**
  If the session's current model matches any spec in the list, no switch happens at all; order only decides what a session *outside* the set switches to.
  This changed the shape of the gate — the operator's chosen `anthropic/claude-sonnet-5, opencode-go/deepseek-v4-flash` means a session already on deepseek stays there.

- **The merge closes an unrelated gap for free.**
  `/sync-worktree` runs its pre-push checks at step 2 and rebases at step 4, so the tip `/ship-worktree` ff-merges has never been linted.
  Putting the merged prompt's pre-push checks after the land covers that tree in both lanes.
  Measured cost: `pnpm run lint` 24.9 s, `pnpm fallow dead-code` 0.6 s.
  No follow-up issue was filed, because the gap is closed rather than deferred.

- **Scope grew once during the session, by operator direction.**
  `README.md`'s developer-flow documentation — two Mermaid flowcharts, a sequence diagram, and two stage tables — is explicitly in scope, not just the command strings.
  While reading that sequence diagram, found a pre-existing inaccuracy: it shows the peer running `git rebase origin/main`, but `/sync-worktree` rebases onto local `main`.
  Folded into the same edit rather than deferred, since the diagram is being rewritten anyway.

- **`/ship-no-issue` is an orphan.**
  Zero references anywhere outside its own file, and the most degraded of the three copies — its CI step carries none of the SHA discipline.
  The operator chose to keep it as a separate command with its CI and release steps re-pointed at `/ship`'s text, rather than folding or deleting it.

- **Tidy-First assessment skipped.**
  The change touches no `src/` or `test/` file, which is the skill's applicability gate.

- **`roadmap-fit` not applicable.**
  No issue was filed during planning, and #869 is `scope:repo` — it resolves to no package and takes no roadmap disposition, matching the precedent [#849]'s retro set.

[#814]: https://github.com/gotgenes/pi-packages/issues/814
[#849]: https://github.com/gotgenes/pi-packages/issues/849
