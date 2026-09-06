---
issue: 863
issue_title: "pi-permission-system: a `node -e` script whose first line is a `//` comment is classified as an external_directory path, raising false asks"
---

# An interpreter's inline script is a script, not a path operand

## Release Recommendation

**Release:** ship independently

This issue is Phase 15 Step 1 in the package's architecture roadmap, tagged `Release: independent` there.
It belongs to no release batch — the `declared-effects` batch is Steps 4 and 5, and this step's relief is immediate and unconditional the moment it lands.
Both commits are `fix:`, so the release is a patch.

## Problem Statement

`node -e "<script>"` hands the token collector a program text in a flag's argument slot.
Nothing records that the token is a script, so `BashPathResolver` re-judges it by shape, and a script whose first line is a `//` comment starts with `/` — the leading-`/` branch of `classifyTokenAsPathCandidate`.
The whole program becomes one `external_directory` candidate and raises an ask for a "path" that is the script's own text.

Verified against the shipped collector and classifiers at `1f5b983c`, using the issue's own command:

```text
node -e "
// check which packages are installed
const fs = require('fs');
for (const pkg of ['pkg-a','pkg-b']) { … }
"

collected token: "// check which packages are installedconst fs = require('fs');for (const pkg of ['pkg-a','pkg-b']) {"
  classifyTokenAsPathCandidate  -> ACCEPTED    (external_directory — the reported ask)
  classifyTokenAsRuleCandidate  -> ACCEPTED    (path — the issue does not mention this)
```

Two facts the issue body does not carry, both established at planning time.

The token also reaches the broader **`path`** surface, because it contains `/`.
So this is not a `//`-shaped defect of the strict classifier: `python3 -c "# c\nprint(1)"` and `ruby -e '# x'` reach `path` with no `//` anywhere, and a fix confined to `classifyTokenAsPathCandidate` would leave half the family standing.

The newline collapse the issue observed ("line breaks collapsed by the token resolution") is a property of `tree-sitter-bash`, not of the gate.
A multi-line **double-quoted** string parses as one `string` node holding one `string_content` child per line, and `resolveNodeText` concatenates the children, so the newlines are dropped; a single-quoted `raw_string` keeps them.
This matters because it rules out the obvious alternative lever — "a token containing a newline is not a path" never fires on the reported command.

## Goals

- `node -e`, `node --eval`, `node -p`, `node --print`, `bun -e`, `bun --eval`, `bun -p`, `bun --print`, `python -c`, `python3 -c`, `perl -e`, `perl -E`, and `ruby -e` hand their inline script to the collector as a **script**, so it reaches neither the `path` nor the `external_directory` surface.
- A script *file* operand keeps its operand role: `node build.js /tmp/x` still projects both tokens.
- A command hosted inside a consumed flag argument has its own operands projected, closing an existing violation of ADR 0009's positional-invariance guarantee that this change would otherwise widen to the interpreter population.
- ADR 0009's `PATTERN_FIRST_COMMANDS` bound is amended to admit this class, since the record as written forbids adding a command the table does not name.
- The change is **not** breaking: it removes candidates that named nothing and adds candidates only for a shape with zero occurrences in 5918 real commands.

## Non-Goals

- **Flooring an interpreter's inline script to `ask`.**
  Once the script text is no longer projected, `node -e "…"` is an opaque payload in the same sense as `bash -c "…"`, and only shells are in `WrapperKind: "opaque-payload"`.
  Filed as [#886] and deferred to a later phase by the roadmap's sweep list; recorded as an accepted residual in the ADR 0009 amendment.
  Nothing is lost relative to today: `node -e 'require("/etc/passwd")'` yields the single token `require("/etc/passwd")`, which is not an `external_directory` candidate at all and does not match `path: {"/etc/*": …}` — only the universal fallback ever saw it.
- **Short-flag clusters whose script flag is not first** — `perl -i -pe 's{…}'`, `python3 -uc`, `node -pe`.
  `classifyPatternCommandFlag` reads only `text.slice(0, 2)`, so these fall through to `regular-flag` and the script stays a positional.
  Closing them needs per-character scanning with two different rules, because `node -pe X` is `-p -e X` while `perl -ne X` and `python3 -uc X` are getopt (the first argument-taking char eats the rest of the token).
  Listing `perl -p` or `node -p` as *clustered*-consuming would be over-listing, which ADR 0009 says drops a real operand — the unrecoverable direction.
  Measured: 12 of 270 interpreter inline invocations (~4.4%) — 10 `perl`, 1 `node`, 1 `python3`.
  Recorded as an ADR 0009 residual beside the existing `grep -ie pattern` one it matches exactly.
- **`deno eval`** — `eval` is a subcommand, not a flag, and `PATTERN_FIRST_COMMANDS` keys on a command basename with no subcommand vocabulary.
  Expressing it needs the recursive `subcommands` shape Step 4 ([#880]) creates.
- **`..` as a whole segment** ([#859]) — the sibling false positive, Phase 15 Step 2, its own issue.
- **A `TokenRole` on `PathToken`** — Step 3 ([#609]) owns it, and its plan may absorb these rows' `script` role into that vocabulary.
  Nothing here should anticipate its shape.
- **The `COMMAND_PREFIX_TYPES` re-spelling tidy and `bash-path-extractor.test.ts`'s duplication of `program.test.ts`** — both are Step 3's own recorded tidy-first prep.

## Background

### Where the role is lost

`collectCommandTokens` (`packages/pi-permission-system/src/access-intent/bash/token-collection.ts`) dispatches on the command basename:

```typescript
const config = commandName ? PATTERN_FIRST_COMMANDS.get(commandName) : undefined;
if (config) return collectPatternCommandTokens(node, config, effect);
return [
  ...collectGenericCommandTokens(node, effect),
  ...collectEmbeddedOptionValues(node, effect),
];
```

`node`, `bun`, `python`, `python3`, `perl`, and `ruby` are absent from the map, so their arguments go down the generic path, where every `ARG_NODE_TYPES` child is emitted as a token regardless of the flag in front of it.

The vocabulary the fix needs already exists.
`PatternFlagRole` has a `script` value — "Supplies the pattern/script inline (`grep -e`, `sed --expression`)" — whose consumption discharges as `{ consumed: true }` with no token, and `PatternCommandConfig.patternPositionals` is read as `config.patternPositionals ?? 1`, so a literal `0` is honored.
These commands are simply not in the table.

### The bound ADR 0009 draws around that table

`docs/decisions/0009-bash-path-projection-completeness-contract.md` § "Where the bound sits" names three in-scope edits (a further spelling of a listed flag, a split when one spelling has different arity, a role correction) and then forbids this one outright:

> Adding a **flag** the table does not name, or a **command** it does not name, is the per-command option table rejected below and needs its own decision.
> There is no pressure to: the direction-of-failure rule makes an omission over-surface, so an unlisted flag costs a prompt, never an operand.

Issue #863 is the counter-evidence to the second sentence: an over-surface expensive enough to be filed as a bug by a third party, and reproduced by this repo's own triage session on a read-only `git log -L` argument.
So the change needs an amendment, not just a table edit — this is the "own decision" the record asks for.

The amendment's rule for what a row may assert stands unchanged and governs every new row:

> **Under**-listing a consuming flag over-surfaces; **over**-listing drops an operand.
> So a flag is listed as consuming only when it consumes on every supported platform **and in every command that shares the entry**, verified against each tool's parser rather than against a shared spelling.

### The other half of the loss

`collectPatternCommandTokens`'s pending-consumption branch discharges a flag's argument and `continue`s without searching it for hosted executions:

```typescript
const discharge = dischargePendingConsumption(consumption, text, effect);
if (discharge.token) tokens.push(discharge.token);
if (discharge.consumed) continue;          // <- no collectHostedExecutionTokens(child)
```

The sibling `!isArgNode` branch two lines above already recurses.
Verified at `1f5b983c`:

```text
sed -e "$(cat /etc/shadow)" f.txt        -> path tokens: ["f.txt"]
grep -f "$(cat /etc/shadow)" f.txt       -> path tokens: ["$(cat /etc/shadow)", "f.txt"]
awk -v x="$(cat /etc/shadow)" '{p}' f.txt -> path tokens: ["f.txt"]
```

`/etc/shadow` reaches neither path surface in any of the three.
ADR 0009 calls positional invariance "a guarantee, not a residual", and lists a substitution in argument position among the positions it holds for, so this is inside the contract.
The command **enumerator** is a separate walker and still emits `cat /etc/shadow` as a unit, so `bash:` rules do fire — the loss is confined to the `path` and `external_directory` projections.

### Measured blast radius

Instrument: the collector and both classifiers run over every distinct `toolName: "bash"` command in the local review log (5918 commands after dropping the width-capped ones, 2026-09-06).
The interpreter rows were applied as a spike and the accepted-token set diffed against the same corpus at `1f5b983c`.

| Measurement                                                    | Before | After                                            |
| -------------------------------------------------------------- | ------ | ------------------------------------------------ |
| Commands with a non-path-shaped `external_directory` candidate | 77     | 69                                               |
| Commands with a non-path-shaped `path` candidate               | 373    | 279                                              |
| …interpreter subset, `external_directory`                      | 17     | 9                                                |
| …interpreter subset, `path`                                    | 116    | 22                                               |
| Accepted tokens lost                                           | —      | 105                                              |
| …of those, non-path-shaped script text                         | —      | 103                                              |
| …of those, path-shaped                                         | —      | 2 (both `perl` `s\|a\|b\|` substitution scripts) |
| Accepted tokens gained                                         | —      | 0                                                |

No real path is lost anywhere in the corpus.
The two "path-shaped" losses are perl substitution expressions whose `/` and `|` delimiters give them separators; neither names a file.

Corpus usage of the commands being added: `python3` 362 invocations / 132 inline-script, `node` 191 / 50, `perl` 87 / 87, `bun` 4 / 0, `ruby` 1 / 1, `python` 4 / 0.
Commands whose pattern-first flag argument opens with a command substitution — the population of the second fix: **0 of 5922**.

### External facts, verified by execution

Run on this host (macOS, 2026-09-06), because a `man` page answers whether a flag exists and not what the binary does with it:

| Command          | Flags listed                    | Evidence                                                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `node` v26.8.1   | `-e`, `--eval`, `-p`, `--print` | `node -e 'console.log("E-OK")'`, `node --eval …`, `node -p '1+1'` → `2`, `node --print '2+2'` → `4`; `node -p t.js` evaluates `t.js` as source rather than running the file, so a following argument is always consumed; `node --eval='…'` accepts the `=`-embedded form |
| `bun` 1.4.1      | `-e`, `--eval`, `-p`, `--print` | `bun -e`, `bun --eval`, `bun -p '1+1'` → `2`, `bun --print '1+1'` → `2`, `bun --eval='…'`; `bun -p` with no value errors `The argument '-p' requires a value`, so it consumes unconditionally                                                                            |
| `python3` 3.14.7 | `-c`                            | `python3 -c 'print("PC-OK")'`; `python3 -cu 'print("x")'` evaluates the glued `u` as the script, confirming getopt semantics the existing glued rule already models                                                                                                      |
| `perl` 5.34.1    | `-e`, `-E`                      | `perl -e 'print "PE-OK\n"'`, `perl -E 'say "PE2-OK"'`; `perl -e` with nothing after it errors `No code specified for -e`                                                                                                                                                 |
| `ruby` 4.0.6     | `-e`                            | `ruby -e 'puts "RE-OK"'`.  `-E` is deliberately **not** listed: on `ruby` it is `--encoding`, not a script flag                                                                                                                                                          |

`python` could not be run — no such binary on this host.
It shares `python3`'s row on the ground that every implementation the name reaches is a CPython-compatible front end where `-c` takes the following argument (CPython 2, CPython 3, PyPy).
If the implementing host has a `python`, verify it by execution and record the result; if it does not, the row ships on that basis and the ADR amendment says so.

### Constraints from AGENTS.md and the package skill

- The package skill's closing note applies directly: "When a plan or test asserts a specific bash repro string, trace the token through the classifier first."
  Done above, for both surfaces.
- `PATTERN_FIRST_COMMANDS` names share a configuration object "only when they share a *parser*, which is narrower than being aliases".
  `node` and `bun` assert the same four flags but are different binaries with different parsers, so each gets its own object; `python` and `python3` share one, being the same interpreter family.
- Health-metric rows that grep for a name the phase has not created must be updated in the commit that creates it, or the phase-close verification silently breaks.
  The interpreter row's recompute command names five interpreters and not `bun`, so it is edited in the same commit.
- The roadmap step's `✅` mark, its Mermaid node, and its `Landed:` note belong to the implementation doc-update commit, not to `/ship`.

## Design Overview

Two independent changes, sequenced so the second cannot widen the first's gap.

### Change A — a consumed flag argument is searched for the commands it hosts

One statement in `collectPatternCommandTokens`'s pending-consumption branch:

```typescript
const discharge = dischargePendingConsumption(consumption, text, effect);
if (discharge.token) tokens.push(discharge.token);
if (discharge.consumed) {
  // The argument's text belongs to the flag, but a substitution inside it
  // really runs, and its own operands are candidates like any other position
  // (ADR 0009's positional invariance).
  tokens.push(...collectHostedExecutionTokens(child));
  continue;
}
```

`collectHostedExecutionTokens` is the same root-inclusive helper `collectRedirectTokens` and `collectStatementOperandTokens` already use for exactly this question, so the branch is brought into line with its three siblings rather than given a new mechanism.
The nested command's tokens carry their own command's attribution, which is the invariant the helper exists to preserve.

The declined alternative is a plain `collectPathCandidateTokens(child)` recursion, as the `!isArgNode` branch does.
That would read the argument's own text back as an operand, which is precisely what the flag's role forbids — the script would return as a candidate through the recursion.

### Change B — the interpreter rows

One `PatternCommandConfig` per parser, all with `patternPositionals: 0`:

```typescript
const NODE_CONFIG: PatternCommandConfig = {
  flags: new Map<string, PatternFlagRole>([
    ["-e", "script"],
    ["--eval", "script"],
    ["-p", "script"],
    ["--print", "script"],
  ]),
  patternPositionals: 0,
};
```

`bun` carries an identical map in its own object, `python`/`python3` share `[["-c", "script"]]`, `perl` carries `-e`/`-E`, and `ruby` carries `-e` alone.

`patternPositionals: 0` is what keeps a script **file** an operand.
The existing rows all skip a leading positional because `grep PATTERN file` really does put a pattern first; an interpreter does not — `node build.js /tmp/x` names two paths and no inline script, and the script only ever arrives through a flag.
`config.patternPositionals ?? 1` already honors a literal `0`, so no code change is needed to support it.

`hasExplicitScript` becomes inert under a zero budget (`positionalsSeen < 0` is never true), which is correct: with no positional to protect, a `script` flag's only job is to swallow its own argument.

Three spellings are covered by machinery already present, and each gets a test rather than a code path:

- `-e <script>` — `consume-next`, discharged as `{ consumed: true }` with no token.
- `--eval=<script>` — `inline-value`, which pushes a token only for `script-file`, so a `script` role emits nothing.
- `-e<script>` glued — `inline-value` via the `text.slice(0, 2)` lookup, same outcome.

What the rows deliberately do not claim is as load-bearing as what they do.
`ruby -E` is an encoding flag; `python -m` names a module; `node --input-type=module` is an unrecognized flag whose `=`-embedded value keeps flowing through the blind split.
Each stays unlisted, so its value over-surfaces as a bare token that names nothing and the existence probe discards — ADR 0009's recoverable direction.

### What a consumer sees

Nothing downstream changes shape.
`collectPatternCommandTokens` returns `PathToken[]` as before; the interpreter's script simply is not among them, so `BashPathResolver` never classifies it and neither `projectExternalPaths` nor `projectRuleCandidates` sees it.
The command enumerator is untouched, so `bash:` rules govern `node -e "…"` exactly as they do today, and a `node -e "$(rm -rf ~/x)"` still enumerates `rm -rf ~/x` as its own unit.

## Module-Level Changes

### Production

- `src/access-intent/bash/token-collection.ts`
  - `collectPatternCommandTokens` — the consumed-argument branch gains a `collectHostedExecutionTokens(child)` call before its `continue`, with a comment naming the guarantee (Change A).
  - New `NODE_CONFIG`, `BUN_CONFIG`, `PYTHON_CONFIG`, `PERL_CONFIG`, `RUBY_CONFIG` constants, each with a comment recording the execution evidence for its rows and, for `RUBY_CONFIG`, why `-E` is absent (Change B).
  - `PATTERN_FIRST_COMMANDS` gains `node`, `bun`, `python`, `python3`, `perl`, `ruby`.
  - The module docstring's `PATTERN_FIRST_COMMANDS` sentence gains the interpreter class, since the map is no longer only about pattern-first *matching* tools.

No other `src/` file changes.
`token-classification.ts`, `bash-path-resolver.ts`, `command-enumeration.ts`, and `wrapper-analysis.ts` are untouched: the token never reaches them.

### Tests

- `test/access-intent/bash/token-collection.test.ts` — a `describe` for Change A inside the existing "a consumed flag argument, whatever node type it is (#823)" block, and a new sibling `describe` for the interpreter rows.
  Anchor the new sibling on the enclosing block's closing line and verify with `grep -n '^describe\|^});'`, per AGENTS.md.
- `test/access-intent/bash/program.test.ts` — a `#863` block carrying the issue's literal repro end to end through `BashProgram`, asserting on both `externalAccesses` and `ruleCandidates`.
  This is the layer the issue reports at, and `program.test.ts` is where per-issue facade cases live.

`test/handlers/gates/bash-path-extractor.test.ts` is deliberately not extended — its duplication of `program.test.ts` is Step 3's recorded tidy, and adding a third copy of this class is what that tidy exists to stop.

### Instrument

- `scripts/measure-interpreter-script-tokens.mjs` — new.
  Reads the review log, parses each distinct bash command through the package's own collector, and reports how many commands contribute a token that (a) the strict or broad classifier accepts and (b) came from an interpreter inline-script flag.
  Lands **before** the code change with the pre-fix baseline recorded in its header, since the "before" number is unobtainable afterwards.
  Skips a command stored with a trailing `…` (the `reviewLogFieldMaxWidth` cap), per the existing instruments.

### Documentation

- `docs/decisions/0009-bash-path-projection-completeness-contract.md` — a dated amendment, `amended:` frontmatter bumped, and the Status line's "as amended" date.
  It widens § "Where the bound sits" to admit a fourth in-scope edit — a command whose **inline script** the table can identify by flag role — and records why the third sentence of the old bound ("an omission costs a prompt, never an operand") is no longer a sufficient argument against adding one.
  It adds two residual bullets: the cluster spellings, beside the existing `grep -ie pattern` one; and the interpreter payload's opacity, pointing at [#886].
- `docs/architecture/architecture.md`
  - The `token-collection.ts` module-tree entry: the `PATTERN_FIRST_COMMANDS` sentence gains the interpreter class and the per-parser split for `node`/`bun`; the consumed-argument constraint sentence gains the hosted-execution search.
    Both are active constraints, so they belong in the tree under the repo's citation rule.
  - Step 1's heading gains `✅`, its Mermaid node gains `✅`, and a `Landed:` bullet is added.
  - Health metrics: "Interpreter script-role commands in `token-collection.ts`" moves off its `0` baseline, and its recompute command gains `bun` — `grep -cE '"(node|bun|python|python3|perl|ruby)"'`.
- `.pi/skills/package-pi-permission-system/SKILL.md` — the sentence beginning "That split is blind for a generic command… and **role-aware** for a pattern-first one" gains the interpreter case; the surrounding paragraph is the one that states the table's rule.
- `docs/opencode-compatibility.md` line 120 — "understands flag arity for `sed`, `awk`, `grep`, `rg`, and similar tools" gains the interpreter inline-script case, since a reader comparing coverage would otherwise miss it.

### Greps performed at planning time

- `PATTERN_FIRST_COMMANDS` across `packages/`, `.pi/`, `docs/` — production: `token-collection.ts`, `token-classification.ts` (a docstring reference, no edit needed).
  Tests: `token-collection.test.ts`, `bash-path-extractor.test.ts` (a comment, no edit).
  Live docs: `architecture.md`, `docs/decisions/0009`, `docs/decisions/0013` (a rejected-alternative mention, no edit), `docs/opencode-compatibility.md`, the package skill.
  Everything else is `docs/plans/` and `docs/retro/`, which are historical records and are not edited.
- `collectHostedExecutionTokens` / `dischargePendingConsumption` — `token-collection.ts` and `scripts/measure-statement-descent.mjs` only; the instrument reads the collector's output, not these names' arity, so it needs no edit.
- `positional invarian` — `docs/decisions/0009`, `token-collection.ts`, and `token-collection.test.ts`.

No export is removed or renamed, so no importer sweep is required.

## Test Impact Analysis

### New tests the change enables

Change A is testable at the unit layer for the first time in the shape that matters: a substitution inside a *consumed* flag argument.
The existing "#823" block covers what node types a consumption discharges on; it never asks what the discharged argument contained.

Change B makes the interpreter class assertable at the collector, where today it is only observable as a projected path three layers downstream.

### Existing tests that must stay as-is

Every `sed`/`awk`/`grep`/`rg`/`sd` case in `token-collection.test.ts` and `program.test.ts`.
The whole point of the per-parser configs is that the existing rows are untouched; the spike run confirmed all 1587 tests in `test/access-intent` and `test/handlers/gates` stay green with the interpreter rows applied.

### Tests that become redundant

None.
This change adds table rows and one statement; it removes no behavior an existing test covers.

### The instrument's own verification

`node packages/pi-permission-system/scripts/measure-interpreter-script-tokens.mjs` before Change B prints the pre-fix count; after Change B it prints `0`.
`node packages/pi-permission-system/scripts/measure-path-false-positives.mjs` is the roadmap's stated outcome check and should not regress — its `non-path` column is a superset (it also counts `git commit -m` prose and `echo` strings, which this change does not touch).

## Invariants at risk

| Invariant                                                                                                        | Where it is documented                                      | What pins it                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Positional invariance — a nested command's operands are projected wherever the substitution sits                 | ADR 0009 § "What the projection guarantees"; [#741], [#742] | Change A's own test, plus the existing `program.test.ts` blocks for redirect-hosted and heredoc-hosted executions                            |
| A pattern-first command's real file operand is never eaten by a mis-listed flag                                  | ADR 0009 amendment 2026-08-29; [#823]                       | The existing `#823` blocks; Change B's `node build.js /tmp/x` and `ruby -E utf-8 -e …` cases                                                 |
| A nested execution's tokens keep their own command's effect attribution, not the enclosing command's             | `token-collection.ts` docstring; [#807]                     | Change A must use `collectHostedExecutionTokens`, not a re-tag; assert the projected `/etc/shadow` carries `cat`'s `read` proof, not `sed`'s |
| A redirect destination is collected independently of the command's own arguments                                 | [#741]                                                      | `node -e "x" > /tmp/out.txt` still projects `/tmp/out.txt`                                                                                   |
| The command enumerator is unaffected — `bash:` rules still govern the interpreter invocation and any nested unit | ADR 0013 §10                                                | An assertion that `node -e "$(cat /etc/shadow)"` still enumerates two units                                                                  |

The quantitative invariant is the corpus diff in Background: 105 tokens lost, all script text, 0 real paths, 0 gained.
Re-run it after implementation rather than citing this table — it is a measurement at `1f5b983c` and the plan's own guidance is that a measurement is scoped to the commit it was taken at.

## TDD Order

1. **Commit the measurement instrument and its pre-fix baseline.**
   `scripts/measure-interpreter-script-tokens.mjs`, run against the local review log, header recording the corpus size, the date, and the pre-fix count.
   No test surface — it is an instrument, verified by running it.
   This lands first because the "before" number cannot be recovered once Change B is in.
   Commit: `docs(pi-permission-system): commit the instrument behind the interpreter-script measurement`.

2. **Red → green: a command hosted in a consumed flag argument is projected.**
   Test surface: `test/access-intent/bash/token-collection.test.ts`, inside the existing `#823` consumed-argument block.
   Covers `sed -e "$(cat /etc/shadow)" f.txt` and `awk -v x="$(cat /etc/shadow)" '{print}' f.txt` projecting `/etc/shadow` alongside `f.txt`, and the projected token carrying `cat`'s own `read` attribution rather than the enclosing command's.
   Green by adding `tokens.push(...collectHostedExecutionTokens(child))` to the `discharge.consumed` branch.
   Killing mutation: delete that pushed call — both new cases go red while every existing case stays green.
   Commit: `fix(pi-permission-system): project the operands of a command hosted in a consumed flag argument`.

3. **Red → green: an interpreter's inline script is not a path candidate.**
   Test surfaces: `test/access-intent/bash/token-collection.test.ts` (a new sibling `describe`) and `test/access-intent/bash/program.test.ts` (a `#863` block through `BashProgram`).
   Covers, as equivalence classes:
   - *Script suppressed*: the issue's literal `node -e "…"` repro, `node --eval "// x"`, `node --eval="// x"`, `node -p`, `bun -e`, `bun --print`, `python3 -c "# c\nprint(1)"`, `perl -e '// x'`, `perl -E`, `ruby -e '# x'` — no token, and at the facade no external access and no rule candidate.
   - *Operand preserved*: `node build.js /tmp/x` projects both; `python3 script.py /tmp/x` projects both.
   - *Unlisted flag still over-surfaces*: `ruby -E utf-8 -e 'code'` projects `utf-8` and not the script; `node --input-type=module -e "// x"` projects `module` and not the script.
   - *Adjacent surfaces intact*: `node -e "x" > /tmp/out.txt` still projects `/tmp/out.txt`; `node -e "$(cat /etc/shadow)"` still projects `/etc/shadow` (which is Change A, now reached by an interpreter row).

   Killing mutations, one per class:
   - Delete the `["node", NODE_CONFIG]` entry from `PATTERN_FIRST_COMMANDS` → every *script suppressed* `node` case goes red; the `python3`/`perl`/`ruby`/`bun` cases stay green.
   - Remove `patternPositionals: 0` from `NODE_CONFIG` → `node build.js /tmp/x` drops `build.js` and goes red; the *script suppressed* cases stay green.
   - Add `["-E", "script"]` to `RUBY_CONFIG` → `ruby -E utf-8 -e 'code'` loses `utf-8` and goes red.
   - Extend the `inline-value` branch's push condition from `script-file` to include `script` → `node --eval="// x"` goes red while the spaced `node --eval "// x"` stays green, which is what separates the two spellings.

   Commit: `fix(pi-permission-system): stop projecting an interpreter's inline script as a path`.

4. **Amend ADR 0009.**
   Widen § "Where the bound sits" to a fourth in-scope edit, record why the old bound's "an omission costs a prompt, never an operand" no longer settles the question, and add the two residual bullets (cluster spellings; interpreter payload opacity, citing [#886]).
   Verified by `pnpm exec rumdl check` and by re-reading the amendment against the rows actually shipped.
   Commit: `docs(pi-permission-system): amend ADR 0009 to admit an interpreter's inline script`.

5. **Land the roadmap and reference-doc updates.**
   Step 1's `✅` heading mark, its Mermaid node, its `Landed:` bullet, the interpreter health-metric row and its `bun`-inclusive recompute command, the `token-collection.ts` module-tree entry, the package skill's pattern-first paragraph, and `docs/opencode-compatibility.md` line 120.
   Verified by running each edited recompute command and by `pnpm run lint`.
   Commit: `docs(pi-permission-system): record the interpreter script role in the roadmap and module tree`.

## Risks and Mitigations

| Risk                                                                                                                        | Mitigation                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A listed flag does not consume on some host, so the walker eats a real operand — the unrecoverable direction ADR 0009 names | Every row except `python` was verified by running the binary, with the transcript in Background. `python` shares `python3`'s row on a stated basis, and the implementing session re-verifies by execution if its host has one           |
| `patternPositionals: 0` is an untried value                                                                                 | It is read as `config.patternPositionals ?? 1`, so `0` is honored by construction; the spike ran the full `test/access-intent` + `test/handlers/gates` suite green with it, and step 3's second killing mutation pins it                |
| The change silently drops a real path from the corpus                                                                       | Measured directly rather than argued: 105 accepted tokens lost, 103 non-path-shaped, 2 perl substitution scripts, 0 real paths, 0 gained, over 5918 commands. Re-run the diff after implementation                                      |
| Change A newly prompts on an unconfigured install                                                                           | Its measured population is 0 of 5922 commands. Precedent for the classification is [#741]/[#742], whose equivalent new projections shipped as `fix:`, not `fix!:`                                                                       |
| The cluster residual is read later as a bug rather than a decision                                                          | It is recorded in ADR 0009 beside the `grep -ie pattern` residual it matches, with the measured 12-of-270 figure and the reason both a getopt scan and a `-p` listing are wrong                                                         |
| The roadmap's interpreter metric grep silently under-reports because `bun` is not in its pattern                            | The recompute command is edited in the same commit as the rows, per the roadmap's own instruction about names a phase has not yet created                                                                                               |
| A future reader takes the removed token as removed protection                                                               | The ADR amendment states the concrete finding: the projected token was the whole program text, `node -e 'require("/etc/passwd")'` never was an `external_directory` candidate, and it matched no `path` rule but the universal fallback |

## Open Questions

- Whether `python` should ship a row without an execution check on some host.
  Resolved by the implementing session if a `python` is available; otherwise the row ships on the CPython-front-end basis stated in the ADR amendment, and the question is closed either way rather than left standing.
- Whether Step 3 ([#609]) folds these rows' `script` role into its `TokenRole` vocabulary or leaves them in the flag table.
  Deliberately left to that step's plan; nothing here anticipates the shape.

[#609]: https://github.com/gotgenes/pi-packages/issues/609
[#741]: https://github.com/gotgenes/pi-packages/issues/741
[#742]: https://github.com/gotgenes/pi-packages/issues/742
[#807]: https://github.com/gotgenes/pi-packages/issues/807
[#823]: https://github.com/gotgenes/pi-packages/issues/823
[#859]: https://github.com/gotgenes/pi-packages/issues/859
[#880]: https://github.com/gotgenes/pi-packages/issues/880
[#886]: https://github.com/gotgenes/pi-packages/issues/886
