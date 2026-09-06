---
status: accepted
date: 2026-08-30
---

# 0006 — A child inherits the parent prompt's identity, not its session-resolved tail

## Status

Accepted.
Supersedes the equal-cwd exception recorded in [#640] and generalizes it into one rule for every layer Pi resolves per session.

## Context

`buildAgentPrompt` embeds the parent session's effective system prompt verbatim as the child's leading content.
That placement is deliberate and load-bearing: [#180] and [#400] moved the shared parent text to the front precisely so a child's prompt shares a byte-identical prefix with its parent's, which prefix-caching providers and local inference engines reuse instead of reprocessing.
The reporter of [#180] measured 8,333 shared tokens costing roughly 40 seconds of prompt processing on a local model before that change.

What the placement overlooked is that the parent's *effective* prompt is not identity alone.
Pi's `buildSystemPrompt` writes four regions and extensions append a fifth:

| Region         | Content                                                                    | Written by                                                                |
| -------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Identity       | preamble or `customPrompt`, tool snippets, guidelines, `<project_context>` | `buildSystemPrompt`                                                       |
| Catalogue      | the skills heading and `<available_skills>` … `</available_skills>`        | `formatSkillsForPrompt`, gated on the session's tool set including `read` |
| Footer         | `Current working directory: <cwd>`                                         | `buildSystemPrompt`, always last                                          |
| Extension tail | further blocks                                                             | handlers returning `systemPrompt` from `before_agent_start`               |

The last three are resolved against **one session**: its directory, its loaded skills, its bound extensions.
The extension tail is resolved against one *turn* — Pi rebuilds it from the base prompt on every turn and applies it as a single-turn override.

A child session rebuilds all three for itself and appends them after the inherited copy.
Inheriting them therefore hands the child a second, stale claim of each.
[#640] found this for the footer, where a worktree-isolated child followed the parent's directory back out of its workspace.
[#801] found it again for the catalogue, reported as a visibly duplicated `<available_skills>` block.

## Decision

The inherited prompt contributes **only its identity region**.
`inheritedIdentity` cuts at the first per-session layer present — the catalogue, or the footer when the parent session resolved no skills — and returns what precedes it.

### Truncate rather than excise

The alternative was to cut the catalogue and footer out while keeping the extension tail.
It was rejected on both criteria.

On accuracy, the inherited tail is the least defensible layer of the three.
It was built for the parent's directory and the parent's extension set: `@gotgenes/pi-nocd`'s block names the parent's cwd — the [#640] defect itself — and a package excluded from children through `excludedExtensionPackages` ([#696]) still reaches them through the inherited copy, which is the exact opposite of what that setting asks for.

On cost, excision is strictly worse for the constituency [#180] exists to protect.
Removing an interior span leaves the tail in the child but displaces it past the divergence point, moving it from cached to prefilled — measured at roughly 275 characters in [#640]'s environment.
Truncation deletes it instead, so a child's prefilled token count is unchanged from before this decision while its total prompt shrinks by the whole tail.

### The equal-cwd exception is withdrawn

[#640] kept an inherited footer when the child's directory matched the parent's, on the grounds that removing an accurate duplicate would shorten the byte-identical prefix.
That reasoning depended on the footer being inside the shared prefix.
The catalogue precedes the footer, so once the catalogue is cut the footer is already past the divergence point and the exception preserves nothing.
It survives only for a parent session that resolved no skills, where it would save one line.
The footer is now stripped unconditionally.

### The catalogue is located by position, not by document order

A project-context file may quote Pi's own prompt text, and so may a block an extension appended after the footer.
Any rule that picks the first or the last `<available_skills>` in the prompt is a guess about document order, and it is wrong in one direction or the other: the first loses to a quote in project context, the last loses to a quote in an appended block.

`buildSystemPrompt` writes the cwd footer immediately after the catalogue, in both of its branches and unconditionally.
Pi's own catalogue is therefore exactly the one whose closing tag is the line before the footer, which is a structural fact rather than a heuristic.
The heading is then found by searching back from that tag, so prose quoting the heading ahead of the section is not mistaken for it either.
A prompt with no footer has been rewritten by something downstream; there the last closing tag is the best remaining guess.

Both anchors match whole lines, which keeps a footer naming a directory that merely shares a prefix with the parent's from being mistaken for it.

## Consequences

- A child's assembled prompt carries exactly one skills catalogue and one working-directory claim, both describing the child's own session.
- Extensions that append to the system prompt no longer reach children through inheritance.
  Their handlers still run in the child — it binds the parent's extension set and its turn loop fires `before_agent_start` unconditionally — so an unconditional appender simply writes a block built for the child.
  This is documented for extension authors in the README.
- **Accepted residual:** a handler that appends conditionally — gated on an interactive UI, or on state cached at `session_start` — contributes nothing in a child, which then carries less guidance than it did before this decision.
  The mechanism is verified to fire in children and this package's own appender is unconditional, but the third-party population cannot be enumerated.
  The trade is accepted because the alternative is inheriting a block built for another directory and another extension set, which is wrong rather than merely absent.
- The shared prefix a child holds with its parent is shorter by the three dropped regions.
  Nothing that remains in the child's prompt moved out of that prefix, so no additional tokens require processing.
- `@gotgenes/pi-nocd` documents a rewrite path premised on subagents inheriting the prompt verbatim, which this decision ends.
  Tracked as [#846].
- A consumer that recovers the inherited region by searching a child's prompt for the parent's *full* assembled prompt finds nothing, because truncation ends the containment it matches on.
  `pi-claude-bridge` does exactly this to project a child's prompt onto another harness, so a child on that provider forwards Pi's base prompt where the parent forwards only its portable parts.
  Reported as [#883]; a consumer-side matcher fix is proposed at [pi-claude-bridge#88].
  A child whose cwd differs from its parent's is beyond any such fix: Pi's `useExtensionCacheCwd` clears the extension cache on a cwd change, so the consumer's capture of the parent never exists in the child's module instance at all.

[#180]: https://github.com/gotgenes/pi-packages/issues/180
[#400]: https://github.com/gotgenes/pi-packages/issues/400
[#640]: https://github.com/gotgenes/pi-packages/issues/640
[#696]: https://github.com/gotgenes/pi-packages/issues/696
[#801]: https://github.com/gotgenes/pi-packages/issues/801
[#846]: https://github.com/gotgenes/pi-packages/issues/846
[#883]: https://github.com/gotgenes/pi-packages/issues/883
[pi-claude-bridge#88]: https://github.com/elidickinson/pi-claude-bridge/issues/88
