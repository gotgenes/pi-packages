---
description: Measure the agent documentation, classify every passage against the admission test, gate the inventory, and apply the approved cuts — for AGENTS.md and skills (docs), prompt templates and subagent definitions (workflow), or both
model: anthropic/claude-opus-5-5
---

# Audit the agent documentation

Corpus: `$1` — `docs`, `workflow`, or empty for both.

| Corpus              | Files                                          |
| ------------------- | ---------------------------------------------- |
| `docs`              | `AGENTS.md` and every `.pi/skills/*/SKILL.md`  |
| `workflow`          | every `.pi/prompts/*.md` and `.pi/agents/*.md` |
| `all` (no argument) | both of the above                              |

Any other value: stop and report the three accepted values.

Your job is to hold the corpus to the `## Admission test` in `AGENTS.md`, read per class as `## The admission test by class` below says, and to land the cuts it justifies.
The test is short; read it now, before anything else.
This template is periodic and manually triggered — nothing runs it on a schedule — and it is the counterweight to `/retro`, which is where those files grow.

You will produce two commits: a dated inventory and its measurements, then the prune the inventory authorized.
The inventory is the record; the prune is reviewable against it.

## Sync with remote (do this first)

1. Run `git pull --ff-only`.
2. If it fails for **any** reason — uncommitted changes, divergent history, merge conflict, network error, detached HEAD — stop immediately and report the failure.
   Do not stash, rebase, force, or otherwise resolve.
3. Only proceed on a clean fast-forward (or `Already up to date.`).
4. Refuse to run on any branch but `main`.
   The prune is applied on the current branch, and the current branch is meant to be trunk.

Call `set_session_name` with `Agent-doc audit — <YYYY-MM-DD> (<corpus>)`.

## Load skills

- `markdown-conventions` — for the inventory and for every edit you will make.
- `clarification-gates` — for the Step 4 gate.
- `github-voice` is **not** needed; this template writes no GitHub-facing text.

## The admission test by class

The three questions are the same for every class, and questions 1 and 3 read identically.
Question 2 asks where a passage belongs, and its answer depends on how the file reaches the model:

| Class            | Paid for                                                                                                                  | A passage passes question 2 when…                                                                                                                   | When it fails                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `AGENTS.md`      | every session                                                                                                             | it is needed before any workflow step has run, or is an environment fact                                                                            | `offload → <skill>`                                                                        |
| Skill body       | when read                                                                                                                 | it fires at the trigger the skill's description names                                                                                               | `offload → <skill>`                                                                        |
| Prompt template  | each invocation, for the rest of that session                                                                             | it is a procedure step only this template performs; a rule whose trigger a skill's description names fails even when that skill does not yet say it | `delete` (dup of `<skill>`) when that skill already says it; `offload → <skill>` otherwise |
| Agent definition | each dispatch, as the child's system prompt (appended to the parent's, so the child sees `AGENTS.md` and can load skills) | the child needs it and does not get it from `AGENTS.md`, the dispatch prompt, or a skill the body tells it to load                                  | as for templates                                                                           |

Invocation cost changes no verdict — a passage a current model does not need is waste wherever it is paid.
It changes where you look first: walk the skills and the `workflow` corpus in `invocation-volume.csv` order.

One duplication shape is **not** a duplicate: a reviewer agent's check that mirrors an instruction a template gives the implementer.
That is a second actor verifying the first, which is the reviewer's purpose; a verdict of duplication needs the two passages to address the same actor.

## Step 1: Measure

Create the dated directory and write the corpus-independent measurements:

```bash
D=docs/agent-docs-audit/$(date -u +%F)
mkdir -p "$D"
node scripts/agent-docs/doc-growth.mjs > "$D/doc-growth.csv"
node scripts/agent-docs/model-usage.mjs > "$D/model-usage.csv"
```

For `docs` (or `all`):

```bash
node scripts/agent-docs/always-loaded.mjs | tee "$D/always-loaded-before.txt"
```

For every corpus, fix the window's end at today so the before and after runs count the same invocations:

```bash
UNTIL=$(date -u +%F)
node scripts/agent-docs/invocation-volume.mjs --until "$UNTIL" > "$D/invocation-volume.csv"
node scripts/agent-docs/invocation-volume.mjs --until "$UNTIL" --total | tee "$D/invocation-volume-before.txt"
```

The `--total` line carries one field per kind, and a run records only its corpus's kinds: `skills=` for `docs`, `templates=` and `agents=` for `workflow`, all three for `all`.
Its headline number is the sum of those kinds, which is the line's own `total=` only for `all`.

`doc-growth.csv` reproduces from git at any later date; `model-usage.csv` and `invocation-volume.csv` read a machine-local, prunable session store and are committed precisely because they cannot be re-derived.
The `always-loaded` and `invocation-volume` lines are the numbers this audit is measured against: write them into the inventory header in Step 3 as the **before**.
Each `bash` call is a fresh shell, so `D` and `UNTIL` do not survive to Step 6; re-set them there from the directory name and the `until=` field of `invocation-volume-before.txt`, never from a new `date`.

Then read the prior audit of each corpus in this run, if any.
List the inventories with `ls -1 docs/agent-docs-audit/*/inventory*.md`; an `inventory-<corpus>.md` names its corpus, and a bare `inventory.md` predates the argument and covers `docs`.
Open the newest one covering each corpus you are auditing.
Carry forward every row it marked `offload` or `keep (revisit)` — those are the verdicts it deferred, and this audit answers for them.
A carried-forward `offload` row is re-verdicted this run: `offload → <dest>` again (and applied in Step 5 when the destination file now exists), or `moved (<sha>)` when a change since the prior audit already relocated the passage — `git log -S'<distinctive phrase>'` names the commit.

## Step 2: Classify

For `docs`, walk `AGENTS.md` section by section, then each skill file in `invocation-volume.csv` order (its `skill` rows).
For `workflow`, walk each template, then each agent definition, in `invocation-volume.csv` order (its `template` and `agent` rows).
A passage is a sentence or a tightly bound group of sentences making one claim; in these files a sentence is a line.

Give every passage exactly one verdict:

| Verdict            | Meaning                                                                                    | Applied by this command                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keep`             | Passes all three admission questions                                                       | No edit                                                                                                                                                                                             |
| `offload → <dest>` | Real, but fails the second question: it fires at a trigger a skill's description names     | Yes when `<dest>` exists — cut the passage from the source and append it to the destination under a fitting heading; otherwise no edit, and the inventory names the destination that needs creating |
| `moved (<sha>)`    | A carried-forward `offload` whose passage a change since the prior audit already relocated | No edit; closes the row                                                                                                                                                                             |
| `compress`         | The rule stands; the incident attached to it does not                                      | Yes — rewrite the line to the rule alone                                                                                                                                                            |
| `delete`           | Fails the first question, or is superseded, duplicated, or stale                           | Yes — remove the line                                                                                                                                                                               |

Read the admission test's recurrence heuristic as it is written: a rule with no retro recurrence since 2026-07-20 is a *candidate*, and survivorship is the confound.
When you mark such a rule `delete`, the rationale column says the rule was checked against the retros (`grep -rln '<distinctive phrase>' docs/retro packages/*/docs/retro`) and names the last one that mentions it.

These shapes deserve a stated rule rather than case-by-case judgment:

- **A `(Refs #N)` on a `compress` line.**
  It survives only when the issue encodes a constraint a reader may need to trace — a lint-guarded boundary, an ADR, a structural invariant.
  Provenance alone is dropped; git log has it.
- **`Refs #N` as syntax, not citation.**
  A template that tells the agent to write `Refs #$1` in a commit body, or to read a PR body for `Refs #N`, is giving an instruction; the rule above does not reach it.
- **An issue number as data.**
  A sample row (the `triage-backlog.md` tables), an example of shape, or a pointer to a live artifact the step reads (an open decision the template names) is kept as data — the live pointer only while its artifact is open.
- **An inline incident narrative** ("#873's plan named `reload()`, but …") is a question-3 `compress` like any other story.
- **A section that is retro spillover.**
  A section that reads as a session's debugging narrative rather than as guidance (`package-pi-permission-system`'s `## Debugging`, 2,571 words at the first audit) is one `offload → docs/retro` row for the whole section, not a row per line.
- **A whole numbered step or a heading** in a template or agent definition is never removed in a prune.
  Steps are cross-referenced by number, within a file and across files, so removing one renumbers the rest.
  Mark it `keep (revisit)` with the rationale "whole-step removal needs renumbering"; that is a separate change.
- **Frontmatter, an H1, and an argument placeholder** (`$1`, `$@`) are never edited.
  The H1 is `invocation-volume.mjs`'s match key.
- **An explanation of a practice the skill already names.**
  A `## Chosen practices` section states the operator's choices and the schools they come from.
  A passage that explains what one of those practices is fails question 1, and one that restates a choice the section makes is a duplicate; both are `delete`.
  A line that states a choice neither the section nor the schools settle is `keep`.

`package-pi-permission-system` is a third of the skill corpus, and `plan-issue.md` and `pre-completion-reviewer.md` lead the workflow corpus.
Walk them like the rest, and give each its own summary line in the inventory so its share of the cuts is visible.

## Step 3: Write the inventory

Write `docs/agent-docs-audit/<date>/inventory-<corpus>.md`:

````markdown
---
audit: <YYYY-MM-DD>
corpus: <docs|workflow|all>
---

# Agent-doc audit — <YYYY-MM-DD> (<corpus>)

Always loaded before: <total> words (AGENTS.md <n> + skill descriptions <n> + agent descriptions <n>).
Always loaded after: _filled in Step 6_.
Invocation volume before: <sum> words (skills <n> + templates <n> + agents <n>, <since> to <until>).
Invocation volume after: _filled in Step 6_.

## Summary

| File | Passages | keep | offload | compress | delete |
| --- | --- | --- | --- | --- | --- |
| AGENTS.md | … | … | … | … | … |
| .pi/skills/package-pi-permission-system/SKILL.md | … | … | … | … | … |
| all other skills | … | … | … | … | … |
| .pi/prompts/plan-issue.md | … | … | … | … | … |
| all other templates | … | … | … | … | … |
| .pi/agents/pre-completion-reviewer.md | … | … | … | … | … |
| other agents | … | … | … | … | … |

## Assessment

_Filled in Step 6._

## Inventory

| File | Section | Passage | Verdict | Rationale |
| --- | --- | --- | --- | --- |
| AGENTS.md | Commits | "Do not gate a commit…" | compress | rule stands; drop the #885 story |
| .pi/prompts/ship.md | 4. Close | "A fabricated SHA does not auto-link…" | compress | rule stands; drop the provenance suffix |
| .pi/skills/package-pi-permission-system/SKILL.md | Debugging | whole section | offload → docs/retro | retro spillover, not package context |
````

Keep only the header lines and summary rows for the corpus this run covers.
The `Passage` cell is the first few words, enough to find the line with `grep -n`; the `Rationale` is one clause.
A `keep` row still gets a rationale when the passage looked cuttable — that is the record of why it stayed.

Lint it before the gate: `pnpm exec rumdl check docs/agent-docs-audit/<date>/inventory-<corpus>.md`.

## Step 4: Gate (hard)

Put the **whole inventory** to the operator in one `ask_user` pass, with the summary table in the message and the file path for the full list.
Take every count in the message from a `grep -c` over the inventory file run after its last edit, never from memory of classifying it.
Offer exactly two options: apply the inventory as written, or stop so the operator edits the inventory by hand — after which you re-read it and re-gate.
No per-passage round trips.

Do not edit any file in the corpus before this gate returns "apply".

## Step 5: Apply

Before the first edit, record what the Step 6 checks compare against:

```bash
grep -h '^# ' .pi/prompts/*.md > /tmp/audit-h1-before.txt
```

For every `delete`, `compress`, and destination-exists `offload` row, in file order:

1. `grep -n` the passage to find its current line — line numbers move as you cut, so never carry one forward.
2. Re-read the surrounding region before each `Edit`.
   `pi-autoformat` reflows the file after every edit, so an `oldText` built from what you wrote a moment ago can fail to match.
3. `delete`: remove the line.
   If it was the only sentence in a paragraph, remove the now-empty paragraph too; if it was the only content under an unnumbered heading in a skill or `AGENTS.md`, remove the heading.
4. `compress`: replace the line with the rule alone, keeping a `(Refs #N)` only where the inventory's rationale says the citation encodes a constraint.
5. `offload` with an existing destination: cut the passage from the source and append it verbatim to the destination under the heading that fits (or a new one); a `(Refs #N)` moves with it under the same rule as `compress`.
   A passage that reads oddly out of its old context gets a heading, not a rewrite — the verification in Step 6 greps for the moved text.
   When the source is a template, it must still load the destination: add the skill to its `## Load skills` list, or — for a template without one — write "load the `<skill>` skill" at the step that needs it.
   When the source is an agent definition, the body tells the child to load the skill at the point it applies.

`keep`, `moved`, and destination-missing `offload` rows are not applied.
A destination that does not exist is a design choice for a separate change; the inventory has named it, and the next audit closes the row as `moved` once that change lands.

## Step 6: Verify and commit

1. Clear the markdown-lint cache and lint from the root — a deleted heading can orphan a cross-file link that the cache would hide:

   ```bash
   find .rumdl_cache -type f -delete
   pnpm run lint
   ```

2. Re-measure with the same window and write the numbers into the inventory header's **after** lines:

   ```bash
   node scripts/agent-docs/always-loaded.mjs | tee "$D/always-loaded-after.txt"
   node scripts/agent-docs/invocation-volume.mjs --until "$UNTIL" --total | tee "$D/invocation-volume-after.txt"
   ```

   Run the `always-loaded` line only when the audit covered `docs`.

3. Confirm every applied row landed: for each `delete`, `grep -c '<passage>'` on its file returns 0; for each `compress`, the rule's distinctive phrase is still present and the incident's is not; for each applied `offload`, the distinctive phrase is absent from the source and present in the destination.

4. When the run applied any `offload` row, verify the **corpus** as well — a per-row grep cannot see a line dropped rather than mis-moved:

   ````bash
   # Step 5's edits are still uncommitted here, so HEAD is the pre-prune tree.
   git show "HEAD:<source>" \
     | awk 'BEGIN{f=0} /^```/{f=!f; next} f{next} /^\s*$/{next} /^#/{next} {print}' \
     | while IFS= read -r l; do
         grep -qF -- "$l" <destination-files> || printf 'MISSING: %s\n' "$l"
       done
   ````

   Every line it prints must be a recorded `delete`/`compress` target, a heading the destination re-shaped, or a `pi-autoformat` reflow; anything else is a lost line.

5. For `workflow`, confirm the structure the executing agents depend on survived:
   - `grep -h '^# ' .pi/prompts/*.md | diff /tmp/audit-h1-before.txt -` prints nothing — no H1 moved.

   - For each edited template, the skills it loads are a superset of the pre-prune set; this prints nothing when they are:

     ```bash
     skills() { grep -oE '`[a-z-]+` skill' | sort -u; }
     comm -13 <(skills < <file>) <(git show "HEAD:<file>" | skills)
     ```

   - Every `step N`/`Step N` reference into an edited template (`grep -rn '<template-name>.*[Ss]tep [0-9]' .pi/prompts .pi/agents .pi/skills AGENTS.md`, plus the template's own "step N" mentions) still names the step it meant.

6. Write the inventory's `## Assessment` — the audit's verdict on the admission test, not on the corpus:
   - Which verdict dominated, and what that says about where the growth is.
   - Which admission question did the cutting, and which never fired.
     A question that never fires is disconnected, not satisfied.
   - Any passage kept only because it had nowhere to go; name the destination that does not exist and needs creating.

7. Commit twice, adding the corpus's paths — `AGENTS.md .pi/skills/` for `docs`, `.pi/prompts/ .pi/agents/` for `workflow` (plus `.pi/skills/` when an offload landed there), all four for `all`:

   ```bash
   git add docs/agent-docs-audit/<date>/
   git commit -m "docs(agent-docs): audit <date> (<corpus>)"
   git add <corpus paths>
   git commit -m "docs: prune <corpus> agent docs per <date> audit"
   git push
   ```

   The second commit's body names each measured before and after, and the count of `delete`, `compress`, and `offload` rows applied.

## Finally

Report each measured before and after number, the row counts by verdict, and the `offload` rows still open (destination missing) — those are the manual follow-through this audit hands to whoever picks them up.
If an after number is not below its before, say so plainly; an audit that cut nothing is a finding about the admission test, not a success.
Report the `## Assessment` too: a cut composed almost entirely of provenance is the same kind of finding, whatever the word count says.
