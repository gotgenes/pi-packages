---
issue: 937
issue_title: "Split AGENTS.md into principles, environment, and an index; move rule lists into topic skills"
---

# Split `AGENTS.md` into principles, environment, and an index; move rule lists into topic skills

## Release Recommendation

**Release:** ship independently

Repo-level work: every touched file is outside `packages/` (`AGENTS.md`, `.pi/skills/`, `.pi/prompts/`, `scripts/release/next-version.sh`'s error text, `CONTRIBUTING.md`), so nothing releases from this issue and there is no batch to coordinate with.

## Problem Statement

The first `/audit-agent-docs` pass cut the always-loaded corpus by 8.8%, and 108 of its 109 `AGENTS.md` edits were provenance removals.
The admission test's second question — is the passage needed before the agent could know to load a skill?
— almost never fired, because the rule lists it would have moved (`Commits`, `Shell and search`, `Edit tool batches`, `Clarification gates`, `Reading this repo's own artifacts`, `Background agent guardrails`) have no skill to move into.
Separately, `AGENTS.md` is ~300 one-sentence rules under ~35 headings, and the handful of principles they instantiate are never stated, so an agent cannot tell a principle from a zsh quirk.

This plan creates the destinations, moves the rule lists into them, rewrites what remains as principles, environment facts, and an index, and teaches `/audit-agent-docs` to apply `offload` now that offload has somewhere to go.

## Goals

- `AGENTS.md` becomes principles (stated once, one example each), environment facts no model could infer, the multi-session lifecycle, the admission test, and an index — on the order of 1,500–1,700 words (estimated; the 2026-09-17 baseline is 8,045).
- Eight new topic skills under `.pi/skills/` absorb the rule lists verbatim: `git-workflow`, `shell-traps`, `edit-tool`, `clarification-gates`, `reading-artifacts`, `delegation`, `releasing`, `worktrees`.
  Each `description:` is a trigger condition ("load before …"), because the description is the only index the judgment-driven load path has.
- Two existing skills absorb the passages that already belong to them: `markdown-conventions` (architecture-doc conventions, retro file format, `pi-autoformat`'s markdown reflow quirks) and `code-design` (reading Pi's own source).
- Every prose line of the pre-split `AGENTS.md` survives verbatim in exactly one destination, or is listed in this plan as deliberately dropped — verified by a script, not by reading.
- The 11 non-package skill descriptions are rewritten as trigger conditions in the same shape.
- Each prompt template whose numbered steps hit a topic skill's trigger names that skill in its `## Load skills` list (operator decision at the design gate: the deferral in the issue is about extension-driven deterministic loading, not about the prose lists templates already carry).
- The admission test's second question sharpens to "needed before any workflow step has run, or an environment fact no model could infer — everything else has a loader".
- `/audit-agent-docs` applies `offload` rows whose destination exists, and closes carried-forward rows with a `moved (<sha>)` verdict.
- Not breaking: nothing under `packages/` changes, and no published surface is touched.

## Non-Goals

- The 19 package-skill `offload` rows from the 2026-09-17 inventory (18 `package-pi-permission-system`, 1 `package-pi-subagents`).
  They move into package architecture docs and ADRs, not topic skills; filed as [#942] and dispositioned out of scope in both packages' open phases.
- Extension-driven deterministic skill loading (a `pi-prompt-template-model` feature that injects a skill body without the agent choosing to read it).
  The issue defers it; [#939]'s `unloaded-rule` retro lens is the measurement that says whether it is needed.
- The `unloaded-rule` lens itself and its count in `/audit-agent-docs` Step 1 — that is [#939], which should land with or before this change so the first post-split retros carry the measurement.
- Pruning prompt templates and subagent definitions ([#935]).
- Rewriting the five `package-*` skill descriptions: they already lead with a trigger ("Load when working on code, tests, or docs in `packages/<pkg>/`") and are left as they are.
- Re-auditing the moved content.
  Every rule moves as it stands after the 2026-09-17 prune; the next `/audit-agent-docs` run holds the skill bodies to the admission test in their new home.
- Changing anything under `packages/`, including `packages/pi-colgrep/skills/colgrep/SKILL.md` (a shipped skill with its own conventions).

## Background

- `AGENTS.md` is loaded into every session; a skill's `description:` is loaded into every session and its body only when read.
  `scripts/agent-docs/always-loaded.mjs` reports that sum: **8,499 words** today (measured; `AGENTS.md` 8,045 + 454 in 16 descriptions).
  `scripts/agent-docs/doc-growth.mjs` classifies `.pi/skills/*/SKILL.md` by path, so new skill directories need no registration in the measurement.
- Skills under `.pi/skills/` are auto-discovered by Pi from the repo root; `.pi/settings.json` lists packages, not skills, so a new skill directory needs no wiring.
- The 2026-09-17 inventory (`docs/agent-docs-audit/2026-09-17/inventory.md`) records two `offload` rows against a `releasing` skill that did not exist (first-release procedure; `minimumReleaseAge`/`trustLockfile`) and names the six kept-for-want-of-a-destination sections.
- Issue [#938] landed since: `rg -r` and `git commit -F` from a heredoc are now `pi-permission-system` deny rules, and their `AGENTS.md` sentences are one-line pointers.
  Those pointers move with `Shell and search` — the deny fires only in a trusted project with the extension loaded, so the prose still has to survive somewhere.
- Prompt templates already load skills by prose (`/plan-issue` names six; `/tdd-plan` four; `/finish-phase` four).
  Four templates and one script cite `AGENTS.md` sections by name and must be repointed: `plan-issue.md` (`§ Clarification gates`), `finish-phase.md` (`### Architecture-doc conventions`), `pr-review.md` (`Closes #N` "per AGENTS.md"), `plan-improvements.md` ("the AGENTS.md rule that a named remediation … must be verified"), and `scripts/release/next-version.sh` ("see AGENTS.md" for the first-release procedure).
- `/retro` Step 7 already routes a passage that fails the admission test's second question to "the named skill's body"; after this change that sentence is true, so `/retro` needs no edit.
- `scripts/agent-docs/model-usage.mjs` parses session names of the form `#N <Stage> — <title>`; the convention must remain stated in `AGENTS.md`, but the per-stage table is redundant with the templates that call `set_session_name`.
- Constraints from `AGENTS.md` that apply: `pi-autoformat` reflows every `Edit`/`Write`, so re-read a region before matching against it; `rumdl`'s `MD057` cache must be cleared after moving content that other docs link to; append markdown with `Write`/`Edit`, never a heredoc.

## Design Overview

### The new `AGENTS.md` (estimated 1,500–1,700 words)

```text
# AGENTS.md
## Monorepo structure          ~120  workspace, launch from root, pnpm --filter, package skills, scope:repo
## Principles                  ~400  six principles, one example each (below)
## Environment                 ~550  facts no model could infer (below)
## Working an issue            ~200  the five-stage lifecycle, session naming, retro stage notes exist, /retro-note, issue-context.sh
## Admission test              ~150  sharpened (below)
## Index                       ~250  "before you X, load Y" — every skill, one row each, plus the deny rules that replace prose
```

`Environment` holds, compressed to the fact: the shell is zsh (no word-split of unquoted parameters, `=word` expansion, `$status` read-only, `no matches found` aborts on an unquoted glob); `pi-autoformat` reflows what was just written (the one-sentence fact; the quirk list moves); prompt-template expansion and extension code are stale in-process; Pi's own source sits at `../pi` (one line; the reading rules move to `code-design`); pnpm only, `committed` on `commit-msg`, `prek` hooks; releases are dispatched, never automatic, and `next-version.sh` is the read-only probe (three lines; the rest moves to `releasing`); worktree peers live at `~/development/pi/pi-packages-worktrees/issue-<N>` and `main` stays linear (three lines; the rest moves to `worktrees`); the `pi-permission-system` deny rules that replaced two prose tripwires.

### Principles

Stated once, one example each, no incident:

1. **Verify against the real surface, not the document about it.**
   `--help`, the compiled `.js`, `pnpm view <pkg> versions` — before a fact lands in a gate, a floor, a migration note, or a security boundary.
2. **State what you checked, not what you conclude.**
   A reviewer cannot verify a coverage claim handed to it as a premise; a subagent's universal claim ("nothing else calls this") is the one to verify.
3. **Provenance belongs in git.**
   Docs describe current behavior; a `(Refs #N)` survives only when the issue encodes an active constraint.
4. **A number a command can produce is never authored.**
   Timestamps, counts, SHAs, versions, issue numbers — run the command, then write what it printed.
5. **Mechanism is forever; docs are reversible.**
   Prefer a config pattern or a documented recommendation over a new runtime mechanism (the reading `package-pi-autoformat` and `package-pi-permission-system` already use).
6. **Keep scope tight.**
   Small reversible changes; preserve intentional behavior; ask before removing functionality or changing a default.

The exact wording is the build session's to settle within these six; adding a seventh is a gate question, not a drafting choice.

### Admission test (sharpened)

```markdown
1. Could a current model act correctly without it?
   If yes, it belongs nowhere.
2. Is it needed before any workflow step has run, or is it an environment fact no model could infer?
   If neither, it belongs in the body of the topic skill whose trigger it fires at.
   Every rule has a loader now; a missing destination is a reason to create one, not to keep the rule here.
3. Does the rule stand without its incident?
   If yes, keep the rule and drop the story; a `(Refs #N)` stays only when the issue encodes a constraint a reader may need to trace.
```

The issue words this as sharpening the *first* question; as written, question 1 already sends a passage nowhere, so the sharpening lands in question 2's slot, which is the one that "barely fired".
The recurrence-heuristic paragraph after the list stays.

### Skill roster

| Skill                 | Absorbs (current `AGENTS.md` headings)                                                                                                                                                                                                                                   | Est. words | `description:` (trigger condition)                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git-workflow`        | `##### Commits`; from `### Workflow`: the `gh` state-mutating probe rules (`gh issue view`, never run a mutating command to discover it, REST probe on 5xx)                                                                                                              | ~1,450     | Load before `git commit`, `--amend`, `rebase`, `reset`, or a `gh` command that mutates state; before writing a commit body, a `Co-authored-by:` trailer, or a `BREAKING CHANGE:` note; and before pricing a rename as breaking. |
| `shell-traps`         | `##### Shell and search` minus the zsh facts kept in `Environment`                                                                                                                                                                                                       | ~400       | Load before a bash call with a pipeline, loop, heredoc, `sed`/`perl` in-place edit, or `gh … --body`; before gating a commit on a piped check; and before re-verifying a count established earlier.                             |
| `edit-tool`           | `#### Edit tool batches`; from `#### Tool-injected messages`: the heredoc-skips-formatting and `export type` merge quirks                                                                                                                                                | ~650       | Load before a multi-entry `Edit` batch, a scripted bulk substitution or symbol rename, wrapping or inserting a block in a source file, or swapping a file against a git ref.                                                    |
| `clarification-gates` | `#### Clarification gates`                                                                                                                                                                                                                                               | ~290       | Load before calling `ask_user`: lead with substance, define terms, price options, name the shared premise, label every number measured or estimated.                                                                            |
| `reading-artifacts`   | `### Reading this repo's own artifacts`; from `#### Multi-session issue lifecycle`: the release-please-is-history line                                                                                                                                                   | ~560       | Load before citing a plan's Non-Goals, a roadmap `Outcome:`/`Cause:`, an ADR, a triage verdict, a PR's status, or a third-party report as evidence, and before pinning a dependency floor.                                      |
| `delegation`          | `#### Background agent guardrails`; from `###### Pre-completion reviewer` and `###### Craftsmanship subagents`: the `model:` alias-form rule and the one-line description of each subagent's role                                                                        | ~380       | Load before dispatching a subagent, editing a `.pi/agents/*.md` definition, or reading a subagent's report.                                                                                                                     |
| `releasing`           | `### Releasing` minus the three-line summary; `### Docs-in-distribution convention`; from `## Monorepo Structure`: the new-package wiring checklist; from `#### Multi-session issue lifecycle`: release batching and the release-is-independent-of-issue-state paragraph | ~1,000     | Load before dispatching a release, a package's first publish, adding a new package, editing a `files` allowlist, or when a same-day sibling bump fails `minimumReleaseAge`.                                                     |
| `worktrees`           | `##### Parallel peer sessions (git worktrees)` minus the three-line summary                                                                                                                                                                                              | ~830       | Load before `/worktree`, `/sync-worktree`, or a worktree-lane `/ship`: launcher properties, the two-session convergence, and the ordering hazards.                                                                              |

Each new skill body is the moved sentences under the original sub-headings, preceded by one line saying when to load it.
No rule is reworded in the move; a rule that reads oddly out of its old context gets a heading, not a rewrite (the moved-line check below depends on this).

Existing skills absorb:

- `markdown-conventions` ← `### Architecture-doc conventions` (new `## Architecture docs` section), `###### Retro file format` (into `## Documentation frontmatter`, with the `date -u` timestamp rule and the `## Stage:` skeleton), and the six markdown quirks from `#### Tool-injected messages` (joins a `:` line, joins a lowercase-led sentence, splits a `§` citation, `~` strikethrough, and the reflow-then-re-read rule, under a new `## pi-autoformat reflow` section).
- `code-design` ← the Pi-source-reading paragraph from `### Workflow` (`../pi` vs `../../pi`, `Explore` with `sonnet-5`, confirm the API in the pinned version, `.js` not `.d.ts` for call order, cite the sourcemap), into `### Pi SDK boundaries`.

### Template load matrix

A template names a topic skill when one of its numbered steps performs the trigger its description names.
Add to the existing `## Load skills` list, or create one after the sync step where none exists:

| Template                       | Adds                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `plan-issue.md`                | `clarification-gates`, `reading-artifacts`, `delegation`                       |
| `tdd-plan.md`, `build-plan.md` | `git-workflow`, `edit-tool`                                                    |
| `ship.md`                      | `git-workflow`, `releasing`; `worktrees` when step 1 detects the worktree lane |
| `ship-no-issue.md`             | `git-workflow`, `releasing` (new list)                                         |
| `sync-worktree.md`             | `worktrees`, `git-workflow` (new list)                                         |
| `retro.md`                     | `clarification-gates`, `git-workflow`                                          |
| `pr-review.md`                 | `reading-artifacts`, `git-workflow`                                            |
| `plan-improvements.md`         | `delegation`, `clarification-gates`                                            |
| `finish-phase.md`              | `reading-artifacts`                                                            |
| `triage-backlog.md`            | `reading-artifacts`                                                            |
| `audit-agent-docs.md`          | `clarification-gates`                                                          |

`shell-traps` is judgment-loaded only: every template runs bash, and naming it everywhere is the always-loaded file by another route.
`retro-note.md` adds nothing.

### `/audit-agent-docs` changes

- Step 1: a carried-forward `offload` row is re-verdicted this run — `offload → <dest>` and applied when the destination exists, or `moved (<sha>)` when a change since the prior audit already relocated it (name the commit).
- Step 2 verdict table: `offload → <skill>` is "Applied by this command: yes when the destination file exists — the passage is cut from the source and appended to the destination under a fitting heading; otherwise no edit, the inventory names the destination"; add the `moved (<sha>)` row.
- Step 5: an `offload` row with an existing destination is applied like a `compress`: `grep -n` the passage, re-read, cut, append to the destination; refs move with it.
- Step 6 item 3: for each applied `offload`, the passage's distinctive phrase is absent from the source and present in the destination.
- Step 6 item 4 (Assessment): the "kept only because it had nowhere to go" bullet stays; it should now name a destination that needs *creating*.

### Verification instrument

The moved-line check, run against the pre-split commit at every step (see Test Impact Analysis), is what makes "moved, not vanished" a measurement.
The build session writes it to `/tmp/moved-check.sh` at its first step; it does not join `scripts/`.

## Module-Level Changes

- `AGENTS.md` — rewritten per the skeleton above.
  Deliberately dropped (not moved) lines, the only ones the moved-line check may report: the `###### Session naming convention` table (kept as one line: `#N <Stage> — <title>`, set by each template), the `###### Pre-completion reviewer` and `###### Craftsmanship subagents` paragraphs except the sentences moved to `delegation` (the rest duplicates `pre-completion`, `tidy-first`, and the agent files), the four index stubs `##### Code Style` / `Markdown` / `Mermaid` / `Testing` (become index rows), the `### Admission test` list (rewritten), and the `Retro file format` example block (moves as a whole to `markdown-conventions`; its lines are inside a fence, which the check skips).
- `.pi/skills/git-workflow/SKILL.md`, `shell-traps/`, `edit-tool/`, `clarification-gates/`, `reading-artifacts/`, `delegation/`, `releasing/`, `worktrees/` — new, per the roster.
- `.pi/skills/markdown-conventions/SKILL.md`, `.pi/skills/code-design/SKILL.md` — absorb per the roster; descriptions rewritten.
- `.pi/skills/{design-review,fallow,improvement-discovery,mermaid,pi-extension-lifecycle,pre-completion,roadmap-fit,testing,tidy-first}/SKILL.md` — `description:` only, rewritten as a trigger condition.
- `.pi/prompts/plan-issue.md` — line ~130 `AGENTS.md § Clarification gates` → the `clarification-gates` skill; `## Load skills` additions.
- `.pi/prompts/finish-phase.md` — line ~150 `AGENTS.md (### Architecture-doc conventions)` → `markdown-conventions` (`## Architecture docs`); load addition.
- `.pi/prompts/pr-review.md` — line ~142 "per AGENTS.md" → the `git-workflow` skill; load additions.
- `.pi/prompts/plan-improvements.md` — line ~182 "the AGENTS.md rule that a named remediation …" → the `git-workflow` skill; load additions.
- `.pi/prompts/{tdd-plan,build-plan,ship,ship-no-issue,sync-worktree,retro,triage-backlog}.md` — load additions only.
- `.pi/prompts/audit-agent-docs.md` — Steps 1, 2, 5, 6 per the design; load addition.
- `scripts/release/next-version.sh` — the two "AGENTS.md" mentions in the no-tag error path → `.pi/skills/releasing/SKILL.md`.
- `CONTRIBUTING.md` — line 28: `AGENTS.md` "is the full reference" → `AGENTS.md` and the skills under `.pi/skills/` are.
- `docs/retro/0937-split-agents-md-into-topic-skills.md` — stage notes.

Predicted unchanged, and why:

- `README.md` line 110 ("Root `AGENTS.md` — monorepo-wide conventions") — still true of the rewritten file.
- `scripts/bin/npm`, `scripts/bin/npx` ("See AGENTS.md for pnpm conventions") — the pnpm-only rule stays in `Environment`.
- `scripts/agent-docs/*.mjs` — path-classified; `model-usage.mjs`'s comment cites a convention that stays stated.
- `.pi/prompts/retro.md` — its references are to the admission test (stays, same heading) and to `AGENTS.md` as a growth site (still true); Step 7 already routes to "the named skill's body".
- `.pi/agents/pre-completion-reviewer.md` — cites `AGENTS.md` generically and its example names a section (`Multi-session lifecycle`) that survives in short form.
- `.pi/skills/pre-completion/SKILL.md` — `AGENTS.md` appears in a sample file list.
- `docs/agent-docs-audit/2026-09-17/inventory.md` — an audit record; its two `releasing` rows are closed by the *next* audit's `moved (<sha>)` verdict, not by editing history.

## Test Impact Analysis

No `src/`/`test/` changes; the testable surface is the shell commands the plan prescribes.
Dry-run results at planning time:

1. **Always-loaded measurement** — `node scripts/agent-docs/always-loaded.mjs` prints `agentsMd=8045 descriptions=454 total=8499` today (measured).
   Predicted after: `agentsMd` 1,500–1,700; `descriptions` 454 + ~320 for eight new skills ± the 11 rewrites; `total` ≈ 2,300–2,500 (estimated).
   Recorded in the final commit body and the retro note; the next `/audit-agent-docs` run writes the dated snapshot.

2. **Moved-line check** — every prose line of the pre-split `AGENTS.md` (352 lines today, measured: non-blank, non-heading, outside fences) must appear verbatim in `AGENTS.md` or some `.pi/skills/*/SKILL.md`:

   ```bash
   base=$(git rev-parse HEAD)   # run once before step 1; reuse the SHA in every later step
   cat AGENTS.md .pi/skills/*/SKILL.md > /tmp/corpus.txt
   git show "$base:AGENTS.md" \
     | awk 'BEGIN{f=0} /^```/{f=!f; next} f{next} /^\s*$/{next} /^#/{next} {print}' \
     | while IFS= read -r line; do
         grep -qF -- "$line" /tmp/corpus.txt || printf 'MISSING: %s\n' "$line"
       done
   ```

   Prints nothing against an unchanged tree (dry-run: 0 lines).
   After each move step it must print nothing; after the `AGENTS.md` rewrite step it may print only the lines the Module-Level Changes list as deliberately dropped.
   The `while read` loop is the intended form — `grep -F -f` would treat the list as patterns and match substrings across lines.

3. **Duplicate check** — no moved line may survive in two places: `for f in .pi/skills/*/SKILL.md; do grep -cFf <(grep -v '^#' "$f" | grep -v '^\s*$') AGENTS.md; done` should print `0` per skill after the rewrite (a fixed-string overlap between a skill body and `AGENTS.md` is a line that was copied, not moved).
   Dry-run today: not meaningful (nothing moved yet).

4. **Lint** — `find .rumdl_cache -type f -delete && pnpm run lint` after the rewrite step, because `finish-phase.md` and `plan-issue.md` link into `AGENTS.md` by heading text and the cache would hide a broken anchor.
   Also `pnpm exec rumdl check` on each new skill file at its step.

5. **Skill discovery** — a fresh `pi` session's system prompt lists each new skill under `<available_skills>` with its description; verified once at the end by the operator (the running session cannot see skills added mid-session — `AGENTS.md` § Stale in-process extension code).

6. **Template pointers** — `rg -n 'AGENTS\.md' .pi/prompts .pi/agents .pi/skills scripts CONTRIBUTING.md` after the repoint step lists only the predicted-unchanged mentions above.

7. **`next-version.sh` error text** — the no-tag branch is unreachable by a real package name (every package is tagged; dry-run: `next-version.sh no-such-pkg` exits on the unknown-package check first), so verify by text: `grep -c 'AGENTS.md' scripts/release/next-version.sh` prints `2` today and must print `0` after step 7, with `grep -c 'releasing/SKILL.md'` printing at least `1`.

## Invariants at risk

- **The two `#938` deny-rule pointers survive as prose.**
  `rg -r` and `git commit -F` from a heredoc are enforced only in a trusted project with `pi-permission-system` loaded; the one-line pointers move to `shell-traps` (and `git-workflow` for the commit one) intact.
  Pinned by the moved-line check.
- **The admission test remains addressable as `### Admission test` in `AGENTS.md`.**
  `/retro` Step 7 and `/audit-agent-docs` cite it by that heading; the heading level changes to `##` in the new skeleton, so both citations are re-read (`### Admission test` → `## Admission test`) in the rewrite step.
- **`#N <Stage> — <title>` stays stated in `AGENTS.md`** for `scripts/agent-docs/model-usage.mjs`'s comment and the templates.
- **The `#### Deferred tidyings` and `#### Phase handoff` grep-able headings** are named in `plan-issue.md` and `tidy-first`, not in `AGENTS.md`; unaffected.
- **`/finish-phase`'s bounded doc-hygiene step** cites the architecture-doc convention by `AGENTS.md` heading; the repoint is in the same commit as the move (step 9).
- **The audit's before/after series** — `docs/agent-docs-audit/*/always-loaded-*.txt` — is unaffected; this change records its own numbers in the commit body and the next audit writes the snapshot.

## TDD Order

Docs-only; each step is a build step with a verify criterion, executed by `/build-plan`.
Record `base=$(git rev-parse HEAD)` before step 1 and use it for every moved-line check.

1. **Create `git-workflow`** — move `##### Commits` and the `gh` probe rules out of `### Workflow`; repoint `pr-review.md` and `plan-improvements.md`.
   Verify: moved-line check prints nothing; `rumdl check` on the new file.
   Commit: `docs: move commit and gh-mutation rules into a git-workflow skill (#937)`.
2. **Create `shell-traps`** — move `##### Shell and search` except the four zsh facts, which stay in place for step 10.
   Verify: moved-line check; the `rg -r` and `git commit -F` pointer lines appear in the new file.
   Commit: `docs: move shell rules into a shell-traps skill (#937)`.
3. **Create `edit-tool`** — move `#### Edit tool batches` and the two code-side `pi-autoformat` quirks.
   Verify: moved-line check.
   Commit: `docs: move Edit-tool rules into an edit-tool skill (#937)`.
4. **Create `clarification-gates`** — move `#### Clarification gates`; repoint `plan-issue.md` line ~130.
   Verify: moved-line check; `rg -n '§ Clarification gates' .pi` prints nothing.
   Commit: `docs: move ask_user rules into a clarification-gates skill (#937)`.
5. **Create `reading-artifacts`** — move `### Reading this repo's own artifacts` and the release-please-history line.
   Verify: moved-line check.
   Commit: `docs: move artifact-reading rules into a reading-artifacts skill (#937)`.
6. **Create `delegation`** — move `#### Background agent guardrails`, the `model:` alias-form rule, and one line per subagent's role.
   Verify: moved-line check.
   Commit: `docs: move subagent guardrails into a delegation skill (#937)`.
7. **Create `releasing`** — move `### Releasing` (minus the three-line summary), `### Docs-in-distribution convention`, the new-package checklist, and the release-batching paragraphs; repoint `next-version.sh`.
   Verify: moved-line check; `grep -c 'AGENTS.md' scripts/release/next-version.sh` prints `0`; `bash -n scripts/release/next-version.sh` passes.
   Commit: `docs: move release and packaging rules into a releasing skill (#937)`.
8. **Create `worktrees`** — move `##### Parallel peer sessions (git worktrees)` minus the three-line summary.
   Verify: moved-line check.
   Commit: `docs: move worktree conventions into a worktrees skill (#937)`.
9. **Absorb into `markdown-conventions` and `code-design`** — architecture-doc conventions, retro file format, markdown reflow quirks; Pi-source reading; repoint `finish-phase.md`.
   Verify: moved-line check; `rg -n 'Architecture-doc conventions' .pi/prompts` prints nothing.
   Commit: `docs: move architecture-doc, retro-format, and Pi-source rules into existing skills (#937)`.
10. **Rewrite `AGENTS.md`** — principles, environment, working-an-issue, sharpened admission test, index; delete the emptied headings.
    Verify: moved-line check prints only the deliberately-dropped lines; duplicate check prints `0` per skill; cache-cleared `pnpm run lint`; `always-loaded.mjs` `agentsMd` within 1,500–1,700 — a number outside the band is a finding to report, not a target to hit by cutting.
    Commit: `docs: rewrite AGENTS.md as principles, environment, and an index (#937)`, body carrying the before/after `always-loaded.mjs` lines.
11. **Rewrite the 11 skill descriptions** as trigger conditions.
    Verify: `always-loaded.mjs` `descriptions` line recorded; each description still parses (`node -e` import of `skillDescription` from `scripts/agent-docs/always-loaded.mjs` returns non-empty for every file).
    Commit: `docs: state every skill description as a trigger condition (#937)`.
12. **Template load lists** per the matrix.
    Verify: `rg -n 'Load skills' -A 12 .pi/prompts/*.md` shows each row; `rg -n 'AGENTS\.md' .pi scripts CONTRIBUTING.md` matches only the predicted-unchanged set.
    Commit: `docs: name the topic skills in each template's load list (#937)`.
13. **`/audit-agent-docs` applies `offload`** — Steps 1, 2, 5, 6 per the design; `CONTRIBUTING.md` wording.
    Verify: `rumdl check` on both; the Step 2 table has the `moved (<sha>)` row.
    Commit: `docs: let /audit-agent-docs apply offload rows and close moved ones (#937)`.

Steps 1–9 are order-independent among themselves but each must precede step 10; steps 11–13 follow 10.

## Risks and Mitigations

- **A rule applied but sat in an unloaded skill (the false negative the issue names).**
  Mitigated three ways: trigger-condition descriptions, the template load matrix, and [#939]'s measurement.
  Not eliminated — that is the accepted residual, and the retro lens is what says whether it is tolerable.
- **A line is dropped in a move.**
  The moved-line check runs at every step against the pre-split SHA; anything it prints that is not on the deliberately-dropped list is a defect in that step.
- **A line is copied, not moved.**
  The duplicate check at step 10 catches fixed-string overlap between any skill body and `AGENTS.md`.
- **`pi-autoformat` reflows a moved line** (joins a `:` line, joins a lowercase-led sentence), so the moved-line check reports a line that is present but re-wrapped.
  Re-read the destination region after each `Write`; when a join is the cause, restore the original break by starting a new paragraph, since the rule about `:` joins is itself among the lines being moved.
- **A heading-level change breaks a citation.**
  Only `### Admission test` is cited by heading level (`/retro`, `/audit-agent-docs`); the rewrite step updates both.
- **The rewritten principles drift from the rules they summarize.**
  The principles section adds no new rule; every rule it exemplifies still exists verbatim in a skill.
  The pre-completion reviewer is asked to read the six principles against the skill bodies and name any principle with no instance.
- **Skill descriptions grow the always-loaded number back.**
  Budget: eight new descriptions at ≤ 45 words each (≤ 360 total); the 11 rewrites net ≤ +40.
  Step 11 reports the `descriptions` line; over budget is a finding for the retro, not a reason to cut a trigger.

## Open Questions

- Whether the moved-line check should join `scripts/agent-docs/` for `/audit-agent-docs`'s Step 6 offload verification.
  Deferred until a second audit needs it; the template's per-row grep suffices for a handful of rows.
- Whether the five `package-*` descriptions should say "load before" rather than "load when working on" for uniformity.
  Cosmetic; left for the next audit.

[#935]: https://github.com/gotgenes/pi-packages/issues/935
[#938]: https://github.com/gotgenes/pi-packages/issues/938
[#939]: https://github.com/gotgenes/pi-packages/issues/939
[#942]: https://github.com/gotgenes/pi-packages/issues/942
