---
issue: 1039
issue_title: "pi-permission-system: exact allow for sudo -n true still triggers the indirection-wrapper ask"
---

# Admit the shell no-ops to the pure-reader core

## Release Recommendation

**Release:** ship independently

This issue is not a step in any roadmap phase in `docs/architecture/architecture.md`, so no release batch holds it.

## Problem Statement

A user runs `sudo -n true` as a non-interactive probe for whether sudo is available: `true` does nothing, and `-n` stops sudo from asking for a password.
Under `bash: {"*": "allow", "sudo -n true": "allow"}` the agent's call still stops for approval, and the review log names `<indirection-bash-wrapper>` as the deciding pattern.
The same policy allows `sudo -n pwd` (the `core-reader` exemption) and `timeout 30 true` (the `execution-modifier` exemption) silently.
The reporter (a third party, `aisensiy`) traced it to `coreAdmissions()` holding no `true`, `false`, or `:`, so `floorExemptionOf` grants a `sudo` unit around them neither exemption.

## Goals

- A wrapper unit whose inner command is `true`, `false`, or `:` gets the existing `core-reader` floor exemption, so `sudo -n true`, `sudo -n :`, and `xargs true` resolve by the inner command's own `bash` rule.
- A path token owned by `true`, `false`, or `:` is attributed `read` (source `core`), as any core word's token is.
- The published roster in `docs/configuration.md` and the architecture doc's roster count stay in step with the code.
- Not breaking: the roster's own contract says "widening the roster only ever loosens, so evidence can add a word as a non-breaking change", and the prior widening of the exemption (`execution-modifier`, [#963]) shipped as `feat`.

## Non-Goals

- **An exact (wildcard-free) wrapper rule lifting the floor.**
  This was put to the operator as direction B and declined in favor of the data-only change.
  It would need an amendment to ADR 0013 §11 ("v1 exemption is package-audited only").
  It also overlaps PR [#971], which proposes rule-pinning for `xargs` and remains open as its own evaluation.
- **Honoring an exact wrapper allow under a strict catch-all.**
  Measured at planning time: under `bash: {"*": "ask", "sudo -n pwd": "allow"}`, `sudo -n pwd` already asks today, because an exempt wrapper resolves by the *inner* command's rule and `pwd` falls to `*: ask`.
  After this change `sudo -n true` behaves the same way under `{"*": "ask", "sudo -n true": "allow"}`.
  That is the documented exemption contract ("Each resolves by the inner command's own `bash` rules"), not a defect this plan changes.
- **A blanket `sudo` exemption, or modelling privilege.**
  `docs/configuration.md` § Declarations and privilege already states the extension never modelled what `sudo` adds; `sudo *: ask` remains the documented lever.
- **Path-qualified spellings** (`sudo -n /bin/true`, `sudo ./true`).
  They stay floored by the existing bare-basename rule (`isBareCoreWord`), on purpose.
- **Other no-op-like words** (`[`, `test`, `exit`, `wait`).
  Not requested, and each needs its own audit.
- **ADR 0013.**
  §11 already permits package-audited roster growth; no amendment is needed, and the ADR names no roster count.

## Background

- `src/access-intent/bash/command-effects.ts` — `coreAdmissions()` returns the roster grouped by admission reason; `PURE_READER_CORE` flattens it; `proveCommandEffect(headWord, argWords)` proves `{ effect: "read", source: "core" }` for a bare core word (after retraction guards).
  The admission bar is structural: read-only for any arguments in any implementation, no option that writes a file, effects independent of argument content.
- `src/access-intent/bash/wrapper-analysis.ts` — `floorExemptionOf` peels indirection layers and answers `"core-reader"` when the inner head proves a read and the statement writes no file through a redirect.
- `src/handlers/gates/bash-command.ts` — `resolveWrapperUnit` floors a wrapper unit to `<indirection-bash-wrapper>` unless it carries a `floorExemption`, in which case the inner command (`executedUnit`) resolves on the `bash` surface.
  Only a unit whose own text resolved to `allow` reaches it, so an explicit `deny`/`ask` on the wrapper is never weakened.
- `src/access-intent/bash/token-collection.ts` — `collectCommandTokens` stamps every token a command owns with the effect its head proves; that is the second (and last) `src/` consumer of `proveCommandEffect`.
  The Tidy-First assessor confirmed these two consumers and that `PURE_READER_CORE` is read only inside `command-effects.ts`.
- `docs/configuration.md` publishes the roster between `<!-- BEGIN PURE_READER_CORE -->` markers; `test/access-intent/bash/command-effects.test.ts` holds a hand-spelled `ROSTER` and a doc-parity test that compares the doc list to `[...PURE_READER_CORE].sort()`.

Why each word clears the bar:

| Word    | Implementation                                                   | Argument handling                                  | Writes  |
| ------- | ---------------------------------------------------------------- | -------------------------------------------------- | ------- |
| `true`  | bash builtin; coreutils/BSD `/usr/bin/true` under `sudo`/`xargs` | ignored; GNU prints `--help`/`--version` to stdout | nothing |
| `false` | bash builtin; coreutils/BSD `/usr/bin/false`                     | ignored; GNU prints `--help`/`--version` to stdout | nothing |
| `:`     | POSIX special builtin                                            | ignored (expanded only)                            | nothing |

A redirect on the statement (`: > f`, `sudo true > /tmp/x`) is a syntax write the redirect proof attributes independently, and the wrapper exemption's redirect refusal still applies.

## Design Overview

One new `CoreAdmission` group in `coreAdmissions()`:

```typescript
{
  words: ["true", "false", ":"],
  reason:
    "No-ops: ignore their operands and touch no file; GNU's `--help`/`--version` print to stdout only",
},
```

No mechanism changes.
`floorExemptionOf`, `resolveWrapperUnit`, and `collectCommandTokens` pick the words up through `proveCommandEffect`.

### Measured effect (planning-time spike through the real parser and `PermissionResolver`)

The spike called `resolveBashCommandCheck` over `BashProgram.parseSync(...).commands()` with a `createInMemoryManager` policy, once on `main` and once with the group added (both measured; the spike file is deleted).

| Policy                            | Command                                      | Today                            | With the group                          |
| --------------------------------- | -------------------------------------------- | -------------------------------- | --------------------------------------- |
| `*: allow`, `sudo -n true: allow` | `sudo -n true`                               | ask `<indirection-bash-wrapper>` | allow `*`, `core-reader`                |
| same                              | `sudo -n :` / `sudo -n false` / `xargs true` | ask (floor)                      | allow, `core-reader`                    |
| same                              | `sudo -n true && rm x`                       | —                                | allow (`rm x` resolves on `*`)          |
| same                              | `sudo true > /tmp/x`                         | —                                | ask (floor; redirect refusal)           |
| same                              | `sudo sh -c true`                            | —                                | ask (floor; opaque payload)             |
| same                              | `sudo ./true` / `sudo -n /bin/true`          | —                                | ask (floor; not bare basename)          |
| `*: ask`, `sudo -n true: allow`   | `sudo -n true`                               | ask (floor)                      | ask `*`, `core-reader` (Non-Goal above) |
| `*: allow`, `true: deny`          | `sudo -n true`                               | —                                | deny `true`                             |
| `*: allow`, `sudo *: ask`         | `sudo -n true`                               | —                                | ask `sudo *`                            |

Full suite with the group added (measured): 2 failed / 5666 passed, the two failures being exactly the `PURE_READER_CORE` parity tests (`holds exactly the audited words`, `matches the roster published in docs/configuration.md`).

Every row in the table is an edge case the plan states as behavior; each gets a test in Step 1.

### Sorted roster

The doc-parity test compares against JavaScript's default sort, where `:` (0x3A) precedes letters and `false` precedes `fd`.
The published list becomes:

```text
`:`, `awk`, `basename`, `cat`, `cd`, `diff`, `dirname`, `echo`, `egrep`, `false`, `fd`, `fgrep`, `find`, `grep`, `head`, `ls`, `pwd`, `realpath`, `rg`, `sed`, `sort`, `stat`, `tail`, `true`, `wc`, `which`
```

## Module-Level Changes

- `src/access-intent/bash/command-effects.ts` — add the no-op admission group to `coreAdmissions()`.
- `test/access-intent/bash/command-effects.test.ts` — add `true`, `false`, `:` to `ROSTER` (the `it.each(ROSTER)` "proves a read" case then covers each word).
- `test/access-intent/bash/wrapper-analysis.test.ts` — under `floorExemptionOf` › "a wrapper running a proven pure reader", add `sudo -n true`, `sudo -n :`, `xargs false`; under "a wrapper running anything else", add `sudo ./true`, `sudo -n /bin/true`, `sudo sh -c true`.
- `test/handlers/gates/bash-command.test.ts` — new `describe` using the real-resolver `decide` helper (line ~1200) covering the table's rows.
- `test/access-intent/bash/program.test.ts` — beside "carries a core word's read onto its external access" (line ~1980), a case asserting `true /etc/hosts` carries `{ effect: "read", source: "core" }`.
- `docs/configuration.md` — the `PURE_READER_CORE` list (line ~1012, in the same commit as the code because of the parity test); a `sudo -n true` example in § Wrapper transparency › A wrapper running a pure reader (the "So `xargs grep -l foo`…" sentence).
- `docs/architecture/architecture.md` — the `command-effects.ts` module-tree entry's "23-word roster" becomes "26-word roster".

Predicted unchanged:

- `README.md` line 22: it describes the exemption by class ("the wrapped command is a pure reader") with an `xargs grep` example, and names no roster.
- `docs/decisions/0013-permission-policy-model.md`: §11 states the package-audited rule, not the roster.
- `.pi/skills/package-pi-permission-system/SKILL.md`: names the exemption classes only (`grep -n "pure reader\|PURE_READER\|roster"` on it at planning time matched one line, the fail-closed paragraph's class description, and no roster).
- `src/access-intent/bash/wrapper-analysis.ts`, `src/handlers/gates/bash-command.ts`, `src/access-intent/bash/token-collection.ts`: consumers only; the full-suite spike confirms no behavior assertion in their tests moves.

## Test Impact Analysis

1. New tests: the no-op words in the roster pin, the wrapper-exemption positives and negatives, the gate-level policy rows, and the token attribution.
2. Redundant tests: none; the roster's `it.each` absorbs the per-word proof without a separate case.
3. Unchanged: every existing `floorExemptionOf` and `resolveWrapperUnit` test; the spike shows only the two parity tests move.

## Invariants at risk

- **An explicit `deny`/`ask` on the wrapper is never weakened** ([#803]; `docs/configuration.md` § Wrapper transparency).
  Pinned by the existing `bash-command.test.ts` "sudo *" deny/ask cases (lines ~345–370), and Step 1 adds the `sudo *: ask` row for `sudo -n true` specifically.
- **A redirect write keeps the floor** (ADR 0013 §11 clause 4).
  Step 1 adds `sudo true > /tmp/x` → floor.
- **An opaque payload never exempts** (§11).
  Step 1 adds `sudo sh -c true` → floor.
- **A path-qualified head proves nothing.**
  Step 1 adds `sudo ./true` and `sudo -n /bin/true` → floor.

## TDD Order

1. **Admit `true`, `false`, `:` to the pure-reader core.**
   - Red: add the three words to `ROSTER` in `command-effects.test.ts`; add the wrapper-analysis positives/negatives; add the `bash-command.test.ts` describe ("a wrapper running a shell no-op") with the table's rows through `decide`; add the `program.test.ts` attribution case.
     The parity tests, the positives, the issue-repro row, the `true: deny` row, and the attribution case go red; the negatives and the `sudo *: ask` / redirect / opaque rows pass as invariant pins.
   - Green: add the admission group to `coreAdmissions()` and the three words to the `PURE_READER_CORE` list in `docs/configuration.md` (sorted as in Design Overview).
   - Killing mutations:
     - Delete the new admission group → the roster pin, the doc parity, the wrapper-analysis positives, the gate's allow/deny rows, and the attribution case go red.
     - Drop only `":"` from the group → `sudo -n :` (wrapper-analysis and gate) and the roster pin go red, proving `:` is covered on its own.
     - In `isBareCoreWord`, drop the `PATH_SEPARATORS` check → `sudo ./true` and `sudo -n /bin/true` go red (the negatives are pins against this class).
   - Verify: `pnpm --filter @gotgenes/pi-permission-system exec vitest run && pnpm --filter @gotgenes/pi-permission-system run check`.
   - Commit:

     ```text
     feat(pi-permission-system): sudo -n true and other shell no-ops behind a wrapper resolve by their own rule

     Refs #1039

     Co-authored-by: aisensiy <661860+aisensiy@users.noreply.github.com>
     ```

2. **Document the no-op case.**
   - Add `sudo -n true` to the "So `xargs grep -l foo`, …" example sentence in `docs/configuration.md` § A wrapper running a pure reader; update the architecture doc's roster count to 26.
   - Verify: `pnpm exec rumdl check packages/pi-permission-system/docs/configuration.md packages/pi-permission-system/docs/architecture/architecture.md`.
   - Commit: `docs(pi-permission-system): document shell no-ops in the pure-reader core (#1039)`.

## Risks and Mitigations

- **A wrong admission fails open.**
  The three words are builtins (or coreutils/BSD binaries under a wrapper) that ignore their operands; GNU's only argument-sensitive behavior prints to stdout.
  A user `PATH` shadowing `true` with a script is the same exposure every core word already carries.
- **`true <path>` now consults only `_read` rules.**
  `true` never touches the path, so the read-only attribution over-claims access rather than under-claiming it; a `path_write` deny no longer fires on `true ~/secret`, which runs nothing against it.
- **`sudo` credential caching.**
  A successful `sudo true` refreshes sudo's timestamp; the extension already does not model sudo's privilege effects, and `sudo *: ask` remains the documented lever.

## Open Questions

- None.

[#803]: https://github.com/gotgenes/pi-packages/issues/803
[#963]: https://github.com/gotgenes/pi-packages/issues/963
[#971]: https://github.com/gotgenes/pi-packages/pull/971
