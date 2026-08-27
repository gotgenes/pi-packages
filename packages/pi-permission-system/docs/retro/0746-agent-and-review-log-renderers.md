---
issue: 746
issue_title: "pi-permission-system: agent-facing and review-log renderers over the prompt payload"
---

# Retro: #746 — pi-permission-system: agent-facing and review-log renderers over the prompt payload

## Stage: Planning (2026-08-16T16:44:39Z)

### Session summary

Planned Phase 13 Step 4 — the last two `message` consumers become renderers over the `PromptPayload`.
Three design decisions were put to the operator and settled: the agent-facing denial text names the flagged element but never the command; the review log records structured request facts with a uniform width bound applied at the `writeLine` choke point; and `DenialContext` dissolves into `PromptPayload`.
The plan landed as `docs/plans/0746-agent-and-review-log-renderers.md` with eight TDD steps, two of them breaking.

### Observations

- The first `ask_user` on the agent-text question was bounced: the operator asked for the agent's correlation need to be addressed before choosing.
  Answering it took a source trace rather than an argument — an `Explore` subagent on the sibling Pi checkout (`9d2ec7ffa`) established that a block reason becomes an error tool result stamped with `toolCallId` (`packages/agent/src/agent-loop.ts:637-641, 779`), pairs correctly under parallel tool calls (`489-532`), and travels alongside the assistant message's retained arguments (`195, 219-221, 295`).
  Correlation is structural, so the renderer never needed to echo input for identification.
  The residual — *which operand* of a multi-token bash call tripped the gate — is below tool-call granularity, and that is what option B (flagged element, never the command) buys.
- The second `ask_user` was also bounced: options carrying worked examples in their `preview` panes were not enough.
  What landed was seven scenarios in a plain message, each showing the originating tool call above the current text and the three candidate renders.
  The lesson generalizes the `AGENTS.md` clarification-gate rule: for a wording change, the substance is the before/after *paired with its input*, not the option list.
- Log numbers were measured, not estimated, from the operator's live 7.07 MB review log: `message` is 21.5%, `command` 20.2% (largest single value 72 KB), `toolInputPreview` 0.1%.
  Removing `message` and capping at the existing 1000-character bound saves 28.7% and shortens 4.3% of command entries.
  The measurement is what showed that dropping `message` alone leaves half the growth unconfigured — `command` would still be unbounded — which is why the cap went to the writer rather than the renderer.
- `DenialContext` dissolves cleanly because every field it holds that the payload lacks is a field ADR 0011 §7 forbids rendering (`bash_path.command`, `tool.input`, the latter already unread).
  The one real gap was `check.reason`, the operator's `deny`-with-reason string, which `GateRunner` holds at message-construction time — passing it as an argument both closes the gap and generalizes it beyond the tool/bash arm, which is a small behavior fix riding step 3.
- The default `reviewLogFieldMaxWidth` (1000) is not a new number: it is today's `TOOL_INPUT_LOG_PREVIEW_MAX_LENGTH`, whose own doc comment says it holds "until [#746] lands the log's own renderer".
  Moving it to the writer lets `ToolPreviewFormatterOptions.toolInputLogPreviewMaxLength` go, so the log has one bound instead of one bound plus an unbounded remainder.
- Largest identified risk: deleting `test/presentation/legacy-message.test.ts` removes the standing proof that the payload is complete (Step 1's `Landed:` note calls that suite the proof).
  The plan makes migrating the three payload-builder suites to per-field assertions the gating deliverable of the deletion step rather than a follow-up.
- The flagged-element decision is a documented departure from a literal reading of §7's "needs no separate size bound".
  Recorded at the module declaration and in the roadmap `Landed:` note, following the precedent Step 2 set for §3 against §5, rather than amending an accepted ADR.
  Left in Open Questions for a later ADR pass.

## Stage: Implementation — TDD (2026-08-16T18:06:00Z)

### Session summary

Executed all eight planned TDD cycles plus two tidy-first preparatory commits and a post-review cleanup — twelve commits.
The agent-facing denial text and the review log became renderers over `PromptPayload`, `DenialContext` and `legacy-message.ts` were deleted, and `reviewLogFieldMaxWidth` now bounds every review-log value at the `writeLine` choke point.
Test count went 3009 → 3010 across a much larger churn than that suggests: 1072 lines of test deleted (`denial-messages.test.ts`, `legacy-message.test.ts`) against four new suites and three migrated ones.

### Observations

- Two deviations from the plan, both improvements the plan's own shape surfaced.
  The plan had each of the seven gates spread `renderReviewLogFacts(payload)` into its `logContext`; the `makeDescriptor` fixture that would have had to restate that spread is what showed it belongs in `GateRunner`, beside the `agentName`/`requestId` stamp — a gate cannot forget what it never supplies.
  Second, `flaggedElementLabel` had to split into `valueLabel` (labels `request.value`, for the dialog) and `flaggedElementLabel` (labels what `flaggedElements` returns, for the agent renderer); they differ only for `bash_external_directory`, whose value is the command while what it flags are paths.
  The extraction had silently conflated two functions that only look alike.
- The tidy-first assessor's two commits paid for themselves in step 7.
  Converging `gate-fixtures.ts` onto a shared `makeGatePromptDetails` meant removing the required `message` field touched one fixture line instead of two hand-rolled literals, and collapsing `makeDenialDescriptor` removed a factory whose only purpose was supplying the union being deleted.
  The assessor also correctly *rejected* extracting a shared gate-descriptor assembler — the seven builders' `denialContext` blocks were about to be deleted, and there is nothing to extract before a deletion.
- The `renderUnavailableDenial` wording forced a decision the plan had not anticipated: the boundary clause (`outside working directory '/repo'`) reads badly in the "requires approval" sentence.
  Resolved by omitting it — no retry shape changes the fact that no human is reachable — and pinned with an explicit test so the omission is a decision rather than an accident.
- One test-fixture bug of my own making: the first runner Red used a `kind: "tool"` payload carrying a path value, and the renderer dutifully produced `for tool '/etc/passwd'`.
  A payload literal can be internally incoherent in a way no production builder would produce; the fix was making the fixture coherent, not the renderer tolerant.
- Deleting `test/presentation/legacy-message.test.ts` removed the standing proof that the payload is complete, which the plan flagged as the largest risk.
  The three payload-builder suites migrated from `renderLegacyMessage(...).toContain(...)` to direct payload-field assertions — strictly stronger, since a builder test matching a downstream render can pass while a field it never reads is wrong.
- The `/dev/null`-style live demonstration: an early `Write` to a mistyped path outside the repo was denied by this very extension, and its denial text (`User denied external directory access for tool 'write' path '…'`) is exactly the shape this issue replaces.
- Pre-completion reviewer: **WARN** on the first pass, **PASS** on re-review.
  The WARN named four stale doc references and two dead test fields; grepping exhaustively per the AGENTS.md guidance found nine sites rather than four, all fixed in one commit (`53647b2b`).
  The reviewer also flagged two `composition-root.test.ts` timeouts under the parallel root run and correctly diagnosed them as contention flakiness, not a regression — both pass in isolation.
- Measured outcome: `renderLegacyMessage` in `src/` went 17 → 0, and the predicted 28.7% review-log reduction rests on the same live 7.07 MB log the plan measured.

## Stage: Final Retrospective (2026-08-16T21:50:31Z)

### Session summary

Planned, implemented, and shipped Phase 13 Step 4 in one continuous session — the agent-facing denial text and the review log became renderers over `PromptPayload`, retiring the flat `message` string and the parallel `DenialContext` union.
Twelve implementation commits landed as `pi-permission-system-v26.0.0`, a breaking release batching #745 and #746 as the "presentation-contract" batch.
The measured outcome held: `renderLegacyMessage` in `src/` went 17 → 0, and the new `reviewLogFieldMaxWidth` bound removes ~28.7% of a live 7.07 MB review log.

### Observations

#### What went well

- The **two-bounce planning gate produced a materially better design than either first draft**.
  Bounce one forced a source trace instead of an argument, which established that denial correlation is structural (Pi stamps a block reason as that call's own tool result with its `toolCallId`, arguments retained) — collapsing "the agent needs the text to identify its call" from a requirement into a non-issue.
  Bounce two forced seven worked scenarios into a plain message, which is what surfaced the *actual* discriminating case: a multi-token bash call where the agent cannot tell which operand tripped the gate.
  Option B exists only because that case became visible.
- **Measurement replaced estimation at every decision point.**
  The live 7.07 MB review log answered where the log's growth actually lives (`message` 21.5%, `command` 20.2%, largest single value 72 KB), which is what showed that dropping `message` alone leaves half the growth unconfigured — and moved the width bound from the renderer to `writeLine`.
  The same log supplied the blast radius for the cap (188 of 4325 command entries, 4.3%), which went into the migration note rather than a hedge.
- **The `tidy-first-assessor` earned its dispatch, including by refusing work.**
  Its two preparatory commits made step 7's required-field removal a one-line fixture edit; it also correctly declined to extract a shared gate-descriptor assembler, on the grounds that the seven builders' `denialContext` blocks were about to be deleted and there is nothing to extract before a deletion.
- **The exhaustive-grep rule (Refs #441) paid for itself.**
  The pre-completion reviewer's WARN named 5 stale sites; grepping every removed symbol found 12 files.
  Fixing only the named ones would have invited the second WARN round the rule exists to prevent.
- **Model assignment tracked task shape.**
  Planning, TDD, and this retro ran on `claude-opus-5`; the operator switched to `claude-sonnet-5` for the 26-turn ship stage — deterministic tool orchestration — and back for the retro.

#### What caused friction (agent side)

- `instruction-violation` (self-identified, in retro) — `.pi/prompts/plan-issue.md:33` says to load the `design-review` skill before finalizing the design for any change to shared interfaces or layer wiring.
  This change added `GateDescriptor.payload`, removed `PromptPermissionDetails.message`, and threaded a derived fact through seven gate builders; the skill was never loaded.
  Its checklist item 5 ("Parameter relay — if intermediaries only relay, the parameter belongs on a shared object, not threaded through every layer") describes the exact defect the plan then prescribed.
  Impact: the plan specified seven `logContext` spreads of `renderReviewLogFacts(payload)`; implementation corrected it to a single `GateRunner` stamp.
  One deviation, caught cheaply by a fixture that would have had to restate the spread — no rework beyond the correction itself.
- `wrong-abstraction` — the `fact-vocabulary.ts` extraction collapsed `dialog-renderer`'s private `flaggedTexts` and `valueLabel` into a single `flaggedElementLabel`, conflating two functions that only look alike.
  They diverge for `bash_external_directory`, whose `request.value` is the command while what it *flags* are paths.
  The `code-design` skill's "structural reasons before extracting duplication" rule covers this and was loaded.
  Impact: one failing test in the first agent-renderer Green (`labels a bash_external_directory ask's value command`), split into `valueLabel` + `flaggedElementLabel` in the same cycle.
  No commit-level rework.
- `other` — the first agent-renderer Red used a `kind: "tool"` payload carrying a path value, and the renderer dutifully rendered `for tool '/etc/passwd'`.
  A hand-built payload literal can be internally incoherent in ways no production builder produces.
  Impact: one failed assertion, fixed by making the fixture coherent rather than the renderer tolerant.
- `other` — an early `Write` targeted `/Users/chris/development/pi/pi-permission-system-agent-renderer.test.tmp.ts`, outside the repo, and was blocked by this very extension.
  Impact: one denied call; incidentally a live demonstration of the pre-#746 denial text this issue replaces.

#### What caused friction (user side)

- Nothing material.
  Both `ask_user` bounces were the gate working: each rejected an under-grounded question and named precisely what was missing (verify the correlation premise; pair each example with the tool call that produced it).
  The second bounce also carried a reusable format instruction — "not as content in `ask_user` but as a user message" — that generalized into an `AGENTS.md` refinement below.

### Diagnostic details

- **Model-performance correlation** — attributed from inline turn labels in the session file, not `model_change` entries.
  `claude-opus-5` ran planning (session lines 5–125), TDD (126–607), and this retro (664+); `claude-sonnet-5` ran the ship stage (609–663, 26 turns).
  All three subagents (`tidy-first-assessor`, `pre-completion-reviewer` ×2, and the `Explore` dispatch for the Pi source trace) ran `anthropic/claude-sonnet-5`, matching their frontmatter and the `AGENTS.md` guidance for a multi-hop trace in the sibling Pi checkout.
  No mismatch: no reasoning-weak model on judgment work, no high-cost model on mechanical work.
- **Unused-tool detection** — the `design-review` skill was available, named by the active prompt, and not loaded; its checklist item 5 targets the one design defect the plan shipped.
  This is the only unused-tool finding.
- **Feedback-loop gap analysis** — no gap. 57 verification invocations spread continuously across the TDD stage: a four-command green baseline at lines 137–144, then `pnpm run check` / scoped `vitest run` after essentially every change through line 590, with `lint` and `fallow dead-code` at each commit boundary.
  Verification was never deferred to the end.
- **Escalation-delay tracking** — nothing notable.
  No `rabbit-hole` friction points; the longest same-error sequence was 2 tool calls (the 8-failure agent-renderer Green, resolved in one analysis pass into two distinct causes).

### Changes made

1. `.pi/agents/pre-completion-reviewer.md` — added a "Source and test comments" bullet to the forward doc-staleness check, directing a `src/`/`test/` grep when a change removes a module, export, or type.
   The existing bullet covered renames across `.pi/skills/` and `.pi/prompts/` only, and this session's reviewer pass missed 7 of 12 stale sites, all of them code comments.
2. `AGENTS.md` — § Clarification gates now names `preview` panes alongside option descriptions as a place context gets bounced from, with a `#746` ref.
   A `type: "preview"` ask carrying full worked examples was bounced this session with an explicit instruction to put them in a message instead.
3. `.pi/prompts/plan-issue.md` — added a parameter-relay heuristic to § Design Overview: when N sibling call sites each supply the same derived fact, check whether a shared downstream point already stamps per-call fields.
   The `design-review` skill covers this, but it is loaded ~115 lines earlier in the prompt; this puts the check where the design is actually written.

[#746]: https://github.com/gotgenes/pi-packages/issues/746
