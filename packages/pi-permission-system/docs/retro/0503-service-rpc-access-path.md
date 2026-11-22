---
issue: 503
issue_title: "pi-permission-system: migrate the service/RPC path queries onto AccessPath (Phase 7 Step 2)"
---

# Retro: #503 — Migrate the service/RPC path queries onto AccessPath (Phase 7 Step 2)

## Stage: Planning (2026-06-29T15:29:08Z)

### Session summary

Planned Phase 7 Step 2: route the `Symbol.for()` service (`LocalPermissionsService.checkPermission`) and the deprecated event-bus RPC (`permissions:rpc:check`) path queries through `AccessPath` so external policy queries for `path` / `external_directory` / path-bearing surfaces match the lexical aliases ∪ canonical set the gates do (the [#486] / [#502] parity).
The design routes both consumers through the **resolver** (`resolve(intent)`) rather than `manager.check`, so the resolver becomes the sole `path-values` producer — the premise Step 5 ([#506]) decides the boundary against.
Produced a three-step plan (two breaking `feat!:` migrations — service then RPC — plus docs) at `docs/plans/0503-service-rpc-access-path.md`.

### Observations

- **Routing through the resolver is roadmap-blessed, not just cleaner.**
  The manager's `check` accepts only `ResolvedAccessIntent` (`tool | path-values`) and never imports `AccessPath`.
  Having the service/RPC build a `path-values` intent themselves would make them a *second* `path-values` producer, contradicting Step 5's ([#506]) explicit premise.
  Emitting `access-path` to `resolver.resolve` (the single unwrap site) is the intended design and a clean 1:1 substitution for today's `manager.check(intent, sessionRules.getRuleset())` — the resolver subsumes the dropped `SessionRules` dependency.
- **Discovered a latent gap the migration fixes for free.**
  `buildInputForSurface` only wires the value into `external_directory` (returns `{ path }`); for `path` and the path-bearing tools it returns the catch-all `{}`, so a query like `checkPermission("read", "/p")` today drops the path and evaluates `["*"]` (asserted by `test/service.test.ts`).
  Building an `AccessPath` for the whole `PATH_SURFACES` set fixes this drop as a natural consequence — folded into the breaking surface, not deferred.
- **Two breaking `feat!:` commits, each independently green.**
  Step 1 migrates the service (moves the `resolver` const up in `index.ts`, leaves the RPC on its old deps); Step 2 migrates the RPC (reuses the moved-up resolver).
  Splitting avoids a single oversized commit while keeping each compilable — the constructor/deps changes each have a single production call site (`index.ts`).
  The helper `buildAccessIntentForSurface` lands in Step 1 with the service as its first consumer, so `pnpm fallow dead-code` never sees it unused.
- **`#502` was the template.**
  Loading the [#502] plan/retro gave the `access-path` intent shape, the `node:fs` `realpathSync` mock convention, and the [#502] lesson that a type-only parameter change can yield a *hollow red* under esbuild — flagged so Step 1/2's reds exercise the new behavior (canonical match), not just the new signature.
  Also carried forward the [#502] caution to run `fallow dead-code` for a stale suppression.
- **`buildInputForSurface` stays exported** — it is the `tool`-branch input builder inside `buildAccessIntentForSurface` and is imported by `test/service.test.ts`; its `external_directory` branch becomes test-only but is not dead (still exported + imported).
- **Skipped the `ask_user` gate:** operator-authored issue, unambiguous and roadmap-blessed proposal; the only design nuance (resolver-injection vs. a localized swap) is settled by Step 5's premise, not a genuine open choice.
- **Release:** Step 2 of batch "symlink-resistant-path-matching" (tail = Step 3, [#504]); mid-batch → defer.
  The breaking `feat!:` commits land on `main` and auto-batch; the major-bump release cuts when Step 3 lands.

## Stage: Implementation — TDD (2026-06-29T11:55:00Z)

### Session summary

Implemented all three planned TDD steps plus an unplanned cleanup: the breaking `feat!:` service migration (Step 1), the breaking `feat!:` RPC migration (Step 2), the `docs:` roadmap/API updates (Step 3), and a `refactor:` un-exporting `buildInputForSurface`.
Test suite went 2215 → 2222 (+7); `pnpm run check`, root `pnpm run lint`, full `pnpm run test`, and `pnpm fallow dead-code` all green.
Pre-completion reviewer returned PASS with no warnings.

### Observations

- **The design matched the plan exactly — routing through the resolver was the load-bearing decision.**
  Both consumers emit an `access-path` intent to `resolver.resolve` (never building `path-values` themselves), so the resolver stays the sole `path-values` producer (the [#506] premise).
  The service collaborators narrowed cleanly from `(manager, sessionRules, …)` to `(resolver, session, …)` — the resolver subsumes the session-ruleset composition, so it was a 1:1 substitution plus the per-call `getPathNormalizer()` fetch.
- **Two deviations, both follow-the-evidence cleanups:**
  1. `buildInputForSurface` was made module-private (the plan said keep it exported).
  Once `test/service.test.ts`'s adapter block was rewritten to drive the real `LocalPermissionsService`, the export had no remaining external consumer.
  `pnpm fallow dead-code` passed either way (internal caller present), but un-exporting is the honest surface — landed as a separate `refactor:` commit.
  2. The `service.test.ts` "service adapter delegation" describe (a hand-rolled `buildInputForSurface` adapter simulating the *old* `index.ts` wiring) was renamed to "service round-trip through the global slot" and rewritten to exercise the real class, deleting the stale `read → {}` assertion that documented the latent value-drop bug.
- **The latent gap is real and now fixed end-to-end.**
  `buildInputForSurface` returned `{}` for the `path` and path-bearing surfaces, so those service/RPC queries collapsed to `["*"]` and dropped the supplied path — only `external_directory` ever worked.
  Added a composition-root end-to-end test (`#503`) proving a `path`-surface service query now resolves against a deny rule on the supplied path; this distinguishes new behavior from old without needing a symlink (a pure value-passing proof).
- **`PermissionRpcDeps.session` widening cascaded to the prompt tests.**
  Adding `getPathNormalizer` to the narrow `session` view broke the prompt-RPC tests' inline `session: { getRuntimeContext }` overrides at `tsc` time (not at runtime — esbuild skips types).
  Resolved by extracting a `makeSession(ctx)` helper so all overrides carry both methods; caught only by `pnpm run check`, a reminder to run it after a shared-interface change.
- **ESLint auto-fixes fired twice on commit** (stripping unnecessary `!` non-null assertions on `mock.calls[0]![0]` and a redundant return-type cast) — the pre-commit hook modified files and aborted the commit; re-staging and re-committing cleared it both times.
- **Pre-completion reviewer: PASS** — no warnings; verified the resolver-routing invariant, the `✅` Step 2 markers (heading + `S2` Mermaid node), conventional-commit/BREAKING-CHANGE correctness, and the two deviations as sound.

## Stage: Final Retrospective (2026-06-29T17:01:27Z)

### Session summary

Shipped Phase 7 Step 2 across plan → TDD → a user-prompted guideline re-review → ship in one continuous session: two breaking `feat!:` migrations (service then RPC), a `docs:` roadmap/API update, and a `refactor:` un-export, plus two `test:` conformance fixes surfaced by the re-review.
The operator deferred the release (mid-batch, batch "symlink-resistant-path-matching", tail = Step 3 [#504]); commits landed on `main`, CI passed, and the issue stays open until the batch tail ships.
A clean run with no rework — the only friction was minor tool-usage slips and three testing-skill rules under-applied during test authoring, all caught before ship.

### Observations

#### What went well

- **The [#502] template carried the whole batch.**
  Reusing the [#502] plan/retro, the already-migrated `path.ts` / `path.test.ts`, and the `node:fs` `realpathSync` mock convention made [#503] a near-mechanical parallel — the design matched the plan exactly, every invariant at risk was predicted, and the pre-completion reviewer returned PASS first try.
  This is the second batch member to ship cleanly off the same template (cross-stage pattern).
- **Release coordination handshake worked as intended.**
  The plan's `**Release:** mid-batch — defer` marker drove a single up-front `ask_user` at ship time; the operator confirmed defer, and steps 5–6 (close + release-please merge) were skipped cleanly with the issue left open.
- **Incremental verification held the line.**
  Each TDD step ran its affected test file (red→green), `pnpm run check` ran immediately after the interface changes, and the full suite + root lint + `fallow dead-code` ran after the last step — no end-of-session surprise.
  `pnpm run check` was the *only* gate that caught the `PermissionRpcDeps.session` widening break (the prompt tests passed under esbuild), validating the "run check after a shared-interface change" rule.

#### What caused friction (agent side)

- `instruction-violation` (self/tool-caught) — authored the new tests against three testing-skill rules that were loaded but not applied: `mock.calls[0]![0]` with a `!` (the skill says use `toHaveBeenCalledWith` / drop the `!`), `ReturnType<typeof vi.fn<…>>` instead of `Mock<Sig>`, and a missing `beforeEach` `realpathSync` reset in the RPC suite.
  The `!` was stripped by the ESLint pre-commit hook (aborting two commits, re-staged); the other two passed the pre-completion reviewer and were caught only by the operator's "do they meet our guidelines?" prompt.
  Impact: two ESLint commit re-tries plus two follow-up `test:` commits (`dc79ed9b`, `5b5e2553`) — no behavior rework.
- `other` (Edit-tool misuse) — twice packed two replacements into one `edits[]` object via `oldText2`/`newText2` keys; the tool rejected with "must not have additional properties."
  Impact: two rejected tool calls, immediately re-issued as separate array entries — no rework.
- `other` (path slip) — once issued a `Read` with a doubled absolute path (`…/pi-packages/packages/pi-permission-system/packages/pi-permission-system/…`), denied by the permission gate.
  Impact: one denied call, corrected immediately.

#### What caused friction (user side)

- The operator's mid-flight "take one more review of the code changes — do they meet our guidelines?" was a high-value strategic intervention, not mechanical oversight: it surfaced two testing-skill conformance gaps the pre-completion reviewer's PASS had missed.
  Framed as opportunity: the reviewer's design lens (2d) loads the `code-design` skill for `src/` files but has no symmetric lens that loads the `testing` skill for `test/` files, so test-code convention drift currently relies on a manual prompt to catch.

### Diagnostic details

- **Model-performance correlation** — the only subagent dispatch was the `pre-completion-reviewer` on `anthropic/claude-sonnet-4-6` (per its `model:` frontmatter), appropriate for judgment-heavy review.
  Its PASS was correct within its checklist; the two missed items are outside its current coverage (no test-conformance lens), a checklist-scope gap rather than a model mismatch.
- **Escalation-delay tracking** — no `rabbit-hole`; no error or approach occupied more than two consecutive tool calls before resolving.
- **Unused-tool detection** — no `missing-context` gaps warranted an Explore/`colgrep` dispatch; the [#502] template and direct source reads supplied the needed context.
- **Feedback-loop gap analysis** — verification was incremental, not end-loaded: per-file red→green, `pnpm run check` right after the RPC interface change (the gate that caught the `session`-widening break), and the full suite/lint/fallow after the final step.

### Changes made

1. `.pi/agents/pre-completion-reviewer.md` — broadened section 2d ("Code design review") applicability to `src/` **or** `test/` files, and added a `testing`-skill spot-check for changed `test/` files (mock fields typed `Mock<Sig>` not `ReturnType<typeof vi.fn<…>>`; module-scope `vi.fn()` stubs reset in `beforeEach`; mock-call assertions via `toHaveBeenCalledWith` not `mock.calls[0]![0]`), reported as WARN; updated the output-format SKIP line and added a sample test-conformance WARN.
2. `packages/pi-permission-system/docs/retro/0503-service-rpc-access-path.md` — this Final Retrospective stage entry.
