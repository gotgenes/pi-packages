---
issue: 1092
issue_title: "pi-permission-model-judge: project config is read even when the project is untrusted"
---

# Retro: #1092 — pi-permission-model-judge: project config is read even when the project is untrusted

## Stage: Planning (2026-10-28T06:23:55Z)

### Session summary

Planned a project-trust gate for the judge's project config: `loadModelJudgeConfig` gains a required `projectTrusted` option and an `untrustedProjectConfigPath` result field, and `session_start` passes `ctx.isProjectTrusted()`.
The operator settled two choices at the gate: warn only when an untrusted project actually has the config file, and route every `session_start` warning through `ctx.ui.notify` when `ctx.hasUI` (else `console.warn`).
The plan is six steps: two `test:` preparations, a sink `fix:`, the breaking trust-gate `fix!:`, the skip-warning `fix:`, and a `docs:` step.

### Observations

- Breaking classification follows the `pi-permission-system` precedent (`f264e711`, `fix(pi-permission-system)!:` for the same gate): an untrusted project's config stops applying on upgrade without a user edit.
- Trigger verified in Pi's source and the pinned `1.0.0` `dist/`: `<cwd>/.pi/extensions` is in `TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES`, so a project carrying the judge's config always resolves trust, and trust is resolved in `resourceLoader.reload()` before `session_start`.
  `ctx.isProjectTrusted()` landed in Pi 0.79.1, below the `>=0.84.3` peer floor, so no fallback is needed.
- Sink evidence: interactive mode starts the TUI before `session_start`, and neither Pi nor its TUI captures `console.*`, so `console.warn` there is a raw stderr write under a live TUI.
  Whether it survives a repaint was not measured; the operator chose the `pi-autoformat` `reportMessage` convention instead.
  `warnUnresolvedService` stays on `console.warn` because its `pi.events` handler holds no `ctx`.
- The Tidy-First assessor recommended widening `ctxWithRegistry` first (today's fixture lacks `isProjectTrusted`, so step 4 would `TypeError` every extension test) and a local `load()` helper over the seven loader-test calls; both are steps 1–2.
  It confirmed no structural contradiction and that no existing test asserts config-issue warnings, so step 3 is a real red.
- The `typoPatterns` bound from #1090 stays as defense in depth; no follow-up issues filed, and the package has no improvement roadmap, so `roadmap-fit` had nothing to record.

#### Deferred tidyings

- `packages/pi-permission-model-judge/src/extension.ts`: `warn` and `warnUnresolvedService` remain a separate `console.warn` path from the new ctx-aware `reportWarning`; unifying needs a stored `ctx`.

## Stage: Implementation — TDD (2026-10-28T18:56:30Z)

### Session summary

All six TDD steps landed as planned: two `test:` preparations, the notification sink `fix:`, the breaking trust-gate `fix!:`, the skip-warning `fix:`, and the `docs:` step.
The package suite went from 72 to 90 tests (+18), and every named killing mutation turned its predicted tests red.

### Observations

- Step 5 deviated slightly from the plan: its third loader case uses an invalid *global* config beside a malformed project file, so it exercises the invalid-merge return site, which the plan's "malformed project" wording would not have reached (an untrusted malformed project file is never parsed, so that case lands on the success return).
- Mutation evidence beyond the plan: dropping the `!projectTrusted` condition also killed the existing 1,000-entry `typoPatterns` bound test, because its full-shape `toEqual` sees the extra defined field; omitting the field at the invalid-merge return was a fifth mutation, killed by its own case.
- In step 3, the `hasUI: false` test passed during Red (a pin for the existing console path); the always-notify mutation confirmed it discriminates.
- `git commit -F -` with a heredoc is denied by the permission policy; write the message with `Write` and pass `-F <file>`.
- One `git commit` timed out at 200 s without landing (no lock left behind); a retry with a longer timeout succeeded.
  The root `pnpm run test` and `pnpm run lint` also needed timeouts well above 900 s in this session.
- Pre-completion reviewer: PASS; it re-derived the security boundary (one production load site, trust read from `ctx` there, project content read only under the `projectTrusted` guard) and found no leak path.
