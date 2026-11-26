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

[#1052]: https://github.com/gotgenes/pi-packages/issues/1052
[#1107]: https://github.com/gotgenes/pi-packages/pull/1107
[#1149]: https://github.com/gotgenes/pi-packages/issues/1149
