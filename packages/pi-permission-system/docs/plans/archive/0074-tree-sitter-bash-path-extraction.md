---
issue: 74
issue_title: "Replace shell-quote tokenizer with tree-sitter-bash for full AST-based path extraction"
---

# Replace shell-quote tokenizer with tree-sitter-bash for full AST-based path extraction

## Problem Statement

`shell-quote` (landed in #72) correctly handles quoted strings, operators, and shell comments, but it has no heredoc awareness.
Heredoc content is tokenized as plain string arguments, so path-like strings inside heredoc bodies produce false-positive external-directory prompts.

For example, `cat << 'EOF'\n/etc/hosts\nEOF` causes `shell-quote` to emit `/etc/hosts` as a regular string token, which `classifyTokenAsPathCandidate` flags as an external path.

## Goals

- Replace `shell-quote` with `web-tree-sitter` + `tree-sitter-bash` in `extractExternalPathsFromBashCommand`.
- Walk the bash AST to extract only genuine path-bearing argument nodes, skipping heredoc bodies and comments.
- Make `extractExternalPathsFromBashCommand` async (WASM init requires it).
- Update the single call site in `src/handlers/tool-call.ts` to `await` the result.
- Remove `shell-quote` and `@types/shell-quote` dependencies.
- Add regression tests for heredoc false positives.
- Keep `classifyTokenAsPathCandidate` as the path-classification layer (unchanged).

## Non-Goals

- PowerShell support — out of scope; this extension targets bash commands only.
- Changing `classifyTokenAsPathCandidate` heuristics — orthogonal to tokenization.
- Changing any permission surface, config format, or merge precedence.
- Bundling or pre-compiling WASM — the files ship inside `node_modules` and are located at runtime.

## Background

- **Permission surface**: `external_directory` (bash variant).
- **Module**: `src/external-directory.ts` — `extractExternalPathsFromBashCommand` is the entry point; `classifyTokenAsPathCandidate` is the classification helper.
- **Caller**: `src/handlers/tool-call.ts` line ~255 — already in an `async` function, so `await` is trivial.
- **Tests**: `tests/bash-external-directory.test.ts` (462 lines) covers extraction, formatting, and edge cases.
- **Prerequisite**: #72 (shell-quote migration) — already shipped.
- **Reference implementation**: OpenCode (`packages/opencode/src/tool/shell.ts`) uses `web-tree-sitter` + `tree-sitter-bash` with a lazy async init wrapper and walks `command` nodes to extract path arguments.

### How Pi loads extensions

Pi uses `jiti` (TypeScript transpiler) to load extensions at runtime — extensions are not bundled.
This means:

1. WASM files in `node_modules` are accessible via filesystem at runtime.
2. `import(..., { with: { type: "wasm" } })` is not available (jiti does not support import attributes).
3. WASM must be loaded via `fs.readFileSync` or `Parser.init({ locateFile })` pointing to resolved file paths.
4. `createRequire(import.meta.url).resolve("web-tree-sitter/web-tree-sitter.wasm")` reliably locates the files.

### tree-sitter-bash AST structure

For `cat /etc/hosts | grep foo`:

```text
program
  pipeline
    command
      name: word "cat"
      argument: word "/etc/hosts"
    command
      name: word "grep"
      argument: word "foo"
```

For `cat << 'EOF'\n/etc/hosts\nEOF`:

```text
program
  redirected_statement
    command
      name: word "cat"
    heredoc_redirect
      heredoc_start: "EOF"
    heredoc_body
      heredoc_content: "/etc/hosts\n"
    heredoc_end: "EOF"
```

The key difference: `/etc/hosts` is an `argument` in the first case (real path) but `heredoc_content` in the second (not a path).

## Design Overview

### WASM initialization

Create a lazy singleton that initializes the parser once on first use:

```typescript
import { createRequire } from "node:module";
import type Parser from "web-tree-sitter";

let parserPromise: Promise<Parser> | null = null;

function getParser(): Promise<Parser> {
  if (!parserPromise) {
    parserPromise = initParser();
  }
  return parserPromise;
}

async function initParser(): Promise<Parser> {
  const { default: ParserModule } = await import("web-tree-sitter");
  const require = createRequire(import.meta.url);
  const treeSitterWasm = require.resolve(
    "web-tree-sitter/web-tree-sitter.wasm",
  );
  await ParserModule.init({ locateFile: () => treeSitterWasm });

  const parser = new ParserModule();
  const bashWasm = require.resolve(
    "tree-sitter-bash/tree-sitter-bash.wasm",
  );
  const { Language } = ParserModule;
  const bash = await Language.load(bashWasm);
  parser.setLanguage(bash);
  return parser;
}
```

The lazy singleton avoids WASM init cost when no bash commands are executed.
The module-scope `parserPromise` variable is acceptable here because it caches a deterministic resource (the parser), not environment-derived configuration.

### AST walking strategy

Walk `command` nodes at all depths (including inside command substitutions, subshells, pipelines).
For each `command`, extract `word` children that are arguments (not the command name).
Skip nodes whose ancestor chain includes `heredoc_body` or `comment`.

```typescript
function extractArgumentWords(root: Parser.SyntaxNode): string[] {
  const words: string[] = [];
  visitCommands(root, (commandNode) => {
    let isFirstWord = true;
    for (let i = 0; i < commandNode.childCount; i++) {
      const child = commandNode.child(i);
      if (!child) continue;
      if (child.type === "word" || child.type === "concatenation") {
        if (isFirstWord) {
          isFirstWord = false; // skip command name
          continue;
        }
        words.push(child.text);
      } else if (child.type === "command_name") {
        isFirstWord = false; // command_name node counts as the command
      }
    }
  });
  return words;
}
```

The `visitCommands` helper recursively descends into the AST, visiting every `command` node but **not** descending into `heredoc_body` or `comment` nodes.
This naturally handles:

- **Heredocs**: `heredoc_body` children are never visited, so their text is never extracted.
- **Comments**: `comment` nodes are leaf nodes; skipped by the visitor.
- **Command substitutions**: `command_substitution` nodes contain `command` children, which ARE visited — paths inside `$(cat /etc/hosts)` are correctly detected.
- **Pipelines / compound commands**: `pipeline`, `list`, `compound_statement` nodes are transparent containers; their `command` descendants are visited.

### Redirect targets

Redirect targets like `> /tmp/out.txt` appear as children of `redirected_statement` or `file_redirect` nodes, not as `command` arguments.
These must also be scanned — a redirect to an external path is a real filesystem operation.

```text
redirected_statement
  command
    name: word "echo"
    argument: word "hello"
  file_redirect
    destination: word "/tmp/out.txt"
```

The walker will also extract `word` children from `file_redirect` nodes (the `destination` child).

### Async signature change

```typescript
// Before
export function extractExternalPathsFromBashCommand(
  command: string,
  cwd: string,
): string[]

// After
export async function extractExternalPathsFromBashCommand(
  command: string,
  cwd: string,
): Promise<string[]>
```

The single call site in `tool-call.ts` adds `await`:

```typescript
const externalPaths = await extractExternalPathsFromBashCommand(
  command,
  ctx.cwd,
);
```

### Removing shell-quote

`shell-quote` and `@types/shell-quote` are removed from `package.json`.
The `import { parse } from "shell-quote"` in `external-directory.ts` is replaced with the tree-sitter parser.

### classifyTokenAsPathCandidate

This function is unchanged.
It continues to receive plain strings (now extracted from AST nodes instead of `shell-quote` tokens) and applies the same heuristics: skip flags, env assignments, URLs, `@scope/package` patterns, and bare-slash tokens.

## Module-Level Changes

| File                                    | Change                                                                                                                                                                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                          | Remove `shell-quote` from `dependencies`, `@types/shell-quote` from `devDependencies`. Add `web-tree-sitter` to `dependencies`, `tree-sitter-bash` to `dependencies`.                                                                                 |
| `src/external-directory.ts`             | Remove `import { parse } from "shell-quote"`. Add lazy WASM parser init (`getParser`, `initParser`). Add `extractArgumentWords` AST walker. Change `extractExternalPathsFromBashCommand` to `async`. Expose `resetParserForTesting` for test cleanup. |
| `src/handlers/tool-call.ts`             | Add `await` before `extractExternalPathsFromBashCommand` call.                                                                                                                                                                                        |
| `tests/bash-external-directory.test.ts` | Update all `extractExternalPathsFromBashCommand` calls to `await`. Add heredoc false-positive tests. Add command-substitution true-positive tests.                                                                                                    |

## TDD Order

1. **test: add failing heredoc false-positive tests** Add a new `describe("heredoc handling")` block in `tests/bash-external-directory.test.ts` with:
   - Single-quoted heredoc delimiter: `cat << 'EOF'\n/etc/hosts\nEOF` → no external path.
   - Double-quoted heredoc delimiter: `cat << "EOF"\n/etc/hosts\nEOF` → no external path.
   - Unquoted heredoc delimiter: `cat << EOF\n/etc/hosts\nEOF` → no external path.
   - Real path alongside heredoc: `cat /etc/hosts << 'EOF'\nsome content\nEOF` → only `/etc/hosts`.
   - Heredoc with `<<-` (indented): `cat <<- 'EOF'\n\t/etc/hosts\nEOF` → no external path.
   These tests will fail against the current `shell-quote` tokenizer (red).
   Commit: `test: add failing heredoc false-positive cases`

2. **feat: add tree-sitter parser init and AST walker**
   - Add `web-tree-sitter` and `tree-sitter-bash` dependencies, remove `shell-quote` and `@types/shell-quote`.
   - Implement `initParser`, `getParser` (lazy singleton), and `extractArgumentWords` (AST walker) in `src/external-directory.ts`.
   - Rewrite `extractExternalPathsFromBashCommand` to be `async`, using the tree-sitter parser instead of `shell-quote.parse()`.
   - Update `src/handlers/tool-call.ts` to `await` the call.
   - Update all existing test calls to use `await` (the function is now async).
   - All heredoc tests pass (green).
     Full suite passes.
   Commit: `feat: replace shell-quote with tree-sitter-bash for AST-based path extraction`

3. **test: add command-substitution and redirect coverage** Add tests confirming:
   - `echo $(cat /etc/hosts)` → `/etc/hosts` detected (command substitution paths are real).
   - `echo hello > /tmp/out.txt` → `/tmp/out.txt` detected via redirect walker.
   - `cat << 'EOF'\n$(cat /etc/hosts)\nEOF` → no external path (command substitution inside heredoc body is not executed by the outer shell in single-quoted heredocs; but with unquoted delimiters it is — verify correct behavior for both).
   Commit: `test: cover command-substitution and redirect path extraction`

4. **feat: handle redirect targets in AST walker (if not already covered)** If step 2's walker does not already extract redirect destinations, add `file_redirect` node handling.
   Confirm redirect tests pass.
   Commit: `feat: extract paths from redirect targets in AST walker`

5. **test: verify defense-in-depth guards remain necessary**
   - Confirm bare-slash guard: tree-sitter parses `echo /` with `/` as a `word` argument — `classifyTokenAsPathCandidate` must still reject it.
   - Confirm env-assignment guard: `FOO=/usr/local/bin command` — tree-sitter may parse the assignment as a `variable_assignment` node (not a `command` argument), but verify.
   - Confirm URL guard: `curl https://example.com/etc/hosts` — the URL is a `word` argument, `classifyTokenAsPathCandidate` must reject it.
   Commit: `test: verify defense-in-depth guards with tree-sitter tokenizer`

6. **docs: update plan 0072 open questions and close** Mark the tree-sitter follow-up in `docs/plans/0072-shell-quote-tokenizer.md` as addressed by #74.
   Commit: `docs: note tree-sitter follow-up addressed by #74`

## Risks and Mitigations

| Risk                                                                      | Mitigation                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Could this silently weaken a permission?                                  | The AST walker visits `command` nodes at all depths including inside command substitutions and subshells. Paths that were detected by `shell-quote` as string tokens will still be detected as `word` arguments. The only paths we *stop* detecting are inside heredoc bodies — those are false positives (heredoc content is not a path argument). |
| WASM init fails at runtime (file not found, permissions)?                 | Use `createRequire(import.meta.url).resolve()` which follows Node resolution. If the WASM file is missing, the error surfaces immediately on the first bash command and is easily diagnosable. Add a try/catch with a clear error message.                                                                                                          |
| WASM init latency on first bash command?                                  | Parser init is ~50-100ms (one-time). Subsequent calls reuse the singleton. This is imperceptible for a permission prompt flow.                                                                                                                                                                                                                      |
| jiti does not support `import("web-tree-sitter")`?                        | `web-tree-sitter` ships both CJS and ESM entry points. jiti's `import()` falls back to `require()` for CJS modules. If dynamic import fails, use `createRequire` as a fallback.                                                                                                                                                                     |
| npm package size increase (~20MB from tree-sitter-bash native prebuilds)? | The 20MB is native prebuilds + C source in the npm tarball. Only the ~1.4MB `.wasm` file is used at runtime. This is acceptable for a CLI extension. The `files` field in our `package.json` does not include `node_modules`, so it does not affect our package size.                                                                               |
| tree-sitter-bash misparses a command?                                     | tree-sitter-bash is the canonical bash grammar used by GitHub's syntax highlighting and many editors. It handles all POSIX and bash-specific syntax. Edge cases are far fewer than with `shell-quote`.                                                                                                                                              |
| `shell-quote` removal breaks something else?                              | `shell-quote` is only imported in `src/external-directory.ts`. Grep confirms no other usage. Clean removal.                                                                                                                                                                                                                                         |
| Test file churn from async migration?                                     | Every `extractExternalPathsFromBashCommand` call in the 462-line test file must add `await` and the containing test must become `async`. This is mechanical — each test function signature changes from `() => {` to `async () => {`. Do this in one step alongside the implementation to avoid a broken intermediate state.                        |

## Open Questions

- **Variable expansion in tree-sitter**: tree-sitter parses `$HOME/foo` as an `expansion` + `word` concatenation.
  The `text` property of the concatenation node includes the literal `$HOME/foo`.
  `classifyTokenAsPathCandidate` does not expand variables (same as with `shell-quote`), so `$HOME/foo` will not be detected as an external path.
  This is a pre-existing limitation, not a regression.
- **Subshell commands**: `(cat /etc/hosts)` — tree-sitter wraps this in a `subshell` node containing a `command`.
  The walker visits it.
  Verify in tests.
- **WASM loading in Bun-compiled Pi binary**: Pi ships as a Bun-compiled binary.
  WASM files in extension `node_modules` are on the filesystem (not compiled in).
  `createRequire` should resolve them correctly, but this needs manual verification.
