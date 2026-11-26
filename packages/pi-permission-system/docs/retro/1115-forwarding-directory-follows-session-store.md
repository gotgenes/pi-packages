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

[#1052]: https://github.com/gotgenes/pi-packages/issues/1052
[#1107]: https://github.com/gotgenes/pi-packages/pull/1107
[#1149]: https://github.com/gotgenes/pi-packages/issues/1149
