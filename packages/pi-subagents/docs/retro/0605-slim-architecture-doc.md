---
issue: 605
issue_title: "pi-subagents: slim architecture.md to current state and open targets"
---

# Retro: #605 — Slim architecture.md to current state and open targets

## Stage: Planning (2026-07-17T00:00:00Z)

### Session summary

Produced a build-oriented plan (`docs/plans/0605-slim-architecture-doc.md`) applying the landed [#601] playbook to pi-subagents' 1265-line `architecture.md`, adapted to that package's conventions.
The plan is four `docs:` operations plus a bidirectional link sweep: rename `## Target architecture` → `## Architecture direction` and fold its shipped subsections, aggressively collapse `## Current structural analysis` (remove the 109-line shipped `### Proposed bag decompositions`, collapse the done inventory / resolved-encapsulation-debt tables), strip the one module-tree provenance sentence, and prune orphaned link definitions.
Two adaptation decisions were confirmed with the operator via `ask_user`; both follow the #601 precedent's aggressive/anchor-fixing branch.

### Observations

- **Asymmetric debt vs. #601.**
  pi-subagents does **not** carry the duplicated `### Phase N` prose #601 removed — it already uses the compact Phase/Title/Status + structural-issues table form #601 was *migrating pi-permission-system toward*, and `/finish-phase` (steps 97, 113) actively maintains those tables.
  So issue proposed-change 1 is a near-no-op here; the real bulk is concentrated in `## Target architecture` (shipped-narrated-as-target) and `## Current structural analysis` (shipped-narrated-as-proposed), neither of which has a pi-permission-system analog.
  This asymmetry drove the `ask_user` gate despite the operator-authored, unambiguous-looking spec.
- **Operator decisions (`ask_user`):** aggressive fold of `## Current structural analysis` (collapse the shipped/done material, keep live Health/Complexity/Churn snapshots); and rename `## Target architecture` fixing anchors like #601 (rather than keeping the heading).
- **Anchor blast radius mapped at plan time.**
  Renaming `## Target architecture` (`#target-architecture`) ripples to four live touch points: the in-file link (line 874), `history/phase-16-invert-dependencies.md` (MD051-gated even though "frozen"), the live `client-server-opportunities.md`, and the prose heading-name reference in `.pi/skills/package-pi-subagents/SKILL.md:77`.
  The `### First-principles refinement and the deeper target` sub-anchor (four `history/` citers) is deliberately **kept** to avoid touching those references — its name is not misleading and it is genuinely-open direction material.
- **Chosen new name `## Architecture direction`** to avoid collision with the existing `## Cross-extension architecture` heading.
- **Release posture:** ship independently, cuts no release — `docs/architecture` is a `release-please-config.json` `exclude-paths` entry and the one non-doc touch (`SKILL.md`) is in no package.
  Mirrors #601's "land on `main`; nothing to release."
- **Preserved gate structures:** the `## Phase 11–19 (complete)` chain, the active Phase 20 roadmap (Step 9 / [#543] still open), and the `/finish-phase`-maintained history tables are all explicit Non-Goals.
- **Link-def orphan pre-check:** removing `### Proposed bag decompositions` orphans `[166]`/`[167]`/`[168]`/`[169]` (used only there); `[#231]` is **not** orphaned (also cited in the Phase 15 summary, line 866).
- **Follow-ups already filed by #601:** [#606] (`/finish-phase` doc-hygiene) and [#607] (generalize the regrowth guard) — out of scope; #605 pays down the existing backlog only, so no skill regrowth guard is added here (unlike #601's op 5).
- **Self-caught lint slip:** the plan's own `[#277]:` definition tripped MD053 because both uses sit inside backtick code spans (a code-span `[#N]` is not a live reference) — removed the definition before commit.

## Stage: Implementation — Build (2026-07-17T01:30:00Z)

### Session summary

Executed the four-operation build in three `docs:` commits plus a no-op link-sweep verification, slimming `architecture.md` 1265 → 1111 lines.
Commit 1 renamed `## Target architecture` → `## Architecture direction` and folded its shipped subsections (reframed intro, collapsed `### Responsibilities to remove`, current-tensed the shipped `#### Consequences`), re-pointing all four live anchor/name touch points (in-file link, `phase-16` history, `client-server-opportunities.md`, `package-pi-subagents` skill).
Commit 2 aggressively collapsed `## Current structural analysis` (removed the 109-line `### Proposed bag decompositions` and the resolved `### Session encapsulation debt` table, collapsed the done inventory + production-duplication narration to one-liners, kept Health/Complexity/Churn), and commit 3 stripped the module-tree `#164` provenance.
Pre-completion reviewer returned PASS.

### Observations

- **Two deviations, both plan-sanctioned.** (1) Step 3 went beyond deleting the one `#164` sentence: the module-org intro also carried stale `62 files`/`six domains` counts contradicting the eight-directory tree below it, so the whole intro was reframed to current-state (the plan's op 3 explicitly allowed "reframe to current-state, dropping the migration archaeology"). (2) Step 4 (link sweep) was a no-op with no commit — per-step `rumdl` (MD053) forced each earlier commit to prune its own orphans (`[166]`–`[169]` in commit 2, `[#277]` in commit 2), so the final bijection was already clean, exactly as the plan predicted.
- **`ask_user` fields worked out cleanly at build time** — the aggressive structural-analysis fold removed the single biggest bulk (151 net deletions in commit 2), and the rename's anchor blast radius was fully enumerated at plan time, so no touch point was missed (reviewer confirmed 0 stale `#target-architecture` fragments in live docs).
- **`### First-principles refinement and the deeper target` deliberately kept** (heading + anchor) to avoid touching its 4 `history/` citers; only its `#### Consequences` shipped-narration was current-tensed.
- **`[#231]` correctly retained** — it appears in both the removed `### Proposed bag decompositions` and the kept Phase 15 completion summary, so removing the former did not orphan it (reviewer verified).
- **Line-count landed at 1111 vs. the ~1050 soft target** — the residual is the keep-list content (active Phase 20 roadmap, the `## Phase N (complete)` chain, the `/finish-phase`-maintained history tables); the plan disclaimed the count as soft, with zero information loss and a lint-clean bidirectional link graph as the real gates (both met).
- **Pre-completion reviewer: PASS** — lint (biome + eslint + rumdl), fallow dead-code, 7 Mermaid charts, link bijection, Non-Goals-intact, and full rename propagation all green; check/test N/A (no `.ts` touched).

## Stage: Final Retrospective (2026-07-16T23:32:10Z)

### Session summary

One continuous session carried #605 from `/plan-issue` through `/ship-issue`: an operator-authored docs-only cleanup applying the landed #601 playbook to `pi-subagents`, slimming `architecture.md` 1265 → 1111 lines across three `docs:` commits plus planning/build/retro breadcrumbs.
The plan was sound and the build executed it cleanly — one self-caught `Edit`-tool schema slip (no rework) and one plan-sanctioned scope widening were the only deviations, and the pre-completion reviewer returned PASS on the first pass.
Execution quality was high: incremental `rumdl` after every content step, a marker-keyed `python3` splice for the two large block removals, and a bidirectional link-graph bijection check.

### Observations

#### What went well

1. **A prior retro's prompt change paid off directly.**
   Issue #601's retro added a `plan-issue.md` rule — when a step renames a heading/anchor/named concept, widen the skill grep to the whole `.pi/skills/` tree.
   In #605 planning that rule fired: the broad `.pi/skills/` + whole-`docs/` grep (session turns 11, 14, 15) caught all four `#target-architecture` touch points (in-file link, `phase-16` history, `client-server-opportunities.md`, and `package-pi-subagents/SKILL.md:77`), and the reviewer confirmed 0 stale fragments.
   A compounding-improvement win — the anchor-rename blast radius was fully mapped at plan time, so the build hit no surprises.
2. **Marker-keyed `python3` splice validated a second time.**
   For the 127-line (`Session encapsulation debt` + `Proposed bag decompositions`) and follow-on removals, an in-place `s.index()` splice (turns 38, 40) avoided a fragile multi-KB `Edit` `oldText`, then a `rumdl` + bijection check verified loss-free removal.
   Same technique #601's retro recorded; this run used a leaner in-place variant.
3. **No feedback-loop gap.**
   `rumdl` ran after every content step (turns 34, 40–41, 45, 49), a custom bidirectional ref/def bijection check ran before declaring the sweep clean (turn 50), and full `pnpm run lint` + `fallow dead-code` ran at build-end and ship pre-push.

#### What caused friction (agent side)

1. `other` (tool-schema misuse) — the first Step-1 `Edit` (turn 31) packed a second replacement into one `edits[]` entry as fabricated `oldText2`/`newText2` keys instead of a second array entry.
   The tool silently applied only the two real blocks and reported "Successfully replaced 2 block(s)" — a *success* banner masking a dropped edit.
   Self-caught immediately (the `2 block(s)` count vs. three intended edits) and re-applied in turn 32.
   Impact: one extra `Edit` call, no rework, no bad commit — but the silent-partial-success is the real hazard (easy to miss without counting).
2. `missing-context` (mild, plan-time) — the plan scoped module-org op 3 as "strip the one `#164` sentence," but at build time the intro also carried stale `62 files`/`six domains` counts contradicting the eight-directory tree and the 57-file health metric.
   The build reframed the whole intro to current-state (plan-sanctioned by op 3's "reframe to current-state" wording).
   Impact: none — absorbed into the same commit, no rework; a slimming plan reading the full doc could have flagged the intro's internal inconsistency at plan time.

#### What caused friction (user side)

- None.
  The single planning `ask_user` (two scoping decisions: aggressive structural-analysis fold; rename `Target architecture` and fix anchors) was well-timed and its answers drove a clean build with no mid-course correction.

### Diagnostic details

- **Model-performance correlation** — planning, build, and this retro ran on `anthropic/claude-opus-4-8` (appropriate for judgment-heavy plan authoring, the fold/rename editing, and review synthesis); ship ran on `anthropic/claude-sonnet-5` (appropriate — procedural).
  Ship reached every correct conclusion (nothing releases; auto-batch) but showed mild mechanical over-verification — a `git rev-parse HEAD | tee /tmp/sha.txt; wc -c` byte-count ritual (turns 73, 85) that adds nothing over `git rev-parse`'s own output; harmless, no error.
  The `pre-completion-reviewer` subagent ran on its own configured model and returned a specific, correct PASS (7 Mermaid charts parsed, link bijection, rename propagation) — no mismatch.
- **Escalation-delay tracking** — no `rabbit-hole`; the `Edit` schema slip was a single-turn self-correction (31 → 32), well under the 5-call threshold.
- **Unused-tool detection** — none applicable; the task was structural doc editing, and grep/`read`/`python3`-splice were the right tools (`colgrep` semantic search was not needed for exact-anchor edits).
- **Feedback-loop gap analysis** — no gap (see What-went-well 3).

### Changes made

1. `AGENTS.md` ("Edit tool batches" section) — added a two-sentence guard: each `edits[]` entry has exactly one `oldText`/`newText` (no `oldText2`/`newText2`), and extra suffixed keys are silently ignored while the tool still reports `Successfully replaced N block(s)`, so count reported blocks against intended edits (Refs #605).

Considered but not applied (self-rejected): a `plan-issue.md` current-state-accuracy check for the module-org intro stale counts (too niche, zero impact), and a `ship-issue.md` note against the `wc -c` SHA byte-count ritual (a sonnet-5 ship-stage model artifact, not a prompt defect).

[#543]: https://github.com/gotgenes/pi-packages/issues/543
[#601]: https://github.com/gotgenes/pi-packages/issues/601
[#606]: https://github.com/gotgenes/pi-packages/issues/606
[#607]: https://github.com/gotgenes/pi-packages/issues/607
