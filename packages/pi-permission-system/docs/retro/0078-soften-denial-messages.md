---
issue: 78
issue_title: Change denied tool message
---

# Retro: #78 — Change denied tool message

## Final Retrospective (2026-05-21T15:00:00Z)

### Session summary

Replaced all "Hard stop" denial messages across 6 gate surfaces with informative, `[pi-permission-system]`-attributed messages.
Restructured the gate architecture so gates produce a structured `DenialContext` discriminated union and the runner formats messages from a centralized `src/denial-messages.ts` module — eliminating message text duplication across gate files.
Released as `pi-permission-system` v7.0.0 (breaking: `GateDescriptor.messages` replaced by `GateDescriptor.denialContext`).

### Observations

#### What went well

- The user's question about sink architecture elevated a text substitution into a meaningful structural improvement.
  The `DenialContext` + centralized formatter pattern is cleaner and will scale better than the prior scattered message formatting.
- The lift-and-shift migration (optional `denialContext` alongside `messages`, incremental gate migration, then removal) kept the repo green at every commit.
- Upgrading `denial-messages.test.ts` to exact `toBe()` assertions — prompted by the user asking "Can we make strong assertions?" — produced 39 tests that document the exact message contract.

#### What caused friction (agent side)

1. `missing-context` — The `[pi-permission-system]` tag was initially placed as a suffix.
   The user pointed out that `pi-autoformat` uses `[autoformat]` as a prefix, and we should be consistent.
   The `/plan-issue` prompt already has a sibling-convention grep rule, but it only covers "public API patterns" — not message formatting conventions.
   Impact: required amending the final commit after all 6 TDD steps were done.
   User-caught.
2. `missing-context` — Plan number `0078` was already taken by a pre-monorepo plan file.
   This triggered an interactive detour to archive 69 old plans to `docs/plans/archive/`, which then caused a CI failure from broken relative links in `0042-extract-event-handlers.md`.
   Impact: extra commit (`fix: remove broken relative links in archived plan 0042`) and a CI retry.
   User-caught (the collision itself; the archive was the user's idea).
3. `instruction-violation` — When fixing broken relative links in archived plan `0042`, the edit tool's `oldText` for Unicode characters (§ symbol) initially failed silently when the character encoding didn't match.
   The system prompt explicitly says to include Unicode characters literally.
   Impact: required a retry of the edit call.
   User-caught.
4. `premature-convergence` — Initial plan wrote `DENIAL_TAG` as a simple constant appended to each gate's message strings (the "tag" approach).
   The user asked whether there was a better architecture separating decisions from formatting, leading to the sink-formatter design.
   Impact: plan was rewritten, but no implementation rework since the question came during planning.
   User-caught.
5. `missing-context` — Tests initially used `toContain` fragment assertions for the denial messages.
   The user asked "Can we assert on the entire message instead of some of its contents?" which led to upgrading to exact `toBe()` assertions.
   Impact: rewrote `denial-messages.test.ts` (no rework of production code).
   User-caught.

#### What caused friction (user side)

- The user could have flagged the `pi-autoformat` prefix convention during the planning phase (when the `EXTENSION_TAG` suffix design was written into the plan) rather than after step 6 was committed.
  The plan was reviewed and approved with the suffix placement visible in the example messages section.
- The plan-number collision was a known consequence of the monorepo migration.
  Flagging the `docs/plans/archive/` convention earlier (or having it already documented) would have avoided the mid-session detour.

### Changes made

1. `.pi/prompts/plan-issue.md` — expanded sibling-convention grep rule to include agent-facing message formatting (attribution tags, error prefixes, log labels).
2. `.pi/prompts/plan-issue.md` — added note that `docs/plans/archive/` files use issue numbers from a previous repository and should be ignored when resolving conflicts.
3. `.pi/skills/testing/SKILL.md` — added strong-assertion preference rule: prefer `toBe`/`toEqual` over subset matchers; comment when weak assertions are necessary.
4. `packages/pi-permission-system/docs/architecture/architecture.md` — updated module structure: added `denial-messages.ts`, updated descriptions for `descriptor.ts`, `runner.ts`, `external-directory-messages.ts`, and `permission-prompts.ts`.
5. `.pi/prompts/tdd-plan.md` — added step 5 to "After the last TDD step": check and update `docs/architecture/` when it exists.
