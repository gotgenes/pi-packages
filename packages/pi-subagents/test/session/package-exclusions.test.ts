import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import * as pkgExclusions from "#src/session/package-exclusions";
const { createExcludedPackagesStorage, withPackageExtensionsDisabled } = pkgExclusions;

const MAGIC = "npm:@cortexkit/pi-magic-context";

describe("withPackageExtensionsDisabled", () => {
  it("promotes a matched string entry to the object form with extensions disabled", () => {
    const result = withPackageExtensionsDisabled(
      { packages: [MAGIC, "npm:keep-me"] },
      new Set([MAGIC]),
    );
    expect(result.packages).toEqual([{ source: MAGIC, extensions: [] }, "npm:keep-me"]);
  });

  it("preserves a matched object entry's other resource filters", () => {
    const result = withPackageExtensionsDisabled(
      { packages: [{ source: MAGIC, skills: ["skills/**"], prompts: ["prompts/**"] }] },
      new Set([MAGIC]),
    );
    expect(result.packages).toEqual([
      { source: MAGIC, skills: ["skills/**"], prompts: ["prompts/**"], extensions: [] },
    ]);
  });

  it("replaces an existing extensions filter on a matched entry", () => {
    const result = withPackageExtensionsDisabled(
      { packages: [{ source: MAGIC, extensions: ["index.ts"] }] },
      new Set([MAGIC]),
    );
    expect(result.packages).toEqual([{ source: MAGIC, extensions: [] }]);
  });

  it("preserves autoload: false, where an empty filter adds no extensions", () => {
    const result = withPackageExtensionsDisabled(
      { packages: [{ source: MAGIC, autoload: false, skills: ["skills/**"] }] },
      new Set([MAGIC]),
    );
    expect(result.packages).toEqual([
      { source: MAGIC, autoload: false, skills: ["skills/**"], extensions: [] },
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

  it("builds a real SettingsManager whose packages disable the excluded extensions", () => {
    const parent = createParent();
    const child = SettingsManager.fromStorage(
      createExcludedPackagesStorage(parent, new Set([MAGIC])),
    );

    expect(child.getGlobalSettings().packages).toEqual([
      { source: MAGIC, extensions: [] },
      "npm:keep-me",
    ]);
    expect(child.getProjectSettings().packages).toEqual([
      { source: MAGIC, skills: ["skills/**"], extensions: [] },
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
      { source: MAGIC, extensions: [] },
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
      { source: MAGIC, extensions: [] },
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

describe("object-entry blocklists", () => {
  it("prefixes bare patterns with !, preserving the entry's other resources", () => {
    const result = withPackageExtensionsDisabled(
      { packages: [{ source: MAGIC, prompts: ["prompts/**"] }] },
      new Map([[MAGIC, { skills: ["myskill/**"] }]]),
    );
    expect(result.packages).toEqual([
      { source: MAGIC, prompts: ["prompts/**"], skills: ["!myskill/**"], extensions: [] },
    ]);
  });

  it("treats an empty list as blocking nothing: the base view stands", () => {
    const result = withPackageExtensionsDisabled(
      { packages: [{ source: MAGIC, skills: ["skills/**"] }] },
      new Map([[MAGIC, { skills: [] }]]),
    );
    expect(result.packages).toEqual([{ source: MAGIC, skills: ["skills/**"], extensions: [] }]);
  });

  it("passes patterns that already carry Pi's markers through unchanged", () => {
    const result = withPackageExtensionsDisabled(
      { packages: [MAGIC] },
      new Map([[MAGIC, { skills: ["!already/**", "+exact.md"] }]]),
    );
    expect(result.packages).toEqual([
      { source: MAGIC, skills: ["!already/**", "+exact.md"], extensions: [] },
    ]);
  });

  it("always empties extensions, whatever the entry says", () => {
    const result = withPackageExtensionsDisabled(
      { packages: [MAGIC] },
      new Map([[MAGIC, { extensions: ["index.ts"] }]]),
    );
    expect(result.packages).toEqual([{ source: MAGIC, extensions: [] }]);
  });

  it("synthesizes the inverted filters through the storage backend", () => {
    const parent = {
      getGlobalSettings: vi.fn(() => ({ packages: [MAGIC] })),
      getProjectSettings: vi.fn(() => ({ packages: [] })),
    };
    const child = SettingsManager.fromStorage(
      createExcludedPackagesStorage(parent, new Map([[MAGIC, { skills: ["**"] }]])),
    );
    expect(child.getGlobalSettings().packages).toEqual([
      { source: MAGIC, skills: ["!**"], extensions: [] },
    ]);
  });
});

describe("entry normalization", () => {
  it("blocks every resource for a bare object: nothing listed means everything", () => {
    const { excludedFiltersBySource } = pkgExclusions;
    const map = excludedFiltersBySource([{ source: MAGIC }, "npm:keep-me"]);
    expect(map.get(MAGIC)).toEqual({ skills: ["**"], prompts: ["**"], themes: ["**"] });
    expect(map.get("npm:keep-me")).toEqual({});
  });

  it("keeps an object that lists blocks as exactly those blocks", () => {
    const { excludedFiltersBySource } = pkgExclusions;
    const map = excludedFiltersBySource([{ source: MAGIC, skills: ["**"] }]);
    expect(map.get(MAGIC)).toEqual({ skills: ["**"] });
  });
});
