---
name: markdown-conventions
description: |
  Load before writing or editing any markdown, an architecture-doc module tree, or a plan/retro:
  one-sentence-per-line, tables, issue links, frontmatter, retro stage format, `pi-autoformat` reflow quirks.
---

# Markdown Conventions

Load this skill when writing or editing markdown files.

## Formatting rules

The enforcer is `rumdl` (runs as part of `pnpm run lint`; also the pre-commit `rumdl fmt` hook), not `markdownlint-cli2` — there is no markdownlint binary in this repo.
Rules below are named by their markdownlint `MDxxx` IDs because `rumdl` implements the same rule family; use the IDs for reference, not the tool.
Checking a file outside the repository (a scratch sample in `/tmp`) needs `--config .rumdl.toml` — `rumdl` does not discover repo config for it, so MD013 fires against the default 80-character limit.

### Lines and sentences

- Use one sentence per line (unbroken) for better diffs.
  Each sentence occupies exactly one line; never wrap a sentence across lines or place two sentences on the same line.
  This applies to all prose, including list-item continuations.
- `rumdl`'s `MD057` can report an existing relative link as missing when its sentence runs long; split the sentence per the rule above rather than hunting the path.
- Author and append markdown with the `Write`/`Edit` tools, not shell heredocs (`cat <<EOF`) — heredocs don't interpolate `\uXXXX` escapes and make one-sentence-per-line slips easy, both of which trip markdownlint.

### `pi-autoformat` reflow

The `pi-autoformat` extension reformats every file an `Edit`/`Write` touches, and its markdown pass rewrites prose in ways `rumdl` then accepts:

- It also joins a line ending in `:` with the sentence after it — to add a sentence there, start a new paragraph, not a new line.
- It likewise joins a sentence onto the previous line when the sentence opens with a lowercase token (a package or command name such as `git-cliff`) — lead with a capital instead.
- It also reads a numbered section citation (`§ *7. Verify CI*`) as a sentence end and splits it — cite the heading instead (`` the `## 7. Verify CI` section ``).
- It also reads a leading `~` as strikethrough and rewrites a `~`-prefixed token (`(~:211)` → `(~~211)`), which `rumdl check` passes — write an approximate line reference as `line ~211`.

Damage this pass writes lands in the file's first commit, so git holds no clean copy; recover the authored text from the `Write` `content` / `Edit` `newText` arguments in the session transcripts under `~/.pi/agent/sessions/`.

### Non-ASCII in authored prose

An em-dash in a `newText`/`content` body is unreliably emitted: it can arrive as a bare newline, splitting a sentence or a heading.
The result is valid markdown that `rumdl` accepts, so no gate catches it.
After writing prose, re-read the region and scan it with `rg -n --multiline ' \n [a-z]' <file>`, which reports the split sentence and the line it ran into.
`pi-autoformat` rejoins that split before you can scan for it, though, so the damage often survives as a missing word mid-sentence — read the region, do not rely on the pattern alone.
Prefer a colon, semicolon, or parentheses when the sentence allows it (Refs #814, #933).

It can also arrive as an invisible `\x0c` form feed plus literal text: `erence2` for an em-dash, `erence6` for an ellipsis.
The corruption is upstream of every tool here — measured across 1764 session transcripts, 62 of 122 occurrences sit in plain assistant prose with no tool call involved, so `Edit` writes faithfully what the model already emitted (Refs #863, #960).
Replacing the visible text leaves the byte behind, so a grep for `erence2` passes on a still-corrupt file.
A pre-commit hook and `pnpm run lint` now reject it, so you no longer have to remember to look; run `node scripts/lint/invisible-characters.mjs` to check on demand, and `--fix` to delete the zero-width characters it can repair.
A form feed it will not repair for you: deleting the byte alone strands the `erence2`, so replace the whole token.
Write the character itself in an `Edit`/`Write` body, never a `\uXXXX` token — the addendum's literal-character rule governs `newText` as much as `oldText`.
That governs *matching* as much as writing: a rejected `oldText` on a line holding an em-dash is usually a token you emitted wrong, not a file that moved.
On #966 ten batches failed because U+2014 left the model as a tab plus `a`, as a bare newline, or as the literal escape, while a spike matched and wrote a real em-dash in every trial — so re-emit the character before changing tactics.
Only when it genuinely will not emit, write a placeholder and substitute it in a scripted pass — `…`, then `s.replace('…', '\u2014')`.
The escape there belongs to the substituting script; hand-written in an edit body it arrives over-escaped (`\\u2014`) and lands in the file as literal text (Refs #960).

That literal form is gated in markdown.
Outside code spans and fenced blocks, the pre-commit hook and `pi-autoformat` decode a `\u2014` or `\u{1F600}` escape to its character, and `pnpm run lint` rejects any left behind, along with a bare `u2014` whose backslash was lost; run `node scripts/lint/unicode-escapes.mjs [--fix]` on demand (Refs #967).
A bare token, or an escape for an invisible character, it reports for a hand repair.
To quote an escape on purpose, put it in backticks; in bare prose, write `\\u2014`, which CommonMark renders as the literal and the gate leaves alone.
The same gate covers the comments of `.ts`/`.js`/`.mjs` files, where a string literal stays exempt and a backtick quote is the escape hatch too.
That hatch also hides a glyph you emitted wrong: an ellipsis or em-dash inside backticks (`time ( … )`) that arrives as an escape passes every gate, so after writing one in a code span, run `rg -n '\\u20[0-9a-f]{2}' <file>`.
The split-sentence form stays a manual scan: `rumdl`'s sentence-per-line reflow rejoins the split before any gate runs, so what survives is a missing word no pattern can see.

### Code fences

- Always specify a language on fenced code blocks (e.g., ` ```typescript `, ` ```bash `, ` ```jsonc `, ` ```text `); use `text` for plain output.
- When embedding markdown that itself contains fenced code blocks, use a 4-backtick outer fence (` ````markdown `).

### Lists, headings, and emphasis

- Use sequential numbering (`1.` `2.` `3.`) in ordered lists, restarting at `1.` under each new heading — markdownlint's MD029 rejects continued numbering across section boundaries.
- Do not use bold text (`**...**`) as a substitute for headings — use proper heading syntax; markdownlint's MD036 rejects emphasis used as headings.

### Inserting a new section

Before inserting a new `##`/`###` section into an existing document, read the parent section end to end.
An insertion point that reads correctly at the seam can reparent what follows it — a shared example block, a trailing summary sentence — under the new heading.

### Tables and blockquotes

- Use compact table style with no cell padding — markdownlint's MD060 enforces consistent column style and is not auto-fixable.
  Example: `| Header | Header |` / `| --- | --- |` / `| cell | cell |` — spaces inside pipes, no padding variation.
- Separate adjacent blockquotes with an HTML comment (`<!-- -->`) to satisfy markdownlint's MD028.

### Issue references

- In long-lived docs (`docs/architecture/`, `docs/plans/`), reference GitHub issues with reference-style links — `[#42]` in the body, `[#42]: https://github.com/gotgenes/pi-packages/issues/42` at the end of the file.
  Bare `#42` auto-links on GitHub but not in other renderers.
  Every `[#N]:` definition must have a matching `[#N]` reference in the body (markdownlint MD053 rejects unused definitions).
  A `[#N]` wrapped in backticks is a code span, not a link reference — it does not count toward the matching-reference requirement, so the `[#N]:` definition still trips MD053.
  Likewise, a `[#N]` inside a fenced code block (e.g. the `architecture.md` module-layout tree) is not a live reference — cite issues there as bare `#N` with no `[#N]:` definition (matching the block's existing entries), or MD053 rejects the orphaned definition.
  Write `[#N]` as plain text, including inside other formatting (`**[#N] label:**`).
  Do not add a definition for the doc's own issue number — it lives in frontmatter, not as a body link.
  Link reference definitions are file-scoped: when appending a stage entry to a retro that already defines `[#N]:`, reference it without re-adding the definition — a duplicate trips MD053.
- ADR numbering is per-package, but `[ADR-NNNN]` reference-link definitions are file-scoped and may already point to another package's ADR (e.g. pi-subagents' `[ADR-0002]`).
  When citing this package's own ADR in such a doc, reference it by path (`docs/decisions/NNNN-<slug>.md`), not a bare `ADR-NNNN` token.

### Version numbers

Never name an unreleased version in docs, nor write a plan step that does — `next-version.sh` prints a prediction that moves with every commit; name the condition instead ("the major after 36.x").

## Documentation frontmatter

Docs under `docs/plans/` and `docs/retro/` use YAML frontmatter for structured metadata.
Single-package work lives in `packages/<PKG>/docs/{plans,retro}/`; cross-package work lives in the top-level `docs/{plans,retro}/`.
GitHub renders it as a table at the top of the file.

Schema (both fields are strings/numbers — quote any title containing backticks or colons):

```yaml
---
issue: 14 # optional: omit for plans that predate issue tracking
issue_title: "Short descriptive title" # required
---
```

- `issue` stores the number only, never a URL.
- Do not duplicate frontmatter fields as inline metadata in the body (e.g., `Issue #N` in the H1 is fine; a separate `**Issue:** #N` line is not).
- Other doc types (`README.md`) do not use frontmatter.

### Retro file format

Get each stage timestamp from `date -u +"%Y-%m-%dT%H:%M:%SZ"` — never write one from memory; a model has no clock.

Retro files use YAML frontmatter and accumulate `## Stage:` entries:

````markdown
---
issue: 42
issue_title: "Extract ExtensionPaths value object"
---

# Retro: #42 — Extract ExtensionPaths value object

## Stage: Planning (2026-05-20T14:00:00Z)

### Session summary

...

### Observations

...

## Stage: Implementation — TDD (2026-05-21T10:00:00Z)

### Session summary

...

### Observations

...

## Stage: Final Retrospective (2026-05-22T16:00:00Z)

### Session summary

...

### Diagnostic details

- **Model-performance correlation** — Explore subagent ran on claude-sonnet-4-20250514; appropriate for read-only codebase search.
- **Escalation-delay tracking** — 8 consecutive tool calls on the same lint error in TDD step 3 before switching approach.
- **Feedback-loop gap analysis** — `pnpm run check` ran only after step 6; should have run after step 4 (interface change).
````

The `### Diagnostic details` subsection is optional — include it only when the `/retro` prompt's diagnostic lenses produce actionable findings.
Omit it when all lenses find nothing notable.

## Architecture docs

Every package's `docs/architecture/architecture.md` module-tree entries describe **current behavior** — what each module is now.
Cite an issue in a module-tree entry **only** when the ref encodes an active constraint (a lint-guarded boundary, an ADR string boundary, a structural invariant); all other provenance belongs in git log and `docs/architecture/history/`, never in the tree (the "relocated #559, dissolved #505, renamed #510…" trail).
`/finish-phase`'s bounded doc-hygiene step holds each phase's touched module-tree entries to this standard.

An accepted residual — an ADR bullet, a follow-up issue body — is a claim about the **mechanism**, not the symptom that exposed it.
Enumerate the mechanism's inputs before writing it.
