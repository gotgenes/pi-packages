import { describe, expect, it, vi } from "vitest";
import { AskParentTool } from "#src/session/ask-parent-tool";
import { STUB_CTX } from "#test/helpers/stub-ctx";

function execute(record: (question: string) => void, question: string) {
	const tool = new AskParentTool(record);
	return tool.execute("tc-1", { question }, new AbortController().signal, undefined, STUB_CTX);
}

describe("AskParentTool", () => {
	describe("the definition the child session receives", () => {
		it("is named ask_parent", () => {
			expect(new AskParentTool(vi.fn()).toToolDefinition().name).toBe("ask_parent");
		});

		it("carries a prompt snippet naming the end-your-turn contract", () => {
			expect(new AskParentTool(vi.fn()).toToolDefinition().promptSnippet).toBe(
				"Ask the delegating agent a question, then end your turn.",
			);
		});
	});

	describe("recording a question", () => {
		it("hands the question to the recorder verbatim", () => {
			const record = vi.fn<(question: string) => void>();

			execute(record, "Which of the three config files is authoritative?");

			expect(record).toHaveBeenCalledWith("Which of the three config files is authoritative?");
		});

		it("tells the child to end its turn and how the answer arrives", () => {
			const result = execute(vi.fn(), "Which config wins?");

			expect(result.content).toEqual([
				{
					type: "text",
					text:
						"Question recorded for the delegating agent. End your turn now — it will answer by resuming you, and you will continue with your context intact.",
				},
			]);
		});
	});
});
