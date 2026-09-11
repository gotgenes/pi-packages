---
issue: 909
issue_title: "pi-permission-system: honor explicit parent forwarding for subprocess children with their own UI"
---

# Retro: #909 — pi-permission-system: honor explicit parent forwarding for subprocess children with their own UI

## Stage: Planning (2026-09-11T06:04:49Z)

### Session summary

Planned [#909], a third-party issue from [@boadij](https://github.com/boadij) (maintainer of Pi Herdsman): a subprocess child that has its own TUI adjudicates `ask` permissions locally even when its spawner named a parent session in `PI_SUBAGENT_PARENT_SESSION`.
The operator's clarification gate settled the direction as **implicit trigger, liveness-gated**: a UI node relays when a forwarding target resolves to another session *and* that target is demonstrably draining its inbox; otherwise it keeps its local dialog.
The plan is committed at `packages/pi-permission-system/docs/plans/0909-ui-child-relays-to-live-parent.md` — three preparatory commits, one breaking `feat!:`, a boundary/end-to-end test step, a transition-record step, and a docs step.

### Observations

- The reporter's diagnosis was accurate and verified inline: `selectAuthorizer` (`src/authority/authorizer.ts`) tests `ctx.hasUI` before subagent detection.
  Herdsman's spawn path was read directly from its source (`extension/index.ts:5057-5061`, plus the nested-agent inheritance at `:4862-4864`) rather than taken from the issue body — it confirms every pane in a `lead → agent → agent` tree names the root lead.
- Three separate questions ride on `hasUI` in this package, and only one moves: serving eligibility (`ForwardingManager`, fixed by [#907], untouched), child detection (`isSubagentExecutionContext`, untouched), and authority selection (this change).
  Naming that split up front is what kept the change from re-opening [#907].
- `resolvePermissionForwardingTarget`'s `hasUI` arm — returning `{ source: "self" }` — turned out to be **dead in production** and actively wrong under the new design (a relaying UI node would file requests into the inbox it drains).
  Removing it is the first preparatory commit.
- Alternatives rejected at the gate: an explicit second env var from the spawner, an operator config key, and declining outright.
  The liveness gate was chosen over hard-relay so a pane with a live human is never refused for a dead parent, and it also avoids a composite terminal whose `adjudicatesLocally` would be ambiguous mid-ask (ADR 0007 §7 has no room for that).
- The change is classified **breaking** (`feat!:`): an existing configuration changes where its human is prompted, with no user edit.
  The opt-out is the spawner's — spawn the child without the marker.
- No new ADR: ADR 0007 §7's rule is untouched and only its incidental example ("a node with UI decides locally") is narrowed; `docs/subagent-integration.md` is the canonical spec that carries the new rule.
- An in-process `@gotgenes/pi-subagents` child never binds an `ExtensionUIContext` (pi's `agent-session.ts` sets it only from `bindings.uiContext`, which interactive/rpc modes supply), so the registry channel's new arm is unreachable for it in production — it is exercised only by hand-built ctx literals in `composition-root.test.ts`.
- Filed no follow-up issues: the one concrete residual (a relaying pane shows nothing while it waits) is already tracked as [#658] / PR [#693], and the rest are Open Questions with no reported symptom.

#### Deferred tidyings

- `src/authority/authorizer-selection.ts` and `src/authority/forwarding-manager.ts` — the assessor declined extracting a shared "log on transition only" helper for the two change-detection sites: they track different state shapes (a bare session id vs. a role plus optional target) and would be the abstraction's only two call sites.
  Revisit only if a third appears.

## Stage: Implementation — TDD (2026-09-11T06:29:39Z)

### Session summary

Executed all seven plan steps as seven commits: three preparatory (`refactor:` × 2, `test:` × 1), the breaking `feat!:` that relays a UI session's asks to a declared live parent, a `test:` step pinning the live-authority boundary end to end, a `feat:` step recording relay transitions, and the `docs:` step.
The package suite went from 4143 to 4157 tests (+14); `check`, root `lint`, full `test`, and `fallow dead-code` are all green.

### Observations

- **Deviation — the boundary repair moved into step 4.**
  The plan sequenced the `composition-root.test.ts` repair (`fact-shaping inheritance stops at live authority`, whose parent ctx becomes headless) as step 5, but step 4's feature is what breaks it, so it landed in step 4's commit to keep the tree green.
  Noted in that commit body.
  The Tidy-First assessor had predicted this breakage exactly, and it materialized in an instructive way: the child relayed, the parent's server escalated through the *parent's* chain, and the parent's link ran — the opposite of what the test claims to prove.
- **Deviation — `approval-escalator.test.ts` needed no edit**, though the plan listed it as a touch point; its expectations never named `hasUI`.
- **Deviation — `deactivate` also records a relay stop**, which the plan's step 6 did not enumerate.
  It is the same transition, and a session teardown is where the last one happens.
- Every killing mutation the plan named behaved as predicted.
  Dropping the `isServing` conjunct killed the three liveness cases and left the live-parent cases green; substituting `detection.isSubagent` killed the self-naming case; restoring the unconditional local arm killed both relay cases; flipping `adjudicatesLocally` killed exactly one (only one test asserts the chain role on the relay arm).
- The `null` arm of `TargetServingLookup.isServing` is unreachable through the real `ForwardingLivenessJudge` once `"self"` is gone — both remaining channels return plain booleans.
  The selection's `=== true` test still earns its keep as the documented burden of proof, and the case is pinned through a test double.
- Pre-completion reviewer: WARN.

#### Reviewer warnings

- Phase 9's structural invariant ("the dispatch exists in exactly one place; predicates evaluated once per activation") still holds — the reviewer re-verified by grep — but is pinned by prose and code reading rather than by a test.
  Non-blocking, and unchanged by this work.

## Stage: Final Retrospective (2026-09-11T06:38:14Z)

### Session summary

Planned, implemented, shipped, and released [#909] in one process: a third-party request from the Pi Herdsman maintainer to honor `PI_SUBAGENT_PARENT_SESSION` for subprocess children that keep their own TUI.
Seven commits landed on `main` behind a green CI run, and `pi-permission-system` released as v32.0.0 (major, breaking).
The design — relay only while the declared parent is demonstrably serving — came from the operator's clarification gate, not the issue's proposal.

### Observations

#### What went well

- **The Tidy-First assessor's contradiction channel was the highest-value artifact of the session.**
  Beyond its three preparatory commits, it predicted that `composition-root.test.ts`'s `fact-shaping inheritance stops at live authority` test would silently lose its premise — the child is built `hasUI: true` under a parent that is already serving, which is exactly the new relay condition — before a line of code existed.
  The prediction was right down to the mechanism: at execution the child relayed, the parent's server escalated through the *parent's* chain, and the parent's link ran, which is the opposite of what the test claims to prove.
  That is the `tidy-first` skill's "treat a contradiction it reports as a correction to the design" clause paying for itself.
- **Reading the third party's source rather than its narrative.**
  `AGENTS.md`'s rule about third-party reports sent the planning session to `pi-herdsman`'s tarball, where `extension/index.ts:5057-5061` and the nested-agent inheritance at `:4862-4864` confirmed the topology claim and gave the plan exact citations.
  The issue body's diagnosis turned out to be accurate, but that was a finding rather than an assumption.
- **The re-derivation mandate on the pre-completion reviewer produced a real nuance.**
  Because the change removes a guard's evidence source, the dispatch asked the reviewer to enumerate its own candidate inputs instead of re-checking the tested ones.
  It came back with something no test states: once `"self"` is gone, `TargetServingLookup.isServing`'s `null` arm is unreachable through the real `ForwardingLivenessJudge`, since both remaining channels return plain booleans.
- **All four killing mutations behaved as predicted**, and the one discrepancy was informative rather than alarming: flipping `adjudicatesLocally` on the relay arm killed exactly one test, where the plan said "assertions" plural — only one test asserts the chain role there.

#### What caused friction (agent side)

- `instruction-violation` (self-identified at execution, not at planning) — the plan sequenced the `composition-root.test.ts` boundary repair as step 5, *after* the step 4 feature that breaks it, which cannot leave a green tree.
  The `testing` skill's TDD planning rules already cover this ("account for existing tests that will break — either fold the test updates into the same step or place a dedicated test-update step immediately before it"), but that skill was not loaded during planning: `/plan-issue` makes it conditional ("if the plan involves test changes or TDD steps"), and the condition read as skippable.
  Impact: one deviation from the plan, absorbed into step 4's commit and noted in its body.
  No rework beyond that.
- `instruction-violation` (self-identified) — an `Edit` during step 4 used a hand-built absolute path missing the `packages/` segment (`/Users/chris/development/pi/pi-permission-system/src/authority/subagent-detection.ts`), tripping the `external_directory` gate.
  `AGENTS.md` says to pass file-tool paths repo-relative for exactly this reason (Refs #726).
  Impact: one wasted tool call.
  Pleasingly, this package's own `model-judge` authorizer denied the call with the precise correction — dogfooding caught it faster than a lint rule would have.
- `instruction-violation` (neither caught mid-session nor by the user) — the ship stage spent three consecutive tool calls re-verifying that `git rev-parse HEAD` had emitted a 40-character SHA (`git rev-parse HEAD`, then `| cat`, then `> /tmp/sha.txt; wc -c`).
  Both `AGENTS.md` and `/ship` step 7.1 forbid this in so many words, and `| wc -c` on `git rev-parse` is the literal example each uses (Refs #839).
  Impact: two wasted tool calls, no rework.
  The rule is already stated twice at maximum salience, so a third statement is not the remedy — recording it here as a model-behavior observation instead.

#### What caused friction (user side)

- None.
  The single clarification gate carried two bundled questions (trigger, and unserved-parent behavior) and both were answered decisively in one pass; that answer — implicit trigger, liveness-gated — drove the whole design and never needed revisiting.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `anthropic/claude-opus-5`; `/ship` ran on `anthropic/claude-sonnet-5`; the retrospective on `anthropic/claude-opus-5`.
  The three-call SHA re-verification above is the one quality blemish, and it sits in the sonnet-5 ship stage on purely mechanical work.
  Subagents: `tidy-first-assessor` and `pre-completion-reviewer` both ran on their own configured models, each on judgment-heavy work matched to their role — no mismatch found.
- **Escalation-delay tracking** — no `rabbit-hole` friction points.
  The longest same-target sequence was the three-call SHA check, below the five-call threshold but notable because zero calls were warranted.
- **Feedback-loop gap analysis** — verification ran incrementally rather than only at the end: per-step `vitest` on the touched file for every step, `pnpm run check` immediately after the two steps that changed shared types (step 3's fixture export, step 4's `SelectedAuthority` field), and the full package suite after steps 1, 4, and 5.
  No gap found.
- **Unused-tool detection** — skipped; no `rabbit-hole` or `missing-context` friction point to attribute.

### Changes made

1. `.pi/prompts/plan-issue.md` — dropped the hedge on loading the `testing` skill: it is now unconditional for any plan with TDD steps, with a clause naming why (its TDD planning rules govern step sequencing, not just test content).
2. `.pi/skills/tidy-first/SKILL.md` — added one sentence to Step 3: an assessor contradiction naming a test the change will break is a sequencing constraint, so the repair belongs in the step whose commit breaks it.
3. `packages/pi-permission-system/docs/retro/0909-ui-child-relays-to-live-parent.md` — this Final Retrospective stage entry.

Considered and rejected: a third statement of the "do not measure a deterministic command's own output" rule (already in `AGENTS.md` and `/ship` step 7.1, with `wc -c` on `git rev-parse` as the literal example in both), and any new rule about repo-relative file-tool paths (already in `AGENTS.md`, and this package's own `model-judge` caught the violation in one call).

[#658]: https://github.com/gotgenes/pi-packages/issues/658
[#693]: https://github.com/gotgenes/pi-packages/pull/693
[#907]: https://github.com/gotgenes/pi-packages/issues/907
