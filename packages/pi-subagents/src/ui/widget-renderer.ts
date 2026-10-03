/**
 * widget-renderer.ts — Pure rendering functions for the agent widget.
 *
 * All functions are stateless: they receive data and return formatted strings.
 * No timers, no SDK types, no side effects. Consumed by AgentWidget.
 */

import { truncateToWidth } from "@earendil-works/pi-tui";
import type { AgentConfigLookup } from "#src/config/agent-types";
import {
	isActiveStatus,
	type SubagentStatus,
} from "#src/lifecycle/subagent-state";
import { type TurnBudget, wrappedUpAtTurnLimit } from "#src/lifecycle/turn-limits";
import type { LifetimeUsage } from "#src/lifecycle/usage";
import { getLifetimeTotal } from "#src/lifecycle/usage";
import type { SubagentType } from "#src/types";
import {
	describeActivity,
	formatModel,
	formatMs,
	formatSessionTokens,
	formatTurns,
	getDisplayName,
	getPromptModeLabel,
	type ModelIdentity,
	type Theme,
} from "#src/ui/display";
import { GLYPHS, SPINNER } from "#src/ui/glyphs";

// ── Data interfaces ──────────────────────────────────────────────────────────

/** Minimal agent snapshot for rendering — no class methods, no mutation surface. */
export interface WidgetAgent {
	readonly id: string;
	readonly type: SubagentType;
	readonly status: SubagentStatus;
	readonly description: string;
	readonly toolUses: number;
	readonly startedAt: number;
	readonly completedAt?: number;
	readonly error?: string;
	readonly lifetimeUsage?: Readonly<LifetimeUsage>;
	readonly compactionCount: number;
	// Live activity (folded from the former WidgetActivity — precomputed by AgentWidget)
	readonly turnCount: number;
	readonly maxTurns?: number;
	/** The finished run's turn limit and its use; absent when no limit applied. */
	readonly turnBudget?: TurnBudget;
	readonly activeTools: ReadonlyMap<string, string>;
	readonly responseText: string;
	/** Context-window utilisation (0–100), or null when unavailable. */
	readonly contextPercent: number | null;
	/** The model the agent runs, once known. */
	readonly model?: ModelIdentity;
}

// ── Per-agent rendering ──────────────────────────────────────────────────────

/** Render a single finished agent line (no tree connector prefix). */
export function renderFinishedLine(
	agent: WidgetAgent,
	registry: AgentConfigLookup,
	theme: Theme,
): string {
	const name = getDisplayName(agent.type, registry);
	const modeLabel = getPromptModeLabel(agent.type, registry);
	const duration = formatMs((agent.completedAt ?? Date.now()) - agent.startedAt);

	let icon: string;
	let statusText: string;
	if (wrappedUpAtTurnLimit(agent)) {
		icon = theme.fg("warning", GLYPHS.success);
		statusText = theme.fg("warning", " (turn limit)");
	} else if (agent.status === "completed") {
		icon = theme.fg("success", GLYPHS.success);
		statusText = "";
	} else if (agent.status === "stopped") {
		icon = theme.fg("dim", GLYPHS.stopped);
		statusText = theme.fg("dim", " stopped");
	} else if (agent.status === "error") {
		icon = theme.fg("error", GLYPHS.failure);
		const errMsg = agent.error ? `: ${agent.error.slice(0, 60)}` : "";
		statusText = theme.fg("error", ` error${errMsg}`);
	} else {
		// aborted
		icon = theme.fg("error", GLYPHS.failure);
		statusText = theme.fg("warning", " aborted");
	}

	const parts: string[] = [];
	parts.push(formatTurns(agent.turnCount, agent.maxTurns));
	if (agent.toolUses > 0) parts.push(`${agent.toolUses} tool use${agent.toolUses === 1 ? "" : "s"}`);
	parts.push(duration);

	const modeTag = modeLabel ? ` ${theme.fg("dim", `(${modeLabel})`)}` : "";
	return `${icon} ${theme.fg("dim", name)}${modeTag}${modelTag(agent, theme)}  ${theme.fg("dim", agent.description)} ${theme.fg("dim", "·")} ${theme.fg("dim", parts.join(" · "))}${statusText}`;
}

/** Render a single running agent as header + activity line pair (no tree connector prefix). */
export function renderRunningLines(
	agent: WidgetAgent,
	registry: AgentConfigLookup,
	spinnerFrame: number,
	theme: Theme,
): [header: string, activity: string] {
	const name = getDisplayName(agent.type, registry);
	const modeLabel = getPromptModeLabel(agent.type, registry);
	const modeTag = modeLabel ? ` ${theme.fg("dim", `(${modeLabel})`)}` : "";
	const elapsed = formatMs(Date.now() - agent.startedAt);

	const tokens = getLifetimeTotal(agent.lifetimeUsage);
	const tokenText = tokens > 0 ? formatSessionTokens(tokens, agent.contextPercent, theme, agent.compactionCount) : "";

	const parts: string[] = [];
	parts.push(formatTurns(agent.turnCount, agent.maxTurns));
	if (agent.toolUses > 0) parts.push(`${agent.toolUses} tool use${agent.toolUses === 1 ? "" : "s"}`);
	if (tokenText) parts.push(tokenText);
	parts.push(elapsed);
	const statsText = parts.join(" · ");

	const frame = SPINNER[spinnerFrame % SPINNER.length];
	const activityText = describeActivity(agent.activeTools, agent.responseText);

	const header = `${theme.fg("accent", frame)} ${theme.bold(name)}${modeTag}${modelTag(agent, theme)}  ${theme.fg("muted", agent.description)} ${theme.fg("dim", "·")} ${theme.fg("dim", statsText)}`;
	const activityLine = theme.fg("dim", `  ${GLYPHS.subLine}  ${activityText}`);

	return [header, activityLine];
}

/** ` [provider/id]` after the agent's name, or nothing while the model is unknown. */
function modelTag(agent: WidgetAgent, theme: Theme): string {
	return agent.model ? ` ${theme.fg("dim", `[${formatModel(agent.model)}]`)}` : "";
}

// ── Full widget rendering ────────────────────────────────────────────────────

/** Ceiling on rendered lines, however tall the terminal. */
const MAX_WIDGET_LINES = 12;
/** Floor on rendered lines: below this the widget stops reading as a widget. */
const MIN_WIDGET_LINES = 3;
/**
 * Dock rows below the widget that the budget must leave alone: Pi's editor plus
 * its footer, measured at 5 (3 + 2) against pi-tui 0.84.4 and reserved at 6 so a
 * taller editor still leaves the widget's first animated line inside the
 * viewport. Pi's regular-mode differential renderer full-clears the screen and
 * the scrollback whenever the first changed line sits above the previous
 * viewport top, and the widget's spinner is that line on every tick (#864).
 */
const DOCK_LINES_BELOW_WIDGET = 6;

/**
 * Lines the widget may render at this terminal height, heading included.
 *
 * A pane shorter than the floor plus the reserved dock cannot be made safe by
 * any widget height, so the floor is where the bound stops helping rather than a
 * guarantee.
 */
export function widgetLineBudget(terminalRows: number): number {
	return Math.max(
		MIN_WIDGET_LINES,
		Math.min(MAX_WIDGET_LINES, terminalRows - DOCK_LINES_BELOW_WIDGET),
	);
}

interface AgentCategories {
	running: WidgetAgent[];
	queued: WidgetAgent[];
	finished: WidgetAgent[];
}

/** Partition agents into rendering buckets. */
function categorizeAgents(
	agents: readonly WidgetAgent[],
	shouldShowFinished: (agentId: string, status: string) => boolean,
): AgentCategories {
	return {
		running: agents.filter(a => a.status === "running"),
		queued: agents.filter(a => a.status === "queued"),
		finished: agents.filter(
			a => !isActiveStatus(a.status) && a.completedAt != null
				&& shouldShowFinished(a.id, a.status),
		),
	};
}

interface WidgetSections {
	finishedLines: string[];
	runningLines: [string, string][];
	queuedLine: string | undefined;
	/** Agents behind `queuedLine`, which collapses all of them into one row. */
	queuedCount: number;
}

/** Render each agent bucket into pre-formatted lines with ├─ tree connectors. */
function buildSections(
	categories: AgentCategories,
	registry: AgentConfigLookup,
	spinnerFrame: number,
	theme: Theme,
	truncate: (line: string) => string,
): WidgetSections {
	const finishedLines: string[] = [];
	for (const a of categories.finished) {
		finishedLines.push(truncate(theme.fg("dim", "\u251C\u2500") + " " + renderFinishedLine(a, registry, theme)));
	}

	const runningLines: [string, string][] = [];
	for (const a of categories.running) {
		const [header, act] = renderRunningLines(a, registry, spinnerFrame, theme);
		runningLines.push([
			truncate(theme.fg("dim", "\u251C\u2500") + ` ${header}`),
			truncate(theme.fg("dim", "\u2502  ") + act),
		]);
	}

	const queuedLine = categories.queued.length > 0
		? truncate(theme.fg("dim", "\u251C\u2500") + ` ${theme.fg("muted", GLYPHS.queued)} ${theme.fg("dim", `${categories.queued.length} queued`)}`)
		: undefined;

	return { finishedLines, runningLines, queuedLine, queuedCount: categories.queued.length };
}

/**
 * Assemble widget lines when the total body fits within the height budget.
 * Fixes the last tree connector: ├─ → └─, and │ → space for the running-agent activity line.
 */
function assembleWithinBudget(heading: string, sections: WidgetSections): string[] {
	const { finishedLines, runningLines, queuedLine } = sections;
	const lines: string[] = [heading, ...finishedLines];
	for (const pair of runningLines) lines.push(...pair);
	if (queuedLine) lines.push(queuedLine);

	// Fix last connector: swap \u251C\u2500 \u2192 \u2514\u2500.
	if (lines.length > 1) {
		const last = lines.length - 1;
		lines[last] = lines[last].replace("\u251C\u2500", "\u2514\u2500");
		if (runningLines.length > 0 && !queuedLine) {
			if (last >= 2) {
				lines[last - 1] = lines[last - 1].replace("\u251C\u2500", "\u2514\u2500");
				lines[last] = lines[last].replace("\u2502  ", "   ");
			}
		}
	}
	return lines;
}

/**
 * Assemble widget lines when the total body exceeds the height budget.
 * Prioritizes running > queued > finished and appends an overflow indicator.
 */
function assembleOverflow(
	heading: string,
	sections: WidgetSections,
	maxBody: number,
	truncate: (line: string) => string,
	theme: Theme,
): string[] {
	const { finishedLines, runningLines, queuedLine, queuedCount } = sections;
	const lines: string[] = [heading];
	let budget = maxBody - 1;
	let hiddenRunning = 0;
	let hiddenQueued = 0;
	let hiddenFinished = 0;

	for (const pair of runningLines) {
		if (budget >= 2) {
			lines.push(...pair);
			budget -= 2;
		} else {
			hiddenRunning++;
		}
	}

	if (queuedLine) {
		if (budget >= 1) {
			lines.push(queuedLine);
			budget--;
		} else {
			// The line is one row but stands for every queued agent, so dropping it
			// hides all of them.
			hiddenQueued = queuedCount;
		}
	}

	for (const fl of finishedLines) {
		if (budget >= 1) {
			lines.push(fl);
			budget--;
		} else {
			hiddenFinished++;
		}
	}

	const overflowParts: string[] = [];
	if (hiddenRunning > 0) overflowParts.push(`${hiddenRunning} running`);
	if (hiddenQueued > 0) overflowParts.push(`${hiddenQueued} queued`);
	if (hiddenFinished > 0) overflowParts.push(`${hiddenFinished} finished`);
	const overflowText = overflowParts.join(", ");
	const hiddenTotal = hiddenRunning + hiddenQueued + hiddenFinished;
	lines.push(truncate(theme.fg("dim", "\u2514\u2500") + ` ${theme.fg("dim", `+${hiddenTotal} more (${overflowText})`)}`));
	return lines;
}

/** Pure rendering of the widget body. Returns lines to display. */
export function renderWidgetLines(params: {
	agents: readonly WidgetAgent[];
	registry: AgentConfigLookup;
	spinnerFrame: number;
	terminalWidth: number;
	terminalHeight: number;
	theme: Theme;
	shouldShowFinished: (agentId: string, status: string) => boolean;
}): string[] {
	const { agents, registry, spinnerFrame, terminalWidth, terminalHeight, theme, shouldShowFinished } = params;

	const { running, queued, finished } = categorizeAgents(agents, shouldShowFinished);

	const hasActive = running.length > 0 || queued.length > 0;
	const hasFinished = finished.length > 0;

	if (!hasActive && !hasFinished) return [];

	const truncate = (line: string) => truncateToWidth(line, terminalWidth);
	const headingColor = hasActive ? "accent" : "dim";
	const headingIcon = hasActive ? GLYPHS.agentsActive : GLYPHS.agentsIdle;

	const { finishedLines, runningLines, queuedLine } = buildSections(
		{ running, queued, finished },
		registry,
		spinnerFrame,
		theme,
		truncate,
	);

	// Assemble with overflow cap (heading takes 1 line).
	const maxBody = widgetLineBudget(terminalHeight) - 1;
	const totalBody = finishedLines.length + runningLines.length * 2 + (queuedLine ? 1 : 0);
	const heading = truncate(theme.fg(headingColor, headingIcon) + " " + theme.fg(headingColor, "Agents"));

	const sections = { finishedLines, runningLines, queuedLine, queuedCount: queued.length };
	if (totalBody <= maxBody) {
		return assembleWithinBudget(heading, sections);
	}
	return assembleOverflow(heading, sections, maxBody, truncate, theme);
}
