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
