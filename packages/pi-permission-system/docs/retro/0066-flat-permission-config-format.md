---
issue: 66
issue_title: "Replace legacy config format with flat permission format"
---

# Retro: #66 — Replace legacy config format with flat permission format

## Final Retrospective (2026-05-04T17:00:00Z)

### Session summary

Replaced the legacy multi-namespace config format (`defaultPolicy`, `tools`, `bash`, `mcp`, `skills`, `special`) with a flat `permission` object.
Shipped as v4.0.0 across 10 TDD commits, a migration guide, fork-language revision, and acknowledgments update.
The release-please workflow required manual intervention (force-push reset + re-merge) due to a stale PR title from a prior retro-only release.

### Observations

#### What went well

- The plan's 10-step TDD order worked well for incremental refactoring — each step was self-contained and the intermediate breakage between steps (e.g., `synthesize.ts` signature change before `permission-manager.ts` was updated) was manageable because only the affected test file was run per step.
- Discovering the `//` false positive (#68) during live testing was a genuine win from eating our own dogfood — the bug would have been hard to find in unit tests alone.
- The release-please recovery (delete stale tag/release, force-push main, re-merge a clean PR) was a clean resolution to a messy state.

#### What caused friction (agent side)

1. `missing-context` — When rewriting `permission-system.test.ts` (3165 lines) via `cat > ... << 'ENDOFFILE'`, three tests were wrong: the logger test used a non-existent `getLogsDir` API, the permission-forwarding test checked wrong behavior (`hasUI: true` with subagent env), and `createPermissionForwardingLocation` asserted a string return type instead of an object.
   All three were copy-from-memory errors.
   Reading the original test implementations before rewriting would have caught all of them.
   Impact: 3 debug cycles, ~5 extra tool calls.

2. `missing-context` — The plan stated `checkPermission()` and `getToolPermission()` are "unchanged," but `permission["*"]: "deny"` created a config-layer rule that changed `source` from `"default"` to `"tool"` for extension tools.
   Had to add logic to exclude `"*"` from config rules and feed it only to `synthesizeDefaults()`.
   Impact: 2 test failures caught during step 5 green phase; fixed in the same commit, but not anticipated by the plan.

3. `scope-drift` — The user's live global config at `~/.pi/agent/extensions/pi-permission-system/config.json` was still in the old format after shipping.
   The breaking change silently defaulted everything to `"ask"` — every bash command required approval.
   I should have checked the user's live config as part of the final docs/ship step.
   Impact: user-caught; required manual config migration mid-session. (user-caught)

4. `missing-context` — The first release-please merge attempt got a 502, which actually succeeded silently.
   The second attempt said "already merged."
   The merged PR had a stale title (`release 3.11.1`) because release-please failed to update the PR metadata, causing a `v3.11.1` tag on the `4.0.0` commit.
   Impact: required force-push reset of main and re-merge to get a clean release.
   ~10 extra tool calls.

#### What caused friction (user side)

- The user could have flagged their live config format earlier — before the TDD execution started — since they knew the format was changing.
  However, the migration guide was only written in step 9, so the agent should have proactively checked the live config rather than expecting the user to self-migrate.

#### Takeaway not implemented as a rule

The test rewrite errors (observation 1) are better addressed at planning time, not with an `AGENTS.md` rule.
The plan should have used a lift-and-shift approach: introduce the new type/function alongside the old one, migrate callers incrementally (including test fixtures), then remove the old.
Instead, step 5 required a monolithic rewrite of `permission-system.test.ts` (3165 lines) in one shot, which forced copy-from-memory for non-trivial test helpers.
The existing `AGENTS.md` § Testing rule about shared type definitions across TDD steps already points in this direction but doesn't go far enough — the `/plan-issue` and `/tdd-plan` prompts should encourage lift-and-shift when a refactor touches a large test surface.

### Changes made

1. Added "verify live config after breaking format changes" rule to `AGENTS.md` § Configuration.
2. Added lift-and-shift guidance to `.pi/prompts/plan-issue.md` § TDD Order: introduce new alongside old, migrate incrementally, remove old last.
3. Added lift-and-shift guidance to `.pi/prompts/tdd-plan.md` § Execute the TDD cycle: do not rewrite large test files in one shot.
