import { describe, expect, it } from "vitest";
import type { PromptPayload } from "#src/presentation/prompt-payload";
import { renderReviewLogFacts } from "#src/presentation/review-log-renderer";
import { makePromptPayload } from "#test/helpers/prompt-details-fixtures";

/** A payload whose request facts override the structural fixture's defaults. */
function payload(
  request: Partial<PromptPayload["request"]>,
  rest: Partial<PromptPayload> = {},
): PromptPayload {
  const base = makePromptPayload();
  return { ...base, request: { ...base.request, ...request }, ...rest };
}

describe("renderReviewLogFacts", () => {
  it("records the gate surface and the rule that fired", () => {
    expect(
      renderReviewLogFacts(
        payload({ surface: "bash", toolName: "bash", matchedPattern: "rm *" }),
      ),
    ).toEqual({ surface: "bash", matchedPattern: "rm *" });
  });

  it("omits a fact the ask does not carry rather than writing a null", () => {
    expect(
      renderReviewLogFacts(payload({ surface: "skill", matchedPattern: null })),
    ).toEqual({ surface: "skill" });
  });

  it("records the unit a wrapper will actually run", () => {
    expect(
      renderReviewLogFacts(
        payload({
          surface: "bash",
          matchedPattern: "<indirection-bash-wrapper>",
          executedUnit: "aws s3 rm s3://bucket",
        }),
      ),
    ).toEqual({
      surface: "bash",
      matchedPattern: "<indirection-bash-wrapper>",
      executedUnit: "aws s3 rm s3://bucket",
    });
  });

  it("records the nested context an offending bash unit ran in", () => {
    expect(
      renderReviewLogFacts(
        payload({
          surface: "bash",
          matchedPattern: "*",
          commandContext: "command_substitution",
        }),
      ),
    ).toEqual({
      surface: "bash",
      matchedPattern: "*",
      commandContext: "command_substitution",
    });
  });

  it("records the name a shell alias invoked bash under", () => {
    expect(
      renderReviewLogFacts(
        payload({
          surface: "bash",
          matchedPattern: "*",
          invokedToolName: "exec_command",
        }),
      ),
    ).toEqual({
      surface: "bash",
      matchedPattern: "*",
      invokedToolName: "exec_command",
    });
  });

  it("records the requesting session when the ask was forwarded", () => {
    expect(
      renderReviewLogFacts(
        payload({
          surface: "bash",
          matchedPattern: "*",
          requester: {
            agentName: "scout",
            forwarded: true,
            sessionId: "child-7",
          },
        }),
      ),
    ).toEqual({
      surface: "bash",
      matchedPattern: "*",
      forwarded: true,
      requesterSessionId: "child-7",
    });
  });

  it("marks a local ask with no forwarding fields at all", () => {
    const facts = renderReviewLogFacts(payload({ surface: "read" }));
    expect(facts).toEqual({ surface: "read" });
  });

  it("persists no evidence and no annotations", () => {
    expect(
      renderReviewLogFacts(
        payload(
          { surface: "external_directory", matchedPattern: "*" },
          {
            evidence: [
              { label: "working directory", text: "/repo", detail: null },
              { label: "external path", text: "/etc/hosts", detail: null },
            ],
            annotations: [{ source: "judge", text: "looks risky" }],
          },
        ),
      ),
    ).toEqual({ surface: "external_directory", matchedPattern: "*" });
  });
});
