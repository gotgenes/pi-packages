---
issue: 789
issue_title: "pi-permission-system: consolidate the subagent adapter convention and loading-asymmetry docs (ADR 0012 decisions 5–6)"
---

# Consolidate the subagent adapter convention and loading-asymmetry docs

## Release Recommendation

**Release:** ship independently

Neither package carries an open improvement phase — `grep '^## Improvement roadmap — Phase'` finds no match in either `architecture.md` — so no roadmap step references this issue and there is no batch to join.
The work cuts two components: a `fix:` plus `docs:` for `@gotgenes/pi-permission-system`, and a `docs:` for `@gotgenes/pi-subagents` (both packages' `docs/decisions` and `docs/architecture` are `exclude-paths` entries, so only `subagent-integration.md`, `cross-extension-api.md`, the READMEs, and pi-subagents' `configuration.md` drive a release).
Shipping matters here because the deliverable *is* the shipped tarball's docs — an unshipped canonical spec cannot serve the sibling authors it is written for.

## Problem Statement

[ADR 0012] decisions 5 and 6 exist only as a decision record.
Decision 5 names the **subagent adapter convention** — the one supported API between a subagent implementation and this package — and designates `docs/subagent-integration.md` as its canonical home, ending the arrangement where the channel names and payload shapes are declared independently in two packages.
Decision 6 states the loading-asymmetry rule: riding along is harmless by construction, exclusion is an optimization and never a correctness requirement, and excluding an extractor or formatter *provider* from children weakens the child's own gates.

Neither statement reaches a reader today.
`docs/subagent-integration.md` describes what `@gotgenes/pi-subagents` *does* ("It publishes a child-execution lifecycle on `pi.events`"), not what an implementation *owes*; the architecture doc and pi-subagents' [ADR-0002] restate the same channel facts independently; and nothing user-facing mentions the loading asymmetry at all.

Investigation also found the convention's out-of-process half does not work as decision 5 states it.
Decision 5 says an out-of-process implementation's entire obligation is `PI_SUBAGENT_PARENT_SESSION=<parent-session-id>`, but that variable is absent from `SUBAGENT_ENV_HINT_KEYS`, the list `isSubagentExecutionContext` reads.
A spawner that follows the ADR literally is therefore not detected as a subagent, `selectAuthorizer` takes the no-UI/not-subagent arm, and its asks are blocked by `DenyingAuthorizer` without ever being forwarded.
The existing round-trip tests encode the gap in their own arrangement: `test/composition-root.test.ts:428` stubs `PI_SUBAGENT_CHILD` *and* `PI_SUBAGENT_PARENT_SESSION`, commented "the hint makes the child detect itself, and the parent id names a session that exited."
Writing the spec as decision 5 states it would publish a contract the code does not honor.

## Goals

- Make `docs/subagent-integration.md` the canonical spec for the subagent adapter convention: what an implementation owes on each process shape, and the explicit list of what it does **not** owe.
- Make the convention's stated obligation true: a process that names a parent session is a subagent child by definition, so the parent-session env candidates are detection hints too.
- Record decision 6's loading-asymmetry rule where an operator meets it — in full beside the `excludedExtensionPackages` setting that creates the hazard, and in summary in the spec.
- End the independent restatements: the architecture doc's subagent sections, `cross-extension-api.md`'s subagent section, and pi-subagents' [ADR-0002] cite the spec instead of re-declaring channel names and ordering.
- The behavior change in the detection fix is **not breaking**: it moves a session that sets a parent-session variable from "blocked, never forwarded" to "forwarded", which is the only behavior that variable has ever existed to produce.
  No default changes, no output shape changes, and no configuration edit is required on upgrade.

## Non-Goals

- Rewriting `docs/cross-extension-api.md` for the keyed channel (the issue's fourth scope bullet).
  It already landed with the mechanisms: [#699]'s `8ed137c6` documented session-keyed publication and the locator, and [#787]'s `bc31193a` documented the latch and its idempotency requirement.
  Only its `#### Subagent session registration` subsection is in scope here, and only to replace a restatement with a citation.
- Any mechanism for the exclusion hazards.
  Three follow-ups are filed and deliberately not folded in: [#791] (pi-subagents warns on an `excludedExtensionPackages` entry matching no configured package source), [#792] (alarm when a registered in-process child has no permission node), [#793] (close or announce the split-provider access-extractor gap).
  This change ships the checkable condition as interim cover.
- Amending [ADR 0012].
  Decision 5's out-of-process sentence becomes true by the code change rather than by editing the record; decision 1 is untouched, and the read-through fallback that would amend it is [#793]'s question.
- The judge migration ([#788]) and the zero-arg accessor's removal, both of which ADR 0012 sequences elsewhere.
- Adding `PI_SUBAGENT_PARENT_SESSION` to the `SUBAGENT_ENV_HINT_KEYS`-driven prose inventory of *third-party* extensions in the architecture doc as if it were one extension's variable — it is convention-wide and is documented as such.

## Background

### Where the pieces live

| Concern                 | Location                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detection hints         | `SUBAGENT_ENV_HINT_KEYS`, `packages/pi-permission-system/src/authority/permission-forwarding.ts:21`                                                                              |
| Parent-session sources  | `SUBAGENT_PARENT_SESSION_ENV_CANDIDATES`, same file, line 38                                                                                                                     |
| Detection               | `isSubagentExecutionContext`, `src/authority/subagent-context.ts` (registry → env hints → session-dir fallback)                                                                  |
| In-process announcement | `subagents:child:session-created` / `:disposed`, published by `packages/pi-subagents/src/lifecycle/child-lifecycle.ts`, consumed by `src/authority/subagent-lifecycle-events.ts` |
| Exclusion setting       | `excludedExtensionPackages`, `packages/pi-subagents/src/settings.ts` + `src/session/package-exclusions.ts`, resolved at `src/index.ts:109`                                       |

`excludedExtensionPackages` is a pi-subagents setting and has no counterpart in pi-permission-system, whose only levers are deny-at-use.
It matches by exact string equality on Pi's configured package source, with no glob, prefix, or normalization.

### Constraints from AGENTS.md that apply

- `packages/pi-permission-system/docs/decisions/` and `docs/architecture/` are **not** in the `files` allowlist, so a link from the shipped `subagent-integration.md` into either resolves to nothing in the tarball.
  Cite [ADR 0012] by absolute GitHub URL, the precedent `subagent-integration.md` already sets for [ADR-0002].
  A cross-package link (spec → pi-subagents `configuration.md`, and back) is absolute for the same reason.
- Every doc edit here reworks the documented behavior of a mechanism rather than removing a symbol, so the `.pi/skills/package-*/SKILL.md` grep applies: both package skills state the channel contract in prose that carries no removed symbol to match.
- The issue is the operator's own, and the three clarification gates settled: fold the detection fix in, restructure the spec rather than prepend to it, place the full asymmetry condition in pi-subagents' `configuration.md`, and repoint three sites (not the source module headers, not pi-subagents' README/comparison doc).

## Design Overview

### 1. The convention's obligation becomes true by construction

The two env lists answer different questions ("is this process a child?"
and "whose child is it?") but the second answer entails the first: a process that names a parent session **is** a child.
Rather than duplicating the string across both arrays, the hint list is composed from the third-party inventory plus the parent-session candidates:

```typescript
/** Env vars naming the session a child forwards its asks to. */
export const SUBAGENT_PARENT_SESSION_ENV_CANDIDATES: readonly string[] = [
  "PI_AGENT_ROUTER_PARENT_SESSION_ID", // grandfathered
  "PI_SUBAGENT_PARENT_SESSION", // the convention (ADR 0012 decision 5)
] as const;

/** Per-extension markers set by known process-based subagent extensions. */
const THIRD_PARTY_SUBAGENT_ENV_HINTS = [
  /* the eleven existing keys, unchanged */
] as const;

/**
 * A process that names a parent session is a child by definition, so every
 * parent-session candidate is also a detection hint. This is what makes the
 * adapter convention's single out-of-process obligation sufficient.
 */
export const SUBAGENT_ENV_HINT_KEYS: readonly string[] = [
  ...THIRD_PARTY_SUBAGENT_ENV_HINTS,
  ...SUBAGENT_PARENT_SESSION_ENV_CANDIDATES,
];
```

Consumers are unaffected: `subagent-context.ts` iterates the list, and the only other readers are tests.
The declaration order in the file inverts (candidates first, hints second), which is the whole structural change.

Behavior delta, enumerated:

| Env state                                       | Before                                                                                | After                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| A hint var set, no parent-session var           | Detected; forwarding target unresolvable; blocked with the "no parent session" reason | Unchanged                                                                  |
| A hint var **and** `PI_SUBAGENT_PARENT_SESSION` | Detected; forwards                                                                    | Unchanged                                                                  |
| `PI_SUBAGENT_PARENT_SESSION` alone              | **Not** detected; `DenyingAuthorizer` blocks every ask with the no-UI reason          | Detected; forwards to the named session, subject to the liveness fast-fail |
| `PI_AGENT_ROUTER_PARENT_SESSION_ID` alone       | Not detected                                                                          | Detected                                                                   |
| Neither                                         | Unchanged                                                                             | Unchanged                                                                  |

Only the third and fourth rows change, and both move from "silently unforwardable" to the convention's intended path.

### 2. The spec's shape

`docs/subagent-integration.md` is reordered spec-first, so an implementer reads the contract before the behavior it buys:

1. `## The subagent adapter convention` — the obligation.
   In-process: emit `subagents:child:session-created` with `{ sessionId, parentSessionId? }` **synchronously, on the same call stack, before `bindExtensions()`** (the ordering is contract, not an implementation detail — the registry entry must land before binding proceeds), and `subagents:child:disposed` with `{ sessionId }` in the run's `finally`.
   Out-of-process: set `PI_SUBAGENT_PARENT_SESSION=<parent-session-id>` in the spawned child's environment.
   Then the explicit non-obligations: detection, terminal selection, forwarding, the serving heartbeat, liveness fast-fail, grant scope, and per-agent frontmatter are all this package's job on both ends — no import, no service resolution, no permission management.
   Then grandfathering: the per-extension hint keys and `PI_AGENT_ROUTER_PARENT_SESSION_ID` remain honored; new implementations use the convention name.
2. `## Loading asymmetry` — decision 6's three statements, with the operator-facing condition summarized and linked to pi-subagents' `configuration.md`.
3. `## What this package does on both ends` — the current native-integration prose, reframed from "what pi-subagents does" to "what the announcement buys you", keeping the process-global-registry rationale and the per-session-bus explanation intact.
4. `## Permission Forwarding` (with `### When nobody answers` and `### Upgrading`) — unchanged.
5. `## Conformance of known implementations` — the current table, with its columns re-read as convention conformance and its stale row fixed.
6. `## Coexistence with Other Subagent Extensions` — unchanged.

Size budget: the convention section is 45–60 lines including one YAML/TS-free bullet list per shape; the asymmetry section is 12–18 lines.
Anything longer is behavior prose that belongs in section 3 or 4.

### 3. The pointer, at both ends of its size range

Smallest — `cross-extension-api.md`, replacing the restatement at line 285–287:

```markdown
In-process subagent registration is event-driven; the spawner makes no service call.
The channel names, payload shapes, and pre-bind ordering are specified by the subagent adapter convention in [Subagent Integration](subagent-integration.md#the-subagent-adapter-convention).
```

Largest — pi-subagents [ADR-0002], an `accepted` record whose body is deliberative context rather than a status board.
It already carries `## Amendment: prevent-load ships as a settings key, not a provider seam (#696)`, so the treatment follows that precedent: an appended amendment section of roughly four sentences naming the convention, stating that the canonical declaration now lives downstream, and linking it absolutely.
Lines 43 and 95 stay as written — they record what the decision required at the time, which remains true.

### 4. The asymmetry condition, sharpened

The generic hazard ("excluding a provider weakens the child's gates") is unfalsifiable at the operator's desk. pi-subagents' own semantics narrow it: excluding a package keeps that package's **tools** out of children too, so a package that provides both a tool and its access extractor takes both away and leaves no gap.
A gap requires a split — package A registers the tool, package B registers `registerToolAccessExtractor` for it, and B alone is excluded.
The full condition, the worked example, and the note that formatters are cosmetic while extractors are a security surface go in pi-subagents' `configuration.md` § "Excluding package extensions from children", where the operator is when they create the hazard; the spec states the three-part rule and links across.

## Module-Level Changes

### `@gotgenes/pi-permission-system`

| File                                      | Change                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/authority/permission-forwarding.ts`  | Move `SUBAGENT_PARENT_SESSION_ENV_CANDIDATES` above the hint list; rename the existing literal array to `THIRD_PARTY_SUBAGENT_ENV_HINTS` (module-private); compose `SUBAGENT_ENV_HINT_KEYS` from both; document why in the doc comment                                                                             |
| `test/authority/subagent-context.test.ts` | Two new env-hint tests (`PI_SUBAGENT_PARENT_SESSION` alone, `PI_AGENT_ROUTER_PARENT_SESSION_ID` alone); extend "covers all declared `SUBAGENT_ENV_HINT_KEYS`" with the two candidate names                                                                                                                         |
| `test/composition-root.test.ts`           | New round-trip test: an out-of-process child setting **only** `PI_SUBAGENT_PARENT_SESSION` forwards and is answered, mirroring "waits for an out-of-process parent whose heartbeat is fresh" minus the `PI_SUBAGENT_CHILD` stub                                                                                    |
| `docs/subagent-integration.md`            | Spec-first restructure per Design Overview §2; new convention and loading-asymmetry sections; conformance table's `@gotgenes/pi-subagents` row corrected from `disallowed_tools:` (CSV denylist, removed in Phase 14) to `tools:` (allowlist); ADR 0012 cited by absolute URL                                      |
| `docs/cross-extension-api.md`             | `#### Subagent session registration` (lines 283–287) cites the convention instead of restating the channel names                                                                                                                                                                                                   |
| `docs/architecture/architecture.md`       | Detection list item 2 (line 488) notes the parent-session candidates are hints; the in-process case (lines 506–509) and the registry bullet (line 484) cite the spec rather than re-declaring the events; the env inventory table (lines 471–478) gains a convention row separate from the per-extension inventory |
| `README.md`                               | Docs-table row (line 182) renamed from "Permission forwarding, coexistence with subagent extensions" to name the canonical adapter-convention spec                                                                                                                                                                 |

### `@gotgenes/pi-subagents`

| File                                                  | Change                                                                                                                                                                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/decisions/0002-extensions-on-a-minimal-core.md` | Appended amendment section pointing at the canonical spec; body untouched                                                                                                                                                                 |
| `docs/configuration.md`                               | § "Excluding package extensions from children" gains the full loading-asymmetry condition: link-only extensions are free to exclude, the split-provider gap is the one real hazard, formatters are cosmetic, and [#793] tracks closing it |

### Repo

| File                                               | Change                                                                                                                                                            |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.pi/skills/package-pi-permission-system/SKILL.md` | § "Event-based subagent integration" names `docs/subagent-integration.md` as the canonical spec and records that a parent-session env var is now a detection hint |
| `.pi/skills/package-pi-subagents/SKILL.md`         | The `excludedExtensionPackages` carve-out bullet gains one sentence on the split-provider hazard and its issue                                                    |

### Greps run at planning time to build this list

- `subagents:child|PI_SUBAGENT_PARENT_SESSION|bindExtensions` across `packages/**/*.md`, `.pi/`, and `README.md` — every current-state hit is in the table above; the remainder are `CHANGELOG.md`, frozen plans/retros, `docs/architecture/history/`, and `.pi/npm/node_modules/` copies.
- `env hint|env-hint|env var|SUBAGENT_ENV_HINT` across `packages/pi-permission-system/docs` and `README.md` — surfaced the architecture doc's inventory table and detection list, plus `docs/migration/0745-prompt-payload-contracts.md:17`, which describes an out-of-process subagent as "resolved through `PI_SUBAGENT_PARENT_SESSION` or a sibling env var" and stays true.
- `disallowed_tools` across `packages/pi-permission-system/docs` and `README.md` — the conformance-table row is the only stale current-state hit; `docs/guides/*.md` mentions are about third-party keys generally and stay correct.
- `SUBAGENT_ENV_HINT_KEYS` across `src/` and `test/` — two readers (`subagent-context.ts`, `subagent-context.test.ts`), both listed.
- `^## Improvement roadmap — Phase` in both packages' `architecture.md` — no match, so no roadmap step-mark or Mermaid node to update, and `roadmap-fit` exits at step 1 for all three filed follow-ups.

## Test Impact Analysis

1. **New coverage the change enables.**
   Detection by the convention's own variable is untested today because it does not work.
   Two unit tests pin it at the `isSubagentExecutionContext` level, and one composition-root test pins the whole out-of-process path from a single env var to an answered forwarded request.
2. **Tests that become redundant.**
   None.
   The two existing out-of-process composition-root tests keep their `PI_SUBAGENT_CHILD` stub deliberately: they cover the third-party spawners (nicobailon, HazAT) that set a hint but no parent session, which is a different population from a convention-conformant spawner.
3. **Tests that must stay as-is.**
   `test/authority/permission-forwarding.test.ts`'s `SUBAGENT_PARENT_SESSION_ENV_CANDIDATES` block pins the candidate order (`PI_AGENT_ROUTER_PARENT_SESSION_ID` first) and the deprecated alias; composition is additive and must not disturb either.
4. **Doc-change verification.**
   The docs steps carry no shell commands to dry-run.
   Their verification is `pnpm exec rumdl check` on each edited file plus a link check: every cross-package and `docs/decisions`-bound link from a **shipped** doc must be an absolute GitHub URL, confirmed by `rg -n '\]\(\.\./decisions|\]\(\.\./\.\./'` over the edited shipped docs returning nothing.

## Invariants at risk

- **Pre-bind synchronous registration.**
  The spec now states the ordering as contract rather than as description, so the invariant gains a reader but no new enforcement.
  It is pinned by `test/authority/subagent-lifecycle-events.test.ts` (the handler registers without awaiting) and by the source comment in `subagent-lifecycle-events.ts`, which this plan deliberately leaves in place.
- **Third-party detection unchanged.**
  Pinned by the "covers all declared `SUBAGENT_ENV_HINT_KEYS`" test, which keeps asserting all eleven per-extension keys after the composition; a regression that dropped the inventory in favor of the candidates alone fails there.
- **Empty and whitespace hint values stay non-hints.**
  `isSubagentExecutionContext` trims before accepting; the existing "empty string" and "whitespace only" tests continue to cover it, and the composition adds no new value-shape branch.
- **The `#302` root-slot guard.**
  Untouched: it keys on `isRegisteredSubagentChild` (the in-process registry), not on env hints, so widening the env list cannot make an out-of-process node stop publishing its own root slot.

## TDD Order

1. **`fix:` — a parent-session env var is a subagent detection hint.**
   Red: two tests in `test/authority/subagent-context.test.ts` (`PI_SUBAGENT_PARENT_SESSION` alone, `PI_AGENT_ROUTER_PARENT_SESSION_ID` alone → `true`), plus a composition-root round-trip stubbing only `PI_SUBAGENT_PARENT_SESSION` and asserting the forwarded request is created and answered.
   All three fail today: the child is undetected, so `DenyingAuthorizer` blocks with the no-UI reason and no request file is ever written.
   Green: compose `SUBAGENT_ENV_HINT_KEYS` per Design Overview §1 and extend the inventory test with the two candidate names.
   Verify: `pnpm --filter @gotgenes/pi-permission-system exec vitest run test/authority test/composition-root.test.ts`, then the full package suite and `pnpm run check`.
   Commit: `fix(pi-permission-system): detect a subagent from its parent-session env var (#789)`.
2. **`docs:` — the canonical spec.**
   Restructure `docs/subagent-integration.md` per Design Overview §2: the convention section (stating the single out-of-process obligation, now true), the loading-asymmetry section, the reframed behavior sections, and the corrected conformance table.
   Verify: `pnpm exec rumdl check packages/pi-permission-system/docs/subagent-integration.md`; no relative link escapes the tarball's `files` allowlist; the convention section is within its 45–60-line budget.
   Commit: `docs(pi-permission-system): make subagent-integration the adapter convention's canonical spec (#789)`.
3. **`docs:` — repoint the restating sites.**
   `cross-extension-api.md`'s subagent subsection, the architecture doc's detection/in-process sections and env inventory table, and the README docs-table row.
   Verify: `rg -n 'subagents:child' packages/pi-permission-system/docs README.md` returns only the spec and frozen history; `pnpm exec rumdl check` on each edited file.
   Commit: `docs(pi-permission-system): cite the adapter convention instead of restating it (#789)`.
4. **`docs:` — pi-subagents.**
   The [ADR-0002] amendment section and the `configuration.md` loading-asymmetry condition.
   Verify: `pnpm exec rumdl check` on both; the `configuration.md` link to the spec is absolute; the amendment does not contradict the body it follows.
   Commit: `docs(pi-subagents): record the loading-asymmetry condition and cite the adapter convention (#789)`.
5. **`docs:` — package skills.**
   Both `SKILL.md` updates.
   Verify: `pnpm run lint`.
   Commit: `docs: point the package skills at the subagent adapter convention (#789)`.

Steps 2–5 are independent of each other and all depend on step 1, which is what makes the single-variable obligation true before any doc states it.

## Risks and Mitigations

| Risk                                                                                                                                                    | Mitigation                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Widening the hint list lets a process claim child status by setting one env var, moving its asks from blocked to a forwarded prompt a human may approve | The claim is only reachable by whoever controls the process's environment, which is already full control of that pi process; and the outcome is a prompt in the parent's UI labeled `(Subagent)`, not a silent allow. The named target must also pass the liveness check, so a fabricated session id fast-fails |
| The spec-first restructure reparents a trailing paragraph or example under a new heading                                                                | The markdown skill's rule applies: read each parent section end to end before inserting; the restructure moves whole sections rather than splicing into them, and `rumdl check` runs per file                                                                                                                   |
| A shipped doc links into `docs/decisions/` or across packages and resolves to nothing in the tarball                                                    | Absolute GitHub URLs for both cases, per the precedent already set in this file for [ADR-0002]; verified by grep in step 2 and step 4                                                                                                                                                                           |
| The asymmetry condition drifts between the two packages' copies                                                                                         | Only pi-subagents' `configuration.md` carries the full condition; the spec carries the three-part rule and a link, which is the arrangement decision 5 exists to produce                                                                                                                                        |
| The conformance table's corrected row goes stale again as third-party extensions change                                                                 | The column semantics change from "permission integration" to convention conformance, which is a property of the announcement rather than of each extension's frontmatter vocabulary, and therefore changes only when an implementation adopts the convention                                                    |

## Open Questions

- Whether the source module headers in `subagent-lifecycle-events.ts` and `child-lifecycle.ts` should eventually cite the spec.
  The clarification gate excluded them from this change; they remain accurate, and the "MUST match the publisher" comment is the enforcement the spec describes rather than a duplicate of it.
- Whether the split-provider gap is closed or merely announced — deliberated in [#793], with the read-through fallback (which would amend [ADR 0012] decision 1) and the child-side diagnostic as the two candidates.
- Whether [#792]'s alarm should refuse an `excludedExtensionPackages` entry naming pi-permission-system outright rather than warning.
  Refusing means one package overriding another's settings, which cuts against [ADR-0002]'s separation.

[ADR 0012]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0012-cross-node-extension-contract.md
[ADR-0002]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/docs/decisions/0002-extensions-on-a-minimal-core.md
[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#787]: https://github.com/gotgenes/pi-packages/issues/787
[#788]: https://github.com/gotgenes/pi-packages/issues/788
[#791]: https://github.com/gotgenes/pi-packages/issues/791
[#792]: https://github.com/gotgenes/pi-packages/issues/792
[#793]: https://github.com/gotgenes/pi-packages/issues/793
