import { describe, expect, test } from "vitest";

import {
  type DenialContext,
  EXTENSION_TAG,
  formatDenyReason,
  formatUnavailableReason,
  formatUserDeniedReason,
} from "#src/denial-messages";
import type { PermissionCheckResult } from "#src/types";

// ── Helpers ────────────────────────────────────────────────────────────────

function toolCheck(
  toolName: string,
  overrides: Partial<PermissionCheckResult> = {},
): PermissionCheckResult {
  return {
    toolName,
    state: "deny",
    source: "tool",
    origin: "builtin",
    ...overrides,
  };
}

function mcpCheck(
  target: string,
  overrides: Partial<PermissionCheckResult> = {},
): PermissionCheckResult {
  return {
    toolName: "mcp",
    target,
    state: "deny",
    source: "mcp",
    origin: "builtin",
    ...overrides,
  };
}

function toolCtx(
  check: PermissionCheckResult,
  agentName?: string,
): Extract<DenialContext, { kind: "tool" }> {
  return { kind: "tool", check, agentName };
}

// ── EXTENSION_TAG ──────────────────────────────────────────────────────────

describe("EXTENSION_TAG", () => {
  test("is [pi-permission-system]", () => {
    expect(EXTENSION_TAG).toBe("[pi-permission-system]");
  });
});

// ── formatDenyReason ───────────────────────────────────────────────────────

describe("formatDenyReason", () => {
  describe("tool context", () => {
    test("generic tool without agent", () => {
      expect(formatDenyReason(toolCtx(toolCheck("write")))).toBe(
        "[pi-permission-system] is not permitted to run 'write'.",
      );
    });

    test("generic tool with agent", () => {
      expect(formatDenyReason(toolCtx(toolCheck("write"), "my-agent"))).toBe(
        "[pi-permission-system] Agent 'my-agent' is not permitted to run 'write'.",
      );
    });

    test("MCP target", () => {
      expect(formatDenyReason(toolCtx(mcpCheck("server:do-thing")))).toBe(
        "[pi-permission-system] is not permitted to run MCP target 'server:do-thing'.",
      );
    });

    test("bash with command", () => {
      expect(
        formatDenyReason(toolCtx(toolCheck("bash", { command: "rm -rf /" }))),
      ).toBe(
        "[pi-permission-system] is not permitted to run 'bash' command 'rm -rf /'.",
      );
    });

    test("bash with command and matched pattern", () => {
      expect(
        formatDenyReason(
          toolCtx(
            toolCheck("bash", {
              command: "rm -rf /",
              matchedPattern: "rm *",
            }),
          ),
        ),
      ).toBe(
        "[pi-permission-system] is not permitted to run 'bash' command 'rm -rf /' (matched 'rm *').",
      );
    });

    test("bash with custom reason appended to the message", () => {
      expect(
        formatDenyReason(
          toolCtx(
            toolCheck("bash", {
              command: "npm install",
              matchedPattern: "npm *",
              reason: "Use pnpm instead",
            }),
          ),
        ),
      ).toBe(
        "[pi-permission-system] is not permitted to run 'bash' command 'npm install' (matched 'npm *'). Reason: Use pnpm instead.",
      );
    });

    test("generic tool with custom reason but no matched pattern", () => {
      expect(
        formatDenyReason(
          toolCtx(
            toolCheck("write", {
              reason: "Write access is disabled for security",
            }),
          ),
        ),
      ).toBe(
        "[pi-permission-system] is not permitted to run 'write'. Reason: Write access is disabled for security.",
      );
    });

    test("reason with agent name is included", () => {
      expect(
        formatDenyReason(
          toolCtx(
            toolCheck("bash", {
              command: "yarn build",
              matchedPattern: "yarn *",
              reason: "Use pnpm instead",
            }),
            "dev-agent",
          ),
        ),
      ).toBe(
        "[pi-permission-system] Agent 'dev-agent' is not permitted to run 'bash' command 'yarn build' (matched 'yarn *'). Reason: Use pnpm instead.",
      );
    });

    test("MCP target with custom reason", () => {
      expect(
        formatDenyReason(
          toolCtx(
            mcpCheck("server:deploy", {
              reason: "Deploy requires approval from a senior engineer",
            }),
          ),
        ),
      ).toBe(
        "[pi-permission-system] is not permitted to run MCP target 'server:deploy'. Reason: Deploy requires approval from a senior engineer.",
      );
    });

    test("bash with nested execution context", () => {
      expect(
        formatDenyReason(
          toolCtx(
            toolCheck("bash", {
              command: "rm -rf foo",
              matchedPattern: "rm *",
              commandContext: "command_substitution",
            }),
          ),
        ),
      ).toBe(
        "[pi-permission-system] is not permitted to run 'bash' command 'rm -rf foo' (matched 'rm *', inside command substitution).",
      );
    });

    test("MCP source with target on non-mcp toolName", () => {
      expect(
        formatDenyReason(
          toolCtx(
            toolCheck("anything", { source: "mcp", target: "server:tool" }),
          ),
        ),
      ).toBe(
        "[pi-permission-system] is not permitted to run MCP target 'server:tool'.",
      );
    });
  });

  describe("path context", () => {
    test("without agent", () => {
      expect(
        formatDenyReason({
          kind: "path",
          toolName: "read",
          pathValue: "/etc/passwd",
        }),
      ).toBe(
        "[pi-permission-system] Current agent is not permitted to access path '/etc/passwd' via tool 'read'.",
      );
    });

    test("with agent", () => {
      expect(
        formatDenyReason({
          kind: "path",
          toolName: "read",
          pathValue: "/etc/passwd",
          agentName: "sec-agent",
        }),
      ).toBe(
        "[pi-permission-system] Agent 'sec-agent' is not permitted to access path '/etc/passwd' via tool 'read'.",
      );
    });
  });

  describe("external_directory context", () => {
    test("without agent", () => {
      expect(
        formatDenyReason({
          kind: "external_directory",
          toolName: "read",
          pathValue: "/etc/passwd",
          cwd: "/project",
        }),
      ).toBe(
        "[pi-permission-system] Current agent is not permitted to run tool 'read' for path '/etc/passwd' outside working directory '/project'.",
      );
    });

    test("with agent", () => {
      expect(
        formatDenyReason({
          kind: "external_directory",
          toolName: "read",
          pathValue: "/etc/passwd",
          cwd: "/project",
          agentName: "sec-agent",
        }),
      ).toBe(
        "[pi-permission-system] Agent 'sec-agent' is not permitted to run tool 'read' for path '/etc/passwd' outside working directory '/project'.",
      );
    });
  });

  describe("bash_external_directory context", () => {
    test("single path without agent", () => {
      expect(
        formatDenyReason({
          kind: "bash_external_directory",
          command: "cat /etc/hosts",
          externalPaths: ["/etc/hosts"],
          cwd: "/project",
        }),
      ).toBe(
        "[pi-permission-system] Current agent is not permitted to run bash command 'cat /etc/hosts' which references path(s) outside working directory '/project': /etc/hosts.",
      );
    });

    test("multiple paths with agent", () => {
      expect(
        formatDenyReason({
          kind: "bash_external_directory",
          command: "cp /etc/hosts /tmp/out",
          externalPaths: ["/etc/hosts", "/tmp/out"],
          cwd: "/project",
          agentName: "my-agent",
        }),
      ).toBe(
        "[pi-permission-system] Agent 'my-agent' is not permitted to run bash command 'cp /etc/hosts /tmp/out' which references path(s) outside working directory '/project': /etc/hosts, /tmp/out.",
      );
    });
  });

  describe("bash_path context", () => {
    test("without agent", () => {
      expect(
        formatDenyReason({
          kind: "bash_path",
          command: "cat /etc/passwd",
          pathValue: "/etc/passwd",
        }),
      ).toBe(
        "[pi-permission-system] Current agent is not permitted to access path '/etc/passwd' via tool 'bash'.",
      );
    });

    test("with agent", () => {
      expect(
        formatDenyReason({
          kind: "bash_path",
          command: "cat /etc/passwd",
          pathValue: "/etc/passwd",
          agentName: "my-agent",
        }),
      ).toBe(
        "[pi-permission-system] Agent 'my-agent' is not permitted to access path '/etc/passwd' via tool 'bash'.",
      );
    });
  });

  describe("skill_read context", () => {
    test("without agent", () => {
      expect(
        formatDenyReason({
          kind: "skill_read",
          skillName: "librarian",
          readPath: "/skills/librarian/SKILL.md",
        }),
      ).toBe(
        "[pi-permission-system] Current agent is not permitted to access skill 'librarian' via '/skills/librarian/SKILL.md'.",
      );
    });

    test("with agent", () => {
      expect(
        formatDenyReason({
          kind: "skill_read",
          skillName: "librarian",
          readPath: "/skills/librarian/SKILL.md",
          agentName: "my-agent",
        }),
      ).toBe(
        "[pi-permission-system] Agent 'my-agent' is not permitted to access skill 'librarian' via '/skills/librarian/SKILL.md'.",
      );
    });
  });

  describe("skill_input context", () => {
    test("without agent", () => {
      expect(
        formatDenyReason({
          kind: "skill_input",
          skillName: "librarian",
        }),
      ).toBe(
        "[pi-permission-system] Current agent is not permitted to access skill 'librarian'.",
      );
    });

    test("with agent", () => {
      expect(
        formatDenyReason({
          kind: "skill_input",
          skillName: "librarian",
          agentName: "my-agent",
        }),
      ).toBe(
        "[pi-permission-system] Agent 'my-agent' is not permitted to access skill 'librarian'.",
      );
    });
  });
});

// ── formatUnavailableReason ────────────────────────────────────────────────

describe("formatUnavailableReason", () => {
  test("generic tool", () => {
    expect(formatUnavailableReason(toolCtx(toolCheck("write")))).toBe(
      "[pi-permission-system] Using tool 'write' requires approval, but no interactive UI is available.",
    );
  });

  test("bash with command", () => {
    expect(
      formatUnavailableReason(
        toolCtx(toolCheck("bash", { command: "git push" })),
      ),
    ).toBe(
      "[pi-permission-system] Running bash command 'git push' requires approval, but no interactive UI is available.",
    );
  });

  test("mcp", () => {
    expect(formatUnavailableReason(toolCtx(mcpCheck("server:tool")))).toBe(
      "[pi-permission-system] Using tool 'mcp' requires approval, but no interactive UI is available.",
    );
  });

  test("path", () => {
    expect(
      formatUnavailableReason({
        kind: "path",
        toolName: "read",
        pathValue: "/etc/passwd",
      }),
    ).toBe(
      "[pi-permission-system] Accessing '/etc/passwd' requires approval, but no interactive UI is available.",
    );
  });

  test("external_directory", () => {
    expect(
      formatUnavailableReason({
        kind: "external_directory",
        toolName: "read",
        pathValue: "/etc/passwd",
        cwd: "/project",
      }),
    ).toBe(
      "[pi-permission-system] Accessing '/etc/passwd' outside the working directory requires approval, but no interactive UI is available.",
    );
  });

  test("bash_external_directory", () => {
    expect(
      formatUnavailableReason({
        kind: "bash_external_directory",
        command: "cat /etc/hosts",
        externalPaths: ["/etc/hosts"],
        cwd: "/project",
      }),
    ).toBe(
      "[pi-permission-system] Bash command 'cat /etc/hosts' references path(s) outside the working directory and requires approval, but no interactive UI is available.",
    );
  });

  test("bash_path", () => {
    expect(
      formatUnavailableReason({
        kind: "bash_path",
        command: "cat /etc/passwd",
        pathValue: "/etc/passwd",
      }),
    ).toBe(
      "[pi-permission-system] Bash command 'cat /etc/passwd' accesses path '/etc/passwd' which requires approval, but no interactive UI is available.",
    );
  });

  test("skill_read", () => {
    expect(
      formatUnavailableReason({
        kind: "skill_read",
        skillName: "librarian",
        readPath: "/skills/librarian/SKILL.md",
      }),
    ).toBe(
      "[pi-permission-system] Accessing skill 'librarian' requires approval, but no interactive UI is available.",
    );
  });

  test("skill_input", () => {
    expect(
      formatUnavailableReason({
        kind: "skill_input",
        skillName: "librarian",
      }),
    ).toBe(
      "[pi-permission-system] Accessing skill 'librarian' requires approval, but no interactive UI is available.",
    );
  });
});

// ── formatUserDeniedReason ─────────────────────────────────────────────────

describe("formatUserDeniedReason", () => {
  describe("tool context", () => {
    test("generic tool without reason", () => {
      expect(formatUserDeniedReason(toolCtx(toolCheck("write")))).toBe(
        "[pi-permission-system] User denied tool 'write'.",
      );
    });

    test("generic tool with reason", () => {
      expect(
        formatUserDeniedReason(toolCtx(toolCheck("write")), "too risky"),
      ).toBe(
        "[pi-permission-system] User denied tool 'write'. Reason: too risky.",
      );
    });

    test("bash with command", () => {
      expect(
        formatUserDeniedReason(
          toolCtx(toolCheck("bash", { command: "ls -la" })),
        ),
      ).toBe("[pi-permission-system] User denied bash command 'ls -la'.");
    });

    test("MCP target", () => {
      expect(formatUserDeniedReason(toolCtx(mcpCheck("server:query")))).toBe(
        "[pi-permission-system] User denied MCP target 'server:query'.",
      );
    });
  });

  describe("path context", () => {
    test("without reason", () => {
      expect(
        formatUserDeniedReason({
          kind: "path",
          toolName: "read",
          pathValue: "/etc/passwd",
        }),
      ).toBe(
        "[pi-permission-system] User denied access to path '/etc/passwd'.",
      );
    });

    test("with reason", () => {
      expect(
        formatUserDeniedReason(
          { kind: "path", toolName: "read", pathValue: "/etc/passwd" },
          "sensitive",
        ),
      ).toBe(
        "[pi-permission-system] User denied access to path '/etc/passwd'. Reason: sensitive.",
      );
    });
  });

  describe("external_directory context", () => {
    test("without reason", () => {
      expect(
        formatUserDeniedReason({
          kind: "external_directory",
          toolName: "edit",
          pathValue: "/etc/hosts",
          cwd: "/project",
        }),
      ).toBe(
        "[pi-permission-system] User denied external directory access for tool 'edit' path '/etc/hosts'.",
      );
    });

    test("with reason", () => {
      expect(
        formatUserDeniedReason(
          {
            kind: "external_directory",
            toolName: "edit",
            pathValue: "/etc/hosts",
            cwd: "/project",
          },
          "too risky",
        ),
      ).toBe(
        "[pi-permission-system] User denied external directory access for tool 'edit' path '/etc/hosts'. Reason: too risky.",
      );
    });
  });

  describe("bash_external_directory context", () => {
    test("without reason", () => {
      expect(
        formatUserDeniedReason({
          kind: "bash_external_directory",
          command: "rm /etc/hosts",
          externalPaths: ["/etc/hosts"],
          cwd: "/project",
        }),
      ).toBe(
        "[pi-permission-system] User denied external directory access for bash command 'rm /etc/hosts'.",
      );
    });

    test("with reason", () => {
      expect(
        formatUserDeniedReason(
          {
            kind: "bash_external_directory",
            command: "rm /etc/hosts",
            externalPaths: ["/etc/hosts"],
            cwd: "/project",
          },
          "dangerous",
        ),
      ).toBe(
        "[pi-permission-system] User denied external directory access for bash command 'rm /etc/hosts'. Reason: dangerous.",
      );
    });
  });

  describe("bash_path context", () => {
    test("without reason", () => {
      expect(
        formatUserDeniedReason({
          kind: "bash_path",
          command: "cat /etc/passwd",
          pathValue: "/etc/passwd",
        }),
      ).toBe(
        "[pi-permission-system] User denied path access for bash command 'cat /etc/passwd' (path '/etc/passwd').",
      );
    });

    test("with reason", () => {
      expect(
        formatUserDeniedReason(
          {
            kind: "bash_path",
            command: "cat /etc/passwd",
            pathValue: "/etc/passwd",
          },
          "sensitive",
        ),
      ).toBe(
        "[pi-permission-system] User denied path access for bash command 'cat /etc/passwd' (path '/etc/passwd'). Reason: sensitive.",
      );
    });
  });

  describe("skill_read context", () => {
    test("without reason", () => {
      expect(
        formatUserDeniedReason({
          kind: "skill_read",
          skillName: "librarian",
          readPath: "/skills/librarian/SKILL.md",
        }),
      ).toBe("[pi-permission-system] User denied access to skill 'librarian'.");
    });

    test("with reason", () => {
      expect(
        formatUserDeniedReason(
          {
            kind: "skill_read",
            skillName: "librarian",
            readPath: "/skills/librarian/SKILL.md",
          },
          "not needed",
        ),
      ).toBe(
        "[pi-permission-system] User denied access to skill 'librarian'. Reason: not needed.",
      );
    });
  });

  describe("skill_input context", () => {
    test("without agent and without reason", () => {
      expect(
        formatUserDeniedReason({
          kind: "skill_input",
          skillName: "librarian",
        }),
      ).toBe("[pi-permission-system] User denied access to skill 'librarian'.");
    });

    test("with agent and with reason", () => {
      expect(
        formatUserDeniedReason(
          {
            kind: "skill_input",
            skillName: "librarian",
            agentName: "code-agent",
          },
          "not permitted",
        ),
      ).toBe(
        "[pi-permission-system] User denied access to skill 'librarian'. Reason: not permitted.",
      );
    });
  });
});
