---
issue: 792
issue_title: "pi-permission-system: alarm when a registered in-process child session has no permission node"
---

# Retro: #792 — Alarm when a registered in-process child session has no permission node

## Stage: Planning (2026-08-31T04:17:50Z)

### Session summary

Produced `docs/plans/0792-alarm-child-without-permission-node.md` (cross-package: `pi-subagents` + `pi-permission-system`).
The design adds an optional fourth child-lifecycle channel `subagents:child:bound`, emitted by `pi-subagents` after `await session.bindExtensions({})` resolves, and a `ChildNodeAudit` collaborator in `pi-permission-system` that asks `getPermissionsService(childSessionId)` on that signal and alarms when the answer is `undefined` — a `child_node_absent` review entry per affected child plus one visible warning per parent session.
The operator settled all four gates on the recommended option: optional third channel, warn rather than refuse, warn-once cadence, hedged message naming `excludedExtensionPackages`.

### Observations

- The issue's hardest open question ("where the check fires — there is no parent-side event for the child's first turn") turned out to be nearly forced once two candidate seams were checked against the code rather than reasoned about.
  Auditing at `subagents:child:disposed` is dead because `SubagentSession.dispose()` awaits the child's `session_shutdown` — which unpublishes the keyed service — **before** emitting `disposed`, so every healthy child would false-alarm.
  Sweeping at the parent's next `before_agent_start` is dead for foreground children, which are disposed and unregistered inside the parent's own `subagent` tool call, before the parent's next turn begins.
  Both findings are measurements against named line numbers, not arguments; they are recorded in the plan's Background so a later reader does not re-litigate them.
- The timing guarantee rests on Pi core: `AgentSession.bindExtensions()` does `await this._extensionRunner.emit(this._sessionStartEvent)`, so when it resolves every child extension's `session_start` has run.
  Read from the `pi` checkout at `../../pi` per AGENTS.md, inline rather than via a subagent, because the claim is the design's load-bearing input.
- The contract cost was the real deliberation: ADR 0012 decision 5 says an implementation's entire obligation is the announcement, and a third channel grows it.
  Making the channel **optional** keeps the mandatory obligation at two events and leaves the conformance table's ✓/✗ meaning intact.
  The population affected is one — only `@gotgenes/pi-subagents` emits the existing two events at all.
- Rejected during design: having `pi-subagents` carry its resolved `excludedExtensionPackages` list on the new payload so the parent could distinguish deliberate exclusion from a load failure.
  It widens the announcement with a settings fact purely to improve message wording; the hedged message was chosen instead.
  Recorded as a non-direction in the plan's Open Questions; nothing filed.
- Rejected during design: a sibling `subscribeChildNodeAudit(events, audit)` module (the Tidy-First assessor's own open question).
  `subagent-lifecycle-events.ts` already owns every channel name and payload shape of the announcement contract, so splitting the subscription would separate `SUBAGENT_CHILD_BOUND` from its only subscriber or duplicate the constant.
- Rejected during design: extracting a shared "re-armed once-per-activation latch" between `PermissionServiceLifecycle.announced` and the new auditor.
  Two uses with different semantics; the auditor's latch needs no re-arm at all, because the extension factory is re-invoked per session generation.
- The Tidy-First assessor found one real preparatory gap (composition-root `makeBaseCtx` cannot capture `ui.notify`) and one contradiction in the target-file list: `packages/pi-subagents/test/helpers/subagent-session-io.ts`'s `createChildLifecycleMock()` must gain `bound` in the **same** commit as the interface widening, since the mock cannot be written before the method exists.
  Both are folded into the TDD Order (steps 1 and 2).
- Step 5's killing-mutation note deliberately says which mutation the step's own tests will **not** kill (the inverted lookup thunk in `index.ts`, which only step 6's composition-root case catches), so a green run at step 5 is not mistaken for coverage of the wiring.

#### Deferred tidyings

- `packages/pi-permission-system/src/handlers/lifecycle.ts` — the `serviceLifecycle` constructor-dep doc comment and the inline comment above `this.serviceLifecycle.activate(ctx)` both still say publication is "skipped for registered subagent children" and that the child is "identified and excluded".
  That stopped being true in #796, which removed the `RegisteredChildDetector` guard.
  Rejected as scope creep for this change; independent one-line doc fix.

## Stage: Implementation — TDD (2026-08-31T05:20:24Z)

### Session summary

Executed all nine plan steps plus two review-driven doc fixes, in twelve commits. pi-subagents gained the optional `subagents:child:bound` channel, emitted after `bindExtensions()` resolves and not on the throw path; pi-permission-system gained `ChildNodeAudit`, subscribed through the existing `subscribeSubagentLifecycle` dispatcher and wired in `index.ts`.
Test count: pi-permission-system 3783 → 3795 (+12), pi-subagents 1353 → 1357 (+4).
All four gates green (`check`, root `lint`, `test`, `fallow dead-code`).

### Observations

- **A planning claim shipped into an ADR before anyone checked it.**
  The plan asserted that a foreground child is "disposed and unregistered inside the parent's own tool call", and I wrote that into both the ADR 0012 amendment and the architecture doc's `Landed:` note as the reason for rejecting the deferred-sweep seam.
  It is false: `completeRun()` only marks status, and disposal is `SubagentManager`'s 60-second interval sweep against a configurable retention window.
  The `pre-completion-reviewer` caught it and cited the lines.
  I had verified the *other* dead-seam claim (`dispose()` awaiting `session_shutdown` before emitting `disposed`) against the source during planning, and inherited the second one from an inference about `spawnAndWait` awaiting `record.promise` — awaiting completion is not awaiting disposal.
  The corrected objections (post-hoc by construction; reachability depends on a retention window this package does not control) were re-verified by the reviewer against the source before landing.
  The lesson is narrow and repeatable: when a design rejects an alternative, the *rejection* rationale ends up in the durable record too, and it needs the same verification as the chosen path — it is the half nobody exercises.
  The Planning-stage entry above is left as written; this is the correction.
- **The plan's step 2 was mistyped `feat:` and was retyped to `refactor:` during the cycle.**
  The commit adds a publisher method nothing calls, so nothing is observable until step 3 wires it.
  Caught by applying the AGENTS.md rule at commit time rather than at the step-9 changelog preview, which is where it would otherwise have surfaced with the commit three deep.
- **A predicted mutation under-predicted its own blast radius.**
  Step 3's mutation A (move the `bound` emission before `bindExtensions()`) was planned to kill only the ordering case; it killed the rejection case as well, because emitting before the bind also emits on the failure path.
  More discriminating than predicted, so not a finding against the tests — but mutation B (move it into a `finally`) was still needed to show the rejection pin discriminates independently.
- **The composition-root case earned its place explicitly.**
  Inverting the `index.ts` presence thunk left all nine `subagent-lifecycle-events` cases and all eight `child-node-audit` cases green, and killed only the three composition-root cases — confirming the unit files stub the seam and that the integration test is the sole proof of the wiring.
  The plan predicted this and said so in step 5, which is what made the check worth running rather than a formality.
- **Two flaky full-suite failures were host load, not regressions.**
  `out-of-process forwarding liveness > waits for an out-of-process parent whose heartbeat is fresh` and `ParentAuthorizer abandonment > keeps waiting while the in-process target is serving` failed once in a 914-second run, then passed alone — the pattern the package skill documents.
  An A/B swap measured the new composition-root cases at +0.86 s over the pre-change file (12.80 s → 13.66 s), so they are not a flake contributor.
- **The latch needed no re-arm hook**, because the extension factory is re-invoked per session generation — so the auditor is rebuilt on every `/new`, `/resume`, `/fork`, or `/import`.
  This is where it diverges from `PermissionServiceLifecycle.announced`, which re-arms in `activate` because a `reason: "reload"` `session_start` reuses the instance.
  Deliberately not extracted into a shared latch helper: two uses, different semantics.
- **Pre-completion reviewer: WARN** (two rounds).
  Round 1 raised the false ADR claim above plus two module-tree gaps (`child-node-audit.ts` absent from the tree; `pi-subagents` ADR 0002 still enumerating four channels); all fixed in `c8bda0b3`.
  Round 2 confirmed the replacement rationale against the source and found one more stale copy I had missed — `pi-subagents/docs/architecture/architecture.md` duplicates ADR 0002's channel enumeration, so fixing the ADR left the file disagreeing with its own module tree — fixed in `d41ed14e`.
  No blocking findings in either round.

## Stage: Sync (worktree) (2026-08-31T15:40:00Z)

### Session summary

Pre-push checks pass clean: `pnpm run lint` and `pnpm fallow dead-code` both green from the worktree root, no fixes needed.
The plan's `**Release:**` marker is `ship independently` (Phase 14 Step 7 carries no batch tag), so the root should proceed to release without waiting on a sibling.
No deferred work or follow-ups from this issue's implementation — the plan's two Open Questions were recorded as non-directions, nothing filed.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-792--/2026-08-31T03-42-59-315Z_01a055e9-c6f2-789e-9867-87e1fff107c7.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

One judgment call from the TDD stage is still open for the operator: the committed plan retains the original (incorrect) claim that a foreground child is disposed inside the parent's own tool call, with the correction recorded only in this retro's TDD-stage entry rather than edited into the plan itself.
The pre-completion reviewer agreed this matches the repo's "plan as point-in-time snapshot" convention, but flagged it as the operator's call to override at ship or retro time if preferred.

## Stage: Final Retrospective (2026-08-31T16:00:45Z)

### Session summary

The root session landed the peer branch on `main` by fast-forward, verified CI, closed issue #792, released `pi-permission-system-v29.1.0`, and tore down the worktree.
It released **one** of the issue's two packages: the cross-package change also produced `feat(pi-subagents)`, whose release PR #855 was open at the same moment and was never looked for.
The ship report nonetheless printed "Nothing skipped."

### Observations

#### What went well

- **The two-round pre-completion review earned its keep on a class of defect no gate catches.**
  Round 1 caught a planning-stage claim — a foreground child is "disposed and unregistered inside the parent's own tool call" — that had already propagated into ADR 0012's amendment and the architecture doc's `Landed:` note.
  It is false: `completeRun()` only marks status, and disposal is `SubagentManager`'s interval retention sweep.
  Round 2 then caught a duplicate the round-1 fix had *exposed* — `pi-subagents/docs/architecture/architecture.md` restates ADR 0002's channel enumeration, so correcting the ADR left the file contradicting its own module tree.
  Neither is reachable by `tsc`, lint, or a green suite; both were durable-record defects on a security-adjacent contract.
- **The killing-mutation discipline produced two genuinely informative results rather than ceremony.**
  Step 3's mutation A (move the emission before `bindExtensions()`) killed *both* cases where the plan predicted one, because emitting early also emits on the failure path — so mutation B was still needed to show the rejection pin discriminates alone.
  Step 6's wiring mutation killed all three composition-root cases and **zero** unit tests, confirming the unit files stub the seam and the integration case is the sole proof of the `index.ts` wiring.
  The plan predicted that split in advance, which is what made the check worth running.
- **The `AGENTS.md` A/B swap procedure (Refs #742) was applied correctly under pressure.**
  Facing two flaky full-suite failures, the TDD session backed both sides up as files (`cp` the working state aside, `git show HEAD:<path> >` the baseline) and swapped with `cp` in both directions, measuring the new composition-root cases at +0.86 s (12.80 s → 13.66 s).
  It never reached for `git checkout -- <path>`, which would have discarded the step's own uncommitted green edit.

#### What caused friction (agent side)

- `missing-context` — **a cross-package issue released only one of its two packages.**
  Issue #792 is cross-package by construction (plan at `docs/plans/`, both `pkg:` labels, `feat:` commits in both packages).
  The same CI run opened two component release PRs at 15:47Z: #854 (`pi-permission-system` 29.1.0) and #855 (`pi-subagents` 21.1.0, carrying `feat(pi-subagents): emit the bound announcement once a child binds its extensions`).
  The ship session called `release_pr_find` with `component: pi-permission-system` only.
  It then wrote, in plain text, that it would "check if `pi-subagents` also has an open release PR" — and ran `git pull --ff-only` instead, never returning to it.
  Impact: `pi-subagents` 21.1.0 sat unreleased after a ship that reported "Nothing skipped"; the operator had to be told at retro time.
  Root cause is not attention alone — `.pi/prompts/ship-worktree.md` line 106 states "a sibling package's own PR sitting open is normal and is not yours to merge," which is correct for an unrelated sibling and exactly backwards for the second package of a cross-package issue.
  `.pi/prompts/ship-issue.md` carries the same singular `component: <pkg>` framing and treats a `docs/plans/` root-level plan as "a repo-root tooling change" with no package, which is the other reading a cross-package plan admits.
- `other` — **two tool calls spent counting characters in machine-produced SHAs.**
  After `git rev-parse HEAD`, the ship session ran `git rev-parse HEAD | wc -c` to confirm the SHA was 40 characters; after `release_pr_merge` reported `head_sha`, it ran `echo -n "<sha>" | wc -c` for the same reason.
  Both values came from authoritative sources that cannot emit a malformed SHA.
  Impact: two wasted calls, no rework — but it is a self-generated doubt about output that was never in question.
- `other` — **a `gh pr list --search` query with parentheses and a colon silently matched nothing.**
  During this retro, `gh pr list --state open --search "chore(main): release"` returned `[]` while PR #855 was open.
  Listing without `--search` found it immediately.
  Impact: one call, and a near-miss — an empty result read as "no open release PRs" would have confirmed the wrong conclusion.
- `instruction-violation` (self-identified) — **a stray `oldText2` key in an `Edit` call**, the exact trap `AGENTS.md` documents (Refs #605), at TDD step 5 on `subagent-lifecycle-events.ts`.
  The recovery rule worked as designed: the session re-read the file rather than trusting the reported block count, found the dropped edit, and applied it.
  Impact: two extra tool calls, no rework.
- `instruction-violation` (self-identified) — **a mistyped absolute path** (`/Users/chris/development/pi/pi-permission-system-placeholder`) passed to `Edit` at TDD step 4's mutation C, against the `AGENTS.md` rule to pass repo-relative paths (Refs #726).
  Impact: one rejected call, corrected immediately.

#### What caused friction (user side)

- Nothing blocking.
  One opportunity: the peer session's `/sync-worktree` handoff explicitly surfaced the open plan-correction judgment call to the root, and the root session's report did not carry it forward — so it reached the operator only here.
  A sync-stage note that names an open operator decision is worth echoing in the ship report rather than leaving for the retro.

### Diagnostic details

- **Model-performance correlation** — Planning and TDD ran on `anthropic/claude-opus-5` (judgment-heavy: seam elimination, ADR amendment, mutation design) and Sync and Ship on `anthropic/claude-sonnet-5` (mechanical: gates, rebase, ff-merge, CI watch).
  The split is appropriate, and the miss is instructive rather than a mis-assignment: the one judgment call left in the ship stage — "is this sibling release PR mine?"
  — landed on the cheaper model, against a prompt line that answered it wrongly.
  The correction belongs in the prompt, which is the artifact the ship stage actually reads.
  Subagent dispatches: `tidy-first-assessor` (planning, one real preparatory gap plus one target-list contradiction) and `pre-completion-reviewer` ×2 (TDD, WARN both rounds, no blocking findings).
- **Escalation-delay tracking** — no sequence exceeded two consecutive tool calls on the same error across any stage; no `rabbit-hole` friction point was recorded.
- **Feedback-loop gap analysis** — no gap.
  The TDD session established a four-gate green baseline before step 1, ran the affected file after every Red and Green, ran `pnpm run check` at each type-widening step rather than deferring it, and re-ran all four gates plus the changelog preview at end-of-cycle.
  The ship stage ran no local verification, which is correct — CI is the gate there.

### Changes made

1. Merged release PR #855 and released `pi-subagents-v21.1.0` (`c43dd2c2`) — the unreleased half of this cross-package issue, found during this retrospective.
2. `.pi/prompts/ship-worktree.md` § 6 — the release step now derives its package list from the shipped commit range (`git log --format='%s' "$PLAN"^..HEAD | grep -oE '^(feat|fix)\([^)]+\)' | sort -u`) rather than the plan's directory, and loops `release_pr_find` / `release_pr_merge` / `release_watch` over every package the range bumps.
   The `PLAN` variable is re-derived inside the step's own snippet, since each `bash` call runs in a fresh shell.
   The sibling caveat was re-scoped from "a sibling package's own PR" to "a package the shipped range did **not** bump".
3. `.pi/prompts/ship-worktree.md` § 8 — the final report now prints one released version per package and requires naming every package the derivation listed, so a listed package with no version reads as a miss.
4. `.pi/prompts/ship-issue.md` § 6 — the same range-derived package list, replacing the framing that read a `docs/plans/` plan as "a repo-root tooling change" with no package; same sibling re-scoping, and `release_watch` once per released package.
5. `AGENTS.md` — amended the release-PR clause: "the normal state" → "an expected state" (per the operator, multiple concurrent release PRs is a property of the current worktree-heavy flow, not the historical norm), plus a sentence that a cross-package change opens one PR per package it bumps and all of them are yours.

The operator settled the outstanding plan-claim question in favor of leaving the committed plan as a point-in-time snapshot; the correction stays in the TDD-stage entry above and in the corrected ADR 0012 amendment and architecture doc.
