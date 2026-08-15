/**
 * toSubagentRecord() widens to carry turnCount/activeTools/outputFile — all
 * three already live on Subagent/SubagentState but previously dropped by
 * toSubagentRecord()'s allowlist.
 */
import { describe, expect, it } from "vitest";
import { toSubagentRecord } from "#src/service/service-adapter";
import { createTestSubagent } from "#test/helpers/make-subagent";
import { createSubagentSessionStub, toSubagentSession } from "#test/helpers/mock-session";

describe("toSubagentRecord — widened fields", () => {
  it("carries turnCount and serialized activeTools", () => {
    const record = createTestSubagent({
      id: "abc-123",
      turnCount: 4,
      activeTools: ["read_file", "grep"],
    });

    const out = toSubagentRecord(record);

    expect(out.turnCount).toBe(4);
    // activeTools is a ReadonlyMap<key, toolName> on the live object; the
    // record must serialize to a plain array of tool names.
    expect(out.activeTools).toEqual(["read_file", "grep"]);
  });

  it("defaults to turnCount 1 and an empty activeTools array when unset", () => {
    const record = createTestSubagent({ id: "def-456" });

    const out = toSubagentRecord(record);

    expect(out.turnCount).toBe(1);
    expect(out.activeTools).toEqual([]);
  });

  it("includes outputFile when the record has an active session with one", () => {
    const record = createTestSubagent({ id: "with-output" });
    record.subagentSession = toSubagentSession(createSubagentSessionStub(undefined, "/tmp/agent-out.txt"));

    const out = toSubagentRecord(record);

    expect(out.outputFile).toBe("/tmp/agent-out.txt");
  });

  it("omits outputFile when the record never had a session", () => {
    const record = createTestSubagent({ id: "no-output" });

    const out = toSubagentRecord(record);

    expect(out).not.toHaveProperty("outputFile");
  });

  it("stays JSON-round-trippable", () => {
    const record = createTestSubagent({
      id: "roundtrip",
      turnCount: 2,
      activeTools: ["bash"],
    });
    record.subagentSession = toSubagentSession(createSubagentSessionStub(undefined, "/tmp/out.txt"));

    const out = toSubagentRecord(record);
    const roundTripped = JSON.parse(JSON.stringify(out));

    expect(roundTripped).toEqual(out);
  });
});
