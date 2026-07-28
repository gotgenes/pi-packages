import { describe, expect, it } from "vitest";
import type { NotificationDetails } from "#src/observation/notification";
import {
  buildPreviewLines,
  buildStatsParts,
  createNotificationRenderer,
  resolveStatusPresentation,
} from "#src/observation/renderer";

/** Minimal theme stub — satisfies RendererTheme structurally. */
function stubTheme() {
  return {
    fg: (style: string, text: string) => `[${style}:${text}]`,
    bold: (text: string) => `**${text}**`,
  };
}

function makeDetails(overrides: Partial<NotificationDetails> = {}): NotificationDetails {
  return {
    id: "agent-1",
    description: "Test agent",
    status: "completed",
    toolUses: 3,
    turnCount: 5,
    totalTokens: 1000,
    durationMs: 5000,
    resultPreview: "All done.",
    ...overrides,
  };
}

/** Render to a flat string for assertion; uses the public render() API. */
function renderText(result: ReturnType<ReturnType<typeof createNotificationRenderer>>): string {
  expect(result).toBeDefined();
  return result!.render(120).join("\n");
}

describe("resolveStatusPresentation", () => {
  it("resolves completed status", () => {
    expect(resolveStatusPresentation("completed")).toEqual({
      iconGlyph: "✓",
      iconStyle: "success",
      statusText: "completed",
    });
  });

  it("resolves steered status to completed (steered)", () => {
    expect(resolveStatusPresentation("steered")).toEqual({
      iconGlyph: "✓",
      iconStyle: "success",
      statusText: "completed (steered)",
    });
  });

  it("resolves error status", () => {
    expect(resolveStatusPresentation("error")).toEqual({
      iconGlyph: "✗",
      iconStyle: "error",
      statusText: "error",
    });
  });

  it("resolves stopped status", () => {
    expect(resolveStatusPresentation("stopped")).toEqual({
      iconGlyph: "✗",
      iconStyle: "error",
      statusText: "stopped",
    });
  });

  it("resolves aborted status", () => {
    expect(resolveStatusPresentation("aborted")).toEqual({
      iconGlyph: "✗",
      iconStyle: "error",
      statusText: "aborted",
    });
  });

});

describe("buildStatsParts", () => {
  it("includes all parts in order when all fields are present", () => {
    const parts = buildStatsParts({
      turnCount: 5,
      maxTurns: 10,
      toolUses: 3,
      totalTokens: 1000,
      durationMs: 5000,
    });
    expect(parts).toEqual(["↻5≤10", "3 tool uses", "1.0k token", "5.0s"]);
  });

  it("omits a part when its field is zero", () => {
    expect(
      buildStatsParts({ turnCount: 0, maxTurns: 10, toolUses: 3, totalTokens: 1000, durationMs: 5000 }),
    ).toEqual(["3 tool uses", "1.0k token", "5.0s"]);
    expect(
      buildStatsParts({ turnCount: 5, maxTurns: 10, toolUses: 0, totalTokens: 1000, durationMs: 5000 }),
    ).toEqual(["↻5≤10", "1.0k token", "5.0s"]);
    expect(
      buildStatsParts({ turnCount: 5, maxTurns: 10, toolUses: 3, totalTokens: 0, durationMs: 5000 }),
    ).toEqual(["↻5≤10", "3 tool uses", "5.0s"]);
    expect(
      buildStatsParts({ turnCount: 5, maxTurns: 10, toolUses: 3, totalTokens: 1000, durationMs: 0 }),
    ).toEqual(["↻5≤10", "3 tool uses", "1.0k token"]);
  });

  it("returns an empty array when all fields are zero", () => {
    expect(
      buildStatsParts({ turnCount: 0, maxTurns: undefined, toolUses: 0, totalTokens: 0, durationMs: 0 }),
    ).toEqual([]);
  });

  it("pluralizes tool use for exactly one", () => {
    const parts = buildStatsParts({
      turnCount: 0,
      maxTurns: undefined,
      toolUses: 1,
      totalTokens: 0,
      durationMs: 0,
    });
    expect(parts).toEqual(["1 tool use"]);
  });

  it("pluralizes tool uses for more than one", () => {
    const parts = buildStatsParts({
      turnCount: 0,
      maxTurns: undefined,
      toolUses: 2,
      totalTokens: 0,
      durationMs: 0,
    });
    expect(parts).toEqual(["2 tool uses"]);
  });
});

describe("buildPreviewLines", () => {
  it("returns only the first line, sliced to 80 columns, when collapsed", () => {
    const long = "x".repeat(100);
    expect(buildPreviewLines(`${long}\nsecond line`, false)).toEqual([long.slice(0, 80)]);
  });

  it("returns the first line unsliced when under 80 columns and collapsed", () => {
    expect(buildPreviewLines("short result\nsecond line", false)).toEqual(["short result"]);
  });

  it("returns up to 30 lines when expanded", () => {
    const lines = Array.from({ length: 35 }, (_, i) => `line${i}`);
    expect(buildPreviewLines(lines.join("\n"), true)).toEqual(lines.slice(0, 30));
  });

  it("returns all lines when expanded and under 30 lines", () => {
    expect(buildPreviewLines("line1\nline2\nline3", true)).toEqual(["line1", "line2", "line3"]);
  });

  it("returns a single empty string for empty input when collapsed", () => {
    expect(buildPreviewLines("", false)).toEqual([""]);
  });

  it("returns a single empty string for empty input when expanded", () => {
    expect(buildPreviewLines("", true)).toEqual([""]);
  });
});

describe("createNotificationRenderer", () => {
  it("returns undefined when message has no details", () => {
    const renderer = createNotificationRenderer();
    const result = renderer({ details: undefined }, { expanded: false }, stubTheme());
    expect(result).toBeUndefined();
  });

  it("renders completed status with success icon", () => {
    const renderer = createNotificationRenderer();
    const result = renderer({ details: makeDetails() }, { expanded: false }, stubTheme());
    const text = renderText(result);
    expect(text).toContain("[success:✓]");
    expect(text).toContain("**Test agent**");
    expect(text).toContain("completed");
  });

  it("renders error status with error icon", () => {
    const renderer = createNotificationRenderer();
    const result = renderer(
      { details: makeDetails({ status: "error" }) },
      { expanded: false },
      stubTheme(),
    );
    const text = renderText(result);
    expect(text).toContain("[error:✗]");
    expect(text).toContain("error");
  });

  it("shows full result lines when expanded", () => {
    const renderer = createNotificationRenderer();
    const result = renderer(
      { details: makeDetails({ resultPreview: "line1\nline2\nline3" }) },
      { expanded: true },
      stubTheme(),
    );
    const text = renderText(result);
    expect(text).toContain("line1");
    expect(text).toContain("line2");
    expect(text).toContain("line3");
  });

  it("shows collapsed preview when not expanded", () => {
    const renderer = createNotificationRenderer();
    const result = renderer(
      { details: makeDetails({ resultPreview: "short result" }) },
      { expanded: false },
      stubTheme(),
    );
    expect(renderText(result)).toContain("⎿");
    expect(renderText(result)).toContain("short result");
  });

  it("shows output file link when present", () => {
    const renderer = createNotificationRenderer();
    const result = renderer(
      { details: makeDetails({ outputFile: "/tmp/transcript.jsonl" }) },
      { expanded: false },
      stubTheme(),
    );
    expect(renderText(result)).toContain("/tmp/transcript.jsonl");
  });

  it("includes stats line with tool uses and tokens", () => {
    const renderer = createNotificationRenderer();
    const result = renderer(
      { details: makeDetails({ toolUses: 7, totalTokens: 5000 }) },
      { expanded: false },
      stubTheme(),
    );
    const text = renderText(result);
    expect(text).toContain("7 tool uses");
    expect(text).toContain("5.0k token");
  });
});
