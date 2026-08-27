---
model: anthropic/claude-sonnet-5
description: Verify the current improvement phase is complete, update docs, and archive its roadmap to history/
---

# Finish the current improvement phase

Package: `$1`

Your job is to close out the package's **current improvement phase**: confirm every step landed, bring the architecture document into agreement with the delivered code, and archive the phase's detailed roadmap into a per-phase history file.
Do **not** propose the next phase — that is `/plan-improvements`'s job.
Hand off to it at the end.

## Sync with remote (do this first)

1. Run `git pull --ff-only`.
2. If it fails for **any** reason — uncommitted changes, divergent history, merge conflict, network error, detached HEAD — stop immediately and report the failure to the user.
   Do not attempt to stash, rebase, force, or otherwise resolve.
3. Only proceed once the pull reports a clean fast-forward (or `Already up to date.`).

## Load skills

Load these skills before starting:

- `package-<PKG>` — package-specific context (replace `<PKG>` with `$1`).
- `markdown-conventions` — formatting rules for the architecture and history documents.
- `mermaid` — for any diagrams moved or updated.
- `code-design` — to judge whether the delivered code matches the phase's documented outcomes.

## Step 1: Identify the current phase

Read `packages/$1/docs/architecture/architecture.md` and locate the active **"Improvement roadmap (Phase N — …)"** section (or the package's equivalent open-phase section).

Record:

- The phase number N and its title/slug.
- The phase goal and the per-step outcomes (each `Outcome:` / `✅ Delivered` line).
- Every step's GitHub issue number.
- Any abandoned, superseded, parked, or closed-not-planned issues the phase references.
- Any **follow-on** issues the phase spawned (later-resolved cleanups, deferred migrations that landed after a step shipped — e.g. a builder unification or a sibling-package migration).
  They are non-gating but belong in the archive's issue table; record them under a separate "follow-on" grouping rather than as steps.

Then immediately call `set_session_name` with `$1 — Phase N Archive` so the session is labelled for the rest of the work.

If no open roadmap section exists (every phase is already archived), stop and report that there is nothing to finish.

## Step 2: Verify every step is complete (hard gate)

For each step issue recorded in Step 1, query its state:

```bash
gh issue view <N> --json number,state,title
```

This is a **hard gate**:

- If **any** step issue is still `OPEN`, stop immediately.
  List the open issues as `#N — title` and report that the phase cannot be archived until they are closed (or explicitly reclassified as abandoned/parked/not-planned in the roadmap).
  Do not archive.
- Treat issues the roadmap explicitly marks abandoned / superseded / parked / not-planned as expected non-blockers — note them, but they do not gate archiving.

Run `gh` from the repo root (it must execute inside the repository).

### Reconcile phase-born issues

The gate above sees only issues carrying a numbered step.
An issue spun off *during* the phase — by a step's implementation, by one step's planning, or by a retrospective — has no step, so the gate is blind to it and the archive drops it from the phase's history entirely.
The `roadmap-fit` skill dispositions these at filing time; this is the net for the ones that escaped it, including any filed by hand outside a prompt.

1. Take the phase-window start from the roadmap's `### Findings (planned YYYY-MM-DD)` heading.
   When it carries no date, fall back to the commit that added the roadmap section:

   ```bash
   git log --diff-filter=M --format=%ad --date=short -S'Improvement roadmap — Phase N' -- packages/$1/docs/architecture/architecture.md | tail -1
   ```

2. List the issues created inside the window:

   ```bash
   gh issue list --state all --label "pkg:$1" --search "created:>=<date>" --json number,title,state
   ```

   The query keys on the package label, so an issue born from the phase but filed without one does not surface — label it at filing time.
3. Drop the ones already accounted for: the phase's step issues from Step 1, and any number already named in the roadmap's `#### Open-issue sweep dispositions` list (grep `architecture.md` for each `[#N]`).
4. Propose a disposition for each survivor and put the whole set to the user in **one** `ask_user` pass — not one round-trip per issue.
   Issues sharing a verdict share one bullet, matching the list's existing convention (`Feature issues [#736], [#720], … — out of scope for a structural phase`).
5. Append the agreed entries — and their `[#N]:` link definitions — to the dispositions list **before** Step 5 archives the roadmap; an entry added after the move lands in the wrong file.

Expect a non-trivial residual: against pi-permission-system Phase 13's window the query returned 15 issues, 7 of them already stepped or dispositioned.
The survivors mix genuine phase-born work with ordinary tracker noise, and the grouped bullet is what keeps the pass bounded.

## Step 3: Reconcile the architecture document with delivered code

The architecture document describes the **current** architecture; after a phase lands it must match what shipped — not what was planned.

For each step outcome, verify the code agrees:

- Trace the named target files/modules/classes and confirm the documented end-state holds (renamed symbols, dropped fields, narrowed interfaces, removed modules).
- Update any stale prose in the body sections (target architecture, domain model, module structure, diagrams) that still describes the pre-phase state.
- Refresh any health-metrics or dependency-bag tables the phase was scored against, so the baseline reflects the delivered numbers.

### Deriving the delivered numbers

Do not copy a doc metric forward — recompute it:

- When the phase findings table records a recompute command for a metric, **use that exact command** — not the `fallow:health` / `fallow:dupes` scripts.
  The scripts and the recorded commands can disagree: `pnpm fallow:health` expands to `fallow health --score --hotspots --targets`, and the `--hotspots --targets` flags **lower the score** (a package baselined at 88 A with `fallow health --score` alone reports 78 B under the script).
  Reconcile against the same command the baseline was computed with, or the "delivered" number will spuriously differ from the target.
- When no recompute command is recorded, reconcile by **reproducing the doc's existing baseline number**, not by defaulting to a fixed command — the bare `--score` form and the `fallow:health` script disagree, so a fixed default can spuriously report a phantom improvement.
  Run `pnpm fallow health --score --workspace @gotgenes/$1`; if its grade/score does not reproduce the doc's current health-metrics row, the baseline was computed with the script form (`fallow health --score --hotspots --targets`, which the `--hotspots --targets` deductions drive lower — e.g. pi-subagents baselines at 78 B under the script but 88 A bare), so rerun with `--score --hotspots --targets --workspace @gotgenes/$1` and reconcile against that.
  Reconcile duplication with `pnpm fallow dupes --workspace @gotgenes/$1`.
  The fallow subcommands are root-level and take `--workspace @gotgenes/$1`; the `--filter`/`-C package` forms used elsewhere do **not** apply to them.
- "Total LOC" / "Source LOC" counts `src/` only (`find packages/$1/src -name '*.ts' | wc -l` for the file count; `… -exec wc -l {} +` for LOC).
  Test counts come from `pnpm --filter @gotgenes/$1 run test`.
- If a doc metric carries a mid-phase label ("as of Step N", "Phase N Step M"), replace it with the end-of-phase value and drop the label — the archived doc should read as the settled post-phase baseline, not a snapshot.
- When the phase findings table records a recompute command for a target metric (a `grep -c`, `wc -l`, or fallow field), run it and record predicted vs. delivered in the history file's health-metrics table (a "delivered" column) and summarise it in the reconciliation commit body.
  Report misses honestly — they are retro input for the next planning round, not something to paper over (the Phase 8 precedent: "fallow refactoring targets did not clear to 0" was recorded verbatim).

### Stop versus fix

Stale counts, files missing from the layout tree, and mid-phase labels are **expected drift** — fix them in place; that is the job of this step.
Stop and report **only** when a documented `Outcome:` / `Landed:` claim is contradicted by the code: a symbol that should be gone still exists, a field documented as "mandatory" is still optional, a module said to be removed is still present.
That is an outcome failure — do not paper over it in the archive.
A **numeric threshold** named in an `Outcome:` line (a cyclomatic ≤ N, a LOC target, a clone-group count) that the delivered code misses — while the structural change the outcome describes *did* land (the mutation loop is gone, the field is dropped, the module is removed) — is a **metric miss, not a stop**: record predicted-vs-delivered in the history file's health table and continue.
Stop only when the structural claim itself is false, not when a target number came in short (the Phase 20 precedent: `createTestSubagent` landed at 13 cyclomatic against an `Outcome:` of ≤ 8, but the mutation loops it named were genuinely gone — recorded as a miss, archived normally).

## Step 4: Bounded doc hygiene (change-scoped)

Before archiving, do a bounded hygiene pass over the regions this phase **already touched** — the modules the phase changed and the target prose the phase delivered against.
This is not a full-doc rewrite: mirror the tidy-first "only touch what the change touches" discipline, and leave unrelated doc regions alone.
Without this pass, every phase close re-inflates the document and the read cost `/plan-improvements` Step 1 pays keeps climbing (Refs #601, #605).

1. No completion summary on archive — two tiers only.
   An archived phase gets exactly two representations: the **"Refactoring history" table row** (title + history link) and the **`history/phase-N-*.md`** file that carries the full narrative.
   Do **not** write a `## Phase N (complete)` / `## Improvement roadmap — Phase N (complete)` prose summary in `architecture.md`, and do **not** write a `### Phase N` prose paragraph under "Refactoring history".
   Both are the near-verbatim third copy that #601 and #605 deleted; the completion-summary tier itself was retired because each `history/phase-N-*.md` already opens with the same abstract and the table row indexes it.
   Step 5.2 deletes the whole roadmap section outright — the table row is the only thing about the phase that stays in `architecture.md`.
2. Strip provenance from touched module-tree entries.
   For each module-tree entry the phase changed, reduce it to what the module is **now**; cite an issue only when the ref encodes an active constraint (a lint-guarded boundary, an ADR string boundary, a structural invariant), never as a provenance trail ("relocated #559, dissolved #505, renamed #510…"), which belongs in git log and `history/`.
   This is the shared architecture-doc convention in `AGENTS.md` (`### Architecture-doc conventions`); hold every touched module-tree entry to it.
3. Re-frame delivered `Target:`/pending prose.
   Where the phase's delivered outcomes have made a `**Target:**` or otherwise-pending passage current state, re-frame it as current — but only for prose the phase actually delivered against.
   Leave genuinely-open targets (later-phase directions the phase did not deliver) as targets.

## Step 5: Archive the phase

Follow the package's **existing** convention — read `history/` and the document's "Refactoring history" section first, and match the established style (both packages now use an intro paragraph plus a per-phase table under "Refactoring history" — pi-subagents adds a structural-issues table).
Do not impose a new format, and per Step 4 do **not** add a completion-summary paragraph or a `### Phase N (complete)` prose subsection — the table row plus the history file are the only two tiers.

1. Create `packages/$1/docs/architecture/history/phase-N-<slug>.md` (create the `history/` directory if the package does not have one yet) and move the **full** detailed roadmap — findings table, numbered steps with outcomes, dependency diagram, and tracks — into it.
   Move the prose verbatim, but **rebase link targets**: same-doc anchors become `../architecture.md#…`, and relative paths gain one `../` level (`../decisions/…` → `../../decisions/…`).
   "Verbatim" applies to the words, not the paths — an un-rebased anchor dangles silently.
   "Verbatim" governs the step *content and wording*, not the heading level: promoting a `##`-rooted roadmap into a standalone doc shifts every heading up one (`##` → `#` title, `###` → `##`, `#### Step` → `### Step`).
   Matching the archived per-step *layout* (a numbered `1. ✅ **Title.**` list vs. `#### ✅ Step N:` headings) is **not** required — the live roadmap's own format may already differ from older history files, and preserving the live wording wins over reformatting it.
   Before moving, verify every `[#N]` reference in the block has a matching `[#N]:` definition somewhere in `architecture.md`; a live roadmap can carry a reference whose definition was never added (it renders as literal `[#N]` text on GitHub) — add the missing definitions to the history file when you move the references.
   Mechanics: author the history file fresh with the `Write` tool, then delete the roadmap from `architecture.md` with a scripted start/end-marker replacement (a small `python3` or `sed` block keyed on the section heading and the next `##` heading).
   Do **not** attempt an `Edit` `oldText` match on the roadmap block — it is typically multiple KB and the match is impractical and error-prone.
2. In `architecture.md`, **delete** the detailed roadmap section entirely — the `history/phase-N-*.md` file now carries it and the "Refactoring history" table row (Step 5.3) indexes it.
   Do not leave a completion-summary paragraph behind.
   Any abandoned / superseded / parked / not-planned issues live in the history file (and in the package's structural-issues table, if it keeps one), not in a summary paragraph.
3. Update the "Refactoring history" table/section: mark Phase N **Complete**, link the new history file, and add it to any structural-refactoring-issues mapping table the package keeps.
4. Update the intro/summary line that enumerates completed phases (e.g. "Phases 1–N complete").
5. Use reference-style issue links (`[#N]` in the body, `[#N]:` definitions at the end of the file) per `markdown-conventions`, and verify every definition has a matching reference (MD053).
   Removing the roadmap **orphans** any `[#N]:` definition that was referenced only inside the moved block — after the move, re-run the markdown lint and delete each now-orphaned definition from `architecture.md` (its references moved to history), while confirming the history file defines everything *it* now references.
   `rumdl` flags these as `MD053` "unused link/image reference"; fix them before committing rather than in a follow-up round-trip.

## Step 6: Verify and commit

1. Run `pnpm run lint` (or at least the markdown lint) to confirm the documents are clean — fix any `rumdl`/MD0xx findings.
2. Confirm the move is loss-free with deterministic checks against the history file rather than eyeballing.
   Do **not** hardcode `^### Step` — the step heading shape varies (a `✅` prefix, and the level shifts up one on promotion), so `grep -c '^### Step'` returns 0 against `### ✅ Step N:` and reads as a false "lost every step" alarm.
   Detect the actual heading first (`grep -nE '^#+ .*Step [0-9]' …`), then:
   - a tolerant count — `grep -cE '^#+ .*\bStep [0-9]' …/history/phase-N-<slug>.md` — equals the step count.
   - `grep -c '```mermaid' …` accounts for the dependency diagram (and any others moved).
   - the tracks table and findings table are present.
   - `architecture.md` no longer contains the phase's roadmap section at all — only its "Refactoring history" table row.
     Confirm nothing was left behind: `grep -nE '^## (Improvement roadmap — Phase N|Phase N \(complete\))' architecture.md` returns nothing, and no `Step`-heading for the archived phase survives outside the history file.
   - No dangling inbound anchor links: for any section heading this archive removed or renamed (the archived roadmap section, plus any Step 4 hygiene deletions), grep the package docs for links to its slug — `grep -rn '#<slug>' packages/$1/docs` (e.g. `#phase-N-complete`, `#improvement-roadmap-phase-N`) — and repoint each hit to the history file or the new anchor.
     `rumdl` does **not** catch cross-file anchor breaks, so a sibling doc's `[label](./architecture.md#phase-N-complete)` renders fine in source but silently 404s on GitHub once the section is gone (this session broke `client-server-opportunities.md`'s `[Phase 18]` link that way).
   - Also confirm the package skill (`.pi/skills/package-$1/SKILL.md`) — note any stale phase-scored numbers it carries (test counts, file/domain counts); flag them in the hand-off but do not necessarily fix them here.
3. Once checks pass, commit and push automatically:

```bash
git add packages/$1/docs/architecture/architecture.md packages/$1/docs/architecture/history/phase-N-<slug>.md
git commit -m "docs($1): archive Phase N to history"
git push
```

Use the real phase number and slug in the commit subject and `git add` paths.
The archive commit does two things — archive **and** reconcile — so summarise the reconciliation in the body (metric refreshes, layout-tree additions, file-count corrections), since that is the more reviewable half.
Do not put `Closes #N` / `Fixes #N` in the message — reference issues as `Refs #A, #Z` in the body if useful (these issues are already closed).

## Hand off

After the push succeeds, report:

- The archived phase (number, title, history file path).
- The closed issues it covered (steps and any follow-on issues).
- Any stale phase-scored numbers noted in the package skill (`.pi/skills/package-$1/SKILL.md`) that a future pass should refresh.
- A reminder to run `/plan-improvements $1` to scope the next round.

Then stop.
Do not propose the next phase.
