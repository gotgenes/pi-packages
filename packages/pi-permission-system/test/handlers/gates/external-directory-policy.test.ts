import { describe, expect, it } from "vitest";
import { AccessPath } from "#src/access-intent/access-path";
import type { BashExternalPath } from "#src/access-intent/bash/bash-path-resolver";
import { type TokenEffect, UNPROVEN_EFFECT } from "#src/access-intent/effect";
import {
  resolveExternalDirectoryPolicy,
  selectUncoveredExternalPaths,
} from "#src/handlers/gates/external-directory-policy";
import { posixPathFlavor } from "#src/path/path-flavor";
import type { PermissionCheckResult } from "#src/types";
import { makeResolver } from "#test/helpers/gate-fixtures";

const cwd = "/test/project";

const CORE_READ: TokenEffect = { effect: "read", source: "core" };
const SYNTAX_WRITE: TokenEffect = { effect: "write", source: "syntax" };

/** An external access at `value`, attributed `effect`. */
function access(
  value: string,
  effect: TokenEffect = UNPROVEN_EFFECT,
): BashExternalPath {
  return {
    path: AccessPath.forPath(value, { cwd, flavor: posixPathFlavor }),
    effect,
  };
}

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
    const resolver = makeResolver(makeCheckResult("allow"));

    const { uncovered, worstCheck } = selectUncoveredExternalPaths(
      [access("/outside/a.ts"), access("/outside/b.ts")],
      resolver,
      undefined,
    );

    expect(uncovered).toEqual([]);
    expect(worstCheck).toBeUndefined();
  });

  it("collects only paths whose resolved state is not allow", () => {
    const allowed = access("/outside/ok.ts");
    const asked = access("/outside/ask.ts");
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

    expect(uncovered.map(({ path }) => path.value())).toEqual([
      asked.path.value(),
    ]);
  });

  it("routes each path through the surface its own effect names", () => {
    const resolver = makeResolver(makeCheckResult("ask"));

    const { uncovered } = selectUncoveredExternalPaths(
      [
        access("/outside/read.ts", CORE_READ),
        access("/outside/write.ts", SYNTAX_WRITE),
        access("/outside/unknown.ts"),
      ],
      resolver,
      undefined,
    );

    expect(uncovered.map(({ surface }) => surface)).toEqual([
      "external_directory_read",
      "external_directory_write",
      "external_directory",
    ]);
    expect(
      resolver.resolve.mock.calls.map(([intent]) => intent.surface),
    ).toEqual([
      "external_directory_read",
      "external_directory_write",
      "external_directory",
    ]);
  });

  it("returns each uncovered entry's effect for the blame line", () => {
    const resolver = makeResolver(makeCheckResult("ask"));

    const { uncovered } = selectUncoveredExternalPaths(
      [access("/outside/read.ts", CORE_READ)],
      resolver,
      undefined,
    );

    expect(uncovered.map(({ effect }) => effect)).toEqual([CORE_READ]);
  });

  it("returns the most restrictive uncovered check as worstCheck (deny > ask)", () => {
    const asked = access("/outside/ask.ts");
    const denied = access("/outside/deny.ts");
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
