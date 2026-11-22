---
issue: 979
issue_title: "pi-permission-system: a heredoc hosts the rest of its command line, so commands, arguments, and redirects after `<<EOF` are never gated"
---

# Retro: #979 — pi-permission-system: a heredoc hosts the rest of its command line, so commands, arguments, and redirects after `<<EOF` are never gated

## Stage: Planning (2026-09-27T00:54:48Z)

### Session summary

Planned #979 as a second parser-boundary pass beside #977's: `hoistHeredocTails` (new `heredoc-tails.ts`) moves a heredoc's redirect tail and `|`/`&&` tail out of the `heredoc_redirect`, and `reattachRedirectArguments` learns that a heredoc can carry words, exactly as a `file_redirect` can.
The six-step plan (`docs/plans/0979-heredoc-tail-hoisted.md`) leads with extracting the view primitives into `parse-view.ts` and the parse-tree test helpers into `test/helpers/bash-parse-tree.ts`.
After the plan, the operator asked what relief an unparseable command could get, which filed #985 (a new Phase 15 step after #979) and #986 (out of scope for the roadmap).

### Observations

- **Operator decisions.**
  The rejoined tail reproduces the grammar's own parse of the `< in` spelling (the walkers are already hardened against its mis-groupings, and it gives a crisp shape oracle), not a bash-exact grouping.
  The correction is a separate pass plus a shared `parse-view.ts`, not a growth of `redirect-arguments.ts`.
- **Re-measured at `f02c1868`** through the real `resolveBashCommandCheck`: the issue's five rows reproduce.
  Two further effects: `xargs grep foo <<EOF > /tmp/o` keeps the `core-reader` exemption its heredoc-free spelling withholds, and the grammar nests `true && cd /tmp` inside the pipe in `cat <<EOF | true && cd /tmp`, while bash runs the `cd` in the current shell (measured with `bash -c` and `pwd`).
- **Census over 8919 review-log commands:** 587 heredocs, 6 clean tails (5 `/tmp` redirect writes, 1 `&& git log`), 0 word or pipe tails.
  The operator's global config allows `/tmp/*` writes, so no real command newly prompts.
- **View contract widened.**
  Issue #977's contract requires non-overlapping siblings, but a heredoc's body is written after the rest of its line, so a truncated heredoc overlaps the siblings after it.
  The plan scopes the widening to a heredoc-bearing sibling and adds two contract items (containment, leaves preserved), each with a killing mutation.
- **#941 is untouched:** the `-` in `git commit -F - <<'EOF'` is in no node of the grammar's tree, and a heredoc with no tail is never rewritten.
- The Tidy-First assessor reported a `foldPipelineFirstStage` gap for a non-`file_redirect` sibling; reading the code, a `herestring_redirect` or `heredoc_redirect` takes the same host-only route there as in `walkCurrentShellSequence`, so it is not a gap and nothing was filed.
- **Session friction:** probes run with `bash -c` and a `cd /Users` prefix triggered permission prompts the operator had to approve, which the agent could not see.
  A probe of real bash semantics can run as a script file under the repo instead.
  The disposable spike files (`.spike979*.mjs`, `test/spike/`) were deleted before handoff.
- **An unparseable heredoc tail is not invalid bash.**
  `bash -n` (5.3.20) exits 0 on `cat <<EOF ; rm x`, `&`, words plus a redirect, `0<<EOF |`, `2>&1 | tail`, and `> o | wc`, all of which `tree-sitter-bash` errs on.
  Only the backtick case (``grep -c "`" notes.md``) and `{ …; } <<EOF b` are rejected, and the latter parses cleanly in tree-sitter and is allowed.
  So the floor is right for the heredoc forms, and it fails open there: under `rm *: deny`, the first four forms ask instead of deny, while the salvage already recovers `rm` in the last two.
  Filed as #985; the bash-rejects relief is #986, beside #976.

## Stage: Implementation — TDD (2026-09-27T22:50:30Z)

### Session summary

All six planned steps landed as six commits: the `parse-view.ts` extraction, the shared `test/helpers/bash-parse-tree.ts` contract (with the new containment and leaves-preserved checks), heredoc words reattached, the unwired `hoistHeredocTails` pass, the wiring, and the docs.
The pre-completion reviewer failed the change twice before passing it on the third round; each finding was fixed and folded into the step-5 `fix:` commit, since none had shipped.
The `pi-permission-system` suite went from 4749 to 4832 tests (+83).

### Observations

- **Reviewer round 1 (FAIL, real).**
  `tailOf` read any `pipeline` child as the grammar's `| …` form, so `cat <<EOF && ls | rm -rf /tmp/x` enumerated `cat`, `ls`, `ls`.
  Fix: a `pipeline` is the pipe form only when no `&&`/`||` came before it.
  The plan's `< in` oracle and leaves check would have caught it; no case fed them an `&&` tail into a pipeline.
- **Reviewer round 2 (FAIL, real).**
  `join` built bash's grouping for `<<EOF && a > o | b`, where the grammar groups the `< in` spelling as `(… && a > o) | b`, so `xargs` kept an exemption the `< in` spelling withholds.
  The operator chose the oracle again (join at a pipeline's redirected first stage).
- **Self-sweep before round 3.**
  A disposable oracle sweep (2180 combinations; 1370 comparable) found 62 more divergences in three classes, because the grammar parses a tail differently from the same text at the top level.
  Operator decision: fix class C (a tail's `a | b | c > o` parses as `a | ((b | c) > o)`, so the write missed the heredoc's command; lifted by `withTrailingRedirectsOutermost`) and document A (bash-correct `cd` grouping) and B (stricter).
  A mechanical exemption check, confirmed to flag class C with the fix disabled, found 0 looser units among the 22 remaining.
  Lesson: when a plan names an external oracle, sweep it combinatorially at planning or implementation time rather than sampling rows; each sampled row was green while whole shape classes diverged.
- **Corpus re-measurement: 3 changed, not the predicted 6.**
  Three heredoc writes name a file a later command on the line runs (`node /tmp/x.mts`), which that command already projects as `unproven`; the projection merges by path, so the new `write (syntax)` token changes nothing.
  The rounds 1–3 fixes changed 0 corpus commands.
- **Plan deviations:**
  - A heredoc's trailing words are restricted to the grammar's `_literal` types (`LITERAL_NODE_TYPES`) rather than "not `heredoc_body`/`heredoc_end`", so step 3 could not fold a `| …` tail into the command before step 5 wired the hoist.
  - The `< in` oracle does not hold for a herestring tail (the grammar misparses `cat < in <<< x` itself); that case asserts its shape directly.
  - Step 2's containment check is killed by a mutation to the command's range growth; the plan's named mutation (the truncated redirect's end) is killed by the overlap check instead.
  - Step 3 mutation (b) did not redden the leaves check as the plan predicted (a moved body is re-parented, not duplicated); the shape cases carry it.
  - The metamorphic cases were added as placements in the existing redirect-position describe.
- **Tooling friction:** a mutation batched in parallel with its restore `cp` never reached the tree; running each mutation in its own call fixed it.
- Pre-completion reviewer: **PASS** (round 3), after two FAIL rounds, each fixed.

## Stage: Sync (worktree) (2026-09-27T22:53:56Z)

### Session summary

Pre-push checks (`pnpm run lint`, `pnpm fallow dead-code`) both pass on the branch as landed by the TDD stage; nothing further to fix before rebase.
The plan's `**Release:** ship independently` marker holds.
Follow-ups [#985] and [#986] are filed and dispositioned into Phase 15; neither is implemented here.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-979--/2026-09-27T00-27-18-176Z_01a0e042-531f-709b-80c4-174b997becd4.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

The TDD stage's own retro entry already records the two pre-completion FAIL rounds and their fixes.

The rebase onto `main` conflicted in `architecture.md`'s Phase 15 dependency diagram: #902 landed first and respelled every dashed edge `-.soft.->`, on the same lines this branch's roadmap disposition and docs commits edited (adding `S985`, then `✅` on `S979`).
The first attempt was aborted and reported; the operator then approved resolving it by keeping #902's `-.soft.->` spelling with this branch's additions.
Issue #902's checker also requires a `**Soft dependency:**` bullet for each soft edge, so #985's step gained one naming #979 and #978's bullet moved from #979 to #985, folded into the disposition commit.
`scripts/roadmap-check.mjs` reports no finding this branch introduced; the #945, #977, and #978 findings predate it.

## Stage: Final Retrospective (2026-09-27T23:10:50Z)

### Session summary

The root ship fast-forward-merged the 13-commit branch, re-ran lint and `fallow dead-code` on the merged tree, pushed, and watched CI and the release run to green: `pi-permission-system-v35.0.1`.
Issue #979 closed with the landing commit and its two supporting commits cited; the worktree and branch were torn down.
The ship itself had no friction; the cost of this issue sat in the TDD stage's two pre-completion FAIL rounds.

### Observations

#### What went well

- The `pre-completion-reviewer` earned its keep: both FAIL rounds were real grouping defects (`tailOf` misreading an `&&`-then-pipeline tail, and the `join` grouping for `<<EOF && a > o | b`) that the planned test cases never fed.
- The self-sweep before round 3 (2180 combinations, 1370 comparable against the `< in` oracle) found 62 divergences the sampled rows missed, and the operator could then pick per class (fix C, document A and B) instead of per row.
- The peer's first sync attempt aborted the #902 rebase conflict and reported it with the two sides quoted, rather than resolving a shared-diagram collision on its own; the resolution then also satisfied #902's new `**Soft dependency:**` checker.
- The ship's `PRE_MERGE` anchor test fired as designed: `PRE_MERGE` equalled `"$PLAN"^`, so the plan range was confirmed complete instead of assumed.

#### What caused friction (agent side)

- `missing-context` — the plan named the `< in` spelling as the oracle but sampled it by hand-picked rows; no row fed an `&&` tail into a pipeline or a three-stage pipe with a trailing redirect.
  Impact: two reviewer FAIL rounds, each folded into the step-5 `fix:` commit, plus a third review round.
- `other` — planning probes of real bash ran as `bash -c` with a `cd /Users` prefix, which raised permission prompts the agent could not see.
  Impact: operator approvals only; no rework.
- `other` — the sync note's line opening `#902's checker` was read as a heading; the peer caught it on `rumdl` output and prefixed `Issue` (self-identified, already a `markdown-conventions` rule).
  Impact: one amend.

#### What caused friction (user side)

- The #902 edge respelling landed on `main` while this branch had pending edits to the same Phase 15 diagram; landing the branch before the repo-wide diagram change (or vice versa, with the peer rebasing first) would have avoided the two conflict hunks.
  Added friction but no rework beyond the resolution.

### Diagnostic details

- **Model-performance correlation** — the peer session's main turns ran `anthropic/claude-opus-5-5`, with the first sync attempt on `anthropic/claude-sonnet-5` (it aborted and reported, appropriately); all four subagents (the planning `tidy-first-assessor` and three `pre-completion-reviewer` rounds) ran `claude-sonnet-5`, and the reviewer's two FAILs were both real, so no mismatch.
  Subagent models were counted from `"model"` fields in each `tasks/*.jsonl` rather than rendered with `read_session_file`.
- **Feedback-loop gap analysis** — the gaps the reviewer found were oracle coverage, not verification cadence; the combinatorial sweep ran only after round 2, where running it at step 4 (the unwired `hoistHeredocTails`) would have caught all three classes before any review.

### Changes made

1. `.pi/skills/testing/SKILL.md`: added a bullet to sweep a plan-named external oracle combinatorially rather than by hand-picked rows.
