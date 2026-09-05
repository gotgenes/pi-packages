import { z } from "zod";

/**
 * Single source of truth for the permission-system config file shape.
 *
 * These composable zod schemas drive two consumers:
 * 1. Runtime validation in the config-file loader (`config-loader.ts`).
 * 2. The published JSON Schema (`schemas/permissions.schema.json`), derived by
 *    `buildPermissionsJsonSchema()` and regenerated via `pnpm run gen:schema`.
 *
 * Edit the schemas here — never the generated JSON by hand. A parity test
 * (`config-schema.test.ts`) fails if the committed JSON drifts from this source.
 */

/** Canonical hosted location of the generated JSON Schema (monorepo raw path). */
export const PERMISSIONS_SCHEMA_URL =
  "https://raw.githubusercontent.com/gotgenes/pi-packages/main/packages/pi-permission-system/schemas/permissions.schema.json";

const permissionStateSchema = z
  .union([
    z.literal("allow").meta({
      description: "Permit the action silently with no user interaction.",
    }),
    z.literal("deny").meta({
      description:
        "Block the action with an error message. The agent is told not to retry.",
    }),
    z.literal("ask").meta({
      description:
        "Prompt the user for confirmation via the interactive UI before proceeding.",
    }),
  ])
  .meta({
    id: "permissionState",
    description:
      "A permission decision: allow (permit silently), deny (block with error), or ask (prompt the user for confirmation).",
  });

const denyWithReasonSchema = z
  .strictObject({
    action: z.literal("deny").meta({
      description: 'The permission decision — must be "deny".',
    }),
    reason: z.string().max(500).optional().meta({
      description:
        "Optional reason shown to the agent when this action is denied.",
    }),
  })
  .meta({
    id: "denyWithReason",
    description:
      "Deny with an optional custom reason shown to the agent when the action is blocked.",
  });

const patternValueSchema = z.union([
  permissionStateSchema,
  denyWithReasonSchema,
]);

const permissionMapSchema = z
  .record(
    z.string().min(1).meta({
      description:
        "A non-empty pattern string. Use * for wildcard matching. Prefix with ~/ or $HOME/ for home-relative paths.",
    }),
    patternValueSchema,
  )
  .meta({
    id: "permissionMap",
    description:
      "A map of wildcard patterns to permission states. Last matching pattern wins.",
    markdownDescription:
      "A map of wildcard patterns to permission states.\n\nUse `*` for wildcard matching. When multiple patterns match, the **last matching rule wins** — put broad catch-alls first and specific overrides after them.\n\nPattern keys support home directory expansion:\n- `~/path` or `$HOME/path` — expanded to the OS home directory at match time.\n- `~` or `$HOME` alone — expands to the home directory itself.\n\nThe stored pattern is always shown in logs and approval dialogs as written (e.g. `~/dev/*`).",
  });

const surfaceValueSchema = z.union([
  permissionStateSchema,
  permissionMapSchema,
]);

/**
 * The legal spellings of a directional surface key (ADR 0013 §3).
 *
 * This is the loader's allowlist — {@link rejectUnusableSurfaceKeys} rejects a
 * key shaped like a directional surface that is not one of these — and the
 * schema documents exactly these four as named properties. Nothing structural
 * holds the two halves together, so a test in `config-schema.test.ts` does.
 */
const DIRECTIONAL_SURFACE_KEYS = [
  "path_read",
  "path_write",
  "external_directory_read",
  "external_directory_write",
] as const;

/**
 * One documented, optional property for a well-known permission surface.
 *
 * A named property is what an editor completes and hovers; the enclosing
 * object's `.catchall(...)` is what keeps every other tool name valid. Each
 * surface's prose lives here rather than on the object, so a reader gets the
 * key under their cursor and not all nine of its neighbours.
 */
function surfaceProperty(meta: {
  description: string;
  markdownDescription: string;
}) {
  return surfaceValueSchema.optional().meta(meta);
}

const permissionSchema = z
  .object({
    "*": surfaceProperty({
      description:
        "Universal fallback — the action used when no surface-specific rule matches. Omitted, it defaults to ask.",
      markdownDescription:
        'Universal fallback — the action used when **no** surface-specific rule matches.\n\n`{ "*": "ask" }` is the least-privilege posture, and is what an omitted `"*"` means anyway. It replaces `defaultPolicy.tools` from the legacy config format.\n\nA surface-specific rule always beats it, whatever the key order in the file.',
    }),
    path: surfaceProperty({
      description:
        "Cross-cutting gate for file access by path pattern, across every path-aware tool. Sugar for both directions.",
      markdownDescription:
        "Cross-cutting gate that applies to **all** file access: Pi tools, bash commands, MCP calls (via `input.arguments.path`), and extension tools (via `input.path` or a registered access extractor).\n\nA `path` deny cannot be overridden by a per-tool allow. Use it to protect sensitive files (`.env`, `~/.ssh/*`) from every path-aware tool at once.\n\nThis bare key is **sugar**: it expands at load into `path_read` and `path_write`, its entries placed first, so an explicit directional entry always has the final say whatever the key order in the file.",
    }),
    path_read: surfaceProperty({
      description:
        "Cross-cutting gate for reading a file, by path pattern. The useful directional grant.",
      markdownDescription:
        'Cross-cutting gate for **reading** a file, matched by path pattern across all path-aware tools.\n\nThis is the directional key worth granting: `"path_read": { "~/dev/*": "allow" }` permits reads without permitting writes.\n\nA bare `"path"` key is sugar that expands into this key **and** `path_write`, with its entries placed first — so an explicit `path_read` entry always has the final say, whatever the key order in the file.',
    }),
    path_write: surfaceProperty({
      description:
        "Cross-cutting gate for writing a file, by path pattern. Earns its keep as a restriction.",
      markdownDescription:
        'Cross-cutting gate for **writing** a file, matched by path pattern across all path-aware tools.\n\nThis key earns its keep as a *restriction* rather than a grant: `"path_write": { "*": "deny" }` is a coherent read-only-agent posture. A `"path_write": "allow"` on its own does not silence an `edit`, which also reads — grant `path_read` too, or use the bare `"path"` key.',
    }),
    external_directory: surfaceProperty({
      description:
        "Boundary gate for access outside the session working directory. Sugar for both directions.",
      markdownDescription:
        'Boundary gate for access **outside** the session working directory.\n\nGive it a pattern map to allow specific outside-CWD directories without opening all external access — e.g. `{ "*": "ask", "~/.cargo/registry/*": "allow" }` to silence repeated prompts on a local cache. The trailing `*` is greedy and crosses subdirectory boundaries; a bare `~/.cargo/registry` matches only the directory entry itself.\n\nBecause layers compose with most-restrictive-wins, a `path` allow cannot loosen an `external_directory: ask` boundary — allow outside-CWD directories here, not on `path`.\n\nThis bare key is **sugar**: it expands at load into `external_directory_read` and `external_directory_write`, its entries placed first.',
    }),
    external_directory_read: surfaceProperty({
      description:
        "Boundary gate for reading outside the working directory. The relief most asks want.",
      markdownDescription:
        'Boundary gate for **reading** a path outside the session working directory.\n\nThe one-line grant for an external root: `"external_directory_read": { "~/dev/*": "allow" }` silences repeated read prompts on a directory outside the tree while a write to the same path still prompts. No parallel `path_read` entry is needed.',
    }),
    external_directory_write: surfaceProperty({
      description: "Boundary gate for writing outside the working directory.",
      markdownDescription:
        'Boundary gate for **writing** to a path outside the session working directory.\n\nA bare `"external_directory"` key is sugar that expands into this key and `external_directory_read`; write this one only to give the two directions different answers.',
    }),
    bash: surfaceProperty({
      description:
        "Shell command execution, matched per top-level command in a chain. Most restrictive wins.",
      markdownDescription:
        "Shell command execution, matched by **command pattern**.\n\nA chain (`&&`, `||`, `;`, `|`, newline) is split into its top-level commands and each is matched independently, most-restrictive-wins — so `cd /repo && npm install x` is denied when `npm *` is. A command nested in a substitution, process substitution, or subshell is matched too, since it really runs.\n\nA leading env-var assignment is stripped before matching (`AWS_PROFILE=prod aws …` matches `aws *`), and a pattern ending in ` *` (space + wildcard) also matches the bare command (`git *` matches `git`). A pattern containing a chain operator never matches — write one pattern per command.\n\nA shell wrapper (`bash -c`, `eval`, `sudo`, `xargs`) is floored from `allow` to `ask`, so an opaque payload cannot ride a permissive rule.",
    }),
    mcp: surfaceProperty({
      description:
        "Registered MCP proxy tools, matched against targets derived from the tool input.",
      markdownDescription:
        "Registered MCP proxy tools, matched against targets derived from the tool input: a baseline op (`mcp_status`, `mcp_list`, `mcp_search`, `mcp_describe`, `mcp_connect`), a server name (`myServer`), a server/tool combination (`myServer:search`, `myServer_search`), or the generic `mcp_call`.\n\nBaseline discovery targets auto-allow whenever any explicit `mcp` allow rule exists.",
    }),
    skill: surfaceProperty({
      description:
        "Skill invocation, matched by skill name. The surface is `skill`, not `skills`.",
      markdownDescription:
        'Skill invocation, matched by skill name — the surface is `skill`, not `skills`.\n\nWildcards behave as everywhere else: `{ "*": "ask", "dangerous-*": "deny", "librarian": "allow" }`.',
    }),
  })
  .catchall(surfaceValueSchema)
  .meta({
    description:
      "Flat permission policy. Each key is a surface name; values are a PermissionState string (catch-all) or a pattern→action map.",
    markdownDescription:
      'Flat permission policy.\n\nEach top-level key is a surface: the `"*"` fallback, a well-known surface documented below, or any registered tool name.\n\nA **string** value is shorthand for `{ "*": action }` (a surface-level catch-all).\nAn **object** value maps wildcard patterns to actions — last matching pattern wins.\n\nFor built-in file tools (`read`, `write`, `edit`, `find`, `grep`, `ls`), patterns are matched against the file path from `input.path`. For example, `"read": { "*": "allow", "*.env": "deny" }` allows reads but denies `.env` files.\n\nWhen Pi\'s current working directory is known, relative path inputs also match their cwd-normalized absolute form, so `src/App.jsx` can match both `src/*` and `/workspace/project/*`. Bash path tokens use the effective directory after literal `cd` commands for this matching; non-literal `cd "$DIR"` style commands remain conservative.\n\n**Merge order (lowest → highest precedence):** global → project → per-agent frontmatter.',
    examples: [
      {
        "*": "ask",
        path: {
          "*": "allow",
          "*.env": "deny",
          "*.env.*": "deny",
          "*.env.example": "allow",
        },
        read: "allow",
        write: "deny",
        edit: "deny",
        bash: {
          "*": "ask",
          "git *": "ask",
          "git status": "allow",
          "git diff": "allow",
        },
        mcp: { "*": "ask", mcp_status: "allow", "exa:*": "allow" },
        skill: { "*": "ask", librarian: "allow" },
        external_directory: { "*": "ask", "~/.cargo/registry/*": "allow" },
        external_directory_read: { "~/dev/*": "allow" },
      },
    ],
  })
  .superRefine(rejectUnusableSurfaceKeys);

/**
 * Reject the two surface-key spellings that would otherwise sit inert.
 *
 * Neither check serializes into the JSON Schema, so an editor will not flag
 * them; the loader will, fail-closed, with the offending key named.
 *
 * 1. A key shaped like a directional surface but misspelled
 *    (`path_wrote`, `external_directory_reed`). A typo in a *grant* fails safe
 *    — the rule never fires and the user just gets more prompts — but a typo
 *    in a *restriction* fails **open**: `path_wrote: {"*": "deny"}` enforces
 *    nothing at all. The false-positive population is an extension tool
 *    literally named `path_*` or `external_directory_*`.
 * 2. An empty key, which `.catchall()` no longer rejects on its own the way
 *    the record form's `propertyNames: {minLength: 1}` did.
 */
function rejectUnusableSurfaceKeys(
  permission: Record<string, unknown>,
  ctx: z.core.$RefinementCtx,
): void {
  const legalDirectionalKeys: readonly string[] = DIRECTIONAL_SURFACE_KEYS;
  for (const key of Object.keys(permission)) {
    if (key === "") {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: "A surface key must not be empty.",
      });
      continue;
    }
    if (
      /^(path|external_directory)_/.test(key) &&
      !legalDirectionalKeys.includes(key)
    ) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `Unknown directional surface key "${key}". The legal spellings are ${legalDirectionalKeys.join(", ")}.`,
      });
    }
  }
}

const shellToolAliasSchema = z
  .strictObject({
    commandArgument: z.string().min(1).meta({
      description:
        "The name of the tool's input argument holding the shell command string (e.g. 'cmd').",
    }),
    workdirArgument: z.string().min(1).optional().meta({
      description:
        "Optional name of the tool's input argument holding the working directory (e.g. 'workdir').",
    }),
  })
  .meta({
    description:
      "Maps one shell-aliased tool to the input arguments holding its command and (optionally) its working directory.",
  });

const shellToolsSchema = z
  .record(
    z.string().min(1).meta({
      description: "A non-bash tool name that carries shell semantics.",
    }),
    shellToolAliasSchema,
  )
  .meta({
    description:
      "Maps non-bash tool names that carry shell semantics to the input arguments holding their command and working directory.",
    markdownDescription:
      'Records which non-`bash` tools carry shell semantics, mapping each tool name to the input argument holding its command (and optionally its working directory).\n\nUse this when an extension replaces the native `bash` tool under a different name — e.g. `@howaboua/pi-codex-conversion` registers `exec_command` with a `cmd` argument and an optional `workdir`. Recording the alias lets the permission system gate that tool through the same bash enforcement stack as native `bash` (command decomposition, wrapper flooring, path/external-directory token gates, and `bash:` rules).\n\nExample:\n\n```json\n"shellTools": {\n  "exec_command": { "commandArgument": "cmd", "workdirArgument": "workdir" }\n}\n```\n\n**Merge order:** shallow-merge by tool name across global → project. A project entry overrides a specific tool\'s mapping on key collision but never drops a global entry.',
    examples: [
      {
        exec_command: { commandArgument: "cmd", workdirArgument: "workdir" },
      },
    ],
  });

/**
 * The on-disk config file shape.
 *
 * Every field is optional so partial global/project configs merge before the
 * runtime defaults are applied downstream (`normalizePermissionSystemConfig`).
 * No `.default()` lives here — injecting defaults at parse time would break the
 * global-vs-project override semantics. `strictObject` makes unknown top-level
 * keys an error, so editors flag typos and the runtime loader rejects them.
 */
export const unifiedConfigSchema = z
  .strictObject({
    $schema: z.string().optional().meta({
      description: "JSON Schema URI for editor autocomplete and validation.",
    }),
    debugLog: z.boolean().optional().meta({
      description:
        "Write verbose permission-system diagnostics to the extension logs directory.",
      markdownDescription:
        "Write verbose permission-system diagnostics to `logs/pi-permission-system-debug.jsonl` under the extension config directory.",
      default: false,
    }),
    permissionReviewLog: z.boolean().optional().meta({
      description:
        "Write permission request and decision audit events to the extension logs directory.",
      markdownDescription:
        "Write permission request and decision audit events to `logs/pi-permission-system-permission-review.jsonl` under the extension config directory.",
      default: true,
    }),
    yoloMode: z.boolean().optional().meta({
      description:
        "Auto-approve ask-state permission checks, including subagent approval forwarding.",
      markdownDescription:
        "Auto-approve `ask`-state permission checks, including subagent approval forwarding.\n\n⚠️ **Use with caution** — this disables all interactive confirmation prompts.",
      default: false,
    }),
    doublePressToConfirm: z.boolean().optional().meta({
      description:
        "Require a confirming second press of a decision hotkey in the inline permission dialog. Applies to TUI sessions only.",
      markdownDescription:
        "Require a confirming second press of a decision hotkey (`y`/`s`/`n`/`r`) in the inline permission dialog before it commits — the first press arms the action and shows a `Press y again to approve.` hint.\n\nApplies to interactive **TUI** sessions only; the non-TUI (RPC/frontend) prompt keeps its single-select flow. Set to `false` to commit decisions on the first hotkey press.",
      default: true,
    }),
    forwardingTimeoutMs: z.number().int().min(1).optional().meta({
      description:
        "How long a subagent waits for the parent session to answer a forwarded permission request, in milliseconds. Omit to use the default (600000, ten minutes).",
      markdownDescription:
        "How long a subagent waits for the parent session to answer a forwarded permission request, in milliseconds.\n\nOmit to use the default (`600000`, ten minutes). A child whose in-process parent is not draining its inbox at all gives up in a couple of seconds regardless of this value, so lower it only to bound how long you are willing to leave an *unanswered* prompt pending.",
      default: 600000,
    }),
    promptMaxRows: z.number().int().min(1).optional().meta({
      description:
        "Maximum rows a permission prompt renders before eliding its evidence. Omit to use the default (24).",
      markdownDescription:
        "Maximum rows a permission prompt renders before eliding its evidence.\n\nOmit to use the default (24). The request's own facts — the requesting agent, the tool, the matched rule, the decision-relevant value — are never elided by this budget; what gives way is the supporting evidence, and `Ctrl+O` expands the prompt to the complete request.",
      default: 24,
    }),
    promptFieldMaxWidth: z.number().int().min(1).optional().meta({
      description:
        "Maximum characters of any one field shown in a permission prompt. Omit to use the default (400).",
      markdownDescription:
        "Maximum characters of any one field shown in a permission prompt.\n\nOmit to use the default (400). This is what bounds a single pathological field — a long here-string command, say — that would otherwise fill the prompt through wrapping. A shortened field is marked with an ellipsis, and `Ctrl+O` shows it in full.",
      default: 400,
    }),
    reviewLogFieldMaxWidth: z.number().int().min(1).optional().meta({
      description:
        "Maximum characters of any one value written to the permission review log. Omit to use the default (1000).",
      markdownDescription:
        "Maximum characters of any one value written to the permission review log.\n\nOmit to use the default (1000). Every string the review log writes is narrowed to this width and marked with an ellipsis, so the log's growth is a decision you make rather than a side effect of how long a command happened to be. Raise it to keep longer values \u2014 a bash command exceeding the width is stored shortened.\n\nThis is a length bound, not redaction: it never inspects a value to decide what to hide. Key-name masking is unchanged and applies independently.",
      default: 1000,
    }),
    toolInputPreviewMaxLength: z.number().int().min(1).optional().meta({
      deprecated: true,
      description:
        "Deprecated and ignored. Superseded by promptMaxRows and promptFieldMaxWidth, which bound the whole prompt rather than one preview. Still accepted so an existing config is not rejected; remove it.",
      markdownDescription:
        "**Deprecated and ignored.** Superseded by `promptMaxRows` and `promptFieldMaxWidth`, which bound the whole permission prompt rather than one preview inside it.\n\nStill accepted so an existing config is not rejected fail-closed, but the value no longer takes effect. Remove it.",
    }),
    toolTextSummaryMaxLength: z.number().int().min(1).optional().meta({
      deprecated: true,
      description:
        "Deprecated and ignored. Superseded by promptMaxRows and promptFieldMaxWidth, which bound the whole prompt rather than one summary. Still accepted so an existing config is not rejected; remove it.",
      markdownDescription:
        "**Deprecated and ignored.** Superseded by `promptMaxRows` and `promptFieldMaxWidth`, which bound the whole permission prompt rather than one summary inside it.\n\nStill accepted so an existing config is not rejected fail-closed, but the value no longer takes effect. Remove it.",
    }),
    piInfrastructureReadPaths: z.array(z.string().min(1)).optional().meta({
      description:
        "Additional directories to auto-allow for reads as Pi infrastructure, bypassing the external_directory gate. Supports ~ expansion and wildcard patterns (* and ?).",
      markdownDescription:
        "Additional directories to auto-allow for reads as Pi infrastructure, bypassing the `external_directory` gate.\n\nThe extension auto-discovers the global node_modules root (walks up from the extension's install path; falls back to `npm root -g` from a dev checkout), Pi's own install directory (via the coding-agent `getPackageDir()` API), `agentDir`, `agentDir/git`, and project-local `.pi/npm/` and `.pi/git/`. Add entries here for edge cases where auto-discovery is insufficient (e.g. custom `npmCommand` pointing to pnpm).\n\nSupports `~`/`$HOME` expansion. Entries may be plain directory prefixes or wildcard patterns using `*` (matches any characters, including `/`) and `?` (matches exactly one character). `**` and `*` are equivalent — both cross directory boundaries.\n\nOn Windows, matching is case-insensitive and tolerant of either path separator.",
      default: [],
    }),
    authorizerChain: z.array(z.string().min(1)).optional().meta({
      description:
        "Ordered names of registered live-authority chain links to consult before the terminal authorizer. Config order (not registration order) fixes the chain order; an unregistered name is skipped fail-safe (more prompting, never less); a link decides nothing until it is named here.",
      markdownDescription:
        "Ordered names of registered **live-authority chain links** (e.g. a model judge) to consult before the terminal authorizer (the human, or the subagent-forwarding / headless-deny fallback).\n\nA link reviews an `ask` and returns `allow` / `deny` (with an optional teaching reason) / `defer` to the next link. Three invariants govern the chain:\n\n- **Config order wins.** The order here \u2014 not the order extensions register in \u2014 fixes the security-relevant chain order.\n- **Fail-safe skip.** A name with no registered link is skipped with a warning; the `ask` still reaches the terminal (more prompting, never less).\n- **Opt-in activation.** Installing a judge extension grants it no authority; a link decides nothing until you name it here.\n\nThe chain owner caps every verdict with a bounded-delegation checkpoint: a link's `allow` on an excluded surface (`external_directory` or `path`) is downgraded to `defer`, so a link cannot exceed your policy.\n\nDefaults to an empty list (no links).",
      default: [],
    }),
    permission: permissionSchema.optional(),
    shellTools: shellToolsSchema.optional(),
  })
  .meta({
    title: "PI Permission System Configuration",
    description:
      "Unified config file combining runtime knobs and flat permission policy for pi-permission-system.",
    markdownDescription:
      "Unified config file combining runtime knobs and flat permission policy for [pi-permission-system](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system).\n\nPlace at `~/.pi/agent/extensions/pi-permission-system/config.json` (global) or `<project>/.pi/extensions/pi-permission-system/config.json` (project).",
  });

/** A permission decision. */
export type PermissionState = z.infer<typeof permissionStateSchema>;

/** A deny action with an optional custom reason. */
export type DenyWithReason = z.infer<typeof denyWithReasonSchema>;

/** A pattern value: a PermissionState string OR a DenyWithReason object. */
export type PatternValue = z.infer<typeof patternValueSchema>;

/** The on-disk permission shape inside the `"permission"` key. */
export type FlatPermissionConfig = z.infer<typeof permissionSchema>;

/** The `shellTools` map: tool name → shell-alias argument mapping. */
export type ShellToolsConfig = z.infer<typeof shellToolsSchema>;

/** The raw config file shape after validation (all fields optional). */
export type UnifiedPermissionConfig = z.infer<typeof unifiedConfigSchema>;

/**
 * Derive the published JSON Schema (Draft 2020-12) from the zod source.
 *
 * The three id-tagged sub-schemas (`permissionState`, `permissionMap`,
 * `denyWithReason`) become `$defs` referenced by `$ref`; everything else
 * inlines. The root `$id` is set to the canonical monorepo URL.
 */
export function buildPermissionsJsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(unifiedConfigSchema, {
    target: "draft-2020-12",
  });
  return { $schema, $id: PERMISSIONS_SCHEMA_URL, ...rest };
}
