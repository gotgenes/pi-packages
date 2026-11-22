---
issue: 727
issue_title: "pi-permission-system: authorizerChain links are skipped for subagent requests, so configured authorizers never adjudicate them"
---

# Retro: #727 — authorizerChain links skipped for subagent requests

## Stage: Planning (2026-08-14T04:05:54Z)

### Session summary

Traced the reported defect through `authorizer-selection.ts`, `forwarded-request-server.ts`, and `pi-permission-model-judge`'s `typo-reviewer.ts`, then measured the operator's own 9167-record review log to separate the populations behind the 43 `authorizer_chain_unregistered_link` records.
Two of the issue's three claims did not survive: the serving node's chain does adjudicate a forwarded ask, and the missing `model_judge.decision` is a `pattern-miss` short-circuit that logs at debug level, not a link that never ran.
Produced a plan that settles the semantics (one chain per node, the relaying node delegates), fixes the false-alarm log, adds per-ask consultation records, and pins the parent-side invariant with an end-to-end regression test.

### Observations

- The measured log was decisive and cheap.
  A `node -e` scan gave 43 warnings against 1426 local asks, and a per-day breakdown split them into 15 correlated with `forwarded_permission.request_created` (the child-relay false alarm) and 23 on a single day with zero forwarding (a genuinely unregistered link).
  That split is the whole reason the fix suppresses the event only on a relaying node instead of deleting or downgrading it — a code-only reading would have gotten this wrong.
- `ask_user` answers drove the plan: parent-only semantics codified, one `authorizer_chain_delegated` record per ask, an `authorizer_chain_resolved` record naming consulted links, and [#699] endorsed in the ADR but implemented separately (PR [#702] is open against it).
- Rejected making `AuthorizerRegistry` process-global.
  It would double-adjudicate every deferring ask and let a link short-circuit before the serving node ever sees the request — a privilege change dressed as plumbing.
- `AuthorizerSelection` must not re-derive "is this a relaying node?" from `detection.isSubagent(ctx)`: `selectAuthorizer` tests `hasUI` first, so a subagent with UI decides locally.
  Hence `selectAuthorizer` returns a `SelectedAuthority` product rather than a bare terminal — the decision keeps one home.
- Confirmed the change is not breaking: `selectAuthorizer` and `TerminalAuthorizer` are absent from `dist/public.d.ts`; only `Authorizer`, `AuthorizerVerdict`, `AuthorizerLog`, and friends are public.
- Filed [#732] while reading `pi-permission-model-judge`'s `config-loader.ts`: its `defaultAgentDir()` hardcodes `~/.pi/agent` and ignores `PI_CODING_AGENT_DIR`, diverging from pi-permission-system's SDK `getAgentDir()`.
  That is one concrete way the "link configured but never registered" state arises, which is what the 2026-08-05 cluster looks like.
- Step 2 of the TDD order is a characterization test that is green on arrival.
  It is deliberate: the issue's core doubt is an invariant no test currently pins, because `forwarded-request-server.test.ts` injects a `{ escalate }` stub for the chain owner.

## Stage: Implementation — TDD (2026-08-14T04:30:39Z)

### Session summary

Executed the plan in eight commits: two preparatory tidy commits from the `tidy-first-assessor`, the plan's four TDD steps, the docs commit, and one reviewer-driven fixup.
`selectAuthorizer` now returns a `SelectedAuthority` value object, a relaying subagent node composes no chain links and records `authorizer_chain_delegated`, and an adjudicating node records `authorizer_chain_resolved` with the names it consulted.
Test count went 2757 → 2769 (+12) in pi-permission-system; `check`, root `lint`, `test`, and `fallow dead-code` are all green.

### Observations

- The `tidy-first-assessor` caught a real gap in the plan's step 1: the extraction list (`makeDeps`, `makeInvokingPrompter`, `register`) was not self-contained.
  `makePrompterApi` is a hard dependency of `makeAuthorizerSelectionDeps`'s own default and is called directly at four sites, and `makeDetection` was byte-identical in both test files.
  It also proposed a second commit — migrating `authorizer.test.ts` onto the shared fixtures *before* the return-type change — which kept the compile-breaking step 3 a pure `.terminal` edit with no fixture untangling folded in.
  Both landed; neither is in the plan's TDD Order, which is expected for tidy-first commits.
- Step 2's characterization test was green on arrival, as planned.
  Non-vacuity was measured, not argued: flipping `getAuthorizerChain` to `[]` made it fail with `denied_with_reason` missing, then the probe was reverted.
- The relaying-node tests deliberately use the recording prompter rather than the invoking one.
  Running the real `ParentAuthorizer` terminal would reach `resolvePermissionForwardingTarget`, which reads `process.env` and the filesystem; asserting `prompter.prompt` was called with `expect.any(ParentAuthorizer)` proves zero links were composed (with one link the composed value is an anonymous object) without any of that.
- One deviation from the plan's ordering: the `authorizer_chain_resolved` tests were drafted alongside the step 4 tests and then pulled back out so the delegation fix and the observability addition stayed separate commits.
- Pre-completion reviewer: WARN (1 non-blocking finding) — the extracted fixtures typed `prompt` as `ReturnType<typeof vi.fn>` rather than `Mock<Sig>`, a pre-existing pattern carried in verbatim.
  Fixed in `7d285aed` rather than deferred, since the file is new in this change and two test files now import it.

## Stage: Final Retrospective (2026-08-14T16:24:54Z)

### Session summary

Three stages — planning, TDD, ship — took a bug report whose headline claim was wrong and turned it into a settled design rule plus two observability records, shipped as `@gotgenes/pi-permission-system@25.2.0`.
Nine commits, +12 tests, one follow-up issue filed ([#732]), zero rework at the commit level.
The decisive move happened in the first ten minutes: measuring the operator's own 9167-record review log rather than reasoning from the code alone.

### Observations

#### What went well

- **Log-mining falsified the report, not just quantified it.**
  The package skill frames review-log mining as a way to size a proposed gate change's blast radius ([#694]).
  Here the same technique answered a *causal* question: a per-day breakdown split 43 `authorizer_chain_unregistered_link` records into 15 adjacent to a `forwarded_permission.request_created` (the child-relay false alarm) and 23 on one day with zero forwarding (a genuine unregistered link).
  That split is the entire reason the fix suppresses the event conditionally instead of deleting or downgrading it.
  A code-only reading would have produced a worse fix that still looked correct.
- **The `tidy-first-assessor` out-planned the plan.**
  It found the plan's extraction list under-specified (`makePrompterApi` is a hard dependency of the shared deps factory and is called directly at four sites; `makeDetection` was byte-identical in both files), and proposed a second commit the plan did not have — migrating `authorizer.test.ts` onto the shared fixtures *before* the return-type change.
  That kept the compile-breaking step a pure `.terminal` edit.
  This is the first session where the assessor's output materially improved the decomposition rather than confirming it.
- **The non-vacuity probe on a green-on-arrival test.**
  Step 2's characterization test passed the moment it was written, which is exactly when a test proves nothing.
  Flipping `getAuthorizerChain` to `[]` made it fail, then the probe was reverted — the `testing` skill's "build the probe to match the guard's exact predicate" rule applied to a characterization test, where it is arguably more necessary than on a guard.
- **The `ask_user` gate took four questions with no bounce.**
  The pre-ask message carried measured counts and a concrete before/after per option — the practice earlier retros asked for ([#635], [#678]) — and all four answers came back clean on the first attempt.

#### What caused friction (agent side)

- `instruction-violation` (reviewer-caught) — the extracted `test/helpers/authorizer-fixtures.ts` typed `prompt` as `ReturnType<typeof vi.fn>`.
  The `testing` skill was loaded at the start of the TDD stage and names this exact anti-pattern ("in Vitest v4 it expands to `Mock<Procedure | Constructable>`, a union that TypeScript cannot call").
  Loading the rule did not help, because the extraction was a *copy*: the violating text came from the source file, and nothing in the move re-read it as newly-authored code.
  Caught by the `pre-completion-reviewer`, not by me and not by the user.
  Impact: one extra `refactor:` commit (`7d285aed`) after the docs commit.
- `scope-drift` (self-identified) — drafted the step-5 `authorizer_chain_resolved` tests in the same `Edit` as the step-4 delegation tests, then had to remove them to keep the `fix:` and `feat:` commits separate.
  Impact: one wasted `Edit` cycle, caught before running tests; no commit churn.
- `other` — three separate compound commands surfaced as tool errors because a `grep` existence probe found nothing (the desired answer): the retro-file check, the ADR amendment-convention check, and the AGENTS.md-documented `grep -c 'lint/' /tmp/l.log` lint-warning count.
  Impact: a re-read each time to confirm the "error" was the healthy case; no rework.

#### What caused friction (user side)

- Nothing material.
  The only intervention was an accidental interrupt, immediately acknowledged.
- Opportunity, not friction: three open issues ([#699], [#726], and this one) plus one third-party PR ([#702]) all circle the same authorizer-observability surface.
  Shipping them one at a time means each re-establishes the same context.
  A single plan spanning the cluster — or an explicit decision to keep them independent — would be cheaper than the third independent ship.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `anthropic/claude-opus-5` (judgment-heavy: diagnosis, design, ADR amendment); ship ran on `anthropic/claude-sonnet-5` (mechanical, tool-driven — appropriate).
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `anthropic/claude-sonnet-5` per their frontmatter; both did judgment work and both produced findings the parent had missed.
  No mismatch found.
- **Escalation-delay tracking** — no `rabbit-hole` friction points; longest run on a single error was one tool call.
  Lens finds nothing.
- **Unused-tool detection** — `colgrep` went unused, correctly: every exploration target was a known exact symbol (`authorizerChain`, `registerAuthorizer`, `selectAuthorizer`).
  No `Explore` dispatch either — the report supplied named files and a numbered trace, which the `/plan-issue` prompt explicitly carves out as inline work ([#709]).
- **Feedback-loop gap analysis** — no gap.
  `vitest run <file>` ran after every red and every green; `pnpm run check` ran at each type-touching step; the full suite plus root `lint` ran before each commit; `fallow dead-code` ran at the baseline and again before push.

### Changes made

1. `.pi/skills/tidy-first/SKILL.md` — Step 3 gains a rule that an extraction carries the source's rule violations into a now-shared file, so moved code must be re-read against the governing skill before committing.
2. `.pi/skills/package-pi-permission-system/SKILL.md` — Debugging §6 widened: the review log answers diagnostic questions (counting an `event` per day and against an adjacent event's timestamps), not only blast-radius sizing over bash commands.

[#635]: https://github.com/gotgenes/pi-packages/issues/635
[#678]: https://github.com/gotgenes/pi-packages/issues/678
[#694]: https://github.com/gotgenes/pi-packages/issues/694
[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#702]: https://github.com/gotgenes/pi-packages/pull/702
[#709]: https://github.com/gotgenes/pi-packages/issues/709
[#726]: https://github.com/gotgenes/pi-packages/issues/726
[#732]: https://github.com/gotgenes/pi-packages/issues/732
