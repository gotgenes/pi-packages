---
issue: 29
issue_title: "Re-add permission-request event channel with a proper public contract"
---

# Retro: #29 — Re-add permission-request event channel with a proper public contract

## Final Retrospective (2026-05-05T22:50:00Z)

### Session summary

Planned and implemented a 3-surface permission event API (decision broadcast, policy query RPC, prompt forwarding RPC) plus a `permissions:ready` signal.
9 TDD steps produced 77 new tests across 4 test files, with all 1109 tests passing at ship.
Released as v5.3.0.

### Observations

#### What went well

- The RPC handler tests using `createEventBus()` from the Pi SDK worked seamlessly — real event bus with `waitForReply` promise pattern made tests deterministic without timeouts or mocking.
- The closure-variable pattern for `autoApproved` tracking (step 8) was clean: capture the decision inside `promptForApproval`, read the flag after the gate returns.
- The plan's design overview translated directly to implementation — channel names, envelope shapes, and handler registration all shipped as planned.

#### What caused friction (agent side)

- `wrong-abstraction` — In step 6, attempted to replace a section of the 300-line `handleToolCall` function with three overlapping edits targeting the closing bracket of the old `applyPermissionGate` call rather than the opening.
  This left the original `const extDirGate = await applyPermissionGate(...)` intact alongside the new `const extDirGateResult = await applyPermissionGate(...)`, producing duplicate gate calls and a biome `noRedeclare` error.
  Impact: 2 extra edit rounds to remove the duplicate, plus the autoformatter flagging the lint failure.
  Self-identified.

- `missing-context` — Defined `PermissionEventBus` with only `emit()` in step 1, but `registerPermissionRpcHandlers` (step 3) calls `events.on()`.
  The mismatch wasn't caught until the final `npm run build` because Vitest doesn't typecheck.
  Impact: had to reconcile `RpcEventBus` and `PermissionEventBus` post-hoc and update all test mocks in a bulk fixup.
  Self-identified.

- `missing-context` — Integration test harnesses in `tests/permission-system.test.ts` and `tests/session-start.test.ts` construct raw `ExtensionAPI` stubs with `events: { emit: () => {} }` (no `on` method).
  Adding `registerPermissionRpcHandlers` to `index.ts` broke both files at runtime — discovered only on the full suite run after all steps.
  Impact: 2 extra file edits folded into the step 8 amend commit.
  Self-identified.

- `instruction-violation` — Used `vi.fn<[string, unknown], void>()` (2-type-arg form) which is invalid in the project's Vitest version (expects 0–1 type args).
  AGENTS.md doesn't explicitly call this out, but the "Vitest uses esbuild and does not typecheck" rule implies checking types earlier.
  Impact: 4 test files needed `sed` fixup.
  Self-identified.

#### What caused friction (user side)

- The session was interrupted between step 8's green confirmation and the commit.
  The user had to prompt "Let's continue" to resume.
  No rework resulted, but the interruption added a context-switch cost.

### Changes made

1. Wrote retro file at `docs/retro/0029-permission-event-channel.md`.
2. Added AGENTS.md rule: run `npm run build` after interface-change TDD steps.
3. Added AGENTS.md rule: grep all test harnesses when widening a shared interface.
