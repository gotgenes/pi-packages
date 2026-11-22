---
issue: 635
issue_title: "Forwarded accessIntent is dropped before Authorizer Chain escalation"
---

# Retro: #635 — Forwarded accessIntent is dropped before Authorizer Chain escalation

## Stage: Planning (2026-07-26T17:26:32Z)

### Session summary

Planned the fix for a third-party bug report (`LukeWang-Plus`): `buildForwardedAskDetails()` in `src/authority/forwarded-request-server.ts` drops `request.accessIntent` when reconstructing `PromptPermissionDetails` for a forwarded ask, so an Authorizer Chain link receives display strings instead of the child-fixed access facts.
Tracing the consumer surfaced a **second**, unreported defect from the same missing field: `delegation-envelope.ts` decides exclusion with `details.accessIntent?.surface ?? details.surface`, so a forwarded ask falls back to the *display* surface (the tool name, e.g. `write`) and a chain link's `allow` on a forwarded `path`-gate ask escapes the bounded-delegation checkpoint that ADR 0007 §5 applies to the identical local ask.
Plan committed at `packages/pi-permission-system/docs/plans/0635-forwarded-access-intent-to-authorizer.md` as two steps: one red→green cycle (projection + envelope pin + user-facing breaking-change docs) and one docs commit.

### Observations

- Third-party issue, so the `ask_user` direction gate was mandatory.
  It took three rounds: the operator first asked how #635 relates to #610 (which also has a provenance/serving-node flavor), then asked for concrete examples of the envelope side effect before deciding.
  Both follow-ups were legitimate — the first ask presented the envelope consequence abstractly, and an abstract security-boundary tradeoff is not decidable.
  Lesson for future planning asks: when a question is about a *behavior change*, lead with the concrete before/after scenarios, not the option labels.
- Operator decisions: (a) plan **#635 alone** but record the shared cross-issue principle so #610's planning session inherits a decided frame; (b) **accept** the delegation tightening and ship it as a **breaking change** (`fix(pi-permission-system)!:`, `23.0.3` → `24.0.0`).
- The #610 relationship resolved into a coherent principle rather than a merge: both issues stem from the serving node reconstructing a degraded projection of the forwarded request, but they pull in **opposite** disclosure directions — #635 wants richer evidence on a trusted in-process seam, #610 explicitly wants *less* text on the any-extension `pi.events` broadcast.
  The principle recorded as "Reconstruction fidelity at the serving node" (fidelity up for in-process seams, disclosure down for broadcasts) covers both halves.
  It goes in `docs/architecture/architecture.md` under `## The authority model`, not a new ADR — it is descriptive of already-decided architecture (ADR 0007 §5, ADR 0008 §2).
- The fix realizes an assertion ADR 0008 already makes: "a serving node's chain links … review forwarded asks against the child-fixed fact set."
  So the ADR needs no edit; the code was simply not yet true to it.
- Disclosure boundary is the sharp design point.
  `ForwardedAccessIntent` is structurally assignable to `ForwardedAccessFacts`, so `accessIntent: request.accessIntent` type-checks while carrying `requesterCwd` and `principal` at runtime — a silent widening `tsc` cannot catch.
  The plan uses a field-by-field `toAccessFacts` helper with an explicit `ForwardedAccessFacts` return type (compile-checked against future field drift) plus an exact-keys test assertion.
- Verified rather than argued that the `permissions:ui_prompt` payload is unaffected: `buildUiPrompt` (`src/permission-ui-prompt.ts`) reads only `requestId`/`source`/`surface`/`value`/`agentName`/`message`/`forwarding` and never `accessIntent`, so the #292 non-degraded-broadcast contract is byte-identical after the change.
- Scoping check that narrowed the blast radius: the tightening bites **only** when the cross-cutting `path` / `external_directory` gate raised the forwarded ask.
  A `bash` ask and a per-tool ask (where `tool.ts` sets `gateSurface = tcc.toolName`) already agree with the display surface, so they are unchanged — which also means #620's allow-capable opaque-**bash** adjudicator is untouched by this fix.
- Test-gap note worth carrying into implementation: `delegation-envelope.test.ts` tests the envelope over synthetic details and `forwarded-request-server.test.ts` tests the server over a fake escalator, but nothing composed the two.
  That gap is exactly why the forwarded escape went unnoticed, so the plan adds a composition test rather than two more unit assertions.
- Only one exact-object assertion on `escalate` exists in the suite (`grep -rn "escalate).toHaveBeenCalledWith({" test/` → 1 hit), so the red step is well bounded.
- No follow-up issues filed — #610 and #620 already exist and cover the deferred work.

## Stage: Implementation — TDD (2026-07-26T17:41:26Z)

### Session summary

Implemented both planned steps in two commits: `c0790ad6` (`fix!`) landed the `toAccessFacts` projection in `buildForwardedAskDetails`, the corrected `PromptPermissionDetails.accessIntent` doc comment, four tests, the migration note, and the `docs/configuration.md` sentence; `08164e85` (`docs`) landed the architecture doc's new "Reconstruction fidelity at the serving node" subsection, the `forwarded-request-server.ts` module-tree clause, and the package skill update.
Production change was ~20 lines (one new module-private function plus a conditional spread).
Test count 2668 → 2672 (+4); `check`, root `lint`, full `test`, and `fallow dead-code` all green.

### Observations

- The `tidy-first-assessor` returned "no preparatory tidying warranted" and explicitly declined to extract the file-local `makeQuery`/`makeLink`/`makeDetails` helpers from `delegation-envelope.test.ts` and `authorizer-selection.test.ts`, reasoning that the change touches neither file and that the new composition test deliberately uses the *real* captured details rather than a synthetic `makeDetails`.
  That is the correct scope boundary, and a useful data point for the assessor's first-live-use checkpoint.
- The red step was strong evidence rather than ceremony: the envelope-composition test failed with `expected { kind: 'allow' } to deeply equal { kind: 'defer' }`, which *demonstrated* the checkpoint escape rather than merely asserting the plan's claim about it.
  The plan predicted three of the five new/edited assertions would fail; exactly those three did, and the two written as guards (forwarded `bash` passes through; version-skew absence) passed from the start, confirming they guard rather than drive.
- Deviation from the plan, deliberate: the plan's invariants table proposed pinning the disclosure boundary with `Object.keys(details.accessIntent).sort()`.
  A whole-object `toEqual` on `details.accessIntent` is strictly stronger — `toEqual` requires matching key sets for non-`undefined` values, so it rejects a leaked `requesterCwd`/`principal` *and* pins the values — and matches the testing skill's "prefer strong assertions that match the entire expected value".
  The pre-completion reviewer independently endorsed this.
- `rumdl`'s `MD057` false-positived on the new `docs/configuration.md` migration link when it sat inside a parenthetical at the end of a very long line (column 321), reporting the target "does not exist" although it did.
  Splitting the line into three sentences (the project's one-sentence-per-line convention anyway) cleared it.
  Worth remembering: an `MD057` "does not exist" on a link whose target demonstrably exists is a line-length/parse artifact, not a broken path — fix the line, do not go hunting the path.
- No production change was needed in `delegation-envelope.ts`.
  Its existing `details.accessIntent?.surface ?? details.surface` already preferred the gate-authoritative surface; it simply never had one for a forwarded ask.
  The fix is entirely upstream of the checkpoint, which is why the blast radius stayed as narrow as the plan predicted.
- Pre-completion reviewer: **PASS** — ready for `/ship-issue`.
  No warnings.
  It independently verified all five invariants (including grepping `buildUiPrompt` to confirm it never reads `accessIntent`, rather than accepting the plan's claim) and confirmed zero diff on `delegation-envelope.ts`, `permission-ui-prompt.ts`, and `forwarding-io.ts`.

## Stage: Final Retrospective (2026-07-26T18:02:31Z)

### Session summary

One continuous session carried #635 from a third-party bug report through planning, TDD, and ship: `pi-permission-system@24.0.0` released with a ~20-line production change (`toAccessFacts` projection in `buildForwardedAskDetails`), four new tests, a migration note, and a new architecture-doc principle.
The reported defect (an Authorizer Chain link receiving no structured access facts for a forwarded ask) came with a second, unreported one attached: the bounded-delegation checkpoint was reading the display surface for forwarded asks, so a forwarded `path` ask escaped an exclusion the identical local ask was subject to.
The dominant friction was a three-round `ask_user` gate that only became decidable once concrete before/after scenarios replaced abstract option labels.

### Observations

#### What went well

- **The `/plan-issue` third-party gate created the space that found the second bug.**
  Because the prompt forbids treating a third-party issue as a spec, the session traced the *consumer* of the dropped field (`delegation-envelope.ts`) instead of implementing the reported three-line fix directly.
  That trace is what surfaced the checkpoint escape — a higher-severity defect than the one filed.
  Had the issue been the operator's own, the "proposed change is the working hypothesis" path would plausibly have shipped the reported fix and the escape silently along with it.
- **The red step produced evidence, not ceremony.**
  The new composition test failed with `expected { kind: 'allow' } to deeply equal { kind: 'defer' }` — a literal demonstration of the security escape, not an assertion of the plan's claim about it.
  The plan had predicted the exact test gap that hid the bug (`delegation-envelope.test.ts` tests the envelope over synthetic details; `forwarded-request-server.test.ts` tests the server over a fake escalator; nothing composed the two), and predicted which three of five assertions would fail.
  All three predictions held.
- **A disclosure boundary was made compile-checked rather than commented.**
  `ForwardedAccessIntent extends ForwardedAccessFacts`, so the obvious `accessIntent: request.accessIntent` type-checks while leaking `requesterCwd`/`principal` at runtime.
  The field-by-field `toAccessFacts` helper with an explicit `ForwardedAccessFacts` return type turns any future field on that interface into a compile error at the projection site.
- **`tidy-first-assessor` scope boundary held again**, declining to extract shared helpers from `delegation-envelope.test.ts` / `authorizer-selection.test.ts` because the change touches neither file.

#### What caused friction (agent side)

- `missing-context` — the first `ask_user` presented the bounded-delegation side effect as three abstract option labels ("accept the tightening / accept as breaking / preserve") with no concrete scenario.
  The operator bounced it twice: first asking how #635 related to #610, then "Give me some concrete examples to help me understand."
  Every fact needed for the A/B/C scenario table (forwarded `bash` unchanged, forwarded `path`-gate changed, forwarded per-tool-gate unchanged) was already loaded in context at the time of the first ask — `tool.ts`, `path.ts`, `delegation-envelope.ts`, and `permission-ui-prompt.ts` had all been read.
  Impact: two extra operator round-trips and 2 extra `gh issue view` calls (#610, #620); no rework of any artifact, since nothing had been written yet.
- `missing-context` — related open issues were never searched for.
  Step 4 of `/plan-issue` says to read every issue **the body references**; #635's body references none, so the sweep returned nothing and the session asked its first question without knowing #610 existed.
  The operator supplied it.
  Impact: folded into the round-trip cost above; also meant the cross-issue principle (the eventual "Reconstruction fidelity at the serving node" subsection) was operator-prompted rather than agent-proposed.
- `instruction-violation` (self-identified) — the new `docs/configuration.md` sentence was written as a single 321-column line with three sentences in it, violating the `markdown-conventions` one-sentence-per-line rule.
  `rumdl` reported it as `MD057` "Relative link ... does not exist" for a file that demonstrably existed, sending the session to verify the path (`ls -la docs/migration/`) before recognizing the real cause.
  Impact: 4 tool calls; fixed by splitting the sentence, which was the correct formatting anyway.
- `other` (path slip) — a `read` used `/Users/chris/development/pi/pi-permission-system/...`, dropping the `pi-packages/packages/` segment.
  Impact: 1 wasted call.
  Worth recording as dogfooding: this package's own `external_directory` gate denied it and the denial message named the corrected absolute path, so recovery was immediate.
- `other` (typo) — `git log --oneline 3` instead of `-3`.
  Impact: 1 wasted call.
- `instruction-violation` (self-identified) — the retro session loaded the `github-voice` skill, which the `/retro` prompt does not list.
  Impact: wasted context, no rework.

#### What caused friction (user side)

- Nothing to correct — both operator bounces were the right intervention and materially improved the outcome.
  The second ("give me concrete examples") converted an undecidable abstract security tradeoff into a decision the operator made confidently in one round.
  The one forward-looking opportunity: the operator was holding #610 as relevant context before the first ask.
  Surfacing a known-related issue at issue-triage time would have shortcut a round — though the more robust fix is on the agent side, since the agent should search for siblings rather than depend on the operator remembering.

### Diagnostic details

- **Model-performance correlation** — well matched, no mismatch found.
  Planning, TDD, and this retrospective ran on `anthropic/claude-opus-5` (judgment-heavy: a security-boundary tradeoff, a breaking-change call, and a cross-issue design principle).
  Ship ran on `anthropic/claude-sonnet-5` (mechanical: push, CI polling, release-PR merge) — appropriate cost placement.
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `anthropic/claude-sonnet-5`, correct for read-only judgment work.
- **Escalation-delay tracking** — no `rabbit-hole` friction points.
  The longest same-error sequence was the `MD057` false positive at 3 consecutive calls, well under the 5-call escalation threshold.
- **Unused-tool detection** — for the related-issue `missing-context`: `gh issue list --state open --search` was available and never run, and `colgrep` was never used to find other open work touching `forwarded-request-server.ts`.
  Either would have surfaced #610 without the operator supplying it.
- **Feedback-loop gap analysis** — no gap.
  Verification ran incrementally throughout: full `check`/`lint`/`test` baseline before any edit; file-scoped `vitest` on red and again on green; package-scoped `check` plus full package suite immediately after the green edit; root `lint` after each documentation edit (which is what caught the `MD057` artifact before commit); full `test`/`check`/root `lint`/`fallow dead-code` after the last step; `lint` and `fallow` again as pre-push gates.
- **Assessor checkpoint status** — the `tidy-first` skill carries a "first-live-use checkpoint (added 2026-07-13)" instructing removal once the scope boundary has held across a handful of issues.
  42 retro files now reference the assessor, with the boundary explicitly recorded as holding in `0579`, `0594`, `0611`, and this one, and its recommendations taken as-is in `0538` and `0611`.
  The validation window is well past "a handful."
  Operator decision at retro: do not retire it yet — the assessor's frequent "no preparatory tidying warranted" verdict is exactly what a weaker model would also produce, so the checkpoint is narrowed to one more validation run on `anthropic/claude-opus-5` before deletion.

### Changes made

1. `.pi/prompts/plan-issue.md` (Decide section) — added the rule that an `ask_user` option set whose differentiator is a behavior change must carry the concrete before/after in the pre-ask message, alongside the existing #533 unfamiliar-domain rule.
2. `.pi/prompts/plan-issue.md` (Gather context step 4) — extended related-issue gathering past body-referenced issues to an open-issue search on the same module or symbol.
3. `.pi/skills/markdown-conventions/SKILL.md` (Lines and sentences) — added the `MD057`-false-positive mapping: an existing relative link reported missing is a long-sentence artifact, not a broken path.
4. `.pi/skills/tidy-first/SKILL.md` — rewrote the first-live-use checkpoint as a **model** checkpoint rather than deleting it: the scope boundary has held, but the next dispatch over a structurally substantial change must run on `anthropic/claude-opus-5` to confirm the recurring "nothing warranted" verdict is genuine and not a model-strength artifact.
