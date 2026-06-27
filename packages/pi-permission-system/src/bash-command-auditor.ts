/**
 * Bash command auditor for detecting privilege-escalation and shell-escape
 * vectors that can bypass permission gate rules.
 *
 * Three vectors are detected:
 *
 * 1. **sudo** — any command segment beginning with `sudo` is blocked unless
 *    `allowSudo: true` is set in the permission config.
 *
 * 2. **bash/sh -c with a dynamic argument** — `bash -c "$CMD"` or
 *    `sh -c "$(get_cmd)"` passes an opaque, runtime-generated string to a new
 *    shell, bypassing pattern matching on the actual command. Only dynamic
 *    arguments are blocked; single-quoted literals (`bash -c 'echo hi'`) and
 *    double-quoted strings without `$` or backtick expansions are allowed
 *    unless `allowShellEscape: true` is set.
 *
 * 3. **xargs in a pipeline** — `... | xargs <cmd>` executes arbitrary
 *    commands supplied from stdin at runtime. When detected, the result is
 *    `"ask"` rather than `"block"`, escalating a policy-allowed command to
 *    require explicit user confirmation.
 */

/** Config fields relevant to the bash command auditor. */
export interface BashAuditConfig {
  /** When `true`, `sudo` prefixes are permitted. Default: `false` (blocked). */
  allowSudo?: boolean;
  /**
   * When `true`, `bash -c <dynamic>` / `sh -c <dynamic>` invocations are
   * permitted. Default: `false` (blocked).
   */
  allowShellEscape?: boolean;
}

/** Possible outcomes of `auditBashCommand`. */
export type BashAuditVerdict =
  | { verdict: "pass" }
  | { verdict: "block"; reason: string }
  | { verdict: "ask"; reason: string };

// ── Detection helpers ──────────────────────────────────────────────────────

/**
 * Returns `true` when the raw command contains `sudo` at the start of any
 * pipeline segment (after `&&`, `||`, `;`, `|`, or at the very start).
 *
 * This is a conservative text-level check: it may fire on `sudo` inside a
 * string literal, but the false-positive rate is acceptable for a security
 * pre-filter.
 */
function hasSudoPrefix(command: string): boolean {
  // Match `sudo` at the very start of the command or after any shell operator,
  // followed by whitespace or end-of-string (word-boundary guard).
  return /(?:^|&&|\|\||[;|\n])\s*sudo(?:\s|$)/.test(command);
}

/**
 * Returns `true` when the argument following `-c` in a `bash`/`sh` invocation
 * is a static literal (single-quoted, or double-quoted with no `$` or backtick
 * expansions). Static literals are safe because their content is fully visible
 * and can still be matched against permission rules.
 */
function isLiteralShellCArg(arg: string): boolean {
  const trimmed = arg.trimStart();
  // Single-quoted literal: no expansion possible inside single quotes.
  if (/^'[^']*'/.test(trimmed)) return true;
  // Double-quoted literal with no `$` or backtick: no runtime expansion.
  if (/^"[^$`"]*"/.test(trimmed)) return true;
  return false;
}

/**
 * Returns `true` when the command invokes `bash -c <dynamic>` or
 * `sh -c <dynamic>` where the argument is generated at runtime (contains
 * variable references, command substitution, or is unquoted).
 */
function hasShellEscape(command: string): boolean {
  // Match `bash` or `sh` followed by optional flag tokens and then `-c `.
  // Flags may appear before `-c` in arbitrary order (e.g. `bash -x -c ...`).
  // The capture group grabs everything after `-c ` on the same logical line.
  const shellCRe = /\b(?:bash|sh)\b(?:\s+[-\w]+)*\s+-c\s+([\s\S]+)/;
  const match = command.match(shellCRe);
  if (!match) return false;

  const arg = match[1];
  return !isLiteralShellCArg(arg);
}

/**
 * Returns `true` when the command pipes output into `xargs`:
 *   `... | xargs <cmd>`
 *
 * Such pipelines execute commands whose arguments are supplied from stdin at
 * runtime, making static permission analysis unreliable.
 */
function hasXargsInPipeline(command: string): boolean {
  return /\|\s*xargs\b/.test(command);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Audit a raw bash command string for privilege-escalation and shell-escape
 * vectors, returning a verdict that the permission gate can act on.
 *
 * Verdict priority (most severe first): `"block"` → `"ask"` → `"pass"`.
 *
 * - `"block"` — the command contains a disallowed vector (`sudo` or
 *   `bash/sh -c <dynamic>`) and the matching config flag is not set.
 * - `"ask"` — the command pipes into `xargs`, requiring explicit user
 *   confirmation even when the base policy would allow it.
 * - `"pass"` — no vectors detected; the command proceeds to the regular
 *   pattern-matching permission gates.
 *
 * @param command - Raw bash command string as received from the tool call.
 * @param config  - Active audit config derived from the permission config.
 */
export function auditBashCommand(
  command: string,
  config: BashAuditConfig,
): BashAuditVerdict {
  if (hasSudoPrefix(command) && !config.allowSudo) {
    return {
      verdict: "block",
      reason:
        "Command uses `sudo`, which is blocked by the current permission " +
        "configuration. Set `allowSudo: true` in the permission config to permit.",
    };
  }

  if (hasShellEscape(command) && !config.allowShellEscape) {
    return {
      verdict: "block",
      reason:
        "Command invokes `bash -c` or `sh -c` with a dynamic argument that " +
        "can bypass permission rules at runtime. Set `allowShellEscape: true` " +
        "in the permission config to permit.",
    };
  }

  if (hasXargsInPipeline(command)) {
    return {
      verdict: "ask",
      reason:
        "Command pipes output into `xargs`, which executes commands constructed " +
        "from stdin at runtime. Explicit confirmation is required.",
    };
  }

  return { verdict: "pass" };
}
