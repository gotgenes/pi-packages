---
issue: 1055
issue_title: "pi-permission-system: session approval for wrappers grants unrelated inner executables"
pr: 1054
---

# Retro: #1055 — session approval for wrappers grants unrelated inner executables

## Stage: PR Review (2026-10-10T20:33:21Z)

### Session summary

PR #1054 (@plucury) narrows the bash "Allow this session" suggestion for an indirection wrapper from the wrapper's first word (`nohup *`) to the wrapper plus the inner command's arity prefix (`nohup mytool *`).
The defect is real on current `main`: a session grant recorded from one wrapped command authorizes every executable behind the same wrapper.
The operator chose to adopt the capability with a simplified design, planned via `/plan-issue #1055`, using the PR as reference rather than the merge target.

### Evaluation

#### Verify gate (against `main` at `ea45bcd3`; the PR's base `d5aadf72` is its ancestor)

- Reproduced with a throwaway Vitest file driving the gate's own decision: `BashProgram.parseSync` → `resolveBashCommandCheck` over a real `PermissionResolver` and `createInMemoryManager`, with the session ruleset holding `sessionRule("bash", suggestBashPattern(asking.command))`.
  The input was synthetic commands (`<wrapper> mytool first`), run in-library, no extensions in between.
- Under each of the policies `{"*":"allow"}`, `{"*":"ask"}`, and `{"*":"ask","rm *":"deny"}`, approving `nohup mytool first` records `nohup *`, after which `nohup othertool second` and `nohup rm -rf /tmp/x` both resolve `allow` with `source: "session"`.
  The same held for `sudo`, `env FOO=bar`, `xargs`, `timeout 5`, and `sudo -u root nohup` (the last recorded `sudo *`).
- Not already fixed: `suggestBashPattern` (`src/presentation/pattern-suggest.ts`) on `main` is `prefix(tokens)` with no wrapper awareness; its last five commits are unrelated label/pattern-list work.
- Not mitigated elsewhere: the grant is honored by the session layer, and `resolveCommandUnit` (`src/handlers/gates/bash-command.ts`) skips the wrapper floor for a session-granted unit (`!isSessionGrant(base)`), by design.
  The suggestion is honest in the dialog label, so this is an over-broad offer rather than a silent bypass — but least privilege is this package's first priority.
- Pre-existing and out of scope (observed, not caused by the PR): a config `rm *: deny` does not reach `nohup rm -rf /tmp/x` (it asks), and `command`/`exec` are outside the wrapper vocabulary (`command mytool a` still suggests `command *`).

#### Checks (run in a scratch worktree at the PR head `85a3d599`)

- `pnpm run check`: pass.
- `pnpm run lint`: pass.
- `pnpm --filter @gotgenes/pi-permission-system run test`: 180 files / 6033 tests pass.
- `pnpm fallow dead-code`: pass.
- `pnpm fallow audit --base origin/main` — the CI step that failed upstream (run `38025670435`, step "Fallow audit"): **fails**.
  New functions above threshold: `sessionCommandIndex` (cyclomatic 24, cognitive 24), `xargsReplacementMarker` (cognitive 18), `sessionReplacementPrefixKnown` (cognitive 16).
  The duplication finding (`shortFlagCIndex` vs `scripts/measure-wrapper-transparency.mjs`) is inherited code surfaced because the file changed.
  The PR body's validation list omits the audit gate.

#### What is valuable

- The capability and the suggestion shape: keep each wrapper layer with its options/operands, apply `bash-arity.ts`'s `prefix` to the inner command, always use a space before the trailing wildcard (`compileWildcardPattern` already makes a trailing `*` optional, so a bare `nohup mytool` still matches).
- Fail-closed fallback: an unproven peel returns the whole command with no wildcard (`sessionCommandIndex` → `null`).
  The shell-metacharacter screen over whitespace-split tokens is acceptable precisely because it only ever declines generalization.
- Reusing `wrapper-analysis.ts`'s vocabulary (`classifyWrapperWords`, `innerCommandIndex`, `GETOPT_GRAMMARS`) rather than a parallel wrapper list.
- The gate round-trip tests in `test/handlers/gates/bash-command.test.ts` (real parser + resolver: the selected inner command is session-allowed, a different executable behind the same wrapper still asks) and the `describeToolGate` label/grant test in `test/handlers/gates/tool.test.ts`.
- The `docs/session-approvals.md` paragraph, trimmed to the simplified behavior.

#### What to change

- **Drop the `xargs` replacement analysis** (`sessionReplacementPrefixKnown`, `xargsReplacementMarker`, ~55 lines, two of the three new complexity findings): any `xargs` carrying a replacement option (`-I`/`-i`/`--replace`, by the `XARGS_GRAMMAR` parse) suggests the exact command.
- **Use `OPAQUE_COMMAND_LINE_WRAPPERS`, not a hand-listed `parallel`/`rust-parallel`/`rush`.**
  The hand list omits `watch`, so `watch mytool x` suggests `watch mytool *` although `watch` hands its joined arguments to `sh -c` — a later `watch mytool x '&&' rm -rf y` matches.
  Narrower than `main`'s `watch *`, so not a regression, but it contradicts the PR's own "templates keep the whole command" rule; probed on the PR head.
- **Do not add a second option allowlist** (`sessionWrapperOptionsKnown`) beside `isAdmittedModifierLayer`'s admission; reuse one admission predicate for table-walk wrappers, or decline generalization when a table-walk layer carries an option.
- **Get under the Fallow audit thresholds** by decomposing `sessionCommandIndex` (per-layer step as its own function), not by suppressing.
- **Do not take the PR's docs bookkeeping**: its retro file narrates the contributor's own workflow, and its Phase 15 sweep disposition named the contributor's operator.
  The maintainer's disposition is recorded separately (`ea7631b2`).
- Widening `classifyWrapperWords`/`innerCommandIndex`/`wrapperName` from `CommandWord` to `Pick<CommandWord, "text">` is a reasonable ISP narrowing (they read only `text`); keep it.

#### Behavior / breaking

Narrower session suggestions and dialog labels; no config, default, or schema change.
A non-breaking `fix(pi-permission-system):` — a user who relied on `nohup *` sees more prompts, which is the fix.

### Decision and attribution

- Direction: **adopt the capability, simplified design** — plan via `/plan-issue #1055`; the PR is reference, not the merge target.
  `/plan-issue` should treat the direction as decided and plan around the scope below.
- Scope: inner-command narrowing for recognized literal wrapper prefixes, nested layers retained, space-before-wildcard, fail-closed exact-command fallback, `OPAQUE_COMMAND_LINE_WRAPPERS`/exec-conditional/opaque-payload layers kept exact, the gate round-trip tests, the docs paragraph.
- Non-goals: `xargs` replacement generalization (operator decision: exact command, no wildcard); config `deny` reaching behind wrappers; `command`/`exec` vocabulary; #1042's `sudoedit` peeling.
- Roadmap: #1055 is out of scope for Phase 15 (operator decision, 2026-10-10), recorded in `docs/architecture/architecture.md`'s sweep list.
- Attribution: every implementation/docs commit ends with

  ```text
  Co-authored-by: plucury <plucury@gmail.com>
  ```

  and the ship-stage close comment on PR #1054 thanks @plucury by name and links the implementing SHA(s).
  Reference the PR as `Refs #1054`, never a closing keyword.
