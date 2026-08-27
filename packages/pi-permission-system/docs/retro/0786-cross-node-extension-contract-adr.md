---
issue: 786
issue_title: "pi-permission-system: decide the cross-node extension contract — node-locality, registration channel, and the subagent adapter convention (ADR 0012)"
---

# Retro: #786 — Cross-node extension contract ADR

## Stage: Planning (2026-08-20T17:02:12Z)

### Session summary

This session started as `/plan-issue 699` (a third-party issue proposing an exported child detector and a typed duplicate-registration error) and ended by filing #786 and planning the ADR instead.
Investigation reframed the reported throw as one symptom of a wider contract gap; the operator directed a full contract deliberation ("no sacred cows"), chose the new-ADR-issue packaging, and #699 stays open as a downstream implementation issue.
The plan (`docs/plans/0786-cross-node-extension-contract-adr.md`) structures the build session as five `ask_user` deliberation gates over seven parameters, then ADR authoring — the [#581] pattern.

### Observations

- Key mechanical findings the ADR rests on (all verified against source, re-verify commands in the plan's Test Impact Analysis):
  - The SDK event bus hands `pi.events.on` handlers only the payload — no `ctx`.
    Both #699's Option A snippet and PR [#702]'s doc example (`(_event, ctx) => …`) are wrong against the real SDK, which rules out a `ctx`-keyed predicate at the documented `permissions:ready` registration site.
  - The service's three registries are read by different nodes: extractors/formatters by the requesting node's own gates ([#635]), links only by the adjudicating node (ADR 0007 §7).
    An in-process child registering into the parent's service gets a duplicate throw parent-side and a missing extractor child-side — the latter is a latent path-gating weakening worse than the reported symptom.
  - Process shape changes the symptom, not the question: an own-process child's link registration succeeds into a registry nothing reads.
    Any fix keyed on the in-process registry is process-specific by construction.
  - `authorizerSelection.activate` runs before `serviceLifecycle.activate`, so `adjudicatesLocally` and the #302 `ownsService` boolean are both available at `emitReadyEvent` time.
  - `excludedExtensionPackages` (pi-subagents) makes extension loading asymmetric today; excluding an extractor provider from children would break the child's own gates, so the contract must make riding along harmless.
- Two `ask_user` direction gates were bounced before converging: the first for offering the issue's options as the frame ("we need to come up with our own proposals"), the second for insufficient grounding ("back up more").
  The full mechanism walkthrough (diagram, timeline, node-shape table) is what unlocked the deliberation — for a third-party issue in a contested design space, brief the operator to parity before offering any option list.
- The operator's challenge ("do children even get the same extensions?") was correct and added plan parameter 6; verify loading symmetry claims against pi-subagents source, not assumption.
- A headless CI node adjudicates locally with `DenyingAuthorizer` and runs its chain — the counterexample that kills "authorizers sit strictly at the parent".
- Candidate mechanisms deliberately left undecided in the plan (C1 role-gated emission / C2 capability-on-payload / C3 advisory fields / session-keyed accessor); the operator explicitly declined to vote during planning.
- Re-scope comment posted on [#699] crediting the reporter's accurate trace and naming the SDK-signature gap; PR [#702] gets evaluated against the settled contract, not against #699's option list.
- roadmap-fit: no open phase (13 archived) — exited at step 1 for #786.

[#581]: https://github.com/gotgenes/pi-packages/issues/581
[#635]: https://github.com/gotgenes/pi-packages/issues/635
[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#702]: https://github.com/gotgenes/pi-packages/pull/702

## Stage: Implementation — Build (2026-08-20T21:25:39Z)

### Session summary

All eight Build Order steps completed: the four mechanical claims re-verified against source, five deliberation gates run with the operator, ADR 0012 authored and committed (`c87e04b7`), the architecture-doc pointer added, downstream issues filed ([#787] latch, [#788] judge migration, [#789] docs consolidation), [#699] re-scoped by comment, and the issue numbers written back into the ADR's map (`569d2a27`).
Pre-completion reviewer: PASS.

### Observations

- The plan's leading parameter-2 candidate (capability on the ready payload) was rejected at Gate B on the operator's channel-purity objection ("that's not data, that's a client to a service; it only works because it's all in memory") — grounded in this package's own ADR 0011 §6 (the bus as narrowest renderer).
  The adopted mechanism is a refinement the objection produced: session-keyed publication with the key traveling as data on the ready payload, making the "largest contract change" candidate additive.
  Lesson: when the operator pushes back on a recommendation, re-derive the rejected alternative's cost honestly — the original C4 framing had priced the redesign version, not the additive one.
- Gate A grew a deliberation the plan never enumerated: a local/triage adjudication mode (a relaying node's link deciding ahead of forwarding, motivated by the operator's per-node-judge and orchestrator-judge scenarios).
  It was rejected on a structural trilemma (forward anyway / replicate policy that session rules stale / accept the bypass), and the rejection dissolved an author-declared-placement axis before it entered the contract — the containment win that unblocked parameter 1.
- The operator bounced two gates for insufficient grounding before answering ("wait to use `ask_user` until it's clear I have a solid understanding"), consistent with the planning session's lesson: for this operator, in contested design space, brief to parity first — vocabulary tables (link vs. forwarding relationship, node vs. process vs. subagent) and end-to-end mechanism walks (the S2 and S3 ask flows) are what unlocked decisions.
- Mid-gate factual questions ("who uses the query surface?") were answered by checking source and docs live rather than from memory; the answer (no in-repo accessor-based query consumers; two documented external use cases) materially informed the accessor-deprecation decision.
- Operator amendments recorded in the ADR beyond the plan's candidate set: the O4 channel rule (no RPC-over-event-bus, bus stays fire-and-forget) and the runtime deprecation-warning mechanism (`process.emitWarning` with `DeprecationWarning` type, prompted by the operator's "how can downstream authors notice at runtime?").
- Error codes on duplicate-registration errors (kept on the table by the plan from [#699]'s proposal) were declined — post-contract duplicates are genuine author bugs; additive later if a consumer need appears.
- roadmap-fit exited at step 1 for all three filed issues (no open phase in pi-permission-system; no architecture doc in pi-permission-model-judge).
- ADR 0007 deliberately untouched: §7 reaffirmed unamended, stated inside ADR 0012 rather than as a 0007 header edit.
- Pre-completion reviewer: PASS (all deterministic checks green; invariants verified by content review; follow-up filing confirmed against live issue state).

[#787]: https://github.com/gotgenes/pi-packages/issues/787
[#788]: https://github.com/gotgenes/pi-packages/issues/788
[#789]: https://github.com/gotgenes/pi-packages/issues/789

## Stage: Final Retrospective (2026-08-20T22:57:13Z)

### Session summary

One session carried three stages: `/build-plan` settled ADR 0012 across five deliberation gates with the operator and authored it, `/ship-issue` pushed and closed #786 (docs-only — both touched paths are release-please `exclude-paths`, so nothing released), and this retrospective.
Four downstream issues carry the mechanisms: [#699] re-scoped to decisions 2 and 4, plus [#787], [#788], and [#789].
The two decisions the operator overturned mid-gate — the registration channel and the accessor's disposition — are the two the final contract rests on.

### Observations

#### What went well

- Live verification mid-gate changed a decision.
  The operator interrupted Gate C to ask why the service carries queries at all and what consumes them; four greps found zero in-repo accessor-based query consumers and two use cases documented for external adopters.
  That moved the accessor's disposition from "deprecate for registration only" to "deprecate entirely" — a decision no amount of reasoning from memory would have reached correctly.
- The issue-number write-back landed as its own commit (`569d2a27`) after the ADR (`c87e04b7`), so the decision-to-implementation map never held a guessed number.
  This is the artifact where that temptation is highest — the map is the ADR's last section and the issues did not exist when it was drafted.
- The gate sequence absorbed an unplanned eighth axis without losing the plan's parameter order.
  The operator's per-node-judge and orchestrator-judge scenarios surfaced an author-declared link-placement mode the plan never enumerated; rejecting it (a relaying node's link cannot honor the serving node's policy without forwarding or stale policy replication) dissolved the axis and simplified decisions 4 and 6 rather than expanding them.
- Build Order step 1 (re-verify the four mechanical claims before drafting) cost four tool calls and found no drift, but it is what let the ADR's Context section assert the SDK handler signature and the activation ordering as verified fact rather than inherited plan prose.

#### What caused friction (agent side)

- `premature-convergence` — Gate B priced candidate C4 (session-keyed accessor) in its most elaborate form only: a full accessor redesign, semver-major, "callers need a `ctx` the bus never hands them."
  On that pricing I recommended C1 (the service object riding the ready payload).
  The operator rejected C1 on channel purity ("that's not data, that's a client to a service; it only works because it's all in memory") and named C4 the honest one — at which point re-derivation showed C4's **additive** variant dissolves the `ctx` objection entirely, since the session id travels as data on the same payload.
  Impact: no rework to artifacts, but the recommendation was wrong on the merits.
  Had the operator accepted it, the contract would have shipped a live capability on a channel this package's own ADR 0011 §6 defines as data-only.
- `missing-context` — Gate A's briefing used four terms of art (`node`, chain `link`, "the accessor", adjudicate) without defining them, and the operator bounced the gate twice: first on `node` ("I can't tell if you're using 'node' to reference subagents or something else"), then on the other three ("how do we define links?
  ... define for me 'the accessor'").
  The planning stage's retro had already recorded this lesson — brief the operator to parity before offering any option list — and this session read that retro before starting, so the cross-session bridge carried the observation without changing the behavior.
  Impact: three `ask_user` calls for one gate plus three long elaboration messages; no artifact rework.
- `missing-context` — ship step 4b assumed `exclude-paths` was a per-package key in `release-please-config.json` and ran two `python3` probes against the package entry before a `grep` found the single top-level array.
  Reading the planning session's transcript afterwards showed the **same** two-call fumble at its entries 6–7, on a different model: `p.get('exclude-paths')` returning `None`, then a whole-config dump to recover.
  Impact: four-plus wasted tool calls across two sessions and two models — a reproducible trap rather than a one-off slip, which is what moved it from "not worth a rule" to a proposed note.
- `other` (prompt gap, user-caught) — the `/retro` prompt gives prior-session-transcript guidance only for the worktree case (`.pi/prompts/retro.md` lines 60–62); for a trunk multi-session issue it points only at the retro file's stage breadcrumbs.
  This retrospective therefore synthesized the planning stage from its breadcrumb entry alone, and the model-performance lens silently omitted the planning session entirely.
  The operator supplied the session id (`01a01d4b-0a3a-746e-8beb-ce2eb784eafe`), and reading that transcript immediately recovered a finding the breadcrumbs had lost — the repeated `exclude-paths` fumble above.
  Impact: one diagnostic lens under-reported and one proposal nearly dropped; both corrected in-session.

#### What caused friction (user side)

- The two Gate A bounces were the correct intervention and produced the session's strongest decisions, so this is about timing rather than substance.
  The standing preference arrived as a mid-gate aside — "wait to use `ask_user` until it's clear I (the operator) have a solid understanding" — at the second bounce.
  Stated at the first gate, or recorded as a convention, it would have reshaped Gate A's opening briefing instead of its third revision.

### Diagnostic details

- **Model-performance correlation** — the planning session (`01a01d4b-0a3a-746e-8beb-ce2eb784eafe`, attributed from its transcript's committed tail) and the deliberation-heavy build stage (Gates A–E, ADR authoring) both ran on `anthropic/claude-fable-5`; the mechanical ship stage (lint, push, CI watch, issue close) on `anthropic/claude-sonnet-5`; this retrospective on `anthropic/claude-opus-5`.
  One subagent dispatch: `pre-completion-reviewer` on `anthropic/claude-sonnet-5` per its frontmatter, reviewing a 22 KB prose artifact and returning PASS with the plan's four invariants checked by content review.
  No mismatch — the judgment-heavy stage held the strongest model, the mechanical stage a cheaper one.
- **Feedback-loop gap** — verification was incremental rather than end-loaded: `rumdl check` ran before each of the three doc commits and caught an MD053 violation (a `[#302]` definition whose body reference had been written as bare `#302`) immediately after the ADR was written, not at the reviewer.
  `pnpm run check` and `pnpm run test` were correctly skipped during the docs-only build and run once by the reviewer.
- The escalation-delay and unused-tool lenses found nothing notable: no sequence exceeded three consecutive tool calls on one problem, and every search was exact-symbol, so `colgrep`'s absence is not a gap.

### Changes made

1. `AGENTS.md` § Clarification gates — added two rules: define a gate's terms of art before its substance, and price a rejected candidate's cheapest viable form rather than its most elaborate one.
2. `AGENTS.md` § release-please conventions — recorded that `exclude-paths` is a single top-level array covering every package, not a per-package key.
3. `.pi/prompts/retro.md` Step 2 — generalized prior-session transcript reading beyond the worktree case, naming `list_session_files` and `read_session_file` for any multi-session issue.

Considered and not adopted: an `ask_user` call-budget rule (each Gate A re-ask carried new evidence and was operator-requested), an ADR/deliberation branch in `/plan-issue` (one data point; the gate structure absorbed the unplanned eighth axis without damage), and moving the parity lesson into the package skill (it governs gates anywhere, not this package).
