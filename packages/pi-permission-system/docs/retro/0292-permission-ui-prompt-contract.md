---
issue: 292
issue_title: "Harden the permissions:ui_prompt broadcast contract"
---

# Retro: #292 — Harden the `permissions:ui_prompt` broadcast contract

## Stage: Implementation — TDD (2026-06-01T23:30:00Z) — PAUSED (incomplete)

### Session summary

Began TDD execution of the plan on branch `feat/permission-ui-prompt-contract` (built from the #292 head, rebased onto `main`; koxx12-dev's and moekyo's commits sit at the base with authorship preserved).
Landed the green baseline plus the first two of the planned implementation commits.
Paused mid-implementation (context budget) with the working tree clean — commits 3–5, full verification, and pre-completion review remain.

### Commits landed this session (on top of the plan + #292 commits)

1. `3a0fc4e7` `style(...)`: green-baseline lint fixes — #292's last commit left lint red (the `&&` short-circuit in the `lint` script hid it).
   Fixed biome `organizeImports` (sorted `service.ts` exports + two test import lists), eslint `no-deprecated` (dropped the unreleased deprecated RPC-check re-exports from the `service.ts` barrel), and rumdl MD060 (README table alignment).
2. `1da4ef81` `feat!`: drop `protocolVersion` from `permissions:ready` (D5).
   `PermissionsReadyEvent` → `Record<string, never>`; `emitReadyEvent` emits `{}`.
   `PERMISSIONS_PROTOCOL_VERSION` kept for the RPC envelope.
   Breaking — has the `BREAKING CHANGE:` footer.
3. `9ec4ed34` `feat`: slim `ui_prompt` payload + centralize construction (plan steps 1, 2, 4, 7 + D6, merged).
   Lean `PermissionUiPromptEvent` (`requestId, source, surface, value, agentName, message, forwarding`); `forwarded_permission` removed from `PermissionUiPromptSource`; new `ForwardedPromptContext`; new leaf module `src/permission-ui-prompt.ts` with `buildDirectUiPrompt` / `buildRpcUiPrompt` / `buildForwardedUiPrompt`; `confirmPermission` restored to pure routing (no emit, no `uiPromptEvent` param) with the direct emit moved to `PermissionPrompter.prompt` gated on `ctx.hasUI`.

Baseline after commit 2: `check` clean, `lint` clean, full suite `1749 passed`.

### Decisions made this session (refinements to the plan)

- Commit slicing deviates from the plan's 9 micro-steps: the in-place type contraction forces every emit site and its tests to migrate together (testing-skill type-cascade rule), so plan steps 1/2/4/7 + D6 merged into commit `9ec4ed34`.
  End state is unchanged.
- Builders use **builder-owned narrow input types** (`DirectPromptInput`, `RpcPromptInput`, `ForwardedPromptInput`) that each call site satisfies structurally — chosen over taking `PromptPermissionDetails` to avoid a type-only import cycle and keep `permission-ui-prompt.ts` a true leaf. (User-confirmed.)
- No `import/no-cycle` lint rule adopted — rely on clean layering. (User-confirmed; the repo only has `no-parent-relative-imports`.)
- `protocolVersion` removed from **all** broadcast payloads including the shipped `ready` (no sacred cows — user-confirmed), making this PR a major bump.
  It stays only in the RPC reply envelope.
- `buildForwardedUiPrompt` defaults `source` to `"tool_call"` with null `surface`/`value` when the persisted request omits them (version-skew tolerance).

### Remaining work (resume here)

Commit 3 — forwarded non-degradation (plan steps 5+6), NOT yet started (working tree clean).
Worked-out design:

- `ForwardedPermissionRequest` (`src/permission-forwarding.ts`): add optional `source?: PermissionUiPromptSource`, `surface?: string | null`, `value?: string | null` (import `type PermissionUiPromptSource` from `./permission-events` — no cycle).
- Thread the display fields child→parent.
  In `PermissionPrompter.prompt`, build the event once (`const uiPrompt = buildDirectUiPrompt(details)`), emit it when `ctx.hasUI`, and pass `{ source, surface, value }` from `uiPrompt` to `confirmPermission` so normalization stays in one place (the builder).
- `confirmPermission` gains one param `forwarded?: { source; surface; value }` (a named type, e.g. `ForwardedPromptDisplay`, distinct from the builder's `ForwardedPromptInput`); it relays `forwarded` to `waitForForwardedPermissionApproval`. (Minor deviation from the plan's "bundle `message` too": keep `message` positional since the UI and deny branches use it; add exactly one new param for the structured fields — still "one param, not three".)
- `waitForForwardedPermissionApproval` writes `source`/`surface`/`value` into the request file when `forwarded` is provided.
- `processForwardedPermissionRequests` passes `request.source/surface/value` into `buildForwardedUiPrompt` (already wired; just add the three fields) so the parent emits a non-degraded event.
- Tests: prompter asserts the `{source,surface,value}` 5th arg to `confirmPermission`; `permission-forwarding.test.ts` gets a test for a request that carries the fields (non-degraded emit) alongside the existing fallback test; extend the composition-root forwarded round-trip (`test/composition-root.test.ts`, helper around line 148 simulates the parent responding) to assert the persisted request carries the fields.
  Note: `waitForForwardedPermissionApproval` polls with a 10-min timeout — use the fire-without-await + write-response pattern (package skill).

Commit 4 — best-effort emits (D7): wrap `emitReadyEvent` and `emitDecisionEvent` bodies in the same try/catch `emitUiPromptEvent` already uses.
Update `test/permission-events.test.ts` (add swallow-error tests for both).

Commit 5 — docs (step 8): `docs/cross-extension-api.md` (replace the 14-row field table with the lean table, document `surface`/`value` projection + `forwarding`, note broadcasts no longer carry `protocolVersion` — RPC envelope only, show the defensive-read consumer pattern, update the `PermissionsReadyEvent` description and channel table) and `README.md` (feature bullet wording).
Run `lint:md`.
Do not touch `CHANGELOG.md`.

After commit 5 — full verification (`check`, `lint`, full `test`, `pnpm fallow dead-code` from repo root, `git diff --name-only pnpm-lock.yaml`), cross-check the plan's module table, then the pre-completion reviewer dispatch, summarize, and update this retro to a completed entry.

### Observations

- `pnpm run lint`'s `&&` chain (`biome && eslint && rumdl`) masks later failures behind the first.
  When establishing a baseline, run each linter separately to see the full debt.
- `tsc` did not flag the test breakages in `permission-prompter.test.ts` / `permission-event-rpc.test.ts` (loose mock-call and `waitForReply` typing); they failed only at runtime.
  Always run the affected test files, not just `check`, after a payload-shape change.
- The branch has no upstream, so the `/tdd-plan` `git pull --ff-only` step fails by design — proceed (baseline was freshly rebased onto `main`).
</content>
