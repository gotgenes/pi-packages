import { describe, expect, it } from "vitest";
import { BorderedPanel } from "#src/ui/bordered-panel";

class FixedLines {
  invalidate(): void {}

  render(): string[] {
    return ["settings"];
  }
}

describe("BorderedPanel", () => {
  it("wraps child content with accent rules", () => {
    const panel = new BorderedPanel((text) => `[${text}]`);
    panel.addChild(new FixedLines());

    expect(panel.render(10)).toEqual([
      `[${"─".repeat(10)}]`,
      "settings",
      `[${"─".repeat(10)}]`,
    ]);
  });
});
