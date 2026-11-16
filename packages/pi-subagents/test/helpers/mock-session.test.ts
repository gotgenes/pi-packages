import { describe, expect, it, vi } from "vitest";
import { createMockSession, emitResumeUsageAndCompaction } from "./mock-session";

describe("createMockSession", () => {
	it("broadcasts emit to all active subscribers", () => {
		const session = createMockSession();
		const events: unknown[] = [];
		session.subscribe((e) => events.push(e));
		session.emit({ type: "test" });
		expect(events).toEqual([{ type: "test" }]);
	});

	it("supports multiple concurrent subscribers", () => {
		const session = createMockSession();
		const a: unknown[] = [];
		const b: unknown[] = [];
		session.subscribe((e) => a.push(e));
		session.subscribe((e) => b.push(e));
		session.emit({ type: "ping" });
		expect(a).toEqual([{ type: "ping" }]);
		expect(b).toEqual([{ type: "ping" }]);
	});

	it("unsubscribes when the returned disposer is called", () => {
		const session = createMockSession();
		const events: unknown[] = [];
		const unsubscribe = session.subscribe((e) => events.push(e));
		session.emit({ type: "before" });
		unsubscribe();
		session.emit({ type: "after" });
		expect(events).toEqual([{ type: "before" }]);
	});

	it("counts only the subscriptions still live", () => {
		const session = createMockSession();
		const unsubscribe = session.subscribe(() => {});
		session.subscribe(() => {});
		unsubscribe();
		expect(session.listenerCount()).toBe(1);
	});

	it("subscribe is a vi.fn spy", () => {
		const session = createMockSession();
		const fn = vi.fn();
		session.subscribe(fn);
		expect(session.subscribe).toHaveBeenCalledOnce();
	});

	it("dispose is a vi.fn stub", () => {
		const session = createMockSession();
		session.dispose();
		expect(session.dispose).toHaveBeenCalledOnce();
	});

	it("steer is a vi.fn stub that resolves to undefined by default", async () => {
		const session = createMockSession();
		const result = await session.steer("hello");
		expect(result).toBeUndefined();
		expect(session.steer).toHaveBeenCalledWith("hello");
	});

	it("reports that the child has extension handlers by default", () => {
		const session = createMockSession();
		expect(session.hasExtensionHandlers("session_shutdown")).toBe(true);
	});

	it("extensionRunner.emit is a vi.fn stub that resolves to undefined", async () => {
		const session = createMockSession();
		const event = { type: "session_shutdown", reason: "quit" };
		const result = await session.extensionRunner.emit(event);
		expect(result).toBeUndefined();
		expect(session.extensionRunner.emit).toHaveBeenCalledWith(event);
	});

	it("sessionManager.getSessionFile is a vi.fn stub", () => {
		const session = createMockSession();
		session.sessionManager.getSessionFile();
		expect(session.sessionManager.getSessionFile).toHaveBeenCalledOnce();
	});

	it("accepts overrides that replace default fields", async () => {
		const err = new Error("fail");
		const session = createMockSession({
			steer: vi.fn().mockRejectedValue(err),
		});
		await expect(session.steer("x")).rejects.toThrow("fail");
	});

	it("accepts overrides that add extra fields", () => {
		const session = createMockSession({ extra: "value" });
		expect((session as Record<string, unknown>).extra).toBe("value");
	});
});

describe("emitResumeUsageAndCompaction", () => {
	it("emits a usage message_end then a compaction_end with the standard payloads", () => {
		const session = createMockSession();
		const events: unknown[] = [];
		session.subscribe((e) => events.push(e));
		emitResumeUsageAndCompaction(session);
		expect(events).toEqual([
			{ type: "message_end", message: { role: "assistant", usage: { input: 70, output: 30, cacheWrite: 5 } } },
			{ type: "compaction_end", aborted: false, result: { tokensBefore: 999 }, reason: "overflow" },
		]);
	});
});
