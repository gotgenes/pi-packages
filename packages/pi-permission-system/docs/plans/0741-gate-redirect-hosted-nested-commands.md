---
issue: 741
issue_title: "pi-permission-system: commands inside redirect targets and heredoc bodies bypass the bash rules (residual #306 gap)"
---

# Gate nested commands hosted in redirect targets and heredoc bodies

## Release Recommendation

**Release:** ship independently

This issue is not a member of any numbered improvement phase, and `docs/architecture/architecture.md` carries no `Release:` tag referencing it.
It closes a permission bypass, so it ships on its own as a `fix:` release rather than batching behind unrelated work.

## Problem Statement

[#306] taught the bash command enumerator to descend into command substitution, process substitution, and subshells, so `echo $(rm -rf foo)` is denied by an `rm *` rule instead of riding the enclosing `echo` allow.
That descent reaches a substitution only when it sits inside the `command` node itself.

`nikaro` reported on [#306] that `echo "hello world" > $(rm *.txt)` still bypasses the gate when `echo *` is allowed.
The report is correct, and the gap is wider than the single case: tree-sitter-bash parses a redirect as a **sibling** of the command under a `redirected_statement`, so the entire redirect family is out of reach.

The same hole exists on the `path` and `external_directory` surfaces, where a redirect-hosted substitution's operands are never projected.

## Goals

- Enumerate commands hosted in a redirect target (`>`, `>>`, `2>`, `&>`, `<`) as their own `BashCommand` units, tagged with their existing execution context.
- Enumerate commands hosted in an **interpolating** heredoc body (`<<EOF`), and not in a quoted one (`<<'EOF'`, `<<"EOF"`).
- Project those nested commands' path operands onto the `path` and `external_directory` surfaces, closing the matching gap in the path projection.
- Preserve [#306]'s never-weaker invariant: the enclosing command is still emitted whole, so added units can only produce a more-restrictive decision.
- Name the "execution host" concept once, so the command surface and the path surface cannot drift on what counts as a nested execution context.

This change is **not** breaking.
It follows [#301] (`fix:`) and [#306] (`feat:`), where closing a gate bypass was treated as the gate doing its job rather than a behavior break.
The measurement in Background shows zero affected commands in real traffic, so no user needs to edit config on upgrade.

## Non-Goals

- **Including the redirect in the enclosing unit's matched text.**
  `npm install > out.txt` keeps emitting `npm install`, per the existing `commands()` test.
  Measured over the local review log, 1341 of 2950 unique bash commands (45%) carry a redirect, so folding the redirect into the matched text would stop an exact-match rule like `pnpm run test` from matching `pnpm run test > /tmp/out` — a prompt regression across nearly half of real traffic.
- **Descending into control-flow bodies and function definitions.**
  `if true; then rm y; fi` is still emitted as a single unit, exactly as [#306] deferred it.
  Filed as [#742].
- **Resolving the computed value of a substitution used as a filename.**
  `> $(cmd)` still contributes no path candidate for the file the substitution names; that remains an accepted residual under `docs/decisions/0009-bash-path-projection-completeness-contract.md`.
  Only the inner command's own literal operands are projected.
- **Re-parsing opaque wrapper payloads.**
  `bash -c "…"` and `eval` stay wrapper-floored to `ask` rather than re-parsed ([#481]).
- **Changing `BashCommandContext`.**
  A substitution in a redirect is still a `command_substitution`; the existing `describeBashCommandContext` labels are accurate and unchanged.

## Background

### The command-surface defect

`src/access-intent/bash/command-enumeration.ts` drives enumeration with two tables.
`COMMAND_ENUM_DESCEND` lists container nodes to walk through; `COMMAND_ENUM_SKIP` lists node types to abandon, and it currently holds `file_redirect`, `heredoc_redirect`, `herestring_redirect`, `comment`, `heredoc_body`, and `heredoc_end`.

That set conflates two different questions:

1. Is this node itself a command to emit?
2. Can this subtree host a command that really executes?

For a redirect the answers differ — no to the first, yes to the second — and collapsing them is the bug.
`collectSubstitutionCommands` searches only a `command` node's own subtree, so nothing recovers the skipped redirect.

The relevant tree shape, verified against the parser:

```text
program
  redirected_statement
    command                    "echo \"hello world\""
    file_redirect              "> $(rm *.txt)"
      command_substitution     "$(rm *.txt)"
        command                "rm *.txt"
```

A herestring (`cat <<< $(rm x)`) works today only because tree-sitter puts `herestring_redirect` **inside** the `command` node, where `collectSubstitutionCommands` reaches it without consulting `COMMAND_ENUM_SKIP`.
That is an accident of tree shape, not a decision, and the fix should make it deliberate.

### Measured current behavior

Resolved through a real `PermissionManager` with `bash: {"echo *": "allow", "cat *": "allow", "rm *": "deny"}`:

| Command                            | Decision                   | Correct?          |
| ---------------------------------- | -------------------------- | ----------------- |
| `echo $(rm f)`                     | `deny` (matched `rm *`)    | yes               |
| `cat <<< $(rm x)`                  | `deny` (matched `rm *`)    | yes, incidentally |
| `echo "hello world" > $(rm *.txt)` | `allow` (matched `echo *`) | no                |
| `echo hi >> $(rm b)`               | `allow` (matched `echo *`) | no                |
| `` echo hi 2> `rm d` ``            | `allow` (matched `echo *`) | no                |
| `echo hi &> $(rm q)`               | `allow` (matched `echo *`) | no                |
| `cat < <(rm c)`                    | `allow` (matched `cat *`)  | no                |
| `cat <<EOF` / `$(rm e)` / `EOF`    | `allow` (matched `cat *`)  | no                |

### The path-surface defect

`collectRedirectTokens` (`src/access-intent/bash/token-collection.ts`) collects only `ARG_NODE_TYPES` children of a `file_redirect`, so a `command_substitution` destination contributes nothing.
`heredoc_body` is dropped wholesale through `SKIP_SUBTREE_TYPES`.

Measured through `BashProgram.parse` with cwd `/projects/my-app`:

| Command                                    | `pathRuleCandidates()` | `externalPaths()` |
| ------------------------------------------ | ---------------------- | ----------------- |
| `diff <(cat /etc/shadow)`                  | `["/etc/shadow"]`      | `["/etc/shadow"]` |
| `echo $(cat /etc/shadow)`                  | `["/etc/shadow"]`      | `["/etc/shadow"]` |
| `cat <<< $(cat /etc/shadow)`               | `["/etc/shadow"]`      | `["/etc/shadow"]` |
| `echo hi > /etc/passwd`                    | `["/etc/passwd"]`      | `["/etc/passwd"]` |
| `echo hi > $(cat /etc/shadow)`             | `[]`                   | `[]`              |
| `cat < <(cat /etc/shadow)`                 | `[]`                   | `[]`              |
| `cat <<EOF` / `$(cat /etc/shadow)` / `EOF` | `[]`                   | `[]`              |

An argument-position substitution has its operands projected; the same substitution in a redirect does not.

### ADR 0009 triage

`docs/decisions/0009-bash-path-projection-completeness-contract.md` requires every "the gate missed my path" report to be triaged as **inside** the contract (a bug) or **outside** it (an accepted residual).

This one is inside.
The ADR's residual list covers a *computed* path — the value `$(cmd)` evaluates to — which is genuinely unknowable.
It does not cover the inner command's own literal operands, which the projection already guarantees in argument position.
This is the same shape as the `$HOME` half of [#694]: a guarantee met inconsistently across positions, not a boundary the ADR drew.

The ADR's "What the projection guarantees" section needs a clarifying sentence so the gap is not later re-read as sanctioned.

### Quoted heredocs are free

tree-sitter-bash already encodes the interpolation rule.
A bare `<<EOF` produces a `heredoc_body` containing a `command_substitution` node; `<<'EOF'` and `<<"EOF"` produce a `heredoc_body` of raw text with no such node.
No `heredoc_start` quote inspection is needed — descending `heredoc_body` for nested execution contexts is correct for both.

### Blast radius

Scanned over 2950 deduplicated `toolName: "bash"` commands from the local permission review log (`~/.pi/agent/extensions/pi-permission-system/logs/…-permission-review.jsonl`):

| Population                              | Count                                                     |
| --------------------------------------- | --------------------------------------------------------- |
| unique bash commands                    | 2950                                                      |
| containing any substitution             | 266                                                       |
| containing a redirect                   | 1341 (45%)                                                |
| substitution in a redirect target       | 0 (11 regex matches, all false positives on inspection)   |
| unquoted heredoc hosting a substitution | 0 (5 regex matches, all quoted `<<'EOF'` / `<< 'SCRIPT'`) |

This is pure hardening: it should produce no new prompts on realistic traffic.

### Constraints from AGENTS.md and the package skill

- The gate composes most-restrictive-wins across surfaces; adding units or path candidates can only tighten a decision.
- `src/` must not read `process.platform`; nothing in this change touches platform dispatch.
- The advisory service path (`parseBashCommandsSync` → `collectCommands`) shares the enumerator, so a single fix keeps `resolveBashAdvisoryCheck` at gate parity ([#309]) with no separate change.

## Design Overview

### Name the concept once

The knowledge that must not drift between the two surfaces is *which node types are nested execution contexts*.
Today that map lives only in `command-enumeration.ts`; the path surface has no equivalent because it recurses generically.
Once the path surface must skip a host's own text while still descending its executions, it needs the same vocabulary — so extract it.

New module `src/access-intent/bash/nested-execution.ts`:

```typescript
import type { TSNode } from "#src/access-intent/bash/parser";
import type { BashCommandContext } from "#src/types";

/** Node types whose interior commands really execute when the shell runs. */
export const NESTED_EXECUTION_CONTEXTS: ReadonlyMap<string, BashCommandContext>;

/**
 * Node types that are neither commands nor argument values themselves, but whose
 * subtree can host a nested execution context that really runs.
 */
export const EXECUTION_HOST_TYPES: ReadonlySet<string>;

/**
 * Visit each nested execution context in `node`'s subtree, without descending
 * past one — the visitor decides how to treat the interior.
 */
export function forEachNestedExecution(
  node: TSNode,
  visit: (contextNode: TSNode, context: BashCommandContext) => void,
): void;
```

`EXECUTION_HOST_TYPES` holds `file_redirect`, `heredoc_redirect`, `herestring_redirect`, and `heredoc_body`.

This is one traversal algorithm and one context set with two visitors, not a procedure split: each consumer supplies genuinely different behavior over the same walk, and the shared set is what makes a future context type (say, an arithmetic substitution) a one-line change on both surfaces instead of two divergent edits.

### Consumer sketch — command enumeration

```typescript
if (EXECUTION_HOST_TYPES.has(node.type)) {
  collectHostedCommands(node, out); // not a command itself; scan for executions
  return;
}
// …
function collectHostedCommands(node: TSNode, out: BashCommand[]): void {
  forEachNestedExecution(node, (contextNode, context) =>
    descendCommandChildren(contextNode, context, out),
  );
}
```

`COMMAND_ENUM_SKIP` shrinks to the genuinely inert types: `comment`, `heredoc_end`.

### Consumer sketch — path collection

```typescript
export function collectPathCandidateTokens(node: TSNode): string[] {
  if (node.type === "command") return collectCommandTokens(node);
  if (node.type === "file_redirect") return collectRedirectTokens(node);
  if (EXECUTION_HOST_TYPES.has(node.type)) return collectHostedPathTokens(node);
  if (SKIP_SUBTREE_TYPES.has(node.type)) return [];
  // …generic recursion unchanged
}
```

The `EXECUTION_HOST_TYPES` branch must sit **above** the `SKIP_SUBTREE_TYPES` check so `heredoc_body` is reached.
`collectHostedPathTokens` collects at nested-context nodes only, so `heredoc_content` text is still never treated as a path — the invariant `SKIP_SUBTREE_TYPES` exists to protect.

`collectRedirectTokens` keeps collecting `ARG_NODE_TYPES` children and additionally scans each child's subtree for nested executions.
Scanning the ARG children too is required: `echo hi > ${DIR}/$(rm z)` puts the substitution inside a `concatenation`, which *is* an ARG node.

### What each surface gains

| Input                             | Command units added                        | Path candidates added |
| --------------------------------- | ------------------------------------------ | --------------------- |
| `echo hi > $(rm x)`               | `rm x` (`command_substitution`)            | operands of `rm x`    |
| `cat < <(cat /etc/shadow)`        | `cat /etc/shadow` (`process_substitution`) | `/etc/shadow`         |
| `cat <<EOF` / `$(rm e)` / `EOF`   | `rm e` (`command_substitution`)            | operands of `rm e`    |
| `cat <<'EOF'` / `$(rm e)` / `EOF` | none                                       | none                  |
| `npm install > out.txt`           | none                                       | `out.txt` (unchanged) |

Newly-collected inner operands flow through the ordinary [#645] existence probe, so a bare inner token naming nothing (`rm nonexistent`) is dropped from the path surface while the command unit `rm nonexistent` is still enumerated.

## Module-Level Changes

### Added

- `src/access-intent/bash/nested-execution.ts` — `NESTED_EXECUTION_CONTEXTS`, `EXECUTION_HOST_TYPES`, `forEachNestedExecution`.
- `test/access-intent/bash/nested-execution.test.ts` — unit tests for the traversal and the two sets.

### Changed

- `src/access-intent/bash/command-enumeration.ts` — drop `NESTED_EXECUTION_CONTEXTS` (moved); shrink `COMMAND_ENUM_SKIP` to `comment` / `heredoc_end`; add the `EXECUTION_HOST_TYPES` branch in `collectCommandsInto`; rewrite `collectSubstitutionCommands` as `collectHostedCommands` over `forEachNestedExecution`.
- `src/access-intent/bash/token-collection.ts` — add the `EXECUTION_HOST_TYPES` branch to `collectPathCandidateTokens`; extend `collectRedirectTokens` to scan children's subtrees for nested executions; add the private `collectHostedPathTokens`.
- `src/access-intent/bash/node-text.ts` — doc-comment only: `SKIP_SUBTREE_TYPES` now means "text content is never argument material", with hosted executions handled ahead of it.

### Unchanged but verified

- `src/access-intent/bash/bash-path-resolver.ts` calls `collectRedirectTokens` directly at the pipeline first-stage fold ([#454]).
  Extending that function changes what the fold collects, so the `walkPipeline` / `foldPipelineFirstStage` tests are a required regression check, not incidental coverage.
- `src/access-intent/bash/sync-commands.ts` and `src/bash-advisory-check.ts` share `collectCommands`, so advisory parity ([#309]) follows without an edit.
- `src/handlers/gates/bash-command.ts` and `src/denial-messages.ts` need no change; the added units reuse existing `BashCommandContext` values.

### Tests touched

- `test/access-intent/bash/program.test.ts` — new cases under `commands`, `pathRuleCandidates`, and `externalPaths`.
- `test/access-intent/bash/token-collection.test.ts` — `collectRedirectTokens` and `collectPathCandidateTokens` cases; the existing heredoc-text exclusion test must stay green unmodified.
- `test/access-intent/bash/node-text.test.ts` — assertions on `SKIP_SUBTREE_TYPES` membership stay as-is.
- `test/handlers/gates/bash-command-metamorphic.test.ts` — new never-weaker property for redirect hosting.
- `test/bash-advisory-check.test.ts` — one parity case.

### Docs updated

- `docs/decisions/0009-bash-path-projection-completeness-contract.md` — clarify under "What the projection guarantees" that a nested execution context's own operands are projected regardless of hosting position, and add a Consequences bullet recording this triage.
- `docs/configuration.md` — line 328's nested-command paragraph must say the descent covers a substitution wherever it appears, including a redirect target and an interpolating heredoc body.
- `docs/architecture/architecture.md` — module-tree entries for `node-text.ts`, `token-collection.ts`, `command-enumeration.ts`, and `program.ts`, plus a new entry for `nested-execution.ts`.
- `.pi/skills/package-pi-permission-system/SKILL.md` — the bash-enforcement paragraph describing the enumerator gains the hosted-execution fact.
- `docs/cross-extension-api.md` — verify the nested-decomposition sentence still reads correctly; no change expected.

## Test Impact Analysis

1. **Newly enabled tests.**
   Extracting `forEachNestedExecution` makes the traversal unit-testable in isolation for the first time — previously it was a private function reachable only through a full `BashProgram.parse`.
   The new test file can pin host-type membership and the no-descend-past-a-context rule directly.
2. **Newly redundant tests.**
   None.
   The existing `commands()` substitution tests exercise argument-position hosting, which stays a distinct path through `collectCommandsInto`'s `command` branch.
3. **Tests that must stay as-is.**
   `token-collection.test.ts`'s "returns empty array for heredoc-only content (SKIP_SUBTREE_TYPES)" pins the invariant most at risk in this change and must not be relaxed.
   `program.test.ts`'s "captures the command of a redirected statement without the redirect" pins the 45%-of-traffic Non-Goal.
   The `bash-path-resolver` pipeline-fold tests pin [#454].

## Invariants at Risk

| Invariant                                                    | Source                         | Pinned by                                                      |
| ------------------------------------------------------------ | ------------------------------ | -------------------------------------------------------------- |
| Heredoc body text is never a path candidate                  | ADR 0009, `SKIP_SUBTREE_TYPES` | `token-collection.test.ts` heredoc-only test (existing)        |
| Redirected statement's unit text excludes the redirect       | [#306]                         | `program.test.ts` redirected-statement test (existing)         |
| Nested units never weaken a decision                         | [#306]                         | `bash-command-metamorphic.test.ts` (extended in step 6)        |
| Chain decomposition and fail-closed empty parse              | [#301], [#452]                 | `bash-command.test.ts` (existing, untouched)                   |
| Pipeline `cd` folding through a redirect-bearing first stage | [#454]                         | `program.test.ts` effective-working-directory tests (existing) |
| Bare inner tokens naming nothing are not promoted            | [#645], ADR 0009               | new case in step 4                                             |
| Advisory bash answers match the gate                         | [#309]                         | `bash-advisory-check.test.ts` (extended in step 6)             |

Two quantitative baselines measured at planning time, to be re-measured after implementation:

- Redirect-hosted substitutions in the review log: **0 of 2950**.
  The post-change count of newly-prompting real commands must also be 0.
- Commands carrying a redirect: **1341 of 2950 (45%)**.
  Their enumerated unit text must be byte-identical before and after, which the redirected-statement test pins for the representative shape.

## TDD Order

1. **`refactor(pi-permission-system): extract nested-execution traversal from the bash enumerator`** Move `NESTED_EXECUTION_CONTEXTS` and the substitution walk into `src/access-intent/bash/nested-execution.ts` as `forEachNestedExecution`; rewrite `collectSubstitutionCommands` to call it.
   Pure move, no behavior change — the whole suite stays green.
   Add `test/access-intent/bash/nested-execution.test.ts` covering the traversal and the context map.
   Tidy-first preparation: it gives step 4 a collaborator to reuse instead of duplicating the walk.
2. **`fix(pi-permission-system): gate commands hosted in bash redirect targets`** Red: `commands()` cases for `echo hi > $(rm x)`, `echo hi >> $(rm b)`, `` echo hi 2> `rm d` ``, `echo hi &> $(rm q)`, `cat < <(rm c)`, plus the preserved `npm install > out.txt` shape.
   Green: introduce `EXECUTION_HOST_TYPES` with `file_redirect` only, remove `file_redirect` from `COMMAND_ENUM_SKIP`, add the host branch.
3. **`fix(pi-permission-system): gate commands hosted in interpolating heredoc bodies`** Red: `cat <<EOF` / `$(rm e)` / `EOF` yields the `rm e` unit; `cat <<'EOF'` and `cat <<"EOF"` yield none; `cat <<< $(rm x)` keeps its existing units.
   Green: add `heredoc_redirect`, `herestring_redirect`, and `heredoc_body` to `EXECUTION_HOST_TYPES` and drop them from `COMMAND_ENUM_SKIP`.
4. **`fix(pi-permission-system): project path operands of redirect-hosted nested commands`** Red: `pathRuleCandidates()` / `externalPaths()` for `echo hi > $(cat /etc/shadow)`, `cat < <(cat /etc/shadow)`, `echo hi > ${DIR}/$(rm z)`; plus the negative case that `echo hi > $(rm nonexistent)` promotes no bare token.
   Green: extend `collectRedirectTokens` to scan children's subtrees via `forEachNestedExecution`.
   Run the full suite — this is the step that can disturb the [#454] pipeline fold.
5. **`fix(pi-permission-system): project path operands of heredoc-hosted nested commands`** Red: `cat <<EOF` / `$(cat /etc/shadow)` / `EOF` projects `/etc/shadow`; the quoted variant projects nothing; heredoc prose text still projects nothing.
   Green: add the `EXECUTION_HOST_TYPES` branch above the `SKIP_SUBTREE_TYPES` check in `collectPathCandidateTokens`.
6. **`test(pi-permission-system): pin gate and advisory parity for hosted nested commands`** End-to-end: the reported repro `echo "hello world" > $(rm *.txt)` denies under `echo *: allow` + `rm *: deny`.
   Extend the metamorphic property so wrapping a gated command as `echo hi > $(<cmd>)` never weakens its decision.
   Add one `bash-advisory-check` case confirming the advisory answer matches the gate.
7. **`docs(pi-permission-system): document hosted nested-command evaluation`**
   ADR 0009 clarification and Consequences bullet, `docs/configuration.md`, the architecture module-tree entries, and the package skill.

Steps 2 and 3 change the same table, so run `pnpm run check` and the full suite after each rather than batching.

## Risks and Mitigations

| Risk                                                                                              | Mitigation                                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Heredoc body text starts being read as path candidates                                            | `collectHostedPathTokens` collects only at nested-context nodes; the existing heredoc-only test stays unmodified as the guard                         |
| Extending `collectRedirectTokens` disturbs the [#454] pipeline `cd` fold, which calls it directly | Named as a required full-suite run at step 4; the fold tests are listed as an invariant                                                               |
| New prompts on everyday commands                                                                  | Measured at 0 of 2950 real commands; the 45% redirect population is untouched because the enclosing unit text is unchanged                            |
| The new shared module becomes a speculative abstraction                                           | Both consumers land within this plan (steps 1 and 4); no export is introduced before its first use, so `fallow dead-code` stays clean at every commit |
| Ordering dependence between the host branch and `SKIP_SUBTREE_TYPES`                              | Documented at the branch, and covered by a test that heredoc *text* is excluded while heredoc-hosted *executions* are included                        |

## Open Questions

- Whether `herestring_redirect` is ever reachable as a direct child of a descended container, or only ever inside a `command` node.
  Probing found only the latter, so its inclusion in `EXECUTION_HOST_TYPES` is defensive; step 3 should assert the herestring behavior either way.
- Whether a future arithmetic-expansion or `${ …; }` value-substitution context belongs in `NESTED_EXECUTION_CONTEXTS`.
  Deferred until a real report; the shared set makes it a one-line addition.
- Control-flow body descent ([#742]) is deferred, not declined; it is the last member of this bypass family.

[#301]: https://github.com/gotgenes/pi-packages/issues/301
[#306]: https://github.com/gotgenes/pi-packages/issues/306
[#309]: https://github.com/gotgenes/pi-packages/issues/309
[#452]: https://github.com/gotgenes/pi-packages/issues/452
[#454]: https://github.com/gotgenes/pi-packages/issues/454
[#481]: https://github.com/gotgenes/pi-packages/issues/481
[#645]: https://github.com/gotgenes/pi-packages/issues/645
[#694]: https://github.com/gotgenes/pi-packages/issues/694
[#742]: https://github.com/gotgenes/pi-packages/issues/742
