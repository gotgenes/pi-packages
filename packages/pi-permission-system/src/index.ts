import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPermissionSystemCommand } from "./config-modal";
import { getGlobalConfigPath } from "./config-paths";
import type { PermissionForwardingDeps } from "./forwarded-permissions/polling";
import { ForwardingManager } from "./forwarding-manager";
import {
  AgentPrepHandler,
  PermissionGateHandler,
  SessionLifecycleHandler,
} from "./handlers";
import { buildInputForSurface } from "./input-normalizer";
import { requestPermissionDecisionFromUi } from "./permission-dialog";
import { registerPermissionRpcHandlers } from "./permission-event-rpc";
import { emitReadyEvent } from "./permission-events";
import { PermissionPrompter } from "./permission-prompter";
import { PermissionSession } from "./permission-session";
import {
  createExtensionRuntime,
  logResolvedConfigPaths,
  refreshExtensionConfig,
  saveExtensionConfig,
} from "./runtime";
import type { PermissionsService } from "./service";
import {
  publishPermissionsService,
  unpublishPermissionsService,
} from "./service";
import { createSessionLogger } from "./session-logger";
import { isSubagentExecutionContext } from "./subagent-context";
import { SubagentSessionRegistry } from "./subagent-registry";
import {
  canResolveAskPermissionRequest,
  shouldAutoApprovePermissionState,
} from "./yolo-mode";

export default function piPermissionSystemExtension(pi: ExtensionAPI): void {
  const runtime = createExtensionRuntime();
  const subagentRegistry = new SubagentSessionRegistry();

  const prompter = new PermissionPrompter({
    getConfig: () => runtime.config,
    writeReviewLog: runtime.writeReviewLog.bind(runtime),
    subagentSessionsDir: runtime.subagentSessionsDir,
    forwardingDir: runtime.forwardingDir,
    registry: subagentRegistry,
    events: pi.events,
    requestPermissionDecisionFromUi,
  });

  const forwardingDeps: PermissionForwardingDeps = {
    forwardingDir: runtime.forwardingDir,
    subagentSessionsDir: runtime.subagentSessionsDir,
    registry: subagentRegistry,
    logger: {
      writeReviewLog: runtime.writeReviewLog.bind(runtime),
      writeDebugLog: runtime.writeDebugLog.bind(runtime),
    },
    writeReviewLog: runtime.writeReviewLog.bind(runtime),
    requestPermissionDecisionFromUi,
    shouldAutoApprove: () =>
      shouldAutoApprovePermissionState("ask", runtime.config),
  };

  refreshExtensionConfig(runtime);

  const session = new PermissionSession(
    runtime,
    createSessionLogger(runtime),
    new ForwardingManager(
      runtime.subagentSessionsDir,
      forwardingDeps,
      subagentRegistry,
    ),
    {
      refreshExtensionConfig: (ctx) => refreshExtensionConfig(runtime, ctx),
      logResolvedConfigPaths: () => logResolvedConfigPaths(runtime),
      getConfig: () => runtime.config,
      canRequestPermissionConfirmation: (ctx) =>
        canResolveAskPermissionRequest({
          config: runtime.config,
          hasUI: ctx.hasUI,
          isSubagent: isSubagentExecutionContext(
            ctx,
            runtime.subagentSessionsDir,
            subagentRegistry,
          ),
        }),
      promptPermission: (ctx, details) => prompter.prompt(ctx, details),
    },
  );

  registerPermissionSystemCommand(pi, {
    getConfig: () => runtime.config,
    setConfig: (next, ctx) => saveExtensionConfig(runtime, next, ctx),
    getConfigPath: () => getGlobalConfigPath(runtime.agentDir),
    getComposedRules: () =>
      runtime.permissionManager.getComposedConfigRules(
        runtime.lastKnownActiveAgentName ?? undefined,
      ),
  });

  const rpcHandles = registerPermissionRpcHandlers(pi.events, {
    getPermissionManager: () => runtime.permissionManager,
    getSessionRules: () => runtime.sessionRules.getRuleset(),
    getRuntimeContext: () => runtime.runtimeContext,
    requestPermissionDecisionFromUi,
    writeReviewLog: runtime.writeReviewLog.bind(runtime),
  });

  const permissionsService: PermissionsService = {
    checkPermission(surface, value, agentName) {
      const input = buildInputForSurface(surface, value);
      const sessionRules = runtime.sessionRules.getRuleset();
      return runtime.permissionManager.checkPermission(
        surface,
        input,
        agentName,
        sessionRules,
      );
    },
    registerSubagentSession(sessionKey, info) {
      subagentRegistry.register(sessionKey, info);
    },
    unregisterSubagentSession(sessionKey) {
      subagentRegistry.unregister(sessionKey);
    },
    getToolPermission(toolName, agentName) {
      return runtime.permissionManager.getToolPermission(toolName, agentName);
    },
  };
  publishPermissionsService(permissionsService);

  emitReadyEvent(pi.events);

  const toolRegistry = {
    getAll: () => pi.getAllTools(),
    setActive: (names: string[]) => pi.setActiveTools(names),
  };

  const lifecycle = new SessionLifecycleHandler(session, () => {
    rpcHandles.unsubCheck();
    rpcHandles.unsubPrompt();
    unpublishPermissionsService();
  });
  const agentPrep = new AgentPrepHandler(session, toolRegistry);
  const gates = new PermissionGateHandler(session, pi.events, toolRegistry);

  pi.on("session_start", (event, ctx) =>
    lifecycle.handleSessionStart(event, ctx),
  );
  pi.on("resources_discover", (event) =>
    lifecycle.handleResourcesDiscover(event),
  );
  pi.on("session_shutdown", () => lifecycle.handleSessionShutdown());
  pi.on("before_agent_start", (event, ctx) => agentPrep.handle(event, ctx));
  pi.on("input", (event, ctx) => gates.handleInput(event, ctx));
  pi.on("tool_call", (event, ctx) => gates.handleToolCall(event, ctx));
}
