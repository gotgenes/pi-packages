/**
 * Bracketed-paste normalization for the inline permission dialog's reason field.
 *
 * A terminal in bracketed-paste mode wraps pasted text in these markers, and
 * the TUI hands the wrapped chunk to the focused component in a single call.
 */

const PASTE_START = "\u001b[200~";
const PASTE_END = "\u001b[201~";
const NEWLINE_RUN = /[\r\n]+/g;

/**
 * Collapse newline runs inside a bracketed-paste chunk to single spaces.
 *
 * The framework line editor deletes newlines outright, which joins the words
 * on either side of a line break; a reason pasted from a multi-line source
 * should stay readable in the single-line field. The markers are preserved so
 * the editor still recognizes the chunk as a paste, and anything that is not
 * a complete paste chunk is returned unchanged.
 */
export function collapsePastedNewlines(data: string): string {
  const start = data.indexOf(PASTE_START);
  if (start === -1) {
    return data;
  }
  const contentStart = start + PASTE_START.length;
  const contentEnd = data.indexOf(PASTE_END, contentStart);
  if (contentEnd === -1) {
    return data;
  }
  const content = data
    .slice(contentStart, contentEnd)
    .replace(NEWLINE_RUN, " ");
  return data.slice(0, contentStart) + content + data.slice(contentEnd);
}
