---
issue: 858
issue_title: "pi-subagents: child-initiated mid-run channel so a blocked child can ask without terminating"
---

# Retro: #858 — Child-to-parent tool channel

## Stage: Planning (2026-09-03T04:25:11Z)

### Session summary

Planned Phase 22 Step 11.
The issue asked for a blocking mid-run channel; the plan that came out drops the blocking half as redundant with [#465], adds a one-way `notify_parent`, and replaces the `<question-for-parent>` text marker with an `ask_parent` tool — a net deletion of 406 lines of parser and parser tests.
Committed `docs/plans/0858-child-to-parent-tool-channel.md` (8 TDD steps), filed [#871] and recorded it as Phase 22 Step 13 by operator decision.

### Observations

- **The issue's own author had deferred it** ("I would not build this until #465 has shipped and the end-and-resume loop has been used enough to show where it actually falls short").
  [#465] has since shipped, so the deferral was satisfied — but reading it as a live constraint is what made the first design question "does the blocking ask still earn itself?"
  rather than "how do we build it?".
- **Three of the issue's own premises did not survive checking.**
  The workspace motivation was closed by [#857]; the retention motivation turned out to be a bug in `sweep()`'s two-way branch rather than a missing channel; and the claim that a new child tool is invisible "to every agent that declares one" understates it — `BUILTIN_TOOL_NAMES` is *also* an explicit allowlist, so no child anywhere receives a new extension tool without an agent-file edit.
- **The operator reversed my recommendation twice, and was right both times.**
  I recommended the blocking ask, then had to withdraw it when the operator asked whether the update belonged in a consumer package: pricing that question surfaced that the blocking half duplicates the end-and-resume loop while the one-way update has no counterpart.
  Then the operator asked whether `question-for-parent` was "a tool masquerading in a protocol trenchcoat" — which is exactly what it is, and reframing it that way dissolved the charter problem rather than escalating it.
- **The charter collision was found late and nearly shipped silently.**
  `README.md` and the architecture scope table forbid "widening a child's tool allowlist on the agent's behalf", [#612] was closed on it by the maintainer, [#768] by its own author, and [#775]'s evidence file names it an open gap and predicts it will be "the single most likely place a charter sentence will be tested next."
  I only found it while enumerating doc touch points, three gates after the design had settled on force-inclusion.
  A scope-and-non-goals grep belongs earlier — before the first design gate, not during Module-Level Changes.
- **The carrier-swap framing is what makes the amendment defensible.**
  The core already installs protocol in every child unconditionally (`<active_agent>`, `parentContext`, and [#465]'s own marker block), so changing the carrier grants no capability.
  [#612]'s two concrete failure modes — write-capable built-ins leaking in, `subagent` re-admitted — are both untouched.
- **Every external fact in the plan was verified against the real surface, and one was wrong.**
  `customTools` was confirmed present in `dist/core/sdk.d.ts` at the declared peer floor `>=0.81.0` (fetched from the registry) and at the installed `0.84.4`, and the allowlist filter over `customTools` was confirmed in the compiled `agent-session.js` at both.
  My first reading took the installed version to be `0.79.1`; that was a different package's entry in the pnpm store, and the assessor's `0.84.4` was correct.
- **`Agent.steer()` was traced in Pi's own source** rather than assumed: it enqueues into `steeringQueue`, drained between turns, so a blocking child tool would have blocked its own reply.
  That fact eliminated one of three candidate designs.
- **A fail-open was found next door and filed rather than folded.**
  `tools: none` resolves to all seven built-ins including `edit`, `write`, and `bash`, because `getToolNamesForType` uses `?.length` where it needs to distinguish absent from empty.
  Confirmed with a disposable spike test rather than by reading, then filed as [#871]; the operator adopted it as Step 13 rather than the deferral I recommended.

#### Deferred tidyings

- `src/lifecycle/subagent-manager.ts` — the assessor declined to propose migrating the seven `(manager as any).sweep()` integration reaches onto the extracted pure function; only the new branch gets a unit test.
  The existing reaches stay as they are, matching the scout inventory's standing note.
- `src/observation/subagent-events-observer.ts` — the inline `{id, type, description}` payload triad gains a fourth instance with `subagents:update`.
  Pre-existing scattered duplication on the boy-scout path; not introduced by this change and not extracted by it.

#### Tidy-First assessment

Dispatched twice — the second time because the design changed materially after the operator's trenchcoat question, and a stale assessment can only contradict the plan it was meant to shape.
The second pass returned no new Recommended items, confirmed the two I had already planned (ordered announcement queue; retention-window extraction), and supplied three corrections that reached the plan: `index.ts` needs no change because `customTools` rides its `...rest` spread; `buildPromptHeader`'s `activeAgentTag` already ends in `\n\n`, so deleting the block naively leaves a stray blank line; and the 15-test migration in `subagent.test.ts` cannot be front-loaded as prep because it is not landable green against today's parse-based code.
It also established that **no** existing test pins multi-record nudge flush order, which turned step 5 from "behavior-preserving refactor" into "refactor plus the coverage it rests on".

## Stage: Implementation — TDD (2026-09-03T15:36:41Z)

### Session summary

Executed all 8 TDD steps plus three follow-ups — 11 commits.
The suite went from 75 files / 1476 tests to 76 files / 1508 tests (+32), which nets a 406-line deletion of `ask-back.ts` and its 24 parser tests against the new tools, queue, and channel coverage.
Two pre-completion review rounds: WARN (2 non-blocking findings), then PASS on the scoped delta.
Filed [#872] and recorded it as Phase 22 Step 14.

### Observations

#### Deviations from the plan

- **The `PendingAnnouncement` union could not land in step 5.**
  The plan had step 5 introduce the discriminated union and step 6 add its second variant, but a single-variant union makes `entry.kind === "completion"` vacuously true and `@typescript-eslint/no-unnecessary-condition` rejected it — caught by the pre-commit hook, not by me.
  Step 5 landed the ordered `Subagent[]` the tests actually pin, and step 6 introduced the union with its second kind.
  The plan's sequencing instinct was right; only the type's arrival point was wrong.
- **`RetentionCandidate` gained `pendingQuestion` in step 2, not step 1.**
  The plan's Design Overview sketches the end state with all four fields; carrying the fourth through step 1 would have been a vacant field for one commit.
- **The setter for `midRunUpdates` was written and then removed.**
  `fallow dead-code` flagged it along with the getter and the toggle.
  The getter and toggle reach their consumers through the `SubagentsSettingsManager` structural interface and `RunConfig`, which fallow cannot trace — but the setter had no consumer at all, in `src/` or `test/`.
  Rather than suppress all three, I deleted the setter and wrote real `SettingsManager` tests for the getter and toggle, which cleared the finding without a single suppression.
  The parallel `abortAllOnInterrupt` setter survives only because one UI test assigns it.
- **`test/observation/composite-subagent-observer.test.ts` was listed in Module-Level Changes and initially missed.**
  Caught by the end-of-cycle cross-check rather than by the reviewer.
  `onSubagentUpdate` is the observer interface's first optional member, so "a delegate that does not implement it" is a case the other five methods never exercise — exactly the kind of hole the plan's file list exists to prevent.

#### Mutation testing

Every step's predicted killing mutations behaved as the plan said, with two informative details:

- **Step 4's recorder-no-op mutation killed 11 tests**, spanning the migrated ask-back block *and* [#857]'s workspace-hold block.
  That breadth is the evidence step 4 needed: before the migration those tests drew their question from marker text and would have stayed green.
- **Step 3's three mutations killed three disjoint sets** — the allowlist assertions, the `Subagent` supply, and the tool's own callback — while `customTools` stayed green under the allowlist mutation.
  That separation is the point: the SDK drops a `customTools` entry whose name is missing from `tools` with no error, so a test that conflated the two halves would have shipped an invisible tool.

The renderer tests added after the review had no Red step, so I mutated them explicitly; both discriminated.

#### The scripted bulk edit

Adding `midRunUpdates` to the settings snapshot touched 18 assertion sites in `settings.test.ts`.
The regex was scoped to lines carrying both `unconsumedSessionRetentionMinutes:` and `abortAllOnInterrupt:`, and I re-read all 18 afterwards: every one is an exact `toEqual`/`toHaveBeenCalledWith` on a real snapshot, with no `toMatchObject`/`objectContaining` site that could have absorbed a wrong insertion silently.

#### Review rounds

- **Round 1 — WARN, 2 findings.**
  `createUpdateRenderer` had no test coverage though its sibling is exhaustively tested; and `notify_parent`'s background-only gate is decided at spawn and never reconsidered at resume, while the resume door (`agent-tool.ts:118`) awaits inside the parent's own tool call — the same blockage the gate refuses for a foreground child.
  The first I fixed; the second I verified, filed as [#872], and the operator adopted as Step 14.
- **Round 2 — PASS**, scoped to the delta, after two commits landed post-review.
  It re-derived both mutation claims and checked the roadmap insertion's structure, which was worth asking for: an earlier edit in the planning half of this session truncated a section mid-sentence and dropped the Step 12 heading.

The reviewer also caught a plan-drafting imprecision: Module-Level Changes attributes a "domain table Session 11 → 12 and total 65 → 66" to `architecture.md`, but that table lives only in `.pi/skills/package-pi-subagents/SKILL.md`, which was updated correctly.
Recorded here rather than amending the committed plan.

#### Pre-completion reviewer

PASS (round 2, `359e01a3`).
Round 1's two WARN findings are both resolved — one fixed in code, one filed and dispositioned.
The residual is [#872]: `notify_parent` remains present but late during a resumed run.

## Stage: Sync (worktree) (2026-09-03T16:53:14Z)

### Session summary

Pre-push checks pass clean (`pnpm run lint`, `pnpm fallow dead-code`, both 0 findings), so nothing needed fixing before this note.
Plan's `**Release:** ship independently` — no batch, no defer gate to weigh at land time.
The one residual worth carrying forward is [#872] (Phase 22 Step 14), filed but not fixed: `notify_parent` is present but late during a resumed run.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-858--/2026-09-02T19-47-50-352Z_01a063a9-d7d0-7265-9703-b1c1c0b576d5.jsonl` — read with `read_session_file({ path: "..." })` for message-level verification at land/retro time.

### Observations

Nothing beyond the summary — pre-push gates were already green from the TDD stage, and this session made no code changes.

## Stage: Final Retrospective (2026-09-03T17:44:18Z)

### Session summary

The root session landed `issue-858-pi-subagents-child-initiated-mid-run-cha` onto `main` as a clean fast-forward, verified CI on `56f21d6f`, closed [#858], released `pi-subagents-v21.3.0`, and tore down the worktree.
This retrospective spans all four stages — planning and TDD in the peer session on `claude-opus-5`, sync and ship on `claude-sonnet-5`.
The change shipped a net deletion: two child-facing tools (`ask_parent`, `notify_parent`) replacing a 222-line text-marker parser and its 184 lines of tests.

### Observations

#### What went well

- **The design conversation inverted the issue's own proposal, and the reversals came from the operator.**
  Five `ask_user` gates across planning.
  The agent recommended the blocking ask twice and withdrew it twice: first when the operator asked whether the update belonged in a consumer package, then decisively when the operator asked whether `<question-for-parent>` was "a tool masquerading in a protocol trenchcoat".
  That second question dissolved the charter collision instead of escalating it — a carrier swap grants no capability, so the published Non-Goal narrowed rather than broke.
  Three of the issue's own premises did not survive checking, and the shipped design is smaller than the one the issue asked for.
- **The Tidy-First assessor was re-dispatched after the design changed materially.**
  The `tidy-first` skill's stated hazard is a stale assessment that can only contradict a frozen plan; this is the first session in this package's history to actively re-run it rather than absorb the drift.
  The second pass returned three corrections that reached the plan, including that the 15-test migration in `subagent.test.ts` could not be front-loaded as prep because it is not landable green against parse-based code.
- **The end-of-cycle Module-Level Changes cross-check caught a hole the reviewer missed.**
  `test/observation/composite-subagent-observer.test.ts` was listed in the plan and skipped during implementation; step 6 of `/tdd-plan`'s after-the-last-step protocol found it.
  `onSubagentUpdate` is the observer interface's first optional member, so "a delegate that does not implement it" is a case the other five methods never exercise.
  The pre-completion reviewer did not flag it in round 1.
- **A `fallow` finding was cleared by deletion plus real tests, not by three suppressions.**
  The getter, toggle, and setter for `midRunUpdates` were all flagged.
  The setter had no consumer anywhere, so it was deleted; the other two got genuine `SettingsManager` tests.
- **The ship session ran 30 turns with zero rework.**
  Every gate — the `**Release:**` marker read off the peer branch, the `merge-base --is-ancestor` ff prediction, `next-version.sh`, the co-shipped-issue check that correctly classified [#872] as a citation rather than a ship — passed first time and needed no correction.

#### What caused friction (agent side)

- `missing-context` — **the SDK version glob selected a version the package cannot use.**
  Planning turns 24–30 read `node_modules/.pnpm/@earendil-works+pi-coding-agent@*` with `head -1`, landing on `0.79.1`.
  The store holds three versions (`0.79.1`, `0.80.5`, `0.84.4`); `0.79.1` is *below* this package's own declared peer floor of `>=0.81.0`, so it is another package's transitive dependency.
  Every `customTools` and `isAllowedTool` fact in the design was first established against it.
  Impact: roughly seven tool calls against the wrong tree, plus a second verification pass later.
  It was corrected only because the `tidy-first-assessor` independently reported `0.84.4` — nothing in the agent's own procedure would have caught it.
- `missing-context` — **the charter collision surfaced three gates after the design had settled.**
  `README.md:398` and the architecture scope table both carry a Non-Goal forbidding "widening a child's tool allowlist on the agent's behalf", [#612] was closed on it, [#768] withdrawn on it, and [#775]'s evidence file names it the single most likely place a charter sentence would be tested next.
  The agent found it while enumerating doc touch points for Module-Level Changes, not while deciding the design.
  Impact: no rework — the design survived under a narrowed reading — but the first four gates were argued without the constraint that most bore on them, and the planning stage note already recorded the fix: "A scope-and-non-goals grep belongs earlier — before the first design gate."
- `other` — **`npm pack` failed three consecutive times** (planning turns 81–84) before switching to `pnpm view <pkg> dist.tarball` plus `curl` to fetch the `0.81.0` tarball and confirm the peer floor.
  Impact: four wasted tool calls.
  Off-convention besides — this repo is pnpm-exclusive.
- `other` — **a single-variant discriminated union was rejected by the pre-commit hook** after the step-5 commit was already attempted.
  `entry.kind === "completion"` is vacuously true with one variant, so `@typescript-eslint/no-unnecessary-condition` fired.
  Impact: one rework loop of roughly six tool calls — revert the union, re-run both killing mutations against the simplified form, re-commit.
  The plan's sequencing instinct was right and only the type's arrival point was wrong; step 6 introduced the union with its second kind.
  Caught by the gate, not by the agent.
- `other` — **an `architecture.md` edit truncated a section mid-sentence and dropped the Step 12 heading.**
  Self-caught on the next turn and repaired before commit; round 2 of the review was explicitly asked to re-check the roadmap insertion's structure because of it.
  Impact: two extra tool calls, no rework.

#### What caused friction (user side)

- Very little — the operator's interventions were the highest-leverage input in the session, and both arrived as redirecting questions rather than corrections, which is the ideal shape.
  The "does this belong in a consumer package?"
  and "tool masquerading in a protocol trenchcoat" questions each removed a whole subsystem from the design.
- The one opportunity is structural rather than behavioral: the operator adopted follow-ups [#871] and [#872] as Phase 22 steps against the agent's recommendation to defer both.
  Two reversals of the same recommendation in one issue suggests the `roadmap-fit` skill's deferral heuristic reads as more conservative than the operator's actual appetite for absorbing small adjacent defects into an open phase.
  Not worth a prompt change on two data points; worth watching.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `anthropic/claude-opus-5` (five design gates, a charter amendment, a 222-line deletion with mutation verification per step); sync and ship ran on `anthropic/claude-sonnet-5` (deterministic git and CI sequences).
  Four subagent dispatches: `tidy-first-assessor` twice during planning, `pre-completion-reviewer` twice during TDD.
  No mismatch in either direction — no reasoning-weak model on judgment work, no high-cost model on mechanical work.
- **Escalation-delay tracking** — the longest same-error sequence was the `npm pack` failure at four consecutive calls, below the five-call threshold, and it was resolved by changing tool rather than by retrying harder.
  No sequence warranted an `Explore` dispatch or an operator question.
- **Unused-tool detection** — neither `missing-context` finding had an unused tool available.
  The SDK-version miss is not a search problem: the authoritative answer is in `packages/pi-subagents/package.json`'s own `devDependencies` pin, which was never read.
  The charter miss is a sequencing problem, not a discovery one — the agent found the constraint unaided, just late.
- **Feedback-loop gap analysis** — no gap.
  `pnpm run check` ran after nearly every Green step rather than only at the end, the full suite ran at every step boundary, and each step's killing mutations were applied and reverted before its commit.
  The tests added after review had no Red step and were explicitly mutated to compensate.

### Changes made

1. `AGENTS.md` — corrected the Pi SDK version-resolution instruction under § Workflow.
   It previously recommended `node_modules/.pnpm/@earendil-works+pi-coding-agent@*/`, the exact glob that misled this session's planning stage; it now directs the reader to resolve the version from the package's own `devDependencies` pin first, and names the failure mode (`head -1` selecting a version below the declared peer floor).
2. `.pi/prompts/plan-issue.md` — added a published-scope classification to § Decide, immediately after the breaking-change classification and before the `ask_user` gate.
   It directs the planner to grep the package README and architecture doc for Non-Goals and scope-table rows naming the mechanism under change, and to read the close comments of any issue or PR they cite.
3. `packages/pi-subagents/docs/retro/0858-child-to-parent-tool-channel.md` — appended this Final Retrospective stage entry.

Both proposals were confirmed by the operator; no candidate was landed unilaterally, and three other candidates were rejected as recorded above.

[#872]: https://github.com/gotgenes/pi-packages/issues/872
