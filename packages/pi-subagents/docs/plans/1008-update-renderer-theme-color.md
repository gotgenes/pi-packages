---
issue: 1008
issue_title: "pi-subagents: the mid-run update renderer calls `theme.fg(\"info\")`, which throws, so updates render as plain custom messages"
---

# Type renderer theme colors as Pi's `ThemeColor` and fix the update renderer's `info`

## Release Recommendation

**Release:** ship independently

This issue is not referenced by any step in `docs/architecture/architecture.md`, so it belongs to no release batch.
It is a user-visible rendering bug fix that should reach users on its own.

## Problem Statement

When a child calls `notify_parent`, the parent should see a compact `● <description> update` line followed by the message preview.
Instead, every mid-run update renders as Pi's default custom-message box.
The cause is `createUpdateRenderer` in `src/observation/renderer.ts`, which calls `theme.fg("info", …)`.
`"info"` is not a Pi `ThemeColor`, so Pi's `Theme.fg` throws `Unknown theme color: info`.
Pi's `CustomMessageComponent` catches a throwing renderer and falls through to its default rendering, so nothing errors visibly.
The type checker missed it because the renderer's local `RendererTheme` interface types `fg`'s color as `string`.

## Goals

- Mid-run updates render through the package's own renderer, with the active glyph in `accent`.
- `tsc` rejects an unknown theme color name in both local theme types: `RendererTheme` in `src/observation/renderer.ts` and `Theme` in `src/ui/display.ts` (operator decision: tighten both).
- Non-breaking: this is a `fix:`.
  No default, config, or public type changes; neither theme type is exported from the public entries.

## Non-Goals

- Merging `RendererTheme` into `display.ts`'s `Theme`; the operator chose to keep them separate.
- Tightening other `string`-typed color or style parameters outside these two interfaces, such as helper parameters in `widget-renderer.ts` that the spike showed still compile.
- A runtime test against Pi's real `Theme`: the package root exports `Theme` and `ThemeColor` but neither `getThemeByName` nor the `theme` singleton.
  Constructing a `Theme` needs every color value, so the type pin carries the guard instead.

## Background

- `src/observation/renderer.ts` defines three message renderers (completion, mid-run update, workspace notice) against a narrow `RendererTheme { fg(style: string, text); bold(text) }`.
  `resolveStatusPresentation` returns `StatusPresentation { iconGlyph; iconStyle: string; statusText }`, which `createNotificationRenderer` passes to `theme.fg`.
- `src/ui/display.ts` exports `type Theme = { fg(color: string, text); bold(text) }`, consumed by `tools/` renderers, `ui/widget-renderer.ts`, `ui/agent-widget.ts`, and `ui/session-navigator.ts`.
- `@earendil-works/pi-coding-agent` exports `type ThemeColor` from its root (verified in the installed 0.84.4 `dist/index.d.ts` line 29 and the Pi checkout's `src/index.ts`).
  `"info"` is not a member; `"accent"` is.
- `ui/widget-renderer.ts` already draws `GLYPHS.agentsActive` in `accent` for the widget heading, so `accent` keeps one color for that glyph across views.
- The `code-design` skill keeps narrow local interfaces for ISP; typing a parameter with an SDK-exported type does not widen the interface.
- `observation/` already imports `#src/ui/display`, and an `import type` from a peer dependency is not governed by the fallow boundary zones.

## Design Overview

Reproduction (real code path, measured at planning time): a disposable vitest spike passed Pi 0.84.4's real `dark` theme (`getThemeByName("dark")`, deep-imported from `dist/`) to `createUpdateRenderer()`.
`theme.fg("accent")` returned normally; `theme.fg("info")` and the renderer both threw `Unknown theme color: info`.
The issue reports the same on Pi 0.99.2 and 1.0.0.

Changes:

```ts
// src/observation/renderer.ts
import type { ThemeColor } from "@earendil-works/pi-coding-agent";

interface RendererTheme {
  fg(color: ThemeColor, text: string): string;
  bold(text: string): string;
}

export interface StatusPresentation {
  iconGlyph: string;
  iconStyle: ThemeColor;
  statusText: string;
}

// createUpdateRenderer
let line = `${theme.fg("accent", GLYPHS.agentsActive)} …`;
```

```ts
// src/ui/display.ts
import type { ThemeColor } from "@earendil-works/pi-coding-agent";

export type Theme = {
  fg(color: ThemeColor, text: string): string;
  bold(text: string): string;
};
```

Measured blast radius, from a spike that applied both type changes and ran `tsc --noEmit` over `src` and `test`:

- The `RendererTheme` change produces exactly 2 errors: `renderer.ts:95` (`iconStyle: string`) and `renderer.ts:132` (`"info"`).
- The `display.ts` `Theme` change produces 0 additional errors.
  All call sites pass literals or a ternary of literals (`display.ts:94`: `"error" | "warning" | "dim"`).
- Test stubs typed `fg: (style: string, …)` stay assignable, because a wider parameter is accepted where `ThemeColor` is expected.

Type pin: `vitest`'s `expectTypeOf` is checked by `tsc --noEmit` (the package `tsconfig.json` includes `test/`), not by the vitest runner.
The renderer pin reads the unexported type via `Parameters<ReturnType<typeof createUpdateRenderer>>[2]["fg"]`, so no new export is needed.
The `display.ts` pin reads `Parameters<Theme["fg"]>[0]`.

## Module-Level Changes

- `packages/pi-subagents/src/observation/renderer.ts`: add the `ThemeColor` type import; retype `RendererTheme.fg` and `StatusPresentation.iconStyle`; change `"info"` to `"accent"` in `createUpdateRenderer`.
- `packages/pi-subagents/src/ui/display.ts`: add the `ThemeColor` type import; retype `Theme.fg`'s color parameter.
- `packages/pi-subagents/test/observation/renderer.test.ts`: change the `draws a running agent as active` assertion from `[info:●]` to `[accent:●]`.
  Add a type pin that the renderers' theme `fg` color parameter is `ThemeColor`.
  Optionally narrow `stubTheme`'s `style` parameter to `ThemeColor`.
- `packages/pi-subagents/test/display.test.ts`: add a type pin that `Theme["fg"]`'s color parameter is `ThemeColor`.
- Predicted unchanged:
  - `src/ui/widget-renderer.ts`, `src/ui/agent-widget.ts`, `src/ui/session-navigator.ts`, `src/tools/*-renderer.ts`, `src/tools/agent-tool.ts`, `src/tools/get-result-tool.ts`, and their tests.
    This rests on the 0-new-errors `tsc` spike above.
  - `README.md`, `docs/`, and `.pi/skills/package-pi-subagents/SKILL.md`.
    A grep found no mention of the `info` color or the update renderer outside plans, retros, and history.

## Test Impact Analysis

- New: two compile-time pins, the only guard against an unknown color name, since the runtime stubs accept any string.
- Changed: the update-renderer color assertion (`[info:●]` → `[accent:●]`).
  Today it pins the bug.
- Unchanged: every other renderer test.
  `stubTheme` echoes the color name, so the completion and workspace-notice assertions are unaffected.

## TDD Order

1. **Red → Green: update renderer uses `accent`, and `RendererTheme.fg` takes `ThemeColor`.**
   - Red: change the assertion in `renderer.test.ts` to expect `[accent:●]` and add the `expectTypeOf<Parameters<Parameters<ReturnType<typeof createUpdateRenderer>>[2]["fg"]>[0]>().toEqualTypeOf<ThemeColor>()` pin.
     Expect a vitest failure (`[info:●]`) and a `pnpm --filter @gotgenes/pi-subagents run check` failure (`string` ≠ `ThemeColor`).
   - Green: apply the `renderer.ts` changes (import, `RendererTheme.fg`, `StatusPresentation.iconStyle`, `"accent"`).
   - Verify: `pnpm --filter @gotgenes/pi-subagents exec vitest run test/observation/renderer.test.ts && pnpm --filter @gotgenes/pi-subagents run check`.
   - Killing mutations:
     - Change `"accent"` to `"dim"` in `createUpdateRenderer`; the vitest assertion goes red.
     - Revert `RendererTheme.fg`'s first parameter to `string` (with `"accent"` kept); `run check` goes red on the pin.
   - Commit: `fix(pi-subagents): render notify_parent updates with the subagent renderer instead of Pi's fallback box (#1008)`
2. **Red → Green: `display.ts` `Theme.fg` takes `ThemeColor`.**
   - Red: add `expectTypeOf<Parameters<Theme["fg"]>[0]>().toEqualTypeOf<ThemeColor>()` to `test/display.test.ts`; `run check` fails.
   - Green: retype `Theme.fg` in `src/ui/display.ts`.
   - Verify: the full package suite plus `run check` and `pnpm --filter @gotgenes/pi-subagents run lint`.
   - Killing mutation: revert `Theme.fg`'s first parameter to `string`; `run check` goes red on the pin.
   - Commit: `refactor(pi-subagents): type the UI theme's color parameter as Pi's ThemeColor (#1008)`.
     It is a `refactor:` because users see nothing change.

## Risks and Mitigations

- **The type pin is not run by vitest.**
  `expectTypeOf` passes at runtime whatever the types are.
  Mitigation: each pin step's red and verify run `pnpm run check`, which CI also runs.
- **`ThemeColor` changes upstream.**
  Pi adds members over time; removing `accent` is unlikely.
  If a member is removed, `tsc` flags the call site, which is the point of the change.
- **Peer-dep type import from `observation/`.**
  `import type` is erased at runtime, so it adds no load-time dependency.

## Open Questions

None.
