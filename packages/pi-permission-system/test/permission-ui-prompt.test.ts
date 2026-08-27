import { describe, expect, it } from "vitest";

import { buildUiPrompt } from "#src/permission-ui-prompt";
import type { PromptRequestFacts } from "#src/presentation/prompt-payload";
import { makePromptPayload } from "#test/helpers/prompt-details-fixtures";

/** A payload whose request facts carry the given overrides. */
function payloadWith(request: Partial<PromptRequestFacts> = {}) {
  return makePromptPayload({
    request: { ...makePromptPayload().request, ...request },
  });
}

describe("buildUiPrompt", () => {
  it("normalizes a skill prompt to the skill surface and skill-name value", () => {
    const payload = payloadWith({ surface: "skill", value: "deploy-helper" });
    expect(
      buildUiPrompt({
        requestId: "req-2",
        source: "skill_input",
        agentName: null,
        payload,
        skillName: "deploy-helper",
      }),
    ).toEqual({
      requestId: "req-2",
      source: "skill_input",
      surface: "skill",
      value: "deploy-helper",
      agentName: null,
      request: payload.request,
      forwarding: null,
    });
  });

  it("derives value with command > path > target > skillName > toolName precedence", () => {
    expect(
      buildUiPrompt({
        requestId: "req-3",
        source: "tool_call",
        agentName: null,
        payload: makePromptPayload(),
        toolName: "read",
        path: "/etc/hosts",
        target: "ignored",
      }).value,
    ).toBe("/etc/hosts");
  });

  it("derives surface and value from direct fields and defaults forwarding to null", () => {
    const payload = payloadWith({
      surface: "bash",
      toolName: "bash",
      value: "git push",
      matchedPattern: "git *",
    });
    expect(
      buildUiPrompt({
        requestId: "req-u1",
        source: "tool_call",
        agentName: "Explore",
        payload,
        toolName: "bash",
        command: "git push",
      }),
    ).toEqual({
      requestId: "req-u1",
      source: "tool_call",
      surface: "bash",
      value: "git push",
      agentName: "Explore",
      request: payload.request,
      forwarding: null,
    });
  });

  it("carries the payload's invariant core verbatim, with no evidence or annotations", () => {
    const payload = makePromptPayload({
      kind: "bash",
      request: {
        requester: { agentName: "Explore", forwarded: false, sessionId: null },
        surface: "bash",
        toolName: "bash",
        invokedToolName: "exec_command",
        value: "git push",
        matchedPattern: "git *",
        commandContext: "subshell",
        executedUnit: "git push --force",
      },
      evidence: [{ label: "full command", text: "secret-ish", detail: null }],
      annotations: [{ source: "judge", text: "advisory" }],
    });

    const event = buildUiPrompt({
      requestId: "req-core",
      source: "tool_call",
      agentName: "Explore",
      payload,
      toolName: "bash",
      command: "git push",
    });

    expect(event.request).toEqual({
      requester: { agentName: "Explore", forwarded: false, sessionId: null },
      surface: "bash",
      toolName: "bash",
      invokedToolName: "exec_command",
      value: "git push",
      matchedPattern: "git *",
      commandContext: "subshell",
      executedUnit: "git push --force",
    });
    // The bus is the narrowest renderer (ADR 0011 §6): no evidence reaches it.
    expect(event).not.toHaveProperty("message");
    expect(event).not.toHaveProperty("evidence");
    expect(event).not.toHaveProperty("annotations");
  });

  it("uses explicit surface and value overrides in place of the derived projection", () => {
    const payload = payloadWith({ surface: "external_directory" });
    expect(
      buildUiPrompt({
        requestId: "req-u2",
        source: "tool_call",
        agentName: "Explore",
        payload,
        toolName: "bash",
        command: "git push",
        surface: "external_directory",
        value: "/etc/hosts",
      }),
    ).toEqual({
      requestId: "req-u2",
      source: "tool_call",
      surface: "external_directory",
      value: "/etc/hosts",
      agentName: "Explore",
      request: payload.request,
      forwarding: null,
    });
  });

  it("treats an explicit null surface/value override as intentional, not a fallback trigger", () => {
    const payload = makePromptPayload();
    expect(
      buildUiPrompt({
        requestId: "req-u3",
        source: "tool_call",
        agentName: null,
        payload,
        toolName: "bash",
        command: "git push",
        surface: null,
        value: null,
      }),
    ).toEqual({
      requestId: "req-u3",
      source: "tool_call",
      surface: null,
      value: null,
      agentName: null,
      request: payload.request,
      forwarding: null,
    });
  });

  it("passes forwarding context through alongside explicit display fields", () => {
    const payload = payloadWith({
      requester: {
        agentName: "Explore",
        forwarded: true,
        sessionId: "child-session",
      },
      surface: "bash",
      toolName: "bash",
      value: "git push",
    });
    expect(
      buildUiPrompt({
        requestId: "req-u4",
        source: "tool_call",
        agentName: "Explore",
        payload,
        surface: "bash",
        value: "git push",
        forwarding: {
          requesterAgentName: "Explore",
          requesterSessionId: "child-session",
        },
      }),
    ).toEqual({
      requestId: "req-u4",
      source: "tool_call",
      surface: "bash",
      value: "git push",
      agentName: "Explore",
      request: payload.request,
      forwarding: {
        requesterAgentName: "Explore",
        requesterSessionId: "child-session",
      },
    });
  });

  it("passes forwarding context with null requester identity through unchanged", () => {
    const payload = makePromptPayload();
    expect(
      buildUiPrompt({
        requestId: "req-fwd-null",
        source: "tool_call",
        agentName: null,
        payload,
        surface: null,
        value: null,
        forwarding: { requesterAgentName: null, requesterSessionId: null },
      }),
    ).toEqual({
      requestId: "req-fwd-null",
      source: "tool_call",
      surface: null,
      value: null,
      agentName: null,
      request: payload.request,
      forwarding: { requesterAgentName: null, requesterSessionId: null },
    });
  });
});
