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

[#745]: https://github.com/gotgenes/pi-packages/issues/745
