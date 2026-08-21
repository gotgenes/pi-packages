import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir, getPackageDir } from "@earendil-works/pi-coding-agent";
import { warmBashParser } from "./access-intent/bash/parser";
import { buildResolvedIntentFromMatchValues } from "./access-intent/input-normalizer";
import {
  AuthorizerRegistry,
  ObservedAuthorizerRegistrar,
} from "./authority/authorizer-registry";
import { AuthorizerSelection } from "./authority/authorizer-selection";
import {
  ForwardedRequestServer,
  type ServingPolicy,
} from "./authority/forwarded-request-server";
import {
  ForwardingLivenessJudge,
  ServingHeartbeatStore,
} from "./authority/forwarding-liveness";
import { ForwardingManager } from "./authority/forwarding-manager";
import { PERMISSION_FORWARDING_TIMEOUT_MS } from "./authority/permission-forwarding";
import { requestPermissionDecision } from "./authority/permission-prompt-component";
import { PermissionPrompter } from "./authority/permission-prompter";
import {
  composeServingAnnouncers,
  getServingSessionRegistry,
} from "./authority/serving-registry";
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
  SessionTurnPrep,
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
import { resolveRenderBudget } from "./presentation/dialog-renderer";
import type { PermissionsService } from "./service";
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
  // Process-global, like subagentRegistry: an in-process child reads it from a
  // separate jiti instance to learn whether its parent is draining its inbox.
  const servingRegistry = getServingSessionRegistry();
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

  // Declared after the `configStore` forward declaration so the reader can
  // close over it; every call runs after configStore is assigned below. yolo is
  // a composition-stage ask→allow rewrite (#526) that the gate runner extends
  // to asks synthesized after resolution (#712), so both share this reader.
  const isYoloEnabled = (): boolean => isYoloModeEnabled(configStore.current());

  const permissionManager = new PermissionManager({
    agentDir,
    flavor: hostFlavor,
    isYoloEnabled,
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

  // The filesystem half of the serving announcement. `servingRegistry` reaches
  // an in-process child through `globalThis`; a child in its own process shares
  // nothing but this directory, so the served session publishes a heartbeat
  // there too (#721).
  const servingHeartbeats = new ServingHeartbeatStore({
    forwardingDir: paths.forwardingDir,
    logger,
  });
  // The read side of both channels, routed by how the target was resolved.
  const servingLiveness = new ForwardingLivenessJudge({
    registry: servingRegistry,
    heartbeats: servingHeartbeats,
  });

  const authorizerSelection = new AuthorizerSelection({
    detection: subagentDetection,
    events: pi.events,
    getPromptPreferences: () => ({
      doublePressToConfirm: configStore.current().doublePressToConfirm,
      budget: resolveRenderBudget(configStore.current()),
    }),
    requestPermissionDecision,
    forwardingDir: paths.forwardingDir,
    registry: subagentRegistry,
    serving: servingLiveness,
    getForwardingTimeoutMs: () =>
      configStore.current().forwardingTimeoutMs ??
      PERMISSION_FORWARDING_TIMEOUT_MS,
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

  // Constructed here rather than beside the gate runner below: the serving
  // side broadcasts its own decisions, so both readers share one reporter over
  // this session's event bus.
  const reporter = new GateDecisionReporter(logger, pi.events);

  const requestServer = new ForwardedRequestServer({
    forwardingDir: paths.forwardingDir,
    logger,
    policy: servingPolicy,
    escalator: authorizerSelection,
    // The forwarded ask's own gate lives in the requesting session, so the
    // serving side announces the terminal decision on this session's bus.
    broadcaster: reporter,
    // Records a whole-session grant into the same SessionRules the resolver and
    // gate runner read, so a serving-scope grant governs the parent and future
    // forwarded resolutions.
    recorder: sessionRules,
    registry: subagentRegistry,
  });

  session = new PermissionSession(
    paths,
    new ForwardingManager({
      detection: subagentDetection,
      forwarder: requestServer,
      serving: composeServingAnnouncers(servingRegistry, servingHeartbeats),
      logger,
    }),
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

  // Explicitly annotated to break a type-inference cycle: the selection's
  // `getPermissionQuery` thunk closes over this service, and the service's
  // registrar closes back over the selection. Both are resolved at call time
  // at runtime; `tsc` needs one of the two typed by hand to unwind them.
  const permissionsService: PermissionsService = new LocalPermissionsService(
    resolver,
    session,
    formatterRegistry,
    accessExtractorRegistry,
    // Sibling extensions register through the observing decorator, so a link
    // offered to a node whose chain never runs is accepted and recorded rather
    // than vanishing (ADR 0012 decision 4). Chain resolution keeps reading the
    // undecorated registry above.
    new ObservedAuthorizerRegistrar(
      authorizerRegistry,
      authorizerSelection,
      logger,
    ),
  );

  // Subscribe to @gotgenes/pi-subagents' child lifecycle events so child
  // sessions register/unregister without the core calling us (ADR 0002).
  const unsubSubagentLifecycle = subscribeSubagentLifecycle(
    pi.events,
    subagentRegistry,
  );

  // PermissionServiceLifecycle owns the process-global service publication:
  // activate() publishes this node's service under its own session id (and to
  // the legacy root slot unless this is a registered subagent child — see
  // #302), then announces the node's session id and chain role on the ready
  // channel; teardown() unsubscribes all session listeners and unpublishes.
  // Deferred to session_start because both facts come from ctx, unavailable at
  // factory-init time.
  const serviceLifecycle = new PermissionServiceLifecycle(
    permissionsService,
    subagentDetection,
    authorizerSelection,
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
  const turnPrep = new SessionTurnPrep(
    session,
    () => {
      void warmBashParser();
    },
    serviceLifecycle,
  );
  const agentPrep = new AgentPrepHandler(
    turnPrep,
    session,
    resolver,
    toolRegistry,
  );

  const gateRunner = new GateRunner(
    resolver,
    sessionRules,
    authorizerSelection,
    reporter,
    isYoloEnabled,
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
