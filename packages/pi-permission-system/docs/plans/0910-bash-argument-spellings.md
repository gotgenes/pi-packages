---
issue: 910
issue_title: "pi-permission-system: an absolute-path bash rule does not cover the relative spelling of the same path"
---

# Give a bash command unit its absolute argument spelling

## Release Recommendation

**Release:** ship independently

The issue is not a step in the Phase 15 roadmap; its sweep disposition (recorded at planning) is "out of scope for the roadmap", so it carries no batch tag.
The change is breaking (`fix(pi-permission-system)!:`), so the release is a major.

## Problem Statement

A `bash` rule that names a path in its absolute spelling does not govern the same command written with a relative spelling of that path, although both reach the same file.
The issue's reporter saw the fail-closed half: with `{"*": "allow", "rm *": "ask", "rm /tmp/agent-builds/*": "allow"}`, `rm /tmp/agent-builds/x` runs while `cd /tmp && rm agent-builds/x` prompts via `rm *`.
Planning found the fail-open half too: an absolute `deny` is skipped by the relative spelling, and whether a path surface catches the access instead depends on the rest of the config.

The `bash` surface matches a command unit's text, plus whatever `BashCommand.spellings` carries.
[#981] built that seam and gave it one producer, the home-expanded spelling of a unit that opens with `~`/`$HOME`/`${HOME}`.
Its Non-Goals left argument spellings ("relative, absolute, and canonical") to PR [#917], and asked that a second producer plug into the seam rather than add an intent.
The path surfaces already resolve each argument against the `cd`-folded working directory (`BashPathResolver`); the `bash` surface never sees that resolution.

The issue was filed and closed within a minute by its third-party author, with a close comment asserting a maintainer decision nobody made (2026-09-15 triage).
Planning reopened it at the operator's direction.

## Goals

- A command unit carries a second spelling: its text with every resolvable path argument replaced by the lexical absolute form the path surfaces resolve (`AccessPath.value()`).
  Absolute only; no canonical (symlink) and no project-relative spelling.
- The last rule matching the typed text or any spelling decides (`evaluateAnyValue`, already in place), so a later absolute `allow` loosens a broader `ask`, an earlier one does not, and an absolute `deny` reaches the relative spelling.
- The fail-closed properties the issue names hold: a token after a non-literal `cd` ([#393]), a computed word (`$DIR/x`, `$(…)`), a glob word, and a win32 POSIX-absolute token ([#533]) contribute no spelling.
- The service's advisory `bash` answer resolves with the same spellings as the gate, so it stays never weaker than the gate ([#309]).
- The result, the ask dialog, and the review log name the spelling that decided when it was not the typed text (`matchedSpelling`, dialog line `matched as`), and the review log masks it like `command`.
- **Breaking.**
  Existing configs change their decisions on upgrade with no edit: an absolute `deny` starts catching relative spellings, and an absolute `allow` placed after a broader rule starts loosening them.
  `docs/configuration.md` § `bash` Surface promises nothing about path arguments, unlike [#981]'s home contract; [#928]'s last-match-wins MCP change is the precedent for `fix!`.

## Non-Goals

- **Canonical and project-relative spellings.**
  The operator chose absolute only; a rule written `/private/tmp/*` still does not match `rm /tmp/x`, as today.
- **Combining the two producers.**
  `~/bin/tool a/x` after `cd /tmp` gets a home spelling `<home>/bin/tool a/x` and an argument spelling `~/bin/tool /tmp/a/x`, but not `<home>/bin/tool /tmp/a/x`.
  A rule naming both absolute forms matches neither; a documented residual.
- **Mixed spellings in one rule.**
  The argument spelling rewrites every resolvable argument at once, so a rule naming one argument absolute and another relative matches neither text.
- **Session grants that cross spellings.**
  The suggestion stays the typed unit (the text the prompt showed); a grant for `rm a/x` does not cover a later `rm /tmp/a/x`.
- **The forwarded-serving wire.**
  A serving node rebuilds a forwarded ask from the typed command and sees no spelling; that is [#1019], unchanged here.
  The forwarded payload does carry the child's `matchedSpelling` fact, as it carries `matchedPattern`.
- **Wrapper inner commands, the whole-string resolves, and salvaged units.**
  As in [#981]: `resolveWrapperUnit`'s inner text and the whole-command fallbacks resolve with no spellings, and a salvaged region's coordinates are its own re-parse's, so its units get none.
- **Bare tokens that name nothing on disk.**
  `cd /tmp && rm foo` spells `foo` only when `/tmp/foo` exists, because candidacy for a bare token is the existence probe's ([#645]).
- **The decision event (`permissions:decision`).**
  Its payload table in `docs/cross-extension-api.md` gains nothing; the spelling rides the prompt request facts and the review log.
- **The service's `workdir`.**
  An aliased shell tool's gate seeds a `workdir`; the advisory query has none, so for an aliased tool the two can still resolve different bases, exactly as their path slices do today.

## Background

- `src/access-intent/bash/command-enumeration.ts`: `makeCommandUnit` builds each `BashCommand` from `readCommandUnit(node, scope.words)`, which walks the unit's word nodes (`commandWordNodes`: every named child but `variable_assignment` and redirects, `command_name` included) and records each word's `offset` in the unit text plus `ArgWord.computed`.
  `spellings` is set from `scope.words.spellHomeAtStart(text)`.
  `CommandWord` itself lives in `wrapper-analysis.ts:23`.
- `src/access-intent/bash/bash-path-resolver.ts`: `resolve(rootNode, salvagedRoots)` walks once, folding literal current-shell `cd`s into an `EffectiveBase`, and `projectRuleCandidates` turns each token into an `AccessPath` (`forBashToken` with the base, or `forLiteral` after a non-literal `cd`), deduplicating by `matchValues()` and merging effects.
  Salvaged roots are walked under the unknown base and live in their own re-parse's coordinates.
- `src/access-intent/bash/token-collection.ts`: `PathToken` is `{ token, effect, role }` with eight construction sites.
  Whole-argument sites: 910 (pattern-first positional), 967 (`dischargePendingConsumption`, script-file; receives only the string today), 1018 (generic argument), 163 (redirect destination), 275 (`for`/`case` operand).
  Derived sites: 408 and 420 (`--opt=value` regex group), 890 (inline-value script-file).
  A flag token (`--file=x/y`) emitted whole is rejected by `classifyTokenAsRuleCandidate` (`rejectNonPathToken`), so it never becomes a candidate.
  The heredoc-tail and redirect-argument corrections run inside `getParser`'s corrected tree and keep the original word nodes' `startIndex`/`endIndex`, so the resolver and the enumerator see the same node identities.
- `src/access-intent/bash/program.ts`: `BashProgram.parse` is async only for `getParser()`; the body after `parser.parse` is synchronous.
  `src/access-intent/bash/sync-commands.ts`'s `parseBashCommandsSync(command)` duplicates the enumeration half with no `PathNormalizer`; its only `src/` caller is `src/service/bash-advisory-check.ts`, called from `src/service/permissions-service.ts:70`, which holds `this.session.getPathNormalizer()`.
- `src/handlers/gates/bash-command.ts`: `resolveCommandUnit` already passes `cmd.spellings ?? []` to the `bash-command` intent; `floorToAsk` spreads the resolved check and replaces `matchedPattern`.
- `src/policy/permission-manager.ts`: `check()`'s `bash-command` branch calls `normalizeBashCommand(command, spellings)` and `buildCheckResult`, which runs `evaluateAnyValue` and keeps the matched `value` only for MCP's `target`.
  `values[0] !== value` is routine on MCP and path surfaces, so a spelling fact must be decided in the `bash-command` branch, not inside the shared function.
- `src/presentation/`: `executedUnit` is the template for a display fact — `PermissionCheckResult` → `PromptRequest` (`prompt-payload.ts`, with the tolerant `asPromptRequest` allowlist) → `tool-ask-payload.ts` → `renderReviewLogFacts` → `dialog-renderer.ts` (`runs` line) → `COMMAND_BEARING_LOG_KEYS` (`src/logging/command-redaction.ts`).
  The runner writes `renderReviewLogFacts(descriptor.payload)` on every decision, so a request fact reaches allow and deny entries too.
- Constraints from the package skill: every surface resolves through `evaluateAnyValue`; a unit's spellings come from the program analysis, never the matcher; wildcard matching must be explicit and tested; a value bound to a command-bearing log key is masked whatever key it sits under (ADR 0010, [#923]).

## Design Overview

### Reproduction

Disposable Vitest probes on `main` at planning time drove `resolveBashCommandCheck` with units from `parseBashCommandsSync` over a real `PermissionResolver` and `PermissionManager` (`createInMemoryManager`), with an in-process config mirroring the issue.
Deterministic code with no cache, so one trial per row; measured:

| `bash` rules                                             | Command                                    | Today                                |
| -------------------------------------------------------- | ------------------------------------------ | ------------------------------------ |
| `*: allow`, `rm *: ask`, `rm /tmp/agent-builds/*: allow` | `rm /tmp/agent-builds/…/config.json`       | `allow` via `rm /tmp/agent-builds/*` |
| same                                                     | `cd /tmp && rm agent-builds/…/config.json` | `ask` via `rm *`                     |
| same                                                     | `cd "$DIR" && rm agent-builds/x`           | `ask` via `rm *` (must stay)         |
| `*: allow`, `rm /tmp/agent-builds/*: deny`               | `rm /tmp/agent-builds/x`                   | `deny`                               |
| same                                                     | `cd /tmp && rm agent-builds/x`             | `allow` via `*`                      |
| `*: allow`, `rm <cwd>/secrets/*: deny`                   | `rm secrets/x`                             | `allow` via `*`                      |

Blast radius, measured with a heuristic regex (a `cd <dir>` followed in the chain by a command with a relative, slash-bearing argument) over this operator's review log: 310 of 13772 `bash`-surface entries (23476 entries total).

### The producer: the resolver spells, the enumerator asks

The resolver is the only party that knows a token's base, so it records spellings; the enumerator owns the unit text and its words, so it composes the unit's spelling by asking about each word.
The join is exact source-span equality between a token's argument node and a unit's word node, which fails safe: a token nobody can locate is never rewritten.

```typescript
/** Source span of the argument node a whole-argument token was read from. */
interface SourceSpan {
  readonly start: number; // node.startIndex
  readonly end: number; // node.endIndex
}

export interface PathToken {
  readonly token: string;
  readonly effect: TokenEffect;
  readonly role: TokenRole;
  /** Set only when `token` is the whole argument node's resolved text. */
  readonly span?: SourceSpan;
}

/** Consumer-owned (command-enumeration.ts): what the enumerator asks of a word. */
export interface ArgumentSpeller {
  /** The absolute spelling of the argument at this node, or `undefined`. */
  absoluteSpellingOf(node: TSNode): string | undefined;
}

export interface ResolvedBashPaths {
  readonly externalAccesses: readonly BashExternalPath[];
  readonly ruleCandidates: readonly BashPathRuleCandidate[];
  /** Absolute spellings of the primary tree's argument nodes, keyed by span. */
  readonly argumentSpellings: ArgumentSpeller;
}
```

The resolver records an entry in `projectRuleCandidates`, **before** the dedup `continue`, so `cp a/x a/x` spells both occurrences, when all hold:

- the candidate carries a span (whole-argument token from the primary tree; salvaged candidates are tagged without spans);
- the token has no glob metacharacter (`*`, `?`, `[`), quoted or not — fail-closed by construction;
- `path.value()` is absolute under the normalizer's flavor (`normalizer.isAbsolute`), which excludes the literal-only form a non-literal `cd` produces ([#393]) and keeps "absolute only" a single predicate;
- `path.value()` differs from the token.

`BashPathRuleCandidate` is unchanged; spans stay on the private `PathCandidate`.

The enumerator side, beside the home producer (call site in `makeCommandUnit`):

```typescript
const { text, words, argumentSpelling } = readCommandUnit(node, scope);
// readCommandUnit builds argumentSpelling in parallel with text: the same gaps,
// each word replaced by scope.speller?.absoluteSpellingOf(wordNode) when the word
// is not ArgWord.computed; undefined when nothing was replaced.
const spellings = distinctSpellings(text, [
  scope.words.spellHomeAtStart(text),
  argumentSpelling,
]);
```

The speller rides `UnitScope` (the object `collectCommands` already relays), so nested substitution units are spelled on their own; `collectSalvagedCommands` passes none.
`BashCommand.spellings` stays absent when no spelling exists, so a unit with no resolvable argument keeps its exact shape.

The computed-word guard sits in the enumerator because `rm $DIR/x` **is** a rule candidate today (it carries a `/`), and `path.value()` would invent `/cwd/$DIR/x`, which an `rm /cwd/*: allow` would match.
`ArgWord.computed` already answers that question per word.

### One builder for the gate and the advisory

`BashProgram` gains a private static synchronous builder over `(parser, tree, command, normalizer, workdir?)` holding today's `parse` body plus the composition above.
`parse` is `getParser()` then the builder, and the new `BashProgram.parseSync(command, normalizer, options?)` is `getWarmBashParser()` then the builder, returning `null` while cold.
`sync-commands.ts` is deleted, and `resolveBashAdvisoryCheck(command, agentName, resolver, normalizer)` calls `BashProgram.parseSync(command, normalizer)?.commands()`.
The advisory now runs the resolver too, including its synchronous `entryExists` probes, on every warm `checkPermission("bash")`.

### `matchedSpelling`

```typescript
export interface PermissionCheckResult {
  // …
  /**
   * The spelling of the bash unit the winning rule matched, when the rule did
   * not match the unit as typed. Absent otherwise.
   */
  matchedSpelling?: string;
}
```

- `check()`'s `bash-command` branch sets it when the matched value is not `values[0]` (the comment-stripped typed text); `buildCheckResult` exposes the matched value to the branch instead of deciding per surface.
  Because `evaluateAnyValue` reports the first candidate the winning rule matches, a rule matching the typed text too reports no spelling.
- `floorToAsk` drops it: a floor replaces `matchedPattern` with a sentinel, and a spelling paired with a sentinel names a match that did not decide.
- `PromptRequest` gains `matchedSpelling: string | null`; `tool-ask-payload.ts` stamps it, the four other request builders write `null`, and `asPromptRequest` reads an absent field as `null`, so a payload from a child built before the field still parses.
- `renderReviewLogFacts` adds it with `present(…)`; `dialog-renderer.ts` renders `matched as <spelling>` after the `rule` line; `COMMAND_BEARING_LOG_KEYS` gains `matchedSpelling`, since the spelling is the command with a secret-bearing assignment intact.

### Edge cases (each pinned in the named step)

- Non-literal `cd` (`cd "$DIR" && rm ./a/x`): literal-only path, not absolute, so no spelling (step 5).
- Glob (`rm src/*.ts`), computed (`rm $DIR/x`, `cat $(pwd)/x`): no spelling (steps 5, 6).
- Rebound `HOME` (`HOME=/x; cat ~/n`): the resolver already drops the token, so no spelling (step 5).
- Unrebound home argument (`cat ~/notes`): spelled `cat <home>/notes`, the argument case [#981] deferred (step 5).
- win32 POSIX-absolute token (`rm /tmp/x` under the win32 flavor): `forLiteral`, value equals token, so no spelling (step 5).
- A quoted relative argument (`rm "a b/c"` after `cd /tmp`): the word span is replaced whole, so the spelling is `rm /tmp/a b/c`, unquoted; harmless to matching, documented (step 6).
- `..` in an argument (`cd /tmp/a && rm ../../etc/x`): spelled `rm /etc/x`, the file that runs (step 6).
- Wrapper unit (`cd /tmp && sudo rm a/x` with `{"*": "ask", "sudo rm /tmp/a/*": "allow"}`): resolves `allow` through the spelling, then floors to `ask` via `<indirection-bash-wrapper>` with no `matchedSpelling` (steps 6, 7).
- Substitution-nested unit (`cd /tmp && echo $(cat a/x)`): the inner `cat a/x` unit is spelled (step 6).

### Design review

- `ResolvedBashPaths` gains one field; `UnitScope` gains one; `PathToken` gains one optional field; `PermissionCheckResult` and `PromptRequest` gain one each.
- No parameter relay: the speller is produced by the resolver, carried on the scope the enumerator already relays, and read at the one site that builds a unit.
- Import edges: `bash-path-resolver.ts` → `command-enumeration.ts` (type-only, for `ArgumentSpeller`) within `access-intent/bash/`; `command-enumeration.ts` imports nothing from the resolver, so no cycle.
  `service/bash-advisory-check.ts` → `access-intent/bash/program.ts` replaces its `sync-commands.ts` edge (same zone pair).
- Mechanism (resolver records, step 5) and wiring (enumerator composes, step 6) land as separate steps, each with its own instrument.

## Module-Level Changes

- `src/access-intent/bash/token-collection.ts` — `PathToken.span`; a `wholeNodeToken(node, words, effect, role)` helper at the five whole-argument sites; `dischargePendingConsumption` takes the node.
- `src/access-intent/bash/bash-path-resolver.ts` — `PathCandidate.span`; `tagTokens` and `projectRuleCandidates` carry the candidate whole; salvaged walks tag without spans; `ResolvedBashPaths.argumentSpellings`, a map-backed `ArgumentSpeller`.
- `src/access-intent/bash/command-enumeration.ts` — `ArgumentSpeller` interface; `UnitScope.speller`; `collectCommands(root, words, speller?)`; `readCommandUnit` builds the argument spelling; `makeCommandUnit` composes both producers; the `BashCommand.spellings` doc comment names both.
- `src/access-intent/bash/wrapper-analysis.ts` — predicted **unchanged**: the spelling is built from nodes inside `readCommandUnit`, so `CommandWord` gains nothing.
- `src/access-intent/bash/program.ts` — private synchronous builder; `parseSync`; the builder passes `argumentSpellings` to `collectCommands`.
- `src/access-intent/bash/sync-commands.ts` — deleted.
- `src/service/bash-advisory-check.ts` — takes a `PathNormalizer`, calls `BashProgram.parseSync`.
- `src/service/permissions-service.ts` — passes `this.session.getPathNormalizer()`.
- `src/policy/permission-manager.ts` — the `bash-command` branch sets `matchedSpelling`; `buildCheckResult` exposes the matched value.
- `src/types.ts` — `PermissionCheckResult.matchedSpelling`.
- `src/handlers/gates/bash-command.ts` — `floorToAsk` drops `matchedSpelling`.
- `src/presentation/prompt-payload.ts`, `tool-ask-payload.ts`, `skill-ask-payload.ts`, `path-ask-payload.ts` (two builders), `forwarded-ask-payload.ts`, `review-log-renderer.ts`, `dialog-renderer.ts` — the request fact, its builders, its log line, its dialog line.
- `src/logging/command-redaction.ts` — `COMMAND_BEARING_LOG_KEYS` gains `matchedSpelling`.
- `src/handlers/gates/tool-call-gate-pipeline.ts`, `src/handlers/gates/runner.ts`, `src/access-intent/input-normalizer.ts`, `src/policy/rule.ts` — predicted **unchanged**: the gate already reads `bashProgram.commands()` and passes `cmd.spellings`, the runner spreads `renderReviewLogFacts`, and the normalizer and evaluator already take spellings.
- Tests: `test/access-intent/bash/token-collection.test.ts`, a new `test/access-intent/bash/bash-path-resolver.test.ts`, `test/access-intent/bash/program.test.ts` (parseSync cases; exact `commands()` assertions whose units gain a spelling), `test/access-intent/bash/sync-commands.test.ts` (migrated to `parseSync` through a test-local helper and renamed `program-parse-sync.test.ts`), `test/handlers/gates/bash-command.test.ts`, `test/service/bash-advisory-check.test.ts`, `test/policy/permission-manager-unified.test.ts`, `test/presentation/{tool-ask-payload,review-log-renderer,dialog-renderer}.test.ts`, `test/logging/command-redaction.test.ts`, the test covering `asPromptRequest` (grep at step 8), and the eight test files asserting a full request literal (`grep -rln 'executedUnit: null' test`, 8 at planning).
- Docs: `docs/configuration.md` § `bash` Surface (the argument spelling, its exclusions, the residuals, the `matched as` line); `docs/cross-extension-api.md` (`PromptRequestFacts` row for `matchedSpelling`); `docs/architecture/architecture.md` entries for `token-collection.ts`, `bash-path-resolver.ts`, `command-enumeration.ts`, `program.ts`, `bash-advisory-check.ts`, `command-redaction.ts`, and the `sync-commands.ts` tree line removed; `.pi/skills/package-pi-permission-system/SKILL.md` (the "spellings come from the program analysis" bullet names the argument producer).
- `docs/decisions/0011-prompt-presentation-contract.md` and `0010-…` — predicted **unchanged**: decision records whose inline field listings are snapshots; `docs/cross-extension-api.md` is the current reference.

## Test Impact Analysis

1. New tests the change enables: the resolver's spelling map is directly testable per edge case (step 5), independent of rule evaluation; `parseSync` gets a parity test against `parse`.
2. Redundant tests: none removed; `sync-commands.test.ts`'s enumeration cases move to `parseSync` unchanged in intent.
3. Tests that stay: the [#981] home-spelling block in `bash-command.test.ts` ("a rule written with ~ matches the command however its home is spelled") pins the first producer and must stay green beside the second.
4. Expected churn: exact `commands()` assertions in `program.test.ts` (85 `commands()).toEqual` at planning) and `sync-commands.test.ts` (17 `toEqual([`) change where a unit has a resolvable argument; the count is taken at step 6's red run, not predicted.

## Invariants at risk

| Invariant                                                                                    | Constituency                                          | Pinned by                                                                       |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| A home spelling matches a home-anchored rule unless `HOME` is rebound ([#981])               | users with `~` rules                                  | `bash-command.test.ts` home-spelling block (exists)                             |
| A token after a non-literal `cd` stays literal ([#393])                                      | everyone; the deny direction                          | step 5 resolver test (new) plus existing `program.test.ts` rule-candidate cases |
| A win32 POSIX-absolute token is never fabricated into a drive path ([#533])                  | Windows users                                         | step 5 win32-flavor test (new)                                                  |
| A wrapper's `allow` floors to `ask` ([#481]) and an unparsed unit's floors too ([#840])      | everyone                                              | step 6 wrapper row, step 7 floor-drops-spelling test                            |
| The advisory answer is never weaker than the gate ([#309])                                   | service consumers (`model-judge`, sibling extensions) | step 6 advisory parity test (new)                                               |
| A secret masked under `command` is masked under every command-bearing key (ADR 0010, [#923]) | log readers                                           | step 8 redaction test (new)                                                     |
| Rule position decides; candidate order only names the match ([#928])                         | MCP and path users                                    | step 7 MCP/path absence test (new)                                              |

## TDD Order

1. **`refactor(pi-permission-system): build a BashProgram synchronously over the warm parser`.**
   Extract the private builder from `parse`; add `BashProgram.parseSync(command, normalizer, options?)` beside it.
   Tests (`program.test.ts`, new `describe("parseSync")`): `null` while cold; once warm, `commands()`, `externalAccesses()`, and `pathRuleCandidates()` equal `parse`'s for a chain, a salvaged command, and a `workdir` case.
   Killing mutation: make `parseSync` return `new BashProgram(command, [], [], [])` instead of `null` when `getWarmBashParser()` is `null`.

2. **`refactor(pi-permission-system): resolve the advisory bash query through BashProgram.parseSync`.**
   `resolveBashAdvisoryCheck` takes the normalizer; `permissions-service.ts` passes `this.session.getPathNormalizer()`; delete `sync-commands.ts`; migrate `sync-commands.test.ts` (20 sites, renamed `program-parse-sync.test.ts`), `bash-command.test.ts` (3 sites), and `bash-advisory-check.test.ts`'s calls in the same commit, because removing the export breaks them at the type level.
   Behavior-neutral; the existing suite is the check, and no new test means no mutation.

3. **`refactor(pi-permission-system): give a whole-argument PathToken its source span`.**
   `wholeNodeToken` at sites 910, 967, 1018, 163, 275; `dischargePendingConsumption` takes the node; derived sites unchanged.
   Tests (`token-collection.test.ts`, new `describe("source spans")`): `rm a/b`, `grep pat a/b`, and a script-file flag's separate argument carry their node's `startIndex`/`endIndex`; `--out=a/b` and an inline-value script-file carry none.
   Killing mutation: pass the argument node's span to the token `embeddedOptionValueToken` builds.

4. **`refactor(pi-permission-system): carry a path candidate whole through the resolver's projection`.**
   `tagTokens` spreads the `PathToken`; `projectRuleCandidates` and its dedup branch keep every field.
   Behavior-neutral; existing suite.

5. **`refactor(pi-permission-system): record the absolute spelling of each resolved argument`.**
   `ResolvedBashPaths.argumentSpellings` per the Design Overview predicate; salvaged candidates carry no span.
   Tests (new `bash-path-resolver.test.ts`, driving `new BashPathResolver(normalizer, words).resolve(root, salvaged)` over a parsed tree):
   - `cd /tmp && rm a/x` → the `a/x` node spells `/tmp/a/x`;
   - `cp a/x a/x` after `cd /tmp` → both nodes spelled;
   - `cd "$DIR" && rm ./a/x` → none;
   - `rm src/*.ts` → none;
   - a salvaged root's relative and absolute tokens → none;
   - `cat ~/notes` → `<home>/notes`; `HOME=/x; cat ~/n` → none;
   - an existing bare token in a tmp fixture → spelled; a missing one → none;
   - `rm /tmp/x` under a win32-flavor normalizer → none.

   Killing mutations: move the recording after the dedup `continue` (kills `cp a/x a/x`); drop the `isAbsolute` check (kills `cd "$DIR" && rm ./a/x`, which would spell `a/x`); drop the glob check (kills `rm src/*.ts`); tag salvaged candidates with their spans (kills the salvaged case).

6. **`fix(pi-permission-system)!: match a bash rule written with an absolute path against the relative spelling of that path`.**
   `UnitScope.speller`, `collectCommands(root, words, speller?)`, `readCommandUnit`'s parallel spelling over non-computed words, `makeCommandUnit` composing both producers; the builder passes `argumentSpellings`.
   Tests (`bash-command.test.ts`, new `describe("a rule written with an absolute path matches the relative spelling")`, real resolver and manager via `parseSync` with a normalizer whose cwd the rows name):
   - every reproduction row above, flipped where the Design Overview says;
   - an absolute `allow` placed **before** `rm *: ask` still asks;
   - `rm $DIR/x` under `{"*": "ask", "rm <cwd>/*": "allow"}` stays `ask`;
   - `cat $(pwd)/x` gets no spelling;
   - the wrapper and nested-substitution rows;
   - `cd /tmp/a && rm ../../etc/x` reaches an `rm /etc/*` deny;
   - the quoted-argument spelling.

   Advisory parity (`bash-advisory-check.test.ts`): `cd /tmp && rm a/x` under an absolute `deny` answers `deny`.
   Update the exact `commands()` assertions the spelling changes (program and parse-sync tests).
   Killing mutations: pass `undefined` as the speller in the builder's `collectCommands` call (kills the reproduction rows and the advisory parity test); drop the `!computed` guard in `readCommandUnit` (kills `rm $DIR/x`).
   Commit body ends with `BREAKING CHANGE:` (existing configs change decisions: an absolute bash `deny` now catches the relative spelling, and an absolute `allow` after a broader rule loosens it), then the final paragraph `Refs #910` and `Co-authored-by: Ilker Ulusoy <ilker@ilkerulusoy.com.tr>` (PR [#917]'s span-join mechanism and the issue's alias direction).

7. **`feat(pi-permission-system): report which spelling of a bash command a rule matched`.**
   `PermissionCheckResult.matchedSpelling`, set in `check()`'s `bash-command` branch; `floorToAsk` drops it.
   Tests:
   - `permission-manager-unified.test.ts`: a `bash-command` intent whose spelling alone matches reports it; one whose typed text also matches reports none; an MCP check and a path check whose winning value is not `values[0]` report none.
   - `bash-command.test.ts`: the floored wrapper row carries no `matchedSpelling`.

   Killing mutations: set `matchedSpelling` inside `buildCheckResult` whenever `value !== values[0]` (kills the MCP/path absence test); delete the drop in `floorToAsk` (kills the floor test).

8. **`feat(pi-permission-system): show the matching bash spelling in the ask dialog and the review log`.**
   The request fact, its builders, `asPromptRequest` tolerance, `renderReviewLogFacts`, the `matched as` dialog line, and `COMMAND_BEARING_LOG_KEYS`, in one commit so no intermediate commit writes the spelling unmasked.
   Tests:
   - `tool-ask-payload.test.ts`: stamped from the check, `null` without one;
   - the `asPromptRequest` test: a request without the field parses to `null`;
   - `review-log-renderer.test.ts`: present only when set;
   - `dialog-renderer.test.ts`: the line after `rule`;
   - `command-redaction.test.ts`: `TOKEN=sk-x rm a/x` is masked under `matchedSpelling` as under `command`.

   Update the eight full-literal request assertions.
   Killing mutations: remove `matchedSpelling` from `COMMAND_BEARING_LOG_KEYS` (kills the redaction test); require the field in `asPromptRequest` (kills the absent-field test); drop the `present("matchedSpelling", …)` line (kills the log test).

9. **`docs(pi-permission-system): document the absolute argument spelling of a bash command`.**
   The Module-Level Changes doc list.
   Re-run the step 5 and 6 rows' prose against `docs/configuration.md` so every exclusion the doc names has a test.

## Risks and Mitigations

| Risk                                                                                                                 | Mitigation                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| An invented spelling widens an `allow` (computed word, glob, unknown base)                                           | Each exclusion is a predicate with its own killing mutation (steps 5, 6); the join is exact-span, so an unlocatable token is never rewritten |
| Advisory and gate diverge                                                                                            | One builder for both (steps 1–2) and a parity test (step 6)                                                                                  |
| Advisory latency grows (resolver + existence probes per query)                                                       | Accepted; the gate already pays it per tool call, and the advisory is synchronous by contract either way                                     |
| Collision with Phase 15's [#1027] (`command-enumeration.ts`) and [#880] (`token-collection.ts`, `BashProgram.parse`) | Land before or after them, never beside; recorded in the roadmap disposition                                                                 |
| A secret reaches the log under the new key                                                                           | Step 8 lands the key and its mask in one commit, with a test                                                                                 |
| Exact-assertion churn hides a probe that no longer discriminates                                                     | Step 6's updates change only the `spellings` field; any other diff in an updated literal is a finding                                        |

## Open Questions

- Whether the session-approval suggestion should offer the absolute spelling when it decided; deferred until a user reports re-prompting across spellings.

[#309]: https://github.com/gotgenes/pi-packages/issues/309
[#393]: https://github.com/gotgenes/pi-packages/issues/393
[#481]: https://github.com/gotgenes/pi-packages/issues/481
[#533]: https://github.com/gotgenes/pi-packages/issues/533
[#645]: https://github.com/gotgenes/pi-packages/issues/645
[#840]: https://github.com/gotgenes/pi-packages/issues/840
[#880]: https://github.com/gotgenes/pi-packages/issues/880
[#917]: https://github.com/gotgenes/pi-packages/pull/917
[#923]: https://github.com/gotgenes/pi-packages/issues/923
[#928]: https://github.com/gotgenes/pi-packages/issues/928
[#981]: https://github.com/gotgenes/pi-packages/issues/981
[#1019]: https://github.com/gotgenes/pi-packages/issues/1019
[#1027]: https://github.com/gotgenes/pi-packages/issues/1027
