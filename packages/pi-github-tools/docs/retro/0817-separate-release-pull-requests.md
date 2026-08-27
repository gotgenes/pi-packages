---
issue: 817
issue_title: "Ship packages independently with release-please separate-pull-requests"
---

# Retro: #817 — Ship packages independently with release-please separate-pull-requests

## Stage: Planning (2026-08-27T19:26:35Z)

### Session summary

Planned the flip to `separate-pull-requests: true` plus the tooling and prose changes it forces.
The plan lives at `packages/pi-github-tools/docs/plans/0817-separate-release-pull-requests.md` — single-package, because `pi-github-tools` is the only package whose code changes; the other touched paths (`release-please-config.json`, `.pi/prompts/`, `AGENTS.md`, root `README.md`) are repo-root and attributed to no component.
Six TDD steps: three code commits, a prompt/`AGENTS.md` commit, the config flip, and a package-docs commit deliberately held back as a canary on a second push.

### Observations

- **The issue's own risk assessment needed correcting.**
  The body treats [googleapis/release-please#2773](https://github.com/googleapis/release-please/issues/2773) as version-distant ("filed against v17.6.0; latest is v17.11.2").
  Resolving what the action actually ships shows otherwise: `googleapis/release-please-action@v5` → tag `v5.0.0`, whose `package-lock.json` pins `release-please` at **17.6.0** — the exact reported version, with the report still open and uncommented.
  Its trigger (a second push touching a component that already has an open release PR) is this repo's normal cadence, and it fires after `createReleases()`, so it can strand a publish via the [#646] cascade.
  That finding is what turned "flip it" into "flip it behind a canary with a written rollback".
- **Branch matching over title matching.**
  Verified from release-please source rather than inferred: `src/util/branch-name.ts` gives `release-please--branches--main--components--<component>`, and `src/util/pull-request-title.ts` gives the default `chore${scope}: release${component} ${version}`.
  Matching the branch suffix is exact; matching the title would mean reimplementing release-please's pattern parser.
- **A live defect found in the function the change opens.**
  `watchRelease` derives `version:` as `tag.replace(/^v/, "")`, which leaves a component tag whole — the tool reports `version: pi-github-tools-v4.3.2` today.
  Planned as its own `fix:` step rather than folded into the component work, since it changes observable output for a state that already exists.
- **Deliberate asymmetry between the two tools.**
  `findReleasePR` refuses to guess (`ambiguous:`) when the component is omitted and several PRs are open; `watchRelease` keeps its last-tag fallback.
  Reason, measured rather than argued: `git tag --points-at pi-github-tools-v4.3.2` returns three tags, so a multi-tag HEAD is the *normal* combined-PR state and refusing there would regress a consumer who has not flipped, whereas several open release PRs simply cannot occur for them.
  This is what keeps the whole change non-breaking.
- **The filter deliberately runs in TypeScript, not in git.**
  Switching to `git tag --list '<component>-v*'` would have voided the three `toHaveBeenNthCalledWith` git-args assertions in `test/lib/release.test.ts` that pin `docs/plans/0005-abort-signal-threading.md`'s invariant.
  Filtering over the unchanged `git tag --points-at HEAD` output keeps them as guards.
- **Clean state to flip into.**
  No open `autorelease: pending` PR at planning time, and every post-tag commit per component sits in `exclude-paths` — so nothing pending gets orphaned.
  The plan re-checks this immediately before the flip step.
- **Prerequisite confirmed landed.**
  [#816] is closed and `scripts/release-baseline-sha.sh` floors at the oldest component's release, which is the hazard separate PRs would otherwise make routine.
- **Historical curiosity.**
  `10f5e764` is a merge of `release-please--branches--main--components--pi-github-tools` from 2026-05-14, so a component-scoped release PR has merged in this repo before — though `git log -S'separate-pull-requests'` finds no config history, so that came from a different early setup.
- **No follow-up issues filed.**
  The Open Questions are empirical observations the canary answers, not deferred work.
- **Two staleness hazards for the next stages.**
  The implementation session must restart Pi before shipping (it will hold the pre-edit `release_pr_find`), and after step 4 the expanded `/ship-issue` body is a pre-edit snapshot — the on-disk file is authoritative.

[#646]: https://github.com/gotgenes/pi-packages/issues/646
[#816]: https://github.com/gotgenes/pi-packages/issues/816
