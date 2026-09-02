import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessPath } from "#src/access-intent/access-path";
import { posixPathFlavor } from "#src/path/path-flavor";
import type { ScopedPermissionManager } from "#src/permission-manager";
import { PermissionResolver } from "#src/permission-resolver";
import type { Ruleset } from "#src/rule";
import { SessionApproval } from "#src/session-approval";
import { SessionRules } from "#src/session-rules";
import type { PermissionState } from "#src/types";
import { makeFakePermissionManager } from "#test/helpers/session-fixtures";

// Alias so the existing tests read naturally.
const makePermissionManager = makeFakePermissionManager;

function makeResolver(
  pm?: ScopedPermissionManager,
  sessionRules?: Pick<SessionRules, "getRuleset">,
) {
  const permissionManager = pm ?? makePermissionManager();
  const rules = sessionRules ?? new SessionRules();
  return {
    resolver: new PermissionResolver(permissionManager, rules),
    permissionManager,
  };
}

beforeEach(() => {
  // no module-level vi.fn() stubs to reset
});

describe("PermissionResolver", () => {
  describe("resolve — tool intent", () => {
    it("forwards a tool intent with the empty session ruleset", () => {
      const { resolver, permissionManager } = makeResolver();

      resolver.resolve({
        kind: "tool",
        surface: "bash",
        input: { command: "ls" },
        agentName: "agent-x",
      });

      expect(permissionManager.check).toHaveBeenCalledWith(
        {
          kind: "tool",
          surface: "bash",
          input: { command: "ls" },
          agentName: "agent-x",
        },
        [],
      );
    });

    it("applies a recorded session approval on the next resolve", () => {
      const pm = makePermissionManager();
      const sessionRules = new SessionRules();
      const { resolver } = makeResolver(pm, sessionRules);

      sessionRules.recordSessionApproval(
        SessionApproval.single("bash", "git *"),
      );
      resolver.resolve({
        kind: "tool",
        surface: "bash",
        input: { command: "git status" },
      });

      const passedRules = vi.mocked(pm.check).mock.calls[0][1];
      expect(passedRules).toHaveLength(1);
      expect(passedRules?.[0]).toMatchObject({
        surface: "bash",
        pattern: "git *",
        action: "allow",
      });
    });

    it("returns the manager's check result", () => {
      const pm = makePermissionManager();
      vi.mocked(pm.check).mockReturnValue({
        state: "deny",
        toolName: "bash",
        source: "bash",
        origin: "global",
        matchedPattern: "rm *",
      });
      const { resolver } = makeResolver(pm);

      const result = resolver.resolve({
        kind: "tool",
        surface: "bash",
        input: { command: "rm -rf /" },
      });

      expect(result).toEqual({
        state: "deny",
        toolName: "bash",
        source: "bash",
        origin: "global",
        matchedPattern: "rm *",
      });
    });
  });

  describe("resolve — session ruleset threading", () => {
    it("applies a recorded session approval on the next call", () => {
      const pm = makePermissionManager();
      const sessionRules = new SessionRules();
      const { resolver } = makeResolver(pm, sessionRules);

      sessionRules.recordSessionApproval(
        SessionApproval.single("path", "src/*"),
      );
      resolver.resolve({
        kind: "access-path",
        surface: "path",
        path: AccessPath.forPath("src/a.ts", {
          cwd: "/proj",
          flavor: posixPathFlavor,
        }),
      });

      // The approval expanded into both directional members at record time.
      const passedRules = vi.mocked(pm.check).mock.calls[0][1];
      expect(passedRules).toEqual([
        {
          surface: "path_read",
          pattern: "src/*",
          action: "allow",
          layer: "session",
          origin: "session",
        },
        {
          surface: "path_write",
          pattern: "src/*",
          action: "allow",
          layer: "session",
          origin: "session",
        },
      ]);
    });
  });

  describe("resolve — access-path intent", () => {
    it("unwraps the AccessPath via matchValues() into a path-values intent", () => {
      const { resolver, permissionManager } = makeResolver();
      const accessPath = AccessPath.forPath("/tmp/x", {
        cwd: "/workspace",
        flavor: posixPathFlavor,
      });

      resolver.resolve({
        kind: "access-path",
        surface: "external_directory",
        path: accessPath,
        agentName: "agent-x",
      });

      // The family folds, so each member sees the same unwrapped values.
      expect(
        vi.mocked(permissionManager.check).mock.calls.map(([intent]) => intent),
      ).toEqual([
        {
          kind: "path-values",
          surface: "external_directory_read",
          values: accessPath.matchValues(),
          agentName: "agent-x",
        },
        {
          kind: "path-values",
          surface: "external_directory_write",
          values: accessPath.matchValues(),
          agentName: "agent-x",
        },
      ]);
    });

    it("returns the manager's check result for an access-path intent", () => {
      const pm = makePermissionManager();
      vi.mocked(pm.check).mockReturnValue({
        state: "deny",
        toolName: "external_directory",
        source: "special",
        origin: "global",
        matchedPattern: "/tmp/*",
      });
      const { resolver } = makeResolver(pm);
      const accessPath = AccessPath.forPath("/tmp/x", {
        cwd: "/workspace",
        flavor: posixPathFlavor,
      });

      const result = resolver.resolve({
        kind: "access-path",
        surface: "external_directory",
        path: accessPath,
      });

      expect(result.state).toBe("deny");
      expect(result.matchedPattern).toBe("/tmp/*");
    });
  });

  describe("resolve — pre-fixed path-values intent (forwarded-serving producer)", () => {
    // #597: the forwarded-serving wire hands the resolver a ResolvedAccessIntent
    // it built directly from the child-fixed matchValues() — never an
    // AccessPath. The resolver must pass it through to the manager unchanged
    // (no matchValues() unwrap, since there is no AccessPath to unwrap).
    it("passes a path-values intent to the manager unchanged, with the composed session ruleset", () => {
      const pm = makePermissionManager();
      const sessionRules = new SessionRules();
      const { resolver } = makeResolver(pm, sessionRules);

      sessionRules.recordSessionApproval(
        SessionApproval.single("external_directory", "/tmp/*"),
      );

      resolver.resolve({
        kind: "path-values",
        surface: "external_directory",
        values: ["/tmp/x", "/real/tmp/x"],
        agentName: "Explore",
      });

      // Values and agentName pass through untouched; only the surface varies,
      // one call per directional member of the family.
      const [passedIntent, passedRules] = vi.mocked(pm.check).mock.calls[0];
      expect(passedIntent).toEqual({
        kind: "path-values",
        surface: "external_directory_read",
        values: ["/tmp/x", "/real/tmp/x"],
        agentName: "Explore",
      });
      expect(
        passedRules?.map(({ surface, pattern, action }) => ({
          surface,
          pattern,
          action,
        })),
      ).toEqual([
        {
          surface: "external_directory_read",
          pattern: "/tmp/*",
          action: "allow",
        },
        {
          surface: "external_directory_write",
          pattern: "/tmp/*",
          action: "allow",
        },
      ]);
    });

    it("returns the manager's check result for a path-values intent", () => {
      const pm = makePermissionManager();
      vi.mocked(pm.check).mockReturnValue({
        state: "allow",
        toolName: "path",
        source: "special",
        origin: "global",
        matchedPattern: "src/**",
      });
      const { resolver } = makeResolver(pm);

      const result = resolver.resolve({
        kind: "path-values",
        surface: "path",
        values: ["/worktree/issue-42/src/foo.ts", "src/foo.ts"],
        agentName: "Explore",
      });

      expect(result.state).toBe("allow");
      expect(result.matchedPattern).toBe("src/**");
    });
  });

  describe("checkPermission (raw, off-interface)", () => {
    it("delegates to manager.check as a tool intent without session rules", () => {
      const { resolver, permissionManager } = makeResolver();

      resolver.checkPermission("bash", { command: "ls" }, "agent-1");

      expect(permissionManager.check).toHaveBeenCalledWith(
        {
          kind: "tool",
          surface: "bash",
          input: { command: "ls" },
          agentName: "agent-1",
        },
        undefined,
      );
    });

    it("passes optional sessionRules as the second arg to check", () => {
      const { resolver, permissionManager } = makeResolver();
      const extraRules: Ruleset = [
        { surface: "bash", pattern: "*", action: "allow", origin: "session" },
      ];

      resolver.checkPermission(
        "bash",
        { command: "ls" },
        undefined,
        extraRules,
      );

      expect(permissionManager.check).toHaveBeenCalledWith(
        {
          kind: "tool",
          surface: "bash",
          input: { command: "ls" },
          agentName: undefined,
        },
        extraRules,
      );
    });
  });

  describe("getToolPermission", () => {
    it("delegates to permissionManager.getToolPermission", () => {
      const pm = makePermissionManager();
      vi.mocked(pm.getToolPermission).mockReturnValue("deny");
      const { resolver } = makeResolver(pm);

      const result = resolver.getToolPermission("write", "my-agent");

      expect(pm.getToolPermission).toHaveBeenCalledWith("write", "my-agent");
      expect(result).toBe("deny");
    });
  });

  describe("isToolFullyDenied", () => {
    it("delegates to permissionManager.isToolFullyDenied", () => {
      const pm = makePermissionManager();
      vi.mocked(pm.isToolFullyDenied).mockReturnValue(true);
      const { resolver } = makeResolver(pm);

      const result = resolver.isToolFullyDenied("write", "my-agent");

      expect(pm.isToolFullyDenied).toHaveBeenCalledWith("write", "my-agent");
      expect(result).toBe(true);
    });
  });

  describe("resolve — surface-family fold", () => {
    /** A manager whose verdict is keyed by the surface it is asked about. */
    function makeSurfaceKeyedManager(
      bySurface: Record<string, PermissionState>,
    ) {
      const pm = makePermissionManager();
      vi.mocked(pm.check).mockImplementation((intent) => ({
        state: bySurface[intent.surface] ?? "ask",
        toolName: intent.surface,
        source: "special",
        origin: "global",
        matchedPattern: `${intent.surface}-pattern`,
      }));
      return pm;
    }

    it("consults both directional members for a bare family surface", () => {
      const pm = makeSurfaceKeyedManager({ path_read: "allow" });
      const { resolver } = makeResolver(pm);

      resolver.resolve({
        kind: "access-path",
        surface: "path",
        path: AccessPath.forPath("/tmp/x", {
          cwd: "/workspace",
          flavor: posixPathFlavor,
        }),
        agentName: "agent-x",
      });

      expect(vi.mocked(pm.check).mock.calls.map(([i]) => i.surface)).toEqual([
        "path_read",
        "path_write",
      ]);
    });

    it("returns the losing member's own result, so blame names the surface that decided", () => {
      const pm = makeSurfaceKeyedManager({
        path_read: "allow",
        path_write: "deny",
      });
      const { resolver } = makeResolver(pm);

      const result = resolver.resolve({
        kind: "access-path",
        surface: "path",
        path: AccessPath.forPath("/tmp/x", {
          cwd: "/workspace",
          flavor: posixPathFlavor,
        }),
      });

      expect(result).toEqual({
        state: "deny",
        toolName: "path_write",
        source: "special",
        origin: "global",
        matchedPattern: "path_write-pattern",
      });
    });

    it("never masks a deny into an approvable ask (#712)", () => {
      const pm = makeSurfaceKeyedManager({
        external_directory_read: "deny",
        external_directory_write: "allow",
      });
      const { resolver } = makeResolver(pm);

      const result = resolver.resolve({
        kind: "path-values",
        surface: "external_directory",
        values: ["/tmp/x"],
        agentName: "agent-x",
      });

      expect(result.state).toBe("deny");
      expect(result.toolName).toBe("external_directory_read");
    });

    it("keeps the read member on a tie, per the members' normative order", () => {
      const pm = makeSurfaceKeyedManager({
        path_read: "ask",
        path_write: "ask",
      });
      const { resolver } = makeResolver(pm);

      const result = resolver.resolve({
        kind: "path-values",
        surface: "path",
        values: ["/tmp/x"],
      });

      expect(result.toolName).toBe("path_read");
    });

    it("does not synthesize a matchedPattern when neither member matched (#58)", () => {
      const pm = makePermissionManager();
      vi.mocked(pm.check).mockImplementation((intent) => ({
        state: "ask",
        toolName: intent.surface,
        source: "special",
        origin: "builtin",
      }));
      const { resolver } = makeResolver(pm);

      const result = resolver.resolve({
        kind: "path-values",
        surface: "path",
        values: ["/tmp/x"],
      });

      expect(result.matchedPattern).toBeUndefined();
    });

    it("passes the session ruleset to every member query", () => {
      const pm = makeSurfaceKeyedManager({});
      const sessionRules = new SessionRules();
      const { resolver } = makeResolver(pm, sessionRules);
      sessionRules.approve("path", "/tmp/*");

      resolver.resolve({
        kind: "path-values",
        surface: "path",
        values: ["/tmp/x"],
      });

      const rulesets = vi.mocked(pm.check).mock.calls.map(([, r]) => r);
      expect(rulesets).toHaveLength(2);
      expect(rulesets[0]).toEqual(rulesets[1]);
      expect(rulesets[0]).toHaveLength(2);
    });

    it("does not fold a directional surface — it names one member already", () => {
      const pm = makeSurfaceKeyedManager({ path_read: "allow" });
      const { resolver } = makeResolver(pm);

      const result = resolver.resolve({
        kind: "path-values",
        surface: "path_read",
        values: ["/tmp/x"],
      });

      expect(vi.mocked(pm.check)).toHaveBeenCalledTimes(1);
      expect(result.state).toBe("allow");
    });

    it("does not fold a non-path surface", () => {
      const pm = makeSurfaceKeyedManager({ bash: "allow" });
      const { resolver } = makeResolver(pm);

      resolver.resolve({
        kind: "tool",
        surface: "bash",
        input: { command: "ls" },
      });

      expect(vi.mocked(pm.check)).toHaveBeenCalledTimes(1);
    });
  });

  describe("getConfigIssues", () => {
    it("delegates to permissionManager.getConfigIssues", () => {
      const pm = makePermissionManager();
      vi.mocked(pm.getConfigIssues).mockReturnValue(["issue-1"]);
      const { resolver } = makeResolver(pm);

      const result = resolver.getConfigIssues("agent-1");

      expect(pm.getConfigIssues).toHaveBeenCalledWith("agent-1");
      expect(result).toEqual(["issue-1"]);
    });
  });
});
