---
issue: 935
issue_title: "Audit and prune the prompt templates and subagent definitions"
---

# Retro: #935 — Audit and prune the prompt templates and subagent definitions

## Stage: Planning (2026-09-29T04:23:48Z)

### Session summary

Planned the second agent-doc audit, this one over the 13 prompt templates and 3 subagent definitions.
`/audit-agent-docs` gains a corpus argument (`docs` | `workflow` | none for both) and a per-class reading of admission question 2.
The plan also adds a tested `invocation-volume.mjs` for the workflow corpus's before/after, counts agent descriptions in `always-loaded.mjs`, and widens `/retro` Step 7's gate.
As in #934, the prune itself runs as a separate fresh-session step (plan step 9) before `/ship`.

### Observations

- **The issue's cost premise inverted after #937.**
  A throwaway transcript scan counted template and agent invocations: templates by the H1 on a user message's first line, agents by `subagent_type`.
  Over the 30 days since 2026-08-29 it measured 1,874,018 words delivered at invocation.
  The current 1,879-word `AGENTS.md` over the same 282 sessions would be about 530k.
  `plan-issue.md` alone is 566k, and `pre-completion-reviewer` comes second at 358k.
  So invocation-time cost does not lower the bar, and no per-class cost clause was added.
- **The growth pump is the same one #934 found.**
  38 of the last 60 commits to `.pi/prompts`/`.pi/agents` are `docs(retro):`.
  `/retro` Step 7 gated only `AGENTS.md` additions, and its item 1 told writers to leave "a `Refs #N` pointer", which directly feeds the citation count.
- **`Refs #N` in templates has three shapes:**
  - a provenance suffix, which the compress rule governs;
  - syntax the template reads or writes (`Refs #$1`), which the rule does not reach;
  - an issue number as data (triage sample rows, the `#639` live pointer).
  This answered the issue's second scope question without a gate question.
- **Two template-specific hazards shaped Step 5's rules.**
  Numbered steps are cross-referenced by number within and across files, so a prune never deletes a whole step.
  The H1 is now the invocation-volume match key, so a prune never edits an H1.
- **Actor-vs-reviewer duplication is not duplication.**
  `pre-completion-reviewer` checks mirror what `plan-issue` tells the planner.
  The by-class section says so, so the audit does not prune the reviewer for being redundant.
- Agent descriptions are always loaded, because pi-subagents lists them in the `subagent` tool's description, but template descriptions never reach the model.
  This was verified in `agent-tool.ts` and Pi's `system-prompt.ts`.
- Operator decisions at the gate, all taking the recommended option: a corpus argument over "always all four" or a separate command; a tested invocation-volume script over word counts only; no `AGENTS.md` clause, with the per-class reading kept in the templates.
- Tidy-First assessor: three recommended preparatory refactors, all accepted.
  - Rename `skillDescription`, and move it into a new `frontmatter.mjs` rather than the assessor's keep-in-place suggestion, so `invocation-volume.mjs` does not import from `always-loaded.mjs`.
  - Share fence parsing.
  - Export `model-usage.mjs`'s session-store defaults.
  I verified its structural claims by grep; it cited the constants at lines 12–13, but they are at 25–26.

#### Deferred tidyings

- `scripts/agent-docs/*.mjs` — four hand-rolled `parseArgs` loops.
  A shared declarative parser does not fit order-dependent defaults (`--since` derived from `--until`), so the assessor rated it optional.
- `scripts/agent-docs/always-loaded.mjs` — the CLI's skills and agents `readdirSync().map()` blocks are near-identical; the assessor rated extracting them optional.

## Stage: Implementation — TDD (2026-09-29T05:01:11Z)

### Session summary

Plan steps 1–8 landed in eight commits:

- three preparatory refactors: `frontmatter.mjs`, the exported session-store defaults, and the `invocations` generator;
- `volumeRows`, `templateHeading`, and `markdownBody`;
- the two `feat(scripts):` commits: agent descriptions in `always-loaded.mjs`, and the `invocation-volume.mjs` CLI;
- the extended `/audit-agent-docs` template;
- the widened `/retro` Step 7 gate.

Root script tests went from 247 to 267 (+20).
Step 9, the `workflow` audit, runs in a fresh session by design.
It comes before `/ship 935`, not after.
Pre-completion reviewer: PASS.

### Observations

- **The parallel `cp`-then-`Edit` race recurred on step 3,** the same failure #934's TDD retro recorded.
  The green save and the mutation went out in one tool block, so `/tmp/green-al.mjs` captured the mutant, and the restore reinstated the mutation.
  It was caught because the restored suite was still red, and fixed by re-applying the line by hand.
  After that, every green save ran in its own call.
  The rule is already in `/tdd-plan` step 3, so this is an `instruction-violation`, not a missing rule.
- **One step-4 test was vacuous, and the plan's mutation exposed it.**
  The "other tool carrying a `subagent_type`" test passed without ever reaching the name check, because the cheap `"subagent"` text pre-filter dropped the line first.
  The probe now carries that token, and deleting the name check turns it red.
  The pre-filter is an optimization that sits in front of every guard it can shadow.
- **Measured numbers against the plan's predictions:**
  - `always-loaded.mjs` gained `agentDescriptions=70`, total 2,517, exactly as predicted.
  - The `AGENTS.md` pointer edit added +5, for a total of 2,522.
  - `invocation-volume.mjs` over 2026-08-29..2026-09-29 gave `templates=1364619 agents=480017 total=1844636`.
    Each count is within 1 of the throwaway scan, which had no `until` bound and so also counted today.
  - Body word counts exclude frontmatter: `plan-issue.md` is 6,272, against `wc -w`'s 6,292.
- **Small deviations:**
  - The `--total` line also prints `since=`/`until=`, so the recorded number carries its window.
  - The template tells Step 6 to re-derive `D`/`UNTIL` from the directory name and `invocation-volume-before.txt`, because each `bash` call is a fresh shell.
  - The cross-reference grep is narrowed to `.pi/prompts .pi/agents .pi/skills AGENTS.md`, because a dry-run over `.pi` walked `.pi/npm/node_modules`.
  - The `(Refs #937)` suffix in Step 6 item 4 was kept rather than pruned, so the audit judges it instead of this step.
- **The permission gate read a commit-body paragraph as a path.**
  The `-m` paragraph began with `/audit-agent-docs`, which the `external_directory` rule matched.
  The message was committed with `-F` from a file written by `Write` into `.git/`.
- The reviewer noted that `grep -h '^# ' .pi/prompts/*.md` now returns 15 lines, not the plan's 14.
  The new template's own fenced inventory example adds a second H1-shaped line.
  First-occurrence matching and the Step 6 before/after diff are unaffected.
- **Next step:** a fresh session runs `/audit-agent-docs workflow`, and after its two commits land, `/ship 935`.

## Stage: Final Retrospective (2026-09-29T05:42:23Z)

### Session summary

Four sessions shipped #935.
This one planned, implemented steps 1–8 (eight commits, +20 script tests) and shipped; a fresh session ran `/audit-agent-docs workflow` as step 9 (`ad166056`, `731f9fd1`).
The audit cut invocation volume 1,737,783 → 1,660,076 words (−4.5%) with 142 `compress` and 30 `delete` rows and no `offload`; `/ship` closed the issue with no release, since nothing under `packages/` changed.

### Observations

#### What went well

- **Measuring the premise changed the design.**
  The issue assumed invocation-time cost lowered the bar for templates.
  A 0.8 s throwaway transcript scan showed templates and agents cost about 3.5× the post-#937 `AGENTS.md`, so the operator declined a per-class cost clause on evidence rather than argument.
  The same scan became `invocation-volume.mjs`, whose counts landed within 1 of the throwaway's.
- **The fresh-session split held.**
  Issue #934's TDD retro recorded a summary that pointed at `/ship` with the prune unstarted.
  This time the plan, the TDD summary, and the stage note all named the fresh-session audit as the next step, and it ran before `/ship`.
- **The template's structural guards worked on first use.**
  The audit session ran the H1 diff, the loaded-skills `comm`, and the step cross-reference grep; all passed after 172 applied rows, and 8 whole-step candidates were parked as `keep (revisit)` instead of renumbering prose.

#### What caused friction (agent side)

- `wrong-abstraction` — the plan's per-class reading of admission question 2 for templates ("fires at this template's step and no skill the template loads already owns it") makes the `offload` branch unreachable: every planning rule fires at the step that uses it.
  The audit's own `## Assessment` caught it ("disconnected for templates, not satisfied").
  Impact: zero `offload` rows; four passages stayed in templates for want of a route, among them the retro-append rule repeated in five templates and `plan-issue.md`'s 20 "When …" rules.
- `instruction-violation` (self-identified) — the parallel `cp`-then-`Edit` race in TDD step 3, the second issue running.
  Impact: one restore by hand.
- `instruction-violation` (self-identified) — wrote `\u2014` escapes in an `Edit` `oldText` for the TDD stage note, against the addendum's literal-character rule.
  It recurred in this retro's own append, where `unicode-escapes.mjs --fix` repaired it.
  Impact: one rejected edit, one repair.
- `instruction-violation` (self-identified) — in `/ship`, ran `"$PLAN"^..HEAD` in a fresh shell after `PLAN` was set in an earlier call; the template warns about exactly this in step 10.
  Impact: one failed call.
- `other` — the audit session set its name to `Agent-doc audit — 2026-07-23` from memory, in the same batch as the `date -u` that would have supplied it; corrected on the next turn.
  Impact: one rename.
- `other` — the audit gate stated 7 `keep (revisit)` rows; there were 8. #934's audit authored its summary table from estimates the same way.
  Impact: a correction in the final report; the gate decision did not depend on it.
- `other` — a commit body paragraph starting with `/audit-agent-docs` tripped the `external_directory` permission rule as a path.
  Impact: one blocked commit, rewritten with `-F`.

#### What caused friction (user side)

- None of note; every gate was answered with the recommended option, and the design gate's substance (measured volume) did the persuading.

### Diagnostic details

- **Model-performance correlation** — planning, TDD, and retro ran on `anthropic/claude-opus-5-5`; `/ship`'s mechanical checklist on `anthropic/claude-sonnet-5`; the audit's judgment-heavy classification on `anthropic/claude-opus-5-5` (pinned in the template).
  The `tidy-first-assessor` and `pre-completion-reviewer` ran on `sonnet-5` and both returned correct, verifiable reports (one line-number slip from the assessor).
  No mismatch.
- **Feedback-loop gap analysis** — each TDD step ran its file, a mutation, `biome`/`eslint`, and `fallow dead-code` before committing; root lint ran after the template edit.
  No gap.

### Changes made

1. `.pi/prompts/audit-agent-docs.md` — the by-class table's template reading of question 2 now passes only a procedure step unique to the template; a rule whose trigger a skill's description names fails even when the skill does not yet say it, so the `offload` branch is reachable and the next `workflow` audit can route the four stranded passages.
2. `.pi/prompts/audit-agent-docs.md` — Step 4 takes every count in the gate message from a `grep -c` over the inventory, after the second audit in two to state a count that was not measured.
