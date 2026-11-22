---
issue: 985
issue_title: "pi-permission-system: a heredoc tail the grammar cannot parse floors to `ask`, so a `deny` on the command after it never fires"
---

# Salvage a heredoc's line by re-parsing its heredoc-free spelling

## Release Recommendation

**Release:** ship independently

The Phase 15 roadmap step for this issue (`#### [#985] A heredoc tail the grammar cannot parse still reaches the rules`) is tagged `Release: independent` and belongs to no batch.
It is a `fix:`: a `deny` newly fires only on spellings whose heredoc-free spelling it already hits, and no decision is loosened.

## Problem Statement

`tree-sitter-bash` 0.25.1's `heredoc_redirect` accepts one tail form after the delimiter.
Valid bash such as `cat <<EOF ; rm -rf x` (`bash -n` exits 0) parses with an `ERROR`, so ADR 0013 §10 floors the statement to `ask`.
The [#875] salvage then re-parses the innermost unresolved node's own source text, and for these forms that text fails again, so nothing is recovered.
Under `bash: {"*": "allow", "rm *": "deny"}` the gate asks where the heredoc-free spelling (`cat ; rm -rf x`) is denied, and approving the prompt runs `rm`.
`cat <<EOF arg > /tmp/o` also never projects `/tmp/o` as a write.

## Goals

- A command written after an unparseable heredoc tail (`;`, `&`, `|` after `0<<`) is enumerated, and an explicit `deny` on it fires.
- Words and redirects after the heredoc reach the command as its arguments and redirects, so `cat <<EOF arg > /tmp/o` enumerates `cat arg` and projects `/tmp/o` as a `write`.
- The floor stays: every recovered unit is still `parseUnresolved`, so its `allow` is clamped to `ask` and the prompt still names the whole command.
- The mechanism is a second kind of salvage candidate, not a pre-pass (operator decision): the heredoc-free spelling of the heredoc's line, admitted only when it re-parses cleanly.
- Purely additive, duplicates accepted (operator decision): no dedupe mechanism.
- Non-breaking.
  No `deny` or `ask` is lost; a command with no unresolved heredoc salvages exactly what it does today.

## Non-Goals

- **Lifting the floor.**
  Parsing the heredoc-free spelling as the *primary* parse would let a clean re-parse turn `ask` into `allow`; the roadmap step's constraint keeps the floor for whatever stays unresolved.
- **Refusing input bash rejects** ([#986]) and **the prompt's reason text for it** ([#976]).
  Both read the same floor this change leaves in place; neither is touched.
- **The `-` a heredoc absorbs** ([#941]).
  The salvaged unit for `git commit -F - <<'MSG' 2>&1 | …` is `git commit -F` (measured), so the project deny rule spelled `git commit -F` still matches; the primary unit is unchanged too.
- **Deduplicating units.**
  A heredoc-free candidate re-enumerates the heredoc's own command and any region the #875 salvage already recovered inside that line.
  Units are not written to the review log, and the most-restrictive fold is indifferent to repeats.
- **Heredoc forms the grammar misreads before the tail.**
  `cat <<A <<B ; rm -rf x` lexes the second `<<B` as `< <B`, so its line has no second heredoc to cut, its heredoc-free candidate still errs, and it is dropped.
  The region salvage already recovers `rm -rf x` there (measured), and whatever stays unresolved stays floored.
- **A heredoc whose host statement starts inside a construct left open on its line** (`{ cat <<EOF ; rm x; } > o`, where the host is the inner `cat` statement and the candidate is `cat ; rm x; } > o`).
  The candidate errs and is dropped, so the statement stays floored, which is fail-closed.
- **Heredoc bodies.**
  The body stays where it is in the primary tree, and the walkers still descend it for substitutions; the candidate carries no body.

## Background

- `src/access-intent/bash/unresolved-salvage.ts` — `withSalvagedRoots(primary, reparser, use)` re-parses the text of each innermost unresolved non-`ERROR`, non-root node (`unresolvedRegionsWithin`), keeps a tree only when `parseUnresolvedWithin(tree.rootNode)` is false, hands the roots to `use`, then deletes them.
  Its two callers are `BashProgram.parse` (`program.ts`), for units via `collectSalvagedCommands` and paths via `BashPathResolver.resolve(root, salvaged)`, and `parseBashCommandsSync` (`sync-commands.ts`), for the advisory path at gate parity.
- `collectSalvagedCommands` starts from `SALVAGED_SCOPE` (`parseUnresolved: true, salvaged: true`), so every recovered unit is floored by `floorUnparsedUnit` in `handlers/gates/bash-command.ts`.
  `resolveBashCommandCheck`'s whole-string check is keyed on the *primary* parse matching nothing (`salvaged !== true`), which is unaffected.
- `BashPathResolver` walks a salvaged root from `UNKNOWN_BASE`: a literal absolute `cd` inside the salvaged text establishes a known base, and a relative `cd` from an unknown base stays unknown.
- `parse-health.ts` is the only module that reads `TSNode.hasError` / `previousSibling` (its architecture entry's constraint), so the new walk reaches a preceding token by sibling index through `parse-view.ts`'s `childrenOf`, not through `previousSibling`.
- `parser.ts`'s `getParser` hands out the corrected tree (`hoistHeredocTails` then `reattachRedirectArguments`), and the salvage re-parses through the same parser, so a heredoc-free candidate gets the [#977] word correction, which is what yields `cat arg`.
- ADR 0013's §10 residual paragraph listed "a heredoc pre-pass introducing a second notion of what a bash program is" among the fixes outside the fold; its 2026-09-15 amendment added the re-parse salvage as a fourth, inside it.

## Design Overview

### The observed scenario

Measured at `c090d185` (the tree this plan was written against).
An allow-all resolver denied any unit starting with `rm`, and the command went through the real `BashProgram.parse` and `resolveBashCommandCheck`:

| Command                                    | Units today                           | Verdict today                   |
| ------------------------------------------ | ------------------------------------- | ------------------------------- |
| `cat <<EOF ; rm -rf x`                     | `cat`                                 | ask (`<unparsed-bash-subtree>`) |
| `cat <<EOF & rm -rf x`                     | `cat`                                 | ask                             |
| `cat <<EOF arg > /tmp/o`                   | `cat`, no external path               | ask                             |
| `cat 0<<EOF \| rm -rf x`                   | `cat`, the blob `0<<EOF \| rm -rf x…` | ask                             |
| `git commit -F - <<'MSG' 2>&1 \| rm -rf x` | `git commit -F`, salvaged `rm -rf x`  | deny                            |
| `cat <<EOF > /tmp/o \| rm -rf x`           | `cat`, salvaged `rm -rf x`            | deny                            |

Each heredoc was closed by a body line and its delimiter.
The grammar trees explain the first four rows.
In rows one to three the `ERROR` sits directly under `heredoc_redirect`, so the innermost unresolved node is the redirect, whose text (`<<EOF ; rm -rf x…`) re-parses into the same failure.
In row four the grammar lexes `0<<EOF` as one `heredoc_start` inside a top-level `ERROR`, which is never a candidate.

### The mechanism: a heredoc-free candidate

For each heredoc whose **host is unresolved**, derive one candidate text and offer it to the existing clean-re-parse guard, after the region candidates.

- **Host.**
  The nearest `redirected_statement` ancestor of the `heredoc_start`; when there is none, the nearest enclosing `ERROR` (row four).
  The candidate is derived only when `parseUnresolvedWithin(host)` holds, so a clean heredoc beside an unrelated failure yields nothing new.
- **Span.**
  From the host `redirected_statement`'s start (or, with an `ERROR` host, the start of the heredoc's source line) to the end of the heredoc's source line: the first `\n` at or after the `heredoc_start`'s end.
  Anchoring on the statement rather than the line is what recovers `if true; then cat <<EOF ; rm x`, whose line alone re-parses as an unterminated `if`.
- **Cut.**
  Every `heredoc_start` in the span is removed together with its operator: the anonymous `<<` / `<<-` token before it and, before that, a `file_descriptor` (`2<<EOF`), plus the spaces and tabs immediately before the cut.
  Row four's zero-width `<<` and its `heredoc_start` covering `0<<EOF` fall out of the same rule.
  The whitespace is part of the cut so the unit reads `cat arg`, the heredoc-free spelling a rule is written against, not `cat  arg`.
- **Admission.**
  Unchanged: `reparser.parse(text)`, dropped when `parseUnresolvedWithin(tree.rootNode)` holds.
  Candidates from the same span are derived once, keyed by span start.

```typescript
// heredoc-free-lines.ts
/**
 * The heredoc-free spelling of each line whose heredoc sits in a statement the
 * primary parse could not resolve, in source order.
 */
export function heredocFreeLinesWithin(root: TSNode): string[];

// unresolved-salvage.ts, after the preparatory refactor
const candidates = [
  ...unresolvedRegionsWithin(primary).map((region) => region.text),
  ...heredocFreeLinesWithin(primary),
];
for (const text of candidates) {
  const tree = reparser.parse(text);
  // unchanged guard
}
```

The new module reads `hasError` only through `parseUnresolvedWithin` and reaches preceding tokens by index in `childrenOf(parent)`, which it holds because the walk descends from the root with the parent in hand.
It imports `parse-health.ts` and `parse-view.ts`, and neither reaches `unresolved-salvage.ts`, so the new edge `unresolved-salvage.ts → heredoc-free-lines.ts` closes no cycle.
It walks into `ERROR` nodes, which `unresolvedRegionsWithin` deliberately never does, because the `heredoc_start` token it looks for can sit inside one.
The token is produced by the scanner rather than invented by recovery, and a wrong cut can only yield a candidate that is dropped or that adds units.

### Why the safety argument still holds

The #875 argument is that recovery invents structure and invented structure does not re-parse.
Here the text is derived, not sliced, so the argument gains one clause: the derivation only **removes** source spans that the scanner tokenized as heredoc operators, and the result must still re-parse cleanly.
Every recovered unit is `salvaged` and `parseUnresolved`, so it can add a `deny` or a path projection and cannot lift the floor.
The trigger stays the parse's health: the host must be unresolved.

### Prototype measurement

A throwaway patch to `withSalvagedRoots` (reverted before this plan was committed) ran through the real parser, `BashProgram.parse`, and `resolveBashCommandCheck`, with the same resolver as the observed-scenario table:

| Command                                               | Units after                                              | Verdict after                 |
| ----------------------------------------------------- | -------------------------------------------------------- | ----------------------------- |
| `cat <<EOF ; rm -rf x` (also `&`, `2<<EOF`, `<<-EOF`) | `cat`, `cat`(s), `rm -rf x`(s)                           | **deny**                      |
| `cat 0<<EOF \| rm -rf x`                              | `cat`, blob, `cat`(s), `rm -rf x`(s)                     | **deny**                      |
| `cat <<EOF arg > /tmp/o`                              | `cat`, `cat arg`(s); `/tmp/o` projected `write (syntax)` | ask                           |
| `echo hi && cat <<EOF ; rm -rf x`                     | `echo hi`, `cat`, `echo hi`(s), `cat`(s), `rm -rf x`(s)  | **deny**                      |
| `cat <<EOF arg 2>/dev/null ; rm x`                    | `cat`, `cat arg`(s), `rm x`(s)                           | **deny**                      |
| `if true; then cat <<EOF ; rm x` … `fi`               | the `if` whole, `true`, `cat`, `cat`(s), `rm x`(s)       | **deny**                      |
| `cat <<A <<B ; rm -rf x`                              | unchanged (line candidate errs)                          | deny, from the region salvage |
| `cat <> rw.txt`                                       | unchanged                                                | ask                           |

`(s)` marks a salvaged unit.
The corpus is every distinct `bash` command in the local review log, excluding any truncated with `…`: 9084 commands, each parsed with and without the new candidate on the same tree.
8 hold a heredoc in an unresolved parse, and 7 change, all of the `git commit -F - <<'MSG' 2>&1 | tail -N` shape.
Every change is a duplicated unit (`git add -A`, `git commit -F`, `tail -N`), plus one extra literal-only path candidate.
No verdict changes.
With the prototype, 11 existing tests failed, all exact-list assertions over salvage output (listed under Module-Level Changes).
The input is real (the review log and the real parser), the path is the gate's own resolver, and the control is the same run with the new candidate disabled.

## Module-Level Changes

- `src/access-intent/bash/unresolved-salvage.ts`
  - Preparatory: `withSalvagedRoots` loops over candidate **texts** (`unresolvedRegionsWithin(primary).map((region) => region.text)`), with the same guard and result.
  - Behavior: appends `heredocFreeLinesWithin(primary)` after the region texts; the doc comments on `withSalvagedRoots` and the module say a candidate is a region's own text **or** a heredoc line's heredoc-free spelling, and add the removal-only clause to the safety argument.
- `src/access-intent/bash/heredoc-free-lines.ts` (new) — `heredocFreeLinesWithin(root)` as designed.
- `test/access-intent/bash/heredoc-free-lines.test.ts` (new) — the candidate texts over real `getParser()` parses.
- `test/access-intent/bash/unresolved-salvage.test.ts` — rewrite four tests and add three:
  - "salvages the redirect holding the command tree-sitter dropped", "salvages a region whose dropped command reads a path", and "salvages the innermost unresolved node, not an enclosing one" gain the appended heredoc-free text.
  - "salvages nothing from an unterminated heredoc whose body re-parses as garbage" becomes "salvages the heredoc's line and nothing from its body" (`["cat"]`).
  - "deletes them even when the caller throws" expects one deletion per admitted tree (2).
  - New: a heredoc-free candidate admitted for `cat <<EOF ; rm -rf x`, one dropped when its re-parse errs (`cat <<A <<B ; rm -rf x`), and the region candidates ordered ahead of the heredoc-free ones.
- `test/access-intent/bash/program.test.ts` — the #742 "emits an unterminated heredoc … whole" row, the #840 "marks a command the failure reaches only through its statement", and the #875 "appends the salvaged unit…" and "flags a salvaged indirection wrapper…" gain the appended units. "keeps a relative operand literal rather than resolving it against the cwd" asserts that the region candidate's literal `../secret` is still among the candidates, rather than `.find`ing the first.
  The statement-anchored line now also carries its `cd /outside`, which resolves `../secret` to `/secret`, the file bash really opens, and that is additive.
  New describe `a heredoc tail the grammar cannot parse`: the issue's rows (units and `/tmp/o` write).
- `test/access-intent/bash/sync-commands.test.ts` — "enumerates a command a partial parse dropped (#875)" gains the appended units; new parity case for `cat <<EOF ; rm -rf x`.
- `test/handlers/gates/bash-command-metamorphic.test.ts` — the anti-invention property "emits no unit whose text the command does not contain" is restated at word level (see TDD step 2), and the `unresolved` list gains the four issue rows plus the `if` row.
  Its "fails closed" and "keeps every primary unit, in order" properties then cover them unchanged.
- `test/service/bash-advisory-check.test.ts` — one case: the advisory answer for `cat <<EOF ; rm -rf x` under an `rm *` deny is `deny`.
- `docs/architecture/architecture.md`:
  - New module-tree entry for `heredoc-free-lines.ts`, beside `unresolved-salvage.ts`.
  - The `unresolved-salvage.ts` entry names the second candidate kind and the removal-only clause.
  - The `heredoc-tails.ts` entry's last constraint ("a tail the grammar cannot parse stays erroring and floored (#985)") says the salvage re-parses that tail's heredoc-free spelling.
  - Phase 15: `✅` on the `#### [#985]` heading and on the `S985` Mermaid node, plus a `Landed:` note with the corpus re-measurement.
- `docs/decisions/0013-permission-policy-model.md` — a dated amendment after the 2026-09-15 one.
  It records that a salvage candidate may be a derived text, bounded to removing scanner-tokenized heredoc operators and admitted by the same clean re-parse.
  It also records how this differs from the "heredoc pre-pass" the §10 paragraph set aside: the primary parse and the floor are untouched.
- **Predicted unchanged:**
  - `src/access-intent/bash/program.ts` and `src/access-intent/bash/sync-commands.ts`: both consume `withSalvagedRoots` roots, whose type is unchanged.
  - `src/handlers/gates/bash-command.ts`: the whole-string check keys on `salvaged`, which every new unit carries.
  - `src/access-intent/bash/heredoc-tails.ts`: the new module reads the corrected tree and rewrites no node.
  - `.pi/skills/package-pi-permission-system/SKILL.md`: it names `unresolved-salvage.ts` as the entry that carries the salvage, and that name is unchanged.
    It lists no module a reader would miss, because the new module is reached through that entry.

## Test Impact Analysis

1. New tests the change enables: `heredoc-free-lines.test.ts` pins the derived text itself, which today is only observable through units.
   It pins the cut (operator, descriptor, whitespace), the anchor (statement vs line), and the host-unresolved trigger.
2. Redundant tests: none.
   The region-salvage tests still pin the region mechanism, which remains the only recovery for `cat <<A <<B ; …` and for non-heredoc gaps.
3. Tests that stay as-is: the stub-node test ("salvages a region no redirect holds") has no `heredoc_start`, so it is unaffected.
   The `<>` and malformed-input "salvages nothing" cases carry no heredoc, so they are unaffected too.

## Invariants at risk

- **Salvage is additive** ([#875]) — `bash-command-metamorphic.test.ts` "keeps every primary unit, in order": the new candidates are appended after the region candidates, which are appended after the primary units.
- **Invented structure is never admitted** ([#875], [#742]) — the `unresolved-salvage.test.ts` "a region whose own re-parse fails" cases, plus the new heredoc-free "dropped when its re-parse errs" case.
  The word-level anti-invention property (step 2) extends to derived text.
- **Recovered units stay floored** ([#840]) — `bash-command-metamorphic.test.ts` "fails closed" over the widened `unresolved` list; `cat <<EOF arg > /tmp/o` still asks.
- **The primary-matched-nothing whole-string check** ([#875]) — keyed on `salvaged`; `bash-command.test.ts`'s existing case pins it, and every heredoc-free unit is `salvaged`.
- **A clean heredoc tail is untouched** ([#979]) — `heredoc-free-lines.test.ts` "yields nothing for a heredoc whose host parsed" and the unchanged `heredoc-tails.test.ts`.
- **A salvaged relative path is not resolved against the session cwd** ([#393]) — the rewritten "keeps a relative operand literal" test; a salvaged walk still starts from `UNKNOWN_BASE`.
- **Gate/advisory parity** — the `sync-commands.test.ts` parity case.

## TDD Order

1. **Preparatory: candidate texts, not nodes.**
   `refactor(pi-permission-system): iterate the salvage's candidate texts rather than its nodes`.
   `withSalvagedRoots` builds `unresolvedRegionsWithin(primary).map((region) => region.text)` and loops over it.
   Friction it prepares: the behavior step then appends a second text source to an existing array instead of reshaping the loop.
   Verify: `unresolved-salvage.test.ts`, `program.test.ts`, and `sync-commands.test.ts` all pass unchanged.

2. **Preparatory: anti-invention at word level.**
   `test(pi-permission-system): state the salvage's anti-invention property over words`.
   In `bash-command-metamorphic.test.ts`, "emits no unit whose text the command does not contain" becomes "emits no unit whose words are not the command's words, in order".
   Split both on whitespace and check that the unit's words form a subsequence of the command's.
   Friction it prepares: `cat <<EOF arg > /tmp/o` salvages `cat arg`, which is not a substring of the command, so step 4's new row would fail the substring form while inventing nothing.
   Green on arrival: an invariant pin.
   Killing mutation: make `collectCommandsInto` emit `` `${text} INVENTED` `` for each unit → every row red.

3. **The heredoc-free spelling, unwired.**
   `refactor(pi-permission-system): derive the heredoc-free spelling of a line the grammar could not parse`.
   Add `heredoc-free-lines.ts` and `heredoc-free-lines.test.ts`.
   Cases, each through `getParser()`, with texts as measured by the prototype:
   - `cat <<EOF ; rm -rf x` → `["cat ; rm -rf x"]`; likewise `&`, `2<<EOF`, `<<-EOF`, `<<"EOF"`.
   - `cat <<EOF arg > /tmp/o` → `["cat arg > /tmp/o"]`.
   - `cat 0<<EOF | rm -rf x` → `["cat | rm -rf x"]` (an `ERROR` host, line anchor).
   - `git commit -F - <<'MSG' 2>&1 | rm -rf x` → `["git commit -F - 2>&1 | rm -rf x"]`.
   - `echo hi && cat <<EOF ; rm -rf x` → `["echo hi && cat ; rm -rf x"]`.
   - `if true; then cat <<EOF ; rm x` … `fi` → `["cat ; rm x"]` (statement anchor).
   - Two unresolved heredocs on separate lines → two texts, in source order.
   - `cat <<'EOF'` + unterminated body → `["cat"]`.
   - Nothing for: `cat <<EOF | rm -rf x` (clean), a clean heredoc beside an unrelated failing statement, and a command with no heredoc.

   Killing mutations, one per class:
   - (a) omit the whitespace extension → the exact texts gain a double space.
   - (b) omit the `file_descriptor` extension → `2<<EOF` yields `cat 2 ; rm -rf x`.
   - (c) cut only the `heredoc_start` → `cat << ; rm -rf x`.
   - (d) drop the host-unresolved check → the clean-heredoc case yields a text.
   - (e) always anchor on the line start → the `if` case yields `if true; then cat ; rm x`.
   - (f) stop descending `ERROR` nodes → row four and the unterminated case yield `[]`.

   Re-read the moved sibling-index logic against the `parse-health.ts` constraint: no `previousSibling` or `hasError` read outside it.

4. **Wire it into the salvage.**
   `fix(pi-permission-system): deny a command written after a heredoc the grammar cannot parse`.
   Append `...heredocFreeLinesWithin(primary)` after the region texts, and update the doc comments.
   In the same commit, update the 11 exact-list tests (Module-Level Changes), because the append is what breaks them.
   Add:
   - `unresolved-salvage.test.ts`: admitted, dropped-on-error, and ordering.
   - `program.test.ts` `a heredoc tail the grammar cannot parse`: the issue's rows' units, and `/tmp/o` as a `write` external access for `cat <<EOF arg > /tmp/o`.
   - `sync-commands.test.ts` parity, and `bash-advisory-check.test.ts` deny.
   - The metamorphic `unresolved` rows.

   Killing mutations:
   - (a) delete the `...heredocFreeLinesWithin(primary)` spread → every new admitted case and the four issue rows' units go red, and the metamorphic rows stay green (they pin the floor, not recovery).
   - (b) skip the clean-re-parse guard for the appended texts → the `cat <<A <<B ; rm -rf x` dropped-on-error case goes red.
   - (c) put the heredoc-free texts ahead of the region texts → the ordering case goes red.

5. **Docs.**
   `docs(pi-permission-system): record the heredoc-free salvage candidate`.
   Architecture module tree (three entries), the Phase 15 `✅` marks and `Landed:` note, and the ADR 0013 amendment.
   Re-measure the corpus (the prototype's method against the landed code) and write the measured counts into the `Landed:` note.

## Risks and Mitigations

- **A derived text admits a unit that does not run.**
  The derivation only removes scanner-tokenized heredoc operators, the result must re-parse cleanly, and every unit it yields is floored.
  The word-level anti-invention property checks that no unit carries a word the command lacks.
- **The statement anchor resolves a relative path differently from the region salvage** (the `cd /outside` case).
  It resolves against a literal `cd` inside the same statement, which bash runs first, and it adds a candidate without removing the region's literal one.
- **Duplicated units change which unit a decision names.**
  `pickMostRestrictive` names the first unit at the winning level.
  A primary unit precedes its salvaged duplicate, and the floor names the whole command, so the named command is unchanged in every measured row.
- **Cost.**
  One extra re-parse per unresolved heredoc host, only on a failed parse (8 of 9084 corpus commands).

## Open Questions

- None blocking.
  If a later grammar release parses these tails (tree-sitter/tree-sitter-bash#350 covers only the redirect-then-pipe form), the host stops being unresolved and the candidate stops being derived, so no code change is needed.

[#393]: https://github.com/gotgenes/pi-packages/issues/393
[#742]: https://github.com/gotgenes/pi-packages/issues/742
[#840]: https://github.com/gotgenes/pi-packages/issues/840
[#875]: https://github.com/gotgenes/pi-packages/issues/875
[#941]: https://github.com/gotgenes/pi-packages/issues/941
[#976]: https://github.com/gotgenes/pi-packages/issues/976
[#977]: https://github.com/gotgenes/pi-packages/issues/977
[#979]: https://github.com/gotgenes/pi-packages/issues/979
[#986]: https://github.com/gotgenes/pi-packages/issues/986
