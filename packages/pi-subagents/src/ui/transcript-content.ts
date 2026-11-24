/**
 * transcript-content.ts — the rows the `/subagents:sessions` overlay paints.
 *
 * Owns the transcript's content model: the `SessionMessage` → Pi-component
 * mapping (mirroring Pi's own interactive-mode `renderSessionContext`), and the
 * rendered rows those components produce at a given width. The overlay
 * (`session-navigator.ts`) owns scroll state, chrome, and key handling; it asks
 * this collaborator for rows, tells it to toggle expansion, and hands it mouse
 * events by transcript row — it never reaches into the components.
 *
 * Collapsible blocks (tool calls, summaries, skill blocks, bash runs) follow one
 * expansion state, as in Pi's own conversation; a click toggles the block under
 * it through that block's own component.
 *
 * Lives in the SDK/TUI layer rather than the pure `session-navigation.ts` core
 * because Pi's per-entry components require a `TUI`, `cwd`, and markdown theme.
 */

import {
  AssistantMessageComponent,
  BashExecutionComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  parseSkillBlock,
  SkillInvocationMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  type MarkdownTheme,
  Spacer,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import type { AgentSessionEvent, SessionMessage } from "#src/types";
import { withBuiltInRenderers } from "#src/ui/builtin-tool-renderers";
import { describeActivity } from "#src/ui/display";
import { GLYPHS } from "#src/ui/glyphs";
import type { TranscriptSource } from "#src/ui/session-navigation";

// ─────────────────────────────────────────────────────────────────────────────

/** The SDK/TUI environment Pi's per-entry components need, plus the transcript's source. */
export interface TranscriptContentOptions {
  tui: TUI;
  cwd: string;
  markdownTheme: MarkdownTheme;
  source: TranscriptSource;
  /** Whether collapsible blocks (tool calls, summaries, skills, bash runs) mount expanded. */
  toolsExpanded: boolean;
}

/**
 * The transcript's renderable rows: settled history rendered through Pi's
 * per-entry components, followed by the running agent's activity row.
 *
 * Settled rows are rendered once per width and cached, so a paint or a scroll
 * costs a slice rather than a walk of the whole component tree. The activity
 * row is recomputed per call — it is two rows, and it tracks live state the
 * source updates without a rebuild.
 *
 * Settled history is held as one block of components per message, so a message
 * that settles appends a block and a tool result touches only its own — neither
 * discards the rest of the transcript's rendering. This is sound because the
 * agent core pushes a finished message into its message array before notifying
 * listeners, so at event time the settled prefix is already visible.
 *
 * The message currently being streamed is held as its own component, updated
 * per delta exactly as Pi's interactive mode does, so a token never touches
 * settled history. The two provably cannot overlap: the agent core keeps the
 * in-flight message outside its message array until it settles.
 */
export class TranscriptContent {
  private readonly options: TranscriptContentOptions;
  /** Settled history, one block per message that produced components. */
  private blocks: SettledBlock[] = [];
  /** How many source messages have been consumed into `blocks`. */
  private consumedCount = 0;
  /** The last consumed message; a mismatch means history was rewritten. */
  private lastConsumed: SessionMessage | undefined;
  /** Whether any consumed block holds components, driving user-message spacing. */
  private hasVisibleContent = false;
  /** In-flight tool components by tool-call id, pairing a later result to its block. */
  private readonly pendingTools = new Map<string, PendingTool>();
  /** Width `blocks` and `settledRows` were rendered at. */
  private settledWidth: number | undefined;
  /** Concatenation of every block's rows, or undefined when the cache is cold. */
  private settledRows: readonly string[] | undefined;
  /** The message being streamed right now, rendered below settled history. */
  private inFlight: AssistantMessageComponent | undefined;
  /** Width `inFlightRows` was rendered at. */
  private inFlightWidth: number | undefined;
  private inFlightRows: readonly string[] | undefined;
  /** Whether collapsible blocks show their full content; a rebuild keeps it. */
  private expanded: boolean;

  constructor(options: TranscriptContentOptions) {
    this.options = options;
    this.expanded = options.toolsExpanded;
    this.consumeSettled();
  }

  /** Total content rows at `width`: settled history plus the live tail. */
  lineCount(width: number): number {
    if (width <= 0) return 0;
    return this.settled(width).length + this.tail(width).length;
  }

  /** Rows `[start, start + count)` at `width`, clamped to what exists. */
  slice(width: number, start: number, count: number): string[] {
    if (width <= 0) return [];
    const settled = this.settled(width);
    const end = start + count;
    const rows = settled.slice(start, Math.min(end, settled.length));
    if (end > settled.length) {
      const tail = this.tail(width);
      rows.push(...tail.slice(Math.max(0, start - settled.length), end - settled.length));
    }
    return rows;
  }

  /**
   * Route one session event to the narrowest update it allows. A delta on the
   * in-flight message touches only that component. A run or compaction boundary
   * may have rewritten or mutated history in place, so it rebuilds wholesale.
   * Everything else consumes whatever settled since the last check.
   */
  apply(event?: AgentSessionEvent): void {
    const partial = inFlightAssistantMessage(event);
    if (partial) {
      this.updateInFlight(partial);
      return;
    }
    if (event?.type === "agent_end" || event?.type === "compaction_end") {
      this.reset();
    } else if (event?.type === "message_end") {
      this.clearInFlight();
    }
    this.consumeSettled();
  }

  /** Expand every collapsible block, or collapse them all; later blocks mount the same way. */
  toggleExpanded(): void {
    this.expanded = !this.expanded;
    applyExpansion(this.blocks, this.expanded);
    for (const block of this.blocks) block.rows = undefined;
    this.settledRows = undefined;
  }

  /**
   * Route a mouse event to the settled block under it, where Pi's own
   * components decide what a click means (a tool call, summary, or skill block
   * toggles itself). `event.y` is a transcript row and `event.width` the layout
   * width. Only the block that handled the event re-renders; the live tail and
   * any event no component handles are left to the host.
   */
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const hit = this.blockAt(event.width, event.y);
    if (!hit) return undefined;
    const result = hit.block.container.handleMouse({ ...event, y: event.y - hit.top, height: hit.height });
    if (!result) return undefined;
    hit.block.rows = undefined;
    this.settledRows = undefined;
    return { handled: true };
  }

  /** Drop cached rendering held by the mounted components and by this object. */
  invalidate(): void {
    for (const block of this.blocks) {
      block.container.invalidate();
      block.rows = undefined;
    }
    this.settledRows = undefined;
    this.inFlight?.invalidate();
    this.inFlightRows = undefined;
  }

  // ---- Private ----

  /** Settled rows at `width`; each block renders once per width and content change. */
  private settled(width: number): readonly string[] {
    if (this.settledWidth !== width) {
      this.settledWidth = width;
      for (const block of this.blocks) block.rows = undefined;
      this.settledRows = undefined;
    }
    if (this.settledRows) return this.settledRows;
    const rows: string[] = [];
    for (const block of this.blocks) {
      block.rows ??= block.container.render(width).map((row) => truncateToWidth(row, width));
      rows.push(...block.rows);
    }
    this.settledRows = rows;
    return rows;
  }

  /** The settled block covering transcript row `row` at `width`, with its first row and height. */
  private blockAt(width: number, row: number): { block: SettledBlock; top: number; height: number } | undefined {
    this.settled(width);
    let top = 0;
    for (const block of this.blocks) {
      const height = block.rows?.length ?? 0;
      if (row >= top && row < top + height) return { block, top, height };
      top += height;
    }
    return undefined;
  }

  /** Rows below settled history: the in-flight message, then the activity row. */
  private tail(width: number): readonly string[] {
    const rows = [...this.inFlightRendered(width)];
    const streaming = this.options.source.streaming();
    if (streaming) {
      const activity = `${GLYPHS.streaming} ${describeActivity(streaming.activeTools, streaming.responseText)}`;
      rows.push("", truncateToWidth(activity, width));
    }
    return rows;
  }

  /** The in-flight message's rows, re-rendered independently of settled history. */
  private inFlightRendered(width: number): readonly string[] {
    if (!this.inFlight) return [];
    if (this.inFlightWidth !== width) {
      this.inFlightWidth = width;
      this.inFlightRows = undefined;
    }
    this.inFlightRows ??= this.inFlight.render(width).map((row) => truncateToWidth(row, width));
    return this.inFlightRows;
  }

  private updateInFlight(message: AssistantSessionMessage): void {
    if (this.inFlight) this.inFlight.updateContent(message);
    else this.inFlight = new AssistantMessageComponent(message, false, this.options.markdownTheme);
    this.inFlightRows = undefined;
  }

  private clearInFlight(): void {
    this.inFlight = undefined;
    this.inFlightRows = undefined;
  }

  /** Discard all settled state, so the next consume rebuilds from scratch. */
  private reset(): void {
    this.blocks = [];
    this.consumedCount = 0;
    this.lastConsumed = undefined;
    this.hasVisibleContent = false;
    this.pendingTools.clear();
    this.settledRows = undefined;
    this.clearInFlight();
  }

  /**
   * Append blocks for every message that settled since the last check. When the
   * consumed prefix no longer mirrors the source — history replaced wholesale by
   * compaction or branching — start over rather than appending onto stale blocks.
   */
  private consumeSettled(): void {
    const messages = this.options.source.getMessages();
    if (this.hasRewrittenHistory(messages)) this.reset();
    if (messages.length === this.consumedCount) return;
    const firstNewBlock = this.blocks.length;
    for (let i = this.consumedCount; i < messages.length; i++) this.consumeMessage(messages[i]);
    applyExpansion(this.blocks.slice(firstNewBlock), this.expanded);
    this.consumedCount = messages.length;
    this.lastConsumed = messages.at(-1);
    this.settledRows = undefined;
  }

  private hasRewrittenHistory(messages: readonly SessionMessage[]): boolean {
    if (messages.length < this.consumedCount) return true;
    return this.consumedCount > 0 && messages[this.consumedCount - 1] !== this.lastConsumed;
  }

  /**
   * Map one settled message onto its own block of Pi's per-entry components,
   * mirroring Pi's own interactive-mode `renderSessionContext` mapping.
   * `custom`-role messages produce no block — rendering them needs the child
   * session's message-renderer registry, which the navigator does not hold.
   */
  private consumeMessage(message: SessionMessage): void {
    switch (message.role) {
      case "assistant":
        this.consumeAssistant(message);
        break;
      case "toolResult":
        this.consumeToolResult(message);
        break;
      case "user":
        this.consumeUser(message);
        break;
      case "bashExecution":
        this.consumeBashExecution(message);
        break;
      case "compactionSummary":
        this.consumeSummary(new CompactionSummaryMessageComponent(message, this.options.markdownTheme));
        break;
      case "branchSummary":
        this.consumeSummary(new BranchSummaryMessageComponent(message, this.options.markdownTheme));
        break;
    }
  }

  private consumeAssistant(message: AssistantSessionMessage): void {
    const block = this.appendBlock();
    block.container.addChild(new AssistantMessageComponent(message, false, this.options.markdownTheme));
    for (const content of message.content) {
      if (content.type !== "toolCall") continue;
      const tool = new ToolExecutionComponent(
        content.name,
        content.id,
        content.arguments,
        { showImages: false },
        withBuiltInRenderers(content.name, this.options.source.getToolDefinition(content.name), this.options.cwd),
        this.options.tui,
        this.options.cwd,
      );
      block.container.addChild(tool);
      this.pendingTools.set(content.id, { component: tool, block });
    }
    this.hasVisibleContent = true;
  }

  /** A tool result mutates the block holding its call; no other block changes. */
  private consumeToolResult(message: Extract<SessionMessage, { role: "toolResult" }>): void {
    const pending = this.pendingTools.get(message.toolCallId);
    if (!pending) return;
    pending.component.updateResult(message);
    pending.block.rows = undefined;
    this.settledRows = undefined;
    this.pendingTools.delete(message.toolCallId);
  }

  private consumeUser(message: Extract<SessionMessage, { role: "user" }>): void {
    const block = this.appendBlock();
    addUserComponents(block.container, message.content, this.options.markdownTheme, this.hasVisibleContent);
    if (block.container.children.length > 0) this.hasVisibleContent = true;
  }

  private consumeBashExecution(message: Extract<SessionMessage, { role: "bashExecution" }>): void {
    const block = this.appendBlock();
    const bash = new BashExecutionComponent(message.command, this.options.tui, message.excludeFromContext);
    if (message.output) bash.appendOutput(message.output);
    bash.setComplete(message.exitCode, message.cancelled, undefined, message.fullOutputPath);
    block.container.addChild(bash);
    this.hasVisibleContent = true;
  }

  /** Compaction and branch summaries share the same spacer-plus-summary shape. */
  private consumeSummary(
    summary: CompactionSummaryMessageComponent | BranchSummaryMessageComponent,
  ): void {
    const block = this.appendBlock();
    block.container.addChild(new Spacer(1));
    block.container.addChild(summary);
    this.hasVisibleContent = true;
  }

  private appendBlock(): SettledBlock {
    const block: SettledBlock = { container: new Container(), rows: undefined };
    this.blocks.push(block);
    return block;
  }
}

/** One settled message's components plus its rows at the current width. */
interface SettledBlock {
  readonly container: Container;
  rows: readonly string[] | undefined;
}

/** A Pi component that collapses to a preview, as Pi's own interactive mode detects one. */
interface Expandable {
  setExpanded(expanded: boolean): void;
}

function isExpandable(component: Component): component is Component & Expandable {
  return "setExpanded" in component && typeof component.setExpanded === "function";
}

/**
 * Set every collapsible component in `blocks` to `expanded`. Each one is a
 * direct child of its block's container, as in Pi's own chat container.
 */
function applyExpansion(blocks: readonly SettledBlock[], expanded: boolean): void {
  for (const block of blocks) {
    for (const child of block.container.children) {
      if (isExpandable(child)) child.setExpanded(expanded);
    }
  }
}

/** A tool call awaiting its result, and the block whose rows it will invalidate. */
interface PendingTool {
  readonly component: ToolExecutionComponent;
  readonly block: SettledBlock;
}

/** The assistant variant of a session message, as Pi's components consume it. */
type AssistantSessionMessage = Extract<SessionMessage, { role: "assistant" }>;

/**
 * The in-flight assistant message a partial event carries, or undefined when the
 * event is anything else. A partial for another role means a message settled
 * elsewhere in the history, which only a rebuild can pick up.
 */
function inFlightAssistantMessage(event?: AgentSessionEvent): AssistantSessionMessage | undefined {
  if (event?.type !== "message_start" && event?.type !== "message_update") return undefined;
  return event.message.role === "assistant" ? event.message : undefined;
}

/**
 * Render a user message (skill block + text) into the block, mirroring Pi.
 * Whether a leading spacer is needed is a whole-transcript property, so the
 * caller — which alone knows what precedes this block — supplies it.
 */
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
  container.addChild(new SkillInvocationMessageComponent(skillBlock, markdownTheme));
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
