---
issue: 843
issue_title: "Rename the worktree ship-flow commands: /ship-worktree does not ship, /land-worktree does"
---

# Rename the worktree ship-flow commands

## Release Recommendation

**Release:** ship independently

This is repo-level work (`scope:repo`) touching only `.pi/prompts/`, `AGENTS.md`, and `README.md`.
None of those paths belong to a package, so the `docs:` commits cut no release at all — release-please sees nothing to version.
The issue is not a member of any package's architecture roadmap, so no batch applies.

## Problem Statement

The two halves of the parallel-worktree ship flow are named for the wrong actions.

`/ship-worktree` (the peer half) runs `pnpm run lint` and `pnpm fallow dead-code`, captures the peer session's transcript path, commits a stage breadcrumb, and rebases the branch onto `origin/main`.
It never pushes the branch, never touches `main`, never closes an issue, and never releases.
It is a prepare-and-sync step.

`/land-worktree` (the root half) reads the plan's `**Release:**` marker, fast-forward-merges the branch into `main`, pushes, verifies CI with `ci_find`/`ci_watch`, closes the issue with `issue_close`, merges the release-please PR, and tears down the worktree.
It is the worktree flow's terminal command — the true sibling of `/ship-issue`.

So `ship` sits on the half that does not ship, and the half that does ship is called something else.

## Goals

- Rename `.pi/prompts/ship-worktree.md` → `.pi/prompts/sync-worktree.md`, so the peer half is named for what it does.
- Rename `.pi/prompts/land-worktree.md` → `.pi/prompts/ship-worktree.md`, so the root-session terminal command reads as `/ship-issue`'s sibling.
- Migrate the stage labels with the commands: the peer's session name becomes `#N Sync (worktree) — <title>`, its retro stage header becomes `## Stage: Sync (worktree)`, and the root's session name becomes `#N Ship (worktree) — <title>`.
- Teach `/retro` the pre-rename spelling of the peer stage header, so it still finds the transcript path in the seven retro files that already carry `## Stage: Ship (worktree)`.
- Add a fail-fast guard to the new root `/ship-worktree` so a peer-session mis-invocation stops before it renames the session or asks a release question.
- Leave every live reference across the eight affected files consistent in a single landed change.
- Pin both worktree prompts to `model: anthropic/claude-sonnet-5`, so neither half inherits whatever model the session happens to be running.

This change is **not** breaking in the semver sense — no package source, export, or config default changes, and nothing publishes.
It is disruptive to muscle memory, which the guard in the new root prompt addresses.

## Non-Goals

- Rewriting the historical `docs/plans/` and `docs/retro/` files that mention the old command names or carry `## Stage: Ship (worktree)` headers.
  Those are committed history; they record what the flow was called when they were written.
  The `/retro` prompt is taught the old spelling instead.
- Renaming `/worktree`, `scripts/worktree-new.sh`, or `scripts/worktree-rm.sh` — those names are accurate and nothing in the issue disputes them.
- Reordering the root prompt's existing steps.
  The only structural addition is the guard pre-step in Goals; Release coordination, the ff-merge, CI verification, close, release, and teardown keep their current order and content.
- Changing `/ship-issue` or `/ship-no-issue` beyond the single cross-reference each carries.
  In particular, the trunk `/ship-issue` keeps its unpinned `model:` and continues to inherit the session model; only the worktree pair is pinned here.
  Whether the trunk shipping command should match is a separate question, deliberately not settled by this issue.
- Adding a machine-readable alias or deprecation shim for the old command names.
  Pi resolves a slash command from the `.pi/prompts/<name>.md` filename; a stub file for a retired name would show up in autocomplete and defeat the point.

## Background

The relevant live files, with measured occurrence counts (`grep -c`, at `6924faab` on `main`):

| File                           | `ship-worktree` | `land-worktree` |
| ------------------------------ | --------------- | --------------- |
| `AGENTS.md`                    | 5               | 5               |
| `README.md`                    | 5               | 4               |
| `.pi/prompts/ship-worktree.md` | 0 (self)        | 5               |
| `.pi/prompts/land-worktree.md` | 2               | 0 (self)        |
| `.pi/prompts/ship-issue.md`    | 0               | 1               |
| `.pi/prompts/retro.md`         | 1               | 0               |
| `.pi/prompts/tdd-plan.md`      | 1               | 0               |
| `.pi/prompts/build-plan.md`    | 1               | 0               |

Fifteen live occurrences of each name.
No skill under `.pi/skills/`, no agent under `.pi/agents/`, no script under `scripts/`, and no package README references either command — verified with `rg -n 'worktree' .pi/settings.json .pi/agents/*.md .pi/skills/*/SKILL.md`, whose only hits are the unrelated `pi-subagents-worktrees` package.

Seven committed retro files carry a `## Stage: Ship (worktree)` header: `packages/pi-subagents/docs/retro/{0535,0536,0537,0829,0830}-*.md`, `packages/pi-session-tools/docs/retro/0549-*.md`, and `packages/pi-permission-system/docs/retro/0742-*.md`.
The count is of heading-bearing files, from the anchored `rg -c '^## Stage: Ship \(worktree\)'`; `packages/pi-session-tools/docs/retro/0546-*.md` mentions the string in prose and does not count.
`.pi/prompts/retro.md` line 62 names that exact header as where the peer transcript path is recorded.
Two further retros carry ad-hoc `## Stage: Land — …` headers that no prompt prescribes; they are left alone.

Constraints from `AGENTS.md` that apply:

- Aligned tables (`.rumdl.toml` sets `[MD060] style = "aligned"`) are not auto-fixed — `rumdl fmt` does not re-pad a table.
  Both affected tables happen to keep their widths under this rename (see Design Overview), but the widths must be checked, not assumed.
- `pi-autoformat` reflows what is written, so re-read a region before matching against it again.
- One sentence per line; append markdown with `Write`/`Edit`, never a shell heredoc.
- A running Pi session keeps the prompt templates it loaded at startup, so the renamed commands do not exist in this session after the change lands — the operator restarts Pi before first use.

Autocomplete behavior, verified in the sibling Pi checkout at `../pi`: `CombinedAutocompleteProvider.getSuggestions` (`packages/tui/src/autocomplete.ts`) filters slash commands through `fuzzyFilter` (`packages/tui/src/fuzzy.ts`), an in-order subsequence match with word-boundary scoring — not `startsWith` and not `includes`.
So typing `worktree` reaches every worktree command regardless of word position, and typing `ship` will surface `/ship-issue`, `/ship-no-issue`, and the root half only, which is the grouping this rename wants.

## Design Overview

### The name pair

| Half                   | Old              | New              | Session name                   |
| ---------------------- | ---------------- | ---------------- | ------------------------------ |
| Peer (worktree branch) | `/ship-worktree` | `/sync-worktree` | `#N Sync (worktree) — <title>` |
| Root (`main`)          | `/land-worktree` | `/ship-worktree` | `#N Ship (worktree) — <title>` |

`sync` is chosen over `prep`/`rebase`/`handoff` because it names the step the operator re-runs: when the root's ff-merge is rejected because `main` advanced, the peer re-syncs onto the new `origin/main`.

The root half takes over the retired name.
Both new session names distinguish the halves within the new scheme (`Sync` vs `Ship`), and session names are ephemeral display strings — no committed artifact reads them, so the collision with pre-rename peer sessions costs nothing.

### The name-reuse guard

Reusing `/ship-worktree` for the root half means an operator with muscle memory can invoke it from a peer session.
Today the root prompt calls `set_session_name` and runs its Release coordination section — which can ask a release question — before step 1 confirms the root checkout on `main`.
The rename adds one fail-fast pre-step ahead of both:

```markdown
## 0. Confirm you are at the root, not in a worktree

Run `git branch --show-current`.
If it is not `main`, stop and report — you are in a peer worktree and want `/sync-worktree $1` instead.
```

Everything after it — Release coordination, step 1's fuller root-checkout confirmation, the ff-merge, CI, close, release, teardown — keeps its current order and wording.
Step 1's own `git rev-parse --show-toplevel` check stays; the pre-step is a cheap early exit, not a replacement.

### The stage-header migration

The peer prompt writes `## Stage: Sync (worktree)` and commits it as `docs(retro): add sync stage notes for issue #$1`.
`/retro` line 62 must then accept both spellings, because the seven pre-rename retros cannot be rewritten.
The sentence becomes one that names the current spelling first and the historical one parenthetically, so a retro agent reading either finds the transcript path.

### The model pin

Both prompts declare no `model:` today, so each half runs on whatever model the session was started with.
Both gain `model: anthropic/claude-sonnet-5`.

That alias is already resolved by four files in this repo — `.pi/prompts/finish-phase.md` and the three agents under `.pi/agents/` — so it is a verified registry entry rather than a guessed spelling.
This matters because a `model:` value absent from the registry does not error: it falls back silently to the session model, which is exactly the behavior the pin is meant to remove.

The pin fits what these two prompts are: mechanical, checklist-shaped procedures over deterministic tools (`git`, `ci_watch`, `issue_close`, `release_pr_merge`) with named stop conditions.
That is the same profile as `/finish-phase`, which is already pinned to this model.
The deliberative prompts — `/plan-issue`, `/retro`, `/triage-backlog` — stay on `claude-opus-5`, and the trunk `/ship-issue` stays unpinned (see Non-Goals).

### Table widths

Both affected tables are aligned-style and must not be left mis-padded.

`AGENTS.md`'s session-naming table: `Worktree ship (peer)` → `Worktree sync (peer)` and `Worktree land (root)` → `Worktree ship (root)` are both 20 characters, matching the existing widest first-column entry (`Build implementation`, 20).
`` `#N Ship (worktree) — <title>` `` and `` `#N Sync (worktree) — <title>` `` are both 30 characters, and the root row grows from `` `#N Land — <title>` `` to the same 30 — which is already the column width.
So this table needs no re-padding; verify with `rumdl check` rather than assuming it.

`README.md`'s worktree workflow table: the `Command` column entries `` `/ship-worktree #N` `` and `` `/land-worktree #N` `` are both 18 characters and the new pair is too, and the column's width is set by the longer `` `/plan-issue` → `/tdd-plan` or `/build-plan` `` row.
The `Stage` column's `Ship prep` → `Sync` and `Land` → `Ship` shrink within a width set by `Plan + implement`.
The `What happens` column's text does change and may shift that column's width; re-pad by hand if `rumdl check` reports MD060.

## Module-Level Changes

### Renamed files

- `.pi/prompts/ship-worktree.md` → `.pi/prompts/sync-worktree.md` (`git mv`).
- `.pi/prompts/land-worktree.md` → `.pi/prompts/ship-worktree.md` (`git mv`, **after** the first rename — running them in the other order would clobber the peer prompt).

### `.pi/prompts/sync-worktree.md` (was `ship-worktree.md`)

- Frontmatter `description:` — "Peer-session ship prep" → peer-session sync wording.
- Frontmatter gains `model: anthropic/claude-sonnet-5` (see Design Overview).
- H1 `# Ship a worktree branch (peer session)` → `# Sync a worktree branch (peer session)`.
- Intro: the five `/land-worktree $1` references become `/ship-worktree $1`, each qualified as the **root** half where the sentence does not already say so.
- `set_session_name` line: `#$1 Ship (worktree)` → `#$1 Sync (worktree)`.
- Section 3 heading and body: "ship stage notes" → "sync stage notes"; the embedded stage header `## Stage: Ship (worktree)` → `## Stage: Sync (worktree)`; the commit template `docs(retro): add ship stage notes for issue #$1` → `add sync stage notes`.
- Section 5 and Constraints: the handoff line and the "that is `/land-worktree`'s job" constraint take the new root name.

### `.pi/prompts/ship-worktree.md` (was `land-worktree.md`)

- Frontmatter `description:` — keep the action list, lead with "Root-session ship".
- Frontmatter gains `model: anthropic/claude-sonnet-5` (see Design Overview).
- H1 `# Land a worktree branch (root session)` → `# Ship a worktree branch (root session)`.
- New `## 0. Confirm you are at the root, not in a worktree` pre-step (see Design Overview), placed above the `set_session_name` line and the Release coordination section.
- `set_session_name` line: `#$1 Land` → `#$1 Ship (worktree)`.
- The two `/ship-worktree $1` references (intro, step 2.3) → `/sync-worktree $1`.
- Existing step numbering (1–8) is unchanged; the guard is step 0, matching `/ship-issue`'s own step-0 convention for its release gate.

### `.pi/prompts/retro.md`

- Line 17: "the worktree ship flow (`/ship-worktree`) owns rebasing onto `origin/main`" → `/sync-worktree`.
- Line 62: the `## Stage: Ship (worktree)` reference becomes `## Stage: Sync (worktree)` with the pre-rename spelling named parenthetically, so the seven historical retros still resolve.

### `.pi/prompts/tdd-plan.md` and `.pi/prompts/build-plan.md`

- One reference each ("the worktree ship flow (`/ship-worktree`) owns rebasing onto `origin/main`") → `/sync-worktree`.

### `.pi/prompts/ship-issue.md`

- Line 74's "(matches `/land-worktree`'s decoupled close/release contract)" → names the worktree flow's root half explicitly, so the reader does not mistake `/ship-worktree` there for the peer command.

### `AGENTS.md`

- Line 190 (release batching): `/land-worktree` → `/ship-worktree`.
- Convergence list items 1–5 (lines 264–271): peer command → `/sync-worktree`, root command → `/ship-worktree`, and the "**ship** stage note" / "(planning/TDD/ship)" wording → **sync**.
- Guardrails (lines 279–282): the trunk-only guardrail, the rebase-first guardrail, and the stale-rebase guardrail each take the new pair.
- Session-naming table rows (lines 296–297): `Worktree ship (peer)` / `#N Ship (worktree)` → `Worktree sync (peer)` / `#N Sync (worktree)`; `Worktree land (root)` / `#N Land` → `Worktree ship (root)` / `#N Ship (worktree)`.

### `README.md`

- Prose in `#### Parallel worktree workflow`.
- `flowchart TB` diagram: peer nodes `A3`/`B3` labels → `/sync-worktree N`; the `Land[…]` node label → `Root — /ship-worktree N<br/>…` (the node id may become `Ship`; both edges into it update with it).
- `sequenceDiagram`: `Note over Peer: /ship-worktree N` → `/sync-worktree N`; `hand off — run /land-worktree N` → `run /ship-worktree N`.
- Workflow table: `Ship prep` / `` `/ship-worktree #N` `` → `Sync` / `` `/sync-worktree #N` ``; `Land` / `` `/land-worktree #N` `` → `Ship` / `` `/ship-worktree #N` ``.
- Guardrail bullet: "if `/land-worktree`'s ff-merge is rejected … the peer re-runs `/ship-worktree #N`" → the new pair.

### Files deliberately not changed

`docs/plans/*.md`, `docs/retro/*.md`, `packages/*/docs/plans/*.md`, and `packages/*/docs/retro/*.md` — committed history, per Non-Goals.
`scripts/worktree-new.sh`, `scripts/worktree-rm.sh`, and `.pi/extensions/worktree.ts` reference neither command name (verified above) and are untouched.

## Test Impact Analysis

This is a docs-and-prompts change with no test suite, so its testable surface is the shell commands the plan prescribes and the greps that prove the rename is complete.
Each was dry-run at planning time; the "before" column is the measured current state.

| Verification command                                      | Before                                                                                        | Expected after                                                                                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rg -c 'land-worktree' AGENTS.md README.md .pi/ scripts/` | `README.md:4`, `AGENTS.md:5`, `.pi/prompts/ship-issue.md:1`, `.pi/prompts/ship-worktree.md:5` | no matches (exit 1)                                                                                                                               |
| `rg -n '#N Land\|#\$1 Land' AGENTS.md .pi/prompts/`       | 2 matches (`AGENTS.md:297`, `land-worktree.md:13`)                                            | no matches (exit 1)                                                                                                                               |
| `rg -c 'Ship \(worktree\)' AGENTS.md README.md .pi/`      | `AGENTS.md:1`, `.pi/prompts/retro.md:1`, `.pi/prompts/ship-worktree.md:2`                     | `AGENTS.md:1` (root session-name row), `.pi/prompts/retro.md:1` (historical spelling), `.pi/prompts/ship-worktree.md:1` (root `set_session_name`) |
| `rg -c 'sync-worktree' AGENTS.md README.md .pi/`          | no matches                                                                                    | `AGENTS.md`, `README.md`, and `.pi/prompts/{sync,ship}-worktree.md`, `retro.md`, `tdd-plan.md`, `build-plan.md` all non-zero                      |
| `ls .pi/prompts/`                                         | `land-worktree.md`, `ship-worktree.md`, no `sync-worktree.md`                                 | `ship-worktree.md`, `sync-worktree.md`, no `land-worktree.md`                                                                                     |
| `pnpm exec rumdl check .`                                 | clean (verified on the eight affected files: `Success: No issues found in 8 files`)           | clean                                                                                                                                             |
| `pnpm run lint`                                           | clean                                                                                         | clean                                                                                                                                             |

`rumdl check` is the instrument that catches an MD060 table mis-padding introduced by the `README.md` column edits — do not eyeball the alignment.

The model pin has its own check: `grep -c '^model:' .pi/prompts/*-worktree.md` returns `0` for both files today and must return `1` for each of `sync-worktree.md` and `ship-worktree.md` afterward.
There is no run-time assertion available — a wrong alias falls back silently to the session model — so the value is verified by matching the string against a file that already resolves it (`.pi/prompts/finish-phase.md`).

## Invariants at risk

- **The peer transcript path stays reachable from `/retro`.**
  `/retro` finds a worktree issue's peer transcript by looking for the stage header that records it.
  Migrating the header spelling would break that for the seven pre-rename retros; the mitigation is the dual-spelling sentence in `retro.md`, and the check is that the sentence names both `Sync (worktree)` and `Ship (worktree)`.
  Verify by grepping `retro.md` for both strings after the edit.
- **The release-marker contract stays symmetric between `/ship-issue` and the worktree root half** (landed for [#829]: both read the plan's `**Release:**` marker before any irreversible work).
  The guard pre-step is inserted *above* Release coordination, which keeps the marker read before the ff-merge; nothing may move Release coordination below step 1.
  Verify by reading the renamed root prompt top to bottom: the order must be guard → `set_session_name` → Release coordination → step 1.
- **`/ship-issue` stays trunk-only and the worktree flow stays two-session.**
  The rename must not make any prompt suggest `/ship-issue` for a worktree branch, or `/ship-worktree` for trunk work.
  Verify that the peer prompt still points trunk work at `/ship-issue` and the root prompt still refuses a non-`main` branch.

## Build Order

Four commits, each leaving the repo internally consistent.

1. **Rename the prompt pair and rewrite both files.**
   `git mv .pi/prompts/ship-worktree.md .pi/prompts/sync-worktree.md`, then `git mv .pi/prompts/land-worktree.md .pi/prompts/ship-worktree.md` — in that order.
   Apply every edit listed under the two prompt files in Module-Level Changes, including the new step 0 guard.
   The two files cross-reference each other, so they must land together; splitting this step leaves one prompt pointing at a filename that does not exist.
   Verify: `ls .pi/prompts/`, `rg -n 'land-worktree' .pi/prompts/` (no matches), `rg -n 'Stage: Sync \(worktree\)' .pi/prompts/sync-worktree.md`, `pnpm exec rumdl check .pi/prompts/`.
   Commit: `docs: rename the worktree ship-flow prompts to /sync-worktree and /ship-worktree (#843)`.
2. **Update the four sibling prompts.**
   `retro.md` (both the line-17 reference and the line-62 dual-spelling sentence), `tdd-plan.md`, `build-plan.md`, `ship-issue.md`.
   Verify: `rg -n 'land-worktree' .pi/` (no matches), `rg -n 'Sync \(worktree\)' .pi/prompts/retro.md` and `rg -n 'Ship \(worktree\)' .pi/prompts/retro.md` (both match, same sentence), `pnpm exec rumdl check .pi/`.
   Commit: `docs: point sibling prompts at the renamed worktree commands (#843)`.
3. **Update `AGENTS.md` and `README.md`.**
   All prose references, both Mermaid diagrams, and both aligned tables.
   Verify: the full Test Impact Analysis table above, plus `pnpm run lint` unpiped.
   Commit: `docs: update AGENTS.md and README for the worktree command rename (#843)`.
4. **Pin both worktree prompts to `claude-sonnet-5`.**
   Add `model: anthropic/claude-sonnet-5` to the frontmatter of `.pi/prompts/sync-worktree.md` and `.pi/prompts/ship-worktree.md`.
   Kept as its own commit so the rename diff stays a pure rename and this behavior change is reviewable on its own.
   Verify: `grep -c '^model:' .pi/prompts/*-worktree.md` returns `1` for each file, the value matches `.pi/prompts/finish-phase.md`'s exactly (`grep '^model:' .pi/prompts/finish-phase.md`), and `pnpm exec rumdl check .pi/prompts/` is clean.
   Commit: `docs: run the worktree ship-flow prompts on claude-sonnet-5 (#843)`.

## Risks and Mitigations

- **Muscle memory invokes the root `/ship-worktree` from a peer session.**
  Mitigated by the step 0 guard, which stops on a non-`main` branch before `set_session_name` or the release question.
  Residual: a peer operator who wanted `/sync-worktree` loses one command round-trip and reads the guard's message.
- **A running Pi session still holds the pre-rename templates.**
  `AGENTS.md` already documents stale in-process extension and prompt-template state.
  The operator restarts Pi before the next worktree flow; nothing in the repo can force it, so the plan does not pretend otherwise.
- **A historical retro's `## Stage: Ship (worktree)` header is missed by a future `/retro`.**
  Mitigated by the dual-spelling sentence and pinned by the invariant check above.
  Residual: `/retro` carries a two-spelling enumeration indefinitely — the cost the operator accepted when choosing full label migration.
- **An aligned table is left mis-padded.**
  `rumdl fmt` will not fix MD060, so the verification runs `rumdl check` explicitly at each step rather than relying on the pre-commit format hook.
- **A Mermaid label edit breaks the diagram.**
  Both edits are label-text-only within existing nodes; the `Land` node id rename in the flowchart touches two edge lines, which the step's verification reads back.
  Follow the `mermaid` skill when making the edit.

## Open Questions

None.
The three open parameters — the root name, the peer name, and whether the stage/session labels migrate — were settled at the planning clarification gate: `/ship-worktree` for the root half, `/sync-worktree` for the peer half, and migrate both labels while teaching `/retro` the old spelling.

[#829]: https://github.com/gotgenes/pi-packages/issues/829
