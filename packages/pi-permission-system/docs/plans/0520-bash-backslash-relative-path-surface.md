---
issue: 520
issue_title: "Bash backslash-relative arguments (dir\\file) bypass the path permission surface on Windows"
---

# Bash backslash-relative arguments — win32 path-surface shape recognition

## Release Recommendation

**Release:** ship independently

This issue is a standalone Windows bug fix.
It is not a member of any architecture-roadmap release batch — the Phase 9 spine listing explicitly records [#520] under "Open issues swept and out of scope" (win32 backslash-relative bug), and every numbered roadmap step is tagged `Release: independent`.
So it ships on its own once landed.

## Problem Statement

A `path` permission rule gates a file when it is accessed through the `read` tool or through a bash command that uses a forward-slash relative path (`cat dir/file`), but not when the same file is referenced with a Windows backslash separator (`cat dir\file`) on Windows.
The broad bash classifier `classifyTokenAsRuleCandidate` (`src/access-intent/bash/token-classification.ts`) feeds the `path` surface for bash and accepts a token only if it starts with `.`, contains `/`, contains `..`, or is a Windows drive-letter absolute path (`C:/…` / `C:\…`).
A backslash-relative token like `dir\file` has none of these shapes, so it is dropped before rule evaluation and bypasses the `path` surface on Windows.

This is a shape-recognition gap, distinct from the [#509] bare-filename work: [#509] promotes a truly bare token (`id_rsa`) by matching an active `path` rule, whereas this is about recognizing the backslash separator as a relative-path marker on Windows.
It is platform-specific: on Windows `\` is a path separator, but on POSIX `\` is a legal filename character, so `dir\file` must remain a bare token on POSIX.

## Goals

- On Windows, recognize a backslash-relative bash token (`dir\file`, no `/`, no leading `.`, no `..`, not a drive-letter absolute) as a `path`-surface rule candidate, so it is gated the same as its forward-slash equivalent (`dir/file`) and the same as the file accessed through the `read` tool.
- Keep the platform-sensitive backslash decision inside `PathNormalizer` (the single home of platform semantics per the package skill), never re-reading `process.platform` in the bash classifier.
- Preserve POSIX behavior exactly: `dir\file` stays a bare token on POSIX (backslash is a legal filename character there) and is not treated as a path.

This is not a breaking change.
It only tightens gating on Windows for backslash-relative tokens that match an existing `path` rule; it never loosens an existing decision, and no config field, default, or output shape changes.

## Non-Goals

- The strict `external_directory` classifier (`classifyTokenAsPathCandidate`) is unchanged.
  Its forward-slash equivalent `dir/file` is already dropped by the strict gate (it accepts only absolute, `~/`, `..`, and drive-letter shapes), so the backslash form `dir\file` must be dropped there too for parity — a backslash *traversal* (`..\secret`) is already caught by the shared `includes("..")` branch in both classifiers, so no `external_directory` change is needed.
- The rule-driven promotion classifier `classifyPromotedRuleCandidate` ([#509]) is unchanged.
  On Windows a backslash token is now shape-recognized by `classifyTokenAsRuleCandidate` and never reaches the promoted fallback; on POSIX it stays bare and is subject to [#509] promotion only if it matches a specific `path` rule — existing behavior, untouched.
- Argument-position / per-command awareness (knowing that a token is a subcommand or search pattern rather than a file) — the same fail-safe scope [#509] set: it prompts, never silently allows.
- MSYS/Git Bash POSIX-absolute interpretation ([#533]) is untouched; this change only widens the relative-shape gate, and a recognized backslash token flows through the existing `PathNormalizer.forBashToken` win32 (`plain`) resolution.

## Background

Relevant modules and their current relationships:

- `src/access-intent/bash/token-classification.ts` — pure, synchronous classifiers.
  `classifyTokenAsRuleCandidate(token)` is the broad `path`-rule shape gate; it shares the private `rejectNonPathToken` prelude (flags, env assignments, URLs, `@scope` packages, bare-slash, regex metachars) with the strict `classifyTokenAsPathCandidate` and the promoted `classifyPromotedRuleCandidate` ([#509]).
  Shape recognition here is platform-independent string matching today; the drive-letter branch (`WINDOWS_DRIVE_PATH_PATTERN`) is applied unconditionally because on POSIX `C:/foo` resolves as a real in-CWD relative path and `PathNormalizer.isAbsolute` decides routing — but a backslash separator cannot be recognized unconditionally, because on POSIX `dir\file` is a single legal filename.
- `src/access-intent/bash/bash-path-resolver.ts` — `BashPathResolver` walks the AST once, tags each token with its cd-folded effective base, and projects two slices.
  `projectRuleCandidates` calls `classifyTokenAsRuleCandidate(token) ?? classifyPromotedRuleCandidate(token, this.isPromotablePathToken)`, then resolves the survivor via `buildRuleCandidatePath` → `normalizer.forBashToken`.
  It already delegates platform-aware string questions to its injected `PathNormalizer` (e.g. `isRelativeCandidate` calls `this.normalizer.isAbsolute`).
- `src/path-normalizer.ts` — `PathNormalizer` holds the host `platform` + session `cwd` and answers every platform-dependent question (`isAbsolute`, `forBashToken`, `interpretBashCdTarget`, containment).
  Consumers ask it semantic questions rather than reading `process.platform`; the generic `getPlatform()` accessor was retired ([#511], [#513]) so callers do not re-derive platform logic.
- `src/access-intent/bash/program.ts` — `BashProgram.parse(command, normalizer, isPromotable?)` constructs the resolver and eagerly resolves the slices.
- `src/wildcard-matcher.ts` / `src/rule.ts` — already carry a `windowsSeparators` boolean option (rewrites `/` → `\` in the expanded pattern) used by `pathMatchOptions`; this establishes the naming convention this plan reuses for the classifier option.

Constraint from AGENTS.md / the package skill: do not read `process.platform` inside `src/` — an ESLint `no-restricted-syntax` guard blocks it, and platform lives only in `PathNormalizer`.
So the backslash-as-separator decision must be answered by the normalizer, not re-derived in the classifier.

## Design Overview

### Decision model

The classifier stays the single home of path-shape recognition, but the one platform-sensitive shape — "is a backslash a path separator here?" — is decided by `PathNormalizer` and passed in as a small option, mirroring how `wildcard-matcher.ts` / `rule.ts` already thread a `windowsSeparators` boolean.

1. **Which separator shapes count** (shape) — `classifyTokenAsRuleCandidate` gains an optional `{ windowsSeparators?: boolean }` option.
   When `windowsSeparators` is true, a token containing `\` is accepted as path-shaped, exactly as `includes("/")` accepts a forward-slash token.
2. **Whether backslash is a separator** (platform) — `PathNormalizer` answers via a new narrow `usesWindowsSeparators()` accessor (`this.platform === "win32"`).
   `BashPathResolver.projectRuleCandidates` derives the option from the normalizer and passes it, so the platform bit has a single home and the classifier never reads `process.platform`.

The new accessor is a specific semantic predicate (like `isAbsolute`), not a revival of the retired generic `getPlatform()` — it answers one bounded question the classifier needs, and the caller does not branch on a raw platform value to re-implement path logic.

### Classifier: the backslash branch

```typescript
// token-classification.ts
export interface RuleCandidateOptions {
  /** On win32, a backslash is a path separator, so `dir\file` is path-shaped. */
  readonly windowsSeparators?: boolean;
}

export function classifyTokenAsRuleCandidate(
  token: string,
  options?: RuleCandidateOptions,
): string | null {
  if (rejectNonPathToken(token)) return null;

  if (token.startsWith(".")) return token;
  if (token.includes("/")) return token;
  if (token.includes("..")) return token;
  if (WINDOWS_DRIVE_PATH_PATTERN.test(token)) return token;
  if (options?.windowsSeparators && token.includes("\\")) return token;

  return null;
}
```

The shared `rejectNonPathToken` prelude runs first, so a flag, env assignment, URL, `@scope`, or regex-metachar token (`a\|b`, `\(group\)`) is still refused even under the flag — only a plain backslash-relative token survives.
The default (no option) is the exact current behavior, so the other callers and every existing test are unaffected.

### Normalizer: the narrow accessor

```typescript
// PathNormalizer
/** True when the host platform treats a backslash as a path separator (win32). */
usesWindowsSeparators(): boolean {
  return this.platform === "win32";
}
```

### Resolver: derive the option from the normalizer

```typescript
// BashPathResolver.projectRuleCandidates
const windowsSeparators = this.normalizer.usesWindowsSeparators();
for (const { token, base } of candidates) {
  const candidate =
    classifyTokenAsRuleCandidate(token, { windowsSeparators }) ??
    classifyPromotedRuleCandidate(token, this.isPromotablePathToken);
  if (!candidate) continue;
  // unchanged: buildRuleCandidatePath(candidate, base), dedup, push
}
```

A recognized backslash token then flows through the unchanged `buildRuleCandidatePath` → `normalizer.forBashToken("dir\\file", { resolveBase })`.
On win32, `classifyWin32BashToken("dir\\file")` returns `plain` (not a device, drive-mount, or POSIX-absolute), so `forBashToken` delegates to ordinary win32 `forPath`, resolving `<cwd>\dir\file` with the same canonical/lexical `matchValues()` the forward-slash token `dir/file` produces.
`describeBashPathGate` then resolves it against the `path` surface: because `pathMatchOptions` folds a rule's `/` → `\` on win32, a natural `"dir/file": "deny"` (or `"dir\\file": "deny"`) rule matches the token — closing the bypass with no gate-layer change.

### Call-site verification (Law of Demeter / Tell-Don't-Ask)

- Resolver → normalizer: `this.normalizer.usesWindowsSeparators()` — one call, a bounded boolean; no reach-through into `platform`.
- Resolver → classifier: `classifyTokenAsRuleCandidate(token, { windowsSeparators })` — a pure call; the classifier learns one bit, never the platform or the normalizer.
- The `#393` unknown-base rule (a token after a non-literal `cd` stays literal-only) and the `#418` canonical/lexical alias matching both apply to a recognized backslash token unchanged, since it feeds the same `buildRuleCandidatePath`.

## Module-Level Changes

- `src/access-intent/bash/token-classification.ts` — add the `RuleCandidateOptions` interface and the optional `options` parameter with the `windowsSeparators`-gated backslash branch on `classifyTokenAsRuleCandidate`; update the module header and the `classifyTokenAsRuleCandidate` doc comment to describe the win32 backslash-separator shape.
- `src/path-normalizer.ts` — add the `usesWindowsSeparators(): boolean` accessor.
- `src/access-intent/bash/bash-path-resolver.ts` — in `projectRuleCandidates`, derive `windowsSeparators` from `this.normalizer.usesWindowsSeparators()` and pass it to `classifyTokenAsRuleCandidate`; refresh the `projectRuleCandidates` doc comment to note the win32 backslash-separator recognition.
- Docs:
  - `packages/pi-permission-system/docs/architecture/architecture.md` — update the `token-classification.ts` line (755) to name the win32 backslash-separator shape and the `windowsSeparators` option on `classifyTokenAsRuleCandidate`; update the `path-normalizer.ts` line (743) to list `usesWindowsSeparators`; add the win32 backslash recognition to the `bash-path-resolver.ts` line (753) `projectRuleCandidates` note.
    Leave the Phase 9 "swept and out of scope" listing (line 868) intact — it is a historical scope record for that phase.
  - `.pi/skills/package-pi-permission-system/SKILL.md` — the "Notes for Agents" bash-classifier paragraph states the accepted shapes and that "The broader classifier also recognizes the backslash drive form (`D:\…`)"; add that on win32 a backslash-relative token (`dir\file`) is also recognized as a `path`-surface candidate (gated the same as `dir/file`), decided by `PathNormalizer.usesWindowsSeparators()`, while on POSIX `dir\file` stays bare.
    Add a matching bullet to the "Windows and Git Bash" section (the drive-letter/case-fold facts) noting the backslash-relative `path`-surface recognition.
  - `packages/pi-permission-system/docs/configuration.md` — extend the `path`-surface note (around line 363) to add that on Windows a backslash-relative bash argument (`cat dir\file`) is gated by a `path` rule the same as its forward-slash equivalent (`dir/file`).

No test-fixture change is required: the new classifier parameter is optional (existing callers and fakes are source-compatible), and `usesWindowsSeparators` lands with its sole consumer (the resolver), so no interface widening breaks any fake and no export is added without a caller.
No file listed here is claimed as unchanged in Non-Goals; the strict classifier, the promoted classifier, and the config schema are genuinely untouched.

## Test Impact Analysis

1. **New tests enabled by this change:**
   - `classifyTokenAsRuleCandidate` (pure): `dir\file` with `{ windowsSeparators: true }` → returned; the same token with no option (and with `{ windowsSeparators: false }`) → `null`; a backslash regex-metachar token (`a\|b`) → `null` even under the flag (the reject prelude still fires); a backslash traversal (`..\x`) → returned regardless (already via `includes("..")`).
   - `PathNormalizer.usesWindowsSeparators()`: `true` for an injected `win32` normalizer, `false` for `posix`/`linux`.
   - `BashProgram.parse` / `BashPathResolver`: with a `win32` normalizer, `cat dir\file` yields a rule candidate whose `matchValues()` equal those of `cat dir/file` (parity); with a `posix` normalizer, `cat dir\file` yields no rule candidate (POSIX guard).
2. **Redundant tests:** none.
   The existing `classifyTokenAsRuleCandidate` tests assert the current shape acceptances with no option and stay valid — the backslash recognition is an additive, flag-gated branch.
3. **Tests that must stay as-is:** the existing `token-classification`, `program` (including the win32-projection describe block), and `bash-path` gate tests exercising the `#393`/`#418`/`#533` invariants — they pin the unchanged resolution path.

## Invariants at risk

This change touches `token-classification.ts` (extracted [#475], drive-letter branch [#508]), `bash-path-resolver.ts` (cd-projection [#475], canonical matching [#418], `#393` unknown-base rule), and `path-normalizer.ts` (platform seam [#510], [#533]).
The invariants that must not regress, and their pins:

- **POSIX behavior is preserved** — `dir\file` stays a bare token on POSIX and is not treated as a path.
  Pinned by a new `BashProgram.parse` test with a `posix` normalizer asserting no rule candidate, plus the existing default-platform resolver tests.
- **Default classifier behavior is unchanged** — `classifyTokenAsRuleCandidate(token)` with no option matches every current result.
  Pinned by the existing token-classification suite (all no-option calls) plus a new explicit no-option `dir\file` → `null` case.
- **`#533` MSYS interpretation is untouched** — a win32 POSIX-absolute (`/tmp/foo`) still resolves literal-only; a drive-mount (`/c/x`) still translates.
  Preserved structurally (the backslash branch only widens the *relative* shape gate; recognized tokens use the unchanged `forBashToken`), and covered by the existing win32-projection tests in `program.test.ts`.
- **`#418` canonical/lexical alias parity** — a recognized backslash token resolves through the same `forBashToken`/`matchValues` path as `dir/file`.
  Pinned by the new parity assertion (`dir\file` matchValues equal `dir/file` matchValues under a win32 normalizer).

## TDD Order

Numbered red→green→commit cycles.
The classifier parameter is optional and the normalizer accessor lands with its consumer, so no step breaks a fake at the type level.

1. **Classifier backslash branch (pure).**
   Test `classifyTokenAsRuleCandidate`: `dir\file` accepted under `{ windowsSeparators: true }`, rejected with no option / `{ windowsSeparators: false }`, still rejected for a backslash regex-metachar token under the flag, and a backslash traversal accepted regardless.
   Add the `RuleCandidateOptions` interface and the optional `options` parameter with the `windowsSeparators`-gated branch; update the module/function doc comments.
   Commit: `feat(pi-permission-system): recognize win32 backslash-relative path tokens`.

2. **Normalizer accessor + resolver wiring.**
   Test `PathNormalizer.usesWindowsSeparators()` (`win32` → true, `posix` → false) and, via `BashProgram.parse` (win32-projection describe block), that `cat dir\file` yields a rule candidate whose `matchValues()` equal `cat dir/file`'s, while a `posix` normalizer yields no candidate.
   Add `usesWindowsSeparators()` to `PathNormalizer` and wire it into `projectRuleCandidates`; refresh the resolver doc comment. (The accessor lands with its sole consumer, so `pnpm fallow dead-code` stays clean.) Commit: `feat(pi-permission-system): gate win32 backslash-relative bash args via path rules`.

3. **End-to-end bash-path gate repro.**
   Test in `bash-path.test.ts` (injecting a `win32` `PathNormalizer`) that with a `path` rule `"dir/file": "deny"`, a bash `cat dir\file` resolves to deny (the issue's win32 repro), while the same command on a `posix` normalizer is unaffected.
   Commit: `test(pi-permission-system): cover win32 backslash-relative path gating end to end`.

4. **Docs.**
   Update `architecture.md`, the package `SKILL.md`, and `configuration.md` per Module-Level Changes.
   Commit: `docs(pi-permission-system): document win32 backslash-relative path recognition`.

## Risks and Mitigations

- **A backslash-containing non-path token on win32 (e.g. a `\d`-style regex fragment)** could be treated as a path candidate under the flag.
  Mitigated by the shared `rejectNonPathToken` prelude (which already refuses the common regex-metachar shapes `\|`, `\(`, `\)`) and by the fail-safe direction: an unintended recognition can only *add* a prompt against a matching `path` rule, never silently allow.
  This mirrors the accepted fail-safe scope of [#509].
- **Windows fold divergence** — the classifier recognizing a token the later path-surface match would not gate.
  Mitigated because a recognized backslash token resolves through the unchanged `forBashToken` and `pathMatchOptions` fold, and the parity test asserts `dir\file` and `dir/file` produce identical `matchValues()` under a win32 normalizer.
- **POSIX regression** — accidentally recognizing backslash on POSIX.
  Mitigated by gating the branch strictly on the normalizer's `usesWindowsSeparators()` and pinning the POSIX guard with a `posix`-normalizer resolver test.

## Open Questions

None.
The design reuses the established `windowsSeparators` option convention and the `PathNormalizer` platform seam; no follow-up work is deferred.

[#418]: https://github.com/gotgenes/pi-packages/issues/418
[#475]: https://github.com/gotgenes/pi-packages/issues/475
[#508]: https://github.com/gotgenes/pi-packages/issues/508
[#509]: https://github.com/gotgenes/pi-packages/issues/509
[#510]: https://github.com/gotgenes/pi-packages/issues/510
[#511]: https://github.com/gotgenes/pi-packages/issues/511
[#513]: https://github.com/gotgenes/pi-packages/issues/513
[#520]: https://github.com/gotgenes/pi-packages/issues/520
[#533]: https://github.com/gotgenes/pi-packages/issues/533
