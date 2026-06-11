/**
 * `makeFakePi()` — a composition-root test harness.
 *
 * Lets a test run the real `piPermissionSystemExtension(pi)` factory and then
 * introspect and drive the result. Unlike the per-handler unit fixtures in
 * `handler-fixtures.ts` (which inject collaborators), this harness exercises the
 * factory itself — the wiring layer where registration completeness, shared-
 * instance contracts, teardown, and event ordering live.
 *
 * It provides:
 * - `events` — a real `createEventBus()` so cross-extension pub/sub and RPC
 *   behave as in production (tests can inject a shared bus to model parent/child
 *   instances).
 * - `handlers` — every `pi.on(event, handler)` registration, keyed by event
 *   name, so a test can assert completeness and fire handlers.
 * - `commands` — every `pi.registerCommand(name, …)` registration.
 * - `fire(event, input, ctx)` — drive a registered handler; resolves to its
 *   (possibly async) result.
 *
 * The harness object is cast to `ExtensionAPI` at the call to the factory; the
 * `FakePi` interface itself stays narrow (ISP — only what the factory touches).
 */
import { createEventBus, type EventBus } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

/** A handler recorded by `pi.on(...)`, kept generic over event/result shapes. */
export type RecordedHandler = (event: unknown, ctx: unknown) => unknown;

export interface FakePi {
  /** Real event bus so cross-extension pub/sub and RPC behave as in production. */
  events: EventBus;
  /** Every `pi.on(event, handler)` registration, keyed by event name. */
  handlers: Map<string, RecordedHandler>;
  /** Every `pi.registerCommand(name, …)` registration, keyed by command name. */
  commands: Map<string, unknown>;
  /**
   * Drive a registered handler; resolves to its (possibly async) result.
   *
   * Throws if no handler is registered for `event` so a typo in a test surfaces
   * loudly instead of silently resolving to `undefined`.
   */
  fire(event: string, input?: unknown, ctx?: unknown): Promise<unknown>;
  /** Minimal tool registry — returns the configured tool names. */
  getAllTools(): { name: string }[];
  getActiveTools(): { name: string }[];
  setActiveTools(names: string[]): void;
}

export interface MakeFakePiOptions {
  /** Inject a shared bus to model parent/child instances; defaults to a fresh bus. */
  events?: EventBus;
  /** Tool names returned by `getAllTools()`; defaults to a small set. */
  toolNames?: readonly string[];
}

const DEFAULT_TOOL_NAMES = ["read", "write", "edit", "bash", "ls", "grep"];

/**
 * Build a fake `ExtensionAPI` for composition-root tests.
 *
 * The returned object is structurally a `FakePi`; pass it to the factory as
 * `piPermissionSystemExtension(pi as unknown as ExtensionAPI)`.
 */
export function makeFakePi(options: MakeFakePiOptions = {}): FakePi {
  const events = options.events ?? createEventBus();
  const toolNames = options.toolNames ?? DEFAULT_TOOL_NAMES;
  const handlers = new Map<string, RecordedHandler>();
  const commands = new Map<string, unknown>();

  return {
    events,
    handlers,
    commands,
    fire(event, input, ctx): Promise<unknown> {
      const handler = handlers.get(event);
      if (!handler) {
        throw new Error(`No handler registered for event "${event}"`);
      }
      return Promise.resolve(handler(input, ctx));
    },
    getAllTools(): { name: string }[] {
      return toolNames.map((name) => ({ name }));
    },
    getActiveTools(): { name: string }[] {
      return toolNames.map((name) => ({ name }));
    },
    setActiveTools: vi.fn(),
    // ── ExtensionAPI methods the factory touches (recorded) ────────────────
    on(event: string, handler: RecordedHandler): void {
      handlers.set(event, handler);
    },
    registerCommand(name: string, optionsArg: unknown): void {
      commands.set(name, optionsArg);
    },
    // ── ExtensionAPI methods present for the cast but unused by the factory ─
    registerProvider: vi.fn(),
    exec: vi.fn(),
  } as FakePi & Record<string, unknown>;
}
