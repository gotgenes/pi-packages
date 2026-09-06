import { describe, expect, it } from "vitest";
import type { SubagentStatus } from "#src/lifecycle/subagent-state";
import {
	type OutcomeAddenda,
	type OutcomeBody,
	renderOutcomeAddenda,
	renderOutcomeBody,
	renderQuestionAffordance,
	renderStatusLabel,
	renderStatusNote,
	renderWorkspaceNotice,
} from "#src/observation/outcome-delivery";

function makeOutcome(overrides: Partial<OutcomeBody> = {}): OutcomeBody {
	return {
		status: "completed",
		result: "All done.",
		error: undefined,
		stoppedWhileQueued: false,
		...overrides,
	};
}

describe("status vocabulary", () => {
	// One row, spelled out, before the table below generalizes it.
	it("renders a steered agent in both presentations from the same meaning", () => {
		expect(renderStatusLabel("steered")).toBe("Wrapped up (reached turn limit)");
		expect(renderStatusNote("steered")).toBe(" (wrapped up \u2014 reached turn limit)");
	});

	const rows: { status: SubagentStatus; label: string; note: string }[] = [
		{
			status: "aborted",
			label: "Aborted (max turns exceeded, output may be incomplete)",
			note: " (aborted \u2014 max turns exceeded, output may be incomplete)",
		},
		{
			status: "steered",
			label: "Wrapped up (reached turn limit)",
			note: " (wrapped up \u2014 reached turn limit)",
		},
		{ status: "stopped", label: "Stopped (user request)", note: " (stopped \u2014 user request)" },
		{ status: "completed", label: "Done", note: "" },
		{ status: "running", label: "Done", note: "" },
		{ status: "queued", label: "Done", note: "" },
	];

	for (const row of rows) {
		it(`renders "${row.status}" as label ${JSON.stringify(row.label)}`, () => {
			expect(renderStatusLabel(row.status)).toBe(row.label);
		});

		it(`renders "${row.status}" as note ${JSON.stringify(row.note)}`, () => {
			expect(renderStatusNote(row.status)).toBe(row.note);
		});
	}

	it("names the error in the label form", () => {
		expect(renderStatusLabel("error", "timeout")).toBe("Error: timeout");
	});

	it("reports an unknown error when none was captured", () => {
		expect(renderStatusLabel("error")).toBe("Error: unknown");
	});

	it("adds no note for an error, whose body already carries the message", () => {
		expect(renderStatusNote("error")).toBe("");
	});
});

describe("renderQuestionAffordance", () => {
	it("names the exact resume call that answers the question", () => {
		expect(renderQuestionAffordance("b15f500f-314b-49b", "Which config?")).toBe(
			"\n\nThis agent is waiting on an answer:\n\n  Which config?\n\n" +
				'Answer by calling subagent with resume: "b15f500f-314b-49b" and your answer as the prompt.',
		);
	});

	it("renders nothing when the child asked nothing", () => {
		expect(renderQuestionAffordance("agent-1", undefined)).toBe("");
	});

	it("renders nothing for an empty question", () => {
		expect(renderQuestionAffordance("agent-1", "")).toBe("");
	});

	it("indents every line of a multi-line question", () => {
		expect(renderQuestionAffordance("agent-1", "A or B?\nOr C?")).toContain("  A or B?\n  Or C?");
	});
});

describe("renderWorkspaceNotice", () => {
	it("returns the provider's wording verbatim", () => {
		const notice = "\n\n---\nChanges saved to branch `pi-agent-7`. Merge with: `git merge pi-agent-7`";
		expect(renderWorkspaceNotice(notice)).toBe(notice);
	});

	it("returns an empty string when the teardown reported nothing", () => {
		expect(renderWorkspaceNotice(undefined)).toBe("");
	});
});

describe("renderOutcomeBody", () => {
	it("points a running agent at the wait option instead of reporting an outcome", () => {
		expect(renderOutcomeBody(makeOutcome({ status: "running" }))).toBe(
			"Agent is still running. Use wait: true or check back later.",
		);
	});

	it("reports the error for a failed agent", () => {
		expect(renderOutcomeBody(makeOutcome({ status: "error", error: "boom" }))).toBe("Error: boom");
	});

	it("says no work was performed for an agent stopped while queued", () => {
		expect(
			renderOutcomeBody(makeOutcome({ status: "stopped", stoppedWhileQueued: true, result: undefined })),
		).toBe("Agent was stopped while queued and never started. No work was performed.");
	});

	it("returns the trimmed result for a completed agent", () => {
		expect(renderOutcomeBody(makeOutcome({ result: "  spaced  " }))).toBe("spaced");
	});

	it("falls back to No output when a completed agent produced none", () => {
		expect(renderOutcomeBody(makeOutcome({ result: undefined }))).toBe("No output.");
	});

	it("prefers the running note over a result a running agent has already accumulated", () => {
		expect(renderOutcomeBody(makeOutcome({ status: "running", result: "partial" }))).toBe(
			"Agent is still running. Use wait: true or check back later.",
		);
	});

	it("prefers the error line over the never-started note when both could apply", () => {
		expect(
			renderOutcomeBody(makeOutcome({ status: "error", error: "boom", stoppedWhileQueued: true })),
		).toBe("Error: boom");
	});
});

describe("renderOutcomeAddenda", () => {
	function makeAddenda(overrides: Partial<OutcomeAddenda> = {}): OutcomeAddenda {
		return { id: "agent-1", ...overrides };
	}

	it("renders nothing when the run produced no addenda", () => {
		expect(renderOutcomeAddenda(makeAddenda())).toBe("");
	});

	it("puts where the work went before the call to action that follows it", () => {
		const rendered = renderOutcomeAddenda(
			makeAddenda({
				workspaceNotice: "\n\n---\nChanges saved to branch `pi-agent-1`.",
				pendingQuestion: "Which config?",
			}),
		);

		expect(rendered.indexOf("Changes saved")).toBeLessThan(rendered.indexOf("waiting on an answer"));
	});

	it("composes the same text the carriers built by hand", () => {
		const addenda = makeAddenda({
			workspaceNotice: "\n\n---\nChanges saved to branch `pi-agent-1`.",
			pendingQuestion: "Which config?",
		});

		expect(renderOutcomeAddenda(addenda)).toBe(
			renderWorkspaceNotice(addenda.workspaceNotice) +
				renderQuestionAffordance(addenda.id, addenda.pendingQuestion),
		);
	});
});
