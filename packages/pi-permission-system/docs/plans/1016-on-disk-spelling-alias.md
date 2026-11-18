---
issue: 1016
issue_title: "pi-permission-system: a path deny misses a case- or Unicode-normalization variant the filesystem opens as the same file"
---

# Match a path's on-disk spelling on POSIX

## Release Recommendation

**Release:** ship independently

Issue #1016 is not a step in any improvement roadmap (`docs/architecture/architecture.md` has no step citing it; [#997]'s planning dispositioned it out of scope for Phase 15), so it ships on its own as a patch.

## Problem Statement

On a case-insensitive, normalization-insensitive filesystem (APFS, the macOS default), the OS opens one file under spellings the path gates treat as different strings.
A `path` deny keyed on the on-disk spelling `Upper.txt` misses a call that types `upper.txt`, and a deny keyed on an NFD-stored `café.txt` misses the NFC spelling, so the tool reads the denied file.
This reaches every path surface, bash tokens included, because the alias set `AccessPath.matchValues()` adds only the `realpathSync` canonical form, and Node's JS `realpathSync` preserves the typed case and normalization.

## Goals

- On a POSIX host, the canonical alias (`AccessPath.matchValues()`'s canonical member and `boundaryValue()`) is the spelling the filesystem stores, so a rule keyed on the on-disk spelling matches every case or Unicode-normalization variant the filesystem opens as that file, on every path surface (`path`, `external_directory`, per-tool, bash tokens, the service query).
- The `external_directory` boundary decision reads that on-disk spelling too, so a case-variant spelling of a path inside the cwd is judged inside.
- The win32 path is unchanged.
- Docs say what the canonical alias now covers and that a rule should be keyed on the on-disk spelling.
- Non-breaking: a decision changes only where the gate and the filesystem named different spellings of one file.
  It changes in both directions: a deny on the on-disk spelling now fires for a variant, and an allow on it now applies to the variant.
  Commit type `fix(pi-permission-system)`.

## Non-Goals

- **A rule written in a spelling that is not on disk.**
  Measured residual (see Background): a rule on `upper.txt` for an on-disk `Upper.txt` typed as `UPPER.TXT`, and a rule in NFC for an NFD-stored name typed in NFD, both still allow.
  Closing them needs NFC/NFD match aliases or case-fold matching on macOS; the operator chose to document the residual instead, since each option over-matches an allow on a filesystem where the two spellings are distinct files (Linux for NFC/NFD, case-sensitive APFS for case).
  Not filed as a follow-up.
- **win32.**
  `realpathSync.native` there also expands 8.3 short names and resolves `subst` and mapped drives (to UNC paths); none of it is measurable here (no win32 host, CI is `ubuntu-latest` only), and the case class this issue reports is already closed on win32 by `flavor.fold` and the case-insensitive match options.
  win32 keeps the JS `realpathSync`.
- **Casefolded Linux directories** (ext4 `casefold`).
  glibc's `realpath(3)` does not report a stored spelling, so `realpathSync.native` on Linux behaves like the JS call for an existing path; the mechanism does not reach them, and no filed report does either.
- **Session-approval patterns.**
  They derive from `AccessPath.value()` (the lexical form), which this change does not touch.

## Background

### Mechanism today

- `canonicalizePath(absolutePath, flavor)` (`src/path/canonicalize-path.ts`) walks from the full path toward the root, calling `realpathSync` on each prefix and re-appending the non-existent tail to the first one that resolves; a non-`ENOENT`/`ENOTDIR` error returns the input unchanged.
  It is the only `realpathSync` caller in `src/`, and it has two callers: `AccessPath.forNativeTarget` (`src/access-intent/access-path.ts`) and `canonicalNormalizePathForComparison` (`src/access-intent/path-normalization.ts`), which `AccessPath.forPath` and `PathNormalizer`'s baked `canonicalCwd` use.
  Both only read the returned string.
- The canonical form is consumed as a match alias (`matchValues()`), as the outside-cwd boundary (`PathNormalizer.isBoundaryOutsideWorkingDirectory`, against a `canonicalCwd` computed through the same function), for infrastructure-read containment (`isPiInfrastructureRead`, against lexical infra dirs), for `namesNothingBelowRoot`, as the bash resolver's dedup key, and in `resolvedAlias()` (the prompt's "resolves to" line).
- `PathFlavor` (`src/path/path-flavor.ts`) holds the package's only `=== "win32"` comparison; `PlatformPathFlavor` is its only implementer, and no test fake implements or casts to it.

### Measurement (design input)

The measurement used the real code path.
A disposable Vitest spike (deleted, not committed) built a real `PermissionManager` (`createManager`) + `PermissionResolver`, a `PathNormalizer` for the host flavor, and real files in a macOS (APFS) tmpdir.
It then drove `describePathGate` (tool `read`), `describeBashPathGate` (`cat <path>` parsed by the real `BashProgram`), and `describeExternalDirectoryGate`.
Each row ran twice: once on `main`, and once with `canonicalizePath` calling `realpathSync.native`.
The code is deterministic and no cache is involved, so n = 1 per row.
The control row (rule and typed spelling both on-disk) denies in both runs, which rules out a rule that fails to load or match.
Rule per row: `path: { "*": "allow", "<rule spelling>": "deny" }`.

| Rule spelling          | Typed spelling          | `main` (tool / bash) | native (tool / bash) |
| ---------------------- | ----------------------- | -------------------- | -------------------- |
| on-disk `Upper.txt`    | `upper.txt`             | allow / allow        | deny / deny          |
| on-disk `Upper.txt`    | `UPPER.TXT`             | allow / allow        | deny / deny          |
| on-disk `Upper.txt`    | `Upper.txt` (control)   | deny / deny          | deny / deny          |
| on-disk NFD `café.txt` | NFC `café.txt`          | allow / allow        | deny / deny          |
| on-disk NFD (control)  | NFD                     | deny / deny          | deny / deny          |
| `upper.txt` (not disk) | `UPPER.TXT`             | allow / allow        | allow / allow        |
| `upper.txt` (not disk) | `Upper.txt` (on disk)   | allow / allow        | allow / allow        |
| NFC (not disk)         | NFD (on disk)           | allow / allow        | allow / allow        |

Further measured rows, same spike:

| Scenario                                                                       | `main` | native               |
| ------------------------------------------------------------------------------ | ------ | -------------------- |
| `external_directory: { "*": "ask", "<out>/Upper.txt": "allow" }`, typed lower  | ask    | allow                |
| `external_directory: { "*": "allow", "<out>/Upper.txt": "deny" }`, typed lower | allow  | deny                 |
| `external_directory: { "*": "ask" }`, in-cwd file with a case-variant ancestor | ask    | no gate (`null`)     |
| `resolvedAlias()` for a typed `upper.txt`                                      | none   | the `Upper.txt` path |

A direct Node probe on the same host (`node -e`, n = 1) compared the two calls.

| Input                                         | JS `realpathSync`               | `realpathSync.native`           |
| --------------------------------------------- | ------------------------------- | ------------------------------- |
| `/tmp/rp1016/upper.txt` (`Upper.txt` on disk) | `/private/tmp/rp1016/upper.txt` | `/private/tmp/rp1016/Upper.txt` |
| NFC name of an NFD file                       | 28 code units (typed NFC)       | 29 code units (stored NFD)      |
| `/tmp/rp1016/mixeddir/sub` (`MixedDir`)       | `…/mixeddir/sub`                | `…/MixedDir/sub`                |
| `/tmp/rp1016/link.txt` (symlink)              | `/private/tmp/rp1016/Upper.txt` | same                            |
| `/tmp`, `/var/folders`, `/etc/hosts`          | `/private/…`                    | same                            |
| `/dev/null`                                   | `/dev/null`                     | same                            |
| `/dev/stdin`                                  | `/dev/fd/0`                     | same                            |

Other measurements, same host:

- 20 000 calls on an existing path took 287 ms with JS and 249 ms with native (n = 1), so the cost is not a regression.
- `process.cwd()` returned the on-disk spelling (`/Users/chris/development/pi`) even when the shell's `PWD` held a case variant (`/users/chris/development/pi`).
  Pi's cwd therefore already arrives in the on-disk spelling, and the native canonical cannot newly diverge from it.
- With `canonicalizePath` swapped to the direct `realpathSync.native` call, the full suite failed 27 tests in 10 files.
  Nine are files whose `node:fs` mock replaces `realpathSync` with a bare `vi.fn`, plus `canonicalize-path.test.ts` itself (see TDD step 1).
- With a `?? realpathSync` fallback that kept those mocks in control, the full suite stayed green (184 files, 6443 tests).
  That run is evidence the real-filesystem tests (`external-directory-symlink-acceptance`, `native-tool-target-acceptance`, the program tests' real-tmpdir cases) tolerate the native call on macOS.

## Design Overview

### Decision model

`canonicalizePath` keeps its walk and error handling.
Only the per-prefix resolver changes, and that choice is platform semantics, so it lives on the flavor:

```typescript
interface PathFlavor {
  // …existing members…
  /**
   * Resolve symlinks in an existing absolute path, returning the spelling the
   * filesystem stores where the platform reports one (POSIX: the native
   * `realpath(3)`, which on macOS yields the on-disk case and Unicode
   * normalization). Throws like `fs.realpathSync`.
   */
  realpath(absolutePath: string): string;
}

class PlatformPathFlavor implements PathFlavor {
  realpath(absolutePath: string): string {
    return this.windows
      ? realpathSync(absolutePath)
      : realpathSync.native(absolutePath);
  }
}
```

`canonicalizePath` calls `flavor.realpath(candidate)` and drops its own `node:fs` import.
Placing the choice on the flavor keeps `path-flavor.ts` the only home of the win32 decision (its architecture-doc constraint) and passes the product, not a discriminator.
The flavor then touches the filesystem for the first time; `fileUrlToPath` already makes it more than pure syntax, and `path-normalizer.ts` and `node-modules-discovery.ts` already import `node:fs` in the same fallow zone (`pi-permission-system/path`), so no boundary is crossed.

### What changes, per consumer

All of these follow from the canonical string alone; none needs a code change:

- `matchValues()` gains the on-disk spelling when it differs from the typed one, which is the fix.
- `boundaryValue()` and `canonicalCwd` are both computed through `canonicalizePath`, so the outside-cwd comparison sees the on-disk spelling on both sides.
  A case-variant spelling of an in-cwd path is now judged inside (measured above).
- `isPiInfrastructureRead` compares the canonical path against lexical infra dirs (`homedir`-derived, `getAgentDir()`, `join(cwd, ".pi", …)`).
  Those are the on-disk spelling in practice (cwd measured above), and a mismatch would fail toward the gate (an ask), not toward an allow.
- `resolvedAlias()` now discloses the on-disk spelling for a typed variant, so the prompt says "resolves to …/Upper.txt".
- The bash resolver's dedup key (`canonical || value`) now collapses `cat Upper.txt upper.txt` into one external entry.

### Edge cases (each pinned in a TDD step)

- **Non-existent tail.**
  Native resolves the deepest existing ancestor to its stored spelling, and the tail is re-appended as typed, which is the existing walk.
  Step 2's `canonicalize-path.test.ts` keeps its walk tests on the native mock.
- **Non-`ENOENT` error from native** returns the input unchanged, as today.
  Step 2 moves the `EACCES`/`ELOOP` tests onto the native mock.
- **win32** still calls the JS `realpathSync`.
  Step 2 keeps the win32 tests on the JS mock and asserts the native mock is never called.
- **The residual** (a rule in a non-disk spelling) still allows.
  Step 2's acceptance test pins it as documented behavior.

## Module-Level Changes

### Source

- `src/path/path-flavor.ts`: add `realpath(absolutePath)` to `PathFlavor` and `PlatformPathFlavor`, plus the `node:fs` import.
- `src/path/canonicalize-path.ts`: call `flavor.realpath(candidate)`; drop the `node:fs` import; rewrite the doc comment, since it now yields the stored spelling, not only symlink resolution.
- `src/access-intent/path-normalization.ts`: fix the stale `realpathSync` wording in the `canonicalNormalizePathForComparison` doc comment (line ~114) and the module comment (line ~8).
- `src/access-intent/access-path.ts`: fix the "symlink-resolved" wording in `matchValues`/`boundaryValue`/`forPath` doc comments where it now under-describes the canonical form.

### Tests

- 11 test files whose `node:fs` mock replaces `realpathSync` gain `native` as the same `vi.fn` (step 1):
  - `test/access-intent/{access-path,path-normalization,input-normalizer}.test.ts`
  - `test/access-intent/bash/{program,program-external-accesses,program-declared-effects}.test.ts`
  - `test/path/{path-normalizer,path-containment}.test.ts`
  - `test/service/permissions-service.test.ts`
  - `test/handlers/gates/{tool-call-gate-pipeline,path}.test.ts`
- `test/path/canonicalize-path.test.ts`: `native` is a separate `vi.fn`; the posix tests move onto it, and the win32 tests stay on the JS mock (step 2).
- New `test/handlers/filesystem-alias-acceptance.test.ts`: real files, real manager and resolver, gated on a filesystem probe (step 2).

### Docs (step 3)

- `README.md`: line 20 (feature bullet), line 78 (`path` pattern matching), line 83 (per-tool).
- `docs/configuration.md`:
  - lines 441 and 774 (canonical-form sentences);
  - the `#### Symlinked paths` section (line 921): add the on-disk spelling, with an APFS example, and the "key rules on the on-disk spelling" guidance plus the residual;
  - the Windows paragraph (line 961): its "POSIX matching remains case-sensitive" sentence stays true and gains a pointer to the on-disk alias.
- `docs/cross-extension-api.md` line 127 (service query parity sentence).
- `docs/glossary.md` line 65 (`path` family entry).
- `docs/architecture/architecture.md`:
  - line 963, the `path-flavor.ts` entry: add `realpath` to the member list;
  - line 965, the `canonicalize-path.ts` entry: it now resolves via `flavor.realpath`, with the stored spelling on POSIX.

### Predicted unchanged

- `test/path/path-flavor.test.ts` stays unchanged: it has no `node:fs` mock and imports Pi's `dist/utils/paths.js` as a parity oracle, so the discrimination test goes in `canonicalize-path.test.ts` instead.
- `test/handlers/external-directory-symlink-acceptance.test.ts` and `test/handlers/native-tool-target-acceptance.test.ts` stay unchanged: they run against the real filesystem and stayed green with the native call (measured above).
- `.pi/skills/package-pi-permission-system/SKILL.md` stays unchanged: it names neither `canonicalizePath` nor `realpathSync`.
  Its upstream-assumptions table covers Pi, not Node.

## Test Impact Analysis

1. New tests enabled:
   - posix→native versus win32→JS discrimination at `canonicalizePath`;
   - an end-to-end acceptance file that runs on a case- and normalization-insensitive filesystem (macOS) and skips elsewhere.
2. Redundant tests: none.
   The mocked `canonicalize-path` walk tests remain the CI-visible coverage of the walk, since CI is Linux.
3. Kept as-is: every symlink-resolution test in the 11 mocked files.
   After step 1 they exercise the same `vi.fn` through `.native`, so they keep pinning the walk and the lexical ∪ canonical union on CI.

The acceptance file's probe is its testable surface.
It writes `Probe.txt` and checks `existsSync` of `probe.txt`, and it writes an NFD name and checks `existsSync` of the NFC spelling.
Measured on this host's tmpdir, both are true.
On `ubuntu-latest` (ext4) both are expected false (estimated), so CI skips the file; the mocked `canonicalize-path` tests carry the CI signal.

## Invariants at risk

- **[#418]: lexical ∪ canonical.**
  An `external_directory` allow on `/tmp/*` matches a typed `/tmp/x`, and one on `/private/tmp/*` matches too.
  Pinned on the real filesystem by `test/handlers/external-directory-symlink-acceptance.test.ts` (no `realpathSync` mock), and in mocked form by `test/access-intent/access-path.test.ts`.
  The probe measured `/tmp` resolving to `/private/tmp` identically under both calls, so the measured value does not move.
  Constituency: macOS users with `/tmp` rules.
- **[#382]: win32 boundary lowercased.**
  `flavor.fold` still wraps `canonicalizePath`'s output in both callers, and win32 still calls the JS `realpathSync`.
  Pinned by the win32 cases in `test/access-intent/access-path.test.ts` (JS mock) and step 2's win32 tests in `canonicalize-path.test.ts`.
  Constituency: Windows users.
- **[#393]: literal-only paths carry no canonical alias.**
  `forLiteral` never calls `canonicalizePath`, so this is untouched; it is pinned by the `forLiteral` tests in `access-path.test.ts`.
- **Fail-open on a resolver error.**
  `EACCES`/`ELOOP` return the lexical form.
  Step 2 pins this on the native mock.

## TDD Order

1. **`test(pi-permission-system): give the node:fs realpathSync mocks a native twin`**
   - In each of the 11 files listed under Module-Level Changes, build the hoisted mock as `const fn = vi.fn<(path: string) => string>(); return Object.assign(fn, { native: fn });` (keeping each file's existing default implementation, if any).
   - Because `native` is the same spy, existing `mockReset`/`mockImplementation`/`toHaveBeenCalled` code is unchanged, and the `vi.mock` factories are untouched.
   - Nothing in `src/` reads `.native` yet, so the tree stays green.
   - This prepares step 2: without it, 9 of these files go red the moment POSIX calls `.native` (measured: 27 failures in 10 files, the tenth being `canonicalize-path.test.ts`, which step 2 handles).
     - The 3 full-replace mocks throw a `TypeError` that `canonicalizePath`'s catch turns into the input.
     - The 8 `importActual`-spread mocks silently bypass the spy for the real native call.
   - `path-containment.test.ts` and `program-declared-effects.test.ts` did not fail in that run.
     Alias them anyway, so the "no filesystem access" assertions keep observing the one spy.
   - Verify: `pnpm --filter @gotgenes/pi-permission-system exec vitest run && pnpm --filter @gotgenes/pi-permission-system run check`.
   - Killing mutation: none (test-only refactor; behavior-preserving by construction).
2. **`fix(pi-permission-system): a path rule matches the on-disk spelling of a case or Unicode variant macOS opens as the same file`**
   - Red, in `test/path/canonicalize-path.test.ts`:
     - make `native` a separate `vi.fn`;
     - move the posix tests (existing path, non-existent leaf, multi-level walk, all-`ENOENT`, `ELOOP`, `EACCES`, `ENOTDIR`) onto the native mock;
     - add "posix resolves through `realpathSync.native`" (the native mock returns `/real/Upper.txt` for `/real/upper.txt` and the result is the stored spelling);
     - keep the two win32 tests on the JS mock and assert the native mock was not called.
   - Red, in the new `test/handlers/filesystem-alias-acceptance.test.ts`, modeled on `native-tool-target-acceptance.test.ts`:
     - **Probe:** `describe.runIf(caseInsensitive && normalizationInsensitive)`.
     - **Case.**
       A deny on on-disk `Upper.txt` fires for `upper.txt` and `UPPER.TXT` through:
       - `describePathGate`;
       - `describeBashPathGate` (`cat <path>`);
       - `ToolCallGatePipeline` with a `read` rule;
       - `describeExternalDirectoryGate`, with a deny on an outside `Upper.txt`.
     - **Unicode.**
       The same deny fires for the NFC spelling of an NFD-stored name through `describePathGate` and `describeBashPathGate`.
     - **Allow.**
       An `external_directory` allow on the on-disk spelling of an outside file applies to its lowercase spelling.
     - **Boundary.**
       A case-variant ancestor spelling of an in-cwd file raises no `external_directory` gate under `{ "*": "ask" }`.
     - **Disclosure.** `describePathGate`'s ask for a typed `upper.txt` carries `{ label: "resolves to", text: "<cwd>/Upper.txt" }`.
     - **Residual (characterization).**
       A deny on `upper.txt` (not on disk) still allows `UPPER.TXT`, and a deny on the NFC spelling still allows the NFD-stored spelling.
       These pass before and after by design, as the documented limitation.
   - Green:
     - add `PathFlavor.realpath` / `PlatformPathFlavor.realpath`;
     - switch `canonicalizePath` to `flavor.realpath`;
     - update the stale doc comments in `canonicalize-path.ts`, `path-normalization.ts`, and `access-path.ts`.
   - Killing mutations:
     - make `PlatformPathFlavor.realpath` call `realpathSync(absolutePath)` unconditionally.
       This kills the posix native tests in `canonicalize-path.test.ts` and every non-residual acceptance test on macOS.
     - Make it call `realpathSync.native` unconditionally.
       This kills the win32 "native not called" assertions.
     - Revert `canonicalizePath`'s line to `realpathSync(candidate)`.
       This kills the posix native tests; it pins the call site the step moves.
   - Verify: the full package suite plus `check`; then `pnpm fallow dead-code` (one new interface member, one consumer).
3. **`docs(pi-permission-system): say a path rule also matches the on-disk spelling`**
   - Update the README, `docs/configuration.md`, `docs/cross-extension-api.md`, `docs/glossary.md`, and the two `docs/architecture/architecture.md` module-tree entries listed under Module-Level Changes.
   - The Symlinked paths section gains:
     - an APFS example (a deny on `~/notes/Secret.md` also catches `secret.md`);
     - the guidance to key a path rule on the spelling `ls` shows;
     - the residual, in one sentence: a rule in another spelling matches only that spelling, typed exactly.
   - Verify: `pnpm exec rumdl check` on each edited file.

## Risks and Mitigations

- **A Linux or CI difference in `realpathSync.native` for existing paths.**
  For an existing path, glibc `realpath(3)` resolves the same symlinks as the JS walk.
  The CI suite exercises real-filesystem symlink tests on `ubuntu-latest` at step 2's push.
  The 11 mocked files keep the walk's logic covered there regardless.
- **Infra-read auto-allow misses when an infra dir's lexical spelling differs from the on-disk spelling.**
  The outcome fails toward an ask, not an allow.
  The cwd was measured to arrive on-disk, and `homedir()` comes from `HOME`, which the OS sets on-disk.
  No mitigation beyond noting it here.
- **A loosening a user did not expect.**
  An allow on the on-disk spelling now covers variants, and an in-cwd case variant no longer asks `external_directory`.
  Both name the same file the rule or cwd names, so this is the correction, not a regression.
  The changelog subject says so.
- **The acceptance file skips on CI, so its regression signal exists only on macOS developer runs.**
  Mitigated by the mocked `canonicalize-path.test.ts` discrimination tests, which run everywhere.

## Open Questions

- Should win32 adopt `realpathSync.native` to close the 8.3 short-name spelling (`C:\PROGRA~1\…`)?
  It is unmeasured here, and its `subst`/mapped-drive effects too; revisit only with a win32 host and a report.
  Not filed.

[#382]: https://github.com/gotgenes/pi-packages/issues/382
[#393]: https://github.com/gotgenes/pi-packages/issues/393
[#418]: https://github.com/gotgenes/pi-packages/issues/418
[#997]: https://github.com/gotgenes/pi-packages/issues/997
