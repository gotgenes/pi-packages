# @gotgenes/pi-subagents-worktrees

[![npm version](https://img.shields.io/npm/v/@gotgenes/pi-subagents-worktrees?style=flat&logo=npm&logoColor=white)](https://www.npmjs.com/package/@gotgenes/pi-subagents-worktrees) [![CI](https://img.shields.io/github/actions/workflow/status/gotgenes/pi-packages/ci.yml?style=flat&logo=github&label=CI)](https://github.com/gotgenes/pi-packages/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![pnpm](https://img.shields.io/badge/pnpm-%3E%3D11-F69220?style=flat&logo=pnpm&logoColor=white)](https://pnpm.io/) [![Pi Package](https://img.shields.io/badge/Pi-Package-6366F1?style=flat)](https://pi.mariozechner.at/)

Git worktree isolation for [`@gotgenes/pi-subagents`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-subagents).

This extension registers a `WorkspaceProvider` with the subagents core: opted-in agents run in a temporary git worktree (an isolated copy of the repo), and any changes they make are saved to a branch when they finish.
Worktrees are one *workspace strategy*, not core behavior — so the git plumbing lives here, outside the minimal subagents core (see [ADR-0002] in the pi-subagents package).

## Install

Install **after** `@gotgenes/pi-subagents`.
Pi loads packages in the order they are listed in `.pi/settings.json`, and this extension registers its provider with the subagents service at load time — so the subagents core must load first.

```json
{
  "packages": [
    "npm:@gotgenes/pi-subagents",
    "npm:@gotgenes/pi-subagents-worktrees"
  ]
}
```

If `@gotgenes/pi-subagents` is not loaded first (or not installed at all), this extension does nothing.

## Configuration

Worktree isolation is **opt-in per agent type**.
List the agent types that should run in a worktree in a `subagents-worktrees.json` file:

- Global: `~/.pi/agent/subagents-worktrees.json`
- Project: `<cwd>/.pi/subagents-worktrees.json` (overrides global)

```json
{
  "worktreeAgents": ["general-purpose", "refactorer"]
}
```

An agent type not in `worktreeAgents` runs in the parent working directory, exactly as if this extension were not installed.

## Behavior

- A child whose agent type is listed gets a fresh detached worktree at `HEAD` before it runs.
- When the child finishes with no changes, the worktree is removed.
- When the child finishes with changes, they are committed to a branch (`pi-agent-<id>`), and the child's result gains a note: `Changes saved to branch \`<branch>\`. Merge with: \`git merge <branch>\``.
- If cleanup fails partway through (e.g. a pre-commit hook rejects the safety-net commit), the worktree is **left in place** rather than removed, and the child's result gains a note: `Worktree cleanup failed and was left in place for manual recovery at \`<path>\`: <error>`.
- If worktree creation fails for an opted-in agent (not a git repo, no commits yet, or `git worktree add` fails), the child run **fails** with an explanatory error rather than silently running unisolated.

## Migrating from `isolation: "worktree"`

Earlier versions of `@gotgenes/pi-subagents` accepted an `isolation: "worktree"` spawn flag.
That flag was removed from the core; install this package and list the agent types you want isolated in `worktreeAgents` instead.

## License

MIT

[ADR-0002]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/docs/decisions/0002-extensions-on-a-minimal-core.md
