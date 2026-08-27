# @gotgenes/pi-session-tools

[![npm version](https://img.shields.io/npm/v/@gotgenes/pi-session-tools?style=flat&logo=npm&logoColor=white)](https://www.npmjs.com/package/@gotgenes/pi-session-tools) [![CI](https://img.shields.io/github/actions/workflow/status/gotgenes/pi-packages/ci.yml?style=flat&logo=github&label=CI)](https://github.com/gotgenes/pi-packages/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![pnpm](https://img.shields.io/badge/pnpm-%3E%3D11-F69220?style=flat&logo=pnpm&logoColor=white)](https://pnpm.io/) [![Pi Package](https://img.shields.io/badge/Pi-Package-6366F1?style=flat)](https://pi.mariozechner.at/)

Pi extension providing session metadata tools for multi-session workflows.

## Tools

### `set_session_name`

Set the current session's display name (shown in the session selector).

```text
set_session_name({ name: "#42 Planning — Extract ExtensionPaths" })
```

Use a stage-encoded format to identify both the issue and workflow stage:

| Stage         | Format                       |
| ------------- | ---------------------------- |
| Planning      | `#N Planning — <title>`      |
| TDD           | `#N TDD — <title>`           |
| Build         | `#N Build — <title>`         |
| Retrospective | `#N Retrospective — <title>` |

### `get_session_name`

Get the current session's display name, if one has been set.

```text
get_session_name({})
```

### `read_session`

Read the current session's entries as a structured transcript.
Useful for retro lenses and cross-session context.

```text
read_session({ types?: string[], limit?: number })
```

Parameters:

- `types` — filter to specific entry types (e.g. `["message", "compaction"]`).
  Omit for all.
- `limit` — return only the most recent N entries after filtering.

The output is a human-readable transcript: numbered user/assistant turns, one-line tool call summaries with correlated result status, and metadata events (compaction, model changes).
Tool result bodies, thinking content, and image data are omitted.
A `[model change]` line renders only when the switch actually took effect — a marker followed by an assistant turn before the next switch or the end of entries.
A phantom switch (e.g. cycling the TUI model picker with no turn run after it) is omitted from both the transcript and the `model changes` count.

In the TUI the tool row shows a compact summary by default (e.g. `✓ 42 entries — 38 messages, 18 tool calls, 2 compactions`).
Press `Ctrl-O` to expand to the full transcript.
The model always receives the full transcript regardless of the TUI state.

```text
1. user
How do I fix the login bug?

---

2. assistant [anthropic/claude-sonnet-4-20250514]
Let me check the auth flow.
  [tool] Read — path: src/auth/login.ts → completed
  [tool] Bash — command: pnpm vitest login → error
The test is failing because...

---

[compaction] Context compacted (48000 tokens before)

---

[model change] → anthropic/claude-opus-4-20250514

---

3. assistant [anthropic/claude-opus-4-20250514]
Looking at the recent commits...
```

### `read_parent_session`

Read the parent session's entries as a structured transcript when running inside a subagent.
Derives the parent session file from the subagent directory layout.
Returns an error if not running in a subagent context.

```text
read_parent_session({ types?: string[], limit?: number })
```

Parameters and output format are the same as `read_session`.

### `read_session_file`

Read an arbitrary session file as a structured transcript, given its path.
Useful for reading a **sibling** session that neither `read_session` (current session only) nor `read_parent_session` (parent-via-subagent only) can reach — for example, a peer worktree session in the parallel-worktree ship flow.

```text
read_session_file({ path: string, types?: string[], limit?: number })
```

Parameters:

- `path` — absolute path to a session `.jsonl` file.
- `types` / `limit` — same as `read_session`.

Output format is the same as `read_session`.
Returns a status message (not an error) when the file does not exist.

### `list_session_files`

List a working directory's session files, newest first.
Encodes the given `cwd` to Pi's session-directory naming convention (`--<cwd with slashes replaced by dashes>--` under the sessions root) and lists the `.jsonl` files found there, so a caller does not have to hand-roll the encoding.
Pass a listed path to `read_session_file` to render it as a transcript.

```text
list_session_files({ cwd: string })
```

Parameters:

- `cwd` — the working directory whose session files to list (e.g. a peer worktree path).
  Required — there is no default, since the sibling-session use case always targets a directory other than the current session's own.

```text
Session directory: /Users/chris/.pi/agent/sessions/--Users-chris-worktrees-issue-546--
2 session files, newest first:
  /Users/chris/.pi/agent/sessions/--Users-chris-worktrees-issue-546--/2026-07-06T10-00-00Z_.jsonl
  /Users/chris/.pi/agent/sessions/--Users-chris-worktrees-issue-546--/2026-07-05T09-00-00Z_.jsonl
```

## Install

```bash
pi install npm:@gotgenes/pi-session-tools
```

Or add it to your Pi settings (`.pi/settings.json`):

```json
{
  "packages": ["npm:@gotgenes/pi-session-tools"]
}
```

## Scope and non-goals

**Purpose.**
A multi-session workflow needs two things Pi does not otherwise expose to an extension: a way to label the current session, and a way to read a session's transcript — including a parent's or a sibling's.

**In scope.**
Rendering a transcript more usefully for whoever reads it, and reaching a session the existing tools cannot reach.
A new capability arrives as a new tool rather than as another parameter on an existing one.

**Non-goals.**

- _Mutating transcript content._
  Session metadata is writable; transcript entries are read-only — no editing, redacting, replaying, or pruning.
- _A raw or JSON passthrough mode._
  Anything needing unrendered entries can read the session `.jsonl` directly.
- _Owning Pi's session storage format._
  The directory encoding and entry schema belong to Pi; this package matches them rather than improving them.
- _Path allowlisting for `read_session_file`._
  The agent already has `Read` and `Bash` on any file, so restricting one tool adds friction without a security boundary.
- _Analytics and roll-ups._
  Per-turn attribution and flat counts are emitted; interpreting them is the calling prompt's job.

## License

MIT
