---
name: delegation
description: |
  Load before dispatching a subagent, editing a `.pi/agents/*.md` definition,
  or reading a subagent's report.
---

# Delegation

## Scope bounds

When delegating lint-fix or refactoring work to a background agent:

- Do not change function semantics (removing comparisons, altering control flow, removing defensive checks).
- Only add `eslint-disable` comments or make type-safe transformations (removing unused imports, adding type annotations).
- Include `pnpm -r run test` as a verification step before reporting completion.

A read-only agent needs a scope bound too — `find /` is read-only and still walks every mounted volume, trips the external-directory permission gate, and can read a stale copy of a dependency.
Bound its searches to the repo, and require fixing a failed pattern before widening its root.

## Reading the report

A subagent's universal claim ("no ordering issue", "nothing else calls this") is the one to verify — a positive finding ships the line that proves it, a universal one quantifies over cases the report never shows.
Check a multi-question report against itself first, and check that each answer cites the implementation rather than a test fixture.
A **count** the report supplies — call sites, occurrences, files matched — is re-derived before it lands in a plan, an ADR, or an issue body.
The report's conclusion can be right while its arithmetic is wrong, and the artifact outlives the dispatch.

The mirror holds for a claim **you** supply: a reviewer cannot verify a coverage assertion handed to it as a premise, so state what you checked, not what you conclude was covered.
When a change creates N artifacts that cross-reference each other, enumerate the edges rather than sampling them.
The same holds for a measurement: hand a reviewer the raw source and a mandate to re-derive, not your tables.
A measurement is also scoped to the commit it was taken at: re-run it after any behavior change rather than defending it, and never re-use a cached baseline whose result depends on filesystem state.

## Project subagents

### Pre-completion reviewer

The `pre-completion-reviewer` agent (`.pi/agents/pre-completion-reviewer.md`) is dispatched automatically by `/tdd-plan` and `/build-plan` after all implementation steps are complete.
The `pre-completion` skill (`.pi/skills/pre-completion/SKILL.md`) encodes the dispatch protocol loaded by both templates.
The agent's `model:` frontmatter must use the `provider/id` alias form the Pi CLI/UI accepts (e.g. `anthropic/claude-sonnet-4-6`); an ID absent from the model registry silently falls back to the parent session's model.

### Craftsmanship subagents

Two read-only subagents carry the micro / craftsmanship lens (SOLID at the method scale, Test-Driven **Design**, self-documenting code) so it is examined systematically rather than left to whoever has spare context:

- `tidy-first-assessor` (`.pi/agents/tidy-first-assessor.md`) — dispatched during `/plan-issue` via the `tidy-first` skill (`.pi/skills/tidy-first/SKILL.md`), after the design is settled and before the plan is written.
  It reads the files the change will touch and proposes preparatory `refactor:`/`test:` commits that shrink the change (make the change easy, then make the easy change).
  Advisory; the planning agent triages them into the plan's TDD Order, so the implementing session executes them as ordinary steps and runs no second assessment.
  Strictly change-scoped — it must not propose tidying code the change will not touch; rejections are recorded under `#### Deferred tidyings` in the Planning stage note for `/plan-improvements` to sweep.
- `craftsmanship-scout` (`.pi/agents/craftsmanship-scout.md`) — dispatched during `/plan-improvements` discovery (Step 5).
  It **opens** (does not grep) the largest test files and sweeps method-level design, naming, and test-code quality (taxonomy Category G) into a scored debt inventory, flagging each cluster concentrated vs. scattered.
  The concentrated/scattered split drives the deferral gate: concentrated debt in a hot area is a legitimate craftsmanship lean phase; scattered trivia defers to the `tidy-first` boy-scout path.

Both use the same `provider/id` model-alias rule as the reviewer above.

### Reading Pi's source

A multi-hop trace through the Pi checkout is an `Explore` dispatch with a non-default model; the `code-design` skill's "Reading Pi's own source" section says which model, when to keep the trace inline, and how to cite what it finds.
