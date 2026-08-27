---
issue: 710
issue_title: "pi-permission-system: Forwarded subagent permission prompts render unbounded tool input inline and push the parent transcript out of view"
---

# Retro: #710 — Bounded local renderers for the permission dialog

## Stage: Planning (2026-08-15T07:18:11Z)

### Session summary

Planned Phase 13 Step 2: `src/presentation/dialog-renderer.ts` rendering the landed `PromptPayload` under a row budget plus a per-field width cap, wired into the inline TUI dialog and the `select`/`input` fallback, with `Ctrl+O` toggling the complete view.
Nine TDD cycles; batch `"presentation-payload"` tail, so this issue's `fix:` is the release vehicle for Step 1 ([#744]) as well.
Plan committed at `packages/pi-permission-system/docs/plans/0710-bounded-dialog-renderer.md`.

### Observations

- **The issue is third-party (`aoguai`), but the direction was already settled.**
  [ADR 0011] adopted [#710] as "fixed by construction" and the Phase 13 roadmap assigns it to Step 2, so the `ask_user` gate spent its budget on design parameters rather than on whether to build it.
- **Measured, not estimated.**
  A disposable spike over the real `wrapTextWithAnsi` put the reported case at **202 rows** local / **205 rows** forwarded for a 200-line here-string (10 236 chars), identical at widths 80/120/160 — the here-string carries its own newlines, so a wider terminal buys nothing.
  That number is the plan's baseline and becomes a regression assertion.
- **[ADR 0011] §3 and §5 only cohere under one reading, and this plan states it.**
  §3 says no budget may elide the `request` core; §5 justifies the width cap by "a here-string on one logical line" — which in this very report *is* `request.value`.
  Operator confirmed: "never elided" means never **omitted**, so a core fact always keeps its labelled line while its text may be shortened and reached in full.
  Under the alternative reading the reported ask still costs 86–202 rows and [#710] is not fixed, so this is load-bearing and goes into the architecture doc.
- **The row budget bounds evidence; the field cap bounds the core.**
  Stating the precedence explicitly (§3 outranks §5 when a capped core alone exceeds `maxRows`) avoided a shrink-to-fit algorithm that would have been fiddly to test and impossible to explain.
- **`Ctrl+O` reuse over a new key.**
  `handleToolsExpandAction` already intercepts `app.tools.expand` for the host forward ([#642]); it gains the dialog's own toggle so "expand" means one thing in both places, and the [#642] forward assertion is extended in the same cycle that adds the toggle.
- **PR [#738]'s `highlightText` field is redundant under the payload.**
  The flagged element is derivable from `request.value` (or the `external path` evidence for the bash external-directory kind), which removes the "highlight target diverges from rendered text" risk the PR guarded with tests.
  Both PR [#738] and PR [#716] close as superseded at ship, with `Co-authored-by` credit in the relevant cycles.
- **Config defaults chosen roomy:** `promptMaxRows` 24, `promptFieldMaxWidth` 400.
  The field cap does the work for the reported case (400 chars ≈ 4 rows at width 100); the row budget mostly bounds evidence.
- **Rejected:** an expansion affordance in the `select`/`input` fallback.
  [ADR 0011] §6 records that renderer as assuming none and a `select` has no keystroke channel; recorded as rationale in Open Questions rather than filed as a follow-up.
- **No follow-up issues filed.**
  Every deferral this plan names already has an issue — [#745] (wire + broadcast + preview-cap soft-deprecation), [#746] (agent + review-log renderers), [#654] (annotations), [#519] (RPC/frontend prompt surface).

[#519]: https://github.com/gotgenes/pi-packages/issues/519
[#642]: https://github.com/gotgenes/pi-packages/issues/642
[#654]: https://github.com/gotgenes/pi-packages/issues/654
[#710]: https://github.com/gotgenes/pi-packages/issues/710
[#716]: https://github.com/gotgenes/pi-packages/pull/716
[#738]: https://github.com/gotgenes/pi-packages/pull/738
[#744]: https://github.com/gotgenes/pi-packages/issues/744
[#745]: https://github.com/gotgenes/pi-packages/issues/745
[#746]: https://github.com/gotgenes/pi-packages/issues/746
[ADR 0011]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0011-prompt-presentation-contract.md

## Stage: Implementation — TDD (2026-08-15T07:57:35Z)

### Session summary

Landed Phase 13 Step 2 in 15 commits: three tidy-first preparatory commits, nine planned cycles, and two commits answering the pre-completion review.
The inline dialog and the `select`/`input` fallback now render the structured payload through `src/presentation/dialog-renderer.ts` under a row budget plus a per-field width cap, with `Ctrl+O` expanding to the complete request.
Test count 2944 → 2978 (+34); `check`, root `lint` (0 findings), `fallow dead-code`, and `verify:public-types` all clean.

### Observations

- **The field cap, not the row budget, is what fixes [#710].**
  The repro test passed the moment the per-field cap landed (cycle 3), before the row bound existed: the here-string is `request.value`, so capping it took the render from 205 rows to about 11.
  The row budget bounds the *evidence* — which is exactly the division of labour the plan predicted, but it was worth seeing the cycle-3 test go green to know which mechanism carries the fix.
- **The dedup rule surfaced a test expectation that was wrong, not code that was.**
  Cycle 1's `path`-ask expectation asserted a `surface : path` line; the renderer dropped it because the value line's own label already says `path`.
  The renderer was right and the expectation was fixed — but the pre-completion reviewer then correctly flagged that this omission is a *second* mechanism by which a core line can be absent, distinct from the width cap the docs described.
  Both `architecture.md` and `docs/configuration.md` now state the redundancy rule beside the never-omitted rule so neither reads as the other.
- **`Ctrl+O` needed no change to the host forward.**
  The toggle went into `handleInput` at the one place that both knows the component and already treats the keystroke as handled, so `handleToolsExpandAction` is untouched and [#642]'s invariant holds by construction rather than by care.
- **Plan deviations, all small:**
  the `Paint` seam shipped as `HighlightPaint = (text: string) => string` rather than the plan's `(role, text)` — no caller ever needed a `"label"` role, and an unused parameter would have been speculative;
  the seam was introduced in cycle 5 (where it is used) rather than cycle 1 (where it would have been dead);
  `authorizer.ts`, `permission-dialog.test.ts`, `config-schema.test.ts`, and `config-reporter.test.ts` were listed in Module-Level Changes but needed no edit;
  and `config-pipeline.test.ts` was edited but not listed — it is the strongest place to pin the #332/#347 config-drop class, which the plan named as a risk without naming its test.
- **The tidy-first assessor found two `PromptPreferences` construction sites the plan's own grep obligation missed** (both inline in `local-user-authorizer.test.ts`), which is the same class of miss [#744]'s retro recorded.
  Landing the shared fixture first turned cycle 7's widening into a one-line change; the `PermissionPromptView` cast removal turned a would-be runtime surprise into a compile error.
- **One self-inflicted friction point:** an `Edit` call used a fabricated absolute path with a doubled package segment, which this package's own `external_directory` gate blocked with a message naming the correct path.
  Same mistake the [#744] session recorded — the gate caught it both times.
- **Pre-completion reviewer: WARN** (no FAILs).
  Both findings were addressed rather than deferred: the documentation-precision nit on the redundancy rule, and a local variable in `coreFacts` named `value` while holding a label.
  Its third note (the narrower `Paint` type, the unlisted test file) is recorded above as a deviation.

## Stage: Final Retrospective (2026-08-15T16:19:51Z)

### Session summary

One session carried planning, TDD implementation, ship, and this retrospective for Phase 13 Step 2: the bounded permission-dialog renderer.
Seventeen commits landed `pi-permission-system@25.3.0`, closing [#710] and [#713] and superseding PRs [#716] and [#738] with authorship credited.
The single user intervention of the session — a question about commit typing — exposed a changelog-honesty problem that cost a six-commit history rewrite and uncovered a silent co-authorship defect.

### Observations

#### What went well

- **A planning-time measurement drove a design decision, not just a plan sentence.**
  A disposable vitest spike over the real `wrapTextWithAnsi` put the reported ask at 202 rows locally / 205 forwarded.
  That number then did five jobs: it proved [ADR 0011] §3 and §5 only cohere under one reading (the field cap must apply to the core, or the reported ask stays at 86–202 rows), it grounded the `ask_user` option set, it became the plan's predicted-effect table, it became a regression assertion in `test/presentation/dialog-renderer.test.ts`, and it became the evidence in the issue close comment.
  The `/plan-issue` measurement rule exists to avoid false precision; here the measurement changed the design rather than decorating it.
- **The tidy-first assessor caught the residue of a rule added one session earlier.**
  [#744]'s retro added a `/plan-issue` grep obligation for a **newly required** interface field (grep constructors, not use sites).
  This plan followed it and still missed two inline `PromptPreferences` constructions in `local-user-authorizer.test.ts`.
  The assessor found both, plus the `as unknown as PermissionPromptView` casts that would have let a missing `budget` field compile clean.
  A rule plus a fresh-context backstop caught what the rule alone did not.
- **TDD ordering produced a diagnostic the plan could not.**
  The [#710] repro assertion went green at cycle 3, before the row bound existed — proving the *field cap* is what fixes the reported case and the row budget only bounds evidence.
  The plan predicted that division of labour; the cycle order demonstrated it.
- **Tree-identity verification made a six-commit history rewrite safe.**
  Every rebase pass was checked with `git diff --stat pre-retype-710 HEAD` against a backup tag, not by reading the rebase's own output — which is exactly what caught the silent no-op below.

#### What caused friction (agent side)

1. `missing-context` (user-caught) — five cycles that built a module nothing imported yet were typed `feat:`, and the wiring commit that changed every user's prompt appearance was typed `fix:`.
   The precedent was already in a document read during planning: [#744]'s retro records Step 1 as an "all-hidden commit range" for exactly this situation.
   The plan then propagated the wrong types into its TDD Order, and implementation followed the plan faithfully.
   Impact: a user correction, a six-commit `GIT_SEQUENCE_EDITOR` rewrite, and roughly 15 tool calls.
   The published changelog would otherwise have read as a construction diary — seven feature lines including two near-identical "bound the …" entries describing an internal seam — with the appearance change filed under Bug Fixes.
2. `other` (self-identified) — the first scripted rebase reported `Successfully rebased and updated refs/heads/main` while changing not one subject.
   This git writes its todo as `pick <sha> # <subject>`; the sequence-editor pattern expected no `#`, so every line stayed `pick` and the rebase replayed as a no-op.
   Impact: three diagnostic tool calls (dry run on a fake todo, `git config` check, dumping the real todo) plus a re-run.
   Caught by diffing the subjects afterwards, not by the rebase's exit message — the same class as `AGENTS.md`'s `tail`-masking trap, where the status comes from the wrong thing.
3. `other` (self-identified) — `Co-authored-by:` was written *above* the `Refs #710, #716` paragraph, so git's trailer parser saw no trailer block at all and GitHub would not have attributed either contributor.
   `Refs #710, #716` has no colon, so it is not trailer-shaped, and it was the final paragraph.
   Verified both ways with `git interpret-trailers --parse`: empty for the shipped ordering, correct for `Refs` first.
   Impact: one more rebase pass (three tool calls) — but the real cost was a false claim, since the turn-200 summary had already told the operator credit was given.
   This is a direct collision with `AGENTS.md`'s own house style, which puts `Refs #N` last.
4. `instruction-violation` (self-identified) — an `eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing` was added preemptively in `permission-prompt-component.ts`; the rule never fired, so lint rejected the unused directive.
   The `code-design` skill states the rule plainly: add a disable only after the linter reports it.
   Impact: one lint failure, one removal edit, one re-run.
   No new rule warranted — the existing one is correct and the root-level lint caught it inside the same cycle.
5. `instruction-violation` (self-identified) — one `Edit` used a fabricated absolute path with a doubled package segment (`…/pi/pi-permission-system/test/…` instead of `…/pi/pi-packages/packages/pi-permission-system/test/…`).
   Impact: one denied call, corrected immediately.
   Second consecutive session with this exact error ([#744]'s retro records the first).
   No rule proposed: this package's own `external_directory` gate blocked it and named the correct path, which is the backstop working as designed.
6. `instruction-violation` (self-identified) — this retro entry re-added `[#710]:` and `[ADR 0011]:` link definitions that the planning stage had already defined, tripping `MD053`.
   The `markdown-conventions` skill names this exact case: link reference definitions are file-scoped, so an appended stage references them without redefining.
   Impact: one `rumdl` failure and one removal edit, caught before the commit.

[#713]: https://github.com/gotgenes/pi-packages/issues/713

#### What caused friction (user side)

- None.
  The session's one intervention was a redirecting **question** ("Shouldn't a fresh presentation to the user at least warrant a feat?") rather than a correction, and it was strictly better than a correction would have been: it surfaced the literal mis-typing *and*, on investigation, the larger diary-changelog problem the question did not name.
- One structural opportunity, not a user failure: the commit types were visible in the plan's TDD Order at plan-review time, but a list of nine `feat:`/`fix:` subjects is not legible as "what the changelog will say".
  Nothing in the workflow renders that view, so there was nothing cheap for the operator to react to until the commits existed.

### Diagnostic details

- **Model-performance correlation** — planning, TDD, the commit-retype, and this retrospective ran on `anthropic/claude-opus-5`; the ship stage ran on `anthropic/claude-sonnet-5`.
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran `anthropic/claude-sonnet-5` per their frontmatter.
  The split is appropriate and matches [#744]: shipping is a deterministic checklist, while planning and TDD carried the design judgment.
  No mismatch in either direction — both subagents did judgment-heavy work well, the assessor finding fixture sites the plan's grep missed and the reviewer catching a documentation-precision gap about a second omission mechanism.
- **Escalation-delay tracking** — no `rabbit-hole` friction points.
  The longest single-error sequence was three tool calls (diagnosing the rebase no-op), well under the five-call threshold.
- **Unused-tool detection** — nothing missed.
  `colgrep` went unused, correctly: every search was exact-symbol (`formatAskPrompt`, `doublePressToConfirm`, `requestPermissionDecision`), which the `colgrep` skill's decision table assigns to `grep`.
- **Feedback-loop gap analysis** — no gap.
  `pnpm run check` plus the cycle-scoped `vitest run <file>` ran after every red and green; root `pnpm run lint` ran before every commit, which is what caught the speculative `eslint-disable` inside its own cycle; `pnpm run test`, `pnpm fallow dead-code`, and `verify:public-types` ran at the end and again after the retype.

### Changes made

1. `AGENTS.md` § Commits — type a commit by what a user can observe once it lands, not by what it adds to the tree; a module nothing imports yet is `refactor:` and the wiring commit carries the `feat:`/`fix:`.
2. `AGENTS.md` § Commits — `Co-authored-by:` belongs in the final paragraph, below `Refs #N`, because git reads only the last paragraph as trailers and `Refs #N` is not trailer-shaped; verify with `git interpret-trailers --parse`.
3. `AGENTS.md` § Commits — a scripted rebase reports `Successfully rebased` even when its sequence editor matched nothing, since this git writes its todo as `pick <sha> # <subject>`; verify by diffing subjects and confirm content with `git diff <backup-tag> HEAD`.
4. `.pi/prompts/tdd-plan.md` — added a changelog-preview check to "After the last TDD step" (new item 9), so a commit describing an internal seam is retyped before anything is pushed.

Four candidates were considered and declined, recorded so a later session does not re-derive them:

1. A rule for the doubled-package-segment `Edit` path (second consecutive session) — the `external_directory` gate blocks it and names the correct path, so the backstop already works.
2. Added emphasis on `code-design`'s speculative-`eslint-disable` rule — the rule is adequate and root lint caught the violation inside its own cycle.
3. A `markdown-conventions` change for duplicate link-reference definitions — the skill already names this exact case and `rumdl` caught it pre-commit.
4. Putting the changelog preview in `/plan-issue` instead of `/tdd-plan` — cheaper to act on, but the plan is a prediction, and this session's prediction was the thing that was wrong.
