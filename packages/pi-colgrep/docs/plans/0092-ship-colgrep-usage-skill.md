---
issue: 92
issue_title: "Ship colgrep usage skill"
---

# Ship colgrep usage skill

## Problem Statement

The `colgrep` tool is registered with brief `promptSnippet` and `promptGuidelines` (from issue #90), but there is no on-demand skill that teaches the agent *how* to use colgrep effectively — common search patterns, flag reference, and decision guidance for choosing between `colgrep` and the built-in `grep`.
The upstream ColGrep project ships a SKILL.md, but it positions colgrep as a primary/replacement search tool, which is wrong for our context where it complements `grep`.

## Goals

- Create `skills/colgrep/SKILL.md` adapted from the upstream ColGrep SKILL.md.
- Adjust framing: colgrep complements `grep`, not replaces it.
- Remove upstream references to Claude Code hooks, OpenCode, Codex.
- Add guidance on combining both tools (colgrep to find areas, grep for exact references).
- Include a "When to use what" decision table.
- Add third-party attribution: `THIRD_PARTY_LICENSES/next-plaid-LICENSE.Apache-2.0.txt`.
- Register the skills directory in `package.json` under `pi.skills`.
- Include `skills` and `THIRD_PARTY_LICENSES` in the `files` array for npm publishing.

## Non-Goals

- Changing the existing `promptSnippet` or `promptGuidelines` on the tool registration — they already cover the basics and are orthogonal to the skill.
- Automatic skill loading or `session_start` logic — Pi discovers skills from the `pi.skills` path at startup.
- Reindex or tool behavior changes (issues #91, #90).

## Background

### Upstream SKILL.md

The upstream [`colgrep/src/install/SKILL.md`](https://github.com/lightonai/next-plaid/blob/main/colgrep/src/install/SKILL.md) (Apache-2.0, copyright 2026 Raphael Sourty, LightOn) contains:

1. Quick reference with bash examples for semantic, regex, hybrid, filtering, and output options.
2. Grep-compatible flags table.
3. "When to use what" decision table.
4. Key rules (10 items, starting with "Default to colgrep for any code search").

### What needs adaptation

1. Rule 1 says "Default to colgrep for any code search" — must be reframed as "prefer colgrep for intent-based search and exploration."
2. Rule 9 says "Agents should use colgrep" referring to spawning Claude Code subagents — not relevant to Pi.
3. "Need Help?" section references `colgrep --help` — fine to keep.
4. The upstream uses `Search / Grep / Glob` naming (Claude Code's tool names) — must map to Pi's `grep` and `find` tools.
5. The flags `-k`/`--results` naming: our tool registration uses `limit` as the parameter name mapping to `-k`.
   The skill should reference both the CLI flag and the tool parameter.

### Pi skill format

Skills require YAML frontmatter with `name` (lowercase, hyphens) and `description` (max 1024 chars).
The skill is discovered from `skills/` via the `pi.skills` array in `package.json`.

### Package publishing

The `files` array in `package.json` controls what's included in the npm tarball.
Currently it lists `src`, `README.md`, `CHANGELOG.md`, `LICENSE`.
Both `skills` and `THIRD_PARTY_LICENSES` must be added for the skill and license to ship.

### Existing tool hints

The tool registration already includes:

- `promptSnippet`: "colgrep: Semantic and hybrid code search — find code by intent, not just text."
- `promptGuidelines`: 3 rules covering intent-based preference, grep for exact patterns, and increasing limit.

These stay as-is; the skill provides deeper on-demand guidance.

## Design Overview

### Skill content structure

The skill follows the upstream structure but with adapted framing:

1. **Header** — attribution comment and frontmatter.
2. **Quick Reference** — bash examples adapted to show both CLI usage and tool parameter mapping.
   Remove multi-file and multi-directory search (our tool only accepts a single `path`).
3. **Grep-Compatible Flags** — table from upstream, filtered to flags our tool supports (`-e`, `-k`, `-n`, `--include`).
   Add notes about flags available via CLI but not exposed as tool parameters.
4. **When to Use What** — decision table adapted to reference Pi's `grep` and `find` tools instead of "Grep" and "Glob".
   Add rows for combining both tools.
5. **Key Rules** — 6–8 rules replacing the upstream's 10.
   Drop "Default to colgrep" framing; drop subagent rule.
   Add rules about combining tools.

### Attribution

The SKILL.md includes an HTML comment at the top with the attribution notice:

```text
<!-- Adapted from ColGrep SKILL.md (https://github.com/lightonai/next-plaid)
     Copyright 2026, Raphael Sourty, LightOn — Apache-2.0
     See THIRD_PARTY_LICENSES/next-plaid-LICENSE.Apache-2.0.txt -->
```

The full Apache-2.0 license text is placed at `THIRD_PARTY_LICENSES/next-plaid-LICENSE.Apache-2.0.txt`.

### Frontmatter

```yaml
---
name: colgrep
description: |
  Semantic and hybrid code search with ColGrep.
  Use when you need to find code by intent or meaning rather than exact text patterns.
  Covers search patterns, grep-compatible flags, and when to use colgrep vs the built-in grep.
---
```

### Package.json changes

Two changes to `package.json`:

1. Add `"skills": ["./skills"]` under the `pi` key.
2. Add `"skills"` and `"THIRD_PARTY_LICENSES"` to the `files` array.

## Module-Level Changes

### New files

1. `skills/colgrep/SKILL.md` — adapted skill content with frontmatter and attribution.
2. `THIRD_PARTY_LICENSES/next-plaid-LICENSE.Apache-2.0.txt` — full Apache-2.0 license text from upstream.

### Modified files

1. `package.json` — add `pi.skills` and update `files` array.

## Test Impact Analysis

No code changes — no tests needed.
The skill is a static markdown file discovered by Pi at startup.
The `package.json` changes are structural (publishing and skill registration).

## TDD Order

This change has no test cycles.
It is a docs/config change suitable for `/build-plan`.

### Step 1 — third-party license

Add `THIRD_PARTY_LICENSES/next-plaid-LICENSE.Apache-2.0.txt` with the full upstream Apache-2.0 license.

- Commit: `docs: add next-plaid Apache-2.0 license (#92)`

### Step 2 — skill content

Create `skills/colgrep/SKILL.md` with the adapted skill content, frontmatter, and attribution.

- Commit: `feat: add colgrep usage skill (#92)`

### Step 3 — package.json registration

Update `package.json` to add `pi.skills` and include `skills` and `THIRD_PARTY_LICENSES` in `files`.

- Commit: `feat: register colgrep skill and license in package.json (#92)`

## Risks and Mitigations

| Risk                                                                        | Mitigation                                                                                                                                                                          |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skill content diverges from upstream ColGrep as the CLI evolves             | The skill references stable CLI flags. Pin attribution to the upstream commit used. Update when ColGrep ships breaking changes.                                                     |
| Apache-2.0 attribution requirements not met                                 | Include the full license text in `THIRD_PARTY_LICENSES/`, attribution comment in the SKILL.md header, and list the file in `files` for npm publishing.                              |
| Skill not discovered by Pi at runtime                                       | The `pi.skills` key in `package.json` follows the documented convention from Pi's packages.md. Verify after implementation by checking `pi --help` or startup header for the skill. |
| `files` array omission causes skill/license to be excluded from npm tarball | Explicitly add both `skills` and `THIRD_PARTY_LICENSES` to the array; verify with `pnpm pack --dry-run`.                                                                            |

## Open Questions

- Should the skill reference the `--exclude` and `--exclude-dir` flags even though they aren't exposed as tool parameters?
  The agent could use them via the CLI directly if it shells out.
  Include them in the flags table with a note that they're CLI-only, since the skill doubles as CLI reference.
- Should the `lint:md` script be updated to include `skills/**/*.md`?
  Yes — add it so markdownlint covers the skill file.
  Include in step 2's commit.
