---
issue: 746
issue_title: "pi-permission-system: agent-facing and review-log renderers over the prompt payload"
---

# The agent-facing and review-log renderers over the prompt payload

## Release Recommendation

**Release:** ship now — batch "presentation-contract" tail (this issue completes the batch)

Phase 13's `Release batches` subsection names Steps 3 and 4 as batch "presentation-contract", with Step 4 as the tail and Step 3's `feat!:` as the release vehicle.
Step 3 ([#745]) has landed on `main` unreleased; this issue is the tail, so the release-please PR merges after it.
This issue carries breaking commits of its own (the review log's field set and width bound), which join the same major bump.

## Problem Statement

Two consumers of a permission ask still read the pre-rendered `message` string rather than the structured payload ADR 0011 §2 introduced, and each is wrong in its own way.

The agent-facing denial text interpolates the raw tool input on every path.
The same oversized payload that took over the viewport in [#710] is echoed back into the agent's context in full whenever the user denies it — the human's constraint is rows and the agent's is tokens, and one unbounded payload violates both.
ADR 0011 §7 states the fix as a rule about content rather than a size cap: the agent renderer identifies the call; it does not reproduce it.
The agent authored the tool call, so echoing its input back tells it nothing it did not already have; the new information is the verdict.

The review log persists the assembled `message`, so what the log accumulates is a side effect of how a prompt happens to be worded.
`docs/decisions/0010-permission-log-secret-exposure.md` bounds what the logs accumulate, and a prompt sentence written verbatim on every ask is not a bound anyone chose.
ADR 0011 §6 assigns the log its own configured limits, so its growth becomes an explicit decision.

Measured on the operator's live review log (7.07 MB, 9484 entries, 2026-08-16):

| Field              | Share of the log | Entries | Largest single value |
| ------------------ | ---------------- | ------- | -------------------- |
| `message`          | 21.5% (1.52 MB)  | 3904    | 72,784 chars         |
| `command`          | 20.2% (1.49 MB)  | 4325    | 72,391 chars         |
| `toolInputPreview` | 0.1%             | —       | capped at 1000 today |

Command lengths: 1496 entries exceed 200 characters, 607 exceed 400, 188 exceed 1000, 30 exceed 4000.

## Goals

- The agent-facing denial renderer reads the `PromptPayload` and never interpolates the bash command or the raw tool input.
- The renderer still names the flagged element — the path, MCP target, or skill the rule fired on — so a denial is correctable on the first retry.
- The matched pattern, including the wrapper and unparseable-command sentinels, reaches the agent on every verdict, which it does not today for a user denial.
- The operator's `deny`-with-reason text reaches the agent on every surface, not only the tool/bash arm.
- The review log stops persisting `message` and instead records the payload's request facts.
- Every string the review log writes is bounded by a configured `reviewLogFieldMaxWidth`, applied at the single write choke point so no write path can escape it.
- `DenialContext` is dissolved into `PromptPayload`: one payload, five renderers, one discriminant.
- `renderLegacyMessage` and `src/presentation/legacy-message.ts` are deleted — the last `message` reader is this step's, so the transitional module goes with it.
- Breaking: the review log's field set changes and its values acquire a width bound, both observable on upgrade without a user edit.

## Non-Goals

- Decision provenance (`decidedBy`) — Phase 13 Step 6, [#726].
  It lands after this step so its fields ride the new log renderer rather than the retiring `message` shape; this plan does not add it.
- Out-of-process forwarding liveness — Phase 13 Step 5, [#721].
- The annotator and evidence-formatter seams (ADR 0011 §8) — deferred until a downstream consumer exists.
- A configurable log destination — PR [#749] proposes file/stdout routing.
  Orthogonal: it changes where a line goes, not what a line contains.
  This plan does not touch it.
- The skill-input deny path's agent-facing text.
  `handleInput` returns `{ action: "handled" }` (`src/handlers/permission-gate-handler.ts:104-106`) and discards the formatted reason, so nothing agent-facing is delivered there today.
  The renderer keeps producing a `skill` arm for uniformity; wiring that string somewhere is out of scope.
- Logging `annotations` to the review log.
  The slot is empty until §8's seam exists, and adding it later is a growth decision of its own.
- `src/permission-prompts.ts` (the pre-check reasons for a missing or unregistered tool name).
  Those are not payload renders — no payload exists at that point — and stay as they are.

## Background

### Where Phase 13 stands

Steps 1–3 have landed.
Every gate emits a `PromptPayload` (`src/presentation/prompt-payload.ts`), `PromptPermissionDetails.payload` is required, `renderPromptDialog` bounds the human-facing render, and the forwarded wire and `permissions:ui_prompt` broadcast carry facts rather than prose.

`message` now has exactly two readers, and both are review-log writes:

- `PermissionPrompter.writeReviewEntry` (`src/authority/permission-prompter.ts:152`) writes `message: details.message` on the `waiting` / `approved` / `denied` entries.
- Six gate descriptors put `message: askMessage` into `logContext`, which `GateRunner` and `applyPermissionGate` write on the `session_approved` / `auto_approved` / `blocked` entries.

`src/presentation/legacy-message.ts` says so at its declaration: "this module goes when the last `message` reader does".
`grep -rn "renderLegacyMessage" packages/pi-permission-system/src --include="*.ts" | wc -l` is **17** today.

### The two parallel unions

`GateDescriptor` (`src/handlers/gates/descriptor.ts`) carries both `denialContext: DenialContext` (a 7-arm union in `src/denial-messages.ts`) and `promptDetails.payload: PromptPayload` (a 9-arm union).
`PromptPayloadKind`'s own declaration says it "mirrors `DenialContext`'s discriminated union, the shape ADR 0011 §7 names as already correct".

Every field `DenialContext` holds that the payload lacks is a field §7 forbids the agent renderer from showing:

| `DenialContext` field                          | Payload equivalent                                  |
| ---------------------------------------------- | --------------------------------------------------- |
| `path.toolName` / `pathValue`                  | `request.toolName` / `request.value`                |
| `external_directory.resolvedPath` / `cwd`      | evidence `resolves to` / `working directory`        |
| `bash_external_directory.externalPaths`        | evidence `external path` with its `detail`          |
| `skill_read.readPath`                          | evidence `read path`                                |
| `tool.check.matchedPattern` / `commandContext` | `request.matchedPattern` / `request.commandContext` |
| `bash_path.command`                            | none — the command §7 forbids echoing               |
| `tool.input`                                   | none — already unread by any body builder           |

The one genuine gap is `check.reason`, the operator's `deny`-with-reason string.
It is not a payload fact (a deny never prompts, so no human render wants it) and today it renders only on the tool/bash arm.
`GateRunner.runDescriptor` holds the resolved `check` at the point it constructs the denial messages, so passing `check.reason` as an argument both closes the gap and generalizes it to every surface.

### How a denial reaches the agent

Verified against the sibling Pi checkout at `../pi` (`9d2ec7ffa`).

`createFailClosedToolCall` returns `{ block: true, reason }` (`src/handlers/tool-call-boundary.ts:52`).
Pi wraps that reason with `createErrorToolResult` (`packages/agent/src/agent-loop.ts:637-641`), and `createToolResultMessage` stamps it with `toolCallId: finalized.toolCall.id` (`agent-loop.ts:779`).
In the parallel-tool-call loop (`agent-loop.ts:489-532`) a blocked call is finalized with its own `toolCall` intact, so its result pairs to its own id even when the turn issued several calls.
The assistant message carrying every `toolCall` block — including its full arguments — stays in `currentContext.messages` and is sent to the provider through `convertToLlm` (`agent-loop.ts:195, 219-221, 295`).

So correlation is structural: the model sees the denial as that call's result, with that call's arguments beside it.
The renderer does not have to echo anything for the agent to know which call was refused.
What the renderer must still supply is which of the call's *operands* tripped the gate — one bash command can carry several path tokens, and that granularity is below the tool call.

### Constraints from AGENTS.md and the package skill

- The new config field must travel `config-schema.ts` → `pnpm run gen:schema` → `extension-config.ts` → `mergeUnifiedConfigs()`'s number-scalar loop, or it is silently dropped before runtime (the #332 / #347 class).
- Do not add a log write path that bypasses `writeLine` in `src/logging.ts`.
  The same reasoning applies to the new width bound: it belongs at that choke point, not at each producer.
- Redaction is structural and key-name based (`docs/decisions/0010-permission-log-secret-exposure.md`).
  A width cap is a quantity bound applied uniformly and must never read a value to decide what to shorten, or it has become redaction by another name — the boundary [#710] drew for the dialog.
- `docs/architecture/architecture.md` inline-copies presentation module entries; a module move updates the tree.
- The roadmap step's `✅` marks (heading and Mermaid node) plus the `Landed:` note land in the implementation doc-update commit, not at ship time.

## Design Overview

### The agent-facing renderer

`src/denial-messages.ts` is replaced by `src/presentation/agent-renderer.ts`, which renders a `PromptPayload` plus the verdict's own reason.

```typescript
/** The agent-facing render of a policy deny (ADR 0011 §7). */
export function renderPolicyDenial(
  payload: PromptPayload,
  ruleReason: string | null,
): string;

/** The agent-facing render of a human's denial at an interactive prompt. */
export function renderUserDenial(
  payload: PromptPayload,
  denialReason: string | null,
): string;

/** The agent-facing render when no live authority could answer the ask. */
export function renderUnavailableDenial(
  payload: PromptPayload,
  denialReason: string | null,
): string;
```

Each returns `${EXTENSION_TAG} ${body}`, and `EXTENSION_TAG` moves here from `denial-messages.ts`.

The body is assembled from clauses in a fixed order.
Every clause is omitted when its fact is absent, so no arm needs its own sentence template:

| Clause           | Source                                               | Rendered as                                              |
| ---------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| verdict          | the calling site                                     | `Denied by policy:` / `The user denied this` / `This`    |
| surface          | `request.surface`                                    | `'<surface>'`                                            |
| call             | the verdict                                          | `call` for the user and unavailable verdicts             |
| tool             | `request.toolName`, when it differs from the surface | `for tool '<toolName>'`                                  |
| invoked as       | `request.invokedToolName`                            | `(invoked as '<invokedToolName>')`                       |
| flagged          | `flaggedElements(payload)`, minus the command        | `for <label> '<value>'`                                  |
| rule             | `request.matchedPattern`                             | `(rule '<pattern>')`                                     |
| context          | `request.commandContext`                             | `inside command substitution`                            |
| boundary         | evidence `working directory`                         | `: <flagged> outside working directory '<cwd>'`          |
| unavailable tail | the verdict                                          | `requires approval, but no interactive UI is available.` |
| rule reason      | `check.reason`                                       | `Reason: <text>.`                                        |
| denial reason    | the decision's `denialReason`                        | `Reason: <text>.`                                        |

The flagged element is the one departure from a literal reading of §7's "needs no separate size bound".
A path is agent input, so it is capped at `promptFieldMaxWidth` (default 400) with the same bare-ellipsis marker the dialog uses.
The reading this plan settles, and which the module documents at its declaration: *identifying* the call includes naming which of its operands the rule fired on; *reproducing* it means echoing the command or the tool-input body, which the renderer never does.
This mirrors the reading Step 2 settled for §3 against §5.

Which element is flagged is shared with the dialog renderer rather than restated:

```typescript
// src/presentation/fact-vocabulary.ts
/** What the ask flags: the value the rule fired on, or the escaping paths. */
export function flaggedElements(payload: PromptPayload): readonly string[];
/** What that element is called, per ask shape ("path", "target", "skill", …). */
export function flaggedElementLabel(payload: PromptPayload): string;
/** Human-readable label for a nested bash execution context. */
export function describeBashCommandContext(
  context: BashCommandContext | null,
): string | undefined;
```

`flaggedElements` is `dialog-renderer.ts`'s existing private `flaggedTexts`, promoted; `flaggedElementLabel` is its private `valueLabel`; `describeBashCommandContext` relocates out of `denial-messages.ts`, which both renderers already read.
The agent renderer drops the flagged clause for `kind: "bash"` (the flagged element is the command), for `kind: "tool"` (the value is the tool name an earlier clause already stated), and for `kind: "forwarded"` (a payload-less relay whose value shape is unknown, and which the agent renderer is never reached with — the child renders its own denial from its own payload).

Worked examples, with the tool call that produced each:

```text
bash({"command": "rm -rf build"})              under bash: {"rm *": "deny"}
  [pi-permission-system] Denied by policy: 'bash' (rule 'rm *').

read({"path": "/etc/passwd"})                  user denies, reason "not that file"
  [pi-permission-system] The user denied this 'path' call for tool 'read' for
  path '/etc/passwd' (rule '/etc/*'). Reason: not that file.

bash({"command": "cp config.yaml /etc/app/config.yaml"})  path: {"/etc/**": "deny"}
  [pi-permission-system] Denied by policy: 'path' for tool 'bash' for path
  '/etc/app/config.yaml' (rule '/etc/**').

bash({"command": "diff /etc/hosts ~/.ssh/known_hosts > /tmp/out"})
  [pi-permission-system] Denied by policy: 'external_directory' for tool 'bash'
  (rule '*'): paths '/etc/hosts', '~/.ssh/known_hosts' are outside working
  directory '/repo'.

bash({"command": "sudo aws s3 rm s3://bucket --recursive"})  user denies
  [pi-permission-system] The user denied this 'bash' call
  (rule '<indirection-bash-wrapper>'). Reason: not with sudo.

bash({"command": "cat <<'EOF' > gen.py\n…72 KB…\nEOF"})     user denies
  [pi-permission-system] The user denied this 'bash' call (rule '*').
```

The last case is the defect: 72 KB of echoed input becomes one line.
The sudo case gains the sentinel, which today's user-denied text drops entirely.

### The descriptor's single presentation fact

`GateDescriptor` loses `denialContext` and gains `payload`, which the runner stamps onto the prompt call exactly as it stamps `requestId`:

```typescript
export interface GateDescriptor {
  surface: string;
  input: unknown;
  /** The complete structured description of this ask — the one presentation fact. */
  payload: PromptPayload;
  promptDetails: Omit<PromptPermissionDetails, "requestId" | "payload">;
  // …unchanged fields
}
```

The runner's message construction becomes:

```typescript
const { payload } = descriptor;
const messages = {
  denyReason: renderPolicyDenial(payload, check.reason ?? null),
  unavailableReason: (decision: PermissionPromptDecision) =>
    renderUnavailableDenial(payload, decision.denialReason ?? null),
  userDeniedReason: (decision: PermissionPromptDecision) =>
    renderUserDenial(payload, decision.denialReason ?? null),
};
```

and the escalation call gains `payload: descriptor.payload` beside `requestId`.
This keeps the payload at one hop from the runner and gives it one home on the descriptor, rather than two fields holding the same object.

### The review-log renderer

```typescript
// src/presentation/review-log-renderer.ts
/**
 * The payload facts the review log persists (ADR 0011 §6).
 *
 * Request facts only — no evidence and no annotations, so what the log
 * accumulates does not grow past what `message` already implied.
 */
export function renderReviewLogFacts(
  payload: PromptPayload,
): Record<string, unknown>;
```

It emits the request facts the log does not already carry, omitting a `null`:

```typescript
{
  surface: string;
  matchedPattern?: string;
  executedUnit?: string;
  commandContext?: BashCommandContext;
  invokedToolName?: string;
  forwarded?: true;
  requesterSessionId?: string;
}
```

`toolName`, `command`, `path`, `target`, `agentName`, and `toolInputPreview` stay where they are — the gates already write them, and duplicating them under a second name would grow the log rather than shrink it.
Two of the emitted fields close real gaps: a `permission_request.blocked` entry records `resolution: "policy_denied"` today but not which rule denied, and `executedUnit` ([#713]'s fact) has never reached the log.

Both write sites call it:

```typescript
// PermissionPrompter.writeReviewEntry
this.deps.logger.review(event, {
  requestId: details.requestId,
  source: details.source,
  agentName: details.agentName,
  ...renderReviewLogFacts(details.payload),
  toolCallId: details.toolCallId ?? null,
  // …the existing structured fields, minus `message`
});

// each gate's descriptor
logContext: {
  source: "tool_call",
  toolCallId: tcc.toolCallId,
  toolName: tcc.toolName,
  ...renderReviewLogFacts(payload),
  ...permissionLogContext,
},
```

### The width bound at the write choke point

`writeLine` in `src/logging.ts` is the only place a log line is produced, and it is already the choke point redaction runs at.
The width bound goes there, on the `review` stream only — the debug log is opt-in and exists to be read in full.

```typescript
// src/log-field-cap.ts
export const DEFAULT_REVIEW_LOG_FIELD_MAX_WIDTH = 1000;

/** The configured review-log field width, falling back to the default. */
export function resolveReviewLogFieldWidth(config: {
  reviewLogFieldMaxWidth?: number;
}): number;

/**
 * Narrow every string in a log-detail record to `maxWidth`, marking a shortened
 * value with a trailing ellipsis.
 *
 * A quantity bound applied uniformly, never a content filter: it does not read
 * a value to decide what to hide, which is what keeps it a cap rather than
 * redaction (ADR 0010). It recurses through plain objects and arrays and
 * touches strings only.
 */
export function capLogFieldWidths(
  details: Record<string, unknown>,
  maxWidth: number,
): Record<string, unknown>;
```

`writeLine` applies `capLogFieldWidths` before `redactedJsonStringify`, so a sensitive-keyed value is still masked whole regardless of its length — the cap and the mask are independent, and the ADR 0010 boundary is unchanged.

The default 1000 is not a new number: it is today's `TOOL_INPUT_LOG_PREVIEW_MAX_LENGTH`, which already bounds `toolInputPreview`.
Moving that bound to the writer makes it uniform and lets `ToolPreviewFormatterOptions.toolInputLogPreviewMaxLength` and its constant go, so the log has one bound rather than one bound plus an unbounded remainder.

Predicted effect on the measured log, computed from the same 7.07 MB file: removing `message` saves 21.5%, and capping every field at 1000 saves a further 7.1% (all of it from `command`), for **28.7%**.
At the same default, 188 of 4325 command entries (4.3%) are shortened.
A raised `reviewLogFieldMaxWidth` restores the full value; there is no unbounded setting, by design.

The config field follows the established path:

```typescript
// extension-config.ts
/** Max characters of any one value written to the permission review log. Defaults to 1000. */
reviewLogFieldMaxWidth?: number;
```

### Consumer sketch

`SessionLoggerDeps.getConfig()` already returns the live `PermissionSystemExtensionConfig`, and `createPermissionSystemLogger` already holds that closure, so the writer reads the configured width per call without a new collaborator:

```typescript
const review = (event, details = {}) => {
  const config = options.getConfig();
  if (!config.permissionReviewLog) return undefined;
  return writeLine("review", reviewLogPath, event, details, {
    maxFieldWidth: resolveReviewLogFieldWidth(config),
  });
};
```

A mid-session config change therefore takes effect on the next line, matching how `permissionReviewLog` and `debugLog` already behave.

## Module-Level Changes

### Added

- `packages/pi-permission-system/src/presentation/agent-renderer.ts` — `EXTENSION_TAG`, `renderPolicyDenial`, `renderUserDenial`, `renderUnavailableDenial`.
- `packages/pi-permission-system/src/presentation/fact-vocabulary.ts` — `flaggedElements`, `flaggedElementLabel`, `describeBashCommandContext`; the render vocabulary both the dialog and the agent renderer read.
- `packages/pi-permission-system/src/presentation/review-log-renderer.ts` — `renderReviewLogFacts`.
- `packages/pi-permission-system/src/log-field-cap.ts` — `DEFAULT_REVIEW_LOG_FIELD_MAX_WIDTH`, `resolveReviewLogFieldWidth`, `capLogFieldWidths`.
- `packages/pi-permission-system/docs/migration/0746-review-log-fields.md` — the breaking-change note.
- `packages/pi-permission-system/test/presentation/agent-renderer.test.ts`, `test/presentation/fact-vocabulary.test.ts`, `test/presentation/review-log-renderer.test.ts`, `test/log-field-cap.test.ts`.

### Removed

- `packages/pi-permission-system/src/denial-messages.ts` — `DenialContext`, `formatDenyReason`, `formatUnavailableReason`, `formatUserDeniedReason`, `matchQualifier`, `resolvesToSuffix`. `ExternalPathDisclosure` relocates to `src/presentation/path-ask-payload.ts`; `EXTENSION_TAG` and `describeBashCommandContext` relocate as above.
- `packages/pi-permission-system/src/presentation/legacy-message.ts` — `renderLegacyMessage` and its private fragment helpers.
- `packages/pi-permission-system/test/denial-messages.test.ts` (728 lines) and `test/presentation/legacy-message.test.ts` (344 lines).
- `PromptPermissionDetails.message` (`src/authority/permission-prompter.ts`).
- `GateDescriptor.denialContext` (`src/handlers/gates/descriptor.ts`).
- `ToolPreviewFormatterOptions.toolInputLogPreviewMaxLength` and `TOOL_INPUT_LOG_PREVIEW_MAX_LENGTH` (`src/tool-preview-formatter.ts`, `src/tool-input-preview.ts`).

### Changed — source

- `src/handlers/gates/descriptor.ts` — `denialContext` → `payload: PromptPayload`; `promptDetails` becomes `Omit<PromptPermissionDetails, "requestId" | "payload">`.
- `src/handlers/gates/runner.ts` — imports the three payload renderers, passes `check.reason`, stamps `payload` onto the escalation call beside `requestId`.
- `src/handlers/gates/tool.ts`, `path.ts`, `external-directory.ts`, `bash-external-directory.ts`, `bash-path.ts`, `skill-input.ts`, `skill-read.ts` — build `payload` once, drop `denialContext`, drop `message` from `promptDetails` and `logContext`, spread `renderReviewLogFacts(payload)` into `logContext`, drop the `renderLegacyMessage` import.
- `src/authority/permission-prompter.ts` — `writeReviewEntry` spreads `renderReviewLogFacts(details.payload)` in place of `message`.
- `src/authority/forwarded-request-server.ts` — drops the `message: renderLegacyMessage(payload)` line and its import.
- `src/presentation/dialog-renderer.ts` — `flaggedTexts` / `valueLabel` / `describeBashCommandContext` come from `fact-vocabulary.ts`.
- `src/presentation/path-ask-payload.ts` — owns `ExternalPathDisclosure`.
- `src/logging.ts` — `writeLine` takes an optional field-width bound; `review` supplies it, `debug` does not.
- `src/tool-preview-formatter.ts` — `getToolInputPreviewForLog` and `formatGenericToolInputForLog` stop truncating; `resolveToolPreviewLimits`'s doc comment loses its "until [#746]" clause.
- `src/config-schema.ts` — `reviewLogFieldMaxWidth` with `description` / `markdownDescription`.
- `schemas/permissions.schema.json` — regenerated by `pnpm run gen:schema` (never hand-edited).
- `src/extension-config.ts` — the field on `PermissionSystemExtensionConfig` plus its `normalizePermissionSystemConfig` passthrough; **not** in `DEFAULT_EXTENSION_CONFIG`, which `deepEqual` tests pin.
- `src/config-loader.ts` — the field added to the number-scalar loop (line 223).
- `config/config.example.json` — `reviewLogFieldMaxWidth: 1000` beside the prompt budgets.

### Changed — tests

- `test/handlers/gates/runner.test.ts`, `test/handlers/external-directory-integration.test.ts` — `EXTENSION_TAG` import path and the asserted denial strings.
- `test/bash-external-directory.test.ts` — `ExternalPathDisclosure` import path; drops its `renderLegacyMessage` import.
- `test/presentation/tool-ask-payload.test.ts`, `path-ask-payload.test.ts`, `skill-ask-payload.test.ts` — assertions move from the rendered legacy string to the payload's own fields.
- `test/helpers/presentation-fixtures.ts` — drops `TOOL_INPUT_LOG_PREVIEW_MAX_LENGTH`.
- `test/helpers/gate-fixtures.ts` — `makeDescriptor` / `makeDenialDescriptor` build a `payload` rather than a `denialContext`. `makeDenialDescriptor`'s reason for existing (a caller-supplied `DenialContext`) goes; confirm whether it collapses into `makeDescriptor`.
- `test/logging.test.ts`, `test/session-logger.test.ts` — the review-stream width bound, the debug stream's exemption, and cap-before-redaction.
- `test/config-loader.test.ts`, `test/extension-config.test.ts`, `test/config-schema.test.ts` — the new field survives merge, normalization, and schema parity.
- Any test constructing a `PromptPermissionDetails` literal: `message` is a **removed required field**, so grep `message:` across `test/` and the `test/helpers/` factories — a shared fixture is the common miss.

### Changed — docs

- `docs/architecture/architecture.md` — the `denial-messages.ts` and `legacy-message.ts` module-tree entries replaced by `agent-renderer.ts`, `fact-vocabulary.ts`, `review-log-renderer.ts`; the new `log-field-cap.ts` entry; the "Prompt presentation" narrative paragraph that ends "The review log is the last `message` reader, so `renderLegacyMessage` survives until Step 4 ([#746])"; the `toolInputPreviewMaxLength` sentence that claims the built-in constants "still bound the evidence the review log persists verbatim"; Phase 13 Step 4's `✅` on the heading and its Mermaid node, plus a `Landed:` note; a new health-metric row (below).
- `docs/configuration.md` — the `reviewLogFieldMaxWidth` row; the `permissionReviewLog` row's "Records bash command strings verbatim"; line 963's bounded-`toolInputPreview` bullet; line 969's "the complete bash command string for every bash decision"; line 985's "logged verbatim".
- `docs/troubleshooting.md:54` — "The review log records bash command strings verbatim."
- `README.md` — a migration-table row for `docs/migration/0746-review-log-fields.md`.
- `.pi/skills/package-pi-permission-system/SKILL.md` — the "Log writes" section gains the width bound at `writeLine` and its relationship to redaction; the Debugging section's review-log mining tip (#694) gains the caveat that a command longer than the configured width is stored shortened; the `promptMaxRows` / `promptFieldMaxWidth` sentence in Configuration gains `reviewLogFieldMaxWidth`.

### Health metric

Add one row to Phase 13's table, with the baseline measured at this step (the precedent Steps 9 and 10 set for mid-phase rows):

| Metric                                                          | Baseline (2026-08-16) | Phase 13 target |
| --------------------------------------------------------------- | --------------------- | --------------- |
| Legacy `message` render sites (`renderLegacyMessage` in `src/`) | 17                    | 0               |

Recompute command: `grep -rn "renderLegacyMessage" packages/pi-permission-system/src --include="*.ts" | wc -l`.

## Test Impact Analysis

**What the change enables.**
`renderReviewLogFacts` and `capLogFieldWidths` are pure functions over data, so the log's content decision and its width bound each get direct unit tests for the first time — today both are implicit in whatever string an assembler produced.
`agent-renderer.test.ts` can enumerate kind × verdict exhaustively against a payload literal, where `denial-messages.test.ts` had to build seven differently-shaped context literals.

**What becomes redundant.**
`test/presentation/legacy-message.test.ts` (344 lines) exists to prove the payload reproduces six retired assemblers byte for byte.
That proof was the transition's, and it retires with the string.
`test/denial-messages.test.ts` (728 lines) is replaced wholesale by `agent-renderer.test.ts`; its coverage map carries over, but almost none of its assertions do, because the rendered text is deliberately different.

**What must stay.**
The three payload-builder suites stay, but their assertion vehicle changes: today they call `renderLegacyMessage` and match a sentence, and they must instead assert the payload's fields.
That is a strictly stronger assertion — a builder test asserting a downstream render can pass while a field it never reads is wrong — and it is the migration that preserves Step 1's "every ask carries a complete payload" guarantee once the legacy oracle is gone.
`test/presentation/dialog-renderer.test.ts` stays untouched in intent; only the `fact-vocabulary` extraction's imports move under it.
`test/handlers/gates/runner.test.ts`'s `EXTENSION_TAG` assertions stay — they pin that every block reason is attributed to this extension, which no other test does.

## Invariants at risk

| Invariant                                                                                   | Where it was established                                | What pins it                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The payload is complete — every fact the six retired assemblers stated is on it             | Step 1 ([#744]), proven by the legacy-message suite     | Migrated payload-builder assertions (per-field), plus the three renderer suites, which between them read every `request` field and every evidence label. This plan removes the existing proof, so the replacement is the gating deliverable of the deletion step.                                              |
| The [#710] ask renders inside the 24-row default                                            | Step 2, re-measured at the Step 3 shape                 | `dialog-renderer.test.ts`'s row-budget cases. The `fact-vocabulary` extraction moves `flaggedTexts` and `valueLabel` out of the module; if the highlight or label behavior changes, those tests fail. Extraction is pure relocation — no signature change beyond `commandContext: BashCommandContext \| null`. |
| A value bound to a sensitive key name is masked; a secret embedded in a bash command is not | `docs/decisions/0010-permission-log-secret-exposure.md` | New `logging.test.ts` cases: a sensitive-keyed value longer than the cap is masked whole, not truncated-then-masked into a partial secret; a long `command` is shortened, never masked.                                                                                                                        |
| The width bound is a cap, not redaction                                                     | ADR 0011 §4/§5, and Step 2's reading                    | `log-field-cap.test.ts`: the cap is applied uniformly by length and never inspects a value's content; identical-length values of different shapes are treated identically.                                                                                                                                     |
| Every log line goes through `writeLine`                                                     | Package skill, "Log writes"                             | The bound lives inside `writeLine`, so a new write path cannot bypass it without bypassing the writer. No new test needed; the placement is the guarantee.                                                                                                                                                     |
| The review log is minable for real bash commands (#694's method)                            | Package skill, "Debugging"                              | Measured, not argued: at the 1000 default, 188 of 4325 command entries (4.3%) are shortened. Recorded in the skill and the migration note, with `reviewLogFieldMaxWidth` as the lever.                                                                                                                         |

## TDD Order

1. **Extract the shared render vocabulary.**
   Red: `test/presentation/fact-vocabulary.test.ts` — `flaggedElements` per payload kind (including the `bash_external_directory` multi-path arm and an empty `value`), `flaggedElementLabel` per kind, `describeBashCommandContext` for each context and for `null`.
   Green: new `src/presentation/fact-vocabulary.ts`; `dialog-renderer.ts` imports `flaggedElements` / `flaggedElementLabel` / `describeBashCommandContext` from it; `denial-messages.ts` imports `describeBashCommandContext` from it and re-exports nothing.
   Commit: `refactor(pi-permission-system): extract the shared payload render vocabulary (#746)`.

2. **Add the agent renderer beside the old one.**
   Red: `test/presentation/agent-renderer.test.ts` — every payload kind × the three verdicts, plus the sentinel patterns (`<indirection-bash-wrapper>`, `<opaque-bash-wrapper>`, `<unparseable-bash-command>`), the nested-context clause, the resolved-alias clause, the flagged-element cap at `promptFieldMaxWidth`, the operator rule reason, and the human denial reason.
   Green: new `src/presentation/agent-renderer.ts`.
   Nothing imports it yet; it takes `EXTENSION_TAG` from `denial-messages.ts` for this step.
   Commit: `refactor(pi-permission-system): add the payload-driven agent-facing denial renderer (#746)`.

3. **Wire it and delete `denial-messages.ts`.**
   Red: `test/handlers/gates/runner.test.ts` asserts the runner renders from `descriptor.payload` and passes `check.reason`; a new case asserts an operator `deny`-with-reason renders on a non-tool surface (a `path` deny), which fails today.
   Green: `GateDescriptor.denialContext` → `payload`; `promptDetails` narrows to `Omit<…, "requestId" | "payload">`; the runner stamps `payload` and calls the three renderers; all seven descriptor builders updated; `EXTENSION_TAG` moves into `agent-renderer.ts`; `ExternalPathDisclosure` moves into `path-ask-payload.ts`; `matchQualifier` and `resolvesToSuffix` become private helpers inside `legacy-message.ts` (its only remaining callers) and die with it in step 7; `denial-messages.ts` and `test/denial-messages.test.ts` deleted; `gate-fixtures.ts`, `bash-external-directory.test.ts`, and `external-directory-integration.test.ts` updated.
   One step because removing an export breaks every importer at the type level in the same commit.
   Commit: `fix(pi-permission-system): stop echoing tool input in agent-facing denial text (#746)`.

4. **Add the review-log renderer.**
   Red: `test/presentation/review-log-renderer.test.ts` — the emitted field set per kind, `null` facts omitted rather than written as `null`, forwarded provenance present only for a forwarded payload, no evidence and no annotations in the output.
   Green: new `src/presentation/review-log-renderer.ts`.
   Not wired yet.
   Commit: `refactor(pi-permission-system): add the review-log renderer over the prompt payload (#746)`.

5. **Bound review-log field width.**
   Red: `test/log-field-cap.test.ts` (uniform length cap, ellipsis marker, recursion through plain objects and arrays, non-strings untouched); `test/logging.test.ts` (the review stream caps, the debug stream does not, a sensitive-keyed value is still masked whole); `test/config-loader.test.ts` / `test/extension-config.test.ts` / `test/config-schema.test.ts` (the field survives merge, normalization, and schema parity).
   Green: `src/log-field-cap.ts`; `config-schema.ts` + `pnpm run gen:schema`; `extension-config.ts`; the `config-loader.ts` number-scalar loop; `config/config.example.json`; `writeLine`'s optional bound; `ToolPreviewFormatter` and `tool-input-preview.ts` drop the log-preview cap and its constant; `test/helpers/presentation-fixtures.ts` follows.
   Commit: `feat(pi-permission-system)!: bound review-log field width with reviewLogFieldMaxWidth (#746)`, with a `BREAKING CHANGE:` footer naming the new default and the config lever.

6. **Render the review log from the payload.**
   Red: `test/authority/permission-prompter.test.ts` (or its current home) asserts the review entry carries `surface` / `matchedPattern` / `executedUnit` and no `message`; a gate test asserts `permission_request.blocked` now records the matched rule.
   Green: `PermissionPrompter.writeReviewEntry` and all seven `logContext` builders spread `renderReviewLogFacts(payload)` and drop `message`.
   `PromptPermissionDetails.message` still exists and is still written — nothing reads it after this commit.
   Commit: `feat(pi-permission-system)!: render the review log from the prompt payload (#746)`, with a `BREAKING CHANGE:` footer naming the removed `message` field, the superseding fields, and `docs/migration/0746-review-log-fields.md`.

7. **Delete the legacy message.**
   Red: none — the deletion is proven by the suite staying green with the migrated payload-builder assertions from this step.
   Green: remove `PromptPermissionDetails.message`, every `message:` producer in the seven descriptors and `forwarded-request-server.ts`, `src/presentation/legacy-message.ts`, and `test/presentation/legacy-message.test.ts`; migrate `tool-ask-payload.test.ts`, `path-ask-payload.test.ts`, and `skill-ask-payload.test.ts` off the legacy oracle onto direct payload-field assertions; grep `message:` across `test/` for `PromptPermissionDetails` literals and shared factories.
   One step because removing a required interface field breaks every constructor at once.
   Verify: `grep -rn "renderLegacyMessage" packages/pi-permission-system/src --include="*.ts" | wc -l` is `0`.
   Commit: `refactor(pi-permission-system): remove the transitional prompt message string (#746)`.

8. **Docs and roadmap.**
   Green: the architecture module tree, the prompt-presentation narrative, the Phase 13 Step 4 `✅` marks and `Landed:` note, the new health-metric row; `docs/configuration.md`; `docs/troubleshooting.md`; `docs/migration/0746-review-log-fields.md`; the `README.md` migration row; the package skill.
   Commit: `docs(pi-permission-system): record the agent and review-log renderers (#746)`.

## Risks and Mitigations

| Risk                                                                                                                  | Mitigation                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deleting the legacy-message suite removes the standing proof that the payload is complete.                            | Step 7 migrates the three payload-builder suites to per-field assertions in the same commit as the deletion, and the step is not green until they cover what the legacy assertions did. The renderer suites (dialog, agent, review-log) read every `request` field between them.                               |
| The agent-renderer grammar is new prose replacing 728 lines of assertions, so a kind or verdict can be under-covered. | Step 2's suite enumerates kind × verdict exhaustively before anything is wired, including the three synthetic sentinels and the nested-context clause.                                                                                                                                                         |
| A recursive width cap could mangle non-string log values or drop keys.                                                | `capLogFieldWidths` touches strings only and recurses through plain objects and arrays; `log-field-cap.test.ts` pins numbers, booleans, `null`, and nested shapes as passed through unchanged.                                                                                                                 |
| Capping before redaction could truncate a secret into a partial that then fails key-name masking.                     | Masking replaces the value wholesale by key name, so order does not matter for a masked field; `logging.test.ts` pins that a sensitive-keyed value longer than the cap is fully masked.                                                                                                                        |
| `reviewLogFieldMaxWidth` silently dropped before runtime (the #332 / #347 class).                                     | Step 5 adds it to `mergeUnifiedConfigs`'s number-scalar loop and pins it with a `config-loader.test.ts` merge case; `normalizePermissionSystemConfig` reads the typed `UnifiedPermissionConfig`, so an omission is a compile error.                                                                            |
| The `!` on two commits produces two changelog breaking entries.                                                       | Intentional: they are two distinct breaks (a width bound, a removed field). Each footer names its own change and both point at the one migration doc.                                                                                                                                                          |
| A capped `command` degrades the review-log mining workflow the package skill documents (#694).                        | Measured: 4.3% of command entries are shortened at the default. Recorded in the skill and the migration note, with `reviewLogFieldMaxWidth` as the lever to restore full values.                                                                                                                               |
| The flagged-element clause reintroduces agent input into the denial text, against §7's structural-bound argument.     | The command and the tool-input body are never rendered — only the path, target, or skill the rule fired on — and that value is capped at `promptFieldMaxWidth`. The reading is documented at the module declaration and in the roadmap's `Landed:` note, following the precedent Step 2 set for §3 against §5. |

## Open Questions

- Whether ADR 0011 §7 should carry an amendment recording the flagged-element reading, or whether the module declaration plus the roadmap `Landed:` note suffice.
  Steps 2 and 3 both settled readings without amending the accepted record; this plan follows that precedent and leaves the question open for a later ADR pass.
- Whether `annotations` should ever reach the review log once ADR 0011 §8's annotator seam exists.
  Deferred until the seam has a consumer; it is a growth decision of its own.
- Whether `makeDenialDescriptor` (`test/helpers/gate-fixtures.ts`) survives once `DenialContext` is gone, or collapses into `makeDescriptor`.
  Settled during step 3 against the actual call sites.
- Whether `permission_request.blocked`'s newly recorded `matchedPattern` should also carry the rule's origin scope, which the decision event already emits.
  Not needed for this step; a candidate for [#726]'s provenance work.

[#710]: https://github.com/gotgenes/pi-packages/issues/710
[#713]: https://github.com/gotgenes/pi-packages/issues/713
[#721]: https://github.com/gotgenes/pi-packages/issues/721
[#726]: https://github.com/gotgenes/pi-packages/issues/726
[#744]: https://github.com/gotgenes/pi-packages/issues/744
[#745]: https://github.com/gotgenes/pi-packages/issues/745
[#749]: https://github.com/gotgenes/pi-packages/pull/749
