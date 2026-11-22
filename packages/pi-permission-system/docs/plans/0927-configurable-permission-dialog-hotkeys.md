---
issue: 927
issue_title: "[Feature Request] pi-permission-system: Configurable hotkeys for the inline permission dialog (unfriendly to IME users)"
---

# Configurable hotkeys for the inline permission dialog

## Release Recommendation

**Release:** ship independently

Issue [#927] is not a step in the open Phase 15 roadmap ("Token roles, declared effects, and the sandbox seam"), so it carries no `Release:` batch tag.
It is a presentation-and-config change on the `LocalUserAuthorizer` dialog path — `evaluate()`, the ruleset, the gates, and the forwarding wire are untouched — so it neither depends on nor blocks any Phase 15 step.

## Problem Statement

The inline TUI permission dialog binds its five decisions to fixed letters: `y` approve, `s` approve-for-session, `b` approve-for-session-both-directions, `n` deny, `r` deny-with-reason.
A user typing with an input method editor (Chinese Pinyin/Wubi, Japanese, Korean) cannot reach them.
While the IME is in composition mode a letter keypress is consumed by the IME's candidate buffer and never reaches the terminal, so the dialog appears frozen.

The reported consequence is worse than an inconvenience.
The natural way to dismiss an IME candidate popup is `Escape` — and `Escape` *does* reach the terminal, where `permission-prompt-component.ts`'s `toEvent` maps it to `{ type: "cancel" }`, which `reduceDecisionStep` turns into `createDeniedPermissionDecision()`.
That is the only non-letter path to a deny in the dialog, so it is the mechanism behind the reporter's accidental rejection of a tool call.
`doublePressToConfirm: true` (the default) compounds it by requiring two swallowed presses before the user reaches for `Escape`.

The arrow-keys-plus-Enter path works today and is the current workaround, but it is undiscoverable relative to the hotkey hints the dialog advertises.

Issue [#927] was filed by `undoubted`, not the operator, so its "Proposed change" is a request to evaluate.
The direction was confirmed with the operator before this plan was written (see Design Overview).

## Goals

- Add a `permissionDialogKeys` config option binding each of the five dialog decisions to a single printable character.
- Keep the defaults exactly `y` / `s` / `b` / `n` / `r`, so an existing config and an existing user's muscle memory are unaffected.
  This change is **not** breaking: no default moves, no output shape changes, and a config that omits the field behaves byte-for-byte as before.
- Validate a binding tolerantly: an unusable or colliding entry is dropped, that decision keeps its default character, and the problem is reported through the existing config-issue channel — the permission policy is never affected by a hotkey typo.
- Render the configured character everywhere the dialog names a hotkey: the option rows, the double-press hint, and the key-hint footer.
- Separate the dialog's decision *identity* from the *character* that selects it, so the two vocabularies stop being one union of letters.

## Non-Goals

- No change to `evaluate()`, the `PermissionResolver`, the ruleset, any gate outcome, the forwarded-request wire, or the review log.
  This is a presentation and configuration change only.
- No change to the non-TUI `select()` / `input()` fallback, which has no hotkeys to remap (the #519 constraint).
- No remapping of the dialog's **navigation** keys (`up`/`down`/`j`/`k`/`enter`/`escape`) or of the reason-step editor.
  `j` and `k` are therefore reserved and rejected as decision bindings.
- No named keys (`f1`, `pageUp`, `escape`) and no modifier combinations (`ctrl+g`, `alt+1`).
  The vocabulary is a single printable character; see Design Overview for why.
- No `/permission-system` settings-modal row for the new option.
  The modal renders on/off toggles (`toOnOff`), and a five-entry key map is not that shape.
  `ConfigStore.save` spreads `...existing.config` and overwrites only `debugLog`, `permissionReviewLog`, and `yoloMode`, so a user's `permissionDialogKeys` survives a modal save untouched — the omission costs nothing.
- No prompt-time collision check against Pi's own keybindings.
  See Risks and Mitigations for the residual.
- No change to the `escape`-denies behavior that produced the reported accident.
  Remapping removes the need to ever enter composition mode during a prompt, which is the reported user's path out; whether `escape` should deny at all is a separate question and is not opened here.

## Background

### The modules this change touches

- `src/authority/permission-prompt-decision.ts` (337 lines) — the pure decision model.
  `PromptKey = "y" | "s" | "b" | "n" | "r"` is the central type, and today its literal values serve **two** roles at once: the decision's identity (what `commit()`'s `switch`, `OPTION_ORDER`, `OPTION_VERBS`, `shiftKey()`, and `PromptEvent`'s `{ type: "hotkey"; key }` read) and the character the user presses (what `pressHotkey()`'s `Press ${key} again to …` hint spells).
  `visibleOptionKeys(config)` is the single roster source — verified — consumed by `shiftKey()` and the decision step's hotkey filter in this file, and by `toEvent()` and `renderDecision()` in the component.
- `src/authority/permission-prompt-component.ts` — the thin `ctx.ui.custom` adapter.
  `toEvent()` matches a keystroke with `visibleOptionKeys(this.config).find((option) => matchesKey(data, option))`, `renderDecision()` renders each row as `` `${marker} (${key}) ${label}` ``, and `hint()` emits the footer line including the literal `"press a letter, then again to confirm"`.
  `PromptPreferences` is the live per-prompt preference bag, read at prompt time and threaded from `index.ts`.
- `src/presentation/dialog-renderer.ts` — `resolveRenderBudget(config: PromptBudgetConfig)` is the in-package precedent this change follows: a prompt-presentation default that lives at its resolver rather than in `DEFAULT_EXTENSION_CONFIG`, called from the `getPromptPreferences` thunk in `index.ts`.
- `src/config/config-loader.ts` — `mergeUnifiedConfigs` (per-shape merge loops), plus `detectPermissiveBashFallback` and `detectDeprecatedPreviewCaps`: pure detectors taking the merged config and returning `string | undefined`, whose messages `loadUnifiedPermissionConfig` pushes onto `allIssues`.
  Those issues reach the user through `FilePolicyLoader.getConfigIssues()` → `PermissionManager.getConfigIssues()` → `SessionLifecycleHandler.handleSessionStart`, which warns each one at session start.
- `src/config/config-schema.ts` — `unifiedConfigSchema` is a `strictObject`, so an unknown top-level key is a load-time error.
- `src/index.ts` (~line 148) — the `getPromptPreferences` thunk that builds `PromptPreferences` per prompt from `configStore.current()`.

### Prior decisions that bear on this

Plan `0573-inline-keybind-permission-dialog.md` shipped the dialog and recorded this exact deferral in its Non-Goals:

> No configurable *remapping* of the hotkey letters — `y`/`s`/`n`/`r` are fixed this round (a per-key config surface, mirroring pi-ask's keybinding schema, is deferred; not filed — revisit only if requested).

It has now been requested, which is the trigger the deferral named.
No ADR, README scope row, or `docs/architecture/architecture.md` non-goal names hotkey configurability, so there is no published-scope collision to argue around.

### Constraints from AGENTS.md and the package skill that apply

- Config field lifecycle: define in `unifiedConfigSchema` with `.meta({ description, markdownDescription })`, regenerate with `pnpm run gen:schema` (a parity test in `test/config-schema.test.ts` fails on drift), carry through `PermissionSystemExtensionConfig`, and merge it in `mergeUnifiedConfigs` — a field on the runtime type but not in the merge is silently dropped (the #332 / #347 class).
- "Treat any declared config field not read at runtime as a maintenance trap" — the field is consumed in the same change that declares it.
- `promptMaxRows` / `promptFieldMaxWidth` / `reviewLogFieldMaxWidth` keep their defaults at their resolvers, **not** in `DEFAULT_EXTENSION_CONFIG`.
  `permissionDialogKeys` is a prompt-presentation knob and follows the same rule.
- Keep Pi SDK/TUI imports out of pure modules: the new `src/config/dialog-keys.ts` imports nothing from `@earendil-works/*`.
  Its test may, and does.
- `src/config/` is the bottom layer — `policy/` depends on it and it depends on nothing above.
  That is why the new module lives in `config/` and the dialog imports *down* into it, rather than `config-loader.ts` importing up into `authority/`.

### External facts, verified at planning time

Probed against the pinned `@earendil-works/pi-tui@0.79.1` (`node_modules/.pnpm/@earendil-works+pi-tui@0.79.1/.../dist/index.js`), not from documentation:

| Probe                                                                            | Result      | Consequence                                                                                                                                                 |
| -------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matchesKey("1", "1")`                                                           | `true`      | Digits are usable hotkeys and nothing in the dialog binds one today                                                                                         |
| `matchesKey("-", "-")`, `matchesKey("!", "!")`, `matchesKey("/", "/")`           | `true`      | Symbol keys are usable                                                                                                                                      |
| `matchesKey("+", "+")`                                                           | **`false`** | `parseKeyId` splits the id on `+`, leaving an empty key name — `+` is a dead binding and must be rejected                                                   |
| `matchesKey("A", "a")`                                                           | `false`     | An uppercase keystroke does not reach a lowercase binding                                                                                                   |
| `matchesKey("a", "A")`                                                           | `true`      | A config value `"A"` silently binds lowercase `a`, so uppercase must be rejected rather than normalized                                                     |
| `matchesKey("é", "é")`                                                           | `false`     | Non-ASCII is a dead binding                                                                                                                                 |
| `Object.values(Key).filter((v) => typeof v === "string" && [...v].length === 1)` | 31 symbols  | pi-tui's symbol vocabulary is derivable at runtime from the exported `Key` constant, so the accepted set can be pinned by parity test rather than by memory |

`KeyId`'s `Digit = "0" … "9"` member is present in the pinned `dist/keys.d.ts`, so a digit binding type-checks as well as matches.

Pi offers no seam for this.
`RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS` in `packages/coding-agent/src/core/extensions/runner.ts` governs *global editor shortcuts* registered by an extension; a focused `ctx.ui.custom` component consumes every keystroke itself, and `KeybindingsManager.matches` only answers for ids present in its own `definitions`.
So the reporter's observation that Pi's keybindings do not cover these keys is correct, and the binding table has to be this package's own config.

## Design Overview

### The settled parameters

Three choices were put to the operator before this plan, with the alternatives and their costs.

1. **Direction** — implement the issue's `permissionDialogKeys` map, defaults unchanged.
   Rejected alternatives: always-on digit aliases with no config; both together; declining.
2. **Vocabulary** — a single printable character only.
   Named keys and modifier combinations were rejected: they are no harder to *validate* (the accepted set is derivable from pi-tui's runtime `Key` export either way), but each widening admits a collision class that no load-time check can see — named keys make `enter`/`escape`/`up`/`down` spellable, and modifiers put every `app.*` host binding in range.
3. **Invalid-value handling** — tolerant fallback with a reported config issue, rather than the package's usual fail-closed scope rejection.
   A cosmetic hotkey typo must not clamp the session's `allow` rules to `ask`.
4. **Cross-scope merge** — whole-object replacement, so the validated unit and the effective unit are the same object.
   Per-action shallow merge (the `shellTools` rule) would admit a duplicate that arises only after merging, which neither file's own validation can see.
   `shellTools` merges because dropping a global shell alias is a silent *enforcement* regression; dropping a key binding only restores a default letter, so the asymmetry that justifies `shellTools` does not exist here.

### Strict shape, tolerant semantics

The two validation regimes split along a line worth stating explicitly, because it is a deliberate carve-out from the package's fail-closed convention (#547):

- **Shape** is strict, in `unifiedConfigSchema`.
  `permissionDialogKeys` is a `strictObject` of five optional `z.string()` members, so an unknown action name (`approveAll`) or a non-string value (`1` instead of `"1"`) is a schema error and the scope is rejected fail-closed like any other malformed field.
  This matches `rejectUnusableSurfaceKeys`' reasoning: a misspelled *key name* sits inert with no feedback, which is the failure mode strictness exists to prevent.
- **Binding semantics** are tolerant, in `resolveDialogKeys`.
  A well-formed string that is not a usable character, is reserved, or collides is dropped in favour of that action's default and reported.
  This failure mode is self-evident at the dialog (the row shows the default letter) and recoverable without touching policy.

### New module: `src/config/dialog-keys.ts`

Pure, no SDK imports, bottom layer.
It owns the action vocabulary, because the action ids **are** the config key names.

```typescript
/**
 * The dialog's five decisions, named by what they do.
 *
 * These ids are the `permissionDialogKeys` config keys, so the config surface
 * and the model speak one vocabulary rather than two that must be mapped.
 */
export type PromptAction =
  | "approve"
  | "approveSession"
  | "approveSessionBoth"
  | "deny"
  | "denyWithReason";

/** Every action's bound character, complete. */
export type DialogKeyBindings = Readonly<Record<PromptAction, string>>;

/** What a config file may say: any subset of the actions. */
export type DialogKeyOverrides = Partial<Record<PromptAction, string>>;

/** The config slice the resolver reads (ISP: one field). */
export interface DialogKeysConfig {
  readonly permissionDialogKeys?: DialogKeyOverrides;
}

export interface DialogKeyResolution {
  readonly keys: DialogKeyBindings;
  /** One human-readable sentence per rejected override; empty when all applied. */
  readonly issues: readonly string[];
}

export const DEFAULT_DIALOG_KEYS: DialogKeyBindings = {
  approve: "y",
  approveSession: "s",
  approveSessionBoth: "b",
  deny: "n",
  denyWithReason: "r",
};

export function resolveDialogKeys(config: DialogKeysConfig): DialogKeyResolution;
```

The accepted characters are a literal in this module — 26 lowercase letters, 10 digits, and pi-tui's 31 symbol keys minus `+`, for 66 characters, of which `j` and `k` are reserved leaving 64 bindable.
A parity test derives the symbol half from `Key` at test time and asserts equality, and separately asserts `matchesKey("+", "+") === false`, so the one hand-made exclusion is pinned by measurement rather than by this plan's memory.
That is the `PURE_READER_CORE` doc-parity pattern applied to a dependency's vocabulary instead of a doc's.

### The resolution algorithm

Two phases, because a collision is a property of the *resulting table* and not of the overrides alone — `{ "approve": "n" }` collides with the untouched default `deny: "n"`, while `{ "approve": "n", "deny": "1" }` is a legitimate rebinding with no collision at all.

1. Validate each override in isolation, in a fixed action order.
   Reject and report when the value is not exactly one code point, is not in the accepted set, or is reserved (`j` / `k`).
2. Build `{ ...DEFAULT_DIALOG_KEYS, ...accepted }` and look for a character bound twice.
   On a collision, drop every *accepted override* whose character is part of it (never a default, which has nothing to fall back to) and rebuild.
   Repeat, bounded by the five actions.

The bound is not decoration: dropping an override restores its default, and that default can collide with a surviving override, so one pass is genuinely insufficient.
A worked example — `{ "approve": "b", "deny": "y" }`: pass 2 sees `approve: "b"` colliding with the default `approveSessionBoth: "b"`, drops it, and `approve` reverts to `"y"`, which now collides with the surviving `deny: "y"`.
The second round drops `deny` too and the table settles on the defaults.
Each round removes at least one override and there are at most five, so the loop terminates; the terminal state is all-defaults, which is collision-free by construction.
The loop is written as a counted `for` over the action list rather than `while (true)`, per the `code-design` skill's unbounded-loop rule.

### Consumer call sites

The resolver is called from exactly two places, so the rule lives once:

```typescript
// src/index.ts — the per-prompt preference thunk, beside resolveRenderBudget
getPromptPreferences: () => ({
  doublePressToConfirm: configStore.current().doublePressToConfirm,
  budget: resolveRenderBudget(configStore.current()),
  dialogKeys: resolveDialogKeys(configStore.current()).keys,
}),
```

```typescript
// src/config/config-loader.ts — same shape as detectDeprecatedPreviewCaps
export function detectUnusableDialogKeys(
  config: DialogKeysConfig,
): string | undefined {
  const { issues } = resolveDialogKeys(config);
  return issues.length === 0 ? undefined : issues.join(" ");
}
```

Both read the same pure function; the first discards the issues and the second discards the keys.
This is Tell-Don't-Ask at the call site: neither caller inspects the override map or re-derives the rule.

### Separating decision identity from bound character

`PromptModelConfig` gains a required `keys: DialogKeyBindings`, and the three sites that today spell the character by reading the union's value read the table instead:

| Site                   | Today                               | After                                                    |
| ---------------------- | ----------------------------------- | -------------------------------------------------------- |
| `pressHotkey()` hint   | `` `Press ${key} again to …` ``     | `` `Press ${config.keys[action]} again to …` ``          |
| `toEvent()` match      | `matchesKey(data, option)`          | `matchesKey(data, this.config.keys[action])`             |
| `renderDecision()` row | `` `${marker} (${key}) ${label}` `` | `` `${marker} (${this.config.keys[action]}) ${label}` `` |

Every other reader of the union — `OPTION_ORDER`, `NARROW_OPTION_ORDER`, `visibleOptionKeys`, `OPTION_VERBS`, `OPTION_LABELS`, `commit()`'s `switch`, `shiftKey()`, `labelFor()`, `PromptViewState.highlightedKey`/`armedKey` — is identity-only and changes only by renaming.

The rename `PromptKey` → `PromptAction` follows the extraction rather than leading it, on the Tidy-First assessor's finding: while the literals are dual-purpose, `"y"` means "the approve action" on one test line and "the physical key pressed" on the next, and no rename — scripted or otherwise — can tell them apart.
Once the character is read through the table, the union's values are pure identity and the relabeling is unambiguous.

Measured test impact of the rename: `test/authority/permission-prompt-decision.test.ts` holds ~44 identity-typed occurrences (28 `key: "…"` event literals, 8 `highlightedKey`, 3 `armedKey`, 1 `.toBe("y")`, 4 roster assertions) out of ~78 single-letter literals — the rest are decision-state strings and rendered hint text that stay characters.
`test/authority/permission-prompt-component.test.ts` holds **zero**: it never constructs a `PromptEvent` or reads the union, only simulating keystrokes (`handleInput("y")`) and asserting rendered characters, both of which stay correct under the default bindings.
These are hand edits in one file, not a scripted substitution.

### Rendered surface

A remapped dialog renders its rows from the table:

```text
▶ (1) Yes
  (2) Yes, for this session
  (4) No
  (5) No, provide reason

↑/↓ move · enter confirm · esc deny · press its key, then again to confirm
```

The footer's fixed `"press a letter, then again to confirm"` becomes `"press its key, then again to confirm"`, since "letter" stops being true.
Note the four-row example: `approveSessionBoth` is offered only when the ask's grants all prove one direction ([#813]), so its binding is simply unused on the other asks — the numbering is fixed per action, never positional, so no character ever means "approve" on one ask and "deny" on another.

## Module-Level Changes

### Added

- `packages/pi-permission-system/src/config/dialog-keys.ts` — the module above: `PromptAction`, `DialogKeyBindings`, `DialogKeyOverrides`, `DialogKeysConfig`, `DialogKeyResolution`, `DEFAULT_DIALOG_KEYS`, the accepted-character set, the reserved set, and `resolveDialogKeys`.
- `packages/pi-permission-system/test/config/dialog-keys.test.ts` — unit tests for the resolver plus the pi-tui parity test.

### Changed

- `packages/pi-permission-system/src/authority/permission-prompt-decision.ts` — `PromptModelConfig` gains `keys: DialogKeyBindings`; `PromptKey` becomes `PromptAction` (imported from `#src/config/dialog-keys`); `visibleOptionKeys` → `visibleActions`; `PromptViewState.highlightedKey`/`armedKey` → `highlightedAction`/`armedAction`; `PromptEvent`'s hotkey member becomes `{ type: "hotkey"; action: PromptAction }`; `OPTION_ORDER` / `NARROW_OPTION_ORDER` / `OPTION_VERBS` re-key; `pressHotkey`'s hint reads the bound character.
- `packages/pi-permission-system/src/authority/permission-prompt-component.ts` — `PromptPreferences` gains `dialogKeys: DialogKeyBindings`; `presentInlinePermissionPrompt` threads it into `PromptModelConfig`; `OPTION_LABELS` and `labelFor` re-key; `toEvent` and `renderDecision` read the table; `hint()`'s footer wording changes.
- `packages/pi-permission-system/src/config/config-schema.ts` — adds `permissionDialogKeys` beside `doublePressToConfirm` (~line 318) as a `strictObject` of five optional `z.string()` members, each with `description` / `markdownDescription`, plus an `examples` entry carrying the digit mapping so the discoverable form lives in the schema.
- `packages/pi-permission-system/src/config/extension-config.ts` — `PermissionSystemExtensionConfig` gains the **optional** raw `permissionDialogKeys?: DialogKeyOverrides`, and `normalizePermissionSystemConfig` passes it through in the existing `if (raw.X !== undefined)` style.
  `DEFAULT_EXTENSION_CONFIG` is deliberately **not** touched, following `promptMaxRows` / `promptFieldMaxWidth`.
- `packages/pi-permission-system/src/config/config-loader.ts` — `mergeUnifiedConfigs` gains whole-object replacement for the field (its own block with a comment stating why it is not the `shellTools` shallow merge); `detectUnusableDialogKeys` is added beside the two existing detectors and its message pushed onto `allIssues` in `loadUnifiedPermissionConfig`; the merge doc comment's field inventory is updated.
- `packages/pi-permission-system/src/index.ts` — the `getPromptPreferences` thunk gains `dialogKeys`.
- `packages/pi-permission-system/schemas/permissions.schema.json` — regenerated via `pnpm run gen:schema`; never hand-edited.
- `packages/pi-permission-system/config/config.example.json` — adds a `permissionDialogKeys` block spelling the **defaults**, so copying the example changes nothing.
- `packages/pi-permission-system/test/authority/permission-prompt-decision.test.ts` — `makeConfig()` supplies `keys: DEFAULT_DIALOG_KEYS`; ~44 identity literals renamed; new cases for the bound-character hint.
- `packages/pi-permission-system/test/authority/permission-prompt-component.test.ts` — new cases for matching and rendering a remapped binding; existing cases unchanged in meaning.
- `packages/pi-permission-system/test/helpers/prompt-view-fixtures.ts` — `makePromptPreferences` gains `dialogKeys: DEFAULT_DIALOG_KEYS`.
- `packages/pi-permission-system/test/config-schema.test.ts` — schema-parity assertion covers the regenerated JSON Schema.
- `packages/pi-permission-system/test/config/config-loader.test.ts` — merge cases for the new field, mirroring the array-field replacement cases at lines 653–666; a `detectUnusableDialogKeys` case.
- `packages/pi-permission-system/docs/configuration.md` — a `permissionDialogKeys` row in the scalar-field table; the "Scalar fields … use simple replacement" sentence gains the field; the "Inline permission dialog (TUI)" section documents the option, the accepted vocabulary, the reserved `j`/`k`, the tolerant fallback, and the IME rationale, and its "a letter hotkey **arms**" sentence is reworded.
- `packages/pi-permission-system/README.md` — line 68's hotkey sentence notes the keys are configurable.
- `packages/pi-permission-system/docs/architecture/architecture.md` — the `config/` module-tree block gains a `dialog-keys.ts` entry describing current behavior (the binding vocabulary, the defaults, and the tolerant resolution).
  No roadmap step mark: [#927] is not a Phase 15 step.

### Predicted unchanged, with the claim each rests on

- `packages/pi-permission-system/src/config/config-modal.ts` — `cloneDefaultConfig()` hand-lists four fields and returns `PermissionSystemExtensionConfig`.
  It compiles only because the new field is **optional**; if the field were made required (as an earlier draft of this design had it), this is the site `tsc` would fail at.
- `packages/pi-permission-system/src/config/config-store.ts` — `save()` writes `{ ...existing.config, debugLog, permissionReviewLog, yoloMode }`, so a user's `permissionDialogKeys` survives a settings-modal save.
- Every fixture that spreads `...DEFAULT_EXTENSION_CONFIG` (`test/config/config-modal.test.ts`, `config-store.test.ts`, `session-logger.test.ts`, `logging.test.ts`, `test/helpers/handler-fixtures.ts`, `session-fixtures.ts`) — `DEFAULT_EXTENSION_CONFIG` does not change shape, so none of them do.
- `test/composition-root.test.ts` — it does not construct `PromptPreferences`; `getPromptPreferences` is built inside `index.ts`.
  If this prediction is wrong, the repair belongs in the step whose commit breaks it.
- The forwarded-request wire, `PermissionPromptDecision`, `permissions:ui_prompt`, and the review log — the binding table never leaves the dialog's render and match paths.

## Test Impact Analysis

### What the extraction enables

`resolveDialogKeys` is a pure function over a plain object, so the whole validation surface — vocabulary, reserved keys, the two-phase collision fixed point, and the issue strings — is unit-testable with no TUI, no config file, and no session.
None of that is reachable today.

The equivalence classes, each of which needs its own case:

| Class                          | Example                                | Expected                                         |
| ------------------------------ | -------------------------------------- | ------------------------------------------------ |
| No override                    | `{}`                                   | Defaults, no issues                              |
| Valid digit remap              | `{ approve: "1", deny: "4" }`          | Applied, no issues                               |
| Wrong length                   | `{ approve: "" }`, `{ approve: "yy" }` | Default kept, issue                              |
| Uppercase                      | `{ approve: "A" }`                     | Default kept, issue (it would bind `a`, not `A`) |
| Non-ASCII                      | `{ approve: "é" }`                     | Default kept, issue                              |
| Dead symbol                    | `{ approve: "+" }`                     | Default kept, issue                              |
| Live symbol                    | `{ approve: "/" }`                     | Applied                                          |
| Reserved nav key               | `{ deny: "j" }`                        | Default kept, issue                              |
| Override-vs-override collision | `{ approve: "1", deny: "1" }`          | Both dropped, issue                              |
| Override-vs-default collision  | `{ approve: "n" }`                     | Dropped, issue                                   |
| Legitimate swap                | `{ approve: "n", deny: "y" }`          | Both applied, no issue                           |
| Cascading collision            | `{ approve: "b", deny: "y" }`          | Both dropped after two rounds, issues            |

The cascading case is the one a single-pass implementation passes by accident in the other eleven and fails here, so it is the class that earns the fixed point.

### What becomes redundant

Nothing.
The existing decision-model and component tests exercise the default bindings, which stay the shipped behavior and remain the case every user without config hits.

### What must stay as-is

`permission-prompt-component.test.ts`'s keystroke simulations (`handleInput("y")`) and its `decisionOptionKeys()` helper (`/^[ ▶] \((\w)\) /`) — the helper already reads whatever character is in parentheses, so it needs no edit and it is what will assert a remapped row renders `(1)`.

### The input domain of the matcher

The bindable-character table is a claim about a dependency, so it is verified against the dependency rather than against imagined inputs: the parity test derives pi-tui's single-character `Key` values at test time and asserts the table equals them plus the letters and digits, minus `+`.
`matchesKey("+", "+") === false` is asserted directly, so the exclusion cannot rot into an unexplained special case.

## Invariants at risk

This change touches the dialog shipped by plan `0573` and extended by `0813` (grant-direction width) and `0760` (reason-field paste).
Their invariants and the tests that pin them:

| Invariant                                                                                             | Pinned by                                                                               | Risk here                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The `b` option appears only when the ask supplies `widthLabel`, and the roster is otherwise four keys | `visibleOptionKeys` cases in `permission-prompt-decision.test.ts` (4 roster assertions) | The rename touches every one; the roster rule itself is untouched                                                                                                                                      |
| A narrow session grant serializes with no `sessionGrantWidth` field                                   | `sessionDecision` cases in `permission-prompt-decision.test.ts`                         | None — `commit()` changes only its parameter's name                                                                                                                                                    |
| Arming is per key and a second press of the same key commits                                          | `pressHotkey` cases                                                                     | The hint's **text** changes; the arming rule does not                                                                                                                                                  |
| The reason editor is rebuilt per visit so a backed-out reason cannot leak into a later ask            | `createReasonEditor` cases in `permission-prompt-component.test.ts`                     | None — the reason step reads no binding                                                                                                                                                                |
| `app.tools.expand` stays live while the dialog holds focus and never resolves the decision            | `handleToolsExpandAction` cases in `permission-prompt-component.test.ts`                | `handleInput` still tests it before mapping a hotkey; ordering is unchanged                                                                                                                            |
| `escape` denies; `enter` confirms the highlighted option; `up`/`down`/`j`/`k` navigate                | `toEvent` cases in `permission-prompt-component.test.ts`                                | These are matched **before** the hotkey table, and `j`/`k` are reserved, so no binding can shadow them — the reserved-key rejection is what keeps this true, and it is pinned in `dialog-keys.test.ts` |

The last row is the invariant this change could actually regress, and it is the reason `j` and `k` are rejected rather than merely documented.

One invariant is quantitative and worth stating plainly: the **default** render is byte-identical.
With no config, `resolveDialogKeys` returns `DEFAULT_DIALOG_KEYS`, every row renders `(y)`…`(r)` exactly as before, and the only changed default-path string in the whole plan is the footer's `"press a letter"` → `"press its key"`.
That single wording change is the complete default-path diff, and the component test's footer assertion pins it.

## TDD Order

1. **`refactor(pi-permission-system): read the dialog's hotkey character through a binding table`** Prepares: the feature's three read sites, while the union's literals are still dual-purpose.
   This is the Tidy-First assessor's leading recommendation, and it must come first — a rename attempted before it cannot distinguish a test line that means "the approve action" from one that means "the key the user pressed".
   Add an optional `keys?: Record<PromptKey, string>` to `PromptModelConfig` and change the hint, the `toEvent` match, and the `renderDecision` row to `config.keys?.[key] ?? key`.
   Tests: a decision-model case asserting the hint spells the bound character, and component cases asserting a remapped binding both matches a keystroke and renders in its row.
   Every existing test stays green, because `keys` is absent everywhere and the fallback is the identity.
   Killing mutations: (a) revert `toEvent` to `matchesKey(data, option)` — the new component match case goes red; (b) revert the row template to `` `(${key})` `` — the new render case goes red; (c) revert the hint to `` `Press ${key} again` `` — the new model case goes red.

2. **`refactor(pi-permission-system): name the dialog's options by action`** Prepares: a config surface whose keys are the action ids, so the config and the model speak one vocabulary.
   Create `src/config/dialog-keys.ts` with `PromptAction`, `DialogKeyBindings`, `DialogKeyOverrides`, and `DEFAULT_DIALOG_KEYS` only — no resolver yet.
   Rename throughout both `src/` files and `permission-prompt-decision.test.ts` (the ~44 measured occurrences, by hand, one file), make `PromptModelConfig.keys` required, and have `presentInlinePermissionPrompt` and the two test factories supply `DEFAULT_DIALOG_KEYS`.
   Still `refactor:` — nothing a user can set has appeared.
   Killing mutation: change `DEFAULT_DIALOG_KEYS.deny` to `"x"`; every component test pressing `"n"` goes red.

3. **`refactor(pi-permission-system): declare the dialog's bindable key characters`** The data half, with its verifier written first.
   Add the accepted-character set and `isBindableDialogKey` to `dialog-keys.ts`, and `test/config/dialog-keys.test.ts` with the pi-tui parity test plus the per-character cases (digit, live symbol, `+`, uppercase, non-ASCII, wrong length).
   Write the parity test before the table, per the "verify one row before writing the rows" rule for tables of external facts.
   Killing mutations: (a) add `+` back to the table — the parity test and the `+` case go red; (b) make `isBindableDialogKey` accept any single code point — the uppercase and non-ASCII cases go red.

4. **`refactor(pi-permission-system): resolve a configured dialog key map against the defaults`** The mechanism half.
   Add `DialogKeysConfig`, `DialogKeyResolution`, and `resolveDialogKeys` with the two-phase fixed point and the issue strings.
   Tests: every equivalence class in the Test Impact Analysis table.
   Killing mutations, one per class: (a) drop the reserved-key check — the `{ deny: "j" }` case goes red; (b) run phase 2 once instead of to a fixed point — the cascading `{ approve: "b", deny: "y" }` case goes red and the other eleven stay green; (c) detect collisions among the overrides only, not the resolved table — the `{ approve: "n" }` override-vs-default case goes red; (d) return `issues: []` unconditionally — every rejection case goes red.

5. **`feat(pi-permission-system): let the permission dialog's hotkeys be remapped`** The observable commit.
   Add `permissionDialogKeys` to `unifiedConfigSchema` with `.meta` and an `examples` digit map, run `pnpm run gen:schema`, carry the raw field through `PermissionSystemExtensionConfig` and `normalizePermissionSystemConfig`, add whole-object replacement to `mergeUnifiedConfigs`, add `dialogKeys` to `PromptPreferences` and the fixture, and resolve it in `index.ts`'s `getPromptPreferences`.
   Tests: schema parity; a merge case proving project replaces global whole; a `normalizePermissionSystemConfig` passthrough case.
   Killing mutations: (a) drop the field from `mergeUnifiedConfigs` — the merge case goes red; (b) have `getPromptPreferences` pass `DEFAULT_DIALOG_KEYS` instead of the resolved map — a wiring case goes red.

6. **`feat(pi-permission-system): report an unusable permission-dialog key binding`** Add `detectUnusableDialogKeys` beside `detectPermissiveBashFallback` / `detectDeprecatedPreviewCaps` and push its message in `loadUnifiedPermissionConfig`.
   Tests: a loader case asserting a config with a reserved binding produces an issue and still loads its policy unchanged — which is the whole point of the tolerant choice.
   Killing mutation: return `undefined` unconditionally; the loader case goes red.

7. **`docs(pi-permission-system): document permissionDialogKeys`** `docs/configuration.md` (table row, scalar-replacement sentence, the dialog section with the IME rationale and the reserved keys, the reworded "a letter hotkey arms" sentence), `README.md` line 68, `config/config.example.json` with the defaults, and the `config/` module-tree entry for `dialog-keys.ts` in `docs/architecture/architecture.md`.

## Risks and Mitigations

- **A user rebinds Pi's `app.tools.expand` to a printable character that is also a dialog binding.**
  `handleInput` tests the app action **before** mapping a hotkey, so expansion wins and the decision key is dead.
  This is true of the fixed letters today and is not introduced here, but remapping makes it reachable more often.
  Pi's keybindings are only available inside the `ui.custom` factory callback, not at config-load time, so a load-time check is impossible and a prompt-time one would be a new mechanism on the render path.
  Mitigation: document it in `docs/configuration.md` beside the existing `app.tools.expand` paragraph, which already tells the reader that binding stays live.
- **A cosmetic typo silently does nothing.**
  Mitigated by the tolerant resolver reporting each rejection through `getConfigIssues`, which `SessionLifecycleHandler.handleSessionStart` warns at session start — the same channel that already surfaces a legacy policy path and a deprecated cap.
- **The accepted-character table drifts from pi-tui.**
  Mitigated by the parity test, which fails at dependency-bump time rather than at a user's keystroke.
- **The fixed point does not terminate.**
  Mitigated structurally: the loop is a counted `for` over the five actions, each round removes at least one override, and the terminal all-defaults state is collision-free by construction.
  The cascading test case is what proves a single pass is insufficient; a bound of one would leave a duplicate in the shipped table.
- **The rename regresses an assertion silently.**
  Mitigated by sequencing: step 1 changes no test at all, so step 2's diff is a pure relabeling whose only expected test change is the literals themselves, and step 2's killing mutation (moving a default) proves the component tests still reach the real bindings.
- **A remapped binding shadows navigation.**
  Mitigated by rejecting `j` and `k` and by the vocabulary being single characters, which makes `enter`, `escape`, `up`, and `down` unspellable.

## Open Questions

- Whether `escape` should deny at all, rather than cancel to a neutral state, is the other half of the reported accident and is deliberately untouched here.
  It is a breaking behavior change to a documented contract and would need its own issue and gate; nothing in this plan forecloses it.
- Whether the dialog should also accept a **second** binding per action (a list rather than a single character), which would let the defaults keep their letters while adding digits for free.
  Deferred until someone asks: the operator chose the single-character map this round, and widening `string` to `string | string[]` later is additive.
- No follow-up issues are filed by this plan; nothing it defers is concrete enough to file without speculation.

[#813]: https://github.com/gotgenes/pi-packages/issues/813
[#927]: https://github.com/gotgenes/pi-packages/issues/927
