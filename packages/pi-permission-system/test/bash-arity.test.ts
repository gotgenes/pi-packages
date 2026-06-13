import { describe, expect, it } from "vitest";
import { ARITY, prefix, stripBashCommentLines } from "#src/bash-arity";

describe("ARITY dictionary", () => {
  it("is exported as a plain object", () => {
    expect(typeof ARITY).toBe("object");
  });

  it("maps 'git' to arity 2", () => {
    expect(ARITY.git).toBe(2);
  });

  it("maps 'npm run' to arity 3", () => {
    expect(ARITY["npm run"]).toBe(3);
  });

  it("maps 'npm' to arity 2 (fallback when 'npm run' does not match)", () => {
    expect(ARITY.npm).toBe(2);
  });

  it("maps 'docker compose' to arity 3", () => {
    expect(ARITY["docker compose"]).toBe(3);
  });

  it("maps 'docker' to arity 2 (fallback)", () => {
    expect(ARITY.docker).toBe(2);
  });
});

describe("prefix", () => {
  it("returns empty array for empty input", () => {
    expect(prefix([])).toEqual([]);
  });

  it("returns single-element array for a bare known command", () => {
    // 'git' alone has arity 2 but only 1 token is available — clamp.
    expect(prefix(["git"])).toEqual(["git"]);
  });

  it("returns arity-2 prefix for git subcommands", () => {
    expect(prefix(["git", "checkout", "main"])).toEqual(["git", "checkout"]);
  });

  it("returns arity-2 prefix for git status with flags", () => {
    expect(prefix(["git", "status", "--short"])).toEqual(["git", "status"]);
  });

  it("returns arity-3 prefix for npm run (longest match wins over npm arity-2)", () => {
    expect(prefix(["npm", "run", "dev"])).toEqual(["npm", "run", "dev"]);
  });

  it("returns arity-2 prefix for npm install (npm fallback, npm run does not match)", () => {
    expect(prefix(["npm", "install", "lodash"])).toEqual(["npm", "install"]);
  });

  it("returns arity-3 prefix for docker compose subcommands", () => {
    expect(prefix(["docker", "compose", "up", "--build"])).toEqual([
      "docker",
      "compose",
      "up",
    ]);
  });

  it("returns arity-2 prefix for docker pull (docker fallback)", () => {
    expect(prefix(["docker", "pull", "ubuntu"])).toEqual(["docker", "pull"]);
  });

  it("returns arity-1 prefix for unknown commands", () => {
    expect(prefix(["unknown-tool", "--flag"])).toEqual(["unknown-tool"]);
  });

  it("returns arity-1 prefix for rm (args are targets, not subcommands)", () => {
    expect(prefix(["rm", "-rf", "node_modules"])).toEqual(["rm"]);
  });

  it("returns arity-1 prefix for cat", () => {
    expect(prefix(["cat", "file.txt"])).toEqual(["cat"]);
  });

  it("is case-insensitive: 'Git' looks up as 'git'", () => {
    // Tokens are preserved as-is; only the lookup key is lowercased.
    expect(prefix(["Git", "checkout", "main"])).toEqual(["Git", "checkout"]);
  });

  it("clamps arity to available token count when command is shorter than arity", () => {
    // npm run has arity 3; only ["npm", "run"] provided → return both.
    expect(prefix(["npm", "run"])).toEqual(["npm", "run"]);
  });

  it("returns arity-2 prefix for pnpm run (longest match wins over pnpm)", () => {
    // pnpm run <script> — arity 3 means include the script name.
    expect(prefix(["pnpm", "run", "build"])).toEqual(["pnpm", "run", "build"]);
  });

  it("returns arity-2 prefix for cargo subcommands", () => {
    expect(prefix(["cargo", "build", "--release"])).toEqual(["cargo", "build"]);
  });

  it("returns arity-2 prefix for kubectl subcommands", () => {
    expect(prefix(["kubectl", "get", "pods"])).toEqual(["kubectl", "get"]);
  });

  it("returns arity-1 for bare 'ls' (args are paths)", () => {
    expect(prefix(["ls", "-la", "/tmp"])).toEqual(["ls"]);
  });
});

describe("stripBashCommentLines", () => {
  it("removes a single leading comment line", () => {
    expect(
      stripBashCommentLines("# Check debug logs\nfind /home -type f"),
    ).toBe("find /home -type f");
  });

  it("removes multiple leading comment lines", () => {
    expect(
      stripBashCommentLines("# Step 1\n# Step 2\ngit status --short"),
    ).toBe("git status --short");
  });

  it("returns empty string when all lines are comments", () => {
    expect(stripBashCommentLines("# just a comment")).toBe("");
  });

  it("returns empty string for blank input", () => {
    expect(stripBashCommentLines("")).toBe("");
  });

  it("returns the command unchanged when no comment lines are present", () => {
    expect(stripBashCommentLines("grep -rn foo src/")).toBe(
      "grep -rn foo src/",
    );
  });

  it("trims surrounding whitespace from the result", () => {
    expect(stripBashCommentLines("\n\n  ls -la  \n")).toBe("ls -la");
  });

  it("treats indented comment lines as comments", () => {
    expect(stripBashCommentLines("    # indented comment\necho hi")).toBe(
      "echo hi",
    );
  });
});
