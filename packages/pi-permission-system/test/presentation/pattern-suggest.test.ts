import { describe, expect, it } from "vitest";
import {
  buildDirectionalSessionLabels,
  buildForwardedScopeLabels,
  describeGrantTarget,
  suggestBashPattern,
  suggestMcpPattern,
  suggestPathSessionPattern,
  suggestSessionPattern,
} from "#src/presentation/pattern-suggest";

describe("suggestBashPattern", () => {
  it("returns <command> <subcommand> * using the arity table", () => {
    // git arity=2: include the subcommand in the prefix.
    expect(suggestBashPattern("git status --short")).toBe("git status *");
  });

  it("appends trailing * when arity covers all tokens (multi-word script name)", () => {
    // npm run arity=3: prefix covers all three tokens → trailing wildcard.
    expect(suggestBashPattern("npm run build")).toBe("npm run build*");
  });

  it("returns the exact command when there are no arguments", () => {
    expect(suggestBashPattern("ls")).toBe("ls");
  });

  it("trims leading and trailing whitespace before lookup", () => {
    // git arity=2, tokens=["git","log"], prefix covers all → trailing wildcard.
    expect(suggestBashPattern("  git log  ")).toBe("git log*");
  });

  it("handles empty string gracefully", () => {
    expect(suggestBashPattern("")).toBe("");
  });

  it("falls back to first-word prefix for unknown commands", () => {
    expect(suggestBashPattern("mytool --verbose run")).toBe("mytool *");
  });

  it("returns first-word * for known arity-1 commands with args", () => {
    expect(suggestBashPattern("rm -rf node_modules")).toBe("rm *");
  });

  it("produces tighter pattern for docker compose than plain docker", () => {
    expect(suggestBashPattern("docker compose up --build")).toBe(
      "docker compose up *",
    );
  });

  it("strips leading comment lines and suggests based on the actual command", () => {
    expect(
      suggestBashPattern(
        "# Check debug logs\nfind /home -path '*debug*' -type f",
      ),
    ).toBe("find *");
  });

  it("strips multiple leading comment lines", () => {
    expect(suggestBashPattern("# Step 1\n# Step 2\ngit status --short")).toBe(
      "git status *",
    );
  });

  it("returns empty for comment-only input", () => {
    expect(suggestBashPattern("# just a comment")).toBe("");
  });

  it("handles mixed comment and command lines", () => {
    expect(suggestBashPattern("# description\nrm -rf ./build; echo done")).toBe(
      "rm *",
    );
  });
});

describe("suggestMcpPattern", () => {
  it("suggests server:* for a qualified target (colon-separated)", () => {
    expect(suggestMcpPattern("exa:search")).toBe("exa:*");
  });

  it("suggests server_* for a munged target (underscore-separated)", () => {
    expect(suggestMcpPattern("exa_search")).toBe("exa_*");
  });

  it("suggests * for a bare 'mcp' target", () => {
    expect(suggestMcpPattern("mcp")).toBe("*");
  });

  it("suggests * for a plain tool name with no server prefix", () => {
    expect(suggestMcpPattern("search")).toBe("*");
  });

  it("prefers colon over underscore when both are present", () => {
    // Qualified names contain ':'; the colon check runs first.
    expect(suggestMcpPattern("my-server:some_tool")).toBe("my-server:*");
  });
});

describe("suggestSessionPattern", () => {
  describe("bash surface", () => {
    it("returns arity-aware subcommand pattern for multi-word command", () => {
      // git arity=2: include the subcommand token in the prefix.
      const result = suggestSessionPattern("bash", "git status --short");
      expect(result).toMatchObject({
        surface: "bash",
        pattern: "git status *",
      });
    });

    it("returns exact command for single-word bash command", () => {
      const result = suggestSessionPattern("bash", "ls");
      expect(result).toMatchObject({ surface: "bash", pattern: "ls" });
    });
  });

  describe("mcp surface", () => {
    it("returns mcp surface with server:* for qualified target", () => {
      const result = suggestSessionPattern("mcp", "exa:search");
      expect(result).toMatchObject({ surface: "mcp", pattern: "exa:*" });
    });

    it("returns mcp surface with server_* for munged target", () => {
      const result = suggestSessionPattern("mcp", "exa_search");
      expect(result).toMatchObject({ surface: "mcp", pattern: "exa_*" });
    });

    it("returns * for bare mcp target", () => {
      const result = suggestSessionPattern("mcp", "mcp");
      expect(result).toMatchObject({ surface: "mcp", pattern: "*" });
    });
  });

  describe("skill surface", () => {
    it("returns exact skill name as pattern", () => {
      const result = suggestSessionPattern("skill", "librarian");
      expect(result).toMatchObject({ surface: "skill", pattern: "librarian" });
    });
  });

  describe("path-bearing tool surfaces", () => {
    it("returns * for a path-bearing tool with no resolved path", () => {
      const result = suggestSessionPattern("read", "*");
      expect(result).toMatchObject({ surface: "read", pattern: "*" });
    });

    it("label shows tool name when pattern is *", () => {
      const result = suggestSessionPattern("find", "*");
      expect(result.label).toBe('Yes, allow tool "find" for this session');
    });
  });

  describe("non-path-bearing tool surfaces", () => {
    it("returns * for extension tools", () => {
      const result = suggestSessionPattern("my_extension_tool", "*");
      expect(result).toMatchObject({
        surface: "my_extension_tool",
        pattern: "*",
      });
    });
  });

  describe("label field", () => {
    it("bash label includes surface prefix and pattern", () => {
      const result = suggestSessionPattern("bash", "git status");
      expect(result.label).toBe(
        'Yes, allow bash "git status*" for this session',
      );
    });

    it("mcp label includes surface prefix and pattern", () => {
      const result = suggestSessionPattern("mcp", "exa:search");
      expect(result.label).toBe('Yes, allow mcp tool "exa:*" for this session');
    });

    it("skill label includes surface prefix", () => {
      const result = suggestSessionPattern("skill", "librarian");
      expect(result.label).toBe(
        'Yes, allow skill "librarian" for this session',
      );
    });

    it("tool label shows tool name when value is *", () => {
      const result = suggestSessionPattern("edit", "*");
      expect(result.label).toBe('Yes, allow tool "edit" for this session');
    });
  });
});

describe("suggestPathSessionPattern", () => {
  it("passes the caller-derived pattern through unchanged", () => {
    expect(suggestPathSessionPattern("edit", "/outside/project/*")).toEqual({
      surface: "edit",
      pattern: "/outside/project/*",
      label: 'Yes, allow edit "/outside/project/*" for this session',
    });
  });

  it("preserves a windows-shaped pattern verbatim", () => {
    // The derivation belongs to the caller's PathNormalizer (#655); this
    // module must not re-interpret the separators it is handed.
    expect(
      suggestPathSessionPattern("read", "c:\\projects\\app\\src\\*"),
    ).toEqual({
      surface: "read",
      pattern: "c:\\projects\\app\\src\\*",
      label: 'Yes, allow read "c:\\projects\\app\\src\\*" for this session',
    });
  });
});

describe("describeGrantTarget", () => {
  it("quotes the pattern when there is exactly one grant", () => {
    expect(
      describeGrantTarget([
        { surface: "external_directory_write", pattern: "/tmp/*" },
      ]),
    ).toBe('"/tmp/*"');
  });

  it("counts the grants when there are several", () => {
    expect(
      describeGrantTarget([
        { surface: "external_directory_read", pattern: "/outside/a/*" },
        { surface: "external_directory_read", pattern: "/outside/b/*" },
        { surface: "external_directory_read", pattern: "/outside/c/*" },
      ]),
    ).toBe("3 paths");
  });
});

describe("buildDirectionalSessionLabels", () => {
  it("names the proven direction and the widened pair for a read", () => {
    expect(buildDirectionalSessionLabels("read", '"/tmp/*"')).toEqual({
      sessionLabel: 'Yes, allow reads to "/tmp/*" for this session',
      widenedLabel: 'Yes, allow reads and writes to "/tmp/*" for this session',
    });
  });

  it("names the proven direction and the widened pair for a write", () => {
    expect(buildDirectionalSessionLabels("write", '"/tmp/*"')).toEqual({
      sessionLabel: 'Yes, allow writes to "/tmp/*" for this session',
      widenedLabel: 'Yes, allow reads and writes to "/tmp/*" for this session',
    });
  });

  it("carries a multi-grant target through both labels", () => {
    expect(buildDirectionalSessionLabels("read", "3 paths")).toEqual({
      sessionLabel: "Yes, allow reads to 3 paths for this session",
      widenedLabel: "Yes, allow reads and writes to 3 paths for this session",
    });
  });
});

describe("buildForwardedScopeLabels", () => {
  it("names the requesting subagent on the least-privilege option", () => {
    expect(
      buildForwardedScopeLabels("Explore", [
        { surface: "bash", pattern: "git *" },
      ]).subagentLabel,
    ).toBe("This subagent ('Explore') only");
  });

  it("falls back to an anonymous subagent label", () => {
    expect(
      buildForwardedScopeLabels(null, [{ surface: "bash", pattern: "git *" }])
        .subagentLabel,
    ).toBe("This subagent only");
  });

  it("names the surface and the pattern for a single grant", () => {
    expect(
      buildForwardedScopeLabels("Explore", [
        { surface: "bash", pattern: "git *" },
      ]).servingSessionLabel,
    ).toBe(
      'The whole session — allow bash "git *" for parent and all subagents',
    );
  });

  it("names every path rather than the first when a grant covers several", () => {
    expect(
      buildForwardedScopeLabels("Explore", [
        { surface: "external_directory_read", pattern: "/outside/a/*" },
        { surface: "external_directory_read", pattern: "/outside/b/*" },
      ]).servingSessionLabel,
    ).toBe(
      "The whole session — allow external_directory 2 paths for parent and all subagents",
    );
  });

  it("names the shared family rather than a directional member", () => {
    // The scope labels are built before the dialog runs, so a direction here
    // could contradict a width the human chooses inside it (#813).
    expect(
      buildForwardedScopeLabels("Explore", [
        { surface: "external_directory_write", pattern: "/tmp/*" },
      ]).servingSessionLabel,
    ).toBe(
      'The whole session — allow external_directory "/tmp/*" for parent and all subagents',
    );
  });

  it("omits the surface when the grants do not share a family", () => {
    expect(
      buildForwardedScopeLabels("Explore", [
        { surface: "external_directory_read", pattern: "/outside/a/*" },
        { surface: "path_write", pattern: "/outside/b/*" },
      ]).servingSessionLabel,
    ).toBe("The whole session — allow 2 paths for parent and all subagents");
  });
});
