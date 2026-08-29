---
issue: 830
issue_title: "pi-subagents: SubagentRecord's allowlist has no stated policy; decide what the public snapshot exposes"
---

# Retro: #830 — SubagentRecord's allowlist has no stated policy

## Stage: Planning (2026-08-29T19:33:31Z)

### Session summary

Planned Phase 22 Step 2: a written admission policy for the public `SubagentRecord` snapshot, recorded as package ADR 0005, plus the field dispositions that follow from it.
The operator chose the "discrete-query answer" policy (admit identity, resolved spawn facts, cumulative metrics, and durable-artifact pointers; decline momentary activity and internal bookkeeping), declared the type producer-only with required additions, and folded the `lifetimeUsage` aliasing fix into this change.
The plan is committed at `packages/pi-subagents/docs/plans/0830-subagent-record-admission-policy.md` with six TDD steps.

### Observations

- **The record has no in-repo consumer.**
  A grep for `SubagentRecord` outside `service-adapter.ts` and its tests returns nothing — the widget reads live `Subagent` objects through `manager.listAgents()`.
  So this was a judgment about external consumers, not a response to local demand, and the no-vacant-hooks reading ("admit nothing without a named reader") was a serious candidate rather than a straw option.
- **A defect surfaced while reading for the policy.**
  `toSubagentRecord` assigns `lifetimeUsage` by reference to the object `SubagentState.addUsage()` mutates in place, so the "serializable snapshot" drifts under a consumer and lets a consumer write into a running agent's token totals.
  Defining "snapshot" as *by value* in the policy is what made the fix in-scope rather than a separate issue; the operator chose to land it here.
- **The contract direction decided the release marker, not the field list.**
  TypeScript structural typing means required additions break only *implementors*, so declaring the type producer-only makes this semver-minor.
  The roadmap anticipated exactly this (`"if its resolution is non-breaking, its plan may downgrade it to independently releasable and update this line"`), so the plan takes the downgrade and edits both the Step's `Release:` line and the `Release batches` bullet; Step 3 ([#829]) stays the batch tail.
- **Alternatives rejected at the gate:** the "mirror all serializable state" policy (would ship an unbounded `responseText` and internal `consumedAt`/`stoppedWhileQueued`), optional-forever additions (consumers null-checking fields the package always populates), and shipping the widening as breaking anyway.
  Also rejected in the plan: retyping `SubagentRecord.lifetimeUsage` as `Readonly<>` — once the value is copied, tightening a shipped public property type buys nothing and costs a breaking change.
- **Declining `activeTools`/`responseText` leaves external consumers with no live-activity path**, because no broadcast channel carries them either.
  The ADR records the revisit condition (a named consumer plus a channel for momentary state) rather than building the channel, and [#748]'s close comment should carry that reasoning back to its author.
- **Tidy-First assessment** found the production side already shaped for the change and one real friction: five accreted "strips" `it` blocks in `describe("toSubagentRecord")` re-assert overlapping subsets of the same properties, and roughly six new tests are about to join that block.
  Consolidation is Step 1 of the TDD Order.
  The assessor also independently confirmed the `lifetimeUsage` aliasing bug and all four admitted getters, and reported no contradiction with the design.

#### Deferred tidyings

- `packages/pi-subagents/test/service/service-adapter.test.ts` — a shared "expected record" builder for the two exact `toEqual` blocks was rejected: the two literals share structure but no values, so the builder would be the wrong abstraction.
- `packages/pi-subagents/src/service/service-adapter.ts` — collapsing the per-field `if (x !== undefined)` lines into a loop over an optional-field list was rejected: the explicitness *is* the allowlist's self-documentation.
- `packages/pi-subagents/test/helpers/make-subagent.ts` — an `outputFile` shorthand on `createTestSubagent` was rejected as feature-scoped rather than preparatory; the implementing step decides whether its tests want one.

## Stage: Implementation — TDD (2026-08-29T20:56:08Z)

### Session summary

Executed all six planned steps in order: the Tidy-First test consolidation, ADR 0005, the four admitted fields, the declined-field pin, the `lifetimeUsage` copy, and the doc/roadmap updates.
`test/service/service-adapter.test.ts` went 30 → 32 tests (five overlapping strip tests collapsed into one, seven new), and the package suite went 1264 → 1266 with every gate green (`check`, root `lint`, `test`, `fallow dead-code`, `verify:public-types`).
Pre-completion reviewer: PASS, with all four re-derivation mandates independently confirmed.

### Observations

- **No deviations from the plan.**
  Every file in the plan's Module-Level Changes table was touched and nothing extra; `test/helpers/make-subagent.ts` already carried options for all eight candidate fields, so the fixture change the plan flagged as "not forced" was indeed not needed.
- **`git checkout -- <file>` reverted uncommitted work during mutation testing.**
  Step 3's mutations were run before the green edit was committed, so the first `git checkout --` revert wiped the implementation itself, and two mutations then ran against pre-feature code — producing five reds that looked like over-broad kills.
  The tell was that a mutation to `isBackground` reddened the `turnCount` test.
  Redone with a `cp`-saved copy of the green file; each of the four mutations then killed exactly its own class.
  Mutation testing on uncommitted work needs a file copy, not a git revert.
- **The declined-field pin can only be killed by an interface change.**
  TypeScript's excess-property check rejects any narrower leak into `toSubagentRecord`'s `SubagentRecord`-typed literal, so the killing mutation had to add `activeTools` to the interface *and* populate it — exactly [#748]'s diff.
  The test's populated-source assertions (`expect(record.responseText).toBe("partial answer")` and friends) are what keep it from passing vacuously if a fixture ever stops seeding those fields.
- **The `lifetimeUsage` drift test needed the real accumulation path.**
  `Subagent` exposes no `addUsage` (accumulation runs through the private `SubagentState` from `record-observer`), so the test constructs a `SubagentState` and a `Subagent` directly rather than casting away the getter's `Readonly`.
  That also made the test read as the production scenario: snapshot taken, then the agent keeps accumulating.
- **The contract direction, not the field list, decided the release.**
  Confirming that the repo has exactly one `SubagentRecord` producer and one `SubagentsService` implementor is what made the `feat:` classification defensible, and it is what moved Phase 22 Step 2 out of batch `"front-door-majors"` (tail stays Step 3, [#829]).

## Stage: Ship (worktree) (2026-08-29T21:16:18Z)

### Session summary

Pre-push checks passed clean on the first run: `pnpm run lint` (root) and `pnpm fallow dead-code` both reported no issues, so no fixup commit was needed before rebasing.
The plan's `**Release:** ship independently` marker holds — the `feat:`/`fix:` commits release on their own, not batched with Phase 22's other steps.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-830--/2026-08-29T19-18-15-903Z_01a04ef5-545f-79df-82fc-cda8d184c648.jsonl` — read with `read_session_file({ path: "..." })` for message-level verification at land/retro time.

### Observations

No deferred work and no new follow-ups surfaced at ship time; the plan's Open Questions section already declined to file one (lifecycle event-payload stability), and that stands.
Ready to rebase onto `origin/main` and hand off to `/land-worktree 830`.

## Stage: Final Retrospective (2026-08-29T21:29:30Z)

### Session summary

Four stages across two sessions (peer worktree: planning + TDD + ship; root: land + retro) turned an undocumented allowlist into a written policy plus the four field admissions and one aliasing fix that follow from it.
Shipped as `pi-subagents-v20.1.0` — six commits, `service-adapter.test.ts` 30 → 32 tests, package suite 1264 → 1266, all gates green at every checkpoint.
The land ran end to end without an intervention: ff-merge, CI, `issue_close`, release-PR merge, teardown.

### Observations

#### What went well

- **The clarification gate followed `AGENTS.md` § Clarification gates to the letter and settled in one pass.**
  The planning turn opened with a `**Terms used below**` block defining *allowlist*, *producer-only type*, and *reactive vs discrete* (the Refs #786 rule), then gave an eight-row candidate inventory table, then three defensible policies each priced by what it admits and what it costs.
  It also named the premise every option shared — that the record's contents are decided per field — and replaced it with a stated rule.
  No bounce, no second gate.
- **The declined-field pin has exactly one killing mutation, and it is a third party's diff.**
  TypeScript's excess-property check rejects any narrower leak into `toSubagentRecord`'s `SubagentRecord`-typed literal, so mutation E had to widen the interface *and* populate it — reproducing [#748]'s change.
  A test whose only kill is the proposal it declines is a stronger pin than an assertion list, and it is the shape to reach for whenever a step's deliverable is a *refusal*.
- **Reading for a policy found a defect the policy then made in-scope.**
  `toSubagentRecord` aliased `lifetimeUsage` to the object `SubagentState.addUsage()` mutates in place.
  Defining "snapshot" as *by value* in ADR 0005 is what made the fix belong in this change rather than a follow-up issue — the decision framed the bug, not the reverse.

#### What caused friction (agent side)

- `other` — **`/tdd-plan`'s prescribed mutation-revert is unsafe at the point it prescribes it.**
  Step 3 ("Verify the pins") sits *before* step 4 ("Commit"), so the green edit is always uncommitted when the mutation is applied — yet the prompt names `git checkout -- <file>` as the primary revert, with "(or a saved copy)" parenthetical.
  The revert wiped the step's own implementation, and mutations B and C then ran against pre-feature code, producing five reds that read as over-broad kills.
  The tell was that a mutation to `isBackground` reddened the `turnCount` test.
  Impact: self-caught after 3 tool calls; the green edit was re-applied and all four mutations redone against a `cp`-saved copy.
  No rework in committed history, ~5 extra tool calls.
- `instruction-violation` (not self-identified) — **`/plan-issue` names the `colgrep` and `testing` skills as loads; the planning session loaded neither.**
  It read `package-pi-subagents`, `code-design`, `design-review`, `markdown-conventions`, and `tidy-first`, then ran six exact-symbol greps for `SubagentRecord`/`getRecord`/`listAgents`.
  Impact: none observable — consumer discovery by exact symbol is what the `colgrep` skill's decision table routes to `grep` anyway, and the `testing` skill was loaded at the TDD stage where it was used.
- `other` — **the issue close comment anchored "Implemented in" on the range's last commit rather than the behavior commit.**
  `df6132c1` is the `docs:` commit; `ad598497` carries the feature.
  Impact: cosmetic — the bullet list directly below names both correctly.

#### What caused friction (user side)

None.
The operator's single decision (policy 3 plus the producer-only contract direction and the folded-in `lifetimeUsage` fix) determined the field list, the release classification, and the roadmap batch downgrade in one answer, and nothing after it needed a correction.

### Diagnostic details

- **Model-performance correlation** — planning, TDD, land, and this retro ran on `anthropic/claude-opus-5`; the `/ship-worktree` stage ran on `anthropic/claude-sonnet-5`, and both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) on `anthropic/claude-sonnet-5` per their frontmatter.
  No mismatch: the ship stage is mechanical (two gates, one breadcrumb, one no-op rebase) and finished in 14 turns, while the two judgment-heavy dispatches got sonnet-5 rather than haiku.
- **Escalation-delay tracking** — the mutation-revert incident resolved in 3 consecutive tool calls, under the 5-call escalation threshold; no other repeated-error sequence occurred.
- **Feedback-loop gap analysis** — no gap.
  The TDD session verified a green baseline before step 1 (`check`, root `lint`, `test`, `fallow dead-code`), ran the affected test file at every red and green, and ran `pnpm run check` immediately after each interface-touching green rather than only at end of cycle.

### Changes made

1. `.pi/prompts/tdd-plan.md` — step 3 ("Verify the pins") now prescribes a `cp`-saved copy as the mutation revert and names `git checkout -- <file>` as the trap it is at that point in the cycle.
2. `.pi/prompts/land-worktree.md` — the close-comment spec now says the "Implemented in" SHA is the commit carrying the behavior, not the range's last commit.
3. `.pi/prompts/ship-issue.md` — same clarification on its equivalent line, so the trunk and worktree ship flows agree.

[#748]: https://github.com/gotgenes/pi-packages/pull/748
[#829]: https://github.com/gotgenes/pi-packages/issues/829
