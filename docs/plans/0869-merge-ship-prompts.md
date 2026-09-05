---
issue: 869
issue_title: "Ship prompts: /ship-worktree and /ship-issue step 5 have diverged, losing rules on the worktree path"
---

# Merge `/ship-issue` and `/ship-worktree` into a single `/ship`

## Release Recommendation

**Release:** ship independently

This is repo-root tooling — `.pi/prompts/`, `.pi/skills/`, `.pi/agents/`, `AGENTS.md`, `README.md`, and a comment in `.github/workflows/release.yml`.
No file under `packages/` is touched, so no package has a releasable commit and nothing will actually release.
The marker is written anyway because the shipping prompt reads it before any irreversible work, and its absence is itself reported.
The issue belongs to no package improvement roadmap, so there is no batch to join.

## Problem Statement

`/ship-issue` (trunk) and `/ship-worktree` (root half of the parallel-worktree flow) perform the same job once the work is on `main`: verify CI, build a close comment from the shipped commit range, close the issue and any co-shipped targets, and dispatch the release.
Their bodies were written independently and have drifted.
Shipping [#849] lost two rules to that gap in a single session — a fabricated commit SHA published to a closed issue, and an adopted third-party PR left open after its diagnosis shipped under the author's `Co-authored-by` credit.

Both instances were patched into `/ship-worktree` at the [#849] retrospective, which fixes the instances and not the class.
Every hard-won rule added to one prompt from here on has to be ported to the other by hand, and nothing detects a missed port.

The measured drift is larger than the two instances and runs in **both** directions — the worktree file is not a subset of the trunk one.

## Goals

- One source of truth for every shipping step, so a rule added once applies to every ship path.
- Fold the two prompts into a single `/ship <N>` that detects its lane from the presence of an `issue-<N>-*` branch.
- Apply the full union of the two rule sets: each path gains every rule the other carried.
- Update the developer-flow documentation in `README.md` and `AGENTS.md` — diagrams, stage tables, and prose — not just the command strings.
- Close the gap where the rebased branch tip is never linted, by running the pre-push checks after the land in both lanes.

This change is not breaking in the semver sense: it ships no package code and alters no published contract.
It **is** a workflow-breaking change for the operator — `/ship-issue` and `/ship-worktree` stop existing.

## Non-Goals

- Rewriting `/sync-worktree`.
  It stays the peer half, unchanged apart from renaming the command it hands off to.
  Its internal ordering — pre-push checks at its step 2, rebase at its step 4 — is deliberately left alone; the merged `/ship` covers the resulting gap from the other side (see Design Overview).
- Folding `/ship-no-issue` into `/ship` as a third lane.
  It stays a separate command; only its CI-verification and release-dispatch steps are re-pointed at `/ship`'s text (operator decision).
- Deduplicating `/ship-no-issue`'s sync, pre-push, and push steps.
  They are 24 lines that currently match `/ship-issue`'s exactly, and the operator scoped the re-pointing to CI and release.
  They remain a duplicate that can drift.
- Rewriting historical artifacts.
  `docs/retro/`, `docs/plans/`, `docs/triage/`, `docs/architecture/history/`, and the package CHANGELOGs keep naming `/ship-issue` and `/ship-worktree`; they describe what happened, and rewriting them would falsify the record.
- Tightening `grep -F '**Release:**'` to match only the canonical marker line.
  It matches three lines in plan `0843` (the marker plus two prose mentions), which the reading agent disambiguates against the three canonical forms.
  Recorded in Risks rather than changed.
- Any change to `scripts/worktree-*.sh` or `.pi/extensions/worktree.ts`.
  Neither names a ship command.

## Background

### The three ship prompts today

| Section                   | `/ship-issue` | `/ship-worktree` | `/ship-no-issue` |
| ------------------------- | ------------- | ---------------- | ---------------- |
| Verify CI                 | 11            | 10               | 8                |
| Stacked-release pre-check | 26            | —                | —                |
| Close the issue           | 43            | 29               | —                |
| Release dispatch + verify | 27 + 12       | 33               | 19               |
| Whole file                | 196           | 174              | 72               |

`/ship-worktree` declares `model: anthropic/claude-sonnet-5` (pinned by [#843]); `/ship-issue` and `/ship-no-issue` declare no `model:` and inherit the session model.
`/ship-no-issue` has zero references anywhere outside its own file.

### Both prompts already run at the root on `main`

This is what makes the merge cheap.
`/ship-worktree` step 1 confirms the **root** checkout on `main`; `/ship-issue` step 0 confirms `main`.
The only structural differences are:

1. Whether a peer branch exists to fast-forward-merge before pushing.
2. Whether the plan and retro are reachable on `main` yet, or only on the branch.
3. Whether a worktree needs tearing down afterwards.
4. Whether the peer already ran the pre-push checks.

Everything after the push — CI verification, the close comment, the release dispatch — is the same job with the same inputs.

### Prompt-template frontmatter semantics

Verified against the installed `pi-prompt-template-model` v0.12.2 (`model-selection.ts:117-137`, `index.ts:638-640`):

- `model:` accepts a comma-separated list.
- If the session's current model matches **any** spec in the list, it stays put — no switch occurs.
- Only when the current model is outside the list does resolution walk the list in order, taking the first with usable auth.
- If none resolves, the prompt **aborts** with `No available model from: …`; it does not silently inherit the session model.

Plan `0843` line 132 asserted the opposite ("a `model:` value absent from the registry does not error: it falls back silently to the session model").
That claim is wrong for prompt templates.
The silent-fallback rule `AGENTS.md` records is about `.pi/agents/*.md` subagent frontmatter, which is a different resolver.

The extension's `skill:` frontmatter key — which injects a skill body verbatim before the turn — was evaluated as the sharing mechanism and rejected: it is an extension feature, not Pi core, and an ignored `skill:` would silently drop the shared step.

### Constraints from `AGENTS.md`

- A running Pi session keeps the prompt bodies it loaded at startup, so this change is invisible to the session that makes it (§ Stale prompt-template expansion).
  The first `/ship` must run in a fresh session.
- Do not put `Closes #N` in commit messages; reference as `(#869)` or `Refs #869`.
- `rumdl` caches per markdown file, but `MD057` depends on the filesystem — clear `.rumdl_cache` after a commit that deletes files.

## Design Overview

### Lane detection

`/ship` takes `$1` (an issue number, or an adopted third-party PR number) and derives its lane from the branch list:

```bash
git branch --list "issue-$1-*"
```

- Exactly one match → **worktree lane**.
- Zero matches → **trunk lane**.
- More than one match → stop and report.

This is the same command `/ship-worktree` step 2.1 already runs, moved earlier and given a zero-match meaning.
Dry-run at planning time: `git branch --list 'issue-869-*'` prints nothing, and no `issue-*` branch exists in this checkout, so this session's own ship would take the trunk lane.

### Step order

| §   | Step                                                                                | Lane          |
| --- | ----------------------------------------------------------------------------------- | ------------- |
| 0   | Confirm you are at the root on `main`                                               | both          |
| 1   | Detect the lane; set the session name                                               | both          |
| 2   | Release coordination — read the plan and the retro, ask only on `mid-batch — defer` | both          |
| 3   | Sync `main`                                                                         | both          |
| 4   | Land the work — predict, then `git merge --ff-only <branch>`                        | worktree only |
| 5   | Pre-push checks                                                                     | both          |
| 6   | Push                                                                                | both          |
| 7   | Verify CI on the pushed commit                                                      | both          |
| 8   | Check for a stacked release                                                         | both          |
| 9   | Close the issue                                                                     | both          |
| 10  | Dispatch the release                                                                | both          |
| 11  | Verify the release run                                                              | both          |
| 12  | Tear down the worktree                                                              | worktree only |
| 13  | Final report                                                                        | both          |

The order resolves the two prompts' only real sequencing difference.
`/ship-issue` runs its pre-push checks before the push with nothing to merge; `/ship-worktree` ff-merges and pushes without running them at all.
Putting § 5 after § 4 means the checks always run against the tree that is about to be pushed, in both lanes.

### The pre-push-check gap this closes

`/sync-worktree` runs `pnpm run lint` and `pnpm fallow dead-code` at its step 2, then rebases at its step 4.
The rebased tip that `/ship-worktree` fast-forward-merges has therefore never been checked — a rebase onto a moved `main` can produce a tree neither side tested.
Running the checks at § 5, after the ff-merge, covers exactly that tree.

Measured at the repo root on this commit: `pnpm run lint` 24.9 s, `pnpm fallow dead-code` 0.6 s.
The added cost to a worktree ship is about 26 s, against a CI run that gates the same two checks anyway.

### The union

Every asymmetric rule is adopted by the merged prompt.
The two rules that read as path-specific are harmless on the other path — `git merge-base --is-ancestor <sha> main` is trivially true for a SHA read out of `git log` on `main`, and a trunk retro carries planning and TDD stage notes that can name a close target just as a sync note can.

| Rule                                                                                          | Carried today by | Destination        |
| --------------------------------------------------------------------------------------------- | ---------------- | ------------------ |
| `$1` may be an adopted PR (`gh api … .pull_request != null`)                                  | `/ship-issue`    | § 9                |
| Never hand-expand a short SHA from the push output                                            | `/ship-issue`    | § 7                |
| `ci_find` timeout → re-check the SHA before assuming a timing miss ([#640])                   | `/ship-issue`    | § 7                |
| Mention issues the change unblocks or partially addresses                                     | `/ship-issue`    | § 9                |
| Deferred release → say the fix is on `main`, cite no version                                  | `/ship-issue`    | § 9                |
| `refactor:` commits leave no changelog reminder for a co-shipped issue                        | `/ship-issue`    | § 9                |
| Co-shipped signal includes a sibling `docs/plans/` file, not only `docs/retro/`               | `/ship-issue`    | § 9                |
| A mid-batch sibling that shipped on its own is already closed                                 | `/ship-issue`    | § 9                |
| Empty package list (repo tooling) → nothing releases                                          | `/ship-issue`    | § 10               |
| A dispatched run's `head_sha` is `main`'s tip; a `ci_find` timeout means the SHA guard failed | `/ship-issue`    | § 11               |
| Stacked-release pre-check with `next-version.sh` before closing                               | `/ship-issue`    | § 8                |
| A SHA quoted from a plan or stage note may be unreachable after the rebase ([#814])           | `/ship-worktree` | § 9                |
| Read the retro's stage notes for ship-time close targets ([#849])                             | `/ship-worktree` | § 2 and § 9        |
| Do not measure a `git rev-parse` SHA's shape with `wc -c` ([#839])                            | `/ship-worktree` | § 7                |
| A CI failure the landed change caused is fixed forward; never revert the ff-merge             | `/ship-worktree` | § 7, worktree lane |

What stays genuinely lane-conditional: the § 0 mis-invocation message, § 1 itself, § 4, the fix-forward rule in § 7, § 12, the plan/retro location in § 2, and the session-name suffix.

### Reading the plan and retro in § 2

The lane decides where the artifacts live.

Trunk lane — both are on `main`:

```bash
grep -rl "^issue: $1$" docs/plans packages/*/docs/plans
```

Worktree lane — the plan does not reach `main` until § 4, so read it off the branch:

```bash
BRANCH=$(git branch --list "issue-$1-*" | tr -d ' +*')
git grep -l "^issue: $1$" "$BRANCH" -- 'docs/plans/*' 'packages/*/docs/plans/*'
```

In both lanes, § 2 also reads the matching `docs/retro/NNNN-*.md` in full.
This is the [#849] countermeasure generalized: the close targets a plan records are invisible to a step that only greps the plan for `**Release:**`.

### Session naming

The session name keeps its lane distinction, because the session selector benefits from it:

- Trunk lane → `#N Ship — <title>`.
- Worktree lane → `#N Ship (worktree) — <title>`.

`set_session_name` therefore moves from § 0 to § 1, after the lane is known.

### Model frontmatter

```yaml
model: anthropic/claude-sonnet-5, opencode-go/deepseek-v4-flash
```

Per the semantics verified above: a session already on either model stays put; any other session switches to `claude-sonnet-5`; if `claude-sonnet-5` has no usable auth, `deepseek-v4-flash` is used; if neither resolves, the command aborts loudly rather than running the ship on an unintended model.
Both ids are present in the operator's `enabledModels`.

### `/ship-no-issue`

It stays a separate command with its own skeleton.
Its step 4 (verify CI) and step 5 (dispatch the release) are replaced by a pointer to the corresponding section of `.pi/prompts/ship.md`, plus the one rule that is genuinely its own: with no issue plan to name the packages, it shows the operator the releasable set and asks which to release.

## Module-Level Changes

### `.pi/prompts/ship.md` — new

The merged prompt, written from the union above.
Frontmatter: `model: anthropic/claude-sonnet-5, opencode-go/deepseek-v4-flash` and a `description:` covering both lanes.
Sections § 0–§ 13 plus `## Constraints`, the latter being the union of both files' constraint lists (never force-push; never merge non-linearly into `main`; CI failure keeps the issue open; never name a package `next-version.sh` reports nothing for; never re-dispatch after `prepare` succeeded; peers never dispatch a release).

### `.pi/prompts/ship-issue.md` — deleted

### `.pi/prompts/ship-worktree.md` — deleted

### `.pi/prompts/ship-no-issue.md` — changed

Step 4 and step 5 re-pointed at `.pi/prompts/ship.md`'s corresponding sections, keeping the ask-which-packages rule inline.

### `.pi/prompts/sync-worktree.md` — changed

Eight references, at lines 12, 13, 20, 35, 70, 86, 87, and 94.
Lines 13 and 20 currently send trunk work to `/ship-issue`; with one command they become "run `/ship $1` from the root instead".
The rest rename `/ship-worktree $1` to `/ship $1`.

### `.pi/prompts/tdd-plan.md` and `.pi/prompts/build-plan.md` — changed

One line each (`tdd-plan.md:213`, `build-plan.md:171`): "The next step is `/ship-issue` on trunk, or `/sync-worktree <N>` … on a branch" becomes a single `/ship <N>` on trunk, `/sync-worktree <N>` then `/ship <N>` on a branch.

### `.pi/prompts/plan-issue.md` — changed

Line 156: the `**Release:**` marker's reader is `/ship`.

### `.pi/skills/pre-completion/SKILL.md` — changed

Three references: the frontmatter `description` (line 6) and lines 69 and 75.

### `.pi/agents/pre-completion-reviewer.md` — changed

Two references: the frontmatter `description` (line 2) and the `PASS — ready for /ship-issue` output line (line 295).
The second is inside the report template the agent emits, so it changes what a future review prints.

### `.pi/skills/improvement-discovery/SKILL.md` — changed

Line 211.

### `.pi/skills/package-pi-permission-system/SKILL.md` — changed

Line 21.

### `.github/workflows/release.yml` — changed

The comment at line 7 naming both dispatchers.

### `AGENTS.md` — changed

Twelve references at lines 165, 170, 171, 208, 209, 222, 291, 296, 300, 308, 309, and 483.
Beyond the renames, three passages are rewritten rather than substituted:

- Lines 291 and 308 assert that the trunk prompt is trunk-only and breaks on a worktree branch — the premise of the split.
  They become the lane description.
- Line 296's numbered convergence flow (`/ship-worktree <N>`: ff-merge, push, CI, close, release) collapses into `/ship <N>`.
- The session-naming table (lines 321–330) keeps both `Shipping` and `Worktree ship (root)` rows, with a note that both names come from `/ship` and are chosen by lane.

### `README.md` — changed

Nine references, and the developer-flow documentation around them:

- Line 109 — the `.pi/prompts/` bullet's example command list.
- Lines 128–129 — the standard-workflow `flowchart LR`: both `TDD -->` and `Build -->` point at a `Ship["/ship-issue #N"]` node.
- Line 139 — stage table row 4.
- Line 153 — the prose explaining why shipping is split ("the trunk `/ship-issue` assumes a single writer"), which must now explain the lane instead of the split.
- Line 172 — the parallel-workflow `flowchart TB` node `Ship["Root — /ship-worktree N<br/>ff-merge, push, CI, close, release, teardown"]`.
- Line 190 — the `sequenceDiagram` handoff line.
- Line 204 — the worktree stage table's Ship row.
- Line 211 — the "whoever lands second rebases first" guardrail.

One adjacent correction in the same diagram: the sequence diagram shows the peer running `git rebase origin/main`, but `/sync-worktree` step 4.2 rebases onto **local** `main` ("the ref `/ship-worktree` will merge into"), a distinction [#813] and [#815] established.
The diagram is rewritten anyway; leaving a known-false step in it would be worse than the small scope addition.

### Files deliberately not changed

`docs/retro/`, `docs/plans/`, `docs/triage/`, `docs/architecture/history/`, package CHANGELOGs, `scripts/`, `.pi/extensions/worktree.ts`.
The first four are historical record; the last two name no ship command (verified by grep).

## Test Impact Analysis

There are no tests to write — this change touches no `src/` or `test/` file, and no package at all.
Its testable surface is the set of shell commands the new prompt prescribes.
Each was dry-run at planning time:

| Command                                                    | Expected                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `git branch --list 'issue-869-*'`                          | empty → trunk lane (verified)                                                 |
| `git merge-base --is-ancestor HEAD~1 main && echo ff-ok`   | `ff-ok` (verified)                                                            |
| `grep -rl "^issue: 843$" docs/plans packages/*/docs/plans` | `docs/plans/0843-worktree-ship-flow-command-names.md` (verified)              |
| `grep -F '**Release:**' docs/plans/0843-*.md`              | 3 lines, the first being the canonical marker (verified)                      |
| `git log --format='%H %s' --grep="docs: plan .*(#843)" -1` | `29544151 docs: plan the worktree ship-flow command rename (#843)` (verified) |
| `git rev-list --count origin/main..main`                   | `0` (verified)                                                                |
| `pnpm run lint`                                            | clean, 24.9 s (measured)                                                      |
| `pnpm fallow dead-code`                                    | clean, 0.6 s (measured)                                                       |

Post-change verification greps, each of which must return zero hits outside the historical directories:

```bash
grep -rn "ship-issue\|ship-worktree" --exclude-dir=node_modules --exclude-dir=.git \
  --exclude-dir=retro --exclude-dir=plans --exclude-dir=triage --exclude-dir=archive \
  --exclude=CHANGELOG.md . | grep -v '\.pi/npm/'
```

Baseline for that command today: 40 hits across 11 files (`AGENTS.md` 12, `README.md` 9, `sync-worktree.md` 8, `pre-completion/SKILL.md` 3, `ship-issue.md` 3 self-references, `pre-completion-reviewer.md` 2, and one each in `improvement-discovery`, `package-pi-permission-system`, `tdd-plan.md`, `build-plan.md`, `plan-issue.md`, `release.yml`).
Target afterwards: 0.

Two more checks:

- `grep -c '^model:' .pi/prompts/ship.md` returns `1`, and the value is `anthropic/claude-sonnet-5, opencode-go/deepseek-v4-flash`.
- `pnpm exec rumdl check .pi/prompts/ README.md AGENTS.md` is clean, after `find .rumdl_cache -type f -delete` — this change deletes two files that other documents link to by name, and `MD057` is cached per file.

## Invariants at risk

The merged prompt must not lose any rule either source carried.
The union table in Design Overview is the checklist; the build order's final step re-derives it against the deleted files' content rather than against the table, so a rule the table itself missed is still caught.

| Invariant                                                                    | Origin                 | How it stays pinned                              |
| ---------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------ |
| Release coordination happens before any irreversible work                    | [#829], both prompts   | § 2 precedes § 3–§ 6 in the step-order table     |
| The issue always closes, regardless of the release decision                  | `/ship-issue` § 4b     | § 8 states it explicitly; § 9 is unconditional   |
| The root never merges non-linearly into `main`                               | [#813]                 | § 4's prediction step and the `Constraints` list |
| A peer never dispatches a release                                            | worktree flow          | `Constraints` list                               |
| Every published SHA is resolved before drafting and re-resolved in the draft | [#704], [#777], [#788] | § 7 and § 9                                      |
| The `**Release:**` marker is read from a deterministic source, not inferred  | `/plan-issue` contract | § 2                                              |
| `/sync-worktree` remains the peer's only entry point                         | [#843]                 | Its own file, renamed hand-off targets only      |

The [#843] model pin is deliberately superseded, not preserved: `/ship-worktree`'s sole-model `anthropic/claude-sonnet-5` becomes a two-model acceptable set.
This is an operator decision recorded in this session, not a regression.

## Build Order

Each step is a `docs:` commit; there are no test cycles.

1. **Write the merged prompt.**
   Create `.pi/prompts/ship.md` with the frontmatter, § 0–§ 13, and the union `Constraints` list, working from both source files open side by side.
   Do not delete anything yet — the sources are the reference.
   Verify: `grep -c '^model:' .pi/prompts/ship.md` is `1`; every row of the Design Overview union table has a corresponding passage in the new file; `pnpm exec rumdl check .pi/prompts/ship.md` is clean.
   Commit: `docs: add a single /ship prompt covering trunk and worktree lanes (#869)`.

2. **Delete the two source prompts.**
   Remove `.pi/prompts/ship-issue.md` and `.pi/prompts/ship-worktree.md`.
   Kept as a separate commit from step 1 so the merge is reviewable as an addition and the deletion is reviewable as a deletion.
   Verify: both files gone; `git show HEAD~1:.pi/prompts/ship-issue.md` still retrievable for step 8's audit.
   Commit: `docs: remove /ship-issue and /ship-worktree in favor of /ship (#869)`.

3. **Re-point `/ship-no-issue`.**
   Replace its step 4 and step 5 bodies with pointers to `.pi/prompts/ship.md`'s CI-verification and release-dispatch sections, keeping the ask-which-packages rule inline.
   Verify: the file names no deleted prompt; `pnpm exec rumdl check .pi/prompts/ship-no-issue.md` is clean.
   Commit: `docs: point /ship-no-issue at /ship's CI and release steps (#869)`.

4. **Update the sibling prompts.**
   `sync-worktree.md` (8 references, including the two that route trunk work), `tdd-plan.md:213`, `build-plan.md:171`, `plan-issue.md:156`.
   Verify: `grep -rn "ship-issue\|ship-worktree" .pi/prompts/` returns nothing.
   Commit: `docs: point the sibling prompts at /ship (#869)`.

5. **Update the skills and the reviewer agent.**
   `pre-completion/SKILL.md` (3, one in frontmatter), `pre-completion-reviewer.md` (2, one in frontmatter and one in the emitted report template), `improvement-discovery/SKILL.md:211`, `package-pi-permission-system/SKILL.md:21`.
   Verify: `grep -rn "ship-issue\|ship-worktree" .pi/skills/ .pi/agents/` returns nothing.
   Commit: `docs: point the skills and reviewer agent at /ship (#869)`.

6. **Update `AGENTS.md`.**
   Twelve references, of which lines 291, 296, and 308 are rewritten passages rather than substitutions, plus the session-naming table note.
   Verify: `grep -rn "ship-issue\|ship-worktree" AGENTS.md` returns nothing; the multi-session lifecycle list and the worktree convergence list both describe one ship command.
   Commit: `docs: describe the single /ship command in AGENTS.md (#869)`.

7. **Update `README.md`, including the diagrams.**
   The bullet at 109, the `flowchart LR` nodes at 128–129, the stage table row at 139, the prose at 153, the `flowchart TB` node at 172, the `sequenceDiagram` at 190 (including the `origin/main` → local `main` correction), the worktree stage table at 204, and the guardrail at 211.
   Load the `mermaid` skill before editing the three diagrams.
   Verify: `grep -rn "ship-issue\|ship-worktree" README.md` returns nothing; each diagram renders; `pnpm exec rumdl check README.md` is clean.
   Commit: `docs: update the developer-flow diagrams and tables for /ship (#869)`.

8. **Audit the union against the deleted files.**
   Recover both deleted prompts (`git show <step-2-commit>~1:.pi/prompts/ship-issue.md` and `…ship-worktree.md`) and read each against `.pi/prompts/ship.md`, rule by rule, rather than against this plan's union table.
   The table was derived by hand and is the thing most likely to have missed a row.
   Fix any omission found, then clear the `rumdl` cache (`find .rumdl_cache -type f -delete`) and run the full verification set from Test Impact Analysis.
   Verify: the repo-wide grep returns 0 hits outside historical directories; `pnpm run lint` is clean.
   Commit: `docs: restore rules the /ship merge dropped (#869)` — or, if the audit finds nothing, fold the cache clear and verification into step 7 and record the clean audit in the stage notes.

## Risks and Mitigations

| Risk                                                                                                 | Mitigation                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The merge silently drops a rule — the exact failure this issue is about                              | Step 8 audits the new file against the recovered originals, not against this plan's table                                                                                       |
| The lane is mis-detected because a stale `issue-<N>-*` branch survives an earlier ship               | § 4 predicts the ff-merge with `git merge-base --is-ancestor` before running it, and a non-fast-forward stops the ship rather than merging                                      |
| Work committed on `main` while an abandoned branch for the same issue exists takes the worktree lane | The § 4 prediction fails, the prompt stops and names the divergent commits; the operator deletes the stale branch and re-runs                                                   |
| The first `/ship` runs in a session that still has the old prompts registered                        | `AGENTS.md` § Stale prompt-template expansion already covers it; the stage notes will name the restart requirement explicitly                                                   |
| `grep -F '**Release:**'` matches prose lines as well as the marker                                   | Verified: 3 matches in plan `0843`, the first being the canonical marker. The prompt already tells the reader to match one of three canonical forms. Left unchanged (Non-Goals) |
| `MD057` passes from cache while a deleted file is still linked                                       | Step 8 clears `.rumdl_cache` before the final lint                                                                                                                              |
| The two-model list surprises the operator by not switching                                           | Documented in Design Overview: a list is an acceptable set, and a session already on `deepseek-v4-flash` stays there                                                            |
| Losing `/ship-issue` breaks operator muscle memory                                                   | Accepted (operator decision to delete rather than stub); Pi's fuzzy autocomplete surfaces `/ship` from the `ship` prefix                                                        |

## Open Questions

None blocking.

One observation surfaced during planning and is deliberately not acted on here: `/sync-worktree` runs its pre-push checks before its rebase, so the tip it hands off has never been checked.
This plan covers that from the root side by running the checks after the land, which is sufficient — the peer's own run still catches problems earlier and cheaper.
Reordering `/sync-worktree` would make the peer's run redundant with the root's without removing either.
No follow-up issue is filed, because the gap is closed rather than deferred.

[#640]: https://github.com/gotgenes/pi-packages/issues/640
[#704]: https://github.com/gotgenes/pi-packages/issues/704
[#777]: https://github.com/gotgenes/pi-packages/issues/777
[#788]: https://github.com/gotgenes/pi-packages/issues/788
[#813]: https://github.com/gotgenes/pi-packages/issues/813
[#814]: https://github.com/gotgenes/pi-packages/issues/814
[#815]: https://github.com/gotgenes/pi-packages/issues/815
[#829]: https://github.com/gotgenes/pi-packages/issues/829
[#839]: https://github.com/gotgenes/pi-packages/issues/839
[#843]: https://github.com/gotgenes/pi-packages/issues/843
[#849]: https://github.com/gotgenes/pi-packages/issues/849
