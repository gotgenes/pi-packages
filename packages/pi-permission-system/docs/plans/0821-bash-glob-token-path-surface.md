---
issue: 821
issue_title: "pi-permission-system: bracket-glob path arguments bypass the external_directory gate"
---

# Project glob-bearing bash path tokens to the path surfaces

## Release Recommendation

**Release:** ship independently

Issue [#821] is not a step in the Phase 14 roadmap — it is a third-party fail-open report against `access-intent/bash/token-classification.ts`, a file no Phase 14 step names.
Its disposition is recorded in the roadmap's `#### Open-issue sweep dispositions` list as out of scope for the roadmap, fixed independently.
The fix is a `fix:` commit and cuts its own release.

## Problem Statement

`rejectNonPathToken()` — the shared prelude of all three bash token classifiers — tests every token against `REGEX_METACHAR_PATTERN` (`.*`, `.+`, `\|`, `\(`, `\)`, `[...]`, `^/`) **before** any shape classifier runs.
A path-shaped token that happens to contain one of those sequences is therefore discarded before the `external_directory` and `path` surfaces ever see it.

The reporter's case is the bracket form, but the `.*` alternative drops ordinary shell globs the same way.
Measured against the current code (spike run on `BashProgram`, cwd = repo root, reverted afterwards):

| Command               | `externalAccesses()` today |
| --------------------- | -------------------------- |
| `cat /etc/passwd`     | `["/etc/passwd"]`          |
| `cat /etc/pa?sword`   | `["/etc/pa?sword"]`        |
| `cat /etc/*.conf`     | `["/etc/*.conf"]`          |
| `cat /etc/[p]asswd`   | `[]`                       |
| `ls /et[c]/pa*`       | `[]`                       |
| `cat ~/.ssh/[i]d_rsa` | `[]`                       |
| `rm -rf /tmp/tmp.*`   | `[]`                       |

The gate fails open: the command executes with no prompt, and `rm -rf /tmp/tmp.*` deletes files outside the working tree unseen.
This is a violation of the completeness contract in `docs/decisions/0009-bash-path-projection-completeness-contract.md`, whose layering principle is that **over-suppression is unrecoverable and over-surfacing is recoverable** — the projection's job is to surface, and the judge layer's job is to dismiss.

The heuristic entered the code in `9eab66cf` ("skip regex patterns in bash external-directory path extraction") to quiet `grep -v "//.*glob\|globalConfig"` prompts.
Plan `0091` then made token collection **command-aware** (`PATTERN_FIRST_COMMANDS` in `token-collection.ts`), which skips a pattern-first command's inline pattern/script positional outright.
Re-running that commit's own test corpus with the heuristic fully removed produces **byte-identical** projections for every case, so the heuristic is no longer doing the work it was introduced for — it is only failing open.

## Goals

- A path-shaped bash token is never discarded for containing glob or regex metacharacters; it reaches the `path` and `external_directory` surfaces like any other token.
- The issue's repro (`cat /etc/[p]asswd`, `ls /et[c]/pa*`) prompts exactly as `cat /etc/pa?sword` does today.
- The prompt-noise property the deleted heuristic once provided is pinned to the mechanism that actually provides it now (pattern-first collection), so the deletion cannot be read as a regression later.
- ADR 0009 records the new boundary: glob metacharacters are shell syntax, not evidence against path-hood, and a glob token is gated by its **literal** text.
- Non-breaking: measured over 3995 deduplicated real bash commands, exactly **2** newly surface an external path, and both are true positives.

## Non-Goals

- **Glob expansion.**
  Gating a token by what it expands to — rather than by its literal text — is [#822], deferred to a later phase (recorded in the roadmap sweep list).
  The residual it leaves is stated under Risks: an explicit rule pattern is matched against the token's spelling, so `path: {".env": "deny"}` still does not match the token `[.]env`.
- **Changing `*` / `?` handling.**
  Those tokens already reach the surfaces; this change brings the bracket and `.*` forms to parity with them, nothing more.
- **Per-command option tables.**
  ADR 0009 rejects them as a deterministic-layer mechanism, and nothing here revisits that.
- **The structured bash surface** ([#804]) and **the sandbox seam** ([#802] / [#686]) — both would reshape this projection wholesale and are Phase 15 candidates.
- **`src/access-intent/bash/token-collection.ts`.** `PATTERN_FIRST_COMMANDS` is the mechanism this change leans on; it is read and pinned, not modified.

## Background

### The module under change

`src/access-intent/bash/token-classification.ts` exports three pure classifiers and one private prelude:

- `classifyTokenAsPathCandidate(token)` — strict gate for the external-directory guard: accepts a leading `/`, a leading `~/`, a token containing `..`, or a Windows drive-letter path.
- `classifyTokenAsRuleCandidate(token, flavor)` — broader gate for the cross-cutting `path` rules: also accepts a leading `.`, any token carrying a separator under `flavor`, and the backslash-only drive form.
- `classifyBareTokenCandidate(token)` — prelude-only gate whose survivors the resolver settles with the filesystem existence probe ([#645]).
- `rejectNonPathToken(token)` — the shared prelude: empty token, leading `-` flag, env assignment, URL, `@scope` package, and the regex-metacharacter test this change deletes.

### Constraints from AGENTS.md and the package skill

- The classifiers are **policy-free** (ADR 0009): candidacy comes from shape and the filesystem, never from the ruleset.
  Nothing here changes that.
- Wildcard matching must be explicit and tested; silent over-matching is a permission bypass — so is silent *dropping*, which is what this fixes.
- No `process.platform` read may enter `src/`; the win32 bit stays behind `PathFlavor`.
- The Edit tool's atomic-batch rules apply to the four test sites this change edits: they are per-token rewrites, not a uniform `null` → token substitution (see Design Overview).

### Measurement instrument

The numbers below come from a disposable spike over `~/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl` — 3995 deduplicated real bash commands — projecting each through `BashProgram.parse` with cwd = repo root, once on `main` and once with the branch under test.
The spike files were deleted; the working tree carried no source change out of planning.

## Design Overview

### The decision

Delete `REGEX_METACHAR_PATTERN` and its branch in `rejectNonPathToken`.
The prelude keeps its other five rejections, each of which rules out a path by **syntax** rather than by guessing intent:

```typescript
function rejectNonPathToken(token: string): boolean {
  if (!token) return true;
  if (token.startsWith("-")) return true;
  // env assignment: FOO=/bar
  // URL: https://…
  // @scope/package
  return false;
}
```

The reasoning is ADR 0009's own three-valued classification.
A regex and a shell glob are textually indistinguishable — `[a-z]` is both, and `foo.*` is a valid glob for `foo.txt` as well as a regex — so "contains a metacharacter" cannot decide path-hood.
What *can* decide it is the token's **position**: a pattern-first command's inline pattern positional is not an operand, and `PATTERN_FIRST_COMMANDS` already skips it at collection time.
Position is knowable from the parse tree; intent is not.

Once the token survives the prelude, it is gated by its **literal** text, exactly as `/etc/pa?sword` and `/etc/*.conf` are today: the boundary decision resolves the literal against the effective working directory, so `/etc/[p]asswd` resolves outside the tree and prompts.

### Measured effect of the deletion

Over the 3995-command corpus (all figures **measured**):

| Slice                                             | Before | After | Delta                                                 |
| ------------------------------------------------- | ------ | ----- | ----------------------------------------------------- |
| Commands whose `externalAccesses()` set changes   | —      | —     | 2 (`rm -rf /tmp/tmp.*`, `rm -rf /var/…/T/tmp.*`)      |
| Commands with ≥1 external access                  | 3704   | 3707  | +3 (2 changed sets, plus corpus drift during the run) |
| Commands whose `pathRuleCandidates()` set changes | —      | —     | 66 (1.65%)                                            |
| Total rule candidates                             | 8572   | 8651  | +79 (+0.9%)                                           |

The two newly-surfaced external accesses are true positives.
The 66 changed rule-candidate sets are `jq` filters (`.tree[].path`), `sed` scripts, and long prose strings pasted as arguments; each produces a decision only when an **explicit** `path` rule matches it, since ADR 0009's universal-fallback exclusion leaves an unmatched candidate unrestricted.

The heuristic's own motivating cases were re-measured with it deleted and are unchanged:

| Command                                                                                 | `externalAccesses()` / `pathRuleCandidates()` before and after |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `grep -n "glob" src/foo.ts 2>/dev/null \| grep -v "//.*glob\|globalConfig" \| head -30` | `[]` / `["src/foo.ts", "/dev/null"]`                           |
| `grep -v "//.*foo" file.txt`                                                            | `[]` / `[]`                                                    |
| `grep "foo\|bar\|baz" src/file.ts`                                                      | `[]` / `["src/file.ts"]`                                       |
| `grep -E "^/usr/bin" file.txt`                                                          | `[]` / `[]`                                                    |
| `sed "s/foo.*/bar/g" file.txt`                                                          | `[]` / `[]`                                                    |
| `awk "/\/etc\/.*/" file.txt`                                                            | `[]` / `[]`                                                    |
| `rg "^src/.*\.ts$" -l`                                                                  | `[]` / `[]`                                                    |
| `grep -v "//.*pattern" /etc/hosts`                                                      | `["/etc/hosts"]` / `["/etc/hosts"]`                            |

### Per-token effect on the existing assertions

The Tidy-First assessor traced each existing fixture through the acceptance gates after the deletion.
The four sites do **not** invert uniformly, and a scripted `null` → token substitution across them would write two wrong assertions:

| Site                                                    | After the deletion                                                                                                                                                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `classifyTokenAsPathCandidate` prelude block (line 61)  | All six fixtures (`foo.*`, `bar.+`, `a\|b`, `\(group\)`, `[abc]`, `^/start`) still return `null` — none is path-shaped, so the *acceptance gate* rejects them instead of the prelude. Only the rationale comment goes stale. |
| `classifyTokenAsRuleCandidate` prelude block (line 208) | Four fixtures still return `null`; `"^/start"` flips to `"^/start"`, because it carries a `/` and `flavor.hasPathSeparator` accepts it.                                                                                      |
| win32 backslash test (line 333)                         | Both fixtures flip: `"a\|b"` and `"\(group\)"` carry a literal `\`, which the win32 flavor counts as a separator, so `classifyTokenAsRuleCandidate(…, win32PathFlavor)` now returns them.                                    |
| `classifyBareTokenCandidate` prelude block (line 438)   | All fixtures flip — this classifier has no acceptance gate beyond the prelude.                                                                                                                                               |

The assessor recommended **no** preparatory refactoring: the source change is a two-line deletion plus two doc-comment edits, and the test file is already organized one `describe` block per classifier.
It explicitly rejected unifying the three near-identical prelude blocks into one parametrized table, because the classifiers' acceptance gates differ, so a shared table would need a per-classifier expected column — the same three blocks with extra indirection.

## Module-Level Changes

### `src/access-intent/bash/token-classification.ts`

- Delete the `REGEX_METACHAR_PATTERN` constant (line 145) and its doc comment.
- Delete the `if (REGEX_METACHAR_PATTERN.test(token)) return true;` branch in `rejectNonPathToken` (line 175).
- Module docstring (line 19): "captures the six rejection cases common to them" → five, and name the reason the sixth is gone (position, via `PATTERN_FIRST_COMMANDS`, decides a pattern argument — not spelling).
- `classifyBareTokenCandidate` docstring (line 109): drop "or regex-shaped token" from the list of shapes the prelude rules out.
- `rejectNonPathToken` docstring: drop "and regex metacharacter sequences" from the rejection list, and add a sentence stating that a glob metacharacter is shell syntax and never disqualifies a token ([#821]).

No exported symbol is added, removed, or renamed, so no importer changes.
A grep for `REGEX_METACHAR` across `src/`, `test/`, `docs/`, and `.pi/skills/` finds it only in this module and in `test/access-intent/bash/token-classification.test.ts`; `docs/architecture/architecture.md`'s module-tree entry for this file (line 846) describes the three classifiers and the policy-free constraint without mentioning the prelude's contents, so it needs no edit.

### `test/access-intent/bash/token-classification.test.ts`

- Rewrite the three `test("regex metacharacters → null")` blocks (lines 61, 208, 438) per the per-token table above, retitling each to describe what it now pins.
- Rewrite the win32 test at line 333 ("backslash regex-metacharacter token still rejected under the win32 flavor") to its inverted expectation and a matching name.
- Add acceptance cases for glob-bearing path-shaped tokens: `/etc/[p]asswd`, `/tmp/tmp.*`, `~/.ssh/[i]d_rsa`, `../[e]tc/passwd` (strict classifier); `src/[s]ecret.env`, `.[e]nv` (rule classifier); `[a]bc` (bare classifier).
- Leave the `#520` backslash-relative block (lines 320–331) untouched — it is the win32 invariant and must keep passing unchanged.

### `test/bash-external-directory.test.ts`

- Retitle the `describe("regex patterns are not mistaken for paths")` block (line 796, six tests) to name pattern-first collection as the mechanism that keeps them clean, and add the two commands from the deleted heuristic's original scope that the block does not yet cover (`awk "/\/etc\/.*/" file.txt`, `rg "^src/.*\.ts$" -l`).
- Add gate-level cases for the issue's repro: `cat /etc/[p]asswd` and `ls /et[c]/pa*` yield the token, and `rm -rf /tmp/tmp.*` yields `/tmp/tmp.*`.

### `test/access-intent/bash/program.test.ts`

- Add end-to-end projection cases: a glob-bearing external token appears in `externalAccesses()`, and a glob-bearing in-tree token (`src/[s]ecret.env`) appears in `pathRuleCandidates()`.

### `docs/decisions/0009-bash-path-projection-completeness-contract.md`

- Frontmatter gains `amended: <date>`; the Status line becomes "Accepted, as amended `<date>`."
- New `### Amendment, <date> — glob metacharacters are shell syntax, not regex evidence` section under Status, recording: the three-valued classification's *definitely not a path* branch drops "a regex"; position (pattern-first collection), not spelling, decides that a pattern argument is not an operand; and a glob token is gated by its literal text.
- The three-valued bullet list in Context loses ", a regex" from the *definitely not a path* item.
- The "What the projection deliberately omits" list gains a **glob expansion** residual: a glob token is gated by its literal text, so the containment boundary sees it but an explicit rule pattern is matched against the token's spelling rather than its expansion ([#822]).
- Consequences gains a bullet: [#821] is the third report triaged against the contract and landed **inside** it — a guarantee (a shape-classified token reaches the surfaces) was met inconsistently, this time depending on which metacharacters the token happened to contain.
- Add `[#821]:` and `[#822]:` reference definitions.

## Test Impact Analysis

1. **What the change makes newly testable.**
   Nothing structurally — the classifiers are already unit-tested per export.
   What becomes assertable is the *positive* property that has never had a test: a path-shaped token carrying a glob is returned by each classifier, and reaches `externalAccesses()` end to end.
2. **What becomes redundant.**
   No test is removed.
   The three prelude blocks keep their fixtures; two of them keep their expectations for a different (and now correct) reason, which the retitled names must state so the next reader does not think they still pin the deleted heuristic.
3. **What must stay as-is.**
   - The `#520` win32 backslash-relative acceptance/rejection pair (lines 320–331).
   - The bare-`/` filesystem-root cases ([#583]).
   - The URL, `@scope`, env-assignment, and flag prelude blocks — the five retained rejections.
   - The `regex patterns are not mistaken for paths` block's assertions in `test/bash-external-directory.test.ts`: verified by spike to stay green on pattern-first collection alone.
4. **Input-domain coverage for the classifier change.**
   The classifier is a matcher, so its testable surface is the input domain rather than the cases one can picture.
   The 3995-command corpus was run as that domain; the diff it produced (2 external, 66 rule-candidate) is enumerated above and is what the new tests sample.

## Invariants at risk

| Invariant                                                                | Source                  | Pinned by                                                                                                                                                                                         |
| ------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A regex argument of a pattern-first command produces no path candidate   | `9eab66cf`, plan `0091` | `test/bash-external-directory.test.ts`'s retitled block, extended with the `awk` and `rg` cases (TDD step 1) — a currently-green characterization pin landed **before** the deletion              |
| A win32 backslash-relative token is a rule candidate; a POSIX one is not | [#520]                  | `test/access-intent/bash/token-classification.test.ts` lines 320–331, untouched                                                                                                                   |
| A bare `/` reaches the path surfaces                                     | [#583]                  | The bare-slash acceptance test, untouched                                                                                                                                                         |
| A bare token is admitted only by the filesystem existence probe          | [#645], ADR 0009        | `probeBareToken` tests; the prelude change widens the probe's input by +79 tokens over 3995 commands (measured), one `lstat` each, which is within the ~0.04 ms p95 the ADR records for the probe |
| The classifiers consult no ruleset                                       | ADR 0009                | The change deletes a branch and adds no input; no classifier signature changes                                                                                                                    |

## TDD Order

1. **Pin the noise property to the mechanism that provides it.**
   `test/bash-external-directory.test.ts`: retitle `regex patterns are not mistaken for paths` to credit pattern-first collection, and add the `awk "/\/etc\/.*/" file.txt` and `rg "^src/.*\.ts$" -l` cases.
   Green before and after the deletion — this is the characterization net the next step relies on, so it lands first.
   `test(pi-permission-system): pin regex-argument suppression to pattern-first collection`

2. **Glob-bearing path tokens reach the path surfaces.**
   Red first: the new classifier acceptance cases, the `program.test.ts` end-to-end cases, and the gate-level repro cases in `test/bash-external-directory.test.ts`.
   Green: delete `REGEX_METACHAR_PATTERN` and its prelude branch, reword the two docstrings, and rewrite the four existing assertion sites per the per-token table (path-candidate block: comment only; rule-candidate block: `^/start` alone; win32 test: both fixtures; bare-token block: all).
   Verify `pnpm --filter @gotgenes/pi-permission-system run test` in full, not only the two edited files.
   `fix(pi-permission-system): project glob-bearing bash path tokens to the path surfaces (#821)`

3. **Record the boundary.**
   The ADR 0009 amendment (frontmatter, Status, amendment section, the Context bullet, the glob residual, the Consequences bullet, the two reference definitions).
   `docs(pi-permission-system): amend ADR 0009 for glob-bearing path tokens (#821)`

## Risks and Mitigations

- **Prompt noise on the `path` surface.**
  66 of 3995 real commands (1.65%) gain a rule candidate — `jq` filters, `sed` scripts, pasted prose.
  Mitigation: a candidate matching no explicit rule is unrestricted by construction (ADR 0009's universal-fallback exclusion), so the noise is invisible under a config with no explicit `path` rules; under one with them, ADR 0009's layering principle applies — an unnecessary prompt is recoverable, a dropped operand is not.
  This class of noise already exists (a `jq` filter without brackets is a rule candidate today); the change removes an inconsistency rather than opening a new kind.
- **Newly surfaced external prompts.**
  2 of 3995 (0.05%), both true positives (`rm -rf /tmp/tmp.*`).
  Mitigation: none needed; this is the fix.
  It is a behavior change on upgrade, but too small and too clearly-correct to warrant a breaking bump — the commit is `fix:`, not `fix!:`.
- **Residual: rule patterns match spelling, not expansion.**
  `path: {".env": "deny"}` still does not match the token `[.]env`.
  Mitigation: filed as [#822] and recorded as an ADR 0009 residual in step 3, so the next report on it is triaged rather than re-diagnosed.
  Note this is not a regression — `cat [.]env` produced no candidate at all before.
- **A scripted rewrite of the four assertion sites writing wrong expectations.**
  Mitigation: the per-token table in Design Overview is the authority; each site is edited by hand and the full package suite is run, not just the two files a grep would match.

## Open Questions

- Whether a glob that matches nothing should surface its literal (today's behavior, preserved here) or nothing at all is part of [#822]'s design, not this change.

[#520]: https://github.com/gotgenes/pi-packages/issues/520
[#583]: https://github.com/gotgenes/pi-packages/issues/583
[#645]: https://github.com/gotgenes/pi-packages/issues/645
[#686]: https://github.com/gotgenes/pi-packages/issues/686
[#802]: https://github.com/gotgenes/pi-packages/issues/802
[#804]: https://github.com/gotgenes/pi-packages/issues/804
[#821]: https://github.com/gotgenes/pi-packages/issues/821
[#822]: https://github.com/gotgenes/pi-packages/issues/822
