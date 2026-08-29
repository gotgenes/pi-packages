---
description: Form a cause hypothesis from the architecture doc, corroborate with fallow, and propose the next improvement phase
---

# Plan the next improvement round

Package: `$1`

Your job is to analyze the package, identify structural improvements, and propose a numbered phase plan.
Do **not** start implementation — only produce the analysis and plan.

## Sync with remote (do this first)

1. Run `git pull --ff-only`.
2. If it fails for **any** reason — uncommitted changes, divergent history, merge conflict, network error, detached HEAD — stop immediately and report the failure to the user.
   Do not attempt to stash, rebase, force, or otherwise resolve.
3. Only proceed once the pull reports a clean fast-forward (or `Already up to date.`).

## Load skills

Load these skills before starting analysis:

- `improvement-discovery` — heuristics, smell taxonomy, prioritization framework.
- `fallow` — how to run and interpret fallow output.
- `package-<PKG>` — package-specific context (replace `<PKG>` with `$1`).
- `code-design` — design principles and structural heuristics.
- `markdown-conventions` — for the output document.

## Analysis (follow the improvement-discovery workflow)

### Step 1: Read the architecture document and form a cause hypothesis

Start from first principles, before running any tool — fallow finds symptoms by construction (it is syntactic), so leading with it frames the whole analysis around symptoms.

Read `packages/$1/docs/architecture/architecture.md`.
Note:

- Current health metrics table
- Dependency bag inventory — which are marked done vs. open
- Complexity hotspots
- Churn hotspots

Determine the next phase number N (last completed phase + 1), then immediately call `set_session_name` with `$1 — Phase N Planning` so the session is labelled for the rest of the work.

**Hard gate — the previous phase must be archived first.**
If Phase N−1's full detailed roadmap (numbered steps with `Outcome:` lines and a dependency diagram) is still inline in `architecture.md` rather than archived to a `history/phase-(N−1)-<slug>.md` file with only a "Refactoring history" table row left behind, stop and tell the user to run `/finish-phase $1` first, then resume `/plan-improvements $1`.
Archiving the prior phase — with its step-completion gate and doc reconciliation — is `/finish-phase`'s job; do not do it inline here.

A declared direction for Phase N most often lives **not** in `architecture.md` but in the previous phase's history file — `history/phase-(N−1)-<slug>.md`, whose **Findings** section is where `/finish-phase` records the "leading Phase N candidate."
Read that history file's Findings before deep-tracing.
If it (or `architecture.md`) already declares a direction, treat it as a hypothesis, not a commitment — but put the declared candidate in front of the user in your **first** `ask_user`, up front, not a follow-up: a declared candidate surfaced late forces a second round-trip after the composition is already drafted.
When no explicit candidate line exists, the history file still carries **implicit candidates**: a ⚠️ metric miss recorded in its health-metrics table, and any "deferred" remark inside a step's Landed notes — treat both as declared-candidate carriers with the same first-`ask_user` treatment.
Every ⚠️ metric miss in the prior history file gets an explicit disposition in the new roadmap — re-target it, accept it with recorded rationale, or supersede it — never a silent drop (Phase 21 planning silently dropped one; this rule closes that gap).
A phase triggered mid-lifecycle carries its candidate in a **third** location: when an operator decides during an issue's planning that a phase should open before that issue's implementation, the session records the candidate cause under a `#### Phase handoff` heading in the issue retro.
Sweep for it — `grep -rn -e '#### Phase handoff' -e 'phase opens before implementation' packages/$1/docs/retro/` (the second pattern catches pre-convention notes) — and give any hit the same first-`ask_user` treatment (Phase 22's declared candidate lived only in an issue retro's ad-hoc sequencing note and surfaced by luck).
Let the discovery findings decide.

Before touching any tool, write down a **cause hypothesis**: the first-principles structural problem you expect the next phase to dissolve (structural fusion, a coupling/boundary flaw, a dead subsystem), read against the architecture doc's first-principles section.
The later steps corroborate, refine, or refute it — they do not replace it.
When discovery refutes the hypothesis because the doc prose that spawned it is stale — it describes a state a completed phase already changed — fix or flag that prose in the roadmap commit, mirroring Step 2's drift rule; leaving it plants the same wrong hypothesis for the next planner (Phase 22's initial hypothesis came from a first-principles sentence Phase 18 had already resolved).
A cause-level finding must trace to a named target concept in the architecture doc's first-principles section; when no such section exists, writing one — naming the organizing concept and recording resolved design directions — is itself a phase deliverable.

### Step 2: Sweep open issues

Reconcile the tracker against the architecture doc — doc/tracker drift otherwise causes re-planning filed work or missing a parked candidate.

```bash
gh issue list --label "pkg:$1" --state open
```

Cross-check each open issue against the architecture doc's claims about which issues remain open, and note any that are parked candidates for this phase or already-filed work you must not re-plan.
An open issue that already names a cause-level finding is a **pre-discovered candidate** — adopt it as a phase step under its existing number rather than re-deriving or re-filing it (Phase 21's two strongest steps were adopted this way).
Read each labeled issue's body before counting it in scope: a package label is sometimes contextual (the body targets another package), and a mislabeled issue must not pull cross-package work into the phase.
When the sweep exposes doc/tracker drift in prose outside the roadmap sections (e.g. a stale "remaining open issues" claim), fix it in the roadmap commit rather than leaving it for the next reader.
Sweep open pull requests too: `gh pr list --state open`, reading any whose title or changed files touch `packages/$1/` — this repo reimplements adopted external PRs rather than merging them, so an open PR is a pre-discovered candidate or a step's close target, never noise (three Phase 22 steps cite open PRs that surfaced only because issue bodies happened to mention them).
Record each relevant PR's disposition alongside the issue it serves.
Track repeat deferrals: an issue swept as out-of-scope across multiple consecutive phases (check the prior phase retros/roadmaps) gets an explicit decision this phase — schedule it, or recommend closing it as not-planned — never a silent re-defer.
State the ordinal in the disposition itself — each deferral bullet carries its consecutive-sweep count (`2nd consecutive sweep`) so the next phase reads the count instead of re-deriving it from prior archives.
Surface each repeat-deferral as an explicit `ask_user` decision (schedule / defer-with-recorded-rationale / close as not-planned), not a self-made call — these are preference-sensitive judgments the user should own; bundle them into the Step 8 composition `ask_user`, not separate round-trips.
Record the sweep's verdicts under the `#### Open-issue sweep dispositions` heading the Output section prescribes — mid-phase filing sites and `/finish-phase` both append to and grep that exact heading.

Sweep recorded deferred tidyings too: `grep -r -A 5 '#### Deferred tidyings' packages/$1/docs/retro/`.
Each is a finding a `tidy-first-assessor` judged real but out of scope for the change it was dispatched over — triage like any other candidate, or say why it stays deferred (Refs #787).

### Step 3: Run fallow for corroboration and baseline

Fallow **corroborates** the cause hypothesis and supplies outcome baselines (LOC, complexity, dead code, duplication) — it does not set the agenda.
Run the full suite from the repo root (the exact commands and interpretation live in the `fallow` and `improvement-discovery` skills you loaded); record the health score, dead-code findings, production/test duplication, hotspots, and refactoring targets.
Also run the repeated-discriminator sweep from the `improvement-discovery` skill (the `grep … | uniq -c` one-liner in its Step 3) — fallow is blind to that smell class, so the sweep is the only detector.

**The phase spine must not be fallow-sourced-only.**
At least the primary cause must trace to the principle-driven reading of Step 1, not to a syntactic fallow finding — cite fallow signals as symptoms of that cause, not as the motivation for a step.

### Step 4: Trace from entry point outward

Read `packages/$1/src/index.ts` and trace its dependency graph:

- For each import, read the target module
- Note size, exports, fan-out, code smells
- Pay special attention to: `as any` casts, adapter closure density, forward references, wide parameter lists, mixed responsibilities, anemic domain objects (data classes that a manager reaches into instead of telling), repeated discriminators (the same comparison re-evaluated across modules instead of decided once at a boundary)

Scale the trace to the package's maturity: on a package with an extensive phase history, an exhaustive per-import read mostly re-derives what the architecture doc already records.
Trace selectively instead — the hypothesis's target files, the churn hotspots, and any file the issue sweep implicates — and spot-verify the doc's claims rather than re-reading every module.

### Step 5: Read the tests as evidence of constructibility — and dispatch the craftsmanship scout

`fallow`'s metrics miss god objects, closure density, and DIP violations.
Module-level `vi.mock`, wide `as unknown as` casts, and multi-field fixtures (a `makeX` stubbing 10+ methods, or one mock passed to a constructor several times) mean the production object is hard to construct — a production smell, not a test-tree problem.
Do not accept the architecture doc's self-justification for a smell at face value; verify the claim against the code and tests.
When the analysis touches handler wiring or shared interfaces, load the `design-review` skill before writing the plan.

**Do not grade the tests by `grep`.**
Counting `as unknown as` / `vi.mock` occurrences is not reading them — a documented failure mode of this prompt (an 880-line test body reads as "low cast count" and sails through).
The micro lens (test-design quality as a first-class artifact — Category G — plus method-level SOLID, naming, stepdown, and comment quality) is expensive in context, so dispatch it to a subagent:

- Dispatch the `craftsmanship-scout` subagent via the `subagent` tool: `subagent_type: "craftsmanship-scout"`, `description: "Craftsmanship scout for <PKG>"`, and a `prompt` naming the package, the largest test files (from the `fallow health` large-functions list; when that list is empty — common on a mature package — fall back to the largest test files by `wc -l`), and the churn hotspots.
- Hand it the fallow large-function flags for test files and ask it to **adjudicate each one** — fallow counts a whole top-level `describe` callback as one function, so a flagged "giant test" may be a healthy nested tree of small behavior-named tests.
  A refuted flag is as valuable as found debt: it prevents a phase step manufactured from a false positive.
- It **opens** the largest test files (not greps) and returns a **scored debt inventory**, flagging each cluster **concentrated** (a hot area worth a step) vs. **scattered** (defer).
  Fold that inventory into your findings; its concentrated/scattered split drives the Step 8 deferral gate.
- The scout is read-only and its context stays in the subagent — your context stays clear for the plan.

### Step 6: Assess file and directory organization against the domain

**Skip this step when domain subdirectories already exist and the `src/` root file count is small** (fewer than 10 top-level files): the deep directory-organization analysis is a scripted no-op on a package that has already been grouped into domains.
**Also skip the deep analysis when domain subdirectories exist and the architecture doc already records a forward-looking directory sketch or reorg convention** (e.g. "grow domain directories in phases that rewrite those files"): re-deriving the convention each phase is a repeated no-op — just check this phase's target files against the recorded sketch and note the result.
Run `ls packages/$1/src | grep -c '\.ts$'` to check the root file count and note the skip.

Otherwise, run `ls packages/$1/src` and look at the shape of the tree, not just the contents of files.
A flat `src/` with many top-level modules (20+) is a Category E smell ("Flat directory" in the `improvement-discovery` taxonomy): navigation degrades, and the absence of grouping hides which files form a cohesive feature or domain concept.
Watch for a module that will not sit still in any obvious group — that usually means the organizing concept has not been named yet, and the reorg should wait on (or motivate) the work that names it.

When a regrouping opportunity exists, prefer to **introduce or grow a domain directory in a phase that is already rewriting or extracting those files** (tidy-first), so the touched modules reach their final home the first time instead of being moved twice.
Do **not** propose a big-bang move of the whole tree — it is unreviewable and collides with every in-flight branch.
The `#src/*` / `#test/*` import aliases keep moves mechanical (a move rewrites only the importing `#src/<file>` sites, with no `../../` fragility, and `tsc` + eslint catch every miss).
A domain directory may expose a lean `index.ts` barrel as its cross-domain API, but only at genuine seams — this repo treats barrel re-export sprawl as a smell and fallow flags any export with no importer.

Reorg scope is preference-sensitive (churn vs. coherence), so when the opportunity is larger than the files the phase already touches, use `ask_user` to decide how much to fold in.
When the full reorg exceeds the current phase, record a **forward-looking directory sketch** (the target domain directories + these principles) in the architecture doc and seed only the first domain now — see the pi-permission-system Phase 6 "Directory organization" section for the pattern.

### Step 7: Apply the smell taxonomy

For each finding, classify it using the taxonomy from the `improvement-discovery` skill (Category A–G).
Score each on Impact (1–5) and Risk (1–5).
Compute Priority = Impact × (6 − Risk).

### Step 8: Propose the phase plan

Group findings into issue-sized steps.
Nine steps is a **ceiling, not a target** — a phase may have one step, or none.
Identify dependency ordering and parallel tracks.

**Deferral gate.**
If discovery surfaced no cause-level finding (Category A–C — structural fusion, coupling/boundary flaws, dead subsystems) and the candidate list is polish-only (Category B unit-size, Category D, Category E, Category G symptoms), do not manufacture a full phase — but split the "polish" verdict before defaulting to defer, using the craftsmanship scout's concentrated/scattered flags:

- **Scattered trivia** (isolated findings across cold, low-churn files) → present **"defer"** as a first-class `ask_user` option.
  This work belongs to the boy-scout rule in `/plan-issue`'s Tidy-First assessment (the `tidy-first` skill), which picks it up whenever a change touches those files, not a planned phase.
- **Concentrated quality/test debt in a hot area** (3+ scout findings clustered in one churn hotspot or one oversized test file) → present a **"craftsmanship lean phase"** (spine: "pay down concentrated debt in `<area>`") as a first-class `ask_user` option alongside defer.
  This is legitimate Beck/Metz craftsmanship, not filler.

This is deliberately **not** a numeric threshold — the priority score ranks findings _within_ a phase, it does not decide _whether_ a phase exists.
The honest framing ("discovery yielded only scattered polish" vs. "concentrated debt in a hot file") is the point; do not manufacture a full phase to fill the ceiling, and do not dismiss concentrated craftsmanship debt as unworthy of one.
When the architecture doc's declared target is complete _and_ the scout finds only scattered trivia, the fired gate is the improvement process reaching its intended terminal state — report it as success, not as a failure to find work; the next phase's trigger is a new cause (including concentrated craftsmanship debt), not the calendar.

A bug whose fix is structural (a boundary flaw with user-visible behavior, adopted from the tracker or found in discovery) is a legitimate phase step — even the spine.
Note the commit type on such a step: a `fix:` (or unhidden `docs:`) step is the phase's release vehicle, while `refactor:`/`test:` steps are hidden changelog types — derive the `Release batches` framing from that mix rather than assuming a refactor-only phase.

**Trajectory check.**
Compare this phase's maximum priority score against the prior one or two phases (their history files record the scores).
When the maximum declines across consecutive phases and the churn hotspots are cooling, state the trend in the roadmap summary and put the cadence question to the user: keep the regular improvement rotation, or move the package to trigger-driven planning (a new bug cluster, a feature's structural needs, concentrated debt).
The deferral gate decides whether _this_ phase exists; the trajectory decides whether the _rotation_ continues.

**Track composition.**
When the surviving candidates span multiple independent tracks (a spine plus unrelated parallel work), offer the composition to the user via `ask_user` (a multi-select over the tracks) rather than committing to a fixed set — track selection is preference-sensitive (scope vs. focus), and the user may want to drop or add a track before you draft the steps.
Bundle the first `ask_user`: the declared candidate, the track composition, the repeat-deferral dispositions, and (when the trajectory check fires) the cadence question belong in one call — one round-trip, not four.

**Feasibility probe.**
Before committing any step whose outcome claim depends on the SDK/type surface (e.g. "remove the file-level `eslint-disable` once the SDK exports usable types"), confirm the named type or export actually exists in the real surface (SDK `.d.ts`, `--help`, schema).
Do not commit an outcome the surface cannot deliver — this mirrors the AGENTS.md rule that a named remediation in a migration note must be verified against the real surface.
For an SDK **UI or behavioral** capability (not just "does this method exist"), confirm the behavior in the Pi core source (`~/development/pi/pi`) and a sibling extension that already uses it, not only the exported type — a `.d.ts` says a method exists but not that it behaves the way the step needs (e.g. `ctx.ui.custom` renders inline by default only per the core's `overlay ?? false`, invisible in the type signature).

## Output

Write the proposed plan as a new `## Improvement roadmap — Phase N: <title>` section in `packages/$1/docs/architecture/architecture.md`, inserted **immediately above the `## Refactoring history` section**.
`/finish-phase` archives prior phases to `history/` and leaves only their "Refactoring history" table rows — there is no completed-phase summary chain to sit above, so the active roadmap you are writing is the only `## Improvement roadmap` section in the doc while it is in progress.

The section should include:

1. A summary of findings (updated health metrics table), under a `### Findings (planned YYYY-MM-DD)` heading whose date is the phase-window start `/finish-phase` reconciles against.
   The Step 2 sweep's verdicts go in that section under a `#### Open-issue sweep dispositions` heading — that exact spelling, never a bold prose lead-in or a per-phase variant, because the `roadmap-fit` skill appends to it mid-phase and `/finish-phase` greps it at close.
   Prefer cause-level metrics recomputable by a single command (a `grep -c`, `wc -l`, or fallow field) and record the recompute command with the metric, so `/finish-phase` can verify delivered vs. predicted deterministically.
   When a metric greps for a symbol or filename the phase has not created yet (a predicted name), the step whose work creates it must either use the roadmap's name or update the metric row in the same commit — note this on that step, or a rename silently breaks `/finish-phase`'s recompute.
   Run each recompute command before committing and confirm it reproduces the stated baseline — a wrong command silently breaks `/finish-phase`'s delivered-vs-predicted verification.
   A command containing `|` cannot sit in a table cell verbatim: the cell requires `\|`, so the raw source — what `/finish-phase` copies and runs — carries a corrupted command.
   Prefer pipe-free forms (`grep -c`, multiple `-e` patterns, a single-path `grep -rc`); when a pipeline is unavoidable, put the command in a fenced block below the table and point the row at it.
2. Numbered steps with:
   - Title
   - **Cause** — the first-principles structural cause the step dissolves, named explicitly; a fallow signal is cited as the _symptom_ of that cause, never as the step's motivation (a step justified only by a fallow finding is symptom-driven — trace it to a cause or drop it).
   - Target files/functions — when a step extracts or moves code and a domain directory applies (Step 6), name the destination path (e.g. `src/<domain>/<file>.ts`) so directory placement rides along with the change rather than landing flat and being moved later.
   - Smell category addressed
   - Expected measurable outcome
   - **Impact / Risk / Priority** — the per-step scores (`Priority = Impact × (6 − Risk)`), published on the step so the ranking is auditable in the committed roadmap and at `/plan-issue` time, not left in the session transcript.
   - A `Release:` tag on its own line — `Release: independent` or `Release: batch "<batch-name>"` (see the `improvement-discovery` skill's Output format).
3. Step dependency diagram (Mermaid flowchart).
4. Named parallel tracks.
5. A `Release batches` subsection (after the parallel tracks) naming each batch, its member steps in dependency order (last listed = tail), and the independently releasable steps.
   This is the deterministic source `/plan-issue` reads to recommend a release decision — keep it grep-able, not prose.

After writing the plan, present a summary to the user and ask whether to commit.
If confirmed, commit with:

```bash
git add packages/$1/docs/architecture/architecture.md
git commit -m "docs($1): propose Phase N improvement roadmap"
git push
```

## File the issues

The roadmap is not done until each step has a GitHub issue and the document links back to it.
When **every** step adopts an existing issue, there is nothing to file: add the heading/diagram link-backs and reference definitions **before** the roadmap commit, skip the filing ask, and go straight to the working sequence — one commit, no second round-trip (Phase 22 shipped this way).
Otherwise, after the plan is committed, ask whether to file the issues now; if confirmed:

1. Steps adopted from already-filed issues need no new issue — skip creation and link the existing number; file only the steps without one.
   Load the `github-voice` skill, then file the issues **one `gh issue create --label "enhancement,pkg:$1"` call per issue**, with the title and `--body-file` paired literally in the same command — never via shell-array index arithmetic (the shell is zsh; its 1-indexed arrays silently shift titles relative to bodies).
   A `bug`-typed step keeps the `bug` label instead of `enhancement`.
   Run `gh` from the repo root (it must execute inside the repository).
   Use the repo's `## What` / `## Why` / `## Proposed change` / `## Context` sections, referencing cross-step dependencies as "Phase N Step M" prose, not hardcoded numbers (the issue numbers are not known until filed).
2. Verify each created issue's title matches its body before continuing.
3. Link the doc back: append `([#N])` to each step heading, add `(#N)` to each Mermaid node, and add reference-link definitions at the end of the file.
   Then verify every `[#N]` reference in the file resolves to a matching `[#N]:` definition — `rumdl`'s MD053 flags _unused_ definitions but not _missing_ ones, so a dangling reference inherited from a prior phase's summary passes lint silently; add any missing definitions while you are in the file.
4. Commit with `docs($1): link Phase N roadmap steps to issues #A-#B` and push.

Finally, restate the recommended working sequence: list the issues as `#N — title` lines in dependency order (a topological order of the step diagram), noting which can proceed in parallel and which are blocked until an earlier one lands.

## Write planning notes

Before stopping, persist planning observations for cross-session continuity — `/plan-improvements` is phase-scoped, not issue-scoped, so it uses a **phase retro** file rather than the issue-keyed `NNNN-<slug>.md` convention.

1. Write `packages/$1/docs/retro/phase-N-<slug>.md` (create `packages/$1/docs/retro/` if needed), using the phase number N and slug from Step 1.
   Derive the slug from the phase title so `/finish-phase` reuses it for `history/phase-N-<slug>.md` — the two files should share a slug and stay greppable as a pair.
   This is distinct from the `history/phase-N-<slug>.md` archive `/finish-phase` owns — do not touch that.
2. If the file does not exist, create it with this frontmatter (a phase-scoped variant — `package`/`phase` keys, not the issue-keyed schema):

   ```markdown
   ---
   package: $1
   phase: N
   ---

   # Retro: $1 — Phase N Planning (<slug>)
   ```

3. Append a stage entry:

   ```markdown
   ## Stage: Improvement Planning (<ISO 8601 timestamp>)

   ### Session summary

   2–3 sentences: the cause hypothesis (Step 1) and the phase shape chosen (full / lean / deferred).

   ### Observations

   The cause the phase dissolves, alternatives or deferrals considered, the deferral-gate outcome, and any feasibility-probe results that reshaped a step.
   ```

4. Commit with `docs($1): add Phase N planning retro notes` and push.

Wrap code identifiers, filenames, and underscore-bearing text in backticks.
Append with the `Edit`/`Write` tools, not a shell heredoc.
Then stop.
