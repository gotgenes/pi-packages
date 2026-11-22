---
issue: 395
issue_title: "feat(pi-permission-system): deny patterns with custom reason"
---

# Retro: #395 — feat(pi-permission-system): deny patterns with custom reason

## Stage: PR Review (2026-06-13T01:30:06Z)

### Session summary

Third-party PR #395 (author `@k0valik`, not the repo owner) extends the flat permission config with an object syntax for deny rules carrying an optional custom `reason`, surfaced to the agent in the block message (e.g. `npm *` → deny, `Reason: Use pnpm instead`).
The underlying problem is real: a denied command currently yields only a generic block message, so the agent is told *no* but never *why* or *what to do instead* — a denial that teaches is more actionable.
Operator's chosen direction: **adopt the capability with our own simplified design**, planned via `/plan-issue`; use the PR as reference, not the merge target.

### Evaluation

What is valuable (keep):

- The capability and API shape — `reason` threaded onto `Rule` (`rule.ts`) and `PermissionCheckResult` (`types.ts`), surfaced in `buildToolDenyBody` (`denial-messages.ts`) as `Reason: <reason>.` appended after the sentence-ending period.
- Backward-compatible config syntax `{ "action": "deny", "reason": "..." }`; existing string values are untouched.
- Schema (`schemas/permissions.schema.json`), example (`config/config.example.json`), `docs/configuration.md`, and TypeScript types all kept aligned — matches the package's "keep schema/example/docs/loader/types aligned" rule.
- Non-breaking and least-privilege-preserving: the object form only annotates `deny`, so it can never loosen policy (deny stays deny; `reason` is purely explanatory).
  `feat:` (not `feat!:`) is correct.
- Solid test coverage (17 new tests across `normalize`, `rule`, `denial-messages`, `permission-manager-unified`), including malformed-`reason` rejection and last-match-wins propagation.

What I would change (over-built / divergent — simplify in our design):

- **Duplicated type guard.**
  `isDenyWithReason` is defined twice — in `normalize.ts` (typed `value is DenyWithReason`) and in `config-loader.ts` (typed against an inline anonymous `{ action: "deny"; reason?: string }`, not the named `DenyWithReason`).
  Two copies of the same predicate with divergent annotations.
  Collapse to one shared guard beside `isPermissionState` in `common.ts`, returning `value is DenyWithReason`.
- **Single-inhabitant discriminator.**
  `DenyWithReason.action` can only ever be `"deny"` — schema pins it `"const": "deny"`, both guards check `=== "deny"`, and `normalize.ts` hardcodes `action: "deny"` when building the rule.
  It carries no runtime information beyond disambiguating "this object is a deny-with-reason" from "this object is a nested pattern map" (see the `top-level DenyWithReason object is treated as pattern map` test).
  This is the envelope-whose-only-consumed-field-is-one-value smell the design heuristics flag.
  **Operator decision: keep the explicit `{ action, reason }` shape** — the disambiguation it provides is real and the explicitness is forward-compatible — but treat it as the part to scrutinize, not extend.
- **`PatternValue` type** (minor) — introduced and threaded into `FlatPermissionConfig`; confirm it earns its keep versus inlining `PermissionState | DenyWithReason`.

Surface/security: this is a permission package, so the review weight is on what the change exposes.
The change only adds an annotation to `deny`; it cannot widen access.
No new permission surface, no default change on upgrade.
Least-privilege intact.

Mechanic confirmed during review (drives the scope non-goal): only `deny` reasons reach the agent.
`applyPermissionGate` (`permission-gate.ts`) returns `{ action: "block", reason: messages.denyReason }` for `deny`, and that block reason becomes the tool result the agent reads.
For `ask`, the gate triggers an interactive `GatePrompter.prompt()` to the human user; the agent only sees the outcome, so an `ask` reason would be human-prompt context only and never cause agent backtracking.
For `allow`, nothing is surfaced.
Hence deny-only captures 100% of the agent-facing value.

### Decision and attribution

Direction: **adopt the capability, plan a simplified design** (`/plan-issue #395`).
The retro records the decision so `/plan-issue`'s Decide gate is satisfied — it should plan around this, not re-litigate.

Agreed scope:

- Capability: a custom `reason` on **deny** rules, surfaced in the agent-facing block message.
- Object shape: keep the explicit `{ "action": "deny", "reason": "..." }` form (operator's call).
- Simplify: collapse the two `isDenyWithReason` guards into a single shared guard (in `common.ts`), using the named `DenyWithReason` type at both call sites; reassess whether `PatternValue` earns its keep.

Non-goals:

- No reason on `ask` (would be human-prompt context only — different, weaker, human-facing consumer).
- No reason on `allow` (invisible — dead weight).
- No change to defaults or to any existing string-form config.

Attribution (required durable credit):

- Every implementation/docs commit in `/plan-issue` → `/tdd-plan` carries, at the end of the body after a blank line:

  ```text
  Co-authored-by: k0valik <85703878+k0valik@users.noreply.github.com>
  ```

  The PR commit recorded a placeholder email (`kovalik@example.com`); the GitHub no-reply form (user id `85703878` + login) is used so the trailer links to `@k0valik`'s profile.

- The ship-stage PR/issue close comment thanks `@k0valik` by name and links the implementing SHA(s).

- Never use `Closes #395` in a commit (pre-empts the curated close comment); reference as `Refs #395` / `(#395)`.

## Stage: Planning (2026-06-13T01:45:00Z)

### Session summary

Wrote the numbered implementation plan `docs/plans/0395-deny-patterns-custom-reason.md` for the operator-confirmed direction (adopt-with-simplified-design, deny-only, explicit `{ action, reason }` shape).
The PR-review retro already satisfied the Decide gate, so planning proceeded without re-asking.
The plan lands the capability across `types.ts`, `common.ts`, `rule.ts`, `normalize.ts`, `config-loader.ts`, `permission-manager.ts`, `denial-messages.ts`, schema, example, and docs, in six TDD steps.

### Observations

- Three concrete simplifications over PR #395, all baked into the plan: (1) a single shared `isDenyWithReason` guard in `common.ts` replaces the PR's two divergent copies; (2) `FlatPermissionConfig` keeps `DenyWithReason` only inside the pattern map (`PermissionState | Record<string, PatternValue>`), not at the surface level, matching runtime; (3) the schema gets a new `$defs/denyWithReason` referenced only from `permissionMap`, so it never accepts a top-level deny-with-reason the runtime rejects.
- Confirmed during exploration that `evaluate()` returns the matched `Rule` verbatim via `findLast`, so `reason` on `Rule` auto-propagates — no change to `evaluate()` needed; the PR's `rule.test.ts` cases just document the existing last-match-wins behavior.
- Two parse layers must both preserve the object (`config-loader.normalizeFlatPermissionValue` and `normalize.normalizeFlatConfig`) — the loader currently strips it silently.
  Plan step 3 tests the loader directly; step 4's end-to-end manager test is the backstop that fails if either layer drops the reason.
- Design-review checklist: one optional field on two already-wide value types (`Rule`, `PermissionCheckResult`); the shared guard is the missing abstraction collapsing the duplication; `reason` rides existing value-object carriers (no parameter-relay smell).
  No structural concerns.
- Classified non-breaking (additive optional field, no default change) → `feat:`, not `feat!:`.
- Attribution trailer and `@k0valik` close-comment credit carried into the plan's Risks section so the TDD stage applies them per commit.

## Stage: Implementation — TDD (2026-06-12T21:50:00Z)

### Session summary

Implemented all six planned TDD steps plus two pre-completion fixups; test count went 1972 → 1996 (+24).
The capability ships end-to-end: `{ "action": "deny", "reason": "..." }` at the pattern-value level now flows config-loader → `normalizeFlatConfig` → `Rule.reason` → `evaluate()` → `PermissionCheckResult.reason` → the agent-facing denial message (`Reason: ...`).
All three planned simplifications over PR #395 landed as designed (single shared guard, pattern-map-only type, schema scoped to `permissionMap`).

### Observations

- Each step went red→green cleanly with no plan deviations; the plan's prediction that `evaluate()` needs no change held — the `rule.test.ts` cases pass purely from `findLast` returning the matched rule verbatim.
- TDD step 4's manager end-to-end tests were the only ones requiring the `buildCheckResult` change to go green; the `rule.test.ts` half was already green when added, exactly as the plan noted.
- Hit one tool-path slip: an `Edit` used the wrong absolute path (`pi-permission-system/...` instead of `pi-packages/packages/pi-permission-system/...`) and was denied by the permission system's own external-directory gate — corrected on retry.
- No schema-validation test exists for `config.example.json`, so the example/schema changes were verified only by `node`-parsing both files and by rumdl; worth a future AJV round-trip test (out of scope here).
- Pre-completion reviewer: **WARN** (no failing checks).
  Two non-blocking findings, both fixed before stopping: (1) `docs/architecture/architecture.md`'s inline `Rule` listing was missing `reason?` — added (`docs:` commit); (2) `buildToolDenyBody` inlined the `Reason:` suffix instead of reusing the existing `reasonSuffix` helper — refactored to reuse it (`refactor:` commit, output unchanged).
- Final state: `check`, `lint`, `test` (1996), and `fallow dead-code` all green; no lockfile changes; all 10 source/data files from the plan's Module-Level Changes touched, no deviation.

## Stage: Final Retrospective (2026-06-12T22:10:00Z)

### Session summary

One continuous session carried PR #395 end-to-end through PR-review → planning → TDD → ship, landing `pi-permission-system-v13.1.0`.
The third-party capability shipped as a simplified design (single shared guard, pattern-map-only type, schema scoped to `permissionMap`), 1972 → 1996 tests, non-breaking, with `@k0valik` credited via `Co-authored-by` trailers and a curated close comment.
Execution was clean: no rabbit holes, no plan deviations, and every plan prediction held during TDD.

### Observations

#### What went well

- **The cross-stage retro bridge worked exactly as designed.**
  The PR-review retro satisfied planning's Decide gate (no re-litigation of direction), and the plan's two load-bearing predictions — `evaluate()` needs no change (it returns the matched `Rule` verbatim) and both parse layers silently strip the object — both held in TDD with zero rework.
- **The pre-completion reviewer earned its keep.**
  All deterministic gates (`check`, `lint`, `test`, `fallow dead-code`) were green, yet the judgment-based review surfaced two real issues a pure-determinism pipeline would have shipped: a stale inline `Rule` listing and a missed helper reuse.
- **Clean `ask-user` re-ask handshake.**
  When the operator asked a clarifying question ("can the agent ever see the `ask` rationale?"), the response gathered evidence first (`permission-gate.ts`, `gate-prompter.ts`) and then re-asked scope, rather than guessing — resolving the deny-only boundary cleanly.

#### What caused friction (agent side)

- `missing-context` — `docs/architecture/architecture.md` inline-copies the core `rule.ts` types (`Rule`, `RuleOrigin`, `Ruleset`), so adding `reason?` to `Rule` left that listing stale.
  The plan explicitly concluded "no architecture doc update needed" because no module was added/moved/removed — but a field change to an inline-copied type stales the doc without any module move.
  Caught by the pre-completion reviewer → one `docs:` fixup (`fd880d49`).
  Impact: one extra commit; backstop worked, no shipped staleness.
- `missing-context` — `buildToolDenyBody` inlined the `Reason: <reason>.` suffix instead of reusing the existing `reasonSuffix` helper in the same file.
  No grep of `denial-messages.ts` for an existing helper before adding the formatting.
  Caught by the reviewer → one `refactor:` fixup (`4c2dc7c9`, output unchanged).
  Impact: one extra commit.
- `other` (tool-path slip) — an `Edit` used the wrong absolute path (dropped the `pi-packages/packages/` segment) and was denied by the permission system's own external-directory gate; corrected on the immediate retry.
  Self-identified.
  Impact: one denied tool call, no rework.

#### What caused friction (user side)

- The operator surfaced the attribution-email concern mid-TDD ("we don't have a proper email for `k0valik`?").
  The no-reply form had already been chosen in the PR-review retro, so there was no rework — but the question shows the placeholder-email rationale, though recorded, was not prominent enough to pre-empt the doubt.
  Opportunity, not criticism: a one-line "why the no-reply form" note travels well in the close comment itself.

### Follow-ups (not implemented here)

- No schema-validation test exists for `config.example.json`; the schema/example changes were verified only by `node`-parsing and rumdl.
  An AJV round-trip test (example config validates against `permissions.schema.json`) would catch schema/example drift automatically.
  Out of scope for this retro (new test infra + dependency) — candidate for a dedicated issue.

### Diagnostic details

- **Model-performance correlation** — one subagent dispatch: the `pre-completion-reviewer` ran on `anthropic/claude-sonnet-4-6` (per its agent frontmatter), a reasoning-capable model appropriate for judgment-heavy review.
  No mismatch; the verdict (WARN with two actionable findings) confirms the model engaged the judgment checklist rather than rubber-stamping.
- **Escalation-delay tracking** — no rabbit holes; the path slip resolved in a single retry, well under the 5-call flag.
- **Unused-tool detection** — the `reasonSuffix` miss was the one avoidable gap: a `grep reasonSuffix denial-messages.ts` before adding the inline suffix would have surfaced the helper.
- **Feedback-loop gap analysis** — exemplary; verification ran incrementally (per-step red→green on the affected file, `pnpm run check` after each shared-interface step 1/3/4) and comprehensively at the end (full suite + `check` + `lint` + `fallow`).
  No end-loaded verification.

### Changes made

1. `.pi/skills/package-pi-permission-system/SKILL.md` — added a two-line note to the Configuration alignment list recording that `docs/architecture/architecture.md` inline-copies the core `rule.ts` types (`Rule`, `RuleOrigin`, `Ruleset`), so a field add/remove on those must update the listing (a module-move check misses it).
