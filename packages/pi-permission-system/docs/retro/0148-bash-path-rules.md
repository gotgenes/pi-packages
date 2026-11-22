---
issue: 148
issue_title: "Cross-cutting path permission surface"
---

# Retro: #148 — Cross-cutting path permission surface

## Final Retrospective (2026-05-14T15:15:00Z)

### Session summary

Implemented a cross-cutting `path` permission surface that gates all file access — Pi tools and bash commands — with most-restrictive-wins composition.
The planning session underwent a significant design pivot (command×path matrix → `bash_path` → unified `path` surface) driven by the user's insight that `path` and `external_directory` are two dimensions of the same concept.
The implementation session executed 12 TDD steps cleanly, with one tilde-expansion test bug and one downstream mock breakage as the only friction.
A follow-up edge-case pass added 11 tests and documentation for ordering gotchas, composition rules, and the `.env.example` recipe.

### Observations

#### What went well

- **Design pivot in the planning session was high-value.**
  The original issue ("path-aware bash permission rules") proposed a command×path multiplication that the user correctly identified as too complex: "I have regrets."
  The progression from command×path → `bash_path` → unified `path` surface happened in three user messages and produced a dramatically simpler design that composes with existing surfaces.
  The plan was rewritten completely in the same session.
  This is a textbook example of the user's domain intuition outperforming the agent's systematic analysis.
- **The edge-case test pass was user-initiated and productive.**
  The user asked "Can you think of any other interesting examples to test and/or document?" after the implementation was complete.
  The resulting `ask_user` flow surfaced 6 scenarios (ordering gotchas, universal fallback interaction, composition inverse, `.env.example` recipe, redirect targets, multi-token mixed results).
  All 6 were selected and implemented as 11 tests + documentation.
  This pattern — user prompts a quality pass after green, agent proposes concrete scenarios — is worth repeating.
- **TDD plan fidelity was high.**
  12 steps executed in order with minimal deviation.
  The plan's module-level changes table matched actual changes closely.
  The only deviations were the message-formatter placement (in `path.ts` instead of `permission-prompts.ts`) and the downstream mock fix — both reasonable adaptations.

#### What caused friction (agent side)

- `missing-context` — In step 3, the `evaluateMostRestrictive` tests used `~/.ssh/*` as both rule patterns and test values.
  `wildcardMatch` expands `~` in patterns via `expandHomePath` but not in matched values, so the test silently failed.
  Self-identified on first red run.
  Impact: one extra edit cycle (~30 seconds), no rework needed beyond switching to literal `/home/user/.ssh/*` paths.
- `missing-context` — In step 11, the `makeCheckPermission` mock in `external-directory-integration.test.ts` used a two-branch surface dispatch (`external_directory` vs everything else).
  Inserting the `path` gate before the ext-dir gate meant `checkPermission("path", ...)` hit the `toolState` branch, causing double-prompts.
  Self-identified after running the full suite.
  Impact: one extra edit to add a `surface === "path"` branch to the mock.
  The testing skill already warns about this ("account for existing tests that will break") but the plan's TDD Order section didn't flag this file.
- `wrong-abstraction` — In the planning session, the agent initially built a detailed 18-file effects analysis for the command×path matrix design.
  The user redirected after saying "I have regrets" and the agent adapted, but the initial analysis was wasted work.
  The agent could have surfaced the complexity concern earlier — "this touches 18 files and adds a new evaluation model; is this the right level of complexity?" — instead of presenting it as a fait accompli.
  Impact: ~5 minutes of planning-session time on the abandoned design.

#### What caused friction (user side)

- The design insight that `path` and `external_directory` are orthogonal dimensions of the same concept came from the user, not the agent.
  The agent had all the context (it read `external_directory`, `bash-path-extractor.ts`, and the gate chain) but didn't propose the unification.
  The user's question — "is there a unification of `external_directory` and `bash_path`?" — was the pivotal moment.
  An opportunity exists for the agent to more actively propose simplifying unifications when a feature request looks like it duplicates an existing surface's concerns.
