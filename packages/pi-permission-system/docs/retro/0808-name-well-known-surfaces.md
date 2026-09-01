---
issue: 808
issue_title: "pi-permission-system: name the well-known permission surfaces in the config schema"
---

# Retro: #808 — pi-permission-system: name the well-known permission surfaces in the config schema

## Stage: Planning (2026-09-01T23:05:29Z)

### Session summary

Produced `docs/plans/0808-name-well-known-surfaces.md`: ten well-known permission surfaces (`*`, the `path` and `external_directory` families, `bash`, `mcp`, `skill`) get named `surfaceProperty({ ... })` entries over the retained `.catchall(...)`, and the 2034-character object-level `markdownDescription` is split across them.
Four TDD cycles: a characterization pin, the Tidy-First allowlist extraction, the feature, and the doc/roadmap mark.
Filed [#868] for a neighbouring gap found while checking an operator note, and recorded its Phase 14 disposition.

### Observations

- The roster grew from the issue's five to six new properties.
  The operator added `"*"`, the universal fallback and the most-written key of all, and declined the six built-in file tools (`read`/`write`/`edit`/`grep`/`find`/`ls`) because naming them would duplicate `PATH_BEARING_TOOLS`' vocabulary inside `config-schema.ts` for six descriptions differing only by tool name. ¶3 and ¶4 of the object-level blob therefore stay object-level.
- Spiked `z.toJSONSchema` in this worktree before designing around it: a property literally named `"*"` emits as `properties["*"]`, leaves `additionalProperties` intact, and keeps `z.infer` accepting arbitrary keys.
  Declaration order fixes emitted order, which made property grouping a real reviewable choice rather than an accident.
- The roadmap's `grep -c 'surfaceProperty'` metric (target ≥ 9) forced the design's shape.
  `grep -c` counts lines, so a table-driven `Object.fromEntries` build scores 2 — ten literal call sites are what the metric actually asks for, and they read better at ten entries anyway.
  Measured baseline 0, predicted delivered 11.
- All size figures in the plan are measured, not estimated: the eight-paragraph inventory came from the committed generated schema, the six drafts were measured as written, and the predicted file size (20,475 → ≈24,582 bytes) came from simulating the generator over the real schema and correcting for `biome format`'s 36-byte array collapsing, verified by round-tripping the current file.
- The load-bearing risk is the `.catchall`.
  Dropping it while rewriting the object literal would reject every extension-tool surface fail-closed, and neither `tsc` nor the parity test would notice — so it gets its own killing mutation in cycle 3.
- The Tidy-First assessor found exactly one preparatory commit, and its reasoning corrected the plan's sequencing: `DIRECTIONAL_SURFACE_DESCRIPTIONS` serves two jobs (building the properties, being the misspelling allowlist), and the feature commit would otherwise have had to invent a new allowlist authority in the same hunk that deletes the table.
  It also confirmed, against the real files, that nothing downstream depends on the property set or on the rejection message text.
  A characterization test was added as cycle 1 to replace the structural guarantee the tuple extraction removes — landed green *before* the refactor, not after.
- The operator noted `authorizerChain` "isn't in the schema".
  It is — `config-schema.ts:328`, `schemas/permissions.schema.json:92`, 983-character `markdownDescription`, and `config.example.json:18`.
  What is missing is one level down: the array's `items` is a bare `{ "type": "string", "minLength": 1 }`, so the one cursor position where a link name is typed completes and hovers nothing, and the name it needs (`model-judge`, verified at `pi-permission-model-judge/src/extension.ts:34`) appears in no schema text and no example config.
  Measuring the real artifact before answering is what turned a wrong premise into a filed issue.
- [#868] was kept out of #808 at the operator's call, to keep the issue matching its title and roadmap step.
  Its Phase 14 disposition is **deferred to a later phase**: it shares Step 9's file, defect class, and clearing mechanism, but not its parentage — Step 9 exists because Step 1 created its asymmetry, while `authorizerChain`'s gap predates the phase and the capability axis has no bearing on it.
- The operator settled a ~800-character cap per surface property (existing max 425; drafted `bash` 770).
  It is enforced by a test rather than left to review, because the failure this change fixes *is* a budget nobody was enforcing.

#### Deferred tidyings

None.
The assessor explicitly declined the two candidates it considered — extracting `surfaceProperty` and splitting the `markdownDescription` are the change itself, not preparation for it — and found no unrelated cleanup in `config-schema.ts` or `config-schema.test.ts` outside the touched region.

[#868]: https://github.com/gotgenes/pi-packages/issues/868
