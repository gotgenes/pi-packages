---
name: package-pi-permission-model-judge
description: |
  Package-specific context for @gotgenes/pi-permission-model-judge.
  Load when working on code, tests, or docs in packages/pi-permission-model-judge/.
---

# pi-permission-model-judge

Deny-first typo-path model judge: a `pi-permission-system` Authorizer chain link that asks a model whether a path looks like a typo.

## Upstream assumptions

The `/upstream-impact` watchlist for this package; the `upstream-watch` skill defines the impact classes.
Paths are relative to the Pi checkout.

| Our assumption                                                                                                                                               | Upstream file                                                                                                                                                  | Breaks as                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `Model.api` decides the forced `toolChoice` spelling: `"any"` for Anthropic, Google, Bedrock, and Mistral, `"required"` for the OpenAI family                | `packages/ai/src/types.ts` (`KnownApi`); `packages/ai/src/api/*.ts` (per-API `toolChoice` unions)                                                              | Behavioral-silent: a wrong spelling degrades to `auto` and the model answers in prose                                   |
| Any `Api` value absent from `FORCED_TOOL_CHOICE_BY_API` accepts the `"required"` default                                                                     | `packages/ai/src/types.ts` (`KnownApi`); new files under `packages/ai/src/api/`; `packages/coding-agent/src/core/virtual-models.ts` (`pi-virtual`)             | Coverage-gap: a new API rejects `"required"` and the judge defers; a virtual model has no compat provider at all        |
| `openai-completions` forwards `toolChoice` verbatim                                                                                                          | `packages/ai/src/api/openai-completions.ts` (`tool_choice`)                                                                                                    | Behavioral-silent if upstream starts translating or validating it                                                       |
| `complete` from `pi-ai/compat` reaches the provider with our `apiKey`, `headers`, and `toolChoice` intact                                                    | `packages/ai/src/compat.ts` (`complete`, `stream`); `packages/coding-agent/src/core/extensions/loader.ts` (module aliases)                                     | Compile-time if the compat entry is removed (its header schedules deletion); coverage-gap if a branch drops the options |
| `ctx.modelRegistry.find` and `getApiKeyAndHeaders` return `{ok: true, apiKey?, headers?} \| {ok: false, error}`                                              | `packages/coding-agent/src/core/model-registry.ts` (`ResolvedRequestAuth`)                                                                                     | Behavioral-silent: we redeclare the type structurally, so a reshape still compiles                                      |
| `ctx.modelRegistry` captured at `session_start` stays the live registry                                                                                      | `packages/coding-agent/src/core/agent-session.ts`; `packages/coding-agent/src/core/extensions/types.ts`                                                        | Behavioral-silent: the judge uses a stale registry                                                                      |
| `ctx.isProjectTrusted()` holds the session's final trust decision by `session_start`, and a `<cwd>/.pi/extensions` directory makes a project trust-requiring | `packages/coding-agent/src/core/resource-loader.ts` (`reload`); `packages/coding-agent/src/core/trust-manager.ts` (`TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES`) | Behavioral-silent: an untrusted project's config loads, or a trusted one's is skipped                                   |
| `getAgentDir()` honors `PI_CODING_AGENT_DIR`, matching `pi-permission-system`'s global scope                                                                 | `packages/coding-agent/src/config.ts` (`getAgentDir`)                                                                                                          | Behavioral-silent: the judge reads a different config root than the permission system                                   |

`test/tool-choice.test.ts` pins the per-API map against our own table; a probe that diffs the installed catalog's distinct `model.api` values against the map's keys is the real canary.
