import { describe, expect, it, vi } from "vitest";

import { SessionTurnPrep } from "#src/handlers/session-turn-prep";

import { makeCtx } from "#test/helpers/handler-fixtures";
import { makeRealSession } from "#test/helpers/session-fixtures";

// ── helpers ────────────────────────────────────────────────────────────────

function makeTurnPrep() {
  const { session, forwarding, configStore } = makeRealSession();
  const warmParser = vi.fn();
  const turnPrep = new SessionTurnPrep(session, warmParser);
  return { turnPrep, session, forwarding, configStore, warmParser };
}

// ── SessionTurnPrep.prepare ────────────────────────────────────────────────

describe("SessionTurnPrep.prepare", () => {
  it("triggers the bash-parser warm-up", () => {
    const { turnPrep, warmParser } = makeTurnPrep();
    turnPrep.prepare(makeCtx());
    expect(warmParser).toHaveBeenCalledTimes(1);
  });

  it("activates the session with ctx", () => {
    const ctx = makeCtx();
    const { turnPrep, forwarding } = makeTurnPrep();
    turnPrep.prepare(ctx);
    // Real session.activate calls forwarding.start
    expect(forwarding.start).toHaveBeenCalledWith(ctx);
  });

  it("refreshes config with ctx, gated on project trust", () => {
    const ctx = makeCtx();
    const { turnPrep, configStore } = makeTurnPrep();
    turnPrep.prepare(ctx);
    expect(configStore.refresh).toHaveBeenCalledWith(ctx, true);
  });

  it("withholds the project scope when the project is untrusted", () => {
    const ctx = makeCtx({
      isProjectTrusted: vi.fn<() => boolean>().mockReturnValue(false),
    });
    const { turnPrep, configStore } = makeTurnPrep();
    turnPrep.prepare(ctx);
    expect(configStore.refresh).toHaveBeenCalledWith(ctx, false);
  });
});
