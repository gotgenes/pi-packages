import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PersistentPermissionWriter } from "#src/persistent-permission-writer";

const ORIGINAL = `{
  // keep this operator note
  "debugLog": true,
  "permission": {
    "bash": {
      "git *": "deny",
      // keep this deny
      "rm *": "deny"
    }
  }
}
`;

describe("PersistentPermissionWriter", () => {
  let root: string;
  let path: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "persistent-permission-writer-"));
    path = join(root, "config.local.json");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("appends allow rules while preserving unrelated JSONC", () => {
    writeFileSync(path, ORIGINAL);
    const writer = new PersistentPermissionWriter();

    writer.write({
      path,
      expectedDir: root,
      surface: "bash",
      patterns: ["gh workflow run *"],
    });

    expect(readFileSync(path, "utf8")).toBe(`{
  // keep this operator note
  "debugLog": true,
  "permission": {
    "bash": {
      "git *": "deny",
      // keep this deny
      "rm *": "deny",
      "gh workflow run *": "allow"
    }
  }
}
`);
    expect(lstatSync(path).mode & 0o777).toBe(0o600);
  });

  it("expands a string surface without changing its fallback meaning", () => {
    writeFileSync(path, `{"permission":{"bash":"deny"}}\n`);
    const writer = new PersistentPermissionWriter();

    writer.write({
      path,
      expectedDir: root,
      surface: "bash",
      patterns: ["git status"],
    });

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      permission: { bash: { "*": "deny", "git status": "allow" } },
    });
  });

  it("moves an existing pattern to last-match-wins position", () => {
    writeFileSync(path, `{"permission":{"bash":{"git *":"deny","*":"ask"}}}\n`);
    const writer = new PersistentPermissionWriter();

    writer.write({
      path,
      expectedDir: root,
      surface: "bash",
      patterns: ["git *"],
    });

    expect(
      Object.keys(JSON.parse(readFileSync(path, "utf8")).permission.bash),
    ).toEqual(["*", "git *"]);
  });

  it("rejects invalid existing config without changing it", () => {
    const invalid = `{"debugLo":true}\n`;
    writeFileSync(path, invalid);
    const writer = new PersistentPermissionWriter();

    expect(() =>
      writer.write({
        path,
        expectedDir: root,
        surface: "bash",
        patterns: ["git status"],
      }),
    ).toThrow("Invalid permission config");
    expect(readFileSync(path, "utf8")).toBe(invalid);
  });

  it("rejects a destination outside the expected directory", () => {
    const writer = new PersistentPermissionWriter();

    expect(() =>
      writer.write({
        path: join(root, "..", "escaped.json"),
        expectedDir: root,
        surface: "bash",
        patterns: ["git status"],
      }),
    ).toThrow("outside the expected directory");
  });

  it("rejects a parent directory symlink that escapes the trusted root", () => {
    const outside = mkdtempSync(
      join(tmpdir(), "persistent-permission-outside-"),
    );
    try {
      const linkedDir = join(root, "linked");
      symlinkSync(outside, linkedDir);
      const writer = new PersistentPermissionWriter();

      expect(() =>
        writer.write({
          path: join(linkedDir, "config.json"),
          expectedDir: linkedDir,
          expectedRoot: root,
          surface: "bash",
          patterns: ["git status"],
        }),
      ).toThrow("resolves outside the expected directory");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects a symlink destination", () => {
    const real = join(root, "real.json");
    writeFileSync(real, "{}\n");
    symlinkSync(real, path);
    const writer = new PersistentPermissionWriter();

    expect(() =>
      writer.write({
        path,
        expectedDir: root,
        surface: "bash",
        patterns: ["git status"],
      }),
    ).toThrow("symbolic link");
  });

  it("restores the original bytes after a caller reports reload failure", () => {
    writeFileSync(path, ORIGINAL);
    const writer = new PersistentPermissionWriter();

    const result = writer.write({
      path,
      expectedDir: root,
      surface: "bash",
      patterns: ["git status"],
    });
    result.restore();

    expect(readFileSync(path, "utf8")).toBe(ORIGINAL);
  });

  it("creates the destination directory and writes multiple patterns atomically", () => {
    const nested = join(root, "nested");
    const nestedPath = join(nested, "config.json");
    const writer = new PersistentPermissionWriter();

    writer.write({
      path: nestedPath,
      expectedDir: nested,
      surface: "external_directory",
      patterns: ["/tmp/a", "/tmp/b"],
    });

    expect(JSON.parse(readFileSync(nestedPath, "utf8"))).toEqual({
      permission: {
        external_directory: { "/tmp/a": "allow", "/tmp/b": "allow" },
      },
    });
    expect(() => mkdirSync(nested)).toThrow();
  });
});
