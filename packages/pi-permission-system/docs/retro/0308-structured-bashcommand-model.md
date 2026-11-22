---
issue: 308
issue_title: "Introduce a structured BashCommand model and parse the bash command once per tool_call"
---

# Retro: #308 — Structured BashCommand model and parse-once injection

## Stage: Planning (2026-06-01T00:00:00Z)

### Session summary

Issue #308 was created during what began as the `/plan-issue 306` session, after the owner asked "what architecture or system design changes would make #306 easier?" and chose to pay the foundation upfront.
The friction analysis surfaced that the three bash gates each parse the command independently (three parses per `tool_call`) and apply three subtly different AST descent policies, and that the command-pattern unit is a flat `string[]` re-derived per feature — the divergence that produced the #301-class bug.
This issue captures the behavior-preserving enabler (a `BashCommand` model for the command-pattern slice plus a single shared parse injected into the gates); #306 (nested-context descent) and #307 (effective-cwd projection) become consumers, mirroring the #304 → #301 split.

### Observations

- Scope was deliberately trimmed from the issue's first draft.
  The original #308 body claimed "path candidates, external paths, and command-pattern units all derive from `commands()`."
  Planning showed that is not behavior-preserving in one step: `pathTokens()`/`externalPaths()` walk the **whole** tree (incl. substitution/subshell interiors), whereas `topLevelCommands()` emits compound statements (`subshell`, `compound_statement`) **whole** and descends only `program`/`list`/`pipeline`/`redirected_statement`.
  A flat `commands()` cannot serve both at the right depth.
  So #308 models only the command-pattern slice; the path/external slices stay as methods on the shared parse and converge per-command in #307 (which needs it anyway).
  The #308 issue body was corrected to match.
- `BashCommand` is intentionally a one-field type (`text`).
  Adding `context`/`name`/`argv`/`pathCandidates`/`effectiveCwd` now would be a fallow-flagged dead field; each is added by its consuming issue (#306 adds `context`, #307 adds the path/cwd fields).
  The value of introducing the object now is the stable extension seam — #306/#307 add fields rather than migrate a `string[]` return type.
- The 1027-line `test/bash-external-directory.test.ts` exercises the `extractTokensForPathRules` / `extractExternalPathsFromBashCommand` facades directly (~90 call sites). #304 kept those facades for exactly this suite (lift-and-shift).
  So #308 keeps them and switches only the **production gates** to the injected `BashProgram`; the facades become a test-only seam (fallow treats tests as consumers, so they stay live).
  Fully retiring them is a deferred cleanup.
- AST shapes were verified with a throwaway `web-tree-sitter` probe before writing assertions: `command_substitution` wraps `$(…)` and backticks; `process_substitution` wraps `<(…)`/`>(…)`; `subshell` wraps `( … )`; `file_redirect` is a **sibling** of the command inside `redirected_statement` (redirect targets attach to that command); `compound_statement` is the `{ … }` brace group, which runs in the current shell (relevant to #307's `cd`-scoping, not #308).
- `resolveBashCommandCheck` is reshaped from "parse internally via an injectable `decompose`" to "combine a caller-supplied `units` list," moving decomposition into the handler so it flows from the single shared parse.
  The `?? checkPermission(command)` empty-units fallback is preserved (never-weaker).
- New `BashProgram.commands()` needs the `// fallow-ignore-next-line unused-class-member` suppression (singular kind, no trailing prose) — the private-ctor + static-factory false positive documented in the #304 retro.
- Sibling issues filed this session: #307 (project a running effective working directory across `cd`s onto path candidates) and #309 (unify the advisory `checkPermission`/RPC bash path with the gate's decomposed fidelity — deferred because it needs a warm parser and changes public sync-API semantics; it is advisory-path polish, not an enforcement gap, since the gate is already decomposed).
- Ship-time warning carried forward from the #301 retro: this is a `refactor:`-heavy enabler; if it ships stacked under #306, release-please omits it from the changelog, so #308 must be closed explicitly.

### Diagnostic details

- **Feedback-loop gap analysis** — Steps 1–3 are each paired with `pnpm run check` in the plan because they are behavior-preserving signature changes the type checker catches before the suite; step 3 additionally runs the full suite because `resolveBashCommandCheck` is a shared helper.
- **Escalation-delay tracking** — The "single flat `commands()` for all slices" design was abandoned once the `compound_statement`/`subshell` whole-emit parity issue surfaced during AST verification, before any plan text committed to it.

## Stage: Implementation — TDD (2026-06-01T23:37:13Z)

### Session summary

Implemented the structured `BashCommand` model and parse-once injection across four TDD steps (three `refactor:` code commits + one `docs:` commit), plus a follow-up `refactor:` cleanup of stale fallow suppressions.
`BashProgram.topLevelCommands(): string[]` became `commands(): BashCommand[]`; `PermissionGateHandler` now parses the bash command once per `tool_call` and injects the shared `BashProgram` into all three bash gates; `resolveBashCommandCheck` became a pure combiner over caller-supplied `units`.
Test count unchanged (1704 → 1704 — the renamed/reshaped suites assert the same coverage); `pnpm run check`, `pnpm run lint`, `pnpm run test`, and `pnpm fallow dead-code` all green; no permission decision changed.

### Observations

- Deviation from the plan: the plan kept the two bash path gates and `resolveBashCommandCheck` `async` (returning `Promise<...>`) "to keep the handler's `await` call site and the gate-producer signature unchanged."
  Once parsing moved into the handler, none of these three functions performs async work, and eslint `@typescript-eslint/require-await` (on for `src/`, off for `test/` per the root `eslint.config.js` override) rejected an `async` function with no `await`.
  So `describeBashPathGate`, `describeBashExternalDirectoryGate`, and `resolveBashCommandCheck` were made **synchronous** (`GateResult` / `PermissionCheckResult`), and the handler's bash tool-gate producer is synchronous too.
  This is the honest, lint-clean outcome and aligns the two bash path gates with their already-synchronous siblings (`describePathGate`, `describeExternalDirectoryGate`); the `gateProducers` array type `Array<() => GateResult | Promise<GateResult>>` and the `await produce()` loop accept both shapes with no call-site change.
  The plan's note that the resolver "stays async" did not anticipate the `require-await` rule.
- The gate suites construct a real `BashProgram` via a local `describeGate` helper that mirrors the handler's parse-once derivation exactly (`tcc.toolName === "bash" && command ? await BashProgram.parse(command) : null`), so the gates are exercised through the production wiring rather than a hand-built token list.
- Fallow surfaced two stale suppressions after step 2/3: with the gates calling `pathTokens()` / `externalPaths(cwd)` directly on the injected `BashProgram` **parameter**, fallow resolves both methods as used, so their `unused-class-member` suppressions became stale.
  `commands()` keeps its suppression because it is only ever called on an **inferred-type** value (the handler's `const bashProgram = … ? await BashProgram.parse(command) : null`), which fallow cannot resolve through.
  The fallow gate runs from the repo root (203 entry points); the suppression cleanup also relocated the `externalPaths` JSDoc, which had drifted above `commands()` (pre-existing jumble from #301/#304).
- The empty/missing-command bash edge changed routing shape but not the decision: the old code always routed bash through `resolveBashCommandCheck("", …)`, which fell back to `checkPermission("bash", { command: "" })`; the new handler routes a null `bashProgram` (empty command) to the else branch `checkPermission("bash", tcc.input, …)`.
  The full suite (including `tool-call.test.ts`) stayed green, confirming no observable decision change.
- The extractor facades (`extractTokensForPathRules`, `extractExternalPathsFromBashCommand`) are untouched and remain live via the 1027-line `test/bash-external-directory.test.ts` characterization suite (the #304 lift-and-shift seam); they are now a test-only seam in production terms.
- Pre-completion reviewer verdict: **PASS** (all deterministic checks green; deviation to sync gates verified behavior-preserving; Mermaid diagrams parsed clean; dead-code clean).
- Ship-time warning still applies: this is a `refactor:`-heavy enabler; release-please omits `refactor:` commits from the changelog, so if #308 ships stacked under #306 it must be closed explicitly.

## Stage: Final Retrospective (2026-06-02T00:04:58Z)

### Session summary

Shipped #308 across the TDD-implementation and ship sessions: five commits (three `refactor:` code, one `docs:`, one `refactor:` fallow cleanup) plus stage/retro docs, all green through CI, with the issue closed explicitly (no release triggered — `refactor:`-only).
The implementation matched the plan's structure but diverged on one point the plan did not anticipate (the bash gates became synchronous instead of `async`), which the deterministic lint gate surfaced and which turned out to be the cleaner design.

### Observations

#### What went well

- The `require-await` constraint turned the plan's "keep the gates `async` for signature symmetry" into the cleaner synchronous outcome — a deterministic gate enforced better design than the plan specified, and the sync gates now match their sibling descriptor factories (`describePathGate`, `describeExternalDirectoryGate`).
- Testing the injected `BashProgram` via a local `describeGate` helper that mirrors the handler's parse-once derivation exactly kept the gate suites faithful to production wiring instead of hand-building token lists; the pre-completion reviewer flagged this as a strength.
- The 14-call-site rename in `bash-path.test.ts` used a single `sed` on `await describeBashPathGate(` → `await describeGate(`, exploiting that the import binding and the helper's own call are not preceded by `await`, so the mechanical migration never touched the helper definition.

#### What caused friction (agent side)

- `missing-context` — I checked the root `eslint.config.js` for `require-await` and saw `"off"` (line 157) but did not read the enclosing override's `files: ["packages/*/test/**/*.ts"]` scope (line 148), so I followed the plan and kept the two bash path gates `async`.
  The pre-commit hook rejected the step-2 commit with `require-await` errors on `src/` files.
  Impact: one failed commit attempt and a mid-step pivot converting `describeBashPathGate`, `describeBashExternalDirectoryGate`, and (in step 3) `resolveBashCommandCheck` to synchronous, plus the handler's tool-gate producer.
  No wasted code — the sync form is cleaner — but the misread cost a verification cycle and forced re-reasoning the plan deviation.
  Self-corrected via the pre-commit hook (not user-caught).
- `instruction-violation` — appended the TDD stage notes with a shell heredoc (`cat >> … << 'EOF'`), which `AGENTS.md` and the `markdown-conventions` skill forbid ("Author and append markdown with the `Write`/`Edit` tools, not shell heredocs").
  The `tdd-plan` prompt does not list `markdown-conventions` in its "Load skills" step, so the rule was not in context when its "Write stage notes" step ran.
  Impact: none this time — the content was one-sentence-per-line and `rumdl` passed — but heredocs do not interpolate `\uXXXX` escapes and make one-sentence-per-line slips easy.
  Self-unidentified.
- `other` (minor) — the first `find '308-*.md'` for the plan returned nothing because plan files are zero-padded (`0308-…`); recovered immediately with `grep -rl 'issue: 308'`.
  A first `Edit` to `bash-path.test.ts` also failed because I guessed the trailing dash run of a `// ── tests ──` divider; re-anchored on the unique type block instead.
  Impact: two extra tool round-trips, no rework.

#### What caused friction (user side)

- None — the user ran the three workflow stages (`/tdd-plan`, `/ship-issue`, `/retro`) back-to-back with no mid-stage correction; involvement was mechanical oversight, not strategic redirection.
  Opportunity (not criticism): the plan's "stays `async`" note could have carried a "verify against `require-await` scope" caveat at plan time, which would have pre-empted the implementation pivot.

### Diagnostic details

- **Model-performance correlation** — the only subagent dispatch was the `pre-completion-reviewer` on `anthropic/claude-sonnet-4-6`, appropriate for judgment-heavy read-only code review; no mismatch.
- **Feedback-loop gap analysis** — `pnpm run check` and the targeted `vitest` file ran after every step, and the full suite plus `fallow dead-code` (from the repo root) ran at the end; however, `pnpm run lint` was deferred to the pre-commit hook for steps 1–2, so the `require-await` violation surfaced at commit time rather than from a package-scoped `eslint .` after the step-2 interface change.
  Step 3 then ran `lint` explicitly before committing.
- **Escalation-delay tracking** — no `rabbit-hole`: the `require-await` failure was diagnosed in one grep and resolved in two edits; no sequence exceeded five tool calls on the same error.

### Changes made

1. `.pi/skills/code-design/SKILL.md` — added a Tooling rule: when lifting the only `await` out of a `src/` function, drop `async` and return synchronously, because `@typescript-eslint/require-await` is enabled for `src/` (disabled only for `test/`).
2. `.pi/prompts/tdd-plan.md` — added a line to "Write stage notes": append with the `Edit`/`Write` tools, not a shell heredoc.
3. `.pi/prompts/build-plan.md` — added the same "Write stage notes" reminder for parity with `tdd-plan`.
