import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeConfigValues } from "#src/config/config-file-writer";
import { createTmpFixture, type TmpFixture } from "#test/helpers/tmp-fixture";

describe("writeConfigValues", () => {
  let fixture: TmpFixture;
  let dir: string;
  let path: string;

  beforeEach(() => {
    fixture = createTmpFixture();
    dir = fixture.dir("config-file-writer-");
    path = join(dir, "config.json");
  });

  afterEach(() => {
    fixture.cleanup();
  });

  function readBack(): unknown {
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  describe("a file it may write", () => {
    it("creates an absent file holding the values", () => {
      expect(writeConfigValues(path, { debugLog: true })).toEqual({
        kind: "written",
      });
      expect(readBack()).toEqual({ debugLog: true });
    });

    it("keeps the keys of a valid file it does not set", () => {
      fixture.file(
        dir,
        "config.json",
        JSON.stringify({
          permission: { bash: { "rm *": "deny" } },
          debugLog: true,
        }),
      );

      expect(writeConfigValues(path, { debugLog: false })).toEqual({
        kind: "written",
      });
      expect(readBack()).toEqual({
        permission: { bash: { "rm *": "deny" } },
        debugLog: false,
      });
    });
  });

  describe("an existing file that fails to read, parse, or validate", () => {
    it("is refused when it holds an unknown key, and left byte-identical", () => {
      const original =
        '{\n  "permission": { "bash": { "rm *": "deny" } },\n  "typoKey": true\n}\n';
      fixture.file(dir, "config.json", original);

      expect(writeConfigValues(path, { yoloMode: true })).toEqual({
        kind: "refused",
        issues: ["Unrecognized config key 'typoKey'."],
      });
      expect(readFileSync(path, "utf-8")).toBe(original);
    });

    it("is refused when it is not JSON, and left byte-identical", () => {
      fixture.file(dir, "config.json", "not valid json {{{");

      const result = writeConfigValues(path, { yoloMode: true });

      expect(result.kind).toBe("refused");
      expect(result.kind === "refused" && result.issues).toEqual([
        expect.stringContaining(`Failed to read config at '${path}'`),
      ]);
      expect(readFileSync(path, "utf-8")).toBe("not valid json {{{");
    });

    it("is refused when it is empty", () => {
      fixture.file(dir, "config.json", "");

      expect(writeConfigValues(path, { yoloMode: true }).kind).toBe("refused");
      expect(readFileSync(path, "utf-8")).toBe("");
    });

    it("is refused when the path is a directory", () => {
      fixture.subdir(dir, "config.json");

      const result = writeConfigValues(path, { yoloMode: true });

      expect(result.kind).toBe("refused");
      expect(result.kind === "refused" && result.issues).toEqual([
        expect.stringContaining(`Failed to read config at '${path}'`),
      ]);
    });
  });

  describe("a result that would not validate", () => {
    it("is refused, and nothing is written", () => {
      expect(writeConfigValues(path, { debugLog: "on" })).toEqual({
        kind: "refused",
        issues: [
          "Invalid config value at 'debugLog': Invalid input: expected boolean, received string",
        ],
      });
      expect(existsSync(path)).toBe(false);
    });
  });

  describe("a write that fails", () => {
    it("reports the failure", () => {
      // A parent that is a regular file: creating the directory fails.
      const parent = fixture.file(dir, "not-a-directory");
      const result = writeConfigValues(join(parent, "config.json"), {
        debugLog: true,
      });
      expect(result.kind).toBe("failed");
    });
  });
});
