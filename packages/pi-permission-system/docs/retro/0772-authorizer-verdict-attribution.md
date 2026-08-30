---
issue: 772
issue_title: "pi-permission-system: an authorizerChain link's verdict is broadcast as user_approved / user_denied"
---

# Retro: #772 — an authorizerChain link's verdict is broadcast as user_approved / user_denied

## Stage: Planning (2026-08-30T05:14:37Z)

### Session summary

Traced the mis-attribution to three sites that re-derive the decider from booleans instead of reading the `decidedBy` stamp #726 added: `deriveResolution` (`src/handlers/gates/helpers.ts`), `servedResolution` (`src/authority/forwarded-request-server.ts`), and the `confirmationUnavailable` branch in `applyPermissionGate` that picks the agent-facing denial text.
Measured the real blast radius against the local review log rather than arguing it, put the scope, semver, and naming to the operator, ran the Tidy-First assessor, filed the deferred half as issue #844 (adopted as Phase 14 Step 15), and wrote a five-step plan.

### Observations

- **The measurement reframed the issue.**
  The issue and the roadmap step both describe the `authorizerChain` case.
  Counting `decidedBy` kinds across the 12,281-line review log found 13 authorizer-decided entries — and 68 terminal `forwarded` entries, 57 of them decided by a **rule in the parent session** and broadcast as `user_approved`.
  The same defect one hop away is five times the population, and it was invisible from the issue body.
  Worth repeating on any attribution issue: count the log before scoping.
- **Scope, semver, and naming went to one gate.**
  Operator chose the widest scope (bus event, agent-facing text, and the forwarded unwrap), `feat!:` with a `BREAKING CHANGE:` footer, and the issue's own `authorizer_allowed` / `authorizer_denied` spelling (matching `AuthorizerVerdict`'s `allow | deny`, not `user_approved`'s consent verb).
- **Two arms were deliberately left out, and the reason is structural.**
  A forwarded denial the parent's *rule* decided cannot be rendered honestly from the child's payload: `PromptPayload.request.matchedPattern` is the pattern that raised the **child's** ask, not the parent's deny rule, and the parent's pattern and origin live only on the response's `decidedBy`.
  Whether those may reach the requesting agent is an ADR 0011 §6 disclosure decision, so it is issue #844 rather than a formatting tweak folded in here.
  The `gate_error` arm went with it: both are forwarding-only and have zero occurrences in the log.
- **The bus half unwraps `forwarded`; the text half does not.**
  That asymmetry is deliberate (the bus carries no pattern, so it raises no disclosure question) but it is the plan's least obvious decision, and #844's body records the disagreement it leaves behind.
- **`decision.autoApproved` turned out to be dead.**
  No code in `src/` ever sets it — yolo short-circuits ahead of escalation (#712/#526) — and it is not on the forwarded wire.
  Only test doubles produce it, which is why three tests assert a resolution no production path can reach.
  Its removal became step 3 rather than a follow-up, since this change is what makes it unreferenced.
- **A contradictory fixture was pinning nothing.**
  `test/permission-gate.test.ts`'s unavailable decision pairs `confirmationUnavailable: true` with `decidedBy: DECIDED_BY_HUMAN`.
  Harmless while dispatch reads the boolean; under the planned dispatch it would select the *user* render inside a test named for the unavailable one.
  The Tidy-First assessor found the same class in `runner.test.ts` independently, and the correction leads the plan as step 1.
- **`fallow dead-code` constrains the step order.**
  `unused-exports` is an `error`, so the assessor's recommended standalone fixture commit (`DECIDED_BY_AUTHORIZER`) and the new `resolutionFor`/`effectiveDecider` exports cannot land a commit ahead of their first consumer.
  Accepted the recommendation but merged it into the step that consumes it, and said so in the plan.
- **Design shape:** one exported `resolutionFor(decidedBy, outcome)` with a `never`-exhaustive switch replaces two parallel derivations, so a `DecisionSource` variant added later is a compile error at both sites instead of a silent `user_approved`.
  `forSession` stays an outcome bit the caller supplies — `{ kind: "user", via }` records no scope.

#### Deferred tidyings

- `test/handlers/gates/runner.test.ts` — 11 `escalate: vi.fn()` override sites mix the untyped and typed (`vi.fn<AskEscalator["escalate"]>()`) forms; the typed form would have caught the missing-`decidedBy` fixture gap at compile time.
  Converting only the 5 this change touches is inconsistent, and converting all 11 is unrelated friction.
  Assessor marked it Optional; left for a craftsmanship pass.
- `src/handlers/gates/runner.ts` — `runDescriptor`'s six numbered phases in one ~130-line method (the craftsmanship scout's Phase 14 finding, and the tidy-first prep Step 2 dropped).
  The assessor rejected splitting it here too: this change's edits are narrow and none is blocked by the single-method shape, so extraction would be churn with no friction driving it.

## Stage: Implementation — TDD (2026-08-30T05:58:20Z)

### Session summary

Six commits over the plan's five steps: the fixture sweep, the `feat!:` mapping, the `autoApproved` removal, the `fix:` denial render, the doc updates, and a sixth `test:` commit closing the pre-completion reviewer's two WARN findings.
The package suite went from 151 files / 3752 passing to 152 / 3787 — one new file (`test/authority/decision-resolution.test.ts`) and +35 tests.
Pre-completion reviewer: WARN on the first round, PASS on the scoped re-review of the follow-up commit.

### Observations

- **The plan's closure capture does not compile, and the fix was better than the plan.**
  `runDescriptor` was to capture the escalated decision in a `let` and read `decidedBy` off it; TypeScript narrows such a variable to its `null` initializer, because the assignment inside the `promptForApproval` callback is invisible to control-flow analysis (the `code-design` skill's "closure narrowing loop", in a new form).
  Every dodge available — a cast, a holder object, `?? fallback` on a value TS believes is always `null` — is the lie that skill warns against.
  The structural answer was to widen `PermissionGateResult` with the `decidedBy` of whatever answered: the gate is the one place that knows whether recorded authority or an escalation decided, so it reports that and the runner keeps no capture at all.
  The reviewer independently judged this sound rather than scope overreach.
  Worth generalizing: a plan that says "capture X in the callback and read it after" should be checked against `tsc` at planning time, not at Green.
- **Step 1's sweep list was derived from a grep and was incomplete.**
  Two more fixtures of the same class — `test/handlers/tool-call.test.ts` and `test/helpers/external-directory-fixtures.ts` — surfaced only as red once `resolutionFor` began reading `decidedBy` in step 2, so they were fixed inside the behavior commit, which is exactly what step 1 existed to prevent.
  The plan built its list by grepping `confirmationUnavailable`/`autoApproved` in the files it already expected to touch; the reliable query is "every `escalate`/`promptForApproval` mock whose decision has no `decidedBy`, or whose `decidedBy` contradicts its own markers", across the whole `test/` tree.
  A short Python scan over `mockResolvedValue({...})` blocks found both in seconds and should have run at planning time.
- **The reviewer found two more of the same class that no red would ever have caught.**
  `permission-prompter.test.ts` and `authorizer-chain.test.ts` still paired `confirmationUnavailable: true` with a `user` decider; neither routes through the new dispatch, so both stayed green and dormant.
  Closed them in the sixth commit — a contradictory fixture is a latent broken probe, and the whole change is about that contradiction.
- **Mutation testing paid for itself twice.**
  Five mutations were applied across steps 2 and 4, and each killed exactly its predicted equivalence class and no more — including the `unavailable` arm's, which took a cross-boundary forwarding-liveness test red and confirmed the #719 invariant is genuinely pinned.
  The sixth commit's new `effectiveDecider` case was likewise proven non-vacuous by a branch-isolated mutation; a cruder mutation of the same line kills three tests and would have proven nothing about the new one.
- **The measurement in the plan held up exactly.**
  13 authorizer-decided entries and 57 forwarded rule-decided allows in the local review log, and nothing in implementation contradicted either number.
  Counting the log before scoping is what turned a one-branch fix into the total mapping.
- **An exact-string assertion caught my own error.**
  The hand-written expected render for `renderAuthorizerDenial` omitted the `(rule '*')` clause — I transcribed it from the issue's log excerpt and dropped a fragment.
  A `toContain` would have passed.
- **`autoApproved` was dead on arrival and nobody had noticed.**
  Declared, documented, threaded through `deriveResolution`'s signature, asserted by three tests — and never once set by `src/`.
  The tests kept a mechanism alive that production could not reach, which is the failure mode a test-double-only producer always risks.

## Stage: Sync (worktree) (2026-08-30T06:15:11Z)

### Session summary

Pre-push checks pass clean from the worktree root: `pnpm run lint` (1063 files, no issues) and `pnpm fallow dead-code` (325 entry points, no issues) — no fixes needed.
The plan's `**Release:**` marker is `ship independently`; nothing defers, and the change is `feat!:` (breaking) per the plan's Goals.
The follow-up filed during planning, [#844], is open and adopted as Phase 14 Step 15 — no action needed here.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-772--/2026-08-30T04-13-13-175Z_01a050df-1857-7ffe-bf47-a627230d04db.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.
This single session file covers planning, TDD implementation, and this sync stage.

### Observations

Nothing new beyond the implementation stage's notes above — this stage is pre-push verification and handoff only.
