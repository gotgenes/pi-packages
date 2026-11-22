---
issue: 466
issue_title: "Resuming a subagent skips completion lifecycle, notification, and history emission"
---

# Retro: #466 — Resuming a subagent skips completion lifecycle, notification, and history emission

## Stage: Planning (2026-07-18T00:00:00Z)

### Session summary

Planned Phase 21 Step 2: route `Subagent.resume()` termination through the completion observer so a resumed run emits a public event, re-appends `subagents:record`, and (when unconsumed) sends a notification.
The two design decisions the roadmap flagged as open were resolved with the operator via `ask_user`: a **distinct `subagents:resumed` channel** (single channel, payload discriminates completed/error) and a **silent child-lifecycle** (no `subagents:child:*` on resume).
Plan committed at `packages/pi-subagents/docs/plans/0466-resume-completion-signalling.md`; three cycles (observer channel → resume wiring → docs), all `fix:` / `docs:`, ship independently.

### Observations

- **Terminology correction mid-`ask_user`.**
  The operator asked "distinct event vs distinct channel?" — in this codebase each event *is* its own channel string (`SUBAGENT_EVENTS` already has six), so "distinct resumed event" and "a new `subagents:resumed` channel" are the same thing.
  Re-asked with that framing; operator chose the distinct channel.
- **Scope reduction from the roadmap.**
  The roadmap's tentative target-file list named `subagent-session.ts` (`resumeTurnLoop` result shape).
  The silent-child-lifecycle decision means `resumeTurnLoop` does **not** need `aborted`/`steered`, so it stays `Promise<string>` and `subagent-session.ts` is untouched.
  Documented as a deliberate deviation.
- **Notification nuance.**
  The current resume-via-tool path marks the record consumed right after `manager.resume()` returns, and `sendCompletion` is consumption-gated, so the notification stays suppressed today (correct — parent already has the result).
  The record re-append and `subagents:resumed` event fire unconditionally, fixing the stale-history and missing-event bugs.
  The notification path becomes correct for the future non-consuming #465 ask-back caller.
- **Registry bracket is safe.**
  pi-permission-system's `subagent-registry` subscribes only to `subagents:child:session-created` / `disposed`, not `completed` — so the once-per-session concern is about the child arc's readability, not a functional break.
  Leaving the child channel silent honors the roadmap invariant with zero risk to the bracket.
- **Interface widening is the main compile-time hazard.**
  Adding a required `onSubagentResumed` to `SubagentManagerObserver` breaks `CompositeSubagentObserver`, `AgentWidget`, and the full-object test mocks (`composite-subagent-observer.test.ts` `makeDelegate` + inline literals, `subagent-manager.test.ts` `createManager`); folded into the one cycle that adds the method.
- **Step-1 (#563) invariant checked.**
  `completeResume`/`failResume` and the `isBackground`-gated `onResumeFinished` arm add no `status === …` groupings, so the repeated-discriminator sweep stays at 2; named as a post-cycle check.

## Stage: Implementation — TDD (2026-07-18T15:15:00Z)

### Session summary

Executed all three plan cycles plus one preparatory `refactor:` commit; 4 commits total (`refactor` → `fix` → `fix` → `docs`).
Test count for pi-subagents went 1069 → 1073 (+4 net: 5 new `onSubagentResumed` events-observer tests, 1 composite fan-out test, 2 `onResumeFinished` `subagent.test.ts` tests, 2 manager background/foreground gate tests — some folded into existing describe blocks).
Full suite green, `check`/`lint`/`fallow dead-code` clean, `verify:public-types` OK; pre-completion reviewer returned PASS.

### Observations

- **Tidy-First landed as planned.**
  The `tidy-first-assessor` recommended exactly the one extraction the plan had flagged (`persistAndNotify` from `onSubagentCompleted`); landed it first as `refactor:`, which made Cycle 1's green diff a one-line emit + shared-helper call.
  The assessor's Rejected list correctly declined a shared `terminate()` helper across `completeRun`/`completeResume` (different workspace-dispose/aborted-steered semantics — the wrong-abstraction trap).
- **Interface widening resolved in Cycle 1, not Cycle 2.**
  Adding required `onSubagentResumed` to `SubagentManagerObserver` broke `createManager`'s observer factory in `subagent-manager.test.ts` — `tsc` caught it at Cycle 1's `check`, so the fallback was added in Cycle 1's commit rather than deferred.
  The composite `makeDelegate` + inline literals and the widget were updated in the same Cycle 1 commit as planned.
- **No deviations from the Module-Level Changes.**
  Every listed file changed; `subagent-session.ts` stayed untouched exactly as the planned scope reduction intended (silent child-lifecycle → `resumeTurnLoop` needs no shape change).
- **Invariant confirmed empirically.**
  Post-Cycle-2 repeated-discriminator sweep shows only `this._status !== "stopped"` (×4, inside `subagent-state.ts`, the owner) and `.type === "text"` (×3, content dispatch) — neither introduced by this change; no new status grouping.
- **Pre-completion reviewer: PASS** — ready for `/ship-issue`.
  No WARN findings.

## Stage: Final Retrospective (2026-07-23T02:30:31Z)

### Session summary

Single continuous session carried #466 through plan → TDD → ship: routed `Subagent.resume()` termination through the completion-observer chain, adding a distinct `subagents:resumed` public channel plus the `onResumeFinished`/`onSubagentResumed` wiring, and released `@gotgenes/pi-subagents` v18.1.1.
Four implementation commits (`refactor` → `fix` → `fix` → `docs`) plus plan/retro breadcrumbs; +4 net tests; every gate green; pre-completion reviewer PASS; release-please PR #634 merged after its in-progress check completed.
A notably clean run — the two design ambiguities were resolved at planning, the plan predicted the implementation's shape exactly, and no rework was needed.

### Observations

#### What went well

1. **Tidy-First assessor earned its dispatch.**
   It recommended exactly the one extraction the plan had pre-flagged (`persistAndNotify` from `onSubagentCompleted`), shrinking Cycle 1's green diff to a one-line emit + shared-helper call, and its Rejected list correctly declined a shared `terminate()` helper across `completeRun`/`completeResume` (different workspace-dispose and aborted/steered semantics — the wrong-abstraction trap).
   Its scope boundary held: no proposal touched a file outside the change.
2. **Plan accuracy — the interface-widening prediction held exactly.**
   The plan called out that a required `onSubagentResumed` on `SubagentManagerObserver` would break `CompositeSubagentObserver`, `AgentWidget`, and the full-object test mocks in one commit; `tsc` caught `createManager`'s observer factory at Cycle 1's `check`, and the fix landed in that same commit — no reorder.
3. **Ship handled the `UNSTABLE` release PR by the book.**
   `release_pr_merge` refused on `UNSTABLE`; the `statusCheckRollup` showed a `check` still `IN_PROGRESS`, so the session re-polled until it went `SUCCESS` and retried `release_pr_merge` — never falling back to `gh pr merge` while a check was running, exactly as the `/ship-issue` nuance prescribes.
4. **Verification ran incrementally, not end-only.**
   Each TDD cycle ran its affected test file (red → green), then `check` on interface-changing cycles, then the full package suite before commit; `verify:public-types` ran in Cycle 1 for the public-surface change.

#### What caused friction (agent side)

1. `other` (tooling slip) — the first `Edit` call in Cycle 1 sent a malformed `edits` payload (`[{}, "newText"]`) and failed schema validation.
   Self-caught, corrected on the immediate retry.
   Impact: one wasted tool call, no rework.
2. `missing-context` (ask framing) — the first planning `ask_user` framed the public-event choice as "distinct channel" vs. "discriminator" without stating that this codebase's event bus is event-per-channel-string (no multiplexed channel with a `type` field).
   The operator paused to ask "distinct event, or distinct channel?", assuming a single channel carrying many event types; the second ask corrected the framing and the operator chose the distinct channel.
   Impact: one extra `ask_user` round, no rework — the clarification arguably improved the shared understanding.

#### What caused friction (user side)

1. None.
   The operator's mid-`ask_user` terminology question was a productive clarification, not friction — it surfaced a real gap in the option framing that the re-ask closed cleanly.

### Diagnostic details

- **Model-performance correlation** — both dispatched subagents (`tidy-first-assessor`, `pre-completion-reviewer`) carry `model: anthropic/claude-sonnet-5` frontmatter, an appropriate capable model for judgment-heavy read-only review; no reasoning-weak model did judgment work.
  The parent session switched models several times across stages (opus / sonnet-5 / deepseek-v4-flash / fable-5 / haiku-4-5 / opus); without turn-level attribution no clear judgment-on-weak-model mismatch is identifiable, and the subagents' own frontmatter insulates their work from the parent's model.
- **Escalation-delay tracking** — no `rabbit-hole` friction; the malformed `Edit` resolved in one retry, well under the 5-call flag threshold.
- **Unused-tool detection** — not applicable; no `missing-context` or `rabbit-hole` investigation stalled for want of a tool (`colgrep`/`grep`/`read` were used appropriately during planning exploration).

### Changes made

1. `packages/pi-subagents/docs/retro/0466-resume-completion-signalling.md` — appended this Final Retrospective stage entry.
   No `AGENTS.md` or prompt changes: the session's two friction points (a self-caught malformed `Edit` payload; a one-off `ask_user` framing round) were minor, caused no rework, and are not reusable enough to codify — operator confirmed retro-file-only.
