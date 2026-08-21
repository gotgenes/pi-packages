import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdjudicationRole } from "#src/authority/authorizer-selection";
import type { RegisteredChildDetector } from "#src/authority/subagent-detection";
import type { PermissionsService } from "#src/service";
import {
  PermissionServiceLifecycle,
  type ReadyAnnouncer,
  type ServiceLifecycle,
} from "#src/service-lifecycle";

import { makeCtx } from "#test/helpers/handler-fixtures";

// ── module stubs ───────────────────────────────────────────────────────────

const mockIsRegisteredChild = vi.fn<(ctx: unknown) => boolean>();
const mockAdjudicatesLocally = vi.fn<() => boolean>();
const mockPublishPermissionsService = vi.hoisted(() => vi.fn<() => void>());
const mockUnpublishPermissionsService = vi.hoisted(() => vi.fn<() => void>());
const mockPublishForSession = vi.hoisted(() => vi.fn<() => void>());
const mockUnpublishForSession = vi.hoisted(() => vi.fn<() => void>());
const mockEmitReadyEvent = vi.hoisted(() => vi.fn<() => void>());

vi.mock("#src/service", () => ({
  publishPermissionsService: mockPublishPermissionsService,
  unpublishPermissionsService: mockUnpublishPermissionsService,
  publishPermissionsServiceForSession: mockPublishForSession,
  unpublishPermissionsServiceForSession: mockUnpublishForSession,
}));
vi.mock("#src/permission-events", () => ({
  emitReadyEvent: mockEmitReadyEvent,
}));

// ── helpers ────────────────────────────────────────────────────────────────

function makeService(): PermissionsService {
  return {
    checkPermission: vi.fn(),
    getToolPermission: vi.fn(),
    registerToolInputFormatter: vi.fn(),
    registerToolAccessExtractor: vi.fn(),
    registerAuthorizer: vi.fn(),
  };
}

function makeDetection(): RegisteredChildDetector {
  return { isRegisteredChild: mockIsRegisteredChild };
}

function makeRole(): AdjudicationRole {
  return { adjudicatesLocally: mockAdjudicatesLocally };
}

/** A session manager reporting `sessionId`, or one whose id is unreachable. */
function makeSessionManager(
  sessionId: string | null,
): ExtensionContext["sessionManager"] {
  return {
    getEntries: vi.fn().mockReturnValue([]),
    getSessionDir: vi.fn().mockReturnValue("/sessions/test"),
    getSessionId: vi.fn(() => {
      if (sessionId === null) {
        throw new Error("session id unavailable");
      }
      return sessionId;
    }),
    addEntry: vi.fn(),
  } as unknown as ExtensionContext["sessionManager"];
}

function makeLifecycle(overrides?: { subscriptions?: (() => void)[] }) {
  const service = makeService();
  const detection = makeDetection();
  const role = makeRole();
  const events = { emit: vi.fn(), on: vi.fn() };
  const subscriptions = overrides?.subscriptions ?? [];
  const lifecycle = new PermissionServiceLifecycle(
    service,
    detection,
    role,
    events,
    subscriptions,
  );
  return { lifecycle, service, detection, role, events, subscriptions };
}

beforeEach(() => {
  mockIsRegisteredChild.mockReset();
  mockIsRegisteredChild.mockReturnValue(false);
  mockAdjudicatesLocally.mockReset();
  mockAdjudicatesLocally.mockReturnValue(true);
  mockPublishPermissionsService.mockReset();
  mockUnpublishPermissionsService.mockReset();
  mockPublishForSession.mockReset();
  mockUnpublishForSession.mockReset();
  mockEmitReadyEvent.mockReset();
});

// ── ServiceLifecycle interface shape ──────────────────────────────────────

it("PermissionServiceLifecycle satisfies ServiceLifecycle", () => {
  const { lifecycle } = makeLifecycle();
  const _: ServiceLifecycle = lifecycle;
  expect(_).toBeDefined();
});

it("PermissionServiceLifecycle satisfies ReadyAnnouncer", () => {
  const { lifecycle } = makeLifecycle();
  const _: ReadyAnnouncer = lifecycle;
  expect(_).toBeDefined();
});

// ── activate ──────────────────────────────────────────────────────────────

describe("activate", () => {
  it("publishes the service for a non-child session", () => {
    const ctx = makeCtx();
    const { lifecycle, service } = makeLifecycle();
    mockIsRegisteredChild.mockReturnValue(false);
    lifecycle.activate(ctx);
    expect(mockPublishPermissionsService).toHaveBeenCalledWith(service);
  });

  it("skips publishing for a registered child session", () => {
    const ctx = makeCtx();
    const { lifecycle } = makeLifecycle();
    mockIsRegisteredChild.mockReturnValue(true);
    lifecycle.activate(ctx);
    expect(mockPublishPermissionsService).not.toHaveBeenCalled();
  });

  it("always emits the ready event, even for a child session", () => {
    const ctx = makeCtx();
    const { lifecycle, events } = makeLifecycle();
    mockIsRegisteredChild.mockReturnValue(true);
    lifecycle.activate(ctx);
    expect(mockEmitReadyEvent).toHaveBeenCalledWith(events, {
      sessionId: "test-session",
      adjudicatesLocally: true,
    });
  });

  it("emits ready after publishing the service", () => {
    const ctx = makeCtx();
    const order: string[] = [];
    mockPublishForSession.mockImplementation(() => order.push("publish-keyed"));
    mockPublishPermissionsService.mockImplementation(() =>
      order.push("publish"),
    );
    mockEmitReadyEvent.mockImplementation(() => order.push("ready"));
    const { lifecycle } = makeLifecycle();
    lifecycle.activate(ctx);
    expect(order).toEqual(["publish-keyed", "publish", "ready"]);
  });

  it("consults the detector with ctx", () => {
    const ctx = makeCtx();
    const { lifecycle } = makeLifecycle();
    lifecycle.activate(ctx);
    expect(mockIsRegisteredChild).toHaveBeenCalledWith(ctx);
  });

  it("publishes the service under this node's own session id", () => {
    const ctx = makeCtx({ sessionManager: makeSessionManager("node-session") });
    const { lifecycle, service } = makeLifecycle();
    lifecycle.activate(ctx);
    expect(mockPublishForSession).toHaveBeenCalledWith("node-session", service);
  });

  it("publishes a registered child's own keyed service, which it may not clobber the root slot with", () => {
    const ctx = makeCtx({
      sessionManager: makeSessionManager("child-session"),
    });
    const { lifecycle, service } = makeLifecycle();
    mockIsRegisteredChild.mockReturnValue(true);
    lifecycle.activate(ctx);
    expect(mockPublishForSession).toHaveBeenCalledWith(
      "child-session",
      service,
    );
    expect(mockPublishPermissionsService).not.toHaveBeenCalled();
  });

  it("skips the keyed publication when the host exposes no session id", () => {
    const ctx = makeCtx({ sessionManager: makeSessionManager(null) });
    const { lifecycle } = makeLifecycle();
    lifecycle.activate(ctx);
    expect(mockPublishForSession).not.toHaveBeenCalled();
  });

  it("emits the node's session id and chain role on ready", () => {
    const ctx = makeCtx({ sessionManager: makeSessionManager("node-session") });
    const { lifecycle, events } = makeLifecycle();
    mockAdjudicatesLocally.mockReturnValue(false);
    lifecycle.activate(ctx);
    expect(mockEmitReadyEvent).toHaveBeenCalledWith(events, {
      sessionId: "node-session",
      adjudicatesLocally: false,
    });
  });

  it("emits a null session id when the host exposes none", () => {
    const ctx = makeCtx({ sessionManager: makeSessionManager(null) });
    const { lifecycle, events } = makeLifecycle();
    lifecycle.activate(ctx);
    expect(mockEmitReadyEvent).toHaveBeenCalledWith(events, {
      sessionId: null,
      adjudicatesLocally: true,
    });
  });
});

// ── announceReady (the ready latch) ───────────────────────────────────────

describe("announceReady", () => {
  it("emits the node's ready facts", () => {
    const ctx = makeCtx({ sessionManager: makeSessionManager("node-session") });
    const { lifecycle, events } = makeLifecycle();
    mockAdjudicatesLocally.mockReturnValue(false);
    lifecycle.announceReady(ctx);
    expect(mockEmitReadyEvent).toHaveBeenCalledWith(events, {
      sessionId: "node-session",
      adjudicatesLocally: false,
    });
  });

  it("announces only once per session", () => {
    const ctx = makeCtx();
    const { lifecycle } = makeLifecycle();
    lifecycle.activate(ctx);
    mockEmitReadyEvent.mockClear();
    lifecycle.announceReady(ctx);
    lifecycle.announceReady(ctx);
    lifecycle.announceReady(ctx);
    expect(mockEmitReadyEvent).toHaveBeenCalledOnce();
  });

  it("announces again after a further activate re-arms the latch", () => {
    const ctx = makeCtx();
    const { lifecycle } = makeLifecycle();
    lifecycle.activate(ctx);
    lifecycle.announceReady(ctx);
    lifecycle.activate(ctx);
    mockEmitReadyEvent.mockClear();
    lifecycle.announceReady(ctx);
    expect(mockEmitReadyEvent).toHaveBeenCalledOnce();
  });

  it("announces even when no activate preceded it", () => {
    const ctx = makeCtx();
    const { lifecycle, events } = makeLifecycle();
    lifecycle.announceReady(ctx);
    expect(mockEmitReadyEvent).toHaveBeenCalledWith(events, {
      sessionId: "test-session",
      adjudicatesLocally: true,
    });
  });

  it("recomputes the facts from the ctx it is handed", () => {
    const { lifecycle, events } = makeLifecycle();
    lifecycle.activate(
      makeCtx({ sessionManager: makeSessionManager("activated-session") }),
    );
    mockEmitReadyEvent.mockClear();
    lifecycle.announceReady(
      makeCtx({ sessionManager: makeSessionManager("latched-session") }),
    );
    expect(mockEmitReadyEvent).toHaveBeenCalledWith(events, {
      sessionId: "latched-session",
      adjudicatesLocally: true,
    });
  });
});

// ── teardown ──────────────────────────────────────────────────────────────

describe("teardown", () => {
  it("calls each subscription unsubscribe function", () => {
    const unsub1 = vi.fn();
    const unsub2 = vi.fn();
    const unsub3 = vi.fn();
    const { lifecycle } = makeLifecycle({
      subscriptions: [unsub1, unsub2, unsub3],
    });
    lifecycle.teardown();
    expect(unsub1).toHaveBeenCalledOnce();
    expect(unsub2).toHaveBeenCalledOnce();
    expect(unsub3).toHaveBeenCalledOnce();
  });

  it("unpublishes the service after running subscriptions", () => {
    const order: string[] = [];
    const unsub = vi.fn(() => order.push("unsub"));
    mockUnpublishPermissionsService.mockImplementation(() =>
      order.push("unpublish"),
    );
    const { lifecycle } = makeLifecycle({ subscriptions: [unsub] });
    lifecycle.teardown();
    expect(order).toEqual(["unsub", "unpublish"]);
  });

  it("passes the service to unpublishPermissionsService", () => {
    const { lifecycle, service } = makeLifecycle();
    lifecycle.teardown();
    expect(mockUnpublishPermissionsService).toHaveBeenCalledWith(service);
  });

  it("removes the keyed entry it published", () => {
    const ctx = makeCtx({ sessionManager: makeSessionManager("node-session") });
    const { lifecycle, service } = makeLifecycle();
    lifecycle.activate(ctx);
    lifecycle.teardown();
    expect(mockUnpublishForSession).toHaveBeenCalledWith(
      "node-session",
      service,
    );
  });

  it("removes the keyed entry of the session it last activated for", () => {
    const { lifecycle, service } = makeLifecycle();
    lifecycle.activate(
      makeCtx({ sessionManager: makeSessionManager("first-session") }),
    );
    lifecycle.activate(
      makeCtx({ sessionManager: makeSessionManager("second-session") }),
    );
    lifecycle.teardown();
    expect(mockUnpublishForSession).toHaveBeenCalledOnce();
    expect(mockUnpublishForSession).toHaveBeenCalledWith(
      "second-session",
      service,
    );
  });

  it("removes nothing keyed when it never published", () => {
    const { lifecycle } = makeLifecycle();
    lifecycle.teardown();
    expect(mockUnpublishForSession).not.toHaveBeenCalled();
  });

  it("works with no subscriptions", () => {
    const { lifecycle } = makeLifecycle({ subscriptions: [] });
    expect(() => lifecycle.teardown()).not.toThrow();
    expect(mockUnpublishPermissionsService).toHaveBeenCalledOnce();
  });
});
