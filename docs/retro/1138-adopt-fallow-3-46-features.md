---
issue: 1138
issue_title: "Evaluate fallow 3.46 features: mutation, audit --staged, publicFiles, package-cycle, V8 coverage, test_reach"
---

# Retro: #1138 — Evaluate fallow 3.46 features: mutation, audit --staged, publicFiles, package-cycle, V8 coverage, test_reach

## Stage: Planning (2026-11-23T02:23:50Z)

### Session summary

Measured each of the seven features (six from the issue body and `private-type-leak` from its comment) on the real tree and in a throwaway worktree of `d193e6f1`, then put a decision per feature to the operator.
Wrote a five-step build plan (`docs/plans/1138-adopt-fallow-3-46-features.md`).
Filed [#1140] for the barrel/`publicFiles` work and recorded its Phase 16 disposition in pi-permission-system (`b6c8a833`).

### Observations

- **Operator decisions:**
  - `mutation`: on-demand recipe only (no reviewer or CI step).
  - `audit --staged`: pre-commit hook.
  - `package-cycle`: raised to `error`.
  - `private-type-leaks`: `off`, re-enabled in [#1140].
  - Coverage: swap Istanbul for `@vitest/coverage-v8`.
  - `publicFiles`: declined pending [#1140].
  - `test_reach`: declined.
- **`fallow mutation` cannot find tests from the repo root** (`test-files-not-discovered`), because the package Vitest configs have no `root`.
  `root: import.meta.dirname` fixes it, and pi-autoformat's `projects` inherit it (measured).
  `--base` cannot be narrowed to one package: `--workspace` is rejected, and so are paths combined with `--base`.
- **CI's `audit --base` step is PR-only**, so main-lane commits never saw audit's complexity and duplication checks before this change.
  Replaying the last 60 `src` commits: 2 fail, 8 warn, about 2 s each.
- **The V8 swap was first offered as "keep Istanbul".**
  The operator asked about the trade-offs, which prompted the side-by-side measurement: identical fallow results, and a bare `vitest run --coverage` fails today because V8 is Vitest's default provider.
- **The `private-type-leak` decision moved once barrels came up.**
  The operator pointed out that the `code-design` rule added in `68b62894` makes `index.ts` the directory API, so exporting a type from its file stops widening anything once a barrel exists.
  A spike (6 exports in `notification-renderer.ts`) cleared 10 leaks with no `dead-code` fallout.
- **The `ask_user` guard rejected four calls as thinking-only.**
  The rejected messages carried their briefing only in thinking blocks.
  Two decisions were then taken in plain chat.
- **Tidy First skipped:** no `src/` or `test/` file changes; the only `packages/` edits are the nine `vitest.config.ts` files.
- **Issue #155 checked:** it removed unused barrel re-exports, which is consistent with the new `index.ts` rule, and [#1140] cites it.

## Stage: Implementation — Build (2026-11-23T03:11:03Z)

### Session summary

Landed all five build steps as separate commits (`bc0bcbe3`, `16ed3bf5`, `be1cd70d`, `28ad7dfb`, `285adc19`).
The commits root the Vitest configs, swap in `@vitest/coverage-v8`, set the two `.fallowrc.json` rules, add the `fallow audit --staged` pre-commit hook, and add the `fallow` skill updates.
Per-package test counts are identical to the pre-change baseline, and every verification command the plan's Test Impact Analysis names reproduced its planned result.

### Observations

- **Deviation (step 2): `pnpm install` does not drop a removed package that is still a resolved optional peer.**
  `@vitest/coverage-istanbul` stayed in every `vitest@5.1.1(...)` lockfile key and stayed installed after its root devDependency was removed.
  Neither `--fix-lockfile` nor `pnpm update -r vitest` cleared it, and `pnpm dedupe` rewrote about 500 unrelated lines, so it was reverted.
  The fix was a hand edit: strip the peer suffix and the orphaned entries, then `pnpm install` and `--frozen-lockfile`.
- **Pre-completion reviewer: WARN, then PASS on the delta.**
  The WARN found an orphan the hand edit missed (`@istanbuljs/schema`), and a commit body that credited `pnpm install` with pruning it.
  Both were fixed by rewriting the unpushed step-2 commit (`c81b2c73` → `16ed3bf5`); the replayed commits keep the same patch ids.
  The delta PASS noted one wording nit in the rewritten body: `js-tokens` became non-optional rather than "a required dependency".
- **The delta review's first test run failed 3 heartbeat tests** in pi-permission-system under machine load (files took 333 s and 168 s); its rerun and a second full run passed.
- **The hook ran on this session's own commits** and skipped each one, because none staged code or JSON after `prek.toml` landed.

[#1140]: https://github.com/gotgenes/pi-packages/issues/1140
