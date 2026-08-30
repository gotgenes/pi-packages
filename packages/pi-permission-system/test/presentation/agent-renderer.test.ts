import { describe, expect, it } from "vitest";
import type { DecisionSource } from "#src/authority/decision-source";
import {
  EXTENSION_TAG,
  renderAuthorizerDenial,
  renderEscalatedPolicyDenial,
  renderGateErrorDenial,
  renderPolicyDenial,
  renderRefusal,
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

describe("renderAuthorizerDenial", () => {
  it("attributes the refusal to the named link, not the user", () => {
    expect(renderAuthorizerDenial(bashPayload(), "model-judge", null)).toBe(
      "[pi-permission-system] The 'model-judge' authorizer denied this 'bash' call (rule 'rm *').",
    );
  });

  it("carries the link's corrective reason", () => {
    expect(
      renderAuthorizerDenial(
        payload(
          "external_directory",
          {
            surface: "external_directory",
            toolName: "read",
            value: "/elsewhere/service.test.ts",
            matchedPattern: "*",
          },
          [{ label: "working directory", text: "/repo", detail: null }],
        ),
        "model-judge",
        "Doubled package segment detected",
      ),
    ).toBe(
      "[pi-permission-system] The 'model-judge' authorizer denied this 'external_directory' call for tool 'read' for path '/elsewhere/service.test.ts' (rule '*'): outside working directory '/repo'. Reason: Doubled package segment detected.",
    );
  });

  it("never echoes the command", () => {
    expect(
      renderAuthorizerDenial(
        bashPayload({ value: "x".repeat(70_000), matchedPattern: "*" }),
        "model-judge",
        "too big",
      ),
    ).toBe(
      "[pi-permission-system] The 'model-judge' authorizer denied this 'bash' call (rule '*'). Reason: too big.",
    );
  });
});

describe("renderEscalatedPolicyDenial", () => {
  it("names the rule that decided, not the rule that raised the ask", () => {
    // The payload's own pattern is 'rm *'; the deciding node's is not.
    expect(
      renderEscalatedPolicyDenial(
        bashPayload(),
        { pattern: "git push --force*", decidedElsewhere: true },
        null,
      ),
    ).toBe(
      "[pi-permission-system] A policy rule in the session serving this request denied this 'bash' call (rule 'git push --force*').",
    );
  });

  it("carries the deciding rule's deny-with-reason text", () => {
    expect(
      renderEscalatedPolicyDenial(
        bashPayload(),
        { pattern: "git push --force*", decidedElsewhere: true },
        "force pushes are blocked",
      ),
    ).toBe(
      "[pi-permission-system] A policy rule in the session serving this request denied this 'bash' call (rule 'git push --force*'). Reason: force pushes are blocked.",
    );
  });

  it("omits the rule clause when the deciding node recorded no pattern", () => {
    expect(
      renderEscalatedPolicyDenial(
        bashPayload(),
        { pattern: null, decidedElsewhere: true },
        null,
      ),
    ).toBe(
      "[pi-permission-system] A policy rule in the session serving this request denied this 'bash' call.",
    );
  });

  it("claims no other session when the rule decided here", () => {
    expect(
      renderEscalatedPolicyDenial(
        bashPayload(),
        { pattern: "git push --force*", decidedElsewhere: false },
        null,
      ),
    ).toBe(
      "[pi-permission-system] A policy rule denied this 'bash' call (rule 'git push --force*').",
    );
  });

  it("keeps the nested context the substituted pattern fired in", () => {
    // The pattern comes from the decider; where the unit runs is a fact about
    // this call, so it still comes from the payload.
    expect(
      renderEscalatedPolicyDenial(
        bashPayload({ commandContext: "command_substitution" }),
        { pattern: "git push --force*", decidedElsewhere: true },
        null,
      ),
    ).toBe(
      "[pi-permission-system] A policy rule in the session serving this request denied this 'bash' call (rule 'git push --force*', inside command substitution).",
    );
  });

  it("names the escaped boundary for a path ask", () => {
    expect(
      renderEscalatedPolicyDenial(
        payload(
          "external_directory",
          {
            surface: "external_directory",
            toolName: "read",
            value: "/elsewhere/service.ts",
            matchedPattern: "*",
          },
          [{ label: "working directory", text: "/repo", detail: null }],
        ),
        { pattern: "/elsewhere/*", decidedElsewhere: true },
        null,
      ),
    ).toBe(
      "[pi-permission-system] A policy rule in the session serving this request denied this 'external_directory' call for tool 'read' for path '/elsewhere/service.ts' (rule '/elsewhere/*'): outside working directory '/repo'.",
    );
  });

  it("never echoes the command", () => {
    expect(
      renderEscalatedPolicyDenial(
        bashPayload({ value: "x".repeat(70_000) }),
        { pattern: "*", decidedElsewhere: true },
        "too big",
      ),
    ).toBe(
      "[pi-permission-system] A policy rule in the session serving this request denied this 'bash' call (rule '*'). Reason: too big.",
    );
  });
});

describe("renderGateErrorDenial", () => {
  it("states that the authority failed and the call was blocked fail-closed", () => {
    expect(
      renderGateErrorDenial(bashPayload(), {
        reason: "Cannot read properties of undefined",
        decidedElsewhere: true,
      }),
    ).toBe(
      "[pi-permission-system] The permission authority in the session serving this request failed to answer this 'bash' call (rule 'rm *'), so it was blocked (fail-closed). Reason: Cannot read properties of undefined.",
    );
  });

  it("claims no other session when the failure happened here", () => {
    expect(
      renderGateErrorDenial(bashPayload(), {
        reason: "boom",
        decidedElsewhere: false,
      }),
    ).toBe(
      "[pi-permission-system] The permission authority failed to answer this 'bash' call (rule 'rm *'), so it was blocked (fail-closed). Reason: boom.",
    );
  });

  it("omits the escaped boundary, which no retry shape would change", () => {
    expect(
      renderGateErrorDenial(
        payload(
          "external_directory",
          {
            surface: "external_directory",
            toolName: "read",
            value: "/elsewhere/service.ts",
            matchedPattern: "*",
          },
          [{ label: "working directory", text: "/repo", detail: null }],
        ),
        { reason: "boom", decidedElsewhere: true },
      ),
    ).toBe(
      "[pi-permission-system] The permission authority in the session serving this request failed to answer this 'external_directory' call for tool 'read' for path '/elsewhere/service.ts' (rule '*'), so it was blocked (fail-closed). Reason: boom.",
    );
  });

  it("never echoes the command", () => {
    expect(
      renderGateErrorDenial(
        bashPayload({ value: "x".repeat(70_000), matchedPattern: "*" }),
        { reason: "boom", decidedElsewhere: true },
      ),
    ).toBe(
      "[pi-permission-system] The permission authority in the session serving this request failed to answer this 'bash' call (rule '*'), so it was blocked (fail-closed). Reason: boom.",
    );
  });
});

describe("renderRefusal", () => {
  const link: DecisionSource = {
    kind: "authorizer",
    name: "model-judge",
    verdict: "deny",
    reason: "reads outside the project",
  };
  const human: DecisionSource = { kind: "user", via: "dialog" };
  const absent: DecisionSource = {
    kind: "unavailable",
    reason: "no serving session",
  };

  it("names the link when a chain link refused", () => {
    expect(renderRefusal(bashPayload(), link, "reads outside")).toBe(
      "[pi-permission-system] The 'model-judge' authorizer denied this 'bash' call (rule 'rm *'). Reason: reads outside.",
    );
  });

  it("names the user when a human refused", () => {
    expect(renderRefusal(bashPayload(), human, "not with sudo")).toBe(
      "[pi-permission-system] The user denied this 'bash' call (rule 'rm *'). Reason: not with sudo.",
    );
  });

  it("states that approval was unreachable when nobody could rule", () => {
    expect(renderRefusal(bashPayload(), absent, "no serving session")).toBe(
      "[pi-permission-system] This 'bash' call (rule 'rm *') requires approval, but no interactive UI is available. Reason: no serving session.",
    );
  });

  it("names the link that refused inside a serving session", () => {
    // The hop says where; the agent is told what refused.
    expect(
      renderRefusal(
        bashPayload(),
        { kind: "forwarded", responderSessionId: "parent-1", decision: link },
        "reads outside",
      ),
    ).toBe(
      "[pi-permission-system] The 'model-judge' authorizer denied this 'bash' call (rule 'rm *'). Reason: reads outside.",
    );
  });

  it("names the serving session's rule when its policy refused", () => {
    expect(
      renderRefusal(
        bashPayload(),
        {
          kind: "forwarded",
          responderSessionId: "parent-1",
          decision: {
            kind: "rule",
            surface: "bash",
            pattern: "git push",
            origin: "global",
          },
        },
        null,
      ),
    ).toBe(
      "[pi-permission-system] A policy rule in the session serving this request denied this 'bash' call (rule 'git push').",
    );
  });

  it("reports an escalation that threw in the serving session as a failure", () => {
    expect(
      renderRefusal(
        bashPayload(),
        {
          kind: "forwarded",
          responderSessionId: "parent-1",
          decision: { kind: "gate_error", reason: "boom" },
        },
        // The detail rides `decidedBy.reason`; this path carries no
        // `denialReason` at all, so a render reading it would say nothing.
        null,
      ),
    ).toBe(
      "[pi-permission-system] The permission authority in the session serving this request failed to answer this 'bash' call (rule 'rm *'), so it was blocked (fail-closed). Reason: boom.",
    );
  });

  it("claims no other session for a rule that decided here", () => {
    expect(
      renderRefusal(
        bashPayload(),
        {
          kind: "rule",
          surface: "bash",
          pattern: "git push",
          origin: "global",
        },
        null,
      ),
    ).toBe(
      "[pi-permission-system] A policy rule denied this 'bash' call (rule 'git push').",
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
