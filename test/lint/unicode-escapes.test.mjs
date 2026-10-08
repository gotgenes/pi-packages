import { describe, expect, it } from "vitest";

import {
  findUnicodeEscapes,
  formatFinding,
  maskAllButComments,
  maskCode,
  repairUnicodeEscapes,
  run,
  UnparseableSourceError,
} from "../../scripts/lint/unicode-escapes.mjs";
import { memoryIo } from "./memory-io.mjs";

// Every expected character is built from its code point, so no line of this
// file depends on a non-ASCII glyph surviving the edit that wrote it.
const EM_DASH = String.fromCodePoint(0x2014);
const RIGHTWARDS_ARROW = String.fromCodePoint(0x2192);
const GRINNING_FACE = String.fromCodePoint(0x1f600);
const E_ACUTE = String.fromCodePoint(0xe9);

/** A finding with the fields a caller reads, for `toEqual` comparison. */
function finding(line, column, token, replacement) {
  return { line, column, token, replacement };
}

/** `count` spaces, for spelling a masked region without miscounting it. */
function blank(count) {
  return " ".repeat(count);
}

describe("maskCode", () => {
  // A backtick fence's content includes a blank line in each case below: an
  // inline span cannot cross one, so only the fence logic can blank it.
  describe("fenced blocks", () => {
    it("blanks a backtick fence and everything inside it", () => {
      const text = "a\n```js\nx \\u2014\n\ny\n```\nb";

      expect(maskCode(text)).toBe(
        `a\n${blank(5)}\n${blank(8)}\n\n${blank(1)}\n${blank(3)}\nb`,
      );
    });

    it("blanks a tilde fence", () => {
      const text = "~~~\nx\n~~~\nb";

      expect(maskCode(text)).toBe(`${blank(3)}\n${blank(1)}\n${blank(3)}\nb`);
    });

    it("stays open past a closing run shorter than the opener", () => {
      const text = "````markdown\n```\nx\n\ny\n````\nb";

      expect(maskCode(text)).toBe(
        `${blank(12)}\n${blank(3)}\n${blank(1)}\n\n${blank(1)}\n${blank(4)}\nb`,
      );
    });

    it("recognizes a fence indented inside a list item", () => {
      const text = "1. a\n\n   ```bash\n   x\n\n   y\n   ```\nb";

      expect(maskCode(text)).toBe(
        `1. a\n\n${blank(10)}\n${blank(4)}\n\n${blank(4)}\n${blank(6)}\nb`,
      );
    });

    it("runs an unclosed fence to the end of the text", () => {
      const text = "a\n```\nx\n\ny";

      expect(maskCode(text)).toBe(`a\n${blank(3)}\n${blank(1)}\n\n${blank(1)}`);
    });

    it("does not read a backtick line with a backtick in its info string as a fence", () => {
      const text = "```a```\nb";

      expect(maskCode(text)).toBe(`${blank(7)}\nb`);
    });
  });

  describe("inline code spans", () => {
    it("blanks a single-backtick span", () => {
      expect(maskCode("a `x` b")).toBe(`a ${blank(3)} b`);
    });

    it("closes a span only on a run of the opener's exact length", () => {
      expect(maskCode("a ``x ` y`` b")).toBe(`a ${blank(9)} b`);
    });

    it("skips a longer run inside a span rather than closing on it", () => {
      expect(maskCode("a `x `` y` b")).toBe(`a ${blank(8)} b`);
    });

    it("leaves an unmatched backtick as literal text", () => {
      expect(maskCode("a ` b")).toBe("a ` b");
    });

    it("continues a span over a single line break", () => {
      expect(maskCode("a `x\ny` b")).toBe(`a ${blank(2)}\n${blank(2)} b`);
    });

    it("does not continue a span across a blank line", () => {
      expect(maskCode("a `x\n\ny` b")).toBe("a `x\n\ny` b");
    });

    it("reads a backslash-escaped backtick as a literal, not an opener", () => {
      expect(maskCode("\\`x` y`z`")).toBe(`\\\`x${blank(4)}z\``);
    });
  });

  it("preserves the text's length and every line break", () => {
    const text = "p `q`\n```\nr\n```\ns ``t``\n";
    const masked = maskCode(text);

    expect(masked.length).toBe(text.length);
    expect(lineBreaks(masked)).toEqual(lineBreaks(text));
  });
});

describe("maskAllButComments", () => {
  describe("comments it keeps", () => {
    it("keeps a line comment", () => {
      expect(maskAllButComments("a(); // note\n", "a.ts")).toBe(
        `${blank(5)}// note\n`,
      );
    });

    it("keeps a block comment", () => {
      expect(maskAllButComments("a(/* b */);", "a.ts")).toBe(
        `${blank(2)}/* b */${blank(2)}`,
      );
    });

    it("keeps a doc comment across lines", () => {
      expect(maskAllButComments("/**\n * b\n */\nf();", "a.ts")).toBe(
        `/**\n * b\n */\n${blank(4)}`,
      );
    });
  });

  describe("code it blanks", () => {
    it("blanks a string literal", () => {
      const text = 'const s = "\\u2014";';

      expect(maskAllButComments(text, "a.ts")).toBe(blank(text.length));
    });

    it("blanks a template literal, comment-like text in its substitution included", () => {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the substitution is the source under test
      const text = 'const t = `a ${"// no"} \\u2014`;';

      expect(maskAllButComments(text, "a.ts")).toBe(blank(text.length));
    });

    it("blanks a regex literal that spells a comment opener", () => {
      const text = "const r = /\\/\\/ \\u2014/;";

      expect(maskAllButComments(text, "a.ts")).toBe(blank(text.length));
    });

    it("blanks a code span inside a comment", () => {
      expect(maskAllButComments("// a `\\u2014` b", "a.ts")).toBe(
        `// a ${blank(8)} b`,
      );
    });
  });

  describe("languages", () => {
    it("parses TypeScript-only syntax", () => {
      expect(maskAllButComments("const n: number = 1; // c", "a.ts")).toBe(
        `${blank(21)}// c`,
      );
    });

    it("parses a JavaScript module", () => {
      expect(maskAllButComments("export const x = 1; // c", "a.mjs")).toBe(
        `${blank(20)}// c`,
      );
    });

    it("throws on text that does not parse", () => {
      expect(() => maskAllButComments("const x = (;", "a.ts")).toThrow(
        UnparseableSourceError,
      );
    });
  });

  it("preserves the text's length and every line break", () => {
    const text = 'f("x");\n// a\n/* b\n c */\ng(`\n`);\n';
    const masked = maskAllButComments(text, "a.ts");

    expect(masked.length).toBe(text.length);
    expect(lineBreaks(masked)).toEqual(lineBreaks(text));
  });
});

/** The offset of every line feed in `text`. */
function lineBreaks(text) {
  return [...text.matchAll(/\n/g)].map((match) => match.index);
}

describe("findUnicodeEscapes", () => {
  describe("escapes it decodes", () => {
    it("reports an escape in prose with the character it spells", () => {
      expect(findUnicodeEscapes("floor \\u2014 when")).toEqual([
        finding(1, 7, "\\u2014", EM_DASH),
      ]);
    });

    it("accepts uppercase hexadecimal digits", () => {
      expect(findUnicodeEscapes("caf\\u00E9")).toEqual([
        finding(1, 4, "\\u00E9", E_ACUTE),
      ]);
    });

    it("reports a surrogate pair as one finding", () => {
      expect(findUnicodeEscapes("a \\uD83D\\uDE00 b")).toEqual([
        finding(1, 3, "\\uD83D\\uDE00", GRINNING_FACE),
      ]);
    });

    it("decodes the braced form", () => {
      expect(findUnicodeEscapes("a \\u{1F600} b")).toEqual([
        finding(1, 3, "\\u{1F600}", GRINNING_FACE),
      ]);
    });
  });

  describe("escapes it reports without decoding", () => {
    it("does not decode a lone surrogate", () => {
      expect(findUnicodeEscapes("a \\uD83D b")).toEqual([
        finding(1, 3, "\\uD83D", null),
      ]);
    });

    it("does not decode a braced escape past the last code point", () => {
      expect(findUnicodeEscapes("\\u{110000}")).toEqual([
        finding(1, 1, "\\u{110000}", null),
      ]);
    });

    it("does not decode a form feed, which the invisible-character gate rejects", () => {
      expect(findUnicodeEscapes("\\u000c")).toEqual([
        finding(1, 1, "\\u000c", null),
      ]);
    });

    it("does not decode a zero-width space", () => {
      expect(findUnicodeEscapes("\\u200b")).toEqual([
        finding(1, 1, "\\u200b", null),
      ]);
    });

    it("does not decode a non-breaking space", () => {
      expect(findUnicodeEscapes("\\u00a0")).toEqual([
        finding(1, 1, "\\u00a0", null),
      ]);
    });

    it("reports a bare token that lost its backslash", () => {
      expect(findUnicodeEscapes("The floor u2014 when")).toEqual([
        finding(1, 11, "u2014", null),
      ]);
    });
  });

  describe("text it leaves alone", () => {
    it("skips an escape inside a code span", () => {
      expect(findUnicodeEscapes("write `\\u2014` never")).toEqual([]);
    });

    it("skips an escape inside a fenced block", () => {
      expect(
        findUnicodeEscapes("```js\ns.replace('@PH@', '\\u2014')\n```"),
      ).toEqual([]);
    });

    it("skips an escape whose backslash is itself escaped", () => {
      expect(findUnicodeEscapes("frontmatter \\\\u2014 stays")).toEqual([]);
    });

    it("skips a code point written the way prose names one", () => {
      expect(findUnicodeEscapes("U+2014 is an em dash")).toEqual([]);
    });

    it("skips a token embedded in a word", () => {
      expect(findUnicodeEscapes("menu2014 and u2014x")).toEqual([]);
    });
  });

  describe("positions", () => {
    it("counts lines from one", () => {
      expect(findUnicodeEscapes("a\nb \\u2192")).toEqual([
        finding(2, 3, "\\u2192", RIGHTWARDS_ARROW),
      ]);
    });

    it("counts columns in code points after an astral character", () => {
      expect(findUnicodeEscapes(`${GRINNING_FACE} \\u2014`)).toEqual([
        finding(1, 3, "\\u2014", EM_DASH),
      ]);
    });

    it("reports several findings in reading order", () => {
      expect(findUnicodeEscapes("\\u2014 u2014\n\\u2192")).toEqual([
        finding(1, 1, "\\u2014", EM_DASH),
        finding(1, 8, "u2014", null),
        finding(2, 1, "\\u2192", RIGHTWARDS_ARROW),
      ]);
    });
  });

  describe("prose mask", () => {
    it("scans whatever the given mask leaves visible", () => {
      expect(findUnicodeEscapes("`\\u2014`", (text) => text)).toEqual([
        finding(1, 2, "\\u2014", EM_DASH),
      ]);
    });
  });
});

describe("formatFinding", () => {
  it("names the character a decodable escape spells", () => {
    expect(formatFinding("a.md", finding(3, 7, "\\u2014", EM_DASH))).toBe(
      `a.md:3:7: literal escape \\u2014 (--fix writes U+2014 ${EM_DASH})`,
    );
  });

  it("asks for a hand repair of an escape it will not decode", () => {
    expect(formatFinding("a.md", finding(1, 1, "\\u000c", null))).toBe(
      "a.md:1:1: literal escape \\u000c (not a visible character; repair by hand)",
    );
  });

  it("flags a bare token as an escape that lost its backslash", () => {
    expect(formatFinding("a.md", finding(1, 11, "u2014", null))).toBe(
      "a.md:1:11: bare u2014 (an escape that lost its backslash? repair by hand)",
    );
  });
});

describe("run", () => {
  it("reports every finding across files and fails", () => {
    const io = memoryIo({
      "a.md": Buffer.from("x \\u2014\n", "utf8"),
      "b.md": Buffer.from("clean\n", "utf8"),
      "c.md": Buffer.from("y u2014\n", "utf8"),
    });

    expect(run({ paths: ["a.md", "b.md", "c.md"] }, io)).toEqual({
      lines: [
        `a.md:1:3: literal escape \\u2014 (--fix writes U+2014 ${EM_DASH})`,
        "c.md:1:3: bare u2014 (an escape that lost its backslash? repair by hand)",
      ],
      exitCode: 1,
    });
  });

  it("passes a clean tree", () => {
    const io = memoryIo({ "a.md": Buffer.from("`\\u2014` is fine\n", "utf8") });

    expect(run({ paths: ["a.md"] }, io)).toEqual({ lines: [], exitCode: 0 });
  });

  describe("with fix", () => {
    it("decodes, names the file, and passes", () => {
      const io = memoryIo({ "a.md": Buffer.from("x \\u2014 y\n", "utf8") });

      expect(run({ paths: ["a.md"], fix: true }, io)).toEqual({
        lines: ["decoded a.md"],
        exitCode: 0,
      });
      expect(io.files["a.md"].toString("utf8")).toBe(`x ${EM_DASH} y\n`);
      expect(io.writes).toEqual(["a.md"]);
    });

    it("still fails on a finding it cannot decode", () => {
      const io = memoryIo({
        "a.md": Buffer.from("x \\u2014 u2014\n", "utf8"),
      });

      expect(run({ paths: ["a.md"], fix: true }, io)).toEqual({
        lines: [
          "decoded a.md",
          "a.md:1:5: bare u2014 (an escape that lost its backslash? repair by hand)",
        ],
        exitCode: 1,
      });
    });

    it("does not rewrite a file with nothing to decode", () => {
      const io = memoryIo({ "a.md": Buffer.from("y u2014\n", "utf8") });

      run({ paths: ["a.md"], fix: true }, io);

      expect(io.writes).toEqual([]);
    });
  });

  describe("code files", () => {
    const UNPARSEABLE =
      "a.ts: does not parse as JavaScript or TypeScript; comments not scanned";

    it("reports an escape in a comment", () => {
      const io = memoryIo({
        "a.ts": Buffer.from("f(); // x \\u2014\n", "utf8"),
      });

      expect(run({ paths: ["a.ts"] }, io)).toEqual({
        lines: [
          `a.ts:1:11: literal escape \\u2014 (--fix writes U+2014 ${EM_DASH})`,
        ],
        exitCode: 1,
      });
    });

    it("passes an escape in a string literal", () => {
      const io = memoryIo({
        "a.ts": Buffer.from('const s = "\\u2014";\n', "utf8"),
      });

      expect(run({ paths: ["a.ts"] }, io)).toEqual({ lines: [], exitCode: 0 });
    });

    it("masks each file by its own type", () => {
      const io = memoryIo({
        "a.md": Buffer.from('x "\\u2014"\n', "utf8"),
        "b.mjs": Buffer.from('const s = "\\u2014";\n', "utf8"),
      });

      expect(run({ paths: ["a.md", "b.mjs"] }, io)).toEqual({
        lines: [
          `a.md:1:4: literal escape \\u2014 (--fix writes U+2014 ${EM_DASH})`,
        ],
        exitCode: 1,
      });
    });

    it("fails on a file that does not parse", () => {
      const io = memoryIo({
        "a.ts": Buffer.from("const x = (; // \\u2014\n", "utf8"),
      });

      expect(run({ paths: ["a.ts"] }, io)).toEqual({
        lines: [UNPARSEABLE],
        exitCode: 1,
      });
    });

    describe("with fix", () => {
      it("decodes the comment and leaves the string literal", () => {
        const io = memoryIo({
          "a.ts": Buffer.from('const s = "\\u2014"; // \\u2014\n', "utf8"),
        });

        expect(run({ paths: ["a.ts"], fix: true }, io)).toEqual({
          lines: ["decoded a.ts"],
          exitCode: 0,
        });
        expect(io.files["a.ts"].toString("utf8")).toBe(
          `const s = "\\u2014"; // ${EM_DASH}\n`,
        );
      });

      it("does not rewrite a file that does not parse, and still fails", () => {
        const io = memoryIo({
          "a.ts": Buffer.from("const x = (; // \\u2014\n", "utf8"),
        });

        expect(run({ paths: ["a.ts"], fix: true }, io)).toEqual({
          lines: [UNPARSEABLE],
          exitCode: 1,
        });
        expect(io.writes).toEqual([]);
      });
    });
  });
});

describe("repairUnicodeEscapes", () => {
  it("decodes an escape in prose", () => {
    expect(repairUnicodeEscapes("floor \\u2014 when")).toEqual({
      text: `floor ${EM_DASH} when`,
      decoded: 1,
    });
  });

  it("decodes several escapes of different lengths on one line", () => {
    expect(
      repairUnicodeEscapes("\\uD83D\\uDE00\\u2014 \\u{1F600} \\u2192."),
    ).toEqual({
      text: `${GRINNING_FACE}${EM_DASH} ${GRINNING_FACE} ${RIGHTWARDS_ARROW}.`,
      decoded: 4,
    });
  });

  it("decodes whatever the given mask leaves visible", () => {
    expect(repairUnicodeEscapes("`\\u2014`", (text) => text)).toEqual({
      text: `\`${EM_DASH}\``,
      decoded: 1,
    });
  });

  it("leaves report-only findings and code untouched", () => {
    const text = "`\\u2014` u2014 \\u000c \\\\u2014";

    expect(repairUnicodeEscapes(text)).toEqual({ text, decoded: 0 });
  });
});
