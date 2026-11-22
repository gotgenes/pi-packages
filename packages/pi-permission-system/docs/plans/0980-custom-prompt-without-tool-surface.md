---
issue: 980
issue_title: "pi-permission-system: do not synthesize <tools> and <rules> when Pi uses a custom system prompt"
---

# Leave an operator's custom system prompt without an appended tool surface

## Release Recommendation

**Release:** ship independently

Issue #980 is not a step in the package's architecture roadmap, so it carries no `Release:` batch tag.
The change is breaking (see Goals), so the release it dispatches is a major bump.

## Problem Statement

When an operator supplies their own system prompt (`.pi/SYSTEM.md`, `~/.pi/agent/SYSTEM.md`, or `--system-prompt`), Pi deliberately writes no tool list and no rules: its `buildSystemPromptSections` fills `tools`, `rules`, and `docs` only in the non-`customPrompt` branch.
This package still appends its own `<tools>`/`<rules>` block (or `Available tools:`/`Guidelines:` through pi 0.85) after Pi's cwd layer.
The operator's prompt then ends with sections Pi intentionally omitted, and the only way to stop that today is to disable the extension.

[#919] and [#932] fixed the *removal* half of the same pass: a custom prompt's own text is now preserved.
They deliberately kept the *append*, and recorded "standing aside" as a Non-Goal to revisit "only if duplication is reported again as a problem in its own right".
This issue is that report.

## Goals

- A root session whose prompt Pi built from `systemPromptOptions.customPrompt` receives **no** tool-surface block: the prompt the skill filter sees is `event.systemPrompt` as Pi built it.
- A detected subagent child keeps today's behavior: its block is rendered at the tail, because every `@gotgenes/pi-subagents` child is also a `customPrompt` session and the block is its only tool prose.
- A session on Pi's default prompt keeps today's relocation, unchanged.
- In every case, active-tool filtering (`setActive`), skill filtering, and `tool_call` enforcement run exactly as before.

This is a **breaking change**.
`docs/configuration.md` documents that a custom prompt "is shown alongside this session's block", and a `SYSTEM.md` user's outgoing prompt changes on upgrade without any edit on their side.
The behavior commit is `feat(pi-permission-system)!:` with a `BREAKING CHANGE:` footer.

## Non-Goals

- **Suppressing the block in subagent children too.**
  Raised at the planning gate: a child cannot tell from its own `before_agent_start` whether its root's operator wrote a custom prompt, so a full override needs either a cross-node "root is operator-authored" signal or a config switch.
  The operator chose to wait for user feedback and **not** file an issue yet.
- **An opt-in setting that restores the block for custom prompts.**
  Suggested by the issue; declined at the gate (mechanism is forever, and nobody has asked for it).
- **Changing `renderToolSurface` or its removal boundaries.**
  `src/exposure/tool-surface-prompt.ts` is unchanged: the pass is still correct for every prompt it is handed; only which nodes call it changes.
- **Changing tool exposure or enforcement.**
  `shouldExposeTool`, `resolveExposedTools`, and the gates are untouched.
- **[#901]'s `pi-subagents`-side writer.**
  If that writer ever renders a block in a root node, it is subject to the same standing-aside question; that belongs to [#901]'s plan.

## Background

### Pi's two branches

Pi's `buildSystemPromptSections` (read at `../../pi/packages/coding-agent/src/core/system-prompt.ts`) sets `preamble = customPrompt` and skips `tools`, `rules`, and `docs` when `customPrompt` is truthy.
It writes `addendum`, `project_context`, `skills`, and `cwd` in both branches.
The through-0.85 shape behaves the same way ([#919]'s plan read it in the pinned 0.79.1 dist).

### Every subagent child is a `customPrompt` session

`packages/pi-subagents/src/lifecycle/create-subagent-session.ts:251` builds the child's loader with `systemPromptOverride: () => cfg.systemPrompt`.
In the pinned `@earendil-works/pi-coding-agent@0.79.1`, `dist/core/resource-loader.js:329` turns that into `ResourceLoader.systemPrompt`, and `dist/core/agent-session.js:645` passes it as `customPrompt`; Pi `main` does the same (`agent-session.ts:1389`).
So the one-line branch the issue sketches would strip the block from every child.
ADR 0014 names that case as the reason the block is rendered from parts: "a child's inherited identity carries no tool section to narrow, because its parent's node already relocated it".

### The node-role signal already exists

`SubagentDetection` (`src/authority/subagent-detection.ts`) is the package's single owner of "is this node a subagent child", constructed once in `src/index.ts` (line ~88) and today consumed only by `AuthorizerSelection`.
`isSubagent(ctx)` checks, in order: the process-global `SubagentSessionRegistry` (an in-process child is registered on `subagents:child:session-created`, before `bindExtensions()`), the `SUBAGENT_ENV_HINT_KEYS` env vars, and the subagent session directory.
Its docstring warns that a UI root can answer `true` when a spawner exported a parent-session marker; for this consumer that error keeps today's behavior (see Design Overview).

### Other writers of the prompt

`@gotgenes/pi-subagents` composes a child's prompt (its inherited identity is cut at the skills catalogue, ahead of the tail block), and `pi-anthropic-auth` reshapes the payload at the transport layer after every `before_agent_start` handler.
Neither writes a tool surface at a root node, so standing aside there removes nothing another party relies on.
Open PR [#908] (OMP prompt arrays) edits `before-agent-start.ts` and `tool-surface-prompt.ts` too; it serves a different concern and is not a close target, but it will need a rebase.

## Design Overview

### The decision

Only a node that states its own tool surface renders a block:

```ts
// AgentPrepHandler.handle, replacing the unconditional renderToolSurface call
const toolSurfacePrompt = this.statesOwnToolSurface(event, ctx)
  ? renderToolSurface(event.systemPrompt, { /* unchanged inputs */ })
  : event.systemPrompt;

private statesOwnToolSurface(event: BeforeAgentStartPayload, ctx: ExtensionContext): boolean {
  // Pi's own `if (customPrompt)` truthiness: an empty string is no custom prompt.
  return !event.systemPromptOptions?.customPrompt || this.detector.isSubagent(ctx);
}
```

`piAuthoredPreamble: !event.systemPromptOptions?.customPrompt` stays as it is: when the pass runs for a child, removal above the cwd layer stays off.

`AgentPrepHandler` gains a sixth constructor dependency, `detector: SubagentDetector` (the existing single-method interface), passed `subagentDetection` in `src/index.ts`.
Six positional dependencies match the file's siblings (`SessionLifecycleHandler` takes seven), and the Tidy-First assessor declined reshaping this one constructor alone.
`handlers/` already may import `authority/` (`fallow guard` on `before-agent-start.ts`), and the import is type-only.

### Scenarios

| Node                                                                      | `customPrompt` | `isSubagent`  | Result                                                                                             |
| ------------------------------------------------------------------------- | -------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| Root, Pi's default prompt                                                 | absent or `""` | not consulted | Relocation, unchanged                                                                              |
| Subagent child                                                            | set            | `true`        | Block rendered, head untouched (unchanged)                                                         |
| Root, operator's custom prompt                                            | set            | `false`       | **No block**; `event.systemPrompt` goes to the skill filter as-is                                  |
| Root misread as a child (env hint exported by a spawner)                  | set            | `true`        | Block rendered: today's behavior                                                                   |
| Child nobody detected (no registry entry, env hint, or session-dir match) | set            | `false`       | No block: Pi's native `customPrompt` behavior; the API `tools` array still lists the child's tools |

Both detection errors land on a behavior that already exists, so the predicate's burden is low: a `false` here means "leave the prompt as Pi built it", never "allow something".

### What the handler returns

With no block and no denied skill, the skill filter returns the prompt unchanged and the handler returns `{}`, as it did before ADR 0014 for any unedited prompt.
Pi then keeps its own base prompt, which is the same text, so the wire prompt is stable across turns.
With a denied skill, the filtered prompt differs and is returned as an override every turn, as today ([#437]).

## Module-Level Changes

| File                                                      | Change                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/handlers/before-agent-start.ts`                      | `AgentPrepHandler` constructor gains `detector: SubagentDetector`; `handle` renders the tool surface only when `statesOwnToolSurface(event, ctx)`; the `BeforeAgentStartPayload.customPrompt` doc comment and the class docstring (which says the surface is relocated in every node) describe the root custom-prompt exception.                                                 |
| `src/index.ts`                                            | Pass `subagentDetection` to `new AgentPrepHandler(...)` (line ~341).                                                                                                                                                                                                                                                                                                             |
| `test/handlers/before-agent-start.test.ts`                | `makeSetup` gains an `isSubagentChild?: boolean` option backed by a `SubagentDetector` fake (default `false`), threaded into the single constructor call; the existing custom-prompt tests are retargeted and new root cases added (see TDD Order).                                                                                                                              |
| `test/composition-root.test.ts`                           | New end-to-end case: a root and a registered in-process child, both firing `before_agent_start` with `customPrompt`.                                                                                                                                                                                                                                                             |
| `docs/decisions/0014-tool-surface-is-node-local-prose.md` | Rewrite the "Accepted residual: a prompt Pi built from a `customPrompt` still receives this session's block" bullet as resolved, and add an "Amendment in `[#980]`" bullet: a root node under a custom prompt renders no block, a subagent child still does, and the "always returns an override" statement no longer holds for that root. Add `[#980]` to the link definitions. |
| `docs/architecture/architecture.md`                       | Line ~949 `before-agent-start.ts` entry: add `detector` to the dependency list and the root custom-prompt exception. Line ~1005 `tool-surface-prompt.ts` entry: the "relocation must run in every node" constraint becomes every node whose prompt pi authored and every subagent child, with a root node under a custom prompt rendering none.                                  |
| `docs/configuration.md`                                   | Line ~1251 `before_agent_start` hook-table row, and the relocation bullet at line ~1266: a custom system prompt receives no tool list or rules (matching Pi), while a subagent child still does, and tool filtering and enforcement are unchanged.                                                                                                                               |

Predicted unchanged, with the claim each rests on:

- `src/exposure/tool-surface-prompt.ts`: the pass is not edited, and its docstrings stay accurate for every prompt it is still handed (a child's, or a root misread as a child).
- `test/exposure/tool-surface-prompt.test.ts`: it exercises the pass directly with an explicit `piAuthoredPreamble`, so node role never reaches it.
- `src/authority/subagent-detection.ts`: gains a consumer, and its interface is unchanged.
- Existing `before_agent_start` cases in `test/composition-root.test.ts`: every fake payload there omits `customPrompt` (checked by `grep -n customPrompt test/composition-root.test.ts`, no hits), so the detector is never consulted.
- `.pi/skills/package-pi-permission-system/SKILL.md`: its prompt-pass bullet defers to the architecture doc and ADR 0014 and does not state the every-node rule (checked by grep for `relocat` and `every node`; the latter's two hits concern service publication).
- `README.md` and `docs/subagent-integration.md`: neither names the tool surface or a custom prompt (checked by grep for `custom prompt`, `SYSTEM.md`, `tool surface`, and `relocat`).

## Test Impact Analysis

1. New tests the change enables: root-versus-child behavior under `customPrompt`, which had no seam before because the handler never consulted node role.
2. Redundant tests: none.
   `states the session's tools when Pi built the prompt from a custom one` keeps its content and is retargeted to the child role, which is the case its comment already describes.
3. Tests that stay as-is: every `AgentPrepHandler` case without `customPrompt` (the Pi-default relocation, tool filtering, skill filtering on every turn), and the whole `tool-surface-prompt.test.ts` suite.

`keeps a custom system prompt's own tool and guideline sections` runs as a child after this change.
The pass now runs over a `customPrompt` prompt only in a child, so a root would return `{}`, and the test's `result.systemPrompt?.startsWith(custom)` would fail on `undefined`.
The child whose inherited identity is a user's `SYSTEM.md` is exactly the case where that preservation still matters.

## Invariants at risk

| Invariant                                                         | Source                                           | Constituency                            | Pinned by                                                                                                               | Holds because                                                                                                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A child's inherited identity stays byte-identical to its parent's | [#890]; ADR 0014                                 | Local prefix-reusing inference ([#180]) | `the prefix a subagent child shares with its parent` (two tests, `tool-surface-prompt.test.ts`)                         | The parent's head was already untouched under a custom prompt (`piAuthoredPreamble: false`); the change only drops the tail block, which lies past the region `inheritedIdentity` copies. |
| Every subagent child states its own tools                         | ADR 0014, "The block is always rendered"; [#919] | Children with a narrowed tool set       | The retargeted handler test and the new composition-root child case                                                     | The child role keeps the render call.                                                                                                                                                     |
| A Pi-default root still has Pi's surface relocated                | ADR 0014                                         | Every default-prompt user               | Existing handler cases without `customPrompt` (e.g. `states the allowed tools instead of editing the listing Pi wrote`) | `!customPrompt` short-circuits to the render call.                                                                                                                                        |
| Skill filtering is reapplied every turn                           | [#437]                                           | Operators with a denied skill           | New root custom-prompt skill case plus the existing `filters a denied skill from the systemPrompt on every turn`        | The skill filter still consumes the (now unrendered) prompt.                                                                                                                              |
| Tool filtering is restrict-only and still applied                 | [#385], [#873]                                   | Every user                              | New root custom-prompt `setActive` case                                                                                 | `setActive` runs before the prompt decision, unconditionally.                                                                                                                             |

## TDD Order

1. **`feat(pi-permission-system)!: stop appending a tool list and rules to an operator's custom system prompt`** Test surface: `test/handlers/before-agent-start.test.ts` and `test/composition-root.test.ts`; source `src/handlers/before-agent-start.ts` and `src/index.ts`.
   The Tidy-First assessor's one Recommended tidying is folded in here: a detector seam in `makeSetup`.
   It cannot land as its own commit, because `AgentPrepHandler` has no parameter to receive it until this step adds one, and an injected-but-unread dependency would trip the unused-member lint.
   - `makeSetup({ isSubagentChild })`: a `SubagentDetector` fake, `{ isSubagent: vi.fn(() => isSubagentChild ?? false) }`, passed as the sixth constructor argument.

   - New `describe("under a custom system prompt")` holding:
     - **root, returned as Pi built it**: `customPrompt` set, `toolSnippets: { read: … }`, active `["read"]`, no skills; `expect(result).toEqual({})`.
     - **root, tools still filtered**: `bash` fully denied; `toolRegistry.setActive` called with `["read"]`, and `result` is `{}`.
     - **root, skills still filtered**: a prompt carrying an `<available_skills>` entry for a denied skill; `result.systemPrompt` omits that skill and contains neither `Available tools:` nor `<tools>`.
     - **child, block still rendered**: the existing `states the session's tools when Pi built the prompt from a custom one`, run with `isSubagentChild: true` and renamed to name the child.
     - **child, custom sections kept**: the existing `keeps a custom system prompt's own tool and guideline sections`, run with `isSubagentChild: true`.
     - **empty `customPrompt` reads as none**: root, `customPrompt: ""`, a Pi-authored `Available tools:` prompt; the block is rendered, as on Pi's default prompt.

   - `test/composition-root.test.ts`, new `describe("tool-surface prose under a custom system prompt")`: through the real factory, a root node (`makeBaseCtx`) firing `before_agent_start` with `customPrompt` and a `read` snippet returns `{}`.
     A child registered with `getSubagentSessionRegistry().register(childSessionId, { parentSessionId })` (`makeChildCtx`), firing the same payload, returns a `systemPrompt` containing `- read: Read file contents`.
     The file's existing `beforeEach` already clears `SUBAGENT_ENV_HINT_KEYS`, so the root is not misread as a child.

   - Killing mutations:
     - Make `statesOwnToolSurface` return `true` unconditionally → the three root cases and the composition-root root case go red; the child and empty-string cases stay green.
     - Make `statesOwnToolSurface` return `!event.systemPromptOptions?.customPrompt` (drop the detector) → both child cases and the composition-root child case go red.
     - Replace `!event.systemPromptOptions?.customPrompt` with `event.systemPromptOptions?.customPrompt === undefined` → the empty-string case goes red.
     - In `src/index.ts`, pass `{ isSubagent: () => false }` instead of `subagentDetection` → only the composition-root child case goes red (the handler tests use their own fake), which is what proves the wiring is pinned.
     - In the stand-aside branch, `return {}` before the skill filter → the root skills case goes red.

   - Commit body ends with the `BREAKING CHANGE:` note, then `Refs #980`, then the trailers as the final paragraph:

     ```text
     BREAKING CHANGE: a session whose system prompt comes from `.pi/SYSTEM.md`, `~/.pi/agent/SYSTEM.md`, or `--system-prompt` no longer has this package's tool list and rules appended, matching Pi, which writes none under a custom prompt. Subagent children, and sessions on Pi's default prompt, are unchanged; tool filtering and enforcement are unchanged everywhere.

     Refs #980

     Co-authored-by: Tony Wong <27016195+tonybro233@users.noreply.github.com>
     Co-authored-by: yofri <24536844+yofriadi@users.noreply.github.com>
     ```

     Both reporters proposed the `customPrompt` branch this step adopts, with a subagent-child guard added: tonybro233 in Issue #980 and yofriadi in [#919].
     Verify with `git interpret-trailers --parse`.

   - Run `pnpm run check` after this step (constructor signature change).
2. **`docs(pi-permission-system): record that a custom system prompt gets no appended tool surface`** `docs/decisions/0014-tool-surface-is-node-local-prose.md`, `docs/architecture/architecture.md`, and `docs/configuration.md`, as listed in Module-Level Changes.
   No tests; verify with `pnpm exec rumdl check` on the three files and a re-read for split sentences.

## Risks and Mitigations

| Risk                                                                                                | Mitigation                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `SYSTEM.md` user relied on the appended block as the only statement of a policy-narrowed tool set | Breaking-change footer and the `docs/configuration.md` update; the API `tools` array is the model's authoritative list either way (ADR 0014), and an operator can name their tools in their own prompt. |
| A root is misread as a child (a spawner exported a parent-session marker)                           | It keeps today's behavior, which is the documented pre-change state, not a new one.                                                                                                                     |
| A child spawned by something the detector cannot see loses its block                                | It gets Pi's native `customPrompt` behavior; the registry covers `@gotgenes/pi-subagents`, env hints cover the known process-based spawners, and the session-dir heuristic covers the rest.             |
| A future [#901] writer re-adds a block at a root under a custom prompt                              | Recorded in Non-Goals; this package's tail removal is not applied at a standing-aside root, so it would neither fight nor duplicate that writer.                                                        |
| PR [#908] conflicts in the same two files                                                           | Noted in Background; the PR needs a rebase whenever it is taken, independent of this change.                                                                                                            |

## Open Questions

- Whether users want the block suppressed in children too.
  Deferred until someone asks; no issue filed, by operator decision.

[#180]: https://github.com/gotgenes/pi-packages/issues/180
[#385]: https://github.com/gotgenes/pi-packages/issues/385
[#437]: https://github.com/gotgenes/pi-packages/issues/437
[#873]: https://github.com/gotgenes/pi-packages/issues/873
[#890]: https://github.com/gotgenes/pi-packages/issues/890
[#901]: https://github.com/gotgenes/pi-packages/issues/901
[#908]: https://github.com/gotgenes/pi-packages/pull/908
[#919]: https://github.com/gotgenes/pi-packages/issues/919
[#932]: https://github.com/gotgenes/pi-packages/issues/932
