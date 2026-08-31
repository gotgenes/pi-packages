---
issue: 465
issue_title: "新增一个类似 “pi install npm:pi-intercom”的能力"
---

# Retro: #465 — Ask-back: let a child's question reach the parent

## Stage: Planning (2026-08-31T21:56:20Z)

### Session summary

Planned Phase 22 Step 8 — the ask-back capability from a third-party issue whose concrete slice ([#798]) had already shipped.
The design gate ran long and productively: what began as "add a question affordance" became a four-part plan after the operator pushed on why foreground and background subagents behave differently, which traced to a residual `isBackground` guard rather than a decision.
Committed `docs/plans/0465-ask-back-child-questions.md` (8 TDD steps), filed [#857] and [#858], and recorded both as new Phase 22 Steps 10 and 11 by operator decision.

### Observations

- **The issue is third-party and its literal ask was already narrowed twice by the operator's own comments.**
  The reporter's "the subagent asks a question, and then it just ends" turned out to describe a missing *handle* ([#798], shipped) plus a missing *affordance* (this plan).
  Reading the close comments rather than the issue body is what made the residual legible.
- **Session title was translated from Chinese at the operator's request.**
  The plan and retro keep the exact Chinese `issue_title` in frontmatter (it is the machine-matched field) while the H1, slug, and prose are English.
  Worth repeating for any future non-English issue.
- **Git archaeology settled a design question that reasoning alone would have gotten wrong.**
  `7bbd6064` showed the `isBackground` guard was originally the middle statement of a three-statement branch whose other two (`runningBackground--`, `drainQueue()`) moved into `ConcurrencyLimiter` in `d5f116eb`.
  The guard inherited its condition by adjacency and was never a decision about events.
  Classified `fix:` on that basis.
- **Three successive design proposals of mine were wrong, each corrected by an operator question.**
  I proposed a structural predicate plus a temporal gate (two gates); the operator asked "what if we made it safe to always tell the parent?", which revealed the parent *is* always told and there are four carriers of which exactly one fires.
  I then proposed collapsing to one gate by claiming at commitment; checking `get_subagent_result` found that would regress documented abandoned-wait behavior and shrink every ask-back child's answerable window from 720 to 10 minutes.
  The settled model — a revocable carrier claim separate from the `consumedAt` latch — came from the operator's "distinguish the desired behaviors rather than complect them" framing, not from my drafts.
- **The codebase already held the vocabulary the design needed.**
  `spawnAndWait`'s doc comment says "The caller holds the result, which is a delivery commitment: the agent must not be queued and must not be announced."
  Both consequences were named; only the first was implemented properly.
  Three `markConsumed()` sites are each annotated "delivery edge".
  Reading for existing vocabulary before inventing a name saved a `deliveryMode` field that would have duplicated the already-public `isBackground`.
- **The Tidy-First assessor's one Recommended item was adopted as TDD step 1**, and its structural finding reshaped the design: the four carriers are not one formatter duplicated four ways but three status vocabularies and three truncation policies.
  That produced a gate the plan would otherwise have papered over, and surfaced a real defect — `get_subagent_result` reports nothing for an aborted child.
- **The assessor also made one overstated universal claim**, predicting a spurious nudge "the instant this guard drops."
  My own earlier trace showed the #661 withhold-and-flush machinery suppresses the common path; the assessor's conclusion (do not ship the guard drop alone) was right for a different reason — the interrupt edge.
  The plan records the real mechanism.
  This is the AGENTS.md rule about verifying a subagent's universal claims, confirmed in practice.
- **Measurements were re-run rather than quoted.**
  The plan labels two numbers measured (`Agent ID` ×2 in `foreground-runner.ts`, `available_skills` ×3 in `prompts.ts`) and the domain count 63 → 65; all three were verified with the roadmap's own recompute commands at the planning commit.
- **Scope pressure was real and mostly resisted.**
  The operator chose the larger carrier-unification option, and two new roadmap steps were opened rather than folding the discovered defects into this plan.
  The mid-run capability the issue's `pi-intercom` reference actually describes stayed a Non-Goal.

#### Deferred tidyings

- `src/lifecycle/subagent-manager.ts` — the assessor flagged `buildObserver`'s `onRunFinished`/`onResumeFinished` as two near-identical try/catch bodies differing only by method name, extractable into a `notify(label, fn)` helper once the guards are gone.
  Rejected as boy-scout cleanup: the duplication predates this change and is not friction the change introduces.
- `test/lifecycle/subagent-state.test.ts` and `test/lifecycle/subagent.test.ts` — the assessor considered nesting the flat `describe("SubagentState — X")` siblings into a unit→scenario tree before adding claim tests, and declined: the flat feature-prefix pattern is this file's established convention across 18 top-level describes, and a new claim sibling fits it exactly.

[#798]: https://github.com/gotgenes/pi-packages/issues/798
[#857]: https://github.com/gotgenes/pi-packages/issues/857
[#858]: https://github.com/gotgenes/pi-packages/issues/858
