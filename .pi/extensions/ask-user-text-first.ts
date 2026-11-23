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
 * When the blocked message held thinking blocks, the reason says the briefing stayed in thinking:
 * that is the recurring shape, and the generic reason led to re-sends with the same mistake.
 *
 * Interim: `@gotgenes/pi-ask` absorbs this guard (#1087).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ASK_TOOL_NAME = "ask_user";

const BLOCK_REASON = [
  "this assistant message has no visible text.",
  "The operator sees only your visible text and the ask_user form, never your reasoning.",
  "Write the context the questions depend on — findings, trade-offs, what each option means — as visible text,",
  "then call ask_user again in that same response.",
].join(" ");

const THINKING_ONLY_REASON = [
  "this assistant message held only thinking blocks — prose written while thinking is not visible.",
  "End the thinking, write the briefing as reply text, then call ask_user in that same response.",
].join(" ");

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
    const reason = lastAssistantHadThinking
      ? THINKING_ONLY_REASON
      : BLOCK_REASON;
    return { block: true, reason };
  });
}
