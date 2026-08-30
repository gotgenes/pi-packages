---
issue: 828
issue_title: "pi-subagents: remove the vacant WorkspacePrepareContext.invocation field from the workspace seam"
---

# Retro: #828 — Remove the vacant `WorkspacePrepareContext.invocation` field

## Stage: Planning (2026-08-30T05:06:57Z)

### Session summary

Planned Phase 22 Step 4: deleting the unread `invocation` field from `WorkspacePrepareContext` and the whole storage chain that fed it (`AgentSpawnConfig` → `SubagentInit` → `Subagent` → the seam), plus the two tool-door producers.
Verified the hard dependency on [#724] is satisfied (closed and landed; the widget filter now reads `Subagent.isBackground`), measured the chain at 7 live sites against the roadmap's baseline of 8, and confirmed the plan's release position as the `front-door-majors` batch tail.
Plan committed at `packages/pi-subagents/docs/plans/0828-remove-vacant-workspace-invocation-field.md`; no follow-up issues filed.

### Observations

- **Two of the issue body's own claims were refuted by measurement.**
  The issue asserts that `pnpm fallow dead-code` (a CI gate) fails on a partial removal, forcing the whole chain into one commit.
  A spike that removed the seam field and the `prepare({...})` key while leaving the rest of the chain in place ran green on `tsc`, `fallow dead-code`, and the full 101-test `subagent.test.ts` file.
  The plan therefore lands the chain in one commit for coherence — a half-removed chain leaves exactly the stored-and-unread field the issue exists to delete — and explicitly records that no gate would have caught it.
- **The `tidy-first-assessor` returned "no preparatory tidying warranted" and one universal claim that was wrong.**
  It asserted that `toHaveBeenCalledWith` "asserts deep equality of the full call-argument object", so the existing `subagent.test.ts` seam-context test pins the shape and is the regression guard.
  It does not: `toHaveBeenCalledWith` compares with `toEqual` semantics, which ignore an explicitly-`undefined` key.
  A two-case probe confirmed both directions (`toHaveBeenCalledWith({a,b,c:undefined})` passes against a call of `{a,b}`; `toStrictEqual` distinguishes them).
  This is the `AGENTS.md` pattern about a subagent's universal claim being the one to verify — the assessor's line-number corrections were all correct, and its one behavioral generalization was not.
- **The plan's central design decision came out of that refutation.**
  Step 1 replaces the assertion with `toStrictEqual` on `mock.calls[0][0]`, which gives the step a killing mutation that actually fires.
  Without the probe the plan would have deleted a key from a green assertion and shipped a guard that could not see the field return.
- **Release position confirmed by reading the sibling plan, not by inferring it.**
  `docs/plans/0829-locked-fields-precedence.md:440` states the case directly — hold the release PR until #828's commit joins it — and PR #842 (`chore(main): release pi-subagents 21.0.0`) is open against a published 20.1.0.
  The batch's own line names Step 3 the tail, but Step 3 landed first and deferred, so this issue is the last remaining member.
- **Operator decisions at the clarification gate.**
  `ADR 0005`'s display-snapshot exclusion bullet is amended in place (its only named instance is being removed), and the now-vacuous `not.toHaveProperty("invocation")` assertion in `service-adapter.test.ts` is deleted rather than kept as a re-entry guard.
  The `pi-subagents-worktrees` fixture line is included as its own `test(...)` step, and the plan stays filed under `packages/pi-subagents/docs/plans/` despite touching a second package's test file.
  Follow-up question answered: the worktrees commit is a hidden changelog type touching only `test/`, so it creates no competing release PR and does not affect that package's tarball.
- **One scope note recorded as a Non-Goal rather than a follow-up issue.**
  A purpose-built per-call seam shape (`isBackground`, `model: Model`, `maxTurns`) is deliberately not filed — filing it would re-create the vacant hook in the tracker instead of the type.
  The `BREAKING CHANGE:` footer is the intake path.

#### Deferred tidyings

None — the `tidy-first-assessor` recommended no preparatory commits and rejected nothing as scope creep, finding no unrelated cleanup in any of the eleven target files.
