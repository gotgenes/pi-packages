import { describe, expect, it } from "vitest";

import { preResolvedCheckOf } from "#src/handlers/gates/descriptor";

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
