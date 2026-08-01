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
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  type KeyId,
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
 * The settled transcript is held as per-message blocks of Pi's rich components
 * (`consumeMessage`), each caching its rendered lines per overlay width. New
 * messages append blocks, tool results mutate only their own block, and paint
 * or scroll slices a flat line cache — O(changed message) and O(viewport),
 * never O(total transcript). This class owns scroll state, chrome, and live
 * activity.
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
  /** Last inner width supplied by the overlay compositor; input must use this layout. */
  private renderedInnerWidth: number | undefined;
  /** Settled transcript as per-message component blocks, appended in message order. */
  private settledBlocks: SettledBlock[] = [];
  /** How many source messages have been consumed into `settledBlocks`. */
  private settledCount = 0;
  /** Identity guard: the last consumed message; a mismatch means history was rewritten. */
  private lastConsumed: SessionMessage | undefined;
  /** Whether any consumed block holds visible components (drives user-message spacing). */
  private hasVisibleContent = false;
  /** Width the block line caches were rendered at. */
  private settledWidth: number | undefined;
  /** Concatenation of every block's cached lines at `settledWidth`. */
  private settledFlat: readonly string[] | undefined;
  /** In-flight tool components by toolCallId, pairing later results to their block. */
  private readonly pendingTools = new Map<
    string,
    { component: ToolExecutionComponent; block: SettledBlock }
  >();
  /** Current assistant message, rendered separately so deltas never touch settled history. */
  private liveAssistant: AssistantMessageComponent | undefined;
  private liveMessage: AssistantMessage | undefined;
  private liveAssistantLinesCache: { width: number; lines: readonly string[] } | undefined;

  constructor({ tui, theme, source, done, cwd, markdownTheme }: TranscriptOverlayOptions) {
    this.tui = tui;
    this.theme = theme;
    this.source = source;
    this.done = done;
    this.cwd = cwd;
    this.markdownTheme = markdownTheme;
    this.consumeNewSettled();
    this.unsubscribe = source.subscribe((event) => this.handleSourceChange(event));
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.closed = true;
      this.done(undefined);
      return;
    }

    const totalLines = this.contentLineCount(this.renderedInnerWidth ?? this.innerWidth());
    const viewport = this.viewportHeight();
    const maxScroll = Math.max(0, totalLines - viewport);

    const binding = SCROLL_BINDINGS.find(({ keys }) => keys.some((key) => matchesKey(data, key)));
    if (!binding) return;
    const next = binding.next({ offset: this.scrollOffset, maxScroll, viewport });
    this.scrollOffset = next.offset;
    this.autoScroll = next.autoScroll;
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
    for (const block of this.settledBlocks) {
      block.container.invalidate();
      block.lines = undefined;
    }
    this.settledFlat = undefined;
    this.liveAssistant?.invalidate();
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

  /** Settled transcript lines; each block renders once per width/content version. */
  private settledLines(innerW: number): readonly string[] {
    if (innerW <= 0) return [];
    if (this.settledWidth !== innerW) {
      this.settledWidth = innerW;
      for (const block of this.settledBlocks) block.lines = undefined;
      this.settledFlat = undefined;
    }
    if (this.settledFlat) return this.settledFlat;
    const flat: string[] = [];
    for (const block of this.settledBlocks) {
      block.lines ??= block.container.render(innerW).map((line) => truncateToWidth(line, innerW));
      for (const line of block.lines) flat.push(line);
    }
    this.settledFlat = flat;
    return flat;
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
    this.applySourceEvent(event);
    this.tui.requestRender();
  }

  /** Route one session event to the narrowest settled/live update. */
  private applySourceEvent(event?: AgentSessionEvent): void {
    if (!event || event.type === "agent_end" || event.type === "compaction_end") {
      // Catch-alls: run/compaction boundaries may rewrite or mutate history
      // in place, and event-less sources give no narrower signal.
      this.resetSettledContent();
      return;
    }
    if (event.type === "message_start" || event.type === "message_update") {
      this.applyPartialMessage(event.message);
      return;
    }
    // Any other session event is a cheap catch-up: consume messages that
    // settled since the last check, or no-op when nothing is new.
    if (event.type === "message_end" && this.isLiveMessage(event.message)) {
      this.clearLiveAssistant();
    }
    this.consumeNewSettled();
  }

  /** A partial for the in-flight assistant updates the live component; other roles settle. */
  private applyPartialMessage(message: SessionMessage): void {
    if (message.role === "assistant") this.updateLiveAssistant(message);
    else this.consumeNewSettled();
  }

  /**
   * On the first partial event, mount the in-progress assistant message as its
   * own rich component. Later deltas update only this one component; the
   * settled prefix is caught up once, not per token.
   */
  private updateLiveAssistant(message: AssistantMessage): void {
    if (!this.liveAssistant) {
      this.consumeNewSettled();
      this.liveAssistant = new AssistantMessageComponent(message, false, this.markdownTheme);
    } else {
      this.liveAssistant.updateContent(message);
    }
    this.liveMessage = message;
    this.liveAssistantLinesCache = undefined;
  }

  private isLiveMessage(message: SessionMessage): boolean {
    if (!this.liveMessage || message.role !== "assistant") return false;
    return message === this.liveMessage || message.timestamp === this.liveMessage.timestamp;
  }

  private clearLiveAssistant(): void {
    this.liveAssistant = undefined;
    this.liveMessage = undefined;
    this.liveAssistantLinesCache = undefined;
  }

  /** Drop all settled state and re-consume the source from scratch. */
  private resetSettledContent(): void {
    this.settledBlocks = [];
    this.settledCount = 0;
    this.lastConsumed = undefined;
    this.hasVisibleContent = false;
    this.settledFlat = undefined;
    this.pendingTools.clear();
    this.clearLiveAssistant();
    this.consumeNewSettled();
  }

  /**
   * Append blocks for messages settled since the last check. The agent runtime
   * pushes a message into its state before emitting `message_end`, so at event
   * time the settled prefix is already visible through `getMessages()`.
   */
  private consumeNewSettled(): void {
    const messages = this.source.getMessages();
    if (
      this.settledCount > messages.length ||
      (this.settledCount > 0 && messages[this.settledCount - 1] !== this.lastConsumed)
    ) {
      // The consumed prefix no longer mirrors the source: history was
      // rewritten wholesale (e.g. compaction/branching). Start over.
      this.resetSettledContent();
      return;
    }
    let end = messages.length;
    if (end > this.settledCount && this.isLiveMessage(messages[end - 1])) end -= 1;
    if (end === this.settledCount) return;
    for (let i = this.settledCount; i < end; i++) this.consumeMessage(messages[i]);
    this.settledCount = end;
    this.lastConsumed = messages[end - 1];
    this.settledFlat = undefined;
  }

  /**
   * Map one settled message onto Pi's per-entry components, mirroring Pi's own
   * interactive-mode `renderSessionContext` mapping. Tool results are matched
   * to their tool-call components by id, exactly as Pi does. `custom`-role
   * messages are skipped — rendering them needs the child session's
   * message-renderer registry, which the navigator does not hold.
   */
  private consumeMessage(message: SessionMessage): void {
    switch (message.role) {
      case "assistant":
        this.consumeAssistantMessage(message);
        break;
      case "toolResult":
        this.consumeToolResult(message);
        break;
      case "user":
        this.consumeUserMessage(message);
        break;
      case "bashExecution":
        this.consumeBashExecution(message);
        break;
      case "compactionSummary":
        this.consumeSummary(new CompactionSummaryMessageComponent(message, this.markdownTheme));
        break;
      case "branchSummary":
        this.consumeSummary(new BranchSummaryMessageComponent(message, this.markdownTheme));
        break;
    }
  }

  private consumeAssistantMessage(message: AssistantMessage): void {
    const block = this.newBlock();
    block.container.addChild(new AssistantMessageComponent(message, false, this.markdownTheme));
    for (const content of message.content) {
      if (content.type !== "toolCall") continue;
      const tool = new ToolExecutionComponent(
        content.name,
        content.id,
        content.arguments,
        { showImages: false },
        this.source.getToolDefinition(content.name),
        this.tui,
        this.cwd,
      );
      tool.setExpanded(true);
      block.container.addChild(tool);
      this.pendingTools.set(content.id, { component: tool, block });
    }
    this.hasVisibleContent = true;
  }

  private consumeToolResult(message: Extract<SessionMessage, { role: "toolResult" }>): void {
    const entry = this.pendingTools.get(message.toolCallId);
    if (!entry) return;
    entry.component.updateResult(message);
    entry.block.lines = undefined;
    this.settledFlat = undefined;
    this.pendingTools.delete(message.toolCallId);
  }

  private consumeUserMessage(message: Extract<SessionMessage, { role: "user" }>): void {
    const block = this.newBlock();
    addUserComponents(block.container, message.content, this.markdownTheme, this.hasVisibleContent);
    if (block.container.children.length > 0) this.hasVisibleContent = true;
  }

  private consumeBashExecution(message: Extract<SessionMessage, { role: "bashExecution" }>): void {
    const block = this.newBlock();
    const bash = new BashExecutionComponent(message.command, this.tui, message.excludeFromContext);
    if (message.output) bash.appendOutput(message.output);
    bash.setComplete(message.exitCode, message.cancelled, undefined, message.fullOutputPath);
    block.container.addChild(bash);
    this.hasVisibleContent = true;
  }

  /** Compaction and branch summaries share the same spacer + expanded-block shape. */
  private consumeSummary(
    summary: CompactionSummaryMessageComponent | BranchSummaryMessageComponent,
  ): void {
    const block = this.newBlock();
    block.container.addChild(new Spacer(1));
    summary.setExpanded(true);
    block.container.addChild(summary);
    this.hasVisibleContent = true;
  }

  private newBlock(): SettledBlock {
    const block: SettledBlock = { container: new Container(), lines: undefined };
    this.settledBlocks.push(block);
    return block;
  }
}

/** One consumed message's rich components plus its width-cached rendered lines. */
interface SettledBlock {
  container: Container;
  lines: readonly string[] | undefined;
}

/** Inputs a scroll binding needs to produce the next scroll state. */
interface ScrollContext {
  offset: number;
  maxScroll: number;
  viewport: number;
}

interface ScrollState {
  offset: number;
  autoScroll: boolean;
}

/** Clamped offset with auto-scroll re-armed whenever it reaches the bottom. */
function scrolledTo(offset: number, maxScroll: number): ScrollState {
  return { offset, autoScroll: offset >= maxScroll };
}

/** Keyboard bindings for the transcript viewport, applied over the rendered layout. */
const SCROLL_BINDINGS: ReadonlyArray<{
  keys: readonly KeyId[];
  next: (context: ScrollContext) => ScrollState;
}> = [
  {
    keys: ["up", "k"],
    next: ({ offset, maxScroll }) => scrolledTo(Math.max(0, offset - 1), maxScroll),
  },
  {
    keys: ["down", "j"],
    next: ({ offset, maxScroll }) => scrolledTo(Math.min(maxScroll, offset + 1), maxScroll),
  },
  {
    keys: ["pageUp", "shift+up"],
    next: ({ offset, viewport }) => ({ offset: Math.max(0, offset - viewport), autoScroll: false }),
  },
  {
    keys: ["pageDown", "shift+down"],
    next: ({ offset, maxScroll, viewport }) => scrolledTo(Math.min(maxScroll, offset + viewport), maxScroll),
  },
  { keys: ["home"], next: () => ({ offset: 0, autoScroll: false }) },
  { keys: ["end"], next: ({ maxScroll }) => ({ offset: maxScroll, autoScroll: true }) },
];

/** Render a user message (skill block + text) into the container, mirroring Pi. */
function addUserComponents(
  container: Container,
  content: string | readonly { type: string; text?: string }[],
  markdownTheme: MarkdownTheme,
  hasPrecedingContent: boolean,
): void {
  const text = userMessageText(content);
  if (!text) return;
  if (hasPrecedingContent) container.addChild(new Spacer(1));

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
