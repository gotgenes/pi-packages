---
name: edit-tool
description: |
  Load before a multi-entry `Edit` batch, a scripted bulk substitution or symbol rename,
  wrapping or inserting a block in a source file, or swapping a file against a git ref.
---

# Edit tool

Load this skill before a non-trivial edit: a batch, a scripted substitution, or a structural insertion.

## Batches are atomic

A multi-edit `Edit` call is atomic: if one `oldText` fails to match, the whole batch is rejected and nothing is applied.
Each `edits[]` entry has exactly one `oldText`/`newText` — put a second replacement in a second array entry, never as `oldText2`/`newText2`.
Extra suffixed keys are silently ignored while the tool still reports `Successfully replaced N block(s)`, so count reported blocks against intended edits.
After a rejection, re-apply every intended edit (not just the ones you retried) and run `pnpm run check` to confirm none were silently dropped — but `tsc` passes on a dropped `import type` removal (an unused type import is not an error), so re-read the affected region rather than trusting the check alone.

## Anchoring on decorative or padded lines

When an edit's `oldText` would span a decorative comment rule (a long run of `─`/`═`) or a width-padded table row, anchor on adjacent unique code lines rather than the padded span itself — miscounting it fails the whole atomic batch, and `rumdl fmt` does not re-pad tables for you.
When the rule line is itself the target (deleting a section header with its block), copy it from a fresh `Read` of that region — retyping the dash run is what fails the batch.
When the rule line must be **rewritten** (a new label, so the padding changes), `Edit` has nothing to copy — write the line programmatically (`'─' * (78 - len(label))`).
If you delete such a block by line number with `sed`, re-read the region afterward to confirm you did not remove an enclosing brace.
An `oldText` spanning any non-ASCII character (an em-dash, a box-drawing rule, an ellipsis) must be copied from a fresh `Read`, never retyped: the character can be emitted as a bare newline, and the batch then fails on text you appear to have quoted correctly (Refs #933).
It can also land as an invisible `\x0c` form feed plus literal text (`erence2`, `erence6`), which a comment or a doc string carries past `tsc`, Biome, and the suite.
A pre-commit hook and `pnpm run lint` now catch it, so the byte no longer reaches a commit; see the `markdown-conventions` skill for the repair and the placeholder workaround (Refs #863, #960).
A malformed call — an `oldText` or `newText` you did not mean to write — marks a degraded-emission run: re-read the region your next successful `Edit` lands, since it can match and still drop words.

## Scripted substitutions

A multi-line `perl -0777`/`sed` regex substitution across many similar blocks is a trap — a non-greedy `.*?` group spans block boundaries and silently corrupts a neighbor; collapse repeated multi-line literals with per-block `Edit` calls and reserve scripted substitution for single-line per-symbol renames.
A line-mode `sed -i`/`perl -pi` (no `-0777`) holds one line in the pattern space, so a pattern containing `\n` silently matches nothing and reports success — use `Edit`.
Confirm a scripted edit applied (`git diff --stat`) before reading any result from it — a mutation, or a spike counting `tsc` fallout; a `perl -0pi` that matches nothing exits 0, and its "0 errors" is then a number nobody measured.
A scripted bulk edit across test files cannot tell a mock **producer** from an **assertion**, whatever its regex safety, so its correctness rests on the suite rather than the script.
That holds only where assertions are exact (`toEqual`/`toHaveBeenCalledWith`).
A touched `toMatchObject`/`objectContaining` site absorbs a wrong insertion and still passes — re-read those by hand instead of counting the green run as verification.
Run the full package suite, not the files the rename's own grep matched — a mock *producer* spells the symbol as an object key (`externalPaths:`), which a call-site grep (`\.externalPaths\(`) never sees.
In a `node -e` substitution, write `s.split(a).join(b)`, never `s.replace(a, b)`: the replacement string interprets `$&`, `` $` ``, and `$'`, so shell prose holding `` $` `` duplicates the text before the match.
A replacement containing backslashes is a trap even as a single-line rename — shell, perl, and the regex engine each consume an escape level.
Use `Edit`.
That includes repairing a literal `\uXXXX` an edit body just wrote: re-edit the region with the character typed literally, never a `perl` substitution whose pattern carries the same escape (Refs #864).
A scripted symbol rename also rewrites the prose *around* the symbol, where the old signature's adjectives survive as contradictions ("the zero-arg `getRootPermissionsService()`").
Grep the words that described the old shape (`zero-arg`, `takes no`, the old arity) after the script — no gate flags them.

## Wrapping and inserting blocks

When wrapping existing lines in a new enclosing block (a `describe`, function, or `try`), emit the opening and closing braces as two `edits[]` entries in one `Edit` call (or use `Write`) — a lone opening brace fails the whole file parse, and the close is too far from the open to anchor in the same `oldText`.
Inserting a new *sibling* block (a second `describe`, a new function) mid-file can close the enclosing block early and reparent everything after the seam.
`tsc`, lint, and a green suite all miss it, so anchor the insertion on the enclosing block's own closing line and verify with `grep -n '^describe\|^});'`.

## `pi-autoformat` and source files

It fires on `Edit`/`Write` only, so a file appended with a shell heredoc skips formatting entirely and fails `pnpm run lint` — append source with `Write`/`Edit` too, not just markdown.
It also merges a new `export type { … }` statement into an adjacent one and emits the merge unformatted, so the pre-commit hook rewrites the file and rejects the commit.
Write the merged statement by hand.
