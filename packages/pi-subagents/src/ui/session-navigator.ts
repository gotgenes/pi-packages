/**
 * session-navigator.ts — The `/subagents:sessions` command: pick a subagent and
 * read its transcript through Pi's own per-entry session components.
 *
 * SDK/TUI consumer half of native session navigation. The unit-testable core
 * (selection, sourcing) lives in `session-navigation.ts`; this module wires that
 * core to the command picker and a read-only scrollable pane, and owns the
 * renderer — it mounts Pi's interactive components (`AssistantMessageComponent`,
 * `ToolExecutionComponent`, …) into a `Container`, mirroring Pi's own
 * `renderSessionContext` mapping. Rendering lives here, not in the pure module,
 * because the components require a `TUI`, `cwd`, and markdown theme.
 *
 * Its chrome is two labeled rules in the style of Pi's editor border: the top
 * names the agent, its task, model, and thinking level; the bottom carries the
 * scroll position and key hints. Both take the thinking level's border colour,
 * read from the source on every render, so a live child's change repaints them.
 *
 * The pane is strictly read-only — steering stays in the `steer_subagent` tool
 * and the widget. It consumes a `TranscriptSource`, so a released agent's disk
 * snapshot (`fileSnapshotSource`) swaps in without touching the renderer or the pane.
 *
 * In regular mode it mounts through `ui.custom`'s non-overlay path deliberately:
 * Pi's regular-mode renderer composites overlays into the buffer that backs
 * scrollback, so an overlay mount bakes this pane's chrome into terminal history
 * (`docs/decisions/0007-transcript-viewer-is-not-an-overlay.md`). In fullscreen
 * mode it floats as an overlay over the bottom of the screen, because Pi's
 * fullscreen viewport claims PgUp/PgDn/Home/End before any docked component and
 * defers them only to a focused overlay
 * (`docs/decisions/0012-fullscreen-viewer-is-an-overlay.md`).
 */

import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type Keybinding,
  type KeyId,
  type MarkdownTheme,
  matchesKey,
  type OverlayOptions,
  type TUI,
  type TuiMode,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import type { AgentConfigLookup } from "#src/config/agent-types";
import { readPersistedRuns, type SessionEntryLike } from "#src/persisted-record";
import { formatModel, type ModelIdentity, type Theme } from "#src/ui/display";
import { labeledRule } from "#src/ui/labeled-rule";
import {
  type EntryHeading,
  fileSnapshotSource,
  listNavigableAgents,
  liveSource,
  type NavigableSubagent,
  type TranscriptSource,
} from "#src/ui/session-navigation";
import { TranscriptContent } from "#src/ui/transcript-content";

// ─────────────────────────────────────────────────────────────────────────────

/** Chrome lines: the header rule and the footer rule. The pane sits on Pi's own chrome, so it needs no frame. */
const CHROME_LINES = 2;
const MIN_VIEWPORT = 3;
const VIEWPORT_HEIGHT_PCT = 70;

/**
 * Rows Pi's default footer takes: the cwd and stats rows. An extension status
 * adds a third, which the pane covers while open; reserving it instead would
 * expose the editor's bottom border whenever no status is set.
 */
const PI_FOOTER_ROWS = 2;

/** Where the fullscreen pane floats: the region the docked pane fills in regular mode, above Pi's footer. */
const FULLSCREEN_OVERLAY: OverlayOptions = {
  anchor: "bottom-center",
  width: "100%",
  maxHeight: `${VIEWPORT_HEIGHT_PCT}%`,
  margin: { bottom: PI_FOOTER_ROWS },
};

/** What the mode probe mounts: nothing, since it closes before Pi would mount it. */
const NOTHING: Component = { render: () => [], invalidate: () => {} };

/**
 * The pane's theme: the shared narrow `Theme` plus the one method only the pane
 * needs. Pi's own `Theme` satisfies it; the widening stays here so the other
 * render sites' theme stubs do not grow.
 */
export type TranscriptTheme = Theme & {
  /** Pi's editor-border colour for a thinking level; an unknown level paints as `off`. */
  getThinkingBorderColor(level: string): (text: string) => string;
};

/**
 * The `KeybindingsManager` surface the pane reads. Pi passes its manager to
 * every `ui.custom` factory, so the pane honours the operator's remaps.
 */
export interface PaneKeys {
  matches(data: string, keybinding: Keybinding): boolean;
  getKeys(keybinding: Keybinding): KeyId[];
}

/** Component factory shape Pi's `ui.custom` invokes to mount a component. */
export type CustomComponentFactory<R> = (
  tui: TUI,
  theme: TranscriptTheme,
  keybindings: PaneKeys,
  done: (result: R) => void,
) => Component;

/** Narrow UI interface — only the `ctx.ui` methods the navigator calls. */
export interface SessionNavigatorUI {
  select(title: string, options: string[]): Promise<string | undefined>;
  notify(message: string, level: "info" | "warning" | "error"): void;
  /** Whether the main conversation shows tool output expanded (Pi's `app.tools.expand` state). */
  getToolsExpanded(): boolean;
  custom<R>(component: CustomComponentFactory<R>, options?: ViewerMountOptions): Promise<R>;
}

/** How `ui.custom` mounts a component: Pi's options, narrowed to what the navigator sets. */
export interface ViewerMountOptions {
  overlay: boolean;
  overlayOptions?: OverlayOptions;
}

/** Parameters for one `/subagents:sessions` invocation. */
export interface SessionNavigatorParams {
  ui: SessionNavigatorUI;
  agents: readonly NavigableSubagent[];
  registry: AgentConfigLookup;
  /** Working directory for tool-call rendering (relative path display). */
  cwd: string;
  /** Reads a persisted session file for the file-snapshot source. */
  readFile: (path: string) => string;
  /** The parent session's entries, whose run records outlive the manager's. */
  sessionEntries: readonly SessionEntryLike[];
}

/** How a scroll move treats following new output; by default it follows when it lands on the bottom. */
interface ScrollOptions {
  follow?: boolean;
}

/** Options for the read-only transcript pane. */
export interface TranscriptPaneOptions {
  tui: TUI;
  theme: TranscriptTheme;
  /** Paging and top/bottom follow Pi's viewport bindings (`tui.altScreen.*`). */
  keys: PaneKeys;
  source: TranscriptSource;
  /** Who produced the transcript, named in the header rule. */
  heading: EntryHeading;
  done: (result: undefined) => void;
  cwd: string;
  markdownTheme: MarkdownTheme;
  /** Whether collapsible blocks open expanded: the main conversation's state when the pane opened. */
  toolsExpanded: boolean;
}

/**
 * Handler for the `/subagents:sessions` slash command.
 *
 * Lists navigable subagents, lets the operator pick one, and opens its transcript
 * read-only. Receives the agent snapshot (`manager.listAgents()`) rather than the
 * manager, so it stays a reactive consumer with no inbound call into the core.
 * The session's entries add the runs it recorded that the manager no longer
 * holds, such as those from before a `/reload`.
 */
export class SessionNavigatorHandler {
  async handle({ ui, agents, registry, cwd, readFile, sessionEntries }: SessionNavigatorParams): Promise<void> {
    const entries = listNavigableAgents(agents, registry, readPersistedRuns(sessionEntries));
    if (entries.length === 0) {
      ui.notify("No subagent sessions to view.", "info");
      return;
    }

    const choice = await ui.select(
      "Subagent sessions",
      entries.map((entry) => entry.label),
    );
    const entry = entries.find((candidate) => candidate.label === choice);
    if (!entry) return;

    let source: TranscriptSource;
    try {
      source = entry.kind === "live" ? liveSource(entry.record) : fileSnapshotSource(entry.outputFile, readFile);
    } catch {
      ui.notify("Could not read the session transcript file.", "error");
      return;
    }
    const markdownTheme = getMarkdownTheme();
    // Read after the picker: Pi's selector toggles the main conversation's state on its own key.
    const toolsExpanded = ui.getToolsExpanded();
    const mode = await probeTuiMode(ui);
    await ui.custom<undefined>(
      (tui, theme, keys, done) =>
        new TranscriptPane({ tui, theme, keys, source, heading: entry.heading, done, cwd, markdownTheme, toolsExpanded }),
      viewerMountOptions(mode),
    );
  }
}

/**
 * The TUI's render mode, read before the pane mounts. Pi decides overlay versus
 * docked before it runs a `ui.custom` factory and exposes no mode accessor, so
 * this mounts a factory that closes with `tui.mode` before returning; Pi then
 * never mounts what it returns. A UI that runs no factory (print or RPC mode)
 * resolves `undefined`, which keeps the docked default.
 */
async function probeTuiMode(ui: SessionNavigatorUI): Promise<TuiMode> {
  const mode = await ui.custom<TuiMode | undefined>((tui, _theme, _keys, done) => {
    done(tui.mode);
    return NOTHING;
  });
  return mode === "fullscreen" ? "fullscreen" : "regular";
}

/** Docked in regular mode (ADR 0007); a focused overlay in fullscreen mode, so the viewport keys reach it (ADR 0012). */
function viewerMountOptions(mode: TuiMode): ViewerMountOptions {
  return mode === "fullscreen" ? { overlay: true, overlayOptions: FULLSCREEN_OVERLAY } : { overlay: false };
}

/**
 * Read-only scrollable transcript pane.
 *
 * Owns scroll state, chrome, and key handling; the rows it paints come from a
 * `TranscriptContent` collaborator, which holds the transcript's components and
 * refreshes them when the source changes (live agents).
 */
export class TranscriptPane implements Component {
  private scrollOffset = 0;
  private autoScroll = true;
  private unsubscribe: (() => void) | undefined;
  private closed = false;

  private readonly tui: TUI;
  private readonly theme: TranscriptTheme;
  private readonly keys: PaneKeys;
  private readonly source: TranscriptSource;
  private readonly heading: EntryHeading;
  private readonly done: (result: undefined) => void;
  private readonly content: TranscriptContent;
  /** Width the host last rendered at; input must use the same layout. */
  private renderedWidth: number | undefined;

  constructor({ tui, theme, keys, source, heading, done, cwd, markdownTheme, toolsExpanded }: TranscriptPaneOptions) {
    this.tui = tui;
    this.theme = theme;
    this.keys = keys;
    this.source = source;
    this.heading = heading;
    this.done = done;
    this.content = new TranscriptContent({ tui, cwd, markdownTheme, source, toolsExpanded });
    this.unsubscribe = source.subscribe((event) => {
      if (this.closed) return;
      this.content.apply(event);
      this.tui.requestRender();
    });
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.closed = true;
      this.done(undefined);
      return;
    }

    if (this.keys.matches(data, "app.tools.expand")) {
      this.content.toggleExpanded();
      return;
    }

    const { viewportHeight } = this.scrollBounds(this.inputWidth());

    if (matchesKey(data, "up") || matchesKey(data, "k")) {
      this.scrollBy(-1);
    } else if (matchesKey(data, "down") || matchesKey(data, "j")) {
      this.scrollBy(1);
    } else if (this.keys.matches(data, "tui.altScreen.pageUp") || matchesKey(data, "shift+up")) {
      this.scrollBy(-viewportHeight, { follow: false });
    } else if (this.keys.matches(data, "tui.altScreen.pageDown") || matchesKey(data, "shift+down")) {
      this.scrollBy(viewportHeight);
    } else if (this.keys.matches(data, "tui.altScreen.top")) {
      this.scrollTo(0, { follow: false });
    } else if (this.keys.matches(data, "tui.altScreen.bottom")) {
      this.scrollTo(Number.POSITIVE_INFINITY);
    }
  }

  /** The wheel scrolls the transcript; every other mouse event is left to the host. */
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "wheel") return undefined;
    this.scrollBy(event.wheelDelta ?? 0);
    return { handled: true };
  }

  render(width: number): string[] {
    if (width < 6) return [];
    const th = this.theme;
    this.renderedWidth = width;
    const lines: string[] = [];

    // Rows span at most the width the host supplied: pi-tui rejects a wider one.
    const fit = (content: string): string => truncateToWidth(content, width);
    const { model, thinkingLevel } = this.source.sessionModel();
    const paint = th.getThinkingBorderColor(thinkingLevel ?? "off");

    lines.push(labeledRule(width, paint, this.headerLabels(model, thinkingLevel)));

    const { totalLines, viewportHeight, maxScroll } = this.scrollBounds(width);
    if (this.autoScroll) this.scrollOffset = maxScroll;
    const visibleStart = Math.min(this.scrollOffset, maxScroll);
    const visible = this.content.slice(width, visibleStart, viewportHeight);
    for (let i = 0; i < viewportHeight; i++) lines.push(fit(visible[i] ?? ""));

    const scrollPct =
      totalLines <= viewportHeight
        ? "100%"
        : `${Math.round(((visibleStart + viewportHeight) / totalLines) * 100)}%`;
    const position = th.fg("dim", `${totalLines} lines · ${scrollPct}`);
    const hints = this.footerHints().map((hint) => th.fg("dim", hint));
    lines.push(labeledRule(width, paint, [position], hints));

    return lines;
  }

  // fallow-ignore-next-line unused-class-member
  invalidate(): void {
    this.content.invalidate();
  }

  dispose(): void {
    this.closed = true;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  // ---- Private ----

  /**
   * The key hints the footer rule carries on its right, naming the keys the
   * operator actually bound: the first key of each binding, and no segment
   * for a binding left wholly unbound. Fallbacks in preference order: the
   * tool-output toggle is the first hint a narrow footer drops.
   */
  private footerHints(): string[] {
    const page = this.firstKeys("tui.altScreen.pageUp", "tui.altScreen.pageDown");
    const ends = this.firstKeys("tui.altScreen.top", "tui.altScreen.bottom");
    const toggle = this.firstKeys("app.tools.expand");
    const withToggle = ["↑↓ scroll", page, ends, toggle && `${toggle} expand`, "Esc close"];
    const withoutToggle = ["↑↓ scroll", page, ends, "Esc close"];
    return [withToggle, withoutToggle].map((segments) => segments.filter((segment) => segment !== "").join(" · "));
  }

  /**
   * The first key of each binding, joined: `PageUp/PageDown` for a pair, the
   * bound side alone when the other is unbound, and empty when none is bound.
   */
  private firstKeys(...keybindings: Keybinding[]): string {
    return keybindings
      .flatMap((keybinding) => this.keys.getKeys(keybinding).slice(0, 1))
      .map(displayKey)
      .join("/");
  }

  /**
   * Header labels, most to least informative: the rule drops the task first,
   * then the model and thinking level, before it truncates the agent's name.
   */
  private headerLabels(model: ModelIdentity | undefined, thinkingLevel: string | undefined): string[] {
    const th = this.theme;
    const { name, modeLabel, description } = this.heading;
    const identity = th.bold(name) + (modeLabel ? ` ${th.fg("muted", `(${modeLabel})`)}` : "");
    const runtime = describeRuntime(model, thinkingLevel);
    const runtimeTag = runtime ? th.fg("muted", ` · ${runtime}`) : "";
    return [`${identity}  ${th.fg("muted", description)}${runtimeTag}`, identity + runtimeTag, identity];
  }

  private scrollBy(delta: number, options?: ScrollOptions): void {
    this.scrollTo(this.scrollOffset + delta, options);
  }

  /**
   * Move to `offset`, clamped to the transcript. The pane follows new output
   * when it lands on the bottom, unless the move says otherwise: paging up or
   * jumping to the top stops following even on a transcript that fits.
   */
  private scrollTo(offset: number, { follow }: ScrollOptions = {}): void {
    const { maxScroll } = this.scrollBounds(this.inputWidth());
    this.scrollOffset = Math.min(maxScroll, Math.max(0, offset));
    this.autoScroll = follow ?? this.scrollOffset >= maxScroll;
  }

  /**
   * Scroll geometry at a given layout width.
   *
   * The single place a width becomes a viewport height, so `render` and
   * `handleInput` cannot disagree about how far the transcript scrolls.
   */
  private scrollBounds(width: number): { totalLines: number; viewportHeight: number; maxScroll: number } {
    const totalLines = this.content.lineCount(width);
    const viewportHeight = this.viewportHeight(totalLines);
    return { totalLines, viewportHeight, maxScroll: Math.max(0, totalLines - viewportHeight) };
  }

  /**
   * The width `handleInput` must lay out at: the one the host actually supplied,
   * so scroll bounds match the layout on screen. Before the first paint there is
   * none, so fall back to the full terminal width.
   */
  private inputWidth(): number {
    return this.renderedWidth ?? this.tui.terminal.columns;
  }

  /**
   * Rows the transcript gets: what it needs, capped at the pane's share of the
   * terminal so a long or live transcript cannot crowd out the conversation, and
   * floored so a short one still reads as a pane.
   */
  private viewportHeight(totalLines: number): number {
    const cap = Math.floor((this.tui.terminal.rows * VIEWPORT_HEIGHT_PCT) / 100) - CHROME_LINES;
    return Math.max(MIN_VIEWPORT, Math.min(totalLines, cap));
  }
}

/** A key id in Pi's display style: `ctrl+b` → `Ctrl+B`, `pageUp` → `PageUp`. */
function displayKey(key: KeyId): string {
  return key
    .split("+")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("+");
}

/**
 * `anthropic/claude-sonnet-5 • high`, in Pi's footer wording: `thinking off` rather
 * than a bare `off`, and `thinking <level>` when no model is named to attach it to.
 */
function describeRuntime(model: ModelIdentity | undefined, thinkingLevel: string | undefined): string {
  if (!model) return thinkingLevel ? `thinking ${thinkingLevel}` : "";
  if (!thinkingLevel) return formatModel(model);
  const level = thinkingLevel === "off" ? "thinking off" : thinkingLevel;
  return `${formatModel(model)} • ${level}`;
}
