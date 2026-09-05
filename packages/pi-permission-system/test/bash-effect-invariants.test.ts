/**
 * Cross-layer pins for the invariants bash effect attribution sits on top of
 * (#807).
 *
 * Each case runs the real bash gate over a real `PermissionResolver` and a
 * real filesystem-backed `PermissionManager`, because every claim here is
 * about the *composition*: a token routed to a directional surface bypasses
 * the resolver's family fold entirely, so the equality with today's behavior
 * rests on load-time sugar expansion writing identical rule lists onto both
 * members. A test against the manager alone sits below the fold and cannot
 * see that.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:os so tilde-expansion is deterministic across platforms.
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  const homedir = vi.fn(() => "/mock/home");
  return { ...actual, homedir, default: { ...actual, homedir } };
});

import { BashProgram } from "#src/access-intent/bash/program";
import { describeBashExternalDirectoryGate } from "#src/handlers/gates/bash-external-directory";
import { describeBashPathGate } from "#src/handlers/gates/bash-path";
import type { GateResult } from "#src/handlers/gates/descriptor";
import { isGateDescriptor } from "#src/handlers/gates/descriptor";
import type { ToolCallContext } from "#src/handlers/gates/types";
import { posixPathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path/path-normalizer";
import { PermissionResolver } from "#src/policy/permission-resolver";
import { SessionRules } from "#src/session-rules";
import { createManagerWithConfig } from "#test/helpers/manager-harness";

const CWD = "/projects/my-app";

let cleanups: (() => void)[] = [];

beforeEach(() => {
  cleanups = [];
});

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
});

/** A real resolver over a real manager loaded from `permission`. */
function realResolver(permission: Record<string, unknown>): PermissionResolver {
  const { manager, cleanup } = createManagerWithConfig(permission);
  cleanups.push(cleanup);
  return new PermissionResolver(manager, new SessionRules());
}

function makeTcc(command: string): ToolCallContext {
  return {
    toolName: "bash",
    agentName: null,
    input: { command },
    toolCallId: "tc-1",
    cwd: CWD,
  };
}

/** Run the cross-cutting `path` gate over a real policy. */
async function pathGate(
  command: string,
  permission: Record<string, unknown>,
): Promise<GateResult> {
  const normalizer = new PathNormalizer(posixPathFlavor, CWD);
  const program = await BashProgram.parse(command, normalizer);
  return describeBashPathGate(
    makeTcc(command),
    program,
    realResolver(permission),
    normalizer,
  );
}

/** Run the `external_directory` gate over a real policy. */
async function externalDirectoryGate(
  command: string,
  permission: Record<string, unknown>,
): Promise<GateResult> {
  const normalizer = new PathNormalizer(posixPathFlavor, CWD);
  const program = await BashProgram.parse(command, normalizer);
  return describeBashExternalDirectoryGate(
    makeTcc(command),
    program,
    realResolver(permission),
    normalizer,
  );
}

/** The state a gate resolved, or `"allow"` when it raised nothing at all. */
function resolvedState(result: GateResult): string {
  if (result === null) return "allow";
  if (!isGateDescriptor(result)) return "allow";
  return result.preCheck?.state ?? "unknown";
}

describe("the fixtures reach the gates at all", () => {
  // Every "allow" assertion below would pass vacuously if the path were never
  // projected, so pin the projection first — a gate that does not apply and a
  // gate that allows are the same verdict to a caller.
  it("projects the external path each fixture command names", async () => {
    const normalizer = new PathNormalizer(posixPathFlavor, CWD);
    const program = await BashProgram.parse(
      "cat /outside/notes.md",
      normalizer,
    );

    expect(program.externalAccesses().map(({ path }) => path.value())).toEqual([
      "/outside/notes.md",
    ]);
  });

  it("projects the tilde path the bare-config cases name", async () => {
    const normalizer = new PathNormalizer(posixPathFlavor, CWD);
    const program = await BashProgram.parse("cat ~/.ssh/id_rsa", normalizer);

    expect(program.pathRuleCandidates().map(({ token }) => token)).toEqual([
      "~/.ssh/id_rsa",
    ]);
  });
});

describe("a bare-family config keeps its meaning once a token is proven", () => {
  it("still denies a proven read that a bare path deny covers", async () => {
    const result = await pathGate("cat ~/.ssh/id_rsa", {
      path: { "~/.ssh/*": "deny" },
    });

    expect(isGateDescriptor(result)).toBe(true);
    expect(resolvedState(result)).toBe("deny");
    // The token routed directionally, bypassing the resolver's family fold —
    // the deny survives because load-time sugar wrote the rule onto both
    // members, not because the fold consulted them.
    expect(isGateDescriptor(result) && result.surface).toBe("path_read");
  });

  it("still denies a proven write that a bare path deny covers", async () => {
    const result = await pathGate("echo hi > ~/.ssh/authorized_keys", {
      path: { "~/.ssh/*": "deny" },
    });

    expect(resolvedState(result)).toBe("deny");
    expect(isGateDescriptor(result) && result.surface).toBe("path_write");
  });

  it("still asks for a proven read outside the tree under a bare external_directory ask", async () => {
    const result = await externalDirectoryGate("cat /outside/notes.md", {
      external_directory: { "*": "ask" },
    });

    expect(resolvedState(result)).toBe("ask");
    expect(isGateDescriptor(result) && result.surface).toBe(
      "external_directory_read",
    );
  });

  it("still allows a proven read that a bare external_directory allow covers", async () => {
    const result = await externalDirectoryGate("cat /outside/notes.md", {
      external_directory: { "/outside/*": "allow" },
    });

    expect(resolvedState(result)).toBe("allow");
  });
});

describe("a directional grant covers only its own direction", () => {
  const readAllowed = { external_directory_read: { "/outside/*": "allow" } };

  it("silences a proven read outside the tree", async () => {
    const result = await externalDirectoryGate(
      "cat /outside/notes.md",
      readAllowed,
    );

    // The positive control: without it, the negative cases below could pass
    // for any reason at all.
    expect(resolvedState(result)).toBe("allow");
  });

  it("does not silence rm, which is unknown rather than proven-write", async () => {
    const result = await externalDirectoryGate(
      "rm -rf /outside/notes.md",
      readAllowed,
    );

    // `rm` proves nothing, so the token consults both directions
    // most-restrictive and the unwritten write surface floors it.
    expect(isGateDescriptor(result)).toBe(true);
    expect(resolvedState(result)).not.toBe("allow");
    expect(isGateDescriptor(result) && result.surface).toBe(
      "external_directory",
    );
  });

  it("does not silence a proven write", async () => {
    const result = await externalDirectoryGate(
      "echo hi > /outside/notes.md",
      readAllowed,
    );

    expect(resolvedState(result)).not.toBe("allow");
    expect(isGateDescriptor(result) && result.surface).toBe(
      "external_directory_write",
    );
  });

  it("does not silence a guarded word whose option withdrew its claim", async () => {
    const result = await externalDirectoryGate(
      "find /outside -delete",
      readAllowed,
    );

    expect(resolvedState(result)).not.toBe("allow");
    expect(isGateDescriptor(result) && result.surface).toBe(
      "external_directory",
    );
  });
});

describe("the fail-closed base case reaches the bare family", () => {
  it("consults both directions for a command outside the core", async () => {
    const result = await externalDirectoryGate("pnpm test /outside/spec.ts", {
      external_directory: { "*": "ask" },
    });

    expect(isGateDescriptor(result)).toBe(true);
    expect(isGateDescriptor(result) && result.surface).toBe(
      "external_directory",
    );
    expect(resolvedState(result)).toBe("ask");
  });

  it("consults both directions for a path-qualified core word", async () => {
    const result = await externalDirectoryGate(
      "/tmp/evil/cat /outside/notes.md",
      { external_directory: { "*": "ask" } },
    );

    expect(isGateDescriptor(result) && result.surface).toBe(
      "external_directory",
    );
  });
});
