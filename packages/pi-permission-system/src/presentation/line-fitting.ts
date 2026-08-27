import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

/**
 * Fit rendered lines to a terminal width, so each returned entry is a single
 * visual row no wider than `width`.
 *
 * Long lines are wrapped rather than clipped so no content is lost; the final
 * `truncateToWidth` guards the edge cases `wrapTextWithAnsi` cannot split (a
 * lone wide grapheme). A width of zero or less yields no rows.
 *
 * Shared by the `ctx.ui.custom` dialog — whose contract requires it — and by
 * any renderer that must count rows, since a row count is only meaningful
 * after wrapping.
 */
export function fitLinesToWidth(
  lines: readonly string[],
  width: number,
): string[] {
  if (width <= 0) {
    return [];
  }
  return lines.flatMap((line) =>
    wrapTextWithAnsi(line, width).map((wrapped) =>
      truncateToWidth(wrapped, width),
    ),
  );
}
