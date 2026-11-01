---
issue: 799
issue_title: "pi-permission-system: decide which channels permission policy may enter through (ADR)"
---

# Retro: #799 — decide which channels permission policy may enter through (ADR)

## Stage: Planning (2026-11-01T22:00:25Z)

### Session summary

This session inventoried the shipped policy channels from source and grouped the twelve dependants into four clusters: new file sources, write-back, relaxation scope, and a precedence floor.
At the one planning gate the operator chose to decide all four clusters in one ADR (0016), to file the measured `ConfigStore.save()` erasure as an independent bug, and to unpark PR [#638] now.
The plan (`docs/plans/0799-policy-channels-adr.md`) structures `/build-plan` as six deliberation gates (A–F) over the admissibility criteria and the four clusters, followed by ADR authoring and a disposition sweep.

### Observations

- Two behaviors were measured with disposable tests through the real code, then deleted:
  - `ConfigStore.save()` rewrites the global file from `existing.config`, which is `{}` for a schema-rejected file, so one yolo toggle erased a `bash` deny; on a valid file it strips JSONC comments.
    Filed as [#1102].
  - A session rule `systemctl restart *` overrode a config deny on `systemctl restart trader` (and `/etc/*` on `path_write`), confirming comment 1's report.
    The arity table makes that pattern the routine suggestion.
- The issue body's "#638 adds an overlay layer" was a misreading: PR [#638] is a TUI `overlay` dialog option.
  It was unparked by comment; the earlier park comment had called it a configuration channel.
- Comment 1's "three resolvers" finding is now two: `evaluateFirst` was removed by #928, leaving `evaluate` and `evaluateAnyValue`.
  Its testing hazard stands, so the plan requires a `PermissionManager.check`-level pin per resolver.
- Pinned Pi 1.0.0 already exposes `pi.getSettings()` (trust-gated project settings) and `pi.registerFlag()`, which reshapes the options for [#675] and `--yolo`; Pi's settings merge semantics are unverified and deferred to build step 1.
- Nothing in `src/` protects the extension's own config files from an agent with a `write` allow; mid-session re-reads are mtime-driven (traced in code, not run).
  The plan carries this as candidate criterion K6 rather than a filed issue, since whether it is a defect depends on Gate A.
- The `Co-authored-by:` lines for every contributor whose mechanism a gate might adopt were resolved at planning and written into Build Order step 8.
- roadmap-fit: no open phase in pi-permission-system, so [#1102] exited at step 1.

[#638]: https://github.com/gotgenes/pi-packages/pull/638
[#675]: https://github.com/gotgenes/pi-packages/pull/675
[#1102]: https://github.com/gotgenes/pi-packages/issues/1102
