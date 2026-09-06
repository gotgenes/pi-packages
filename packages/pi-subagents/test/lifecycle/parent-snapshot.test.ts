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
});

describe("buildParentSnapshot — portable prompt parts", () => {
  it("is undefined when no prompt options were captured", () => {
    const snapshot = buildParentSnapshot(makeCtx());
    expect(snapshot.portablePrompt).toBeUndefined();
  });

  it("joins context files, guidelines, custom and append prompts", () => {
    const snapshot = buildParentSnapshot(makeCtx(), undefined, {
      contextFiles: [{ path: "/p/AGENTS.md", content: "# Rules" }],
      promptGuidelines: ["- Be terse"],
      customPrompt: "custom",
      appendSystemPrompt: "append",
    });
    expect(snapshot.portablePrompt).toContain('<project_instructions path="/p/AGENTS.md">');
    expect(snapshot.portablePrompt).toContain("# Rules");
    expect(snapshot.portablePrompt).toContain("- Be terse");
    expect(snapshot.portablePrompt).toContain("custom");
    expect(snapshot.portablePrompt).toContain("append");
  });

  it("is undefined when every part is empty", () => {
    const snapshot = buildParentSnapshot(makeCtx(), undefined, { contextFiles: [] });
    expect(snapshot.portablePrompt).toBeUndefined();
  });

  it("omits absent parts without blank-line gaps", () => {
    const snapshot = buildParentSnapshot(makeCtx(), undefined, { customPrompt: "only-custom" });
    expect(snapshot.portablePrompt).toBe("only-custom");
  });
});
