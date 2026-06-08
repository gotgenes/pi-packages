import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadAndMergeConfigs,
  loadUnifiedConfig,
  mergeUnifiedConfigs,
  normalizeUnifiedConfig,
  stripJsonComments,
} from "#src/config-loader";

describe("stripJsonComments", () => {
  it("returns empty string for empty input", () => {
    expect(stripJsonComments("")).toBe("");
  });

  it("passes through plain JSON unchanged", () => {
    const input = '{"key": true}';
    expect(stripJsonComments(input)).toBe(input);
  });

  it("drops a line comment body and preserves the trailing newline", () => {
    // The space before // is emitted; the comment body is dropped; \n is kept.
    expect(stripJsonComments('{ // comment\n"k": 1}')).toBe('{ \n"k": 1}');
  });

  it("drops a line comment that runs to EOF with no trailing newline", () => {
    expect(stripJsonComments('{"k": 1} // trailing')).toBe('{"k": 1} ');
  });

  it("drops a block comment and nothing else", () => {
    expect(stripJsonComments('{ /* block */ "k": 1}')).toBe('{  "k": 1}');
  });

  it("drops an unterminated block comment to EOF", () => {
    expect(stripJsonComments("{ /* no close")).toBe("{ ");
  });

  it("preserves // inside a double-quoted string", () => {
    expect(stripJsonComments('{"url": "http://example.com"}')).toBe(
      '{"url": "http://example.com"}',
    );
  });

  it("preserves block-comment markers inside a double-quoted string", () => {
    expect(stripJsonComments('{"v": "a /* b */ c"}')).toBe(
      '{"v": "a /* b */ c"}',
    );
  });

  it("preserves // inside a single-quoted string", () => {
    expect(stripJsonComments("{'url': 'http://x.com'}")).toBe(
      "{'url': 'http://x.com'}",
    );
  });

  it("preserves block-comment markers inside a single-quoted string", () => {
    expect(stripJsonComments("{'v': 'a /* b */ c'}")).toBe(
      "{'v': 'a /* b */ c'}",
    );
  });

  it("honors a backslash-escaped quote so it does not close the string", () => {
    // The string value is: a\"b (backslash-escaped double quote)
    expect(stripJsonComments('{"k": "a\\"b"}')).toBe('{"k": "a\\"b"}');
  });

  it("emits an unterminated string to EOF verbatim", () => {
    expect(stripJsonComments('{"k": "unterminated')).toBe(
      '{"k": "unterminated',
    );
  });

  it("preserves a lone slash that is not part of // or /*", () => {
    expect(stripJsonComments('{"v": 1/2}')).toBe('{"v": 1/2}');
  });

  it("handles a combined JSONC document that round-trips to valid JSON", () => {
    const jsonc = [
      "{",
      '  "debugLog": true, // runtime knob',
      '  "permission": { /* the policy */ "*": "ask" }',
      "}",
    ].join("\n");
    const stripped = stripJsonComments(jsonc);
    // Must parse without throwing
    const parsed = JSON.parse(stripped) as Record<string, unknown>;
    expect(parsed.debugLog).toBe(true);
    expect(parsed.permission).toEqual({ "*": "ask" });
  });
});

describe("loadUnifiedConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "config-loader-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("parses a valid JSON file with runtime knobs and flat permission", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        debugLog: true,
        permissionReviewLog: false,
        yoloMode: true,
        permission: {
          "*": "ask",
          read: "allow",
          bash: { "git status": "allow" },
        },
      }),
    );

    const result = loadUnifiedConfig(configPath);
    expect(result.issues).toEqual([]);
    expect(result.config.debugLog).toBe(true);
    expect(result.config.permissionReviewLog).toBe(false);
    expect(result.config.yoloMode).toBe(true);
    expect(result.config.permission).toEqual({
      "*": "ask",
      read: "allow",
      bash: { "git status": "allow" },
    });
  });

  it("strips JSONC comments before parsing", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      `{
  // This is a comment
  "debugLog": true,
  /* block comment */
  "permission": { "*": "ask" }
}`,
    );

    const result = loadUnifiedConfig(configPath);
    expect(result.issues).toEqual([]);
    expect(result.config.debugLog).toBe(true);
    expect(result.config.permission).toEqual({ "*": "ask" });
  });

  it("ignores unknown keys without emitting issues", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        debugLog: false,
        unknownField: "ignored",
        anotherRandom: 42,
      }),
    );

    const result = loadUnifiedConfig(configPath);
    expect(result.issues).toEqual([]);
    expect(result.config.debugLog).toBe(false);
    expect(result.config).not.toHaveProperty("unknownField");
  });

  it("returns empty config and no issues when the file does not exist", () => {
    const configPath = join(tempDir, "nonexistent.json");
    const result = loadUnifiedConfig(configPath);
    expect(result.issues).toEqual([]);
    expect(result.config.debugLog).toBeUndefined();
    expect(result.config.permission).toBeUndefined();
  });

  it("returns empty config and an issue when the file contains invalid JSON", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(configPath, "not valid json {{{");

    const result = loadUnifiedConfig(configPath);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain(configPath);
  });

  it("normalizes boolean fields strictly", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        debugLog: "yes",
        permissionReviewLog: 1,
        yoloMode: null,
      }),
    );

    const result = loadUnifiedConfig(configPath);
    expect(result.config.debugLog).toBeUndefined();
    expect(result.config.permissionReviewLog).toBeUndefined();
    expect(result.config.yoloMode).toBeUndefined();
  });

  it("normalizes permission map, keeping only valid PermissionState values", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        permission: {
          read: "allow",
          write: "invalid",
          bash: { "git *": "ask", "rm -rf": 42 },
        },
      }),
    );

    const result = loadUnifiedConfig(configPath);
    expect(result.config.permission).toEqual({
      read: "allow",
      bash: { "git *": "ask" },
    });
  });

  it("preserves optional runtime knobs", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        piInfrastructureReadPaths: ["~/.local/share/mise/installs/pi"],
        toolInputPreviewMaxLength: 400,
        toolTextSummaryMaxLength: 120,
      }),
    );

    const result = loadUnifiedConfig(configPath);
    expect(result.config).toEqual({
      piInfrastructureReadPaths: ["~/.local/share/mise/installs/pi"],
      toolInputPreviewMaxLength: 400,
      toolTextSummaryMaxLength: 120,
    });
  });

  it("drops invalid optional runtime knobs", () => {
    const result = normalizeUnifiedConfig({
      piInfrastructureReadPaths: ["/ok", 42],
      toolInputPreviewMaxLength: 0,
      toolTextSummaryMaxLength: 80.5,
    });

    expect(result.config).toEqual({});
    expect(result.issues).toEqual([]);
  });

  it("accepts permission as object with mixed string and object values", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        permission: {
          "*": "ask",
          read: "allow",
          bash: { "*": "ask", "git *": "allow" },
          external_directory: "ask",
        },
      }),
    );

    const result = loadUnifiedConfig(configPath);
    expect(result.issues).toEqual([]);
    expect(result.config.permission).toEqual({
      "*": "ask",
      read: "allow",
      bash: { "*": "ask", "git *": "allow" },
      external_directory: "ask",
    });
  });

  it("returns no permission when the permission field is absent", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ debugLog: false }));

    const result = loadUnifiedConfig(configPath);
    expect(result.config.permission).toBeUndefined();
  });

  it("ignores a non-object permission field", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ permission: "allow" }));

    const result = loadUnifiedConfig(configPath);
    expect(result.config.permission).toBeUndefined();
  });
});

describe("mergeUnifiedConfigs", () => {
  it("deep-merges permission objects so project overrides global per-key", () => {
    const merged = mergeUnifiedConfigs(
      {
        permission: {
          "*": "ask",
          read: "allow",
          bash: { "git status": "allow" },
        },
      },
      {
        permission: {
          "*": "allow",
          bash: { "rm -rf *": "deny" },
        },
      },
    );

    expect(merged.permission).toEqual({
      "*": "allow",
      read: "allow",
      bash: { "git status": "allow", "rm -rf *": "deny" },
    });
  });

  it("string permission value in override replaces base string for same key", () => {
    const merged = mergeUnifiedConfigs(
      { permission: { read: "ask" } },
      { permission: { read: "allow" } },
    );
    expect(merged.permission).toEqual({ read: "allow" });
  });

  it("object replaces string when override uses object for same surface", () => {
    const merged = mergeUnifiedConfigs(
      { permission: { bash: "ask" } },
      { permission: { bash: { "*": "allow", "rm -rf *": "deny" } } },
    );
    expect(merged.permission).toEqual({
      bash: { "*": "allow", "rm -rf *": "deny" },
    });
  });

  it("string replaces object when override uses string for same surface", () => {
    const merged = mergeUnifiedConfigs(
      { permission: { bash: { "git *": "allow" } } },
      { permission: { bash: "deny" } },
    );
    expect(merged.permission).toEqual({ bash: "deny" });
  });

  it("replaces scalar runtime knobs (project wins)", () => {
    const merged = mergeUnifiedConfigs(
      { debugLog: true, permissionReviewLog: true, yoloMode: false },
      { debugLog: false, yoloMode: true },
    );

    expect(merged.debugLog).toBe(false);
    expect(merged.permissionReviewLog).toBe(true);
    expect(merged.yoloMode).toBe(true);
  });

  it("replaces optional runtime knobs when overrides define them", () => {
    const merged = mergeUnifiedConfigs(
      {
        piInfrastructureReadPaths: ["/global/pi"],
        toolInputPreviewMaxLength: 400,
        toolTextSummaryMaxLength: 120,
      },
      {
        piInfrastructureReadPaths: ["/project/pi"],
        toolTextSummaryMaxLength: 240,
      },
    );

    expect(merged).toEqual({
      piInfrastructureReadPaths: ["/project/pi"],
      toolInputPreviewMaxLength: 400,
      toolTextSummaryMaxLength: 240,
    });
  });

  it("returns base unchanged when override is empty", () => {
    const base = {
      debugLog: true,
      permission: { read: "allow" as const },
    };
    const merged = mergeUnifiedConfigs(base, {});

    expect(merged.debugLog).toBe(true);
    expect(merged.permission).toEqual({ read: "allow" });
  });

  it("returns override unchanged when base is empty", () => {
    const override = {
      yoloMode: true,
      permission: { bash: { "rm -rf *": "deny" as const } },
    };
    const merged = mergeUnifiedConfigs({}, override);

    expect(merged.yoloMode).toBe(true);
    expect(merged.permission).toEqual({ bash: { "rm -rf *": "deny" } });
  });

  it("does not set undefined keys in the merged result", () => {
    const merged = mergeUnifiedConfigs({ debugLog: true }, { yoloMode: false });

    expect(merged.debugLog).toBe(true);
    expect(merged.yoloMode).toBe(false);
    expect(merged).not.toHaveProperty("permissionReviewLog");
    expect(merged).not.toHaveProperty("permission");
  });
});

describe("loadAndMergeConfigs", () => {
  let tempDir: string;
  let agentDir: string;
  let cwd: string;
  let extensionRoot: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "config-merge-test-"));
    agentDir = join(tempDir, "agent");
    cwd = join(tempDir, "project");
    extensionRoot = join(tempDir, "ext");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeGlobal(content: Record<string, unknown>): void {
    const dir = join(agentDir, "extensions", "pi-permission-system");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify(content));
  }

  function writeProject(content: Record<string, unknown>): void {
    const dir = join(cwd, ".pi", "extensions", "pi-permission-system");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify(content));
  }

  function writeLegacyGlobalPolicy(content: Record<string, unknown>): void {
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "pi-permissions.jsonc"),
      JSON.stringify(content),
    );
  }

  function writeLegacyProjectPolicy(content: Record<string, unknown>): void {
    const dir = join(cwd, ".pi", "agent");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pi-permissions.jsonc"), JSON.stringify(content));
  }

  function writeLegacyExtensionConfig(content: Record<string, unknown>): void {
    mkdirSync(extensionRoot, { recursive: true });
    writeFileSync(join(extensionRoot, "config.json"), JSON.stringify(content));
  }

  it("merges global and project new-layout configs", () => {
    writeGlobal({
      debugLog: true,
      permission: { "*": "ask", read: "allow" },
    });
    writeProject({
      permission: { "*": "allow", write: "deny" },
    });

    const result = loadAndMergeConfigs(agentDir, cwd, extensionRoot);
    expect(result.issues).toEqual([]);
    expect(result.merged.debugLog).toBe(true);
    expect(result.merged.permission).toEqual({
      "*": "allow",
      read: "allow",
      write: "deny",
    });
  });

  it("merges optional runtime knobs from new-layout configs", () => {
    writeGlobal({
      piInfrastructureReadPaths: ["/global/pi"],
      toolInputPreviewMaxLength: 400,
      toolTextSummaryMaxLength: 120,
    });
    writeProject({
      piInfrastructureReadPaths: ["/project/pi"],
      toolTextSummaryMaxLength: 240,
    });

    const result = loadAndMergeConfigs(agentDir, cwd, extensionRoot);
    expect(result.issues).toEqual([]);
    expect(result.merged).toEqual({
      piInfrastructureReadPaths: ["/project/pi"],
      toolInputPreviewMaxLength: 400,
      toolTextSummaryMaxLength: 240,
    });
  });

  it("detects legacy global policy and emits migration issue", () => {
    writeLegacyGlobalPolicy({
      defaultPolicy: { tools: "allow" },
      tools: { read: "allow" },
    });

    const result = loadAndMergeConfigs(agentDir, cwd, extensionRoot);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain("pi-permissions.jsonc");
    expect(result.issues[0]).toContain("extensions/pi-permission-system");
    // Legacy file has no flat-format permission key — no rules extracted
    expect(result.merged.permission).toBeUndefined();
  });

  it("detects legacy project policy and emits migration issue", () => {
    writeLegacyProjectPolicy({
      bash: { "git status": "allow" },
    });

    const result = loadAndMergeConfigs(agentDir, cwd, extensionRoot);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain(".pi/agent/pi-permissions.jsonc");
    expect(result.issues[0]).toContain(".pi/extensions/pi-permission-system");
    // Legacy file has no flat-format permission key — no rules extracted
    expect(result.merged.permission).toBeUndefined();
  });

  it("detects legacy extension runtime config and emits migration issue", () => {
    writeLegacyExtensionConfig({
      debugLog: true,
      yoloMode: true,
    });

    const result = loadAndMergeConfigs(agentDir, cwd, extensionRoot);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain(extensionRoot);
    expect(result.merged.debugLog).toBe(true);
    expect(result.merged.yoloMode).toBe(true);
  });

  it("does not emit legacy extension config issue when path equals new global path", () => {
    const newGlobalDir = join(agentDir, "extensions", "pi-permission-system");
    mkdirSync(newGlobalDir, { recursive: true });
    writeFileSync(
      join(newGlobalDir, "config.json"),
      JSON.stringify({ debugLog: true }),
    );

    const result = loadAndMergeConfigs(agentDir, cwd, newGlobalDir);
    expect(result.issues.filter((i) => i.includes("legacy"))).toHaveLength(0);
  });

  it("emits no issues when no legacy files exist and no new files exist", () => {
    const result = loadAndMergeConfigs(agentDir, cwd, extensionRoot);
    expect(result.issues).toEqual([]);
  });

  it("new-layout config takes precedence over legacy config at same scope", () => {
    writeGlobal({
      permission: { "*": "deny" },
    });
    writeLegacyGlobalPolicy({
      permission: { "*": "allow" },
    });

    const result = loadAndMergeConfigs(agentDir, cwd, extensionRoot);
    // New layout wins (legacy loaded first, new layout loaded second → new wins)
    expect(result.merged.permission).toEqual({ "*": "deny" });
    // But legacy still emits a migration warning
    expect(result.issues.some((i) => i.includes("pi-permissions.jsonc"))).toBe(
      true,
    );
  });
});
