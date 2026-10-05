import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCloseIssue = vi.hoisted(() => vi.fn());

vi.mock("#src/lib/issue", () => ({
  closeIssue: mockCloseIssue,
}));

import { err, ok } from "#src/tool-result";
import { registerIssueClose } from "#src/tools/issue-close";

interface IssueCloseParams {
  issue_number: number;
  comment?: string;
  reason?: string;
  skip_sha_validation?: boolean;
}

interface IssueCloseTool {
  name: string;
  description: string;
  parameters: {
    required?: readonly string[];
    properties: Record<string, { type?: string; description?: string }>;
  };
  execute: (
    toolCallId: string,
    params: IssueCloseParams,
    signal?: AbortSignal,
  ) => Promise<ReturnType<typeof ok>>;
}

function captureIssueClose(): IssueCloseTool {
  let captured: IssueCloseTool | undefined;
  const pi = {
    registerTool(tool: IssueCloseTool) {
      captured = tool;
    },
  } as unknown as ExtensionAPI;
  registerIssueClose(pi);
  if (!captured) {
    throw new Error("issue_close was not registered");
  }
  return captured;
}

describe("issue_close tool", () => {
  let tool: IssueCloseTool;

  beforeEach(() => {
    mockCloseIssue.mockReset();
    tool = captureIssueClose();
  });

  it("exposes skip_sha_validation as an optional boolean", () => {
    expect(tool.name).toBe("issue_close");
    const skip = tool.parameters.properties.skip_sha_validation;
    expect(skip, JSON.stringify(tool.parameters)).toBeDefined();
    expect(skip.type).toBe("boolean");
    expect(tool.parameters.required ?? []).not.toContain("skip_sha_validation");
    expect(skip.description).toMatch(/Correct a typo/);
    expect(tool.description).toMatch(/skip_sha_validation/);
  });

  it("forwards skip_sha_validation and the other arguments", async () => {
    const controller = new AbortController();
    mockCloseIssue.mockResolvedValue("Closed issue #42 (reason: not_planned)");

    const result = await tool.execute(
      "call-1",
      {
        issue_number: 42,
        comment: "Done in abc1234",
        reason: "not_planned",
        skip_sha_validation: true,
      },
      controller.signal,
    );

    expect(result).toEqual(ok("Closed issue #42 (reason: not_planned)"));
    expect(mockCloseIssue).toHaveBeenCalledWith({
      issueNumber: 42,
      comment: "Done in abc1234",
      reason: "not_planned",
      skipShaValidation: true,
      signal: controller.signal,
    });
  });

  it("forwards an omitted skip flag as undefined and false as false", async () => {
    mockCloseIssue.mockResolvedValue("Closed issue #7 (reason: completed)");

    await tool.execute("call-1", { issue_number: 7 });
    expect(mockCloseIssue).toHaveBeenLastCalledWith({
      issueNumber: 7,
      comment: undefined,
      reason: undefined,
      skipShaValidation: undefined,
      signal: undefined,
    });

    await tool.execute("call-2", {
      issue_number: 7,
      skip_sha_validation: false,
    });
    expect(mockCloseIssue).toHaveBeenLastCalledWith({
      issueNumber: 7,
      comment: undefined,
      reason: undefined,
      skipShaValidation: false,
      signal: undefined,
    });
  });

  it("returns an error result when commit SHA validation refuses", async () => {
    const message =
      "Unresolved commit SHA(s) in the close comment: abc1234. Correct each token so `git rev-parse --verify <token>^{commit}` succeeds in this checkout.";
    mockCloseIssue.mockRejectedValue(new Error(message));

    const result = await tool.execute("call-1", {
      issue_number: 42,
      comment: "see abc1234",
    });

    expect(result).toEqual(err(message));
    expect(result.isError).toBe(true);
  });
});
