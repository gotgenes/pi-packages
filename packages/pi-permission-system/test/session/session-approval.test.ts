import { describe, expect, it } from "vitest";

import { SessionApproval } from "#src/session/session-approval";

describe("SessionApproval", () => {
  describe("single", () => {
    it("stores one grant pairing the surface with the pattern", () => {
      const approval = SessionApproval.single("bash", "git *");
      expect(approval.grants).toEqual([{ surface: "bash", pattern: "git *" }]);
    });

    it("is recordable", () => {
      const approval = SessionApproval.single("bash", "git *");
      expect(approval.isRecordable).toBe(true);
    });
  });

  describe("forGrants", () => {
    it("stores every grant in order", () => {
      const approval = SessionApproval.forGrants([
        { surface: "external_directory_read", pattern: "/outside/a/*" },
        { surface: "external_directory_write", pattern: "/outside/b/*" },
      ]);
      expect(approval.grants).toEqual([
        { surface: "external_directory_read", pattern: "/outside/a/*" },
        { surface: "external_directory_write", pattern: "/outside/b/*" },
      ]);
    });

    it("keeps a surface per pattern rather than one for all", () => {
      const approval = SessionApproval.forGrants([
        { surface: "external_directory_read", pattern: "/outside/a/*" },
        { surface: "external_directory_write", pattern: "/outside/b/*" },
      ]);
      expect(new Set(approval.grants.map((grant) => grant.surface))).toEqual(
        new Set(["external_directory_read", "external_directory_write"]),
      );
    });

    it("is recordable", () => {
      const approval = SessionApproval.forGrants([
        { surface: "external_directory", pattern: "/outside/a/*" },
      ]);
      expect(approval.isRecordable).toBe(true);
    });

    it("defensive copy — mutating the source array does not affect grants", () => {
      const source = [{ surface: "external_directory", pattern: "/a/*" }];
      const approval = SessionApproval.forGrants(source);
      source.push({ surface: "external_directory", pattern: "/b/*" });
      expect(approval.grants).toEqual([
        { surface: "external_directory", pattern: "/a/*" },
      ]);
    });
  });

  describe("empty grants (degenerate case)", () => {
    it("is not recordable", () => {
      const approval = SessionApproval.forGrants([]);
      expect(approval.isRecordable).toBe(false);
    });
  });

  describe("toForwardedData", () => {
    it("returns the single grant for a single approval", () => {
      const approval = SessionApproval.single("bash", "git *");
      expect(approval.toForwardedData()).toEqual({
        grants: [{ surface: "bash", pattern: "git *" }],
      });
    });

    it("returns every grant, each with its own surface", () => {
      const approval = SessionApproval.forGrants([
        { surface: "external_directory_read", pattern: "/outside/a/*" },
        { surface: "external_directory_write", pattern: "/outside/b/*" },
      ]);
      expect(approval.toForwardedData()).toEqual({
        grants: [
          { surface: "external_directory_read", pattern: "/outside/a/*" },
          { surface: "external_directory_write", pattern: "/outside/b/*" },
        ],
      });
    });

    it("defensive copy — mutating the result grants does not affect the approval", () => {
      const approval = SessionApproval.single("bash", "git *");
      const data = approval.toForwardedData();
      (data.grants as { surface: string; pattern: string }[]).push({
        surface: "bash",
        pattern: "rm *",
      });
      expect(approval.grants).toEqual([{ surface: "bash", pattern: "git *" }]);
    });
  });

  describe("atWidth", () => {
    it("returns itself at the proven width", () => {
      const approval = SessionApproval.single(
        "external_directory_write",
        "/tmp/*",
      );
      expect(approval.atWidth("proven")).toBe(approval);
    });

    it("folds a directional grant to its family at the family width", () => {
      const approval = SessionApproval.single(
        "external_directory_write",
        "/tmp/*",
      );
      expect(approval.atWidth("family").grants).toEqual([
        { surface: "external_directory", pattern: "/tmp/*" },
      ]);
    });

    it("folds every grant individually, keeping each pattern", () => {
      const approval = SessionApproval.forGrants([
        { surface: "external_directory_read", pattern: "/outside/a/*" },
        { surface: "path_write", pattern: "/outside/b/*" },
      ]);
      expect(approval.atWidth("family").grants).toEqual([
        { surface: "external_directory", pattern: "/outside/a/*" },
        { surface: "path", pattern: "/outside/b/*" },
      ]);
    });

    it("leaves a non-directional grant alone at the family width", () => {
      const approval = SessionApproval.single("bash", "git *");
      expect(approval.atWidth("family").grants).toEqual([
        { surface: "bash", pattern: "git *" },
      ]);
    });

    it("does not mutate the approval it widens", () => {
      const approval = SessionApproval.single(
        "external_directory_write",
        "/tmp/*",
      );
      approval.atWidth("family");
      expect(approval.grants).toEqual([
        { surface: "external_directory_write", pattern: "/tmp/*" },
      ]);
    });
  });
});
