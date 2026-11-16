---
issue: 882
issue_title: "pi-permission-system: decide whether a chain link may dismiss an external_directory ask for a token that names nothing on disk (ADR 0007 §5)"
---

# A chain link may allow a bash `external_directory` ask whose paths name nothing on disk

## Release Recommendation

**Release:** ship independently

Phase 15 Step 7 carries `Release: independent` in `docs/architecture/architecture.md`, and it belongs to no release batch.
The checkpoint change ships as `feat!:`, so it cuts a major on its own.

## Problem Statement

Two decision records make opposite promises about the same population.
ADR 0009's layering principle (restated in the architecture doc's *model judge* section and relied on by ADR 0013 §7) has the deterministic projection bias toward surfacing, with the judge absorbing the surplus.
ADR 0007 §5 excludes the whole `external_directory` family from a link's `allow`, so `encloseInDelegationEnvelope` caps every such verdict to `defer`, and on the one surface where the projection's false positives land the judge can only hand the ask back to the human.

The scenario, in the user's terms ([#797]): the user runs `officecli set data.xlsx /Sheet1/B1`, an `external_directory` prompt lists `/Sheet1/B1`, and no configured link can make it go away.
`model-judge` only ever denies or defers, and the allow-capable third-party `pi-permission-classifier` (0.5.2, `src/reviewer.ts` in the published tarball) does not even attempt the `path`/`external_directory` families because it mirrors our cap.
[#880]'s `commandEffects: { officecli: { effects: [] } }` fixes it only for a user who declared the tool; the undeclared tool has no lever but judgment.

## Goals

- Amend ADR 0007 with a new §8 recording the operator's decision: a link may `allow` a **bash** `external_directory` ask when **every** uncovered path the ask flags names nothing on disk below the filesystem root (the first existing entry along it is the root itself) **and** none of those paths is a proven write.
- Name in the amendment which question it decides: the narrow existence bound, not PR [#983]'s per-link `authorizerTrust` map, which stays parked on [#620] / [#799].
  The reason [#684]'s blanket flag was not adopted carries over to [#983]: a per-family switch hands a model the outside-the-tree boundary wholesale.
- Fix the license fact at the asking node (ADR 0008), carry it across the forwarding wire, and read it at the bounded-delegation checkpoint.
- Write a review record at the checkpoint whenever it honors an `allow` because of the license, so the fact that licensed it is auditable.
- **Breaking:** the documented guarantee "the chain owner caps any link's `allow` on the `external_directory`/`path` surface families" no longer holds unconditionally.
  After the upgrade, without any user edit, a configured link that returns `allow` on a licensed ask is honored where it used to be capped.
  The behavior step ships as `feat(pi-permission-system)!:` with a `BREAKING CHANGE:` footer and a migration note.

## Non-Goals

- **PR [#983]'s per-link trust map**, and any other relaxation of a whole surface family.
  The amendment names it as a different question; the PR stays open and parked on [#620] / [#799].
  At ship time, comment on [#983] to say the amendment decided only the narrow bound.
- **PR [#684]** is already closed by its author; nothing to close.
- **Tool `external_directory` asks** (`write`, `edit`, an extension tool's extracted path).
  A tool's path argument is a path by its identity, not by its shape, so the shape-indistinguishable class does not exist there; `write /newtop/x` is a real write.
  The tool gate never stamps the license.
- **The `path` family.**
  A `path` ask fires on a rule the operator wrote; it stays excluded whatever facts the ask carries.
- **Changing `@gotgenes/pi-permission-model-judge`.**
  It is deny-first by charter (its README: "never `allow`"), and adopting the license is a separate decision for that package.
  `pi-permission-classifier` adopting it is its author's call; the field becomes visible to links on `details.accessIntent`.
- **[#620]'s secret-shaped `path` refinement** and the allow-capable opaque-bash adjudicator.
- **Windows relief.**
  Git Bash keeps a non-mount POSIX-absolute token literal (ADR 0003, `PathNormalizer.forBashToken`), with no canonical form to probe, so `/Sheet1/B1` on a win32 host is never licensed.
  An MSYS drive-mount token (`/c/Sheet1/B1`) resolves to `C:\Sheet1\B1` and can be.
- **A review record for the cap itself** (an `allow` downgraded to `defer`): the checkpoint is silent there today, and this change leaves that unchanged.

## Background

- `src/authority/delegation-envelope.ts` — `encloseInDelegationEnvelope(authorize)` wraps each configured link; `isExcludedSurface` reads `details.accessIntent?.surface ?? details.surface` and tests `DELEGATION_EXCLUDED_SURFACES.has(surfaceFamilyOf(surface))`, failing safe on an undetermined surface.
  Its one `src/` caller is `AuthorizerSelection.resolveConfiguredLinks` (`src/authority/authorizer-selection.ts`), which holds the link `name`.
- `src/handlers/gates/bash-external-directory.ts` — `describeBashExternalDirectoryGate` resolves every external path (`BashProgram.externalAccesses()`, each `{ path: AccessPath, effect: TokenEffect }`), keeps the uncovered ones via `selectUncoveredExternalPaths`, and stamps `promptDetails.accessIntent = accessFactsFromPath(surface, worstEntry.path)` — the deciding path only.
  The license must quantify over **every** uncovered entry, which only this gate holds.
- `src/authority/permission-forwarding.ts` — `ForwardedAccessFacts` (`surface`, `matchValues`, `boundaryValue`, `floor?`, `askingUnits?`) is the child-fixed fact set; `ParentAuthorizer` spreads it into the wire `ForwardedAccessIntent` (`approval-escalator.ts`), `asForwardedAccessIntent` (`forwarding-io.ts`) is the allowlist reader on the serving side, and `toAccessFacts` (`forwarded-request-server.ts`) projects it back onto the ask details field by field.
- `src/path/path-normalizer.ts` — the package's single filesystem edge for path interpretation; `entryExists` is the `lstat` probe ADR 0009's bare-token promotion uses.
  `AccessPath.boundaryValue()` is the canonical (symlink-resolved) form, `""` for a literal-only path.
- `src/access-intent/effect.ts` — `TokenEffect.effect` is `"read" | "write" | "unproven"`; a proven write is `effect === "write"` (syntax or a `commandEffects` declaration).
- `src/authority/authorizer-chain.ts` — a link's `allow` becomes `{ approved: true, state: "approved", decidedBy: { kind: "authorizer", name, verdict: "allow", reason: null } }`; non-persistent by construction.
- AGENTS.md / package skill constraints that apply: default to least privilege; decisions stay reviewable in the review log; `decidedBy` is stamped at the site that decides, never inferred; no node re-derives a forwarded fact (ADR 0008); config-shape alignment does not apply (no config key is added).

### Evidence the design rests on

Measured 2026-10-17 against the local review log (`~/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl`) with disposable scripts, now deleted:

| Source                                                                                                                  | Asks                    | All flagged paths name nothing on disk below `/` |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------ |
| Message-era `waiting` entries (paths parsed from `message`), 2026-05-03 – 2026-08-14                                    | 617 bash ext-dir asks   | 13                                               |
| `waiting` entries since then, re-projected through the current `BashProgram.parse` with cwd assumed to be the repo root | 429 with external paths | 18 (4.2%)                                        |

- Every one of the 31 is a non-path token: `gh api` routes (`/repos/…`, `/gists/…`, `/notifications?…`), Pi slash commands, `git log -L '/re/,+1:file'` ranges, commit-message prose, regex fragments.
  One adversarial case surfaced: `sudo -n --ed /nonexistent-dir-xyz/f`, an unproven edit target the bound admits; `sudo` keeps its own bash-surface floor ask regardless.
- Of the 18 recent asks, the licensing paths' effects were 18 `unproven` and 1 `core` read, so a bound requiring a proven `read` would relieve almost none of the population.
- A further 14 recent asks mix an unrooted token with a real external path; an all-paths bound keeps prompting for them.
- The looser "nothing exists at the path itself" bound could not be measured fairly (existence at ask time is not logged; 94 asks look all-absent today, mostly deleted temp directories), and it admits writes into existing outside directories (`mkdir -p ~/newdir`, `cat > ~/.config/autostart/x.desktop`).

## Design Overview

### The bound (ADR 0007 §8)

A link's `allow` on an ask whose gate surface is in the `external_directory` family is honored, instead of capped to `defer`, iff the ask carries `accessIntent.delegationLicense === "nothing-on-disk"`.
The bash external-directory gate stamps that license iff, for **every** uncovered entry:

1. the path has a canonical form (`boundaryValue() !== ""`) — a literal-only path (unknown base after a non-literal `cd`, a win32 POSIX-absolute) cannot be probed and never licenses;
2. walking the canonical form toward the root, the first entry `lstat` finds is the filesystem root itself — only `ENOENT` continues the walk, and any other error (`ENOTDIR`: an ancestor is a file; `EACCES`; `ELOOP`) answers "not licensed";
3. its attributed effect is not a proven `write` (`effect.effect !== "write"`): a redirect destination or a declared writer is a file by syntax or by the user's word, not a shape-ambiguous token.

Accepted residual (recorded in §8): a command that, privileged to write at `/`, creates a new top-level entry there.
On macOS the sealed system volume refuses that even under `sudo`; on Linux it needs root, and a `sudo` unit keeps its own floor ask on the bash surface, which the envelope does not cover — exactly as today for any bash ask.
Time-of-check: the existence probe runs at the gate, before the command runs; a unit earlier in the same command that creates the top-level directory flags that directory too (`mkdir /x && …` flags `/x`), which is itself unrooted, so the residual is the same top-level creation and nothing more.

### The fact, its one home, and the wire

```typescript
// src/authority/permission-forwarding.ts
export interface ForwardedAccessFacts {
  surface: string;
  matchValues: string[];
  boundaryValue: string | null;
  floor?: string;
  askingUnits?: AskingBashUnit[];
  /**
   * Set only by the bash external-directory gate, when every uncovered path names
   * nothing on disk below the filesystem root and none is a proven write
   * (ADR 0007 §8). The delegation envelope honors a link's `allow` on the
   * `external_directory` family only when it is present. Absent means unlicensed.
   */
  delegationLicense?: "nothing-on-disk";
}
```

The fact lives on `ForwardedAccessFacts` only — not also on the `PromptPayload` request core the issue suggested.
The envelope already reads the gate-authoritative `accessIntent`, the fact is a security input rather than a presentation fact (ADR 0011 governs the payload), and a second copy could drift from the first.
The audit line comes from a dedicated record instead (below), written at the site that decides.

A string-literal value rather than a boolean leaves room for a later license ([#620]'s secret-shaped refinement) without a second field.

Wire handling, fail-safe in both version-skew directions:

- `ParentAuthorizer` already spreads `details.accessIntent` into the wire intent, so the child writes the field with no change there (`approval-escalator.test.ts` builds its own intent and needs none).
- `asForwardedAccessIntent` admits the field only when it equals `"nothing-on-disk"`; any other value **drops the field**, not the intent — absence is the restrictive reading, unlike a malformed `floor`, whose absence would be permissive.
- `toAccessFacts` projects the field explicitly.
  It is optional, so omitting it is **not** a compile error (contrary to that function's comment); a forwarded-request-server test is the red.
- An older child sends no license → capped.
  An older serving node's allowlist drops the field → capped.

### The checkpoint

```typescript
// src/authority/delegation-envelope.ts (sketch)
export function encloseInDelegationEnvelope(
  name: string,
  authorize: Authorizer["authorize"],
): Authorizer["authorize"] {
  return async (details, query, log) => {
    const verdict = await authorize(details, query, log);
    if (verdict.kind !== "allow" || !isExcludedSurface(details)) return verdict;
    const license = licenseFor(details); // "nothing-on-disk" | null
    if (license === null) return { kind: "defer" };
    log.review("authorizer_allow_licensed", { requestId: details.requestId, link: name, license });
    return verdict;
  };
}
// licenseFor: family of the gate surface is "external_directory" AND
// details.accessIntent?.delegationLicense === "nothing-on-disk"; never for `path`,
// never for an undetermined surface, never off the display-surface fallback.
```

`authorizer_allow_licensed` sits beside the existing `authorizer_chain_*` records, keyed by `requestId`, so an operator joins it to the `permission_request.approved` entry whose `decidedBy` names the same link.
`DELEGATION_EXCLUDED_SURFACES` keeps its name and membership: both families are still excluded by default, and the license is an exception the checkpoint grants, not a change to the set.
The module header and doc comments are reworded in the same step.

### The gate

```typescript
// src/handlers/gates/bash-external-directory.ts (sketch)
const accessIntent = {
  ...accessFactsFromPath(surface, worstEntry.path),
  ...(namesNothingOnDisk(uncoveredEntries, normalizer)
    ? { delegationLicense: "nothing-on-disk" as const }
    : {}),
};
// private, below the gate:
function namesNothingOnDisk(entries, normalizer): boolean {
  return entries.every(({ path, effect }) =>
    effect.effect !== "write" && normalizer.namesNothingBelowRoot(path));
}
```

`accessFactsFromPath` stays untouched: it has four other callers (the tool, path, external-directory, and bash-path gates) and a parameter would leak a bash-only concept into the tool gate.
`PathNormalizer.namesNothingBelowRoot(accessPath)` sits beside `entryExists` and walks with `this.flavor.impl.dirname` and `lstatSync`, discriminating `ENOENT` from every other error.
It does not share a helper with `entryExists`, which swallows every error by design.

`fallow guard`: no new import edge — the gate already imports `PathNormalizer` (type) and `accessFactsFromPath`, which returns `ForwardedAccessFacts`; the envelope already imports nothing new.

### Edge cases, each with its test step

| Case                                                                               | Behavior                                     | Step    |
| ---------------------------------------------------------------------------------- | -------------------------------------------- | ------- |
| Every uncovered path unrooted, none written (`officecli set data.xlsx /Sheet1/B1`) | licensed                                     | 2, 5    |
| One unrooted, one under an existing directory                                      | not licensed                                 | 2       |
| Unrooted but a redirect destination (`echo x > /pi-permission-882-absent/f`)       | not licensed                                 | 2       |
| Absent leaf under an existing directory (`<tmpdir>/absent/x`)                      | not licensed                                 | 2       |
| An ancestor is a file (`ENOTDIR`)                                                  | not licensed                                 | 2       |
| Literal-only path (unknown base; win32 POSIX-absolute)                             | not licensed                                 | 2       |
| Path that exists                                                                   | not licensed                                 | 2       |
| Tool `external_directory` ask on an unrooted path                                  | never stamped                                | 2 (pin) |
| Licensed ask, link `allow`, surface `external_directory` / `_read` / `_write`      | honored, `authorizer_allow_licensed` written | 5       |
| License present but surface in the `path` family, or undetermined                  | capped                                       | 5       |
| Unlicensed `external_directory` allow                                              | capped, no record                            | 5       |
| `deny` / `defer` on a licensed ask                                                 | unchanged, no record                         | 5       |
| Forwarded licensed ask                                                             | license survives the wire and the projection | 3, 5    |
| Wire value other than `"nothing-on-disk"`                                          | field dropped, intent kept                   | 3       |

## Module-Level Changes

`src/`:

- `src/path/path-normalizer.ts` — add `namesNothingBelowRoot(accessPath: AccessPath): boolean`.
- `src/authority/permission-forwarding.ts` — `ForwardedAccessFacts.delegationLicense?: "nothing-on-disk"` with its doc comment.
- `src/handlers/gates/bash-external-directory.ts` — stamp the license from every uncovered entry; private `namesNothingOnDisk` helper below the gate; update the gate's doc comment.
- `src/authority/forwarding-io.ts` — `asForwardedAccessIntent` admits the field (only the one value).
- `src/authority/forwarded-request-server.ts` — `toAccessFacts` projects the field; correct its comment's "compile error" claim for optional fields.
- `src/authority/delegation-envelope.ts` — `(name, authorize)` signature, the license exception, the `authorizer_allow_licensed` record, reworded header and doc comments.
- `src/authority/authorizer-selection.ts` — pass `name` at the one call site.

Predicted unchanged:

- `src/handlers/gates/helpers.ts` (`accessFactsFromPath`) — the stamp is local to the bash gate.
- `src/handlers/gates/external-directory.ts`, `path.ts`, `tool.ts`, `bash-path.ts` — never stamp.
- `src/authority/approval-escalator.ts` — it already spreads `details.accessIntent` onto the wire.
- `src/authority/authorizer-chain.ts`, `decision-source.ts` — `decidedBy` shape unchanged.
- `src/service.ts` — no new named export; the field is inlined into `dist/public.d.ts` through `PromptPermissionDetails` (no in-repo consumer would import a named `DelegationLicense` type, and fallow would flag one).
- `packages/pi-permission-model-judge/` — unchanged (deny-first).
- `src/config/*`, `schemas/permissions.schema.json`, `config/config.example.json` — no config key.

`test/`:

- `test/path/path-normalizer.test.ts` — new `describe("namesNothingBelowRoot")` beside `describe("entryExists")`.
- `test/handlers/gates/bash-external-directory.test.ts` — the exact-equality assertion at "carries the deciding path's access facts on promptDetails" (`cat /outside/a.ts`; `/outside` is absent at `/`, so it now carries the license) gains the key; new license cases.
- `test/handlers/gates/external-directory.test.ts` — its existing `toEqual` on the tool gate's `accessIntent` stays as is and is the pin that the tool gate never stamps; add one unrooted-path tool case if the existing fixture's `/outside` path does not already make the point explicit (it does: `/outside/project/file.ts`).
- `test/authority/forwarding-io.test.ts` — a `delegationLicense` sub-describe under the existing `accessIntent field` describe.
- `test/authority/forwarded-request-server.test.ts` — projection case; the two `encloseInDelegationEnvelope(allowingLink)` calls take a name.
- `test/authority/delegation-envelope.test.ts` — widen `makeDetails`, then the license cases; every existing call takes a name.
- `test/authority/authorizer-selection.test.ts` — no change predicted (it asserts the chain, not the envelope's arguments); confirm at Step 5.
- `test/composition-root.test.ts` — end-to-end licensed and unlicensed cases.

Docs:

- `docs/decisions/0007-model-judge-authorizer-chain-adr.md` — new `### 8.` section, Status line, `amended:` frontmatter, Consequences bullet, Rejected alternatives for the leaf-absent bound, the proven-read bound, and the per-family switch ([#684], [#983]).
- `docs/configuration.md` — *Authorizer chain* section: the checkpoint paragraph states the exception; the record table gains `authorizer_allow_licensed`; the extension-author paragraph names `accessIntent.delegationLicense`.
- `README.md` — line ~144 ("caps any link's `allow` …") and the *Model judgment in the core* non-goal bullet; migration table row.
- `docs/migration/0882-nothing-on-disk-delegation-license.md` — new; who is affected (a configured link that returns `allow` on bash `external_directory` asks), what changed, what to do (nothing; to keep the old cap, have the link defer on that family, or drop it from `authorizerChain`).
- `docs/architecture/architecture.md` — the `delegation-envelope.ts` module-tree entry (signature, the license exception, the record); the `path-normalizer.ts` entry if it enumerates the probe methods; the *model judge* section paragraph (line ~783, also stale today: "secret-shaped `path` always excluded" — the whole family is); the Phase 15 Step 7 heading and Mermaid node `S882` get `✅` and a `Landed:` note.
  Check its Mermaid blocks for a node modelling the envelope as a pure cap.
- `.pi/skills/package-pi-permission-system/SKILL.md` — names the delegation envelope only by pointer to ADR 0007 and the architecture entries; predicted unchanged, re-grep `envelope`/`delegation` at Step 6.
- `docs/subagent-integration.md` and `docs/cross-extension-api.md` — neither tables `accessIntent` fields today (grep: no hit); predicted unchanged.

## Test Impact Analysis

1. New tests the change enables: `namesNothingBelowRoot` is a pure question over a real filesystem, testable with an absent top-level name and a `createTmpFixture` tree; the license predicate is testable through the gate with real `BashProgram` parses; the envelope's license exception is a pure unit.
2. Redundant tests: none; the change adds a branch rather than moving one.
3. Tests that stay as they are: the existing envelope cap cases (unlicensed details) keep proving the default cap; the tool-gate `accessIntent` `toEqual` becomes the never-stamps pin; the forwarded-envelope composition in `forwarded-request-server.test.ts` keeps its `path`-surface cap.

Fixtures use `/outside/...` widely and that name is absent on every host this runs on, so many existing bash external-directory fixtures will now carry the license silently; only exact-equality assertions on `accessIntent` break, and the tidy-first assessor found one (`bash-external-directory.test.ts`, "carries the deciding path's access facts on promptDetails").
New tests use a distinctive absent name (`/pi-permission-882-absent/...`) so a host that happens to have `/outside` cannot flip them.

## Invariants at risk

| Invariant                                          | Source                   | Pinned by                                                                                                                  |
| -------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| A link's `allow` on the `path` family is capped    | ADR 0007 §5, ADR 0013 §4 | `delegation-envelope.test.ts` cap cases, plus a new licensed-`path` case (Step 5)                                          |
| A directional member cannot escape the envelope    | ADR 0013 §4              | existing `it.each` over `path_read`/`path_write`/`external_directory_read`/`external_directory_write` (unlicensed details) |
| Undetermined surface fails safe                    | ADR 0007 invariant 2     | existing undetermined-surface case, plus a licensed-but-undetermined case (Step 5)                                         |
| A forwarded ask is capped exactly like a local one | [#635]                   | `forwarded-request-server.test.ts` envelope composition (path surface), plus the forwarded licensed case (Step 5)          |
| A link grant is non-persistent                     | ADR 0007 §6              | `authorizer-chain.test.ts` (`state: "approved"`); unchanged                                                                |
| No node re-derives a forwarded fact                | ADR 0008                 | Step 3: the serving side projects the child's value and never probes the filesystem                                        |

The constituency served by the cap — an operator who named an allow-capable link and relies on it never approving outside the tree — loses it for licensed asks only; the migration note tells them, and the review record makes each such approval visible.

## TDD Order

1. **ADR amendment.**
   Write ADR 0007 §8 (the bound, its three conditions, the residual, the fact's home and wire handling, the audit record, the Windows limitation), the Status line, `amended: 2026-10-17` frontmatter, a Consequences bullet, and Rejected alternatives: the leaf-absent bound, the proven-read bound, and the per-family switch in both forms ([#684]'s global flag, [#983]'s per-link map, the latter named as not decided here and parked on [#620] / [#799]).
   Cite the measurement table above as measured, with its date and method.
   Commit: `docs(pi-permission-system): amend ADR 0007 to let a link allow a bash external_directory ask that names nothing on disk`.
2. **Normalizer probe and the gate's license** (`refactor:` — the envelope still caps, so no verdict changes yet).
   - `test/path/path-normalizer.test.ts` `describe("namesNothingBelowRoot")`: true for `/pi-permission-882-absent/x/y`; false for an existing path, for `<tmp>/absent/x` (first existing entry is the temp dir), for a path under an existing *file* (`ENOTDIR`), and for a `forLiteral` path; a `win32PathFlavor` normalizer's POSIX-absolute bash token is false.
   - `test/handlers/gates/bash-external-directory.test.ts`: update the exact-equality assertion to expect `delegationLicense: "nothing-on-disk"`; new cases — `officecli set data.xlsx /pi-permission-882-absent/B1` licensed; a mixed command (`… /pi-permission-882-absent/B1 <tmp>/x`) not licensed; `echo x > /pi-permission-882-absent/f` not licensed; a relative token after `cd "$D"` not licensed (asserting the key's absence with `toStrictEqual` or `not.toHaveProperty`).
   - `test/handlers/gates/external-directory.test.ts`: the existing `toEqual` (`/outside/project/file.ts`) is the never-stamps pin; it passes before and after — an invariant pin, not a red.
   - Implementation: `PathNormalizer.namesNothingBelowRoot`, the `ForwardedAccessFacts` field, the gate's private `namesNothingOnDisk` and the stamp.
   - Killing mutations: make `namesNothingBelowRoot` return `!this.entryExists(accessPath.boundaryValue())` (leaf-only) — kills the `<tmp>/absent/x` and `ENOTDIR` cases; change the walk to continue on any `lstat` error — kills `ENOTDIR`; compute the gate's license over `[worstEntry]` instead of `uncoveredEntries` — kills the mixed case (pick fixtures so the worst entry is the unrooted one); delete `effect.effect !== "write"` — kills the redirect case.
   Commit: `refactor(pi-permission-system): mark a bash external_directory ask whose paths name nothing on disk`.
3. **The license crosses the forwarding wire** (`refactor:`).
   - `test/authority/forwarding-io.test.ts`: a request carrying `delegationLicense: "nothing-on-disk"` reads back with it; `"anything-else"` and `true` read back with the field dropped and the rest of the intent intact.
   - `test/authority/forwarded-request-server.test.ts`: the escalated ask's `details.accessIntent` carries the forwarded license (via `makeForwardedAccessIntent({ delegationLicense: … })`).
   - Killing mutations: drop the field in `asForwardedAccessIntent` — kills the round-trip; admit any string — kills the malformed-value case; drop it from `toAccessFacts` — kills the projection case.
   Commit: `refactor(pi-permission-system): carry the nothing-on-disk license across the forwarding wire`.
4. **Prep: widen the envelope test fixture** (tidy-first, recommended).
   `makeDetails` in `test/authority/delegation-envelope.test.ts` takes an optional `facts?: Partial<ForwardedAccessFacts>` spread over its defaults; every existing call stays green.
   Commit: `test(pi-permission-system): let the delegation-envelope fixture carry extra access facts`.
5. **The checkpoint honors a licensed allow** (`feat!:`).
   - `test/authority/delegation-envelope.test.ts`: licensed `allow` on `external_directory`, `external_directory_read`, `external_directory_write` passes through and writes `authorizer_allow_licensed` with `{ requestId, link, license }` (assert the `log.review` call); licensed `allow` on `path` / `path_write` and on an undetermined surface is capped with no record; unlicensed `external_directory` allow capped with no record; licensed `deny`/`defer` pass unchanged with no record.
     Every existing `encloseInDelegationEnvelope(link)` call gains a name (the signature change is folded here rather than landed separately, since an unused parameter would trip lint).
   - `test/authority/forwarded-request-server.test.ts`: the two envelope calls take a name; add the forwarded composition — a forwarded licensed `external_directory` ask through the envelope over an allowing link yields `allow`.
   - `test/composition-root.test.ts`: with a registered link returning `allow` and named in `authorizerChain`, `officecli set data.xlsx /pi-permission-882-absent/B1` resolves without a prompt (no `ctx.ui` dialog, `approved` entry with `decidedBy.kind: "authorizer"`, an `authorizer_allow_licensed` record); `cat <tmp>/absent/x` (rooted) still prompts.
   - Implementation: `encloseInDelegationEnvelope(name, authorize)`, `licenseFor`, the record, the caller in `authorizer-selection.ts`, the reworded module docs.
   - Killing mutations: replace `licenseFor(details)` with `"nothing-on-disk"` unconditionally — kills the unlicensed-cap case; drop the family check so a license on `path` is honored — kills the licensed-`path` case; read the license when `accessIntent` is absent off the display surface fallback — kills the undetermined case; delete the `log.review` call — kills the record assertions; delete the `name` argument at the `authorizer-selection.ts` call site so the record's `link` is wrong — kills the composition-root `link` assertion.
   Commit: `feat(pi-permission-system)!: let a chain link allow a bash external_directory ask whose paths name nothing on disk`, with footer `BREAKING CHANGE: the bounded-delegation checkpoint no longer caps every link allow on the external_directory family; a link's allow on a bash external_directory ask is honored when every flagged path names nothing on disk below the filesystem root and none is a proven write, and each such approval writes an authorizer_allow_licensed review record.`
6. **Docs.**
   `docs/configuration.md`, `README.md` (two passages plus the migration table row), the new `docs/migration/0882-nothing-on-disk-delegation-license.md`, `docs/architecture/architecture.md` (module entries, the *model judge* paragraph, Step 7 `✅` heading + Mermaid node + `Landed:` note).
   Re-grep `.pi/skills/` and `packages/pi-permission-system/docs/` for `caps any link`, `downgraded to .defer`, `encloseInDelegationEnvelope(authorize)`, and `always excluded`.
   Commit: `docs(pi-permission-system): document the nothing-on-disk delegation license`.

No third-party mechanism is adopted ([#684]'s and [#983]'s flags are declined), so no `Co-authored-by:` trailer applies.

## Risks and Mitigations

- **A wrong judgment on a real path.**
  The bound limits the blast radius to a path whose top-level component does not exist; the review record makes every licensed approval auditable by link.
- **Host-dependent tests.**
  `/outside/...` fixtures now license silently; new tests use `/pi-permission-882-absent/...`, and only exact-equality assertions on `accessIntent` were found to break (one).
- **Existence probing cost on the ask path.**
  The walk runs only for uncovered entries of an ask that is about to prompt anyway: a handful of `lstat` calls per path, against a tree-sitter parse already paid.
- **Version skew.**
  Either side missing the field reads as unlicensed; tested at Step 3.
- **Silent loosening for an operator who did not expect it.**
  Shipped as `feat!:` with a migration note naming exactly who is affected; no shipped first-party link allows on the family, and the known third-party allow-capable link skips it today.

## Open Questions

- Whether `pi-permission-model-judge` should ever adopt the license (an allow verdict for "this token is not a path") is that package's own decision; nothing is filed until someone asks.

[#620]: https://github.com/gotgenes/pi-packages/issues/620
[#635]: https://github.com/gotgenes/pi-packages/issues/635
[#684]: https://github.com/gotgenes/pi-packages/pull/684
[#797]: https://github.com/gotgenes/pi-packages/issues/797
[#799]: https://github.com/gotgenes/pi-packages/issues/799
[#880]: https://github.com/gotgenes/pi-packages/issues/880
[#983]: https://github.com/gotgenes/pi-packages/pull/983
