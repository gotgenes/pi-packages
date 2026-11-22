---
issue: 360
issue_title: "fix(pi-subagents): custom agents default to replace mode instead of append"
---

# Custom agents default to append prompt mode

## Problem Statement

Custom agents loaded from `.pi/agents/*.md` (and the global agents directory) default to `replace` prompt mode when no `prompt_mode` frontmatter key is present, while built-in agents default to `append`.
This asymmetry surprises users: a custom agent with no explicit `prompt_mode` silently drops the parent system prompt (AGENTS.md, skills, project conventions) and instead shows the bare replace-mode header. @jeffutter reported this in [#180 (comment)](https://github.com/gotgenes/pi-packages/issues/180#issuecomment-4644369646) — their `researcher` agent rendered `"You are a pi coding agent sub-agent."` instead of inheriting the parent prompt.

The root cause is the ternary in `src/config/custom-agents.ts` line 65:

```typescript
promptMode: fm.prompt_mode === "append" ? "append" : "replace",
```

Any value other than the literal `"append"` — including `undefined` (key omitted) — falls through to `replace`.

## Goals

- Custom agents without an explicit `prompt_mode` frontmatter key default to `append`, matching the built-in default in `agent-types.ts`.
- Only `prompt_mode: replace` (explicit opt-in) selects replace mode.
- Update tests and user-facing documentation to reflect the new default.

This is a **breaking change**: any existing `.pi/agents/*.md` that omits `prompt_mode` flips from `replace` to `append` on upgrade, so those agents begin inheriting the parent system prompt (AGENTS.md / CLAUDE.md / skills) where they previously did not.
The behavior change is triggered purely by upgrading, with no config edit — it warrants a `fix!:` commit and a `BREAKING CHANGE:` footer so release-please cuts a major version.
Users who relied on the old implicit-`replace` behavior must add `prompt_mode: replace` explicitly to restore it.

## Non-Goals

- No change to built-in agents (`default-agents.ts`): `Explore` and `Plan` keep their explicit `promptMode: "replace"`, `general-purpose` keeps `append`.
- No change to the prompt-assembly logic in `src/session/prompts.ts` — only the default a custom agent resolves to changes.
- No change to other frontmatter field defaults or parsers.

## Background

- `src/config/custom-agents.ts` — `loadFromDir` parses each `.md` file's frontmatter into an `AgentConfig`.
  Line 65 is the only place a custom agent's `promptMode` is decided.
- `src/config/agent-types.ts:118` — the built-in absolute-fallback config uses `promptMode: "append"`.
- `src/session/prompts.ts:36` — `buildAgentPrompt` branches on `config.promptMode === "append"`; append mode threads the parent system prompt (AGENTS.md / CLAUDE.md) into the child, replace mode does not.
- The field-parser convention documented at the top of the parser section of `custom-agents.ts` is "omitted → default, none/empty → nothing, value → exact".
  Today `prompt_mode` violates the spirit of "omitted → default" by mapping omitted to `replace` rather than the system default `append`.
  This fix aligns it.

Constraint from AGENTS.md: this is the `pi-subagents` package — Biome handles formatting, the upstream vitest suite is a regression canary, and all tests must pass before publishing.

## Design Overview

Flip the ternary so `replace` requires an explicit opt-in and everything else (including omitted) defaults to `append`:

```typescript
promptMode: fm.prompt_mode === "replace" ? "replace" : "append",
```

Decision table for the resolved `promptMode`:

| `prompt_mode` frontmatter value | Before  | After   |
| ------------------------------- | ------- | ------- |
| omitted / `undefined`           | replace | append  |
| `replace`                       | replace | replace |
| `append`                        | append  | append  |
| unknown (e.g. `merge`)          | replace | append  |

Unknown values now resolve to `append` rather than `replace`.
This is the safer fallback: an append-mode agent inherits the parent prompt (a superset), so a typo degrades to "inherits everything" rather than "silently drops project context".

No type shape changes — `promptMode` remains `"replace" | "append"` (`src/types.ts`).

## Module-Level Changes

- `src/config/custom-agents.ts` (line 65) — flip the ternary to `fm.prompt_mode === "replace" ? "replace" : "append"`.
- `src/ui/agent-creation-wizard.ts` (line 106) — update the inline frontmatter doc comment: `Default: replace` → `Default: append` for `prompt_mode`.
  The surrounding guidelines (lines 117–118) already describe both modes correctly and need no change.
- `README.md` (line 187) — change the `prompt_mode` default column from `` `replace` `` to `` `append` ``.
  Keep the cell's behavioral description of `replace`/`append` unchanged.
- `test/config/custom-agents.test.ts` — update the two tests that assert the old default (see TDD Order).

No architecture-doc references to the default value were found (`docs/architecture/` describes module layout, not field defaults).
`CHANGELOG.md` is owned by release-please and is not edited.

## Test Impact Analysis

This is a behavior fix, not an extraction, so no new test layers are enabled and no tests become redundant.
Existing tests in `test/config/custom-agents.test.ts` directly exercise the changed line and must be updated to assert the new default:

1. `"uses sensible defaults when frontmatter is empty"` — empty frontmatter currently asserts `promptMode` is `"replace"`; must become `"append"`.
2. `"defaults unknown prompt_mode to replace"` — feeds `prompt_mode: merge` and asserts `"replace"`; must be renamed to `"defaults unknown prompt_mode to append"` and assert `"append"`.
3. `"loads a basic agent with all frontmatter fields"` (explicit `prompt_mode: replace`) and `"handles prompt_mode: append"` — both pass an explicit value and stay as-is; they pin the explicit-opt-in behavior.
4. `"uses sensible defaults when no frontmatter at all"` (the `bare` agent) does not currently assert `promptMode` — add an assertion that it resolves to `"append"` to lock the no-frontmatter path.

## TDD Order

1. Red → Green: update default-mode tests in `test/config/custom-agents.test.ts`.
   - Change the empty-frontmatter test to expect `promptMode` `"append"`.

   - Rename the unknown-mode test to `"defaults unknown prompt_mode to append"` and expect `"append"`.

   - Add a `promptMode` assertion (`"append"`) to the no-frontmatter (`bare`) test.

   - These fail against the current line 65, then pass after the source fix.

   - Apply the one-line fix in `src/config/custom-agents.ts` in the same cycle (the test file and source are coupled — the type checker and assertions move together).

   - Commit (breaking — include the footer):

     ```text
     fix(pi-subagents)!: default custom agents to append prompt mode (#360)

     BREAKING CHANGE: Custom agents in .pi/agents/*.md that omit the
     prompt_mode frontmatter key now default to append instead of replace,
     so they inherit the parent system prompt (AGENTS.md / CLAUDE.md /
     skills). Add `prompt_mode: replace` explicitly to restore the previous
     standalone-prompt behavior.
     ```

2. Docs: update user-facing default documentation.
   - `src/ui/agent-creation-wizard.ts` — `prompt_mode` `Default: replace` → `Default: append`.
   - `README.md` — `prompt_mode` default cell → `` `append` ``.
   - Commit: `docs(pi-subagents): note custom agents default to append prompt mode (#360)`.

(Optional: steps 1 and 2 may be combined into a single `fix!:` commit since the doc updates are part of the same behavioral correction; keeping them split keeps the source/test change isolated from prose.
If combined, the `BREAKING CHANGE:` footer lives on the single commit.)

## Risks and Mitigations

- Risk: existing users rely on the old implicit-`replace` behavior for custom agents that omit `prompt_mode`.
  Mitigation: append mode is a superset (it inherits the parent prompt plus the agent body); the worst case is an agent that now sees more context than before, not less.
  Users who genuinely want a standalone prompt can add `prompt_mode: replace` explicitly.
  The issue frames the old behavior as a bug, and the maintainer authored it.
- Risk: the upstream vitest regression canary asserts the old default somewhere.
  Mitigation: `grep` confirms the only default-asserting tests are in `test/config/custom-agents.test.ts`; run `pnpm --filter @gotgenes/pi-subagents run test` to confirm the full suite stays green.

## Open Questions

None.
The issue's proposed fix is unambiguous and the change surface is fully enumerated above.
