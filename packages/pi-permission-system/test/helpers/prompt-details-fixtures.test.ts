import { describe, expect, it } from "vitest";
import { makeBashChainPromptDetails } from "./prompt-details-fixtures";

describe("makeBashChainPromptDetails", () => {
  const units = [
    { command: "cd sub", matchedPattern: "*" },
    { command: "npm test", matchedPattern: "*" },
  ];

  it("names the first unit as the value and every other one beside it", () => {
    const details = makeBashChainPromptDetails(units);

    expect(details.payload.request.value).toBe("cd sub");
    expect(details.payload.request.otherAskingUnits).toStrictEqual([
      "npm test",
    ]);
    expect(details.accessIntent?.askingUnits).toStrictEqual(units);
  });

  it("offers the session grant the gate suggests for every unit", () => {
    const details = makeBashChainPromptDetails(units);

    expect(details.sessionApproval).toStrictEqual({
      grants: [
        { surface: "bash", pattern: "cd sub*" },
        { surface: "bash", pattern: "npm test*" },
      ],
    });
    expect(details.sessionLabel).toBe(
      'Yes, allow bash "cd sub*", "npm test*" for this session',
    );
    expect(details.command).toBe("cd sub");
  });

  it("carries a forwarded ask's display value and no gate-local label", () => {
    const details = makeBashChainPromptDetails(units, { forwarded: true });

    expect(details.value).toBe("cd sub");
    expect(details).not.toHaveProperty("sessionLabel");
    expect(details).not.toHaveProperty("command");
    expect(details.sessionApproval?.grants).toHaveLength(2);
  });
});
