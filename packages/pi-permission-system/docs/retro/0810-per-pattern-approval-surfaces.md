---
issue: 810
issue_title: "pi-permission-system: record a session approval at the direction the gate proved, per pattern"
---

# Retro: #810 — pi-permission-system: record a session approval at the direction the gate proved, per pattern

## Stage: Planning (2026-09-02T04:55:11Z)

### Session summary

Planned Phase 14 Step 10 — `(surface, pattern)` pairs on `SessionApproval` and its forwarded wire form — as `docs/plans/0810-per-pattern-approval-surfaces.md`, four steps (one preparatory `refactor:`, a `feat!:` reshape, a `feat:` gate change, a `docs:` step).
One clarification gate settled the wire-compatibility question the roadmap flagged and the pair type's name; the operator took the strictest wire option (pairs only, reader rejects the old shape) after a round of elaboration on whether version skew needs supporting at all.
The Tidy-First assessor found one preparatory commit and reported no contradictions with the design.

### Observations

**The wire gate got bounced once, and the bounce was the useful part.**
The first option set framed the choice as tolerance-vs-breaking on the *file* boundary alone.
The operator's push-back — "in all foreseeable cases parent and child run the same version" — was correct about the file, and forced the second-order fact into the open: `ForwardedSessionApproval` is structurally reachable from the published declaration bundle through `PromptPermissionDetails`, which is what a third-party `Authorizer` chain link receives.
So the break exists whether or not two processes ever skew, and the *type* is what earns the major bump.
Naming that changed the answer: with tolerance no longer buying non-breaking status, the cleanest shape won.

**Two facts were read off the published tag rather than argued.**
`pnpm view` reports 29.3.0, and `git show pi-permission-system-v29.3.0:…/authority/forwarding-io.ts` shows both that `sessionApproval` is absent from `readForwardedPermissionRequest`'s required set (so an old parent accepts a new child's request and merely drops the suggestion) and that `asForwardedSessionApproval` ignores unknown keys.
That is what makes the skew claim "fails narrow, no upgrade ordering" a measurement rather than an expectation — and it is the concrete contrast with [#745], whose older parent rejected the whole request.

**The issue's motivating example collapses to a no-op, and the plan says so.**
`deriveApprovalPattern` scopes a glob at the value's last separator, so `cat /outside/a.ts > /outside/b.ts` derives `/outside/*` for both tokens: the two directional grants reconstitute exactly what the bare family sugar-expands to.
The narrowing is only observable when the paths sit in different directories.
The existing pin in `bash-external-directory.test.ts` uses the same-directory form, so a plan that took the roadmap's `Outcome:` line at face value would have written a test that passes under the old code.
The plan carries a before/after table for both cases and gives the same-directory no-op its own test.

**`multiple` is dropped, diverging from the issue's sketch.**
The issue says "`single` and `multiple` stay as constructors, and a third takes the pairs directly."
But both production callers of `multiple` move to the pair constructor, which would leave it with test-only callers — a dead-code liability CI gates on, and the maintenance trap the package skill names.
`forGrants` subsumes it in one line.

**The roadmap's own escape clause covered the metric rename.**
Phase 14's health-metrics section already states that a step creating a symbol the roadmap greps for "must either use the roadmap's name or update the metric row in the same commit."
The predicted name was `ApprovalPattern`; the operator chose `ApprovalGrant`, so the row and its recompute command move in the docs step.
Measured baseline at planning time: `grep -c 'ApprovalPattern' src/session-approval.ts` reads 0, which it would read after the change too.

**A new module for an eight-line interface, to keep one edge one-directional.**
`session-approval.ts` already imports `ForwardedSessionApproval` from `authority/permission-forwarding.ts`, so declaring `ApprovalGrant` in either and importing it from the other creates a type-only cycle.
`src/approval-grant.ts` avoids it, with `src/session-approval-recorder.ts` as the precedent for a single-interface module in this package.

**The Tidy-First assessor verified a claim I handed it as a premise, and that was the right instruction.**
I asked it to confirm rather than assume that `PermissionGateResult.sessionApproval`'s value has no reader.
It went further than the two call sites I named and checked `GateOutcome`, the runner's public return type, which carries no such field — closing the "no external reader" claim properly.
It also reported that `test/handlers/gates/runner.test.ts` needs no change for that step, which narrowed the preparatory commit's blast radius.

#### Deferred tidyings

- `test/authority/forwarded-request-server.test.ts` — the `{ surface: "bash", patterns: ["git *"] }` literal repeats about six times (plus one each in `local-user-authorizer.test.ts`, `approval-escalator.test.ts`, `runner.test.ts`).
  The assessor rated a shared fixture builder Optional and declined it: each occurrence is a one-line literal inside an otherwise-distinct setup, and the migration to the pair shape is a mechanical edit either way.

## Stage: Implementation — TDD (2026-09-02T05:28:30Z)

### Session summary

Executed all four planned steps: one preparatory `refactor:`, the `feat!:` reshape of `SessionApproval` and the forwarded wire onto `ApprovalGrant` pairs, the `feat:` that stops the bash external-directory gate falling back to the bare family, and the `docs:` step (migration guide, ADR 0006 amendment, module tree, package skill, README, Phase 14 Step 10 marked ✅).
Package test count went 3847 → 3864 (+17 net: 19 added, 3 removed with `toGateApproval`, plus renames).
Pre-completion reviewer: PASS.

### Observations

**Four deviations from the plan, all in the same direction — fewer members, not more.**
The plan had step 2 rename `representativePattern` to `representativeGrant`; I deleted it in step 1 instead and never added the replacement, because tracing its callers showed the only production reader was `toGateApproval()`, which step 1 deletes.
`local-user-authorizer.ts` reads the *forwarded* plain object (`details.sessionApproval?.grants[0]`), not the value object, so `representativeGrant` would have shipped with zero production callers — the same dead-member argument the plan already used to drop `SessionApproval.multiple`.
In its place step 1 added an `isRecordable` getter the plan did not name, which exists to preserve `toGateApproval()`'s exact semantics: it returned `undefined` for an empty approval, so a naive `descriptor.sessionApproval !== undefined` would have reported `forSession` for an approval that records nothing.
The fourth: the plan listed `test/handlers/gates/skill-input.test.ts` as a touch point and it was not touched — it stubs `checkPermission` only and never names the approval shape.

**`tsc` found the call sites a targeted grep had missed, twice.**
Planning enumerated `sessionApproval` call sites by grepping `\.sessionApproval` shapes, which missed six bare `representativePattern` reads in `tool.test.ts` and `bash-path.test.ts`.
Running `pnpm run check` immediately after the step-1 interface change surfaced all six at once.
The second miss was invisible to `tsc`: a `sessionApproval: { surface: "bash", patterns: ["git *"] }` literal inside an `expect.objectContaining` in `runner.test.ts`, which is untyped and only failed at the **full** suite run.
That is exactly the mock-producer-vs-assertion hazard AGENTS.md warns about for scripted test edits, and running the full package suite rather than the files the migration script touched is what caught it.

**One `Edit` batch was silently rejected and the failure looked like a success.**
A two-entry `Edit` on `forwarding-io.ts` had its second entry fail to match; the batch is atomic, so the first entry — the whole reader rewrite — was not applied either.
I then applied the import edit separately and moved on, and only `pnpm run check` revealed the old reader was still in the file.
Re-applying **every** intended edit after a rejection, not just the one that failed, is the rule that would have skipped that round trip.

**Every killing mutation matched its prediction except one, which killed more.**
Step 1's mutation (unconditional `forSession: true`) killed 3 tests where the plan named 2 — the extra was a pre-existing `"returns allow when user approves"` assertion, which is a stronger result, not a weaker one.
Step 2's four mutations killed exactly 2, 1, 7, and 1 tests as predicted, including the reader-strictness mutation whose 7 reds were the 6 malformed-grant cases plus `"ignores unknown sibling keys on a grant"`.
Step 3's two mutations both killed both mixed-direction tests; the plan's sentence predicting which would stay green was garbled and is superseded by this measurement.

**The same-directory no-op is the finding planning is most likely to have missed.**
`deriveApprovalPattern` scopes a glob at the value's last separator, so `cat /outside/a.ts > /outside/b.ts` derives `/outside/*` for both tokens and the two directional grants reconstitute exactly what the bare family sugar-expands to.
The pre-existing test for the mixed-direction case used precisely that same-directory command, so a plan that took the roadmap's `Outcome:` line at face value would have written a "narrowing" test that passes under the old code.
It now has its own test asserting both directions on the shared glob, with a comment saying why that is correct rather than a regression.

**The reviewer re-derived the reader's rejection domain rather than reusing the test table, which is what the mandate asked for.**
It traced prototype-pollution keys, nested arrays, `grants` as an object with numeric keys, and a whitespace-only surface, and reported that `asApprovalGrant` builds a literal `{surface, pattern}` from only those two fields — so no accepted input can name a surface the child did not literally write — and that `JSON.parse`'s `CreateDataProperty` semantics make a `"__proto__"` key an inert own property.
It also independently confirmed the different-directory relief condition, the `PromptPermissionDetails` → `Authorizer` reachability that makes this breaking, and that the `BREAKING CHANGE:` footer's remediation exists in the real surface.

### Reviewer warnings

None.
Pre-completion reviewer: PASS, no WARN findings.

[#745]: https://github.com/gotgenes/pi-packages/issues/745
