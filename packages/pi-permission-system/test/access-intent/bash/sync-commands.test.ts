import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resetWarmBashParser,
  warmBashParser,
} from "#src/access-intent/bash/parser";
import { parseBashCommandsSync } from "#src/access-intent/bash/sync-commands";

describe("parseBashCommandsSync", () => {
  beforeEach(() => {
    resetWarmBashParser();
  });
  afterEach(() => {
    resetWarmBashParser();
  });

  it("returns null when the parser is not warm", () => {
    expect(parseBashCommandsSync("echo hi")).toBeNull();
  });

  describe("once warm", () => {
    beforeEach(async () => {
      await warmBashParser();
    });

    it("returns a single unit for a lone command", () => {
      expect(parseBashCommandsSync("echo hi")).toEqual([{ text: "echo hi" }]);
    });

    it("decomposes a chained command into its units", () => {
      expect(parseBashCommandsSync("cd /repo && npm install x")).toEqual([
        { text: "cd /repo" },
        { text: "npm install x" },
      ]);
    });

    it("descends into a command substitution, tagging its context", () => {
      expect(parseBashCommandsSync("echo $(rm -rf /)")).toEqual([
        { text: "echo $(rm -rf /)" },
        { text: "rm -rf /", context: "command_substitution" },
      ]);
    });

    it("flags an opaque wrapper", () => {
      expect(parseBashCommandsSync('bash -c "rm -rf /"')).toEqual([
        {
          text: 'bash -c "rm -rf /"',
          wrapperKind: "opaque-payload",
          executedUnit: "rm -rf /",
        },
      ]);
    });

    it("returns an empty array for a comment-only command", () => {
      expect(parseBashCommandsSync("# just a comment")).toEqual([]);
    });

    it("returns an empty array for an empty command", () => {
      expect(parseBashCommandsSync("")).toEqual([]);
    });
  });
});
