import { describe, expect, it } from "vitest";
import { collapsePastedNewlines } from "#src/authority/bracketed-paste";

/** How the terminal hands a paste to a focused component (pi-tui `terminal.ts`). */
function pasteChunk(content: string): string {
  return `\u001b[200~${content}\u001b[201~`;
}

describe("collapsePastedNewlines", () => {
  it("collapses a line break into a single space", () => {
    expect(collapsePastedNewlines(pasteChunk("one\ntwo"))).toBe(
      pasteChunk("one two"),
    );
  });

  it("collapses a CRLF line break into a single space", () => {
    expect(collapsePastedNewlines(pasteChunk("one\r\ntwo"))).toBe(
      pasteChunk("one two"),
    );
  });

  it("collapses a run of blank lines into a single space", () => {
    expect(collapsePastedNewlines(pasteChunk("one\n\n\ntwo"))).toBe(
      pasteChunk("one two"),
    );
  });

  it("leaves a single-line paste byte-identical", () => {
    expect(collapsePastedNewlines(pasteChunk("no line breaks here"))).toBe(
      pasteChunk("no line breaks here"),
    );
  });

  it("leaves the paste markers in place so the editor still sees a paste", () => {
    const collapsed = collapsePastedNewlines(pasteChunk("a\nb"));
    expect(collapsed.startsWith("\u001b[200~")).toBe(true);
    expect(collapsed.endsWith("\u001b[201~")).toBe(true);
  });

  it("returns ordinary keystroke data unchanged", () => {
    expect(collapsePastedNewlines("\r")).toBe("\r");
    expect(collapsePastedNewlines("a")).toBe("a");
  });

  it("leaves a chunk missing its end marker unchanged", () => {
    // The terminal never splits a paste across calls, so this shape is not a
    // paste to interpret; passing it through lets the editor buffer it.
    expect(collapsePastedNewlines("\u001b[200~one\ntwo")).toBe(
      "\u001b[200~one\ntwo",
    );
  });

  it("collapses only inside the markers, not text typed after the paste", () => {
    expect(collapsePastedNewlines(`${pasteChunk("a\nb")}c\nd`)).toBe(
      `${pasteChunk("a b")}c\nd`,
    );
  });
});
