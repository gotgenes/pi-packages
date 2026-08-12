# Session-Scoped Approvals

When a permission resolves to `ask`, the local permission dialog offers these outcomes:

- Approve this request once.
- Approve the proposed pattern for this session.
- Edit the proposed pattern.
- Persist an `allow` rule to trusted project-local policy.
- Persist an `allow` rule to global policy.
- Deny, optionally with a reason.

Selecting the session choice approves the current request and records the displayed wildcard pattern in memory.
Subsequent requests that match it skip the prompt until `session_shutdown`.
Editing changes the rule that is recorded; it never changes the permission surface.

## Durable Approvals

Project persistence writes only to `<cwd>/.pi/extensions/pi-permission-system/config.local.json`, and is offered only after Pi trusts the project.
It never modifies shared project `config.json`, agent frontmatter, Pi settings, or `.gitignore`.
Global persistence writes `~/.pi/agent/extensions/pi-permission-system/config.json` (respecting `PI_CODING_AGENT_DIR`).

By default, a summary shows the surface, every exact pattern, `allow`, scope, and destination before writing.
Press `t` in the inline prompt, or use `/permission-system` settings, to persistently toggle **Show summary before saving**.
When the summary is disabled, selecting project or global persistence saves after the configured hotkey confirmation without a separate summary or typed acknowledgement.

Writes preserve unrelated JSONC comments and formatting, validate the complete result, and atomically replace the destination.
Policy reloads immediately.
If writing or reload fails, the pending request is denied, the original file is restored, and the failure is recorded in the review log.

Persistent rules use normal precedence and most-restrictive composition.
A global or project-local allow cannot override a higher-precedence agent rule or a deny on `path` / `external_directory`.
To roll back, remove the generated pattern from the displayed destination and reload Pi.

Forwarded subagent prompts do not offer editing or durable persistence in this release because the requester must perform its own project-trust check.

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

Bash pattern suggestions use a curated arity dictionary (`src/bash-arity.ts`) to determine how many tokens define the "human-understandable subcommand."
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
To add an entry, open `src/bash-arity.ts` and add a key/arity pair to the `ARITY` object.
Put the most specific multi-word prefix first (e.g. `"npm run": 3`) before the shorter fallback (`"npm": 2`).

## Review Log Entries

The review log records session approval decisions:

- `resolution: "approved_for_session"` — when the user approves with the session pattern
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
