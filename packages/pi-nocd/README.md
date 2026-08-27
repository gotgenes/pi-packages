# @gotgenes/pi-nocd

[![npm version](https://img.shields.io/npm/v/@gotgenes/pi-nocd?style=flat&logo=npm&logoColor=white)](https://www.npmjs.com/package/@gotgenes/pi-nocd) [![CI](https://img.shields.io/github/actions/workflow/status/gotgenes/pi-packages/ci.yml?style=flat&logo=github&label=CI)](https://github.com/gotgenes/pi-packages/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![pnpm](https://img.shields.io/badge/pnpm-%3E%3D11-F69220?style=flat&logo=pnpm&logoColor=white)](https://pnpm.io/) [![Pi Package](https://img.shields.io/badge/Pi-Package-6366F1?style=flat)](https://pi.mariozechner.at/)

Pi extension that appends an instruction to the system prompt forbidding the agent from `cd`-prefixing the current working directory.

## Why

Pi already tells the agent the resolved CWD: its system prompt ends with a `Current working directory: <path>` footer, and that line survives downstream shaping (for example [pi-anthropic-auth](https://github.com/gotgenes/pi-anthropic-auth), which only rewrites the preamble span and preserves the footer).

What Pi ships **nowhere** — default or shaped — is any _instruction_ against `cd`-prefixing the CWD.
The footer is a bare statement of fact, not a rule, so the habit of prefixing commands with `cd $(pwd) &&` survives.

This extension hooks `before_agent_start` and appends a block that adds the missing prohibition — forbidding both the literal `cd <path> &&` form and the generic `cd $(pwd) &&` form.
It repeats the literal resolved path (from `ctx.cwd`) only to make the forbidden `cd <path> &&` example concrete, not because the path is otherwise unavailable to the agent.

Because the block names a literal path, it has to be rebuilt for each session that carries it.
A subagent inherits its parent's system prompt verbatim, so a child sees a block naming the parent's directory — and a child given an isolated workspace (for example a git worktree from [@gotgenes/pi-subagents-worktrees](https://www.npmjs.com/package/@gotgenes/pi-subagents-worktrees)) would be told that shell commands already execute somewhere they do not.
An inherited block is therefore rewritten to name the current session's directory rather than deferred to.

## Install

```bash
pi install npm:@gotgenes/pi-nocd
```

Or add it to your Pi settings (`~/.pi/agent/settings.json`):

```json
{
  "packages": ["npm:@gotgenes/pi-nocd"]
}
```

## What it injects

For a session whose working directory resolves to `/Users/you/project`, the following block is appended to the system prompt:

```markdown
# Working Directory

Shell commands already execute in `/Users/you/project`.
Never prefix a command with `cd` into the current working directory — neither `cd /Users/you/project &&` nor `cd $(pwd) &&`.
Just run the command directly.
```

The result is idempotent: a prompt that already carries the block for this directory is returned unchanged, so chained `before_agent_start` handlers do not stack duplicates.
A block naming a _different_ directory — one inherited from a parent session — is rewritten in place, keeping its position stable across turns.
A section under the same heading that this extension did not write (e.g. another handler's) is left alone: a block is recognized by its heading _and_ its `Shell commands already execute in` sentence, not the heading alone.

## How it works

| Hook                 | Behavior                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `before_agent_start` | Ensures the prompt carries the working-directory block for the resolved `ctx.cwd`, appending or rewriting it as needed |

## Scope and non-goals

**Purpose.**
Pi tells the agent its working directory but never forbids `cd`-prefixing it.
This extension supplies the missing prohibition — and nothing else.

**In scope.**
The wording of the injected block, and correct path resolution when a child session inherits a parent's prompt or runs in an isolated workspace.

**Non-goals.**

- _Enforcing the rule._
  This extension instructs; it does not gate a command at execution time.
- _Owning the `# Working Directory` heading._
  A block written by another handler is left alone; only content this extension wrote is ever rewritten.
- _Telling the agent what its working directory is._
  Pi's own footer already does that; the literal path appears here only to make the forbidden example concrete.
- _Registering tools or commands._
  The entire surface is one `before_agent_start` hook, with no configuration.

## License

MIT
