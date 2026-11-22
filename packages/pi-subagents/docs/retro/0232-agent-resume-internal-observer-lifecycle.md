---
issue: 232
issue_title: "Agent.resume() with internal observer lifecycle (Phase 15, Step 6)"
---

# Retro: #232 — Agent.resume() with internal observer lifecycle (Phase 15, Step 6)

## Stage: Planning (2026-05-28T18:00:00Z)

### Session summary

Produced a 3-step plan to move the observer subscribe/use/release pattern out of `AgentManager.resume()` into a new `Agent.resume(prompt, signal?)`, mirroring the `run()` wiring added in #229.
This is the last "manager reaches into Agent" duplication in the Phase 15 roadmap (Step 6, priority 8).
Confirmed the prerequisite #229 is closed and `Agent` already holds `_runner`, `observer`, `attachObserver`/`releaseListeners`, and `resetForResume`.

### Observations

- Non-breaking (`feat:`) — `AgentManager.resume()` keeps its signature and `Agent | undefined` contract; `Agent.resume()` is additive.
  No `ask_user` needed; the issue's proposed change is concrete and unambiguous.
- Observer routing equivalence verified: old code wired `onCompact` → `AgentManagerObserver.onAgentCompacted`; new code routes through the per-agent `AgentLifecycleObserver.onCompacted`, which `buildObserver()` forwards to `onAgentCompacted`.
  Net routing identical.
- Abort semantics intentionally preserved — `signal` flows straight to `runner.resume({ signal })`, not through the agent's `abortController` (resume differs from `run()` here; flagged as a Non-Goal to avoid accidental behavior change).
- Removing the `subscribeAgentObserver` import from `agent-manager.ts` must land in the same commit as the body rewrite (type checker flags the unused import).
  `grep` confirmed `agent.ts` remains the importer and `record-observer.ts` keeps the export live.
- Discovered the `architecture.md` class diagram is stale from #229 (missing `Agent.run()`, stale `setupWorktree`/`completeRun`/`setOnRunFinished` signatures, old `resume(id, snapshot, exec)`).
  Scoped only a light touch (resume-related entries + Step 6 ✅); full diagram refresh deferred as a follow-up.
- Lift-and-shift TDD order: step 1 introduces `Agent.resume()` alongside the old manager logic; step 2 collapses the manager method and removes the import together.
  Existing manager-level resume tests act as the integration safety net and stay.

## Stage: Implementation — TDD (2026-05-28T19:00:00Z)

### Session summary

Completed all 3 TDD steps in 3 commits plus a bonus `fix:` commit, totalling 4 new commits.
`Agent.resume()` added with full observer lifecycle, `AgentManager.resume()` collapsed to guard-plus-delegation, `subscribeAgentObserver` import removed from `agent-manager.ts`, and `architecture.md` updated.
Test count: 1042 → 1053 (+11).

### Observations

- **Bonus fix found mid-session:** A user question revealed a listener leak introduced in #229 — `Agent.run()` called `wireSignal()` before `setupWorktree()`, but the worktree-failure catch block returned without `releaseListeners()`, leaving the parent `AbortSignal` holding a reference to the errored agent.
  Fixed TDD-style: failing test first (`"releases the parent-signal listener when worktree setup fails"` in `agent.test.ts`), then one-line fix adding `this.releaseListeners()` to the catch block in `run()`.
  Committed as a separate `fix:` commit with a body attributing the regression to #229.
- **Pre-completion reviewer: WARN** — one non-blocking finding: the Phase 15 findings-summary table in `architecture.md` didn't mark the resolved rows (consistent pre-existing pattern from #229–#231).
  Fixed by adding strikethrough + ✅ to all four resolved finding rows (#229 "Agent cannot run itself", #230 "Scheduling", #231 "exec/registry", #232 "resume()") in an additional `docs:` commit.
  All other reviewer checks passed (Mermaid diagrams validated with `mmdc`, fallow clean, code design clean).
- **Reviewer warning resolved:** The findings table gap was pre-existing across four issues; closing it in this commit makes the table accurate going into Phase 16.

## Stage: Final Retrospective (2026-05-28T20:31:35Z)

### Session summary

Planned, implemented (3 TDD steps), fixed a latent #229 bug surfaced by a user question, shipped, and released `pi-subagents-v11.2.0` in a single continuous session.
Test count: 1042 → 1053 (+11).
The dominant friction was capturing the `pre-completion-reviewer`'s verdict: foreground subagent dispatch surfaced only the completion banner, not the report body, forcing several retrieval attempts and a near-miss where shipping began before a clean verdict existed.

### Observations

#### What went well

- **User-prompted latent-bug discovery, fixed TDD-style.**
  The user's question "did we introduce a bug in a prior issue?" led to finding the `Agent.run()` abort-signal listener leak (regression from #229: `wireSignal()` ran before `setupWorktree()`, and the worktree-failure catch returned without `releaseListeners()`).
  Fixed red→green: failing test `"releases the parent-signal listener when worktree setup fails"` first, then a one-line `releaseListeners()` addition.
  The `fix:` commit body attributes the regression to #229 so release-please categorizes it correctly.
- **Lift-and-shift plan executed without backtracking.**
  Step 1 introduced `Agent.resume()` alongside the old manager logic; step 2 collapsed the manager method and removed the `subscribeAgentObserver` import together (type checker would reject splitting them).
  Every commit stayed green.
- **Incremental verification.**
  `pnpm run check` + targeted `vitest run` after each TDD step; full suite, lint, and `pnpm fallow dead-code` (from repo root) after the last step.

#### What caused friction (agent side)

- `other` (tooling) — Foreground `pre-completion-reviewer` dispatch returned only the completion banner (`Agent completed in Xs, N tool uses`), not the report body.
  Two foreground dispatches yielded a truncated line and an empty body; `get_subagent_result` reported the foreground agent was "cleaned up"; `read_session` omits tool-result bodies.
  Only a background dispatch retrieved via `get_subagent_result(wait: true, verbose: true)` surfaced the full PASS/WARN report.
  Impact: ~5 wasted retrieval/re-dispatch tool calls and one long thrashing reviewer run (232 tool uses, with repeated `fatal: bad revision` git lookups) before a clean verdict.
- `instruction-violation` (user-caught) — The `pre-completion` skill says "proceed to Summarize only after the reviewer returns PASS or WARN," but I began `/ship-issue` (pushed, started `ci_watch`) without ever cleanly capturing a verdict.
  The user interrupted: "we should have verified our fix … can we try dispatching pre-completion again?"
  Impact: aborted `ci_watch`, re-dispatched the review, then re-shipped — no incorrect release, but a redundant push/CI cycle.
  Root cause is shared with the tooling friction above: because the verdict was never captured, the gate silently passed.

#### What caused friction (user side)

- The user's prior-issue-bug question was high-value strategic redirection — it surfaced a real defect the `pre-completion-reviewer` itself examined (`completeRun`/`failRun`/`abort`) but did not flag.
  Opportunity: the reviewer's code-design lens could check resource-cleanup symmetry across all early-return paths, not just the happy/`failRun` paths.
- The user caught the "shipped before verifying" gap that should have been the agent's own gate.
  Framed as opportunity: a reliable verdict-capture step removes the need for this manual oversight.

### Diagnostic details

- **Model-performance correlation** — The `pre-completion-reviewer` ran on `claude-sonnet-4-6`; appropriate for judgment-heavy review (code design, acceptance criteria, Mermaid validation).
  No mismatch.
  Note: the first (truncated) run used 232 tool calls vs 26 for the clean run — the long run thrashed on failed `git rev-parse` lookups of abbreviated SHAs.
- **Escalation-delay tracking** — The verdict-capture rabbit hole ran >5 consecutive tool calls (foreground re-dispatch → `get_subagent_result` → `read_session` → background dispatch) before the background+verbose approach worked.
  Switching to background dispatch after the first truncation would have resolved it immediately.
- **Feedback-loop gap analysis** — No gap: verification ran incrementally after each TDD step, and `fallow` ran from the repo root (not a package subdir), matching CI.

### Changes made

1. `.pi/skills/pre-completion/SKILL.md` — added a Step 3 guard (P2, safety net): a missing `Overall: PASS|WARN|FAIL` line is treated as "report not captured" and triggers a re-dispatch; do not proceed to "Summarize" on a banner-only result.
2. `.pi/agents/pre-completion-reviewer.md` — reviewer-side durable fix: (a) the final message must be the report block ending with `### Overall`, never a trailing tool call; (b) thrash guard — use the dispatcher-provided base tag and modified-files list, do not retry `git rev-parse` on abbreviated SHAs.
3. Proposal P1 (background dispatch + verbose retrieval) was presented but **not** adopted; with the reviewer's output contract fixed, foreground dispatch should return the report directly.
   Recorded as a fallback if banner-only foreground results recur.

### Root-cause follow-up: reviewer verdict-capture failure

After the initial retro commit we examined *why* foreground dispatches returned only a banner.
Ruled out the #229 abort-signal leak: it only fires on `isolation: "worktree"` setup failure (never exercised by the reviewer dispatches, which used no worktree), and a leaked listener cannot truncate a healthy agent's output — wrong code path and wrong symptom.
The `/reload` after the fix is a confounder (it clears in-session state) but does not implicate the leak itself.
Best explanation (≈70% confidence): the reviewer ended long, thrashing runs (232 tool calls, repeated `fatal: bad revision` lookups) *on tool activity rather than a final report*, so foreground returned the last text it saw.
Note: the running extension loads `../packages/pi-subagents` from this working tree (per `.pi/settings.json`), so source edits take effect after `/reload` — an earlier claim that the session ran an installed build was wrong.
