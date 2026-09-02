---
issue: 839
issue_title: "pi-permission-system: a path named as a for/select/case statement operand reaches no path surface"
---

# Retro: #839 — a path named as a for/select/case statement operand reaches no path surface

## Stage: Planning (2026-09-02T19:11:26Z)

### Session summary

Planned the closure of the last non-command member of the nested-path bypass family: a `for`/`select` word-list entry and a `case` subject reach neither the `path` nor the `external_directory` surface, because `collectPathCandidateTokens` reads text only from `command` and `file_redirect` nodes.
The design is two dispatch lines in `token-collection.ts` feeding one private walker parameterized by which side of the anonymous `in` keyword carries the operands, with every new token attributed `UNPROVEN_EFFECT`.
Blast radius was measured with a spike rather than estimated, the operator settled both open decisions, and the plan landed as `packages/pi-permission-system/docs/plans/0839-statement-operand-path-projection.md`.

### Observations

- **The measurement was worth the spike.**
  The issue body's figure (17 of 4401 commands carrying a path-shaped operand) counts the *population*, not the behavior change.
  Applying the design as a spike and diffing real `BashProgram.parse` output over 5191 intact review-log commands gave the numbers that actually decide the bump: 22 commands change `pathRuleCandidates()`, 11 change `externalAccesses()`, and — evaluated through `normalizeFlatConfig` + `evaluateAnyValue` against the operator's real global config — **3** newly prompt, 0 stop prompting.
  The spike file was backed up to `/tmp` before editing and restored afterward; the working tree was verified clean.
- **The `case` half is free.**
  The corpus holds 132 `for_statement` nodes contributing 343 argument-typed operand words, and exactly **one** `case_statement`, whose subject is `":$PATH:"`.
  So the `for` half carries the entire blast radius and the `case` half is pure hardening — which is why the plan sequences them as separate cycles with separate killing mutations rather than fusing them.
- **A tempting design was rejected on evidence.**
  The command surface's [#742] work partitions a compound statement's named children into statements and operand words, and it is tempting to reuse the inverse — "the non-statement children are the path operands".
  That is wrong: `for`'s `variable_name`, `function_definition`'s name, and a `case_item`'s pattern words are all non-statement children that name no access.
  The plan records this so the implementing session does not rediscover it.
- **Two properties of the walker are load-bearing and are named as killing mutations.**
  A non-operand child must fall through to the *ordinary recursion* (not `collectHostedExecutionTokens`), or the loop body's commands stop being projected entirely.
  An operand-side child outside `ARG_NODE_TYPES` must do the same, or a `command_substitution` in the word list is read as literal text and loses its own command's [#807] attribution.
  Both regressions produce a green-looking token list, so the effect assertion is the discriminator.
- **An invariant turned out to be unpinned.**
  `for f in $(rm x)` is covered in `program.test.ts` only for `commands()`; the path-surface half of [#741]'s positional-invariance guarantee has no test.
  The plan adds one in the same cycle as the mechanism, since the new branch is the first code that could break it.
- **The roadmap disposition was contradicted and had to be re-decided.**
  `architecture.md` recorded this issue as "deferred to Phase 15 beside [#609]".
  Both open decisions went to the operator: the bump settled as `fix!:` (like [#645], not [#821]'s plain `fix:`), and the roadmap disposition settled as adoption into the open phase as Step 16 rather than an out-of-roadmap independent fix.
- **The change adds false positives at an awkward moment.**
  Two open issues ([#859], [#863]) report false `external_directory` asks from the shape classifiers, and this change feeds those same classifiers new tokens — the measurement surfaced `anomalyco/tap/opencode` and a whole quoted command string as new `path` candidates.
  ADR 0009's layering principle settles the direction (over-surfacing is recoverable), so the plan names the residual in Non-Goals and leaves narrowing to those issues rather than widening this one's scope.

#### Deferred tidyings

- `packages/pi-permission-system/src/access-intent/bash/token-collection.ts` — the hand-rolled `for (let i = 0; i < node.childCount; i++) { const child = node.child(i); if (!child) continue; … }` loop repeats at least five times in this file alone, plus more in `command-enumeration.ts`, `bash-path-resolver.ts`, and `redirect-analysis.ts`; a `namedChildren(node)` / `eachChild(node)` helper is a real, concentrated cleanup but retrofitting the existing sites is unrelated to this change's diff.
  Rejected as scope creep by the Tidy-First assessor; a candidate for a craftsmanship round.

[#645]: https://github.com/gotgenes/pi-packages/issues/645
[#609]: https://github.com/gotgenes/pi-packages/issues/609
[#741]: https://github.com/gotgenes/pi-packages/issues/741
[#742]: https://github.com/gotgenes/pi-packages/issues/742
[#807]: https://github.com/gotgenes/pi-packages/issues/807
[#821]: https://github.com/gotgenes/pi-packages/issues/821
[#859]: https://github.com/gotgenes/pi-packages/issues/859
[#863]: https://github.com/gotgenes/pi-packages/issues/863
