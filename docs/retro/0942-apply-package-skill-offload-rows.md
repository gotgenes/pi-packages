---
issue: 942
issue_title: "Apply the 19 package-skill offload rows from the 2026-09-17 agent-doc audit"
---

# Retro: #942 — Apply the 19 package-skill offload rows from the 2026-09-17 agent-doc audit

## Stage: Planning (2026-09-19T06:21:20Z)

### Session summary

Measured the two package skills (`package-pi-permission-system` 12,859 words with 8,406 inside the 18 offload regions; `package-pi-subagents` 2,681 with 177), surveyed every row's destination with a background `Explore` dispatch, and gated four open design choices.
Wrote `docs/plans/0942-apply-package-skill-offload-rows.md`: a per-row disposition table (`already-stated` / `partial` / `absent`), a removed-line probe adapted from #937's moved-line check, and 11 build steps ordered by skill section.
No follow-up issues filed — the one candidate defect the survey reported did not survive verification.

### Observations

- **The audit's `offload` verdict assumed the destination was empty, and it usually is not.**
  `architecture.md`'s `## Module structure` tree and the fourteen ADRs already carry most of these passages, often near-verbatim with the same symbol names and issue refs.
  Eleven of nineteen rows are therefore applied as a cut plus a pointer, with no destination edit at all.
  This is the finding that reshaped the job from "move 8,406 words" into "delete most of them and confirm the destination already says it".
- **Operator decisions at the gate**: per-row disposition rather than verbatim-append-everywhere; all mechanism prose routes to `architecture.md` and no ADR is amended; Debugging steps 5–6 go to a new `docs/architecture/investigating-a-report.md` rather than being split across six retro files; rows 4–5 go to `docs/subagent-integration.md` and the resulting patch release of `pi-permission-system` is accepted.
- **The verification instrument had to change shape.**
  Issue #937's moved-line check asserts every removed line appears at a destination.
  Here the dominant disposition is *delete*, so the probe's output is an input to a three-way classification (already-stated / residue / deliberate drop) rather than a pass-fail.
  Dry-run against #937's `b649d3ea`: 56 removed lines, zero missing.
- **A subagent contradiction did not survive verification.**
  The survey reported that the skill's "heartbeat records live beside `sessions/`, never inside it" contradicts the code, reading `sessions/` as the agent-dir sessions directory.
  Reading `extension-paths.ts:47`, `permission-forwarding.ts:70`, and `forwarding-liveness.ts:176` shows the request/response records sit at `forwardingDir/sessions/<id>/` and the heartbeats at `forwardingDir/serving/` — beside that `sessions/` directory, exactly as documented.
  Had this gone into the plan unchecked it would have authorized a "correction" that introduced an error.
- **The survey also found one genuinely absent row and one misfiled destination.**
  Row 16 (`shellTools` aliasing) has no architecture-doc entry at all — its only occurrence there is inside a roadmap step body — so it is the plan's single `absent` row.
  Row 12's closing sentence is testing guidance, not architecture, and is relocated into the skill's own `## Testing` rather than offloaded.
- **`always-loaded` does not move.**
  Package skills load on demand, so this change's benefit is paid to every session that touches `packages/pi-permission-system/` rather than to every session.
  The plan pins `agentsMd=1863 descriptions=562 total=2425` as an invariant precisely because a change there would mean a description was edited by accident.
- **One unapplied `compress` row was found in the same file** — `(Refs #547)` in `## Configuration`, whose sibling `(Refs #646)` #934 did apply.
  Folded into the plan's last step rather than filed: one row from the same table, one deletion.
- **Tidy-First assessment skipped**: no `src/` or `test/` files are touched.

#### Deferred tidyings

None — the assessor was not dispatched (docs-only change).

## Stage: Implementation — Build (2026-09-19T07:03:59Z)

### Session summary

Executed all 11 plan steps as 11 `docs:` commits, from "move tool-surface, gate-ordering, and capability-axis mechanism into the architecture doc" through "finish the 2026-09-17 offload rows and clear orphaned link definitions", applying every one of the 19 offload rows plus the one stray `compress` row.
`package-pi-permission-system` went from 12,859 to 5,451 words and `package-pi-subagents` from 2,681 to 2,533 (measured with `wc -w`); `always-loaded.mjs` is unchanged at `total=2425`.
Pre-completion reviewer: PASS.

### Observations

- **The already-stated share was even larger than planning predicted.**
  Row 17's bullets turned out to be verbatim in ADR 0003 (the probe found most of them without any classification), and rows 15 and 18 needed only a handful of residue clauses against ~45 module-tree entries.
  The residue for the whole change is roughly 25 clauses appended to existing module-tree entries, one extended entry (`tool-kind.ts` for `shellTools`), five sentences in `subagent-integration.md`, and one new page.
- **The probe's output had to be classified by claim, not by line.**
  Every step's probe printed every removed line, because the destination states the same claim in different words; the useful work was the per-claim grep (`grep -rlF '<distinctive phrase>' docs/`) against the row's named destination region, done before each cut.
  Seven greps per row was typical; the survey's `partial` verdicts were right in every case but one.
- **One survey finding was overturned during planning, and one plan detail during the build.**
  Planning: the "heartbeat records live beside `sessions/`" contradiction was a misread of which `sessions/` directory.
  Build: the row 16 residue extended the existing `tool-kind.ts` entry rather than adding a new entry beside it, because `resolveShellInvocation` lives in that file; the row 4 latch constraint went to the `child-node-audit.ts` entry rather than the integration spec, because it constrains this package rather than an adapter.
- **Cutting with an anchor-bounded script was safer than a 30-line `oldText`.**
  A small `node` script that deletes from a start-anchor line to an end-anchor line (exclusive) and splices in a replacement file made each cut deterministic and re-readable; it dropped a paragraph blank line twice, both caught by the immediate `sed -n` re-read.
- **Orphaned link definitions were the only lint findings**, eleven across the two skills, each caught by the per-step `rumdl check` and removed in the same commit.
- **The released commit is exactly one** ("document the serving-liveness and bound-channel mechanism in the integration spec", `subagent-integration.md`); `next-version.sh pi-permission-system` now reports a patch bump, as the plan's Release Recommendation predicted.

## Stage: Sync (worktree) (2026-09-19T07:09:42Z)

### Session summary

Pre-push checks (`pnpm run lint`, `pnpm fallow dead-code`) both pass clean.
Docs-only change, ship independently; the one released commit ("docs(pi-permission-system): document the serving-liveness and bound-channel mechanism in the integration spec") cuts a `pi-permission-system` patch release, as planned.
No follow-up issues to hand off.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-942--/2026-09-19T06-04-20-335Z_01a0b844-03ee-77b8-b352-5045cc14de09.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

Nothing beyond the Planning and Implementation stage notes above; this is a breadcrumb for `/ship` and the final `/retro`.

## Stage: Final Retrospective (2026-09-19T07:22:06Z)

### Session summary

Shipped #942 through the worktree lane: fast-forward-merged `issue-942-apply-the-19-package-skill-offload-rows` into `main`, re-ran both pre-push gates on the merged tree, pushed, verified CI green, closed the issue, dispatched and verified the `pi-permission-system` v33.0.1 release, and tore down the worktree.
All four stages — planning, build, sync, ship — completed with no rework, no reverted commit, and no operator correction.
The retrospective spans all four; the peer transcript was read in full for message-level detail.

### Observations

#### What went well

- **A subagent's reported contradiction did not survive verification, and that check was load-bearing.**
  The planning `Explore` survey reported that the skill's "heartbeat records live beside `sessions/`, never inside it" contradicted the code.
  Planning read `extension-paths.ts`, `permission-forwarding.ts`, and `forwarding-liveness.ts` and found the survey had misread *which* `sessions/` directory.
  Had the claim gone into the plan unchecked, the build would have "corrected" a correct sentence into a wrong one — this is the `delegation` rule about a subagent's universal claim earning its place in a concrete, non-hypothetical way.
- **The `/sync-worktree` dangling-SHA check fired on real breakage.**
  The rebase rewrote three SHAs that the planning and build stage notes cited (`04e3edf8`, `20ebdb16`, `5cd4eca5`).
  The step-5 probe found all three, the sync stage rewrote each to its commit subject and amended.
  Without it, `main` would carry a retro citing three unreachable hashes — the exact #814/#914 failure the check was built for.
- **Measuring the destinations reframed the whole job.**
  The audit's `offload` verdict assumed empty destinations; planning measured and found 11 of 19 rows already stated at the destination, often verbatim.
  The job changed from "move 8,406 words" into "delete most of them and confirm the destination already says it", which is why the residue was ~25 clauses rather than a second copy of the skill.
- **Verification ran per-row and per-step, not at the end.**
  Roughly seven destination greps per row before each cut, a removed-line probe after each cut, `rumdl check` before each commit, and `pnpm run lint` at both baseline and close-out.
  The ship then re-ran both gates on the merged tree — the tree neither `/sync-worktree` nor the build had checked, since the rebase came after the peer's gates.

#### What caused friction (agent side)

- `instruction-violation` (self-identified) — attributing models for the diagnostic lens, I grepped `$PI_SESSION_FILE` for `model_change` events and correlated them against user-message timestamps with a `python3` script.
  The `/retro` prompt explicitly forbids this route ("never `jq` over `$PI_SESSION_FILE`") and names the hazard: a `model_change`-derived attribution can render phantom switches that never ran a turn (Refs #737).
  Impact: about 5 tool calls, two of which were a `python3` script that had to be rewritten once for the message envelope shape.
  Self-corrected by re-deriving attribution from the per-turn `model` fields, which confirmed the same answer (36 ship turns on `claude-sonnet-5`) — so no wrong conclusion was published, only wasted calls.
  This friction already has an owner: #940 and #944 in the session-tools trio (triage rank 21), and the triage notes the same lens cost three calls during #934.
- `other` — in `/ship` step 5 I appended `; echo "EXIT=$?"` to `pnpm run lint >/tmp/lint.log 2>&1 || tail -30 /tmp/lint.log`.
  `$?` there reports the `||` compound's status, which is 0 both when lint passes and when lint fails but `tail` succeeds, so the printed `EXIT=0` was not evidence of a clean lint.
  Impact: one extra tool call to re-read the log; no rework.
  The prescribed idiom already self-reports — silence means pass — so the appended echo only added a number that looks authoritative and is not.
- `other` — the build stage's anchor-bounded `cut942.mjs` script dropped a paragraph blank line twice (before "The live-authority layer" and before `## Testing`).
  Impact: caught by the immediate `sed -n` re-read each time and fixed in the same step; no rework.
  The script was still the right instrument — it made each cut deterministic where a 30-line `oldText` would have been fragile.
- `other` — eleven orphaned `[#N]:` link definitions accumulated across the cuts, each found reactively by that step's `rumdl check` and removed with a `perl -ni` one-liner.
  Impact: friction only; MD053 caught every one before its commit.
  Predictable consequence of cutting prose that cites issues, but the lint gate is deterministic here, so anticipating it in the plan would have saved little.

#### What caused friction (user side)

Nothing to report.
The operator's involvement was concentrated in the one planning gate, where four design choices were settled at once — per-row disposition, `architecture.md` as the sole mechanism destination, a single `investigating-a-report.md` page instead of six retro edits, and accepting the `pi-permission-system` patch release from rows 4–5.
All four held through the build without revision, which is what let three later stages run unattended.

### Diagnostic details

- **Model-performance correlation** — Planning `anthropic/claude-opus-5` (judgment-heavy: reframing the job, the four-part operator gate); Build `anthropic/claude-fable-5-1` (11 doc steps with per-claim verification — it overturned two plan details mid-execution); Sync and Ship both `anthropic/claude-sonnet-5` (procedural, zero rework across both); this retrospective `anthropic/claude-opus-5`.
  Both subagents ran `claude-sonnet-5`, attributed from their own transcripts under `…/tasks/`.
  The one mismatch worth naming: the planning `Explore` survey was the most judgment-heavy dispatch in the issue — 19 rows, each needing a three-way destination classification — and it produced the false `sessions/` contradiction plus `partial` verdicts that the build later found "right in every case but one".
  The workflow caught both, so the assignment was survivable, but this is the dispatch where a stronger model would have paid.
- **Escalation-delay tracking** — no `rabbit-hole` friction points, and no sequence of 5+ consecutive calls on the same error.
  The longest same-target run (build turns ~56–67, about 12 calls on row 3's destination claims) was deliberate per-claim verification, not an error loop.
- **Feedback-loop gap analysis** — the inverse of the failure mode this lens looks for: verification was incremental at every stage, and the ship re-ran both gates on the post-rebase merged tree that no earlier stage had checked.
  No gap found.

### Changes made

1. `docs/retro/0942-apply-package-skill-offload-rows.md` — appended this Final Retrospective stage entry.

No changes to `AGENTS.md`, `.pi/prompts/`, or any skill.
Each candidate was rejected against the `AGENTS.md` admission test or as redundant with a working gate:

- The `$PI_SESSION_FILE` attribution violation is a rule that already exists and names its incident (Refs #737); the friction has a tooling owner in #940 and #944.
- The `echo "EXIT=$?"` slip is stated twice already — the `git-workflow` skill's `## Gating a commit on a check` section and `/ship`'s pre-push step.
- The orphaned `[#N]:` definitions are gated deterministically by `rumdl`'s MD053, which caught all eleven before their commits.
- A `delegation` note on model choice for wide classification sweeps had no crisp trigger, and the workflow already caught the survey's one false finding.
