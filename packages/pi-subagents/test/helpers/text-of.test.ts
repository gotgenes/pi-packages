import { describe, expect, it } from "vitest";
import { textOf } from "#test/helpers/text-of";

describe("textOf", () => {
	it("returns the text of a tool result's first content item", () => {
		expect(textOf({ content: [{ type: "text", text: "Agent: a-1" }] })).toBe("Agent: a-1");
	});

	it("throws when the result carries no content", () => {
		expect(() => textOf({ content: [] })).toThrow("expected a text content item, got none");
	});

	it("throws when the first content item is not text", () => {
		expect(() => textOf({ content: [{ type: "image" }] })).toThrow("expected a text content item, got image");
	});
});
