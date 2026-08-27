import { describe, expect, it } from "vitest";
import {
  asDecisionSource,
  type DecisionSource,
  MAX_DECISION_SOURCE_DEPTH,
} from "#src/authority/decision-source";

/** Wrap `inner` in `depth` nested `forwarded` frames. */
function nest(depth: number, inner: DecisionSource): DecisionSource {
  let source = inner;
  for (let i = 0; i < depth; i++) {
    source = {
      kind: "forwarded",
      responderSessionId: `session-${i}`,
      decision: source,
    };
  }
  return source;
}

describe("asDecisionSource", () => {
  describe("round-trips every variant", () => {
    const variants: readonly DecisionSource[] = [
      { kind: "user", via: "dialog" },
      { kind: "user", via: "select" },
      {
        kind: "authorizer",
        name: "model-judge",
        verdict: "deny",
        reason: "reads outside the project",
      },
      {
        kind: "authorizer",
        name: "model-judge",
        verdict: "allow",
        reason: null,
      },
      {
        kind: "rule",
        surface: "external_directory",
        pattern: "/tmp/*",
        origin: "global",
      },
      { kind: "rule", surface: "bash", pattern: null, origin: null },
      {
        kind: "session_approval",
        surface: "external_directory",
        pattern: "/tmp/*",
      },
      { kind: "session_approval", surface: "bash", pattern: null },
      { kind: "yolo", pattern: "<opaque-bash-wrapper>" },
      { kind: "yolo", pattern: null },
      { kind: "infrastructure_read" },
      {
        kind: "unavailable",
        reason: "Session 'abc' did not answer within 600s",
      },
      { kind: "gate_error", reason: "boom" },
      {
        kind: "forwarded",
        responderSessionId: "019ff969-c34c-70be-9034-fae19c852932",
        decision: { kind: "user", via: "dialog" },
      },
      { kind: "forwarded", responderSessionId: null, decision: null },
    ];

    for (const variant of variants) {
      it(`admits ${variant.kind} (${JSON.stringify(variant)})`, () => {
        expect(asDecisionSource(JSON.parse(JSON.stringify(variant)))).toEqual(
          variant,
        );
      });
    }
  });

  describe("rejects malformed input", () => {
    it.each([
      ["null", null],
      ["a string", "user"],
      ["an array", [{ kind: "user", via: "dialog" }]],
      ["an unknown kind", { kind: "telepathy" }],
      ["a missing kind", { via: "dialog" }],
      ["an unknown user surface", { kind: "user", via: "smoke-signal" }],
      ["a missing user surface", { kind: "user" }],
      [
        "an unknown authorizer verdict",
        { kind: "authorizer", name: "j", verdict: "defer", reason: null },
      ],
      [
        "a missing authorizer name",
        { kind: "authorizer", verdict: "allow", reason: null },
      ],
      [
        "a non-string authorizer name",
        { kind: "authorizer", name: 7, verdict: "allow", reason: null },
      ],
      ["a missing rule surface", { kind: "rule", pattern: null, origin: null }],
      [
        "a non-nullable-string rule pattern",
        { kind: "rule", surface: "bash", pattern: 7, origin: null },
      ],
      [
        "a missing session_approval surface",
        { kind: "session_approval", pattern: null },
      ],
      ["a missing yolo pattern", { kind: "yolo" }],
      ["a missing unavailable reason", { kind: "unavailable" }],
      ["a non-string gate_error reason", { kind: "gate_error", reason: null }],
      [
        "a missing forwarded decision",
        { kind: "forwarded", responderSessionId: "s" },
      ],
      [
        "a non-nullable-string responderSessionId",
        { kind: "forwarded", responderSessionId: 7, decision: null },
      ],
    ])("rejects %s", (_label, value) => {
      expect(asDecisionSource(value)).toBeUndefined();
    });

    it("rejects the whole value when a nested decision is malformed", () => {
      // All-or-nothing, like `asPromptPayload`: a half-parsed provenance record
      // would assert a decider that never decided.
      expect(
        asDecisionSource({
          kind: "forwarded",
          responderSessionId: "session-1",
          decision: { kind: "user", via: "smoke-signal" },
        }),
      ).toBeUndefined();
    });

    it("drops unknown properties rather than rejecting", () => {
      expect(
        asDecisionSource({ kind: "user", via: "dialog", clicks: 2 }),
      ).toEqual({ kind: "user", via: "dialog" });
    });
  });

  describe("bounds nesting depth", () => {
    it("admits nesting up to the bound", () => {
      const source = nest(MAX_DECISION_SOURCE_DEPTH, {
        kind: "user",
        via: "dialog",
      });

      expect(asDecisionSource(JSON.parse(JSON.stringify(source)))).toEqual(
        source,
      );
    });

    it("rejects nesting past the bound", () => {
      const source = nest(MAX_DECISION_SOURCE_DEPTH + 1, {
        kind: "user",
        via: "dialog",
      });

      expect(
        asDecisionSource(JSON.parse(JSON.stringify(source))),
      ).toBeUndefined();
    });
  });
});
