---
issue: 778
issue_title: "System prompt showing tool names twice"
---

# Drop the redundant tool-name prefix from every `promptSnippet`

## Release Recommendation

**Release:** ship independently

Issue [#778] is a standalone bug fix touching three packages; it is not a step in any package's `docs/architecture/architecture.md` improvement roadmap (no `Release:` annotation references it).
Each of `@gotgenes/pi-colgrep`, `@gotgenes/pi-github-tools`, and `@gotgenes/pi-subagents` carries a `fix:` commit, so release-please cuts a patch release for each of the three components at the next release-PR merge.

## Problem Statement

Every tool this monorepo registers spells its own name at the front of its `promptSnippet` (`"subagent: Launch a specialized agent…"`).
Pi already renders the name: `buildSystemPrompt` emits `- ${name}: ${snippet}` for each visible tool, so the assembled `Available tools:` section reads

```text
- subagent: subagent: Launch a specialized agent for complex, multi-step tasks.
- colgrep: colgrep: Semantic and hybrid code search — find code by intent, not just text.
```

while third-party tools that omit the prefix read correctly (`- web_search: Use for web research questions.`).

The fix is to delete the `"<tool_name>: "` prefix from all 11 snippets across the three packages.

## Goals

- Remove the leading `"<tool_name>: "` from the `promptSnippet` of all 11 tools in `pi-colgrep` (1), `pi-github-tools` (7), and `pi-subagents` (3).
- Update the three exact-string `promptSnippet` assertions in `pi-subagents`' tool tests to the new values.
- Keep every snippet's wording otherwise byte-identical, so the only change on the wire is the removed prefix.

This is **not** a breaking change: no user-visible API, config key, or default changes, and no user edit is required on upgrade.
The system prompt's agent-facing prose changes, which is exactly the defect being fixed, so the commits are `fix:`.

## Non-Goals

- **No change to `promptGuidelines`.**
  Pi flattens every active tool's guideline bullets into one unattributed `Guidelines:` list ([earendil-works/pi#4879]), so a guideline that names its own tool ("Prefer colgrep for intent-based searches…") is carrying attribution the renderer does not supply.
  That reasoning is sound and independent of this fix.
- **No regression guard.**
  A convention test (assert no snippet starts with `<name>:`) and a documented note in the `code-design` skill were both considered and declined by the operator; this plan changes the 11 strings only.
- No change to any tool's `description`, `label`, or `name`.
- No rewrite of historical plan/retro documents that quote the old snippet strings (`packages/pi-subagents/docs/plans/0152-*.md`, `0242-*.md`, `packages/pi-colgrep/docs/plans/0092-*.md`) — they are dated records of what shipped then.
- No change to `@gotgenes/pi-permission-system`, whose `Available tools:` narrowing parses Pi's `- name:` bullet prefix and is indifferent to the snippet body.

## Background

### Verified rendering (why the prefix is redundant)

- `../pi/packages/coding-agent/src/core/system-prompt.ts:83` — `visibleTools.map((name) => \`- ${name}: ${toolSnippets!
  [name]}\`)`.
  The same string is present in the compiled `dist/` of both installed SDK versions in this workspace, `@earendil-works/pi-coding-agent@0.79.1` and `@0.80.5`.
- The second render path, `../pi/packages/coding-agent/src/server/create-harness.ts:57-77`, builds `toolSnippets` keyed by `tool.name` and delegates to the same `buildSystemPrompt`.
  There is no code path that renders a snippet without its tool name.
- Pi's extension docs show snippets without a name prefix (`docs/extensions.md:1369`, `:1946`).
- Direct observation: a live session's system prompt lists `- subagent: subagent: …` and `- colgrep: colgrep: …` alongside correctly-rendered third-party entries.

### Provenance of the convention

The `name:` prefix entered with pi-colgrep's tool registration (`0ad2bbdc`, [#90]), was copied by pi-github-tools, and then by pi-subagents ([#152]) explicitly "matching the sibling convention" — no package or skill documents a rationale for it.
The related rationale that does exist, [earendil-works/pi#4879], concerns `promptGuidelines` attribution and does not transfer to snippets (see Non-Goals).

### Size

The 11 prefixes total 147 characters (measured by character count; ≈37 tokens) in every assembled system prompt.
The motivation is correctness of the rendered prose, not the token saving.

## Design Overview

Each edit deletes a leading `"<name>: "` from a string literal.
No signature, type, or control flow changes.

| Tool                  | Package         | Snippet after the fix                                                                                                                         |
| --------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `colgrep`             | pi-colgrep      | `Semantic and hybrid code search — find code by intent, not just text.`                                                                       |
| `ci_find`             | pi-github-tools | `Wait for a CI run matching a pushed SHA. Returns run ID and jobs.`                                                                           |
| `ci_watch`            | pi-github-tools | `Poll a CI run until it completes. Streams job-level progress.`                                                                               |
| `ci_list`             | pi-github-tools | `List recent CI runs for a workflow.`                                                                                                         |
| `release_pr_find`     | pi-github-tools | `Find the release-please PR after pushing to main.`                                                                                           |
| `release_pr_merge`    | pi-github-tools | `Merge a release-please PR after confirming it's clean, waiting out any in-progress checks and verifying the outcome of a failed merge call.` |
| `release_watch`       | pi-github-tools | `Wait for a release tag after merging release-please.`                                                                                        |
| `issue_close`         | pi-github-tools | `Close a GitHub issue with an optional comment.`                                                                                              |
| `subagent`            | pi-subagents    | `Launch a specialized agent for complex, multi-step tasks.`                                                                                   |
| `get_subagent_result` | pi-subagents    | `Check status and retrieve results from a background agent.`                                                                                  |
| `steer_subagent`      | pi-subagents    | `Send a mid-run message to redirect a running background agent.`                                                                              |

Several snippets are written as multi-line concatenations or wrapped string literals; after the prefix is removed, let Biome reflow them (a shortened `ci_list`-style snippet may collapse onto one line, and a wrapped literal may lose a continuation).
Do not hand-format around the formatter.

## Module-Level Changes

`packages/pi-colgrep/`:

- `src/tools/colgrep.ts:102-103` — drop the `colgrep:` prefix.

`packages/pi-github-tools/`:

- `src/tools/ci-find.ts:16-17`, `ci-watch.ts:15-16`, `ci-list.ts:13`, `release-pr-find.ts:15-16`, `release-pr-merge.ts:26-28`, `release-watch.ts:15-16`, `issue-close.ts:13-14` — drop each tool's name prefix.

`packages/pi-subagents/`:

- `src/tools/agent-tool.ts:156` — drop `subagent: `.
- `src/tools/get-result-tool.ts:78-79` — drop `get_subagent_result: `.
- `src/tools/steer-tool.ts:86-87` — drop `steer_subagent: `.
- `test/tools/agent-tool.test.ts:42`, `test/tools/get-result-tool.test.ts:35`, `test/tools/steer-tool.test.ts:35` — update the three exact-string expectations.

No docs change.
Grepping the three packages' `README.md`, `docs/` (excluding `docs/plans/`, `docs/retro/`), `skills/`, and the `.pi/skills/package-*` files for each snippet string and for `promptSnippet` found no user-facing documentation that quotes a snippet or describes the convention — only historical plans and retros, which are Non-Goals.
No architecture-doc module listing, complexity table, or health metric references these files' contents.

## Test Impact Analysis

1. **New tests enabled:** none.
   The change is a string edit inside existing, already-covered tool definitions; the operator declined the cross-package convention test that would have been the only genuinely new coverage.
2. **Tests that become redundant:** none.
   The three `pi-subagents` `includes promptSnippet` tests keep their value — they pin the exact wire string — and are updated in place.
3. **Tests that must stay as-is:** the rest of each tool-definition suite (`name`, `label`, `description`, parameter-schema assertions) is untouched.

Accepted gap: `pi-colgrep` and `pi-github-tools` have no tool-definition tests at all (`test/tools/colgrep.test.ts` covers `executeColGrepSearch` only; `pi-github-tools` has only `test/lib/` and `progress.test.ts`), so their 8 edits are verified by review plus `pnpm run check` / `pnpm run lint`, not by an assertion.
This is the direct consequence of declining the guard, recorded here so the next reader does not mistake it for an oversight.

## Invariants at risk

- **[#437] — narrow, don't strip, the `Available tools:` section (pi-permission-system).**
  `extractToolBulletName` matches `^\s*-\s+([A-Za-z0-9_-]+):` against the bullet Pi renders, so it reads the name Pi prefixes, never the snippet body.
  A snippet losing its own `name:` prefix cannot change which line is kept or dropped.
  Pinned by `packages/pi-permission-system/test/system-prompt-sanitizer.test.ts`; that suite uses its own fixture prompts and needs no update.
- **[#640] — byte-identical parent/child prompt prefix (pi-subagents).**
  The invariant is that the child's inherited prompt prefix matches the parent's byte for byte, not that it has any particular length.
  All three snippets shorten identically in parent and child (the same tool definitions produce both), so the shared prefix stays byte-identical; only its length changes.
  Pinned by the `buildAgentPrompt` prefix tests in `packages/pi-subagents/test/session/prompts.test.ts`, which construct their own prompts and are unaffected.

## TDD Order

1. **pi-subagents (3 tools).**
   Red: update the three exact-string expectations in `test/tools/agent-tool.test.ts`, `get-result-tool.test.ts`, and `steer-tool.test.ts` to the prefix-free strings; run `pnpm --filter @gotgenes/pi-subagents run test` and watch them fail.
   Green: drop the prefix in `src/tools/agent-tool.ts`, `get-result-tool.ts`, and `steer-tool.ts`.
   Commit: `fix(pi-subagents): drop the redundant tool-name prefix from promptSnippet (#778)`.
2. **pi-github-tools (7 tools).**
   No test surface exists; edit the seven snippets and verify with `pnpm --filter @gotgenes/pi-github-tools run check` plus `pnpm run lint`.
   Commit: `fix(pi-github-tools): drop the redundant tool-name prefix from promptSnippet (#778)`.
3. **pi-colgrep (1 tool).**
   Same shape as step 2 for `src/tools/colgrep.ts`.
   Commit: `fix(pi-colgrep): drop the redundant tool-name prefix from promptSnippet (#778)`.

The steps are split per package so each component's changelog entry describes only its own tools; they are independent and may land in any order.
Every commit body carries `Refs #778`.

## Risks and Mitigations

| Risk                                                                                                   | Mitigation                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A future Pi release stops prefixing the name, silently reverting the section to unlabeled snippets     | Verified the prefix in both installed SDK versions and on Pi's `main`, and in both render paths; Pi's own built-in tools and documented examples rely on the same behavior, so a change would break them too. |
| A stale copy of an old snippet is reintroduced by copying an existing tool as a template for a new one | Accepted — the operator declined the convention test and doc note; the whole class is cleared in this pass, so a new tool has no in-repo example of the prefix left to copy.                                  |
| A snippet's wording drifts while the prefix is removed                                                 | Each new value is fixed in the Design Overview table; the pi-subagents assertions pin three of them exactly.                                                                                                  |
| Formatter reflow makes the diff noisier than the semantic change                                       | Expected; run the package's `check`/`lint` and let Biome own the layout rather than hand-wrapping.                                                                                                            |

## Open Questions

None.
The scope (all three packages) and the guard decision (none) were settled with the operator before this plan was written.

[#90]: https://github.com/gotgenes/pi-packages/issues/90
[#152]: https://github.com/gotgenes/pi-packages/issues/152
[#437]: https://github.com/gotgenes/pi-packages/issues/437
[#640]: https://github.com/gotgenes/pi-packages/issues/640
[#778]: https://github.com/gotgenes/pi-packages/issues/778
[earendil-works/pi#4879]: https://github.com/earendil-works/pi/issues/4879
