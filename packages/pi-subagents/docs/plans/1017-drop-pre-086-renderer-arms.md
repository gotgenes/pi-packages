---
issue: 1017
issue_title: "pi-subagents: drop the pre-0.86 prompt-renderer arms once the Pi floor is 1.0.0"
---

# Drop the pre-0.86 prompt-renderer arms

## Release Recommendation

**Release:** ship independently

This issue's Phase 23 roadmap step is tagged `Release: independent`, and the phase has no release batches.
The release vehicle is the `fix(pi-subagents):` step for the surviving fallback arm (step 7), plus the `docs(pi-subagents):` correction to `docs/configuration.md`; the arm removal itself is `refactor:` and the ride-along is `test:`, both skipped by `cliff.toml`.

## Problem Statement

`src/session/prompts.ts` recognizes two of Pi's prompt renderers: the ≤0.85 shape, which ends in a `Current working directory:` footer line, and the ≥0.86 section shape, which renders a `<cwd>` section.
It accepts both because the peer range used to admit both.
[#1006] raised the `@earendil-works/pi-coding-agent` peer floor to `>=1.0.0` (verified: `packages/pi-subagents/package.json` reads `"@earendil-works/pi-coding-agent": ">=1.0.0"`), and Pi 1.0.0's `buildSystemPromptSections` (installed `dist/core/system-prompt.js`) writes `promptSections.cwd` unconditionally, so a footer-shaped prompt cannot reach a child any more.
The footer arm, the ≤0.85 project-context lead-in offset, their fixtures, and the notes describing the ≤0.85 renderer are dead.

Planning found one arm that stays live: the **unanchored** fallback, taken when the parent prompt carries neither the footer nor a `<cwd>` section naming the parent's directory.
On Pi 1.0 that input arises when a `before_agent_start` handler returns a `systemPrompt`, which Pi stores as `forceSystemPrompt` (installed `dist/core/extensions/runner.js`, `emitBeforeAgentStart`), and the forced text drops or alters the `<cwd>` section.
The arm was written for the footer shape and misbehaves on the section shape (measured below).
The operator chose to fix it in this plan rather than defer it.

## Goals

- Remove the footer arm from `cwdAnchoredTailStart`, the `"footer"` variant from `PromptShape`, the `footerAt` parameter path from `skillsSectionStart`/`catalogueCloseBefore`, and the `lines[openAt + 2]` lead-in arm from `projectContextStart`.
- Remove the ≤0.85 `parentPrompt` fixture from `test/session/prompts.test.ts`: tests whose claim holds for the section shape move onto the section fixture, and tests that pin only footer behavior are deleted.
- The roadmap row `grep -c '0\.85' packages/pi-subagents/src/session/prompts.ts` reads 0 (baseline measured 7); the ≥0.86 qualifiers go too, since one renderer remains (`grep -c '0\.86'` measured 12, predicted 0).
- Fix the unanchored arm: on a section-shaped prompt with no `<cwd>` section, the cut lands on Pi's `<skills>` wrapper, so the child's identity carries no dangling `<skills>` line and a relocated child's project-context cut works there too.
- Drop the pre-0.86 sentence from `docs/configuration.md`, and correct its layer description, which still names the `Current working directory:` footer.
- Ride-along (roadmap): one shared `makeAgentConfig` in `test/helpers/`, replacing the local factories in four test files and the `AgentConfig` literals in `prompts.test.ts`, and remove the duplicated append-mode generic-base fallback test; the roadmap row `grep -rlE '^function \w+\(overrides: Partial<AgentConfig>' packages/pi-subagents/test` reads 0 (baseline measured 4 files).
- Non-breaking: no Pi `>=1.0.0` renders the footer, so the removal changes no reachable output; the fix changes output only for a parent whose prompt was forced without a matching `<cwd>` section, and only by removing a stray tag and a parent-path block the child should never have carried.

## Non-Goals

- Tool-surface excision for an unanchored prompt.
  `withoutToolSurface` stays gated on the `<cwd>`-anchored shape: forced text is an extension's, and its `<tools>`/`<rules>` need not be Pi's for this session.
  Step 5 pins today's behavior so the gate is not lost when `PromptShape` shrinks.
- Collapsing `PromptShape` (`"section" | "unanchored"`) to a boolean; the Tidy-First assessor flagged it as a design change, and the union reads the two cases by name.
- ADRs 0006, 0010, and 0011 keep their footer-era wording; a decision record describes the prompt shape it was decided against.
- `DEFAULT_AGENT_CONFIG` in `test/helpers/subagent-session-io.ts` and the `AgentConfig` literals in `test/display.test.ts`, `test/tools/agent-tool.test.ts`, `test/tools/spawn-config.test.ts`, and `test/helpers/make-deps.ts`: outside the roadmap's named targets and its metric (assessor: rejected as scope creep).
- The `prompts.test.ts` file split [#1009] deferred: the roadmap keeps it deferred.

## Background

`buildAgentPrompt` embeds only the identity region of the inherited parent prompt (`docs/decisions/0006-inherited-prompt-is-identity-only.md`).
`inheritedIdentity` cuts at the first session-resolved layer, located by `sessionResolvedTailStart` → `cwdAnchoredTailStart`, which today tries three anchors in order:

1. **Footer** (≤0.85): `lines.lastIndexOf("Current working directory: <cwd>")`, then the catalogue whose `</available_skills>` sits on the line before it.
2. **Section** (≥0.86): `cwdSectionStart` finds `<cwd>` / the parent's cwd / `</cwd>`, then `skillsSectionWrapperStart` walks back to Pi's `<skills>` wrapper.
3. **Unanchored**: `skillsSectionStart(lines, -1)` → the last `</available_skills>`, then the heading above it.

For a relocated child (`cwd !== inherited.cwd`), `projectContextStart` extends the cut to `<project_context>` when `</project_context>` is the last non-blank line above the cut; it accepts the lead-in two lines below the opening (≤0.85) or one (≥0.86).
`withoutToolSurface` excises `<tools>`/`<rules>` (ADR 0011) only when `tail.shape === "section"`.

Who reaches the unanchored arm on Pi 1.0: only a `before_agent_start` handler returning `systemPrompt`.
None of this repo's extensions do: `pi-nocd` and `pi-permission-system` both edit `systemPromptOptions` and document why they never return a prompt, and `pi-anthropic-auth` shapes the prompt at the provider boundary, after `getSystemPrompt()` has been read.

The shared-prefix guarantee (ADR 0008) and the `shared prefix with the parent` describe the package skill cites are untouched in claim; their fixtures move to the section shape.

## Design Overview

### Evidence, and how it was produced

Both measurements ran the real `buildAgentPrompt` from `src/session/prompts.ts` through Vitest in this checkout; inputs are hand-built prompts in Pi 1.0.0's byte shape, verified against the installed `dist/core/system-prompt.js` (`<name>\n…\n</name>` wrapping, `renderProjectContext` joining) and pi-ai's `getSystemMessageText` (`"\n\n"` join).

- **Removal blast radius (measured):** deleting the footer arm and the `openAt + 2` arm, then running `test/session/prompts.test.ts`, turned 15 of 81 tests red, all using the ≤0.85 `parentPrompt` fixture.
- **Unanchored arm on a section-shaped prompt (measured, disposable probe):** preamble + `<project_context>` + `<skills>` with no `<cwd>` section produces an identity ending in a dangling `<skills>` line, and a relocated child keeps the parent's `<project_context>` with its `/parent/AGENTS.md` path.

### The unanchored fix

The unanchored arm collapses to a function of `lines` alone and learns Pi's wrapper:

```typescript
/**
 * Line index where a catalogue begins in a prompt carrying no `<cwd>` anchor:
 * Pi's `<skills>` wrapper when the heading opens one, otherwise the heading.
 */
function unanchoredCatalogueStart(lines: readonly string[]): number {
  const closeAt = lines.lastIndexOf(SKILLS_CATALOGUE_CLOSE);
  if (closeAt === -1) return -1;
  const headingAt = lines.lastIndexOf(SKILLS_SECTION_HEADING, closeAt);
  if (headingAt === -1) return -1;
  return lines[headingAt - 1] === SKILLS_SECTION_OPEN ? headingAt - 1 : headingAt;
}
```

The step-6 refactor first collapses `skillsSectionStart(lines, footerAt)` and `catalogueCloseBefore(lines, footerAt)` into the heading-cut version (same behavior), and the step-7 fix adds the wrapper line; the name above is a suggestion, and the implementing session may keep `skillsSectionStart`.
Cutting at the wrapper leaves `</project_context>` as the last non-blank line above the cut, so `projectContextStart` cuts a relocated child's inherited block with no change of its own.

`cwdAnchoredTailStart` after both steps:

```typescript
const cwdAt = cwdSectionStart(lines, parentCwd);
if (cwdAt !== -1) {
  return { at: skillsSectionWrapperStart(lines, cwdAt), shape: "section" };
}
return { at: unanchoredCatalogueStart(lines), shape: "unanchored" };
```

### Edge cases stated as behavior

| Input                                                             | Behavior                                         | Pinned in                                 |
| ----------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------- |
| Section prompt, `<cwd>` names the parent                          | cut at `<skills>` wrapper or `<cwd>` (unchanged) | existing section tests, step 5 migrations |
| No `<cwd>`, catalogue in Pi's `<skills>` wrapper                  | cut at `<skills>` (changed)                      | step 7                                    |
| No `<cwd>`, relocated child, `<project_context>` above `<skills>` | cut at `<project_context>` (changed)             | step 7                                    |
| No `<cwd>`, bare catalogue with no wrapper line                   | cut at the heading (unchanged)                   | step 7                                    |
| No `<cwd>`, no catalogue                                          | prompt returned unchanged (unchanged)            | step 5 (`no anchor present`, migrated)    |
| No `<cwd>`, `<tools>`/`<rules>` present                           | not excised (unchanged)                          | step 5 (new pin)                          |
| `<cwd>` naming another directory                                  | not an anchor (unchanged)                        | existing section test                     |
| Parent cwd with backslashes                                       | matched after `toPromptPath` (unchanged)         | step 5 (migrated)                         |

### Shared `makeAgentConfig`

```typescript
// test/helpers/make-agent-config.ts
export function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "test-agent",
    description: "Test agent",
    toolNames: ["read", "grep"],
    systemPrompt: "You are a test agent.",
    promptMode: "replace",
    inheritContext: false,
    runInBackground: false,
    ...overrides,
  };
}
```

Defaults are the set `agent-types.test.ts` and `subagent-manager.test.ts` already share byte for byte.
The Tidy-First assessor read every consumer: no test in `invocation-config.test.ts` reads `name`/`description`/`toolNames`/`systemPrompt`, and every test depending on `inheritContext`/`runInBackground` being `undefined` passes `undefined` explicitly (lines ~63, ~73, ~181); `session-config.test.ts`'s `assembleSessionConfig` reads none of the fields `exploreConfig` left undefined.
`invocation-config.test.ts`'s `makeOpinionatedConfig` becomes a module-level preset beside the existing `overridingParams` constant, so the call sites read `makeAgentConfig(OPINIONATED)` / `makeAgentConfig({ ...OPINIONATED, locked: … })`; the preset keeps `inheritContext: false` and `runInBackground: false` explicit, since its doc says it declares every lockable field.
In `prompts.test.ts`, `appendConfig()`/`replaceConfig()` stay as thin wrappers (14 and 34 call sites per the assessor; re-derive before quoting), keeping `systemPrompt: ""` explicit for the pure-clone case and `name: "specialist"`, which assertions read.

## Module-Level Changes

- `src/session/prompts.ts`: footer arm, `"footer"` variant, `footerAt` paths, and `openAt + 2` arm removed (step 6); unanchored wrapper cut (step 7); comments reworded with no ≤0.85/≥0.86 qualifiers, including `PROJECT_CONTEXT_LEAD_IN`, `inheritedIdentity`, `cwdAnchoredTailStart`, `cwdSectionStart`, `projectContextStart`, and `InheritedPrompt.cwd` ("the cwd its prompt footer names" → its `<cwd>` section).
  `toPromptPath` stays (used by `cwdSectionStart`).
- `src/session/project-context.ts`: `renderProjectContext` doc drops the "through 0.85" paragraph and cites Pi's renderer without a version (step 8).
- `src/lifecycle/parent-snapshot.ts`: `buildPortablePrompt` doc drops "from 0.86" and "Pi through 0.85 wrote the appended prompt bare" (step 8).
- `test/helpers/make-agent-config.ts` and `test/helpers/make-agent-config.test.ts`: new (step 1).
- `test/config/agent-types.test.ts`, `test/config/invocation-config.test.ts`, `test/session/session-config.test.ts`, `test/lifecycle/subagent-manager.test.ts`: local factories replaced (step 2).
- `test/session/prompts.test.ts`: steps 3–7 and 9.
- `test/session/project-context.test.ts`: the "Pi's block format" comment cites the 1.0.0 dist and drops the 0.85 sentence; the `it` title drops "pi ≥0.86's" (step 8).
- `docs/configuration.md`: line 24 layer order, line 35 table row, line 53 sentence (step 10).
- `docs/architecture/architecture.md`: module-tree line 378 ("rendered in pi ≥0.86's shape"); this issue's step heading ✅, its Mermaid node ✅, a `Landed:` note recording the `fix:` vehicle, and the `Pre-0.86 renderer mentions` and `AgentConfig` factory rows (step 11).
- `.pi/skills/package-pi-subagents/SKILL.md`: lines 40–44 describe the footer anchor and the #640 equal-cwd rationale in footer terms; rewrite for the `<cwd>`/`<skills>` section anchors and the unanchored fallback (step 11).
- Predicted unchanged: `README.md` § "Extensions that append to the system prompt" (says "ahead of the skills catalogue", true for both shapes); `src/session/session-config.ts` and `src/index.ts` (no shape knowledge; verified by `grep -rn "footer\|0\.8[56]" packages/pi-subagents/src`, which matches only `prompts.ts`, `project-context.ts`, `parent-snapshot.ts`, and unrelated UI footer prose).

## Test Impact Analysis

`prompts.test.ts`'s footer-fixture tests sort into two groups (names as of `main`; the implementing session re-derives before deleting):

Move onto the section fixture (step 5), each reasserted on `<cwd>`/`<skills>` so the assertion can fail under the section shape:

- `skills-catalogue anchor`: append-mode cut; "cuts the catalogue when the parent resolved no footer" (becomes a section prompt with no `<cwd>`; asserts today's behavior, strengthened in step 7); both "not at … quoting its heading" tests; "not at a whole one an extension appended"; "leaves a quoted catalogue alone when the parent resolved no skills" (red on removal, so it must move, not go).
- `cwd-footer anchor`: append-mode strip; "normalizes backslashes" (fixture `<cwd>\nC:/repo\n</cwd>`, inherited `cwd: "C:\\repo"`, asserts `not.toContain("<cwd>")`).
- `project-context anchor`: append-mode relocated cut; "keeps the inherited block when the child shares the parent's cwd".
- `no anchor present`, `the assembled child prompt` (all three; the two "Current working directory claim" tests count `<cwd>` lines instead, or they turn vacuous), `shared prefix with the parent` (all three), `the child's own project context` (both fixture sites).
- `shared prefix with the parent` replaces its `IDENTITY_WITH_TOOLS` (pre-0.86 `Available tools:` prose) with a section-era identity: preamble plus `<docs>` and `<addendum>` sections, which the cut keeps verbatim.

Delete with the footer arm (step 6), each already pinned by a section-shape test:

- replace-mode catalogue cut, "drops the footer that follows the catalogue", "drops the extension blocks that follow the footer", "keeps the identity ahead of the catalogue byte for byte";
- replace-mode footer strip, "leaves the identity ahead of the footer intact", "leaves a footer naming a different directory alone", "strips … when the child shares the parent's cwd", "strips an agreeing footer whose separators differ";
- replace-mode relocated cut, "cuts the block when the parent resolved no skills", "anchors on Pi's own opening, not one a context file quotes";
- "leaves the footer shape alone" (its gate is re-pinned by step 5's unanchored tool-surface test).

Test count (estimated): 81 today → 80 after step 3 → 81 after step 5 → 68 after step 6 → 70 after step 7; plus 2 in the new helper test file.
`project-context.test.ts` changes comments only; its assertions already pin the 1.0 shape, which matches 0.86.1's (verified in the 1.0.0 dist).

## Invariants at risk

- **Shared prefix (ADR 0008, #890):** a same-cwd child's identity is the parent's prompt ahead of the cut, byte for byte.
  Pinned by "keeps the identity ahead of the skills section byte for byte" and `shared prefix with the parent` (moved in step 5); both assert `startsWith` on exact text, and step 6 leaves the section arm's code path unchanged.
- **Tool-surface excision (ADR 0011, #1009):** pinned by the `Pi's tool surface` describe, which uses the section fixture throughout except "leaves the footer shape alone" (replaced in step 5).
- **Relocated project-context cut (#918, #961):** pinned by "cuts the inherited block for a relocated child at the project-context section" and the step-5 append-mode move.
- **Whole-line cwd discipline:** pinned by "leaves a cwd section naming a different directory alone" and the moved backslash test.
- Constituency check: the fix changes output only for prompts with no matching `<cwd>` section, which no `@gotgenes/*` extension produces; #180's local-inference constituency (same-cwd children on Pi's own prompt) sees byte-identical output, which the exact-head tests above confirm.

## TDD Order

1. **`test(pi-subagents): add a shared makeAgentConfig test helper`** Add `test/helpers/make-agent-config.ts` (defaults above, return type `AgentConfig`) and `make-agent-config.test.ts`, mirroring `make-model.test.ts`: a `toEqual` on the full default shape, and an override test.
   Killing mutation: change the default `promptMode` to `"append"` → the default-shape test goes red.
2. **`test(pi-subagents): build test AgentConfigs from the shared helper`** Replace `makeAgentConfig` in `agent-types.test.ts` and `subagent-manager.test.ts` (identical defaults), `makeConfig` in `invocation-config.test.ts`, and `exploreConfig` in `session-config.test.ts`; convert `makeOpinionatedConfig` to a module-level `OPINIONATED` preset beside `overridingParams`.
   Verify: each file green, and `grep -rlE '^function \w+\(overrides: Partial<AgentConfig>' packages/pi-subagents/test` prints nothing.
   Check each touched file's imports for orphans (`AgentConfig` may become type-unused).
   No new tests.
3. **`test(pi-subagents): build prompt-test configs from the shared helper`** Replace the `const config: AgentConfig = {…}` literals and the bodies of `appendConfig()`, `replaceConfig()`, and `agentConfig(promptMode)` with `makeAgentConfig({…})`, passing `name`, `systemPrompt`, and `promptMode` wherever a test reads them.
   Delete "append mode without parent prompt falls back to the generic base" (the second copy, line ~259); keep line ~123's, which alone asserts `/workspace`.
   No new tests.
4. **`test(pi-subagents): name the prompt fixtures by renderer`** Mechanical rename: `parentPrompt` → `footerParentPrompt`, then `sectionParentPrompt` → `parentPrompt`.
   This keeps steps 5–6 diffs to the semantic change (assessor's optional tidying).
5. **`test(pi-subagents): pin the inherited-identity cut on Pi's section-shaped prompt`** Move the tests listed under "Move onto the section fixture" from `footerParentPrompt` to `parentPrompt`, fixture argument `footerCwd` → `cwd`, reasserting on section tokens.
   Add one pin under a `no <cwd> section` describe: a prompt with `<tools>`/`<rules>` above `<skills>` and no `<cwd>` keeps both sections (the identity starts with them verbatim).
   All green on current code.
   Killing mutations (apply each and run the file; restore before commit):
   - make `cwdSectionStart` return `-1` unconditionally → the moved append-mode strip, backslash, and `<cwd>`-claim tests go red;
   - in `cwdSectionStart`, compare against `parentCwd` instead of `toPromptPath(parentCwd)` → the backslash test goes red;
   - make `skillsSectionWrapperStart` return `cwdAt` unconditionally → the moved append-mode catalogue cut and the heading-quote tests go red;
   - in the section branch of `cwdAnchoredTailStart`, return `skillsSectionStart(lines, -1)` instead → "leaves a quoted catalogue alone" goes red;
   - pass `true` for `cutProjectContext` in `adoptedIdentity` → "keeps the inherited block when the child shares the parent's cwd" goes red; pass `false` → the moved append-mode relocated test goes red;
   - in append mode, return `header + identity + …` → the moved `shared prefix with the parent` tests go red;
   - make `ownProjectContext` return `""` → "names the child's own directory" goes red;
   - make `withoutToolSurface` apply whenever `tail.at !== -1` (drop the shape check) → the new unanchored tool-surface pin goes red.
6. **`refactor(pi-subagents): drop the pre-0.86 prompt-renderer arms`** In `prompts.ts`: delete the footer branch of `cwdAnchoredTailStart`, the `"footer"` variant, the `footerAt` parameter of `skillsSectionStart`/`catalogueCloseBefore` (collapse to the `-1` path: last `</available_skills>`, heading above it), and the `openAt + 2` arm of `projectContextStart`; reword every comment listed in Module-Level Changes, and the unanchored comment ("rewrote a 0.85-shaped prompt") to name the forced-prompt source.
   In `prompts.test.ts`: delete the tests listed under "Delete with the footer arm", then `footerParentPrompt` and the `#640` footer comment above `inherited session-resolved tail`.
   Verify: file green with the deleted tests gone; `grep -c '0\.85'` and `grep -c '0\.86'` on `prompts.ts` both print 0; `pnpm --filter @gotgenes/pi-subagents run check`.
   No new tests: the moved tests from step 5 pin every surviving arm.
7. **`fix(pi-subagents): drop a forced parent prompt's whole skills section from a child's identity`** In the unanchored path, cut at `<skills>` when it is the line above the heading (sketch above).
   Body: a parent prompt with no `<cwd>` section (a `before_agent_start` handler's returned prompt) left the child a dangling `<skills>` line, and a relocated child kept the parent's `<project_context>`.
   Tests under `no <cwd> section`:
   - strengthen the step-5 catalogue test to ``prompt.startsWith(`${IDENTITY}\n\n<active_agent`)``;
   - a relocated child of a prompt with `<project_context>` and `<skills>` and no `<cwd>` carries no `<project_context>` and no `path="/parent/AGENTS.md"`;
   - a bare catalogue with no wrapper line (identity followed by `formatSkillsForPrompt(...)` output) is cut at its heading.
   Killing mutations:
   - return `headingAt` unconditionally → the first two go red, the third stays green;
   - return `lines[headingAt - 1] === SKILLS_SECTION_OPEN ? headingAt - 1 : -1` → the bare-catalogue test goes red.
8. **`refactor(pi-subagents): drop the pre-0.86 renderer notes`** Comment-only: `project-context.ts` (`renderProjectContext` doc), `parent-snapshot.ts` (`buildPortablePrompt` doc), `project-context.test.ts` (the "Pi's block format" comment cites the 1.0.0 dist; the test title drops "pi ≥0.86's").
   Verify: `grep -rn '0\.8[56]' packages/pi-subagents/src packages/pi-subagents/test/session` prints nothing.
9. **`test(pi-subagents): group the inherited-identity tests by anchor`** Dissolve the `pi ≥0.86 section shape` describe into anchor describes under `inherited session-resolved tail`: `skills-section anchor`, `cwd-section anchor`, `project-context anchor`, `Pi's tool surface`, `no <cwd> section`, then the existing `the assembled child prompt`, `shared prefix with the parent` (keep this name; the package skill cites it), and `the child's own project context`.
   Reword the fixture doc and the `#918`-era comment to cite the 1.0.0 dist without version contrast.
   Verify: test count unchanged from step 7.
10. **`docs(pi-subagents): describe the prompt layers Pi renders today`**
    `docs/configuration.md`: line 24 lists the section order (preamble, `<tools>`, `<rules>`, `<docs>`, an `<addendum>`, `<project_context>`, `<skills>`, `<cwd>`, then extension sections); line 35's row becomes `<cwd>`; delete line 53's pre-0.86 sentence.
11. **`docs(pi-subagents): mark the pre-0.86 renderer step landed (#1017)`**
    `docs/architecture/architecture.md`: line 378, the step heading and Mermaid node ✅, a `Landed:` note (arms removed, the unanchored fix as the `fix:` vehicle, both metric rows at 0).
    `.pi/skills/package-pi-subagents/SKILL.md` lines 40–44: the `<cwd>` anchor, the `<skills>` wrapper, the unanchored fallback, and the #640 rationale restated for the section shape.

## Risks and Mitigations

- **A moved test turns vacuous** (it asserts the absence of a footer string the section fixture never emits): step 5 reasserts every moved test on section tokens and names a mutation per class.
- **Deleting a test that pinned a still-live claim:** each deletion names its section-shape counterpart above; the step-6 spike measured which tests depend on the footer arm (15 red), and the 18 footer-fixture tests that stayed green are all in the move or delete lists.
- **The fix catches a `<skills>` line that is not Pi's** (an extension's own text immediately above a catalogue heading): the cut then drops one more line of forced text, which already sits in the session-resolved tail by position; no `@gotgenes/*` extension forces a prompt.
- **Shared defaults change a migrated test's input:** the assessor read each consumer; step 2 runs each file, and the `undefined`-dependent tests already pass `undefined` explicitly.

## Open Questions

- Whether an unanchored prompt should get ADR 0011's tool-surface excision; deferred until a forced-prompt consumer appears (step 5 pins today's behavior).

[#1006]: https://github.com/gotgenes/pi-packages/issues/1006
[#1009]: https://github.com/gotgenes/pi-packages/issues/1009
