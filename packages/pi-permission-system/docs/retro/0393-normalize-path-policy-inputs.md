---
issue: 393
issue_title: "fix(pi-permission-system): normalize path policy inputs"
---

# Retro: #393 — fix(pi-permission-system): normalize path policy inputs

## Stage: PR Review (2026-06-12T14:20:51Z)

### Session summary

PR #393 (third-party, `@moekyo`) makes the path gates match relative tool/bash inputs against absolute allowlist rules by feeding the evaluator a set of equivalent "policy values" (absolute, project-relative, raw) derived from the known working directory.
The underlying gap is real: `PermissionManager.configureForCwd` already records the cwd, but the evaluator never used it, so a relative input like `src/App.jsx` could never match an absolute rule such as `/workspace/project/*`.
The operator chose to **adopt the capability and plan a simplified design** (direction 1), treating the PR as reference rather than the merge target, and to classify the behavior change as **breaking** (`feat!:`/`fix!:`).

### Evaluation

**Valuable core (keep):**

- `getPathPolicyValues` / `normalizePathPolicyLiteral` (`src/path-utils.ts`) — a clean way to derive the equivalent lookup forms for a path, reusing the existing `normalizePathForComparison` lexical cleanup.
- `evaluateAnyValue` (`src/rule.ts`) — genuinely distinct from `evaluateFirst`: it preserves global last-match-wins **across** aliases of the same path, so a catch-all match on the first alias can't mask a later, more specific rule on another alias.
  This is the right semantic for "same path, multiple spellings" and is correctly gated behind `PATH_SURFACES` in `permission-manager.ts` while MCP (genuinely different targets) keeps `evaluateFirst`.
- The cwd plumbing in `permission-manager.ts` (`currentCwd` captured in `configureForCwd`, threaded into `normalizeInput`).

**What I would change (simplify):**

- **Symbol side-channel.**
  `INTERNAL_PATH_POLICY_VALUES` (`src/input-normalizer.ts`) smuggles bash's pre-computed policy values through a symbol-keyed field on the tool `input` object — threaded `bash-path.ts` → `resolver.resolve` → manager → `normalizeInput`, then re-stamped onto the gate descriptor's `input` so it survives the post-approval gate run.
  This is over-wide threading and a divergent shape: `input` is meant to be raw tool input, and the gate now special-cases a symbol on it.
  The user-string guard (`getInternalPathPolicyValues` reads only the symbol, never a `pathPolicyValues` string key) is the correct least-privilege instinct, but the mechanism it protects is the part to rework.
  The real driver is that bash needs a per-token `resolveBase` (the effective dir after a literal `cd`) that `normalizeInput` can't compute — a simplified design should pass that resolution context explicitly rather than as a symbol on `input`.
- **Orphaned `pathTokens()`.**
  After the refactor, `bash-path.ts` consumes the new `pathRuleCandidates(cwd)` and `BashProgram.pathTokens()` is reachable only via `extractTokensForPathRules` (`bash-path-extractor.ts`), which is itself referenced **only** by `test/bash-external-directory.test.ts`.
  The PR keeps the method alive with a `fallow-ignore-next-line unused-class-member` comment instead of removing the now test-only chain.
  Per the package skill ("treat any declared field not read at runtime as a maintenance trap"), the simplified design should delete the orphaned `pathTokens` / `extractTokensForPathRules` surface, not suppress the flag.
- **Minor:** `evaluateAnyValue`'s returned `value` (the matching alias) is consumed only for MCP extras in `checkPermission`; for path surfaces it is discarded.
  Symmetry with `evaluateFirst` is fine, but worth noting the alias selection does no work on the path path.

**Behavior / breaking:** The change flips decisions on upgrade with no config edit.
In the loosening direction it weakens a gate — e.g. `path: { "*": "ask", "/workspace/project/*": "allow" }` turns a relative `src/App.jsx` from `ask` → `allow`.
For a least-privilege package that is a breaking change; the operator confirmed `feat!:`/`fix!:` with a migration note.

### Decision and attribution

**Direction:** Adopt the capability, plan a simplified design (use #393 as reference, not the merge target).
**Scope (in):** the `getPathPolicyValues` + `evaluateAnyValue` core, cwd plumbing, and docs/schema updates.
**Non-goals / rework:** drop the `INTERNAL_PATH_POLICY_VALUES` symbol side-channel in favor of explicit per-token resolution context for bash; remove the orphaned `pathTokens` / `extractTokensForPathRules` chain instead of `fallow-ignore`-ing it.
**Classification:** breaking (`feat!:`/`fix!:`) with a migration note covering the loosening case.

`/plan-issue` should plan around this recorded decision (the Decide gate is satisfied here) rather than re-litigate the direction.

**Attribution (required on every implementation/docs commit):**

```text
Co-authored-by: moekyo <shigotods@outlook.com>
```

The ship-stage PR close comment thanks `@moekyo` by name and links the implementing SHA(s).
Reference the PR as `Refs #393` / `(#393)` in commits — never `Closes #393` (it pre-empts the curated close comment).

## Stage: Planning (2026-06-12T00:00:00Z)

### Session summary

Produced `docs/plans/0393-normalize-path-policy-inputs.md` planning the simplified design the PR-review stage chose: keep `getPathPolicyValues`/`normalizePathPolicyLiteral`, `evaluateAnyValue`, and the cwd plumbing, but replace the `INTERNAL_PATH_POLICY_VALUES` symbol side-channel with an explicit `checkPathPolicy`/`resolvePathPolicy` method pair and remove the orphaned `pathTokens`/`extractTokensForPathRules` chain.
The `Decide` gate was already satisfied by the recorded PR-review decision, so the third-party `ask_user` direction gate was not re-run.
Plan is 9 TDD cycles (two `feat!:`), committed; next step is `/tdd-plan`.

### Observations

- Confirmed `runDescriptor` (`runner.ts`) uses `descriptor.preCheck` whenever set, and the bash path gate always sets it — so the PR's symbol stamp on `descriptor.input` was vestigial.
  The simplified design carries the per-token policy values through a dedicated resolver method instead of any field on `input`, eliminating both the symbol and the user-string-spoofing concern.
- Chose a new narrow method (`checkPathPolicy(values)` on `ScopedPermissionManager`, `resolvePathPolicy(values)` on `ScopedPermissionResolver`) over threading a `resolveBase` through `resolve`/`normalizeInput`: the `unknown`-base and no-cwd "literal only" decisions are bash-specific, so bash must own value computation and pass the finished array.
- Flagged the interface breaks (steps 4 and 5) as fold-fixtures-in-same-commit: `makeFakePermissionManager` (`session-fixtures.ts`) gains `checkPathPolicy`; `makeResolver`/`makeGateRunner`/`makePathDispatchResolver` (`gate-fixtures.ts`) gain `resolvePathPolicy`; grep both interface names for inline mocks.
- Used lift-and-shift for `pathTokens` removal (add `pathRuleCandidates` → migrate gate → delete) to keep every commit compiling.
- Did not port the PR's symbol-spoofing tests; replaced with one `normalizeInput` no-side-channel assertion.
- Breaking classification kept (`feat!:` on the manager and bash-gate steps) — relative inputs now match absolute allowlists, a loosening change for a least-privilege package; no config opt-out is named because none exists.

## Stage: Implementation — TDD (2026-06-12T00:00:00Z)

### Session summary

Implemented all 9 planned TDD cycles plus two follow-up docs commits (architecture listing + fixture skill), 11 commits total, every commit `Co-authored-by: moekyo`.
The simplified design landed as planned: `getPathPolicyValues`/`normalizePathPolicyLiteral` (`path-utils.ts`), `evaluateAnyValue` (`rule.ts`), cwd plumbing + `checkPathPolicy` + shared `buildCheckResult` (`permission-manager.ts`), `resolvePathPolicy` (`permission-resolver.ts`), `pathRuleCandidates` (`bash-program.ts`), and the gate migration — with the `INTERNAL_PATH_POLICY_VALUES` symbol replaced by the explicit `checkPathPolicy`/`resolvePathPolicy` pair and the orphaned `pathTokens`/`extractTokensForPathRules` chain removed.
Full suite green at 1972 tests (net change from a 1951 baseline: added ~40 new cases across 6 files, removed ~19 from the deleted `pathTokens`/`extractTokensForPathRules` blocks); `check`, `lint`, and `fallow dead-code` all clean.

### Observations

- One unplanned fixture fix: the bash path gate now resolves through `checkPathPolicy`, so `makeHandler` (`handler-fixtures.ts`) had to route `permissionManager.checkPathPolicy` through the same surface dispatcher as `checkPermission` — otherwise `makeSurfaceCheck({ path: deny })` only stubbed `checkPermission` and the real `tool-call.test.ts` bash-path block silently passed allow.
  Caught by the full-suite run after step 7, not by the directly-edited test file.
- The home-relative bash tests (`~/.ssh/config`, `$HOME/.ssh/config`) needed their `makePathDispatchResolver` `byPath` keys changed from the raw token to the home-expanded `/mock/home/.ssh/config`, because policy values now expand `~`/`$HOME` before dispatch while the raw token is kept only for prompts.
  Relative-token tests were unaffected since the literal alias stays in `policyValues`.
- Confirmed the PR's symbol stamp on `descriptor.input` was vestigial: `runDescriptor` uses `preCheck` whenever set and the bash path gate always sets it, so `descriptor.input` is never re-resolved — the simplified design drops the symbol with no behavior loss.
- Two interface-break steps (manager `checkPathPolicy`, resolver `resolvePathPolicy`) each folded their fixture/inline-mock updates into the same commit; `pnpm run check` immediately after each caught the `permission-resolver.test.ts` inline fake manager that needed `checkPathPolicy`.
- Deviation from the plan's Module-Level Changes: also updated `docs/architecture/architecture.md` (lines for `bash-path.ts`, `bash-program.ts`, `bash-path-extractor.ts`) — the plan didn't list it but its own guidance to check `docs/architecture/` for stale module listings applied.
  Committed as a separate `docs:`.
- Pre-completion reviewer: WARN (no FAILs).
  Sole finding — stale fixture descriptions in `package-pi-permission-system/SKILL.md` (`makeResolver`, `makePathDispatchResolver`, `makeFakePermissionManager` omitted the new stubs).
  Fixed in the final `docs:` commit before shipping, so the WARN is resolved.

## Stage: Final Retrospective (2026-06-12T21:04:22Z)

### Session summary

Shipped `@gotgenes/pi-permission-system` v13.0.0 — cwd-aware path-policy matching for tool inputs and bash tokens — across a single end-to-end session covering PR-review triage, planning, 9 TDD cycles, and shipping (CI green, issue closed, release-please PR #394 merged).
The third-party PR #393 (`@moekyo`) was adopted as reference with a simplified design (explicit `checkPathPolicy`/`resolvePathPolicy` pair replacing the PR's `INTERNAL_PATH_POLICY_VALUES` symbol side-channel; orphaned `pathTokens`/`extractTokensForPathRules` chain removed).
Two `feat!:` commits carried `BREAKING CHANGE:` footers; every implementation/docs commit credited `Co-authored-by: moekyo`.

### Observations

#### What went well

- **Retro-as-bridge worked end-to-end.**
  The PR-review stage recorded a precise Decide-gate decision (adopt + simplify, drop the symbol, remove the orphan chain, classify breaking).
  Planning read it, explicitly skipped re-running the third-party `ask_user` direction gate, and executed against it; TDD never re-litigated the direction.
  This is the multi-session lifecycle's context-bridge mechanism working as designed, collapsed into one session.
- **Pre-implementation code reading prevented carrying over dead mechanism.**
  Reading `runDescriptor` (`runner.ts`) during planning revealed the PR's symbol stamp on `descriptor.input` was vestigial (the bash path gate always sets `preCheck`, so `descriptor.input` is never re-resolved).
  This directly shaped the simpler design — no rework, the insight was confirmed again during TDD.
- **Incremental verification caught breakage at the seam, not at the end.**
  `pnpm run check` run immediately after each interface-break step (manager `checkPathPolicy`, resolver `resolvePathPolicy`) caught the inline fake manager in `permission-resolver.test.ts` the moment it broke.
- **The pre-completion reviewer earned its keep.**
  It caught the stale `SKILL.md` fixture catalog that the implementation missed; fixed before ship.

#### What caused friction (agent side)

- `missing-context` — adding `checkPathPolicy` to the manager required wiring it through the same surface dispatcher in `makeHandler` (`handler-fixtures.ts`); `makeSurfaceCheck({ path: deny })` stubs only `checkPermission`, so the new method returned its fixture default and the real `tool-call.test.ts` bash-path block silently passed `allow`.
  Self-identified via the full-suite run after step 7 (not the directly-edited test file).
  Impact: ~3 tool calls to diagnose and fix; folded into the same step-7 commit, no extra commit.
  A false-green on a deny path is security-relevant, so this is the most consequential friction of the session despite being small.
- `missing-context` — the package `SKILL.md` fixture catalog (`makeResolver`, `makePathDispatchResolver`, `makeFakePermissionManager`) was not updated when the new stubs were added; the pre-completion reviewer flagged it as the sole WARN.
  Impact: one extra `docs:` commit before ship; no rework, the safety net held.
- `other` (plan/file-list divergence) — the plan's Module-Level Changes omitted `docs/architecture/architecture.md`, but the plan's own prose guidance to check `docs/architecture/` for stale module listings applied; the listing referenced the removed `pathTokens`.
  Self-identified during the post-TDD cross-check.
  Impact: one extra `docs:` commit; no rework.

#### What caused friction (user side)

- None.
  The operator's strategic input was front-loaded into the PR-review Decide gate (direction + breaking classification), which let every downstream stage proceed without mechanical oversight — the intended division of labor.

### Diagnostic details

- **Model-performance correlation** — one subagent dispatch (`pre-completion-reviewer`) ran on `anthropic/claude-sonnet-4-6`, a valid registry alias; judgment-heavy review work on sonnet-4-6 is appropriate, no mismatch.
  Parent session interleaved `claude-opus-4-8` (design/triage/TDD) and `claude-sonnet-4-6`; no reasoning-weak model landed on judgment work.
- **Escalation-delay tracking** — no `rabbit-hole` points; the longest single-error sequence was the `makeHandler` regression, resolved in ~3 tool calls (locate test → read fixture → grep → edit), well under the 5-call escalation threshold.
- **Unused-tool detection** — no missing-context point would have been better served by an unused subagent or tool; the `makeHandler` gap was a runtime-behavior issue surfaced correctly by the full suite, not a search gap.
- **Feedback-loop gap analysis** — verification was incremental throughout: `pnpm run check` after each interface-break step, full suite after the gate migration (step 7) where it caught the fixture regression, and `check`/`lint`/`test`/`fallow` before ship.
  No end-only verification pattern.

### Changes made

1. `.pi/skills/package-pi-permission-system/SKILL.md` — added a Testing-section note: when a gate resolves through a new manager/resolver method beyond `checkPermission`/`resolve` (e.g. `checkPathPolicy`/`resolvePathPolicy`), wire it through the same surface dispatcher in `makeHandler` (`handler-fixtures.ts`), or `makeSurfaceCheck` leaves the new method returning its default and the gate silently passes `allow`.
2. `packages/pi-permission-system/docs/retro/0393-normalize-path-policy-inputs.md` — this Final Retrospective entry.

Considered but not implemented (recorded as no-ops): a redundant rule to update the `SKILL.md` fixture catalog when adding stubs (the pre-completion reviewer already catches this), and a generic `tdd-plan.md`/`AGENTS.md` interface-fixture-fanout rule (the lesson is package-specific to `makeHandler`'s surface-dispatch indirection).
