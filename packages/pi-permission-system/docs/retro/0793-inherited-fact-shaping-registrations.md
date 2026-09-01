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

## Stage: Implementation — TDD (2026-09-01T06:57:10Z)

### Session summary

All seven planned TDD cycles landed in order, plus two follow-up commits closing the pre-completion reviewer's findings.
A subagent child that has no extractor of its own for a tool now resolves one from its in-process ancestors, formatters resolve the same way, and a decision that used an inherited extractor carries `extractorSource: "inherited"`.
The pi-permission-system suite went 3795 → 3822 passing (+27; 153 → 154 files), with `check`, root `lint`, and `fallow dead-code` green throughout.

### Observations

The plan survived contact almost intact; three deviations, all recorded in commit bodies.

**The extractor-lookup reshape reached five files, not two.**
The plan's Risks table predicted "two test fakes, both in `tool-input-path.test.ts`".
The real count included inline `{ get: ... }` literals in `tool-call-gate-pipeline.test.ts` and `external-directory.test.ts`, plus direct `registry.get(...)` calls in `service.test.ts` and `tool-access-extractor-registry.test.ts`.
A grep for the *interface name* could see none of those shapes — the type checker found them.
This is the AGENTS.md call-site-grep hazard in a new spelling: the plan grepped the type, and the misses were an inline object literal and a method call on the concrete class.

**The shared walk shipped as a class.**
The plan named a free `resolveFromParentChain(...)` taking three collaborators per call; both lookups would then have carried four constructor arguments.
`AncestorNodes` binds the three once, so each lookup takes two and the composition root names them a single time.

**`tool-call-gate-pipeline.ts` needed no edit.**
The plan listed it as taking the reshaped lookup; because it holds the type by alias, reshaping the interface reached it for free.

#### Verifying the pins

Every step's killing mutation behaved as the plan predicted, and two were worth the effort beyond the ritual:

- The cycle guard was verified by *timeout*, not by a failing assertion — removing the `visited` insert hangs the run (exit 124 under `timeout 25`), while the immediate-parent test still passes.
  A guard whose failure mode is a hang cannot be pinned by a green/red assertion alone.
- The authority-boundary guard needed a mutation that does not exist as a code path: link inheritance.
  Simulating it by making `AuthorizerRegistry` process-global (the exact move the package skill forbids) turned the guard red with the parent's `authorize` called once in the child — so the test is a real pin on ADR 0007 §7, not a vacuous assertion.

The step-1 characterization test used a full-shape `toEqual` rather than the sibling gate's `toMatchObject`, which paid off unplanned: step 6's "stamp unconditionally" mutation killed it *and* the intended target, because a full-shape assertion also rejects spurious field additions.

#### Reviewer findings

Pre-completion reviewer: **WARN** (deterministic checks all PASS; security re-derivation confirmed monotonicity, the authority boundary, walk termination, and provenance honesty).
Both findings were addressed rather than deferred.

1. I had edited the Phase 14 health-metrics `Baseline (2026-08-24)` column from `0` to `1`.
   The package skill says plainly that a dated baseline is a fixed phase-open snapshot recomputed at phase close (Refs #573), and the Target column was already satisfied without touching it.
   Restored.
   Worth remembering: the metric row's *Target* is what a landing step satisfies; the Baseline is not the step's to move.
2. The reviewer flagged missing coverage for `extractorSource` on the external-directory infrastructure-read bypass.
   Investigating it showed the combination is **structurally impossible**, which the reviewer had not established: the bypass is gated on `READ_ONLY_PATH_BEARING_TOOLS`, every member of that set classifies as a `path` tool, and that branch of `getToolInputPath` resolves by convention and never consults an extractor.
   My first attempt to write the flagged test failed for exactly that reason.
   The committed test pins the reachable invariant instead — a bypass record carries no `extractorSource` — and a mutation making built-in tools consult the lookup turns it red.
   The gate still threads the source through, so the record stays correct if that tool set ever widens.

The reviewer was not re-dispatched after those two commits: one restores a single table cell to its pre-change value and the other adds a test over a code path the review had already traced in depth, and both were re-verified against the full gates.

## Stage: Sync (worktree) (2026-09-01T19:49:22Z)

### Session summary

Pre-push gates (`pnpm run lint`, `pnpm fallow dead-code`) both passed clean with no fixes needed.
No deferred work; the plan's `**Release:** ship independently` marker stands, so the root should release at land time rather than deferring to a batch.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-793--/2026-08-31T16-16-49-009Z_01a0589b-ed71-7ef3-b814-bf0f65a4022a.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.
This single session covers planning, TDD implementation, and this sync stage.

### Observations

Nothing further to add beyond the TDD stage's own findings (the reviewer's two WARN findings, both fixed) and the pending follow-up issue [#861], already filed and dispositioned against Phase 14.

[#792]: https://github.com/gotgenes/pi-packages/issues/792
[#861]: https://github.com/gotgenes/pi-packages/issues/861
