import { describe, expect, it, vi } from "vitest";

const { buildParentContextMock } = vi.hoisted(() => ({
  buildParentContextMock: vi.fn((): string => ""),
}));

vi.mock("#src/session/context", () => ({
  buildParentContext: buildParentContextMock,
}));

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildParentSnapshot } from "#src/lifecycle/parent-snapshot";

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    cwd: "/test/project",
    getSystemPrompt: () => "parent system prompt",
    model: { id: "claude-sonnet" },
    modelRegistry: { find: vi.fn(), getAvailable: vi.fn(() => []) },
    sessionManager: { getBranch: vi.fn(() => []) },
    ...overrides,
  } as unknown as ExtensionContext;
}

describe("buildParentSnapshot", () => {
  it("captures cwd from ctx", () => {
    const snapshot = buildParentSnapshot(makeCtx({ cwd: "/custom/path" }));
    expect(snapshot.cwd).toBe("/custom/path");
  });

  it("captures systemPrompt from ctx.getSystemPrompt()", () => {
    const snapshot = buildParentSnapshot(makeCtx({ getSystemPrompt: () => "my prompt" }));
    expect(snapshot.systemPrompt).toBe("my prompt");
  });

  it("captures model from ctx", () => {
    const model = { id: "claude-haiku", provider: "anthropic" };
    const snapshot = buildParentSnapshot(makeCtx({ model }));
    expect(snapshot.model).toBe(model);
  });

  it("captures modelRegistry from ctx", () => {
    const registry = { find: vi.fn(), getAvailable: vi.fn(() => []) };
    const snapshot = buildParentSnapshot(makeCtx({ modelRegistry: registry }));
    expect(snapshot.modelRegistry).toBe(registry);
  });

  it("sets parentContext to undefined when inheritContext is false", () => {
    const snapshot = buildParentSnapshot(makeCtx(), false);
    expect(snapshot.parentContext).toBeUndefined();
    expect(buildParentContextMock).not.toHaveBeenCalled();
  });

  it("sets parentContext to undefined when inheritContext is undefined", () => {
    const snapshot = buildParentSnapshot(makeCtx());
    expect(snapshot.parentContext).toBeUndefined();
    expect(buildParentContextMock).not.toHaveBeenCalled();
  });

  it("populates parentContext when inheritContext is true and conversation exists", () => {
    buildParentContextMock.mockReturnValueOnce("# Parent Conversation\n...");
    const snapshot = buildParentSnapshot(makeCtx(), true);
    expect(snapshot.parentContext).toBe("# Parent Conversation\n...");
    expect(buildParentContextMock).toHaveBeenCalledTimes(1);
  });

  it("sets parentContext to undefined when inheritContext is true but conversation is empty", () => {
    buildParentContextMock.mockReturnValueOnce("");
    const snapshot = buildParentSnapshot(makeCtx(), true);
    expect(snapshot.parentContext).toBeUndefined();
  });

  describe("portablePrompt", () => {
    it("is undefined when no prompt options were captured", () => {
      expect(buildParentSnapshot(makeCtx(), false).portablePrompt).toBeUndefined();
    });

    it("is undefined when the captured options carry no operator-authored parts", () => {
      const snapshot = buildParentSnapshot(makeCtx(), false, { contextFiles: [] });
      expect(snapshot.portablePrompt).toBeUndefined();
    });

    it("renders context files the way Pi's buildSystemPrompt does", () => {
      // Byte-exact against core/system-prompt.ts, which writes the lead-in
      // sentence and separates each block with a blank line.
      const snapshot = buildParentSnapshot(makeCtx(), false, {
        contextFiles: [
          { path: "/repo/AGENTS.md", content: "Repo rules." },
          { path: "/repo/sub/AGENTS.md", content: "Nested rules." },
        ],
      });
      expect(snapshot.portablePrompt).toBe(
        [
          "<project_context>",
          "",
          "Project-specific instructions and guidelines:",
          "",
          '<project_instructions path="/repo/AGENTS.md">',
          "Repo rules.",
          "</project_instructions>",
          "",
          '<project_instructions path="/repo/sub/AGENTS.md">',
          "Nested rules.",
          "</project_instructions>",
          "",
          "</project_context>",
        ].join("\n"),
      );
    });

    it("orders the parts the way Pi composes them: custom, append, then context", () => {
      const snapshot = buildParentSnapshot(makeCtx(), false, {
        contextFiles: [{ path: "/repo/AGENTS.md", content: "Repo rules." }],
        customPrompt: "You are a specialist.",
        appendSystemPrompt: "Extra instructions.",
      });
      expect(snapshot.portablePrompt).toBe(
        [
          "You are a specialist.",
          "",
          "Extra instructions.",
          "",
          "<project_context>",
          "",
          "Project-specific instructions and guidelines:",
          "",
          '<project_instructions path="/repo/AGENTS.md">',
          "Repo rules.",
          "</project_instructions>",
          "",
          "</project_context>",
        ].join("\n"),
      );
    });

    it("omits a section whose input is absent", () => {
      const snapshot = buildParentSnapshot(makeCtx(), false, {
        customPrompt: "You are a specialist.",
      });
      expect(snapshot.portablePrompt).toBe("You are a specialist.");
    });

    it("treats a whitespace-only custom or append prompt as absent", () => {
      const snapshot = buildParentSnapshot(makeCtx(), false, {
        customPrompt: "   ",
        appendSystemPrompt: "\n\n",
      });
      expect(snapshot.portablePrompt).toBeUndefined();
    });
  });
});
