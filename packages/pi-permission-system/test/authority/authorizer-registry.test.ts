import { describe, expect, test, vi } from "vitest";

import type { Authorizer } from "#src/authority/authorizer";
import {
  type AuthorizerRegistrar,
  AuthorizerRegistry,
  ObservedAuthorizerRegistrar,
} from "#src/authority/authorizer-registry";
import { makeAuthorizerLog } from "#test/helpers/authorizer-log-fixtures";

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
      ).toThrow("model-judge");
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

describe("ObservedAuthorizerRegistrar", () => {
  function makeObserved(adjudicatesLocally: boolean) {
    const registry = new AuthorizerRegistry();
    const logger = makeAuthorizerLog();
    const registrar: AuthorizerRegistrar = new ObservedAuthorizerRegistrar(
      registry,
      { adjudicatesLocally: () => adjudicatesLocally },
      logger,
    );
    return { registrar, registry, logger };
  }

  test("accepts a link on a relaying node, where no chain will consult it", () => {
    const { registrar, registry } = makeObserved(false);
    registrar.register("model-judge", noopLink);
    expect(registry.get("model-judge")).toBe(noopLink);
  });

  test("records the vacancy so a link registered where no chain runs is never silent", () => {
    const { registrar, logger } = makeObserved(false);
    registrar.register("model-judge", noopLink);
    expect(logger.review).toHaveBeenCalledWith("authorizer_link_vacant", {
      name: "model-judge",
    });
  });

  test("records nothing on a node that adjudicates its own asks", () => {
    const { registrar, registry, logger } = makeObserved(true);
    registrar.register("model-judge", noopLink);
    expect(registry.get("model-judge")).toBe(noopLink);
    expect(logger.review).not.toHaveBeenCalled();
  });

  test("returns the underlying disposer", () => {
    const { registrar, registry } = makeObserved(false);
    const dispose = registrar.register("model-judge", noopLink);
    dispose();
    expect(registry.get("model-judge")).toBeUndefined();
  });

  test("lets a duplicate registration throw, and records no vacancy for it", () => {
    const { registrar, logger } = makeObserved(false);
    registrar.register("model-judge", noopLink);
    logger.review.mockClear();

    expect(() => registrar.register("model-judge", noopLink)).toThrow(
      "model-judge",
    );
    expect(logger.review).not.toHaveBeenCalled();
  });

  test("reads the node's role per registration, not once at construction", () => {
    const registry = new AuthorizerRegistry();
    const logger = makeAuthorizerLog();
    const adjudicatesLocally = vi.fn<() => boolean>().mockReturnValue(true);
    const registrar = new ObservedAuthorizerRegistrar(
      registry,
      { adjudicatesLocally },
      logger,
    );

    registrar.register("first", noopLink);
    adjudicatesLocally.mockReturnValue(false);
    registrar.register("second", noopLink);

    expect(logger.review).toHaveBeenCalledExactlyOnceWith(
      "authorizer_link_vacant",
      { name: "second" },
    );
  });
});
