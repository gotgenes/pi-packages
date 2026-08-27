import { describe, expect, it } from "vitest";
import {
  mergeTokenEffects,
  type TokenEffect,
  UNPROVEN_EFFECT,
} from "#src/access-intent/effect";

const syntaxRead: TokenEffect = { effect: "read", source: "syntax" };
const coreRead: TokenEffect = { effect: "read", source: "core" };
const syntaxWrite: TokenEffect = { effect: "write", source: "syntax" };
const retracted: TokenEffect = { effect: "unproven", source: "retracted" };

describe("UNPROVEN_EFFECT", () => {
  it("is the fail-closed base case, unproven on both fields", () => {
    expect(UNPROVEN_EFFECT).toEqual({ effect: "unproven", source: "unproven" });
  });
});

describe("mergeTokenEffects", () => {
  describe("when the two attributions agree", () => {
    it("keeps the effect and the first attribution's source", () => {
      expect(mergeTokenEffects(syntaxRead, coreRead)).toEqual(syntaxRead);
    });

    it("keeps the first source in the other order too", () => {
      expect(mergeTokenEffects(coreRead, syntaxRead)).toEqual(coreRead);
    });

    it("keeps a write proven twice", () => {
      expect(mergeTokenEffects(syntaxWrite, syntaxWrite)).toEqual(syntaxWrite);
    });

    it("keeps a retraction's blame over a bare unproven", () => {
      expect(mergeTokenEffects(retracted, UNPROVEN_EFFECT)).toEqual(retracted);
    });

    it("keeps a retraction's blame in either collection order", () => {
      // Collection order is an accident of the command's shape, and the blame
      // line is the only reason the source is recorded at all.
      expect(mergeTokenEffects(UNPROVEN_EFFECT, retracted)).toEqual(retracted);
    });
  });

  describe("when the two attributions disagree", () => {
    it("falls to the fail-closed base case for read against write", () => {
      expect(mergeTokenEffects(syntaxRead, syntaxWrite)).toEqual(
        UNPROVEN_EFFECT,
      );
    });

    it("falls to the fail-closed base case for write against read", () => {
      expect(mergeTokenEffects(syntaxWrite, coreRead)).toEqual(UNPROVEN_EFFECT);
    });

    it("lets an unproven attribution retract a proven read", () => {
      expect(mergeTokenEffects(coreRead, UNPROVEN_EFFECT)).toEqual(
        UNPROVEN_EFFECT,
      );
    });

    it("lets a proven read fall to an already-unproven attribution", () => {
      expect(mergeTokenEffects(UNPROVEN_EFFECT, coreRead)).toEqual(
        UNPROVEN_EFFECT,
      );
    });

    it("discards a retraction's blame when it disagrees with a proof", () => {
      expect(mergeTokenEffects(retracted, syntaxWrite)).toEqual(
        UNPROVEN_EFFECT,
      );
    });
  });
});
