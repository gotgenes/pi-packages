---
issue: 997
issue_title: "pi-permission-system: path policy and native read can disagree on the effective file target"
---

# Gate the file Pi's built-in tool actually opens

## Release Recommendation

**Release:** ship independently

Issue #997 is not a step in the Phase 15 roadmap; it is a third-party deny-bypass report ranked 2 in the 2026-10-02 triage, so it ships on its own as a patch.

## Problem Statement

A configured `path` deny can be evaded through a built-in file tool.
Pi's `read`/`write`/`edit`/`ls`/`find`/`grep` resolve the model's `path` argument through their own resolver before touching the disk, while the gates build the `AccessPath` from the spelling the model typed.
When Pi's resolver rewrites the spelling, the gate checks one file and the tool opens another.
The reporter configured an explicit deny on a fixture file, saw it fire on the canonical spelling, and saw `read` return the same file under an equivalent spelling.
They ask that a deny on the effective target apply to every spelling the native tool resolves to it, and that the approval scope and displayed target agree with the file accessed.

## Goals

- For the six built-in path-bearing tools, every path gate (`path`, `external_directory`, and the per-tool surface) matches rules against the target Pi's tool opens, computed by mirroring Pi's own resolution.
- The session-approval pattern derives from that target, so approval scope and accessed file agree.
- A path ask whose typed spelling was rewritten discloses the target it resolves to ("resolves to" evidence), in the `path` and `external_directory` prompts.
- The `external_directory` boundary decision reads the target too, so a `file://` spelling of an outside file is no longer judged inside the cwd.
- The `Symbol.for()` service query on a built-in tool surface answers at parity with the gate.
- A parity test pins the mirror to Pi's real functions in the pinned dependency, so an upstream change to the resolver turns the suite red on the next dependency bump.
- Non-breaking: the decision changes only for a spelling where the gate and the tool named different files.
  Commit type `fix(pi-permission-system)`.

## Non-Goals

- Filesystem-level aliases: a case or Unicode-normalization variant that APFS/NTFS opens as the same file (`upper.txt` for `Upper.txt`, NFC for an NFD name).
  Measured as a bypass on every surface including bash, but the mechanism is the filesystem, not Pi; filed as [#1016] (disposition: out of scope for Phase 15).
- Extension and MCP tools.
  Their resolution is theirs; they keep `normalizer.forPath(raw)`.
  A tool registered under a built-in name (overriding `read`) is assumed to resolve like the built-in, the same assumption the upstream-assumptions table already records for built-in names and argument shapes.
- Bash tokens.
  Pi does not resolve a bash token; the shell does, and the bash projection keeps `forBashToken`/`forPath` unchanged.
- A "resolves to" disclosure in the per-tool ask payload (`buildToolAskPayload`); see Open Questions.
- Calling Pi's resolver at runtime.
  `@earendil-works/pi-coding-agent`'s `exports` map publishes only `.`, and `path-utils.ts`'s functions are not re-exported from it (verified against the 1.0.0 `package.json` and `dist/index.d.ts`).

## Background

### Pi's resolution (verified in `../pi` main and the pinned 1.0.0 `dist/`, identical)

`packages/coding-agent/src/core/tools/path-utils.ts` and `src/utils/paths.ts`:

- `resolveToCwd(path, cwd)` (all six tools) = `resolvePath(path, cwd, { normalizeUnicodeSpaces: true, stripAtPrefix: true })`, which applies, in order:
  1. `[\u00A0\u2000-\u200A\u202F\u205F\u3000]` → space;
  2. strip one leading `@`;
  3. on win32, `normalizeWindowsShellPath` (`/c/x`, `/mnt/c/x`, `/cygdrive/c/x` → `C:\x`; skipped for `//…` or a path containing `\`);
  4. `~` / `~/` (and `~\` on win32) → `homedir()`;
  5. `file://…` → `fileURLToPath`;
  6. `isAbsolute ? resolve(p) : resolve(cwd, p)`.

  It does **not** trim, strip quotes, or expand `$HOME`.

- `resolveReadPath(path, cwd)` (`read` only, async twin `resolveReadPathAsync` is what `read.ts:103` calls) returns `resolveToCwd`'s result when it exists (`access F_OK`), else the first existing of: AM/PM variant (` AM.`/` PM.` → `\u202FAM.`), NFD variant, curly-quote variant (`'` → `\u2019`), NFD + curly; else the unmodified result.

### Ours

- `normalizePathPolicyLiteral` (`src/access-intent/path-normalization.ts`) trims, strips one wrapping quote pair, strips `@`, and expands `~`/`$HOME`/`${HOME}`; `getPathPolicyValues` and `AccessPath.forPath` build `[lexical absolute, cwd-relative alias, cleaned literal] ∪ canonical (realpath)`.
- `PathNormalizer.forPath(raw)` (`src/path/path-normalizer.ts`) is called with the raw tool path at four tool-path sites: `handlers/gates/path.ts:45`, `handlers/gates/external-directory.ts:46`, `handlers/gates/tool-call-gate-pipeline.ts:208`, and `access-intent/input-normalizer.ts:42` (service queries).
- `describeExternalDirectoryGate` decides "outside cwd" from the **raw string** (`normalizer.isOutsideWorkingDirectory(externalDirectoryPath)`, line 39), before building the `AccessPath`; that is the method's only `src/` caller.
- `PathFlavor` (`src/path/path-flavor.ts`) holds the package's only `=== "win32"` comparison, and a lint guard bans `process.platform` in `src/` outside `index.ts`; any win32 branch of the mirror must live on the flavor.
- `PathNormalizer` is the package's single filesystem edge for path interpretation (canonicalization, `entryExists`).

### Reproduction (design input)

Produced through the real code path: a disposable Vitest spike (deleted, not committed) built a real `PermissionManager` (`createManager`) + `PermissionResolver` + `describePathGate` over a `PathNormalizer` for the host flavor, wrote real files under a macOS (APFS) tmpdir, and called Pi 1.0.0's real `resolveReadPath`/`resolveToCwd` imported from the pinned `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/path-utils.js`.
Rule per row: `path: { "*": "allow", "<on-disk file>": "deny" }`, tool `read`.
Deterministic code, n = 1 per row; no cache involved.
The control (canonical spelling) denies, which rules out a rule that fails to load or match at all.

| Typed spelling                           | Gate  | Pi opens the denied file                                         |
| ---------------------------------------- | ----- | ---------------------------------------------------------------- |
| canonical absolute (control)             | deny  | yes                                                              |
| `file:///…/secret.txt`                   | allow | yes (`resolveToCwd` too)                                         |
| `file:///…/s%65cret.txt`                 | allow | yes (`resolveToCwd` too)                                         |
| NBSP for a space                         | allow | yes (`resolveToCwd` too)                                         |
| `'` for an on-disk `’`                   | allow | yes (`read` only)                                                |
| space + `PM.` for an on-disk `\u202FPM.` | allow | yes (`read` only)                                                |
| NFC for an on-disk NFD name              | allow | APFS opens it directly (Pi's NFD fallback never fires) → [#1016] |
| lowercase for an on-disk capital         | allow | APFS opens it directly → [#1016]                                 |
| `dir/./x/../secret.txt`                  | deny  | yes                                                              |

The win32 drive-mount row (`/c/…`) was read from source, not executed; the parity test in step 3 runs Pi's exported pure `normalizeWindowsShellPath` against ours.
The reporter's own inputs were withheld; these rows are this session's, built from Pi's resolver source.

## Design Overview

### Decision model

For a built-in path-bearing tool, the gates evaluate the **native target**: the absolute path Pi's tool will open.
The target replaces the typed spelling as the `AccessPath`'s lexical form, so `matchValues()`, `boundaryValue()`, `value()`, and the approval pattern all derive from it.
No typed-spelling alias that names a *different* file survives, so a later `allow` on the typed spelling cannot win over a deny on the target under last-match-wins (union aliases would reopen the bypass in the other direction).

### `src/path/native-tool-target.ts` (new)

```typescript
export interface NativeToolTarget {
  /** Absolute path the built-in tool opens. */
  readonly target: string;
  /** True when Pi's normalization or a read fallback changed the spelling. */
  readonly rewritten: boolean;
  /**
   * The Pi-normalized spelling before cwd resolution, when it is relative and
   * no read fallback fired — kept as a match alias so a raw-relative rule
   * (`../other/*`) keeps matching as it does through `forPath` today.
   */
  readonly relativeSpelling?: string;
}

export function resolveNativeToolTarget(
  rawPath: string,
  options: {
    cwd: string;
    flavor: PathFlavor;
    readFallbacks: boolean;
    exists: (absolutePath: string) => boolean;
  },
): NativeToolTarget;
```

It mirrors Pi's six steps in Pi's order, then (when `readFallbacks`) the four `resolveReadPath` variants in Pi's order, each tried only when the primary target does not exist.
`rewritten` is `true` exactly when step 1 (Unicode spaces), step 3 (win32 drive mount), step 5 (`file://`), or a read fallback changed the string.
Steps 2, 4, and 6 (`@`, `~`, cwd resolution) are spellings the current `forPath` already resolves identically, so a plain `src/a.ts`, `~/x`, or `@x` is not "rewritten" and discloses nothing.
A `file://` URL that `fileURLToPath` rejects (a POSIX `file://host/x`) makes Pi's tool throw before any access; the mirror then falls back to the raw spelling resolved against cwd rather than throwing out of a gate.

Platform branching goes on the flavor, keeping `path-flavor.ts` the only home of the win32 decision:

```typescript
interface PathFlavor {
  // …existing members…
  /** Pi's `normalizeWindowsShellPath` on win32; identity on POSIX. */
  toolShellPath(value: string): string;
  /** `fileURLToPath(url, { windows })` for this flavor; throws like Node. */
  fileUrlToPath(url: string): string;
}
```

`~` expansion uses `os.homedir()` + `flavor.impl.join`, matching Pi's `join(home, rest)`; it deliberately does **not** reuse `expandHomePath`, which also expands `$HOME`/`${HOME}` that Pi leaves literal.

### `AccessPath.forNativeTarget` (new static factory)

```typescript
static forNativeTarget(
  native: NativeToolTarget,
  options: { cwd: string; flavor: PathFlavor },
): AccessPath;
```

- lexical = `flavor.comparable(native.target, cwd)` (normalize + fold), **without** `normalizePathPolicyLiteral` (no trim, quote strip, or `$HOME`).
- match aliases = deduped `[lexical, ...cwdRelativePolicyValues(lexical, cwd, flavor), native.relativeSpelling]`, in that order, so an unrewritten input yields the same array `forPath` yields today (`test/handlers/gates/path.test.ts` builds six expectations with `AccessPath.forPath(…)` at lines 190, 256, 306, 370, 391, 412, five of them inside `toHaveBeenCalledWith`, which compares private fields structurally).
- canonical = `flavor.fold(canonicalizePath(lexical, flavor))`.
- `resolvedAlias()` returns the canonical when it differs from lexical (unchanged), else the lexical target when `native.rewritten`, else `undefined`.
  The constructor gains one private `rewritten` flag; the existing factories pass `false`.

### `PathNormalizer.forToolPath` (new)

```typescript
forToolPath(toolName: string, rawPath: string): AccessPath {
  if (classifyToolKind(toolName) !== "path") return this.forPath(rawPath);
  return AccessPath.forNativeTarget(
    resolveNativeToolTarget(rawPath, {
      cwd: this.cwd, flavor: this.flavor,
      readFallbacks: toolName.trim() === "read",
      exists: (p) => existsSync(p),
    }),
    { cwd: this.cwd, flavor: this.flavor },
  );
}
```

The probe is `existsSync` (Node's `access(F_OK)`, following symlinks) to match Pi's `fileExists`, deliberately distinct from `entryExists`'s `lstat`: a dangling symlink at the typed spelling makes Pi try the variants, and the mirror must too.
`classifyToolKind` already lives in `access-intent/`, which `path/` may import (the assessor confirmed with `fallow guard`; `path-normalizer.ts` already imports `access-intent/access-path`), and `tool-kind.ts` does not import `path-normalizer.ts`, so no cycle.

Consumer call sites (Tell-Don't-Ask: each gate hands the tool name and raw path to the normalizer and gets a prepared value back):

```typescript
// path.ts / tool-call-gate-pipeline.ts / input-normalizer.ts
const accessPath = normalizer.forToolPath(tcc.toolName, filePath);
// external-directory.ts — boundary now from the built AccessPath
const accessPath = normalizer.forToolPath(tcc.toolName, externalDirectoryPath);
if (!normalizer.isBoundaryOutsideWorkingDirectory(accessPath.boundaryValue())) return null;
```

For a non-built-in tool, `forToolPath` is `forPath(raw)`, and `boundaryValue()` is exactly `canonicalNormalizePathForComparison(raw, cwd)`, which is what `isOutsideWorkingDirectory(raw)` computed, so the boundary decision for extension and MCP tools is unchanged.
`PathNormalizer.isOutsideWorkingDirectory` then has no caller and is removed.

### Display

`buildPathAskPayload` gains an optional `resolvedPath` and renders the existing `resolvedAliasEvidence` ("resolves to"); `describePathGate` passes `accessPath.resolvedAlias()`.
`describeExternalDirectoryGate` already passes `resolvedAlias()`, so it discloses a rewritten target with no further change.
The payload's decision value, the log context, and `input` keep the raw typed path: they record what the agent sent.

### Behavior that changes, and where it does not

- Changes: a built-in-tool spelling Pi rewrites (Unicode spaces, `file://`, win32 drive mounts, the four `read` fallbacks) is now matched as the file Pi opens.
- Changes: a built-in-tool spelling our cleanup used to rewrite but Pi does not (`$HOME/…`, a wrapping quote pair, surrounding whitespace) is now matched as the literal path Pi opens (`<cwd>/$HOME/…`), not the expanded one.
  Before, a deny on `~/.ssh/*` fired for `read $HOME/.ssh/config`, a call that reads `<cwd>/$HOME/.ssh/config`; after, it does not, because that is not the file accessed.
- Unchanged: every canonical, `~`, `@`, relative, and symlinked spelling (same alias array, pinned by the existing gate tests), every extension/MCP tool, and every bash token.

### TOCTOU

The `read` fallback probe runs at `tool_call`; Pi probes again at execution.
A file created between the two under a variant spelling could change Pi's choice.
The window is the gate's own latency plus any ask, and creating the variant requires a write the gate also checks; recorded under Risks rather than designed around.

## Module-Level Changes

- `src/access-intent/path-normalization.ts` — export the cwd-relative alias derivation as `cwdRelativePolicyValues(absolute, cwd, flavor)` (today the private `getCwdRelativePathPolicyValues`); `getAbsolutePathPolicyValues` keeps calling it.
- `src/path/path-flavor.ts` — `PathFlavor.toolShellPath` and `PathFlavor.fileUrlToPath` on the interface and `PlatformPathFlavor`.
- `src/path/native-tool-target.ts` — **new**: `NativeToolTarget`, `resolveNativeToolTarget`.
- `src/access-intent/access-path.ts` — `forNativeTarget` factory, private `rewritten` flag, `resolvedAlias()` widened; class doc lists the new factory.
- `src/path/path-normalizer.ts` — `forToolPath`; remove `isOutsideWorkingDirectory`; class doc names the native-target mirror.
- `src/path/path-containment.ts` — doc comment at line 8 cites `PathNormalizer.isOutsideWorkingDirectory`; repoint to `isBoundaryOutsideWorkingDirectory`.
- `src/handlers/gates/path.ts` — `forToolPath`; pass `resolvedPath`.
- `src/handlers/gates/external-directory.ts` — `forToolPath`; boundary from `accessPath.boundaryValue()`.
- `src/handlers/gates/tool-call-gate-pipeline.ts` — `forToolPath` in `resolvePerToolCheck`.
- `src/access-intent/input-normalizer.ts` — `buildAccessIntentForSurface` calls `normalizer.forToolPath(surface, value)` (for `path`/`external_directory`/directional surfaces `classifyToolKind` answers `extension`, so they keep `forPath`).
- `src/presentation/path-ask-payload.ts` — `buildPathAskPayload` accepts `resolvedPath`.
- Tests: `test/access-intent/path-normalization.test.ts`, `test/path/path-flavor.test.ts`, `test/path/native-tool-target.test.ts` (**new**, including the Pi parity oracle), `test/access-intent/access-path.test.ts`, `test/path/path-normalizer.test.ts`, `test/handlers/gates/path.test.ts`, `test/handlers/gates/external-directory.test.ts`, `test/handlers/gates/tool.test.ts` (line 59 helper builds via `forPath`), `test/access-intent/input-normalizer.test.ts`, `test/presentation/path-ask-payload.test.ts`, `test/handlers/native-tool-target-acceptance.test.ts` (**new**, modeled on `external-directory-symlink-acceptance.test.ts`).
- Docs:
  - `docs/architecture/architecture.md` — module-tree entries for `path-normalization.ts`, `access-path.ts`, `path-flavor.ts`, `path-normalizer.ts` (drop `isOutsideWorkingDirectory`, add `forToolPath`), the gate entries `path.ts`/`external-directory.ts`/`tool.ts`, a new `native-tool-target.ts` entry under `path/`, and the "Path-bearing tool normalization" prose (line 365 names `normalizer.forPath(path)`).
  - `README.md` lines 77 and 81, `docs/configuration.md` lines 399, 688, 828 — "the path as the agent references it" becomes "the file the tool opens" for built-in tools.
  - `.pi/skills/package-pi-permission-system/SKILL.md` — a new `## Upstream assumptions` row: built-in tools resolve `path` through `path-utils.ts` (`resolveToCwd`, `resolveReadPath`) and `utils/paths.ts` (`normalizePath`); breaks as behavioral-silent, caught by the parity test on the next dependency bump.
- Predicted unchanged: `src/access-intent/bash/bash-path-resolver.ts` and `forBashToken` (bash tokens are not resolved by Pi); `src/policy/permission-manager.ts` (still string-based, ADR 0002); `src/handlers/gates/external-directory-policy.ts` (takes a built `AccessPath`); `src/handlers/gates/tool.ts` (consumes `pathAccess` as built); `test/handlers/external-directory-symlink-acceptance.test.ts` (absolute, unrewritten spellings build identical alias arrays).

## Test Impact Analysis

1. New tests the extraction enables: `resolveNativeToolTarget` is a pure function over an injected probe, so every rewrite and fallback is unit-testable without a gate; the parity oracle runs Pi's real `resolveReadPath`/`resolveToCwd` and our mirror over one real fixture directory and asserts equal targets row by row.
   The oracle imports `../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/path-utils.js` and `…/dist/utils/paths.js` by relative path (measured: `tsc` resolves the sibling `.d.ts`, no suppression needed).
2. Redundant: the `isOutsideWorkingDirectory` cases in `test/path/path-normalizer.test.ts` (lines 87–123, 214–218) are ported to `isBoundaryOutsideWorkingDirectory(forPath(x).boundaryValue())` in step 2 and the originals deleted with the method in step 8.
3. Must stay as-is: the gate tests over `forPath`-built expectations for unrewritten inputs (`path.test.ts`'s `.env`, `~/.ssh/config`, `/etc/passwd` cases) pin that `forNativeTarget` builds the same alias array for an unrewritten spelling; switch their constructor to `normalizer.forToolPath("read", …)` but keep the asserted values.
   The symlink acceptance test stays untouched as the canonical-alias invariant pin.

The parity oracle's fixture must include this repo's own shape risks: a name with both a straight and a curly variant present (primary wins), a dangling symlink at the typed spelling, an NFD-only name, and a `%`-encoded `file://` URL.
On APFS the NFD row cannot distinguish "fallback fired" from "filesystem matched" (Pi returns the NFC spelling); the oracle asserts equality with Pi either way, and the unit test drives the NFD fallback through an injected `exists`.

## Invariants at risk

- [#418]/[#486]/[#502]: path, per-tool, and external-directory rules match lexical ∪ canonical.
  Pinned by `test/handlers/external-directory-symlink-acceptance.test.ts` (real symlinks, real manager) and `path.test.ts:275`'s `matchValues()` assertion `["/test/project/.env", ".env", "/vault/secret.env"]`; both must stay green unchanged in the gate step.
- [#438]: the approval pattern derives from the same representation the decision displayed.
  `approvalPatternFor(accessPath)` reads `value()`, now the target; the acceptance test asserts the session-approval pattern's directory is the target's directory for a fallback row.
- ADR 0002: the manager never sees `AccessPath`; the new factory changes nothing on the `path-values` side (lint-guarded).
- Extension/MCP boundary decision unchanged: `external-directory.test.ts` extension-tool cases must stay green when the raw-string `isOutsideWorkingDirectory` call is replaced (step 8).

## TDD Order

1. **refactor: export the cwd-relative alias derivation** — `src/access-intent/path-normalization.ts`, `test/access-intent/path-normalization.test.ts`.
   Prepares `forNativeTarget` (step 5), which needs the alias for an already-absolute value.
   Direct tests: inside cwd → `["src/a.ts"]`, cwd itself → `[]`, outside → `[]`, win32 flavor folds.
   Killing mutation: make `cwdRelativePolicyValues` return `[]` unconditionally → the inside-cwd test fails.
   Commit: `refactor(pi-permission-system): expose the cwd-relative path alias derivation`.
2. **test: pin the outside-cwd boundary through `boundaryValue()`** — `test/path/path-normalizer.test.ts`.
   Port every `isOutsideWorkingDirectory` scenario (cwd-relative inside, `/etc/hosts`, `~/secrets`, symlink-in-cwd, symlinked cwd, win32 case fold) to `isBoundaryOutsideWorkingDirectory(normalizer.forPath(x).boundaryValue())`, alongside the originals, so step 8's removal is a pure deletion.
   Killing mutation: make `isBoundaryOutsideWorkingDirectory` return `false` → the `/etc/hosts` and symlink-escape ports fail.
   Commit: `test(pi-permission-system): pin the cwd boundary through the AccessPath boundary value`.
3. **refactor: the flavor answers Pi's win32 shell-path and file-URL questions** — `src/path/path-flavor.ts`, `test/path/path-flavor.test.ts`.
   Parity table against Pi's exported `normalizeWindowsShellPath` (imported from the pinned `dist/utils/paths.js`) on `win32PathFlavor`: `/c/x/y`, `/C`, `/mnt/d/a`, `/cygdrive/e/b/c`, `//server/share`, `/c\x`, `/tmp/x`, `c:\x`; POSIX flavor returns each unchanged.
   `fileUrlToPath`: `file:///tmp/s%65cret` → `/tmp/secret` (POSIX), `file:///C:/x/y%20z` → `C:\x\y z` (win32), `file://host/x` throws on POSIX.
   Killing mutations: drop the `mnt\/|cygdrive\/` alternative → the `/mnt/d/a` and `/cygdrive/e/b/c` rows fail; pass `{ windows: false }` on win32 → the `C:` URL row fails.
   Commit: `refactor(pi-permission-system): give PathFlavor Pi's win32 shell-path and file-URL conversions`.
4. **refactor: mirror Pi's built-in tool path resolution** — new `src/path/native-tool-target.ts`, new `test/path/native-tool-target.test.ts`.
   No consumer yet, hence `refactor:`.
   Unit classes, driven with an injected `exists`: (a) normalization: NBSP/`\u2007`/`\u3000` → space, one leading `@`, `~` and `~/x`, `file://` and `%`-encoded `file://`, `$HOME/x` and `'x'` and ` x` left literal; (b) read fallbacks: AM/PM, NFD, curly, NFD+curly, each only when the primary is absent, in Pi's order, and none when `readFallbacks` is false; (c) flags: `rewritten` false for `src/a.ts`, `/abs/x`, `~/x`, `@x`; true for (a)'s Unicode/`file://` rows and every fallback; `relativeSpelling` set for a relative input, absent after a fallback or for an absolute input; (d) a rejected `file://host/x` falls back to the raw spelling resolved against cwd without throwing.
   Parity oracle (`describe("parity with Pi's resolver")`): a real tmp fixture directory (files with a space, `’`, `\u202FPM`, an NFD name, `secret.txt`, both `q'x` and `q’x`, a dangling symlink), a list of typed spellings, and `expect(resolveNativeToolTarget(s, {…readFallbacks: true, exists: existsSync}).target).toBe(resolveReadPath(s, cwd))` plus the `resolveToCwd` twin with `readFallbacks: false`.
   Killing mutations, one per class: (a) delete the Unicode-space replace → the NBSP unit row and its oracle row fail; (b) try the curly variant even when the primary exists → the `q'x` row fails (Pi returns the straight file); (b') ignore `readFallbacks` → the `write` curly row fails; (c) set `rewritten` to `false` always → the NBSP flag row fails; (d) let `fileUrlToPath` throw through → the `file://host/x` row fails.
   Commit: `refactor(pi-permission-system): mirror the path resolution of Pi's built-in file tools`.
5. **refactor: `AccessPath.forNativeTarget`** — `src/access-intent/access-path.ts`, `test/access-intent/access-path.test.ts`.
   Tests: an unrewritten relative target builds `matchValues()` equal to `forPath`'s for the same input (`.env` → `["/cwd/.env", ".env"]`); a target ending in `'` or carrying a trailing space keeps it in `value()`; `resolvedAlias()` returns the target when `rewritten` and canonical equals lexical, the canonical when they differ, `undefined` otherwise; `relativeSpelling` appears in `matchValues()` for `../other/x`.
   Killing mutations: route the target through `normalizePathPolicyLiteral` → the trailing-quote test fails; drop the `rewritten` branch from `resolvedAlias()` → the rewritten-disclosure test fails; omit `relativeSpelling` from the aliases → the `../other/x` test fails.
   Commit: `refactor(pi-permission-system): build an AccessPath from a native tool target`.
6. **refactor: `PathNormalizer.forToolPath`** — `src/path/path-normalizer.ts`, `test/path/path-normalizer.test.ts`.
   Tests over real tmp files: `read` of `d'x.txt` with only `d’x.txt` on disk → `value()` is the curly target; `write` of the same → the straight target (no fallback); extension tool `my-ext` with `$HOME/x` → `toEqual(normalizer.forPath("$HOME/x"))`; `read` with a dangling symlink at the typed spelling and the curly file present → the curly target (the `existsSync` probe, not `lstat`).
   Killing mutations: dispatch every tool through the native mirror → the extension `$HOME` test fails; pass `readFallbacks: true` for every tool → the `write` test fails; probe with `entryExists` → the dangling-symlink test fails.
   Commit: `refactor(pi-permission-system): let PathNormalizer resolve a built-in tool's path`.
7. **fix: the `path` and per-tool gates check the file the tool opens** — `src/handlers/gates/path.ts`, `src/handlers/gates/tool-call-gate-pipeline.ts`, `test/handlers/gates/path.test.ts` (switch the six `AccessPath.forPath(…)` expectations to `normalizer.forToolPath("read", …)` with unchanged values), `test/handlers/gates/tool.test.ts` (line 59 helper → `forToolPath`), new `test/handlers/native-tool-target-acceptance.test.ts`.
   Acceptance (real `createManager` + `PermissionResolver` + real files, as in the spike): for `path: { "*": "allow", "<file>": "deny" }`, each bypass row of the Background table now denies through `describePathGate`; the per-tool rows deny through `ToolCallGatePipeline` with `read: { "*": "allow", "<file>": "deny" }`; an allow keyed on the target lets the rewritten spelling through (no over-deny); the session-approval pattern for the curly row is the target's directory plus `*`.
   Killing mutations: revert `path.ts` to `normalizer.forPath(filePath)` → every `describePathGate` bypass row fails; revert the pipeline line → every per-tool row fails.
   Commit: `fix(pi-permission-system): a path rule applies to the file a built-in tool opens, however the path is spelled`.
8. **fix: the `external_directory` gate judges the target's boundary** — `src/handlers/gates/external-directory.ts`, `src/path/path-normalizer.ts` (remove `isOutsideWorkingDirectory`), `src/path/path-containment.ts` (doc comment), `test/path/path-normalizer.test.ts` (delete the originals step 2 ported), `test/handlers/gates/external-directory.test.ts`, the acceptance file.
   Acceptance: `read` of `file://<outside>/x` with `external_directory: { "*": "ask" }` now raises the ask (before: `null`, judged inside cwd); an NBSP spelling of an outside file whose allow is keyed on the target passes; extension-tool cases unchanged.
   Killing mutation: restore `normalizer.isOutsideWorkingDirectory(externalDirectoryPath)` as the boundary test (re-adding the method) → the `file://` ask row fails.
   Commit: `fix(pi-permission-system): an outside file spelled as a file URL still asks for external-directory access`.
9. **fix: the service answers a built-in tool query at gate parity** — `src/access-intent/input-normalizer.ts`, `test/access-intent/input-normalizer.test.ts` (`describe("buildAccessIntentForSurface")`).
   Tests: surface `read` with the curly spelling → the intent's `path.value()` is the curly target; surface `path` with the same value → `forPath` behavior (no fallback).
   Killing mutation: revert to `normalizer.forPath(pathValue)` → the `read` test fails.
   Commit: `fix(pi-permission-system): a permissions-service path query sees the file the tool would open`.
10. **fix: a path prompt names the file a rewritten spelling resolves to** — `src/presentation/path-ask-payload.ts`, `src/handlers/gates/path.ts`, `test/presentation/path-ask-payload.test.ts`, `test/handlers/gates/path.test.ts`, the acceptance file (external-directory disclosure for the `file://` row).
    Tests: `buildPathAskPayload({ …, resolvedPath })` carries a "resolves to" evidence entry, none when undefined; `describePathGate` on an `ask` rule for the curly row discloses the curly target.
    Killing mutation: drop `resolvedAliasEvidence` from `buildPathAskPayload` → the payload test fails; pass `undefined` from `path.ts` → the gate disclosure test fails.
    Commit: `fix(pi-permission-system): a path prompt shows the file a rewritten spelling resolves to`.
11. **docs** — `docs/architecture/architecture.md` entries and prose, `README.md`, `docs/configuration.md`, and the package skill's upstream-assumptions row (Module-Level Changes lists each).
    Re-read the "Path-bearing tool normalization" section and the architecture overview's Mermaid blocks for a node naming `forPath` on the tool path.
    Commit: `docs(pi-permission-system): document that built-in tool paths are gated as the file Pi opens`.

Re-read the moved derivation in step 1 and the mirror in step 4 against the `code-design` skill before committing: the mirror is a copy of Pi's control flow and should not inherit an ambient `process.platform` or `homedir` read beyond what the flavor and `os.homedir()` provide.

## Risks and Mitigations

- **Upstream drift.**
  Pi changes `normalizePath` or `resolveReadPath`, and the mirror silently diverges.
  The parity oracle runs Pi's real functions from the pinned dependency, so a bump that changes them fails the suite; the upstream-assumptions row names the files for `/upstream-impact`.
  Measured that the pinned 1.0.0 `dist` and `../pi` main match today.
- **Dist layout moves on a bump.**
  The oracle's relative import then fails to resolve, a loud failure rather than a silent one; fix the path in the bump.
- **Over-normalization removed.**
  `$HOME/…`, quoted, or whitespace-padded built-in tool paths no longer match the expanded/cleaned rule.
  This matches the file Pi opens (`<cwd>/$HOME/…`); spiked in reading, not executed: Pi's `normalizePath` has no `$HOME` branch (verified in source).
- **TOCTOU on `read` fallbacks.**
  See Design Overview; creating the variant needs a write the gates also check.
- **Forwarded requests.**
  A child fixes `matchValues` from its own `AccessPath`, so a parent serving it sees the target's aliases with no change on the wire (ADR 0008).

## Open Questions

- Should the per-tool ask payload (`buildToolAskPayload`) also disclose the resolved target?
  Its session label already derives from the target's directory; defer until a report shows the input preview misleading someone.

[#418]: https://github.com/gotgenes/pi-packages/issues/418
[#438]: https://github.com/gotgenes/pi-packages/issues/438
[#486]: https://github.com/gotgenes/pi-packages/issues/486
[#502]: https://github.com/gotgenes/pi-packages/issues/502
[#1016]: https://github.com/gotgenes/pi-packages/issues/1016
