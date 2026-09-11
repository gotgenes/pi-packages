/**
 * get-result-renderer.ts — Pure line assembly for the get_subagent_result TUI view.
 *
 * All functions are stateless: they receive GetResultDetails, the report text,
 * and a Theme, returning the pre-themed lines a BoundedLines component spends
 * one terminal row on each. No SDK types, no timers, no side effects.
 * Consumed by the renderResult hook in get-result-tool.ts. Mirrors the
 * result-renderer.ts pattern used by the subagent tool's renderer.
 */

import type { SubagentStatus } from "#src/lifecycle/subagent-state";
import { renderStatusIcon } from "#src/tools/result-renderer";
import type { Theme } from "#src/ui/display";
import { GLYPHS } from "#src/ui/glyphs";

/** How many report lines the expanded view draws before it defers to the transcript. */
export const MAX_EXPANDED_LINES = 50;

/**
 * Compact presentation metadata for a get_subagent_result result.
 *
 * Deliberately excludes the result body and the conversation: `details` is
 * serialized verbatim into the session JSONL and is never sent to the model, so
 * carrying either would duplicate on disk what `content` already holds. The
 * renderer reads the report text from the result's own content instead, and
 * `preview` is bounded to a fixed character budget by its producer.
 */
export interface GetResultDetails {
	agentId: string;
	displayName: string;
	status: SubagentStatus;
	description: string;
	toolUses: number;
	/** Pre-formatted lifetime token total; "" when zero. */
	tokens: string;
	contextPercent: number | null;
	compactionCount: number;
	/** Pre-formatted duration string. */
	duration: string;
	/** First non-empty line of the result body, clipped. Never the whole result. */
	preview?: string;
	error?: string;
	/** Whether the conversation was requested, so the expanded view can say where it went. */
	verbose: boolean;
	transcriptPath?: string;
}

/**
 * The lines for one get_subagent_result row, in its current expansion state.
 *
 * Collapsed is a fixed summary built from `details` alone; expanded is the
 * report text, capped. Neither grows with the size of the result.
 */
export function renderGetResultLines(
	details: GetResultDetails,
	reportText: string,
	expanded: boolean,
	theme: Theme,
): string[] {
	return expanded
		? renderExpandedReport(details, reportText, theme)
		: renderCollapsedSummary(details, theme);
}

/** Status glyph and stats, then the description and either the preview or the error. */
function renderCollapsedSummary(details: GetResultDetails, theme: Theme): string[] {
	const lines = [`${renderStatusIcon(details.status, theme)} ${renderStats(details, theme)}`];
	if (details.description) lines.push(subLine(details.description, "dim", theme));
	if (details.error) {
		lines.push(subLine(details.error, "error", theme));
	} else if (details.preview) {
		lines.push(subLine(details.preview, "dim", theme));
	}
	return lines;
}

/** The report text capped at MAX_EXPANDED_LINES, with an indicator when lines were dropped. */
function renderExpandedReport(
	details: GetResultDetails,
	reportText: string,
	theme: Theme,
): string[] {
	const reportLines = reportText.split("\n");
	const shown = reportLines.slice(0, MAX_EXPANDED_LINES);
	const lines = shown.map((line) => theme.fg("dim", `  ${line}`));
	const dropped = reportLines.length - shown.length;
	if (dropped > 0) lines.push(theme.fg("muted", `  ${renderOverflowNotice(details, dropped)}`));
	return lines;
}

/** Say how much was withheld and where the whole of it can still be read. */
function renderOverflowNotice(details: GetResultDetails, dropped: number): string {
	const withheld = details.verbose ? `${dropped} more lines, including the conversation` : `${dropped} more lines`;
	const where = details.transcriptPath ? ` — full transcript at ${details.transcriptPath}` : "";
	return `… (${withheld}${where})`;
}

/** The dim continuation line beneath the status line. */
function subLine(text: string, color: string, theme: Theme): string {
	return theme.fg(color, `  ${GLYPHS.subLine}  ${text}`);
}

/** Build the stats string: "Explore · 44 tool uses · 95.9k token · 9% · ⇊3 · 213.0s". */
function renderStats(details: GetResultDetails, theme: Theme): string {
	const parts = [details.displayName];
	if (details.toolUses > 0) {
		parts.push(`${details.toolUses} tool use${details.toolUses === 1 ? "" : "s"}`);
	}
	if (details.tokens) parts.push(details.tokens);
	if (details.contextPercent !== null) parts.push(`${Math.round(details.contextPercent)}%`);
	if (details.compactionCount > 0) parts.push(`${GLYPHS.compactions}${details.compactionCount}`);
	parts.push(details.duration);
	return parts
		.map((part) => theme.fg("dim", part))
		.join(" " + theme.fg("dim", "\u00B7") + " ");
}
