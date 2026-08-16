import { truncateToWidth } from "@earendil-works/pi-tui";

/**
 * Add the horizontal accent rules used by the permission prompt panel.
 *
 * The prompt content is rendered by the structured payload renderer first, so
 * this wrapper deliberately owns only the presentation chrome.
 */
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
