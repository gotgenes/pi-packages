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
