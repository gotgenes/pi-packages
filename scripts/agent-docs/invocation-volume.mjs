#!/usr/bin/env node
// What the prompt templates, subagent definitions, and skills cost, by use.
//
// A template's body is paid for when it is invoked: Pi records the expanded
// template as a user message whose first line is the template's H1, and it
// stays in context for the rest of the session. A subagent definition's body
// is the child's system prompt, paid on every dispatch. A skill file under
// .pi/skills/ (a SKILL.md or a reference file beside it) is paid when the
// agent `read`s it from the top. So the cost of each kind is its words times
// its invocations — the workflow corpus's counterpart to always-loaded.mjs.
//
// Words differ by kind. A template or agent counts its body only: Pi strips
// the frontmatter before the model sees it. A skill file counts the whole
// file, frontmatter included, because a `read` returns it verbatim.
//
// Only top-level session transcripts are read. A subagent's own transcript
// (<session>/tasks/*.jsonl) is not, so a skill a child loads is not counted.
//
// Reads the same machine-local session store as model-usage.mjs. The window
// defaults to the 30 days before --until (exclusive, default today UTC); an
// audit passes the same --until to its before and after runs so both count the
// same invocations and differ only in words.
//
// Usage: node scripts/agent-docs/invocation-volume.mjs [--since YYYY-MM-DD]
//   [--until YYYY-MM-DD] [--root DIR] [--sessions-dir DIR] [--prefix NAME]
//   [--total]
//
// Prints CSV `kind,file,words,invocations,volume`, one row per template,
// agent, and skill file, largest volume first; a skill's `file` is its path
// under .pi/skills/. --total prints one line instead:
// `templates=N agents=N skills=N total=N since=DATE until=DATE`.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { countWords } from "./doc-growth.mjs";
import { markdownBody } from "./frontmatter.mjs";
import {
  DEFAULT_PREFIX,
  DEFAULT_SESSIONS_DIR,
  transcriptPaths,
} from "./model-usage.mjs";

const DEFAULT_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A template's match key: the first `# ` line of its body, or "" when the
 * body has none. The first occurrence matters — a template can carry a later
 * H1 inside a fenced example.
 *
 * @param {string} markdown
 */
export function templateHeading(markdown) {
  return (
    markdownBody(markdown)
      .split("\n")
      .find((line) => line.startsWith("# ")) ?? ""
  );
}

/**
 * Every template invocation, subagent dispatch, and skill load in one
 * transcript, in order.
 *
 * A template event's key is the first line of a user message's text — an
 * expanded template begins with its H1, and any other message simply matches
 * no template. An agent event's key is a `subagent` call's `subagent_type`;
 * a resumed dispatch continues an existing child and is not counted. A skill
 * event's key is a `read` call's path under `.pi/skills/` (see skillLoadKey).
 *
 * Only entries whose timestamp t satisfies since <= t < until are yielded,
 * where the bounds are YYYY-MM-DD dates compared against ISO timestamps.
 *
 * @param {Iterable<string>} lines JSONL entries, one per line
 * @param {{ since: string, until: string }} window
 * @returns {Generator<{ kind: "template" | "agent" | "skill", key: string }>}
 */
export function* invocations(lines, { since, until }) {
  for (const line of lines) {
    // Cheap pre-filter: transcripts are large and mostly tool payloads.
    if (
      !line.includes('"user"') &&
      !line.includes('"subagent"') &&
      !line.includes(".pi/skills/")
    )
      continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "message" || typeof entry.timestamp !== "string")
      continue;
    if (entry.timestamp < since || entry.timestamp >= until) continue;

    const { role, content } = entry.message ?? {};
    if (role === "user") {
      yield { kind: "template", key: firstLine(content) };
    } else if (role === "assistant" && Array.isArray(content)) {
      for (const part of content) {
        if (isDispatch(part)) {
          yield { kind: "agent", key: part.arguments.subagent_type };
        }
        const skill = skillLoadKey(part);
        if (skill !== undefined) yield { kind: "skill", key: skill };
      }
    }
  }
}

/**
 * One row per file: body words, invocations counted from `events`, and their
 * product, largest volume first. Events whose kind and key match no file are
 * dropped; a file no event matches reports zero.
 *
 * @param {{ kind: string, file: string, key: string, words: number }[]} files
 * @param {Iterable<{ kind: string, key: string }>} events
 */
export function volumeRows(files, events) {
  const counts = new Map();
  for (const { kind, key } of events) {
    const id = `${kind}\u0000${key}`;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return files
    .map(({ kind, file, key, words }) => {
      const invocations = counts.get(`${kind}\u0000${key}`) ?? 0;
      return { kind, file, words, invocations, volume: words * invocations };
    })
    .sort((a, b) => b.volume - a.volume);
}

/**
 * Every markdown file under a skills directory, recursively, as corpus rows
 * keyed by the path relative to that directory — the key a skill `read`
 * yields. Words are the whole file, frontmatter included, because a `read`
 * returns the frontmatter too.
 *
 * @param {string} skillsDir
 */
export function skillFiles(skillsDir) {
  return readdirSync(skillsDir, { recursive: true })
    .filter((relative) => relative.endsWith(".md"))
    .map((relative) => relative.split(path.sep).join("/"))
    .sort()
    .map((file) => ({
      kind: "skill",
      file,
      key: file,
      words: countWords(readFileSync(path.join(skillsDir, file), "utf8")),
    }));
}

function firstLine(content) {
  const text =
    typeof content === "string"
      ? content
      : (content?.find((part) => part.type === "text")?.text ?? "");
  return text.split("\n")[0];
}

function isDispatch(part) {
  return (
    part.type === "toolCall" &&
    part.name === "subagent" &&
    typeof part.arguments?.subagent_type === "string" &&
    part.arguments.resume === undefined
  );
}

// The path after the last `.pi/skills/` segment, so a relative path, this
// root's absolute path, and a worktree's absolute path share one key.
// `~/.pi/agent/skills/` does not match: its segment is `skills/`, not
// `.pi/skills/`.
const SKILL_PATH = /^(?:.*\/)?\.pi\/skills\/(.+\.md)$/;

/**
 * The skill-file key a `read` call loads, or undefined when the call is not a
 * load. Only a read from the top of the file is a load, counted at the whole
 * file's words: a continuation after Pi's output truncation reads the rest of
 * a load already counted, and a mid-file peek is not a load, as a resumed
 * dispatch is not a new dispatch. A read from the top with a `limit` still
 * counts as a whole load — an overcount for a head-only peek.
 */
function skillLoadKey(part) {
  if (part.type !== "toolCall" || part.name !== "read") return undefined;
  const { path: target, offset } = part.arguments ?? {};
  if (typeof target !== "string" || (offset != null && offset > 1))
    return undefined;
  return SKILL_PATH.exec(target)?.[1];
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    sessionsDir: DEFAULT_SESSIONS_DIR,
    prefix: DEFAULT_PREFIX,
    until: new Date().toISOString().slice(0, 10),
    since: undefined,
    total: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--total") options.total = true;
    else if (flag === "--root") options.root = argv[++i];
    else if (flag === "--sessions-dir") options.sessionsDir = argv[++i];
    else if (flag === "--prefix") options.prefix = argv[++i];
    else if (flag === "--since") options.since = argv[++i];
    else if (flag === "--until") options.until = argv[++i];
    else throw new Error(`unknown option: ${flag}`);
  }
  options.since ??= new Date(
    Date.parse(options.until) - DEFAULT_WINDOW_DAYS * DAY_MS,
  )
    .toISOString()
    .slice(0, 10);
  return options;
}

function corpusFiles(root) {
  const read = (kind, dir, keyOf) =>
    readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .sort()
      .map((name) => {
        const markdown = readFileSync(path.join(dir, name), "utf8");
        return {
          kind,
          file: name,
          key: keyOf(name, markdown),
          words: countWords(markdownBody(markdown)),
        };
      });
  return [
    ...read("template", path.join(root, ".pi", "prompts"), (_, markdown) =>
      templateHeading(markdown),
    ),
    ...read("agent", path.join(root, ".pi", "agents"), (name) =>
      name.replace(/\.md$/, ""),
    ),
    ...skillFiles(path.join(root, ".pi", "skills")),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const window = { since: options.since, until: options.until };
  const events = transcriptPaths(options).flatMap((transcript) => [
    ...invocations(readFileSync(transcript, "utf8").split("\n"), window),
  ]);
  const rows = volumeRows(corpusFiles(options.root), events);

  if (options.total) {
    const sum = (kind) =>
      rows
        .filter((row) => row.kind === kind)
        .reduce((total, row) => total + row.volume, 0);
    const templates = sum("template");
    const agents = sum("agent");
    const skills = sum("skill");
    process.stdout.write(
      `templates=${templates} agents=${agents} skills=${skills} total=${templates + agents + skills} since=${window.since} until=${window.until}\n`,
    );
  } else {
    process.stdout.write("kind,file,words,invocations,volume\n");
    for (const row of rows) {
      process.stdout.write(
        `${row.kind},${row.file},${row.words},${row.invocations},${row.volume}\n`,
      );
    }
  }
}
