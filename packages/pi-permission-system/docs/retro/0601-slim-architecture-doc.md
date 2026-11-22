---
issue: 601
issue_title: "pi-permission-system: slim architecture.md to current state and open targets"
---

# Retro: #601 — Slim architecture.md to current state and open targets

## Stage: Planning (2026-07-16T14:53:44Z)

### Session summary

Produced a build-oriented plan (`docs/plans/0601-slim-architecture-doc.md`) for the operator-authored docs-only cleanup: five content operations on `architecture.md` (delete duplicated `### Phase 1–11` prose, fold `Target: the authority model` → `The authority model`, strip module-tree provenance, trim source-restating pseudo-code, add a package-skill regrowth guard) plus a two-directional link-graph sweep, sequenced as six `docs:` commits.
A mid-planning question about *ongoing* architecture-doc maintenance — and that pi-subagents (1265 lines) carries the same debt — was resolved with the operator and split into three follow-ups filed this session: #605 (pi-subagents bulk prune), #606 (extend `/finish-phase` with a doc-hygiene step), #607 (generalize the regrowth guard into a shared convention).

### Observations

- **Release posture:** ship independently, but this cuts no release at all — `docs/architecture` is a `release-please-config.json` `exclude-paths` entry and the one non-doc touch (`SKILL.md`) is in no package.
  Recorded as such rather than implying a release.
- **Skipped the `ask_user` design gate:** author is the operator (`gotgenes`) and the "Proposed change" is concrete and unambiguous, so per the plan template the gate was skipped for #601's scope.
  Used `ask_user` instead for the *process* question the operator raised (maintenance mechanism + which follow-ups to file).
- **`/finish-phase` is the producer, not just a bystander:** the `### Phase N` refactoring-history prose #601 deletes is written *by* `/finish-phase` Step 4 ("match the established style… pi-permission-system uses prose `### Phase N (complete)` subsections").
  That is why the ongoing-prevention mechanism belongs in `/finish-phase` (#606), not `/plan-improvements` — the latter is the read-cost *consumer* (the "three 50KB reads" the issue cites) and its cause-hypothesis discipline is code structure, not doc hygiene.
- **Anchor-rename fallout is bounded and documented:** renaming `## Target: the authority model` breaks `#target-the-authority-model`.
  Four in-file links (two survive → update; two live inside the deleted prose) plus one live sibling doc (`permission-prompter.md`).
  Frozen records (`history/`, old plans) keep their stale anchor deliberately — rewriting history is a Non-Goal.
- **Kept #601 tight:** deliberately did not balloon it to include pi-subagents or the `/finish-phase` change; those are #605/#606/#607, cross-referenced in the plan's Non-Goals and Open Questions.
- **Soft 750-line target:** treated as the issue's rough goal, not a gate; the real gates are zero information loss, a lint-clean link graph (MD053 both directions), and the preserved `## Improvement roadmap — Phase N (complete)` chain the `/plan-improvements` hard gate greps for.

## Stage: Implementation — Build (2026-07-16T15:40:00Z)

### Session summary

Executed all six build steps as `docs:` commits: dropped the duplicated `### Phase 1–11` refactoring-history prose, folded `Target: the authority model` → `The authority model` (cutting the shipped-narrated-as-pending parts, keeping every open-direction subsection), stripped issue-provenance trails from the ~130-entry module tree (keeping the ADR 0002 string-boundary and sole-`win32`-comparison active constraints), replaced the `normalizeFlatConfig()`/two-phase snippets with sentence-plus-pointer, and added the package-skill regrowth guard.
`architecture.md` went 1213 → 1063 lines and dropped 22.5KB (17%) — the module tree alone got 24% narrower — directly cutting the read cost the issue cited.
Pre-completion reviewer returned WARN (one finding), fixed inline; final full `pnpm run lint` clean.

### Observations

- **Two planned deviations, both justified and documented in commit bodies.** (1) The plan deferred all orphaned-link pruning to a separate step-6 commit, but per-step `pnpm run lint` (MD053) forces each commit to be valid, so orphan pruning was folded into the step that created it — step 6 became a no-op verification (bijective 65↔65 ref/def check). (2) The plan's Non-Goal to leave frozen-record anchors stale was untenable: renaming the heading breaks live in-repo link fragments, and rumdl MD051 validates them (flagged `0555`), so the anchor token was fixed in `0555` + the three `history/` files (prose byte-identical otherwise).
- **Line-count target missed honestly (1063 vs ~750), but the plan disclaimed it as soft.**
  The remaining bulk is content the issue's keep-list explicitly preserves (the authority-model open-direction subsections) plus the one-line-per-module tree floor; the real signal metric (bytes) dropped 17%.
- **Reviewer WARN was a rename side-effect, not a defect:** `.pi/skills/improvement-discovery/SKILL.md` cited the old heading name as its canonical first-principles-target example.
  Grepped exhaustively; the only other live reference was that skill (the `architecture.md` `**Target:**` hits are unrelated roadmap step-fields; the two retro hits are frozen).
  Fixed the skill in a 7th `docs:` commit.
- **Pre-completion reviewer: WARN → resolved.**
  Deterministic gates (check/lint/test/dead-code), Mermaid validation (7 diagrams), commit hygiene, and link-graph integrity all PASS.

## Stage: Final Retrospective (2026-07-16T16:54:44Z)

### Session summary

One continuous session carried #601 from `/plan-issue` through `/ship-issue`: an operator-authored docs-only cleanup that slimmed `architecture.md` 1213 → 1063 lines (−17% bytes), across seven `docs:` commits plus retro breadcrumbs.
The plan was sound and the build executed it cleanly, but two plan-authored Non-Goals turned out untenable at build time (both handled as documented deviations, no rework), and the pre-completion reviewer caught one stale reference the plan's grep scope missed.
Execution quality was high: incremental `lint:md` after every step, a clean temp-file+splice for the 130-line module tree, and a well-scoped mid-planning `ask_user` that spun off three follow-ups (#605/#606/#607) without ballooning #601.

### Observations

#### What went well

1. **Incremental verification, not end-of-run.**
   `pnpm run lint:md` ran after every content step (steps 1–5), so each of the seven commits was independently lint-valid — the feedback-loop-gap lens found no gap.
2. **Large mechanical replacement done safely.**
   The ~130-entry module tree was rewritten by authoring the trimmed block to `/tmp/module-tree.txt` (`Write`) and splicing with a marker-keyed `python3` script, avoiding a fragile multi-KB `Edit` `oldText` — then verified block boundaries and a bijective ref/def check.
3. **Mid-planning `ask_user` as a scope gate.**
   When the operator raised the broader "how do we maintain these docs" question, the response grounded itself in reading the actual `/finish-phase` and `/plan-improvements` templates before recommending, then filed three scoped follow-ups rather than ballooning #601.
4. **The pre-completion reviewer earned its keep** — it caught a real, specific stale reference (`improvement-discovery` skill) that the plan's grep scope missed.

#### What caused friction (agent side)

1. `missing-context` — the plan's anchor-rename impact analysis grepped `.pi/skills/package-pi-permission-system/` but not the broader `.pi/skills/` tree, so it missed `.pi/skills/improvement-discovery/SKILL.md`, which cited the renamed `Target: the authority model` heading as its canonical first-principles-target example.
   Impact: one extra fix commit (`ae6d7bb5`), caught by the pre-completion reviewer rather than the plan.
   Self-identified via the reviewer (not the operator).
2. `missing-context` — two plan Non-Goals asserted lint-tool behavior that proved false: (a) orphan-link pruning as a separate step-6 commit (MD053 makes each commit invalid until its own orphans are pruned), and (b) frozen-record anchors staying stale (rumdl MD051 validates in-repo link fragments).
   Impact: two documented build-time deviations plus ~4 investigation tool calls (steps 57–60) to understand the rumdl glob/config; no rework of committed content — folding the cleanup into each causing commit was the correct resolution.

#### What caused friction (user side)

- None.
  The operator's mid-planning maintenance question (turn 17) was well-timed strategic input that improved the outcome (the three follow-ups), not a correction.

### Diagnostic details

- **Model-performance correlation** — planning, build, and retro ran on `anthropic/claude-opus-4-8` (appropriate for judgment-heavy planning/editing/review-handling).
  The entire ship stage (turns 99–118) ran on `opencode-go/deepseek-v4-flash`, a reasoning-weak model, on the ship's one judgment-heavy step — the release-trigger / `exclude-paths` analysis.
  It reached the correct answer (nothing releases) but fumbled the path: wrong tag name `v20.7.3` (turn 109) then corrected to `pi-permission-system-v20.7.3` (110), and looked for package-level `exclude-paths` (111–112) before reading the top-level array in the config (113) — ~6 turns for a 2–3-turn conclusion.
  Self-corrected, no rework.
  Mild model/task mismatch; ship is mostly procedural so a flash model is largely fine, but the `exclude-paths` reasoning is the part that wants either a stronger model or a more deterministic recipe.
  The pre-completion-reviewer subagent ran on its own configured model and performed well (a specific, correct WARN).
- **Escalation-delay tracking** — no sequence exceeded the 5-consecutive-calls threshold.
  The rumdl MD051 investigation (turns 57–60) was 4 calls, each making progress; the deepseek `exclude-paths` fumble (108–114) was ~6 turns but each advanced toward the answer rather than repeating one error.
- **Feedback-loop gap analysis** — no gap: `lint:md` ran incrementally after every content step, and the full `lint` (biome + eslint + rumdl) plus `fallow dead-code` ran at build-end and again at ship pre-push.

### Changes made

1. `.pi/prompts/plan-issue.md` — added a Module-Level-Changes grep-scope rule: when a step renames a heading, anchor, or named concept another doc may cite as an example, widen the skill grep from `.pi/skills/package-*/SKILL.md` to the whole `.pi/skills/` tree (a shared skill like `improvement-discovery`/`code-design` can cite a package doc's section by heading).
   Would have caught the `improvement-discovery` stale reference at plan time instead of at the pre-completion review.

Considered but not applied (operator declined / self-rejected): a `/build-plan` note on deferred-cleanup-vs-per-commit-lint-validity (the build handled it unaided), and a more deterministic `exclude-paths` recipe in `/ship-issue` step 4b (a model-selection artifact, not a prompt defect).
