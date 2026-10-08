#!/usr/bin/env node
// Rejects literal Unicode escapes in the prose of markdown files and in the
// comments of JavaScript and TypeScript files.
//
// A model's em-dash can reach a file as the six visible characters of its
// escape rather than the character itself -- #859, #960, and #962 each
// committed or nearly committed one, and #1033 wrote one into a TypeScript
// comment. It is valid markdown and valid code, so rumdl and Biome pass it,
// and it contains no control character, so invisible-characters.mjs passes it
// too.
//
// Code is exempt: the documents that teach this rule quote the escape in
// backticks on purpose, so the scan blanks inline code spans and fenced
// blocks before it looks. In a source file only the comments are prose --
// a string literal spelling an escape is legitimate -- and a backtick quote
// inside a comment is exempt too.
//
// Usage: node scripts/lint/unicode-escapes.mjs [--fix] [paths...]
//
// With no paths it enumerates the tracked markdown files itself. `--fix`
// decodes each escape that spells a visible character and still fails on the
// rest.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * Every literal Unicode escape in the prose of `text`, in reading order.
 *
 * `replacement` is the character the escape spells when decoding it is safe,
 * and null when the finding needs a hand repair: a bare token, a lone
 * surrogate, or an escape for a character nobody can see.
 *
 * `column` counts code points rather than UTF-16 units, so an astral
 * character earlier on the line does not skew the position.
 *
 * `maskProse` blanks whatever is not prose; it defaults to markdown's code
 * spans and fenced blocks.
 *
 * @param {string} text
 * @param {(text: string) => string} [maskProse]
 * @returns {{line: number, column: number, token: string, replacement: string | null}[]}
 */
export function findUnicodeEscapes(text, maskProse = maskCode) {
  return escapeMatches(text, maskProse).map(
    ({ index, token, replacement }) => ({
      ...position(text, index),
      token,
      replacement,
    }),
  );
}

/**
 * One finding rendered as a `path:line:column: ...` line.
 *
 * @param {string} path
 * @param {{line: number, column: number, token: string, replacement: string | null}} finding
 * @returns {string}
 */
export function formatFinding(path, finding) {
  const where = `${path}:${finding.line}:${finding.column}`;
  const { token, replacement } = finding;
  if (!token.startsWith("\\")) {
    return `${where}: bare ${token} (an escape that lost its backslash? repair by hand)`;
  }
  if (replacement === null) {
    return `${where}: literal escape ${token} (not a visible character; repair by hand)`;
  }
  return `${where}: literal escape ${token} (--fix writes U+${hex(replacement.codePointAt(0))} ${replacement})`;
}

/**
 * `text` with every decodable escape replaced by the character it spells.
 *
 * A finding with no replacement is left exactly where it is, and so is
 * anything `maskProse` blanks.
 *
 * @param {string} text
 * @param {(text: string) => string} [maskProse]
 * @returns {{text: string, decoded: number}}
 */
export function repairUnicodeEscapes(text, maskProse = maskCode) {
  const decodable = escapeMatches(text, maskProse).filter(
    ({ replacement }) => replacement !== null,
  );
  let repaired = "";
  let copiedUntil = 0;
  for (const { index, token, replacement } of decodable) {
    repaired += text.slice(copiedUntil, index) + replacement;
    copiedUntil = index + token.length;
  }
  repaired += text.slice(copiedUntil);
  return { text: repaired, decoded: decodable.length };
}

/**
 * The whole command: decode when asked, then report whatever is left.
 *
 * Decoding never satisfies the gate on its own -- the scan runs afterwards
 * over the rewritten files, so a finding that needs a hand repair still fails.
 * A file with nothing to decode is not rewritten.
 *
 * A code file that does not parse is never rewritten, and the scan counts it
 * as a failure: the gate cannot vouch for comments it could not find.
 *
 * @param {{paths: string[], fix?: boolean}} request
 * @param {{readFile: (path: string) => Buffer, writeFile: (path: string, text: string) => void}} io
 * @returns {{lines: string[], exitCode: number}}
 */
export function run({ paths, fix = false }, io) {
  const lines = [];
  if (fix) {
    for (const path of paths) {
      let repair;
      try {
        repair = repairUnicodeEscapes(
          io.readFile(path).toString("utf8"),
          proseMaskFor(path),
        );
      } catch (error) {
        if (error instanceof UnparseableSourceError) continue;
        throw error;
      }
      if (repair.decoded === 0) continue;
      io.writeFile(path, repair.text);
      lines.push(`decoded ${path}`);
    }
  }
  let failures = 0;
  for (const path of paths) {
    const text = io.readFile(path).toString("utf8");
    let findings;
    try {
      findings = findUnicodeEscapes(text, proseMaskFor(path));
    } catch (error) {
      if (!(error instanceof UnparseableSourceError)) throw error;
      lines.push(
        `${path}: does not parse as JavaScript or TypeScript; comments not scanned`,
      );
      failures += 1;
      continue;
    }
    for (const finding of findings) {
      lines.push(formatFinding(path, finding));
      failures += 1;
    }
  }
  return { lines, exitCode: failures === 0 ? 0 : 1 };
}

/** Extensions whose prose is their comments. */
const CODE_EXTENSIONS = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];

/**
 * The mask that leaves a file's prose visible: its comments for JavaScript
 * and TypeScript, and markdown's text outside code for anything else.
 *
 * @param {string} path
 * @returns {(text: string) => string}
 */
function proseMaskFor(path) {
  if (CODE_EXTENSIONS.some((extension) => path.endsWith(extension))) {
    return (text) => maskAllButComments(text, path);
  }
  return maskCode;
}

/**
 * `text` with fenced code blocks and inline code spans blanked to spaces.
 *
 * Every masked character becomes a space and every line feed is kept, so an
 * offset into the result is the same offset into `text`.
 *
 * @param {string} text
 * @returns {string}
 */
export function maskCode(text) {
  return maskCodeSpans(maskFencedBlocks(text));
}

/**
 * `text` with every fenced block, its fence lines included, blanked.
 *
 * A fence opens at any indentation -- this repository nests them in list
 * items -- and closes on a run of the same character at least as long. An
 * unclosed fence runs to the end, as in CommonMark.
 *
 * @param {string} text
 * @returns {string}
 */
function maskFencedBlocks(text) {
  let fence = null;
  const lines = text.split("\n").map((line) => {
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      return blankOut(line);
    }
    fence = openingFence(line);
    return fence ? blankOut(line) : line;
  });
  return lines.join("\n");
}

/**
 * The fence a line opens, or null when it opens none.
 *
 * A backtick fence's info string cannot contain a backtick, which is what
 * keeps an inline span such as a tripled-backtick word from reading as one.
 *
 * @param {string} line
 * @returns {{character: string, length: number} | null}
 */
function openingFence(line) {
  const match = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  const [, run, infoString] = match;
  if (run[0] === "`" && infoString.includes("`")) return null;
  return { character: run[0], length: run.length };
}

/**
 * @param {string} line
 * @param {{character: string, length: number}} fence
 * @returns {boolean}
 */
function closesFence(line, fence) {
  const match = /^\s*(`+|~+)\s*$/.exec(line);
  if (!match) return false;
  const run = match[1];
  return run[0] === fence.character && run.length >= fence.length;
}

/**
 * `text` with every inline code span blanked.
 *
 * A span opens on a backtick run and closes on the next run of exactly the
 * same length within its paragraph. An unmatched run stays literal, and a
 * backslash before punctuation makes that character literal, so an escaped
 * backtick opens nothing.
 *
 * @param {string} text
 * @returns {string}
 */
function maskCodeSpans(text) {
  let result = "";
  let index = 0;
  while (index < text.length) {
    if (text[index] === "\\" && isAsciiPunctuation(text[index + 1])) {
      result += text.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (text[index] !== "`") {
      result += text[index];
      index += 1;
      continue;
    }
    const openerEnd = backtickRunEnd(text, index);
    const spanEnd = closingRunEnd(text, openerEnd, openerEnd - index);
    const end = spanEnd ?? openerEnd;
    const run = text.slice(index, end);
    result += spanEnd === null ? run : blankOut(run);
    index = end;
  }
  return result;
}

/**
 * The offset just past the run of backticks that starts at `start`.
 *
 * @param {string} text
 * @param {number} start
 * @returns {number}
 */
function backtickRunEnd(text, start) {
  let end = start;
  while (text[end] === "`") end += 1;
  return end;
}

/**
 * The offset just past the run that closes a span, or null when none does.
 *
 * The search stops at a blank line, which ends the paragraph.
 *
 * @param {string} text
 * @param {number} from
 * @param {number} length
 * @returns {number | null}
 */
function closingRunEnd(text, from, length) {
  let index = from;
  while (index < text.length) {
    if (text[index] === "\n" && startsBlankLine(text, index + 1)) return null;
    if (text[index] !== "`") {
      index += 1;
      continue;
    }
    const end = backtickRunEnd(text, index);
    if (end - index === length) return end;
    index = end;
  }
  return null;
}

/**
 * Whether the line starting at `start` holds only spaces and tabs.
 *
 * @param {string} text
 * @param {number} start
 * @returns {boolean}
 */
function startsBlankLine(text, start) {
  const end = text.indexOf("\n", start);
  const line = text.slice(start, end === -1 ? text.length : end);
  return /^[ \t]*$/.test(line);
}

/**
 * @param {string | undefined} character
 * @returns {boolean}
 */
function isAsciiPunctuation(character) {
  return character !== undefined && /^[!-/:-@[-`{-~]$/.test(character);
}

/**
 * `text` with everything outside its comments blanked to spaces, and the
 * code spans inside those comments blanked too.
 *
 * The comments come from a real parser, so a string, template, or regex
 * literal that spells a comment opener or an escape stays code. Offsets and
 * line feeds are preserved, as in `maskCode`. Throws when `text` does not
 * parse as the JavaScript or TypeScript its `path` names.
 *
 * @param {string} text
 * @param {string} path
 * @returns {string}
 */
export function maskAllButComments(text, path) {
  const { ast } = parseSource(text, path);
  let comments = blankOut(text);
  for (const { range } of ast.comments) {
    const [start, end] = range;
    comments =
      comments.slice(0, start) + text.slice(start, end) + comments.slice(end);
  }
  return maskCodeSpans(comments);
}

/** Thrown when a code file does not parse, so its comments are unknown. */
export class UnparseableSourceError extends Error {
  /** @param {string} path */
  constructor(path) {
    super(`${path} does not parse as JavaScript or TypeScript`);
    this.name = "UnparseableSourceError";
  }
}

/**
 * @param {string} text
 * @param {string} path
 * @returns {{ast: {comments: {range: [number, number]}[]}}}
 */
function parseSource(text, path) {
  try {
    return typescriptParser().parseForESLint(text, {
      comment: true,
      range: true,
      filePath: path,
    });
  } catch (error) {
    if (error?.name !== "TSError") throw error;
    throw new UnparseableSourceError(path);
  }
}

/** @type {{parseForESLint: Function} | undefined} */
let loadedParser;

/**
 * The `typescript-eslint` parser, loaded on first use so a markdown-only run
 * never pays for it.
 *
 * @returns {{parseForESLint: Function}}
 */
function typescriptParser() {
  loadedParser ??= createRequire(import.meta.url)("typescript-eslint").parser;
  return loadedParser;
}

/**
 * An escape preceded by exactly one backslash -- `\\u2014` is CommonMark's
 * spelling of a literal backslash, and so of a deliberate literal escape --
 * in the four-digit or the braced form.
 */
const ESCAPE = /(?<!\\)\\u(?:\{([0-9a-fA-F]{1,6})\}|([0-9a-fA-F]{4}))/g;

/** A four-digit escape for a low surrogate, anchored where a high one ends. */
const LOW_SURROGATE_ESCAPE = /^\\u(d[c-f][0-9a-f]{2})/i;

/** An escape that lost its backslash, standing alone as a word. */
const BARE_TOKEN = /(?<![\w\\])u[0-9a-fA-F]{4}\b/g;

/** Characters an escape may spell but decoding must not plant. */
const INVISIBLE = /[\p{C}\p{Z}]/u;

/**
 * Every escape and bare token in the prose of `text`, by UTF-16 offset.
 *
 * @param {string} text
 * @param {(text: string) => string} maskProse
 * @returns {{index: number, token: string, replacement: string | null}[]}
 */
function escapeMatches(text, maskProse) {
  const prose = maskProse(text);
  const matches = [];
  let consumedUntil = 0;
  for (const match of prose.matchAll(ESCAPE)) {
    // The low half of a surrogate pair was already read with its high half.
    if (match.index < consumedUntil) continue;
    const decoded = decodedEscape(prose, match);
    matches.push(decoded);
    consumedUntil = decoded.index + decoded.token.length;
  }
  for (const match of prose.matchAll(BARE_TOKEN)) {
    matches.push({ index: match.index, token: match[0], replacement: null });
  }
  return matches.sort((a, b) => a.index - b.index);
}

/**
 * One escape match, joined with the low surrogate that follows a high one.
 *
 * @param {string} prose
 * @param {RegExpExecArray} match
 * @returns {{index: number, token: string, replacement: string | null}}
 */
function decodedEscape(prose, match) {
  const [token, braced, fourDigit] = match;
  const codePoint = Number.parseInt(braced ?? fourDigit, 16);
  if (fourDigit && isHighSurrogate(codePoint)) {
    const low = LOW_SURROGATE_ESCAPE.exec(
      prose.slice(match.index + token.length),
    );
    if (low) {
      const pair = String.fromCharCode(codePoint, Number.parseInt(low[1], 16));
      return { index: match.index, token: token + low[0], replacement: pair };
    }
  }
  return { index: match.index, token, replacement: visible(codePoint) };
}

/**
 * The character for `codePoint`, or null when it is not safe to write.
 *
 * @param {number} codePoint
 * @returns {string | null}
 */
function visible(codePoint) {
  if (codePoint > 0x10ffff) return null;
  const character = String.fromCodePoint(codePoint);
  return INVISIBLE.test(character) ? null : character;
}

/**
 * @param {number} codePoint
 * @returns {boolean}
 */
function isHighSurrogate(codePoint) {
  return codePoint >= 0xd800 && codePoint <= 0xdbff;
}

/**
 * The one-based line and code-point column of a UTF-16 offset.
 *
 * @param {string} text
 * @param {number} index
 * @returns {{line: number, column: number}}
 */
function position(text, index) {
  const before = text.slice(0, index);
  const lineStart = before.lastIndexOf("\n") + 1;
  return {
    line: before.split("\n").length,
    column: [...before.slice(lineStart)].length + 1,
  };
}

/**
 * A code point as at least four uppercase hexadecimal digits.
 *
 * @param {number} codePoint
 * @returns {string}
 */
function hex(codePoint) {
  return codePoint.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Every tracked markdown file that exists on disk.
 *
 * A path staged for deletion is still tracked, so the existence filter keeps
 * the scan from throwing on it.
 *
 * @returns {string[]}
 */
function trackedMarkdown() {
  const listing = execFileSync("git", ["ls-files", "-z", "--", "*.md"], {
    maxBuffer: 64 * 1024 * 1024,
  }).toString("utf8");
  return listing.split("\0").filter((path) => path !== "" && existsSync(path));
}

/**
 * @param {string[]} argv
 * @returns {{fix: boolean, paths: string[]}}
 */
function parseArgs(argv) {
  const options = { fix: false, paths: [] };
  for (const argument of argv) {
    if (argument === "--fix") options.fix = true;
    else if (argument.startsWith("--")) {
      throw new Error(`unknown option: ${argument}`);
    } else options.paths.push(argument);
  }
  return options;
}

/**
 * `text` with every character except a line feed replaced by a space.
 *
 * @param {string} text
 * @returns {string}
 */
function blankOut(text) {
  return text.replace(/[^\n]/g, " ");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { fix, paths } = parseArgs(process.argv.slice(2));
  const { lines, exitCode } = run(
    { paths: paths.length > 0 ? paths : trackedMarkdown(), fix },
    {
      readFile: readFileSync,
      writeFile: (path, text) => writeFileSync(path, text, "utf8"),
    },
  );
  for (const line of lines) process.stdout.write(`${line}\n`);
  process.exitCode = exitCode;
}
