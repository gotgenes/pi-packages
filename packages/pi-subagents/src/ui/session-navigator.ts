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
import type { SessionMessage } from "#src/types";
import { describeActivity, type Theme } from "#src/ui/display";
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
 * Caches a `Container` of Pi's per-entry components and rebuilds it only when the
 * source changes (live agents) — each paint reuses the cached tree, so markdown
 * highlighting does not re-run per frame. This class owns scroll state, chrome,
 * and the running-agent streaming indicator; the component mapping lives in
 * `buildTranscriptComponents`.
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

  constructor({ tui, theme, source, done, cwd, markdownTheme }: TranscriptOverlayOptions) {
    this.tui = tui;
    this.theme = theme;
    this.source = source;
    this.done = done;
    this.cwd = cwd;
    this.markdownTheme = markdownTheme;
    this.content = this.rebuild();
    this.unsubscribe = source.subscribe(() => {
      if (this.closed) return;
      this.content = this.rebuild();
      this.tui.requestRender();
    });
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.closed = true;
      this.done(undefined);
      return;
    }

    const hInnerW = this.contentWidth();
    const totalLines = this.buildContentLines(hInnerW).length;
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
    const innerW = this.contentWidth();
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

    const contentLines = this.buildContentLines(innerW);
    const viewportHeight = this.viewportHeight();
    const maxScroll = Math.max(0, contentLines.length - viewportHeight);
    if (this.autoScroll) this.scrollOffset = maxScroll;
    const visibleStart = Math.min(this.scrollOffset, maxScroll);
    const visible = contentLines.slice(visibleStart, visibleStart + viewportHeight);
    for (let i = 0; i < viewportHeight; i++) lines.push(row(visible[i] ?? ""));

    lines.push(hrMid);
    const scrollPct =
      contentLines.length <= viewportHeight
        ? "100%"
        : `${Math.round(((visibleStart + viewportHeight) / contentLines.length) * 100)}%`;
    const footerLeft = th.fg("dim", `${contentLines.length} lines · ${scrollPct}`);
    const footerRight = th.fg("dim", "↑↓ scroll · PgUp/PgDn · Esc close");
    const footerGap = Math.max(1, innerW - visibleWidth(footerLeft) - visibleWidth(footerRight));
    lines.push(row(footerLeft + " ".repeat(footerGap) + footerRight));
    lines.push(hrBot);

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

  // Content text width
  private contentWidth(): number {
    const overlayWidth = Math.floor((this.tui.terminal.columns * 90) / 100);
    return Math.max(0, overlayWidth - 4);
  }

  private viewportHeight(): number {
    const maxRows = Math.floor((this.tui.terminal.rows * VIEWPORT_HEIGHT_PCT) / 100);
    return Math.max(MIN_VIEWPORT, maxRows - CHROME_LINES);
  }

  private buildContentLines(innerW: number): string[] {
    if (innerW <= 0) return [];
    const lines = this.content.render(innerW);
    const streaming = this.source.streaming();
    if (streaming) {
      lines.push("", `◍ ${describeActivity(streaming.activeTools, streaming.responseText)}`);
    }
    return lines.map((l) => truncateToWidth(l, innerW));
  }

  private rebuild(): Container {
    return buildTranscriptComponents(this.source.getMessages(), {
      tui: this.tui,
      cwd: this.cwd,
      markdownTheme: this.markdownTheme,
      getToolDefinition: (name) => this.source.getToolDefinition(name),
    });
  }
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
