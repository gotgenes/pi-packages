---
issue: 283
issue_title: "Formatter extension seam for custom tool input previews"
---

# Retro: #283 — Formatter extension seam for custom tool input previews

## Stage: Planning (2026-05-31T00:00:00Z)

### Session summary

Produced a numbered implementation plan for the tool input formatter seam.
Confirmed both prerequisites (`#282` extract `ToolPreviewFormatter`, `#266` configurable limits) are shipped/closed, then designed a persistent `ToolInputFormatterRegistry`, a seam-first dispatch in `formatToolInputForPrompt`, a `registerToolInputFormatter` method on `PermissionsService`, and a reference built-in MCP input summarizer registered through the public seam.

### Observations

- Despite the dual `pkg:` label, the user confirmed this is **pi-permission-system only** — pi-subagents would reach outward to register, violating its "arrows point inward" principle, so the plan is filed in the package's `docs/plans/` beside `#266`/`#282` rather than the repo-root `docs/plans/`.
- `ToolPreviewFormatter` is constructed **fresh per tool call** (from `this.session.config`), so the formatter registry cannot be instance state on it — it must be owned by the extension factory (`index.ts`) and threaded in.
  This shaped the whole design.
- The seam convention follows pi-subagents' `registerWorkspaceProvider(provider): () => void` (single provider, throws on duplicate, identity-guarded disposer).
  Adopted the same: one formatter per tool name, duplicate `register` throws.
- Reference built-in decision: user chose the **MCP summarizer keyed to `mcp`** over a fictional `batch` tool.
  Important catch — MCP calls take an early-return branch in `formatAskPrompt` and never reach `formatToolInputForPrompt`, so the built-in needs a **second integration point** in the MCP branch (and changes existing MCP prompt tests).
  Captured as a dedicated TDD step.
- Precedence: registered formatter checked first for any tool; `undefined` falls through to the existing switch (user-selected).
  Lets extensions override even built-in tool previews.
- Made the new `PermissionGateHandler` constructor parameter **optional** so `makeHandler` and the two `external-directory-*.test.ts` handler constructions compile unchanged — only `index.ts` passes the shared registry.
  Minimizes test churn.
- Open questions deferred to implementation: whether to try/catch a throwing registrant, exact MCP summary wording, and whether to record this as a formal architecture roadmap phase.
  Flagged writing a disposable exploratory check against a real MCP payload before finalizing `formatMcpInputForPrompt`.
- Next step: `/tdd-plan` (this plan has red→green→commit cycles).

## Stage: Implementation — TDD (2026-05-31T21:05:00Z)

### Session summary

All five TDD steps completed across six commits (steps 1–4 plus a docs step plus a WARN fix).
Test count grew from 1628 to 1656 (+28), across 73 test files (up from 71).
Full suite, type check, lint, and `fallow dead-code` all pass.

### Observations

- **`ToolPreviewFormatter` is constructed fresh per call**, not held as instance state, so the formatter registry has to be owned by the extension factory (`index.ts`) and threaded in as an optional 4th constructor parameter on `PermissionGateHandler`.
  Making it optional left `makeHandler` and the two `external-directory-*.test.ts` constructions untouched — only `index.ts` passes the real registry.
- **MCP branch bypass** was the main design surprise.
  `formatAskPrompt`'s MCP early-return never called `formatToolInputForPrompt`, so the built-in MCP summarizer needed a deliberate second integration point there.
  Adding `case "mcp": return "";` to the switch was also necessary — without it, when a custom formatter declines, the switch default serialises the raw MCP event to JSON and appends it to the prompt.
- **Truncation test correction**: the initial test for "truncates the full summary when it exceeds the limit" used a single 200-char string value, but `renderArgValue` caps string values at 60 chars, so the total never reached the 160-char summary limit.
  Fixed by using three long-valued arguments so the joined summary exceeds 160 chars.
- `service.test.ts` had two inline `PermissionsService` literals that don't go through `makeService`; `tsc` caught them after adding the new interface method — both needed `registerToolInputFormatter: vi.fn()` added.
- **Pre-completion reviewer verdict: WARN** — one finding: `docs/architecture/architecture.md` still said "exposes two methods" after `registerToolInputFormatter` was added.
  Fixed in a follow-up `docs:` commit before closing.
- Deferred (Open Questions from the plan): try/catch guard on misbehaving formatters and the exact wording of the MCP summary prefix — settled on `with key: value, ...` format which reads naturally in the prompt.
  No follow-up issue needed for these; they are implementation details documented in the code.
- Post-review docs pass: a thorough authoring guide for `registerToolInputFormatter` was added to `docs/cross-extension-api.md` (commit `6d154a14`).
  It covers the per-tool `input` shapes, the must-not-throw contract, `undefined`-vs-`""` semantics, the grammatical-fragment guidance, an end-to-end register/dispose lifecycle example, and recommended practices.
  It also documents — and corrects an earlier misleading example about — the **MCP keying limitation**: the gate keys on the registered Pi tool name (`getToolNameFromValue`), so MCP calls all arrive under the `"mcp"` umbrella and cannot be keyed per `server:tool`; `"mcp"` is already held by the built-in.
  A potential follow-up surfaced: a chained/per-`server:tool` MCP formatter model would need a richer seam than the current one-formatter-per-name registry.

## Stage: Final Retrospective (2026-06-01T00:30:00Z)

### Session summary

Shipped `#283` end to end in one continuous session: planning, TDD (9 commits), `/ship-issue` (CI green, issue closed, release-please merged to `pi-permission-system@8.3.0`), a post-ship docs-thoroughness pass, and a courtesy follow-up to the original `#266` requester.
The feature — a `registerToolInputFormatter` seam plus a built-in MCP argument summarizer — works as designed, but three of the session's friction points share one shape: the agent delivered the mechanical minimum and the user had to push for the thorough version.

### Observations

#### What went well

- Incremental verification was disciplined: `pnpm run check` plus the targeted `vitest` file ran after each TDD step, not just at the end, so type and test regressions surfaced one step at a time.
- The plan flagged "confirm the real MCP input shape before writing `formatMcpInputForPrompt`," and the agent followed through with a `grep` of `mcp-targets.ts` / `input-normalizer.ts` instead of guessing the `{ tool, server, arguments }` shape.
- `ask_user` resolved genuine design ambiguity (precedence, reference-built-in target) cleanly in two focused calls without over-asking.
- The `#266` follow-up disclosed the MCP keying limitation honestly rather than overstating the feature.

#### What caused friction (agent side)

1. `scope-drift` (user-caught) — the first-pass docs for the public seam (`docs: document tool input formatter seam`, `2fc9ff1d`) were just the interface signature plus one example.
   The user had to ask "Did we thoroughly document how to create these formatters…?" which triggered a substantial authoring guide (`6d154a14`, +115/−19) covering per-tool `input` shapes, the must-not-throw contract, `undefined`-vs-`""` semantics, lifecycle wiring, and limitations.
   Impact: one extra user prompt and one follow-up commit; every gap was knowable when the thin docs were written.
2. `premature-convergence` (partly user-surfaced) — the agent committed to "MCP summarizer keyed to `mcp`" in planning without tracing the umbrella-keying constraint to its conclusion: because every MCP call arrives under the single `mcp` tool, the seam can *never* do bespoke per-MCP-tool rendering, which is literally what `#266`'s title ("smart formatters for known MCP tools") and the `ctx_batch_execute` example asked for.
   The limitation only became explicit while writing the authoring guide and was disclosed post-ship.
   Impact: no rework — the generic summarizer is still valuable — but the shipped feature only partially fulfills the original `#266` ask, surfaced after release.
3. `missing-context` (user-caught) — the `/ship-issue` close comment mentioned `#266`, but the agent did not proactively notify the human requester (`@kuba-4chain`) on their issue; the user prompted "We should also get back to the submitter of `#266`, right?"
   Impact: one extra user prompt and one follow-up comment to close the loop.
4. `instruction-violation` (self-identified) — the `/plan-issue` prompt says "multiple `pkg:*` labels → cross-package → root `docs/plans/`," but after the user confirmed the work was `pi-permission-system`-only, the agent filed the plan in the package directory instead.
   The override was correct (the determinant is which packages' code changes, not the labels), but the prompt's rule was mechanically wrong for this case.
   Impact: added deliberation, no rework.
5. `other` (self-caught) — the first "truncates the full summary" test used a single 200-char value that could not exceed the 160-char summary cap, because `renderArgValue` caps each value at 60 chars; fixed in the same red step with three long-valued arguments.
   Impact: negligible, caught before commit.

#### What caused friction (user side)

- Two of the friction points (docs thoroughness, notifying the `#266` submitter) were corrections the user could instead have pre-empted by stating up front "this is a public API — write authoring docs and notify the original requester on ship."
  Framed as opportunity: a one-line "treat this as a third-party-facing API" cue at planning time would likely have produced the thorough docs and the courtesy follow-up without the two mid-stream nudges.

### Diagnostic details

- **Model-performance correlation** — the only subagent dispatch was the `pre-completion-reviewer` on `anthropic/claude-sonnet-4-6`, judgment-heavy review work; appropriate task-model fit, and it caught a real staleness (`architecture.md` said "exposes two methods" after a third was added).
- **Feedback-loop gap analysis** — positive: verification ran incrementally (per-step `check` + targeted `vitest`), with `lint` and `fallow dead-code` reserved for the end where their cross-cutting scope belongs.
  No end-only-verification gap.
- Escalation-delay and unused-tool lenses found nothing notable (no rabbit-holes, no >5-call error loops, no obviously-skipped tool).

### Changes made

1. `AGENTS.md` (Code Style) — added a rule: public or cross-extension APIs must be documented for third-party authors (input/return contract, error/throw semantics, a minimal wiring example, known limitations), not just the type signature.
   Addresses friction #1.
2. `.pi/prompts/plan-issue.md` — clarified that `pkg:*` labels are a hint, not the determinant: a plan is cross-package only if code in more than one package actually changes; a confirmed single-package scope files in that package's directory despite multiple labels.
   Addresses friction #4.

Not implemented (user declined): proposal B (a `/ship-issue` step to notify an external requester when shipping work deferred from their issue, friction #3).
The behavior was still performed manually this session via the `#266` follow-up comment.
