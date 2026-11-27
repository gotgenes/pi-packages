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

## Stage: Implementation — TDD (2026-11-27T17:17:46Z)

### Session summary

Completed all three TDD steps: the `+` hotkey test and comment rewrite, the Pi dev-pin bump to 1.6.1 with the `hiddenTools` fixture fix, and the `feat:` that mounts the inline dialog with `blocked: { kind: "permission", message: title }` plus its docs.
The pi-permission-system suite went from 6675 to 6677 tests (the `it.each` over the two titles).

### Observations

- Every killing mutation behaved as the plan predicted.
  Deleting `blocked`, switching `kind` to `"question"`, and setting `overlay: true` each killed both `it.each` cases; a fixed `"Permission Required"` message killed only the `(Subagent)` case.
  Appending `+` to `SYMBOLS` killed both renamed `dialog-keys` tests, plus three existing `+` pins that still run against pi-tui 1.0.0 at that step.
- The bump step had exactly the fallout the planning spike measured: one `tsc` error and no test failures once step 1 had landed; `pnpm install` needed no `minimumReleaseAgeExclude` entry.
- Manual check, run live: Pi in a detached `tmux` session under `PI_PROGRAM_STATUS=1 script -q /tmp/pi-1091.log`, with the project `authorizerChain` blanked temporarily (restored afterward) so the model-judge could not answer the ask, and a denied `read /etc/hosts`.
  The captured OSC 7501 stream was `idle`, `working`, `blocked:kind=permission:msg=UGVybWlzc2lvbiBSZXF1aXJlZA==` ("Permission Required"), then `working` after the deny.
- Pre-completion reviewer: WARN, then PASS on the delta.
  The WARN was correct: OSC 7501 reporting arrived in Pi 1.1.0, so Pi 1.0.x reports no status at all, not `working`; the `configuration.md` sentence was fixed and amended into the feat commit, and now also names the `PI_PROGRAM_STATUS=1` override.
  The plan's environment table still reads "Pi 1.0–1.4 → `working`"; that row should read 1.1–1.4, with 1.0 reporting nothing.

## Stage: Sync (worktree) (2026-11-27T17:24:12Z)

### Session summary

`pnpm run lint` and `pnpm fallow dead-code` passed, and the branch is rebased onto local `main`.
The plan's marker is `**Release:** ship independently`, so only `pi-permission-system` gets released, and nothing is deferred or filed.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-1091--/2026-11-27T15-46-27-073Z_01a21daf-c07f-739c-9b43-d1757cb3cbc0.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

- The feat commit carries `Co-authored-by:` trailers for Timo Wagner and Adam Wehner; credit them in the close comment too.
- The `build:` commit bumps the Pi dev pins to 1.6.1 and regenerates `pnpm-lock.yaml`; the peer range stays `>=1.0.0`.
