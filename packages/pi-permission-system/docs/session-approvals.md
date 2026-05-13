# Session-Scoped Approvals

When any permission resolves to `ask`, the permission dialog offers six options:

```text
Yes | Yes, allow "<pattern>" for this session | Yes, enter a custom pattern for this session | Yes, save a custom pattern to config | No | No, provide reason
```

Selecting **Yes, allow "\<pattern\>" for this session** approves the current request and records the suggested wildcard pattern as a session rule.
Subsequent requests that match the pattern skip the prompt for the remainder of the session.

Selecting **Yes, enter a custom pattern for this session** opens a second chooser with several candidate patterns derived from the current request.
After choosing a candidate, an input box is shown with that pattern prefilled so it can be accepted as-is or edited before saving.
Selecting `← Back` or dismissing a nested chooser returns to the previous permission choice instead of denying the request.
The final pattern approves the current request and is recorded as a session rule.
Use this when the suggested pattern is too broad or too narrow but the approval should remain temporary.

Selecting **Yes, save a custom pattern to config** uses the same candidate-pattern chooser and editable input flow, then asks whether to save the final pattern to the project config or the global config.
The config-target chooser also includes `← Back`, allowing the user to return to the top-level permission choices before anything is written.
The saved rule uses `allow` as the permission action, so future matching requests are approved without prompting according to normal config precedence.
Use this when the pattern should persist across sessions.

Session approvals are ephemeral — they are never persisted to disk and are cleared on `session_shutdown`.
Persisted custom patterns are written to config and remain until removed or overridden.

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
