---
issue: 767
issue_title: "Evaluate spun-off issues for roadmap fit at filing time"
---

# Evaluate spun-off issues for roadmap fit at filing time

## Release Recommendation

**Release:** ship independently

No architecture roadmap references this issue, so there is no batch to join.
Every file this change touches — `.pi/skills/roadmap-fit/SKILL.md`, four `.pi/prompts/*.md` templates, `.pi/skills/improvement-discovery/SKILL.md`, and `AGENTS.md` — lies outside every component path in `release-please-config.json`, so the change cuts **no release at all**.
"Ship independently" here means land and close the issue; there is no release-please PR to wait on.

## Problem Statement

An issue spun off during an improvement phase should be evaluated for how it fits that phase at the moment it is filed.
Today that evaluation reliably happens only when the issue surfaces inside a scoping session, and nothing catches the ones that surface later.

Four issues were born inside pi-permission-system Phase 13.
[#752] and [#610] surfaced during planning sessions and got numbered steps plus disposition entries.
[#751] and [#753] surfaced during implementation and a single step's planning, where the correct local move is "file it, do not scope-creep" — that is what happened, and it was right.
But nothing carried them back up to the roadmap.

Nothing downstream closes the gap.
The `pre-completion-reviewer` verifies that a plan-named follow-up was **filed**, not that it was **dispositioned**.
`/finish-phase`'s hard gate enumerates only issues carrying a numbered roadmap step, and its archive step records only the abandoned/parked issues the roadmap already names.
A phase-born issue with no disposition entry therefore disappears from the phase's history entirely.

The cost is not only bookkeeping.
[#753] is the same defect class as Step 10 at a second site and consumes the request id Step 9 mints — evaluated at filing time it would have folded into Step 10 immediately.
[#751] is the twice-parked residual of Step 2's own contract, and its absence left Step 2's `Outcome:` overclaiming a capability the `select`/`input` fallback never received.
Both were backfilled by hand in commit `200e5788` during the [#655] retrospective; this change is about not needing that backfill next time.

## Goals

- Add a `roadmap-fit` skill that carries a newly filed issue back up to its package's open improvement phase as a recorded disposition.
- Load it **lazily** — at the point a session actually files an issue, in `/plan-issue`, `/tdd-plan`, `/build-plan`, and `/retro` — so a session that files nothing pays no context cost.
- Keep the disposition **operator-decided**: the agent proposes with a rationale, an `ask_user` gate settles it, matching the existing "user-decided" convention in the sweep list.
- Standardize the roadmap's disposition list under a single grep-able heading, `#### Open-issue sweep dispositions`, so both the append and the reconciliation have a deterministic target.
- Add a reconciliation backstop to `/finish-phase`: enumerate issues created during the phase window carrying the package's label and require each to appear in the dispositions list before archiving.
- Record the rule in `AGENTS.md` so it survives a session that loads no prompt template.

This change is **not breaking**: it adds one skill, edits five prompt/skill files and `AGENTS.md`, ships no code, and changes no config default.
The observable change is confined to the next session that files an issue while a package has an open phase.

## Non-Goals

- **No change to `/pr-review`, `/triage-backlog`, `/retro-note`, `/ship-issue`, or `/land-worktree`.**
  A grep for `gh issue create` across `.pi/prompts/` finds it only in `plan-issue.md` and `plan-improvements.md`; none of these five files or opens an issue, so none is a filing site.
- **No rewrite of archived history files.**
  Three heading spellings exist across the two packages' archives (`### Open-issue sweep dispositions` in pi-permission-system Phase 10, a bold prose lead-in in Phase 13, `## Deferred work (explicit dispositions, …)` in pi-subagents Phase 21).
  The standardization applies to roadmaps written from here forward; rewriting `history/` would churn eight archived files for no reader benefit.
- **No `pre-completion-reviewer` §2i extension.**
  Considered and declined — see Design Overview, "Rejected alternatives".
- **No CI or scripted enforcement.**
  The backstop is a prompt step running two `gh`/`grep` commands, not a workflow job.
- **No change to how `/plan-improvements` conducts its sweep.**
  Only the heading it writes the result under is fixed.
- **No migration of a live roadmap.**
  Verified at planning time: `grep -rn "Improvement roadmap" packages/*/docs/architecture/architecture.md` returns nothing, so no package has an open phase and there is nothing to migrate.

## Background

### Where dispositions live

While a phase is open, its roadmap is a `## Improvement roadmap — Phase N: <title>` section in `packages/<PKG>/docs/architecture/architecture.md`, inserted immediately above `## Refactoring history`.
Its `### Findings (planned <date>)` subsection carries the open-issue sweep result — the list this change appends to.
`/finish-phase` moves the whole roadmap into `history/phase-N-<slug>.md`, promoting every heading up one level.

The live format, from commit `200e5788` (the backfill this issue is a reaction to):

```markdown
- [#751] — filed by Step 3's implementation; deferred to a later phase, not folded back into Step 2.
  It is the residual of Step 2's own contract (ADR 0011 §4's reachable complete view), twice parked: [#710]'s plan parked the `select`/`input` fallback here for Step 3, and Step 3 did not resolve it either.
  Step 2 shipped and released, so its `Outcome:` is narrowed to name the dialog rather than reopened.
```

That is the largest instance the shape has to carry: an issue reference, the filing site, the disposition, and up to two sentences of rationale, plus a `[#751]:` reference definition at the end of the file.
The [#753] fold-in additionally edited Step 10's heading (`([#610], with [#753])`), its `Target:`, and its `Outcome:` — so a fold-in disposition is a **scope change to a numbered step**, not a bookkeeping line.

### Which templates file issues

`/plan-issue` has an explicit `## File follow-up issues` step.
`/tdd-plan`, `/build-plan`, and `/retro` have none — they file issues ad hoc under the `AGENTS.md` rule "file the follow-up first, then write back the number the API returned".
So those three need a filing directive as well as the disposition write; `/plan-issue` needs only the disposition write appended to a step it already has.

### Precedent for a shared procedural skill

`pre-completion` (85 lines) and `tidy-first` (55 lines) are the established pattern: a small procedural skill that one or more templates load at a named point, with the dispatch mechanics in the skill and a one-line directive in each template.
`improvement-discovery` (284 lines) owns the phase model but is loaded only by `/plan-improvements`.

### Constraints from `AGENTS.md`

- **Stale prompt-template expansion.**
  This session's edits to `.pi/prompts/*.md` do not take effect for an already-running Pi process; the on-disk file is authoritative.
  The implementing session must not judge its own edit by re-running the command.
- **Edit tool batches.**
  A multi-edit `Edit` call is atomic; anchor on adjacent unique lines, not on padded table rows.
- **Markdown.**
  One sentence per line; reference-style `[#N]` issue links with matching `[#N]:` definitions (MD053).
- **Release paths.**
  `packages/pi-permission-system/docs/architecture`, `packages/pi-subagents/docs/architecture`, and `packages/pi-colgrep/docs/architecture` are all in `release-please-config.json`'s `exclude-paths`, so a mid-phase disposition commit cuts no release.
  Those are exactly the three packages that carry architecture docs with phased roadmaps.

## Design Overview

### The procedure

The skill is four steps, and it exits at step 1 in the common case.

1. **Resolve the package and detect an open phase.**
   Take the package from the new issue's `pkg:*` label; with no label, use the package the session is working in.
   Then run one grep:

   ```bash
   grep -n '^## Improvement roadmap — Phase' packages/<PKG>/docs/architecture/architecture.md
   ```

   No match, no architecture doc, or no resolvable package means there is no open phase: stop, record nothing, and say nothing further.
   An issue carrying two `pkg:*` labels gets a disposition in each package that has an open phase.

2. **Propose a disposition, then ask.**
   Read the roadmap's steps and pick the fitting one of four, with a one-sentence rationale: folds into an existing step (name it), becomes a new step in this phase, deferred to a later phase, or out of scope for the roadmap.
   Put the proposal to the operator with `ask_user` — all four as options, the proposal marked `recommended: true` with the rationale in its description.
   Two of the four change the phase's scope, and the sweep list is user-decided by convention.
   Recording a fold-in is **not** authorization to implement it now: the local move is still file-and-continue.

3. **Record it.**
   Append a bullet to the roadmap's `#### Open-issue sweep dispositions` subsection, creating that subsection at the end of `### Findings` if the roadmap has none.
   Add the `[#N]:` reference definition at the end of `architecture.md`.
   A fold-in also edits the named step — heading, `Target:`, `Outcome:` — and a disposition that narrows a **shipped** step's claim edits that step's `Outcome:` rather than reopening it.

4. **Commit separately.**
   `docs(<PKG>): disposition #N against Phase N`, distinct from the session's own work.

### Bullet shape

```markdown
- [#N] — filed by Step M's <planning|implementation>; <disposition>.
  <One or two sentences of rationale.>
```

### Why lazy loading

Listing `roadmap-fit` in each template's `## Load skills` block would cost ~80 lines of context in every planning, implementation, and retro session for an event that happened four times across all of Phase 13.
A conditional directive at the filing point costs one line when no issue is filed.
This differs from `tidy-first`/`pre-completion`, which are listed upfront because they run on every invocation.

### Heading standardization

The append target must be greppable.
Measured across the archives: pi-permission-system Phase 10 used a real heading, Phase 13 flattened it to a bold prose lead-in (`Open-issue sweep dispositions (user-decided):`), and pi-subagents Phase 21 used `## Deferred work (explicit dispositions, 2026-07-17)`.
Three spellings across two packages is exactly the drift a grep-able contract cannot tolerate, so `/plan-improvements`'s Output section and the `improvement-discovery` skill's Output format both gain the requirement: the sweep result goes under `#### Open-issue sweep dispositions` inside `### Findings`.

### The `/finish-phase` backstop

The phase window start is already recorded: `### Findings (planned YYYY-MM-DD)`.
The reconciliation is two commands.

```bash
gh issue list --state all --label "pkg:$1" --search "created:>=<findings-date>" --json number,title,state
grep -n '\[#N\]' packages/$1/docs/architecture/architecture.md
```

Measured against Phase 13's window (`created:>=2026-08-15`, run 2026-08-19): the query returns **15** issues, of which **7** are already phase steps or already in the dispositions list, leaving **8** residual — including the two ([#751], [#753]) this issue exists for and two pieces of tracker noise.
Eight is not a trivial list, which is the honest framing: the backstop is a net, not the mechanism.
It therefore permits a **grouped** bullet for the residual, matching the roadmap's existing convention (`Feature issues [#736], [#720], … — out of scope for a structural phase`), and presents the whole set to the operator in one pass rather than interrogating issue by issue.

It fires at phase close, too late to fold anything in — that is precisely why it does not replace the filing-time gate.
Its unique value is catching an issue filed by hand, outside any prompt.

Where the roadmap's `### Findings` heading carries no date, fall back to the date of the commit that added the roadmap section (`git log --diff-filter=M --format=%ad --date=short -S'Improvement roadmap — Phase N' -- packages/$1/docs/architecture/architecture.md | tail -1`).

### Rejected alternatives

- **A step duplicated across the four templates** (~10–14 lines × 4).
  The procedure is identical at all four sites, and four copies drift — the disposition heading itself already drifted three ways across two packages with a single author.
- **Extending `improvement-discovery`.**
  It owns the phase model, but at 284 lines it is loaded only by `/plan-improvements`; making an implementation session load it to file one issue inverts the cost.
  It still gains the heading requirement, because it owns the Output format the roadmap is written against.
- **Extending `pre-completion-reviewer` §2i.**
  It fires before ship — early enough to still fold in — but it only sees follow-ups a **plan** names, and [#751] was filed by an implementation step with no plan mention.
  It would therefore miss the motivating case while adding a third enforcement point to maintain.
- **Recording without deciding** (append an "undispositioned" marker, decide at phase close).
  Cheapest at filing time, but it discards the whole point: [#753]'s fold-in was obvious at filing time and invisible at phase close.

## Module-Level Changes

| File                                        | Change                                                                                                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.pi/skills/roadmap-fit/SKILL.md`           | **New.** ~80 lines: frontmatter (`name`, `description` naming the load trigger), the four-step procedure, the disposition table, the bullet shape, and the "recording is not authorization to implement" guardrail. |
| `.pi/prompts/plan-issue.md`                 | `## File follow-up issues` gains a sentence: after filing, load `roadmap-fit` and follow it for each new issue.                                                                                                     |
| `.pi/prompts/tdd-plan.md`                   | New `## Filing an issue mid-implementation` section after `## Execute the TDD cycle`: file it, do not scope-creep, then load `roadmap-fit`.                                                                         |
| `.pi/prompts/build-plan.md`                 | Same section after `## Execute the plan steps`.                                                                                                                                                                     |
| `.pi/prompts/retro.md`                      | Step 6 gains the directive where it already says "Suggest the user open a GitHub issue" — when an issue is actually filed during the retro, the disposition rides with it.                                          |
| `.pi/prompts/finish-phase.md`               | Step 2 gains a `### Reconcile phase-born issues` subsection (the completion gate keeps its existing prose). Added **inside** Step 2, not as a new numbered step.                                                    |
| `.pi/prompts/plan-improvements.md`          | Output item 1 requires the sweep result under `#### Open-issue sweep dispositions` inside `### Findings`; Step 2 gains a pointer to that heading.                                                                   |
| `.pi/skills/improvement-discovery/SKILL.md` | Output format gains the same heading requirement, beside the existing `Release batches` grep-ability rule.                                                                                                          |
| `AGENTS.md`                                 | One entry under `### Multi-session issue lifecycle`: an issue filed while a package has an open phase gets a roadmap-fit disposition at filing time, via the `roadmap-fit` skill; `Refs #767`.                      |

Verification greps run at planning time:

- `gh issue create` appears in `.pi/prompts/` only in `plan-issue.md` and `plan-improvements.md` — confirming the filing-site list.
- `finish-phase` is referenced from `AGENTS.md`, `plan-improvements.md`, `retro.md`, `ship-issue.md`, and `improvement-discovery/SKILL.md`, always **by name and never by step number** — so adding a subsection inside Step 2 breaks no cross-reference, and adding a new numbered step would have.
- `README.md` enumerates `.pi/prompts/` generically and lists only `package-*` skills by name, so it needs no update.
- `Open-issue sweep dispositions` appears only in `packages/pi-permission-system/docs/architecture/history/` and in `docs/plans/0534-cause-first-improvement-discovery.md` (a historical plan) — no live doc outside the archives names it, so the heading standardization has no other call site.

## Test Impact Analysis

This is a prompt-and-skill change with no code, so there are no unit tests to add or retire.
The deterministic verification available to `/build-plan` is:

1. `pnpm exec rumdl check` on every touched markdown file, and root `pnpm run lint`.
2. Dry-run the detection grep against all three packages carrying architecture docs and confirm it returns nothing today (no open phase), so the gate is a verified no-op at rest.
3. Dry-run the reconciliation command against Phase 13's window and confirm it reproduces the 15/7/8 split recorded above.
4. Confirm the skill is discovered: after the file lands, its name and description appear in a fresh session's available-skills list — but per the `AGENTS.md` staleness rule, **not** in the session that wrote it.

## Invariants at risk

- **`/finish-phase`'s step numbering.**
  Its Step 4 and Step 5 prose self-references (`per Step 4`, `Step 5.2 deletes …`) would break under renumbering.
  The change adds a subsection inside Step 2 and renumbers nothing; the build step verifies by grepping the edited file for `Step [0-9]` self-references and confirming each still resolves.
- **`/plan-improvements`'s Output item numbering.**
  The `Release batches` subsection is item 5 and `improvement-discovery` cross-references the Output format by name (`see Output format`), not by item number.
  The change edits item 1's text in place and adds no item.
- **The `### Findings (planned <date>)` heading is now load-bearing.**
  It was prose; the backstop makes its date the phase-window source.
  Mitigated by the documented `git log -S` fallback and by `/plan-improvements` continuing to write the date as it does today.
- **The dispositions list stays inside the roadmap section that `/finish-phase` moves wholesale.**
  A disposition appended anywhere else would be orphaned by the archive.
  The skill names `### Findings` as the parent explicitly; the `/finish-phase` verification step already counts moved content.

## Build Order

1. **Add the skill.**
   Write `.pi/skills/roadmap-fit/SKILL.md` complete with the four-step procedure, disposition table, bullet shape, and guardrails.
   Commit: `docs: add the roadmap-fit skill for filing-time phase dispositions (#767)`.
2. **Wire the four filing sites.**
   Edit `plan-issue.md`, `tdd-plan.md`, `build-plan.md`, and `retro.md` in one commit — they are one behavior at four sites, and splitting them leaves the skill half-reachable.
   Commit: `docs: load roadmap-fit at every issue-filing site (#767)`.
3. **Standardize the dispositions heading.**
   Edit `plan-improvements.md`'s Output item 1 and Step 2, and `improvement-discovery/SKILL.md`'s Output format.
   Commit: `docs: standardize the open-issue sweep dispositions heading (#767)`.
4. **Add the `/finish-phase` reconciliation.**
   Add `### Reconcile phase-born issues` inside Step 2, with the two commands, the grouped-bullet allowance, and the date fallback.
   Verify no `Step [0-9]` self-reference in the file broke.
   Commit: `docs: reconcile phase-born issues before archiving a phase (#767)`.
5. **Record the rule in `AGENTS.md`.**
   Commit: `docs: record the filing-time roadmap-fit gate in AGENTS.md (#767)`.

Each step ends with `pnpm exec rumdl check` on its touched files; step 5 ends with root `pnpm run lint`.

## Risks and Mitigations

| Risk                                                                                                                     | Mitigation                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The gate is a no-op until the next `/plan-improvements`, so nothing exercises it for weeks and a defect ships unnoticed. | The detection grep and the reconciliation command are both dry-run at build time against real data (today's tree and Phase 13's archived window), which is the only executable surface the change has.                             |
| An `ask_user` interruption mid-implementation breaks the Red→Green→Commit rhythm.                                        | The trigger is filing an issue, which happened four times across all of Phase 13; the directive also states that filing-and-continuing remains the local move, so the gate never pulls work into the current step.                 |
| A worktree peer session commits to the same package's `architecture.md` as the root, colliding on the land.              | Pre-existing hazard — step-completion commits already touch that file. The existing `AGENTS.md` guardrail (partition parallel work by package) covers it; the disposition commit is a separate, small commit that rebases cleanly. |
| The prompt edits look broken when re-run in the session that made them.                                                  | The `AGENTS.md` stale-prompt-expansion rule: the on-disk file is authoritative, and the implementing session must not verify its own prompt edit by re-invoking the command.                                                       |
| An agent picks "out of scope" reflexively to end the gate quickly.                                                       | The operator decides, not the agent; the agent's role is a proposal with a stated rationale, and the four options are presented every time.                                                                                        |
| The backstop's residual list (measured at 8 for Phase 13) makes phase close tedious.                                     | The grouped-bullet allowance mirrors the roadmap's existing convention for feature issues, and the whole set is presented in one pass.                                                                                             |

## Open Questions

- Should the gate eventually cover an issue filed with **no** `pkg:` label but born from a package's phase (this issue itself is one — it has no label and was born in a pi-permission-system retro)?
  Deferred until it recurs: the skill's fallback (use the package the session is working in) already covers the common case, and widening it invites labelling debates the tracker has not asked for.
- Should `/plan-improvements`'s sweep and this gate eventually share one disposition vocabulary document?
  They already share the four dispositions informally; a shared vocabulary is worth extracting only if a third consumer appears.

[#610]: https://github.com/gotgenes/pi-packages/issues/610
[#655]: https://github.com/gotgenes/pi-packages/issues/655
[#751]: https://github.com/gotgenes/pi-packages/issues/751
[#752]: https://github.com/gotgenes/pi-packages/issues/752
[#753]: https://github.com/gotgenes/pi-packages/issues/753
