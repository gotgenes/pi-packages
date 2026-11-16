---
name: upstream-watch
description: |
  Impact-class taxonomy and verification procedure for triaging a new Pi release against this monorepo's packages;
  the per-package assumption watchlists live in each `package-<pkg>` skill's `## Upstream assumptions` section.
  Load when assessing a new Pi release, diagnosing a version regression, or changing code that depends on Pi internals.
compatibility: Assumes the upstream Pi checkout at ../pi (../../pi from a worktree) with release tags fetched.
---

# Upstream Watch

Every package here wraps Pi internals, and Pi does not know which of its internals we are holding.
Each `package-<pkg>` skill lists that package's load-bearing assumptions under `## Upstream assumptions`, names the upstream file that would falsify each one, and says how the breakage shows up.
This skill holds what is common to all of them: the impact classes, the verification procedure, and its gotchas.

## Impact classes

Triage every candidate finding into one of three classes.
The classes differ in what detects them, and two of the three are not detected by the changelog.

| Class             | Shows up as                                                       | Detected by                                     |
| ----------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| Compile-time      | `tsc` error against the new types                                 | Scratch-tree typecheck. Free and deterministic. |
| Behavioral-silent | The extension still runs but does the wrong thing; nothing throws | A canary test, or nothing                       |
| Coverage-gap      | A new upstream code path routes around our seam entirely          | Reading the watchlist diff. Nothing else.       |

Behavioral-silent is the most dangerous class.
A permission gate that no longer fires, or a formatter that no longer sees an edit, produces no error and no failing test unless a canary pins that specific assumption.

Coverage-gap findings are invisible to both the changelog and the test suite, because from our side nothing changed.
A new built-in tool that writes files, a new tool-execution path that skips `tool_call`, a new provider-request path: each is a gap the watchlist diff is the only way to see.
This is why the watchlists are diffed unconditionally rather than only when a changelog entry points at them.

## The watchlists

Each package's rows live in its `package-<pkg>` skill, as a table:

| Our assumption            | Upstream file                                     | Breaks as                               |
| ------------------------- | ------------------------------------------------- | --------------------------------------- |
| One load-bearing reliance | Path under the Pi checkout, symbol in parentheses | Impact class, plus the concrete symptom |

Paths are relative to the Pi checkout.
A row is load-bearing when breaking it changes behavior without a type error, or when the API it names is internal enough to move without notice; a stable type import the typechecker guards is not a row.
When an assessment finds an assumption no row names, propose adding the row as part of the finding.

## Read both changelogs

Read `packages/ai/CHANGELOG.md` **and** `packages/coding-agent/CHANGELOG.md` in the Pi checkout, across every version in the span.
Read `packages/tui/CHANGELOG.md` too when the package under assessment peers on `pi-tui`.
Read the Breaking Changes section of every intervening version, not only the newest.
Then read Added and Changed for new components that execute tools, issue provider requests, or write session entries: those are candidate coverage gaps even when nothing about them sounds related.

Treat the changelogs as lead generators only.
They routinely omit the change that matters most to an extension.

## Version span

The packages pin different exact devDep versions and declare different peer floors, so the span is per package.
Read each package's `devDependencies` and `peerDependencies` for `@earendil-works/*` rather than assuming one shared version.
The installed `pi` binary (`pi --version`) is often far ahead of every pin; that gap is the span users are actually running.

## Scratch-tree verification

Run the new version in a detached worktree so the main checkout and its lockfile stay untouched:

```bash
git worktree add --detach /tmp/pp-upstream-<version> HEAD
cd /tmp/pp-upstream-<version>
pnpm install --frozen-lockfile
pnpm --filter @gotgenes/<pkg> add -D @earendil-works/pi-coding-agent@<version>   # plus each other @earendil-works/* devDep the package pins
cd /tmp/pp-upstream-<version>/packages/<pkg>
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vitest run
```

Bump every `@earendil-works/*` devDep the package pins in one `add` call, so they resolve to a single version.
Remove the worktree when the assessment is complete: `git worktree remove --force /tmp/pp-upstream-<version>`.

### Gotchas

1. `pnpm add` auto-adds the fresh release to `minimumReleaseAgeExclude` in the scratch tree's `pnpm-workspace.yaml`, so the age gate does not block it.
2. `pnpm add` then exits 1 on `ERR_PNPM_IGNORED_BUILDS` (esbuild), but the install has landed.
   Confirm with `node -p "require('./node_modules/@earendil-works/pi-coding-agent/package.json').version"` from the package directory rather than trusting the exit code.
3. `pnpm run check` and `pnpm test` fail in the scratch tree at pnpm's deps-status gate for the same reason.
   Call the binaries directly: `./node_modules/.bin/tsc --noEmit` and `./node_modules/.bin/vitest run`.
4. A package whose `test` script selects a Vitest project (pi-autoformat's `--project unit`) runs every project under the bare binary, including its real-CLI acceptance suite.
   That suite spawns the package-local `node_modules/.bin/pi`, which in the scratch tree is the new version, so it is end-to-end evidence against the release under assessment.

Read the failures carefully.
A suite that is mostly green is not a pass: the failing canary is often the entire finding.
Quote a failing canary's actual output in the report; the rendered before/after is the most persuasive evidence available.

Typecheck cannot see a runtime surface reached through a dynamic import or a string-keyed lookup.
Probe one directly against the new `dist/` from the package directory, for example:

```bash
node --input-type=module -e "
import * as ns from '@earendil-works/pi-ai/compat';
console.log(Object.keys(ns));
"
```

## Scoping blast radius

When a finding depends on a capability flag, a tool name, or a model's `compat` field, enumerate the real set rather than assuming it applies everywhere.
A finding that affects one built-in tool is a different priority from one that affects every tool call.

## Version-agnostic typing

When upstream narrows a type we pass straight through, prefer deriving our signature from the delegate over importing the new type name:

```typescript
context: Parameters<typeof delegate>[1]
```

This typechecks against every version in the supported peer range, so it fixes the build without forcing a peer-floor bump.
Import the new type name only when we actually need to construct or inspect the value.
