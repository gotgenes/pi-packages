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
- **Two self-inflicted slips caught by the gates.**
  The plan's first draft cited a commit SHA (`edf1a1b`) from memory rather than `git rev-parse` — exactly the invention `AGENTS.md` warns about — and wrote `issue #829` as plain text while defining a `[#829]:` reference, which `rumdl` rejected as MD053.
  Both were fixed before the commit.
