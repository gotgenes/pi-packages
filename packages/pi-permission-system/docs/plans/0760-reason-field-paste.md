---
issue: 760
issue_title: "pi-permission-system: pasting a denial reason into the inline TUI permission prompt does nothing"
---

# Delegate the denial-reason field to the framework line editor

## Release Recommendation

**Release:** ship independently

Issue #760 is not a numbered step of the Phase 13 roadmap and belongs to no release batch.
The work lands as a `fix:` commit, so it cuts a release on its own.

## Problem Statement

In a TUI session, pressing `r` at a permission ask opens the denial-reason field.
Typing works; pasting does nothing at all — no characters appear and no error is shown.

The delivery path is measurable in the pinned `@earendil-works/pi-tui@0.79.1`:

1. `dist/terminal.js:84` enables bracketed paste mode, so the terminal wraps every paste in `\x1b[200~ … \x1b[201~`.
2. `dist/stdin-buffer.js:263-306` accumulates stdin chunks until it sees the end marker, then emits one `paste` event carrying the content with the markers stripped.
3. `dist/terminal.js:125-128` re-wraps that content — `inputHandler("\x1b[200~" + content + "\x1b[201~")` — and `dist/tui.js:569` hands the whole string to `focusedComponent.handleInput(data)` in a single call.

So `PermissionPromptComponent.handleInput` receives the entire paste, markers included, as one call.
`handleReasonInput` checks `enter` / `escape` / `backspace` and then falls through to:

```typescript
function isPrintable(data: string): boolean {
  if (data.length !== 1) {
    return false;
  }
  ...
}
```

A paste chunk is never one character long, so it is dropped without a trace.
Typing is unaffected because `stdin-buffer.js` splits ordinary keyboard input into one sequence per keystroke.

The reason field is the only hand-rolled text editor in this package.
The `select`/`input` fallback (non-TUI modes) and Pi's own chat input both go through the framework `Input` component (`dist/components/input.js:36-64`), which handles the markers — which is why the issue reports those surfaces as unaffected.

## Goals

- Pasted text reaches the denial-reason field in the inline TUI dialog.
- The reason field gains the rest of the framework's line editing at the same time: cursor movement, word/line deletion, kill-ring, undo, and horizontal scrolling.
- A multi-line paste stays readable: newline runs collapse to a single space instead of joining words.
- The reason row stays exactly one row however long the pasted text is, so the dialog's bounded height ([#710]) survives a large paste.
- No change to the decision model, the decision attribution, the payload rendering, or any permission surface.

Not breaking.
No config field, schema entry, default, or output shape changes; the only observable differences are inside a dialog step that currently drops the input under discussion.

## Non-Goals

- **The `select`/`input` fallback path.**
  It already delegates to the framework, which already handles paste; its own gap — no way to reach the complete request — is [#751].
- **Any change to `reducePrompt`'s decision semantics.**
  Hotkey arming, step transitions, and reason validation stay exactly as they are.
- **Multi-line denial reasons.**
  The field stays a single line; a multi-line paste is flattened, not preserved.
  `normalizePermissionDenialReason` already trims the result, so a paste ending in a newline submits clean.
- **A length cap on the reason.**
  The review log already bounds every written string to `reviewLogFieldMaxWidth` (1000) in `writeLine`, and the render is now a single scrolling row, so neither the log nor the dialog is at risk from a large paste.
- **Rebindable editor keys inside the dialog.**
  See Risks: the framework editor reads pi-tui's module-global keybindings, which an extension-side module instance may not share with the host.
  Today's editor is config-free too, so this is not a regression, and closing it is a separate question about how extensions reach host keybindings.

## Background

`src/authority/permission-prompt-component.ts` is the `ctx.ui.custom` adapter.
Its documented division of labour: interaction logic lives in the pure `reducePrompt` model (`src/authority/permission-prompt-decision.ts`), and the component renders state, maps keystrokes to `PromptEvent`s, and resolves the promise.

The reason text is the one piece of state that does not follow that split.
`PermissionPromptComponent.reasonBuffer` holds it, while `PromptViewState.reasonDraft` also carries it — but nothing ever reads `reasonDraft`: `reduceReasonStep` writes it back on a validation error, and `renderReason` renders `this.reasonBuffer`.
It is write-only state today, and the field is duplicated between the model and the adapter.

Two constraints from `AGENTS.md` and the package skill apply:

- The architecture module-tree entry for this file records an active constraint (`app.tools.expand` is forwarded in the decision/scope steps only, never during reason entry, [#642]), so the entry must be updated in the implementation commit and must keep that constraint.
- Importing a pi-tui component class into this module is inside the SDK-boundary rule: this file is already an SDK/TUI consumer (`Component`, `matchesKey`), and the pure decision model stays SDK-free.

### What the framework editor was measured to do

A disposable spike (deleted) drove the real `Input` class from this package's test environment:

| Input                                          | Result                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| `handleInput("\x1b[200~pasted text\x1b[201~")` | `getValue() === "pasted text"`                                      |
| `handleInput("\x1b[200~one\ntwo\x1b[201~")`    | `getValue() === "onetwo"` — newlines deleted, words joined          |
| `"\u000f"` (Ctrl+O)                            | rejected as a control character; value unchanged                    |
| `"\r"` / `"\u001b"` / `"\u007f"`               | `onSubmit` / `onEscape` / backspace                                 |
| `"\u0003"` (Ctrl+C)                            | `onEscape` — `tui.select.cancel` defaults to `["escape", "ctrl+c"]` |
| `render(40)` after a 500-character paste       | exactly one line, visible width ≤ 40, prefixed `"> "`               |

A second spike measured what a paste chunk does at the *decision* step, where the component maps keystrokes to hotkeys: `matchesKey` matched none of `y`/`s`/`n`/`r`/`enter`/`escape`/`up`/`down`/`j`/`k` for any of seven paste payloads.
A stray paste outside the reason step is inert today and stays inert.

## Design Overview

The component keeps one `Input` instance for the reason step and forwards the step's keystrokes to it, after collapsing newline runs inside a bracketed-paste chunk.

```typescript
// src/authority/bracketed-paste.ts — pure, no SDK/TUI imports
const PASTE_START = "\u001b[200~";
const PASTE_END = "\u001b[201~";

/**
 * Collapse newline runs inside a bracketed-paste chunk to single spaces.
 *
 * The framework editor deletes newlines outright, which joins the words
 * across a line break; a denial reason pasted from a multi-line source
 * should stay readable. Data carrying no complete paste chunk is returned
 * unchanged.
 */
export function collapsePastedNewlines(data: string): string;
```

The rewrite keeps the markers in place, so the framework editor still recognizes the chunk and applies its own tab expansion; only the content between the markers is touched.

The component's reason step becomes a delegation:

```typescript
// src/authority/permission-prompt-component.ts
private readonly reason = new Input();

// in the constructor
this.reason.focused = true;
this.reason.onSubmit = (draft) => { this.apply({ type: "submitReason", draft }); };
this.reason.onEscape = () => { this.apply({ type: "cancel" }); };

private handleReasonInput(data: string): void {
  this.reason.handleInput(collapsePastedNewlines(data));
  this.requestRender();
}
```

`handleInput`'s existing ordering is unchanged: the reason step returns before `handleAppAction`, so the tool-expansion action is still never intercepted during reason entry.
Entering the reason step resets the editor (`this.reason.setValue("")`) where it reset `reasonBuffer`.

The reason step renders the label on its own row above the editor's row, because `Input.render` hardcodes its `"> "` prompt and pads to the full width:

```text
Permission Required
tool : read
path : /repo/secret.txt

Reason (required):
> denied because the command touches ~/.ssh█

enter submit · esc back
```

`Input.render(width)` returns exactly one line of exactly `width` columns, so `fitLinesToWidth` neither wraps nor truncates it, and a 500-character paste scrolls horizontally instead of growing the dialog.

`focused = true` is set so the editor emits pi-tui's zero-width `CURSOR_MARKER`, which positions the hardware cursor for IME composition.
The marker is stripped by the host (`dist/tui.js:860-875`) and counted as zero width by `visibleWidth` (`dist/utils.js:199-212`), so it is invisible to the row/width budget either way.

Two ownership notes:

- The `Input` is constructed inside the component rather than injected.
  It is a leaf UI widget with no IO, created once per prompt alongside the component itself inside the `ui.custom` factory; injecting it would widen the factory signature without giving the tests anything they cannot already reach through `handleInput` and `render`.
- With the editor owning the text, `PromptViewState.reasonDraft` is unambiguously dead state, and leaving it invites a future reader to believe the model owns the reason text.
  It is removed in a final step.

## Module-Level Changes

Source:

- `src/authority/bracketed-paste.ts` — **new**.
  Exports `collapsePastedNewlines(data: string): string`; pure, no SDK or TUI imports.
- `src/authority/permission-prompt-component.ts` — imports `Input` from `@earendil-works/pi-tui`; replaces the `reasonBuffer` field with an `Input` instance wired to `onSubmit`/`onEscape`; `handleReasonInput` collapses the paste and delegates; `apply` resets the editor instead of the buffer; `renderReason` emits a label row plus `this.reason.render(width)`; the private `isPrintable` helper is removed (its sole call site goes with the delegation).
- `src/authority/permission-prompt-decision.ts` — remove the write-only `PromptViewState.reasonDraft` field and its four assignment sites.

Tests:

- `test/authority/bracketed-paste.test.ts` — **new**; unit tests for the collapser.
- `test/authority/permission-prompt-component.test.ts` — new cases for paste, for the bounded reason row, and for a paste at the decision step; existing reason-step cases unchanged.
- `test/authority/permission-prompt-decision.test.ts` — drop `reasonDraft` from the seven state fixtures that carry it.

Docs:

- `packages/pi-permission-system/docs/architecture/architecture.md` — update the `permission-prompt-component.ts` module-tree entry (reason entry is delegated to the framework line editor; keep the `app.tools.expand` constraint) and add a `bracketed-paste.ts` entry to the `authority/` tree.
  The `permission-prompt-decision.ts` entry names the model's parts, not its fields, so it needs no edit for `reasonDraft`.
- `packages/pi-permission-system/docs/configuration.md` — the inline-dialog section (around line 136) describes what the dialog does with keystrokes; add that the reason field is the framework line editor, so paste, cursor movement, and word deletion work, and that a multi-line paste is flattened to one line.
  The existing sentence about a rebound printable key still reaching the reason editor stays true and is unchanged.

Greps run to bound the doc surface:

- `reasonBuffer` / `handleReasonInput` / `isPrintable` — no hits outside `src/authority/permission-prompt-component.ts`.
- `reasonDraft` — `src/authority/permission-prompt-decision.ts` and `test/authority/permission-prompt-decision.test.ts` only.
- `permission-prompt-component` across `docs/` and `.pi/skills/` — `docs/architecture/architecture.md` plus prior plans (historical, not updated).
- `reason` across `README.md` and `.pi/skills/package-pi-permission-system/SKILL.md` — the README names the `r` option only; the skill's hits are about `denialReason` on the forwarding path, not the editor.
  Neither needs an edit.
- `docs/session-approvals.md` lists the four option labels, which do not change.

## Test Impact Analysis

New tests the change enables:

- `collapsePastedNewlines` is a pure function with its own unit tests: a chunk with `\n`, `\r\n`, a run of blank lines, a chunk with no newlines, data with no markers at all, and a chunk missing its end marker.
- The component gains a paste case that could not have been written meaningfully before, since the input was dropped.

Existing tests that stay as-is, and now double as delegation guards:

- "collects a typed reason and resolves `denied_with_reason`" — per-character typing through the framework editor.
- "supports backspace while editing the reason" — `\u007f` reaches `tui.editor.deleteCharBackward`.
- "rejects an empty reason and shows an error, then accepts a real one" — `onSubmit` fires with the editor's value, and the model's validation is untouched.
- "navigates back to the decision step on escape from the reason step" — `onEscape`.
- "does not intercept the expand key while a denial reason is typed" — binds the expand action to a printable key and asserts it is typed literally, which pins the early return ahead of `handleAppAction`.

Nothing becomes redundant; no test is removed.

## Invariants at risk

| Invariant                                                   | Where it is recorded                                                 | What pins it                                                                                                                                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.tools.expand` is never intercepted during reason entry | `architecture.md` module-tree entry; `docs/configuration.md`; [#642] | existing "does not intercept the expand key" test, plus a new case asserting the default Ctrl+O is dropped rather than inserted (measured: the framework editor rejects control characters) |
| Every rendered line fits the terminal width                 | existing "clips every rendered line to the terminal width" test      | extend the same assertion to the reason step after a long paste (measured: `render(40)` yields one line of width ≤ 40)                                                                      |
| The dialog's row count stays bounded ([#710])               | `architecture.md` Phase 13 notes; `dialog-renderer` budget           | new case: the reason step's row count is unchanged after a 500-character paste (measured: the editor renders exactly one row and scrolls horizontally)                                      |
| A stray paste never decides a permission                    | not previously recorded                                              | new case: a paste chunk at the decision step leaves the prompt unsettled (measured: `matchesKey` matches no decision key for seven paste payloads)                                          |
| The decision is attributed to the surface the human used    | `architecture.md` module-tree constraint                             | existing `requestPermissionDecision` dispatch tests; untouched by this change                                                                                                               |
| An empty or whitespace-only reason is rejected              | `normalizePermissionDenialReason`                                    | existing empty-submit test                                                                                                                                                                  |

## TDD Order

1. **The paste collapser.**
   Red: `test/authority/bracketed-paste.test.ts` — a chunk with `\n` and with `\r\n` collapses to single spaces, a run of blank lines collapses to one space, a chunk with no newline is returned byte-identical, data with no markers is returned unchanged, and a chunk missing its end marker is returned unchanged.
   Green: `src/authority/bracketed-paste.ts`.
   Commit: `refactor(pi-permission-system): add a bracketed-paste newline collapser` — nothing imports it yet, so it changes nothing a user can observe.

2. **Delegate the reason step.**
   Red: in `test/authority/permission-prompt-component.test.ts` — a bracketed paste at the reason step appears in the submitted reason; a multi-line paste submits with single spaces; a paste at the decision step leaves the prompt unsettled; the reason step renders one row per line within the width and does not grow after a 500-character paste.
   Green: `src/authority/permission-prompt-component.ts` — the `Input` instance, the `onSubmit`/`onEscape` wiring, the collapsing delegation in `handleReasonInput`, the editor reset in `apply`, the two-row `renderReason`, and the removal of `isPrintable`.
   All existing reason-step cases must stay green in the same commit.
   Commit: `fix(pi-permission-system): accept pasted text in the denial-reason field (#760)`.

3. **Drop the dead draft field.**
   Red is the type checker plus the existing model tests: remove `PromptViewState.reasonDraft` and its four assignments, and drop it from the seven state fixtures in `test/authority/permission-prompt-decision.test.ts`.
   The model and its tests are in one commit because removing an interface field breaks every object literal that sets it.
   Commit: `refactor(pi-permission-system): drop the write-only reason draft from the prompt model`.

4. **Docs.**
   `docs/architecture/architecture.md` module-tree entries and the `docs/configuration.md` dialog section.
   Commit: `docs(pi-permission-system): document the delegated denial-reason editor`.

## Risks and Mitigations

| Risk                                                                                                                                                                                               | Mitigation                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The extension may resolve a different pi-tui module instance than the host, so `Input`'s `getKeybindings()` returns defaults and a user's rebound editor keys do not apply inside the reason field | Not a regression: today's editor uses the config-free `matchesKey` and honors no rebinding at all. The defaults (arrows, `\r`, `\u007f`, `Ctrl+W`/`Ctrl+U`) are what an operator expects. Recorded here rather than fixed; closing it is a separate question about how an extension reaches host keybindings |
| `Ctrl+C` during reason entry now returns to the decision step, where it is swallowed today (`tui.select.cancel` defaults to `["escape", "ctrl+c"]`)                                                | Deliberate and safe: it lands on the decision step, never on an approval, so no ask can be resolved by an interrupt. Called out in the plan and noted in the docs commit                                                                                                                                     |
| Open PR [#757] rewrites `permission-prompt-component.ts` and its test file to wrap the dialog in a bordered panel                                                                                  | Conflict is in the render path, not the input path; this plan touches `renderReason` only. Whichever lands second rebases. Worth deciding [#757]'s fate before or immediately after this ships                                                                                                               |
| `Input.render` emits `CURSOR_MARKER`, and the host's chat editor may emit one too                                                                                                                  | The marker is an APC sequence: `visibleWidth` strips it (`dist/utils.js:199-212`) and the host strips the first one it finds scanning bottom-up; an unmatched APC is ignored by terminals. Zero width either way                                                                                             |
| The peer range is `>=0.79.0`, and a future pi-tui could change `Input`'s paste handling or its `"> "` prompt                                                                                       | The component tests drive the real `Input`, so a behavior change fails this package's suite rather than reaching an operator silently                                                                                                                                                                        |
| A pasted chunk could contain an escape sequence that corrupts the render                                                                                                                           | The framework editor rejects every C0/C1 control character it is handed outside the paste markers, and terminals do not pass an end marker through inside a paste. The reason string's downstream consumers (review log, agent message) are already width-bounded and redaction-independent per ADR 0011 §6  |

## Open Questions

None blocking.
One deferred observation, recorded rather than filed: the reason field is now the only dialog surface with framework-grade editing, while the `select`/`input` fallback's own gap is tracked in [#751].

[#642]: https://github.com/gotgenes/pi-packages/issues/642
[#710]: https://github.com/gotgenes/pi-packages/issues/710
[#751]: https://github.com/gotgenes/pi-packages/issues/751
[#757]: https://github.com/gotgenes/pi-packages/pull/757
