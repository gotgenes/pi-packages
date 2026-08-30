import { afterEach, describe, expect, test, vi } from "vitest";

import type { SubagentDetectionContext } from "#src/authority/subagent-context";
import { SubagentDetection } from "#src/authority/subagent-detection";
import { SubagentSessionRegistry } from "#src/authority/subagent-registry";
import { posixPathFlavor } from "#src/path/path-flavor";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function makeCtx(
  sessionDir: string | null,
  sessionId: string = "",
): SubagentDetectionContext {
  return {
    sessionManager: {
      getSessionDir: vi.fn(() => sessionDir ?? ""),
      getSessionId: vi.fn(() => sessionId),
    },
  };
}

const subagentSessionsDir = "/agent/subagent-sessions";

describe("SubagentDetection", () => {
  describe("isSubagent", () => {
    test("returns true for a registered in-process child (registry source)", () => {
      const registry = new SubagentSessionRegistry();
      registry.register("child-1", {});
      const detection = new SubagentDetection({
        subagentSessionsDir,
        flavor: posixPathFlavor,
        registry,
      });
      expect(detection.isSubagent(makeCtx(null, "child-1"))).toBe(true);
    });

    test("returns true when a subagent env hint is set (env source)", () => {
      vi.stubEnv("PI_IS_SUBAGENT", "1");
      const detection = new SubagentDetection({
        subagentSessionsDir,
        flavor: posixPathFlavor,
        registry: new SubagentSessionRegistry(),
      });
      expect(detection.isSubagent(makeCtx("/somewhere/else"))).toBe(true);
    });

    test("returns true when the session dir is nested under subagentSessionsDir (filesystem source)", () => {
      const detection = new SubagentDetection({
        subagentSessionsDir,
        flavor: posixPathFlavor,
        registry: new SubagentSessionRegistry(),
      });
      expect(
        detection.isSubagent(makeCtx(`${subagentSessionsDir}/child-1`)),
      ).toBe(true);
    });

    test("returns false when no source matches", () => {
      const detection = new SubagentDetection({
        subagentSessionsDir,
        flavor: posixPathFlavor,
        registry: new SubagentSessionRegistry(),
      });
      expect(detection.isSubagent(makeCtx("/projects/my-app"))).toBe(false);
    });
  });
});
