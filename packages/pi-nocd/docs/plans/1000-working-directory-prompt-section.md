---
issue: 1000
issue_title: "pi-nocd: returning a forced `systemPrompt` drops Pi 0.99.2's `<mcp_servers>` section"
---

# Write the working-directory block as a `systemPromptOptions` section

## Release Recommendation

**Release:** ship independently

pi-nocd has no architecture roadmap and no release batch, so this ships on its own.
It is a major release: the peer floor moves to Pi 1.0.0.

## Problem Statement

pi-nocd's `before_agent_start` handler returns `{ systemPrompt }` on every turn.
`ExtensionRunner.emitBeforeAgentStart` stores a returned string as `forceSystemPrompt`, and `buildSystemPromptState` then sends that string as the whole prompt with no sections.
Pi's `builtin:mcp` lists `codemode`/`deferred` MCP servers by adding `sections.mcp_servers` from its own handler.
Built-in extensions load after file extensions, so that edit always lands on a prompt pi-nocd has already frozen.
The server connects but the model is never told it exists, and nothing errors.

The defect is not specific to MCP: any section any later handler adds is dropped the same way.

## Goals

- Never return `systemPrompt` from `before_agent_start`.
  Write the block by assigning `event.systemPromptOptions.sections.working_directory`, so sections later handlers add reach the provider.
- Drop the `# Working Directory` heading: the section's content is the single instruction sentence, and Pi wraps it in `<working_directory>` tags as it does its own sections.
- Delete the string-editing machinery the section makes unnecessary: `ensureWorkingDirectoryPrompt`, `findOurBlock`, `BLOCK_LINE_COUNT`, and the `WORKING_DIRECTORY_HEADING` export.
- Raise the peer floor to `@earendil-works/pi-coding-agent >=1.0.0` and develop against 1.0.0.
- **Breaking** (`fix(pi-nocd)!:`): a host older than Pi 1.0.0 is no longer supported, the block's rendered shape changes (tagged section after `<cwd>`, no heading), and an earlier handler that forces the prompt now drops the block (see Risks).

## Non-Goals

- Fixing other extensions that force the prompt.
  `@eko24ive/pi-ask` 1.2.0 returns `systemPrompt` on every run and hides `<mcp_servers>` the same way; that is eko24ive/pi-ask#16.
- Any change to pi-subagents' source.
  Its `inheritedIdentity` cut already drops everything from `<skills>`/`<cwd>` onward, which now carries this guarantee; this plan only adds a test pinning it for a tagged extension section.
- Owning or suppressing another source's `# Working Directory` text.
  The section path never reads prompt text, so a foreign block is neither rewritten nor treated as a reason to skip ours.
- Editing `docs/plans/0640-*.md` or `docs/plans/0775-evidence/pi-nocd.md`, which name the removed symbols as history.

## Background

- `packages/pi-nocd/src/index.ts` registers the one handler, returning `{ systemPrompt: ensureWorkingDirectoryPrompt(event.systemPrompt, ctx.cwd) }`.
- `packages/pi-nocd/src/working-directory-prompt.ts` builds the block (heading, blank line, sentence) and edits it into a prompt string: idempotency on the exact block, in-place rewrite of a stale block of ours naming another directory ([#640], via `findOurBlock`), and suppression when a foreign `# Working Directory` heading is present.
- Pi 1.0.0 (`dist/core/extensions/runner.js`, `emitBeforeAgentStart`): every handler receives the same mutable `NormalizedBuildSystemPromptOptions` object as `event.systemPromptOptions`; `event.systemPrompt` is a getter rendering it.
  A returned `systemPrompt` sets `currentOptions.forceSystemPrompt`.
- Pi 1.0.0 (`dist/core/system-prompt.js`, `buildSystemPromptSections`): sections render as preamble, `tools`, `rules`, `docs`, `addendum`, `project_context`, `skills`, `cwd`, then each non-empty custom section in insertion order, each as `<name>\n${content}\n</name>`.
  A name must match `/^[a-z][a-z0-9_-]*$/` and must not be `preamble`, so `working_directory` is valid.
  `buildSystemPromptState` returns the forced string with no sections whenever `forceSystemPrompt` is set.
- `sections` exists from Pi 0.86.0 (checked in the 0.86.0 tarball's `system-prompt.d.ts` and `extensions/types.d.ts`); the floor goes to 1.0.0 at the operator's call, matching pi-permission-system ([#999], ADR 0015 in that package).
- pi-subagents' `inheritedIdentity` (`packages/pi-subagents/src/session/prompts.ts`) builds a child's identity from the parent's rendered prompt and cuts everything from `<skills>` (or `<cwd>`) onward.
  The child session binds its own extensions (`create-subagent-session.ts`), so the child's own pi-nocd writes a section naming the child's `ctx.cwd`.
- `@gotgenes/pi-anthropic-auth` shapes the prompt section by section and acts only on Pi's own `tools`/`rules`/`docs`; an unknown `working_directory` section passes through.
- AGENTS.md "Stale in-process extension code": a session running pi-nocd from source keeps the pre-change handler until Pi restarts, so the end-to-end check below runs in fresh `pi -p` processes.

## Design Overview

### Reproduction (measured, Pi 1.0.0, real CLI)

Each arm is a fresh `pi -p --approve --no-session -ne` in `/tmp/nocd-e2e/proj`, whose `.pi/mcp.json` configures one server (`probe-srv`, `command: /usr/bin/false`), with `-e builtin:mcp` and a `before_provider_request` probe that saves the payload and exits before sending.

| Arm                                            | `<mcp_servers>` | pi-nocd sentence |
| ---------------------------------------------- | --------------- | ---------------- |
| baseline (no pi-nocd)                          | 1               | 0                |
| + pi-nocd `main`                               | 0               | 1                |
| + spike assigning `sections.working_directory` | 1               | 1                |
| spike, then pi-ask 1.2.0                       | 0               | 1                |
| pi-ask 1.2.0, then spike                       | 0               | 0                |

The last two rows confirm the residual in Risks: a forcing handler earlier in the chain drops the section; one later in the chain chains onto a prompt that already renders it.

### Handler

```typescript
export default function piNocd(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event, ctx) => {
    event.systemPromptOptions.sections[WORKING_DIRECTORY_SECTION] =
      buildWorkingDirectoryPrompt(ctx.cwd);
  });
}
```

The handler assigns into the existing `sections` object rather than replacing it, so sections earlier handlers added survive.
It returns nothing.
Key assignment is idempotent, so the old idempotency check has nothing to guard.

### Block

`buildWorkingDirectoryPrompt(cwd)` returns only the sentence:

```text
Shell commands already execute in `<cwd>`. Never prefix a command with `cd` into the current working directory — neither `cd <cwd> &&` nor `cd $(pwd) &&`. Just run the command directly.
```

Pi renders it as:

```text
<cwd>
/repo
</cwd>

<working_directory>
Shell commands already execute in `/repo`. Never prefix … Just run the command directly.
</working_directory>
```

`WORKING_DIRECTORY_SECTION = "working_directory"` is exported from `working-directory-prompt.ts`; `index.ts` and the handler test import it.
`SENTENCE_PREFIX` loses its second reader (`findOurBlock`) and is inlined back into the template literal.

### Subagent interaction

For a parent in `/repo` and a child in `/repo-worktrees/issue-5`, the parent's `<working_directory>` section sits after `<cwd>`, so pi-subagents' cut drops it; the child's own pi-nocd writes one section naming `/repo-worktrees/issue-5`.
The child carries exactly one working-directory instruction, naming its own directory — the [#640] guarantee, now held by pi-subagents' cut instead of pi-nocd's rewrite.
This makes [#846]'s question (whether the rewrite branch stays) moot: the branch is deleted.

## Module-Level Changes

| File                                                     | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/pi-nocd/src/index.ts`                          | Handler assigns `sections[WORKING_DIRECTORY_SECTION]` and returns nothing; import changes from `ensureWorkingDirectoryPrompt` to `buildWorkingDirectoryPrompt` + `WORKING_DIRECTORY_SECTION`; module docstring rewritten (section, not appended string; Pi states the cwd in its `<cwd>` section, not a `Current working directory:` footer; no inherited-block rewrite).                                                                                                           |
| `packages/pi-nocd/src/working-directory-prompt.ts`       | Builder returns the sentence only; add `WORKING_DIRECTORY_SECTION`; delete `WORKING_DIRECTORY_HEADING`, `SENTENCE_PREFIX`, `BLOCK_LINE_COUNT`, `ensureWorkingDirectoryPrompt`, `findOurBlock`; module docstring rewritten likewise.                                                                                                                                                                                                                                                 |
| `packages/pi-nocd/test/working-directory-prompt.test.ts` | Delete the `ensureWorkingDirectoryPrompt` suite (including the `#640` inherited-block block); replace "starts with the heading marker" with an exact `toBe` on the whole sentence.                                                                                                                                                                                                                                                                                                  |
| `packages/pi-nocd/test/index.test.ts` (new)              | Handler tests via an inline `pi.on`-recording stub, following `pi-colgrep/test/extension.test.ts` and `pi-autoformat/test/extension.test.ts` (no shared helper exists).                                                                                                                                                                                                                                                                                                             |
| `packages/pi-nocd/package.json`                          | devDependency `@earendil-works/pi-coding-agent` `0.79.1` → `1.0.0`; peerDependency `>=0.75.0` → `>=1.0.0`.                                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm-lock.yaml`                                         | Updated by `pnpm install` with the devDependency bump (1.0.0 is already in the lockfile via pi-permission-system).                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/pi-subagents/test/session/prompts.test.ts`     | One test in `describe("pi ≥0.86 section shape")`: an extension section rendered after `<cwd>` is not inherited.                                                                                                                                                                                                                                                                                                                                                                     |
| `packages/pi-nocd/README.md`                             | "Why" (footer → `<cwd>` section; the block is a section), "What it injects" (tagged sample without heading; drop the idempotency/rewrite/foreign-heading paragraph), "How it works" table row, "Scope and non-goals" (drop the inherited-prompt path-resolution clause and the "Owning the heading" non-goal; state the Pi ≥1.0.0 requirement).                                                                                                                                     |
| `.pi/skills/package-pi-nocd/SKILL.md`                    | Upstream-assumption rows: replace the "flat string / returning `{ systemPrompt }`" row with one for `systemPromptOptions.sections` (runner shares one mutable options object; a forced prompt from an earlier handler drops sections); delete the `includes(block)` idempotency row; replace the `findOurBlock` row with one stating pi-subagents' cut drops sections after `<cwd>`; update the first row's cwd wording (footer → `<cwd>` section); revise the closing canary note. |

Predicted unchanged:

- `packages/pi-subagents/src/session/prompts.ts` — the cut is "everything from the tail anchor onward", so a section after `<cwd>` is already dropped (measured: the spike test in Test Impact passed against current source).
- `packages/pi-subagents/test/session/prompts.test.ts` existing tests using `"# Working Directory"` as `extensionTail` — they model a generic extension tail and stay valid.
- `packages/pi-nocd/CHANGELOG.md` — owned by the release script.

A grep of `ensureWorkingDirectoryPrompt|WORKING_DIRECTORY_HEADING|findOurBlock|BLOCK_LINE_COUNT` over `*.ts`/`*.md` outside `packages/pi-nocd/{src,test}` and `node_modules` found only the two historical `docs/plans/` files (Non-Goals) and the package skill's row (listed above).

## Test Impact Analysis

1. New tests enabled: `index.ts` has no test today; the handler's whole contract (section written, nothing returned, other sections untouched) becomes testable against a plain options object.
2. Redundant tests: the entire `ensureWorkingDirectoryPrompt` suite (7 tests) is deleted with the function.
3. Kept: `buildWorkingDirectoryPrompt`'s three content tests (literal path, literal `cd <cwd> &&`, `cd $(pwd) &&`); the heading test is replaced by an exact-equality test.

Planning spike for the pi-subagents pin (measured): a test asserting that `sectionParentPrompt({ skills, cwd: PARENT_CWD, extensionTail: "<working_directory>\nShell commands already execute in `/parent`.\n</working_directory>" })` yields a child prompt containing neither `<working_directory>` nor `` `/parent` `` passed on current source; making `inheritedIdentity` return `prompt` unchanged turned it red.

## Invariants at risk

| Invariant                                                                                     | Constituency                                                                 | Pin                                                                                                            |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| A subagent child carries one working-directory instruction, naming its own directory ([#640]) | pi-subagents users with workspace-isolated children (pi-subagents-worktrees) | New pi-subagents test (step 1) for the cut; new pi-nocd handler test (step 3) that the section names `ctx.cwd` |
| Sections earlier handlers wrote survive pi-nocd                                               | Any extension adding a section before pi-nocd runs                           | Handler test asserting a pre-existing `mcp_servers` entry is unchanged                                         |
| Sections later handlers write reach the provider                                              | `builtin:mcp` and any later section writer                                   | Handler test asserting the return is `undefined`; end-to-end check (step 5)                                    |

## TDD Order

1. **`test(pi-subagents): pin that an extension section after <cwd> is not inherited`**
   - Add the spiked test under `describe("pi ≥0.86 section shape")` in `packages/pi-subagents/test/session/prompts.test.ts`, with a name describing the behavior (e.g. "drops an extension section rendered after the cwd section").
   - Expected green on first run (invariant pin, measured at planning).
   - Killing mutation: insert `return prompt;` as the first statement of `inheritedIdentity` — the new test goes red.
2. **`build(pi-nocd): develop against Pi 1.0.0`**
   - devDependency `0.79.1` → `1.0.0`, `pnpm install`, commit `package.json` + `pnpm-lock.yaml` (and any `minimumReleaseAgeExclude` change in `pnpm-workspace.yaml`).
   - Peer floor unchanged in this step.
   - Verify: `pnpm --filter @gotgenes/pi-nocd run check` and the suite pass unchanged (predicted: `event.systemPrompt` and the `systemPrompt` return still type-check on 1.0.0).
3. **`fix(pi-nocd)!: keep prompt sections other extensions add, such as <mcp_servers>`**
   - Red: new `test/index.test.ts` with a `describe("before_agent_start")` holding:
     - writes `sections.working_directory` equal to `buildWorkingDirectoryPrompt(ctx.cwd)`;
     - returns `undefined`;
     - leaves a section already present (`mcp_servers: "…"`) unchanged (`toEqual` on the whole `sections` object).

   - Red: in `working-directory-prompt.test.ts`, replace the heading test with an exact `toBe` on the full sentence for `/srv/project`; delete the `ensureWorkingDirectoryPrompt` suite.

   - Green: the Handler and Block designs above; delete the removed symbols; rewrite both module docstrings; peerDependency → `>=1.0.0`.

   - Killing mutations:
     - restore `return { systemPrompt: … }` in the handler → the `undefined`-return test goes red;
     - delete the assignment → the section test goes red;
     - replace `sections` wholesale (`event.systemPromptOptions.sections = { [WORKING_DIRECTORY_SECTION]: … }`) → the preserve-existing test goes red;
     - prepend `"# Working Directory\n\n"` in the builder → the exact-sentence test goes red.

   - Commit footer:

     ```text
     BREAKING CHANGE: pi-nocd now requires Pi 1.0.0 or later. The block is
     written as a `<working_directory>` prompt section after `<cwd>`, without
     the `# Working Directory` heading, instead of being appended to a returned
     system prompt. An extension that returns `systemPrompt` from
     `before_agent_start` ahead of pi-nocd now drops the block.

     Refs #1000
     ```

4. **`docs(pi-nocd): describe the working-directory prompt section`**
   - README sections and the package skill rows listed in Module-Level Changes.
   - Verify: `pnpm exec rumdl check packages/pi-nocd/README.md .pi/skills/package-pi-nocd/SKILL.md`; grep the README for `footer`, `Current working directory`, `# Working Directory`, `inherit` and confirm each remaining hit is intended.
5. **End-to-end check (no commit; record the table in the TDD stage note)**
   - Re-run the reproduction arms against the working tree: baseline, `-e packages/pi-nocd/src/index.ts`, each with `-e builtin:mcp` and the probe, in fresh `pi -p` processes.
   - Expected: `<mcp_servers>` = 1 in both arms; pi-nocd sentence = 1 inside `<working_directory>` with pi-nocd and 0 without.
   - The probe is `/tmp/nocd-e2e/probe.ts` (a `before_provider_request` handler that writes `event.payload` to `$PROBE_OUT` and calls `process.exit(0)`); recreate it if `/tmp` was cleared.

## Risks and Mitigations

- **An earlier handler forces the prompt, and the block disappears.**
  Measured (pi-ask 1.2.0 loaded ahead of the spike): sentence count 0.
  Accepted by the operator, as ADR 0015 accepted it for pi-permission-system; the fix belongs to the forcing extension (eko24ive/pi-ask#16).
  In the operator's global settings pi-nocd is listed before pi-ask; that listing order is load order is assumed, not measured.
  Stated in the `BREAKING CHANGE:` footer and README.
- **A harness other than pi-subagents copies a parent's full prompt into a child.**
  The child would show the parent's stale block (inside the copied text) plus its own section.
  No such harness is known; pi-subagents cuts the tail and is pinned by step 1.
- **Version skew with an old pi-subagents.**
  A pi-subagents that predates the `<cwd>` cut would carry the parent's section into a child next to the child's own.
  The current cut has shipped; the pin in step 1 keeps it.
- **Hosts on Pi < 1.0.0** fail the peer range on install; the major bump and footer say so.

## Open Questions

- Close [#846] at `/ship` as resolved by this change (the rewrite branch it asks about is deleted), citing the fix commit.

[#640]: https://github.com/gotgenes/pi-packages/issues/640
[#846]: https://github.com/gotgenes/pi-packages/issues/846
[#999]: https://github.com/gotgenes/pi-packages/issues/999
