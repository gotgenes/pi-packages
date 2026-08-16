import { describe, expect, it } from "vitest";
import { BorderedPanel } from "#src/ui/bordered-panel";

class FixedLines {
  readonly inputs: string[] = [];

  invalidate(): void {}

  render(): string[] {
    return ["settings"];
  }

  handleInput(data: string): void {
    this.inputs.push(data);
  }
}

describe("BorderedPanel", () => {
  it("wraps child content and forwards input", () => {
    const panel = new BorderedPanel((text) => `[${text}]`);
    const child = new FixedLines();
    panel.addChild(child);

    expect(panel.render(10)).toEqual([
      `[${"─".repeat(10)}]`,
      "settings",
      `[${"─".repeat(10)}]`,
    ]);

    panel.handleInput("down");
    expect(child.inputs).toEqual(["down"]);
  });
});
