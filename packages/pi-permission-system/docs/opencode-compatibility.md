# OpenCode Compatibility

This extension's flat permission format and evaluation semantics were directly inspired by [OpenCode's permission model](https://opencode.ai/docs/permissions/) (v1.1.x permission rework).
If you are familiar with OpenCode's permission system, most concepts transfer directly — the same mental model applies.

> **Point-in-time reference.**
> This comparison reflects OpenCode as of May 2026.
> See the [official OpenCode permissions docs](https://opencode.ai/docs/permissions/) for the latest upstream behavior.

## What Transfers Directly

The following concepts are shared between OpenCode and this extension:

| Concept                       | Description                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Three actions                 | `allow` / `ask` / `deny` — identical semantics                                                                  |
| Flat `permission` object      | Top-level key in config; surface names as keys                                                                  |
| `"*"` universal fallback      | Sets the default action when no surface-specific rule matches                                                   |
| Granular object syntax        | Surface key → string (catch-all) or `{ pattern: action }` map                                                   |
| Last-match-wins               | When multiple patterns match, the last one in config order wins                                                 |
| `*` wildcard                  | Matches zero or more of any character (including path separators)                                               |
| `?` wildcard                  | Matches exactly one character                                                                                   |
| Home directory expansion      | `~/`, `$HOME/`, and `${HOME}/` expand to the OS home directory in patterns                                      |
| `external_directory` surface  | Gates access to paths outside the working directory                                                             |
| `bash` surface                | Command patterns matched against shell commands                                                                 |
| `skill` surface               | Skill name patterns matched against skill invocations                                                           |
| `task` surface                | Gates subagent/delegation tool calls                                                                            |
| Session-scoped approvals      | `once` / `always` / `reject` from the ask dialog; `always` adds a session rule                                  |
| Per-agent overrides           | Override global permissions for specific agents                                                                 |
| Tool hiding                   | Denied tools are removed before the agent starts (no wasted turns probing)                                      |
| Bash path extraction          | Tree-sitter AST parsing to detect external paths in shell commands (see [details below](#bash-path-extraction)) |
| Bash arity table              | Generates smart approval pattern suggestions (e.g., `git checkout *` not `git *`)                               |
| Trailing wildcard optionality | `"ls *"` matches bare `"ls"` — the trailing `*` is optional                                                     |

If your OpenCode config uses these features, the equivalent works in this extension with minimal translation (see [Porting Guide](#porting-an-opencode-config) below).

## Where They Diverge

### Summary Table

| Area                       | OpenCode                                                             | This extension                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default fallback           | `"*": "allow"` (permissive)                                          | `"*": "ask"` (least privilege)                                                                                                                        |
| `.env` file protection     | Built-in `read` rules deny/ask `.env` files                          | No built-in rules; user configures with the cross-cutting `path` surface or per-tool path patterns (see [porting guide](#porting-an-opencode-config)) |
| Cross-cutting `path` gate  | No equivalent — `.env` protection is per-tool only                   | `path` surface denies/asks across all tools and bash at once; a `path` deny cannot be overridden by a per-tool allow                                  |
| OpenCode-only surfaces     | `lsp`, `question`, `webfetch`, `websearch`, `todowrite`, `doom_loop` | Not applicable — Pi does not expose these tools or events                                                                                             |
| File mutation surfaces     | `edit` covers `edit`, `write`, `apply_patch`                         | Separate `write` and `edit` surfaces                                                                                                                  |
| Search/discovery surfaces  | `glob`, `grep`, `list`                                               | `find`, `grep`, `ls` (Pi tool names)                                                                                                                  |
| `mcp` surface              | Not a documented permission surface                                  | First-class with server/tool-level granularity                                                                                                        |
| Top-level string shorthand | `"permission": "allow"` sets all surfaces                            | Not supported; must use an object                                                                                                                     |
| Per-agent config location  | `agent` key in config JSON or YAML frontmatter                       | YAML frontmatter in agent `.md` files only                                                                                                            |
| Config file paths          | `~/.config/opencode/opencode.json`                                   | `~/.pi/agent/extensions/pi-permission-system/config.json`                                                                                             |
| Subagent prompt forwarding | Not documented                                                       | `ask` policies work in non-UI subagent contexts                                                                                                       |
| Infrastructure auto-allow  | N/A                                                                  | Read-only tools to Pi infra dirs bypass the gate                                                                                                      |
| Permission review log      | No equivalent documented                                             | Writes decisions to a JSONL audit log                                                                                                                 |

### Notable Differences Explained

#### Default Fallback: `allow` vs `ask`

OpenCode defaults to permissive — most tools work without configuration.
This extension defaults to least privilege — omitting `"*"` gives you `"ask"` for everything.

If you want OpenCode-like permissiveness:

```jsonc
{
  "permission": {
    "*": "allow",
    "external_directory": "ask"
  }
}
```

#### File Mutation Surfaces

OpenCode unifies all file writes under a single `edit` permission.
This extension exposes Pi's actual tool names: `write` (create/overwrite) and `edit` (targeted replacement).

To replicate OpenCode's unified behavior, set both to the same action:

```jsonc
{
  "permission": {
    "write": "ask",
    "edit": "ask"
  }
}
```

#### MCP Surface (Pi-Only)

This extension provides a first-class `mcp` permission surface with granular server and tool-level control:

```jsonc
{
  "permission": {
    "mcp": {
      "*": "ask",
      "mcp_status": "allow",
      "myServer:*": "ask",
      "dangerousServer": "deny"
    }
  }
}
```

OpenCode does not expose MCP as a configurable permission surface.

#### Bash Path Extraction

Both systems use `web-tree-sitter` + `tree-sitter-bash` to parse shell commands into an AST for `external_directory` path detection, but the extraction strategies differ significantly:

**OpenCode** only extracts paths from a hardcoded allowlist of file-manipulating commands (`rm`, `cp`, `mv`, `mkdir`, `touch`, `chmod`, `chown`, `cat`, plus PowerShell equivalents).
Commands not in the list — including `sed`, `awk`, `grep` — get no path extraction at all.
For allowlisted commands, all non-flag positional arguments are assumed to be paths.

**This extension** extracts path candidates from all commands generically, then applies additional intelligence:

- A `PATTERN_FIRST_COMMANDS` map understands flag arity for `sed`, `awk`, `grep`, `rg`, and similar tools, distinguishing inline patterns/scripts from file arguments to avoid false positives.
  The same table reads an interpreter's inline script (`node -e`, `bun --eval`, `python3 -c`, `perl -e`, `ruby -e`) as a script rather than an operand, while leaving a script *file* (`node build.js`) an operand.
- Redirect destinations (`> /path/to/file`) are extracted.
- Heredoc bodies, comments, and variable assignments are skipped.

The result is broader coverage (paths detected in any command, not just a curated list) with fewer false positives on pattern-first commands (no spurious prompts for sed regexes or grep patterns that happen to contain `/`).

## Porting an OpenCode Config

### Before (OpenCode)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "*": "allow",
    "bash": {
      "*": "ask",
      "git *": "allow",
      "npm *": "allow",
      "rm *": "deny"
    },
    "edit": {
      "*": "ask",
      "src/*.ts": "allow"
    },
    "external_directory": {
      "~/projects/*": "allow"
    }
  }
}
```

### After (this extension)

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/gotgenes/pi-packages/main/packages/pi-permission-system/schemas/permissions.schema.json",
  "permission": {
    "*": "allow",
    "bash": {
      "*": "ask",
      "git *": "allow",
      "npm *": "allow",
      "rm *": "deny"
    },
    "write": "ask",
    "edit": "ask",
    "external_directory": {
      "*": "ask",
      "~/projects/*": "allow"
    }
  }
}
```

### Key Translation Steps

1. **Replace `"permission": "allow"`** (top-level string) with `"permission": { "*": "allow" }`.

2. **Split `edit`** into separate `write` and `edit` entries if you need different policies for create vs. modify.
   If not, set both to the same action.

3. **Rename search surfaces**: `glob` → `find`, `list` → `ls`.

4. **Add `.env` rules manually** if you relied on OpenCode's built-in protection.
   The `path` surface is the recommended approach — it covers all tools and bash in one rule:

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

   Alternatively, use per-tool patterns if you only need to protect specific tools (e.g., `read`):

    ```jsonc
    {
      "permission": {
        "read": {
          "*": "allow",
          "*.env": "deny",
          "*.env.*": "deny",
          "*.env.example": "allow"
        }
      }
    }
    ```

5. **Remove OpenCode-only surfaces** (`lsp`, `question`, `webfetch`, `websearch`, `todowrite`, `doom_loop`) — they have no effect in this extension.

6. **Add `mcp` rules** if you use MCP servers — OpenCode has no equivalent, so this is new configuration.
