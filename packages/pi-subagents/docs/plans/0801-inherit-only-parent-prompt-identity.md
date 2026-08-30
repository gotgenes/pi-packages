---
issue: 801
issue_title: "duplicate available_skills section in subagent's prompt"
---

# Inherit only the parent prompt's identity

## Release Recommendation

**Release:** ship independently

Phase 22 Step 5 carries `Release: independent` in the improvement roadmap, and the batch subsection lists Step 5 under "Independently releasable."
The step's `fix:` commit is an unhidden changelog type, so it is its own release vehicle.

## Problem Statement

`SeniorPlayer` reported that a subagent's system prompt contains two `<available_skills>` catalogues.
The pasted prompt shows the duplication twice over: the `Current working directory:` footer is repeated alongside the catalogue, at the same two positions.

The cause is a boundary flaw in prompt inheritance.
`buildAgentPrompt` embeds the parent session's **fully assembled** system prompt verbatim as the child's cacheable identity prefix, but that string is a complete Pi prompt whose last layers Pi resolves **per session**.
The child's own session then rebuilds those same layers against its own directory, tool set, and extensions and appends them after the inherited copy.

This is exactly the class [#640] fixed for the cwd footer alone.
That fix was per-appendage rather than principled, so the catalogue — which sits immediately ahead of the footer — was never addressed.

## Goals

- A child's assembled system prompt carries exactly one `<available_skills>` catalogue and at most one `Current working directory:` claim, and both describe the **child's** session.
- Replace the per-appendage strip with one rule: the inherited prompt contributes only the layers ahead of Pi's per-session resolution.
- Preserve [#640]'s outcome for a parent session that resolved no skills, where the footer is the first per-session layer present.
- Preserve the [#180] / [#400] KV-cache property: the shared, stable parent content still leads the child's prompt, byte for byte.
- Document the assembly contract for operators and warn extension authors whose handlers append to the system prompt.

This change is **not** breaking.
It alters the content of a generated system prompt, not an exported type, a setting's default, or a documented output shape.
No user edit is required on upgrade, and no configuration selects the old behavior.

## Non-Goals

- **Suppressing the child's own skills catalogue** (`noSkills` on the child's `ResourceLoader`).
  Rejected during the decision gate: it makes a worktree child advertise the parent's project skills, and it re-introduces the knob Phase 16 removed.
- **Changing how `<project_context>` is inherited.**
  `createSubagentSession` already passes `noContextFiles: true` precisely so the inherited copy is the single authoritative one.
  That layer is identity, not per-session resolution, and stays.
- **Any change to `@gotgenes/pi-anthropic-auth`.**
  Verified unaffected — see Invariants at risk.
- **Refreshing `@gotgenes/pi-nocd`'s inherited-block rewrite and its four README passages.**
  Filed as [#846], which depends on this change landing first.
- **Deduplicating the `AgentConfig` object literals across the other ~15 tests in `prompts.test.ts`.**
  Rejected by the Tidy-First assessor as scope creep; those tests are untouched by this change.

## Background

### How Pi assembles a prompt

`buildSystemPrompt` (`dist/core/system-prompt.js` in the pinned `@earendil-works/pi-coding-agent@0.84.4`) writes four regions in order, then extensions append a fifth:

| Region | Content                                                                       | Source                                                                                        |
| ------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `A`    | Pi preamble or `customPrompt`, tool snippets, guidelines, `<project_context>` | `buildSystemPrompt`                                                                           |
| `S`    | skills heading, then `<available_skills>` … `</available_skills>`             | `formatSkillsForPrompt(loader.getSkills())`, gated on the session's tool set including `read` |
| `F`    | `Current working directory: <cwd>`                                            | `buildSystemPrompt`, always last                                                              |
| `X`    | further blocks                                                                | extensions returning `systemPrompt` from `before_agent_start`                                 |

`X` lands after `F` because it is applied later, at `AgentSession.prompt()` time (`dist/core/agent-session.js:914-936`).
It is rebuilt **every turn** from `_baseSystemPrompt` and applied as a one-turn override, so it is transient parent state, never identity.

### How a child gets two of each

`createSubagentSession` passes the assembled string as `systemPromptOverride`, so the child's `buildSystemPrompt` takes the `customPrompt` branch — and still appends its own `S′` and `F′`.
The child's `session.prompt()` then fires `before_agent_start` for its own bound extensions, producing `X′`.
The child's prompt is therefore `A S F X` (inherited verbatim) followed by its own tail, which ends in `S′ F′`.

The inherited copy is not merely redundant.
It is wrong for a child whose cwd differs — a `WorkspaceProvider` worktree resolves project skills from `loadSkills({ cwd: this.cwd })` against the child's directory — and it is the *only* catalogue for an agent whose `tools:` omits `read`, since `buildSystemPrompt`'s `customPromptHasRead` gate then appends no `S′` at all.

### Constraint from AGENTS.md

Pi loads each package's extension once at session start, so this session cannot observe its own fix.
The measurements below were taken against the installed `0.84.4` bundles, not against a running child.

## Design Overview

`buildAgentPrompt` truncates the inherited prompt at the first per-session layer, so a child inherits region `A` and nothing after it.

The call site loses its third argument:

```typescript
const identity = inherited
  ? inheritedIdentity(inherited.systemPrompt, inherited.cwd)
  : genericBase;
```

`InheritedPrompt` keeps both fields — the parent's `cwd` is still what the footer anchor matches against.
`buildAgentPrompt`'s public signature, both prompt modes, the `<active_agent>` tag's position, and `genericBase` are unchanged.

### The helper

Matching is **line-based**, which makes both anchors exact whole-line matches and inherits [#640]'s discipline for free:

```typescript
/** First line of the section Pi writes above the `<available_skills>` catalogue. */
const SKILLS_SECTION_HEADING =
  "The following skills provide specialized instructions for specific tasks.";

/** Closing tag of that catalogue. */
const SKILLS_CATALOGUE_CLOSE = "</available_skills>";

function inheritedIdentity(prompt: string, parentCwd: string): string {
  const lines = prompt.split("\n");
  const tailStart = sessionResolvedTailStart(lines, parentCwd);
  return tailStart === -1 ? prompt : lines.slice(0, tailStart).join("\n").trimEnd();
}

function sessionResolvedTailStart(lines: readonly string[], parentCwd: string): number {
  const skillsAt = skillsSectionStart(lines);
  if (skillsAt !== -1) return skillsAt;
  return lines.lastIndexOf(`Current working directory: ${toPromptPath(parentCwd)}`);
}

function skillsSectionStart(lines: readonly string[]): number {
  const catalogueEnd = lines.lastIndexOf(SKILLS_CATALOGUE_CLOSE);
  return catalogueEnd === -1
    ? -1
    : lines.lastIndexOf(SKILLS_SECTION_HEADING, catalogueEnd);
}
```

Four properties earn their keep:

1. **The catalogue is located by a pair, not a single string.**
   The heading is only accepted when a `</available_skills>` line follows it.
   A project-context file that quotes Pi's heading in prose is therefore not a cut point, and `lastIndexOf` from the catalogue's close reaches the real section even then.
2. **The footer is the fallback, not a second cut.**
   `S` precedes `F`, so cutting at `S` already removes `F`.
   The footer anchor fires only for a parent that resolved no skills — which is what preserves [#640]'s fix for that case.
3. **`trimEnd()` normalizes the seam.**
   `buildAgentPrompt` joins with `"\n\n"`, and the lines ahead of the heading end with a blank line, so without the trim the seam is three newlines.
   The trimmed bytes sit at the divergence point, so nothing cacheable is lost.
4. **An unmatched prompt is returned unchanged**, mirroring the helper it replaces.

`toPromptPath` (the existing backslash normalizer) is retained and still needed by the footer anchor.

### Why truncation rather than excision

Cutting `S` and `F` out while keeping `X` was the alternative.
It leaves `X` in the child but *displaces* it past the divergence point, so it moves from cached to prefilled — measured at ~275 characters (~69 tokens) in [#640]'s environment, about 0.3 s on the local-model hardware [#180]'s reporter measured at 8,333 tokens ≈ 40 s.

Truncation costs nothing there, because `X` is deleted rather than displaced: the child's uncached token count is **unchanged** from today.
It is also the more accurate prompt, which is the deciding criterion.
The inherited `X` was built for the parent's directory and the parent's extension set: pi-nocd's block names the parent's cwd (the [#640] bug), and a package excluded from children via `excludedExtensionPackages` ([#696]) still leaks its block in through the inherited copy.

The accepted residual: an extension whose `before_agent_start` handler is conditional — gated on an interactive UI, or on state cached at `session_start` — appends nothing in the child, which then has less guidance than today.
The mechanism is verified to fire in children (`bindExtensions` at `create-subagent-session.ts:245`; `session.prompt()` at `subagent-session.ts:123,147`; `emitBeforeAgentStart` unconditional at `agent-session.js:914`), and our own appender is unconditional, but the third-party population cannot be enumerated.
This residual is recorded in the ADR, not only here.

### Revising [#640]'s equal-cwd carve-out

[#640] kept the footer when child and parent cwd agree, on one argument: stripping an accurate duplicate would shorten the byte-identical prefix.
The catalogue sits **ahead** of the footer, so once it is cut the footer is already outside the shared prefix and the argument is void.
The carve-out now buys 86 characters, and only for a parent session that resolved no skills.
It is removed; the footer strip is unconditional.

## Module-Level Changes

| File                                                                             | Change                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/pi-subagents/src/session/prompts.ts`                                   | Replace `withoutContradictoryCwdFooter` with `inheritedIdentity` + `sessionResolvedTailStart` + `skillsSectionStart` and the two anchor constants; drop the third argument at the call site (line 53); rewrite `buildAgentPrompt`'s docstring paragraph on inheritance. `toPromptPath` and `genericBase` unchanged. |
| `packages/pi-subagents/test/session/prompts.test.ts`                             | Generalize the fixture builder; replace the two carve-out cases; add the truncation cases.                                                                                                                                                                                                                          |
| `packages/pi-subagents/docs/configuration.md`                                    | New `## What a child inherits from the parent's prompt` section after `## Default Agent Types`, absorbing the cwd-footer paragraph at lines 19-21.                                                                                                                                                                  |
| `packages/pi-subagents/README.md`                                                | New `### Extensions that append to the system prompt` subsection under `## For Extension Authors`.                                                                                                                                                                                                                  |
| `packages/pi-subagents/docs/decisions/0006-inherited-prompt-is-identity-only.md` | New ADR recording the decision, the revision of [#640]'s carve-out, and the accepted residual.                                                                                                                                                                                                                      |
| `.pi/skills/package-pi-subagents/SKILL.md`                                       | Rewrite the paragraph at line 30, which states the narrower cwd-footer-only rule.                                                                                                                                                                                                                                   |
| `packages/pi-subagents/docs/architecture/architecture.md`                        | Module-tree entry for `prompts.ts` (line 347) describes current behavior; Phase 22 Step 5 gains `✅` and a `Landed:` note; the `S5` Mermaid node gains `✅`.                                                                                                                                                        |

### Symbol and prose greps run at planning time

- `withoutContradictoryCwdFooter` — two `src/` hits (both in `prompts.ts`), one architecture-doc hit inside Step 5's `Target files:` line, which stays as written-at-planning-time per the roadmap's `Landed:` convention.
- `Current working directory` — `docs/configuration.md:19`, `.pi/skills/package-pi-subagents/SKILL.md:30`, and `prompts.ts`.
  No README hit.
- `parentPromptNaming` — test-file-local, eight call sites, all inside the one describe block.
- `available_skills` across `packages/` — `pi-permission-system`'s `skill-prompt-sanitizer.ts` parses **every** catalogue in a prompt and is a pure beneficiary: it currently double-counts the duplicated entries into `visibleEntries`.
  No change owed to it.

### `docs` shipping check

`docs/*.md` and `docs/decisions` are both in the `files` allowlist, so the new configuration section and ADR ship in the tarball.
The README may link to the ADR by relative path.

## Test Impact Analysis

**What the change makes newly testable.**
The existing `parentPromptNaming(cwd)` builds one fixed three-line shape (body, date line, footer) and cannot express a skills block, an absent footer, or an extension tail.
The matrix this change must cover is skills × footer × tail, so the builder is generalized first — that is the Tidy-First preparatory step, and it is the only preparatory work the assessor recommended.

**A matcher's testable surface is its input domain, not the inputs one can picture.**
The fixture builds its skills block with the SDK's real `formatSkillsForPrompt`, imported from `@earendil-works/pi-coding-agent`, so an upstream rewording of the heading turns the suite red instead of silently reverting the anchor to the footer fallback.
The domain shapes the matcher must survive:

| Shape                                                          | Expected                                         |
| -------------------------------------------------------------- | ------------------------------------------------ |
| skills + footer + extension tail                               | cut at the skills heading                        |
| skills + footer, no tail                                       | cut at the skills heading                        |
| skills, no footer                                              | cut at the skills heading                        |
| footer only, no skills                                         | cut at the footer ([#640] preserved)             |
| neither                                                        | returned unchanged                               |
| a footer naming a directory sharing a prefix with the parent's | not a cut point                                  |
| a Windows parent cwd reaching the prompt with forward slashes  | cut at the footer                                |
| project context quoting Pi's skills heading in prose           | not a cut point; the real section is still found |

**Tests that become redundant.**
Two cases assert the carve-out being removed and are replaced by cases asserting the opposite: `"leaves the footer in place when the child shares the parent's cwd"` and `"treats separator variants of the same directory as agreeing"`.

**Tests that must stay.**
The prefix-collision case, the backslash-normalization case, the no-footer no-op, and the `"makes no Current working directory claim when the directories differ"` end-to-end invariant all still exercise the footer anchor, which survives as the fallback.

## Invariants at risk

| Invariant                                                                              | Where it is pinned                                                           | Status                                              |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------- |
| A child prompt makes no claim of the parent's cwd when the directories differ ([#640]) | `"makes no Current working directory claim when the directories differ"`     | Preserved and widened to equal cwds                 |
| The inherited prefix stays byte-identical when child and parent cwd agree ([#640])     | the two carve-out cases                                                      | **Deliberately revised** — see Design Overview      |
| `<active_agent name="…"/>` follows the cacheable parent prefix (Patch 3, [#443])       | three ordering cases in `describe("active_agent tag injection")`             | Unchanged — the tag still follows `identity`        |
| Shared, stable parent content leads the child prompt ([#180], [#400])                  | `"replace mode orders: identity → active_agent → env → config.systemPrompt"` | Unchanged — the prefix is shorter but still leading |
| `pi-anthropic-auth`'s preamble span survives child prompts                             | external repo; no test owed here                                             | Verified unaffected                                 |

### The `pi-anthropic-auth` verification

It shapes at the provider-request boundary, rewriting a span in place rather than appending, so it is not one of the `X` producers.
Its span is bounded by `PI_DEFAULT_PROMPT_PREFIX` (`"You are an expert coding assistant operating inside pi, a coding agent harness."`) and `PI_DEFAULT_PROMPT_TERMINATOR` (`"- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)"`).
Both are lines of Pi's built-in preamble, inside region `A`, which truncation preserves byte for byte.
Its own constant docstring states the assumption this change satisfies: the shaping preserves "anything appended after the preamble (project context, skills, and date/cwd footer)".
On its degraded path (terminator drift), it sanitizes the whole prompt — which this change makes strictly shorter.

### Quantitative prediction

Measured in this repo at this cwd against `@earendil-works/pi-coding-agent@0.84.4`:

| Quantity                                            | Measured    | After                                                                                                 |
| --------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| Skills catalogue (`S`), 17 skills                   | 7,586 chars | removed from the inherited copy                                                                       |
| cwd footer (`F`)                                    | 86 chars    | removed                                                                                               |
| pi-nocd's block alone (`X`, partial)                | 314 chars   | removed                                                                                               |
| Child prompt length                                 | baseline    | **at least 7,986 chars shorter** (≈ 2,000 tokens)                                                     |
| Child prompt tokens requiring prefill               | baseline    | **unchanged** — the removed regions were inside the cached prefix, and nothing is displaced out of it |
| `grep -c 'available_skills' src/session/prompts.ts` | 0           | ≥ 1 (roadmap metric row satisfied by `SKILLS_CATALOGUE_CLOSE` and the docstring)                      |

## TDD Order

1. **`test(pi-subagents): make the parent-prompt fixture composable in prompts.test.ts`** Tidy-First preparatory step; no production change, tree stays green.
   Prepares the friction named above: the five prompt shapes the new cases need cannot be expressed by `parentPromptNaming`'s fixed three-line form, so without it each new case hand-assembles its own multi-line string and an off-by-one in the cut is masked by inconsistent fixtures.
   Replace `parentPromptNaming(cwd)` with a piece-based builder taking optional body, skills, footer cwd, and tail, building its skills piece with the SDK's `formatSkillsForPrompt`; migrate the eight existing call sites.
   Take the assessor's Optional item in the same commit: split the block's flat list into nested `describe`s by anchor (`skills-catalogue anchor` / `cwd-footer anchor` / `no anchor`), so the roughly fifteen cases the next step leaves behind stay legible.
   Anchor the new nesting on the block's own closing line and verify with `grep -n '^  describe\|^  });'` — a sibling block inserted mid-file can reparent everything after the seam with a green suite (Refs #788).
   Killing mutation: make `withoutContradictoryCwdFooter` return `prompt` unconditionally; the four footer-strip cases must go red, proving the reshaped fixtures still pin [#640] before it is changed.

2. **`fix(pi-subagents): give a subagent one skills catalogue and one working-directory claim`** Red: rewrite the two carve-out cases to assert the footer is now stripped when the cwds agree, and add the truncation cases across the domain table above, in both prompt modes.
   Green: replace `withoutContradictoryCwdFooter` with `inheritedIdentity`, `sessionResolvedTailStart`, `skillsSectionStart`, and the two constants; drop the third argument at line 53; rewrite the docstrings.
   Place the new helpers below `buildAgentPrompt` and above `toPromptPath`, keeping the stepdown order.
   Verify with `pnpm --filter @gotgenes/pi-subagents exec vitest run` (the full package suite, not just the one file) and `pnpm run check`.
   Killing mutations, one per equivalence class:
   - Make `skillsSectionStart` return `-1` unconditionally → every skills-anchor case goes red, the footer-only cases stay green.
   - Delete the footer fallback from `sessionResolvedTailStart` (return `skillsAt`) → the footer-only cases go red, the skills cases stay green.
   - Change `skillsSectionStart` to `lines.lastIndexOf(SKILLS_SECTION_HEADING)` without the catalogue-close guard → the prose-quoting-the-heading case goes red.
   - Re-add an early `if (toPromptPath(parentCwd) === toPromptPath(childCwd)) return prompt` → the rewritten equal-cwd cases go red.

3. **`docs(pi-subagents): document how a child's system prompt is assembled`** The new `configuration.md` section (absorbing lines 19-21), the README subsection for extension authors, ADR `0006`, and the package skill's paragraph at line 30.
   The ADR carries the rationale the two user docs link to: truncation over excision, the revision of [#640]'s carve-out, and the accepted residual for conditional appenders.
   Verify with `pnpm exec rumdl check` on each edited file.

4. **`docs(pi-subagents): mark Phase 22 Step 5 complete`** The module-tree entry for `prompts.ts`, Step 5's `✅` and `Landed:` note, and the `S5` Mermaid node.
   The module-tree entry describes current behavior and cites an issue only for an active constraint, so it names the truncation rule rather than accumulating a provenance trail.
   Re-run the roadmap's metric command and record the measured value in the `Landed:` note.
   `docs/architecture` is in `release-please-config.json`'s `exclude-paths`, so this commit cuts no release on its own.

## Risks and Mitigations

| Risk                                                                                            | Mitigation                                                                                                                                             |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Upstream rewords the skills heading, silently reverting the cut to the footer fallback          | The fixture builds its skills block with the SDK's own `formatSkillsForPrompt`, so the drift turns the suite red on the next dependency bump           |
| A project-context file quotes Pi's skills heading and becomes a false cut point                 | The heading is accepted only when a `</available_skills>` line follows it, and the search runs backwards from that close tag; covered by a domain case |
| A footer naming a directory that shares a prefix with the parent's is mistaken for the parent's | Line-based `lastIndexOf` is an exact whole-line match; the existing `/repo` vs `/repo-worktrees/issue-42` case still pins it                           |
| A conditionally-appending third-party extension leaves its child with less guidance than today  | Accepted residual, recorded in ADR 0006 and warned about in the README's extension-author subsection                                                   |
| `@gotgenes/pi-nocd`'s docs and rewrite branch assert a premise this change removes              | Filed as [#846], sequenced after this lands                                                                                                            |
| The three-newline seam at the cut point                                                         | `trimEnd()` on the truncated identity; the trimmed bytes are at the divergence point, so nothing cacheable is lost                                     |

## Open Questions

- A degenerate inherited prompt consisting **only** of a skills section would truncate to the empty string, giving the child an identity-less prompt.
  `buildSystemPrompt` always writes a base or `customPrompt` ahead of region `S`, so this is unreachable, and the plan adds no guard for it.
  Revisit only if a real prompt shape produces it.
- Whether `@gotgenes/pi-nocd`'s inherited-block rewrite branch should be removed outright or kept as defensive behavior is deferred to [#846], which is scheduled after this lands.

[#180]: https://github.com/gotgenes/pi-packages/issues/180
[#400]: https://github.com/gotgenes/pi-packages/issues/400
[#443]: https://github.com/gotgenes/pi-packages/issues/443
[#640]: https://github.com/gotgenes/pi-packages/issues/640
[#696]: https://github.com/gotgenes/pi-packages/issues/696
[#846]: https://github.com/gotgenes/pi-packages/issues/846
