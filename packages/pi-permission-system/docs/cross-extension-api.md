# Event API

The extension provides two cross-extension integration surfaces:

1. **Service accessor** (preferred) — a `Symbol.for()`-backed synchronous API on `globalThis` for direct policy queries.
2. **Event bus** — broadcasts and RPC on `pi.events` for observation and prompt forwarding.

---

## Service Accessor

The preferred way for other extensions to query the permission policy is the `Symbol.for()`-backed service accessor.
It provides direct, synchronous, type-safe function calls — no async RPC envelope needed.

### Quick Start

```typescript
try {
  const { getPermissionsService } = await import(
    "@gotgenes/pi-permission-system"
  );
  const permissions = getPermissionsService();
  if (permissions) {
    const result = permissions.checkPermission("bash", "git push");
    console.log(result.state); // "allow" | "deny" | "ask"
  }
} catch {
  // Not installed — graceful degradation
}
```

### How It Works

Pi's extension loader creates a fresh [jiti](https://github.com/nicolo-ribaudo/jiti) instance per extension with `moduleCache: false`, which isolates module-level state.
`Symbol.for()` and `globalThis` are process-global by spec, so they survive this isolation.

The permission-system extension publishes a service object on `globalThis` via `Symbol.for("@gotgenes/pi-permission-system:service")` at `session_start`.
Consumers call `getPermissionsService()` to retrieve it — even though their `import()` loads a fresh module copy, the accessor reads from the shared `globalThis` slot.
An in-process subagent child does not publish its own service; inside a child, `getPermissionsService()` resolves the parent's service.
A consumer reacting to the `permissions:ready` broadcast (also emitted at `session_start`, after the publish) can resolve the service immediately.

### API

The `PermissionsService` interface:

```typescript
interface PermissionsService {
  /** Query the permission policy for a surface and value. */
  checkPermission(
    surface: string,
    value?: string,
    agentName?: string,
  ): PermissionCheckResult;

  /** Query tool-level permission state for pre-filtering before session creation. */
  getToolPermission(toolName: string, agentName?: string): PermissionState;

  /**
   * Register a custom preview formatter for a specific tool name.
   * Returns a disposer that unregisters the formatter.
   * Throws if a formatter is already registered for that tool name.
   */
  registerToolInputFormatter(
    toolName: string,
    formatter: (input: Record<string, unknown>) => string | undefined,
  ): () => void;
}
```

#### `checkPermission`

| Parameter   | Required | Description                                                                              |
| ----------- | -------- | ---------------------------------------------------------------------------------------- |
| `surface`   | Yes      | Permission surface: `"bash"`, `"read"`, `"mcp"`, `"skill"`, `"external_directory"`, etc. |
| `value`     | No       | Value to evaluate (command, name, path); defaults to `""`                                |
| `agentName` | No       | Agent name for per-agent policy resolution                                               |

Returns `PermissionCheckResult` with fields `state`, `matchedPattern`, `source`, `origin`, etc.

#### `getToolPermission`

Returns `"allow"` | `"deny"` | `"ask"` for a tool name without considering command-level rules.
Use this to pre-filter a tool list before creating a child session — it avoids calling `checkPermission` per tool and interpreting the full result.

```typescript
const denied = tools.filter(
  (t) => permissions.getToolPermission(t, agentName) === "deny",
);
```

#### `registerToolInputFormatter`

Register a custom preview formatter for a specific tool name.
Permission ask-prompts call your formatter while building the prompt text, so you can show a human-readable summary of a tool call instead of the default truncated JSON.

```typescript
registerToolInputFormatter(
  toolName: string,
  formatter: (input: Record<string, unknown>) => string | undefined,
): () => void; // returns a disposer
```

Registration rules:

- One formatter per tool name.
  A second `register` for the same name throws — there is no silent override.
- The returned disposer unregisters the formatter.
  It is identity-guarded, so a stale disposer cannot evict a later registration of the same name.

##### Which tool name to key on

The `toolName` you register is matched against the **registered Pi tool name** the agent invoked — not against MCP server/tool pairs.

- For a tool your extension registers directly with Pi, use that tool's exact name (the same string Pi shows in `pi.getAllTools()`).
- For **MCP** calls, every server tool arrives as the single umbrella `"mcp"` tool, with the real target in `input.tool` (e.g. `"exa:search"`).
  You therefore cannot register a formatter per `server:tool`.
  The `"mcp"` name is already claimed by the built-in summarizer (below), and because duplicate registration throws, you cannot replace it.
  If you need richer per-server MCP previews, open an issue — that requires a chained-formatter model this seam does not yet provide.
- `"bash"` never reaches your formatter: bash prompts take a dedicated branch that shows the command directly.

##### What your formatter receives

The `input` argument is the raw tool-call input object exactly as the agent supplied it (the tool's arguments).
It is always a plain record; shapes by tool:

| Tool                   | `input` shape                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `mcp` (umbrella)       | `{ tool: "server:tool", server?, arguments?: object, … }` — summarize `input.arguments` |
| `read`                 | `{ path, offset?, limit? }`                                                             |
| `write`                | `{ path, content }`                                                                     |
| `edit`                 | `{ path, edits?: […] }` or `{ path, oldText, newText }`                                 |
| `grep` / `find` / `ls` | `{ pattern?, glob?, path? }`                                                            |
| your own tool          | whatever input schema your tool registered                                              |

Treat every field as untrusted: the agent can emit malformed or partial input, so read defensively (type-check before use) rather than assuming a shape.

##### What your return value does

The returned string is spliced into the middle of the prompt sentence:

```text
Agent 'Explore' requested tool 'deploy' <your fragment>. Allow this call?
```

Return a short grammatical fragment that reads naturally in that slot — e.g. `"with target staging (3 services)"` or `"runs 2 commands"`, not a full sentence and not raw JSON.

Return semantics:

- Return a **string** to use it verbatim as the preview (this also overrides the built-in preview for built-in tools like `read`/`edit`).
- Return **`undefined`** to decline — the prompt falls through to the built-in formatter for that tool, and finally to the truncated-JSON default.
  Prefer `undefined` over `""` when you have nothing useful to add: an empty string short-circuits the fallthrough and suppresses the default preview entirely.

##### Your formatter must not throw

The core does **not** wrap your formatter in a `try/catch`.
A thrown error propagates into prompt construction and can break the permission prompt — a denial-of-service on the gate.
Guard your own parsing and return `undefined` on anything unexpected.

##### End-to-end wiring

Register during your extension's initialization and store the disposer for teardown:

```typescript
export default function myExtension(pi: ExtensionAPI): void {
  let disposeFormatter: (() => void) | undefined;

  void (async () => {
    try {
      const { getPermissionsService } = await import(
        "@gotgenes/pi-permission-system"
      );
      const permissions = getPermissionsService();
      disposeFormatter = permissions?.registerToolInputFormatter(
        "deploy", // a tool THIS extension registers with Pi
        (input) => {
          const target =
            typeof input.target === "string" ? input.target : undefined;
          const services = Array.isArray(input.services)
            ? input.services.length
            : undefined;
          if (!target) return undefined; // decline → default preview
          return services !== undefined
            ? `with target ${target} (${services} services)`
            : `with target ${target}`;
        },
      );
    } catch {
      // permission-system not installed — nothing to register
    }
  })();

  pi.on("session_shutdown", () => {
    disposeFormatter?.();
    disposeFormatter = undefined;
  });
}
```

Reload note: on `/reload`, the permission-system publishes a fresh service backed by a new registry, so previous registrations are dropped.
Re-register on every initialization (as above) rather than once globally; the disposer is for explicit teardown within a single load.

##### Recommended practices

- Keep previews short — they appear inline in a yes/no prompt, and the result is truncated by the configured preview length anyway.
- Never surface secrets (tokens, keys, full request bodies) in a preview; summarize counts and identifiers instead.
- Parse defensively and return `undefined` on malformed input — never throw.
- Return a grammatical fragment, not raw JSON or a full sentence.
- Register idempotently on each extension load; dispose on `session_shutdown`.

##### Built-in MCP summarizer

A built-in formatter is registered for the `"mcp"` tool at startup (through this same public API).
It renders a compact `with key: value, …` summary of the call's `arguments` and returns `undefined` when there are no arguments, leaving the MCP target prompt unchanged.
This is the reference implementation for the seam — see `src/builtin-tool-input-formatters.ts`.

#### Subagent session registration

In-process subagent registration is event-driven.
`@gotgenes/pi-subagents` emits `subagents:child:session-created` before `bindExtensions()` and `subagents:child:disposed` in the run's `finally`; the permission system subscribes automatically — no service call from the spawner is required.
See [Subagent Integration](subagent-integration.md) for details.

### Reload Safety

During `/reload`, all extensions re-initialize.
The permission-system re-publishes a fresh service at `session_start`; teardown is identity-scoped, so a superseded generation's shutdown only clears the slot when it still owns it and cannot wipe the new service.
Consumers that re-initialize during reload naturally get the new instance.

Best practice: call `getPermissionsService()` per use rather than caching the reference.

### Graceful Degradation

`getPermissionsService()` returns `undefined` when the permission-system extension has not loaded (or has been unloaded).
The `import()` throws if the package is not installed.
Wrap both in `try/catch` + `if` guard as shown in the Quick Start example.

---

## Event Bus

The extension also emits events on Pi's `pi.events` bus so other extensions can observe permission decisions and integrate with the policy system without importing this package.

## Stability Guarantee

Fields may be added to any payload, but existing fields will not be removed or renamed without a semver-major version bump.
The protocol version constant is exported from `src/permission-events.ts` and embedded in every RPC reply.

## Channel Reference

| Channel                                    | Direction | When                              | Payload type                                      |
| ------------------------------------------ | --------- | --------------------------------- | ------------------------------------------------- |
| `permissions:ready`                        | Broadcast | At `session_start`, after publish | `PermissionsReadyEvent`                           |
| `permissions:ui_prompt`                    | Broadcast | Before active UI prompt           | `PermissionUiPromptEvent`                         |
| `permissions:decision`                     | Broadcast | After every gate resolution       | `PermissionDecisionEvent`                         |
| `permissions:rpc:check`                    | Request   | On-demand                         | `PermissionsCheckRequest`                         |
| `permissions:rpc:check:reply:<requestId>`  | Reply     | After each check request          | `PermissionsRpcReply<PermissionsCheckReplyData>`  |
| `permissions:rpc:prompt`                   | Request   | On-demand                         | `PermissionsPromptRequest`                        |
| `permissions:rpc:prompt:reply:<requestId>` | Reply     | After prompt is resolved          | `PermissionsRpcReply<PermissionsPromptReplyData>` |

---

## UI Prompt Broadcasts

The permission system emits `permissions:ui_prompt` immediately before it invokes the active user-facing permission UI.
This event is for integrations such as notification extensions that should alert only when the user needs to respond to a permission prompt.
It is not a generic "permission request entered waiting state" event, and it does not imply the prompt will be approved.
Policy decisions that resolve without an active UI prompt, such as `policy_allow`, `policy_deny`, `session_approved`, `infrastructure_auto_allowed`, or `auto_approved`, do not emit this event.
Non-UI child sessions also do not emit this event when they create a forwarded permission request; the parent UI session emits it immediately before showing the forwarded permission dialog.

```typescript
pi.events.on("permissions:ui_prompt", (raw) => {
  const event = raw as import("@gotgenes/pi-permission-system").PermissionUiPromptEvent;
  console.log(event.surface, event.value, event.message);
  // e.g. "bash" "git push" "Allow git push?"
});
```

### Payload Fields

| Field              | Type             | Description                                                                                                      |
| ------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `protocolVersion`  | `number`         | Cross-extension event protocol version                                                                           |
| `requestId`        | `string`         | Unique ID for the permission request being prompted                                                              |
| `source`           | `PermissionUiPromptSource` | Prompt source: `"tool_call"`, `"skill_input"`, `"skill_read"`, `"rpc_prompt"`, or `"forwarded_permission"` |
| `surface`          | `string \| null` | Permission surface being evaluated, when known                                                                   |
| `value`            | `string \| null` | Value being evaluated: command, path, skill name, tool target, etc.                                              |
| `agentName`        | `string \| null` | Active/requesting agent name when known                                                                          |
| `message`          | `string`         | Message displayed in the permission prompt                                                                       |
| `toolCallId`       | `string \| null` | Tool call ID when the prompt is for a tool call                                                                  |
| `toolName`         | `string \| null` | Tool name when the prompt is for a tool call                                                                     |
| `skillName`        | `string \| null` | Skill name when the prompt is for a skill request                                                                |
| `path`             | `string \| null` | Path being evaluated, when available                                                                             |
| `command`          | `string \| null` | Command being evaluated, when available                                                                          |
| `target`           | `string \| null` | Generic target being evaluated, when available                                                                   |
| `toolInputPreview` | `string \| null` | Tool input preview shown in logs/prompts, when available                                                         |
| `sessionLabel`     | `string \| null` | Override label for the "for this session" dialog option                                                          |

---

## Decision Broadcasts

Every permission gate resolution emits a `permissions:decision` event, regardless of outcome.
This is useful for dashboards, telemetry, or audit overlays.

```typescript
pi.events.on("permissions:decision", (raw) => {
  const event = raw as import("@gotgenes/pi-permission-system").PermissionDecisionEvent;
  console.log(event.surface, event.result, event.resolution);
  // e.g. "bash" "allow" "user_approved_for_session"
});
```

### Payload Fields

| Field            | Type                | Description                                                                               |
| ---------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| `surface`        | `string`            | Permission surface (`"bash"`, `"read"`, `"mcp"`, `"skill"`, `"external_directory"`, etc.) |
| `value`          | `string`            | Value evaluated (command, tool name, skill name, path)                                    |
| `result`         | `"allow" \| "deny"` | Final outcome                                                                             |
| `resolution`     | `string`            | How the outcome was reached (see table below)                                             |
| `origin`         | `string \| null`    | Config scope that contributed the winning rule                                            |
| `agentName`      | `string \| null`    | Active agent name when known                                                              |
| `matchedPattern` | `string \| null`    | Pattern from the winning rule                                                             |

### Resolution Values

| Value                         | Meaning                                                              |
| ----------------------------- | -------------------------------------------------------------------- |
| `policy_allow`                | Config rule said allow — no prompt shown                             |
| `policy_deny`                 | Config rule said deny — blocked immediately                          |
| `session_approved`            | Covered by a session-level approval from earlier in the same session |
| `infrastructure_auto_allowed` | Read of a Pi infrastructure path — auto-allowed                      |
| `user_approved`               | User approved once via dialog                                        |
| `user_approved_for_session`   | User approved for the rest of the session                            |
| `user_denied`                 | User denied via dialog                                               |
| `auto_approved`               | Yolo mode — approved automatically without dialog                    |
| `confirmation_unavailable`    | State was `ask` but no UI was available — blocked                    |

---

## Policy Query RPC (deprecated)

> **Deprecated**: prefer the [Service Accessor](#service-accessor) above.
> The event-bus RPC remains available as a zero-dependency fallback.

Other extensions can evaluate the current permission policy without importing this package.
The call is synchronous-style: emit a request, listen on a scoped reply channel.

```typescript
const requestId = crypto.randomUUID();

// Listen for the reply first
const unsub = pi.events.on(
  `permissions:rpc:check:reply:${requestId}`,
  (raw) => {
    unsub();
    const reply = raw as import("@gotgenes/pi-permission-system").PermissionsRpcReply<
      import("@gotgenes/pi-permission-system").PermissionsCheckReplyData
    >;
    if (reply.success) {
      console.log(reply.data?.result); // "allow" | "deny" | "ask"
    }
  },
);

// Then emit the request
pi.events.emit("permissions:rpc:check", {
  requestId,
  surface: "bash",
  value: "git push",
  agentName: "Worker", // optional
});
```

If the extension is not loaded, no reply arrives.
Callers should implement a timeout and treat no-reply as `deny` (graceful degradation).

### Request Fields

| Field       | Required | Description                                                |
| ----------- | -------- | ---------------------------------------------------------- |
| `requestId` | Yes      | Unique string; scopes the reply channel                    |
| `surface`   | Yes      | Permission surface to evaluate                             |
| `value`     | No       | Value to evaluate (command, name, path); defaults to `"*"` |
| `agentName` | No       | Agent name for per-agent policy resolution                 |

### Reply Data Fields (`PermissionsCheckReplyData`)

| Field            | Type                         | Description                                      |
| ---------------- | ---------------------------- | ------------------------------------------------ |
| `result`         | `"allow" \| "deny" \| "ask"` | Policy decision (including active session rules) |
| `matchedPattern` | `string \| null`             | Matched rule pattern                             |
| `origin`         | `string \| null`             | Config scope of the winning rule                 |

---

## Prompt Forwarding RPC

In-process child sessions (e.g. tintinweb/pi-subagents running via `createAgentSession()`) cannot use file-based permission forwarding because no child process is spawned.
They can instead forward permission prompts to the parent session's UI via this RPC.

```typescript
const requestId = crypto.randomUUID();

const unsub = pi.events.on(
  `permissions:rpc:prompt:reply:${requestId}`,
  (raw) => {
    unsub();
    const reply = raw as import("@gotgenes/pi-permission-system").PermissionsRpcReply<
      import("@gotgenes/pi-permission-system").PermissionsPromptReplyData
    >;
    if (reply.success && reply.data?.approved) {
      // proceed
    } else {
      // deny — either user denied or no UI was available (error: "no_ui")
    }
  },
);

pi.events.emit("permissions:rpc:prompt", {
  requestId,
  surface: "bash",
  value: "rm -rf /tmp/build",
  message: "Allow rm -rf /tmp/build?",
  agentName: "Explore",      // optional
  sessionLabel: "Allow rm *", // optional — label for the "for this session" option
});
```

The handler replies with `{ success: false, error: "no_ui" }` when no interactive session is available.

### Successful Reply Fields

| Field          | Type                | Description                                                                   |
| -------------- | ------------------- | ----------------------------------------------------------------------------- |
| `approved`     | `boolean`           | Whether the user approved                                                     |
| `state`        | `string`            | `"approved"`, `"approved_for_session"`, `"denied"`, or `"denied_with_reason"` |
| `denialReason` | `string` (optional) | User-provided denial reason                                                   |

---

## Ready Event

The extension emits `permissions:ready` at `session_start`, right after the service is published — so a consumer reacting to it can immediately resolve `getPermissionsService()`.
It fires once per `session_start` (including `/reload`).
Consumers that start after the extension can check via a ping-style RPC check — the `permissions:rpc:check` handler is active as long as the extension is loaded.

```typescript
pi.events.on("permissions:ready", (raw) => {
  const event = raw as import("@gotgenes/pi-permission-system").PermissionsReadyEvent;
  console.log("Permission system loaded, protocol version:", event.protocolVersion);
});
```
