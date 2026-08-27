---
issue: 610
issue_title: "pi-permission-system: make UI prompt decisions correlatable in the serving session"
---

# Retro: #610 — make UI prompt decisions correlatable in the serving session

## Stage: Planning (2026-08-18T14:30:40Z)

### Session summary

Planned Phase 13 Step 10: the serving session emits a parent-side `permissions:decision` for every forwarded request it escalates, reusing the `requestId` its own `permissions:ui_prompt` carried, and the fail-closed `tool_call` boundary emits a `gate_error` terminal decision ([#753], folded in per the roadmap).
The plan is at `packages/pi-permission-system/docs/plans/0610-cross-session-decision-correlation.md`: four steps, one `refactor:` prep, two `feat:` cycles, one `docs:` commit.
Filed [#772] for a pre-existing mis-attribution the design ran into.

### Observations

- **[#752] already supplied everything the issue asked for except the emit.**
  `ForwardedPermissionRequest.id` *is* the child's minted request id, `buildForwardedAskDetails` puts it on `details.requestId`, and `buildUiPrompt` copies it onto the broadcast.
  So the issue's items 1 and 3 (add `requestId` to the decision event, reuse the prompt's id) were already satisfied or trivial; the whole change is item 2 plus one contract field.
- **The emit-site choice came down to which site sees an escalation that throws.**
  Three candidates held `details` and the decision: `ForwardedRequestServer`, `LocalUserAuthorizer`, and `PermissionPrompter`.
  The authorizer would pair the two events structurally (same object, same input), but the server's existing `catch` is the only place that sees a dialog failure *after* the `ui_prompt` went out — the exact permanent-blocked bug at a rarer site.
  The operator chose the server with the broad scope (every escalated request), which also removes the need to inspect `decidedBy` to decide whether to emit.
- **`PromptRequestFacts.surface` and `value` are non-nullable, which removed a sentinel from the design.**
  `PermissionDecisionEvent.surface`/`value` are `string` while the prompt's are `string | null`, so a version-skew forwarded request needed a fallback.
  The payload's own request facts supply it, so no `"<unknown>"` sentinel and no widening of the published field types.
- **`deriveResolution` was deliberately not reused.**
  It maps a gate *outcome* (check state + gate action + three collected flags); the server holds the `PermissionPromptDecision` itself.
  Reusing it would mean an `authority/` → `handlers/gates/` import for a five-parameter call whose first two arguments are constants.
  A five-line local mapping that reads the decider's own stamp won.
- **The mapping exposed a pre-existing defect rather than introducing one.**
  An `authorizerChain` link's verdict is already broadcast as `user_approved` / `user_denied` on the local path, because `GateRunner` never reads `decidedBy`.
  Filed as [#772] instead of folded in: fixing it changes the resolution an existing local decision reports, so it is a contract change while this issue is purely additive.
- **`index.ts` builds `GateDecisionReporter` ~90 lines *after* `ForwardedRequestServer`.**
  The new `broadcaster` dep needs it earlier, so the construction hoist rides the `refactor:` prep step rather than surfacing mid-`feat:`.
- **Scope check on the labels.**
  The issue carries both `pkg:pi-permission-system` and `pkg:pi-subagents`, but nothing in pi-subagents changes — the label reflects the reported scenario, not the diff — so this is a single-package plan.

## Stage: Implementation — TDD (2026-08-18T18:41:27Z)

### Session summary

Landed the plan's four steps plus one tidy-first prep commit: `escalateAsk` extracted, `DecisionBroadcaster` split out of `DecisionReporter`, the fail-closed boundary's `gate_error` broadcast ([#753]), and the serving session's terminal decision for a forwarded ask (this issue).
Test count went 3162 → 3173 (+11: eight served-decision cases, three boundary cases).
Pre-completion reviewer: **PASS**, no warnings.

### Observations

- **The tidy-first assessor's one recommendation was the right one and was accepted verbatim.**
  Hoisting `buildForwardedAskDetails` out of the escalation `try` and naming the fail-closed catch `escalateAsk` was a precondition for the design, not optional restructuring — the feature commit then added only the dep, the emit, and the two builders.
  It also declined to re-propose the `DecisionBroadcaster` split because the plan already scheduled it as its own commit, which is the correct read of the protocol.
- **A shared test fixture was producing a value its declared type forbids.**
  `makeServerDeps`'s default escalator resolved `{ approved: true, state: "approved" }` with no `decidedBy`, which `PermissionPromptDecision` requires; `vi.fn().mockResolvedValue(…)` is typed loosely enough that `tsc` never saw it.
  `servedResolution` reads `decision.decidedBy.kind`, so every test using the default would have thrown once the emit was wired.
  Fixed the fixture (with `satisfies PermissionPromptDecision`, so it cannot drift again) rather than making the production read defensive.
- **One new test passed during Red in each step, and both are pins rather than broken probes.**
  "still blocks when the broadcast itself throws" and "broadcasts nothing when recorded authority resolves the request" both assert an absence that was already true; each became load-bearing the moment the emit existed.
- **The exact-equality assertion is doing contract work, not style work.**
  The approval case asserts the whole emitted event with `toEqual` specifically so a later `decidedBy` (or any other field) leaking onto the bus fails a test — ADR 0011 §6 makes that the narrowest renderer, and a `toMatchObject` there would absorb the leak silently.
- **Three tests deviate upward from the plan.**
  The boundary gained a third case pinning the `value: command ?? toolName` fallback the plan specified but did not test; the server's nine planned cases landed as eight, with the "same projection as the prompt" assertion folded into the full-shape approval case rather than repeated.
- **`index.ts` needed the reporter hoisted ~90 lines**, exactly as planning predicted, and it rode the `refactor:` commit so the feature commit carried no unrelated motion.

## Stage: Final Retrospective (2026-08-18T19:05:36Z)

### Session summary

One continuous session carried this issue from `/plan-issue` through `/tdd-plan` to `/ship-issue`, releasing `pi-permission-system-v26.3.0` and closing both this issue and [#753].
Two `feat:` commits, two preparatory `refactor:` commits, and one `docs:` commit landed the serving session's terminal `permissions:decision` broadcast and the fail-closed boundary's; the test count went 3162 → 3173.
The pre-completion reviewer returned PASS with no warnings, and Phase 13's last open step is now complete.

### Observations

#### What went well

- **The `ask_user` gate turned on a scenario neither the issue nor the roadmap named.**
  The two candidate emit sites differed on exactly one case — a dialog that throws *after* `permissions:ui_prompt` is already broadcast — which surfaced only from reading `LocalUserAuthorizer.authorize` against `ForwardedRequestServer`'s existing `catch`.
  Presenting the four-row scenario table before the options is what made it a decision rather than a preference; the operator chose the broader site and that throw path is now a test.
- **The tidy-first assessor deduplicated against the plan instead of re-proposing.**
  It explicitly declined to re-recommend the `DecisionBroadcaster` split "because the plan already schedules it as TDD Order step 1", and instead found the one precondition the plan had folded into its feature step: hoisting `buildForwardedAskDetails` out of the `try`.
  Accepted verbatim, and it is why the feature commit carries no structural motion.
- **A shared fixture had been producing an invalid domain object, and reading it beat discovering it.**
  `makeServerDeps`'s default escalator resolved a `PermissionPromptDecision` with no `decidedBy` — a required field — because `vi.fn().mockResolvedValue(literal)` is assignable to the seam's signature without the literal ever being checked.
  `servedResolution` reads `decision.decidedBy.kind`, so every default-escalator test would have thrown at Green.
  Caught while writing the function and fixed with `satisfies PermissionPromptDecision`, so the fixture cannot drift again.
- **Planning's three concrete predictions all held**: the `index.ts` reporter hoist (~90 lines), `escalateAsk` as a precondition of the design, and the payload's non-nullable request facts standing in for a sentinel.
  Second consecutive issue in this package where measuring at plan time left nothing to renegotiate mid-implementation (see [#752]'s retro).

#### What caused friction (agent side)

- `instruction-violation` (self-identified) — wrote `echo ===` inside a chained bash command, which zsh's `equals` expansion aborts; the `sed` after it never ran.
  `AGENTS.md` § Shell and search forbids exactly this.
  Impact: one wasted tool call, re-issued separately, no rework.
- `instruction-violation` (self-identified) — added a `[#610]:` link definition to this retro for the doc's own issue number, which the `markdown-conventions` skill forbids.
  `rumdl` passes on it (a *used* definition is valid), so the convention is unenforced and a green lint gave false confidence.
  Impact: one extra `Edit`, caught before the commit.
- `other` — wrote a guessed issue number into the plan body before `gh issue create` assigned the real one, which came back four higher.
  Impact: a four-block `Edit` correcting two references and two link definitions; no rework beyond it.
- `other` — `git log --oneline 6` (missing the `-`) aborted with a fatal.
  Impact: one extra call.
- `instruction-violation` (self-identified, during the retro) — wrote `cd /Users/chris/development/pi/pi-permission-system 2>/dev/null || cd <correct>` as a fallback chain; the first path was missing the `packages/` prefix and the `external_directory` gate denied it.
  `AGENTS.md` forbids both halves of that construction: shell commands already run at the repo root, and a hand-built absolute path trips the gate instead of failing fast (Refs #726).
  Impact: one denied call, re-issued repo-relative with no `cd`.
  A fitting demonstration, given the package under change.
- `other` — the test helper added in the TDD stage, `serveAndCaptureDecisions`, wrapped arrange *and* act, hiding the `processInbox` call the `testing` skill says to keep explicit.
  It passed the pre-completion review and mirrored the file's pre-existing `escalateForwardedAsk`, so local precedent masked it.
  Impact: no rework at ship time; refactored during this retro at the operator's direction (see Changes made).
- `instruction-violation` (self-identified, after pushing) — committed this retro's two test-file fixes inside the `docs(retro):` commit.
  `docs:` is an unhidden changelog type and those files sit under `packages/pi-permission-system/` outside `exclude-paths`, so release-please opened PR #774 proposing a 26.3.1 whose tarball is byte-identical to 26.3.0 (`test/` is not in the `files` allowlist).
  A `test(pi-permission-system):` commit for the code plus the `docs(retro):` commit for the rest would have released nothing.
  Impact: an unmergeable-by-choice release PR left open to batch into the next real release; unfixable in place, since amending a pushed commit needs a force-push.
  Root cause is not purely recall: `.pi/prompts/retro.md` Step 9 instructs committing "any other touched files" as one `docs(retro):`, with no rule for a retro that touches package code.

#### What caused friction (user side)

- Nothing to flag.
  The operator's only intervention beyond the two `ask_user` selections was "Trying again." after `/tdd-plan` produced empty assistant turns — the correct minimal response to an environmental failure.

### Diagnostic details

- **Environmental** — `/tdd-plan` was invoked four times before it ran.
  The first three attempts (17:00, 17:12, 17:24 UTC) each produced four empty assistant messages with no tool calls; the fourth (18:23) ran normally to completion.
  About 83 minutes of wall clock with zero progress and no agent-side cause visible in the transcript; re-invoking the slash command was the resolution.
- **Model-performance correlation** — planning and TDD on `anthropic/claude-opus-5`, `/ship-issue` on `anthropic/claude-sonnet-5`, retro on opus-5; both subagents on `anthropic/claude-sonnet-5` per their frontmatter.
  The same split as [#752], and again no mismatch: the design decision and the TDD cycles got the stronger model, and the deterministic ship sequence ran cheaply without a misstep.
- **Escalation-delay tracking** — no `rabbit-hole` points; the longest same-error sequence was one call, both self-corrected on the next.
- **Unused-tool detection** — no `Explore` dispatch for the code hunt, correctly so: the issue's own comment supplied a file-and-line diagnosis, which `/plan-issue` says to verify inline rather than delegate.
  Every read went to a named file.
- **Feedback-loop gap analysis** — no gap.
  Scoped `vitest run <file>` after every Red and Green, `pnpm run check` after every Green, the full suite plus root `lint` before each commit, and `fallow dead-code` at both the baseline and the end.

### The unchecked mock literal, measured

The operator asked for evidence rather than an assertion, so the retro probed `tsc` directly with four forms of the same field-omitting literal:

| Form                                                        | `tsc` verdict |
| ----------------------------------------------------------- | ------------- |
| `vi.fn().mockResolvedValue({…})` — what the fixture shipped | no error      |
| the same literal + `satisfies PermissionPromptDecision`     | TS1360        |
| a plain `() => Promise.resolve({…})`                        | TS2322        |
| `vi.fn<AskEscalator["escalate"]>(() => …)`                  | TS2345        |

Only the bare-`vi.fn()` form is blind: with no type argument it is `Mock<(...args: any[]) => any>`, `.mockResolvedValue` does not narrow it, and `any` is assignable both ways — so the literal is only ever checked against `any`.
The fourth row is the `testing` skill's **existing** prescription, which means the fixture violated a rule already on the books rather than exposing a missing one.
That is why the skill gained an amended sentence rather than a new bullet.

The factory itself was measured too, since the operator questioned whether helpers like `makeServerDeps` earn their place.
Of 32 tests in the file, 11 never override `escalator`, and **none** depend on its default decision — the one that asserts an approval overrides `policy` to `allow`, so the escalator is never called.
Every test that cares about the decision supplies it, and adding the required `broadcaster` dep touched one line instead of 19 construction sites.
The defect was an unchecked default, not the factory; and it survived precisely *because* nothing read `decidedBy` until `servedResolution` did.

### Changes made

1. `.pi/skills/testing/SKILL.md` — amended the existing typed-stub bullet to name the silent failure mode: where `Mock<Procedure>` *is* assignable, the literal is checked against `any` and a required field goes missing until a test reads it.
   Chose amendment over a new `satisfies` bullet once the probe showed the existing rule already covers the case.
2. `AGENTS.md` (§ Commits) — extended the unreleased-version rule to unfiled issue numbers: file the follow-up first, then write back the number the API returned.
3. `packages/pi-permission-system/test/helpers/forwarding-fixtures.ts` — converted `makeServerDeps`'s default escalator from `vi.fn().mockResolvedValue(… satisfies …)` to the skill's typed form, `vi.fn<AskEscalator["escalate"]>(() => …)`.
   Verified non-vacuous: deleting `decidedBy` now fails `tsc` (TS2345) where it previously passed.
4. `packages/pi-permission-system/test/authority/forwarded-request-server.test.ts` — replaced `serveAndCaptureDecisions` with a describe-scoped `beforeEach` arrange plus an explicit `await server.processInbox(servingContext())` act in each of the eight tests.
   All 32 tests in the file still pass; the full package suite stays at 3173.
5. `.pi/prompts/retro.md` (Step 9) — added the rule to split `src/`/`test/` changes into their own `test:`/`refactor:` commit before the `docs(retro):` one, after this session's single bundled commit cut a needless patch release.
   Release-please PR #774 (26.3.1) is deliberately left unmerged to batch into the next real release.

[#752]: https://github.com/gotgenes/pi-packages/issues/752
[#753]: https://github.com/gotgenes/pi-packages/issues/753
[#772]: https://github.com/gotgenes/pi-packages/issues/772
