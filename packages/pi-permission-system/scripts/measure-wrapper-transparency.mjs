#!/usr/bin/env node
/**
 * Measure how many real prompts the wrapper-floor exemption removes.
 *
 * ADR 0013's rule is that a durable number ships with the instrument that
 * produced it, so a later reader can re-run it and falsify the claim rather
 * than argue with it. The figures in Phase 14 Step 3's `Landed:` note and in
 * `docs/plans/0803-wrapper-transparency.md` come from this script.
 *
 * Metric: of the `permission_request.waiting` entries whose decision was a
 * wrapper floor, how many have **every** floored unit running a proven
 * pure-reader inner command with no write-proving redirect on the statement.
 * Every floored unit is the right test because units compose most-restrictive
 * — one non-exempt wrapper re-floors the whole ask.
 *
 * Measured 2026-08-27 against the local review log:
 *
 * | Month   | prompts | wrapper-floored | exempt      |
 * | ------- | ------- | --------------- | ----------- |
 * | 2026-07 | 164     | 44 (26.8%)      | 24 (14.6%)  |
 * | 2026-08 | 164     | 47 (28.7%)      | 19 (11.6%)  |
 *
 * Together: 91 of 328 prompts floored (27.7%), 43 of them relieved — 13.1% of
 * all prompts and 47.3% of floored ones. The log grows with use, so a later
 * run drifts by a fraction of a point; re-run rather than trusting the figure
 * to be exact. Clause costs at the same run: 6, 0, 0.
 *
 * Only the sentinel era is totalled. The floor sentinels reach the review log
 * from 2026-07 — earlier entries carry no `matchedPattern` field and no
 * rendered floor message — so a total over all time would divide a real
 * numerator by a denominator that could not have contributed to it. The scan
 * matches the sentinel substring anywhere in the entry rather than reading a
 * field, because the older era spells it inside `message`.
 *
 * The run also prices each conservative clause: how many more asks would be
 * relieved if that clause alone were dropped. Those are the per-clause costs
 * the plan and the roadmap cite, so they are re-derivable here rather than
 * asserted — do not quote a clause cost this script does not print.
 *
 * The `sudo`/`doas` row prices the *rejected* carve-out rather than a shipped
 * clause: it counts asks that would be relieved if privilege-elevating wrappers
 * were exempted from transparency, which is the option the design declined.
 *
 * The tables below are transcribed from `src/access-intent/bash/` rather than
 * imported, for the reason `measure-core-coverage.mjs` states: this script runs
 * against a log written by whatever version was installed at the time, so
 * pinning what it measures makes a re-run comparable to the original figures.
 *
 * Unit splitting and word splitting are deliberately crude — whitespace and
 * chain operators, where the gate parses with tree-sitter. A crude split can
 * only over-count units and under-resolve wrappers, which biases the answer
 * **down**. Verified against a run using the real modules over the same log:
 * both produce 24 (July) and 18 (August).
 *
 * Usage:
 *   node scripts/measure-wrapper-transparency.mjs [path-to-review-log.jsonl]
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Transcribed vocabulary ─────────────────────────────────────────────────

/** The frozen v1 pure-reader core (`command-effects.ts`). */
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

/** Options that withdraw a guarded word's read claim (`RETRACTION_GUARDS`). */
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

/** Wrappers that always invoke a following command (`INDIRECTION_WRAPPER_NAMES`). */
const INDIRECTION = new Set([
  "sudo",
  "env",
  "xargs",
  "time",
  "nohup",
  "timeout",
  "nice",
  "parallel",
  "rust-parallel",
  "rush",
  "doas",
  "setsid",
  "stdbuf",
  "watch",
  "flock",
]);

/** Search tools that invoke a command only with an exec flag (`EXEC_CONDITIONAL_WRAPPERS`). */
const EXEC_CONDITIONAL = new Map([
  ["find", ["-exec", "-execdir", "-ok", "-okdir"]],
  ["fd", ["-x", "--exec", "-X", "--exec-batch"]],
]);

/** Shells whose `-c` flag introduces an opaque inline program. */
const SHELLS = new Set(["bash", "sh", "dash", "zsh", "ksh"]);

/** Per-wrapper options that consume the following word (`VALUE_TAKING_FLAGS`). */
const VALUE_TAKING = new Map([
  ["sudo", ["-u", "-g", "-p", "-C", "-h", "-U", "-r", "-t"]],
  ["doas", ["-u", "-C"]],
  ["env", ["-u", "-C", "--unset", "--chdir"]],
  ["xargs", ["-n", "-P", "-I", "-i", "-d", "-E", "-L", "-l", "-s", "-a"]],
  ["timeout", ["-s", "-k", "--signal", "--kill-after"]],
  ["nice", ["-n", "--adjustment"]],
  ["time", ["-o", "-f", "--output", "--format"]],
  ["stdbuf", ["-i", "-o", "-e", "--input", "--output", "--error"]],
  ["watch", ["-n", "--interval"]],
  ["flock", ["-w", "-E", "--timeout", "--conflict-exit-code"]],
]);

/** Wrappers whose first bare word is an operand, not the inner command. */
const LEADING_OPERAND = new Set(["timeout", "flock"]);

const MAX_UNWRAP_DEPTH = 4;

/** The first month whose entries can carry a floor sentinel at all. */
const SENTINEL_ERA_START = "2026-07";

const DEFAULT_LOG = join(
  homedir(),
  ".pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl",
);

// ── The predicate, crudely ─────────────────────────────────────────────────

const basename = (word) => word.replace(/^.*\//, "");

/** Split a command string into its units on the shell chain operators. */
function splitUnits(command) {
  return command
    .split(/&&|\|\||[|;\n]|(?<![<>&])&(?![<>&])/)
    .map((unit) => unit.trim())
    .filter((unit) => unit.length > 0);
}

/** A unit's words, with any leading env-var assignments stripped. */
function wordsOf(unit) {
  const words = unit.split(/\s+/).filter((word) => word.length > 0);
  while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
    words.shift();
  }
  return words;
}

/** `"indirection"`, `"opaque-payload"`, or `undefined` (`classifyWrapperWords`). */
function classifyWrapper(words) {
  const name = basename(words[0] ?? "");
  const args = words.slice(1);
  if (name === "eval") return "opaque-payload";
  if (SHELLS.has(name) && shortFlagCIndex(args) !== -1) return "opaque-payload";
  if (INDIRECTION.has(name)) return "indirection";
  if (execFlagIndex(name, args) !== -1) return "indirection";
  return undefined;
}

function shortFlagCIndex(args) {
  for (const [index, arg] of args.entries()) {
    if (arg === "--") return -1;
    if (arg.startsWith("-") && !arg.startsWith("--") && arg.includes("c")) {
      return index;
    }
  }
  return -1;
}

function execFlagIndex(name, args) {
  const flags = EXEC_CONDITIONAL.get(name);
  return flags ? args.findIndex((arg) => flags.includes(arg)) : -1;
}

/** Index of the word beginning the inner command, or -1 (`innerCommandIndex`). */
function innerCommandIndex(words) {
  const name = basename(words[0] ?? "");
  const execFlag = execFlagIndex(name, words.slice(1));
  if (execFlag !== -1) return execFlag + 2;

  const valueTaking = VALUE_TAKING.get(name) ?? [];
  let operandPending = LEADING_OPERAND.has(name);
  let index = 1;
  while (index < words.length) {
    const word = words[index];
    if (word === "--") return index + 1;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      index++;
      continue;
    }
    if (word.startsWith("-")) {
      index += valueTaking.includes(word) ? 2 : 1;
      continue;
    }
    if (operandPending) {
      operandPending = false;
      index++;
      continue;
    }
    return index;
  }
  return -1;
}

/**
 * Peel indirection layers, refusing at an opaque payload (`unwrapIndirection`).
 *
 * `null` means the walk reached an inline-shell payload: its program is not a
 * slice of this command line, so its first word says nothing about the rest.
 * This is the clause a predicate reading `executedUnitOf`'s string would miss.
 */
function peelToInner(words, unwrapOpaque = false) {
  let current = words;
  let layers = 0;
  for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth++) {
    const kind = classifyWrapper(current);
    if (kind === undefined) break;
    if (kind === "opaque-payload") {
      if (!unwrapOpaque) return null;
      // The relaxed reading: judge the payload's first word as if it stood for
      // the whole program. This is the fail-open the shipped clause refuses.
      const flagIndex = shortFlagCIndex(current.slice(1));
      const payload = current[flagIndex + 2];
      return payload === undefined
        ? null
        : payload
            .replace(/^['"]|['"]$/g, "")
            .split(/\s+/)
            .filter(Boolean);
    }
    const start = innerCommandIndex(current);
    if (start === -1 || start >= current.length) break;
    const end = current.findIndex(
      (word, index) =>
        index >= start && [";", "+"].includes(word.replace(/^\\/, "")),
    );
    current = current.slice(start, end === -1 ? current.length : end);
    layers++;
  }
  return layers === 0 ? null : current;
}

/** True when a head word proves a read (`proveCommandEffect`). */
function provesRead(words) {
  const head = words[0] ?? "";
  if (head.includes("/") || head.includes("\\")) return false;
  if (!CORE.has(head)) return false;
  const guard = GUARDS.get(head);
  if (!guard) return true;
  return !words.slice(1).some((arg) => guard.includes(arg));
}

/**
 * True when a statement redirects output into a real file.
 *
 * `2>&1` and `>&2` duplicate a descriptor and touch no file; a bare `<` reads.
 * Crude where the gate reads the parse tree, and over-matching here can only
 * withhold an exemption.
 */
function writesViaRedirect(command) {
  const pattern = /(?:^|[^0-9<>&])&?>>?\|?\s*([^\s&|;()]+)/g;
  let match = pattern.exec(command);
  while (match !== null) {
    if (!/^\d+$/.test(match[1])) return true;
    match = pattern.exec(command);
  }
  return false;
}

/**
 * True when every floored unit of a command is exempt from the floor.
 *
 * `relaxed` drops one clause so its cost can be priced: `"opaque"` unwraps
 * through an inline-shell payload and judges its first word, `"redirect"`
 * ignores the statement's redirect, and `"sudo"` exempts a privilege-elevating
 * wrapper outright (the rejected carve-out).
 */
function everyFlooredUnitIsExempt(command, relaxed = null) {
  const wrapped = splitUnits(command)
    .map((unit) => wordsOf(unit))
    .filter((words) => classifyWrapper(words) !== undefined);
  if (wrapped.length === 0) return false;
  if (relaxed !== "redirect" && writesViaRedirect(command)) return false;
  return wrapped.every((words) => {
    if (
      relaxed === "sudo" &&
      ["sudo", "doas"].includes(basename(words[0] ?? ""))
    ) {
      return true;
    }
    const inner = peelToInner(words, relaxed === "opaque");
    return inner !== null && provesRead(inner);
  });
}

/** The clauses priced in the run's cost table, in the order they are printed. */
const RELAXATIONS = [
  ["opaque", "unwrap through an inline-shell payload"],
  ["redirect", "ignore a write-proving redirect"],
  ["sudo", "exempt sudo/doas outright (rejected carve-out)"],
];

// ── The scan ───────────────────────────────────────────────────────────────

function main() {
  const logPath = process.argv[2] ?? DEFAULT_LOG;
  const months = new Map();
  const remainingHeads = new Map();
  const clauseCosts = new Map(RELAXATIONS.map(([key]) => [key, 0]));

  for (const line of readFileSync(logPath, "utf-8").split("\n")) {
    if (line.trim() === "") continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.event !== "permission_request.waiting") continue;

    const blob = JSON.stringify(entry);
    // Test-fixture entries from the suite's own tmpdirs are not real prompts.
    if (blob.includes("/var/folders/")) continue;

    const month = String(entry.timestamp ?? "").slice(0, 7);
    const bucket = months.get(month) ?? { all: 0, floored: 0, exempt: 0 };
    months.set(month, bucket);
    bucket.all++;

    if (!blob.includes("bash-wrapper")) continue;
    bucket.floored++;

    const command = entry.command;
    if (typeof command !== "string" || command === "") continue;
    // A command longer than `reviewLogFieldMaxWidth` is stored shortened, so
    // its tail units are invisible. Skip it rather than score a truncation.
    if (command.endsWith("…")) continue;

    if (everyFlooredUnitIsExempt(command)) {
      bucket.exempt++;
    } else {
      for (const [key] of RELAXATIONS) {
        if (everyFlooredUnitIsExempt(command, key)) {
          clauseCosts.set(key, clauseCosts.get(key) + 1);
        }
      }
      for (const unit of splitUnits(command)) {
        const words = wordsOf(unit);
        if (classifyWrapper(words) === undefined) continue;
        const inner = peelToInner(words);
        if (inner !== null && provesRead(inner)) continue;
        const head = inner === null ? "<opaque payload>" : (inner[0] ?? "");
        remainingHeads.set(head, (remainingHeads.get(head) ?? 0) + 1);
      }
    }
  }

  const pct = (n, d) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);
  let all = 0;
  let floored = 0;
  let exempt = 0;

  console.log(`log: ${logPath}`);
  console.log("");
  console.log("month    prompts  floored          exempt");
  for (const [month, bucket] of [...months].sort()) {
    if (month >= SENTINEL_ERA_START) {
      all += bucket.all;
      floored += bucket.floored;
      exempt += bucket.exempt;
    }
    console.log(
      `${month}  ${String(bucket.all).padStart(7)}  ${String(bucket.floored).padStart(4)} ${pct(bucket.floored, bucket.all).padStart(6)}  ${String(bucket.exempt).padStart(4)} ${pct(bucket.exempt, bucket.all).padStart(6)}`,
    );
  }
  console.log("");
  console.log(
    `${SENTINEL_ERA_START} onward: ${floored}/${all} floored (${pct(floored, all)}); ${exempt} relieved (${pct(exempt, all)} of all prompts, ${pct(exempt, floored)} of floored)`,
  );
  console.log("");
  console.log("cost of each conservative clause (asks it forfeits):");
  for (const [key, description] of RELAXATIONS) {
    console.log(
      `  ${String(clauseCosts.get(key)).padStart(3)}  ${description}`,
    );
  }
  console.log("");
  console.log("inner commands still floored:");
  for (const [head, count] of [...remainingHeads].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${head.padEnd(18)} ${count}`);
  }
}

main();
