---
issue: 807
issue_title: "pi-permission-system: attribute bash path-token effects from syntax proofs and a pure-reader core"
---

# Effect attribution for bash path tokens

## Release Recommendation

**Release:** mid-batch — defer (batch "capability-axis"); confirm at ship time

Phase 14 Step 2 sits between Step 1 ([#806], landed and unreleased) and Step 3 ([#803], the batch tail and release vehicle).
Steps 1 and 2 relieve nothing a user can observe until a directional grant exists to write against a classified effect, so the batch ships together.
Leave the release-please PR unmerged at ship time.

## Problem Statement

Step 1 made direction expressible, but nothing on the bash surface *proves* one.
Every bash path token falls to ADR 0013 §10's fail-closed base case and consults both directional surfaces, so the axis relieves nothing there — a user gains a vocabulary with no facts to speak about.

Two of the three sources [ADR 0013](../decisions/0013-permission-policy-model.md) §7 names are in scope here, and they are the two the package can hold without belief.
**Syntax:** an output redirect destination is a write, an input redirect is a read, and file-descriptor duplication is not a file access at all.
**The built-in pure-reader core:** a small frozen set of command words that are read-only for any arguments, in any implementation.

The third source — `commandEffects`, the user's own structured declarations — is deliberately split out so that Step 3's wrapper transparency depends only on the audited core.

## Goals

- Attribute an effect (`read`, `write`, or unproven) to each bash path **token**, not to each command, so `cat ~/a | tee ~/b` reads `~/a` and writes `~/b` in one unit.
- Prove a write from an output redirect (`>`, `>>`, `>|`, `&>`) and a read from an input redirect (`<`, `<<<`), and collect no token at all for a file-descriptor duplication (`2>&1`).
- Ship a frozen, package-audited pure-reader core of 22 command words, matched as **bare basenames only**, with fail-closed retraction guards on `find`, `fd`, and `sort`.
- Route a proven-effect token to that effect's directional surface, and an unproven one to the bare family, in both bash path gates.
- Narrow a bash session approval to the direction the gate proved, wherever the gate can prove one direction for the whole ask.
- Record the deciding token's effect and its blame source in the review log, so an ask names the line that produced its verdict.

This change is **not breaking.**
`pnpm view @gotgenes/pi-permission-system version` reports 27.0.1, and `git show pi-permission-system-v27.0.1:packages/pi-permission-system/src/access-intent/path-surfaces.ts` has no directional surfaces — Step 1 is unreleased.
So no released config can name `path_read`, and a bare-family config sugar-expands to *identical* rule lists on both members, which makes a read-routed token's answer bit-identical to today's fold.
Commit type `feat:`, no `!`.

## Non-Goals

- **`commandEffects`** — the user's structured declarations, with `subcommands` descent, `unlessOption` guards, and the `shellTools`-style shallow merge.
  It is the rest of staging slice 2 and is scheduled for a later phase.
- **Wrapper transparency** ([#803], Step 3).
  A wrapper's head word (`xargs`, `sudo`, `find -exec`) is not a core word, so its tokens stay unproven here and the indirection floor is untouched.
- **Redirect projection completeness** ([#609], Phase 15).
  A bare redirect destination that does not yet exist is dropped by the projection before any gate sees it (ADR 0013's measured table).
  This change classifies what is already collected; it does not change *what* is collected, so `echo hi > new.txt` still contributes no token.
- **Per-pattern session-approval surfaces** ([#810], adopted as Phase 14 Step 10).
  When one bash command's uncovered paths split across two proven directions, this change falls back to the bare family for the session grant — exactly today's width, never wider.
- **Unit-level provenance for an allowed access.**
  A bash path access that resolves entirely to `allow` writes no review-log entry today and still writes none; provenance lands on the ask entries only.
- **The `runDescriptor` split.**
  The roadmap assigns it to this step on the grounds that the change extends that dispatch.
  Under the design below, provenance rides in each gate's `logContext` and `handlers/gates/runner.ts` has **zero diff**, so Tidy First's own rule (tidy the code you are about to change) excludes it — the same call [#806] made about `selectUncoveredPathCandidates`.
- **The `bash` command surface**, the wrapper floor, the `<unparseable-bash-command>` sentinel, and catch-all node enumeration ([#742], Step 4).
- **The reserved `delete` effect** (ADR 0013 §2) — named in the vocabulary's doc comment, not shipped as a value.

## Background

### Where a bash path token comes from today

`BashProgram.parse` walks the AST once through `BashPathResolver`, which produces two slices: `externalPaths(): AccessPath[]` and `pathRuleCandidates(): BashPathRuleCandidate[]`.
The tokens themselves come from `token-collection.ts`, whose three collectors all return `string[]`:

- `collectCommandTokens` — dispatches to a pattern-first collector (`sed`, `grep`, `rg`, …) or a generic one, then appends `--opt=value` embedded values.
- `collectRedirectTokens` — reads a `file_redirect` node's argument children and descends its nested executions.
- `collectPathCandidateTokens` — the generic walk, plus the `EXECUTION_HOST_TYPES` branch.

A token's effective working directory is already threaded through the walk as `EffectiveBase`; the effect is the second per-token fact this design adds beside it.

### What the parse tree actually offers

Verified against the installed tree-sitter grammar at planning time (spike run and discarded):

| Command                    | Node shape                                                            |
| -------------------------- | --------------------------------------------------------------------- |
| `cat /etc/hosts > out.txt` | `file_redirect` → unnamed `>` + `word "out.txt"`                      |
| `cat < in.txt`             | `file_redirect` → unnamed `<` + `word "in.txt"`                       |
| `echo hi >> log.txt`       | `file_redirect` → unnamed `>>` + `word`                               |
| `cmd &> all.txt`           | `file_redirect` → unnamed `&>` + `word`                               |
| `cmd >\| clobber.txt`      | `file_redirect` → unnamed `>\|` + `word`                              |
| `pnpm x 2>&1 \| tail`      | `file_redirect` → `file_descriptor "2"` + unnamed `>&` + `number "1"` |
| `cat <<< 'here'`           | `herestring_redirect` → unnamed `<<<` + `raw_string`                  |

The operator is an unnamed child whose `type` is the operator text itself, so the syntax proof is a lookup on that string.
`number` is not in `ARG_NODE_TYPES`, so `2>&1`'s `1` is already never collected — but `>&` with a *word* destination (`cmd >& out.txt`) is a real write and must be classified, not assumed away.

### Measured: what the core buys

Instrument: `/tmp/scan-marginal.mjs`, re-committed as `scripts/measure-core-coverage.mjs` in the docs cycle (the ADR 0013 rule that a number's script ships beside it).
Population: the local review log, 10,856 lines, 803 `permission_request.waiting` entries with `toolName: "bash"`, 229 of them in 2026-07/08.
Metric: **every** unit head word in the core, which is the right proxy because tokens compose most-restrictive — a single unproven unit re-floors the whole ask.

| Core                            | All-time | Recent (07/08) |
| ------------------------------- | -------- | -------------- |
| 12 content/metadata readers     | 19.2%    | 5.7%           |
| + `echo`                        | 25.5%    | 10.5%          |
| + `find` (guarded)              | 34.0%    | 22.7%          |
| + `cd`, `diff`, `which`         | 36.9%    | 27.9%          |
| + ~40 further audited coreutils | 37.7%    | 28.4%          |

All figures **measured**, not estimated.
The relief is concentrated in `echo`, `find`, and `diff`; everything past them adds about one point, which is what selects the focused core over the broad one.
The top remaining blockers among recent asks are `cd` (19), `git` (14), `sed` (13), and `pnpm` (11) — the last three are `commandEffects` long tail by construction.

### Constraints from AGENTS.md and the package skill

- `*` already crosses directory boundaries; write `~/dev/*`, never `~/dev/**`, in every example.
- Do not read `process.platform` in `src/`; a path-flavor question goes through `PathNormalizer`.
  The bare-basename rule below avoids the flavor entirely by rejecting any head word containing `/` or `\`.
- The manager stays string-based; only the resolver unwraps an `AccessPath`.
- A module no code imports yet is `refactor:`, however new it is.

## Design Overview

### The effect vocabulary

The vocabulary is domain-level and the bash proofs are not, so they split across two modules.
`path-surfaces.ts` is a core-layer vocabulary module and must not import from the `bash/` subtree — the same layering argument that relocated `restrictiveness.ts` out of `handlers/gates/` in [#806].

```typescript
// src/access-intent/effect.ts

/** A filesystem effect an access can have. `delete` is reserved (ADR 0013 §2). */
export type Effect = "read" | "write";

/** An effect attribution, including the fail-closed base case (ADR 0013 §10). */
export type AttributedEffect = Effect | "unproven";

/** What established the attribution — the review log's blame fact (ADR 0013 §7). */
export type EffectSource = "syntax" | "core" | "retracted" | "unproven";

/** A path token's attributed effect, paired with what established it. */
export interface TokenEffect {
  readonly effect: AttributedEffect;
  readonly source: EffectSource;
}

export const UNPROVEN_EFFECT: TokenEffect = {
  effect: "unproven",
  source: "unproven",
};

/**
 * Combine two attributions of the same resolved path.
 *
 * Agreement keeps the effect and the first source; disagreement falls to
 * unproven, because proven-both and unproven-at-all consult the same two
 * surfaces (ADR 0013's 2026-08-25 amendment: they are one mechanism, not two).
 */
export function mergeTokenEffects(a: TokenEffect, b: TokenEffect): TokenEffect;
```

`"retracted"` is a distinct source rather than a flavour of `"unproven"` because it is the difference between "nobody claimed anything about `pnpm`" and "`find` is core but `-delete` withdrew the claim" — the blame line ADR 0013 §7 asks for.

### The two proof sources

```typescript
// src/access-intent/bash/command-effects.ts

/** The effect a command's head word proves for the tokens that command owns. */
export function proveCommandEffect(
  headWord: string,
  argWords: readonly string[],
): TokenEffect;

/**
 * The effect a redirect operator proves for its destination token, or `null`
 * when the redirect names no file at all (`2>&1`) and no token is collected.
 */
export function redirectDestinationEffect(
  operator: string,
  destinationIsDescriptor: boolean,
): TokenEffect | null;
```

Both are pure and word-based; the AST walk that produces the words stays in `token-collection.ts`.
This mirrors the existing split in `wrapper-analysis.ts`, whose docblock states the same rule.

The redirect table:

| Operator                      | Destination                  | Result                      |
| ----------------------------- | ---------------------------- | --------------------------- |
| `>`, `>>`, `>\|`, `&>`, `&>>` | any                          | write, source `syntax`      |
| `<`                           | any                          | read, source `syntax`       |
| `>&`                          | `file_descriptor` / `number` | `null` — no token collected |
| `>&`                          | a word                       | write, source `syntax`      |
| `<&`                          | `file_descriptor` / `number` | `null` — no token collected |
| `<&`                          | a word                       | read, source `syntax`       |
| `<<<` (`herestring_redirect`) | any                          | read, source `syntax`       |

Syntax proofs are absolute: they are applied to the destination token after the owning command's attribution and are never retracted by it.

### The v1 pure-reader core

Twenty-two words, each admitted on the structural bar — implementation-independent read-only-ness across GNU and BSD alike, no option that redirects output to a file, effects stable under argument content.

| Group                  | Words                                                       | Why it clears the bar                                                                                                        |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Content readers        | `cat`, `head`, `tail`, `wc`, `grep`, `egrep`, `fgrep`, `rg` | No output-file option in any surveyed dialect; output is stdout only                                                         |
| Comparison             | `diff`                                                      | Writes nothing; `-D` emits merged output to stdout                                                                           |
| Metadata and listing   | `ls`, `stat`, `file`, `pwd`                                 | Report only                                                                                                                  |
| Path-string transforms | `basename`, `dirname`, `realpath`                           | `realpath` reads the filesystem and writes nothing; the other two touch it at all only to resolve                            |
| No filesystem write    | `echo`, `which`, `cd`                                       | `echo` writes to stdout (a redirect destination is the syntax proof's job, not `echo`'s); `cd` reads a directory to enter it |
| Guarded                | `find`, `fd`, `sort`                                        | See the guard table below                                                                                                    |

Deliberate exclusions, recorded in the module so the audit is auditable:

| Word                                                          | Why not                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `awk`, `gawk`, `nawk`                                         | The program text can `print > "file"`; effects are not stable under argument content                         |
| `sed`                                                         | `-i` is in-place, and BSD requires a separate argument where GNU attaches one — the guard is dialect-variant |
| `uniq`                                                        | `uniq IN OUT` writes its second positional                                                                   |
| `tee`, `dd`, `split`, `csplit`, `xxd`, `tree`, `curl`, `wget` | Each has a positional or an option that writes a file                                                        |
| `less`, `more`                                                | Interactive shell escape (`!cmd`) and `LESSOPEN` preprocessing                                               |
| `git`, `pnpm`, `npm`, `node`, `python3`, `gh`                 | Subcommand- and argument-dependent; the `commandEffects` long tail                                           |

The **bare-basename rule** is the Codex lesson ([openai/codex#28732](https://github.com/openai/codex/issues/28732)): a head word containing `/` or `\` is never core, so `./grep` and `/tmp/evil/grep` are unproven.
Rejecting on the separator characters directly — rather than asking a `PathFlavor` — is what keeps this module free of the platform read that `src/` forbids, and it is fail-closed on both platforms.

Note that `extractCommandName` basenames its result (`/usr/bin/sed` → `sed`), which is correct for `PATTERN_FIRST_COMMANDS` and wrong here.
A sibling `extractCommandWord(node): string | undefined` returns the raw head text, and the two are documented against each other.

### The retraction guards

| Word   | Retracts on                                                                    | Form                                                               |
| ------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `find` | `-exec`, `-execdir`, `-ok`, `-okdir`, `-delete`, `-fprint`, `-fprintf`, `-fls` | Exact word; `find`'s options do not cluster                        |
| `fd`   | `-x`, `--exec`, `-X`, `--exec-batch`                                           | Exact word plus short-letter cluster (`x`, `X`)                    |
| `sort` | `-o`, `--output`                                                               | Short-letter cluster (`o`) plus long stem with or without `=value` |

Matching is fail-closed over option forms per ADR 0013 §7: a long stem matches with or without an attached `=value`, and a short letter matches anywhere in a single-dash cluster and in the attached-value form (`-oFILE`, `-uo`).
`sort`'s only short option containing `o` is `-o` itself, so the cluster rule cannot over-retract there; over-retraction anywhere else costs one ask, while under-retraction misses a write.

A retraction yields `{ effect: "unproven", source: "retracted" }`, not a write — the command's other tokens are still whatever the fail-closed base case says they are.

### Per-token attribution in the collectors

The three collectors return `PathToken[]` instead of `string[]`:

```typescript
export interface PathToken {
  readonly token: string;
  readonly effect: TokenEffect;
}
```

Tagging happens where a token is *produced*, never by mapping a whole result — a nested execution's tokens carry their own command's attribution and must not be overwritten by the enclosing one:

```typescript
export function collectCommandTokens(node: TSNode): PathToken[] {
  const headWord = extractCommandWord(node);
  const effect = proveCommandEffect(headWord ?? "", argWordsOf(node));
  const config = PATTERN_FIRST_COMMANDS.get(extractCommandName(node) ?? "");
  const tokens = config
    ? collectPatternCommandTokens(node, config, effect)
    : collectGenericCommandTokens(node, effect);
  return [...tokens, ...collectEmbeddedOptionValues(node, effect)];
}
```

Inside those two collectors the existing `tokens.push(...collectPathCandidateTokens(child))` recursion passes through untouched, while a directly-produced token becomes `{ token: text, effect }`.

`collectRedirectTokens` consults `redirectDestinationEffect` for the node's operator and drops the destination entirely when it returns `null`.

### Deduplication folds, it does not split

`BashPathResolver` currently dedups external paths on the canonical boundary value and rule candidates on the joined match values.
Adding the effect to the dedup key would split `cat ~/a > ~/a` into two entries and show `~/a` twice in the ask prompt's evidence list.
Instead the existing key is kept and a repeat **merges** through `mergeTokenEffects`, so two different proven effects on the same path fold to unproven — which routes to the bare family, which is precisely "consult both".
The entry count is therefore unchanged from today, and the ADR's own reading (proven-both and unproven-at-all are one mechanism) is what makes the fold honest rather than lossy.

The seeded `workdir` external path (an aliased shell tool's implicit `cd`) carries `UNPROVEN_EFFECT`: no command word was observed for it and no syntax proved it.

### Surface routing

`path-surfaces.ts` gains the effect-keyed sibling of the tool-keyed function, and the existing one is re-expressed through it:

```typescript
/** The narrowest surface in `family` that an attributed effect names. */
export function capabilitySurfaceForEffect(
  family: string,
  effect: AttributedEffect,
): string;

/** The narrowest surface in `family` that `toolName`'s identity proves. */
export function capabilitySurfaceForTool(family: string, toolName: string): string {
  return capabilitySurfaceForEffect(family, effectProvenByTool(toolName));
}
```

`edit` and an unproven bash token both reach the bare family through the same function, which is what ADR 0013's 2026-08-25 amendment says they should.

The bash path gate then routes per candidate:

```typescript
for (const { token, path, effect } of candidates) {
  const surface = capabilitySurfaceForEffect("path", effect.effect);
  const check = resolver.resolve({ kind: "access-path", surface, path, agentName });
  // …#58 no-pattern branch and session-coverage bookkeeping unchanged…
  uncovered.push({ token, path, surface, effect, check });
}
```

The worst uncovered entry's `surface` then drives the descriptor's `surface`, the ask payload's `surface`, `accessFactsFromPath(surface, path)`, `decision.surface`, and the session approval.
`external-directory-policy.ts`'s `selectUncoveredExternalPaths` does the same over `external_directory`, and returns each entry's surface alongside its check.

### Session-approval narrowing

`bash-path.ts` selects a single worst token, so it always records that token's own proven surface — `SessionApproval.single("path_read", pattern)` for a proven read.
`bash-external-directory.ts` aggregates every uncovered path into one prompt carrying one `SessionApproval`, which holds one surface for all its patterns, so it narrows only when the whole ask agrees:

```typescript
const surfaces = new Set(uncoveredEntries.map(({ surface }) => surface));
const approvalSurface =
  surfaces.size === 1 ? [...surfaces][0] : "external_directory";
```

The fallback is exactly today's width — a bare family key sugar-expands onto both directions — so a mixed-direction command is never granted more than it is now.
Closing that last gap needs `(surface, pattern)` pairs on `SessionApproval` and on the `ForwardedSessionApproval` wire, which is [#810].

### Provenance

The runner already stamps `renderReviewLogFacts(payload)` onto every review entry for a gate, and that render writes `request.surface` — so the *direction* is already recorded the moment the payload names a directional surface.
What it does not carry is *which source* established it, so each bash gate's `logContext` gains two fields for its deciding token:

```typescript
logContext: {
  // …existing fields…
  effect: worstEntry.effect.effect,        // "read" | "write" | "unproven"
  effectSource: worstEntry.effect.source,  // "syntax" | "core" | "retracted" | "unproven"
}
```

Two scalars, so `capLogFieldWidths` and the redaction replacer reach them without a new traversal, and no existing log field changes shape.
`{ effect: "unproven", effectSource: "retracted" }` is the auditable line ADR 0013 §7 asks for: the word was core and an option withdrew it.

The ask prompt is deliberately unchanged apart from `request.surface`, which already existed and already renders — a per-path effect badge on the external-path evidence entries is presentation churn ADR 0011 does not need here.

## Module-Level Changes

### New

- `src/access-intent/effect.ts` — `Effect`, `AttributedEffect`, `EffectSource`, `TokenEffect`, `UNPROVEN_EFFECT`, `mergeTokenEffects`.
- `src/access-intent/bash/command-effects.ts` — `PURE_READER_CORE` (the 22-word roster with per-word admission reasons and the recorded exclusions), the retraction-guard table, the guard matcher, `proveCommandEffect`, `redirectDestinationEffect`.
- `test/access-intent/bash/command-effects.test.ts`, `test/access-intent/effect.test.ts`.
- `scripts/measure-core-coverage.mjs` — the instrument behind the measured table above.

### Changed

- `src/access-intent/bash/token-collection.ts` — `PathToken` return type on all three exported collectors; `extractCommandWord` added beside `extractCommandName`; the two private collectors and `collectEmbeddedOptionValues` take the unit's `TokenEffect`.
- `src/access-intent/bash/bash-path-resolver.ts` — `PathCandidate` and `BashPathRuleCandidate` gain `effect`; `ResolvedBashPaths.externalPaths` becomes `readonly BashExternalPath[]` (`{ path, effect }`); both dedup loops merge on a repeat; `tagTokens` carries the effect; `probeBareToken`'s result is paired with the caller's effect.
- `src/access-intent/bash/program.ts` — `externalPaths(): AccessPath[]` is renamed `externalAccesses(): BashExternalPath[]`.
  The rename is deliberate: a silent shape change under the same name is what a reviewer misses, and the compiler flags every call site either way.
- `src/handlers/gates/bash-path-extractor.ts` — adapts to `externalAccesses()`, keeping its `string[]` return so the 1,130-line `test/bash-external-directory.test.ts` projection suite needs no diff.
- `src/access-intent/path-surfaces.ts` — `capabilitySurfaceForEffect` added; `capabilitySurfaceForTool` and a private `effectProvenByTool` re-expressed through it.
- `src/handlers/gates/bash-path.ts` — per-candidate directional routing; the worst entry's surface on the descriptor, payload, access facts, decision, and session approval; `effect`/`effectSource` on `logContext`.
- `src/handlers/gates/external-directory-policy.ts` — `selectUncoveredExternalPaths` takes `BashExternalPath[]`, routes each through `capabilitySurfaceForEffect`, and returns each entry's `surface`.
- `src/handlers/gates/bash-external-directory.ts` — consumes the surfaced entries, narrows the session-approval surface when the ask agrees, and adds the two log fields.
- `src/presentation/path-ask-payload.ts` — `BashExternalDirectoryAskFacts` gains `surface` (the other two payload builders already take one).

### Documentation

- `docs/architecture/architecture.md` — module-tree entries for `path-surfaces.ts` (831), `token-collection.ts` (837), `bash-path-resolver.ts` (840), `program.ts` (844), `external-directory-policy.ts` (862), `bash-external-directory.ts` (863), `bash-path.ts` (864), and `path-ask-payload.ts` (905); two new entries for `effect.ts` and `command-effects.ts`; the `✅ Step 2` heading mark, its Mermaid node, and a `Landed:` note; the effect-module metric row's baseline is already `0 → 1` and needs no rewrite.
- `docs/configuration.md` — the `#### Which direction is a given access?` table's "A bash path token → both, most-restrictive" row is now conditional; a new subsection lists the core roster, the guards, and the bare-basename rule; the `find` note at line 993 gains the `-delete`/`-fprint` retraction.
- `README.md` — the directional-surfaces paragraph gains one sentence that bash reads are now provable.
- `.pi/skills/package-pi-permission-system/SKILL.md` — the "a bash token (until #807) → the bare family" clause is rewritten, and the family-vocabulary list gains `capabilitySurfaceForEffect`.
- `packages/pi-permission-system/package.json` — no `files` change; `scripts/` is already outside the allowlist and `docs/configuration.md` is already shipped.

Verified non-touch-points: `src/handlers/gates/runner.ts` (provenance rides in `logContext`), `src/permission-resolver.ts` (a directional surface has no family members, so the fold is simply not entered), `src/authority/delegation-envelope.ts` (already a family test, so `path_read` is excluded by construction), and `src/pattern-suggest.ts` (its `path` / `external_directory` arms are unreachable from the path gates, traced in [#806]).

## Test Impact Analysis

**What the extraction newly enables.**
`proveCommandEffect` and `redirectDestinationEffect` are pure word-based functions, so the core roster, the bare-basename rule, every guard form (exact word, long stem with and without `=value`, clustered short, attached-value short), and the whole redirect operator table become table-driven unit tests that need no AST and no gate.
Today the equivalent coverage would have to run a command through a gate and assert on a permission verdict.

**What becomes redundant.**
Nothing.
The existing bash suites assert projection correctness (which tokens are collected) rather than classification, and those questions stay separate.

**What must stay as-is.**
`test/bash-external-directory.test.ts` (1,130 lines) exercises the projection through `extractExternalPathsFromBashCommand`, whose `string[]` signature is preserved for exactly this reason — it genuinely tests the layer below classification and must not be perturbed.

**Migrations, all compile-enforced and all exact `toEqual` assertions.**

| File                                                                       | Sites | Change                                                                                               |
| -------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------- |
| `test/access-intent/bash/token-collection.test.ts` (429 lines)             | ~40   | Wrap the assertion in a local `tokensOf(…)` helper; add effect assertions for the new behavior       |
| `test/access-intent/bash/program.test.ts` (1,395 lines)                    | ~60   | `.map((p) => p.value())` → `.map(({ path }) => path.value())` under the renamed `externalAccesses()` |
| `test/permission-manager-unified.test.ts`                                  | 2     | Same                                                                                                 |
| `test/handlers/gates/bash-path.test.ts`, `bash-external-directory.test.ts` | ~14   | Surface assertions become directional where the command is core                                      |

Handler-level tests that declare *policy* need no change: `makeSurfaceCheck` has answered a family key for its directional members since [#806], so a fixture saying `external_directory: deny` still answers an `external_directory_read` query.
That fixture is what keeps this migration at four files instead of a dozen.

**Doc-drift guard.**
`docs/configuration.md` will list the core roster, and a listed roster drifts from the code.
A parity test parses the doc's list and asserts it equals `PURE_READER_CORE`, the same shape as the `config.example.json` validation test [#806] added.

## Invariants at risk

Step 1's documented outcomes that this change sits directly on top of, and what pins each.

1. **Every existing config expands to its current meaning exactly; nothing prompts differently on upgrade.**
   Read-routing a token bypasses the fold entirely, so the equality rests on expansion writing identical rule lists onto both members.
   Pinned by a new case: a bare `path: { "~/.ssh/*": "deny" }` config still denies `cat ~/.ssh/id_rsa` after the token is proven `read`, and a bare `external_directory: { "*": "ask" }` config still asks for a proven read outside the tree.
   No existing test pins this for a *core* command specifically, because no command was core before.

2. **A forwarded child request is hard-denied by the parent's recorded authority ([#712]'s defect class).**
   This is the load-bearing invariant behind putting the fold in `PermissionResolver.resolve`, and this change makes a child's forwarded `surface` fact *directional* for the first time on the bash surface.
   Pinned today by the `ServingPolicy resolves a forwarded request against real recorded authority` block in `test/authority/forwarded-request-server.test.ts` — the block [#806] added in `b8090e3f`, which rebuilds the real `buildResolvedIntentFromMatchValues` + `PermissionResolver` wiring rather than stubbing `policy`.
   I opened that file: every *other* test in it stubs `policy: { resolve: vi.fn(...) }` and pins nothing about the composition, so the new case must go in that block.
   Add: a forwarded request whose `surface` is `path_read` is still denied by a parent's bare `path` deny.

3. **The fail-closed base case: an unproven token consults both surfaces, most-restrictive** (ADR 0013 §10).
   Pinned by a new case on a non-core head word (`pnpm test ~/outside`), asserting the bare family surface reaches the resolver.

4. **Consult-read for unproven effects was rejected outright** — `rm` is unknown, not proven-write, and must never ride a read allow.
   Pinned by asserting `rm -rf ~/outside` yields `UNPROVEN_EFFECT`, and by an end-to-end case that an `external_directory_read: allow` grant does not silence `rm -rf ~/outside`.

5. **The Codex lesson: a path-qualified head word is not core.**
   Pinned by `./grep`, `/tmp/x/grep`, and `bin\grep` all yielding `UNPROVEN_EFFECT` while bare `grep` yields a core read.

6. **The `#58` backward-compatibility branch** — a token matched only by the universal default is treated as unrestricted.
   Existing coverage in `bash-path.test.ts`; the branch moves under a directional surface and must keep firing.

7. **The delegation envelope caps a link's `allow` on the whole `path` family.**
   Already a family test since [#806], so a bash-emitted `path_read` is excluded by construction; pinned by a case asserting a link's `allow` on `external_directory_read` is capped to `defer`.

**Quantitative prediction.**
Against the committed instrument and the 22-word core: 27.9% of recent bash asks (64 of 229) and 36.9% of all-time (296 of 803) have every unit head word in the core — **measured**, and the ceiling on band B relief given a directional read grant covering the asked roots.
The docs cycle records this number beside the script so a later re-run can falsify it.

## TDD Order

1. **The effect vocabulary.**
   `test/access-intent/effect.test.ts` covers `mergeTokenEffects` — agreement keeps the effect and the first source, disagreement falls to unproven, either side unproven wins.
   `refactor(pi-permission-system): add the filesystem-effect vocabulary`

2. **The pure-reader core and its guards.**
   `test/access-intent/bash/command-effects.test.ts` covers every roster word, the bare-basename rejection (`./grep`, `/usr/bin/grep`, `bin\grep`), each guard's exact-word / long-stem / `=value` / clustered-short / attached-value forms, and that a retraction yields source `"retracted"`.
   `refactor(pi-permission-system): add the frozen pure-reader command core`

3. **The redirect syntax proofs.**
   Same test file: the full operator table including `>&` with a descriptor destination returning `null` and `>&` with a word destination proving a write.
   `refactor(pi-permission-system): prove a redirect destination's effect from its operator`

4. **The effect-keyed surface selector.**
   `capabilitySurfaceForEffect` plus `capabilitySurfaceForTool` re-expressed through it, with the existing tool-routing tests unchanged as the regression guard.
   `refactor(pi-permission-system): select a path surface from an attributed effect`

5. **Per-token attribution through collection and resolution.**
   Atomic by necessity: the collectors' return type change breaks `bash-path-resolver.ts`, `program.ts`, and `bash-path-extractor.ts` at compile time in the same commit, and the two test migrations ride with it.
   Gates still route on the bare family, so nothing observable changes yet.
   `refactor(pi-permission-system): attribute an effect to every bash path token`

6. **The bash path gate routes per token.**
   First observable change: a proven read resolves on `path_read`, the payload and access facts name it, and the session approval is recorded there.
   `feat(pi-permission-system): route a proven bash path token to its directional surface`

7. **The bash external-directory gate routes per path.**
   Per-path routing, the narrowed session-approval surface with the mixed-direction fallback, and the surfaced ask payload.
   `feat(pi-permission-system): route a proven bash external path to its directional surface (#807)`

8. **Cross-layer invariant pins.**
   The bare-config parity cases, the forwarded directional deny in the real-wiring block, the `rm` end-to-end case, and the delegation-envelope cap.
   `test(pi-permission-system): pin the effect-attribution invariants across layers`

9. **Documentation and the instrument.**
   The architecture module tree, the `✅ Step 2` mark and `Landed:` note, `docs/configuration.md`'s direction table and new roster section with its parity test, `README.md`, the package skill, and `scripts/measure-core-coverage.mjs`.
   `docs(pi-permission-system): document bash effect attribution and the pure-reader core`

## Risks and Mitigations

- **A wrong core admission is a fail-open.**
  Each roster word carries its admission reason inline and each exclusion its rejection reason, so the audit is reviewable rather than asserted.
  The bar is structural, not popularity-based, which is what keeps the core from growing under pressure.
  Widening later only ever loosens, so it is a non-breaking `feat:` whenever evidence supports it.
- **A guard that under-retracts misses a write.**
  Matching is fail-closed over option forms, and the three guarded words were chosen because their write options spell identically in GNU and BSD — which is exactly why `sed` is excluded rather than guarded.
  Over-retraction costs one ask.
- **The migration touches a 1,395-line test file.**
  Every site is an exact `toEqual` under a renamed method, so the compiler flags all of them and no `toMatchObject` site can absorb a wrong edit — the condition [#806]'s retro identified as what made its bulk edit safe.
  Verify the property before running any script, not after.
- **A directional surface reaching an authorizer link ahead of the family conversion** was Step 1's ordering constraint; it is already satisfied, since the family test landed in [#806] and cycle 7 above pins it.
- **Silent widening for a directional config** is impossible in a released config, and cycle 8's parity cases pin the bare-config equality that carries the claim.

## Open Questions

- Whether the core widens beyond 22 words, and on what evidence.
  The measured marginal table says the next ~40 audited coreutils buy about one point for this operator; a different command mix would say otherwise, and the committed instrument is how that gets re-measured rather than argued.
- Whether `[]` — no filesystem effect at all, ADR 0013 §2's strictly-stronger-than-read value — becomes a distinct attribution once `commandEffects` ships.
  Today `echo`, `which`, and `cd` are attributed `read`, which is conservative and behaviorally identical, so the distinction buys only blame quality.
- Whether unit-level classification provenance for a fully-allowed bash access is worth a debug-stream entry.
  No review-log entry exists for that case today and the gates hold no logger, so it is a wiring question rather than a rendering one.

[#609]: https://github.com/gotgenes/pi-packages/issues/609
[#712]: https://github.com/gotgenes/pi-packages/issues/712
[#742]: https://github.com/gotgenes/pi-packages/issues/742
[#803]: https://github.com/gotgenes/pi-packages/issues/803
[#806]: https://github.com/gotgenes/pi-packages/issues/806
[#810]: https://github.com/gotgenes/pi-packages/issues/810
