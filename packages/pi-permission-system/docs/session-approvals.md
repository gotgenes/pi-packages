# Session-Scoped Approvals

When any permission resolves to `ask`, the permission dialog offers at least these four options:

```text
Yes | Yes, allow "<pattern>" for this session | No | No, provide reason
```

Selecting **Yes, allow "\<pattern\>" for this session** approves the current request and records the suggested wildcard pattern as a session rule.
Subsequent requests that match the pattern skip the prompt for the remainder of the session.

A file-access ask adds a fifth option — see [Grant direction](#grant-direction).
A local (not forwarded) ask that carries a proposal adds three more: edit the proposed pattern(s), persist an `allow` rule to trusted project-local policy, or persist it globally — see [Durable approvals](#durable-approvals).

Session approvals are ephemeral — they are never persisted to disk and are cleared on `session_shutdown`.
Editing changes the pattern that is recorded; it never changes the permission surface a grant was proven on.

## Durable Approvals

Project persistence writes only to `<cwd>/.pi/extensions/pi-permission-system/config.local.json`, and is offered only after Pi trusts the project.
It never modifies shared project `config.json`, agent frontmatter, Pi settings, or `.gitignore`.
Global persistence writes `~/.pi/agent/extensions/pi-permission-system/config.json` (respecting `PI_CODING_AGENT_DIR`).

By default, a summary shows every exact rule — surface, pattern, `allow` — plus the scope and destination before writing.
Press `t` in the inline prompt, or use `/permission-system` settings, to persistently toggle **Show summary before saving**.
When the summary is disabled, selecting project or global persistence saves after the configured hotkey confirmation without a separate summary or typed acknowledgement.

Writes preserve unrelated JSONC comments and formatting, validate the complete result, and atomically replace the destination.
Policy reloads immediately.
If writing or reload fails, the pending request is denied, the original file is restored, and the failure is recorded in the review log.

Persistent rules use normal precedence and most-restrictive composition.
A global or project-local allow cannot override a higher-precedence agent rule or a deny on `path` / `external_directory`.
To roll back, remove the generated pattern from the displayed destination and reload Pi.

Forwarded subagent prompts do not offer editing or durable persistence, because the requester must perform its own project-trust check.

## Grant Direction

The `path` and `external_directory` surfaces carry a read/write axis, and the two directions are independent permissions rather than tiers: a write grant does not imply a read.
When the gate can prove which direction a request needs — a `>` redirect proves a write, `cat` proves a read, the `read` tool proves a read — the session grant is recorded on that direction alone, which is what the prompt named.

That is least privilege, and it costs a second prompt in the read-after-write flow: approving `echo hello > /tmp/out.txt` grants a write, so a following `cat /tmp/out.txt` asks again.
So an ask whose paths all prove the **same** direction offers both widths:

```text
  (y) Yes
▶ (s) Yes, allow writes to "/tmp/*" for this session
  (b) Yes, allow reads and writes to "/tmp/*" for this session
  (n) No
  (r) No, provide reason
```

- **`s`** records the proven direction only (`external_directory_write` here).
  This is the default; a later read of the same path asks again.
- **`b`** records the bare family key (`external_directory`), which expands onto both directions — exactly the width a config key like `"external_directory": {"/tmp/*": "allow"}` has.
  A later read of the same path is covered.

The choice is opt-in per ask and never persisted.
Ignoring `b` grants no more than the prompt named.

`b` is offered only when one direction phrase describes the whole ask.
A command that proves a read of one path and a write of another (`cat /outside/a.ts > /elsewhere/b.ts`) records each path on its own direction and offers no width choice, because no single label would be true of both.
Surfaces with no capability axis — `bash`, `mcp`, `skill`, and the per-tool surfaces — never offer it.

Two paths in the **same** directory derive the same glob, so approving them at either width grants that directory what the prompt showed.

The review log records the width every session grant was taken at, as `sessionGrantWidth: "proven"` or `"family"`.

## Suggested Patterns

The suggested pattern is surface-specific:

| Surface                         | Example request              | Suggested session pattern |
| ------------------------------- | ---------------------------- | ------------------------- |
| bash                            | `git status --short`         | `git status *`            |
| mcp (qualified)                 | `exa:search`                 | `exa:*`                   |
| mcp (munged)                    | `exa_search`                 | `exa_*`                   |
| skill                           | `librarian`                  | `librarian`               |
| path                            | `src/.env`                   | `src/*`                   |
| tool with path (read, write, …) | `read` for `src/foo.ts`      | `src/*`                   |
| tool catch-all                  | `read` (no extractable path) | `*`                       |
| external_directory              | `/other/project/src/foo.ts`  | `/other/project/src/*`    |

## Bash Arity Table

Bash pattern suggestions use a curated arity dictionary (`src/access-intent/bash/bash-arity.ts`) to determine how many tokens define the "human-understandable subcommand."
Longest matching prefix wins, so `npm run` (arity 3) takes precedence over `npm` (arity 2).
Unknown commands default to arity 1 (first word only).

| Example command       | Arity entry matched  | Suggested pattern     |
| --------------------- | -------------------- | --------------------- |
| `git checkout main`   | `git` → 2            | `git checkout *`      |
| `npm run dev`         | `npm run` → 3        | `npm run dev*`        |
| `npm install lodash`  | `npm` → 2            | `npm install *`       |
| `docker compose up`   | `docker compose` → 3 | `docker compose up *` |
| `rm -rf node_modules` | `rm` → 1             | `rm *`                |
| `mytool --verbose`    | (unknown) → 1        | `mytool *`            |

The arity table covers common CLI tools including git, npm/pnpm/yarn/bun, docker, cargo, go, kubectl, gh, and others.
To add an entry, open `src/access-intent/bash/bash-arity.ts` and add a key/arity pair to the `ARITY` object.
Put the most specific multi-word prefix first (e.g. `"npm run": 3`) before the shorter fallback (`"npm": 2`).

## Review Log Entries

The review log records session approval decisions:

- `resolution: "approved_for_session"` — when the user approves with the session pattern
- `sessionGrantWidth: "proven" | "family"` — beside it, the direction width the grant was recorded at (see [Grant direction](#grant-direction))
- `resolution: "session_approved"` — when a later request is matched by an existing session rule
- `permission_rule.persistence_requested` — before trust revalidation and mutation
- `permission_rule.persistence_succeeded` — after atomic write and immediate reload
- `permission_rule.persistence_failed` — when validation, trust, write, or reload blocks persistence

## Permission Prompt Summaries

When a tool permission resolves to `ask`, the prompt is designed to be readable enough for an informed approval decision:

- `bash` prompts show the command and matched bash pattern when available.
- `mcp` prompts show the derived MCP target and matched rule when available.
- Built-in file tools show concise summaries, such as the target path and edit/write line counts, instead of raw multiline JSON.
- Unknown or third-party extension tools show a bounded single-line JSON preview of the input so users are not asked to approve a blind tool name.

Example edit approval prompt:

```text
Current agent requested tool 'edit' for '.gitignore' (1 replacement: edit #1 replaces 5 lines with 2 lines). Allow this call?
```
