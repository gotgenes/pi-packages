---
issue: 400
issue_title: "perf(pi-subagents): include parent system prompt in replace mode for KV cache reuse"
---

# Include parent system prompt in replace mode for KV cache reuse

## Problem Statement

In replace mode, `buildAgentPrompt()` discards the parent system prompt entirely and substitutes a thin two-line header (`"You are a pi coding agent sub-agent. / You have been invoked to handle a specific task autonomously."`).
Replace-mode agents therefore lose the core identity, tool-usage guidelines, and AGENTS.md context the parent carries, and they share no prompt prefix with the parent or with each other — defeating LLM KV cache reuse.
The `parentSystemPrompt` parameter is already passed into `buildAgentPrompt()` but the replace branch ignores it.

## Goals

- Place the parent system prompt (or `genericBase` when no parent is available) at the front of the replace-mode prompt as a shared, cacheable prefix.
- Order the replace-mode prompt as: parent/`genericBase` → `<active_agent>` tag → env block → `config.systemPrompt`.
- Preserve the distinguishing feature of replace mode: it injects neither the `<sub_agent_context>` bridge nor the `<agent_instructions>` wrapper — the custom prompt keeps full control of the agent's instructions, placed last so it has the final say.
- Apply the change uniformly to every replace-mode agent, including the built-in `Explore` and `Plan` agents.
- This is a **breaking change**: replace-mode agents (including `Explore`/`Plan` and any custom `prompt_mode: replace` agent) now inherit the parent system prompt on upgrade with no user edit, and the thin two-line header is removed.
  Ship it as `perf!:` with a `BREAKING CHANGE:` footer.

## Non-Goals

- No change to append-mode assembly (already reordered for KV cache in [#180]).
- No change to how `parentSystemPrompt` is sourced — `create-subagent-session.ts` already passes `snapshot.systemPrompt` through `session-config.ts`.
- No new mode or flag to distinguish "replace with parent" from "replace without parent" — the operator confirmed the change applies uniformly, so `Explore`/`Plan` are not special-cased.
- No change to `pi-permission-system` — its `<active_agent>` tag parsing is a full-string regex search, position-independent.
- No change to `pi-anthropic-auth` — its OAuth shaping is unaffected (see Background).

## Background

`buildAgentPrompt()` in `packages/pi-subagents/src/session/prompts.ts` assembles the child system prompt.
The append branch was reordered in [#180] (shipped in `pi-subagents-v6.18.3`) to place shared/stable content first; the parent prompt is placed verbatim (no wrapper tag) so it forms an identical byte prefix with the parent session, maximising KV cache hits.
The replace branch was left untouched and still emits the thin header.

Current replace branch:

```typescript
// "replace" mode — env header + the config's full system prompt
const replaceHeader = `You are a pi coding agent sub-agent.
You have been invoked to handle a specific task autonomously.

${envBlock}`;

return activeAgentTag + replaceHeader + "\n\n" + config.systemPrompt;
```

`const identity = parentSystemPrompt ?? genericBase;` currently lives inside the append branch.
`genericBase` (a `# Role` / general-purpose coding agent blurb) is the shared fallback.

### Cross-extension interaction — `pi-anthropic-auth` OAuth

The operator asked how the `genericBase` fallback interacts with `@gotgenes/pi-anthropic-auth`.
Findings from reading that package's `src/system-prompt-shaping.ts` and `src/request-shaping.ts`:

- The OAuth de-fingerprinting (`shapeAnthropicOAuthSystemPrompt`) only activates when the system prompt contains `PI_DEFAULT_PROMPT_PREFIX` (Pi's default expert-coding-assistant preamble); otherwise it returns the prompt untouched.
- The `x-anthropic-billing-header` system block is prepended **unconditionally** for every OAuth request (`prependBillingHeader`), independent of the base prompt content — this is the primary Claude Code billing signal.

Implications for this change:

- Normal case (parent present): replace mode places the parent prompt verbatim at the front, structurally identical to append mode, which already works under the OAuth transport wrapper.
  The inherited Pi preamble is de-fingerprinted exactly as it is for append-mode subagents and the main session today.
- `genericBase` fallback (only when the parent snapshot has no system prompt — effectively never in real sessions, since `parentSystemPrompt` is a required `string` at the `session-config` layer): `genericBase` carries no Pi fingerprint, so the OAuth shaping no-ops and the billing header is still prepended.
  `genericBase` is already neutral, so nothing leaks.

Conclusion: #400 introduces no new OAuth interaction.
`genericBase` remains the correct fallback and stays consistent with append mode.

### Constraints from AGENTS.md

- This package carries a type-declaration bundle for its public API, but `buildAgentPrompt` is internal — no `dist/public.d.ts` or `exports` impact, so `verify:public-types` is not required for this change.
- Conventional Commits; do not edit `CHANGELOG.md` (release-please owns it).
- The `BREAKING CHANGE:` footer text is reused verbatim in the release-please CHANGELOG and the issue close comment — name only real surface (`prompt_mode: replace`).

## Design Overview

Hoist the `identity` resolution above the branch so both modes share it, then rewrite the replace branch.

```typescript
const activeAgentTag = `<active_agent name="${config.name}"/>\n\n`;
const envBlock = `# Environment\n...`;
const identity = parentSystemPrompt ?? genericBase;

if (config.promptMode === "append") {
  // ...unchanged...
}

// "replace" mode — shared parent prompt (or generic base) first for KV cache
// reuse, then the active_agent tag, env block, and the config's full system
// prompt. Unlike append mode, replace mode injects neither the
// <sub_agent_context> bridge nor the <agent_instructions> wrapper — the custom
// prompt keeps full control of the agent's instructions.
return identity + "\n\n" + activeAgentTag + envBlock + "\n\n" + config.systemPrompt;
```

Resulting replace-mode order (`activeAgentTag` already ends with `\n\n`):

```text
1. parentSystemPrompt (or genericBase)    ← SHARED, cacheable prefix
2. <active_agent name="${name}"/>         ← varies per agent
3. # Environment ...                      ← varies per runtime
4. config.systemPrompt                    ← custom instructions (full control)
```

This mirrors append mode's prefix-first ordering, minus the bridge and the `<agent_instructions>` wrapper.
The change is a pure single-function edit — no new collaborator, no new module, no interface change — so the design-review structural checklist (dependency width, Law of Demeter, extraction seams) does not apply.

### Edge cases

- Empty `config.systemPrompt` (e.g. a replace agent with no body): the prompt ends with a trailing `\n\n` after the env block.
  Acceptable and consistent with current behavior; no special-casing.
  `genericBase` only substitutes on a nullish parent (the `??` operator), so an empty-string parent prompt is preserved as-is, matching append mode.

## Module-Level Changes

### `packages/pi-subagents/src/session/prompts.ts`

1. Hoist `const identity = parentSystemPrompt ?? genericBase;` from the append branch to before the `if (config.promptMode === "append")` check so both branches use it.
2. Replace the replace-branch `replaceHeader` template and return statement with the new ordering (`identity` → `activeAgentTag` → `envBlock` → `config.systemPrompt`); remove the thin two-line header.
3. Update the JSDoc summary: replace-mode bullet becomes "parent system prompt (or generic base) + active_agent tag + env header + config.systemPrompt; no bridge, no agent_instructions wrapper," and update the trailing note about tag position (it is included, not prepended, in either mode).

### `packages/pi-subagents/test/session/prompts.test.ts`

See Test Impact Analysis and TDD Order for the specific test changes.

### `packages/pi-subagents/README.md`

1. Lines 119–120 — the `Explore` and `Plan` rows: revise the `replace` (standalone) framing, since replace mode now inherits the parent prompt as its base.
2. Line 187 — the `prompt_mode` frontmatter table: `replace` no longer means "no AGENTS.md / CLAUDE.md inheritance."
   Reword to describe the new semantics: replace inherits the parent prompt as the base, then the body takes full control (no `<sub_agent_context>` bridge, no `<agent_instructions>` wrapper), whereas append wraps the body and adds the bridge.
3. Line 494 (Patch 3, `<active_agent>` tag): change "prepends ... to every assembled child system prompt (both `replace` and `append` modes)" to "includes ... in every assembled child system prompt (both modes)" — the tag follows the cacheable parent prefix in both modes now, so "prepends" is inaccurate.

No `docs/architecture/` updates: the architecture doc references `prompts.ts` only as a one-line file listing (no prompt-assembly description, no complexity/health table entry tied to this change).

## Test Impact Analysis

This is a behavior change, not an extraction, so the extraction-specific questions are limited.

- New behavior to cover: replace mode now includes the parent prompt as a cacheable prefix; falls back to `genericBase` with no parent; still excludes the bridge and the `<agent_instructions>` wrapper.
- Existing replace-mode tests that assert the old behavior must change (they pin the removed thin header and the "ignores parent prompt" premise).
- `toContain`-based tests for cwd/git/env and the `genericBase` fallback remain valid where position-independent.
- No existing test becomes redundant beyond the ones being rewritten; no test must stay frozen for a layer being extracted (nothing is extracted).

Tests that change in `test/session/prompts.test.ts`:

1. `"replace mode uses config systemPrompt directly"` — asserts `toContain("You are a pi coding agent sub-agent")`; that header is removed.
   Rewrite to assert the config prompt is present and the thin header is gone.
2. `"replace mode ignores parent prompt"` — asserts the parent content is absent.
   The premise inverts: rename to `"replace mode includes parent prompt as base (no bridge/wrapper)"` and assert the parent content is present while `<sub_agent_context>` and `<agent_instructions>` are absent.
3. `"prepends <active_agent name=...> tag in replace mode"` — asserts `prompt.startsWith('<active_agent name="Explore"/>\n\n')`.
   The tag no longer leads (parent/`genericBase` does); rewrite to assert the tag appears after the identity prefix and before the env block.
4. `"active_agent tag appears before envBlock in both modes"` — the replace assertions pin `tagIdx === 0`.
   Update the replace assertions: the tag is no longer at index 0 but still precedes `# Environment`.
   The append assertions stay as-is.

## TDD Order

All test and source changes live in two files that the type checker links (the replace branch and its tests).
Each cycle is a single commit that leaves the suite green.

1. **Red: rewrite replace-mode behavioral tests.**
   Update tests 1–2 above to the new behavior (parent prompt included as base; thin header removed; no bridge/wrapper), and add a test for the `genericBase` fallback when no parent is supplied in replace mode, plus a test pinning the full order (`identity` → `<active_agent>` → `# Environment` → `config.systemPrompt`).
   These fail against the current implementation.
   Commit: `test: assert replace mode inherits parent prompt as cacheable prefix (#400)`

2. **Green: rewrite the replace branch.**
   Hoist `identity`, replace the `replaceHeader` block with the new ordering, remove the thin header, and update the JSDoc.
   Update the positional `<active_agent>` tests (3–4 above) in the same commit — they break at runtime the moment the branch changes.
   Commit body carries the `BREAKING CHANGE:` footer.
   Commit: `perf!: include parent system prompt in replace mode (#400)`

   ```text
   BREAKING CHANGE: replace-mode subagents (built-in Explore/Plan and any
   custom prompt_mode: replace agent) now inherit the parent system prompt as
   their base instead of a thin standalone header. The custom prompt is
   appended last and retains full control; the <sub_agent_context> bridge and
   <agent_instructions> wrapper are still omitted in replace mode.
   ```

3. **Docs: update README replace-mode semantics.**
   Apply the three README edits (Explore/Plan rows, `prompt_mode` table, Patch 3 `<active_agent>` wording).
   Commit: `docs: describe replace-mode parent inheritance (#400)`

## Risks and Mitigations

| Risk                                                                                                                  | Mitigation                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Explore`/`Plan` behavior shifts — they now carry the full parent prompt plus their read-only specialist instructions | Operator confirmed uniform application; specialist instructions are placed last so they have the final say; existing read-only assertions (`READ-ONLY`, `file search specialist`) still hold via `toContain`. |
| `pi-permission-system` depends on `<active_agent>` tag position                                                       | Tag parsing is a full-string regex search; position-independent (same basis as [#180]).                                                                                                                       |
| `pi-anthropic-auth` OAuth shaping breaks with the new base                                                            | No new interaction — billing header is prepended unconditionally; de-fingerprinting keys off `PI_DEFAULT_PROMPT_PREFIX` and `genericBase` is already neutral (see Background).                                |
| A custom replace agent relied on the clean-slate (no parent) behavior                                                 | Documented as breaking in the `BREAKING CHANGE:` footer and README; this aligns with the expectation reported in the issue ([@jeffutter] expected the parent identity to be present).                         |
| Stale README claims that replace = no inheritance                                                                     | README edits in cycle 3 correct lines 119–120, 187, and 494.                                                                                                                                                  |

## Open Questions

None — the three design decisions (breaking classification, `genericBase` fallback, uniform application to built-ins) were resolved with the operator before planning.

[#180]: https://github.com/gotgenes/pi-packages/issues/180
[@jeffutter]: https://github.com/jeffutter
