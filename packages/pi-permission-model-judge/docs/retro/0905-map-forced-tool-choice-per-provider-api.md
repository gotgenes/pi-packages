---
issue: 905
issue_title: 'pi-permission-model-judge: "any" is not a valid ToolChoice — the forced verdict tool call silently fails on every OpenAI-compatible provider'
---

# Retro: #905 — "any" is not a valid ToolChoice

## Stage: Planning (2026-09-11T06:04:08Z)

### Session summary

Verified `Jopqior`'s third-party diagnosis against pi-ai's real contract, then planned a per-`model.api` map from the forcing intent to each API's own spelling (`"any"` for Anthropic/Bedrock/Google/Mistral, `"required"` for the OpenAI family and `pi-messages`), with `"required"` as the default for an unrecognized api.
The plan is `packages/pi-permission-model-judge/docs/plans/0905-map-forced-tool-choice-per-provider-api.md`: seven steps, three of them preparatory refactors from the Tidy-First assessor, plus the two new `model_judge.decision` trail fields (`api`, `toolChoice`) the operator asked for.

### Observations

- The issue's own root-cause framing (`ToolChoice = "auto" | "none"` is the contract, so `"any"` is out-of-contract) is **approximately** right but cites the wrong type.
  `ToolChoice` governs `streamSimple`/`completeSimple`; `complete` takes `ProviderStreamOptions`, and each API module declares its own `toolChoice` type.
  Reading those ten per-module declarations is what showed the fix cannot be a blanket swap to `"required"` — `google-shared.ts` falls through to `AUTO`, `bedrock-converse-stream.ts` emits no `toolChoice` at all, and `anthropic-messages.ts` would put `{type:"required"}` on the wire and 400.
  A plan written from the issue's stated cause alone would have broken three working APIs.
- Upstream posture was already settled against us, and searching the tracker found it cheaply.
  `earendil-works/pi#5154` is the mirror-image defect (Anthropic-shaped `tool_choice` 400ing on zai) closed with "this is typed … if your code doesn't adhere to the types, bad things happen", and `#4266` closed the object-form-breaks-LM-Studio report the same way.
  The second one is load-bearing in the design, not just the Non-Goals: it is why the plan uses plain strings rather than naming `report_verdict` explicitly.
- The `ask_user` gate bounced on vocabulary, not on substance — "What do these values mean?
  Why do all have `auto` and only some have `any`?".
  The provider-API spellings of `tool_choice` are a term of art I had presented as a table of facts without saying they are three intents with two vendor vocabularies.
  Consistent with AGENTS.md's rule to define a gate's terms of art before its substance.
- `#628`'s plan explicitly accepted "provider ignores `toolChoice: "any"` and returns text" as a risk, mitigated by the fail-safe defer.
  The mitigation worked exactly as designed and the feature was still inert for most providers — a reminder that "fails safe" and "works" are different acceptance criteria, and that a risk accepted for one provider family should be priced against the provider set an operator can actually configure.
- `extension.test.ts` asserts `toolChoice: "any"` and passes **with the bug present**, because its model fixture is Anthropic.
  The test that reproduces the report has to name a non-Anthropic api, which is why the plan puts the matrix at the `resolveToolChoice` and `reviewPath` levels.
- The Tidy-First assessor was unusually productive here: it caught that `latencyMs` is spelled at four return sites (the two new always-present fields would have landed at all four), that the two `model_judge.decision` literals share all nine fields, and that the shared `MODEL` literal is triplicated.
  It also corrected two counts in my design summary (nine fields, not ten; three of six assertion sites use exact equality) and raised a scope question I adopted — a dedicated `test/tool-choice.test.ts` rather than folding the mapping tests into `model-review.test.ts`.
- Real-provider confirmation is not reachable from this repo; the suite can prove which string goes on the wire, not that `zai-coding-cn` honors it.
  The plan routes that to `/ship`'s close comment as a request to the reporter.

#### Deferred tidyings

- `test/fixtures/assistant-message.ts` — the assessor declined merging its hardcoded `api: "anthropic-messages"` (the assistant reply envelope's provider echo) with the new model-registry `api` concept; two different fields on two different types sharing a name, so merging would be the wrong abstraction.
- `src/model-review.ts` — the assessor declined restructuring `readToolCallOutcome`'s three verdict branches into a lookup table; this change adds fields orthogonal to those branches and does not touch the verdict logic.
