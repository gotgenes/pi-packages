/**
 * session-navigator.ts — The `/subagents:sessions` command: pick a subagent and
 * read its transcript through Pi's own per-entry session components.
 *
 * SDK/TUI consumer half of native session navigation. The unit-testable core
 * (selection, sourcing) lives in `session-navigation.ts`; this module wires that
 * core to the command picker and a read-only scrollable overlay, and owns the
 * renderer — it mounts Pi's interactive components (`AssistantMessageComponent`,
 * `ToolExecutionComponent`, …) into a `Container`, mirroring Pi's own
 * `renderSessionContext` mapping. Rendering lives here, not in the pure module,
 * because the components require a `TUI`, `cwd`, and markdown theme.
 *
 * The overlay is strictly read-only — steering stays in the `steer_subagent` tool
 * and the widget. It consumes a `TranscriptSource`, so a released agent's disk
 * snapshot (`fileSnapshotSource`) swaps in without touching the renderer or the overlay.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  AssistantMessageComponent,
  BashExecutionComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  getMarkdownTheme,
  parseSkillBlock,
  SkillInvocationMessageComponent,
  type ToolDefinition,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  type MarkdownTheme,
  matchesKey,
  Spacer,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { AgentConfigLookup } from "#src/config/agent-types";
import type { AgentSessionEvent, SessionMessage } from "#src/types";
import { describeActivity, type Theme } from "#src/ui/display";
import { GLYPHS } from "#src/ui/glyphs";
import { fileSnapshotSource, listNavigableAgents, liveSource, type NavigableSubagent, type TranscriptSource } from "#src/ui/session-navigation";

// ─────────────────────────────────────────────────────────────────────────────

/** Chrome lines: top border + header + header sep + footer sep + footer + bottom border. */
const CHROME_LINES = 6;
const MIN_VIEWPORT = 3;
const VIEWPORT_HEIGHT_PCT = 70;

/** Component factory shape Pi's `ui.custom` invokes to mount an overlay. */
export type OverlayComponentFactory<R> = (
  tui: TUI,
  theme: Theme,
  keybindings: unknown,
  done: (result: R) => void,
) => Component;

/** Narrow UI interface — only the `ctx.ui` methods the navigator calls. */
export interface SessionNavigatorUI {
  select(title: string, options: string[]): Promise<string | undefined>;
  notify(message: string, level: "info" | "warning" | "error"): void;
  custom<R>(component: OverlayComponentFactory<R>, options?: unknown): Promise<R>;
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

/** Options for the read-only transcript overlay. */
export interface TranscriptOverlayOptions {
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
        new TranscriptOverlay({ tui, theme, source, done, cwd, markdownTheme }),
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: "90%", maxHeight: `${VIEWPORT_HEIGHT_PCT}%` },
      },
    );
  }
}

/**
 * Read-only scrollable transcript overlay.
 *
 * Caches the settled transcript's rendered lines per overlay width and rebuilds
 * Pi's rich per-entry component tree only when messages settle. Streaming deltas
 * use a lightweight activity row, so paint/scroll stay O(viewport) instead of
 * O(total transcript). This class owns scroll state, chrome, and live activity;
 * component mapping lives in `buildTranscriptComponents`.
 */
export class TranscriptOverlay implements Component {
  private scrollOffset = 0;
  private autoScroll = true;
  private unsubscribe: (() => void) | undefined;
  private closed = false;

  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly source: TranscriptSource;
  private readonly done: (result: undefined) => void;
  private readonly cwd: string;
  private readonly markdownTheme: MarkdownTheme;
  private content: Container;
  /** Last inner width supplied by the overlay compositor; input must use this layout. */
  private renderedInnerWidth: number | undefined;
  /**
   * Width-keyed rendering of the settled transcript. Rendering Pi's rich
   * per-entry components is O(total transcript); keeping those lines stable
   * makes paint and scroll O(viewport) instead of O(10k+ lines).
   */
  private settledLinesCache: { width: number; lines: readonly string[] } | undefined;
  /** Current assistant message, rendered separately so deltas never touch settled history. */
  private liveAssistant: AssistantMessageComponent | undefined;
  private liveAssistantLinesCache: { width: number; lines: readonly string[] } | undefined;

  constructor({ tui, theme, source, done, cwd, markdownTheme }: TranscriptOverlayOptions) {
    this.tui = tui;
    this.theme = theme;
    this.source = source;
    this.done = done;
    this.cwd = cwd;
    this.markdownTheme = markdownTheme;
    this.content = this.rebuild();
    this.unsubscribe = source.subscribe((event) => this.handleSourceChange(event));
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.closed = true;
      this.done(undefined);
      return;
    }

    const totalLines = this.contentLineCount(this.renderedInnerWidth ?? this.innerWidth());
    const viewportHeight = this.viewportHeight();
    const maxScroll = Math.max(0, totalLines - viewportHeight);

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
    const innerW = width - 4;
    this.renderedInnerWidth = innerW;
    const lines: string[] = [];

    const pad = (s: string, len: number): string => s + " ".repeat(Math.max(0, len - visibleWidth(s)));
    const row = (content: string): string =>
      th.fg("border", "│") + " " + truncateToWidth(pad(content, innerW), innerW) + " " + th.fg("border", "│");
    const hrTop = th.fg("border", `╭${"─".repeat(width - 2)}╮`);
    const hrBot = th.fg("border", `╰${"─".repeat(width - 2)}╯`);
    const hrMid = row(th.fg("dim", "─".repeat(innerW)));

    lines.push(hrTop);
    lines.push(row(th.bold("Subagent session")));
    lines.push(hrMid);

    const totalLines = this.contentLineCount(innerW);
    const viewportHeight = this.viewportHeight();
    const maxScroll = Math.max(0, totalLines - viewportHeight);
    if (this.autoScroll) this.scrollOffset = maxScroll;
    const visibleStart = Math.min(this.scrollOffset, maxScroll);
    const visible = this.visibleContentLines(innerW, visibleStart, viewportHeight);
    for (let i = 0; i < viewportHeight; i++) lines.push(row(visible[i] ?? ""));

    lines.push(hrMid);
    const scrollPct =
      totalLines <= viewportHeight
        ? "100%"
        : `${Math.round(((visibleStart + viewportHeight) / totalLines) * 100)}%`;
    const footerLeft = th.fg("dim", `${totalLines} lines · ${scrollPct}`);
    const footerRight = th.fg("dim", "↑↓ scroll · PgUp/PgDn · Esc close");
    const footerGap = Math.max(1, innerW - visibleWidth(footerLeft) - visibleWidth(footerRight));
    lines.push(row(footerLeft + " ".repeat(footerGap) + footerRight));
    lines.push(hrBot);

    return lines;
  }

  // fallow-ignore-next-line unused-class-member
  invalidate(): void {
    this.content.invalidate();
    this.liveAssistant?.invalidate();
    this.settledLinesCache = undefined;
    this.liveAssistantLinesCache = undefined;
  }

  dispose(): void {
    this.closed = true;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  // ---- Private ----

  private innerWidth(): number {
    return Math.max(0, this.tui.terminal.columns - 4);
  }

  private viewportHeight(): number {
    const maxRows = Math.floor((this.tui.terminal.rows * VIEWPORT_HEIGHT_PCT) / 100);
    return Math.max(MIN_VIEWPORT, maxRows - CHROME_LINES);
  }

  /** Settled transcript lines, rendered once per width/content version. */
  private settledLines(innerW: number): readonly string[] {
    if (innerW <= 0) return [];
    if (this.settledLinesCache?.width === innerW) return this.settledLinesCache.lines;
    const lines = this.content.render(innerW).map((line) => truncateToWidth(line, innerW));
    this.settledLinesCache = { width: innerW, lines };
    return lines;
  }

  /** Current rich assistant message, re-rendered independently of settled history. */
  private liveAssistantLines(innerW: number): readonly string[] {
    if (!this.liveAssistant) return [];
    if (this.liveAssistantLinesCache?.width === innerW) return this.liveAssistantLinesCache.lines;
    const lines = this.liveAssistant.render(innerW).map((line) => truncateToWidth(line, innerW));
    this.liveAssistantLinesCache = { width: innerW, lines };
    return lines;
  }

  /** Rich live tail plus lightweight activity rows; settled history stays untouched. */
  private streamingLines(innerW: number): readonly string[] {
    const lines = [...this.liveAssistantLines(innerW)];
    const streaming = this.source.streaming();
    if (!streaming) return lines;
    lines.push(
      "",
      truncateToWidth(
        `${GLYPHS.streaming} ${describeActivity(streaming.activeTools, streaming.responseText)}`,
        innerW,
      ),
    );
    return lines;
  }

  private contentLineCount(innerW: number): number {
    return this.settledLines(innerW).length + this.streamingLines(innerW).length;
  }

  /**
   * Slice directly across settled + streaming rows. This avoids copying or
   * mapping the full transcript on every keypress/paint.
   */
  private visibleContentLines(innerW: number, start: number, count: number): string[] {
    const settled = this.settledLines(innerW);
    const streaming = this.streamingLines(innerW);
    const end = start + count;
    const visible = settled.slice(start, Math.min(end, settled.length));
    if (end > settled.length) {
      const streamingStart = Math.max(0, start - settled.length);
      const streamingEnd = Math.max(0, end - settled.length);
      visible.push(...streaming.slice(streamingStart, streamingEnd));
    }
    return visible;
  }

  private handleSourceChange(event?: AgentSessionEvent): void {
    if (this.closed) return;
    if (
      event &&
      (event.type === "message_start" || event.type === "message_update") &&
      event.message.role === "assistant"
    ) {
      this.updateLiveAssistant(event.message);
    } else if (eventSettlesTranscript(event)) {
      this.rebuildSettledContent();
    }
    this.tui.requestRender();
  }

  /**
   * On the first partial event, split a trailing in-progress assistant message
   * out of settled history. Later deltas update only this one component.
   */
  private updateLiveAssistant(message: AssistantMessage): void {
    if (!this.liveAssistant) {
      const messages = this.source.getMessages();
      const last = messages.at(-1);
      const lastIsLiveAssistant =
        last?.role === "assistant" &&
        (last === message || last.timestamp === message.timestamp);
      this.content = this.buildComponents(
        lastIsLiveAssistant ? messages.slice(0, -1) : messages,
      );
      this.settledLinesCache = undefined;
      this.liveAssistant = new AssistantMessageComponent(
        message,
        false,
        this.markdownTheme,
      );
    } else {
      this.liveAssistant.updateContent(message);
    }
    this.liveAssistantLinesCache = undefined;
  }

  private rebuildSettledContent(): void {
    this.content = this.rebuild();
    this.liveAssistant = undefined;
    this.settledLinesCache = undefined;
    this.liveAssistantLinesCache = undefined;
  }

  private rebuild(): Container {
    return this.buildComponents(this.source.getMessages());
  }

  private buildComponents(messages: readonly SessionMessage[]): Container {
    return buildTranscriptComponents(messages, {
      tui: this.tui,
      cwd: this.cwd,
      markdownTheme: this.markdownTheme,
      getToolDefinition: (name) => this.source.getToolDefinition(name),
    });
  }
}

/**
 * High-frequency partial events are represented by the lightweight streaming
 * row. Rebuild the rich transcript only when a message is settled, the agent
 * finishes, or compaction replaces the message history. An undefined event is
 * treated conservatively for synthetic/static sources used by extensions.
 */
function eventSettlesTranscript(event?: AgentSessionEvent): boolean {
  if (!event) return true;
  return event.type === "message_end" || event.type === "agent_end" || event.type === "compaction_end";
}

/** Dependencies the per-entry component tree needs from the SDK/TUI environment. */
interface TranscriptRenderOptions {
  tui: TUI;
  cwd: string;
  markdownTheme: MarkdownTheme;
  getToolDefinition: (name: string) => ToolDefinition | undefined;
}

/**
 * Build a `Container` of Pi's per-entry components from a message snapshot,
 * mirroring Pi's own interactive-mode `renderSessionContext` mapping. Tool
 * results are matched to their tool-call components by id, exactly as Pi does.
 * `custom`-role messages are skipped — rendering them needs the child session's
 * message-renderer registry, which the navigator does not hold.
 */
function buildTranscriptComponents(
  messages: readonly SessionMessage[],
  opts: TranscriptRenderOptions,
): Container {
  const container = new Container();
  const pendingTools = new Map<string, ToolExecutionComponent>();
  for (const message of messages) {
    addMessageComponents(container, message, pendingTools, opts);
  }
  return container;
}

function addMessageComponents(
  container: Container,
  message: SessionMessage,
  pendingTools: Map<string, ToolExecutionComponent>,
  opts: TranscriptRenderOptions,
): void {
  switch (message.role) {
    case "assistant": {
      container.addChild(new AssistantMessageComponent(message, false, opts.markdownTheme));
      for (const content of message.content) {
        if (content.type !== "toolCall") continue;
        const tool = new ToolExecutionComponent(
          content.name,
          content.id,
          content.arguments,
          { showImages: false },
          opts.getToolDefinition(content.name),
          opts.tui,
          opts.cwd,
        );
        tool.setExpanded(true);
        container.addChild(tool);
        pendingTools.set(content.id, tool);
      }
      break;
    }
    case "toolResult": {
      pendingTools.get(message.toolCallId)?.updateResult(message);
      pendingTools.delete(message.toolCallId);
      break;
    }
    case "user": {
      addUserComponents(container, message.content, opts.markdownTheme);
      break;
    }
    case "bashExecution": {
      const bash = new BashExecutionComponent(message.command, opts.tui, message.excludeFromContext);
      if (message.output) bash.appendOutput(message.output);
      bash.setComplete(message.exitCode, message.cancelled, undefined, message.fullOutputPath);
      container.addChild(bash);
      break;
    }
    case "compactionSummary": {
      container.addChild(new Spacer(1));
      const summary = new CompactionSummaryMessageComponent(message, opts.markdownTheme);
      summary.setExpanded(true);
      container.addChild(summary);
      break;
    }
    case "branchSummary": {
      container.addChild(new Spacer(1));
      const summary = new BranchSummaryMessageComponent(message, opts.markdownTheme);
      summary.setExpanded(true);
      container.addChild(summary);
      break;
    }
  }
}

/** Render a user message (skill block + text) into the container, mirroring Pi. */
function addUserComponents(
  container: Container,
  content: string | readonly { type: string; text?: string }[],
  markdownTheme: MarkdownTheme,
): void {
  const text = userMessageText(content);
  if (!text) return;
  if (container.children.length > 0) container.addChild(new Spacer(1));

  const skillBlock = parseSkillBlock(text);
  if (!skillBlock) {
    container.addChild(new UserMessageComponent(text, markdownTheme));
    return;
  }
  const skill = new SkillInvocationMessageComponent(skillBlock, markdownTheme);
  skill.setExpanded(true);
  container.addChild(skill);
  if (skillBlock.userMessage) {
    container.addChild(new Spacer(1));
    container.addChild(new UserMessageComponent(skillBlock.userMessage, markdownTheme));
  }
}

/** Concatenate the text blocks of a user message's content (mirrors Pi). */
function userMessageText(content: string | readonly { type: string; text?: string }[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}
