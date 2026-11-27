---
issue: 1118
issue_title: "pi-permission-system: replace yolo with auto-approve, a terminal after the authorizer chain"
---

# Retro: #1118 — pi-permission-system: replace yolo with auto-approve, a terminal after the authorizer chain

## Stage: Planning (2026-11-26T20:42:07Z)

### Session summary

Planned the replacement of yolo with auto-approve per ADR 0016 §5: a terminal decorator (`AutoApprovingAuthorizer`) over a locally adjudicating node's terminal, driven by per-session `AutoApproval` scopes (`own`, `forwarded`, `agent <name>`) set by `--auto-approve` or `/permission-system:auto-approve`.
The plan has ten steps: three test-wiring preparations, two `refactor:` steps that land the decider and its composition unwired, `feat:` setters, `feat:` headless serving, the `feat!:` yolo removal, the [#868] schema ride-along, and docs.

### Observations

- Operator decisions at the gate: the `"yolo"` origin is **removed** with no replacement `RuleOrigin` (an auto-approved event reports the asking rule's origin + `auto_approved`; the setter lives on `decidedBy`); the command registers as `/permission-system:auto-approve` ahead of [#1103]'s namespace; a headless node **serves** forwarded asks while auto-approve covers them, because otherwise `pi -p --auto-approve` with subagents regresses (children used to read the shared `yoloMode` and approve locally; traced, not run).
- A relaying node never consults its own auto-approve (ADR §5, "set at the serving node"); it records `auto_approve_delegated`, mirroring `authorizer_chain_delegated`.
- `yoloMode` stays schema-valid and deprecated (the `toolInputPreviewMaxLength` precedent) so an old global file is not rejected into an empty scope; it must stay in `mergeUnifiedConfigs`' loop or the warning never fires.
- Measured: Pi 1.0.0's `parseArgs` lets a boolean extension flag swallow the next positional (`pi --auto-approve "fix the bug"` loses the message); Pi's `main` checkout is unchanged.
  Documented as a safe-spelling note; reporting upstream is an Open Question.
- The tidy-first assessor caught a sequencing defect: the config-derived status sync (`PermissionSession.refreshConfig`, every `before_agent_start`) would erase the auto-approve indicator, so status ownership moves in the setters step, not the removal step.
  It also found three hand-rolled factory fakes (`session-start.test.ts` ×2, `permission-events.test.ts`) that would throw on `registerFlag`, and two dead yolo fixture options, one of which `tsc` would not flag because it is spread into the manager's options.
- Measured 80 `as unknown as ExtensionAPI` casts in `composition-root.test.ts` (the roadmap said 79).
- Review-log shape changes are part of the break: one `permission_request.auto_approved` entry becomes `waiting` + `approved`, and a served ask logs `forwarded_permission.prompted` even though no human is asked.
- Credit: `Co-authored-by` ReStranger (PR [#990]'s session command) and maksimr ([#720]'s launch flag) on the setters commit; close [#720], [#1031], and PR [#990] at ship.

#### Deferred tidyings

- `src/authority/authorizer-selection.ts`: chain-link resolution (`linksFor`, `resolveConfiguredLinks`, and four deps) is a separable `ChainLinkResolver`; it does not shrink this change.

## Stage: Implementation — TDD (2026-11-26T21:56:48Z)

### Session summary

All ten plan steps landed as ten commits, plus two review fix-ups: three test-wiring preparations, the `AutoApproval` decider and its terminal, per-ask composition in `AuthorizerSelection`, the flag and command, headless serving, the `feat!:` yolo retirement, the [#868] schema ride-along, and docs.
The `pi-permission-system` suite went from 6637 to 6675 tests (+38); every step's named killing mutations turned its new tests red.

### Observations

- Deviation, design: `AutoApprovingAuthorizer` is a value terminal holding the grant that selected it (the mirror of `DenyingAuthorizer`), not the planned decorator wrapping an inner terminal.
  The decorator broke three `authorizer-selection` tests that pin "the prompter receives a `LocalUserAuthorizer`" (terminal identity); `AuthorizerSelection.terminalFor` now asks `grantFor(details)` per ask and keeps the selected terminal when nothing covers it.
  The one behavioral difference: the grant is read when `escalate` starts, so a toggle made while a link is still deciding does not reach that ask.
  The step-4 commit was amended in place before step 5 began.
- Deviation, API: `AutoApproval.enable`/`disable` do not sync the status bar (the command and `setAll`/`applyLaunchFlag` do); `setAll` was added for the modal's `SessionAutoApproveToggle`; the constructor's flag reader defaults to `() => false`.
  `makeFakePi`'s option is `flagValues` (its `flags` map records registrations).
- Status ownership moved in the flag-and-command commit, as the Tidy-First assessor predicted: between that commit and the yolo retirement, yolo kept working without its status indicator.
- A hand-built `session_start` ctx in `test/session-start.test.ts` lacked `ui.setStatus`, which the launch-flag step now calls; fixed in the fixture rather than guarding on `hasUI`, since a real ctx always has it.
- The first `bootExtension` codemod matched from the doc comment on line 2 to the first real call, rewriting both; caught in the diff and repaired by hand before commit.
- One mutation survived on the first pass: the [#868] test asserted the item description contains `model-judge`, which `@gotgenes/pi-permission-model-judge` in the same sentence also satisfies; tightened to `registers as model-judge`.
- Not covered by the plan: a headless **relaying** node launched with `--auto-approve` now serves its own children's inbox (its `servesWithoutUI` reads only `answersForwardedAsks()`) and relays their asks upward, multi-hop.
  A relaying node with a UI already behaves this way, and the plan deliberately keeps `AdjudicationRole` out of `ForwardingManager`; left as is.
- Pre-completion reviewer: WARN, then PASS on the delta.
  The two fixed WARNs were `docs/migration/strict-config-validation.md`'s stale yolo guidance and `config-file-writer.test.ts`'s `yoloMode` sample data; the rest are the deviations recorded above.
  `docs/migration/0644-project-trust-gating.md` and `docs/architecture/v3-architecture.md` still name `yoloMode` as historical records.

## Stage: Sync (worktree) (2026-11-27T16:00:47Z)

### Session summary

`pnpm run lint` and `pnpm fallow dead-code` passed before the rebase; the plan's marker is `**Release:** ship independently` (a `feat!:` major).
At ship, close [#720], [#1031], and PR [#990] with a credit comment.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-1118--/2026-11-26T18-53-37-730Z_01a21934-c241-7274-a5f4-193d71b45612.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

- Operator decision: a headless relaying node launched with `--auto-approve` keeps serving its own children and relaying their asks upward (option 1, as implemented), rather than gating headless serving on `adjudicatesLocally()`.
  Option 2 was weighed: it would have kept `main`'s behavior for grandchildren (denied after about two seconds) and needed `PermissionSession.activate` to activate the selection before starting forwarding.
- The operator wants multi-hop forwarding to stay faithful rather than be gated off; filed as [#1154].
  `ParentAuthorizer.buildForwardedRequest` stamps the relaying node as requester, so the root resolves a grandchild's ask agent-scoped to the middle node and an `agent <name>` scope matches the middle node (traced in source, not run).
  Its Phase 16 roadmap disposition is still owed; it was put to the operator at the end of this sync.

## Stage: Final Retrospective (2026-11-27T16:44:21Z)

### Session summary

The root `/ship` fast-forward-merged the peer branch, re-ran lint and `fallow dead-code` on the merged tree, pushed, and verified CI, then released `pi-permission-system-v45.0.0`.
It closed this issue, the issues it shipped ([#720], [#1031], and [#868]), and PR [#990], crediting @maksimr and @ReStranger, and tore down the worktree.
Across four stages (planning, TDD, and sync in one peer session on `anthropic/claude-opus-5-5`, ship at the root), the only friction that cost operator turns was the sync gate's missing baseline.

### Observations

#### What went well

- The Tidy-First assessor's sequencing prediction held exactly: status ownership had to move in the setters commit or `PermissionSession.refreshConfig` would erase the auto-approve indicator every turn, and TDD hit that seam where the plan placed it.
- Per-step killing mutations caught a test that was too weak: the [#868] assertion `contains model-judge` also matched `@gotgenes/pi-permission-model-judge` and was tightened to `registers as model-judge` before commit.
- Ship step 2's full retro read found every close target ([#720], [#1031], PR [#990]) from the sync note, and the plan named [#868] as a ride-along, so all four closed in one pass with no post-ship cleanup.
- The sync gate's second pass compared the options against published `main`, which showed option 1 was new behavior, not the status quo; the operator then filed and dispositioned the real want ([#1154]) in the same stage.

#### What caused friction

- `rule-ignored` — the sync gate's first briefing on the headless relaying node compared option 1 to a sibling configuration ("a subagent that does have a UI already behaves this way today") but not to `main` for the case in question.
  `clarification-gates` ("what happens today in each concrete configuration") was in context, since planning had read it and the peer session never compacted.
  The operator asked twice before the baseline came out, and it reversed the framing: on `main` a grandchild's ask is denied after about two seconds, so option 1 is the behavior change.
  Impact: two extra operator turns and a three-call code-reading pass; no rework.
  Operator-caught.
- `other` (harness boundary, recurring) — one `ask_user` call in sync and one in this ship carried their briefing only in thinking and were blocked by `.pi/extensions/ask-user-text-first.ts`.
  The guard's reason, from `docs/retro/1138-adopt-fallow-3-46-features.md`, sent each to a plain-text reply on the first block.
  Impact: one rejected call per gate; the guard is working as intended.
  Tool-caught.
- `rule-ignored` — the [#720] close comment said "the README documents the safe spelling" before the claim was checked; the `grep` ran after `issue_close` published it.
  The claim held (`README.md` line 167), but the check came after the point where it could stop a wrong claim (Principle 1).
  Impact: none this time.
  Self-identified.
- `slip` — two `cd packages/pi-permission-system; …` bash calls (one in planning, one in TDD) were denied by the `cd packages/*` policy rule, and each was re-run from the root.
  Impact: two rejected calls; the deny rule is the mechanism and it fired.
  Tool-caught.
- `judgment` — the plan's `AutoApprovingAuthorizer` decorator broke three `authorizer-selection` tests that pin the terminal's identity; TDD switched to a value terminal (the mirror of `DenyingAuthorizer`) and amended step 4 in place.
  Impact: one amended commit; the selected terminal now reads the grant when `escalate` starts.
  Self-identified.

#### What the operator steered

- `steer:rule`: "I think 2 matches explicit vs. implicit, right?", after the agent recommended option 1 (keep headless relaying nodes serving) as matching a UI node's behavior.
- `steer:rule`: "How does this change behavior from today?
  What second-order effects am I missing?", after the agent's case for option 2 still omitted the `main` baseline.
- `steer:choice`: "I think for now we'll go with Option 1, however, I can tell as a user that what I want is for subagent forwardings to survive correctly in multi-hop scenarios."
  The agent had last made the case for option 2.
  Its reach is stated as a product direction ("what I want"), and it became [#1154].
  No earlier `steer:choice` (`rg -n 'steer:choice' docs/retro packages/*/docs/retro`) states the same choice.

### Diagnostic details

- **Model-performance correlation** — every peer turn and all three subagents (the Tidy-First assessor, the pre-completion reviewer, and its delta pass) ran on `anthropic/claude-opus-5-5`, per the transcripts' inline labels.
  That fits the assessor and the first review; the nine-turn delta review is light work for that tier, but too small to matter.
- **Escalation-delay tracking** — no stretch ran past two calls on one error: the two `Edit` mismatches (`lifecycle.test.ts`, `lifecycle.ts`) each resolved on the next call.
- **Feedback-loop gap analysis** — TDD ran the affected test file after every Red and Green and the named mutations per step; lint and `fallow dead-code` ran at sync and again on the merged tree at ship.

[#1154]: https://github.com/gotgenes/pi-packages/issues/1154

[#720]: https://github.com/gotgenes/pi-packages/issues/720
[#868]: https://github.com/gotgenes/pi-packages/issues/868
[#990]: https://github.com/gotgenes/pi-packages/pull/990
[#1031]: https://github.com/gotgenes/pi-packages/issues/1031
[#1103]: https://github.com/gotgenes/pi-packages/issues/1103
