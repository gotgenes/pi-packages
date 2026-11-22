---
issue: 546
issue_title: "pi-session-tools: report models by messages handled, not raw model-change markers"
---

# Retro: #546 — pi-session-tools: report models by messages handled, not raw model-change markers

## Stage: Planning (2026-07-05T00:00:00Z)

### Session summary

Planned the fix for phantom `model_change` markers in `read_session` / `read_parent_session` reporting.
The plan lives at `packages/pi-session-tools/docs/plans/0546-effective-model-change-reporting.md`: a shared pure helper `collectEffectiveModelChangeIndices` drives both `formatTranscript` (suppress phantom `[model change]` lines) and `summarizeEntries` (count only effective switches), plus README and `.pi/prompts/retro.md` doc updates.

### Observations

- The issue proposed two improvements; scope was deliberately narrowed to **improvement 2 only** (phantom suppression) after tracing the actual consumer.
  The retro model-performance lens is the sole reader, and it attributes turns via the inline `[provider/model]` labels already in the transcript — no per-model aggregate is consumed.
  The operator confirmed dropping the `summarizeModels` roll-up (AC1's "per-model turn counts"), treating the issue's "Proposed direction" as a hypothesis, not a spec.
- Two `ask_user` rounds: the first was redirected ("let's talk about what information is useful first"), which surfaced that the roll-up was a solution without a question behind it.
  Reading `.pi/prompts/retro.md` to find what the reporting actually feeds was the decisive step.
- Key design decision: a **zero-assistant guard** in `collectEffectiveModelChangeIndices` — a `types: ["model_change"]` filtered stream has no ground truth, so it falls back to rendering/counting all markers.
  This preserves the existing `read-parent-session.test.ts` filter test and keeps transcript and summary consistent in that edge case.
- Collapsed-row `modelChanges` count changes from raw markers to effective switches (operator choice); `SessionSummary` shape is unchanged, so it stays a non-breaking `fix:`.
- Verified no `docs/architecture/` roadmap and no `package-pi-session-tools` skill exist for this package, so the symbol-grep sweep was limited to `src/`, `test/`, README, and the retro prompt.
- The `read-session.test.ts` details fixture has a trailing `model_change` that becomes a phantom under the new rule — flagged for update in TDD step 2 so its `modelChanges` assertion stays meaningful.

## Stage: Implementation — TDD (2026-07-05T00:00:00Z)

### Session summary

Implemented the plan's two `fix:` TDD cycles plus two `docs:` commits: `collectEffectiveModelChangeIndices` (new shared pure helper in `format-transcript.ts`) drives phantom-line suppression in `formatTranscript` and the effective count in `summarizeEntries`; updated the README transcript example and replaced the `.pi/prompts/retro.md` model-performance-lens caveat.
Test count in `pi-session-tools` grew from 75 to 87 (12 new tests: 6 direct `collectEffectiveModelChangeIndices` cases, 3 `formatTranscript` suppression cases, 4 `summarizeEntries` effective-count cases minus 1 renamed rather than added — net +12).
All four commits landed as separate, focused changes; no deviations from the plan's TDD Order.

### Observations

- **Lint trap: TS narrowing across a `.forEach` closure.**
  The first implementation of `collectEffectiveModelChangeIndices` used `entries.forEach((entry, index) => { ... })` with `pendingIndex`/`sawAssistantMessage` mutated inside the callback.
  `@typescript-eslint/no-unnecessary-condition` flagged `if (!sawAssistantMessage)` as "always truthy" — TypeScript's control-flow narrowing does not track mutations made inside a nested closure the way it does within a single function body.
  Fix: rewrote as a plain `for (const [index, entry] of entries.entries())` loop (matching the file's existing style elsewhere), which resolved the lint error immediately with no logic change.
  This is a reusable pattern worth remembering: prefer a `for` loop over `.forEach()` when a callback mutates outer-scope `let` variables that later conditionals depend on.
- **`Edit` tool atomic-batch rejection (documented AGENTS.md behavior, confirmed in practice).**
  The first `format-transcript.test.ts` edit batch (2 edits: import + one appended test) failed entirely because the plan's literal `\u2192` escape sequence did not match the file's actual `→` character (pi-autoformat had already normalized it).
  Per AGENTS.md guidance, re-applied both edits with the literal arrow character in one call; succeeded.
- **Read-session fixture edge case turned out benign.**
  Extending the `read-session.test.ts` details fixture with a post-switch assistant turn (per plan step 2) produced a test that passed under *both* the old and new `modelChanges` semantics (raw count and effective count both happened to be 1) — so it wasn't a true red/green cycle for that file, only for `entry-summary.test.ts`.
  This matched the plan's expectation ("remains a meaningful assertion") rather than being a gap.
- **Pre-completion reviewer: PASS.**
  All deterministic checks (`pnpm run check`, `pnpm run lint`, `pnpm run test`, `pnpm fallow dead-code`) passed; all 3 acceptance criteria assessed, with AC1 ("per-model turn counts") explicitly noted as an intentional, plan-documented descope rather than an oversight.
  Reviewer flagged one action item for the ship step: surface the AC1 descope explicitly in the issue-close comment so it reads as a scoped delivery, not a silent partial fix.

## Stage: Final Retrospective (2026-07-06T00:00:00Z)

### Session summary

Reviewed the full arc of issue #546 (Planning → TDD → Ship) for workflow improvements.
Two consensus-driven changes were approved and implemented: a new `code-design` skill entry documenting a `.forEach()` closure-narrowing lint trap, and an extension to `/plan-issue`'s "Decide" gate requiring a proposed aggregate/report to be traced to a real consumer before its shape is designed.

### Observations

#### What went well

- Tracing the issue's proposed `summarizeModels` roll-up back to its one real consumer (`.pi/prompts/retro.md`'s model-performance lens) via `grep`/`Read`, rather than accepting the issue's literal proposal at face value, surfaced that the lens already had per-turn attribution and only needed the phantom-marker noise removed.
  This collapsed a two-part proposal into a single, smaller, better-targeted fix before any code was written.
- Checks ran incrementally throughout the TDD cycle (`pnpm run check`/`lint`/`test` after each step, plus root-level `lint` and `pnpm fallow dead-code` before the final commit) — no gap between a change landing and its verification.

#### What caused friction (agent side)

- `premature-convergence` — the first `ask_user` call during Planning built three questions entirely around *how* to shape/place the issue's proposed `summarizeModels` roll-up, without first checking whether any real consumer read that shape.
  Impact: one wasted `ask_user` round-trip; no commit rework (caught before any plan artifact was written), but cost a full question-answer-reanalyze cycle.
  The user's redirect ("let's talk about what information is useful first... look to the questions we ask at retro and retro-stage") is what corrected course.
- `instruction-violation`, self-identified — the first `Edit` call on `format-transcript.test.ts` used the plan document's literal `\u2192` escape sequence instead of the file's actual `→` character, violating the system-level Unicode-character instruction.
  The 2-edit atomic batch was rejected; corrected on the immediate retry.
  Added friction but no rework.
- Novel, reusable finding (not a violation) — mutating `pendingIndex`/`sawAssistantMessage` inside an `.forEach()` callback caused `@typescript-eslint/no-unnecessary-condition` to flag a later `if (!sawAssistantMessage)` as "always truthy", since TypeScript's control-flow narrowing doesn't track closure-scoped mutations back into the enclosing scope.
  Rewriting as a `for...of` loop fixed it instantly — now documented in `code-design` (see Changes made).

#### What caused friction (user side)

- None — the one intervention (the Planning-stage redirect) was a well-timed, low-cost correction made before any artifact existed, not a correction of already-committed work.

### Changes made

1. Added a "Closure narrowing loop" entry to the "Biome / ESLint linter conflicts" section of `.pi/skills/code-design/SKILL.md`, documenting the `.forEach()`/`no-unnecessary-condition` trap and the `for...of` fix.
2. Extended the "Decide" section of `.pi/prompts/plan-issue.md` with a rule requiring a proposed aggregate/report to be traced to a concrete downstream consumer before its shape is designed (Refs #546).

## Stage: Land — root worktree convergence (2026-07-06T14:57:11Z)

### Session summary

Ran `/land-worktree 546` from the root checkout: fast-forwarded the peer branch onto `main`, pushed, verified CI, closed the issue, merged the release-please PR by rebase, and tore down the worktree.
The release cut `pi-session-tools-v1.1.1`.
The one notable moment was `release_pr_merge` refusing with `merge_state: UNSTABLE` — resolved correctly by checking `statusCheckRollup` and waiting for a running check rather than force-merging.

### Observations

#### What went well

- **Correctly distinguished a running-check `UNSTABLE` from a no-check `UNSTABLE`.**
  `release_pr_merge` refused PR #548 with `merge_state: UNSTABLE`.
  The `/land-worktree` prompt frames `UNSTABLE` only as "the `GITHUB_TOKEN` no-checks case — empty `statusCheckRollup`" and says to fall back to `gh pr merge`.
  Rather than applying that fallback blindly, I inspected `gh pr view 548 --json statusCheckRollup` and found a `CI` check actively `IN_PROGRESS` (this repo runs CI on release PRs via `RELEASE_PLEASE_TOKEN`, per commit `c3f554f1`), so the empty-rollup precondition was false.
  Waited for `ci_watch` on the release PR's run to reach `success`, then retried `release_pr_merge`, which merged cleanly by rebase — no force-merge over a live check.
- **Verified the full release-PR body before merging** (`gh pr view 548 --json body -q .body`) — confirmed it bumped only `pi-session-tools: 1.1.1` with no unexpected sibling-package bump.
- **Tight tool batching** — issue-title fetch paired with the root/branch check, and `set_session_name` paired with `git fetch`/`pull`, kept independent calls in single parallel batches.

#### What caused friction (agent side)

- `missing-context` (prompt gap, not agent error) — the `/land-worktree` release step documents only the empty-rollup fallback and omits the "check still running → wait" branch that `ship-issue.md` (line 112) already carries.
  Impact: no rework — I inferred the correct behavior from the non-empty rollup — but a less careful pass could have force-merged over a running check.
  The two ship prompts should agree; see Changes made.

#### What caused friction (user side)

- None — the land ran end to end without intervention.

#### Workflow-design finding (surfaced in the retro discussion)

- `wrong-abstraction` in the worktree ship flow — `/ship-worktree` step 3 ran the **full** `/retro $1` inline in the peer session, so the deliberate, interactive final retrospective (which the operator wants on a chosen model) was consumed automatically mid-ship on whatever model the peer ran.
  The prompt justified this with "the retro note must ride the branch," but that rationale holds only for **stage breadcrumbs** (planning/TDD), not the final retrospective: this very session proved the final `/retro` runs cleanly at the root on `main` after land and commits straight to `main` (`7480846e`), no branch needed.
  Impact: a duplicate/premature retrospective (a peer "Final Retrospective" plus this root "Land" stage).
  Fixed this session by realigning the worktree flow with the trunk flow — peer writes a ship breadcrumb; the final `/retro` runs at the root after `/land-worktree` (see Changes made).

### Diagnostic details

- **Model-performance correlation** — no subagents were dispatched this stage; the entire land ran on the session model.
  No mismatch to flag.
- The other three lenses (escalation-delay, unused-tool, feedback-loop gap) found nothing notable: no rabbit-holes, no missing tool dispatch, and CI verification ran at the correct points (after the push, and again on the release PR before merging).

### Changes made

1. Added a sub-bullet to step 6.2 of `.pi/prompts/land-worktree.md` covering the running-check `UNSTABLE` case (wait via `ci_watch`, then retry `release_pr_merge`; do not fall back to `gh pr merge` while a check runs), mirroring the guidance already in `.pi/prompts/ship-issue.md` (Refs #546).
2. Realigned the worktree ship flow with the trunk flow so the final `/retro` is the deliberate last step (operator's model choice, interactive), not an inline peer-session step:
   1. `.pi/prompts/ship-worktree.md` — replaced step 3's inline `/retro $1` call with a lightweight `## Stage: Ship (worktree)` breadcrumb that rides the branch; updated the frontmatter description and the hand-off report accordingly.
   2. `.pi/prompts/land-worktree.md` — the final report now names `/retro $1` as the single final step (run at the root on `main`), mirroring `/ship-issue`.
   3. `AGENTS.md` — updated the worktree convergence flow: the peer writes only stage breadcrumbs, and a new terminal step runs the final `/retro` at the root after land.
3. Closed a peer-transcript access gap the move introduced (the root retro's `read_session` sees only the land session; the peer worktree session is an unreachable sibling):
   1. `.pi/prompts/ship-worktree.md` — the Ship breadcrumb now records the **peer session transcript** path (a raw `.jsonl` under `~/.pi/agent/sessions/`, derived via a `pwd`-encoding `sed` one-liner; it survives worktree teardown).
   2. `.pi/prompts/retro.md` — Step 2 now tells the retro to read that peer transcript with `Read`/`Bash` when a diagnostic lens needs message-level detail.
   3. Filed #549 (`pkg:pi-session-tools`, `enhancement`) for the proper fix — a `pi-session-tools` capability to read an arbitrary session file by path and render it through the same `formatTranscript`/`summarizeEntries` pipeline as `read_session`.

### Diagnostic details (retro-discussion follow-up)

- **Unused-tool / feedback-loop insight** — the operator's question "does the final retro agent have enough information to double-check messages in the worktree session?" exposed that moving `/retro` to the root traded away the peer session's `read_session` access.
  Verified empirically: `read_session` reads only `ctx.sessionManager.getEntries()` (current session), `read_parent_session` reaches only a `tasks/`-derived parent, and the peer session `.jsonl` (243 messages, 2 `model_change` entries for #546) persists at `~/.pi/agent/sessions/--<encoded-cwd>--/` after teardown.
  Mitigated inline (B) and queued the complete fix (C, #549).
