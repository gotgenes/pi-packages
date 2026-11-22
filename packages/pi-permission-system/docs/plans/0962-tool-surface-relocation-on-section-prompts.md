---
issue: 962
issue_title: "pi-permission-system: the tool-surface relocation is a no-op on pi ≥0.86, so a session sees Pi's unfiltered tool list alongside the narrowed one"
---

# Relocate the tool surface on pi ≥0.86's section-shaped prompt

## Release Recommendation

**Release:** ship independently

This issue is not a roadmap step.
The architecture doc's open-issue sweep dispositions record it as out of scope for the current phase, on [#890]'s precedent, so it carries no `Release:` batch tag.

## Problem Statement

Starting with pi 0.86, `buildSystemPrompt` writes the prompt as an untagged preamble followed by tagged sections joined by blank lines.
The tool list is a `<tools>` section, the guideline bullets are a `<rules>` section, and the cwd is a `<cwd>` section.
`renderToolSurface` (`src/exposure/tool-surface-prompt.ts`) anchors on three strings pi no longer writes: the `Current working directory:` footer and the `Available tools:` / `Guidelines:` headers.
So the relocation ADR 0014 specifies never happens.
Pi's unfiltered `<tools>` list and its `<rules>` stay near the top of the prompt, and this package's narrowed block is appended below them.
The model sees two tool lists, and the stale, wider one comes first.
The failure leans toward over-disclosure: a tool the policy denies is still advertised, along with its guideline bullets.

Planning found a second defect that the issue does not describe.
With no footer to split on, the whole prompt counts as "head".
When pi wrote the preamble, head removal deletes the first `Guidelines:` / `Available tools:` section it finds anywhere.
Through 0.85 that was always pi's own, because pi's sections came first.
On 0.86 pi writes neither header, so the first match is the **user's** own text: a `Guidelines:` block in AGENTS.md, an APPEND_SYSTEM file, or a skill description gets deleted.
That is the [#919] / [#932] defect class, and it now happens in pi's default branch.

## Goals

- On a pi ≥0.86 prompt, remove pi's own `<tools>` and `<rules>` sections when pi wrote the preamble, and render this session's narrowed surface at the end of the prompt, as ADR 0014 specifies.
- Render the relocated block in the host's shape: `<tools>…</tools>` / `<rules>…</rules>` on a section-shaped prompt, `Available tools:` / `Guidelines:` on a footer-shaped one.
- Never remove text pi did not write on a section-shaped prompt: plain-header removal does not run above pi's `<cwd>` section, and a `<tools>`/`<rules>` tag quoted in the addendum, project context, or skills is kept.
- Keep the pass idempotent on both shapes, including a custom-preamble (subagent child) prompt, where 0.86 currently collects a second block on a second pass.
- Carry extension-contributed `promptGuidelines` into the relocated rules, so removing pi's `<rules>` does not drop them.
- Keep every ≤0.85 (footer-shaped) prompt byte-identical to today's output.
- Not breaking: this restores ADR 0014's documented behavior on a pi version the peer range (`>=0.79.0`) already admits, and the block's shape and position are not a documented contract (ADR 0014, *Every node*).
  Commits use `fix:` / `feat:`, with no `BREAKING CHANGE:` footer.

## Non-Goals

- **Editing `event.systemPromptOptions` instead of the text (the "section seam" the issue asks about).**
  In 0.86 the options object can be changed, but none of its fields removes pi's `<tools>`/`<rules>` except `customPrompt`.
  Setting that would mean rebuilding pi's preamble and `<docs>` text ourselves, and it would change what `customPrompt` means to every later handler.
  A custom `sections.tools` entry replaces pi's section in its original position near the top, which is the inherited region [#890] moved the list out of.
  The handler already returns a forced prompt for skill filtering, so text surgery on that prompt remains the mechanism.
- **Raising the `@earendil-works/pi-coding-agent` peer floor or devDependency pin** (`>=0.79.0`, pinned `0.79.1`): tracked as [#970], a separate breaking change sequenced after this one.
  Once the floor passes 0.86 it can delete this plan's footer-shaped layout.
  A newer pin would not let tests build prompts with pi's own builder either: 0.87.1 exports `buildSystemPrompt` from no public entry point.
  The section-shape fixtures are hand-built from the 0.87.1 dist shapes, which is what [#958]'s PR [#959] did for `pi-subagents`.
- **The tool-restored-one-turn-late residual** (architecture doc, *Two-phase checking*).
  The 0.87.1 dist now merges base and run `toolSnippets`, which may have fixed it.
  That is a separate claim about a separate mechanism.
- **A child without this extension inheriting its parent's list** ([#901]).
  This plan updates ADR 0014's statement of the contract a second writer must meet (both shapes), but builds nothing in `pi-subagents`.
- **PR [#908]** (OMP string-array prompts, [#860]) touches the same two `src/` files and stays open.
  Whichever change lands second rebases onto the other.
  Its normalization happens before `renderToolSurface` is called and does not interact with layout detection.
- **`skill-prompt-sanitizer.ts`**: its `<available_skills>` anchors are unchanged in 0.86 (`formatSkillsForPrompt` still writes them inside the new `<skills>` wrapper), so it is predicted unchanged.

## Background

- `src/exposure/tool-surface-prompt.ts` (322 lines) exports `ToolSurfaceInputs` and `renderToolSurface`.
  The pass splits the prompt at the last `Current working directory:` line (`extensionTailStart`).
  Its head is settled by `settleRegion(head, piAuthoredPreamble)`, and its tail is always settled with removal allowed.
  `removeToolSurfaceSections` removes the first `Available tools:` and the first `Guidelines:` section, each bounded to its own body by `isSectionBodyLine`, plus every filler line.
  `renderToolSurfaceBlock` builds the block from `renderAvailableTools` and `renderGuidelines`, and each of those fuses the header with its bullets.
  All of these helpers are unexported: the Tidy-First assessor found no match outside the file.
- `src/handlers/before-agent-start.ts` (`AgentPrepHandler.handle`) calls `renderToolSurface(event.systemPrompt, {...})` with an inline literal.
  It is the only `src/` constructor of `ToolSurfaceInputs`.
  The `test/` constructor is the `inputs()` factory in `test/exposure/tool-surface-prompt.test.ts:19` (`grep -rn "ToolSurfaceInputs" src test`).
  The handler's lean `BeforeAgentStartPayload` declares `systemPromptOptions?: { customPrompt?; toolSnippets? }`.
- Pi 0.87.1's prompt shape, verified against the published tarball (`pnpm view @earendil-works/pi-coding-agent@0.87.1 dist.tarball`, `dist/core/system-prompt.js`) and `@earendil-works/pi-ai@0.87.1`'s `getSystemMessageText`:
  - Sections are built in order: `preamble` (untagged), `tools`, `rules`, `docs` (the last three only without `customPrompt`), then `addendum`, `project_context`, `skills`, `cwd`, then caller `sections`.
  - Each section is rendered as `<name>\n${content}\n</name>`, and the parts are joined with `"\n\n"`.
  - `cwd` renders as `<cwd>\n${cwd.replace(/\\/g, "/")}\n</cwd>` under both branches.
  - `buildRules` writes the file-exploration bullet, then each selected tool's `toolGuidelines`, then `promptGuidelines`, then the two universal bullets, de-duplicated by trimmed text.
  - In 0.87.1 pi itself never populates `promptGuidelines` (the `_baseSystemPromptOptions` build passes `toolGuidelines` only).
    Only a `before_agent_start` handler that changes `event.systemPromptOptions` puts bullets there.
    Through 0.85 (checked in the 0.79.1 and 0.84.4 store copies and the 0.85.1 tarball), `promptGuidelines` was the flattened, trimmed guidelines of the selected tools.
- `ctx.getSystemPrompt()` returns the run's forced prompt, which is what `pi-subagents` snapshots as the parent's prompt (`src/lifecycle/parent-snapshot.ts`).
  So the parent's relocation is what keeps pi's `<tools>` out of a child's inherited identity.
- Other writers of this string, the shared mutable artifact:
  - `pi-subagents` reads it (identity cut at `<skills>`/`<cwd>`, [#958]).
  - `pi-nocd` appends a `# Working Directory` block at the end.
  - `pi-anthropic-auth` (outside the monorepo) re-shapes the prompt at request time, section by section.
    It treats `tools`/`rules`/`docs` as pi-owned, strips the `In addition to the tools above` paragraph from a `tools` section, and passes an untagged chunk other than the leading one through untouched.
- AGENTS.md constraint: this session runs the published extension, so its own system prompt is a live witness of the defect.
  Pi's `<tools>` sits at the top, and a plain `Available tools:` block follows `</cwd>`.

## Design Overview

### How the evidence was produced

Measured, not synthetic.
Scratch scripts in `/tmp/spike962` built the prompt with pi 0.87.1's real `buildSystemPrompt` (installed from the registry) and passed it through this repo's real, unmodified `renderToolSurface`, loaded directly as TypeScript with `node --experimental-strip-types`.
No other extension sat between the two. n = 1 per condition; both functions are deterministic.

- Parent (`piAuthoredPreamble: true`, a denied `secret_tool` with a guideline, an AGENTS.md carrying `Guidelines:\n- user rule one\n- user rule two`):
  - pi's `<tools>` kept `- secret_tool: Denied tool`, and `<rules>` kept `- Use secret_tool for secrets`;
  - the filler line was deleted from inside `<tools>`, leaving a blank line before `</tools>`;
  - the AGENTS.md `Guidelines:` section was deleted;
  - the narrowed plain block was appended after `</cwd>`.
- Child (`customPrompt`, section-shaped): nothing was removed, and a second pass over the output left two `Available tools:` blocks (`once === twice` → `false`).

### Layout: decided once, from which cwd layer is present

The pass chooses one of two layouts per prompt, at a single dispatch point.
The choice follows which cwd layer is present, never the pi version.
This is the same rule [#959] applied in `pi-subagents`.

```typescript
/** How one prompt shape bounds and writes the tool surface. */
interface PromptLayout {
  /** Pi's own tool surface removed from the head; called only when Pi wrote the preamble. */
  removePiSurface(head: readonly string[]): string[];
  /** A relocated block (this package's or a peer's) removed from the extension tail. */
  removeRelocatedSurface(tail: readonly string[]): string[];
  /** This session's block, in this layout's shape. */
  renderBlock(surface: ToolSurfaceBullets): string;
}

/** The bullets a block wraps, computed once for either layout. */
interface ToolSurfaceBullets {
  /** `- name: snippet` lines; empty when no allowed tool has a snippet. */
  readonly tools: readonly string[];
  /** `- rule` lines, in `buildRules` order. */
  readonly rules: readonly string[];
}

function detectPromptLayout(lines: readonly string[]): {
  layout: PromptLayout;
  tailStart: number;
};
```

Detection:

- **Footer anchor:** the last line starting with `Current working directory:` (today's `extensionTailStart`).
- **Section anchor:** the last `<cwd>` line whose next line is a single content line and whose line after that is exactly `</cwd>`.
  The anchor is found by shape only, like the footer.
  This keeps `ToolSurfaceInputs` free of a cwd field; the Risks section prices the trade-off.
- When both anchors are present, the **later** one is pi's, because pi writes its cwd layer last among its own layers.
  A `Current working directory:` line quoted in a 0.86 AGENTS.md, or a `<cwd>` triple quoted in a 0.85 one, sits above pi's real anchor.
- Section anchor wins: `SECTION_LAYOUT`, with `tailStart` on the line after its `</cwd>`.
- Footer anchor wins, or neither anchor is present: `HEADER_LAYOUT`, with `tailStart` on the line after the footer, or `lines.length` when there is none.
  Both cases are byte-identical to today.

`HEADER_LAYOUT` is today's behavior, repackaged:

- `removePiSurface` and `removeRelocatedSurface` are both `removeToolSurfaceSections`.
- `renderBlock` wraps the bullets in `Available tools:` / `Guidelines:` exactly as `renderAvailableTools` / `renderGuidelines` do now.

`SECTION_LAYOUT`:

- `removePiSurface(head)`: for each of `tools` then `rules`, find the first `<name>` line, then the first `</name>` line after it.
  Remove the whole run, both tags included, but only when both lines come before the first opening line of a section pi writes after them: `<docs>`, `<addendum>`, `<project_context>`, `<skills>`, `<cwd>`.
  The bound is recomputed after each removal.
  Plain-header removal never runs here: pi writes no plain headers on this shape, so any match would be somebody else's text.
- `removeRelocatedSurface(tail)`: remove the first tagged `<tools>…</tools>` and the first tagged `<rules>…</rules>` in the tail (no bound, since the tail is extension text), then apply `removeToolSurfaceSections`.
  Removing both shapes keeps the pass idempotent over its own output and order-independent with a peer writer ([#901]) on either contract.
- `renderBlock`: `<tools>\n<tool bullets>\n</tools>` followed by a blank line and `<rules>\n<rule bullets>\n</rules>`.
  `<tools>` is omitted when no allowed tool has a snippet, matching today's omitted `Available tools:` section.
  The filler sentence is not written, as today.

### Orchestration

```typescript
export function renderToolSurface(systemPrompt: string, inputs: ToolSurfaceInputs): string {
  const lines = normalizePrompt(systemPrompt).split("\n");
  const { layout, tailStart } = detectPromptLayout(lines);
  const body = [
    settleRegion(lines.slice(0, tailStart), inputs.piAuthoredPreamble ? (l) => layout.removePiSurface(l) : null),
    settleRegion(lines.slice(tailStart), (l) => layout.removeRelocatedSurface(l)),
  ] /* …filter/join/trimEnd as today… */;
  const block = layout.renderBlock(toolSurfaceBullets(inputs));
  return body.length > 0 ? `${body}\n\n${block}` : block;
}
```

`settleRegion` takes the removal function, or `null` meaning "not ours to touch", in place of today's `removalAllowed` boolean.
It keeps its rule of collapsing blank runs only when something was removed.
Layouts are two module-level `const` objects in `tool-surface-prompt.ts`; no new module.
The file grows by about 100 lines (estimated) around one concept, pi's prompt shape, and every consumer reaches it through `renderToolSurface`.

### Extension-contributed rules

`ToolSurfaceInputs` gains a required field:

```typescript
/**
 * `systemPromptOptions.promptGuidelines`: bullets Pi writes into its rules
 * after the tools' own. Only a bullet no registered tool contributes is
 * carried; through pi 0.85 the field *is* the tools' guidelines, and a denied
 * tool's bullet must not return by this route.
 */
readonly promptGuidelines: readonly string[];
```

`toolSurfaceBullets` adds each `promptGuidelines` bullet whose trimmed text matches no trimmed bullet in any `guidelinesByTool` entry.
`guidelinesByTool` is read from `getAll()`, so it covers every registered tool, denied or not.
The extras go after the allowed tools' guidelines and before the two universal bullets, which is `buildRules`' order.
On a ≤0.85 prompt the filter leaves nothing, so the output is byte-identical.
The handler passes `event.systemPromptOptions?.promptGuidelines ?? []`.
`BeforeAgentStartPayload.systemPromptOptions` gains `promptGuidelines?: readonly string[]`, which keeps it the lean local view `code-design` prescribes.

Interface width check: `ToolSurfaceInputs` goes to five fields, and its one consumer (`renderToolSurface` → `toolSurfaceBullets` / `settleRegion`) reads all five.

### Edge cases

- Custom preamble (subagent child) on 0.86: the head is never touched.
  A parent's `<tools>` inherited through a parent node that ran without this extension stays, as ADR 0014 accepts today.
  The tail after `</cwd>` holds only extension text, so a second pass replaces rather than duplicates.
- A `<tools>` tag quoted inside `<addendum>` / `<project_context>` / `<skills>` in a pi-authored prompt comes after pi's `<docs>` open, so the bound excludes it.
- An earlier handler's forced prompt that inserted text above pi's `<tools>` still gets it removed, because the anchor is bounded and not positional.
- `pi-anthropic-auth` sees our tail `<tools>`/`<rules>` as pi-owned sections, as it did pi's.
  It finds no filler to strip, and its one text replacement does not match our bullets.
  After relocation its `docs` section still marks the prompt as structured.

## Module-Level Changes

- `packages/pi-permission-system/src/exposure/tool-surface-prompt.ts`:
  - split the bullet computation from the header wrapping;
  - add `PromptLayout`, `ToolSurfaceBullets`, `HEADER_LAYOUT`, `SECTION_LAYOUT`, and `detectPromptLayout`, with `extensionTailStart`'s footer search moving under it;
  - change `settleRegion`'s second parameter to a removal function or `null`;
  - add `promptGuidelines` to `ToolSurfaceInputs`;
  - rewrite the module doc comment (the region model on both shapes) and `extensionTailStart`'s "Accepted edge" comment, whose premise (no footer is a downstream rewrite) is false on 0.86.
- `packages/pi-permission-system/src/handlers/before-agent-start.ts`: `BeforeAgentStartPayload.systemPromptOptions.promptGuidelines?`, passed through as `promptGuidelines`.
  Update the class doc comment only if it names the footer; today it does not.
- `packages/pi-permission-system/test/exposure/tool-surface-prompt.test.ts`:
  - add section-shape fixtures `piAuthoredSectionPrompt()` / `customAuthoredSectionPrompt()`, hand-built from the 0.87.1 dist shapes, with a comment that says so;
  - add `promptGuidelines: []` to the `inputs()` default;
  - add new `describe` blocks for the section shape;
  - reword the comment on "removes a section-header-shaped line in project context when Pi wrote the preamble" (line 138): its "cannot happen in its default branch" holds through 0.85 only.
- `packages/pi-permission-system/test/handlers/before-agent-start.test.ts`: one test that `promptGuidelines` from the event reach the returned prompt.
- `packages/pi-permission-system/docs/decisions/0014-tool-surface-is-node-local-prose.md`: add an amendment consequence covering:
  - the section-shaped prompt (the layouts and the later-anchor rule);
  - the head-removal bound on 0.86;
  - tagged rendering;
  - carried `promptGuidelines`;
  - [#901]'s second-writer contract, extended to both shapes.
- `packages/pi-permission-system/docs/architecture/architecture.md`: update the `tool-surface-prompt.ts` module-tree entry (line 1003), which names only the footer and plain headers.
  This issue's sweep-disposition entry (line 1216) is history and stays.
- `packages/pi-permission-system/docs/configuration.md`: update the `before_agent_start` row (line 1248) and the *relocated* bullet (lines 1260–1262), which name the plain sections and the footer.
- Predicted unchanged:
  - `test/composition-root.test.ts`: it fires `before_agent_start` through an untyped fake payload that carries no `promptGuidelines`, and the handler's `?? []` absorbs that.
  - `src/exposure/skill-prompt-sanitizer.ts`: 0.86 does not change the `<available_skills>` anchors.
  - `.pi/skills/package-pi-permission-system/SKILL.md`: its tool-surface testing bullet ("pi's sections removed, this session's rendered at the tail…") holds on both shapes.
  - `README.md`: it has no tool-surface or relocation prose (`grep -n "system prompt\|relocat" README.md` is empty).

## Test Impact Analysis

1. New tests the change enables: the section shape has no tests today, since every fixture is footer-shaped.
   The new blocks cover detection, bounded head removal, tagged rendering, tail idempotency, and carried extras.
2. Redundant tests: none.
   The footer-shape suite becomes the pin for the byte-identical ≤0.85 invariant and must pass with only the `inputs()` default added.
3. Tests that stay as-is: every existing `renderToolSurface` test (41 calls).
   The "collects a second block when nothing left a footer to anchor on" test (line 294) stays true for a prompt with **neither** anchor, which is still the header layout.

## Invariants at risk

- **ADR 0014 / [#890]: a child's inherited identity stays byte-identical to its parent's.**
  Serves local-inference prefix reuse ([#180]'s constituency).
  Pinned on the footer shape by "the prefix a subagent child shares with its parent" (test line 556), which calls the real `renderToolSurface`.
  Step 4 adds its section-shape twin.
  On 0.86 today the invariant is violated in a different way: the parent's `<tools>` is inherited, the defect the comment on the issue measured.
- **[#919] / [#932]: removal never reaches text pi did not write.**
  Serves operators with a custom SYSTEM.md, and on 0.86 every AGENTS.md author.
  Pinned on the footer shape by the `a preamble Pi did not write` block.
  Steps 3–4 add section-shape tests (a project-context `Guidelines:` kept when pi authored the preamble; a quoted `<tools>` kept; an inherited `<tools>` under a custom preamble kept).
- **Idempotency (ADR 0014; [#901]'s contract).**
  Pinned on the footer shape by "is unchanged by a second pass over its own output" (line 131) and "replaces the block it appended" (line 265).
  Steps 3 and 5 add section-shape twins for both a pi-authored and a custom preamble.
- **Stable across turns ([#437]).**
  The pass is a pure function of the prompt and inputs. "stability across turns" (line 592) pins the footer shape; step 5 adds a section twin.
- **≤0.85 output byte-identical.**
  Pinned by the unchanged footer-shape suite.
  Step 6's extras filter is the one change that runs on that shape, and step 6 pins it with a flattened-`promptGuidelines` equality test.

## TDD Order

1. **Tidy: separate bullets from their wrapper.**
   Extract `toolSurfaceBullets(inputs): ToolSurfaceBullets` from `renderAvailableTools` / `renderGuidelines`, leaving those two as thin header wrappers over its lists.
   This prepares for step 5's tagged wrapper, which must wrap the same bullets without re-deriving them.
   Behavior-preserving; the existing suite is the pin, with no new tests.
   Commit: `refactor(pi-permission-system): compute tool-surface bullets apart from their headers`.

2. **Tidy: repackage today's behavior as `HEADER_LAYOUT`.**
   Introduce `PromptLayout`, `HEADER_LAYOUT`, and `detectPromptLayout`, which returns `HEADER_LAYOUT` unconditionally, with `tailStart` from the footer search.
   Change `settleRegion` to take a removal function or `null`, and route `renderToolSurface` through it.
   This prepares steps 3–5, making each one an addition to `SECTION_LAYOUT` rather than an edit spread across the orchestration.
   Behavior-preserving; the existing suite is the pin.
   Re-read the moved code against `code-design` before committing.
   Commit: `refactor(pi-permission-system): select the tool-surface layout at one dispatch point`.

3. **Section anchor: split a 0.86 prompt at pi's `<cwd>` section.**
   Add the hand-built section fixtures, the section-anchor search, the later-anchor rule, and `SECTION_LAYOUT` with a no-op `removePiSurface`, the header-shape `removeRelocatedSurface`, and the header-shape `renderBlock` for now.
   Tests (new `describe("a section-shaped prompt")` › `describe("the extension tail")`):
   - a pi-authored section prompt whose `<project_context>` carries `Guidelines:\n- user rule` keeps it byte for byte;
   - a custom-preamble section prompt passed through twice equals one pass;
   - a section prompt whose project context quotes a `Current working directory: /x` line still keeps its `Guidelines:`;
   - a footer prompt whose project context quotes a `<cwd>` triple still removes pi's `Available tools:`.

   Killing mutations:
   - "make `detectPromptLayout` return `HEADER_LAYOUT` unconditionally" turns tests 1–3 red;
   - "check the footer anchor first and return `HEADER_LAYOUT` whenever it is found" turns test 3 red;
   - "return `SECTION_LAYOUT` whenever a `<cwd>` triple is found" turns test 4 red.

   Commit: `fix(pi-permission-system): keep a project's own Guidelines section on a pi ≥0.86 prompt`.

4. **Remove pi's own `<tools>` and `<rules>`.**
   Implement `SECTION_LAYOUT.removePiSurface` with the later-section bound.
   Tests (`describe("pi's own sections")`):
   - the identity (everything through `</cwd>`) of a pi-authored section prompt allowing `read` carries no `<tools>`, no `<rules>`, no denied tool's bullet, and no denied tool's guideline;
   - the full result equals an exact expected string (preamble, `<docs>`, `<addendum>`, `<project_context>`, `<cwd>` byte-identical, blank-line joins intact, block last);
   - a `<tools>…</tools>` quoted inside `<addendum>` and one inside `<project_context>` are both kept;
   - a custom-preamble section prompt carrying an inherited `<tools>` section keeps it;
   - section-shape twin of "the prefix a subagent child shares with its parent".

   Killing mutations:
   - "make `SECTION_LAYOUT.removePiSurface` return `[...head]`" turns tests 1, 2, and 5 red;
   - "drop the later-section bound (search the whole head)" turns test 3 red;
   - "pass `layout.removePiSurface` for the head regardless of `piAuthoredPreamble`" turns test 4 red.

   Commit: `fix(pi-permission-system): remove pi's own tool list and rules on a pi ≥0.86 prompt`.

5. **Render the block in the host's shape.**
   Implement `SECTION_LAYOUT.renderBlock` (tagged) and `SECTION_LAYOUT.removeRelocatedSurface` (tagged, then plain).
   Update step 3–4 expectations that asserted the plain block on the section shape in this same step.
   Tests (`describe("this session's block")`):
   - the block equals `<tools>\n- read: …\n</tools>\n\n<rules>\n…\n</rules>` exactly and ends the prompt;
   - no `<tools>` section when no allowed tool has a snippet;
   - a second pass over a pi-authored section prompt's output equals the first pass, and likewise for a custom preamble;
   - a peer's plain `Available tools:` / `Guidelines:` block in the tail is replaced, not kept;
   - stability-across-turns twin (full vs narrowed pi `<tools>` render the same result).

   Killing mutations:
   - "make `SECTION_LAYOUT.renderBlock` delegate to `HEADER_LAYOUT.renderBlock`" turns tests 1–2 red;
   - "make `SECTION_LAYOUT.removeRelocatedSurface` skip the tagged removal" turns test 3 red (two `<tools>` in the tail);
   - "make it skip `removeToolSurfaceSections`" turns test 4 red.

   Commit: `feat(pi-permission-system): state the relocated tool surface in pi ≥0.86's section shape`.

6. **Carry extension-contributed rules.**
   Add the required `promptGuidelines` to `ToolSurfaceInputs`, the filter in `toolSurfaceBullets`, the `inputs()` default `promptGuidelines: []`, and the handler's payload field and pass-through, all in this step, because the field is required.
   Tests:
   - an extra bullet lands after the allowed tools' guidelines and before `Be concise in your responses`;
   - an extra matching a denied registered tool's guideline is not carried;
   - a footer prompt with `promptGuidelines` set to its tools' flattened guidelines renders byte-identically to one with `[]`;
   - handler (`test/handlers/before-agent-start.test.ts`): `systemPromptOptions.promptGuidelines: ["Extension rule"]` reaches the returned `systemPrompt`.

   Killing mutations:
   - "skip the extras loop in `toolSurfaceBullets`" turns tests 1 and 4 red;
   - "drop the registered-tool filter" turns tests 2–3 red;
   - "make the handler pass `promptGuidelines: []`" turns test 4 red.

   Run `pnpm --filter @gotgenes/pi-permission-system run check` after this step (shared interface change).
   Commit: `fix(pi-permission-system): keep extension-contributed rules when relocating the tool surface`.

7. **Docs.**
   Add the ADR 0014 amendment consequence, update the `architecture.md` module-tree entry, and update the `configuration.md` hook row and relocation bullet, all as listed in Module-Level Changes.
   Commit: `docs(pi-permission-system): describe the tool-surface relocation on pi ≥0.86 section prompts`.

## Risks and Mitigations

- **Hand-built fixtures drift from pi's real shape.**
  Mitigation: the fixtures reproduce the 0.87.1 dist's `<name>\n…\n</name>` wrap and `"\n\n"` join, with a comment citing the tarball.
  The planning spike ran pi's real builder, and `/tdd-plan` can re-run it from `/tmp/spike962` as a final check.
- **Shape-only `<cwd>` anchor.**
  A `<cwd>`/line/`</cwd>` triple quoted *after* pi's own, in extension-appended text, would move the tail start later.
  Consequences: in a pi-authored prompt, head removal is still bounded before pi's first later section, so no user text is lost.
  In a custom-preamble prompt, a relocated block between the two triples would not be replaced, which gives a duplicate, not a deletion.
  Accepted, mirroring the footer anchor's shape-only `startsWith`.
  Validating the path would add a cwd field to `ToolSurfaceInputs` for an edge no known writer produces.
- **Carried extras on ≤0.85.**
  If a registered tool's `promptGuidelines` text differed from what pi flattened, a denied tool's bullet could return through `promptGuidelines`.
  Mitigation: pi 0.79.1–0.85.1's `_normalizePromptGuidelines` only trims and de-duplicates, and the filter compares trimmed text; step 6 test 3 pins equality on the footer shape.
- **Collision with PR [#908]** on both `src/` files.
  Mitigation: the changes are orthogonal (prompt normalization versus layout).
  Whoever lands second rebases.

## Open Questions

- Whether a future pi drops `<docs>` or reorders the sections ahead of `<cwd>`.
  The bound set names all five later sections, so losing one only widens the search to the next.
  Revisit if pi adds a section between `rules` and `docs`.

[#180]: https://github.com/gotgenes/pi-packages/issues/180
[#437]: https://github.com/gotgenes/pi-packages/issues/437
[#860]: https://github.com/gotgenes/pi-packages/issues/860
[#890]: https://github.com/gotgenes/pi-packages/issues/890
[#901]: https://github.com/gotgenes/pi-packages/issues/901
[#908]: https://github.com/gotgenes/pi-packages/pull/908
[#919]: https://github.com/gotgenes/pi-packages/issues/919
[#932]: https://github.com/gotgenes/pi-packages/issues/932
[#958]: https://github.com/gotgenes/pi-packages/issues/958
[#959]: https://github.com/gotgenes/pi-packages/pull/959
[#970]: https://github.com/gotgenes/pi-packages/issues/970
