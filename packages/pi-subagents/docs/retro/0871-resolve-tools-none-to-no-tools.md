---
issue: 871
issue_title: "pi-subagents: an agent declaring tools: none receives all seven built-in tools"
---

# Retro: #871 — pi-subagents: an agent declaring tools: none receives all seven built-in tools

## Stage: Planning (2026-09-05T06:27:57Z)

### Session summary

Committed `packages/pi-subagents/docs/plans/0871-resolve-tools-none-to-no-tools.md` (2 steps: one `fix:` cycle with three new registry tests, one `docs:` step marking Phase 22 Step 13 landed).
The operator chose the one-line delegating body for `getToolNamesForType` over a bare operator flip, and `fix:` (patch) over `fix!:` — matching the roadmap's Step 13 entry.
No follow-up issues filed.

### Observations

- The design settled on replacing the whole five-line body with `return this.resolveAgentConfig(type).toolNames ?? [...BUILTIN_TOOL_NAMES];` rather than flipping `?.length ?` to `??` in place.
  The delegating form removes a **second** fail-open of the same shape — the `enabled !== false` guard, which turned "this agent is disabled" into "give it all seven" — and ends a live disagreement where the same disabled type yielded its own prompt and model from `resolveAgentConfig` but everyone's tools from `getToolNamesForType`.
- Measured rather than argued, per the plan's own table: both candidate bodies were spiked into `src/config/agent-types.ts` and the full package suite run (76 files / 1561 tests, green under each), with the file restored from a `/tmp` backup copy after each.
  That answers the issue's stated open question — nothing depends on the current coalescing — and also establishes that the disabled-agent branch has no pin, which is why the plan adds one.
- The SDK end was verified from compiled source, not types: `dist/core/sdk.js:141,144` in the pinned `@earendil-works/pi-coding-agent@0.84.4` uses `options.tools ?? …`, so an empty allowlist is honored rather than falling back to the SDK defaults.
  The `.d.ts` shows only `tools?: string[]` and would not have answered it.
- Breaking classification was surfaced to the operator even though the roadmap had already recorded `fix:`.
  The change does alter observable behavior on upgrade with no user edit (seven tools → zero), but `docs/configuration.md:177` has always documented `tools: none # no tools at all`, no agent file in this repo declares it, and the operator confirmed `fix:` → 21.4.2.
- `docs/configuration.md` needs no edit: the code moves to the doc, not the other way round.
  This was checked by grep rather than assumed — no live doc, README section, or skill asserts the buggy behavior.

#### Deferred tidyings

- `packages/pi-subagents/src/config/agent-types.ts` + `src/config/custom-agents.ts` — `BUILTIN_TOOL_NAMES` is handed out **by reference** in two places (`custom-agents.ts:62` as `listField`'s default, `agent-types.ts:116` in the absolute fallback), so a future consumer that mutates a returned `toolNames` array would corrupt the module constant.
  The Tidy-First assessor confirmed no current consumer mutates (`session-config.ts:156,178`, `create-subagent-session.ts:256` only read, spread, or map), and rejected freezing it as scope creep for a `fix:`.
  Worth its own hardening issue.
- `packages/pi-subagents/test/config/agent-types.test.ts` — the `describe("getToolNamesForType")` block will hold seven flat siblings after this change, mixing per-agent spot-checks with the `toolNames` field's own present/empty/absent axis.
  Offered by the assessor as Optional and marked not required; declined here to keep the change tight.
