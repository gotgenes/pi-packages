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

## Stage: Final Retrospective (2026-08-30T06:34:16Z)

### Session summary

Landed the peer branch on `main` via `/ship-worktree 772` — ff-merge, push, green CI, issue close, a component-scoped release of `pi-permission-system` 28.0.0, and worktree teardown.
The ship carried no rework: the merge was a clean fast-forward, the release PR was unambiguous, and every gate passed first time.
It did expose a fail-open in `/ship-worktree`'s own Release coordination step, which cannot see the plan it is instructed to read.

### Observations

#### What went well

- **The component-scoped release path worked exactly as `AGENTS.md` describes it.**
  `release_pr_find` selected PR #845 by `component`, not position; the full body confirmed a single-package bump to 28.0.0 matching the `feat!:`; `release_pr_merge` rebased and returned the new HEAD with no manual wait loop.
  This is the first worktree ship to exercise `separate-pull-requests` end to end, and the parallel-worktree flow did not interact with it at all.
- **Anchoring the close comment on the plan commit rather than the package's last tag paid off immediately.**
  `git log --grep="docs: plan .*(#772)" -1` bounded the range to this issue's ten commits.
  The package's last tag was `v27.1.3`, several sibling issues back, so a tag range would have swept them into the summary — the hazard #817 recorded, observed live.

#### What caused friction (agent side)

- `other` — **`/ship-worktree`'s Release coordination step cannot find the plan it is told to read, and fails open.**
  The step runs deliberately *before* the ff-merge, and greps the working tree: `grep -rl "^issue: 772$" docs/plans packages/*/docs/plans`.
  On a worktree ship the plan lives on the unmerged peer branch, so the working tree never has it — the grep returned nothing, and the prompt's own rule for that outcome is "no plan → record 'release now'; do **not** ask".
  This issue's marker was `ship independently`, so the fail-open produced the right answer by luck; a `mid-batch — defer` plan would have been released anyway, silently, with no operator prompt.
  Recovered by reading the branch ref instead (`git show <branch>:<plan-path>`).
  Impact: five tool calls to locate a marker the step budgets one for, and a latent wrong release on any deferred worktree issue.
- `instruction-violation` (self-identified) — wrote `echo ===` as a separator inside an `A; B; C` chain, which `AGENTS.md` explicitly forbids (zsh's `equals` expansion reads `=word` as a command-path lookup).
  The chain aborted with `zsh:1: == not found` and discarded the two `git show` outputs after it.
  Impact: one wasted call, re-run with `echo ---`; no rework.
  The rule already exists and is correctly worded — this is a salience miss, not a documentation gap.
- `other` — set `PLAN=$(git log …)` in one `bash` call and read `"$PLAN"` in a later one, where the shell is fresh and the variable empty.
  `git log --oneline "$PLAN"^..HEAD` failed with `fatal: bad revision '^..HEAD'`.
  Impact: one wasted call; the answer came from grepping the retro file instead.
  Loud here, but the same mistake in a `grep` pattern or a path argument fails silently.

#### What caused friction (user side)

- The peer's `/sync-worktree` ran with an empty argument — its expanded body reads "Argument: `` is the issue number" and "run `/ship-worktree `" throughout.
  The peer recovered correctly in two calls by deriving the number from the branch name, so nothing was lost.
  Opportunity: the template already runs `git branch --show-current` as its first step, so a one-clause fallback there would make the argument optional rather than merely survivable.

### Diagnostic details

- **Model-performance correlation** — the entire `/ship-worktree` stage ran on `anthropic/claude-sonnet-5` and dispatched no subagent; this retrospective runs on `anthropic/claude-opus-5`.
  Verified from the peer transcript's tail: the TDD implementation turns ran on `claude-opus-5` and the sync stage on `claude-sonnet-5`.
  The planning stage's attribution was not sampled — `read_session_file` renders newest-first and the peer transcript is 1.5 MB, so the head was not read.
  No mismatch in what was verified: judgment-heavy implementation on the stronger model, mechanical ship and sync on the cheaper one.
- **Escalation-delay tracking** — no `rabbit-hole` friction.
  The longest same-goal run was five calls locating the plan, and it ended by changing approach (working tree → branch ref) rather than by repeating the failing query.
- **Feedback-loop gap analysis** — no code changed in this session.
  `pnpm run lint` and `pnpm fallow dead-code` ran in the peer session's `/sync-worktree` step 2, and CI re-verified the same tree on `main`; no gap.

### Changes made

1. `.pi/prompts/ship-worktree.md` — Release coordination now locates the plan on the **peer branch** (`git grep -l "^issue: $1$" "$BRANCH" -- 'docs/plans/*' 'packages/*/docs/plans/*'`, whose `<branch>:<path>` output feeds `git show` directly) instead of grepping a working tree that does not have it yet, and a plan that cannot be found is now reported rather than silently defaulted to "release now".
2. `AGENTS.md` — added a two-line rule to § Shell and search: each `bash` call runs in a fresh shell, so chain producer and consumer in one call or re-derive the value.
3. `.pi/prompts/sync-worktree.md` — an empty `$1` is now derived from the branch name (`issue-<N>-<slug>`) before the title fetch, so the template no longer depends on the operator passing the argument.
