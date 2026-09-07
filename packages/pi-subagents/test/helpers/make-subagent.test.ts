import { describe, expect, it } from "vitest";
import { createTestSubagent } from "./make-subagent";

describe("createTestSubagent", () => {
	describe("live-activity shorthands", () => {
		it("defaults turnCount to 1", () => {
			const record = createTestSubagent();
			expect(record.turnCount).toBe(1);
		});

		it("sets turnCount to the requested value", () => {
			const record = createTestSubagent({ turnCount: 4 });
			expect(record.turnCount).toBe(4);
		});

		it("defaults activeTools to an empty map", () => {
			const record = createTestSubagent();
			expect(record.activeTools.size).toBe(0);
		});

		it("seeds active tools by name", () => {
			const record = createTestSubagent({ activeTools: ["read", "grep"] });
			expect(record.activeTools.size).toBe(2);
			expect([...record.activeTools.values()]).toEqual(["read", "grep"]);
		});

		it("defaults responseText to empty string", () => {
			const record = createTestSubagent();
			expect(record.responseText).toBe("");
		});

		it("seeds responseText", () => {
			const record = createTestSubagent({ responseText: "thinking…" });
			expect(record.responseText).toBe("thinking…");
		});

		it("defaults maxTurns to undefined", () => {
			const record = createTestSubagent();
			expect(record.maxTurns).toBeUndefined();
		});

		it("threads maxTurns into the stub execution", () => {
			const record = createTestSubagent({ maxTurns: 10 });
			expect(record.maxTurns).toBe(10);
		});
	});

	describe("session readiness", () => {
		it("builds a record with no session by default", () => {
			expect(createTestSubagent().isSessionReady()).toBe(false);
		});

		it("attaches a session stub when sessionReady is requested", () => {
			expect(createTestSubagent({ sessionReady: true }).isSessionReady()).toBe(true);
		});
	});

	it("returns a completed agent with expected defaults", () => {
		const record = createTestSubagent();
		expect(record.id).toBe("agent-1");
		expect(record.type).toBe("general-purpose");
		expect(record.description).toBe("Test task");
		expect(record.status).toBe("completed");
		expect(record.result).toBe("All done.");
		expect(record.toolUses).toBe(3);
		expect(record.startedAt).toBe(1000);
		expect(record.completedAt).toBe(2000);
		expect(record.compactionCount).toBe(0);
		expect(record.lifetimeUsage).toEqual({ input: 500, output: 500, cacheWrite: 0 });
	});

	it("applies overrides to defaults", () => {
		const record = createTestSubagent({ id: "custom-id", status: "running" });
		expect(record.id).toBe("custom-id");
		expect(record.status).toBe("running");
		// Non-overridden fields retain defaults
		expect(record.description).toBe("Test task");
		expect(record.toolUses).toBe(3);
	});

	it("exposes promise via getter after start() is called", async () => {
		const record = createTestSubagent({ status: "running", completedAt: undefined });
		expect(record.promise).toBeUndefined();
		record.start();
		expect(record.promise).toBeInstanceOf(Promise);
		await record.promise;
	});

	it("allows overriding defaults to undefined", () => {
		const record = createTestSubagent({ result: undefined, completedAt: undefined });
		expect(record.result).toBeUndefined();
		expect(record.completedAt).toBeUndefined();
	});
});
