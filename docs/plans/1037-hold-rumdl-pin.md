---
issue: 1037
issue_title: "Lift the rumdl pin off 0.2.24 now that the MD013 reflow regressions are fixed upstream"
---

# Hold the rumdl pin at 0.2.24 and record the current reason

## Release Recommendation

**Release:** ship independently

The change touches only `pnpm-workspace.yaml` and `prek.toml`, both outside every package's release scope, so `/ship` cuts no release.
The issue carries `scope:repo` and belongs to no improvement roadmap.

## Problem Statement

The `rumdl` pin at 0.2.24 cites rvben/rumdl#811 as its reason, and #811 (plus #816) has since closed upstream.
The issue asks whether the newest release (0.2.78) can replace the pin, and says to keep the pin with an updated comment if a newer release still joins sentences on this repo's markdown.
It does, so the pin's stated reason is stale while the pin itself is still needed.

## Goals

- Keep `rumdl` at exactly 0.2.24 in the `pnpm-workspace.yaml` catalog and the `prek.toml` `rumdl-pre-commit` `rev`.
- Rewrite both pin comments so they state the current, measured reason and link the open upstream report, rvben/rumdl#933.
- Leave `pnpm-lock.yaml` and `.rumdl.toml` unchanged.

## Non-Goals

- Bumping `rumdl`; the operator chose to hold the pin.
- Setting `require-sentence-capital = false` (see Design Overview for why it is not a workaround).
- Fixing the `rumdl` cache staleness ([#879]); it shaped how the measurement was taken, nothing more.
- Rewording repo prose to dodge the false joins.

## Background

The pin went in with `0ee1ad88` and lives in two places that move in lockstep: the `rumdl` catalog entry in `pnpm-workspace.yaml` and the `rumdl-pre-commit` hook `rev` in `prek.toml`.
The `pi-autoformat` extension runs `pnpm exec rumdl fmt` after every `Write`/`Edit` of a `.md` file (`.pi/extensions/pi-autoformat/config.json`), so the pinned version also decides how every agent-written markdown file is reflowed.

[#900] made the same request at 0.2.68 and found the `[#N]`-opening false join; this plan re-measures at 0.2.78 and closes both issues.

## Design Overview

### What was measured

All runs used a scratch copy of `HEAD` (`git archive HEAD`), `--no-cache` (because of [#879]), and the repo's own `.rumdl.toml`.
Rumdl is deterministic, so n = 1 per condition.

| Version and config                              | `rumdl check`                   | `rumdl fmt` hunks (join / split / equal) |
| ----------------------------------------------- | ------------------------------- | ---------------------------------------- |
| 0.2.24, `.rumdl.toml`                           | 0 findings in 1353 files        | none                                     |
| 0.2.78, `.rumdl.toml`                           | 593 MD013 findings in 369 files | 366 / 203 / 5                            |
| 0.2.78, plus `require-sentence-capital = false` | 508 MD013 findings in 322 files | 12 / 461 / 4                             |

The counts are measured; the class breakdowns below are a line-prefix heuristic over the measured diff, so treat them as estimates.

- **0.2.78 as configured** joins a sentence that opens with a reference link or a lowercase word onto the previous line: 167 joined lines open with `[#N]` or `([#N])`, and most of the 149 lowercase-opening ones are the same defect.
  A minimal repro in an empty directory with a four-line `.rumdl.toml` reproduces it; that repro is rvben/rumdl#933, filed this session.
- **`require-sentence-capital = false`** removes almost all the joins but adds about 56 false splits, after `etc.`, after `..."`, and after a closing quote followed by a lowercase word.
  It is a different defect, not a workaround.

### MD018 `magiclink` (issue step 4)

`#981 shipped the fix.` is left alone, with no MD018 finding, under both 0.2.24 and 0.2.78.
The setting is not a factor in the pin.

### The new comments

Both comments state the same facts; the `prek.toml` one is shorter and points at the catalog entry.
Proposed `pnpm-workspace.yaml` text:

```yaml
  # Pinned exactly, not caret-ranged. Newer releases join a sentence that opens
  # with a reference link or a lowercase word ("[#752] and ...", "release-please
  # reads ...") onto the previous line under our sentence-per-line reflow:
  # 0.2.78 reports 593 MD013 findings across 369 files, 0.2.24 reports none.
  # require-sentence-capital = false trades those joins for false splits after
  # "etc." and closing quotes, so it is not a workaround.
  # Upstream: https://github.com/rvben/rumdl/issues/933
  # Keep prek.toml's rumdl-pre-commit rev in lockstep with this pin.
  "rumdl": "0.2.24"
```

Proposed `prek.toml` text:

```toml
# Pinned in lockstep with the `rumdl` catalog entry in pnpm-workspace.yaml,
# which records why (rvben/rumdl#933).
```

## Module-Level Changes

- `pnpm-workspace.yaml`: replace the `rumdl` catalog comment; the version literal is unchanged.
- `prek.toml`: replace the `rumdl-pre-commit` comment; `rev = "v0.2.24"` is unchanged.
- `pnpm-lock.yaml`: predicted unchanged, because no version specifier changes.
- `.rumdl.toml`, `.pi/skills/markdown-conventions/SKILL.md`: predicted unchanged, because the formatter version, and therefore every reflow quirk the skill documents, stays the same.
  A grep of non-history markdown, TOML, YAML, and JSON for `0.2.24` and `rumdl#811` found only the two comments.

## Test Impact Analysis

There is no code, so the verification is the commands.
Recorded outputs at planning time:

- `pnpm exec rumdl check --no-cache .` → `Success: No issues found in 1353 files`.
- `grep -n 'rumdl#811\|issues/811' pnpm-workspace.yaml prek.toml` → two hits now, and none after the change.
- `git diff --stat pnpm-lock.yaml` after the change → empty.

## Build Order

1. **Rewrite both pin comments.**
   Apply the comment text from Design Overview to `pnpm-workspace.yaml` and `prek.toml`.
   Verify: `pnpm install --frozen-lockfile` succeeds and leaves `pnpm-lock.yaml` unchanged; `pnpm run lint` is green; the `rumdl#811` grep is empty; `pnpm exec rumdl --version` prints `rumdl 0.2.24`.
   Commit: `chore: record why rumdl stays pinned at 0.2.24 (#1037)`.

## Risks and Mitigations

- **The comment's numbers go stale when a newer rumdl ships.**
  It names the version they were measured on (0.2.78), and the upstream link is where a fix will show up.
- **[#900] stays open as a duplicate.**
  `/ship` should close [#900] alongside #1037, pointing at the same commit and rvben/rumdl#933.

## Open Questions

- When rvben/rumdl#933 closes, re-run the measurement table above against the fixed release before lifting the pin.

[#879]: https://github.com/gotgenes/pi-packages/issues/879
[#900]: https://github.com/gotgenes/pi-packages/issues/900
