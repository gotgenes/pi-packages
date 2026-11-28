# Migration guide: legacy format → flat permission format

This guide covers migration from the pre-#66 config format to the flat `permission` format introduced in #66.

## Summary of changes

The old format had six top-level policy keys (`defaultPolicy`, `tools`, `bash`, `mcp`, `skills`, `special`).
The new format has a single `permission` key whose top-level entries map surface names to actions.

Runtime knobs (`debugLog`, `permissionReviewLog`, `yoloMode`) are **unchanged** and stay at the top level.

## Legacy file locations

The config once lived in three other places, and none of them is read anymore:

| Legacy file                                        | Move its settings to                                      |
| -------------------------------------------------- | --------------------------------------------------------- |
| `~/.pi/agent/pi-permissions.jsonc`                 | `~/.pi/agent/extensions/pi-permission-system/config.json` |
| `<cwd>/.pi/agent/pi-permissions.jsonc`             | `<cwd>/.pi/extensions/pi-permission-system/config.json`   |
| `config.json` in the extension's install directory | `~/.pi/agent/extensions/pi-permission-system/config.json` |

Each `pi-permissions.jsonc` file still present raises a notice at session start naming the file to move its settings to; the project one is noticed only in a trusted project.
The install-directory file is no longer looked for.

Whatever a legacy file set stops applying: its runtime knobs, its `commandEffects` declarations, and every other setting in it.
No permission rule was ever read from these files, so no rule is lost, but two settings can loosen a gate when they disappear:

- A `shellTools` entry stops routing its tool through your `bash` rules, so the tool is gated under its own name and a `bash` deny no longer reaches it.
- An `authorizerChain` link stops running, so an ask it would have denied reaches you instead, or under auto-approve is approved.

Copy each setting into the new file rather than moving the legacy file over it: a move overwrites any `config.json` already there.
A file in the legacy format (`defaultPolicy`, `tools`, …) also needs the translation below, since config files are validated strictly and an unrecognized key rejects the whole file (see [strict-config-validation.md](strict-config-validation.md)).

## Checklist

Go through each section below.
For each key present in your config, apply the translation and remove the old key.

- [ ] `defaultPolicy`
- [ ] `tools`
- [ ] `bash`
- [ ] `mcp`
- [ ] `skills`
- [ ] `special`
- [ ] Per-agent frontmatter

## Translation reference

### `defaultPolicy`

`defaultPolicy` set per-surface fallback actions.
In the flat format the universal fallback is `permission["*"]`; per-surface catch-alls are entries in the `permission` object.

```jsonc
// Before
{
  "defaultPolicy": {
    "tools": "ask",
    "bash": "ask",
    "mcp": "ask",
    "skills": "ask",
    "special": "ask"
  }
}

// After — all surfaces default to "ask" via the universal fallback
{
  "permission": {
    "*": "ask"
  }
}
```

If surfaces had **different** defaults, express each one explicitly:

```jsonc
// Before
{
  "defaultPolicy": {
    "tools": "allow",
    "bash": "ask",
    "mcp": "ask",
    "skills": "ask",
    "special": "deny"
  }
}

// After
{
  "permission": {
    "*": "allow",
    "bash": "ask",
    "mcp": "ask",
    "skill": "ask",
    "external_directory": "deny"
  }
}
```

### `tools`

Each entry in `tools` maps a tool name to a permission.
In the flat format, tool names are surface keys directly inside `permission`.

```jsonc
// Before
{
  "tools": {
    "read": "allow",
    "write": "deny",
    "edit": "ask"
  }
}

// After
{
  "permission": {
    "read": "allow",
    "write": "deny",
    "edit": "ask"
  }
}
```

**Special case — `tools.bash` and `tools.mcp`:** These were catch-all overrides for their respective surfaces.
In the flat format, use a string shorthand or an explicit `"*"` pattern:

```jsonc
// Before
{
  "tools": { "bash": "allow", "mcp": "deny" }
}

// After — string shorthand (equivalent to { "*": "allow" })
{
  "permission": {
    "bash": "allow",
    "mcp": "deny"
  }
}
```

### `bash`

Bash patterns translate directly; the surface name stays `bash`.
If you also had a `tools.bash` or `defaultPolicy.bash` value different from `defaultPolicy.tools`, add an explicit `"*"` catch-all pattern at the **start** of the object (so specific patterns placed after it override it via last-match-wins).

```jsonc
// Before
{
  "defaultPolicy": { "tools": "allow", "bash": "ask" },
  "bash": {
    "git status": "allow",
    "git diff": "allow",
    "git *": "ask",
    "rm -rf *": "deny"
  }
}

// After
{
  "permission": {
    "*": "allow",
    "bash": {
      "*": "ask",
      "git status": "allow",
      "git diff": "allow",
      "git *": "ask",
      "rm -rf *": "deny"
    }
  }
}
```

> **Note:** Pattern ordering matters within an object.
> `normalizeFlatConfig` preserves insertion order, and `evaluate` uses last-match-wins.
> Put broad catch-alls **first** and specific overrides **after** them.

### `mcp`

MCP patterns translate directly; the surface name stays `mcp`.

```jsonc
// Before
{
  "mcp": {
    "mcp_status": "allow",
    "mcp_list": "allow",
    "exa:*": "allow",
    "dangerous-server": "deny"
  }
}

// After
{
  "permission": {
    "mcp": {
      "mcp_status": "allow",
      "mcp_list": "allow",
      "exa:*": "allow",
      "dangerous-server": "deny"
    }
  }
}
```

### `skills`

The surface name changes from `skills` (plural) to `skill` (singular).

```jsonc
// Before
{
  "skills": {
    "*": "ask",
    "librarian": "allow",
    "dangerous-*": "deny"
  }
}

// After — note: "skills" → "skill"
{
  "permission": {
    "skill": {
      "*": "ask",
      "librarian": "allow",
      "dangerous-*": "deny"
    }
  }
}
```

### `special`

`special.external_directory` becomes a top-level surface key in `permission`.
Other deprecated keys (`doom_loop`, `tool_call_limit`) are simply dropped.

```jsonc
// Before
{
  "special": {
    "external_directory": "ask",
    "doom_loop": "deny",
    "tool_call_limit": "deny"
  }
}

// After — doom_loop and tool_call_limit are removed entirely
{
  "permission": {
    "external_directory": "ask"
  }
}
```

> **Note:** In the old format, `special.external_directory: "deny"` produced a rule with `matchedPattern: "external_directory"`.
> In the flat format, the string shorthand produces `pattern: "*"`, so `matchedPattern` is now `"*"` when the explicit rule matches.

## Full before/after example

```jsonc
// Before (legacy format)
{
  "$schema": "...",
  "debugLog": false,
  "permissionReviewLog": true,
  "yoloMode": false,
  "defaultPolicy": {
    "tools": "ask",
    "bash": "ask",
    "mcp": "ask",
    "skills": "ask",
    "special": "ask"
  },
  "tools": {
    "read": "allow",
    "write": "deny"
  },
  "bash": {
    "git status": "allow",
    "git *": "ask"
  },
  "mcp": {
    "mcp_status": "allow"
  },
  "skills": {
    "*": "ask"
  },
  "special": {
    "external_directory": "ask"
  }
}
```

```jsonc
// After (flat format)
{
  "$schema": "...",
  "debugLog": false,
  "permissionReviewLog": true,
  "yoloMode": false,
  "permission": {
    "*": "ask",
    "read": "allow",
    "write": "deny",
    "bash": {
      "git status": "allow",
      "git *": "ask"
    },
    "mcp": {
      "mcp_status": "allow"
    },
    "skill": { "*": "ask" },
    "external_directory": "ask"
  }
}
```

## Per-agent frontmatter

Frontmatter in agent `.md` files uses the same flat shape under the `permission` key.

```yaml
# Before (legacy nested shape)
---
permission:
  defaultPolicy:
    tools: allow
  bash:
    "git *": allow
  tools:
    mcp: deny
  mcp:
    exa_web_search_exa: allow
  special:
    external_directory: allow
---
```

```yaml
# After (flat shape)
---
permission:
  "*": allow
  bash:
    "git *": allow
  mcp:
    "*": deny
    exa_web_search_exa: allow
  external_directory: allow
---
```

Key differences from the old frontmatter:

1. The `"*"` key (quoted in YAML) replaces `defaultPolicy.tools`.
2. `tools.bash` / `tools.mcp` catch-alls become `bash: <state>` or `mcp: { "*": <state>, ... }`.
3. `special.external_directory` becomes `external_directory` at the top level of `permission`.
4. Any surface key now works in frontmatter — extension tool names and `mcp` are no longer silently ignored.

## Behavioral differences

### Agent scope catch-alls override parent scope patterns

In the old format, `tools.bash: allow` (override layer) was lower priority than config-layer patterns from any scope, including global.
In the flat format, `bash: allow` in an agent scope is a config-layer catch-all with **higher** priority than global-scope patterns (last-match-wins, agent rules come later).

If you relied on global `rm -rf *: deny` surviving an agent's `tools.bash: allow`, you must now explicitly deny the pattern within the agent's own `bash` object:

```yaml
# Old agent frontmatter — global "rm -rf *": "deny" survived
permission:
  tools:
    bash: allow

# New agent frontmatter — must repeat the deny if you want it preserved
permission:
  bash:
    "*": allow
    "rm -rf *": deny
```

### `matchedPattern` for `external_directory`

In the old format, an explicit `special.external_directory: "deny"` rule had `matchedPattern: "external_directory"`.
In the flat format, `external_directory: "deny"` (string shorthand) has `matchedPattern: "*"`.
Code that inspected `matchedPattern` to detect explicit external-directory config must be updated.
