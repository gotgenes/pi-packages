---
issue: 568
issue_title: "Tool-kind classification decided once at the normalize boundary (extraction family)"
---

# Retro: #568 — Tool-kind classification decided once at the normalize boundary (extraction family)

## Stage: Planning (2026-07-10T00:00:00Z)

### Session summary

Planned Phase 10 Step 1 of the pi-permission-system roadmap: a new `access-intent/tool-kind.ts` owning a `ToolKind` string-union classification and its single dispatch point `classifyToolKind`, with the five extraction-family consumers (`input-normalizer.ts`, `tool-input-path.ts`, `handlers/gates/tool.ts`, `handlers/gates/tool-call-gate-pipeline.ts`, `permission-manager.ts`) migrated onto it.
Wrote a five-step TDD plan (one true red for the new module, the rest behavior-preserving refactors under the existing green suite) and committed it as `docs/plans/0568-tool-kind-classification-extraction.md`.

### Observations

- **Bare union over rich product.**
  Chose a plain `ToolKind` string union rather than a discriminated object carrying the extracted command/target/path.
  A rich product would need the MCP server-name list, the extractor registry, and `AccessPath` — the last is forbidden in `permission-manager.ts` by the ADR-0002 `no-restricted-imports` rule, and the pipeline's bash guard and `deriveSource` have none of those inputs in hand.
  The classification is the single missing dispatch point; per-kind products stay where their dependencies live.
- **Extraction vs presentation split confirmed by grep.**
  The official recompute (`toolName === "(bash|mcp)"|source === "mcp"`) returns exactly 21: 10 extraction sites (this step) + 11 presentation sites (Step 2, #569).
  The metric keys literally on `toolName ===`/`source ===`, so consumers dispatching on a `classifyToolKind`/`kind`-named value produce zero grep matches — extraction drops to 0, total to 11 (≤ 12 target).
- **`getToolPermission` dead branches.**
  Found that `getToolPermission`'s `normalizedToolName === "bash"`/`"mcp"`/`"skill"` branches (not grep-counted — different variable name) plus the SPECIAL and default arms all evaluate the identical `evaluate(normalizedToolName, "*", composedRules, platform).action`.
  Folded a behavior-identical collapse into the manager migration step; flagged as optionally droppable in Open Questions.
- **`buildInputForSurface` deliberately excluded.**
  It dispatches on path/service **surface** names (`external_directory` has no `ToolKind` variant), not tool names, so `classifyToolKind` would drop a branch — left as-is and recorded in Non-Goals.
- **ADR-0002 boundary holds.**
  `tool-kind.ts` imports only the pure `PATH_BEARING_TOOLS` set, staying `AccessPath`-free, so `permission-manager.ts` importing `classifyToolKind` does not breach the string boundary.
  Noted as an at-risk invariant pinned by the existing ESLint rule.
- **Release posture.**
  `refactor:` (hidden changelog type), head of batch "tool-kind-dispatch" (tail = Step 2, #569) → mid-batch defer; does not cut a release on its own.
- **First-party, unambiguous** → no `ask_user` gate; the one design choice (union vs product) was resolved via code-design heuristics.

## Stage: Implementation — TDD (2026-07-10T15:00:00Z)

### Session summary

Executed the five-step plan: added `access-intent/tool-kind.ts` (`ToolKind` + `classifyToolKind`) and migrated the five extraction consumers (`tool-input-path`, `input-normalizer`, `permission-manager`, and the tool-call gate pipeline's `tool.ts` + `tool-call-gate-pipeline.ts`) onto it, then recorded the roadmap step in `architecture.md`.
Four `refactor:` commits + one `docs:` commit; the suite grew from 2310 to 2317 (+7, the new `classifyToolKind` unit tests).
The extraction-family production discriminator sites dropped to 0 and the total family from 21 to 12 (target ≤ 12), all remaining sites being the presentation family Step 2 (#569) clears.

### Observations

- **No new characterization tests needed.**
  `permission-manager-unified.test.ts` already pinned every `deriveSource` arm (special / skill / bash / mcp config+default / tool config+default), so the manager migration was a pure refactor under green.
- **Two in-scope cleanups folded into the manager step (deviation from a strict file-by-file plan, anticipated in the plan's Design Overview).**
  `getToolPermission`'s per-kind branches were provably dead (every branch, including SPECIAL and default, evaluated the identical `evaluate(normalizedToolName, "*", composedRules, platform).action`) and collapsed to one line; `BUILT_IN_TOOL_PERMISSION_NAMES` became dead once the `path`/`bash` kinds covered its role and was removed.
- **Exhaustive switches** in `normalizeInput`, `getToolInputPath`, and `deriveSource` make a future `ToolKind` variant a compile error rather than a silent fall-through — the OCP win.
- **`buildInputForSurface` left untouched** as planned (it dispatches on service/path *surface* names including `external_directory`, which has no `ToolKind` variant).
- **Metric nuance:** the recompute grep now returns 12, one of which is a docstring inside `tool-kind.ts` (the outcome permits sites inside that module); all 11 others are the presentation family.
- **Pre-completion reviewer: PASS** — all deterministic checks green (`check`, root `lint`, 2317 tests, `fallow dead-code`), Mermaid re-rendered clean (4 charts), ADR-0002 boundary verified intact.
  No warnings.

## Stage: Final Retrospective (2026-07-10T19:07:04Z)

### Session summary

One continuous session carried #568 through all four stages — plan, TDD, ship, retro — for Phase 10 Step 1 of the pi-permission-system roadmap.
The implementation landed cleanly: five red→green→commit cycles, four `refactor:` + two `docs:` commits, suite 2310 → 2317 (+7), pre-completion PASS, CI green, issue closed, release deferred (batch tail is Step 2 / #569).
Zero rework, zero user corrections, zero CI or reviewer failures across the whole session.

### Observations

#### What went well

- **Plan mitigations validated at execution.**
  The plan's "fold the first consumer into the introduction commit to avoid a `fallow dead-code` failure on the unwired export" mitigation worked exactly as written — the reviewer explicitly confirmed it.
  The plan's Test Impact Analysis prediction ("`permission-manager-unified.test.ts` already pins every `deriveSource` arm") held, so the manager migration was a pure refactor under green with no new characterization tests.
- **Reviewer scope corrected for a batched-release repo.**
  The pre-completion skill's Step 1 diff (`git diff $BASE..HEAD` with `BASE` = last tag) over-scoped badly: the last `pi-permission-system` tag (`v20.3.0`) predates the entire already-landed Phase 9 batch, so the tag-based file list dragged in ~40 unrelated `authority/` files.
  Scoping the reviewer to the issue's own commit range (`04f3e5c1^..HEAD`) gave it the 10 files that actually changed.
  This recurs structurally: refactor issues ship mid-batch, so the last tag is routinely many commits behind.
- **Exhaustive-switch discipline paid off.**
  Migrating `normalizeInput`/`getToolInputPath`/`deriveSource` to `switch (classifyToolKind(...))` turned a future tool-kind addition into a compile error — the OCP win the issue set out to buy, now structurally enforced rather than convention.

#### What caused friction (agent side)

- `other` (over-verification) — during the ship close-comment step I re-checked the 40-char SHA length three times with three different one-liners (`wc -c`, `head -c 40`, `tr -d '\n' | wc -c`).
  `git rev-parse <short>` already returns the full expanded SHA, so the length checks were redundant.
  Impact: ~3 extra tool calls, no rework.

#### What caused friction (user side)

- **`mid-batch — defer` ask was moot in hindsight.**
  The ship flow asked the operator up front whether to defer the release; the answer was defer.
  Only later (step 4b) did the range-check confirm every unreleased commit is a non-releasing type (`docs:`/`refactor:`), so nothing would release regardless.
  The early ask is deliberate design (a decision from the plan resists reversal), and cost one near-zero question — flagged as an observation, not a problem to fix.

### Diagnostic details

- **Model-performance correlation** — one subagent dispatch: the `pre-completion-reviewer` (its configured model) on judgment-heavy review work — an appropriate match; it ran the deterministic gates and returned a scoped PASS.
- **Escalation-delay tracking** — no `rabbit-hole` friction points; no error sequence exceeded one tool call.
- **Unused-tool detection** — nothing missed; `colgrep`/`grep`/`read` covered planning exploration, and no lens indicated an un-dispatched subagent was warranted.
- **Feedback-loop gap analysis** — verification ran incrementally: `pnpm run check` after every shared-type step, the affected test file per red→green cycle, then the full suite + root `lint` + `fallow dead-code` before the reviewer.
  No end-of-session-only verification.

### Changes made

1. `.pi/skills/pre-completion/SKILL.md` (Step 1) — added a note that under batched releases the last-tag `$BASE..HEAD` diff over-scopes to sibling issues' shipped files, and to scope the reviewer to the issue's own commits (`git diff --name-only <plan-commit>^..HEAD`) instead.
