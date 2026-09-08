---
status: accepted
date: 2026-09-08
---

# 0008 — The inherited region guarantees shared parts, not shared bytes

## Status

Accepted.
Amends [ADR 0006], which stands: a child still inherits the parent prompt's identity region and nothing after it.
What this record changes is the *goal* that placement serves, and the claim the package makes about it.

## Context

[#180] and [#400] moved the inherited parent prompt to the front of a child's prompt so the child's leading bytes would be **byte-identical** to the parent's, which prefix-caching providers and local inference engines reuse instead of reprocessing.
[#180]'s reporter measured 8,333 shared tokens costing roughly 40 seconds on a local model.
[ADR 0006] then narrowed what is inherited to the identity region, on the reasoning that everything after it is resolved per session.

[#890] found that the goal, stated that way, was not being met and in one important case could not be.

### The tool list sits inside the region

`@gotgenes/pi-permission-system` narrows a session's `Available tools:` listing to the tools policy allows.
That listing is at offset 171 of Pi's preamble — inside the identity.
Rewriting it in place ended the shared prefix there for every child whose allowed set differed from its parent's: measured at **365 shared characters of a 57,423-character identity** in this repo's configuration, and reported from the field as a divergence at offset 412 of a 22,157-character prompt ([#890]).

Neither package was misbehaving.
A shared identity and an honest per-session tool list cannot coexist while the list lives inside the identity.

### The byte-identical claim was unscoped

Anthropic builds its cache prefix in the order `tools`, `system`, `messages`, and modifying tool definitions "invalidates the entire cache".
The `tools` array precedes the system prompt, so **any** child whose tool array differs from its parent's gets no cache hit from a byte-identical system prompt — which is every child with a narrowed `tools:` list, and every child at all, since the core installs `ask_parent`/`notify_parent` that no parent has.

On the Anthropic OAuth path there is a second, independent break: `@gotgenes/pi-anthropic-auth` prepends a billing block as system block 0 whose hash is derived from the first user message, and a parent and child never share one.

The property pays where tool definitions are rendered *after* the system text — local inference engines whose chat template does so, which is [#180]'s own constituency, and API-key Anthropic with an identical tool array.
The package had never said so.

## Decision

The inherited region guarantees **shared parts, not shared bytes**, and the benefit is scoped to hosts that reuse a prefix over the system text independently of the tool definitions.

Concretely:

1. `buildAgentPrompt` continues to place the inherited identity first, verbatim, and to cut at the first per-session layer ([ADR 0006] is unchanged in mechanism).
2. Per-session **prose about the tool surface does not belong in that region.**
   An extension that must state a session's tools states them after the layers a child inherits, so each session speaks for itself and none edits another's bytes.
   `pi-permission-system` implements this in [its ADR 0014].
3. The package documents the property as a shared leading prefix whose value is host-dependent, not as an unconditional byte-for-byte guarantee.

### The bridge block goes with it

The `<sub_agent_context>` block append mode injected is removed in the same change.
It named `read`, `edit`, `write`, `find`, and `grep` unconditionally — instructing an `Explore` child, which has neither `edit` nor `write`, to use them — and duplicated the `promptGuidelines` Pi's own tools already contribute to every child's prompt.
It was inherited verbatim from the upstream fork with no decision behind it.

It sat after the identity, so removing it costs no prefix.

## Consequences

- The identity a child shares with its parent is now the full identity minus the relocated tool surface, rather than ending at the tool list.
  A test pins it in this package (`buildAgentPrompt` opens with the inherited identity verbatim, in both modes), which the property had never had.
- Append mode differs from replace mode only in the `<agent_instructions>` wrapper.
- A child gets tool guidance for the tools it actually holds, rendered per session, instead of a fixed five-tool assertion.
- **Accepted residual:** with `pi-permission-system` absent, nothing restates a child's tool list and it still inherits its parent's.
  Tracked as [#901]; this package has no `before_agent_start` handler today, and adding one is that issue's work.
- A consumer that projects a child's prompt by matching the parent's — `pi-claude-bridge` — is helped rather than hindered: the region it looks for is verbatim again.
  That interaction is recorded, with what remains unverified, in [its ADR 0014].

[#180]: https://github.com/gotgenes/pi-packages/issues/180
[#400]: https://github.com/gotgenes/pi-packages/issues/400
[#890]: https://github.com/gotgenes/pi-packages/issues/890
[#901]: https://github.com/gotgenes/pi-packages/issues/901
[ADR 0006]: 0006-inherited-prompt-is-identity-only.md
[its ADR 0014]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0014-tool-surface-is-node-local-prose.md
