import { describe, expect, it } from "vitest";
import type { TerminalAuthorizer } from "#src/authority/authorizer";
import { DenyingAuthorizer } from "#src/authority/denying-authorizer";
import { makePromptDetails } from "#test/helpers/prompt-details-fixtures";

describe("DenyingAuthorizer", () => {
  it("denies with the confirmation-unavailable marker, regardless of details", async () => {
    const authorizer: TerminalAuthorizer = new DenyingAuthorizer();

    const decision = await authorizer.authorize(
      makePromptDetails({ agentName: "test-agent" }),
    );

    expect(decision).toEqual({
      approved: false,
      state: "denied",
      confirmationUnavailable: true,
      decidedBy: {
        kind: "unavailable",
        reason: "No live authority was reachable for this session",
      },
    });
  });

  it("denies the same way for a skill-sourced request", async () => {
    const authorizer: TerminalAuthorizer = new DenyingAuthorizer();

    const decision = await authorizer.authorize(
      makePromptDetails({
        requestId: "req-2",
        source: "skill_input",
        skillName: "deploy-helper",
      }),
    );

    expect(decision).toEqual({
      approved: false,
      state: "denied",
      confirmationUnavailable: true,
      decidedBy: {
        kind: "unavailable",
        reason: "No live authority was reachable for this session",
      },
    });
  });
});
