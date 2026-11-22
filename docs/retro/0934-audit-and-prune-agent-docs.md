---
issue: 934
issue_title: "Audit and prune the agent documentation, then make the pass periodic"
---

# Retro: #934 — Audit and prune the agent documentation, then make the pass periodic

## Stage: Planning (2026-09-17T01:43:31Z)

### Session summary

This session filed the issue from a measurement pass, committed the evidence and two `.mjs` derivations (8c9bb3c6), then planned the work.
The plan lands the admission test in `AGENTS.md`, gates `/retro` Step 7 on it, makes the scripts testable in the `roadmap-check.mjs` shape, adds a third script for the always-loaded count, and adds `/audit-agent-docs` — which is run once in a fresh session as the plan's final, non-implementing step.
Filed [#935] for the prompt-template and subagent-definition pass the operator scoped out.

### Observations

- **The growth pump is `/retro`, not ad-hoc edits.**
  44 of the last 60 commits to `AGENTS.md` are `docs(retro):`.
  Its Step 7 governs an addition's shape (rule + tight example) but never its admission, which is why a prune without a `/retro` edit re-grows at the measured +635 words/wk.
  The issue did not name this; the plan's step 8 is the mitigation.
- **The admission test rests on a cost boundary, not a taste boundary.**
  Skill descriptions are always loaded (454 words); skill bodies are not (34,608).
  "Needed before the agent could know to load a skill" is a mechanical test, and it is the one the plan writes.
- **A new prompt template cannot run in the session that creates it** (the `#869` staleness rule applies to new commands as well as renamed ones).
  That resolved the sequencing question of where the first prune runs: the implementing session stops at the committed command, and the audit is a separate session.
  The plan says so explicitly so `/build-plan` does not try to invoke it.
- **Model usage is measurable from the transcripts; thinking level was the operator's dimension.**
  The first stage-attribution pass took the last `session_info` name per file and inflated `Retrospective` roughly fivefold.
  Ordered attribution fixed it and became the discriminating test in the plan (step 5's killing mutation is exactly that bug).
- **The `agents_md` bucket over-reads the always-loaded number by ~400 words** — nine sentinel `packages/*/AGENTS.md` files that fire only from a package subdirectory.
  Correct for the pre-consolidation series, wrong as an always-loaded figure; that is why `always-loaded.mjs` is a separate script rather than a column.
- **Two counting methods disagreed (8,760 vs 9,037) and the disagreement was the sentinel finding.**
  Worth chasing a 3% discrepancy in a baseline before it goes into a plan.
- Operator decisions at the gate: no numeric budget this round; the command applies `delete`/`compress` **in place on the current branch** (not a review branch); the recurrence-since-Opus-5 heuristic is guidance with survivorship bias named, not a rule; the plan carries through applying the reviewed inventory.
- **A "predicted unchanged" claim needs the right probe.**
  `grep '^/' README.md` found nothing and the plan said "lists slash commands nowhere"; a mid-line grep found nine.
  The prediction held (README's table is lifecycle-only, and `/triage-backlog` is absent by the same convention) but the stated reason was wrong and was corrected before commit.

#### Deferred tidyings

- `scripts/agent-docs/model-usage.mjs` — `DEFAULT_PREFIX` hardcodes this checkout's session-store directory name.
  `transcriptPaths` already takes `prefix`, so it is not a testability blocker; making the default portable is a separate decision.

## Stage: Implementation — TDD (2026-09-17T14:36:26Z)

### Session summary

Nine of the plan's ten steps landed in nine commits plus one baseline fix: three preparatory refactors, three test commits (41 new tests, 7,049 → 7,090), the `always-loaded.mjs` script, the admission test in `AGENTS.md` (138 words), the `/retro` Step 7 gate, and the `/audit-agent-docs` template.
Step 10 — the first audit — runs in a fresh session by design, since a new template is not registered in the session that creates it.
Pre-completion reviewer: PASS.

### Observations

- **The baseline was red on this issue's own evidence commit.**
  `fallow dead-code` reported both `scripts/agent-docs/*.mjs` unreachable, and CI had failed on the 8c9bb3c6 push.
  `roadmap-check.mjs` passed only because its test imports it.
  Fixed by declaring `scripts/**/*.mjs` as entry points (`build:` d8446477) — a CLI script is an entry by nature, and the gate should not depend on whether a script has a test yet.
- **A parallel `cp`-then-`Edit` block raced.**
  Saving the green file and applying the first mutation in one tool block let the `Edit` land before the `cp`, so `/tmp/green-*.mjs` captured the mutant and the second mutation ran on top of the first.
  Caught because M2's red count included M1's tests.
  Recovered from HEAD (safe there: the step's own uncommitted edit was in the test file, not the script).
  Save the green copy in its own tool call, then mutate.
- **A test-first `Red` on an already-exported module is a bulk red.**
  Steps 2 and 5 went green on first run because steps 1, 3, and 4 had landed the exports; every mutation was therefore mandatory, and every one killed exactly its predicted class.
- **One mutation prediction was host-dependent.**
  `getUTCDay` → `getDay` on `weekOf` kills the Monday pin under PDT and the two Sunday pins under Asia/Tokyo; on a UTC host (CI) the mutant is behaviorally identical to the original.
  The three pins together cover every non-UTC host; recorded in the commit body rather than forcing `TZ` in the test.
- **MD029 reshaped the `/retro` edit.**
  The plan's "question 0" cannot be a list item (ordered lists start at 1) and renumbering would have touched the four existing questions, so the gate is a lead-in paragraph and the diff is insertions only.
- **`AGENTS.md` has no home for a periodic command in its workflow prose.**
  `/triage-backlog` is absent by the same convention; the admission-test subsection introduces `/audit-agent-docs`, and only the session-naming table gained a row.
- Every prescribed shell block in the new template was dry-run against a scratch directory before commit.
- Always-loaded words: 9,214 on the 2026-09-17 tree → 9,364 on HEAD (+141 admission test, +9 table row).
  The first audit's job is to make that number go down.
- **The summary read as "done" when the deliverable was not.**
  The operator's planning answer was "through applying the reviewed inventory", and the summary presented steps 1–9 with `/ship 934` as the next step — which would have closed the issue with the prune unstarted.
  The plan's own step 10 and its acceptance line ("both audit commits on `main`") were right there; the summary should have led with "next: fresh session, `/audit-agent-docs`, then ship", not with `/ship`.
  A stage summary's "next step" must be checked against the plan's acceptance criterion, not against the last step this session could execute.
- **Overcorrected before re-reading the plan.**
  When the operator flagged the gap, the first reaction was to hand-execute the template in this session — measuring, then dispatching two classifier subagents — rather than re-reading step 10, which already said a fresh session runs the command.
  The operator's "was that the plan?" caught it; the classifiers were stopped and the working-tree residue (a refreshed `model-usage.csv`, an `always-loaded-before.txt`) reverted so the fresh session's `git pull --ff-only` would not refuse.
  Hand-executing would also have skipped the one real test of the deliverable: the command running as a command.

[#935]: https://github.com/gotgenes/pi-packages/issues/935

## Stage: Agent-doc audit + Final Retrospective (2026-09-17T21:39:21Z)

### Session summary

Ran the plan's step 10 — the first `/audit-agent-docs` pass — in a fresh session: measured, classified 201 passages across `AGENTS.md` and 17 skills, gated the inventory, applied 19 `delete` and 125 `compress` rows, and landed the two commits (77853353, a98e1872).
Always-loaded words went 9,364 → 8,537 (−8.8%), entirely out of `AGENTS.md`.
The operator's follow-up question about structural remedies produced three issues (#937, #938, #939), and `/ship 934` then closed the issue with no release (nothing under `packages/`).

### Observations

#### What went well

- **The two-commit split made the prune reviewable.**
  Committing the inventory first and the prune second means `git show a98e1872` is checkable line-by-line against a committed record of what was authorized.
  That is the property the plan was after, and it held under a 144-row change.
- **A scripted bulk edit was proven, not trusted.**
  The `(Refs #N)` strip ran as a single-line `perl -pi` across 12 files, then was verified by re-applying the same transform to a backup and diffing: `diff <(sed -E 's/ \(Refs #[0-9]+(, #[0-9]+)*\)//g' before) after` returned nothing, proving the script changed **only** refs.
  `AGENTS.md` warns that a scripted substitution's correctness rests on the suite; for prose there is no suite, and this is the substitute.
  Recorded here rather than added to `AGENTS.md` — it was done unprompted, so it fails the admission test's first question.
- **The recurrence heuristic earned its "guidance, not verdict" framing.**
  Three rules looked like clean question-1 deletes (`rg -r`, glob quoting, `| wc -c`); all three had recurred in retros **with the rule in loaded context** (0914, 0640/0806/0883, 0927).
  Checking before cutting is what kept them, and it is what turned into #938.
- **The audit found a defect in its own test.**
  108 of 109 `AGENTS.md` edits removed provenance or an incident sentence; only two rows were `offload`.
  The admission test's second question barely fired — not because the rules belong up front, but because no destination skill exists.

#### What caused friction (agent side)

- `instruction-violation` (self-identified, from the error) — wrote `files="a b c"; for s in $files` in a `bash` call; zsh does not word-split an unquoted parameter, so `cp` received the whole list as one filename.
  `AGENTS.md` § Shell and search states exactly this rule, and it was in loaded context.
  Impact: one failed tool call, fixed on the next by spelling the list inline.
  No rework.
- `instruction-violation` (self-identified) — built an `Edit` `oldText` for `inventory.md` from the table layout just written, which `pi-autoformat` had re-padded; the edit was rejected.
  Also a rule in loaded context ("re-read a region you just edited before matching against it again").
  Impact: one rejected edit, one `grep` to recover the real layout.
- `other` — wrote the inventory's summary table from estimated counts (153/25/2/108/18) before counting the rows; a count script produced the real numbers (120/8/2/92/17) and the table was corrected before the gate.
  Impact: one extra edit.
  Same family as "never write a timestamp from memory" — a number that a command can produce should not be authored.
- `other` — compressing the `[#296]` sentence out of the `pi-permission-system` skill orphaned its `[#296]:` link definition; root `rumdl` caught it as MD053 after the cache clear.
  Impact: one fix before commit.
  The template's "clear the cache, lint from the root" step is what caught it, so the mechanism worked as designed.

#### What caused friction (user side)

- The session's highest-leverage moment was the operator's question after the audit reported — "were we aggressive enough / what can we do structurally?" — which produced #937, #938, and #939.
  The template's own `Finally` step asks for numbers and open `offload` rows, not for an assessment of the test that produced them.
  Opportunity: make that assessment a template output rather than something that depends on the operator asking.

### Diagnostic details

- **Model-performance correlation** — no subagents were dispatched this session, which is correct: the classification needs the whole corpus in one context, and the TDD stage's recorded overcorrection was precisely an attempt to dispatch classifier subagents.
  Stage attribution from the inline transcript labels: the audit, the structural design discussion, and the issue filing ran on `anthropic/claude-fable-5-1`; `/ship`'s 13 mechanical steps ran on `anthropic/claude-sonnet-5` with no deviation; this retrospective on `anthropic/claude-opus-5`.
  No mismatch — the judgment-heavy pass got the strongest model and the deterministic checklist got a cheaper one.
- **Escalation-delay tracking** — no `rabbit-hole` friction points; the longest run on a single error was one tool call (the zsh word-split).
- **Feedback-loop gap analysis** — `rumdl` ran on the inventory before the gate, root `pnpm run lint` after the apply phase, and the per-row verification greps after that; `/ship` re-ran `lint` and `fallow dead-code` at the root.
  One ordering note: `/audit-agent-docs` pushes its own commits at its step 6, so `/ship`'s step 5 "pre-push checks" necessarily ran on already-pushed code.
  Harmless here (both gates green, CI green), but for an audit run `/ship` is close-and-report, not a gate.
- **Tooling cost of the model lens** — attributing early-session turns took three `read_session` calls at increasing limits, because the tool takes only `limit` (most-recent-N) with no offset, and each call re-rendered the full `/ship` and `/retro` template bodies.
  A `before`/`offset` parameter, or a mode that elides user-message bodies, would make this lens cheap; `pi-session-tools` is this repo's own package.

### Changes made

1. `.pi/prompts/audit-agent-docs.md` — the inventory skeleton gains an `## Assessment` section, Step 6 gains item 4 requiring it to be written (which verdict dominated, which admission question fired and which never did, what was kept only for want of a destination), and `Finally` reports it.
   A question that never fires is disconnected, not satisfied — that is the finding this session produced only because the operator asked for it.
2. `docs/agent-docs-audit/2026-09-17/inventory.md` — added the `## Assessment` the amended template now requires, so the first audit conforms to it retroactively.
3. Filed #940 against `pkg:pi-session-tools` — `read_session` takes only `limit`, so attributing early turns in a long multi-stage session re-renders the whole tail, including full prompt-template bodies.
   `roadmap-fit` exited at Step 1: the package has no open improvement phase.
4. No `AGENTS.md` change.
   All four friction points map to rules already stated there; adding emphasis is what retro 0927 declined, and #938 is the agreed mechanical fix.
