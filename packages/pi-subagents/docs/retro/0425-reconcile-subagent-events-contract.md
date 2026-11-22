---
issue: 425
issue_title: "pi-subagents: reconcile the public SUBAGENT_EVENTS contract with emitted channels"
---

# Retro: #425 — pi-subagents: reconcile the public SUBAGENT_EVENTS contract with emitted channels

## Stage: Planning (2026-06-18T00:00:00Z)

### Session summary

Planned Phase 18 Step 6: reconcile the public `SUBAGENT_EVENTS` constant map in `src/service/service.ts` with the agent-lifecycle channels the core actually emits.
The plan removes the vacant `ACTIVITY` constant (breaking) and adds `FAILED`, `COMPACTED`, `CREATED`, and `STEERED`, then updates the architecture doc's lifecycle-events table.
Two TDD steps: a `feat!:` constant-map reconciliation pinned from both sides (declaration test + existing emission tests), and a `docs:` table update.

### Observations

- This is the operator's own issue (author `gotgenes` matches the gh CLI user), so the proposed change was treated as the working hypothesis.
- Two genuine design choices were surfaced via `ask_user` and resolved: (1) remove `ACTIVITY` rather than emit a real broadcast — the activity tier was already deleted in Phase 18 Steps 1–3, so there is no streaming-progress source; (2) declare all four emitted agent-lifecycle channels including `subagents:steered` (from `steer-tool.ts`), not just the three named in the issue body, so declared == emitted is fully true for the lifecycle bus.
- Classified as **breaking**: removing a key from the exported `SUBAGENT_EVENTS` `as const` map breaks any consumer referencing `SUBAGENT_EVENTS.ACTIVITY` at the type level.
  Plan uses `feat!:` with a `BREAKING CHANGE:` footer; the footer notes there is no replacement for `ACTIVITY`.
- Scope boundaries decided: config-domain events (`subagents:settings_loaded`/`settings_changed`) and the child-session seam events (`subagents:child:*`) stay out of `SUBAGENT_EVENTS` — separate domains with their own constant homes.
  `subagents:record` is an `appendEntry`, not a `pi.events.emit`, so it is not a channel constant.
- Corrected a stale doc artifact found during planning: the architecture lifecycle-events table listed `subagents:completed` as `{ id, type, status, result?, error? }`, but `buildEventData` emits `{ id, type, description, result, error, status, toolUses, durationMs, tokens? }`.
  The plan fixes this in the same doc step.
- Public-surface gate: the plan requires running `verify:public-types` in the code step before committing, since `SUBAGENT_EVENTS` is rolled into `dist/public.d.ts`.
- Value-only reconciliation — no new collaborator, no dependency-wiring change — so the `design-review` checklist surfaces nothing actionable; noted in the plan rather than run as a separate gate.
- Next step: `/tdd-plan` (the change has a red→green test cycle).

## Stage: Implementation — TDD (2026-06-18T00:00:00Z)

### Session summary

Executed both planned TDD steps in two commits: a `feat!:` reconciling the `SUBAGENT_EVENTS` constant map (removed `ACTIVITY`, added `FAILED`/`COMPACTED`/`CREATED`/`STEERED`) pinned by an expanded `service.test.ts` assertion plus an explicit "no vacant `ACTIVITY`" check, then a `docs:` update to the lifecycle-events table and the Phase 18 Step 6 roadmap entry.
Full suite green at 1038 tests (+1 from the planning baseline of 1037); `check`, root `lint`, `verify:public-types`, and `fallow dead-code` all pass.

### Observations

- No deviations from the plan's design.
  The only mid-stream addition was the extra `"ACTIVITY" in SUBAGENT_EVENTS` falsity assertion, which strengthens the breaking-removal coverage beyond what the plan sketched.
- The breaking change went smoothly: `SUBAGENT_EVENTS.ACTIVITY` had no live consumers, so removal broke only the one service test that asserted it — folded into the same `feat!:` step as planned.
- Ran `verify:public-types` before committing Step 1 (public-surface gate); the rolled `dist/public.d.ts` regenerated cleanly with the narrowed `as const` literal types.
- `git diff` since the last tag (`pi-subagents-v16.6.0`) lists files from prior unreleased issues #422/#423/#424; scoped the pre-completion reviewer to #425's two commits to avoid noise.
- Pre-completion reviewer: WARN (1 non-blocking finding).
  The Phase 18 Mermaid node `S6` was missing the `✅` mark carried by completed nodes S1–S5; fixed by appending `✅` to the node label and amended into the unpushed `docs:` commit.
  All other checklist items PASS or SKIP (no acceptance-criteria section; `service.ts` was not a target of any prior Phase 18 step, so no cross-step invariant at risk).
- Next step: `/ship-issue`.

## Stage: Final Retrospective (2026-06-18T12:00:00Z)

### Session summary

A single continuous session carried issue #425 from planning through ship in four stages: planned the `SUBAGENT_EVENTS` reconciliation, executed two TDD commits (a `feat!:` constant-map change and a `docs:` table update), passed a WARN-then-resolved pre-completion review, and shipped `pi-subagents-v17.0.0` (major bump from the breaking `ACTIVITY` removal).
The one notable bump was at ship time: the batch-vs-release question led the user to choose batch, then immediately reverse course ("I have regrets.
Release it.").

### Observations

#### What went well

- The planning `ask_user` gate caught a real scope gap: the issue body named three missing channels (`failed`/`compacted`/`created`), but exploration of `steer-tool.ts` found a fourth emitted-but-undeclared channel (`subagents:steered`).
  Surfacing it as a design choice let the operator opt into a fully reconciled `declared == emitted` set rather than shipping the issue's literal-but-incomplete list.
- The invariant was pinned from both sides — `service.test.ts` for declaration, the existing observer/steer-tool tests for emission — so "declared channels equal emitted channels" is enforced by the suite, not just prose.
- The pre-completion reviewer caught a genuine inconsistency the deterministic gates missed: the Phase 18 Mermaid node `S6` lacked the `✅` mark that completed nodes `S1`–`S5` carried.
  A one-character fix, amended cleanly into the unpushed `docs:` commit.

#### What caused friction (agent side)

- `missing-context` (self-identified at retro) — at ship step 4b, the batch-vs-release question fired on the plan's "Phase 18 Step 6 / phased roadmap" framing, but both the issue body ("Independent of the disentanglement spine — can land at any time") and the planning retro recorded an explicit independent-releasability signal.
  The `ask_user` call presented batch and release as neutral options without surfacing that counter-signal, so the user chose batch and then reversed ("I have regrets.
  Release it.").
  Impact: one wasted `ask_user` round-trip, a cancelled `ci_watch`, and a mid-flow correction before the normal release path resumed; no commits had to be redone.
- `wrong-abstraction` (self-identified) — after the user cancelled the `ci_watch`, I read "cancelled by user" as the GitHub run being cancelled and tried `gh run rerun`, which failed ("already running").
  Cancelling the watch tool aborts the poll, not the remote run, which was still in progress.
  Impact: 1 wasted tool call; recovered immediately by re-listing and re-watching.

#### What caused friction (user side)

- The independent-releasability of this step was knowable from the issue body but only surfaced as a reversal after the batch choice.
  Opportunity, not criticism: when an issue is explicitly carved out as independently shippable, stating "release immediately" up front (or the prompt biasing toward it) avoids the round-trip.

### Diagnostic details

- **Model-performance correlation** — the only subagent dispatch was the `pre-completion-reviewer` on `anthropic/claude-sonnet-4-6` (219s, 37 tool uses); a strong model on judgment-heavy review work — appropriate, no mismatch.
- **Escalation-delay tracking** — no rabbit-hole exceeded 5 consecutive tool calls; the `gh run rerun` misstep was a single call, recovered next turn.
- **Unused-tool detection** — none; planning exploration (`Read`/`grep`/`colgrep`) and TDD verification covered the needed context without a missed Explore/`colgrep` opportunity.
- **Feedback-loop gap analysis** — verification ran incrementally, not just at the end: green-baseline `check`/`lint`/test before TDD, `verify:public-types` before committing the public-surface change in step 1, and the full suite + `check` + root `lint` + `fallow` after step 2.

### Follow-up

The ship-time batch friction prompted a larger design than a retro should land inline: make release batching plan-driven rather than an ad-hoc step-4b question.
The architecture doc would annotate coherent **release batches** per phase (guidance for the `improvement-discovery` skill / `plan-improvements.md`), `/plan-issue` would read those annotations and write a prominent Release recommendation into the plan, and `/ship-issue` would read that recommendation and confirm with the user **early** (before pull/CI) instead of inferring from prose mid-flow.
Filed as [#434] for a later `/plan-issue`.

### Changes made

1. Applied a one-sentence carve-out to `.pi/prompts/ship-issue.md` step 4b (skip the batch question when a step is explicitly independently releasable), then **reverted** it after discussion — the file is unchanged.
   The structured plan-driven approach in [#434] supersedes it.
2. Created [#434] (`enhancement`) capturing the plan-driven release-batching design across the architecture-doc authoring guidance, `/plan-issue`, and `/ship-issue`.
3. Appended this Final Retrospective entry to the retro file.

[#434]: https://github.com/gotgenes/pi-packages/issues/434
