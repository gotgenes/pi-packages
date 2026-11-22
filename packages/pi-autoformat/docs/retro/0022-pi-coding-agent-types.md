---
issue: 22
issue_title: "Depend on @earendil-works/pi-coding-agent for runtime types instead of duck-typing"
---

# Retro: #22 — Depend on `@earendil-works/pi-coding-agent` for runtime types instead of duck-typing

## Final Retrospective (2026-05-02T02:45:00Z)

### Session summary

Planned and shipped issue #22 — replaced the duck-typed `*Like` aliases in `src/extension.ts` with real types imported from `@earendil-works/pi-coding-agent@^0.72.0` (added as a `devDependency`).
Four implementation commits (`2d93a5e`, `304bd68`, `f9ef728`, `261bd05`), one biome fixup amended into the test commit, CI green, issue closed, release-please PR `#21` (pre-existing 2.3.1) merged.
The planned `ExtensionAPIWithEvents` workaround turned out to be unnecessary — Pi 0.72.0's `ExtensionAPI` already declares `events: EventBus` — and was dropped in the implementation commit.

### Observations

#### What went well

- The planning gate caught one real ambiguity (full `ExtensionContext` vs `Pick<...>` at internal helpers) and used `ask-user` once with three concrete options.
  The chosen narrow-`Pick` shape kept the test-stub diff tractable.
- `pnpm exec tsc --noEmit` filled in for vitest as the red/green signal on a typing-only refactor — vitest's esbuild transform strips types, so runtime tests passed even when `src/extension.ts` and `test/extension.test.ts` had real type errors mid-step.
  Splitting the work into `refactor: import Pi types from pi-coding-agent` (`f9ef728`, intentional broken `tsc`) and `test: adopt class-based Theme stubs and Pi event types` (`261bd05`, green) preserved a coherent commit-by-commit story even though one intermediate commit didn't typecheck.
  Worth promoting as a project pattern: add a `typecheck` script so future type-only refactors don't have to remember the incantation.
- The user's mid-flight question — "We're confident that's the latest release of the npm package, right?" — was a clean trust gate.
  I had checked `npm view @earendil-works/pi-coding-agent version` during planning, but hadn't restated it.
  A 30-second re-verify (`dist-tags.latest = 0.72.0`, last modified the same day) closed the loop with no rework.

#### What caused friction (agent side)

- `missing-context` (self-identified, mid-execution) — The plan claimed "Pi's `events` channel is **not** part of `ExtensionAPI` today" and prescribed an `ExtensionAPIWithEvents` intersection alias as the workaround.
  In implementation I grepped `node_modules/.../types.d.ts` more carefully and found `events: EventBus` declared right under the `on(...)` overloads.
  Impact: dropped the workaround in the same `f9ef728` commit, simplified `subscribeToEventBus`, recorded it as a deviation in the close comment.
  No rework cycles, but the plan was wrong about a load-bearing design detail.
  Root cause: during plan-phase research I read `dist/index.d.ts`'s re-export line and `dist/core/extensions/index.d.ts`'s `export type` list, then jumped to interface bodies via `grep -A 30 "interface ExtensionAPI"` — but the `events` declaration sits below the long `on(...)` overload block, outside the 30-line window.
  The lesson: when a plan asserts something *isn't* in an upstream type, grep the full interface body, not the first N lines.
- `premature-convergence` (self-identified, low-impact) — Plan step 2 prescribed a `// @ts-expect-error` block that "currently red-flags against the duck type" and "goes green in step 4".
  In practice the typecheck-only file (`test/types/theme-stub.test-d.ts`) imports `Theme` directly from `@earendil-works/pi-coding-agent`, so its assertion is independent of `src/extension.ts` typing — green from the moment it's written.
  Impact: a slightly misleading TDD-ordering note in the plan; no commit churn.
- `wrong-abstraction` (small, self-identified) — Plan claimed `TestPi.on` could be typed as `ExtensionAPI["on"]`.
  In practice, `ExtensionAPI["on"]` is a 26-overload signature that `TestPi`'s narrow harness can't structurally satisfy without modelling every event union.
  Resolution: cast through `unknown` once on `TestPi.on`, expose an `asExtensionAPI()` helper, and `sed` 28 call sites to use it.
  Impact: one mechanical bulk substitution; the test-side type fidelity is weaker than the plan implied (we're casting at the boundary, not type-anchored).
  Acceptable per the plan's stated goal — what matters is `ctx.ui.theme: Theme` catches plain-arrow stubs, which still works.

#### What caused friction (user side)

- None observed.
  The trust-gate question on the npm version was useful, not friction.
  No premature corrections, no scope changes mid-flight.

### Novel wins

- First time on this repo a typing-only refactor was structured around `tsc --noEmit` as the test signal.
  Pattern worked cleanly; the only friction was that no `typecheck` script exists in `package.json`, so each red/green cycle required `pnpm exec tsc --noEmit` typed by hand.

### Changes made

1. Added `"typecheck": "tsc --noEmit"` to `package.json` `scripts`.
2. Added a one-line `AGENTS.md` § Testing note pointing future type-only changes at `pnpm run typecheck`.
3. Updated `.github/workflows/ci.yml` to call `pnpm run typecheck` instead of inlining `pnpm exec tsc --noEmit`.
4. Created `docs/retro/0022-pi-coding-agent-types.md`.
