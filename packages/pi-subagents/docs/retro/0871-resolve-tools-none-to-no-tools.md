---
issue: 871
issue_title: "pi-subagents: an agent declaring tools: none receives all seven built-in tools"
---

# Retro: #871 — pi-subagents: an agent declaring tools: none receives all seven built-in tools

## Stage: Planning (2026-09-05T06:27:57Z)

### Session summary

Committed `packages/pi-subagents/docs/plans/0871-resolve-tools-none-to-no-tools.md` (2 steps: one `fix:` cycle with three new registry tests, one `docs:` step marking Phase 22 Step 13 landed).
The operator chose the one-line delegating body for `getToolNamesForType` over a bare operator flip, and `fix:` (patch) over `fix!:` — matching the roadmap's Step 13 entry.
No follow-up issues filed.

### Observations

- The design settled on replacing the whole five-line body with `return this.resolveAgentConfig(type).toolNames ?? [...BUILTIN_TOOL_NAMES];` rather than flipping `?.length ?` to `??` in place.
  The delegating form removes a **second** fail-open of the same shape — the `enabled !== false` guard, which turned "this agent is disabled" into "give it all seven" — and ends a live disagreement where the same disabled type yielded its own prompt and model from `resolveAgentConfig` but everyone's tools from `getToolNamesForType`.
- Measured rather than argued, per the plan's own table: both candidate bodies were spiked into `src/config/agent-types.ts` and the full package suite run (76 files / 1561 tests, green under each), with the file restored from a `/tmp` backup copy after each.
  That answers the issue's stated open question — nothing depends on the current coalescing — and also establishes that the disabled-agent branch has no pin, which is why the plan adds one.
- The SDK end was verified from compiled source, not types: `dist/core/sdk.js:141,144` in the pinned `@earendil-works/pi-coding-agent@0.84.4` uses `options.tools ?? …`, so an empty allowlist is honored rather than falling back to the SDK defaults.
  The `.d.ts` shows only `tools?: string[]` and would not have answered it.
- Breaking classification was surfaced to the operator even though the roadmap had already recorded `fix:`.
  The change does alter observable behavior on upgrade with no user edit (seven tools → zero), but `docs/configuration.md:177` has always documented `tools: none # no tools at all`, no agent file in this repo declares it, and the operator confirmed `fix:` → 21.4.2.
- `docs/configuration.md` needs no edit: the code moves to the doc, not the other way round.
  This was checked by grep rather than assumed — no live doc, README section, or skill asserts the buggy behavior.

#### Deferred tidyings

- `packages/pi-subagents/src/config/agent-types.ts` + `src/config/custom-agents.ts` — `BUILTIN_TOOL_NAMES` is handed out **by reference** in two places (`custom-agents.ts:62` as `listField`'s default, `agent-types.ts:116` in the absolute fallback), so a future consumer that mutates a returned `toolNames` array would corrupt the module constant.
  The Tidy-First assessor confirmed no current consumer mutates (`session-config.ts:156,178`, `create-subagent-session.ts:256` only read, spread, or map), and rejected freezing it as scope creep for a `fix:`.
  Worth its own hardening issue.
- `packages/pi-subagents/test/config/agent-types.test.ts` — the `describe("getToolNamesForType")` block will hold seven flat siblings after this change, mixing per-agent spot-checks with the `toolNames` field's own present/empty/absent axis.
  Offered by the assessor as Optional and marked not required; declined here to keep the change tight.

## Stage: Implementation — TDD (2026-09-05T06:39:52Z)

### Session summary

Executed both plan steps with no deviations: one `fix:` cycle replacing `AgentTypeRegistry.getToolNamesForType`'s five-line body with `return this.resolveAgentConfig(type).toolNames ?? [...BUILTIN_TOOL_NAMES];` plus three new registry tests, then a `docs:` step marking Phase 22 Step 13 landed.
Test count for `pi-subagents` went 1561 → 1564 (76 files, all green); `check`, root `lint`, and `fallow dead-code` all clean before and after.
Pre-completion reviewer: PASS.

### Observations

- The Red step behaved exactly as the plan predicted: two of the three new tests failed (empty list, disabled agent) and the third — the built-ins-for-an-absent-key pin — passed, as the plan called out in advance.
  Because it never had a genuine red, it was mutated explicitly before commit.
- All three killing mutations landed on the predicted equivalence classes, verified against the green file saved to `/tmp` and restored with `cp` (never `git checkout --`, which would have reverted to HEAD and discarded the uncommitted green edit):
  1. Restoring the truthiness check → only "returns an empty list for an agent that declared `tools: none`" went red.
  2. `?? []` instead of `?? [...BUILTIN_TOOL_NAMES]` → the new absent-key pin went red, along with the two pre-existing tests in the same equivalence class (`general-purpose` and the unknown type), and cases 1 and 3 stayed green as predicted.
  3. Re-adding the `enabled === false` guard → only "returns a disabled agent's own list rather than the built-ins" went red.
- The reviewer re-derived the guard-removal safety claim rather than accepting it, and confirmed it independently: `getToolNamesForType` has exactly one production call site (`session-config.ts:156`), reached only through `createSubagentSession` → `Subagent.start()` → `SubagentManager.create()`, and every front door (`spawn`, `spawnAndWait`, `service-adapter.ts`, `background-spawner.ts`, `foreground-runner.ts`) passes `resolveSpawn` first.
  `resume()` reuses the existing session and never re-assembles.
  The UI path calls `resolveAgentConfig` only.
- The reviewer also re-verified the SDK claim from the pinned `@earendil-works/pi-coding-agent@0.84.4` compiled source and traced the `BUILTIN_TOOL_NAMES` by-reference question across every reachable branch, confirming the deferred tidying is latent rather than activated by this change.
- No plan deviations, no follow-up issues filed, no lockfile changes.
  The changelog preview is one line — `fix(pi-subagents): resolve tools: none to no tools` — which names the observable outcome rather than the seam.

## Stage: Final Retrospective (2026-09-05T06:48:55Z)

### Session summary

All four stages — planning, TDD, ship, and this retrospective — ran in a single session on `anthropic/claude-opus-5`, shipping `@gotgenes/pi-subagents@21.4.2` from a one-line source change plus three registry tests.
Zero user corrections, zero failed gates, zero rework: every deterministic check passed on first run at baseline, after each commit, and pre-push, and both CI and the release run succeeded first time.
The substantive finding is epistemic rather than procedural — the roadmap step's stated cause turned out to be one instance of a shape the same method held twice.

### Observations

#### What went well

- **Reading the source before the roadmap entry is what found the second bug.**
  Phase 22 Step 13's `**Cause:**` bullet named exactly one mechanism: the `?.length` truthiness check.
  The source trace done ahead of it — following `getToolNamesForType` into `resolveAgentConfig` to see why two methods resolved the same key differently — surfaced a *second* fail-open of the same shape in the same five lines: the `enabled !== false` guard, which turned "this agent is disabled" into "give it all seven built-ins."
  Had the roadmap entry been read first, its confident single-cause framing would very likely have anchored the design on the operator flip the issue itself proposed.
  This is the inverse of a `missing-context` finding: the prompt's ordering (source exploration at Gather-context step 5, roadmap at step 8) earned its keep.
- **Spiking both candidate bodies through the full suite before the gate.**
  Both `?? [...BUILTIN_TOOL_NAMES]` variants were written into `src/config/agent-types.ts` and the full package suite run under each (3 s per run, file restored from a `/tmp` copy between).
  That turned the `ask_user` gate's substance from argument into a measured table, and it answered the issue's own stated open question — "I have not confirmed that no caller depends on the current coalescing" — before the operator had to weigh in on it.
  It also revealed the fact that shaped the plan: the disabled-agent branch had no pin either, which is why the plan added one.
- **The guard-removal review mandate paid for itself.**
  The `pre-completion` skill says to add a re-derivation mandate when a change removes or narrows a guard.
  Following it — naming the candidate inputs to enumerate, and explicitly refusing my own reachability argument — produced a reviewer report that independently traced `getToolNamesForType`'s single production call site through `Subagent.start()` to `SubagentManager.create()` and confirmed that `resume()` never re-assembles, plus the `service-adapter.ts` and UI paths.
  Cost was real (415 s, 61 tool calls, 121.5 k tokens for a one-line source change), but the mandate is what made it a verification rather than a restatement.
- **All three killing mutations landed on their predicted equivalence classes.**
  Including the second one, whose extra reds (the two pre-existing absent-path tests) were correctly predicted as same-class collateral rather than read as a surprise.

#### What caused friction (agent side)

- `other` — the roadmap `Outcome:` line asked for "a test for each of the three inputs (absent, empty, listed)," but the shipped trio is absent, empty, and **disabled**, with the listed leg left to the pre-existing "returns custom tool names for user agent" test.
  That deviation is deliberate and defensible (adding a fourth listed-case test would have duplicated an existing pin, and the disabled row is the one the guard removal actually changes), and it is recorded in the plan's Test Impact Analysis — but a reader who returns to Step 13's `Outcome:` line will not see it there.
  Impact: no rework; a documentation asymmetry only.
- No `rabbit-hole`, `premature-convergence`, `scope-drift`, or `instruction-violation` findings.
  The longest single-question tool sequence was four calls to locate `options.tools` handling in the pinned SDK's compiled bundle (`.d.ts` → `agent-session-services.d.ts` → `agent-session-services.js` → `sdk.js`), which is under the escalation threshold and ended in the citable line.

#### What caused friction (user side)

- None.
  Both `ask_user` questions were answered with the recommended option and no follow-up was needed, which suggests the substance message carried enough — the truth table and the measured suite results — for the decision to be made in one pass.

### Diagnostic details

- **Model-performance correlation** — the whole session ran on `anthropic/claude-opus-5` (confirmed from the inline transcript labels, not `PI_MODEL`).
  Two subagent dispatches, both `anthropic/claude-sonnet-5` per their agent-file frontmatter: `tidy-first-assessor` (60 s, 5 tool calls, returned no Recommended preparatory commits and correctly rejected the `BUILTIN_TOOL_NAMES` freeze as scope creep) and `pre-completion-reviewer` (415 s, 61 tool calls, PASS).
  No mismatch: both are judgment-heavy read-only tasks, and sonnet handled the reviewer's call-graph trace correctly.
- **Escalation-delay tracking** — no `rabbit-hole` findings; nothing exceeded four consecutive calls on one question.
- **Unused-tool detection** — no `Explore` dispatch was warranted; the issue supplied a numbered source trace, which `AGENTS.md` explicitly scopes to inline verification rather than a subagent hunt, and the trace confirmed cheaply.
  `colgrep` was not used; every lookup in this change was an exact symbol match (`getToolNamesForType`, `BUILTIN_TOOL_NAMES`, `toolNames`), which is the grep side of the decision table.
- **Feedback-loop gap analysis** — verification was incremental throughout: full-suite spikes twice during planning, a green baseline (`check`/`lint`/`test`/`fallow`) before the first Red, the affected file after Red and again after Green, three mutation runs before the commit, and the full four-gate sweep after each of the two implementation commits.
  No gap.

### Changes made

1. `AGENTS.md` — added a paragraph to § Reading this repo's own artifacts, beside the existing `Outcome:` rule: a roadmap step's `**Cause:**` bullet is the mechanism the discovery sweep saw, not a census of the ones present, so trace the whole function before accepting it as the scope.
2. `.pi/prompts/retro.md`, `.pi/prompts/tdd-plan.md`, `.pi/prompts/build-plan.md` — each `## Load skills` lead-in now says to skip skills already in this session's context and to re-load after a compaction.
3. `packages/pi-subagents/docs/retro/0871-resolve-tools-none-to-no-tools.md` — this Final Retrospective stage entry.

Change 2 came from an operator question prompted by this session's own behavior.
The `## Load skills` sections load unconditionally, but this session ran all four stages in one process, so `package-pi-subagents`, `code-design`, `markdown-conventions`, and `testing` were already in context when `/retro` asked for them again — and I silently skipped three of the four rather than re-reading, departing from the template's literal text with no license to.
The qualifier is keyed on *presence in context*, not on *having loaded earlier*: a compaction drops a skill's body while leaving the memory of having read it, so "already loaded" alone would license running on that memory.
Scoped by operator decision to the three templates that run warm; `plan-issue`, `pr-review`, `plan-improvements`, `finish-phase`, and `triage-backlog` normally open a session and were left alone.

One proposal was declined: adding a clause to `.pi/prompts/plan-issue.md` Gather-context step 8 telling the planner to read the roadmap entry's `Cause:`/`Target:`/`Outcome:`/`Commit type:` bullets alongside its `Release:` tag.
The evidence was thin — the bullets were harvested anyway, just incidentally.
