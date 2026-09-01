---
issue: 808
issue_title: "pi-permission-system: name the well-known permission surfaces in the config schema"
---

# Name the well-known permission surfaces in the config schema

## Release Recommendation

**Release:** ship independently

Phase 14 Step 9 is listed under the roadmap's independently-releasable steps, with the recorded rationale that the generated schema ships in the tarball, so new completions and hover text are user-observable.
It belongs to no release batch: Track E owns `config-schema.ts` alone once Step 1 has landed, and no other open step edits that file.

## Problem Statement

[#806] converted `permissionSchema` from a bare `z.record(...)` to `z.object({ ... }).catchall(...)`, giving the four directional keys — `path_read`, `path_write`, `external_directory_read`, `external_directory_write` — named properties with editor autocomplete and hover documentation, while arbitrary tool names stayed valid surfaces through the catchall.

That left the schema asymmetric.
The four newest and least-used keys are formally documented; the keys people actually write are anonymous `additionalProperties`.
An editor offers no completion for `bash` or `external_directory`, and hovering either says nothing.

The documentation already exists — it is in the wrong place.
Measured against the committed `schemas/permissions.schema.json`, the `permission` object carries a **2034-character** `markdownDescription` in eight paragraphs describing every surface in one blob.
A reader gets all of it or none of it, and an editor cannot bind any of it to the key under the cursor.

## Goals

- Give ten well-known surfaces named, individually documented properties: `"*"`, `path`, `path_read`, `path_write`, `external_directory`, `external_directory_read`, `external_directory_write`, `bash`, `mcp`, `skill`.
- Keep `.catchall(surfaceValueSchema)` so any registered tool name remains a valid surface.
- Split the object-level `markdownDescription` so each surface's prose sits on its own property, leaving the object level to cover only what is genuinely object-level.
- Establish and enforce a per-property size budget, so the blob cannot re-form one property at a time.
- Preserve the two loader-only refinements exactly: a misspelled directional key and an empty surface key stay rejected fail-closed.

This change is **not** breaking.
It adds schema metadata only.
Every config that validates today validates identically afterward, no runtime semantics change, and nothing prompts differently on upgrade.

## Non-Goals

- **Naming the six built-in file tools** (`read`, `write`, `edit`, `grep`, `find`, `ls`).
  Considered and declined at the clarification gate: it would duplicate `PATH_BEARING_TOOLS`' vocabulary from `src/access-intent/path-surfaces.ts` inside `config-schema.ts`, and produce six descriptions differing only by tool name.
  The paragraph describing how their patterns match `input.path` therefore stays at the object level.
- **Documenting the `authorizerChain` array element** — filed as [#868] during this planning session, and dispositioned as deferred to a later phase in the roadmap's sweep list.
  It is the same defect class one level down (the array's `items` is a bare `{ "type": "string", "minLength": 1 }`, so the one cursor position where a link name is typed completes and hovers nothing), but on a top-level runtime knob rather than a permission surface, and its cause predates Phase 14 entirely.
- **`config/config.example.json`** — no change.
  It already exercises eight of the ten named surfaces and validates against the schema today; the parity and example-validation tests both stay green untouched.
- **Any change to validation, merge order, or resolution.**
  The catchall, the two refinements, and `surfaceValueSchema` are unchanged in meaning.
- **`examples` on individual surface properties.**
  The object-level `examples` array already shows every well-known surface in one working config, and per-property examples would restate it ten times.

## Background

### The current shape

`src/config-schema.ts` builds `permissionSchema` (lines ~118–158) from a single table:

```typescript
const DIRECTIONAL_SURFACE_DESCRIPTIONS: Record<
  string,
  { description: string; markdownDescription: string }
> = {
  path_read: { ... },
  path_write: { ... },
  external_directory_read: { ... },
  external_directory_write: { ... },
};

const permissionSchema = z
  .object(
    Object.fromEntries(
      Object.entries(DIRECTIONAL_SURFACE_DESCRIPTIONS).map(([key, meta]) => [
        key,
        surfaceValueSchema.optional().meta(meta),
      ]),
    ),
  )
  .catchall(surfaceValueSchema)
  .meta({ description, markdownDescription, examples })
  .superRefine(rejectUnusableSurfaceKeys);
```

That one table serves **two** jobs.
It builds the properties, and `rejectUnusableSurfaceKeys` (lines ~175–200) derives its allowlist of legal directional spellings from `Object.keys(DIRECTIONAL_SURFACE_DESCRIPTIONS)`.
The refinement is what makes a misspelled restriction (`path_wrote: {"*": "deny"}`, which would enforce nothing at all) fail closed instead of sitting inert — the fail-**open** case [#806] identified.

### The object-level blob, paragraph by paragraph

Measured from the committed generated schema:

| ¶   | Chars | Content                                                  | Fate                                       |
| --- | ----- | -------------------------------------------------------- | ------------------------------------------ |
| 0   | 23    | "Flat permission policy."                                | stays                                      |
| 1   | 213   | key list — `"*"` fallback plus tool names                | shrinks; `"*"` gets its own property       |
| 2   | 164   | string-vs-map shorthand, last-match-wins                 | stays                                      |
| 3   | 229   | built-in file tools match `input.path`                   | stays (see Non-Goals)                      |
| 4   | 333   | cwd-normalized relative matching, bash `cd` conservatism | stays                                      |
| 5   | 363   | the `path` surface                                       | moves to the `path` property               |
| 6   | 607   | the `external_directory` surface                         | moves to the `external_directory` property |
| 7   | 88    | merge order global → project → agent                     | stays                                      |

`bash`, `mcp`, and `skill` have **no** existing prose to move — only a name-drop in ¶1 — so their text is newly written, distilled from `docs/configuration.md` §§ `bash` Surface, `mcp` Surface, and `skill` Surface.

### Constraints from AGENTS.md and the package skill

- `schemas/permissions.schema.json` is generated; never hand-edit it.
  Regenerate with `pnpm run gen:schema` and let the parity test in `test/config-schema.test.ts` guard the drift.
- Refinements do not serialize into JSON Schema, so the two key checks stay loader-only.
  An editor will not flag them; the message must therefore name the offending key and the legal spellings.
- Write `~/dev/*`, never `~/dev/**` — `**` is not a distinct globstar and compiles identically.
- Do not name an unreleased version anywhere in the prose.

### Verified mechanics (spiked in this worktree)

A property literally named `"*"` is legal in `z.object` and emits as `properties["*"]` in the draft-2020-12 output, with `additionalProperties` untouched and `z.infer` still accepting arbitrary keys.
Property order in the emitted JSON follows declaration order.

## Design Overview

### The `surfaceProperty` helper and ten literal call sites

```typescript
/** One documented, optional property for a well-known permission surface. */
function surfaceProperty(meta: {
  description: string;
  markdownDescription: string;
}) {
  return surfaceValueSchema.optional().meta(meta);
}

const permissionSchema = z
  .object({
    "*": surfaceProperty({ ... }),
    path: surfaceProperty({ ... }),
    path_read: surfaceProperty({ ... }),
    path_write: surfaceProperty({ ... }),
    external_directory: surfaceProperty({ ... }),
    external_directory_read: surfaceProperty({ ... }),
    external_directory_write: surfaceProperty({ ... }),
    bash: surfaceProperty({ ... }),
    mcp: surfaceProperty({ ... }),
    skill: surfaceProperty({ ... }),
  })
  .catchall(surfaceValueSchema)
  .meta({ description, markdownDescription, examples })
  .superRefine(rejectUnusableSurfaceKeys);
```

Ten literal call sites rather than a table-driven `Object.fromEntries` map, for two reasons.
Each surface's prose sits beside its own key, which is what makes the file readable at ten entries and would not at four.
And the roadmap's health metric is `grep -c 'surfaceProperty' src/config-schema.ts` with a ≥ 9 target: `grep -c` counts *lines*, so a table-driven build scores 2.

Declaration order groups by family — the fallback, then the `path` family, then the `external_directory` family, then the three tool surfaces — so the generated JSON reads in that order.
This reorders the four existing directional properties relative to today's output; the diff is noise, not meaning, and the parity test covers it.

### Dissolving the dual-purpose table

With the properties written literally, `DIRECTIONAL_SURFACE_DESCRIPTIONS` disappears and `rejectUnusableSurfaceKeys` needs a new authority for the four legal spellings:

```typescript
const DIRECTIONAL_SURFACE_KEYS = [
  "path_read",
  "path_write",
  "external_directory_read",
  "external_directory_write",
] as const;
```

The table guaranteed the refinement's list and the schema's directional properties agreed **structurally**; the tuple does not.
That coupling is therefore replaced by a test, added and shown green *before* the refactor that removes the structural guarantee (TDD Order cycle 1).

Deriving the tuple from `surfaceFamilyMembers` in `src/access-intent/path-surfaces.ts` was considered and rejected: `config-schema.ts` imports only `zod` today, and adding a `config-schema → access-intent` edge to save four string literals buys a coupling the package does not otherwise have.

### The size budget

The operator settled a **~800-character cap** on any one surface property's `markdownDescription`, against a measured existing maximum of 425.
Every drafted property fits (largest: `bash` at 770), and the object level lands at 969 — a 52% cut from 2034.

All lengths below are **measured** from the drafted strings, not estimated:

| Property                               | `description`   | `markdownDescription` |
| -------------------------------------- | --------------- | --------------------- |
| `"*"`                                  | 104             | 315                   |
| `path`                                 | 108             | 544                   |
| `external_directory`                   | 90              | 711                   |
| `bash`                                 | 89              | 770                   |
| `mcp`                                  | 80              | 374                   |
| `skill`                                | 78              | 180                   |
| `path_read` (unchanged)                | 85              | 425                   |
| `path_write` (unchanged)               | 88              | 368                   |
| `external_directory_read` (unchanged)  | 83              | 319                   |
| `external_directory_write` (unchanged) | 56              | 246                   |
| object level                           | 124 (unchanged) | 969 (was 2034)        |

The budget is enforced by a test rather than left to review, because the failure mode this change fixes is exactly a budget nobody was enforcing.

### Predicted generated-schema size

Measured by simulating the generator (`JSON.stringify(schema, null, 2)`) over the committed schema with the drafted metadata substituted: 24,618 bytes.
The generator then runs `biome format`, which collapses short arrays and takes 36 bytes off the current file, so the landed figure should be **≈ 24,582 bytes, up from 20,475 — about +20%**.
`schemas` is a `files` allowlist entry, so this is a ~4 KB tarball increase.

### The drafted prose

The six new properties, verbatim.
`path_read`, `path_write`, `external_directory_read`, and `external_directory_write` keep their existing text unchanged.

`"*"`:

> Universal fallback — the action used when **no** surface-specific rule matches.
>
> `{ "*": "ask" }` is the least-privilege posture, and is what an omitted `"*"` means anyway.
> It replaces `defaultPolicy.tools` from the legacy config format.
>
> A surface-specific rule always beats it, whatever the key order in the file.

`path`:

> Cross-cutting gate that applies to **all** file access: Pi tools, bash commands, MCP calls (via `input.arguments.path`), and extension tools (via `input.path` or a registered access extractor).
>
> A `path` deny cannot be overridden by a per-tool allow.
> Use it to protect sensitive files (`.env`, `~/.ssh/*`) from every path-aware tool at once.
>
> This bare key is **sugar**: it expands at load into `path_read` and `path_write`, its entries placed first, so an explicit directional entry always has the final say whatever the key order in the file.

`external_directory`:

> Boundary gate for access **outside** the session working directory.
>
> Give it a pattern map to allow specific outside-CWD directories without opening all external access — e.g. `{ "*": "ask", "~/.cargo/registry/*": "allow" }` to silence repeated prompts on a local cache.
> The trailing `*` is greedy and crosses subdirectory boundaries; a bare `~/.cargo/registry` matches only the directory entry itself.
>
> Because layers compose with most-restrictive-wins, a `path` allow cannot loosen an `external_directory: ask` boundary — allow outside-CWD directories here, not on `path`.
>
> This bare key is **sugar**: it expands at load into `external_directory_read` and `external_directory_write`, its entries placed first.

`bash`:

> Shell command execution, matched by **command pattern**.
>
> A chain (`&&`, `||`, `;`, `|`, newline) is split into its top-level commands and each is matched independently, most-restrictive-wins — so `cd /repo && npm install x` is denied when `npm *` is.
> A command nested in a substitution, process substitution, or subshell is matched too, since it really runs.
>
> A leading env-var assignment is stripped before matching (`AWS_PROFILE=prod aws …` matches `aws *`), and a pattern ending in `*` also matches the bare command (`git *` matches `git`).
> A pattern containing a chain operator never matches — write one pattern per command.
>
> A shell wrapper (`bash -c`, `eval`, `sudo`, `xargs`) is floored from `allow` to `ask`, so an opaque payload cannot ride a permissive rule.

`mcp`:

> Registered MCP proxy tools, matched against targets derived from the tool input: a baseline op (`mcp_status`, `mcp_list`, `mcp_search`, `mcp_describe`, `mcp_connect`), a server name (`myServer`), a server/tool combination (`myServer:search`, `myServer_search`), or the generic `mcp_call`.
>
> Baseline discovery targets auto-allow whenever any explicit `mcp` allow rule exists.

<!-- -->

`skill`:

> Skill invocation, matched by skill name — the surface is `skill`, not `skills`.
>
> Wildcards behave as everywhere else: `{ "*": "ask", "dangerous-*": "deny", "librarian": "allow" }`.

The new object-level `markdownDescription` keeps ¶0, a shrunk ¶1, and ¶2, ¶3, ¶4, ¶7 unchanged:

> Flat permission policy.
>
> Each top-level key is a surface: the `"*"` fallback, a well-known surface documented below, or any registered tool name.
>
> A **string** value is shorthand for `{ "*": action }` (a surface-level catch-all).
> An **object** value maps wildcard patterns to actions — last matching pattern wins.
>
> \[¶3 and ¶4 verbatim from the current text.]
>
> **Merge order (lowest → highest precedence):** global → project → per-agent frontmatter.

### Verified: nothing downstream depends on the property set

Checked during the Tidy-First assessment.
`src/normalize.ts` indexes `FlatPermissionConfig[string]` generically and derives sugar-expansion membership from `surfaceFamilyMembers()` — a separate authority.
`src/config-loader.ts`, `src/permission-merge.ts`, `src/scope-merge.ts`, `src/permission-manager.ts`, and `src/types.ts` consume `FlatPermissionConfig` structurally (spread, `Object.entries`, filter by `"*"`); none hardcodes the key list.
No test outside `test/config-schema.test.ts` asserts the `"Unknown directional surface key …"` message text.

## Module-Level Changes

`packages/pi-permission-system/src/config-schema.ts`

- Add `DIRECTIONAL_SURFACE_KEYS`, the four legal directional spellings as a `readonly` tuple; point `rejectUnusableSurfaceKeys`'s `legalDirectionalKeys` at it.
- Fix the stale JSDoc `{@link rejectMisspelledDirectionalKeys}` (line ~87) — the function is named `rejectUnusableSurfaceKeys`.
- Add `surfaceProperty(meta)`; let TypeScript infer its return type (the zod schema type is not worth spelling, and no lint rule requires it).
- Replace the `Object.fromEntries` build with ten literal `surfaceProperty({ ... })` properties; delete `DIRECTIONAL_SURFACE_DESCRIPTIONS`, whose four entries move onto `path_read`/`path_write`/`external_directory_read`/`external_directory_write` verbatim.
- Rewrite the object-level `markdownDescription` to the 969-character text above; leave `description` and `examples` unchanged.

`packages/pi-permission-system/schemas/permissions.schema.json`

- Regenerated by `pnpm run gen:schema`; never hand-edited.

`packages/pi-permission-system/test/config-schema.test.ts`

- New: the directional allowlist pin (cycle 1).
- New: the ten-property roster, per-property documentation presence, and the size-budget assertions (cycle 3).
- Changed: `"names the four directional surfaces as documented properties"` becomes the ten-property assertion; its `Object.keys(properties).sort()` list grows from four to ten.
- Changed: the `describe("directional surface keys")` block gains a sibling for the six non-directional named surfaces rather than misfiling them under a "directional" label.

`packages/pi-permission-system/docs/architecture/architecture.md`

- Module-tree entry for `config-schema.ts` (line ~890) says "`permissionSchema` names the four directional surfaces as documented properties over a `.catchall(...)`" — becomes the ten well-known surfaces.
  This is a current-behavior correction, not provenance; the entry's existing `Constraint:` clause about refinements not serializing stays.
- Step 9 heading gains `✅`, the Mermaid node `S9` gains `✅`, and the step gains a `Landed:` note.
- Health-metric row "Named permission-surface properties (`surfaceProperty`, `config-schema.ts`) | 0 | ≥ 9" — measured baseline **0**, predicted delivered **11** (one function declaration line plus ten call-site lines).
  The `≥ 9` target is a floor and is met; do not rewrite it.
- Health-metric row "Directional keys in `config-schema.ts` | 0 | ≥ 2" — measured baseline **5** lines, and the change keeps every one of those spellings, so it stays ≥ 5.
  The `Baseline (2026-08-24)` column is a fixed phase-open snapshot and must not be edited.

`packages/pi-permission-system/docs/configuration.md`

- § Schema Validation, the "Editor tip" paragraph: add one sentence noting that the well-known surface keys now complete and carry their own hover documentation.

Checked and requiring **no** change: `packages/pi-permission-system/README.md` (no schema or autocomplete mention), `config/config.example.json` (already exercises eight of the ten and validates), `.pi/skills/package-pi-permission-system/SKILL.md` (names `config-schema.ts` as the source of truth but describes no property set — grepped for `catchall`, `additionalProperties`, `named-property`, `documented properties`), and `docs/decisions/` (ADR 0004's `additionalProperties: false` reference is about the top-level `strictObject`, not `permissionSchema`).

## Test Impact Analysis

This is not an extraction, so the usual extraction questions mostly do not apply.

**What the change newly makes testable.**
Two invariants currently held by construction rather than by assertion become assertable, and both are worth pinning because the change is what removes their structural guarantee:

1. The refinement's legal-directional list and the schema's directional-shaped properties agree, and the rejection message enumerates exactly those four spellings.
   Today `DIRECTIONAL_SURFACE_DESCRIPTIONS` guarantees this; afterward only `DIRECTIONAL_SURFACE_KEYS` does.
2. The size budget — no surface property's `markdownDescription` exceeds ~800 characters, and the object-level one stays a summary.
   Nothing enforces this today, which is why the blob reached 2034.

**What becomes redundant.**
Nothing.
The existing four-property assertion is *widened* to ten rather than replaced, and the misspelling and empty-key cases are untouched.

**What must stay as-is.**
The `.catchall` pins — `"still accepts an arbitrary tool-name surface"` and `"keeps arbitrary tool-name surfaces validating alongside them"` — are the load-bearing tests here.
Losing the catchall would reject every extension-tool surface fail-closed, which is the worst outcome available from this change, and neither `tsc` nor the parity test would notice.

**The parser/matcher clause does not apply** — this change introduces no parser or matcher.
Its testable input domain is the schema's own key space, which the roster assertion enumerates exhaustively rather than samples.

## Invariants at risk

This change touches a surface Phase 14 Step 1 ([#806]) refactored.
Step 1's documented `Outcome:` is that direction is expressible and *"every existing config expands to its current meaning exactly, so nothing prompts differently on upgrade."*

| Step 1 invariant                                     | Pinned by                                                                           | At risk here?                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Every existing config parses and resolves unchanged  | `test/permission-manager-unified.test.ts`, `test/normalize.test.ts`, the full suite | No — metadata-only change, but the full suite is the verification, not the schema file's own tests                 |
| A misspelled directional key is rejected fail-closed | `test/config-schema.test.ts` `it.each` over five misspellings                       | **Yes** — its allowlist source is being replaced; cycle 1 adds the message-enumeration pin before cycle 2 moves it |
| An empty surface key is rejected                     | `test/config-schema.test.ts` `"rejects an empty surface key"`                       | No — the refinement branch is untouched                                                                            |
| An arbitrary tool-name surface still validates       | `test/config-schema.test.ts` two catchall assertions                                | **Yes** — the `z.object({...})` literal is being rewritten around `.catchall`; both assertions must stay           |
| The committed JSON matches the generated one         | `test/config-schema.test.ts` parity test                                            | No — but it is the only thing that catches a forgotten `pnpm run gen:schema`                                       |

Opened and confirmed: `test/config-schema.test.ts` exercises the real `unifiedConfigSchema` and the real `buildPermissionsJsonSchema()` — it mocks nothing, so each assertion above genuinely pins the layer under test.

The quantitative invariants are the size measurements in Design Overview, all taken at this commit.
Re-measure after the change rather than defending the predictions.

## TDD Order

1. **`test:` pin the directional allowlist against the schema's own properties.**
   Red-then-green does not apply: this is a characterization test, green on arrival, added deliberately **before** cycle 2 removes the structural guarantee it replaces.
   Test surface: `test/config-schema.test.ts`.
   Covers — the generated `permission.properties` keys matching `/^(path|external_directory)_/` are exactly the four legal spellings; each of the four parses; and the rejection message for a misspelling enumerates exactly `path_read, path_write, external_directory_read, external_directory_write`.
   Killing mutations: (a) append a fifth entry to the refinement's allowlist source — the message-enumeration assertion must go red; (b) remove `path_write` from it — both the acceptance case and the message assertion must go red.
   `test(pi-permission-system): pin the legal directional spellings against the schema`
2. **`refactor:` source the directional-key allowlist from its own tuple.**
   Preparatory (Tidy First).
   The friction: one table currently builds the properties *and* is the misspelling allowlist, so cycle 3 — which literalizes ten properties and deletes the table — would otherwise have to invent a new allowlist authority inside the same hunk.
   Extract `DIRECTIONAL_SURFACE_KEYS` and point `rejectUnusableSurfaceKeys` at it; leave `DIRECTIONAL_SURFACE_DESCRIPTIONS` and `permissionSchema` otherwise untouched.
   Fix the stale `{@link rejectMisspelledDirectionalKeys}` JSDoc in the same commit — it sits one line above the code this commit touches.
   Behavior-preserving; cycle 1's test plus the existing `it.each` blocks are the verification.
   Killing mutation: point `legalDirectionalKeys` at `[]` — all five misspelling cases and all four acceptance cases must go red.
   `refactor(pi-permission-system): source the directional-key allowlist from its own tuple`
3. **`feat:` name and document the ten well-known surfaces.**
   Red: `test/config-schema.test.ts` — the generated `permission.properties` key set is exactly the ten; every named property carries a non-empty `description` and `markdownDescription`; `additionalProperties` still equals the `permissionState`/`permissionMap` `anyOf`; each of the six new surfaces parses as both a string and a pattern map; no property's `markdownDescription` exceeds 800 characters; the object-level `markdownDescription` is at most 1200.
   Widen the existing `"names the four directional surfaces as documented properties"` case to the ten in the same commit, and add the sibling `describe` for the non-directional named surfaces.
   Green: `surfaceProperty`, the ten literal properties, deletion of `DIRECTIONAL_SURFACE_DESCRIPTIONS`, the rewritten object-level `markdownDescription`, then `pnpm run gen:schema`.
   Verify: `pnpm run check`, `pnpm run lint`, the **full** package suite (not just the schema file), and `pnpm fallow dead-code`.
   Killing mutations, one per equivalence class — (a) roster: delete the `bash: surfaceProperty({ ... })` line, which must redden the ten-key roster assertion and `bash`'s parse case; (b) catchall: drop `.catchall(surfaceValueSchema)`, which must redden both arbitrary-tool-name assertions; (c) documentation: remove `markdownDescription` from `skill`'s meta, which must redden the per-property presence assertion; (d) budget: paste the old 2034-character blob back onto the object, which must redden the object-level length assertion; (e) parity: hand-delete `mcp` from `schemas/permissions.schema.json`, which must redden the parity test.
   `feat(pi-permission-system): name and document the well-known permission surfaces (#808)`
4. **`docs:` documentation and the roadmap mark.**
   `docs/architecture/architecture.md` — the `config-schema.ts` module-tree entry, Step 9's `✅` on both the heading and the Mermaid `S9` node, its `Landed:` note, and the delivered value for the `surfaceProperty` metric row.
   `docs/configuration.md` — the Editor tip sentence.
   Re-measure the generated schema's byte size and record the real figure in the `Landed:` note rather than the prediction.
   `docs(pi-permission-system): document the named permission surfaces (#808)`

## Risks and Mitigations

1. **Losing the catchall silently rejects every extension-tool surface.**
   The worst available outcome, and a plain `z.object({ ... })` without `.catchall` is a one-token slip while rewriting the literal.
   It would fail closed — every config naming a tool surface rejected, universal `ask` — and neither `tsc` nor the parity test would flag it.
   Mitigated by cycle 3's killing mutation (b) being run for real, and by the two pre-existing catchall assertions staying untouched.
2. **The tuple and the properties drift apart.**
   Adding a fifth directional property without adding it to `DIRECTIONAL_SURFACE_KEYS` would make the loader reject a key the schema advertises.
   Mitigated by cycle 1's test, which asserts the two agree and is landed before the structural guarantee is removed.
3. **The regeneration is forgotten.**
   The parity test fails loudly with the exact remedy in its message.
   Nothing further needed.
4. **The blob re-forms one property at a time.**
   The 800-character cap is asserted in cycle 3 rather than left to review, so the next surface added has to argue with a failing test rather than with a reviewer's memory.
5. **The reordered directional properties make the generated diff look larger than the change.**
   Cosmetic.
   The parity test proves the committed file equals the generated one, and grouping by family is what makes the emitted schema read in a sensible order for a human browsing it.
6. **The prose distilled from `docs/configuration.md` drifts from it.**
   Accepted.
   The schema text is deliberately a summary with the guide as the long form, and no test can pin a distillation to its source.
   Both are edited by the same change when a surface's behavior changes, which is the same discipline the `PURE_READER_CORE` marker block formalizes elsewhere.

## Open Questions

1. **Should the size budget become a documented convention rather than only a test?**
   The test is the enforcement; a sentence in the architecture doc's module-tree entry would be the explanation.
   Deferred until a second reviewer trips over the assertion without knowing why it exists.
2. **Should `task` be named too?**
   `docs/configuration.md` lists it in the Tool Surfaces table as the delegation tool, but it is a `pi-subagents` tool rather than a permission-system concept, and naming it would put a sibling package's tool name in this schema — the same coupling that sent [#868] to its own issue.
   Left out; revisit if the tool-surfaces table grows a second first-party entry.

[#806]: https://github.com/gotgenes/pi-packages/issues/806
[#868]: https://github.com/gotgenes/pi-packages/issues/868
