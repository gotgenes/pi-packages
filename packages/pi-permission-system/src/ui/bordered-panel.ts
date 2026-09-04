import {
  type Component,
  Container,
  truncateToWidth,
} from "@earendil-works/pi-tui";

/**
 * Add the horizontal rules used by the inline permission panels.
 *
 * The prompt content is rendered by the structured payload renderer first, so
 * this wrapper deliberately owns only the presentation chrome.
 */
type InputComponent = Component & {
  handleInput(data: string): void;
};

export class BorderedPanel implements Component {
  private readonly content = new Container();
  private inputComponent: InputComponent | undefined;

  constructor(private readonly border: (text: string) => string) {}

  addChild(component: Component): void {
    this.content.addChild(component);
    if (hasInputHandler(component)) {
      this.inputComponent = component;
    }
  }

  handleInput(data: string): void {
    this.inputComponent?.handleInput(data);
  }

  invalidate(): void {
    this.content.invalidate();
  }

  render(width: number): string[] {
    return renderBorderedPanel(this.content.render(width), width, this.border);
  }
}

function hasInputHandler(component: Component): component is InputComponent {
  return (
    "handleInput" in component && typeof component.handleInput === "function"
  );
}

export function renderBorderedPanel(
  lines: readonly string[],
  width: number,
  border: (text: string) => string,
): string[] {
  if (width <= 0) {
    return [];
  }

  const horizontal = border("─".repeat(width));
  return [
    horizontal,
    ...lines.map((line) => truncateToWidth(line, width, "")),
    horizontal,
  ];
}
