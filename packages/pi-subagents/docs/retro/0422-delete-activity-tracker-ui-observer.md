---
issue: 422
issue_title: "pi-subagents: delete AgentActivityTracker and ui-observer, drop the activity map from the core"
---

# Retro: #422 — Delete AgentActivityTracker and ui-observer, drop the activity map from the core

## Stage: Planning (2026-06-17T00:00:00Z)

### Session summary

Planned Phase 18 Step 3 of the activity-tier disentanglement spine: deleting `AgentActivityTracker` and `ui-observer`, and removing `SubagentRuntime.agentActivity` plus the tracker wiring in the two spawn tools.
Verified the prerequisites (#420, #421) are both closed and that the trackers/map are now write-only dead state after the reader migration.
Wrote a four-step plan (two `refactor:` deletion commits, a module-delete commit, a `docs:` sweep) at `packages/pi-subagents/docs/plans/0422-delete-activity-tracker-ui-observer.md`.

### Observations

- The change is **non-breaking** and internal-only: `AgentActivityTracker`, `ui-observer`, and `agentActivity` are absent from the public service surface (`service.ts`) and settings entry, so no `BREAKING CHANGE` footer.
  Issue author is the operator (`gotgenes`) and the proposed change is unambiguous and roadmap-driven, so the `ask-user` gate was skipped.
- The foreground `observer.onSessionCreated` callback **stays** — it is still the only place `recordRef`/`fgId` bind mid-flight and where `widget.ensureTimer()` fires; only the tracker lines are stripped.
  The background `observer` block, by contrast, did only tracker work and is removed entirely.
- Commit ordering matters: Step 1 (spawners stop passing `agentActivity`) must precede Step 2 (remove the runtime field), or the build breaks.
  Both the param removal and the field/`AgentActivityAccess` removal cascade to call sites and tests at the type level, so each is folded into a single commit.
- Re-render cadence: dropping `subscribeUIObserver` removes event-driven foreground re-renders, leaving the existing 80 ms spinner poll.
  Content is identical within ≤80 ms (the poll reads the same record the core observer populates) — pinned by the streaming-`onUpdate` test, noted as a risk not a regression.
- Found a **pre-existing stale doc** from #421: `architecture.md` still says "the widget reads agent state by polling a shared `Map<string, AgentActivityTracker>`", though #421 already moved the widget onto records.
  Folded that correction into this plan's Step 4 doc sweep alongside the file tree, two Mermaid diagrams, and the SKILL.md domain counts (UI `12 → 10`, header `59 → 57` files).
- Confirmed no orphaned sibling exports: `SessionLike` (used by `subagent-session.ts`) and `SubscribableSession` (used by `record-observer.ts`, `subagent-session.ts`, `types.ts`) both survive the module deletion; `pnpm fallow dead-code` is the Step 3 backstop.

## Stage: Implementation — TDD (2026-06-17T20:40:00Z)

### Session summary

Executed all four planned steps as a deletion refactor: stripped tracker wiring + the `agentActivity` parameter from the spawners, removed the activity map from `SubagentRuntime`/`AgentToolRuntime`, deleted `agent-activity-tracker.ts` and `ui-observer.ts` (−145 LOC) plus their suites, and swept the architecture doc + SKILL.md.
Landed in six commits (four planned + one folded test removal + one `style:` lint fixup).
Test count dropped −34 (1066 → 1032) across 63 files (was 65); `check`, root `lint`, full `test`, and `fallow dead-code` all green.

### Observations

- **Deviation (test removal moved earlier):** the agent-tool "registers activity in agentActivity map" test was planned for Step 2 but had to be removed in Step 1 — once the spawner stops populating the map, the test fails at runtime in that commit.
  Folded into Step 1 per the testing skill's "account for tests that break" rule.
- **Deviation (atomic-batch trap):** the Step 2 multi-edit `Edit` on `runtime.ts` was rejected because edit[1] miscounted a decorative `─` rule, which silently dropped edit[0] (the `AgentActivityTracker` import removal).
  `tsc` passed at Step 2 because the leftover was an elided `import type`; it only surfaced as a tsc/fallow error once Step 3 deleted the module.
  Removed it in Step 3 and re-read the region after editing.
  This is exactly the AGENTS.md warning about anchoring on decorative rules.
- **Lint fixup:** an unused `runtime` destructure remained in one `background-spawner.test.ts` case.
  It belongs to Step 1's file but HEAD was the `docs:` commit (a fixup must not land in a `docs:` commit, and amending a non-HEAD `refactor:` commit needs a rebase), so it landed as a standalone `style:` commit.
- **No behavior regression:** foreground re-renders now rely solely on the 80 ms spinner poll (the second `subscribeUIObserver` subscription is gone); pinned by the surviving "calls onUpdate with streaming details while running" test.
- **Doc correction:** fixed the pre-existing stale `architecture.md` prose that still claimed the widget polls a `Map<string, AgentActivityTracker>` (the widget moved onto records in #421); now reads "polls the records exposed via `SubagentManager.listAgents()`".
- **Pre-completion reviewer: PASS** — all deterministic checks, code-design, test-artifact, Mermaid (`mmdc` parsed all 6 blocks), dead-code, and cross-step-invariant lenses passed; no warnings.

## Stage: Final Retrospective (2026-06-18T01:19:58Z)

### Session summary

Shipped Phase 18 Step 3 across plan → TDD → ship in three sessions: deleted `AgentActivityTracker` and `ui-observer`, removed the `agentActivity` map from `SubagentRuntime` and both spawn tools (−145 LOC, −34 tests), and swept the architecture doc + SKILL.md.
Six implementation commits, pre-completion reviewer PASS, CI green, issue closed; no release (all `refactor:`/`style:`/`docs:`).
Clean hands-off execution — the only user input was one `ask_user` answer ("Release now") and no corrections.

### Observations

#### What went well

- Incremental verification cadence was exemplary: `pnpm run check` ran after every shared-type change (after Step 1, Step 2, and twice in Step 3), not just at end-of-cycle — exactly the feedback-loop discipline the TDD prompt asks for.
  This caught the Step 2/3 type fallout immediately rather than as a late surprise.
- The atomic-batch trap (below) was self-identified and the recovery was clean and well-documented — the Step 3 commit body explains why the `runtime.ts` import removal landed there instead of Step 2.

#### What caused friction (agent side)

- `instruction-violation` (self-identified) — the Step 2 multi-edit `Edit` on `runtime.ts` anchored `edits[1]` on a decorative `─` rule and miscounted it, rejecting the whole atomic batch and silently dropping `edits[0]` (the `AgentActivityTracker` import removal).
  This is the exact anti-pattern AGENTS.md § "Edit tool batches" warns against ("anchor on adjacent unique code lines rather than the rule itself").
  The follow-up rule ("after a rejection, re-apply every intended edit and run `pnpm run check`") was also only half-followed: the field edit was re-applied but the import edit was not, and the `check` at Step 2 passed anyway because `tsc` elides an unused `import type`.
  Impact: the dropped import surfaced only at Step 3 (once the module was deleted) as a tsc/fallow error, costing one investigation cycle and smearing the import removal into the Step 3 commit instead of Step 2.
- `other` (self-identified) — dropping the `runtime.agentActivity` argument from the `background-spawner.test.ts` calls left one test still destructuring an unused `runtime`.
  Biome's `noUnusedVariables` is warning-level (exit 0), so it did not fail `lint`; it was caught by comparing the warning count to the green baseline at end-of-cycle.
  Impact: one extra `style:` commit (could not amend — HEAD was a `docs:` commit).

#### What caused friction (user side)

- None blocking — execution was hands-off.
  Opportunity, not criticism: the ship stage ran on `opencode-go/deepseek-v4-flash`, a weak model, and that stage carries a real judgment call (is a missing release-please PR expected, or a problem?).
  It was answered correctly here, but the release-decision judgment on a weak model is a latent risk worth an operator's awareness.

### Diagnostic details

- **Model-performance correlation** — Planning and TDD ran on `anthropic/claude-opus-4-8` (appropriate: design + commit-sequencing judgment, deviation recovery).
  The pre-completion reviewer subagent ran to completion (245 s, 26 tool uses) and returned a thorough PASS.
  Ship ran on `opencode-go/deepseek-v4-flash` — fine for the mechanical push/CI/close flow, but it also made the "no release expected" inference; correct here, latent risk in general (see user-side note).
- **Escalation-delay tracking** — No `rabbit-hole`s.
  Both deviations resolved within 1–2 tool calls; no sequence exceeded 5 calls on one error.
- **Unused-tool detection** — No `missing-context` gaps.
  `grep` (not `colgrep`) was used throughout planning, correctly — every search was an exact symbol match (`agentActivity`, `AgentActivityTracker`, `subscribeUIObserver`), which is grep's lane per the colgrep decision table.
- **Feedback-loop gap analysis** — No gap; verification was incremental, not end-only (see "What went well").
  The one escape (`import type` removal) is a tsc-tolerance gap, not a cadence gap — `check` ran on schedule but cannot flag an unused type import.

### Changes made

1. `AGENTS.md` § "Edit tool batches" — augmented the post-rejection rule with a caveat: `tsc` passes on a dropped `import type` removal (an unused type import is not an error), so re-read the affected region rather than trusting `pnpm run check` alone.
