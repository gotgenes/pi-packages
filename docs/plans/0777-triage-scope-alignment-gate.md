---
issue: 777
issue_title: "Add a scope-alignment gate to /triage-backlog before severity scoring"
---

# Add a scope-alignment gate to /triage-backlog before severity scoring

## Release Recommendation

**Release:** ship independently

No architecture roadmap references this issue, so there is no batch to join.
The only file this change touches is `.pi/prompts/triage-backlog.md`, which lies outside every component path in `release-please-config.json`, so the change cuts **no release at all**.
"Ship independently" here means land and close the issue; there is no release-please PR to wait on.

## Problem Statement

`/triage-backlog` scores every item on severity, likelihood, blast radius, and response cost.
All four measure how much an item matters *if we do it*.
None asks the prior question: do we want it at all?

That ordering fails exactly where it costs most.
A well-argued, high-severity, wide-blast-radius request for a capability a package deliberately does not offer ranks high and stays high, run after run, because the template has no way to express "declined on scope".
The failure is worse for a pull request than for an issue: by the time the question surfaces, the contributor's effort is sunk, and a clean diff with a green check creates real pressure to accept something that was never wanted.

The prerequisite is now in place.
[#775] landed a `## Scope and non-goals` section in all nine `packages/<pkg>/README.md` files — purpose, in-scope changes, non-goals with their rationale, and where an adjacent request belongs — and [#776] landed a `CONTRIBUTING.md` that tells a contributor to read it before filing.
The gate has something real to check against, so it no longer has to improvise a different boundary on each run.

## Goals

- Insert a scope-alignment gate as a new **Step 6**, ahead of scoring and after the verification steps, renumbering Score/Keystone/Interleave to Steps 7/8/9.
- Classify every item as `aligned`, `adjacent`, `out of scope`, or `no charter` before it is scored.
- Keep `out of scope` items out of the priority table entirely — they get a recommended disposition, not a severity rank.
- State that sunk contributor effort and a green check are not evidence of alignment, mirroring the template's existing "green CI is not safety" rule for security.
- Record every verdict in the output document so the next run inherits it instead of re-deriving it, with a bounded re-check trigger.
- Route genuinely unclear alignment through `ask_user`, bundled into the existing repeat-deferral call, and forbid inventing a charter to justify a decline.

This change is not breaking: it edits one prompt template, adds no code, and changes no config default.
The observable change is confined to `/triage-backlog`'s next run.

## Non-Goals

- **The same gate at the front of `/pr-review`.**
  Filed as [#783], which explicitly defers its vocabulary to whatever this issue lands so the two templates cannot disagree about what `adjacent` means.
- **Any new mutation.**
  Settled at the clarification gate: the verdict lives in the triage document only.
  No scope label is applied, no contributor comment is posted, and closing an out-of-scope item stays a recommendation — the template's existing "never merge or close" rule is unchanged.
- **A repo-level charter for charterless items.**
  Considered and declined at the gate: neither `CONTRIBUTING.md` nor `AGENTS.md` is written as a non-goal list, so a decline resting on them would be inference, which is the failure mode this gate exists to prevent.
- **Revising any package's charter.**
  If a dry-run verdict reveals a charter is wrong or silent, that is a README change under [#775]'s shape, filed separately — not something this gate patches at triage time.
- **Changing the four scoring axes.**
  Step 7 (formerly Step 6) is edited only to renumber it.
- **Rewriting the two existing `docs/triage/*.md` outputs.**
  The gate applies from the next run forward; the prior runs' rankings stand as the record they are.

## Background

### What the charter looks like today

All nine package READMEs carry the same four-part section.
`packages/pi-subagents/README.md` is representative, and its non-goals are the ones with live demand behind them:

> - *Widening a child's tool allowlist on the agent's behalf.*
>   An agent's `tools:` frontmatter is the complete allowlist and the only mechanism that widens it […]
> - *A global run-mode default.*
>   Foreground or background is a per-invocation argument and a per-agent frontmatter key; a global flip changes every existing agent file at once.

Those two bullets answer PR #740 ("background-by-default") and PR #613 ("add global background default") directly, by citation.
Both are currently live and both would rank on merit under today's template.

### What the template does today

`.pi/prompts/triage-backlog.md` is 245 lines and runs Steps 1–8: read prior artifacts, gather raw state, establish CI state, interpret failures, verify claims, score, detect keystones, interleave.
The insertion point the issue names — after Step 5, before scoring — is clean.
Every surviving cross-reference in the file points at Step 1, Step 3, or "Steps 4 and 5", all of which sit *above* the insertion, so renumbering 6→7, 7→8, 8→9 breaks nothing.

Two existing behaviors the gate must compose with rather than duplicate:

- Step 1 already carries four things forward from the prior triage (its Deferred list, Keystones, Blocked-on-others entries, and assigned ranks) and already treats a recorded PR-review direction as settled.
  The verdict inheritance is a fifth carried item, in the same spirit.
- Step 1 already routes repeat deferrals through a single bundled `ask_user` call.
  An unclear-alignment question joins that call rather than opening a second one.

### Sizing the charterless case

Measured against the current tracker (52 open issues):

| Case                       | Count | Items                                    |
| -------------------------- | ----- | ---------------------------------------- |
| No `pkg:` label            | 5     | #782, #781, #767, #777, #708             |
| More than one `pkg:` label | 7     | #762, #735, #722, #699, #660, #564, #519 |

So roughly one item in ten has no single charter to check against, and one in eight needs a per-package check.
The issue does not address either case; both are specified below.

### Applicable `AGENTS.md` constraints

- **Stale prompt-template expansion.**
  A slash command's body is a snapshot from process start, so a `/triage-backlog` invoked later in the same session that edits the template runs the pre-edit copy.
  The first real exercise of the gate must be a fresh session (Refs #586).
- **Workflow resequencing.**
  When a step reworks a documented step order, grep the edited file itself for other passages describing the same sequence — this template states its steps twice (the step headings and the Output section's cross-references), and both are covered in Module-Level Changes.
- **Markdown conventions** apply to the template file: one sentence per line, compact tables, fenced-code languages.

## Design Overview

### Decisions taken at the clarification gate

| Question           | Decision                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Charterless items  | Record a fourth verdict, `no charter`, then score normally — no scope call is made                                 |
| Verdict durability | Settled and inherited, unless the package's charter section or the item itself changed since the prior triage date |
| GitHub write-back  | Document only; disposition stays a recommendation                                                                  |

### The verdict vocabulary

| Verdict        | Meaning                                                           | Effect                                                              |
| -------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| `aligned`      | Inside the package's stated purpose and in-scope list             | Scored and ranked normally                                          |
| `adjacent`     | A real need, wrong package or wrong layer                         | Scored and ranked, with the owning package or extension point named |
| `out of scope` | Excluded by a specific, quoted non-goal                           | No severity rank; a recommended disposition instead                 |
| `no charter`   | No package owns it — repo tooling, a prompt template, CI, install | Scored and ranked normally; no scope call                           |

`adjacent` stays in the priority table, per the issue: a real need does not stop being real because it arrived at the wrong door, and the redirect is what the row's rationale carries.

### Rules that keep the gate honest

1. **Cite, never paraphrase a boundary into existence.**
   An `out of scope` verdict quotes the non-goal bullet it rests on.
   If no bullet covers the item, the verdict is not `out of scope`.
2. **Multi-package items need every charter to exclude them.**
   One charter that admits the item makes it `aligned` there.
3. **`no charter` is not a decline.**
   It records that the question does not apply, and the item is scored on the four axes as before.
4. **Weight the gate harder for a PR.**
   Sunk effort, a working implementation, and a green check are pressure, not evidence.
   An out-of-scope PR still needs a *timely answer*, so its disposition carries a response urgency even though it carries no severity rank.
5. **Ask rather than decide when alignment is unclear**, bundled into the Step 1 repeat-deferral `ask_user` call.

### Inheritance and re-check

A verdict recorded in a prior triage's `## Scope alignment` section is settled and carries forward.
It is re-derived only when one of the two sides it rests on changed since that triage's date — the charter, or the item:

```bash
git log --since=<prior triage date> --oneline -- packages/<pkg>/README.md
gh issue view <N> --json updatedAt,title,body
```

A charter edit reopens the verdicts that cite that package; a materially changed item body reopens its own verdict.
Nothing else is re-derived, and the re-check outcome is recorded as `unchanged` or as the new verdict with what changed.

### Worked draft of the new step

This is the text Build Order step 1 inserts, verbatim modulo wording polish (49 lines, within the 55-line budget set under Invariants):

````markdown
## Step 6: Check scope alignment before scoring

Severity, likelihood, blast radius, and response cost all measure how much an item matters *if we do it*.
None asks the prior question: do we want it at all?
Answer that first, or a well-argued request for a capability a package deliberately does not offer ranks high and stays high, run after run.

Read `## Scope and non-goals` in `packages/<pkg>/README.md` — only for the packages with items in scope, not all nine.
That section is the charter: purpose, in-scope changes, non-goals with their rationale, and where an adjacent request belongs.

Classify every item before it is scored:

| Verdict        | Meaning                                                           | Effect                                                              |
| -------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| `aligned`      | Inside the package's purpose and in-scope list                    | Scored and ranked normally                                          |
| `adjacent`     | A real need, wrong package or wrong layer                         | Scored and ranked; name the package or extension point that owns it |
| `out of scope` | Excluded by a specific non-goal                                   | No severity rank; a recommended disposition instead                 |
| `no charter`   | No package owns it — repo tooling, a prompt template, CI, install | Scored and ranked normally; no scope call                           |

Five rules keep the gate honest:

1. **Cite the non-goal; never paraphrase a boundary into existence.**
   An `out of scope` verdict quotes the bullet it rests on.
   If no bullet covers the item, the verdict is `aligned`, `adjacent`, or a question for the user — never `out of scope`.
   Do not invent a charter to justify a decline.
2. **An item labeled for several packages is out of scope only if every named charter excludes it.**
   One charter that admits it makes it `aligned` there.
3. **`no charter` is not a decline.**
   It records that the question does not apply — the item is scored on the four axes exactly as before.
4. **Weight the gate harder for a PR than for an issue.**
   An issue proposes; a PR arrives with sunk contributor effort, a working implementation, and often a green check.
   That pressure is real, and it is not evidence of alignment — green CI has no opinion about scope, for the same reason it has none about security.
   An out-of-scope PR still needs a timely answer, so give its disposition a response urgency even though it gets no severity rank.
5. **When alignment is genuinely unclear, ask rather than decide.**
   Bundle the question into the same `ask_user` call as the Step 1 repeat deferrals; do not open a second round-trip.

A verdict recorded in a prior triage's **Scope alignment** section is settled — inherit it rather than re-deriving it.
Re-check only when one of the two sides it rests on changed since that triage's date:

```bash
git log --since=<prior triage date> --oneline -- packages/<pkg>/README.md
gh issue view <N> --json updatedAt,title,body
```

A charter edit reopens the verdicts citing that package; a materially changed item reopens its own.
Record each re-check as `unchanged` or as the new verdict with what changed.

The verdict is a document entry, not a mutation.
Closing an out-of-scope item, labeling it, and replying to its author all remain recommendations — see Mutations you may perform.
````

### Output-document changes

`## Scope alignment` becomes item 2 of the output, immediately before the prioritized table, because it explains what the table omits.
Worked example, at the size a real run produces:

````markdown
## Scope alignment

Checked against each package's `## Scope and non-goals`.
The priority table below carries only `aligned`, `adjacent`, and `no charter` items.

| Item | Package              | Verdict      | Basis                                                                            |
| ---- | -------------------- | ------------ | -------------------------------------------------------------------------------- |
| #740 | pi-subagents         | out of scope | Non-goal: _A global run-mode default_ — run mode is per-invocation and per-agent |
| #613 | pi-subagents         | out of scope | Same non-goal; a second implementation of the same request                       |
| #684 | pi-permission-system | adjacent     | Real need, undecided layer; belongs to the #639 policy-source decision           |
| #777 | (repo tooling)       | no charter   | Prompt template; no package charter applies                                      |

### Recommended dispositions

- **#740, #613** — close as not-planned, quoting the `pi-subagents` non-goal.
  Both are third-party PRs with sunk effort, so answer them this week; the urgency is to reply, not to merge.

### Carried forward

| Item | Verdict      | Recorded   | Re-checked                         |
| ---- | ------------ | ---------- | ---------------------------------- |
| #612 | out of scope | 2026-08-19 | Unchanged; charter untouched since |
````

### Rejected alternatives

- **A repo-level charter for `no charter` items** — declined at the gate; see Non-Goals.
- **An `out_of_scope:` count in the output frontmatter** — the verdicts themselves are what the next run inherits; a count is decoration, and the frontmatter stays as it is.
- **Re-deriving verdicts each run with the prior one as a seed** — that is the re-litigation the issue exists to stop.
- **Editing Step 4's "green CI is not safety" paragraph to cover scope** — the reasoning belongs with the gate that uses it; Step 4 gets a one-sentence pointer instead.

## Module-Level Changes

Single file: `.pi/prompts/triage-backlog.md` (245 lines today, ~300 after).

| Edit | Location                                     | Change                                                                                                                                                                                                                           |
| ---- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | After Step 5 (line ~147)                     | Insert `## Step 6: Check scope alignment before scoring` (the worked draft above)                                                                                                                                                |
| B    | Lines 149, 165, 178                          | Renumber `Step 6: Score each item` → 7, `Step 7: Keystone detection` → 8, `Step 8: Interleave` → 9                                                                                                                               |
| C    | Step 1 carry-forward list (line ~48)         | Add the prior run's scope verdicts as a fifth carried item, with the re-check trigger                                                                                                                                            |
| D    | Step 4, "Green CI is not safety" (line ~131) | One sentence: a passing check is no evidence of scope either — see Step 6                                                                                                                                                        |
| E    | Mutations you may perform (line ~197)        | Name a scope decline explicitly among the recommendation-only outcomes; no label, no comment, no close                                                                                                                           |
| F    | Output section (lines ~216–235)              | Insert `Scope alignment` as item 2; renumber items 2–7 to 3–8; note in the table item that it carries only `aligned`/`adjacent`/`no charter`, and in the Deferred item that out-of-scope items belong to the new section instead |

Grep evidence for the ripple:

- `rg -n 'Step [0-9]' .pi/prompts/triage-backlog.md` — the only cross-references are to Step 1, Step 3, and "Steps 4 and 5"; all sit above the insertion point and are unaffected by edit B.
- `rg -l 'triage-backlog'` across the repo matches only `docs/plans/0775-package-scope-and-non-goals.md` and `docs/plans/0775-evidence/pi-session-tools.md`, both of which name the command, not its step order.
  No skill, no `AGENTS.md` section, and no README describes this template's steps.
- The two historical outputs under `docs/triage/` are records of past runs and are not edited.

## Test Impact Analysis

No code changes, so no unit tests.
The template's behavior is exercised by running it, which is expensive, so the plan substitutes a bounded dry run (Build Order step 3): classify six named backlog items by hand against the shipped charters and check the verdicts against what is already known to be true.

| Item   | Expected verdict   | Why this case is the test                                                                                                                       |
| ------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| #740   | out of scope       | A non-goal covers it verbatim — the gate must fire                                                                                              |
| #613   | out of scope       | Second instance of the same request; both must cite the same bullet                                                                             |
| #692   | not out of scope   | [#775]'s retro records that the policy-source channel was deliberately left undecided ([#639]); a decline here would be a manufactured boundary |
| #675   | not out of scope   | Same undecided channel, different implementation                                                                                                |
| #519   | aligned or unclear | Multi-package labels; exercises rule 2                                                                                                          |
| #777   | no charter         | No `pkg:` label; exercises the fourth verdict                                                                                                   |

The two `not out of scope` rows are the load-bearing ones.
A gate that declines them is over-firing, and the fix is the gate's wording — never a charter edit made to justify a verdict.

## Invariants at risk

- **Every step reference resolves.**
  Verify after edit B with `rg -n 'Step [0-9]|Steps [0-9]' .pi/prompts/triage-backlog.md` and read each hit in context.
- **The template still never merges or closes.**
  Edit E must read as a narrowing clarification of the existing rule, not as a new permission.
- **One `ask_user` round-trip.**
  Step 1's "bundle them into a single call" rule survives; the unclear-alignment question joins that call rather than forking a second one.
- **Prompt length stays workable.**
  Measured baseline: 245 lines.
  Budget: the new step ≤ 55 lines, all other edits ≤ 15 lines combined, so ≤ 315 lines after.
  Check with `wc -l`.
- **The four scoring axes are unchanged.**
  `git diff` on the renumbered Step 7 must show only the heading line.

## Build Order

1. **Insert the gate and renumber.**
   Apply edits A and B. Verify: `rg -n 'Step [0-9]'` shows Steps 1–9 in order with no dangling reference; `git diff` on the Score step shows only its heading changed.
   Commit: `docs: add a scope-alignment gate to /triage-backlog (#777)`.
2. **Wire the gate into the surrounding template.**
   Apply edits C, D, E, and F. Verify: the Output section lists eight items in order, the Deferred item points out-of-scope entries at the new section, and the Mutations rule still forbids closing.
   Commit: `docs: carry scope verdicts forward and report them in /triage-backlog output (#777)`.
3. **Dry-run the gate over the six items in Test Impact Analysis.**
   Read each item and the relevant charter, write the verdict, and compare against the expected column.
   Any mismatch is a wording defect in the gate — fix the gate text and fold the fix into a `docs:` commit; do not adjust a charter to make a verdict come out.
   Record the six verdicts in the retro's implementation stage note, so the first real run inherits them.
4. **Lint and finish.**
   `pnpm exec rumdl check .pi/prompts/triage-backlog.md` and `wc -l` against the 315-line budget.

## Risks and Mitigations

| Risk                                                                       | Mitigation                                                                                                 |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| The gate manufactures boundaries and over-declines                         | Rule 1 requires a quoted non-goal; the dry run includes two items ([#692], [#675]) that must *not* decline |
| The gate is skipped in practice because reading nine charters is expensive | The step reads charters only for packages with items in scope — typically two or three                     |
| Renumbering leaves a dangling step reference                               | Grep verification in Build Order step 1, over a file whose only references sit above the insertion         |
| An inherited verdict goes stale after a charter revision                   | The re-check trigger keys on `git log` over the README since the prior triage's date                       |
| The first run after this lands uses the pre-edit template                  | Run the next `/triage-backlog` in a fresh session (Refs #586)                                              |
| The step grows past its budget in review                                   | 55-line budget stated as an invariant and checked with `wc -l`                                             |

## Open Questions

- Whether `/pr-review`'s gate ([#783]) should reuse this vocabulary verbatim or specialize `adjacent` for a PR that must also be answered to its author.
  Deferred to that issue, which already defers its vocabulary here.
- Whether a package charter that produces a `no charter`-adjacent surprise — an item that plainly belongs to a package whose non-goals are silent about it — should trigger a charter revision issue automatically.
  Left to judgment for now; the dry run will show whether this is common enough to systematize.

[#639]: https://github.com/gotgenes/pi-packages/issues/639
[#675]: https://github.com/gotgenes/pi-packages/issues/675
[#692]: https://github.com/gotgenes/pi-packages/issues/692
[#775]: https://github.com/gotgenes/pi-packages/issues/775
[#776]: https://github.com/gotgenes/pi-packages/issues/776
[#783]: https://github.com/gotgenes/pi-packages/issues/783
