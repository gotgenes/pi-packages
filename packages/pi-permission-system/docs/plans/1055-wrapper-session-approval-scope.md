---
issue: 1055
issue_title: "pi-permission-system: session approval for wrappers grants unrelated inner executables"
---

# Scope a wrapper's session approval to its inner command

## Release Recommendation

**Release:** ship independently

This issue is not a roadmap step: the Phase 15 sweep records it as out of scope for the roadmap (operator decision, 2026-10-10), so it carries no `Release:` batch tag.

## Problem Statement

When a bash command behind an indirection wrapper asks, the dialog's "Allow this session" option suggests the wrapper's first word plus a wildcard.
Approving `nohup mytool first` records `nohup *`, and that grant then authorizes `nohup othertool …` and `nohup rm -rf …` for the rest of the session.
The same holds for `sudo`, `env`, `xargs`, `doas`, `timeout`, and nested wrappers (`sudo -u root nohup mytool` records `sudo *`).
The human approved one executable; the grant names every executable the wrapper can launch.

The issue and its reference implementation (PR [#1054], by @plucury) were filed by a third party.
The PR review stage evaluated both and the operator chose to adopt the capability with a simplified design; that decision and its scope are recorded in `packages/pi-permission-system/docs/retro/1055-wrapper-session-approval-scope.md`, so this plan builds around it rather than re-opening it.

## Goals

- A recognized literal wrapper prefix suggests the wrapper words (options, operands, nested layers) followed by the inner command's arity prefix and a space-separated wildcard: `nohup mytool *`, `sudo aws s3 rm *`, `env FOO=bar mytool *`, `sudo -u root nohup mytool *`.
- Any wrapper command whose generalization is not proven keeps the whole command with no appended wildcard: shell syntax in any word, an opaque payload, a refused peel, an opaque-command-line wrapper (`watch`, `parallel`, `rush`, `rust-parallel`), an option a table-walk wrapper does not admit (which includes a `find`/`fd` exec flag), a peel that stops at a wrapper, and an `xargs` replacement option.
- The dialog label and the recorded session grant name the same narrowed pattern (they already share `SessionApprovalSuggestion.pattern`).
- Ordinary (non-wrapper) suggestions are unchanged.
- Not breaking: suggestions only narrow; no config, default, schema, or decision changes.
  Commits are `fix(pi-permission-system):`.

## Non-Goals

- Generalizing an `xargs` replacement template (`xargs -I X mytool X first`): the operator chose the exact command, no wildcard, at the PR review gate.
- Detecting `xargs` replacement through `XARGS_GRAMMAR`'s cluster parse instead of a textual over-approximation (the tidy-first assessor rejected it as a design change; the over-approximation only ever falls back to the exact command).
- A config `deny` reaching behind a wrapper (`rm *: deny` asks for `nohup rm -rf x` today); observed during the PR review, unrelated to suggestions.
- Adding `command`/`exec` to the wrapper vocabulary (`command mytool a` still suggests `command *`).
- A leading assignment before a wrapper (`FOO=bar sudo x` suggests `FOO=bar *` today).
- PR [#971] (lifting the `xargs` floor for a rule that pins the inner command) — independent; its pinning pattern shape (`xargs ls *`) matches what this plan suggests for `xargs ls`, so the two compose.
- [#604] (an option to widen session-approval patterns) — the opposite direction, parked.
- The PR's own retro file and Phase 15 disposition text are not taken; the maintainer's disposition already landed.

## Background

- `suggestBashPattern` (`src/presentation/pattern-suggest.ts`) splits the unit text on whitespace and applies `prefix` (`src/access-intent/bash/bash-arity.ts`); an unknown command falls back to arity 1, which is how a wrapper name becomes the whole grant.
  It is reached from `describeToolGate` → `suggestValueSessionPattern` → `suggestSessionPattern` (`src/handlers/gates/tool.ts`), with the asking unit's `check.command`.
- `wrapper-analysis.ts` owns the wrapper vocabulary: `classifyWrapperWords`, the private `unwrapIndirection` walk (whose `peeled` result carries each layer's words before its inner command), `innerCommandIndex` (getopt grammars for `sudo`/`env`/`xargs`/`doas`, per-wrapper tables otherwise), `isAdmittedModifierLayer`, `isLiteralCommandName`, `runsOpaqueCommandLine`, and the set `OPAQUE_COMMAND_LINE_WRAPPERS`.
  Its header states the constraint this plan leans on: the questions over that vocabulary live together so they cannot drift.
- A session grant bypasses the wrapper floor by design: `resolveCommandUnit` (`src/handlers/gates/bash-command.ts`) floors only `base.state === "allow" && !isSessionGrant(base)`.
  So the suggestion's width *is* the grant's width.
- `compileWildcardPattern` (`src/policy/wildcard-matcher.ts`, line ~66) makes a trailing space-and-`*` optional, so `nohup mytool *` also matches a bare `nohup mytool`.
- Boundary: `presentation/` may import `access-intent/` (`pnpm --silent fallow guard src/presentation/pattern-suggest.ts`, run at planning time); `pattern-suggest.ts` already imports `bash-arity.ts`, so the new import adds no zone edge, and `wrapper-analysis.ts` gains no new import.
- AGENTS/package constraints that apply: least privilege when in doubt; wildcard matching must be explicit and tested; `wrapper-analysis.ts`'s tables decide the gate, so the session walk must not invent a second option table.

## Design Overview

### Evidence

The defect was reproduced in the PR review stage against `main` at `ea45bcd3`, through the gate's own decision path: `BashProgram.parseSync` → `resolveBashCommandCheck` over a real `PermissionResolver` and `createInMemoryManager`, with `sessionRule("bash", suggestBashPattern(asking.command))` as the session ruleset.
Inputs were synthetic commands (`<wrapper> mytool first`), run in-library with no extension in between, under three policies (`*: allow`, `*: ask`, `*: ask` + `rm *: deny`); every wrapper granted `othertool` and `rm` with `source: "session"`.

At planning time a prototype was applied to `main` (then reverted) and measured; its final form is the design below, except that it inlined the step 1 predicate rather than extracting it:

- Full package suite: 180 files, 5951 tests, all green; no existing test asserts a wrapper suggestion.
- `pnpm --filter @gotgenes/pi-permission-system run check`: pass.
- `pnpm fallow audit --base origin/main`: exit 0 (the complexity rows it lists are inherited: `isAdmittedModifierLayer`, `getoptInnerIndex`, `tableInnerIndex`).
  One run exited 2 while another `fallow` invocation was running concurrently; the immediate rerun exited 0.
- Size: about +35 lines in `wrapper-analysis.ts`, +6 in `pattern-suggest.ts`.
- The case tables and round trips in steps 2–3 were run through the prototype; each listed expectation is the output it produced.
- The step 2 killing mutations for the table-walk row and the `reachedLiteralCommand` check were applied to the final-form prototype and produced exactly the reds listed there; the missing-space mutation was measured by granting `nohup mytool*` directly (`nohup mytool-other x` resolved `allow`, `source: "session"`); the other mutations' reds are reasoned, not measured.
- Two guards from the first prototype were measured redundant and dropped: a `peeled.length === 0` check (the `reachedLiteralCommand` check catches the same inputs) and an `EXEC_CONDITIONAL_WRAPPERS` row (a `find`/`fd` exec flag is an option word, so the table-walk row already refuses it; with the row deleted, `find . -exec mytool x +` and `fd x -x mytool` stayed exact).

### Decision model

```text
suggestBashPattern(command)
  tokens = strip comments, split on whitespace
  index  = sessionCommandIndex(tokens)
    0     → today's arity path, unchanged
    null  → the stripped command, no wildcard
    i > 0 → [...tokens[0..i), ...prefix(tokens[i..])].join(" ") + " *"
```

```typescript
/**
 * Where the inner command starts for a session-approval pattern: 0 for an
 * ordinary command, the peeled wrapper words' count when every layer may be
 * generalized past, or null to keep the whole command.
 */
export function sessionCommandIndex(tokens: readonly string[]): number | null {
  const words = literalWordsOf(tokens);
  if (classifyWrapperWords(words) === undefined) return 0;
  if (words.some((word) => word.computed)) return null;
  const unwrapped = unwrapIndirection(words, "");
  if (unwrapped.kind === "opaque") return null;
  if (!unwrapped.peeled.every(generalizesLayer)) return null;
  if (!reachedLiteralCommand(unwrapped.words)) return null;
  return unwrapped.peeled.reduce((count, layer) => count + layer.length, 0);
}
```

- `literalWordsOf(tokens)` builds `CommandWord`s from the whitespace tokens: `value` is the text, `computed` is whether the token contains shell syntax (`` ['"\\$`|&;<>(){}[\]*?!~#] ``), `mayLeadWithDash` is `text.startsWith("-")` (exact for an uncomputed word), and offsets run over a single-space join.
  Marking a token `computed` is what makes `isAdmittedModifierLayer`'s literal check honest for string input, and any computed word declines generalization outright.
  The screen applies only to wrapper commands; an ordinary command never reaches it.
- `reachedLiteralCommand(inner)` is the predicate `onlyModifiesExecution` already ends with (`classifyWrapperWords(inner) === undefined && isLiteralCommandName(inner.at(0)?.text ?? "")`), extracted first (step 1) so the two consumers share it.
  It also covers a refused first layer: an empty `peeled` leaves `unwrapped.words` equal to the wrapper itself, which classifies as a wrapper, so no separate `peeled.length === 0` guard is needed (planning-time reasoning: `sudo -s mytool` would otherwise return `0` and fall to the `sudo *` arity path, which step 2's case table pins).
- The index is the sum of peeled layer lengths, not `words.length - unwrapped.words.length`, because `unwrapIndirection` trims an exec terminator off the inner command.
- `generalizesLayer(layer)`:

  | Layer                                                                                                           | Generalizes when                                                      |
  | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
  | `runsOpaqueCommandLine(layer)` (`watch`, `parallel`, `rush`, `rust-parallel`)                                   | never — its command line reaches a shell or template                  |
  | `xargs`                                                                                                         | no word may request replacement (`mayReplaceArguments`, step 3)       |
  | other `GETOPT_GRAMMARS` (`sudo`, `env`, `doas`)                                                                 | always — the peel already refuses unlisted and mode-changing options  |
  | table-walk (`time`, `timeout`, `nice`, `stdbuf`, `setsid`, `flock`, `nohup`, and `find`/`fd` with an exec flag) | `isAdmittedModifierLayer(layer)`, or the layer carries no option word |

  The table-walk row reuses the floor exemption's admission rather than adding the PR's second allowlist (`sessionWrapperOptionsKnown`); `tableInnerIndex` treats an unknown option as a flag, so `timeout --sig KILL 5 mytool` would otherwise suggest `timeout --sig KILL 5 *`.
  The same row refuses a `find`/`fd` exec layer, whose exec flag is an option word; that matters because `find`'s own options may follow the inner command (`find . -exec mytool x + -delete`).
- `mayReplaceArguments(layer)` (step 3): any layer word matching `/^-[^-]*[Ii]/` or starting with `--r`.
  It is a deliberate over-approximation of `-I`, `-i`, `--replace` and their clusters/abbreviations (`-0I`, `--rep=X`): a false positive (`-L1i` style values) only costs an exact-command suggestion.
- A wrapped prefix always ends in a space and `*`, even when the inner arity prefix covers every token (`nohup git log` → `nohup git log *`, `sudo ls` → `sudo ls *`).
  This is the PR's choice and is narrower than the unwrapped `git log*` (no `git logx`); the matcher treats a trailing space-and-`*` as optional, which keeps the bare command covered.

### Placement

New section `// ── Session patterns ──` in `wrapper-analysis.ts`, after `isLiteralCommandName` and before `// ── Unwrapping ──`, ordered export → `generalizesLayer` → `mayReplaceArguments` → `literalWordsOf` (tidy-first assessor's placement; keeps `floorExemptionOf` contiguous with its helpers).
The module header's "three questions" sentence gains the fourth: how far a session grant may generalize past the wrappers.
`literalWordsOf` stays private: `CommandWord` is defined here, and `node-text.ts` is the tree-sitter adapter.

### Consumer call site

```typescript
const tokens = stripped.split(/\s+/);
if (tokens.length === 1) return stripped;
const commandIndex = sessionCommandIndex(tokens);
if (commandIndex === null) return stripped;
if (commandIndex > 0) return wrappedPattern(tokens, commandIndex);
// today's arity path
```

`wrappedPattern` is a three-line private helper in `pattern-suggest.ts` (`[...tokens.slice(0, i), ...prefix(tokens.slice(i))].join(" ") + " *"`); `suggestBashPattern`'s JSDoc gains the two wrapper bullets.

## Module-Level Changes

- `src/access-intent/bash/wrapper-analysis.ts` — step 1: extract `reachedLiteralCommand` from `onlyModifiesExecution`.
  Step 2: add `sessionCommandIndex`, `generalizesLayer`, `literalWordsOf`, the section banner, and the header sentence.
  Step 3: add `mayReplaceArguments` and its `xargs` row in `generalizesLayer`.
- `src/presentation/pattern-suggest.ts` — step 2: import `sessionCommandIndex`, branch on it, add `wrappedPattern`, extend the JSDoc.
- `test/presentation/pattern-suggest.test.ts` — steps 2 and 3: a child `describe("wrapper commands")` under `describe("suggestBashPattern")`, with `describe("generalizes past")` / `describe("keeps the whole command")` children.
- `test/handlers/gates/bash-command.test.ts` — steps 2 and 3: a new top-level `describe("resolveBashCommandCheck: a wrapper's session grant", …)` after `"env, xargs, and doas option grammars"` (line ~1280), using the module-level `decide` and the already-imported `sessionRule`; adds an import of `suggestBashPattern`.
- `test/handlers/gates/tool.test.ts` — step 2: one test under `describe("describeToolGate")` asserting the grant and label for `nohup mytool argument`.
- `docs/session-approvals.md` — step 4: a wrapper paragraph after the arity table.
- `docs/architecture/architecture.md` — step 4: the `wrapper-analysis.ts` module-tree entry gains `sessionCommandIndex` (the fourth answer over the shared walk, and its fail-closed rows); the `pattern-suggest.ts` entry names the wrapper branch.
- Predicted unchanged: `src/handlers/gates/tool.ts` (consumes `suggestSessionPattern` verbatim); `test/access-intent/bash/wrapper-analysis.test.ts` (step 1 is behavior-preserving, and its `floorExemptionOf` cases pin it); every test asserting a `sudo *`/`xargs *` *config rule* match (`bash-command.test.ts` lines ~345–468, `serving-policy.test.ts`, `permission-manager-unified.test.ts`) — those are policy patterns, not suggestions, and the prototype suite was green.
- `.pi/skills/package-pi-permission-system/SKILL.md` — predicted unchanged: it lists `wrapper-analysis.ts` only as a gate module and never describes suggestions.

## Test Impact Analysis

- New: a suggestion case table (pure, no parser warm-up), real-parser round trips proving the grant's width at the gate, and one gate-descriptor test proving label and grant agree.
- Redundant: none; the existing `suggestBashPattern` cases stay as the ordinary-command regression set.
- Must stay: `wrapper-analysis.test.ts`'s `floorExemptionOf` cases, which pin step 1's refactor.

## Invariants at risk

- Ordinary suggestions unchanged — pinned by the existing `describe("suggestBashPattern")` cases (`git status *`, `npm run build*`, `mytool *`, `rm *`, `find *`, comment stripping).
- The wrapper floor and its exemptions ([#490], [#803], [#963]) — step 1 must keep `floorExemptionOf`'s answers; pinned by `wrapper-analysis.test.ts` (`floorExemptionOf` execution-modifier and core-reader cases) and `bash-command.test.ts`'s floor describes.
- A session grant covers only the unit it names ([#1033]) — `describe("resolveBashCommandCheck: a session grant covers only the unit it names")`; unaffected, since only the pattern text changes.

## TDD Order

Steps 2–4 carry the contributor credit; end each body with `Refs #1055` and `Refs #1054`, then a blank line, then:

```text
Co-authored-by: plucury <plucury@gmail.com>
```

1. **Extract the reached-a-literal-command predicate.**
   `refactor(pi-permission-system): name the literal-command check the wrapper peel ends with`.
   Move `onlyModifiesExecution`'s last two clauses into private `reachedLiteralCommand(inner)` (placed below `onlyModifiesExecution`, stepdown) and call it there.
   No new tests; run `test/access-intent/bash/wrapper-analysis.test.ts` and `test/handlers/gates/bash-command.test.ts` green before and after.
   Prepares step 2's second consumer (tidy-first assessor, Recommended).
2. **Narrow a wrapper's session suggestion to its inner command.**
   `fix(pi-permission-system): scope a wrapper's session approval to its inner command`.
   Red, in `pattern-suggest.test.ts` (`describe("wrapper commands")`), each expectation as the prototype produced it:
   - Generalizes past: `nohup mytool argument` → `nohup mytool *`; `nohup mytool` → `nohup mytool *`; `nohup git status --short` → `nohup git status *`; `sudo aws s3 rm s3://bucket` → `sudo aws s3 rm *`; `env FOO=bar mytool argument` → `env FOO=bar mytool *`; `sudo FOO=bar mytool a` → `sudo FOO=bar mytool *`; `xargs mytool argument` → `xargs mytool *`; `xargs -0 mytool a` → `xargs -0 mytool *`; `xargs -n 1 mytool a` → `xargs -n 1 mytool *`; `timeout 5 mytool argument` → `timeout 5 mytool *`; `nice -n 5 mytool a` → `nice -n 5 mytool *`; `stdbuf -oL mytool a` → `stdbuf -oL mytool *`; `flock /tmp/l mytool a` → `flock /tmp/l mytool *`; `doas mytool a` → `doas mytool *`; `sudo -u root nohup mytool argument` → `sudo -u root nohup mytool *`; `nohup ./run.sh a` → `nohup ./run.sh *`.
   - Keeps the whole command (output equals input): `sudo mytool $HOME`, `nohup ~/bin/mytool a` (shell syntax); `sudo bash -c mytool` (opaque payload); `sudo -s mytool`, `env -C /tmp mytool a` (refused peel); `find . -exec mytool x +`, `fd x -x mytool` (exec clause); `watch mytool x`, `parallel mytool ::: a` (opaque command line); `timeout --sig KILL 5 mytool a`, `flock -w 5 /tmp/l mytool a`, `nohup -- mytool a` (unadmitted table option); `nohup nohup nohup nohup nohup mytool a` (peel depth); `nohup if a` (reserved word).
   Red, in `bash-command.test.ts` (`describe("resolveBashCommandCheck: a wrapper's session grant")`), `it.each` over `nohup`, `sudo`, `env FOO=bar`, `xargs`, `doas`, `sudo -u root nohup` under `{ "*": "allow" }`: `<w> mytool first` asks; its suggestion is `<w> mytool *`; with that grant `<w> mytool second` and bare `<w> mytool` resolve `allow` with `source: "session"`; `<w> othertool second` and `<w> mytool-other x` still `ask` with a non-session source (all measured on the prototype).
   Red, in `tool.test.ts`: `describeToolGate` for `nohup mytool argument` with an asking bash check records `[{ surface: "bash", pattern: "nohup mytool *" }]` and labels `Yes, allow bash "nohup mytool *" for this session`.
   Green: `sessionCommandIndex`, `generalizesLayer` (without the `xargs` row), `literalWordsOf`, the header sentence, and the `pattern-suggest.ts` branch.
   Verify: package suite, `pnpm --filter @gotgenes/pi-permission-system run check`, `pnpm run lint`, `pnpm fallow audit --base origin/main` (exit 0 predicted from the prototype), `pnpm fallow dead-code`.
   Killing mutations (each should turn the named tests red):
   - Make `sessionCommandIndex` return `0` after the ordinary check → every "generalizes past" case and every round trip's `othertool` assertion.
   - Make `literalWordsOf` set `computed: false` → `sudo mytool $HOME` and `nohup ~/bin/mytool a`.
   - Delete the `runsOpaqueCommandLine` row → `watch mytool x`, `parallel mytool ::: a`.
   - Make the table-walk row return `true` → `timeout --sig KILL 5 mytool a`, `flock -w 5 /tmp/l mytool a`, `nohup -- mytool a`, `find . -exec mytool x +`, `fd x -x mytool`.
   - Delete the `reachedLiteralCommand` check → `sudo -s mytool`, `env -C /tmp mytool a`, the depth case, `nohup if a`.
   - Make `wrappedPattern` omit the space before `*` → the round trips' `mytool-other` assertion.
3. **Keep an `xargs` replacement command exact.**
   `fix(pi-permission-system): keep an xargs replacement template exact in session approvals`.
   Red, in `pattern-suggest.test.ts` (keeps the whole command): `xargs -I X mytool X first`, `xargs -IX nohup X a`, `xargs -i mytool a`, `xargs --replace mytool a`, `xargs --rep=X mytool X`, `xargs -0I X mytool X`; still generalizes: `xargs -L1 mytool a` → `xargs -L1 mytool *` (alongside step 2's `-0` and `-n 1` cases).
   Red, in `bash-command.test.ts`: `xargs -I X nohup X first` under `{ "*": "allow" }` suggests itself; with that grant the same command resolves `source: "session"` and `xargs -I X nohup X second` asks with a non-session source.
   Green: `mayReplaceArguments` and the `xargs` row in `generalizesLayer`.
   Killing mutation: make `mayReplaceArguments` return `false` → every replacement case and the round trip's `second` assertion.
4. **Document wrapper session suggestions.**
   `docs(pi-permission-system): describe wrapper session-approval suggestions`.
   `docs/session-approvals.md`: after the arity table, a paragraph with examples of both outcomes (the step 2/3 tables, abridged), the space-before-wildcard rule, and the conservative fallback.
   `docs/architecture/architecture.md`: the `wrapper-analysis.ts` and `pattern-suggest.ts` module-tree entries.
   Verify: `pnpm exec rumdl check` on both files.

## Risks and Mitigations

- **A layer generalizes past an option whose value is the real command** — table-walk layers must pass `isAdmittedModifierLayer` or carry no option; getopt layers are already strict; step 2 pins `timeout --sig KILL 5` and `flock -w 5`.
- **Whitespace tokens diverge from the parsed unit** — any token with quoting, expansion, glob, grouping, or comment syntax marks the word computed and keeps the whole command; the fallback is the exact command, never a wider pattern.
- **The suggestion and the gate disagree on the pattern** — the round-trip tests run the produced pattern back through `resolveBashCommandCheck` with a real parser and resolver, which is the cross-consumer check the testing skill requires for a recorded-then-replayed format.
- **Complexity gate** — the prototype passed `fallow audit` with exit 0; keep the per-layer decision in `generalizesLayer` rather than inlining it into the walk.

## Open Questions

None.

[#1054]: https://github.com/gotgenes/pi-packages/pull/1054
[#971]: https://github.com/gotgenes/pi-packages/pull/971
[#604]: https://github.com/gotgenes/pi-packages/issues/604
[#490]: https://github.com/gotgenes/pi-packages/issues/490
[#803]: https://github.com/gotgenes/pi-packages/issues/803
[#963]: https://github.com/gotgenes/pi-packages/issues/963
[#1033]: https://github.com/gotgenes/pi-packages/issues/1033
