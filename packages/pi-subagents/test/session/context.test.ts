import { describe, expect, it } from "vitest";
import { buildParentContext, extractText } from "#src/session/context";
import type { SessionContext } from "#src/types";

function makeCtx(entries: unknown[]): SessionContext {
  return {
    cwd: "/",
    model: undefined,
    modelRegistry: { find: () => undefined, getAll: () => [] },
    getSystemPrompt: () => "",
    sessionManager: {
      getSessionFile: () => undefined,
      getSessionId: () => "test",
      getBranch: () => entries,
      getEntries: () => [],
    },
  };
}

describe("extractText", () => {
  it("returns empty string for an empty array", () => {
    expect(extractText([])).toBe("");
  });

  it("extracts text from a single text block", () => {
    expect(extractText([{ type: "text", text: "hello" }])).toBe("hello");
  });

  it("joins multiple text blocks with newlines", () => {
    expect(
      extractText([
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ]),
    ).toBe("first\nsecond");
  });

  it("skips non-text blocks", () => {
    expect(
      extractText([
        { type: "thinking", thinking: "..." },
        { type: "text", text: "visible" },
        { type: "tool_use", name: "bash" },
      ]),
    ).toBe("visible");
  });

  it("returns empty string when no text blocks exist", () => {
    expect(extractText([{ type: "tool_result" }, { type: "thinking" }])).toBe("");
  });
});

describe("buildParentContext", () => {
  it("returns empty string for empty branch", () => {
    expect(buildParentContext(makeCtx([]))).toBe("");
  });

  it("returns empty string for null-ish branch", () => {
    // getBranch() may return undefined at runtime despite the type
    expect(buildParentContext(makeCtx(undefined as unknown as unknown[]))).toBe("");
  });

  it("formats a user message with string content", () => {
    const result = buildParentContext(
      makeCtx([{ type: "message", message: { role: "user", content: "Hello" } }]),
    );
    expect(result).toContain("[User]: Hello");
  });

  it("formats a user message with array content", () => {
    const result = buildParentContext(
      makeCtx([
        {
          type: "message",
          message: { role: "user", content: [{ type: "text", text: "Hi there" }] },
        },
      ]),
    );
    expect(result).toContain("[User]: Hi there");
  });

  it("formats an assistant message with string content", () => {
    const result = buildParentContext(
      makeCtx([{ type: "message", message: { role: "assistant", content: "I can help" } }]),
    );
    expect(result).toContain("[Assistant]: I can help");
  });

  it("formats an assistant message with array content", () => {
    const result = buildParentContext(
      makeCtx([
        {
          type: "message",
          message: { role: "assistant", content: [{ type: "text", text: "Sure!" }] },
        },
      ]),
    );
    expect(result).toContain("[Assistant]: Sure!");
  });

  it("skips user messages with empty or whitespace-only text", () => {
    const result = buildParentContext(
      makeCtx([{ type: "message", message: { role: "user", content: "   " } }]),
    );
    expect(result).toBe("");
  });

  it("skips toolResult messages", () => {
    const result = buildParentContext(
      makeCtx([{ type: "message", message: { role: "tool", content: "result data" } }]),
    );
    expect(result).toBe("");
  });

  it("formats a compaction entry with a summary", () => {
    const result = buildParentContext(
      makeCtx([{ type: "compaction", summary: "Work done so far" }]),
    );
    expect(result).toContain("[Summary]: Work done so far");
  });

  it("skips a compaction entry without a summary", () => {
    const result = buildParentContext(makeCtx([{ type: "compaction" }]));
    expect(result).toBe("");
  });

  it("skips unknown entry types", () => {
    const result = buildParentContext(makeCtx([{ type: "other" }]));
    expect(result).toBe("");
  });

  it("wraps non-empty output in the header/footer template", () => {
    const result = buildParentContext(
      makeCtx([{ type: "message", message: { role: "user", content: "test" } }]),
    );
    expect(result).toMatch(/^# Parent Conversation Context/);
    expect(result).toContain("Use this context");
    expect(result).toContain("# Your Task (below)");
  });

  it("joins multiple parts with double newlines", () => {
    const result = buildParentContext(
      makeCtx([
        { type: "message", message: { role: "user", content: "first" } },
        { type: "message", message: { role: "assistant", content: "second" } },
      ]),
    );
    expect(result).toContain("[User]: first\n\n[Assistant]: second");
  });

  it("handles mixed entry types in order", () => {
    const result = buildParentContext(
      makeCtx([
        { type: "compaction", summary: "Earlier work" },
        { type: "message", message: { role: "user", content: "What next?" } },
        { type: "other" },
      ]),
    );
    expect(result).toContain("[Summary]: Earlier work");
    expect(result).toContain("[User]: What next?");
    expect(result).not.toContain("other");
  });
});
