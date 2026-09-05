#!/usr/bin/env node
/**
 * Measure how many bash `external_directory` asks flagged a token that is not
 * a filesystem path at all.
 *
 * ADR 0013's rule is that a durable number ships with the instrument that
 * produced it. The figures in Phase 15's Findings (architecture.md) come from
 * this script.
 *
 * Metric: among `permission_request.waiting` entries with `toolName: "bash"`
 * that carry external paths, the fraction whose flagged path has a shape no
 * filesystem path has — a newline, a `;`, whitespace, a `//` comment prefix,
 * a quote or bracket, or a `\|` regex alternation. These are the #863 family
 * (interpreter inline scripts, `git commit -m` prose, `echo` strings) plus
 * regex arguments the pattern-first tables did not yet cover.
 *
 * A second counter reports tokens whose `..` is not a whole path segment —
 * the #859 git-revision-range family (`HEAD..origin/main`).
 *
 * Measured 2026-09-05 against the local review log (967 bash asks, 753 with
 * external paths, 674 distinct commands): **28 non-path asks all-time (2.9%),
 * 0 in 2026-09**, and **0 revision-range asks** (55 commands in the log carry
 * a rev-range, but every one ran under a known base, so none reached the
 * external-directory gate). The other ~97% flag real paths outside the tree;
 * those are the read-vs-write question ADR 0013's axis answers, not false
 * positives of the classifier.
 *
 * Two log eras are handled: entries before 2026-08-17 carry the paths only
 * inside `message`, later ones in `externalPaths`. A command longer than the
 * review log's field cap is stored with a trailing `…` and is skipped rather
 * than parsed as garbage.
 *
 * Usage:
 *   node scripts/measure-path-false-positives.mjs [path-to-review-log.jsonl]
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_LOG = join(
  homedir(),
  ".pi/agent/extensions/pi-permission-system/logs",
  "pi-permission-system-permission-review.jsonl",
);

const NON_PATH_SHAPE = /\n|;|\s|^\/\/[^/]|[()"`{}]|\\\|/;
const MESSAGE_PATHS =
  /outside working directory '[^']*': (.*?)\. Allow this external directory access\?/s;

function isSegmentDotDot(token) {
  return (
    token === ".." ||
    token.startsWith("../") ||
    token.endsWith("/..") ||
    token.includes("/../")
  );
}

function externalPathsOf(entry) {
  if (Array.isArray(entry.externalPaths)) return entry.externalPaths;
  const match = MESSAGE_PATHS.exec(entry.message ?? "");
  return match ? match[1].split(", ") : [];
}

function readAsks(logPath) {
  const asks = [];
  for (const line of readFileSync(logPath, "utf8").split("\n")) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.event !== "permission_request.waiting") continue;
    if (entry.toolName !== "bash") continue;
    const command = entry.command ?? "";
    if (command.endsWith("…")) continue;
    const paths = externalPathsOf(entry);
    if (paths.length === 0) continue;
    asks.push({ month: entry.timestamp.slice(0, 7), command, paths });
  }
  return asks;
}

function main() {
  const logPath = process.argv[2] ?? DEFAULT_LOG;
  const asks = readAsks(logPath);
  const byMonth = new Map();
  let nonPath = 0;
  let revRange = 0;
  const distinct = new Set();
  for (const ask of asks) {
    distinct.add(ask.command);
    const bucket = byMonth.get(ask.month) ?? { asks: 0, nonPath: 0 };
    bucket.asks += 1;
    if (ask.paths.some((p) => NON_PATH_SHAPE.test(p))) {
      bucket.nonPath += 1;
      nonPath += 1;
    }
    if (
      ask.paths.some(
        (p) =>
          p.includes("..") &&
          !isSegmentDotDot(p) &&
          !p.startsWith("/") &&
          !p.startsWith("~"),
      )
    ) {
      revRange += 1;
    }
    byMonth.set(ask.month, bucket);
  }
  console.log(`log: ${logPath}`);
  console.log(
    `bash external_directory asks: ${asks.length} (${distinct.size} distinct commands)`,
  );
  console.log(
    `non-path token flagged: ${nonPath} (${((100 * nonPath) / asks.length).toFixed(1)}%)`,
  );
  console.log(`revision-range token flagged: ${revRange}`);
  console.log("\nby month:");
  for (const [month, bucket] of [...byMonth].sort()) {
    console.log(
      `  ${month}  asks ${String(bucket.asks).padStart(4)}  non-path ${String(bucket.nonPath).padStart(3)}`,
    );
  }
}

main();
