---
issue: 893
issue_title: "Improvement roadmap: identify steps by issue number, order sections by working sequence"
---

# Retro: #893 — Improvement roadmap: identify steps by issue number, order sections by working sequence

## Stage: Planning (2026-09-07T19:40:44Z)

### Session summary

Planned the roadmap-format change that replaces step ordinals with GitHub issue numbers and makes section order the working sequence.
The plan lands in `docs/plans/0893-roadmap-steps-by-issue-number.md` as six `docs:` commits across eight `.pi/` files — three more than the issue listed.
Filed [#900] for a `rumdl` pin re-evaluation the operator asked about mid-gate, keeping it out of this change.

### Observations

The issue's touchpoint list was three files short.
`.pi/prompts/tdd-plan.md` L150 and `.pi/prompts/build-plan.md` L115 both hardcode `grep -c '✅.*Step <N>'` as a hard gate, which returns 0 against a new-format heading — the first new-format step to land would have failed its own completion verification.
`.pi/prompts/retro.md` L218 carries stale "numbered step" vocabulary.
The operator scoped the change to all eight; `.pi/skills/package-pi-permission-system/SKILL.md` L21 stays as a recorded residual.

The sharpest finding is that only `/finish-phase` needs genuine dual-shape detection.
Re-keying the `✅` gate on the issue number instead of the ordinal is shape-agnostic: `grep -cE '✅.*#878\b'` returns 2 against both the live ordinal roadmap and a new-format sample, because the heading already carries `([#878])` and the Mermaid node already carries `(#878)`.
That turned a predicted compatibility burden into a simplification.

Everything asserted about the format was measured rather than argued: `rumdl check` and `fmt` byte-identity under the pinned 0.2.24 **and** under 0.2.68, `mmdc` on the `S<issue>` node form, the dual regex at 19 / 7 / 2 against the two live roadmaps and a sample with zero false positives, and the falsification that both current commands return 0 under the new shape.
The `rumdl` sample check needed `--config .rumdl.toml` — the tool does not discover repo config for a file outside the repository, so an uninstrumented run reports spurious MD013 line-length findings against the default 80-character limit and reads as a format failure.

The scripted-edit hazard is the main implementation risk.
`plan-improvements.md`, `finish-phase.md`, and `retro.md` each number their **own** workflow steps (`### Step 1`–`### Step 8`, `## Step 1`–`## Step 6`, `## Step 1`–`## Step 10`), so a `Step N` sweep would destroy them.
Every Build Order step's verify includes a heading-count assertion for exactly that reason.

On the operator's `rumdl` question: rvben/rumdl#840 is closed but is **not** what holds our pin — `pnpm-workspace.yaml` names rvben/rumdl#811, also closed.
Measured 0.2.68 anyway: 481 MD013 findings across 305/1132 files versus 0 at 0.2.24, mixing genuine violations with a still-live false join where a sentence opening with a reference link is spliced onto the previous line.
That shape is common in this repo's long-lived docs, so the bump needs its own triage — filed as [#900].
The `roadmap-fit` skill exited at its first step: [#900] is `scope:repo` with no `pkg:*` label and no resolvable package, so there is no open phase to disposition it against.

The Tidy-First assessment was skipped per the `tidy-first` skill's applicability gate — this change touches no `src/` or `test/` files.

## Stage: Implementation — Build (2026-09-07T22:33:16Z)

### Session summary

Executed all six Build Order steps plus a seventh remediation commit, across eight `.pi/` files.
Roadmap steps are now identified by issue number (`#### ✅ [#878] Title`), section order is the working sequence, `/plan-improvements` files issues before writing the roadmap in one commit, and `/finish-phase` detects both heading shapes while `/tdd-plan` and `/build-plan` key their `✅` gate on the issue number instead of the ordinal.
Pre-completion reviewer: WARN, no blocking findings.

### Observations

Every number the plan predicted reproduced exactly at execution time, and the reviewer re-derived them independently rather than accepting them: the dual regex returns 19 / 7 / 2 against the two live roadmaps and the sample with zero non-step-heading false positives, the issue-keyed `✅` gate returns 2 for `#878`, `#872`, `#857`, and `#830`, and both superseded commands return 0 against the new shape.
The reviewer also confirmed each edited file kept its **own** workflow-step headings intact (`plan-improvements.md` 8, `finish-phase.md` 6, `retro.md` 10) — the scripted-edit hazard the plan flagged did not fire, because every edit was hand-placed.

Two deviations, both small.
The `roadmap-fit` disposition-table clause landed as a paragraph below the table rather than inside a row cell: the first attempt put prose between two table rows, which `rumdl` correctly rejected with `MD075` ("Pipe-formatted rows without a table header/delimiter row").
And `plan-improvements.md`'s verify criterion predicted zero `link.back` hits; it returns one, the new sentence stating the link-back pass is gone.

The reviewer's WARN was an under-count in the plan's own record rather than a defect in the change.
`.pi/agents/pre-completion-reviewer.md` L123 described the roadmap-status check as counting a "numbered step" — the very gate this change re-keys — so that one word was corrected, and `.pi/skills/package-pi-permission-system/SKILL.md` turned out to carry two instances of ordinal vocabulary rather than the one the plan recorded.
Both of the latter stay per the operator's scope decision; the plan now names both.
The narrow grep (`numbered roadmap step`) is what under-counted — the bare phrase `numbered step` is the pattern that finds them, and that widening is now written into the plan's verify step.

One sharpening worth carrying forward: the issue-keyed `✅` gate reports `1` rather than `0` for an incomplete step whose Mermaid arrow line begins with a **completed** upstream node (`S17["✅ … (#889)"] --> S19["Step 19 (#898)…"]`).
The gate asserts exactly 2, so an incomplete step is still refused, and the ordinal-keyed predecessor had the identical property — pre-existing, not introduced by the re-keying.

No `src/`, `test/`, or `.ts` file was touched and nothing under `packages/` changed, so this ships no package release.

## Stage: Sync (worktree) (2026-09-08T01:53:44Z)

### Session summary

Pre-push checks (`pnpm run lint`, `pnpm fallow dead-code`) both pass clean with no fixes needed.
This is a docs/`.pi/`-only change with no `packages/` files touched, so the plan's `**Release:** ship independently` marker is moot — nothing releases regardless.
Two follow-ups are already filed and dispositioned: [#894] (derive the working sequence from priority/dependencies, explicitly deferred until this format lands) and [#900] (rumdl pin re-evaluation, independent of this change).

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-893--/2026-09-07T19-23-57-043Z_01a07d53-c4f2-754e-8441-d091e4aa2336.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

Nothing deferred to root beyond the standard ff-merge and issue close.
The pre-completion reviewer's WARN (an under-counted residual in the plan) was already remediated in a follow-up commit during the build stage; nothing outstanding from that review.

## Stage: Final Retrospective (2026-09-08T02:47:52Z)

### Session summary

Shipped #893 through the worktree lane: fast-forward-merged the peer branch, ran the pre-push gates on the merged tree, pushed, verified CI green, closed the issue with a commit-anchored summary, and tore down the worktree.
Nothing released — the change touches only `.pi/` and `docs/`, so no package has a releasable commit.
This retrospective spans all four stages (planning, build, sync, ship) across two sessions.

### Observations

#### What went well

- **Every load-bearing claim was measured, not argued.**
  The planning stage verified the proposed heading form under `rumdl` 0.2.24 *and* 0.2.68 (check clean, `fmt` byte-identical), rendered the Mermaid node form through `mmdc`, and ran the dual-shape regex against both live roadmaps plus a synthetic sample (19 / 7 / 2, zero false positives).
  It also ran the *falsification*: both superseded commands return 0 against the new shape.
  The pre-completion reviewer then re-derived each number independently rather than accepting them.
- **A predicted compatibility burden dissolved under measurement.**
  The issue implied every consumer would need dual-shape detection.
  Measuring `grep -cE '✅.*#878\b'` against the live ordinal roadmap returned 2 — the heading already carries `([#878])` and the Mermaid node already carries `(#878)` — so re-keying the `✅` gate on the issue number is shape-agnostic and only `/finish-phase` needed genuine dual detection.
  This turned a fork into a simplification.
- **The scripted-edit hazard was identified at planning time and never fired.**
  `plan-improvements.md`, `finish-phase.md`, and `retro.md` each number their own workflow steps, so a `Step N` sweep would have destroyed them.
  Every edit was hand-placed, and every Build Order step carried a heading-count assertion (8 / 6 / 10, all intact).
- **The peer-transcript breadcrumb paid off for the first time in this retro.**
  The sync stage recorded its own session path inline, and `read_session_file` rendered the full peer transcript here — message-level attribution for a two-session issue at one tool call, with the worktree already torn down.
- **Verification was incremental, not end-loaded.**
  The build stage ran `pnpm exec rumdl check` on each edited file *before* its commit, on a green `lint` + `check` baseline.
  Two defects (an `MD075` table split, a missing `[#894]:` definition) were caught at the file that introduced them.

#### What caused friction (agent side)

- `other` — `rumdl` does not discover repo config for a file outside the repository.
  The planning stage checked a scratch sample in `/tmp` and got spurious `MD013` findings against the default 80-character limit, which read as a format failure until `--config .rumdl.toml` was passed.
  Impact: one extra tool call and a moment of false alarm about the proposed format; self-identified.
- `other` — the residual-vocabulary grep used the long phrase.
  The plan swept `numbered roadmap step` and recorded one surviving instance; the bare phrase `numbered step` was the pattern that finds them, and there were three (including one in `.pi/agents/pre-completion-reviewer.md` describing the very gate this change re-keys).
  Impact: the pre-completion reviewer's WARN, plus a seventh remediation commit (`docs: correct the residual accounting for roadmap step ordinals`).
- `other` — an `Edit` on `docs/plans/0893-roadmap-steps-by-issue-number.md` failed to match mid-build, and the fallback was a `python3` heredoc doing string replacement on the plan.
  The file had been reflowed by `pi-autoformat` after the preceding write.
  Impact: three extra tool calls; the scripted replacement asserted its match counts, so it was safe, but re-reading the region would have been the cheaper path.
- `instruction-violation` (self-identified) — the planning stage authored scratch markdown and a `.mmd` fixture with shell heredocs before switching to the `Write` tool, and one compound command aborted because `grep -c` exits 1 on a zero count.
  Both rules are already in `AGENTS.md`.
  Impact: two retried tool calls, no rework.

#### What caused friction (user side)

None.
The operator's two interventions were both strategic rather than mechanical: scoping the change to all eight touchpoints once planning surfaced that the issue's list was three short, and asking about the `rumdl` pin mid-gate — which produced a measured answer ([#900]) instead of an assumption, and correctly stayed out of this change.

### Diagnostic details

- **Model-performance correlation** — allocation matched task weight with no mismatch.
  Planning and Build ran on `claude-opus-5` (format design, cross-artifact impact analysis, four `ask_user`-gated decisions); Sync and Ship ran on `claude-sonnet-5` (checks, rebase, ff-merge, close-comment assembly — mechanical, with deterministic verification at each step).
  The one subagent dispatch, `pre-completion-reviewer`, ran on its pinned `anthropic/claude-sonnet-5` and independently reproduced every measurement rather than accepting the plan's numbers.
- **Escalation-delay tracking** — no `rabbit-hole` friction points.
  The two longest same-error sequences were four tool calls each (the failed plan-file `Edit` at build, and the missing `[#894]:` definition at sync), both under the five-call threshold and both resolved by locating the real anchor with `grep` rather than retrying blind.
- **Feedback-loop gap analysis** — no gap.
  `pnpm run lint` and `pnpm run check` established a green baseline before step 1, `rumdl check` ran per-file before each of the seven commits, and the two pre-push gates ran again at ship on the merged tree (the tree neither `/sync-worktree` nor the build stage had checked, since the rebase happened between them).

### Changes made

1. `.pi/prompts/ship.md` — step 8's repo-root-tooling test now keys on whether the shipped range touches any `packages/` file, rather than on the plan living under `docs/plans/`.
   Step 10.1 already states that a `docs/plans/` plan is cross-package as often as it is repo tooling, so the two steps were reading the same signal in opposite directions.
2. `.pi/skills/markdown-conventions/SKILL.md` — recorded that `rumdl` does not discover repo config for a file outside the repository, so a scratch sample in `/tmp` needs `--config .rumdl.toml` or MD013 fires against the default 80-character limit.

A third proposal — adding a rule to `/plan-issue` to grep the shortest distinctive phrase when sweeping a prose vocabulary — was declined by the operator and is recorded here only as the friction point above.

[#894]: https://github.com/gotgenes/pi-packages/issues/894
[#900]: https://github.com/gotgenes/pi-packages/issues/900
