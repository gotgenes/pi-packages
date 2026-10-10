import { describe, expect, it } from "vitest";
import { SessionYoloOverride } from "#src/session/yolo-override";

describe("SessionYoloOverride", () => {
  it("follows the config until a command overrides it", () => {
    const override = new SessionYoloOverride();
    expect(override.resolve(false)).toBe(false);
    expect(override.resolve(true)).toBe(true);

    override.set(true);
    expect(override.resolve(false)).toBe(true);
  });

  it("toggles from the effective state, not from the config", () => {
    const override = new SessionYoloOverride();

    // Config says on, so the first toggle turns it off for the session even
    // though nothing in the config changed.
    expect(override.toggle(true)).toBe(false);
    expect(override.resolve(true)).toBe(false);
    expect(override.toggle(true)).toBe(true);
  });

  it("hands the session back to the config when the override is cleared", () => {
    const override = new SessionYoloOverride();

    override.set(true);
    override.set(null);
    expect(override.resolve(false)).toBe(false);
    expect(override.resolve(true)).toBe(true);
  });
});
