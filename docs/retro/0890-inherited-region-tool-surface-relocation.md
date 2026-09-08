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

## Stage: Implementation — TDD (2026-09-08T16:00:35Z)

### Session summary

Executed all seven planned TDD cycles across both packages, plus one follow-up commit addressing the pre-completion review.
`pi-permission-system` now relocates the tool surface instead of editing it in place (`src/exposure/tool-surface-prompt.ts`, renamed from `system-prompt-sanitizer.ts`), and `pi-subagents` dropped the hard-coded `<sub_agent_context>` bridge.
Test count: `pi-permission-system` 4117 → 4126, `pi-subagents` 1636 → 1638.
Pre-completion reviewer: WARN on the first round (four non-blocking findings), PASS on the delta re-review after all four were fixed.

### Observations

- **The plan's Risk item paid off.**
  The plan required reading `pi-claude-bridge`'s matcher before the ADR asserted compatibility, rather than inheriting the claim from [#884]'s thread.
  Reading the published 0.7.0 tarball showed `findInheritedPrompts` keys on `parent.assembledPrompt` — the parent's **full** prompt — which a child never contains, so that matcher fails independently of this change; and the stripped-key fix ([pi-claude-bridge#89]) is an open PR with 0.7.0 still the latest published version.
  Both ADRs record the end-to-end interaction as unverified rather than claiming compatibility.
  The inference in the plan would have shipped as an overstatement.
- **Two design improvements over the plan, both from friction the plan did not predict.**
  The plan put the single-pass registry reader inside `before-agent-start.ts`; it went to `tool-registry.ts` as an exported `readRegisteredTools` instead, because a module-private helper in the handler is not directly testable and the plan's own killing mutation for that step assumed a test existed.
  And `BeforeAgentStartPayload.systemPromptOptions` shipped **optional and narrowed to `{ toolSnippets? }`** rather than the full `BuildSystemPromptOptions` the plan named — ISP, and it avoids a mid-turn `TypeError` on a host that omits the field.
- **The composition-root tests caught what `tsc` could not.**
  Three `pi.fire("before_agent_start", { systemPrompt: "" }, ctx)` call sites hand-build the event through an untyped fake, so reading a new field compiled fine and threw at the full-suite run — exactly the hand-built-ctx class the package skill warns about.
  Fixed the fixtures *and* made the field optional.
- **A fixture default is a shared input, not a local one.**
  Landing the reviewer's finding #4 (`makeToolRegistry` defaults gaining `promptGuidelines`) changed an unrelated test's expected output, because that test used the default registry.
  Re-derived the new expected block from `renderGuidelines`' order rather than pasting the received value; the re-review was explicitly asked to check that assertion for bending, and confirmed it.
- **Mutation testing behaved as the plan predicted, including the partial kills.**
  Step 1's mutation killed 3 of 6 tests — the three empty-array cases legitimately survive because they expect `[]`.
  Naming which class each mutation should kill is what made that readable as a pass rather than a gap.
- **Deviation worth flagging at ship:** this changes the system-prompt layout for **every** `pi-permission-system` user, not only those spawning subagents — the tool list moves to the end of the prompt whether or not anything is denied.
  The every-node requirement is load-bearing (relocating in children alone measures *worse* than the status quo), and it is recorded in ADR 0014 and `configuration.md`.
- **Accepted residual made explicit:** the section headers are matched on trimmed text with no tie to Pi's authorship, so a project's own `Guidelines:` heading inside `<project_context>` is removed with its bullets.
  Pre-existing (the narrowing implementation mangled the same line), now pinned by a test that documents rather than endorses it, with the anchoring fix named in ADR 0014.

[pi-claude-bridge#89]: https://github.com/elidickinson/pi-claude-bridge/issues/89

## Stage: Sync (worktree) (2026-09-08T16:02:33Z)

### Session summary

Pre-push checks (`pnpm run lint`, `pnpm fallow dead-code`) both pass with no changes needed.
Both packages (`pi-permission-system`, `pi-subagents`) will cut a release on land — the plan's `**Release:** ship independently` marker — so `/ship` should dispatch both by name.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-890--/2026-09-08T03-07-01-691Z_01a07efb-baba-7785-9d81-764a12a7235d.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

No deferred work beyond what's already recorded: [#901] (a child without `pi-permission-system` inherits the parent's tool list) is filed, deferred against `pi-subagents` Phase 22 with rationale.
The `pi-claude-bridge` compatibility claim in both ADRs is explicitly recorded as unverified (0.7.0 is the latest published version; the stripped-key fix is an open, unmerged PR) — nothing to act on here, just carrying it forward for the root session's awareness.
