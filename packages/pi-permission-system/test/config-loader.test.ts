import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  detectDeprecatedPreviewCaps,
  loadAndMergeConfigs,
  loadUnifiedConfig,
  mergeUnifiedConfigs,
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

  it("rejects unknown keys with a clear issue and empty config", () => {
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
    expect(result.issues.join("\n")).toContain("unknownField");
    expect(result.issues.join("\n")).toContain("anotherRandom");
    // Fail-closed: the whole scope is rejected, dropping the valid field too.
    expect(result.config).toEqual({});
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

  it("rejects non-boolean runtime knobs with a clear issue", () => {
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
    expect(result.config).toEqual({});
    expect(result.issues.join("\n")).toContain("debugLog");
  });

  it("fails closed: an invalid field contributes no permission rules", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        permission: { "*": "allow", read: "allow" },
        toolInputPreviewMaxLength: -5,
      }),
    );

    const result = loadUnifiedConfig(configPath);
    // Even though permission carried `allow` rules, the invalid knob rejects
    // the whole scope so no `allow` leaks through — downstream falls to `ask`.
    expect(result.config).toEqual({});
    expect(result.config.permission).toBeUndefined();
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("rejects an invalid PermissionState inside a permission map", () => {
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
    expect(result.config).toEqual({});
    expect(result.issues.length).toBeGreaterThan(0);
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

  it("preserves a deny-with-reason object inside a pattern map", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        permission: {
          bash: {
            "git *": "allow",
            "npm *": { action: "deny", reason: "Use pnpm instead" },
          },
        },
      }),
    );

    const result = loadUnifiedConfig(configPath);
    expect(result.config.permission).toEqual({
      bash: {
        "git *": "allow",
        "npm *": { action: "deny", reason: "Use pnpm instead" },
      },
    });
  });

  it("rejects a deny object with a non-string reason", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        permission: {
          bash: {
            "git *": "allow",
            "npm *": { action: "deny", reason: 42 },
          },
        },
      }),
    );

    const result = loadUnifiedConfig(configPath);
    expect(result.config).toEqual({});
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("returns no permission when the permission field is absent", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ debugLog: false }));

    const result = loadUnifiedConfig(configPath);
    expect(result.config.permission).toBeUndefined();
  });

  it("rejects a non-object permission field", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ permission: "allow" }));

    const result = loadUnifiedConfig(configPath);
    expect(result.config).toEqual({});
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("parses forwardingTimeoutMs when a valid positive integer is present", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ forwardingTimeoutMs: 120_000 }));
    const result = loadUnifiedConfig(configPath);
    expect(result.config.forwardingTimeoutMs).toBe(120_000);
  });

  it("rejects a non-positive forwardingTimeoutMs", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ forwardingTimeoutMs: 0 }));
    const result = loadUnifiedConfig(configPath);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("parses toolInputPreviewMaxLength when a valid positive integer is present", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ toolInputPreviewMaxLength: 1000 }),
    );
    const result = loadUnifiedConfig(configPath);
    expect(result.config.toolInputPreviewMaxLength).toBe(1000);
  });

  it("parses toolTextSummaryMaxLength when a valid positive integer is present", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ toolTextSummaryMaxLength: 120 }),
    );
    const result = loadUnifiedConfig(configPath);
    expect(result.config.toolTextSummaryMaxLength).toBe(120);
  });

  it("omits toolInputPreviewMaxLength when absent", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ debugLog: false }));
    const result = loadUnifiedConfig(configPath);
    expect(result.config).not.toHaveProperty("toolInputPreviewMaxLength");
  });

  it("omits toolTextSummaryMaxLength when absent", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ debugLog: false }));
    const result = loadUnifiedConfig(configPath);
    expect(result.config).not.toHaveProperty("toolTextSummaryMaxLength");
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["float", 1.5],
    ["string", "200"],
    ["boolean", true],
  ] as const)("rejects invalid toolInputPreviewMaxLength: %s", (_label, value) => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ toolInputPreviewMaxLength: value }),
    );
    const result = loadUnifiedConfig(configPath);
    expect(result.config).toEqual({});
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["float", 1.5],
    ["string", "80"],
    ["boolean", false],
  ] as const)("rejects invalid toolTextSummaryMaxLength: %s", (_label, value) => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ toolTextSummaryMaxLength: value }),
    );
    const result = loadUnifiedConfig(configPath);
    expect(result.config).toEqual({});
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("parses piInfrastructureReadPaths when a valid string array is present", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ piInfrastructureReadPaths: ["/extra/path"] }),
    );
    const result = loadUnifiedConfig(configPath);
    expect(result.config.piInfrastructureReadPaths).toEqual(["/extra/path"]);
  });

  it("parses piInfrastructureReadPaths as empty array when set to []", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ piInfrastructureReadPaths: [] }),
    );
    const result = loadUnifiedConfig(configPath);
    expect(result.config.piInfrastructureReadPaths).toEqual([]);
  });

  it("omits piInfrastructureReadPaths when absent", () => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ debugLog: false }));
    const result = loadUnifiedConfig(configPath);
    expect(result.config).not.toHaveProperty("piInfrastructureReadPaths");
  });

  it.each([
    ["string", "not-an-array"],
    ["number", 42],
    ["mixed-type array", ["a", 1]],
    ["object", { a: "b" }],
  ] as const)("rejects invalid piInfrastructureReadPaths: %s", (_label, value) => {
    const configPath = join(tempDir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ piInfrastructureReadPaths: value }),
    );
    const result = loadUnifiedConfig(configPath);
    expect(result.config).toEqual({});
    expect(result.issues.length).toBeGreaterThan(0);
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
      {
        debugLog: true,
        permissionReviewLog: true,
        yoloMode: false,
        doublePressToConfirm: true,
      },
      { debugLog: false, yoloMode: true, doublePressToConfirm: false },
    );

    expect(merged.debugLog).toBe(false);
    expect(merged.permissionReviewLog).toBe(true);
    expect(merged.yoloMode).toBe(true);
    expect(merged.doublePressToConfirm).toBe(false);
  });

  it("replaces the prompt-budget scalars (project wins)", () => {
    const merged = mergeUnifiedConfigs(
      { promptMaxRows: 24, promptFieldMaxWidth: 400 },
      { promptMaxRows: 10 },
    );

    expect(merged.promptMaxRows).toBe(10);
    expect(merged.promptFieldMaxWidth).toBe(400);
  });

  it("replaces the review-log field width (project wins)", () => {
    expect(
      mergeUnifiedConfigs(
        { reviewLogFieldMaxWidth: 1000 },
        { reviewLogFieldMaxWidth: 200 },
      ).reviewLogFieldMaxWidth,
    ).toBe(200);
  });

  it("carries the review-log field width from the base when unoverridden", () => {
    expect(
      mergeUnifiedConfigs({ reviewLogFieldMaxWidth: 200 }, {})
        .reviewLogFieldMaxWidth,
    ).toBe(200);
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

  it("override toolInputPreviewMaxLength replaces base value", () => {
    const merged = mergeUnifiedConfigs(
      { toolInputPreviewMaxLength: 200 },
      { toolInputPreviewMaxLength: 1000 },
    );
    expect(merged.toolInputPreviewMaxLength).toBe(1000);
  });

  it("base toolInputPreviewMaxLength survives when override omits it", () => {
    const merged = mergeUnifiedConfigs(
      { toolInputPreviewMaxLength: 500 },
      { debugLog: true },
    );
    expect(merged.toolInputPreviewMaxLength).toBe(500);
  });

  it("toolInputPreviewMaxLength is absent when both base and override omit it", () => {
    const merged = mergeUnifiedConfigs({ debugLog: true }, { yoloMode: false });
    expect(merged).not.toHaveProperty("toolInputPreviewMaxLength");
  });

  it("override toolTextSummaryMaxLength replaces base value", () => {
    const merged = mergeUnifiedConfigs(
      { toolTextSummaryMaxLength: 80 },
      { toolTextSummaryMaxLength: 200 },
    );
    expect(merged.toolTextSummaryMaxLength).toBe(200);
  });

  it("base toolTextSummaryMaxLength survives when override omits it", () => {
    const merged = mergeUnifiedConfigs(
      { toolTextSummaryMaxLength: 120 },
      { debugLog: false },
    );
    expect(merged.toolTextSummaryMaxLength).toBe(120);
  });

  it("toolTextSummaryMaxLength is absent when both base and override omit it", () => {
    const merged = mergeUnifiedConfigs({}, { permissionReviewLog: true });
    expect(merged).not.toHaveProperty("toolTextSummaryMaxLength");
  });

  it("override piInfrastructureReadPaths replaces base array", () => {
    const merged = mergeUnifiedConfigs(
      { piInfrastructureReadPaths: ["/base/path"] },
      { piInfrastructureReadPaths: ["/override/path"] },
    );
    expect(merged.piInfrastructureReadPaths).toEqual(["/override/path"]);
  });

  it("base piInfrastructureReadPaths survives when override omits it", () => {
    const merged = mergeUnifiedConfigs(
      { piInfrastructureReadPaths: ["/kept/path"] },
      { debugLog: true },
    );
    expect(merged.piInfrastructureReadPaths).toEqual(["/kept/path"]);
  });

  it("piInfrastructureReadPaths is absent when both base and override omit it", () => {
    const merged = mergeUnifiedConfigs({ debugLog: true }, { yoloMode: false });
    expect(merged).not.toHaveProperty("piInfrastructureReadPaths");
  });

  it("override piInfrastructureReadPaths as empty array replaces non-empty base", () => {
    const merged = mergeUnifiedConfigs(
      { piInfrastructureReadPaths: ["/base/path"] },
      { piInfrastructureReadPaths: [] },
    );
    expect(merged.piInfrastructureReadPaths).toEqual([]);
  });

  it("override authorizerChain replaces base array", () => {
    const merged = mergeUnifiedConfigs(
      { authorizerChain: ["base-judge"] },
      { authorizerChain: ["override-judge"] },
    );
    expect(merged.authorizerChain).toEqual(["override-judge"]);
  });

  it("base authorizerChain survives when override omits it", () => {
    const merged = mergeUnifiedConfigs(
      { authorizerChain: ["kept-judge"] },
      { debugLog: true },
    );
    expect(merged.authorizerChain).toEqual(["kept-judge"]);
  });

  it("base shellTools survives when override omits it", () => {
    const merged = mergeUnifiedConfigs(
      { shellTools: { exec_command: { commandArgument: "cmd" } } },
      {},
    );
    expect(merged.shellTools).toEqual({
      exec_command: { commandArgument: "cmd" },
    });
  });

  it("override shellTools survives when base omits it", () => {
    const merged = mergeUnifiedConfigs(
      {},
      { shellTools: { exec_command: { commandArgument: "cmd" } } },
    );
    expect(merged.shellTools).toEqual({
      exec_command: { commandArgument: "cmd" },
    });
  });

  it("shallow-merges shellTools by tool name: override adds without dropping base", () => {
    const merged = mergeUnifiedConfigs(
      { shellTools: { exec_command: { commandArgument: "cmd" } } },
      { shellTools: { run_shell: { commandArgument: "script" } } },
    );
    expect(merged.shellTools).toEqual({
      exec_command: { commandArgument: "cmd" },
      run_shell: { commandArgument: "script" },
    });
  });

  it("override shellTools replaces a colliding tool's alias wholesale", () => {
    const merged = mergeUnifiedConfigs(
      {
        shellTools: {
          exec_command: { commandArgument: "cmd", workdirArgument: "workdir" },
        },
      },
      { shellTools: { exec_command: { commandArgument: "command" } } },
    );
    expect(merged.shellTools).toEqual({
      exec_command: { commandArgument: "command" },
    });
  });

  it("shellTools is absent when both base and override omit it", () => {
    const merged = mergeUnifiedConfigs({ debugLog: true }, { yoloMode: false });
    expect(merged).not.toHaveProperty("shellTools");
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
    // The merged config leaves a permissive top-level '*' with no bash '*' policy,
    // so the bash-fallback footgun warning is expected.
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain("bash");
    expect(result.merged.debugLog).toBe(true);
    expect(result.merged.permission).toEqual({
      "*": "allow",
      read: "allow",
      write: "deny",
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

  it("warns when the merged config leaves bash inheriting a permissive top-level '*'", () => {
    writeGlobal({
      permission: { "*": "allow", read: "allow" },
    });

    const result = loadAndMergeConfigs(agentDir, cwd, extensionRoot);
    expect(result.issues.some((i) => i.includes("bash"))).toBe(true);
  });

  it("does not warn about bash fallback when bash is explicitly gated", () => {
    writeGlobal({
      permission: { "*": "allow", bash: { "*": "ask" } },
    });

    const result = loadAndMergeConfigs(agentDir, cwd, extensionRoot);
    expect(result.issues).toEqual([]);
  });

  describe("includeProjectScope", () => {
    it("omits the new project config when includeProjectScope is false", () => {
      writeGlobal({
        permission: { "*": "ask", bash: "deny" },
      });
      writeProject({
        permission: { bash: "allow" },
      });

      const result = loadAndMergeConfigs(agentDir, cwd, extensionRoot, {
        includeProjectScope: false,
      });

      // The untrusted project's `bash: allow` must not override global `deny`.
      expect(result.merged.permission).toEqual({ "*": "ask", bash: "deny" });
      expect(result.project).toEqual({});
    });

    it("omits the legacy project policy when includeProjectScope is false", () => {
      writeGlobal({ permission: { "*": "ask" } });
      writeLegacyProjectPolicy({ permission: { "*": "allow" } });

      const result = loadAndMergeConfigs(agentDir, cwd, extensionRoot, {
        includeProjectScope: false,
      });

      expect(result.merged.permission).toEqual({ "*": "ask" });
      expect(
        result.issues.some((i) => i.includes("pi-permissions.jsonc")),
      ).toBe(false);
    });

    it("includes the project config when includeProjectScope is true", () => {
      writeGlobal({ permission: { "*": "ask", bash: "deny" } });
      writeProject({ permission: { bash: "allow" } });

      const result = loadAndMergeConfigs(agentDir, cwd, extensionRoot, {
        includeProjectScope: true,
      });

      expect(result.merged.permission).toEqual({ "*": "ask", bash: "allow" });
    });

    it("includes the project config by default (option omitted)", () => {
      writeGlobal({ permission: { "*": "ask", bash: "deny" } });
      writeProject({ permission: { bash: "allow" } });

      const result = loadAndMergeConfigs(agentDir, cwd, extensionRoot);

      expect(result.merged.permission).toEqual({ "*": "ask", bash: "allow" });
    });
  });

  describe("deprecated tool-preview caps", () => {
    it("notices a config that sets either cap", () => {
      writeGlobal({
        permission: { "*": "ask" },
        toolInputPreviewMaxLength: 400,
      });

      const result = loadAndMergeConfigs(agentDir, cwd, extensionRoot);

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toContain("toolInputPreviewMaxLength");
    });

    it("keeps accepting the config rather than rejecting it fail-closed", () => {
      writeGlobal({
        permission: { "*": "ask", bash: "deny" },
        toolTextSummaryMaxLength: 120,
      });

      const result = loadAndMergeConfigs(agentDir, cwd, extensionRoot);

      expect(result.merged.permission).toEqual({ "*": "ask", bash: "deny" });
    });

    it("stays silent when neither cap is set", () => {
      writeGlobal({ permission: { "*": "ask", bash: "deny" } });

      const result = loadAndMergeConfigs(agentDir, cwd, extensionRoot);

      expect(result.issues).toEqual([]);
    });
  });
});

// ── detectDeprecatedPreviewCaps ────────────────────────────────────────────

describe("detectDeprecatedPreviewCaps", () => {
  it("names the input-preview cap when it alone is set", () => {
    const notice = detectDeprecatedPreviewCaps({
      toolInputPreviewMaxLength: 400,
    });
    expect(notice).toContain("toolInputPreviewMaxLength");
    expect(notice).not.toContain("toolTextSummaryMaxLength");
  });

  it("names the text-summary cap when it alone is set", () => {
    const notice = detectDeprecatedPreviewCaps({
      toolTextSummaryMaxLength: 120,
    });
    expect(notice).toContain("toolTextSummaryMaxLength");
    expect(notice).not.toContain("toolInputPreviewMaxLength");
  });

  it("names both caps when both are set", () => {
    const notice = detectDeprecatedPreviewCaps({
      toolInputPreviewMaxLength: 400,
      toolTextSummaryMaxLength: 120,
    });
    expect(notice).toContain("toolInputPreviewMaxLength");
    expect(notice).toContain("toolTextSummaryMaxLength");
  });

  it("returns undefined when neither cap is set", () => {
    expect(detectDeprecatedPreviewCaps({})).toBeUndefined();
  });
});
