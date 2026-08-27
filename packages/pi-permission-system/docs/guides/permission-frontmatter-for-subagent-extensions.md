# Permission Frontmatter for Subagent Extensions

A convention guide for pi-subagent extension authors who want to offer users richer per-agent permission control.

## Motivation

Pi subagent extensions already let users restrict **which tools** an agent can see via frontmatter keys like `tools:`, `disallowed_tools:`, or `deny-tools:`.
These binary allow/deny mechanisms are simple and effective for tool visibility.

The `pi-permission-system` extension adds a second layer: **policy evaluation** with three states — `allow`, `ask`, and `deny` — across multiple permission surfaces (tools, bash commands, MCP operations, skills, external directories, and special operations).

By documenting the `permission:` frontmatter key in your extension, you give users a single agent file that expresses both visibility restrictions (your extension) and runtime policy (the permission system) without any code coupling between the two extensions.

## The Two-Layer Model

```text
┌──────────────────────────────────────────────────────┐
│  Layer 1 – Visibility  (your extension)               │
│  Controls which tools are registered / active         │
│  before the agent session starts.                     │
├──────────────────────────────────────────────────────┤
│  Layer 2 – Policy  (pi-permission-system)             │
│  Controls allow / ask / deny decisions on every       │
│  tool call, bash command, MCP operation, etc.         │
└──────────────────────────────────────────────────────┘
```

The two layers compose additively:

1. A tool hidden by your extension is never seen by the permission system — policy for it is irrelevant.
2. A tool denied by the permission system is removed from the active set before the agent starts — your extension's allowlist cannot restore it.
3. Both denylist mechanisms are additive.
   A tool blocked by either layer stays blocked.

## The `permission:` Frontmatter Format

The `permission:` key uses a flat policy map.
Each top-level key is either a tool name (for per-tool policy) or a named surface (`bash`, `mcp`, `skill`, `external_directory`, `special`).
The special key `"*"` is the universal fallback.

### Minimal example

```yaml
---
permission:
  "*": ask
  read: allow
  write: deny
---
```

This means: allow all read operations without prompting, deny all write operations, and ask the user for everything else.

### Full example with bash patterns

```yaml
---
permission:
  "*": ask
  read: allow
  bash:
    "*": ask
    "git status": allow
    "git diff *": allow
    "npm test": allow
  mcp:
    "*": deny
  skill:
    "*": ask
  external_directory:
    "*": deny
    "~/projects/*": allow
---
```

### Composing with your extension's keys

Users can freely combine `permission:` with your extension's tool restriction key:

```yaml
---
# nicobailon/pi-subagents: restrict visible tools
tools: bash,read_file,write_file

# pi-permission-system: policy within the visible set
permission:
  "*": ask
  read_file: allow
  bash:
    "*": ask
    "git *": allow
---
```

Both keys are read independently by their respective extensions.
There is no key collision — `permission:` is exclusively consumed by `pi-permission-system`.

## Permission Surfaces

| Surface              | Key                  | Value format                 | Description                                |
| -------------------- | -------------------- | ---------------------------- | ------------------------------------------ |
| Tools                | `<tool_name>`        | `"allow" \| "ask" \| "deny"` | Per-tool invocation policy                 |
| Bash                 | `bash`               | `{ pattern: decision }`      | Pattern-matched bash commands (glob-style) |
| MCP                  | `mcp`                | `{ pattern: decision }`      | MCP tool-level policy                      |
| Skills               | `skill`              | `{ pattern: decision }`      | Skill invocation policy                    |
| External directories | `external_directory` | `{ pattern: decision }`      | Path-based access outside the project      |
| Special              | `special`            | `{ pattern: decision }`      | Special operations (e.g. `subagent_spawn`) |
| Universal fallback   | `"*"`                | `"allow" \| "ask" \| "deny"` | Applies when no specific rule matches      |

Pattern maps use last-match-wins ordering: put broad catch-alls first and specific overrides after.

## What Adoption Looks Like

Adopting this convention does **not** require your extension to:

- Import or depend on `pi-permission-system`
- Evaluate the `permission:` key at runtime
- Change your existing tool restriction mechanism

Adoption means:

1. **Document** the `permission:` key as an optional frontmatter field in your extension's README or agent authoring guide.
2. **Explain** that it is consumed by `pi-permission-system` when both extensions are installed.
3. **Show** a combined example with your extension's key alongside `permission:`.

The permission system handles all evaluation, prompt dialogs, and policy enforcement independently.

## Runtime Integration (Optional)

If your extension runs subagents in-process (e.g. via `createAgentSession()`), you can optionally query the permission system's policy at runtime via the `Symbol.for()`-backed service accessor — no required peer dependency, just a dynamic `import()`.

### Querying policy

```typescript
try {
  const { getPermissionsService } = await import(
    "@gotgenes/pi-permission-system"
  );
  // Your own session's id; inside a handler, ctx.sessionManager.getSessionId().
  const permissions = getPermissionsService(sessionId);
  if (permissions) {
    const result = permissions.checkPermission("bash", "git push", "Worker");
    console.log(result.state); // "allow" | "deny" | "ask"
  }
} catch {
  // Not installed — graceful degradation
}
```

Query the service belonging to the session whose policy you mean.
Each session that loads the permission system publishes its own — a subagent child's config (and cwd) may differ from its parent's, so the parent's service is not a stand-in for the child's.
The deprecated `getRootPermissionsService()` always answers with the process root's service, which is why it is the wrong call inside a child.

If `pi-permission-system` is not installed, `import()` throws; if that session has published no service yet (or has been unloaded), `getPermissionsService(sessionId)` returns `undefined`.
Guard both cases as shown above.

Prompt forwarding for headless child agents is an internal subagent-to-parent mechanism, not a public cross-extension operation — there is no service-accessor equivalent to call directly.

For full API documentation, see [Cross-extension API](../cross-extension-api.md).

## Benefits for Your Users

1. **Richer semantics** — `ask` is more useful than binary allow/deny; users can permit a tool but require approval for each invocation.
2. **Unified config** — one `permission:` block per agent instead of separate restriction keys in multiple extensions.
3. **Surface coverage** — policy covers bash patterns, MCP tools, skills, external directories, and special operations, not just tool names.
4. **Forwarding** — permission prompts from headless child agents surface in the parent session's UI.
5. **Programmatic access** — the `Symbol.for()` service accessor lets your extension query policy at runtime with only a dynamic `import()`, no required peer dependency.

## Further Reading

- [Subagent Integration](../subagent-integration.md) — full coexistence documentation and interaction rules
- [Cross-extension API](../cross-extension-api.md) — service accessor, event bus reference (decision and UI-prompt broadcasts)
- [Configuration](../configuration.md) — full policy reference including merge precedence
- [Schema](../../schemas/permissions.schema.json) — canonical JSON Schema for the flat permission format
