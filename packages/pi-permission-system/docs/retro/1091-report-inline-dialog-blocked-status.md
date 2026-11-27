---
issue: 1091
issue_title: "pi-permission-system: report inline approval dialogs as blocked through Pi's UI API"
---

# Retro: #1091 — pi-permission-system: report inline approval dialogs as blocked through Pi's UI API

## Stage: Planning (2026-11-27T16:37:23Z)

### Session summary

Planned the third-party request to pass Pi's `ctx.ui.custom` `blocked` option from the inline permission dialog.
I verified the upstream mechanism in the Pi checkout (`blocked` present from `v1.5.0`; `showTopExtensionDialog` sets and restores the status) and in the published 1.0.0 dist (`showExtensionCustom` ignores the unknown option).
I also spiked the devDependency bump to 1.6.1 and reverted it, then wrote a three-step plan: a `+` hotkey test rewrite, the `build:` bump, and the `feat:`.

### Observations

- Operator decisions at the gate: implement as proposed (always on, no opt-out); message is the dialog title (Pi's own `confirm()` convention, and the variant from @JavaAdam's local patch); bump devDeps to 1.6.1 and keep the peer floor at `>=1.0.0`.
  The operator asked whether a newer Pi existed: `dist-tags.latest` is 1.6.1 for both `pi-coding-agent` and `pi-tui`, and the Pi checkout's newest tag is `v1.6.1`.
- Measured bump fallout: one `tsc` error (`makePromptOptions` needs `hiddenTools: []`) and one test failure (`matchesKey("+", "+")` is true since pi-tui 1.2.0, commit `7f9e1198f`); otherwise 6636 tests passed.
- The tidy-first assessor found two more stale statements of the `+` rationale (a sibling test name and the `SYMBOLS` doc comment in `src/config/dialog-keys.ts`), which step 1 now covers.
  It also confirmed the bump must precede the feat commit, because 1.0.0 types reject `blocked` as an excess property.
- Rejected alternatives: the notification body as the message (more informative, but diverges from Pi's convention); a local option type over 1.0.0 types (hides reliance on structural escape); raising the peer floor (no runtime gain).
- Co-authors are recorded in the plan's step 3: Timo Wagner (mechanism) and Adam Wehner (title as message).
- Pi 1.6.1 added a `hiddenTools` system-prompt option; whether the exposure pass should use it is left to the next upstream-impact review, not filed.
- After planning, the branch was rebased onto `main` once #1118 (auto-approve) and its 45.0.0 release landed.
  Issue #1118 touched none of this plan's source or test files apart from `test/helpers/handler-fixtures.ts`, where it edited `makeHandler` and this plan edits `makePromptOptions`.
  I re-ran the Pi 1.6.1 bump spike on `origin/main` in a throwaway worktree, and it hit the same fallout: one `tsc` error (`hiddenTools`) and one failing test (the `+` hotkey test), with 6674 other tests passing.
- Auto-approve and the blocked status compose: an auto-approved ask never opens the dialog, so it never reports `blocked`.

#### Deferred tidyings

- `test/authority/permission-prompt-component.test.ts`: "requestPermissionDecision dispatch" and other dispatcher blocks are nested under `describe("presentInlinePermissionPrompt")`; the describe tree misfiles them.
