import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const mockHomedir = vi.hoisted(() => vi.fn(() => "/home/testuser"));

vi.mock("node:os", () => ({
  homedir: mockHomedir,
  default: { homedir: mockHomedir },
}));

const FAKE_HOME = "/home/testuser";

import {
  compileWildcardPattern,
  compileWildcardPatternEntries,
  findCompiledWildcardMatch,
  findCompiledWildcardMatchForNames,
  wildcardMatch,
} from "#src/policy/wildcard-matcher";

afterEach(() => {
  mockHomedir.mockClear();
  vi.restoreAllMocks();
});

describe("compileWildcardPatternEntries", () => {
  test("returns empty array for empty iterable", () => {
    const result = compileWildcardPatternEntries([]);
    expect(result).toEqual([]);
  });

  test("compiles a single exact pattern", () => {
    const result = compileWildcardPatternEntries([["read", "allow"]]);
    expect(result).toHaveLength(1);
    expect(result[0].pattern).toBe("read");
    expect(result[0].state).toBe("allow");
  });

  test("compiles multiple patterns in order", () => {
    const entries: [string, string][] = [
      ["read", "allow"],
      ["write", "deny"],
      ["bash *", "ask"],
    ];
    const result = compileWildcardPatternEntries(entries);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.pattern)).toEqual(["read", "write", "bash *"]);
  });
});

describe("findCompiledWildcardMatch", () => {
  test("returns null for empty patterns array", () => {
    const result = findCompiledWildcardMatch([], "read");
    expect(result).toBeNull();
  });

  test("matches exact pattern", () => {
    const patterns = compileWildcardPatternEntries([["read", "allow"]]);
    const result = findCompiledWildcardMatch(patterns, "read");
    expect(result).not.toBeNull();
    expect(result?.state).toBe("allow");
    expect(result?.matchedPattern).toBe("read");
    expect(result?.matchedName).toBe("read");
  });

  test("returns null when no pattern matches", () => {
    const patterns = compileWildcardPatternEntries([["read", "allow"]]);
    const result = findCompiledWildcardMatch(patterns, "write");
    expect(result).toBeNull();
  });

  test("matches glob * pattern", () => {
    const patterns = compileWildcardPatternEntries([["git *", "allow"]]);
    const result = findCompiledWildcardMatch(patterns, "git status");
    expect(result).not.toBeNull();
    expect(result?.state).toBe("allow");
    expect(result?.matchedPattern).toBe("git *");
  });

  test("glob * matches zero or more characters", () => {
    const patterns = compileWildcardPatternEntries([["git*", "allow"]]);
    expect(findCompiledWildcardMatch(patterns, "git")).not.toBeNull();
    expect(findCompiledWildcardMatch(patterns, "git status")).not.toBeNull();
    expect(findCompiledWildcardMatch(patterns, "npm install")).toBeNull();
  });

  test("last-match-wins precedence: later pattern overrides earlier", () => {
    const patterns = compileWildcardPatternEntries([
      ["git *", "allow"],
      ["git push *", "deny"],
    ]);
    const result = findCompiledWildcardMatch(patterns, "git push origin main");
    expect(result).not.toBeNull();
    expect(result?.state).toBe("deny");
    expect(result?.matchedPattern).toBe("git push *");
  });

  test("last-match-wins: specific deny before broad allow matches the later one", () => {
    const patterns = compileWildcardPatternEntries([
      ["*", "deny"],
      ["git status", "allow"],
    ]);
    const result = findCompiledWildcardMatch(patterns, "git status");
    expect(result).not.toBeNull();
    expect(result?.state).toBe("allow");
  });

  test("exact pattern does not match partial name", () => {
    const patterns = compileWildcardPatternEntries([["read", "allow"]]);
    expect(findCompiledWildcardMatch(patterns, "read ")).toBeNull();
    expect(findCompiledWildcardMatch(patterns, "readonly")).toBeNull();
  });

  test("regex special characters in pattern are escaped", () => {
    const patterns = compileWildcardPatternEntries([
      ["tool.name", "allow"],
      ["tool+extra", "deny"],
    ]);
    // "tool.name" should not match "toolXname" (dot is escaped)
    expect(findCompiledWildcardMatch(patterns, "toolXname")).toBeNull();
    // Exact match works
    expect(findCompiledWildcardMatch(patterns, "tool.name")).not.toBeNull();
    expect(findCompiledWildcardMatch(patterns, "tool+extra")).not.toBeNull();
  });
});

describe("findCompiledWildcardMatchForNames", () => {
  test("returns null for empty names array", () => {
    const patterns = compileWildcardPatternEntries([["read", "allow"]]);
    const result = findCompiledWildcardMatchForNames(patterns, []);
    expect(result).toBeNull();
  });

  test("returns null when all names are whitespace", () => {
    const patterns = compileWildcardPatternEntries([["  ", "allow"]]);
    const result = findCompiledWildcardMatchForNames(patterns, ["  ", "\t"]);
    expect(result).toBeNull();
  });

  test("matches first name that has a pattern match", () => {
    const patterns = compileWildcardPatternEntries([
      ["read", "allow"],
      ["write", "deny"],
    ]);
    const result = findCompiledWildcardMatchForNames(patterns, [
      "grep",
      "write",
    ]);
    expect(result).not.toBeNull();
    expect(result?.matchedName).toBe("write");
    expect(result?.state).toBe("deny");
  });

  test("trims whitespace from names before matching", () => {
    const patterns = compileWildcardPatternEntries([["read", "allow"]]);
    const result = findCompiledWildcardMatchForNames(patterns, ["  read  "]);
    expect(result).not.toBeNull();
    expect(result?.state).toBe("allow");
  });

  test("returns null when no name matches any pattern", () => {
    const patterns = compileWildcardPatternEntries([["read", "allow"]]);
    const result = findCompiledWildcardMatchForNames(patterns, [
      "write",
      "grep",
    ]);
    expect(result).toBeNull();
  });

  test("multi-name lookup: returns match for first matching name in order", () => {
    const patterns = compileWildcardPatternEntries([
      ["read", "allow"],
      ["write", "deny"],
    ]);
    // "read" comes before "write" in names array, so "read" should match first
    const result = findCompiledWildcardMatchForNames(patterns, [
      "read",
      "write",
    ]);
    expect(result).not.toBeNull();
    expect(result?.matchedName).toBe("read");
    expect(result?.state).toBe("allow");
  });

  test("compileWildcardPattern produces correct pattern metadata", () => {
    const compiled = compileWildcardPattern("bash *", "ask");
    expect(compiled.pattern).toBe("bash *");
    expect(compiled.state).toBe("ask");
    expect(compiled.matches("bash ls -la")).toBe(true);
    expect(compiled.matches("echo hello")).toBe(false);
  });

  test("a compiled pattern folds the value it is handed (#653)", () => {
    const compiled = compileWildcardPattern("/dev/*", "allow", {
      windowsSeparators: true,
    });
    expect(compiled.matches("/dev/null")).toBe(true);
    expect(compiled.matches("\\dev\\null")).toBe(true);
  });
});

describe("wildcardMatch", () => {
  test("'*' pattern matches any value", () => {
    expect(wildcardMatch("*", "anything")).toBe(true);
    expect(wildcardMatch("*", "")).toBe(true);
    expect(wildcardMatch("*", "bash")).toBe(true);
  });

  test("'*' pattern matches values containing newlines", () => {
    expect(wildcardMatch("*", "line1\nline2")).toBe(true);
    expect(wildcardMatch("*", "a\nb\nc")).toBe(true);
  });

  test("prefix-wildcard pattern matches value with embedded newlines", () => {
    const command =
      "node -e \"\nimport('x').then(() => {\n  console.log('done');\n});\n\"";
    expect(wildcardMatch("node *", command)).toBe(true);
  });

  test("compileWildcardPattern matches a multiline string", () => {
    const compiled = compileWildcardPattern("*", "allow");
    expect(compiled.matches("a\nb")).toBe(true);
  });

  test("exact pattern matches identical value", () => {
    expect(wildcardMatch("read", "read")).toBe(true);
    expect(wildcardMatch("external_directory", "external_directory")).toBe(
      true,
    );
  });

  test("exact pattern does not match a different value", () => {
    expect(wildcardMatch("read", "write")).toBe(false);
    expect(wildcardMatch("read", "readonly")).toBe(false);
    expect(wildcardMatch("read", "read ")).toBe(false);
  });

  test("glob pattern matches with wildcard", () => {
    expect(wildcardMatch("git *", "git status")).toBe(true);
    expect(wildcardMatch("git *", "git push origin main")).toBe(true);
    expect(wildcardMatch("git *", "npm install")).toBe(false);
  });

  test("glob with no trailing space matches longer string", () => {
    expect(wildcardMatch("git*", "git")).toBe(true);
    expect(wildcardMatch("git*", "git status")).toBe(true);
    expect(wildcardMatch("git*", "npm")).toBe(false);
  });

  test("regex special characters in pattern are treated as literals", () => {
    expect(wildcardMatch("tool.name", "tool.name")).toBe(true);
    expect(wildcardMatch("tool.name", "toolXname")).toBe(false);
  });

  describe("trailing wildcard optionality", () => {
    test("'git *' matches bare 'git' (trailing space+wildcard is optional)", () => {
      expect(wildcardMatch("git *", "git")).toBe(true);
    });

    test("'git *' still matches 'git status' (existing behaviour preserved)", () => {
      expect(wildcardMatch("git *", "git status")).toBe(true);
    });

    test("'git *' still matches 'git status --short'", () => {
      expect(wildcardMatch("git *", "git status --short")).toBe(true);
    });

    test("'git *' does not match an unrelated command", () => {
      expect(wildcardMatch("git *", "npm install")).toBe(false);
    });

    test("'git status *' matches bare 'git status'", () => {
      expect(wildcardMatch("git status *", "git status")).toBe(true);
    });

    test("'git status *' matches 'git status --short'", () => {
      expect(wildcardMatch("git status *", "git status --short")).toBe(true);
    });

    test("non-trailing '*' is unaffected: 'g*t' does not match 'g' or 't'", () => {
      expect(wildcardMatch("g*t", "g")).toBe(false);
      expect(wildcardMatch("g*t", "t")).toBe(false);
    });

    test("non-trailing '*' still matches when content is present: 'g*t' matches 'git'", () => {
      expect(wildcardMatch("g*t", "git")).toBe(true);
    });

    test("'git*' (no space) still matches bare 'git' — unchanged behaviour", () => {
      expect(wildcardMatch("git*", "git")).toBe(true);
    });

    test("'*' alone still matches everything", () => {
      expect(wildcardMatch("*", "git")).toBe(true);
      expect(wildcardMatch("*", "")).toBe(true);
    });
  });

  describe("match options (Windows path folding)", () => {
    test("caseInsensitive matches a value differing only in case", () => {
      expect(
        wildcardMatch("C:\\Users\\Foo\\*", "c:\\users\\foo\\bar.md", {
          caseInsensitive: true,
        }),
      ).toBe(true);
    });

    test("case folding is off by default", () => {
      expect(wildcardMatch("C:\\Users\\Foo\\*", "c:\\users\\foo\\bar.md")).toBe(
        false,
      );
    });

    test("windowsSeparators matches a backslash value against a forward-slash pattern", () => {
      expect(
        wildcardMatch("C:/Users/Foo/*", "C:\\Users\\Foo\\bar.md", {
          windowsSeparators: true,
        }),
      ).toBe(true);
    });

    test("separator normalization is off by default", () => {
      expect(wildcardMatch("C:/Users/Foo/*", "C:\\Users\\Foo\\bar.md")).toBe(
        false,
      );
    });

    test("both options fold a mixed-case forward-slash pattern onto a lowercased backslash value", () => {
      expect(
        wildcardMatch(
          "C:/Users/Foo/AppData/Roaming/*",
          "c:\\users\\foo\\appdata\\roaming\\npm\\x.md",
          { caseInsensitive: true, windowsSeparators: true },
        ),
      ).toBe(true);
    });
  });

  describe("windowsSeparators folds both operands (#653)", () => {
    test("a forward-slash pattern matches a forward-slash value", () => {
      expect(
        wildcardMatch("/dev/null", "/dev/null", { windowsSeparators: true }),
      ).toBe(true);
    });

    test("a forward-slash glob matches a forward-slash device value", () => {
      expect(
        wildcardMatch("/dev/*", "/dev/null", {
          caseInsensitive: true,
          windowsSeparators: true,
        }),
      ).toBe(true);
    });

    test("a forward-slash relative pattern matches a forward-slash value", () => {
      expect(
        wildcardMatch("src/*", "src/foo.ts", { windowsSeparators: true }),
      ).toBe(true);
    });

    test("a backslash pattern matches a forward-slash value", () => {
      expect(
        wildcardMatch("src\\*", "src/foo.ts", { windowsSeparators: true }),
      ).toBe(true);
    });

    test("the value fold is off by default", () => {
      expect(wildcardMatch("src\\*", "src/foo.ts")).toBe(false);
      expect(wildcardMatch("/dev/null", "\\dev\\null")).toBe(false);
    });

    test("folding separators does not make unrelated values match", () => {
      expect(
        wildcardMatch("/dev/null", "/dev/stdout", { windowsSeparators: true }),
      ).toBe(false);
    });
  });
});

describe("? single-character wildcard", () => {
  test("'?' matches exactly one character", () => {
    expect(wildcardMatch("?", "a")).toBe(true);
    expect(wildcardMatch("?", "Z")).toBe(true);
    expect(wildcardMatch("?", "5")).toBe(true);
  });

  test("'?' does not match zero characters", () => {
    expect(wildcardMatch("?", "")).toBe(false);
    expect(wildcardMatch("a?", "a")).toBe(false);
  });

  test("'?' does not match two or more characters", () => {
    expect(wildcardMatch("?", "ab")).toBe(false);
    expect(wildcardMatch("?", "abc")).toBe(false);
  });

  test("multiple '?' match exactly that many characters", () => {
    expect(wildcardMatch("f??", "foo")).toBe(true);
    expect(wildcardMatch("f??", "fo")).toBe(false);
    expect(wildcardMatch("f??", "fooo")).toBe(false);
  });

  test("'?' combined with '*'", () => {
    // git + one char + anything
    expect(wildcardMatch("git?*", "git status")).toBe(true);
    // git + zero chars — '?' requires one
    expect(wildcardMatch("git?*", "git")).toBe(false);
  });

  test("'?' matches path separators and special characters", () => {
    expect(wildcardMatch("a?b", "a/b")).toBe(true);
    expect(wildcardMatch("a?b", "a.b")).toBe(true);
    expect(wildcardMatch("a?b", "a\nb")).toBe(true);
  });

  test("'?' in pattern matches literal '?' in value", () => {
    expect(wildcardMatch("a?c", "a?c")).toBe(true);
  });

  test("'?' in bash-style patterns", () => {
    expect(wildcardMatch("git statu?", "git status")).toBe(true);
    expect(wildcardMatch("git statu?", "git statux")).toBe(true);
    expect(wildcardMatch("git statu?", "git statu")).toBe(false);
  });
});

describe("home path expansion in patterns", () => {
  test("wildcardMatch expands ~ prefix in pattern before matching", () => {
    const expandedPath = join(FAKE_HOME, "dev/project");
    expect(wildcardMatch("~/dev/project", expandedPath)).toBe(true);
  });

  test("wildcardMatch expands ~/glob in pattern", () => {
    const expandedFile = join(FAKE_HOME, "dev/project/file.ts");
    expect(wildcardMatch("~/dev/*", expandedFile)).toBe(true);
  });

  test("wildcardMatch ~/glob does not match a different home directory", () => {
    expect(wildcardMatch("~/dev/*", "/other/user/dev/file.ts")).toBe(false);
  });

  test("wildcardMatch expands $HOME prefix in pattern before matching", () => {
    const expandedPath = join(FAKE_HOME, "dev/project");
    expect(wildcardMatch("$HOME/dev/project", expandedPath)).toBe(true);
  });

  test("wildcardMatch expands $HOME/glob in pattern", () => {
    const expandedFile = join(FAKE_HOME, "work/file.ts");
    expect(wildcardMatch("$HOME/work/*", expandedFile)).toBe(true);
  });

  test("compileWildcardPattern retains original ~ pattern in .pattern field", () => {
    const compiled = compileWildcardPattern("~/dev/*", "allow");
    expect(compiled.pattern).toBe("~/dev/*");
  });

  test("compileWildcardPattern retains original $HOME pattern in .pattern field", () => {
    const compiled = compileWildcardPattern("$HOME/dev/*", "allow");
    expect(compiled.pattern).toBe("$HOME/dev/*");
  });

  test("compileWildcardPattern expanded pattern matches the expanded path", () => {
    const compiled = compileWildcardPattern("~/dev/*", "allow");
    const expandedFile = join(FAKE_HOME, "dev/file.ts");
    expect(compiled.matches(expandedFile)).toBe(true);
  });

  test("non-home pattern is unaffected", () => {
    expect(wildcardMatch("/absolute/path/*", "/absolute/path/file")).toBe(true);
    expect(wildcardMatch("/absolute/path/*", "/other/file")).toBe(false);
  });
});
