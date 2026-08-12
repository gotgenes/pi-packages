import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir, getPackageDir } from "@earendil-works/pi-coding-agent";
import { warmBashParser } from "./access-intent/bash/parser";
import { buildResolvedIntentFromMatchValues } from "./access-intent/input-normalizer";
import { AuthorizerRegistry } from "./authority/authorizer-registry";
import { AuthorizerSelection } from "./authority/authorizer-selection";
import {
  ForwardedRequestServer,
  type ServingPolicy,
} from "./authority/forwarded-request-server";
import { ForwardingManager } from "./authority/forwarding-manager";
import { requestPermissionDecision } from "./authority/permission-prompt-component";
import { PermissionPrompter } from "./authority/permission-prompter";
import { SubagentDetection } from "./authority/subagent-detection";
import { subscribeSubagentLifecycle } from "./authority/subagent-lifecycle-events";
import { getSubagentSessionRegistry } from "./authority/subagent-registry";
import { registerBuiltinToolInputFormatters } from "./builtin-tool-input-formatters";
import { registerPermissionSystemCommand } from "./config-modal";
import { getGlobalConfigPath } from "./config-paths";
import { ConfigStore } from "./config-store";
import { DecisionAudit } from "./decision-audit";
import { GateDecisionReporter } from "./decision-reporter";
import { isYoloModeEnabled } from "./extension-config";
import { computeExtensionPaths } from "./extension-paths";
import {
  AgentPrepHandler,
  PermissionGateHandler,
  SessionLifecycleHandler,
} from "./handlers";
import { GateRunner } from "./handlers/gates/runner";
import { SkillInputGatePipeline } from "./handlers/gates/skill-input-gate-pipeline";
import { ToolCallGatePipeline } from "./handlers/gates/tool-call-gate-pipeline";
import { createFailClosedToolCall } from "./handlers/tool-call-boundary";
import { pathFlavorForPlatform } from "./path/path-flavor";
import { PermissionManager } from "./permission-manager";
import { PermissionResolver } from "./permission-resolver";
import { PermissionSession } from "./permission-session";
import { LocalPermissionsService } from "./permissions-service";
import { PermissionServiceLifecycle } from "./service-lifecycle";
import { PermissionSessionLogger } from "./session-logger";
import { SessionRules } from "./session-rules";
import { ToolAccessExtractorRegistry } from "./tool-access-extractor-registry";
import { ToolInputFormatterRegistry } from "./tool-input-formatter-registry";

export default function piPermissionSystemExtension(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  // getPackageDir() is Pi's own install dir; auto-allow it for read-only tools
  // so the agent can read Pi's bundled docs/examples regardless of layout.
  const paths = computeExtensionPaths(agentDir, getPackageDir());
  // The single process.platform read for the whole extension, resolved once
  // into the path-language flavor that every consumer shares (the session's
  // PathNormalizer, rule evaluation, and subagent detection). Interior modules
  // must not read process.platform (enforced by the eslint guard scoped to
  // src/) and never re-derive the win32 flavor — they receive this product.
  const hostFlavor = pathFlavorForPlatform(process.platform);
  const sessionRules = new SessionRules();
  const subagentRegistry = getSubagentSessionRegistry();
  // Single owner of subagent detection, shared across every consumer instead of
  // threading the (subagentSessionsDir, platform, registry) triple into each.
  const subagentDetection = new SubagentDetection({
    subagentSessionsDir: paths.subagentSessionsDir,
    flavor: hostFlavor,
    registry: subagentRegistry,
  });
  const formatterRegistry = new ToolInputFormatterRegistry();
  registerBuiltinToolInputFormatters(formatterRegistry);
  const accessExtractorRegistry = new ToolAccessExtractorRegistry();
  // One registry instance backs both the registerAuthorizer service surface and
  // AuthorizerSelection's chain resolution, so a registration is visible to
  // composition.
  const authorizerRegistry = new AuthorizerRegistry();

  // Both `configStore` and `session` are forward-declared so the logger's
  // lazy thunks can close over them without a cast or null-init holder.
  // TypeScript exempts closure captures from definite-assignment analysis;
  // all synchronous reads occur after the assignments below.
  // eslint-disable-next-line prefer-const -- forward-declared let; `const` requires an initializer
  let configStore: ConfigStore;
  // eslint-disable-next-line prefer-const -- forward-declared let; `const` requires an initializer
  let session: PermissionSession;

  // Constructed after the `configStore` forward declaration so the yolo reader
  // can close over it; the closure runs per check(), after configStore is
  // assigned below. yolo becomes a composition-stage ask→allow rewrite (#526).
  const permissionManager = new PermissionManager({
    agentDir,
    flavor: hostFlavor,
    isYoloEnabled: () => isYoloModeEnabled(configStore.current()),
  });

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

  const prompter = new PermissionPrompter({ logger });

  const authorizerSelection = new AuthorizerSelection({
    detection: subagentDetection,
    events: pi.events,
    getPromptPreferences: () => ({
      doublePressToConfirm: configStore.current().doublePressToConfirm,
      overlay: configStore.current().overlay,
    }),
    requestPermissionDecision,
    forwardingDir: paths.forwardingDir,
    registry: subagentRegistry,
    logger,
    prompter,
    // The published service is the narrow, session-scoped PermissionQuery a
    // chain link is handed (it routes bash/path at gate parity against the live
    // session cwd). A thunk because `permissionsService` is constructed below;
    // it resolves at session_start (activate), well after assignment.
    getPermissionQuery: () => permissionsService,
    // Same registry instance the registerAuthorizer service surface writes to,
    // resolved in config order at activation.
    authorizerRegistry,
    getAuthorizerChain: () => configStore.current().authorizerChain ?? [],
  });

  // Resolver composes the manager + session ruleset and owns the
  // access-path → path-values unwrap. Constructed here (before `session`) so
  // the forwarded-request server's ServingPolicy can resolve against it; the
  // service and gates below share this one instance.
  const resolver = new PermissionResolver(permissionManager, sessionRules);

  // Serving a forwarded request is resolution: resolve the child-fixed
  // ForwardedAccessIntent (ADR 0008) directly against the serving node's
  // composed ruleset, agent-scoped to the requester (§3) — the match values
  // are used as fixed by the child, never re-derived through this session's
  // PathNormalizer/cwd (#597).
  const servingPolicy: ServingPolicy = {
    resolve: (intent) =>
      resolver.resolve(
        buildResolvedIntentFromMatchValues(
          intent.surface,
          intent.matchValues,
          intent.principal.agentName,
        ),
      ),
  };

  const requestServer = new ForwardedRequestServer({
    forwardingDir: paths.forwardingDir,
    logger,
    policy: servingPolicy,
    escalator: authorizerSelection,
    // Records a whole-session grant into the same SessionRules the resolver and
    // gate runner read, so a serving-scope grant governs the parent and future
    // forwarded resolutions.
    recorder: sessionRules,
    registry: subagentRegistry,
  });

  session = new PermissionSession(
    paths,
    new ForwardingManager(subagentDetection, requestServer),
    permissionManager,
    sessionRules,
    configStore,
    authorizerSelection,
    hostFlavor,
  );

  // refresh() must run after `session` is assigned: a debug-write IO failure
  // triggers the logger's notify sink — `session.notify(m)` — which no-ops
  // on the null context but requires `session` to be bound.
  // No ctx/trust decision exists at factory init, so withhold the project
  // scope (fail closed); session_start reloads with the real trust decision.
  configStore.refresh(undefined, false);

  const configPath = getGlobalConfigPath(agentDir);
  registerPermissionSystemCommand(pi, {
    config: configStore,
    configPath,
    getActiveAgentConfigRules: () =>
      permissionManager.getComposedConfigRules(
        session.lastKnownActiveAgentName ?? undefined,
      ),
  });

  const permissionsService = new LocalPermissionsService(
    resolver,
    session,
    formatterRegistry,
    accessExtractorRegistry,
    authorizerRegistry,
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
    subagentDetection,
    pi.events,
    [unsubSubagentLifecycle],
  );

  const toolRegistry = {
    getAll: () => pi.getAllTools(),
    getActive: () => pi.getActiveTools(),
    setActive: (names: string[]) => pi.setActiveTools(names),
  };

  const audit = new DecisionAudit();
  const lifecycle = new SessionLifecycleHandler(
    session,
    resolver,
    serviceLifecycle,
    logger,
    audit,
  );
  const agentPrep = new AgentPrepHandler(
    session,
    resolver,
    toolRegistry,
    () => {
      void warmBashParser();
    },
  );

  const reporter = new GateDecisionReporter(logger, pi.events);
  const gateRunner = new GateRunner(
    resolver,
    sessionRules,
    authorizerSelection,
    reporter,
  );
  const toolCallGatePipeline = new ToolCallGatePipeline(
    resolver,
    session,
    formatterRegistry,
    accessExtractorRegistry,
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
  pi.on("resources_discover", (event, ctx) =>
    lifecycle.handleResourcesDiscover(event, ctx),
  );
  pi.on("session_shutdown", () => lifecycle.handleSessionShutdown());
  pi.on("before_agent_start", (event, ctx) => agentPrep.handle(event, ctx));
  pi.on("input", (event, ctx) => gates.handleInput(event, ctx));
  pi.on(
    "tool_call",
    createFailClosedToolCall(
      (event, ctx) => gates.handleToolCall(event, ctx),
      reporter,
      audit,
      logger,
    ),
  );
}
