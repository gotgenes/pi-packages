---
issue: 22
issue_title: "Relax 'preserve upstream on-disk identity' rule in AGENTS.md and README (lands with #10)"
---

# Relax "preserve upstream on-disk identity" rule

## Problem Statement

`AGENTS.md` and `README.md` both claim the fork preserves all of upstream's on-disk identity (config directory, log filenames, slash command, event channel names) and is "drop-in interchangeable" with upstream.
Issue #10 deliberately breaks that contract by moving config and log paths to the `pi-autoformat` convention.
The docs need to be narrowed before (or with) #10 so they no longer over-promise.

## Goals

- Narrow the "preserve identity" rule in `AGENTS.md` to cover only the `/permission-system` slash command name and the `pi-permission-system:permission-request` event channel name.
- Remove the "drop-in interchangeable" claim from both files.
- Update the `README.md` fork notice to honestly state the divergence.
- Land this change together with #10 (or as the first commit in the #10 PR) so docs and code stay aligned.

## Non-Goals

- Renaming the slash command or event channel (explicitly out of scope).
- Implementing the config consolidation itself (that is #10).
- Deciding whether to keep or delete the event channel (that is #20; this plan preserves the channel name reference pending #20's outcome).

## Background

### Affected surfaces

This is a **documentation-only** change.
No permission surfaces, policy semantics, schema, or runtime behavior are modified.

### Files involved

| File        | Current claim                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------- |
| `AGENTS.md` | § Project Purpose, § Implementation Priorities, § Notes for Agents — all reference on-disk identity |
| `README.md` | Fork notice blockquote at line 8                                                                    |

### Dependencies

- **#10** (config consolidation) — this change should land with or just before #10.
  Issue #10 is still open / unimplemented.
- **#20** (document or delete event channel) — still open.
  This plan keeps the event channel name in the "preserve" list.
  If #20 deletes the channel, a follow-up edit removes that bullet.

## Design Overview

Pure prose edits — no code, schema, or config changes.

### `AGENTS.md` changes (three locations)

1. **§ Project Purpose** (line 8) — replace the full-scope identity sentence with a narrower one:
   - Keep: `/permission-system` slash command, event channel name.
   - Drop: config directory, log filenames, "drop-in interchangeable".
2. **§ Implementation Priorities** (line 26) — narrow the bullet to slash command and event channel only; note that config/log paths diverge from upstream as of #10.
3. **§ Notes for Agents** item 4 (line 119) — same narrowing; reference #10 as the breaking point.

### `README.md` changes (one location)

1. **Fork notice** (line 8) — replace with the text proposed in the issue:
   > This fork diverges from upstream `MasuRii/pi-permission-system` in config layout (#10).
   > The slash command and event channel names are preserved; the config and log paths are not.

## Module-Level Changes

| File        | Action  | Detail                                                        |
| ----------- | ------- | ------------------------------------------------------------- |
| `AGENTS.md` | changed | Narrow identity-preservation rule in three sections           |
| `README.md` | changed | Replace fork-notice blockquote with divergence-honest version |

No changes to `src/`, `schemas/`, `config/`, or `tests/`.

## TDD Order

This is a docs-only issue — no tests to write.
A single commit is sufficient.

1. Edit `AGENTS.md` and `README.md` with the narrowed wording.
   Commit: `docs: relax on-disk identity rule for config/log paths (#22)`

## Risks and Mitigations

| Risk                                                  | Mitigation                                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Docs land before #10 while code still uses old paths  | Issue specifies landing together with #10; plan reiterates this. Reviewer should enforce co-landing. |
| Could this silently weaken a permission?              | No. This is a documentation change only. No policy, schema, or runtime code is touched.              |
| #20 deletes the event channel, leaving a stale bullet | #20's PR will naturally update the same bullets. The plan notes this so the #20 author knows.        |

## Open Questions

- None.
  The issue body is specific about what to keep and what to drop, and the wording is provided.
  If #20 decides to delete the event channel, the "preserve event channel name" bullets will be cleaned up in that PR.
