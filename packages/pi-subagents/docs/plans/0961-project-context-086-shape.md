---
issue: 961
issue_title: "pi-subagents: renderProjectContext still emits pi ≤0.85's block shape, so a relocated child's own project context no longer matches Pi's"
---

# Render a child's own project context and portable identity in pi ≥0.86's shape

## Release Recommendation

**Release:** ship independently

No roadmap step in `docs/architecture/architecture.md` references this issue; it is a follow-up the [#958] review split off.
Both behavior steps land as `fix(pi-subagents):`, so the change cuts a patch release by itself.

## Problem Statement

pi 0.86 reshaped `buildSystemPrompt` into tagged sections.
[#958] fixed the anchors that **read** an inherited prompt, but the text this package **writes** still follows ≤0.85:

- `renderProjectContext` (`src/session/project-context.ts`) renders the `<project_context>` block for a child a `WorkspaceProvider` relocated and for a `portable` child.
  It emits a blank line below the opening tag and another above the closing tag, and pi 0.86 writes neither.
  Its doc comment still says the block is Pi's "byte for byte", and that is false on the version the peer range (`>=0.81.0`) admits and the operator runs.
- `buildPortablePrompt` (`src/lifecycle/parent-snapshot.ts`), found while planning this issue, composes a `portable` child's identity "the way Pi's own `buildSystemPrompt` composes them".
  pi 0.86 wraps the appended prompt in an `<addendum>` section, and this function writes it bare.

Nothing parses either piece of text today, so both are stale correctness claims, not observed failures.

## Goals

- `renderProjectContext` emits pi ≥0.86's block shape on every host, and its doc comment says which renderer it mirrors and how ≤0.85 differs.
- `buildPortablePrompt` wraps the appended prompt as `<addendum>\n…\n</addendum>`, which makes ADR 0009's "what Pi would assemble" claim true on ≥0.86.
- The ≤0.85 arm of `projectContextStart`'s lead-in guard stays pinned by tests after the change (see Invariants at risk).
- Not breaking.
  The only thing that changes is the prompt text a relocated or portable child's model reads.
  No API, default, output contract, or config changes, and nothing in this repo or the extensions it runs with anchors on the bytes that move (see Background).

## Non-Goals

- **Rendering whichever shape the running pi writes.**
  The operator chose one shape over dispatching on the parent prompt's cwd layer.
  Dispatching would thread a shape parameter through `ProjectContextLoader` and carry an arm that dies once the floor passes 0.85, all for a two-blank-line difference no reader parses.
- **Raising the pi-coding-agent peer floor or devDependency pin.**
  `src/session/prompts.ts` already records when the 0.85 lead-in arm can go; this change does not depend on it.
- **Removing the 0.85 lead-in arm or the footer-shaped fixtures.**
  Both still serve hosts on 0.81–0.85, where `projectContextStart` reads a parent block Pi wrote.
- **Editing ADR 0009 or ADR 0010.**
  They are accepted decision records.
  ADR 0010's Context quotes the ≤0.85 block as Pi wrote it when the decision was taken, and ADR 0009's "what Pi would assemble" sentence becomes accurate on ≥0.86 with no edit.
- **The `PORTABLE` constant in `test/session/prompts.test.ts`.**
  It is arbitrary input text to `buildAgentPrompt`, not output of `buildPortablePrompt`.

## Background

- `renderProjectContext(contextFiles)` is called in one place in `src/`: `createProjectContextLoader`, wired in `src/index.ts` with Pi's `loadProjectContextFiles`.
  `buildAgentPrompt` → `ownProjectContext` appends its output (with a leading `\n\n`) after the adopted identity, but only for a relocated `full` child or any `portable` child.
  A `full` child in the parent's directory never calls it (ADR 0010), which keeps the replica off the shared prefix.
- `buildPortablePrompt(options)` (private) trims `customPrompt` and `appendSystemPrompt`, drops empty ones, and joins the rest with `\n\n`, returning `undefined` when none remain so the caller falls back to `genericBase` (ADR 0009).
- **Pi's real output, measured** from a scratch install of `@earendil-works/pi-coding-agent@0.86.1` by calling `dist/core/system-prompt.js`'s `buildSystemPrompt` directly:
  - `{ customPrompt: "x", contextFiles: [/parent/AGENTS.md, /parent/sub/AGENTS.md] }` → `x\n\n<project_context>\nProject-specific instructions and guidelines:\n\n<project_instructions path="/parent/AGENTS.md">\n# AGENTS\n\nParent house rules.\n</project_instructions>\n\n<project_instructions path="/parent/sub/AGENTS.md">\nSub rules.\n</project_instructions>\n</project_context>\n\n<cwd>\n/parent\n</cwd>`
  - `{ customPrompt: "C", appendSystemPrompt: "A", selectedTools: [] }` → `C\n\n<addendum>\nA\n</addendum>\n\n<cwd>\n/parent\n</cwd>`
  - The same input on the pinned 0.84.4 dist produces `<project_context>\n\nProject-specific…:\n\n…\n\n</project_context>`, which is today's replica.
  - The published 0.87.1 tarball and Pi's `main` checkout (`../pi`) have the same `renderProjectContext` as 0.86.1.
  - `buildSystemPrompt` is still absent from the package's `exports` in 0.86.1, so no test can call Pi's renderer.
    The fixtures stay hand-built, the same way [#958]'s `sectionParentPrompt()` is.
- **Other readers of this text** (the shared-artifact enumeration):
  - `projectContextStart` (`src/session/prompts.ts`) reads only a **parent** prompt's block, whose closing tag must sit next to the session-resolved tail.
    A child's own block sits inside its override, before the header and body, so it never reaches that guard.
  - `@gotgenes/pi-permission-system`'s `tool-surface-prompt.ts` matches the whole line `<project_context>`, which is the same in both shapes.
    It lists `<addendum>` among `LATER_PI_SECTION_OPENS`, so on a portable child a `<tools>`/`<rules>` section quoted in the appended prompt is now treated as quoted and kept, where before it could be stripped as Pi's.
    A portable child's custom prompt carries no Pi-written tool sections to lose.
  - `pi-anthropic-auth` (`src/system-prompt-shaping.ts`, local checkout) passes through untouched any prompt that has none of Pi's `tools`/`rules`/`docs` sections, which covers every portable child.
    In a relocated `full` child, the block parses as a named `project_context` chunk in either shape, and it is kept.
  - `pi-claude-bridge` (`src/prompt-capture.ts`, `src/agents-md.ts` at the default-branch HEAD) keys a child's capture on the child's own exact prompt and matches only a **parent's** stripped prompt as a substring.
    It never parses the child's block or its portable identity.
    Its own `formatProjectContext` still writes the ≤0.85 shape for text it sends itself; that belongs to the bridge, not to this package.

## Design Overview

Both functions switch to the ≥0.86 shape unconditionally, with no version or shape detection.

`renderProjectContext`:

```typescript
export function renderProjectContext(
  contextFiles: readonly ContextFile[] | undefined,
): string | undefined {
  if (!contextFiles || contextFiles.length === 0) return undefined;
  const content = [
    PROJECT_CONTEXT_LEAD_IN, // or the literal, as today
    ...contextFiles.map(
      ({ path, content }) =>
        `<project_instructions path="${path}">\n${content}\n</project_instructions>`,
    ),
  ].join("\n\n");
  return `<project_context>\n${content}\n</project_context>`;
}
```

The lead-in stays a literal in this module; `prompts.ts`'s `PROJECT_CONTEXT_LEAD_IN` is private, and sharing it is not worth a new export.
The doc comment keeps the "undefined when there are no files" paragraph and replaces the byte-identity paragraph with three points:

- The block mirrors pi ≥0.86's renderer: lead-in and each `<project_instructions>` block joined by a blank line, inside the section wrapper's newlines.
- On ≤0.85 hosts it differs from Pi's own by the blank line below the opening tag and above the closing tag, and nothing parses a child's own block.
- `buildSystemPrompt` is not exported, so the tests pin this shape against a hand-built copy of 0.86.1's output.

`buildPortablePrompt` wraps only the appended part:

```typescript
const appended = options.appendSystemPrompt?.trim();
if (appended) sections.push(`<addendum>\n${appended}\n</addendum>`);
```

Trimming stays as it is (this package's choice, which predates this change), so a whitespace-only append still counts as absent and the `genericBase` fallback is unchanged.
An append-only parent now yields `<addendum>\nA\n</addendum>` alone.
Pi would put its base preamble in front of that, and `portable` omits the base on purpose (ADR 0009).
The doc comments on `buildPortablePrompt` and `ParentSnapshot.portablePrompt` say the appended part is wrapped as ≥0.86's `<addendum>` section.

No signature, interface, or wiring changes, so the `design-review` checklist has nothing to act on: no parameter is added, no dependency bag grows, and no layers are rewired.

## Module-Level Changes

- `src/session/project-context.ts`: new `renderProjectContext` body and doc comment (see Design Overview).
- `src/lifecycle/parent-snapshot.ts`: `buildPortablePrompt` wraps the appended prompt; update its doc comment and `ParentSnapshot.portablePrompt`'s.
- `test/session/prompts.test.ts`:
  - `parentPrompt()` (around line 422) builds its ≤0.85 project-context layer inline instead of calling `renderProjectContext`, and its doc comment says so.
  - The `renderProjectContext` import stays, because the loader stand-ins around lines 1066, 1211, 1236 and 1282 still use it.
- `test/session/project-context.test.ts`: the two byte-exact expectations in `describe("Pi's block format")` move to the 0.86.1 shape, and the comment cites the 0.86.1 dist instead of "core/system-prompt.ts".
- `test/lifecycle/parent-snapshot.test.ts`: the "orders the parts the way Pi composes them" expectation gains the wrapper, plus a new append-only case.
- `docs/architecture/architecture.md`:
  - The `project-context.ts` module-tree entry (line 356) currently reads "rendered byte for byte"; change it to "rendered in pi ≥0.86's shape".
  - The `parent-snapshot.ts` entry (line 378) still holds ("composed in Pi's own order"), so it is left unchanged.

Files predicted **unchanged**, each with the claim it rests on:

- `src/session/prompts.ts`: `projectContextStart` reads parent prompts only, and the child's block never sits next to a tail.
- `test/composition-root.test.ts` (lines 403, 409): the fixtures carry `customPrompt` only, with no append, so `"You are a specialist."` is unchanged.
- `test/session/session-config.test.ts` (line 373): it asserts an opaque pass-through string.
- `test/lifecycle/create-subagent-session.test.ts` (line 440): it asserts an opaque pass-through string.
- `.pi/skills/package-pi-subagents/SKILL.md`: line 61 ("the replica of Pi's block off the shared prefix's critical path … `buildSystemPrompt` is not exported") is still true, and line 53 ("composed in Pi's own order") is still true.
- `docs/configuration.md`: its tables list which parts a child gets, not their byte shape.
- `README.md`: it does not describe either shape.

A fresh-context `tidy-first-assessor` grepped `renderProjectContext|buildPortablePrompt|<addendum>` across `src` and `test`.
It found no byte assertion on either function's output outside the files listed above.

## Test Impact Analysis

1. New tests: an append-only portable case in `parent-snapshot.test.ts`, the one input whose output was not pinned before.
2. Tests made redundant: none.
3. Tests that stay as they are:
   - The `prompts.test.ts` loader stand-ins assert `toContain` on the `path=` attribute and the relative order of the portable identity and `<project_context>`, and both hold in either shape.
   - The fail-safe tests (whitespace-only, absent capture) do not depend on the shape.

The design depends on a measurement taken while planning:

- Today, deleting the `lines[openAt + 2] === PROJECT_CONTEXT_LEAD_IN ||` arm of `projectContextStart` turns 6 of the 74 `prompts.test.ts` tests red.
- With `renderProjectContext` switched to the 0.86 shape and `parentPrompt()` still calling it, the same deletion leaves all 74 green.
  The fixture would silently start testing the +1 arm.

Step 1 exists because of that result.

## Invariants at risk

- **[#958]'s dual-offset lead-in guard.**
  The ≤0.85 (+2) arm of `projectContextStart` serves hosts on pi 0.81–0.85 whose parent prompts carry the old block.
  Today 6 tests pin it through `parentPrompt()` (measured, above): "cuts the inherited block for a relocated child" in append and in replace mode, "cuts the block when the parent resolved no skills", "anchors on Pi's own opening, not one a context file quotes", "names the child's own directory, not the parent's", and "carries no project context when the workspace resolves none".
  Step 1 decouples the fixture, and steps 1 and 2 each re-run that deletion to confirm the 6 still go red.
  The ≥0.86 (+1) arm stays pinned by the `sectionParentPrompt()` tests, which are unchanged.
- **ADR 0010: a `full` child in the parent's directory is byte-identical in its shared prefix.**
  It serves #180's local-inference constituency. "keeps the parent's project context inside the shared prefix" (around line 1043) pins it, building both sides from `parentPrompt()`, so it still holds after step 1.
  `ownProjectContext` returns `""` for that child before `renderProjectContext` is reached, so step 2 cannot touch it.
- **ADR 0009: an unusable portable capture falls back to `genericBase`.**
  It serves pi-claude-bridge users.
  It is pinned by "treats a whitespace-only custom or append prompt as absent" (`parent-snapshot.test.ts`) and the `prompts.test.ts` fail-safe block.
  Step 3 wraps only after the trim check, and the whitespace test stays unchanged as its pin.

## TDD Order

1. **`test(pi-subagents): hand-build the ≤0.85 project-context block in the footer-shaped prompt fixture`** This prepares step 2: `parentPrompt()` stops depending on the function step 2 changes.
   - Replace `\n\n${renderProjectContext(layers.contextFiles) ?? ""}\n` with an inline ≤0.85 block.
     The fixture's output must stay byte-identical: `<project_context>\n\nProject-specific instructions and guidelines:\n\n`, then each `<project_instructions path="…">\n…\n</project_instructions>\n\n`, then `</project_context>\n`.
     That is the same layout as the pinned 0.84.4 `buildSystemPrompt`, including the `\n\n` it writes before the block.
   - Reword the doc comment: the project-context layer is hand-built from the ≤0.85 dist shape, as `sectionParentPrompt()` is from 0.86.1's.
   - Verify:
     - The full `prompts.test.ts` passes unchanged.
     - Delete the `lines[openAt + 2] === PROJECT_CONTEXT_LEAD_IN ||` arm in `src/session/prompts.ts`.
       The 6 tests named under Invariants at risk go red.
       Revert the deletion (`git diff --stat` confirms it applied first).
2. **`fix(pi-subagents): render a relocated or portable child's project context in pi 0.86's block shape`**
   - Red: rewrite the two `toBe` expectations in `project-context.test.ts` `describe("Pi's block format")` to the 0.86.1 shape.
     - One file: `["<project_context>", "Project-specific instructions and guidelines:", "", '<project_instructions path="/repo/AGENTS.md">', "Repo rules.", "</project_instructions>", "</project_context>"]`.
     - Two files: the same, with `""` between the first `</project_instructions>` and the second `<project_instructions …>`.
     - Rename the first test to "renders one context file the way pi ≥0.86's buildSystemPrompt does", and cite the 0.86.1 measurement in the comment.
   - Green: change the body and doc comment as in Design Overview.
     Update the `project-context.ts` entry in `docs/architecture/architecture.md` in the same commit.
   - Killing mutations:
     - (a) Opening blank line: put the `\n` back after `<project_context>`, i.e. `` `<project_context>\n\n${content}…` ``.
       Both tests go red.
     - (b) Block separator: make each block end in `\n`, i.e. `` `…</project_instructions>\n` ``.
       Both tests go red; in the two-file case the gap between blocks becomes two blank lines.
     - (c) Closing blank line: `` `…\n\n</project_context>` ``.
       Both tests go red.
   - Verify:
     - Re-run step 1's lead-in-arm deletion.
       The same 6 tests still go red, so the ≤0.85 arm is still pinned with the replica in the new shape.
       Revert.
     - Full package suite.
3. **`fix(pi-subagents): wrap a portable child's appended prompt in pi 0.86's addendum section`**
   - Red, in `parent-snapshot.test.ts` `describe("portablePrompt")`:
     - Change "orders the parts the way Pi composes them: custom, then append" to expect `["You are a specialist.", "", "<addendum>", "Extra instructions.", "</addendum>"].join("\n")`.
     - Add "wraps an appended prompt alone in the addendum section": `{ appendSystemPrompt: "Extra instructions." }` → `"<addendum>\nExtra instructions.\n</addendum>"`.
   - Green: the `buildPortablePrompt` change and both doc comments, as in Design Overview.
   - Killing mutations:
     - (a) The wrapper: `sections.push(appended)`.
       Both new expectations go red.
     - (b) Wrapping before the absence check: push ``` `<addendum>\n${options.appendSystemPrompt ?? ""}\n</addendum>` ``` unconditionally.
       "treats a whitespace-only custom or append prompt as absent" and "omits a section whose input is absent" go red.
   - Verify: full package suite, `pnpm --filter @gotgenes/pi-subagents run check`, and `pnpm --filter @gotgenes/pi-subagents run lint`.

No `Co-authored-by:` trailer: the mechanism comes from Pi's own renderer and the operator's issue, not from a third-party patch.

## Risks and Mitigations

- **The ≤0.85 lead-in arm quietly loses its pins.**
  This is measured, not hypothetical (see Test Impact Analysis).
  Step 1 decouples the fixture before step 2 moves the shape, and both steps re-run the arm-deletion mutation.
- **On ≤0.85 hosts, a child's own block and a portable identity now differ from what Pi would write there.**
  That is the same size of mismatch 0.86 hosts see today, which the issue rates low severity, and no reader parses it (see Background).
  The doc comment says so, so the claim stays accurate for both populations.
- **A reader outside this repo anchors on the ≤0.85 bytes.**
  The known readers (pi-permission-system, pi-anthropic-auth, pi-claude-bridge) were checked in source, and none reads a child's own block or its portable identity.
  An unknown reader is the residual risk.
  The change is two literal edits that are easy to revert.
- **Pi reshapes the block again.**
  The replica drifts again, as it did here.
  Nothing anchors on it, so drift costs accuracy of the claim, not behavior; the doc comment names the renderer version it mirrors, so the next drift is visible.

## Open Questions

- None blocking.

[#958]: https://github.com/gotgenes/pi-packages/issues/958
