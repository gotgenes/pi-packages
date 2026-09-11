import { describe, expect, it } from "vitest";

import type { GateResult } from "#src/handlers/gates/descriptor";
import {
  isUnconditionalDeny,
  orderDenyFirst,
  preResolvedCheckOf,
} from "#src/handlers/gates/descriptor";
import { DECIDED_BY_HUMAN } from "#test/helpers/decision-fixtures";

import { makeDescriptor } from "#test/helpers/gate-fixtures";
import { makeCheckResult } from "#test/helpers/handler-fixtures";

describe("preResolvedCheckOf", () => {
  it("returns the descriptor's own preCheck when it carries one", () => {
    const preCheck = makeCheckResult({ state: "deny", matchedPattern: "rm *" });

    expect(preResolvedCheckOf(makeDescriptor({ preCheck }))).toBe(preCheck);
  });

  it("prefers preCheck over preResolved when both are present", () => {
    const preCheck = makeCheckResult({ state: "deny", matchedPattern: "rm *" });
    const descriptor = makeDescriptor({
      preCheck,
      preResolved: { state: "allow" },
    });

    expect(preResolvedCheckOf(descriptor)).toBe(preCheck);
  });

  it("synthesizes a builtin tool check from preResolved", () => {
    const descriptor = makeDescriptor({
      surface: "skill",
      preResolved: { state: "ask" },
    });

    expect(preResolvedCheckOf(descriptor)).toEqual({
      state: "ask",
      toolName: "skill",
      source: "tool",
      origin: "builtin",
    });
  });

  it("returns null when the descriptor resolves nothing itself", () => {
    expect(preResolvedCheckOf(makeDescriptor())).toBeNull();
  });
});

describe("isUnconditionalDeny", () => {
  it("accepts a descriptor whose preCheck denies", () => {
    const descriptor = makeDescriptor({
      preCheck: makeCheckResult({ state: "deny", matchedPattern: "rm *" }),
    });

    expect(isUnconditionalDeny(descriptor)).toBe(true);
  });

  it("accepts a descriptor whose preResolved state denies", () => {
    const descriptor = makeDescriptor({
      surface: "skill",
      preResolved: { state: "deny" },
    });

    expect(isUnconditionalDeny(descriptor)).toBe(true);
  });

  it("rejects an ask, which a human could still approve", () => {
    const descriptor = makeDescriptor({
      preCheck: makeCheckResult({ state: "ask", matchedPattern: "*" }),
    });

    expect(isUnconditionalDeny(descriptor)).toBe(false);
  });

  it("rejects an allow", () => {
    const descriptor = makeDescriptor({
      preCheck: makeCheckResult({ state: "allow" }),
    });

    expect(isUnconditionalDeny(descriptor)).toBe(false);
  });

  it("rejects a session-sourced deny, which the runner's fast path allows", () => {
    const descriptor = makeDescriptor({
      preCheck: makeCheckResult({
        state: "deny",
        source: "session",
        matchedPattern: "rm *",
      }),
    });

    expect(isUnconditionalDeny(descriptor)).toBe(false);
  });

  it("rejects a descriptor that resolves nothing of its own", () => {
    expect(isUnconditionalDeny(makeDescriptor())).toBe(false);
  });

  it("rejects a bypass and a gate that does not apply", () => {
    const bypass: GateResult = { action: "allow", decidedBy: DECIDED_BY_HUMAN };

    expect(isUnconditionalDeny(bypass)).toBe(false);
    expect(isUnconditionalDeny(null)).toBe(false);
  });
});

describe("orderDenyFirst", () => {
  function denyingGate(surface: string): GateResult {
    return makeDescriptor({
      surface,
      preCheck: makeCheckResult({ state: "deny", matchedPattern: "*" }),
    });
  }

  function askingGate(surface: string): GateResult {
    return makeDescriptor({
      surface,
      preCheck: makeCheckResult({ state: "ask", matchedPattern: "*" }),
    });
  }

  it("leaves the order untouched when no gate denies", () => {
    const gates = [askingGate("a"), null, askingGate("b")];

    expect(orderDenyFirst(gates)).toEqual(gates);
  });

  it("moves a later denying gate ahead of the rest", () => {
    const asking = askingGate("external_directory_read");
    const denying = denyingGate("bash");

    expect(orderDenyFirst([asking, denying])).toEqual([denying, asking]);
  });

  it("keeps two denying gates in their original relative order", () => {
    const first = denyingGate("path");
    const second = denyingGate("bash");

    expect(orderDenyFirst([first, askingGate("a"), second])).toEqual([
      first,
      second,
      askingGate("a"),
    ]);
  });

  it("keeps the non-denying remainder in its original relative order", () => {
    const denying = denyingGate("bash");
    const first = askingGate("a");
    const second = askingGate("b");

    expect(orderDenyFirst([first, second, denying])).toEqual([
      denying,
      first,
      second,
    ]);
  });
});
