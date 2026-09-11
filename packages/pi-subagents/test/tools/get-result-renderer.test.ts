import { describe, expect, it } from "vitest";
import type { SubagentStatus } from "#src/lifecycle/subagent-state";
import {
	type GetResultDetails,
	MAX_EXPANDED_LINES,
	renderGetResultLines,
} from "#src/tools/get-result-renderer";
import type { Theme } from "#src/ui/display";

function makeTheme(): Theme {
	return {
		fg: (color: string, text: string) => `[${color}:${text}]`,
		bold: (text: string) => `**${text}**`,
	};
}

function makeDetails(overrides: Partial<GetResultDetails> = {}): GetResultDetails {
	return {
		agentId: "agent-1",
		displayName: "Explore",
		status: "completed",
		description: "Trace Pi tool-result rendering",
		toolUses: 44,
		tokens: "95.9k token",
		contextPercent: 9,
		compactionCount: 0,
		duration: "213.0s",
		preview: "## Summary",
		verbose: false,
		...overrides,
	};
}

const theme = makeTheme();

/** A report long enough to overflow the cap, with a recognisable line per index. */
function longReport(lines: number): string {
	return Array.from({ length: lines }, (_, i) => `report line ${i + 1}`).join("\n");
}

describe("renderGetResultLines", () => {
	describe("collapsed", () => {
		it("renders exactly three lines", () => {
			const lines = renderGetResultLines(makeDetails(), longReport(200), false, theme);

			expect(lines).toHaveLength(3);
		});

		it("leads with the status glyph and the dot-joined stats", () => {
			const [first] = renderGetResultLines(makeDetails(), "", false, theme);

			expect(first).toBe(
				"[success:✓] [dim:Explore] [dim:·] [dim:44 tool uses] [dim:·] [dim:95.9k token] [dim:·] [dim:9%] [dim:·] [dim:213.0s]",
			);
		});

		it("renders the description and the preview as sub-lines", () => {
			const lines = renderGetResultLines(makeDetails(), "", false, theme);

			expect(lines[1]).toBe("[dim:  ⎿  Trace Pi tool-result rendering]");
			expect(lines[2]).toBe("[dim:  ⎿  ## Summary]");
		});

		it("omits the compaction glyph when there were no compactions", () => {
			const [first] = renderGetResultLines(makeDetails({ compactionCount: 0 }), "", false, theme);

			expect(first).not.toContain("⇊");
		});

		it("includes the compaction glyph when there were compactions", () => {
			const [first] = renderGetResultLines(makeDetails({ compactionCount: 3 }), "", false, theme);

			expect(first).toContain("[dim:⇊3]");
		});

		it("omits the context percent when it is unknown", () => {
			const [first] = renderGetResultLines(
				makeDetails({ contextPercent: null }),
				"",
				false,
				theme,
			);

			expect(first).not.toContain("%");
		});

		it("shows no preview line when the result carried no text", () => {
			const lines = renderGetResultLines(makeDetails({ preview: undefined }), "", false, theme);

			expect(lines).toHaveLength(2);
		});

		it("shows the error in place of the preview for a failed agent", () => {
			const lines = renderGetResultLines(
				makeDetails({ status: "error", preview: undefined, error: "Out of context" }),
				"",
				false,
				theme,
			);

			expect(lines[0]).toContain("[error:✗]");
			expect(lines[2]).toBe("[error:  ⎿  Out of context]");
		});

		it("never shows the report body, however long", () => {
			const report = `Agent: agent-1\n\n${longReport(200)}`;
			const lines = renderGetResultLines(makeDetails(), report, false, theme);

			expect(lines.join("\n")).not.toContain("report line");
		});

		it("never shows the conversation when verbose was requested", () => {
			const report = `Agent: agent-1\n\n--- Agent Conversation ---\nuser: hello`;
			const lines = renderGetResultLines(makeDetails({ verbose: true }), report, false, theme);

			expect(lines.join("\n")).not.toContain("Agent Conversation");
			expect(lines.join("\n")).not.toContain("user: hello");
		});
	});

	describe("expanded", () => {
		it("renders a short report in full with no indicator", () => {
			const lines = renderGetResultLines(makeDetails(), "one\ntwo\nthree", true, theme);

			expect(lines).toEqual(["[dim:  one]", "[dim:  two]", "[dim:  three]"]);
		});

		it("caps the report body and adds one indicator line", () => {
			const lines = renderGetResultLines(makeDetails(), longReport(200), true, theme);

			expect(lines).toHaveLength(MAX_EXPANDED_LINES + 1);
			expect(lines[MAX_EXPANDED_LINES - 1]).toBe(`[dim:  report line ${MAX_EXPANDED_LINES}]`);
		});

		it("counts the dropped lines in the indicator", () => {
			const lines = renderGetResultLines(makeDetails(), longReport(200), true, theme);

			expect(lines.at(-1)).toContain(`${200 - MAX_EXPANDED_LINES} more lines`);
		});

		it("names the transcript path in the indicator when there is one", () => {
			const lines = renderGetResultLines(
				makeDetails({ transcriptPath: "/sessions/a.jsonl" }),
				longReport(200),
				true,
				theme,
			);

			expect(lines.at(-1)).toContain("/sessions/a.jsonl");
		});

		it("still indicates the overflow when there is no transcript path", () => {
			const lines = renderGetResultLines(
				makeDetails({ transcriptPath: undefined }),
				longReport(200),
				true,
				theme,
			);

			expect(lines.at(-1)).toContain(`${200 - MAX_EXPANDED_LINES} more lines`);
			expect(lines.at(-1)).not.toContain("transcript at");
		});

		it("says the conversation is inside the dropped region when verbose was requested", () => {
			const lines = renderGetResultLines(
				makeDetails({ verbose: true }),
				longReport(200),
				true,
				theme,
			);

			expect(lines.at(-1)).toContain("conversation");
		});

		it("does not mention the conversation when verbose was not requested", () => {
			const lines = renderGetResultLines(makeDetails(), longReport(200), true, theme);

			expect(lines.at(-1)).not.toContain("conversation");
		});
	});

	describe("status glyphs", () => {
		const cases: ReadonlyArray<[SubagentStatus, string]> = [
			["completed", "[success:✓]"],
			["steered", "[warning:✓]"],
			["stopped", "[dim:■]"],
			["error", "[error:✗]"],
			["aborted", "[error:✗]"],
			["queued", "[dim:◦]"],
			["running", "[dim:◍]"],
		];

		it.each(cases)("leads the collapsed line with the %s glyph", (status, expected) => {
			const [first] = renderGetResultLines(makeDetails({ status }), "", false, theme);

			expect(first.startsWith(expected)).toBe(true);
		});
	});
});
