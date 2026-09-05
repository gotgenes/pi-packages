import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ACTIVE_AGENT_TAG_REGEX,
  type ActiveAgentContext,
  getActiveAgentName,
  getActiveAgentNameFromSystemPrompt,
  normalizeAgentName,
  type SessionEntryView,
} from "#src/session/active-agent";

afterEach(() => {
  vi.restoreAllMocks();
});

function makeCtx(entries: SessionEntryView[]): ActiveAgentContext {
  return {
    sessionManager: {
      getEntries: vi.fn(() => entries),
    },
  };
}

describe("ACTIVE_AGENT_TAG_REGEX", () => {
  test("matches double-quoted name attribute", () => {
    const match = '<active_agent name="my-agent">'.match(
      ACTIVE_AGENT_TAG_REGEX,
    );
    expect(match?.[1]).toBe("my-agent");
  });

  test("matches single-quoted name attribute", () => {
    const match = "<active_agent name='my-agent'>".match(
      ACTIVE_AGENT_TAG_REGEX,
    );
    expect(match?.[1]).toBe("my-agent");
  });

  test("is case-insensitive", () => {
    const match = '<ACTIVE_AGENT name="bot">'.match(ACTIVE_AGENT_TAG_REGEX);
    expect(match?.[1]).toBe("bot");
  });

  test("does not match when tag is absent", () => {
    expect("no tag here".match(ACTIVE_AGENT_TAG_REGEX)).toBeNull();
  });
});

describe("normalizeAgentName", () => {
  test("returns trimmed string for valid input", () => {
    expect(normalizeAgentName("  my-agent  ")).toBe("my-agent");
  });

  test("returns null for empty string", () => {
    expect(normalizeAgentName("")).toBeNull();
  });

  test("returns null for whitespace-only string", () => {
    expect(normalizeAgentName("   ")).toBeNull();
  });

  test("returns null for non-string values", () => {
    expect(normalizeAgentName(null)).toBeNull();
    expect(normalizeAgentName(undefined)).toBeNull();
    expect(normalizeAgentName(42)).toBeNull();
    expect(normalizeAgentName({})).toBeNull();
  });
});

describe("getActiveAgentName", () => {
  test("returns null when session has no entries", () => {
    expect(getActiveAgentName(makeCtx([]))).toBeNull();
  });

  test("returns null when no active_agent custom entry exists", () => {
    const ctx = makeCtx([{ type: "message", data: { name: "agent" } }]);
    expect(getActiveAgentName(ctx)).toBeNull();
  });

  test("returns agent name from active_agent entry", () => {
    const ctx = makeCtx([
      { type: "custom", customType: "active_agent", data: { name: "bot" } },
    ]);
    expect(getActiveAgentName(ctx)).toBe("bot");
  });

  test("last-entry-wins: returns name from the last matching entry", () => {
    const ctx = makeCtx([
      { type: "custom", customType: "active_agent", data: { name: "first" } },
      { type: "custom", customType: "active_agent", data: { name: "last" } },
    ]);
    expect(getActiveAgentName(ctx)).toBe("last");
  });

  test("entry with name: null resets agent name to null", () => {
    const ctx = makeCtx([
      { type: "custom", customType: "active_agent", data: { name: "bot" } },
      { type: "custom", customType: "active_agent", data: { name: null } },
    ]);
    expect(getActiveAgentName(ctx)).toBeNull();
  });

  test("skips entries with whitespace-only name and continues scanning", () => {
    const ctx = makeCtx([
      { type: "custom", customType: "active_agent", data: { name: "first" } },
      { type: "custom", customType: "active_agent", data: { name: "   " } },
    ]);
    // "   " normalizes to null — not a sentinel reset, keeps scanning backwards
    expect(getActiveAgentName(ctx)).toBe("first");
  });

  test("ignores entries with wrong customType", () => {
    const ctx = makeCtx([
      { type: "custom", customType: "something_else", data: { name: "bot" } },
    ]);
    expect(getActiveAgentName(ctx)).toBeNull();
  });

  test("ignores entries with wrong type", () => {
    const ctx = makeCtx([
      { type: "tool_call", customType: "active_agent", data: { name: "bot" } },
    ]);
    expect(getActiveAgentName(ctx)).toBeNull();
  });
});

describe("getActiveAgentNameFromSystemPrompt", () => {
  test("returns null for undefined system prompt", () => {
    expect(getActiveAgentNameFromSystemPrompt(undefined)).toBeNull();
  });

  test("returns null for empty system prompt", () => {
    expect(getActiveAgentNameFromSystemPrompt("")).toBeNull();
  });

  test("returns null when tag is absent", () => {
    expect(
      getActiveAgentNameFromSystemPrompt("You are a helpful assistant."),
    ).toBeNull();
  });

  test("extracts agent name from tag in system prompt", () => {
    const prompt = 'You are helpful.\n<active_agent name="my-bot">\nDo work.';
    expect(getActiveAgentNameFromSystemPrompt(prompt)).toBe("my-bot");
  });

  test("returns null when tag name is empty", () => {
    const prompt = '<active_agent name="">';
    expect(getActiveAgentNameFromSystemPrompt(prompt)).toBeNull();
  });

  test("trims whitespace from extracted name", () => {
    const prompt = '<active_agent name="  trimmed  ">';
    expect(getActiveAgentNameFromSystemPrompt(prompt)).toBe("trimmed");
  });
});
