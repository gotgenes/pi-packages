---
issue: 115
issue_title: "refactor(pi-subagents): decompose agent-tool.ts into foreground/background modules"
---

# Retro: #115 — decompose agent-tool.ts into foreground/background modules

## Final Retrospective (2026-05-21T22:30:00-04:00)

### Session summary

Decomposed the 579-line `tools/agent-tool.ts` into focused modules: `foreground-runner.ts` (spinner, streaming, cleanup) and `background-spawner.ts` (activity setup, notification wiring), with `agent-tool.ts` remaining as the orchestrator (411 lines).
Before extracting, fixed two upstream API gaps: widened `onSessionCreated` callback to `(session, record)` to eliminate a `listAgents()` reverse-search, and added `toolCallId` to `AgentSpawnConfig` so the manager wires `NotificationState` at spawn time.
Test count increased from 641 to 690.
Released as `pi-subagents-v6.9.1`.

### Observations

#### What went well

- The revised plan (after user feedback) was structurally clean — fixing API gaps first made the extraction trivial; each extracted module received only what it needed without workarounds.
- TDD execution was smooth: 6 steps, all green after each commit, only minor deviations (type annotation issue, `index.ts` call-site fix).

#### What caused friction (agent side)

- `wrong-abstraction` (user-caught) — The initial plan was a mechanical code-move that defined 4 new interfaces (`ForegroundRunDeps`, `BackgroundSpawnDeps`, `ForegroundRunParams`, `BackgroundSpawnParams`) to paper over two upstream API gaps: a `listAgents()` reverse-search in the foreground `onSessionCreated` callback, and a post-spawn `record.notification` mutation in the background path.
  The user asked *"What dependencies are still missing for these split tools, that they want, rather than some low level state or collaborators that they have?"* — redirecting me to fix the API surface before extracting.
  Impact: entire plan rewritten (~15 minutes), but the revised plan was significantly cleaner and the implementation went smoothly.

- `missing-context` (self-identified) — During step 5 (foreground extraction), two tests in `foreground-runner.test.ts` failed because mock sessions were `{}` objects lacking a `subscribe` method required by `subscribeUIObserver`.
  The function's dependency on `SubscribableSession` (requiring `.subscribe()`) wasn't accounted for in the test mock.
  Impact: one test fix cycle (~2 minutes), no rework.

- `missing-context` (self-identified) — Annotating `runForeground` with an explicit `Promise<AgentToolResult<any>>` return type widened the content array type from `{ type: "text", text: string }[]` to `(TextContent | ImageContent)[]`, breaking existing `content[0].text` patterns in tests.
  Fixed by removing the explicit annotation and letting TypeScript infer the narrow type.
  Impact: three edit cycles to diagnose and fix (~5 minutes).

- `missing-context` (self-identified) — Step 1 removed `listAgents` from `AgentToolManager` but didn't update the construction site in `index.ts`.
  `pnpm run check` caught it in step 4.
  Impact: one-line fix in the same commit, no rework.

#### What caused friction (user side)

- The initial plan's size and mechanical nature required a user redirect.
  The `/plan-issue` prompt's Design Overview section asks to sketch consumer call sites for *new collaborators*, but the same Tell-Don't-Ask check should apply to *extracted* modules' interactions with their upstream dependencies.
  A prompt tweak could help the agent catch this pattern earlier.

### Changes made

1. `.pi/prompts/plan-issue.md` — added extraction-specific Tell-Don't-Ask verification step to the Design Overview section: sketch the extracted module's upstream interactions before planning the extraction, fix API gaps first.
