# Troubleshooting

## Common Issues

| Problem                                                           | Cause                                                                                    | Solution                                                                                                                                          |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config not applied (everything asks)                              | File not found or parse error                                                            | Verify the global config at `~/.pi/agent/extensions/pi-permission-system/config.json` (respects `PI_CODING_AGENT_DIR`); check for trailing commas |
| Per-agent override not applied                                    | Frontmatter parsing issue                                                                | Ensure `---` delimiters at file top; keep YAML simple; restart session                                                                            |
| Tool blocked as unregistered                                      | Unknown tool name                                                                        | Use a registered `mcp` tool for server tools: `{ "tool": "server:tool" }`                                                                         |
| `/skill:<name>` blocked                                           | Deny policy or confirmation unavailable                                                  | Check merged `skill` policy (global/project/agent layers). `ask` still requires UI or forwarded confirmation.                                     |
| External file path blocked                                        | `external_directory` is `ask` without UI or `deny`                                       | Allow/ask the permission or keep file tools inside the active working directory.                                                                  |
| Spurious external-path prompt for `cd <subdir> && grep … ../path` | Relative path was resolved against cwd instead of the `cd` target                        | Fixed in current version — paths after a leading `cd <subdir> &&` are resolved against the cd target, matching actual shell behavior.             |
| Permission prompt is too verbose                                  | Generic extension tool input is large                                                    | Built-in file tools are summarized automatically; third-party tools are capped to a bounded one-line JSON preview.                                |
| Durable approval is denied                                        | Project is untrusted, config is invalid, or atomic write/reload failed                   | Read the `permission_rule.persistence_failed` review entry, fix the displayed destination, and retry; the pending tool call remains blocked.      |

## Diagnostic Logging

Enable `"debugLog": true` in your config to write verbose diagnostics to `logs/pi-permission-system-debug.jsonl`.

On every session start, the extension emits a `config.resolved` entry to both logs listing the resolved config paths and whether each exists.
This makes it easy to verify which files the extension actually loaded:

```jsonc
{
  "event": "config.resolved",
  "globalConfigPath": "/…/.pi/agent/extensions/pi-permission-system/config.json",
  "globalConfigExists": true,
  "projectConfigPath": "/…/my-project/.pi/extensions/pi-permission-system/config.json",
  "projectConfigExists": false,
  "projectLocalConfigPath": "/…/my-project/.pi/extensions/pi-permission-system/config.local.json",
  "projectLocalConfigExists": false,
  "agentsDir": "/…/.pi/agent/agents",
  "agentsDirExists": true,
  "projectAgentsDir": "/…/my-project/.pi/agents",
  "projectAgentsDirExists": false,
  "legacyGlobalPolicyDetected": false,
  "legacyProjectPolicyDetected": false,
  "legacyExtensionConfigDetected": false
}
```

## Threat Model

**Goal:** Enforce policy at the host level, not the model level.

**What this stops:**

- Agent calling tools it shouldn't use (e.g., `write`, dangerous `bash`)
- Tool switching attempts (calling non-existent tool names)
- Accidental escalation via skill loading
- Unapproved path-bearing tool access outside the active working directory when `external_directory` is `ask` or `deny`

**Limitations:**

- If a dangerous action is possible via an allowed tool, policy must explicitly restrict it
- This is a permission decision layer, not a sandbox — for true isolation see [Agent Sandboxes](https://engine.build/lab/agent-sandboxes)
- The review log records bash command strings verbatim.
  Log files are created owner-only (`0600`), and values bound to a sensitive key name (`authorization`, `token`, `password`, …) are masked — but a secret embedded in a command string is not.
  See [Log file sensitivity](configuration.md#log-file-sensitivity) and [ADR 0010].

[ADR 0010]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0010-permission-log-secret-exposure.md
