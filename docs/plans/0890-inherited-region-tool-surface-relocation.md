---
issue: 890
issue_title: "pi-permission-system's in-place prompt rewrite defeats pi-subagents' byte-identical parent prefix"
---

# Relocate the tool-surface prose out of the inherited identity

## Release Recommendation

**Release:** ship independently

`pi-subagents` Phase 22 Step 18 carries `Release: independent`, and the roadmap's `Release batches` subsection lists Step 18 among the independently releasable steps with the note that it "releases only if it lands as `fix:`".
It does land as `fix:` — the tool-surface relocation is a behavior change in `pi-permission-system` and the bridge removal is one in `pi-subagents` — so both packages cut a release.
The dispatch names both: `gh workflow run release.yml -f packages="pi-permission-system pi-subagents"`.
Neither package is a member of `pi-permission-system`'s Phase 15 batches; that phase's disposition for [#890] records the work as belonging to this step rather than to a Phase 15 step.

## Problem Statement

`@gotgenes/pi-permission-system` narrows the agent's `Available tools:` listing by rewriting the assembled system prompt in place and returning it from `before_agent_start`.
That listing sits at offset 171 of Pi's preamble — inside the region `@gotgenes/pi-subagents` copies verbatim into a child's prompt so the child's leading bytes match the parent's ([ADR-0006], [#180], [#400]).
For any child whose allowed tool set differs from its parent's, the rewrite ends the shared prefix at the tool list.

Both packages are correct on their own terms.
The rewrite prevents inherited tool documentation from lying to the child about its own capability; the prefix exists because [#180]'s reporter measured 8,333 shared tokens costing roughly 40 seconds of prompt processing on a local model.
The conflict is arithmetic: a byte-identical prefix and an honest child tool list cannot coexist **while the list lives inside the prefix**.

The issue offers four candidate resolutions and asks for a decision.
This plan records a fifth, reached by moving the list out of the prefix rather than choosing between the two invariants.

## Goals

- Relocate the tool-surface prose — the `Available tools:` section, the "In addition to the tools above…" paragraph, and the `Guidelines:` section — out of Pi's preamble and render it, per node, at the end of the prompt.
  Parent and child then share the whole identity, and each node states its own honest tool list.
- Render that block from parts (`systemPromptOptions.toolSnippets`, `ToolInfo.promptGuidelines`) rather than by narrowing text Pi wrote, so a child whose base prompt carries no such section still gets one.
- Retire "byte-identical parent prefix" as a stated design goal, replacing it with "shared parts, scoped to where a prefix pays", and record why: on Anthropic the `tools` array precedes the system prompt in the cache key, so a narrowed child never had a cache hit to lose.
- Stop the two packages using "byte-stable" for two different invariants.
- Remove `pi-subagents`' hard-coded `<sub_agent_context>` bridge block, whose tool bullets duplicate Pi's own per-tool guidelines and misinstruct a child that lacks those tools.

**Not breaking.**
No config key, exported symbol, event payload, or file format changes.
The observable change is the position and provenance of prose inside the system prompt, which no documented contract pins.
`fix:` in both packages, not `fix!:`.

## Non-Goals

- **A child without `pi-permission-system` installed.**
  It still inherits the parent's list.
  Filed as [#901], with the order-independent contract a second writer must honor recorded there and in ADR 0014.
  Deferred against Phase 22 by operator decision.
- **`portable` prompt inheritance ([#884]).**
  It composes with this change rather than being subsumed by it: `portable` builds the child identity from `systemPromptOptions` for hosts that re-home the prompt, and remains the fallback if [pi-claude-bridge#88]/[#89] does not land.
  Its proposed ADR number 0008 collides with this plan's; whichever lands second renumbers.
- **[#883].**
  This change does not close it.
  It removes the tool-list divergence that broke the bridge's inheritance matching, but pi's base preamble still reaches a re-homing provider through the inherited identity.
- **Removing the classifier-trigger paragraph** (Pi's documentation-routing block) from the inherited identity.
  Dropping it would change the identity's bytes and cost exactly the constituency this plan protects; `pi-anthropic-auth` and `pi-claude-bridge` already strip it at the wire.
- **A shared prompt-composer package.**
  Recorded as direction in ADR 0014; not built here.
- **`pi-permission-system` Phase 15.**
  Its spine is token roles and declared effects; this touches `exposure/`, which no Phase 15 step opens.

## Background

### How the two packages meet

`ParentSnapshot` takes `ctx.getSystemPrompt()` (`packages/pi-subagents/src/lifecycle/parent-snapshot.ts`), which outside `before_agent_start` returns `agent.state.systemPrompt` — the value the extension chain wrote.
So a child inherits the parent's **post-rewrite** identity.
`buildAgentPrompt` then runs `inheritedIdentity`, truncating at the skills catalogue or cwd footer, and the result becomes the child's `systemPromptOverride`.

Pi's `buildSystemPrompt` `customPrompt` branch writes **no** `Available tools:` section (verified in the pinned SDKs), so the inherited copy is the child's only tool prose.
`create-subagent-session.ts` sets `noContextFiles: true`, so the inherited identity is also the child's only `<project_context>`.

Two narrowings exist and answer different questions:

| Package                | What it narrows                                                                                     | When                                |
| ---------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `pi-subagents`         | the tool set the child session is **constructed** with (`tools: [...cfg.toolNames, ...childTools]`) | once, at child-session construction |
| `pi-permission-system` | the tools policy **allows** (`resolveExposedTools` → `setActive`)                                   | every turn, in each node            |

The split is deliberate: `pi-subagents` removed `disallowed_tools` in its Phase 14 ([#237]–[#239]) precisely so `pi-permission-system` is the sole authority for access control.
`tools:` survived as capability composition.

Because the child's registry contains only the constructed tools, and `systemPromptOptions.toolSnippets` is derived from the active set, a block `pi-permission-system` renders **inside the child** already reflects both narrowings.
That is what makes one writer sufficient.

### Why the prefix is worth less than [ADR-0006] claims

Anthropic's caching docs state the hierarchy directly:

> Cache prefixes are created in the following order: `tools`, `system`, then `messages`. … Modifying tool definitions (names, descriptions, parameters) invalidates the entire cache.

The `tools` array precedes the system prompt, so **every** child with a different tools array — every narrowed child, and every child carrying `ask_parent`/`notify_parent`, which no parent has — gets no cache hit from a byte-identical system prompt.
On the Anthropic OAuth path there is a second, independent kill: `@gotgenes/pi-anthropic-auth` prepends a billing block as system block 0 whose `cch=` is `sha256(first user message)[:5]`, and parent and child have different first messages.

The prefix pays where [#180]'s reporter lives: local inference whose chat template renders tool definitions *after* the system text, and API-key Anthropic with an identical tools array.
[ADR-0006] never scoped the claim by provider.
This plan does not weaken the prefix for that constituency — it lengthens it.

### Other parties editing the same string

Two more consumers anchor on this region, and both are affected by where the tool list sits:

- `@gotgenes/pi-anthropic-auth` (outside this monorepo) sanitizes the span from `"You are an expert coding assistant operating inside pi…"` to the docs-block terminator at the wire, dropping the identity, the "In addition to the tools above" filler, and the docs paragraph, and **preserving tool snippets and guidelines**.
  After relocation the block sits outside that span, so it survives untouched — the same outcome as today.
- `pi-claude-bridge` matches a child's prompt against the parent's tail-stripped prompt as a substring ([pi-claude-bridge#88]).
  The relocated block lands in the tail its key already excludes.
  **This is an inference from [#884]'s thread, not a read of the matcher** — recorded as a risk below, not as a verified claim.

### Constraints from AGENTS.md

- Commit type by observable outcome: both halves are `fix:`.
- Do not name an unreleased version; describe the condition.
- `pi-permission-system`'s `docs/architecture/architecture.md` inline-copies core `rule.ts` types — not touched here.
- The roadmap step's `✅` mark and `Landed:` note land in the implementation doc-update commit, not at ship.

## Design Overview

### The relocation

`AgentPrepHandler.handle` keeps its tool-filtering and skill-sanitization steps unchanged.
Its prompt step changes from *narrow in place* to *remove, then render at the tail*:

```ts
const toolSurface = renderToolSurface(event.systemPrompt, {
  allowedTools,                                    // already computed for setActive
  toolSnippets: event.systemPromptOptions.toolSnippets ?? {},
  guidelinesByTool,                                // from toolRegistry.getAll()
});
```

`renderToolSurface` performs two operations:

1. **Remove** the `Available tools:` section, the "In addition to the tools above, you may have access to other custom tools depending on the project." paragraph, and the `Guidelines:` section from wherever they appear in the prompt.
   In a parent this finds Pi's own copies near the top; in a child it typically finds nothing, because the parent's node already removed them before the snapshot was taken.
2. **Append** a freshly rendered block at the end of the prompt.

Rendering reproduces Pi's own rules:

- a tool is listed only when it has a snippet (`buildSystemPrompt`: `tools.filter((name) => !!toolSnippets?.[name])`), as `- <name>: <snippet>`;
- guidelines are the per-tool `promptGuidelines` of allowed tools, deduped in first-seen order, preceded by Pi's conditional bash-file-operations bullet and followed by its two unconditional ones.

This retires the hard-coded `TOOL_GUIDELINE_RULES` table — eight exact lowercase Pi sentences that break silently on any upstream rewording.
Attribution now comes from the registry, so a third-party tool's guidelines are filtered correctly too, which the table never did.

```text
Parent prompt                         Child prompt
─────────────────────────────         ─────────────────────────────
identity sentence                     identity sentence          ┐
pi documentation block                pi documentation block     │ byte-identical
<project_context>                     <project_context>          ┘
<available_skills> (parent's)         <sub_agent_context>… removed by this plan
Current working directory: <parent>   <active_agent name="Explore"/>
Available tools: (parent's allowed)   # Environment / <agent_instructions>
Guidelines: (parent's allowed)        <available_skills> (child's)
                                      Current working directory: <child>
                                      Available tools: (child's allowed)
                                      Guidelines: (child's allowed)
```

`inheritedIdentity` needs no change: it truncates at the catalogue or footer, and the block is past both.
[ADR-0006]'s consequence that "extensions that append to the system prompt no longer reach children through inheritance" is exactly what makes this work — each node's own handler writes its own block.

### Why every node, not just the child

If only the child relocated, the parent's list would stay at offset 171 and the child's would not, so the shared identity would end there — 171 characters, below today's 365.
The relocation is therefore unconditional, which means it changes the prompt of every `pi-permission-system` user, including those who never spawn a subagent and those who deny nothing.

### Ordering

With one writer there is no ordering question.
`pi-subagents` has no `before_agent_start` handler today and needs none: its narrowing is already visible to `pi-permission-system` through the child's registry.
The contract a second writer would have to honor is recorded in ADR 0014 and [#901]: membership from the live registry, text from `toolSnippets`, per-tool guidelines from `getAllTools()`, and idempotent remove-then-render so the last writer wins in either order.

### The `<sub_agent_context>` removal

`buildAgentPrompt`'s `bridge` const is hard-coded, append-mode only, inherited verbatim from the upstream tintinweb fork with no ADR or plan behind it.
Its five tool bullets duplicate Pi's own `read`/`edit`/`write`/`bash` `promptGuidelines`, which after this change are rendered per node and therefore honest; the block asserts them unconditionally, so an `Explore` child is told to "Use the edit tool instead of sed/awk" when it has no `edit`.
The remaining four bullets and the framing sentence are removed with it by operator decision.

Append mode becomes `identity + "\n\n" + header + customSection`, which is `replace` mode's shape plus the `<agent_instructions>` wrapper.
The block sits after the identity, so its removal has no prefix effect.

### Data shapes

```ts
/** Per-tool guideline bullets, keyed by tool name, read from the registry. */
type GuidelinesByTool = ReadonlyMap<string, readonly string[]>;

interface ToolSurfaceInputs {
  readonly allowedTools: readonly string[];
  readonly toolSnippets: Readonly<Record<string, string>>;
  readonly guidelinesByTool: GuidelinesByTool;
}

/** The prompt with Pi's tool-surface sections removed and the node's own appended. */
function renderToolSurface(prompt: string, inputs: ToolSurfaceInputs): string;
```

`BeforeAgentStartPayload` (the handler's minimal local interface) gains `systemPromptOptions: BuildSystemPromptOptions`.
`BuildSystemPromptOptions` is exported as a **type** from both pinned SDKs (0.79.1 and 0.84.4); `buildSystemPrompt` itself is not exported as a value, which is why the block is rendered here rather than delegated to Pi.

### Edge cases

- **No allowed tool has a snippet** — render no `Available tools:` section; still render `Guidelines:` (Pi's two unconditional bullets always apply).
- **A restored tool** — its snippet is absent from `toolSnippets` until Pi's next base rebuild, so it is callable immediately but listed one turn later.
  This is the existing documented lag, unchanged.
- **A user-supplied `customPrompt`** (`SYSTEM.md`) — Pi writes no tool list for them today; after this change they get one appended.
  Gating on `customPrompt` being absent would break the child case, which is a `customPrompt`.
  Accepted; recorded under Risks.
- **`replace`-mode children** — unaffected by the bridge removal (they never received it) and covered by the relocation like any other node.

## Module-Level Changes

### `packages/pi-permission-system`

| File                                                                                          | Change                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/exposure/system-prompt-sanitizer.ts` → `src/exposure/tool-surface-prompt.ts`             | Renamed. `sanitizeAvailableToolsSection` → `renderToolSurface`. `narrowAvailableToolsSection`, `sanitizeGuidelinesSection`, `TOOL_GUIDELINE_RULES`, `shouldKeepGuideline`, `normalizeGuidelineText`, `extractToolBulletName` removed. `findSection`, `normalizePrompt`, `collapseExtraBlankLines`, `isTopLevelSectionHeader`, `isSectionBodyLine` retained for the removal half. New: section renderers. |
| `src/exposure/tool-registry.ts`                                                               | New `getToolPromptGuidelinesFromValue(value: unknown): string[]` beside `getToolNameFromValue`.                                                                                                                                                                                                                                                                                                          |
| `src/handlers/before-agent-start.ts`                                                          | `BeforeAgentStartPayload` gains `systemPromptOptions`. `handle` calls `renderToolSurface`. `toolNamesOf` replaced by a single-pass reader returning names **and** guidelines. Docstring: "byte-stable" → "stable across turns".                                                                                                                                                                          |
| `test/exposure/system-prompt-sanitizer.test.ts` → `test/exposure/tool-surface-prompt.test.ts` | Rewritten.                                                                                                                                                                                                                                                                                                                                                                                               |
| `test/exposure/tool-registry.test.ts`                                                         | Cases for the new reader.                                                                                                                                                                                                                                                                                                                                                                                |
| `test/handlers/before-agent-start.test.ts`                                                    | `makeEvent` gains a default `systemPromptOptions`; prompt assertions flip from narrowed-in-place to removed-plus-appended. Tests at lines 230/251 ("returns empty object when systemPrompt is unchanged") invert: the handler now always returns an override, because the block is always appended.                                                                                                      |
| `test/helpers/handler-fixtures.ts`                                                            | `makeToolRegistry` default tools gain `promptGuidelines`.                                                                                                                                                                                                                                                                                                                                                |
| `docs/decisions/0014-tool-surface-is-node-local-prose.md`                                     | **New ADR.** The relocation, the render-from-parts rule, the every-node requirement, the second-writer contract, and the composer direction.                                                                                                                                                                                                                                                             |
| `docs/configuration.md`                                                                       | Lines 1160/1170/1172 — "narrows the `Available tools:` listing" → relocates and renders; keep the restored-tool lag note. Line 1173 "byte-stable" → "stable across turns".                                                                                                                                                                                                                               |
| `docs/architecture/architecture.md`                                                           | Module-tree line 950 (filename + description); line 472 restored-tool note; Phase 15 disposition at 1099–1101 updated from "deferred to a later phase" to adopted under `pi-subagents` Step 18, naming this plan.                                                                                                                                                                                        |
| `README.md`                                                                                   | Check and update any `Available tools:` narrowing description.                                                                                                                                                                                                                                                                                                                                           |

`external-directory-fixtures.ts` is **predicted unchanged**: the Tidy-First assessor confirmed it does not reference the sanitizer and imports only `makeToolRegistry`, whose change is additive.

### `packages/pi-subagents`

| File                                                       | Change                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/session/prompts.ts`                                   | Delete the `bridge` const and its concatenation; append mode returns `identity + "\n\n" + header + customSection`. Update `buildAgentPrompt`'s docstring (the append-mode layout list) and `inheritedIdentity`'s, which cites the prefix rationale.                                       |
| `test/session/prompts.test.ts`                             | Seven `<sub_agent_context>` assertions (lines 71, 102, 140, 182, 253, 288, 305) flip or are removed; the line-288 test asserts the tag's position *after* the bridge and needs rewriting against the new layout.                                                                          |
| `docs/decisions/0006-inherited-prompt-is-identity-only.md` | Frontmatter `status:` → `amended by 0008`. Add an amendment note; do not rewrite the history.                                                                                                                                                                                             |
| `docs/decisions/0008-inherited-region-is-shared-parts.md`  | **New ADR.** Retires the byte-identical goal, records the Anthropic cache hierarchy and the OAuth billing block, scopes the benefit to templates that render tools after the system text, and points at `pi-permission-system`'s ADR 0014.                                                |
| `docs/configuration.md`                                    | The layer table (line ~30) row "Pi preamble, tool guidelines, project context / inherited byte for byte" — tool guidelines are no longer inherited when `pi-permission-system` is installed. Line 40's byte-identical sentence. Line 101's `prompt_mode` row, which describes the bridge. |
| `docs/architecture/architecture.md`                        | Step 18 `✅` on heading and Mermaid node `S18`, plus a `Landed:` note. Line 838 (Step 18 cause), 928 (Step 15 design note citing the byte-identical prefix), 995 (the `<sub_agent_context>` sentence in the protocol paragraph), 1234/1240 (Step 18 body).                                |
| `README.md`                                                | Lines 367–377 describe inheritance and the append-block contract; check for byte-identical wording.                                                                                                                                                                                       |

### Cross-cutting greps to run before finalizing the file list

`sub_agent_context`, `byte-identical`, `byte-stable`, `byte for byte`, `KV cache`, `sanitizeAvailableToolsSection`, `system-prompt-sanitizer`, `TOOL_GUIDELINE_RULES`, `narrowAvailableToolsSection` — across both packages' `src/`, `test/`, `docs/`, `README.md`, and `.pi/skills/package-pi-permission-system/SKILL.md` (lines 41, 48, 311) and `.pi/skills/package-pi-subagents/SKILL.md`.
The skill files name the mechanism in prose with no removed symbol to match.

## Test Impact Analysis

**New tests the change enables.**
Rendering from parts is a pure function of `(allowedTools, toolSnippets, guidelinesByTool)`, so the block's content is unit-testable without constructing a prompt at all — today's tests must build a prompt containing Pi's exact sentences to exercise the guideline table.

**Tests that become redundant.**
The eight `TOOL_GUIDELINE_RULES` cases in `system-prompt-sanitizer.test.ts`, which pin Pi's exact wording.
They are replaced by "guidelines come from the registry for allowed tools", which is one case plus a filtering case.

**Tests that must stay.**
The restored-tool lag test; the every-turn `setActive` test; the skill-filtering tests (that path is untouched); [#815]'s `shouldExposeTool` cases; [#873]'s `resolveExposedTools` baseline behavior.

**The testable surface is the input domain.**
The removal half must survive prompts it did not write: a `customPrompt` prompt with no sections at all, a prompt whose `Guidelines:` is the last section with no following header, a prompt where `<project_context>` quotes the string `Available tools:`, and a prompt already processed by a previous turn (idempotence).

**Measurement to re-run at implementation.**
The shared-prefix numbers below were measured at planning time with a disposable spike (deleted).
Re-run it after the change lands rather than reusing these values.

## Invariants at risk

| Invariant                                                  | Owner               | Pinned by                                   | Risk                                                                                       |
| ---------------------------------------------------------- | ------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Child inherits identity only; catalogue and footer dropped | [ADR-0006] / [#801] | `prompts.test.ts` `inheritedIdentity` cases | Untouched — verify still green                                                             |
| Wire prompt stable turn-to-turn for a stable policy        | `AgentPrepHandler`  | `before-agent-start.test.ts:282`            | Still holds: the block is a function of the allowed set, not of Pi's drifting base listing |
| A relaxed rule restores its tool                           | [#873]              | `resolveExposedTools` tests                 | Untouched                                                                                  |
| Filtering is restrict-only                                 | [#385]              | `tool-surface-baseline` tests               | Untouched                                                                                  |
| Denied skills hidden every turn                            | —                   | `before-agent-start.test.ts:198`            | Untouched                                                                                  |
| Shared parent/child leading text                           | [#180]/[#400]       | **nothing**                                 | Add a test asserting the child's identity contains the parent's identity verbatim          |

The last row is the gap: the property [#180] and [#400] created has never had a test.
Add one in `pi-subagents` (`buildAgentPrompt`'s output starts with the untruncated inherited identity) and one in `pi-permission-system` (a parent prompt and a child prompt with different allowed sets share their full identity after `renderToolSurface`).

**Quantitative baselines (measured at planning, this repo's real `AGENTS.md`, 28 parent tools / 8 child tools):**

|                                                        | Shared prefix |
| ------------------------------------------------------ | ------------- |
| Today                                                  | 365 chars     |
| Rewrite skipped                                        | 57,425        |
| Truncate identity at the tool section (issue option 3) | 171           |

Small `Explore` scenario (8 parent tools, 5 constructed, 4 allowed): 217 today, 2,470 with the rewrite skipped.
After relocation the shared identity is the full identity minus the removed sections — predicted ≈ 1,880 of a 2,470-char identity in the small scenario, and ≈ 56,900 of 57,423 in the repo scenario.
Both to be measured, not assumed.

## TDD Order

1. **`refactor(pi-permission-system): read per-tool prompt guidelines from the tool registry`** Prepares step 5 — the render needs per-tool guidelines and the registry reader does not exist.
   Add `getToolPromptGuidelinesFromValue` beside `getToolNameFromValue` in `src/exposure/tool-registry.ts`; tests in `test/exposure/tool-registry.test.ts` reusing its `{toolName|name|tool}` fixtures.
   *Killing mutation:* make it return `[]` unconditionally — the "returns the tool's guidelines" case must fail.

2. **`test(pi-permission-system): default systemPromptOptions in the before-agent-start event helper`** Prepares step 5 — `makeEvent` has 35 call sites that would all break when `handle` reads `event.systemPromptOptions`.
   Extend the file-local `makeEvent` with an optional override and a default (`{ cwd: "/test/project", toolSnippets: {}, promptGuidelines: [] }`).
   No production change; suite stays green.
   *Killing mutation:* none — this is a fixture-only step.
   Verify by asserting the helper's default is present in one existing test.

3. **`refactor(pi-permission-system): carry prompt guidelines through the tool-surface observation`** Prepares step 5 — `observeToolSurface` already walks `getAll()` for names and discards the rest; a second walk in `handle` would duplicate it.
   Replace `toolNamesOf` with a single-pass reader returning names and a `Map<string, string[]>`.
   *Killing mutation:* drop the guidelines from the returned pair — the new reader test must fail.

4. **`test(pi-subagents): pin the shared parent/child identity prefix`** The invariant [#180] and [#400] created has no test, and step 6 must not regress it.
   Assert `buildAgentPrompt`'s output begins with the inherited identity verbatim, for a parent prompt carrying a tool section.
   *Killing mutation:* make `inheritedIdentity` return `prompt.trimStart().slice(1)` — the new test must fail.

5. **`fix(pi-permission-system): state each session's own tool list instead of editing the inherited one`** Rename `system-prompt-sanitizer.ts` → `tool-surface-prompt.ts`; replace the narrowing functions with `renderToolSurface`; wire it into `AgentPrepHandler`; rewrite both test files.
   Covers: removal of all three sections from a Pi-shaped prompt; rendering from `toolSnippets` ∩ allowed; guideline dedup and ordering; Pi's three built-in guidelines; the no-snippet case; idempotence over a prompt already processed; a prompt with no sections; a `<project_context>` quoting `Available tools:`.
   The rename and the rewrite land together: `sanitizeAvailableToolsSection` is not exported outside the package, and its one call site changes in the same commit.
   *Killing mutations:* (a) skip the removal and only append — the "parent's preamble no longer carries a tool section" case must fail; (b) render from `selectedTools` instead of `allowedTools` — the "denied tool absent from the rendered block" case must fail; (c) append before the footer instead of at the end — the "block is last" case must fail; (d) keep `TOOL_GUIDELINE_RULES`' hard-coded sentence match instead of registry guidelines — the third-party-tool guideline case must fail.

6. **`fix(pi-subagents): drop the hard-coded sub-agent context block`** Remove the `bridge` const and its concatenation; update the docstring; flip the seven test assertions.
   *Killing mutation:* re-add the block — the `not.toContain("<sub_agent_context>")` cases must fail.

7. **`docs: record that the inherited region is shared parts, not shared bytes`** Both ADRs (ADR 0008 in `pi-subagents`, ADR 0014 in `pi-permission-system`), [ADR-0006]'s amendment note, both packages' `configuration.md`, `architecture.md` (including Step 18's `✅` and `Landed:` note), `README.md`, and both skill files.
   Verify: the cross-cutting greps above return no stale hits; `pnpm exec rumdl check` clean; `find .rumdl_cache -type f -delete` first, since files are renamed in step 5.

## Risks and Mitigations

| Risk                                                                                                                                          | Mitigation                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The `pi-claude-bridge` claim (the relocated block falls outside its matching key) is inferred from [#884]'s thread, not read from the matcher | Read `pi-claude-bridge`'s `findInheritedPrompts` before step 7's ADR asserts it; if it matches on the full prompt rather than the tail-stripped one, the ADR records the interaction as unverified rather than claiming compatibility |
| A user with their own `SYSTEM.md` now gets an `Available tools:` block Pi never wrote them                                                    | Accepted and documented in `configuration.md`; the alternative (gate on `customPrompt` absence) breaks the child case, which is a `customPrompt`                                                                                      |
| Every `pi-permission-system` user's tool list moves to the end of the prompt                                                                  | Intended and unavoidable — the every-node argument above. Called out in the changelog-facing commit subject: the list is *stated per session*, not narrowed in place                                                                  |
| Pi reorders or reworders its preamble, breaking the removal anchors                                                                           | The removal degrades safely: an unmatched section is left in place and the rendered block still appends, so the prompt is redundant rather than wrong. Today's failure mode is the same shape                                         |
| `guidelinesByTool` is empty because `getAll()` returns a shape the reader does not recognize                                                  | The reader is `unknown`-tolerant like `getToolNameFromValue`; step 1's tests cover the three known shapes, and an unrecognized shape yields Pi's unconditional bullets rather than an empty section                                   |
| The predicted post-change prefix numbers are wrong                                                                                            | They are predictions, labeled as such; step 5 measures rather than assumes                                                                                                                                                            |

## Open Questions

- Where a shared render function should live if [#901] is taken up — a small shared package, or an export one package consumes from the other, given `pi-subagents` has zero knowledge of `pi-permission-system` by design.
- Whether a prompt-composer package is the right long-term home for prompt layout across all four extensions that edit this string (ADR 0014 records the direction; no issue filed).
- Whether [#884]'s `portable` strategy should become the default once [pi-claude-bridge#89] lands — [#884]'s own disposition question, unchanged by this plan.

[#180]: https://github.com/gotgenes/pi-packages/issues/180
[#237]: https://github.com/gotgenes/pi-packages/issues/237
[#239]: https://github.com/gotgenes/pi-packages/issues/239
[#385]: https://github.com/gotgenes/pi-packages/issues/385
[#400]: https://github.com/gotgenes/pi-packages/issues/400
[#801]: https://github.com/gotgenes/pi-packages/issues/801
[#815]: https://github.com/gotgenes/pi-packages/issues/815
[#873]: https://github.com/gotgenes/pi-packages/issues/873
[#883]: https://github.com/gotgenes/pi-packages/issues/883
[#884]: https://github.com/gotgenes/pi-packages/issues/884
[#890]: https://github.com/gotgenes/pi-packages/issues/890
[#901]: https://github.com/gotgenes/pi-packages/issues/901
[ADR-0006]: ../../packages/pi-subagents/docs/decisions/0006-inherited-prompt-is-identity-only.md
[pi-claude-bridge#88]: https://github.com/elidickinson/pi-claude-bridge/issues/88
[#89]: https://github.com/elidickinson/pi-claude-bridge/issues/89
