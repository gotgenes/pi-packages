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

[#1146]: https://github.com/gotgenes/pi-packages/issues/1146
