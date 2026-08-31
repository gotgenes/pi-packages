---
issue: 798
issue_title: "pi-subagents: foreground subagent results omit the agent ID that resume requires"
---

# Deliver the resume handle in foreground and resumed subagent results

## Release Recommendation

**Release:** ship independently

This is Phase 22 Step 7, tagged `Release: independent` in the roadmap's step entry and listed among the independently releasable steps in `Release batches`.
It is a `fix:` commit and an unhidden release vehicle on its own; nothing batches with it.

## Problem Statement

The `subagent` tool's two spawn doors deliver their results asymmetrically.
The background door puts the agent's ID in the model-visible result text (`Agent ID: <id>`); the foreground door puts it only in the renderer `details` object, which reaches the TUI and never the model.
So a foreground child that ends its run by asking a question cannot be answered: the parent has no handle to pass to the tool's own `resume` parameter.

The round trip itself works — `resume` was verified end to end, and the child picked up with prior context intact.
The only missing piece is delivery of the handle.
The resume-return edge in `AgentTool.execute` has the same shape: it returns the resumed child's bare result text with no handle, so a second round of the same exchange has nothing to resume from either.

## Goals

- A foreground `subagent` result names the agent's ID in text the model reads, spelled the same way the background door spells it.
- The foreground error edge (`Agent failed: …`) names it too — the record and (usually) its session outlive the failure, so its transcript and resume are both still reachable.
- The resume-return edge names it, so a multi-turn exchange survives past round one.
- Not breaking: this adds a line to a tool result's text.
  No default, config value, type, or output shape changes, and no user edit is required on upgrade.

## Non-Goals

- **The ask-back capability itself** ([#465], Phase 22 Step 8).
  This step makes a foreground child's question *answerable*; recognizing that a result *is* a question, and nudging the parent about it, is Step 8's mechanism and its own plan.
- **A shared `renderAgentIdLine()` helper in `tools/helpers.ts`.**
  Considered and declined at the design gate: the literal is one line rendered into three different surrounding contexts, and the published metric row greps the spelling in `foreground-runner.ts` specifically.
  The tidy-first assessor did not re-propose it.
- **A restated resume hint in the result text** — a trailing parenthetical telling the parent to pass the ID as `resume`.
  Declined at the design gate in favor of byte symmetry with the background door; the tool's own `Guidelines:` block already carries "Use resume with an agent ID to continue a previous agent's work."
- **The `spawnAndWait`-threw edge** in `runForeground`.
  No record exists there, so there is no ID to name.
- **The retention bound on `resume`.**
  A released session already returns its own explicit message pointing at `get_subagent_result`; existing behavior, out of scope, as the issue states.
- **README changes.**
  The README documents the tool's parameters and the widget, not the result text's shape; no section goes stale.
- **Reshaping the resume-return edge's stats.**
  It returns result text with no completion header today, and it keeps that shape — it gains the ID line and nothing else.

## Background

Relevant modules, all under `packages/pi-subagents/src/tools/`:

| Module                  | Role in this change                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `foreground-runner.ts`  | `runForeground` — owns the spinner, the spawn call, and the two result-formatting branches (error, success)                                    |
| `agent-tool.ts`         | `AgentTool.execute` — routes to resume / background / foreground; owns the resume-return edge                                                  |
| `background-spawner.ts` | The correct precedent: `Agent ID: ${id}\n` inside its launch block. Unchanged                                                                  |
| `helpers.ts`            | `textResult` (the `{content, details}` wrapper), `buildDetails` (which sets `details.agentId`), `renderSpawnNotes`, `getStatusNote`. Unchanged |

`buildDetails` sets `agentId: record.id` and `textResult` returns it under `details`.
`details` is renderer metadata consumed by `renderAgentResult` in `result-renderer.ts`; the model sees only `content[].text`.
That is the whole defect.

Current model-visible text, by edge:

```text
background-spawner.ts   Agent started in background.
                        Agent ID: <id>
                        Type: … / Description: … / …

foreground error        Agent failed: <error>

foreground success      Agent completed in 6.0s (1 tool uses, 24.9k token).

                        <result body>

resume-return           <result body>

spawn threw             <err.message>
```

Two AGENTS.md / roadmap constraints apply:

1. The Phase 22 health-metrics table (`docs/architecture/architecture.md`) carries the row "Foreground result text carries the resume handle", baseline 0, target ≥ 1, recompute `grep -c 'Agent ID' packages/pi-subagents/src/tools/foreground-runner.ts`.
   The table's own note says Step 7 must use that spelling or update the row in the same commit.
   The adopted design uses the spelling, so the row stands as written.
   Measured baseline today: `0`.
   Predicted after the change: `2` (the success branch and the error branch each carry the literal on one line), which satisfies `≥ 1`.
2. Because this is a numbered roadmap step, the architecture doc's `✅` step mark, its Mermaid node, and a `Landed:` note are expected doc updates in this plan, landed at implementation completion.

## Design Overview

One decision, applied at three sites: every model-visible delivery of a subagent outcome names the handle that outcome can be acted on with.

The handle unlocks two things, not one — `resume` (the issue's case) and `get_subagent_result(id, verbose: true)` for the full transcript of a foreground child whose returned summary was truncated.
Both stay reachable for the record's lifetime; `resume` additionally needs the session unreleased, which holds at return time (the retention sweep only releases a terminal agent past a window of at least one minute, measured from the later of completion and consumption).

### Foreground success

The ID line follows the completion header, ahead of the blank line that separates header from body — the same header-then-blank-line-then-content shape the background door and `get_subagent_result`'s report both use.

```text
Agent completed in 6.0s (1 tool uses, 24.9k token).
Agent ID: b15f500f-314b-49b

I found the ## Deferred table in the file…
Which issue number would you like me to provide the deferral rationale for?
```

The spawn-notes prefix (`renderSpawnNotes`, which reports an unknown agent type or a discarded locked override) keeps its position ahead of everything — it is the first thing the parent must read, and this change must not displace it.

### Foreground error

```text
Agent failed: Context window exceeded
Agent ID: b15f500f-314b-49b
```

### Resume-return

```text
Agent ID: b15f500f-314b-49b

…the child's answer…
```

The ID is read off the record in hand (`record.id`), not off `params.resume` — in production `SubagentManager.resume` returns the same record the map holds, so the two agree, and the record is the authority.

### Shape of the change

No new types, no new collaborator, no interface change.
Each site is a string-template edit inside an existing `textResult` call:

```typescript
// foreground-runner.ts — success branch
return textResult(
  `${noteText}Agent completed in ${formatMs(durationMs)} (${statsParts.join(", ")})${getStatusNote(record.status)}.\n` +
    `Agent ID: ${record.id}\n\n` +
    (record.result?.trim() ?? "No output."),
  details,
);
```

`details.agentId` is unchanged and still feeds `renderBackground`'s TUI line; the text is now a second, model-visible channel rather than a replacement.
In the TUI's expanded completed view the ID line renders as the first dim line of the result body — the price of the header position, and consistent with how the background launch block already reads there.

## Module-Level Changes

| File                                   | Change                                                                                                                                                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/tools/foreground-runner.ts`       | Success branch: insert `Agent ID: ${record.id}` as its own line between the completion header and the blank line. Error branch: append `\nAgent ID: ${record.id}` after `Agent failed: <error>`. The `spawnAndWait`-threw branch is untouched |
| `src/tools/agent-tool.ts`              | Resume-return edge: prefix the returned text with `Agent ID: ${record.id}\n\n`                                                                                                                                                                |
| `test/tools/foreground-runner.test.ts` | New assertions for the success and error edges; new ordering assertion pinning the spawn-notes prefix ahead of the ID line                                                                                                                    |
| `test/tools/agent-tool.test.ts`        | New assertion on the resume-return edge; new assertion that the foreground path through `AgentTool.execute` carries the ID end to end                                                                                                         |
| `docs/architecture/architecture.md`    | Mark Step 7 landed: `✅` on the `#### Step 7 —` heading and on the `S7[…]` Mermaid node, a `Landed:` note above its `Release:` line, and `✅` on the metric row's target cell with the measured value recorded in the note                    |

No exported symbol is added, removed, or renamed, so there is no cross-file symbol sweep to run.
Greps performed against the removal/rename checklist, for the record:

- `Agent ID` across `src/`, `test/`, `docs/`, `README.md` — the only production site is `background-spawner.ts:54`; the README's three hits are parameter-table descriptions (`Agent ID to resume a previous session`), not result-text samples.
- `Agent completed` / `Agent failed` across the package — only the two production sites and their `toContain` assertions in the two test files; no doc or skill quotes the foreground result's shape, and no test asserts it with `toBe`/`toEqual`, so no exact-match assertion breaks.
- `.pi/skills/package-pi-subagents/SKILL.md` — describes tool sets, prompt assembly, and the record admission policy; it does not describe result-text formatting.

## Test Impact Analysis

No existing test becomes redundant; all three edges gain coverage they did not have.
`test/tools/foreground-runner.test.ts` and `test/tools/agent-tool.test.ts` already assert on result text with `toContain`, and every fixture routes through `createTestSubagent()`, whose `id` defaults to `"agent-1"` — so the new assertions need no fixture change (confirmed by the tidy-first assessor against the real files).

New tests:

| Test surface                          | Covers                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `runForeground` success               | Result text contains `Agent ID: agent-1`                                                   |
| `runForeground` error                 | `Agent failed: …` text contains `Agent ID: agent-1`                                        |
| `runForeground` with `fellBack: true` | The spawn-notes prefix still precedes the ID line (index comparison, not just `toContain`) |
| `AgentTool.execute` resume path       | Resumed result text contains `Agent ID: <id>`                                              |
| `AgentTool.execute` foreground path   | The ID survives the full tool path, not just the runner in isolation                       |

The `spawnAndWait`-threw edge keeps its existing test unchanged; it asserts only the thrown message, and there is no record to name.

## Invariants at risk

This change edits result text that two earlier phase steps already own.

| Invariant                                                                                                                          | Source                               | Pinned by                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The spawn-notes prefix leads the result — a discarded locked override or an unknown agent type is the first thing the parent reads | Phase 22 Step 3 ([#829])             | `foreground-runner.test.ts` "includes fallback note when fellBack is true" — which asserts only containment and is therefore order-blind. This plan strengthens it into an ordering assertion rather than trusting it |
| The foreground return marks the record consumed (the foreground-return delivery edge)                                              | [#617]'s consumption-aware retention | `foreground-runner.test.ts` "marks the returned record consumed" and "marks consumed even when the agent errored" — both untouched and still green                                                                    |
| The resume return marks the resumed record consumed                                                                                | Same                                 | `agent-tool.test.ts` "marks the resumed record consumed (resume-return delivery edge)" — untouched                                                                                                                    |
| `details.agentId` continues to feed the TUI renderer                                                                               | `buildDetails`                       | `result-renderer.test.ts`, which takes `details` and `resultText` as inputs and is unaffected by this change                                                                                                          |

The one quantitative claim is the metric row: `grep -c 'Agent ID' packages/pi-subagents/src/tools/foreground-runner.ts` is `0` today (measured) and predicted `2` after the change.
Re-measure at implementation time rather than writing the predicted number into the `Landed:` note from this plan.

## TDD Order

1. **Name the handle in every model-visible delivery edge.**

   Red: add the five tests in the Test Impact Analysis table — two in `test/tools/foreground-runner.test.ts` for the success and error branches, the ordering assertion on the `fellBack` test in the same file, and two in `test/tools/agent-tool.test.ts` for the resume path and the foreground path.

   Green: the three template edits in `src/tools/foreground-runner.ts` (success, error) and `src/tools/agent-tool.ts` (resume-return).

   Killing mutations, one per equivalence class:
   - Delete the `` `Agent ID: ${record.id}\n` `` term from `runForeground`'s success `textResult` call → the success test and the `AgentTool.execute` foreground test go red; the error and resume tests stay green.
   - Delete `\nAgent ID: ${record.id}` from `runForeground`'s error return → the error test goes red; the success test stays green.
   - Delete the `` `Agent ID: ${record.id}\n\n` `` prefix from the resume return in `AgentTool.execute` → the resume test goes red; the two `runForeground` tests stay green.
   - Move the `Agent ID` line ahead of `${noteText}` in the success branch → the new ordering assertion goes red while every `toContain` assertion stays green.
     This is the one that proves the ordering test earns its place; if it leaves the suite green, the assertion is not comparing indices.

   Verify: `pnpm --filter @gotgenes/pi-subagents run test`, then `pnpm run check` and `pnpm run lint` unpiped.

   Commit: `fix(pi-subagents): include the agent ID in foreground and resumed subagent results`

2. **Mark Phase 22 Step 7 landed in the architecture doc.**

   Add `✅` to the `#### Step 7 — Deliver the resume handle in foreground results ([#798])` heading and to the `S7[…]` node in the step-dependency Mermaid diagram, write the `Landed:` note above the step's `Release:` line, and mark the metric row's target cell `✅`.

   Verify: run the row's own recompute command (`grep -c 'Agent ID' packages/pi-subagents/src/tools/foreground-runner.ts`) and put the measured value in the `Landed:` note; `pnpm exec rumdl check packages/pi-subagents/docs/architecture/architecture.md`; render the Mermaid diagram per the `mermaid` skill.

   Commit: `docs(pi-subagents): mark Phase 22 Step 7 landed`

## Risks and Mitigations

| Risk                                                                                    | Mitigation                                                                                                                                                                      |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The ID line displaces the spawn-notes prefix, burying a discarded-override report       | The ordering assertion in step 1, plus its named killing mutation                                                                                                               |
| A future reader moves the literal into a helper and silently invalidates the metric row | The `Landed:` note records the row's measured value and the reason the literal is inline; the roadmap's own table note already warns about the spelling                         |
| The extra header line adds noise to every foreground result                             | One line, ~10 tokens, on a result that already carries a stats header; the operator weighed the alternative (a longer restated hint) at the design gate and chose the bare form |
| The TUI's expanded view now leads the result body with the ID line                      | Consistent with the background launch block's existing rendering; no renderer change and no renderer test affected                                                              |

## Open Questions

None.
Step 8 ([#465]) will decide how a child's question is *recognized* and surfaced; this step deliberately settles only the handle's delivery, which that step's soft dependency needs first.

[#465]: https://github.com/gotgenes/pi-packages/issues/465
[#617]: https://github.com/gotgenes/pi-packages/issues/617
[#829]: https://github.com/gotgenes/pi-packages/issues/829
