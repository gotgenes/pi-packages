---
issue: 1019
issue_title: "pi-permission-system: forwarded bash asks drop the command's spellings on the serving node"
---

# Retro: #1019 — pi-permission-system: forwarded bash asks drop the command's spellings on the serving node

## Stage: Planning (2026-11-16T04:48:58Z)

### Session summary

Planned forwarding each asking bash unit's spellings (home-expanded and absolute-argument) on the `askingUnits` wire that [#1030] introduced, so the serving node resolves each unit as the child did.
A disposable spike through the real parser, `resolveBashCommandCheck`, and `ResolverServingPolicy` confirmed three fail-open or re-prompt rows, and a live review-log sweep showed the absolute-argument spelling from [#910] is the common carrier (90 of 202 forwarded bash asks, cwd-estimated), not `~` (0 units).
Filed [#1128] for the local-gate sibling: an exempt wrapper's inner command resolves without spellings, so `time rm builds/x` misses `rm /tmp/builds/*: deny`.

### Observations

- The issue's framing (spellings on `PermissionCheckResult`) predates [#1030]; since then the pairing is per `AskingBashUnit`, which shrank the design question to how the gate keeps spellings paired with the `command` the wire names.
- The first `ask_user` offered three pairings (A: re-pair by `result.command === cmd.text`; B: a field on the public `PermissionCheckResult`; C: a module-private `ResolvedUnit { check, spellings }`).
  The operator asked for a deeper explanation and stated a standing preference for explicit designs over implicit ones, then chose C. The gate recommended A on diff size; for this operator, lead with the explicit option when the implicit one's safety rests on an invariant a reader must infer.
- Operator decisions: `fix:` (not breaking, since the serving node is brought to the local spelling contract [#910]/[#981] already shipped); a malformed `spellings` drops the whole intent and escalates, mirroring `floor` and `askingUnits`.
- The tidy-first assessor recommended extracting a typed per-unit predicate in `forwarding-io.ts` (Step 1) and, as optional, a `tagWithUnitFacts` helper in `bash-command.ts` (Step 2); both are in the TDD Order.
  It also advised `floorUnparsedUnit` take and return the pair, so the "whole line has no spellings" rule lives at the one site that replaces `command`.
- It flagged that the exempt-wrapper verdict comes from the inner command while the forwarded unit carries the wrapper text's spellings; the plan records that as intentional (the serving node resolves the wrapper text) and points the inner-command gap at [#1128].
- The [#981] plan's rationale for not spelling a wrapper's inner command ("a floor-exempt inner command is a pure-reader core command") went stale when [#963] added the `execution-modifier` exemption; [#1128] records that.
- Open PR [#1097] (third party) exports `resolveCommandUnit`, whose return type this plan changes; flag at `/ship`.

#### Deferred tidyings

- `src/handlers/gates/bash-command.ts`: the long `resolveBashCommandCheck` docblock sits above `WRAPPER_SENTINEL` rather than the function it documents.

## Stage: Implementation — TDD (2026-11-16T05:15:09Z)

### Session summary

Completed all five TDD steps: two preparatory refactors (`isWellFormedAskingUnit`, `tagWithUnitFacts`), the child-side `ResolvedUnit` pairing that stamps `spellings` on each asking unit, the serving-side fix (wire reader keeps and validates `spellings`; `ResolverServingPolicy.resolveUnit` resolves with them), and the docs.
The `pi-permission-system` suite went from 6428 to 6443 tests (+15); every named killing mutation reddened the predicted tests.

### Observations

- Deviation: the `forwarded-request-server.test.ts` projection test the plan called a pin (green at red) was red before the fix, because `escalateForwardedAsk` writes the request to disk and reads it back through `asForwardedAccessIntent`, whose `copyAskingUnits` dropped `spellings`.
  It therefore also kills the "drop `spellings` from `copyAskingUnits`" mutation; recorded in the `fix:` commit body.
- The "drop `honorChildFloor`" mutation also killed the existing [#1030] floor test ("a session grant covering one unit leaves a floored sibling asking"), as expected.
- `pi-autoformat` collapsed the multi-line `spellings` spread in `copyAskingUnits` to one line, so the first scripted mutation matched nothing and read as a surviving mutation; `diff` against the saved green copy caught it before it was recorded.
- The configuration-doc example uses the `~/bin/tool *` deny against `$HOME/bin/tool --now`, mirroring the local example in § Home Directory Expansion in Patterns.
- Pre-completion reviewer: PASS (re-derived the four mandated invariants: no spelling beside a foreign `command`, the floor still clamps a spelling-matched `allow`, a malformed `spellings` escalates, and the child's local decisions are unchanged).
  Note for `/ship`: PR [#1097] exports `resolveCommandUnit`, whose return type is now `ResolvedUnit`.

## Stage: Final Retrospective (2026-11-16T05:56:18Z)

### Session summary

One session ran planning, TDD, ship, and retro for #1019 on `main`: the parent now matches each forwarded bash unit in the spellings the subagent fixed for it, shipped as `pi-permission-system-v42.0.2`.
The five-step plan landed as written apart from one test-prediction deviation, the pre-completion reviewer passed it on first dispatch, and planning filed [#1128] for a real local fail-open found along the way.

### Observations

#### What went well

- The live review-log sweep re-scoped the issue before design: the issue was framed around `~`, but 0 of 202 forwarded bash asks had a home-prefixed unit while 90 carried an absolute-argument spelling ([#910]), so the plan's tests and docs lead with `rm builds/x`, not only `~/bin/tool`.
- The tidy-first assessor's "nuance" note (an exempt wrapper's verdict comes from its inner command) prompted a 1-call spike that measured `time rm builds/x` slipping past `rm /tmp/builds/*: deny` locally; that became [#1128].
  An assessor's side remark became a measured defect instead of a plan caveat.
- The pre-completion dispatch carried a re-derivation mandate with four named invariants; the reviewer enumerated every `command`-setting site itself rather than echoing the tests, and returned PASS with evidence per invariant.

#### What caused friction (agent side)

- `instruction-violation` (user-caught) — the first design gate bundled three questions, but Q1 (the pairing) carried a prose comparison of A/B/C with no per-site table or code sketch, and recommended A on diff size.
  `clarification-gates` already says to place each option at the point of the flow it changes, and the follow-up answer did exactly that (a site table plus each option's code at `floorUnparsedUnit`).
  The operator answered Q2/Q3, asked for a deeper Q1 explanation, and stated a standing preference for explicit designs; C was then chosen.
  Impact: one extra gate round; no rework.
- `other` — two scripted mutations in TDD Step 4 were checked with `git diff --stat`, which during an uncommitted Green also shows the step's own edits, so it could not show whether the mutation applied.
  M3 (`copyAskingUnits` drops `spellings`) matched nothing because `pi-autoformat` had collapsed the spread onto one line, and read as "0 reds" until a `grep` showed the reformatted line.
  Impact: 2 extra calls; a near-miss on recording a surviving mutation as a coverage gap.
- `missing-context` — the plan predicted the `forwarded-request-server.test.ts` projection test as a pin (green before the fix), but `escalateForwardedAsk` writes the request to disk and reads it back through `asForwardedAccessIntent`, so it went red.
  Impact: none beyond a deviation note in the `fix:` commit body; the test is stronger than planned.
- `instruction-violation` (self-identified) — a planning `grep` ran after `cd packages/pi-permission-system`, which the `pi-permission-system` deny rule refused.
  Impact: 1 call; the deny rule worked as intended.
- `rabbit-hole` (short) — the log-corpus join first used a `jq --rawfile` index that matched nothing, then the wrong event's keys, before an `awk` join on `requestId` worked.
  Impact: 3 extra calls.

#### What caused friction (user side)

- The operator's preference for explicit designs over smaller implicit ones is durable and not inferable; recorded nowhere before this session, it surfaced only as a bounce on the gate.
  Recording it where a design recommendation is formed saves that round on later gates.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `anthropic/claude-opus-5-5`; ship ran on `anthropic/claude-sonnet-5-5` (mechanical, appropriate).
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `anthropic/claude-sonnet-5-5` per their transcripts and produced judgment-quality reports (the assessor's wrapper-exempt nuance, the reviewer's site enumeration); no mismatch.
- **Feedback-loop gap analysis** — `check` ran after every step that changed a shared type (Steps 1–4), the affected test files after every Red and Green, and the full package suite before the `fix:` commit; no gap.

### Changes made

1. `.pi/skills/code-design/SKILL.md` — added § State the invariant at the site that owns it: prefer the design that states an invariant where the value is set over one a reader must infer, and recommend it in a design gate unless it widens a shared type.

Proposed and declined by the operator: replacing the `testing` skill's `git diff --stat` mutation check with a diff against the saved green copy.

[#910]: https://github.com/gotgenes/pi-packages/issues/910
[#963]: https://github.com/gotgenes/pi-packages/issues/963
[#981]: https://github.com/gotgenes/pi-packages/issues/981
[#1030]: https://github.com/gotgenes/pi-packages/issues/1030
[#1097]: https://github.com/gotgenes/pi-packages/pull/1097
[#1128]: https://github.com/gotgenes/pi-packages/issues/1128
