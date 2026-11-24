---
description: Assess what a new Pi release breaks in this monorepo's packages, with an empirical scratch-tree verification
---

# Assess a new Pi release

Arguments: `$1` is the new Pi version (for example `0.99.2`); `$2` optionally narrows the assessment to one package (for example `pi-subagents`).
If `$1` is empty, resolve the newest tag in the Pi checkout with `git -C ../pi tag --sort=-v:refname | head -1`.
If `$2` is empty, assess every package under `packages/`.

Your job is to determine what the new release breaks, degrades, or newly enables in each package in scope, and to prove each finding rather than infer it.
Stop after reporting and asking the user what to file.
Do not implement fixes and do not file issues without being asked.

Load the `upstream-watch` skill before starting.
It holds the impact-class taxonomy, the scratch-tree procedure, and the verification gotchas this template refers to.
Then load the `package-<pkg>` skill for each package in scope; its `## Upstream assumptions` table is that package's watchlist.

Call `set_session_name` with `Pi $1 impact — assessment` (append `— $2` when a package is given).

## 1. Establish the delta

Do not assume the installed host matches any package's declared devDeps.

1. `pi --version`
2. For each package in scope, its `@earendil-works/*` `devDependencies` pins and `peerDependencies` floors: `jq '{devDependencies, peerDependencies}' packages/<pkg>/package.json`
3. `git -C ../pi tag --sort=-v:refname | head -10`

Record, per package, the old version (its devDep pin), the new version, and every version in between.
The assessment covers each package's whole span, not just the newest release.
Packages sharing a pin share a span; read each span's changelogs and diffs once.

## 2. Read the changelogs

Read the changelogs the `upstream-watch` skill names, across the widest span in scope.
Treat them as lead generators only, and note each entry that touches a surface some package's watchlist names.

## 3. Diff the watchlists unconditionally

For every row in each in-scope package's `## Upstream assumptions` table, run a diff across that package's span:

```bash
git -C ../pi diff v<old> v<new> --stat -- <path>
```

Then read the full diff for any path with meaningful churn.
Do this even when no changelog entry points at the path: coverage-gap findings are only discoverable this way.

When a diff contradicts a claim in a package skill or a package's `docs/`, check `gh issue list` before writing it up.
The contradiction is often an already-filed issue.

## 4. Verify empirically in a scratch worktree

This step is mandatory.
Diff reading alone predicts that something breaks; it does not establish the failure mode, and the exact failure mode is what the report is for.

Follow the `upstream-watch` skill's scratch-tree procedure, bumping each in-scope package's `@earendil-works/*` devDeps to `$1` and running its `tsc` and `vitest` binaries.
One worktree serves every package; run the `pnpm --filter … add -D` per package.

Read the failures carefully.
When a canary test fails, quote its actual output in the report.

Then probe the runtime surfaces the typechecker cannot see, as each package's watchlist and the skill describe.

Remove the worktree when the assessment is complete.

## 5. Check for live evidence

This session runs inside Pi with this repo's extensions loaded, at the installed `pi --version`.
When a finding concerns a surface you can observe from here (your own system prompt, a tool's description, a permission gate firing on your own tool calls, an autoformat notice after your own edits), inspect it.
Report it as live confirmation when present, and say plainly that the evidence is your own session.

## 6. Classify and report

Present findings grouped by package, then by impact class (compile-time, behavioral-silent, coverage-gap), highest severity first.
For each finding give:

1. What upstream changed, with the file path and the version that changed it
2. What it does to the package, concretely
3. The evidence: test output, diff excerpt, or probe result
4. Blast radius: which call paths, which tools or models, which users
5. Whether it is a hard failure or a silent degradation

State separately what you verified as **unaffected**, per package, so the reader knows the absence of a finding was checked rather than skipped.

Note any new upstream capability that would let a package retire a workaround or close a known gap.
These are easy to miss because they are not failures.

Note any watchlist row whose upstream path moved or vanished, and any load-bearing assumption the assessment found that no row names.
Propose the corrected or new rows.

## 7. Hand off

Recommend a fix direction for each finding, preferring the durable shape over re-pinning a constant that will drift again.
Prefer version-agnostic fixes that keep the current peer floor.

Then call `ask_user` to ask which findings should become GitHub issues, and whether to apply the proposed watchlist-row changes.
Do not file anything before asking.
When the user chooses to file, load the `github-voice` and `roadmap-fit` skills and write each issue in @gotgenes's voice, one issue per finding, with the evidence inline and the package's `pkg:` label.
