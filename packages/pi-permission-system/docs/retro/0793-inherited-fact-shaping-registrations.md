---
issue: 793
issue_title: "pi-permission-system: close or announce the split-provider access-extractor gap in excluded children (ADR 0012 decision 6)"
---

# Retro: #793 — Close or announce the split-provider access-extractor gap in excluded children

## Stage: Planning (2026-09-01T03:28:07Z)

### Session summary

Planned the close branch of the issue's two candidate mechanisms: an in-process child's extractor and formatter lookups fall back to its parent node's registries, with per-decision provenance stamped on the gate's `logContext`.
The plan is `packages/pi-permission-system/docs/plans/0793-inherited-fact-shaping-registrations.md`, seven steps, two of them Tidy-First preparatory commits.
Filed [#861] for the chain-link case the deliberation surfaced and recorded its Phase 14 disposition (deferred) in the roadmap's sweep list.

### Observations

Four clarification gates ran; the operator pushed back on two of them, and both pushbacks changed the design.

The first pushback asked why the mechanism is scoped to in-process children.
The answer that mattered is that out-of-process children are not *safe*, they are *unreachable*: no shared `globalThis`, an extractor is a closure, and the `bound` channel is in-process only — so neither the fallback nor a parent-side audit can see them, and repair would mean an inter-process round trip per tool call.
That went into the plan's Non-Goals as a named residual rather than a bare "out of scope".

The second pushback ("no sacred cows") was aimed at the mechanism options and produced the design's actual content.
It prompted a capability-vs-policy framing, which the same operator question then dissolved on re-examination one round later — see the reversal below.

A verified fact reshaped the option set early: mechanism A as the issue describes it cannot work.
A headless child's `ctx.ui.notify` is `noOpUIContext.notify = () => {}` (pi `packages/coding-agent/src/core/extensions/runner.ts:239`) and pi-subagents binds children with `bindExtensions({})`, supplying no `uiContext` (`create-subagent-session.ts:245`), so a child-side warning reaches nobody.
Only A's review-log half survives.
This is why [#792]'s alarm is raised by the parent, and it is worth remembering before proposing any child-side user-visible signal.

A parent-side audit at `subagents:child:bound` was considered and rejected: the parent cannot see the child's tool list, so excluding a package that provides both a tool and its extractor — the common, benign case — is indistinguishable from the hazard, and the alarm would mostly cry wolf.

#### The reversal worth recording

I recommended a new architectural principle ("capability is inherited; policy is node-local") spanning all three registries, and retracted it a round later when the operator asked for depth.
It was over-general.
Lumping extractors, formatters, and chain links under one word hid that the first two produce **facts** and the third produces a **verdict** — which is ADR 0012 decision 1's own axis, not a new one.
The amendment the plan now specifies extends that existing axis with one clause instead of introducing a concept.

Two things fell out of the correction that the general framing had obscured:

- The all-three-registries option was not merely bigger, it was **wrong**: `selectAuthorizer` tests `hasUI` first, so a subagent with its own UI adjudicates locally, and inheriting links would run authority the operator's own `excludedExtensionPackages` removed.
- The link case resolves in the opposite direction from the extractor case, because the two differ in *declared intent*.
  An extractor appears in no config, so excluding its provider says nothing about a tool's path visibility; a link name is written in `authorizerChain`, so excluding its provider contradicts a statement the operator made.
  That is a conflict to resolve, not a capability to restore — hence [#861] is framed as a config-vs-exclusion question about reporting, explicitly not as link inheritance.

The near-miss is the lesson: a tidy unifying concept that spans three things is worth testing against each one separately before it reaches an ADR.
Had it shipped as written, the ADR would have licensed exactly the move the plan now ships a guard test against.

#### Deferred tidyings

- `src/tool-access-extractor-registry.ts` and `src/tool-input-formatter-registry.ts` are near-identical twins (same `Map`, same throw-on-duplicate, same identity-guarded disposer, same ISP split).
  The Tidy-First assessor rejected consolidating them for this change — it modifies neither class's internals, and the generality it needs lives in the new decorators, which are generic over the interfaces.
  Left as duplication rather than an abstraction the change does not need.

### Diagnostic details

- **Escalation-delay tracking** — the `ui.notify` question was dispatched to a background `Explore` subagent on sonnet-5 while gate substance was drafted inline; the answer arrived before it was needed and removed an entire option from the set.
  Dispatching it inline would have cost this session's context for a fact that turned out to be decisive.
- **Feedback-loop gap analysis** — the Tidy-First assessor reported no contradiction with the design summary, and independently confirmed the one seam question I was unsure of (whether provenance could reach the gates more cheaply than widening `getToolInputPath`'s return).
  It also found the missing `logContext` coverage in `path.test.ts` that the extraction would otherwise have landed on unguarded — 0 assertions there against 3 in its external-directory sibling.

[#792]: https://github.com/gotgenes/pi-packages/issues/792
[#861]: https://github.com/gotgenes/pi-packages/issues/861
