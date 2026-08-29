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
