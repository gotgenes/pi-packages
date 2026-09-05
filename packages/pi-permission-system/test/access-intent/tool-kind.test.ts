import { describe, expect, test } from "vitest";
import { PATH_BEARING_TOOLS } from "#src/access-intent/path-surfaces";
import {
  classifyToolKind,
  isMcpCheck,
  resolveShellInvocation,
} from "#src/access-intent/tool-kind";
import type { ShellToolsConfig } from "#src/config/config-schema";

describe("classifyToolKind", () => {
  test("classifies bash", () => {
    expect(classifyToolKind("bash")).toBe("bash");
  });

  test("classifies mcp", () => {
    expect(classifyToolKind("mcp")).toBe("mcp");
  });

  test("classifies skill", () => {
    expect(classifyToolKind("skill")).toBe("skill");
  });

  test("classifies every path-bearing built-in tool as path", () => {
    for (const tool of PATH_BEARING_TOOLS) {
      expect(classifyToolKind(tool)).toBe("path");
    }
  });

  test("classifies an arbitrary extension tool as extension", () => {
    expect(classifyToolKind("task")).toBe("extension");
    expect(classifyToolKind("third_party_tool")).toBe("extension");
  });

  test("classifies the special path surfaces as extension", () => {
    // `path` and `external_directory` are not tool names — they reach the
    // classifier only as normalized surface names in `deriveSource`, where the
    // `SPECIAL_PERMISSION_KEYS` check maps them to `special` before the kind.
    expect(classifyToolKind("path")).toBe("extension");
    expect(classifyToolKind("external_directory")).toBe("extension");
  });

  test("trims surrounding whitespace before classifying", () => {
    expect(classifyToolKind(" bash ")).toBe("bash");
    expect(classifyToolKind("\tmcp\n")).toBe("mcp");
    expect(classifyToolKind("  read  ")).toBe("path");
  });
});

describe("isMcpCheck", () => {
  test("is true when the tool itself is mcp", () => {
    expect(isMcpCheck({ toolName: "mcp", source: "tool" })).toBe(true);
  });

  test("is true when the winning rule matched on the mcp surface", () => {
    // The `source` disjunct: a server-qualified toolName still classifies as an
    // MCP call because `deriveSource` set source to `mcp`.
    expect(
      isMcpCheck({ toolName: "some-server:some-tool", source: "mcp" }),
    ).toBe(true);
    expect(isMcpCheck({ toolName: "read", source: "mcp" })).toBe(true);
  });

  test("is false for a bash check", () => {
    expect(isMcpCheck({ toolName: "bash", source: "bash" })).toBe(false);
  });

  test("is false for a plain tool check", () => {
    expect(isMcpCheck({ toolName: "read", source: "tool" })).toBe(false);
    expect(isMcpCheck({ toolName: "task", source: "default" })).toBe(false);
  });
});

describe("resolveShellInvocation", () => {
  const execAlias: ShellToolsConfig = {
    exec_command: { commandArgument: "cmd", workdirArgument: "workdir" },
  };

  describe("native bash", () => {
    test("extracts the command with no workdir", () => {
      expect(
        resolveShellInvocation("bash", { command: "git status" }, undefined),
      ).toEqual({ command: "git status", workdir: undefined });
    });

    test("trims the command", () => {
      expect(
        resolveShellInvocation(
          "bash",
          { command: "  git status  " },
          undefined,
        ),
      ).toEqual({ command: "git status", workdir: undefined });
    });

    test("yields an empty command when absent or non-string", () => {
      expect(resolveShellInvocation("bash", {}, undefined)).toEqual({
        command: "",
        workdir: undefined,
      });
      expect(
        resolveShellInvocation("bash", { command: 42 }, undefined),
      ).toEqual({ command: "", workdir: undefined });
    });

    test("resolves regardless of the shellTools map", () => {
      expect(
        resolveShellInvocation("bash", { command: "ls" }, execAlias),
      ).toEqual({ command: "ls", workdir: undefined });
    });
  });

  describe("aliased shell tool", () => {
    test("extracts command and workdir from the mapped arguments", () => {
      expect(
        resolveShellInvocation(
          "exec_command",
          { cmd: "npm install", workdir: "/etc" },
          execAlias,
        ),
      ).toEqual({ command: "npm install", workdir: "/etc" });
    });

    test("omits workdir when the alias declares no workdirArgument", () => {
      const aliases: ShellToolsConfig = {
        exec_command: { commandArgument: "cmd" },
      };
      expect(
        resolveShellInvocation(
          "exec_command",
          { cmd: "npm install", workdir: "/etc" },
          aliases,
        ),
      ).toEqual({ command: "npm install", workdir: undefined });
    });

    test("omits workdir when the mapped workdir argument is absent", () => {
      expect(
        resolveShellInvocation(
          "exec_command",
          { cmd: "npm install" },
          execAlias,
        ),
      ).toEqual({ command: "npm install", workdir: undefined });
    });

    test("yields an empty command when the mapped command argument is absent", () => {
      expect(
        resolveShellInvocation("exec_command", { workdir: "/etc" }, execAlias),
      ).toEqual({ command: "", workdir: "/etc" });
    });

    test("trims the extracted command and workdir", () => {
      expect(
        resolveShellInvocation(
          "exec_command",
          { cmd: "  npm install  ", workdir: "  /etc  " },
          execAlias,
        ),
      ).toEqual({ command: "npm install", workdir: "/etc" });
    });
  });

  describe("non-shell tools", () => {
    test("returns null for an unaliased extension tool", () => {
      expect(
        resolveShellInvocation(
          "exec_command",
          { cmd: "npm install" },
          undefined,
        ),
      ).toBeNull();
      expect(
        resolveShellInvocation("read", { path: "a.txt" }, execAlias),
      ).toBeNull();
    });

    test("returns null when the map names a different tool", () => {
      expect(
        resolveShellInvocation("other_tool", { cmd: "npm install" }, execAlias),
      ).toBeNull();
    });
  });
});
