---
status: accepted
date: 2026-09-08
---

# 0009 — Portable inheritance is opt-in and scoped to the provider

## Status

Accepted.
Extends [ADR 0006] and [ADR 0008], both of which stand: a child still inherits the parent prompt's identity region and nothing after it, and that region still guarantees shared parts rather than shared bytes.
What this record adds is a second strategy for the case where inheriting the region is not merely worthless but harmful, and it settles what selects between them.

## Context

[#883] reported a `pi-subagents` child failing its first API call with `400 Third-party apps now draw from your extra usage`, while its parent — same machine, same OAuth token, same Claude Code binary — passed.

The chain, bisected by the reporter and independently corroborated by `pi-claude-bridge`'s own `diag/EXTRA-USAGE-400.md`:

1. `buildAgentPrompt` places the parent's identity region first in the child's prompt.
   That region opens with Pi's base preamble, which includes a documentation-routing line naming `custom providers (docs/custom-provider.md)` and `pi packages (docs/packages.md)`.
2. `pi-claude-bridge` projects a session's system prompt into Claude Code's `--append-system-prompt`, so the child's copy of that line reaches Anthropic.
3. Anthropic's subscription OAuth gate scores the appended text.
   The two phrases **together** trip it; either alone passes, and substituting `banana packages` for `pi packages` passes.
4. Classified as a third-party app, the request draws from extra usage — a hard 400 on an account with none.

The parent passes because the bridge's projection carries only its portable parts; Pi's base never reaches the API on that path.

### Why the region cannot simply be narrowed further

The offending line is in Pi's base preamble, which `inheritedIdentity` keeps by construction — the cut is at the *first per-session layer*, and the preamble precedes all of them.
Cutting further would not be a boundary any principle draws; it would be a blocklist of phrases one provider currently dislikes.

### The benefit being traded away is real, and recently restored

[#180] and [#400] placed the inherited region first so a child's leading bytes match its parent's, which prefix-reusing inference engines reuse instead of reprocessing — [#180]'s reporter measured 8,333 shared tokens at roughly 40 seconds on a local model.
[#890] found `@gotgenes/pi-permission-system` had been rewriting that region in place and moved the tool surface out, restoring the shared prefix from 365 characters to about 57,000 in this repo's configuration.

So a strategy that discards the region is correct for a re-homing host and a regression for a local-inference host.
The two cannot share a default.

## Decision

A second strategy, `portable`, is available and **off by default**, selected per provider.

### The identity is the operator's own text

A `portable` child's identity is composed from the parent's operator-authored prompt parts, in the order Pi's own `buildSystemPrompt` composes them: the custom prompt, the appended prompt, then the `<project_context>` block.
The result is what Pi would assemble for a session with a custom prompt and no tools or skills.

Three of Pi's `BuildSystemPromptOptions` fields are excluded, each for a reason already settled:

- `skills` — the child loads its own catalogue ([ADR 0006]).
- `promptGuidelines` — Pi derives it per session from the tools actually in the registry, so inheriting the parent's asserts guidance for tools the child may not hold.
  That is the defect [ADR 0008] removed with the `<sub_agent_context>` block.
- `selectedTools` and `toolSnippets` — the tool surface is node-local prose ([its ADR 0014]).

Context files are **included**, and load-bearing: `createSubagentSession` builds the child's loader with `noContextFiles: true`, so this is the only way a portable child sees project instructions at all.

### The provider selects the strategy, not the agent

```json
{ "promptInheritance": { "claude-bridge": "portable" } }
```

Re-homing is a property of the **transport**, not of the agent.
An agent has no opinion about prompt inheritance; a provider has a requirement.

Keying on the agent — a frontmatter `inherit_prompt`, which the contributed reference implementation ranked above the provider rule — resolves wrongly under a per-spawn `model` override: an agent declaring `portable` because its own `model:` names a bridge model keeps that strategy when spawned onto the raw API, discarding the parent identity for a transport that never needed it.
Keying on the child's resolved provider is correct by construction, because the override changes the provider and therefore the strategy, with nothing to keep in sync.

A provider-**declared** policy would be better still — the provider knows whether it re-homes — but is not reachable: Pi's `ProviderConfigInput` carries no policy field.
The settings map is the available seam, not the preferred one.

### The default does not change

Every provider the map does not list inherits `full`.
Flipping the default would change every existing child's prompt on a routine upgrade with no user edit, undo [#890]'s just-restored prefix for [#180]'s constituency, and — for a user without `pi-permission-system` — trade [#901]'s wrong tool list for no tool list at all, which is [#901]'s decision to make.

There is deliberately **no global default arm** on the setting.
A `"default": "portable"` would let one entry silently switch a local-model child, which is exactly the harm above; a re-homing host is per-provider by definition, so the map alone expresses every real case.

### An unusable capture never falls back to the full prompt

An absent or whitespace-only portable capture falls back to the generic base, never to the parent's assembled prompt.
Opting into portable must never silently re-embed the harness base it exists to avoid.

## Consequences

- A child on a listed provider carries none of Pi's base preamble, so a host that re-homes its prompt sees only text that host's own harness would have produced.
- `portable` is correct **only** where the host supplies its own base, and this is documented rather than enforced — Pi exposes no way to identify a re-homing provider.
  Pointed at a provider that does not re-home, it is worse than `full`: `@gotgenes/pi-anthropic-auth` locates Pi's role line to shape the OAuth prompt and returns it unchanged when that line is absent, so such a child loses the neutral role prompt shaping would have substituted and gains nothing.
- The `full` path is unchanged, so [ADR 0008]'s guarantee and its pinning test are untouched.
- A child that resolved no model resolves to `full`.
  This is defensive rather than reachable: Pi leaves the model unset only when no authenticated model exists at all, and such a parent cannot run a turn, emits no `before_agent_start`, and holds no capture to render.
- This package now registers a `before_agent_start` handler, its first.
  It stores the capture and returns nothing, so [#901]'s planned handler extends it rather than competing with it.
- **Accepted residual:** a portable child whose parent has no context files, custom prompt, or append prompt falls back to `genericBase`, which claims write and exec capability a read-only child does not hold.
  Tracked as [#904].
- `pi-claude-bridge` is fixing the projection on its own side ([bridge#89]), which would resolve [#883] for bridge users specifically.
  `portable` remains the answer for any other re-homing host with no projection to fix.

The bisection and replay methodology that established the discriminator are `elidickinson`'s, in `pi-claude-bridge`'s `diag/EXTRA-USAGE-400.md`.
The capability, the capture seam, and the fail-safe fallback are @georgeharker's, contributed in [#884].

[#180]: https://github.com/gotgenes/pi-packages/issues/180
[#400]: https://github.com/gotgenes/pi-packages/issues/400
[#883]: https://github.com/gotgenes/pi-packages/issues/883
[#884]: https://github.com/gotgenes/pi-packages/pull/884
[#890]: https://github.com/gotgenes/pi-packages/issues/890
[#901]: https://github.com/gotgenes/pi-packages/issues/901
[#904]: https://github.com/gotgenes/pi-packages/issues/904
[ADR 0006]: 0006-inherited-prompt-is-identity-only.md
[ADR 0008]: 0008-inherited-region-is-shared-parts.md
[its ADR 0014]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0014-tool-surface-is-node-local-prose.md
[bridge#89]: https://github.com/elidickinson/pi-claude-bridge/pull/89
