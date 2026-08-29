/**
 * Provider inheritance — replay a parent session's runtime provider
 * registrations onto a child session's model runtime.
 *
 * Pi builds a fresh ModelRuntime for every session that is not handed one, and
 * runtime registrations (pi.registerProvider) live on that instance rather than
 * in models.json or auth.json. A child therefore starts with none of them and
 * cannot resolve the parent's provider, which surfaces as
 * "No API key found for <provider>" (Refs #812).
 *
 * The collaborators are narrow structural contracts rather than the SDK's
 * ModelRegistry: the concrete class carries a private field, which would force
 * test doubles to cast or replicate internals. Provider and config values are
 * pass-through only — this module never inspects them — so they stay generic,
 * which also avoids naming SDK types the package entry does not export.
 */

/** Enumerates the providers registered on a session at runtime. */
export interface RegisteredProviderSource<TNative, TConfig> {
  getRegisteredProviderIds(): readonly string[];
  getRegisteredNativeProvider(id: string): TNative | undefined;
  getRegisteredProviderConfig(id: string): TConfig | undefined;
}

/**
 * Accepts provider registrations on behalf of a session.
 *
 * The two forms are separate methods rather than the SDK's single overloaded
 * `registerProvider`, so a plain `vi.fn()` can stand in for each without a cast.
 */
export interface ProviderRegistrar<TNative, TConfig> {
  registerNative(provider: TNative): void;
  registerConfigured(id: string, config: TConfig): void;
}

/**
 * Copy every runtime-registered provider from `source` onto `target`.
 *
 * Pi keeps native and configured registrations in disjoint maps — registering
 * one form deletes the id from the other — so each id resolves to exactly one
 * form. An id that resolves to neither is skipped rather than registered empty.
 */
export function inheritRegisteredProviders<TNative, TConfig>(
  source: RegisteredProviderSource<TNative, TConfig>,
  target: ProviderRegistrar<TNative, TConfig>,
): void {
  for (const id of source.getRegisteredProviderIds()) {
    const native = source.getRegisteredNativeProvider(id);
    if (native !== undefined) {
      target.registerNative(native);
      continue;
    }
    const config = source.getRegisteredProviderConfig(id);
    if (config !== undefined) target.registerConfigured(id, config);
  }
}
