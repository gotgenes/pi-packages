---
issue: 776
issue_title: "Add CONTRIBUTING.md establishing an issues-first contribution path"
---

# Add CONTRIBUTING.md establishing an issues-first contribution path

## Release Recommendation

**Release:** ship independently

No architecture roadmap references this issue, so there is no batch to join.
Every path this change touches is either root-level (`CONTRIBUTING.md`, `README.md`, `.github/ISSUE_TEMPLATE/config.yml`) or already in `release-please-config.json`'s `exclude-paths` (`packages/pi-subagents/docs/architecture`), so release-please's components see nothing and the change cuts **no release at all**.
"Ship independently" here means "land and close the issue"; there is no release-please PR to wait on.

## Problem Statement

The repository has issue templates but no contribution guide.
A contributor arriving with a real problem has no stated path, so a meaningful share of outside effort arrives as an unsolicited pull request that does not land as written.

The path that actually works is already visible in the history — issues from outside contributors consistently turn into shipped work, and the capability in a pull request is routinely adopted and reimplemented with `Co-authored-by:` credit rather than merged from the contributor's branch.
That practice is written down for the maintainer's agent (`.pi/prompts/pr-review.md`: "the common, preferred outcome is **adopt the capability with our own simplified design** — not a straight merge") and nowhere for the contributor.
This change writes the contributor's half.

## Goals

- Add a root `CONTRIBUTING.md` establishing an issues-first path: file an issue, check the package's scope, discuss, then a pull request is considered.
- State plainly — and without alarm — that an accepted contribution **may** land as a reimplementation, and that credit is `Co-authored-by:` on the resulting commits plus a close comment linking them.
- Point at the conventions a change is held to and link `AGENTS.md` rather than restating it.
- Surface the guide where a contributor will actually meet it: the root README and the issue-chooser page.
- Keep it short enough to be read: a hard budget of roughly 80 lines, five `##` sections.

This change is **not breaking**: it adds prose and one pointer to a template config, and changes no code, package, default, or output shape.

## Non-Goals

- **A pull-request template.**
  The issue names it as missing and out of scope; filed as [#781].
- **A `CODE_OF_CONDUCT.md`.**
  Same; filed as [#782].
- **Restructuring the root README's `## Development` section.**
  The clarification gate chose link-only, so `## Development` (lines 50–218, including all three Mermaid diagrams and the worktree tables) is untouched.
  The README gains a new short `## Contributing` section above it, and nothing else changes — these two statements are consistent, not in tension.
- **Restating `AGENTS.md`.**
  The conventions section is a five-row table naming the rules a contribution meets first, each with a one-line explanation and a link out.
  `AGENTS.md` stays the single source of truth for the detail.
- **Quoting merge rates or naming any contributor's declined PR.**
  The measured statistics in the issue body are the motivation for writing the guide, not content for it.
  This mirrors [#775]'s citation policy, which kept contributor PR numbers out of the shipped package READMEs.
- **Editing the two issue templates.**
  The issue calls them adequate, and the gate chose the `contact_links` pointer over a scope-acknowledgement field, which would add friction to every filing.
- **A per-package contributing note.**
  Package scope lives in each README's `## Scope and non-goals` section ([#775]); the guide links the package table once rather than nine sections individually.
- **Changing `.pi/prompts/pr-review.md`.**
  It is the agent-facing counterpart and already encodes the practice this guide describes; keeping them in sync is a reading task, not a wiring one.

## Background

### What already exists

| Surface                                                        | State                                                                                                                                                                                        |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/ISSUE_TEMPLATE/bug_report.yml`, `feature_request.yml` | Present; both ask for package, version, description, expected behavior, repro                                                                                                                |
| `.github/ISSUE_TEMPLATE/config.yml`                            | One line: `blank_issues_enabled: false`; no `contact_links`                                                                                                                                  |
| Root `README.md`                                               | 221 lines; `## Packages` (6), `## Install` (22), `## Uninstall` (36), `## Development` (50–218), `## License` (219)                                                                          |
| `README.md` `## Development`                                   | `### Prerequisites`, `### Setup`, `### Commands`, `### Reviewing changes per package` (52–93) are contributor-relevant; `### Agentic development workflow` (94–218) is maintainer/agent-only |
| `packages/*/README.md`                                         | All nine carry `## Scope and non-goals` (anchor `#scope-and-non-goals`), landed by [#775]                                                                                                    |
| `.pi/prompts/pr-review.md`                                     | The maintainer's PR evaluation flow; requires a `Co-authored-by:` trailer and an `@login` close comment in every direction                                                                   |
| `CONTRIBUTING.md`                                              | Does not exist; never has (`git log -- CONTRIBUTING.md` is empty)                                                                                                                            |

Ninety-one commits repo-wide carry a `Co-authored-by` trailer, so the credit practice the guide describes is established, not aspirational.

### Where this issue came from

[#775] wrote the per-package scope charters and explicitly routed one finding here.
`packages/pi-subagents/docs/architecture/architecture.md:60` currently reads:

> The reimplement-don't-merge contribution pattern, applied across eight closed pull requests, is a repo-wide process rather than a scope boundary and belongs in `CONTRIBUTING.md`.

That sentence is a forward reference to a file that does not exist.
This plan makes it a pointer.

### Applicable `AGENTS.md` constraints

- One sentence per line.
  `rumdl`'s `MD060` is configured `style = "aligned"`, so tables are padded — the plan's and the guide's tables must be written accordingly, or run through `rumdl fmt`.
- Reference-style issue links (`[#N]` plus a file-end definition) in long-lived `docs/plans/` documents.
- § Docs-in-distribution: a link from a **shipped** doc into a non-shipped path resolves to nothing in the npm tarball ([#647]).
  `packages/pi-subagents/docs/architecture/` **is** shipped, and root `CONTRIBUTING.md` is not, so the pointer added there must be an absolute GitHub URL.
  The reverse direction is safe: `CONTRIBUTING.md` ships nowhere, so its own links may be repo-relative.
- § Clarification gates: a decision settling a repeating structure must settle its size budget in the same gate, with a worked example.
  Done — the gate fixed ~80 lines and the worked draft is below.
- § Commits: no `Closes #776` in any commit message.

### Lessons carried from [#775]

[#775] shipped a documentation change to nine READMEs and then needed two operator-driven revision rounds.
Both root causes apply directly here:

1. **Length.**
   Sections ran 29–68 lines because the size budget was never set.
   Countered by the explicit per-section line budget and the `wc -l` verification below.
2. **Manufactured links.**
   A uniform "where adjacent requests belong" slot had to be filled, so packages with no genuine adjacency got sibling links invented to fill it.
   Countered here by linking the package table once instead of nine `#scope-and-non-goals` anchors, and by adding no link the guide does not need.

## Design Overview

### Decisions taken at the clarification gate

| Decision         | Choice                                                                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Size             | Compact — roughly 80 lines, five `##` sections, everything else linked                                                                                                       |
| Candor           | Name the reimplementation pattern plainly, in the modal form: it **may** land as a reimplementation; if so, `Co-authored-by:` credit and a close comment linking the commits |
| Agent disclosure | Not included — the reason a PR needs rework is stated as "conventions it could not have known about", without describing the maintainer's toolchain                          |
| README overlap   | Link only; `## Development` untouched, no setup commands duplicated in the guide                                                                                             |
| Wiring           | A root README `## Contributing` section, and a `contact_links` entry on the issue chooser                                                                                    |
| Templates        | Unchanged; no scope-acknowledgement field                                                                                                                                    |

### Section content spec and line budget

| Section                              | Purpose                                                                         | Budget                   |
| ------------------------------------ | ------------------------------------------------------------------------------- | ------------------------ |
| H1 + intro                           | One welcoming sentence and the thesis: the path that ships starts with an issue | 4                        |
| `## Start with an issue`             | What to file and what to put in it; problem over proposal                       | 8                        |
| `## Check the package's scope first` | Point at `## Scope and non-goals`; why reading it first saves the filer effort  | 8                        |
| `## Pull requests`                   | Case-by-case after discussion; the may-be-reimplemented paragraph               | 12                       |
| `## Conventions a change is held to` | Five-row table plus a link to `AGENTS.md` and the README's `## Development`     | 16                       |
| `## Credit`                          | How `Co-authored-by:` and the close comment work                                | 8                        |
| Blank lines                          | —                                                                               | ~18                      |
| **Total**                            | —                                                                               | **~74, hard ceiling 95** |

### Worked draft

This is the target, not a placeholder — the build step refines wording, not shape or size.

````markdown
# Contributing

Thanks for your interest in these packages.
Contributions are welcome, and the path that reliably ships starts with an issue.

## Start with an issue

File a [bug report or feature request](https://github.com/gotgenes/pi-packages/issues/new/choose) describing the problem, the use case behind it, and the pain it causes.
Describing the problem matters more than proposing a solution, because the problem is what any design gets judged against.
The templates ask for the package, the version, and a reproduction; filling those in fully is usually all that is needed.

## Check the package's scope first

Every package README has a `## Scope and non-goals` section stating what that package is for, what it deliberately will not do, and where an adjacent request belongs.
Reading it before filing saves you writing up a request that is already out of scope, and it often points at the package that does own the capability.
The READMEs are linked from the [package table](./README.md#packages).

## Pull requests

Pull requests are considered case by case, after the underlying issue has been discussed.
Discussing the problem first is what makes a contribution likely to land: a pull request opened before that discussion often needs substantial rework against conventions it could not have known about.

An accepted contribution may land as a reimplementation rather than a merge of your branch, so that the change fits the package's existing design and test structure.
If so, the resulting commits carry `Co-authored-by:` for you, and the pull request is closed with a comment linking them.

## Conventions a change is held to

[`AGENTS.md`](./AGENTS.md) is the full reference; these are the ones a change meets first.
Prerequisites, setup, and the commands themselves are in the README's [Development](./README.md#development) section.

| Convention            | What it means                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Conventional Commits  | `type(scope): subject`, with a breaking change written `feat(pkg)!:` — the `!` after the scope. A `commit-msg` hook checks the header. |
| Tests first           | A bug fix ships a test that fails without the fix and passes with it.                                                                  |
| Green checks          | `pnpm run check`, `pnpm run lint`, and `pnpm run test` all pass.                                                                       |
| pnpm only             | Never `npm` or `npx`. Node 22 or newer, pnpm 11.                                                                                       |
| One sentence per line | Markdown is written one sentence to a line, enforced by `rumdl`.                                                                       |

## Credit

When your issue or pull request leads to a change, the resulting commits carry a `Co-authored-by:` trailer with your name and email, and the issue or pull request is closed with a comment naming you and linking the implementing commits.
That holds whether the change was merged from your branch or rebuilt from it.
````

### Link forms

| Link                                                                 | Form                                                                   | Why                                                                                                                        |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `CONTRIBUTING.md` → `README.md`, `AGENTS.md`                         | Repo-relative (`./README.md#packages`)                                 | Root file, ships in no tarball; relative links resolve on GitHub                                                           |
| `CONTRIBUTING.md` → the issue chooser                                | Absolute (`https://github.com/gotgenes/pi-packages/issues/new/choose`) | Not a file path                                                                                                            |
| `README.md` → `CONTRIBUTING.md`                                      | Repo-relative (`./CONTRIBUTING.md`)                                    | Both are root files; the README ships in no tarball either                                                                 |
| `config.yml` `contact_links[].url`                                   | Absolute                                                               | GitHub requires an absolute URL in `contact_links`                                                                         |
| `pi-subagents/docs/architecture/architecture.md` → `CONTRIBUTING.md` | Absolute                                                               | That directory **is** in the package's `files` allowlist; a relative link would resolve to nothing in the tarball ([#647]) |

### README insertion

Insert a new `## Contributing` between `## Uninstall` (ends line 49) and `## Development` (line 50), three lines total:

````markdown
## Contributing

Issues are the front door — see [CONTRIBUTING.md](./CONTRIBUTING.md) for how contributions work here.
````

Placement is deliberate: after install/uninstall (what a user needs) and before `## Development` (which is dominated by the maintainer's agentic workflow, not contributor onboarding).
Per the `markdown-conventions` skill's insertion rule, this seam reparents nothing — `## Uninstall`'s content ends with a fenced block and `## Development` opens its own `###` subtree.

### Issue-chooser wiring

`.github/ISSUE_TEMPLATE/config.yml` becomes:

````yaml
blank_issues_enabled: false
contact_links:
  - name: Contributing guide
    url: https://github.com/gotgenes/pi-packages/blob/main/CONTRIBUTING.md
    about: How contributions work here — start with an issue, and check the package's scope and non-goals first.
````

`contact_links` are **additive**: they render alongside the two templates on the chooser page and do not replace or hide them, and they are compatible with `blank_issues_enabled: false`.
The rendered result is only observable after the change is on `main`, so it is a post-push verification, not a pre-push one.

## Module-Level Changes

| Path                                                      | Change                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `CONTRIBUTING.md`                                         | New; five `##` sections, ~74 lines, hard ceiling 95                                                                                        |
| `README.md`                                               | Add a three-line `## Contributing` section between `## Uninstall` and `## Development`; `## Development` and every other section untouched |
| `.github/ISSUE_TEMPLATE/config.yml`                       | Add a `contact_links` list with one entry pointing at the guide's absolute URL                                                             |
| `packages/pi-subagents/docs/architecture/architecture.md` | Line 60: change the forward reference "belongs in `CONTRIBUTING.md`" to a pointer at the now-existing file, as an absolute GitHub URL      |
| `docs/plans/0776-contributing-guide.md`                   | This plan                                                                                                                                  |
| `docs/retro/0776-contributing-guide.md`                   | Stage notes                                                                                                                                |

Explicitly unchanged: all nine `packages/*/README.md` (no inbound link is added, so no shipped-README link can break in a tarball), `.github/ISSUE_TEMPLATE/bug_report.yml` and `feature_request.yml`, `AGENTS.md`, `.pi/prompts/pr-review.md`, `release-please-config.json`, every `package.json`, and all source and test files.

Grep sweep performed at planning time.
`rg -n CONTRIBUTING` across the repo (excluding `node_modules` and `.git`) returns exactly four hits: `docs/plans/0775-package-scope-and-non-goals.md:45`, `docs/plans/0775-evidence/pi-subagents.md` (two, both flagging the routing question), `docs/retro/0775-package-scope-and-non-goals.md:58`, and `packages/pi-subagents/docs/architecture/architecture.md:60`.
The three under `docs/` are historical records of completed sessions and are correct as written; only the architecture line is a live forward reference, and it is listed above.
No `.pi/skills/` file mentions contribution process, so no skill goes stale.

## Test Impact Analysis

No code changes, so no unit tests are added, removed, or made redundant.

Verification is documentary:

1. `pnpm exec rumdl check CONTRIBUTING.md README.md packages/pi-subagents/docs/architecture/architecture.md docs/plans/0776-*.md` passes.
2. `pnpm run lint` passes (`rumdl` plus Biome over the changed `.yml`).
3. `wc -l CONTRIBUTING.md` reports at most 95.
4. Every repo-relative link in `CONTRIBUTING.md` resolves to a real path, and every anchor (`README.md#packages`, `README.md#development`) matches an existing heading.
5. `git diff` on `README.md` shows exactly one added section and no change at or below line 50 of the pre-change file.
6. Post-push: the issue-chooser page (`/issues/new/choose`) shows both templates **and** the contributing link.

## Invariants at risk

| Invariant                                                                 | Source                                              | How this plan holds it                                                                                                       |
| ------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A shipped doc never relative-links into a non-shipped path                | `AGENTS.md` § Docs-in-distribution ([#647])         | The one inbound link, from `pi-subagents/docs/architecture/`, is an absolute GitHub URL; no package README is touched at all |
| No package tarball changes                                                | [#484], [#523]                                      | No `files` allowlist and no `package.json` is touched; `CONTRIBUTING.md` is root-level and matches no allowlist entry        |
| A change touching only excluded and root paths cuts no release            | `release-please-config.json` `exclude-paths`        | Verified: `packages/pi-subagents/docs/architecture` is in `exclude-paths`, and no other touched path sits under a component  |
| The issue templates keep working with blank issues disabled               | `.github/ISSUE_TEMPLATE/config.yml`                 | `contact_links` is additive and renders beside the templates; the templates themselves are unchanged                         |
| The README's agentic-workflow documentation stays intact                  | Root `README.md` `### Agentic development workflow` | The insertion is above `## Development`; verification step 5 pins it                                                         |
| A contributor-facing doc does not name a declined PR or quote merge rates | [#775] citation policy                              | Stated as a Non-Goal and enforced by the worked draft, which contains neither                                                |

## Build Order

1. **Write the guide.**
   Create `CONTRIBUTING.md` from the worked draft, refining wording only.
   Run `pnpm exec rumdl check` and `wc -l` before committing.
   Commit: `docs: add a contributing guide with an issues-first path (#776)`.
2. **Wire the pointers.**
   Add the README `## Contributing` section and the `contact_links` entry in one commit — both are pointers to the guide and neither means anything without it.
   Commit: `docs: surface the contributing guide from the README and issue chooser (#776)`.
3. **Resolve the forward reference.**
   Update `packages/pi-subagents/docs/architecture/architecture.md:60` to point at the file instead of predicting it.
   Commit: `docs(pi-subagents): point the contribution-pattern note at the contributing guide (#776)`.
4. **Verify.**
   Run the six Test Impact Analysis checks (the sixth after push, at ship time).
   Commit any fixes onto the step they belong to.

Three commits rather than one: step 3 carries a package scope and the first two do not, and separating the guide from its wiring keeps the diff that matters readable.

## Risks and Mitigations

| Risk                                                                | Mitigation                                                                                                                                                                                                                 |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The guide reads as a wall against contributors                      | The modal form ("may land as a reimplementation") plus the `## Credit` section; no merge rates, no named declined PR, and the reason for rework is stated as unknowable conventions rather than as the contributor's fault |
| Length regrowth — [#775]'s primary failure mode                     | A per-section line budget in this plan, a worked draft at the target size, and a `wc -l` ceiling of 95 as a verification step                                                                                              |
| The conventions table drifts from `AGENTS.md`                       | Five rows, each naming a rule that has been stable across many releases (Conventional Commits, tests-first, the three check commands, pnpm-only, one-sentence-per-line), with the detail left behind a link                |
| The reimplementation paragraph and `pr-review.md` diverge over time | The guide describes the outcome and the credit, not the decision procedure; `pr-review.md` owns the procedure, so the two can evolve independently                                                                         |
| `contact_links` hides or replaces the templates                     | It does not — the list is additive; verification step 6 confirms it on the rendered chooser page after push                                                                                                                |
| Adding a README section disturbs the surrounding structure          | Insertion point chosen at a clean seam and pinned by verification step 5 (`git diff` shows no change at or below the old line 50)                                                                                          |

## Open Questions

- Whether the guide should eventually state a review-turnaround expectation is deferred until there is one worth stating; an unmet promise is worse than silence.
- Whether `.pi/prompts/pr-review.md` should cite `CONTRIBUTING.md` so the two stay aligned is deferred.
  The prompt is agent-facing and already encodes the practice; a cross-link would be a second place to keep in sync for no reader.
- Whether a `.github/PULL_REQUEST_TEMPLATE.md` should point back at this guide is [#781]'s design call, not this plan's.

[#484]: https://github.com/gotgenes/pi-packages/issues/484
[#523]: https://github.com/gotgenes/pi-packages/issues/523
[#647]: https://github.com/gotgenes/pi-packages/issues/647
[#775]: https://github.com/gotgenes/pi-packages/issues/775
[#781]: https://github.com/gotgenes/pi-packages/issues/781
[#782]: https://github.com/gotgenes/pi-packages/issues/782
