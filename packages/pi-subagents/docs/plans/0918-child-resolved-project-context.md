---
issue: 918
issue_title: "pi-subagents-worktrees: `<project_context>`'s inherited `path=\"...\"` attribute defeats worktree isolation, the same way #640's footer did"
---

# Resolve a relocated child's project context against its own directory

## Release Recommendation

**Release:** ship independently

No roadmap step references [#918] — it was filed by a third party against the shipped package and has not been adopted into Phase 22.
The change lands as `fix(pi-subagents):`, an unhidden changelog type, so it cuts a patch release on its own.
Nothing batches with it: the only other open prompt-assembly work ([#901], [#904]) is unstarted and independent.

## Problem Statement

A child whose `WorkspaceProvider` gave it its own directory — a `pi-subagents-worktrees` worktree, or any other isolated workspace — still adopts its parent's `<project_context>` block verbatim, including each context file's `path="<parent's absolute cwd>/AGENTS.md"` attribute.

The child's prompt therefore states two incompatible locations for itself: an early, machine-structured absolute path naming the parent's checkout, and a later `Working directory: <own worktree>` in the per-session header Pi and this package rebuild for it.
The reporter observed 5 background children across 2 waves on real multi-step tickets; 4 of 5 resolved the conflict by trusting the inherited path, prefixing every shell call with `cd <parent checkout> &&`, and committing into the shared parent checkout.
The 5th, on a stronger model, stayed in its assigned worktree.
Nothing surfaced an error in either case, and each child's assigned workspace sat unused.

This is the same class of defect as [#640] (the inherited `Current working directory:` footer) and [#801] (the inherited skills catalogue), found in the one per-session layer those two changes left in place.

## Goals

- A workspace-relocated child's prompt carries no absolute-path claim describing a directory other than its own.
- Such a child's project instructions come from **its own** directory, with paths that resolve there.
- A child whose workspace matches its parent's is byte-for-byte unaffected, so the shared leading prefix [ADR 0008] scopes to prefix-reusing hosts is preserved for the common case.
- A `prompt_mode: replace` agent's body keeps the final say in the assembled override.
- The [ADR 0009] `portable` strategy gets the same treatment, since it composes the parent's project context too.
- **Not breaking.**
  No public surface moves: no `SubagentsService` signature, no `SubagentRecord` field, no settings key, no `Workspace` seam field.
  The child-prompt content change follows the precedent of [#640] (`449078d0`) and [#801] (`610a4e9a`), both plain `fix:`, and the one case that loses guidance is recorded as an accepted residual in the new ADR rather than as a `BREAKING CHANGE:` footer.

## Non-Goals

- **Preserving the inherited block when the child's workspace resolves no context file of its own.**
  Settled at the clarification gate: such a child gets no project context.
  The residual and its remediation are recorded (see Risks) rather than mitigated with a fallback.
- **An opt-in escape hatch** (a settings key, or a `Workspace` seam field letting a provider hand the child the parent's instructions deliberately).
  Offered at the gate and declined: no known provider needs it, and [ADR 0002]'s no-vacant-hooks rule would refuse the seam field without a named consumer.
- **Widening the `WorkspaceProvider` seam.**
  `Workspace` stays `{ cwd, dispose() }` plus the result-side `resultAddendum`; the provider contributes no prompt text.
  This keeps the change single-package.
- **A correction note in the per-session header.**
  The gate chose removing the false claim over annotating it.
- **[#901]** (a child without `pi-permission-system` inherits the parent's `Available tools:` list) and **[#904]** (`genericBase` claims capabilities a read-only child lacks) are untouched.
  Both live in `src/session/prompts.ts` and neither is on this change's path.
- **A child with no inherited prompt at all** (the `genericBase` fallback) gains no project context; it has none today and this change does not give it one.
- **`pi-subagents-worktrees`** ships no code change.
  Its `pkg:` label on the issue is contextual — it supplies the diverged `cwd` and nothing else.

## Background

### Where the block comes from

Pi's `buildSystemPrompt` writes context files as

```text
<project_context>

Project-specific instructions and guidelines:

<project_instructions path="/absolute/path/AGENTS.md">
…
</project_instructions>

</project_context>
```

and writes that block **before** the skills catalogue and the `Current working directory:` footer, in both its branches (`../../pi/packages/coding-agent/src/core/system-prompt.ts:57,152`; confirmed identical in the pinned `@earendil-works/pi-coding-agent@0.84.4` at `dist/core/system-prompt.js:20,105`).
Paths are absolute: `loadProjectContextFiles` resolves the cwd and the agent dir before reading (`core/resource-loader.ts:119`).

`inheritedIdentity` in `src/session/prompts.ts` cuts at the catalogue, or at the footer when the parent resolved no skills.
`<project_context>` precedes both, so it is inside the region a child adopts verbatim.
The child's own copy is suppressed — `create-subagent-session.ts:250` passes `noContextFiles: true` — so nothing corrects the inherited one.

### What triggers it

`Subagent.execute()` asks `WorkspaceBracket.prepare()` for a workspace (`src/lifecycle/subagent.ts:334`); a returned `cwd` reaches `createSubagentSession` as `params.cwd` and becomes `effectiveCwd` in `assembleSessionConfig` (`src/session/session-config.ts:120`).
`assembleSessionConfig` is the only module holding both the parent's `ctx.cwd` and the child's `effectiveCwd`, and it passes both to `buildAgentPrompt`.
Any provider that relocates a child hits this, not only worktrees.

### What it costs to change the bytes

Measured by rendering the pinned SDK's `buildSystemPrompt` over this repo's own `AGENTS.md` (one context file, four built-in tools, no skills):

| Span                                  | Chars  |
| ------------------------------------- | ------ |
| Inherited identity (to the footer)    | 58,529 |
| Preamble before `<project_context>`   | 2,083  |
| The `<project_context>` block         | 56,446 |
| Offset of the first `path=` attribute | 2,151  |

Every treatment that changes bytes inside the block — stripping the attribute, remapping it, cutting the block — diverges the child at the same offset.
So a relocated child's shared prefix goes **58,529 → 2,083 chars** under any of them, and the choice among them is not a cost question.
A child whose workspace matches its parent's pays nothing, because nothing about its prompt changes.

### Constraints that apply

- [ADR 0006] cuts every layer Pi resolves per session, and rejected *excision* of an interior span because it displaces the tail past the divergence point.
  Cutting `<project_context>` here is **truncation**, not excision: the catalogue and footer are already gone, so nothing survives past the new cut point.
- [ADR 0006] also withdrew [#640]'s equal-cwd exception, on the ground that the footer sits *after* the catalogue cut and the exception therefore preserved nothing.
  That reasoning does not reach this layer, which sits *before* the cut: a cwd-conditional cut here preserves 58,529 shared characters for every non-relocated child.
  The condition is re-introduced for the case the old one could not serve, not restored wholesale.
- [ADR 0008] forbids an extension **editing** the inherited region in place, because the parent keeps its copy and every child's prefix ends at the edit.
  Cutting a trailing span of the child's own adopted identity is the relocation that ADR prescribed, not the edit it refused.
- [ADR 0009]'s portable identity is composed at snapshot time from the parent's captured parts, so it embeds the parent's project context with the parent's paths (`src/lifecycle/parent-snapshot.ts:88,111`).
- `AGENTS.md` § Reading this repo's own artifacts: `buildSystemPrompt` is **not** exported from `@earendil-works/pi-coding-agent` (checked the pinned `package.json` `exports` and `dist/index.d.ts`), so no test can pin our renderer against Pi's real one.
  `loadProjectContextFiles` **is** exported (`dist/index.d.ts:17`) and is synchronous.

## Design Overview

### The rule

> A child resolves its project context against **its own** directory whenever the identity it adopts does not already describe that directory.

Concretely, inside `buildAgentPrompt`:

```ts
const suppliesOwnProjectContext =
  inherited !== undefined &&
  (inherited.strategy === "portable" || cwd !== inherited.cwd);
```

- `full` + same cwd → nothing changes.
  The inherited block is accurate, stays byte for byte, and the prefix is untouched.
- `full` + diverged cwd → the inherited block is cut with the rest of the session-resolved tail, and the child's own is rendered in its place.
- `portable` → the parent's block is no longer composed into the portable identity at all (see below), so the child's own is always supplied.

A child with no inherited prompt (`genericBase`) is out of scope and unchanged.

### Where the cut lands

`inheritedIdentity` gains a flag and one more anchor.
The existing `sessionResolvedTailStart` already computes the catalogue-or-footer index; when the flag is set, it walks back from there:

```ts
function projectContextStartBefore(lines: readonly string[], tailAt: number): number {
  let closeAt = tailAt - 1;
  while (closeAt >= 0 && lines[closeAt] === "") closeAt--;
  if (closeAt < 0 || lines[closeAt] !== PROJECT_CONTEXT_CLOSE) return -1;
  for (
    let openAt = lines.lastIndexOf(PROJECT_CONTEXT_OPEN, closeAt);
    openAt !== -1;
    openAt = lines.lastIndexOf(PROJECT_CONTEXT_OPEN, openAt - 1)
  ) {
    if (lines[openAt + 2] === PROJECT_CONTEXT_LEAD_IN) return openAt;
  }
  return -1;
}
```

The blank-line skip is required by Pi's own separators: the block ends `</project_context>\n`, and the next layer opens with `\n\n` (catalogue) or `\n` (footer), so one or two empty lines sit between them.

This keeps the module's established discipline of identifying Pi's own markup **by position** rather than by document order ([ADR 0006] § The catalogue is located by position, not by document order): the close tag is found relative to the already-anchored tail, and the opening line is accepted only when the lead-in sentence sits two lines below it, so a context file quoting `<project_context>` is not mistaken for the real opening.

A parent prompt carrying neither catalogue nor footer is already returned unchanged today; that stays true, and the project-context cut does not run for it.

### Where the child's block goes

`buildAgentPrompt` places it between the identity and the per-call header, which is where Pi put the parent's:

```text
<identity, cut before <project_context>>

<project_context>              ← the child's own, its own absolute paths
…
</project_context>

<active_agent name="…"/>

# Environment
Working directory: <the child's own>
…

<agent body: <agent_instructions> in append mode, bare in replace mode>
```

Keeping Pi out of it is what preserves `prompt_mode: replace`'s final say.
Setting `noContextFiles: false` would have produced the same content, but Pi appends context files **after** `systemPromptOverride` (`core/system-prompt.js:19`), which would move a relocated `Explore`/`Plan` child's body off the end.
`noContextFiles: true` stays.

Byte-exactness against Pi's renderer is not required on this path and is not claimed: a relocated child shares no prefix past the cut, so the block only has to be well formed.
That is also why the treatment is **conditional** — rendering every child's block ourselves would make every non-relocated child's prefix depend on a replica that no test can pin against the real `buildSystemPrompt`.

### How the block reaches the builder

The existing `AssemblerIO` is the injection seam (`src/session/session-config.ts:35`).
It gains one member, and `buildAgentPrompt` one optional trailing parameter:

```ts
export interface AssemblerIO {
  buildAgentPrompt: (
    config: AgentPromptConfig,
    cwd: string,
    env: EnvInfo,
    inherited?: InheritedPrompt,
    loadProjectContext?: ProjectContextLoader,
  ) => string;
  /** The `<project_context>` block for a directory, or undefined when it resolves none. */
  loadProjectContext: ProjectContextLoader;
}

/** Renders the project-context block a session in `cwd` would carry. */
export type ProjectContextLoader = (cwd: string) => string | undefined;
```

The loader takes the cwd as an argument rather than being bound per spawn, so the composition root wires it once:

```ts
// src/index.ts, beside the existing assemblerIO entry
assemblerIO: {
  buildAgentPrompt,
  loadProjectContext: (cwd) =>
    renderProjectContext(loadProjectContextFiles({ cwd, agentDir: getAgentDir() })),
},
```

`assembleSessionConfig` relays `io.loadProjectContext` into `io.buildAgentPrompt` without inspecting it; the decision of whether to call it stays in `prompts.ts`, next to the cut it pairs with, so the divergence rule has exactly one statement in the codebase.
The call is lazy by construction: a non-relocated `full` child never invokes it, so the common path does no file IO.

`getAgentDir()` is a pure global-config-dir lookup, independent of the factory's existing call order.

### Portable inheritance

`buildPortablePrompt` (`src/lifecycle/parent-snapshot.ts:88`) composes custom prompt + append prompt + the parent's project context at spawn time, before any child cwd exists.
The project-context section moves out of it:

```ts
export interface ParentPromptOptions {
  customPrompt?: string;
  appendSystemPrompt?: string;
}
```

`ParentSnapshot.portablePrompt` then carries the operator-authored **text** parts only, and `adoptedIdentity` appends the child's own project-context block after them — the same position Pi composes it in, and the same position the `full` path uses.

Three consequences, all intended:

1. A non-relocated portable child's prompt is unchanged in content: `loadProjectContextFiles(childCwd)` returns exactly what the parent's capture held, rendered by the same function that rendered it before.
2. A relocated portable child gets its own paths, which is the bug fixed on the second strategy.
3. A portable child whose parent has run no turn (no capture) falls back to `genericBase` **plus** its own project context, where today it gets `genericBase` alone.
   [ADR 0009]'s fail-safe is about never silently re-embedding Pi's base preamble; a project-context block is not that, and giving the child its own instructions is strictly better than withholding them.
   The ADR is amended to say so.

### Observability

`loadProjectContextFiles` returns the global `~/.pi/agent/AGENTS.md` when present, then walks the child's cwd and every ancestor, accepting `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD` (`core/resource-loader.ts:71,119`).
An empty result therefore means all three of those turned up nothing — a real possibility for a sandbox workspace, and invisible today.

`renderProjectContext` returning `undefined` for a relocated child emits a debug note.
`src/debug.ts` currently exposes only `debugLog(context, err)`, which wants an error; it gains a sibling:

```ts
export function debugNote(message: string): void {
  if (isDebug()) console.warn(`[pi-subagents:debug] ${message}`);
}
```

The note names the cwd that resolved nothing.
It fires only on the path that asks for a child's own block, so a non-relocated child logs nothing.

### Call-site sketch

```ts
// src/session/session-config.ts — assembleSessionConfig
const systemPrompt = io.buildAgentPrompt(
  agentConfig,
  effectiveCwd,
  env,
  { systemPrompt: ctx.parentSystemPrompt, cwd: ctx.cwd, strategy, portablePrompt: ctx.parentPortablePrompt },
  io.loadProjectContext,
);
```

The assembler relays one collaborator to another and reads neither — Tell-Don't-Ask holds, and no new fact is derived in two places.

## Module-Level Changes

| File                                                             | Change                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/session/project-context.ts`                                 | **New.** Exports `renderProjectContext(files)` (moved verbatim from `parent-snapshot.ts`) and the `ProjectContextLoader` type; emits the `debugNote` when a directory resolves no files.                                                                              |
| `src/session/prompts.ts`                                         | `buildAgentPrompt` gains the optional `loadProjectContext` parameter, the `suppliesOwnProjectContext` rule, and the block placement; `inheritedIdentity`/`sessionResolvedTailStart` gain the cut flag; new `projectContextStartBefore` plus the three line constants. |
| `src/session/session-config.ts`                                  | `AssemblerIO` gains `loadProjectContext`; `assembleSessionConfig` relays it.                                                                                                                                                                                          |
| `src/lifecycle/parent-snapshot.ts`                               | `renderProjectContext` moves out; `ParentPromptOptions.contextFiles` removed; `buildPortablePrompt` composes two sections instead of three.                                                                                                                           |
| `src/debug.ts`                                                   | New `debugNote(message)`; the module doc widens past "silenced catch blocks".                                                                                                                                                                                         |
| `src/index.ts`                                                   | Wires `loadProjectContext` into the `assemblerIO` literal, importing `loadProjectContextFiles` from `@earendil-works/pi-coding-agent`.                                                                                                                                |
| `src/runtime.ts`                                                 | No signature change — it stores `ParentPromptOptions`, whose field set narrows. Listed because its doc comment describes the captured parts.                                                                                                                          |
| `test/session/project-context.test.ts`                           | **New.** Direct format tests for the renderer, lifted from `parent-snapshot.test.ts`.                                                                                                                                                                                 |
| `test/session/prompts.test.ts`                                   | `parentPrompt()` fixture gains a `contextFiles` layer; new cut/placement/portable cases.                                                                                                                                                                              |
| `test/session/session-config.test.ts`                            | `mockIO` gains `loadProjectContext`; a relay assertion.                                                                                                                                                                                                               |
| `test/lifecycle/parent-snapshot.test.ts`                         | The two `contextFiles` tests move out; `{ contextFiles: [] }` at line 79 becomes `{}`.                                                                                                                                                                                |
| `test/lifecycle/create-subagent-session.test.ts`                 | Line 434/440's `portablePrompt: "<project_context>…</project_context>"` fixture stays valid as an opaque string, but is retargeted to an operator-authored part for honesty.                                                                                          |
| `test/helpers/subagent-session-io.ts`                            | `assemblerIO` stub gains `loadProjectContext`.                                                                                                                                                                                                                        |
| `test/helpers/subagent-session-io.test.ts`                       | `expect(Object.keys(io.assemblerIO)).toEqual(["buildAgentPrompt"])` (line 24) and the header at line 21 must admit the second member — an **exact** assertion, so it fails loudly.                                                                                    |
| `test/composition-root.test.ts`                                  | Lines 396–405 assert the snapshot's `portablePrompt` contains `<project_instructions path="/repo/AGENTS.md">`; that moves to the wiring of `assemblerIO.loadProjectContext`.                                                                                          |
| `docs/decisions/0010-project-context-is-directory-resolved.md`   | **New ADR**, amending [ADR 0006] the way [ADR 0008] does: what is cut, under what condition, what replaces it, and the accepted residual.                                                                                                                             |
| `docs/decisions/0006-inherited-prompt-is-identity-only.md`       | Status line gains "amended by 0010"; the region table's Identity row splits `<project_context>` out.                                                                                                                                                                  |
| `docs/decisions/0009-portable-inheritance-is-provider-scoped.md` | Line 48 (composition order) and line 60 ("Context files are **included**, and load-bearing") are now false; both restated, plus the `genericBase` fallback consequence at line 98.                                                                                    |
| `docs/configuration.md`                                          | The layer table's `Pi preamble, project context` row (line 30) splits; the `WorkspaceProvider` paragraph (lines 37–39) gains project context and the author-facing contract (put instructions in the workspace, an ancestor, or the global agent dir).                |
| `README.md`                                                      | Line 397's "everything Pi assembled ahead of the skills catalogue" needs the relocated-child qualifier; the § `Extensions that append to the system prompt` list at lines 406–413 is checked for the same.                                                            |
| `docs/architecture/architecture.md`                              | Module-tree entries for `prompts.ts` (line 348) and `parent-snapshot.ts` (line 370); a `project-context.ts` row under Session; the Session domain's module count 12 → 13 (also in `.pi/skills/package-pi-subagents/SKILL.md`'s table) and the 68-file total.          |
| `.pi/skills/package-pi-subagents/SKILL.md`                       | "context files must be [inherited], because the child's loader runs `noContextFiles: true`" is now false; the inheritance paragraph and the Session-domain row change.                                                                                                |

Predicted **unchanged**, listed because they are in the blast radius:

- `src/lifecycle/create-subagent-session.ts` — `noContextFiles: true` stays and no IO member is added to `EnvironmentIO`; the loader takes its cwd as an argument, so the composition root binds nothing per spawn.
  The rationale comment at lines 240–247 is re-read but should still hold.
- `src/lifecycle/workspace.ts`, `src/lifecycle/subagent.ts`, `packages/pi-subagents-worktrees/**` — the seam is unchanged, so the provider side has nothing to do.
- `dist/public.d.ts` — `ParentSnapshot`/`ParentPromptOptions` are reached only from `src/service/service-adapter.ts`, which the rollup does not roll (`rollup.dts.config.mjs` entries are `src/service/service.ts` and `src/layered-settings.ts`).
  `pnpm run verify:public-types` confirms.

## Test Impact Analysis

**Enabled by the extraction.**
`renderProjectContext` has no direct tests today — its byte-exactness is asserted through `buildParentSnapshot`'s composed `portablePrompt` (`test/lifecycle/parent-snapshot.test.ts:83–108`).
Once it has a second caller, one caller's composition test no longer covers it.
A direct `test/session/project-context.test.ts` pins the format for both.

**Becoming redundant.**
The two `contextFiles`-bearing portable tests in `parent-snapshot.test.ts` lose their input; the format half moves to the new file and the composition half (`orders the parts the way Pi composes them`) shrinks to custom + append.

**Must stay as-is.**
`describe("shared prefix with the parent")` and `describe("the assembled child prompt")` in `prompts.test.ts` exercise exactly the layer this change touches and are the regression net for the equal-cwd case.

**New surface.**
The `parentPrompt()` fixture (line 406) composes `identity` → `skills` → `footerCwd` → `extensionTail` with Pi's real separators, and reads the catalogue heading back from Pi's own `formatSkillsForPrompt` rather than copying it.
It has no project-context layer, so the cut tests would otherwise each hand-roll a string.
The layer is added in the same style, rendered through the extracted `renderProjectContext` and wrapped with Pi's `\n\n…\n` separators, so the fixture keeps matching `buildSystemPrompt`'s real output.

## Invariants at risk

| Invariant                                                                                             | Pinned by                                                                                                                   | Standing after                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A child opens with the parent's identity **verbatim** in both prompt modes ([ADR 0008], Step 18)      | `prompts.test.ts` `describe("shared prefix with the parent")`, two tests asserting `prompt.startsWith(IDENTITY_WITH_TOOLS)` | Holds for an equal-cwd child, which is the constituency [#180] named. Deliberately does **not** hold for a relocated child — a new test asserts the narrower claim there (opens with the preamble, carries no parent path). The existing tests gain a project-context-bearing case with equal cwds. |
| Exactly one skills catalogue and one `Current working directory:` claim ([ADR 0006], Step 5 / [#801]) | `prompts.test.ts` `describe("the assembled child prompt")`, three tests                                                     | Unaffected — the new cut is strictly earlier than the ones they assert about, and the tests assert absence.                                                                                                                                                                                         |
| A portable child carries none of Pi's base preamble ([ADR 0009], [#883])                              | `prompts.test.ts` `describe("portable inheritance")` → `carries none of Pi's base preamble`                                 | Holds. The composition change moves a section; it adds no Pi text.                                                                                                                                                                                                                                  |
| An unusable portable capture falls back to `genericBase`, never to the full prompt ([ADR 0009])       | `prompts.test.ts` `describe("fail-safe when the capture is unusable")`, two tests                                           | Holds for the no-Pi-base property. The tests are amended for the third consequence above: the fallback prompt may now carry the child's own project context, and must still not contain `pi packages (docs/packages.md)`.                                                                           |
| `genericBase` claims no write/exec capability ([#904], Step 20)                                       | Not yet landed — [#904] is open                                                                                             | Untouched; this change never edits `genericBase`.                                                                                                                                                                                                                                                   |

Quantitative, measured at planning time with the pinned SDK over this repo's `AGENTS.md` (command in Background):

| Case                      | Shared prefix now | Predicted after                        |
| ------------------------- | ----------------- | -------------------------------------- |
| Child at the parent's cwd | 58,529 chars      | 58,529 chars (byte-for-byte unchanged) |
| Relocated child           | 58,529 chars      | 2,083 chars                            |

The first row is the one a regression would hide, which is why the `shared prefix with the parent` tests gain a project-context-bearing case rather than being left as they are.

## TDD Order

Steps 1–3 are the Tidy-First assessor's accepted preparatory commits; they change no behavior.

1. **`refactor(pi-subagents): give the project-context renderer a shared home`** Move `renderProjectContext` from `src/lifecycle/parent-snapshot.ts` into a new `src/session/project-context.ts` and export it; `parent-snapshot.ts` imports it.
   Prepares: three later steps call this function, and moving it in the same commit as a behavior change would hide the move in the diff.
   Verification is the existing `parent-snapshot.test.ts` staying green.

2. **`test(pi-subagents): unit-test the project-context renderer directly`** New `test/session/project-context.test.ts`: the byte-exact format assertions (lead-in sentence, blank-line separation, `path=` attribute), lifted from `parent-snapshot.test.ts:83–108`; the composition-order tests stay where they are.
   Prepares: the renderer gains callers whose own tests would not cover its format.
   *Killing mutation:* drop the `Project-specific instructions and guidelines:` lead-in from the renderer — the new format tests go red, and no existing test does.

3. **`test(pi-subagents): give the parent-prompt fixture a project-context layer`** `parentPrompt()` in `prompts.test.ts` gains `contextFiles?: Array<{ path; content }>`, rendered through `renderProjectContext` and inserted with Pi's separators (`"\n\n" + block + "\n"`) between `identity` and `skills`.
   Add one test using it that must pass **before** any behavior change: a child at the parent's cwd opens with the full identity including the block.
   Prepares: every later step's tests need a positionally-correct block.
   *Killing mutation:* insert the layer after `skills` instead of before — the new test goes red, because the cut anchors would then find the block past the tail.

4. **`fix(pi-subagents): stop a relocated child inheriting its parent's project-context paths`** `inheritedIdentity`/`sessionResolvedTailStart` gain the cut flag; `projectContextStartBefore` is added; `buildAgentPrompt` sets the flag when `cwd !== inherited.cwd` under a non-portable strategy.
   Tests: the block and its `path=` attribute are absent for a relocated child in both modes; present, byte for byte, for an equal-cwd child; the cut survives a parent that resolved no skills (footer anchor); a context file quoting `<project_context>` on its own line does not move the cut; a parent prompt with neither catalogue nor footer is still returned unchanged.
   *Killing mutations:* (a) make `sessionResolvedTailStart` ignore the project-context anchor and return the catalogue/footer index unconditionally — every relocated-child absence test goes red; (b) drop the `cwd !== inherited.cwd` guard so the cut is unconditional — the equal-cwd verbatim tests and the `shared prefix with the parent` tests go red; (c) drop the blank-line skip in `projectContextStartBefore` — the cut never fires, same reds as (a); (d) accept any `<project_context>` line without the lead-in check — the quoted-block test goes red.

5. **`fix(pi-subagents): give a relocated child its own project instructions`** `ProjectContextLoader`; the optional fifth parameter on `buildAgentPrompt` and the matching `AssemblerIO` member; the relay in `assembleSessionConfig`; placement between identity and header; `debugNote` in `src/debug.ts` and the empty-result note; the `src/index.ts` wiring with `loadProjectContextFiles`; the `assemblerIO` stub in `test/helpers/subagent-session-io.ts` and its exact-keys assertion.
   Tests: a relocated child's prompt carries a `<project_context>` naming **its own** path; the loader is **not** called when the cwds agree; the agent body is still the last section in replace mode; a relocated child whose directory resolves nothing carries no project context and logs the debug note; the composition root wires a loader that reads the child's cwd.
   *Killing mutations:* (a) call the loader unconditionally — the not-called-when-equal test goes red; (b) place the block after the agent body instead of before the header — the body-last test goes red; (c) return `""` instead of `undefined` for an empty file list — the no-block test goes red (and a bare truthiness check would pass, which is the point of asserting on the rendered output rather than on the call).

6. **`fix(pi-subagents): resolve a portable child's project context against its own directory`** `ParentPromptOptions.contextFiles` removed; `buildPortablePrompt` composes custom + append; `adoptedIdentity` appends the child's own block for `portable` regardless of divergence; `parent-snapshot.test.ts`, `runtime.test.ts`, `composition-root.test.ts`, and `create-subagent-session.test.ts` fixtures updated in the same commit — removing an interface field breaks its constructors at compile time.
   Tests: a relocated portable child's identity names its own path and not the parent's; a non-relocated portable child's prompt is unchanged from today's composed output; the `carries none of Pi's base preamble` guarantee still holds; the no-capture fallback is `genericBase` plus the child's own block, with no Pi base text.
   *Killing mutation:* keep composing `renderProjectContext(options.contextFiles)` inside `buildPortablePrompt` — the relocated portable child then carries two blocks, one with the parent's path, and both the own-path and no-parent-path assertions go red.

7. **`docs(pi-subagents): record project context as a directory-resolved layer`** New ADR 0010; the amendment lines in ADRs 0006 and 0009; `docs/configuration.md`'s layer table and `WorkspaceProvider` paragraph, including the author-facing remediation; the `README.md` qualifier; the architecture module tree, the Session count, and the file total; the package skill's inheritance paragraph and domain table.
   Verification: `pnpm exec rumdl check packages/pi-subagents`, and a grep for the stale claims this plan names (`noContextFiles: true` in the skill's inheritance paragraph, `byte for byte` in the configuration table row).

## Risks and Mitigations

- **A relocated child in a workspace with no context file of its own loses its project instructions.**
  Today it inherits the parent's — wrong path, accurate content.
  Accepted at the gate and recorded as an accepted residual in ADR 0010, following [ADR 0006]'s own precedent for the extension tail ("wrong rather than merely absent").
  The blast radius is narrower than it reads: the loader also returns the global `~/.pi/agent/AGENTS.md` and walks every ancestor of the child's cwd, so all three must come up empty.
  `pi-subagents-worktrees` is unaffected — `git worktree add` checks out tracked files.
  The real case is a gitignored `AGENTS.md`, or a provider handing a child a bare sandbox.
  Mitigated by the debug note (step 5) and the `docs/configuration.md` contract for provider authors (step 7); no fallback and no escape hatch, both declined at the gate.
- **The cut anchor misfires and a relocated child keeps the parent's block, silently.**
  The anchor is positional and doubly guarded (close tag adjacent to the already-anchored tail, lead-in sentence two lines under the opening).
  Step 4 names four killing mutations covering each guard, and the fixture (step 3) renders the block through the same function Pi's layout was replicated from.
- **The cut fires on an equal-cwd child and silently ends the shared prefix for everyone.**
  This is the expensive failure — 56 KB per child on the hosts [#180] serves — and `tsc` and a green suite would both miss it.
  Killing mutation (b) in step 4 exists for exactly this, and the `shared prefix with the parent` tests gain a project-context-bearing case so they can see it at all.
- **`prompt_mode: replace`'s final say is lost.**
  Avoided by construction: the block is placed inside the override, and `noContextFiles` stays `true`, so Pi appends nothing new.
  Pinned by the body-last test in step 5 and by mutation (b) there.
- **Pi changes its `<project_context>` markup and the anchor stops matching.**
  Then a relocated child keeps the inherited block — the status quo, not a new failure.
  The fixture renders through our own replica, so an upstream change would not fail these tests; that is a known limitation of every anchor in this module, and `buildSystemPrompt` is not exported to test against.
  ADR 0010 records it.
- **Reading context files on every relocated spawn adds IO to the assembly path.**
  Synchronous, a handful of `existsSync` calls plus one or two reads, on a path that already awaits `detectEnv`'s shell calls.
  Not measured; the loader is not called at all for a non-relocated child.

## Open Questions

- Whether the operator adopts [#918] as a Phase 22 step (the precedent is [#903], a third-party bug adopted as Step 21).
  Nothing in this plan depends on the answer; if it is adopted, `/tdd-plan` also lands the `✅` step-mark and `Landed:` note.

[#180]: https://github.com/gotgenes/pi-packages/issues/180
[#640]: https://github.com/gotgenes/pi-packages/issues/640
[#801]: https://github.com/gotgenes/pi-packages/issues/801
[#883]: https://github.com/gotgenes/pi-packages/issues/883
[#901]: https://github.com/gotgenes/pi-packages/issues/901
[#903]: https://github.com/gotgenes/pi-packages/issues/903
[#904]: https://github.com/gotgenes/pi-packages/issues/904
[#918]: https://github.com/gotgenes/pi-packages/issues/918
[ADR 0002]: ../decisions/0002-extensions-on-a-minimal-core.md
[ADR 0006]: ../decisions/0006-inherited-prompt-is-identity-only.md
[ADR 0008]: ../decisions/0008-inherited-region-is-shared-parts.md
[ADR 0009]: ../decisions/0009-portable-inheritance-is-provider-scoped.md
