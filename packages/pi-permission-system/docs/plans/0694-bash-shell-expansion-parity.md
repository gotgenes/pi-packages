---
issue: 694
issue_title: "pi-permission-system: Bash path gates miss three variable-expanded external path forms"
---

# Resolve plain `$HOME` / `$PWD` expansions in bash path tokens

## Release Recommendation

**Release:** ship independently

Issue #694 is not a numbered step in `docs/architecture/architecture.md`'s improvement roadmap, so it carries no `Release:` batch tag.
It is a fail-open security fix on the `external_directory` gate and lands as a breaking change (`fix!:`), so it cuts a major release on its own.

## Problem Statement

Issue #694 (filed by `ThreeIce`, a third party) reports three bash tokens whose expanded form escapes the `external_directory` gate that an equivalent literal spelling triggers.
Reproduced against `main` at `2073c0af` with a session `cwd` outside `$HOME`:

| Command                          | `externalPaths` today | `pathRuleCandidates` today |
| -------------------------------- | --------------------- | -------------------------- |
| `touch "$HOME/nonexistent"`      | *(empty)*             | `/Users/chris/nonexistent` |
| `ls "$HOME"` (target exists)     | `/Users/chris`        | `/Users/chris`             |
| `ls "${HOME}"`                   | *(empty)*             | *(empty)*                  |
| `ls "${HOME}/somewhere"`         | *(empty)*             | `<cwd>/${HOME}/somewhere`  |
| `CURRENT="$HOME"; ls "$CURRENT"` | *(empty)*             | *(empty)*                  |

Three distinct defects are visible in that table.

First, `$HOME/…` is expanded by the *rule*-candidate projection but is invisible to the *external-path* projection.
`normalizePathPolicyLiteral` calls `expandHomePath`, so `AccessPath` resolves `$HOME/x` to the real home path — but `classifyTokenAsPathCandidate` does not recognize the `$HOME` shape, so the strict gate never accepts the token.
It reaches `external_directory` only when the `#645` existence probe rescues it, which requires the target to already exist.
A new output path (`touch`, `mkdir`, a download destination, a copy destination) therefore produces no `externalPaths` entry at all.

Second, `${HOME}` is not expanded anywhere.
`expandHomePath` handles `~`, `~/`, `$HOME`, and `$HOME/` but not the braced form, so `ls "${HOME}"` yields nothing on either surface and `ls "${HOME}/somewhere"` yields a **fabricated** in-project candidate `<cwd>/${HOME}/somewhere` — a path that names nothing, displays wrongly in prompts and logs, and can match an in-project `path` rule.

Third, a literal assignment followed by a reference (`CURRENT="$HOME"; ls "$CURRENT"`) is invisible to both projections.

The framing constraint is `docs/decisions/0009-bash-path-projection-completeness-contract.md`, which lists "Computed paths (`$VAR`, `$(cmd)`, `"$HOME/x"`)" as an **accepted residual**, not a bug.
Defects one and two sit awkwardly inside that residual: the package *already* resolves `$HOME`, just inconsistently across its two projections.
Defect three is squarely inside it.

## Goals

- Resolve a plain `$HOME` / `${HOME}` reference in a bash argument token to the OS home directory before token classification, so `$HOME/x` receives the same `path` and `external_directory` decision as `~/x` and as the literal absolute spelling — **regardless of whether the target exists**.
- Resolve a plain `$PWD` / `${PWD}` reference to the base-relative form (`.`), so `$PWD/x` receives the same decision as `./x` and resolves against the `cd`-folded effective base rather than fabricating `<base>/$PWD/x`.
- Expand `${HOME}` alongside `$HOME` in `expandHomePath`, so the braced form works identically everywhere the unbraced one already does: config rule patterns, `piInfrastructureReadPaths`, and path policy literals.
- **This is a breaking change.**
  On upgrade, a bash command referencing `$HOME`/`${HOME}` newly triggers `external_directory` where it previously did not, and the token shown in prompts, logs, and derived session-approval patterns becomes the expanded path.
  Commit as `fix(pi-permission-system)!:` with a `BREAKING CHANGE:` footer.
- Amend ADR 0009 (and its ADR 0003 reconciliation sentence) so `$HOME` and `$PWD` are named, bounded exceptions to the computed-path residual rather than an undocumented inconsistency.

## Non-Goals

- **Defect three — assignment dataflow.**
  `CURRENT="$HOME"; ls "$CURRENT"` stays unresolved.
  Confirmed with the operator: the bounded same-program literal-assignment tracker was considered and declined.
  It reaches a measured 1.6% of real commands (45 of 2767 unique bash commands in the permission review log) at the cost of new stateful dataflow in the AST walk, and ADR 0009 already exists to hold exactly this kind of residual.
  No follow-up issue is filed; the ADR amendment is the durable record.
- **Conservative flooring of unresolved expansions.**
  Flooring any command carrying an unresolved-expansion path operand to `ask` was considered and declined: it would newly prompt on a measured 7.0% of real commands (194 of 2767), the prompt-firehose outcome ADR 0009 explicitly rejects for the bare-token case.
- **Widening the resolvable variable set beyond `HOME` and `PWD`.**
  No configurable environment-variable allowlist.
  `$TMPDIR`, `$USER`, `$XDG_*`, and every other name keep their literal text.
- **Parameter expansion with operators.**
  `${HOME:-/tmp}`, `${#HOME}`, `${HOME%/*}`, `${HOME/a/b}` stay unresolved — only a *plain* reference is resolved.
- **`cd` target folding for expansions.**
  `cd "$HOME" && cat x` keeps yielding an unknown base.
  This is parity with the already-conservative `cd ~`, which `literalTextOf` also rejects, and an unknown base is the fail-closed direction (relative tokens are then flagged conservatively).
  `literalTextOf` in `bash-path-resolver.ts` is untouched.
- **Command substitution.**
  `$(cmd)` and backticks stay unresolved.
- **Tool-input paths.**
  `$PWD` handling is bash-token-scoped; a `read`/`write` tool input of `$PWD/x` is unaffected (`expandHomePath` has no base to resolve `$PWD` against, and adding one would widen a shared pure helper for no reported need).

## Background

The bash path projection walks the tree-sitter AST once (`BashPathResolver.resolve`) and emits two slices: `externalPaths` (strict shape gate → `external_directory`) and `ruleCandidates` (broad shape gate → the `path` surface).
Tokens reach both from `token-collection.ts`, which resolves each argument node's "shell value" via `resolveNodeText` (`access-intent/bash/node-text.ts`).

`resolveNodeText` today returns `node.text` verbatim for `simple_expansion` (`$HOME`) and `expansion` (`${HOME}`) nodes, so the expansion's literal spelling is what every downstream consumer sees.
Expansion resolution then happens — inconsistently — much later, inside `normalizePathPolicyLiteral` → `expandHomePath`, which is a *string-prefix* matcher operating on the already-classified token.
That split is the root cause: classification runs on the unexpanded string, resolution runs on the expanded one.

Verified AST shapes (spiked against the real parser):

```text
$HOME       simple_expansion  → [ "$" (anon), variable_name "HOME" ]
${HOME}     expansion         → [ "${" (anon), variable_name "HOME", "}" (anon) ]
${HOME:-/tmp} expansion       → [ "${", variable_name "HOME", ":-" (anon), word "/tmp", "}" ]
${#HOME}    expansion         → [ "${", "#" (anon), variable_name "HOME", "}" ]
$HOME/sub   concatenation     → [ simple_expansion "$HOME", word "/sub" ]
"$HOME/sub" string            → [ '"', simple_expansion "$HOME", string_content "/sub", '"' ]
```

The plain-reference cases are structurally distinguishable from the operator cases: a plain reference has exactly one `variable_name` child and every other child is a pure delimiter (`$`, `${`, `}`).
`${HOME:-/tmp}` carries a `:-` and a `word`; `${#HOME}` carries a `#`.
This is a structural test, not a string-prefix test, so it cannot misfire on an operator form.

Constraints from `AGENTS.md` and the package skill that apply:

- The four path layers compose **most-restrictive-wins**; a `path` allow cannot suppress an `external_directory` ask.
  This is why defect one is a real fail-open: the `path` surface seeing the expanded value does not compensate for `external_directory` not seeing it.
- Do not read `process.platform` inside `src/` (ESLint-guarded).
  The new module reads neither the platform nor the path flavor — `homedir()` is platform-agnostic and `"."` is platform-free.
- `docs/decisions/` and `docs/architecture/` are **not** in the package `files` allowlist.
  A link to ADR 0009 added from the shipped `docs/configuration.md` must be an absolute GitHub URL, not a relative path.
- `pnpm fallow dead-code` gates CI, so the new module must be wired into a consumer in the same commit that introduces it.

## Design Overview

### Resolve expansions at collection, not at classification

The fix moves expansion resolution *upstream* of classification, into the one place that already turns an AST node into its shell value.
This is deliberately the same shape as the `--opt=value` split that ADR 0009 describes as "token *preprocessing*, not classification": the resolved token is then handed to the ordinary shape classifiers, existence probe, and `AccessPath` machinery, all unchanged.

The consequence is that **neither classifier needs a `$HOME` branch**.
By the time `classifyTokenAsPathCandidate` sees the token it is already `/Users/chris/nonexistent`, which its existing `startsWith("/")` branch accepts.
`token-classification.ts` is not edited at all, which keeps its documented "pure shape function, policy-free" contract intact and avoids re-encoding the home-prefix vocabulary in a third place.

### The new collaborator

```typescript
// src/access-intent/bash/shell-variable-expansion.ts

/**
 * The value of a plain `$NAME` / `${NAME}` reference the path projection
 * resolves, or `null` when the node is not a plain reference or names a
 * variable outside the resolvable set.
 */
export function resolvePlainVariableExpansion(node: TSNode): string | null;
```

The module owns two facts and nothing else: which expansion node shapes count as a plain reference, and which variable names resolve to what.

```typescript
const RESOLVABLE_VARIABLES: ReadonlyMap<string, () => string> = new Map([
  // The OS home directory, matching what `expandHomePath` already resolves
  // for `~` and `$HOME` in config patterns and path literals.
  ["HOME", homedir],
  // The shell's working directory === the projection's effective base, so the
  // base-relative marker resolves it correctly after any `cd` folding, with no
  // base parameter and no platform branch.
  ["PWD", () => "."],
]);

const PLAIN_REFERENCE_DELIMITERS: ReadonlySet<string> = new Set(["$", "${", "}"]);
```

Call site (`node-text.ts`), the only consumer:

```typescript
case "simple_expansion":
case "expansion":
  return resolvePlainVariableExpansion(node) ?? node.text;
```

Tell-Don't-Ask holds: the caller hands over the node and receives the answer, never walking children itself or asking "is this a `$HOME`?" and then acting.
Law of Demeter holds: `node-text.ts` gains no `node.child(1).text` reach-through.
Parameter type is `TSNode`, the package's own minimal AST projection (six members); the module reads `type`, `childCount`, `child()`, and a child's `type`/`text`.
Narrowing further would fragment the one AST abstraction the bash modules share, so `TSNode` is the right ISP granularity here.

### Why `$PWD` resolves to `"."` and not to a directory

`$PWD` in a bash program is the *shell's* current directory at that point, which after a current-shell `cd` is not the session `cwd`.
The projection already models exactly this as `EffectiveBase`, and already resolves relative tokens against it via `forBashToken(token, { resolveBase })`.
Rewriting `$PWD` to `.` therefore lands the token in the existing machinery with the correct semantics for free, keeps the resolver a pure function of the node (no base parameter threaded into `resolveNodeText`), and inherits the `#393` unknown-base conservatism when the base is unresolvable.
`$PWD/sub` → `./sub`, bare `$PWD` → `.`, and `cd /etc && ls "$PWD/x"` → `/etc/x`.

This also means `$PWD/…` is correctly *not* a strict external candidate (it is base-relative, like `./x`), reaching `external_directory` through the same route `./x` does.

### `${HOME}` in `expand-home.ts`

`expandHomePath` is a separate, string-prefix concern serving config rule patterns (`wildcard-matcher.ts`), `piInfrastructureReadPaths` (`path/pi-infrastructure-read.ts`), and path policy literals (`access-intent/path-normalization.ts`).
Adding the `${HOME}` prefix there is pure widening — the braced form previously matched nothing — and is what makes `"${HOME}/.cargo/*": "allow"` work as a config pattern.

```typescript
// added forms
// `${HOME}`       → homedir()
// `${HOME}/path`  → homedir()/path
// `${HOME}\path`  → homedir()\path (Windows)
```

`$PWD` is deliberately **not** added there: `expandHomePath` has no base to resolve it against, and widening a shared pure helper beyond its name is the kind of drift this plan is fixing.

### Windows

`homedir()` on win32 returns a native path (`C:\Users\x`), which `classifyTokenAsPathCandidate` accepts via `WINDOWS_DRIVE_PATH_PATTERN` and `PathNormalizer.forBashToken` routes through the `plain` branch.
Git Bash's own `$HOME` is the MSYS spelling (`/c/Users/x`), which the drive-mount branch translates to the same `C:\Users\x`, so the two agree on the location.
`$PWD` → `.` is platform-free.
No new `process.platform` read, no `PathFlavor` parameter.

### Determinism

ADR 0009 states the invariant as *same policy + same filesystem state + same command → same decision*, and its closing paragraph excludes ambient host state including environment variables, per ADR 0003.
This change makes `$HOME` and `$PWD` **named, bounded exceptions**, which the ADR amendment must state explicitly:

- `$HOME` resolves via `os.homedir()`, which the package already treats as a resolvable input in `expandHomePath` for `~` and `$HOME` in config patterns and path literals.
  This change removes an inconsistency rather than adding a concession.
- `$PWD` resolves to the projection's own effective base and reads no environment at all, so it is strictly more deterministic than `$HOME`.

Every other variable keeps its literal text, so ADR 0003's rejection of `cygpath` shell-outs and MSYS environment detection is untouched.

### Edge cases

- `${HOME:-/tmp}`, `${#HOME}`, `${HOME%/*}` — operator forms, structurally rejected, keep literal text.
- `$HOMEDIR`, `$CURRENT`, `$PATH` — outside the resolvable set, keep literal text.
- `FOO=$HOME/bar cmd` — a `variable_assignment` node, already skipped at collection and by the command enumerator's prefix stripping.
- `$HOME` inside a heredoc or comment — `SKIP_SUBTREE_TYPES` already prunes the subtree.
- `grep "$HOME" file` — `grep` is a `PATTERN_FIRST_COMMANDS` entry, so the first positional is skipped as a pattern.
- `--prefix=$HOME/.local` — `collectEmbeddedOptionValues` reads through `resolveNodeText`, so the embedded value is the expanded path.
- A project whose `cwd` is *under* `$HOME` — the expanded path is inside the working directory, so no `external_directory` prompt fires at all.
  The measured blast radius below assumes the worse case of a `cwd` outside home.

### Predicted effect

Measured on `main` at `2073c0af` with `cwd` outside `$HOME`; the "after" column is the predicted post-change projection.

| Command                          | `externalPaths` before | `externalPaths` after                                     |
| -------------------------------- | ---------------------- | --------------------------------------------------------- |
| `touch "$HOME/nonexistent"`      | *(empty)*              | `/Users/chris/nonexistent`                                |
| `ls "$HOME"`                     | `/Users/chris`         | `/Users/chris` (unchanged, no longer existence-dependent) |
| `ls "${HOME}"`                   | *(empty)*              | `/Users/chris`                                            |
| `ls "${HOME}/somewhere"`         | *(empty)*              | `/Users/chris/somewhere`                                  |
| `cat $HOME/.ssh/id_rsa` (absent) | *(empty)*              | `/Users/chris/.ssh/id_rsa`                                |
| `echo hi > $HOME/out.txt`        | *(empty)*              | `/Users/chris/out.txt`                                    |
| `CURRENT="$HOME"; ls "$CURRENT"` | *(empty)*              | *(empty)* (declined)                                      |

Upgrade blast radius, **measured** over 2767 unique real bash commands from the permission review log (`~/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl`):

- 15 commands (0.5%) contain `$HOME` or `${HOME}` — the upper bound on newly-prompting commands, before subtracting those whose `cwd` is under home.
- 1 command (0.04%) contains the braced `${HOME}`.
- 194 commands (7.0%) contain some `$VAR`/`${VAR}`; all but the 15 keep today's behavior exactly.

Cost: the change adds no filesystem call and no parse.
It adds one map lookup and a bounded child scan per expansion node, on a tree the walk already visits.

## Module-Level Changes

### Added

- `packages/pi-permission-system/src/access-intent/bash/shell-variable-expansion.ts` — new.
  Exports `resolvePlainVariableExpansion(node: TSNode): string | null`.
  Owns the plain-reference structural test and the `HOME`/`PWD` resolvable-variable map.
- `packages/pi-permission-system/test/access-intent/bash/shell-variable-expansion.test.ts` — new unit tests for the pure module.

### Changed — source

- `packages/pi-permission-system/src/access-intent/bash/node-text.ts` — the `simple_expansion` / `expansion` arm of `resolveNodeText` delegates to `resolvePlainVariableExpansion`, falling back to `node.text`.
  Update the function's doc comment, which currently documents expansion nodes as returning `.text`.
- `packages/pi-permission-system/src/expand-home.ts` — `expandHomePath` gains `${HOME}`, `${HOME}/…`, and `${HOME}\…`.
  Update the supported-forms doc comment.

Verified by grep that no export is removed or renamed, so no consumer sweep is required beyond the two files above.
`resolveNodeText`'s only importer is `token-collection.ts` (unchanged signature); `expandHomePath`'s importers are `wildcard-matcher.ts`, `access-intent/path-normalization.ts`, and `path/pi-infrastructure-read.ts` (unchanged signature).
`token-classification.ts` and `bash-path-resolver.ts` are **not** edited.

### Changed — tests

- `packages/pi-permission-system/test/access-intent/bash/node-text.test.ts` — the existing assertion `resolveNodeText(makeNode("simple_expansion", "$HOME")) === "$HOME"` inverts.
  **False-green hazard:** `makeNode` defaults to zero children, and a childless node fails the plain-reference test and falls back to `node.text`, so the existing assertion would keep passing while testing nothing.
  Rebuild these cases with realistic children (`makeNode("simple_expansion", "$HOME", [makeNode("$", "$"), makeNode("variable_name", "HOME")])`) and add an operator-form case.
- `packages/pi-permission-system/test/expand-home.test.ts` — add `${HOME}` cases mirroring the existing `$HOME` ones, plus a negative for `${HOMEDIR}`.
- `packages/pi-permission-system/test/access-intent/bash/program.test.ts` — add the issue's three repro commands as end-to-end projection assertions (two fixed, one recorded as the declined residual).
- `packages/pi-permission-system/test/handlers/gates/bash-external-directory.test.ts` — add the `touch "$HOME/<nonexistent>"` case asserting the gate prompts under `external_directory: { "*": "ask" }`.

### Changed — docs

- `packages/pi-permission-system/docs/decisions/0009-bash-path-projection-completeness-contract.md` — amend three sections:
  1. "What the projection guarantees" gains a bullet for a resolved plain `$HOME`/`${HOME}`/`$PWD`/`${PWD}` reference.
  2. The "Computed paths" residual (line 77) narrows to `$VAR` outside the resolvable set, `$(cmd)`, and assignment-then-reference, and states the declined alternatives with their measured reach (1.6% / 7.0%).
  3. "Determinism and the filesystem" (line 97) gains the two named exceptions and their rationale.
- `packages/pi-permission-system/docs/configuration.md` line 592 — the sentence "This is a best-effort heuristic — variable expansion and escaped quotes are not parsed, and relative paths inside subshells are not yet resolved against a per-subshell working directory" is now doubly stale (`cd` folding shipped in `#454`/`#393`).
  Rewrite to state what is resolved (`~`, `$HOME`, `${HOME}`, `$PWD`, `${PWD}`, `cd`-folded relative tokens) and what is not (other variables, command substitution, assignment references).
  Any ADR 0009 citation added here must be an absolute GitHub URL — `docs/decisions/` is not in the package `files` allowlist.
- `packages/pi-permission-system/docs/configuration.md` lines 109, 139, 647, 664 — extend the `~`/`$HOME` pattern-expansion prose to name `${HOME}`.
- `packages/pi-permission-system/docs/opencode-compatibility.md` line 23 — the "Home directory expansion" row names `~/` and `$HOME/`; add `${HOME}/`.
- `packages/pi-permission-system/docs/architecture/architecture.md`:
  - Line 702 — `expand-home.ts` tree entry: `~`/`$HOME`/`${HOME}`.
  - Line 727 — `node-text.ts` tree entry: `resolveNodeText` is no longer purely lexical; it resolves plain `HOME`/`PWD` expansions via the new module.
  - Add a tree entry for `shell-variable-expansion.ts` alongside its siblings.
  - Line 291 — the ADR 0009 summary sentence gains the resolved-expansion guarantee.
  - Per the architecture-doc convention, cite `#694` in a tree entry **only** on the constraint that must not drift (the resolvable-variable set is bounded to `HOME`/`PWD` by ADR 0009); keep provenance out of the tree otherwise.
- `.pi/skills/package-pi-permission-system/SKILL.md` lines 268–269 — the paragraph enumerating what `classifyTokenAsPathCandidate` accepts.
  It describes the mechanism this change reworks and carries no removed symbol, so it will not surface in a `src/` grep.
  Add that a plain `$HOME`/`${HOME}` reference is expanded before classification (so it is an absolute-shaped token) and a plain `$PWD`/`${PWD}` reference becomes base-relative.

Grep sweep performed: `\$HOME|variable expansion|environment variable` across `packages/pi-permission-system/docs/`, `README.md`, and `.pi/skills/package-pi-permission-system/SKILL.md`; `node-text|token-classification|token-collection|expand-home` across `docs/architecture/architecture.md`.
`packages/pi-permission-system/README.md` names no bash-expansion behavior, so it needs no edit.
No file listed here is claimed unchanged in Non-Goals.

## Test Impact Analysis

**New tests the change enables.**
`shell-variable-expansion.test.ts` unit-tests the plain-reference discrimination directly — previously this logic did not exist as a seam, and the operator-form rejection (`${HOME:-/tmp}`, `${#HOME}`) could only have been asserted through a full parse.
The module is pure and node-shaped, so each AST form is a one-line case.

**Tests that become redundant.**
None.
The change adds behavior to a previously identity-mapped branch; no existing assertion is subsumed.

**Tests that must stay as-is.**

- `test/path-normalization.test.ts` `$HOME` cases and `test/wildcard-matcher.test.ts` `$HOME`-pattern cases exercise `expandHomePath`'s string-prefix path, which serves config patterns and tool-input literals — a surface the AST resolver never touches.
  They must keep passing unchanged, and they are the regression guard that the `${HOME}` addition did not perturb the unbraced forms.
- `test/permission-manager-unified.test.ts` `$HOME/*` pattern-matching cases pin that a rule *pattern* spelled `$HOME/…` still matches, which is the opposite direction from token resolution and must not drift.
- The `#645` existence-probe cases in `program.test.ts` must stay green: the probe remains the mechanism for bare tokens, and `$HOME/…` merely stops depending on it.

## Invariants at Risk

| Invariant                                                                                                                | Source                                     | Pinning test                                                      | Risk                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A promoted token matching no explicit rule stays unrestricted (`matchedPattern === undefined`)                           | ADR 0009                                   | `program.test.ts` / `bash-external-directory.test.ts` probe cases | Low — the change routes `$HOME/…` through the *strict shape* gate rather than the probe, leaving the probe's guard untouched. Verify `ls "$HOME"` still yields exactly one deduplicated external path, not two. |
| Classifiers are pure shape functions that consult no ruleset                                                             | ADR 0009, `token-classification.ts` header | `token-classification.test.ts`                                    | None — the file is not edited. The new module consults no ruleset either.                                                                                                                                       |
| No `process.platform` read inside `src/` outside `index.ts`                                                              | ESLint `no-restricted-syntax`              | Lint gate                                                         | None — no platform read added.                                                                                                                                                                                  |
| `#393` unknown-base conservatism: a relative token after a non-literal `cd` stays literal-only                           | `bash-path-resolver.ts`                    | `program.test.ts` unknown-base cases                              | Low — `$HOME/x` expands to an absolute and is base-independent; `$PWD/x` becomes relative and inherits the existing conservatism. Add a case for each under an unknown base.                                    |
| `#533` win32 non-mount POSIX absolutes stay literal-only                                                                 | ADR 0003                                   | `path-normalizer.test.ts`, `program.test.ts` win32 cases          | Low — `homedir()` on win32 is a drive path, not a POSIX absolute, so the literal-only branch is not entered. Add a win32-flavor case for `$HOME/x`.                                                             |
| Cost of the projection stays negligible relative to the tree-sitter parse (ADR 0009 measured the probe at ~19% of parse) | ADR 0009                                   | none                                                              | None — the change adds zero filesystem calls and zero parses; it adds a bounded child scan on nodes already visited. No new number is claimed.                                                                  |

## TDD Order

1. **`${HOME}` in `expandHomePath`.**
   Red: extend `test/expand-home.test.ts` with `${HOME}`, `${HOME}/dev/project`, `${HOME}/dev/*`, `${HOME}\dev\project`, and a negative for `${HOMEDIR}` / `${HOME:-/tmp}`.
   Green: add the three prefix branches to `expand-home.ts` and update its doc comment.
   Non-breaking pure widening — the braced form previously matched nothing.
   Commit: `feat(pi-permission-system): expand ${HOME} alongside $HOME in path patterns`

2. **Plain-expansion resolution in bash tokens.**
   Red, in one cycle:
   - `test/access-intent/bash/shell-variable-expansion.test.ts` — `$HOME` / `${HOME}` → `homedir()`, `$PWD` / `${PWD}` → `.`, `$HOMEDIR` / `$CURRENT` / `${HOME:-/tmp}` / `${#HOME}` / a childless node → `null`.
   - `test/access-intent/bash/node-text.test.ts` — rebuild the `simple_expansion` cases with realistic children (see the false-green hazard above) and add an `expansion` case.
   - `test/access-intent/bash/program.test.ts` — the issue's repros: `touch "$HOME/<nonexistent>"` and `ls "${HOME}/somewhere"` produce the expanded external path; `ls "$HOME"` still produces exactly one; `CURRENT="$HOME"; ls "$CURRENT"` still produces none; `cd /etc && ls "$PWD/x"` resolves to `/etc/x`; a win32-flavor `$HOME/x` case; an unknown-base case for each of `$HOME/x` and `$PWD/x`.
   - `test/handlers/gates/bash-external-directory.test.ts` — `touch "$HOME/<nonexistent>"` prompts under `external_directory: { "*": "ask" }`.

   Green: add `src/access-intent/bash/shell-variable-expansion.ts` and delegate from `resolveNodeText`.
   The module and its wiring land in **one** commit: an unwired export would trip the CI `pnpm fallow dead-code` gate.
   Commit: `fix(pi-permission-system)!: resolve $HOME and $PWD expansions in bash path tokens`, with a `BREAKING CHANGE:` footer naming the remediation — an `external_directory` allow rule for the home-anchored path (e.g. `"~/.cargo/registry/*": "allow"`), the mechanism `docs/configuration.md` already documents.

3. **Docs and ADR amendment.**
   ADR 0009 (three sections), `docs/configuration.md` (line 592 rewrite plus the four `~`/`$HOME` prose sites), `docs/opencode-compatibility.md` line 23, `docs/architecture/architecture.md` (lines 291, 702, 727 plus the new tree entry), and `.pi/skills/package-pi-permission-system/SKILL.md` lines 268–269.
   Commit: `docs(pi-permission-system): record resolved shell expansions in ADR 0009 and user docs`

## Risks and Mitigations

- **New prompts on upgrade.**
  Measured upper bound is 15 of 2767 real commands (0.5%), and lower still for a project under `$HOME`.
  Mitigated by the `BREAKING CHANGE:` footer naming the `external_directory` allow-rule remediation, and framed by ADR 0009's "over-suppression is unrecoverable, over-surfacing is recoverable".
- **False green in `node-text.test.ts`.**
  A childless fake node silently falls back to `node.text`, so the inverted assertion would pass without exercising the new code.
  Mitigated by rebuilding those cases with realistic children as an explicit red step, and by the `program.test.ts` end-to-end cases which go through the real parser.
- **Displayed token changes.**
  Prompts, review-log entries, and derived session-approval patterns for a `$HOME` token now show the expanded path.
  This is an improvement — `deriveApprovalPattern` already derives from `AccessPath.value()` (the expanded form), so today the prompt says `$HOME/x` while the rule written says `/Users/chris/x*`.
  The change makes the two agree.
  Call it out in the `BREAKING CHANGE:` footer.
- **Over-resolving an operator form.**
  Mitigated by the structural plain-reference test (exactly one `variable_name` child, all others pure delimiters) rather than a string-prefix match, with explicit negative cases for `${HOME:-/tmp}` and `${#HOME}`.
- **ADR drift.**
  Amending ADR 0009's residual list is load-bearing: without it, the next "the gate missed my `$VAR`" report has no triage answer and the patch-per-report cycle the ADR was written to end resumes.
  Step 3 is not optional.
- **Third-party issue, partial resolution.**
  Defect three is declined.
  The ship comment must say so explicitly and cite the amended ADR, rather than closing #694 as if all three were fixed.

## Open Questions

- None blocking.
  The scope ladder and the resolvable-variable set were both settled with the operator before planning: home-parity only, `HOME` + `PWD`.
