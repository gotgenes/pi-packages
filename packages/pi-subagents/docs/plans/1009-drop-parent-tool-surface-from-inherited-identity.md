---
issue: 1009
issue_title: "pi-subagents: drop the parent's <tools> and <rules> sections from the inherited identity"
---

# Drop the parent's `<tools>` and `<rules>` sections from the inherited identity

## Release Recommendation

**Release:** ship independently

No roadmap step in `docs/architecture/architecture.md` references this issue, and pi-subagents has no open improvement phase.
Ordering matters across packages, though.
This release must reach npm **before** pi-permission-system's [#999] release, or children double-list their tools in the window between the two (see Risks).
Shipping first is safe: while pi-permission-system still relocates (its ADR 0014), the parent's head carries no `<tools>`/`<rules>` to cut, so this change is a no-op for those users.

## Problem Statement

On a section-shaped prompt (Pi 0.86 and later), a child running under `full` inheritance copies its parent's `<tools>` and `<rules>` sections into its own prompt.
Those sections describe the parent's tool surface.
Pi writes no list of its own for the child, because the child's prompt is a `customPrompt`.

Today pi-permission-system hides this by stripping `<tools>`/`<rules>` from every node's head and appending each node's own list after `<cwd>`.
It does so by returning a forced `systemPrompt`, which [#999] shows drops every section a later extension adds (Pi 0.99.2's `<mcp_servers>`).
The #999 plan stops forcing the prompt and leaves Pi's `<tools>`/`<rules>` in place, narrowed through the active tool set.
Once that ships, the parent's narrowed list sits inside the inherited region, and every child shows two lists that disagree: the parent's, inherited, and its own, after `<cwd>`.
Without pi-permission-system the child already inherits the parent's list today ([#901]).

## Goals

- On a section-shaped parent prompt, the inherited identity excludes Pi's `<tools>` and `<rules>` sections; everything else in the region is kept byte for byte.
- A child of a parent whose head carries `<tools>`/`<rules>` gets the same identity as a child of a parent whose head carries none (today's relocated shape).
- Leave the ≤0.85 footer shape untouched.
- Record the decision as ADR 0011, amending ADR 0006 (which rejected excising an interior span) and ADR 0008 (whose accepted residual changes).
- Breaking-change classification: **not breaking**, so `fix:`.
  The child's prompt layout is not a documented contract, and the inherited parent list was documented as a known defect ([#901]).

## Non-Goals

- **Giving a child its own tool list without pi-permission-system ([#901]).**
  After this change such a child carries no tool list and no rules (Pi writes neither for a `customPrompt` session); the request's `tools` array still names exactly its tools.
  The operator chose to keep [#901] open with its residual restated, not to add a mechanism here.
- **The ≤0.85 footer shape.**
  Its `Available tools:`/`Guidelines:` prose is untagged, and the issue scopes the cut to the section shape.
  The peer floor (`>=0.81.0`) still admits it, so the existing footer-shape shared-prefix tests stay as they are.
- **The pi-permission-system half**, which is [#999].
- **Preserving the parent-to-child shared prefix past the preamble.**
  Once [#999] ships, parent and child share only Pi's preamble plus the `\n\n<` separator, 172 characters (measured below); the operator accepted that trade on [#999].
- **`<docs>`.**
  Pi's docs section is identical in every node, so it stays in the identity.
- **Portable inheritance (ADR 0009).**
  `adoptedIdentity` takes `portablePrompt` there and never calls `inheritedIdentity`.

## Background

- `src/session/prompts.ts`:
  - `inheritedIdentity(prompt, parentCwd, cutProjectContext)` splits into lines, gets a tail index from `sessionResolvedTailStart`, and returns `lines.slice(0, tailStart).join("\n").trimEnd()` (or the whole prompt at `-1`).
  - `sessionResolvedTailStart` calls `cwdAnchoredTailStart`, then moves the cut up to `<project_context>` for a relocated child.
  - `cwdAnchoredTailStart` detects the shape: the ≤0.85 `Current working directory:` footer, else the ≥0.86 `<cwd>` section (`cwdSectionStart`, then `skillsSectionWrapperStart`), else an unanchored last-`</available_skills>` guess.
    It returns a bare index, so its caller cannot tell which shape anchored the cut.
  - The `inheritedIdentity` doc comment still says "`Available tools:` sits a few hundred characters into it, and narrowing it there ended the shared prefix" ([#890]).
- Pi 1.0.0's `buildSystemPromptSections` (`packages/coding-agent/src/core/system-prompt.ts` in the `../../pi` checkout at `v1.0.0-2-g7fbbd5f4a`), read for this plan:
  - Without `customPrompt`, it renders `preamble`, then `tools`, `rules`, and `docs`.
    With one, the custom prompt is the preamble and none of the three is rendered.
  - Then `addendum` (if any), `project_context` (if any), `skills` (if any), `cwd` (always), then extension `sections` in insertion order.
  - Each non-preamble section is wrapped `<name>\n…\n</name>`; `getSystemMessageText` joins them with `"\n\n"`.
  - `tools` content is the bullet list (or `(none)`) plus the sentence "In addition to the tools above, you may have access to other custom tools depending on the project."
    `rules` always carries at least "Be concise in your responses" and "Show file paths clearly when working with files".
    Every `tools`/`rules` content line starts with `- `, a blank, or that sentence, so neither can contain a bare `</tools>` or `</rules>` line.
- Pi's default preamble measures 169 characters (measured with `printf '%s' … | wc -c`), so `<tools>` opens at offset 171.
  That matches the 171 recorded in [#890]'s planning.
- ADR 0006 § "Truncate rather than excise" rejected excising the catalogue and footer while keeping the extension tail, because the kept tail moves from cached to prefilled.
  This change excises an interior span; ADR 0011 must say why that rejection does not reach these two sections.
- ADR 0010 § "Why the cut is truncation, not excision" restates the same principle for `<project_context>`.
- The `prompts.ts` positional-discipline convention: every anchor matches whole lines and checks its neighbors, so a context file that quotes Pi's markup is not taken for it.

## Design Overview

The evidence is Pi's source plus hand-built fixtures; `buildSystemPrompt` is not exported from `@earendil-works/pi-coding-agent`, so tests cannot call it (ADR 0010).
No live repro was run: the double list only appears once [#999] lands.

### Before and after (same-cwd child, Pi-authored parent, after #999)

```text
parent's prompt                       child's inherited identity, today      after this change
preamble                              preamble                               preamble
<tools> parent's list </tools>        <tools> parent's list </tools>
<rules> parent's rules </rules>       <rules> parent's rules </rules>
<docs> … </docs>                      <docs> … </docs>                       <docs> … </docs>
<project_context> … </project_context><project_context> …                    <project_context> …
<skills> … </skills>
<cwd> /repo </cwd>
```

Pi then appends nothing tool-related for the child; pi-permission-system (after [#999]) adds the child's own `<tools>`/`<rules>` after `<cwd>`.

### Anchor shape

Step 1 makes `cwdAnchoredTailStart` report which shape anchored the tail:

```typescript
type PromptShape = "footer" | "section" | "unanchored";

interface AnchoredTail {
  /** Line index at which the session-resolved tail begins, or -1. */
  readonly at: number;
  readonly shape: PromptShape;
}
```

`sessionResolvedTailStart` returns an `AnchoredTail` too, replacing `at` when it cuts earlier at `<project_context>` and keeping `shape`.
The two functions are private, so nothing outside `prompts.ts` changes.

### The excision

Only when `shape === "section"`, `inheritedIdentity` removes Pi's tool surface from the kept head:

```typescript
function inheritedIdentity(prompt: string, parentCwd: string, cutProjectContext: boolean): string {
  const lines = prompt.split("\n");
  const tail = sessionResolvedTailStart(lines, parentCwd, cutProjectContext);
  if (tail.at === -1) return prompt;
  const head = lines.slice(0, tail.at);
  const kept = tail.shape === "section" ? withoutToolSurface(head) : head;
  return kept.join("\n").trimEnd();
}
```

`withoutToolSurface(lines)` (private, beside `cwdSectionStart`):

1. **Bound.**
   The index of the first whole line equal to one of `<docs>`, `<addendum>`, `<project_context>`, `<skills>`, `<cwd>`, or `lines.length` when none.
   Pi writes `<tools>`/`<rules>` above all five, so a pair quoted inside an addendum or a context file sits below the bound.
2. **Tools.**
   The first whole-line `<tools>` above the bound, and the first `</tools>` after it, also above the bound.
3. **Rules adjacency.**
   The line after `</tools>` is blank, and the one after that is `<rules>`; then the first `</rules>` after it, above the bound.
   Pi always renders both, adjacent, so a lone `<tools>` block is not Pi's.
4. **Span.**
   From the `<tools>` line through `</rules>`, plus the one blank separator line after `</rules>` when present.
   Removing the separator turns `preamble\n\n<tools>…</rules>\n\n<docs>` into `preamble\n\n<docs>`, which is exactly what Pi renders when the two sections are absent.
5. Any check failing returns the lines unchanged.

The project-context cut is applied first (on the tail), the excision second (on the head); they touch disjoint line ranges because the bound sits at or above the tail.

### Edge cases

- **Relocated parent (pi-permission-system before [#999]).**
  No `<tools>` above the bound, so the head is returned unchanged: byte-identical to today.
- **Custom-prompt parent (`SYSTEM.md`).**
  Pi renders no `<tools>`/`<rules>`/`<docs>`.
  A custom prompt that quotes a whole-line `<tools>` block followed by a blank and a `<rules>` block would be cut; nothing short of that is.
  This is accepted; it is the same class of risk the other anchors accept.
- **`cutProjectContext` with no `<docs>`, `<addendum>`, or context.**
  The bound falls to `<skills>` or `<cwd>`, or to the end of the sliced head when the tail cut already removed those.
  The span must still close above the bound, so a head that ends mid-section is left alone.
- **Unanchored shape** (neither cwd layer): untouched, since a rewritten prompt is not one whose layout we can trust.
- **Nested children**: the core excludes the `subagent` tool from children, so no child is a parent.

### Shared prefix, measured

Parent after [#999]: `preamble\n\n<tools>…`.
Child after this change: `preamble\n\n<docs>…`.
They share the 169-character preamble, `\n\n`, and `<`: 172 characters (derived from the measured preamble length).
While pi-permission-system still relocates, both heads are `preamble\n\n<docs>…` and the whole identity stays shared.

## Module-Level Changes

- `src/session/prompts.ts`:
  - Add `PromptShape` and `AnchoredTail` (private).
  - `cwdAnchoredTailStart` and `sessionResolvedTailStart` return `AnchoredTail` (step 1).
  - Add `withoutToolSurface` and the tag constants it reads (`TOOLS_SECTION_OPEN`/`CLOSE`, `RULES_SECTION_OPEN`/`CLOSE`, `DOCS_SECTION_OPEN`, `ADDENDUM_SECTION_OPEN`), beside the existing `CWD_SECTION_OPEN` (step 2).
    Reuse `SKILLS_SECTION_OPEN`, `CWD_SECTION_OPEN`, and `PROJECT_CONTEXT_OPEN` for the bound.
  - `inheritedIdentity` applies it for the section shape, and its doc comment loses the stale `Available tools:` passage in favor of the excision rationale (step 2).
  - Rename `cwdAnchoredTailStart` only if its "returns an index" docstring no longer reads true; the assessor recommends keeping the name.
- `test/session/prompts.test.ts`:
  - `sectionParentPrompt` (around line 802) gains optional `tools`, `rules`, and `docs` layers, rendered as Pi's sections between the identity and `<project_context>`.
  - A new nested `describe("Pi's tool surface")` inside `describe("pi ≥0.86 section shape")` (around line 843) holds the step 2 tests.
- Docs (step 3):
  - `docs/decisions/0011-tool-surface-sections-are-session-resolved.md` (new): context (the [#999] collision, the double list), decision (the excision, the shape gate, the adjacency anchor), why excision is right here when ADR 0006 rejected it (the excised span is session-resolved and replaced by the child's own after `<cwd>`; the cost is the shared prefix the operator accepted on [#999]), consequences (172-character shared prefix after [#999]; [#901]'s residual becomes "no list and no rules"; byte-identical while pi-permission-system relocates).
  - `docs/decisions/0006-inherited-prompt-is-identity-only.md`: `status` → `amended by 0008, 0010, and 0011`; add a Status sentence and an `[ADR 0011]` link; the region table's Identity row gains a note that tool snippets and guidelines are session-resolved on the section shape.
  - `docs/decisions/0008-inherited-region-is-shared-parts.md`: `status` → `amended by 0011`; the Status section and the "Accepted residual" consequence point to ADR 0011.
  - `docs/configuration.md`:
    - The layer table row `` `Available tools:` / `Guidelines:` `` (line 32) becomes `<tools>`/`<rules>`: never inherited on Pi ≥0.86; stated by the child's own pi-permission-system when installed, otherwise absent.
    - The paragraph at lines 50–51 is rewritten: no pi-permission-system relocation claim, and the [#901] residual restated as "no tool list or rules in prose; the request's tool definitions still name the child's tools".
    - Link ADR 0011 beside ADR 0006/0008 at line 54.
  - `README.md` line 428: replace "pi-permission-system relocates the `Available tools:` and `Guidelines:` sections… for exactly this reason" with the current mechanism: pi-subagents drops Pi's `<tools>`/`<rules>` from what a child inherits, so a per-session tool statement belongs after `<cwd>`.
    Keep the sentence about editing the inherited region ending the shared prefix.
  - `docs/architecture/architecture.md` line 355 (`prompts.ts` module-tree entry): add "and drops Pi's `<tools>`/`<rules>` sections on the section shape (ADR 0011)".
    Grep the doc for `Available tools`, `relocat`, and `inheritedIdentity` before finishing; the planning grep found no other hit and no Mermaid node naming the cut.
  - `.pi/skills/package-pi-subagents/SKILL.md` line 49: replace the pi-permission-system relocation sentence with ADR 0011's rule (Pi's `<tools>`/`<rules>` are session-resolved and never inherited on the section shape).
    Add an `## Upstream assumptions` row: `buildSystemPromptSections` renders `<tools>` and `<rules>` adjacent, above `<docs>`/`<addendum>`/`<project_context>`/`<skills>`/`<cwd>` (`packages/coding-agent/src/core/system-prompt.ts`; breaks as behavioral-silent: children inherit the parent's tool surface again).
- Predicted unchanged:
  - `src/lifecycle/parent-snapshot.ts`: its "tool surface is node-local prose" comment (line 23) still holds.
  - `test/session/session-config.test.ts`, `test/lifecycle/create-subagent-session.test.ts`, `test/helpers/subagent-session-io.ts`: they reach `buildAgentPrompt` but none builds a section-shaped parent carrying `<tools>`; verify with `grep -n "<tools>" packages/pi-subagents/test -r` (planning grep: only `prompts.test.ts` hits `<cwd>`, and nothing hits `<tools>`).
  - The footer-shape `shared prefix with the parent` tests (around line 1007), which use untagged `Available tools:` and must stay green unchanged; that is the shape gate's pin.

## Test Impact Analysis

1. **New tests:** the excision is reachable only through `buildAgentPrompt`, as every other anchor is; no new unit seam is needed.
2. **Redundant tests:** none.
   The step 1 refactor is pinned entirely by the existing anchor tests.
3. **Must stay as-is:** the footer-shape shared-prefix tests (shape gate), the section-shape tests at lines 849–945 (no `<tools>` in their fixtures, so the head they keep must be untouched), and `no anchor present`.

## Invariants at risk

| Invariant                                                            | Source                              | Pinned by                                                                                                                  |
| -------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Identity ahead of the section-shaped tail kept byte for byte         | ADR 0006, [#961]                    | `keeps the identity ahead of the skills section byte for byte`; extended by the new "everything but the tool surface" test |
| Relocated child cuts its inherited `<project_context>`               | ADR 0010                            | `cuts the inherited block for a relocated child at the project-context section`; plus the new combined test                |
| Footer-shape identity, including `Available tools:`, shared verbatim | ADR 0008, [#890]                    | `shared prefix with the parent` describe, unchanged                                                                        |
| A quoted Pi tag in a context file is not taken for Pi's              | ADR 0006/0010 positional discipline | new "keeps a quoted pair inside project context" test                                                                      |
| Child of a relocated parent is byte-identical to today               | this plan (safe to ship first)      | new "matches the relocated parent's identity" test                                                                         |

The constituency for the shared prefix is [#180]'s local-model hosts.
It holds unchanged until [#999] ships; the 172-character figure after that is the operator's accepted trade, recorded in ADR 0011.

## TDD Order

1. **`refactor(pi-subagents): report which prompt shape anchored the inherited tail`**
   - Tidy-First recommendation: the excision applies only to the `<cwd>`-section shape, and `cwdAnchoredTailStart` returns a bare index.
   - Add `PromptShape`/`AnchoredTail`; `cwdAnchoredTailStart` returns `{ at, shape }` with `"footer"`, `"section"`, or `"unanchored"`; `sessionResolvedTailStart` carries `shape` through and replaces `at` on the project-context cut; `inheritedIdentity` reads `tail.at` and ignores `shape`.
   - No test changes; the full `prompts.test.ts` suite stays green.
   - No killing mutation: no behavior changes.
2. **`fix(pi-subagents): stop children inheriting the parent's tool list and rules`**
   - Extend `sectionParentPrompt` with optional `tools`, `rules`, and `docs` layers, and add `withoutToolSurface` plus the `inheritedIdentity` call, the doc-comment rewrite, and these tests under `describe("Pi's tool surface")`:
     - a. "drops the parent's `<tools>` and `<rules>`": a same-cwd replace-mode child of a parent with `tools`/`rules`/`docs`/`skills`/`cwd` starts with exactly `` `${IDENTITY}\n\n<docs>\n${DOCS}\n</docs>\n\n<active_agent` `` (`toBe` on the prefix slice).
     - b. "matches the relocated parent's identity": the child prompts for a parent with and without `tools`/`rules` (same other layers) are equal (`toBe`).
     - c. "drops them for a relocated child too": a relocated child of a parent with `tools`/`rules`/`docs`/`contextFiles`/`cwd` contains neither `<tools>` nor `<project_context>` and keeps `<docs>`.
     - d. "keeps a quoted pair inside project context": a context file whose content is `<tools>\n- x\n</tools>\n\n<rules>\n- y\n</rules>`, same-cwd child, parent without real `tools`/`rules`; the child keeps that content verbatim.
     - e. "keeps a `<tools>` block not followed by Pi's `<rules>`": an identity carrying `<tools>\n- x\n</tools>\n\nprose` and no rules; kept verbatim.
     - f. "leaves the footer shape alone": a `parentPrompt` (footer shape) whose identity contains Pi-shaped `<tools>`/`<rules>` blocks keeps them.
   - Killing mutations (one per class):
     - Make `inheritedIdentity` skip `withoutToolSurface` (`const kept = head`): a, b, c go red.
     - Drop the shape gate (`const kept = withoutToolSurface(head)`): f goes red.
     - Make the bound `lines.length` unconditionally: d goes red.
     - Remove the rules-adjacency check (end the span at `</tools>` when `<rules>` does not follow): e goes red.
     - End the span at `</tools>` (leave `<rules>`): a and b go red.
     - Skip the trailing blank separator: a and b go red (`\n\n\n\n<docs>` vs `\n\n<docs>`).
3. **`docs(pi-subagents): record that a child never inherits Pi's tool surface`**
   - ADR 0011 (new), ADR 0006 and ADR 0008 status/pointers, `configuration.md`, `README.md`, `architecture.md`, and the `package-pi-subagents` skill, as listed in Module-Level Changes.
   - Verify with `pnpm exec rumdl check` over the touched markdown and `grep -rn "relocates the" packages/pi-subagents/README.md packages/pi-subagents/docs/configuration.md .pi/skills/package-pi-subagents` (expect no hit).

At ship time, comment on [#901] that after this release a child without pi-permission-system carries no tool list or rules in prose rather than its parent's, and that the issue stays open for a child-stated list.

## Risks and Mitigations

- **Version skew with pi-permission-system.**
  A user who upgrades pi-permission-system past [#999] without this release sees two lists in every child.
  Mitigation: ship this first (Release Recommendation); [#999]'s plan already names the pairing in its ADR 0015 and CHANGELOG.
- **Loss of generic rules without pi-permission-system.**
  A child loses "Be concise…" and the parent's tool guidelines, including guidelines for tools it does hold.
  Accepted by the operator with [#901] kept open; ADR 0011 and `configuration.md` state it.
- **A custom prompt quoting Pi's adjacent `<tools>`/`<rules>` pair** is cut (Edge cases).
  Low likelihood; the same class of risk as the other anchors.
- **Pi changes the section order or tag names.**
  The anchors stop matching and a child keeps the parent's sections: the status quo before this change, not a new failure mode.
  The fixtures are hand-built from Pi 1.0.0's `buildSystemPromptSections`, so an upstream rename surfaces only in a live session; the package skill's upstream-assumptions table should gain a row in step 3 (`system-prompt.ts` `buildSystemPromptSections` order: tools/rules adjacent, above docs/addendum/project_context/skills/cwd).

## Open Questions

- None blocking.
  Whether a later [#901] fix has pi-subagents state a child's own `<tools>`/`<rules>` stays with that issue.

[#180]: https://github.com/gotgenes/pi-packages/issues/180
[#890]: https://github.com/gotgenes/pi-packages/issues/890
[#901]: https://github.com/gotgenes/pi-packages/issues/901
[#961]: https://github.com/gotgenes/pi-packages/issues/961
[#999]: https://github.com/gotgenes/pi-packages/issues/999
