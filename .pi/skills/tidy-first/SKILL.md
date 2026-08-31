---
name: tidy-first
description: |
  Tidy-First protocol for the planning agent — dispatch the tidy-first-assessor
  subagent over the files the planned change will touch, then fold its preparatory-refactor
  suggestions into the plan's TDD Order as `refactor:`/`test:` steps.
  Load during /plan-issue, after the design is settled and before writing the plan.
---

# Skill: tidy-first

Load this skill during planning — after the design is settled (the `Decide` step) and before the plan is written.
It encodes Kent Beck's *Tidy First*: make the change easy (with small preparatory refactors landed first), then make the easy change.
The assessment runs in a **subagent** so the many-files read does not consume the planning agent's context.

Planning is the right moment because the plan is the artifact that must absorb the answer.
An assessment that arrives at implementation time can only contradict a frozen plan; one that arrives here reshapes the TDD Order before anything is committed to.

## Applicability gate

Dispatch the assessor when the plan will **create or modify `src/` or `test/` files**.
Skip for a docs-only or config-only plan — there is nothing to prepare.
Note the skip and proceed to writing the plan.

## Step 1: Gather the target files

From the settled design, list the `src/`/`test/` files the change will modify or create — the same list you are about to write into the plan's "Module-Level Changes".
The plan does not exist on disk yet, so this list is the assessor's primary input, not a file path.
Add every test that drives the seam the change rewires, even when the design edits none of them — a composition-root or entry-point test breaks on a wiring change that never touches its file (Refs #827).

## Step 2: Dispatch the assessor

Dispatch the `tidy-first-assessor` subagent via the `subagent` tool:

- `subagent_type`: `"tidy-first-assessor"`
- `description`: `"Tidy-First assessment for issue #N"`
- `prompt`: include the issue number, the target-files list from Step 1, and a **design summary** — 5–15 lines stating what each target file gains, loses, or changes, and roughly where in the file it lands.

The design summary carries the weight the written plan used to carry, so write it concretely: "adds a third branch to `resolveScope()` in `src/scope.ts` (currently 40 lines)" tells the assessor where the friction is; "updates scope resolution" does not.

The assessor is read-only and returns an advisory report: **Recommended** preparatory commits (each tied to a specific friction the change will hit), **Optional** ones, and **Rejected-as-scope-creep** items it deliberately declined.

## Step 3: Triage into the plan

The report is advisory — you decide what the plan says.

- **Recommended** tidyings: write each into the plan's TDD Order as its own `refactor:` or `test:` step, before the behavior-change step it prepares.
  Placement is leading **or** integrated: a small plan puts them all up front; a larger plan may need a tidying immediately before each part it prepares, so the tree stays green and each preparation sits next to the change it earns.
  Say in the step which friction it prepares — the implementing session reads the plan, not this report.
- **Optional** tidyings: fold them in only if they genuinely shrink the change; drop them otherwise.
- **Rejected** items: do not fold them in.
  If one looks worth doing, it is separate-concern cleanup — do not scope-creep the plan.
  Record it in the Planning stage note under a `#### Deferred tidyings` heading, one line naming the file and the friction, so `/plan-improvements` can find it (Refs #787).

Read a rejection's reasoning, not just its verdict — one that contradicts the design is a signal to re-examine the design, which is cheap here and expensive later (Refs #726).
Read a "no preparatory tidying warranted" verdict the same way: what it verified on the way past — interface fit, call-site counts, fixture assumptions — routinely confirms or refutes the design's structural claims (Refs #787).
If a recommendation would **reshape** the design rather than prepare it, surface it to the operator before writing the plan instead of absorbing it silently.

Do not plan tidying of code the change will not touch — that is scope creep, not Tidy First.
An extraction is a copy, so it carries the source's rule violations into a file that is now shared — the plan must say to re-read moved code against the governing skill before committing it (Refs #727).

## Step 4: Write the plan

Continue to the plan document.
The preparatory steps are ordinary TDD Order entries from here on: the implementing session executes them in order, each as its own commit, each leaving the tree green — no second assessment, no separate triage.
