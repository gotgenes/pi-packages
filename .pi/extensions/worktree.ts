/**
 * /worktree, /worktree-open — manage isolated git worktrees + peer Pi sessions.
 *
 * Project-local extension (auto-discovered from `.pi/extensions/`). Registers
 * two slash commands that shell out to `scripts/` via `pi.exec` — no LLM turn,
 * they run directly in code.
 *
 * `/worktree <issue> [initial-command]` → `scripts/worktree-new.sh`
 *   Creates a branch + worktree under
 *   `~/development/pi/pi-packages-worktrees/issue-<N>`, runs `pnpm install`, and
 *   spawns a new WezTerm tab whose CWD is the worktree, launching Pi with an
 *   initial prompt (default `/plan-issue <N>`) already submitted.
 *
 * `/worktree-open <issue>` → `scripts/worktree-open.sh`
 *   Reopens a peer session for a worktree that already exists, resuming its
 *   conversation with `pi --continue`. Creation refuses an existing worktree by
 *   design, so this is the command for a tab that was simply closed.
 *
 * Usage:
 *   /worktree 42              → branch issue-42-<slug>, peer session runs /plan-issue 42
 *   /worktree 42 build-plan   → peer session runs /build-plan 42 instead
 *   /worktree-open 42         → reopen issue-42's worktree, continuing its session
 */

import path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SCRIPT_REL_PATH = "scripts/worktree-new.sh";
const OPEN_SCRIPT_REL_PATH = "scripts/worktree-open.sh";

// pnpm install dominates the runtime; give it generous headroom.
const TIMEOUT_MS = 5 * 60 * 1000;

// Reopening only validates the worktree and spawns a tab — no install, no
// network — so it has no reason to take more than a moment.
const OPEN_TIMEOUT_MS = 30 * 1000;

// Patterns matching worktree-new.sh's own status printfs (worktree path,
// branch, mise trust, launch confirmation, teardown hint) — as opposed to the
// noisy pnpm install output interleaved in the same stdout stream.
const SUMMARY_LINE_PATTERNS = [
  /^worktree : /,
  /^branch\s+: /,
  /^branch .* already exists/,
  /^mise: trusted /,
  /^\u2713 peer Pi session launched/,
  /^\s*initial prompt: /,
  /^\u26a0 not inside WezTerm/,
  /^\s*cd /,
  /^when done, tear it down with:/,
  /^\s*scripts\/worktree-rm\.sh /,
  /^\u2713 peer Pi session reopened/,
  /^\s*continuing the most recent session/,
];

function extractSummaryLines(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) =>
      SUMMARY_LINE_PATTERNS.some((pattern) => pattern.test(line)),
    )
    .map((line) => line.trim());
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("worktree", {
    description:
      "Create an isolated worktree + peer Pi session for an issue (usage: /worktree <issue> [command])",
    handler: async (args, ctx) => {
      const tokens = args.trim().split(/\s+/).filter(Boolean);
      const issue = tokens[0];

      if (!issue || !/^[0-9]+$/.test(issue)) {
        ctx.ui.notify(
          "Usage: /worktree <issue-number> [initial-command]",
          "warning",
        );
        return;
      }

      // tokens[1..] become the optional initial-command override for the peer
      // session (e.g. `build-plan`); the script defaults to `/plan-issue <N>`.
      const scriptArgs = [issue, ...tokens.slice(1)];
      const scriptPath = path.join(ctx.cwd, SCRIPT_REL_PATH);

      ctx.ui.notify(
        `Creating worktree for issue #${issue} (pnpm install may take a moment)…`,
        "info",
      );

      const result = await pi.exec("/bin/bash", [scriptPath, ...scriptArgs], {
        cwd: ctx.cwd,
        timeout: TIMEOUT_MS,
      });

      if (result.code === 0) {
        // Surface the script's own summary lines (worktree path, branch, launch
        // confirmation, teardown hint) rather than just the last line — the
        // script's final printf is the teardown hint alone, which on its own
        // gives no indication the worktree/session actually got created.
        const summary = extractSummaryLines(result.stdout);
        ctx.ui.notify(
          summary.length > 0
            ? summary.join("\n")
            : `Worktree created for issue #${issue}.`,
          "info",
        );
      } else {
        const detail = (result.stderr || result.stdout)
          .trim()
          .split("\n")
          .pop();
        ctx.ui.notify(
          `worktree-new.sh failed (exit ${result.code})${detail ? `: ${detail}` : ""}`,
          "error",
        );
      }
    },
  });

  pi.registerCommand("worktree-open", {
    description:
      "Reopen a peer Pi session for an existing worktree (usage: /worktree-open <issue>)",
    handler: async (args, ctx) => {
      const issue = args.trim().split(/\s+/).filter(Boolean)[0];

      if (!issue || !/^[0-9]+$/.test(issue)) {
        ctx.ui.notify("Usage: /worktree-open <issue-number>", "warning");
        return;
      }

      const scriptPath = path.join(ctx.cwd, OPEN_SCRIPT_REL_PATH);

      const result = await pi.exec("/bin/bash", [scriptPath, issue], {
        cwd: ctx.cwd,
        timeout: OPEN_TIMEOUT_MS,
      });

      if (result.code === 0) {
        const summary = extractSummaryLines(result.stdout);
        ctx.ui.notify(
          summary.length > 0
            ? summary.join("\n")
            : `Worktree session reopened for issue #${issue}.`,
          "info",
        );
      } else {
        // The script's failures are single-line `error: …` aborts (missing
        // directory, unregistered worktree), and they name the remedy — so
        // surface the message itself rather than a generic exit-code notice.
        const detail = (result.stderr || result.stdout)
          .trim()
          .split("\n")
          .pop();
        ctx.ui.notify(
          detail || `worktree-open.sh failed (exit ${result.code})`,
          "error",
        );
      }
    },
  });
}
