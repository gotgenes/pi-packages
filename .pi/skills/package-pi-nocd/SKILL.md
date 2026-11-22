---
name: package-pi-nocd
description: |
  Package-specific context for @gotgenes/pi-nocd.
  Load when working on code, tests, or docs in packages/pi-nocd/.
---

# pi-nocd

Pi extension that injects the resolved working directory into the system prompt so the agent never `cd`-prefixes a command into the directory it is already in.

## Upstream assumptions

The `/upstream-impact` watchlist for this package; the `upstream-watch` skill defines the impact classes.
Paths are relative to the Pi checkout.

| Our assumption                                                                                                                                                       | Upstream file                                                                                                                                                                             | Breaks as                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pi's prompt already states the working directory, so the extension only adds the prohibition                                                                         | `packages/coding-agent/src/core/system-prompt.ts` (`buildSystemPromptSections`, the cwd section)                                                                                          | Behavioral-silent: the block's premise and the agent's cwd source drift apart                                                                        |
| Every `before_agent_start` handler mutates one shared `systemPromptOptions` object, and Pi renders its `sections` after the chain unless a handler forced the prompt | `packages/coding-agent/src/core/extensions/runner.ts` (`emitBeforeAgentStart`); `packages/coding-agent/src/core/system-prompt.ts` (`buildSystemPromptSections`, `buildSystemPromptState`) | Behavioral-silent: the `<working_directory>` section never reaches the provider; an earlier handler returning `systemPrompt` already causes this     |
| A custom section renders as `<name>\n${content}\n</name>` after Pi's `<cwd>` section, and `working_directory` is a valid name                                        | `packages/coding-agent/src/core/system-prompt.ts` (`buildSystemPromptSections`, `SYSTEM_PROMPT_SECTION_NAME`)                                                                             | Loud or behavioral-silent: an invalid name throws; a reordered section can land ahead of `<cwd>`, inside the region pi-subagents copies into a child |
| `ctx.cwd` is the session working directory                                                                                                                           | `packages/coding-agent/src/core/extensions/types.ts` (`ExtensionContext.cwd`); `packages/coding-agent/src/core/session-cwd.ts`                                                            | Behavioral-silent: the injected directory is wrong                                                                                                   |

`test/index.test.ts` drives the handler with a hand-built options object, not one Pi's runner passed, so it is not a canary; the end-to-end check is a `pi -p` run that counts `<working_directory>` and `<mcp_servers>` in the provider payload.
That a child does not inherit the parent's section is pi-subagents' cut, pinned in `packages/pi-subagents/test/session/prompts.test.ts`.
