---
issue: 306
issue_title: "Evaluate commands inside command substitution and subshells against the permission rules"
---

# Evaluate nested bash commands (command substitution, process substitution, subshells)

## Problem Statement

Issue #301 made the bash command-pattern gate split a chain on its top-level operators (`&&`, `||`, `;`, `|`, `&`, newlines) and evaluate each simple-command independently with most-restrictive-wins.
It deliberately did **not** recurse into command substitution (`$(…)`, backticks), process substitution (`<(…)`/`>(…)`), or subshells (`( … )`).
As a result, a command nested inside one of those constructs is invisible to the gate: `echo $(rm -rf foo)` is enumerated as the single unit `echo $(rm -rf foo)`, whose command name is `echo`, so a `"rm *": "deny"` rule never fires even though the inner `rm -rf foo` really executes.

This issue closes that hole.
Commands inside those three constructs should be evaluated against the bash rules too, combined with the existing `deny > ask > allow` precedence, so a denied inner command blocks the whole invocation.

## Goals

- Descend into `command_substitution` (covers `$(…)` and backticks), `process_substitution` (`<(…)`/`>(…)`), and `subshell` (`( … )`) when enumerating bash command units, emitting each nested command as an additional `BashCommand` **in addition to** the enclosing command (the never-weaker invariant).
- Tag each nested command with its execution `context` (the extension point #308 reserved on `BashCommand`).
- Surface the execution context in the bash deny reason and the interactive ask prompt, so a denied nested command explains why (e.g. an `echo …` invocation was blocked because `rm -rf foo` matched `rm *` **inside command substitution**).
- Preserve every existing decision: more command units can only ever produce a more-restrictive result, never weaker.

## Non-Goals

- Per-command path candidates or effective-cwd projection for the external-directory / bash-path guards (#307).
  The execution-context tag added here is scoped to the **command-pattern** surface only; the path surfaces keep their current flat-path messages until #307 introduces per-command path provenance.
- Descending into control-flow bodies (`if` / `while` / `for` / `case`) or function definitions — a larger surface the issue explicitly defers.
  These statement nodes continue to be emitted whole without descent.
- Arithmetic expansion `$((…))`, parameter expansion `${…}`, `$var` — these do not execute commands and are correctly never descended.
- Command substitution nested inside heredoc bodies — heredoc bodies are skipped during command enumeration (a pre-existing best-effort limitation; see Risks).
- Unifying the synchronous advisory `checkPermission` / RPC path with the gate's decomposed fidelity (#309).
- Defeating obfuscation (`$(echo rm) -rf /`, `eval "$VAR"`, base64-decode pipelines).
  This remains a best-effort textual/glob heuristic, not a sandbox; the goal is to close the common, obvious hole.

## Background

The relevant modules (all under `packages/pi-permission-system/`):

- `src/handlers/gates/bash-program.ts` — the `BashProgram` value object.
  `BashProgram.parse()` walks the tree-sitter-bash AST once and exposes typed slices: `pathTokens()`, `externalPaths(cwd)`, and `commands(): BashCommand[]`.
  The command-pattern enumeration lives in `collectTopLevelCommandTexts(node)`, which descends container nodes (`program`, `list`, `pipeline`, `redirected_statement`), emits each `command` node's `text`, and emits any other statement node (subshell, compound statement, control-flow) **whole without descending**.
  `BashCommand` is currently a one-field type (`{ text }`), introduced by #308 precisely as the stable extension point this issue extends.
- `src/handlers/gates/bash-command.ts` — `resolveBashCommandCheck(command, units, agentName, sessionRules, checkPermission)`.
  A pure combiner: it runs `checkPermission("bash", { command: unit })` for each unit, selects the most restrictive via `pickMostRestrictive`, and falls back to the whole `command` when `units` is empty.
- `src/handlers/permission-gate-handler.ts` — parses the bash command once per `tool_call` and calls `resolveBashCommandCheck(command, bashProgram.commands().map((c) => c.text), …)`.
- `src/types.ts` — `PermissionCheckResult` (the result shape carrying `state`, `matchedPattern`, `command`, `source`, …).
- `src/denial-messages.ts` — `buildToolDenyBody` builds the bash deny reason from `check.command` + `check.matchedPattern`.
- `src/permission-prompts.ts` — `formatAskPrompt` builds the interactive ask prompt; its bash branch reads `result.command` + `result.matchedPattern`.

AST shapes (verified with a throwaway `web-tree-sitter` probe; consistent with the #308 retro):

- `command_substitution` wraps both `$(…)` and backticks; `process_substitution` wraps `<(…)`/`>(…)`.
  Both appear as descendants of a `command` node — usually a sibling of `command_name`, but when the **whole** command is a substitution (`$(a && b)` on its own) the `command_substitution` nests **under** `command_name`.
  So the descent must search the entire `command` subtree, not just its direct argument children.
- `subshell` wraps `( … )` and appears as a statement node (a direct child of `program`/`list`, or nested inside a substitution).
- Inside any of these, the body is a named `command` / `list` / `pipeline` node; the delimiter tokens (`$(`, `)`, `` ` ``, `(`, `<(`, `>(`) and chain operators (`&&`, `;`, `|`, …) are **anonymous** nodes (`node.isNamed === false`).

Constraints from `AGENTS.md` / package skill that apply:

- Default to least privilege; more units → more restrictive is the safe direction.
- Treat any declared field not read at runtime as a maintenance trap; `pnpm fallow dead-code` flags a constructed-but-unread interface field.
  This is why the `context` field is added **together with** its consumers in a single commit, not ahead of them.
- Keep schema, example config, loader, and docs aligned — but note this change adds **no** config field (it is a matching-engine change), so only prose docs change.
- `@typescript-eslint/require-await` is on for `src/`; the bash gates and `resolveBashCommandCheck` are already synchronous (#308) and stay so.

## Design Overview

### The execution-context model

Add a small union to `src/types.ts` and an optional field to `BashCommand`:

```typescript
// src/types.ts
export type BashCommandContext =
  | "command_substitution"
  | "process_substitution"
  | "subshell";

export interface PermissionCheckResult {
  // …existing fields…
  /** Execution context of the offending nested command, when the winning
   *  bash unit came from a substitution or subshell. Absent for current-shell
   *  (top-level) commands. */
  commandContext?: BashCommandContext;
}
```

```typescript
// src/handlers/gates/bash-program.ts
import type { BashCommandContext } from "#src/types";

export interface BashCommand {
  readonly text: string;
  /** Set for a nested command; absent for a current-shell (top-level) command. */
  readonly context?: BashCommandContext;
}
```

`context` is **optional** and **absent** for top-level commands.
This keeps the existing `commands()` assertions for top-level chains green (`toEqual` treats an absent property and `undefined` as equal), confining churn to the new nested cases.
The union deliberately has no `"top-level"` member: a current-shell command carries no context, so the result's `commandContext` stays `undefined` and existing whole-result assertions across the suite are unaffected.

`BashCommandContext` lives in `types.ts` (not the gate module) so `PermissionCheckResult` stays self-contained; the gate and the presentation modules import it from `#src/types`, the same direction they already depend.

### The enumeration descent

Replace `collectTopLevelCommandTexts(node): string[]` with a context-aware enumerator that produces `BashCommand[]` directly.
Two mutually-recursive helpers:

```text
collectCommands(node, context, out):
  if !node.isNamed: return                         // anonymous tokens: $( ) ` ( <( && ; | …
  if NAMED_NON_COMMAND.has(node.type): return      // file_redirect, heredoc_*, comment
  if node.type === "command":
    out.push({ text: node.text, ...(context && { context }) })
    collectSubstitutionCommands(node, context, out)  // descend args for $(…)/`…`/<(…)
    return
  if node.type === "subshell":
    out.push({ text: node.text, ...(context && { context }) })  // never-weaker whole emit
    for child of node: collectCommands(child, "subshell", out)  // descend interior
    return
  if DESCEND.has(node.type):                        // program, list, pipeline, redirected_statement
    for child of node: collectCommands(child, context, out)
    return
  // any other named statement (compound_statement {…}, if/while/for/case,
  // function_definition): emit whole, do NOT descend — deferred (#306 non-goal)
  out.push({ text: node.text, ...(context && { context }) })

collectSubstitutionCommands(node, context, out):
  for child of node:
    if child.type === "command_substitution":
      for inner of child: collectCommands(inner, "command_substitution", out)
    else if child.type === "process_substitution":
      for inner of child: collectCommands(inner, "process_substitution", out)
    else:
      collectSubstitutionCommands(child, context, out)  // keep searching the subtree
```

Key points:

- Using `node.isNamed` to skip anonymous nodes is what makes the descent robust: it auto-skips every delimiter and operator token (`$(`, `)`, `` ` ``, `(`, `&&`, `;`, `|`, …) without enumerating fragile token-type strings.
  This requires adding `readonly isNamed: boolean` to the local `TSNode` interface (web-tree-sitter exposes it as a boolean property — verified).
- The top-level whole-emit of a `subshell` is preserved (existing #301 behavior), then its interior is additionally enumerated — strictly additive, never weaker.
- `command_substitution` / `process_substitution` interiors are reached **only** through `collectSubstitutionCommands` (called from the `command` case), so each interior is enumerated exactly once — no double emit.
- Recursion handles nesting (`echo $( ( rm x ) )`) naturally: each level re-enters `collectCommands` with the inner context.

### Resolver: attach the winning context

`resolveBashCommandCheck` changes its second parameter from `units: string[]` to `commands: BashCommand[]` (it now needs both `text` and `context`, so it takes the object — ISP-clean, the type carries exactly the two fields it reads):

```typescript
export function resolveBashCommandCheck(
  command: string,
  commands: BashCommand[],
  agentName: string | undefined,
  sessionRules: Rule[],
  checkPermission: CheckPermissionFn,
): PermissionCheckResult {
  const results = commands.map((cmd) => {
    const result = checkPermission("bash", { command: cmd.text }, agentName, sessionRules);
    return cmd.context ? { ...result, commandContext: cmd.context } : result;
  });
  return (
    pickMostRestrictive(results) ??
    checkPermission("bash", { command }, agentName, sessionRules)
  );
}
```

The winner naturally carries its own context because the context is attached before selection.
The handler drops the `.map((c) => c.text)` and passes `bashProgram.commands()` directly.

Consumer call site (handler, ~3 lines — confirms Tell-Don't-Ask: the handler hands the whole `BashCommand[]` to the resolver and asks nothing about individual commands):

```typescript
const toolCheck =
  tcc.toolName === "bash" && bashProgram
    ? resolveBashCommandCheck(command ?? "", bashProgram.commands(), tcc.agentName ?? undefined, getSessionRuleset(), checkPermission)
    : checkPermission(tcc.toolName, tcc.input, tcc.agentName ?? undefined, getSessionRuleset());
```

### Message surfacing

Add a presentation helper in `src/denial-messages.ts`, exported for reuse:

```typescript
export function describeBashCommandContext(context?: BashCommandContext): string | undefined {
  switch (context) {
    case "command_substitution": return "command substitution";
    case "process_substitution": return "process substitution";
    case "subshell": return "subshell";
    default: return undefined;
  }
}

// Fold matched-pattern and context into one parenthetical.
export function matchQualifier(matchedPattern?: string, context?: BashCommandContext): string {
  const parts: string[] = [];
  if (matchedPattern) parts.push(`matched '${matchedPattern}'`);
  const label = describeBashCommandContext(context);
  if (label) parts.push(`inside ${label}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}
```

Use it in two places (the user's chosen scope — deny reason + ask prompt):

- `buildToolDenyBody` (`denial-messages.ts`) — replace the standalone `(matched 'P')` part with `matchQualifier(check.matchedPattern, check.commandContext)`.
  `commandContext` is only ever set for bash, so MCP/tool denials are unaffected (the helper returns the same `(matched 'P')` they produce today).
- `formatAskPrompt` bash branch (`permission-prompts.ts`) — replace the local `patternInfo` with `matchQualifier(result.matchedPattern, result.commandContext)`.

Resulting messages:

```text
[pi-permission-system] Current agent is not permitted to run 'bash' command 'rm -rf foo' (matched 'rm *', inside command substitution).
Current agent requested bash command 'rm -rf foo' (matched 'rm *', inside command substitution). Allow this command?
```

The `user-denied` and `unavailable` bash bodies are deliberately left unchanged — they describe the user's own action / a no-UI condition, where "why it matched" adds little; the high-value surfaces are the policy-deny reason and the interactive ask prompt.

### Edge cases

| Input                     | Enumerated units (text → context)                                              | Decision with `rm *: deny`, `echo *: allow` |
| ------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------- |
| `echo $(rm -rf foo)`      | `echo $(rm -rf foo)` → —, `rm -rf foo` → command_substitution                  | deny                                        |
| `` echo `rm x` ``         | `` echo `rm x` `` → —, `rm x` → command_substitution                           | deny                                        |
| `diff <(cat /etc/shadow)` | `diff <(cat /etc/shadow)` → —, `cat /etc/shadow` → process_substitution        | (per `cat`/`diff` rules)                    |
| `( rm -rf foo )`          | `( rm -rf foo )` → —, `rm -rf foo` → subshell                                  | deny                                        |
| `( cd /t && rm x )`       | `( cd /t && rm x )` → —, `cd /t` → subshell, `rm x` → subshell                 | deny                                        |
| `echo $( ( rm x ) )`      | `echo $( ( rm x ) )` → —, `( rm x )` → command_substitution, `rm x` → subshell | deny                                        |
| `echo $(echo safe)`       | `echo $(echo safe)` → —, `echo safe` → command_substitution                    | allow (never-weaker holds)                  |

## Module-Level Changes

- `src/types.ts` — add `export type BashCommandContext`; add optional `commandContext?: BashCommandContext` to `PermissionCheckResult`.
- `src/handlers/gates/bash-program.ts`:
  - Add `readonly isNamed: boolean` to the local `TSNode` interface.
  - Import `BashCommandContext` from `#src/types`; add optional `context?` to `BashCommand`.
  - Replace `collectTopLevelCommandTexts(node): string[]` with `collectCommands(node, context, out)` + `collectSubstitutionCommands(node, context, out)` producing `BashCommand[]`.
  - Change the stored field from `topLevelCommandTexts: readonly string[]` to `commands: readonly BashCommand[]`; `parse()` builds it via the new enumerator; `commands()` returns it directly (keeps its existing `// fallow-ignore-next-line unused-class-member` suppression — still called on an inferred-type value in the handler).
  - The `NAMED_NON_COMMAND` skip set replaces the prior `TOP_LEVEL_COMMAND_SKIP` (now only the named non-command nodes; anonymous tokens fall out via `!isNamed`); `DESCEND` keeps `program`/`list`/`pipeline`/`redirected_statement`.
- `src/handlers/gates/bash-command.ts` — `resolveBashCommandCheck` second param `units: string[]` → `commands: BashCommand[]`; attach `commandContext` to each per-unit result before selection; import `BashCommand`.
- `src/handlers/permission-gate-handler.ts` — pass `bashProgram.commands()` (drop `.map((c) => c.text)`).
- `src/denial-messages.ts` — add `describeBashCommandContext` + `matchQualifier`; use `matchQualifier` in `buildToolDenyBody`; import `BashCommandContext`.
- `src/permission-prompts.ts` — bash branch of `formatAskPrompt` uses `matchQualifier`; import the helper from `#src/denial-messages` (one-way import, no cycle).
- `docs/configuration.md` — rewrite the "matched as part of their enclosing command rather than evaluated independently" sentence (line ~194) to state that nested commands in substitutions/subshells **are** now evaluated; soften the line ~380 "subshells … are not parsed" caveat to note subshells/substitutions are parsed for the command-pattern surface (path/cwd resolution into them remains future work, #307).
- `docs/architecture/architecture.md` — update the `bash-program.ts` slice description (line ~512) to mention the nested-context descent and the `context` field, and the `bash-command.ts` description (line ~514) to note the context-tagged result.

No schema, example config, or loader changes: this is a matching-engine change with no new config field.
The package skill (`.pi/skills/package-pi-permission-system/SKILL.md`) does not reference `BashCommand` / the enumerator, so no skill update is needed.

## Test Impact Analysis

1. New unit tests the descent enables (previously impossible — the gate could not see nested commands):
   - `bash-program.test.ts` — `commands()` now returns nested entries for `$(…)`, backticks, `<(…)`, `( … )`, chains inside subshells, and nested-in-nested, each tagged with `context`.
   - `bash-command.test.ts` — the winning result carries `commandContext` when a nested unit is the offender.
   - End-to-end deny in `tool-call.test.ts` for `echo $(rm -rf foo)`.
2. Existing tests that change (behavior shifts from "whole-emit only" to "whole-emit + descend"):
   - `bash-program.test.ts` — two assertions update: `emits a subshell whole without descending into it` and `keeps command substitution inside the enclosing command` now also list the nested entries (the whole-emit stays as the first element, so the assertions are extended, not replaced).
   - `bash-command.test.ts` — every `units: string[]` argument becomes `BashCommand[]` (e.g. `["cd /p", "npm install pkg"]` → `[{ text: "cd /p" }, { text: "npm install pkg" }]`); the empty-fallback case becomes `[]`.
3. Existing tests that stay as-is (genuinely exercise unchanged layers):
   - `bash-program.test.ts` `pathTokens` / `externalPaths` blocks — the path slices are untouched (#307 territory); they already walk into nested contexts for path candidates.
   - `bash-external-directory.test.ts` (~1000-line characterization suite via the `extractTokensForPathRules` / `extractExternalPathsFromBashCommand` facades) — untouched.
   - Top-level-chain `commands()` assertions — unaffected because top-level commands carry no `context` (absent property equals `undefined` under `toEqual`).
   - Non-bash branches of `denial-messages.test.ts` / `permission-prompts.test.ts` — `matchQualifier` returns the identical `(matched 'P')` string for context-free results.

## TDD Order

1. red→green→commit — **enumeration descent (the security fix), no context field yet.**
   - Surface: `bash-program.test.ts` (`commands()`) + `tool-call.test.ts` (end-to-end).
   - Add the `isNamed` field to `TSNode`; implement `collectCommands` / `collectSubstitutionCommands` emitting plain `{ text }` entries (no `context` member yet — keeping `BashCommand` one-field avoids a fallow-flagged unread field in this commit).
   - Tests: nested `$(…)`, backticks, `<(…)`, bare subshell, chain-in-subshell, nested-in-nested all enumerate the inner commands; update the two changed subshell/substitution assertions; never-weaker case (`echo $(echo safe)` stays allow); add the headline `tool-call.test.ts` case mirroring the existing `echo start && npm …` deny test (`echo $(rm -rf foo)` with `rm *: deny` → `block: true`).
   - Run `pnpm run check` (the `commands()` return shape is unchanged — still `BashCommand[]` — so the handler's `.map((c) => c.text)` still compiles).
   - Commit: `feat: evaluate nested bash command substitutions and subshells (#306)`.
2. red→green→commit — **execution-context tag + message surfacing (added with its consumers in one commit).**
   - Surface: `bash-program.test.ts`, `bash-command.test.ts`, `denial-messages.test.ts`, `permission-prompts.test.ts`.
   - Add `BashCommandContext` + `PermissionCheckResult.commandContext` (`types.ts`); add `BashCommand.context` and tag nested emits in the enumerator; change `resolveBashCommandCheck` to accept `BashCommand[]` and attach `commandContext`; update the handler call site (single call site — folded in, the type checker requires it); add `describeBashCommandContext` / `matchQualifier` and wire them into `buildToolDenyBody` + `formatAskPrompt`.
   - This is the cohesive "field + consumer together" commit: the field is read (resolver → result → both message builders) in the same commit it is introduced, so `pnpm fallow dead-code` stays clean.
   - Tests: `commands()` tags nested entries with `context`; `resolveBashCommandCheck` returns `commandContext` for a nested-deny winner and omits it for a top-level winner; deny reason and ask prompt include `inside command substitution` / `inside subshell`; non-bash deny/ask strings unchanged; migrate `bash-command.test.ts` `units` arrays to `BashCommand[]`.
   - Run `pnpm run check` + the full suite (shared `PermissionCheckResult` + shared resolver touched).
   - Commit: `feat: surface nested execution context in bash deny and ask messages (#306)`.
3. green→commit — **documentation.**
   - Update `docs/configuration.md` (nested commands are now evaluated; soften the subshell caveat) and `docs/architecture/architecture.md` (bash-program / bash-command slice descriptions).
   - Commit: `docs: document nested bash command evaluation (#306)`.

## Risks and Mitigations

- Risk: the descent regresses an existing decision.
  Mitigation: the change is strictly additive (whole-emit preserved, nested units added) and `pickMostRestrictive` can only move a decision toward more-restrictive; the full suite (incl. `tool-call.test.ts` and the manager harness) runs in step 2, and the never-weaker case is asserted in step 1.
- Risk: anonymous delimiter tokens (`$(`, `)`, `(`) get emitted as spurious command units.
  Mitigation: the `!node.isNamed` guard skips every anonymous token; verified against the actual AST with a `web-tree-sitter` probe.
- Risk: adding `context` / `commandContext` ahead of a reader trips `pnpm fallow dead-code`.
  Mitigation: the field and all its readers land in the same commit (step 2); step 1 keeps `BashCommand` one-field.
- Risk: `matchQualifier` accidentally changes MCP/tool/path messages.
  Mitigation: `commandContext` is only ever set for bash; the helper returns the byte-identical `(matched 'P')` string for context-free results, asserted by the unchanged non-bash message tests.
- Risk: obfuscation and heredoc-embedded substitutions still evade matching.
  Mitigation: out of scope by design — documented as a known best-effort caveat in `configuration.md`, consistent with the issue's framing.

## Open Questions

- Should the `user-denied` and `unavailable` bash bodies also carry the context label for full consistency?
  Deferred: scoped out per the chosen "deny reason + ask prompt" surface; trivial to add later if the asymmetry proves confusing.
- Should command substitution inside an unquoted heredoc body be evaluated?
  Deferred: heredoc bodies are skipped during enumeration today; revisit only if a concrete bypass is reported (best-effort heuristic).
