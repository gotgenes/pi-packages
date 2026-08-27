---
issue: 745
issue_title: "pi-permission-system: replace the forwarded-request and ui_prompt message with the structured payload"
---

# Retro: #745 — replace the forwarded-request and ui_prompt message with the structured payload

## Stage: Planning (2026-08-15T16:41:25Z)

### Session summary

Planned Phase 13 Step 3: the payload replaces `message` on the forwarded-request wire and the `permissions:ui_prompt` broadcast, and the two tool-preview caps are soft-deprecated.
The plan lives at `packages/pi-permission-system/docs/plans/0745-cross-boundary-payload-swap.md` and lays out six steps — three additive/lift-and-shift, two breaking removals, one docs — plus a re-pinned quantitative invariant from [#710].
Filed [#751] for the `select`/`input` fallback's complete-view capability, which [#710]'s plan had parked here without this step actually resolving it.

### Observations

- **Three design choices went to the operator, all decided.**
  The broadcast nests the payload's `request` group verbatim (over flat core facts or a bare `message` removal), so a fact added to `PromptRequestFacts` reaches the bus without a second hand-maintained declaration — the same "cannot drift" argument that made `PromptPermissionDetails.payload` required in [#744].
  Version skew is a **clean drop**: the wire type loses `message` entirely and the reader stops reconstructing it, so a skewed ask renders from `surface` / `value` / provenance.
  The preview caps stop honoring configured values but keep their built-in constants, deferring the un-cap to [#746].
- **— mattered.**
  **The operator's follow-up question — "does the `request` object itself have an `id`?"**
  It does not; `PromptRequestFacts` carries no id, so `requestId` stays top-level as the correlation key with no overlap.
  Worth confirming again at implementation time if the guard's shape changes.
- **The serving-node render needed no new code**, which was not obvious from the issue text.
  `LocalUserAuthorizer` already hands `details.payload` to `requestPermissionDecision`, so "the parent renders under its own budget" follows from carrying the payload.
  What was missing was facts, not a renderer.
- **A forced-atomicity trap was avoided by lift-and-shift.**
  `buildForwardedAskPayload` reads `request.message` today, so removing the field and switching the serving node in one commit would have been unavoidable.
  Adding `payload` alongside first splits it into three tractable steps.
- **The tolerant `asX` reader is the silent-drop hazard** (the #558 class).
  `readForwardedPermissionRequest` reconstructs an allowlist, so an added `payload` is dropped unless taught — and its required-core gate currently demands `typeof parsed.message === "string"`, which must relax or a current child's request is rejected outright.
  `asPromptPayload` goes beside its type in `prompt-payload.ts`, following `isPermissionDecisionState`'s precedent, not in the distant reader.
- **The asymmetric skew direction is unavoidable and was made explicit.**
  An *old* parent rejects a *new* child's request and deletes it; the child abandons at the 10-minute timeout with `confirmationUnavailable`.
  Safe direction, slow — so the migration note says upgrade the parent first.
  Only reachable for an out-of-process child (`source: "env"`).
- **The [#710] row-budget invariant is quantitative and its existing test does not cover the new shape.**
  The pin renders a hand-built `kind: "forwarded"` payload; after this change the same ask arrives as `kind: "bash"` with real evidence — different input to the same budget.
  Step 2 asserts the new shape *before* the old case is edited, so the number is measured rather than argued.
- **Release is deliberately deferred.**
  Batch "presentation-contract" tail is [#746], which lands the review-log renderer that bounds what an un-capped payload would otherwise persist.
  Releasing at Step 3 would publish a major bump whose migration note is only half true.
- **Scope decision worth revisiting if [#746] slips:** the payload's tool-input evidence is still truncated at the built-in 200 characters, so it is not yet "complete by contract" for a non-bash tool ask.
  That residual is knowingly carried and ships in the same release.

### Addendum — request-id observability (same session)

An operator question after the plan commit — "should every request have an ID when it gets created?"
— opened a gap the phase sweep had missed, and reshaped part of this plan.

- **Traced and measured before answering.**
  There is no permission request id: three conventions (borrowed `toolCallId` at `runner.ts:162`, minted `skill-input-…` at `skill-input-gate-pipeline.ts:86`, a third minted at `approval-escalator.ts:253` that discards the one it was handed), and the id attaches inside `promptForApproval`, so no non-prompting resolution carries one.
  `PermissionDecisionEvent` carries none ever.
  Review-log measurement (7.3 MB, 9 417 entries; last 14 days = 766): 452 entries carry `toolCallId` but never `requestId`, and 53 of 57 `forwarded_permission.request_created` ids appear on no `permission_request.*` entry.
- **The first cost estimate was wrong and the operator's follow-up corrected it.**
  I initially framed the mint as the risky, identity-dependent part and the wire join as nearly free.
  Once the operator committed to "our own id, keep passing `toolCallId`", re-measuring showed the mint is the *cheapest* piece — the two-field shape already exists on `PromptPermissionDetails`, `GateRunner.run` already takes `toolCallId` separately, and the change is largely one line plus a net deletion of `createSkillInputRequestId`.
  Lesson: measure the change's real footprint before ranking options by cost, not after.
- **Two `ask_user` answers came back in tension** ("mint slice before this issue" vs "[#610] at Step 9, after Step 4").
  Surfacing the contradiction rather than reconciling it silently was right — the resolution was a third deliverable needing its own home, which no option had offered.
- **A third-party issue was mishandled and then corrected.**
  I retitled [#610] (filed by `hcrosse`) to cover mint-at-creation, then split the mint into [#752] and restored the original title, which described the narrowed scope accurately all along.
  Retitling someone else's issue ahead of a settled decomposition was premature; the body was correctly left untouched throughout.
- **Net roadmap change:** Phase 13 gains Step 9 ([#752], the minted id) and Step 10 ([#610], cross-session correlation), plus a Track E sequencing note — step numbers are discovery order, and Step 9 runs before Step 3.
  This plan gained a second TDD step for `requesterRequestId` and a `Sequencing` subsection.
- **[#610]'s original sweep disposition was wrong**, and the roadmap now records why: it was swept out as a feature issue on its symptom without the cause being traced.
  Worth carrying into the next `/plan-improvements` sweep as a check — a user-reported observability gap may be a structural finding wearing a feature label.

### Addendum — the `requesterRequestId` step was retired by [#752] (2026-08-15)

[#752] has landed and released, and it closed the correlation gap at the source rather than on the wire: `ParentAuthorizer` stopped minting a third id and now writes `details.requestId` as the forwarded request's `id` (`forwardableRequestId`, `3f8d3fd6`).
So `ForwardedPermissionRequest.id` **is** the child's request id, and the `requesterRequestId` field this plan had gained would have named the same value twice.

- **The stale instructions were the real hazard, not the stale design note.**
  A "superseded by [#752]" paragraph had been added to the design section, but the Module-Level Changes rows, the test-expectations row, and TDD step 2 still instructed adding the field.
  A plan that says "do not do this" in one section and "do this" in three others resolves, for an implementation session reading top to bottom, as "do this".
  Excised the instructions and renumbered the TDD order 1–6; the historical rationale stays in one clearly-labelled paragraph.
- **Predicting a dependency's shape is what went wrong.**
  The field was designed while [#752] was still unplanned, on the assumption that it would mint an id and leave the wire's own id alone.
  It did something better that this plan could not have specified.
  The cheaper move would have been to name the correlation gap and defer the mechanism to whichever issue landed first.
- **One residual is now recorded rather than absorbed.**
  `forwardableRequestId` falls back to a fresh mint when an inbound id could not safely name a file, and in that case the join breaks for that exchange.
  It is [#752]'s residual, needs no contract change (log both ids on `forwarded_permission.request_created`), and sits in this plan's Open Questions for Step 10 ([#610]) to decide.
- **Anchors re-verified against the post-[#752] tree** before handing off: both `message: string` metric baselines still `1`, `architecture.md` line 388 unmoved, the [#710] here-string pin present, `forwarded-ask-payload.ts:42` still reading `request.message`, and `requesterRequestId` absent from `src/` and `test/`.
- **The reconciliation took two passes, and the second one is the transferable lesson.**
  The first swept for the symbol `requesterRequestId` and cleaned six sites.
  A full re-read then found a seventh in Goals — "the forwarded request carries the child's originating `requestId`, and the child's `forwarded_permission.*` review entries name it" — which describes the same retired work in prose without ever naming the field, so no symbol grep could match it.
  When retiring planned work, sweep for the *concept* (`requestId`, `correlation`, `join`, `shared key`) as well as the identifier, and re-read the sections a grep does not lead you to.
  This is the doc-side twin of AGENTS.md's "a step that reworks documented behavior carries no removed symbol to match".

### Handoff state (verified 2026-08-15)

The plan is self-consistent and authoritative for `/tdd-plan`: six TDD steps, no identity work, all anchors verified against the current tree.
Nothing is in flight — working tree clean, [#752] landed and released, [#721] (the other `approval-escalator.ts` editor) not started.
The green baseline has **not** been run this session; `/tdd-plan` owns that gate.

## Stage: Implementation — TDD (2026-08-16T01:10:03Z)

### Session summary

Executed all six TDD steps of the plan: the payload joins the forwarded-request wire additively, the serving node switches to projecting the child's payload, `message` leaves the wire, the `permissions:ui_prompt` broadcast narrows to `request: PromptRequestFacts`, the two tool-preview caps are soft-deprecated with a `detectDeprecatedPreviewCaps` notice, and the docs plus the Phase 13 roadmap mark land.
Six commits — two plain `feat:`, three `feat!:` carrying the removals, one `docs:` — and a test-count delta of 2994 → 3009 (+15) across 139 files.
Both plan metrics hit their target: `grep -c "message: string"` is `0` in `permission-forwarding.ts`, `permission-ui-prompt.ts`, and `permission-events.ts`.

### Observations

- **Pre-completion reviewer: PASS.**
  No WARN findings.
  It independently re-verified the three named checks — every `feat!:` footer's remedy exists in the real surface, the eight local-kind cases in `test/presentation/legacy-message.test.ts` are untouched, and no stale `message` reference survives in `src/` or the shipped docs.
  It observed one transient `test/composition-root.test.ts` timeout in the monorepo-wide run that did not reproduce in isolation — resource contention, not a regression.
- **Tidy-First assessor found no preparatory work warranted.**
  Its one Optional candidate (extracting a shared assertion helper in `test/permission-ui-prompt.test.ts` before the literals grow) was correctly self-declined: the helper's shape depends on the very `payload`/`request` fields the change introduces.
  Skipping it was right — the file was rewritten wholesale with a small `payloadWith` local helper that only existed once the type did.
- **The plan's step-2 boundary was one commit too eager, and lift-and-shift caught it.**
  Step 2 as written had the degraded forwarded payload emit `evidence: []`, but `message` was still on the wire at that point, so `renderForwarded` (which reads the `"requested"` entry) would have broken a step early.
  Moved the emptying into step 3, where `message` actually leaves — keeping each step's blast radius at one contract, which is the whole point of the lift-and-shift ordering.
  Generalizable: when a plan's step N describes a *consequence* of step N+1's removal, the consequence belongs in N+1.
- **The [#710] row-budget invariant was measured, not argued, and it held.**
  The new-shape pin (`kind: "bash"` with the child's real evidence, at widths 120) passed on first run inside the 24-row default, so the re-pin was green before the old `kind: "forwarded"` case was touched.
  Worth noting the old case was *not* deleted: it is now the version-skew render's test, a real branch.
- **The deprecated config caps traverse the pipeline backwards, and that needed its own test.**
  Every other field goes schema → merge → runtime type; these must reach the merge intermediate (so `detectDeprecatedPreviewCaps` sees an operator's setting) and stop there.
  `test/config-pipeline.test.ts`'s #332-class cases were rewritten to assert exactly that split — `mergeResult.merged.toolInputPreviewMaxLength` is `1000` while the normalized config does not have the property.
  Without that rewrite the deletion would have looked like the #332 bug returning.
- **A `feat!:` message-removal commit's real blast radius was two test files, not one.**
  `tsc` found `test/permission-events.test.ts` immediately, but `test/authority/local-user-authorizer.test.ts`'s three `toHaveBeenCalledWith` event literals only failed at *runtime* — the emit is untyped through the bus.
  The `pnpm run check`-then-full-suite discipline caught them; a cycle-scoped vitest run would not have.
- **The shared `writeRequest` fixture default is load-bearing in a way that surfaced late.**
  Adding `payload: makePromptPayload()` to it turned an existing `forwarded-request-server.test.ts` case into a payload-bearing ask, which correctly changed its escalated `message` to the local-shaped sentence.
  That is the documented consequence of "renders identically in kind", so the test was updated with a comment rather than the fixture being weakened.
  The payload-less case now passes `payload: undefined` explicitly, relying on `JSON.stringify` dropping the key.
- **Two stale roadmap lines were found only by reading, not grepping.**
  `architecture.md`'s Step 10 target and Track E note both still said "the child's originating `requestId`, which Step 3 puts on the wire" — describing the `requesterRequestId` field [#752] retired, in prose that names no removed symbol.
  This is the exact failure mode the planning stage's own addendum warned about; it recurred one document over.
  Corrected in the docs commit.
- **One deviation from the plan's "README.md: No change" row.**
  Added a docs-table row for `docs/migration/0745-prompt-payload-contracts.md`, per the docs-in-distribution convention (a shipped guide the README does not link is undiscoverable).
- **Release stays deferred**, per the plan's `**Release:** mid-batch — defer` marker: batch "presentation-contract" tails at [#746], which lands the review-log renderer.
  The three `feat!:` commits sit on `main` unreleased until then.

[#610]: https://github.com/gotgenes/pi-packages/issues/610

## Stage: Final Retrospective (2026-08-16T15:10:55Z)

### Session summary

Shipped Phase 13 Step 3 across four stages (planning, two planning addenda, TDD, ship): the structured `PromptPayload` replaced the pre-rendered `message` on the forwarded-request wire and the `permissions:ui_prompt` broadcast, and the two tool-preview caps were soft-deprecated.
Six commits, +15 tests, both `message: string` metric rows to `0`, pre-completion reviewer PASS, CI green, issue closed with the release deliberately deferred to the [#746] batch tail.
The TDD stage ran without a single user correction — every deviation was self-caught.

### Observations

#### What went well

- **The plan's lift-and-shift ordering paid off exactly as designed, and one boundary error in it was caught by executing rather than reading.**
  The plan put the degraded payload's `evidence: []` in step 2, but `message` was still on the wire there, so `renderForwarded` would have broken a step early.
  Caught while writing the step-2 red, before any green — the assertion was moved to step 3 and both steps stayed at one contract each.
  The generalizable rule: when a plan's step N describes a *consequence* of step N+1's removal, it belongs in N+1.
- **Measuring the [#710] row-budget invariant instead of arguing it was cheap and conclusive.**
  The plan insisted the re-pin be asserted at the new shape *before* the old case was touched.
  It passed on the first run, which retired the risk in one tool call — and the old `kind: "forwarded"` case survived as the version-skew render's test rather than being deleted as redundant.
- **The `tidy-first-assessor` correctly declined its own only candidate.**
  It proposed extracting a shared assertion helper in `test/permission-ui-prompt.test.ts`, then reasoned that the helper's shape depends on the very `payload`/`request` fields the change introduces, and filed it Optional rather than Recommended.
  That is the assessor working as intended — an assessor that had recommended it would have produced a throwaway commit.
- **Verification cadence was tight throughout.**
  `pnpm run check` after every green, the full package suite after every step, root `lint` + `fallow dead-code` before every commit.
  No feedback-loop gap; see the diagnostic details below.

#### What caused friction (agent side)

- `other` — **`pnpm exec biome check --write` cannot fix a warning-level finding, and the attempt cost the session's single largest time sink.**
  Root `lint` reported PASS while `grep -c 'lint/'` counted one `noUnusedImports` warning in `src/tool-preview-formatter.ts` (a stale `PermissionSystemExtensionConfig` import left by making `resolveToolPreviewLimits` parameterless).
  `--write` reported `No fixes applied. Found 1 warning.` — a warning's fix is classified unsafe, so only `--write --unsafe` applies it.
  Verified this retro: on a probe file `--write` skips it and `--write --unsafe` fixes it.
  Impact: one wasted command whose chained root `lint` then hit a 600-second timeout — ~10 minutes, the largest single delay in the session.
  Fixed by hand-editing the import.
- `other` — **The project's own prescribed warning-count idiom reports failure on success.**
  `AGENTS.md` teaches `pnpm run lint >/tmp/l.log 2>&1; grep -c 'lint/' /tmp/l.log`, but `grep -c` exits 1 when the count is `0`, so a clean lint surfaces as `Command exited with code 1`.
  Hit three times (after TDD steps 2 and 5, and at the changelog-preview step, where `grep -c "message: string"` returning `0` for all three files did the same).
  Impact: no rework — each was correctly read as success — but three false failure signals on the exact command the repo documents.
- `other` — **Retyped a file path from memory twice, four turns apart, after the first was already corrected.**
  Both reads used `/Users/chris/development/pi/pi-permission-system/test/…`, dropping the `pi-packages/packages/` segment; the `external_directory` gate denied both and its denial message printed the corrected path each time.
  Impact: two wasted tool calls, no rework.
  Worth noting the second occurrence came *after* a correct read of the same file — the fix is to copy paths from prior tool output rather than retype them.
- `missing-context` — **`tsc` passed twice while the full suite then failed on untyped assertion literals.**
  Removing `message` from `ForwardedPermissionRequest` (step 3) and from `PermissionUiPromptEvent` (step 4) left stale object literals in `expect(escalate).toHaveBeenCalledWith({…})` (`test/authority/forwarded-request-server.test.ts`) and `expect(events.emit).toHaveBeenCalledWith("permissions:ui_prompt", {…})` (`test/authority/local-user-authorizer.test.ts`).
  Neither is type-checked — the mock's signature is loose and the event bus is untyped — so both surfaced only at the full-suite run.
  Impact: two diagnose-and-locate detours (about 5 tool calls each, including one `sed -n '/Failed Tests/,/^$/p'` that printed nothing and had to be retried as `tail -60`).
  No rework beyond the fixes themselves, because the full suite ran after every step.
  This is the same class as the package skill's `hasUI:`-cast note, arriving through a different vector: assertion literals rather than hand-built `ctx` objects.

#### What caused friction (user side)

- Nothing to flag.
  The single interaction point — the deferred-release confirmation at ship time — is exactly the strategic judgment the workflow should route to the operator, and it was answered from a decision the plan had already recorded.
  The `Continue.` at the start of the TDD stage was a mechanical unblock after the plan read hit the 50 KB truncation limit; the plan being long enough to truncate is a plan-authoring signal, not a user one.

### Diagnostic details

- **Model-performance correlation** — no mismatches.
  TDD stage on `anthropic/claude-opus-5` (judgment-heavy: five contract changes, a tolerant parser, three breaking-change footers); ship stage on `anthropic/claude-sonnet-5` (mechanical: push, CI poll, close); retro on `anthropic/claude-opus-5`.
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `anthropic/claude-sonnet-5` per their frontmatter — appropriate for read-only review.
  The `pre-completion-reviewer` took 1127 s / 53 tool calls, which is the cost of a genuinely independent re-verification (it re-ran all four gates and re-checked every `BREAKING CHANGE:` remedy against the real surface).
- **Escalation-delay tracking** — no sequence exceeded five consecutive tool calls on one error.
  The two longest were the post-`message`-removal test repairs (about 5 calls each), and both were linear diagnose → read → fix, not repeated attempts at the same failing approach.
  No subagent escalation was warranted.
- **Unused-tool detection** — `colgrep` was never used; every search was an exact symbol or field-name grep (`message: string`, `toolInputPreviewMaxLength`, `renderForwarded`), which is the correct tool for this change.
  The one `missing-context` friction point above would not have been helped by a semantic search either — the stale literals contain the exact string `message:`; what was missing was the habit of grepping `test/` for it, not a better search tool.
- **Feedback-loop gap analysis** — no gap.
  The green baseline ran all four gates before any edit (`check`, root `lint`, `test`, `fallow dead-code`), and each of the six steps closed with `check` + full suite + `lint` before its commit.
  `verify:public-types` was run at step 4, the step that changed the public surface, rather than deferred to the end.

### Changes made

1. `AGENTS.md` — appended `|| true` to the documented warning-count idiom and noted that `biome check --write` will not apply a warning's fix.
2. `.pi/skills/testing/SKILL.md` — added a field-removal rule covering untyped assertion literals in `test/`, under § "Interface and type changes".
3. `packages/pi-permission-system/docs/retro/0745-cross-boundary-payload-swap.md` — this Final Retrospective stage entry.

[#710]: https://github.com/gotgenes/pi-packages/issues/710
[#744]: https://github.com/gotgenes/pi-packages/issues/744
[#746]: https://github.com/gotgenes/pi-packages/issues/746
[#751]: https://github.com/gotgenes/pi-packages/issues/751
[#752]: https://github.com/gotgenes/pi-packages/issues/752
