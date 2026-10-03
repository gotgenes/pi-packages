import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRunCommand = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/process", () => ({
  runCommand: mockRunCommand,
  sleep: vi.fn().mockResolvedValue(undefined),
}));

import { closeIssue } from "#src/lib/issue";

beforeEach(() => {
  mockRunCommand.mockReset();
});

function mockGh(stdout = "") {
  mockRunCommand.mockResolvedValueOnce({
    stdout,
    stderr: "",
    exitCode: 0,
  });
}

describe("closeIssue", () => {
  it("closes an issue with default reason", async () => {
    mockGh(); // gh issue close
    const result = await closeIssue({ issueNumber: 42 });
    expect(result).toContain("Closed issue #42");
    expect(result).toContain("completed");
  });

  it("closes an issue with a comment", async () => {
    mockGh();
    const result = await closeIssue({
      issueNumber: 42,
      comment: "Done!",
    });
    expect(result).toContain("Closed issue #42");
    // Verify the comment arg was passed
    const callArgs = mockRunCommand.mock.calls[0][0].args;
    expect(callArgs).toContain("--comment");
    expect(callArgs).toContain("Done!");
  });

  it("normalizes not_planned reason", async () => {
    mockGh();
    const result = await closeIssue({
      issueNumber: 42,
      reason: "not_planned",
    });
    expect(result).toContain("not_planned");
    // gh CLI expects "not planned" (with space)
    const callArgs = mockRunCommand.mock.calls[0][0].args;
    expect(callArgs).toContain("not planned");
  });

  it("rejects 'not planned' with space", async () => {
    await expect(
      closeIssue({ issueNumber: 42, reason: "not planned" }),
    ).rejects.toThrow(/not_planned/);
  });

  it("rejects invalid reason", async () => {
    await expect(
      closeIssue({ issueNumber: 42, reason: "invalid" }),
    ).rejects.toThrow(/Invalid reason/);
  });

  it("threads signal to gh call", async () => {
    mockGh();
    const controller = new AbortController();
    await closeIssue({ issueNumber: 42, signal: controller.signal });
    expect(mockRunCommand).toHaveBeenCalledWith({
      cmd: "gh",
      args: ["issue", "close", "42", "--reason", "completed"],
      signal: controller.signal,
    });
  });

  describe("commit SHA validation", () => {
    const shortSha = "abc1234";
    const otherSha = "deadbee";
    const fullSha = "0123456789abcdef0123456789abcdef01234567";

    function mockCommand(stdout = "", stderr = "", exitCode = 0) {
      mockRunCommand.mockResolvedValueOnce({ stdout, stderr, exitCode });
    }

    function gitCalls(): { args: string[]; signal: AbortSignal | undefined }[] {
      return mockRunCommand.mock.calls
        .filter((call) => call[0].cmd === "git")
        .map((call) => ({
          args: call[0].args as string[],
          signal: call[0].signal as AbortSignal | undefined,
        }));
    }

    it("does not run git when the comment is missing", async () => {
      mockGh();
      const result = await closeIssue({ issueNumber: 42 });
      expect(result).toContain("Closed issue #42");
      expect(mockRunCommand.mock.calls.map((call) => call[0].cmd)).toEqual([
        "gh",
      ]);
    });

    it("does not run git when the comment is empty", async () => {
      mockGh();
      const result = await closeIssue({ issueNumber: 42, comment: "" });
      expect(result).toContain("Closed issue #42");
      expect(mockRunCommand).toHaveBeenCalledWith({
        cmd: "gh",
        args: ["issue", "close", "42", "--reason", "completed"],
        signal: undefined,
      });
    });

    it("does not run git for ordinary prose", async () => {
      mockGh();
      const comment = "Fixed the close path.";
      const result = await closeIssue({ issueNumber: 42, comment });
      expect(result).toContain("Closed issue #42");
      expect(mockRunCommand).toHaveBeenCalledTimes(1);
      expect(mockRunCommand).toHaveBeenCalledWith({
        cmd: "gh",
        args: [
          "issue",
          "close",
          "42",
          "--reason",
          "completed",
          "--comment",
          comment,
        ],
        signal: undefined,
      });
    });

    it("resolves 7- and 40-character tokens once, then closes with the original comment", async () => {
      expect(shortSha).toHaveLength(7);
      expect(fullSha).toHaveLength(40);
      const comment = `Landed in ${shortSha}. Also (${fullSha}); see \`${shortSha}\` and https://github.com/o/r/commit/${fullSha}.\n`;
      mockCommand(`${shortSha}\n`);
      mockCommand(`${fullSha}\n`);
      mockGh();

      const result = await closeIssue({ issueNumber: 42, comment });

      expect(result).toBe("Closed issue #42 (reason: completed)");
      expect(gitCalls()).toEqual([
        {
          args: ["rev-parse", "--verify", `${shortSha}^{commit}`],
          signal: undefined,
        },
        {
          args: ["rev-parse", "--verify", `${fullSha}^{commit}`],
          signal: undefined,
        },
      ]);
      expect(mockRunCommand).toHaveBeenLastCalledWith({
        cmd: "gh",
        args: [
          "issue",
          "close",
          "42",
          "--reason",
          "completed",
          "--comment",
          comment,
        ],
        signal: undefined,
      });
    });

    it("checks a repeated token once and names every distinct failure without calling gh", async () => {
      const comment = `${shortSha} ${otherSha} ${shortSha} ${fullSha}`;
      mockRunCommand.mockResolvedValue({
        stdout: "",
        stderr: "fatal: bad object",
        exitCode: 128,
      });

      await expect(closeIssue({ issueNumber: 42, comment })).rejects.toThrow(
        new RegExp(
          `Unresolved commit SHA\\(s\\) in the close comment: ${shortSha}, ${otherSha}, ${fullSha}\\.`,
        ),
      );
      expect(gitCalls().map((call) => call.args)).toEqual([
        ["rev-parse", "--verify", `${shortSha}^{commit}`],
        ["rev-parse", "--verify", `${otherSha}^{commit}`],
        ["rev-parse", "--verify", `${fullSha}^{commit}`],
      ]);
      expect(
        mockRunCommand.mock.calls.map((call) => call[0].cmd),
      ).not.toContain("gh");
    });

    it("does not call gh when an earlier token resolved and a later one did not", async () => {
      mockCommand(`${shortSha}\n`);
      mockRunCommand.mockResolvedValueOnce({
        stdout: "",
        stderr: "fatal: bad object",
        exitCode: 128,
      });

      const caught: unknown = await closeIssue({
        issueNumber: 42,
        comment: `${shortSha} then ${otherSha}`,
      }).catch((error: unknown) => error);

      expect(caught).toBeInstanceOf(Error);
      if (!(caught instanceof Error)) {
        throw new Error("expected closeIssue to throw an Error");
      }
      expect(caught.message).toContain(
        `Unresolved commit SHA(s) in the close comment: ${otherSha}.`,
      );
      expect(caught.message).not.toContain(shortSha);
      expect(gitCalls().map((call) => call.args[2])).toEqual([
        `${shortSha}^{commit}`,
        `${otherSha}^{commit}`,
      ]);
      expect(
        mockRunCommand.mock.calls.map((call) => call[0].cmd),
      ).not.toContain("gh");
    });

    it("checks a fabricated 40-character token in full rather than its prefix", async () => {
      const prefix = "abc1234";
      const fabricated = `${prefix}${"d".repeat(33)}`;
      expect(fabricated).toHaveLength(40);
      mockRunCommand.mockResolvedValue({
        stdout: "",
        stderr: "fatal: bad object",
        exitCode: 128,
      });

      await expect(
        closeIssue({ issueNumber: 42, comment: `see ${fabricated}` }),
      ).rejects.toThrow(
        new RegExp(
          `Unresolved commit SHA\\(s\\) in the close comment: ${fabricated}\\.`,
        ),
      );
      expect(gitCalls().map((call) => call.args)).toEqual([
        ["rev-parse", "--verify", `${fabricated}^{commit}`],
      ]);
      expect(
        mockRunCommand.mock.calls.map((call) => call[0].cmd),
      ).not.toContain("gh");
    });

    it("ignores 6-character, 41-character, uppercase, and embedded tokens", async () => {
      const comment = [
        "abcdef",
        "a".repeat(41),
        "ABCDEF1",
        "A".repeat(40),
        "zzabc1234zz",
        "pre_abc1234",
      ].join(" ");
      mockGh();

      const result = await closeIssue({ issueNumber: 42, comment });

      expect(result).toContain("Closed issue #42");
      expect(gitCalls()).toEqual([]);
      expect(mockRunCommand).toHaveBeenCalledWith({
        cmd: "gh",
        args: [
          "issue",
          "close",
          "42",
          "--reason",
          "completed",
          "--comment",
          comment,
        ],
        signal: undefined,
      });
    });

    it("requires ^{commit} resolution and refuses a non-commit or ambiguous object", async () => {
      mockRunCommand.mockResolvedValueOnce({
        stdout: "",
        stderr: "fatal: needed a single revision",
        exitCode: 128,
      });
      mockRunCommand.mockResolvedValueOnce({
        stdout: "",
        stderr: "fatal: ambiguous argument",
        exitCode: 128,
      });

      await expect(
        closeIssue({
          issueNumber: 42,
          comment: `${shortSha} ${otherSha}`,
        }),
      ).rejects.toThrow(
        new RegExp(
          `Unresolved commit SHA\\(s\\) in the close comment: ${shortSha}, ${otherSha}\\.`,
        ),
      );
      expect(gitCalls().map((call) => call.args)).toEqual([
        ["rev-parse", "--verify", `${shortSha}^{commit}`],
        ["rev-parse", "--verify", `${otherSha}^{commit}`],
      ]);
      expect(
        mockRunCommand.mock.calls.map((call) => call[0].cmd),
      ).not.toContain("gh");
    });

    it("names the candidate and does not close when git fails to launch", async () => {
      mockRunCommand.mockRejectedValue(new Error("spawn git ENOENT"));

      await expect(
        closeIssue({
          issueNumber: 42,
          comment: `see ${shortSha} and ${otherSha}`,
        }),
      ).rejects.toThrow(
        new RegExp(
          `Unresolved commit SHA\\(s\\) in the close comment: ${shortSha}, ${otherSha}\\.[\\s\\S]*spawn git ENOENT`,
        ),
      );
      expect(mockRunCommand.mock.calls.map((call) => call[0].cmd)).toEqual([
        "git",
        "git",
      ]);
    });

    it("names the candidate and does not close when the checkout is missing", async () => {
      mockRunCommand.mockResolvedValue({
        stdout: "",
        stderr: "fatal: not a git repository",
        exitCode: 128,
      });

      await expect(
        closeIssue({ issueNumber: 42, comment: `see ${shortSha}` }),
      ).rejects.toThrow(/abc1234[\s\S]*not a git repository/);
      expect(mockRunCommand.mock.calls.map((call) => call[0].cmd)).toEqual([
        "git",
      ]);
    });

    it("skips git and posts the original comment when skipShaValidation is true", async () => {
      const comment = `Foreign ${"deadbeef".repeat(5)} stays.\n`;
      mockGh();

      const result = await closeIssue({
        issueNumber: 42,
        comment,
        skipShaValidation: true,
      });

      expect(result).toContain("Closed issue #42");
      expect(mockRunCommand).toHaveBeenCalledTimes(1);
      expect(mockRunCommand).toHaveBeenCalledWith({
        cmd: "gh",
        args: [
          "issue",
          "close",
          "42",
          "--reason",
          "completed",
          "--comment",
          comment,
        ],
        signal: undefined,
      });
    });

    it("refuses a foreign SHA when skipShaValidation is omitted", async () => {
      const foreign = "deadbeef".repeat(5);
      mockRunCommand.mockResolvedValue({
        stdout: "",
        stderr: "fatal: bad object",
        exitCode: 128,
      });

      await expect(
        closeIssue({ issueNumber: 42, comment: `See ${foreign} elsewhere.` }),
      ).rejects.toThrow(
        new RegExp(
          `Unresolved commit SHA\\(s\\) in the close comment: ${foreign}\\.`,
        ),
      );
      expect(gitCalls().map((call) => call.args)).toEqual([
        ["rev-parse", "--verify", `${foreign}^{commit}`],
      ]);
      expect(
        mockRunCommand.mock.calls.map((call) => call[0].cmd),
      ).not.toContain("gh");
    });

    it("refuses a foreign SHA when skipShaValidation is false", async () => {
      const foreign = "deadbeef".repeat(5);
      mockRunCommand.mockResolvedValue({
        stdout: "",
        stderr: "fatal: bad object",
        exitCode: 128,
      });

      await expect(
        closeIssue({
          issueNumber: 42,
          comment: `See ${foreign} elsewhere.`,
          skipShaValidation: false,
        }),
      ).rejects.toThrow(
        new RegExp(
          `Unresolved commit SHA\\(s\\) in the close comment: ${foreign}\\.`,
        ),
      );
      expect(mockRunCommand.mock.calls.map((call) => call[0].cmd)).toEqual([
        "git",
      ]);
    });

    it("forwards the signal to every git call and to the close", async () => {
      const controller = new AbortController();
      const comment = `${shortSha} and ${otherSha}`;
      mockCommand(`${shortSha}\n`);
      mockCommand(`${otherSha}\n`);
      mockGh();

      await closeIssue({
        issueNumber: 42,
        comment,
        signal: controller.signal,
      });

      expect(mockRunCommand.mock.calls).toEqual([
        [
          {
            cmd: "git",
            args: ["rev-parse", "--verify", `${shortSha}^{commit}`],
            signal: controller.signal,
          },
        ],
        [
          {
            cmd: "git",
            args: ["rev-parse", "--verify", `${otherSha}^{commit}`],
            signal: controller.signal,
          },
        ],
        [
          {
            cmd: "gh",
            args: [
              "issue",
              "close",
              "42",
              "--reason",
              "completed",
              "--comment",
              comment,
            ],
            signal: controller.signal,
          },
        ],
      ]);
    });

    it("stops on abort without resolving later tokens or calling gh", async () => {
      const controller = new AbortController();
      const abortError = new DOMException(
        "The operation was aborted.",
        "AbortError",
      );
      mockRunCommand.mockImplementationOnce(() => {
        controller.abort(abortError);
        return Promise.reject(abortError);
      });

      await expect(
        closeIssue({
          issueNumber: 42,
          comment: `${shortSha} ${otherSha}`,
          signal: controller.signal,
        }),
      ).rejects.toBe(abortError);
      expect(gitCalls().map((call) => call.args)).toEqual([
        ["rev-parse", "--verify", `${shortSha}^{commit}`],
      ]);
      expect(
        mockRunCommand.mock.calls.map((call) => call[0].cmd),
      ).not.toContain("gh");
    });

    it("does not close when the signal aborts during a successful resolution", async () => {
      const controller = new AbortController();
      const abortError = new DOMException(
        "The operation was aborted.",
        "AbortError",
      );
      mockRunCommand.mockImplementationOnce(() => {
        controller.abort(abortError);
        return Promise.resolve({
          stdout: `${shortSha}\n`,
          stderr: "",
          exitCode: 0,
        });
      });

      await expect(
        closeIssue({
          issueNumber: 42,
          comment: `${shortSha} ${otherSha}`,
          signal: controller.signal,
        }),
      ).rejects.toBe(abortError);
      expect(mockRunCommand).toHaveBeenCalledTimes(1);
      expect(mockRunCommand.mock.calls[0][0].cmd).toBe("git");
    });

    it("does not run git or gh when the signal is already aborted", async () => {
      const controller = new AbortController();
      const abortError = new DOMException(
        "The operation was aborted.",
        "AbortError",
      );
      controller.abort(abortError);

      await expect(
        closeIssue({
          issueNumber: 42,
          comment: `${shortSha} ${otherSha}`,
          signal: controller.signal,
        }),
      ).rejects.toBe(abortError);
      expect(mockRunCommand).not.toHaveBeenCalled();
    });

    it("rejects an invalid reason before any subprocess", async () => {
      await expect(
        closeIssue({
          issueNumber: 42,
          reason: "invalid",
          comment: shortSha,
        }),
      ).rejects.toThrow(/Invalid reason/);
      expect(mockRunCommand).not.toHaveBeenCalled();
    });

    it("rejects 'not planned' before any subprocess", async () => {
      await expect(
        closeIssue({
          issueNumber: 42,
          reason: "not planned",
          comment: shortSha,
        }),
      ).rejects.toThrow(/not_planned/);
      expect(mockRunCommand).not.toHaveBeenCalled();
    });

    it("normalizes not_planned after commit SHAs resolve", async () => {
      const comment = `Wontfix ${shortSha}`;
      mockCommand(`${shortSha}\n`);
      mockGh();

      const result = await closeIssue({
        issueNumber: 42,
        reason: "not_planned",
        comment,
      });

      expect(result).toBe("Closed issue #42 (reason: not_planned)");
      expect(mockRunCommand.mock.calls).toEqual([
        [
          {
            cmd: "git",
            args: ["rev-parse", "--verify", `${shortSha}^{commit}`],
            signal: undefined,
          },
        ],
        [
          {
            cmd: "gh",
            args: [
              "issue",
              "close",
              "42",
              "--reason",
              "not planned",
              "--comment",
              comment,
            ],
            signal: undefined,
          },
        ],
      ]);
    });

    it("surfaces a GitHub close failure without retrying", async () => {
      mockCommand(`${shortSha}\n`);
      mockRunCommand.mockResolvedValueOnce({
        stdout: "",
        stderr: "HTTP 502",
        exitCode: 1,
      });

      await expect(
        closeIssue({ issueNumber: 42, comment: `landed ${shortSha}` }),
      ).rejects.toThrow(/HTTP 502/);
      expect(mockRunCommand.mock.calls.map((call) => call[0].cmd)).toEqual([
        "git",
        "gh",
      ]);
    });
  });
});
