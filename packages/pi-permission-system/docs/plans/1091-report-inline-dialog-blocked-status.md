---
issue: 1091
issue_title: "pi-permission-system: report inline approval dialogs as blocked through Pi's UI API"
---

# Report the inline permission dialog as blocked through Pi's UI API

## Release Recommendation

**Release:** ship independently

This issue belongs to no roadmap step: the architecture roadmap's open-issue sweep lists it as out of scope for the structural phase ("a feature request or a reply the triage carries"), so it is in no release batch.

## Problem Statement

When the inline permission dialog opens, Pi keeps reporting `working` through OSC 7501, the terminal program-status protocol that terminals and multiplexers (cmux, Herdr, Rex) read to show whether a program is running, blocked on its user, or done.
A session waiting on an approval in another tab or pane therefore looks busy, and nothing tells the operator it needs them.
Three outside users have reported it; one (Pi 1.6.0, cmux) patched the dialog locally and cmux then showed "pi · Permission Required" with a bell.

Pi 1.5.0 added a `blocked` option to `ctx.ui.custom()` (earendil-works/pi#11471, filed by this issue's author as earendil-works/pi#11428): a component that declares it makes Pi report `blocked` while it waits, and Pi owns the terminal write and the cleanup.
The dialog still mounts with only `{ overlay: false }`.

## Goals

- Mount the inline dialog with `blocked: { kind: "permission", message: title }`, so Pi ≥ 1.5.0 reports the wait as a blocked permission request on terminals that support OSC 7501.
- Cover forwarded subagent asks shown in the parent session: they reach the same mount with the title `Permission Required (Subagent)`.
- Keep the message to the dialog title, which names no command, path, MCP target, or skill.
- Keep Pi 1.0–1.4 working unchanged: the option is an extra field those versions ignore, so the peer floor stays `>=1.0.0`.
- Compile against Pi's own types: bump the package's Pi devDependencies to the latest published release, 1.6.1 (`pnpm view @earendil-works/pi-coding-agent dist-tags` → `latest: 1.6.1`, checked 2026-11-27).
- Non-breaking: the change adds a status report that only an OSC 7501 terminal reads, and alters no default, config key, or output shape, so it ships as `feat:`.

## Non-Goals

- A config opt-out.
  Pi's own `confirm()` reports `blocked` unconditionally, and the operator chose the always-on form at the planning gate.
- Raising the peer floor to `>=1.5.0`.
  It buys nothing at runtime: Pi 1.0.0's compiled `showExtensionCustom` reads only `overlay`, `overlayOptions`, and `onHandle`, so older Pi behaves exactly as today.
- Passing `blockedKind` through the `select`/`input` fallback (`requestPermissionDecisionFromUi`).
  The fallback runs only when `mode !== "tui"`, Pi reports program status only in interactive mode, and the RPC mode sources carry no `blockedKind`.
- Reporting `blocked` from the `/permission-system` settings overlay (`src/config/config-modal.ts`).
  The user opens it; the agent is not waiting on it, and no `ProgramStatus["kind"]` (`permission | question | auth`) fits.
- Changing `promptNotifications`.
  The OSC 9/777/BEL channels stay opt-in and independent; a session can carry both signals.
- Emitting another tool's events (the `herdr:blocked` bridge [#658] declined).
  This change uses Pi's own UI API rather than another tool's contract, so that decline's reasoning does not reach it; the `cross-extension-api.md` recipe for external notifiers stays.
- Admitting `+` as a dialog hotkey.
  pi-tui has matched `+` since 1.2.0, but the peer floor (`>=1.0.0`) cannot, so the exclusion stays and only its stated reason changes (TDD step 1).
  No one has asked for `+`; nothing is filed.
- Adopting Pi 1.6.1's `hiddenTools` prompt option in the exposure pass.
  The bump surfaces it only as a required field on a test fixture (TDD step 2); whether `before_agent_start` should use it is an upstream-watch question, not this change's.

## Background

- `presentInlinePermissionPrompt` (`src/authority/permission-prompt-component.ts`) mounts `PermissionPromptComponent` through `view.ui.custom(factory, { overlay: false })`.
  It is the only `ui.custom` call on the ask path; the other `src/` call is the settings overlay in `src/config/config-modal.ts`.
- `LocalUserAuthorizer.present` (`src/authority/local-user-authorizer.ts`) picks the title, `Permission Required` or `Permission Required (Subagent)` for a forwarded ask, and runs inside the session's `AskDialogAdmission`, so at most one inline dialog of ours is mounted at a time.
  `test/authority/local-user-authorizer.test.ts` already pins the title choice ("uses the '(Subagent)' dialog title when the ask is forwarded").
- Pi's mechanism, read in the Pi checkout at tags `v1.4.0` (absent) and `v1.5.0`, `v1.5.2`, `v1.6.0`, `v1.6.1` (present):
  - `ExtensionUIContext.custom`'s options gained `blocked?: { kind: NonNullable<ProgramStatus["kind"]>; message: string }` in 1.5.0 (`packages/coding-agent/src/core/extensions/types.ts`).
  - Interactive mode's `showExtensionCustom` pushes an inline component onto its extension-dialog stack with that status; `showTopExtensionDialog` calls `programStatus.setBlocked("extension-dialog", top?.blocked)`, so the topmost dialog's status is reported and a closed dialog restores the previous one, including on our abort path's `done(undefined)`.
  - `Terminal.setProgramStatus` writes only when the terminal answered the OSC 7501 support query (or `PI_PROGRAM_STATUS=1`), so an unsupporting terminal sees no change.
  - Pi's own `confirm()` reports `kind: "permission"` with the title's first line as the message (`dialogBlockedStatus`), which is the convention this plan follows.
- The package pins `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` devDependencies at `1.0.0`, whose types lack `blocked`, so the option is a `tsc` excess-property error until the pins move.

## Design Overview

One options object changes:

```typescript
return view.ui.custom<UnattributedDecision | undefined>(
  (tui, theme, keybindings, done) => { /* unchanged */ },
  { overlay: false, blocked: { kind: "permission", message: title } },
);
```

`title` is the function's existing parameter, so the local and forwarded asks report their own titles without a new parameter or branch.
There is no `finally` and no bookkeeping on our side: Pi sets the status when the component mounts and restores it when `done` closes the dialog, whoever calls `done` (a human answer, the answer window's abort, or Pi resetting extension UI).

Behavior by environment:

| Environment                        | Before                           | After                                                                               |
| ---------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------- |
| Pi ≥ 1.5.0, TUI, OSC 7501 terminal | `working` while the dialog waits | `blocked`, kind `permission`, the dialog title as message; previous status on close |
| Pi ≥ 1.5.0, TUI, other terminal    | nothing written                  | nothing written                                                                     |
| Pi 1.0–1.4, TUI                    | `working`                        | `working` (option ignored)                                                          |
| RPC / json / print (fallback)      | no status                        | no status                                                                           |

Edge cases stated as behavior:

- A forwarded subagent ask reports `Permission Required (Subagent)`: pinned in TDD step 3.
- The local ask reports `Permission Required`: pinned in TDD step 3.
- The dialog still mounts inline (`overlay: false`): pinned in TDD step 3 by the same full-shape assertion.
- Clearing on close, stacking, and terminal support are Pi's behavior; this package has no seam to test them, and the manual check in TDD step 3 observes them.

The dependency bump (measured in a planning spike against 1.6.1, then reverted) costs one `tsc` error and one test failure:

- `test/helpers/handler-fixtures.ts` `makePromptOptions`: Pi 1.6.1's `NormalizedBuildSystemPromptOptions.hiddenTools` is required, so the fixture gains `hiddenTools: []`.
- `test/config/dialog-keys.test.ts` asserts `matchesKey("+", "+") === false`, which pi-tui ≥ 1.2.0 answers `true` (`parseKeyId` accepts a bare `+` since commit `7f9e1198f`).
- Full suite on 1.6.1 with the fixture fixed: 1 failed, 6636 passed (measured).
- Lockfile diff: +425 / −31 lines across the three files (measured, `git diff --stat`).

## Module-Level Changes

- `packages/pi-permission-system/package.json`: devDependencies `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` `1.0.0` → `1.6.1`; peerDependencies unchanged at `>=1.0.0`.
- `pnpm-lock.yaml`: regenerated by `pnpm install` in the same commit.
- `pnpm-workspace.yaml`: predicted unchanged; the spike's `pnpm install` resolved 1.6.1 without a `minimumReleaseAgeExclude` entry (add one only if the install rejects it).
- `src/authority/permission-prompt-component.ts`: `presentInlinePermissionPrompt`'s `ui.custom` options gain `blocked`; the module's doc comment ("renders inline (never as an overlay)") gains a clause that it reports the wait as blocked.
- `src/config/dialog-keys.ts`: the `SYMBOLS` doc comment's reason for excluding `+` is reworded to the peer floor (pi-tui below 1.2.0 cannot match it); the literal is unchanged.
- `test/config/dialog-keys.test.ts`: the `+` test drops its `matchesKey` assertion and is renamed; the "minus the one its matcher cannot see" test is renamed.
- `test/helpers/handler-fixtures.ts`: `makePromptOptions` gains `hiddenTools: []`.
- `test/authority/permission-prompt-component.test.ts`: the options assertion moves out of the render test into a new `describe` that pins the full options shape for both titles.
- `test/authority/local-user-authorizer.test.ts`: predicted unchanged; it injects `requestPermissionDecision` and already pins which title each ask gets, which is the input the new assertion consumes.
- `docs/configuration.md` § Terminal notifications: a paragraph saying that on Pi 1.5.0 or later the dialog also reports Pi as blocked on a permission request (OSC 7501) with the dialog title, independent of `promptNotifications`.
- `README.md` (the paragraph naming `promptNotifications`): one sentence on the blocked status.
- `docs/cross-extension-api.md` § Recipe: bridging a prompt to an external notifier: the opening sentence names the blocked status alongside `promptNotifications` as what the extension does itself.
- `docs/architecture/architecture.md`: the `permission-prompt-component.ts` module-tree entry says the `custom` call carries `blocked: { kind: "permission", message: title }`.
- `.pi/skills/package-pi-permission-system/SKILL.md` § Upstream assumptions: a row for the `blocked` option (`interactive-mode.ts` `showExtensionCustom` / `showTopExtensionDialog`, `program-status-reporter.ts`), breaking as behavioral-silent (a waiting session reads `working` again).

## Test Impact Analysis

1. New tests: the options shape `ui.custom` receives, for the local and the forwarded title.
   They live beside the existing component tests, whose fake `custom` already captures `options`.
2. Redundant tests: none; the render test keeps its rendering assertions and loses only the options assertion that moves.
3. Unchanged tests that exercise the layer: `local-user-authorizer.test.ts`'s title tests stay as the pin on which title reaches the component.

## Invariants at risk

- The dialog mounts inline, never as an overlay (the module's doc comment; plan 0573).
  Pinned by the full-shape `toEqual` in TDD step 3, which includes `overlay: false`.
- `promptNotifications` writes once per mount, from the factory (plan 0906).
  Untouched code; pinned by the existing "terminal notifications" tests in `permission-prompt-component.test.ts`.
- A prompt's text names no request value in a store this package does not control (plan 0996, `describePromptNotice`).
  The status message is the title alone, a constant per ask kind; pinned by the TDD step 3 assertion's literal message.
- `+` stays unbindable while the pi-tui floor cannot match it.
  Pinned by the rewritten `dialog-keys.test.ts` assertion `BINDABLE_DIALOG_KEY_CHARACTERS.has("+") === false` (TDD step 1).

## TDD Order

1. `test(pi-permission-system): tie the + hotkey exclusion to the pi-tui peer floor`
   - `test/config/dialog-keys.test.ts`: in "excludes `+` because pi-tui reads it as a modifier separator", drop `expect(matchesKey("+", "+")).toBe(false)`, keep the `has("+")` assertion, and rename it and its comment to say pi-tui below 1.2.0 (inside the `>=1.0.0` peer range) cannot match `+`.
     Rename "admits exactly pi-tui's symbol keys, minus the one its matcher cannot see" to name the floor too.
     Remove the `matchesKey` import if nothing else in the file uses it.
   - `src/config/dialog-keys.ts`: reword the `SYMBOLS` doc comment the same way (comment only).
   - Green on 1.0.0 before the bump, so the bump commit carries only mechanical fallout.
   - Killing mutation: append `+` to `SYMBOLS` in `src/config/dialog-keys.ts`; both renamed tests go red.
2. `build(pi-permission-system): bump the Pi dev pins to 1.6.1`
   - `package.json` devDependencies, `pnpm install`, commit `pnpm-lock.yaml` (and `pnpm-workspace.yaml` only if the install demands an exclude).
   - `test/helpers/handler-fixtures.ts`: `makePromptOptions` gains `hiddenTools: []` (the `tsc` error lands in this commit, so its fix does too).
   - Verify: `pnpm --filter @gotgenes/pi-permission-system run check` and the full package suite are green; no behavior changes, so no new test.
3. `feat(pi-permission-system): report a waiting permission prompt as blocked to the terminal`
   - Red: in `test/authority/permission-prompt-component.test.ts`, remove `expect(captured.options).toEqual({ overlay: false })` from "renders inline (not as an overlay) with the request facts and hotkey labels" and rename it "renders the request facts and hotkey labels".
     Add `describe("host dialog options")` with `it.each(["Permission Required", "Permission Required (Subagent)"])` asserting `expect(captured.options).toEqual({ overlay: false, blocked: { kind: "permission", message: title } })` after `presentInlinePermissionPrompt(view, title, ASK)`.

   - Green: add `blocked: { kind: "permission", message: title }` to the `ui.custom` options; extend the module doc comment.

   - Docs in the same commit: `docs/configuration.md`, `README.md`, `docs/cross-extension-api.md`, the `architecture.md` entry, and the package skill's upstream row (see Module-Level Changes).

   - Killing mutations, one per class:
     - Delete the `blocked` property: both `it.each` cases go red.
     - Replace `message: title` with `message: "Permission Required"`: only the `(Subagent)` case goes red.
     - Replace `kind: "permission"` with `kind: "question"`: both cases go red.
     - Replace `overlay: false` with `overlay: true`: both cases go red.

   - Manual check before shipping (the `testing` skill's try-it-for-real rule): run Pi from this worktree under `PI_PROGRAM_STATUS=1 script -q /tmp/pi-1091.log pi`, trigger an `ask`, answer it, quit, then `grep -a 'state=blocked' /tmp/pi-1091.log` and expect `kind=permission:msg=UGVybWlzc2lvbiBSZXF1aXJlZA==` (base64 of `Permission Required`, computed) followed later by a non-blocked report.

   - Commit trailers, final paragraph below `Refs #1091`:

     ```text
     Co-authored-by: Timo Wagner <26152358+wagnertimo@users.noreply.github.com>
     Co-authored-by: Adam Wehner <11473917+JavaAdam@users.noreply.github.com>
     ```

     Timo Wagner proposed the mechanism (the issue body); Adam Wehner's patch used the dialog title as the message, the variant the operator chose.

## Risks and Mitigations

- **The bump pulls in other 1.6.1 type or runtime drift.**
  Measured at planning time: one `tsc` error and one test failure, both handled in steps 1–2; the full suite was otherwise green (6636 passed).
- **A future change uses a 1.6-only API while the peer floor says 1.0.0.**
  This is the standing cost of dev types newer than the floor; the `blocked` option itself is verified inert on 1.0.0's compiled `showExtensionCustom`.
- **Pi stops clearing the status on close, leaving a session `blocked`.**
  Pi owns the clear; the new upstream-assumptions row names the files to re-read on a Pi bump.
- **`minimumReleaseAge` rejects 1.6.1 (published 2026-11-25).**
  The spike's install resolved it without an exclude; if CI's frozen install rejects it, add `minimumReleaseAgeExclude` entries in step 2.

## Open Questions

- None blocking.
  Whether the exposure pass should use Pi's new `hiddenTools` prompt option belongs to the next `/upstream-impact` review of Pi 1.6.x.

[#658]: https://github.com/gotgenes/pi-packages/issues/658
