# Session-Scoped Approvals

When any permission resolves to `ask`, the permission dialog offers at least these four options:

```text
Yes | Yes, allow "<pattern>" for this session | No | No, provide reason
```

Selecting **Yes, allow "\<pattern\>" for this session** approves the current request and records the suggested wildcard pattern as a session rule.
Subsequent requests that match the pattern skip the prompt for the remainder of the session.

A file-access ask adds a fifth option — see [Grant direction](#grant-direction).

Session approvals are ephemeral — they are never persisted to disk and are cleared on `session_shutdown`.

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
| external_directory (directory)  | `ls /other/project`          | `/other/project/*`        |

A path that names an existing directory (`ls`, `find`, `grep`, or an extension tool's directory argument) is scoped to that directory, not its parent.
The approval records two rules — the directory itself and `<dir>/*` — so a repeated `ls` of the directory and every file beneath it are covered, while a sibling directory such as `/other/project-b` still asks.
The dialog names the pair by its contents glob, `"/other/project/*"`.
A path that does not exist yet, or a bash token whose base directory is unknown, keeps the parent-directory scope.

When a path ask proves no read/write direction (an extension tool, or `edit`), the session option names its scope as `Yes, allow access to "<pattern>" for this session`.

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

For recognized prefix wrappers, suggestions retain the wrapper, its options and operands, and the inner command's arity prefix.
For example, `nohup mytool argument` suggests `nohup mytool *`, not `nohup *`; `sudo aws s3 rm s3://bucket` suggests `sudo aws s3 rm *`; and `timeout 5 mytool argument` suggests `timeout 5 mytool *`.
Nested wrappers retain each layer, so `sudo -u root nohup mytool argument` suggests `sudo -u root nohup mytool *`.
Wrapped prefixes always use a space before the trailing wildcard, so an approval for `nohup mytool` does not also approve `nohup mytool-other`.
Unknown wrapper options, shell quoting or expansion, inline-shell payloads, parallel command templates, and `find`/`fd` exec forms retain the whole command without adding a wildcard.
An `xargs -I` replacement may vary arguments of an ordinary fixed executable, so `xargs -I X mytool X first` still suggests `xargs -I X mytool *`.
A replacement combined with a nested wrapper, or one that changes the inner arity prefix, instead keeps the whole command: `xargs -I X nohup X first` and `xargs -I X git X first` gain no appended wildcard.
The session walk reads `sudo`, `env`, `xargs`, and `doas` through the same getopt grammars as the wrapper peel, including short-option clusters, attached values, and unambiguous long-option abbreviations.
The optional values of GNU `xargs -i`, `-l`, and `--max-lines` never consume the following command word; `-i` and `--replace` use the same conservative replacement check as `-I`.
Options that refuse the peel, such as `env -C`, `-S`, `-P`, or `-a`, also keep the whole session command without an appended wildcard.
The wrapper interpretation shares the gate's vocabulary in `src/access-intent/bash/wrapper-analysis.ts`; it does not change the gate's wrapper floors or exemptions.

## Review Log Entries

The review log records session approval decisions:

- `resolution: "approved_for_session"` — when the user approves with the session pattern
- `sessionGrantWidth: "proven" | "family"` — beside it, the direction width the grant was recorded at (see [Grant direction](#grant-direction))
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
