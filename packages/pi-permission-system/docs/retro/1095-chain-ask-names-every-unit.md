---
issue: 1095
issue_title: "A prompt over a chained command names only one part of the chain, so the session grant can approve the wrong command"
---

# Retro: #1095 — A prompt over a chained command names only one part of the chain, so the session grant can approve the wrong command

## Stage: Planning (2026-11-18T04:28:54Z)

### Session summary

Reproduced the defect with a disposable spike through the real `ToolCallGatePipeline`, `GateRunner`, `PermissionResolver`, `SessionRules`, and tree-sitter parse, using the reporter's config and commands verbatim, then deleted it.
Ran the third-party direction gate; the operator chose one prompt naming every asking unit with one session grant per unit, a new optional core request fact `otherAskingUnits`, and `cd: 2` in the arity table.
Wrote and committed an eight-step plan (`docs/plans/1095-chain-ask-names-every-unit.md`).

### Observations

- The issue and PR #1097 are both third-party, and PR #1097 was closed by its own author, not declined; its one-prompt-per-unit design was declined at the gate because it reverses #1030's one-answer-per-call contract and leaves a recorded grant behind when a later prompt is declined.
- The spike's control contradicts one line of the report: under the reporter's minimal `bash: {"*": "ask"}` config, `cd /etc` after a `cd *` grant still asks on `external_directory_read`; it goes silent only with an external-directory allow too.
  The breadth of `cd *` is real but bounded by the path surfaces.
- `check.askingUnits` already carries everything needed, so `bash-command.ts` and `restrictiveness.ts` do not change.
- The request fact is optional and absent-when-empty rather than `| null` like its neighbors, following `tool.ts`'s `floorFact`/`askingUnitsFact` precedent; the assessor confirmed no `toEqual` request assertion breaks.
- The new field holds commands, so it joins `COMMAND_BEARING_LOG_KEYS` in the same commit that first writes it to the review log.
- `describeGrantTarget` says `N paths` for several grants, which would have mislabeled a forwarded chain's whole-session option as `bash 2 paths`; found by tracing who reads a multi-grant `SessionApproval`.
- The `allow_units` partial verdict stays with #1101; no follow-up issue was filed.
- The Tidy-First assessor recommended two preparatory refactors, which the plan folds into step 2: rename `PathSessionSuggestion` to `SessionPatternsSuggestion`, and extract `optionFromPatterns` in `tool.ts`.
  It also warned that the integration test cannot live in `tool-call-gate-pipeline.test.ts`, which mocks the bash program.
- Co-authors are resolved in the plan: Raymond Neilson (issue design: the grant covers the shown chain, and `cd: 2`) and mikemikimike (PR #1097's `cd: 2`).

#### Deferred tidyings

- `test/handlers/gates/tool.test.ts`: the existing bash-chain tests sit flat among the bash tests; step 6 opens `describe("a bash chain")` for its new ones, and moving the two existing tests in is optional.
