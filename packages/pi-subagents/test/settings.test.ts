import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadSettings,
  persistToastFor,
  SettingsManager,
  saveSettings,
} from "#src/settings";
import { captureWarn } from "#test/helpers/capture-warn";
import { createSettingsDirs, type SettingsDirs } from "#test/helpers/tmp-settings-dirs";

/**
 * Tests for persistent settings. Uses two tmp directories:
 * - `globalDir`: passed directly as agentDir. Simulates `~/.pi/agent/` — the global scope.
 * - `projectDir`: passed explicitly as cwd to load/save.
 *   Simulates the user's project root. Settings live at `<projectDir>/.pi/subagents.json`.
 */
describe("settings persistence", () => {
  let dirs: SettingsDirs;
  let globalDir: string;
  let projectDir: string;
  let globalFile: () => string;
  let projectFile: () => string;
  let writeGlobal: (obj: unknown) => void;
  let writeProject: (obj: unknown) => void;

  beforeEach(() => {
    dirs = createSettingsDirs("subagents.json");
    ({ globalDir, projectDir, globalFile, projectFile, writeGlobal, writeProject } = dirs);
  });

  afterEach(() => {
    dirs.dispose();
  });

  it("returns {} when both files are missing", () => {
    expect(loadSettings(globalDir, projectDir)).toEqual({});
  });

  it("returns {} when both files are malformed JSON", () => {
    writeFileSync(globalFile(), "not json {{");
    mkdirSync(join(projectDir, ".pi"), { recursive: true });
    writeFileSync(projectFile(), "also not json");
    expect(loadSettings(globalDir, projectDir)).toEqual({});
  });

  it("loads from global when no project file", () => {
    writeGlobal({ maxConcurrent: 16, graceTurns: 10 });
    expect(loadSettings(globalDir, projectDir)).toEqual({ maxConcurrent: 16, graceTurns: 10 });
  });

  it("loads from project when no global file", () => {
    writeProject({ maxConcurrent: 8 });
    expect(loadSettings(globalDir, projectDir)).toEqual({ maxConcurrent: 8 });
  });

  it("merges global + project with project winning on conflicts", () => {
    writeGlobal({ maxConcurrent: 16, graceTurns: 10 });
    writeProject({ maxConcurrent: 4, defaultMaxTurns: 50 });
    expect(loadSettings(globalDir, projectDir)).toEqual({
      maxConcurrent: 4, // project wins
      graceTurns: 10, // from global
      defaultMaxTurns: 50, // from project only
    });
  });

  it("round-trips values: saveSettings then loadSettings", () => {
    const settings = {
      maxConcurrent: 7,
      defaultMaxTurns: 30,
      graceTurns: 3,
    };
    saveSettings(settings, projectDir);
    expect(loadSettings(globalDir, projectDir)).toEqual(settings);
  });

  it("saveSettings writes only to the project file; global is untouched", () => {
    writeGlobal({ maxConcurrent: 16 });
    saveSettings({ maxConcurrent: 2 }, projectDir);

    // Project file contains the new value
    expect(JSON.parse(readFileSync(projectFile(), "utf-8"))).toEqual({ maxConcurrent: 2 });
    // Global file unchanged
    expect(JSON.parse(readFileSync(globalFile(), "utf-8"))).toEqual({ maxConcurrent: 16 });
  });

  it("saveSettings creates <cwd>/.pi/ when missing", () => {
    expect(existsSync(join(projectDir, ".pi"))).toBe(false);
    saveSettings({ maxConcurrent: 4 }, projectDir);
    expect(existsSync(projectFile())).toBe(true);
  });

  it("round-trips defaultMaxTurns: 0 (unlimited marker)", () => {
    saveSettings({ defaultMaxTurns: 0 }, projectDir);
    expect(loadSettings(globalDir, projectDir)).toEqual({ defaultMaxTurns: 0 });
  });

  it("ignores unknown extra fields on load (forward-compat)", () => {
    writeProject({ maxConcurrent: 2, futureField: "ignored" });
    const loaded = loadSettings(globalDir, projectDir);
    expect(loaded.maxConcurrent).toBe(2);
    // Unknown fields are stripped by the sanitizer — old versions won't persist garbage
    expect((loaded as Record<string, unknown>).futureField).toBeUndefined();
  });

  it("composes partial global + partial project correctly", () => {
    writeGlobal({ graceTurns: 10 });
    writeProject({ maxConcurrent: 2 });
    expect(loadSettings(globalDir, projectDir)).toEqual({ graceTurns: 10, maxConcurrent: 2 });
  });

  describe("sanitizer", () => {
    it("drops maxConcurrent < 1", () => {
      writeProject({ maxConcurrent: 0, graceTurns: 5 });
      expect(loadSettings(globalDir, projectDir)).toEqual({ graceTurns: 5 });
    });

    it("drops negative maxConcurrent", () => {
      writeProject({ maxConcurrent: -3 });
      expect(loadSettings(globalDir, projectDir)).toEqual({});
    });

    it("drops non-integer maxConcurrent (floats, NaN, strings)", () => {
      writeProject({ maxConcurrent: 3.5 });
      expect(loadSettings(globalDir, projectDir).maxConcurrent).toBeUndefined();
      writeProject({ maxConcurrent: "four" });
      expect(loadSettings(globalDir, projectDir).maxConcurrent).toBeUndefined();
      writeProject({ maxConcurrent: null });
      expect(loadSettings(globalDir, projectDir).maxConcurrent).toBeUndefined();
    });

    it("accepts defaultMaxTurns: 0 (explicit unlimited)", () => {
      writeProject({ defaultMaxTurns: 0 });
      expect(loadSettings(globalDir, projectDir)).toEqual({ defaultMaxTurns: 0 });
    });

    it("drops negative defaultMaxTurns", () => {
      writeProject({ defaultMaxTurns: -1 });
      expect(loadSettings(globalDir, projectDir)).toEqual({});
    });

    it("drops graceTurns < 1", () => {
      writeProject({ graceTurns: 0 });
      expect(loadSettings(globalDir, projectDir)).toEqual({});
    });

    it("accepts retention windows within [1, 20160]", () => {
      writeProject({ consumedSessionRetentionMinutes: 15, unconsumedSessionRetentionMinutes: 1440 });
      expect(loadSettings(globalDir, projectDir)).toEqual({
        consumedSessionRetentionMinutes: 15,
        unconsumedSessionRetentionMinutes: 1440,
      });
    });

    it("drops retention windows < 1, non-integer, or above the ceiling", () => {
      writeProject({ consumedSessionRetentionMinutes: 0 });
      expect(loadSettings(globalDir, projectDir).consumedSessionRetentionMinutes).toBeUndefined();
      writeProject({ unconsumedSessionRetentionMinutes: 20_161 });
      expect(loadSettings(globalDir, projectDir).unconsumedSessionRetentionMinutes).toBeUndefined();
      writeProject({ consumedSessionRetentionMinutes: 12.5 });
      expect(loadSettings(globalDir, projectDir).consumedSessionRetentionMinutes).toBeUndefined();
    });

    it("returns {} when the JSON root is not an object (array, string, null)", () => {
      mkdirSync(join(projectDir, ".pi"), { recursive: true });
      writeFileSync(projectFile(), '["not", "an", "object"]');
      expect(loadSettings(globalDir, projectDir)).toEqual({});
      writeFileSync(projectFile(), '"just a string"');
      expect(loadSettings(globalDir, projectDir)).toEqual({});
      writeFileSync(projectFile(), "null");
      expect(loadSettings(globalDir, projectDir)).toEqual({});
    });

    it("keeps valid fields while dropping invalid siblings", () => {
      writeProject({
        maxConcurrent: 4, // ok
        defaultMaxTurns: -5, // dropped
        graceTurns: 3, // ok
      });
      expect(loadSettings(globalDir, projectDir)).toEqual({ maxConcurrent: 4, graceTurns: 3 });
    });

    it("accepts values at the ceiling (maxConcurrent=1024, defaultMaxTurns=10000, graceTurns=1000)", () => {
      writeProject({ maxConcurrent: 1024, defaultMaxTurns: 10_000, graceTurns: 1_000 });
      expect(loadSettings(globalDir, projectDir)).toEqual({
        maxConcurrent: 1024,
        defaultMaxTurns: 10_000,
        graceTurns: 1_000,
      });
    });

    it("drops values above the ceiling", () => {
      writeProject({ maxConcurrent: 1025 });
      expect(loadSettings(globalDir, projectDir).maxConcurrent).toBeUndefined();
      writeProject({ defaultMaxTurns: 10_001 });
      expect(loadSettings(globalDir, projectDir).defaultMaxTurns).toBeUndefined();
      writeProject({ graceTurns: 1_001 });
      expect(loadSettings(globalDir, projectDir).graceTurns).toBeUndefined();
    });

    it("drops absurdly large values (e.g. 1e6)", () => {
      writeProject({ maxConcurrent: 1_000_000, defaultMaxTurns: 1_000_000, graceTurns: 1_000_000 });
      expect(loadSettings(globalDir, projectDir)).toEqual({});
    });

    it("keeps abortAllOnInterrupt when it is a boolean", () => {
      writeProject({ abortAllOnInterrupt: false });
      expect(loadSettings(globalDir, projectDir)).toEqual({ abortAllOnInterrupt: false });
      writeProject({ abortAllOnInterrupt: true });
      expect(loadSettings(globalDir, projectDir)).toEqual({ abortAllOnInterrupt: true });
    });

    it("drops a non-boolean abortAllOnInterrupt", () => {
      writeProject({ abortAllOnInterrupt: "false", graceTurns: 5 });
      expect(loadSettings(globalDir, projectDir)).toEqual({ graceTurns: 5 });
      writeProject({ abortAllOnInterrupt: 0 });
      expect(loadSettings(globalDir, projectDir)).toEqual({});
      writeProject({ abortAllOnInterrupt: null });
      expect(loadSettings(globalDir, projectDir)).toEqual({});
    });

    it("sanitizes and deduplicates excludedExtensionPackages", () => {
      writeProject({
        excludedExtensionPackages: [
          " npm:@cortexkit/pi-magic-context ",
          "npm:@cortexkit/pi-magic-context",
          "npm:keep",
          "",
          42,
        ],
      });
      expect(loadSettings(globalDir, projectDir)).toEqual({
        excludedExtensionPackages: ["npm:@cortexkit/pi-magic-context", "npm:keep"],
      });
    });

    it("drops excludedExtensionPackages when it is not an array", () => {
      writeProject({ excludedExtensionPackages: "npm:@cortexkit/pi-magic-context" });
      expect(loadSettings(globalDir, projectDir)).toEqual({});
    });
  });

  describe("save result + corrupt-file warning", () => {
    it("saveSettings returns true on success", () => {
      expect(saveSettings({ maxConcurrent: 2 }, projectDir)).toBe(true);
      expect(JSON.parse(readFileSync(projectFile(), "utf-8"))).toEqual({ maxConcurrent: 2 });
    });

    it("saveSettings returns false when the target dir cannot be created", () => {
      // Place a regular file where the parent of the settings file would go —
      // mkdirSync + writeFileSync both fail with ENOTDIR / EEXIST.
      const filePosingAsCwd = join(tmpdir(), `pi-settings-notdir-${Date.now()}`);
      writeFileSync(filePosingAsCwd, "");
      try {
        expect(saveSettings({ maxConcurrent: 1 }, filePosingAsCwd)).toBe(false);
      } finally {
        rmSync(filePosingAsCwd, { force: true });
      }
    });

    it("warns to console.warn when an existing file is malformed", () => {
      mkdirSync(join(projectDir, ".pi"), { recursive: true });
      writeFileSync(projectFile(), "not valid json {{{");
      const warnings = captureWarn(() => {
        expect(loadSettings(globalDir, projectDir)).toEqual({});
      });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/Ignoring malformed settings/);
    });

    it("does NOT warn when a file is simply missing", () => {
      const warnings = captureWarn(() => {
        expect(loadSettings(globalDir, projectDir)).toEqual({});
      });
      expect(warnings).toEqual([]);
    });
  });

  describe("persistToastFor", () => {
    it("returns info-level toast with the plain message on success", () => {
      expect(persistToastFor("Max concurrency set to 7", true)).toEqual({
        message: "Max concurrency set to 7",
        level: "info",
      });
    });

    it("returns warning-level toast with session-only suffix on failure", () => {
      expect(persistToastFor("Max concurrency set to 7", false)).toEqual({
        message: "Max concurrency set to 7 (session only; failed to persist)",
        level: "warning",
      });
    });
  });

});


describe("SettingsManager", () => {
  describe("constructor defaults", () => {
    it("defaults to defaultMaxTurns: undefined (unlimited)", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      expect(sm.defaultMaxTurns).toBeUndefined();
    });

    it("defaults to graceTurns: 5", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      expect(sm.graceTurns).toBe(5);
    });

    it("defaults to maxConcurrent: 4", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      expect(sm.maxConcurrent).toBe(4);
    });

    it("defaults to consumedSessionRetentionMinutes: 10", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      expect(sm.consumedSessionRetentionMinutes).toBe(10);
    });

    it("defaults to unconsumedSessionRetentionMinutes: 720", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      expect(sm.unconsumedSessionRetentionMinutes).toBe(720);
    });

    it("defaults to abortAllOnInterrupt: true (ESC keeps its current blast radius)", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      expect(sm.abortAllOnInterrupt).toBe(true);
    });

    it("defaults to no excluded extension packages", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      expect(sm.excludedExtensionPackages).toEqual([]);
    });
  });

  describe("retention setter normalization", () => {
    it("stores a positive consumed window as-is", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      sm.consumedSessionRetentionMinutes = 30;
      expect(sm.consumedSessionRetentionMinutes).toBe(30);
    });

    it("clamps consumed window below 1 to 1", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      sm.consumedSessionRetentionMinutes = 0;
      expect(sm.consumedSessionRetentionMinutes).toBe(1);
    });

    it("clamps unconsumed window above the two-week ceiling to 20160", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      sm.unconsumedSessionRetentionMinutes = 99_999;
      expect(sm.unconsumedSessionRetentionMinutes).toBe(20_160);
    });
  });

  describe("defaultMaxTurns setter normalization", () => {
    it("stores a positive value as-is", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      sm.defaultMaxTurns = 10;
      expect(sm.defaultMaxTurns).toBe(10);
    });

    it("maps 0 to undefined (unlimited)", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      sm.defaultMaxTurns = 10;
      sm.defaultMaxTurns = 0;
      expect(sm.defaultMaxTurns).toBeUndefined();
    });

    it("maps undefined to undefined", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      sm.defaultMaxTurns = 10;
      sm.defaultMaxTurns = undefined;
      expect(sm.defaultMaxTurns).toBeUndefined();
    });

    it("clamps values below 1 (but not 0) to 1", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      sm.defaultMaxTurns = -5;
      expect(sm.defaultMaxTurns).toBe(1);
    });
  });

  describe("graceTurns setter normalization", () => {
    it("stores a positive value as-is", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      sm.graceTurns = 10;
      expect(sm.graceTurns).toBe(10);
    });

    it("clamps 0 to 1", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      sm.graceTurns = 0;
      expect(sm.graceTurns).toBe(1);
    });

    it("clamps negative values to 1", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      sm.graceTurns = -3;
      expect(sm.graceTurns).toBe(1);
    });
  });

  describe("maxConcurrent setter normalization", () => {
    it("stores a positive value as-is", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      sm.maxConcurrent = 8;
      expect(sm.maxConcurrent).toBe(8);
    });

    it("clamps 0 to 1", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      sm.maxConcurrent = 0;
      expect(sm.maxConcurrent).toBe(1);
    });

    it("clamps negative values to 1", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      sm.maxConcurrent = -2;
      expect(sm.maxConcurrent).toBe(1);
    });
  });

  describe("load()", () => {
    let globalDir: string;
    let projectDir: string;

    beforeEach(() => {
      globalDir = mkdtempSync(join(tmpdir(), "pi-sm-global-"));
      projectDir = mkdtempSync(join(tmpdir(), "pi-sm-project-"));
    });

    afterEach(() => {
      rmSync(globalDir, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    });

    it("applies merged settings from disk to in-memory values", () => {
      mkdirSync(join(projectDir, ".pi"), { recursive: true });
      writeFileSync(join(projectDir, ".pi", "subagents.json"), JSON.stringify({ graceTurns: 7, maxConcurrent: 8 }));
      const emit = vi.fn();
      const sm = new SettingsManager({ emit, cwd: projectDir, agentDir: globalDir });
      sm.load();
      expect(sm.graceTurns).toBe(7);
      expect(sm.maxConcurrent).toBe(8);
      expect(sm.defaultMaxTurns).toBeUndefined();
    });

    it("applies defaultMaxTurns from disk (0 → unlimited)", () => {
      mkdirSync(join(projectDir, ".pi"), { recursive: true });
      writeFileSync(join(projectDir, ".pi", "subagents.json"), JSON.stringify({ defaultMaxTurns: 0 }));
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: globalDir });
      sm.load();
      expect(sm.defaultMaxTurns).toBeUndefined();
    });

    it("applies defaultMaxTurns: 50 from disk", () => {
      mkdirSync(join(projectDir, ".pi"), { recursive: true });
      writeFileSync(join(projectDir, ".pi", "subagents.json"), JSON.stringify({ defaultMaxTurns: 50 }));
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: globalDir });
      sm.load();
      expect(sm.defaultMaxTurns).toBe(50);
    });

    it("applies retention windows from disk", () => {
      mkdirSync(join(projectDir, ".pi"), { recursive: true });
      writeFileSync(join(projectDir, ".pi", "subagents.json"), JSON.stringify({ consumedSessionRetentionMinutes: 20, unconsumedSessionRetentionMinutes: 60 }));
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: globalDir });
      sm.load();
      expect(sm.consumedSessionRetentionMinutes).toBe(20);
      expect(sm.unconsumedSessionRetentionMinutes).toBe(60);
    });

    it("applies abortAllOnInterrupt: false from disk", () => {
      mkdirSync(join(projectDir, ".pi"), { recursive: true });
      writeFileSync(join(projectDir, ".pi", "subagents.json"), JSON.stringify({ abortAllOnInterrupt: false }));
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: globalDir });
      sm.load();
      expect(sm.abortAllOnInterrupt).toBe(false);
    });

    it("leaves abortAllOnInterrupt at its default when the file omits it", () => {
      mkdirSync(join(projectDir, ".pi"), { recursive: true });
      writeFileSync(join(projectDir, ".pi", "subagents.json"), JSON.stringify({ graceTurns: 7 }));
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: globalDir });
      sm.load();
      expect(sm.abortAllOnInterrupt).toBe(true);
    });

    it("loads excluded extension package sources", () => {
      mkdirSync(join(projectDir, ".pi"), { recursive: true });
      const settingsPath = join(projectDir, ".pi", "subagents.json");
      writeFileSync(
        settingsPath,
        JSON.stringify({ excludedExtensionPackages: ["npm:@cortexkit/pi-magic-context"] }),
      );
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: globalDir });
      sm.load();
      expect(sm.excludedExtensionPackages).toEqual(["npm:@cortexkit/pi-magic-context"]);

      writeFileSync(settingsPath, JSON.stringify({}));
      sm.load();
      expect(sm.excludedExtensionPackages).toEqual([]);
    });

    it("emits subagents:settings_loaded with merged settings", () => {
      mkdirSync(join(projectDir, ".pi"), { recursive: true });
      writeFileSync(join(projectDir, ".pi", "subagents.json"), JSON.stringify({ graceTurns: 7 }));
      const emit = vi.fn();
      const sm = new SettingsManager({ emit, cwd: projectDir, agentDir: globalDir });
      sm.load();
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith("subagents:settings_loaded", { settings: { graceTurns: 7 } });
    });

    it("returns the loaded settings object", () => {
      mkdirSync(join(projectDir, ".pi"), { recursive: true });
      writeFileSync(join(projectDir, ".pi", "subagents.json"), JSON.stringify({ maxConcurrent: 6 }));
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: globalDir });
      const result = sm.load();
      expect(result).toEqual({ maxConcurrent: 6 });
    });

    it("emits with empty settings when no files exist", () => {
      const emit = vi.fn();
      const sm = new SettingsManager({ emit, cwd: projectDir, agentDir: globalDir });
      sm.load();
      expect(emit).toHaveBeenCalledWith("subagents:settings_loaded", { settings: {} });
    });
  });

  describe("snapshot()", () => {
    it("returns default values before any changes", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      expect(sm.snapshot()).toEqual({ maxConcurrent: 4, defaultMaxTurns: 0, graceTurns: 5, consumedSessionRetentionMinutes: 10, unconsumedSessionRetentionMinutes: 720, abortAllOnInterrupt: true });
    });

    it("reflects mutations: defaultMaxTurns undefined maps to 0 in snapshot", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      sm.defaultMaxTurns = undefined;
      sm.graceTurns = 3;
      sm.maxConcurrent = 8;
      expect(sm.snapshot()).toEqual({ maxConcurrent: 8, defaultMaxTurns: 0, graceTurns: 3, consumedSessionRetentionMinutes: 10, unconsumedSessionRetentionMinutes: 720, abortAllOnInterrupt: true });
    });

    it("reflects a concrete defaultMaxTurns value", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      sm.defaultMaxTurns = 20;
      expect(sm.snapshot()).toEqual({ maxConcurrent: 4, defaultMaxTurns: 20, graceTurns: 5, consumedSessionRetentionMinutes: 10, unconsumedSessionRetentionMinutes: 720, abortAllOnInterrupt: true });
    });

    it("reflects mutated retention windows", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      sm.consumedSessionRetentionMinutes = 30;
      sm.unconsumedSessionRetentionMinutes = 1440;
      expect(sm.snapshot()).toEqual({ maxConcurrent: 4, defaultMaxTurns: 0, graceTurns: 5, consumedSessionRetentionMinutes: 30, unconsumedSessionRetentionMinutes: 1440, abortAllOnInterrupt: true });
    });

    it("reflects a flipped abortAllOnInterrupt", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" });
      sm.toggleAbortAllOnInterrupt();
      expect(sm.snapshot()).toEqual({ maxConcurrent: 4, defaultMaxTurns: 0, graceTurns: 5, consumedSessionRetentionMinutes: 10, unconsumedSessionRetentionMinutes: 720, abortAllOnInterrupt: false });
    });

    it("preserves excluded extension packages loaded from disk", () => {
      const projectDir = mkdtempSync(join(tmpdir(), "pi-sm-excluded-"));
      try {
        mkdirSync(join(projectDir, ".pi"), { recursive: true });
        writeFileSync(
          join(projectDir, ".pi", "subagents.json"),
          JSON.stringify({ excludedExtensionPackages: ["npm:@cortexkit/pi-magic-context"] }),
        );
        const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: "/nonexistent" });
        sm.load();
        expect(sm.snapshot()).toEqual(
          expect.objectContaining({
            excludedExtensionPackages: ["npm:@cortexkit/pi-magic-context"],
          }),
        );
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
      }
    });
  });

  describe("saveAndNotify()", () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "pi-sm-save-"));
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    it("persists snapshot to disk and returns info toast on success", () => {
      const emit = vi.fn();
      const sm = new SettingsManager({ emit, cwd: projectDir, agentDir: "/nonexistent" });
      sm.maxConcurrent = 5;
      const toast = sm.saveAndNotify("Max concurrency set to 5");
      expect(toast).toEqual({ message: "Max concurrency set to 5", level: "info" });
      const written = JSON.parse(readFileSync(join(projectDir, ".pi", "subagents.json"), "utf-8"));
      expect(written).toEqual({ maxConcurrent: 5, defaultMaxTurns: 0, graceTurns: 5, consumedSessionRetentionMinutes: 10, unconsumedSessionRetentionMinutes: 720, abortAllOnInterrupt: true });
    });

    it("emits subagents:settings_changed with persisted:true on success", () => {
      const emit = vi.fn();
      const sm = new SettingsManager({ emit, cwd: projectDir, agentDir: "/nonexistent" });
      sm.graceTurns = 3;
      sm.saveAndNotify("Grace turns set to 3");
      expect(emit).toHaveBeenCalledWith("subagents:settings_changed", {
        settings: { maxConcurrent: 4, defaultMaxTurns: 0, graceTurns: 3, consumedSessionRetentionMinutes: 10, unconsumedSessionRetentionMinutes: 720, abortAllOnInterrupt: true },
        persisted: true,
      });
    });

    it("returns warning toast when persist fails", () => {
      const filePosingAsCwd = join(tmpdir(), `pi-sm-notdir-${Date.now()}`);
      writeFileSync(filePosingAsCwd, "");
      try {
        const sm = new SettingsManager({ emit: vi.fn(), cwd: filePosingAsCwd, agentDir: "/nonexistent" });
        const toast = sm.saveAndNotify("Max concurrency set to 5");
        expect(toast).toEqual({
          message: "Max concurrency set to 5 (session only; failed to persist)",
          level: "warning",
        });
      } finally {
        rmSync(filePosingAsCwd, { force: true });
      }
    });

    it("emits subagents:settings_changed with persisted:false on failure", () => {
      const filePosingAsCwd = join(tmpdir(), `pi-sm-notdir2-${Date.now()}`);
      writeFileSync(filePosingAsCwd, "");
      const emit = vi.fn();
      try {
        const sm = new SettingsManager({ emit, cwd: filePosingAsCwd, agentDir: "/nonexistent" });
        sm.saveAndNotify("something");
        expect(emit).toHaveBeenCalledWith("subagents:settings_changed", {
          settings: { maxConcurrent: 4, defaultMaxTurns: 0, graceTurns: 5, consumedSessionRetentionMinutes: 10, unconsumedSessionRetentionMinutes: 720, abortAllOnInterrupt: true },
          persisted: false,
        });
      } finally {
        rmSync(filePosingAsCwd, { force: true });
      }
    });
  });

  describe("applyMaxConcurrent()", () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "pi-sm-apply-"));
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    it("sets maxConcurrent, calls callback, persists, and returns info toast", () => {
      const onChanged = vi.fn();
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: "/nonexistent", onMaxConcurrentChanged: onChanged });
      const toast = sm.applyMaxConcurrent(8);
      expect(sm.maxConcurrent).toBe(8);
      expect(onChanged).toHaveBeenCalledOnce();
      expect(toast).toEqual({ message: "Max concurrency set to 8", level: "info" });
      const written = JSON.parse(readFileSync(join(projectDir, ".pi", "subagents.json"), "utf-8"));
      expect(written.maxConcurrent).toBe(8);
    });

    it("normalizes 0 to 1 and reports the post-normalization value in the toast", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: "/nonexistent" });
      const toast = sm.applyMaxConcurrent(0);
      expect(sm.maxConcurrent).toBe(1);
      expect(toast.message).toBe("Max concurrency set to 1");
    });

    it("works without a callback — no throw, still persists and returns toast", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: "/nonexistent" });
      expect(() => sm.applyMaxConcurrent(6)).not.toThrow();
      expect(sm.maxConcurrent).toBe(6);
    });
  });

  describe("applyDefaultMaxTurns()", () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "pi-sm-apply-dmt-"));
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    it("sets to unlimited when 0 is passed and reports 'unlimited' in toast", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: "/nonexistent" });
      const toast = sm.applyDefaultMaxTurns(0);
      expect(sm.defaultMaxTurns).toBeUndefined();
      expect(toast).toEqual({ message: "Default max turns set to unlimited", level: "info" });
    });

    it("sets to the given value and includes it in the toast", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: "/nonexistent" });
      const toast = sm.applyDefaultMaxTurns(10);
      expect(sm.defaultMaxTurns).toBe(10);
      expect(toast.message).toBe("Default max turns set to 10");
    });

    it("does not call onMaxConcurrentChanged", () => {
      const onChanged = vi.fn();
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: "/nonexistent", onMaxConcurrentChanged: onChanged });
      sm.applyDefaultMaxTurns(5);
      expect(onChanged).not.toHaveBeenCalled();
    });
  });

  describe("applyConsumedSessionRetentionMinutes() / applyUnconsumedSessionRetentionMinutes()", () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "pi-sm-apply-ret-"));
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    it("sets the consumed window, persists, and reports the post-normalization value", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: "/nonexistent" });
      const toast = sm.applyConsumedSessionRetentionMinutes(30);
      expect(sm.consumedSessionRetentionMinutes).toBe(30);
      expect(toast).toEqual({ message: "Consumed-session retention set to 30 min", level: "info" });
      const written = JSON.parse(readFileSync(join(projectDir, ".pi", "subagents.json"), "utf-8"));
      expect(written.consumedSessionRetentionMinutes).toBe(30);
    });

    it("normalizes 0 to 1 for the consumed window and reports it", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: "/nonexistent" });
      const toast = sm.applyConsumedSessionRetentionMinutes(0);
      expect(sm.consumedSessionRetentionMinutes).toBe(1);
      expect(toast.message).toBe("Consumed-session retention set to 1 min");
    });

    it("sets the unconsumed window, persists, and reports the post-normalization value", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: "/nonexistent" });
      const toast = sm.applyUnconsumedSessionRetentionMinutes(1440);
      expect(sm.unconsumedSessionRetentionMinutes).toBe(1440);
      expect(toast).toEqual({ message: "Unconsumed-session retention set to 1440 min", level: "info" });
      const written = JSON.parse(readFileSync(join(projectDir, ".pi", "subagents.json"), "utf-8"));
      expect(written.unconsumedSessionRetentionMinutes).toBe(1440);
    });

    it("does not call onMaxConcurrentChanged", () => {
      const onChanged = vi.fn();
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: "/nonexistent", onMaxConcurrentChanged: onChanged });
      sm.applyConsumedSessionRetentionMinutes(30);
      sm.applyUnconsumedSessionRetentionMinutes(1440);
      expect(onChanged).not.toHaveBeenCalled();
    });
  });

  describe("applyGraceTurns()", () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "pi-sm-apply-gt-"));
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    it("sets graceTurns and reports the post-normalization value in toast", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: "/nonexistent" });
      const toast = sm.applyGraceTurns(3);
      expect(sm.graceTurns).toBe(3);
      expect(toast).toEqual({ message: "Grace turns set to 3", level: "info" });
    });

    it("normalizes 0 to 1 and reports the post-normalization value in toast", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: "/nonexistent" });
      const toast = sm.applyGraceTurns(0);
      expect(sm.graceTurns).toBe(1);
      expect(toast.message).toBe("Grace turns set to 1");
    });

    it("does not call onMaxConcurrentChanged", () => {
      const onChanged = vi.fn();
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: "/nonexistent", onMaxConcurrentChanged: onChanged });
      sm.applyGraceTurns(5);
      expect(onChanged).not.toHaveBeenCalled();
    });
  });

  describe("toggleAbortAllOnInterrupt()", () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "pi-sm-toggle-"));
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    it("flips the policy off, persists it, and reports the new state", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: "/nonexistent" });
      const toast = sm.toggleAbortAllOnInterrupt();
      expect(sm.abortAllOnInterrupt).toBe(false);
      expect(toast).toEqual({ message: "Abort all subagents on ESC: off", level: "info" });
      const written = JSON.parse(readFileSync(join(projectDir, ".pi", "subagents.json"), "utf-8"));
      expect(written.abortAllOnInterrupt).toBe(false);
    });

    it("flips the policy back on", () => {
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: "/nonexistent" });
      sm.toggleAbortAllOnInterrupt();
      const toast = sm.toggleAbortAllOnInterrupt();
      expect(sm.abortAllOnInterrupt).toBe(true);
      expect(toast).toEqual({ message: "Abort all subagents on ESC: on", level: "info" });
    });

    it("emits subagents:settings_changed carrying the flipped value", () => {
      const emit = vi.fn();
      const sm = new SettingsManager({ emit, cwd: projectDir, agentDir: "/nonexistent" });
      sm.toggleAbortAllOnInterrupt();
      expect(emit).toHaveBeenCalledWith("subagents:settings_changed", {
        settings: { maxConcurrent: 4, defaultMaxTurns: 0, graceTurns: 5, consumedSessionRetentionMinutes: 10, unconsumedSessionRetentionMinutes: 720, abortAllOnInterrupt: false },
        persisted: true,
      });
    });

    it("keeps the in-memory flip and warns when the write fails", () => {
      const filePosingAsCwd = join(tmpdir(), `pi-sm-notdir-toggle-${Date.now()}`);
      writeFileSync(filePosingAsCwd, "");
      try {
        const sm = new SettingsManager({ emit: vi.fn(), cwd: filePosingAsCwd, agentDir: "/nonexistent" });
        const toast = sm.toggleAbortAllOnInterrupt();
        expect(sm.abortAllOnInterrupt).toBe(false);
        expect(toast).toEqual({
          message: "Abort all subagents on ESC: off (session only; failed to persist)",
          level: "warning",
        });
      } finally {
        rmSync(filePosingAsCwd, { force: true });
      }
    });

    it("does not call onMaxConcurrentChanged", () => {
      const onChanged = vi.fn();
      const sm = new SettingsManager({ emit: vi.fn(), cwd: projectDir, agentDir: "/nonexistent", onMaxConcurrentChanged: onChanged });
      sm.toggleAbortAllOnInterrupt();
      expect(onChanged).not.toHaveBeenCalled();
    });
  });

  describe("constructor onMaxConcurrentChanged callback", () => {
    it("constructs without callback without throwing", () => {
      expect(() => new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent" })).not.toThrow();
    });

    it("constructs with callback without throwing", () => {
      expect(
        () => new SettingsManager({ emit: vi.fn(), cwd: "/tmp", agentDir: "/nonexistent", onMaxConcurrentChanged: vi.fn() }),
      ).not.toThrow();
    });
  });
});
