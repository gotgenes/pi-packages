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

## Stage: Final Retrospective (2026-09-08T16:24:47Z)

### Session summary

Shipped #890 through the worktree lane: fast-forward-merged the peer branch, ran pre-push checks, pushed, verified CI, closed the issue, and dispatched a release that cut `pi-permission-system-v31.1.3` and `pi-subagents-v21.4.7`.
The issue spanned four stages across two sessions — planning and TDD and sync in the peer worktree, ship and this retrospective at the root.
The dominant story is a design that the operator's two questions changed twice, away from all four candidates the issue proposed and toward relocating the tool-surface prose out of the inherited region entirely.

### Observations

#### What went well

- **A disposable spike retired two of the issue's four candidates on measurement rather than argument.**
  Running the pinned SDK's real `buildSystemPrompt` against both packages' real source produced 365 chars shared today, 57,425 with the child rewrite skipped, and 171 if `inheritedIdentity` truncates at the tool section — making issue option 3 provably *worse* than the status quo it was offered to improve.
  The spike was deleted and the plan instructed re-measurement rather than reuse, which is the AGENTS.md measurement-scoping rule working exactly as written.
- **A planned-in verification step caught a planned-in inference.**
  The plan carried the `pi-claude-bridge` compatibility claim as a Risk with an explicit instruction to read `findInheritedPrompts` before the ADR asserted it.
  Implementation read the published 0.7.0 tarball and found the matcher keys on `parent.assembledPrompt` — the parent's *full* prompt — so it fails independently of this change.
  Both ADRs now record the interaction as unverified instead of shipping the overstatement.
  Writing the doubt into the plan as an obligation, rather than trusting it to be remembered, is what made this work.
- **Mutation testing predicted its own partial kills.**
  Step 1's mutation killed 3 of 6 tests, and the plan had already named which equivalence class should survive and why (the three empty-array cases legitimately expect `[]`).
  Naming the class per mutation is what makes a partial kill readable as a pass rather than an unexplained gap.
- **The pre-completion reviewer caught an unlanded promise from the plan's own table.**
  WARN on four findings — including a fixture (`makeToolRegistry` defaults gaining `promptGuidelines`) the plan's Module-Level Changes listed but implementation had not landed — then PASS on a delta re-review that was explicitly asked to check whether fixing it had bent an unrelated assertion.

#### What caused friction (agent side)

- `missing-context` — The first design gate offered the issue's four candidates plus one synthesis, without having established who else writes the system-prompt string.
  The operator's "are we missing anything bigger picture" question produced a read of `pi-anthropic-auth`, verification of Anthropic's `tools → system → messages` cache hierarchy, and the five-parties table — which retired the framing all three prior gates rested on.
  Impact: three `ask_user` gates spent on a superseded framing, and a large share of planning context.
  No code rework (nothing was implemented yet).
  User-caught.
  The existing `/plan-issue` rule that would have caught this is scoped `For a third-party report`, and #890 was operator-filed, so it never fired.
- `premature-convergence` — The recommended option at the reframed gate (compose the child identity from `systemPromptOptions`, making [#884]'s `portable` the default) diverges from the parent at byte 0 — *below* the 365 chars it was meant to improve.
  The operator's question about [#180]'s local-model reporter surfaced it; the corrected design keeps the parent's identity bytes and relocates the varying part to the tail, which is what shipped.
  Impact: one gate cycle.
  Had it shipped, it would have regressed the exact constituency the invariant was created for.
  User-caught.
- `missing-context` — The plan's Module-Level Changes did not list `test/composition-root.test.ts`, whose three hand-built `pi.fire("before_agent_start", { systemPrompt: "" }, ctx)` literals broke when the handler read a new payload field.
  The untyped fake means `tsc` saw nothing; it threw only at the full-suite run.
  Impact: one extra fix folded into the same commit — and it drove a design improvement (the field shipped optional, avoiding a mid-turn `TypeError` on a host that omits it).
  Self-identified.
  The package skill warns about this class for `ExtensionContext` (`makeCtx`, `ctx.isProjectTrusted()`) but not for a hand-built **event payload**, so the near-miss rule's trigger did not match.
- `instruction-violation` — The ship session ran the post-draft SHA re-resolution *after* `issue_close` rather than before it.
  All six hashes resolved and were ancestors of `main`, so impact was nil — but the check exists precisely to catch a hash that drafting introduced, and after the call it can no longer prevent publishing one.
  Self-identified.
  The instruction currently sits inside a bullet describing comment *content*, several lines above the `issue_close` sentence.
- `instruction-violation` — Two trivial, self-corrected slips during implementation: an absolute file-tool path built from the root checkout while working in the worktree (AGENTS.md mandates repo-relative), and `npm view` where the repo mandates pnpm exclusively (the repo's shim caught it).
  Impact: one wasted tool call each.
  Both rules already exist and were followed on retry; no change proposed.
- `other` — The `pi-autoformat` reflow invalidated an `Edit` `oldText` twice (ADR 0014's "column zero" sentence, and `prompts.ts`), each recovered by re-reading the region.
  Impact: two wasted calls.
  AGENTS.md already documents this hazard and the recovery used was the documented one.

#### What caused friction (user side)

- **The two highest-leverage interventions in the whole issue were redirecting questions, not corrections.**
  "What's actually happening here… are we missing anything bigger picture?"
  and the follow-up about [#180]'s local-model user each changed the design, and neither prescribed an answer.
  This is the pattern worth keeping — a correction would have fixed one option; the questions replaced the option set.
- **Opportunity: the co-writer context lived with the operator, not in the issue.**
  That `pi-anthropic-auth` rewrites the same string at the wire is not discoverable from this monorepo — it is a separate checkout outside it.
  Naming the known co-writers in the issue body (or at the first gate) would have front-loaded the reframing and saved three gates.
  Framed as opportunity, not criticism: the agent should also ask, and one of the proposals below makes it ask.

### Diagnostic details

- **Model-performance correlation** — Planning ran on `claude-opus-5`, switched to `claude-fable-5-1` for the reframing and the ownership gates, then back to `claude-opus-5` to write the plan; TDD on `claude-opus-5`; sync on `claude-sonnet-5`; ship and this retro on `claude-opus-5`.
  Worth stating precisely, to avoid a false correlation: the reframing *and* the wrong `portable`-by-default recommendation both occurred under `claude-fable-5-1`, within two turns of each other.
  The design breakthrough tracks the operator's question, not the model switch that happened to precede it.
  Subagents: `tidy-first-assessor` once at planning, `pre-completion-reviewer` twice (initial WARN, delta re-review PASS) — both judgment-heavy tasks on their declared models, no mismatch.
- **Escalation-delay tracking** — No sequence exceeded five consecutive tool calls on the same error.
  The longest same-target run was the four step-5 killing mutations (deliberate, each with a predicted kill class), and the six-call `pi-claude-bridge` tarball hunt, which was the plan's own mandate rather than a rabbit hole.
- **Unused-tool detection** — Nothing was missed.
  The `pi-anthropic-auth` read was correctly kept inline rather than delegated, per the AGENTS.md rule that a universal claim the design rests on should not come back as a subagent summary requiring re-verification.
- **Feedback-loop gap analysis** — `pnpm run check` ran after every step that touched a shared type, and per-file Vitest ran at every Red and Green.
  The one gap is structural rather than procedural: the composition-root fixtures are untyped fakes, so no incremental gate could have caught them ahead of the full-suite run — which is what the skill amendment below addresses.

### Changes made

All four changes widen the trigger of a rule that already existed but did not fire for this issue.

1. `.pi/prompts/plan-issue.md` — "Invariants at risk" gains a line requiring each invariant's **constituency** to be named and confirmed still-holding.
   ADR 0006's prefix invariant served [#180]'s local-model users and was already dead on Anthropic; nobody had written down who it was for, so three gates argued about it in the abstract and a fourth nearly regressed it.
2. `.pi/prompts/plan-issue.md` — Gather context step 6 gains a clause requiring the **other writers of a shared mutable artifact** to be enumerated, naming `pi-anthropic-auth` as an out-of-monorepo example.
   The adjacent existing rule was scoped `For a third-party report`, so this operator-filed issue never triggered it.
3. `.pi/prompts/ship.md` — the post-draft SHA re-resolution moved out of the comment-*content* bullet and into an explicit gate immediately before the `issue_close` call, merged with the ancestor-of-`main` check.
   The content bullet keeps the pre-draft resolve and the rebase-staleness warning; refs #788 and #814 are preserved at the new site.
4. `.pi/skills/package-pi-permission-system/SKILL.md` — the hand-built-fixture warning extends from `ExtensionContext` to a hand-built **event payload**, citing the `composition-root.test.ts` `before_agent_start` fakes that compile clean and throw at run time.
