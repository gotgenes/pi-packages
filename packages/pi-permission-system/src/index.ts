import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir, getPackageDir } from "@earendil-works/pi-coding-agent";
import { registerBuiltinToolInputFormatters } from "./builtin-tool-input-formatters";
import { registerPermissionSystemCommand } from "./config-modal";
import { getGlobalConfigPath } from "./config-paths";
import { ConfigStore } from "./config-store";
import { GateDecisionReporter } from "./decision-reporter";
import { computeExtensionPaths } from "./extension-paths";
import {
  PermissionForwarder,
  type PermissionForwarderDeps,
} from "./forwarded-permissions/permission-forwarder";
import { ForwardingManager } from "./forwarding-manager";
import {
  AgentPrepHandler,
  PermissionGateHandler,
  SessionLifecycleHandler,
} from "./handlers";
import { GateRunner } from "./handlers/gates/runner";
import { SkillInputGatePipeline } from "./handlers/gates/skill-input-gate-pipeline";
import { ToolCallGatePipeline } from "./handlers/gates/tool-call-gate-pipeline";
import { requestPermissionDecisionFromUi } from "./permission-dialog";
import { registerPermissionRpcHandlers } from "./permission-event-rpc";
import { PermissionManager } from "./permission-manager";
import { PermissionPrompter } from "./permission-prompter";
import { PermissionResolver } from "./permission-resolver";
import { PermissionSession } from "./permission-session";
import { LocalPermissionsService } from "./permissions-service";
import { PromptingGateway } from "./prompting-gateway";
import { PermissionServiceLifecycle } from "./service-lifecycle";
import { PermissionSessionLogger } from "./session-logger";
import { SessionRules } from "./session-rules";
import { subscribeSubagentLifecycle } from "./subagent-lifecycle-events";
import { getSubagentSessionRegistry } from "./subagent-registry";
import { ToolInputFormatterRegistry } from "./tool-input-formatter-registry";

export default function piPermissionSystemExtension(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  // getPackageDir() is Pi's own install dir; auto-allow it for read-only tools
  // so the agent can read Pi's bundled docs/examples regardless of layout.
  const paths = computeExtensionPaths(agentDir, getPackageDir());
  const permissionManager = new PermissionManager({ agentDir });
  const sessionRules = new SessionRules();
  const subagentRegistry = getSubagentSessionRegistry();
  const formatterRegistry = new ToolInputFormatterRegistry();
  registerBuiltinToolInputFormatters(formatterRegistry);

  // Both `configStore` and `session` are forward-declared so the logger's
  // lazy thunks can close over them without a cast or null-init holder.
  // TypeScript exempts closure captures from definite-assignment analysis;
  // all synchronous reads occur after the assignments below.
  // eslint-disable-next-line prefer-const -- forward-declared let; `const` requires an initializer
  let configStore: ConfigStore;
  // eslint-disable-next-line prefer-const -- forward-declared let; `const` requires an initializer
  let session: PermissionSession;

  const logger = new PermissionSessionLogger({
    globalLogsDir: paths.globalLogsDir,
    getConfig: () => configStore.current(),
    notify: (message) => session.notify(message),
  });

  configStore = new ConfigStore({
    agentDir,
    policyPaths: permissionManager,
    logger,
  });

  const forwardingDeps: PermissionForwarderDeps = {
    forwardingDir: paths.forwardingDir,
    subagentSessionsDir: paths.subagentSessionsDir,
    registry: subagentRegistry,
    events: pi.events,
    logger,
    requestPermissionDecisionFromUi,
    config: configStore,
  };
  const forwarder = new PermissionForwarder(forwardingDeps);

  const prompter = new PermissionPrompter({
    config: configStore,
    logger,
    events: pi.events,
    forwarder,
  });

  const gateway = new PromptingGateway({
    config: configStore,
    subagentSessionsDir: paths.subagentSessionsDir,
    registry: subagentRegistry,
    prompter,
  });

  session = new PermissionSession(
    paths,
    new ForwardingManager(
      paths.subagentSessionsDir,
      forwarder,
      subagentRegistry,
    ),
    permissionManager,
    sessionRules,
    configStore,
    gateway,
  );

  // refresh() must run after `session` is assigned: a debug-write IO failure
  // triggers the logger's notify sink — `session.notify(m)` — which no-ops
  // on the null context but requires `session` to be bound.
  configStore.refresh();

  const configPath = getGlobalConfigPath(agentDir);
  registerPermissionSystemCommand(pi, {
    config: configStore,
    configPath,
    permissionManager,
    session,
  });

  const rpcHandles = registerPermissionRpcHandlers(pi.events, {
    permissionManager,
    sessionRules,
    session,
    requestPermissionDecisionFromUi,
    logger,
  });

  const permissionsService = new LocalPermissionsService(
    permissionManager,
    sessionRules,
    formatterRegistry,
  );

  // Subscribe to @gotgenes/pi-subagents' child lifecycle events so child
  // sessions register/unregister without the core calling us (ADR 0002).
  const unsubSubagentLifecycle = subscribeSubagentLifecycle(
    pi.events,
    subagentRegistry,
  );

  // PermissionServiceLifecycle owns the process-global service publication:
  // activate() publishes (skipped for registered subagent children — see #302)
  // and emits ready; teardown() unsubscribes all session listeners and
  // unpublishes. Deferred to session_start because identifying a child
  // requires the session id from ctx, unavailable at factory-init time.
  const serviceLifecycle = new PermissionServiceLifecycle(
    permissionsService,
    subagentRegistry,
    pi.events,
    [rpcHandles.unsubCheck, rpcHandles.unsubPrompt, unsubSubagentLifecycle],
  );

  const toolRegistry = {
    getAll: () => pi.getAllTools(),
    getActive: () => pi.getActiveTools(),
    setActive: (names: string[]) => pi.setActiveTools(names),
  };

  const resolver = new PermissionResolver(permissionManager, sessionRules);

  const lifecycle = new SessionLifecycleHandler(
    session,
    resolver,
    serviceLifecycle,
    logger,
  );
  const agentPrep = new AgentPrepHandler(session, resolver, toolRegistry);

  const reporter = new GateDecisionReporter(logger, pi.events);
  const gateRunner = new GateRunner(resolver, sessionRules, gateway, reporter);
  const toolCallGatePipeline = new ToolCallGatePipeline(
    resolver,
    session,
    formatterRegistry,
  );
  const skillInputGatePipeline = new SkillInputGatePipeline(resolver);
  const gates = new PermissionGateHandler(
    session,
    toolRegistry,
    toolCallGatePipeline,
    skillInputGatePipeline,
    gateRunner,
  );

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
