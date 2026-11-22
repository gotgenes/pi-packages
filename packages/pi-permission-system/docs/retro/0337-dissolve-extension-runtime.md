---
issue: 337
issue_title: "Dissolve ExtensionRuntime; one source of truth for session state"
---

# Retro: #337 — Dissolve ExtensionRuntime; one source of truth for session state

## Stage: Planning (2026-06-06T22:30:24Z)

### Session summary

Produced the implementation plan for Phase 4 Step 4: dissolving the `ExtensionRuntime` god object and unifying session state.
Confirmed Steps 1–3 (`#334`/`#335`/`#336`) are complete and that the transitional `RuntimeContextRef` seam was explicitly left for this step to retire.
Traced the split-brain through `index.ts`, `runtime.ts`, `config-store.ts`, `permission-session.ts`, `permission-event-rpc.ts`, `config-modal.ts`, and `permissions-service.ts`.

### Observations

- The codebase actually has *two* split-brains, not one.
  The documented one is `PermissionManager` / `SessionRules`: the gate path uses a separate `sessionManager` and `PermissionSession`'s private `new SessionRules()`, while the RPC check / config-modal / `LocalPermissionsService` read `runtime.permissionManager` / `runtime.sessionRules`.
  The second, quieter one is context: `ConfigStore` reads/writes `runtime.runtimeContext` via `RuntimeContextRef`, while `PermissionSession` owns its own private `this.context` — kept in sync only by `session_start` call order.
  The plan closes both.
- Decided to split delivery into a `fix:` commit (share single instances, minimal structural change, runtime object still present) and a `refactor:` commit (dissolve the runtime, retire `RuntimeContextRef`, delete `runtime.ts`).
  This isolates a real `fix:` (patch release) from behavior-preserving churn and keeps each commit green.
- `test/runtime.test.ts` is fully redundant: every path-derivation case already exists in `test/extension-paths.test.ts` against `computeExtensionPaths`; default-config in `config-store.test.ts`; logger wiring in `composition-root.test.ts`.
  Deletes cleanly with no coverage loss.
- `makeSession` in `handler-fixtures.ts` is a duck-typed mock, not a real `PermissionSession`, so the new injected `SessionRules` constructor slot only affects `permission-session.test.ts` `createSession` and `index.ts` — not the gate-handler fixtures.
- `src/runtime.ts` can be deleted outright rather than left as a re-export shell: no module imports `ExtensionPaths` from it (consumers already import from `extension-paths.ts`).
- Characterization-test approach: drive a gate session-approval through the composition root with a UI `ctx` whose `ui.select` returns `options[1]` (label-agnostic "for this session"), then assert the RPC check and `getPermissionsService().checkPermission` both report `allow`.
  Red on current code (RPC reads empty session rules), green after the fix.
- No `ask_user` needed — the issue's proposed change and the roadmap pin the design unambiguously.

## Stage: Implementation — TDD (2026-06-06T23:03:30Z)

### Session summary

Completed all three TDD steps: a `fix:` commit sharing one `PermissionManager` and `SessionRules` across the gate and RPC paths (bug fix), a `refactor:` commit dissolving `ExtensionRuntime` and retiring `RuntimeContextRef`, and a `docs:` commit updating the architecture roadmap plus marking Step 4 complete.
Test count: 1837 → 1838 (characterization test added in `composition-root.test.ts`) → 1815 (86 files; `runtime.test.ts` deleted, its 23 tests already covered by `extension-paths.test.ts`).
Pre-completion reviewer returned WARN; both findings were resolved inline.

### Observations

- The `prefer-const` / `@typescript-eslint/no-unnecessary-condition` lint conflict on the `session` forward reference was resolved by introducing a `sessionNotify: PermissionSession | null = null` holder.
  The logger's notify closure uses `sessionNotify?.getRuntimeContext()` (correctly nullable), while `session` is declared `const` after `PermissionSession` is constructed.
  This is cleaner than `null as unknown as PermissionSession` because optional chaining on the holder is safe, and there is no `as unknown as` cast to suppress.
- The `let configStore = null as unknown as ConfigStore` forward reference mirrors the pattern that existed in `createExtensionRuntime` and was retained (documented in a comment).
- Two context-seam tests in `config-store.test.ts` ("updates context via context.set", "does not overwrite context when ctx is omitted") were replaced with direct ctx-parameter behavior tests ("uses the passed ctx cwd for `loadAndMergeConfigs`", "uses empty string cwd when no ctx is provided").
  No coverage lost; the `makeContextRef` helper and `RuntimeContextRef` import were removed.
- The `@typescript-eslint/no-deprecated` lint error on `PERMISSIONS_RPC_CHECK_CHANNEL` in the new composition-root test was fixed by extracting the channel value to a local `const rpcCheckChannel: string = PERMISSIONS_RPC_CHECK_CHANNEL` with a single `eslint-disable-next-line` annotation — cleaner than per-use suppressions.
- Reviewer WARN 1 (Step 4 not marked `✓ complete` in `architecture.md`) was addressed immediately with an additional `docs:` commit, per the package skill requirement to mark steps complete at ship time rather than deferring.
- Reviewer WARN 2 (pre-existing three-field cache reset in `permission-session.ts` without a `clearCaches()` helper) is a known smell documented in the Phase 4 plans; not introduced by this PR.

## Stage: Final Retrospective (2026-06-06T23:33:45Z)

### Session summary

Shipped Phase 4 Step 4 end-to-end across four stages (plan → TDD → ship → retro): dissolved the `ExtensionRuntime` god object, fixed the session-rules / `PermissionManager` split-brain, and released `pi-permission-system@v10.3.1`.
The plan was accurate enough that TDD execution matched it almost line-for-line; all friction was lint-driven micro-rework caught pre-commit by the verification loop.
No user corrections were needed beyond a single "Continue." nudge and a status check.

### Observations

#### What went well

- Model-task fit across the workflow was clean (see Diagnostic details): `opus` for plan/retro judgment, `sonnet` for implementation, and a `deepseek-v4-flash` model executing the deterministic `/ship-issue` workflow flawlessly — correctly escalating the one judgment point (stacked-release batch-vs-now) to the user via `ask_user` rather than deciding alone.
- The `sessionNotify: PermissionSession | null` nullable-holder pattern cleanly resolved the forward-reference + Biome/ESLint conflict in `index.ts` without an `as unknown as` cast on the session reference (the `configStore` ref kept the pre-existing `null as unknown as ConfigStore` idiom).
- Plan accuracy: the two-split-brain diagnosis, the `fix:` + `refactor:` split, and the zero-coverage-loss deletion of `runtime.test.ts` all played out exactly as the plan predicted — the planning-stage exploration (reading every consumer + `extension-paths.test.ts` overlap) paid off directly.
- The verification loop ran incrementally (`pnpm run check` after each interface change, targeted `vitest` for red/green, full lint+test before every commit), so every slip was caught before commit.

#### What caused friction (agent side)

- `instruction-violation` (self-identified) — the first `index.ts` rewrite used `configStore!.current()` (a `!` assertion) plus an `eslint-disable` for `@typescript-eslint/no-non-null-assertion`, despite AGENTS.md's "Biome / ESLint linter conflicts" rule banning `x!`.
  `pnpm run lint` flagged it (5 errors: 2× `prefer-const`, the unused disable directive, 2× unnecessary optional chain); the fix was the nullable-holder rewrite.
  Impact: one `index.ts` rewrite, caught pre-commit — no wasted commit, no shipped defect.
- `other` (self-identified) — appending the TDD stage entry to the retro via `Edit` produced a malformed file: the supplied `newText` was incomplete (ended mid-sentence) and the one-sentence-per-line autoformat interleaved it into the Planning observations.
  Re-reading caught it; a full `Write` fixed it.
  Impact: one retro rewrite.
  Note: retro files accumulate repeated `### Observations` / `### Session summary` headers across stages, so `Edit` anchors on those headers are inherently ambiguous.
- `other` (self-identified) — two transient editing slips in `config-store.ts` / the deprecated-channel test: a dead `cwdOrNull` local (removed immediately) and `eslint-disable` comments placed on the wrong lines (refactored to a single local-const disable).
  Impact: ~1 extra edit each; no rework beyond the same step.

#### What caused friction (user side)

- None of substance.
  The user's involvement was light-touch oversight (one "Continue." after a turn ended without a trailing tool call, and one "Where are we?" status check) rather than strategic correction — appropriate for a session executing a detailed pre-approved plan.

### Diagnostic details

- **Model-performance correlation** — Planning `anthropic/claude-opus-4-8` (judgment-heavy design tracing), TDD `anthropic/claude-sonnet-4-6` (implementation), Shipping `opencode-go/deepseek-v4-flash` (mechanical procedural workflow), Retro `anthropic/claude-opus-4-8` (synthesis).
  No mismatches: the flash model on `/ship-issue` is the intended fit — a deterministic workflow where the sole judgment call was correctly delegated to the user.
  The `pre-completion-reviewer` subagent ran on its own frontmatter model and produced a thorough WARN report (deterministic checks, acceptance criteria, code design, Mermaid parse) — quality adequate for the judgment-heavy review.
- **Escalation-delay tracking** — no rabbit-holes; the longest same-error sequence was the `index.ts` lint conflict at one lint run → one rewrite (well under the 5-call threshold).
- **Unused-tool detection** — no `missing-context` or `rabbit-hole` points; no subagent or `colgrep` opportunity was missed (planning-stage `grep`/`read` exploration was sufficient).
- **Feedback-loop gap analysis** — no gap; verification was incremental throughout, not end-loaded.

### Changes made

1. `.pi/prompts/tdd-plan.md` — added retro-append guidance: anchor the `Edit` on the file's last line or use `Write`, since repeated stage headers make header-anchored edits ambiguous.
2. `.pi/prompts/build-plan.md` — same retro-append guidance line.
3. `.pi/prompts/retro.md` — same guidance, added beside the existing "append the new entry" instruction in Step 3.
