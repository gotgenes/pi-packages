---
issue: 1112
issue_title: "Foreground subagent calls in one assistant message run concurrently, contradicting the tool's own guideline"
---

# Retro: #1112 — Foreground subagent calls in one assistant message run concurrently, contradicting the tool's own guideline

## Stage: Planning (2026-11-25T17:36:40Z)

### Session summary

Third-party report (@richardaubin), confirmed in source: the `subagent` tool promises foreground calls run one at a time, but Pi runs a message's calls in parallel unless some tool declares `executionMode: "sequential"`, and foreground spawns bypass the limiter.
The operator chose the reporter's one-field fix (`executionMode: "sequential"` on the tool) plus a rewritten guideline, shipped as breaking (`fix(pi-subagents)!:`), keeping the `>=1.0.0` Pi floor.
Plan committed as `packages/pi-subagents/docs/plans/1112-sequential-subagent-calls.md`; follow-up [#1146] filed for the Pi 1.6.0 floor.

### Observations

- Pi has no per-tool exclusivity on `main`/1.6.0: one sequential tool serializes the whole batch, sibling `read`/`bash` included.
  The new guideline says so; the operator accepted the sibling cost.
- The operator raised bumping the Pi floor as an option.
  Pi 1.6.0 (`4438c58ba` in the Pi checkout, upstream #9986) answers unreached calls in an aborted batch with "Operation aborted"; below it they get pi-ai's "No result provided" padding.
  A spike that bumped the pins to 1.6.0 measured 3 `tsc` errors and 5 failing tests in `session-navigator.test.ts`, so the bump went to [#1146] rather than into this plan.
- Rejected alternatives: an in-package foreground gate (new runtime mechanism this package would own) and docs-only (foreground stays unbounded).
- `.pi/skills/pi-extension-lifecycle/SKILL.md` falsely claims Pi's built-in tools use sequential execution; no built-in declares `executionMode` in 1.0.0, and `pi-coding-agent` never sets `toolExecution`.
  Plan step 2 corrects it.
- The Tidy-First assessor recommended no preparatory commits and confirmed `defineTool` needs no cast for the literal.
- The reporter offered a PR if the direction is accepted; the plan credits the mechanism with `Co-authored-by: Richard Aubin <37956997+richardaubin@users.noreply.github.com>`.
  Whether to invite that PR is a `/ship`-time question.

#### Deferred tidyings

- `packages/pi-subagents/src/tools/agent-tool.ts`: the first guideline bullet and "Use run_in_background for work you don't need immediately" overlap; merging them is prompt-wording work outside this defect.

## Stage: Implementation — TDD (2026-11-26T01:44:42Z)

### Session summary

All four plan steps landed: the `fix(pi-subagents)!:` commit (`executionMode: "sequential"`, rewritten guideline, README and manager comments), the `pi-extension-lifecycle` correction, the upstream-assumptions row, and the live check.
Tests went from 2229 to 2231 in `pi-subagents`; check, root lint, the full suite, and `fallow dead-code` are green.

### Observations

- Live check (step 4), run through `pi -p --approve --no-session --mode json --model anthropic/claude-haiku-5-5` from the worktree root, reading the parent's `tool_execution_start`/`tool_execution_end` order:
  - Fixed code, two foreground calls in one message: start A, end A, start B, end B (serialized).
  - Control, pre-fix `agent-tool.ts` copied in from the parent of the fix commit: start A, start B, end B, end A (concurrent), so the probe discriminates.
  - Fixed code, three background calls in one message: each launch returned "Agent started in background." (none queued), so the runs overlap under `maxConcurrent`.
- The event-order probe needs no child `bash`, which avoids permission prompts in print mode; `--model haiku` is ambiguous across authenticated providers, so name `anthropic/claude-haiku-5-5`.
- Killing mutations: deleting the field reddened only the field test; restoring the old bullet reddened the guideline test at its `toContain`, so a second mutation (keep the new bullet, add the old sentence back) was needed to prove the `not.toContain` assertion discriminates on its own.
- The baseline `pnpm run test` stalled once in `pi-permission-system` (and again when re-run alone); after clearing processes it passed in 31.5 s, and every later root run finished.
  Not reproduced, so environmental.
- No `tsc` cast was needed for the `executionMode` literal, as the plan predicted.
- Pre-completion reviewer: WARN — the only finding was that the live-check result was not yet recorded; this entry records it.
  The reviewer re-derived every Pi fact in the skill edits against the pinned 1.0.0 `.js` and the 1.6.0 abort fix, and confirmed `next-version.sh` predicts a major.

## Stage: Sync (worktree) (2026-11-26T03:55:28Z)

### Session summary

Root `pnpm run lint` and `pnpm fallow dead-code` pass; the branch rebases onto local `main`.
The plan's marker is `**Release:** ship independently`, and the fix commit is breaking, so the `pi-subagents` release is a major; [#1146] (raise the Pi floor to 1.6.0) is the open follow-up.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-1112--/2026-11-25T17-27-51-668Z_01a213bf-e073-778d-86b6-7fa069c0555a.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

- Planning, TDD, and sync all ran in this one peer session.
- The reporter offered a PR; whether to reply that the fix landed in-house (credited via `Co-authored-by:`) belongs in `/ship`'s close comment.

## Stage: Final Retrospective (2026-11-26T04:19:59Z)

### Session summary

The root session fast-forward-merged the 7-commit branch onto `74346aa7`, passed lint, `fallow dead-code`, and CI, closed #1112 with a reply to @richardaubin (fix landed in-house with his `Co-authored-by:`, no PR needed, the pre-1.6.0 abort residual tracked in [#1146]), and released `pi-subagents-v26.0.0`.
The peer session's only real cost was a 32-minute TDD baseline "stall", which this retro traced to the laptop sleeping with its lid closed.

### Observations

#### What went well

- The planning spike priced the Pi floor bump instead of guessing: it bumped the three `@earendil-works/*` pins to 1.6.0, measured 3 `tsc` errors and 5 failing `session-navigator` tests, restored the tree, and filed [#1146].
- The live check used a control: the pre-fix `agent-tool.ts` copied from the fix commit's parent showed interleaved `tool_execution_start`/`tool_execution_end` events, so the serialized order on the fixed code is a discriminating result, not a default.
- The second guideline mutation (keep the new bullet, re-add the old sentence) proved the `not.toContain` assertion on its own, after the first mutation reddened only the `toContain`.

#### What caused friction

- `fact` — the TDD baseline's two timed-out calls were host sleep, not a test stall.
  `pmset -g log` shows `Entering Sleep state due to 'Clamshell Sleep'` at 17:41:16Z, 57 s into the batched `check; lint; test; fallow` call, then `DarkWake` at 17:51:12Z and 18:11:05Z: the exact timestamps the two tool results landed.
  The second call (300 s timeout) returned after 1185 s, overrunning its own timeout by about 885 s.
  The same signature explains `packages/pi-subagents/docs/retro/1088-collapsible-transcript-blocks.md`'s ship-stage lint stall: its timeouts landed at 17:10:26Z and 17:25:55Z on 2026-11-24, both `DarkWake` timestamps after a 17:00:31Z clamshell sleep.
  `packages/pi-permission-model-judge/docs/retro/1092-honor-project-trust.md`'s stalls ("overruns its own timeout by 700 s") predate the oldest `pmset` entry (2026-11-18), so they are consistent with sleep but unverified.
  Impact: about 32 minutes of wall-clock (17:40:19Z to 18:12:29Z) across five calls, plus a stage note that blamed leftover processes, which `pgrep` had just shown did not exist.
  Neither the agent nor the operator caught it in session; found in this retro.
- `slip` — planning's `cd packages/pi-subagents; …` was denied by the `cd packages/*` policy rule; recurring, and the deny rule is already the mechanism.
  Impact: one call.
- `slip` — the live check's first `pi -p --model haiku` failed: `Model "haiku" is ambiguous across providers`; the error named the fix (`anthropic/claude-haiku-5-5`).
  Impact: one call.
  Self-identified.

#### What the operator steered

- `steer:choice`: "We always have the option of bumping the version of Pi on which we depend.", interjected while the agent was reading only the pinned 1.0.0 surface, before any gate.
  The operator's words made it general ("always").
  It led to finding Pi's abort fix (`4438c58ba`, 1.6.0), the measured bump spike, and [#1146].
  `packages/pi-subagents/docs/retro/1088-collapsible-transcript-blocks.md` records the same choice: "Is there _anything_ new in Pi's API that will help us with any of this issue?" and "I don't mind a version bump of Pi if it helps guarantee something."
  `.pi/skills/code-design/SKILL.md` already says to raise the floor "when that simplifies the code"; both steers widen it to a newer release that fixes behavior the change relies on.

### Diagnostic details

- **Model-performance correlation** — every peer turn, the `tidy-first-assessor` (5 turns), the `pre-completion-reviewer` (29 turns), and this root session ran on `anthropic/claude-opus-5-5`; no mismatch.
- **Escalation-delay tracking** — the baseline stretch took five calls and 32 minutes of wall-clock, but only because two of them slept through the lid closure; the agent's own response (re-run alone, then a `timeout 120` run) was right for a genuine stall.
- **Unused-tool detection** — the host's own sleep log (`pmset -g log`) was available and would have named the cause in one call; no prior retro had looked there.
- **Feedback-loop gap analysis** — per-file `vitest` runs after each Red, Green, and mutation, `check` after the Green edit, and the root gates before the commit; no end-only verification.

### Changes made

1. `.pi/skills/code-design/SKILL.md`: the Pi-floor bullet now also covers a newer release that fixes behavior the change relies on, and says to offer the bump as an option at the planning gate (the operator confirmed the choice as general).

2. `.pi/skills/code-design/SKILL.md`: after the commit, the operator widened the bullet to every upstream dependency ("That bump advice isn't just for pi, but any upstream package on which we depend."), so it now names an upstream dependency's floor, Pi or any other package.

Proposed and declined: P1, adding a host-sleep check (`pmset -g log`) to the `testing` skill's stall rule; the finding stays in this retro.

[#1146]: https://github.com/gotgenes/pi-packages/issues/1146
