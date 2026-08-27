---
issue: 744
issue_title: "pi-permission-system: introduce the structured PromptPayload and dissolve the five prompt-assembly sites"
---

# Structured `PromptPayload` and the dissolution of the ask-prompt assembly sites

## Release Recommendation

**Release:** mid-batch — defer (batch "presentation-payload"); confirm at ship time

Phase 13 Step 1 is the first member of the `presentation-payload` batch (Steps 1 and 2); the tail is Step 2 ([#710]), whose `fix:` is the batch's release vehicle.
Every commit in this plan is a hidden changelog type (`refactor:` / `test:` / `docs:`), so this step cuts no release on its own even if the release-please PR is merged.
Leave the release-please PR unmerged until Step 2 lands.

## Problem Statement

Presentation is fused with decision-making.
Each gate renders its facts into an English sentence at the point of decision, and that flat `string` becomes `PromptPermissionDetails.message`, travelling unchanged to the inline TUI dialog, the `select`/`input` fallback, the review log, the `permissions:ui_prompt` broadcast, and the on-disk forwarded request.

Because the payload is a pre-rendered sentence, elision is a property of the payload rather than of a render.
That is the direct cause of the open items [ADR 0011] catalogues: the bash branch has no cap at all, nothing bounds height ([#710]), and a forwarded ask is assembled twice under two different configs, so consistency across local and forwarded asks is structurally unattainable.

ADR 0011 §2 states the rule this step implements: the payload is complete by contract, and elision is a property of a render, never of the payload.
Nothing downstream can be bounded until the payload exists, so this step is the prerequisite for the rest of Phase 13.

### Correction: six assembly sites, not five

The issue body and ADR 0011 §"What the code did before this decision" both enumerate **five** sites.
A grep of `src/` for the shared subject idiom (`Agent '<name>'` / `Current agent`) finds a sixth:

```bash
grep -rn "Current agent" packages/pi-permission-system/src --include="*.ts"
```

The complete inventory of ask-message producers at `main`:

| #   | Function                                           | File                                                | Consumers                                               |
| --- | -------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| 1   | `formatAskPrompt` (bash / MCP / generic branches)  | `src/permission-prompts.ts`                         | `handlers/gates/tool.ts`                                |
| 2   | `formatSkillAskPrompt`                             | `src/permission-prompts.ts`                         | `handlers/gates/skill-input.ts`                         |
| 3   | `formatSkillPathAskPrompt`                         | `src/permission-prompts.ts`                         | `handlers/gates/skill-read.ts`                          |
| 4   | `formatExternalDirectoryAskPrompt`                 | `src/handlers/gates/external-directory-messages.ts` | `handlers/gates/external-directory.ts`                  |
| 5   | `formatBashExternalDirectoryAskPrompt`             | `src/handlers/gates/external-directory-messages.ts` | `handlers/gates/bash-external-directory.ts`             |
| 6   | `formatPathAskPrompt`                              | `src/handlers/gates/path.ts`                        | `handlers/gates/path.ts`, `handlers/gates/bash-path.ts` |
| 7   | `formatForwardedPermissionPrompt` (module-private) | `src/authority/forwarded-request-server.ts`         | the serving node's ask                                  |

Site 6 is the one both the issue and the ADR omit, and it has two consumers.
Seven gate descriptors set `promptDetails.message`: `tool.ts`, `path.ts`, `bash-path.ts`, `external-directory.ts`, `bash-external-directory.ts`, `skill-input.ts`, `skill-read.ts`.
`ToolPreviewFormatter.formatToolInputForPrompt` feeds site 1 and is the per-tool preview the issue counts among the five; it becomes an evidence entry rather than a migrated module (see Non-Goals).

### Correction: `executedUnit` has no existing source

Issue [#713] cites `classifyAndExtractWrapper`, a `payloadText: null` return, and a `STRIPPABLE_WRAPPERS` set.
None of those exist in `src/access-intent/bash/command-enumeration.ts` at `main`.
What exists is `classifyWrapperCommand`, which returns only a `WrapperKind` discriminant — it *flags* a wrapper and never extracts the inner command.
So `timeout 10 grep foo` does **not** currently surface `grep foo`; `PermissionCheckResult.command` carries the whole wrapper text for every wrapper kind, strippable or not.
Populating `request.executedUnit` therefore requires new extraction logic, planned below.

## Goals

- Add `PromptPayload` — the `request` invariant core (ADR 0011 §3), the complete `evidence` list, and the `annotations` slot — as the structured description of a permission ask.
- Seed `src/presentation/` and land the six ask-prompt assemblers there as payload builders, so the modules the spine rewrites reach their final home the first time.
- Derive `message` *from* the payload via a single transitional `renderLegacyMessage(payload)`, so the existing prompt-text tests become the payload's completeness proof.
- Carry the executed unit of a bash wrapper as a payload fact ([#713]'s fact, display-only, never gating).
- Keep behavior byte-identical: every rendered `message` string is unchanged, pinned by the existing suite.

This change is **not** breaking.
It adds optional-then-required internal fields and two new public types; no existing observable behavior, output shape, or default changes.

## Non-Goals

- Any renderer change — the dialog, fallback, log, broadcast, and agent renderers all keep reading `message` (Steps 2, 3, 4: [#710], [#745], [#746]).
- Replacing `message` on the forwarded wire or the `permissions:ui_prompt` broadcast (Step 3, [#745]).
- Writing the payload to the review log — `logContext.message` stays the rendered string, so ADR 0010's log-growth bound is untouched (Step 4, [#746]).
- Migrating `tool-preview-formatter.ts`, `tool-input-prompt-formatters.ts`, or `tool-input-preview.ts` into `src/presentation/` — they also serve `getPermissionLogContext` on the review-log path, which Step 4 owns.
  Their prompt output is wrapped as an evidence entry instead.
- Migrating `denial-messages.ts` (Step 4) — it keeps owning `resolvesToSuffix`, `ExternalPathDisclosure`, `matchQualifier`, and `describeBashCommandContext`, which the presentation modules import.
- **Gating** the extracted inner command.
  [#713]'s "gateable extraction" option is explicitly declined: the wrapper floor ([#490]) stands unchanged, `executedUnit` is display-only, and no `BashCommand` unit is added or removed.
- The annotator and evidence-formatter registries (ADR 0011 §8) — the `annotations` slot lands empty.
- Soft-deprecating `toolInputPreviewMaxLength` / `toolTextSummaryMaxLength` (Step 3, ADR 0011 §5).
- `docs/architecture/v3-architecture.md` — a frozen design-era snapshot, not maintained as current state (established at [#437], [#559]).

## Background

### Modules in play

- `src/handlers/gates/descriptor.ts` — `GateDescriptor.promptDetails: Omit<PromptPermissionDetails, "requestId">`, the single funnel every gate's prompt facts pass through.
- `src/authority/permission-prompter.ts` — declares `PromptPermissionDetails`, and writes `details.message` to the review log.
- `src/service.ts:39` re-exports `PromptPermissionDetails`, so it is part of the **public** `dist/public.d.ts` bundle, gated by `scripts/verify-public-types.sh`.
- `src/access-intent/bash/command-enumeration.ts` — `BashCommand` (`text`, `context?`, `wrapperKind?`), `classifyWrapperCommand`, `readWrapperCommand`, `commandUnitText`, `INDIRECTION_WRAPPER_NAMES`, `EXEC_CONDITIONAL_WRAPPERS`, `SHELL_WRAPPER_NAMES`.
  `BashCommand`'s doc comment names the type as the stable extension point ([#306] added `context`).
- `src/handlers/gates/bash-command.ts` — `resolveBashCommandCheck` maps each `BashCommand` to a `PermissionCheckResult` and tags the winner with `commandContext`; the same place can tag `executedUnit`.
- `src/denial-messages.ts` — the established precedent for this change's shape: a structured `DenialContext` discriminated union rendered at the edge, which ADR 0011 §7 explicitly cites approvingly.

### Constraints from AGENTS.md and the package skill

- ADR 0002's string boundary: `permission-manager.ts` must not import `AccessPath`.
  The payload carries only strings and enums, so it never crosses that boundary.
- No `process.platform` read inside `src/` outside `index.ts` — the new modules read none.
- `docs/architecture/architecture.md` module-tree entries describe current behavior; cite an issue only when the ref encodes an active constraint.
- The roadmap step must be marked `✅` (heading + Mermaid node) in the implementation doc-update commit, not deferred to ship.
- Health-metric rows naming symbols the phase has not created yet must either use the roadmap's name or be updated in the same commit.

### Measured baselines (2026-08-15)

| Metric                      | Command                                                                                  | Baseline | Target |
| --------------------------- | ---------------------------------------------------------------------------------------- | -------- | ------ |
| Flat-assembler sites        | `grep -rn "formatAskPrompt" packages/pi-permission-system/src --include="*.ts" \| wc -l` | 4        | 0      |
| `src/presentation/` present | `ls packages/pi-permission-system/src \| grep -c presentation`                           | 0        | 1      |

Both were run at planning time against `main`; the numbers are measured, not estimated.

### Collision: PR #738

PR [#738] ("Highlight the flagged command, path, or target in TUI permission prompts", opened 2026-08-14) touches `tool.ts`, `path.ts`, `bash-path.ts`, `external-directory.ts`, `bash-external-directory.ts`, `permission-prompter.ts`, `forwarded-request-server.ts`, and `permission-prompt-component.ts` — nearly every file this step rewrites.
It is untriaged and unmentioned in the roadmap's open-issue sweep or in ADR 0011.
Under ADR 0011 highlighting is a **render** concern, exactly as [#716]'s aligned one-fact-per-line intent is.
Disposition (operator-decided at planning): its intent is adopted in Step 2's dialog renderer with authorship credited, and the PR is closed as superseded rather than rebased.
This plan records the disposition in the roadmap; the comment and close happen at ship time.

## Design Overview

### The payload

```typescript
/** Which ask this payload describes; the renderers' dispatch discriminant. */
export type PromptPayloadKind =
  | "bash"
  | "mcp"
  | "tool"
  | "path"
  | "external_directory"
  | "bash_external_directory"
  | "skill"
  | "skill_read"
  | "forwarded";

/**
 * One piece of decision evidence. Complete on the payload; each renderer elides
 * to fit its own budget (ADR 0011 §2, §4).
 */
export interface PromptEvidence {
  readonly label: string;
  readonly text: string;
  /**
   * A secondary fact bound to this entry that a renderer may show alongside or
   * elide independently — e.g. a symlink-resolved alias for an external path.
   */
  readonly detail: string | null;
}

/** A model-generated advisory; the slot owns its attribution and marking. */
export interface PromptAnnotation {
  readonly source: string;
  readonly text: string;
}

/** The invariant core: facts no renderer may elide (ADR 0011 §3). */
export interface PromptRequestFacts {
  readonly requester: {
    readonly agentName: string | null;
    readonly forwarded: boolean;
    readonly sessionId: string | null;
  };
  /** The gate surface the rule fired on. */
  readonly surface: string;
  /** The gated tool name; `null` when the ask is not tool-shaped. */
  readonly toolName: string | null;
  /** The invoked tool name when a shell alias re-exposes bash (#574); else `null`. */
  readonly invokedToolName: string | null;
  /** The decision-relevant value — the gate's own decision value. */
  readonly value: string;
  /** The matched rule, including a sentinel such as `<indirection-bash-wrapper>`. */
  readonly matchedPattern: string | null;
  /** The offending bash unit's execution context, when nested. */
  readonly commandContext: BashCommandContext | null;
  /** The unit that will actually run inside a wrapper (#713); `null` when it adds nothing. */
  readonly executedUnit: string | null;
}

export interface PromptPayload {
  readonly kind: PromptPayloadKind;
  readonly request: PromptRequestFacts;
  readonly evidence: readonly PromptEvidence[];
  readonly annotations: readonly PromptAnnotation[];
}
```

Three deliberate divergences from ADR 0011 §2's illustrative sketch, each recorded here because the ADR assigns the exact types to this issue:

1. **`kind` discriminant.**
   The sketch has no discriminant, but nine distinct message shapes must be regenerated, and `(surface, source)` does not separate them — the tool external-directory ask and the bash external-directory ask share surface `external_directory`, and the path gate and the per-tool gate differ only in wording.
   A `kind` mirrors `DenialContext`'s existing discriminated union, which ADR 0011 §7 already names as the shape to copy, and it gives every renderer an exhaustive `switch` with a `never` guard instead of a set of string comparisons a new variant sails past.
2. **`matchedPattern: string | null`, not `string | undefined`.**
   Step 3 puts the payload on the on-disk forwarded wire, where `undefined` does not survive JSON.
   The package already made this call for the same reason — `accessFactsFromPath` maps an empty `boundaryValue()` to `null` "so the wire distinguishes 'no canonical form' cleanly".
   Uniform `| null` across the payload keeps Step 3 from re-deciding it field by field.
3. **`commandContext` on the request facts.**
   Today's bash prompt renders `matchQualifier(matchedPattern, commandContext)`, e.g. `(matched 'rm *', inside command substitution)`.
   The matched rule is invariant-core by ADR 0011 §3.3, and the context is what makes it intelligible — so the raw `BashCommandContext` enum is a request fact and `describeBashCommandContext` stays a render.
   Putting the rendered qualifier in `evidence` instead would put a pre-rendered clause back in the payload, which is the thing being removed.

`evidence` is a list, not a record, because ADR 0011 §4 lets a renderer elide entries and order them under its own budget.

### The builders and the transitional renderer

The gate computes its decision value already; the builder receives it rather than re-deriving it, so `request.value` is by construction the same string the decision event carries — and `src/presentation/` never imports from `src/handlers/`.

Consumer call site (`describeToolGate`, ~5 lines, replacing the `formatAskPrompt` call):

```typescript
const decisionValue = deriveDecisionValue(gateSurface, check, toolPath);
const payload = buildToolAskPayload({
  check,
  agentName: tcc.agentName,
  invokedToolName: shell ? tcc.toolName : null,
  value: decisionValue,
  input: tcc.input,
  formatter,
});
const askMessage = renderLegacyMessage(payload);
```

The gate hands over the facts it holds and asks for nothing back but the payload; the message is a render over that payload, not a second assembly.
`renderLegacyMessage` reads only the payload — that is what makes the existing byte-identity tests a completeness proof.

Evidence contributed per kind, and what the legacy render does with it:

| Kind                      | Evidence entries                                                                             | Legacy render                                         |
| ------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `bash`                    | `full command` when it differs from the unit                                                 | `(full command: '…')`                                 |
| `mcp` / `tool`            | `input` when the preview is non-empty                                                        | appended verbatim                                     |
| `path`                    | none                                                                                         | —                                                     |
| `external_directory`      | `resolves to` (when the canonical alias differs), `working directory`                        | `(resolves to '…')` + `outside working directory '…'` |
| `bash_external_directory` | `working directory`, then one `external path` per disclosure with `detail` = canonical alias | the comma-joined path list                            |
| `skill`                   | none                                                                                         | —                                                     |
| `skill_read`              | `read path`                                                                                  | `via '…'`                                             |
| `forwarded`               | `requested` = the child's relayed `message`                                                  | the three-line prefix + that text                     |

`renderLegacyMessage` is transitional and deliberately label-coupled to those entries.
It is deleted when the last `message` reader goes — Step 3 for the wire and broadcast, Step 4 for the review log.

The `forwarded` kind is the version-skew reality until Step 3: the child ships a pre-rendered sentence, so the serving node's payload carries it as a single evidence entry.
Step 3 replaces that entry with the child's own payload.

### Executed-unit extraction

New pure module `src/access-intent/bash/executed-unit.ts`, consumed only by `command-enumeration.ts`:

```typescript
/**
 * The command that will actually run inside a wrapper unit, or `null` when it
 * cannot be established. Display-only: never gated, never a `BashCommand`.
 */
export function extractExecutedUnit(node: TSNode, kind: WrapperKind): string | null;
```

Interaction with its upstream dependency is a read of the same `command` node `classifyWrapperCommand` already inspects, through the same shallow named-child walk `readWrapperCommand` performs — no re-parse, no async, no mutation of the node, and no second traversal of the program.

Algorithm:

- **`opaque-payload`** — take the inline-shell payload argument (the first non-flag argument after the `-c` cluster for a shell; the first argument for `eval`) and strip one layer of matching surrounding quotes.
  The payload is an inner *program*, so it is unquoted rather than sliced.
- **`indirection`** — skip the wrapper name, then skip leading `variable_assignment` children and leading option tokens, consuming a following value token for options in a curated per-wrapper value-taking set (`sudo -u`, `xargs -n/-P/-I/-d/-L/-s/-a/-E`, `timeout`'s leading duration and `-s/-k`, `nice -n`, `env -u/-C`, `stdbuf -i/-o/-e`, `watch -n`, `flock`'s leading file/fd and `-w/-E`, `time -o/-f`, `doas -u/-C`).
  The executed unit is then `node.text` sliced from the first remaining child's `startIndex`, exactly as `commandUnitText` slices past an assignment prefix — so spacing and quoting are preserved verbatim.
- **exec-conditional (`find`/`fd`)** — slice from the token after the matched exec flag, up to and including a `;`/`+` terminator for `find`, to the end for `fd`.
- **Nesting** — re-apply while the remainder's head basename is itself a wrapper name (`sudo timeout 5 xargs grep foo` → `grep foo`), capped at a documented depth.
- **Fail to `null`, never to a guess** — an empty remainder, a remainder whose head still begins with `-`, a bare `xargs` (which defaults to `echo`), or an exceeded depth yields `null`.

A curated per-wrapper table matches the package's existing convention (`src/bash-arity.ts` is a curated dictionary; it holds session-approval prefix arity, not flag arity, so it is not reusable here).
Because the fact is display-only and never gates, an imprecise entry is a cosmetic defect and never a permission bypass — and the fail-to-`null` rule keeps it from being a *misleading* one on a decision surface.

Plumbing, one field per hop, following `commandContext`'s existing path:

1. `BashCommand.executedUnit?: string` — set by `makeUnit` when `classifyWrapperCommand` returns a kind and extraction succeeds.
2. `PermissionCheckResult.executedUnit?: string` — tagged onto the winning result in `resolveBashCommandCheck`, alongside the existing `commandContext` tag.
3. `PromptRequestFacts.executedUnit: string | null` — the builder emits `null` when the extracted unit equals `request.value`, so a render shows it only when it adds information.

### `PromptPermissionDetails.payload`

`payload` is added optional, populated at every one of the seven descriptor sites plus the forwarded server, then **tightened to required** in the final cycle.
Required is the point: it makes "every ask has a complete structured payload" a compile-time guarantee rather than a convention, which is exactly Step 1's stated outcome.

`PromptPermissionDetails` is re-exported through `src/service.ts`, so `PromptPayload` and its member types enter `dist/public.d.ts` transitively via the rollup-dts bundle.
An external `Authorizer` link *consumes* details and is unaffected by a widened type; only a constructor breaks, and the only constructors are in this package and its tests.

## Module-Level Changes

### Added

| Path                                            | Contents                                                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/presentation/prompt-payload.ts`            | `PromptPayloadKind`, `PromptEvidence`, `PromptAnnotation`, `PromptRequestFacts`, `PromptPayload`                                                             |
| `src/presentation/legacy-message.ts`            | `renderLegacyMessage(payload)` — exhaustive `switch` on `kind` with a `never` guard; imports `resolvesToSuffix` / `matchQualifier` from `denial-messages.ts` |
| `src/presentation/tool-ask-payload.ts`          | `buildToolAskPayload` (bash / MCP / generic branches)                                                                                                        |
| `src/presentation/path-ask-payload.ts`          | `buildPathAskPayload`, `buildExternalDirectoryAskPayload`, `buildBashExternalDirectoryAskPayload`                                                            |
| `src/presentation/skill-ask-payload.ts`         | `buildSkillAskPayload`, `buildSkillPathAskPayload`                                                                                                           |
| `src/presentation/forwarded-ask-payload.ts`     | `buildForwardedAskPayload`                                                                                                                                   |
| `src/access-intent/bash/executed-unit.ts`       | `extractExecutedUnit(node, kind)` + the curated per-wrapper value-taking flag table                                                                          |
| `test/helpers/presentation-fixtures.ts`         | `makePermissionCheckResult`, `makeToolPreviewFormatter` (tidy-first prep)                                                                                    |
| `test/helpers/prompt-details-fixtures.ts`       | `makePromptDetails`, `makePromptPayload`                                                                                                                     |
| `test/presentation/*.test.ts`                   | one file per new `src/presentation/` module                                                                                                                  |
| `test/access-intent/bash/executed-unit.test.ts` | extraction unit tests                                                                                                                                        |

### Changed

| Path                                                | Change                                                                                                                                                                                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/permission-prompts.ts`                         | `formatAskPrompt`, `formatSkillAskPrompt`, `formatSkillPathAskPrompt` **removed**; retains `formatMissingToolNameReason` and `formatUnknownToolReason` (agent-facing pre-check text, Step 4's territory)                      |
| `src/handlers/gates/path.ts`                        | `formatPathAskPrompt` **removed**; builds the payload, derives `message`                                                                                                                                                      |
| `src/handlers/gates/bash-path.ts`                   | switches to `buildPathAskPayload` (its `formatPathAskPrompt` import dies with the export)                                                                                                                                     |
| `src/handlers/gates/external-directory-messages.ts` | **deleted** — both functions become payload builders                                                                                                                                                                          |
| `src/handlers/gates/external-directory.ts`          | builds the payload, derives `message`                                                                                                                                                                                         |
| `src/handlers/gates/bash-external-directory.ts`     | builds the payload, derives `message`                                                                                                                                                                                         |
| `src/handlers/gates/tool.ts`                        | builds the payload; `decisionValue` computed before the payload                                                                                                                                                               |
| `src/handlers/gates/skill-input.ts`                 | builds the payload, derives `message`                                                                                                                                                                                         |
| `src/handlers/gates/skill-read.ts`                  | builds the payload, derives `message`                                                                                                                                                                                         |
| `src/authority/forwarded-request-server.ts`         | `formatForwardedPermissionPrompt` (module-private) replaced by `buildForwardedAskPayload`; `buildForwardedAskDetails` attaches the payload and still projects only `surface` / `matchValues` / `boundaryValue` off the intent |
| `src/authority/permission-prompter.ts`              | `PromptPermissionDetails.payload: PromptPayload` (optional, then required); `writeReviewEntry` unchanged — it keeps logging `details.message`                                                                                 |
| `src/access-intent/bash/command-enumeration.ts`     | `BashCommand.executedUnit?: string`; `makeUnit` accepts it; `classifyWrapperCommand`'s call site invokes `extractExecutedUnit`                                                                                                |
| `src/handlers/gates/bash-command.ts`                | tags `executedUnit` onto the winning result next to `commandContext`                                                                                                                                                          |
| `src/types.ts`                                      | `PermissionCheckResult.executedUnit?: string`                                                                                                                                                                                 |
| `scripts/verify-public-types.sh`                    | add `PromptPayload` to the required-symbol list                                                                                                                                                                               |

### Test files touched

- `test/permission-prompts.test.ts` — string assertions for the three removed functions move to `test/presentation/legacy-message.test.ts` and the builder tests; the file shrinks to the two pre-check reason functions.
- `test/handlers/gates/external-directory-messages.test.ts` — **deleted**; cases split between `test/presentation/path-ask-payload.test.ts` and `test/presentation/legacy-message.test.ts`.
- `test/handlers/external-directory-integration.test.ts:47` — the `formatExternalDirectoryAskPrompt is a callable function` case dies with the export; drop it.
- `test/denial-messages.test.ts`, `test/tool-preview-formatter.test.ts` — local `PermissionCheckResult` builders and `ToolPreviewFormatter` options literals replaced by the shared fixtures.
- `test/handlers/gates/{tool,path,bash-path,external-directory,skill-input,skill-read}.test.ts` and `test/bash-external-directory.test.ts` — keep asserting `promptDetails.message` byte-for-byte, and gain a `promptDetails.payload` assertion.
- `test/authority/{local-user-authorizer,delegation-envelope,authorizer-selection,permission-prompter,forwarded-request-server,authorizer-chain}.test.ts` — six files construct `PromptPermissionDetails` literals; migrated onto `makePromptDetails` in the cycle that makes `payload` required.

### Documentation

- `docs/architecture/architecture.md`:
  - Module tree: add the `src/presentation/` subtree; drop the `external-directory-messages.ts` entry (line ~779); reword the `permission-prompts.ts` entry (line ~818) to pre-check error messages only; add `access-intent/bash/executed-unit.ts`.
  - `## Prompt presentation` section: the "Today five sites still assemble a flat `message` string" paragraph is stale on landing — rewrite it to state that the payload exists and the renderers are next, and correct the count to six.
  - Phase 13 Findings paragraph (line ~866): correct "five sites" to six and name `formatPathAskPrompt`.
  - Step 1 heading and the `S1` Mermaid node marked `✅`, with a `Landed:` note.
  - Health metrics: flat-assembler sites 4 → 0, `src/presentation/` present 0 → 1.
  - Open-issue sweep dispositions: add the PR [#738] line (intent adopted in Step 2, authorship credited, PR closed as superseded).
- ADR 0011 is **not** edited — its "What the code did before this decision" section is a historical record.
- `docs/architecture/v3-architecture.md` is **not** edited (frozen snapshot).
- `.pi/skills/package-pi-permission-system/SKILL.md` — greped for every removed symbol and for `presentation`; no hits, no edit.

## Test Impact Analysis

**Newly possible.**
The payload builders are pure functions over facts, so each surface's *facts* can be asserted directly (`request.matchedPattern`, `request.executedUnit`, evidence labels) instead of only through an English sentence.
`extractExecutedUnit` becomes unit-testable against a parsed node, which no existing test could reach — today the wrapper's inner command is never computed anywhere.
`renderLegacyMessage` is testable from a hand-built payload with no gate, no resolver, and no formatter.

**Becomes redundant.**
`test/permission-prompts.test.ts`'s ~20 `formatAskPrompt` cases and `test/handlers/gates/external-directory-messages.test.ts` in full are string-shape tests of functions that cease to exist.
They are not deleted but **relocated**: each becomes a `renderLegacyMessage` case (same expected string, payload input) plus, where it pins a fact rather than wording, a builder case.
That relocation is what turns them into the completeness proof.

**Must stay as-is.**
The seven gate descriptor tests asserting `promptDetails.message` — they exercise the whole gate → builder → renderer path end to end and are the byte-identity guard for the whole step.
`test/permission-ui-prompt.test.ts` and the authority tests reading `details.message` stay untouched: Step 1 changes no consumer.

## Invariants at Risk

| Invariant                                                                                                            | Source         | Pinned by                                         | Action                                                                                              |
| -------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| An aliased shell tool gates on `bash` while the invoked tool name is preserved for display and the log               | [#574]         | `test/handlers/gates/tool.test.ts`                | `invokedToolName` is additive; the legacy render ignores it, so the message is unchanged            |
| A wrapper's `allow` is floored to `ask` with the `<opaque-bash-wrapper>` / `<indirection-bash-wrapper>` sentinel     | [#481], [#490] | `test/handlers/gates/bash-command.test.ts`        | extraction adds a field to `BashCommand`; it must add or remove no unit and change no `wrapperKind` |
| An unparseable command fails closed to `<unparseable-bash-command>` unless an explicit deny covers it                | [#712]         | `test/handlers/gates/bash-command.test.ts`        | the sentinel flows into `request.matchedPattern` unchanged                                          |
| A forwarded ask's details carry `surface` / `matchValues` / `boundaryValue` and **not** `requesterCwd` / `principal` | [#635]         | `test/authority/forwarded-request-server.test.ts` | add an explicit assertion that the new `payload` smuggles neither                                   |
| The `permissions:ui_prompt` broadcast's forwarded provenance is non-degraded                                         | [#292], [#610] | `test/permission-ui-prompt.test.ts`               | `buildUiPrompt` is untouched in this step                                                           |
| The review log's growth is bounded; a complete payload is never persisted verbatim                                   | ADR 0010       | `test/authority/permission-prompter.test.ts`      | `writeReviewEntry` keeps logging `details.message`; assert the payload is absent from the entry     |

Quantitative invariant: **every rendered `message` is byte-identical**.
The measurement is the existing suite, not an argument — the relocated string assertions run against `renderLegacyMessage`, and the seven descriptor tests run against the full path.
Any deviation is a red test, not a review judgment.

## TDD Order

1. **Tidy-first prep — shared presentation fixtures.**
   Extract `makePermissionCheckResult` and `makeToolPreviewFormatter` into `test/helpers/presentation-fixtures.ts`; migrate the six local factories in `test/denial-messages.test.ts`, `test/permission-prompts.test.ts`, and `test/tool-preview-formatter.test.ts`.
   Suite stays green throughout.
   `test(pi-permission-system): extract shared presentation test fixtures (#744)`
2. **Executed-unit extraction (red → green).**
   `test/access-intent/bash/executed-unit.test.ts`: opaque payloads (`bash -c 'rm x'`, `sh -ec "…"`, `eval "…"`), plain indirection (`sudo aws s3 rm`, `sudo -u root aws s3 rm`, `xargs grep foo`, `xargs -0 -n1 grep foo`, `timeout 10 grep foo`, `nice -n 5 make`, `env FOO=bar grep foo`), exec-conditional (`find . -name '*.ts' -exec grep foo {} \;`, `fd -x rm`), nesting (`sudo timeout 5 xargs grep foo`), and the `null` cases (bare `xargs`, unresolvable remainder, depth cap).
   Green: `src/access-intent/bash/executed-unit.ts`.
   `refactor(pi-permission-system): extract the executed unit of a bash wrapper (#744)`
3. **Carry `executedUnit` to the check result.**
   Red in `test/access-intent/bash/command-enumeration.test.ts` (a wrapper unit carries `executedUnit`; unit count and `wrapperKind` unchanged) and `test/handlers/gates/bash-command.test.ts` (the winning wrapper result carries it).
   Green: `BashCommand.executedUnit`, `makeUnit`, `PermissionCheckResult.executedUnit`, the `resolveBashCommandCheck` tag.
   `refactor(pi-permission-system): carry the wrapper's executed unit on the check result (#744)`
4. **Payload types and the transitional renderer.**
   Red: `test/presentation/legacy-message.test.ts` renders all nine kinds from hand-built payloads, asserting the exact strings the current prompt tests assert.
   Green: `src/presentation/prompt-payload.ts` and `src/presentation/legacy-message.ts` (exhaustive switch, `never` guard).
   No production call site changes yet.
   `refactor(pi-permission-system): add PromptPayload and the transitional message renderer (#744)`
5. **Tool / bash / MCP builder; `describeToolGate` migrated.**
   Red: `test/presentation/tool-ask-payload.test.ts`.
   Green: `src/presentation/tool-ask-payload.ts`; `tool.ts` builds the payload and derives `message`; `formatAskPrompt` removed and `test/permission-prompts.test.ts` migrated in the same commit (removing an export breaks its importers at the type level).
   `refactor(pi-permission-system): build the tool ask payload in the presentation domain (#744)`
6. **Path and external-directory builders; four descriptors migrated.**
   Red: `test/presentation/path-ask-payload.test.ts`.
   Green: `src/presentation/path-ask-payload.ts`; `path.ts`, `bash-path.ts`, `external-directory.ts`, `bash-external-directory.ts` migrated; `formatPathAskPrompt` and `src/handlers/gates/external-directory-messages.ts` removed; `test/handlers/gates/external-directory-messages.test.ts` deleted and the `external-directory-integration.test.ts` callable-function case dropped — all in one commit.
   `refactor(pi-permission-system): build the path ask payloads in the presentation domain (#744)`
7. **Skill builders; two descriptors migrated.**
   Red: `test/presentation/skill-ask-payload.test.ts`.
   Green: `src/presentation/skill-ask-payload.ts`; `skill-input.ts` and `skill-read.ts` migrated; the two skill formatters removed from `permission-prompts.ts` with their tests migrated in the same commit.
   `refactor(pi-permission-system): build the skill ask payloads in the presentation domain (#744)`
8. **Forwarded builder; `payload` tightened to required.**
   Red: `test/presentation/forwarded-ask-payload.test.ts`, plus a `forwarded-request-server.test.ts` case asserting the payload carries no `requesterCwd` / `principal`, and a `permission-prompter.test.ts` case asserting the review entry still logs `message` and not the payload.
   Green: `src/presentation/forwarded-ask-payload.ts`; `forwarded-request-server.ts` migrated; `PromptPermissionDetails.payload` made required; `test/helpers/prompt-details-fixtures.ts` added and the six authority test files migrated onto it; `PromptPayload` added to `scripts/verify-public-types.sh`.
   One commit — tightening an optional field to required breaks every constructor at the type level.
   `refactor(pi-permission-system): require a complete PromptPayload on every ask (#744)`
9. **Documentation.**
   The architecture-doc updates listed above, including the Step 1 `✅` marks and the recomputed health-metric rows.
   `docs(pi-permission-system): record the prompt payload seam and mark Phase 13 Step 1 (#744)`

Every commit is a hidden changelog type.
`refactor:` is correct for cycles 2–8 because no observable behavior changes: the extracted unit is computed but rendered nowhere until Step 2, and the payload's only reader is the renderer that reproduces today's strings.

## Risks and Mitigations

| Risk                                                                                                          | Mitigation                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The curated wrapper flag table is wrong for some invocation, so `executedUnit` misleads on a decision surface | Fail-to-`null` rather than fail-to-guess; display-only and never gating; nothing renders it until Step 2, so a defect cannot reach a user in this step                                                  |
| `renderLegacyMessage`'s label coupling to evidence entries silently drifts                                    | Exhaustive `switch` with a `never` guard, plus the relocated byte-identity suite over every kind; the module is transitional and deleted by Step 4                                                      |
| A relocated string test loses a case during the move                                                          | Cycles 5–7 each move one file's cases and the descriptor tests keep asserting `message` end to end, so a lost case shows as a green-but-thinner suite — check the case count before and after each move |
| Making `payload` required breaks six authority test files at once                                             | Confined to cycle 8, absorbed by a `makePromptDetails` fixture; a new field has no `payload: undefined` literals to hunt                                                                                |
| PR [#738] conflicts with nearly every file this step rewrites                                                 | Disposition decided at planning and recorded in the roadmap; the comment and close are ship-time actions on the PR, and no rebase is attempted                                                          |
| The public `.d.ts` grows without the guard noticing                                                           | `PromptPayload` added to `scripts/verify-public-types.sh`; `pnpm run verify:public-types` in the pre-completion checks                                                                                  |
| `src/presentation/` importing from `src/handlers/` would invert the layering                                  | The gate passes its already-computed decision value in; no builder imports `deriveDecisionValue` or any `handlers/` module                                                                              |

## Open Questions

- Whether `permission-prompts.ts` should be renamed once it holds only the two pre-check reason functions.
  Deferred: Step 4 moves those to the agent renderer, at which point the file disappears rather than being renamed twice.
- The exact depth cap for nested wrapper extraction.
  Chosen at implementation from the test cases; four hops covers every real form surveyed (`sudo timeout … xargs …`).
- Whether `PromptEvidence.detail` earns its keep beyond the external-path disclosure.
  Kept for now because that is a real, current need; Step 2's renderer is the place to revisit it.

[#292]: https://github.com/gotgenes/pi-packages/issues/292
[#306]: https://github.com/gotgenes/pi-packages/issues/306
[#437]: https://github.com/gotgenes/pi-packages/issues/437
[#481]: https://github.com/gotgenes/pi-packages/issues/481
[#490]: https://github.com/gotgenes/pi-packages/issues/490
[#559]: https://github.com/gotgenes/pi-packages/issues/559
[#574]: https://github.com/gotgenes/pi-packages/issues/574
[#610]: https://github.com/gotgenes/pi-packages/issues/610
[#635]: https://github.com/gotgenes/pi-packages/issues/635
[#712]: https://github.com/gotgenes/pi-packages/issues/712
[#713]: https://github.com/gotgenes/pi-packages/issues/713
[#716]: https://github.com/gotgenes/pi-packages/pull/716
[#710]: https://github.com/gotgenes/pi-packages/issues/710
[#738]: https://github.com/gotgenes/pi-packages/pull/738
[#745]: https://github.com/gotgenes/pi-packages/issues/745
[#746]: https://github.com/gotgenes/pi-packages/issues/746
[ADR 0011]: ../decisions/0011-prompt-presentation-contract.md
