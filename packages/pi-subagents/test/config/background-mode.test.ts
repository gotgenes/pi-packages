import { describe, expect, it } from "vitest";
import { type BackgroundRequest, resolveBackgroundMode } from "#src/config/invocation-config";

describe("resolveBackgroundMode", () => {
	describe("an explicit request", () => {
		it("is honored when the agent config declares nothing", () => {
			const request: BackgroundRequest = { kind: "explicit", isBackground: true };
			expect(resolveBackgroundMode({}, request)).toBe(true);
		});

		it("wins over a contradicting agent config", () => {
			const request: BackgroundRequest = { kind: "explicit", isBackground: false };
			expect(resolveBackgroundMode({ runInBackground: true }, request)).toBe(false);
		});

		it("wins over an agreeing agent config too", () => {
			const request: BackgroundRequest = { kind: "explicit", isBackground: true };
			expect(resolveBackgroundMode({ runInBackground: false }, request)).toBe(true);
		});
	});

	describe("a default request", () => {
		it("defers to the agent config when it declares a mode", () => {
			const request: BackgroundRequest = { kind: "default", isBackground: true };
			expect(resolveBackgroundMode({ runInBackground: false }, request)).toBe(false);
		});

		it("defers to an agent config declaring background too", () => {
			const request: BackgroundRequest = { kind: "default", isBackground: false };
			expect(resolveBackgroundMode({ runInBackground: true }, request)).toBe(true);
		});

		it("falls back to its own value when the agent config is silent", () => {
			const request: BackgroundRequest = { kind: "default", isBackground: true };
			expect(resolveBackgroundMode({}, request)).toBe(true);
		});

		it("falls back to its own foreground value when the agent config is silent", () => {
			const request: BackgroundRequest = { kind: "default", isBackground: false };
			expect(resolveBackgroundMode({}, request)).toBe(false);
		});
	});
});
