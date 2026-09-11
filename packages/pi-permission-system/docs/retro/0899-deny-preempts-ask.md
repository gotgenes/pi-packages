---
issue: 899
issue_title: "pi-permission-system: an ask on an earlier gate pre-empts an unconditional deny on a later one"
---

# Retro: #899 — an ask on an earlier gate pre-empts an unconditional deny on a later one

## Stage: Planning (2026-09-11T07:17:33Z)

### Session summary

Reproduced the defect through `makeHandler` with the issue's literal command, spiked two candidate fixes against the full suite, gated the semantics with the operator, ran a Tidy-First assessment, and committed `docs/plans/0899-deny-preempts-ask.md`.
The plan is four steps: a preparatory `refactor:` extracting `preResolvedCheckOf` from `GateRunner.runDescriptor`, a preparatory `test:` sharing a surface-denying resolver fixture, the `fix:` itself (produce all six gate results, then run them deny-first), and a `docs:` step.
Filed [#915] for the neighboring multiple-ask defect and recorded its Phase 15 disposition.

### Observations

- **The issue's own diagnosis was wrong about the cost, and it mattered.**
  The issue (and the roadmap entry derived from it) says the fix must hoist the permission resolve out of `GateRunner.runDescriptor`, calling that "the bulk of the work".
  Reading all six gate producers showed the resolve is already hoisted — five carry `preCheck`, `skill-read` carries `preResolved`, and `runDescriptor`'s `resolver.resolve` branch is unreachable from this pipeline.
  That collapsed the change from a runner restructure to a ~25-line pipeline edit, and it dissolved the roadmap's stated reason for deferring the issue (that it wanted to move with the deferred `runDescriptor` split).

- **Spiking both candidate rules before the gate was what made the gate answerable.**
  Option A (pre-empt only the prompt) and option B (run only the denying gate) decide identically in every case; the entire difference is which records a denied call leaves.
  Measuring both against the real suite — 4157/4157 for A, 4156/4157 for B — turned an abstract choice into one concrete artifact: the `external_directory_write` allow decision event that B stops emitting.

- **The first gate framing was rejected, correctly, for leading with a test count.**
  The operator's reply — "Is the recommendation for A simply to avoid changing tests?"
  — was right: a suite delta is a proxy, not a reason.
  Re-gating on *what the log shows for a pre-empted call* got a decision immediately.
  Lesson for future gates: when two options are outcome-equivalent, name the artifact that differs, not the measurement that detected it.

- **Option C was raised by the operator and declined on substance, not scope.**
  Collapsing two `ask` gates into one prompt drops a distinct authorization question (boundary-crossing vs. command execution), and it does not even reduce total prompts for anyone who grants for the session — it defers the second prompt to the next call.
  Measured: `cat /etc/hosts` under `external_directory: {"*": "ask"}` plus `bash: {"*": "ask"}` escalates twice, with payload kinds `bash_external_directory` and `tool`.
  Filed as [#915] with the coalesce-rather-than-drop design recorded, so the next reader of the gate loop does not rediscover it.

- **The Tidy-First assessor's rejection was overridden, and the reason is worth keeping.**
  It declined to extract the `preCheck`/`preResolved` precedence read shared with `runner.ts`, on the ground that the design summary declared `runner.ts` out of scope — a premise this planning session had supplied, not a decision.
  Its own reasoning agreed the duplication was real ("a shared function is the textbook fix for 'must mirror'").
  The extraction became Step 1.
  Lesson: a scope boundary asserted in the assessor's prompt comes back as a constraint in its verdict; state boundaries as *decisions with reasons* or not at all.

- **ADR 0013 turned out to support the change rather than caution against it.**
  The issue flagged §4's avoidance of cross-surface interaction. §4 is about bare-family sugar; §5 says most-restrictive composition between the boundary rule and the pattern surfaces "is the correct consequence of that difference rather than an arbitrary precedence rule".
  The pipeline was implementing half the documented rule (`ask` > `allow`) and not the other half (`deny` > `ask`) — which reframed the work as completing the model instead of amending it, and made the docs-only treatment the operator chose the obviously right one.

#### Deferred tidyings

- `src/handlers/gates/runner.ts` — the full `runDescriptor` split (into resolution, fast paths, and gate application phases) stays deferred, as the roadmap's `#### Deferred tidyings swept` list already records.
  Step 1 extracts one reader from it; it is not that split.
- `src/handlers/gates/tool-call-gate-pipeline.test.ts` / `test/helpers/gate-fixtures.ts` — a `makeMockBashProgram` variant returning non-empty `pathRuleCandidates()`/`externalAccesses()`, so the two bash path gates are reachable in a pipeline unit test rather than only at the handler level.
  Declined as Optional by the assessor and not needed by this plan's matrix.

[#915]: https://github.com/gotgenes/pi-packages/issues/915
