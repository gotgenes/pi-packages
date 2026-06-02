# PermissionPrompter

`src/permission-prompter.ts`

## Responsibility

`PermissionPrompter` owns the full permission-prompt flow for a single agent request:

1. **Yolo-mode check** — if `yoloMode` is enabled in the active config, auto-approve and write a `permission_request.auto_approved` review-log entry without showing any UI.
2. **Review log — waiting** — write `permission_request.waiting` before any dialog is shown.
3. **UI prompt broadcast** — build the `PermissionUiPromptEvent` once via `buildDirectUiPrompt(details)`.
   When `ctx.hasUI`, emit it on `permissions:ui_prompt` so observers (e.g. notification extensions) know the user must respond.
   A non-UI session does not emit here — the parent emits from the forwarded path instead.
4. **UI/forwarding branch** — delegate to `confirmPermission()` in `forwarded-permissions/polling.ts`, which selects the correct path:
   - `ctx.hasUI` → show the interactive dialog via `requestPermissionDecisionFromUi`.
   - subagent context → write a forwarded-permission request file (carrying the relayed display fields) and poll for the parent session's response.
   - neither → deny immediately.
   The prompter relays the built event's `source`/`surface`/`value` to `confirmPermission` so a forwarded request persists them and the parent emits a non-degraded event.
5. **Review log — outcome** — write `permission_request.approved` or `permission_request.denied` with the final decision state and any denial reason.

## Why a class instead of a free function

The previous implementation was `promptPermission(runtime, forwardingDeps, ctx, details)` in `runtime.ts`.
Adding a new field to `PromptPermissionDetails` (e.g. `sessionLabel` in #51) required touching four files: `types.ts` → `runtime.ts` → `polling.ts` → `index.ts`.

With `PermissionPrompter`, adding a new field touches two files:

- `src/handlers/types.ts` — add the field to `PromptPermissionDetails`.
- `src/permission-prompter.ts` — read the new field inside `prompt()`.

Handler code and wiring in `index.ts` are unaffected.

## Interfaces

```typescript
interface PermissionPrompterApi {
  prompt(ctx: ExtensionContext, details: PromptPermissionDetails): Promise<PermissionPromptDecision>;
}

interface PermissionPrompterDeps {
  getConfig(): PermissionSystemExtensionConfig;  // yolo-mode check
  writeReviewLog(event: string, details: Record<string, unknown>): void;
  subagentSessionsDir: string;                   // forwarding path detection
  forwardingDir: string;                         // forwarded-request files
  events: PermissionEventBus;                     // permissions:ui_prompt broadcast
  registry?: SubagentSessionRegistry;             // subagent detection + target resolution
  requestPermissionDecisionFromUi(...): Promise<PermissionPromptDecision>;
}
```

## Relationship to PermissionForwardingDeps

`PermissionPrompter` constructs a `PermissionForwardingDeps` internally when calling `confirmPermission()`.
The `shouldAutoApprove` field in that internal object always returns `false` — yolo-mode is already handled at the prompter level before `confirmPermission` is ever reached.

The separate `forwardingDeps` object in `index.ts` (used by `startForwardedPermissionPolling`) is independent: it carries its own `shouldAutoApprove` for the parent-session flow that processes requests forwarded from subagents.

## Wiring

`PermissionPrompter` is instantiated once in `piPermissionSystemExtension()` (`src/index.ts`) and injected into `PermissionSessionRuntimeDeps.promptPermission`:

```typescript
const prompter = new PermissionPrompter({ … });
// …
promptPermission: (ctx, details) => prompter.prompt(ctx, details),
```

Handler classes call `session.prompt(ctx, details)` which delegates to the injected prompter.
Tests mock `prompt` on the `PermissionSession` mock directly.
