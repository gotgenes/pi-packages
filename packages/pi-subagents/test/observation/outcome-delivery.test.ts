import { describe, expect, it } from "vitest";
import { type OutcomeBody, renderOutcomeBody } from "#src/observation/outcome-delivery";

function makeOutcome(overrides: Partial<OutcomeBody> = {}): OutcomeBody {
	return {
		status: "completed",
		result: "All done.",
		error: undefined,
		stoppedWhileQueued: false,
		...overrides,
	};
}

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
