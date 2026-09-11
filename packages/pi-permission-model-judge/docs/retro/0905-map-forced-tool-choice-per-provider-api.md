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

## Stage: User Note (2026-09-11T07:13:27Z)

`pre-completion-reviewer` _repeatedly_ reached for `find /`, so it needs better instruction on where common files live.

### What the four #905 dispatches had in common

Every one of the four rounds asked the reviewer to verify a fact about `@earendil-works/pi-ai` that is **not answerable from inside the repo**:

1. Round 1 — which `toolChoice` value each provider API declares (ten rows of external fact).
2. Round 2 — where `complete` is exported from at 0.84.x, and whether Pi's extension loader aliases the pi-ai root to `compat`.
3. Round 3 — at which release the loader's `compat` alias first appears.
4. Round 4 — the same, re-derived at exact boundary versions.

The common shape is a **version-boundary question about a peer dependency**: "at which release did X change?"
The installed `node_modules/.pnpm/` tree answers it only for the one or two versions that happen to be in the store, which is why the agent kept widening its search.

### The charter contradiction

`.pi/agents/pre-completion-reviewer.md` says "never widen past the repo root" and points at `node_modules/.pnpm/<pkg>@<version>/` for SDK facts.
But three of the four dispatches named `../../pi` — the sibling Pi checkout, which AGENTS.md sanctions and which is **outside** the repo root the agent is forbidden to leave.
Round 2's report says so explicitly: it read the sourcemap instead "since that's outside this worktree's permitted root".
So the agent was handed a question its own scope rule forbids it to answer directly, and `find /` is what that dead end looks like from the inside.

### What actually worked

Round 3 and 4 succeeded by pulling **published npm tarballs** (`pnpm view` / registry download) for the exact versions in question — and round 3 caught a real error in my own derivation that way, where my git-tag sampling had bracketed `0.80.7` and I misread the bracket as the boundary.
That technique is nowhere in the agent's charter.

### Candidate fixes for the agent file

- Name the sanctioned out-of-repo read paths explicitly (the sibling `pi` checkout at `../../pi` from a worktree, `../pi` from the root checkout) as an allowed exception to the repo-root rule, with the AGENTS.md caveat that the checkout runs ahead of the pinned dependency.
- Add "fetch the published tarball for the exact version" (`pnpm view <pkg>@<version> dist.tarball`) as the sanctioned technique for a version-boundary question, ahead of any search widening.
- State that a version-boundary question is the signal: if the answer depends on _when_ a dependency changed, no amount of searching the working tree will produce it.

## Stage: Implementation — TDD (2026-09-11T07:14:12Z)

### Session summary

Executed all seven planned TDD steps plus one unplanned eighth commit, landing the per-API forced-tool-choice map, the two new decision-trail fields, and a dependency-floor raise.
Test count went 54 → 69 (+12 in the new `test/tool-choice.test.ts`, +3 per-API assertions in `test/model-review.test.ts`); 6 → 7 test files.
The pre-completion reviewer ran four rounds: FAIL, FAIL, FAIL, PASS — each FAIL a real defect, two of them in claims I had derived myself.

### Observations

#### Deviations from the plan

- **Step 1's killing mutation killed nothing.**
  The plan predicted that flipping the hoisted fixture's `provider` would redden `typo-reviewer.test.ts`'s `modelId` assertions.
  It does not: `modelId` derives from `CONFIG.provider`/`CONFIG.model`, and the model object is used only for identity (`toHaveBeenCalledWith(MODEL)`).
  No field of the fixture was load-bearing until the `api` default landed at step 5, where flipping it reddens three tests across two suites — verified there instead.
  A pure fixture hoist may simply have no field-level mutation available; the plan asserted one without checking.
- **`latencyMs` is weakly pinned.**
  Setting it to `0` kills nothing — the assertions are `typeof === "number"` and `expect.any(Number)`.
  Appropriate for a wall-clock field, but it meant `tsc` (TS2741) was the discriminating instrument for step 2, not the suite.
  The two new fields are deterministic, so they are asserted by exact value.
- **Step 3's mutation killed two tests, not the predicted one.**
  The `model-unresolved` case also asserts `modelCalled` through `expect.objectContaining`, which the plan's count missed.
- **An eighth commit: `fix(pi-permission-model-judge)!: require pi-ai 0.84.3`.**
  Not in the plan, and it inverts the plan's explicit "This is **not** a breaking change" — see below.

#### The floor defect (reviewer round 1)

The plan's own Background table recorded that `openai-responses` is "dropped entirely on the 0.79.1 floor", and then reasoned as though all ten rows were live.
Three of them are not: `pi-ai` does not read `options.toolChoice` on `openai-responses` or `openai-codex-responses` before v0.80.7, nor on `azure-openai-responses` before v0.84.3, and the package declared `>=0.79.0`.
So the fix's stated scope — "every OpenAI-compatible provider" — was false across most of the supported range, and the `docs/configuration.md` sentence saying so would have shipped.
This is AGENTS.md's [#812] rule exactly: a dependency-floor claim is a claim about **each symbol at the candidate floor**, not about the release that introduced the feature.
I had the disconfirming fact in hand at planning time and wrote it down as a parenthetical rather than as a contradiction.

The operator chose the floor raise over documenting the gate.
That turned out to carry two type-level SDK migrations — `complete` moved to pi-ai's `compat` entrypoint, and `ResolvedRequestAuth.headers` widened to `ProviderHeaders` — neither of which I had priced in the gate.
Both are runtime-neutral within the supported range (Pi's extension loader maps the pi-ai root to `compat` for extensions), but an option priced as "a semver-major bump" was in fact a major bump plus a migration.

#### Two rounds spent on one sentence

Rounds 2 and 3 both failed on the `BREAKING CHANGE:` footer, and both times the defect was a claim I had derived and the reviewer had not.

- Round 2: the footer said "on an older Pi the extension still loads".
  False — `pi-coding-agent@0.79.1`'s loader has no `compat` alias and `pi-ai@0.79.1` exposes no `./compat` export, so the import resolves by no route and the extension fails to load outright.
- Round 3: my correction said the load floor was 0.80.7.
  Also false — I had sampled tags `v0.79.1`, `v0.80.7`, `v0.82.0`, … and read the earliest tag I happened to test as the boundary.
  The alias is already present at `v0.80.0`; the true installable floor is 0.80.1, since 0.80.0 was tagged but never published.

The generalizable error is the same both times and is the sharper version of [#812]: **a bracket is not a boundary**.
Sampling `A` (absent) and `B` (present) establishes the change happened in `(A, B]`, and nothing more.
Naming `B` as the boundary in user-facing text is an invention unless every version between was checked — and the answer must come from the **registry** (`pnpm view <pkg> versions`), not from git tags, because a tagged version that was never published is not a version any operator can be on.

#### Reviewer effectiveness

All four rounds were worth their cost, which is not the usual pattern.
The deterministic checks were green from round 1 onward; every finding was a judgment defect in a factual claim, and three of the four came from the reviewer independently re-deriving something I had asserted.
The explicit "verify rather than accept" framing in each dispatch prompt, naming which of my claims to re-derive, is what produced them.

See the User Note above for the `find /` problem these dispatches exposed in the reviewer's own charter.

#### Reviewer verdict

Pre-completion reviewer: **PASS** (round 4, commit `083efff6`).
Rounds 1–3 returned FAIL; each finding was fixed and re-dispatched scoped to the delta.
No warnings outstanding.
One non-blocking observation carried forward: the plan document states "This is **not** a breaking change", which the shipped `fix(...)!:` commit contradicts.
The plan is a historical artifact and was deliberately left unedited — `/ship`'s close comment should say so, so a reader of the plan is not misled.

[#812]: https://github.com/gotgenes/pi-packages/issues/812
