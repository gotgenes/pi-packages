/**
 * pi-agents — A pi extension providing focused, in-process autonomous sub-agents.
 *
 * Tools:
 *   Agent             — LLM-callable: spawn a sub-agent
 *   get_subagent_result  — LLM-callable: check background agent status/result
 *   steer_subagent       — LLM-callable: send a steering message to a running agent
 *
 * Commands:
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionAPI,
  getAgentDir,
  ModelRuntime,
  type ResourceLoader,
  ModelRegistry as SdkModelRegistry,
  SettingsManager as SdkSettingsManager,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { AgentTypeRegistry } from "#src/config/agent-types";
import { loadCustomAgents } from "#src/config/custom-agents";
import { InterruptHandler, SessionLifecycleHandler, WidgetEventsHandler } from "#src/handlers/index";
import { createChildLifecyclePublisher } from "#src/lifecycle/child-lifecycle";
import { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import { createSubagentSession, type SubagentSessionDeps } from "#src/lifecycle/create-subagent-session";
import { SubagentManager } from "#src/lifecycle/subagent-manager";
import { CompositeSubagentObserver } from "#src/observation/composite-subagent-observer";
import {
  type NotificationDetails,
  NotificationManager,
  type UpdateDetails,
  type WorkspaceNoticeDetails,
} from "#src/observation/notification";
import {
  createNotificationRenderer,
  createUpdateRenderer,
  createWorkspaceNoticeRenderer,
} from "#src/observation/renderer";
import { SubagentEventsObserver } from "#src/observation/subagent-events-observer";
import { createSubagentRuntime } from "#src/runtime";
import { publishSubagentsService, unpublishSubagentsService } from "#src/service/service";
import { SubagentsServiceAdapter } from "#src/service/service-adapter";
import { detectEnv } from "#src/session/env";

import { resolveModel } from "#src/session/model-resolver";
import { createExcludedPackagesStorage } from "#src/session/package-exclusions";
import { buildAgentPrompt } from "#src/session/prompts";
import { inheritRegisteredProviders } from "#src/session/provider-inheritance";
import { deriveSubagentSessionDir } from "#src/session/session-dir";
import { SettingsManager } from "#src/settings";
import { AgentTool } from "#src/tools/agent-tool";
import { GetResultTool } from "#src/tools/get-result-tool";
import { SteerTool } from "#src/tools/steer-tool";
import { AgentWidget } from "#src/ui/agent-widget";
import { SessionNavigatorHandler } from "#src/ui/session-navigator";
import { SubagentsSettingsHandler } from "#src/ui/subagents-settings";

export default function (pi: ExtensionAPI) {
  // ---- Register custom notification renderer ----
  pi.registerMessageRenderer<NotificationDetails>("subagent-notification", createNotificationRenderer());
  pi.registerMessageRenderer<UpdateDetails>("subagent-update", createUpdateRenderer());
  pi.registerMessageRenderer<WorkspaceNoticeDetails>(
    "subagent-workspace-notice",
    createWorkspaceNoticeRenderer(),
  );

  const registry = new AgentTypeRegistry(() => loadCustomAgents(process.cwd()));

  // ---- Runtime: all mutable extension state in one place ----
  const runtime = createSubagentRuntime();

  // ---- Notification system ----
  // Owns completion nudges and live-activity cleanup. The widget detects finished
  // agents itself (AgentWidget.update self-seeds), so NotificationManager has no
  // widget dependency — keeping the construction graph a cycle-free DAG.
  const notifications = new NotificationManager(
    (msg, opts) => pi.sendMessage(msg, opts),
  );

  // Gate nudge delivery on the parent's agent run. agent_settled fires exactly
  // once per run (from a finally block, so it also covers error and abort),
  // whereas agent_end fires once per run segment — retries, auto-compaction and
  // followUp continuations each emit one.
  pi.on("agent_start", () => notifications.onParentAgentStart());
  pi.on("agent_settled", () => notifications.onParentAgentSettled());

  // Settings: owns all three in-memory values and handles load/save/emit.
  // onMaxConcurrentChanged is wired to the limiter directly (closure captures by reference).
  const settings = new SettingsManager({
    emit: (event, payload) => pi.events.emit(event, payload),
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    onMaxConcurrentChanged: () => limiter.recheck(),
  });
  settings.load();

  // Observer: receives agent lifecycle notifications and dispatches events/notifications.
  const eventsObserver = new SubagentEventsObserver({
    emit: (channel, data) => pi.events.emit(channel, data),
    appendEntry: (customType, data) => pi.appendEntry(customType, data),
    notifications,
  });

  // Fan-out observer: lets the widget subscribe as a second lifecycle consumer
  // while the manager keeps its single-observer contract. The widget is added
  // after construction (it needs the manager); the manager consults the observer
  // only at spawn time, so registering late is safe.
  const observer = new CompositeSubagentObserver([eventsObserver]);

  const subagentSessionDeps: SubagentSessionDeps = {
    io: {
      detectEnv,
      getAgentDir,
      createResourceLoader: (opts) => new DefaultResourceLoader(opts),
      deriveSessionDir: deriveSubagentSessionDir,
      createSessionManager: (cwd, dir) => SessionManager.create(cwd, dir),
      createSettingsManager: (cwd, dir) => SdkSettingsManager.create(cwd, dir),
      // The exclusion policy is resolved here, at the composition root, so the
      // assembly factory stays free of it and gets a ready-made settings view.
      createLoaderSettingsManager: (parent) => {
        const excluded = new Set(settings.excludedExtensionPackages);
        if (excluded.size === 0) return parent;
        return SdkSettingsManager.fromStorage(createExcludedPackagesStorage(parent, excluded), {
          projectTrusted: parent.isProjectTrusted(),
        });
      },
      // The factory states its collaborators as narrow structural contracts so
      // it can be tested with plain stubs. Here at the composition root the
      // values really are the SDK objects, so widen those three and let every
      // other option type-check against the SDK signature.
      createSession: async ({ sessionManager, resourceLoader, modelRegistry, ...rest }) => {
        // Pi builds the child a fresh ModelRuntime whenever it is not given
        // one, and runtime registrations live on the instance rather than in
        // models.json or auth.json — so the child would lose every provider the
        // parent registered via pi.registerProvider. Build the runtime here
        // instead and replay those registrations onto it. The child keeps its
        // own pool, so a child-loaded extension cannot mutate the parent's
        // (Refs #812). The path derivation mirrors the SDK's own.
        const childRuntime = await ModelRuntime.create({
          authPath: join(rest.agentDir, "auth.json"),
          modelsPath: join(rest.agentDir, "models.json"),
        });
        const childRegistry = new SdkModelRegistry(childRuntime);
        inheritRegisteredProviders(modelRegistry as SdkModelRegistry, {
          registerNative: (provider) => {
            childRegistry.registerProvider(provider);
          },
          registerConfigured: (id, config) => {
            childRegistry.registerProvider(id, config);
          },
        });
        return createAgentSession({
          ...rest,
          sessionManager: sessionManager as SessionManager,
          resourceLoader: resourceLoader as ResourceLoader,
          modelRuntime: childRuntime,
        });
      },
      assemblerIO: {
        buildAgentPrompt,
      },
    },
    exec: (cmd, args, opts) => pi.exec(cmd, args, opts),
    registry,
    lifecycle: createChildLifecyclePublisher((channel, data) => pi.events.emit(channel, data)),
  };

  // ConcurrencyLimiter: schedules background run thunks FIFO against the limit.
  // It knows nothing about agents or the manager — dependency direction is strictly manager → limiter.
  const limiter = new ConcurrencyLimiter(() => settings.maxConcurrent);

  const manager = new SubagentManager({
    createSubagentSession: (params) => createSubagentSession(params, subagentSessionDeps),
    baseCwd: process.cwd(),
    observer,
    limiter,
    getRunConfig: () => settings,
    getRetentionPolicy: () => settings,
    registry,
  });

  // Typed service published via Symbol.for() for cross-extension access.
  // Consumers: const { getSubagentsService } = await import("@gotgenes/pi-subagents");
  const service = new SubagentsServiceAdapter(manager, resolveModel, runtime);
  publishSubagentsService(service);

  const lifecycle = new SessionLifecycleHandler(
    runtime,
    manager,
    () => notifications.dispose(),
    unpublishSubagentsService,
  );

  // Live widget: constructed after the manager (it polls listAgents()) and
  // registered as a lifecycle observer so it self-drives its update timer.
  const widget = new AgentWidget(manager, registry);
  observer.add(widget);

  // Give the widget its UI context and its turn ticks. Pi fans an event out to
  // every handler an extension registers for it, so these take their own
  // registrations rather than sharing a lambda with an unrelated concern.
  const widgetEvents = new WidgetEventsHandler(widget);

  pi.on("session_start", (event, ctx) => lifecycle.handleSessionStart(event, ctx));
  pi.on("session_start", (event, ctx) => widgetEvents.handleSessionStart(event, ctx));
  pi.on("session_before_switch", () => lifecycle.handleSessionBeforeSwitch());
  pi.on("session_shutdown", () => lifecycle.handleSessionShutdown());
  // Registered after the lifecycle handler on purpose. Pi awaits an extension's
  // handlers for an event in registration order, so the widget is torn down once
  // `abortAll()` and the awaited `manager.dispose()` have finished — no terminal
  // transition is left to drive an `update()` at a half-disposed widget.
  pi.on("session_shutdown", () => widgetEvents.handleSessionShutdown());

  // Abort all subagents when the parent agent loop is interrupted (ESC), unless
  // the user has turned that policy off. The predicate is read at abort time.
  const interrupt = new InterruptHandler(manager, () => settings.abortAllOnInterrupt);
  pi.on("turn_start", (_event, ctx) => interrupt.handleTurnStart(ctx));
  pi.on("turn_start", () => widgetEvents.handleTurnStart());

  // ---- Agent tool ----

  pi.registerTool(new AgentTool(manager, runtime, settings, registry, getAgentDir()).toToolDefinition());

  // ---- get_subagent_result tool ----

  pi.registerTool(new GetResultTool(manager, registry).toToolDefinition());

  // ---- steer_subagent tool ----

  pi.registerTool(new SteerTool(manager, pi.events).toToolDefinition());

  // ---- /subagents:settings command ----

  const subagentsSettings = new SubagentsSettingsHandler(settings);

  pi.registerCommand("subagents:settings", {
    description: "Configure subagent settings (concurrency, turn limits, retention, interrupt policy)",
    handler: async (_args, ctx) => {
      await subagentsSettings.handle({ ui: ctx.ui });
    },
  });

  // ---- /subagents:sessions command ----

  const sessionNavigator = new SessionNavigatorHandler();

  pi.registerCommand("subagents:sessions", {
    description: "View a subagent's session transcript (read-only)",
    handler: async (_args, ctx) => {
      await sessionNavigator.handle({
        ui: ctx.ui,
        agents: manager.listAgents(),
        registry,
        cwd: ctx.cwd,
        readFile: (path) => readFileSync(path, "utf8"),
      });
    },
  });
}
