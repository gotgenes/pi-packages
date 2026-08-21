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

[ADR 0012]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0012-cross-node-extension-contract.md
[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#787]: https://github.com/gotgenes/pi-packages/issues/787
[#788]: https://github.com/gotgenes/pi-packages/issues/788
[#790]: https://github.com/gotgenes/pi-packages/pull/790
[#794]: https://github.com/gotgenes/pi-packages/issues/794
