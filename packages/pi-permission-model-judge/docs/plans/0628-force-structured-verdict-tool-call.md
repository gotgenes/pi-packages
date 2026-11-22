---
issue: 628
issue_title: "pi-permission-model-judge reaches the model but defers on parse-failed — force a structured tool call"
---

# Force a structured verdict tool call in the model-judge review

## Release Recommendation

**Release:** ship independently

This package has no architecture roadmap and no release-batch membership.
The change is a standalone bug fix that completes the #625 → #626 → #628 sequence (auth → observability → reply-format robustness); ship it on its own.

## Problem Statement

With #625's auth fix and #626's decision trail both landed, a doubled-package typo path now reaches the model and the model replies — but the decision trail records `verdict: "defer"`, `deferReason: "parse-failed"`.
`reviewPath` (`src/model-review.ts`) requires the entire trimmed assistant text to be valid JSON; the model wrapped its object in a Markdown fence or a prose preamble, so `JSON.parse` throws and the verdict is lost.
The fix is to stop parsing free text: hand the model a single verdict tool, force it with `toolChoice: "any"`, and read the structured `arguments` off the tool call.
This removes the `parse-failed` failure mode by construction.

## Goals

- Replace the free-text JSON parse in `reviewPath` with a forced structured tool call, so a genuine typo path is denied regardless of how the model formats prose around its answer.
- Force the tool with `toolChoice: "any"` and a single tool, reading the first `toolCall` content part by position (not by name) so the OAuth tool-name rewrite (`toClaudeCodeName`) cannot cause a name mismatch.
- Keep the fail-safe intact: no tool call, a non-`deny` verdict, a timeout, or a thrown call all still `defer` (more prompting, never less — ADR 0007 invariant 2).
- Replace the `parse-failed` defer reason with `no-tool-call`; keep `non-deny-verdict`, `timeout`, `call-failed`.
- Preserve the #625 auth-forwarding and #626 decision-trail observability behavior unchanged.

This is **not** a breaking change.
The `deferReason` values appear only in a diagnostic review-log line, not in operator config or a public/cross-extension API surface, so removing `parse-failed` from that enum is not a stability-contract break.
The `config.example.json` `instructions` string still mentions strict JSON, but the forced tool call makes that directive moot rather than broken — no operator config edit is required on upgrade.
Commit as `fix(pi-permission-model-judge):`.

## Non-Goals

- No change to `typo-reviewer.ts`'s decision flow, the short-circuit gates, or the `model_judge.decision` / `model_judge.short_circuit` / `model_judge.invalid_patterns` event shapes.
- No change to the config schema (`config-schema.ts`), `typoPatterns` compilation, or the auth-resolution path added in #625.
- No new debug-log capture step — the tool-call approach makes the exact reply bytes moot, so the "enable debug log and capture one `model_judge.model_reply`" alternative in the issue Notes is not pursued.
- No `typebox` dependency — the Anthropic provider's `convertTools` reads only `parameters.properties` / `parameters.required`, so a plain JSON-Schema object cast to `Tool` suffices (verified below).

## Background

Relevant modules (`packages/pi-permission-model-judge/`):

- `src/model-review.ts` — `reviewPath` builds a `Context`, calls the injected `complete` seam bounded by `timeoutMs`, and maps the reply to a verdict.
  Today: `parseOutcome(extractText(reply).trim(), …)` `JSON.parse`es the concatenated assistant text.
  `ModelCallDeferReason = "parse-failed" | "non-deny-verdict" | "timeout" | "call-failed"`.
  `CompleteFn` is the injected structural analog of `complete`, with an options bag of `{ signal?, apiKey?, headers? }`.
- `src/typo-reviewer.ts` — the `Authorizer` chain link; calls `reviewPath` and logs the `model_judge.decision` review entry plus a `model_judge.model_reply` debug entry carrying `outcome.rawReply`.
  Untouched by this change except that its fixtures in tests must switch to tool-call replies.
- `src/config-schema.ts`, `config/config.example.json` — the `instructions` example ends with a strict-JSON directive that becomes obsolete.

SDK facts verified against `node_modules/@earendil-works/pi-ai/dist/`:

- `types.d.ts` — `Context.tools?: Tool[]`; `Tool<TParameters extends TSchema = TSchema>` has `{ name, description, parameters }`; `ToolCall` is `{ type: "toolCall"; id; name; arguments: Record<string, any>; … }` and is a member of `AssistantMessage.content`.
- `types.d.ts` — `StreamOptions` has no `toolChoice`, but `ProviderStreamOptions = StreamOptions & Record<string, unknown>`, so `toolChoice` rides through as a provider-specific extra.
- `providers/anthropic.js` — `convertTools` builds `input_schema` from only `schema.properties ?? {}` and `schema.required ?? []`; a plain JSON-Schema object works.
  `toolChoice` handling: a string becomes `params.tool_choice = { type: <string> }`, so `"any"` forces a tool without naming it.
  Under OAuth (`isOAuthToken`), both `convertTools` and the reply blocks rewrite names via `toClaudeCodeName`, confirming we must read the reply's tool call by position, not by the name we registered.

## Design Overview

### The verdict tool

Define one tool as a module constant in `src/model-review.ts`:

```ts
import type { /* … */ Tool, ToolCall } from "@earendil-works/pi-ai";

/** The single forced tool: the model reports its verdict through this. */
const VERDICT_TOOL = {
  name: "report_verdict",
  description:
    "Report whether the path is a mistyped path to reject (deny) or should be deferred to the human (defer).",
  parameters: {
    type: "object",
    properties: {
      verdict: {
        type: "string",
        enum: ["deny", "defer"],
        description: "deny a mistyped path; defer anything else",
      },
      reason: {
        type: "string",
        description:
          "Why the path is wrong and the correct location (required when denying)",
      },
    },
    required: ["verdict"],
  },
} as unknown as Tool;
```

The `as unknown as Tool` bridge is required because `Tool.parameters` is typed `TSchema` (typebox's branded schema type), which a plain object literal does not structurally satisfy — the provider reads only `.properties` / `.required`, so the plain object is correct at runtime.
Confirm the exact cast form with `pnpm run check` (the issue's `as Tool` may not typecheck given `TSchema`'s branding; fall back to `as unknown as Tool`).

### The call and the reader

`reviewPath` adds the tool to the context and forces it, then reads the tool call:

```ts
const context: Context = {
  systemPrompt: inputs.config.instructions,
  tools: [VERDICT_TOOL],
  messages: [
    { role: "user", content: renderReviewPrompt(inputs.path), timestamp: Date.now() },
  ],
};
const reply = await inputs.complete(inputs.model, context, {
  signal: controller.signal,
  apiKey: inputs.apiKey,
  headers: inputs.headers,
  toolChoice: "any",
});
return readToolCallOutcome(reply, Date.now() - startedAt);
```

`parseOutcome` is replaced by `readToolCallOutcome`:

```ts
function readToolCallOutcome(reply: AssistantMessage, latencyMs: number): ReviewOutcome {
  const call = reply.content.find(
    (part): part is ToolCall => part.type === "toolCall",
  );
  if (!call) {
    return { verdict: { kind: "defer" }, deferReason: "no-tool-call", latencyMs, rawReply: extractText(reply) };
  }
  const args = call.arguments;
  if (args.verdict !== "deny") {
    return { verdict: { kind: "defer" }, deferReason: "non-deny-verdict", latencyMs, rawReply: JSON.stringify(args) };
  }
  const reason =
    typeof args.reason === "string" && args.reason.length > 0 ? args.reason : GENERIC_TEACHING_REASON;
  return { verdict: { kind: "deny", reason }, latencyMs, rawReply: JSON.stringify(args) };
}
```

Design notes:

- **Read by position, not name.**
  `content.find(part => part.type === "toolCall")` takes the first tool call regardless of its (possibly OAuth-rewritten) name — the sketch and the SDK both confirm this is the safe read.

- **`rawReply` repurposed.**
  It now carries `JSON.stringify(args)` when a tool call is present (still a diagnostic string for the `model_judge.model_reply` debug event), and the concatenated assistant text on a `no-tool-call` defer (so the operator sees what the model said instead of calling the tool).
  `extractText` and `GENERIC_TEACHING_REASON` are retained.

- **`ModelCallDeferReason`** becomes `"no-tool-call" | "non-deny-verdict" | "timeout" | "call-failed"` (`parse-failed` removed).

- **`CompleteFn`** options type gains `toolChoice?: string`.

- **`renderReviewPrompt`** drops the strict-JSON directive and points the model at the tool (the tool schema now carries the reply shape):

  ```ts
  return [
    "A tool is about to access this path outside the working directory:",
    "",
    path,
    "",
    'Call report_verdict. Use verdict "deny" with a reason naming the correct location if this is a mistyped path; otherwise use verdict "defer".',
  ].join("\n");
  ```

### Edge cases

- No tool call at all (model emitted only text despite `toolChoice: "any"`) → `defer` / `no-tool-call`, `rawReply` = the text.
- `arguments.verdict` is `"defer"`, absent, or an unrecognized value → `defer` / `non-deny-verdict`.
- `arguments.verdict === "deny"` but no/empty `reason` → `deny` with `GENERIC_TEACHING_REASON`.
- Timeout / thrown `complete` → unchanged (`timeout` / `call-failed`), no `rawReply`.

## Module-Level Changes

- `src/model-review.ts` —
  - Add `Tool` and `ToolCall` to the `@earendil-works/pi-ai` import; keep `AssistantMessage`, `Context`, `Model`, `TextContent`.
  - Add the `VERDICT_TOOL` module constant.
  - `CompleteFn` options: add `toolChoice?: string`.
  - `ModelCallDeferReason`: `parse-failed` → `no-tool-call`; update its doc comment.
  - `reviewPath`: add `tools: [VERDICT_TOOL]` to the context and `toolChoice: "any"` to the options; call `readToolCallOutcome` instead of `parseOutcome`.
  - Replace `parseOutcome` with `readToolCallOutcome`; keep `extractText`, `GENERIC_TEACHING_REASON`; remove `isRecord` if it becomes unused.
  - `renderReviewPrompt`: replace the strict-JSON directive with the tool directive.
- `test/model-review.test.ts` — rewrite fixtures from `assistantText(JSON.stringify(...))` to a `assistantToolCall(args)` helper that puts a `toolCall` part in `content`; retarget the `parse-failed` test to `no-tool-call` (text-only reply); add a test asserting the context carries `tools: [VERDICT_TOOL]` and options carry `toolChoice: "any"`; update `rawReply` expectations to the stringified args.
- `test/typo-reviewer.test.ts` — `denyingComplete()` and the defer-reply fixture switch to tool-call replies; the `model_judge.model_reply` assertion `rawReply: expect.stringContaining("Doubled segment")` still holds (stringified args contain the reason).
- `test/extension.test.ts` — `denyReply()` builds a `toolCall` content part instead of a text-JSON part.
- `docs/configuration.md` — line ~53: replace the strict-JSON reply prose with "the reviewer forces a single `report_verdict` tool call; the model's verdict is read from its structured arguments." deferReason table row (~line 113): `parse-failed` → `no-tool-call`.
  The `model_judge.model_reply` description (~line 120): note `rawReply` is now the verdict tool-call arguments (or the model's text when it emitted no tool call).
  The diagnosis paragraph (~line 118) mentions `non-deny-verdict`; add `no-tool-call` (model replied but did not call the tool).
- `README.md` — deferReason enum line (~42): `parse-failed` → `no-tool-call`.
- `config/config.example.json` — drop the trailing "Reply with strict JSON: {…}" directive from `instructions` (the tool now carries the shape); the rest of the instruction prose is unchanged.

Verified by grep that no other `src/` file references `parse-failed`; `typo-reviewer.ts` logs `outcome.deferReason ?? null` generically and needs no literal edit.
The `docs/plans/0600-*`, `docs/plans/0625-*`, and `docs/retro/*` files reference `parse-failed` as historical narrative and must **not** be edited.

## Test Impact Analysis

1. **Enabled tests** — the tool-call path lets `model-review.test.ts` assert the request shape directly (`context.tools`, `options.toolChoice`) and the by-position read (a reply whose tool call has a rewritten name still yields the verdict).
   These were impossible while the reviewer parsed free text.
2. **Redundant/retargeted** — the `parse-failed` test (a non-JSON string reply) no longer describes a reachable failure mode; it is retargeted to `no-tool-call` (a text-only reply under a forced tool).
   The two `JSON.stringify`-fixture deny/defer tests remain but their fixtures move to tool-call form.
3. **Must stay** — the auth-forwarding test (`forwards the resolved apiKey and headers`), the timeout test, and the `call-failed` test genuinely exercise the seam and are unchanged in intent (auth/timeout assertions untouched; only the reply fixture shape changes where a reply is produced).

## Invariants at risk

- **#625 auth forwarding** — `reviewPath` must keep passing `apiKey` / `headers` into `complete`.
  Pinned by `test/model-review.test.ts` "forwards the resolved apiKey and headers into the completion"; the same test will also assert `toolChoice: "any"` after this change.
- **#626 decision trail** — `typo-reviewer.ts` must keep writing the `model_judge.decision` review entry with the outcome's verdict/`deferReason`.
  Pinned by `test/typo-reviewer.test.ts` "consults the model … and records the decision" and "records a defer with the model's defer reason"; only the underlying fixture reply shape changes, not the recorded fields.
- **ADR 0007 invariant 2 (never `allow`; defer on every failure)** — every non-`deny` path still defers.
  Pinned by the `non-deny-verdict`, `no-tool-call`, `timeout`, and `call-failed` cases.

## TDD Order

1. **Force the tool call and read structured arguments** — `fix(pi-permission-model-judge): force a structured verdict tool call in the model review`.
   - Red: rewrite `test/model-review.test.ts` to drive the tool-call behavior — add an `assistantToolCall(args)` fixture helper, switch the deny/defer/generic-reason/unrecognized-verdict tests to tool-call replies, retarget the `parse-failed` test to a `no-tool-call` text-only reply, add a test asserting `context.tools === [VERDICT_TOOL]` and `options.toolChoice === "any"`, and update `rawReply` expectations to the stringified args.
     These fail against the current text-parsing `reviewPath`.
   - Green: in `src/model-review.ts` add `VERDICT_TOOL`, extend `CompleteFn` options with `toolChoice`, change `ModelCallDeferReason` (`parse-failed` → `no-tool-call`), add the tool + `toolChoice: "any"` in `reviewPath`, replace `parseOutcome` with `readToolCallOutcome`, and update `renderReviewPrompt`.
     Because the source change flips the deny/defer behavior for the two cross-module suites, update `test/typo-reviewer.test.ts` (`denyingComplete` + the defer fixture) and `test/extension.test.ts` (`denyReply`) to tool-call replies **in this same commit** — they use text-JSON fixtures that would otherwise defer as `no-tool-call`.
   - Run `pnpm --filter @gotgenes/pi-permission-model-judge exec vitest run` and `pnpm run check` (the `as unknown as Tool` cast and the `ToolCall` narrowing are type-only, so `tsc` is the gate).
2. **Refresh the reply-format docs** — `docs(pi-permission-model-judge): describe the forced verdict tool call`.
   - Update `docs/configuration.md` (strict-JSON prose → forced tool call; `deferReason` table `parse-failed` → `no-tool-call`; `model_judge.model_reply` and diagnosis prose), `README.md` (deferReason enum), and `config/config.example.json` (drop the strict-JSON directive from `instructions`).
   - `pnpm exec rumdl check` the edited markdown; no code, so no test cycle.

## Risks and Mitigations

- **`Tool` cast fails to typecheck as written** — `Tool.parameters` is `TSchema`.
  Mitigation: use `as unknown as Tool` and confirm with `pnpm run check`; the provider reads only `.properties` / `.required`, so the runtime shape is correct.
- **`toolChoice` not surfaced on the injected `CompleteFn` type** — our seam is narrower than `ProviderStreamOptions`.
  Mitigation: add `toolChoice?: string` to the `CompleteFn` options bag; production `complete` accepts it via `ProviderStreamOptions`'s `Record<string, unknown>`.
- **Provider ignores `toolChoice: "any"` and returns text** — a model/provider that does not honor the forced choice.
  Mitigation: the `no-tool-call` branch defers safely with the text captured in `rawReply` for diagnosis — no worse than today's `defer`, and the decision trail records why.
- **Silent fixture drift across the three test files** — flipping the reply shape in one file but not another leaves a suite green with the wrong behavior.
  Mitigation: the source change breaks `typo-reviewer.test.ts` and `extension.test.ts` at runtime in the same commit; run the full package suite (not just `model-review.test.ts`) before committing.

## Open Questions

None.
The proposal is the operator's own, the SDK facts are verified against the installed `@earendil-works/pi-ai`, and no follow-up work is deferred.
