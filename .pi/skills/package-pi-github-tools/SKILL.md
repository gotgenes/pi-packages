---
name: package-pi-github-tools
description: |
  Package-specific context for @gotgenes/pi-github-tools.
  Load when working on code, tests, or docs in packages/pi-github-tools/.
---

# pi-github-tools

Pi extension that registers deterministic GitHub CI, release, and issue tools via `pi.registerTool()`.
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
│   ├── config.ts         # config loading and normalization
│   ├── merge-state.ts    # classifyMergeState: PR merge readiness from gh pr view
│   ├── release.ts        # findReleasePR, mergeReleasePR, watchRelease
│   ├── issue.ts          # closeIssue
│   ├── github.ts         # gh(), ghJson(), ghJsonRetrying(), git(), detectRepo()
│   ├── retry.ts          # isTransientError, withRetry: 3 retries at 1/4/9 s
│   └── process.ts        # runCommand(), sleep()
└── progress.ts           # maps onProgress → Pi onUpdate
```

## Implementation Priorities

- `src/lib/` must not import from `@earendil-works/pi-coding-agent` — only `src/tools/` and `src/progress.ts` touch Pi types.
- The `gh` CLI is the sole external binary dependency.
- Retry is opt-in at the call site: read-only calls go through `ghJsonRetrying`, and `gh()` stays single-shot so a mutation cannot acquire retry by accident.
  A failed `gh pr merge` is resolved by re-reading the PR over REST (`gh api repos/{owner}/{repo}/pulls/N`), never by guessing or blind-retrying.

## Configuration

Extension-owned JSON config, project overriding global (same pattern as `pi-colgrep`):

- Global: `<agentDir>/extensions/pi-github-tools/config.json`
- Project: `<cwd>/.pi/extensions/pi-github-tools/config.json`

`defaultMergeMethod` (`"rebase" | "squash" | "merge"`): fallback merge method for `release_pr_merge` when the tool call omits `method`.
Missing or malformed config files are tolerated silently; invalid values are dropped by `normalizeConfig`.

## Testing

- Mock `runCommand` in `lib/` tests to avoid real `gh` calls — every lib test should run offline.
- Mock `sleep` too when a test exercises retry backoff or a polling wait; assert the delays (`1000`, `4000`, `9000`) rather than waiting them out.
- A polling loop returns `aborted: cancelled by user` only when the signal actually fired, so an abort test must abort the controller from inside the mocked `sleep` rejection.
- Test backoff timing, progress formatting, timeout handling, structured output.
- `tools/` wrappers are thin and tested lightly.
