---
issue: 508
issue_title: "fix: bash external_directory gate misses Windows drive-letter absolute paths"
---

# Recognize Windows drive-letter paths in the bash path classifiers

## Release Recommendation

**Release:** ship independently

This fix is a standalone bug fix, not part of a release batch.
It ships on its own `fix:` release.
[#510] has **landed** (the `PathNormalizer` platform/path-semantics seam), so #508 builds directly on it rather than carrying its own platform plumbing.
The trailing `docs:` commit is a hidden changelog type that batches into the same release.

## Problem Statement

On Windows / MSYS2, a bash command that references a file by a native drive-letter absolute path bypasses the `external_directory` gate, while the same file accessed through the `read` / `write` tools is correctly gated.
The strict path-candidate classifier `classifyTokenAsPathCandidate` (`src/access-intent/bash/token-classification.ts`) — the one feeding the `external_directory` bash gate — only recognizes Unix-style absolute paths (`/…`), home-relative paths (`~/…`), and parent-traversal paths (`..`).
A Windows drive-letter path starts with a letter, so it is silently dropped before the gate ever sees it.

Two sub-cases differ in which surfaces miss them:

- `C:/Windows/win.ini` (forward slashes) is dropped by the strict classifier but already accepted by the broader `path` classifier (`classifyTokenAsRuleCandidate`, because it contains `/`).
  So it is missed only by the `external_directory` gate.
- `D:\secrets\password.txt` (backslashes) contains no `/`, no leading `.`, and no `..`, so it is dropped by **both** classifiers.

The format used to reference a path should not be a way to escape the working-directory boundary check.

## Goals

- The strict classifier recognizes Windows drive-letter absolute paths in both separator forms (`C:/…` and `C:\…`), so the `external_directory` bash gate sees them.
- The broader classifier also recognizes the backslash drive form (`D:\…`), so a `path`-surface rule applies to drive paths consistently across separator forms (the forward-slash form already reaches it via the `/` branch).
- The fix lands on [#510]'s `PathNormalizer` seam: absoluteness, containment, and canonicalization are decided by the baked-in platform flavor, so the newly-admitted drive tokens route correctly on Windows (absolute → outside-CWD check) and on POSIX (relative → in-CWD gating) with no per-#508 platform plumbing.
  The one residual hand-rolled check #510 left behind — `isRelativeCandidate` in `bash-path-resolver.ts` — is converted to the normalizer's `isAbsolute` here (see Design).
- POSIX behavior is unchanged: a drive-shaped token resolves as the real in-CWD relative path it denotes (`cat C:/foo` → `./C:/foo`) and stays gated by the `path` surface as it is today.

This is a non-breaking bug fix (`fix:`).
It closes a permission bypass; the gate's documented intent already covers these paths.
On POSIX there is no observable change; on Windows a previously-ungated drive path now correctly triggers the `external_directory` prompt — the intended behavior of the gate.

## Non-Goals

- The platform/path-semantics seam itself (the `PathNormalizer` collaborator threaded through the projection, `AccessPath`, `normalizePathForComparison`, `canonicalizePath`) is [#510], which has landed. #508 builds on it.
  The lone exception is the `isRelativeCandidate` free function in `bash-path-resolver.ts`, whose `startsWith("/")` → `isAbsolute` conversion #510 deferred; #508 folds that one change in (it is required to avoid the unknown-base over-flag once drive tokens are admitted).
- The bare-filename `path`-surface gap (`cat id_rsa`, `cat key.pem`) is tracked separately by [#509] and is out of scope here.
- No POSIX advisory warning for "this token looks like a Windows path on a POSIX host."
  Dropping such a token would *reduce* POSIX path-surface coverage of the real in-CWD access; the focused fix keeps gating it.
  Not filed as a follow-up — no concrete need named.
- `token-collection.ts`, `command-enumeration.ts`, and `program.ts` logic is unchanged by #508 — the fix is confined to classifier shape recognition plus the single `isRelativeCandidate` conversion in `bash-path-resolver.ts`.

## Background

Relevant modules (`src/access-intent/bash/`):

- `token-classification.ts` — two pure classifiers (`classifyTokenAsPathCandidate` strict, `classifyTokenAsRuleCandidate` broad) sharing a private `rejectNonPathToken` prelude.
  Pure string-shape matching, no platform branch (Refs [#289], [#476]).
- `bash-path-resolver.ts` (the post-[#510] class form of the old `cwd-projection.ts`) — the `BashPathResolver` class holds a `PathNormalizer` (`this.normalizer`) and exposes `projectExternalPaths` (feeds `external_directory`, strict classifier) and `projectRuleCandidates` (feeds the `path` surface, broad classifier).
  Its `cd`-fold (`foldCd`) already delegates absoluteness to `this.normalizer.isAbsolute`, but the module-level free function `isRelativeCandidate` (called from `projectExternalPaths` and `buildRuleCandidatePath`) still hand-rolls `!candidate.startsWith("/") && !candidate.startsWith("~")`.
  The literal-only guard for a relative candidate under an unknown `cd` base (Refs [#393]) lives in `buildRuleCandidatePath`.

Key existing facts that shape the design:

- The platform-sensitive decision ("is `C:/foo` absolute?") lives in `node:path` (`path.win32.isAbsolute("C:/foo") === true`, `path.posix.isAbsolute("C:/foo") === false`) and is reached through the `PathNormalizer`'s `isAbsolute`.
  The bug #508 fixes is purely that the strict classifier drops the token before resolution.
- The `rejectNonPathToken` prelude already lets drive paths through: `C:/Windows/win.ini` and `D:\secrets\password.txt` survive it (the `URL_PATTERN` requires `://`, so a single-slash `C:/…` is not a URL; backslash paths contain no metacharacter sequence).
  Only the **acceptance gate** drops them.
- AGENTS / `code-design`: do not read `process.platform` inside library/utility functions.
  Drive-letter *shape* recognition is platform-independent string matching (no `process.platform`); the platform-dependent *absoluteness* decision is delegated to the `PathNormalizer` from [#510].

## Design Overview

### Two separate questions, two separate seams

The change relies on a clean separation of two distinct questions:

1. **"Is this token shaped like a path worth gating?"** — platform-independent, owned by the classifiers (this issue).
   A drive-letter shape (`<letter>:` followed by `/` or `\`) is recognized unconditionally on every platform.
   On POSIX this is harmless: the token resolves as a real in-CWD relative path and is gated by the `path` surface as today.
2. **"Is this path absolute (resolve base-independently) or relative (resolve against the effective `cd` base)?"** — platform-dependent, delegated to the `PathNormalizer` ([#510]).

Conflating them into a shared helper used by both classifier and projection would be the wrong abstraction — shape recognition is inclusive and platform-independent, absoluteness is exclusive and platform-dependent.
[#510] established seam 2 (the `PathNormalizer`); #508 adds the missing case to seam 1 (the classifier) and converts the one straggler in seam 2 — `isRelativeCandidate` — onto the normalizer.

### Shape recognition (classifiers)

A private module constant in `token-classification.ts`:

```typescript
/** Windows drive-letter absolute path: a drive letter, a colon, then a separator. */
const WINDOWS_DRIVE_PATH_PATTERN = /^[a-zA-Z]:[/\\]/;
```

The pattern requires a **separator** after `<letter>:`, so it matches the absolute forms (`C:/…`, `C:\…`) but not drive-relative `C:foo` (which `node:path` also treats as *not* absolute — correct to leave as an ordinary token).
The single-letter restriction means multi-letter schemes (`https:`, `mailto:`) never match; a single-letter scheme with `//` (`c://x`) is already rejected by `URL_PATTERN` earlier in the prelude.

Both classifiers gain a branch returning the token when the pattern matches:

- `classifyTokenAsPathCandidate` — new acceptance branch (the core `external_directory` fix; previously dropped both forms).
- `classifyTokenAsRuleCandidate` — new acceptance branch (covers the backslash form `D:\…`; the forward-slash form already matched via `token.includes("/")`, but the explicit branch makes both forms first-class and order-independent of the `/` check).

### Routing on the [#510] seam

Once the classifier admits a drive token, the `PathNormalizer` routes it (after #508 converts `isRelativeCandidate` to `!this.normalizer.isAbsolute(candidate) && !candidate.startsWith("~")`):

| Token                        | Host flavor | base       | Branch   | Outcome                                              |
| ---------------------------- | ----------- | ---------- | -------- | ---------------------------------------------------- |
| `C:/Windows/win.ini`         | win32       | known(cwd) | resolved | `C:\Windows\win.ini`, outside CWD → flagged          |
| `D:\secrets\password.txt`    | win32       | known(cwd) | resolved | absolute, outside CWD → flagged                      |
| `C:/projects/app/inside.txt` | win32       | unknown    | resolved | inside CWD → not flagged (no over-flag)              |
| `C:/Windows/win.ini`         | posix       | known(cwd) | resolved | `<cwd>/C:/Windows/win.ini`, inside CWD → not flagged |
| `cat C:/foo` (path surface)  | posix       | any        | —        | real `./C:/foo`, gated by `path` surface as today    |

Because #508 converts `isRelativeCandidate` to the normalizer's `isAbsolute` (not the hand-rolled `startsWith`), the unknown-base over-flag a classifier-only fix would introduce — a Windows-absolute drive path inside CWD wrongly taking the relative/unknown branch — does not occur: on win32 the path is `isAbsolute`, so it takes the resolved branch with its inside-CWD check.
Note #510's `foldCd` absoluteness is already correct, but the projection's relative/unknown decision still runs through the hand-rolled `isRelativeCandidate`, so this conversion is load-bearing for #508, not cosmetic.

## Module-Level Changes

- `src/access-intent/bash/token-classification.ts`
  - Add private `WINDOWS_DRIVE_PATH_PATTERN` constant.
  - Add a drive-letter acceptance branch to `classifyTokenAsPathCandidate`.
  - Add a drive-letter acceptance branch to `classifyTokenAsRuleCandidate`.
  - Update the module/JSDoc summaries that enumerate accepted shapes to include the Windows drive-letter form.
- `src/access-intent/bash/bash-path-resolver.ts`
  - Convert the module-level `isRelativeCandidate` free function to a private `BashPathResolver` method: `private isRelativeCandidate(candidate: string): boolean { return !this.normalizer.isAbsolute(candidate) && !candidate.startsWith("~"); }`.
  - Update its two call sites (`projectExternalPaths`, `buildRuleCandidatePath`) to `this.isRelativeCandidate(...)`.
  - The tilde check stays (tilde expansion is a shell concern, not a `node:path` one).
- `test/access-intent/bash/token-classification.test.ts`
  - Add drive-letter acceptance cases for both classifiers (both separators, lowercase drive), plus negative cases pinning that `URL_PATTERN` still rejects `c://x` and that drive-relative `C:foo` (no separator) is not accepted by the strict classifier.
- `test/bash-external-directory.test.ts` (a win32 `describe` block alongside the existing POSIX suite)
  - Add Windows assertions built with `new PathNormalizer("win32", cwd)` passed to `extractExternalPathsFromBashCommand(command, normalizer)` (which calls `BashProgram.parse(command, normalizer)`) — no `vi.mock("node:path")`.
  - Assert: a Windows-absolute drive path outside cwd is flagged (`cat C:/Windows/win.ini`, `cat D:\secrets\password.txt`); an inside-cwd drive path is not flagged under a known base (`cat C:/projects/app/inside.txt`, cwd `C:\projects\app`) and under an unknown base (`cd "$D" && cat C:/projects/app/inside.txt` — the over-flag the `isRelativeCandidate` conversion prevents).
  - The existing POSIX suite (built with `new PathNormalizer(process.platform, cwd)`) stays green, proving POSIX behavior unchanged and the `isRelativeCandidate` conversion neutral.
- Documentation (descriptive, release-excluded):
  - `packages/pi-permission-system/docs/architecture/architecture.md` — update the `token-classification.ts` tree entry's classifier shape lists (`strict: /, ~/, ..` and the broad list) to include the Windows drive-letter form.
  - `.pi/skills/package-pi-permission-system/SKILL.md` — update the "Notes for Agents" line that enumerates the strict classifier's accepted shapes ("absolute, `~/`-relative, or `..`-traversal paths") to include Windows drive-letter paths.

A grep of `src/`, `test/`, the architecture doc, and the package SKILL confirms these are the only live references to the classifier's accepted-shape prose; the `docs/plans/*` and `docs/retro/*` mentions are historical records and are left unchanged.

## Test Impact Analysis

1. **New tests enabled.**
   Platform-independent classifier unit tests for the drive-letter shapes (both separators) in `token-classification.test.ts`.
   An end-to-end drive-letter assertion built with `new PathNormalizer("win32", cwd)` — exercising the real classifier + projection on Windows semantics on a POSIX CI **without** module mocking.
2. **Redundant tests.**
   None.
   The classifier change is additive (no existing acceptance/rejection assertion changes), so every existing assertion in `token-classification.test.ts` and the projection/external-directory suites stays valid.
3. **Tests that must stay as-is.**
   The POSIX external-directory / projection suite is the regression guard that POSIX gating is unchanged; it must stay green untouched.
   The `rejectNonPathToken` shared-rejection tests (URL, `@scope`, regex-metachar, bare-slash) pin that drive recognition does not weaken the prelude.

## Invariants at risk

The fix touches `token-classification.ts` (Refs [#289] clone-elimination of the shared prelude).
The projection invariants it could interact with are owned and re-pinned by [#510]:

- **[#289]** — both classifiers delegate the shared rejection cases to `rejectNonPathToken`.
  Pinned by the `shared rejection: rejectNonPathToken` describe blocks (tested via both classifiers).
  The new drive branches are added to the **acceptance** gate after the prelude, so the prelude is untouched; the URL / bare-slash negative cases stay green.
- **[#393]** — a relative candidate under an unknown `cd` base stays literal-only.
  Preserved across the `isRelativeCandidate` conversion: a genuinely-relative candidate is still "relative" on both flavors (`isAbsolute` is `false` for `../x`, `src/x`, and for `C:/x` on posix), so it still takes the literal-only branch; only a (base-independent) Windows-absolute drive path on win32 is routed to resolution, which is correct.
  Pinned by the unknown-base projection tests.
- **[#418]** — the boundary decision and dedup use the canonical form while the returned value is the lexical form.
  Unchanged: #508 adds candidates upstream of this logic.

## TDD Order

Prerequisite: [#510] has landed (the `PathNormalizer` seam).
It deferred the `isRelativeCandidate` conversion, so step 1 folds that one change in.

1. `fix:` Recognize Windows drive-letter paths and route them on the normalizer.
   Red: add drive-letter acceptance tests to `token-classification.test.ts` (both classifiers, both separators, lowercase drive, plus negative `c://x` URL and drive-relative `C:foo` cases) and the win32 end-to-end assertions in `test/bash-external-directory.test.ts` built with `new PathNormalizer("win32", cwd)` (outside-cwd `C:/…` and `D:\…` flagged; inside-cwd drive path under known and unknown base not flagged).
   Green: add `WINDOWS_DRIVE_PATH_PATTERN` and the acceptance branch to both classifiers (update their shape-listing JSDoc); convert `isRelativeCandidate` to a private method delegating to `this.normalizer.isAbsolute` and update its two call sites.
   Run `pnpm run check` and the full package suite (the conversion must leave the POSIX suite green).
   Commit: `fix(pi-permission-system): gate Windows drive-letter paths in bash external_directory (#508)`.

2. `docs:` Update descriptive docs for the new accepted shape.
   Update the `architecture.md` `token-classification.ts` tree entry and the `SKILL.md` "Notes for Agents" classifier-shape line to include Windows drive-letter paths.
   Commit: `docs(pi-permission-system): note Windows drive-letter paths in bash classifier docs (#508)`.

## Risks and Mitigations

- **The `isRelativeCandidate` conversion silently changes POSIX behavior.**
  Mitigation: it is behavior-neutral on POSIX for every currently-admitted token (`isAbsolute` matches `startsWith("/")` there); the full POSIX `bash-external-directory.test.ts` suite is the regression proof and must stay green in the same commit.
- **A second hand-rolled absoluteness check is missed.**
  Mitigation: grep `bash-path-resolver.ts` for `startsWith("/")` / `startsWith("~")` and confirm `isRelativeCandidate` is the only path-absoluteness straggler; `foldCd` already uses `this.normalizer.isAbsolute`.
- **Drive recognition weakens the rejection prelude.**
  Mitigation: the drive branches are added only to the acceptance gate, after `rejectNonPathToken`; the existing URL / `@scope` / regex-metachar / bare-slash rejection tests stay as guards.

## Open Questions

None blocking.
The scope (both classifiers, drive-letter-prefix detection, route via the [#510] `PathNormalizer`, fold in the deferred `isRelativeCandidate` conversion, keep POSIX gating) is confirmed.
[#510] has landed, so there is no remaining external dependency.

[#289]: https://github.com/gotgenes/pi-packages/issues/289
[#393]: https://github.com/gotgenes/pi-packages/issues/393
[#418]: https://github.com/gotgenes/pi-packages/issues/418
[#476]: https://github.com/gotgenes/pi-packages/issues/476
[#509]: https://github.com/gotgenes/pi-packages/issues/509
[#510]: https://github.com/gotgenes/pi-packages/issues/510
