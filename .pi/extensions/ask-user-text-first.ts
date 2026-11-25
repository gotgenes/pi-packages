/**
 * ask-user-text-first — block an `ask_user` call that arrives without a visible briefing.
 *
 * Project-local extension (auto-discovered from `.pi/extensions/`). The operator sees only an
 * assistant message's visible text and the `ask_user` form — never its reasoning — so a question
 * whose context lives only in thinking reaches them without the substance it asks about.
 *
 * Pi emits the assistant message's `message_end` before executing its tool calls, so the guard
 * records whether that message carried a non-empty text block and blocks `ask_user` when it did
 * not. Tool-result messages also emit `message_end`; only assistant messages update the record.
 *
 * The usual cause is model-side: recent models sometimes emit the prose that precedes a tool call
 * as a second thinking block instead of a text block, and the model cannot steer which channel it
 * lands in. A reply that ends without a tool call is not affected. So the block reason asks for the
 * shape that recovers — plain reply text that ends the turn — on the first block, not for a re-sent
 * `ask_user` call. Measured over this repo's sessions (2026-11-25): asked to re-send with text,
 * the model produced text plus `ask_user` in 1 of 38 replies; asked to end the turn in plain text,
 * it did so in 3 of 3.
 *
 * Interim: `@gotgenes/pi-ask` absorbs this guard (#1087).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ASK_TOOL_NAME = "ask_user";

const NO_TEXT =
  "ask_user blocked: this message has no text block, so the operator would see only the form.";

const BRIEFING_IN_THINKING = [
  "Your briefing went into a thinking block, which the operator never sees;",
  "recent models do this when a reply ends in a tool call, and retrying the call repeats it.",
].join(" ");

const RECOVERY =
  "Write the briefing and the questions as plain reply text, with no tool call, and end your turn; the operator answers in chat.";

interface ContentBlock {
  type: string;
  text?: string;
}

function hasVisibleText(content: unknown): boolean {
  if (typeof content === "string") return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  return content.some(
    (block: ContentBlock) =>
      block.type === "text" && (block.text ?? "").trim().length > 0,
  );
}

function hasThinking(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some((block: ContentBlock) => block.type === "thinking")
  );
}

function blockReason(hadThinking: boolean): string {
  return hadThinking
    ? `${NO_TEXT} ${BRIEFING_IN_THINKING} ${RECOVERY}`
    : `${NO_TEXT} ${RECOVERY}`;
}

export default function askUserTextFirst(pi: ExtensionAPI): void {
  let lastAssistantHadText = true;
  let lastAssistantHadThinking = false;

  pi.on("message_end", (event) => {
    const message = event.message as { role?: string; content?: unknown };
    if (message.role !== "assistant") return;
    lastAssistantHadText = hasVisibleText(message.content);
    lastAssistantHadThinking = hasThinking(message.content);
  });

  pi.on("tool_call", (event) => {
    if (event.toolName !== ASK_TOOL_NAME || lastAssistantHadText) return;
    return { block: true, reason: blockReason(lastAssistantHadThinking) };
  });
}
