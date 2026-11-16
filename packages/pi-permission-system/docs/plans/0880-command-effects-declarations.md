---
issue: 880
issue_title: "pi-permission-system: commandEffects — user-declared command effects (ADR 0013 §7)"
---

# `commandEffects`: the user declares what their own tools do

## Release Recommendation

**Release:** mid-batch — defer (batch "declared-effects"); confirm at ship time

The roadmap tags this issue's Phase 15 step `Release: batch "declared-effects"`, whose members are this issue and [#881], with [#881] as the tail.
They ship together because [#881]'s blame line tells the user to declare an effect in `commandEffects`, and that sentence must not reach users before the key exists.

## Problem Statement

ADR 0013 §7 gives the deterministic bash layer three effect sources: syntax (redirect operators), the package-audited pure-reader core, and user declarations.
The package ships the first two.
Without the third, every subcommand- or option-dependent reader (`git log`, `git diff`, `strings`) is unproven, so its path tokens consult both directional surfaces and an `external_directory_write: {"*": "ask"}` rule asks about a read.
The comments on the issue show the cost from both sides: a read-only scout agent is denied `git diff <ref> -- file` by its `path_write: deny`, and a planning session's `git log … -- packages/…` in a sibling checkout landed on the bare `external_directory` surface while its `grep`/`sed` neighbours resolved as reads.

`docs/configuration.md` already describes the key as shipped ("A user `commandEffects` declaration participates in effect classification"), but `unifiedConfigSchema` is a `strictObject` with no such key.
Following that sentence today does worse than nothing: the whole config file is rejected, and the scope falls back to universal `ask`.

The shape-indistinguishable false positive ([#797]'s `officecli set data.xlsx /Sheet1/B1`) has no lever at all today; `effects: []` is the declaration-side lever for it.

## Goals

- A top-level `commandEffects` config key in ADR 0013 §7's shape: exact bare-basename command keys, `effects` (`"read"` | `"write"` | an array, `[]` meaning no filesystem effect), `unlessOption` stems, recursive `subcommands`; no patterns, no wildcards.
- Declarations merge shallowly by command key across global and project scopes (a project entry overrides a colliding command and never drops the global long tail), from user config scopes only; agent frontmatter cannot declare.
- A declared command's operand tokens route by the declared effect: `read` to `_read`, `write` to `_write`, both or a retracted declaration to the bare family.
- `effects: []` withdraws the command's operands from the `path` and `external_directory` surfaces entirely (the [#797] acceptance case), while the `bash` surface keeps governing the command, including its absolute argument spellings.
- The review log's `effectSource` reads `declared-global` or `declared-project`, so a surprising allow is auditable to the scope that declared it.
- Subcommand descent is settled in writing as **exact-word** (an ADR 0013 amendment), which Phase 17's [#804] inherits.
- A declaration keyed by a pure-reader core word is inert, and config load reports it as shadowed rather than ignoring it silently.
- `scripts/measure-core-coverage.mjs` accepts a declarations file and reports the share of asks it relieves.
- Not breaking: the key is new and optional, and the only configs whose behavior changes are ones that set `commandEffects` and are rejected today.
  Commit type `feat:`.

## Non-Goals

- **Option-skipping subcommand descent** (`git -C ~/other log` resolving as `git log`).
  It needs a grammar of which options take a value, which is §10's structured-rule language and [#804]'s scope; this change records the decision and leaves such forms unproven.
- **Declarations lifting the wrapper floor.**
  ADR 0013 §11 keeps the exemption package-audited: `xargs git log` keeps `<indirection-bash-wrapper>` whatever is declared, and a wrapper's inner command gets no declared attribution for its path tokens either (the core does not attribute through a wrapper today, and neither will a declaration).
- **An agent-frontmatter channel.**
  ADR 0013 §7 and §9 close it until [#799] decides the channel set; the scout use case on this issue (agent-specific declarations) is [#799]'s question.
- **Blame in the ask.**
  Rendering `effectSource` onto the ask payload and dialog is [#881], the batch tail.
- **The undeclared tool.**
  Judgment over a token naming nothing on disk is [#882].
- **Extension and MCP tool declarations** (`toolEffects`, [#952]) and transparent-wrapper aliases ([#926]): both mirror the shape this change creates and stay deferred to Phase 17 per the roadmap's sweep.
- **The advisory bash query** (`src/service/bash-advisory-check.ts`) is not threaded.
  It reads only `BashProgram.commands()`, and declarations never change a command unit (wrapper analysis stays core-only and inert operands keep their spellings).
- **Ancestor project configs** (third-party PR [#1073]) are not anticipated; if it lands first, every ancestor scope labels as `project`.

## Background

- `src/access-intent/bash/command-effects.ts` owns the core: `proveCommandEffect(headWord, argWords)` answers `{read, core}`, `RETRACTED_EFFECT` (`{unproven, retracted}`) when a guard withdraws the claim, or `UNPROVEN_EFFECT`.
  The option-guard matchers (`optionGuard`, `retractsClaim`, `matchesLongStem`, `matchesShortCluster`) are file-private.
  `wrapper-analysis.ts`'s `floorExemptionOf` calls `proveCommandEffect` too, which is exactly the call that must stay core-only.
- `src/access-intent/effect.ts` holds `EffectSource` (`syntax` | `core` | `retracted` | `unproven`), `TokenEffect`, `UNPROVEN_EFFECT`, and `mergeTokenEffects`.
- `src/access-intent/bash/token-collection.ts`: `collectCommandTokens` calls `proveCommandEffect` once per `command` node and stamps that effect on every token the command owns, while nested executions keep their own attribution.
  Each `PathToken` carries a `TokenRole` (`operand` | `redirect-destination`); the role decides candidacy and the effect decides direction.
  Seven collectors relay `words: WordReader` through the recursion: `collectPathCandidateTokens`, `collectCommandTokens`, `collectRedirectTokens`, `collectHostedExecutionTokens`, `collectStatementOperandTokens`, `collectPatternCommandTokens`, `collectGenericCommandTokens` (counted by the Tidy-First assessor, about 21 call sites).
- `src/access-intent/bash/bash-path-resolver.ts`: `projectExternalPaths` and `projectRuleCandidates` turn tokens into the two path slices; `projectRuleCandidates` also records each whole-argument token's absolute spelling, which `readCommandUnit` swaps into a `bash` command unit's `spellings`.
- `src/access-intent/bash/program.ts`: `BashProgram.parse(command, normalizer, options?: { workdir?: string })`, with `{ workdir?: string }` spelled inline on `parse`, `parseSync`, and `build`.
- `src/handlers/gates/tool-call-gate-pipeline.ts`: `ToolCallGateInputs` (implemented by `PermissionSession`) supplies `getShellToolAliases()`; the pipeline parses one `BashProgram` per call.
- `src/config/`: `unifiedConfigSchema` (zod 4.4.3, `strictObject`), `mergeUnifiedConfigs` (with the `shellTools` shallow-merge precedent), `loadAndMergeConfigs` (five layers: legacy global policy, legacy extension config, new global, legacy project policy, new project; the project layers skipped when the project is untrusted), and `ConfigStore` (`refresh`, `current`, `save`).
- `src/access-intent/bash/bash-arity.ts`'s `prefix` counts tokens through a curated table and does not skip options: `prefix(["git", "-C", "~/other", "log"])` returns `["git", "-C"]` (read from the code).
  So ADR 0013 §10's sentence that the arity table makes `git -C ~/other diff` resolve as `git diff` does not describe any mechanism the package has.
- Fallow zones: `access-intent` may import `config`; `config` may not import `access-intent`; the root zone (`index.ts`) may import both (`pnpm --silent fallow guard packages/pi-permission-system/src/index.ts`, run at planning time).
- AGENTS.md constraints that apply: pnpm only, never edit `schemas/permissions.schema.json` by hand (`pnpm run gen:schema`), and a session that edits `src/` keeps running the pre-change extension.

## Design Overview

### Decisions (operator-confirmed at planning)

1. **Descent is exact-word.**
   The first argument word after the head, or after the matched parent subcommand, must be literal and equal a declared subcommand key.
   An entry that declares `subcommands` yields `UNPROVEN_EFFECT` when its next word is computed or begins with `-`, because the subcommand that will run cannot be told.
   Measured on the local review log (crude regex over 1563 bash `waiting` entries, 2026-10-16): git appears about 408 times, the direct reader forms (`log` 76, `diff` 18, `status` 15, `show` 10, `rev-list` 10, `grep` 6, `rev-parse` 6, `ls-files` 6) are reachable by exact descent, and the option-led forms are 38 `-C` and 2 `-c` occurrences (`-C … log` 10), which stay unproven.
   Skipping every dash word was rejected because it fails open: `git -C diff commit` (a directory named `diff`) would classify as `git diff`.
2. **The core wins.**
   Declarations are consulted only when the core proves nothing (`source: "unproven"`).
   A core retraction stands, so a declared `sed` cannot turn a script with a `w` command back into a read.
   A declaration whose key is a core word is reported once at config load (a config issue), naming the key.
   ADR 0013 §7's own `sed`/`sort` examples and the issue's `sed` example are shadowed by the core since [#924]; the docs recipe uses `git`, `curl`, and `officecli` instead.

### Decisions made in planning

- **Bare basenames only.**
  A head word containing `/` or `\` matches no declaration, the same rule (and the same separator check) the core applies: `./git log` is undeclared.
- **Own head word only.**
  A declaration attributes the operands of a unit whose head word is the declared command, never a wrapper's inner command.
- **Guards accumulate along the descent path** and are matched over every argument word of the unit, with the core's fail-closed matcher: a single-letter stem (`-i`) anywhere in a single-dash cluster, including an attached value (`-i.bak`, `-ni`); a long stem (`--in-place`) bare, with `=value`, or as any abbreviation; a longer single-dash stem (`-exec`) as the exact word or with an attached suffix; and any computed word that may lead with `-`.
  A match yields the existing `RETRACTED_EFFECT`, never a substitute effect.
- **Effect mapping.**
  `"read"` / `["read"]` → `{read, declared-<scope>}`; `"write"` / `["write"]` → `{write, declared-<scope>}`; `["read", "write"]` → `{unproven, declared-<scope>}` (proven-both and unproven consult the same two surfaces); `[]` → inert operands; an entry without `effects` at the reached node → `UNPROVEN_EFFECT` (undeclared is unknown).
- **`[]` is a role, not an effect.**
  The role already decides candidacy and the effect decides direction, so `[]` stamps a new `TokenRole`, `inert-operand`, on the command's own tokens, with `{unproven, declared-<scope>}` as their effect, so a projection that ever forgets the role check fails closed.
  `projectExternalPaths` drops an inert token at the loop top.
  `projectRuleCandidates` records its absolute argument spelling first and then drops it before the dedupe fold, so a `bash` rule written against an absolute path still matches the command, and an inert token never folds with a real attribution of the same path (`officecli x ~/a; cat ~/a` keeps `cat`'s read).
- **Own-key lookups use `Object.hasOwn`**, at the command level and at every `subcommands` level.
  A head word `constructor` or `toString` must not read `Object.prototype`.
- **Provenance:** `EffectSource` gains `"declared-global"` and `"declared-project"`, flat values, because the review log writes one `effectSource` field and [#881] renders it as one enum.
  Legacy global files count as `global` and the legacy project policy file as `project`.
- **Scope lives in config, held by `ConfigStore`.**
  `config` cannot import `access-intent`, and the scope is load provenance rather than a config value.
  `loadAndMergeConfigs` folds a scope-stamped map per layer, and `mergeUnifiedConfigs` deliberately does not merge `commandEffects`.
  `ConfigStore` keeps the result in a private field exposed through `SessionConfigStore.declaredCommandEffects()`, not on `PermissionSystemExtensionConfig`.
  The Tidy-First assessor found that a runtime-config field would be dropped by `ConfigStore.save()`, which rebuilds the config through `normalizePermissionSystemConfig`.
- **The shadow detector gets the core roster by injection.**
  `ConfigStoreDeps.coreCommandWords` is supplied by `index.ts` from `PURE_READER_CORE`, so `config/` gains no edge into `access-intent/`.

### Shapes

```typescript
// src/config/config-schema.ts
const declaredEffectsSchema = z.union([effectSchema, z.array(effectSchema)]); // effectSchema = z.enum(["read", "write"])
const commandEffectsEntrySchema = z
  .strictObject({
    effects: declaredEffectsSchema.optional(),
    unlessOption: z.array(optionStemSchema).optional(), // ^-{1,2}[^-=\s][^=\s]*$
    get subcommands() {
      return z.record(subcommandKeySchema, z.union([commandEffectsEntrySchema, declaredEffectsSchema])).optional();
    },
  })
  .meta({ id: "commandEffectsEntry", description, markdownDescription });
const commandEffectsSchema = z.record(commandKeySchema, commandEffectsEntrySchema); // key: ^[^/\\\s]+$
export type CommandEffectsEntry = z.infer<typeof commandEffectsEntrySchema>;
export type CommandEffectsConfig = z.infer<typeof commandEffectsSchema>;

// src/config/command-effects-config.ts
export type DeclarationScope = "global" | "project";
export interface DeclaredCommandEffect {
  readonly scope: DeclarationScope;
  readonly entry: CommandEffectsEntry;
}
export type DeclaredCommandEffects = Readonly<Record<string, DeclaredCommandEffect>>;
export const NO_DECLARED_COMMAND_EFFECTS: DeclaredCommandEffects = {};
export function foldDeclaredCommandEffects(
  base: DeclaredCommandEffects,
  layer: CommandEffectsConfig | undefined,
  scope: DeclarationScope,
): DeclaredCommandEffects;
export function detectShadowedCommandEffects(
  declared: DeclaredCommandEffects,
  coreWords: ReadonlySet<string>,
): string | undefined;

// src/access-intent/effect.ts
export type EffectSource =
  | "syntax" | "core" | "declared-global" | "declared-project" | "retracted" | "unproven";
export const RETRACTED_EFFECT: TokenEffect; // moved from command-effects.ts

// src/access-intent/bash/declared-command-effects.ts
export type OperandAttribution =
  | { readonly kind: "effect"; readonly effect: TokenEffect }
  | { readonly kind: "inert"; readonly effect: TokenEffect }; // effect: {unproven, declared-<scope>}
export function proveDeclaredEffect(
  declared: DeclaredCommandEffects,
  headWord: string,
  argWords: readonly ArgWord[],
): OperandAttribution;

// src/access-intent/bash/command-effects.ts
/** Core first; the declarations only when the core proves nothing. */
export function attributeCommandOperands(
  headWord: string,
  argWords: readonly ArgWord[],
  declared: DeclaredCommandEffects,
): OperandAttribution;
```

`ArgWord` reaches `declared-command-effects.ts` the same way it reaches the core: `token-collection.ts` reads it and the prover stays pure and word-based.

### Call sites

```typescript
// token-collection.ts — collectCommandTokens, the one consumer
const attribution = attributeCommandOperands(extractCommandWord(node, words) ?? "", commandArgumentWords(node, words), declared);
const operand = attribution.kind === "inert"
  ? { effect: attribution.effect, role: "inert-operand" }
  : { effect: attribution.effect, role: "operand" };
// the pattern/generic walkers and collectEmbeddedOptionValues take `operand` in place of `effect`

// tool-call-gate-pipeline.ts — evaluate
await BashProgram.parse(shell.command, normalizer, { workdir: shell.workdir, commandEffects: this.inputs.getCommandEffects() });
```

The pipeline asks its input for a value and hands it on; it never reaches through the session to the store (`PermissionSession.getCommandEffects()` delegates to `configStore.declaredCommandEffects()`).
`BashPathResolver` takes `declared` as an optional constructor argument defaulting to `NO_DECLARED_COMMAND_EFFECTS`, so its three test constructions stay untouched; the seven collectors take it as a required parameter so a missed relay is a compile error.

### Edge cases stated as behavior (each pinned in the step named)

| Case                                                                               | Outcome                                                             | Step |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---- |
| `officecli set data.xlsx /Sheet1/B1`, `officecli: {effects: []}`                   | no external access, no rule candidate                               | 6    |
| same, `bash` deny on an absolute spelling of `sub/data.xlsx`                       | unit still spelled, deny still matches                              | 6    |
| `officecli x ~/a; cat ~/a`                                                         | `~/a` external with `cat`'s `{read, core}`, not folded              | 6    |
| `officecli $(cat /etc/hosts) x`                                                    | `/etc/hosts` keeps `{read, core}`                                   | 6    |
| `officecli x > ~/out`                                                              | `~/out` still projected `{write, syntax}`                           | 6    |
| `git log ~/x`, `git: {subcommands: {log: "read"}}`                                 | `~/x` `{read, declared-global}`                                     | 5    |
| `git -C ~/x log`, `git $SUB log`                                                   | unproven                                                            | 4    |
| `git push` with only `log` declared, no top-level `effects`                        | unproven                                                            | 4    |
| `git diff --output=~/x` with `diff: {effects: "read", unlessOption: ["--output"]}` | retracted                                                           | 4    |
| guard declared on the parent, used under a subcommand                              | retracted (guards accumulate)                                       | 4    |
| `./git log`, `/usr/bin/git log`                                                    | undeclared                                                          | 4    |
| `constructor x`, `git toString`                                                    | undeclared / unproven                                               | 4    |
| `sed -i x ~/f` with `sed: {effects: "read"}` declared                              | core decides (retracted)                                            | 5    |
| `xargs git log ~/x` with `git log` declared                                        | unit keeps the wrapper floor; `~/x` unproven                        | 5    |
| a project config declaring a command the global also declares                      | project entry wins whole, global long tail kept, `declared-project` | 3, 7 |
| untrusted project                                                                  | project declarations not loaded                                     | 7    |
| `commandEffects: {sed: …}`                                                         | config issue naming `sed` as shadowed                               | 8    |

## Module-Level Changes

- `src/access-intent/bash/option-guards.ts` (new, step 1): `RetractionGuard`, `ClaimWithdrawal`, `optionGuard`, `retractsClaim`, `matchesLongStem`, `matchesShortCluster`, moved verbatim from `command-effects.ts`; step 4 adds the exact-or-attached single-dash match kind as a new `RetractionGuard` field.
- `src/access-intent/effect.ts`: `RETRACTED_EFFECT` moves here (step 1); `EffectSource` gains the two declared values (step 4).
- `src/access-intent/bash/command-effects.ts`: imports the guards and `RETRACTED_EFFECT` (step 1); gains `attributeCommandOperands` (step 4); the roster's exclusion comment row for `git`/`pnpm`/… names `commandEffects` as where they live.
  `proveCommandEffect` is unchanged and stays the wrapper analysis's core-only entry.
- `src/access-intent/bash/declared-command-effects.ts` (new, step 4): `OperandAttribution`, `proveDeclaredEffect`.
- `src/access-intent/bash/program.ts`: `BashParseOptions` named (step 2), gains `commandEffects?: DeclaredCommandEffects` (step 5).
- `src/access-intent/bash/bash-path-resolver.ts`: optional `declared` constructor argument relayed to the collectors (step 5); inert-role drop in both projections, after spelling in `projectRuleCandidates` (step 6).
- `src/access-intent/bash/token-collection.ts`: `declared` relayed through the seven collectors; `collectCommandTokens` calls `attributeCommandOperands`; the walkers take `{effect, role}` (step 5); `TokenRole` gains `inert-operand` (step 5).
- `src/config/config-schema.ts`: `commandEffectsEntrySchema`, `commandEffectsSchema`, and their types (step 3); `commandEffects` joins `unifiedConfigSchema` with `.meta({ description, markdownDescription, examples })` (step 7).
- `src/config/command-effects-config.ts` (new): `DeclarationScope`, `DeclaredCommandEffect`, `DeclaredCommandEffects`, `NO_DECLARED_COMMAND_EFFECTS`, `foldDeclaredCommandEffects` (step 3), `detectShadowedCommandEffects` (step 8).
- `src/config/config-loader.ts`: `loadAndMergeConfigs` folds each layer with its scope through a local `foldDeclared` helper; `MergedConfigResult.declaredCommandEffects` (required); `mergeUnifiedConfigs`' doc comment says why `commandEffects` is not merged there (step 7).
- `src/config/config-store.ts`: private `declared` field set in `refresh`; `SessionConfigStore.declaredCommandEffects()` (step 7); `ConfigStoreDeps.coreCommandWords` and the shadow issue appended in `refresh` (step 8).
- `src/config/extension-config.ts`: predicted **unchanged**: the scoped map is held by `ConfigStore`, never by `PermissionSystemExtensionConfig`, which is what keeps `save()` from dropping it.
- `src/session/permission-session.ts`: `getCommandEffects()` (step 7).
- `src/handlers/gates/tool-call-gate-pipeline.ts`: `ToolCallGateInputs.getCommandEffects()`; `evaluate` passes it to `BashProgram.parse` (step 7).
- `src/index.ts`: passes `PURE_READER_CORE` as `coreCommandWords` (step 8).
- `src/service/bash-advisory-check.ts`: predicted **unchanged**, on the claim that `commands()` is independent of declarations (pinned in step 6 by the spelling test and in step 5 by the wrapper-floor test).
- `src/access-intent/bash/wrapper-analysis.ts`: predicted **unchanged**; it keeps calling `proveCommandEffect`.
- `src/handlers/gates/bash-path.ts`, `bash-external-directory.ts`: predicted **unchanged**; they already stamp `worstEntry.effect.source` as `effectSource`, so the new values flow through.
- `schemas/permissions.schema.json`: regenerated (`pnpm run gen:schema`, step 7); a fourth `$defs` entry, `commandEffectsEntry` (spiked at planning: zod 4.4.3 emits the recursive entry as `$defs/commandEffectsEntry` with a self `$ref`).
- `config/config.example.json`: a `commandEffects` example with `git` readers (step 10).
- `scripts/measure-core-coverage.mjs`: `--declarations <file>` (step 9).
- Tests:
  - `test/access-intent/bash/declared-command-effects.test.ts` (new, step 4), using `test/helpers/arg-words` (`literalArgWords`, `computedArgWord`).
  - `test/config/command-effects-config.test.ts` (new, steps 3 and 8).
  - `test/access-intent/bash/command-effects.test.ts` (step 4: `attributeCommandOperands`).
  - `test/access-intent/bash/token-collection.test.ts`: the relay updates eight call sites (the helpers at lines 30, 34, and 38 and the inline calls at 495, 961, 1205, 1404, and 1475), plus role tests (step 5).
  - `test/access-intent/bash/program.test.ts` and `program-external-accesses.test.ts` (steps 5 and 6).
  - `test/access-intent/effect.test.ts` (step 4 if a merge case is added).
  - `test/config/config-schema.test.ts` and `config-loader.test.ts` (steps 3 and 7).
  - `test/config/config-store.test.ts`: seven `mockLoadAndMergeConfigs` return values gain `declaredCommandEffects` (step 7); `makeStore` gains `coreCommandWords` (step 8).
  - `test/helpers/session-fixtures.ts`: `makeConfigStore` gains a `declaredCommandEffects` default (step 7).
  - `test/helpers/gate-fixtures.ts`: `makeGateInputs` gains `getCommandEffects` (step 7).
  - `test/handlers/gates/tool-call-gate-pipeline.test.ts` and `bash-external-directory.test.ts` (step 7).
- Docs (step 10):
  - `docs/configuration.md`: a `commandEffects` section; a row in the "Which direction" table; the "Declarations and privilege" sentence made true; recipes for `git`, `curl`, and `officecli`, with the `external_directory_read` adoption recipe beside them.
  - `README.md`: a sentence beside the `shellTools` one.
  - `docs/decisions/0013-permission-policy-model.md`: an amendment covering the exact-word descent, core precedence, `[]` as inert operands that keep their `bash` spellings, the provenance values, and own-head-word-only.
  - `docs/architecture/architecture.md`:
    - Module-tree entries for `option-guards.ts`, `declared-command-effects.ts`, `command-effects-config.ts`, and the `effect.ts`, `command-effects.ts`, `token-collection.ts`, `bash-path-resolver.ts`, and `config-store.ts` entries.
    - `✅` on the `#### [#880]` heading and the `S880` Mermaid node.
    - A `Landed:` note.
    - The `commandEffects` health-metric row checked.
  - `.pi/skills/package-pi-permission-system/SKILL.md`: the Configuration section's "merge it in `mergeUnifiedConfigs()`" rule gains the `commandEffects` exception (scope-stamped fold, held by `ConfigStore`).

## Test Impact Analysis

1. Enabled: `proveDeclaredEffect` is pure over `(declared, headWord, argWords)`, so descent, guard accumulation, mapping, and prototype-key safety are unit-testable without a parser; `foldDeclaredCommandEffects` and `detectShadowedCommandEffects` likewise without a filesystem.
2. Redundant: none.
   The step-1 extraction moves code without changing a test (the guard tests reach the matchers through `proveCommandEffect` and keep their local `RETRACTED` constant).
3. Stay as-is: the core's `command-effects.test.ts` cases (the core is unchanged), the wrapper-analysis suites, and the gate tests' `effectSource` assertions for `core`/`retracted`/`unproven`.

## Invariants at risk

| Invariant (step that set it)                                                                                     | Constituency                           | Pinned by                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Declarations never lift the wrapper floor (ADR 0013 §11, [#803]/[#963]/[#1064])                                  | every permissive `bash` policy         | step 5: `xargs git log ~/x` with `git log` declared keeps `wrapperKind: "indirection"` and no `floorExemption` in `program.commands()` |
| Nested executions keep their own attribution ([#807])                                                            | path gates                             | step 6: `officecli $(cat /etc/hosts) x`                                                                                                |
| A redirect's syntax proof is absolute ([#609])                                                                   | `path_write` users                     | step 6: `officecli x > ~/out`; step 5: `git log > ~/out` stays `{write, syntax}`                                                       |
| The core is not overridable ([#924], `docs/configuration.md` "cannot be extended or removed from configuration") | everyone relying on core retractions   | step 5: `sed -i` with a `sed` declaration stays retracted                                                                              |
| Argument spellings reach `bash` rules ([#981])                                                                   | users with absolute-path `bash` denies | step 6 spelling test                                                                                                                   |
| Two attributions of one path fold order-independently ([#807])                                                   | prompt evidence                        | step 6: inert tokens never enter the fold                                                                                              |

## TDD Order

1. **`refactor(pi-permission-system): extract the option-guard matchers into option-guards.ts`**
   - **Prepares:** the declaration prover needs `optionGuard`, the stem matchers, and `RETRACTED_EFFECT`, all file-private in `command-effects.ts` today.
   - **Move:** `RetractionGuard`, `ClaimWithdrawal`, `optionGuard`, `retractsClaim`, `matchesLongStem`, and `matchesShortCluster` move verbatim to `src/access-intent/bash/option-guards.ts`, and `RETRACTED_EFFECT` moves to `effect.ts` beside `UNPROVEN_EFFECT`.
   - **Scope limit:** do not add the new match kind here.
   - **Review:** re-read the moved code against `code-design` before committing.
   - **Verify:** `command-effects.test.ts`, `wrapper-analysis` tests, and `pnpm run check` stay green.
   - **Killing mutation:** none (no new tests).
2. **`refactor(pi-permission-system): name BashParseOptions in program.ts`**
   - **Prepares:** the step-5 edit lands in one place instead of three.
   - **Change:** replace the three inline `{ workdir?: string }` with an exported `BashParseOptions` interface.
   - **Verify:** `program.test.ts` and `program-parse-sync.test.ts` stay green.
   - **Killing mutation:** none.
3. **`refactor(pi-permission-system): fold commandEffects declarations by command key with their scope`**
   - **Schema and types:** `commandEffectsEntrySchema` and `commandEffectsSchema` with their inferred types in `config-schema.ts`, not yet in `unifiedConfigSchema`.
   - **Fold module:** `src/config/command-effects-config.ts` with `DeclaredCommandEffects`, `NO_DECLARED_COMMAND_EFFECTS`, and `foldDeclaredCommandEffects`.
   - **Tests (`command-effects-config.test.ts`):**
     - a global layer stamps `global`;
     - a project layer overrides a colliding key whole and stamps `project`;
     - a global-only key survives a project layer;
     - an `undefined` layer returns the base unchanged.
   - **Tests (`config-schema.test.ts`, on the standalone schema):**
     - accepts §7's example, `[]`, nested `subcommands`, and the shorthand value forms;
     - rejects a key with `/`, a subcommand key starting with `-`, an `unlessOption` item without a leading `-`, an unknown field, and `"reed"`.
   - **Killing mutations:**
     - make `foldDeclaredCommandEffects` spread `{...layerStamped, ...base}`; the override test goes red;
     - drop the key regex from `commandKeySchema`; the `/` rejection goes red.
4. **`refactor(pi-permission-system): prove a command's effect from its declaration`**
   - **New module:** `declared-command-effects.ts` with `proveDeclaredEffect` (descent, accumulated guards, the effect mapping, the inert result, bare-basename and `Object.hasOwn` lookups).
   - **`effect.ts`:** `EffectSource` gains `declared-global` and `declared-project`.
   - **`option-guards.ts`:** gains the exact-or-attached single-dash kind, and a stem list is classified into the guard fields by shape.
   - **`command-effects.ts`:** `attributeCommandOperands` returns the core's proof when it is not `unproven`, else the declaration's.
   - **Tests (`declared-command-effects.test.ts`)**, nested by concern:
     - lookup: the bare basename; a path-qualified head; prototype keys;
     - descent: an exact match; a computed or dash-led next word under `subcommands`; an undeclared subcommand with and without a top-level `effects`; two-level `remote show`;
     - guards: a cluster `-ni`; an attached `-i.bak`; `--in-place=x`; the abbreviation `--in`; the single-dash `-exec` and `-execdir`; a computed may-lead-with-dash word; a parent guard applying under a child;
     - mapping: all five `effects` forms, with the scope-to-source mapping.
   - **Tests (`command-effects.test.ts`, on `attributeCommandOperands`):**
     - a core word ignores its declaration, both read and retracted;
     - an undeclared non-core word is `UNPROVEN_EFFECT`.
   - **Killing mutations, one per class:**
     - Descent: remove the computed/dash check, so `git -C x log` resolves through `-C`'s lookup and a top-level `effects` applies.
       Red: the `-C` test with a top-level `effects`.
     - Lookup: replace `Object.hasOwn(declared, head)` with `head in declared`.
       Red: the `constructor` test.
     - Guards: stop accumulating parent guards and use the reached entry's only.
       Red: the parent-guard test.
     - Mapping: map `["read","write"]` to `read`.
       Red: the both-effects test.
     - Core precedence: in `attributeCommandOperands`, consult declarations first.
       Red: the core-word tests.
5. **`refactor(pi-permission-system): attribute a declared command's operands during token collection`**
   - **Program and resolver:** `BashParseOptions.commandEffects`; `BashProgram.build` hands it to `BashPathResolver`, whose optional constructor argument defaults to `NO_DECLARED_COMMAND_EFFECTS`.
   - **Collectors:** the seven collectors take a required `declared`; `collectCommandTokens` calls `attributeCommandOperands`.
   - **Walkers:** the pattern and generic walkers and `collectEmbeddedOptionValues` take `{effect, role}` in place of `effect`.
   - **`TokenRole`:** gains `inert-operand`, stamped when the attribution is inert.
     The projections do not drop it yet, so an inert token is projected `{unproven, declared-…}` (fail-closed) until step 6.
   - **Test-site updates:** the eight `token-collection.test.ts` call sites pass `NO_DECLARED_COMMAND_EFFECTS`.
   - **Tests (`program.test.ts` / `program-external-accesses.test.ts`, via `BashProgram.parse(…, { commandEffects })`):**
     - `git log ~/x` → `{read, declared-global}`;
     - `git log ~/x` with a `project` stamp → `declared-project`;
     - `git log > ~/out` keeps `{write, syntax}` on `~/out`;
     - `sed -i x ~/f` with a `sed` declaration → `{unproven, retracted}`;
     - `xargs git log ~/x` keeps its indirection floor and `~/x` stays unproven;
     - a declaration reaches a command nested in a substitution (`echo $(git log ~/x)`), a heredoc body, a `for` word list, and a pattern-first command (`node build.js ~/x` under a `node` declaration);
     - `officecli x ~/a` stamps `inert-operand`.
   - **Killing mutations:**
     - In `collectHostedExecutionTokens`, pass `NO_DECLARED_COMMAND_EFFECTS` instead of `declared`.
       Red: the nested-substitution test.
     - In `collectCommandTokens`, call `proveCommandEffect` instead of `attributeCommandOperands`.
       Red: the `git log` routing tests.
     - Pass the declarations into `floorExemptionOf`'s proof by having `attributeCommandOperands` answer for `xargs`'s inner unit.
       This is not reachable without new wiring, so the floor test stands as a regression pin.
       Confirm by mutation in the implementing session: change the test's expectation and watch it go red.
6. **`refactor(pi-permission-system): withdraw an inert operand from both path projections`**
   - **`projectExternalPaths`:** skips `inert-operand` at the loop top.
   - **`projectRuleCandidates`:** records the spelling, then skips before the fold.
   - **Tests:**
     - [#797]'s `officecli set data.xlsx /Sheet1/B1` yields no external access and no rule candidate;
     - `officecli set sub/data.xlsx` keeps its absolute spelling in `commands()[0].spellings`;
     - `officecli x ~/a; cat ~/a` → `~/a` `{read, core}`;
     - `officecli $(cat /etc/hosts) x` → `/etc/hosts` `{read, core}`;
     - `officecli x > ~/out` → `~/out` `{write, syntax}`.
   - **Killing mutations, one per claim:**
     - Delete the `continue` in `projectExternalPaths`.
       Red: the [#797] external test.
     - Move the rule-candidate skip above the spelling record.
       Red: the spelling test.
     - Move the skip after the fold.
       Red: the `cat ~/a` test, which folds to `unproven`.
7. **`feat(pi-permission-system): declare a command's filesystem effects with commandEffects`**
   - **Schema:** `commandEffects` joins `unifiedConfigSchema` with `.meta`, and `pnpm run gen:schema` regenerates the schema.
   - **Loader:** `loadAndMergeConfigs` folds all five layers with their scope into `MergedConfigResult.declaredCommandEffects`.
   - **Store and session:** `ConfigStore` holds it as `declaredCommandEffects()`; `PermissionSession.getCommandEffects()`; `ToolCallGateInputs.getCommandEffects()`; the pipeline passes it to `BashProgram.parse`.
   - **Fixture updates:** `makeConfigStore` and `makeGateInputs` defaults, and the seven `config-store.test.ts` mocks.
   - **Tests:**
     - `config-schema.test.ts`: a file with `commandEffects` validates; the generated-schema parity test passes.
     - `config-loader.test.ts` (filesystem):
       - global plus project files merge by key with `project` stamps;
       - `includeProjectScope: false` loads no project declaration;
       - `merged` carries no `commandEffects`.
     - `config-store.test.ts`: `refresh` exposes the mock's map; `save` leaves `declaredCommandEffects()` intact.
     - `tool-call-gate-pipeline.test.ts`:
       - `git log ~/other/x` under `external_directory_read: allow` / `external_directory_write: ask` with a `git log` declaration → allow, and without it → ask;
       - the [#797] case raises no external-directory ask.
     - `bash-external-directory.test.ts`: logContext `effectSource: "declared-project"`.
   - **Killing mutations:**
     - In the pipeline, omit `commandEffects` from the `parse` options.
       Red: the pipeline tests.
     - Make the project fold step pass `"global"`.
       Red: the `declared-project` loader test.
     - Drop the `includeProjectScope` guard around the project fold.
       Red: the untrusted test.
8. **`feat(pi-permission-system): report a commandEffects declaration the pure-reader core shadows`**
   - **Detector:** `detectShadowedCommandEffects` in `command-effects-config.ts`, with one message naming every shadowed key in sorted order.
     Suggested wording: "`commandEffects` declares 'sed', a pure-reader core command; the core decides its effects, so the declaration is ignored."
   - **Injection:** `ConfigStoreDeps.coreCommandWords`, supplied from `PURE_READER_CORE` in `index.ts`; `refresh` appends the message to `configIssues`.
   - **Tests:**
     - detector unit tests: none shadowed → `undefined`; two shadowed → one message listing both;
     - `config-store.test.ts`: the issue appears in `getConfigIssues()`;
     - `composition-root.test.ts`: a global config declaring `sed` surfaces the issue through the real factory wiring.
   - **Killing mutations:**
     - In `index.ts`, pass an empty set.
       Red: the composition-root test.
     - Make the detector return on the first match.
       Red: the two-key message test.
9. **`docs(pi-permission-system): measure the share of asks a declarations file relieves`**
   - **Change:** `scripts/measure-core-coverage.mjs --declarations <file>` reads a `commandEffects` map (or a config file carrying one) and applies a crude exact-first-word descent and stem match, consistent with the script's crude head-word split.
   - **Report:** core-only and core-plus-declarations shares.
   - **Run:** against the step-10 recipe written to `/tmp`, and record the printed figures in the script header and the `Landed:` note.
   - **Killing mutation:** none (instrument).
10. **`docs(pi-permission-system): document commandEffects`**
    - **Files:** `docs/configuration.md` (section, direction-table row, recipes, the corrected "Declarations and privilege" text), `README.md`, `config/config.example.json`, and the package skill's Configuration rule.
    - **ADR 0013 amendment:** dated with `date -u +%F`.
    - **`architecture.md`:** module entries, `✅` on the heading and the `S880` node, the `Landed:` note with the step-9 figures, and the health-metric row.
    - **Verify:** `grep -c 'commandEffects' packages/pi-permission-system/src/config/config-schema.ts` reads ≥ 1 (baseline 0, measured 2026-10-16); `pnpm exec rumdl check` on every touched doc; the config-example schema test stays green.

## Risks and Mitigations

- **Recursive zod type inference.**
  The getter-based recursion validated and emitted `$defs` in a planning spike, but `z.infer` over a getter that returns a union can need an explicit annotation (TS7022/TS7023).
  If `pnpm run check` complains in step 3, declare `CommandEffectsEntry` as an interface and type the schema as `z.ZodType<CommandEffectsEntry>`.
- **Fallow dead-code between steps 3 and 6.**
  The new exports have no production consumer until step 7, and the repo's fallow entries are `src/index.ts` and `src/service.ts`.
  Gate per-step commits on `check`, `lint`, and the tests; `fallow dead-code` is the step-7-onward and pre-completion check.
- **A projection forgets the inert role.**
  Inert tokens carry `{unproven, declared-…}`, so a missed check consults both surfaces (fail-closed) instead of dropping a path.
- **Prototype keys in a JSON-sourced map.**
  The lookups use `Object.hasOwn`, which step 4 pins.
- **PR [#1073] (ancestor project configs)** rewrites `loadAndMergeConfigs`' project step.
  Whichever lands second folds each ancestor layer with `project` scope; the step-7 loader test is the conflict check.
- **A user declares a core word expecting relief.**
  Step 8's config issue says so at load, and the docs say the core cannot be extended or overridden.

## Open Questions

- Whether `effects: []` should also be offered for a core word such as `echo` (whose operands the core reads) is deferred until a measured population asks for it; today the core wins.

[#797]: https://github.com/gotgenes/pi-packages/issues/797
[#799]: https://github.com/gotgenes/pi-packages/issues/799
[#803]: https://github.com/gotgenes/pi-packages/issues/803
[#804]: https://github.com/gotgenes/pi-packages/issues/804
[#807]: https://github.com/gotgenes/pi-packages/issues/807
[#881]: https://github.com/gotgenes/pi-packages/issues/881
[#882]: https://github.com/gotgenes/pi-packages/issues/882
[#609]: https://github.com/gotgenes/pi-packages/issues/609
[#924]: https://github.com/gotgenes/pi-packages/issues/924
[#926]: https://github.com/gotgenes/pi-packages/issues/926
[#952]: https://github.com/gotgenes/pi-packages/issues/952
[#963]: https://github.com/gotgenes/pi-packages/issues/963
[#981]: https://github.com/gotgenes/pi-packages/issues/981
[#1064]: https://github.com/gotgenes/pi-packages/issues/1064
[#1073]: https://github.com/gotgenes/pi-packages/pull/1073
