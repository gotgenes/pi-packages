---
issue: 989
issue_title: "pi-permission-system: approving an external directory for the session also approves sibling directories"
---

# Scope a directory's session approval to that directory

## Release Recommendation

**Release:** ship independently

Issue 989 is not a step in any `docs/architecture/architecture.md` roadmap phase, so it carries no `Release:` batch tag.

## Problem Statement

A third party (`aisensiy`) reports that approving an external directory "for this session" also approves every sibling directory.
With `external_directory: ask`, approving `add_directory` on `<root>/projects/project-a` lets a later `read` of `<root>/projects/project-b/sample.txt` pass unprompted; the session rule that matched it is `<root>/projects/*`.
The reporter also asks that the prompt state the scope it grants, because their dialog offered only the bare `Yes, for this session`.

The over-broad grant is not specific to `add_directory`.
`deriveApprovalPattern` scopes every accessed path to "the value up to its last separator, plus `*`", which is right for a file and one level too wide for a directory.
Measured through the real `PathNormalizer` (a disposable spike over real temp directories, `posixPathFlavor`, cwd `<tmp>/workspace`):

| Tool call                                | `AccessPath.value()`             | Session pattern today        |
| ---------------------------------------- | -------------------------------- | ---------------------------- |
| `ls <tmp>/projects/project-a`            | `<tmp>/projects/project-a`       | `<tmp>/projects/*`           |
| `ls <tmp>/projects/project-a/`           | `<tmp>/projects/project-a`       | `<tmp>/projects/*`           |
| `find ../projects/project-a`             | `<tmp>/projects/project-a`       | `<tmp>/projects/*`           |
| `add_directory <tmp>/projects/project-a` | `<tmp>/projects/project-a`       | `<tmp>/projects/*`           |
| `read <tmp>/projects/project-a/x.txt`    | `<tmp>/projects/project-a/x.txt` | `<tmp>/projects/project-a/*` |

A trailing separator does not help: the normalizer strips it before derivation.
All five path gates share the derivation (`path`, `external_directory`, the per-tool surface, bash-path, bash-external-directory), so a built-in `ls`/`find`/`grep` on an outside directory grants its parent just as the extension tool did.

The label half has a narrower cause.
`LocalUserAuthorizer.buildRequestOptions` names the pattern only when every grant proves one direction (`Yes, allow reads to "…" for this session`).
An extension tool or `edit` proves no direction, so its grant lands on the bare family surface, and with no gate-supplied `sessionLabel` the dialog falls back to its default `Yes, for this session`.

## Goals

- A session approval for a path that names an existing directory covers that directory and its contents, not its siblings: it records `D` and `D<sep>*` instead of `<parent><sep>*`.
- Every path-family session option names what it grants, including asks that prove no direction.
- The dialog names a directory approval as the single target `"D/*"`, not "2 paths".
- Non-breaking (`fix:`): no config key, default, or serialized shape changes.
  The visible change is a narrower grant (a sibling now prompts) and a label that names its scope; the operator confirmed this classification.

## Non-Goals

- Widening a session grant on request (issue [#604], `sessionApprovalScope`): the opposite knob, independent of this fix.
- A path that does not exist at approval time keeps today's parent-directory glob — a directory the tool is about to create cannot be probed.
  This is the pre-fix behavior for that input, not a regression.
- A literal-only `AccessPath` (a relative bash token after a non-literal `cd`; a non-mount POSIX absolute on win32) is never probed: it has no resolvable base, and `statSync` on it would read the process cwd or a fabricated `C:\` path.
  It keeps the parent glob, unchanged.
- The `ApprovalGrant` / `ForwardedSessionApproval` wire shape: a directory approval travels as two ordinary grants, and the display fold is recomputed from them on the serving node.
- Changing wildcard semantics so `D/*` also matches `D` — that would silently widen every configured `…/*` rule.

## Background

- `src/path/approval-pattern.ts` — `deriveApprovalPattern(pathValue, flavor)`, pure; slices at `flavor.lastSeparatorIndex` so the pattern keeps the separator the value carries (#655's Git Bash constraint).
- `src/path/path-normalizer.ts` — `PathNormalizer.approvalPatternFor(accessPath)` is the sole caller of the derivation and the package's single filesystem edge for path interpretation (`entryExists` uses `lstatSync`; `forToolPath` uses `existsSync`).
- Callers of `approvalPatternFor` (verified by grep, five in `src/`): `handlers/gates/path.ts:63`, `external-directory.ts:100`, `bash-external-directory.ts:114`, `bash-path.ts:136`, `tool-call-gate-pipeline.ts:213` (→ `ToolPathAccess.approvalPattern` → `tool.ts`'s `suggestPathSessionPattern`).
  Tests: `test/path/approval-pattern.test.ts`, `test/path/path-normalizer.test.ts`, `test/handlers/gates/tool.test.ts:60` (one helper).
- `src/session/session-approval.ts` — `SessionApproval.single` / `forGrants`; grants are recorded per pattern by `SessionRules`.
- `src/session/approval-grant.ts` — `ApprovalGrant { surface, pattern }`, `provenDirectionOf`.
- `src/presentation/pattern-suggest.ts` — `describeGrantTarget` (one grant → quoted pattern, else `N paths`), `buildDirectionalSessionLabels`, `buildForwardedScopeLabels`, private `buildLabel`.
  Its architecture entry constrains it to hold no path-language semantics, so the directory fold does not belong here.
- `src/authority/local-user-authorizer.ts` — `buildRequestOptions` composes the session label: directional label, else `details.sessionLabel`, else none.
- `src/policy/wildcard-matcher.ts` — `*` compiles to `.*`, anchored, so `D/*` matches `D/x` and `D/` but not `D`, and `D*` would match `D-evil`; no single pattern expresses "D and its contents only".
- The upstream predecessor (`docs/plans/archive/0057-…`) explicitly guarded the sibling case for files; directories were never considered.

## Design Overview

### Derivation

`deriveApprovalPattern` becomes `deriveApprovalPatterns(pathValue, flavor, isDirectory): readonly string[]`:

```typescript
export function deriveApprovalPatterns(
  pathValue: string,
  flavor: PathFlavor,
  isDirectory: boolean,
): readonly string[] {
  if (!isDirectory) return [parentScopePattern(pathValue, flavor)];
  return [pathValue, directoryContentsPattern(pathValue, flavor)];
}
```

- `parentScopePattern` is today's body, unchanged (`.<sep>*` fallback included).
- `directoryContentsPattern`: when the value already ends in a separator (a root, `/` or `C:\`), append `*`; otherwise append the separator the value carries (the character at `flavor.lastSeparatorIndex(pathValue)`, falling back to `flavor.impl.sep`) and `*`.
  So `/r/p/a` → `["/r/p/a", "/r/p/a/*"]`, `C:\r\a` → `["C:\r\a", "C:\r\a\*"]`, `/` → `["/", "/*"]`.
- Both patterns are needed: `D/*` does not match a later `ls D`, and `D*` would match `D-evil`.

### The directory probe

`PathNormalizer.approvalPatternFor` becomes `approvalPatternsFor(accessPath): readonly string[]`, passing `this.namesDirectory(accessPath)`:

```typescript
private namesDirectory(accessPath: AccessPath): boolean {
  if (!accessPath.boundaryValue()) return false; // literal-only: no resolvable base
  try {
    return statSync(accessPath.value()).isDirectory();
  } catch {
    return false;
  }
}
```

- `statSync` (follows symlinks), not `lstat`: a symlink to a directory is what `ls` lists, and the grant's match runs over the lexical ∪ canonical `matchValues`, so either spelling of a later access matches.
- It probes `value()`, the lexical absolute form the patterns are built from (#438).
- Any error answers `false`, which keeps today's parent glob — the fallback is the pre-fix behavior, never a wider one.
- It sits beside `entryExists`, keeping one filesystem edge for path interpretation; no shared `tryFs` wrapper (two probes, different syscalls).

### Callers

`SessionApproval` gains `static forPatterns(surface, patterns)` (one grant per pattern, same surface).
`path.ts`, `external-directory.ts`, and `bash-path.ts` switch `single(surface, pattern)` → `forPatterns(surface, patterns)`; `bash-external-directory.ts` `flatMap`s each entry's patterns into `forGrants`.
`ToolPathAccess.approvalPattern: string` → `approvalPatterns: readonly string[]`; `suggestPathSessionPattern(surface, patterns)` returns `{ surface, patterns, label }` (a new `PathSessionSuggestion`, leaving the value-surface `SessionApprovalSuggestion` untouched), and `describeToolGate` builds `SessionApproval.forPatterns` from it on the path branch.

### Display: one target per directory

`src/session/approval-grant.ts` gains `grantTargets(grants): string[]` — the distinct targets an approval covers.
An exact grant `P` folds into a same-surface sibling whose pattern is `P` followed by one separator (`/` or `\`) and `*`; identical patterns dedupe.
It lives with the grant vocabulary rather than in `pattern-suggest.ts`, whose constraint forbids path semantics; it recognizes only the pair shape `deriveApprovalPatterns` produces, and step 4's end-to-end test pins producer and fold together.
`describeGrantTarget` counts `grantTargets` instead of raw grants: one target → `"<pattern>"`, else `N paths`.
That also fixes a pre-existing miscount: two files in one directory derive one glob twice, which labelled as "2 paths".

### Label for a non-directional ask

`buildRequestOptions` gains a third arm: when no direction is proven, no gate label was supplied, and every grant's surface is a path family (`path` / `external_directory` or a directional member), the label is `Yes, allow access to <describeGrantTarget(grants)> for this session`.
Grants on non-path surfaces (`bash`, `mcp`, `skill`, a bare tool) keep their gate-supplied label or none, so their option sets are unchanged.

Resulting dialogs for the reporter's scenario:

| Ask                                       | Session option today                                                 | Session option after                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `add_directory <root>/projects/project-a` | `Yes, for this session` (grants `<root>/projects/*`)                 | `Yes, allow access to "<root>/projects/project-a/*" for this session` (grants `…/project-a`, `…/project-a/*`) |
| `ls <root>/projects/project-a`            | `Yes, allow reads to "<root>/projects/*" for this session`           | `Yes, allow reads to "<root>/projects/project-a/*" for this session`                                          |
| `read <root>/projects/project-a/x.txt`    | `Yes, allow reads to "<root>/projects/project-a/*" for this session` | unchanged                                                                                                     |

### Breaking classification

Non-breaking `fix:`.
No config key, default value, or serialized shape changes; the forwarded wire still carries `{ surface, pattern }` grants.
On upgrade a directory approval stops covering siblings, so a session that relied on that over-grant prompts again for each sibling — the least-privilege correction the package priorities require.

## Module-Level Changes

- `src/path/approval-pattern.ts` — extract `parentScopePattern` (step 1); replace `deriveApprovalPattern` with `deriveApprovalPatterns(pathValue, flavor, isDirectory)` and add `directoryContentsPattern` (step 4).
- `src/path/path-normalizer.ts` — `approvalPatternFor` → `approvalPatternsFor` (step 3, always `isDirectory: false`); `namesDirectory` probe + `statSync` import (step 4).
- `src/session/session-approval.ts` — `forPatterns` (step 3).
- `src/session/approval-grant.ts` — `grantTargets` (step 2).
- `src/presentation/pattern-suggest.ts` — `describeGrantTarget` over `grantTargets` (step 2); `PathSessionSuggestion` + `suggestPathSessionPattern(surface, patterns)` labelling the folded target (step 3).
- `src/handlers/gates/{path,external-directory,bash-path,bash-external-directory,tool-call-gate-pipeline,tool}.ts` — plural callers (step 3).
- `src/authority/local-user-authorizer.ts` — path-family fallback label arm (step 5).
- Tests: `test/path/approval-pattern.test.ts`, `test/path/path-normalizer.test.ts`, `test/session/approval-grant.test.ts`, `test/session/session-approval.test.ts`, `test/presentation/pattern-suggest.test.ts`, `test/handlers/gates/tool.test.ts` (line 60 helper), `test/handlers/external-directory-session-dedup.test.ts` (+ `test/helpers/external-directory-fixtures.ts` if a real-tmpdir builder is needed), `test/authority/local-user-authorizer.test.ts`.
- Predicted unchanged: `test/authority/forwarded-request-server.test.ts` and `test/handlers/gates/runner.test.ts` (their grants are `bash` or directional, so neither the fold nor the fallback arm reaches them); `test/authority/local-user-authorizer.test.ts`'s "names every path in the scope label" case (mixed directions → the new fallback adds a `sessionLabel`, but it asserts with `objectContaining`, and its two targets stay "2 paths").
  The existing `path-normalizer.test.ts` `approvalPatternFor` cases use non-existent virtual paths (`/other/pkg/x.ts`), so they stay on the parent branch and only change name.
- Docs (step 6): `docs/session-approvals.md` (Suggested Patterns table: directory rows; a paragraph on directory approvals; the generic label line), `docs/architecture/architecture.md` entries for `approval-pattern.ts` (line ~954), `path-normalizer.ts` (~956, `approvalPatternsFor` + the `statSync` probe beside `entryExists`), `session-approval.ts` (~909, `forPatterns`), `approval-grant.ts` (~910, `grantTargets`), `pattern-suggest.ts` (~1039, `describeGrantTarget` counts targets), `local-user-authorizer.ts` (~991, the fallback arm).
  `.pi/skills/package-pi-permission-system/SKILL.md` names `approval-pattern.ts` only by its architecture entry — predicted unchanged; re-grep `approvalPatternFor|deriveApprovalPattern` across `.pi/skills/` and `packages/pi-permission-system/docs/` in step 6.

## Test Impact Analysis

1. New tests the change enables: the pure `deriveApprovalPatterns` directory branch for both flavors on a POSIX host; `namesDirectory` against real temp entries (directory, file, missing, literal-only); `grantTargets` folding; an end-to-end sibling test through the real handler, session, and `SessionRules`.
2. Redundant tests: none — the existing parent-glob cases remain the non-directory branch's pins.
3. Kept as-is: the win32 `lastSeparatorIndex` cases in `approval-pattern.test.ts` (#655) and the `forBashToken("/tmp/logs/")` literal case in `path-normalizer.test.ts` (no probe for a literal, so still `/tmp/logs/*`).

## Invariants at risk

- #655 — the pattern uses the separator the value carries, never ambient `sep`: pinned by `approval-pattern.test.ts`'s win32 cases and `path-normalizer.test.ts:336–350`; the new `directoryContentsPattern` reads the value's own separator, and step 4 adds a win32 directory case.
- #438 — the pattern derives from the lexical `value()`: the probe reads `value()` and the patterns are built from it; pinned by the existing normalizer cases.
- #810 — one grant per pattern on its own surface: `forPatterns` and the bash `flatMap` keep each entry's surface; pinned by `bash-external-directory.test.ts`'s mixed-direction case.
- #813 — the both-directions width folds each grant's surface, never its pattern: `widenGrant` over two directory grants yields two family grants; the dialog label still comes from `grantTargets`.
- Least privilege for the fallback: a probe error or a missing path yields the pre-fix parent glob — never wider than today.

## TDD Order

1. `refactor(pi-permission-system): extract the parent-scope step of the approval-pattern derivation`
   - Prepares step 4 (Tidy-First assessor, Recommended): move `deriveApprovalPattern`'s body into a private `parentScopePattern(pathValue, flavor)`; the exported function delegates.
   - No new tests; `approval-pattern.test.ts` and `path-normalizer.test.ts` stay green unchanged.
2. `fix(pi-permission-system): label two paths that share one session glob by that glob`
   - Add `grantTargets` to `src/session/approval-grant.ts`; `describeGrantTarget` counts its result.
   - Tests (`test/session/approval-grant.test.ts` + `pattern-suggest.test.ts`): identical patterns → one target; `/r/a` + `/r/a/*` on one surface → `["/r/a/*"]`; `C:\r\a` + `C:\r\a\*` → one; `/r/a` on `path_read` + `/r/a/*` on `path_write` → two; `/r/a` + `/r/ab/*` → two; `describeGrantTarget` over the pair → `'"/r/a/*"'`.
   - Killing mutations: make `grantTargets` return `grants.map((g) => g.pattern)` (kills the dedupe and both fold cases); drop the same-surface condition (kills the cross-surface case); accept any suffix after `P` instead of exactly one separator + `*` (kills the `/r/ab/*` case).
3. `refactor(pi-permission-system): carry session-approval patterns as a list`
   - `approvalPatternsFor` (returns a one-element list via `deriveApprovalPatterns(value, flavor, false)`), `SessionApproval.forPatterns`, `ToolPathAccess.approvalPatterns`, `PathSessionSuggestion` / `suggestPathSessionPattern(surface, patterns)` labelling `grantTargets`' single target, and every caller in the five gates and `tool.ts`; update `tool.test.ts:60`, `path-normalizer.test.ts`, and `pattern-suggest.test.ts`'s `suggestPathSessionPattern` cases in this commit (the export rename breaks them at type level).
   - New test: `SessionApproval.forPatterns("path_read", ["a", "b"])` carries two grants on `path_read`.
     Killing mutation: make `forPatterns` return `SessionApproval.single(surface, patterns[0])`.
   - Run `pnpm --filter @gotgenes/pi-permission-system run check` immediately after.
4. `fix(pi-permission-system): scope a directory's session approval to that directory, not its parent`
   - `deriveApprovalPatterns`' directory branch + `directoryContentsPattern`; `namesDirectory` probe wired into `approvalPatternsFor`.
   - Pure tests: `/r/p/a` → `["/r/p/a", "/r/p/a/*"]`; `/` → `["/", "/*"]`; win32 `C:\r\a` → `["C:\r\a", "C:\r\a\*"]`; `isDirectory: false` unchanged.
   - Normalizer tests over a `mkdtempSync` tree: an existing directory → the pair; an existing file → parent glob; a missing path → parent glob; `forLiteral(<existing absolute dir>)` → parent glob.
   - End-to-end in `external-directory-session-dedup.test.ts`, real temp dirs (`<tmp>/projects/{project-a,project-b/sample.txt}`), approving prompter: (a) `ls project-a` approved for session, then `read project-b/sample.txt` escalates again; (b) the same with the extension tool `add_directory` (`{ path }`); (c) after approving `ls project-a`, `read project-a/x.txt` and a second `ls project-a` do not escalate; (d) bash `ls <project-a>` then bash `cat <project-b>/sample.txt` escalates again.
     Assert the recorded grant through the label too: the escalation's `sessionApproval` grants fold (via `describeGrantTarget`) to `'"<project-a>/*"'` — the producer/fold pin.
   - Killing mutations: make `approvalPatternsFor` pass `false` unconditionally (kills the pair cases and (a), (b), (d)); return only `[directoryContentsPattern(...)]` from the directory branch (kills the pure pair case and (c)'s second `ls`); delete the `boundaryValue()` guard in `namesDirectory` (kills the `forLiteral` case).
5. `fix(pi-permission-system): name the session-approval scope in a path ask that proves no direction`
   - `buildRequestOptions` fallback arm for path-family grants.
   - Tests (`local-user-authorizer.test.ts`): a bare `external_directory` directory pair with no `sessionLabel` → `{ sessionLabel: 'Yes, allow access to "/r/a/*" for this session' }`; a bare `path` grant → its label; a gate-supplied `sessionLabel` still wins over the fallback; a `bash` grant with no label → options `undefined`.
   - Killing mutations: delete the fallback arm (kills the first two); drop the path-family condition (kills the `bash` case); put the fallback ahead of `details.sessionLabel` (kills the gate-label case).
   - Commit trailer (the reporter asked for the explicit scope): `Co-authored-by: aisensiy <661860+aisensiy@users.noreply.github.com>`
6. `docs(pi-permission-system): document directory-scoped session approvals`
   - `docs/session-approvals.md` and the architecture entries listed above; re-grep the old symbol names.

## Risks and Mitigations

- **Producer/fold drift.**
  `grantTargets` recognizes the pair shape `deriveApprovalPatterns` emits; if one changes alone, the label reverts to "2 paths" silently.
  Step 4's end-to-end assertion runs both on real output.
- **Hot-path `statSync`.**
  `approvalPatternsFor` runs for every path-bearing tool call that reaches the per-tool gate, not just asks — one extra syscall beside the `realpathSync` walk `canonicalizePath` already does per path.
  Accepted; estimated negligible, not measured.
- **Directory created after approval / missing at approval.**
  Falls back to the parent glob (today's behavior); recorded as a Non-Goal.
- **Symlinked directory.**
  `statSync` follows it, and the grant's lexical patterns match through `matchValues`' lexical ∪ canonical set; a later access through the canonical spelling is not covered by the lexical pattern alone — the same limitation the file case has today.
- **Label vocabulary.**
  The fallback reads `Yes, allow access to "…" for this session`, parallel to the directional `Yes, allow reads to "…"`; `docs/session-approvals.md` is updated in step 6.

## Open Questions

- None blocking.
  Whether a not-yet-existing directory should get a narrower grant is left until a tool that creates directories is reported.

[#604]: https://github.com/gotgenes/pi-packages/issues/604
