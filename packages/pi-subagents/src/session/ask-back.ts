/**
 * ask-back.ts — The marker a child uses to ask its parent a question.
 *
 * A child that cannot finish without information only its parent has ends its
 * turn with the question in a marked block. The core detects the block on the
 * terminal transition and every result carrier surfaces it as answerable, so
 * the parent can reply by resuming the child.
 *
 * Detection is deterministic rather than heuristic: a question is one the child
 * declared, never one inferred from a trailing question mark.
 *
 * Pure functions only — no SDK types, no record types, no side effects.
 */

const OPEN_TAG = "<question-for-parent>";
const CLOSE_TAG = "</question-for-parent>";

/**
 * The protocol taught to every child, in both prompt modes.
 *
 * The example is fenced deliberately: `parseQuestionForParent` ignores fenced
 * regions, so a child that quotes these instructions back — while explaining
 * itself, or in a summary — does not trip the parser with the sample question.
 * For the same reason the prose above the fence names the marker without its
 * angle brackets: a bare opening tag there would pair with the fenced closing
 * one and form a block spanning the example.
 */
export const ASK_BACK_PROTOCOL = `<ask_back>
If you cannot complete this task without information only the delegating agent has, end your turn with the question in a question-for-parent block:

\`\`\`text
${OPEN_TAG}
Which of the three config files should I treat as authoritative?
${CLOSE_TAG}
\`\`\`

The delegating agent can answer, and you will resume with your context intact.
Ask only when the answer changes what you would do; otherwise state your assumption and continue.
</ask_back>`;

/** A child's terminal text, split into its question (if any) and the rest. */
export interface ParsedOutcome {
	/** The declared question, trimmed; undefined when the child asked nothing. */
	question: string | undefined;
	/** The result with the question block removed, so it renders once. */
	body: string;
}

/**
 * Split a child's terminal text into its declared question and the rest.
 *
 * The **last** well-formed block wins, so a child that drafts or reasons about
 * its question before settling on one is not defeated by its own earlier text.
 * Markers inside code — a fenced region or an inline span — are quotation, not
 * a question, so a child describing the protocol does not trip it.
 */
export function parseQuestionForParent(result: string): ParsedOutcome {
	const blocks = findBlocks(result, findQuotedRanges(result));
	const declared = blocks.findLast((block) => block.content.trim().length > 0);
	if (!declared) return { question: undefined, body: result };

	return {
		question: declared.content.trim(),
		body: spliceOut(result, declared.start, declared.end),
	};
}

interface Range {
	start: number;
	end: number;
}

interface Block extends Range {
	content: string;
}

/**
 * Every non-overlapping open/close pair, in document order, ignoring tags that
 * sit inside code.
 *
 * Quoting is applied while scanning rather than to the finished list: a quoted
 * opening tag discarded afterwards would already have consumed the closing tag
 * of the real question that followed it.
 */
function findBlocks(text: string, quoted: Range[]): Block[] {
	const blocks: Block[] = [];
	let cursor = 0;
	while (cursor < text.length) {
		const open = nextUnquoted(text, OPEN_TAG, cursor, quoted);
		if (open === -1) break;
		const contentStart = open + OPEN_TAG.length;
		const close = nextUnquoted(text, CLOSE_TAG, contentStart, quoted);
		if (close === -1) break;
		blocks.push({
			start: open,
			end: close + CLOSE_TAG.length,
			content: text.slice(contentStart, close),
		});
		cursor = close + CLOSE_TAG.length;
	}
	return blocks;
}

/** The next occurrence of `tag` at or after `from` that is not inside code. */
function nextUnquoted(text: string, tag: string, from: number, quoted: Range[]): number {
	let at = text.indexOf(tag, from);
	while (at !== -1 && quoted.some((range) => at >= range.start && at < range.end)) {
		at = text.indexOf(tag, at + tag.length);
	}
	return at;
}

/**
 * Character ranges a marker may not be read from: code, in either spelling.
 *
 * Both are quotation. A child that writes the marker while explaining itself
 * reaches for whichever is at hand, and an inline span is the likelier of the
 * two mid-sentence.
 */
function findQuotedRanges(text: string): Range[] {
	const fences = findFencedRanges(text);
	return [...fences, ...findInlineCodeRanges(text, fences)];
}

/**
 * Backtick-delimited spans, found per line outside fenced regions.
 *
 * Scoped to a single line so an unmatched backtick cannot swallow the rest of
 * the text, and requiring at least one non-backtick character so a fence line
 * is never mistaken for a span.
 */
function findInlineCodeRanges(text: string, fences: Range[]): Range[] {
	const ranges: Range[] = [];
	const span = /(`+)[^`]+?\1/g;
	let offset = 0;

	for (const line of text.split("\n")) {
		const lineStart = offset;
		offset += line.length + 1;
		if (fences.some((fence) => lineStart >= fence.start && lineStart < fence.end)) continue;

		span.lastIndex = 0;
		for (let match = span.exec(line); match !== null; match = span.exec(line)) {
			ranges.push({
				start: lineStart + match.index,
				end: lineStart + match.index + match[0].length,
			});
		}
	}
	return ranges;
}

/**
 * Character ranges covered by fenced code regions.
 *
 * A fence opens on a line of three or more backticks or tildes and closes on a
 * line of at least as many of the same character, which is what lets a
 * four-backtick fence contain a three-backtick one — the convention this repo's
 * own markdown uses for nested examples. An unclosed fence runs to the end.
 */
function findFencedRanges(text: string): Range[] {
	const ranges: Range[] = [];
	const fenceLine = /^[ \t]*(`{3,}|~{3,})/;
	let offset = 0;
	let open: { start: number; char: string; width: number } | undefined;

	for (const line of text.split("\n")) {
		const match = fenceLine.exec(line);
		if (match) {
			const marker = match[1];
			const char = marker.slice(0, 1);
			if (!open) {
				open = { start: offset, char, width: marker.length };
			} else if (char === open.char && marker.length >= open.width) {
				ranges.push({ start: open.start, end: offset + line.length });
				open = undefined;
			}
		}
		offset += line.length + 1;
	}

	if (open) ranges.push({ start: open.start, end: text.length });
	return ranges;
}

/** Remove a range and close the seam it leaves, so the body reads continuously. */
function spliceOut(text: string, start: number, end: number): string {
	const before = text.slice(0, start).replace(/\s+$/, "");
	const after = text.slice(end).replace(/^\s+/, "");
	if (!before) return after;
	if (!after) return before;
	return `${before}\n${after}`;
}
