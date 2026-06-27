import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:fs/promises so realpath is controllable without touching the
// real filesystem. Must be hoisted before the module under test is imported.
const realpath = vi.hoisted(() =>
  vi.fn<(path: string) => Promise<string>>(),
);
vi.mock("node:fs/promises", () => ({
  realpath,
  default: { realpath },
}));

// Mock node:fs so realpathSync (used by canonicalizePath) is an identity
// function — lexical-only tests are unaffected.
const realpathSync = vi.hoisted(() =>
  vi.fn<(path: string) => string>((p) => p),
);
vi.mock("node:fs", () => ({
  realpathSync,
  default: { realpathSync },
}));

// Mock node:os for deterministic home-dir expansion.
vi.mock("node:os", () => {
  const homedir = vi.fn(() => "/mock/home");
  return { homedir, default: { homedir } };
});

import type { GateDescriptor } from "#src/handlers/gates/descriptor";
import { isGateDescriptor } from "#src/handlers/gates/descriptor";
import { describePathGate } from "#src/handlers/gates/path";
import type { ToolCallContext } from "#src/handlers/gates/types";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import type { PermissionCheckResult } from "#src/types";

// ── helpers ──────────────────────────────────────────────────────────────────

const CWD = "/projects/app";

function makeTcc(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    toolName: "read",
    agentName: null,
    input: { path: "/projects/app/link" },
    toolCallId: "tc-symlink",
    cwd: CWD,
    ...overrides,
  };
}

function makeCheckResult(
  overrides: Partial<PermissionCheckResult> = {},
): PermissionCheckResult {
  return {
    toolName: "path",
    state: "allow",
    source: "special",
    origin: "global",
    ...overrides,
  };
}

/**
 * Creates a mock resolver.
 *
 * @param defaultCheck - Default result returned by `resolve()`.
 * @param pathRules    - Value returned by `hasPathRules()`.
 *                       Set to `true` to enable symlink resolution in the gate.
 */
function makeResolver(
  defaultCheck?: PermissionCheckResult,
  pathRules = false,
): ScopedPermissionResolver {
  const resolve = vi.fn<ScopedPermissionResolver["resolve"]>();
  if (defaultCheck) {
    resolve.mockReturnValue(defaultCheck);
  }
  const hasPathRules = vi.fn<() => boolean>().mockReturnValue(pathRules);
  return { resolve, hasPathRules };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("describePathGate — symlink traversal fix (#493)", () => {
  beforeEach(() => {
    realpath.mockReset();
    realpathSync.mockReset();
    // Default: identity — non-symlink paths resolve to themselves.
    realpath.mockImplementation((p: string) => Promise.resolve(p));
    realpathSync.mockImplementation((p: string) => p);
  });

  it("uses the resolved path for rule evaluation when a symlink points elsewhere", async () => {
    // Simulate: /projects/app/link → /protected/secret.txt
    realpath.mockImplementation((p: string) =>
      Promise.resolve(
        p === "/projects/app/link" ? "/protected/secret.txt" : p,
      ),
    );
    const check = makeCheckResult({ state: "deny", matchedPattern: "/protected/*" });
    const resolver = makeResolver(check, /* pathRules */ true);

    const result = await describePathGate(makeTcc(), resolver);

    // The resolver must have been called with the symlink target, not the
    // original lexical path, so the /protected/* deny rule fires.
    expect(resolver.resolve).toHaveBeenCalledWith({
      kind: "tool",
      surface: "path",
      input: { path: "/protected/secret.txt" },
      agentName: undefined,
    });
    expect(isGateDescriptor(result)).toBe(true);
    expect((result as GateDescriptor).preCheck?.state).toBe("deny");
  });

  it("preserves the original file path in the descriptor for display and approval", async () => {
    // Symlink resolves to a protected location.
    realpath.mockResolvedValue("/protected/secret.txt");
    const check = makeCheckResult({ state: "deny", matchedPattern: "/protected/*" });
    const resolver = makeResolver(check, true);

    const result = await describePathGate(
      makeTcc({ input: { path: "/projects/app/link" } }),
      resolver,
    ) as GateDescriptor;

    // User-visible context must reference the path they specified.
    expect(result.denialContext).toMatchObject({
      kind: "path",
      pathValue: "/projects/app/link",
    });
    expect(result.decision.value).toBe("/projects/app/link");
  });

  it("denies unconditionally when realpath throws ENOENT (dangling symlink)", async () => {
    realpath.mockRejectedValue(
      Object.assign(new Error("ENOENT: no such file or directory"), {
        code: "ENOENT",
      }),
    );
    const resolver = makeResolver(undefined, true);

    const result = await describePathGate(makeTcc(), resolver);

    // Gate must deny without consulting the resolver.
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(isGateDescriptor(result)).toBe(true);
    expect((result as GateDescriptor).preResolved?.state).toBe("deny");
  });

  it("denies unconditionally when realpath throws EPERM", async () => {
    realpath.mockRejectedValue(
      Object.assign(new Error("EPERM: operation not permitted"), {
        code: "EPERM",
      }),
    );
    const resolver = makeResolver(undefined, true);

    const result = await describePathGate(makeTcc(), resolver);

    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(isGateDescriptor(result)).toBe(true);
    expect((result as GateDescriptor).preResolved?.state).toBe("deny");
  });

  it("denies unconditionally when realpath throws ELOOP (symlink loop)", async () => {
    realpath.mockRejectedValue(
      Object.assign(new Error("ELOOP: too many levels of symbolic links"), {
        code: "ELOOP",
      }),
    );
    const resolver = makeResolver(undefined, true);

    const result = await describePathGate(makeTcc(), resolver);

    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(isGateDescriptor(result)).toBe(true);
    expect((result as GateDescriptor).preResolved?.state).toBe("deny");
  });

  it("skips realpath entirely when no path rules are configured (performance)", async () => {
    // resolver.hasPathRules() returns false (the default from makeResolver).
    const resolver = makeResolver(makeCheckResult({ state: "allow" }), false);

    await describePathGate(makeTcc(), resolver);

    expect(realpath).not.toHaveBeenCalled();
  });

  it("skips realpath when resolver does not expose hasPathRules (legacy mock)", async () => {
    // A resolver without hasPathRules (older mock) must not cause an error and
    // must not trigger symlink resolution.
    const resolver: ScopedPermissionResolver = {
      resolve: vi.fn<ScopedPermissionResolver["resolve"]>().mockReturnValue(
        makeCheckResult({ state: "allow" }),
      ),
      // hasPathRules intentionally omitted
    };

    await expect(describePathGate(makeTcc(), resolver)).resolves.toBeNull();
    expect(realpath).not.toHaveBeenCalled();
  });

  it("returns null when the resolved path is allowed by configured rules", async () => {
    // Symlink resolves to an allowed location.
    realpath.mockResolvedValue("/safe/path.txt");
    const resolver = makeResolver(makeCheckResult({ state: "allow" }), true);

    const result = await describePathGate(
      makeTcc({ input: { path: "/link/to/safe" } }),
      resolver,
    );

    expect(result).toBeNull();
  });

  it("uses the original path for rule evaluation when realpath returns the same path (not a symlink)", async () => {
    // Non-symlink path: realpath returns the same path.
    realpath.mockImplementation((p: string) => Promise.resolve(p));
    const check = makeCheckResult({ state: "deny", matchedPattern: "/projects/*" });
    const resolver = makeResolver(check, true);

    await describePathGate(makeTcc(), resolver);

    // resolve() should be called with the original path (no substitution).
    expect(resolver.resolve).toHaveBeenCalledWith({
      kind: "tool",
      surface: "path",
      input: { path: "/projects/app/link" },
      agentName: undefined,
    });
  });
});
