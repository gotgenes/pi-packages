# Evidence brief: pi-permission-model-judge

## Purpose signal

The package exists to turn one repetitive hand-denial into an automatic, explained denial.
`packages/pi-permission-model-judge/README.md` opens with it: the extension "reviews out-of-directory permission asks with a light model and auto-denies mistyped paths with a teaching reason", and the `## Why` section names the concrete case — an agent invoking a tool against `…/pi-permission-system/packages/pi-permission-system/src/x.ts` where the doubled segment should be `pi-packages`, which "lands as an `external_directory` ask you hand-deny, one by one".
`packages/pi-permission-model-judge/package.json` states the same in one line: "Deny-first typo-path model judge — a pi-permission-system Authorizer chain link".

Its second purpose is structural: it is the first — and deliberately first-party — consumer of a seam that would otherwise go vacant.
`packages/pi-permission-model-judge/docs/plans/0600-dogfood-model-judge-authorizer.md` § Problem Statement says "The `registerAuthorizer` seam shipped in [#599] is a live-authority extensibility point with no consumer", that "[#267] history guard warns that an inbound registration surface nobody consumes goes vacant", and that ADR 0007 "makes a first-party consumer slice 1's acceptance criterion — a design safeguard, not a demo".

The advise-don't-authorize boundary is recorded explicitly, in the artifacts and in the source.
`README.md` § How it works: "It is fail-safe by construction: a missing model, invalid config, model timeout, unparseable reply, or an unsure verdict all resolve to `defer`… this extension only ever *removes* a hand-denial, never grants access (it emits no `allow`)".
`packages/pi-permission-model-judge/docs/configuration.md` § Two config files, one link name states the division of authority directly: "This extension owns only the *model mechanism*.
The *chain policy* — whether the link runs at all, and its order — lives in `@gotgenes/pi-permission-system`… The link decides nothing until you name it in `authorizerChain` (opt-in activation), and pi-permission-system caps any link's authority, so this extension can only ever deny or defer an `external_directory` ask — never widen access." `packages/pi-permission-model-judge/src/typo-reviewer.ts`'s module docstring repeats it as an invariant: "Every failure path defers — more prompting, never less (ADR 0007 invariant 2).
This slice never emits `allow`."

The third recorded purpose is observability of its own decisions, added after a silent-failure bug.
`README.md` § What it records frames it as answering "did the judge run, did it reach the model, and why did it defer?"
without guesswork, and notes that "a misconfiguration that silently defers every path… shows up as a run of `deferReason` entries rather than an empty log".

## In-scope signal

Building the reviewer itself: the zod config schema and layered loader, typo-pattern compilation and matching, model confirmation, the deny-first reviewer, and the `permissions:ready` registration all landed as `feat:` commits in one arc (`commit d9cbc7a9`, `commit a4e6639f`, `commit 2439faac`, `commit 27d8c317`, `commit 4ce1ead9`, `commit 0158258e`).

Fixing the model-call mechanism when it fails to reach a verdict.
Auth resolution through `registry.getApiKeyAndHeaders(model)` (`commit 98360207`, `commit 4c906031`, issue #625) and forcing a structured `report_verdict` tool call instead of parsing free text (`commit 5a89bba9`, issue #628) are both squarely in scope — `docs/plans/0628-force-structured-verdict-tool-call.md` § Goals frames it as removing "the `parse-failed` failure mode by construction".

Widening which asks reach the model, when the surface is still `external_directory`.
`commit 782c83d3` ("review typo paths embedded in bash commands", issue #630) made the reviewer read `details.accessIntent.matchValues`, so a typo path inside `cat …` is reviewed like a file-tool path.
`docs/plans/0630-review-typo-paths-in-bash-commands.md` § Risks argues the widening direction is the safe one: "this is the safe direction (more prompting, never less — ADR 0007 invariant 2)".

Recording its own decision trail — into the sibling's log, not its own.
`commit 9098f465`, `commit 4db29fbf`, and `commit e3d6778c` ("record the decision trail to the permission review log", issue #626) added defer-reason discrimination, the matched pattern, and the `model_judge.decision` record.

Aligning its config plumbing with the rest of Pi.
`commit 079e9a6e` ("resolve the global config scope via getAgentDir", issue #732) moved the env read to the extension boundary so the global scope honors `PI_CODING_AGENT_DIR` the way `@gotgenes/pi-permission-system` does.

Tuning the shipped example patterns and their documentation.
`commit abcfa23e` and `commit 13553d5c` feature the doubled-package and corrected dropped-prefix typo patterns in `config/config.example.json`, `README.md`, and `docs/configuration.md`.

## Candidate non-goals

- **Emitting an `allow` verdict (granting access)** — the reviewer's verdict range is `deny | defer` by design, not by omission.
  `docs/plans/0600-dogfood-model-judge-authorizer.md` § Goals: "A deny-first reviewer with verdicts `deny | defer` only (no `allow` in this slice, per ADR 0007's capability gradient)", and § Non-Goals: "this package emits no `allow` verdict".
  Reasserted in `docs/plans/0625-authenticate-model-judge-review-call.md` § Non-Goals ("No change to the verdict range or the fail-safe semantics — the reviewer still only emits `deny | defer`, never `allow`") and in `README.md` § How it works.
- **Deciding permission on its own authority** — the judge advises and the permission system decides, and the artifacts state the cap rather than assume it.
  `docs/configuration.md` § Two config files, one link name: "The link decides nothing until you name it in `authorizerChain` (opt-in activation), and pi-permission-system caps any link's authority".
  `docs/plans/0600-dogfood-model-judge-authorizer.md` § Background traces the enforcing mechanism (`encloseInDelegationEnvelope` caps a link's `allow` on `external_directory`/`path` to `defer`).
- **The allow-capable opaque-bash adjudicator** — explicitly out of this package and routed elsewhere.
  `docs/plans/0600-dogfood-model-judge-authorizer.md` § Non-Goals: "The allow-capable opaque-bash adjudicator (ADR 0007 slice 2 / use case 2) — deferred to [#620]".
  Issue #620 is still open against `pi-permission-system`, and its body records why the seam shipped conservatively: "its only day-one consumer (#600) is deny-first and never allows".
- **Reviewing surfaces other than `external_directory`** — hardcoded on an operator decision, with generalization deferred.
  `docs/plans/0600-dogfood-model-judge-authorizer.md` § Non-Goals: "A configurable `reviewSurfaces` list — this slice hardcodes `external_directory`; generalizing the reviewed-surface set is a future concern".
  `docs/retro/0600-dogfood-model-judge-authorizer.md` § Planning records it as an operator choice: "review scope = **`external_directory` only, hardcoded** (defer all other surfaces cheaply)".
  `docs/plans/0630-review-typo-paths-in-bash-commands.md` § Non-Goals repeats it against the adjacent surface: "No change to the `bash-path` surface (`surface: "path"`) — the reviewer only reviews `external_directory`".
- **Re-querying the permission engine to reach a verdict** — the injected `PermissionQuery` is accepted and deliberately unused.
  `docs/plans/0600-dogfood-model-judge-authorizer.md` § Design Overview: "the deny-first reviewer decides from the path pattern and the model, not from an engine re-query.
  Slice 2 ([#620]) is the consumer that needs it".
  `docs/plans/0625-authenticate-model-judge-review-call.md` § Non-Goals: "No new slice-2 behavior (engine re-query); `query` remains unused here".
- **Changing `@gotgenes/pi-permission-system` source** — the package is a pure downstream consumer, restated across two plans.
  `docs/plans/0600-dogfood-model-judge-authorizer.md` § Non-Goals: "Any change to `@gotgenes/pi-permission-system` source — the seam, the delegation envelope, and the `authorizerChain` config already shipped in [#599].
  This package is a pure downstream consumer." `docs/plans/0630-review-typo-paths-in-bash-commands.md` § Non-Goals: "No change to the raising gates in `@gotgenes/pi-permission-system` — the fix is entirely inside this package's reviewer.
  The gate's worst-path selection is relied upon, not modified."
- **Keeping its own audit log** — a decided fork, not an omission.
  Issue #626 posed the two options ("Route through the `pi-permission-system` review log… Have the judge write its own JSONL under its config dir"), and `docs/retro/0625-authenticate-model-judge-review-call.md` § Dogfood verification records the operator leaning toward the shared trail: "(1) route through the `pi-permission-system` review log via a new cross-extension logging seam… vs (2) the judge writes its own JSONL… Operator leans (1)".
  The landed behavior matches: `commit e3d6778c` writes to the permission review log, and `docs/configuration.md` § The decision trail says "The reviewer records what it did to pi-permission-system's shared logs, keyed by `requestId`".
- **A published cross-extension API surface** — the package is a leaf, by declaration.
  `docs/plans/0600-dogfood-model-judge-authorizer.md` § Non-Goals: "A published cross-extension API surface — this package is a leaf consumer; it exports nothing for other extensions, ships source (no `dist` type bundle, no rollup)".
  `docs/plans/0732-honor-pi-coding-agent-dir.md` § Risks confirms it stayed that way: "The package publishes no `exports` map and documents `src/index.ts` as its only entry".
- **A multi-path review loop over a bash command's external paths** — resolved upstream rather than implemented here.
  `docs/plans/0630-review-typo-paths-in-bash-commands.md` § Non-Goals: "No multi-path review loop.
  The `bash-external-directory` gate already reduces a multi-path command to the single **worst** uncovered path before it escalates… the issue's 'review the worst/boundary path, or review each' question is resolved upstream, not here."
- **Shipping built-in typo knowledge (auto-denying without operator-declared patterns)** — the pattern set is operator-owned, and an unconfigured install is a deliberate no-op.
  `docs/plans/0600-dogfood-model-judge-authorizer.md` § Goals: "Config-driven typo pre-filter: operator-declared `typoPatterns` (regex strings) gate which `external_directory` paths reach the model".
  `packages/pi-permission-model-judge/src/config-schema.ts` states the consequence in a docstring: "An empty or absent `typoPatterns` makes the reviewer defer everything — installing the package and naming it in `authorizerChain` without configuring patterns is a safe no-op (nothing is auto-denied)."

## Adjacent routing signal

Chain policy — whether the link runs, and in what order — is `@gotgenes/pi-permission-system`'s `authorizerChain`, joined to this package by the link name `model-judge` alone (`docs/configuration.md` § Two config files, one link name).
`packages/pi-permission-system/README.md` describes the same seam from the other side and points back: "`@gotgenes/pi-permission-model-judge` is a first-party reference implementation of such a link".

Allow-capable adjudication and opaque-bash decomposition go to `pi-permission-system` issue #620 (ADR 0007 slice 2), per `docs/plans/0600-dogfood-model-judge-authorizer.md` § Non-Goals.

Path-raising and worst-path selection for a bash command belong to `pi-permission-system`'s `bash-external-directory` gate; `docs/plans/0630-review-typo-paths-in-bash-commands.md` § Background traces the gate's `worstEntry` selection and then relies on it rather than reimplementing it.

Persistence and toggles for the decision trail live in `pi-permission-system`: `README.md` § What it records points the review log at `…/pi-permission-system/logs/pi-permission-system-permission-review.jsonl` and gates the cheaper events behind "pi-permission-system's `debugLog` toggle".

Reporting that a chain names `model-judge` but no config was found is deliberately delegated away.
`docs/plans/0732-honor-pi-coding-agent-dir.md` § Open Questions: "the signal lives in `@gotgenes/pi-permission-system` (which knows the chain), not here (which only knows its own config).
Deferred — it is a cross-package observability change… and [#727] is already open on the adjacent `authorizer_chain_unregistered_link` reporting."

OAuth token shaping stays with the auth extension: `docs/plans/0625-authenticate-model-judge-review-call.md` § Non-Goals states "No change to `pi-anthropic-auth`; that extension behaves correctly and applies OAuth shaping automatically once the token is present in `options.apiKey`."

A byte-identical config-scope defect found in a sibling was filed against that sibling rather than fixed here: `docs/plans/0732-honor-pi-coding-agent-dir.md` § Non-Goals routes `packages/pi-autoformat/src/config-loader.ts` to issue #762, and routes the separate subagent chain-registration cause of the same log line to #727 and #699.

Documentation routing: the root `README.md` lists this package among those with "no dedicated skill — their READMEs cover everything you need", and `packages/pi-permission-model-judge/AGENTS.md` says the same.

## Gaps

No external request has ever been declined or redirected here.
`gh pr list --state closed` filtered to unmerged, non-`gotgenes` PRs matching `judge` returned nothing, and the only closed-as-`NOT_PLANNED` issue matching `model-judge` is #581 — a `pi-permission-system` ADR-scoping issue superseded by #591, not a request against this package.
Every recorded boundary above is first-party and self-declared in plans, so the charter has no adversarial pressure behind it.

Whether generalizing the reviewed-surface set is *refused* or merely *not yet built* is unsettled.
`docs/plans/0600-dogfood-model-judge-authorizer.md` § Open Questions leaves the door open — "If a later use case needs the reviewer on other surfaces, add a `reviewSurfaces: string[]` config field then — not now" — which is a deferral, not a boundary.
The operator must state whether a future `reviewSurfaces` is in scope for this package or belongs to a different link.

Whether the package would take on a judgment purpose *other than typo paths* is unrecorded.
The name, description, and every plan address mistyped paths only, but no artifact says the package declines, for example, general path-safety or secret-shape judging.
This is absence, not a boundary; a sentence in the README or a declined issue would confirm it.

Provider support is unstated.
`docs/plans/0628-force-structured-verdict-tool-call.md` § Background verified the forced-tool-call mechanism only against `providers/anthropic.js` (including the OAuth `toClaudeCodeName` rewrite that motivated reading the tool call by position), and the shipped example config names `anthropic` / `claude-haiku-4-5`.
Nothing states whether non-Anthropic providers — or a local model — are supported, best-effort, or out of scope.

Cost and rate policy beyond the two existing gates is unaddressed.
`typoPatterns` is described as "the cost gate" and `timeoutMs` bounds a single call (`docs/configuration.md`), but no artifact takes a position on caching verdicts, per-session call budgets, or batching.
The operator must say whether such controls belong here or are deliberately out.

Persistence of a verdict is unrecorded on this side of the boundary.
Issue #620 attributes non-persistence (`origin: "authorizer:model"`, never `approved_for_session`) to ADR 0007 and to the allow-capable slice in `pi-permission-system`; no artifact in this package states whether a *deny* verdict may ever become a recorded or session-scoped rule.
Given the package emits only `deny`/`defer`, the question is live and unanswered here.
