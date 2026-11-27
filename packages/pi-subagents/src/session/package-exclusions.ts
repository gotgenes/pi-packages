/**
 * package-exclusions.ts — build a child-local view of Pi's package settings
 * that disables selected packages' extensions (issue #696).
 *
 * Pi resolves a child session's resources from `Settings.packages`. An entry in
 * object form with `extensions: []` loads none of that package's extensions in
 * both of Pi's filter modes — the default mode treats the empty array as an
 * explicit disable, and `autoload: false` delta mode starts empty and only adds
 * explicitly listed patterns. `skills: []` disables the package's skills the
 * same way: a child that cannot run a package's extensions should not be
 * offered its skills either, since the skills instruct the model in the use of
 * those extensions. Filtering here, at resolution time, means the excluded
 * package's extension module is never imported and its factory never runs,
 * which is what makes this a prevent-load seam rather than a deny-at-use one.
 * The package's prompts and themes are untouched.
 */

import type { PackageSource, SettingsManager } from "@earendil-works/pi-coding-agent";

/** Pi does not export `Settings` from its package root; derive it from the accessor. */
type PiSettings = ReturnType<SettingsManager["getGlobalSettings"]>;

/** Pi does not export `SettingsStorage` either; derive it from the public factory. */
type PiSettingsStorage = Parameters<typeof SettingsManager.fromStorage>[0];

/** The parent-settings reads a child view needs — narrower than `SettingsManager`. */
export interface ParentSettingsView {
  getGlobalSettings(): PiSettings;
  getProjectSettings(): PiSettings;
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
  excluded: ReadonlySet<string>,
): PiSettingsStorage {
  return {
    withLock(scope, fn) {
      const settings = scope === "global" ? parent.getGlobalSettings() : parent.getProjectSettings();
      fn(JSON.stringify(withPackageExtensionsDisabled(settings, excluded)));
    },
  };
}

/**
 * Return `settings` with every excluded package's `extensions` and `skills`
 * filters emptied. Non-matched entries are returned by identity and the input is
 * never mutated.
 */
export function withPackageExtensionsDisabled(
  settings: PiSettings,
  excluded: ReadonlySet<string>,
): PiSettings {
  if (!settings.packages || excluded.size === 0) return settings;
  return {
    ...settings,
    packages: settings.packages.map((pkg) => disableExtensionsIfExcluded(pkg, excluded)),
  };
}

function disableExtensionsIfExcluded(
  pkg: PackageSource,
  excluded: ReadonlySet<string>,
): PackageSource {
  const source = typeof pkg === "string" ? pkg : pkg.source;
  if (!excluded.has(source)) return pkg;
  return typeof pkg === "string" ? { source, extensions: [], skills: [] } : { ...pkg, extensions: [], skills: [] };
}
