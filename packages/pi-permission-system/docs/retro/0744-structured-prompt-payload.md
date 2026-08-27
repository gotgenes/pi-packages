---
issue: 744
issue_title: "pi-permission-system: introduce the structured PromptPayload and dissolve the five prompt-assembly sites"
---

# Retro: #744 — Structured `PromptPayload` and the dissolution of the ask-prompt assembly sites

## Stage: Planning (2026-08-15T05:12:37Z)

### Session summary

Planned Phase 13 Step 1: the `PromptPayload` type, the `src/presentation/` domain directory seeded with six payload builders, a transitional `renderLegacyMessage(payload)`, and display-only executed-unit extraction for bash wrappers.
Nine TDD cycles, all hidden changelog types, batched behind Step 2 ([#710]) for release.
Plan committed at `packages/pi-permission-system/docs/plans/0744-structured-prompt-payload.md`.

### Observations

- **Six assembly sites, not five.**
  Both the issue body and [ADR 0011] enumerate five.
  A grep of `src/` for the shared subject idiom (`Current agent`) found `formatPathAskPrompt` in `src/handlers/gates/path.ts`, consumed by **both** `path.ts` and `bash-path.ts`.
  The plan folds it in and lists the count correction as an architecture-doc update.
- **`executedUnit` had no source at all.**
  Issue [#713]'s body cites `classifyAndExtractWrapper`, `payloadText`, and `STRIPPABLE_WRAPPERS` — none of which exist at `main`.
  What exists is `classifyWrapperCommand`, which only *flags* a wrapper.
  So `timeout 10 grep foo` does not surface `grep foo` today, contrary to the issue's "prior work" note.
  Populating the fact required planning a new extraction module with a curated per-wrapper flag table; the operator chose full display-only extraction now over deferring it.
- **Three deliberate divergences from ADR 0011 §2's illustrative shape**, each recorded in the plan with rationale: a `kind` discriminant (nine message shapes are not separable by `(surface, source)`; mirrors `DenialContext`, which ADR §7 already praises), `| null` instead of `| undefined` (Step 3 puts the payload on the JSON wire; matches `accessFactsFromPath`'s existing `boundaryValue` convention), and `commandContext` on the request facts (so `matchQualifier` stays a render rather than a pre-rendered clause in the payload).
- **`renderLegacyMessage` as a completeness proof.**
  Of the three options offered, the operator chose a single renderer that regenerates every message from the payload alone.
  That converts the ~20 existing string assertions from redundant coverage into the proof that the payload carries everything — the alternative (builders returning `{ payload, message }`) would have left the payload unexercised until Step 2.
- **PR [#738] is an unlanded collision**, opened the day before the Phase 13 sweep and untriaged: it touches nearly every file this step rewrites.
  Disposition decided at planning — its highlight intent is adopted in Step 2's renderer with authorship credited, and the PR is closed as superseded at ship time, exactly as [#716] was handled.
  A roadmap disposition line is in the plan's doc updates.
- **`PromptPermissionDetails` is public.**
  It is re-exported through `src/service.ts` and gated by `scripts/verify-public-types.sh`, so the plan adds `PromptPayload` to that script's symbol list.
  Making `payload` required is safe for external `Authorizer` consumers (they read details, never construct them) and is confined to one cycle to absorb the six authority test files.
- **Scope kept narrow deliberately.**
  `tool-preview-formatter.ts` stays at the `src/` root — it also serves `getPermissionLogContext` on the review-log path, which Step 4 owns; its prompt output becomes an evidence entry instead.
  Gating the extracted inner command ([#713]'s second option) is explicitly declined so the wrapper floor stands unchanged.

## Stage: Implementation — TDD (2026-08-15T06:38:38Z)

### Session summary

Landed the `PromptPayload` seam across 12 commits: two tidy-first prep commits, eight `refactor:` cycles, one `docs:`, and one `test:` follow-up from the pre-completion review.
All six ask-prompt assembly sites are dissolved into `src/presentation/` builders, `message` is rendered from the payload alone by a single transitional `renderLegacyMessage`, and `PromptPermissionDetails.payload` is required.
Test count 2836 → 2944 (+108); both roadmap metrics hit target (`formatAskPrompt` refs 4 → 0, `src/presentation/` 0 → 1); behavior byte-identical.

### Observations

- **The tidy-first assessor earned its keep twice.**
  It found that `test/helpers/gate-fixtures.ts` and `test/handlers/gates/runner.test.ts` would break when `payload` became required — both absent from the plan's inventory — and that the plan's "six authority test files" was really five with local factories (plus two with inline literals).
  It also caught a live divergence: three of those factories default `agentName: null` and two default `"test-agent"` **and assert it**, so a naive fold would have silently flipped assertions.
  Landing `makePromptDetails` as a prep commit turned the type-tightening cycle into a one-line change.
- **Plan deviation — module scope.**
  The plan named `executed-unit.ts`.
  Implementing it revealed that nesting (`sudo timeout 5 xargs grep foo`) requires re-classifying each remainder, which would have meant a **second** wrapper classifier beside `classifyWrapperCommand` — connascence of algorithm on a gating-critical vocabulary.
  Shipped instead as `wrapper-analysis.ts` owning both questions, with `classifyWrapperCommand` reduced to a node adapter.
  Cost one extra commit; the classification is now directly unit-testable without a parse, which it never was.
- **The issue's own premise was wrong twice, and both were caught at planning.**
  There is a **sixth** assembler (`formatPathAskPrompt`, two consumers) that the issue and ADR 0011 both omit, and [#713]'s `classifyAndExtractWrapper`/`payloadText`/`STRIPPABLE_WRAPPERS` do not exist — so `executedUnit` had no source at all and needed a new curated extraction module rather than a field read.
- **`renderLegacyMessage` as a completeness proof worked exactly as intended.**
  Because it reads the payload and nothing else, relocating the ~29 old string assertions onto it *is* the proof that the payload carries everything the sentences said.
  Two builder bugs surfaced this way rather than in review: `getNonEmptyString` returns `null`, not `undefined` (my `=== undefined` guard emitted `(full command: 'null')`), and the first `wrapper-analysis` test helper tokenized `"rm -rf /"` into three words where tree-sitter emits one — a fixture bug that looked like five code failures.
- **`| null` over `| undefined` throughout**, diverging from ADR 0011 §2's sketch, because step 3 puts the payload on the JSON wire; `accessFactsFromPath` already set that precedent for `boundaryValue`.
  Likewise `kind` as an explicit discriminant: `(surface, source)` cannot separate the tool and bash external-directory asks.
- **`PromptEvidence.detail`** was added beyond the ADR sketch so an escaping path and its canonical alias ride one entry — a bounded render cannot show the path while eliding what it resolves to.
- **Pre-completion reviewer: PASS.**
  Two non-blocking notes: the seven descriptor tests never gained the payload assertion the plan named, and the `find -exec` terminator is excluded where the plan said "up to and including" (deliberate, tested).
  The first was addressed in a follow-up `test:` commit — but not as written: asserting mere presence is noise when `message` and `payload` come from one local and the field is required, so the tests pin *which kind and value* each gate emits, which is not structurally closed.
- **Deferred to step 2 as planned:** nothing renders `executedUnit` or `invokedToolName` yet, and PR [#738]'s highlight intent is recorded in the roadmap for the dialog renderer, with the PR closing as superseded at ship time.

## Stage: Final Retrospective (2026-08-15T06:48:30Z)

### Session summary

One session carried all four stages — planning, TDD implementation, ship, and this retrospective — landing Phase 13 Step 1 as 13 commits with no user corrections and no rework.
The `PromptPayload` seam replaced six prompt-assembly sites with builders under `src/presentation/`, proved lossless by relocating the existing string assertions onto a renderer that reads only the payload.
Both roadmap metrics hit target, behavior stayed byte-identical, and the pre-completion reviewer returned PASS.

### Observations

#### What went well

- **`renderLegacyMessage` as a completeness proof is a genuinely new pattern here, and it paid immediately.**
  Because the renderer reads the payload and nothing else, relocating the ~29 existing string assertions onto it *is* the proof that the payload is lossless — no new assertion had to be invented to establish it.
  It caught two real defects during implementation that the rejected alternative (builders returning `{ payload, message }`) would have hidden until Step 2: a `getNonEmptyString` guard written against `undefined` when it returns `null` (emitting `(full command: 'null')`), and a payload field that would have gone unexercised.
  The operator picked this shape from three options at the planning gate; the two weaker options would both have left the payload unverified.
- **The tidy-first assessor had its highest-value run yet**, and its findings were not cosmetic.
  It identified `test/helpers/gate-fixtures.ts` and `test/handlers/gates/runner.test.ts` as breaking when `payload` became required — both absent from the plan's inventory — and found a live divergence across the five authority `makeDetails` factories: three default `agentName: null`, two default `"test-agent"` **and assert it**.
  A naive fold into one shared default would have silently flipped passing assertions.
  Landing `makePromptDetails` as a prep commit reduced the type-tightening cycle to a one-line change.
- **Treating a first-party issue's body as a hypothesis rather than a spec caught two false premises.**
  The issue is operator-authored, so the `/plan-issue` discipline that exists mainly for third-party issues was still applied — and found that the "five assembly sites" are six (`formatPathAskPrompt`, with two consumers, omitted by both the issue and [ADR 0011]), and that [#713]'s cited `classifyAndExtractWrapper`/`payloadText`/`STRIPPABLE_WRAPPERS` do not exist at `main`, so `executedUnit` had no source and needed a new extraction module rather than a field read.
  Both corrections landed in the architecture doc.
- **A mid-implementation design discovery was escalated rather than absorbed.**
  Nesting (`sudo timeout 5 xargs grep foo`) turned out to require re-classifying each remainder, which would have meant a second wrapper classifier beside `classifyWrapperCommand` — connascence of algorithm on gating-critical vocabulary.
  Shipping `wrapper-analysis.ts` owning both questions cost one extra commit and made the classification directly unit-testable without a parse, which it never was.

#### What caused friction (agent side)

1. `instruction-violation` (self-identified) — two `Edit` calls used an `oldText` spanning a decorative comment rule (`── Helpers ──`, `── Wrapper vocabulary ──`) whose `─` run length did not match the file.
   `AGENTS.md` names this exact trap and says to anchor on adjacent unique code lines instead.
   Impact: two rejected `Edit` batches plus two `sed -n` re-reads to recover — about four wasted tool calls, no rework.
2. `instruction-violation` (self-identified) — `echo ===` as a shell separator tripped zsh's `equals` expansion (`zsh:1: == not found`) and discarded the rest of the `A; B` chain.
   `AGENTS.md` says plainly: use `echo ---`.
   Impact: one lost command, re-run immediately.
3. `other` — two `Edit` calls converted an object literal into a function call by replacing only one delimiter, leaving the file unparseable: `delegation-envelope.test.ts` kept `};` where `});` was needed, and `permission-prompts.test.ts` kept `return {` against an orphaned `)`.
   The autoformat hook's biome parse error caught both instantly.
   Impact: two recovery edits, no rework.
   `AGENTS.md`'s paired-delimiter rule covers *wrapping* lines in a new block but does not name literal-to-call conversion, which is the same hazard.
4. `missing-context` — the plan's Module-Level Changes omitted the two files that a **newly required** field would break.
   The `/plan-issue` prompt has a grep obligation for *tightening an existing optional field* ([#611]) but none for *adding a new required field*, where there is no `<field>: undefined` literal to match and the real target is constructors of the type — shared `test/helpers/` factories especially.
   Impact: none this time — the tidy-first assessor caught it pre-implementation — but without that dispatch it would have been a mid-cycle compile surprise.
5. `other` — a test-fixture bug presented as five code failures: the first `wrapper-analysis` test helper split on whitespace, so `"rm -rf /"` became three words where tree-sitter emits a quoted argument as one named child.
   Impact: one diagnostic cycle, resolved by fixing the fixture rather than the code.
6. `other` — one `Edit` used a fabricated absolute path with a doubled package segment (`…/pi-permission-system/packages/pi-permission-system/…`), which this package's own `external_directory` gate blocked with a message naming the correct path.
   Impact: one denied call, corrected immediately.

#### What caused friction (user side)

- None.
  The four planning answers (full extraction now, assemblers-only migration, single renderer, PR [#738] disposition) were decisive and shaped the whole implementation; the release-defer answer at ship was immediate.
  Involvement was strategic rather than mechanical throughout.
- One small process wrinkle, not a user issue: the ship prompt asks the defer-or-release question **before** any git work, but its own later step establishes that a range of exclusively hidden-type commits would release nothing either way.
  Here every commit was `refactor:`/`test:`/`docs:`, so the question was moot by the time it was answered.

### Diagnostic details

- **Model-performance correlation** — planning, TDD, and this retrospective ran on `anthropic/claude-opus-5`; the ship stage ran on `anthropic/claude-sonnet-5`.
  An appropriate split: shipping is a deterministic checklist, while planning and TDD carried the design judgment.
  Both subagents ran `anthropic/claude-sonnet-5` per their frontmatter and both handled judgment-heavy work well — the pre-completion reviewer traced byte-identity character-for-character across all six retired assemblers and independently recomputed both roadmap metrics.
  No mismatch in either direction.
- **Escalation-delay tracking** — no `rabbit-hole` friction points.
  The longest single-error sequence was three tool calls (diagnosing the fixture tokenizer: run, inspect failures, read the helper), well under the five-call threshold.
- **Unused-tool detection** — the one `missing-context` point was caught by the tidy-first assessor, which is precisely the tool for it.
  `colgrep` went unused, correctly: every search here was exact-symbol (`formatAskPrompt`, `promptDetails`, `wrapperKind`), which the `colgrep` skill's decision table assigns to `grep`.
- **Feedback-loop gap analysis** — verification ran incrementally, not just at the end.
  `pnpm exec vitest run <file>` after every red and green; `pnpm run check` after each shared-type change, which caught a dropped `import type` in `authorizer-chain.test.ts` that vitest passed; root `pnpm run lint` and `pnpm fallow dead-code` at each commit boundary.
  `fallow` caught two speculative exports (`localRequester`, `evidenceEntry`) at cycle 4, before they could accumulate.
  No gap.

### Changes made

1. `.pi/prompts/plan-issue.md` — added a Module-Level Changes grep obligation for a **newly required** interface field: grep constructors of the type (inline object literals and `test/helpers/` factories) rather than its use sites, since the [#611] optional-to-required grep has no `<field>: undefined` literal to match when the field never existed.

Three further proposals were surfaced and declined by the operator, recorded here so a later session does not re-derive them:

1. A `code-design` subsection on proving a representation change lossless via a transitional renderer over the new representation alone.
2. Extending `AGENTS.md`'s paired-delimiter `Edit` rule to cover converting an object literal into a call.
3. Adding a hidden-type-range check to `ship-issue.md`'s release-coordination section so a moot defer question is skipped.

[#611]: https://github.com/gotgenes/pi-packages/issues/611
[#710]: https://github.com/gotgenes/pi-packages/issues/710
[#713]: https://github.com/gotgenes/pi-packages/issues/713
[#716]: https://github.com/gotgenes/pi-packages/pull/716
[#738]: https://github.com/gotgenes/pi-packages/pull/738
[ADR 0011]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0011-prompt-presentation-contract.md
