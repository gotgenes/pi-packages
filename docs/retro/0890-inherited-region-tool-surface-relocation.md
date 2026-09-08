---
issue: 890
issue_title: "pi-permission-system's in-place prompt rewrite defeats pi-subagents' byte-identical parent prefix"
---

# Retro: #890 — pi-permission-system's in-place prompt rewrite defeats pi-subagents' byte-identical parent prefix

## Stage: Planning (2026-09-08T04:30:59Z)

### Session summary

Planned the resolution of the `pi-permission-system` / `pi-subagents` prompt collision as a cross-package plan at `docs/plans/0890-inherited-region-tool-surface-relocation.md`.
The adopted design is none of the issue's four candidates: instead of choosing between a byte-identical prefix and an honest child tool list, the tool-surface prose (`Available tools:`, the "In addition to the tools above…" paragraph, and `Guidelines:`) is **relocated** out of Pi's preamble and rendered per node at the end of the prompt, so parent and child share the whole identity and each node states its own list.
Filed [#901] for the residual (a child without `pi-permission-system` still inherits the parent's list) and recorded its Phase 22 disposition as deferred.

### Observations

- **The operator's "bigger picture" question changed the design twice.**
  The first gate offered the issue's four candidates plus an append-after-identity synthesis.
  Reading `~/development/pi/pi-anthropic-auth` (outside this monorepo, per AGENTS.md's third-party-report guidance) revealed a **fourth** party editing the same string at the wire, and its billing block — `cch = sha256(first user message)[:5]` as system block 0 — independently defeats prompt caching between parent and child on the OAuth path.
  That, plus the verified Anthropic cache hierarchy, showed one of the two "conflicting" invariants was already not holding on the provider in use.
- **A recommended option was wrong and the operator caught it.**
  I recommended composing the child identity from `systemPromptOptions` (making [#884]'s `portable` the default).
  The operator asked what happens to [#180]'s local-model reporter — and that shape diverges from the parent at byte 0, *below* today's 365.
  The corrected design keeps the parent's identity bytes and moves the varying part to the tail, which requires the relocation to run in **every** node, not just the child.
  Worth remembering: a design that improves the headline metric for the loudest consumer can regress the original constituency, and only naming that constituency surfaces it.
- **Measurement retired two of the issue's four candidates.**
  A disposable spike (pinned SDK 0.84.4 `buildSystemPrompt` + real `buildAgentPrompt` + real `sanitizeAvailableToolsSection`) measured the shared prefix at 365 chars today, 57,425 with the child rewrite skipped, and **171** if `inheritedIdentity` truncates at the tool section — so issue option 3 is strictly worse than the status quo it was offered to improve.
  Spike deleted; the plan says to re-measure rather than reuse the numbers.
- **`git log -S` on the `<sub_agent_context>` text found only the monorepo move (`cc98860d`)**, confirming it is inherited upstream boilerplate with no ADR behind it.
  Its five tool bullets duplicate Pi's own per-tool `promptGuidelines`; the operator chose to remove the whole block rather than render it conditionally.
- **Ownership resolved to a single writer.**
  The operator's ordering question ("does pps run first, then pi-subagents modify further?") turned out not to apply: `pi-subagents` has no `before_agent_start` handler at all, and its `tools:` narrowing is already visible to `pi-permission-system` through the child's registry, so one writer covers both narrowings.
  The order-independent contract a second writer would need is recorded in the plan and [#901] rather than built.
- **Unverified claim carried into the plan deliberately.**
  That `pi-claude-bridge`'s matching key excludes the relocated block is an inference from [#884]'s thread, not a read of `findInheritedPrompts`.
  It is listed as a Risk with an instruction to read the matcher before the ADR asserts it.
- **`buildSystemPrompt` is not exported as a value** from either pinned SDK (only `BuildSystemPromptOptions` as a type), so the block must be rendered in-package rather than delegated to Pi — which is why the plan replicates Pi's three built-in guideline bullets by hand.

#### Deferred tidyings

- `packages/pi-permission-system/src/exposure/system-prompt-sanitizer.ts` — extracting `normalizePrompt`/`collapseExtraBlankLines` into a shared text-utils module; rejected as scope creep (no caller outside the file).
- `packages/pi-permission-system/test/exposure/system-prompt-sanitizer.test.ts` and `test/handlers/before-agent-start.test.ts` — flat `describe` structure; rejected because the change rewrites those assertions anyway.

[#180]: https://github.com/gotgenes/pi-packages/issues/180
[#884]: https://github.com/gotgenes/pi-packages/issues/884
[#901]: https://github.com/gotgenes/pi-packages/issues/901
