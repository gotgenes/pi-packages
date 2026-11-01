---
issue: 799
issue_title: "pi-permission-system: decide which channels permission policy may enter through (ADR)"
---

# ADR 0016: which channels permission policy may enter through

## Release Recommendation

**Release:** ship independently

Issue #799 is not a step in any improvement roadmap: `docs/architecture/architecture.md` has no open `## Improvement roadmap — Phase` section, so there is no `Release:` batch tag to honor.
The deliverable is a decision record; `docs/decisions` and `docs/architecture` are outside the package's release scope, and the one in-scope file (`README.md`, its "One decision is still open" paragraph) changes under a `docs:` commit.
The decisions are implemented by downstream issues, which release on their own merits.

## Problem Statement

Permission policy reaches the composed ruleset through more paths than any record names, and twelve open requests each propose another, or a new scope for an existing one.
Merging them one PR at a time would produce a precedence order nobody decided as a whole.
Two of the proposals also make this package a *producer* of policy rather than only a consumer: [#692] would write approvals back to disk, and the `/permission-system` modal already does, for runtime knobs.
[#639] settled the *shape* of policy as ADR 0013 and handed the channel half here, with its §9 as the admissibility input.

The deliverable is ADR 0016, settled interactively during the build session in the ADR 0007 / 0011 / 0012 pattern.
The [#581] lesson applies: the deliberation is the deliverable, and the ADR records decisions made with the operator at the gates, not the candidates sketched below.

## Goals

- Record `docs/decisions/0016-policy-channels.md`, deciding the five clusters the operator scoped in at planning: new file sources (A), write-back (B), relaxation scope (C), a precedence floor (D), and session-layer management (E, added by the operator after the first draft).
- State the admissibility criteria a channel must meet, starting from ADR 0013 §9 and the composition rules the package already commits to.
- Inventory the shipped channels as they behave today, including the two behaviors measured at planning (below), so the record starts from the mechanism and not from the docs.
- Leave a disposition for every dependant: admitted, reshaped, or declined, each with the downstream issue that implements it.
- Classify each admitted change as breaking or not on upgrade, in writing, so the implementation issues inherit the call.

## Non-Goals

- Implementing anything: no `src/`, `test/`, schema, or example-config change in this issue.
- Fixing the modal's erasure of an invalid global config.
  It is filed as [#1102] and fixed independently; ADR 0016's write-back contract governs that write path once settled, and [#1102] does not wait for it.
- Reviewing PR [#638].
  It adds a TUI `overlay` option for the permission dialog, which is not a policy channel; it was unparked by comment during planning and is reviewed on its merits.
- Deciding [#620] (allow-capable opaque-bash adjudicator).
  PR [#983] waits jointly on [#620] and this issue, and ADR 0016 decides only the channel half: whether a per-link trust map is an admissible relaxation channel.
- Deciding [#1095] / [#1101] (the K7 keystone: a chained command's prompt names one unit while its grant covers another).
  Grant breadth is a session-approval suggestion question; cluster D touches it only where a grant meets a deny.
- Building the session-rule view and editing surface; that is [#1103], which implements what cluster E decides.
  [#1103] also carries the `/permission-system:` command namespace (a hard rename, breaking, in the same major as the view), which is a command-surface change rather than a channel question, so ADR 0016 does not decide it.
- Editing `docs/configuration.md`, `docs/session-approvals.md`, or `docs/cross-extension-api.md`; they describe current behavior and change with the implementation issues.

## Background

### Shipped channels, as traced in source

| Channel                                                          | Precedence (later wins)                                            | Trust gating       | Validation                                                | Written by                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------ | --------------------------------------------------------- | ------------------------------------------------------------- |
| Global `~/.pi/agent/extensions/pi-permission-system/config.json` | 1                                                                  | n/a                | strict; invalid → empty scope (universal `ask`), no floor | the user; the `/permission-system` modal (runtime knobs only) |
| Project `.pi/extensions/pi-permission-system/config.json`        | 2                                                                  | ADR 0001           | strict; invalid → `allow`→`ask` floor ([#646])            | the user, and the agent where a `write` rule permits it       |
| Global agent frontmatter `~/.pi/agent/agents/<name>.md`          | 3                                                                  | n/a                | tolerant per key; unreadable file → floor                 | the user                                                      |
| Project agent frontmatter `.pi/agents/<name>.md`                 | 4                                                                  | ADR 0001           | as above                                                  | the user, or the agent                                        |
| Session rules (`s` at the prompt; forwarded grants per ADR 0006) | 5, appended after every config rule                                | n/a (memory only)  | n/a                                                       | the human at the prompt                                       |
| `yoloMode` (global/project config; the legacy files too)         | composition rewrite `ask`→`allow` over everything, deny-preserving | project half gated | strict                                                    | the modal, **always to global**                               |

Sources: `PermissionManager.resolvePermissions` (`src/policy/permission-manager.ts`, the `mergeScopesWithOrigins` scope list) and `check` (`[...composedRules, ...sessionRules]`); `loadAndMergeConfigs` (`src/config/config-loader.ts`); `FilePolicyLoader` (`src/config/policy-loader.ts`); `ConfigStore.save` / `refresh` (`src/config/config-store.ts`); `SessionTurnPrep` re-reads config on every `before_agent_start` (`src/handlers/session-turn-prep.ts`).
The three legacy files (`pi-permissions.jsonc` global and project, the legacy extension `config.json`) feed only `ConfigStore`'s runtime knobs, `yoloMode` included; `FilePolicyLoader` reads no legacy path for rules.
Policy files are re-read on every check through mtime stamps (`getCacheStamp`), so a disk edit changes a running session's policy on its next tool call; that was traced in code, not run.
Nothing in `src/` protects the extension's own config files from the agent: the only guard is whatever `path_write`/`write` rule the user authored.

### Measured at planning

Both by disposable tests through the real code, since deleted (re-runnable sources under Test Impact Analysis):

1. **The modal's write-back erases an invalid global file.**
   `ConfigStore.save()` reloads the file through the strict validator and spreads `existing.config`, which is `{}` for a rejected file.
   A global file holding `"permission": {"bash": {"rm *": "deny"}}` plus one unknown key became `{debugLog, permissionReviewLog, yoloMode: true}` after one yolo toggle.
   On a valid JSONC file the rules survived and every comment was lost.
   Filed as [#1102].
2. **A session grant overrides a config deny.**
   Config `bash: {"*": "ask", "systemctl restart trader": "deny"}` with session rule `bash: systemctl restart *` resolved `allow` (origin `session`); without the session rule, `deny`.
   The same held on `path_write` (`/etc/*` deny, `/etc/*` session allow).
   The arity table gives `systemctl` arity 2 (`src/access-intent/bash/bash-arity.ts`), so approving `systemctl restart nginx` for the session suggests exactly that pattern; that path is traced, not run.

### The dependants, by cluster

| Cluster                     | Items                                                                                                              | What each asks                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. New file sources         | PR [#675]; PR [#1073]; the load half of [#691] / PR [#692]                                                         | Pi `settings.json` under `piPermissionSystem` (global, project, per-agent); every ancestor directory's `.pi` project scope, nearest wins, relative patterns rebased; a `config.local.json` loading after the shared project file   |
| B. Write-back               | [#691], PR [#692], [#603]; the modal's existing global write                                                       | durable approval at project or global scope, with editable pattern, typed confirmation for tracked files and global writes, JSONC preservation, and rollback on reload failure                                                     |
| C. Relaxation scope         | [#720], PR [#671], PR [#990], [#1031], [#799 comment 2][c2], PR [#983]; ADR 0013 §7's frontmatter `commandEffects` | `pi --yolo`; `PI_PERMISSION_SYSTEM_YOLO=1`; a session-only `/yolo`; yolo per subagent; a modal toggle that defaults to this session; a per-link trust map lifting the delegation cap; whether an agent channel may declare effects |
| D. Precedence floor         | [#799 comment 1][c1]; [#604]                                                                                       | a global-only, deny-only tier no later layer can override; wider session patterns (which make an overlap with a deny more likely)                                                                                                  |
| E. Session-layer management | [#1103] (operator-added)                                                                                           | see every rule in effect, filterable; remove a session-layer rule; modify a session-layer rule's action in any direction; edits stay in memory and never write a file                                                              |

### Platform facts the gates rest on

- Pi 1.0.0 (the pinned version) exposes `pi.getSettings()` (merged global and project settings) and `pi.registerFlag()` / `pi.getFlag()` on `ExtensionAPI`.
  Its `SettingsManager` withholds project settings from an untrusted project and refuses to write them (`"Project is not trusted; refusing to write project settings"`).
  A `settings.json` channel and a `--yolo` flag can therefore ride Pi's own API rather than this package's file reads.
  Pi's settings merge semantics (deep or shallow per key) are unverified and are re-read at step 1.
- Every surface resolves through `evaluate` or `evaluateAnyValue` (`src/policy/rule.ts`, two `findLast` scans) since [#928] removed `evaluateFirst`.
  Comment 1's "three resolvers" finding is now two, and its hazard stands: a floor pinned only by unit tests on one resolver passed while the path surfaces stayed overridable.

### Constraints from existing records

- ADR 0001: project-scoped config loads only for a trusted project; the package observes trust and never decides it; "sanitize the merge so project can only tighten" was rejected.
- ADR 0013 §9: flat `(surface, pattern)` vocabulary; sugar expands per scope at load; a written-back rule uses a directional or sugar key, never a third form; direction adds no precedence tier; `commandEffects` stays out of agent-controlled channels until this issue decides otherwise.
- ADR 0013 §8 constraint 3: a declaration that relaxes prompts "originates outside the agent's reach", which is a candidate precedent for any relaxation channel.
- `docs/architecture/architecture.md` design principle 3 ("Session approvals are just more rules") and 8 ("Persistence determines lifetime (once / session / config)"); § "yolo is recorded authority" names a deny-overriding mode as a different, separately named operation.
- The `Scope and non-goals` section lists durable persistence as anticipated, not a boundary, and names #799 as the one open decision; the README repeats both.

## Design Overview

The ADR's spine is a set of admissibility criteria, then one decision per cluster, then a disposition map.
Nothing below is decided; each parameter lists the candidates the build session puts to the operator, who may add or reject any of them.

### Parameter 0: admissibility criteria (Gate A)

Candidates, each to be confirmed, amended, or rejected:

- **K1 Deterministic.**
  Same inputs, same decision; a channel reading ambient state (env, flags) declares it.
- **K2 One vocabulary.**
  ADR 0013 §9 verbatim: flat pairs, sugar at load, no new precedence tier from direction.
- **K3 Strict, fail-closed.**
  A channel is schema-validated; an invalid channel above global floors `allow`→`ask` (#646's rule), and an invalid write target is never overwritten (the [#1102] lesson).
- **K4 Trust-gated when project-scoped.**
  ADR 0001 applies to any channel whose content a repository controls.
- **K5 Attributable.**
  Every rule carries a `RuleOrigin` the review log reports, so a surprising allow traces to its channel.
- **K6 Outside the agent's reach when it relaxes.**
  Extends ADR 0013 §8's constraint 3 from the sandbox declaration to every relaxing channel; today it does not hold for the project config file or `.pi/agents/`, and the gate decides whether that is a criterion, a documented residual, or a built-in self-protection rule.
- **K7 Propagation is declared.**
  Whether a disk change may alter a *running* session's policy, in which direction, is stated per channel (comment 2's question).

### Parameter 1: inventory and cluster A, new file sources (Gate B)

Confirm the inventory table, then decide each source against the criteria:

- `settings.json` ([#675]): admit, decline, or reshape onto `pi.getSettings()` (inheriting Pi's trust gating).
  Open sub-questions: two homes for one policy (precedence between the settings key and the dedicated file); Pi's merge semantics against ours.
- Ancestor configs ([#1073]): admit or decline; trust is granted for the cwd, so whether it covers an ancestor's `.pi` is the K4 question; relative-pattern rebasing is new matching semantics.
- `config.local.json` ([#691] / [#692]): a distinct channel or the write-back target of cluster B; where it sits (after shared project, before agent?).

### Parameter 2: cluster B, write-back (Gate C)

- Whether durable persistence of an approval is admitted (principle 8 anticipates it).
- Which file per scope; whether the extension may ever modify a user-authored file (shared project `config.json`, global `config.json`), or only a file it owns.
- Confirmation: what is shown (surface, exact pattern, scope, file), what typed confirmation a global write or a tracked file requires.
- Write integrity: JSONC and formatting preserved; never overwrite a file that fails to parse or validate; atomic write; rollback when the post-write reload fails, and what the pending ask resolves to then.
- Forwarded asks and chain verdicts: live-only, or persistable at the serving node.
- Whether the modal's existing global write (the [#1102] path) is held to the same contract.

### Parameter 3: cluster C, relaxation scope (Gate D)

Draw the scope ladder and place each request on it: process (env var [#671], flag [#720]), session (in-memory `/yolo` [#990], comment 2), node (per-subagent [#1031]), disk (global/project `yoloMode` today).

- Which scopes are admitted, and what the in-session toggle defaults to.
- Precedence between an in-memory override and a disk re-read, in both directions (comment 2's "a session nobody relaxed shouldn't be relaxed by another session's change").
- Who may set each: the human, a launcher, never the agent (K6).
- Per-node yolo against forwarding: a relaxed child and an interactive parent, and the reverse, given [#1029]'s rule that the serving node's yolo approves a forwarded floored ask.
- `authorizerTrust` ([#983]): whether a per-link lift of the bounded-delegation cap is an admissible operator channel (jointly with [#620]).
- Agent frontmatter `commandEffects` (ADR 0013 §7): stays closed, or opens under conditions.

### Parameter 4: cluster D, a precedence floor (Gate E)

Present the measured override first (Background, measurement 2), then:

- Whether a deny that later layers cannot override exists at all, or principle 3's uniform model holds and the residual is documented with guidance.
- If it exists: its shape (a dedicated top-level key versus a flag on a rule), its scope (global only, per comment 1's mirror of the [#644] attack), deny-only, and no in-band override.
- Its relation to yolo (already deny-preserving) and to the fail-closed floor.
- What test level pins it: a `PermissionManager.check` test per resolver, since a unit test on one resolver passed while the other stayed overridable.
- Whether session-pattern widening ([#604]) is admitted, given that wider grants overlap denies more often.

### Parameter 5: cluster E, session-layer management (Gate F)

Today the session layer is allow-only and append-only: `SessionRules.approve()` pushes an `allow` without de-duplicating, `clear()` runs only at `session_shutdown`, and `getComposedConfigRules` hides the layer from `/permission-system show`.
The operator set three inputs at planning, which the gate treats as given rather than reopening:

- The view shows every rule in effect (defaults, baseline, each config scope, the session layer), filterable.
- Removal and modification act on the session layer only; config rules are shown, never edited from here, and no edit writes a file.
- A modification may move in any direction (`allow`, `ask`, `deny`), so the session layer gains `ask` and `deny` actions.

What the gate decides:

- How "any direction" composes with Gate E: whether a floor, if adopted, sits above an edited session rule, or a user's explicit session edit outranks it.
- Whether an edit toward `allow` is subject to the same constraints as a cluster C relaxation (K6, deny preservation), or is a per-rule human act outside them; the measured override says it outranks config today either way.
- Whether a forwarded grant recorded at the serving node (ADR 0006) is shown and editable there, and whether a child's own session layer is reachable from the parent.
- How a removal or an edit is attributed: a `RuleOrigin` or review-log record, so a changed session rule stays traceable (K5).
- Whether principle 3 ("Session approvals are just more rules") still describes a layer that can tighten as well as loosen.

### Parameter 6: sequencing, classification, and dispositions (Gate G)

- Sequencing against [#639]: satisfied, since ADR 0013 is accepted; the ADR states which §9 constraint each admitted channel discharges.
- Per admitted change: breaking on upgrade or not, and the semver call the implementation issue inherits.
- The disposition map: each of the twelve dependants to a decision and a downstream issue.

## Module-Level Changes

- `packages/pi-permission-system/docs/decisions/0016-policy-channels.md`: new; the ADR (`status: accepted` once settled), carrying the inventory, criteria, the five cluster decisions with rejected alternatives, consequences, and the disposition map.
- `packages/pi-permission-system/docs/architecture/architecture.md`: the `Scope and non-goals` paragraph that says "Which channels policy may enter through remains open in issue #799" becomes a pointer to ADR 0016; any channel the ADR *declines* gains a row in the non-goals table resting on ADR 0016.
  The "Composed ruleset" diagram and § "yolo is recorded authority" are predicted unchanged, since they describe current behavior and nothing is implemented here.
- `packages/pi-permission-system/README.md`: the "One decision is still open" paragraph under Scope and non-goals is rewritten to point to ADR 0016; a declined channel joins the charter's bullets only if the operator wants it there.
- `packages/pi-permission-system/docs/decisions/0013-permission-policy-model.md`: predicted unchanged; §7 and §9 hand questions to #799, and ADR 0016 answers them in its own text.
  If a decision amends §7 (frontmatter `commandEffects`) or §9, record a dated amendment in 0013's header in the existing pattern instead of contradicting it silently.
- `packages/pi-permission-system/docs/decisions/0001-project-trust-adoption.md`: predicted unchanged; it is cited, not amended, unless the ancestor-config decision changes what "project-scoped" means.
- No `src/`, `test/`, schema, example config, or `.pi/skills/package-pi-permission-system/SKILL.md` changes.
  The skill's `## Configuration` section describes current loading and changes with the implementation issues.

## Test Impact Analysis

Docs-only; no test cycles.
The testable surface is the mechanical claims the ADR rests on.
Each was dry-run at planning, and `/build-plan` step 1 re-runs them; expected output is recorded here.

| Claim                           | Command                                                                                                          | Expected                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Scope order                     | `grep -n '\["global", globalConfig\]' -A3 packages/pi-permission-system/src/policy/permission-manager.ts`        | `global`, `project`, `agent`, `project-agent` on four consecutive lines |
| Session rules last              | `grep -n '\[...composedRules, ...sessionRules\]' packages/pi-permission-system/src/policy/permission-manager.ts` | one match                                                               |
| Modal writes global only        | `grep -n 'getGlobalConfigPath(this.deps.agentDir)' packages/pi-permission-system/src/config/config-store.ts`     | one match, inside `save`                                                |
| Runtime knobs trust-gated       | `grep -n 'includeProjectScope: projectTrusted' packages/pi-permission-system/src/config/config-store.ts`         | one match                                                               |
| Two resolvers                   | `grep -c 'findLast' packages/pi-permission-system/src/policy/rule.ts`                                            | `2`                                                                     |
| Arity for comment 1's scenario  | `grep -n 'systemctl' packages/pi-permission-system/src/access-intent/bash/bash-arity.ts`                         | `systemctl: 2,`                                                         |
| Pi settings and flag APIs       | `grep -c 'getSettings(): Settings\|registerFlag(' <pinned pi-coding-agent>/dist/core/extensions/types.d.ts`      | `2`                                                                     |
| Pi trust-gates project settings | `grep -n 'Project is not trusted' <pinned pi-coding-agent>/dist/core/settings-manager.js`                        | one match                                                               |

The floor spike, run as a throwaway `test/spike-799.test.ts` with `--reporter=verbose`, printed `{"bash":["allow","session"],"bashNoSession":"deny","path":["allow","session"]}`:

```typescript
const { manager } = createManagerWithConfig({
  bash: { "*": "ask", "systemctl restart trader": "deny" },
  path_write: { "*": "allow", "/etc/*": "deny" },
});
const intent = { kind: "bash-command", surface: "bash", command: "systemctl restart trader", spellings: [] } as const;
manager.check(intent, [sessionRule("bash", "systemctl restart *")]); // allow, origin session
manager.check(intent, []);                                           // deny
manager.check({ kind: "path-values", surface: "path_write", values: ["/etc/hosts"] },
  [sessionRule("path_write", "/etc/*")]);                            // allow, origin session
```

The erasure spike's reproduction is in [#1102]'s body.

Lint: `pnpm exec rumdl check` on the ADR, the architecture doc, and the README.

## Invariants at risk

- **ADR 0001's trust boundary.**
  Every admitted project-scoped channel is trust-gated; the ADR states it per channel.
  Pinned today by the `project_trust` tests in `test/composition-root.test.ts` and `test/config/config-loader.test.ts`; downstream issues extend them.
- **The #646 fail-closed floor.**
  A new non-global channel must join `failClosedScopes` when invalid; the ADR names this as an obligation on each implementation issue.
- **Deny-preserving yolo** (§ "yolo is recorded authority").
  No relaxation channel in cluster C may override a deny; a deny-overriding mode stays a separately named operation.
- **Principle 3, "Session approvals are just more rules."**
  Clusters D and E either keep it or amend it explicitly; it is not eroded by an implementation detail.
- **ADR 0013 §9.**
  Every admitted channel, and every written-back rule, speaks the flat vocabulary.

## Build Order

Docs-only: execute with `/build-plan`.
Each gate presents the substance in a message first (the inventory, worked examples, before/after scenarios in the affected user's terms), then a short `ask_user`, per the `clarification-gates` skill.
For this operator in contested design space, brief to parity before offering options; both prior ADR builds bounced gates that skipped it.
Decisions are recorded in the ADR draft as they are made.

1. Re-run the Test Impact Analysis commands and both spikes; verify Pi's settings merge semantics in the pinned dist; fix the plan's premises if anything drifted.
   Commit nothing.
2. Gate A: admissibility criteria K1–K7.
3. Gate B: inventory sign-off and cluster A.
4. Gate C: cluster B (write-back).
5. Gate D: cluster C (relaxation scope), with the scope ladder drawn.
6. Gate E: cluster D (floor), leading with the measured override.
7. Gate F: cluster E (session-layer management), after Gate E because it composes with the floor answer.
8. Gate G: sequencing, breaking classification per admitted change, and the disposition map, including what [#1103] implements.
9. Author `docs/decisions/0016-policy-channels.md`; update the architecture-doc paragraph and non-goals rows and the README paragraph; lint all three.
   Commit: `docs(pi-permission-system): record ADR 0016, the policy channels`.
   When a gate adopts a commenter's or contributor's mechanism, credit it in the commit's final paragraph, below `Refs #799`, with the matching line (resolved at planning):
   - comment 1's floor shape: `Co-authored-by: stanley <70442355+stanleytejakusuma@users.noreply.github.com>`
   - comment 2's session scope: `Co-authored-by: Court Schuett <71404236+schuettc@users.noreply.github.com>`
   - [#691] / [#692]'s write-back contract: `Co-authored-by: Adam Spiers <100738+aspiers@users.noreply.github.com>`
   - [#990]'s session toggle: `Co-authored-by: ReStranger <69393944+ReStranger@users.noreply.github.com>`
   - [#671]'s launcher env var: `Co-authored-by: Gavin Somers <79357793+gavinsomers@users.noreply.github.com>`
   - [#675]'s settings channel: `Co-authored-by: CHRONO <32600670+chronoAP@users.noreply.github.com>`
   - [#1073]'s ancestor configs: `Co-authored-by: Arnab Bose <10203874+hirak99@users.noreply.github.com>`
   - [#983]'s trust map: `Co-authored-by: minicx <39405619+loss-and-quick@users.noreply.github.com>`

   Verify with `git interpret-trailers --parse`.
10. File the downstream implementation issues the decisions shaped, run the `roadmap-fit` skill per filed issue, write the issue numbers into the ADR's disposition map, and post a reply on each dependant naming its disposition.
   Commit: `docs(pi-permission-system): map ADR 0016 decisions to implementation issues`.

## Risks and Mitigations

- **The ADR fossilizes a candidate instead of a deliberation.**
  Gates first, drafting last; every parameter records its rejected alternatives.
- **Twelve dependants make the record too large to settle.**
  The clusters are independent enough to gate separately; if a gate stalls, the ADR records that cluster as deferred with its own issue rather than blocking the rest.
- **A floor decision regresses an earlier invariant with a green suite.**
  Parameter 4 requires the pinning test at `PermissionManager.check`, per resolver, as an obligation on its implementation issue.
- **Contributors whose PRs wait on this are left in the dark again.**
  Step 10 replies on every dependant; PR [#638] was already unparked at planning.
- **Inventory drift.**
  The table is a snapshot of `0fb45d36`; step 1 re-verifies it before any gate cites it.

## Open Questions

- Whether K6 (outside the agent's reach) becomes a criterion that existing channels fail today, and if so whether built-in self-protection of the config files is in scope for a downstream issue (Gate A).
- Whether a `settings.json` channel replaces or supplements the dedicated files (Gate B).
- Whether the floor, if adopted, is also immune to an in-band prompt (Gate E).

[c1]: https://github.com/gotgenes/pi-packages/issues/799#issuecomment-5441061055
[c2]: https://github.com/gotgenes/pi-packages/issues/799#issuecomment-5843171122
[#581]: https://github.com/gotgenes/pi-packages/issues/581
[#603]: https://github.com/gotgenes/pi-packages/issues/603
[#604]: https://github.com/gotgenes/pi-packages/issues/604
[#620]: https://github.com/gotgenes/pi-packages/issues/620
[#638]: https://github.com/gotgenes/pi-packages/pull/638
[#639]: https://github.com/gotgenes/pi-packages/issues/639
[#644]: https://github.com/gotgenes/pi-packages/issues/644
[#646]: https://github.com/gotgenes/pi-packages/issues/646
[#671]: https://github.com/gotgenes/pi-packages/pull/671
[#675]: https://github.com/gotgenes/pi-packages/pull/675
[#691]: https://github.com/gotgenes/pi-packages/issues/691
[#692]: https://github.com/gotgenes/pi-packages/pull/692
[#720]: https://github.com/gotgenes/pi-packages/issues/720
[#928]: https://github.com/gotgenes/pi-packages/issues/928
[#983]: https://github.com/gotgenes/pi-packages/pull/983
[#990]: https://github.com/gotgenes/pi-packages/pull/990
[#1029]: https://github.com/gotgenes/pi-packages/issues/1029
[#1031]: https://github.com/gotgenes/pi-packages/issues/1031
[#1073]: https://github.com/gotgenes/pi-packages/pull/1073
[#1095]: https://github.com/gotgenes/pi-packages/issues/1095
[#1101]: https://github.com/gotgenes/pi-packages/issues/1101
[#1102]: https://github.com/gotgenes/pi-packages/issues/1102
[#1103]: https://github.com/gotgenes/pi-packages/issues/1103
