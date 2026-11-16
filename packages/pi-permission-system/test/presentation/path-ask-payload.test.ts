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
      matchedSpelling: null,
      executedUnit: null,
      decidingPath: null,
    });
    expect(payload.evidence).toEqual([]);
  });

  test("discloses the file a rewritten spelling resolves to", () => {
    expect(
      buildPathAskPayload({
        toolName: "read",
        pathValue: "/x/d'x.txt",
        resolvedPath: "/x/d\u2019x.txt",
        agentName: null,
        surface: "path_read",
      }).evidence,
    ).toEqual([
      { label: "resolves to", text: "/x/d\u2019x.txt", detail: null },
    ]);
  });

  describe("deciding path", () => {
    test("blames the typed token on the effect that routed it", () => {
      const payload = buildPathAskPayload({
        toolName: "bash",
        pathValue: "out.txt",
        agentName: null,
        surface: "path_write",
        decidingEffect: { effect: "write", source: "syntax" },
      });

      expect(payload.request.decidingPath).toEqual({
        path: "out.txt",
        effect: "write",
        effectSource: "syntax",
      });
    });

    test("blames nothing when the caller supplies no effect (a tool ask)", () => {
      const payload = buildPathAskPayload({
        toolName: "read",
        pathValue: "/etc/passwd",
        agentName: null,
        surface: "path_read",
      });

      expect(payload.request.decidingPath).toBeNull();
    });
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

  test("blames nothing: a tool's direction is its identity", () => {
    const payload = buildExternalDirectoryAskPayload({
      toolName: "edit",
      pathValue: "/tmp/out.txt",
      cwd: "/projects/my-app",
      agentName: null,
      surface: "external_directory",
    });

    expect(payload.request.decidingPath).toBeNull();
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
      decidingPath: {
        path: "/etc/passwd",
        effect: { effect: "read", source: "core" },
      },
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
      decidingPath: { path: "/a", effect: { effect: "read", source: "core" } },
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

  test("blames the deciding path on what established its direction", () => {
    const payload = buildBashExternalDirectoryAskPayload({
      command: "git log /outside/a",
      externalPaths: [{ path: "/outside/a" }],
      decidingPath: {
        path: "/outside/a",
        effect: { effect: "unproven", source: "retracted" },
      },
      cwd: "/repo",
      surface: "external_directory",
      agentName: null,
      toolName: "bash",
    });

    expect(payload.request.decidingPath).toEqual({
      path: "/outside/a",
      effect: "unproven",
      effectSource: "retracted",
    });
  });
});
