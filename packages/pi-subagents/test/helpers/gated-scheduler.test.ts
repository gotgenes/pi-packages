import { describe, expect, it } from "vitest";
import { gatedScheduler } from "#test/helpers/gated-scheduler";

describe("gatedScheduler", () => {
	it("does not run the thunk before openSlot()", async () => {
		const gated = gatedScheduler();
		let ran = false;

		void gated.schedule(async () => {
			ran = true;
		});
		await Promise.resolve();
		await Promise.resolve();

		expect(ran).toBe(false);
	});

	it("settles the scheduled promise with the thunk once the slot opens", async () => {
		const gated = gatedScheduler();
		const order: string[] = [];

		const scheduled = gated.schedule(async () => {
			order.push("thunk");
		});
		gated.openSlot();
		await scheduled;

		expect(order).toEqual(["thunk"]);
	});
});
