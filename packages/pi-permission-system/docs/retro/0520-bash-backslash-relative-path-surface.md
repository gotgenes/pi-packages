---
issue: 520
issue_title: "Bash backslash-relative arguments (dir\\file) bypass the path permission surface on Windows"
---

# Retro: #520 — Bash backslash-relative arguments (dir\\file) bypass the path permission surface on Windows

## Stage: Planning (2026-07-08T00:00:00Z)

### Session summary

Produced a numbered TDD plan for the win32 backslash-relative shape-recognition gap in the bash `path` surface, the sibling deferred from [#509].
The fix widens `classifyTokenAsRuleCandidate` with an optional `{ windowsSeparators }` branch (accepting a `\`-containing token as path-shaped) and derives that bit from a new narrow `PathNormalizer.usesWindowsSeparators()` accessor threaded through `BashPathResolver.projectRuleCandidates`, so the platform decision stays in the normalizer and never re-reads `process.platform`.

### Observations

- Scope confirmed `path`-surface only: the forward-slash equivalent `dir/file` is already dropped by the strict `external_directory` classifier, and a backslash *traversal* (`..\x`) is already caught by the shared `includes("..")` branch, so no `external_directory` change is needed.
- Chose an optional classifier option + narrow normalizer accessor over reviving the retired generic `getPlatform()` — `usesWindowsSeparators()` is a bounded semantic predicate (like `isAbsolute`), and `windowsSeparators` reuses the existing convention in `wildcard-matcher.ts` / `rule.ts`.
- Dead-code avoidance drove the TDD sequencing: the new normalizer accessor lands in the same step as its sole consumer (the resolver) so `pnpm fallow dead-code` stays clean; the classifier param is optional so no fake breaks.
- Non-breaking and platform-specific: POSIX keeps `dir\file` as a bare token (backslash is a legal filename char there), pinned by a `posix`-normalizer resolver test; the design reuses `forBashToken` (win32 `plain`) resolution and the `pathMatchOptions` `/`→`\` fold so `dir\file` matches a natural `"dir/file"` rule.
- `Release: ship independently` — [#520] is recorded under the Phase 9 "swept and out of scope" listing and is in no release batch.

## Stage: Implementation — TDD (2026-07-08T11:00:00Z)

### Session summary

Executed all four TDD-order steps: the `{ windowsSeparators }` option on `classifyTokenAsRuleCandidate`, the `PathNormalizer.usesWindowsSeparators()` accessor wired into `BashPathResolver.projectRuleCandidates`, an end-to-end `describeBashPathGate` win32 deny repro, and the docs.
The `pi-permission-system` suite went from 2275 to 2287 tests (+12); full monorepo suite, `check`, `lint`, and `fallow dead-code` all green.
Pre-completion reviewer verdict: PASS.

### Observations

- One planned deviation: the win32 parity test asserts the backslash token's exact `matchValues()` (`["c:\\projects\\app\\dir\\file", "dir\\file"]`) plus a superset check against the forward-slash token, rather than the plan's predicted strict `matchValues()` equality — the forward-slash form `dir/file` carries a redundant raw `dir/file` alias that folds to `dir\file` under win32 separators, so rule-match parity holds without the two match sets being identical.
  Captured in the `ad90fe56` commit body.
- Baseline cleanup: the committed plan tripped `MD053` (an unused `[#393]` link-reference definition, since every `#393` body mention was backticked) — fixed as a separate `docs:` commit before starting TDD.
- `noUncheckedIndexedAccess` is off in this package, so `arr[0]` is non-nullable; an initial `candidate?.token` / `?? []` in the new `program.test.ts` cases tripped `@typescript-eslint/no-unnecessary-condition` at the pre-commit hook — dropped the optional chaining to match the file's existing convention.
- tree-sitter-bash preserves the raw `dir\file` source text in the `word` node (no shell escape processing), so the classifier sees the backslash literally — the token-collection layer does not interpret escapes, matching the existing design.
- Confirmed the fix is not a hollow test: before the change `dir\file` produced no rule candidate, so the win32 gate returned null; the new deny assertion genuinely fails without the fix.
- No roadmap `✅` flip: [#520] is not a numbered roadmap step (swept out of scope), so only the architecture module-listing prose was updated.

## Stage: Final Retrospective (2026-07-08T16:00:00Z)

### Session summary

Shipped the win32 backslash-relative `path`-surface fix across four stages (plan → TDD → ship → retro) in one continuous session, releasing `pi-permission-system` `v20.1.0`.
The implementation matched the plan exactly (3 src, 3 docs, 4 test files, +12 tests), with one documented test-assertion deviation and a pre-completion reviewer PASS.
Execution was notably clean: no rabbit-holes, an exemplary incremental feedback loop, and three minor self-caught context misses that the tooling flagged immediately.

### Observations

#### What went well

- Design-challenge handling (novel win): when the operator asked "branch vs. polymorphism?" mid-plan, the response gave a balanced five-rule analysis, cited in-codebase precedent (`wildcard-matcher.ts` / `rule.ts` `windowsSeparators`), correctly located the *real* polymorphism question one layer down (`PathNormalizer`'s accumulating `platform === "win32"` branches), and used `ask_user` to let the operator decide — rather than defensively holding the plan or capitulating.
  The settled reasoning was carried forward into `/tdd-plan` as a note.
- Dogfooding: the `pi-permission-system` extension under change gated the agent's own exploratory `bash -c` probe (opaque-wrapper flooring) and its own malformed-path `Edit` (external-directory gate) — two live confirmations of the surface being modified.
- Dead-code sequencing planned in advance paid off: `PathNormalizer.usesWindowsSeparators()` landed in the same commit as its sole consumer, so `pnpm fallow dead-code` stayed clean with no suppression.

#### What caused friction (agent side)

- `missing-context` (minor) — the plan predicted strict `matchValues()` equality between `dir\file` and `dir/file`, but the forward-slash form carries a redundant raw `dir/file` alias, so the assertion was too strong.
  Impact: one test-correction iteration (plus a re-read after an autoformat reflow bounced the first `Edit`); the failing test caught it immediately and it was recorded as a planned deviation in the `ad90fe56` commit body — no rework beyond the fix.
- `missing-context` (minor) — new `program.test.ts` cases used `candidate?.token` / `?? []`, but `noUncheckedIndexedAccess` is off in this package (so `arr[0]` is non-nullable) and the adjacent win32-projection tests already used non-optional `[0]` access.
  Impact: pre-commit ESLint aborted the commit once; fixed and re-committed (~3 tool calls) — tooling caught it, no lasting effect.
- `instruction-violation` (self-identified) — the planning-stage plan commit added a `[#393]:` link-reference definition while every body mention of `#393` was backticked (a code span), tripping `MD053`; the loaded `markdown-conventions` skill documents this exact trap.
  It was not caught during planning (the `/plan-issue` flow runs no lint) and surfaced only at the `/tdd-plan` green-baseline check.
  Impact: one extra `docs:` cleanup commit before TDD could begin.
- `other` (typo) — one `Edit` used a malformed absolute path (missing the `pi-packages/packages/` segment) and was denied by the permission gate.
  Impact: one retry with the correct path.

#### What caused friction (user side)

- None.
  The operator's design challenge was a high-value strategic intervention (not a correction), and the permission-prompt question was curiosity, productively answered.

### Diagnostic details

- **Model-performance correlation** — Planning ran on `claude-opus-4-8` (judgment-heavy design, including the polymorphism analysis); TDD mixed `claude-sonnet-5` (mechanical test authoring) with `claude-opus-4-8` (the `matchValues` deviation reasoning and the design-question interlude); Ship ran on `claude-sonnet-5` (procedural); the `pre-completion-reviewer` subagent ran on `claude-sonnet-5` per its frontmatter and returned a thorough PASS.
  The heavy-model-on-judgment / light-model-on-mechanical split was appropriate throughout — no mismatch.
- **Feedback-loop** — exemplary and incremental: red confirmed before each green (the classifier and resolver steps), `tsc --noEmit` run immediately after each shared-type/collaborator change, and the full suite + lint + `fallow` at the end.
  The one wrong prediction (`matchValues` equality) was caught by the failing test in the same cycle, not deferred to end-of-run.
- **Escalation-delay / unused-tool** — nothing notable: no rabbit-holes, the longest same-error sequence was a single correction iteration, and the codebase was well-understood from planning so `grep`/`read` were the right tools (no missed `Explore`/`colgrep` opportunity).

### Changes made

1. `.pi/prompts/plan-issue.md` — added a `pnpm exec rumdl check <plan-file>` step to the Commit section (with a one-line note on the backtick-code-span `MD053` trap) so a plan-doc markdown slip is caught at the source instead of at the `/tdd-plan` baseline check.
