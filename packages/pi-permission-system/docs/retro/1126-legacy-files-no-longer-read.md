---
issue: 1126
issue_title: "pi-permission-system: stop reading the legacy config files"
---

# Retro: #1126 — pi-permission-system: stop reading the legacy config files

## Stage: Planning (2026-11-28T04:07:35Z)

### Session summary

Planned removal of the legacy-file merges from `loadAndMergeConfigs`, implementing ADR 0016 §3, as six steps: a characterization table, the roadmap's `mergeUnifiedConfigs` pick-helper ride-along, two `feat!:` commits, a detection refactor, and docs.
The plan is `packages/pi-permission-system/docs/plans/1126-legacy-files-no-longer-read.md`; the release is independent (roadmap `Release: independent`, no batch).

### Observations

- Measured finding the issue and ADR missed: `EXTENSION_ROOT` resolves to `<install dir>/src` since `367f4e34` moved `extension-config.ts` into `src/config/`, so the install-dir legacy `config.json` has been looked for at `<install dir>/src/config.json` for 70 releases (31.1.1 through 45.1.0).
  Operator decision: drop that file's detection entirely (with `EXTENSION_ROOT`, `getLegacyExtensionConfigPath`, the `extensionRoot` parameter, and the `legacyExtensionConfigDetected` log flag) and amend ADR 0016 §3, rather than fix the path.
- Operator decision on the notice: ADR wording plus a link to a new `legacy-to-flat.md#legacy-file-locations` section, without the old `mv` line, which overwrites an existing new-layout file and turns a legacy-format file into a rejected global scope.
- The issue's "no deny is lost" holds for rules, which never reached `FilePolicyLoader`, but not for two knobs: a legacy `shellTools` entry routes an aliased shell tool through bash rules, and a legacy `authorizerChain` link can deny under auto-approve.
  The plan documents both in the migration section and the `BREAKING CHANGE:` footer instead of reading the file.
- The Tidy-First assessor found `forwardingTimeoutMs` has no `mergeUnifiedConfigs` test and most keys lack an absent-key test, so a characterization `it.each` (15 keys × 3 cases) leads the plan.
  Its optional shared detector (`findLegacyPolicyFiles`) was taken as step 4.
- Spiked: a generic `copyOverrideWins<K extends keyof UnifiedPermissionConfig>` over a mixed key list type-checks with no cast.
- A test of the `""`-cwd skip in `findLegacyPolicyFiles` cannot discriminate (it resolves against the process cwd), so only the `undefined` case is pinned.
- The project legacy notice stays trust-gated, preserving current behavior; `logResolvedPaths`' cwd-only (not trust) gating also stays.

#### Deferred tidyings

- `src/config/config-paths.ts` and `src/config/extension-config.ts`: duplicate `EXTENSION_ID` constants (unrelated to this change).
- `src/config/extension-config.ts`: `normalizePermissionSystemConfig`'s `!== undefined` copies resemble the new pick helper but apply defaults to one source; not shared.
