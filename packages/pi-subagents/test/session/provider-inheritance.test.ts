import { describe, expect, it, vi } from "vitest";
import {
  inheritRegisteredProviders,
  type ProviderRegistrar,
  type RegisteredProviderSource,
} from "#src/session/provider-inheritance";

interface Native {
  id: string;
}
interface Config {
  baseUrl: string;
}

/** A parent registry holding the two disjoint runtime-registration maps Pi keeps. */
function createSource(registrations: {
  native?: Record<string, Native>;
  configured?: Record<string, Config>;
  ids?: string[];
}): RegisteredProviderSource<Native, Config> {
  const native = registrations.native ?? {};
  const configured = registrations.configured ?? {};
  const ids = registrations.ids ?? [...Object.keys(native), ...Object.keys(configured)];
  return {
    getRegisteredProviderIds: () => ids,
    getRegisteredNativeProvider: (id) => native[id],
    getRegisteredProviderConfig: (id) => configured[id],
  };
}

function createRegistrar() {
  return {
    registerNative: vi.fn<(provider: Native) => void>(),
    registerConfigured: vi.fn<(id: string, config: Config) => void>(),
  } satisfies ProviderRegistrar<Native, Config>;
}

describe("inheritRegisteredProviders", () => {
  it("replays a config-registered provider with its id and config", () => {
    const config = { baseUrl: "http://127.0.0.1:9/v1" };
    const target = createRegistrar();

    inheritRegisteredProviders(createSource({ configured: { "claude-bridge": config } }), target);

    expect(target.registerConfigured).toHaveBeenCalledWith("claude-bridge", config);
    expect(target.registerNative).not.toHaveBeenCalled();
  });

  it("replays a natively registered provider as the provider object", () => {
    const provider = { id: "native-bridge" };
    const target = createRegistrar();

    inheritRegisteredProviders(createSource({ native: { "native-bridge": provider } }), target);

    expect(target.registerNative).toHaveBeenCalledWith(provider);
    expect(target.registerConfigured).not.toHaveBeenCalled();
  });

  it("prefers the native form when an id somehow resolves to both", () => {
    const provider = { id: "both" };
    const target = createRegistrar();

    inheritRegisteredProviders(
      createSource({
        native: { both: provider },
        configured: { both: { baseUrl: "http://unused" } },
        ids: ["both"],
      }),
      target,
    );

    expect(target.registerNative).toHaveBeenCalledWith(provider);
    expect(target.registerConfigured).not.toHaveBeenCalled();
  });

  it("skips an id that resolves to neither form rather than registering it empty", () => {
    const target = createRegistrar();

    inheritRegisteredProviders(createSource({ ids: ["vanished"] }), target);

    expect(target.registerNative).not.toHaveBeenCalled();
    expect(target.registerConfigured).not.toHaveBeenCalled();
  });

  it("registers nothing when the parent has no runtime registrations", () => {
    const target = createRegistrar();

    inheritRegisteredProviders(createSource({}), target);

    expect(target.registerNative).not.toHaveBeenCalled();
    expect(target.registerConfigured).not.toHaveBeenCalled();
  });

  it("replays every registration, in the order the source enumerates them", () => {
    const first = { id: "first" };
    const third = { id: "third" };
    const secondConfig = { baseUrl: "http://second" };
    const calls: string[] = [];
    const target: ProviderRegistrar<Native, Config> = {
      registerNative: (provider) => calls.push(`native:${provider.id}`),
      registerConfigured: (id) => calls.push(`configured:${id}`),
    };

    inheritRegisteredProviders(
      createSource({
        native: { first, third },
        configured: { second: secondConfig },
        ids: ["first", "second", "third"],
      }),
      target,
    );

    expect(calls).toEqual(["native:first", "configured:second", "native:third"]);
  });
});
