---
issue: 912
issue_title: "pi-subagents: no way to ask whether an agent is resumable before calling resume"
---

# Report on each agent record why a resume would be refused

## Release Recommendation

**Release:** ship independently

Phase 23's roadmap step for this issue carries `Release: independent`, and the `Release batches` subsection lists no batches; the step is named there as a `feat:` release vehicle.

## Problem Statement

[#885] gave the service a resume door, `resume(id, prompt, options?)`, which reports a refusal *after* the caller asks: `{ kind: "refused", reason }`.
That is the right answer for an imperative call and the wrong one for a UI that wants to render a disabled Resume affordance before the click.

`SubagentRecord` cannot answer the question ahead of time.
`Subagent.resumeRefusal` composes three facts, and the snapshot carries only `status`; `sessionReleased` and `workspaceDisposed` are neither on it nor derivable from anything that is.
A consumer calling `listAgents()` sees `status: "completed"` for an agent the retention sweep released an hour ago, renders an enabled Resume button, and learns `session-released` only from the refused call.

## Goals

- `SubagentRecord` gains `resumeRefusal?: ResumeRefusal`: absent when `resume()` would start a run, otherwise the reason it would refuse with.
- The value is the existing `Subagent.resumeRefusal` getter, read once at snapshot time; nothing new is computed.
- Decision 0005 records the field's admission and the argument for it, so the next proposal does not re-litigate it.
- Non-breaking: an added field is semver-minor under decision 0005's produced-not-implemented direction; commit type `feat:`.

## Non-Goals

- A `resumeRefusalFor(id)` service query: the operator chose the record field (Option A) at the design gate; the query would answer the same question on a second surface.
- Lifecycle event payloads (`subagents:completed` and friends): decision 0005 governs the snapshot, not the events, and their guarantee stays unstated.
- `PersistedSubagentRecord` (`src/persisted-record.ts`): a separate type with no link to `SubagentRecord`, predicted unchanged.
- The `abort()` window [#885]'s review flagged, where `stopped` is set synchronously while the cancelled turn loop is still settling and `resumeRefusal` reads resumable: pre-existing in the getter, inherited by the field rather than introduced, and the run-lifecycle steps ([#1049], [#1051]) own it.
- A new refusal member for a resume queued behind `maxConcurrent`: [#1013] decides whether one exists.
- The `get_subagent_result` report and the result carriers: they already read `resumeRefusal` from the live record.

## Background

- `src/lifecycle/subagent.ts` — `ResumeRefusal` (`still-running | no-session | session-released | workspace-disposed`) and the `resumeRefusal` getter.
  The getter checks a live run first, then the session (`no-session` or `session-released`), then the workspace.
  `_sessionReleased` is set only by `releaseSession()` and `workspaceBracket.wasDisposed()` never reverts, so two of the four members are one-way latches.
  `still-running` mirrors `status`, and `no-session` covers both a queued agent and one that never got a session.
- `src/service/service.ts` — `SubagentRecord`, the public snapshot; `ResumeRefusal` is already imported and re-exported from the public entry, and `ResumeResult.reason` uses `ResumeRefusalReason` (`ResumeRefusal | "unknown-agent"`).
- `src/service/service-adapter.ts` — `toSubagentRecord`, the allowlist copy shared by `getRecord`, `listAgents`, and `resume`'s `resumed` arm.
- `docs/decisions/0005-subagent-record-admission-policy.md` — the four admission rules, the exclusion classes, and the dispositions table pinned by `test/service/service-adapter.test.ts`.
- No other package in this repo reads `SubagentRecord` (grepped every other `packages/*/src`).
- The getter's behavior per reason is already pinned in `test/lifecycle/subagent.test.ts` (`describe("Subagent — resumeRefusal")`, eight tests), so the adapter tests pin the copy, not the composition.

## Design Overview

### The field

```typescript
export interface SubagentRecord {
  // …existing fields…
  /**
   * Why `resume()` would refuse this agent at snapshot time, or absent when it
   * would start a run. `still-running` clears when the run settles; the other
   * reasons (apart from a queued agent's `no-session`) are final.
   */
  resumeRefusal?: ResumeRefusal;
}
```

`toSubagentRecord` copies it beside the other optional fields:

```typescript
if (record.resumeRefusal !== undefined) out.resumeRefusal = record.resumeRefusal;
```

The type is `ResumeRefusal`, not `ResumeRefusalReason`: a record exists, so `unknown-agent` is never its answer, and `getRecord(id)` returning `undefined` already says so.

A consumer renders the affordance straight from the roster:

```typescript
for (const r of svc.listAgents()) {
  renderResume(r.id, r.resumeRefusal === undefined ? "enabled" : `disabled: ${r.resumeRefusal}`);
}
```

### Admission under decision 0005

The operator chose the field over a service query at the design gate; the argument decision 0005 needs:

1. **Serializable** — a string literal.
2. **Discrete, not momentary** — the value is a function of `status`, already admitted, plus two one-way latches, so it is exactly as stale as `status` and no more.
   Rule 2's list names identity, a resolved spawn decision, a cumulative metric, and a durable-artifact pointer; `status` sits in the table as "identity and lifecycle status" without a rule naming it.
   The amendment names **lifecycle status** in rule 2 explicitly, with `resumeRefusal` admitted under it.
3. **Meaningful outside this package** — `resume` is a public service call, and this is its precondition.
4. **Stable in meaning** — the core already produces it for its own carriers (`OutcomeAddenda`, `AgentReport`), not from a display snapshot.

Optional is a real state here, not a hedge: absent means resumable.

### Edge cases (each behavior is tested in Step 1)

- A settled agent whose session was released: `"session-released"` on the record (Step 1, new test).
- A resumable agent (completed, session ready): the property is absent, not `undefined`-valued (Step 1, `not.toHaveProperty`).
- The default fixture (completed, no session) reads `"no-session"`, and a running one reads `"still-running"` (Step 1, the three updated exact `toEqual` tests).
- A roster of mixed agents: each `listAgents()` row carries its own answer (Step 1, new adapter test).
- `workspace-disposed` is not re-tested at the adapter: it needs a real `run()`, and the copy is reason-agnostic; the getter test pins it.

## Module-Level Changes

| File                                                      | Change                                                                                                                                                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/service/service.ts`                                  | `SubagentRecord` gains `resumeRefusal?: ResumeRefusal` with its doc comment; the `resume` method's doc comment notes that the record's field answers the same question ahead of the call        |
| `src/service/service-adapter.ts`                          | `toSubagentRecord` copies `resumeRefusal` when defined; its doc comment is unchanged (the allowlist rationale already covers it)                                                                |
| `test/service/service-adapter.test.ts`                    | Three exact `toEqual` tests gain the field; new tests for `session-released`, the omission when resumable, and a mixed `listAgents()` roster                                                    |
| `docs/decisions/0005-subagent-record-admission-policy.md` | Rule 2 names lifecycle status; the dispositions table gains a `resumeRefusal` row; ride-along: a `pendingQuestion` row (admitted optional by `81863e41` with no row)                            |
| `README.md`                                               | `getRecord` / `listAgents` contract: the field list names `pendingQuestion` (ride-along, same sentence) and `resumeRefusal`; the `resume` contract says the record's field predicts the refusal |
| `.pi/skills/package-pi-subagents/SKILL.md`                | The decision 0005 summary sentence (line ~152) adds lifecycle status to what the snapshot admits                                                                                                |
| `docs/architecture/architecture.md`                       | `✅` on the `#### [#912]` heading and the `S912` Mermaid node, plus a `Landed:` note                                                                                                            |

Predicted unchanged:

- `src/persisted-record.ts` and its test — `PersistedSubagentRecord` is its own interface (verified: no `SubagentRecord` reference in either file).
- `src/lifecycle/subagent.ts` — the getter is read, not changed.
- `test/lifecycle/subagent.test.ts` — the getter's tests stand as they are.
- The `getRecord`/`listAgents` tests at `service-adapter.test.ts` lines 231–286 — measured green with the copy line applied (spike below).

## Test Impact Analysis

Spike at planning time (applied the copy line to `toSubagentRecord`, ran `test/service/service-adapter.test.ts`, reverted): **measured** 3 failed, 39 passed of 42.
The three are exactly the predicted exact-equality tests: `includes all serializable fields`, `omits optional fields when undefined on the source`, and `returns the resumed agent by value, never the live record`.
They fail by design, since decision 0005 states that a widening meets the policy at those tests.

1. New tests: the adapter relays a durable reason, omits the property when resumable, and gives each roster row its own answer.
2. Redundant tests: none; the getter's eight tests pin composition, these pin the copy.
3. Kept as-is: every getter test in `test/lifecycle/subagent.test.ts`, and the decline test (`withholds momentary activity and package-internal bookkeeping`), which must stay green unmodified.

## Invariants at risk

| Invariant                                                                   | Constituency                     | Pinned by                                                                                                            |
| --------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Decision 0005: the snapshot admits only the allowlisted set                 | Consumers that serialize records | The exact `toEqual` tests in `service-adapter.test.ts` (updated here, deliberately) and the decline test (unchanged) |
| Decision 0005: a snapshot is by value                                       | Consumers holding a record       | The field is a primitive copied at snapshot time; the `lifetimeUsage`/`turnBudget` copy tests stay green unmodified  |
| [#885]: `resume()` never throws and refuses with the same reason vocabulary | Service-resume callers           | `SubagentsServiceAdapter — resume` tests, unchanged apart from the resumed snapshot gaining the field                |
| [#878]: no carrier names a resume the core would refuse                     | The parent model                 | `test/observation/outcome-delivery.test.ts`, untouched; the carriers read the same getter                            |

[#1051]'s roadmap constraint reads "`SubagentRecord` is unchanged … the service tests pass unmodified".
Landing first, this step changes the baseline that constraint is measured against; [#1051] keeps the getter on `Subagent`, so its own tests still pass unmodified against the new baseline.

## TDD Order

1. **Red → green: the record reports why a resume would be refused.**
   Red, in `test/service/service-adapter.test.ts` `describe("toSubagentRecord")`:
   - "reports session-released once the retention sweep has freed the session": `createTestSubagent({ sessionReady: true })`, `await agent.releaseSession()`, expect `toSubagentRecord(agent).resumeRefusal` to be `"session-released"`.
   - "omits resumeRefusal when a resume would start": `createTestSubagent({ sessionReady: true })`, expect `not.toHaveProperty("resumeRefusal")`.
   - Update the three exact `toEqual` tests: `includes all serializable fields` and the resumed-snapshot test gain `resumeRefusal: "no-session"`, and `omits optional fields when undefined on the source` gains `resumeRefusal: "still-running"`.

   Red, in `describe("SubagentsServiceAdapter — getRecord and listAgents")`:
   - "gives each listed agent its own resume answer": the manager stub's `listAgents` returns a resumable agent and a released one; expect the resumable row `not.toHaveProperty("resumeRefusal")` and the released row's `resumeRefusal` to be `"session-released"`.

   Green: the field on `SubagentRecord` with its doc comment, the `resume` doc-comment sentence, and the one copy line in `toSubagentRecord`.
   Verify: `pnpm --filter @gotgenes/pi-subagents run test`, `pnpm run check`, and `pnpm --filter @gotgenes/pi-subagents run verify:public-types` (the public surface changed).
   Killing mutations:
   - (a) Delete the copy line in `toSubagentRecord`: the `session-released`, roster, and three updated `toEqual` tests go red.
   - (b) Make the copy unconditional (`out.resumeRefusal = record.resumeRefusal;`): the omission test goes red (`not.toHaveProperty`), and so does the roster test's resumable row.
   Commit: `feat(pi-subagents): report on each agent record why a resume would be refused`.
2. **Docs: admission, contract, and roadmap.**
   Decision 0005: rule 2 names lifecycle status, a `resumeRefusal` row (`admitted, optional`; basis: lifecycle status, derived from `status` plus two one-way latches; absent when resumable), and the ride-along `pendingQuestion` row.
   README: the `getRecord` / `listAgents` field list gains `pendingQuestion` and `resumeRefusal`, and the `resume` contract gains a sentence that each record's `resumeRefusal` predicts the refusal before the call.
   `.pi/skills/package-pi-subagents/SKILL.md`: the decision 0005 summary sentence.
   `docs/architecture/architecture.md`: the `✅` heading mark, the `S912` node label, and a `Landed:` note naming the field and the decision 0005 amendment.
   Verify: `pnpm exec rumdl check` on each edited markdown file; `pnpm run lint`.
   Commit: `docs(pi-subagents): admit resumeRefusal to SubagentRecord under decision 0005`.

## Risks and Mitigations

| Risk                                                                                                                            | Mitigation                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A consumer's exhaustive `switch` over `resumeRefusal` breaks when [#1013] adds a member                                         | Already true of `ResumeResult.reason`, which shares the vocabulary; [#1013]'s plan decides the member and its release classification for both surfaces at once |
| A consumer treats `still-running` or a queued agent's `no-session` as final                                                     | The field's doc comment names which reasons clear; the README sentence repeats it                                                                              |
| A held snapshot goes stale when the sweep releases the session later                                                            | Same contract as `status`: the README already says "Poll again for fresh data"                                                                                 |
| The resumed snapshot from `resume()` now carries a refusal (e.g. `workspace-disposed` after a run that tore its workspace down) | That is the truth about the agent after the run; the updated resumed-snapshot test pins the field's presence                                                   |

## Open Questions

- None blocking.
  Whether lifecycle event payloads should carry the field stays with decision 0005's unstated event guarantee and [#1025]'s channel consolidation.

[#878]: https://github.com/gotgenes/pi-packages/issues/878
[#885]: https://github.com/gotgenes/pi-packages/issues/885
[#1013]: https://github.com/gotgenes/pi-packages/issues/1013
[#1025]: https://github.com/gotgenes/pi-packages/issues/1025
[#1049]: https://github.com/gotgenes/pi-packages/issues/1049
[#1051]: https://github.com/gotgenes/pi-packages/issues/1051
