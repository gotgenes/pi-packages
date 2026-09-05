import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const mockHomedir = vi.hoisted(() => vi.fn(() => "/home/testuser"));

vi.mock("node:os", () => ({
  homedir: mockHomedir,
  default: { homedir: mockHomedir },
}));

import { expandHomePath } from "#src/path/expand-home";

const FAKE_HOME = "/home/testuser";

afterEach(() => {
  mockHomedir.mockClear();
});

describe("expandHomePath", () => {
  describe("~ expansion", () => {
    test("bare ~ expands to homedir()", () => {
      expect(expandHomePath("~")).toBe(FAKE_HOME);
    });

    test("~/path expands to homedir()/path", () => {
      expect(expandHomePath("~/dev/project")).toBe(
        join(FAKE_HOME, "dev/project"),
      );
    });

    test("~/path/* expands to homedir()/path/*", () => {
      expect(expandHomePath("~/dev/*")).toBe(join(FAKE_HOME, "dev/*"));
    });

    test("~\\ (Windows separator) expands to homedir() + rest", () => {
      expect(expandHomePath("~\\dev\\project")).toBe(
        join(FAKE_HOME, "dev\\project"),
      );
    });

    test("~username (no separator) is not expanded (no-op)", () => {
      expect(expandHomePath("~username")).toBe("~username");
    });
  });

  describe("$HOME expansion", () => {
    test("bare $HOME expands to homedir()", () => {
      expect(expandHomePath("$HOME")).toBe(FAKE_HOME);
    });

    test("$HOME/path expands to homedir()/path", () => {
      expect(expandHomePath("$HOME/dev/project")).toBe(
        join(FAKE_HOME, "dev/project"),
      );
    });

    test("$HOME/path/* expands to homedir()/path/*", () => {
      expect(expandHomePath("$HOME/dev/*")).toBe(join(FAKE_HOME, "dev/*"));
    });

    test("$HOME\\ (Windows separator) expands to homedir() + rest", () => {
      expect(expandHomePath("$HOME\\dev\\project")).toBe(
        join(FAKE_HOME, "dev\\project"),
      );
    });

    test("$HOMEDIR (no separator) is not expanded (no-op)", () => {
      expect(expandHomePath("$HOMEDIR")).toBe("$HOMEDIR");
    });
  });

  describe("${HOME} expansion", () => {
    test("bare ${HOME} expands to homedir()", () => {
      expect(expandHomePath("${HOME}")).toBe(FAKE_HOME);
    });

    test("${HOME}/path expands to homedir()/path", () => {
      expect(expandHomePath("${HOME}/dev/project")).toBe(
        join(FAKE_HOME, "dev/project"),
      );
    });

    test("${HOME}/path/* expands to homedir()/path/*", () => {
      expect(expandHomePath("${HOME}/dev/*")).toBe(join(FAKE_HOME, "dev/*"));
    });

    test("${HOME}\\ (Windows separator) expands to homedir() + rest", () => {
      expect(expandHomePath("${HOME}\\dev\\project")).toBe(
        join(FAKE_HOME, "dev\\project"),
      );
    });

    test("${HOMEDIR} is not expanded (no-op)", () => {
      expect(expandHomePath("${HOMEDIR}")).toBe("${HOMEDIR}");
    });

    test("${HOME:-/tmp} (parameter expansion with an operator) is not expanded", () => {
      expect(expandHomePath("${HOME:-/tmp}/x")).toBe("${HOME:-/tmp}/x");
    });

    test("${HOME (unterminated brace) is not expanded", () => {
      expect(expandHomePath("${HOME/dev")).toBe("${HOME/dev");
    });
  });

  describe("no-op patterns", () => {
    test("absolute path is unchanged", () => {
      expect(expandHomePath("/usr/local/bin")).toBe("/usr/local/bin");
    });

    test("relative path is unchanged", () => {
      expect(expandHomePath("dev/project")).toBe("dev/project");
    });

    test("glob-only pattern is unchanged", () => {
      expect(expandHomePath("*")).toBe("*");
    });

    test("empty string is unchanged", () => {
      expect(expandHomePath("")).toBe("");
    });

    test("bash command pattern starting with a word is unchanged", () => {
      expect(expandHomePath("git push *")).toBe("git push *");
    });
  });
});
