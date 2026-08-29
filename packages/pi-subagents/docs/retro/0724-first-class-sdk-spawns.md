---
issue: 724
issue_title: "SDK-spawned agents (SubagentsService.spawn) never populate invocation, so they're permanently invisible in the background widget"
---

# Retro: #724 — SDK-spawned agents never populate invocation

## Stage: Planning (2026-08-29T15:29:37Z)

### Session summary

Planned [#724], a third-party report from `Nithin745` that agents spawned through `getSubagentsService().spawn()` never reach the background widget.
The reported diagnosis was correct but the scope was not: an audit of every field the two front doors pass found **six** divergences between `AgentTool` → `resolveSpawnConfig` → `spawnBackground` and `SubagentsServiceAdapter.spawn`, of which the widget filter is one.
The operator directed full parity, resolved at `SubagentManager.spawn` as the single choke point both doors already traverse, with background-ness promoted to first-class record state.
Plan is `docs/plans/0724-first-class-sdk-spawns.md`; three follow-ups filed ([#827], [#828], [#829]).

### Observations

#### The reporter's ADR hypothesis was wrong, and checking it mattered

The issue asks whether the scoping is intentional under [ADR-0004] Decision A ("background agents only").
Reading the ADR: Decision A scopes the widget by **execution mode** — "foreground runs suppress it," because the tool's inline `onUpdate` stream is authoritative — and never by spawn origin.
Answering this before designing kept the plan from either adopting a nonexistent constraint or silently contradicting one.

#### The audit changed the issue

The operator's steer — "even if subagents get spawned via our public API, we should be tracking them and presenting them as first-class instances" — turned a one-line patch into a parity change.
Enumerating every field the doors pass (rather than only the one the report named) surfaced two defects worse than the reported one: SDK-spawned children lose `parentSessionId`, which `pi-permission-system`'s `forwarded-request-server.ts:537` uses to route permission forwarding, and the disabled-agent block from [#448] is unenforced through the public API entirely.

Equally important: **two suspected divergences were verified absent** and kept out of the plan.
Agent-frontmatter defaults reach the SDK door through `assembleSessionConfig`, and `maxTurns` normalization plus `defaultMaxTurns` are applied in `SubagentSession.runTurnLoop`.
The first draft of the audit claimed both as gaps.

#### Two rounds of `ask_user` were bounced, and both bounces improved the design

The operator declined the mechanism question twice.
The first bounce ("we should be managing them as first-class instances") produced the six-divergence audit.
The second ("is there an invariant we could hold to?") produced the delivery-commitment framing: `isBackground` fuses scheduling, announcement, and result delivery, and delivery is the root — a caller holding the promise has already settled the other two.

The third bounce asked *why* config wins over the callsite, which turned out to be the most valuable question of the session.
Archaeology found upstream commit `91236678` ("fix(subagents): make agent config authoritative", edxeth, 2026-03-21), inherited through the hard fork, whose recorded rationale is explicitly a guard against **the parent model guessing harness knobs it does not understand**.
That rationale is about a non-deterministic caller and does not reach a programmatic one — which is exactly the front-door distinction this issue is about.

#### A measurement, not an argument

While tracing the precedence I dispatched this session's own `Explore` subagent with `model: "sonnet-5"`.
Its child session's first `model_change` entry records `claude-haiku-4-5-20251001` — the `DEFAULT_AGENTS` value.
The parameter is silently discarded, contradicting both the tool's own schema text and this repo's `AGENTS.md` instruction to dispatch `Explore` on sonnet.
Filed as [#829].
Reading the code alone would have produced a plausible-sounding claim; the session file settled it.

#### `git log -S` on a vacant field

The operator asked why `pi-subagents-worktrees` does not read `WorkspacePrepareContext.invocation` if the seam was built for it.
`git log -S` traced the field to `51a99701`, our own commit creating the seam, with the field already present in issue [#262]'s "Proposed shape" and no rationale recorded anywhere.
`WorktreeWorkspaceProvider.prepare` uses `agentType`, `baseCwd`, and `agentId`; the only reference to `invocation` in that package is a test fixture setting it to `undefined`.
Worktree isolation is a per-agent-type policy, not a per-call one — and the field's contents are display strings unfit for a provider decision anyway.
Filed as [#828] (semver-major, own plan) rather than folded in.

#### Decisions taken

- **Choke point over shared resolver.** `SubagentManager` gains a narrow `SpawnTypeResolver` (not the existing `AgentConfigLookup`, whose slice differs) so a future fourth door cannot diverge. `architecture.md:245` already claims the `SubagentManager --> AgentTypeRegistry` edge, which `aa8b2da6` removed in #231 — the change makes the diagram true rather than adding an edge.
- **`Subagent.isBackground` over populating `invocation`.**
  `invocation` is documented as a UI-display snapshot; the widget was asking it a lifecycle question.
  The manager already computes the answer five times and stores it nowhere.
- **`BackgroundRequest` two-variant union.**
  Each door states whether its answer is a commitment or a fallback.
  Preserves both current precedences exactly, so the tool door is byte-identical, and it is the mechanism [#829] needs to flip the policy later.
- **Not breaking.** `SubagentsService`, `SpawnOptions`, and `SubagentRecord` keep their shapes; the SDK door gains one throw alongside two it already has.

#### Rejected alternatives

- Mirroring the tool path in `service-adapter.spawn()` (the issue's own proposal, and PR [#747]'s shape) — leaves `invocation` optional, so a fourth door silently reintroduces the bug.
- Flipping to caller-explicit-wins globally — re-opens the bad-delegation class the upstream commit fixed, and is breaking for the tool door.
- Folding the locked-fields precedence policy into this plan — it needs a frontmatter schema addition and changes behavior for every existing agent `.md` declaring `model`/`thinking`/`max_turns`.

#### Deferred tidyings

- `src/config/invocation-config.ts` — `resolveAgentInvocationConfig`'s `runInBackground` merge and the new `resolveBackgroundMode`'s `default` branch are the same `??` shape for different callers; the assessor declined unifying them because it reaches into a return shape several call sites already consume for a two-line saving.
  Revisit once `resolveBackgroundMode` exists and its real shape is known.
- `test/lifecycle/subagent-manager.test.ts` — five inline `mgr.spawn(..., { isBackground: true })` sites (579, 893, 924, 949, 1001) sit outside the file's three wrapper helpers; consolidating them first was judged low payoff against the risk of disturbing surrounding assertions.

#### Assessor corrections to the design summary

The `tidy-first-assessor` corrected two counts I had asserted: `options.isBackground` is read at **five** sites in `subagent-manager.ts`, not six (68 and 218 are type declarations), and the `new Subagent({...})` construction sites are eight, of which three are already choke points.
It also flagged the highest-value preparatory step — `SubagentManagerLike.spawn` types its options `unknown` (`service-adapter.ts:20`), which is the precise reason `tsc` never caught the omission this issue reports.
Narrowing it to `AgentSpawnConfig` first turns the later required-field addition into a compile error at the SDK door.

#### Sequencing decision — a phase opens before implementation

After the plan was committed, the four spun-off issues plus [#724] were judged a **bug cluster**, which `improvement-discovery` names as a legitimate trigger for a new phase.
The operator's call: run `/plan-improvements` for `pi-subagents` with full discovery, **before** `/tdd-plan` on [#724], so the phase takes a clean pre-change health baseline and [#724] enters as a step carrying a grep-able `Release:` tag.

The candidate cause — to be tested by the sweep, not assumed — is *the two front doors were never held to the same contract*. [#724] (the SDK door bypasses the tool door's resolution pipeline), [#829] (precedence is uniform across doors with different callers), [#830] (the public snapshot's allowlist has no stated policy), and [#828] (a vacant field on the public seam) all express it; it traces to the architecture doc's "Reactive versus discrete (not internal versus external)" section, which rules `SubagentsService.getRecord` a query "in-package or not" but was never audited against the code.
[#827] does **not** fit the cause — it is widget activation, not the public surface — and should be triaged out of the spine rather than carried as a symptom-driven step.

Run the discovery in a **fresh session**.
This planning session formed the hypothesis above, so it is the least able to refute it.
Expect the sweep to reshape or reject the cause; that is the process working.

Release coordination the phase should settle: [#828] and [#829] are both semver-major and are candidates for one batched bump rather than two.

[#262]: https://github.com/gotgenes/pi-packages/issues/262
[#448]: https://github.com/gotgenes/pi-packages/issues/448
[#724]: https://github.com/gotgenes/pi-packages/issues/724
[#747]: https://github.com/gotgenes/pi-packages/pull/747
[#827]: https://github.com/gotgenes/pi-packages/issues/827
[#828]: https://github.com/gotgenes/pi-packages/issues/828
[#829]: https://github.com/gotgenes/pi-packages/issues/829
[#830]: https://github.com/gotgenes/pi-packages/issues/830
[ADR-0004]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/docs/decisions/0004-reconsider-ui-direction.md

## Stage: Implementation — TDD (2026-08-29T18:27:57Z)

### Session summary

Executed all seven TDD steps from the plan, landing [#724] as Phase 22's Step 1.
The package suite went 1238 → 1264 (+26).
Two unplanned commits joined the range: a restructure of `subagent-manager.test.ts` (operator-directed) and a repo-tooling commit encoding the testing lessons this session produced.
Both preparatory tidyings paid off measurably, and the pre-completion reviewer returned WARN with three non-blocking findings, all fixed.

### Observations

#### Both Tidy-First steps paid off, and one paid off immediately in an unplanned way

Step 1 narrowed `SubagentManagerLike.spawn`'s options from `unknown` to `AgentSpawnConfig`, and `tsc` promptly reported a **second** hole the `unknown` had hidden: `SpawnOptions.thinkingLevel` is `string` while `AgentSpawnConfig.thinkingLevel` is `ThinkingLevel`.
The tool door performs the same unchecked widening at `invocation-config.ts:26`, so neither door validates and the SDK door's runtime behavior was never different — the cast was simply implicit.
Mirroring the tool door's cast kept the commit behavior-preserving; the gap became [#834], folded into Step 3 by operator decision.

Step 2's payoff was exact.
Routing `subagent.test.ts`'s five bypassing construction sites through the local `makeSubagent` meant that adding a required `isBackground` to `SubagentInit` in Step 5 broke **one** site instead of six.

#### A false-green test, and what actually caught it

A Step 4 test asserted `status === "running"` to prove foreground resolution.
Under `DEFAULT_MAX_CONCURRENT = 4` the limiter admits a background agent immediately, so `status` is `running` in both branches — the signal was legitimate and could not discriminate.
It was caught not by review but by its **twin**: a sibling asserting `"queued"` failed for the same root cause, retroactively convicting the passing one.
The fix was to discriminate on `onSubagentCreated`, which fires for background agents alone.

A second defect surfaced during the describe-nesting restructure: a test occupied one manager's limiter slot while asserting about a *second* manager, whose limiter was unrelated.
A purely organizational prompt produced a correctness find, because reorganizing forces the question "where does this belong?"
rather than "does it pass?".

#### The operator paused implementation to convert both into process

The resulting `c4bc1f6a` records that test organization is upstream of probe adequacy: choosing a `describe` parent forces naming the claim, and parallel structure turns coverage into a readable grid.
It also scoped the existing mutation rule, which had failed to fire for three reasons — it keys on "passes during the Red step", but tests rewritten after Green never have a Red step; a bulk red from a signature change (21 tests failing for one missing field) says nothing about per-test discrimination; and one mutation kills one equivalence class, so surviving tests are not evidence of soundness.
Landed in the `testing` skill, `craftsmanship-scout`, and both TDD prompts, with `/plan-issue` now budgeting a per-step killing mutation.

The scout gap was specific and grounded: `subagent-manager.test.ts` is the package's **largest** test file, so Phase 22's discovery almost certainly opened it, and the scout reported "no concentrated debt" while praising a *smaller* file's nested tree as healthy.
It had a lens for a nested tree as health and none for a flat one as debt.

#### The restructure verification earned its keep

Wrapping 20 flat prefix-sharing describes into a nested tree is mechanical, but the package **disables the Biome formatter**, so nothing re-indents automatically and the transformation had to be scripted.
Comparing the whitespace-stripped line multiset before and after caught three inter-block comments the first pass silently dropped — one of them @daoguademeng's contribution attribution from [#665].
A green suite and a matching test count would both have missed it.

#### Deviation: four predicted test files needed no change, and one of those was a real gap

The plan predicted edits to `background-spawner`, `foreground-runner`, `agent-tool`, and `subagent-events-observer` tests.
None were required — the observer fixture inherits `createTestSubagent`'s new `isBackground` default, and the tool-door tests never asserted on the field.
Investigating rather than accepting that revealed nothing pinned the tool door's `{ kind: "explicit" }` commitment.
That is unobservable today (the tool reaches `spawnBackground` only when the merged value was already `true`, where both kinds resolve alike) but it is the contract [#829] builds on, so a mutation-verified pin was added in `44b15c75`.

#### Reviewer verdict

**WARN**, no FAILs.
The reviewer independently re-derived all four mandate claims — the relocated [#448] guard is unbypassable across the three real callers, the tool door is byte-identical because `resolveBackgroundMode`'s frontmatter branch is unreachable from it, all three `new Subagent(` sites pass a correct value, and the public bundle contains neither changed symbol.

Three non-blocking findings, all fixed:

- `tdd-plan.md`'s frontmatter still described a `red→green→commit` cycle after its body gained the Verify step, and `AGENTS.md:126` carried the same stale phrase.
- All three `fix:` subjects named the mechanism rather than the observable defect — a suspicion I had raised in the dispatch and the reviewer confirmed.
  Reworded via scripted rebase to name symptoms (widget invisibility, disabled-agent enforcement, session scoping), verified with `git diff` against a backup tag showing byte-identical content.
  Worth noting for future planning: these subjects came from the **plan**, so a plan's suggested commit messages should name outcomes, not seams.

[#665]: https://github.com/gotgenes/pi-packages/issues/665
[#834]: https://github.com/gotgenes/pi-packages/issues/834
