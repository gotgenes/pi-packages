---
issue: 796
issue_title: "pi-permission-system: schedule the process-root service slot's removal now that its last downstream has migrated"
---

# Retro: #796 — Remove the process-root service slot

## Stage: Planning (2026-08-30T21:32:00Z)

### Session summary

Planned Phase 14 Step 6, which the roadmap scoped as a decision (an ADR 0012 amendment) with "whether code changes in this step is the step's own decision".
The clarification gate settled all three of the step's named questions in one direction: remove the process-root slot outright in a dedicated major, hard delete rather than a warning tombstone, and dissolve the [#302] child guard along with the write it protected.
The plan is five steps — two Tidy-First preparatory test-retargeting commits, the ADR amendment, the breaking removal, and the doc sweep — filed at `docs/plans/0796-remove-process-root-service-slot.md`.

### Observations

- **The decisive fact was a release-timeline one, not a code one.**
  `getRootPermissionsService` did not exist before `v27.0.0` (2026-08-21, nine days before planning); the pre-27 spelling was the zero-arg `getPermissionsService()`, which 27.0.0 already broke.
  So the deprecation window can only shelter a population created *after* the deprecation was announced — consumers who did migration work in the last nine days and deliberately chose a symbol marked `@deprecated` over the keyed locator the same migration guide recommends.
  That reframing came from reading `git tag` dates against the ADR's amendment history, not from the issue body, and it is what made "remove now" the recommended option rather than a defensible-but-aggressive one.

- **The issue's three questions are not independent.**
  The issue and the roadmap both present them as three decisions (remove the reader / stop the write / what about the guard).
  Reading the code showed they collapse: removing the reader leaves nothing that reads the slot, removing the write leaves the guard with nothing to guard, and `service-lifecycle.ts:78` is the sole production consumer of `SubagentDetection.isRegisteredChild`.
  The gate was structured to say so rather than to ask three questions whose last two have only one coherent answer.

- **A warning tombstone was offered and declined.**
  [#794] set the precedent of a runtime guard (`WARN0001`) for a caller the types cannot reach, so an always-`undefined` export with an upgraded warning was a real option.
  Rejected because it is a silent behavior change for exactly the population the window protects, and it needs its own removal later.
  The surviving `WARN0001` already names the replacement, so a `TypeError` is not an unguided failure.

- **The Tidy-First assessor corrected the design in two places.**
  It found a fourth root-slot call site in `test/service.test.ts` that the issue's enumeration missed — the `returns undefined rather than another node's service` case publishes to the root slot only to build its scenario, so a "delete suites with `Root` in the name" sweep would have removed a surviving-behavior test by accident.
  Its consolidation recommendation for `test/composition-root.test.ts` was declined after reading the block it was premised on: `shutdown teardown chain` is retargetable, not root-only, so the "two genuinely-root-only blocks" it wanted made adjacent turned out to be one block plus three redundant lines, and there is nothing to consolidate.

- **Verification instrument chosen over a test.**
  The obvious pin for "the slot is never written again" is a test reading the raw symbol after `session_start`, but deleting the publish function makes any surviving caller a compile error, which is strictly stronger.
  The plan says so explicitly and lists the type checker as step 4's killing-mutation instrument for the removal-completeness class, so an implementing session does not add a tombstone test to fill the perceived gap.

- **Baselines measured, not inferred:** ADR 0012 `#### Amendment` count is 2 (roadmap target ≥ 3), `pnpm fallow dead-code` reports 0 issues, and `RootPermissionsService` appears 14 times across 2 `src/` files.

#### Deferred tidyings

None recorded as scope creep.
The assessor declined three candidates — restructuring `service-lifecycle.test.ts`'s mock harness, reworking the `SubagentDetector`/`RegisteredChildDetector` dual-interface shape, and tidying `src/index.ts` — on the grounds that each *is* the change rather than a preparation for it, which is a correct reading, not a deferral.

[#302]: https://github.com/gotgenes/pi-packages/issues/302
[#794]: https://github.com/gotgenes/pi-packages/issues/794
