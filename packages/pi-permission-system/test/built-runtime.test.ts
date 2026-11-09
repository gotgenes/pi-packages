import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as codingAgent from "@earendil-works/pi-coding-agent";
import * as tui from "@earendil-works/pi-tui";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SUBAGENT_ENV_HINT_KEYS } from "#src/authority/permission-forwarding";
import {
  getGlobalConfigPath,
  getGlobalLogsDir,
} from "#src/config/config-paths";
import { getPermissionsService } from "#src/service";
import {
  PERMISSIONS_DECISION_CHANNEL,
  type PermissionDecisionEvent,
} from "#src/service/permission-events";
import { makeCtx, makeToolCallEvent } from "#test/helpers/handler-fixtures";
import { makeFakePi } from "#test/helpers/make-fake-pi";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const nativeRequire = createRequire(import.meta.url);
type Factory = (pi: ExtensionAPI) => void;
let createExtension: (host: object) => Factory;
let agentDir: string;
let instances: ReturnType<typeof makeFakePi>[];

beforeAll(() => {
  execFileSync(process.execPath, [
    join(packageDir, "scripts/build-runtime.mjs"),
  ]);
  // Bypass Vitest's transforms: exercise the exact CJS artifact Node loads.
  createExtension = nativeRequire(
    join(packageDir, "dist/runtime.cjs"),
  ) as typeof createExtension;
}, 30000);

beforeEach(() => {
  instances = [];
  agentDir = mkdtempSync(join(tmpdir(), "pi-perm-built-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  for (const key of SUBAGENT_ENV_HINT_KEYS) vi.stubEnv(key, undefined);
  const config = getGlobalConfigPath(agentDir);
  mkdirSync(dirname(config), { recursive: true });
  writeFileSync(
    config,
    JSON.stringify({
      yoloMode: true,
      debugLog: false,
      permissionReviewLog: false,
      permission: {
        "*": "allow",
        write: "deny",
        grep: "ask",
        bash: { "*": "allow", "rm *": "deny" },
      },
    }),
  );
});

afterEach(async () => {
  for (const instance of instances) await instance.fire("session_shutdown");
  vi.restoreAllMocks();
  for (const slot of [
    "service",
    "session-services",
    "subagent-registry",
    "serving-registry",
  ]) {
    Reflect.deleteProperty(
      globalThis,
      Symbol.for(`@gotgenes/pi-permission-system:${slot}`),
    );
  }
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
});

async function start(toolNames?: readonly string[]) {
  const instance = makeFakePi({ toolNames });
  instances.push(instance);
  const factory = createExtension({
    "@earendil-works/pi-coding-agent": codingAgent,
    "@earendil-works/pi-tui": tui,
  });
  factory(instance as unknown as ExtensionAPI);
  const ctx = makeCtx({ cwd: agentDir });
  await instance.fire("session_start", { reason: "startup" }, ctx);
  return { instance, ctx, factory };
}

describe("native runtime artifact", () => {
  it("registers the gate lifecycle and publishes and removes the public service", async () => {
    const { instance } = await start();
    expect([...instance.handlers.keys()].toSorted()).toEqual([
      "before_agent_start",
      "input",
      "resources_discover",
      "session_shutdown",
      "session_start",
      "tool_call",
    ]);
    expect([...instance.commands.keys()]).toEqual(["permission-system"]);
    expect(
      getPermissionsService("test-session")?.checkPermission("write").state,
    ).toBe("deny");
    expect(existsSync(getGlobalLogsDir(agentDir))).toBe(false);
    await instance.fire("session_shutdown");
    expect(getPermissionsService("test-session")).toBeUndefined();
    instances = [];
  });

  it("retains allow, explicit deny, unknown-tool blocking and WASM-backed bash gates", async () => {
    const { instance, ctx } = await start();
    const call = (toolName: string, input: object) =>
      instance.fire(
        "tool_call",
        { toolName, toolCallId: "built-test", input },
        ctx,
      );
    expect(await call("read", { path: join(agentDir, "example.txt") })).toEqual(
      {},
    );
    expect(
      await call("write", {
        path: join(agentDir, "example.txt"),
        content: "x",
      }),
    ).toEqual({
      block: true,
      reason: "[pi-permission-system] Denied by policy: 'write' (rule '*').",
    });
    expect(await call("bash", { command: "pwd" })).toEqual({});
    expect(await call("bash", { command: "rm example.txt" })).toEqual({
      block: true,
      reason: expect.stringContaining("Denied by policy"),
    });
    expect(await call("unregistered", {})).toEqual({
      block: true,
      reason: expect.any(String),
    });
  });

  describe("authority and node isolation", () => {
    it("auto-approves a real ask under YOLO without invoking the dialog", async () => {
      const { instance, ctx } = await start();
      const decisions: PermissionDecisionEvent[] = [];
      instance.events.on(PERMISSIONS_DECISION_CHANNEL, (event) => {
        decisions.push(event as PermissionDecisionEvent);
      });
      expect(
        getPermissionsService("test-session")?.checkPermission("grep").origin,
      ).toBe("yolo");
      const outcome = await instance.fire(
        "tool_call",
        makeToolCallEvent("grep", {
          input: { path: agentDir, pattern: "example" },
        }),
        ctx,
      );
      expect(outcome).toEqual({});
      expect(ctx.ui.select).not.toHaveBeenCalled();
      expect(
        decisions
          .filter((event) => event.resolution === "auto_approved")
          .map((event) => ({
            surface: event.surface,
            result: event.result,
          })),
      ).toEqual([{ surface: "grep", result: "allow" }]);
    });

    it("blocks and emits gate_error when inspection throws, even under YOLO", async () => {
      const { instance, ctx } = await start();
      const decisions: PermissionDecisionEvent[] = [];
      instance.events.on(PERMISSIONS_DECISION_CHANNEL, (event) => {
        decisions.push(event as PermissionDecisionEvent);
      });
      vi.spyOn(instance, "getAllTools").mockImplementation(() => {
        throw new Error("broken tool registry");
      });
      const outcome = await instance.fire(
        "tool_call",
        makeToolCallEvent("read", {
          input: { path: agentDir },
        }),
        ctx,
      );
      expect(outcome).toEqual({
        block: true,
        reason:
          "Permission gate failed and blocked the tool call (fail-closed): broken tool registry",
      });
      expect(
        decisions.map((event) => ({
          resolution: event.resolution,
          result: event.result,
        })),
      ).toEqual([{ resolution: "gate_error", result: "deny" }]);
    });

    it("does not share a session approval between concurrent instances of the same native factory", async () => {
      writeFileSync(
        getGlobalConfigPath(agentDir),
        JSON.stringify({
          yoloMode: false,
          debugLog: false,
          permissionReviewLog: false,
          permission: { "*": "allow", demo: "ask" },
        }),
      );
      const { instance: first, ctx: firstCtx, factory } = await start(["demo"]);
      vi.mocked(firstCtx.ui.select).mockImplementation(
        async (_title, options) => options[1],
      );
      const outcome = await first.fire(
        "tool_call",
        makeToolCallEvent("demo"),
        firstCtx,
      );
      expect(outcome).toEqual({});
      expect(firstCtx.ui.select).toHaveBeenCalledTimes(1);
      expect(
        getPermissionsService("test-session")?.checkPermission("demo").state,
      ).toBe("allow");

      const second = makeFakePi({ toolNames: ["demo"] });
      instances.push(second);
      factory(second as unknown as ExtensionAPI);
      const secondCtx = makeCtx({ cwd: agentDir });
      vi.spyOn(secondCtx.sessionManager, "getSessionId").mockReturnValue(
        "second-session",
      );
      await second.fire("session_start", { reason: "startup" }, secondCtx);
      expect(
        getPermissionsService("second-session")?.checkPermission("demo").state,
      ).toBe("ask");
      expect(
        getPermissionsService("test-session")?.checkPermission("demo").state,
      ).toBe("allow");
      expect(getPermissionsService("second-session")).not.toBe(
        getPermissionsService("test-session"),
      );
    });
  });
});
