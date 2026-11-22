---
issue: 128
issue_title: "refactor: extract ForwardingManager class to encapsulate polling lifecycle"
---

# Retro: #128 — extract ForwardingManager class

## Final Retrospective (2026-05-08T02:00:00Z)

### Session summary

Extracted the forwarding poll lifecycle — 3 mutable fields on `ExtensionRuntime` and 2 free functions in `runtime.ts` — into a `ForwardingManager` class in `src/forwarding-manager.ts`.
Introduced a `ForwardingController` interface so `HandlerDeps` references a narrow type instead of the concrete class.
Shipped as v5.9.0 with zero behavioral change.
11 new unit tests, 3 removed; total suite 1260 tests across 57 files.

### Observations

#### What went well

- **Plan-to-code was nearly 1:1 again.**
  The two-commit structure (new class + tests, then wiring) from the revised plan strategy worked cleanly.
  Both deviations were small and self-contained.
- **Mechanical handler test updates were trivially correct.**
  Replacing `startForwardedPermissionPolling: vi.fn()` / `stopForwardedPermissionPolling: vi.fn()` with `forwarding: { start: vi.fn(), stop: vi.fn() }` across 7 test files was a predictable find-and-replace.
- **CI stayed green throughout.**
  No regressions in the 1260-test suite after either commit.

#### What caused friction (agent side)

- `missing-context` — Used `vi.runAllTimersAsync()` in tests for `ForwardingManager`, which uses `setInterval`.
  This caused an infinite loop ("Aborting after running 10000 timers").
  Self-identified on the first test run; fixed by switching to `vi.advanceTimersByTimeAsync(250)`.
  Impact: one test edit cycle (~1 minute), no incorrect commit landed.

- `missing-context` — Plan specified `readonly forwarding: ForwardingManager` in `HandlerDeps`, using the concrete class type.
  TypeScript's structural checker requires private fields (`timer`, `context`, `processing`, etc.) when the target is a class, so `{ start: vi.fn(), stop: vi.fn() }` in test mocks fails `pnpm run build`.
  Self-identified when running `pnpm run build` after the wiring step.
  Fixed by extracting a `ForwardingController` interface that `ForwardingManager` satisfies and `HandlerDeps` references.
  Impact: one additional interface + two extra edits to `types.ts`, ~2 minutes of rework, no incorrect commit landed.

#### What caused friction (user side)

- None observed.

### Changes made

1. Created `docs/retro/0128-extract-forwarding-manager.md` (this file).
2. Added fake-timer rule to `.pi/skills/testing/SKILL.md` — warns against `vi.runAllTimersAsync()` with `setInterval`.
3. Added interface-over-class rule to `.pi/skills/code-style/SKILL.md` — use narrow interfaces in shared dep types, not concrete classes.
