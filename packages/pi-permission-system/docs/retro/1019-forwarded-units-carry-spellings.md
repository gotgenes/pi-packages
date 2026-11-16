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

[#910]: https://github.com/gotgenes/pi-packages/issues/910
[#963]: https://github.com/gotgenes/pi-packages/issues/963
[#981]: https://github.com/gotgenes/pi-packages/issues/981
[#1030]: https://github.com/gotgenes/pi-packages/issues/1030
[#1097]: https://github.com/gotgenes/pi-packages/pull/1097
[#1128]: https://github.com/gotgenes/pi-packages/issues/1128
