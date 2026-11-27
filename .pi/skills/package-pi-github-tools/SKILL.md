---
name: package-pi-github-tools
description: |
  Package-specific context for @gotgenes/pi-github-tools.
  Load when working on code, tests, or docs in packages/pi-github-tools/.
---

# pi-github-tools

Pi extension that registers deterministic GitHub CI and issue tools via `pi.registerTool()`.
Replaces ad-hoc `gh` CLI polling with structured tools that have exponential backoff, progress streaming, and structured success/timeout returns.

## Architecture

Portable business logic in `src/lib/` — no Pi SDK imports.
Thin Pi wrappers in `src/tools/` register each tool and map `onProgress` to Pi's `onUpdate`.
`src/extension.ts` is the Pi extension entry point.

```text
src/
├── extension.ts          # default export: registers all tools
├── tool-result.ts        # AgentToolResult builders
├── tools/                # Pi tool wrappers (one per tool)
├── lib/                  # portable business logic
│   ├── ci.ts             # findRun, watchRun, listRuns
│   ├── ci-helpers.ts     # CIJob, findRetryDelay, formatProgress
│   ├── issue.ts          # closeIssue
│   ├── github.ts         # gh(), ghJson(), ghJsonRetrying(), git(), detectRepo()
│   ├── retry.ts          # isTransientError, withRetry: 3 retries at 1/4/9 s
│   └── process.ts        # runCommand(), sleep()
└── progress.ts           # maps onProgress → Pi onUpdate
```

## Implementation Priorities

- `src/lib/` must not import from `@earendil-works/pi-coding-agent` — only `src/tools/` and `src/progress.ts` touch Pi types.
- The `gh` CLI is the main external binary dependency; `issue_close` also runs local `git rev-parse` to refuse a comment citing an unresolvable commit SHA.
- Retry is opt-in at the call site: read-only calls go through `ghJsonRetrying`, and `gh()` stays single-shot so a mutation cannot acquire retry by accident.
- `ci_find` treats a 404 from a just-listed run's jobs fetch as "not ready" and polls again within its `timeout`, rethrowing the 404 once the budget is spent; it is the one 4xx the package waits out, and `isTransientError` still excludes every 4xx.
- `ci_find` matches a run purely on `headSha` and never inspects the triggering event, so it follows a `workflow_dispatch` run — the repo's release workflow — as readily as a `push` one.

The package ships no configuration.

## Upstream assumptions

The `/upstream-impact` watchlist for this package; the `upstream-watch` skill defines the impact classes.
Paths are relative to the Pi checkout.

| Our assumption                                                                                                                                                                                    | Upstream file                                                                                                                                                                                 | Breaks as                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A tool reports failure by returning `isError: true` rather than throwing, and Pi surfaces it to the model as an error; true from Pi 0.99.0, and the 1.0.0 peer floor admits no host that drops it | `packages/agent/src/agent-loop.ts` (`executePreparedToolCall`); `packages/agent/src/types.ts` (`AgentToolResult.isError`)                                                                     | Behavioral-silent: every `err()` reads as success, as it does on every host before 0.99.0                        |
| `execute`'s `signal` aborts on cancel, and `onUpdate` partials are accepted until `execute` returns                                                                                               | `packages/agent/src/types.ts` (`AgentTool.execute`, `AgentToolUpdateCallback`); `packages/agent/src/agent-loop.ts`                                                                            | Behavioral-silent: `ci_watch` ignores cancel, or progress stops streaming; our `OnUpdate` is a hand-copied shape |
| `promptSnippet` on `registerTool` reaches the system prompt                                                                                                                                       | `packages/coding-agent/src/core/extensions/types.ts` (`ToolDefinition.promptSnippet`); `packages/coding-agent/src/core/agent-session.ts` (`_normalizePromptSnippet`)                          | Behavioral-silent: tools stay callable but lose their prompt hint                                                |
| `import { Type } from "typebox"` resolves to Pi's aliased typebox                                                                                                                                 | `packages/coding-agent/src/core/extensions/loader.ts` (module aliases)                                                                                                                        | Behavioral-silent: schema validation mismatches, or a load failure in the compiled binary                        |
| `gh` runs in Pi's process cwd, which equals the session cwd                                                                                                                                       | `packages/coding-agent/src/core/extensions/types.ts` (`ExtensionContext.cwd`); `packages/coding-agent/src/core/agent-session-runtime.ts` (session switch takes the session's cwd, no `chdir`) | Coverage-gap, already live: after resuming a session recorded in another directory, `gh` targets the launch repo |

`test/progress.test.ts` pins the `onUpdate` payload shape against our own type only; no test runs the tools through Pi.

## Testing

- Mock `runCommand` in `lib/` tests to avoid real `gh` calls — every lib test should run offline.
- Mock `sleep` too when a test exercises retry backoff or a polling wait; assert the delays (`1000`, `4000`, `9000`) rather than waiting them out.
- A polling loop returns `aborted: cancelled by user` only when the signal actually fired, so an abort test must abort the controller from inside the mocked `sleep` rejection.
- Test backoff timing, progress formatting, timeout handling, structured output.
- `tools/` wrappers are thin and tested lightly.
