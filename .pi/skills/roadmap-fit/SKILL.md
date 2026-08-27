---
name: roadmap-fit
description: |
  Evaluate a newly filed issue for fit with its package's open improvement phase
  and record the operator's disposition in the roadmap's sweep list.
  Load at the moment a session files a GitHub issue — during planning, implementation, or a retrospective.
---

# Skill: roadmap-fit

An issue spun off during an improvement phase is evaluated for roadmap fit **when it is filed**, not at phase close.
By phase close it is too late to fold anything in, and a phase-born issue the roadmap never named is archived out of the phase's history entirely.

Filing without scope-creeping stays the correct local move.
This skill carries the issue back up to the roadmap; it never pulls the work into the step under way.

## Step 1: Resolve the package and detect an open phase

Take the package from the new issue's `pkg:*` label.
With no label, use the package the session is working in (the plan's package).
An issue carrying two `pkg:*` labels gets a disposition in each package that has an open phase.

Then run one grep per resolved package:

```bash
grep -n '^## Improvement roadmap — Phase' packages/<PKG>/docs/architecture/architecture.md
```

No match, no architecture doc, or no resolvable package means there is no open phase.
Stop here — record nothing and say nothing further.
Most sessions exit at this step.

## Step 2: Propose a disposition, then ask

Read the roadmap's numbered steps, pick the disposition that fits, and state a one-sentence rationale.

| Disposition                               | When it applies                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Folds into an existing step (name it)     | The same defect class as a step, that step's own residual, or it consumes something the step produces |
| Becomes a new step in this phase          | It is the foundation another step needs, or a peer-sized piece of the phase's spine                   |
| Deferred to a later phase, with rationale | Real roadmap work that does not fit this phase's budget or spine                                      |
| Out of scope for the roadmap              | A feature or bug unrelated to the phase's cause                                                       |

Put the proposal to the operator with `ask_user`: all four as options, yours marked `recommended: true` with the rationale in its description.
The sweep list is user-decided by convention, and two of the four change the phase's scope.
Do not skip the gate because "defer" looks obvious — a self-recorded defer is the failure this skill exists to prevent (Refs #753).

Recording a fold-in is not authorization to implement it now.
The work still happens under the filed issue, on its own schedule.

## Step 3: Record the disposition

Append a bullet to the roadmap's `#### Open-issue sweep dispositions` subsection, inside `### Findings (planned <date>)`.
Create that subsection at the end of `### Findings` if the roadmap has none.
The list must stay inside the roadmap section: `/finish-phase` moves that section wholesale into `history/phase-N-<slug>.md`, so a disposition recorded anywhere else is orphaned at archive time.

```markdown
- [#N] — filed by <Step M's planning | Step M's implementation | the #X retrospective>; <disposition>.
  <One or two sentences of rationale.>
```

Add the matching `[#N]:` reference definition at the end of `architecture.md` — the doc uses reference-style issue links, and a bare `[#N]` renders as literal text.

A fold-in also edits the named step: its heading gains the issue (`([#610], with [#753])`), and its `Target:`/`Outcome:` gain the added scope.
When the disposition narrows a step that has already **shipped**, edit that step's `Outcome:` to match what landed rather than reopening the step.

## Step 4: Commit it separately

```bash
git add packages/<PKG>/docs/architecture/architecture.md
git commit -m "docs(<PKG>): disposition #N against Phase N"
```

Keep it out of the session's own commits — it is roadmap bookkeeping, not part of the change under way.
The packages carrying phased roadmaps have `docs/architecture` in `release-please-config.json`'s `exclude-paths`, so this commit cuts no release.
