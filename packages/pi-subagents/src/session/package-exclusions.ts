/**
 * package-exclusions.ts — build a child-local view of Pi's package settings
 * that disables selected packages' extensions (issue #696).
 *
 * Filtering at resolution time means the excluded package's extension module
 * is never imported and its factory never runs — a prevent-load seam, not
 * deny-at-use. A bare string entry stops there. An object entry is a
 * blocklist: it equals the same entry in `settings.json` with `!` prefixed to
 * each resource pattern, since `settings.json` filters say what loads while
 * this list says what is excluded. `extensions` is always emptied.
 */

import type { PackageSource, SettingsManager } from "@earendil-works/pi-coding-agent";

/** The object half of Pi's `PackageSource` union, keyed by `source`. */
type PackageSourceObject = Extract<PackageSource, { source: string }>;

/** Resource filters from an object-form exclusion entry. Strings contribute `{}`. */
export type ExcludedPackageFilters = Omit<PackageSourceObject, "source">;

/** The legacy `ReadonlySet<string>` shape still means "extensions only" per source. */
export type ExcludedPackagesView = ReadonlySet<string> | ReadonlyMap<string, ExcludedPackageFilters>;

/** Pi does not export `Settings` from its package root; derive it from the accessor. */
type PiSettings = ReturnType<SettingsManager["getGlobalSettings"]>;

/** Pi does not export `SettingsStorage` either; derive it from the public factory. */
type PiSettingsStorage = Parameters<typeof SettingsManager.fromStorage>[0];

/** The parent-settings reads a child view needs — narrower than `SettingsManager`. */
export interface ParentSettingsView {
  getGlobalSettings(): PiSettings;
  getProjectSettings(): PiSettings;
}

function asFiltersMap(excluded: ExcludedPackagesView): ReadonlyMap<string, ExcludedPackageFilters> {
  if (excluded instanceof Map) return excluded;
  return new Map(Array.from(excluded, (source) => [source, {} as ExcludedPackageFilters]));
}

/**
 * Map each `excludedExtensionPackages` entry to the child filters it means.
 * Strings stay minimal. An object's filters are its `settings.json` meaning
 * inverted — a bare object lists nothing, so it blocks everything: `**` per
 * resource type, which the synthesis turns into `!**`.
 */
export function excludedFiltersBySource(
  entries: readonly PackageSource[],
): ReadonlyMap<string, ExcludedPackageFilters> {
  const excluded = new Map<string, ExcludedPackageFilters>();
  for (const entry of entries) {
    if (typeof entry === "string") {
      if (!excluded.has(entry)) excluded.set(entry, {});
    } else if (entry.source.trim()) {
      const { source, extensions: _ignored, ...filters } = entry;
      const hasResourceFilter = ["skills", "prompts", "themes"].some((k) => k in filters);
      excluded.set(
        source.trim(),
        hasResourceFilter ? filters : { skills: ["**"], prompts: ["**"], themes: ["**"] },
      );
    }
  }
  return excluded;
}

/**
 * A storage backend that serves the parent's settings with the excluded
 * packages' extensions disabled, for `SettingsManager.fromStorage`.
 *
 * Reads pass through to `parent` on every load, so a `reload()` reflects the
 * parent's current values rather than a construction-time snapshot.
 *
 * Writes are discarded deliberately. `withLock` persists whatever its callback
 * returns, and the callback here is handed synthesized `extensions: []` entries;
 * forwarding that write would disable those packages in the user's real
 * settings file, for the parent and every future session.
 */
export function createExcludedPackagesStorage(
  parent: ParentSettingsView,
  excluded: ExcludedPackagesView,
): PiSettingsStorage {
  const filtersBySource = asFiltersMap(excluded);
  return {
    withLock(scope, fn) {
      const settings = scope === "global" ? parent.getGlobalSettings() : parent.getProjectSettings();
      fn(JSON.stringify(withPackageExtensionsDisabled(settings, filtersBySource)));
    },
  };
}

/** Non-matched entries are returned by identity and the input is never mutated. */
export function withPackageExtensionsDisabled(
  settings: PiSettings,
  excluded: ExcludedPackagesView,
): PiSettings {
  const filtersBySource = asFiltersMap(excluded);
  if (!settings.packages || filtersBySource.size === 0) return settings;
  return {
    ...settings,
    packages: settings.packages.map((pkg) => disableExtensionsIfExcluded(pkg, filtersBySource)),
  };
}

function disableExtensionsIfExcluded(
  pkg: PackageSource,
  excluded: ReadonlyMap<string, ExcludedPackageFilters>,
): PackageSource {
  const source = typeof pkg === "string" ? pkg : pkg.source;
  const filters = excluded.get(source);
  if (!filters) return pkg;
  const base = typeof pkg === "string" ? { source } : pkg;
  const out: Record<string, unknown> = { ...base, extensions: [] };
  for (const [key, patterns] of Object.entries(filters)) {
    if (key === "extensions") continue; // forced above
    if (Array.isArray(patterns)) {
      // Invert the blocklist: a bare pattern becomes a `!` exclusion in the
      // child. An empty list blocks nothing, so the base view stands.
      if (patterns.length === 0) continue;
      out[key] = patterns.map((p) => (typeof p === "string" && /^[!+-]/.test(p) ? p : `!${p}`));
    } else {
      out[key] = patterns; // autoload and any other passthrough field
    }
  }
  return out as PackageSource;
}
