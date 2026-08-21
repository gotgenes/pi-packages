---
issue: 788
issue_title: "pi-permission-model-judge: migrate registration to the ADR 0012 keyed channel"
---

# Retro: #788 — pi-permission-model-judge: migrate registration to the ADR 0012 keyed channel

## Stage: Planning (2026-08-21T22:22:16Z)

### Session summary

Planned the consumer-side migration of `@gotgenes/pi-permission-model-judge` onto the ADR 0012 keyed service locator, now that `@gotgenes/pi-permission-system` `27.0.0` is published.
The plan collapses the dual-path registration (`session_start` + `permissions:ready` behind an idempotency guard) onto one idempotent ready handler keyed by the payload's `sessionId`, narrows the peer range to `>=27.0.0`, and adds a once-per-session warning when the node's service cannot be resolved.
Plan committed at `packages/pi-permission-model-judge/docs/plans/0788-migrate-registration-to-keyed-channel.md`; three TDD cycles plus a verification step.

### Observations

- **Verified the published API against the tarball, not the workspace source.**
  `pnpm view @gotgenes/pi-permission-system@27.0.0 dist.tarball` + `tar` confirmed `getPermissionsService(sessionId)`, the two-arg `publishPermissionsService`, and the `PermissionsReadyEvent` type export all reach a consumer.
  Necessary because `linkWorkspacePackages: false` means this package consumes the registry tarball, and the workspace `src/` is ahead of what any published consumer sees.
- **Clarification gate settled two things.**
  Peer floor → clean break (`>=27.0.0`, major, `fix(pi-permission-model-judge)!:`), rejecting a root-accessor compatibility shim that would have kept `>=20.10.0` and a minor.
  Vacancy visibility → a once-per-session `console.warn`, rejecting both silence and per-emission warning.
- **The breaking classification is about the peer floor, not this package's own API.**
  Nothing in `@gotgenes/pi-permission-model-judge`'s surface changes; a user on pi-permission-system `20.10`–`26.x` loses the link on upgrade, which is this repo's definition of breaking.
- **The red is behavioral, not just a type error.**
  Vitest strips types, so after the devDependency bump the unchanged `tryRegister()` calls the zero-arg accessor against `27.0.0`, gets `undefined`, and the registration assertions fail for the right reason.
  That is what lets the bump, the test rewrite, and the source migration share one commit without the cycle degenerating into "make `tsc` happy".
- **ADR 0012 decision 7 supplies a measurable acceptance criterion** — the migrated registration must be smaller than the workaround.
  Measured baseline recorded in the plan: `src/extension.ts` is 106 lines, of which ~31 are registration machinery.
  The vacancy warning is counted separately so new capability cannot flatter the comparison.
- **The 24-hour `minimumReleaseAge` gate is live for this work.**
  pi-permission-system `27.0.0` published `2026-08-21T21:19Z`, roughly an hour before planning, so the implementation session should expect `pnpm add` to fail and reach for the version-pinned `minimumReleaseAgeExclude` entry.
- **One skill-doc line goes stale with this change.**
  `.pi/skills/package-pi-permission-system/SKILL.md:187` still calls the judge migration and the docs consolidation unimplemented; [#789] already landed, so the sentence is rewritten in the docs cycle.
- No open PR touches this package, and neither package has an open improvement phase, so the `roadmap-fit` skill had nothing to record and the release recommendation is "ship independently".

[#789]: https://github.com/gotgenes/pi-packages/issues/789

## Stage: Implementation — TDD (2026-08-21T22:48:44Z)

### Session summary

Migrated registration onto the ADR 0012 keyed channel in three planned cycles plus one Tidy-First preparatory commit and two review-driven follow-ups — six commits total.
The `permissions:ready` handler is now the whole registration, keyed by the payload's `sessionId`; `tryRegister`, the `sessionStarted` flag, both call sites, and the nine-line ordering comment are gone.
Test count 48 → 54 in this package (added: latch-ordering, node-locality, and four vacancy tests; removed: the dual-path `pps-first order` test).

### Observations

- **The plan's size criterion failed, and the failure was the most interesting result.**
  ADR 0012 decision 7 makes this package the contract's proof: the migrated registration must be smaller than the workaround.
  Measured, `src/extension.ts` went 106 → 109 for the migration alone (127 with the separately-counted vacancy warning). 30 lines of workaround died and 33 arrived; the seven that tip the balance narrow the `unknown` ready payload, which is decision 2's own cost rather than workaround residue.
  Surfaced at a clarification gate mid-cycle: the operator chose to keep the named `readySessionId` helper and record the measurement honestly over inlining the narrowing to reach 105 lines.
  Both `ask_user` options were measured, not estimated — the inline variant was written to a scratch file and counted rather than guessed at.
- **The version bump broke more than the accessor.**
  Not in the plan: `27.0.0` also made `PromptPermissionDetails.payload` required and removed `message` (pi-permission-system #746), so three test-fixture sites failed `tsc` after the bump.
  Repaired with a new shared `test/fixtures/permission-details.ts`, folded into the migration commit.
  No production code in this package reads either field — `typo-reviewer` works from `accessIntent` / `surface` / `path` / `value` — so this was fixture repair, not a behavior change.
  A plan that bumps a dependency across six majors should expect collateral type breakage beyond the API it targets.
- **The red was behavioral, exactly as the plan predicted.**
  Vitest strips types, so after the bump the unchanged `tryRegister()` called the zero-arg accessor against `27.0.0`, got `undefined`, and every registration assertion failed — with one `PI_PERMISSION_SYSTEM_WARN0001` in the output as corroboration.
  That is what let the bump, the test rewrite, and the source migration share one commit without the cycle degenerating into satisfying the type checker.
- **The Tidy-First assessor earned its dispatch.**
  Its one recommendation — extracting the five-times-duplicated publish/`session_start`/ready sequence into `bringUpSession` — turned the plan's "thread `SESSION_ID` through every call" step into a one-line helper-body edit.
  It also correctly *declined* to extract a `register()` helper in `src/extension.ts`, reasoning from ADR 0012's size mandate that new indirection there would have to be undone.
- **A misplaced `describe` seam cost a round-trip.**
  Inserting the vacancy `describe` mid-file closed the enclosing block early and silently reparented three existing tests under the new heading.
  The suite still ran, so only a structural `grep -n '^describe\|^});'` caught it.
  Anchor a new sibling `describe` on the end of the previous one, not on a convenient test boundary inside it.
- **`pnpm add` handled the release-age gate itself.**
  It added the version-pinned `minimumReleaseAgeExclude` entry to `pnpm-workspace.yaml` automatically — the plan's manual fallback recipe was never needed.

#### Deferred tidyings

None — the assessor's rejected items (splitting `test/extension.test.ts`, restructuring the `warn()` helper) were declined as unrelated to this change's friction, not deferred.

### Pre-completion review

Round 1: **WARN** — two findings, both put to the operator, both actioned.

1. The ADR 0012 decision 7 size proof did not land as written, and a reader of that record would find a stated proof with no outcome.
   Operator chose to amend ADR 0012 now (`726a6e30`), beside the existing #794 amendment — reversing the plan's Non-Goal, on the grounds that recording a refuted prediction is not the status-board use #787 ruled out.
2. Pre-existing `ReturnType<typeof vi.fn>` mock typings.
   Operator chose to fix them now (`dbc39ff6`); the package-wide sweep also let three `.mock.calls` casts be dropped.

Round 2 (re-dispatched after those two substantive commits): **PASS** — ready for `/ship-issue`.
