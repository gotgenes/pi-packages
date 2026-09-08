---
issue: 894
issue_title: "Derive the improvement-roadmap working sequence from each step's priority and dependencies"
---

# Validate the improvement roadmap's published inputs, rather than deriving its sequence

## Release Recommendation

**Release:** ship independently

This is repo-root tooling — `scripts/`, a root `test/` directory, root `package.json`, `.github/workflows/ci.yml`, and `.pi/`.
The one file it touches under `packages/` is `pi-subagents`' `docs/architecture/architecture.md`, which `scripts/release/lib.sh` excludes from release scope by convention, so no package has a releasable commit and nothing will actually release.
The marker is written anyway because `/ship` reads it before any irreversible work, and its absence is itself reported.
The issue belongs to no package improvement roadmap, so there is no batch to join.

## Problem Statement

Every improvement-roadmap step publishes its own `Impact / Risk / Priority` scores and its own ordering constraints, and the working sequence is then maintained by hand.
The issue's premise is that publishing the inputs and hand-maintaining the output leaves the two free to disagree with nothing checking that they agree, and proposes a topological sort over the hard dependencies, tie-broken by `Priority` descending, to close the gap.

Measured against the two live roadmaps (26 steps), the premise splits in two, and the halves point in opposite directions.

The **inputs are not being checked, and they are wrong today.**
`Priority = Impact × (6 − Risk)` fails on two committed pi-subagents steps: [#857] publishes `Impact 2 / Risk 2 / Priority 9` where the formula gives 8, and [#858] publishes `Impact 3 / Risk 4 / Priority 7` where it gives 6.
The `Release batches` subsection lists a batch of two plus fifteen independently releasable steps — 17 of 19 — because [#878] and [#885] were never added to the list, though both step blocks carry `Release: independent`.
The step blocks and the dependency diagram disagree about hard dependencies in both directions.

The **output is not derivable from the published scores.**
pi-permission-system Phase 15 was re-sequenced on 2026-09-07 to land [#802] **first**; its `Priority` is 12, the joint-lowest in the phase.
A priority-descending topological sort puts it fifth counting solid edges only, or third counting dashed ones.
The operator's stated reason — it demotes the layer the other six steps polish — is not encoded in any published field, and no tie-break recovers it.
On pi-subagents Phase 22 the derived order splits every named track apart: Track G's two steps land at positions 2 and 15, Track A's four at 1, 4, 5, and 6, where a curated sequence keeps a track contiguous because switching areas is what costs.

So the ordering call carries judgment the scores do not capture, and the plan drops the derivation.
What ships is the validation half — the part with three demonstrated defects on its first run.

## Goals

- Ship `scripts/roadmap-check.mjs`: a read-only, offline validator for a package's live `## Improvement roadmap` section.
- Check the things that parse strictly: score arithmetic, `Release:` tag presence and shape, batch-name resolution and tail membership, step/diagram correspondence, and acyclicity of the hard-dependency graph.
- Cross-check each `**Hard dependency:**` bullet against the diagram's solid edges, in both directions, with the diagram as the authority.
- Check the prose sections (`Parallel tracks`, `Release batches`) leniently and one-directionally — report a step mentioned in neither, never a step mentioned twice.
- Parse **both** heading shapes, since the two live phases keep their ordinals through their close and are the only real inputs the validator has.
- Give the repo root a `vitest` harness, so a parser is testable over its input domain rather than over the inputs the author could picture.
- Correct the three defects the validator finds in the live roadmaps, so it starts clean.
- Wire it into `/plan-improvements` (after the roadmap write) and `/finish-phase` (before archiving).

This change is not breaking: it ships no package code and alters no published contract.

## Non-Goals

- **Deriving or reporting a working sequence.**
  No topological sort output, no advisory diff against the committed section order, no write-back, and no CI gate on `architecture.md`.
  Operator decision, on the [#802] measurement above.
  Cycle detection remains, because an unorderable graph is a defect regardless of who does the ordering.
- **Rendering or generating the Mermaid diagram.**
  The validator reads it; it never writes it.
- **Cross-checking `**Soft dependency:**` bullets.**
  The two live roadmaps spell a non-hard edge three ways — `-.->`, `-.soft.->`, and `-.informs.->` — and the `improvement-discovery` skill's Output format specifies neither, so all three conform.
  Standardizing the vocabulary and then extending the check is filed as [#902].
- **A strict partition check on tracks and batches** ("every step appears in exactly one track").
  Measured: the leading-run rule that gives a clean partition on Phase 22's tracks breaks on Phase 15's Track D, whose first line has no parenthetical and whose prose tail puts [#881] in a second track.
  Catching double-membership needs the member lists delimited, which is a further format tightening on top of [#893].
  The lenient check keeps the value that fired ([#878]/[#885]) at zero false-positive cost.
- **Converting the two live phases to the `[#N]` heading shape.**
  Unchanged from [#893]'s Non-Goals; it is the premise of the dual-shape parsing here.
- **Reconciling the `**Hard dependency:**` bullets in the live roadmaps with their diagrams.**
  The validator reports all three as warnings; the plan leaves them.
  Two of the three sit on landed (`✅`) steps, where editing the bullet revises the record of what was claimed at planning time, and both phases archive under ordinals regardless.
  This is what the warning severity is for.
- **Adding `shellcheck` or any other gate for the existing `scripts/*.sh`.**
  Noted during the host decision — repo bash scripts are linted by nothing today — but out of scope here.

## Background

### What is published, and how strictly

Measured across both live roadmap sections:

| Datum                  | Shape                                                                   | Coverage                         | Parses strictly         |
| ---------------------- | ----------------------------------------------------------------------- | -------------------------------- | ----------------------- |
| Step heading           | `#### ✅ Step N: Title ([#M])` today, `#### ✅ [#M] Title` after [#893] | 19 + 7                           | yes, within `### Steps` |
| Scores                 | `- **Impact N / Risk N / Priority N.**`                                 | 26 of 26                         | yes                     |
| Release tag            | `Release: independent` / `Release: batch "<name>"`                      | 26 of 26, exactly one each       | yes                     |
| Diagram                | one ```mermaid fence, `S<id>["label"] --> S<id>`                        | 19 + 7 nodes, 14 + 5 edges       | yes                     |
| Hard dependency        | `- **Hard dependency:** <prose>`                                        | 11 of 26 (2 of which say "none") | leading run only        |
| Tracks / batch members | prose bullets with continuation lines                                   | all steps                        | no                      |

### Where the naive parse goes wrong

Four false-positive sources, each measured rather than imagined:

1. `#### Open-issue sweep dispositions` and `#### Deferred tidyings swept` are `####` headings **inside** the roadmap section but before `### Steps`.
   Extracting step headings from the whole section admits them.
2. `- **Hard dependency:** none, but it is the one step here whose resolution binds another package; [#890] records the four candidate resolutions.` sits on the step whose issue **is** [#890].
   Extracting every `[#N]` from the bullet makes it a self-loop and reports a cycle.
3. `- **Hard dependency:** after Step 8 (…) and informed by Step 10.` names two steps with different force; the diagram draws 8 as solid and 10 as dashed.
   Extracting both flags a correct document.
4. Track C's prose says "Step 6 complements Step 1", and the `front-door-majors` batch bullet's continuation says "Step 2 was provisionally batched here… it did not".
   A membership check that reads whole bullets puts [#724] in two tracks and [#830] in a batch it left.

### Constraints from `AGENTS.md`

- A parser's testable surface is the input domain, not the inputs the author can picture.
  This is what made the host decision fall to a tested implementation.
- A mechanism half and a data half get separate steps: the parser and the checks it feeds are sequenced apart below, and the check that verifies one row is written before the rows.
- `pnpm -r run test` excludes the root project, so a root-level test file needs its own runner invocation.
- Adding `vitest` at the root uses the existing `catalog:` entry (`^4.1.11`), already resolved in the lockfile for eight packages, so pnpm's 24 h `minimumReleaseAge` gate is not in play.

## Design Overview

### Shape

Four modules, split so the tests exercise pure functions and the CLI stays thin:

```text
scripts/roadmap-check.mjs           CLI: locate, read, render, exit
scripts/roadmap/step-references.mjs  the leading-run tokenizer (shared)
scripts/roadmap/parse-roadmap.mjs    markdown text -> Roadmap model
scripts/roadmap/validate-roadmap.mjs Roadmap model -> Finding[]
```

`parse-roadmap.mjs` takes a **string**, not a path, so every parser test is a fixture literal and the filesystem appears only in the CLI.

### The shared primitive

Three consumers need the same thing — a run of step references embedded in prose that must stop before the prose resumes.
`parseStepReferenceRun(text)` consumes, from the start of `text`, only the tokens `after`, `Step`, `Steps`, `and`, `,`, `→`, a bare integer, or `[#N]`, and stops at the first token that is none of them or at the first `(`.

```javascript
parseStepReferenceRun("after Steps 8, 10, and 11, which together create both refusal paths.");
// -> [{ kind: "ordinal", n: 8 }, { kind: "ordinal", n: 10 }, { kind: "ordinal", n: 11 }]
parseStepReferenceRun("after Step 8 (the completed-child loop must exist…) and informed by Step 10.");
// -> [{ kind: "ordinal", n: 8 }]
```

A bracketed `[#N]` is an issue number; a bare integer after `Step`/`Steps` is an ordinal.
That discriminator is what makes one tokenizer serve both heading shapes: the ordinal-era bullets all spell `Step N`, and [#893]'s format spec spells the new form `after [#857]`.
Ordinals resolve to issues through the heading map before any check runs, so the model downstream of the parser is issue-keyed throughout — the same re-keying [#893] applied to the `✅` step-mark gate.

A `**Hard dependency:**` value beginning with `none` is a claim of no dependency and yields no references at all.
Both live "none" bullets — `none — independent of Steps 15 and 16.` and `none, but … [#890] records …` — begin with the word, which is what disarms the self-loop.

### The model

```javascript
/**
 * @typedef {object} RoadmapStep
 * @property {number} issue          canonical identity
 * @property {number|null} ordinal    null under the [#N] heading shape
 * @property {string} title
 * @property {{impact: number, risk: number, priority: number}|null} scores
 * @property {string[]} releaseTags   every `Release:` line in the block, so "exactly one" is checkable
 * @property {{present: boolean, dependsOn: number[]}|null} hardDependency
 */

/**
 * @typedef {object} Roadmap
 * @property {string} phaseTitle
 * @property {RoadmapStep[]} steps      in section order
 * @property {{from: number, to: number, kind: "hard"|"soft"}[]} edges
 * @property {number[]} nodeIssues
 * @property {string} tracksText
 * @property {string} batchesText
 */
```

`tracksText` and `batchesText` are carried as raw strings rather than parsed member lists.
That is the design consequence of the lenient decision: the validator asks those sections "is this number mentioned here", never "who are your members".

### Section anchors

The parser slices on four anchors, each verified to occur exactly once in each live roadmap section: `### Steps`, one ```mermaid fence, `### Parallel tracks`, and `### Release batches`.
Step blocks are taken from `### Steps` only, which is what excludes the two `####` sweep headings above it.

### The checks

| #   | Check                                                                                                            | Severity | On the live docs           |
| --- | ---------------------------------------------------------------------------------------------------------------- | -------- | -------------------------- |
| 1   | Every step has scores, and `Priority === Impact × (6 − Risk)`                                                    | error    | fires on [#857] and [#858] |
| 2   | Every step has exactly one `Release:` line with a recognized value                                               | error    | clean                      |
| 3   | A step's named batch has a `**Batch "<name>"` bullet, and the batch's `tail =` names a step declaring that batch | error    | clean                      |
| 4   | Every step has a diagram node; every diagram node is a step                                                      | error    | clean                      |
| 5   | The hard-edge graph is acyclic                                                                                   | error    | clean                      |
| 6   | A `**Hard dependency:**` claim and the diagram's solid edges agree, both directions                              | warning  | fires 3×                   |
| 7   | Every step's number is mentioned in `Parallel tracks` and in `Release batches`                                   | warning  | fires on [#878], [#885]    |

Checks 1–5 are errors because their inputs parse strictly and a violation is unambiguous.
Checks 6 and 7 are warnings because their inputs are prose: check 6's authority (the diagram) is strict but its counterparty (the bullet) is not, and check 7 is deliberately one-directional.

### Consumer call site

```javascript
const roadmap = parseRoadmap(readFileSync(docPath, "utf8"));
if (!roadmap) return { code: 2, message: `${docPath} has no ## Improvement roadmap section` };
const findings = validateRoadmap(roadmap);
render(findings, docPath);
return { code: findings.some((f) => f.severity === "error") ? 1 : 0 };
```

Tell-Don't-Ask holds: the CLI hands the text over and receives findings, never reaching into the model to re-derive anything.
`validateRoadmap` reads only `Roadmap` fields, so its parameter type carries nothing it does not use.

### CLI contract

```console
./scripts/roadmap-check.mjs                 # every package with a live roadmap
./scripts/roadmap-check.mjs pi-subagents    # one package
```

Exit 0 when there are no errors (warnings may print), 1 when any error is found, 2 when the question could not be answered — a missing package directory, a missing architecture doc, or a document whose roadmap section is absent or missing an anchor.
This differs deliberately from `scripts/release/next-version.sh`, whose status is 0 either way because it answers a *question*; this is a *check*, so the status is the answer.
A package with no `## Improvement roadmap` section is skipped silently in the all-packages mode and is an exit-2 error when named explicitly.

### Predicted output on the live roadmaps

Measured this session with a spike implementing the design above:

```text
=== pi-subagents — 19 steps, 14 edges, 6 findings
   ERROR   #857: Priority 9 != 2 x (6 - 2) = 8
   ERROR   #858: Priority 7 != 3 x (6 - 4) = 6
   WARNING #878: not mentioned in Release batches
   WARNING #885: not mentioned in Release batches
   WARNING #829: diagram draws a hard edge from #724 but the step declares no Hard dependency
   WARNING #878: declares a hard dependency on #465 with no solid edge in the diagram
=== pi-permission-system — 7 steps, 5 edges, 1 findings
   WARNING #881: diagram draws a hard edge from #880 but the step declares no Hard dependency
```

Two errors, five warnings, zero false positives across 26 steps.
After the remediation step below, the error count is 0 and the [#878]/[#885] warnings clear, leaving the three dependency-bullet warnings this plan deliberately does not resolve.

## Module-Level Changes

### `scripts/roadmap/step-references.mjs` — added

`parseStepReferenceRun(text)` and `collectStepMentions(text)`.
The second is the lenient counterpart: it scans a whole section for `[#N]` tokens and for integers inside a `Steps? …` run, returning a `Set`.
A literal-token check (`section.includes("Step 2")`) was measured and rejected — Phase 22's `Steps 1 → 2, 3, 4` lists three of its four members as bare integers, which produced eight false positives in the spike.

### `scripts/roadmap/parse-roadmap.mjs` — added

`parseRoadmap(text)` returning `Roadmap | null`.
Slices the four anchors, splits step blocks out of `### Steps`, reads both heading shapes, extracts scores, every `Release:` line, and the `**Hard dependency:**` claim, and reads the diagram's nodes (issue from the label's `#N`, so both node-ID conventions work) and edges (`-->` hard, `-.…->` soft).

### `scripts/roadmap/validate-roadmap.mjs` — added

`validateRoadmap(roadmap)` returning `Finding[]`, each `{ severity, stepIssue, message }`.
Holds the seven checks and the depth-first cycle walk.

### `scripts/roadmap-check.mjs` — added

The CLI.
Resolves `packages/<pkg>/docs/architecture/architecture.md`, renders findings, sets the exit code.
Executable bit set, `#!/usr/bin/env node` shebang, matching `scripts/release/*.sh`'s hand-runnable contract.

### `test/roadmap/*.test.mjs` — added

`step-references.test.mjs`, `parse-roadmap.test.mjs`, `validate-roadmap.test.mjs`, `roadmap-check.test.mjs`.

### `vitest.config.mjs` (repo root) — added

`test.include: ["test/**/*.test.mjs"]`, scoped so the root run does not descend into the packages, each of which has its own config.
Written as `.mjs` rather than `.ts` because the repo root has no `check` script and nothing would typecheck a root `.ts` config.

### `package.json` (repo root) — changed

- `devDependencies` gains `"vitest": "catalog:"`.
- `"test"` becomes `"pnpm -r run test && vitest run"`.
  Safe against recursion: `pnpm -r` excludes the root project, which is why today's `"test": "pnpm -r run test"` does not already loop.
- `"test:scripts": "vitest run"` for running the root suite alone.

`pnpm-lock.yaml` changes as a consequence.

### `.github/workflows/ci.yml` — changed

The `Test` step's `pnpm -r run test` becomes `pnpm run test`, which is the same recursive run plus the root suite.
No new step and no new job.

### `.pi/prompts/plan-improvements.md` — changed

The `## Output` section's "After writing the plan, present a summary to the user and ask whether to commit" gains a preceding verification: run `./scripts/roadmap-check.mjs $1` and resolve every error before asking.
This lands beside the existing instruction to run each health-metric recompute command before committing, which is the same discipline.

### `.pi/prompts/finish-phase.md` — changed

The phase-close checks gain a `./scripts/roadmap-check.mjs $1` run before archiving, so a roadmap is not carried into `history/` with a published-score error in it.
Reported as advisory at close — the phase is finished, so an error is a record correction rather than a blocker.

### `.pi/skills/improvement-discovery/SKILL.md` — changed

The `## Output format` section records that the format is now machine-checked, names the four structural anchors the checker depends on (`### Steps`, the single ```mermaid fence, `### Parallel tracks`, `### Release batches`), and notes that `Priority` is verified against `Impact × (6 − Risk)` rather than taken on trust.
This is the same treatment `#### Open-issue sweep dispositions` already has: a spelling that is load-bearing because a tool reads it.

### `packages/pi-subagents/docs/architecture/architecture.md` — changed

Remediation of the three defects the validator finds:

- [#857]'s `Priority 9` → `Priority 8`.
- [#858]'s `Priority 7` → `Priority 6`.
- The `Release batches` subsection's "Independently releasable" list gains [#878] and [#885], which both declare `Release: independent`.

The `✅` marks, the headings, and the `[#N]` reference definitions are untouched, so [#893]'s step-mark gate and `rumdl`'s MD053 are unaffected.

### Files deliberately not changed

Each is a predicted-unchanged file with the claim it rests on:

| File                                                              | Claim                                                                                                                                                                       |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/pi-permission-system/docs/architecture/architecture.md` | Its only finding is a dependency-bullet warning, which this plan does not resolve. Its scores and release tags are clean.                                                   |
| `.pi/prompts/tdd-plan.md`, `.pi/prompts/build-plan.md`            | Their `✅` step-mark gate is issue-keyed since [#893] and reads the heading and node, neither of which changes.                                                             |
| `.pi/prompts/plan-issue.md`                                       | Its `Release:` derivation greps the per-step tag and the `Release batches` heading; both keep their spelling, and the remediation only lengthens a list.                    |
| `.pi/skills/roadmap-fit/SKILL.md`                                 | It appends to `#### Open-issue sweep dispositions`, which the validator neither reads nor requires.                                                                         |
| `eslint.config.js`                                                | Scoped to `^packages/` and `types: ["ts"]`, so a root `.mjs` is outside it. Biome covers the new files through its `includes: ["**"]`.                                      |
| `tsconfig.base.json`, any package `tsconfig.json`                 | Nothing added is TypeScript.                                                                                                                                                |
| `scripts/release/lib.sh`                                          | Its package enumeration is release-scoped; the CLI enumerates `packages/*/docs/architecture/architecture.md` directly rather than taking a dependency on release machinery. |
| `.rumdl.toml`, `prek.toml`                                        | No markdown rule changes, and the new files are JavaScript, which the existing biome hook already covers.                                                                   |

## Test Impact Analysis

The repo root has no test harness today, so every test here is new and none is redundant.
The package suites are untouched.

### What the harness enables

A parser whose input domain is "two documents in two heading shapes with prose fields" cannot be verified by running it on the two documents — that verifies the inputs the author already looked at.
The fixtures pin the classes:

- both heading shapes, including the `(with [#M])` fold-in suffix;
- the two `none` dependency bullets, including the self-referencing one;
- the mixed-force bullet (`after Step 8 (…) and informed by Step 10`);
- the plural member run (`Steps 1 → 2, 3, 4`) that a literal-token check misses;
- the two `####` sweep headings that sit inside the roadmap section above `### Steps`;
- all three dashed-edge spellings, which must classify as soft;
- a four-backtick fence around an embedded example, per this repo's own `markdown-conventions`.

### Evidence the harness is load-bearing

The first draft of `parseStepReferenceRun` written this session returned `[]` for six of the ten real dependency bullets — `after Step 6, which decides…` failed because the token `6,` carries its comma — while looking entirely plausible and while the diagram parse beside it was already correct.
The defect was invisible until the parse output was printed per-bullet.
The lenient mention check's first draft produced eight false positives for the same class of reason.
Both are exactly what a fixture test pins and a dry run against the live documents does not.

### Verification runs, dry-run this session

| Command                                            | Expected                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `./scripts/roadmap-check.mjs pi-subagents`         | 2 errors, 4 warnings before remediation; 0 errors, 2 warnings after          |
| `./scripts/roadmap-check.mjs pi-permission-system` | 0 errors, 1 warning                                                          |
| `./scripts/roadmap-check.mjs`                      | both of the above; the other six packages skipped, having no roadmap section |
| `./scripts/roadmap-check.mjs pi-colgrep`           | exit 2 — the doc exists but has no `## Improvement roadmap` section          |
| `./scripts/roadmap-check.mjs no-such-pkg`          | exit 2                                                                       |

The per-document counts (19 steps / 14 edges / 10 hard / 4 soft; 7 steps / 5 edges / 1 hard / 4 soft) and the exact finding list were produced by a spike this session and are reproduced in Design Overview.

### What is not testable here

That the wired-in prompt steps actually run at the right moment is only observable on the next `/plan-improvements` and `/finish-phase` invocation.
The `/build-plan`-style substitute is a grep confirming each prompt names the command exactly once.

## Invariants at risk

| Invariant                                                                                                              | Where it lives                                         | How this plan holds it                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The `✅` step-mark lands on both heading and Mermaid node, and `grep -cE '✅.*#<N>\b'` returns 2 (Refs [#872], [#893]) | `/tdd-plan`, `/build-plan`                             | The remediation edits only a `Priority` digit and a list line; no heading or node is touched. Re-run the gate for `#857` and `#858` after it.                     |
| `#### Open-issue sweep dispositions` keeps that exact spelling                                                         | `roadmap-fit`, `/finish-phase`                         | The parser must **exclude** it, which is a step's killing mutation rather than an edit to it.                                                                     |
| `Release batches`' "last listed member is the tail"                                                                    | `improvement-discovery` Output format 5, `/plan-issue` | Check 3 reads the tail token but never rewrites the list order; the remediation appends to the *independently releasable* bullet, which has no tail.              |
| `/finish-phase` detects both step-heading shapes                                                                       | `/finish-phase`, since [#893]                          | The validator adds a second consumer of the same dual shape and does not change the first.                                                                        |
| Every `[#N]` reference in `architecture.md` resolves to a definition (MD053)                                           | `pnpm run lint`                                        | The remediation adds no new `[#N]` reference: [#878] and [#885] are already referenced in that document. Confirm with `pnpm exec rumdl check` on the edited file. |
| `pnpm -r run test` does not recurse into the root project                                                              | root `package.json`                                    | Today's `"test": "pnpm -r run test"` would already loop if it did; the new value only appends to it. Verified by running `pnpm run test` after the harness lands. |

## TDD Order

Every step is verified with `pnpm run lint` and the root suite before committing.
No step under `packages/` changes source, so nothing here cuts a release.

1. **The shared tokenizer, and the harness that tests it.**
   Add `"vitest": "catalog:"` to root `devDependencies`, `vitest.config.mjs`, the `test`/`test:scripts` scripts, and the CI step; add `scripts/roadmap/step-references.mjs` with `parseStepReferenceRun` and `collectStepMentions`, and `test/roadmap/step-references.test.mjs` covering all ten real bullet forms plus the plural member run.
   Red: the tests fail with no module.
   Verify: `pnpm run test` runs both the workspace suites and the root suite.
   Killing mutation: remove the `break` that ends the leading run, so `after Step 8 (…) and informed by Step 10` yields `[8, 10]` — the mixed-force test must go red.
   Second mutation: make `collectStepMentions` match only the literal `Step <n>`, so the `Steps 1 → 2, 3, 4` test loses three members and goes red.
   Commit: `build: add a root vitest harness and a roadmap step-reference parser`.
2. **The roadmap parser.**
   Add `scripts/roadmap/parse-roadmap.mjs` and its tests over fixture literals covering both heading shapes, the fold-in suffix, the sweep headings above `### Steps`, and all three dashed-edge spellings.
   Killing mutation: take step blocks from the whole roadmap section instead of from `### Steps`, so `#### Open-issue sweep dispositions` parses as a step and the step-count assertion goes red.
   Second mutation: classify `-.soft.->` as a hard edge, so the hard/soft edge-count assertion goes red.
   Third mutation: read the diagram node's issue from its ID rather than its label, so the ordinal-shape fixture (`S1["✅ Step 1 (#724)…"]`) resolves to issue 1 and the correspondence fixture goes red.
   Commit: `refactor: parse an improvement roadmap into a step and dependency model`. (`refactor:` because nothing imports the module yet — AGENTS.md's rule that the commit wiring a module up is the one that carries `feat:`.)
3. **The finding model and the score check.**
   Add `scripts/roadmap/validate-roadmap.mjs` with the `Finding` shape and check 1 only.
   This is the check whose row is written before the rest of the rows: it is the one already proven to fire.
   Killing mutation: compare `priority` to `impact * risk`, so the fixture pinning `2 × (6 − 2) = 8` goes red.
   Second mutation: skip a step with no scores line instead of reporting it, so the missing-scores fixture goes red.
   Commit: `refactor: check an improvement roadmap's published priority arithmetic`.
4. **The remaining checks.**
   Add checks 2–7 to the same module, each with its own fixture.
   Killing mutations, one per class: accept a `Release:` value that matches neither literal (check 2 fixture goes red); resolve a batch name case-insensitively against any text in the section rather than against a `**Batch "<name>"` bullet (check 3); compare step and node counts instead of their issue sets (check 4); mark a node visited before descending rather than during, so the cycle fixture reports nothing (check 5); compare the claim and the edges in one direction only (check 6 — the bullet-omits fixture goes red while the no-bullet fixture stays green); and treat a step as mentioned when its number appears anywhere in the section, including inside another step's number (check 7).
   Commit: `refactor: check an improvement roadmap's release tags, diagram, and dependency claims`.
5. **The command.**
   Add `scripts/roadmap-check.mjs` with the argument handling, package enumeration, rendering, and exit codes, plus `test/roadmap/roadmap-check.test.mjs` driving it over temporary fixture files.
   Verify: run it against both live roadmaps and record the output; confirm the counts match the table in Design Overview.
   Killing mutation: return exit 0 unconditionally, so the fixture asserting exit 1 on an error goes red; and a second, return exit 1 for warnings too, so the warning-only fixture goes red.
   Commit: `feat: add a read-only improvement-roadmap validator`.
6. **Remediate the live roadmap.**
   Fix [#857]'s and [#858]'s `Priority` values and add [#878] and [#885] to the independently releasable list in `packages/pi-subagents/docs/architecture/architecture.md`.
   Verify: `./scripts/roadmap-check.mjs pi-subagents` reports 0 errors and 2 warnings; `grep -cE '✅.*#857\b'` and the same for `#858` still report 2; `pnpm exec rumdl check` on the file is clean.
   Killing mutation: none — this step adds no code.
   Its falsification is that the pre-edit run reports the two errors and the post-edit run does not.
   Commit: `docs(pi-subagents): correct Phase 22's published priorities and releasable list`.
7. **Wire it into the workflow.**
   Edit `.pi/prompts/plan-improvements.md`, `.pi/prompts/finish-phase.md`, and `.pi/skills/improvement-discovery/SKILL.md`.
   Verify: each file names `roadmap-check.mjs` exactly once (`grep -c`); `plan-improvements.md` still has its eight `### Step N` workflow headings and `finish-phase.md` its six `## Step N`, which is the scripted-edit hazard [#893] measured; `pnpm exec rumdl check` on all three.
   Commit: `docs: run the roadmap validator when writing and when archiving a phase`.

### Tidy First

Skipped, per the `tidy-first` skill's applicability gate.
The change creates `scripts/roadmap/`, `test/roadmap/`, and a root `vitest.config.mjs`, and modifies `package.json`, `ci.yml`, two prompts, one skill, and one architecture doc.
It modifies **no** pre-existing `src/` or `test/` file, so the assessor's input list — the existing code the change will touch — is empty and the assessment is empty by construction.

## Risks and Mitigations

- **The validator has no new-format input to run against.**
  Both live phases keep ordinals through their close, so every real document the validator sees today is the shape [#893] is replacing.
  Mitigation: the dual-shape parsing is a Goal rather than a compatibility afterthought, and the new shape is covered by fixtures written from [#893]'s committed format spec.
  The risk this leaves is that the spec's worked example and the first real new-format roadmap differ; the next `/plan-improvements` run is where that surfaces, and it surfaces as a parse failure rather than a silent pass.
- **A lenient check that cannot fail looks like coverage it is not.**
  Check 7 reports omissions only, so a step listed in two tracks passes.
  Mitigation: the plan states the limit in Non-Goals rather than in a code comment, and the strict alternative is priced there ([#893]-style format tightening) so a later reader does not rediscover it.
- **The three dependency warnings become permanent noise.**
  Every run on the live roadmaps will print them until the phases archive.
  Mitigation: warnings do not affect the exit status, and `/finish-phase` treats the run as advisory.
  If they prove annoying, resolving them is a two-line edit; the plan declines it only because it revises landed steps' records.
- **The root `test` script change breaks a workflow that assumed `pnpm -r run test`.**
  Mitigation: the new value is a superset, and `AGENTS.md` and the agent files that name `pnpm -r run test` keep working unchanged — they simply run less than `pnpm run test` does.
  Verified by running both after step 1.
- **`vitest` at the root introduces a second config that packages might pick up.**
  Mitigation: `test.include` is scoped to `test/**/*.test.mjs`, and each package runs `vitest run` from its own directory against its own `vitest.config.ts`.
  Verified by running a package suite after step 1 and confirming its test count is unchanged.
- **The checks encode today's format and will drift from it.**
  A format change that the checks do not know about turns into a wall of false errors at exactly the moment someone is writing a roadmap.
  Mitigation: step 7 records the four structural anchors in the format spec itself, so the spec and the checker are edited from one place; and errors are confined to the five strictly-parsing checks, which are the ones the spec pins.

## Open Questions

None blocking.

Two items are recorded rather than resolved.

The dashed-edge vocabulary is unsettled — three spellings across two documents, none specified — so `**Soft dependency:**` bullets go unchecked.
Filed as [#902], which also carries the extension to the validator once the vocabulary is decided.

Whether the validator should ever gate CI is left open.
The operator declined it during planning on the grounds that it would gate a document edited by hand mid-phase, so a half-written roadmap would block unrelated work.
The two prompt invocations in step 7 put the check at the two moments the document is known to be complete, which is where a gate would want to be anyway; if that proves insufficient, the CI question reopens with evidence rather than in the abstract.

[#724]: https://github.com/gotgenes/pi-packages/issues/724
[#802]: https://github.com/gotgenes/pi-packages/issues/802
[#857]: https://github.com/gotgenes/pi-packages/issues/857
[#858]: https://github.com/gotgenes/pi-packages/issues/858
[#872]: https://github.com/gotgenes/pi-packages/issues/872
[#878]: https://github.com/gotgenes/pi-packages/issues/878
[#881]: https://github.com/gotgenes/pi-packages/issues/881
[#885]: https://github.com/gotgenes/pi-packages/issues/885
[#890]: https://github.com/gotgenes/pi-packages/issues/890
[#893]: https://github.com/gotgenes/pi-packages/issues/893
[#902]: https://github.com/gotgenes/pi-packages/issues/902
