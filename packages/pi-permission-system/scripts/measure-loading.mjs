import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(join(packageDir, "package.json"), "utf8"),
);
const trials = Number(process.env.LOADING_TRIALS ?? 9);
assert(Number.isInteger(trials) && trials >= 5, "Use at least five trials");
const piBin = process.env.PI_BIN ?? "pi";
const runtimePath = join(packageDir, "dist/runtime.cjs");
assert(existsSync(runtimePath), "Run build:runtime before measuring");
const work = mkdtempSync(join(tmpdir(), "pi-permission-loading-"));
const agentDir = join(work, "agent");
const entries = {
  source: join(packageDir, "src/index.ts"),
  compiled: resolve(packageDir, manifest.pi.extensions[0]),
};

mkdirSync(join(agentDir, "extensions/pi-permission-system"), {
  recursive: true,
});
writeFileSync(
  join(agentDir, "settings.json"),
  JSON.stringify({
    defaultProvider: "openai",
    defaultModel: "gpt-4.1",
    defaultThinkingLevel: "off",
  }),
);
writeFileSync(
  join(agentDir, "extensions/pi-permission-system/config.json"),
  JSON.stringify({
    debugLog: false,
    permissionReviewLog: false,
    yoloMode: true,
  }),
);

function run(condition, fsCache) {
  const entry = entries[condition];
  const start = performance.now();
  const result = spawnSync(
    piBin,
    [
      "--no-approve",
      "--no-context-files",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--offline",
      "--mode",
      "rpc",
      "--no-session",
      "-e",
      entry,
    ],
    {
      cwd: work,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: agentDir,
        PI_TIMING: "1",
        JITI_FS_CACHE: fsCache ? "1" : "0",
      },
      input: "",
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  const cliMs = performance.now() - start;
  assert.equal(result.status, 0, result.stderr || String(result.error));
  const timing = (phase) => {
    const line = result.stderr
      .split("\n")
      .find((value) => value.trim().startsWith(`${entry} ${phase}:`));
    assert(line, `Missing ${phase} timing: ${result.stderr}`);
    return Number(line.match(/: (\d+)ms$/)[1]);
  };
  assert(!result.stderr.includes("Failed to load extension"), result.stderr);
  assert(!result.stderr.includes("falling back to TypeScript"), result.stderr);
  assert(!result.stdout.includes('"notifyType":"error"'), result.stdout);
  const importMs = timing("module import");
  const factoryMs = timing("factory");
  return { importMs, factoryMs, extensionMs: importMs + factoryMs, cliMs };
}

function median(values) {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

try {
  const version = spawnSync(piBin, ["--version"], { encoding: "utf8" });
  assert.equal(version.status, 0);
  const report = {
    measuredAt: new Date().toISOString(),
    node: process.version,
    pi: version.stdout.trim(),
    packageVersion: manifest.version,
    runtimeSha256: createHash("sha256")
      .update(readFileSync(runtimePath))
      .digest("hex"),
    trials,
    entries,
    notes: [
      "Actual Pi CLI in fresh processes, only this extension, offline RPC with stdin EOF; no model requests.",
      "Disposable agent directory; YOLO on and both logs off; real settings/install untouched.",
      "One warm-up per condition/cache mode, then alternating source/compiled order on each pair.",
      "JITI_FS_CACHE=0 disables transform caching, not the OS filesystem cache.",
      "CLI wall time includes startup, session lifecycle and shutdown; extension time is Pi's import + factory instrumentation.",
    ],
    modes: {},
  };
  for (const fsCache of [true, false]) {
    const samples = { source: [], compiled: [] };
    const warmup = {
      source: run("source", fsCache),
      compiled: run("compiled", fsCache),
    };
    for (let trial = 0; trial < trials; trial++) {
      for (const condition of trial % 2
        ? ["compiled", "source"]
        : ["source", "compiled"]) {
        samples[condition].push(run(condition, fsCache));
      }
    }
    const medians = {};
    for (const condition of ["source", "compiled"]) {
      medians[condition] = Object.fromEntries(
        ["importMs", "factoryMs", "extensionMs", "cliMs"].map((key) => [
          key,
          median(samples[condition].map((sample) => sample[key])),
        ]),
      );
    }
    const extensionReductionPercent =
      100 * (1 - medians.compiled.extensionMs / medians.source.extensionMs);
    report.modes[fsCache ? "warmTransformCache" : "disabledTransformCache"] = {
      warmup,
      samples,
      medians,
      extensionReductionPercent,
    };
  }
  const out = resolve(
    process.env.LOADING_REPORT ??
      join(packageDir, "docs/architecture/loading-benchmark.json"),
  );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `Pi ${report.pi}; ${report.node}; ${trials} trials per condition`,
  );
  for (const [mode, result] of Object.entries(report.modes)) {
    console.log(
      `${mode}: ${result.extensionReductionPercent.toFixed(1)}% less extension loading time`,
    );
    console.table(result.medians);
  }
  console.log(`Raw report: ${out}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
