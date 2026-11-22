---
issue: 1137
issue_title: "chore: refresh tooling — pnpm 12, rumdl 0.3, fallow 3.46, TypeScript 7 (side-by-side), vitest 5"
---

# Retro: #1137 — chore: refresh tooling — pnpm 12, rumdl 0.3, fallow 3.46, TypeScript 7 (side-by-side), vitest 5

## Stage: Planning (2026-11-22T05:12:32Z)

### Session summary

Probed every bump cumulatively in a throwaway worktree of `7afdd7de` (`/tmp/probe-1137`) and rumdl on a `git archive` copy, then wrote a seven-step build plan (`docs/plans/1137-refresh-tooling.md`).
The documented TypeScript alias pair, Vitest 5, and pnpm 12 pass every gate with no code changes; fallow 3.46, Biome 2.6, and rumdl 0.3.5 each need config or content changes, all identified and measured.
Filed [#1138] for the fallow features the issue defers.

### Observations

- **Operator decisions:** bump rumdl to 0.3.x (not hold) and adopt MD076 at its default `consistent` style (+404 blank lines between list items).
- **Unconfirmed decision:** the rumdl pin and the reflow land as one commit, because 0.2.24 reports 268 MD013 findings on the 0.3.5-reflowed tree and 0.3.5 reports 960 on the current one, so neither order keeps every commit green.
  The `ask_user` guard rejected the gate three times as "no visible text" although visible substance preceded each call; the plan flags the choice for the implementing session to surface before step 7.
- **Ordering constraint the issue missed:** fallow must land before TypeScript 7, because fallow 3.22 reports the `@typescript/native` alias as an unused devDependency in all nine packages (an `error` rule) and 3.46 does not.
- **Biome 2.6 formats Markdown and YAML by default** (962 `.md`, 3 YAML files flagged); the plan disables both to preserve current behavior, since rumdl owns Markdown and pnpm writes `pnpm-workspace.yaml` single-quoted.
- **Commit typing:** `build:`/`style:` throughout, because seven commits touch `packages/**` and `chore:` cuts a patch release per package.
- **pnpm `latest` is not the newest version:** `12.22.0` was published but on the `next-12` dist-tag; `latest` read `12.21.0`.
  The plan reads `dist-tags.latest`.
- **`markdown-conventions` quirks re-measured** on a scratch file: under 0.3.5 the lowercase, `(`, and `§` quirks are gone, the `#N` list-continuation join appears, and the bold lead-in split happens under both versions.
- **Tidy First skipped:** the only `src/` edit deletes one `eslint-disable` directive typescript-eslint 8.73 reports unused; there is nothing to prepare.
- **Roadmap fit:** [#1138] is `scope:repo` with no package, so `roadmap-fit` exits at step 1.

[#1138]: https://github.com/gotgenes/pi-packages/issues/1138
