---
issue: 979
issue_title: "pi-permission-system: a heredoc hosts the rest of its command line, so commands, arguments, and redirects after `<<EOF` are never gated"
---

# A heredoc's tail belongs to the command line it interrupts

## Release Recommendation

**Release:** ship independently

The Phase 15 roadmap step for this issue is tagged `Release: independent` and belongs to no batch.
It is a `fix:`: rules newly fire only on spellings that currently get past what their heredoc-free spelling already hits.

## Problem Statement

Writing a heredoc on a line should not change which rules apply to the rest of that line.
`tree-sitter-bash` 0.25.1 parses everything after `<<EOF` on the same line (the heredoc's **tail**) as children of the `heredoc_redirect` node.
Every walker reads a `heredoc_redirect` only as a host of substitutions (`EXECUTION_HOST_TYPES`), so a command, an argument, or a redirect written in the tail never reaches a bash rule or a path gate.
This is [#977]'s cause in a second grammar production: the grammar hangs command-line material on a redirect.

## Goals

- Each part of a heredoc's tail reaches the place its heredoc-free spelling reaches:
  - A `| …` or `&& …` / `|| …` statement is enumerated as its own command units.
  - A tail argument word is an argument of the command the heredoc belongs to.
  - A tail redirect is collected with its operator's effect, and withholds the wrapper floor exemption when it writes.
- "The heredoc-free spelling" is concrete and testable (operator decision): the corrected tree equals the grammar's own parse of the same command with `< in` in place of `<<EOF`, after [#977]'s correction, with the two redirect nodes rendered alike.
- The correction lives at the parser boundary, as a second pass (`heredoc-tails.ts`) composed before [#977]'s, sharing one view type extracted into `parse-view.ts` (operator decision).
- Non-breaking.
  A heredoc with no tail, and every command without a heredoc, parse to exactly the tree they do today.

## Non-Goals

- **A tail the grammar cannot parse.**
  `cat <<EOF ; rm x`, `cat <<EOF & rm x`, `cat <<EOF arg > o`, `cat <<EOF > o | wc`, `0<<EOF`, and the [#875] form `cat <<'MSG' 2>&1 | tail -4` all carry an `ERROR`, so their units are already floored to `ask` (ADR 0013 §10) and the salvage handles what it can.
  The correction leaves an erroring statement exactly as the grammar produced it, as [#977]'s does.
  Upstream tracks the last form as tree-sitter/tree-sitter-bash#350 (open).
  `bash -n` accepts every one of these forms, and the `;`, `&`, words-plus-redirect, and `0<<` forms still hide a `deny` on the command after the heredoc; that is filed as [#985], the Phase 15 step after this one.
  Refusing a command bash itself rejects back to the agent, instead of asking the operator, is filed as [#986] (out of scope for the roadmap).
- **Bash-exact grouping of a rejoined tail.**
  The grammar hangs a redirect on a whole list (`cat < in && a > o` parses as `redirected_statement(list(…), > o)`, tree-sitter/tree-sitter-bash#345), and the corrected heredoc form reproduces that grouping rather than improving on it (operator decision).
  The cost is the existing fail-closed over-attribution ([#803]): the write is also charged to the heredoc's own command.
- **A word tail on a compound body** (`{ echo a; } <<EOF b`).
  Bash rejects it (measured: `bash -c` exits 2, "syntax error near unexpected token `b'"), and [#977]'s `reachesCommand` check already leaves such a statement alone.
- **[#941]'s absorbed `-` operand.**
  The `-` in `git commit -F - <<'EOF'` appears in no node of the grammar's tree (the command ends at `-F`, the heredoc starts at `<<`), and a heredoc with no tail is never rewritten, so the pinned unit `git commit -F` is unchanged.
- **The `bash-path-extractor.ts` facade** ([#978]) gets no case here.
- **Upgrading `tree-sitter-bash`**: 0.25.1 is the latest published version (`pnpm view tree-sitter-bash version`).

## Background

- `src/access-intent/bash/parser.ts`: `getParser()` wraps the memoized grammar parser (`getGrammarParser`) in `correctingParser`, whose `parse()` returns `reattachRedirectArguments(tree.rootNode)`.
  Every consumer (the enumerator, the path resolver, both token walkers, the log masker, the salvage re-parse, the advisory path) parses through it.
- `src/access-intent/bash/redirect-arguments.ts` ([#977]): a bottom-up walk (`correct`) that rewrites each error-free `redirected_statement` whose `file_redirect` carries words after its target (`reattachStatement`, `splitRedirect`, `appendToRightmostCommand`, descending a `list`/`pipeline` body to its last command).
  It builds a `TSNode` view from private primitives: `NodeView`, `adoptingView`, `rewrittenNode`, `asView`, `NodeFields`, `Source`/`sourceOf`, `childrenOf`, `lastNamedChild`.
  None has a consumer outside the file (re-derived: `grep -rn "NodeView\|adoptingView\|rewrittenNode\|asView\|sourceOf\|childrenOf\|lastNamedChild" src test` prints only `redirect-arguments.ts` lines).
- `src/access-intent/bash/redirect-analysis.ts`: `trailingArgumentIndex(redirect)` names where a redirect's grammar-appended words begin; its only production caller is `redirect-arguments.ts`.
- `src/access-intent/bash/command-enumeration.ts`: since [#977], `commandWordNodes` skips every `REDIRECT_NODE_TYPES` child (which includes `heredoc_redirect`) and `gapBetween` joins two words with one space where a hosted redirect *starts* between them.
  `redirectedScope` marks `writesViaRedirect` from a node's `file_redirect` children.
- `bash-path-resolver.ts` walks a `redirected_statement` as a current-shell sequence and, as a pipeline's first stage, through `foldPipelineFirstStage` ([#454]), collecting a statement-level `file_redirect` with `collectRedirectTokens`; a `heredoc_redirect` falls to `collectPathCandidateTokens`, whose `EXECUTION_HOST_TYPES` branch reads only its hosted substitutions.
- The grammar (`node_modules/tree-sitter-bash/grammar.js`, `heredoc_redirect`) allows exactly one tail form after `heredoc_start`:
  1. `_heredoc_command`: one or more literals (words, strings, substitutions, concatenations).
  2. One or more `_redirect`s (`file_redirect` / `herestring_redirect`), optionally followed by `&&`/`||` and a statement.
  3. An aliased `pipeline` node holding `|` or `|&` and a statement.
  4. `&&`/`||` and a statement, as direct children of the `heredoc_redirect`.
- AGENTS.md principle 5 (mechanism is forever) applies.
  This is a second pass of an existing mechanism, deletable if the grammar changes, and the alternative is a heredoc branch in every walker.

## Design Overview

### The observed scenario

Measured at `f02c186860376c2dece967554dd82c8138900c25` with a disposable Vitest spike (not committed), through the real `BashProgram.parse`, `resolveBashCommandCheck`, and `externalAccesses()`, over a real filesystem-backed `PermissionManager` (`createManagerWithConfig`) and `PermissionResolver`, under `bash: {"*": "allow", "git push *": "deny", "rm *": "deny"}`, posix normalizer, cwd `/projects/app`.
Inputs are the issue's repros plus hand-written variants run through the whole real path; each is deterministic, so n = 1 per row.
Each heredoc was closed by a body line and `EOF`.

| Command                          | Units today                         | Verdict today | Path today | Heredoc-free spelling today                                                  |
| -------------------------------- | ----------------------------------- | ------------- | ---------- | ---------------------------------------------------------------------------- |
| `cat <<EOF \| rm -rf /tmp/x`     | `cat`                               | **allow**     | none       | deny                                                                         |
| `cat <<EOF && rm -rf /tmp/x`     | `cat`                               | **allow**     | none       | deny                                                                         |
| `git <<EOF push --force`         | `git`                               | **allow**     | none       | deny                                                                         |
| `cat <<EOF > /tmp/o`             | `cat`                               | allow         | **none**   | `/tmp/o` `write (syntax)`                                                    |
| `cat <<EOF ~/x/in`               | `cat`                               | allow         | **none**   | `~/x/in` `read (core)`                                                       |
| `xargs grep foo <<EOF > /tmp/o`  | `xargs grep foo`, **`core-reader`** | **allow**     | none       | exemption withheld, ask; `/tmp/o`                                            |
| `cat <<EOF \| a && cd /tmp && …` | `cat`                               | allow         | none       | `cd /tmp` enumerated; its fold for later commands is predicted, not measured |

The last two rows go beyond the issue: a heredoc-hosted write also *grants* the core-reader exemption its heredoc-free spelling withholds, and a `cd` after a piped tail never folds.

Bash semantics, measured with `bash -c`:

- `printf "%s|" <<EOF x y` prints `x|y|`: tail words are the command's arguments.
- `cat <<EOF | true && cd /tmp`, then `pwd` on the next line, prints `/tmp`: `&&` binds after the pipeline, so the `cd` runs in the current shell, while the grammar nests `true && cd /tmp` inside the pipe.

**Real-traffic frequency (measured).**
A census (`/tmp/census979.mjs`, not committed; it counts node shapes and transcribes no walker) parsed the 8919 intact distinct bash commands in the local review log with the real `tree-sitter-bash` 0.25.1.

- 587 hold a `heredoc_redirect`.
- 6 have a tail in an error-free statement: 5 redirect tails, every one writing `/tmp/*` (3 with a `command` body, 2 with a `cd … && cat` list body), and 1 `&& git log --oneline -1` tail.
- 0 have a word tail or a pipe tail.
- 7 more hold a redirect tail in a statement that fails to parse, and stay floored.

Under the operator's global config, `external_directory_write` allows `/tmp/*`, so none of the 5 writes newly prompts there.

### Where the correction lives

`correctingParser` composes two passes:

```typescript
rootNode: reattachRedirectArguments(hoistHeredocTails(tree.rootNode)),
```

1. `hoistHeredocTails` (new, `heredoc-tails.ts`) moves a redirect tail and a `|`/`&&` tail out of the heredoc.
   It leaves a word tail in place.
2. `reattachRedirectArguments` ([#977]) learns that a `heredoc_redirect` can carry words, exactly as a `file_redirect` can, and hands them to the command.

The order matters: hoisting `cat <<EOF 2>/dev/null arg` puts a `file_redirect` carrying `arg` at the statement, which the second pass then reattaches, just as it does for `cat < in 2>/dev/null arg`.

### The target shape: the `< in` spelling

The oracle for every case is the grammar's parse of the same line with `< in` in place of `<<EOF`, after [#977]'s correction.
Measured grammar parses of that spelling:

```text
cat < in | a && b      (list (pipeline (redirected_statement (command cat) (file_redirect in)) (command a)) (command b))
cat < in && a || b     (list (list (redirected_statement …) (command a)) (command b))
cat < in | a | b       (pipeline (redirected_statement …) (command a) (command b))
cat < in | a && b > o  (redirected_statement (list (pipeline (redirected_statement …) (command a)) (command b)) (file_redirect o))
cat < in && a > o      (redirected_statement (list (redirected_statement …) (command a)) (file_redirect o))
cat < in > o && rm x   (list (redirected_statement (command cat) (file_redirect in) (file_redirect o)) (command rm x))
x && cat < in | rm y   (pipeline (redirected_statement (list x cat) (file_redirect in)) (command rm y))
{ cat; } < in | rm x   (pipeline (redirected_statement (compound_statement …) (file_redirect in)) (command rm x))
git < in push --force  → after #977: (command git (file_redirect in) push --force)
```

The walkers already handle each of these shapes, including the grammar's own mis-groupings ([#454]'s fold of a list inside a pipeline's first stage, [#803]'s over-attributed write).
So reproducing the oracle reuses that hardening instead of introducing shapes no walker has seen.

### Pass 1: `hoistHeredocTails`

For each error-free `redirected_statement` S with a `heredoc_redirect` child H carrying a redirect tail or a statement tail:

1. **Truncate H.** H′ keeps `<<`/`<<-`, `heredoc_start`, any word tail, `heredoc_body`, and `heredoc_end`.
   Its range stays H's, because its body is written after the rest of the line.

2. **Hoist the redirects.**
   S′ is S with H replaced by H′ followed by H's tail `file_redirect`/`herestring_redirect` children, then S's remaining children, in source order.
   S′ keeps S's range when the tail has no statement.

3. **Rejoin a statement tail.**
   The operator is the `|`/`|&` inside H's `pipeline` child, or the `&&`/`||` token child of H, and T is the statement after it.
   The result replaces S in its parent:

   ```text
   join(S′, op, T) =
     T is redirected_statement        → T with its body replaced by join(S′, op, body)
     T is list                        → T with its first named child replaced by join(S′, op, first)
     T is pipeline and op is | or |&  → pipeline(S′, op, …T's children)
     otherwise                        → pipeline(S′, op, T) for | and |&; list(S′, op, T) for && and ||
   ```

   Each node on the rebuilt spine spans from S′'s start to the largest end beneath it, which is H′'s end.

4. A node's children are corrected wherever they sit, bottom-up, so a heredoc statement nested in a list, a pipeline, a substitution, or another tail is corrected too.

5. A statement with no such heredoc, or with a parse error, is presented as-is; when nothing in the tree changes, the root itself is returned.

A word tail is left in H′ for pass 2.
The grammar never combines a word tail with a redirect or statement tail in an error-free parse (measured: `cat <<EOF arg > /tmp/o` yields an `ERROR`).

### Pass 2: a heredoc carrying words

- `trailingArgumentIndex(redirect)` answers for a `heredoc_redirect` too: the first named child after `heredoc_start` that is neither `heredoc_body` nor `heredoc_end`, or `undefined` when there is none.
- `reattachStatement`'s carrier predicate accepts a `heredoc_redirect` with a trailing index, alongside a `file_redirect` with one.
- `splitRedirect` partitions a carrier's children into kept and moved: moved are the children from the trailing index on that are not `heredoc_body`/`heredoc_end`.
  For a `file_redirect` that is today's suffix; for a heredoc the body and end stay kept, after the words in source.
- `appendToRightmostCommand` and the rebuilt statement grow to the **largest** end among the moved nodes, not the last one's, since a truncated heredoc ends after the words that follow it.

`git <<EOF push --force` becomes `(command (command_name git) (heredoc_redirect …) push --force)`.
The enumerator then emits `git push --force`, since `gapBetween` joins `git` and `push` with one space where the heredoc starts between them.

### The shared view (`parse-view.ts`)

Both passes build the same view, so the primitives move out of `redirect-arguments.ts` together with the bottom-up walk both need:

```typescript
// parse-view.ts
/**
 * `root` with each error-free `redirected_statement` replaced by what `rewrite`
 * returns for it (its children already rewritten), or `root` itself when
 * nothing beneath it changed.
 */
export function rewriteStatements(
  root: TSNode,
  rewrite: (statement: TSNode, children: readonly TSNode[]) => TSNode | undefined,
): TSNode;
export function rewrittenNode(original: TSNode, children: readonly TSNode[], startIndex: number, endIndex: number, source: Source): TSNode;
export type Source = (startIndex: number, endIndex: number) => string;
export function sourceOf(statement: TSNode): Source;
export function childrenOf(node: TSNode): TSNode[];
export function lastNamedChild(node: TSNode): TSNode | undefined;
// NodeView, NodeFields, asView, adoptingView stay module-private.

// redirect-arguments.ts, after the move
export function reattachRedirectArguments(root: TSNode): TSNode {
  return rewriteStatements(root, reattachStatement);
}

// heredoc-tails.ts
export function hoistHeredocTails(root: TSNode): TSNode {
  return rewriteStatements(root, hoistStatement);
}
```

Only the exports a consumer uses are exported, so `fallow dead-code` stays clean.
The new import edges are `parser.ts` → `heredoc-tails.ts` → `parse-view.ts` → `parse-health.ts`.
`parse-view.ts` and `parse-health.ts` reach `parser.ts` only through `import type { TSNode }`, the same type-only edge `redirect-arguments.ts` already has, so no value cycle forms ([#977]'s TDD hit one).

### The view contract, widened for a heredoc

[#977]'s contract, each a test over every node of every rewritten case, carries over with one widening:

1. **Fast path.**
   When nothing qualifies, the returned root *is* the grammar's root (`toBe`).
2. **Text is the source slice** (`node.text === source.slice(start, end)`).
   A truncated heredoc's text therefore still spans its tail's source.
   No consumer reads a `heredoc_redirect`'s own text: it is an `EXECUTION_HOST_TYPES` member in every walker, and the masker's span predicates match only assignment, word, and header nodes.
3. **Children in source order.**
   Each child starts at or after the previous child's end, **unless the previous child is or contains a `heredoc_redirect`**, whose body is written after the rest of its line; it then starts at or after the previous child's start.
4. **Containment** (new): every child lies within its parent's range.
5. **Leaves preserved** (new): every leaf of the grammar's tree appears exactly once in the corrected tree, so nothing is dropped and nothing is walked twice (a duplicated word would double-mask in the log and double-count in the walkers).
6. **`previousSibling`** is the previous child in the corrected tree.
7. **No parse error** anywhere in a rewritten tree.

Contract 3's widening is observable in one consumer: `gapBetween` asks whether a hosted redirect *starts* between two words, so an overlapping heredoc still yields one space between `git` and `push` and the verbatim source between `push` and `--force`.

### Effect on the consumers

| Command                                              | After this plan                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| `cat <<EOF \| rm -rf /tmp/x`                         | units `cat`, `rm -rf /tmp/x`: deny                               |
| `cat <<EOF && rm -rf /tmp/x`                         | units `cat`, `rm -rf /tmp/x`: deny                               |
| `git <<EOF push --force`                             | unit `git push --force`: deny                                    |
| `cat <<EOF > /tmp/o`                                 | `/tmp/o` `write (syntax)`                                        |
| `cat <<EOF ~/x/in`                                   | `~/x/in` `read (core)`                                           |
| `xargs grep foo <<EOF > /tmp/o`                      | exemption withheld: ask                                          |
| `xargs grep foo <<EOF >&2`                           | `core-reader` kept (a descriptor duplication writes no file)     |
| `cat <<EOF \| true && cd /outside && cat ../secret`  | `/secret` projected (the `cd` folds, as for the `< in` spelling) |
| `git commit -q -F - <<'EOF' && git log --oneline -1` | units `git commit -q -F`, `git log --oneline -1`                 |

These are predicted, not measured; step 5's corpus diff measures the real-traffic half.

### Credit

The design adopts no third-party mechanism; the issue is the operator's own, so no `Co-authored-by:` trailer applies.

## Module-Level Changes

- `src/access-intent/bash/parse-view.ts` (new, step 1): `rewriteStatements`, `rewrittenNode`, `Source`, `sourceOf`, `childrenOf`, `lastNamedChild` exported; `NodeView`, `NodeFields`, `asView`, `adoptingView` private.
  Moved verbatim from `redirect-arguments.ts`, except that `correct` becomes `rewriteStatements`, parametrized by the per-statement rewrite, and keeps the `parseUnresolvedWithin` guard.
  Re-read the moved code against the `code-design` skill before committing (an extraction carries the source's doc comments into a shared file; reword any that name only the redirect-argument case).
- `src/access-intent/bash/redirect-arguments.ts`: step 1 imports the primitives and reduces to `reattachRedirectArguments` plus its statement rewrite.
  Step 3 extends the carrier predicate, `splitRedirect`'s partition, and the max-end range growth, and rewords the module doc comment's "a heredoc's own tail is not read here" to say a heredoc's words are reattached here and its other tails by `heredoc-tails.ts`.
- `src/access-intent/bash/redirect-analysis.ts` (step 3): `trailingArgumentIndex` answers for a `heredoc_redirect`, and its doc comment names the heredoc case.
- `src/access-intent/bash/heredoc-tails.ts` (new, step 4): `hoistHeredocTails` and its private statement rewrite and `join`.
  It lives in `access-intent/bash/`, the same fallow zone, so no boundary edit is needed.
- `src/access-intent/bash/parser.ts` (step 5): `correctingParser` composes the two passes, and the `getParser` doc comment names both corrections and why their order matters.
- **Predicted unchanged**, with the claim each rests on:
  - `command-enumeration.ts`: a hosted `heredoc_redirect` is already skipped from words and unit text (`REDIRECT_NODE_TYPES`), and `gapBetween` keys on the redirect's start; a hoisted statement-level `file_redirect` already feeds `redirectedScope`.
  - `token-collection.ts`: a truncated heredoc is still an `EXECUTION_HOST_TYPES` member; a hoisted `file_redirect` reaches `collectRedirectTokens` through the ordinary recursion.
  - `bash-path-resolver.ts`: a hoisted `file_redirect` is a `redirected_statement` child, collected by `walkCurrentShellSequence` and by `foldPipelineFirstStage`'s `file_redirect` branch; a rejoined tail is an ordinary list or pipeline.
  - `nested-execution.ts`: the body stays inside the truncated heredoc, so its substitutions are still found.
  - `logging/command-redaction.ts`: it walks every node of the corrected tree, and contract 5 guarantees each node once.
  - `unresolved-salvage.ts`, `sync-commands.ts`, `program.ts`: they parse through `getParser`; the salvage re-parses erroring regions only, which neither pass rewrites.
  - `handlers/gates/bash-path-extractor.ts`: no production caller ([#978]).
- `test/helpers/bash-parse-tree.ts` (new, step 2): `withCorrected(command, correct, read)`, `shape`, `allNodes`, `spanOf`, and `viewContractViolations(source, root, grammarRoot)`, which returns a list of violated contract items (empty when the tree holds) so a test asserts `toEqual([])`.
- `test/access-intent/bash/redirect-arguments.test.ts`: step 2 imports the helpers and replaces its four contract `it.each` blocks with one over `viewContractViolations`; step 3 adds the heredoc-word cases.
- `test/access-intent/bash/redirect-analysis.test.ts` (step 3): heredoc trailing-index cases, on the grammar parser.
- `test/access-intent/bash/heredoc-tails.test.ts` (new, step 4).
- `test/access-intent/bash/parser.test.ts` (step 5): the composed correction and the `< in` oracle table.
- `test/access-intent/bash/program.test.ts`, `test/handlers/gates/bash-command-metamorphic.test.ts`, `test/logging/command-redaction.test.ts`: new cases in steps 3 and 5.
- No existing test is predicted to change: every heredoc-tail string in `test/` is an erroring `<<'MSG' 2>&1 | …` form or has no tail (re-derived: `grep -rnE "<<-?['\"]?[A-Za-z_]+['\"]? *(\||&&|>|<|[A-Za-z0-9~$/.-])" test src | grep -v "<<<"`).
- `docs/architecture/architecture.md` (step 6):
  - New module-tree entries for `parse-view.ts` and `heredoc-tails.ts`.
  - The `redirect-arguments.ts` entry: its closing "and a heredoc's own tail is not read here (#979)" constraint is replaced by the heredoc-word case, and the view primitives are credited to `parse-view.ts`.
  - The `redirect-analysis.ts` and `parser.ts` entries (the heredoc trailing index; the two-pass composition and its order).
  - The roadmap `#### [#979]` heading and the Mermaid node `S979` gain `✅`, plus a `Landed:` note with step 5's corpus re-measurement.
- `docs/decisions/0009-bash-path-projection-completeness-contract.md` (step 6): a dated `### Amendment` above the 2026-09-25 one, with frontmatter `amended:` and the `## Status` line updated.
  The 2026-09-25 amendment's "A heredoc's own tail (`cat <<EOF > /tmp/o`) is a different grammar production and is not covered (#979)" is superseded by the new amendment, which states the tail is projected where its `< in` spelling is.
- `.pi/skills/package-pi-permission-system/SKILL.md`: predicted unchanged; its one heredoc sentence is about the masker declining a heredoc *body*, which this plan does not touch.
  Step 6 greps it for `heredoc` to confirm.

## Test Impact Analysis

1. **Newly possible.**
   The tail becomes a pure tree transformation tested on the grammar's own output, with an external oracle: the `< in` spelling's parse.
   Today the tail is observable only as an absence in each consumer's result.
2. **Redundant or reframed.**
   `redirect-arguments.test.ts`'s four contract blocks fold into one `viewContractViolations` assertion per case (step 2), which also serves `heredoc-tails.test.ts`.
3. **Stays as-is.**
   - `program.test.ts` "leaves out the operand a heredoc absorbs" ([#941]) and the [#741] heredoc-body cases (`cat <<EOF` with `$(rm e)` in the body).
   - Every [#875] salvage case: its statements err, so neither pass touches them.
   - `redirect-analysis.test.ts`'s file-redirect cases.

## Invariants at risk

| Invariant (constituency)                                                                    | Source         | Pinned by                                                                                                                              | Why it holds                                                              |
| ------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| A corrected tree's offsets are the source's (masker readers, unit text)                     | [#977]         | `viewContractViolations` over every rewritten case, both passes                                                                        | views read text from the statement's source slicer                        |
| The fast path returns the grammar's root (every command's cost and identity)                | [#977]         | identity cases in both test files, including `cat <<EOF` with no tail                                                                  | `rewriteStatements` returns `root` when no rewrite fires                  |
| An erroring statement is never rewritten (users relying on the floor; [#814] attribution)   | [#814], [#840] | new identity case `cat <<EOF > /tmp/o \| wc` (erroring, with a redirect tail); metamorphic "a parse it could not resolve fails closed" | the guard lives in the shared walk                                        |
| The salvage only adds (every user)                                                          | [#875]         | metamorphic "the salvage only ever adds to what the primary parse found"                                                               | the salvage re-parses erroring regions only                               |
| A heredoc body's substitutions still run through the gates (users with `bash` rules)        | [#741]         | `program.test.ts` heredoc-body cases; new step-5 case with a body substitution under a pipe tail                                       | the body stays inside the truncated heredoc                               |
| `git commit -F - <<'EOF'` enumerates as `git commit -F` (this repo's project deny rule)     | [#941]         | `program.test.ts` "leaves out the operand a heredoc absorbs"; step 5's real-traffic `&& git log` case keeps `git commit -q -F`         | no tail means no rewrite, and the command node is never touched by pass 1 |
| A write through a redirect withholds the core-reader exemption (users relying on the floor) | [#803]         | new step-5 pair: `xargs grep foo <<EOF > /tmp/o` withheld, `xargs grep foo <<EOF >&2` kept                                             | the hoisted `file_redirect` is a statement child `redirectedScope` reads  |
| A current-shell `cd` folds for later commands (users with `external_directory` rules)       | [#454]         | existing `cd /outside && cat <<'MSG' 2>&1 \| cat ../secret` case; new clean-tail fold case                                             | the rejoined list is the `< in` spelling's, which the resolver folds      |

The quantitative invariant is measured at step 5: over the review-log corpus, exactly the 6 census commands change, 5 by gaining a `write (syntax)` projection and 1 by gaining the `git log --oneline -1` unit.

## TDD Order

1. **Move the parse-view primitives into their own module.**
   Create `parse-view.ts` with the primitives and `rewriteStatements` (today's `correct`, parametrized by the statement rewrite), and reduce `redirect-arguments.ts` to its rewrite.
   This prepares step 4: `heredoc-tails.ts` needs the same view type, since `asView` recognizes views by `instanceof`, and the same bottom-up walk; without the move it would copy both.
   No new tests; the unchanged `redirect-arguments.test.ts` and package suite, plus `pnpm fallow dead-code` (no unused export, no cycle), are the verification.
   Commit: `refactor(pi-permission-system): move the parse-view primitives into their own module`.
2. **Share the parse-tree test helpers, and pin containment and leaf preservation.**
   Extract `withCorrected` (now taking the correction function), `shape`, `allNodes`, and `spanOf` into `test/helpers/bash-parse-tree.ts`, with `viewContractViolations` checking contract items 2–7 (strict ordering for now).
   `redirect-arguments.test.ts` uses them, and its four contract blocks become one `toEqual([])` per case.
   This prepares steps 3 and 4: `heredoc-tails.test.ts` otherwise copies about 90 lines, and a contract fix made in one copy would miss the other.
   The two new contract items (containment, leaves preserved) are invariant pins, green on [#977]'s cases.
   Killing mutations:
   - Leaves: make `splitRedirect` also keep the moved words among the truncated redirect's children; the leaves check goes red on every word case.
   - Containment: make `splitRedirect` give the truncated redirect the original redirect's `endIndex`; the containment check goes red.
   Commit: `test(pi-permission-system): share the parse-tree helpers and pin a corrected tree's containment and leaves`.
3. **Check the words after a heredoc against the command's own rules.**
   `trailingArgumentIndex` answers for a heredoc; `reattachStatement` accepts a heredoc carrier; `splitRedirect` partitions around `heredoc_body`/`heredoc_end`; the range growth takes the max end; `viewContractViolations` gains the contract-3 heredoc widening.
   Because `getParser` already runs this pass, the fix is live in this step.
   Tests:
   - `redirect-analysis.test.ts` (grammar parser): `git <<EOF push --force` names `push`; `cat <<EOF` (no tail) → `undefined`.
   - `redirect-arguments.test.ts`: before writing the expected shapes, print each case's grammar parse.
     Cases: `git <<EOF push --force` → `(program (command (command_name "git") (heredoc_redirect …) "push" "--force"))`; `x && git <<EOF push` gives the words to `git` in the list; `cat <<EOF $(rm x) "q s"` moves the substitution and the string; `{ echo a; } <<EOF b` and `cat <<EOF` return the root.
     Add the rewritten cases to the contract table.
   - `program.test.ts`: `git <<EOF push --force` → `[{ text: "git push --force" }]`; `sudo <<EOF rm -rf /` → `executedUnit: "rm -rf /"`; `cat <<EOF ~/x/in` (posix, cwd `/projects/app`, home-expanded) projects `~/x/in` as `read (core)`.
   - `bash-command-metamorphic.test.ts`: a describe "writing a heredoc before a command's words does not weaken its decision", placing `<<EOF` after the head word of each bare case (prefix-anchored resolver, as [#977]'s describe uses).
   - `command-redaction.test.ts`: `bash <<EOF -c 'TOKEN=abc123 curl x'` (closed by a body line and `EOF`) masks to `TOKEN=[redacted]`.
   Killing mutations, one per class:
   - (a) Accept only a `file_redirect` carrier: the shape, unit, `executedUnit`, path, metamorphic, and masker cases go red.
   - (b) Keep the suffix partition (move every child from the trailing index on): the body moves into the command, and the shape and leaves-contract cases go red.
   - (c) Grow to `moved.at(-1)`'s end instead of the max: the containment check goes red.
   - (d) Drop the `heredoc_body`/`heredoc_end` exclusion from `trailingArgumentIndex`: `cat <<EOF` names its body, and the `redirect-analysis.test.ts` case and the `cat <<EOF` identity case go red.
   - (e) Drop the contract-3 widening: the ordering check goes red on the heredoc cases (the widening is load-bearing, not slack).
   Commit: `fix(pi-permission-system): check the words after a heredoc against the command's own rules`.
4. **Build the heredoc-tail view.**
   Add `heredoc-tails.ts` with `hoistHeredocTails`, not yet wired.
   Before writing the cases, print each case's grammar parse and its `< in` spelling's parse, so every expected shape is read off real trees.
   Tests (`heredoc-tails.test.ts`, grammar parser plus an explicit call):
   - **Redirect tail:** `cat <<EOF > /tmp/o`; `cat <<EOF > a 2> b`; `cat <<EOF <<< x`; `cat <<EOF 2>/dev/null arg` (the hoisted redirect keeps its word for pass 2).
   - **Redirect then statement:** `cat <<EOF > a && rm x`.
   - **Pipe tails:** `cat <<EOF | rm -rf /tmp/x`, `cat <<EOF |& rm x`.
   - **Expression tails:** `cat <<EOF && rm x`, `cat <<EOF || rm x`.
   - **Rejoin:** `cat <<EOF | a && b`, `cat <<EOF && a || b`, `cat <<EOF | a | b`, `cat <<EOF | a && b > o`, `cat <<EOF && a > o`.
   - **Bodies:** `x && cat <<EOF | rm y` (list body), `{ cat; } <<EOF | rm x` (compound body), `cd a && cat <<'EOF' > /tmp/x` (the real-traffic list shape).
   - **Nesting:** `echo $(cat <<EOF | sh …)`.
   - **Left for pass 2:** `git <<EOF push` returns the root.
   - **Fast path:** `cat <<EOF` (no tail), `git commit -F - <<'EOF'`, and the erroring `cat <<EOF > /tmp/o | wc` and `cat <<'MSG' 2>&1 | tail -4` return the root (`toBe`).
   - **Oracle:** for every rewritten case, `shape` of the result equals `shape` of the grammar's parse of the `< in` spelling, with the heredoc and the `file_redirect "in"` both rendered as one placeholder.
   - **Contract:** `viewContractViolations` is empty for every rewritten case.
   Killing mutations, one per class:
   - Leave tail redirects inside the heredoc: the redirect-tail shape and oracle cases go red.
   - Always build `pipeline(S′, op, T)` / `list(S′, op, T)` without descending T: the `| a && b` and `&& a || b` rejoin cases go red.
   - Skip the `redirected_statement` descent in `join`: `| a && b > o` and `&& a > o` go red.
   - Build a `list` for `|&`: the `|&` case goes red.
   - Make `rewriteStatements` skip its `parseUnresolvedWithin` check: the `cat <<EOF > /tmp/o | wc` identity case goes red, and so does [#977]'s `cat <> rw.txt extra` case in `redirect-arguments.test.ts`.
   - Keep the tail nodes in the truncated heredoc too: the leaves-preserved check goes red.
   - Rewrite only the root's direct children: the nesting case goes red.
   Commit: `refactor(pi-permission-system): build a parse view that moves a heredoc's tail to where its heredoc-free spelling sits`.
5. **Wire the heredoc-tail pass in.**
   `correctingParser` returns `reattachRedirectArguments(hoistHeredocTails(tree.rootNode))`.
   Tests:
   - `parser.test.ts`: `getParser()` presents `cat <<EOF | rm -rf /tmp/x` as a `pipeline` holding a `command` named `rm`, while `getGrammarParser()` does not.
     A `< in` oracle table through `getParser()` for both spellings, covering one case per tail form plus `git <<EOF push --force` and `cat <<EOF 2>/dev/null arg` (both passes composed, in order).
   - `program.test.ts`:
     - `cat <<EOF | rm -rf /tmp/x` → units `cat`, `rm -rf /tmp/x`; the same for `&&`.
     - `git commit -q -F - <<'EOF' && git log --oneline -1` → `git commit -q -F`, `git log --oneline -1`.
     - `cat <<EOF > /tmp/o` → `/tmp/o` `write (syntax)` in `externalAccesses()`.
     - `xargs grep foo <<EOF > /tmp/o` → no `floorExemption`; `xargs grep foo <<EOF >&2` → `floorExemption: "core-reader"`.
     - `cat <<EOF | true && cd /outside && cat ../secret` → `/secret` projected.
     - `cat <<EOF | tail`, then a body line `$(rm e)`, then `EOF` → `rm e` still enumerated with context `command_substitution`.
   - `bash-command-metamorphic.test.ts`: a describe "a heredoc's tail does not weaken the decision", placing each bare case after `cat <<EOF | `, `cat <<EOF && `, and `cat <<EOF > /tmp/o && `.
   Killing mutation: compose only `reattachRedirectArguments` (drop the hoist); every test added in this step goes red, while step 4's tests stay green (they call the pass directly).
   Per-class discrimination lives in steps 3 and 4; the consumer classes share this one seam.
   Verify:
   - The full package suite, `pnpm run check`, and `pnpm fallow dead-code`.
   - A disposable corpus spike (not committed) comparing `commands()`, `pathRuleCandidates()`, and `externalAccesses()` at step 1's parent against this step, over the review log's intact distinct bash commands.
     Predicted: exactly the 6 census commands differ, 5 by a gained `write (syntax)` token and 1 by the gained `git log --oneline -1` unit.
     Record the measured count in the `Landed:` note.
   Commit: `fix(pi-permission-system): gate the commands and redirects written after a heredoc`.
6. **Docs.**
   Update the architecture module tree and the roadmap (`✅` on `#### [#979]` and `S979`, `Landed:` note), plus the ADR 0009 amendment, per Module-Level Changes.
   Get the amendment date from `date -u +%F`.
   Grep `docs/`, `README.md`, and `.pi/skills/package-pi-permission-system/SKILL.md` for `heredoc`, `#979`, and `tail`, and leave no stale claim.
   Commit: `docs(pi-permission-system): record that a heredoc's tail is corrected at the parser boundary`.

## Risks and Mitigations

| Risk                                                                                        | Mitigation                                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An overlapping heredoc range mis-slices unit text or a masked span                          | `gapBetween` keys on a redirect's start (step 3's unit and masker cases pin it); contract 2 over every node; contract 3's widening is scoped to a heredoc-bearing sibling |
| A tail node appears twice (double-masked in the log, double-walked) or vanishes             | Contract 5 (leaves preserved) over every rewritten case in both passes, with its own killing mutation                                                                     |
| The rejoin mis-groups, so a `cd` does not fold or a write is attributed to the wrong unit   | The `< in` oracle is an external reference, compared by shape for every case; the fold is pinned end to end in step 5                                                     |
| A defect in the pass reaches every command                                                  | The fast path returns the grammar's root unless a heredoc carries a tail (6 of 8919 corpus commands); step 5's corpus diff must match the prediction                      |
| An erroring statement is rewritten, turning an unproven redirect into a proven one ([#814]) | The guard lives in the shared `rewriteStatements`, so neither pass can skip it; identity cases for two erroring heredoc forms                                             |
| A value import cycle through `parser.ts`                                                    | `parse-view.ts` and `heredoc-tails.ts` import `parser.ts` type-only; `pnpm fallow dead-code` runs in step 1 and step 5                                                    |
| A grammar upgrade changes the tail's shape                                                  | `tree-sitter-bash` is pinned `^0.25.1`; step 4's shape and oracle cases print real grammar trees and fail on any change, forcing a review at upgrade time                 |

## Open Questions

- Should `heredoc-tails.ts` and `redirect-arguments.ts` eventually fold into one `grammar-corrections/` directory with a single composition point?
  Only if a third correction appears; two passes composed in `parser.ts` read clearly today.

[#454]: https://github.com/gotgenes/pi-packages/issues/454
[#741]: https://github.com/gotgenes/pi-packages/issues/741
[#803]: https://github.com/gotgenes/pi-packages/issues/803
[#814]: https://github.com/gotgenes/pi-packages/issues/814
[#840]: https://github.com/gotgenes/pi-packages/issues/840
[#875]: https://github.com/gotgenes/pi-packages/issues/875
[#941]: https://github.com/gotgenes/pi-packages/issues/941
[#977]: https://github.com/gotgenes/pi-packages/issues/977
[#978]: https://github.com/gotgenes/pi-packages/issues/978
[#985]: https://github.com/gotgenes/pi-packages/issues/985
[#986]: https://github.com/gotgenes/pi-packages/issues/986
