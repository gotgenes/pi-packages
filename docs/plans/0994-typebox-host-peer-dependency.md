---
issue: 994
issue_title: "Pi throws warnings about typebox dependency"
---

# Declare `typebox` as a host-provided peer dependency

## Release Recommendation

**Release:** ship independently

None of `pi-subagents`, `pi-colgrep`, or `pi-github-tools` has a roadmap step that references this issue, so there is no batch to wait for.
Dispatch all three packages in one release run, because the change is cross-package and the operator asked for all three.
At planning time `./scripts/release/next-version.sh` prints nothing for any of them (measured), so the `fix:` commits below are what cut each release.

## Problem Statement

Starting with Pi 0.99.0, the resource loader warns at startup about any extension package that lists a host-provided module in `dependencies`.
Host-provided modules are `@earendil-works/pi-*`, `@mariozechner/pi-*`, `@sinclair/typebox`, and `typebox`.
`@gotgenes/pi-subagents` lists `"@sinclair/typebox": "^0.34.49"`, so every user sees the warning, even though the extension works.
The reporter suggested moving `@sinclair/typebox` to `peerDependencies`.

Pi's `docs/packages.md` states the contract: declare host-provided packages in `peerDependencies` with a `"*"` range and never in `dependencies`.
Its 0.69.0 changelog also says new packages should import from `typebox` (1.x) instead of the legacy `@sinclair/typebox` name.

## Goals

- `pi-subagents` imports TypeBox from `typebox`, drops its `dependencies` block, and declares `"typebox": "*"` as a peer, with a pinned devDependency for `tsc` and vitest.
- `pi-colgrep` and `pi-github-tools` declare the same `"typebox": "*"` peer, so all three tool-registering packages follow Pi's documented contract.
  The operator chose to fold these in instead of filing a follow-up.
- No package in the repo lists a host-provided module in `dependencies` (checked by the manifest scan under Test Impact Analysis).
- This is not a breaking change:
  - At runtime Pi's loader already maps `@sinclair/typebox` to its bundled `typebox` 1.x (`loader.ts` `_aliases`, `virtual-modules.ts`), and has done since Pi 0.69.0.
  - The peer floor is `@earendil-works/pi-coding-agent >=0.81.0`.
  - The public type bundles (`dist/public.d.ts`, `dist/settings.d.ts`) contain no typebox reference (measured with `grep` after `build:types`).

## Non-Goals

- Moving TypeBox to zod.
  Zod validates config files in `pi-permission-system` and `pi-permission-model-judge`.
  Pi's `ToolDefinition.parameters` is typed `TParams extends TSchema` from `typebox`, so tool schemas must remain TypeBox.
- Changing the `>=x` ranges on the `@earendil-works/pi-*` peers to `"*"`.
  Pi's doc asks for `"*"`, but its warning reads only `dependencies`, and those floors carry real API minimums.
- Bumping the existing `typebox` devDependency pins in `pi-colgrep` and `pi-github-tools` (`^1.2.8`).
- Adding a repo-level lint that enforces the host-provided rule.
  That is a new mechanism for a one-off slip (principle 5); Pi's own warning already flags it.
- Editing historical plans (`packages/pi-subagents/docs/plans/0270-*`, `0380-*`) or `CHANGELOG.md` entries that mention `@sinclair/typebox`.
  They are provenance.

## Background

- Pi warning source: `../pi/packages/coding-agent/src/core/resource-loader.ts`, `HOST_PROVIDED_EXTENSION_PACKAGES` and `collectExtensionPackageWarnings`.
  It checks only `manifest.dependencies`; that commit is pi `8d897edaa` (pi#9863).

- Runtime aliasing: `../pi/packages/coding-agent/src/core/extensions/loader.ts` maps `typebox`, `@sinclair/typebox`, and their `/compile` and `/value` subpaths to one bundled entry.

- Usage in `pi-subagents`: exactly 5 imports, all of the form `import { Type } from "@sinclair/typebox";`:
  - `src/tools/agent-tool.ts:4`
  - `src/tools/get-result-tool.ts:4`
  - `src/tools/steer-tool.ts:2`
  - `src/session/ask-parent-tool.ts:19`
  - `src/session/notify-parent-tool.ts:20`

  They use only `Type.Object`, `Type.String`, `Type.Optional`, `Type.Number`, and `Type.Boolean`.
  The Tidy-First assessor confirmed there are no other `@sinclair/typebox` importers in any package's `src/` or `test/`.

- Precedent: `pi-colgrep` (`src/tools/colgrep.ts`) and `pi-github-tools` (`src/tools/ci-*.ts`, `issue-close.ts`) already import from `typebox` with `typebox: ^1.2.8` in devDependencies and no peer entry.

- The public entries import no typebox at runtime: `src/service/service.ts` has only `import type`, and `src/layered-settings.ts` imports only `node:*`.
  Declaring the peer therefore does not affect `pi-subagents-worktrees`.

- AGENTS.md: use pnpm only; lockfile changes come from `pnpm install`.

## Design Overview

Spike (measured, reverted):

1. Swapped the 5 imports to `"typebox"`.
2. Ran `pnpm --filter @gotgenes/pi-subagents remove @sinclair/typebox`.
3. Ran `add -D typebox@^1.3.7`.

`pnpm run check` came back clean, and `pnpm run test` passed 1876 tests in 81 files.

`typebox@^1.3.7` matches the `typebox` 1.3.7 that the pinned devDependency `@earendil-works/pi-coding-agent@0.84.4` uses, so `tsc` sees one `TSchema` identity.

Target `pi-subagents/package.json` shape:

```jsonc
"peerDependencies": {
  "@earendil-works/pi-ai": ">=0.75.0",
  "@earendil-works/pi-coding-agent": ">=0.81.0",
  "@earendil-works/pi-tui": ">=0.75.0",
  "typebox": "*"
},
// "dependencies" block removed entirely
"devDependencies": { /* … */ "typebox": "^1.3.7", /* … */ }
```

`pi-colgrep` and `pi-github-tools` each gain `"typebox": "*"` in `peerDependencies` and change nothing else.

Where the peer entry matters:

- **`pi install`:** Pi suppresses automatic peer installation for managed packages (per `docs/packages.md`), so nothing extra is installed.
- **Plain `npm install` outside Pi:** npm 7+ auto-installs the peer copy, which is harmless because Pi aliases the import.
- **The manifest:** it now declares the runtime import that the source makes.

The rollup `external` list changes `"@sinclair/typebox"` to `"typebox"`.
The bundles currently reference neither, so this only keeps the list accurate and does not change output.

## Module-Level Changes

`pi-subagents`:

- The 5 files `src/tools/agent-tool.ts`, `src/tools/get-result-tool.ts`, `src/tools/steer-tool.ts`, `src/session/ask-parent-tool.ts`, and `src/session/notify-parent-tool.ts`: change the import specifier `@sinclair/typebox` to `typebox`.
- `package.json`: remove `dependencies`, add the peer `typebox: "*"`, and add the devDependency `typebox: ^1.3.7`.
- `rollup.dts.config.mjs`: in the `external` array, change `"@sinclair/typebox"` to `"typebox"`.
- `docs/comparison-with-upstream.md` line 19: change the "Runtime deps" row for this fork from `@sinclair/typebox` to none, with `typebox` listed as a host-provided peer.
  Keep upstream's column unchanged.
- `docs/decisions/0003-publish-bundled-type-declarations.md` line 45: change the kept-external peer example from `@sinclair/typebox` to `typebox`, because the sentence describes the current rollup config.

`pi-colgrep` and `pi-github-tools`:

- `package.json`: add `typebox: "*"` to `peerDependencies`.

Repo root:

- `pnpm-lock.yaml`: regenerated by `pnpm install`.

Predicted unchanged:

- All `test/` files, because the spike stayed green without edits.
- `README.md` of all three packages and `.pi/skills/package-{pi-subagents,pi-colgrep,pi-github-tools}/SKILL.md`, because `grep typebox` finds nothing in them.
- `packages/*/docs/architecture/architecture.md`, for the same reason.

## Test Impact Analysis

No new unit tests; the change is manifest-level and an import-specifier swap.
The existing tool-schema tests for `pi-subagents` exercise the swapped `Type` builder (all 1876 passed in the spike).

The verification surface is the manifest scan below; it mirrors Pi's `HOST_PROVIDED_EXTENSION_PACKAGES` check.
Its dry run at planning time (before the change) printed `pi-subagents hostDeps= @sinclair/typebox peerTypebox= -`, and `hostDeps= - peerTypebox= -` for every other package.

```bash
node -e 'const H=new Set(["@earendil-works/pi-agent-core","@earendil-works/pi-ai","@earendil-works/pi-coding-agent","@earendil-works/pi-tui","@sinclair/typebox","typebox"]);for(const p of require("fs").readdirSync("packages")){const m=require(`./packages/${p}/package.json`);const bad=Object.keys(m.dependencies??{}).filter(d=>H.has(d));const peer=m.peerDependencies?.typebox;console.log(p,"hostDeps=",bad.join(",")||"-","peerTypebox=",peer??"-")}'
```

After the change, the expected output is `hostDeps= -` for every package, and `peerTypebox= *` for `pi-subagents`, `pi-colgrep`, and `pi-github-tools`.

Also run:

- `grep -rn '@sinclair/typebox' packages/*/src packages/*/test packages/pi-subagents/rollup.dts.config.mjs`, expecting no output.
- `pnpm --filter @gotgenes/pi-subagents run verify:public-types`, since the rollup config changed.

## Invariants at risk

- **The public type bundles must not change.**
  `verify:public-types` pins consumer type-checking against the packed tarball.
  A `grep typebox dist/*.d.ts` after `build:types` must stay empty; it is empty today (measured).
- **Runtime tool schemas must stay equivalent.**
  The swap is from 0.34 to 1.x `Type` builders, but at runtime under Pi both specifiers already resolved to the same bundled 1.x module, so the published extension's behavior does not change.
  The vitest suite, which resolves the real package rather than Pi's alias, now uses 1.x too; the spike was green.

## TDD Order

There are no red/green cycles; this is a manifest and import change, so run `/build-plan`.
Each step ends with its verification, then a commit.

1. **`pi-subagents`: import `typebox` and declare it as a host-provided peer.**
   - Swap the 5 imports and edit `package.json` as specified above.

   - Run `pnpm install`.

   - Update `rollup.dts.config.mjs`, `docs/comparison-with-upstream.md`, and ADR 0003 line 45.

   - Verify:
     - `pnpm --filter @gotgenes/pi-subagents run check`
     - `pnpm --filter @gotgenes/pi-subagents run test`
     - `pnpm --filter @gotgenes/pi-subagents run verify:public-types`
     - `pnpm --filter @gotgenes/pi-subagents run lint`
     - the manifest scan, whose `pi-subagents` row should read `hostDeps= -` and `peerTypebox= *`
     - the `@sinclair/typebox` grep, expecting no output

   - Killing mutation: restore `"dependencies": { "@sinclair/typebox": "^0.34.49" }`, and the manifest scan reports `hostDeps= @sinclair/typebox` again.

   - Commit: `fix(pi-subagents): stop Pi's host-provided dependency warning at startup`, with this trailer:

     ```text
     Co-authored-by: Harish Rajagopal <25344287+rharish101@users.noreply.github.com>
     ```

     The trailer credits the reporter's proposed mechanism (move TypeBox out of `dependencies` into `peerDependencies`).
2. **`pi-colgrep`: declare the `typebox` peer.**
   - Add `"typebox": "*"` to `peerDependencies`, then run `pnpm install`.
   - Verify:
     - `pnpm --filter @gotgenes/pi-colgrep run check`
     - `pnpm --filter @gotgenes/pi-colgrep run test`
     - the manifest scan, whose `pi-colgrep` row should read `peerTypebox= *`
   - Killing mutation: delete the peer line, and the scan shows `peerTypebox= -`.
   - Commit: `fix(pi-colgrep): declare typebox as a host-provided peer dependency`.
3. **`pi-github-tools`: declare the `typebox` peer.**
   - Same as step 2 for `pi-github-tools`.
   - Commit: `fix(pi-github-tools): declare typebox as a host-provided peer dependency`.
4. **Confirm what would release.**
   - Run `./scripts/release/next-version.sh` for each of the three packages.
   - Each should print a patch tag: `pi-subagents-v21.8.1`, `pi-colgrep-v1.5.4`, and `pi-github-tools-v5.0.1` (estimated from the current tags plus one `fix:`).
   - This step makes no commit.

## Risks and Mitigations

- **Risk:** the pnpm `minimumReleaseAge` gate blocks resolving `typebox@^1.3.7`.
  **Mitigation:** 1.3.7 is already in the store and lockfile through `pi-coding-agent@0.84.4`, and the spike installed it without error.
- **Risk:** a `typebox` 1.x `Type` builder serializes a schema differently from 0.34 in a way a test pins.
  **Mitigation:** the spike ran the full suite green, and in production Pi already fed these calls the 1.x module.
- **Risk:** the `"*"` peer triggers pnpm peer warnings in this workspace.
  **Mitigation:** a devDependency satisfies the peer; check `pnpm install` output in steps 1–3.

## Open Questions

- None.
