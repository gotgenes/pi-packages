---
issue: 350
issue_title: "~ and $HOME patterns footgun"
---

# Retro: #350 — ~ and $HOME patterns footgun

## Stage: Planning (2026-06-08T19:40:13Z)

### Session summary

Diagnosed the reported footgun: path **patterns** are home-expanded by `compileWildcardPattern` (via `expandHomePath`), but tool-call and bash path **values** flow through `normalizeInput` raw, so a `~/.ssh/config` value never matches a `~/.ssh/*` deny rule — a silent permission bypass.
Produced a numbered plan (`docs/plans/0350-home-expand-path-values.md`) with two coordinated fixes that both reuse the existing `expandHomePath`, plus TDD cycles and doc updates.

### Observations

- Root cause is asymmetry, not a missing feature: expansion happens on one side of the match only.
  The fix is to home-expand path **values** symmetrically at the single choke point, `normalizeInput`.
- Both `describePathGate` and `bash-path.ts` route through `permissionManager.checkPermission` → `normalizeInput`, so one change in `normalizeInput` fixes the cross-cutting `path` surface for tool calls **and** bash, plus per-tool path patterns.
- Decision (`ask_user`): code fix, not docs-only — this is an under-matching `deny` bypass, the worst failure mode for a least-privilege gate; the docs example (`~/.ssh/*`) is correct intent.
- Decision (`ask_user`): home-expand values **only**, not full cwd-canonicalization.
  Patterns are not cwd-resolved today (so glob patterns like `*.env` match anywhere); home-expand-only keeps that and avoids regressing relative patterns.
- Secondary fix included: `normalizePathForComparison` currently expands `~` but not `$HOME`; routing it through `expandHomePath` brings the `external_directory` surface (and bash external-path / skill-read) to `$HOME` parity.
  Flagged in Open Questions as splittable if review wants tighter scope.
- Existing tests stay green: current `input-normalizer.test.ts` and `external_directory` integration cases use non-home or already-absolute values, which `expandHomePath` leaves untouched.
  No existing assertion needs flipping; the change only adds previously-missing matches.
- Home-expansion tests must mock `node:os` (`vi.hoisted` + `vi.mock` with a `default` key) as in `expand-home.test.ts`.

## Stage: Implementation — TDD (2026-06-08T19:53:29Z)

### Session summary

Executed all 4 TDD cycles from the plan in a single session, then added a fifth `refactor:` commit (out of plan) consolidating path-surface value normalization.
Two production files changed (`src/path-utils.ts` and `src/input-normalizer.ts`), adding 24 new tests across 5 test files.
Test count grew from 1813 to 1837 (+24).

### Observations

- **Step 1 deviation** — After dropping the inline `~/` expansion block from `normalizePathForComparison`, the unused `homedir` import was correctly dropped, but `join` was accidentally removed from the same `node:path` import line.
  Caught immediately by the red run (4 `ReferenceError: join is not defined` failures) and fixed before the green commit.
- The `SPECIAL_PERMISSION_KEYS` branch in `normalizeInput` already used `pathValue ?? "*"` (nullish coalescing), so the null guard required by the plan (`pathValue === null ? "*" : expandHomePath(pathValue)`) was a natural replacement; no logic change was needed beyond adding the expansion call.
- Integration tests in `permission-manager-unified.test.ts` confirmed that 3 of the 6 new home-expansion cases were already passing before Fix 2 (the ones that used `homedir()` directly as an already-absolute path).
  Only 3 tests were red before the production change: raw `~/...`, raw `$HOME/...`, and per-tool `~/...` — exactly the reported bug surface.
- The bash parser's `resolveNodeText` returns `$HOME` as the literal text of a `simple_expansion` node, so `cat $HOME/.ssh/config` produces the token `"$HOME/.ssh/config"` — the gate characterization test for that token is valid.
- **Out-of-plan refactor (user-requested)** — After the plan steps, review surfaced near-duplicate path-value handling in `normalizeInput` (the two path branches each did `extract → home-expand → fallback to "*"`).
  Per a `full consolidation` `ask_user` decision, extracted a private `normalizePathSurfaceValue(input)` helper owning that shared concern.
  This unified extraction on `getNonEmptyString` (was a raw `typeof === "string"` check in the special-keys branch), a deliberate small behavior change: the `path` / `external_directory` surfaces now coerce empty/whitespace-only paths to `"*"` and trim before matching — matching the path-bearing tools' prior behavior.
  Covered by 3 new tests; `getPathBearingToolPath` import dropped from `input-normalizer.ts` (still has 3 live gate consumers, so no dead-code regression).
- Pre-completion reviewer: **PASS** (re-dispatched after the refactor) — no warnings issued in either run.

## Stage: Final Retrospective (2026-06-08T20:18:44Z)

### Session summary

Shipped issue #350 end-to-end across four stages (plan → TDD → ship → retro) in one continuous session, releasing `@gotgenes/pi-permission-system` v10.5.2.
The fix home-expands path *values* (`~/…`, `$HOME/…`) before matching, closing a silent `deny`-bypass; a mid-implementation user question prompted an in-scope `refactor:` consolidation (`normalizePathSurfaceValue`) that was correctly re-reviewed.
Clean execution overall — three minor self-caught slips, one of which (a fabricated CI SHA) cost ~125s.

### Observations

#### What went well

- **Mid-stream scope expansion handled with discipline** — when the user asked "is there a broader improvement?" after the pre-completion reviewer had already passed, the response separated the right-sized consolidation from gold-plating (explicitly rejected table/registry dispatch citing the `code-design` skill), used `ask_user` for the scope decision, ran the refactor as its own red→green TDD cycle, and re-dispatched the `pre-completion-reviewer` because the refactor carried a behavior change.
  This is the intended way to absorb a late design request without abandoning workflow rigor.
- **Root-cause analysis validated by the red phase** — the plan predicted exactly which integration cases were already passing; the TDD red run confirmed precisely 3 of 6 home-expansion cases red (raw `~/…`, raw `$HOME/…`, per-tool `~/…`), matching the asymmetry diagnosis.
- **Incremental verification caught a bug at the cheapest point** — the `join` import slip surfaced immediately from the per-file `vitest` run after the green edit, not at the end-of-step full suite.

#### What caused friction (agent side)

- `instruction-violation` (self-identified) — in ship step 4, `ci_find` was called with a fabricated full SHA (`37f52fdd8e5d…`) expanded by guess from the 8-char short SHA in the `git push` output, instead of running `git rev-parse HEAD` first as the prompt's parenthetical instructed.
  The real HEAD was `37f52fddd458…` (diverges after the shared 8-char prefix).
  Impact: one `ci_find` timed out after ~125s before the SHA was corrected and the run was found.
- `other` (self-identified) — in TDD step 1, removing the inline `~` block from `normalizePathForComparison` also dropped `join` from the shared `node:path` import, though `isPiInfrastructureRead` still uses it.
  Impact: 4 `ReferenceError` failures on the next per-file run, fixed in 2 extra tool calls before the green commit; no follow-up commit needed.
- `other` (self-identified) — appending the TDD stage notes to this retro duplicated the bash-parser observation line (the `Edit` was anchored on a content line, not the file's last line as the prompt advises).
  Impact: 2 extra tool calls to detect and remove; caught before the commit.

#### What caused friction (user side)

- The near-duplicate path-value handling was visible in the plan's Design Overview (Fix 1 showed both branches with identical `… ? "*" : expandHomePath(…)` logic), but the duplication question surfaced only after TDD and the first pre-completion PASS.
  Raising it at plan review would have folded `normalizePathSurfaceValue` into the original TDD cycles and avoided a second reviewer dispatch — an opportunity for earlier signal, not a fault.

### Diagnostic details

- **Model-performance correlation** — model selection tracked task complexity cleanly: planning and the two judgment-heavy interludes (the design conversation, this retro) ran on `claude-opus-4-8`; the mechanical TDD and ship stages ran on `claude-sonnet-4-6`.
  Both `pre-completion-reviewer` subagent dispatches returned PASS.
  No reasoning-weak-on-judgment or high-cost-on-mechanical mismatch.
- **Feedback-loop gap analysis** — verification ran incrementally throughout, not just at the end: `pnpm run check` immediately after the shared-normalizer change (as the plan required), per-file `vitest` after every red/green, and full `test` + `check` + `lint` + `fallow dead-code` after both the last TDD step and the refactor.
  No gap; this is the pattern that caught the `join` slip early.
- **Escalation-delay tracking** and **unused-tool detection** — nothing notable; no `rabbit-hole` friction, no error exceeded 2 consecutive tool calls, and no `Explore`/`colgrep`/`web_search` gap (exact-symbol searches correctly used `grep` per the `colgrep` decision table).

### Changes made

1. `.pi/prompts/ship-issue.md` — step 4 now leads with an explicit `git rev-parse HEAD` action and a caution to never hand-expand the short SHA from `git push` output or type a SHA from memory; subsequent items renumbered (1–5).
2. `packages/pi-permission-system/docs/retro/0350-home-expand-path-values.md` — added this Final Retrospective stage entry.
