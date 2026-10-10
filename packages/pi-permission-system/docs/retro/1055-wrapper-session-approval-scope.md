---
issue: 1055
issue_title: "Session approval for wrappers grants unrelated inner executables"
---

# Retro: #1055 Wrapper session-approval scope

## Stage: Retrospective workflow remediation (2026-10-09T03:18:21Z)

### Session summary

The operator requested a branch-based fix making **Allow this session** include the wrapped executable, followed by local installation and PR submission.
The first implementation was committed as `3842d43e85c12841fb8c1f104f9f36719a8f7991`, and PR [#1054] was opened before this issue existed.
The implementation session used manual Red/Green testing and package-level validation, but did not execute `/plan-issue`, `/tdd-plan`, an independent pre-completion review, or the repository-level gates before opening the PR.
This record documents remediation after the operator requested a workflow audit; it does not retroactively credit those omitted planning stages, a tidy-first assessment, or slash-command session naming.

Issue [#1055] records the problem, proposed direction, acceptance criteria, and retrospective provenance.
The operator approved treating this work as outside the current Phase 15 roadmap, without adding a phase step.
That disposition was committed separately as `89288054`.
The roadmap checker reports 22 findings; comparing the real parser/validator's findings before and after the disposition produced identical arrays, so this bookkeeping introduced none of them.
Those existing roadmap findings were not repaired as part of this permission-scope change.

### Independent review and corrected evidence

The parent session had no registered `subagent` tool, so it launched separate Pi CLI processes with fresh contexts, the repository's pre-completion reviewer instructions, and a read-only tool selection.
The reviewer independently ran the repository checks and read the changed source and its consumers; the implementation session did not supply its own passing check results as premises.
This is a CLI-based substitute for the normal subagent dispatch, not a claim that the unavailable tool was called.

The first report returned FAIL on a claim that `xargs -I X X first` substitutes the direct utility name.
Safe probes against the installed `/usr/bin/xargs` refuted that premise: selecting `/usr/bin/printf` on stdin still produced `xargs: X: No such file or directory`, while replacing an argument of a fixed `/usr/bin/printf` printed the substituted value.
The revised reviewer explicitly withdrew the direct-utility claim and found a distinct, reachable nested case: `xargs -I X nohup X first`.
Here `nohup` is fixed, but its executable argument is replaced from stdin, and the original fix generalized the template to `xargs -I X nohup X *`.
The implementation session checked that external mechanism with:

```bash
printf '/usr/bin/printf\n' | /usr/bin/xargs -I X /usr/bin/nohup X '%s\n' nested-executable-probe
```

The installed binaries printed `nested-executable-probe`.
These are synthetic candidate inputs taken from the review and executed against the real local tools, not organic session-log examples or a live interactive Pi reproduction.
They establish the local replacement mechanism, not cross-platform execution semantics.
The revised FAIL described an incomplete fix of pre-existing widening, not a newly introduced permission regression.
The operator approved fixing the finding and re-dispatching before proceeding.

### Follow-up implementation and validation

The follow-up tests first produced 13 failures on the previous implementation.
They cover separated and attached replacement options, an outer privilege wrapper, nested `nohup` and `env`, replaced arity-prefix words, and legacy optional-arity `-i` forms.
Positive cases preserve ordinary argument replacement for a fixed utility.
The real-parser/resolver cases verify that a whole-template grant covers the approved text while a changed argument still asks.

Commit `4dc93fca1567587e8dc61476af186f6498ddb7db` adds the conservative replacement check and updates the architecture consumer entry and user documentation.
It changes session suggestions only; the existing wrapper classification, floor exemptions, and ordinary non-wrapper arity behavior remain unchanged.
An `xargs -I` replacement may generalize ordinary arguments beyond a fixed utility's arity prefix, but a recognized nested wrapper or a replacement-controlled subcommand prefix keeps the whole command without an added wildcard.
Legacy `-i` declines generalization rather than assuming one platform's optional-argument convention.

The implementation session ran these gates on the corrected implementation:

- `pnpm run check`: passed.
- `pnpm run lint`: passed, including invisible-character and Unicode-escape checks.
- `pnpm run test`: passed across all packages; permission-system reported 5770 tests and repository scripts reported 286 tests.
- `pnpm fallow dead-code`: passed.
- `git diff --check`: passed.
- Both permission-system and subagents `verify:public-types` scripts: passed.
- The autoformat real-CLI acceptance project: 2 tests passed.

The follow-up reviewer independently reran the four repository gates and reviewed the delta from `3842d43e` through `4dc93fca`, using the original PR base for context.
Its recorded conclusion is **Overall: WARN**, with no blocking findings; the prior FAIL is resolved.
All eight issue acceptance criteria were code-verified, and the architecture-consumer omission was resolved.
The report retains two verification limitations: `mmdc` is unavailable, so the unchanged Mermaid blocks were not rendered, and cross-platform execution semantics were not independently probed.
The reviewer did not execute the live roadmap checker because it was outside its read-only command allowlist; it inspected the parser/validator and the diff instead.
The implementation session's executable before/after roadmap comparison remains separate evidence rather than a reviewer-run check.

### Captured independent verdict

```text
### Deterministic checks
pnpm run check: PASS
pnpm run lint: PASS
pnpm run test: PASS
pnpm fallow dead-code: PASS

### Acceptance criteria
PASS — 8 ACs code-verified

### Developer documentation
Forward: PASS
Reverse: PASS

### Mermaid diagrams
WARN — mmdc unavailable; unchanged diagrams were not rendered

### Overall
WARN — no blocking findings; prior FAIL resolved.
Mermaid validation and supplemental executable probes remain limited.
```

This is a condensed excerpt of the final independent report, not a new implementation-authored PASS verdict.
The review covered the corrected implementation commit; the subsequent commit adds this stage record only.

### Observations and remaining gates

A static reviewer can be wrong about external execution semantics while correctly identifying a nearby defect.
Challenge the exact premise against the real tool, then re-review the permission effect rather than discarding the whole report or building a fix around the incorrect premise.
Tests passing locally do not establish that upstream CI ran.
The upstream pull-request workflow currently reports `action_required`, so maintainer action is required before its result can be treated as a CI verdict.
Neither the issue nor the PR was closed, and no merge or release was performed.

The dependency setup reported that `prek` was unavailable, so this session does not claim that git hooks or the `committed` executable ran.
Repository lint equivalents were executed explicitly, and the branch's Conventional Commit headers were checked by the independent reviewer.
The original missing issue-first discussion and planning remain historical omissions, not gaps that a backdated plan can erase.
Future contributions should establish the issue/design discussion first and run the independent quality gate before requesting review.

## Stage: Rebase and getopt adaptation (2026-10-10T04:47:13Z)

### Session summary

The operator requested rebasing and implementing the maintainer's [PR comment](https://github.com/gotgenes/pi-packages/pull/1054#issuecomment-6093819529).
The branch was rebased onto upstream `main` at `d5aadf724fca7e6fb5124bc677c0ff7b41136add`; conflicts in the wrapper table comment and architecture record were resolved by preserving upstream grammar behavior and this branch's session-scope documentation.
The original pre-rebase branch remains available locally as `backup/wrapper-session-before-getopt-rebase`.

The session walk now relies on `GETOPT_GRAMMARS` for `sudo`, `env`, `xargs`, and `doas`, retaining the separate option allowlist for table-walk wrappers.
The `xargs` replacement scan consumes options and operands through `XARGS_GRAMMAR`, handles clustered `-I`/`-i` and abbreviated `--replace`, and keeps replacement-controlled nested executables and subcommand prefixes exact.
GNU optional arguments no longer consume the following executable word, and refused modes retain the whole command.
This supersedes the earlier implementation's conservative blanket refusal of `-i`; the previous stage remains a historical record.
The user documentation and architecture entry were updated to describe the current behavior.

### Validation and independent review

The focused presentation suite first reported 20 failures after rebase, then passed with 118 tests after adaptation.
Temporarily disabling the replacement-prefix check made six new replacement-controlled cases fail; the implementation was restored before final validation.
Synthetic CLI probes against the installed `/opt/homebrew/bin/gxargs` used a fixed `/usr/bin/printf` utility and confirmed attached-only optional values, clustered and abbreviated replacement options, and an `-i` token consumed as an `-E` operand.
These are local GNU execution checks, not an interactive Pi reproduction or cross-platform verification.

The implementation session and a fresh-context `pre-completion-reviewer` independently ran `pnpm run check`, `pnpm run lint`, `pnpm run test`, and `pnpm fallow dead-code`; all passed.
The repository test run reported 6033 permission-system tests and 286 repository-script tests.
The reviewer inspected the full rebased PR including the uncommitted adaptation, verified the issue's acceptance criteria, and returned **Overall: PASS**, with no findings.
No Mermaid diagram changed.
No push, upstream CI verification, merge, release, or issue closure was performed in this stage.

### Observations

A rebase can leave a session consumer reading a removed lookup-table row while the shared wrapper peel has already moved to a grammar.
Both locating the inner command and recognizing replacement options must respect that grammar's operand boundaries; an option-looking operand is not itself an option.

[#1054]: https://github.com/gotgenes/pi-packages/pull/1054
[#1055]: https://github.com/gotgenes/pi-packages/issues/1055
