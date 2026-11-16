---
issue: 1079
issue_title: "pi-subagents: get_subagent_result reports \"No output.\" for an agent still queued behind maxConcurrent"
---

# Retro: #1079 — pi-subagents: get_subagent_result reports "No output." for an agent still queued behind maxConcurrent

## Stage: Planning (2026-10-18T03:33:18Z)

### Session summary

Reproduced the report through `GetResultTool.execute` with a disposable spike (queued agent behind a never-opened `gatedScheduler`), which surfaced three queued misstatements in one report: the `No output.` body, a bounded-wait note saying "still running" and "waiting again will not unstick it", and a `Duration` stat labeled `(running)`.
The operator scoped the fix to the body and the wait note, chose the "waiting for a concurrency slot (maxConcurrent)" wording, and deferred the `Duration` stat to [#1080], recorded as a new Phase 23 step after this one.
The plan is three code steps (a shared `queuedAgent()` test fixture, then two `fix:` steps) plus the landing doc step.

### Observations

- `createTestSubagent` defaults `result` to `"All done."` and `completedAt` to `2000`; the spike's first run rendered `All done.` for a queued agent, so the plan's fixture sets both to `undefined` and the new tests assert `not.toContain("No output.")`.
- The Tidy-First assessor recommended nothing; its optional `queuedAgent()` helper was folded in as Step 1 because Steps 2 and 3 would add the third and fourth copies of the inline queued setup.
- Rejected: a `queued` entry in `STATUS_MEANINGS` (it would change the `Status:` header and the foreground carriers' framing) and editing the `timeout` parameter description (general guidance in every parent's prompt; the per-report note overrides it for queued agents).
- Only `get_subagent_result` can observe a queued run: `foreground-runner.ts` and `agent-tool.ts` render after `await record.promise`, and the nudge fires on terminal status.

#### Deferred tidyings

- `src/tools/get-result-report.ts`: `renderReportBody` is a one-line pass-through to `renderOutcomeBody`, kept because `get-result-report.test.ts` calls it directly.

## Stage: Implementation — TDD (2026-10-18T03:46:09Z)

### Session summary

All four plan steps landed: the shared `queuedAgent()` fixture, the queued arm in `renderOutcomeBody`, the status-aware `renderWaitExpired`, and the architecture-doc landing.
The pi-subagents suite went from 2173 to 2179 tests (+6), and check, root lint, and `fallow dead-code` stayed green.

### Observations

- No deviations from the plan.
- Every killing mutation produced the reds the plan predicted: deleting the queued body arm turned all 4 Step 2 tests red, disabling the queued wait branch turned both Step 3 tests red, and inverting it also killed the existing running exact-text and `EXPIRY_NOTE` tests, so those really pin the running note byte for byte.
- The `&& false` mutation tripped `pi-autoformat`'s Biome `noConstantCondition` check; that is harmless for a temporary mutation, but a compared-literal mutation (`!==`) avoids the noise.
- Pre-completion reviewer: WARN.
  Its one finding: `architecture.md` line ~962 still describes the queued `No output.` body, but that is the Phase 23 sweep disposition explaining why this issue was filed, i.e. historical context, so it was left as is.
  The reviewer independently confirmed that only `get_subagent_result` can observe a queued run.

## Stage: Sync (worktree) (2026-10-18T15:51:41Z)

### Session summary

Pre-push `pnpm run lint` and `pnpm fallow dead-code` passed from the worktree root.
The plan's marker is `**Release:** ship independently`, with two `fix(pi-subagents):` commits (a patch); [#1080] (the queued agent's `Duration` stat) is filed and recorded as the next Phase 23 step, so it is not part of this land.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-1079--/2026-10-18T03-24-10-047Z_01a14d09-cbbe-70f9-ab6f-e6cb08c56636.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

- The one open item from the TDD stage (the reviewer's WARN on the historical sweep line in `architecture.md`) was settled there as non-blocking; nothing is carried to `/ship`.

## Stage: Final Retrospective (2026-10-18T16:26:58Z)

### Session summary

The worktree lane ran end to end with no rework: planning, TDD, and sync in one peer session, then a clean fast-forward land, a green CI run, and the `pi-subagents-v25.0.1` release from the root.
The fix covers the queued body and the queued bounded-wait note; the queued `Duration` stat is [#1080], the next Phase 23 step.

### Observations

#### What went well

- The planning spike drove the real `GetResultTool.execute` instead of a renderer unit, and so surfaced three queued misstatements where the issue named one; the operator could scope all three at one gate.
- The `createTestSubagent` false-green was caught twice independently: the spike's first run rendered `All done.` for a queued agent, and the `tidy-first-assessor` flagged the same `result`/`completedAt` defaults (`make-subagent.ts:105`) without being told.
  The plan's `not.toContain("No output.")` assertions came from that.
- The planned killing mutations each turned exactly the predicted tests red, and the inverted-branch mutation proved the existing `EXPIRY_NOTE` tests pin the running note byte for byte.
- In sync, an em-dash arrived as a literal `\\u2014` escape in an `Edit` body; `pi-autoformat` decoded it and `unicode-escapes.mjs` confirmed the file clean, so the escape gate caught a real slip with zero rework.

#### What caused friction (agent side)

- `instruction-violation` — In `/ship` step 9 I passed the close comment to `issue_close` without first running the `git rev-parse <sha>^{commit}` / `git merge-base --is-ancestor <sha> main` re-check the step requires (self-identified at retro).
  The three SHAs were pasted from a `git log 91854988..HEAD` taken after the ff-merge, so each was reachable from `main` by construction, and `issue_close` itself resolved them.
  Impact: none; the published SHAs are correct.
- `other` — The TDD stage's `&& false` mutation tripped `pi-autoformat`'s Biome `noConstantCondition` diagnostic.
  Impact: one line of noise; the vitest run was still valid.
- `other` — One `Edit` in TDD step 3 (`get-result-report.ts`) failed to match and needed a re-read before the retry.
  Impact: one extra tool call.

#### What caused friction (user side)

- None observed; the operator's two gates (scope plus wording, and the #1080 roadmap disposition) were answered once each and were strategic decisions, not mechanical oversight.

### Diagnostic details

- **Model-performance correlation** — Planning and TDD ran on `anthropic/claude-opus-5-5` (thinking high), which fit the judgment-heavy scoping and mutation design.
  Sync switched to `anthropic/claude-sonnet-5-5`, appropriate for its mechanical checks and rebase.
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `anthropic/claude-sonnet-5-5` per their transcripts, and both produced verified, file-cited findings (the assessor's false-green flag, the reviewer's call-site enumeration), so no mismatch.
- **Feedback-loop gap analysis** — No gap: TDD ran the targeted vitest files after every red, green, and mutation, `check` per step, and the full suite, lint, and `fallow` at the end; `/ship` re-ran lint and `fallow` on the merged tree before pushing.

### Changes made

1. `.pi/skills/package-pi-subagents/SKILL.md` — `## Testing` now names `createTestSubagent`'s `result`/`completedAt` defaults and says a `queued` or `running` fixture passes both as `undefined`.

[#1080]: https://github.com/gotgenes/pi-packages/issues/1080
