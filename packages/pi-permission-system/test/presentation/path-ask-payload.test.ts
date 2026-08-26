import { describe, expect, test } from "vitest";
import {
  buildBashExternalDirectoryAskPayload,
  buildExternalDirectoryAskPayload,
  buildPathAskPayload,
} from "#src/presentation/path-ask-payload";

describe("buildPathAskPayload", () => {
  test("carries the typed path as the decision value and the rule that fired", () => {
    const payload = buildPathAskPayload({
      toolName: "read",
      pathValue: "/etc/passwd",
      agentName: "my-agent",
      matchedPattern: "/etc/*",
      surface: "path_read",
    });

    expect(payload.kind).toBe("path");
    expect(payload.request).toEqual({
      requester: { agentName: "my-agent", forwarded: false, sessionId: null },
      surface: "path_read",
      toolName: "read",
      invokedToolName: null,
      value: "/etc/passwd",
      matchedPattern: "/etc/*",
      commandContext: null,
      executedUnit: null,
    });
    expect(payload.evidence).toEqual([]);
  });

  test("leaves the requester unnamed when no agent is active", () => {
    expect(
      buildPathAskPayload({
        toolName: "read",
        pathValue: "/etc/passwd",
        agentName: null,
        surface: "path_read",
      }).request.requester,
    ).toEqual({ agentName: null, forwarded: false, sessionId: null });
  });
});

describe("buildExternalDirectoryAskPayload", () => {
  test("carries the typed path, the boundary, and the requester", () => {
    const payload = buildExternalDirectoryAskPayload({
      toolName: "write",
      pathValue: "/tmp/out.txt",
      cwd: "/projects/my-app",
      agentName: "my-agent",
      surface: "external_directory_write",
    });

    expect(payload.kind).toBe("external_directory");
    expect(payload.request.toolName).toBe("write");
    expect(payload.request.value).toBe("/tmp/out.txt");
    expect(payload.request.requester.agentName).toBe("my-agent");
    expect(payload.evidence).toEqual([
      { label: "working directory", text: "/projects/my-app", detail: null },
    ]);
  });

  test("discloses the resolved path as its own entry when it differs", () => {
    expect(
      buildExternalDirectoryAskPayload({
        toolName: "read",
        pathValue: "demo-symlink-passwd",
        resolvedPath: "/etc/passwd",
        cwd: "/projects/my-app",
        agentName: null,
        surface: "external_directory_read",
      }).evidence,
    ).toEqual([
      { label: "resolves to", text: "/etc/passwd", detail: null },
      { label: "working directory", text: "/projects/my-app", detail: null },
    ]);
  });

  test("omits the disclosure when resolvedPath is undefined", () => {
    const payload = buildExternalDirectoryAskPayload({
      toolName: "read",
      pathValue: "/etc/passwd",
      cwd: "/projects/my-app",
      agentName: null,
      surface: "external_directory_read",
    });

    expect(payload.evidence).toEqual([
      { label: "working directory", text: "/projects/my-app", detail: null },
    ]);
  });
});

describe("buildBashExternalDirectoryAskPayload", () => {
  test("makes the command the value and the paths it reached evidence", () => {
    const payload = buildBashExternalDirectoryAskPayload({
      command: "cat /etc/passwd",
      externalPaths: [{ path: "/etc/passwd" }],
      cwd: "/projects/my-app",
      agentName: "my-agent",
      toolName: "bash",
      surface: "external_directory_read",
    });

    expect(payload.kind).toBe("bash_external_directory");
    expect(payload.request.value).toBe("cat /etc/passwd");
    // The surface names the direction; the kind stays coarse for the renderer.
    expect(payload.request.surface).toBe("external_directory_read");
    expect(payload.request.requester.agentName).toBe("my-agent");
    expect(payload.evidence).toEqual([
      { label: "working directory", text: "/projects/my-app", detail: null },
      { label: "external path", text: "/etc/passwd", detail: null },
    ]);
  });

  test("binds each path's canonical alias to its own entry", () => {
    const payload = buildBashExternalDirectoryAskPayload({
      command: "cat a b",
      externalPaths: [
        { path: "/a", resolvedPath: "/private/a" },
        { path: "/b" },
      ],
      cwd: "/repo",
      surface: "external_directory",
      agentName: null,
      toolName: "bash",
    });

    expect(payload.evidence).toEqual([
      { label: "working directory", text: "/repo", detail: null },
      { label: "external path", text: "/a", detail: "/private/a" },
      { label: "external path", text: "/b", detail: null },
    ]);
  });
});
