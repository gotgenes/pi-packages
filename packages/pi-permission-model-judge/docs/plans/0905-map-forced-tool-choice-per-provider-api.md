---
issue: 905
issue_title: 'pi-permission-model-judge: "any" is not a valid ToolChoice — the forced verdict tool call silently fails on every OpenAI-compatible provider'
---

# Map the forced verdict tool choice to each provider API's own spelling

## Release Recommendation

**Release:** ship independently

This package has no architecture roadmap and no release-batch membership, so there is no batch to be mid-way through.
The change is a standalone bug fix in the sequence [#625] → [#626] → [#628] → [#905] (auth → observability → reply format → wire value); ship it on its own.

## Problem Statement

`reviewPath` in `src/model-review.ts` sends a hardcoded `toolChoice: "any"` on every model call.
`"any"` is the Anthropic / Google / Bedrock / Mistral spelling of "the model must call one of the supplied tools".
The OpenAI-family APIs spell that same intent `"required"` and discard `"any"`, so the request silently degrades to `"auto"`, the model answers in prose, and `readToolCallOutcome` finds no tool call.

`Jopqior` reported the consequence with a decision trail from `zai-coding-cn/glm-5.3-flash`.
An `external_directory` ask on a doubled-package typo path matched a configured pattern, the judge resolved auth, called the model (`modelCalled: true`, `latencyMs: 5010` — a real roundtrip), and recorded `verdict: "defer"`, `deferReason: "no-tool-call"`.
Two different trigger paths — an `edit` tool call and a `bash`-extracted path — produced the same outcome.
From the operator's seat the judge is installed, named in `authorizerChain`, authenticated, spending seconds per ask, and deciding nothing: exactly the silent-100%-defer class [#626] built the decision trail to expose, one layer below where that trail looks.

[#628]'s plan listed "provider ignores `toolChoice: "any"` and returns text" as an accepted risk whose mitigation was the fail-safe `no-tool-call` defer.
That mitigation held — nothing was ever over-approved — but it fires on every OpenAI-family provider, which is most of the providers pi supports, so the fail-safe is the *only* thing the judge does there.

## Goals

- Send each provider API its own spelling of "must call a tool", keyed on `model.api`, so the forced verdict tool call is actually forced on every API pi-ai implements.
- Keep plain-string `tool_choice` values only, never the object form — [pi#4266] shows an object-valued `tool_choice` returning HTTP 400 from LM Studio-class OpenAI-compatible servers.
- Default an unrecognized or absent `api` to `"required"`, since a custom api registered with pi is nearly always OpenAI-compatible.
- Record the resolved `api` and `toolChoice` on the `model_judge.decision` review entry, so the next spelling mismatch is diagnosable from the decision trail instead of from pi-ai's source.
- Preserve every fail-safe: a rejected value, a prose reply, a timeout, or a throw all still defer (ADR 0007 invariant 2 — more prompting, never less).

This is **not** a breaking change.
No operator config changes, no config key is added or renamed, and the two new review-log fields are additive on a diagnostic shape — the same reasoning [#628] applied when it replaced the `parse-failed` defer reason.
None of the touched types (`CompleteFn`, `ReviewOutcome`, `ForcedToolChoice`) are exported from `src/index.ts`, and the package declares no `exports` map, so nothing here is reachable by a third party.
Commit the wire fix as `fix(pi-permission-model-judge):` and the trail fields as `feat(pi-permission-model-judge):`.

## Non-Goals

- No change to pi-ai and no upstream PR.
  Upstream has ruled on this exact class twice, both times caller-side: [pi#5154] (the mirror-image shape mismatch, on zai, closed with "this is typed … if your code doesn't adhere to the types, bad things happen") and [pi#4266] (object-form `tool_choice` breaking local servers, closed as the caller's problem).
  `ToolChoice` is still `"auto" | "none"` on pi-ai `main`; no widening is coming, and the plan does not wait for one.
- No object-form `tool_choice` naming `report_verdict` explicitly.
  The judge supplies exactly one tool, so "must call something" and "must call `report_verdict`" are the same instruction here, and the object form carries [pi#4266]'s 400 risk for no added precision.
- No free-text verdict fallback when a reply carries no tool call.
  That re-adds what [#628] removed, and a deny decided from prose invites false denies — "I would not deny this" contains the token.
- No operator config key to override the forced choice.
  The per-api map covers every `KnownApi`; revisit only if a real provider needs an override.
- No change to `typoPatterns`, `config-schema.ts`, `schemas/model-judge.schema.json`, or `config/config.example.json` — the fix is below the config surface.
- No change to `@gotgenes/pi-permission-system`, despite the issue's Package field naming it.
  The defect and the fix are both inside this package's model call; the permission system neither constructs the completion options nor reads them.

## Background

Modules in `packages/pi-permission-model-judge/`:

- `src/model-review.ts` — `reviewPath` builds the `Context` (system prompt, the single `VERDICT_TOOL`, one user message), calls the injected `complete` seam under an `AbortController` bounded by `config.timeoutMs`, and maps the reply through `readToolCallOutcome`.
  The literal `toolChoice: "any"` is at line ~158.
  `ReviewOutcome` is `{ verdict, deferReason?, latencyMs, rawReply? }`, and `latencyMs` is currently spelled at four return sites: `readToolCallOutcome`'s three branches plus `reviewPath`'s `catch`.
  `CompleteFn` redeclares the options bag as `{ signal?, apiKey?, headers?, toolChoice?: string }` — the `string` is what let the out-of-contract value through the compiler.
- `src/typo-reviewer.ts` — the `Authorizer` chain link; writes one `model_judge.decision` review entry per pattern-matched ask.
  Two sibling object literals carry that event's nine fields (`requestId`, `surface`, `path`, `matchedPattern`, `modelCalled`, `modelId`, `latencyMs`, `verdict`, `deferReason`): the model path inside `authorize`, and `deferWith()` for the two pre-model defers.
  They already encode a shared invariant informally — `latencyMs` is `null` exactly when `modelCalled` is `false`.
- `src/extension.ts` — wires the production `complete`: `(model, context, options) => realComplete(model, context, options)`.
  The options bag reaches `ProviderStreamOptions`, which is `StreamOptions & Record<string, unknown>`, so a narrower field type still assigns.

### The provider-API contract

`ToolChoice = "auto" | "none"` in pi-ai's `types.ts` governs `streamSimple`/`completeSimple`, not `complete`.
`complete(model, context, options?: ProviderStreamOptions)` accepts anything, and each API module declares its own `toolChoice` type — that per-module declaration is the real contract.
Read from the installed floor (`@earendil-works/pi-ai@0.79.1`, this package's `devDependencies` pin, `peerDependencies >=0.79.0`) and cross-checked against the 0.85.1 tracking checkout:

| `model.api`               | declared `toolChoice` values                             | forcing spelling |
| ------------------------- | -------------------------------------------------------- | ---------------- |
| `anthropic-messages`      | `"auto" \| "any" \| "none" \| {type:"tool",name}`        | `"any"`          |
| `bedrock-converse-stream` | `"auto" \| "any" \| "none" \| {type:"tool",name}`        | `"any"`          |
| `google-generative-ai`    | `"auto" \| "none" \| "any"`                              | `"any"`          |
| `google-vertex`           | `"auto" \| "none" \| "any"`                              | `"any"`          |
| `mistral-conversations`   | `"auto" \| "none" \| "any" \| "required" \| {…}`         | `"any"`          |
| `openai-completions`      | `OpenAI.Chat.Completions.ChatCompletionToolChoiceOption` | `"required"`     |
| `openai-responses`        | `ResponseCreateParamsStreaming["tool_choice"]`           | `"required"`     |
| `azure-openai-responses`  | `ResponseCreateParamsStreaming["tool_choice"]`           | `"required"`     |
| `openai-codex-responses`  | `"auto" \| "none" \| "required"`                         | `"required"`     |
| `pi-messages`             | `"auto" \| "none" \| "required" \| {…}`                  | `"required"`     |

Those ten are the whole of pi-ai's `KnownApi` at 0.85.1; the 0.79.1 floor has the same set minus `pi-messages`.
`mistral-conversations` accepts both spellings (its `mapToolChoice` passes `"any"` and `"required"` through unchanged), so it keeps `"any"` and nothing about it changes.

The split is not cosmetic — a blanket swap to `"required"` would break three APIs that work today:

- `google-shared.ts`'s `resolveGoogleFunctionCallingMode` maps `"any"` to `FunctionCallingConfigMode.ANY` and falls through to `AUTO` for anything else, so `"required"` would degrade Google to the same silent auto the bug report describes.
- `bedrock-converse-stream.ts`'s `convertToolConfig` switches on `"auto"`/`"any"` and otherwise looks for `toolChoice.type === "tool"`, so `"required"` would yield no `toolChoice` at all.
- `anthropic-messages.ts` wraps any string as `{ type: <string> }`, so `"required"` would put `{type:"required"}` on the wire and 400.

That last line is also why `"any"` works on Anthropic today: the permissive wrapper, not a contract.

### Constraints from AGENTS.md

- A module no code imports yet is `refactor:` however new it is; the commit that wires it up carries the `fix:`.
  `src/tool-choice.ts` therefore lands as `refactor:` and is wired one step later.
- The change has a mechanism half (`resolveToolChoice` plus its wiring) and a data half (ten rows of external fact), so they are separate steps, and the check that verifies one row is written before the rows.
- The README and `docs/configuration.md` tables are width-padded; MD060 enforces consistency within a file, and `rumdl fmt` does not re-pad for you.
  Match each file's existing padding when adding rows, and anchor `Edit` calls on adjacent unique lines rather than on the padded separator row.

## Design Overview

### `src/tool-choice.ts` (new)

```typescript
/** The two spellings of "the model must call one of the supplied tools". */
export type ForcedToolChoice = "any" | "required";

/**
 * The spelling each pi-ai API accepts, keyed on `Model.api`. Read from each
 * API module's own `toolChoice` declaration — the generic `ToolChoice` type
 * governs `streamSimple`, not `complete`.
 */
const FORCED_TOOL_CHOICE_BY_API: Record<string, ForcedToolChoice> = {
  "anthropic-messages": "any",
  "bedrock-converse-stream": "any",
  "google-generative-ai": "any",
  "google-vertex": "any",
  "mistral-conversations": "any",
  "openai-completions": "required",
  "openai-responses": "required",
  "azure-openai-responses": "required",
  "openai-codex-responses": "required",
  "pi-messages": "required",
};

/**
 * `pi-ai`'s `Api` is `KnownApi | (string & {})`, so a custom-registered
 * provider can carry an api this map does not name. Such a provider is
 * near-always OpenAI-compatible, so `"required"` is the useful default; a
 * provider that rejects it fails the call, which the reviewer already records
 * as a `call-failed` defer rather than an approval.
 */
export function resolveToolChoice(api: string | undefined): ForcedToolChoice {
  return (api && FORCED_TOOL_CHOICE_BY_API[api]) || "required";
}
```

The map is a plain `Record<string, ForcedToolChoice>` rather than a `Record<KnownApi, …>`: keying on `KnownApi` would make the file fail to compile whenever pi-ai adds an api, which is a build break in place of a graceful default, and the floor's `KnownApi` does not even contain `pi-messages`.

### `reviewPath`

`reviewPath` resolves the spelling once, sends it, and reports what it sent:

```typescript
const api = String(inputs.model.api ?? "");
const toolChoice = resolveToolChoice(inputs.model.api);
// …
const reply = await inputs.complete(inputs.model, context, {
  signal: controller.signal,
  apiKey: inputs.apiKey,
  headers: inputs.headers,
  toolChoice,
});
return { ...readToolCallOutcome(reply), latencyMs: Date.now() - startedAt, api, toolChoice };
```

`ReviewOutcome` gains two always-present fields:

```typescript
export interface ReviewOutcome {
  verdict: AuthorizerVerdict;
  deferReason?: ModelCallDeferReason;
  latencyMs: number;
  rawReply?: string;
  /** The `Model.api` the call was addressed to. */
  api: string;
  /** The forcing spelling actually sent, so a mismatch is readable from the trail. */
  toolChoice: ForcedToolChoice;
}
```

Both are computed before the call, so both are stamped on the `catch` return too — a timeout or a 400 is exactly the case where knowing what was sent matters.
`reviewPath` is the sender, so it is the single source of both fields; the reviewer relays them rather than re-deriving `model.api` itself, which keeps the two halves of one log line from disagreeing.

`readToolCallOutcome` stops spelling `latencyMs` and returns only what it decides:

```typescript
function readToolCallOutcome(
  reply: AssistantMessage,
): Pick<ReviewOutcome, "verdict" | "deferReason" | "rawReply"> { … }
```

`CompleteFn`'s options bag tightens `toolChoice?: string` to `toolChoice?: ForcedToolChoice`.
That is what makes a future out-of-contract literal a compile error at the seam rather than a runtime silent-defer.

### The decision record

`typo-reviewer.ts` grows one writer for the `model_judge.decision` event, with the model-call fields discriminated so the "null iff not called" invariant is carried by the type instead of by two object literals agreeing:

```typescript
type DecisionRecord = DecisionBase & {
  verdict: "deny" | "defer";
  deferReason: ModelCallDeferReason | PreModelDeferReason | null;
} & (
    | { modelCalled: true; latencyMs: number; api: string; toolChoice: ForcedToolChoice }
    | { modelCalled: false; latencyMs: null; api: null; toolChoice: null }
  );

function writeDecision(log: AuthorizerLog, record: DecisionRecord): void {
  log.review(DECISION_EVENT, { surface: REVIEWED_SURFACE, ...record });
}
```

Call sites:

```typescript
// model path, in authorize
writeDecision(log, { ...base, modelCalled: true, latencyMs: outcome.latencyMs,
  api: outcome.api, toolChoice: outcome.toolChoice,
  verdict: outcome.verdict.kind, deferReason: outcome.deferReason ?? null });

// deferWith, for model-unresolved / auth-failed
writeDecision(log, { ...base, modelCalled: false, latencyMs: null, api: null,
  toolChoice: null, verdict: "defer", deferReason });
```

The emitted field order is `surface` first followed by the record's keys, which differs from today's literal order.
That is invisible to the assertions (JSON object key order is not asserted anywhere) and to the JSONL consumer, but keep `surface` in the writer so neither call site can omit it.

### Edge cases

- `model.api` is an api the map does not name → `"required"`; the call either works (OpenAI-compatible, the common case) or fails, and a failure is a `call-failed` defer, never an approval.
- `model.api` is absent (a hand-built or fixture model) → `"required"`, and `outcome.api` is `""` rather than `undefined`, so the trail field stays a string.
- The provider rejects the spelling with a 400 → `complete` throws → `call-failed` defer, with `api` and `toolChoice` now on the record to name the culprit.
- The provider honors the spelling and the model still answers in prose → `no-tool-call` defer, unchanged, but now distinguishable from the silent-ignore case by reading `toolChoice` in the trail.

## Module-Level Changes

- `src/tool-choice.ts` — **new**: `ForcedToolChoice`, `FORCED_TOOL_CHOICE_BY_API`, `resolveToolChoice`.
- `src/model-review.ts` —
  - Import `resolveToolChoice` and `ForcedToolChoice` from `./tool-choice`.
  - `ReviewOutcome`: add required `api: string` and `toolChoice: ForcedToolChoice`, and document both.
  - `CompleteFn`: `toolChoice?: string` → `toolChoice?: ForcedToolChoice`.
  - `reviewPath`: resolve `api` / `toolChoice` before the try body, send `toolChoice`, and stamp `latencyMs` / `api` / `toolChoice` at both of its own return sites.
  - `readToolCallOutcome`: drop the `latencyMs` parameter and the three `latencyMs` spellings; return `Pick<ReviewOutcome, "verdict" | "deferReason" | "rawReply">`.
  - `VERDICT_TOOL`'s doc comment says "Forcing it (`toolChoice: "any"`)" — reword to name the per-API spelling and point at `tool-choice.ts`.
- `src/typo-reviewer.ts` —
  - Add `DecisionRecord` and `writeDecision`; route both existing `log.review(DECISION_EVENT, …)` literals through it.
  - The model path supplies `api: outcome.api`, `toolChoice: outcome.toolChoice`; `deferWith` supplies `null` for both.
  - Import `ForcedToolChoice` (type-only) alongside the existing `./model-review` imports.
- `test/fixtures/model.ts` — **new**: `makeModel(overrides?: Partial<Model<any>>): Model<any>`, returning `{ provider: "anthropic", id: "claude-haiku", api: "anthropic-messages", ...overrides } as Model<any>`.
  The cast is required and is what the three inline literals already do — a real `Model` has many more required fields that `reviewPath` never reads.
- `test/tool-choice.test.ts` — **new**: table-driven coverage of all ten `KnownApi` rows plus an unrecognized string and `undefined`.
- `test/model-review.test.ts` — replace the local `MODEL` literal with `makeModel()`; add per-api assertions on `options.toolChoice` (anthropic → `"any"`, `openai-completions` → `"required"`, unrecognized → `"required"`) and on `outcome.api` / `outcome.toolChoice`, including on the timeout path.
  The existing `expect(options?.toolChoice).toBe("any")` assertion stays and becomes the anthropic row of that matrix.
- `test/typo-reviewer.test.ts` — replace the `MODEL` literal with `makeModel()`; extend the three exact-equality `model_judge.decision` assertions (lines 155, 244, 306) with `api` and `toolChoice`.
  Lines 155 and 306 are model-called denies and expect `"anthropic-messages"` / `"any"`; line 244 is the `auth-failed` defer and expects `null` / `null`.
  The three `expect.objectContaining` assertions (lines 186, 268, 345) are unaffected — but per AGENTS.md a partial matcher absorbs a wrong value silently, so re-read those three by hand rather than counting their green run as verification.
- `test/extension.test.ts` — replace the `MODEL` literal with `makeModel()`.
  Predicted unchanged otherwise: the `expect.objectContaining({ toolChoice: "any" })` assertion at line ~412 stays correct because the fixture's default api is `anthropic-messages`.
  That prediction is falsifiable — if it fails, the fixture default is wrong, not the assertion.
- `README.md` — the `model_judge.decision` field table (lines ~36–44) gains `api` and `toolChoice` rows, padded to the existing column widths.
- `docs/configuration.md` —
  - The field table (lines ~104–114) gains the same two rows.
  - Line ~53: the "forces the model to call a single `report_verdict` tool" sentence gains that the forcing value is chosen per provider API.
  - Line ~119: the diagnosis paragraph calls `no-tool-call` "rare, since the tool is forced" — the claim this issue refutes.
    Reword to send the reader to the entry's `api` / `toolChoice` fields.

Predicted unchanged, with the claim each rests on:

- `src/extension.ts` — the production `complete` wrapper passes `options` straight through to `ProviderStreamOptions`, which is `StreamOptions & Record<string, unknown>`, so narrowing `CompleteFn.toolChoice` to a union still assigns. `pnpm run check` is the gate.
- `src/config-schema.ts`, `schemas/model-judge.schema.json`, `config/config.example.json` — no config key is added, removed, or re-typed.
- `test/fixtures/assistant-message.ts` — its hardcoded `api: "anthropic-messages"` is the assistant *reply* envelope's provider echo, a different field on a different type that happens to share a name; `reviewPath` reads only `content`.
- `test/config-loader.test.ts`, `test/config-schema.test.ts`, `test/typo-patterns.test.ts` — no model, no completion options.

Greps run to bound the blast radius: no `src/`, `test/`, `.pi/skills/`, or `docs/` file outside the list above mentions `toolChoice`; the only non-plan, non-retro prose mentioning the forced tool call is the two doc locations listed.
This package has no `docs/architecture/` tree and no roadmap step to mark.

## Test Impact Analysis

Baseline, measured with `pnpm --filter @gotgenes/pi-permission-model-judge run test` at `e0f985db`: 6 files, 54 tests, all passing.

1. **Enabled by the extraction** — the api-to-spelling map becomes unit-testable in isolation (`test/tool-choice.test.ts`), which is impossible today because the value is a literal inside an async function that also builds a context, arms a timer, and calls a seam.
   Every row is an external fact read out of a dependency, so each gets its own case rather than being sampled.
2. **Retargeted, not removed** — no existing test becomes redundant.
   `model-review.test.ts`'s "forces a single verdict tool and passes the instructions and path" keeps its `"any"` assertion; it is now the anthropic row of a matrix rather than a claim about all providers, and the fixture's explicit `api` is what makes it honest.
3. **Must stay as-is** — the auth-forwarding test, the timeout test, the `call-failed` test, and "reads the tool call by position, ignoring the (rewritten) tool name" exercise the [#625] and [#628] seams; only their model fixture changes.

The new per-api tests are the layer the reporter's scenario needs: `extension.test.ts`'s existing `toolChoice` assertion passes today *with the bug present*, because its fixture is Anthropic.
A test that reproduces the report must name a non-Anthropic api, which is why the matrix lives at the `reviewPath` and `resolveToolChoice` levels rather than in the extension suite.

Real-provider confirmation is not available in this repo — the suite can prove which string goes on the wire, not that `zai-coding-cn` honors it.
`/ship`'s close comment should ask `Jopqior` to confirm against their configuration.

## Invariants at risk

- **[#625] auth forwarding** — `reviewPath` must keep passing `apiKey` / `headers` into `complete`.
  Pinned by `test/model-review.test.ts` "forwards the resolved apiKey and headers into the completion", which asserts `options.apiKey`, `options.headers`, and `options.signal` on the same options bag this change edits.
  Constituency: an operator on an OAuth or header-authenticated provider — unaffected by the spelling change, and the test stays untouched apart from its model fixture.
- **[#626] positive decision record** — every pattern-matched ask must still leave exactly one `model_judge.decision` entry, including the two pre-model defers.
  Pinned by the three exact-equality assertions in `test/typo-reviewer.test.ts` (lines 155, 244, 306) plus `expect(log.review).not.toHaveBeenCalled()` on the four short-circuit paths.
  The `writeDecision` extraction is the step at risk here: routing both literals through one writer must not change which call sites emit.
  Constituency: the operator diagnosing a silent judge — the reason this issue is legible at all.
- **`latencyMs` is `null` exactly when `modelCalled` is `false`** — today an informal agreement between two object literals.
  Pinned by the lines 155/244/306 assertions.
  The discriminated `DecisionRecord` promotes it to a type-level constraint and extends it to the two new fields.
- **[#628] structured verdict, read by position** — the verdict must still come from the first `toolCall` part regardless of its name.
  Pinned by "reads the tool call by position, ignoring the (rewritten) tool name".
  The `readToolCallOutcome` signature change is mechanical; `tsc` plus this test are the gate.
- **ADR 0007 invariant 2 — never `allow`, defer on every failure** — the new default (`"required"` for an unrecognized api) can only produce a rejected call, and a rejected call is a `call-failed` defer.
  Pinned by the `call-failed`, `timeout`, `no-tool-call`, and `non-deny-verdict` cases in `model-review.test.ts`.
  No path in this change can emit `allow`; `reviewPath` has no `allow` branch to reach.

## TDD Order

1. **Hoist the shared model fixture** — `test(pi-permission-model-judge): hoist the shared model fixture into test/fixtures`.
   Friction it prepares: the same `{ provider: "anthropic", id: "claude-haiku" }` literal is declared in `model-review.test.ts` (cast `as never`), `typo-reviewer.test.ts:23`, and `extension.test.ts:42`, and the mapping reads `model.api` — so without this, adding `api` is a three-file synchronized edit, and the per-api tests need a fourth variant spelled by hand.
   Add `test/fixtures/model.ts` with `makeModel(overrides)`, following `test/fixtures/permission-details.ts`'s `makePromptDetails(overrides)` convention, and replace all three literals with `makeModel()`.
   No `api` field yet — this step is behavior-preserving.
   Verify: the suite stays at 54 passing, and `grep -rn 'claude-haiku' test/` shows the literal only in `test/fixtures/model.ts` and the config fixtures that name the model *string*.
   Killing mutation: change the factory's `provider` to `"openai"` — `typo-reviewer.test.ts`'s `modelId: "anthropic/claude-haiku"` assertions must go red, proving the three suites now read the factory rather than a stale local.
2. **Merge the outcome's per-call fields at one place** — `refactor(pi-permission-model-judge): stamp latencyMs once at reviewPath's return sites`.
   Friction it prepares: `latencyMs` is spelled at four return sites (three branches of `readToolCallOutcome` plus `reviewPath`'s `catch`), and the design adds two more always-present fields that would otherwise land at all four.
   Change `readToolCallOutcome` to return `Pick<ReviewOutcome, "verdict" | "deferReason" | "rawReply">` and drop its `latencyMs` parameter; `reviewPath` merges `latencyMs` at its success and `catch` returns.
   No test changes — `model-review.test.ts` asserts individual `outcome.*` fields and never the object identity of the helper's return.
   Verify: `pnpm run check` and the 54-test green run.
   Killing mutation: delete the `latencyMs` key from `reviewPath`'s success return — `tsc` rejects it as a missing required field, and the "denies with the model's reason" test's `expect(typeof outcome.latencyMs).toBe("number")` goes red if the field is made optional to dodge that.
3. **Extract the decision-record writer** — `refactor(pi-permission-model-judge): extract the decision-record writer in typo-reviewer`.
   Friction it prepares: two sibling object literals already spell the same nine fields, and the trail step adds a third pair to both; extracting first makes that a one-place edit and makes the "null iff not called" pairing a type constraint instead of a convention.
   Add `DecisionRecord` (discriminated on `modelCalled`) and `writeDecision(log, record)`; route the `authorize` model path and `deferWith` through it with no value changes.
   Verify: no test edits needed; the three exact-equality assertions stay green unmodified, which is the check that the emitted field set is unchanged.
   Killing mutation: hardcode `modelCalled: true` inside `writeDecision` — the `auth-failed` assertion at `typo-reviewer.test.ts:244` must go red.
4. **Add the per-API map** — `refactor(pi-permission-model-judge): add the per-API forced-tool-choice map`.
   Nothing imports `src/tool-choice.ts` yet, so this is `refactor:` however new the file is; step 5 carries the `fix:`.
   Write the row check before the rows: start `test/tool-choice.test.ts` with the two rows the report proves — `anthropic-messages` → `"any"` and `openai-completions` → `"required"` — confirm red against a stub returning `"required"` unconditionally, then fill the remaining eight `KnownApi` rows plus `"some-custom-api"` and `undefined` → `"required"`.
   Green: `src/tool-choice.ts` as sketched.
   Killing mutations, one per equivalence class:
   - Return `"required"` unconditionally → the five `"any"` rows (anthropic, bedrock, both google, mistral) go red; the five `"required"` rows and both default rows stay green.
   - Return `"any"` unconditionally → the five `"required"` rows and both default rows go red; the five `"any"` rows stay green.
   - Drop the `|| "required"` default → `undefined` and `"some-custom-api"` go red while every named row stays green.
5. **Send each API its own spelling** — `fix(pi-permission-model-judge): force the verdict tool call with each provider API's own spelling`.
   Red: add `api: "anthropic-messages"` as `makeModel`'s default, then extend `model-review.test.ts` — `makeModel({ api: "openai-completions" })` must send `toolChoice: "required"`, `makeModel({ api: "not-a-real-api" })` must send `"required"`, `makeModel()` must still send `"any"`; and assert `outcome.api` / `outcome.toolChoice` on a deny and on the timeout path.
   The `"required"` cases fail against the hardcoded literal.
   Green: `reviewPath` resolves through `resolveToolChoice(inputs.model.api)`, sends it, and stamps `api` / `toolChoice` at both return sites; `CompleteFn.toolChoice` tightens to `ForcedToolChoice`; reword `VERDICT_TOOL`'s doc comment.
   `extension.test.ts`'s existing `toolChoice: "any"` assertion is predicted to stay green on the fixture default — if it does not, the fixture default is wrong.
   Verify: `pnpm run check`, then the full package suite, not just `model-review.test.ts` — `ReviewOutcome` gains required fields that `typo-reviewer.test.ts` consumes through the real `reviewPath`.
   Killing mutations:
   - Replace `resolveToolChoice(inputs.model.api)` with the literal `"any"` → the `openai-completions` and unrecognized-api assertions go red, while `extension.test.ts` stays green.
     That asymmetry is the point: the pre-existing suite could not see this bug.
   - Delete the `toolChoice` stamp from the `catch` return → the timeout test's new `outcome.toolChoice` assertion goes red (`tsc` catches it first).
6. **Record what was sent** — `feat(pi-permission-model-judge): record the provider API and forced tool choice in the decision trail`.
   Red: extend the three exact-equality `model_judge.decision` assertions in `typo-reviewer.test.ts` — lines 155 and 306 (model-called denies) with `api: "anthropic-messages"`, `toolChoice: "any"`; line 244 (`auth-failed`) with `api: null`, `toolChoice: null`.
   Green: add the two fields to both arms of `DecisionRecord` and supply them at the two `writeDecision` call sites.
   Verify: full suite; then re-read the three `expect.objectContaining` decision assertions (lines 186, 268, 345) by hand — a partial matcher absorbs a wrong added value and still passes.
   Killing mutations:
   - Stamp `toolChoice: outcome.toolChoice` unconditionally in `writeDecision` (ignoring the discriminant) → the `auth-failed` assertion expecting `null` goes red.
   - Omit `api` from the record → all three exact-equality assertions go red.
7. **Document the spelling and the new fields** — `docs(pi-permission-model-judge): document the per-API forced tool choice and the new trail fields`.
   `README.md` and `docs/configuration.md` field tables each gain `api` and `toolChoice` rows at the existing column padding; `docs/configuration.md` line ~53 gains the per-API sentence; line ~119's "rare, since the tool is forced" claim is replaced with a pointer to the entry's `api` / `toolChoice` fields.
   Verify: `pnpm exec rumdl check README.md docs/configuration.md` and re-read both tables' pipe alignment — MD060 is not auto-fixable.
   No code, so no test cycle.

## Risks and Mitigations

- **`"required"` is wrong for some provider the map names as OpenAI-family.**
  Each row is read from that API module's own `toolChoice` declaration at the 0.79.1 floor and re-checked at 0.85.1, and step 4's table-driven test is one case per row rather than a sample.
  A wrong row degrades to a rejected call (`call-failed` defer) or a prose reply (`no-tool-call` defer), never to an approval.
- **A future pi-ai `KnownApi` is absent from the map.**
  The map is a `Record<string, …>` with a `"required"` default, so a new api gets the OpenAI-family spelling rather than a compile error.
  When the new api is Anthropic-shaped, this reintroduces the reported failure for it — which the trail now names, because `api` and `toolChoice` are on the record.
- **A provider rejects the spelling outright with a 400 instead of ignoring it.**
  [pi#5154] shows zai returning `Invalid API parameter` for a wrong-shaped value, so this is a real mode.
  It surfaces as `call-failed` rather than `no-tool-call`, which is louder, not quieter, and both defer.
- **The `writeDecision` extraction silently changes the emitted field set.**
  The three exact-equality assertions are the gate, and step 3 deliberately lands with no test edits so that green means "field set unchanged".
  The emitted key *order* does change (`surface` moves first); nothing asserts key order and JSONL consumers read by key.
- **The green suite hides a wrong value at a partial matcher.**
  Three `model_judge.decision` assertions use `expect.objectContaining`, which absorbs a wrong `api` or `toolChoice`.
  Steps 5 and 6 both require re-reading those three by hand rather than counting the green run.
- **No end-to-end confirmation against a real OpenAI-compatible provider.**
  The suite pins which string is sent, not that the endpoint honors it.
  Mitigation: `/ship`'s close comment asks the reporter to re-run their configuration; the fail-safe defer means a miss costs prompting, not safety.

## Open Questions

- Should the forced spelling be operator-overridable (a `toolChoice` config key) for a provider the map gets wrong?
  Deferred until a real provider needs it — the map covers every `KnownApi`, and the trail now makes a wrong value visible, which is the prerequisite for knowing an override is warranted.
  Nothing is filed for this; it is not concrete enough to be an issue.

[#625]: https://github.com/gotgenes/pi-packages/issues/625
[#626]: https://github.com/gotgenes/pi-packages/issues/626
[#628]: https://github.com/gotgenes/pi-packages/issues/628
[#905]: https://github.com/gotgenes/pi-packages/issues/905
[pi#4266]: https://github.com/earendil-works/pi/issues/4266
[pi#5154]: https://github.com/earendil-works/pi/issues/5154
