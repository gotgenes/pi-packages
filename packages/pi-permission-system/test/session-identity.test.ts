import { describe, expect, test, vi } from "vitest";
import {
  readSessionId,
  type SessionIdentityContext,
} from "#src/session-identity";

function makeCtx(getSessionId: () => string): SessionIdentityContext {
  return { sessionManager: { getSessionId } };
}

describe("readSessionId", () => {
  test("returns the host's session id", () => {
    expect(readSessionId(makeCtx(() => "session-abc"))).toBe("session-abc");
  });

  test("returns null for an empty session id", () => {
    expect(readSessionId(makeCtx(() => ""))).toBeNull();
  });

  test("returns null when the host throws", () => {
    const getSessionId = vi.fn(() => {
      throw new Error("session id unavailable");
    });
    expect(readSessionId(makeCtx(getSessionId))).toBeNull();
    expect(getSessionId).toHaveBeenCalledOnce();
  });

  test("returns null when the host exposes no session id at all", () => {
    const ctx = { sessionManager: {} } as unknown as SessionIdentityContext;
    expect(readSessionId(ctx)).toBeNull();
  });
});
