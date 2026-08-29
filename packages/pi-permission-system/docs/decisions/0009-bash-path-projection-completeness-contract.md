---
status: accepted
date: 2026-07-24
amended: 2026-08-29
---

# 0009 — The bash path projection is a completeness contract, not a best-effort heuristic

## Status

Accepted, as amended 2026-08-29.
This decision states the contract the bash path projection upholds, and settles how a "the gate missed my path" report is triaged.
It is the framing for [#645], which closes two gaps the contract names as in-scope; it composes with `docs/decisions/0003-git-bash-posix-path-semantics.md` (win32 token shapes) and `docs/decisions/0007-model-judge-authorizer-chain-adr.md` (the judge that absorbs false positives).

### Amendment, 2026-08-28 — glob metacharacters are shell syntax, not regex evidence

The original record listed "a regex" among the shapes that put a token in the *definitely not a path* branch, and the implementation read that as a character test: any token containing `.*`, `.+`, `\|`, `\(`, `\)`, `[...]`, or `^/` was dropped in the shared prelude, ahead of every shape classifier.

A shell bracket glob and a regex character class are spelled identically, so no character test can separate them — and the shell **expands** the glob into real filesystem paths.
The test therefore collapsed a *definitely a path* token into *definitely not*, which is the silent fail-open this record exists to forbid: `cat /etc/[p]asswd` and `rm -rf /tmp/tmp.*` reached no gate at all ([#821]).

The amendment removes the regex shape from the *definitely not a path* branch.
What a pattern argument is is settled by **position**, not spelling: `PATTERN_FIRST_COMMANDS` skips a pattern-first command's inline pattern positional at collection time, which is where the knowledge that `grep`'s first operand is a pattern belongs.
Position is readable from the parse tree; intent is not.

A glob-bearing token is gated by its **literal** text, exactly as `?` and `*` tokens always were: the boundary decision resolves the literal against the effective working directory, so a glob naming somewhere outside the tree prompts.
Gating it by what it *expands to* is a separate mechanism, deferred as a residual below ([#822]).

### Amendment, 2026-08-29 — a pattern-first command's flag table carries the spellings its flags really have

The amendment above rests on `PATTERN_FIRST_COMMANDS` deciding a pattern argument by position.
It did so only for the spellings its table happened to hold — the **short** forms, exact-matched, with the consumed argument discharged only on an `ARG_NODE_TYPES` node.
Four other spellings left the walker still expecting an inline pattern, so it skipped the command's real file operand as though it were that pattern and the path reached no surface ([#823]): an `=`-embedded long flag (`--regexp=`), a glued short flag (`-epattern`), an argument tree-sitter types outside `ARG_NODE_TYPES` (`-A 3`, `-A $N`, `-A $(echo 3)`), and `sed -i` in its GNU spelling, whose dropped operand is a **write** target.

The table therefore carries the long and glued forms of the flags it already lists, and the consumption discharges on whatever node follows.
This is a bounded amendment, not the per-command option table rejected below: the set of *flags* is unchanged, only their spellings are complete.

The same fix closes a fifth spelling with no flag in it at all, found by re-deriving the fourth.
The pattern positional was spent only by a token the parser types as an argument, so a **computed or numeric pattern** passed unseen and the slot was spent on the command's real operand instead: `grep 42 /etc/passwd`, `grep $PATTERN /etc/passwd`, and `rg 3 /etc/passwd` reached no surface at all.
What spends the slot is one word the shell passes, whatever node type it wears — the same correction as the discharge above, one level up.
A redirect hosted on the `command` node (a herestring) is the one exclusion, and it is deliberately the narrow side: miscounting an argument as a redirect drops an operand, while the reverse only over-surfaces.

Which spellings may be listed follows from the direction of failure, and the rule is the durable part:

> **Under**-listing a consuming flag over-surfaces; **over**-listing drops an operand.
> So a flag is listed as consuming only when it consumes on every supported platform **and in every command that shares the entry**, verified against each tool's parser rather than against a shared spelling.

An unrecognized spaced flag merely shifts *which* positional is eaten, and the last operand still survives — `rg --pre CMD pattern /etc/passwd` surfaces the file both before and after.
A flag wrongly listed as consuming eats the script and then the operand, which is exactly how `sed -i` — separate-argument on BSD, glued-only on GNU — became a silent write bypass.
It is resolved by the argument's own emptiness (`-i ''` is the BSD idiom and no GNU spelling produces it), so the projection still reads nothing about the host.

The same knowledge fixes the mirror-image false positive: `collectEmbeddedOptionValues` split every `--opt=value` token with no flag-role awareness, so `grep --regexp=/etc/passwd file.txt` emitted the *pattern* as a path candidate.
A pattern-first command now runs that split from inside its own walker, where the role is known; a generic command keeps the blind split, which is safe precisely because it has no role to contradict.

#### Where the bound sits

`PATTERN_FIRST_COMMANDS` may hold facts about **argument structure** — which positional is a pattern, and whether a flag takes a separate argument — for the commands and flags it already names.
Three edits are in scope:

1. A further spelling of a listed flag (a long form, a glued form).
2. A split, when one spelling has different arity across the implementations a name reaches.
3. A role correction on an existing row.

Adding a **flag** the table does not name, or a **command** it does not name, is the per-command option table rejected below and needs its own decision.
There is no pressure to: the direction-of-failure rule makes an omission over-surface, so an unlisted flag costs a prompt, never an operand.

The bound is not row count — [#823] left the table one row *smaller* than it found it (48 written entries to 47), because deduplicating the `grep`/`egrep`/`fgrep` and `awk`/`nawk` aliases returned more than the long forms consumed.
It is that each row asserts an arity of a **real binary on a real host**, a different kind of fact from "`grep`'s first operand is a pattern" and the only kind this record has had trouble with.
Nothing in the repo re-checks those assertions, so they rot silently as tools change, and two of [#823]'s six defects were rows [#823] itself added in spellings absent from the 4057-command corpus.
A row is therefore priced at more than its line, and the question before adding one is whether a real command drops a real operand today — not whether the tool documents the spelling.

An executable arity oracle — running each listed spelling against the installed binary and failing when the table disagrees — would convert these assertions into verified facts, covering roughly 21 of the 25 long-form rows across the macOS and Ubuntu hosts this repo uses.
It was considered and deliberately not built: the table is at its bound, so the oracle would guard a surface that is not expected to grow.
It is the first thing to build if edit 1 or 2 above is ever exercised at scale.

## Context

The bash path gates decide which argument tokens of a shell command are filesystem operands, so the `path` and `external_directory` surfaces can rule on them.
This projection has been patched five times in response to individual bypass reports:

- [#494] / [#509] — bare filenames (`cat id_rsa`) bypass the `path` surface; fixed with rule-driven promotion, matching the **raw token** against specific non-`*` `path` rules.
- [#520] — win32 backslash-relative tokens (`dir\file`) are not recognized as path-shaped.
- [#533] — Git Bash/MSYS POSIX-absolute tokens resolve wrongly on win32.
- [#583] — a bare `/` (filesystem root) is rejected before the path surfaces.
- [#645] — a bare in-project **symlink** whose *target* is denied, and a path embedded in an option (`--file=/tmp/patterns`).

Each fix was correct in isolation, and each was followed by another report of the same shape.
That recurrence is the signal worth acting on: the reports are not independent bugs but repeated encounters with an unstated boundary.

The structural cause is that token classification was **binary** — a token is a path candidate or it is not — while the domain is **three-valued**:

- **Definitely a path** — the shape says so (leading `/`, `~/`, `..`, a separator, a drive letter).
- **Definitely not a path** — the shape rules it out (a flag, a URL, an env assignment, an `@scope` package).
  A regex was listed here until the 2026-08-28 amendment; it is not decidable from a token's characters, and treating it as such dropped real glob operands.
- **Unknown** — a bare word (`status`, `id_rsa`, `outside-link`), which may name a file or may be a subcommand, branch, or search pattern.

Binary classification collapses *unknown* into *not a path*, and that collapse is silent and fail-open: an unknown token is dropped before any gate sees it, so a permissive bash rule (`cat *`) decides the call and the `path`/`external_directory` policy never runs.
[#509] addressed one slice of *unknown* by consulting the ruleset, which coupled the classifier to policy and still missed any token whose **resolved** identity — not its spelling — is what a rule names.
A symlink is exactly that case: `outside-link` matches no rule by name, and its target is never computed because promotion is decided before resolution.

## Decision

### The principle — candidacy from the filesystem, decision from policy

The projection resolves *unknown* with the filesystem rather than with the ruleset:

> A bare token is a path candidate **iff it names an existing filesystem entry**.
> A promoted candidate is then gated by explicit `path`/`external_directory` rules, or by resolving outside the working tree — never by the universal fallback.

Candidacy and decision are separate concerns with separate sources.
Candidacy asks "is this a file?"
and the filesystem answers authoritatively.
Decision asks "may it be touched?"
and the composed ruleset answers.
The classifier therefore needs no knowledge of policy, and policy needs no knowledge of token spelling.

The universal-fallback exclusion is what keeps this from becoming a prompt firehose, and it needs no new mechanism: `describeBashPathGate` already treats a check whose `matchedPattern` is `undefined` — only the synthesized universal default matched — as unrestricted ([#58]), and `permission-manager.ts` sets `matchedPattern` only for `config`/`session`-layer rules.
A promoted token that matches no explicit rule is therefore unrestricted for free.

### What the projection guarantees

A path reaches the `path` and `external_directory` surfaces when it appears as:

- A **shape-classified token** — absolute (`/x`), home-relative (`~/x`), parent-traversal (`../x`), separator-bearing (`a/b`), a Windows drive-letter path (`C:/x`, `D:\x`), or — under the win32 flavor — a backslash-relative token (`dir\file`, [#520]).
- A **redirect target** (`> out.txt`, `2>/tmp/log`).
- A **value embedded in a long option** (`--file=/tmp/patterns`), split at collection time and classified by the ordinary shape rules ([#645]).
- A **bare token naming an existing filesystem entry** — the existence probe ([#645]).
  Its canonical (symlink-resolved) form is what policy matches, so a symlink is gated by rules naming its target ([#493]).
- A **plain `$HOME` / `${HOME}` / `$PWD` / `${PWD}` reference**, resolved at token collection before classification ([#694]).
  `$HOME/x` is therefore gated exactly as `~/x` and as the literal absolute spelling, independent of whether the target exists; `$PWD/x` is gated exactly as `./x`.
- Any of the above resolved against the **effective working directory** after literal current-shell `cd` folding; a non-literal `cd` renders the base unknown and keeps tokens literal-only ([#393]).

These guarantees are **positional-invariant**: they hold for a command's own operands wherever that command appears.
A command nested in a substitution is itself gated ([#306]), so its operands are projected whether the substitution sits in argument position (`diff <(cat /etc/shadow)`), in a redirect destination (`echo hi > $(cat /etc/shadow)`), or in an interpolating heredoc body ([#741]).
This is a guarantee, not a residual — see the note under "Computed paths" below for the boundary it is easily confused with.

Opacity is handled separately and conservatively: a wrapper command that hides its payload (`bash -c`, `eval`, `sudo`, `xargs`, …) is floored from `allow` to `ask` rather than projected.

### What the projection deliberately omits

These are **accepted residuals**, not open bugs:

- **Nonexistent bare write targets** (`touch newfile`, `mv a newfile`) — the probe cannot see a file that does not exist yet.
  Redirect targets, the common creation path, are collected separately and unaffected.
- **Glued short-option values of a flag no table lists** (`tar -f/tmp/x`) — distinguishing a glued value from a cluster of boolean flags (`-rf`) requires per-command option knowledge.
  A pattern-first command's own listed flags are the bounded exception ([#823]): there the table already names the flag, so `grep -f/tmp/patterns` is read as getopt reads it.
- **A pattern-first flag spelling the table does not name** — an unlisted argument-consuming flag (`rg --pre CMD`), a GNU long-option abbreviation (`grep --reg=x`), a cluster whose argument-taking short flag is not first (`grep -ie pattern`), and a quoted glued value (`rg -g'!docs'`), which parses as a `concatenation` rather than a `word` and so never reaches flag detection.
  Each of these spends the pattern positional on the wrong token, which **over-surfaces** — the last operand still reaches the surfaces — so all four sit on the recoverable side of the layering principle below.
  Widening flag detection to quoted tokens is deliberately declined: it would reclassify a quoted leading-`-` *pattern* as a flag and drop the operand instead, trading a recoverable failure for an unrecoverable one.
- **An optional-argument flag's separated spelling.**
  BSD `sed -i bak` accepts a separate non-empty suffix that the `suffix` role declines, so the suffix spends the pattern positional and the script over-surfaces as a candidate.
  The file operand survives, so this one sits on the recoverable side.

  The same class also produced the amendment's sharpest lesson, and it is recorded here because the rule alone did not prevent it.
  `--context` is spelled identically by `grep` and `rg` and has **opposite arity** in the two: grep parses with getopt, which declares it with an *optional* argument, and a long option declared that way never takes a separate `argv` — `grep --context 2 pat f` searches for `2` in the files `pat` and `f`.
  `rg` parses with clap, where the same spelling consumes.
  Listing it once for both, as a synonym of the shared `-C`, therefore over-listed it for grep and **dropped** `pat`, a real file operand — precisely the unrecoverable failure the rule above forbids, reached by verifying the *spelling* against a man page instead of the *arity* against each tool.
  It is now listed per tool.

  The same audit found the mirror case in `awk`, and it does not resolve the same way.
  The GNU long forms (`--field-separator`, `--assign`, `--source`, `--file`) were shared across `awk`/`gawk`/`nawk`, but the bare name `awk` does not fix a parser: it is GNU awk on Fedora/RHEL, where `--file prog.awk` reads `prog.awk`, and one-true-awk or mawk on macOS and Debian/Ubuntu, where the long option is ignored outright (`awk: unknown option --field-separator ignored`) and the following words are the program text and its input files.
  **Either** arity drops a real operand on the other family, and the projection cannot see which binary the name will reach.

  So a flag whose arity depends on the implementation a name resolves to claims **neither**: it takes the following argument and it spends the pattern positional, so every operand survives on both families and the cost is a token that names nothing and the existence probe discards.
  That is the recoverable direction applied to the arity question itself, and it is what the table asserts for `awk` and `nawk`; `gawk` names GNU awk outright, so it carries the real roles.

  So the rule's test is not "does this tool document the long form" but "does this tool's parser take a separate argument for it", and a shared table row asserts that of every command that inherits it — including every implementation a *name* may resolve to.
  Where no single answer holds, the table is allowed to decline the question rather than guess, which is the option the first two instances of this defect did not have.
- **Glob-filter option values** (`--include=`, `--exclude=`, `--exclude-dir=`) — their values are split like any unrecognized option's and reach the surfaces on their own shape, so `grep --exclude-dir=node_modules` contributes a `node_modules` candidate.
  This over-surfaces and is left alone rather than given table entries ([#823]); an unmatched candidate is unrestricted by the universal-fallback exclusion above.
- **Computed paths** other than the plain `HOME`/`PWD` references above — any other `$VAR`, a command substitution (`$(cmd)`), an operator-bearing expansion (`${HOME:-/tmp}`, `${#HOME}`), and a variable reached through an assignment (`CURRENT="$HOME"; ls "$CURRENT"`).
  The residual here is the **value the substitution evaluates to** — the filename `> $(cmd)` ultimately writes to is not knowable without running `cmd`.
  It is **not** the nested command's own literal operands, which the positional-invariance guarantee above covers.
  Reading this bullet as sanctioning the latter is what let [#741] persist.
  Where a computed value affects the working directory, the unknown-base machinery already degrades conservatively.
  Two ways to close the assignment case were considered and declined during [#694], measured over 2767 deduplicated real bash commands from the permission review log: same-program literal-assignment dataflow, which reaches **45 (1.6%)** of commands but adds stateful dataflow to the AST walk; and flooring any command carrying an unresolved-expansion path operand to `ask`, which would newly prompt on **194 (7.0%)** — the prompt-firehose outcome this ADR rejects for the bare-token case below.
- **Glob expansion** — a glob-bearing token is gated by its literal text, never by the set of paths the shell will expand it into.
  The containment boundary still sees it, because the literal resolves against the effective working directory; an **explicit rule pattern** does not, because it is matched against the token's spelling — `path: {".env": "deny"}` does not match the token `[.]env` ([#822]).
- **Per-command argument semantics** — which positional argument of `grep`/`git`/`kubectl` is a file.
  `PATTERN_FIRST_COMMANDS` encodes a deliberately small exception for pattern-first commands; generalizing it means shipping and maintaining an option table per tool.

### The layering principle — surface deterministically, discriminate with judgment

The deterministic layer biases toward **surfacing**: when a token could be a real operand, it becomes an `ask` rather than a silent allow.
It does not try to decide whether an ask is *warranted* in context — that is the model-judge Authorizer chain's job ([#620], ADR 0007), which reviews a surfaced ask with the full command in view and can dismiss `git grep id_rsa` as a search pattern.

The asymmetry justifying this split: **over-suppression is unrecoverable, over-surfacing is recoverable.**
A path silently dropped is a bypass with no later opportunity to catch it; a path surfaced unnecessarily is a prompt a human or a judge link resolves.
So the deterministic layer never trades a missed operand for a quieter prompt, and per-command cleverness belongs above it, not inside it.

### Determinism and the filesystem

Filesystem state is part of the decision input: existence (this ADR) and symlink targets ([#493]).
The invariant is therefore stated over that input — *same policy + same filesystem state + same command → same decision* — not over the command alone.

This is not a new concession.
Canonicalization made resolution filesystem-dependent when it shipped, and it is the only sound treatment: a symlink's meaning simply is not a property of its name.
Ambient, non-filesystem host state (environment variables, which shell binary was resolved, `cygpath` output) remains excluded, per ADR 0003 — with two named, closed exceptions ([#694]):

- **`HOME`**, resolved via `os.homedir()`.
  This is not a widening: `expandHomePath` already resolved `~` and `$HOME` in config rule patterns, `piInfrastructureReadPaths`, and path policy literals, so the exception existed and only the bash projection disagreed with it.
- **`PWD`**, resolved to the projection's own effective base.
  It reads no environment at all, so it is strictly more deterministic than `HOME`.

The set is closed: adding a third name is an ADR amendment, not an implementation detail.
Every other variable keeps its literal text, so ADR 0003's rejection of `cygpath` shell-outs and MSYS environment detection stands untouched.

Empirically the probe is highly selective: over 2358 deduplicated real bash commands from the permission review log, 3535 bare tokens survived the rejection prelude and **118 (3.3%)** named an existing entry.
Cost is ~0.04 ms p95 per command, ~19% of the already-paid tree-sitter parse.

## Rejected alternatives

- **Promote every bare token to the `path` surface (literal read-tool parity).**
  Rejected: the universal fallback defaults to `ask`, so every bare argument of every command (`git status`, `npm run build`) would prompt.
  Parity with the read tool is the wrong target — a read-tool input is known to be a path, and a bash argument is not.
- **Keep rule-driven promotion and widen it** (match `*` patterns, or match canonical forms too).
  Rejected: it couples the classifier to the ruleset, makes candidacy depend on policy shape, and — matching spelling rather than identity — still cannot see that `outside-link` is `.some.secret`.
- **Floor to `ask` whenever a bare token cannot be proven safe.**
  Rejected: this defeats any `bash` allow rule under a restrictive path policy, which is the configuration users reach for precisely to reduce prompting.
- **Per-command argument tables.**
  Rejected as a deterministic-layer mechanism: unbounded maintenance surface, and it duplicates in brittle static data what the judge link ([#620]) does with the command in context.
  Completing the *spellings* of the flags `PATTERN_FIRST_COMMANDS` already lists is not this ([#823]); the 2026-08-29 amendment states where that bound sits.
  Auditing each tool's full option list for unlisted consuming flags was considered at the same time and declined on the direction-of-failure rule — the omissions it would fix over-surface, while each new entry is a fresh chance to over-list and drop an operand.
- **Adding `number` to `ARG_NODE_TYPES`** to fix the `-A 3` discharge.
  Rejected: that set also feeds `commandArgumentWords` (the effect-retraction guards) and generic collection, so widening it would change effect attribution and emit numeric tokens for every command in the package.
  The consumption is discharged on whatever node follows instead — the question is "whose argument is this", which is local to the walker ([#823]).

## Consequences

- A "the bash gate missed my path" report is now triaged against this contract: it is either **inside** it (a bug — the projection failed a guarantee) or **outside** it (an accepted residual, or a judge-layer concern).
  This is the durable outcome; the recurrence in Context was a symptom of having no such test.
  Four reports have been triaged this way so far, and all four landed **inside** the contract on the same shape: a guarantee met inconsistently depending on how the token happened to be spelled or positioned.
  [#694] is the first, and it split: its `$HOME`/`${HOME}` half was **inside** (the package resolved `$HOME` for patterns and path literals but not for bash tokens, so a guarantee was inconsistently met) and was fixed; its assignment-dataflow half was **outside** and was declined with the numbers above.
  A single report landing on both sides is the expected outcome of having the line drawn.
- [#741] is the second report triaged this way, and it landed **inside**: a substitution's operands were projected in argument position but not when the substitution sat in a redirect destination or an interpolating heredoc body, so a guarantee was met inconsistently across positions — the same shape as [#694]'s `$HOME` half.
  The fix names the hosting concept once (`EXECUTION_HOST_TYPES` in `access-intent/bash/nested-execution.ts`), shared by the command surface and the path surface so the two cannot drift on what counts as a nested execution.
  Measured over 2950 deduplicated real bash commands, **0** hosted a substitution in a redirect target and **0** carried an unquoted heredoc with one, so closing it produced no new prompting on realistic traffic.
- [#821] is the third report triaged this way, and it landed **inside**: the *shape-classified token* guarantee was met inconsistently depending on which metacharacters a token happened to contain, the same shape as [#694]'s `$HOME` half and [#741]'s redirect-hosted operands.
  Measured over 3995 deduplicated real bash commands, deleting the character test newly surfaces an external path for **2** (both true positives) and adds a `path` rule candidate for **66** (1.65%), all of them `jq` filters, `sed` scripts, and prose strings that a rule must name explicitly to restrict.
  The heuristic's own motivating commands project identically without it, because `PATTERN_FIRST_COMMANDS` — added after it — already suppresses them.
  That subsumption was complete for a pattern-first command's *positional* and *space-separated short-flag* pattern arguments, and not for the flag spellings its walker mis-tracked, whose separate defect the character test had been masking in part; that defect is [#823], fixed next.
- [#823] is the fourth report triaged this way, and it landed **inside**: the guarantee held for a pattern-first command's short flag spellings and failed for the long, `=`-embedded, and glued forms of the *same* flags — [#694]'s shape once more, this time across a flag's own synonyms.
  Its severity is the reverse of [#821]'s: what was dropped is the command's real **operand**, not a pattern, so `grep -A 3 pattern /etc/passwd` and `sed -i 's/a/b/' /etc/hosts` reached no surface at all.
  Measured over 4057 deduplicated real bash commands, closing it changes the external set for **1** (a true positive, gaining a token) and the rule-candidate set for **3**, with **0** tokens lost anywhere — two of the three recover operands and the third correctly stops emitting `rg --glob` filter values as paths.
  The GNU-only spellings are absent from that corpus (macOS traffic), so `sed -i 's/…/'` and `--in-place=` are covered by hand-written cases instead, as is the computed-pattern spelling — closing it changes **no** projection over the same 4057 commands.
  Two of the residuals above were found by the pre-completion review and by re-deriving its own finding, not by the corpus: a measurement over real traffic prices a change, and does not enumerate a mechanism's inputs.
- The [#509] promotion thread is deleted: `PathRuleTokenMatcher`, `PermissionManager.getPromotablePathTokenMatcher`, and the five-layer parameter thread from manager to resolver.
  The classifier is once again pure and policy-free.
- `PathNormalizer` gains `entryExists`, keeping the filesystem edge in the same object that owns canonicalization; the classifiers stay pure shape functions.
- Bare tokens naming existing files become gateable, so a config using `path`/`external_directory` denies now sees operands it previously missed — a breaking behavior change on upgrade ([#645]), remediated with `path`/`external_directory` allow patterns.
- Expansion resolution lives at token collection (`resolveNodeText` → `shell-variable-expansion.ts`), never in the classifiers.
  Teaching `classifyTokenAsPathCandidate` a `$HOME` prefix instead would have put the home-directory vocabulary in a second place and reproduced the drift that caused [#694]; resolving upstream keeps the classifiers pure shape functions that need no per-variable knowledge.
- The probe adds one `lstat` per prelude-surviving bare token with a known base.
  If a future workload makes that cost material, the fallback is to gate the probe on "any explicit `path`/`external_directory` restriction exists in config" — a pipeline-level consult that still keeps the classifier policy-free.

[#58]: https://github.com/gotgenes/pi-packages/issues/58
[#393]: https://github.com/gotgenes/pi-packages/issues/393
[#493]: https://github.com/gotgenes/pi-packages/issues/493
[#494]: https://github.com/gotgenes/pi-packages/issues/494
[#509]: https://github.com/gotgenes/pi-packages/issues/509
[#520]: https://github.com/gotgenes/pi-packages/issues/520
[#533]: https://github.com/gotgenes/pi-packages/issues/533
[#583]: https://github.com/gotgenes/pi-packages/issues/583
[#620]: https://github.com/gotgenes/pi-packages/issues/620
[#645]: https://github.com/gotgenes/pi-packages/issues/645
[#694]: https://github.com/gotgenes/pi-packages/issues/694
[#306]: https://github.com/gotgenes/pi-packages/issues/306
[#741]: https://github.com/gotgenes/pi-packages/issues/741
[#821]: https://github.com/gotgenes/pi-packages/issues/821
[#822]: https://github.com/gotgenes/pi-packages/issues/822
[#823]: https://github.com/gotgenes/pi-packages/issues/823
