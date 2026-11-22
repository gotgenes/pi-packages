---
issue: 58
issue_title: "The permission configuration is invalid on the Windows system"
---

# Retro: #58 — The permission configuration is invalid on the Windows system

## Final Retrospective (2026-05-16T22:30:00Z)

### Session summary

Fixed a platform-independent bug where the cross-cutting `path` permission gate (introduced in #148) fired for every path-bearing tool call when users configured `"*": "ask"` without an explicit `"path"` surface entry.
The fix was two `matchedPattern === undefined` early-return checks (one in `describePathGate`, one in `describeBashPathGate`) plus wiring session rules into the tool path gate's pre-check.
Released as `pi-permission-system@5.18.2`.

### Observations

#### What went well

- `missing-context` **recovery was fast once redirected.**
  The user's "is that a red herring?" intervention cut short a Windows path-resolution rabbit hole.
  Once redirected to the config interaction, tracing through `describePathGate` → `checkPermission` → `evaluate` → universal default rule took only one read cycle to pinpoint.
  The `matchedPattern === undefined` discriminator was identified from reading `PermissionManager.checkPermission()` once — the `rule.layer` → `matchedPattern` mapping is clean.

- **Downstream test breakage was small and predictable.**
  Only `tests/handlers/tool-call.test.ts` broke (2 tests), and the fix was mechanical: add `matchedPattern: "*.env"` to mocks that represent explicit config rules.
  The plan didn't anticipate this, but the deviation was flagged and resolved in the same commit.

#### What caused friction (agent side)

1. `rabbit-hole` — Spent ~6 tool calls exploring Windows-specific path handling (`config-paths.ts`, `extension-paths.ts`, `expand-home.ts`, `node-modules-discovery.ts`, `getAgentDir` resolution) before the user redirected.
   The issue title ("invalid on the Windows system") anchored investigation on platform behavior when the GIF attachment (unviewable) and the config itself were the real signal.
   Impact: added friction but no rework — no code was written during the exploration.

2. `missing-context` — Did not attempt to fetch/view the issue's screenshot early.
   The GIF was unviewable (unsupported content type), but trying earlier would have surfaced that gap sooner and forced a config-level analysis from the start.
   Impact: minor — the user's redirect was quick.

#### What caused friction (user side)

- The user could have included the key insight ("look at the config interaction, not the OS") in the initial prompt instead of waiting for the first round of exploration.
  However, their redirect ("is that a red herring?") was well-timed and efficient — it came before any code changes, so no rework was caused.

### Changes made

1. Wrote this retro file at `packages/pi-permission-system/docs/retro/0058-path-gate-universal-default.md`.
