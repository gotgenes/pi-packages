import { describe, expect, it } from "vitest";
import {
  describeBashCommandContext,
  flaggedElementLabel,
  flaggedElements,
  valueLabel,
} from "#src/presentation/fact-vocabulary";
import type {
  PromptEvidence,
  PromptPayloadKind,
} from "#src/presentation/prompt-payload";
import { makePromptPayload } from "#test/helpers/prompt-details-fixtures";

/** A payload of the given kind whose flagged value and evidence are set. */
function payloadOf(
  kind: PromptPayloadKind,
  value: string,
  evidence: PromptEvidence[] = [],
) {
  const base = makePromptPayload();
  return {
    ...base,
    kind,
    request: { ...base.request, value },
    evidence,
  };
}

/** An `external path` evidence entry, as the bash external-directory gate emits it. */
function externalPath(path: string, resolved: string | null): PromptEvidence {
  return { label: "external path", text: path, detail: resolved };
}

describe("flaggedElements", () => {
  it("flags the decision-relevant value for a single-value ask", () => {
    expect(flaggedElements(payloadOf("path", "/etc/hosts"))).toEqual([
      "/etc/hosts",
    ]);
  });

  it("flags the command for a bash ask", () => {
    expect(flaggedElements(payloadOf("bash", "rm -rf build"))).toEqual([
      "rm -rf build",
    ]);
  });

  it("flags the escaping paths rather than the command for a bash external-directory ask", () => {
    expect(
      flaggedElements(
        payloadOf("bash_external_directory", "diff /etc/hosts ~/.ssh/config", [
          { label: "working directory", text: "/repo", detail: null },
          externalPath("/etc/hosts", null),
          externalPath("~/.ssh/config", "/home/me/.ssh/config"),
        ]),
      ),
    ).toEqual(["/etc/hosts", "~/.ssh/config"]);
  });

  it("flags nothing when the value is empty", () => {
    expect(flaggedElements(payloadOf("tool", ""))).toEqual([]);
  });
});

describe("valueLabel", () => {
  it.each([
    ["bash", "command"],
    ["bash_external_directory", "command"],
    ["mcp", "target"],
    ["tool", "tool"],
    ["path", "path"],
    ["external_directory", "path"],
    ["skill", "skill"],
    ["skill_read", "skill"],
  ] as const)("labels a %s ask's value %s", (kind, label) => {
    expect(valueLabel(payloadOf(kind, "value"))).toBe(label);
  });

  it.each([
    ["bash", "command"],
    ["skill", "skill"],
    ["read", "value"],
  ])("infers a payload-less forwarded ask's label from its %s surface", (surface, label) => {
    const base = payloadOf("forwarded", "value");
    expect(valueLabel({ ...base, request: { ...base.request, surface } })).toBe(
      label,
    );
  });
});

describe("flaggedElementLabel", () => {
  it("labels the escaping paths a bash external-directory ask flags", () => {
    expect(
      flaggedElementLabel(payloadOf("bash_external_directory", "cmd")),
    ).toBe("path");
  });

  it.each([
    "bash",
    "mcp",
    "path",
    "skill",
  ] as const)("agrees with the value label for a %s ask, whose value is what it flags", (kind) => {
    const single = payloadOf(kind, "value");
    expect(flaggedElementLabel(single)).toBe(valueLabel(single));
  });
});

describe("describeBashCommandContext", () => {
  it.each([
    ["command_substitution", "command substitution"],
    ["process_substitution", "process substitution"],
    ["subshell", "subshell"],
  ] as const)("names a %s context", (context, label) => {
    expect(describeBashCommandContext(context)).toBe(label);
  });

  it("names no context for a current-shell command", () => {
    expect(describeBashCommandContext(null)).toBeUndefined();
  });
});
