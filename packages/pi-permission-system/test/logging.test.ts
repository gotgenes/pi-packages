import { beforeEach, describe, expect, test } from "vitest";
import {
  DEFAULT_EXTENSION_CONFIG,
  type PermissionSystemExtensionConfig,
} from "#src/extension-config";
import { createPermissionSystemLogger, type LogStream } from "#src/logging";

describe("createPermissionSystemLogger", () => {
  let config: PermissionSystemExtensionConfig;
  let lines: Array<{ stream: LogStream; line: string }>;

  beforeEach(() => {
    config = { ...DEFAULT_EXTENSION_CONFIG };
    lines = [];
  });

  function makeLogger() {
    return createPermissionSystemLogger({
      getConfig: () => config,
      emit: (stream, line) => {
        lines.push({ stream, line });
        return undefined;
      },
    });
  }

  describe("redaction", () => {
    test("masks sensitive-keyed values before they reach the review log", () => {
      makeLogger().review("permission_request.waiting", {
        toolName: "http",
        headers: { authorization: "Bearer TEST_VALUE" },
      });

      expect(lines).toHaveLength(1);
      expect(lines[0].line).not.toContain("TEST_VALUE");
      expect(JSON.parse(lines[0].line)).toMatchObject({
        toolName: "http",
        headers: { authorization: "[redacted]" },
      });
    });

    test("masks sensitive-keyed values in the debug log too", () => {
      config.debugLog = true;

      makeLogger().debug("permission.decision", {
        toolName: "http",
        apiKey: "sk-real-value",
      });

      expect(lines[0].line).not.toContain("sk-real-value");
      expect(JSON.parse(lines[0].line)).toMatchObject({
        toolName: "http",
        apiKey: "[redacted]",
      });
    });

    test("leaves a bash command string unredacted, as documented", () => {
      makeLogger().review("permission_request.waiting", {
        toolName: "bash",
        command: "deploy --token abc123",
      });

      expect(lines[0].line).toContain("deploy --token abc123");
    });
  });

  test("respects debug toggle and keeps review log enabled by default", () => {
    const logger = makeLogger();

    expect(logger.debug("debug.disabled", { sample: true })).toBe(undefined);
    expect(
      logger.review("permission_request.waiting", { toolName: "write" }),
    ).toBe(undefined);
    expect(lines.map((l) => l.stream)).toEqual(["review"]);

    config.debugLog = true;
    logger.debug("debug.enabled", { sample: true });
    expect(
      lines.some(
        (l) => l.stream === "debug" && l.line.includes("debug.enabled"),
      ),
    ).toBe(true);
  });
});
