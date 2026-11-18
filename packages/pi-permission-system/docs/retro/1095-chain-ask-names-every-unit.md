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

## Stage: Implementation — TDD (2026-11-18T04:49:20Z)

### Session summary

Executed all eight plan steps as eight commits (two `refactor:` preparations, two unwired `refactor:` additions, one `feat:`, three `fix:`, one `docs:`), each mutation-checked before commit.
The package suite went from 6462 to 6488 tests (+26), all green; `check`, root `lint`, root `test`, and `fallow dead-code` pass.

### Observations

- Step 3's `eslint` pre-commit hook rewrote `[...(entries as string[])]` in `asStringList`: the `every((entry) => typeof entry === "string")` callback is an inferred type predicate, so the cast was unnecessary.
  Re-staged with the cast dropped.
- Step 6's integration test first typed its config parameter as `Record<string, unknown>`, which Vitest ran green and `tsc` rejected.
  It now derives the type from `createInMemoryManager`'s parameter.
  Run `check` before committing a new test file, not only after source edits.
- Step 6's `local-user-authorizer.test.ts` forwarded-scope test was already green at Red, since step 5's `describeGrantTarget` change produced the label.
  It stays as a cross-layer pin; the step-5 mutation is what kills it.
- Step 7's budget test first expected the label column to narrow once the evidence was dropped.
  The dialog aligns labels across core and dropped evidence (as the existing "renders the whole core" test shows), so the expectation was corrected to the 12-character column.
- `describeGrantTarget` and `buildPathAccessSessionLabel` now share a private `isPathFamilyGrant` predicate instead of each spelling the family test.
- ADR 0011 gained `amended:` frontmatter, a Status line, and a `#### Amendment` under §3, following ADR 0006 and ADR 0007's form.
- Pre-completion reviewer: PASS.
  Non-blocking observations: `echo a; echo a` lists an `also asks : echo a` identical to the value (intended by the plan); and the aliased-shell-tool case is tested for its grant but not its payload fact (consistent by construction, since `check.toolName` is `bash`).

## Stage: Final Retrospective (2026-11-18T06:08:21Z)

### Session summary

One trunk-lane session ran all four stages: planning, eight TDD steps, ship, and this retrospective.
It shipped `pi-permission-system` 42.1.0.
A bash chain's prompt now names every asking unit as a core `otherAskingUnits` fact, its session option records one pattern per asking unit, and `cd <dir>` suggests `cd <dir>*`.
Issue #1095 is closed, crediting the reporter and PR #1097's author; #1101 stays open for the partial authorizer verdict.

### Observations

#### What went well

- The planning spike ran the reporter's config and commands unchanged through the real `ToolCallGatePipeline`, `GateRunner`, `PermissionResolver` and `SessionRules`, and its control row contradicted one of the reporter's steps.
  Under the reporter's own `bash: {"*": "ask"}` config, `cd /etc` after a `cd *` grant still asks on `external_directory_read`.
  That turned "`cd *` grants every directory" into a bounded claim before the gate, and it framed the `cd: 2` risk honestly in the plan.
  This is the `reproduction` skill's "read the report for what contradicts you" paying off on a third-party report.
- Tracing every reader of a multi-grant `SessionApproval`, rather than only the producer being changed, found `describeGrantTarget`'s `N paths` wording during planning.
  Without that, a forwarded chain's whole-session option would have read "allow bash 2 paths".
  It became a planned step instead of a review finding.
- The Tidy-First assessor made three concrete corrections the plan absorbed:
  - the integration test cannot live in `tool-call-gate-pipeline.test.ts`, which mocks the bash program;
  - the bash label must not go through `grantTargets`, whose directory fold is path semantics;
  - an optional request field breaks no existing `toEqual` request assertion, measured across the four files that hold them.
- Every step's planned killing mutation went red as predicted.
  The extra mutations added during TDD (first-match-only removal, guard validation, empty-array emission) each killed exactly the one test they targeted.

#### What caused friction (agent side)

- `instruction-violation` (self-identified, through the permission rule's teaching reason): `cd packages/pi-permission-system/...` was denied twice during planning, once for an ADR grep and once for a fixture count.
  `AGENTS.md` names the deny rule, and its reason string says what to do instead.
  Impact: two wasted calls, no rework.
  The mechanism did its job, so no rule change is proposed.
- `other` (degraded emission): one `Edit` to `architecture.md` carried a placeholder `oldText` (`the req... (placeholder)`), and the batch was rejected.
  Impact: one wasted call; the real batch was then built from unique substrings verified with `grep -cF`, and applied cleanly.
- `premature-convergence` (plan sequencing): the plan named `local-user-authorizer.test.ts`'s forwarded-scope label test as red in step 6.
  Step 5's `describeGrantTarget` change had already produced that label, so the test was green at Red.
  Impact: none on the code.
  The test stays as a cross-layer pin, but the step-5 mutation is what kills it, so its discrimination evidence sits in a different commit from the test.
- `missing-context`: step 7's row-budget test expected the dialog's label column to narrow once the evidence was dropped.
  The renderer aligns labels across core and dropped evidence, and the existing "renders the whole core" test already shows this.
  Impact: one extra run to correct the expected lines.
- `missing-context`: step 6's new integration test typed its config as `Record<string, unknown>`.
  Vitest ran it green and `tsc` rejected it after the full suite.
  Impact: two extra calls, caught before the commit.
- The step-3 commit was rejected once by the `eslint` hook: an `as string[]` cast was unneeded after an inferred type-predicate `every`.
  Impact: one re-commit.

#### What caused friction (user side)

- None.
  The one gate (direction, payload placement, `cd` arity) was answered in a single round with every recommendation accepted.
  The substance message (a measured table, the PR's status, the triage's K7 framing) appears to have carried enough to decide without a follow-up.

### Diagnostic details

- **Model-performance correlation**
  - The main session ran on `claude-opus-5-5` for planning, TDD, and this retro, and on `claude-sonnet-5-5` for `/ship`, which is mechanical and well matched.
  - Both subagents, `tidy-first-assessor` and `pre-completion-reviewer`, ran on `claude-sonnet-5-5`, attributed from their own transcripts.
  - The reviewer did an independent four-part grant-scope re-derivation and cited the implementation for each part, not test fixtures, so there is no quality mismatch to flag.
- **Escalation-delay tracking**: no rabbit holes; the longest same-error run was two calls (the integration test's type error).
- **Feedback-loop gap analysis**: `check` ran after every step that changed a shared type.
  The only late `check` was step 6's new test file, which no type change triggered, and it still ran before that step's commit.

### Changes made

1. None beyond this retro entry; the operator chose to land the retro file only.
   Considered and not landed: a `.pi/skills/testing/SKILL.md` TDD-planning line about putting a consumer-level pin in the step that changes the output it asserts (one occurrence, no rework).
