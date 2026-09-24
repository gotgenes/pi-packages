---
status: accepted
date: 2026-07-24
amended: 2026-09-20
---

# 0009 — The bash path projection is a completeness contract, not a best-effort heuristic

## Status

Accepted, as amended 2026-09-20.
This decision states the contract the bash path projection upholds, and settles how a "the gate missed my path" report is triaged.
It is the framing for [#645], which closes two gaps the contract names as in-scope; it composes with `docs/decisions/0003-git-bash-posix-path-semantics.md` (win32 token shapes) and `docs/decisions/0007-model-judge-authorizer-chain-adr.md` (the judge that absorbs false positives).

### Amendment, 2026-09-20 — an interpreter's inline script is a script, not an operand

The bound this record draws around `PATTERN_FIRST_COMMANDS` (§ "Where the bound sits", below) forbade adding a **command** the table does not name, on the argument that an omission only ever over-surfaces: "an unlisted flag costs a prompt, never an operand."

[#863] is the counter-evidence.
`node -e "<script>"` hands the collector a program text in a flag's argument slot; with `node` absent from the table the generic walker emits that text as a token, and a script opening with a `//` comment passes `classifyTokenAsPathCandidate`'s leading-`/` branch.
A third party filed the resulting `external_directory` ask as a bug: the "path" it names is the script itself.
The cost of an omission is real, and it is paid by the user rather than by the table.
The same token also reached the broader `path` surface, which the report did not notice and which carries most of the population — so this is not a `//`-shaped defect of the strict classifier, and a fix confined to it would have left `python3 -c "# c"` and `ruby -e '# x'` standing.

So the bound gains a **fourth** in-scope edit: a command whose inline script the table can identify by *flag role*.
This is narrower than the per-command option table rejected below, and it is narrow for a structural reason rather than a stipulated one.
A matching tool's question is "which positional is the pattern", which needs per-tool argument semantics; an interpreter's is "which flag carries the program", which every interpreter answers the same way and which the existing `script` role already expresses.
The rows therefore assert **zero** pattern positionals, so a script *file* stays an operand (`node build.js /tmp/x` projects both tokens) and the only thing a row can suppress is an argument a listed flag consumed.

The 2026-08-29 rule governs every new row unchanged: a flag is listed as consuming only when it consumes on every supported platform **and in every command sharing the entry**, verified against each tool's parser.
All but one row was verified by running the binary (node v26.9.0, bun 1.4.2, python3 3.14.7, perl 5.34.1, ruby 4.0.7, macOS, 2026-09-20).
The exception is `python`, which does not exist on the authoring host; it shares `python3`'s object on the ground that every implementation the name reaches is a CPython-compatible front end where `-c` takes the following argument.
`node` and `bun` assert identical spellings and get **separate** objects, because the rule is a shared parser and not a shared spelling.
`ruby -E` is deliberately unlisted — on `ruby` it is `--encoding`, and listing it would eat `utf-8` and then read the script as the operand.

Measured over 7937 distinct bash commands from a local review log: 205 accepted `path` candidates and 17 accepted `external_directory` candidates are removed, **0** are added, and no token naming a real file is lost.
Three of the 205 are path-*shaped* — all `perl` substitution expressions whose `/` or `|` delimiters give them separators — and none names a file.
Counted per command node, the interpreter population contributing a non-path-shaped `path` candidate falls from 219 to 18 and `external_directory` from 20 to 3; the remainder is the cluster residual below, plus script *files* handed a shell string as a genuine positional.

What the change creates is one new residual, recorded below: the script text is now invisible to the path surfaces entirely, exactly as a `bash -c` payload is.
Nothing the gates could act on is lost, because the token being dropped was the *whole program*, not a path inside it — `node -e 'require("/etc/passwd")'` yielded the single token `require("/etc/passwd")`, which was never an `external_directory` candidate and matched no `path` rule but the universal fallback.
Whether an interpreter payload should instead *floor to `ask`* like a shell payload is [#886]'s question, not this one's.

### Amendment, 2026-09-15 — a region the parse could not resolve still owes its operands

Every guarantee below is written about a token the parse **found**, and a partial parse failure can drop a whole region before any of them is asked.
`tree-sitter-bash` 0.25.1 cannot parse a heredoc redirect combined with `2>&1` and a pipe, and its recovery leaves the piped command's words under a node the collectors descend for substitutions and never read for text.
Measured through the real `BashProgram`, `cat <<'MSG' 2>&1 | cat /etc/shadow` returned **both** slices empty: `/etc/shadow` reached neither `path` nor `external_directory`, and the command reached no `bash:` rule either ([#875]).

This is a violation of the contract, not a residual.
None of the *What the projection deliberately omits* bullets covers it — the token is an absolute literal in command-operand position, the plainest shape the guarantees name — and the failure is unrecoverable in this record's sense: nothing else in the command carries the path, so no surface sees it at all.

The fix is upstream of the classifiers and changes none of them.
The dropped region's own source text is re-parsed standalone and admitted only when that re-parse is clean, and its tokens are then collected into the same candidate array as the primary parse's — before projection, so a path both name folds to one entry rather than showing twice (ADR 0013's 2026-09-15 amendment records the mechanism and its measured population).

One residual is **added** to the list below by this amendment, deliberately.
A salvaged region is walked under the **unknown** effective base, never the session cwd.
The fragment carries no record of the `cd` in force where it sat, so resolving `cat ../secret` after `cd /outside` against the cwd would name `/projects/secret` — a different file than the one that runs, which a rule for that other path could then allow.
Declining the claim is [#393]'s machinery applied to a new source of unknown base: an absolute or `~` token stays literal-only and is treated as unconditionally external, while a relative or bare token in a salvaged region is not projected.
That is strictly better than the drop it replaces, and it is the recoverable direction.

### Amendment, 2026-09-02 — a statement's own operands are projected

The guarantees below were written as facts about a **command's** operands, and the collector implemented that literally: it read text from `command` and `file_redirect` nodes and nothing else.
A path a statement names directly — a `for`/`select` word-list entry, a `case` subject — is a child of the statement node, so it reached no surface at all ([#839]).

The loop body cannot recover it, and that is what made the gap unrecoverable rather than merely narrow.
`for f in /etc/shadow; do cat $f; done` carries the literal in the word list and the unexpanded `$f` in the body, and the computed-paths residual below correctly declines to resolve `$f` — so the word list is the sole place the path appears, and `for f in ~/other/secret; do cat $f; done` read outside the working directory with nothing gating it.
The asymmetry against `for f in $(cat /etc/shadow)`, which always projected, is what identified this as a gap rather than a residual: the same operand reached the surfaces through a nested command and not when the statement named it outright.

The amendment adds statement operands to the guarantees.
The boundary it draws is that an operand is a value the statement *names*, which is narrower than "a word the statement contains":

- A `case` **pattern** is not an operand.
  It is a glob matched against the subject string, not a path anything touches, so `case $x in /etc/passwd) …` projects nothing.
- A **loop variable** and a **function's own name** are not operands.
  They are names being bound, and the command surface refuses to emit them as command units for the same reason ([#742]).

The projection is otherwise unchanged: a statement operand runs through the ordinary shape classifiers, the existence probe, `cd`-base folding, and the containment boundary, exactly as a command operand does.
It carries no proven effect — no command word owns it and no redirect operator names it — so it consults both directional surfaces most-restrictive, which is the fail-closed base case.

Unlike the two amendments below, this one **newly prompts**: measured over 5191 intact commands of a real review log, 22 change the projected `path` candidates and 3 newly ask on `external_directory` under a real policy.
That cost is accepted on the same layering principle the rest of this record rests on — over-surfacing is recoverable, over-suppression is not — and it shipped as a breaking change.

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
Four edits are in scope:

1. A further spelling of a listed flag (a long form, a glued form).
2. A split, when one spelling has different arity across the implementations a name reaches.
3. A role correction on an existing row.
4. A command whose inline script the table can identify by **flag role**, asserting zero pattern positionals — an interpreter (2026-09-20 amendment, [#863]).

Adding a **flag** the table does not name, or a **command** whose *positional* semantics it would have to encode, is the per-command option table rejected below and needs its own decision.
The original bound rested a second argument on top of that one, and the second argument does not hold: "the direction-of-failure rule makes an omission over-surface, so an unlisted flag costs a prompt, never an operand."
An over-surface is cheap only to the projection.
[#863] was filed as a bug by a third party for an ask naming a token that was a JavaScript program, so the cost is real and is paid by the user; edit 4 exists because of it.
What survives of the original argument is its *direction*: an omission is still the recoverable failure, which is why a row declines a spelling it cannot verify rather than guessing.

Edit 4 is bounded by the structure of the question, not by a stipulation.
A matching tool needs per-tool positional semantics ("which argument is the pattern"); an interpreter needs none, because every one of them takes its program from a flag and its script *file* from an ordinary operand.
That is why the interpreter rows set `patternPositionals: 0`: the only argument a row can suppress is one a listed flag consumed, so a mis-listed flag over-surfaces rather than eating an operand.
Extending the table to a command whose positionals would have to be classified is still out of scope and still needs its own decision.

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
- A **recognized pattern-first flag's value, however it is spelled** — the separated (`grep -e /tmp/patterns`), glued (`grep -e/tmp/patterns`), `=`-embedded (`grep --regexp=/tmp/patterns`), and quoted-in-either-of-the-last-two (`grep --regexp='/tmp/patterns'`, `rg -g'!docs'`, `awk -F':' '/k/{print $2}'`) spellings are one argument to the tool, so each is consumed as the flag's value and never classified as a path ([#957]).
- A **bare token naming an existing filesystem entry** — the existence probe ([#645]).
  Its canonical (symlink-resolved) form is what policy matches, so a symlink is gated by rules naming its target ([#493]).
- A **statement's own operand** — a `for`/`select` word-list entry or a `case` subject ([#839]).
  A `case` *pattern* is not one: it is matched against the subject string rather than naming a path.
- A **plain `$HOME` / `${HOME}` / `$PWD` / `${PWD}` reference**, resolved at token collection before classification ([#694]).
  `$HOME/x` is therefore gated exactly as `~/x` and as the literal absolute spelling, independent of whether the target exists; `$PWD/x` is gated exactly as `./x`.
- Any of the above resolved against the **effective working directory** after literal current-shell `cd` folding; a non-literal `cd` renders the base unknown and keeps tokens literal-only ([#393]).

These guarantees are **positional-invariant**: they hold for a command's own operands wherever that command appears.
A command nested in a substitution is itself gated ([#306]), so its operands are projected whether the substitution sits in argument position (`diff <(cat /etc/shadow)`), in a redirect destination (`echo hi > $(cat /etc/shadow)`), in an interpolating heredoc body ([#741]), in command-name position (`$(cat /etc/shadow)`, `while $(cat /etc/shadow); do …`), or in an env-var prefix assignment (`FOO=$(cat /etc/shadow) echo hi`) ([#742]).
This is a guarantee, not a residual — see the note under "Computed paths" below for the boundary it is easily confused with.

Positional invariance is about a command's operands; a statement's own operands are guaranteed by the bullet above them rather than by the invariance, because no command owns them.
A word that is neither — a `case` pattern, a loop variable, a function's name — is outside both, and deliberately so.

Opacity is handled separately and conservatively: a wrapper command that hides its payload (`bash -c`, `eval`, `sudo`, `xargs`, …) is floored from `allow` to `ask` rather than projected.

### What the projection deliberately omits

These are **accepted residuals**, not open bugs:

- **Nonexistent bare write targets** (`touch newfile`, `mv a newfile`) — the probe cannot see a file that does not exist yet.
  Redirect targets, the common creation path, are collected separately and unaffected.
- **Glued short-option values of a flag no table lists** (`tar -f/tmp/x`) — distinguishing a glued value from a cluster of boolean flags (`-rf`) requires per-command option knowledge.
  A pattern-first command's own listed flags are the bounded exception ([#823]): there the table already names the flag, so `grep -f/tmp/patterns` is read as getopt reads it.
- **A pattern-first flag spelling the table does not name** — an unlisted argument-consuming flag (`rg --pre CMD`), a GNU long-option abbreviation (`grep --reg=x`), a cluster whose argument-taking short flag is not first (`grep -ie pattern`, and for an interpreter `perl -pe 's|a|b|'`), and a token whose flag is quoted *whole* (`grep '-e' pattern f.txt`).
  Each of these spends the pattern positional on the wrong token, or leaves a consumed value unclaimed, which **over-surfaces** — the last operand still reaches the surfaces — so all of them sit on the recoverable side of the layering principle below.
  Widening flag detection to quoted tokens *wholesale* is deliberately declined: it would reclassify a quoted leading-`-` *pattern* as a flag and drop the operand instead, trading a recoverable failure for an unrecoverable one.
  A **narrow** widening is adopted in place of it ([#957]): a recognized flag is read as a flag when its token is a `word` or a `concatenation` whose leading `-` is unquoted (the shape a quoted glued or `=`-embedded value has), while a token quoted whole stays on the positional branch.
  The distinction is load-bearing rather than stylistic: admitting *every* `-`-leading token of any node type reads ADR's own `sd '-old' '-new' file.txt` example as `-o` then `-n`, spends no positional for the second, and drops `file.txt` (`["file.txt"]` under the adopted rule, `[]` under the wider one).
  The interpreter cluster instance resolves the same way as `grep -ie`: the glued rule reads `text.slice(0, 2)`, so `perl -pe` is looked up as `-p`, and listing `-p` would consume the following word on the separated spelling too and drop a real operand.
  Measured after the 2026-09-20 amendment, 9 of the corpus's 188 `perl` command nodes still surface their script this way.
- **An interpreter's inline script, as a payload** — once a `script`-role flag swallows it the program text reaches neither path surface, so a path written *inside* the script is invisible to them (2026-09-20 amendment).
  This is the same opacity a shell payload has, and nothing actionable is lost relative to the behavior it replaces: the token previously projected was the whole program, which was not an `external_directory` candidate and matched no `path` rule but the universal fallback.
  The command **enumerator** is unaffected, so `bash:` rules still govern the invocation and a substitution inside the script still enumerates as its own unit and projects its own operands.
  Whether the payload should additionally floor to `ask`, as `bash -c` does, is deferred to [#886].
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
- **A relative or bare operand inside a region the parse could not resolve** — the salvaged fragment carries no record of the `cd` in force where it sat, so it is walked under the unknown base and only its absolute and `~` tokens project ([#875]).
  A region whose own re-parse also fails projects nothing at all, and the command surface's floor prompts for it naming the whole command line.

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
- [#957] is the fifth report triaged this way, and it landed **inside**: the value of a pattern-first flag was consumed for the unquoted spellings and handed back as a token for the quoted ones — [#694]'s shape once more, this time across a value's quoting rather than a flag's synonyms.
  Measured over 4045 deduplicated commands from one operator's review log, closing it removes a token from **14** commands and adds none anywhere: every removed token is an inline `awk` program (`/api_key:|_key:/{print $2}`, `{printf "%.0f\n", $3}`) that a leading regex delimiter had spelled like an absolute path, and none of the four spelled `/…` names an existing file.
  That is the visible harm the residual's "over-surfaces, so it is recoverable" argument under-prices: the over-surfaced token reached the `external_directory` gate as a false-positive ask for a file the command never opened, which is how a third party reported the family in [#863].
  Only a token whose leading `-` is unquoted is admitted; the wholly quoted spelling (`grep '-e' pattern f.txt`) stays on the recoverable side, so the change costs no operand anywhere in the corpus or in the hand-written cases.
  The rule also reads a recognized flag whose quote opens inside its name (`grep -'e' pattern`, `grep --reg'exp=x'`) as that flag, which the measurement above predates.
  In a second operator's review log (25850 distinct lines of bash commands) that spelling appears only in this change's own test probes, so the measurement stands for it.
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
[#742]: https://github.com/gotgenes/pi-packages/issues/742
[#839]: https://github.com/gotgenes/pi-packages/issues/839
[#821]: https://github.com/gotgenes/pi-packages/issues/821
[#822]: https://github.com/gotgenes/pi-packages/issues/822
[#875]: https://github.com/gotgenes/pi-packages/issues/875
[#823]: https://github.com/gotgenes/pi-packages/issues/823
[#863]: https://github.com/gotgenes/pi-packages/issues/863
[#886]: https://github.com/gotgenes/pi-packages/issues/886
[#957]: https://github.com/gotgenes/pi-packages/issues/957
