---
issue: 628
issue_title: "pi-permission-model-judge reaches the model but defers on parse-failed — force a structured tool call"
---

# Retro: #628 — pi-permission-model-judge reaches the model but defers on parse-failed — force a structured tool call

## Stage: Planning (2026-02-14T00:00:00Z)

### Session summary

Produced a numbered TDD plan for replacing `reviewPath`'s free-text `JSON.parse` (`src/model-review.ts`) with a forced structured tool call.
The design hands the model one `report_verdict` tool, forces it with `toolChoice: "any"`, and reads the first `toolCall` content part by position — eliminating the `parse-failed` defer reason by construction.
Verified every SDK claim in the issue against the installed `@earendil-works/pi-ai` before committing to the design.

### Observations

- **SDK verification confirmed the issue's claims.**
  `providers/anthropic.js` `convertTools` reads only `parameters.properties` / `parameters.required` (plain JSON-Schema object works); `toolChoice` string → `{ type: <string> }`, so `"any"` forces a tool unnamed; `ToolCall.arguments` is `Record<string, any>`; under OAuth both tool defs and reply blocks are name-rewritten via `toClaudeCodeName`, so reading the reply's tool call **by position** (not name) is load-bearing, not incidental.
- **`toolChoice` is not on `StreamOptions`** — it rides through `ProviderStreamOptions = StreamOptions & Record<string, unknown>`.
  The injected `CompleteFn` seam is narrower, so the plan adds `toolChoice?: string` to its options bag.
- **The `Tool` cast is the one type friction.**
  `Tool.parameters` is `TSchema` (typebox-branded), which a plain object does not structurally satisfy; planned `as unknown as Tool` and flagged `pnpm run check` as the gate (the issue's `as Tool` may not typecheck).
- **Classified non-breaking.**
  `deferReason` (`parse-failed` → `no-tool-call`) lives only in a diagnostic review-log line, not config or a public API; the `config.example.json` strict-JSON directive becomes moot (not broken) under the forced tool, so no operator edit is needed on upgrade.
  Commit as `fix:`.
- **Cross-file fixture coupling drove the TDD order.**
  Flipping `reviewPath` to read tool calls breaks the text-JSON fixtures in `typo-reviewer.test.ts` and `extension.test.ts` at runtime in the same commit, so the plan folds all three test files' fixture updates into the single green commit and calls for the full package suite (not just `model-review.test.ts`) before committing.
- **Invariants at risk pinned to named tests** — #625 auth forwarding, #626 decision trail, ADR 0007 defer-always — each mapped to an existing test that survives with only a fixture-shape change.
- No `ask_user` gate: operator's own issue, unambiguous proposal, SDK facts verified.
  No follow-ups deferred.

## Stage: Implementation — TDD (2026-02-14T00:00:00Z)

### Session summary

Implemented the forced-verdict-tool-call fix across two TDD steps plus one preparatory Tidy-First commit.
`reviewPath` (`src/model-review.ts`) now sends a single `report_verdict` tool with `toolChoice: "any"` and reads the first `toolCall` content part by position, replacing the free-text `JSON.parse`; the `parse-failed` defer reason became `no-tool-call`.
Test count moved 42 → 43 (a new by-position read test added, the `parse-failed` test retargeted to `no-tool-call`); the full workspace suite (4212 tests) stays green.

### Observations

- **Tidy-First prep landed first.**
  The `tidy-first-assessor` recommended extracting the byte-identical `assistantText` envelope (duplicated in two files, hand-inlined in a third) into `test/fixtures/assistant-message.ts`.
  Landed as `test(pi-permission-model-judge): extract a shared assistant-reply fixture` before the feature, so the feature commit's cross-file fixture flip added `assistantToolCall` in exactly one place and called it three times.
- **The `as unknown as Tool` bridge was needed as predicted.**
  `Tool.parameters` is `TSchema`; the plain JSON-Schema object required `as unknown as Tool` (the issue's `as Tool` would not typecheck).
  `pnpm run check` was the gate, exactly as the plan flagged.
- **One lint friction: `as Tool[]` on `context.tools`.**
  The initial test asserted the tool shape via `context.tools as Tool[]`, which tripped `@typescript-eslint/non-nullable-type-assertion-style` (and `!` would loop with Biome per the code-design skill).
  Resolved by dropping the cast and asserting through optional chaining (`context.tools?.[0]?.name`) plus `toHaveLength`.
- **Cross-file fixture coupling behaved as planned.**
  After the source change, exactly the five `typo-reviewer`/`extension` tests using text-JSON fixtures failed at runtime; folding their `assistantToolCall` flips into the same feature commit restored green.
  The `model_judge.model_reply` debug assertion (`stringContaining("Doubled segment")`) survived because `rawReply` is now the stringified tool-call args, which still contain the reason.
- **Invariants held.** #625 auth-forwarding, #626 decision-trail, and ADR 0007 defer-always tests all pass unchanged in intent.
- **Pre-completion reviewer: PASS.**
  One non-blocking WARN: the `(complete as ReturnType<typeof vi.fn>).mock.calls[0]` destructuring in the request-shape tests is a pre-existing assertion-style pattern (retained to match the file's existing `apiKey`-forwarding test), not introduced by this change.

## Stage: Final Retrospective (2026-07-22T01:32:02Z)

### Session summary

One continuous session carried #628 from plan through TDD, ship, and release: `reviewPath` now forces a single `report_verdict` tool call and reads the verdict by position, retiring the `parse-failed` defer mode.
Shipped as `pi-permission-model-judge` v1.1.1 with the issue closed and the release-please PR merged.
Every plan prediction held — the SDK verification done up front, the `as unknown as Tool` cast, and the cross-file fixture coupling all played out exactly as written.

### Observations

#### What went well

- **Up-front SDK verification eliminated design risk.**
  Planning read `providers/anthropic.js` (`convertTools`, `toolChoice` handling) and `types.d.ts` (`ToolCall`, `ProviderStreamOptions`) before committing to the approach, so the implementation hit zero SDK surprises — the by-position tool-call read and the `Record<string, unknown>` `toolChoice` passthrough were both confirmed facts, not hopes.
  This is the payoff of the plan template's "verify against the SDK types" step on an unfamiliar API surface.
- **Tidy-First prep genuinely shrank the change.**
  The `tidy-first-assessor` spotted the byte-identical `assistantText` envelope duplicated across three test files; extracting it first (`b9019b8e`) turned the feature commit's cross-file fixture flip into adding `assistantToolCall` once and calling it three times.
  A textbook "make the change easy, then make the easy change."
- **Clean feedback loop.**
  Verification ran incrementally: red on the rewritten `model-review.test.ts`, green per-file, `pnpm run check` after the type changes, full-suite before the feature commit — the cross-module fixture breakage surfaced exactly where the plan said it would (five `typo-reviewer`/`extension` tests), not as an end-of-session surprise.

#### What caused friction (agent side)

- `other` — the request-shape test first asserted `context.tools as Tool[]`, which tripped `@typescript-eslint/non-nullable-type-assertion-style` (and `!` would loop with Biome per the code-design skill's non-null section).
  Self-identified at the pre-commit lint gate; resolved in ~2 tool calls by dropping the cast for optional-chaining assertions (`context.tools?.[0]?.name`).
  Impact: added friction but no rework — caught inside the same green cycle, before the feature commit.

#### What caused friction (user side)

- None.
  The issue was the operator's own, with a detailed and SDK-accurate proposal, so no mid-session redirection was needed and the `ask_user` design gate was correctly skipped.

### Diagnostic details

- **Model-performance correlation** — both read-only subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `claude-sonnet-5`; appropriate for judgment-heavy design/review work, no mismatch.
  Main session ran on opus/sonnet.
- **Escalation-delay tracking** — no `rabbit-hole` friction; the lone lint issue resolved in ~2 consecutive tool calls, well under the 5-call threshold.
- **Feedback-loop gap analysis** — verification was incremental (red per file, `check` after the shared-type change, full suite before commit), not end-loaded; the release-PR merge correctly waited for the in-progress CI check rather than falling back to `gh pr merge` while it ran.

### Changes made

1. `packages/pi-permission-model-judge/docs/retro/0628-force-structured-verdict-tool-call.md` — appended this Final Retrospective stage entry.
   No `AGENTS.md` or prompt changes: the session had no rework, and the one lint friction is already covered by the `code-design` skill's non-null-assertion-loop section (confirmed with the operator via `ask_user`).
