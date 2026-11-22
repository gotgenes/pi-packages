---
issue: 445
issue_title: "pi-subagents: implement native session navigation for any subagent (live or completed)"
---

# Retro: #445 — pi-subagents: implement native session navigation for any subagent (live or completed)

## Stage: Planning (2026-06-22T00:00:00Z)

### Session summary

Produced `docs/plans/0445-native-session-navigation.md`, a sliced plan for Phase 19 Step 4.
The operator (issue author) chose Pi's per-entry TUI-component renderer as the eventual target but explicitly invited a Kent Beck "make the change easy, then make the easy change" breakdown into incremental, releasable additions, and chose `manager.listAgents()`-only as the candidate set.
The plan scopes #445 to the first releasable vertical slice — full list → pick → read-only live transcript using `serializeConversation` text rendering behind a renderer-agnostic `TranscriptSource` seam — and names two follow-ups (TUI-component renderer; evicted-agent file source).

### Observations

- **Two `ask_user` rounds drove scope.**
  Round 1: renderer choice (text vs TUI components) and candidate-set scope.
  Round 2: decomposition strategy.
  The operator's note on round 1 ("If this sounds large, it's probably because it is... what would Kent Beck do") reframed the whole plan from one big issue into a sliced first release.
- **Key architectural finding — the file-snapshot branch is unreachable in #445.**
  `SubagentManager.removeRecord` calls `record.disposeSession()` then `agents.delete(id)` atomically, and `disposeSession()` does not null `subagentSession`.
  So no record in `listAgents()` is ever session-disposed; with the `listAgents()`-only candidate set, every listed session-ready record has a live session, and the dual-source "evicted/untracked → file" branch has no caller.
  Implementing it now would be dead code that fails the `fallow dead-code` gate.
  This sharpened the slice: #445 ships the **live source only** behind the seam.
- **Type-boundary plan.**
  `AgentMessage` is not in the `@earendil-works/pi-coding-agent` barrel and `@earendil-works/pi-agent-core` is not a dependency, so the plan derives `SessionMessage = SessionContext["messages"][number]` from the barrel-exported `SessionContext` rather than adding a dep.
  `serializeConversation` takes a mutable `Message[]`, so the renderer spreads (`serializeConversation([...messages])`); `AgentMessage`→`Message` assignability is flagged as a TDD step-2 `pnpm run check` verification with a typed-adapter fallback.
- **Seam justifies its weight via testability, not just the follow-up.**
  `TranscriptSource` + narrow `NavigableSubagent` interfaces let the pure module be unit-tested with light stubs (no full `Subagent`/`TUI`/`AgentSession`), and decouple the renderer (text→components) from sourcing (live→file) for the two named follow-ups.
- **Doomed-code avoidance.**
  The navigator must not import `message-formatters.ts` or `conversation-viewer.ts` (both deleted in Step 5, [#442]); the streaming indicator is a small local helper and the transcript text is Pi's `serializeConversation`.
- **Open item for ship time:** the architecture roadmap's Step 4 description currently scopes full dual-source + components as one step and will need rescoping to match the slice, plus filing the two follow-up issues.
  Command name `subagent-sessions` is proposed but flagged confirmable.
- Release: ship independently (roadmap Step 4 is `Release: independent`, spike-gated; not part of the "dissolve-agents" batch).

## Stage: Implementation — TDD (2026-06-22T18:03:26Z)

### Session summary

Implemented the sliced #445 in three TDD cycles: (1) the typed `agentMessages` accessor (`SessionMessage` on `SubagentSession`/`Subagent`); (2) the pure `session-navigation.ts` (selection, `liveSource`, `renderTranscriptLines`); (3) the `session-navigator.ts` overlay + `/subagent-sessions` command + `index.ts` wiring.
Test count went 1064 → 1084 (+20).
Pre-completion reviewer returned PASS.

### Observations

- **`AgentMessage` is NOT assignable to `serializeConversation`'s `Message[]`** (the plan's flagged risk materialized): `AgentMessage` is a superset adding session-display variants like `BashExecutionMessage`.
  Applied the planned mitigation — a private `toMessages` adapter casting via `as unknown as Parameters<typeof serializeConversation>[0]` (`Message` is not re-exported from the `@earendil-works/pi-ai` barrel, so the type is referenced through the function signature rather than imported by name).
- **`SessionContext` name collision:** `types.ts` already declares a local `SessionContext` interface, so the SDK import is aliased — `import type { SessionContext as SdkSessionContext }` — and `SessionMessage = SdkSessionContext["messages"][number]`.
- **`describeActivity` survives in `display.ts`** (not the doomed `message-formatters.ts`), so the streaming indicator reuses it — the navigator imports neither doomed module, as planned.
- **File-snapshot branch confirmed unreachable and omitted:** with the `listAgents()`-only candidate set, no listed record is ever session-disposed (dispose-and-delete are atomic), so the live source is always valid; implementing the file branch would have been dead code.
  `fallow dead-code` is clean.
- **Minor deviation:** `test/helpers/mock-session.ts` gained an `agentMessages` getter on the session stub (needed for the `Subagent.agentMessages` delegation test) — a small fixture addition not itemized in the plan's Module-Level Changes.
- **Two lint nits caught by the pre-commit hook** (both per the testing skill): an unnecessary optional chain on a destructured array element, and an unnecessary `!` on `mock.calls[0][0]` — both fixed inline.
- **Architecture doc:** added a "Landed ([#445], sliced)" note to Step 4; did **not** mark the step `✅` because the component renderer and evicted-agent file source are deferred follow-ups.
  `SKILL.md` `ui/` module count (10 → 12) left for a later Phase 19 doc-sync, per the plan.
- **Reviewer verdict: PASS.**
  Two WARN notes, both intentional and plan-sanctioned: Step 4 heading unchecked (correct for a partial slice) and the deferred `SKILL.md` count.
- **Open at ship time:** confirm command name `subagent-sessions`; file the two follow-up issues (component renderer; evicted-agent file source).

## Stage: User Note (2026-06-22T18:26:37Z)

When new issues are identified during planning, file them before leaving the planning stage rather than deferring to ship time.
Two motivations: the planning session uses a very capable model, and it already has all the context needed to write the issues well.
Applied here: the two follow-up issues (#462 renderer upgrade, #463 file-snapshot source) were identified during planning but filed only at ship time — they should have been created at the end of the planning commit instead.

## Stage: Final Retrospective (2026-06-22T18:28:31Z)

### Session summary

One continuous session carried #445 from planning through TDD, ship, and a mid-session retro note.
It delivered the sliced Phase 19 Step 4 — the `/subagent-sessions` command, the live `TranscriptSource`, and the typed `agentMessages` accessor — across three `feat:` commits plus docs, released as `pi-subagents` v17.3.0, with two follow-ups (#462, #463) filed at ship.
Execution was notably clean: the plan anticipated both hard risks, and every implementation slip was absorbed by the feedback loops within its active TDD cycle.

### Observations

#### What went well

1. **The plan pre-empted the two hardest risks.**
   `AgentMessage`→`Message` non-assignability and the unreachable file-snapshot branch were both called out in planning and both materialized exactly as predicted; the planned mitigations (the `toMessages` adapter; shipping the live source only) applied with zero rework.
2. **The `TranscriptSource` seam earned its keep.**
   The pure `session-navigation.ts` was unit-tested with light stubs (no full `Subagent`/`TUI`/`AgentSession`), and the seam cleanly hosts both deferred follow-ups — testability justified it independent of the follow-ups.
3. **Tight, incremental feedback loops.**
   Per-cycle affected-file test runs, `pnpm run check` after every type-touching step, and full suite + lint + `fallow dead-code` after the last step caught every slip within seconds.
4. **Two `ask_user` rounds during planning converted a large issue into a releasable slice** (the operator's Kent Beck nudge) — the central design win of the issue.

#### What caused friction (agent side)

1. `missing-context` — wrote test assertions before checking helper behavior: `formatMs` yields `3.0s` not `3s`, `getDisplayName` falls back to `Agent`, `TOOL_DISPLAY` keys are lowercase, and `AgentTypeRegistry` takes `() => new Map()` not `() => []`.
   Impact: ~4 assertion fixes within one Green iteration; no rework beyond the cycle.
2. `missing-context` — `SessionContext` name collision: imported the SDK type into `types.ts` without noticing a local `SessionContext` interface already existed.
   Impact: one aliasing edit (`SdkSessionContext`), caught immediately by biome `noRedeclare`.
3. `other` (mechanical) — a stray `}` when wrapping a new `describe` block (AGENTS.md already warns about brace-pair edits), and `SessionMessage` imported from the wrong module in the navigator test.
   Impact: one fix each, caught by autoformat and `tsc`.
4. `instruction-violation` (self-identified, hook-caught) — two lint nits the `testing` skill already documents: an unnecessary optional chain and an unnecessary `!` on `mock.calls[0][0]`.
   Impact: two inline fixes; no rework.

None of the agent-side slips caused rework beyond their active TDD cycle — the autoformat/biome/`tsc`/vitest/pre-commit loops absorbed all of them.

#### What caused friction (user side)

1. The dominant cross-session finding (recorded separately as the User Note stage): follow-up issues identified during planning (#462, #463) were filed only at ship time.
   The workflow itself encodes the deferral — the plan said "file at ship time" and `/ship-issue` step 4c creates them.
   The operator wants them filed during planning, while the capable planning model still holds full context.
   Opportunity: move follow-up creation into `/plan-issue`.

### Diagnostic details

- **Model-performance correlation** — the only subagent dispatch was the `pre-completion-reviewer` on `anthropic/claude-sonnet-4-6`, a judgment-heavy review task; appropriate match.
  Planning ran on a capable model, which the operator explicitly values.
  No mismatch.
- **Escalation-delay tracking** — no rabbit-holes; the longest same-area sequence was 4 assertion fixes inside one Green iteration (under the 5-call flag).
- **Unused-tool detection** — the `missing-context` slips were caught trivially by running tests; reading `display.ts` helpers first would have pre-empted them, but the cost was negligible and no Explore/`colgrep` dispatch was warranted.
- **Feedback-loop gap analysis** — verification ran incrementally and completely (per-cycle tests, `check` after type changes, full gate after the last step); no gap.
  This is a win, not a gap.

### Changes made

Moved follow-up issue creation from ship time to planning time, with the backstop relocated to pre-completion (operator-directed):

1. `.pi/prompts/plan-issue.md` — added a `## File follow-up issues` section before `## Commit`: file plan-named follow-ups during planning with `gh issue create` and record each number in the plan; nothing speculative.
2. `.pi/agents/pre-completion-reviewer.md` — added checklist section `2i. Planned follow-up issues` and its report stanza: WARN when the plan names a follow-up but records no issue number; also added the case to the severity model's WARN list.
3. `.pi/prompts/ship-issue.md` — removed step `4c. Create planned follow-up issues` (follow-ups are now filed during planning; the close comment in step 5 references the recorded numbers).
4. `AGENTS.md` — extended the pre-completion-reviewer coverage enumeration to include planned follow-up filing.
