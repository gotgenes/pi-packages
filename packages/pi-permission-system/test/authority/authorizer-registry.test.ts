import { describe, expect, test } from "vitest";

import type { Authorizer } from "#src/authority/authorizer";
import {
  AuthorizerAlreadyRegisteredError,
  AuthorizerRegistry,
  isAuthorizerAlreadyRegisteredError,
} from "#src/authority/authorizer-registry";

const noopLink: Authorizer["authorize"] = () =>
  Promise.resolve({ kind: "defer" });

describe("AuthorizerRegistry", () => {
  describe("register", () => {
    test("stores a link so get() returns it", () => {
      const registry = new AuthorizerRegistry();
      registry.register("model-judge", noopLink);
      expect(registry.get("model-judge")).toBe(noopLink);
    });

    test("returns a disposer that removes the link", () => {
      const registry = new AuthorizerRegistry();
      const dispose = registry.register("model-judge", noopLink);
      dispose();
      expect(registry.get("model-judge")).toBeUndefined();
    });

    test("throws when a link is already registered for the same name", () => {
      const registry = new AuthorizerRegistry();
      registry.register("model-judge", noopLink);
      expect(() =>
        registry.register("model-judge", () =>
          Promise.resolve({ kind: "defer" }),
        ),
      ).toThrow(AuthorizerAlreadyRegisteredError);
      try {
        registry.register("model-judge", () =>
          Promise.resolve({ kind: "defer" }),
        );
      } catch (error) {
        expect(error).toBeInstanceOf(AuthorizerAlreadyRegisteredError);
        if (error instanceof AuthorizerAlreadyRegisteredError) {
          expect(error.code).toBe("AUTHORIZER_ALREADY_REGISTERED");
          expect(error.linkName).toBe("model-judge");
        }
      }
    });

    test("allows registering different names independently", () => {
      const registry = new AuthorizerRegistry();
      const linkA: Authorizer["authorize"] = () =>
        Promise.resolve({ kind: "allow" });
      const linkB: Authorizer["authorize"] = () =>
        Promise.resolve({ kind: "deny" });
      registry.register("judge-a", linkA);
      registry.register("judge-b", linkB);
      expect(registry.get("judge-a")).toBe(linkA);
      expect(registry.get("judge-b")).toBe(linkB);
    });
  });

  describe("disposer identity guard", () => {
    test("stale disposer does not evict a later registration", () => {
      const registry = new AuthorizerRegistry();
      const first: Authorizer["authorize"] = () =>
        Promise.resolve({ kind: "defer" });
      const second: Authorizer["authorize"] = () =>
        Promise.resolve({ kind: "allow" });

      const disposeFirst = registry.register("model-judge", first);
      disposeFirst(); // removes first

      registry.register("model-judge", second); // second registration is valid
      disposeFirst(); // stale disposer again — must not remove second

      expect(registry.get("model-judge")).toBe(second);
    });
  });

  describe("get", () => {
    test("returns undefined for an unregistered name", () => {
      const registry = new AuthorizerRegistry();
      expect(registry.get("unknown")).toBeUndefined();
    });
  });
});

describe("isAuthorizerAlreadyRegisteredError", () => {
  test("returns true for the registry's duplicate-registration error", () => {
    const registry = new AuthorizerRegistry();
    registry.register("model-judge", noopLink);
    try {
      registry.register("model-judge", noopLink);
    } catch (error) {
      expect(isAuthorizerAlreadyRegisteredError(error)).toBe(true);
      return;
    }
    throw new Error("expected duplicate registration to throw");
  });

  test("returns true for a structural error shape from another module instance", () => {
    const foreignError = {
      name: "AuthorizerAlreadyRegisteredError",
      code: "AUTHORIZER_ALREADY_REGISTERED",
      linkName: "model-judge",
    };
    expect(isAuthorizerAlreadyRegisteredError(foreignError)).toBe(true);
  });

  test("returns false for unrelated errors", () => {
    expect(isAuthorizerAlreadyRegisteredError(new Error("nope"))).toBe(false);
    expect(
      isAuthorizerAlreadyRegisteredError({
        name: "AuthorizerAlreadyRegisteredError",
        code: "AUTHORIZER_ALREADY_REGISTERED",
      }),
    ).toBe(false);
  });
});
