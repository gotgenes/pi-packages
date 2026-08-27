# pi-packages

A monorepo of [Pi](https://github.com/badlogic/pi-mono) extension packages, published to npm under `@gotgenes/`.
Some packages (like pi-permission-system) are designed for broad use; others scratch a personal itch and are shared in case they help others.

## Packages

| Package                                                                      | Description                                                    | Downloads/month                                                                                                                                |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [@gotgenes/pi-permission-system](./packages/pi-permission-system/)           | Permission enforcement for the Pi coding agent                 | [![npm](https://img.shields.io/npm/dm/@gotgenes/pi-permission-system)](https://www.npmjs.com/package/@gotgenes/pi-permission-system)           |
| [@gotgenes/pi-permission-model-judge](./packages/pi-permission-model-judge/) | Deny-first typo-path model judge for pi-permission-system      | [![npm](https://img.shields.io/npm/dm/@gotgenes/pi-permission-model-judge)](https://www.npmjs.com/package/@gotgenes/pi-permission-model-judge) |
| [@gotgenes/pi-subagents](./packages/pi-subagents/)                           | Focused, in-process autonomous sub-agent core for Pi           | [![npm](https://img.shields.io/npm/dm/@gotgenes/pi-subagents)](https://www.npmjs.com/package/@gotgenes/pi-subagents)                           |
| [@gotgenes/pi-github-tools](./packages/pi-github-tools/)                     | Deterministic GitHub CI, release, and issue tools              | [![npm](https://img.shields.io/npm/dm/@gotgenes/pi-github-tools)](https://www.npmjs.com/package/@gotgenes/pi-github-tools)                     |
| [@gotgenes/pi-autoformat](./packages/pi-autoformat/)                         | Prompt-end auto-formatting (Biome, Prettier, etc.)             | [![npm](https://img.shields.io/npm/dm/@gotgenes/pi-autoformat)](https://www.npmjs.com/package/@gotgenes/pi-autoformat)                         |
| [@gotgenes/pi-colgrep](./packages/pi-colgrep/)                               | Semantic code search via ColGrep as an agent tool              | [![npm](https://img.shields.io/npm/dm/@gotgenes/pi-colgrep)](https://www.npmjs.com/package/@gotgenes/pi-colgrep)                               |
| [@gotgenes/pi-session-tools](./packages/pi-session-tools/)                   | Session naming and context bridge for multi-session workflows  | [![npm](https://img.shields.io/npm/dm/@gotgenes/pi-session-tools)](https://www.npmjs.com/package/@gotgenes/pi-session-tools)                   |
| [@gotgenes/pi-subagents-worktrees](./packages/pi-subagents-worktrees/)       | Git worktree isolation WorkspaceProvider for pi-subagents      | [![npm](https://img.shields.io/npm/dm/@gotgenes/pi-subagents-worktrees)](https://www.npmjs.com/package/@gotgenes/pi-subagents-worktrees)       |
| [@gotgenes/pi-nocd](./packages/pi-nocd/)                                     | System-prompt guard against cd-prefixing the working directory | [![npm](https://img.shields.io/npm/dm/@gotgenes/pi-nocd)](https://www.npmjs.com/package/@gotgenes/pi-nocd)                                     |

Each package has its own README with setup instructions, usage, and configuration details.

## Install

Install every package in this repo at once:

```bash
pi install git:github.com/gotgenes/pi-packages
```

Or install a single package via npm:

```bash
pi install npm:@gotgenes/<package-name>
```

## Uninstall

If installed via git:

```bash
pi remove git:github.com/gotgenes/pi-packages
```

If installed individually via npm:

```bash
pi remove npm:@gotgenes/<package-name>
```

## Contributing

Issues are the front door — see [CONTRIBUTING.md](./CONTRIBUTING.md) for how contributions work here.

## Development

### Prerequisites

- Node.js ≥ 22
- [pnpm](https://pnpm.io/) 11

### Setup

```bash
pnpm install
```

This installs dependencies and wires the `prek` git hooks automatically via the `prepare` script.
The hooks include a `pre-commit` stage (Biome, ESLint, rumdl) and a `commit-msg` stage that validates Conventional Commit headers via [committed](https://github.com/crate-ci/committed).

### Commands

```bash
pnpm run check    # typecheck all packages
pnpm run test     # test all packages
pnpm run lint     # biome + rumdl
pnpm run lint:fix # auto-fix lint issues
```

### Reviewing changes per package

`scripts/hunk-pkg-diff.sh <package-name> [hunk-options...]` reviews the working-tree diff of a single package against its most recent release tag, scoped to that package's directory, using [Hunk](https://github.com/modem-dev/hunk).
It resolves the latest `<component>-v<version>` tag and runs `hunk diff <tag> -- packages/<package>`.

```bash
scripts/hunk-pkg-diff.sh pi-subagents
scripts/hunk-pkg-diff.sh pi-permission-system --mode split
```

The tag glob is `<package>-v*` (not `<package>-*`) so `pi-subagents` does not match the sibling `pi-subagents-worktrees` tags.

An equivalent command for [Diffview.nvim](https://github.com/sindrets/diffview.nvim) is defined in the project-local `.nvim.lua`, sourced by [`nvim-config-local`](https://github.com/klen/nvim-config-local) when Neovim is opened in this repo:

```vim
:PkgDiffview pi-subagents
:PkgDiffview pi-permission-system
```

### Agentic development workflow

Always start Pi from the **repo root**:

```bash
pi
```

This gives the agent access to:

- `.pi/settings.json` — loads all packages from local source (with npm versions disabled)
- `.pi/prompts/` — slash commands (`/plan-improvements`, `/plan-issue`, `/tdd-plan`, `/ship-issue`, etc.)
- Root `AGENTS.md` — monorepo-wide conventions

#### Standard workflow

Development is driven by slash commands.
A discovery command, `/plan-improvements`, updates a package's architecture document and opens GitHub Issues for the work it identifies.
Each issue is then taken through a manual loop until it ships.
In the standard workflow a single session works one issue at a time, committing directly to a linear `main`.

```mermaid
flowchart LR
    PI["/plan-improvements"] -->|architecture doc + GitHub Issues| Plan

    subgraph Loop["Per-issue loop"]
        direction LR
        Plan["/plan-issue #N"] --> Kind{code or docs?}
        Kind -->|code| TDD["/tdd-plan"]
        Kind -->|docs / config| Build["/build-plan"]
        TDD --> Ship["/ship-issue #N"]
        Build --> Ship["/ship-issue #N"]
        Ship --> Retro["/retro"]
    end
```

| Stage            | Command                      | What happens                                                                                              |
| ---------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1. Discover      | `/plan-improvements`         | Updates a package's architecture document and creates GitHub Issues outlining the implementation work.    |
| 2. Plan          | `/plan-issue #N`             | Reads the issue, explores the codebase, produces a numbered plan, and commits it.                         |
| 3. Implement     | `/tdd-plan` or `/build-plan` | Executes the plan — TDD for code changes, build for docs/config. A pre-completion review runs at the end. |
| 4. Ship          | `/ship-issue #N`             | Pushes, verifies CI, closes the issue, and merges the release-please PR.                                  |
| 5. Retrospective | `/retro`                     | Reviews the session(s) for workflow improvements and persists retro notes.                                |

Each issue repeats stages 2–5.
Every stage can run in its own session; the prompt templates set a stage-encoded session name and write a `## Stage:` entry to a `docs/retro/NNNN-<slug>.md` file that bridges context across sessions.

#### Parallel worktree workflow

When two issues are independent — ideally in different packages — run them in parallel, each in its own git worktree and interactive Pi session off a short-lived branch.
`/worktree #N` (or `scripts/worktree-new.sh <issue>`) creates branch `issue-N-<slug>` off `origin/main`, checks out a worktree under `~/development/pi/pi-packages-worktrees/`, runs `pnpm install`, and opens a new terminal tab running `pi --approve "/plan-issue #N"`.
The peer session is born in its worktree (CWD set at spawn, never `cd`), so it has the full project config and never trips the `pi-permission-system` external-directory gate on its own files.
The launcher trusts the new worktree for both Pi (`--approve`) and `mise` (`mise trust`) — each tool gates trust by path, so a fresh worktree would otherwise block on a prompt or silently skip the `mise.toml` `[env]` PATH shims.

Each peer runs the same plan → implement loop as the standard workflow.
Shipping, though, is split across two sessions: `main` stays linear, and the trunk `/ship-issue` assumes a single writer, so a peer cannot push to `main` directly.

```mermaid
flowchart TB
    Root["Root session — main"]

    Root -->|"/worktree 42"| A1
    Root -->|"/worktree 43"| B1

    subgraph PeerA["Peer A — worktree issue-42"]
        direction TB
        A1["/plan-issue 42"] --> A2["/tdd-plan or /build-plan"] --> A3["/ship-worktree 42"]
    end

    subgraph PeerB["Peer B — worktree issue-43"]
        direction TB
        B1["/plan-issue 43"] --> B2["/tdd-plan or /build-plan"] --> B3["/ship-worktree 43"]
    end

    A3 -->|"rebased branch, hand off"| Land["Root — /land-worktree N<br/>ff-merge, push, CI, close, release, teardown"]
    B3 -->|"rebased branch, hand off"| Land
```

The convergence is a peer-to-root handoff.
The peer rebases its branch onto the latest `origin/main`; the root fast-forward-merges it into `main`.
Because both sessions share one `.git`, the root sees the branch ref directly — the peer never pushes the branch or force-pushes anything.

```mermaid
sequenceDiagram
    participant Peer as Peer (issue-N worktree)
    participant Root as Root (main)
    participant Origin as origin/main

    Note over Peer: /ship-worktree N
    Peer->>Peer: lint, fallow dead-code, /retro (committed on branch)
    Peer->>Origin: git fetch
    Peer->>Peer: git rebase origin/main
    Peer-->>Root: hand off — run /land-worktree N
    Root->>Origin: git pull --ff-only
    Note over Root: git merge --ff-only the peer branch
    Root->>Origin: git push (main advances)
    Root->>Root: verify CI, then issue_close
    Root->>Origin: merge release-please PR (serialized)
    Note over Root: scripts/worktree-rm.sh N --delete-branch
```

| Stage            | Command                                      | Session | What happens                                                                                 |
| ---------------- | -------------------------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| Launch           | `/worktree #N`                               | root    | Creates the branch + worktree, installs deps, opens a peer session running `/plan-issue #N`. |
| Plan + implement | `/plan-issue` → `/tdd-plan` or `/build-plan` | peer    | The standard loop, inside the worktree.                                                      |
| Ship prep        | `/ship-worktree #N`                          | peer    | Lint + `fallow dead-code`, `/retro` committed on the branch, then rebase onto `origin/main`. |
| Land             | `/land-worktree #N`                          | root    | ff-merge into `main`, push, verify CI, close the issue, release, and tear down the worktree. |

Guardrails:

- One package per peer — two peers touching `pnpm-lock.yaml`, `release-please-config.json`, or the same package's source is the main hazard.
- Release is the root's serialized responsibility — only the root merges the single release-please PR, so peers never race on it.
- Whoever lands second rebases first — if `/land-worktree`'s ff-merge is rejected because `main` advanced, the peer re-runs `/ship-worktree #N` to rebase onto the new `origin/main`, then the root retries.
- Tear down a worktree manually with `scripts/worktree-rm.sh <issue> [--delete-branch]`.

Package-specific context (architecture, priorities, testing strategy) lives in skills.
Load the relevant skill before working on a package:

- `package-pi-autoformat` — for `packages/pi-autoformat/`
- `package-pi-github-tools` — for `packages/pi-github-tools/`
- `package-pi-permission-system` — for `packages/pi-permission-system/`
- `package-pi-subagents` — for `packages/pi-subagents/`

The remaining packages (`pi-colgrep`, `pi-session-tools`, `pi-subagents-worktrees`, `pi-nocd`, `pi-permission-model-judge`) have no dedicated skill — their READMEs cover everything you need.

## License

MIT
