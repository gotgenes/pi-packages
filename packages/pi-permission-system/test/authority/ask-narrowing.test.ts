import { describe, expect, it } from "vitest";
import { narrowAsk } from "#src/authority/ask-narrowing";
import type { AskingBashUnit } from "#src/types";
import {
  makeBashChainPromptDetails,
  makePromptDetails,
} from "#test/helpers/prompt-details-fixtures";

const assignment = { command: 'F="a b"', matchedPattern: "*" };
const commit = { command: "git commit -m x", matchedPattern: "git commit *" };
const tests = { command: "npm test", matchedPattern: "*" };
const wrapper = {
  command: "sudo rm y",
  matchedPattern: "<indirection-bash-wrapper>",
  floor: "<indirection-bash-wrapper>",
};
const commandLine = `${assignment.command} && git commit -m x && npm test`;

/**
 * The oracle for a narrowed ask is the ask the gate would have raised had the
 * settled units never asked: the same command line, with only the rest asking.
 */
function askFor(
  units: readonly AskingBashUnit[],
  options: { command?: string; forwarded?: boolean } = {},
) {
  return makeBashChainPromptDetails(units, {
    command: commandLine,
    ...options,
  });
}

describe("narrowAsk", () => {
  describe("an ask the named units do not touch", () => {
    it("is unchanged when the ask lists no asking units", () => {
      expect(narrowAsk(makePromptDetails(), ["ls"])).toStrictEqual({
        kind: "unchanged",
      });
    });

    it("is unchanged when no named unit is asking", () => {
      const details = askFor([assignment, commit]);
      expect(narrowAsk(details, ["npm test"])).toStrictEqual({
        kind: "unchanged",
      });
    });

    it("is unchanged when the asking units ride an ask on another surface", () => {
      const details = askFor([assignment, commit]);
      const forged = {
        ...details,
        accessIntent: {
          surface: "external_directory",
          matchValues: ["/Sheet1/B1"],
          boundaryValue: "/Sheet1/B1",
          askingUnits: [assignment, commit],
          delegationLicense: "nothing-on-disk" as const,
        },
      };
      expect(narrowAsk(forged, [assignment.command])).toStrictEqual({
        kind: "unchanged",
      });
    });

    it("is unchanged when no unit is named", () => {
      expect(narrowAsk(askFor([assignment, commit]), [])).toStrictEqual({
        kind: "unchanged",
      });
    });
  });

  describe("an ask whose every unit is named", () => {
    it("is settled", () => {
      const details = askFor([assignment, commit]);
      expect(
        narrowAsk(details, [assignment.command, commit.command]),
      ).toStrictEqual({
        kind: "settled",
        allowedUnits: [assignment.command, commit.command],
      });
    });

    it("settles every unit with the named text, so a repeated command goes too", () => {
      const echo = { command: "echo a", matchedPattern: "*" };
      const details = makeBashChainPromptDetails([echo, echo], {
        command: "echo a; echo a",
      });
      expect(narrowAsk(details, ["echo a"])).toStrictEqual({
        kind: "settled",
        allowedUnits: ["echo a", "echo a"],
      });
    });
  });

  describe("a local ask narrowed to the units still asking", () => {
    it("names the next unit, its rule, and the session grant for the rest", () => {
      const narrowed = narrowAsk(askFor([assignment, commit, tests]), [
        assignment.command,
      ]);
      expect(narrowed).toStrictEqual({
        kind: "narrowed",
        details: askFor([commit, tests]),
        allowedUnits: [assignment.command],
        remainingUnits: [commit.command, tests.command],
      });
    });

    it("keeps the value's facts when a later unit is the one settled", () => {
      const narrowed = narrowAsk(askFor([assignment, commit, tests]), [
        commit.command,
      ]);
      expect(narrowed).toStrictEqual({
        kind: "narrowed",
        details: askFor([assignment, tests]),
        allowedUnits: [commit.command],
        remainingUnits: [assignment.command, tests.command],
      });
    });

    it("carries the floor of a unit still asking", () => {
      const narrowed = narrowAsk(askFor([assignment, wrapper]), [
        assignment.command,
      ]);
      expect(narrowed).toStrictEqual({
        kind: "narrowed",
        details: askFor([wrapper]),
        allowedUnits: [assignment.command],
        remainingUnits: [wrapper.command],
      });
    });

    it("drops the floor of the unit settled", () => {
      const narrowed = narrowAsk(askFor([wrapper, tests]), [wrapper.command]);
      expect(narrowed).toStrictEqual({
        kind: "narrowed",
        details: askFor([tests]),
        allowedUnits: [wrapper.command],
        remainingUnits: [tests.command],
      });
    });

    it("offers no session grant when no unit left suggests a pattern", () => {
      const comment = { command: "# note", matchedPattern: "*" };
      const narrowed = narrowAsk(askFor([assignment, comment]), [
        assignment.command,
      ]);
      if (narrowed.kind !== "narrowed") throw new Error(narrowed.kind);
      expect(narrowed.details).not.toHaveProperty("sessionApproval");
      expect(narrowed.details).not.toHaveProperty("sessionLabel");
      expect(narrowed.details.payload.request.value).toBe("# note");
    });
  });

  describe("an ask that offered no session grant", () => {
    it("gains none when it is narrowed", () => {
      const { sessionApproval: _offered, ...details } = askFor(
        [assignment, commit],
        { forwarded: true },
      );
      const narrowed = narrowAsk(details, [assignment.command]);
      if (narrowed.kind !== "narrowed") throw new Error(narrowed.kind);
      expect(narrowed.details).not.toHaveProperty("sessionApproval");
    });
  });

  describe("a forwarded ask narrowed to the units still asking", () => {
    it("replaces the display value and gains no session label", () => {
      const narrowed = narrowAsk(
        askFor([assignment, commit, tests], { forwarded: true }),
        [assignment.command],
      );
      expect(narrowed).toStrictEqual({
        kind: "narrowed",
        details: askFor([commit, tests], { forwarded: true }),
        allowedUnits: [assignment.command],
        remainingUnits: [commit.command, tests.command],
      });
    });
  });
});
