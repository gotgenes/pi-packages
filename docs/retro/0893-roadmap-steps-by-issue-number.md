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

[#894]: https://github.com/gotgenes/pi-packages/issues/894
[#900]: https://github.com/gotgenes/pi-packages/issues/900
