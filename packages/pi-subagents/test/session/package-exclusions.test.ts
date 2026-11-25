import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  createExcludedPackagesStorage,
  withPackageExtensionsDisabled,
} from "#src/session/package-exclusions";

const MAGIC = "npm:@cortexkit/pi-magic-context";

describe("withPackageExtensionsDisabled", () => {
  it("promotes a matched string entry to the object form with extensions and skills disabled", () => {
    const result = withPackageExtensionsDisabled(
      { packages: [MAGIC, "npm:keep-me"] },
      new Set([MAGIC]),
    );
    expect(result.packages).toEqual([{ source: MAGIC, extensions: [], skills: [] }, "npm:keep-me"]);
  });

  it("empties a matched object entry's skills while preserving its prompts", () => {
    const result = withPackageExtensionsDisabled(
      { packages: [{ source: MAGIC, skills: ["skills/**"], prompts: ["prompts/**"] }] },
      new Set([MAGIC]),
    );
    expect(result.packages).toEqual([
      { source: MAGIC, skills: [], prompts: ["prompts/**"], extensions: [] },
    ]);
  });

  it("replaces existing extensions and skills filters on a matched entry", () => {
    const result = withPackageExtensionsDisabled(
      { packages: [{ source: MAGIC, extensions: ["index.ts"], skills: ["skills/**"] }] },
      new Set([MAGIC]),
    );
    expect(result.packages).toEqual([{ source: MAGIC, extensions: [], skills: [] }]);
  });

  it("preserves autoload: false, where empty filters add no extensions or skills", () => {
    const result = withPackageExtensionsDisabled(
      { packages: [{ source: MAGIC, autoload: false, skills: ["skills/**"] }] },
      new Set([MAGIC]),
    );
    expect(result.packages).toEqual([
      { source: MAGIC, autoload: false, skills: [], extensions: [] },
    ]);
  });

  it("returns non-matched entries by identity", () => {
    const untouched = { source: "npm:keep-me", skills: ["skills/**"] };
    const result = withPackageExtensionsDisabled(
      { packages: ["npm:other", untouched] },
      new Set([MAGIC]),
    );
    expect(result.packages).toEqual(["npm:other", untouched]);
    expect(result.packages?.[1]).toBe(untouched);
  });

  it("does not mutate the input settings or its package entries", () => {
    const entry = { source: MAGIC, skills: ["skills/**"] };
    const settings = { packages: [entry] };
    withPackageExtensionsDisabled(settings, new Set([MAGIC]));
    expect(settings).toEqual({ packages: [{ source: MAGIC, skills: ["skills/**"] }] });
    expect(entry).toEqual({ source: MAGIC, skills: ["skills/**"] });
  });

  it("returns the settings unchanged when nothing is excluded", () => {
    const settings = { packages: [MAGIC] };
    expect(withPackageExtensionsDisabled(settings, new Set())).toBe(settings);
  });

  it("returns the settings unchanged when there are no packages", () => {
    const settings = { theme: "dark" };
    expect(withPackageExtensionsDisabled(settings, new Set([MAGIC]))).toBe(settings);
  });

  it("leaves top-level non-package settings intact", () => {
    const result = withPackageExtensionsDisabled(
      { theme: "dark", packages: [MAGIC] },
      new Set([MAGIC]),
    );
    expect(result.theme).toBe("dark");
  });
});

describe("createExcludedPackagesStorage", () => {
  /** A stand-in for the parent's real, file-backed SettingsManager. */
  function createParent() {
    return {
      getGlobalSettings: vi.fn(() => ({ packages: [MAGIC, "npm:keep-me"], theme: "dark" })),
      getProjectSettings: vi.fn(() => ({ packages: [{ source: MAGIC, skills: ["skills/**"] }] })),
    };
  }

  it("builds a real SettingsManager whose packages disable the excluded extensions and skills", () => {
    const parent = createParent();
    const child = SettingsManager.fromStorage(
      createExcludedPackagesStorage(parent, new Set([MAGIC])),
    );

    expect(child.getGlobalSettings().packages).toEqual([
      { source: MAGIC, extensions: [], skills: [] },
      "npm:keep-me",
    ]);
    expect(child.getProjectSettings().packages).toEqual([
      { source: MAGIC, skills: [], extensions: [] },
    ]);
  });

  it("leaves the parent's own settings untouched", () => {
    const parent = createParent();
    SettingsManager.fromStorage(createExcludedPackagesStorage(parent, new Set([MAGIC])));

    expect(parent.getGlobalSettings().packages).toEqual([MAGIC, "npm:keep-me"]);
    expect(parent.getProjectSettings().packages).toEqual([
      { source: MAGIC, skills: ["skills/**"] },
    ]);
  });

  it("omits project settings when the project is untrusted", () => {
    const parent = createParent();
    const child = SettingsManager.fromStorage(
      createExcludedPackagesStorage(parent, new Set([MAGIC])),
      { projectTrusted: false },
    );

    expect(child.getProjectSettings()).toEqual({});
    expect(child.getGlobalSettings().packages).toEqual([
      { source: MAGIC, extensions: [], skills: [] },
      "npm:keep-me",
    ]);
  });

  it("discards writes so a synthesized filter never reaches the parent", () => {
    const parent = createParent();
    const storage = createExcludedPackagesStorage(parent, new Set([MAGIC]));

    storage.withLock("global", () => JSON.stringify({ packages: ["npm:injected"] }));

    expect(parent.getGlobalSettings().packages).toEqual([MAGIC, "npm:keep-me"]);
    const child = SettingsManager.fromStorage(storage);
    expect(child.getGlobalSettings().packages).toEqual([
      { source: MAGIC, extensions: [], skills: [] },
      "npm:keep-me",
    ]);
  });

  it("reads through to the parent on every load, not a construction-time snapshot", async () => {
    const parent = createParent();
    const child = SettingsManager.fromStorage(
      createExcludedPackagesStorage(parent, new Set([MAGIC])),
    );

    parent.getGlobalSettings.mockReturnValue({ packages: ["npm:added-later"], theme: "dark" });
    await child.reload();

    expect(child.getGlobalSettings().packages).toEqual(["npm:added-later"]);
  });
});
