---
issue: 823
issue_title: "pi-permission-system: a pattern-first command's flag bookkeeping drops the real file operand"
---

# Recognize every flag spelling a pattern-first command accepts

## Release Recommendation

**Release:** ship independently

Issue [#823] is not a step in the Phase 14 roadmap.
Its disposition is already recorded in the roadmap's `#### Open-issue sweep dispositions` list as "out of scope for the roadmap and fixed independently, next (explicit user decision)".
The fix is a `fix:` commit against `access-intent/bash/token-collection.ts`, a file no Phase 14 step names, and cuts its own release.

## Problem Statement

`collectPatternCommandTokens` (`src/access-intent/bash/token-collection.ts`) walks a pattern-first command's arguments carrying two facts: whether a flag consumed the next argument, and whether the inline pattern positional is still expected (`hasExplicitScript`).
Both are maintained by exact-matching a flag word against the **short** spellings in `PATTERN_FIRST_COMMANDS`, and the consumption is discharged only on a node in `ARG_NODE_TYPES`.

Three spellings defeat that bookkeeping, and each ends the same way: the walker still expects an inline pattern, so it skips the command's **real file operand** as though it were the pattern, and the path reaches neither the `path` nor the `external_directory` surface.

Measured against `main` (spike over `BashProgram`, cwd = repo root, reverted afterwards):

| Command                                 | `externalAccesses()` on `main` |
| --------------------------------------- | ------------------------------ |
| `grep --regexp=harmless /etc/passwd`    | `[]`                           |
| `sed --expression=s/a/b/ /etc/hosts`    | `[]`                           |
| `grep -epattern /etc/passwd`            | `[]`                           |
| `grep -fpattern.txt /etc/passwd`        | `[]`                           |
| `grep -A 3 pattern /etc/passwd`         | `[]`                           |
| `grep -A $N pattern /etc/passwd`        | `[]`                           |
| `grep -A $(echo 3) pattern /etc/passwd` | `[]`                           |
| `rg -C 10 pattern /etc/passwd`          | `[]`                           |
| `sed -i 's/a/b/' /etc/hosts`            | `[]`                           |

The mechanisms:

1. **An `=`-embedded long flag** (`--regexp=`, `--expression=`, `--file=`) is not in the short-spelling sets, so it classifies as a plain flag and `hasExplicitScript` is never set.
2. **A glued short flag** (`-epattern`, `-fpattern.txt`) fails the same exact-match test, with the same result.
   This is valid GNU getopt syntax.
3. **An argument whose AST node type is outside `ARG_NODE_TYPES`.**
   The pending "skip the next argument" discharges only on a node in that set, so any other node type carries the skip onto the *next real word* — the pattern — shifting the positional count by one.
   A bare number is the everyday instance (`-A 3`, `-B 2`, `-C 10`, `-m 5`), typed `number` by tree-sitter-bash, and the mechanism is not specific to numbers: `$N` (`simple_expansion`), `${N}` (`expansion`), and `$(echo 3)` (`command_substitution`) drop the operand identically.
4. **A flag listed as consuming that does not consume on this platform.**
   Not in the issue body; found by the planning spike.
   `sed -i` is listed unconditionally, which is right for BSD (`sed -i '' 's/…/' f`) and wrong for GNU (`-i[SUFFIX]` is glued-only), so on GNU the script is eaten as the `-i` suffix and the file operand is eaten as the pattern.
   The dropped operand is a **write** target.
   The package already pins this as a green characterization test in `test/bash-external-directory.test.ts`'s `describe("known limitations")` block, whose own comment says "so a future fix can flip this expectation".

Two milder variants of the same root cause round out the scope:

- `grep --file /tmp/patterns /etc/passwd` surfaces `/etc/passwd` but loses `/tmp/patterns`, since the long form is not recognized as file-consuming.
- In the opposite direction, `collectEmbeddedOptionValues` splits every `-{1,2}name=value` token with no flag-role awareness, so a pattern flag's value is emitted as a path candidate: `grep --regexp=/etc/passwd file.txt` yields a false positive.

## Goals

- A pattern-first command's flag bookkeeping recognizes the spellings the tools actually accept: `--regexp=PATTERN`, `--regexp PATTERN`, `-epattern`, and `-e PATTERN` all mark the script as supplied and contribute no path candidate; `--file=FILE`, `--file FILE`, `-fFILE`, and `-f FILE` all mark the script as supplied **and** contribute `FILE`.
- A pending flag-argument consumption discharges on whatever node type tree-sitter gives the following argument — a number, a variable expansion, or a command substitution.
- Every remaining positional is a file operand and reaches the `path` and `external_directory` surfaces.
- A recognized pattern flag's `=`-embedded value is no longer emitted as a path candidate.
- `sed -i` consumes a following argument only when that argument is empty, so the BSD (`-i ''`) and GNU (`-i`, `-i.bak`) spellings both surface the file operand.
- The change is non-breaking in the release sense (`fix:`, not `fix!:`): measured over 4057 deduplicated real bash commands, **1** command's external set changes and it gains a token; **0** tokens are lost anywhere.

## Non-Goals

- **Per-command option tables.**
  ADR 0009 rejects enumerating every option of every tool as a deterministic-layer mechanism, and this change does not revisit that.
  Only the **long forms and glued forms of short flags the table already lists** are added — the bounded amendment the issue names, and the operator's answer at the planning gate.
  No flag absent from today's table is added, with the single exception of the long spellings of the flags already present.
- **Glob-filter options** (`--include=`, `--exclude=`, `--exclude-dir=`).
  Their values keep reaching the surfaces exactly as today: `grep --exclude-dir=node_modules …` yields a `node_modules` rule candidate (measured).
  That is over-surfacing, the recoverable direction under ADR 0009's layering principle, and it is unrestricted unless an explicit `path` rule names it.
  Recorded as an ADR residual rather than turned into a mechanism (operator's answer at the planning gate).
- **GNU long-option abbreviation** (`grep --reg=x` for `--regexp=x`).
  Matching is exact-spelling; an unmatched abbreviation falls back to today's behavior, which over-surfaces rather than dropping.
  Recorded as an ADR residual.
- **`ARG_NODE_TYPES`.**
  The numeric case is fixed locally in the consumption step, not by adding `number` to the shared set — that set also feeds `commandArgumentWords` (the retraction guards) and `collectGenericCommandTokens`, so widening it would change effect attribution and generic collection for every command in the package.
- **Flag detection on quoted tokens.**
  The walker recognizes a flag only on a `word` node, so `grep '--file=/tmp/x' pattern` is still read as a positional.
  Widening it would reclassify a quoted leading-`-` *pattern* as a flag and eat the operand — the failure direction this issue exists to close.
- **`collectGenericCommandTokens`, `commandArgumentWords`, and the classifiers.**
  Untouched; candidacy stays policy-free and shape-based.
- **The structured bash surface** ([#804]) and **the sandbox seam** ([#802] / [#686]) — both would reshape this projection wholesale and are Phase 15 candidates.

## Background

### The module under change

`src/access-intent/bash/token-collection.ts` owns the AST walk that turns a `command` node into `PathToken[]`.
Relevant parts:

- `PATTERN_FIRST_COMMANDS` (lines 261–339, 79 lines) — a `Map<string, PatternCommandConfig>` with nine entries, where `grep`/`egrep`/`fgrep` and `awk`/`gawk`/`nawk` are each three **verbatim-identical** object literals.
- `PatternCommandConfig` — `argConsumingFlags: ReadonlySet<string>`, `fileConsumingFlags: ReadonlySet<string>`, optional `patternPositionals`.
- `classifyPatternCommandFlag(text, config)` — returns `end-of-flags` / `regular-flag` / `consume-arg`, deriving `setsExplicitScript` from the literal test `text === "-e" || text === "-f"`.
- `collectPatternCommandTokens(node, config, effect)` — the walk, carrying `hasExplicitScript`, `positionalsSeen`, `nextArgAction`, `pastEndOfFlags`.
- `collectEmbeddedOptionValues(node, effect)` — the `--opt=value` split ([#645]), appended by `collectCommandTokens` to **every** command's tokens, pattern-first or not.
  It has exactly one call site.

### Constraints from AGENTS.md and the package skill

- ADR 0009 is the governing record; a "the gate missed my path" report is triaged as inside the contract (a bug) or outside it (a residual).
  This one is **inside**: a shape-classified token must reach the surfaces wherever its command puts it.
- Over-suppression is unrecoverable, over-surfacing is recoverable.
  That asymmetry decides every table entry: **under**-listing a consuming flag is safe (an unrecognized spaced flag merely shifts which positional is eaten, and the last operand still survives — `rg --pre CMD pattern /etc/passwd` surfaces the file both before and after), while **over**-listing drops an operand.
  So a flag is listed as consuming only when it consumes on every supported platform.
- The bash projection is per-**token** effect-attributed since [#807]; every token this walk emits keeps the `TokenEffect` its command proved.
- No `process.platform` read may enter `src/`; nothing here reads the platform — the `sed -i` divergence is resolved by the argument's own shape, not by detecting the host's sed.

### External facts, verified

Each spelling below was verified against a real surface before being written here, per the [#807] lesson:

| Source                                                           | Verified                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `man grep` on this host (BSD grep 2.6.0-FreeBSD, GNU compatible) | `-A num, --after-context=num`; `-B num, --before-context=num`; `-C num, --context=num`; `-e pattern, --regexp=pattern`; `-f file, --file=file`; `-m num, --max-count=num`                                                                       |
| `rg --help` (ripgrep 15.2.0)                                     | `-e/--regexp`, `-f/--file`, `-A/--after-context`, `-B/--before-context`, `-C/--context`, `-m/--max-count`, `-g/--glob`, `-t/--type`, `-T/--type-not`, `-j/--threads`, `-M/--max-columns`, `-r/--replace`, `-E/--encoding` — all argument-taking |
| `sd --help` (sd v1.0.0)                                          | `-f, --flags <FLAGS>` is regex flags, **not** a script file; `-n, --max-replacements <LIMIT>`                                                                                                                                                   |
| man7 `gawk(1)`                                                   | `-F/--field-separator`, `-v/--assign`, `-f/--file`, `-e/--source`, all argument-taking; long options may be abbreviated when unique                                                                                                             |
| man7 `sed(1)` (GNU sed 4.10)                                     | `-i[SUFFIX], --in-place[=SUFFIX]` — the suffix is attached, never a separate argument; `-e script, --expression=script`; `-f script-file, --file=script-file`                                                                                   |
| `sed` usage on this host (BSD)                                   | `[-i extension]` — a separate, required argument                                                                                                                                                                                                |

### Measurement instrument

A disposable spike projected 4057 deduplicated real bash commands from `~/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl` through `BashProgram.parse` with cwd = repo root, once on `main` and once per candidate variant.
The spike files were deleted and the source change reverted; the working tree carried nothing out of planning.

## Design Overview

### Flag roles replace two sets and a literal test

`PatternCommandConfig`'s two sets collapse into one spelling-to-role map holding **short and long** spellings:

```typescript
/** What a recognized flag's argument is, for the pattern-first walker. */
type PatternFlagRole =
  /** Supplies the pattern/script inline (`-e`, `--regexp`, `--expression`, `--source`). */
  | "script"
  /** Supplies the pattern/script from a file (`-f`, `--file`) — the value is a path candidate. */
  | "script-file"
  /** Consumes a value that is neither pattern nor path (`-A`, `-C`, `-g`, `-v`, …). */
  | "value"
  /** Consumes the next argument only when it is empty — BSD `sed -i ''` vs GNU `-i[SUFFIX]`. */
  | "suffix";

interface PatternCommandConfig {
  readonly flags: ReadonlyMap<string, PatternFlagRole>;
  /** Leading positionals that are patterns/scripts, not paths. Default 1; `sd` uses 2. */
  readonly patternPositionals?: number;
}
```

`script` and `script-file` set `hasExplicitScript`; `value` and `suffix` do not.
`script-file` is the only role whose value is emitted as a token.
This also repairs a latent inconsistency: today `setsExplicitScript` is `text === "-e" || text === "-f"`, which fires for `sd -f` — `sd`'s `--flags` — and disables `sd`'s positional skipping entirely.

The table is rebuilt from named shared maps so each alias family is spelled once:

```typescript
const GREP_FLAGS = new Map<string, PatternFlagRole>([
  ["-e", "script"], ["--regexp", "script"],
  ["-f", "script-file"], ["--file", "script-file"],
  ["-A", "value"], ["--after-context", "value"],
  ["-B", "value"], ["--before-context", "value"],
  ["-C", "value"], ["--context", "value"],
  ["-m", "value"], ["--max-count", "value"],
]);
const RG_FLAGS = new Map<string, PatternFlagRole>([...GREP_FLAGS, /* rg-only entries */]);
```

`SED_FLAGS` carries `-e`/`--expression`, `-f`/`--file`, and `-i` → `"suffix"`.
`--in-place` is deliberately **absent**: GNU's long form takes its suffix with `=` and never as a separate argument, and BSD sed has no long options at all, so listing it could only over-list.
`AWK_FLAGS` carries `-e`/`--source`, `-f`/`--file`, `-F`/`--field-separator`, `-v`/`--assign`.
`SD_FLAGS` carries `-f`/`--flags` and `-n`/`--max-replacements`, both `"value"`.

### The classifier gains two match forms

```typescript
type PatternCommandFlagDirective =
  | { kind: "end-of-flags" }
  | { kind: "regular-flag" }
  | { kind: "consume-next"; role: PatternFlagRole }
  | { kind: "inline-value"; role: PatternFlagRole; value: string };
```

Match order: `--` → exact spelling (short or long) → `--name=value` where `--name` is listed → glued `-Xvalue` where `-X` is listed → `regular-flag`.

The glued form matches only the **first** short flag, which is getopt's own rule: `grep -ei pattern` really is `-e` with the value `i`.
A cluster whose argument-taking flag is not first (`grep -ie pattern /etc/passwd`) stays a `regular-flag`, which over-surfaces the pattern rather than dropping the operand — the safe direction, and unchanged from today.

### The walk

```typescript
if (pendingRole !== null) {
  const role = pendingRole;
  pendingRole = null;
  if (!isArgNode) {
    // Discharged, whatever the node type (#823). It contributes no operand
    // text of its own, but may host a nested execution (#741).
    tokens.push(...collectPathCandidateTokens(child));
    continue;
  }
  const discharge = dischargePendingConsumption(role, resolveNodeText(child), effect);
  if (discharge.token) tokens.push(discharge.token);
  if (discharge.consumed) continue;
  // Not consumed (`suffix` with a non-empty argument): fall through and read
  // this node as an ordinary argument.
}
```

`dischargePendingConsumption(role, text, effect)` returns `{ consumed, token? }`: `script-file` consumes and yields a token, `script`/`value` consume silently, and `suffix` consumes only when `text === ""`.
The `suffix` rule is what makes `sed -i` correct on both platforms without reading the host: BSD's idiom is literally `-i ''`, and a GNU `sed -i 's/…/'` never puts an empty argument there.

### The `=`-value split becomes pattern-first-aware

`collectCommandTokens` stops appending `collectEmbeddedOptionValues` for a pattern-first command; the pattern-first walker owns the split for its own command through a shared one-line helper `embeddedOptionValueToken(text, effect)` over the existing `OPTION_VALUE_PATTERN`.
It applies it to an **unrecognized** flag word and to a positional/operand token (preserving today's output for `grep '--file=/tmp/x' pattern` and for a quoted flag the walker cannot see), and **not** to a consumed flag argument or a recognized flag.
That last exclusion is the false-positive fix: `grep --regexp=/etc/passwd file.txt` no longer emits `/etc/passwd`, because `--regexp` is `script` and its value is the pattern.
`collectEmbeddedOptionValues` keeps its body and its `#645` contract, now scoped to generic commands.

### Measured effect

Over the 4057-command corpus (all figures **measured**):

| Slice                                             | Result      |
| ------------------------------------------------- | ----------- |
| Commands whose `externalAccesses()` set changes   | 1           |
| External tokens gained / lost                     | +1 / −0     |
| Commands whose `pathRuleCandidates()` set changes | 3           |
| Total rule-candidate tokens                       | 8866 → 8866 |
| Commands with ≥1 external access                  | 3836 → 3836 |

The one external change recovers `~/development/pi/pi/…/modes/interactive/*.ts` from a real `grep -rn -A 10 "…" …/*.ts` command — a true positive of exactly the reported shape.
Two of the three rule changes recover operands the same way; the third drops `!docs/plans` and `!docs/retro` from an `rg --glob` command, which are correctly suppressed as glob-filter values, not paths.

Three variants of the `sed -i` question were measured; the chosen one (`suffix`) is byte-identical to leaving `-i` alone on this corpus while additionally fixing the GNU spelling.
Dropping `-i` from the table entirely was the alternative and cost 16 extra changed rule-candidate sets, all noise from BSD `sed -i ''` scripts.

## Module-Level Changes

### `src/access-intent/bash/token-collection.ts`

- Add `PatternFlagRole`; replace `PatternCommandConfig`'s `argConsumingFlags` / `fileConsumingFlags` with `flags: ReadonlyMap<string, PatternFlagRole>`.
- Replace the nine literal `PATTERN_FIRST_COMMANDS` entries with references to `SED_FLAGS`, `AWK_FLAGS`, `GREP_FLAGS`, `RG_FLAGS`, `SD_FLAGS`.
- Extend `PatternCommandFlagDirective` to four arms (`consume-next`, `inline-value` replace `consume-arg`); its doc comment's "Biome/ESLint assertion conflict" rationale still holds and needs only the arm names refreshed.
- Extend `classifyPatternCommandFlag` with the `--name=value` and glued `-Xvalue` forms; add `LONG_OPTION_VALUE_PATTERN`.
- Extract `dischargePendingConsumption`; rename `nextArgAction` to `pendingRole`; move the pending check ahead of the `ARG_NODE_TYPES` gate and widen it to any node type.
- Add `embeddedOptionValueToken(text, effect)` beside `OPTION_VALUE_PATTERN`; call it from the pattern-first walker's `regular-flag` and positional paths.
- `collectCommandTokens`: append `collectEmbeddedOptionValues` only on the generic branch.
- Update the doc comments on `collectCommandTokens`, `collectEmbeddedOptionValues` (its "a pattern-first collector classifies a flag and never emits it" rationale changes owner), `collectPatternCommandTokens`, and `PATTERN_FIRST_COMMANDS`.

No exported symbol is added, removed, or renamed.
A grep for `argConsumingFlags` / `fileConsumingFlags` / `PatternCommandConfig` / `classifyPatternCommandFlag` across `src/`, `test/`, `docs/`, and `.pi/skills/` finds them only in this module (they are private) and in the two docs listed below.

### `test/access-intent/bash/token-collection.test.ts`

- Invert the four residual pins in `describe("long-form flags of a pattern-first command — accepted residual (#823)")` and retitle the block to name what it now guarantees.
  Its other two `it` blocks (`"suppresses the same pattern in its short-flag form"`, `"keeps the operand for every spelling the walker does track"`) stay green and stay as written.
- `describe("effect attribution")` → `"attributes a core word's read to an embedded option value"`: `grep --file=/tmp/patterns target` now emits `target` as a file operand beside `/tmp/patterns`, because `--file` marks the script supplied.
  Update the expectation to both tokens with the same `{ effect: "read", source: "core" }`.
- Add coverage for each new spelling family: long spaced (`--regexp p`, `--file /tmp/p`), long embedded (`--regexp=p`, `--file=/tmp/p`, `--expression=`, `--source=`), glued short (`-ep`, `-f/tmp/p`), the non-`ARG_NODE_TYPES` discharge (`-A 3`, `-A $N`, `-A ${N}`, `-A $(echo 3)`), `sed -i` in all three spellings, and the `sd -f`/`sd -n` roles.
- Add a pin that `--` still ends flag parsing and that a nested execution inside a consumed argument is still collected (`grep -f $(echo x) /etc/passwd`).

### `test/bash-external-directory.test.ts`

- Flip the `describe("known limitations")` GNU-`sed -i` test to assert `/etc/hosts` is detected, retitle it, and rewrite the comment to describe the `suffix` rule rather than the limitation.
  If nothing else remains in that `describe`, fold the test into the surrounding block rather than leaving an empty one.
- Add gate-level cases for the issue's repro (`grep -A 3 root /etc/passwd` yields `/etc/passwd`) and for the BSD `sed -i '' 's/…/' /etc/hosts` spelling.
- Leave `describe("regex arguments of pattern-first commands are not mistaken for paths")` (the [#821] pin) untouched and green.

### `test/access-intent/bash/program.test.ts`

- Add end-to-end projection cases: `grep -A 3 pattern /etc/passwd` appears in `externalAccesses()`, and `grep --regexp=/etc/passwd file.txt` does **not**.

### `docs/decisions/0009-bash-path-projection-completeness-contract.md`

- Frontmatter `amended:` and the Status line advance to this change's date; a new `### Amendment — a pattern-first command's flag spellings` section under Status records the boundary: the table carries the long and glued forms of the flags it already lists, and nothing more; under-listing over-surfaces while over-listing drops, so a flag is listed only when it consumes on every supported platform.
- Replace the **"A pattern-first command's flag bookkeeping"** residual bullet (line ~99) in "What the projection deliberately omits" with the residuals that actually remain: GNU long-option abbreviation, a cluster whose argument-taking short flag is not first, glob-filter option values, and an unlisted argument-consuming flag — each of which over-surfaces rather than drops.
- Remove **"Glued short-option values (`-f/tmp/x`)"** from the same list — the glued form is now recognized for the listed short flags.
- Amend the [#821] Consequences bullet (line ~168), whose closing clause names this defect as unfixed.
- Add a Consequences bullet: [#823] is the fourth report triaged against the contract and landed **inside** it, with the measured corpus numbers.
- The **"Per-command argument semantics"** residual stays as written — this change adds no new command and no unlisted flag.

### `docs/architecture/architecture.md`

- Module-tree entry for `token-collection.ts` (line ~840): the `collectEmbeddedOptionValues` sentence currently says the split is read from the argument nodes "(a pattern-first collector classifies a flag and never emits it)".
  Rewrite it for the new ownership — generic commands only, with the pattern-first walker doing its own role-aware split — and state the flag-role vocabulary as the current behavior it now is.
  Cite `#823` only where it encodes an active constraint (the platform rule for listing a consuming flag).
- `#### Open-issue sweep dispositions` entry for [#823] (lines 1034–1036): update to record it as fixed, keeping the roadmap's own out-of-scope rationale.
- No health-metric, complexity, or diagram row references this file; none needs editing.

### `.pi/skills/package-pi-permission-system/SKILL.md`

- Line ~392: "An `--opt=value` token additionally has its value emitted as its own token at collection (`collectEmbeddedOptionValues`)" is now true only for a generic command.
  Rewrite for the split ownership and note that a recognized pattern flag's value is suppressed while a `--file=` value is emitted.

## Test Impact Analysis

1. **What the change makes newly testable.**
   Nothing structurally new — `collectCommandTokens` is already unit-tested black-box through `tokensOf`.
   What becomes assertable is the positive property the residual block currently pins the negation of: each spelling family reaching the operand.
   `dischargePendingConsumption` is extracted as a private helper and is deliberately **not** given its own tests; it is exercised through the walker, where the input domain lives.
2. **What becomes redundant.**
   No test is removed.
   Six existing assertions change (four inverted residual pins, one effect-attribution expectation, one `known limitations` flip); two more in the same block keep their expectations and their titles.
3. **What must stay as-is.**
   The [#821] pattern-first suppression block in `test/bash-external-directory.test.ts`; the [#741] nested-execution projection tests in `program.test.ts` and `token-collection.test.ts`; the [#645] `embedded --opt=value extraction` tests for generic commands; the [#807] effect-attribution block apart from the one expectation above.
4. **Input-domain coverage.**
   The walker is a matcher, so its testable surface is the input domain rather than the spellings one can picture.
   The 4057-command corpus was run as that domain against `main` and against the candidate, and the complete diff (1 external set, 3 rule sets) is enumerated in Design Overview.
   The corpus is macOS/BSD traffic, so the GNU-only spellings (`sed -i 's/…/'`, `--in-place=`) are covered by hand-written cases rather than by the corpus.

## Invariants at risk

| Invariant                                                                       | Source                     | Pinned by                                                                                                                                                            |
| ------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A pattern-first command's regex argument produces no path candidate             | [#821], plan `0821` step 1 | `describe("regex arguments of pattern-first commands are not mistaken for paths")` in `test/bash-external-directory.test.ts` — untouched, must stay green            |
| A nested execution's operands are projected wherever the substitution sits      | [#741]                     | `program.test.ts` redirect-/heredoc-hosted tests, and the new `grep -f $(echo x) /etc/passwd` pin — the discharge path must keep recursing a non-arg node            |
| Every token carries the `TokenEffect` its own command proved                    | [#807]                     | `describe("effect attribution")` in `token-collection.test.ts`; the new emission paths (`inline-value`, `embeddedOptionValueToken`) take the same `effect` parameter |
| An `--opt=value` path reaches the surfaces without per-command tables           | [#645]                     | `describe("embedded --opt=value extraction (#645)")` — the generic-command cases stay byte-identical                                                                 |
| The collectors consult no ruleset                                               | ADR 0009                   | The change adds no input to any collector; no signature gains a policy parameter                                                                                     |
| `--` ends flag parsing                                                          | plan `0091`                | Existing `pastEndOfFlags` behavior, plus the new explicit pin                                                                                                        |
| A `word`-only flag test keeps a quoted leading-`-` pattern out of flag position | plan `0091`                | Unchanged guard; a new pin is not added because no existing test covers it and the guard is untouched                                                                |

## TDD Order

Steps 1–3 are the Tidy-First assessor's recommended preparatory commits: each is behavior-preserving, leaves the full suite green with no test edits, and shrinks the diff of the steps that follow.

1. **`refactor(pi-permission-system): discharge a pattern-first flag argument ahead of the ARG_NODE_TYPES gate`** Move the two `nextArgAction` blocks in `collectPatternCommandTokens` above the `!ARG_NODE_TYPES.has(child.type)` early return, keeping the discharge itself gated on `ARG_NODE_TYPES` — the current bug reproduced exactly, from the new position.
   Prepares step 4, whose behavior change then becomes "drop that gate".
   Verify: full package suite green, no test edits.

2. **`refactor(pi-permission-system): extract dischargePendingConsumption from the pattern-first walker`** Pull the skip/extract arms into a named helper returning `{ consumed, token? }` (always `consumed: true` at this point), and rename `nextArgAction` to the pending vocabulary the roles will use.
   Prepares step 5's `suffix` arm, which needs a third case that answers "no, I did not consume this" — bolted into the current `continue`-shaped block it becomes the awkward fall-through the spike hit.
   Verify: full package suite green, no test edits.

3. **`refactor(pi-permission-system): deduplicate the triplicated alias entries in PATTERN_FIRST_COMMANDS`** In the **current** `Set` shape, hoist the grep/egrep/fgrep and awk/gawk/nawk flag sets into shared named constants referenced by all three aliases each.
   Prepares step 5, which then reshapes one canonical definition per family instead of six duplicated literals.
   Verify: full package suite green, no test edits.

4. **`fix(pi-permission-system): discharge a flag argument on whatever node type follows (#823)`** Red: `grep -A 3 pattern /etc/passwd`, `grep -B 2 …`, `grep -m 5 …`, `rg -C 10 …`, `grep -A $N …`, `grep -A ${N} …`, `grep -A $(echo 3) …` all yield the operand; `grep -f $(echo x) /etc/passwd` still collects the nested command's operand.
   This inverts the existing `"drops the real file operand behind a spaced numeric flag argument"` pin.
   Green: drop the `ARG_NODE_TYPES` gate on the discharge; a non-arg node discharges, emits no token of its own, and is still recursed for nested executions.
   Verify: full package suite; only that one pre-existing assertion should have needed inverting.

5. **`fix(pi-permission-system): recognize the long, embedded, and glued spellings of a pattern-first flag (#823)`** One commit, because the config reshape breaks the table, the classifier, and the walker together at the type level.
   Red: the three remaining residual pins inverted; the `sed -i` `known limitations` flip; the effect-attribution expectation; the new spelling-family cases; the `program.test.ts` end-to-end pair; the `bash-external-directory.test.ts` gate-level repros.
   Green: `PatternFlagRole`, the `flags` map and the five shared tables, the two new classifier match forms, the `inline-value` and `suffix` arms, and the pattern-first ownership of the `=`-value split.
   Verify: full package suite, `pnpm run check`, root `pnpm run lint`, `pnpm fallow dead-code`.

6. **`docs(pi-permission-system): record the pattern-first flag-spelling boundary (#823)`**
   The ADR 0009 amendment and residual rewrite, the `architecture.md` module-tree entry and sweep disposition, and the package skill's `collectEmbeddedOptionValues` sentence.

## Risks and Mitigations

- **Over-listing a flag and dropping an operand.**
  This is the failure mode that produced defect 4, and every table entry is a fresh chance at it.
  Mitigation: each spelling is verified against a real surface (the table under Background), the platform rule is written into the ADR amendment so the next editor inherits it, and the corpus run is the backstop — a dropped operand shows up as a *lost* token, and the measured loss is 0.
- **The `suffix` role reads as a one-off.**
  It exists for exactly one flag on exactly one command.
  Mitigation: it is named for what it is (a suffix argument), its doc comment states the BSD/GNU divergence and why the emptiness test is decidable where platform detection is not, and the alternative — dropping `-i` — was measured at 16 extra noisy rule-candidate sets and rejected at the planning gate.
- **The discharge widening silently swallowing a nested execution.**
  A `command_substitution` in flag-argument position is now discharged rather than falling through.
  Mitigation: the discharge path still recurses a non-arg node through `collectPathCandidateTokens`, and step 4's red set includes `grep -f $(echo x) /etc/passwd` to pin it.
- **A scripted rewrite of the six changing assertions.**
  Mitigation: they do not invert uniformly — four flip a `not.toContain` to `toContain`, one gains a second token in a `toEqual`, one flips a `toHaveLength(0)`.
  Each is edited by hand and the full package suite is run, not only the files a grep would match.
- **Prompt noise on upgrade.**
  1 of 4057 real commands newly surfaces an external path.
  Mitigation: none needed; it is the fix, and it is small enough and clearly-correct enough to ship as `fix:` rather than `fix!:` — the same call as [#821] at 2 of 3995.

## Open Questions

- Whether an unlisted argument-consuming flag should eventually be handled at all is left to the structured bash surface ([#804]) or the sandbox seam ([#802]), both of which would replace this walk.
  Nothing here depends on that answer, since the residual over-surfaces.

[#645]: https://github.com/gotgenes/pi-packages/issues/645
[#686]: https://github.com/gotgenes/pi-packages/issues/686
[#741]: https://github.com/gotgenes/pi-packages/issues/741
[#802]: https://github.com/gotgenes/pi-packages/issues/802
[#804]: https://github.com/gotgenes/pi-packages/issues/804
[#807]: https://github.com/gotgenes/pi-packages/issues/807
[#821]: https://github.com/gotgenes/pi-packages/issues/821
