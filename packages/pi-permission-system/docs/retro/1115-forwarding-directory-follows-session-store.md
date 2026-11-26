---
issue: 1115
issue_title: "pi-permission-system: the forwarding directory ignores PI_CODING_AGENT_SESSION_DIR, leaving the per-second heartbeat in the agent config dir"
---

# Retro: #1115 — the forwarding directory ignores `PI_CODING_AGENT_SESSION_DIR`

## Stage: Planning (2026-11-26T16:11:52Z)

### Session summary

Planned the Phase 16 step that folds [#1052] into #1115: the forwarding tree follows an inherited `PI_CODING_AGENT_SESSION_DIR` (PR [#1107]'s mechanism), and the serving heartbeat slows from 1 s to a 30 s refresh with 90 s staleness plus a per-tick existence probe.
The issue is third-party, so the direction went to the operator, who confirmed both halves and asked for the alternative liveness mechanisms; those became the open-ended follow-up [#1149], deferred to a later phase and recorded in the roadmap's sweep list.
The plan is five steps: two Tidy-First `refactor:` steps, the location `fix:`, the probe `refactor:`, and the cadence `fix:`.

### Observations

- Verified rather than inherited from the PR: Pi's session-dir precedence in pinned 1.0.0 `dist/main.js` (unchanged in the checkout), that Pi's session listing reads only `*.jsonl`, and via GitHub code search that nicobailon/pi-subagents passes `--session-dir` and never sets the variable, which is why only the env var is a safe rendezvous.
- The #1052 "announce on demand" remedy was rejected at the gate because `resolveLiveRelayTarget` (`authorizer.ts`) makes a one-shot synchronous liveness read for an interactive child; any on-demand scheme has to change that check, which is why it moved to [#1149].
- The existing test "republishes at the next refresh boundary when the record was removed underneath it" would stay green at a 30 s refresh while its stated invariant (gap shorter than the 2 s grace) breaks; the assessor caught it, and step 4 rewrites it to advance one tick.
- `ExtensionPaths.sessionsDir` and `agentDir` are read by nothing in `src/`; step 1 deletes them so step 3 never decides what `sessionsDir` means after relocation (PR [#1107] set it to the relocated dir).
- `expandHomePath` and Pi's `expandTildePath` differ on `$HOME`/`file://` spellings; accepted as a risk because parent and child still agree.
- Two `Co-authored-by:` trailers are recorded in the plan: George Harker (step 3, PR [#1107]) and dopamine911 (step 5, [#1052]'s remedy).
- Close targets at ship time: #1115, [#1052], and PR [#1107] (reimplemented).

#### Deferred tidyings

- `src/session/permission-session.ts`: depends on the whole `ExtensionPaths` bag but reads only the two infrastructure fields (ISP).
- `test/composition-root.test.ts`: seven literal `join(agentDir, "sessions", "permission-forwarding")` sites and the repeated `childCwd`/`externalDir` tmpdir pair in `out-of-process forwarding liveness`, cleaned up inline after asserts.

## Stage: Implementation — TDD (2026-11-26T17:25:16Z)

### Session summary

All five TDD steps landed as planned (two `refactor:` tidyings, the location `fix:`, the existence-probe `refactor:`, the cadence `fix:`), plus the roadmap `✅` and two commits answering the pre-completion reviewer.
The pi-permission-system suite went from 6629 to 6637 tests (+8: two field assertions removed, five `computeExtensionPaths` relocation tests, two composition-root rendezvous tests, three cadence tests).
Every planned killing mutation killed exactly the predicted tests.

### Observations

- Pre-completion reviewer: WARN in round 1, WARN in round 2 (all round-1 findings resolved).
- Round 1 found a version-skew case the plan missed: a new parent (30 s refresh) read by an older child (5 s staleness) looks stale for about 25 of every 30 seconds, so the child abandons even with `PI_CODING_AGENT_SESSION_DIR` unset.
  It fails closed, and it arises only when a child loads an older package copy than its parent; documented in `docs/subagent-integration.md` § Upgrading rather than mitigated.
- Round 1 also found the parent-side wiring unpinned: only the child half of the relocated rendezvous was tested, so replacing `paths.forwardingDir` at the `ServingHeartbeatStore` or `ForwardedRequestServer` sites in `index.ts` passed the suite.
  A new composition-root test runs a real parent (UI, real poll timer) serving a real child under a relocated store; mutating each of the three `forwardingDir` wiring sites turns it red.
- Reviewer warning (round 2, optional, not acted on): two of those three mutants fail on Vitest's 5 s timeout rather than an assertion, and the test's inline cleanup (the file's convention) leaves the parent's poll timer running when it fails.
- `ExtensionPathOptions` stays unexported, unlike the plan's sketch: nothing outside `extension-paths.ts` names it, and an unread export would trip `fallow`.
- The step-4 negation mutation (`!existsSync`) killed the republish test as well as "does not rewrite within the refresh window"; that is inherent to a negation, not a weak pin.

## Stage: Final Retrospective (2026-11-26T17:58:21Z)

### Session summary

One session ran all four stages: planning (with a third-party direction gate and the follow-up [#1149]), five TDD steps plus two review-driven commits, the ship (`pi-permission-system` 44.0.2, closing #1115, [#1052], and PR [#1107]), and this retro.
The forwarding directory now follows an inherited `PI_CODING_AGENT_SESSION_DIR`, and an idle serving session rewrites its heartbeat every 30 seconds instead of every second.

### Observations

#### What went well

- The mutation batteries ran as one script per step (`/tmp/mut3.sh`, `/tmp/mut4.sh`): each asserted its pattern occurs exactly once, printed the `git diff --stat` before reading the run, and restored from a saved green copy.
  Eleven mutations across steps 3–5 and the review fix each killed exactly the predicted tests, in four tool calls.
- The Tidy-First assessor found a test that would have stayed green while its stated invariant broke ("republishes at the next refresh boundary" advanced a full refresh window), which turned the existence probe into a planned, pinned step instead of a silent regression.
- The pre-completion reviewer's first round found a real defect class the plan missed (the cadence version skew) and a real coverage hole (the parent-side wiring), both cheap to fix before the push.

#### What caused friction

- `rule-ignored` — the frequency question at the planning gate offered [#1052]'s two remedies plus "defer", the option space the issue itself proposed; `clarification-gates` (loaded before the gate) says a third-party artifact's own decomposition is a premise, and to derive the option space from the problem first.
  The operator answered with "tell me, what other mechanisms can you think of", and the derived table (seven mechanisms against six needs) came one round later.
  Impact: one extra gate round-trip; no rework, and the table became [#1149]'s body.
  Operator-caught.
- `rule-ignored` — the plan's Risks named version skew only for the relocated-directory case; it never listed that an older child compares a new parent's `updatedAt` against a 5 s staleness window.
  The `/plan-issue` template says that when a change alters a value consumers compare against, list each comparison per consumer with the direction a mismatch fails.
  Impact: one review round and a `docs:` commit ("note heartbeat timing skew between parent and child versions").
  Reviewer-caught.
- `judgment` — the plan adopted PR [#1107]'s child-only composition-root test, so nothing pinned that `ServingHeartbeatStore` and `ForwardedRequestServer` receive the relocated `paths.forwardingDir`; replacing either wiring site passed the suite.
  Impact: one review round and a `test:` commit ("pin the parent side of a relocated forwarding rendezvous").
  Reviewer-caught.
- `rule-ignored` — the #1149 disposition `ask_user` went out with its briefing only in thinking; the `ask-user-text-first` guard blocked it, and the re-ask in plain text worked first time.
  Impact: one rejected call.
  Self-recovered via the existing mechanism.
- `rule-ignored` — the plan draft carried PR [#1107]'s "six existing forwarding tests" count unverified; a grep found seven before the plan commit.
  Impact: one edit; self-identified.
- `rule-ignored` — the first `cd packages/pi-permission-system && …` call was denied by the permission policy, whose message names the rule (root-relative paths).
  Impact: one wasted call; self-identified.
- `rule-ignored` — two Red runs were piped through `grep` (`vitest run … | grep -E "✓|×|Tests"`) against the `testing` skill's run-bare rule.
  Impact: none here, since the failures were read from the filtered lines and not gated on the exit status.

#### What the operator steered

- `steer:choice`: "This said, tell me, what other mechanisms can you think of that would solve our needs?", attached to selecting the recommended slower refresh; it widened the option space past [#1052]'s two remedies.
  Reach: general, by the operator's answer at this retro's gate: "I'm trying to make sure we're considering the overall design.
  I haven't designed this whole system.
  This communication mechanism, I think we inherited it.
  So I'm trying to make sure we're not settling into local optima when there's a broader improvement to be made."
  That is `AGENTS.md` principle 6 ("look past the issue to the design it sits in") and `code-design`'s "Inherited features, config, and output get no protection", so the gate's narrow option space was those rules unapplied, not a missing rule.
  The same move appears in `packages/pi-subagents/docs/retro/1088-collapsible-transcript-blocks.md` ("Is there _anything_ new in Pi's API that will help us with any of this issue?", widening past the pinned surface).
- `steer:choice`: "Yes to both.
  Or perhaps, a more open ended issue, but we can propose that candidate.", after the agent offered to file the request-as-ping mechanism as a follow-up; the operator made the follow-up a decision issue with a candidate rather than a mechanism spec.
  Reach unstated.

### Diagnostic details

- **Unused-tool detection** — nothing missed; the cross-repo spawner check used `gh search code`, and the Pi trace stayed inline because its output was a universal claim the design rested on.
- **Model-performance correlation** — every turn, the Tidy-First assessor, and both pre-completion reviewer rounds ran on `anthropic/claude-opus-5-5` (from each subagent transcript); appropriate for the judgment-heavy work each did.
- **Feedback-loop gap analysis** — no gap: each step ran its file's tests and `pnpm run check` before committing, the shared-fixture step ran the full package suite, and the root gates ran at baseline, after the last step, and before the push.

### Changes made

1. None beyond this retro entry: every finding is covered by a rule already in `AGENTS.md`, `clarification-gates`, the `/plan-issue` template, or an existing mechanism (the `ask-user-text-first` guard, the permission policy, the pre-completion reviewer).

[#1052]: https://github.com/gotgenes/pi-packages/issues/1052
[#1107]: https://github.com/gotgenes/pi-packages/pull/1107
[#1149]: https://github.com/gotgenes/pi-packages/issues/1149
