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

[#910]: https://github.com/gotgenes/pi-packages/issues/910
[#963]: https://github.com/gotgenes/pi-packages/issues/963
[#981]: https://github.com/gotgenes/pi-packages/issues/981
[#1030]: https://github.com/gotgenes/pi-packages/issues/1030
[#1097]: https://github.com/gotgenes/pi-packages/pull/1097
[#1128]: https://github.com/gotgenes/pi-packages/issues/1128
