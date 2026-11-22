---
issue: 906
issue_title: "Emit a terminal attention signal (BEL) when a permission prompt opens"
---

# Terminal attention signal when a permission prompt opens

## Release Recommendation

**Release:** ship independently

The roadmap's open-issue sweep lists [#906] as out of scope for the roadmap ("a presentation-layer addition sharing no step's mechanism"), so it belongs to no release batch.

## Problem Statement

When the permission system stops to ask a human, it renders the inline dialog and emits nothing outside it.
A terminal or multiplexer that raises tab or pane attention on a BEL or an OSC notification (WezTerm, iTerm2, tmux `monitor-bell`, cmux) therefore cannot flag the session.
An agent blocked on a permission decision sits silent until the operator happens to look at that pane.
Completion notifiers do not cover it, because the ask happens mid-turn and no `agent_end` fires.

The operator already gets this behavior for `ask_user` forms from `@eko24ive/pi-ask`, whose `notifications.channels` writes a BEL and an OSC 777 notification when a form opens.
This issue gives permission prompts the same opt-in behavior.

## Goals

- Add an opt-in `promptNotifications` config field: an array of `"bell"`, `"osc9"`, and `"osc777"`, where absent or `[]` means off.
- Emit the configured channels once, when the inline TUI dialog opens: after the dialog queue admits the ask, not when it is raised.
- Cover forwarded subagent asks, which the serving node presents in its own inline dialog.
- Keep the notification text fixed to the dialog title, so no tool input reaches the OS notification history.
- Point integrations that need an external program or another tool's protocol (Herdr, `cmux notify`) at the existing `permissions:ui_prompt` / `permissions:decision` broadcasts with a short recipe.
- Non-breaking: nothing changes on upgrade until a user sets the field, so this ships as `feat:`.

## Non-Goals

- A `command` channel (pi-ask's `{ "type": "command" }`).
  A project-scope config file would be able to run a shell command on every prompt, and a downstream extension on the broadcasts does the job better: it sees the prompt's end as well as its start and gets the payload.
- Emitting anything in `rpc` / `json` / `print` mode.
  The `select`/`input` fallback (`requestPermissionDecisionFromUi`) stays silent: outside interactive mode Pi's `takeOverStdout` (`pi/packages/coding-agent/src/main.ts`) reroutes stdout to stderr, so a BEL there reaches no terminal.
- Outbound bridges into another extension's event contract, such as `herdr:blocked` (Issue #658, PR #693).
  That is the architecture doc's `## Scope and non-goals` row "Outbound bridges into another named extension's event contract"; the recipe in this plan documents the sanctioned glue-extension alternative.
- Answering Issue #936 (confirming the broadcasts as a supported contract).
  The recipe relies on the contract `docs/cross-extension-api.md` already publishes, but the question asked there stays with that issue.
- A `/permission-system` settings-modal control for the field.
  The modal's controls are on/off toggles, and a channel list does not fit one.
- Notification text carrying request facts (tool name, command, agent).
- A tolerant resolver for a mistyped channel, like `resolveDialogKeys`.
  The field follows the package's default strict, fail-closed validation (see Risks and Mitigations).

## Background

- **The mode dispatch.**
  `requestPermissionDecision` (`src/authority/permission-prompt-component.ts`) routes `view.mode === "tui"` to `presentInlinePermissionPrompt`.
  That function mounts `PermissionPromptComponent` through `view.ui.custom(factory, { overlay: false })`.
  Every other mode goes to `requestPermissionDecisionFromUi` (`src/authority/permission-dialog.ts`).
- **When the dialog opens.**
  `LocalUserAuthorizer.present` (`src/authority/local-user-authorizer.ts`) runs inside `this.deps.dialogs.run(...)`, the session's `AskDialogAdmission`.
  It emits `permissions:ui_prompt` and then calls `requestPermissionDecision`.
  So the `custom` factory runs exactly when a queued ask is presented, once per prompt.
  An ask decided by policy, a session grant, or an authorizer link never reaches `present`.
  A relaying subagent node selects `ParentAuthorizer`, so only the serving node's dialog opens.
- **The terminal seam.**
  The factory receives pi-tui's `TUI`, whose `terminal: Terminal` is public with `write(data: string): void`.
  This holds in the pinned `@earendil-works/pi-tui` 0.79.1 (`dist/tui.d.ts:140`, `dist/terminal.d.ts:23`) and in the current checkout (`../pi/packages/tui/src/tui.ts:497`).
  `ProcessTerminal.write` is `process.stdout.write(data)` plus an optional write log.
  Writing through `tui.terminal` rather than `process.stdout` keeps the signal on the host's terminal abstraction and gives tests a seam.
- **Prompt preferences.**
  `PromptPreferences` (`permission-prompt-component.ts`) is read live at prompt time through the `getPromptPreferences` thunk in `src/index.ts` (line ~159), which already carries `doublePressToConfirm`, `budget`, and `dialogKeys`.
  `PermissionPromptView extends PromptPreferences`, so `presentInlinePermissionPrompt` reads a new preference with no extra plumbing.
  `LocalUserAuthorizer` and `selectAuthorizer` pass the thunk through untouched.
- **Config field pattern.**
  Issue #927 (`docs/plans/0927-configurable-permission-dialog-hotkeys.md`) added `permissionDialogKeys` through the same files this plan touches: `config-schema.ts`, `extension-config.ts`, `config-loader.ts`, the regenerated schema, the example config, and `docs/configuration.md`.
  The package skill's rules apply: define the field in `unifiedConfigSchema` with `.meta({ description, markdownDescription })`, regenerate with `pnpm run gen:schema`, carry it through `PermissionSystemExtensionConfig`, and merge it in `mergeUnifiedConfigs`; do not add it to `DEFAULT_EXTENSION_CONFIG`.
- **Prior art.**
  `@eko24ive/pi-ask` 1.2.0 (`src/notifications.ts`): `bell` writes `\x07`; `osc9` writes `\x1b]9;<message>\x07`; `osc777` writes `\x1b]777;notify;<title>;<message>\x07`.
  Its sanitizer drops code points below 32 and 127, and replaces `;` with `:` inside OSC 777 fields.
  Its call site lives in its TUI component, so it too signals only in interactive mode.
- **The broadcasts.**
  `docs/cross-extension-api.md` § UI Prompt Broadcasts already promises that `permissions:ui_prompt` fires only when a human is about to be asked (when a queued ask is presented, including a forwarded one in the parent), and that exactly one `permissions:decision` with the same `requestId` follows on the same bus.
  The mb1986 comment on Issue #658 is a working ~40-line glue extension on that pair.

## Design Overview

### Config

```typescript
// src/config/config-schema.ts, inside unifiedConfigSchema beside permissionDialogKeys
promptNotifications: z
  .array(z.enum(["bell", "osc9", "osc777"]))
  .optional()
  .meta({ description: "…", markdownDescription: "…" }),

export type PromptNotificationChannel = NonNullable<
  UnifiedPermissionConfig["promptNotifications"]
>[number];
```

The vocabulary stays in the `config/` zone, which `presentation/` and `authority/` may both import (`pnpm --silent fallow guard` lists `config` among the `presentation` zone's allowed imports).
A flat array, not pi-ask's `{ enabled, channels }`: an empty array already says "off", so an `enabled` flag would be a second field meaning the same thing.

`mergeUnifiedConfigs` treats the field as override-replaces-base, like the other arrays.
It gets its own three-line `override ?? base` block rather than joining the `["piInfrastructureReadPaths", "authorizerChain"]` loop.
Those two are `string[]`, and a union-keyed write `merged[key] = value` must satisfy the intersection of the three property types, which a `string[]` value does not.

### Rendering

```typescript
// src/presentation/prompt-notification.ts
export function renderPromptNotification(
  channels: readonly PromptNotificationChannel[],
  message: string,
): string;
```

A pure function returning the concatenated sequences in configured order:

| Channel  | Bytes                                    |
| -------- | ---------------------------------------- |
| `bell`   | `\x07`                                   |
| `osc9`   | `\x1b]9;<message>\x07`                   |
| `osc777` | `\x1b]777;notify;pi;<message>\x07`       |

`message` has C0 controls and DEL removed (so it cannot terminate or inject an OSC sequence), and `;` becomes `:` in the OSC 777 field.
Today the only caller passes a fixed title, so the sanitizer never changes it; it keeps the function total over its input rather than correct only for today's caller.
An empty channel list returns `""`.

### Emission

```typescript
// presentInlinePermissionPrompt, inside the ui.custom factory
(tui, theme, keybindings, done) => {
  const signal = renderPromptNotification(view.promptNotifications, title);
  if (signal) tui.terminal.write(signal);
  return new PermissionPromptComponent(/* unchanged */);
}
```

`PromptPreferences` gains a required `promptNotifications: readonly PromptNotificationChannel[]`.
The `index.ts` thunk supplies `configStore.current().promptNotifications ?? []`, so a config edit applies to the next prompt, like the other preferences.
`title` is `"Permission Required"` or `"Permission Required (Subagent)"` (set by `LocalUserAuthorizer.present`), so a forwarded ask's notification says so.

The write happens once per mount.
The dialog's later steps (reason entry, the scope question) re-render the same component and do not re-signal.

### What is emitted, by scenario

| Scenario                                          | Today   | After, field unset | After, `["bell", "osc777"]`       |
| ------------------------------------------------- | ------- | ------------------ | --------------------------------- |
| TUI ask reaches the dialog                        | nothing | nothing            | BEL + OSC 777 at dialog open      |
| TUI ask queued behind an open dialog              | nothing | nothing            | signal when its own dialog opens  |
| Forwarded subagent ask shown in the parent (TUI)  | nothing | nothing            | signal, text "(Subagent)"         |
| Ask decided by policy, session grant, or link     | nothing | nothing            | nothing (no dialog opens)         |
| `rpc` session (`select`/`input` fallback)         | nothing | nothing            | nothing                           |

### Downstream recipe

`docs/cross-extension-api.md` § UI Prompt Broadcasts gains a short "Bridging to an external notifier" recipe.
It shows the pairing (`permissions:ui_prompt` marks a prompt as open, the `permissions:decision` with the same `requestId` marks it closed), gives a Herdr/cmux example, and says why this package does not emit a foreign event itself.
`docs/configuration.md`'s new section links to it for anything beyond the three terminal channels.

## Module-Level Changes

### Added

- `packages/pi-permission-system/src/presentation/prompt-notification.ts`: `renderPromptNotification`.
- `packages/pi-permission-system/test/presentation/prompt-notification.test.ts`: its unit tests.

### Changed

- `packages/pi-permission-system/src/config/config-schema.ts`: adds `promptNotifications` to `unifiedConfigSchema` and exports `PromptNotificationChannel`.
- `packages/pi-permission-system/schemas/permissions.schema.json`: regenerated with `pnpm run gen:schema`, never hand-edited.
- `packages/pi-permission-system/src/config/extension-config.ts`: `PermissionSystemExtensionConfig` gains optional `promptNotifications?`, and `normalizePermissionSystemConfig` passes it through in the `if (raw.X !== undefined)` style.
- `packages/pi-permission-system/src/config/config-loader.ts`: `mergeUnifiedConfigs` gains the field's own replacement block, and its doc comment's field inventory names it.
- `packages/pi-permission-system/src/authority/permission-prompt-component.ts`: `PromptPreferences` gains `promptNotifications`, and the `presentInlinePermissionPrompt` factory writes the signal.
- `packages/pi-permission-system/src/index.ts`: the `getPromptPreferences` thunk gains `promptNotifications`.
- `packages/pi-permission-system/test/helpers/prompt-view-fixtures.ts`: `makePromptPreferences` gains `promptNotifications: []`.
- `packages/pi-permission-system/test/authority/permission-prompt-component.test.ts`: named-option `makeFakeView` / `makeView` (step 1), and the fake `tui` gains `terminal: { write }`; new emission cases.
- `packages/pi-permission-system/test/composition-root.test.ts`: `makeTuiCtx` (line ~2230) hands its factory a `tui` with a capturing `terminal.write`, and returns the captured writes; a new wiring case.
- `packages/pi-permission-system/test/config/config-schema.test.ts`, `test/config/extension-config.test.ts`, `test/config/config-loader.test.ts`: field cases (accepted values, a rejected channel, pass-through, merge replacement).
- `packages/pi-permission-system/config/config.example.json`: adds `"promptNotifications": []` beside `doublePressToConfirm`, spelling the default.
- `packages/pi-permission-system/docs/configuration.md`: a `promptNotifications` row in the Runtime Knobs table, and a "Prompt notifications" subsection under "Inline permission dialog (TUI)".
  The subsection covers the channels, TUI-only emission, the fixed text, a tmux note (OSC needs passthrough; BEL does not), and a link to the recipe.
- `packages/pi-permission-system/docs/cross-extension-api.md`: the recipe above.
- `packages/pi-permission-system/README.md`: one sentence after the `permissionDialogKeys` sentence (line ~69) naming `promptNotifications`.
- `packages/pi-permission-system/docs/architecture/architecture.md`: a `prompt-notification.ts` entry in the `presentation/` module tree (beside `dialog-renderer.ts`, line ~1024), and a clause on the `permission-prompt-component.ts` entry (line ~985) saying the inline dialog signals the configured channels on mount.
  No roadmap `✅` mark: [#906] is not a phase step.

### Predicted unchanged, with the claim each rests on

- `src/authority/permission-dialog.ts`: the fallback path emits nothing by design.
- `src/authority/local-user-authorizer.ts`, `src/authority/authorizer.ts`: they pass `PromptPreferences` through by type and spread (`local-user-authorizer.ts:84`, `authorizer.ts:159`) and construct no literal.
- `src/service/permission-events.ts`, `src/service/permission-ui-prompt.ts`: the broadcast's timing and payload are untouched (ADR 0011 §6).
- `src/config/config-modal.ts`, `src/config/config-store.ts`: the field is optional, so `cloneDefaultConfig()` still compiles, and `save()` spreads `existing.config`, so a user's `promptNotifications` survives a modal save.
- `test/authority/local-user-authorizer.test.ts`: it builds preferences only through `makePromptPreferences` (lines 92, 159, 250).
- Every fixture spreading `DEFAULT_EXTENSION_CONFIG`: its shape does not change.

## Test Impact Analysis

1. **What becomes testable.**
   The byte sequences become unit-testable as a pure function, which the PR #921 approach (a `process.stdout.write` inside the dialog function) could reach only through a global spy.
   Emission at mount becomes testable through the fake `tui.terminal`.
2. **What becomes redundant.**
   Nothing: no existing test covers a signal.
3. **What must stay as-is.**
   The `requestPermissionDecision` rpc-mode cases (lines ~503–540) keep proving the fallback path never calls `custom`, which is what keeps it signal-free.

## Invariants at risk

- **`permissions:ui_prompt` fires once, immediately before the dialog, for a presented ask** (ADR 0011 §6; the `docs/cross-extension-api.md` contract that downstream notifiers depend on).
  The plan does not touch the emit site.
  `test/authority/local-user-authorizer.test.ts` pins the emit-before-present order; it stays unedited.
- **No tool input in an out-of-band channel** (ADR 0010's exposure boundary: the OS notification history is a new store).
  Step 4's component test asserts the written bytes equal the title-only sequence exactly, for an ask whose value is `/repo/secret.txt`.
- **One inline dialog slot, presented in queue order** (Issue #965).
  The signal lives inside the factory that the queue already gates.
  Step 4's composition case asserts exactly one write per presented ask.
- **Existing fake `tui` literals keep working.**
  `composition-root.test.ts` and the component test build a `tui` with no `terminal`; the write happens only when the list is non-empty, and neither sets it until this plan updates both doubles in step 4.

## TDD Order

Steps 2–5 carry this trailer in the commit message's final paragraph, below `Refs #906`:

```text
Co-authored-by: Jacob Daitzman <jdtzmn@gmail.com>
```

Verify it with `git interpret-trailers --parse` before each commit.
Step 1 is a test-fixture tidying and carries no trailer.
Commit bodies cite `@eko24ive/pi-ask`'s `notifications.channels` as prior art, in prose, not as a trailer.

1. **Tidy: named options for the dialog test doubles.**
   `test/authority/permission-prompt-component.test.ts`:
   - `makeFakeView(doublePressToConfirm, options?)` takes `{ expandKey?, ...Partial<PromptPreferences> }`, and `makeView(mode, ui, preferences?)` forwards a `Partial<PromptPreferences>` to `makePromptPreferences`.
   - `PromptFactory`'s `tui` type gains `terminal: { write(data: string): void }`, the fake passes `{ requestRender, terminal: { write: vi.fn() } }`, and `makeFakeView` returns the `write` mock.

   Friction it prepares: three dialog-key cases (lines ~256–295) pass `CTRL_O, DEFAULT_RENDER_BUDGET` only to reach the fourth positional, and step 4's cases would need a fifth.
   Pure refactor: the suite stays green with no assertion changed; no killing mutation applies.
   Commit: `test(pi-permission-system): pass dialog test preferences by name`.

2. **Config: accept `promptNotifications`.**
   `config-schema.ts`, the regenerated schema, `extension-config.ts`, `config-loader.ts`, and their three test files.
   Tests:
   - the schema accepts `["bell", "osc9", "osc777"]` and `[]`, and rejects `["beep"]` with a per-issue message naming the field;
   - `normalizePermissionSystemConfig` passes the field through and omits it when absent;
   - `mergeUnifiedConfigs` takes the project array over the global one whole (`["bell"]` over `["osc777"]` gives `["bell"]`, not a union), and keeps the global one when the project omits it.

   Killing mutations:
   - widen the enum to `z.string()`: the `["beep"]` rejection case goes red;
   - delete the pass-through block in `normalizePermissionSystemConfig`: the pass-through case goes red;
   - change the merge to `[...(base ?? []), ...(override ?? [])]`: the whole-replacement case goes red.

   No consumer reads the field yet, so this is not changelog-visible.
   Commit: `refactor(pi-permission-system): accept a promptNotifications config field`.

3. **Render: `renderPromptNotification`.**
   `src/presentation/prompt-notification.ts` and its test.
   Tests:
   - each channel alone yields its exact bytes;
   - `["bell", "osc777"]` concatenates in configured order;
   - `[]` yields `""`;
   - a message containing `\x07`, `\x1b`, and `;` comes out with the controls removed, `;` kept in `osc9`, and `;` turned into `:` in `osc777`.

   Killing mutations:
   - make `bell` return `""`: the bell case goes red;
   - swap the concatenation order (`reverse()`): the ordering case goes red;
   - delete the control-character filter: the sanitizer case goes red;
   - delete the `;` → `:` replacement: the `osc777` half of the sanitizer case goes red.

   No consumer yet.
   Commit: `refactor(pi-permission-system): render terminal notification sequences`.

4. **Wire: signal when the inline dialog opens.**
   `PromptPreferences.promptNotifications`, the factory write, the `index.ts` thunk, `makePromptPreferences`, and the composition double.
   Component tests (`permission-prompt-component.test.ts`):
   - with `["bell", "osc777"]`, `presentInlinePermissionPrompt(view, "Permission Required", makeAsk("/repo/secret.txt"))` writes exactly `"\x07\x1b]777;notify;pi;Permission Required\x07"` once, before any keystroke;
   - with `[]`, `write` is never called;
   - after a keystroke that re-renders (arming a hotkey), `write` is still called once.

   Composition test (`composition-root.test.ts`, next to "renders and honors the characters the config bound"):
   - a global config `{ permission: { "*": "allow", demo: "ask" }, promptNotifications: ["bell"] }` plus a `demo` tool call in the TUI ctx captures exactly one `"\x07"` write;
   - a tool the policy allows captures none.

   Killing mutations:
   - delete the `tui.terminal.write` call: the component emission case and the composition case go red;
   - drop the `if (signal)` guard: the `[]` case goes red (it records a `""` write);
   - drop `promptNotifications` from the `index.ts` thunk (with the fixture keeping `tsc` green, replace it with `[]`): the composition case goes red;
   - move the write out of the factory into the component's `render()`: the once-only case goes red.

   Commit: `feat(pi-permission-system): ring the terminal when a permission prompt opens`.

5. **Docs.**
   `docs/configuration.md` (row and subsection), `docs/cross-extension-api.md` (recipe), `README.md`, `config/config.example.json`, and `docs/architecture/architecture.md` (the two module-tree entries).
   Verify with `pnpm exec rumdl check` on each markdown file, and by confirming that the example config still parses under the schema test.
   Commit: `docs(pi-permission-system): document prompt notifications and the notifier recipe`.

## Risks and Mitigations

- **A mistyped channel rejects the whole config file**, which fails closed: a global file becomes universal `ask`, and a project file floors `allow` to `ask`.
  That is the package-wide rule for every strict field, and the per-issue message names `promptNotifications`.
  The regenerated JSON Schema gives editors the three-value enum.
  The `resolveDialogKeys`-style tolerance was an exception argued from IME users losing their hotkeys, and that argument does not transfer to an opt-in bell.
- **tmux swallows OSC sequences without passthrough.**
  BEL reaches tmux's `monitor-bell` without it; the docs say so and suggest `bell` for tmux.
- **Duplicate channels** (`["bell", "bell"]`) ring twice.
  That is harmless and literal, so the schema does not dedupe.
- **A later Pi release making `TUI.terminal` private.**
  The composition test fails loudly rather than silently, since it runs the real factory against a `tui` with `terminal`; the peer floor (`>=0.79.0`) already includes the public field.

## Open Questions

- Whether a future release should carry request facts (for example the tool name) in the OSC text, behind its own opt-in.
  Deferred until someone asks for it; the fixed title keeps ADR 0010's exposure boundary unchanged.

[#906]: https://github.com/gotgenes/pi-packages/issues/906
