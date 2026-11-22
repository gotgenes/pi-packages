---
issue: 413
issue_title: "Explicitly allow some external directories relative to the home directory"
---

# Document the `external_directory` allow-list for caches like `~/.cargo/registry`

## Problem Statement

A user wants to stop being prompted every time an agent reads a local cache outside the working directory (e.g. `~/.cargo/registry`).
They reached for the `path` surface and configured `"~/.cargo/registry": "allow"`, but it did not work.

Two things defeated that attempt:

1. Wrong surface for the intent.
   Access to paths outside the current working directory is governed by the `external_directory` gate, not the cross-cutting `path` gate.
   The four permission layers compose with **most-restrictive-wins**, so a `path` allow does **not** widen access past an `external_directory: ask` boundary — `ask` is more restrictive than `allow`, so the prompt still fires.
   This is the intended composition (the same invariant that makes a `path` deny beat a per-tool allow), not a bug.
2. Glob gap.
   `~/.cargo/registry` (no trailing `*`) matches only the directory entry itself, not the files beneath it.

The capability the user wants already exists: the `external_directory` surface accepts a pattern map, so `"external_directory": { "*": "ask", "~/.cargo/registry/*": "allow" }` does exactly what they asked.
The real gap is **discoverability** — the docs and example config do not show a worked "allow an outside-CWD cache directory" recipe, and they do not clearly distinguish when to use `path` versus `external_directory`.

This is a third-party issue (filed by `michaelmior`, not the maintainer).
The operator confirmed the resolution: docs-only.
Do **not** change behavior; in particular, do **not** make a `path` allow suppress the `external_directory` gate — that would violate most-restrictive-wins and silently widen access on existing configs.

## Goals

- Make the existing `external_directory` allow-list discoverable so users stop reaching for `path` to allow outside-CWD directories.
- Add a worked recipe that allows a cache directory such as `~/.cargo/registry` via `external_directory`, using a single trailing `*`.
- Clarify the distinction between the `path` surface (which file paths are allowed, anywhere) and the `external_directory` surface (whether reaching outside CWD is allowed), and reaffirm most-restrictive-wins.
- Make the `external_directory` surface description in the README clear and add a concrete pattern-map example.
- Add an inline `external_directory` allow example to the example config and the schema.

## Non-Goals

- No behavior change.
  Explicitly **reject** making an explicit `path` allow suppress the `external_directory` gate — it breaks most-restrictive-wins and is a security regression, not a fix.
- No new config field, surface, or schema property.
- No `troubleshooting.md` entry (operator deselected it).
- No `**` (globstar) syntax in any new example.
  A single `*` is a greedy match that already crosses subdirectory boundaries, so `~/.cargo/registry/*` matches every file beneath the directory.
- No changes to `piInfrastructureReadPaths` behavior.
  It remains a read-only auto-allow list; the recipe uses `external_directory` because the operator chose that surface and it covers all tools, not just reads.
- No code, no tests — the next stage is `/build-plan`, not `/tdd-plan`.

## Background

Relevant existing surfaces and docs:

- `external_directory` gate — `src/handlers/gates/external-directory.ts`.
  Fires for any path outside CWD; resolves via `resolver.resolve("external_directory", { path }, …)`, so it already honors a pattern map keyed by home-expanded path patterns.
  The pipeline order (`src/handlers/gates/tool-call-gate-pipeline.ts`) runs the `path` gate (#2) before `external_directory` (#3); an `allow` from the `path` gate returns `null` and never short-circuits the later gate.
- Wildcard semantics — `src/wildcard-matcher.ts`.
  `compileWildcardPattern` home-expands the pattern, then turns each `*` into `.*` compiled with the `s` flag, so `*` is greedy and crosses `/` boundaries.
  `**` collapses to the same regex; it is therefore not a distinct globstar and is unnecessary.
- Home expansion — `src/expand-home.ts` (issue 350).
  Both pattern keys and tool/bash path values are home-expanded, so `~/.cargo/registry/*` matches a read whose path is `~/.cargo/registry/…` or its absolute form.

Docs and config to touch:

- `docs/configuration.md` — the `external_directory` Surface section (≈ lines 393–430) already shows `"~/development/*": "allow"`; the four-layer / most-restrictive-wins table is at ≈ lines 343–347.
- `README.md` — the four-layer one-liner is at ≈ line 75; the Quick Start config (≈ lines 38–52) shows `"external_directory": "ask"` as a bare string.
- `config/config.example.json` — the `external_directory` map already contains `"~/development/*": "allow"`.
- `schemas/permissions.schema.json` — the `permission` `markdownDescription` and the `examples` array (which currently shows `"external_directory": "ask"`).

Constraints from AGENTS.md / package skill:

- "Keep schema, example config, `docs/configuration.md`, `README.md`, and TypeScript types/loaders aligned — changing one without the others is a bug."
  This change touches docs/example/schema only (no types/loaders), but they must stay mutually consistent.
- Markdown conventions: one sentence per line; compact tables; sequential list numbering restarting under each heading; fenced blocks need a language; backtick-wrap identifiers and paths.
- The package skill notes the example config should gate `write` and `edit` together — unaffected here (we touch `external_directory` only).

## Design Overview

Documentation only.
The mechanism already works; the edits make it visible and teach the right surface.

### Mental model to convey

- `path` answers "is this file path allowed at all?" and applies everywhere (tools, bash, MCP, extension tools) — use it to **deny** sensitive files (`.env`, `~/.ssh/*`) globally.
- `external_directory` answers "is reaching outside the working directory allowed?" — use it to **allow** specific outside-CWD directories (caches, sibling projects) without opening all external access.
- The layers compose with most-restrictive-wins, so allowing an outside-CWD directory belongs in `external_directory`, and an explicit `path` allow cannot loosen an `external_directory: ask` boundary.

### The recipe (single `*`)

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

A single trailing `*` is greedy and crosses subdirectory boundaries, so this allows every file under `~/.cargo/registry` (e.g. `~/.cargo/registry/index/…`, `~/.cargo/registry/src/…/lib.rs`).
Do not write `~/.cargo/registry/**` — `**` is not a distinct globstar and `*` already recurses.

### Edge cases to keep honest in the wording

- The pattern is stored and displayed as written (`~/.cargo/registry/*`) in logs and prompts — already documented in the Home Directory Expansion section; the new recipe should not contradict it.
- For read-only caches, `piInfrastructureReadPaths` is an alternative that auto-allows reads and bypasses the gate, but it is read-only.
  Mention it as a one-line cross-reference at most; the primary recipe stays on `external_directory` (works for all tools).

## Module-Level Changes

Docs/config/schema only — no `src/` changes.

- `docs/configuration.md`
  - In the `external_directory` Surface section, add a "cache directory" recipe block using `~/.cargo/registry/*`, with a sentence on single-`*` crossing subdirectory boundaries.
  - Add a short "path vs external_directory — which surface?" clarification (a sentence or compact bullet pair) so readers pick `external_directory` for outside-CWD allows.
  - Reaffirm most-restrictive-wins where the recipe lives (a `path` allow cannot loosen an `external_directory: ask` boundary).
  - Do not introduce any `**` example; if an adjacent sentence is edited, keep single-`*` idiom.
- `README.md`
  - Replace or augment the bare `"external_directory": "ask"` in Quick Start (or the four-layer paragraph) with a clear one-sentence description of the surface plus a small pattern-map example allowing an outside-CWD directory.
  - Keep it brief; the full recipe lives in `configuration.md`.
- `config/config.example.json`
  - Add a second `external_directory` allow entry for a cache directory (e.g. `"~/.cargo/registry/*": "allow"`) alongside the existing `"~/development/*": "allow"`, so the pattern-map idiom is visible.
- `schemas/permissions.schema.json`
  - Update the `examples` array entry to show `external_directory` as a pattern map (matching the example config) instead of the bare `"ask"` string, and/or add a sentence to the `permission` `markdownDescription` noting that `external_directory` accepts a pattern map for allowing specific outside-CWD directories.
  - Keep schema `examples` and `config/config.example.json` consistent with each other.

No file is added, renamed, or removed; no symbol is removed, so no `src/`/`test/`/`SKILL.md` symbol grep is required.
No `docs/architecture/` layout/metric tables reference these doc files.

## Test Impact Analysis

Not applicable — docs/config/schema only, no code under test.

Verification is the lint/build gate, not new unit tests:

- `pnpm --filter @gotgenes/pi-permission-system run lint` (rumdl markdown rules + JSON).
- Confirm `config/config.example.json` and `schemas/permissions.schema.json` still parse and that the example validates against the schema if a validation script exists.
- Confirm `docs/configuration.md`, `README.md`, `config.example.json`, and `schema` agree on the `external_directory` pattern-map form (the AGENTS.md alignment rule).

## Invariants at risk

- Most-restrictive-wins composition.
  The docs must not imply a `path` allow can loosen an `external_directory: ask` boundary; the new wording reinforces the invariant rather than weakening it.
  This is a prose invariant — pinned by the existing composition tests in `test/` (no code change here, so they stay green).

## Build Order

Docs-only; each step ends in a `docs:` commit.

1. `docs:` — `configuration.md`.
   Add the `~/.cargo/registry/*` recipe to the `external_directory` section, the "path vs external_directory" clarification, and the single-`*` note; reaffirm most-restrictive-wins.
   Commit: `docs(pi-permission-system): document external_directory allow-list for outside-CWD caches (#413)`.

2. `docs:` — `README.md`.
   Describe the `external_directory` surface clearly and add a small pattern-map allow example.
   Commit: `docs(pi-permission-system): clarify external_directory surface in README (#413)`.

3. `docs:` — `config/config.example.json` and `schemas/permissions.schema.json`.
   Add the cache-dir allow entry to the example and align the schema example/description to the pattern-map form.
   Commit: `docs(pi-permission-system): show external_directory allow-list in example config and schema (#413)`.

These three steps may be squashed into one `docs:` commit if review prefers a single reviewable change; keep them separate if the diff is large.
Run the package lint after step 3.

## Risks and Mitigations

- Risk: a new example uses `~/.cargo/registry/**` and teaches the wrong idiom.
  Mitigation: every new example uses a single trailing `*`; the plan's Non-Goals forbid `**`.
- Risk: docs drift between `configuration.md`, `README.md`, example config, and schema.
  Mitigation: step 3 aligns example + schema in one commit; the verification step cross-checks all four surfaces.
- Risk: wording implies the prior behavior was a bug, inviting a future code change that breaks most-restrictive-wins.
  Mitigation: frame `external_directory` as the intended surface and explicitly state that a `path` allow cannot loosen an `external_directory` boundary.
- Risk: the user's underlying case is read-only caches and `piInfrastructureReadPaths` would be lighter-weight.
  Mitigation: keep `external_directory` as the primary recipe (operator's choice; covers all tools) and add at most a one-line cross-reference.

## Open Questions

- Should `schemas/permissions.schema.json` keep a bare-string `external_directory` example anywhere (to show the shorthand) while the primary example uses the pattern map?
  Defer to the build step — prefer the pattern-map example for discoverability; the shorthand is already covered by the surface-shorthand rule.
- One-line cross-reference to `piInfrastructureReadPaths` for read-only caches: include in `configuration.md` only, or omit to keep the recipe focused?
  Defer to the build step; lean toward a single sentence in `configuration.md`.
