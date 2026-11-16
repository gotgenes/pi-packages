import { homedir } from "node:os";
import { describe, expect, test } from "vitest";
import type { ForwardedAccessIntent } from "#src/authority/permission-forwarding";
import { PermissionResolver } from "#src/policy/permission-resolver";
import { ResolverServingPolicy } from "#src/policy/serving-policy";
import { SessionApproval } from "#src/session/session-approval";
import { SessionRules } from "#src/session/session-rules";
import type { PermissionCheckResult, PermissionState } from "#src/types";
import { makeForwardedAccessIntent } from "#test/helpers/forwarding-fixtures";
import {
  createInMemoryManager,
  createManagerWithConfig,
} from "#test/helpers/manager-harness";

describe("ResolverServingPolicy over real recorded authority", () => {
  // The serving composition index.ts constructs, over a filesystem-backed
  // PermissionManager: the surface-family fold is what keeps a parent's
  // recorded `path` deny answering a child's bare-surface request. Resolving
  // an emptied bare surface would fall through to the universal default and
  // escalate a hard deny into an approvable prompt (#712, #806).
  function servingPolicyOver(permission: Record<string, unknown>): {
    resolve: (intent: ForwardedAccessIntent) => PermissionCheckResult;
    cleanup: () => void;
  } {
    const { manager, cleanup } = createManagerWithConfig(permission);
    const policy = new ResolverServingPolicy(
      new PermissionResolver(manager, new SessionRules()),
      () => false,
    );
    return { resolve: (intent) => policy.resolve(intent), cleanup };
  }

  /**
   * The child-fixed match set a real child sends for `/secrets/id_rsa`: an
   * out-of-cwd absolute path has no cwd-relative alias, so `matchValues()`
   * yields the one entry.
   */
  const secretMatchValues = ["/secrets/id_rsa"];

  test("hard-denies a bare-surface child request the parent's bare path config denies", () => {
    const policy = servingPolicyOver({
      "*": "allow",
      path: { "/secrets/*": "deny" },
    });
    try {
      const result = policy.resolve(
        makeForwardedAccessIntent({
          surface: "path",
          matchValues: secretMatchValues,
          boundaryValue: "/secrets/id_rsa",
        }),
      );
      expect(result.state).toBe("deny");
      expect(result.matchedPattern).toBe("/secrets/*");
    } finally {
      policy.cleanup();
    }
  });

  test("hard-denies when only one direction of the parent's config denies", () => {
    const policy = servingPolicyOver({
      "*": "allow",
      path_write: { "/secrets/*": "deny" },
    });
    try {
      const result = policy.resolve(
        makeForwardedAccessIntent({
          surface: "path",
          matchValues: secretMatchValues,
          boundaryValue: "/secrets/id_rsa",
        }),
      );
      expect(result.state).toBe("deny");
      expect(result.toolName).toBe("path_write");
    } finally {
      policy.cleanup();
    }
  });

  test("answers a child that already named a direction on that surface alone", () => {
    const policy = servingPolicyOver({
      "*": "allow",
      external_directory: { "*": "ask" },
      external_directory_read: { "/dev-root/*": "allow" },
    });
    try {
      const forRead = policy.resolve(
        makeForwardedAccessIntent({
          surface: "external_directory_read",
          matchValues: ["/dev-root/x"],
          boundaryValue: "/dev-root/x",
        }),
      );
      expect(forRead.state).toBe("allow");

      const forWrite = policy.resolve(
        makeForwardedAccessIntent({
          surface: "external_directory_write",
          matchValues: ["/dev-root/x"],
          boundaryValue: "/dev-root/x",
        }),
      );
      expect(forWrite.state).toBe("ask");
    } finally {
      policy.cleanup();
    }
  });

  test("hard-denies a directional child request the parent's bare path config denies (#807)", () => {
    // Since #807 a child's bash gate can prove a direction, so `path_read` is
    // the first surface a *bash* child sends. The parent's config names only
    // the bare family, and the deny must still reach it — here through
    // load-time sugar expansion rather than through the resolver's fold, which
    // a directional request bypasses entirely.
    const policy = servingPolicyOver({
      "*": "allow",
      path: { "/secrets/*": "deny" },
    });
    try {
      const result = policy.resolve(
        makeForwardedAccessIntent({
          surface: "path_read",
          matchValues: secretMatchValues,
          boundaryValue: "/secrets/id_rsa",
        }),
      );
      expect(result.state).toBe("deny");
      expect(result.matchedPattern).toBe("/secrets/*");
    } finally {
      policy.cleanup();
    }
  });

  test("leaves an unmatched path request without a pattern, so no gate fires (#58)", () => {
    const policy = servingPolicyOver({ "*": "allow", read: "allow" });
    try {
      const result = policy.resolve(
        makeForwardedAccessIntent({
          surface: "path",
          matchValues: ["/some/file.ts"],
          boundaryValue: "/some/file.ts",
        }),
      );
      expect(result.matchedPattern).toBeUndefined();
    } finally {
      policy.cleanup();
    }
  });
});

describe("ResolverServingPolicy honors the floor the child raised", () => {
  const WRAPPER = "<indirection-bash-wrapper>";

  const flooredIntent = makeForwardedAccessIntent({
    surface: "bash",
    matchValues: ["sudo rm x"],
    floor: WRAPPER,
  });

  test("clamps an allow rule to an ask naming the floor", () => {
    const result = servingPolicyOver({ "*": "allow" }).resolve(flooredIntent);
    expect(result.state).toBe("ask");
    expect(result.matchedPattern).toBe(WRAPPER);
  });

  test("answers the same intent from the allow rule when no floor was raised", () => {
    const { floor: _floor, ...unfloored } = flooredIntent;
    const result = servingPolicyOver({ "*": "allow" }).resolve(unfloored);
    expect(result.state).toBe("allow");
    expect(result.matchedPattern).toBe("*");
  });

  test("still denies what a deny rule covers", () => {
    const result = servingPolicyOver({
      "*": "allow",
      "sudo *": "deny",
    }).resolve(flooredIntent);
    expect(result.state).toBe("deny");
    expect(result.matchedPattern).toBe("sudo *");
  });

  test("leaves an ask rule's own pattern", () => {
    const result = servingPolicyOver({ "*": "ask" }).resolve(flooredIntent);
    expect(result.state).toBe("ask");
    expect(result.matchedPattern).toBe("*");
  });

  test("approves a command the serving session already granted", () => {
    const sessionRules = new SessionRules();
    sessionRules.recordSessionApproval(
      SessionApproval.single("bash", "sudo rm x"),
    );
    const result = servingPolicyOver(
      { "*": "allow" },
      { sessionRules },
    ).resolve(flooredIntent);
    expect(result.state).toBe("allow");
    expect(result.source).toBe("session");
  });

  test("approves under the serving node's yolo, naming the floor and yolo", () => {
    const result = servingPolicyOver({ "*": "allow" }, { yolo: true }).resolve(
      flooredIntent,
    );
    expect(result.state).toBe("allow");
    expect(result.origin).toBe("yolo");
    expect(result.matchedPattern).toBe(WRAPPER);
  });
});

describe("ResolverServingPolicy judges every unit the child left asking", () => {
  const WRAPPER = "<indirection-bash-wrapper>";

  function sessionGranting(pattern: string): SessionRules {
    const sessionRules = new SessionRules();
    sessionRules.recordSessionApproval(SessionApproval.single("bash", pattern));
    return sessionRules;
  }

  const chainIntent = makeForwardedAccessIntent({
    surface: "bash",
    matchValues: ["ls"],
    askingUnits: [{ command: "ls" }, { command: "rm -rf /tmp/x" }],
  });

  test("asks when a unit the parent's rules never allowed rides an allowed one", () => {
    const result = servingPolicyOver({ "*": "ask", "ls*": "allow" }).resolve(
      chainIntent,
    );
    expect(result.state).toBe("ask");
    expect(result.matchedPattern).toBe("*");
  });

  test("denies when the parent's rules deny a unit that did not win on the child", () => {
    const result = servingPolicyOver({
      "*": "ask",
      "ls*": "allow",
      "rm *": "deny",
    }).resolve(chainIntent);
    expect(result.state).toBe("deny");
    expect(result.matchedPattern).toBe("rm *");
  });

  test("approves when the parent's rules allow every unit", () => {
    const result = servingPolicyOver({ "*": "allow" }).resolve(chainIntent);
    expect(result.state).toBe("allow");
  });

  test("a session grant covering one unit leaves a floored sibling asking", () => {
    const result = servingPolicyOver(
      { "*": "allow" },
      { sessionRules: sessionGranting("git push *") },
    ).resolve(
      makeForwardedAccessIntent({
        surface: "bash",
        matchValues: ["git push origin main"],
        floor: WRAPPER,
        askingUnits: [
          { command: "git push origin main" },
          { command: "sudo rm y", floor: WRAPPER },
        ],
      }),
    );
    expect(result.state).toBe("ask");
    expect(result.matchedPattern).toBe(WRAPPER);
  });

  test("honors each unit's own floor rather than the chain's", () => {
    const result = servingPolicyOver(
      { "*": "allow" },
      { sessionRules: sessionGranting("sudo rm y") },
    ).resolve(
      makeForwardedAccessIntent({
        surface: "bash",
        matchValues: ["ls"],
        floor: WRAPPER,
        askingUnits: [
          { command: "ls" },
          { command: "sudo rm y", floor: WRAPPER },
        ],
      }),
    );
    expect(result.state).toBe("allow");
  });

  test("approves a floored unit under the serving node's yolo", () => {
    const result = servingPolicyOver({ "*": "allow" }, { yolo: true }).resolve(
      makeForwardedAccessIntent({
        surface: "bash",
        matchValues: ["ls"],
        floor: WRAPPER,
        askingUnits: [
          { command: "ls" },
          { command: "sudo rm y", floor: WRAPPER },
        ],
      }),
    );
    expect(result.state).toBe("allow");
  });

  test("judges the single value alone when the request carries no units", () => {
    const { askingUnits: _askingUnits, ...singleValue } = chainIntent;
    const result = servingPolicyOver({ "*": "ask", "ls*": "allow" }).resolve(
      singleValue,
    );
    expect(result.state).toBe("allow");
    expect(result.matchedPattern).toBe("ls*");
  });
});

describe("ResolverServingPolicy matches each unit in the spellings the child fixed", () => {
  const WRAPPER = "<indirection-bash-wrapper>";

  function unitsIntent(
    ...askingUnits: NonNullable<ForwardedAccessIntent["askingUnits"]>
  ): ForwardedAccessIntent {
    return makeForwardedAccessIntent({
      surface: "bash",
      matchValues: [askingUnits[0]?.command ?? ""],
      askingUnits,
    });
  }

  // A home no host has, so a match proves the spelling was used as the child
  // fixed it rather than recomputed on this node.
  const spelledTool = {
    command: "~/bin/tool",
    spellings: ["/child-home/bin/tool"],
  };
  const homeDeny: Record<string, PermissionState> = {
    "*": "allow",
    "/child-home/bin/*": "deny",
  };

  test("denies a unit a deny reaches only through its spelling", () => {
    const result = servingPolicyOver(homeDeny).resolve(
      unitsIntent(spelledTool),
    );
    expect(result.state).toBe("deny");
    expect(result.matchedPattern).toBe("/child-home/bin/*");
  });

  test("answers the same unit as typed when the child sent no spellings", () => {
    const result = servingPolicyOver(homeDeny).resolve(
      unitsIntent({ command: "~/bin/tool" }),
    );
    expect(result.state).toBe("allow");
    expect(result.matchedPattern).toBe("*");
  });

  test("denies a relative argument a rule names in its absolute spelling", () => {
    const result = servingPolicyOver({
      "*": "allow",
      "rm /tmp/builds/*": "deny",
    }).resolve(
      unitsIntent({ command: "rm builds/x", spellings: ["rm /tmp/builds/x"] }),
    );
    expect(result.state).toBe("deny");
    expect(result.matchedPattern).toBe("rm /tmp/builds/*");
  });

  test("approves a unit a session grant written with ~ covers", () => {
    const sessionRules = new SessionRules();
    sessionRules.recordSessionApproval(
      SessionApproval.single("bash", "~/bin/tool"),
    );
    const result = servingPolicyOver({ "*": "ask" }, { sessionRules }).resolve(
      unitsIntent({
        command: "~/bin/tool",
        spellings: [`${homedir()}/bin/tool`],
      }),
    );
    expect(result.state).toBe("allow");
    expect(result.source).toBe("session");
  });

  test("still asks on a floored unit an allow reaches through its spelling", () => {
    const result = servingPolicyOver({
      "*": "ask",
      "sudo /child-home/bin/*": "allow",
    }).resolve(
      unitsIntent({
        command: "sudo ~/bin/x",
        spellings: ["sudo /child-home/bin/x"],
        floor: WRAPPER,
      }),
    );
    expect(result.state).toBe("ask");
    expect(result.matchedPattern).toBe(WRAPPER);
  });

  test("denies a chain whose spelled unit the parent denies", () => {
    const result = servingPolicyOver(homeDeny).resolve(
      unitsIntent({ command: "ls" }, spelledTool),
    );
    expect(result.state).toBe("deny");
    expect(result.matchedPattern).toBe("/child-home/bin/*");
  });
});

function servingPolicyOver(
  bash: Record<string, PermissionState>,
  options: { yolo?: boolean; sessionRules?: SessionRules } = {},
): ResolverServingPolicy {
  return new ResolverServingPolicy(
    new PermissionResolver(
      createInMemoryManager({ global: { permission: { bash } } }),
      options.sessionRules ?? new SessionRules(),
    ),
    () => options.yolo ?? false,
  );
}
