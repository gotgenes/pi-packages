---
issue: 465
issue_title: "新增一个类似 “pi install npm:pi-intercom”的能力"
---

# Ask-back: let a child's question reach the parent

## Release Recommendation

**Release:** ship independently

This is Phase 22 Step 8 in `docs/architecture/architecture.md`, tagged `Release: independent` — no batch.
The plan lands both a `fix:` (the observer-guard asymmetry) and a `feat:` (ask-back itself), each an unhidden release vehicle on its own.

## Problem Statement

The issue reports, in the reporter's words, that "the subagent asks a question, and then it just ends."
Two prior investigations narrowed it.
[#798] established that the round trip mostly exists: a child's result can be a question, and the parent answers by calling `subagent` again with `resume: "<agent id>"`, and it delivered the missing agent ID on the foreground path.

What remains is **recognition and affordance**.
`rg -in resume` across `background-spawner.ts`, `foreground-runner.ts`, `get-result-report.ts`, `notification.ts`, and `prompts.ts` matches nothing.
The child is never told the parent can answer it, and no delivery surface tells the parent that a given result is answerable.
The only mention anywhere is one static tool guideline — "Use resume with an agent ID to continue a previous agent's work" — which reads as *continue work*, not *answer a question*.

Planning also found the surrounding delivery path unsound in ways that block the fix:

- `SubagentManager.buildObserver()` suppresses the completion observer for foreground agents, so they emit no `subagents:completed` / `failed` / `resumed` and persist no `subagents:record`.
- The nudge's suppression for a foreground agent depends on `markConsumed()` winning a race against `agent_settled`.
- The four carriers that deliver an outcome to the parent model each format it independently, so `get_subagent_result` and the resume return report **nothing** for an `aborted`, `steered`, or `stopped` child.

## Goals

- A child can declare that it is asking its parent a question, and every carrier that delivers that outcome surfaces it as answerable with the exact `resume` call.
- Foreground children emit the same lifecycle events and persist the same session-history record as background children.
- The completion nudge's suppression is structural and race-free, and does not borrow the retention system's state to decide it.
- All four carriers agree on one status vocabulary, so pulling an aborted child's result no longer reports success-shaped output with no indication it was cut short.

Not a breaking change.
Every element is additive or a correction to a surface that previously reported nothing: new events on existing channels for agents that previously emitted none, a new optional `SubagentRecord` field (semver-minor per [ADR 0005](../decisions/0005-subagent-record-admission-policy.md) — the snapshot is produced by this package and never implemented by consumers), and status wording added where there was none.
The nudge's existing status strings change wording (see Module-Level Changes); they are model-facing announcement text, not a contract.

## Non-Goals

- **A child-initiated mid-run channel** — a child that pauses and waits for an answer without terminating.
  Filed as [#858] and adopted as Phase 22 Step 11.
  This plan's scope is a *completed* child, matching the roadmap step's stated Outcome.
- **Fixing the workspace-on-resume defect** — `completeRun()` disposes the child's workspace and `resume()` never re-prepares it, so a workspace-backed ask-back child resumes into a torn-down directory.
  Filed as [#857] and adopted as Phase 22 Step 10.
  This plan does not depend on it: ask-back works for children with no registered `WorkspaceProvider`.
- **Renaming `consumed` to `delivered`.**
  The better word for the outcome's state, but `consumedSessionRetentionMinutes` and `unconsumedSessionRetentionMinutes` are public settings keys; renaming the concept drags them along as a breaking change, for prose.
- **A result-annotation hook for downstream extensions.**
  Dropping the observer guard makes a foreground completion observable for the first time, which is the precondition a downstream ask-back extension would need.
  The hook itself has no consumer today and is declined under the no-vacant-hooks rule.
- **Unifying carrier truncation.**
  The nudge is a preview that points at `get_subagent_result` for the rest; a pull is the full text.
  Those are different jobs and a shared truncation policy would be a false abstraction.
- **Retiring `pi-intercom`-style tooling into this package.**
  The ecosystem's ask-back implementations are consumer extensions with child-only tools; that path stays open and is not taken here.

## Background

### The four carriers

A terminated child's outcome reaches the parent model through exactly one of four carriers, selected by how the parent asked.
Three are annotated in the source as delivery edges:

| How the parent asked       | Carrier          | Claims the outcome                                             |
| -------------------------- | ---------------- | -------------------------------------------------------------- |
| `subagent` foreground      | tool return      | `foreground-runner.ts:110` — "Foreground-return delivery edge" |
| `subagent` with `resume`   | tool return      | `agent-tool.ts:110` — "Resume-return delivery edge"            |
| `get_subagent_result`      | tool return      | `get-result-tool.ts:47` — "Pull-delivery edge"                 |
| background, not yet pulled | completion nudge | — (the fallback carrier)                                       |

### The residual guard

`SubagentManager.buildObserver()` wraps both `onRunFinished` and `onResumeFinished` in `if (agent.isBackground)`.
Archaeology shows this is residue rather than a decision.
`7bbd6064` records the original branch:

```typescript
if (options.isBackground) {
  this.runningBackground--;                    // concurrency accounting
  this.observer?.onAgentCompleted(record);     // events + persistence + notification
  this.drainQueue();                           // queue draining
}
```

Two of the three statements are legitimately background-only — foreground bypasses the limiter, and `create()` calls `scheduleVia` only when `isBackground`.
The observer call inherited the guard by adjacency.
`d5f116eb` (#381) then moved the counter and the drain into `ConcurrencyLimiter`, leaving the guard wrapping only the statement that never needed it.
The sibling handlers in the same method are unguarded: `onStarted` and `onCompacted` fire for foreground, so a subscriber today watches a foreground child start, watches it compact, and never sees it finish.

`onSubagentCreated`'s guard is different and stays — it is documented as firing before limiter admission, a background-only moment.

### Why the nudge is currently safe, and why that is not good enough

`sendCompletion` fires synchronously inside `completeRun()`, with `record.consumed` still false.
`parentRunActive` is true at that moment (`index.ts:75` wires `agent_start`), so the nudge is withheld into `pendingNudges`, and the `agent_settled` flush re-reads `consumed` — true by then — and drops it.

So the common path is already safe, by a race it happens to win.
The Tidy-First assessor predicted a spurious nudge "the instant this guard drops"; that overstates, and the plan records the real mechanism.
The residual edge is genuine: a parent turn interrupted mid-foreground-run may abandon the tool promise before `markConsumed()`, leaving a withheld nudge that survives the flush.

### Why `consumed` cannot also be the nudge's gate

`consumedAt` drives session retention: `consumedSessionRetentionMinutes` defaults to 10, `unconsumedSessionRetentionMinutes` to 720 (`settings.ts:61-62`).
A 72× difference.

The two facts differ by revocability:

|               | Set when                                | Revocable                                                          | Drives    |
| ------------- | --------------------------------------- | ------------------------------------------------------------------ | --------- |
| carrier claim | the parent commits to a carrier         | yes — an abandoned wait or interrupted turn returns responsibility | the nudge |
| `consumedAt`  | the outcome actually reaches the parent | no — a one-way latch                                               | retention |

`get-result-tool.ts:36-38` documents the divergence as intentional:

> A parent interrupt ends the wait without cancelling the agent, leaving the outcome uncollected below.

with `if (!record.isActive()) record.markConsumed();` deliberately declining to claim an abandoned wait.
Latching `consumedAt` at commitment would suppress that nudge, and would shrink every ask-back child's answerable window from 12 hours to 10 minutes — breaking the capability this issue asks for.

### Prompt-assembly constraint

`buildAgentPrompt` has two branches.
`"append"` emits `identity + bridge + activeAgentTag + envBlock + customSection`; `"replace"` emits `identity + activeAgentTag + envBlock + config.systemPrompt`.
The built-in `Explore` and `Plan` agents are `promptMode: "replace"`, so they never receive the `<sub_agent_context>` bridge — a protocol block placed there would miss exactly the agents most likely to need it.
`activeAgentTag` is in both branches and follows the cacheable identity prefix, so the ask-back block goes beside it.

### Constraints from AGENTS.md and the package skill

- **Narrow core, no policy** — ask-back is a property of the spawn/result channel this package owns, not a policy.
  The mechanism adds no per-agent configuration.
- **Public-type verification** — adding a `SubagentRecord` field changes the published surface.
  Run `pnpm --filter @gotgenes/pi-subagents run verify:public-types`.
  `dist/*.d.ts` is gitignored; never commit it.
- **Architecture-doc landing (#540)** — the roadmap step's ✅ mark (heading and Mermaid node) and its `Landed:` note are landed at implementation completion, not deferred.
- **Glyph vocabulary** — the affordance is plain ASCII; no `src/ui/glyphs.ts` entry is needed, and none may be spelled at a render site.

## Design Overview

### One vocabulary, two presentations

The three status vocabularies exist because two carriers need different grammar: the nudge wants a standalone label, the foreground result wants a parenthetical suffix appended to a sentence.
Collapsing them into one function would force one carrier's sentence to change shape.

The design keeps one source of truth for the *facts* and two thin presentations over it:

```typescript
/** The single terminal-status vocabulary. Presentation is layered over this. */
interface StatusMeaning {
  /** Sentence-initial label, e.g. "Wrapped up". */
  label: string;
  /** Why, without terminal punctuation, e.g. "reached turn limit". */
  detail: string;
}

/** Standalone label form: "Wrapped up (reached turn limit)". */
export function renderStatusLabel(status: SubagentStatus, error?: string): string;

/** Parenthetical suffix form: " (wrapped up — reached turn limit)"; "" when unremarkable. */
export function renderStatusNote(status: SubagentStatus): string;
```

`renderStatusNote` replaces `helpers.ts`'s `getStatusNote`; `renderStatusLabel` replaces `notification.ts`'s `getStatusLabel`.
The nudge's wording changes where the two vocabularies disagreed on detail — "Aborted (max turns exceeded)" becomes "Aborted (max turns exceeded, output may be incomplete)", matching what the foreground carrier already told the parent.

### The shared body and the affordance

```typescript
/** Only what the body formatter reads — no id, no metrics (ISP). */
export interface OutcomeBody {
  status: SubagentStatus;
  result: string | undefined;
  error: string | undefined;
  stoppedWhileQueued: boolean;
}

/** Running note, error line, never-started note, or the trimmed result. */
export function renderOutcomeBody(outcome: OutcomeBody): string;

/** The ask-back affordance; "" when there is no pending question. */
export function renderQuestionAffordance(agentId: string, question: string | undefined): string;
```

`AgentReport` in `get-result-report.ts` already structurally satisfies `OutcomeBody`, so `renderReportBody` becomes a call rather than a rewrite.
`renderQuestionAffordance` takes primitives rather than the record, so it carries no unused fields.

Consumer call site, to check the interaction pattern:

```typescript
// foreground-runner.ts
const noteText = renderSpawnNotes(params.config.notes);
return textResult(
  `${noteText}Agent completed in ${formatMs(durationMs)} (${stats})${renderStatusNote(record.status)}.\n` +
    `Agent ID: ${record.id}\n\n` +
    renderOutcomeBody(record) +
    renderQuestionAffordance(record.id, record.pendingQuestion),
  details,
);
```

Each carrier keeps its own framing (spawn notes, XML envelope, report header) and its own truncation, and asks the shared module for the body, the status wording, and the affordance.
Tell-Don't-Ask holds: no carrier branches on status itself.

### The ask-back protocol

The child is taught one marker in its assembled system prompt, beside `activeAgentTag` so both prompt modes carry it:

```text
<ask_back>
If you cannot complete this task without information only the delegating agent has, end your turn with the question inside a question-for-parent block:

<question-for-parent>
Which of the three config files should I treat as authoritative?
</question-for-parent>

The delegating agent can answer, and you will resume with your context intact.
Ask only when the answer changes what you would do; otherwise state your assumption and continue.
</ask_back>
```

At terminal state the core parses `record.result` for the marker, records the question on the record, and **strips the block from the result body** so the question is rendered once, as the affordance, rather than twice.

Parsing rules, chosen to be deterministic rather than heuristic:

- The **last** well-formed `<question-for-parent>…</question-for-parent>` block wins; a child that reasons about the protocol before using it does not defeat it.
- A block inside a fenced code region is ignored — including a four-backtick fence, per this repo's own `markdown-conventions`.
- An unclosed opening tag yields no question and leaves the result untouched.
- Empty or whitespace-only content yields no question.

The affordance rendered to the parent:

```text
This agent is waiting on an answer:

  Which of the three config files should I treat as authoritative?

Answer by calling subagent with resume: "b15f500f-314b-49b" and your answer as the prompt.
```

### The carrier claim

New state on `SubagentState`, beside `_consumedAt` under its existing "Result delivery" banner:

```typescript
/** A carrier has committed to delivering this outcome. Revocable, unlike consumption. */
claim(): void;
/** The carrier abandoned its commitment; the nudge becomes responsible again. */
release(): void;
get claimed(): boolean;
```

Every other transition on this class is monotonic (`??=`), so a revocable pair is a new mutation shape here; it is documented as such and `resetForResume()` clears it alongside `_consumedAt`.

`sendCompletion` becomes:

```typescript
if (this.disposed) return;
if (record.claimed) return;   // structural: a carrier owns this outcome
if (record.consumed) return;  // temporal: the parent already pulled it
```

Claim and release points:

| Site                              | Claims                         | Releases                                                                          |
| --------------------------------- | ------------------------------ | --------------------------------------------------------------------------------- |
| `spawnAndWait` (foreground)       | at call, before the run starts | in `runForeground`'s `finally`, if the turn was abandoned before `markConsumed()` |
| `AgentTool` resume branch         | before `manager.resume(...)`   | on the failure return paths                                                       |
| `get_subagent_result` with `wait` | before `waitUntilSettled`      | when the wait is abandoned (`record.isActive()` still true)                       |

The third row preserves `get-result-tool.ts`'s documented abandoned-wait behavior exactly, now as an explicit release rather than an emergent one.

## Module-Level Changes

### New

- `src/observation/outcome-delivery.ts` — the shared status vocabulary (`StatusMeaning` table, `renderStatusLabel`, `renderStatusNote`), `OutcomeBody` and `renderOutcomeBody`, and `renderQuestionAffordance`.
- `src/session/ask-back.ts` — the marker vocabulary, the protocol block text, `parseQuestionForParent(result): { question?: string; body: string }`.

### Changed — production

- `src/lifecycle/subagent-manager.ts` — delete `if (agent.isBackground)` from `onRunFinished` and `onResumeFinished` in `buildObserver()`. `onSubagentCreated`'s guard is untouched.
- `src/lifecycle/subagent-state.ts` — add the revocable claim beside `_consumedAt`; add `_pendingQuestion` with its accessor; clear both in `resetForResume()`.
- `src/lifecycle/subagent.ts` — expose `claim`/`release`/`claimed` and `pendingQuestion`; parse the marker in `completeRun()` before `markCompleted(finalResult)`, so the stored `result` is already stripped.
- `src/observation/notification.ts` — `sendCompletion` gains the claim gate; `formatTaskNotification` sources its status label and body from `outcome-delivery.ts` and appends the affordance; `getStatusLabel` is removed (its callers move to `renderStatusLabel`).
- `src/tools/helpers.ts` — `getStatusNote` is removed; `foreground-runner.ts` imports `renderStatusNote` instead.
- `src/tools/foreground-runner.ts` — claim/release around the run; body and affordance from the shared module.
- `src/tools/agent-tool.ts` — same for the resume branch.
- `src/tools/get-result-tool.ts` — claim before `waitUntilSettled`, release on an abandoned wait.
- `src/tools/get-result-report.ts` — `renderReportBody` delegates to `renderOutcomeBody`; the report header gains the status label; the affordance is appended.
- `src/session/prompts.ts` — extract the shared `activeAgentTag + envBlock` header used by both branches, then add the ask-back block to it.
- `src/service/service.ts` — `SubagentRecord` gains `pendingQuestion?: string`.

### Changed — tests

`test/lifecycle/subagent-manager.test.ts` (the two guard assertions at ~L743 and ~L1244 flip), `test/lifecycle/subagent-state.test.ts`, `test/lifecycle/subagent.test.ts`, `test/observation/notification.test.ts` (exact status-string assertions at L38 and L42 change wording), `test/tools/helpers.test.ts` (the `getStatusNote` describe block at L231 moves), `test/tools/foreground-runner.test.ts`, `test/tools/agent-tool.test.ts`, `test/tools/get-result-tool.test.ts`, `test/tools/get-result-report.test.ts`, `test/session/prompts.test.ts`, `test/service/service-adapter.test.ts`, `test/composition-root.test.ts`.

### Changed — docs

Verified by grepping every removed symbol (`getStatusNote`, `getStatusLabel`) and every reworded mechanism across `src/`, `test/`, `.pi/skills/`, and `packages/pi-subagents/docs/`:

- `docs/architecture/architecture.md` — module-tree entries at L347 (`prompts.ts`), L363 (`subagent-state.ts`), L375 (`notification.ts`), L391 (`get-result-report.ts`); the new `outcome-delivery.ts` and `ask-back.ts` entries; the Observation/Session domain counts; and Step 8's ✅ mark, Mermaid node, and `Landed:` note.
- `.pi/skills/package-pi-subagents/SKILL.md` — the Observation row's notification description states "consumption is domain state on the record" as the nudge's gate; it becomes the claim.
  The domain file counts change (63 files → 65).
- `packages/pi-subagents/README.md` — the event table already describes the post-fix behavior without a background qualifier, so it needs no edit; the plan verifies rather than assumes this.
  The `subagents:created` row's "Background agent registered" stays accurate.
- No `docs/configuration.md` change: ask-back adds no configuration key.

Historical plans and retros under `docs/plans/` and `docs/retro/` also name `getStatusNote` and `getStatusLabel`; those are records of past decisions and are deliberately not rewritten.

## Test Impact Analysis

**New tests the change enables.**
`outcome-delivery.ts` and `ask-back.ts` are pure modules, so the status vocabulary, the body selection, the affordance, and the parser all become directly unit-testable — today each is reachable only through a carrier.

**Existing tests that become redundant.**
`helpers.test.ts`'s `getStatusNote` describe block and `notification.test.ts`'s `getStatusLabel` block test the same vocabulary twice from two callers; they collapse into one table-driven suite over the shared module.
The carrier tests keep only their framing assertions.

**Existing tests that must stay.**
`notification.test.ts`'s withhold-and-flush tests (#661) genuinely exercise the timing layer the claim does not replace — the claim gates *whether* a nudge is owed, not *when* it is delivered.
`subagent-manager.test.ts`'s concurrency tests pin the limiter routing that the `isBackground` guard's siblings still govern.

**Parser input domain.**
The parser is tested over the domain rather than the inputs I can picture: no marker; one well-formed block; a block preceded by prose; two blocks (last wins); a block inside a three-backtick fence and inside a four-backtick fence (both ignored, per this repo's own `markdown-conventions`); an unclosed opening tag; an empty block; a whitespace-only block; CRLF line endings; and a block whose content itself contains angle brackets.

## Invariants at risk

This change touches surfaces three earlier Phase 22 steps refactored.

- **Step 7 (#798) — the spawn-notes prefix must lead the foreground result, ahead of the `Agent ID` line.**
  Pinned by the ordering assertion Step 7 added to `test/tools/foreground-runner.test.ts` (its retro records that the original test asserted containment only and was order-blind).
  This plan appends the affordance *after* the body, so the prefix ordering is untouched — but the assertion must still be green after the body is sourced from the shared renderer.
- **Step 7 — the `foreground-runner.ts` grep row (`grep -c 'Agent ID'`) must stay ≥ 1.**
  Measured now at the current commit: **2** (the success and error branches each carry the literal).
  This plan touches neither literal, so the predicted post-change value is **2**.
- **Step 5 (#801) — an assembled child prompt contains exactly one `available_skills` block, and `prompts.ts` carries 3 `available_skills` occurrences.**
  The ask-back block is inserted after `activeAgentTag`, well past the identity cut, so it cannot reintroduce a second catalogue.
  Measured now: `grep -c 'available_skills' src/session/prompts.ts` = **3**; predicted after: **3**.
  Pinned by `test/session/prompts.test.ts`'s single-catalogue regression test.
- **ADR 0006 / #640, #801 — the inherited identity prefix must remain a byte-identical prefix of the parent prompt, for KV cache reuse.**
  The ask-back block follows `activeAgentTag`, which already sits after the cacheable prefix, so the shared prefix is unchanged.
  `prompts.test.ts` pins this with `prompt.startsWith(\`${quoted}\n\n\`)` anchored on the identity region; the Tidy-First assessor confirmed no assertion does full-prompt equality, so no mass breakage is expected.
- **#661 — a nudge is withheld while the parent's agent run is active and flushed on `agent_settled`, re-checking consumption.**
  The claim gate is added *ahead* of this machinery, not in place of it.
  Pinned by the existing `notification.test.ts` withhold/flush tests, which must stay green unchanged.
- **#617 — session retention is timed from consumption.**
  `consumedAt` is not moved, retyped, or re-timed by this plan; the claim is separate state.
  Pinned by the existing retention-sweep tests.

## TDD Order

1. **`refactor(pi-subagents): extract the shared prompt header in buildAgentPrompt`** Tidy-First preparation for step 8.
   `buildAgentPrompt` composes `activeAgentTag + envBlock` independently at the tail of both branches, so the ask-back block would otherwise be inserted identically in two places with no shared anchor — which is how the branches drift.
   Extract one header used by both `return` statements.
   Test surface: `test/session/prompts.test.ts` unchanged and green (its assertions are `toContain`/`startsWith`, never full-body equality).
   Killing mutation: make the extracted header omit `envBlock` — the existing environment-block assertions for both prompt modes must go red.

2. **`refactor(pi-subagents): add a revocable carrier claim to the subagent record`** Claim state on `SubagentState` and `Subagent`, cleared by `resetForResume()`.
   Nothing reads it yet, so no observable behavior changes.
   Test surface: new `describe("SubagentState — carrier claim")` sibling in `test/lifecycle/subagent-state.test.ts`, matching the file's established flat-by-feature convention.
   Covers: claim sets, release clears, release without claim is a no-op, claim is idempotent, `resetForResume` clears it.
   Killing mutation: make `release()` a no-op — the release and `resetForResume` tests go red while the claim tests stay green.

3. **`refactor(pi-subagents): claim the outcome at each carrier's commitment point`** Claim in `spawnAndWait`, the `AgentTool` resume branch, and `get_subagent_result`'s wait path; release on each abandonment path.
   Still unread by the notification layer, so still no observable change.
   Test surface: `test/tools/foreground-runner.test.ts`, `agent-tool.test.ts`, `get-result-tool.test.ts`.
   Covers: each carrier claims before running; an abandoned wait releases; a completed pull does not release.
   Killing mutation: delete the release in `get-result-tool.ts`'s abandoned-wait path — the abandoned-wait test goes red, and the completed-pull test stays green.

4. **`fix(pi-subagents): report foreground subagent completions to lifecycle observers`** Delete both `isBackground` guards in `buildObserver()`, and switch `sendCompletion`'s structural gate from consumption to the claim.
   These land together: the guard is what currently keeps a foreground completion out of the notification layer, so removing it alone would rest the suppression on the `markConsumed`/`agent_settled` race, which the interrupt edge loses.
   Observable: foreground children emit `subagents:completed` / `failed` / `resumed` and persist a `subagents:record`; no foreground agent produces a nudge, including on an interrupted turn.
   Test surface: `test/lifecycle/subagent-manager.test.ts` (the two guard assertions flip from `.not.toHaveBeenCalled()` to asserting the callback fires), `test/observation/notification.test.ts`.
   Covers: a foreground completion emits and persists; a foreground completion sends no nudge; an *interrupted* foreground run sends no nudge (the edge the old race lost); the #661 withhold/flush tests stay green untouched.
   Killing mutations, one per equivalence class:
   - Restore `if (agent.isBackground)` on `onRunFinished` — kills the foreground-emits tests; leaves the nudge-suppression tests green.
   - Restore it on `onResumeFinished` only — kills the foreground-resume-emits test alone.
   - Delete the claim gate from `sendCompletion` — kills the interrupted-turn nudge test; the non-interrupted foreground test may stay green on the surviving race, which is exactly the discrimination this step needs and why the interrupted case is a separate test.

5. **`refactor(pi-subagents): extract a shared outcome-body renderer`** Mechanism half.
   Introduce `outcome-delivery.ts` with `OutcomeBody` / `renderOutcomeBody`, and route `get-result-report.ts`'s `renderReportBody` through it.
   Value-preserving: no carrier's output changes.
   Test surface: new `test/observation/outcome-delivery.test.ts`; `test/tools/get-result-report.test.ts` unchanged and green.
   Killing mutation: make `renderOutcomeBody` return the raw result for a `running` agent — the running-note test goes red while the completed-result test stays green.

6. **`fix(pi-subagents): report terminal status consistently across every result carrier`** Data half, sequenced separately per the mechanism/data rule: the status vocabulary is a table of wording, and its failure modes are per-row.
   Add the `StatusMeaning` table plus `renderStatusLabel` / `renderStatusNote`; delete `getStatusNote` and `getStatusLabel`; route all four carriers through the shared pair.
   Observable: `get_subagent_result` and the resume return report `aborted` / `steered` / `stopped` where they previously reported nothing; the nudge's `aborted` and `steered` wording gains the detail the foreground carrier already used.
   Write the single-row assertion before the table.
   Test surface: table-driven suite in `test/observation/outcome-delivery.test.ts`; the `getStatusNote` block in `helpers.test.ts` and the `getStatusLabel` block in `notification.test.ts` collapse into it; `notification.test.ts`'s exact strings at L38 and L42 update.
   Covers: every terminal status in both presentations; `completed` produces an empty note; a pull on an aborted child names the abort.
   Killing mutations: make `renderStatusNote` return `""` for `aborted` (kills the aborted-note row and the aborted-pull test, leaves `steered`/`stopped` green); swap the `steered` and `stopped` rows (kills exactly those two rows).

7. **`refactor(pi-subagents): add the ask-back marker parser`** `src/session/ask-back.ts` — the marker vocabulary, the protocol block text, and `parseQuestionForParent`.
   Not yet wired to anything.
   Test surface: new `test/session/ask-back.test.ts`, over the input domain enumerated in Test Impact Analysis.
   Killing mutations: make the parser take the **first** block rather than the last (kills the two-block test, leaves the single-block tests green); remove the fenced-region guard (kills both fence tests, including the four-backtick case, and leaves the rest green).

8. **`feat(pi-subagents): let a subagent ask its parent a question it can answer`** Wire it: the protocol block into the shared prompt header from step 1; parsing in `completeRun()` with the block stripped from the stored result; `pendingQuestion` on `SubagentState`, `Subagent`, and the public `SubagentRecord`; `renderQuestionAffordance` appended by all four carriers.
   Then land the architecture-doc Step 8 ✅ mark, Mermaid node, and `Landed:` note, the module-tree and domain-count entries, and the SKILL.md updates.
   Test surface: `test/session/prompts.test.ts` (both prompt modes carry the block), `test/lifecycle/subagent.test.ts` (the question is recorded and stripped), all four carrier tests (the affordance appears with the right agent ID), `test/service/service-adapter.test.ts` (the field reaches the public snapshot), and an end-to-end round-trip test: a child terminates with a question, the parent reads an answerable result, resumes with an answer, and the child continues with its context intact.
   Run `pnpm --filter @gotgenes/pi-subagents run verify:public-types` after this step.
   Killing mutations: make `completeRun` skip the parse (kills the recorded-and-stripped test and every affordance test, leaves the parser unit tests green); make `renderQuestionAffordance` omit the agent ID (kills the affordance tests without touching the body tests); remove the ask-back block from the `"replace"` branch of the prompt header (kills the `Explore`/`Plan`-mode prompt test while the `"append"`-mode test stays green — the asymmetry that motivated step 1).

## Risks and Mitigations

| Risk                                                                                                | Mitigation                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A child ignores the protocol and asks in prose.                                                     | Accepted. The affordance is absent, which is exactly today's behavior — the change is strictly additive. The prompt block asks for the marker; it does not depend on compliance for correctness.                 |
| The marker leaks into user-visible output when a child echoes the protocol while explaining itself. | The parser ignores fenced regions and takes the last well-formed block, and the block is stripped from the stored result. Both are pinned by parser tests over the enumerated input domain.                      |
| Prompt bloat in every child session.                                                                | The block is a fixed ~80 tokens placed after the cacheable prefix, so it does not disturb KV-cache reuse. The #801 and #640 prefix invariants are listed under Invariants at risk with their measured baselines. |
| Dropping the guard floods a subscriber that aggregates `subagents:completed`.                       | Classified `fix:` by operator decision — a subscriber newly sees agents it should always have seen; nothing is removed or retyped. Called out in the step 4 commit body.                                         |
| The revocable claim is a new mutation shape on a class where every transition is monotonic.         | Documented at the declaration; `resetForResume()` coverage is an explicit acceptance criterion of step 2, flagged by the Tidy-First assessor as the easy miss.                                                   |
| Step 6 changes model-facing notification wording.                                                   | The strings are announcement text, not a contract. The two exact assertions that pin them are named in Module-Level Changes so the change is deliberate rather than discovered.                                  |
| An ask-back child's answerable window expires before the parent replies.                            | Out of scope here and recorded: [#857] (workspace disposal) and [#858] (mid-run channel) are the two paths that address it, both adopted as Phase 22 steps.                                                      |

## Open Questions

- Whether the ask-back protocol block should be suppressible per agent type.
  Deferred until someone asks: a read-only scout that cannot act on an answer still loses nothing by being able to ask, and a per-agent toggle would be the policy this package's core declines to own.
- Whether `renderQuestionAffordance` should name `get_subagent_result` as an alternative for a background child whose nudge carried the question.
  Deferred to implementation, where the nudge's rendered output is visible; the affordance's `resume` call is correct on every carrier either way.

[#798]: https://github.com/gotgenes/pi-packages/issues/798
[#857]: https://github.com/gotgenes/pi-packages/issues/857
[#858]: https://github.com/gotgenes/pi-packages/issues/858
