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

[#872]: https://github.com/gotgenes/pi-packages/issues/872
