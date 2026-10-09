---
issue: 947
issue_title: "pi-subagents: `get_subagent_result(wait: true)` has no timeout and reports no progress, so a stalled child blocks the parent until a human interrupts"
---

# Retro: #947 — `get_subagent_result(wait: true)` has no timeout and reports no progress

## Stage: Planning (2026-10-09T04:04:56Z)

### Session summary

Planned Phase 23's Track B lead step for a third-party issue (Echokovo): an optional `timeout` (seconds) on `get_subagent_result` that bounds a `wait: true` without touching the child, plus a progress line (activity, turns, time since last progress) on every report about a running agent.
The plan is eight steps: the roadmap's `textOf` ride-along, two tidy-first refactors in `get-result-tool.ts`, the `lastProgressAt` state and observer stamp, then two `feat:` steps and a docs step.

### Observations

- Operator gate (third-party direction plus design): opt-in `timeout` with no default (mirroring `bash`'s name and unit; the issue's `timeoutMs` "(seconds)" contradicted itself); last progress stamped by `record-observer` on every session event rather than the transcript mtime the issue proposed; the progress line on every running report; `onUpdate` streaming deferred.
- The bound reuses `waitUntilSettled` unchanged: a timer-backed signal takes the existing `unsettled` path, so Phase 22's claim/consume semantics carry over with no new branch.
- The progress line lives in `formatAgentReport`, not the shared `renderOutcomeBody`, so other outcome carriers are unaffected.
- `GetResultDetails` (TUI) is not widened, so [#755]'s `buildReport`/`buildGetResultDetails` overlap stays as the roadmap anticipated.
- ADR 0005 governs `SubagentRecord` only; the plan adds one Consequences sentence saying the pulled report may carry momentary activity.
- `resetForResume` gains one more reset line (`_lastProgressAt`), which [#1051] carries when it moves run state onto the run object.
- Tidy-first assessor: recommended `GetResultParams` extraction and the wait-method extraction (both adopted); the `buildReport` options object was optional and dropped.

#### Deferred tidyings

- `src/tools/get-result-tool.ts` — `buildReport` takes positional `verbose`/`resumedWhileWaiting` flags; an options object would help if a further flag lands.

## Stage: Implementation — TDD (2026-10-09T04:23:30Z)

### Session summary

All eight plan steps landed as eight commits: the `textOf` ride-along, the `GetResultParams` and `collectOutcome` refactors, `SubagentState.lastProgressAt`, the `record-observer` stamp, the `Progress:` line, the bounded wait, and the docs.
The pi-subagents suite went from 2065 to 2097 tests; every killing mutation the plan named reddened exactly the tests it predicted.

### Observations

- Deviation: the `Subagent.lastProgressAt` getter moved from step 4 to step 6, because `fallow dead-code` flags an unused class member and nothing read it until the report did.
- Deviation: `buildReport` now takes a `CollectedOutcome` (`superseded?`, `waitExpiredAfter?`) instead of the positional `resumedWhileWaiting` flag, which absorbs the assessor's optional options-object tidying rather than adding a fifth positional argument.
- Added beyond the plan: an exact-text `formatAgentReport` test for the expiry note (authored after Green, killed by a wording mutation).
- `renderProgressLine`, `renderWaitExpired`, and `ReportProgress` stay module-private in `get-result-report.ts`; `WaitBound` and `validateTimeout` are private to `get-result-tool.ts`.
- The architecture metric table has no current-value column, so the `result.content[0]` row was left as is; the `Landed:` note records that it reads 0.
- Pre-completion reviewer: PASS (all four re-derived invariants code-verified).

## Stage: Sync (worktree) (2026-10-09T04:45:37Z)

### Session summary

Pre-push `pnpm run lint` and `pnpm fallow dead-code` passed on the branch before the rebase onto `main`.
The plan's marker is `**Release:** ship independently`; two `feat:` commits (the `Progress:` line and the bounded wait) carry the release, and no follow-up issues were filed.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-947--/2026-10-09T03-55-40-799Z_01a11ecd-697e-77c5-bd2d-d7032fd634a0.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

- `onUpdate` streaming during a wait stays deferred with no issue filed, as the plan's Open Questions say.

[#755]: https://github.com/gotgenes/pi-packages/issues/755
[#1051]: https://github.com/gotgenes/pi-packages/issues/1051
