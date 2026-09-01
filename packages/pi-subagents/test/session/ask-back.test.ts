import { describe, expect, it } from "vitest";
import { ASK_BACK_PROTOCOL, parseQuestionForParent } from "#src/session/ask-back";

describe("parseQuestionForParent", () => {
	describe("no question", () => {
		it("leaves a plain result untouched", () => {
			const result = parseQuestionForParent("All done. I refactored the parser.");
			expect(result).toEqual({ question: undefined, body: "All done. I refactored the parser." });
		});

		it("returns undefined for an empty result", () => {
			expect(parseQuestionForParent("")).toEqual({ question: undefined, body: "" });
		});

		it("ignores an unclosed opening tag", () => {
			const text = "I need help.\n<question-for-parent>\nWhich file?";
			expect(parseQuestionForParent(text)).toEqual({ question: undefined, body: text });
		});

		it("ignores a closing tag with no opening tag", () => {
			const text = "Stray </question-for-parent> marker.";
			expect(parseQuestionForParent(text)).toEqual({ question: undefined, body: text });
		});

		it("ignores an empty block", () => {
			const text = "Nothing to ask.\n<question-for-parent></question-for-parent>";
			expect(parseQuestionForParent(text)).toEqual({ question: undefined, body: text });
		});

		it("ignores a whitespace-only block", () => {
			const text = "Nothing to ask.\n<question-for-parent>\n   \n\t\n</question-for-parent>";
			expect(parseQuestionForParent(text)).toEqual({ question: undefined, body: text });
		});
	});

	describe("a declared question", () => {
		it("extracts the question and strips the block from the body", () => {
			const { question, body } = parseQuestionForParent(
				"I got stuck.\n\n<question-for-parent>\nWhich config file is authoritative?\n</question-for-parent>",
			);
			expect(question).toBe("Which config file is authoritative?");
			expect(body).toBe("I got stuck.");
		});

		it("keeps prose that follows the block", () => {
			const { question, body } = parseQuestionForParent(
				"Before.\n<question-for-parent>\nWhich one?\n</question-for-parent>\nAfter.",
			);
			expect(question).toBe("Which one?");
			expect(body).toBe("Before.\nAfter.");
		});

		it("handles a block on a single line", () => {
			const { question, body } = parseQuestionForParent(
				"Done.\n<question-for-parent>Which one?</question-for-parent>",
			);
			expect(question).toBe("Which one?");
			expect(body).toBe("Done.");
		});

		it("preserves internal angle brackets in the question", () => {
			const { question } = parseQuestionForParent(
				"<question-for-parent>\nShould I use Array<string> or string[]?\n</question-for-parent>",
			);
			expect(question).toBe("Should I use Array<string> or string[]?");
		});

		it("preserves internal newlines in a multi-line question", () => {
			const { question } = parseQuestionForParent(
				"<question-for-parent>\nWhich one?\n\nA or B?\n</question-for-parent>",
			);
			expect(question).toBe("Which one?\n\nA or B?");
		});

		it("takes the last block when the child reasons before asking", () => {
			const { question } = parseQuestionForParent(
				"<question-for-parent>\nFirst draft.\n</question-for-parent>\n" +
					"On reflection:\n<question-for-parent>\nThe real question.\n</question-for-parent>",
			);
			expect(question).toBe("The real question.");
		});

		it("handles CRLF line endings", () => {
			const { question, body } = parseQuestionForParent(
				"Stuck.\r\n<question-for-parent>\r\nWhich one?\r\n</question-for-parent>",
			);
			expect(question).toBe("Which one?");
			expect(body).toBe("Stuck.");
		});
	});

	describe("inline code spans are not markers", () => {
		it("ignores a marker quoted inline mid-sentence", () => {
			const text = "I could have used a `<question-for-parent>` block, but I worked it out.";
			expect(parseQuestionForParent(text)).toEqual({ question: undefined, body: text });
		});

		it("does not pair an inline open tag with a later fenced close tag", () => {
			const text =
				"The `<question-for-parent>` tag is closed like this:\n\n```text\n</question-for-parent>\n```";
			expect(parseQuestionForParent(text)).toEqual({ question: undefined, body: text });
		});

		it("takes a real question that follows an inline mention", () => {
			const { question } = parseQuestionForParent(
				"I know about `<question-for-parent>` blocks.\n\n" +
					"<question-for-parent>\nSo which config?\n</question-for-parent>",
			);
			expect(question).toBe("So which config?");
		});

		it("leaves an unmatched backtick from swallowing a real question", () => {
			const { question } = parseQuestionForParent(
				"An unclosed ` backtick here.\n<question-for-parent>\nWhich one?\n</question-for-parent>",
			);
			expect(question).toBe("Which one?");
		});
	});

	describe("fenced regions are not markers", () => {
		it("ignores a block inside a three-backtick fence", () => {
			const text =
				"Here is the protocol:\n\n```text\n<question-for-parent>\nExample only.\n</question-for-parent>\n```";
			expect(parseQuestionForParent(text)).toEqual({ question: undefined, body: text });
		});

		it("ignores a block inside a four-backtick fence", () => {
			const text =
				"Nested example:\n\n````markdown\n```text\n<question-for-parent>\nExample only.\n</question-for-parent>\n```\n````";
			expect(parseQuestionForParent(text)).toEqual({ question: undefined, body: text });
		});

		it("ignores a block inside a tilde fence", () => {
			const text = "Example:\n\n~~~text\n<question-for-parent>\nExample only.\n</question-for-parent>\n~~~";
			expect(parseQuestionForParent(text)).toEqual({ question: undefined, body: text });
		});

		it("takes a real question that follows a fenced example", () => {
			const { question, body } = parseQuestionForParent(
				"The protocol looks like:\n\n```text\n<question-for-parent>\nExample.\n</question-for-parent>\n```\n\n" +
					"<question-for-parent>\nMy actual question.\n</question-for-parent>",
			);
			expect(question).toBe("My actual question.");
			expect(body).toContain("```text");
			expect(body).toContain("Example.");
			expect(body).not.toContain("My actual question.");
		});
	});

	describe("scales linearly with quoted mentions", () => {
		it("parses a document carrying tens of thousands of inline-quoted mentions", () => {
			// Every mention is a candidate the scan must skip. Searching the quoted
			// ranges per candidate was quadratic here: ~2.4s at this size, against
			// tens of milliseconds once the scan advances a cursor instead.
			const noise = Array.from(
				{ length: 50_000 },
				(_, i) => `Line ${i} mentions a \`<question-for-parent>\` tag.`,
			).join("\n");
			const text = `${noise}\n<question-for-parent>\nThe real one?\n</question-for-parent>`;

			const startedAt = performance.now();
			const { question } = parseQuestionForParent(text);
			const elapsedMs = performance.now() - startedAt;

			expect(question).toBe("The real one?");
			// Generous against CI jitter while still failing the quadratic scan.
			expect(elapsedMs).toBeLessThan(1000);
		});
	});

	describe("the protocol block taught to the child", () => {
		it("names the marker the parser looks for", () => {
			expect(ASK_BACK_PROTOCOL).toContain("<question-for-parent>");
			expect(ASK_BACK_PROTOCOL).toContain("</question-for-parent>");
		});

		it("survives its own round trip: the example inside it is not parsed as a question", () => {
			// The protocol block shows the marker verbatim. If a child echoed it back,
			// the parser must not mistake the instructions for an actual question.
			const { question } = parseQuestionForParent(ASK_BACK_PROTOCOL);
			expect(question).toBeUndefined();
		});
	});
});
