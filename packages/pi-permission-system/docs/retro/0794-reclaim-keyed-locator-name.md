---
issue: 794
issue_title: "pi-permission-system: reclaim getPermissionsService for the keyed locator before it publishes"
---

# Retro: #794 — Reclaim `getPermissionsService` for the keyed locator

## Stage: Planning (2026-08-21T20:43:05Z)

### Session summary

Planned the rename of the six cross-extension service accessors as `packages/pi-permission-system/docs/plans/0794-reclaim-keyed-locator-name.md`.
Three TDD cycles: the rename itself (`src/` + all three test files + `scripts/verify-public-types.sh` in one commit, since removing exports breaks importers at the type level), a new once-guarded warning when `getPermissionsService` is called without a session id, then the docs plus an in-place amendment to [ADR 0012] decision 7.
The implementation commit carries two `BREAKING CHANGE:` footers — the rename and [#787]'s ready cadence — because the [#699] and [#787] commits are already on `main` and cannot be retyped.

### Observations

- **The issue's stated sequencing was not executable, and the gate settled it.**
  Issue [#794] says `#789 → this → #788 → merge the release`, but [#788]'s own scope says it is blocked on the permission-system *releasing*: `linkWorkspacePackages: false` plus a devDependency pinned at `20.10.0` means the judge compiles against the registry copy and cannot see an unreleased rename.
  The operator chose `ship independently`, so the order is this issue → [#790] merges as `27.0.0` → [#788].
- **A silent-failure hazard the issue did not price became a third gate question.**
  The published `pi-permission-model-judge@1.1.4` declares `peerDependencies: ">=20.10.0"` and guards with `if (!service) return;`, so an install whose judge copy resolves to `27.0.0` loses the `model-judge` chain link with nothing on stderr.
  The operator chose the once-guarded `process.emitWarning` over both a bare `undefined` and a throw.
  Design detail decided rather than asked: a distinct `PI_PERMISSION_SYSTEM_WARN0001` / `type: "Warning"` rather than reusing `DEP0001`, since `--no-deprecation` must not silence "your chain link vanished".
- **ADR 0012 decision 7 is amended in place**, following `0007-model-judge-authorizer-chain-adr.md`'s "Amended 2026-08-14 with §7 …" precedent: `status: accepted` stays, the latch row moves minor → major, a new row covers the rename, and a paragraph records why the "bus-caught stderr noise" estimate was wrong.
  The Context narrative is left alone — it describes 26.x accurately.
- **Scope held to a rename.**
  Two reductions were considered and rejected in the plan rather than asked: dropping the root publish/unpublish pair from the public surface (rejected — `pi-permission-model-judge`'s own test suite publishes a fake service into the slot, which is a legitimate public-publisher use case), and migrating the tests' convenience root-slot reads onto the keyed locator (deferred as a separate tidy; converting them needs each test's session id threaded).
- **`pi-permission-model-judge` is not a touch point**, verified rather than assumed: both its source and its tests resolve the registry copy, and at runtime its `20.10.0` reader reads the root slot this change keeps writing.
  So the repo's own dogfooded judge keeps working through the rename.
- **No follow-up issues filed.**
  The one concrete follow-up — narrowing the judge's peer range to `>=27.0.0` — is a one-line addition to [#788]'s existing scope, so it went as a comment there instead.
  `pi-permission-system` has no open improvement phase, so the `roadmap-fit` skill exits at its first step.
- **Verification hook worth keeping for implementation:** the consumer probe in `scripts/verify-public-types.sh` currently only *references* `getPermissionsService`; the plan changes it to call `getPermissionsService("session-id")` so the packed-tarball type-check pins the keyed signature externally.

## Stage: Implementation — TDD (2026-08-21T21:02:24Z)

### Session summary

Landed the rename in three cycles plus one preparatory tidy: the mock-naming `test:` commit the Tidy-First assessor recommended, the atomic `feat!:` rename across `src/`, all three test files and the packaging probe, the additive missing-session-id warning, and the docs commit (six docs, the [ADR 0012] amendment, and the new `docs/migration/0794-keyed-service-locator.md`).
The pi-permission-system suite went from 3230 to 3233 tests (+3, all in the new `keyed accessor called without a session id` describe).
Every deterministic gate stayed green at each commit, `verify:public-types` passes against the packed tarball, and the pre-completion reviewer returned **PASS**.

### Observations

- **The Tidy-First assessor found exactly one preparatory commit, and it was a real trap.**
  `test/service-lifecycle.test.ts`'s root-slot mocks were named `mockPublishPermissionsService` / `mockUnpublishPermissionsService` — the base names this change reassigns to the *keyed* trio — so a mechanical rename would have left every variable meaning the opposite of what it mocks.
  Renaming them by slot role first (`mockPublishRootService` / `mockPublishKeyedService`) reduced that file's feature-commit diff to the four `vi.mock` factory keys.
  The assessor also verified the plan's structural claims on the way past: 28 call sites in `composition-root.test.ts` split 17 root / 11 keyed with no ambiguous line, both file-level `no-deprecated` disables already present, and every mocked key exercised by an assertion.
- **The scripted rename needed a two-pass order**, root first (`getPermissionsService` → `getRootPermissionsService`) and keyed second (`*ForSession` → base names), or the second pass would have collided with the first.
  `\b` boundaries kept `unpublishPermissionsService` from matching inside `publishPermissionsService` and kept `getPermissionsService` from matching inside `getPermissionsServiceForSession`.
  A `zsh` gotcha cost one call: an unquoted `$FILES` variable does not word-split, so the file list had to be spelled out inline.
- **Two of the three new tests passed at Red, by design** — "returns `undefined` rather than another node's service" and "does not warn when a session id is passed" are invariant pins on behavior the map lookup already had; only the warning assertion was genuinely red.
- **The `no-unnecessary-condition` disable was speculative and got stripped.**
  A pre-emptive `eslint-disable-next-line` on `typeof sessionId !== "string"` (typed `string`) drew `Unused eslint-disable directive` — the rule does not flag a `typeof` guard on a typed parameter.
  The skill's rule held: add the directive only after the linter reports the problem.
- **Prose fixes the script could not make.**
  "The zero-arg `getRootPermissionsService()`" is a contradiction the substitution happily produced in four docs; each needed a hand edit, as did the guide's `getPermissionsService()` → `getPermissionsService(sessionId)` in the degradation note and the deprecation test's `stringContaining` probe, which was widened to `"getPermissionsService(sessionId)"` so it cannot pass on an unrelated substring.
- **The ADR amendment is a correction, not a rewrite.**
  `status: accepted` stands, the Context narrative is untouched as a dated record of the 26.x world, decision 7's table uses `~~minor~~ **major**` strikethrough, and a `#### Amendment` subsection records *why* the estimate failed — the predicted stderr noise is a throw that fires before the consumer's `dispose` handle is assigned, so its idempotence guard never latches.
- **Deviation from the plan:** one extra commit (the Tidy-First `test:` prep) and one extra improvement inside cycle 1 (the `verify-public-types.sh` probe now imports `PermissionsService` to type the keyed call's result).
  Every file in the plan's Module-Level Changes table was touched; nothing was added beyond it.
- Pre-completion reviewer: **PASS**, no warnings.
  It independently re-ran the judge package's `check` and `test` to confirm `pi-permission-model-judge` still compiles against its registry-pinned `20.10.0` copy, and swept the repo for stale `*ForSession` mentions (only the two deliberate historical ones plus the dated plans/retros remain).

#### Deferred tidyings

- `test/service.test.ts` — the same three-line root-slot `afterEach` cleanup block is repeated across three `describe` blocks (round-trip, formatter delegation, extractor delegation); the assessor rejected deduplicating it as unrelated to this change.

[ADR 0012]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0012-cross-node-extension-contract.md
[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#787]: https://github.com/gotgenes/pi-packages/issues/787
[#788]: https://github.com/gotgenes/pi-packages/issues/788
[#790]: https://github.com/gotgenes/pi-packages/pull/790
[#794]: https://github.com/gotgenes/pi-packages/issues/794
