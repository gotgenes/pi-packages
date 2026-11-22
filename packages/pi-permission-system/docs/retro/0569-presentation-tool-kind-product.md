---
issue: 569
issue_title: "Move the presentation family onto the tool-kind product"
---

# Retro: #569 — Move the presentation family onto the tool-kind product

## Stage: Planning (2026-07-10T00:00:00Z)

### Session summary

Planned Phase 10 Step 2 of the pi-permission-system roadmap: migrate the presentation family (`tool-preview-formatter.ts`, `permission-prompts.ts`, `denial-messages.ts`, `handlers/gates/helpers.ts::deriveDecisionValue`) onto the Step 1 `access-intent/tool-kind.ts` product, consolidating the private `denial-messages.ts::isMcpCheck` derivation into a single shared `isMcpCheck` alongside `classifyToolKind`.
Wrote a five-step TDD plan (one true red for the new `isMcpCheck` unit tests, the rest behavior-preserving refactors under the existing green suite) and committed it as `docs/plans/0569-presentation-tool-kind-product.md`.

### Observations

- **Shared `isMcpCheck` must keep the `source === "mcp"` disjunct.**
  `classifyToolKind(toolName)` keys purely on the tool name, but the presentation MCP-ness derivation also considers `source === "mcp"` — and `deriveSource` (Step 1) can set `source: "mcp"` on a result whose `toolName` is a server-qualified string.
  Two existing characterization tests pin this exact case (`denial-messages.test.ts` "MCP source with target on non-mcp toolName", `tool-preview-formatter.test.ts` "returns undefined for mcp source"), so a naive reduction to `classifyToolKind(...) === "mcp"` would regress.
- **Target-presence separated from MCP-classification (SRP).**
  The old private `isMcpCheck` baked in `&& !!check.target`.
  Chose to make the shared predicate MCP-ness only (no target) and hoist `&& check.target` to the three denial sites and the one prompt site that need it (also gives TS truthy-narrowing); `tool-preview-formatter.ts` deliberately omits it, matching its original which had no target check.
  One predicate, uniform across all four files.
- **Roadmap wording nuance.**
  The Step 2 roadmap entry says "delete `isMcpCheck`" — this means delete the *private* copy in `denial-messages.ts`; the plan promotes a shared `isMcpCheck` to `tool-kind.ts`.
  Noted so the Landed bullet phrases it as relocate-and-share, not a plain delete.
- **Metric outcome.**
  After migration the recompute grep (`toolName === "(bash|mcp)"|source === "mcp"`) drops from 12 to an expected 2, both inside `tool-kind.ts` (the module docstring and the `source === "mcp"` disjunct in `isMcpCheck`) — within the Phase 10 end-state target of ≤ 4.
  Migrated `classifyToolKind(x) === "bash"` does not match the grep (the `)` before `===`), as confirmed by Step 1.
- **`deriveDecisionValue` empty-path fallback.**
  The original `if (path) return path; return toolName` treats `""` as falsy; preserved with a truthy ternary (not `??`), pinned by `helpers.test.ts`.
- **Release posture.**
  `refactor:` (hidden changelog type), **tail** of batch "tool-kind-dispatch" (head Step 1 / #568 landed) → ship now (land the batch tail); does not cut a release on its own, auto-batches into the next releasing change.
- **First-party, unambiguous** → no `ask_user` gate; the one design choice (single no-target predicate) was resolved via code-design/SRP heuristics and existing characterization coverage.

## Stage: Implementation — TDD (2026-07-10T16:12:00Z)

### Session summary

Executed the five-step plan: added the shared `isMcpCheck` to `access-intent/tool-kind.ts` and migrated the four presentation consumers (`denial-messages`, `permission-prompts`, `tool-preview-formatter`, `deriveDecisionValue`) onto `classifyToolKind`/`isMcpCheck`, then recorded the roadmap step in `architecture.md`.
Four `refactor:` commits + one `docs:` commit; the suite grew 2317 → 2321 (+4, the new `isMcpCheck` unit tests).
The recompute grep dropped from 12 to 2 (both inside `tool-kind.ts`: the docstring and the `isMcpCheck` `source === "mcp"` disjunct), within the Phase 10 end-state target of ≤ 4 — completing the "tool-kind-dispatch" batch (tail).

### Observations

- **Pre-completion reviewer: PASS** — all deterministic checks green (`check`, root `lint`, 2321 tests, `fallow dead-code`), all three behavior-preservation focus areas verified (the `&& target` guard relocation, the preserved `source === "mcp"` disjunct, the exhaustive-switch empty-path fallback), 4 Mermaid charts re-rendered clean, cross-step invariants intact.
  No warnings.
- **One in-step lint fixup (deviation, folded into Step 4).**
  `@typescript-eslint/prefer-nullish-coalescing` flagged the empty-path ternary `path ? path : toolName`.
  Replaced with `path || toolName` plus a documented `eslint-disable-next-line` (the testing skill's idiom), preserving the original `if (path)` truthiness so an empty-string `path` falls through to `toolName` — `??` would have returned `""` and changed behavior.
- **No new characterization tests needed.**
  The four presentation characterization suites already pinned every branch — including the two critical `source === "mcp"`-disjunct tests (`denial-messages.test.ts` "MCP source with target on non-mcp toolName", `tool-preview-formatter.test.ts` "returns undefined for mcp source") — so each migration was a pure refactor under green with the test files unmodified.
- **Reviewer's benign side-effect note.**
  Routing through `classifyToolKind` inherits its `toolName.trim()` (from Step 1), so the presentation sites now trim before comparing where they used bare `===`.
  Real tool names never carry surrounding whitespace, so this is not an observable change.
- **Plan held exactly.**
  All touched files matched the Module-Level Changes list; the metric prediction (12 → 2) and the SRP design (single no-target `isMcpCheck` with `&& target` hoisted to call sites) landed as written.

## Stage: Final Retrospective (2026-07-11T03:00:54Z)

### Session summary

One continuous session carried #569 through all four stages — plan, TDD, ship, retro — for Phase 10 Step 2 of the pi-permission-system roadmap, completing the "tool-kind-dispatch" batch.
The implementation landed cleanly: five red→green→commit cycles (four `refactor:` + one `docs:`), suite 2317 → 2321 (+4 `isMcpCheck` unit tests), pre-completion PASS, CI green, issue closed, no release cut (all commits are `refactor:`/excluded-`docs:`, so the batch auto-defers to the next releasing change).
One minor self-caught lint fixup; zero rework, zero user corrections, zero CI or reviewer failures.

### Observations

#### What went well

- **Plan-to-execution fidelity, second consecutive batch step.**
  Like #568, the plan's predictions held exactly: the SRP design (one no-target `isMcpCheck`, `&& target` hoisted to call sites), the metric (recompute 12 → 2, both inside `tool-kind.ts`), and the Test Impact Analysis (existing suites already pin every branch, no new characterization tests) all landed as written.
  The two `source === "mcp"`-disjunct characterization tests the plan called out (`denial-messages.test.ts` "MCP source with target on non-mcp toolName", `tool-preview-formatter.test.ts` "returns undefined for mcp source") were the exact safety net that made each migration a pure refactor under green.
- **Fold-first-consumer mitigation worked again.**
  Introducing `isMcpCheck` and migrating `denial-messages.ts` in the same commit kept the export from ever landing unwired — `fallow dead-code` stayed green, as the plan's mitigation anticipated.

#### What caused friction (agent side)

- `other` (plan mispredicted the lint-safe form) — the plan's `deriveDecisionValue` sketch used a truthy ternary (`path ? path : toolName`) to preserve the empty-path fall-through, but `@typescript-eslint/prefer-nullish-coalescing` also flags the `x ? x : y` ternary, not just `||`.
  The commit hook rejected it; I switched to `path || toolName` + an `eslint-disable-next-line` (the testing skill's documented idiom).
  Self-identified (caught by the pre-commit gate).
  Impact: one extra edit + one eslint re-run within Step 4, no rework, no reorder.
- `missing-context` (malformed read path) — an early planning read used `/Users/chris/development/pi/pi-permission-system/src/permission-manager.ts` (missing the `pi-packages/packages/` segment), which the permission system correctly denied as an external-directory access.
  Re-read with the correct `packages/pi-permission-system/...` path immediately.
  Impact: one denied tool call, no rework.

#### What caused friction (user side)

- None.
  User involvement was mechanical flow-approval only; no strategic redirection was needed and none was missing.
  The one permission denial was the extension doing its job on an agent-side path typo, not a user intervention.

### Diagnostic details

- **Model-performance correlation** — one subagent dispatch: the `pre-completion-reviewer` on judgment-heavy review work (deterministic gates + behavior-preservation verification).
  Appropriate match; it ran the gates and returned a scoped PASS with accurate recompute numbers.
- **Escalation-delay tracking** — no `rabbit-hole` friction; the lint error resolved in a single edit, no error sequence exceeded one tool call.
- **Unused-tool detection** — nothing missed; `grep`/`read` covered the small exploration surface (this was a well-specified refactor with the plan already in hand).
- **Feedback-loop gap analysis** — verification ran incrementally: `pnpm run check` after the shared-type step and again after Step 4, the affected test file per red→green cycle, then the full suite + root `lint` + `fallow dead-code` before the reviewer.
  No end-of-session-only verification.

### Changes made

1. `.pi/skills/testing/SKILL.md` (Operator semantics) — noted that `@typescript-eslint/prefer-nullish-coalescing` also flags the `x ? x : y` ternary, not only `||`, so a ternary cannot be used to dodge the rule; use `x || y` with the disable.
