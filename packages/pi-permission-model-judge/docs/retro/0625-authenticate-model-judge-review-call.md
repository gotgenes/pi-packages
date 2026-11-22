---
issue: 625
issue_title: "pi-permission-model-judge never authenticates its model call, so it defers every path to the human"
---

# Retro: #625 — pi-permission-model-judge never authenticates its model call

## Stage: Planning (2026-07-21T00:14:52Z)

### Session summary

Planned the fix for the model-judge reviewer never authenticating its model call, so it fail-safe-defers every path.
The primary fix resolves auth via `registry.getApiKeyAndHeaders(model)` in `createTypoReviewer` (symmetric with the existing `find`) and threads `apiKey`/`headers` into `reviewPath`'s `complete` call.
The secondary fix features a corrected dropped-prefix typo pattern (`pi-[^/]+(/|$)`) in the shipped example config and docs.

### Observations

- The primary defect is unambiguous and matches the issue's proposal exactly; the ambiguity was in the secondary defect's scope.
- State mismatch on the secondary defect: the buggy dropped-prefix pattern `development/pi/(?!pi-packages/)pi-[^/]+/` lives only in the `#600` retro (ship-excluded).
  The shipped example config + `docs/configuration.md` feature only the doubled-package pattern `([^/]+)/packages/\1(/|$)`, which already carries the `(/|$)` anchor (added in `abcfa23e`, before this issue was filed).
  So "the shipped example config and docs should carry the corrected pattern" did not map cleanly to the current tree.
- Resolved via `ask_user`: operator chose to feature both corrected typo patterns in the shipped artifacts, and to verify with unit tests plus a manual OAuth dogfood note.
- Design decision: resolve auth in `typo-reviewer.ts` (where the registry already lives), not in `reviewPath` — keeps `reviewPath` registry-free and warn-free (Law of Demeter), and mirrors the existing model-resolution placement.
- `ResolvedRequestAuth` is not re-exported from `@earendil-works/pi-coding-agent` (only the `ModelRegistry` class is), so the plan redeclares a minimal local type — consistent with `ModelRegistryLike` already being a local ISP projection.
- Featuring the dropped-prefix pattern also requires extending the example config's `instructions` so the model recognizes the dropped-`pi-packages/packages/` typo class, not just the doubled-package one.
- Test-fixture touch points: `makeRegistry` (`typo-reviewer.test.ts`) and `ctxWithRegistry` (`extension.test.ts`) both need a `getApiKeyAndHeaders` stub, or the model-consulting tests throw at runtime and false-red the deny assertions.
- Release: ship independently — no roadmap batch references this issue; `fix:` cuts a release on land.

## Stage: Implementation — TDD (2026-07-21T00:53:18Z)

### Session summary

Implemented the auth fix across three TDD cycles: (1) widened `CompleteFn`/`ModelRegistryLike`/`ReviewPathInputs` and forwarded `apiKey`/`headers` in `reviewPath`; (2) resolved auth via `registry.getApiKeyAndHeaders(model)` in `createTypoReviewer` with a defer+warn fail-safe branch; (3) featured the corrected dropped-prefix typo pattern in the example config, README, docs, and corrected the stale `#600` retro pattern.
Test count went from 37 to 40 (+3) in the package; full suite, `check`, `lint`, and `fallow dead-code` all green.

### Observations

- Deviation from the plan: the `makeRegistry` test-fake `getApiKeyAndHeaders` stub was folded into step 1 instead of step 2.
  Widening `ModelRegistryLike` with a **required** `getApiKeyAndHeaders` breaks the fake at type-check time (`TS2741`), so the fixture must be satisfied in the same commit as the interface change to keep `pnpm run check` green at the step-1 boundary.
  Noted in the step-1 commit body.
- `extension.test.ts`'s `ctxWithRegistry` fake, by contrast, breaks only at **runtime** (its ctx is passed through an `unknown`-typed lifecycle map, so tsc does not check its shape), so its `getApiKeyAndHeaders` stub correctly landed in step 2 with the auth-resolution behavior.
- The `if (!registry || !model)` guard narrows `registry` to defined for the `getApiKeyAndHeaders` call, so no non-null assertion was needed (avoids the Biome/ESLint assertion loop).
- Ironic live validation: an `Edit` to `docs/configuration.md` used a dropped-prefix absolute path (`/Users/chris/development/pi/pi-permission-model-judge/...`) and the permission guard denied it — exactly the typo class this issue's secondary pattern targets.
  Retried with the correct relative path.
- Corrected dropped-prefix pattern `development/pi/(?!pi-packages/)pi-[^/]+(/|$)` verified against all four edge cases (bare package path → match, doubled → match, correct `pi-packages` → no match, sibling `pi` monorepo → no match) via `node -e` before landing.
- Pre-completion reviewer: PASS — all deterministic checks green, no design/doc/test-artifact concerns.
- Not yet done (manual verification the operator requested): a live OAuth dogfood confirming a real typo path now reaches a `deny` before the human.
  Deterministic unit coverage is complete; the manual note is confirmation, not the gate.

## Stage: Dogfood verification — blocked on #626 (2026-07-21T01:05:00Z)

### Session summary

Attempted the live-OAuth dogfood after restarting the Pi session (which reloads the extension from `./src/index.ts` — no `dist/`, so the fixed source is active).
The attempt was **inconclusive**: a candidate path that matches a `typoPattern` still deferred to the human, and the judge records nothing, so we cannot tell whether the auth fix works, the model returned `defer`, or the 401 persists.
Decision (operator): **hold #625 unshipped on `main`**, plan+build **#626** (model-judge observability) first, then use its decision trail to verify #625 before shipping either.

### Observations

- **Bash asks cannot trigger the judge.**
  The `pi-permission-system` review log shows `bash` requests arrive with `"path":null` — the external path lives only in `command`/`accessIntent.matchValues`, but the judge's `pathOf(details)` reads `details.path ?? details.value`.
  So a `cat <typo-path>` defers before pattern-matching ever runs.
  Only file tools (`read`/`edit`/`write`) populate `details.path`; use those to trigger the judge.
- **A matching file `read` still deferred.**
  The doubled-package path `/Users/chris/development/pi/pi-permission-system/packages/pi-permission-system/src/handlers/gates/bash-command.ts` (matches pattern 1) went straight to `permission_request.waiting` → human-approved, with no judge `denied` event.
  It should have reached the model.
- **Why it deferred is unknowable from outside** — this is exactly #626's thesis.
  A 401 is swallowed silently by `reviewPath`'s `try/catch` → `defer`; auth-success-model-said-defer and auth-fail-401-throw are indistinguishable.
  `console.warn` (the package's only sink) is not persisted — zero model-judge entries in any `~/.pi/agent/**/logs/*.jsonl`.
- **Operator config drift:** the live global `pi-permission-model-judge/config.json` still carries the OLD buggy dropped-prefix pattern `development/pi/(?!pi-packages/)pi-[^/]+/` (bare trailing `/`), not the corrected `(/|$)` shipped in this issue's example config.
  Update the operator config (and reload) before dogfooding the dropped-prefix case.
- **#626 design fork to settle in its `/plan-issue`:** (1) route through the `pi-permission-system` review log via a new cross-extension logging seam injected into `Authorizer`s (single audit trail, **cross-package**), vs (2) the judge writes its own JSONL under its config dir (self-contained, **single-package**).
  Operator leans (1); issue flags it as "worth deciding as part of this."
- **Verification recipe for when #626 lands:** trigger via a file tool on a doubled-package path, read the new decision trail, and confirm the entry shows model-called → `deny` (not a defer-reason of `auth-failed`/`model-unresolved`).

## Stage: Dogfood verification — CONFIRMED via #626 trail (2026-07-21T23:25:00Z)

### Session summary

Ran the verification after #626 landed and the Pi session was restarted (twice — the running session must reload to pick up new `./src/index.ts` code).
Triggered the judge via a `read` on a doubled-package typo path; the new `model_judge.decision` review entry recorded `modelCalled: true`, `latencyMs: 1426`, no `auth-failed`.
**#625's auth fix is confirmed working end to end** — the model is now reached authenticated under OAuth, closing the silent-100%-defer bug.

### Observations

- Decision-trail entry (ground truth): `{"event":"model_judge.decision","path":".../pi-permission-system/packages/pi-permission-system/src/handlers/gates/bash-command.ts","matchedPattern":"([^/]+)/packages/\\1(/|$)","modelCalled":true,"modelId":"anthropic/claude-haiku-4-5","latencyMs":1426,"verdict":"defer","deferReason":"parse-failed"}`.
- A **separate** defect surfaced immediately: `deferReason: "parse-failed"`.
  The model replied but `reviewPath`'s `JSON.parse` threw — the reply was not strict JSON (likely a Markdown code fence or prose preamble around the object; debug log was off so the literal bytes were not captured).
  Distinct root cause from #625 (reply-format robustness, not auth).
- Filed as **#628** — "reaches the model but defers on `parse-failed` — force a structured tool call."
  Operator's chosen fix direction: force a single verdict tool via `toolChoice: "any"` and read `ToolCall.arguments` directly, rather than parse free text.
  SDK feasibility confirmed: Anthropic provider honors `toolChoice`; `convertTools` reads only `parameters.properties`/`required` (plain JSON-Schema, no `typebox`); `toolChoice: "any"` avoids the OAuth `toClaudeCodeName` name-rewrite mismatch.
- This is also a clean validation of #626: the auth fix's success **and** the next defect both showed up in one log line, instead of an SDK spelunk.
- Ship decision: **#625 ships now, batched with #626 in this release** (both committed on `main`, unpushed).
  Issue #628 is future work for a later release.

## Stage: Final Retrospective (2026-07-21T23:43:38Z)

### Session summary

#625 ran the full multi-stage arc: plan → TDD (3 cycles, +3 tests) → an inconclusive dogfood → a deliberate hold to build observability (#626) first → confirmed verification via the new decision trail → ship.
The auth fix is released (it rode `pi-permission-model-judge` v1.0.2, cut during #626's work); the `/ship-issue` run reconciled that, closed #625 and #626, and merged the v1.1.0 release-please PR for #626's model-judge half.
Verification also surfaced a distinct downstream defect (`parse-failed`), filed as #628.

### Observations

#### What went well

- **Observability-first verification was the decision of the arc.**
  Rather than ship #625 on green unit tests and a blind dogfood, the operator held it and built #626 (the decision trail) first.
  That trail then confirmed #625 (`modelCalled: true`, no `auth-failed`) **and** surfaced the next defect (#628, `parse-failed`) in a single log line — the exact SDK spelunk #626 was meant to eliminate, avoided on its first live use.
  The general lesson: a fix to a silent-failure path is not "verified" until there is a way to observe the path; build the observation before declaring the fix done.
- **`/ship-issue` step 4b handled a genuinely tricky release state cleanly.**
  Issue #625's `fix:` commits had already been released in v1.0.2 (a release cut during #626's development), yet the issue was still open.
  The package-scoped tag anchoring (`pi-permission-model-judge-v*`) plus the stacked-release check detected "already released," closed #625 against its real version (v1.0.2), and separately closed #626 as stacked work — no fabricated version, no double-release.

#### What caused friction (agent side)

- `missing-context` — the first dogfood triggers used `bash cat <typo-path>` and misread a `read` `ENOENT` as "not gated," before learning from the review log that the judge only sees `details.path ?? details.value`; a `bash` ask carries its path in `accessIntent.matchValues`, invisible to the judge, so only file tools (`read`/`edit`/`write`) can trigger it.
  Impact: a handful of wasted trigger attempts and log spelunking — but largely inherent investigation (the opacity that motivated #626 was real), so little true rework.
- `other` (mental-model gap) — the verification stage framed the plan as "#625 ships now, batched with #626 in this release," but #625's commits were already released in v1.0.2; holding the **issue** open never held its **commits** from release.
  Impact: one mildly-inaccurate retro note; zero rework, since `/ship-issue` reconciled the actual state.

#### What caused friction (user side)

- Minimal — the operator drove the two pivotal decisions (hold-for-observability, and the forced-tool-call direction for #628) crisply through the `ask_user` gates.
  One small opportunity: the "restart Pi to reload `./src/index.ts`" requirement surfaced only after a denied trigger attempt; flagging it before the first trigger would have saved a round-trip.

#### Product gap noted (candidate future issue)

- The judge cannot review a typo path embedded in a `bash` command — `pathOf` reads `details.path ?? details.value`, but `bash` asks place the external path in `accessIntent.matchValues`.
  So `bash`-surfaced typo paths silently bypass the judge.
  Worth a dedicated issue (widen `pathOf` to consult `accessIntent`), separate from #628 — filed as #630.

### Diagnostic details

- **Model-performance correlation** — the main session moved `opus-4-8` → `sonnet-5` → `opus-4-8`; the `tidy-first-assessor` and `pre-completion-reviewer` subagents ran on their configured models over appropriate read-only/review tasks.
  No reasoning-weak-on-judgment or high-cost-on-mechanical mismatch.
- **Feedback-loop gap** — none.
  `pnpm run check` ran immediately after TDD step 1 and caught the `makeRegistry` `TS2741` break at the right boundary; per-file test runs each cycle, full suite + lint + fallow at the end.
- **Escalation-delay / unused-tool** — the "why does it defer" investigation stayed under the 5-call threshold and produced the correct conclusion (#626 is needed), not thrashing; no Explore/Plan subagent would have helped, since the answer lived in runtime logs and the `pathOf` source, both read directly.

### Changes made

1. `AGENTS.md` — added a release-batching clarification: release is driven by the release-please PR merge over `main` commits, independent of issue open/closed state; holding an issue open does not defer its already-merged `fix:`/`feat:` commits, and the only defer lever is leaving the release-please PR unmerged (Refs #625).
2. Filed **#630** — the judge cannot review typo paths inside `bash` commands (`pathOf` ignores `accessIntent.matchValues`); distinct from #628.
3. `packages/pi-permission-model-judge/docs/retro/0625-authenticate-model-judge-review-call.md` — this Final Retrospective entry.
