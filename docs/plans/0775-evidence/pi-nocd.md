# Evidence brief: pi-nocd

## Purpose signal

The package exists to add one missing *rule* to the system prompt: a prohibition against prefixing shell commands with a `cd` into the session's own working directory.
`packages/pi-nocd/README.md` §Why states the gap precisely — Pi already emits a `Current working directory: <path>` footer that survives downstream shaping, so "What Pi ships **nowhere** — default or shaped — is any *instruction* against `cd`-prefixing the CWD.
The footer is a bare statement of fact, not a rule, so the habit of prefixing commands with `cd $(pwd) &&` survives."
The same reasoning is repeated verbatim in the module docstring of `packages/pi-nocd/src/working-directory-prompt.ts` and in `packages/pi-nocd/src/index.ts`.

The mechanism is one hook and one block.
`packages/pi-nocd/src/index.ts` registers a single `before_agent_start` handler returning `{ systemPrompt: ensureWorkingDirectoryPrompt(event.systemPrompt, ctx.cwd) }`, and the README's "How it works" table lists that hook as the package's entire behavior surface.
`package.json` describes it as an extension "that injects the resolved working directory into the system prompt so the agent never cd-prefixes the current working directory"; the root `README.md` (line 18) summarizes it as a "System-prompt guard against cd-prefixing the working directory".

The motivating harm is concrete and recorded in issue #640: subagents given an isolated git worktree prefixed every bash command with `cd <parent's real project path> &&`, "walking themselves back into the shared main checkout and defeating the isolation", and committed into the parent's checkout.

## In-scope signal

The 12-commit history shows four kinds of accepted change.

Initial capability — `commit 9eb42e2` (`feat(pi-nocd): add extension forbidding cd-into-cwd prefixes`) added the hook, the block forbidding both the literal `cd <path> &&` and the generic `cd $(pwd) &&` forms, and idempotent appending "so chained handlers do not stack duplicates".

Correctness of the block under prompt inheritance — `commit a169592` (`fix(pi-nocd): rewrite an inherited working-directory block to name the current cwd`, Refs #640) changed the idempotence guard so a block *this module wrote* naming a different directory is rewritten in place, because "the child kept a block asserting that shell commands already execute in the parent's directory — precisely the claim that walks an isolated child out of its workspace."
Tests for that behavior live in `packages/pi-nocd/test/working-directory-prompt.test.ts` under `describe("inherited block naming another directory")`, covering rewrite-in-place, position stability, and repeat-application stability.

Preparatory tidying ahead of that fix — `commit 814468c` extracted the sentence prefix into a constant ("The prefix is about to be read back to recognize an existing block"), and `commit d77945b` renamed `appendWorkingDirectoryPrompt` to `ensureWorkingDirectoryPrompt` because "'append' would describe only one of its outcomes".

Packaging and docs hygiene — `commit 94e7b73` and `commit 814acc4` narrowed the published `files` allowlist to runtime files only, and `commit e358556` documented the inherited-block rewrite in the README.

## Candidate non-goals

- **Owning the `# Working Directory` heading, or editing prompt content the extension did not write** — a section under the same heading written by another handler is deliberately left untouched.
  `packages/pi-nocd/README.md` states "A section under the same heading that this extension did not write (e.g. another handler's) is left alone: a block is recognized by its heading *and* its `Shell commands already execute in` sentence, not the heading alone."
  Implemented by `findOurBlock` in `packages/pi-nocd/src/working-directory-prompt.ts` and pinned by the test "leaves a foreign block under the same heading untouched" (`packages/pi-nocd/test/working-directory-prompt.test.ts`); introduced in `commit a169592`.

- **Telling the agent *what* its working directory is** — the package supplies the prohibition, not the fact.
  `packages/pi-nocd/README.md` §Why: "It repeats the literal resolved path (from `ctx.cwd`) only to make the forbidden `cd <path> &&` example concrete, not because the path is otherwise unavailable to the agent."
  This was an explicit correction, not an implicit position: the retro records that the original rationale assumed "the agent never sees the resolved path", the user challenged it, and "the real gap was the missing *prohibition*, not the path" — a correction round across three files (`packages/pi-nocd/docs/retro/0001-create-pi-nocd-extension.md`, "What caused friction (agent side)").
  The path-reporting role belongs to Pi's own prompt footer.

- **Registering agent tools or commands** — the package's surface is the single `before_agent_start` hook and nothing else.
  The retro records that `@earendil-works/pi-ai` was copied wholesale from a sibling package's dependency block and removed because "`pi-nocd` registers no tools and never imports `Type`", after the `fallow dead-code` CI gate failed (`packages/pi-nocd/docs/retro/0001-create-pi-nocd-extension.md`).
  `packages/pi-nocd/package.json` carries no `pi.tools` entry and only `@earendil-works/pi-coding-agent` as a peer dependency; the README's "How it works" table lists exactly one row.

## Adjacent routing signal

Prompt-preamble shaping -> **pi-anthropic-auth** (external).
`packages/pi-nocd/README.md` §Why treats that extension's behavior as a given it depends on rather than a concern it duplicates: it "only rewrites the preamble span and preserves the footer". pi-nocd appends after the fact and does not shape the preamble itself.

Child-session prompt assembly -> **pi-subagents**.
Issue #640 locates the root mechanism in `buildAgentPrompt` (`packages/pi-subagents/src/session/prompts.ts`), which "prepends the parent's full system prompt verbatim ahead of the child's own `envBlock`".
The fix was nonetheless made in pi-nocd, as a rewrite of its own block (`commit a169592`) — pi-nocd accommodates verbatim inheritance rather than asking the subagents core to change how it assembles prompts.

Workspace isolation for child sessions -> **@gotgenes/pi-subagents-worktrees**.
`packages/pi-nocd/README.md` §Why names it as the source of the isolated-workspace case that motivates the rewrite ("a child given an isolated workspace (for example a git worktree from @gotgenes/pi-subagents-worktrees) would be told that shell commands already execute somewhere they do not"). pi-nocd corrects the *claim* in the prompt; the worktree package owns creating and branching the workspace (`packages/pi-subagents-worktrees/README.md`).

Runtime gating of bash commands -> **pi-permission-system** ("Permission enforcement for the Pi coding agent", root `README.md` line 10).
This routing is inferred from package descriptions, not from a recorded redirection — see `## Gaps`.

No external pressure has been recorded against this package.
The closed-unmerged non-owner PR query returned nothing matching `nocd`, and the closed `NOT_PLANNED` issue search for `nocd` returned nothing.
There are no declined or redirected external requests to mine; every commit is owner-authored, and the package has no `docs/plans/` and no architecture or decision records.

## Gaps

**Instruction versus enforcement.**
The artifacts never state that pi-nocd will not *block* a `cd`-prefixed command at execution time — it simply does not.
The strongest available hint is that issue #640, whose harm was real (children committing into the parent's checkout), was closed with a prompt-block rewrite (`commit a169592`) rather than any runtime guard.
That is a decision point, but the reasoning was not recorded.
Confirming it as a boundary needs an explicit statement that prompt instruction is the intended enforcement level and that command interception belongs to a permission layer.

**Configurability.**
`packages/pi-nocd/package.json` defines no config schema, and neither README nor source mentions options — no way to reword the block, disable it per session, or opt a directory out.
This is absence, not a recorded boundary.
Confirming it needs a statement on whether the wording is fixed by design (so the block stays recognizable to `findOurBlock`) or merely unimplemented.

**Scope of the injected rule beyond `cd`.**
The block currently carries exactly one prohibition.
Nothing in the artifacts says whether pi-nocd would accept a second shell-hygiene rule (quoting globs, `rg -r`, `zsh` `=`-expansion — all of which live in the repo's own `AGENTS.md` §"Shell and search"), or whether it stays a single-rule extension.
A related global `APPEND_SYSTEM.md` "Shell Commands" rule is referenced from `packages/pi-subagents/docs/retro/0280-rename-agent-to-subagent.md` line 88, which suggests the operator maintains prompt rules in more than one place, but the division of labor between them is unrecorded.

**Non-shell path guidance.**
The injected block addresses shell commands only.
Whether file-tool path handling (repo-relative versus absolute paths) is in or out of this package's remit is unstated.

**Scope of the "left alone" rule.**
The extension leaves a foreign `# Working Directory` section untouched, but the artifacts do not say what should happen when Pi itself or another extension starts emitting an equivalent prohibition — whether pi-nocd should then become a no-op or keep appending.

**Documentation depth.**
There is exactly one internal document (`packages/pi-nocd/docs/retro/0001-create-pi-nocd-extension.md`), and most of its content concerns monorepo release plumbing rather than the extension's design.
Most of this brief's boundary evidence comes from the README §Why and two commit bodies; the operator must supply anything the charter needs beyond them.
