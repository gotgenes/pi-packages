import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { BoundedLines } from "#src/ui/bounded-lines";

describe("BoundedLines", () => {
	describe("row count", () => {
		it("emits exactly one row per line at every width", () => {
			const lines = ["short", "x".repeat(526), "", "another"];
			const component = new BoundedLines(lines);

			for (const width of [40, 80, 120]) {
				expect(component.render(width)).toHaveLength(lines.length);
			}
		});

		it("emits no rows for no lines", () => {
			expect(new BoundedLines([]).render(80)).toEqual([]);
		});
	});

	describe("clipping", () => {
		it("clips a line far longer than the width to that width", () => {
			const rows = new BoundedLines(["x".repeat(526)]).render(80);

			expect(visibleWidth(rows[0])).toBeLessThanOrEqual(80);
		});

		it("clips by display columns, not code units", () => {
			// Each of these is one code unit wide and two display columns wide, so a
			// code-unit cap of 80 would admit 80 of them and overrun the row.
			const rows = new BoundedLines(["急".repeat(100)]).render(80);

			expect(visibleWidth(rows[0])).toBeLessThanOrEqual(80);
		});

		it("leaves a line narrower than the width untouched", () => {
			expect(new BoundedLines(["short"]).render(80)).toEqual(["short"]);
		});

		it("preserves an empty line as an empty row", () => {
			expect(new BoundedLines(["", "after"]).render(80)).toEqual(["", "after"]);
		});
	});

	describe("embedded newlines", () => {
		// A caller can hand over a string it believes is one line — a thrown Error's
		// multi-line message, a model-supplied description. The terminal would spend a
		// row on each segment, so the row count must not depend on the caller's care.
		it("keeps a line carrying newlines to a single row", () => {
			const rows = new BoundedLines(["first\nsecond\nthird"]).render(80);

			expect(rows).toEqual(["first"]);
		});

		it("still spends one row per line when several carry newlines", () => {
			const rows = new BoundedLines(["a\nb", "c\nd\ne"]).render(80);

			expect(rows).toHaveLength(2);
			expect(rows.join("")).not.toContain("\n");
		});

		it("keeps a carriage return from opening a second row", () => {
			const rows = new BoundedLines(["first\r\nsecond"]).render(80);

			expect(rows.join("")).not.toContain("\n");
		});

		// A VT100-class terminal moves the cursor down a row for a vertical tab and a
		// form feed exactly as it does for a line feed, and both are zero-width, so
		// they survive a width-based clip and cost a row the count does not predict.
		it.each([
			["vertical tab", "\v"],
			["form feed", "\f"],
		])("cuts at a %s, which the terminal obeys like a line feed", (_label, control) => {
			const rows = new BoundedLines([`first${control}second`]).render(80);

			expect(rows).toEqual(["first"]);
		});
	});
});
