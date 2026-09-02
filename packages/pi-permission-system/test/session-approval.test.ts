import { describe, expect, it } from "vitest";

import { SessionApproval } from "#src/session-approval";

describe("SessionApproval", () => {
  describe("single", () => {
    it("stores surface and one pattern", () => {
      const approval = SessionApproval.single("bash", "git *");
      expect(approval.surface).toBe("bash");
      expect(approval.patterns).toEqual(["git *"]);
    });

    it("is recordable", () => {
      const approval = SessionApproval.single("bash", "git *");
      expect(approval.isRecordable).toBe(true);
    });
  });

  describe("multiple", () => {
    it("stores surface and all patterns", () => {
      const approval = SessionApproval.multiple("external_directory", [
        "/outside/a/*",
        "/outside/b/*",
      ]);
      expect(approval.surface).toBe("external_directory");
      expect(approval.patterns).toEqual(["/outside/a/*", "/outside/b/*"]);
    });

    it("is recordable", () => {
      const approval = SessionApproval.multiple("external_directory", [
        "/outside/a/*",
        "/outside/b/*",
      ]);
      expect(approval.isRecordable).toBe(true);
    });

    it("defensive copy — mutating the source array does not affect patterns", () => {
      const source = ["/outside/a/*", "/outside/b/*"];
      const approval = SessionApproval.multiple("external_directory", source);
      source.push("/outside/c/*");
      expect(approval.patterns).toEqual(["/outside/a/*", "/outside/b/*"]);
    });
  });

  describe("empty patterns (degenerate case)", () => {
    it("is not recordable", () => {
      const approval = SessionApproval.multiple("external_directory", []);
      expect(approval.isRecordable).toBe(false);
    });
  });

  describe("toForwardedData", () => {
    it("returns surface and all patterns for a single approval", () => {
      const approval = SessionApproval.single("bash", "git *");
      expect(approval.toForwardedData()).toEqual({
        surface: "bash",
        patterns: ["git *"],
      });
    });

    it("returns surface and all patterns for a multiple approval", () => {
      const approval = SessionApproval.multiple("external_directory", [
        "/outside/a/*",
        "/outside/b/*",
      ]);
      expect(approval.toForwardedData()).toEqual({
        surface: "external_directory",
        patterns: ["/outside/a/*", "/outside/b/*"],
      });
    });

    it("defensive copy — mutating the result patterns does not affect the approval", () => {
      const approval = SessionApproval.single("bash", "git *");
      const data = approval.toForwardedData();
      (data.patterns as string[]).push("rm *");
      expect(approval.patterns).toEqual(["git *"]);
    });
  });
});
