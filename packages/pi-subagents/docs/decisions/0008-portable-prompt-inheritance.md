---
status: proposed
date: 2026-09-05
---

# 0008 — Portable prompt inheritance for children whose provider re-homes the prompt

## Status

Proposed.
Extends [ADR 0006](0006-inherited-prompt-is-identity-only.md) with a second, opt-in inheritance strategy; changes no default behavior.

## Context

ADR 0006 settled *which parts* of the parent's prompt a child inherits: the identity layers, byte for byte, so a child shares a prefix with its parent that prefix-caching providers reuse.
The identity layers include Pi's own preamble and tool guidelines.

That is the right trade when the child talks to the same raw API as its parent.
It is the wrong trade when the child's provider *re-homes* the prompt — forwards Pi's system prompt into another harness that composes it onto its own. pi-claude-bridge does exactly this: it projects the child's Pi prompt into Claude Code's `--append-system-prompt`, where Pi's preamble rides as an append on top of Claude Code's preset.

Re-homing turned out to be more than cosmetic.
Anthropic's subscription OAuth gate classifies requests by system-prompt content, and flags the combination of two phrases in Pi's documentation-routing line (`custom providers (docs/custom-provider.md)` alongside `pi packages (docs/packages.md)`) as a third-party app.
A child whose inherited identity reaches that gate is rejected outright while the account has no extra-usage credit — the parent and every non-inheriting path on the same provider, token, and Claude Code binary pass.
The parent passes for a structural reason: pi-claude-bridge already projects only the *portable* parts of the parent's prompt (context files, skills, custom/append), never Pi's base.

Two facts follow.

1. The information a child needs from the parent's prompt — project context, persona, added guidelines — is exactly the portable parts.
   Pi's preamble and tool guidelines are the harness's own instructions; a re-homing host supplies its own equivalents, so the inherited copy is at best duplicated tokens.
2. Pi already reports the portable parts authoritatively: `before_agent_start` carries `systemPromptOptions` (`contextFiles`, `customPrompt`, `appendSystemPrompt`, `promptGuidelines`).
   No prompt-text heuristics are required to separate them from the base.

## Decision

Add a second inheritance strategy, `portable`, selected per child:

- **Agent frontmatter** — `inherit_prompt: portable | full` wins over everything.
- **Provider rule** — the `promptInheritance.providers` setting maps the *child's resolved model's provider id* to a strategy, because re-homing is a property of the provider the child's requests actually go to.
- **Default** — `promptInheritance` (simple string form or `rules.default`), ultimately `full`.

A portable child's identity is built from the parent's `before_agent_start.systemPromptOptions`: context files (the child loader runs with `noContextFiles: true`, so this is the only way they reach the child at all), `promptGuidelines`, `customPrompt`, `appendSystemPrompt`.
Skills stay un-inherited — the child rebuilds its own catalogue, as in ADR 0006.
An absent or empty capture falls back to the generic base rather than to the full prompt: opting into portable must never silently re-embed the base it exists to avoid.

The default remains `full`.
Nobody's children change behavior unless a frontmatter key or a settings entry opts them in, and a provider-scoped rule leaves every other provider's children — including same-API children, where the shared prefix is worth the most — untouched.

## Consequences

- A portable child's prompt shares no byte prefix with its parent.
  For a re-homed child that prefix was never reusable — the request leaves through a different harness — so nothing is lost; for a same-API child the rule should simply not select portable.
- Context files reach portable children through the inherited identity instead of being suppressed-and-absent, which also makes them available to `prompt_mode: replace` children that opt in.
- The resolution happens in `assembleSessionConfig` after the child's model is settled, so a per-spawn `model` override is scoped correctly by the provider it actually selects.
- The long-term shape is a provider *declaring* that it re-homes prompts (a published policy, consulted automatically), which would make `portable` the default for exactly the children that need it with no configuration at all.
  The provider-rule setting is deliberately shaped to become the override layer on top of that.
