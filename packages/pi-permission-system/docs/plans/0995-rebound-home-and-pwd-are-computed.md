---
issue: 995
issue_title: "pi-permission-system: `$HOME` and `$PWD` resolve to their startup values after the command reassigns them"
---

# A rebound `$HOME` or `$PWD` is not statically known

## Release Recommendation

**Release:** ship independently

This issue's roadmap step carries `Release: independent`, and the phase's release list names it as a `fix:`.

## Problem Statement

The bash path projection resolves a plain `$HOME` to `os.homedir()` and `$PWD` to the base-relative marker `.`, whatever the command assigned to those names first.
So when an agent runs `HOME=/etc; cat "$HOME/shadow"`, the `external_directory` gate asks about `~/shadow` while the shell reads `/etc/shadow`.
When it runs `HOME=-delete; find "$HOME"`, `find` proves a pure read of the home directory, and bash runs `find -delete` in the working directory.

The issue comment adds the tilde form.
Pi runs `/bin/bash` on Unix (`pi/packages/coding-agent/src/utils/shell.ts`), which on macOS is bash 3.2, and there `~` follows a reassigned `HOME` (measured: `/bin/bash -c 'HOME=/etc; x=~; echo $x'` prints `/etc`; Homebrew bash 5.3 prints the real home).
Separately, a leading `~` is taken to lead with `/` by [#992]'s `mayLeadWithDash`, which holds only while the inherited `HOME` is absolute.

## Goals

- A program that rebinds `HOME` makes its `$HOME`/`${HOME}` references computed, and likewise for `PWD`; a computed reference falls under ADR 0009's computed-path residual and withdraws a guarded core word's read claim like any other computed word.
- A program that rebinds `HOME` also makes a leading unquoted tilde prefix (`~`, `~/…`) computed.
- An unrebound leading tilde prefix may lead with `-` exactly when `os.homedir()` does.
- The rebinding fact is computed once per program and reaches every word read through one collaborator, not a raw parameter each read site re-interprets.
- Not breaking: `fix:` (operator decision).
  Only programs that rebind `HOME`/`PWD` change, measured at 1 of 10,153 distinct logged bash commands (a spike command of the operator's own).

## Non-Goals

- Tracking the *values* a program assigns.
  ADR 0009 declined same-program literal-assignment dataflow ([#694], 45 of 2767 commands); the new `ShellVariables` is a closed set of which of `HOME`/`PWD` are rebound, never a variable environment, so the seam this plan opens does not grow into that dataflow.
- Flooring a program that rebinds `HOME`/`PWD` to `ask`.
  `X=/etc; cat "$X/shadow"` is silent under the same residual today, so a floor keyed on `HOME` alone moves an attacker to `X` and buys nothing.
- Dynamically named bindings: `declare "$n=/etc"`, `read "$n"`, `printf -v "$n"`, `declare -n r=$n`, and `eval`/`source` reached through a wrapper (`builtin eval`, `command source`).
  They become a named ADR 0009 residual.
- `~+` (`$PWD`) and `~-` (`$OLDPWD`): the classifiers accept neither spelling as a path today.
- Turning `token-collection.ts`'s free functions into methods on a collector object, which would remove the functions that only relay the reader.
  The Tidy-First assessor rejected it as scope creep for this change; it is recorded under `#### Deferred tidyings` in the retro for the next `/plan-improvements pi-permission-system`.
- [#981] and PR [#917], which expand `~`/`$HOME` in bash command-pattern values.
  Either would read `HOME`'s startup value too; the `WordReader` seam is where they would get the rebinding fact, but neither is folded in here.
- Changing how an unrebound `~` token displays: it keeps its raw spelling in prompts and logs, and stays not-computed (so `sed -n p ~/x` keeps its read claim).

## Background

- `src/access-intent/bash/shell-variable-expansion.ts` — `resolvePlainVariableExpansion(node)`: a plain reference (exactly one `variable_name` child plus `$`/`${`/`}` delimiters) to `HOME` resolves to `homedir()`, to `PWD` resolves to `.`; a module-level `RESOLVABLE_VARIABLES` map holds the vocabulary.
- `src/access-intent/bash/node-text.ts` — `readArgWord`, `resolveNodeText`, `hasComputedPart`, and the private `isSpelledExactly`/`leadingCharacterMayBeDash`/`mayExpandToDashWord` each call `resolvePlainVariableExpansion` on one node.
  `TSNode` has no parent or tree pointer, and the parse-view passes (`parse-view.ts`) re-parent nodes into rewritten views, so a node cannot find its program; the program-level fact has to be handed in.
- Word readers: `token-collection.ts` (8 functions call node-text directly; `collectPathCandidateTokens`, `collectCommandTokens`, `collectHostedExecutionTokens`, `collectEmbeddedOptionValues`, and `extractCommandName` only relay), `bash-path-resolver.ts` (`BashPathResolver`, constructed once in `program.ts`; collector calls at lines 239, 264, 324, 354, 364, 392, and `extractCommandName` at 415), `command-enumeration.ts` (`readArgWord` at `inlineShellPayloadNode` line 289 and `readCommandUnit` line 498, under the `UnitScope` threaded through the walk; `TOP_LEVEL_SCOPE`/`SALVAGED_SCOPE` at lines 111/126), and `logging/command-redaction.ts` (`resolveNodeText` at 219 and 321, `inlineShellPayloadNode` at 178).
- Entry points that parse: `BashProgram.parse` (`program.ts`), `parseBashCommandsSync` (`sync-commands.ts`), and the redactor's own parse (`command-redaction.ts:99`); the first two run both walkers inside `withSalvagedRoots`.
- `command-effects.ts:219` reads `word.computed ? word.mayLeadWithDash : retractsClaim(…)`, so a computed `$HOME` withdraws `find`'s claim with no change there.
- A computed token's fallback text (`$HOME/shadow`) is rejected by the shape classifiers, which is how ADR 0009's computed-path residual is enforced — there is no separate "computed" filter at projection.
- Package skill constraint: the expansion vocabulary lives only in `shell-variable-expansion.ts`, never in a classifier.

## Design Overview

### What counts as rebinding

Spiked with the package's parser: every binding form carries a `variable_name` node that is not the name child of a plain reference.

| Spelling                                       | Node carrying the name                                        |
| ---------------------------------------------- | ------------------------------------------------------------- |
| `HOME=x`, `HOME+=x`, prefix `HOME=x cmd`       | `variable_assignment > variable_name`                         |
| `export`/`local`/`declare`/`readonly HOME[=x]` | `declaration_command > (variable_assignment >) variable_name` |
| `for HOME in …`                                | `for_statement > variable_name`                               |
| `unset HOME`                                   | `unset_command > variable_name`                               |
| `(( HOME = 1 ))`                               | `binary_expression > variable_name`                           |
| `${HOME:=x}`                                   | `expansion > variable_name` (not plain)                       |

Name-by-argument builtins carry it as a bare `word`: `read HOME`, `printf -v HOME x`, and a nameref value `declare -n r=HOME` (`variable_assignment > word "HOME"`).
`env -i HOME="$HOME" cmd` is a `concatenation`, not a binding, which is correct: the outer shell's `HOME` is unchanged.

The rule, over the program's parse roots (the primary root plus every salvaged root):

1. **Mechanism:** a `variable_name` named `HOME`/`PWD` anywhere except as a plain reference's name child rebinds that name.
2. **Data:** a `word` whose resolved value is exactly `HOME`/`PWD` rebinds it; a command whose name is `eval`, `source`, or `.` rebinds both.

The prefix form (`HOME=x cmd "$HOME"`) does not rebind the current shell in bash (measured), and a non-plain read (`${HOME:-x}`) rebinds nothing; both count anyway, which is the simple, measured-rare direction.
A rebinding anywhere counts, not only before the reference: a loop or a function body can run the assignment first.

Measured over 10,153 distinct bash commands in the local review log (spike walking this rule with `getParser`, discarded): 2 carry a structural binding, 0 a bare-word name, 9 an `eval`/`source`/`.`; 1 of them also references `$HOME`, `$PWD`, or `~`.
A text scan for `\bHOME\b` would instead mark 27 of the 53 `$HOME`-bearing commands (all `env -i HOME="$HOME"`), and over-marking is not the safe direction: a computed token leaves the projection.

### The tilde prefix

A leading unquoted `word` spelled `~` or starting `~/` is a HOME tilde prefix (`~user` reads the password database, not `HOME`).

- **HOME rebound:** the prefix is unresolvable, so `resolveNodeText` renders it in the `$HOME` spelling it abbreviates (`~/shadow` → `$HOME/shadow`), which the classifiers reject exactly as they reject `$HOME/shadow`; the word is computed and may lead with `-`.
- **HOME not rebound:** unchanged value and display (`~/x`), not computed, and `mayLeadWithDash` is `homedir().startsWith("-")` — `os.homedir()` returns the inherited `HOME` verbatim (measured: `HOME=-h node -e …` prints `-h`), which is what Pi's bash inherits (`getShellEnv` spreads `process.env`).

"Leading" means the argument's first part: the word itself, or the first child of a `concatenation`; a `~` later in a word is literal to bash.

### Collaborators

```typescript
// shell-variable-expansion.ts — still the only home of the vocabulary
export class ShellVariables {
  static scan(roots: readonly TSNode[]): ShellVariables;
  static readonly UNREBOUND: ShellVariables;
  /** A plain `$HOME`/`$PWD` reference's value, or null (not plain, not in the set, or rebound). */
  resolveReference(node: TSNode): string | null;
  /** How a leading tilde prefix reads: its `$HOME` spelling when rebound, else whether it leads with `-`. */
  tildePrefix(): { kind: "rebound"; spelling: "$HOME" } | { kind: "home"; leadsWithDash: boolean };
}

// node-text.ts — node-text reads bound to one program's vocabulary
export class WordReader {
  constructor(private readonly variables: ShellVariables) {}
  argWord(node: TSNode): ArgWord;    // was readArgWord
  text(node: TSNode): string;        // was resolveNodeText
  isComputed(node: TSNode): boolean; // was hasComputedPart
}
```

The exact `tildePrefix` shape is the implementer's call; the constraint is that the tilde rule is decided in `ShellVariables`, and `WordReader` asks rather than re-deriving it.

A consumer's call site, for Tell-Don't-Ask:

```typescript
function commandArgumentWords(node: TSNode, words: WordReader): ArgWord[] {
  // …
  out.push(words.argWord(child));
}
```

Wiring, inside each entry point's `withSalvagedRoots` callback:

```typescript
const words = new WordReader(ShellVariables.scan([tree.rootNode, ...salvaged]));
new BashPathResolver(normalizer, words, options?.workdir).resolve(tree.rootNode, salvaged);
collectCommands(tree.rootNode, words); // → UnitScope.words
```

`ShellVariables` imports only `parser` types and `node:os`; `node-text.ts` already imports `shell-variable-expansion.ts`, and the scan needs the resolved value of a `word` (step 5), which it reads from the node's text directly (a bare word has no quoting to remove), so no `shell-variable-expansion.ts` → `node-text.ts` edge and no cycle.
`WordReader` reads one collaborator (`ShellVariables`) and exposes three methods; consumers depend on it alone, never on `ShellVariables`.

### Edge cases

- A rebinding inside a salvaged region counts, because the scan covers the salvaged roots.
- `cd` changes `PWD`, but a `$PWD` reference already reads as the base marker the resolver folds `cd` into, so `cd` is not a rebinding.
- `unset HOME` then `$HOME/x` expands to `/x` (measured), covered because `unset` rebinds.
- `bash -c 'HOME=/etc; …'`'s payload is a string at the outer level, so it rebinds nothing outside; the payload itself is floored, not projected.

## Module-Level Changes

- `src/access-intent/bash/shell-variable-expansion.ts` — `ShellVariables` (`scan`, `UNREBOUND`, `resolveReference`, the tilde rule) replaces `resolvePlainVariableExpansion` and `RESOLVABLE_VARIABLES`; the module doc names the closed rebinding set.
- `src/access-intent/bash/node-text.ts` — `WordReader` replaces the exported `readArgWord`/`resolveNodeText`/`hasComputedPart`; the private helpers read the reader's vocabulary; the `word` case gains the leading-tilde handling.
- `src/access-intent/bash/token-collection.ts` — the 8 reading functions and the 5 relays take a `WordReader`.
- `src/access-intent/bash/bash-path-resolver.ts` — `BashPathResolver` holds the reader and passes it to the collectors and `extractCommandName`.
- `src/access-intent/bash/command-enumeration.ts` — `UnitScope` gains `words`; `TOP_LEVEL_SCOPE`/`SALVAGED_SCOPE` become builders taking the reader; `collectCommands`, `collectSalvagedCommands`, and `inlineShellPayloadNode` take it.
- `src/access-intent/bash/program.ts`, `src/access-intent/bash/sync-commands.ts` — build the reader from the scan and pass it to both walkers.
- `src/logging/command-redaction.ts` — builds a reader from its own tree's scan.
- `src/access-intent/bash/command-effects.ts` — predicted unchanged: it reads `ArgWord.computed`/`mayLeadWithDash`, which the reader now produces.
- `src/access-intent/bash/token-classification.ts` — predicted unchanged: the rebound tilde reaches it in its `$HOME` spelling, which it already rejects.
- Tests: `test/access-intent/bash/shell-variable-expansion.test.ts`, `node-text.test.ts`, `token-collection.test.ts` (25 collector calls), `command-enumeration.test.ts` (3), `bash-command-metamorphic.test.ts` (2), `program-external-accesses.test.ts`, `program.test.ts`, `test/logging/command-redaction*.test.ts` (as the signature change reaches them).
  `test/helpers/arg-words.ts` and `wrapper-analysis.test.ts` build `ArgWord` literals and are predicted unchanged, since `ArgWord`'s shape does not change.
- `docs/decisions/0009-bash-path-projection-completeness-contract.md` — an amendment: the `HOME`/`PWD` exception (lines 258–259, 343–346) holds only while the program does not rebind the name; the computed-paths residual (line 312) gains the rebound reference and the dynamically named bindings; the vocabulary note (line 400) names `ShellVariables` as a per-program value.
- `docs/architecture/architecture.md` — the `node-text.ts` (line 919) and `shell-variable-expansion.ts` (line 921) module-tree entries; the roadmap step `#### [#995]` gains `✅` and a `Landed:` note, and Mermaid node `S995` gains `✅`.
- `docs/configuration.md` — the bash projection list (lines 788, 792): the plain variables resolve unless the command rebinds them.
- `.pi/skills/package-pi-permission-system/SKILL.md` — the closing paragraph's "`~` follows the inherited `HOME`" becomes "`~` follows the inherited `HOME`, or on bash 3.2 a reassigned one".

## Test Impact Analysis

1. New tests the change enables: `ShellVariables.scan` over real parses (every row of the rebinding table, plus controls), independent of projection; `WordReader` with `ShellVariables.UNREBOUND` versus a rebound vocabulary on the same node.
2. Redundant tests: `shell-variable-expansion.test.ts`'s `resolvePlainVariableExpansion` cases move onto `resolveReference` unchanged in substance; none are dropped.
3. Kept as-is: `program-external-accesses.test.ts`'s `$HOME` cases (they pin the unrebound projection, which must not move) and `node-text.test.ts`'s `mayLeadWithDash` table from [#992] (re-pointed at a reader, same expectations).

## Invariants at risk

- [#694]: `$HOME/x` gates exactly as `~/x` and the absolute spelling when nothing rebinds `HOME`.
  Pinned by `program-external-accesses.test.ts` (`join(homedir(), …)` expectations at lines 99, 153); these pass through the real `BashProgram.parse`, so they pin the wiring as well.
- [#992]: a computed word withdraws a guarded word's claim only when it may lead with `-`, so `find packages/*/docs` still reads.
  Pinned by the `mayLeadWithDash` table in `node-text.test.ts` and the `find` cases in `program.test.ts`; step 6 must leave `find ~/x -name y` a read under an unrebound absolute home.
- [#924]: `sed`/`awk` withdraw on any computed argument, so an unrebound `~` must stay not-computed or `sed -n p ~/x` loses its read claim.
  Step 7 adds a pin for it.
- Log redaction ([#923]): the redactor's `resolveNodeText` reads header fields; its tests must stay green on the reader.

## TDD Order

1. `refactor(pi-permission-system): hold the resolvable shell variables in a value` Add `ShellVariables` with `UNREBOUND` and `resolveReference` (today's behavior), and `WordReader` over it; keep `readArgWord`/`resolveNodeText`/`hasComputedPart` and `resolvePlainVariableExpansion` as thin delegates (prose comment, not `@deprecated`) so every caller stays green.
   Tests: `shell-variable-expansion.test.ts` gains `resolveReference` cases matching the existing ones.
   Killing mutation: make `resolveReference` return `null` for `PWD`.
2. `refactor(pi-permission-system): read path tokens through the program's word reader` Prepares the relay friction the assessor counted: `BashPathResolver` takes a `WordReader`; the 13 `token-collection.ts` functions take it; `program.ts` passes `new WordReader(ShellVariables.UNREBOUND)`.
   Update `token-collection.test.ts` and `bash-command-metamorphic.test.ts` in the same commit (the signature change breaks them at the type level).
   No new tests; the suite stays green.
3. `refactor(pi-permission-system): enumerate command units through the program's word reader` `UnitScope.words`; scope builders replace `TOP_LEVEL_SCOPE`/`SALVAGED_SCOPE`; `collectCommands`, `collectSalvagedCommands`, `inlineShellPayloadNode` take the reader; `program.ts`, `sync-commands.ts`, and `command-redaction.ts` pass it; `command-enumeration.test.ts` and the redaction tests follow.
4. `test(pi-permission-system): read words through WordReader in the node-text tests` Move `node-text.test.ts` (18 calls) and `shell-variable-expansion.test.ts` onto `WordReader`/`resolveReference`, then delete the four free-function delegates.
   Run `pnpm fallow dead-code` after, since the delegates' removal is its only signal.
5. `fix(pi-permission-system): a reassigned $HOME or $PWD is no longer resolved to its startup value` Mechanism: `ShellVariables.scan` applies rule 1 (a `variable_name` outside a plain reference), and the three entry points build their reader from `scan([root, ...salvaged])`.
   Tests: `scan` over real parses of each table row (rebinds) and of `cat "$HOME/x"`, `echo ${HOME}`, `env -i HOME="$HOME" cmd` (does not); `program-external-accesses.test.ts`: `HOME=/etc; cat "$HOME/shadow"` projects no path under `homedir()`, `PWD=/etc; cat "$PWD/x"` projects no `./x`; `program.test.ts`: `HOME=-delete; find "$HOME"` withdraws `find`'s read claim; a rebinding after the reference (`cat "$HOME/x"; HOME=/etc`) still counts.
   Killing mutations: make `scan` return `UNREBOUND` unconditionally (kills every rebinding test); drop the plain-reference exclusion so every `variable_name` rebinds (kills the three controls); scan only `tree.rootNode` in `program.ts` (kills a salvaged-region rebinding test — confirm at Red that the chosen line, e.g. an [#985]-style `cat <<EOF ; HOME=/etc` line, actually salvages, and if no such shape reaches the salvage, record that and drop the case).
6. `fix(pi-permission-system): a name read, printf -v, nameref, eval, or source counts as reassigning $HOME` Data half: rule 2 (a `word` valued exactly `HOME`/`PWD`; a command named `eval`/`source`/`.`).
   Tests: `scan` rebinds for `read HOME`, `printf -v HOME x`, `declare -n r=HOME`, `eval x`, `source f`, `. f`; does not for `echo HOMEDIR`, `find .` (the `.` is an argument, not a command name).
   Write the `. f` row first and confirm tree-sitter names the command `.` before writing the rest.
   Killing mutations: drop the `word` clause (kills the three name-builtin rows); drop `"."` from the command set (kills `. f` only); match `.` as any word rather than a command name (kills `find .`).
7. `fix(pi-permission-system): ~ is no longer resolved to the home directory after the command reassigns HOME` The rebound tilde rule: a leading `~`/`~/` word under a rebound `HOME` renders as `$HOME…` and is computed.
   Tests: `HOME=/etc; cat ~/shadow` projects no path under `homedir()`; `HOME=-delete; find ~` withdraws; `echo a~/x` is unaffected (not leading); unrebound `sed -n p ~/x` keeps its read claim and `cat ~/x` still projects (controls).
   Killing mutations: make the tilde rule ignore rebinding (kills the two rebound cases); apply it to any `~` in the word (kills `a~/x`); mark every tilde word computed (kills the `sed` control).
8. `fix(pi-permission-system): ~ may spell an option when the inherited HOME begins with a dash` The unrebound tilde's `mayLeadWithDash` follows `homedir()`.
   Tests (`vi.stubEnv("HOME", "-h")`, `vi.unstubAllEnvs()` in `afterEach`): `find ~` withdraws; with an absolute `HOME`, `find ~/x -name y` still reads.
   Killing mutation: hard-code the tilde lead to `false`.
9. `docs(pi-permission-system): record that a reassigned $HOME or $PWD is not resolved` ADR 0009 amendment, the two `architecture.md` module-tree entries, the roadmap `✅` on `#### [#995]` and node `S995` with its `Landed:` note (re-measure the changed-command count over the review log with the real `BashProgram.parse` before and after and write the number it prints), `docs/configuration.md`, and the package skill sentence.

## Risks and Mitigations

- **A missed call site keeps reading the startup vocabulary.**
  Step 4 deletes the free functions, so any caller not migrated fails `tsc`; the reader parameter is required everywhere.
- **Over-marking drops correct projections.**
  The rule is structural, not textual; step 5's controls pin `env -i HOME="$HOME"` and plain references as unrebound.
- **The tilde rewrite leaks into display.**
  It applies only under a rebound `HOME`, where the token is no longer projected; step 7's control pins that an unrebound `~/x` still projects as typed.
- **Scope creep toward assignment dataflow.**
  `ShellVariables` holds a set of rebound names, never values (Non-Goals).

## Open Questions

- Whether `builtin eval`/`command source` should rebind too; deferred to the ADR residual unless implementation finds the peel already available at the scan.

[#694]: https://github.com/gotgenes/pi-packages/issues/694
[#917]: https://github.com/gotgenes/pi-packages/pull/917
[#923]: https://github.com/gotgenes/pi-packages/issues/923
[#924]: https://github.com/gotgenes/pi-packages/issues/924
[#981]: https://github.com/gotgenes/pi-packages/issues/981
[#985]: https://github.com/gotgenes/pi-packages/issues/985
[#992]: https://github.com/gotgenes/pi-packages/issues/992
