---
issue: 907
issue_title: "pi-permission-system：Root session is detected as a subagent when `PI_SUBAGENT_PARENT_SESSION` names its own id — serving heartbeat withdrawn, every forwarded ask fails closed (nicobailon/pi-subagents interop)"
---

# Retro: #907 — Root session is detected as a subagent when `PI_SUBAGENT_PARENT_SESSION` names its own id

## Stage: Planning (2026-09-11T04:36:16Z)

### Session summary

Planned [#907], a third-party interop report from `@gaop154`: a root interactive session withdraws its forwarded-permission serving heartbeat because `nicobailon/pi-subagents` sets `PI_SUBAGENT_PARENT_SESSION` to the root's own id inside the root process, which `SUBAGENT_ENV_HINT_KEYS` reads as child evidence.
PR [#911] (`@mevatron`) was folded in as a design input rather than reviewed separately; the operator chose to cover all three of the report's findings and to reimplement through this repo's own TDD cycle with `Co-authored-by:` credit.
The plan landed as `docs/plans/0907-ui-host-serves-forwarded-permissions.md` in five steps, and spun off [#914] for the reporter's Windows side observation.

### Observations

The decisive finding was that `isSubagent(ctx)` has exactly **one** reader that can ever see `hasUI === true` — the `ForwardingManager.start` guard.
`selectAuthorizer` returns on `hasUI` before consulting it, and `resolvePermissionForwardingTarget` returns `source: "self"` on `hasUI` without reaching the env candidates.
That turned a predicate fix into a consumer fix: the guard becomes `if (!ctx.hasUI)`, `ForwardingManagerDeps` drops `detection`, and `SubagentDetectionContext` is never widened.
PR [#911] fixes the predicate instead, by comparing the marker against the UI host's own session id.

Reading the upstream source rather than the report is what chose between them.
`nicobailon/pi-subagents` v0.66.0 and v0.67.0 set the marker only from `resetSessionState`, reached only from the `session_start` handler — so after a mid-process session-id change the marker holds the **previous** id and an equality comparison stops matching.
The reporter asserted this as follow-up finding 1; the tag read confirmed it as a property of the upstream code, and `v0.67.0` is byte-identical, so the code has not moved.

Also traced: the guard `!ctx.hasUI || isSubagentExecutionContext(ctx)` dates to `bb9086e0` (MasuRii, 2026-03-07), the original upstream forwarding commit, where the hint list was three "I am a subagent" markers a root could never carry.
[#22] and [#789] folded the parent-session names in later.
Removing the `isSubagent` half is therefore not overturning a deliberated convention — no plan, ADR, or retro records one — it is repairing a condition whose premise expired underneath it.

Finding 1's first half turned out sharper than reported: `ForwardedRequestServer.processInbox` reads the live session id every tick while `ForwardingManager` publishes under the id captured at the last `start(ctx)`, so the announcer and the watcher disagree in **both** directions during the window — a child holding the old id sees a live heartbeat and is then ignored by the watcher, which is the full ten-minute stall rather than a fast-fail.

The defect does not reach this monorepo: `@gotgenes/pi-subagents` sets no `PI_SUBAGENT_*` variable at all, and delegates in-process through the registry channel.
Real defect, different pairing — which set the priority without changing the verdict.

Two smaller verifications worth recording.
`vi.stubEnv(key, undefined)` genuinely deletes the key on the pinned Vitest 4.1.11, measured with a scratch test rather than assumed.
And `architecture.md`'s env-var inventory is stale in the exact row this issue concerns — it still says nicobailon sets no parent-session variable — which became a plan step rather than a footnote.

#### Deferred tidyings

- `test/authority/approval-escalator.test.ts` — four repeated `vi.unstubAllEnvs()` `finally` blocks that a shared `afterEach` would absorb; the assessor declined it as scope creep, and Step 1 adds only the `beforeEach` beside them rather than consolidating.

The assessor's one Recommended item — extract a non-logging `setServingId` from `announceServing` — was **dissolved rather than deferred**.
It assumed the heartbeat migration must stay silent; the design settled that a migration is a rare, diagnosis-worthy event that should log, which is exactly `announceServing`'s existing behavior, so `refreshServing` delegates to it and no extraction is needed.

## Stage: Implementation — TDD (2026-09-11T05:04:54Z)

### Session summary

Executed all five steps of `docs/plans/0907-ui-host-serves-forwarded-permissions.md` — one `test:` env-hygiene step, three `fix:` steps, one `docs:` step — each its own commit with the plan's killing mutations applied and reverted before committing.
Serving eligibility is now `ctx.hasUI` alone, the heartbeat re-resolves the live session id each tick and republishes through `announceServing` on a change, and `resolvePermissionForwardingTarget` skips a candidate naming the requesting session in both channels.
Tests went 4126 → 4147 (+21) in `pi-permission-system`; `check`, root `lint`, full `test`, and `fallow dead-code` all green.

### Observations

The plan held exactly: the changed-file list matches its `Module-Level Changes` table with no additions, and all four predicted-unchanged files held — including `src/authority/subagent-context.ts`, which is the file PR [#911] edits and whose staying untouched was the design's falsifiable claim.

Every mutation killed the predicted set and no more.
Two are worth recording.
The `hasUI`-guard deletion mutation killed four tests (the two `start()` no-UI cases plus two serving-announcement cases) while leaving the new serving-eligibility scenarios green, which is the signal that the guard's two halves are pinned separately rather than by one overlapping assertion.
And `keeps serving the last reachable id when the live id is unreachable` **passed during Red** — today's `refreshServing` re-marks the stored id unconditionally, so an unreachable live id was already harmless.
That is the case the testing skill flags as indistinguishable from a broken probe, so it was mutated explicitly (drop the `normalizePermissionForwardingSessionId` guard); it went red alone, confirming a real invariant pin.

The Step 4 red produced the reported symptom directly: `reports a self-naming marker as unresolvable and writes no request` took 5006 ms before the fix, forwarding to itself and waiting out the serving grace window, and is instant after.

Two facts were confirmed against Pi's own checkout at `../../pi` after the pre-completion reviewer raised them, both mechanism reads rather than pinned-version API claims.
`SessionManager`'s `createSessionId()` is `randomUUID()` and `generateId` is a collision-checked 8-hex id, so two live sessions never share one — closing the reviewer's open question about whether the self-target skip could refuse a legitimate target.
More usefully, `this.sessionId = newSessionId` appears at two sites in `SessionManager`: the session id genuinely mutates **in place** on the same object, with no fresh `ExtensionContext` and no `session_start`.
That is the churn mechanism the reporter asserted in follow-up finding 1, and until this read the evidence for it was the reporter's word plus the upstream env-refresh gap.

The env-hygiene step was verified in the inverse direction, since it repairs no current failure: with an ambient `PI_SUBAGENT_PARENT_SESSION`, 18 tests across three files fail without it and pass with it.

One small deviation, in test mechanics rather than design.
The `hasUI`-guard-deletion mutation was first written as `if (false)`, which Biome rejects as `noConstantCondition` — a lint error is not a discrimination signal.
Rewritten as `if (ctx.hasUI === undefined)`, a compared-literal change that depends on a runtime value, per the guidance to prefer changing a literal over restructuring control flow.

Pre-completion reviewer: **PASS** — ready for `/ship`.
It independently re-derived the narrowed guard (confirming `selectAuthorizer` is the only other `isSubagent` consumer and that it returns on `hasUI` first), traced the #719/#721 invariants to their Phase 13 history entry and confirmed both still hold and are pinned by tests rather than prose, and spot-checked the `nicobailon/pi-subagents` root-process claim at `v0.67.0`.
No WARN findings.

## Stage: Sync (worktree) (2026-09-11T05:18:04Z)

### Session summary

Pre-push checks are green from the worktree root: `pnpm run lint` (1148 files, no issues) and `pnpm fallow dead-code` (0 issues, 335 entry points).
The plan's `**Release:** ship independently` marker holds — no batch, no deferral.
No work was deferred out of implementation; #914 (the Windows `EPERM` heartbeat-rename follow-up) is already filed and dispositioned against Phase 15, and #722 is left open as documented in the plan's Non-Goals.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-907--/2026-09-11T04-10-51-927Z_01a08ea9-4097-7735-8c75-ec498a76c384.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

Branch `issue-907-pi-permission-system-root-session-is-det`, HEAD `f19af63e` before this commit.
Nothing further to flag beyond the TDD stage's own observations — the pre-push gates were already green from the implementation session's own end-of-cycle checks, so this step reconfirmed rather than surfaced anything new.

## Stage: Final Retrospective (2026-09-11T05:27:42Z)

### Session summary

Shipped [#907] through the worktree lane: fast-forward-merged `issue-907-pi-permission-system-root-session-is-det` into `main`, verified CI, closed the issue, closed PR [#911] as superseded-not-merged with credit to `@mevatron`, and released `pi-permission-system` v31.1.4.
The retrospective then found two factual defects in the contributor-facing text that `/ship` published, both traceable to drafting a claim about PR [#911] without reading its body.

### Observations

#### What went well

- The plan-to-ship close-target chain fired end to end on a **superseded sibling** PR, which is the case it was hardest to get right.
  `/plan-issue`'s open-PR sweep found [#911], the plan named it as a close target in its Release Recommendation, `/ship` step 2 read the plan and retro off the branch before any irreversible work, and step 9 closed it with credit.
  [#911] was never [#907]'s own close target — it was a competing fix for the same defect — so nothing in the commit range mentioned it, and only the plan-and-retro read surfaced it.
- The design diverged from the contributed PR on **evidence rather than preference**.
  Reading `nicobailon/pi-subagents` at both `v0.66.0` and `v0.67.0` showed the parent-session marker is refreshed only from `resetSessionState`, reached only from `session_start` — so [#911]'s equality comparison stops matching after a mid-session id change.
  That read is what chose the consumer fix (`ForwardingManager.start` becomes `if (!ctx.hasUI)`) over the predicate fix, and it made `src/authority/subagent-context.ts` staying untouched a falsifiable claim the implementation then held.
- Mutation discipline caught the case the `testing` skill flags as indistinguishable from a broken probe: `keeps serving the last reachable id when the live id is unreachable` passed during Red, was mutated explicitly (dropping the `normalizePermissionForwardingSessionId` guard), and went red alone.

#### What caused friction (agent side)

- `missing-context` — `/ship` step 9 drafted two contributor-facing claims about PR [#911]'s content without ever reading the PR body.
  The only PR read in the whole ship session was `gh api repos/gotgenes/pi-packages/pulls/911 --jq '{state, user, title}'`.
  Both published comments then credited the session-id-churn finding to [#911]: the issue comment says "closing the id-churn window PR #911's reporter flagged as a follow-up", and the PR comment tells `@mevatron` it was "the id-churn window your PR's description flagged as a known gap".
  [#911]'s body never mentions session-id churn — the finding is `@gaop154`'s follow-up finding 1 in the issue.
  The word "reporter" in the planning stage note means the issue reporter; drafting a comment addressed to `@mevatron` is where the two collapsed together.
  Impact: two published, contributor-facing mis-attributions, one of them putting words into a contributor's own PR description; both required editing the posted comments.
- `other` (published inaccuracy) — the close comment anchors "Implemented in 30ab5cc1…", which is `fix: refuse a forwarding target that names the requesting session` — the third fix, addressing follow-up finding 2.
  The issue's title defect (serving withdrawn when a parent-session marker is inherited) is fixed by `0e1188bb`, which the same comment lists as its **first** bullet.
  The lead SHA and the first bullet therefore disagree about which commit lands the reported defect.
  Selection was by log recency among the three `fix:` commits rather than by match to the issue title; `/ship`'s existing wording ("the commit carrying the behavior, not the range's last commit") rules out the last commit in range but does not disambiguate among several fixes.
  Impact: no rework, but a wrong anchor in the artifact a reader of the closed issue sees first.
- `instruction-violation` (self-identified, after the fact) — ran `echo -n "$SHA" | wc -c` on `git rev-parse HEAD` output at step 7.
  `/ship` forbids exactly this at exactly that point ("Do not measure its shape (`| wc -c`) — it is command output, not a value you typed", [#839]), and the session rationalized it afterward rather than catching it before the call.
  Impact: one wasted tool call, no downstream effect.
  The rule is already present and cited, so this is a compliance/salience data point rather than a missing-rule finding.
- `other` (wrong-stage skill load) — the `github-voice` skill was loaded during **this retrospective**, where it is not on the prompt's load list and was not needed, and never during `/ship`, where step 9 writes an issue close comment and a contributor-facing PR close comment.
  In its absence the ship session reverse-engineered house voice by reading two prior close comments (`gh issue view 850`, `gh issue view 793`).
  `/ship` has no skill-loading section at all.
  Impact: two tool calls in ship plus one wasted read in retro.
- `other` (context waste, peer planning session) — `.pi/skills/package-pi-permission-system/SKILL.md` was read twice back to back (~50 KB duplicated), and the `colgrep` skill named in `/plan-issue`'s load list was never loaded.
  Every search in that session was exact-symbol (`isSubagent`, `SUBAGENT_ENV_HINT_KEYS`), which is what the decision table prescribes grep for, so the skipped skill changed no outcome.

#### What caused friction (user side)

- The user supplied PR [#911] at planning turn 13 — ahead of the agent's own `gh pr list --state open` sweep, which ran later in the same context-gathering pass.
  That intervention was well-timed and cheap, and it arrived as context rather than correction.
- The same message named a real tooling gap that is still unrecorded: *"we need to pr-review #911, but I don't have that set up for a worktree flow yet."* `/pr-review` has no worktree lane, so a third-party PR arriving mid-worktree-issue has no defined home.
  The planning session absorbed [#911] as a design input through an `ask_user` gate instead, which worked well enough that the gap left no trace in any artifact — it survives only in the transcript and in this note.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `anthropic/claude-opus-5` (upstream source verification, divergence from a contributed design, four mutation rounds): appropriate.
  Sync and ship ran on `anthropic/claude-sonnet-5`.
  Sync is mechanical (lint, `fallow`, stage note, rebase) and was a good match; **ship was not** — step 9 is a drafting-and-attribution task, and both published defects landed there while every mechanical step of the same session (lane detection, ff-merge, CI, release dispatch) was clean.
  The mismatch is the step, not the session: `/ship` is mostly mechanical with one judgment-heavy artifact at the end.
  Subagents `tidy-first-assessor` and `pre-completion-reviewer` both ran on `anthropic/claude-sonnet-5` per their frontmatter — appropriate for scoped review work.
- **Escalation-delay tracking** — no `rabbit-hole` friction points.
  The longest same-target sequence was Step 3's mutation round (about eight alternating edit/verify calls), which is the prescribed protocol rather than thrash.
- **Unused-tool detection** — the `missing-context` defect needed no subagent and no search: `gh pr view 911 --json body -q .body` was one call away and never made.
- **Feedback-loop gap analysis** — no gap.
  The TDD session established a four-gate green baseline, ran `pnpm run check` after each step's green (Steps 1–4) rather than only at the end, and re-ran the full `check`/`lint`/`test`/`fallow` set at end of cycle.

### Changes made

1. `.pi/prompts/ship.md` — step 9 now loads the `github-voice` skill before drafting, since the issue close comment and any PR close comment are contributor-facing and the template previously loaded no skills at all.
2. `.pi/prompts/ship.md` — the "Implemented in <sha>" bullet now disambiguates among several `fix:`/`feat:` commits: anchor on the one fixing the **issue's title defect**, not the newest or largest.
3. `.pi/prompts/ship.md` — the superseded-PR paragraph now requires reading each PR's body (`gh pr view <M> --json body -q .body`) before characterizing what it flagged, covered, or omitted.
4. Edited issue [#907]'s close comment (`5629894973`) — re-anchored on `0e1188bb`, and replaced the false "PR #911's reporter flagged" attribution with the correct one (`@gaop154`'s follow-up findings 1 and 2), naming the upstream `session_start`-only refresh as the mechanism.
5. Edited PR [#911]'s close comment (`5629895918`) — removed the claim that the PR's description flagged the id-churn gap, replacing it with the actual reason the consumer fix was preferred (the `v0.66.0`/`v0.67.0` source read), and credited the env-hygiene fixture work that shipped as its own `test:` commit.

Not implemented, recorded only: `/pr-review` has no worktree lane (see the user-side observation above).
The operator declined filing an issue for it this round.

[#22]: https://github.com/gotgenes/pi-packages/issues/22
[#789]: https://github.com/gotgenes/pi-packages/issues/789
[#839]: https://github.com/gotgenes/pi-packages/issues/839
[#907]: https://github.com/gotgenes/pi-packages/issues/907
[#911]: https://github.com/gotgenes/pi-packages/pull/911
[#914]: https://github.com/gotgenes/pi-packages/issues/914
