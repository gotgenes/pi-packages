#!/usr/bin/env node
/**
 * Measure what fraction of real bash asks the pure-reader core could relieve.
 *
 * ADR 0013's rule is that a durable number ships with the instrument that
 * produced it, so a later reader can re-run it and falsify the claim rather
 * than argue with it. The figures in Phase 14 Step 2's `Landed:` note and in
 * `docs/plans/0807-bash-effect-attribution.md` come from this script.
 *
 * Metric: the fraction of `permission_request.waiting` entries with
 * `toolName: "bash"` whose **every** command-unit head word is in the core.
 * Every unit is the right test because tokens compose most-restrictive — one
 * unproven unit re-floors the whole ask, so a partial match relieves nothing.
 *
 * Measured 2026-08-27 against the local review log (804 bash asks, 230 of them
 * in 2026-07/08): **35.9% all-time, 23.0% recent.** The log grows with use, so
 * a later run drifts by a fraction of a point; re-run rather than trusting the
 * figure to be exact.
 *
 * The retraction guards are applied, and they matter: without them the recent
 * figure reads 28.9%. All 14 recent asks the guards exclude are
 * `find … -exec <core reader> {} +`, which the indirection-wrapper floor sends
 * to `ask` anyway — so the guards cost no relief reachable at this layer.
 * Lifting that floor by reading the inner command is #803's job, not this one's.
 * An earlier scan that reported 27.9% recent had not applied the guards.
 *
 * The roster below is 21 words. The plan's 22nd, `file`, was dropped in
 * pre-completion review (`file -C` writes a `magic.mgc` file); it appears in
 * one ask out of 804, so neither figure moved.
 *
 * The head-word split here is deliberately crude (whitespace, after stripping
 * an env-var prefix and following a pipe/`&&`/`;`). It is a measurement
 * instrument, not the gate: the gate parses with tree-sitter. A crude split
 * can only over-count units, which biases the answer **down**.
 *
 * Usage:
 *   node scripts/measure-core-coverage.mjs [path-to-review-log.jsonl]
 *
 * Defaults to the local review log:
 *   ~/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The frozen v1 roster, transcribed from
 * `src/access-intent/bash/command-effects.ts`.
 *
 * Transcribed rather than imported: this script runs against a log written by
 * whatever version was installed at the time, so pinning the roster it
 * measures makes a re-run comparable to the original figures. A drift check
 * lives in `test/access-intent/bash/command-effects.test.ts`.
 */
const CORE = new Set([
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "diff",
  "ls",
  "stat",
  "pwd",
  "basename",
  "dirname",
  "realpath",
  "echo",
  "which",
  "cd",
  "find",
  "fd",
  "sort",
]);

/** Options that withdraw a guarded word's read claim. */
const GUARDS = new Map([
  [
    "find",
    [
      "-exec",
      "-execdir",
      "-ok",
      "-okdir",
      "-delete",
      "-fprint",
      "-fprint0",
      "-fprintf",
      "-fls",
    ],
  ],
  ["fd", ["-x", "-X", "--exec", "--exec-batch"]],
  ["sort", ["-o", "--output"]],
]);

const DEFAULT_LOG = join(
  homedir(),
  ".pi",
  "agent",
  "extensions",
  "pi-permission-system",
  "logs",
  "pi-permission-system-permission-review.jsonl",
);

/**
 * Shell keywords that open or close a compound statement.
 *
 * Splitting on `;` turns `for f in *; do cat $f; done` into three pieces, two
 * of which start with a keyword rather than a command. The gate's tree-sitter
 * enumeration never emits those as command units, so counting them as
 * unproven heads would bias the answer down for no reason.
 */
const SHELL_KEYWORDS = new Set([
  "for",
  "do",
  "done",
  "while",
  "until",
  "if",
  "then",
  "elif",
  "else",
  "fi",
  "case",
  "esac",
  "in",
  "function",
  "{",
  "}",
  "(",
  ")",
  "!",
  "time",
]);

/**
 * Split a command string into its units on the shell chain operators.
 *
 * The background `&` is a separator, but `2>&1`, `>&2`, and `&>` are not —
 * splitting on a bare `&` turns `pnpm x 2>&1 | tail` into a phantom unit whose
 * head word is `1`. Only an `&` that is neither preceded nor followed by a
 * redirect character separates.
 */
function splitUnits(command) {
  return command
    .split(/&&|\|\||[|;\n]|(?<![<>&])&(?![<>&])/)
    .map((unit) => unit.trim())
    .filter((unit) => unit.length > 0);
}

/** A unit's head word, with any leading env-var assignments stripped. */
function headWordOf(unit) {
  const words = unit.split(/\s+/).filter((word) => word.length > 0);
  for (const word of words) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue;
    return word;
  }
  return "";
}

/** True when the whole ask would be attributed a read by the core. */
function everyUnitIsCore(command) {
  const units = splitUnits(command).filter(
    (unit) => !SHELL_KEYWORDS.has(headWordOf(unit)),
  );
  if (units.length === 0) return false;
  return units.every((unit) => unitIsCore(unit));
}

function unitIsCore(unit) {
  const head = headWordOf(unit);
  // The bare-basename rule: a path-qualified head word is never core.
  if (head.includes("/") || head.includes("\\")) return false;
  if (!CORE.has(head)) return false;
  const guard = GUARDS.get(head);
  if (!guard) return true;
  const args = unit.split(/\s+/).slice(1);
  return !args.some((arg) => guard.includes(arg));
}

function main() {
  const logPath = process.argv[2] ?? DEFAULT_LOG;
  const lines = readFileSync(logPath, "utf-8").split("\n");

  let total = 0;
  let covered = 0;
  let recentTotal = 0;
  let recentCovered = 0;
  const blockers = new Map();

  for (const line of lines) {
    if (line.trim() === "") continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.event !== "permission_request.waiting") continue;
    if (entry.toolName !== "bash") continue;
    const command = entry.command;
    if (typeof command !== "string" || command === "") continue;

    // A command longer than `reviewLogFieldMaxWidth` is stored shortened with
    // a trailing ellipsis, so its tail units are invisible. Skip it rather
    // than score a truncated chain (#746).
    if (command.endsWith("…")) continue;

    const isCovered = everyUnitIsCore(command);
    const month = String(entry.timestamp ?? "").slice(0, 7);
    const isRecent = month >= "2026-07";

    total += 1;
    if (isCovered) covered += 1;
    if (isRecent) {
      recentTotal += 1;
      if (isCovered) recentCovered += 1;
    }
    if (!isCovered && isRecent) {
      for (const unit of splitUnits(command)) {
        const head = headWordOf(unit);
        if (head === "" || SHELL_KEYWORDS.has(head)) continue;
        if (!unitIsCore(unit)) {
          blockers.set(head, (blockers.get(head) ?? 0) + 1);
        }
      }
    }
  }

  const pct = (n, d) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);

  console.log(`log: ${logPath}`);
  console.log(`core: ${CORE.size} words`);
  console.log("");
  console.log(`all-time: ${covered}/${total} (${pct(covered, total)})`);
  console.log(
    `recent (2026-07 onward): ${recentCovered}/${recentTotal} (${pct(recentCovered, recentTotal)})`,
  );
  console.log("");
  console.log("top blockers among recent asks:");
  for (const [word, count] of [...blockers]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)) {
    console.log(`  ${word.padEnd(12)} ${count}`);
  }
}

main();
