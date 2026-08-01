import { describe, expect, it } from "vitest";

import { SessionApproval } from "#src/session-approval";

describe("SessionApproval", () => {
  describe("single", () => {
    it("stores surface and one pattern", () => {
      const approval = SessionApproval.single("bash", "git *");
      expect(approval.surface).toBe("bash");
      expect(approval.patterns).toEqual(["git *"]);
    });

    it("representativePattern returns the pattern", () => {
      const approval = SessionApproval.single("bash", "git *");
      expect(approval.representativePattern).toBe("git *");
    });

    it("toGateApproval returns the complete proposal", () => {
      const approval = SessionApproval.single("bash", "git *");
      expect(approval.toGateApproval()).toEqual({
        surface: "bash",
        patterns: ["git *"],
      });
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

    it("representativePattern returns the first pattern", () => {
      const approval = SessionApproval.multiple("external_directory", [
        "/outside/a/*",
        "/outside/b/*",
      ]);
      expect(approval.representativePattern).toBe("/outside/a/*");
    });

    it("toGateApproval returns every pattern", () => {
      const approval = SessionApproval.multiple("external_directory", [
        "/outside/a/*",
        "/outside/b/*",
      ]);
      expect(approval.toGateApproval()).toEqual({
        surface: "external_directory",
        patterns: ["/outside/a/*", "/outside/b/*"],
      });
    });

    it("toGateApproval returns a defensive copy", () => {
      const approval = SessionApproval.multiple("external_directory", [
        "/outside/a/*",
        "/outside/b/*",
      ]);
      const gateApproval = approval.toGateApproval();
      (gateApproval?.patterns as string[]).push("/outside/c/*");

      expect(approval.patterns).toEqual(["/outside/a/*", "/outside/b/*"]);
    });

    it("defensive copy — mutating the source array does not affect patterns", () => {
      const source = ["/outside/a/*", "/outside/b/*"];
      const approval = SessionApproval.multiple("external_directory", source);
      source.push("/outside/c/*");
      expect(approval.patterns).toEqual(["/outside/a/*", "/outside/b/*"]);
    });
  });

  describe("empty patterns (degenerate case)", () => {
    it("representativePattern returns undefined", () => {
      const approval = SessionApproval.multiple("external_directory", []);
      expect(approval.representativePattern).toBeUndefined();
    });

    it("toGateApproval returns undefined", () => {
      const approval = SessionApproval.multiple("external_directory", []);
      expect(approval.toGateApproval()).toBeUndefined();
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
