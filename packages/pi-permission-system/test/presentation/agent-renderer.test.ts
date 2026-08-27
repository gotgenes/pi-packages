import { describe, expect, it } from "vitest";
import {
  EXTENSION_TAG,
  renderPolicyDenial,
  renderUnavailableDenial,
  renderUserDenial,
} from "#src/presentation/agent-renderer";
import type { PromptPayload } from "#src/presentation/prompt-payload";
import { makePromptPayload } from "#test/helpers/prompt-details-fixtures";

/** A payload of the given kind, with request facts and evidence overridden. */
function payload(
  kind: PromptPayload["kind"],
  request: Partial<PromptPayload["request"]>,
  evidence: PromptPayload["evidence"] = [],
): PromptPayload {
  const base = makePromptPayload();
  return {
    ...base,
    kind,
    request: { ...base.request, ...request },
    evidence,
  };
}

/** A bash ask, the shape whose value the renderer must never echo. */
function bashPayload(
  request: Partial<PromptPayload["request"]> = {},
): PromptPayload {
  return payload("bash", {
    surface: "bash",
    toolName: "bash",
    value: "rm -rf build",
    matchedPattern: "rm *",
    ...request,
  });
}

describe("EXTENSION_TAG", () => {
  it("attributes every block reason to this extension", () => {
    expect(EXTENSION_TAG).toBe("[pi-permission-system]");
  });
});

describe("renderPolicyDenial", () => {
  it("names the surface and the matched rule for a bash deny", () => {
    expect(renderPolicyDenial(bashPayload(), null)).toBe(
      "[pi-permission-system] Denied by policy: 'bash' (rule 'rm *').",
    );
  });

  it("never echoes the command, however large", () => {
    const command = `cat <<'EOF' > gen.py\n${"x".repeat(70_000)}\nEOF`;
    const rendered = renderPolicyDenial(
      bashPayload({ value: command, matchedPattern: "*" }),
      null,
    );
    expect(rendered).toBe(
      "[pi-permission-system] Denied by policy: 'bash' (rule '*').",
    );
    expect(rendered).not.toContain("xxx");
  });

  it("names the tool when it differs from the surface", () => {
    expect(
      renderPolicyDenial(
        payload("path", {
          surface: "path",
          toolName: "read",
          value: "/etc/passwd",
          matchedPattern: "/etc/*",
        }),
        null,
      ),
    ).toBe(
      "[pi-permission-system] Denied by policy: 'path' for tool 'read' for path '/etc/passwd' (rule '/etc/*').",
    );
  });

  it("names the invoked tool when a shell alias re-exposed bash", () => {
    expect(
      renderPolicyDenial(
        bashPayload({ invokedToolName: "exec_command" }),
        null,
      ),
    ).toBe(
      "[pi-permission-system] Denied by policy: 'bash' (invoked as 'exec_command') (rule 'rm *').",
    );
  });

  it("names the requesting agent when the ask carries one", () => {
    expect(
      renderPolicyDenial(
        bashPayload({
          requester: { agentName: "scout", forwarded: false, sessionId: null },
        }),
        null,
      ),
    ).toBe(
      "[pi-permission-system] Denied by policy: 'bash' for agent 'scout' (rule 'rm *').",
    );
  });

  it("carries the operator's deny-with-reason text", () => {
    expect(renderPolicyDenial(bashPayload(), "destructive by policy")).toBe(
      "[pi-permission-system] Denied by policy: 'bash' (rule 'rm *'). Reason: destructive by policy.",
    );
  });

  it("names the nested context a bash unit ran in", () => {
    expect(
      renderPolicyDenial(
        bashPayload({ commandContext: "command_substitution" }),
        null,
      ),
    ).toBe(
      "[pi-permission-system] Denied by policy: 'bash' (rule 'rm *', inside command substitution).",
    );
  });

  it.each([
    "<indirection-bash-wrapper>",
    "<opaque-bash-wrapper>",
    "<unparseable-bash-command>",
  ])("surfaces the %s sentinel as the matched rule", (sentinel) => {
    expect(
      renderPolicyDenial(bashPayload({ matchedPattern: sentinel }), null),
    ).toBe(
      `[pi-permission-system] Denied by policy: 'bash' (rule '${sentinel}').`,
    );
  });

  it("omits the rule clause when no pattern matched", () => {
    expect(
      renderPolicyDenial(bashPayload({ matchedPattern: null }), null),
    ).toBe("[pi-permission-system] Denied by policy: 'bash'.");
  });

  it("names the escaped boundary for a tool external-directory deny", () => {
    expect(
      renderPolicyDenial(
        payload(
          "external_directory",
          {
            surface: "external_directory",
            toolName: "write",
            value: "/etc/hosts",
            matchedPattern: "*",
          },
          [{ label: "working directory", text: "/repo", detail: null }],
        ),
        null,
      ),
    ).toBe(
      "[pi-permission-system] Denied by policy: 'external_directory' for tool 'write' for path '/etc/hosts' (rule '*'): outside working directory '/repo'.",
    );
  });

  it("names the canonical target when a path resolves elsewhere", () => {
    expect(
      renderPolicyDenial(
        payload(
          "external_directory",
          {
            surface: "external_directory",
            toolName: "read",
            value: "link",
            matchedPattern: "*",
          },
          [
            { label: "resolves to", text: "/etc/shadow", detail: null },
            { label: "working directory", text: "/repo", detail: null },
          ],
        ),
        null,
      ),
    ).toBe(
      "[pi-permission-system] Denied by policy: 'external_directory' for tool 'read' for path 'link' (resolves to '/etc/shadow') (rule '*'): outside working directory '/repo'.",
    );
  });

  it("names every escaping path but not the command for a bash external-directory deny", () => {
    expect(
      renderPolicyDenial(
        payload(
          "bash_external_directory",
          {
            surface: "external_directory",
            toolName: "bash",
            value: "diff /etc/hosts ~/.ssh/config",
            matchedPattern: "*",
          },
          [
            { label: "working directory", text: "/repo", detail: null },
            { label: "external path", text: "/etc/hosts", detail: null },
            {
              label: "external path",
              text: "~/.ssh/config",
              detail: "/home/me/.ssh/config",
            },
          ],
        ),
        null,
      ),
    ).toBe(
      "[pi-permission-system] Denied by policy: 'external_directory' for tool 'bash' for paths '/etc/hosts', '~/.ssh/config' (resolves to '/home/me/.ssh/config') (rule '*'): outside working directory '/repo'.",
    );
  });

  it("names the MCP target", () => {
    expect(
      renderPolicyDenial(
        payload("mcp", {
          surface: "mcp",
          toolName: "mcp",
          value: "github:create_issue",
          matchedPattern: "github:*",
        }),
        null,
      ),
    ).toBe(
      "[pi-permission-system] Denied by policy: 'mcp' for target 'github:create_issue' (rule 'github:*').",
    );
  });

  it("names the skill", () => {
    expect(
      renderPolicyDenial(
        payload("skill", {
          surface: "skill",
          toolName: null,
          value: "deploy",
          matchedPattern: "deploy",
        }),
        null,
      ),
    ).toBe(
      "[pi-permission-system] Denied by policy: 'skill' for skill 'deploy' (rule 'deploy').",
    );
  });

  it("names the skill a read reached, and the path it reached it through", () => {
    expect(
      renderPolicyDenial(
        payload(
          "skill_read",
          {
            surface: "skill",
            toolName: null,
            value: "deploy",
            matchedPattern: "deploy",
          },
          [
            {
              label: "read path",
              text: ".pi/skills/deploy/SKILL.md",
              detail: null,
            },
          ],
        ),
        null,
      ),
    ).toBe(
      "[pi-permission-system] Denied by policy: 'skill' for skill 'deploy' (rule 'deploy'), reached via '.pi/skills/deploy/SKILL.md'.",
    );
  });

  it("states the tool once for a generic tool ask, whose value is its own name", () => {
    expect(
      renderPolicyDenial(
        payload("tool", {
          surface: "webfetch",
          toolName: "webfetch",
          value: "webfetch",
          matchedPattern: "web*",
        }),
        null,
      ),
    ).toBe(
      "[pi-permission-system] Denied by policy: 'webfetch' (rule 'web*').",
    );
  });

  it("names nothing beyond the surface for a payload-less forwarded relay", () => {
    expect(
      renderPolicyDenial(
        payload("forwarded", {
          surface: "bash",
          toolName: "bash",
          value: "rm -rf /",
          matchedPattern: "*",
        }),
        null,
      ),
    ).toBe("[pi-permission-system] Denied by policy: 'bash' (rule '*').");
  });
});

describe("renderUserDenial", () => {
  it("attributes the refusal to the user", () => {
    expect(renderUserDenial(bashPayload(), null)).toBe(
      "[pi-permission-system] The user denied this 'bash' call (rule 'rm *').",
    );
  });

  it("carries the human's typed reason", () => {
    expect(renderUserDenial(bashPayload(), "not with sudo")).toBe(
      "[pi-permission-system] The user denied this 'bash' call (rule 'rm *'). Reason: not with sudo.",
    );
  });

  it("never echoes the command", () => {
    const rendered = renderUserDenial(
      bashPayload({ value: "x".repeat(70_000), matchedPattern: "*" }),
      "too big",
    );
    expect(rendered).toBe(
      "[pi-permission-system] The user denied this 'bash' call (rule '*'). Reason: too big.",
    );
  });

  it("names the flagged path for a tool ask", () => {
    expect(
      renderUserDenial(
        payload("path", {
          surface: "path",
          toolName: "read",
          value: "/etc/passwd",
          matchedPattern: "/etc/*",
        }),
        "not that file",
      ),
    ).toBe(
      "[pi-permission-system] The user denied this 'path' call for tool 'read' for path '/etc/passwd' (rule '/etc/*'). Reason: not that file.",
    );
  });
});

describe("renderUnavailableDenial", () => {
  it("states that approval was required and unreachable", () => {
    expect(renderUnavailableDenial(bashPayload(), null)).toBe(
      "[pi-permission-system] This 'bash' call (rule 'rm *') requires approval, but no interactive UI is available.",
    );
  });

  it("carries an abandoning authority's reason", () => {
    expect(
      renderUnavailableDenial(
        bashPayload(),
        "Session 'parent-1' is not serving forwarded requests",
      ),
    ).toBe(
      "[pi-permission-system] This 'bash' call (rule 'rm *') requires approval, but no interactive UI is available. Reason: Session 'parent-1' is not serving forwarded requests.",
    );
  });

  it("names the flagged path for a tool ask", () => {
    expect(
      renderUnavailableDenial(
        payload("path", {
          surface: "path",
          toolName: "read",
          value: "/etc/passwd",
          matchedPattern: "/etc/*",
        }),
        null,
      ),
    ).toBe(
      "[pi-permission-system] This 'path' call for tool 'read' for path '/etc/passwd' (rule '/etc/*') requires approval, but no interactive UI is available.",
    );
  });

  it("omits the escaped boundary, which no retry shape would change", () => {
    expect(
      renderUnavailableDenial(
        payload(
          "external_directory",
          {
            surface: "external_directory",
            toolName: "write",
            value: "/etc/hosts",
            matchedPattern: "*",
          },
          [{ label: "working directory", text: "/repo", detail: null }],
        ),
        null,
      ),
    ).toBe(
      "[pi-permission-system] This 'external_directory' call for tool 'write' for path '/etc/hosts' (rule '*') requires approval, but no interactive UI is available.",
    );
  });
});

describe("the flagged-element field cap", () => {
  it("shortens an oversized path and marks it", () => {
    const long = `/etc/${"a".repeat(500)}`;
    const rendered = renderPolicyDenial(
      payload("path", {
        surface: "path",
        toolName: "read",
        value: long,
        matchedPattern: "*",
      }),
      null,
      { fieldMaxWidth: 20 },
    );
    expect(rendered).toBe(
      "[pi-permission-system] Denied by policy: 'path' for tool 'read' for path '/etc/aaaaaaaaaaaaaaa\u2026' (rule '*').",
    );
  });

  it("leaves a path within the budget untouched", () => {
    expect(
      renderPolicyDenial(
        payload("path", {
          surface: "path",
          toolName: "read",
          value: "/etc/hosts",
          matchedPattern: "*",
        }),
        null,
        { fieldMaxWidth: 400 },
      ),
    ).toBe(
      "[pi-permission-system] Denied by policy: 'path' for tool 'read' for path '/etc/hosts' (rule '*').",
    );
  });
});
