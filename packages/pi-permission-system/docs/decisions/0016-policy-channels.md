---
status: accepted
date: 2026-11-16
---

# 0016 — Which channels permission policy may enter through

## Status

Accepted.
This decision settles every path by which something that changes a check's outcome reaches the package (a **channel**, see `docs/glossary.md#channel`): which channels are admissible, at what precedence, under which criteria, who may write policy back, how a relaxation is scoped, and how the session layer meets config.
It answers the handoff in ADR 0013 §9 (`docs/decisions/0013-permission-policy-model.md`) and the agent-frontmatter question its §7 left open, changing neither; it amends ADR 0007 (the envelope's cap becomes liftable, §5) and ADR 0012 decision 1 (one in-process mode fact, §6), and each of those records carries a dated entry pointing here.
It was settled interactively in [#799], in the pattern of ADR 0007, 0011, and 0012: the operator decided at each gate, and each section below records the rejected alternatives beside the decision.
The decisions are implemented by downstream issues (§ Disposition map); nothing changes in code with this record.

## Context

### The problem

Policy reached the composed ruleset through more paths than any record named, and twelve open requests each proposed another, or a new scope for an existing one.
Merging them one pull request at a time would have produced a precedence order nobody decided as a whole.
Two proposals also make the package a *producer* of policy: durable approvals ([#691], PR [#692]) write rules back to disk, and the `/permission-system` modal already writes runtime knobs.

### The shipped channels

As traced in source at `80e11ad6` and re-verified during the build:

| Channel                                                                                                                          | Precedence                                       | Trust                         | Validation                                     | Propagates                                            | Written by                                                     |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------- | ---------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------- |
| Global `config.json`                                                                                                             | 1                                                | n/a                           | strict; invalid → empty scope, no floor        | rules at the next tool call; knobs at the next prompt | the user; the modal (knobs only)                               |
| Project `config.json`                                                                                                            | 2                                                | ADR 0001                      | strict; invalid → `allow`→`ask` floor ([#646]) | as above                                              | the user; the agent wherever a `write` rule allows, unprompted |
| Global agent frontmatter                                                                                                         | 3                                                | n/a                           | tolerant per key                               | next tool call                                        | the user                                                       |
| Project agent frontmatter                                                                                                        | 4                                                | ADR 0001 (see residual below) | tolerant per key                               | next tool call                                        | the user, or the agent                                         |
| Session rules                                                                                                                    | after every config rule                          | memory only                   | built in code                                  | immediate                                             | the human at a prompt; forwarded grants (ADR 0006)             |
| `yoloMode` (global, project, legacy files)                                                                                       | rewrites every `ask` to `allow`, deny-preserving | project half gated            | strict                                         | next prompt                                           | the modal, always to global                                    |
| Legacy files (`~/.pi/agent/pi-permissions.jsonc`, `<extension install dir>/config.json`, `<cwd>/.pi/agent/pi-permissions.jsonc`) | runtime knobs and `commandEffects` only          | project file gated            | validation issues suppressed                   | next prompt                                           | the user                                                       |

Sources: `PermissionManager.resolvePermissions` and `check` (`src/policy/permission-manager.ts`), `loadAndMergeConfigs` (`src/config/config-loader.ts`), `FilePolicyLoader.getCacheStamp` (`src/config/policy-loader.ts`), `ConfigStore.save` / `refresh` (`src/config/config-store.ts`), `SessionTurnPrep` (`src/handlers/session-turn-prep.ts`), `normalizeFlatPermissionValue`.

### Measured

Each by a disposable test through the real code, since deleted.

1. **The modal erases an invalid global file.**
   `ConfigStore.save()` spreads the *validated* config, which is `{}` for a rejected file, so a global file holding a `bash` deny plus one unknown key became `{debugLog, permissionReviewLog, yoloMode: true}` after one toggle; a valid JSONC file loses its comments.
   Filed as [#1102].
2. **A session grant overrides a config deny.**
   Config `bash: {"*": "ask", "systemctl restart trader": "deny"}` plus session rule `systemctl restart *` resolved `allow` (origin `session`); without the session rule, `deny`.
   The same held on `path_write`.
   Session rules are appended after every config rule (`[...composedRules, ...sessionRules]`) and the last match wins ([comment 1][c1]).
3. **The over-broad pattern is the package's own suggestion.**
   `suggestBashPattern` turns `systemctl restart nginx` into `systemctl restart *`, `git push origin main` into `git push *`, `rm -rf build` into `rm *`, and `kubectl delete pod web-1` into `kubectl delete *`, offered as the dialog's one-keystroke default.
4. **A later scope does not always win.**
   `mergeFlatPermissions` spreads objects, so a redefined key keeps its original position: global `bash: {"*": "ask", "git *": "allow"}` plus agent `bash: {"*": "deny"}` merges to `{"*": "deny", "git *": "allow"}`, and `git status` is allowed ([#1108]).
5. **Pre-merged content changes the action.**
   Global `path_write: {"~/secrets/*": "deny"}` plus project `path: {"*": "allow"}` resolves a write to `~/secrets/x` as `allow` when sugar expands per scope (shipped) and `deny` when the scopes merge first.
6. **A subdirectory of an untrusted repository is reported trusted.**
   Pi's `hasTrustRequiringProjectResources` returns `true` for `repo/` holding `.pi/extensions/pi-permission-system/config.json` and `false` for `repo/src/`, and a cwd with nothing trust-requiring is reported trusted without a prompt (`main.js`, traced).

### Platform facts (pinned Pi 1.0.0)

- `pi.getSettings()` returns only the merged global-and-project settings; settings files are parsed with `JSON.parse`, never schema-validated, a parse failure contributes `{}`, and they reload only on `/reload` or a trust change.
- `pi.registerFlag()` / `pi.getFlag()` give an extension a per-process launch flag, which a child process does not inherit.
- Project trust resolves to the nearest recorded ancestor decision; Pi reads its own `.pi/` resources from the cwd only, and walks ancestors only for context files and `.agents/skills`; `.pi/agents/` is not on its trust-requiring list.

### Constraints from existing records

- ADR 0001: project-scoped content loads only for a trusted project; the package observes trust and never decides it; a trusted project may loosen global.
- ADR 0007: the authorizer chain is opt-in by name, config-ordered, and bounded by the delegation envelope; determinism governs recorded authority only.
- ADR 0009: ambient inputs are a closed, named set (`HOME`, `PWD`).
- ADR 0013 §9: one flat `(surface, pattern)` vocabulary, sugar expanded per scope, a written-back rule in a directional or sugar key, no precedence tier from direction.
- Design principle 3 ("Session approvals are just more rules") and principle 8 ("Persistence determines lifetime").

## Decision

### 1. Admissibility criteria

Every channel, shipped or proposed, is held to seven criteria; a channel that fails one is declined or reshaped.

- **K1 Deterministic, over a closed list of inputs.**
  A decision depends only on files, filesystem state, session state, and the ambient inputs this record names.
  Adding an ambient input (an environment variable, a launch flag, a pattern placeholder) is an amendment to this record, as ADR 0009's `HOME`/`PWD` set is to that one.
  The inputs named here are the `--auto-approve` and `--unrestricted` launch flags (§5, §6) and the `{runtimeDir}` and `{uid}` placeholders (§3).
  Each is logged as its own source.
  Live authority (the human, a judge) is outside K1.
  ADR 0009's closed `HOME`/`PWD` set governs the bash path projection and is untouched, as is ADR 0003's refusal to read host state to interpret a bash path: the placeholders expand config pattern keys only.
- **K2 One vocabulary, delivered per scope.**
  ADR 0013 §9 verbatim, plus: a channel delivers its content one scope at a time, before any cross-scope merge (measurement 5).
- **K3 Strict and fail-closed.**
  Content is schema-validated; an invalid channel above global floors the composed policy `allow`→`ask` ([#646]); a file that fails to parse or validate is never overwritten by a write.
  The agent-frontmatter `permission:` block becomes strict: today an entry with an invalid action (`"git push *": "denny"`) is dropped silently, so a typo'd deny is fail-open.
  The rest of the frontmatter document stays tolerant.
- **K4 Trust-gated when a repository controls it**, exactly as ADR 0001 states.
- **K5 Attributable per channel.**
  Every rule and every rewrite carries provenance the review log and the decision event report.
  The published `origin` values stay stable (renaming one breaks a consumer matching the string); channel detail travels in an additive field.
- **K6 Outside the agent's reach when it relaxes.**
  Applied to every channel, extending ADR 0013 §8's constraint 3 and §7's "self-granted relief"; §9 below implements it for the channels that fail it today.
- **K7 Propagation is uniform.**
  Every channel takes effect at the next tool call, in both directions.
  The runtime knobs and `commandEffects` move from the per-prompt refresh onto the per-check file stamp the rules already use.

### 2. The channel set and its precedence

| Slot | Channel                                                                     | Status                                        |
| ---- | --------------------------------------------------------------------------- | --------------------------------------------- |
| 1    | Global `config.json`                                                        | shipped                                       |
| 1.5  | Global `config.local.json` (`~/.pi/agent/extensions/pi-permission-system/`) | admitted (§4)                                 |
| 2    | Project `config.json`                                                       | shipped                                       |
| 2.5  | Project `config.local.json` (`<cwd>/.pi/extensions/pi-permission-system/`)  | admitted (§3)                                 |
| 3    | Global agent frontmatter                                                    | shipped; `permission:` block strict (K3)      |
| 4    | Project agent frontmatter                                                   | shipped; `permission:` block strict (K3)      |
| —    | Session layer                                                               | shipped; ranks below every config `deny` (§7) |

**A later scope's patterns are placed after an earlier scope's** ([#1108]): a redefined key moves to the later scope's position, so a later scope's catch-all overrides an earlier scope's specific patterns.
Every slot above assumes this; measurement 4 shows it did not hold.
Within one scope, ADR 0013 §4's normative order is unchanged.

Runtime relaxations are not slots: auto-approve is a terminal (§5) and unrestricted is a session mode (§6).

### 3. File sources

- **Project `config.local.json` is admitted at slot 2.5**, hand-authorable, for personal project policy that should not be committed.
  At 2.5 a personal `allow` overrides shared project policy and not an agent definition's restrictions.
- **Pi's `settings.json` is declined** ([#675]).
  Reading this extension's policy from Pi's settings crosses Pi's boundary and defeats this package's schema; it also fails K2, K3, K5, and K7 (platform facts).
- **Ancestor-directory `.pi` configs are declined** ([#1073]); the project is Pi's project, the cwd's `.pi`.
  Measurement 6 shows the cwd's trust would load an untrusted repository's root config from a subdirectory (K4), and `ExtensionAPI` exposes no per-ancestor trust.
  Revisit if Pi resolves ancestor `.pi` resources itself.
- **The legacy files are no longer read.**
  Their detection stays, and the warning becomes "`<path>` is no longer read; move it to `<new path>`".
  No permission rule lives in them, so no deny is lost.
- **Pattern keys gain three named placeholders** ([#1110]): `{runtimeDir}`, `{uid}`, `{cwd}`, expanded at match time like `~`; an unresolvable placeholder matches nothing.
  Arbitrary environment variables in patterns, a `config.js`/`config.ts` file, and an `addRules()` service method are declined (K1, and the constraints below).
- **A downstream policy-source extension point is open.**
  Two shapes go to the [#1073] author: a path provider (`resolve(cwd) → string[]`, files this package reads, validates, protects, and stamps) and a content provider (rule maps); the lean is toward paths.
  Four constraints bind any version and are decided here:
  1. a source is inert until the operator names it in config, as `authorizerChain` links are;
  2. its rules are visible in the rules view and attributed;
  3. a source contributes files, and any content provider is tighten-only;
  4. dynamic relief goes through the authorizer chain (live, per ask, never persisted, envelope-bounded), never through a rule source.

  The line is recorded versus live authority (ADR 0007), not human versus code: an extension is fully trusted code, so the boundary protects operator attention, not capability.

### 4. Write-back

- **Persistence is admitted for the human at this node's own prompt, for `allow` and `deny`** ([#691], PR [#692], [#603]).
  A judge's verdict, an auto-approval, and a forwarded ask stay live-only: a link's one-off judgment never hardens into standing policy, and a forwarded ask's "this project" is ambiguous.
  A project save is offered only for a trusted project.
- **`*.local.json` is the writable layer at every scope; a `config.json` is never machine-written.**
  Project saves go to slot 2.5; global saves go to a new global `config.local.json` at slot 1.5, which also becomes the home of the modal's knob writes.
  Both stay hand-authorable.
- **Confirmation.**
  A summary shows each exact rule (surface, pattern, action), the scope, and the destination file; the pattern is editable and the surface is not.
  The global summary is always shown; the project summary may be toggled off.
  There is no typed acknowledgement and no git-tracking detection: the agent cannot reach this path, and the targets are machine-local.
  An always-shown notice after the save names the `.local.json` file and says how to share the rule: move it into the scope's `config.json`, by hand or by asking the agent.
- **Write integrity, one contract for every extension write, the modal included.**
  1. Parse as JSONC and validate the existing file first; refuse an invalid file rather than overwrite it.
  2. Edit with a JSONC-preserving editor, so comments, formatting, and unrelated keys survive.
  3. Validate the candidate result before writing.
  4. Write atomically: an exclusive temp file, mode `0600`, `fsync`, rename.
  5. Refuse a symlinked destination or one resolving outside its expected directory.
  6. Restore the original when the post-write reload fails.
  7. When the target already holds the same `(surface, pattern)` with a different action, show it as a replacement (`deny → allow`) instead of flipping it silently.
- **A failed save re-shows the prompt** with the error at its head, and the human chooses again (allow once, for the session, deny, or retry); a failed `deny` save still denies the request.

### 5. Live relaxation: auto-approve and the judge

- **Yolo becomes auto-approve, a terminal reached after the chain.**
  Today yolo rewrites `ask` to `allow` before the chain at both places it acts (composition, and `resolveYoloGrant` for synthesized asks), so no link ever sees an ask under it ([comment 2][c2]: the reviewer received nothing for six hours).
  Auto-approve is instead a terminal selected per session, the mirror of `DenyingAuthorizer`: links run first, and an ask every link defers is allowed rather than prompted.
  Denies never escalate, so they still hold.
  This reverses `docs/architecture/architecture.md` § "yolo is recorded authority", which predates the chain.
- **It is renamed auto-approve**, and "yolo" retires: in other harnesses "yolo" names the bypass-everything mode (Copilot CLI's `/yolo` aliases `allow-all`; Codex CLI's `--yolo`), which is §6's unrestricted here.
  "Auto-approve" matches the already-published `auto_approved` resolution.
- **It is set in the session, never in a file.**
  The setters are an in-session command, which the modal's toggle drives ([#990], [comment 2][c2]), and the `--auto-approve` launch flag ([#720]).
  The `yoloMode` config key is removed and warned like the legacy files: a file key would either spread to every running session under K7 or be K7's one exception.
  An environment variable ([#671]) is declined: every child process inherits it, invisibly to that child.
- **Per node, it is set at the serving node and scoped by requester** ([#1031]).
  A headless subagent's terminal forwards its ask, so the serving parent's terminal answers it; the parent's command scopes auto-approve to its own asks, forwarded asks, or one requesting agent.
- **A judge may resolve an ask to `allow` or `deny`, and `allow` is a first-class outcome.**
  The envelope caps only a link's `allow`, on the `path` and `external_directory` families.
  `authorizerTrust` ([#983]) lifts that cap per link and per family, admitted as proposed: a trusted project's map replaces the global one whole, an untrusted project's is never merged, grants are never persisted, and each is logged `authorizer_trusted_allow`.
  With a lift on, the operator's `deny` rules are the boundary for what the trusted link may approve.
  [#620]'s secret-shaped refinement remains its own issue.

### 6. Unrestricted

A separate, named mode that allows everything, denies included, while the package stays engaged, logging and attributing every decision.

- It acts on recorded authority (a final `{surface: "*", pattern: "*", action: "allow"}` rule after the session layer, plus a gate-level grant for synthesized asks), because a deny never escalates to a terminal.
- It is set by a human, in memory: the `--unrestricted` launch flag or an in-session command; never a file key.
- It is loud (a status indicator, its own `decidedBy` source), and hidden tools return.
- The command takes a scope, own, spawned, or both, defaulting to both.
  In-process subagents inherit it live through a process-global registry entry, the pattern `SubagentSessionRegistry` already uses.
  That read crosses a node boundary, which ADR 0012 decision 1 otherwise reserves; this record admits it for this one mode fact, and it moves no registration and no live authority.
  Out-of-process subagents, provisionally, inherit it through `--unrestricted` at spawn, via an optional clause in the subagent adapter convention backed by a service query; an implementation that does not adopt the clause leaves its children restricted.
- It is documented as meant for use inside an isolation boundary (ADR 0013 §8).
- The zero-mechanism alternative is documented too: launching Pi without this extension (`pi -ne -e <each other extension>`).

### 7. The session layer meets config

- **A config `deny` outranks the session layer.**
  `check` resolves the composed config rules first, and a `deny` there is final; otherwise session rules apply as before.
  A session prompt fires only on an `ask`, so a session `allow` covering a denied value is almost always an accident, and measurement 3 shows the accident is the package's own suggestion.
  A trusted project may still loosen a global deny (ADR 0001), and unrestricted still overrides.
  The implementation pins this with a `PermissionManager.check` test per resolver (`evaluate` and `evaluateAnyValue`): [comment 1][c1]'s prototype passed a unit test on one resolver while the other stayed overridable.
- **Session suggestions are deny-aware.**
  Before offering a session pattern, each config deny pattern on the surface is probed, as a value, against the suggestion (the technique `isSurfaceFullyDenied` uses).
  When one is covered, the dialog names it, and the default becomes the exact command, with the broad pattern one edit away.
  Measured: the probe catches `systemctl restart trader`, `rm -rf /srv/*`, `git push --force *`, and `docker rm db`, and misses a wildcard-led deny such as `* --force *`.
- **The session pattern is editable at the prompt** ([#604]); there is no configured default width.
- **A deliberate override suspends the specific deny** in the rules view (§8), for this session, in memory, logged; it is never a session rule.
  Session rules stay one kind, so a deny added mid-session is never pre-empted by an earlier broad approval.

### 8. Session-layer management

The rules view ([#1103]) implements three operator givens: it shows every rule in effect, filterable; it removes or modifies session-layer rules only, in memory; a modification may move in any direction, so the session layer gains `ask` and `deny` actions.
This record adds:

- the view may suspend a specific config `deny` for this session (§7), the one config action it has;
- a session `allow` that a config deny shadows is marked, so an edit with no effect is not silent;
- the serving node lists the grants it issued to subagents, read-only; a grant recorded on a child (ADR 0006's default) lives in the child and expires with it;
- every removal, edit, and suspension writes a review-log record with its before and after.

### 9. Self-protection

K6 fails today for the project config file and `.pi/agents/`: they sit inside the cwd, a `write` allow reaches them unprompted, and the next tool call reads the edit.
The operator's requirement: an agent can change a rule when asked, and the human is prompted to accept it.

- An agent's write to the extension's own policy files (every `config.json` and `config.local.json`, both agent directories) becomes an `ask`, synthesized at the gate after resolution, as the bash wrapper floor is, so no catch-all `allow` suppresses it.
- **Only a human may approve it**: a link may deny but not allow it, and `authorizerTrust` cannot lift that; the auto-approve terminal does not answer it; with no human reachable it is denied; unrestricted allows it.
  Otherwise an agent under auto-approve could delete a config deny and then act on it.
- The forwarding tree is protected the same way, at its resolved location ([#1115]): `readForwardedPermissionResponse` accepts any well-formed response file, so an agent with write access there could approve a pending forwarded ask (traced, not run).
- An agent's bash launch of `pi` with `--auto-approve` or `--unrestricted` becomes an `ask`, since it starts a relaxed process outside the session's own reach.
- All four are best-effort: a write or launch from inside an interpreter is not projected (ADR 0009).

### 10. Agent frontmatter `commandEffects` stays closed

ADR 0013 §7 left this to [#799].
Its stated reason, self-granted relief, no longer holds alone: frontmatter `permission:` already relieves more, and §9 prompts an agent's edit to its own definition.
It stays closed because no request asks for it and it is real mechanism; it reopens on a concrete request.

## Consequences

- Design principle 3 becomes "Session approvals are just more rules: no separate matching engine; they rank below every config `deny`."
- The "future 'Always' writes config" that `docs/architecture/architecture.md` § "Authority lives in three places" anticipates is realized, into `*.local.json`.
- `docs/architecture/architecture.md` § "yolo is recorded authority" is rewritten by the auto-approve issue: auto-approve is a terminal, and unrestricted is the separately named deny-overriding operation that section anticipated.
- The envelope's cap is an operator default, not a boundary: `authorizerTrust` lifts it, and only §9's protected writes stay capped regardless.
- The glossary gains auto-approve, unrestricted, the local files, and suspension as each lands.

Residuals, accepted and documented:

- A repository holding only `.pi/agents/<name>.md` is reported trusted without a prompt, so its frontmatter composes over global when that agent runs (K4; traced, not run).
- A project-agent subagent session that never resolves project trust loads no project files ([#1104]); the session's creator sets its trust, and this package only observes it.
- The deny-aware probe misses a wildcard-led deny; §7's precedence still holds for it.
- Self-protection does not see interpreter writes.
- A judge reads agent-authored text (the command, and any purpose annotation such as [#1105] proposes), so a judge with a lifted cap is as strong as its resistance to injection.
  ADR 0007 §6 names decomposition fidelity as its residual; injection through agent-authored text is the same class, named here.
- Out-of-process unrestricted inheritance is provisional, and an already-running child stays unrestricted after the parent turns the mode off.

Breaking on upgrade, each in its implementing issue (§ Disposition map):

| Change                                        | Why it breaks                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| Auto-approve replaces yolo                    | `yoloMode` key removed, `"yolo"` origin renamed, links now see asks under it |
| Config denies outrank the session layer       | a session allow that overrode a deny no longer does                          |
| Self-protection                               | new prompts on agent edits to policy files and relaxed `pi` launches         |
| Legacy files no longer read                   | their knobs and `commandEffects` vanish                                      |
| Strict frontmatter `permission:` block        | a malformed block now floors                                                 |
| Later scope's patterns placed after ([#1108]) | a restated catch-all now overrides earlier specific patterns                 |

## Alternatives considered

- **K1:** no ambient inputs at all (would decline the launch flags before weighing them); an open, declared list (an implementation issue could add an input without a record).
- **K2:** §9 verbatim, leaving per-scope delivery to the `settings.json` case.
- **K3:** keeping frontmatter's per-key tolerance as a named exception.
- **K4:** filing the `.pi/agents` trust gap, or requiring an explicit recorded trust decision.
- **K5:** per-scope attribution as before (the review log could not say which session's toggle relaxed 12 others).
- **K6:** binding new channels only, with a config recipe for the shipped gap (leaves `config.local.json` held to a bar `config.json` fails); no general criterion (self-granted relief re-argued per pull request).
- **K7:**
  - next prompt everywhere (a mid-run deny waits for the next prompt);
  - snapshot at session start;
  - monotone composition, the most restrictive of session-start and current policy (an approved loosening edit needs `/reload`).
- **Cross-scope merge:** keeping it and documenting it (a deny-all agent would have to repeat every global pattern).
- **Ancestor configs:** walking only to the git root (a subdirectory is still auto-trusted).
- **Local file:** existing only as a write-back target; slot 4.5 after agent frontmatter (a persisted allow would undo an agent's restriction).
- **Write targets:** global saves into the authored global `config.json` (machine-reorders an authored file); dedicated `approvals.json` files (two more channels).
- **Confirmation:** a toggleable global summary; typed acknowledgements and git detection, which PR [#692]'s own hands-on testing removed as stacked friction.
- **Failed save:** deny with a notice (a refusal the human did not intend); allow once with a notice.
- **Auto-approve:**
  - keeping yolo as a composition rewrite (silences every judge);
  - keeping the name;
  - an environment variable;
  - the config key as a startup default;
  - an agent-frontmatter `autoApprove` key.
- **Unrestricted:** clearing rules on disk (spreads to every session, and the universal fallback still asks); an allow-all config overlay (a file spreads to every session and sits within the agent's reach); a record on disk for out-of-process children (a deny-overriding fact in an agent-writable tree).
- **`authorizerTrust`:** global scopes only; declining the lift.
  ADR 0007 §8 declined a per-link lift as handing the outside-the-tree boundary over wholesale; this record accepts that as the operator's choice, with the operator's `deny` rules as the boundary for what a trusted link may approve.
- **Session vs config deny:**
  - no change;
  - [comment 1][c1]'s dedicated global-only `floor` key (protects only the rules sorted into it; a new tier; can be added on request);
  - letting the session layer win with smarter suggestions (a deny added mid-session would lose to an earlier broad approval);
  - letting literal session rules win (an old literal approval would beat a new deny);
  - two kinds of session rule.
- **Session width:** a configured `sessionApprovalScope` (every suggestion wider by default).
- **Subagent grants:** reading and removing an in-process child's session rules (crosses a node boundary, ADR 0012 decision 1).
- **Self-protection authority:** treating a protected write like any ask; letting judges, but not auto-approve, approve it.
- **Frontmatter `commandEffects`:** opening it for global agents only, or for both agent scopes.

## Disposition map

| Dependant          | Disposition                                                                                                     | Implemented by            |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------- |
| [comment 1][c1]    | config denies outrank the session layer; deny-aware suggestions (§7)                                            | [#1120]                   |
| [comment 2][c2]    | relaxation in the session, auto-approve a terminal (§5); per-channel attribution (K5); uniform propagation (K7) | [#1118], [#1124], [#1125] |
| PR [#675]          | declined (§3)                                                                                                   | —                         |
| PR [#1073]         | declined; extension-point shapes offered (§3)                                                                   | —                         |
| [#691] / PR [#692] | admitted, reshaped: `*.local.json` targets, integrity contract, re-prompt on failure (§4)                       | [#1122], [#1123]          |
| [#603]             | subsumed by [#691]                                                                                              | [#1122], [#1123]          |
| [#604]             | editable session pattern (§7)                                                                                   | [#1123]                   |
| [#720]             | `--auto-approve` launch flag (§5)                                                                               | [#1118]                   |
| PR [#671]          | declined: an environment variable reaches every child process (§5)                                              | —                         |
| PR [#990]          | admitted as the in-session command, renamed (§5)                                                                | [#1118]                   |
| [#1031]            | auto-approve at the serving node, scoped by requester (§5)                                                      | [#1118]                   |
| PR [#983]          | admitted as proposed (§5)                                                                                       | PR [#983]                 |
| [#1103]            | rules view, plus deny suspension and the issued-grants list (§8)                                                | [#1103]                   |
| [#1102]            | measured against the write-integrity contract (§4)                                                              | [#1102]                   |
| [#1108]            | later scope's patterns placed after (§2)                                                                        | [#1108]                   |
| [#1110]            | `{runtimeDir}`, `{uid}`, `{cwd}` placeholders (§3)                                                              | [#1110]                   |
| ADR 0013 §7        | frontmatter `commandEffects` stays closed (§10)                                                                 | —                         |

Further implementation issues with no dependant: unrestricted (§6, [#1119]), self-protection (§9, [#1121]), legacy files no longer read (§3, [#1126]), strict frontmatter `permission:` block (K3, [#1127]).

[c1]: https://github.com/gotgenes/pi-packages/issues/799#issuecomment-5441061055
[c2]: https://github.com/gotgenes/pi-packages/issues/799#issuecomment-5843171122
[#603]: https://github.com/gotgenes/pi-packages/issues/603
[#604]: https://github.com/gotgenes/pi-packages/issues/604
[#620]: https://github.com/gotgenes/pi-packages/issues/620
[#646]: https://github.com/gotgenes/pi-packages/issues/646
[#671]: https://github.com/gotgenes/pi-packages/pull/671
[#675]: https://github.com/gotgenes/pi-packages/pull/675
[#691]: https://github.com/gotgenes/pi-packages/issues/691
[#692]: https://github.com/gotgenes/pi-packages/pull/692
[#720]: https://github.com/gotgenes/pi-packages/issues/720
[#799]: https://github.com/gotgenes/pi-packages/issues/799
[#983]: https://github.com/gotgenes/pi-packages/pull/983
[#990]: https://github.com/gotgenes/pi-packages/pull/990
[#1031]: https://github.com/gotgenes/pi-packages/issues/1031
[#1073]: https://github.com/gotgenes/pi-packages/pull/1073
[#1102]: https://github.com/gotgenes/pi-packages/issues/1102
[#1103]: https://github.com/gotgenes/pi-packages/issues/1103
[#1104]: https://github.com/gotgenes/pi-packages/issues/1104
[#1105]: https://github.com/gotgenes/pi-packages/issues/1105
[#1108]: https://github.com/gotgenes/pi-packages/issues/1108
[#1110]: https://github.com/gotgenes/pi-packages/issues/1110
[#1115]: https://github.com/gotgenes/pi-packages/issues/1115
[#1118]: https://github.com/gotgenes/pi-packages/issues/1118
[#1119]: https://github.com/gotgenes/pi-packages/issues/1119
[#1120]: https://github.com/gotgenes/pi-packages/issues/1120
[#1121]: https://github.com/gotgenes/pi-packages/issues/1121
[#1122]: https://github.com/gotgenes/pi-packages/issues/1122
[#1123]: https://github.com/gotgenes/pi-packages/issues/1123
[#1124]: https://github.com/gotgenes/pi-packages/issues/1124
[#1125]: https://github.com/gotgenes/pi-packages/issues/1125
[#1126]: https://github.com/gotgenes/pi-packages/issues/1126
[#1127]: https://github.com/gotgenes/pi-packages/issues/1127
