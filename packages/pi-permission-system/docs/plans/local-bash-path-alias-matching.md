---
issue_title: "Match the bash surface against the command's resolved path forms"
---

# Match the bash surface against the command's resolved path forms

## Release Recommendation

**Release:** ship independently.

No issue tracks this change.
The operator declined remote tracking: the defect was filed as [#910] and closed again on the same day, and the fix is handled locally in this repository.
The commit is a `fix:` and cuts its own release.

It is not a step in the Phase 15 roadmap, whose spine is a lost token *role* and the declared-effects config shape.
It touches no step that phase names as a defect source, and the surface it changes is the one [#804] replaces.

## Problem Statement

A `bash` rule written with an absolute path does not cover the same command written with a relative path, although both name the same file and both resolve to the same location.

With this policy:

```jsonc
"external_directory": { "*": "ask", "/tmp": "allow", "/tmp/*": "allow" },
"bash": { "*": "allow", "rm *": "ask", "rm /tmp/agent-builds/*": "allow" }
```

the two commands below reach the same file, and the second prompts while the first does not:

```bash
rm /tmp/agent-builds/pi-permission-system/config.json
cd /tmp && rm agent-builds/pi-permission-system/config.json   # prompts, rule 'rm *'
```

The `external_directory` gate resolves both to `/tmp/agent-builds/…` and allows them; only the `bash` gate asks.
The operator cannot see why: no rule in the config appears to name the command being refused.

The cause is that the `bash` surface matches **the command text**, while the `path` and `external_directory` surfaces match **the resolved path's alias set** (the lexical ∪ canonical union of [#418]).

- `src/access-intent/input-normalizer.ts` builds the bash lookup as `values: [matchValue]` from the raw command text; leading comment lines are stripped and nothing else is.
- `src/policy/permission-manager.ts` `buildCheckResult` selects `evaluateAnyValue` only for a surface in `PATH_SURFACES`, so `bash` is evaluated by `evaluateFirst` over that single value.
- `src/access-intent/bash/bash-path-resolver.ts` already computes the cd-aware alias set for every path token, but that slice reaches only the `path_*` surfaces through `BashProgram.pathRuleCandidates()`.

The measurement is upstream of most of this phase: the same file reaches two surfaces under two matching domains, and the config cannot express the difference.
`docs/configuration.md` `### bash Surface` states that patterns match each top-level command in the chain, and says nothing about how a path argument in that text relates to the path surfaces' alias matching.

Severity is fail-closed: the spelling no rule covers falls through to the broader rule, so the result is an extra `ask` and never a silent allow.
[#822] is the same "matched textually, not by meaning" shape on the `path` surface, and that one is a fail-open.

## Goals

- A `bash` rule whose pattern names a path in the absolute spelling matches the command written with that path's relative spelling, when both resolve to the same location.
- The alias set used by the `bash` surface is the same idea the `path` surfaces already use: the as-typed text plus the resolved forms of the same command.
- A change to matching is explicit and tested: every new match is a named case in the bash gate's test matrix, never a silent widening.
- Fail-closed properties already pinned by the code are preserved: a non-literal base, a glob or expansion token, and a win32 POSIX-absolute literal each keep their current answer.
- The prompt and the review log name the text the decision was made on, so an ask whose rule does not appear in the operator's config is explainable.

## Non-Goals

- **Structured command rules.**
  The destination is [#804], whose config shape is decided in Phase 16; this change stays inside the string matcher that surface keeps until then.
- **Whitespace and quote normalization of the whole command.**
  [#804] records `git  diff` and `git "diff"` as reasons to leave string matching behind.
  This change rewrites only the argument nodes it resolves, so a quoted path argument starts matching a path rule as a side effect — recorded under Risks rather than claimed as a goal.
- **Changing the `path` or `external_directory` surfaces.**
  Their alias handling is already correct, and a `path` allow still cannot loosen a stricter `external_directory` rule.
- **Reviewing why the `bash` surface carries file policy at all.** `docs/configuration.md` says redirects are gated by the `path` surface, not `bash`; whether path-shaped bash rules should keep working is [#804]'s question, not this one.
- **Session grants that cross spellings.**
  A grant continues to record the command text the prompt showed; see the residual under Risks.

## Background

### The two matching domains

```text
cd /tmp && rm agent-builds/pi-permission-system/config.json

bash gate                      matches text     values: [ "rm agent-builds/…" ]
                               rules:  rm *  →  ask
                                       rm /tmp/**  →  no match

path / external_directory      matches paths    values: [ "/tmp/agent-builds/…",
                                                        "/private/tmp/agent-builds/…" ]
                               rules:  /tmp/*  →  allow
```

### Constraints from AGENTS.md and the package skill

- The four path layers compose **most-restrictive-wins**, so a second value on one surface may not weaken another surface's decision.
  This change adds a value to one surface only; the composition above the gates is untouched.
- Wildcard matching must be explicit and tested; silent over-matching is a permission bypass.
  The alias texts are therefore derived from the resolver's own already-classified candidates, never from a fresh text heuristic.
- `AccessPath` is the single value object holding the two representations, and `PermissionResolver.resolve` is the sole `matchValues()` unwrap site (ADR 0002).
  The alias text uses `AccessPath.value()`, the lexical absolute form — the same accessor the display paths use — not a new normalization.
- The package prefers config patterns over new runtime mechanisms.
  This is a change to an existing matcher rather than a new mechanism, and it is recorded as such here because it is the closest this change comes to that line.

## Design Overview

### The alias value set

Each command unit is evaluated against a set of texts that name the same command:

| Value     | Text                                                         | Purpose                                                                                            |
| --------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| raw       | the unit as typed                                            | today's behavior, unchanged                                                                        |
| absolute  | each resolved path argument replaced by `AccessPath.value()` | a rule written in the absolute spelling                                                            |
| canonical | the same, using `resolvedAlias()`                            | a rule written in the symlink-resolved spelling, which macOS `/tmp` → `/private/tmp` makes routine |

The canonical value is added only when at least one token has a distinct `resolvedAlias()`, so the common case carries two values.
The set is bounded at three values however many tokens a command has, because each value is one text, not a cross product: a command whose tokens are mixed between the two absolute spellings matches a rule written in either spelling only when every token in that rule's path agrees.
That residual is recorded rather than solved — a per-token cross product would make the number of lookups a function of the argument count.

Evaluation is last-match-wins across the union, which is `evaluateAnyValue`'s semantics, and it is the same treatment `AccessPath.matchValues()` already gives the path surfaces.
The ordering is what makes the change work: `rm *: ask` matches the raw text, the operator's later `rm /tmp/agent-builds/*: allow` matches the absolute text, and the later rule decides.
An `allow` written *before* the broader `ask` still loses, so the operator's ordering remains the lever.

### Span retention

The rewrite replaces an argument node's whole source span, not its resolved text.
Quote removal and `$HOME` expansion in `resolveNodeText` mean the candidate's `token` string is not always the source substring, and replacing the resolved text inside a quoted argument would leave the quotes in the rewritten command, where no path pattern matches them.

Two spans are therefore threaded through the existing walk:

1. `PathToken` carries the argument node's `startIndex`/`endIndex`.
   A token the collectors derive from something other than a node text (`collectStatementOperandTokens`, the `find` directive path, and the redirect directive path) carries no span and takes no part in the alias text, which keeps the rewrite fail-safe by construction: a token nobody can locate is never rewritten.
2. `BashCommand` carries its own `startIndex`/`endIndex`, so a token belongs to the unit whose span contains it.

`BashProgram` gains one accessor returning the alias texts per command unit, built by replacing each contained candidate's span with its resolved form, right to left so the remaining spans stay valid.

### Attribution, prompt, and session approval

- `evaluateAnyValue` already returns the value that matched.
  `buildCheckResult` drops it for every surface but `mcp`; the new intent carries it into `PermissionCheckResult` so the prompt can show the resolving text beside the command as typed (ADR 0011).
- The review log records the raw command as it does today and adds the alias text only when one decided, so a `deny` or `ask` reads with the same blame a path gate already provides.
- The `bash` session-approval pattern stays the raw command text — the text the prompt showed.
  A grant therefore covers the spelling that was approved and not its sibling; re-entering through the other spelling asks once more.
  See Risks.

## Module-Level Changes

### `src/access-intent/bash/token-collection.ts`

`PathToken` gains an optional source span.
Each construction site that reads `resolveNodeText(child)` passes that child's span; the three sites built from a derived value pass none.

### `src/access-intent/bash/command-enumeration.ts`

`BashCommand` gains its source span.
`collectCommands` already holds the statement node it emits from, so the span is read there.

### `src/access-intent/bash/bash-path-resolver.ts`

`PathCandidate` and `BashPathRuleCandidate` carry the span from the token.
`probeBareToken` carries it through the existence probe.

### `src/access-intent/bash/program.ts`

One new accessor returning the alias texts for the parsed program's command units.
`pathRuleCandidates()` stays the path surfaces' slice; the new accessor is the bash surface's.

### `src/access-intent/access-intent.ts` and `src/policy/permission-manager.ts`

A new `alias-values` intent kind: a surface plus two or three lookup values that name the same invocation.
`buildCheckResult` evaluates it with `evaluateAnyValue` and records the matched value.
The intent is string-based like `path-values`, so the manager's boundary (ADR 0002) is unchanged, and the resolver's family fold is not involved because `bash` is not a family.

### `src/handlers/gates/bash-command.ts`

`resolveOnBashSurface` takes the unit's alias texts and resolves the alias intent instead of the single-value `tool` intent.
The wrapper floor, the unparsed-subtree floor, and the most-restrictive fold across units are untouched — they act on the result, not on the lookup.

### `src/presentation/` and `src/handlers/gates/helpers.ts`

The ask payload discloses the resolving text when it differs from the command as typed.

### `docs/configuration.md`

`### bash Surface` states that a path argument is matched in its resolved spellings as well as as-typed, names the mixed-spelling and session-grant residuals, and points at the path surfaces for policy that is about files rather than command shape.

## Test Impact Analysis

| File                                                   | Change                                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/access-intent/bash/program.test.ts`              | New cases for the alias accessor: relative token, quoted argument, `~`, non-literal base, glob token, and the canonical form when a symlink resolves         |
| `test/handlers/gates/bash-command.test.ts`             | Red case for the reported repro, then the ordering cases (allow after the ask decides; allow before it does not)                                             |
| `test/policy/permission-manager-unified.test.ts`       | The alias intent's `evaluateAnyValue` semantics and the recorded matched value                                                                               |
| `test/access-intent/bash/token-collection.test.ts`     | Spans on the node-derived tokens, and their absence on the derived ones                                                                                      |
| `test/handlers/gates/bash-command-metamorphic.test.ts` | Existing metamorphic properties must hold with the larger value set: a wrapper floor stays an ask whatever the alias matches, and a deny is never downgraded |

Existing bash-gate tests are the regression guard for the fail-closed cases, and they are expected to pass unchanged.

## Invariants at risk

| Invariant                                                | Where it is pinned                                                   | Why this change could break it                                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| A chain's most restrictive unit decides                  | `test/handlers/gates/bash-command.test.ts`                           | Aliases are per unit; a wider lookup must not be applied to the whole chain                               |
| A wrapper's `allow` floors to `ask`                      | `bash-command.ts` `WRAPPER_SENTINEL` cases                           | The floor is applied after the resolve, so it must read the floored result and not the alias that matched |
| An unparsed subtree's `allow` floors to `ask`            | `UNPARSED_SUBTREE_SENTINEL` cases                                    | same                                                                                                      |
| An explicit `deny` is never downgraded                   | `pickMostRestrictive` cases                                          | a new matching value can only add matches within one unit; the fold still sees every unit's worst result  |
| A `path` allow cannot loosen an `external_directory` ask | package skill, `test/handlers/gates/tool-call-gate-pipeline.test.ts` | this change adds no cross-surface composition, and must not start one                                     |
| The known base is required for resolution                | [#393] cases in `bash-path-resolver` tests                           | the alias text must be empty for an unknown base rather than falling back to the session cwd              |

## TDD Order

1. `refactor:` thread the source span through `PathToken` and `BashPathRuleCandidate`, with spans absent on the derived tokens.
   Existing tests must pass unchanged.
2. `refactor:` add the source span to `BashCommand`.
3. `test:` add the alias accessor's cases to `program.test.ts` — they fail until step 4.
4. `feat:` implement the alias accessor on `BashProgram`.
5. `test:` add the alias intent's cases to `permission-manager-unified.test.ts`, then `refactor:` add the intent kind and route it through `evaluateAnyValue`.
6. `test:` add the reported repro and the ordering cases to `bash-command.test.ts`, then `feat:` wire the alias texts into `resolveOnBashSurface`.
7. `feat:` disclose the resolving text in the ask payload and the review log.
8. `docs:` update `### bash Surface` and the package skill's matching note.

## Risks and Mitigations

| Risk                                                                                | Assessment                                                                                                                                                                                                                             | Mitigation                                                                                                                             |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A silent permission widening                                                        | The intended widening: a rule written in an absolute spelling now governs the relative spelling of the same resolved path. It cannot reach a path the resolver did not resolve, and an unresolvable token keeps its literal value (R1) | The rewrite reads only classified candidates with a span; every new match is a named test case; the change is documented as a widening |
| A quoted path argument starts matching a path rule                                  | Real, and a widening beyond the reported repro, because the rewrite replaces the quoted node span                                                                                                                                      | Covered by its own test case and named in `docs/configuration.md`                                                                      |
| A session grant does not cross spellings                                            | Real. The grant records the approved command text, so the sibling spelling asks once more                                                                                                                                              | Stated in the docs as a residual; widening the grant to the alias text would grant a pattern the prompt never showed                   |
| A command whose tokens are mixed between the two absolute spellings matches neither | Real but narrow                                                                                                                                                                                                                        | Stated as a residual; the three-value bound is what keeps the lookup count independent of the argument count                           |
| Collision with Phase 15 steps 1–3                                                   | Real: they rewrite `token-collection.ts`, `command-enumeration.ts`, and the resolver this change edits, and their prep tidying touches the same loops                                                                                  | Sequence this change before or after those steps, never beside them; no other session is in this package while it lands                |
| The alias text drifts from the gate's own token set                                 | A second derivation of the same list is the failure this package has paid for before                                                                                                                                                   | The accessor consumes `pathRuleCandidates()`'s own spans; no second walk over the AST                                                  |

## Open Questions

1. Should the alias text be built for tokens inside the working directory as well, or only for external ones?
   Uniform handling is simpler to reason about and lets a rule written either way match; external-only keeps the rewritten text closer to what the operator typed.
   The recommendation is uniform, because the containment decision is already a separate question from pattern matching.
2. Should the review log record both texts on every bash decision, or the alias only when it decided?
   The recommendation is the latter, so the log stays a record of decisions rather than of derivations.

## References

[#393]: https://github.com/gotgenes/pi-packages/issues/393
[#418]: https://github.com/gotgenes/pi-packages/issues/418
[#804]: https://github.com/gotgenes/pi-packages/issues/804
[#822]: https://github.com/gotgenes/pi-packages/issues/822
[#910]: https://github.com/gotgenes/pi-packages/issues/910
