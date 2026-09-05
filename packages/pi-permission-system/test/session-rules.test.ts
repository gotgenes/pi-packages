import { describe, expect, it } from "vitest";
import { posixPathFlavor } from "#src/path/path-flavor";
import { evaluate } from "#src/policy/rule";
import { SessionApproval } from "#src/session-approval";
import type { SessionApprovalRecorder } from "#src/session-approval-recorder";
import { SessionRules } from "#src/session-rules";

// ── SessionRules ───────────────────────────────────────────────────────────

describe("SessionRules", () => {
  describe("getRuleset", () => {
    it("returns an empty ruleset initially", () => {
      const rules = new SessionRules();
      expect(rules.getRuleset()).toEqual([]);
    });

    it("returns a ruleset containing approved rules", () => {
      const rules = new SessionRules();
      rules.approve("bash", "git *");
      expect(rules.getRuleset()).toEqual([
        {
          surface: "bash",
          pattern: "git *",
          action: "allow",
          layer: "session",
          origin: "session",
        },
      ]);
    });

    it("returns a defensive copy — mutations do not affect internal state", () => {
      const rules = new SessionRules();
      rules.approve("external_directory_read", "/other/project/*");
      const copy = rules.getRuleset();
      copy.push({
        surface: "bash",
        pattern: "*",
        action: "deny",
        origin: "session",
      });
      expect(rules.getRuleset()).toHaveLength(1);
    });

    it("accumulates multiple approved patterns", () => {
      const rules = new SessionRules();
      rules.approve("external_directory_read", "/project-a/*");
      rules.approve("external_directory_read", "/project-b/*");
      expect(rules.getRuleset()).toHaveLength(2);
    });
  });

  describe("directional sugar expansion", () => {
    it("records an approval on a bare family surface as one rule per member", () => {
      const rules = new SessionRules();
      rules.approve("external_directory", "/other/project/*");
      expect(rules.getRuleset()).toEqual([
        {
          surface: "external_directory_read",
          pattern: "/other/project/*",
          action: "allow",
          layer: "session",
          origin: "session",
        },
        {
          surface: "external_directory_write",
          pattern: "/other/project/*",
          action: "allow",
          layer: "session",
          origin: "session",
        },
      ]);
    });

    it("records an approval on a directional surface as a single rule", () => {
      const rules = new SessionRules();
      rules.approve("path_read", "/other/project/*");
      expect(rules.getRuleset()).toEqual([
        {
          surface: "path_read",
          pattern: "/other/project/*",
          action: "allow",
          layer: "session",
          origin: "session",
        },
      ]);
    });

    it("expands a multi-pattern approval on a bare family surface", () => {
      const rules = new SessionRules();
      rules.recordSessionApproval(
        SessionApproval.forGrants([
          { surface: "path", pattern: "/a/*" },
          { surface: "path", pattern: "/b/*" },
        ]),
      );
      expect(
        rules.getRuleset().map(({ surface, pattern }) => [surface, pattern]),
      ).toEqual([
        ["path_read", "/a/*"],
        ["path_write", "/a/*"],
        ["path_read", "/b/*"],
        ["path_write", "/b/*"],
      ]);
    });

    it("covers both directions when evaluated, so an approval is not half-granted", () => {
      const session = new SessionRules();
      session.approve("path", "/other/project/*");
      for (const surface of ["path_read", "path_write"]) {
        expect(
          evaluate(
            surface,
            "/other/project/src/foo.ts",
            session.getRuleset(),
            posixPathFlavor,
          ).action,
        ).toBe("allow");
      }
    });
  });

  describe("clear", () => {
    it("removes all session rules", () => {
      const rules = new SessionRules();
      rules.approve("external_directory_read", "/other/project/*");
      rules.approve("external_directory_read", "/another/path/*");
      rules.clear();
      expect(rules.getRuleset()).toEqual([]);
    });

    it("allows new approvals after clearing", () => {
      const rules = new SessionRules();
      rules.approve("external_directory_read", "/old/path/*");
      rules.clear();
      rules.approve("external_directory_read", "/new/path/*");
      expect(rules.getRuleset()).toHaveLength(1);
      expect(rules.getRuleset()[0].pattern).toBe("/new/path/*");
    });
  });

  describe("recordSessionApproval", () => {
    it("satisfies the SessionApprovalRecorder interface", () => {
      const rules: SessionApprovalRecorder = new SessionRules();
      expect(typeof rules.recordSessionApproval).toBe("function");
    });

    it("records a single-pattern approval as one rule", () => {
      const rules = new SessionRules();
      rules.recordSessionApproval(SessionApproval.single("bash", "git *"));
      expect(rules.getRuleset()).toEqual([
        {
          surface: "bash",
          pattern: "git *",
          action: "allow",
          layer: "session",
          origin: "session",
        },
      ]);
    });

    it("records a multi-pattern approval as one rule per pattern", () => {
      const rules = new SessionRules();
      rules.recordSessionApproval(
        SessionApproval.forGrants([
          { surface: "external_directory_read", pattern: "/outside/a/*" },
          { surface: "external_directory_read", pattern: "/outside/b/*" },
        ]),
      );
      expect(rules.getRuleset()).toHaveLength(2);
      expect(rules.getRuleset()[0].pattern).toBe("/outside/a/*");
      expect(rules.getRuleset()[1].pattern).toBe("/outside/b/*");
    });

    it("records each rule with the correct surface", () => {
      const rules = new SessionRules();
      rules.recordSessionApproval(
        SessionApproval.forGrants([
          { surface: "external_directory_read", pattern: "/outside/a/*" },
          { surface: "external_directory_read", pattern: "/outside/b/*" },
        ]),
      );
      for (const rule of rules.getRuleset()) {
        expect(rule.surface).toBe("external_directory_read");
      }
    });

    it("records each grant on its own surface when they disagree", () => {
      const rules = new SessionRules();
      rules.recordSessionApproval(
        SessionApproval.forGrants([
          { surface: "external_directory_read", pattern: "/outside/*" },
          { surface: "external_directory_write", pattern: "/elsewhere/*" },
        ]),
      );
      expect(
        rules.getRuleset().map(({ surface, pattern }) => [surface, pattern]),
      ).toEqual([
        ["external_directory_read", "/outside/*"],
        ["external_directory_write", "/elsewhere/*"],
      ]);
    });

    it("records nothing for an empty grant list", () => {
      const rules = new SessionRules();
      rules.recordSessionApproval(SessionApproval.forGrants([]));
      expect(rules.getRuleset()).toEqual([]);
    });
  });

  describe("evaluate() integration", () => {
    it("returns allow for a path under an approved directory", () => {
      const session = new SessionRules();
      session.approve("external_directory_read", "/other/project/*");
      const result = evaluate(
        "external_directory_read",
        "/other/project/src/foo.ts",
        session.getRuleset(),
        posixPathFlavor,
      );
      expect(result.action).toBe("allow");
    });

    it("returns ask (default) for a path outside approved directories", () => {
      const session = new SessionRules();
      session.approve("external_directory_read", "/other/project/*");
      const result = evaluate(
        "external_directory_read",
        "/other/unrelated/file.ts",
        session.getRuleset(),
        posixPathFlavor,
      );
      // No rule matches — evaluate returns synthetic rule with default action "ask"
      expect(result.action).toBe("ask");
    });

    it("does not match a sibling directory that shares a string prefix", () => {
      const session = new SessionRules();
      session.approve("external_directory_read", "/other/project/*");
      const result = evaluate(
        "external_directory_read",
        "/other/project-b/foo.ts",
        session.getRuleset(),
        posixPathFlavor,
      );
      expect(result.action).toBe("ask");
    });

    it("matches the directory itself (trailing slash)", () => {
      const session = new SessionRules();
      session.approve("external_directory_read", "/other/project/src/*");
      // The * in wildcardMatch maps to .* which matches zero chars — so /src/ is covered.
      const result = evaluate(
        "external_directory_read",
        "/other/project/src/",
        session.getRuleset(),
        posixPathFlavor,
      );
      expect(result.action).toBe("allow");
    });

    it("handles multiple approved directories", () => {
      const session = new SessionRules();
      session.approve("external_directory_read", "/project-a/*");
      session.approve("external_directory_read", "/project-b/*");
      expect(
        evaluate(
          "external_directory_read",
          "/project-a/foo.ts",
          session.getRuleset(),
          posixPathFlavor,
        ).action,
      ).toBe("allow");
      expect(
        evaluate(
          "external_directory_read",
          "/project-b/bar.ts",
          session.getRuleset(),
          posixPathFlavor,
        ).action,
      ).toBe("allow");
      expect(
        evaluate(
          "external_directory_read",
          "/project-c/baz.ts",
          session.getRuleset(),
          posixPathFlavor,
        ).action,
      ).toBe("ask");
    });

    it("does not match a different surface", () => {
      const session = new SessionRules();
      session.approve("external_directory_read", "/other/project/*");
      const result = evaluate(
        "bash",
        "/other/project/foo.ts",
        session.getRuleset(),
        posixPathFlavor,
      );
      expect(result.action).toBe("ask");
    });

    it("returns allow after clearing and re-approving", () => {
      const session = new SessionRules();
      session.approve("external_directory_read", "/old/project/*");
      session.clear();
      session.approve("external_directory_read", "/new/project/*");
      expect(
        evaluate(
          "external_directory_read",
          "/old/project/file.ts",
          session.getRuleset(),
          posixPathFlavor,
        ).action,
      ).toBe("ask");
      expect(
        evaluate(
          "external_directory_read",
          "/new/project/file.ts",
          session.getRuleset(),
          posixPathFlavor,
        ).action,
      ).toBe("allow");
    });
  });
});
