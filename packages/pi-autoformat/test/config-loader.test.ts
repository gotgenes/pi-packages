import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getGlobalConfigPath,
  getProjectConfigPath,
  loadAutoformatConfig,
  validateUserFormatterConfig,
} from "#src/config-loader";

describe("validateUserFormatterConfig", () => {
  it("accepts $schema and known config fields", () => {
    const result = validateUserFormatterConfig({
      $schema: "https://example.com/schema.json",
      commandTimeoutMs: 5000,
      hideSummariesInTui: true,
      formatters: {
        prettier: {
          command: ["prettier", "--write"],
        },
      },
      chains: {
        ".MD": ["prettier"],
      },
    });

    expect(result.issues).toEqual([]);
    expect(result.config).toEqual({
      commandTimeoutMs: 5000,
      hideSummariesInTui: true,
      formatters: {
        prettier: {
          command: ["prettier", "--write"],
        },
      },
      chains: {
        ".md": ["prettier"],
      },
    });
  });

  it("rejects formatter commands containing the legacy $FILE token", () => {
    const result = validateUserFormatterConfig({
      formatters: {
        prettier: {
          command: ["prettier", "--write", "$FILE"],
        },
      },
    });

    expect(result.issues).toEqual([
      expect.objectContaining({
        path: "formatters.prettier.command",
        message: expect.stringContaining("$FILE"),
      }),
    ]);
    expect(result.config.formatters).toEqual({});
  });

  it("rejects $FILE embedded inside a command argument", () => {
    const result = validateUserFormatterConfig({
      formatters: {
        prettier: {
          command: ["prettier", "--stdin-filepath=$FILE"],
        },
      },
    });

    expect(result.issues[0]?.message).toMatch(/\$FILE/);
    expect(result.config.formatters).toEqual({});
  });

  it("accepts a deprecated extensions field on a formatter and drops it with a notice", () => {
    const result = validateUserFormatterConfig({
      formatters: {
        prettier: {
          command: ["prettier", "--write"],
          extensions: [".ts"],
        },
      },
    });

    expect(result.config.formatters).toEqual({
      prettier: {
        command: ["prettier", "--write"],
      },
    });
    expect(result.config.formatters?.prettier).not.toHaveProperty("extensions");
    const extensionsIssues = result.issues.filter(
      (issue) => issue.path === "formatters.prettier.extensions",
    );
    expect(extensionsIssues).toHaveLength(1);
    expect(extensionsIssues[0]?.message).toMatch(/[Dd]eprecat/);
  });

  describe("chains: fallback step shape", () => {
    it("accepts a string step (current behavior)", () => {
      const result = validateUserFormatterConfig({
        formatters: { prettier: { command: ["prettier", "--write"] } },
        chains: { ".ts": ["prettier"] },
      });
      expect(result.issues).toEqual([]);
      expect(result.config.chains).toEqual({ ".ts": ["prettier"] });
    });

    it("accepts a fallback object step", () => {
      const result = validateUserFormatterConfig({
        formatters: {
          biome: { command: ["biome", "format", "--write"] },
          prettier: { command: ["prettier", "--write"] },
        },
        chains: {
          ".ts": [{ fallback: ["biome", "prettier"] }],
        },
      });
      expect(result.issues).toEqual([]);
      expect(result.config.chains).toEqual({
        ".ts": [{ fallback: ["biome", "prettier"] }],
      });
    });

    it("accepts a chain mixing string and fallback steps", () => {
      const result = validateUserFormatterConfig({
        formatters: {
          biome: { command: ["biome", "format", "--write"] },
          prettier: { command: ["prettier", "--write"] },
          "markdownlint-cli2": {
            command: ["markdownlint-cli2", "--fix"],
          },
        },
        chains: {
          ".md": [{ fallback: ["biome", "prettier"] }, "markdownlint-cli2"],
        },
      });
      expect(result.issues).toEqual([]);
      expect(result.config.chains?.[".md"]).toEqual([
        { fallback: ["biome", "prettier"] },
        "markdownlint-cli2",
      ]);
    });

    it("rejects an empty fallback array", () => {
      const result = validateUserFormatterConfig({
        formatters: { prettier: { command: ["prettier", "--write"] } },
        chains: { ".ts": [{ fallback: [] }] },
      });
      expect(result.issues).toEqual([
        expect.objectContaining({
          path: "chains..ts[0].fallback",
        }),
      ]);
      expect(result.config.chains?.[".ts"]).toBeUndefined();
    });

    it("rejects a fallback object with unknown sibling keys", () => {
      const result = validateUserFormatterConfig({
        formatters: { prettier: { command: ["prettier", "--write"] } },
        chains: {
          ".ts": [{ fallback: ["prettier"], when: "never" }],
        },
      });
      expect(result.issues.some((i) => i.path === "chains..ts[0].when")).toBe(
        true,
      );
    });

    it("rejects a step that is neither string nor fallback object", () => {
      const result = validateUserFormatterConfig({
        formatters: { prettier: { command: ["prettier", "--write"] } },
        chains: { ".ts": [42 as unknown as string] },
      });
      expect(result.issues.some((i) => i.path === "chains..ts[0]")).toBe(true);
    });

    it("warns when a fallback alternative names an unknown formatter and drops the step", () => {
      const result = validateUserFormatterConfig({
        formatters: { prettier: { command: ["prettier", "--write"] } },
        chains: {
          ".ts": [{ fallback: ["zogzog", "prettier"] }],
        },
      });
      const unknown = result.issues.filter(
        (i) => i.path === "chains..ts[0].fallback[0]",
      );
      expect(unknown).toHaveLength(1);
      expect(unknown[0]?.message).toMatch(/unknown|not found/i);
      expect(result.config.chains?.[".ts"]).toBeUndefined();
    });

    it("warns when a single string step references an unknown formatter and drops the step", () => {
      const result = validateUserFormatterConfig({
        formatters: {},
        chains: { ".ts": ["zogzog"] },
      });
      const unknown = result.issues.filter((i) => i.path === "chains..ts[0]");
      expect(unknown).toHaveLength(1);
      expect(unknown[0]?.message).toMatch(/unknown|not found/i);
      expect(result.config.chains?.[".ts"]).toBeUndefined();
    });

    it("does not warn when a chain references a built-in default formatter not redeclared locally", () => {
      const result = validateUserFormatterConfig({
        chains: { ".md": ["prettier", "markdownlint-cli2"] },
      });
      expect(result.issues).toEqual([]);
      expect(result.config.chains?.[".md"]).toEqual([
        "prettier",
        "markdownlint-cli2",
      ]);
    });

    it("accepts the literal '*' wildcard chain key", () => {
      const result = validateUserFormatterConfig({
        chains: { "*": ["treefmt"] },
      });
      expect(result.issues).toEqual([]);
      expect(result.config.chains?.["*"]).toEqual(["treefmt"]);
    });

    it("accepts built-in formatter names without a formatters entry", () => {
      const result = validateUserFormatterConfig({
        chains: {
          "*": [{ fallback: ["treefmt-nix", "treefmt"] }],
          ".ts": ["treefmt"],
        },
      });
      expect(result.issues).toEqual([]);
      expect(result.config.chains?.["*"]).toEqual([
        { fallback: ["treefmt-nix", "treefmt"] },
      ]);
      expect(result.config.chains?.[".ts"]).toEqual(["treefmt"]);
    });

    it("emits a non-fatal config issue when a user shadows a built-in name in formatters", () => {
      const result = validateUserFormatterConfig({
        formatters: {
          treefmt: { command: ["treefmt", "--ci"] },
        },
        chains: { "*": ["treefmt"] },
      });
      const shadow = result.issues.filter((i) =>
        i.path.startsWith("formatters.treefmt"),
      );
      expect(shadow).toHaveLength(1);
      expect(shadow[0]?.message).toMatch(/built-in|builtin/i);
      // The user's definition still wins (escape hatch).
      expect(result.config.formatters?.treefmt.command).toEqual([
        "treefmt",
        "--ci",
      ]);
    });

    it("rejects a non-string entry inside fallback", () => {
      const result = validateUserFormatterConfig({
        formatters: { prettier: { command: ["prettier", "--write"] } },
        chains: {
          ".ts": [{ fallback: ["prettier", 7 as unknown as string] }],
        },
      });
      expect(
        result.issues.some((i) => i.path === "chains..ts[0].fallback[1]"),
      ).toBe(true);
    });
  });

  it("emits a config issue for the legacy formatMode key", () => {
    const result = validateUserFormatterConfig({
      formatMode: "prompt",
    });

    expect(result.issues).toEqual([
      expect.objectContaining({
        path: "formatMode",
        message: expect.stringContaining("removed"),
      }),
    ]);
    expect(result.config).not.toHaveProperty("formatMode");
  });

  it("emits a config issue for any formatMode value including invalid ones", () => {
    const result = validateUserFormatterConfig({
      formatMode: "tool",
    });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.path).toBe("formatMode");
    expect(result.config).not.toHaveProperty("formatMode");
  });

  it("reports invalid fields and returns only valid fragments", () => {
    const result = validateUserFormatterConfig({
      commandTimeoutMs: 0,
      unexpected: true,
      formatters: {
        prettier: {
          command: ["prettier", "--write"],
        },
      },
    });

    expect(result.config).toEqual({
      formatters: {
        prettier: {
          command: ["prettier", "--write"],
        },
      },
    });
    expect(result.issues.map((issue) => issue.path)).toEqual([
      "commandTimeoutMs",
      "unexpected",
    ]);
  });
});

describe("loadAutoformatConfig", () => {
  it("uses default config when no files exist", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-autoformat-config-"));
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(agentDir, { recursive: true });

    const result = loadAutoformatConfig({ cwd, agentDir });

    expect(result.config).not.toHaveProperty("formatMode");
    expect(result.config).not.toHaveProperty("notifyAgent");
    expect(result.config.commandTimeoutMs).toBe(10000);
    expect(result.config.hideSummariesInTui).toBe(false);
    expect(result.issues).toEqual([]);
  });

  it("merges global and project config with project precedence", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-autoformat-config-"));
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(agentDir, { recursive: true });

    mkdirSync(join(agentDir, "extensions", "pi-autoformat"), {
      recursive: true,
    });
    writeFileSync(
      getGlobalConfigPath(agentDir),
      JSON.stringify(
        {
          commandTimeoutMs: 5000,
          formatters: {
            prettier: {
              command: ["pnpm", "exec", "prettier", "--write"],
            },
          },
          chains: {
            ".md": ["prettier"],
          },
        },
        null,
        2,
      ),
    );

    mkdirSync(join(cwd, ".pi", "extensions", "pi-autoformat"), {
      recursive: true,
    });
    writeFileSync(
      getProjectConfigPath(cwd),
      JSON.stringify(
        {
          hideSummariesInTui: true,
          formatters: {
            "markdownlint-cli2": {
              command: ["pnpm", "exec", "markdownlint-cli2", "--fix"],
            },
          },
          chains: {
            ".md": ["prettier", "markdownlint-cli2"],
          },
        },
        null,
        2,
      ),
    );

    const result = loadAutoformatConfig({ cwd, agentDir });

    expect(result.config.commandTimeoutMs).toBe(5000);
    expect(result.config.hideSummariesInTui).toBe(true);
    expect(result.config.formatters.prettier.command).toEqual([
      "pnpm",
      "exec",
      "prettier",
      "--write",
    ]);
    expect(result.config.formatters["markdownlint-cli2"].command).toEqual([
      "pnpm",
      "exec",
      "markdownlint-cli2",
      "--fix",
    ]);
    expect(result.config.chains[".md"]).toEqual([
      "prettier",
      "markdownlint-cli2",
    ]);
    expect(result.issues).toEqual([]);
  });

  it("loads formatScope and shellMutationDetection settings", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-autoformat-config-"));
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(agentDir, { recursive: true });

    mkdirSync(join(agentDir, "extensions", "pi-autoformat"), {
      recursive: true,
    });
    writeFileSync(
      getGlobalConfigPath(agentDir),
      JSON.stringify({
        formatScope: "cwd",
        shellMutationDetection: {
          enabled: true,
          snapshotGlobs: ["src/**/*.ts"],
        },
      }),
    );

    mkdirSync(join(cwd, ".pi", "extensions", "pi-autoformat"), {
      recursive: true,
    });
    writeFileSync(
      getProjectConfigPath(cwd),
      JSON.stringify({
        formatScope: ["packages/a"],
        shellMutationDetection: {
          snapshotGlobs: ["docs/**/*.md"],
          wrappers: [{ prefix: "pnpm codegen", outputFormat: "lines" }],
        },
      }),
    );

    const result = loadAutoformatConfig({ cwd, agentDir });

    expect(result.issues).toEqual([]);
    expect(result.config.formatScope).toEqual(["packages/a"]);
    expect(result.config.shellMutationDetection).toEqual({
      enabled: true,
      argumentParsing: true,
      snapshotGlobs: ["docs/**/*.md"],
      wrappers: [{ prefix: "pnpm codegen", outputFormat: "lines" }],
    });
  });

  it("defaults shellMutationDetection to disabled with formatScope=repoRoot", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-autoformat-config-"));
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(agentDir, { recursive: true });

    const result = loadAutoformatConfig({ cwd, agentDir });
    expect(result.config.formatScope).toBe("repoRoot");
    expect(result.config.shellMutationDetection).toEqual({
      enabled: false,
      argumentParsing: true,
      snapshotGlobs: [],
      wrappers: [],
    });
  });

  it("loads customMutationTools and eventBusMutationChannel settings", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-autoformat-config-"));
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(agentDir, { recursive: true });

    mkdirSync(join(agentDir, "extensions", "pi-autoformat"), {
      recursive: true,
    });
    writeFileSync(
      getGlobalConfigPath(agentDir),
      JSON.stringify({
        customMutationTools: [{ toolName: "global_tool", pathField: "path" }],
        eventBusMutationChannel: { enabled: false },
      }),
    );

    mkdirSync(join(cwd, ".pi", "extensions", "pi-autoformat"), {
      recursive: true,
    });
    writeFileSync(
      getProjectConfigPath(cwd),
      JSON.stringify({
        customMutationTools: [
          { toolName: "mcp_files_write", pathField: "path" },
          { toolName: "codemod", pathFields: ["target", "extras"] },
        ],
        eventBusMutationChannel: { channel: "custom:channel" },
      }),
    );

    const result = loadAutoformatConfig({ cwd, agentDir });

    expect(result.issues).toEqual([]);
    // Project replaces global wholesale for the array.
    expect(result.config.customMutationTools).toEqual([
      { toolName: "mcp_files_write", pathField: "path" },
      { toolName: "codemod", pathFields: ["target", "extras"] },
    ]);
    // Scalar fields merge: project channel wins, global enabled persists.
    expect(result.config.eventBusMutationChannel).toEqual({
      enabled: false,
      channel: "custom:channel",
    });
  });

  it("defaults customMutationTools to [] and eventBusMutationChannel to enabled", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-autoformat-config-"));
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(agentDir, { recursive: true });

    const result = loadAutoformatConfig({ cwd, agentDir });

    expect(result.config.customMutationTools).toEqual([]);
    expect(result.config.eventBusMutationChannel).toEqual({
      enabled: true,
      channel: "autoformat:touched",
    });
  });

  it("reports parse and validation errors without throwing", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-autoformat-config-"));
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(agentDir, { recursive: true });

    mkdirSync(join(agentDir, "extensions", "pi-autoformat"), {
      recursive: true,
    });
    writeFileSync(getGlobalConfigPath(agentDir), "{not json\n");

    mkdirSync(join(cwd, ".pi", "extensions", "pi-autoformat"), {
      recursive: true,
    });
    writeFileSync(
      getProjectConfigPath(cwd),
      JSON.stringify({
        hideSummariesInTui: "yes",
      }),
    );

    const result = loadAutoformatConfig({ cwd, agentDir });

    expect(result.config.hideSummariesInTui).toBe(false);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]?.sourcePath).toBe(getGlobalConfigPath(agentDir));
    expect(result.issues[1]?.path).toBe("hideSummariesInTui");
  });
});

describe("validateUserFormatterConfig: customMutationTools", () => {
  it("accepts entries with pathField, pathFields, or patchField", () => {
    const result = validateUserFormatterConfig({
      customMutationTools: [
        { toolName: "a", pathField: "path" },
        { toolName: "b", pathFields: ["target", "args.extra"] },
        { toolName: "c", patchField: "args.patch" },
      ],
    });
    expect(result.issues).toEqual([]);
    expect(result.config.customMutationTools).toEqual([
      { toolName: "a", pathField: "path" },
      { toolName: "b", pathFields: ["target", "args.extra"] },
      { toolName: "c", patchField: "args.patch" },
    ]);
  });

  it("rejects built-in tool names", () => {
    const result = validateUserFormatterConfig({
      customMutationTools: [
        { toolName: "write", pathField: "path" },
        { toolName: "bash", pathField: "path" },
        { toolName: "grep", pathField: "pattern" },
      ],
    });
    expect(result.issues.map((i) => i.path)).toEqual([
      "customMutationTools[0].toolName",
      "customMutationTools[1].toolName",
      "customMutationTools[2].toolName",
    ]);
    expect(result.config.customMutationTools).toBeUndefined();
  });

  it("rejects duplicate toolName entries", () => {
    const result = validateUserFormatterConfig({
      customMutationTools: [
        { toolName: "dup", pathField: "a" },
        { toolName: "dup", pathField: "b" },
      ],
    });
    expect(result.issues.map((i) => i.path)).toEqual([
      "customMutationTools[1].toolName",
    ]);
  });

  it("rejects entries with both pathField and pathFields", () => {
    const result = validateUserFormatterConfig({
      customMutationTools: [
        { toolName: "x", pathField: "a", pathFields: ["b"] },
      ],
    });
    expect(result.issues.map((i) => i.path)).toEqual([
      "customMutationTools[0]",
    ]);
  });

  it("rejects patchField combined with either path setting", () => {
    const result = validateUserFormatterConfig({
      customMutationTools: [
        { toolName: "x", pathField: "path", patchField: "patch" },
        { toolName: "y", pathFields: ["path"], patchField: "patch" },
      ],
    });
    expect(result.issues.map((i) => i.path)).toEqual([
      "customMutationTools[0]",
      "customMutationTools[1]",
    ]);
  });

  it("rejects entries with neither pathField nor pathFields", () => {
    const result = validateUserFormatterConfig({
      customMutationTools: [{ toolName: "x" }],
    });
    expect(result.issues.map((i) => i.path)).toEqual([
      "customMutationTools[0]",
    ]);
  });

  it("rejects empty or non-string dotted paths", () => {
    const result = validateUserFormatterConfig({
      customMutationTools: [
        { toolName: "a", pathField: "" },
        { toolName: "b", pathFields: ["valid", ""] },
        { toolName: "c", pathFields: [42] },
        { toolName: "d", patchField: "" },
        { toolName: "e", patchField: 42 },
      ],
    });
    expect(result.issues.map((i) => i.path)).toEqual([
      "customMutationTools[0].pathField",
      "customMutationTools[1].pathFields[1]",
      "customMutationTools[2].pathFields[0]",
      "customMutationTools[3].patchField",
      "customMutationTools[4].patchField",
    ]);
  });

  it("rejects non-array customMutationTools", () => {
    const result = validateUserFormatterConfig({
      customMutationTools: { toolName: "x", pathField: "path" },
    });
    expect(result.issues.map((i) => i.path)).toEqual(["customMutationTools"]);
  });

  it("rejects empty toolName", () => {
    const result = validateUserFormatterConfig({
      customMutationTools: [{ toolName: "", pathField: "path" }],
    });
    expect(result.issues.map((i) => i.path)).toEqual([
      "customMutationTools[0].toolName",
    ]);
  });

  it("rejects unknown properties on entries", () => {
    const result = validateUserFormatterConfig({
      customMutationTools: [{ toolName: "x", pathField: "path", weird: true }],
    });
    expect(result.issues.map((i) => i.path)).toEqual([
      "customMutationTools[0].weird",
    ]);
  });
});

describe("validateUserFormatterConfig: formatterOutput", () => {
  it("accepts a fully specified formatterOutput object", () => {
    const result = validateUserFormatterConfig({
      formatterOutput: {
        onFailure: "stderr",
        maxBytes: 2048,
        maxLines: 20,
      },
    });
    expect(result.issues).toEqual([]);
    expect(result.config.formatterOutput).toEqual({
      onFailure: "stderr",
      maxBytes: 2048,
      maxLines: 20,
    });
  });

  it("accepts a partial formatterOutput (just onFailure)", () => {
    const result = validateUserFormatterConfig({
      formatterOutput: { onFailure: "both" },
    });
    expect(result.issues).toEqual([]);
    expect(result.config.formatterOutput).toEqual({ onFailure: "both" });
  });

  it("rejects an invalid onFailure value and falls back to default", () => {
    const result = validateUserFormatterConfig({
      formatterOutput: { onFailure: "verbose" },
    });
    expect(result.issues.map((i) => i.path)).toEqual([
      "formatterOutput.onFailure",
    ]);
    // No formatterOutput key written when its only field was invalid; the
    // user config falls back to defaults via createFormatterConfig.
    expect(result.config.formatterOutput).toBeUndefined();
  });

  it("rejects negative or non-integer caps", () => {
    const result = validateUserFormatterConfig({
      formatterOutput: { maxBytes: -1, maxLines: 1.5 },
    });
    const paths = result.issues.map((i) => i.path).sort();
    expect(paths).toEqual([
      "formatterOutput.maxBytes",
      "formatterOutput.maxLines",
    ]);
  });

  it("rejects non-object values", () => {
    const result = validateUserFormatterConfig({
      formatterOutput: "yes",
    });
    expect(result.issues.map((i) => i.path)).toEqual(["formatterOutput"]);
  });

  it("rejects unknown sub-keys", () => {
    const result = validateUserFormatterConfig({
      formatterOutput: { onFailure: "none", weird: 1 },
    });
    expect(result.issues.map((i) => i.path)).toEqual(["formatterOutput.weird"]);
  });
});

describe("validateUserFormatterConfig: eventBusMutationChannel", () => {
  it("accepts enabled and channel fields", () => {
    const result = validateUserFormatterConfig({
      eventBusMutationChannel: {
        enabled: false,
        channel: "my:channel",
      },
    });
    expect(result.issues).toEqual([]);
    expect(result.config.eventBusMutationChannel).toEqual({
      enabled: false,
      channel: "my:channel",
    });
  });

  it("accepts a partial config (just enabled)", () => {
    const result = validateUserFormatterConfig({
      eventBusMutationChannel: { enabled: true },
    });
    expect(result.issues).toEqual([]);
    expect(result.config.eventBusMutationChannel).toEqual({ enabled: true });
  });

  it("rejects non-object values", () => {
    const result = validateUserFormatterConfig({
      eventBusMutationChannel: "yes",
    });
    expect(result.issues.map((i) => i.path)).toEqual([
      "eventBusMutationChannel",
    ]);
  });

  it("rejects non-boolean enabled", () => {
    const result = validateUserFormatterConfig({
      eventBusMutationChannel: { enabled: "yes" },
    });
    expect(result.issues.map((i) => i.path)).toEqual([
      "eventBusMutationChannel.enabled",
    ]);
  });

  it("rejects empty / non-string channel", () => {
    const result = validateUserFormatterConfig({
      eventBusMutationChannel: { channel: "" },
    });
    expect(result.issues.map((i) => i.path)).toEqual([
      "eventBusMutationChannel.channel",
    ]);
  });

  it("rejects unknown properties", () => {
    const result = validateUserFormatterConfig({
      eventBusMutationChannel: { enabled: true, weird: 1 },
    });
    expect(result.issues.map((i) => i.path)).toEqual([
      "eventBusMutationChannel.weird",
    ]);
  });
});

describe("validateUserFormatterConfig: notifyAgent (removed)", () => {
  it("emits a deprecation config issue when notifyAgent is present", () => {
    const result = validateUserFormatterConfig({
      notifyAgent: true,
    });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].path).toBe("notifyAgent");
    expect(result.issues[0].message).toContain("removed");
    expect(result.config).not.toHaveProperty("notifyAgent");
  });

  it("emits a deprecation issue even for notifyAgent: false", () => {
    const result = validateUserFormatterConfig({
      notifyAgent: false,
    });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].path).toBe("notifyAgent");
    expect(result.issues[0].message).toContain("removed");
  });

  it("does not include notifyAgent in the validated config", () => {
    const result = validateUserFormatterConfig({});
    expect(result.config).not.toHaveProperty("notifyAgent");
  });
});
