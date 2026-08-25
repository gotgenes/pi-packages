import { describe, expect, it } from "vitest";
import { AccessPath } from "#src/access-intent/access-path";
import {
  resolveExternalDirectoryPolicy,
  selectUncoveredExternalPaths,
} from "#src/handlers/gates/external-directory-policy";
import { posixPathFlavor } from "#src/path/path-flavor";
import type { PermissionCheckResult } from "#src/types";

import { makeResolver } from "#test/helpers/gate-fixtures";

const cwd = "/test/project";

function makeCheckResult(
  state: "allow" | "deny" | "ask",
  overrides: Partial<PermissionCheckResult> = {},
): PermissionCheckResult {
  return {
    state,
    toolName: "external_directory",
    source: "special",
    origin: "builtin",
    ...overrides,
  };
}

describe("resolveExternalDirectoryPolicy", () => {
  it("resolves the path's match aliases on the external_directory surface (#418)", () => {
    const path = AccessPath.forPath("/outside/a.ts", {
      cwd,
      flavor: posixPathFlavor,
    });
    const resolver = makeResolver(makeCheckResult("ask"));

    const result = resolveExternalDirectoryPolicy(
      path,
      resolver,
      "external_directory",
      undefined,
    );

    expect(resolver.resolve).toHaveBeenCalledWith({
      kind: "access-path",
      surface: "external_directory",
      path,
      agentName: undefined,
    });
    expect(result).toEqual(makeCheckResult("ask"));
  });

  it("threads the agent name through to the resolver", () => {
    const path = AccessPath.forPath("/outside/a.ts", {
      cwd,
      flavor: posixPathFlavor,
    });
    const resolver = makeResolver(makeCheckResult("allow"));

    resolveExternalDirectoryPolicy(
      path,
      resolver,
      "external_directory",
      "reviewer",
    );

    expect(resolver.resolve).toHaveBeenCalledWith({
      kind: "access-path",
      surface: "external_directory",
      path,
      agentName: "reviewer",
    });
  });
});

describe("selectUncoveredExternalPaths", () => {
  it("returns no uncovered paths when every path resolves to allow", () => {
    const paths = [
      AccessPath.forPath("/outside/a.ts", { cwd, flavor: posixPathFlavor }),
      AccessPath.forPath("/outside/b.ts", { cwd, flavor: posixPathFlavor }),
    ];
    const resolver = makeResolver(makeCheckResult("allow"));

    const { uncovered, worstCheck } = selectUncoveredExternalPaths(
      paths,
      resolver,
      undefined,
    );

    expect(uncovered).toEqual([]);
    expect(worstCheck).toBeUndefined();
  });

  it("collects only paths whose resolved state is not allow", () => {
    const allowed = AccessPath.forPath("/outside/ok.ts", {
      cwd,
      flavor: posixPathFlavor,
    });
    const asked = AccessPath.forPath("/outside/ask.ts", {
      cwd,
      flavor: posixPathFlavor,
    });
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) => {
      const values =
        intent.kind === "access-path" ? intent.path.matchValues() : [];
      return values.includes("/outside/ok.ts")
        ? makeCheckResult("allow")
        : makeCheckResult("ask");
    });

    const { uncovered } = selectUncoveredExternalPaths(
      [allowed, asked],
      resolver,
      undefined,
    );

    expect(uncovered.map(({ path }) => path.value())).toEqual([asked.value()]);
  });

  it("returns the most restrictive uncovered check as worstCheck (deny > ask)", () => {
    const asked = AccessPath.forPath("/outside/ask.ts", {
      cwd,
      flavor: posixPathFlavor,
    });
    const denied = AccessPath.forPath("/outside/deny.ts", {
      cwd,
      flavor: posixPathFlavor,
    });
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) => {
      const values =
        intent.kind === "access-path" ? intent.path.matchValues() : [];
      return values.includes("/outside/deny.ts")
        ? makeCheckResult("deny")
        : makeCheckResult("ask");
    });

    const { worstCheck } = selectUncoveredExternalPaths(
      [asked, denied],
      resolver,
      undefined,
    );

    expect(worstCheck?.state).toBe("deny");
  });
});
