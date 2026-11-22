---
issue: 265
issue_title: "Born-complete child execution; dissolve the runner"
---

# Retro: #265 — Born-complete child execution; dissolve the runner

## Stage: Planning (2026-05-30T02:30:00Z)

### Session summary

Produced the implementation plan for dissolving the `agent-runner` and introducing a born-complete `SubagentSession`.
Most of the session was a design dialogue that resolved naming, the turn-loop home, a discovered Law-of-Demeter cluster, and the workspace-ownership fork before any plan text was written.
Plan committed as `0265-born-complete-subagent-session.md`; a side-quest filed #277 and added an architecture-doc breadcrumb for discovered debt.

### Observations

- Vocabulary was pinned down explicitly because "execution" is overloaded: granular execution = one turn loop (one `session.prompt()`, run or resume); the born-complete object spans the whole session lifetime (run + resumes).
  The object is named `SubagentSession` (matches the existing `SubagentType` / `SubagentSessionDir` / `SubagentSessionRegistry` family; cohesive with the deferred `Agent` → `Subagent` rename).
  Turn driving is `runTurnLoop` / `resumeTurnLoop`; resume is *not* an SDK `session.resume()` — it is `session.prompt()` again on the retained session.
- The turn-loop home is **on `SubagentSession`** (methods), not inline on `Agent` and not a free function.
  The user caught that `subagent.driveTurnLoop(subagentSession.session, …)` is a Law-of-Demeter reach-through; putting the behavior on the object that owns the `AgentSession` is both LoD-correct and more testable (satisfying the user's conditional "inline only if straightforward to test").
- Workspace ownership locked to **Option A** (session-only `SubagentSession`; `Agent` keeps workspace prepare/dispose).
  Decisive reasoning: the workspace and the session have genuinely different lifetimes (workspace dies at run-completion to fold its `resultAddendum` into the result; session survives to cleanup for resume + the new registry boundary), so they are different resources.
  Option B would fuse them into one object needing two teardown methods, and would thread the `WorkspaceProvider` + prepare-context through the factory just to call `prepare()` — a parameter-relay smell the user flagged.
  The factory takes a resolved `cwd` value (used directly), never the provider.
- Worktrees are already out of the core (#263) — confirmed zero git code in `pi-subagents/src/` (only doc comments).
  The A/B fork is purely about how the core sequences its abstract `WorkspaceProvider` seam; `@gotgenes/pi-subagents-worktrees` is untouched.
- Registry semantics: moving `disposed` from run-completion to true session disposal makes resume executions registry-detected (closes the gap deferred from #261).
  The permission system's subscription code does not change; only *when* `disposed` fires moves.
  Edge case planned: `createSubagentSession` must dispose on a post-`session-created` failure to avoid a registry leak.
- Discovered debt captured (the user's "it is in doing the work that we discover the work to be done"): filed #277 for the remaining `agent.session` reach-throughs (steer buffer-or-deliver duplicated across `steer-tool` + `service-adapter`, conversation viewing, resume-readiness guards) and added a "Session encapsulation debt (Law of Demeter)" subsection to `architecture.md` (commit `038a1283`).
  `SubagentSession` exposes a `.session` accessor in #265 so observer wiring + consumers keep working; #277 retires those.
- Two follow-ups deliberately deferred and noted in the plan's Non-Goals / Open Questions: the `Agent` → `Subagent` class rename (mechanical, ~19 files — separate issue) and resume-aware workspaces (a worktree's lifetime is one turn loop; worktree + resume is degenerate today).
- The change is non-breaking (no `feat!:`): the dissolved types (`RunOptions`, `RunResult`, `AgentRunner`) are internal, so `public.d.ts` is unaffected.
  TDD order uses lift-and-shift across 7 steps to keep each commit compiling; transient duplication of the turn-loop helpers/assembly exists between steps 3–5 and is deleted in step 6.

## Stage: Implementation — TDD (2026-05-29T22:18:00Z)

### Session summary

Executed all 7 TDD steps from the plan via lift-and-shift, one commit per step, each leaving the suite green.
Introduced `SubagentSession` (`runTurnLoop`/`resumeTurnLoop`/`steer`/`dispose`) and the `createSubagentSession()` assembly factory, swapped `Agent`/`AgentManager`/`index.ts` onto them, then deleted `agent-runner.ts` + `execution-state.ts` and the three runner test files.
Package test count went 951 → 960 (net +9: new `subagent-session`/`create-subagent-session`/`turn-limits` suites added, the redundant runner suites deleted).
Pre-completion reviewer: initial FAIL (MD060 table alignment in SKILL.md, auto-fixed by `rumdl fmt`), PASS on re-check after fix + stale doc cleanup.

### Observations

- The plan sketch's `TurnLoopOptions` listed only `maxTurns`/`graceTurns`/`signal`, but preserving the old `runAgent` precedence `per-call ?? agentMaxTurns ?? defaultMaxTurns` required threading `defaultMaxTurns` through `TurnLoopOptions` and storing `agentMaxTurns` + `parentContext` in `SubagentSession` meta (both are session-level facts known at creation).
  This is a correctness-preserving deviation, well covered by three precedence tests plus a parent-context-prepend test in `subagent-session.test.ts`.
- The atomic call-site swap (step 5) touched more test files than the plan's step-5 list anticipated: every tool/service test that set `record.execution = { session, outputFile }` (`steer-tool`, `agent-tool`, `background-spawner`, `foreground-runner`, `get-result-tool`, `service-adapter`) had to migrate to `record.subagentSession = toSubagentSession(createSubagentSessionStub(...))`.
  Added `createSubagentSessionStub`/`toSubagentSession` to `mock-session.ts` so the migration was a one-line change per call site; the stub's `steer`/`dispose` delegate to the underlying `MockSession` so existing session-spy assertions kept working unchanged.
- `disposed` moved from `runAgent`'s `finally` (run-completion) to `SubagentSession.dispose()`, invoked by `AgentManager` via the new `Agent.disposeSession()` (routing both `record.session?.dispose?.()` call sites at `agent-manager.ts:235,309`).
  The full cross-package suite confirms the permission system (1504 tests) is unaffected — its subscription code did not change, only *when* `disposed` fires.
- Test-helper gotcha: `makeSubagentSession`'s `outputFile` default initially swallowed an explicit `undefined` via `?? default`; fixed with an `"outputFile" in metaOverrides` presence check (the testing-skill "Partial spread erases explicit undefined" family).
- `print-mode.test.ts` now mocks `#src/lifecycle/create-subagent-session` (was `#src/lifecycle/agent-runner`); `index.ts` wraps the factory as `(params) => createSubagentSession(params, deps)`, so the module mock still intercepts it.
- fallow stayed clean throughout — the transient duplication of IO interfaces + turn-loop helpers between `agent-runner.ts` and the new modules (steps 3–5) was removed in step 6 before the pre-completion gate ran.
- Reviewer's two minor non-blocking notes: SKILL.md Session-domain count now lists `conversation.ts` but still omits the pre-existing `content-items.ts` (drift predates this issue); `create-subagent-session.ts` keeps an accurate "old runner's runAgent()" provenance comment.

## Stage: Final Retrospective (2026-05-30T13:37:00Z)

### Session summary

Shipped issue #265 (`pi-subagents-v13.1.0`) and ran the retrospective across all three stages (planning, TDD implementation, ship).
The implementation landed cleanly in 7 TDD commits + 1 docs commit; test count 951 → 960.

### Observations

#### What went well

- The lift-and-shift strategy (new modules alongside old, swap consumers, delete old) kept every intermediate commit compiling and the suite green — zero broken-baseline moments across 7 steps.
- The `createSubagentSessionStub` pattern (steer/dispose delegate to the wrapped `MockSession`) let 6 tool/service test files migrate with a one-line change each, preserving all existing session-spy assertions.
- Verification ran incrementally: `pnpm vitest run <file>` after every Red/Green, `pnpm run check` after every interface change, and `pnpm -r run test` (full cross-package) after step 6's deletion to confirm the permission system (1504 tests) was unaffected.

#### What caused friction (agent side)

1. `missing-context` — The plan's step-5 file list omitted 6 tool/service test files (`steer-tool`, `agent-tool`, `background-spawner`, `foreground-runner`, `get-result-tool`, `service-adapter`) that directly set `record.execution = { session, outputFile }`.
   The existing planning rule ("grep all test files for every removed symbol") was present but was not applied to the renamed `.execution` property — only to removed type imports.
   Impact: step 5 took ~2× expected time; each file was discovered reactively via `tsc --noEmit` errors.
2. `rabbit-hole` — Step 6's `sed` invocation for import-path renames failed silently on macOS BSD `sed` because the `#` delimiter clashed with `#test/helpers/...` paths.
   3 consecutive tool calls were spent diagnosing and retrying before switching to per-file `sed` with `@` delimiters.
   Impact: added ~3 minutes of friction; the `edit` tool would have been safer for targeted, known-file replacements.
3. `other` (autoformat race) — The `pi-autoformat` extension ran concurrently with `git commit` twice during the docs phase, causing `.git/index.lock` conflicts.
   Recovery was mechanical (remove lock, retry) but required user intervention once.
   Impact: one user prompt to retry; no rework.
4. `other` (markdown table alignment) — Replacing short table cells with long module lists in SKILL.md broke MD060's compact-table rule.
   The pre-completion reviewer caught it (initial FAIL); `rumdl fmt` auto-fixed it.
   Impact: one amend + re-lint cycle; self-identified after reviewer report.

#### What caused friction (user side)

- No user-side friction observed.
  The user's only intervention was a retry prompt after the autoformat/git-lock race — a timing issue, not a judgment or context gap.

### Changes made

1. `.pi/skills/testing/SKILL.md` — added rule about `??` swallowing explicit `undefined` in factory overrides (under "Vitest mock patterns").
2. `packages/pi-subagents/docs/retro/0265-born-complete-subagent-session.md` — appended Final Retrospective stage entry.
