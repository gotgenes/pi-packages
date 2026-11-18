---
issue: 1095
issue_title: "A prompt over a chained command names only one part of the chain, so the session grant can approve the wrong command"
---

# A chain's prompt names every asking unit, and its session grant covers each

## Release Recommendation

**Release:** ship independently

This issue is not a step in any improvement roadmap: `docs/architecture/architecture.md` names neither it nor its siblings, and the package has no open phase.
It ships on its own.

## Problem Statement

When a bash chain has several units that each resolve `ask`, the gate raises one prompt.
`pickMostRestrictive` breaks the tie toward the first unit, so the prompt's value, its `rule` line, and its "for this session" option all describe that one unit.
For `cd sub && npm test` under `bash: {"*": "ask"}`, the user reads `command : cd sub` and is offered `Yes, allow bash "cd *" for this session`.
Taking it grants every `cd` for the rest of the session and still leaves `npm test` asking the next time the same line runs.
The rest of the line appears only as the `full command` evidence entry, which the row budget may elide.

The information to do better is already on the check: `withAskingUnits` (`src/handlers/gates/bash-command.ts`) lists every unit the gate left asking on `check.askingUnits`, but only the forwarding path reads it ([#1030]).

Separately, `cd` has no entry in the arity table, so a `cd <dir>` unit always suggests the catch-all `cd *`.

## Goals

- A chain's prompt names every unit still asking, as a core request fact that no render budget may drop (ADR 0011 §3).
- The "for this session" option records one suggested `bash` pattern per asking unit, deduplicated, and its label lists them; re-running the same chain is then silent.
- A forwarded chain ask's whole-session scope label lists the patterns instead of reading "N paths".
- `cd <dir>` suggests `cd <dir>*` instead of `cd *`.
- An ask with a single asking unit is unchanged: same value, same grant, same label.
- Not breaking.
  No default or config changes; the session option grants exactly the patterns its label shows, and the new request fact is an optional, additive field on the `permissions:ui_prompt` bus and the forwarding wire.

## Non-Goals

- **One prompt per asking unit** (PR [#1097]'s design).
  Declined at the planning gate: it raises N dialogs and N forwarded requests per tool call, reverses [#1030]'s "one answer covers the whole call", and leaves a recorded grant behind when a later prompt is declined.
- **A partial authorizer verdict** (the issue's `allow_units`, an ADR 0007 change).
  That is [#1101]'s carrier: a link that accepts part of a chain still cannot narrow what the prompt asks about.
  This change makes the dialog name every asking unit, which is necessary for [#1101] but does not close it.
- **The winner and `pickMostRestrictive`'s tie rule.**
  `request.value`, the `rule` line, `executedUnit`, `commandContext`, the decision event's `value`, and the review log's `command` column keep naming the winner; `src/policy/restrictiveness.ts` and `src/handlers/gates/bash-command.ts` do not change.
- **Pattern breadth beyond `cd`**: [#1063], [#1065], and deny-aware suggestions ([#1120]) stay their own issues.
- **A chain unit floored as `<unparsed-bash-subtree>`.**
  Its `command` is the whole line (`floorUnparsedUnit`), so its suggested pattern derives from the whole line, exactly as a lone floored ask's does today.
- **`cd` into the working directory** ([#1074]) and the effective directory after `cd ~` ([#1083]).
- **The agent-facing refusal text**: it omits a bash ask's flagged element by design (ADR 0011 §7), so `agent-renderer.ts` does not change.

## Background

- `resolveBashCommandCheck` resolves each unit, picks the winner, and decorates it with `withChainFloor` and `withAskingUnits`.
  `askingUnits` is `AskingBashUnit[]` (`{ command, spellings?, floor? }`) in chain order, and is set whenever the winner asks, even with one entry.
  A session-granted or rule-allowed unit is never in it ([#1033]).
- `describeToolGate` (`src/handlers/gates/tool.ts`) builds the session option: `pathSessionOption` for a path-bearing tool (`SessionApproval.forPatterns` + one label), `valueSessionOption` otherwise (`SessionApproval.single`).
  `GateRunner` records `descriptor.sessionApproval.atWidth(width)`; `widenGrant` touches only path-family grants, so a multi-pattern bash approval records as built.
- `pattern-suggest.ts` already has a multi-pattern suggestion shape, `PathSessionSuggestion` (`{ surface, patterns, label }`), and a quoted-join label precedent in `suggestPathSessionPattern` (`targets.join('", "')`).
  `describeGrantTarget` names several targets as `N paths`, which `buildForwardedScopeLabels` uses for a forwarded ask's whole-session option; a forwarded bash ask reaches the serving node with no `sessionLabel` of its own, so that scope label is what names the grant there.
- `PromptRequestFacts` (`src/presentation/prompt-payload.ts`) is the invariant core: rendered in every view, exempt from the dialog's row budget, persisted by `renderReviewLogFacts`, carried on the forwarding wire through the tolerant `asPromptRequestFacts`, and published verbatim on `permissions:ui_prompt` (`docs/cross-extension-api.md` tables every field).
- `flaggedElements` (`src/presentation/fact-vocabulary.ts`) picks what the dialog highlights in the `full command` evidence; the agent renderer skips it for bash.
- `maskCommandFields` masks every value under a key in `COMMAND_BEARING_LOG_KEYS`, recursing through arrays.
- The package skill: `docs/cross-extension-api.md` gets a row for a new `PromptRequestFacts` field in the same change, and a new term of art earns a `docs/glossary.md` entry.

### Reproduction

A disposable spike (measured, then deleted) ran the reporter's config and commands verbatim through the real `ToolCallGatePipeline` → `GateRunner`, a real `PermissionResolver` over `createInMemoryManager`, a real `SessionRules`, and the real tree-sitter parse, with a stubbed escalator answering `approved_for_session`.
Every row below was measured on current `main`, on our side of the extension (no Pi host), n = 1 per row; the path is deterministic.

| config                               | command                                                  | prompt value | session option         | other asking units                   | then                                                    |
| ------------------------------------ | -------------------------------------------------------- | ------------ | ---------------------- | ------------------------------------ | ------------------------------------------------------- |
| `bash: {"*": "ask"}`                 | `cd sub && npm test`                                     | `cd sub`     | `cd *`                 | `npm test` (on `askingUnits` only)   | session holds `bash:cd *`                               |
| same                                 | `cd /etc`                                                | `cd /etc`    | `/etc`, `/etc/*`       | —                                    | asked on `external_directory_read`, not `bash`          |
| same                                 | `npm test`                                               | `npm test`   | `npm test*`            | —                                    | asked again                                             |
| `{"*": "allow", bash: {"*": "ask"}}` | `cd /etc`                                                | —            | —                      | —                                    | silent: the `cd *` grant plus the external-dir allow    |
| same                                 | `cd /opt/homebrew && echo a; cd opt/abseil/.. && echo b` | `echo a`     | `echo *`               | `echo b`                             | the reporter's second log shape                         |

The control is the `cd /etc` row under the reporter's minimal config: the bash `cd *` grant does not reach the external-directory gate, so the breadth of `cd *` is bounded by the path surfaces, and the reporter's step 5 needs an external-directory allow as well.

## Design Overview

Decided at the planning gate (third-party issue; the operator chose all three):

1. One prompt per chain, naming every asking unit, with one session grant per asking unit.
2. The other asking units are a new **core request fact**, not evidence.
3. `cd` gets arity 2.

### The request fact

```typescript
export interface PromptRequestFacts {
  // ...existing fields unchanged
  /**
   * For a bash chain, every other unit the gate left asking, in chain order —
   * the commands the session option also grants. Absent when `value` is the
   * only one, so every other ask keeps its exact shape.
   */
  readonly otherAskingUnits?: readonly string[];
}
```

Optional and absent-when-empty, unlike the `| null` fields beside it.
This follows `tool.ts`'s `floorFact`/`askingUnitsFact` ("absent … so every other ask's facts keep their exact shape"), and the assessor confirmed no exact-equality assertion on a payload request breaks (the request assertions in `permission-ui-prompt.test.ts`, `forwarding-io.test.ts`, and `forwarded-request-server.test.ts` are `toEqual`, which ignores an absent key).
A required field would instead touch every hand-built request literal and every builder for a value only bash chains have.

`buildToolAskPayload` derives it from the check: for a bash check, `askingUnits` minus the **first** entry whose `command` equals `check.command`, set with a conditional spread only when non-empty.
Removing the first match only is what keeps a repeated unit (`echo a; echo a`, both asking) listed once as "also asks".

`asPromptRequestFacts` copies the field when it is an array of strings, leaves it absent when absent (an older child's request), and rejects the whole request when it is present and malformed, per its all-or-nothing contract.

Renders:

- **Dialog** (`coreFacts`): one `also asks : <command>` line per entry, directly after the value line, so it is core and never dropped by the row budget (only width-capped).
- **Highlight** (`flaggedElements`): a `bash` payload flags `value` plus every `otherAskingUnits` entry, so each is highlighted in the `full command` line.
- **Review log** (`renderReviewLogFacts`): `otherAskingUnits` when present, and the key joins `COMMAND_BEARING_LOG_KEYS` so an assignment secret inside one is masked like `command`.
  The masking lands in the same commit as the first writer.
- **Bus**: carried as part of `request`, unmasked like `value`; `docs/cross-extension-api.md` gains its row in the same commit.

### The session option

`pattern-suggest.ts` gains the chain suggestion:

```typescript
/** Every pattern to record and one label naming them. */
export interface SessionPatternsSuggestion {
  surface: string;
  patterns: readonly string[];
  label: string;
}

export function suggestBashChainSessionPatterns(
  commands: readonly string[],
): SessionPatternsSuggestion {
  const patterns = [
    ...new Set(commands.map(suggestBashPattern).filter((p) => p !== "")),
  ];
  return {
    surface: "bash",
    patterns,
    label: buildLabel(patterns.join('", "'), "bash"),
  };
}
```

Deduplication runs before the label is built, so a chain whose units all suggest one pattern (`echo a; echo b` → `echo *`) records one grant under today's exact label.
It does not go through `grantTargets`, whose folding of `X` into `X/*` is path semantics.

`valueSessionOption` in `tool.ts` gains the branch; the consumer reads:

```typescript
const commands = check.askingUnits?.map((unit) => unit.command) ?? [];
if (gateSurface === "bash" && commands.length > 1) {
  return optionFromPatterns(suggestBashChainSessionPatterns(commands));
}
// unchanged single-pattern path
```

`optionFromPatterns` is the conversion `pathSessionOption` already does (`SessionApproval.forPatterns` + label), extracted first.
The branch keys on the gate surface, so an aliased shell tool (`exec_command`) behaves as native `bash`.
The branch lives in `valueSessionOption`, not `suggestValueSessionPattern`, whose return type is the single-pattern `SessionApprovalSuggestion`.

`describeGrantTarget` names several targets by count only when every grant is on a path family (`surfaceFamilyMembers(surfaceFamilyOf(surface)) !== null`); otherwise it lists each distinct pattern quoted and comma-joined.
So a forwarded chain ask's whole-session option reads `The whole session — allow bash "cd sub*", "npm test*" for parent and all subagents`.
`buildDirectionalSessionLabels` also calls `describeGrantTarget`, but only for grants that prove a direction, which a bash grant never does.

### `cd`

`ARITY` gains `cd: 2` (a new `// Shell builtins` group).
`suggestBashPattern("cd sub")` then covers every token, so it returns `cd sub*`, the same trailing-wildcard convention as `npm run build*`: it also matches `cd subdir` and `cd sub/..`.
That remains narrower than `cd *`, and where a `cd` goes is still gated by the `path` and `external_directory` surfaces (Reproduction, control row).
Bare `cd` stays the exact `cd`.

### Edge cases and the steps that test them

| Case                                                                  | Behavior                                                    | Step |
| --------------------------------------------------------------------- | ----------------------------------------------------------- | ---- |
| One asking unit                                                       | no `otherAskingUnits`; `SessionApproval.single`, same label | 3, 6 |
| Two units suggesting one pattern                                      | one grant, today's label                                    | 4, 6 |
| A unit whose suggestion is empty (comment-only)                       | dropped from the patterns                                   | 4    |
| Repeated unit text (`echo a; echo a`)                                 | `otherAskingUnits: ["echo a"]`                              | 3    |
| Aliased shell tool                                                    | chain grant applies                                         | 6    |
| Malformed `otherAskingUnits` on the wire                              | request rejected (`undefined`)                              | 3    |
| Absent `otherAskingUnits` from an older child                         | request accepted, field absent                              | 3    |
| Forwarded chain, whole-session scope                                  | label lists the patterns                                    | 5, 6 |
| A unit already session-granted or rule-allowed                        | not in `askingUnits`, not re-granted                        | 6    |
| Tight row budget                                                      | every `also asks` line still rendered                       | 7    |
| A secret assignment in another asking unit                            | masked in the review log                                    | 3    |

## Module-Level Changes

- `src/presentation/pattern-suggest.ts`
  - Rename `PathSessionSuggestion` to `SessionPatternsSuggestion` and reword its doc ("every pattern to record, one label"); no other file names it.
  - Add `suggestBashChainSessionPatterns`.
  - `describeGrantTarget`: count only path-family grants; list quoted patterns otherwise; update its doc ("only the external-directory gate aggregates…" is no longer true).
- `src/handlers/gates/tool.ts`: extract `optionFromPatterns` from `pathSessionOption`; add the chain branch to `valueSessionOption`.
- `src/access-intent/bash/bash-arity.ts`: `cd: 2`.
- `src/presentation/prompt-payload.ts`: `otherAskingUnits?` on `PromptRequestFacts`; `asPromptRequestFacts` reads it.
- `src/presentation/tool-ask-payload.ts`: `buildToolAskPayload` sets it.
- `src/presentation/fact-vocabulary.ts`: `flaggedElements` adds it for a bash payload.
- `src/presentation/dialog-renderer.ts`: `coreFacts` renders `also asks` lines.
- `src/presentation/review-log-renderer.ts`: persists it.
- `src/logging/command-redaction.ts`: `otherAskingUnits` in `COMMAND_BEARING_LOG_KEYS`.
- Docs:
  - `docs/cross-extension-api.md`: a `PromptRequestFacts` row for `otherAskingUnits`, with the absent-means-none note beside the `decidingPath` one (step 3).
  - `docs/session-approvals.md`: a `### Chained commands` subsection under `## Suggested Patterns`, and a `cd sub` → `cd` → 2 → `cd sub*` row in the arity table (the arity row lands in step 1).
  - `docs/glossary.md`: an `### Asking unit` entry under `## Checking`.
  - `docs/decisions/0011-prompt-presentation-contract.md`: a dated amendment under §3 point 4: for a bash chain, the decision-relevant value is every asking unit, and the units beyond `value` are core.
  - `docs/architecture/architecture.md`: the `pattern-suggest.ts`, `tool.ts`, `prompt-payload.ts`, `tool-ask-payload.ts`, `dialog-renderer.ts`, `review-log-renderer.ts`, and `command-redaction.ts` module-tree entries; the `### Pattern suggestions` table (a chain row) and the `## Prompt presentation` paragraph listing the `request` facts.
- Predicted unchanged:
  - `src/handlers/gates/bash-command.ts`, `src/policy/restrictiveness.ts`, `src/policy/serving-policy.ts`: `askingUnits` is already produced and already judged at the serving node.
  - `src/handlers/gates/runner.ts`: records whatever `SessionApproval` the descriptor carries.
  - `src/authority/local-user-authorizer.ts`: calls `describeGrantTarget` and `buildForwardedScopeLabels`, whose output changes but not their signatures.
  - `src/presentation/agent-renderer.ts`: skips the flagged clause for bash.
  - `src/service/permission-events.ts`: nests `PromptRequestFacts` by type, so the field arrives without an edit.
  - `README.md`: grepped for `chain`; its hits are the authorizer chain, with no prose on session suggestions for chained commands.
  - `.pi/skills/package-pi-permission-system/SKILL.md`: names no session-suggestion or request-fact mechanism this changes.
  - `packages/pi-permission-model-judge`: reads `PromptPermissionDetails`, and an optional request field adds nothing it must handle.

## Test Impact Analysis

1. New tests: an end-to-end chain test over the real parse, resolver, `SessionRules`, and runner (the spike's stack) becomes the integration pin in a new file `test/handlers/gates/bash-chain-session-approval.test.ts`.
   It cannot live in `tool-call-gate-pipeline.test.ts`, which `vi.mock`s the bash program and `node:fs`.
2. Redundant tests: none.
3. Kept as is: `tool.test.ts`'s `carries a bash chain's asking units on promptDetails` (the forwarded fact), and `composition-root.test.ts`'s forwarded chain test (one request carrying both units, the [#1030] contract).

## Invariants at risk

- **[#1033]: a session grant approves only the unit it names.**
  Each recorded pattern is suggested from one asking unit, and a session-granted unit never re-enters `askingUnits`.
  Pinned by `bash-command.test.ts`'s chain session tests (unchanged), and step 6's integration test re-runs `cd /etc` under `{"*": "allow", bash: {"*": "ask"}}` after the chain grant and asserts it still asks on `bash`.
- **[#1030]: a forwarded ask carries every asking unit and is answered once.**
  Pinned by `composition-root.test.ts` (`askingUnits` `toStrictEqual` on the one forwarded request), which this change does not touch.
- **ADR 0011 §3: the core is never dropped.**
  Step 7 renders a three-unit chain under a minimal `promptMaxRows` and asserts every `also asks` line survives.
- **A single-unit ask is byte-identical.**
  Steps 3 and 6 assert the full request and the full `sessionApproval` for a one-unit ask with `toStrictEqual`, so an added `otherAskingUnits: undefined` key or an extra grant fails.

## TDD Order

1. **`fix(pi-permission-system): a cd session option names its directory instead of every cd`**
   - Red: `test/access-intent/bash/bash-arity.test.ts` (`maps 'cd' to arity 2`), and a `suggestBashPattern` case in `test/presentation/pattern-suggest.test.ts`: `cd sub` → `cd sub*`, bare `cd` → `cd`.
   - Green: `cd: 2` in `ARITY`; the arity row in `docs/session-approvals.md`.
   - Killing mutation: delete the `cd: 2` entry; the suggestion returns `cd *`.
   - The final commit paragraph carries:

     ```text
     Refs #1095

     Co-authored-by: Raymond Neilson <222078815+rneilson-cerby@users.noreply.github.com>
     Co-authored-by: mikemikimike <186855910+mikemikimike@users.noreply.github.com>
     ```

2. **`refactor(pi-permission-system): name the multi-pattern session suggestion for what it holds`**
   - Rename `PathSessionSuggestion` → `SessionPatternsSuggestion` and extract `optionFromPatterns` from `pathSessionOption` in `tool.ts`.
     These prepare the chain suggestion's return type and the `valueSessionOption` branch.
   - Verify: `pnpm --filter @gotgenes/pi-permission-system run check` and the `tool.test.ts` / `pattern-suggest.test.ts` runs stay green; no test changes.
3. **`feat(pi-permission-system): the prompt payload names every other unit of a chain still asking`**
   - Red, across:
     - `tool-ask-payload.test.ts`: two asking units → `otherAskingUnits: ["npm test"]`; repeated text → one entry; one unit → request `toStrictEqual` with no key.
     - The `asPromptRequestFacts` tests (via `asPromptPayload`): round-trip; absent accepted; `[1]` and `"x"` rejected.
     - `forwarding-io.test.ts`: the field survives the wire.
     - `review-log-renderer.test.ts`: persisted when present, absent otherwise.
     - `command-redaction.test.ts`: `maskCommandFields({ otherAskingUnits: ["API_KEY=sk-x curl …"] })` masks the value.
   - Green: the type, guard, builder, review-log render, `COMMAND_BEARING_LOG_KEYS`, and the `docs/cross-extension-api.md` row.
   - Killing mutations:
     - builder: make `buildToolAskPayload` never set the field (kills the builder tests);
     - guard: drop the copy in `asPromptRequestFacts` (kills the round-trip tests);
     - redaction: remove the key from `COMMAND_BEARING_LOG_KEYS` (kills the masking test).
4. **`refactor(pi-permission-system): suggest one session pattern per asking unit of a chain`**
   - Red: `pattern-suggest.test.ts` `describe("suggestBashChainSessionPatterns")`.
     Two units → both patterns and the joined label; `echo a`, `echo b` → `["echo *"]` and exactly `suggestSessionPattern("bash", "echo a").label`; a comment-only unit dropped.
   - Green: the function.
     Typed `refactor:` because no consumer calls it until step 6.
   - Killing mutation: remove the `new Set` dedup; the `echo` case yields two patterns and a two-pattern label.
5. **`refactor(pi-permission-system): name several bash grants by pattern rather than as a path count`**
   - Red, in `pattern-suggest.test.ts`:
     - `describeGrantTarget` over two bash grants → `"cd sub*", "npm test*"`; the existing path cases stay `N paths`;
     - `buildForwardedScopeLabels` over two bash grants → `The whole session — allow bash "cd sub*", "npm test*" for parent and all subagents`.
   - Green: the path-family test in `describeGrantTarget`.
     Typed `refactor:` because no bash multi-grant approval exists until step 6.
   - Killing mutation: make the path-family test always true; the bash case reads `2 paths`.
6. **`fix(pi-permission-system): a chain's session option grants every unit the prompt asked about`**
   - Red:
     - `tool.test.ts`, a new `describe("a bash chain")`:
       - two asking units → `sessionApproval.grants` `[{bash, "cd sub*"}, {bash, "npm test*"}]` and label `Yes, allow bash "cd sub*", "npm test*" for this session`;
       - one asking unit → `toStrictEqual` to today's single grant and label;
       - an aliased shell tool → the chain grant.
     - `local-user-authorizer.test.ts`: a forwarded chain ask's `sessionScope.servingSessionLabel` lists both patterns.
     - The new integration test over the real stack, with `bash: {"*": "ask"}`:
       - approve-for-session on `cd sub && npm test` → session rules `bash:cd sub*`, `bash:npm test*`;
       - re-running the chain escalates nothing;
       - then, under `{"*": "allow", bash: {"*": "ask"}}`, `cd /etc` still asks on `bash`.
   - Green: the `valueSessionOption` branch.
   - Killing mutations:
     - make the branch condition `commands.length > 99`; the two-unit and integration tests record only `cd sub*`;
     - pass `commands.slice(0, 1)`; same.
   - Final paragraph: `Refs #1095` then the `Co-authored-by: Raymond Neilson …` line from step 1 (the one-grant-covering-the-shown-chain behavior is the issue's expected behavior 2).
7. **`fix(pi-permission-system): the permission dialog names every unit of a chain still asking`**
   - Red, in `dialog-renderer.test.ts`:
     - a payload with `otherAskingUnits: ["npm test"]` renders `also asks : npm test` after the `command` line, and highlights `npm test` in the `full command` line;
     - three units under a minimal row budget keep every `also asks` line.
   - `fact-vocabulary.test.ts`: `flaggedElements` for that payload → `["cd sub", "npm test"]`.
   - Green: `coreFacts` and `flaggedElements`.
   - Killing mutations:
     - render: drop the `also asks` push; kills the render and budget tests;
     - highlight: return only `value` from `flaggedElements`; kills the highlight test.
8. **`docs(pi-permission-system): document chained-command prompts and session grants`**
   - Update:
     - `docs/session-approvals.md` § Chained commands;
     - `docs/glossary.md` § Asking unit;
     - the ADR 0011 §3 amendment, dated from `date -u +%Y-%m-%d`;
     - the `architecture.md` module-tree entries and both sections named in Module-Level Changes.
   - Verify: `pnpm exec rumdl check` on each file.

## Risks and Mitigations

- **A longer session label.**
  A long chain yields a long label.
  The label is one line the dialog already width-caps, and patterns are deduplicated; no cap is added.
- **`cd sub*` matches `cd subdir`.**
  This is the existing trailing-wildcard convention, and the path surfaces still gate the destination.
  Step 1 pins the exact pattern, so a later narrowing is a deliberate change.
- **An older serving node receiving a newer child's request.**
  Its guard ignores the unknown key (it copies only known fields), so the ask renders without `also asks`, as today.
  A newer serving node reading an older child's request sees the field absent (step 3).
- **Secrets in the new field.**
  The review log masks it (step 3).
  The bus carries it unmasked, exactly like `value`, which already holds a command.

## Open Questions

- None; [#1101]'s partial verdict is the natural next step and has its own issue.

[#1030]: https://github.com/gotgenes/pi-packages/issues/1030
[#1033]: https://github.com/gotgenes/pi-packages/issues/1033
[#1063]: https://github.com/gotgenes/pi-packages/issues/1063
[#1065]: https://github.com/gotgenes/pi-packages/issues/1065
[#1074]: https://github.com/gotgenes/pi-packages/issues/1074
[#1083]: https://github.com/gotgenes/pi-packages/issues/1083
[#1097]: https://github.com/gotgenes/pi-packages/pull/1097
[#1101]: https://github.com/gotgenes/pi-packages/issues/1101
[#1120]: https://github.com/gotgenes/pi-packages/issues/1120
