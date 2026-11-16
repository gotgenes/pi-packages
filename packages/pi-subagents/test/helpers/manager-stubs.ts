/**
 * manager-stubs.ts — Shared createSubagentSession factory stubs for agent-manager tests.
 *
 * The factory produces a born-complete SubagentSession (issue #265). These
 * helpers wrap the SubagentSession stub from mock-session into the factory shape
 * SubagentManager injects into each Subagent. Tests with unique turn-loop behavior
 * (event-emitting, gated, error-throwing) configure the returned stub directly.
 */
import { vi } from "vitest";
import type { CreateSubagentSessionParams } from "#src/lifecycle/create-subagent-session";
import type { SubagentSession } from "#src/lifecycle/subagent-session";
import {
  createMockSession,
  createSubagentSessionStub,
  type MockSession,
  toSubagentSession,
} from "#test/helpers/mock-session";

// ── createBlockingFactory ────────────────────────────────────────────────────

/**
 * A factory whose creation never resolves.
 *
 * Use when a test needs an agent to stay "running" with no session yet created
 * (e.g., to inspect queued records or test abort behavior).
 */
export function createBlockingFactory() {
  return vi.fn((_params: CreateSubagentSessionParams) => new Promise<SubagentSession>(() => {}));
}

// ── createSessionFactory ─────────────────────────────────────────────────────

/**
 * A factory returning a SubagentSession stub wrapping the given (or a fresh)
 * session. Returns the factory plus the stub and session so tests can configure
 * `runTurnLoop` and emit session events.
 */
export function createSessionFactory(session: MockSession = createMockSession(), outputFile?: string) {
  const stub = createSubagentSessionStub(session, outputFile);
  const factory = vi.fn(async (_params: CreateSubagentSessionParams) => toSubagentSession(stub));
  return { factory, stub, session };
}
