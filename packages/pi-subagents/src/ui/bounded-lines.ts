/**
 * bounded-lines.ts — a TUI component that spends exactly one terminal row per line.
 *
 * Pi's `Text` word-wraps, so a single long line becomes as many rows as it needs
 * and a line-count cap does not bound the height of a result. This component
 * clips instead of wrapping, which makes the row count equal to the line count
 * at every width — the bound `get_subagent_result` renders under (#636).
 *
 * Clipping is by display columns via pi-tui's `truncateToWidth`, so a wide glyph
 * costs the two columns it actually occupies rather than the one code unit it
 * is stored in.
 *
 * A line carrying its own line break is cut at the first one, because the terminal
 * would otherwise spend a row on each segment and the bound would rest on every
 * caller's care rather than on this component. Pi's own `TruncatedText` cuts at
 * the first newline for the same reason.
 */

import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";

/** Renders pre-themed lines one-to-one onto terminal rows, clipped to the viewport. */
export class BoundedLines implements Component {
	constructor(private readonly lines: readonly string[]) {}

	render(width: number): string[] {
		return this.lines.map((line) => truncateToWidth(firstLineOf(line), width));
	}

	/** Required by `Component`; nothing is cached between renders, so there is nothing to discard. */
	// fallow-ignore-next-line unused-class-member
	invalidate(): void {}
}

/**
 * The text up to the first line break of any flavour.
 *
 * Vertical tab and form feed count: a VT100-class terminal moves the cursor down
 * a row for each exactly as it does for a line feed, and both are zero-width, so
 * a width-based clip would pass them through to cost a row of their own.
 */
function firstLineOf(line: string): string {
	const breakAt = line.search(/[\r\n\v\f]/);
	return breakAt === -1 ? line : line.slice(0, breakAt);
}
