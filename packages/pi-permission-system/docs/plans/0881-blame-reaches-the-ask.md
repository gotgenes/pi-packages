---
issue: 881
issue_title: "pi-permission-system: a path-surface ask's review entries and dialog carry no blame — flagged path and effect provenance never reach them"
---

# Blame reaches the ask it explains

## Release Recommendation

**Release:** ship now — batch "declared-effects" tail (this issue completes the batch)

Phase 15 pairs this step with [#880] (`commandEffects`) in the "declared-effects" batch, and this step is its tail.
[#880] landed with its release deferred to this tail (its retro's Sync stage), because the dialog's teaching sentence names the config key [#880] creates.
Releasing `pi-permission-system` here ships [#880]'s `feat:` and this step's `fix:` together.

## Problem Statement

When a bash command raises an `external_directory` or `path` ask, the human deciding it is told the rule and the command, never why the ask landed on the direction it did.
A user asked on `external_directory_write` about `git log ~/x`, which they know only reads, cannot see that the effect was unproven or what would prove it.

The review log has the same hole.
Each bash path gate stamps the deciding path's `effect` and `effectSource` on its `logContext`, which only `GateRunner` spreads into the entries *it* writes (policy deny, session fast path, yolo).
On `ask`, `PermissionPrompter` writes `waiting`/`approved`/`denied` from `PromptPermissionDetails` and `renderReviewLogFacts(payload)`, and the payload carries no blame.
So the blame reaches every review entry except the ones a human decides.

Measured against the local review log at planning time (17 MB, `node -e` over `permission_request.waiting` entries):

```text
entries carrying an "effect" key, all-time:                         0
bash external_directory "waiting" entries since 2026-09-05:       331
  …of which record a path:                                          0
bash external_directory asks since directional surfaces (2026-08-27): 419
  …on the bare family (unproven or retracted):                     202 (48%)
```

The 202 bare-family asks are the population the teaching sentence addresses.

## Goals

- A bash `path` or `external_directory` ask's `waiting`/`approved`/`denied` review entries name the deciding path, its `effect`, and its `effectSource`.
- The ask dialog states why the direction was chosen, and for an unproven effect, that declaring the command in `commandEffects` would classify it.
- A forwarded child's blame survives the wire, so the serving node's dialog and review log carry it.
- The runner-written entries (policy deny, session fast path, yolo) keep the same `effect`/`effectSource` keys they carry today, now sourced from the payload.
- **Not breaking.**
  The review log gains keys, the dialog gains one line, and the public `PromptRequestFacts` (on the `permissions:ui_prompt` broadcast) gains a field.
  No default, decision, or existing key changes.
  The required-nullable field follows `matchedSpelling`'s precedent, which shipped as `feat:` (`09c1ef62`).

## Non-Goals

- **Naming the command in the teaching sentence** (`declare git log in commandEffects`).
  The deciding path does not know which command produced it: `PathToken` carries `token`/`effect`/`role`/`span`, and the resolver merges tokens from different commands into one path.
  The operator chose the generic sentence ("declare the command in `commandEffects`"); naming the producing word is [#1062]'s mechanism.
- **Blame on tool path asks** (`read`/`write`/`edit`/MCP/extension tools).
  Their direction comes from tool identity, which is not an `EffectSource` value, and the remedy for an unproven tool is [#952]'s unshipped `toolEffects`.
  Operator decision: tool asks carry `decidingPath: null`.
  Pi's `ToolAnnotations.readOnlyHint` was recorded on [#952] as a design input, not adopted here.
- **The agent-facing renderer.**
  `agent-renderer.ts` gains nothing: telling the *agent* to declare an effect in `commandEffects` invites self-granted relief.
- **The full escaping-path list in the log.**
  It stays evidence (ADR 0011 §6); only the deciding path becomes a request fact.
  `logContext`'s existing `path` (bash `path` gate) and `externalPaths` (bash `external_directory` gate) keys stay as they are on runner entries.
- **Unit-level blame** (ADR 0013 §10's "`xargs rm` is an unclassifiable wrapper") and blame-targeted session-approval suggestions.
  Staging slice 5 names both; this step lands the path-token half only.
- **[#882]**, which rides this step's request-core addition as its vehicle but is its own deliberation.

## Background

- `src/presentation/prompt-payload.ts` — `PromptPayload` and its invariant core `PromptRequestFacts` (ADR 0011 §2–§3), plus the tolerant all-or-nothing reader `asPromptPayload` / `asPromptRequestFacts`.
  `matchedSpelling` is the precedent for a late-added fact: required `string | null`, read as `null` when absent.
- `src/presentation/path-ask-payload.ts` — `buildPathAskPayload` (callers: tool `path.ts`, bash `bash-path.ts`), `buildExternalDirectoryAskPayload` (caller: tool `external-directory.ts` only), `buildBashExternalDirectoryAskPayload` (caller: `bash-external-directory.ts`).
  The two single-path builders share `pathPayload`.
- `src/handlers/gates/bash-external-directory.ts` and `bash-path.ts` — each picks a `worstEntry` (an `AccessPath` plus `TokenEffect`) and stamps `effect: worstEntry.effect.effect`, `effectSource: worstEntry.effect.source` on `logContext`.
- `src/handlers/gates/runner.ts` — builds the shared `logContext` as `{ ...descriptor.logContext, ...renderReviewLogFacts(descriptor.payload), agentName, requestId }`, so a key the payload renders replaces a same-named `logContext` key.
- `src/authority/permission-prompter.ts` — writes `...renderReviewLogFacts(details.payload)` and then `path: details.path ?? null`, so a payload fact named `path` would be overwritten by `null` for bash asks; hence the distinct key `decidingPath`.
- `src/presentation/review-log-renderer.ts` — renders only request facts, omitting nulls via `present`.
- `src/presentation/dialog-renderer.ts` — `coreFacts` renders the invariant core, which the row budget never elides (§3 outranks §5).
- `src/presentation/fact-vocabulary.ts` — the render vocabulary shared by every renderer.
- `src/access-intent/effect.ts` — `AttributedEffect` (`read` | `write` | `unproven`), `EffectSource` (`syntax` | `core` | `declared-global` | `declared-project` | `retracted` | `unproven`), `TokenEffect`.
  `syntax` is produced only by `redirectDestinationEffect` (`command-effects.ts`), so it always means a redirect.
- `src/presentation/forwarded-ask-payload.ts` restamps only `requester` by spread, and `src/authority/forwarding-io.ts` reads the wire payload through `asPromptPayload`, so a child's fact passes through once the reader admits it.
- `src/service/permission-events.ts` puts `request` verbatim on the `permissions:ui_prompt` broadcast, and `src/service.ts` re-exports `PromptRequestFacts`.
- AGENTS.md constraints: pnpm only; a `docs: plan …` commit subject is unscoped (`/ship` greps `docs: \(re-\)\?plan .*(#N)`).

## Design Overview

### Payload shape

```typescript
// src/presentation/prompt-payload.ts
import type { AttributedEffect, EffectSource } from "#src/access-intent/effect";

/**
 * The path that decided a path-surface ask, and what established the direction
 * it was resolved on — ADR 0013 §10's blame, as a request fact.
 */
export interface DecidingPath {
  /** As the prompt shows it: the raw token (`path` gate) or the lexical absolute path (`external_directory`). */
  readonly path: string;
  readonly effect: AttributedEffect;
  readonly effectSource: EffectSource;
}

export interface PromptRequestFacts {
  // …existing facts…
  /** For a bash path-surface ask, the deciding path and its effect provenance; `null` for every other ask. */
  readonly decidingPath: DecidingPath | null;
}
```

- A nested object rather than three nullable fields, so "a path with no effect" is unrepresentable.
- `asPromptRequestFacts`: an absent `decidingPath` reads as `null` (a child built before the fact existed); a present one must be an object with a string `path`, an `effect` in the `AttributedEffect` list, and an `effectSource` in the `EffectSource` list, or the whole payload is rejected (ADR 0011 §9's all-or-nothing).
  The two member lists stay local to `prompt-payload.ts`, following `BASH_COMMAND_CONTEXTS`.
- `DecidingPath` is re-exported from `src/service.ts` beside `PromptRequestFacts`.

### Builders

- `buildPathAskPayload`'s facts gain an optional `decidingEffect?: TokenEffect`; `BashExternalDirectoryAskFacts` gains a required `decidingPath: { path: string; effect: TokenEffect }`.
  `buildExternalDirectoryAskPayload` gains nothing (tool-only caller).
- One private helper in `path-ask-payload.ts` flattens a `TokenEffect` once, so neither gate spells `.effect.effect`:

```typescript
function decidingPathFact(path: string, effect: TokenEffect): DecidingPath {
  return { path, effect: effect.effect, effectSource: effect.source };
}
```

- `pathPayload` takes the resulting `DecidingPath | null` as a parameter; for `buildPathAskPayload` the path is `facts.pathValue` (the raw token, which is also `request.value`).
- `tool-ask-payload.ts`, `skill-ask-payload.ts`, and the degraded branch of `forwarded-ask-payload.ts` set `decidingPath: null`.

### Gates

```typescript
// bash-external-directory.ts
buildBashExternalDirectoryAskPayload({
  …,
  decidingPath: { path: worstEntry.path.value(), effect: worstEntry.effect },
});
// bash-path.ts
buildPathAskPayload({ …, pathValue: worstToken, decidingEffect: worstEntry.effect });
```

Both gates drop `effect`/`effectSource` (and the comment crediting them) from `logContext`.
The bash `external_directory` path is `path.value()`, matching the `external path` evidence text the dialog already shows, so the blame line and the evidence entry name it identically.

### Review log

`renderReviewLogFacts` adds, when `decidingPath` is non-null:

```typescript
...(request.decidingPath === null ? {} : {
  decidingPath: request.decidingPath.path,
  effect: request.decidingPath.effect,
  effectSource: request.decidingPath.effectSource,
}),
```

Flat keys keep the runner entries' existing `effect`/`effectSource` names (and `docs/configuration.md`'s `effectSource: "declared-global"` sentence) true, and `decidingPath` cannot collide with the prompter's `path` column.
The value is a command token, as `path` and `externalPaths` already are, so it is not added to `COMMAND_BEARING_LOG_KEYS` — a deliberate no-op, not a redaction gap.

### Dialog

`fact-vocabulary.ts` gains `describeDecidingPath(payload): string | undefined`, and `coreFacts` pushes `{ label: "why", text }` after the `surface`/`rule` lines when it returns text.
The path prefix (`<path>: `) is omitted when `decidingPath.path === request.value` (the bash `path` gate, whose `path` line already names it).
One clause per source, exhaustive over `EffectSource` so a new source is a compile error:

| `effectSource`     | `effect`   | Clause                                                                                     |
| ------------------ | ---------- | ------------------------------------------------------------------------------------------ |
| `syntax`           | `write`    | `write (redirect destination)`                                                             |
| `syntax`           | `read`     | `read (redirect source)`                                                                   |
| `core`             | `read`     | `read (pure-reader command)`                                                               |
| `declared-global`  | any        | `<effect word> (declared in global commandEffects)`                                        |
| `declared-project` | any        | `<effect word> (declared in project commandEffects)`                                       |
| `retracted`        | `unproven` | `unproven (an option withdrew the read claim), consults both directions`                   |
| `unproven`         | `unproven` | `unproven, consults both directions; declare the command in commandEffects to classify it` |

`<effect word>` is `read`, `write`, or `unproven, consults both directions`.
A bash `external_directory` example renders as `why : /home/u/x: unproven, consults both directions; declare the command in commandEffects to classify it`.
The line is part of the core, so the 24-row default budget gives evidence one row less on a bash path ask (estimated: one row, two when it wraps at the terminal width).

### Forwarding

No change to `forwarding-io.ts` (predicted unchanged; its reader delegates to `asPromptPayload`).
A new child talking to an old serving node: the old reader rebuilds `request` from its known fields and silently drops `decidingPath` — the pre-fix behavior, not a failure.
An old child talking to a new serving node: absent reads as `null`.

### Edge cases stated as behavior

- Absent `decidingPath` on the wire → `null` (Step 1).
- Malformed `decidingPath` (unknown source, non-string path) → whole payload `undefined` (Step 1).
- Tool path and tool `external_directory` asks → `decidingPath: null` and no `why` line (Steps 2 and 3).
- Bash `path` ask → no path prefix on the `why` line (Step 3).
- Runner-written deny entry for a bash ask still carries `effect`/`effectSource` (Step 2).

## Module-Level Changes

- `src/presentation/prompt-payload.ts` — `DecidingPath`; `PromptRequestFacts.decidingPath`; `asPromptRequestFacts` admits it; local member lists.
- `src/presentation/path-ask-payload.ts` — `decidingEffect` / `decidingPath` inputs, `decidingPathFact`, `pathPayload` parameter (Step 1 sets `null`; Step 2 wires the inputs).
- `src/presentation/tool-ask-payload.ts`, `skill-ask-payload.ts`, `forwarded-ask-payload.ts` — `decidingPath: null`.
- `src/service.ts` — re-export `DecidingPath`.
- `src/handlers/gates/bash-external-directory.ts`, `bash-path.ts` — supply the deciding path; drop `effect`/`effectSource` from `logContext`.
- `src/handlers/gates/tool.ts` — the `floorExemptionFact` doc comment (line ~225) credits "the same routing `effect`/`effectSource` take on the bash path gates"; reword it to stand alone, since that routing goes away.
- `src/presentation/review-log-renderer.ts` — render the three keys.
- `src/presentation/fact-vocabulary.ts` — `describeDecidingPath`.
- `src/presentation/dialog-renderer.ts` — the `why` core line.
- Tests — see TDD Order.
  Exact-shape pins that gain `decidingPath: null` in Step 1 (the assessor's enumeration, re-derived with `grep -rn "matchedSpelling: null" test`, 12 sites in 9 files): `test/helpers/prompt-details-fixtures.ts`, `test/presentation/{path-ask-payload,tool-ask-payload,skill-ask-payload,prompt-notification}.test.ts`, `test/service/permission-ui-prompt.test.ts`, `test/authority/{forwarded-request-server,approval-escalator,forwarding-io}.test.ts`.
  Files spreading `makePromptPayload().request` need no edit.
- `docs/architecture/architecture.md` — module entries for `prompt-payload.ts`, `path-ask-payload.ts`, `review-log-renderer.ts`, `dialog-renderer.ts`, `fact-vocabulary.ts`, `bash-external-directory.ts` (line ~983, "stamps … on the log context"), `bash-path.ts` (line ~984, "ride the log context"), and `tool.ts` (line ~987, "the same routing the bash path gates give"); the Phase 15 findings sentence (line ~1124) stays as history of the cause; the `#### [#881]` step heading and the `S881` Mermaid node gain `✅` and a `Landed:` note; the health-metric row "Effect provenance in the ask payload" reads its delivered value.
- `docs/configuration.md` — after `#### Which direction is a given access?`, a paragraph: the ask dialog's `why` line names the deciding path's direction and what established it, and the review log records `decidingPath`, `effect`, `effectSource` on every entry of a bash path ask.
  Follows the `matched as` / `matchedSpelling` precedent at line ~518.
- `docs/decisions/0013-permission-policy-model.md` — Staging item 5 notes that path blame into prompts landed with this issue and unit blame plus blame-targeted suggestions remain; §7's "Provenance is logged" is now true and needs no edit.
- Predicted unchanged:
  - `src/authority/forwarding-io.ts` — its reader is `asPromptPayload`.
  - `src/authority/permission-prompter.ts` — it already spreads `renderReviewLogFacts(details.payload)`.
  - `src/handlers/gates/runner.ts` — same.
  - `src/presentation/agent-renderer.ts` — Non-Goal.
  - `src/logging/command-redaction.ts` — `decidingPath` is not command-bearing (Design Overview).
  - `packages/pi-permission-system/README.md` — names no dialog line or review-log key (`grep -n "matched as\|matchedSpelling\|review log" README.md` is empty).
  - `.pi/skills/package-pi-permission-system/SKILL.md` — the "stamped context makes a retraction readable" claim the issue cites is no longer there (`grep -n "retraction\|stamped\|logContext\|effectSource"` is empty).

## Test Impact Analysis

1. New tests: the reader's absent / malformed / round-trip cases for `decidingPath`; the builders stamping it; the renderer's three keys; the vocabulary's per-source clause; the dialog line and its path-prefix rule; a prompter-level test proving a real bash gate's payload produces a `waiting` entry carrying the blame (the measured symptom).
2. Redundant: none removed.
   The seven `logContext` blame assertions (`bash-external-directory.test.ts` lines ~416–485, four tests; `bash-path.test.ts` lines ~370–406, three tests) are re-pointed at `payload.request.decidingPath`, each also asserting the keys are absent from `logContext`.
3. Stay as-is: the existing `renderReviewLogFacts` tests (`persists no evidence and no annotations` pins ADR 0011 §6's exclusion); `forwarding-io.test.ts`'s "round-trips the child's complete prompt payload" gains a non-null `decidingPath` rather than a sibling test.

## Invariants at risk

| Invariant (source)                                                                          | Constituency                                | Pin                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The review log persists request facts only, never evidence (ADR 0011 §6, [#746])            | Log readers; ADR 0010's bound on log growth | `review-log-renderer.test.ts` "persists no evidence and no annotations" (unchanged); Step 2 adds an assertion that `externalPaths` is absent from the rendered facts |
| `effectSource` can read `declared-*` ([#880] Outcome)                                       | Users auditing a declared allow             | `bash-external-directory.test.ts` "records the declaring scope…" re-pointed in Step 2 at `payload.request.decidingPath` and at `renderReviewLogFacts(payload)`       |
| A runner-written deny / session / yolo entry for a bash ask carries `effect`/`effectSource` | Log readers of policy-decided entries       | New `runner.test.ts` test in Step 2 (deny path, real `renderReviewLogFacts`)                                                                                         |
| A forwarded ask renders the child's facts, not the parent's (ADR 0008, [#745])              | Serving-node human                          | `forwarding-io.test.ts` round-trip and `forwarded-request-server.test.ts` pass-through pins (Step 1)                                                                 |
| The broadcast carries `request` verbatim, no evidence (ADR 0011 §6)                         | Bus consumers                               | `permission-ui-prompt.test.ts` "carries the payload's invariant core verbatim" gains a non-null `decidingPath` (Step 1)                                              |

`runner.test.ts` uses `makeReporter` mocks for the reporter only; the runner's own `renderReviewLogFacts` call is real, so the new test pins the runner's spread order rather than a mock.

## TDD Order

1. **`refactor(pi-permission-system): carry a deciding path as a prompt request fact`**
   - Add `DecidingPath` and the required `decidingPath` field; every builder sets `null`; `asPromptRequestFacts` admits it; re-export from `service.ts`; add `decidingPath: null` to the 12 exact-shape sites listed in Module-Level Changes.
   - Tests (`asPromptPayload` has no test file of its own; its cases live in `test/authority/forwarding-io.test.ts`'s `readForwardedPermissionRequest — payload field` describe, beside the existing malformed-payload tests):
     - a payload without `decidingPath` reads with `decidingPath: null`;
     - a `decidingPath` with `effectSource: "guessed"` drops the whole payload;
     - `forwarding-io.test.ts` "round-trips the child's complete prompt payload" carries `{ path: "/outside/x", effect: "unproven", effectSource: "unproven" }`;
     - `permission-ui-prompt.test.ts`'s verbatim-core test carries a non-null `decidingPath`.
   - Killing mutations:
     - make `asPromptRequestFacts` return `decidingPath: null` unconditionally (kills the round-trip and verbatim-core tests);
     - drop the `?? null` default so an absent field fails validation (kills the absent test);
     - accept any string as `effectSource` (kills the malformed test).
   - Type `refactor:` — no consumer renders the field yet.
2. **`fix(pi-permission-system): record the deciding path and its effect provenance on a bash ask's review entries`**
   - Wire `decidingEffect` / `decidingPath` through `path-ask-payload.ts` and both bash gates; drop `effect`/`effectSource` from both gates' `logContext`; render the three keys in `renderReviewLogFacts`; reword the `tool.ts` comment.
   - Tests:
     - `path-ask-payload.test.ts`: `buildBashExternalDirectoryAskPayload` and `buildPathAskPayload` (with `decidingEffect`) produce the flattened `decidingPath`; `buildPathAskPayload` without it and `buildExternalDirectoryAskPayload` produce `null`.
     - `bash-external-directory.test.ts` / `bash-path.test.ts`: the seven blame tests re-pointed at `payload.request.decidingPath` (path, effect, source), each asserting `logContext` has no `effect`/`effectSource` key (`not.toHaveProperty`).
     - `path.test.ts` / `external-directory.test.ts`: a tool ask's payload carries `decidingPath: null`.
     - `review-log-renderer.test.ts`: renders `decidingPath`/`effect`/`effectSource` when present, omits all three when `null`, and never renders `externalPaths`.
     - `runner.test.ts`: a deny descriptor whose payload carries a `decidingPath` writes `permission_request.blocked` with `effect`/`effectSource`/`decidingPath`.
     - `permission-prompter.test.ts`: the payload `describeBashExternalDirectoryGate` builds for `cat /outside/a.ts` (resolver asking) yields a `permission_request.waiting` entry with `decidingPath: "/outside/a.ts"`, `effect: "read"`, `effectSource: "core"`.
   - Killing mutations:
     - make `decidingPathFact` return `effectSource: "unproven"` unconditionally (kills the gate and builder source assertions);
     - delete the `decidingPath` argument at the `bash-external-directory.ts` call site (kills that gate's tests and the prompter test);
     - delete `decidingEffect` at the `bash-path.ts` call site (kills that gate's tests);
     - delete the `decidingPath` spread in `renderReviewLogFacts` (kills the renderer, runner, and prompter tests);
     - restore `effect: worstEntry.effect.effect` on one gate's `logContext` (kills its `not.toHaveProperty` assertion).
3. **`fix(pi-permission-system): say in the ask dialog why a bash path ask landed on its direction`**
   - `describeDecidingPath` in `fact-vocabulary.ts`; the `why` core line in `dialog-renderer.ts`.
   - Tests:
     - `fact-vocabulary.test.ts`: one `it.each` row per table row in Design Overview (seven rows, both declared scopes with `read`), plus `null` → `undefined`.
     - `dialog-renderer.test.ts`: a `bash_external_directory` payload renders `why : /outside/x: unproven, consults both directions; declare the command in commandEffects to classify it`; a bash `path` payload whose `decidingPath.path` equals `value` renders the clause without the prefix; a tool payload renders no `why` line; under a two-row `maxRows` budget the `why` line survives while evidence is elided (it is core).
   - Killing mutations:
     - swap the `syntax` arm's `write`/`read` clauses (kills the two `syntax` rows);
     - drop `; declare the command in commandEffects to classify it` from the `unproven` arm (kills that row and the dialog test);
     - make the prefix rule always prefix (kills the bash `path` dialog test);
     - push the `why` fact from `evidenceFacts` instead of `coreFacts` (kills the budget test).
4. **`docs(pi-permission-system): document the why line and the review log's blame keys`**
   - `docs/configuration.md` paragraph; architecture module entries; the `✅` on the `#### [#881]` heading and the `S881` node; the `Landed:` note; the health-metric row; ADR 0013 Staging item 5.
   - Verify: `grep -c 'effectSource' packages/pi-permission-system/src/presentation/path-ask-payload.ts` reads `1` (baseline `0`, measured at planning time; the one site is `decidingPathFact`), meeting the row's `≥ 1` target.
   - Verify: `pnpm exec rumdl check` over each edited markdown file.

## Risks and Mitigations

- **A `decidingPath` that disagrees with the evidence.**
  The bash `external_directory` gate uses `path.value()` for both, and Step 3's dialog test asserts the `why` path equals an `external path` evidence text.
- **The teaching sentence on a disagreement fold.**
  `mergeTokenEffects` folds two disagreeing attributions of one path (`cat a.txt > a.txt`) to `{ unproven, unproven }`, so the dialog suggests a declaration that would not change the outcome there.
  Accepted: `EffectSource` has no value distinguishing "disagreed" from "unclaimed", and adding one is a vocabulary change outside this step; the sentence remains true ("consults both directions").
- **The broadcast discloses one more path.**
  `permissions:ui_prompt` carries `request` verbatim, so the deciding path (lexical-absolute for `external_directory`) now reaches the bus, where before only the command did.
  The command already contains the token; the absolute form adds the working-directory prefix the evidence held.
  Accepted as the request-fact design the issue proposes; noted in the configuration paragraph.
- **A version-skewed serving node drops the fact.**
  It renders what it rendered before this change; the child's own review log, written by its own prompter at escalation, still carries the blame.
- **Row budget.**
  One more core line costs evidence one row on bash path asks (estimated); the elision marker and `Ctrl+O` complete view are unchanged.

## Open Questions

- Whether the serving node should distinguish a disagreement fold in the blame line — deferred until an `EffectSource` value for it exists.

[#745]: https://github.com/gotgenes/pi-packages/issues/745
[#746]: https://github.com/gotgenes/pi-packages/issues/746
[#880]: https://github.com/gotgenes/pi-packages/issues/880
[#882]: https://github.com/gotgenes/pi-packages/issues/882
[#952]: https://github.com/gotgenes/pi-packages/issues/952
[#1062]: https://github.com/gotgenes/pi-packages/issues/1062
