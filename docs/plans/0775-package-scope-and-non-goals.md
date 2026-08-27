---
issue: 775
issue_title: "Document per-package scope and non-goals in each README"
---

# Document per-package scope and non-goals in each README

## Release Recommendation

**Release:** ship independently

No architecture roadmap references this issue, so there is no batch to join.
`docs` is an unhidden changelog type and `packages/<pkg>/README.md` is not in `exclude-paths`, so the nine README edits cut nine patch releases in a single release-please PR — which is precisely how the charter reaches an npm reader, since the README ships in every tarball.
Shipping also unblocks [#776] and [#777], both of which depend on this.

## Problem Statement

Every package README says what the package does; none says what it is *for*, or what it deliberately will not do.
That gap has a concrete cost: `/triage-backlog` and `/pr-review` have nothing to check an incoming request against, so a scope judgment is re-derived from scratch each run and answered inconsistently across triages.

The backlog makes the cost measurable.
Thirty-eight external PRs are currently declined-unmerged or open, and thirty-seven of them sit on the two packages with the widest boundaries:

| Package                | Closed unmerged (external) | Open (external) |
| ---------------------- | -------------------------- | --------------- |
| pi-permission-system   | 9                          | 11              |
| pi-subagents           | 10                         | 7               |
| pi-subagents-worktrees | 1                          | 0               |
| all others             | 0                          | 0               |

Each of those got an individual judgment call.
A written charter converts them into answers by reference.

## Goals

- Add a `## Scope and non-goals` section to all nine `packages/<pkg>/README.md` files, each covering purpose, in-scope changes, non-goals with rationale, and where adjacent requests belong.
- Ground every non-goal in an artifact this repository already contains — an ADR, an architecture design principle, a plan, a retro, or a commit — rather than in a drafted assertion.
- Keep the charter self-contained in the npm tarball, so a contributor reading the package on npmjs.org gets the same boundaries a contributor reading GitHub does.
- Leave a citable evidence trail so [#777]'s scope-alignment gate inherits the reasoning instead of re-deriving it.

This change is **not breaking**: it adds prose to nine READMEs and changes no code, config, default, or output shape.

## Non-Goals

- **`CONTRIBUTING.md`** — [#776] owns it; it will link to these sections once they exist.
- **The `/triage-backlog` scope-alignment gate** — [#777] owns it.
  This plan writes the charter the gate checks against and stops there.
- **A pointer from each `.pi/skills/package-*/SKILL.md` to its package's charter.**
  Five packages have a skill, four do not, so a skill pointer is a partial mechanism.
  Whether the gate reads the README directly or wants a skill-side pointer is [#777]'s design call, not this plan's.
- **A central package-ownership map in the root `README.md`.**
  Adjacent-request routing is named inline in each package README (see Design Overview), so the root README is untouched by this change.
- **Extending any package's `files` allowlist.**
  `README*` is auto-included by npm regardless of the allowlist, so no `package.json` changes are needed, and this plan does not start shipping `docs/architecture` or `docs/decisions` from packages that currently exclude them.
- **Rewriting existing README sections.**
  `pi-subagents`'s `## Removed: agent memory and skill preloading` and `## Relationship to upstream` already carry non-goal content; the charter cross-references them rather than absorbing or duplicating them.
- **Adjudicating any specific open PR.**
  The charter states boundaries; applying them to a live PR is a `/pr-review` or `/triage-backlog` action after this lands.

## Background

### Where the evidence actually lives

Artifact density is extremely uneven across the nine packages, which is the single biggest constraint on how this work is executed:

| Package                   | Commits | Plans | Retros | ADRs | Arch docs |
| ------------------------- | ------- | ----- | ------ | ---- | --------- |
| pi-permission-system      | 1635    | 155   | 225    | 11   | 17        |
| pi-subagents              | 1536    | 147   | 147    | 4    | 22        |
| pi-autoformat             | 74      | 18    | 10     | 0    | 0         |
| pi-session-tools          | 69      | 5     | 5      | 0    | 0         |
| pi-github-tools           | 65      | 3     | 2      | 0    | 0         |
| pi-colgrep                | 62      | 5     | 3      | 0    | 1         |
| pi-permission-model-judge | 55      | 5     | 5      | 0    | 0         |
| pi-subagents-worktrees    | 52      | 4     | 4      | 0    | 0         |
| pi-nocd                   | 12      | 0     | 1      | 0    | 0         |

A uniform "read everything" mining pass is impossible for the top two and trivial for the bottom one.
The mining prompt must therefore be tiered.

For `pi-permission-system` and `pi-subagents` the strongest non-goal signal is not the plan or retro corpus at all — it is the ADRs and the architecture `## Design principles` lists, several of whose entries are already non-goals in disguise:

- pi-subagents principle 1: "Narrow core — the extension owns agent spawning, execution, and result retrieval.
  Everything else is a consumer."
- pi-subagents principle 4: "No time-based scheduling — cron-style timed dispatch is removed from the core."
- pi-subagents principle 10: "Open for extension, closed for modification … zero knowledge of its consumers."
- pi-permission-system principle 4: "MCP stays special — multi-name target derivation is pre-processing, not a special evaluation path."
- pi-permission-system principle 9: "Single-agent core, multi-agent by extension … never a hard dependency on any one multi-agent extension."

That is a bounded read (four documents plus fifteen ADRs), not a 300-file sweep.

### README structural divergence

The nine READMEs share only `## Install` and `## License`.
Their first substantive section varies: `## Why` (pi-autoformat, pi-nocd, pi-permission-model-judge), `## Prerequisites` (pi-colgrep), `## Install` (pi-github-tools, pi-subagents-worktrees), `## What It Does` (pi-permission-system), `## Tools` (pi-session-tools), `## Features` (pi-subagents).
`## Install` sits at line 9 in `pi-github-tools` and line 135 of 151 in `pi-session-tools`, so a naive "before `## Install`" rule places the charter at the top of one README and the bottom of another.

### Distribution constraint on ADR citations

Per `AGENTS.md` § Docs-in-distribution, a link from a shipped doc into a non-shipped path resolves to nothing in the tarball.
The `files` allowlists differ on exactly the paths this charter wants to cite:

| Package              | Ships `docs/architecture` | Ships `docs/decisions` | Citation link form  |
| -------------------- | ------------------------- | ---------------------- | ------------------- |
| pi-subagents         | yes                       | yes                    | relative            |
| pi-permission-system | no                        | no                     | absolute GitHub URL |
| pi-colgrep           | no                        | n/a                    | absolute GitHub URL |
| all others           | n/a                       | n/a                    | no ADR to cite      |

`pi-subagents`'s README already relative-links `./docs/architecture/architecture.md` and ships it.
`pi-permission-system`'s `## Documentation` table deliberately lists only shipped paths and omits architecture and decisions — the charter must not break that discipline.

### Applicable `AGENTS.md` constraints

- One sentence per line; compact tables with no padding; sequential list numbering restarting under each heading.
- Reference-style issue links (`[#N]` plus a file-end definition) in long-lived `docs/plans/` documents; bare `#N` inside a fenced block takes no definition.
- Root `docs/plans` is in `exclude-paths`, so the evidence briefs cut no release.
- A read-only subagent still needs a scope bound — each mining agent is confined to its own package directory plus named `gh` queries.
- A subagent's universal claim is the one to verify; "this package has no non-goals in its history" is exactly such a claim and must be treated as a null result to probe, not a finding to accept.

## Design Overview

### Decisions taken at the clarification gate

| Decision  | Choice                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| Authoring | Draft per package from mined evidence, then gate each section on operator approval via `ask_user` before its commit |
| Placement | Immediately before the README's setup block, with an identical four-part internal structure everywhere              |
| Routing   | Adjacent owners named inline by npm package name; no link to the root README                                        |
| Evidence  | Cite ADRs and architecture docs only; never name a contributor's declined PR in a shipped README                    |
| Briefs    | Committed under `docs/plans/0775-evidence/<pkg>.md`                                                                 |
| Cadence   | The two contested packages reviewed alone; the other seven in batches                                               |

### Section template

Every package gets the same four-part structure, so the section is scannable by a human and greppable by [#777]'s gate:

````markdown
## Scope and non-goals

**Purpose.**
One or two sentences: the single problem this package exists to solve.

**In scope.**
The kinds of change that belong here.

**Non-goals.**

- _Short name for the excluded capability._
  Why it is excluded, and what the exclusion buys.
- _Short name._
  Rationale.

**Where adjacent requests belong.**
Capability → `@gotgenes/<owning-package>` or the named extension point.
````

Bolded lead-ins rather than `###` subheadings: four `###` levels per README across nine files would bloat every table of contents, and `MD036` only rejects emphasis used as a heading *line*, not a bolded lead-in that begins a paragraph.

### Placement rule

Place `## Scope and non-goals` immediately before the README's **setup block** — the first `## Prerequisites` or `## Install` heading, whichever appears first.
This resolves to "after the pitch, before setup" for eight of nine packages:

| Package                   | Inserted before        | Effective position                                      |
| ------------------------- | ---------------------- | ------------------------------------------------------- |
| pi-autoformat             | `## Install`           | after `## Why` and `## How it works`                    |
| pi-colgrep                | `## Prerequisites`     | after the intro                                         |
| pi-github-tools           | `## Install`           | after the intro                                         |
| pi-nocd                   | `## Install`           | after `## Why`                                          |
| pi-permission-model-judge | `## Install`           | after `## Why`, `## How it works`, `## What it records` |
| pi-permission-system      | `## Install`           | after `## What It Does`                                 |
| pi-session-tools          | `## Tools` (exception) | after the intro                                         |
| pi-subagents              | `## Install`           | after `## Features`                                     |
| pi-subagents-worktrees    | `## Install`           | after the intro                                         |

`pi-session-tools` is the one documented exception: its `## Install` sits at line 135 of 151, so the rule as written would bury the charter at the bottom.
It goes before `## Tools` instead, which preserves the rule's intent (after the intro, before the first deep-dive section).

### Evidence-mining subagents

One read-only mining subagent per package, dispatched in background batches, each writing a brief to `docs/plans/0775-evidence/<pkg>.md` and returning only a one-paragraph summary.
Persisting to a file rather than returning prose is what keeps the build session's context bounded: it reads one brief at a time, immediately before drafting that package's section.

Because the agents write files, they are `general-purpose`, not `Explore` (which is read-only and cannot write the brief).
Each is bounded to `packages/<pkg>/` plus the named `gh` queries below, per the read-only-agent scope guardrail.

The prompt is tiered by evidence density:

1. **Tier A — `pi-permission-system`, `pi-subagents`.**
   Read the README, `docs/architecture/architecture.md` `## Design principles`, every ADR under `docs/decisions/`, and any `docs/architecture/history/` phase summary.
   Then read the titles and bodies of that package's closed-unmerged and open external PRs (`gh pr list --state closed --limit 300 --json number,title,body,mergedAt,author`, filtered to `mergedAt == null` and `author.login != "gotgenes"`), plus closed-as-not-planned issues, to recover the boundary each decline was defending.
   Do **not** sweep the plan or retro corpus; cite it only when an ADR or design principle points into it.
2. **Tier B — `pi-autoformat`, `pi-colgrep`, `pi-github-tools`, `pi-permission-model-judge`, `pi-session-tools`, `pi-subagents-worktrees`.**
   Read the README, every file under `docs/plans/` and `docs/retro/`, `docs/architecture/architecture.md` where present, and the full `git log --oneline -- packages/<pkg>` subject list.
3. **Tier C — `pi-nocd`.**
   Read everything the package has (one retro, twelve commits, a 59-line README).

Every tier returns the same brief shape, so the drafting step reads a uniform document:

````markdown
# Evidence brief: <pkg>

## Purpose signal

What the artifacts say this package exists to do, with citations.

## In-scope signal

Kinds of change the history shows being accepted, with citations.

## Candidate non-goals

- **<capability>** — rationale, `citation: docs/decisions/0004-....md` or `commit abc1234` or `PR #684`.

## Adjacent routing signal

Capability → package, where the history shows a request being redirected.

## Gaps

Where the artifacts are silent and the operator must supply the boundary.
````

The `## Gaps` section is load-bearing.
A package with no external PR pressure and no ADR may genuinely have no recorded non-goals, and the honest brief says so rather than manufacturing one — the same failure mode [#777] warns about when it forbids the gate from inventing a charter to justify a decline.

### Citation discipline in the shipped README

A brief's citations include PR numbers; the README's do not.
The drafting step translates a `PR #684` citation into the durable rationale it was defending, and cites the ADR or design principle instead.
Where no ADR exists, the README carries the rationale as prose with no citation, and the PR trail stays in the committed brief.

Link form follows the distribution table in Background: relative for `pi-subagents`, absolute `https://github.com/gotgenes/pi-packages/blob/main/packages/<pkg>/docs/...` for `pi-permission-system` and `pi-colgrep`.

### Worked example

For `pi-nocd` (Tier C), the charter this process should produce:

````markdown
## Scope and non-goals

**Purpose.**
Pi states the working directory in its system-prompt footer but never forbids `cd`-prefixing it.
This extension supplies the missing prohibition — nothing else.

**In scope.**
The wording of the injected block, correct path resolution when a child session inherits or overrides the parent's directory, and the `before_agent_start` hook that carries it.

**Non-goals.**

- _General-purpose system-prompt injection._
  A configurable "append arbitrary text" extension is a different tool; this one owns a single rule so its wording can be tuned against observed agent behavior.
- _Enforcing the rule._
  This extension instructs; it does not gate.
  Blocking a `cd`-prefixed command is a permission decision.

**Where adjacent requests belong.**
Blocking or auditing commands → `@gotgenes/pi-permission-system`.
Per-child working directories → `@gotgenes/pi-subagents-worktrees`.
````

## Module-Level Changes

| Path                                             | Change                                                                                                                                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/pi-autoformat/README.md`               | Add `## Scope and non-goals` before `## Install`                                                                                                                                                               |
| `packages/pi-colgrep/README.md`                  | Add `## Scope and non-goals` before `## Prerequisites`                                                                                                                                                         |
| `packages/pi-github-tools/README.md`             | Add `## Scope and non-goals` before `## Install`                                                                                                                                                               |
| `packages/pi-nocd/README.md`                     | Add `## Scope and non-goals` before `## Install`                                                                                                                                                               |
| `packages/pi-permission-model-judge/README.md`   | Add `## Scope and non-goals` before `## Install`                                                                                                                                                               |
| `packages/pi-permission-system/README.md`        | Add `## Scope and non-goals` before `## Install`; ADR/architecture citations use absolute GitHub URLs                                                                                                          |
| `packages/pi-session-tools/README.md`            | Add `## Scope and non-goals` before `## Tools` (documented exception)                                                                                                                                          |
| `packages/pi-subagents/README.md`                | Add `## Scope and non-goals` before `## Install`; cross-reference the existing `## Removed:` and `## Relationship to upstream` sections rather than duplicating them; ADR/architecture citations stay relative |
| `packages/pi-subagents-worktrees/README.md`      | Add `## Scope and non-goals` before `## Install`                                                                                                                                                               |
| `docs/plans/0775-evidence/<pkg>.md` (×9)         | New; one committed evidence brief per package                                                                                                                                                                  |
| `docs/plans/0775-package-scope-and-non-goals.md` | This plan                                                                                                                                                                                                      |
| `docs/retro/0775-package-scope-and-non-goals.md` | Stage notes                                                                                                                                                                                                    |

Explicitly unchanged: every `package.json` (npm auto-includes `README*`), the root `README.md`, all `.pi/skills/package-*/SKILL.md`, `release-please-config.json`, and all source and test files.

Grep sweep performed at planning time: no `packages/*/README.md` currently contains the strings `non-goal`, `out of scope`, `deliberately`, or `will not`, so the new section collides with no existing prose and displaces no existing heading.

## Test Impact Analysis

No code changes, so no unit tests are added, removed, or made redundant.

Verification is documentary:

1. `pnpm exec rumdl check packages/*/README.md docs/plans/0775-*.md docs/plans/0775-evidence/*.md` must pass.
2. `pnpm --filter @gotgenes/pi-permission-system exec pnpm pack --pack-destination /tmp` and `tar tzf` must show `README.md` present and `docs/decisions/` still absent — confirming the charter shipped and the absolute-URL decision was necessary.
3. Every relative link introduced into a README must resolve to a path inside that package's `files` allowlist; every ADR reference outside it must be an absolute URL.

## Invariants at risk

| Invariant                                                                  | Source                                       | How this plan holds it                                                                                                         |
| -------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| A shipped doc never relative-links into a non-shipped path                 | `AGENTS.md` § Docs-in-distribution ([#647])  | Per-package link-form table in Background; verified by the `pnpm pack` check                                                   |
| No package's tarball grows to include internal working docs                | [#484], [#523]                               | No `files` allowlist is touched; briefs live in root `docs/plans`, which ships nowhere                                         |
| A commit touching only `docs/plans` or `docs/retro` cuts no release        | `release-please-config.json` `exclude-paths` | Brief commits are `docs:` but land only under root `docs/plans/`, which is excluded; only the nine README commits cut releases |
| `pi-permission-system`'s `## Documentation` table lists only shipped paths | Existing README discipline                   | Charter citations bypass the table and use absolute URLs                                                                       |

## Build Order

1. **Scaffold and dispatch Tier B/C mining.**
   Create `docs/plans/0775-evidence/`, then dispatch seven background `general-purpose` mining subagents (the six Tier B packages plus `pi-nocd`), each bounded to its package directory and writing its brief.
   Commit: `docs: add evidence briefs for the seven focused packages (#775)`.
2. **Dispatch Tier A mining.**
   Two background `general-purpose` subagents for `pi-permission-system` and `pi-subagents`, bounded to the ADR/architecture/README read plus the named `gh` PR and issue queries.
   Commit: `docs: add evidence briefs for pi-permission-system and pi-subagents (#775)`.
3. **Draft and gate batch 1 — `pi-nocd`, `pi-session-tools`, `pi-github-tools`.**
   Read those three briefs, draft each section, present all three with their evidence citations, and gate on `ask_user` before committing.
   Commit one per package: `docs(pi-nocd): document scope and non-goals (#775)`, and so on.
4. **Draft and gate batch 2 — `pi-autoformat`, `pi-colgrep`, `pi-permission-model-judge`, `pi-subagents-worktrees`.**
   Same shape; four per-package `docs(<pkg>):` commits.
5. **Draft and gate `pi-permission-system` alone.**
   Present the drafted non-goals against the boundaries the nine closed and eleven open external PRs were defending, with the ADR or design principle proposed as each README citation.
   Commit: `docs(pi-permission-system): document scope and non-goals (#775)`.
6. **Draft and gate `pi-subagents` alone.**
   Same, against its ten closed and seven open external PRs, and reconciled with the existing `## Removed:` and `## Relationship to upstream` sections.
   Commit: `docs(pi-subagents): document scope and non-goals (#775)`.
7. **Cross-check and verify.**
   Confirm every "where adjacent requests belong" target names a package that actually owns that capability, and that the nine charters do not contradict each other on a shared boundary (notably the permission-system / subagents / worktrees triangle).
   Run the three Test Impact Analysis checks.
   Commit any fixes as `docs: reconcile cross-package scope boundaries (#775)`.

Per-package commits rather than one omnibus commit: release-please attributes by path, so nine scoped `docs(<pkg>):` commits produce nine clean changelog entries in one release PR.

## Risks and Mitigations

| Risk                                                                                        | Mitigation                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A mining subagent manufactures a non-goal from thin evidence                                | Every candidate non-goal in a brief must carry a citation, and the brief's `## Gaps` section is where an unsupported boundary belongs; the operator gate is the backstop           |
| A universal null result ("this package has no recorded non-goals") is accepted uncritically | Treat it as a claim to probe, per the subagent guardrail; for a package with no ADR the operator supplies the boundary at the gate rather than the agent inferring one             |
| The charter reads as a wall against contributors                                            | Evidence decision already excludes naming declined PRs; the section states boundaries and routes adjacent requests to a real owner rather than closing the door                    |
| Nine patch releases for a prose change looks like noise                                     | It is the mechanism, not a side effect — the README ships in the tarball, so a release is how the charter reaches an npm reader                                                    |
| A charter written now ossifies a boundary that should move                                  | The section is prose in a README, revisable by a normal `docs:` commit; [#777] surfaces a genuinely unclear alignment through `ask_user` rather than treating the charter as final |
| Two charters disagree about who owns a capability                                           | Step 7 is a dedicated cross-check pass over the permission-system / subagents / worktrees triangle                                                                                 |
| A mining agent's `gh` sweep pulls a contributor's words into a shipped README               | The translation rule is explicit: a brief cites PR numbers, the README cites ADRs and design principles or carries uncited prose                                                   |

## Open Questions

- Whether `.pi/skills/package-*/SKILL.md` should carry a pointer to its package's charter is deferred to [#777], which owns the gate that would consume it.
  Five of nine packages have a skill, so a skill-side pointer is a partial mechanism and a poor primary surface.
- Whether the two Tier A charters need a companion ADR recording the boundary itself (rather than citing existing ADRs that imply it) is deferred until their evidence briefs are in hand — if a boundary the PRs keep testing turns out to rest on no ADR, that is a finding worth a follow-up issue, filed then rather than speculatively now.
- Whether `docs/plans/0775-evidence/` should be relocated or pruned once [#777] lands is left open; it costs nothing where it is and cuts no release.

[#484]: https://github.com/gotgenes/pi-packages/issues/484
[#523]: https://github.com/gotgenes/pi-packages/issues/523
[#647]: https://github.com/gotgenes/pi-packages/issues/647
[#776]: https://github.com/gotgenes/pi-packages/issues/776
[#777]: https://github.com/gotgenes/pi-packages/issues/777
