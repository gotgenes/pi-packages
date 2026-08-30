---
issue: 843
issue_title: "Rename the worktree ship-flow commands: /ship-worktree does not ship, /land-worktree does"
---

# Retro: #843 — Rename the worktree ship-flow commands

## Stage: Planning (2026-08-30T03:33:53Z)

### Session summary

Planned the rename of the two-session worktree ship flow.
The issue left the names themselves open, so the session measured what each half actually does, counted every live reference, and put three decisions to the operator at one clarification gate: the root-half name, the peer-half name, and whether the stage/session labels migrate with the commands.
The plan landed as `docs/plans/0843-worktree-ship-flow-command-names.md` with three `docs:` build steps.

### Observations

- **Decisions taken at the gate.**
  Root half → `/ship-worktree` (reusing the retired name, so the terminal command reads as `/ship-issue`'s sibling); peer half → `/sync-worktree`; labels → migrate both the retro stage header and the session names, and teach `/retro` the pre-rename spelling.
  The label answer went against the recommended option (session-names-only), so `/retro` now carries a permanent two-spelling enumeration for the seven pre-rename retros — recorded as an accepted residual in the plan's Risks section.
- **Autocomplete grounding.**
  Dispatched an `Explore` subagent over the sibling `../pi` checkout to settle whether slash-command filtering is prefix, substring, or fuzzy.
  It is fuzzy subsequence matching (`fuzzyFilter` in `packages/tui/src/fuzzy.ts`, called from `packages/tui/src/autocomplete.ts`).
  That killed a candidate argument for a `/worktree-*` prefix family — word position does not affect reachability — and confirmed that typing `ship` will group the trunk and worktree terminal commands.
- **Name-reuse hazard, priced concretely.**
  Reusing `/ship-worktree` for the root half means a peer-session mis-invocation runs the root prompt.
  Reading the prompt showed `set_session_name` and the Release coordination gate both run *before* step 1's root-checkout confirmation, so the mis-invocation would rename the session and possibly ask a release question before refusing.
  The plan adds a step 0 guard above both rather than reordering the existing steps.
- **Alternatives rejected.**
  Keeping `/land-worktree` (no reuse, half the churn, but the terminal command still does not read as `/ship-issue`'s sibling); a compound name like `/ship-and-land-worktree`; `/prep-worktree`, `/rebase-worktree`, `/handoff-worktree` for the peer half.
- **Scope held.**
  Committed history under `docs/plans/` and `docs/retro/` is not rewritten, and `/worktree`, `worktree-new.sh`, `worktree-rm.sh` keep their (accurate) names.
- **Table widths checked, not assumed.**
  `.rumdl.toml` sets `[MD060] style = "aligned"` and `rumdl fmt` does not re-pad tables.
  The `AGENTS.md` session-naming table happens to keep every column width under the rename (`Worktree sync (peer)` and `Worktree ship (root)` are both 20 chars; `#N Sync (worktree) — <title>` and `#N Ship (worktree) — <title>` are both 30); `README.md`'s workflow table may shift its last column.
- **Tidy-First skipped** — the change touches no `src/` or `test/` files, which is the skill's applicability gate.
- **Model pin added after the first plan commit.**
  The operator asked for both worktree prompts to run on `anthropic/claude-sonnet-5`; they declare no `model:` today and inherit the session model.
  The alias was confirmed in use by `.pi/prompts/finish-phase.md` and the three `.pi/agents/*.md` files rather than assumed — an unregistered `model:` value falls back silently to the session model, so a typo would produce exactly the behavior the pin removes.
  Landed as a fourth build step with its own commit, keeping the rename diff a pure rename.
  The trunk `/ship-issue` was deliberately left unpinned and the asymmetry recorded in Non-Goals rather than resolved here.
- **Two self-inflicted slips caught by the gates.**
  The plan's first draft cited a commit SHA (`edf1a1b`) from memory rather than `git rev-parse` — exactly the invention `AGENTS.md` warns about — and wrote `issue #829` as plain text while defining a `[#829]:` reference, which `rumdl` rejected as MD053.
  Both were fixed before the commit.

## Stage: User Note (2026-08-30T03:50:28Z)

The `pre-completion-reviewer` agent has a habit of running `find /`.
The operator wants that command denied.

This is a recurrence of the guardrail `AGENTS.md` already records under Refs #696: a read-only agent still needs a scope bound, because `find /` walks every mounted volume, trips the `pi-permission-system` `external_directory` gate, and can read a stale copy of a dependency.
The prose guardrail is evidently not enough on its own — the operator's ask is a **deny rule**, not another sentence of guidance.
Candidate homes for the denial: a `pi-permission-system` policy rule matching `find` invocations whose root is outside the repo, or a bound written into `.pi/agents/pre-completion-reviewer.md` itself.
Out of scope for #843 — recorded here so it is not lost.

## Stage: Implementation — Build (2026-08-30T03:52:00Z)

### Session summary

Executed all four build steps of the plan: renamed the prompt pair (`ship-worktree.md` → `sync-worktree.md`, then `land-worktree.md` → `ship-worktree.md`), rewrote both files' vocabulary and added the root-half guard, updated the four sibling prompts, updated `AGENTS.md` and `README.md`, and pinned both worktree prompts to `model: anthropic/claude-sonnet-5`.
Four `docs:` commits (`8440587b`, `5df6be89`, `be59b1be`, `36952029`), no deviation from the plan's design.
The pre-completion reviewer returned PASS.

### Observations

- **Pre-completion reviewer: PASS.**
  It confirmed the repo-wide absence of live `/land-worktree` references (searched beyond the plan's eight files), the correct half named at every `/sync-worktree` / `/ship-worktree` mention, the dual-spelling sentence in `retro.md`, the untouched historical retros, byte-identical session-name strings between `AGENTS.md`'s table and the two prompts' `set_session_name` literals, and issue #829's release-marker ordering invariant.
  It also parsed all three `README.md` Mermaid charts with `mmdc`, confirming the `Land` → `Ship` node-id rename left no dangling edge.
  No warnings.
- **Both table-width predictions held.**
  `AGENTS.md`'s session-naming table needed no re-padding, exactly as the plan computed (`Worktree sync (peer)` / `Worktree ship (root)` both 20 chars; both session-name cells 30).
  `README.md`'s workflow table did shift its last column, and `pi-autoformat` re-padded it on write — `rumdl check` stayed clean throughout, so the hand-padding the plan budgeted for was never needed.
- **One plan prediction was wrong, harmlessly.**
  The Test Impact Analysis predicted `rg -c 'sync-worktree'` would be non-zero in `.pi/prompts/sync-worktree.md`.
  It is zero: a prompt refers to its counterpart, never to itself.
  The row should have named only `ship-worktree.md`.
  Caught by running the sweep rather than assuming it.
- **Step 4 stayed a separate commit** as planned, keeping the rename diff a pure rename.
  The pinned alias was verified byte-identical to `.pi/prompts/finish-phase.md`'s via `sort -u` collapsing all three `model:` lines to one — an unregistered value would fall back silently to the session model, so string equality against a known-good file is the only available check.
- **Nothing pushed.**
  `/ship-issue` owns the push; the branch sits nine commits ahead of `origin/main`.

## Stage: Final Retrospective (2026-08-30T04:03:34Z)

### Session summary

One Pi process carried issue #843 end to end — planning, build, ship, and this retrospective — renaming the parallel-worktree flow's two halves to `/sync-worktree` (peer) and `/ship-worktree` (root), migrating the stage and session labels, adding a fail-fast root guard, and pinning both prompts to `anthropic/claude-sonnet-5`.
Four `docs:` implementation commits landed, CI passed on `69435ce9`, and the issue closed with no release (every changed file sits outside `packages/`).
The retrospective found no functional defect but two published inaccuracies, both in the issue's close comment.

### Observations

#### What went well

- **The clarification gate overturned its own recommendation.**
  The labels question recommended migrating session names only and keeping the retro stage header; the operator chose to migrate both and teach `/retro` the old spelling.
  The plan absorbed that as an accepted residual in Risks rather than re-litigating it, and the build carried it through without drift.
  A gate that only ever confirms the recommended option is not doing work; this one did.
- **Grounding the option set before building it.**
  Dispatching `Explore` (on `sonnet-5`) over the sibling `../pi` checkout established that slash-command autocomplete is fuzzy subsequence matching (`fuzzyFilter` in `packages/tui/src/fuzzy.ts`), not prefix.
  That removed a whole candidate naming axis — a `/worktree-*` prefix family for tab-completion clustering — before it could shape the gate on a false premise.
  Checking the mechanism first is what kept the gate honest.
- **Verification ran incrementally, not at the end.**
  `pnpm exec rumdl check` plus `pnpm run lint` ran after each of the four build steps, with the full grep sweep before the reviewer dispatch.
  No feedback-loop gap; `pnpm run check` and `pnpm run test` were correctly identified as not meaningful (no TypeScript changed) rather than skipped silently.

#### What caused friction (agent side)

- `missing-context` (self-identified, at retro time — too late) — **a looser grep at ship time overturned a correct count from planning time.**
  Planning ran `rg -c '^## Stage: Ship \(worktree\)'` (anchored) and got **7** files.
  Ship (turn 18) ran `rg -l '## Stage: Ship \(worktree\)'` (unanchored), got 9 matches, subtracted the plan file, and "corrected" the number to **8**.
  The extra file is `packages/pi-session-tools/docs/retro/0546-effective-model-change-reporting.md`, which contains the string only as prose inside a `### Changes made` entry — not as a stage heading, and therefore not something `/retro` would ever find.
  The correct count of heading-bearing files is **7**.
  Impact: the #843 close comment published "eight historical retro files"; the plan's Background section separately lists **nine** filenames for those 7 files, wrongly including `0546` and `0448` (the latter carries `## Stage: Land — worktree`, a different header).
  No functional consequence — the dual-spelling sentence in `retro.md` works regardless of the count — but two committed artifacts carry a wrong number.
- `other` (overclaim) — **an untested mechanism claim shipped to a permanent GitHub artifact.**
  The build summary and the #843 close comment both assert that a running Pi process keeps the templates it loaded at startup, so the renamed commands are unavailable until a restart.
  This session is direct evidence against at least half of that: the `/retro` body injected at turn 25 contains the `/sync-worktree` text committed at `5df6be89` earlier in this same process, so template **bodies** are re-read from disk per invocation.
  Whether a **newly named file** registers as a new command mid-process remains untested — that is a different question, and no read-only probe for it was available.
  `AGENTS.md`'s own note is hedged (" **can** run the pre-edit copy"); the hedge was hardened into a definite instruction on the way to the issue comment.
  Impact: a possibly-unnecessary instruction published to a closed issue.
- `other` — **a verification-table row that could not have held.**
  The plan's Test Impact Analysis predicted `rg -c 'sync-worktree'` would be non-zero inside `.pi/prompts/sync-worktree.md`.
  A prompt names its counterpart, never itself, so the row was unsatisfiable as written.
  Impact: none — caught during the build by running the sweep rather than assuming it — but it shows the table was authored without mentally executing each row against the post-change tree.

#### What caused friction (user side)

- **The model-pin request arrived after the plan was committed.**
  It landed as a second plan commit (`b2007eaa`), a retro amendment, and a fourth build step.
  Raised during the naming gate it would have folded into the original plan at no extra cost — the gate was already open on exactly these two files.
  Framed as opportunity: model selection is a natural companion question whenever a gate is settling what a prompt *is*.
- **The `/retro-note` on `find /` was well-timed.**
  It captured a cross-cutting concern mid-build without derailing the step, and it is now the only durable record of that ask.
  No change suggested — noting the pattern because it worked.

### Diagnostic details

- **Model-performance correlation.**
  Planning ran on `anthropic/claude-opus-5` (declared in `plan-issue.md`); build inherited `opus-5` (`build-plan.md` declares no `model:`); ship ran on `anthropic/claude-sonnet-5` after a manual operator switch (`ship-issue.md` declares no `model:` either); this retrospective runs on `opus-5` (declared in `retro.md`).
  Subagents: `Explore` on `sonnet-5` for the `../pi` autocomplete trace, and `pre-completion-reviewer` on its declared `anthropic/claude-sonnet-5`.
  No reasoning-weak model landed on judgment-heavy work.
  The notable asymmetry is that the two mechanical stages, `/build-plan` and `/ship-issue`, are the two that declare no model — the build ran on the deliberative model purely by inheritance from planning, and the ship ran on the right one only because the operator switched by hand.
  This issue pinned two prompts for exactly that reason and left the trunk pair unpinned by an explicit Non-Goal.
- **Escalation-delay tracking.**
  No `rabbit-hole` friction points; no sequence exceeded five consecutive tool calls on one error.
- **Unused-tool detection.**
  The count regression needed no subagent and no new tool — only re-running the command planning had already used.
  Nothing was available-but-unused.

### Changes made

1. Posted a correction comment on issue #843 ([comment 5466628855](https://github.com/gotgenes/pi-packages/issues/843#issuecomment-5466628855)) fixing the published count (eight → seven, with the seven filenames listed) and downgrading the untested restart instruction to a precaution.
2. `AGENTS.md` § Shell and search — added the rule that a count re-verified later in a session must be re-derived with the **original** command, not a new pattern (Refs #843).
3. `docs/plans/0843-worktree-ship-flow-command-names.md` — corrected the Background file list, which named nine files for a count of seven; dropped `0448-*.md` (it carries `## Stage: Land — worktree`) and `0546-*.md` (prose mention only), and named the anchored command the count comes from.

Declined: pinning `/build-plan` to `anthropic/claude-sonnet-5`.
The operator left the trunk prompts unpinned, consistent with this issue's explicit Non-Goal.
