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
 * The pane is strictly read-only — steering stays in the `steer_subagent` tool
 * and the widget. It consumes a `TranscriptSource`, so a released agent's disk
 * snapshot (`fileSnapshotSource`) swaps in without touching the renderer or the pane.
 *
 * It mounts through `ui.custom`'s non-overlay path deliberately: Pi's regular-mode
 * renderer composites overlays into the buffer that backs scrollback, so an overlay
 * mount bakes this pane's chrome into terminal history. See
 * `docs/decisions/0007-transcript-viewer-is-not-an-overlay.md`.
 */

import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type MarkdownTheme,
  matchesKey,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { AgentConfigLookup } from "#src/config/agent-types";
import type { Theme } from "#src/ui/display";
import { fileSnapshotSource, listNavigableAgents, liveSource, type NavigableSubagent, type TranscriptSource } from "#src/ui/session-navigation";
import { TranscriptContent } from "#src/ui/transcript-content";

// ─────────────────────────────────────────────────────────────────────────────

/** Chrome lines: the header and the footer. The pane is docked, so it needs no frame. */
const CHROME_LINES = 2;
const MIN_VIEWPORT = 3;
const VIEWPORT_HEIGHT_PCT = 70;

/** Component factory shape Pi's `ui.custom` invokes to mount a component. */
export type CustomComponentFactory<R> = (
  tui: TUI,
  theme: Theme,
  keybindings: unknown,
  done: (result: R) => void,
) => Component;

/** Narrow UI interface — only the `ctx.ui` methods the navigator calls. */
export interface SessionNavigatorUI {
  select(title: string, options: string[]): Promise<string | undefined>;
  notify(message: string, level: "info" | "warning" | "error"): void;
  custom<R>(component: CustomComponentFactory<R>, options?: unknown): Promise<R>;
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
}

/** Options for the read-only transcript pane. */
export interface TranscriptPaneOptions {
  tui: TUI;
  theme: Theme;
  source: TranscriptSource;
  done: (result: undefined) => void;
  cwd: string;
  markdownTheme: MarkdownTheme;
}

/**
 * Handler for the `/subagents:sessions` slash command.
 *
 * Lists navigable subagents, lets the operator pick one, and opens its transcript
 * read-only. Receives the agent snapshot (`manager.listAgents()`) rather than the
 * manager, so it stays a reactive consumer with no inbound call into the core.
 */
export class SessionNavigatorHandler {
  async handle({ ui, agents, registry, cwd, readFile }: SessionNavigatorParams): Promise<void> {
    const entries = listNavigableAgents(agents, registry);
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
    await ui.custom<undefined>(
      (tui, theme, _keybindings, done) =>
        new TranscriptPane({ tui, theme, source, done, cwd, markdownTheme }),
      { overlay: false },
    );
  }
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
  private readonly theme: Theme;
  private readonly done: (result: undefined) => void;
  private readonly content: TranscriptContent;
  /** Width the host last rendered at; input must use the same layout. */
  private renderedWidth: number | undefined;

  constructor({ tui, theme, source, done, cwd, markdownTheme }: TranscriptPaneOptions) {
    this.tui = tui;
    this.theme = theme;
    this.done = done;
    this.content = new TranscriptContent({ tui, cwd, markdownTheme, source });
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

    const { viewportHeight, maxScroll } = this.scrollBounds(this.inputWidth());

    if (matchesKey(data, "up") || matchesKey(data, "k")) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.autoScroll = this.scrollOffset >= maxScroll;
    } else if (matchesKey(data, "down") || matchesKey(data, "j")) {
      this.scrollOffset = Math.min(maxScroll, this.scrollOffset + 1);
      this.autoScroll = this.scrollOffset >= maxScroll;
    } else if (matchesKey(data, "pageUp") || matchesKey(data, "shift+up")) {
      this.scrollOffset = Math.max(0, this.scrollOffset - viewportHeight);
      this.autoScroll = false;
    } else if (matchesKey(data, "pageDown") || matchesKey(data, "shift+down")) {
      this.scrollOffset = Math.min(maxScroll, this.scrollOffset + viewportHeight);
      this.autoScroll = this.scrollOffset >= maxScroll;
    } else if (matchesKey(data, "home")) {
      this.scrollOffset = 0;
      this.autoScroll = false;
    } else if (matchesKey(data, "end")) {
      this.scrollOffset = maxScroll;
      this.autoScroll = true;
    }
  }

  render(width: number): string[] {
    if (width < 6) return [];
    const th = this.theme;
    this.renderedWidth = width;
    const lines: string[] = [];

    // No frame, so no padding either: a row padded to the full terminal width
    // wraps onto the next terminal row.
    const fit = (content: string): string => truncateToWidth(content, width);

    lines.push(fit(th.bold("Subagent session")));

    const { totalLines, viewportHeight, maxScroll } = this.scrollBounds(width);
    if (this.autoScroll) this.scrollOffset = maxScroll;
    const visibleStart = Math.min(this.scrollOffset, maxScroll);
    const visible = this.content.slice(width, visibleStart, viewportHeight);
    for (let i = 0; i < viewportHeight; i++) lines.push(fit(visible[i] ?? ""));

    const scrollPct =
      totalLines <= viewportHeight
        ? "100%"
        : `${Math.round(((visibleStart + viewportHeight) / totalLines) * 100)}%`;
    const footerLeft = th.fg("dim", `${totalLines} lines · ${scrollPct}`);
    const footerRight = th.fg("dim", "↑↓ scroll · PgUp/PgDn · Esc close");
    const footerGap = Math.max(1, width - visibleWidth(footerLeft) - visibleWidth(footerRight));
    lines.push(fit(footerLeft + " ".repeat(footerGap) + footerRight));

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
   * Scroll geometry at a given layout width.
   *
   * The single place a width becomes a viewport height, so `render` and
   * `handleInput` cannot disagree about how far the transcript scrolls.
   */
  private scrollBounds(width: number): { totalLines: number; viewportHeight: number; maxScroll: number } {
    const totalLines = this.content.lineCount(width);
    const viewportHeight = this.viewportHeight();
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

  private viewportHeight(): number {
    const maxRows = Math.floor((this.tui.terminal.rows * VIEWPORT_HEIGHT_PCT) / 100);
    return Math.max(MIN_VIEWPORT, maxRows - CHROME_LINES);
  }
}
