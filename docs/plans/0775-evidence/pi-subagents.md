# Evidence brief: pi-subagents

## Purpose signal

The package's own one-line self-description is a scope statement: "a focused, in-process sub-agent core — autonomous agents that run inside the same pi runtime (no spawned subprocesses), plus a typed API and lifecycle events other extensions build on" (`packages/pi-subagents/README.md`, opening paragraph).
The repo-level routing line agrees: "Focused, in-process autonomous sub-agent core for Pi" (`README.md`, Packages table).

The architecture doc states the same thing as an identity claim rather than a feature list. "pi-subagents **is** a minimal orchestrator with inverted dependencies.
The core spawns a child session derived from the parent, runs the turn loop, tracks and streams and collects the result, gates concurrency, supports resume, and **publishes its lifecycle**" (`packages/pi-subagents/docs/architecture/architecture.md`, "Architecture direction").
Design principle 1 names the complement: "Narrow core — the extension owns agent spawning, execution, and result retrieval.
Everything else is a consumer" (same file, "Design principles").

[ADR-0002] carries the fullest statement of purpose and of the two ways anything else may attach: lifecycle events (observational, unlimited) and provider seams (generative, rationed), with the discriminator "it only needs to **know** what happened → subscribe; it must **return a value the core consumes** → register a provider" (`packages/pi-subagents/docs/decisions/0002-extensions-on-a-minimal-core.md`, "Two extension surfaces").

The comparison document frames the purpose against the fork's origin: "Minimal, composable core" versus upstream's "Batteries-included, all-in-one" (`packages/pi-subagents/docs/comparison-with-upstream.md`, "At a glance").

## In-scope signal

Defect fixes to the surfaces the core already owns are consistently accepted, even when the reporting PR is not merged.
Six third-party reports were adopted as capability: the disabled-agent tool description (#594), duplicate completion nudges (#661), `wait: true` on queued and resuming agents (#662), missing completion lifecycle for stopped-while-queued agents (#665), session-navigator scroll width (#670), and session-preview responsiveness on large transcripts (#690).

Completeness of the **public lifecycle-event contract** is treated as first-class work, not polish.

## 665's argument — "the event contract is asymmetric: whether a user's abort produces a terminal event depends on whether the limiter had admitted the agent yet — a scheduling accident, not a semantic difference" — was accepted, and #466 (resume skipping the completion channels) was fixed for the same reason

`architecture.md` records the resulting invariant in the state-machine notes: "a queued stop publishes the same events, session entry, and nudge a running stop does."

A **user-authored, default-off, global/project settings key** is an accepted shape for a policy the core must consult.
`excludedExtensionPackages` landed this way (#696/#697), and the ADR amendment states the test it passed: "Default inheritance is unchanged — an absent or empty list reproduces prior behavior exactly" ([ADR-0002], "Amendment: prevent-load ships as a settings key, not a provider seam").

Clarifying and then documenting an existing contract, rather than changing it, is an accepted resolution.

## 725 asked whether the child tool-registry cap was intended; the answer was to document it (`docs/configuration.md` "Tool selection", `architecture.md` "Child tool selection") and to fix the two real defects underneath (YAML-sequence `tools:` parsing, a recursion guard that did not survive a tool-registry refresh)

Cosmetic and rendering changes that reduce a real defect class are in scope: the turn/compaction glyph replacement (#681) was adopted, and the maintainer generalized it by centralizing glyph literals into `src/ui/glyphs.ts` first.

Internal refactoring toward the minimal-core target is a standing in-scope activity, sequenced by phase (`packages/pi-subagents/docs/architecture/history/`, phases 1 through 21).

### Candidate non-goals

- **Time-based scheduling (cron / interval / one-shot dispatch)** — design principle 4: "No time-based scheduling — cron-style timed dispatch (upstream's `schedule.ts` subsystem) is removed from the core (#52).
  Timed dispatch is a separate concern that any extension can implement by calling `spawn()` on the published API."
  Durable citation: `packages/pi-subagents/docs/architecture/architecture.md` design principle 4, plus `docs/architecture/history/phase-2-remove-scheduling.md` and the comparison table's "Scheduling — Removed" row.
  No external-pressure citation — no PR in the sweep asked for it back.
  The principle explicitly carves out the concurrency limiter: "The max-concurrent admission gate is not scheduling in this sense."

- **Ad-hoc cross-extension event RPC (`subagents:rpc:*`)** — replaced by the typed `SubagentsService` published via `Symbol.for()`.
  Durable citation: `architecture.md` "What the core dropped" (#49) and design principle 3; `docs/comparison-with-upstream.md` "Cross-extension control" row.
  Reinforced by the event contract's own framing: "These are fire-and-forget broadcast events — no request IDs, no reply channels" (`architecture.md`, event table).
  No external-pressure citation.

- **Group-join / consolidated completion notifications** — removed with the RPC subsystem; the core emits individual per-agent notifications.
  Durable citation: `architecture.md` "What the core dropped" (#49), `docs/architecture/history/phase-3-remove-rpc-groupjoin.md`, and the comparison table's "Notifications" row.
  No external-pressure citation.

- **Model-scope enforcement (an `enabledModels` allowlist validated by the core)** — `docs/comparison-with-upstream.md` lists it as upstream-only, "Not included."
  This rests on a **comparison-table row only** — there is no ADR and no numbered design principle asserting it, and no PR has pushed on it.
  It is closer to a recorded absence than a defended boundary; treat it as the weakest candidate here.

- **Per-agent tool restriction policy in the core (`disallowed_tools`, a built-in denylist)** — evicted to `@gotgenes/pi-permission-system`, which offers allow/ask/deny rather than binary hide.
  Durable citation: [ADR-0002] ("This mirrors Phase 14, which evicted tool/extension *policy* … to `@gotgenes/pi-permission-system`"), `architecture.md` "Responsibilities removed from the core" (#237/#238), and `architecture.md` "Child tool selection" — "Tool *restriction* beyond that stays with `@gotgenes/pi-permission-system`, per [ADR-0002]."
  External-pressure citation: none directly; #612 and #769 push on the *additive* side, below.

- **Widening a child's tool allowlist on the agent's behalf (parent/global tool inheritance)** — the core hands the agent's `tools:` list to the SDK as the complete allowlist and does not add to it.
  Durable citation: `architecture.md` "Child tool selection" — "The core does not widen this on the agent's behalf.
  Inheriting every extension tool a child registers would hand a read-only agent whatever write-capable tools the parent's extensions happen to publish — a capability decision that belongs to whoever writes the agent file, expressed per agent, not a default."
  External-pressure citation: PR #612 (closed unmerged; the close comment gives two concrete failure modes — a read-only `Explore` agent silently gaining `edit`/`write`, and `subagent` re-entering a child's allowlist and reopening the recursion guard), and issue #725, resolved by documenting `tools:` as the supported widening mechanism rather than by inheriting.
  Live pressure: issue #768 / PR #769 (both open) propose an `additionalTools` settings key and argue explicitly that a user-authored, per-type, default-off key is *not* the inheritance the architecture text forbids.
  That distinction is unanswered — see `## Gaps`.

- **Worktree / environment isolation in the core** — one *strategy* for choosing a child's cwd, evicted behind the single workspace provider seam.
  Durable citation: [ADR-0002] "What leaves the core" and its rationale ("The core needs only *a working directory and a disposal hook*; the default (the parent's cwd, no setup/teardown) is always correct"); `architecture.md` "Responsibilities removed from the core" (#263).
  External-pressure citation: none in this package's sweep — PR #705 targets `pi-subagents-worktrees` and is excluded by scope.

- **Persistent agent memory (`memory:`) and skill preloading (`skills:`)** — removed when the core was slimmed; children always inherit the parent's skills.
  Durable citation: `docs/comparison-with-upstream.md` "What upstream has that this fork does not" (both rows); [ADR-0002] "What leaves the core" (`noSkills` removal).
  No external-pressure citation.

- **Per-agent extension lifecycle control (`isolated`, `extensions:`, `noSkills` frontmatter)** — removed; deny-at-use in the permission layer covers what `isolated` pretended to do for tools.
  Durable citation: [ADR-0002] "What leaves the core"; `architecture.md` "Responsibilities removed from the core" (#264).
  External-pressure citation: PR #697, whose own summary accepts the boundary — it proposed `excludedExtensionPackages` as "a narrow, opt-in prevent-load seam without restoring the old broad `extensions`/`isolated` agent frontmatter policy."
  The shipped result is deliberately narrower than what was evicted: "global/project scope only, never per agent type; it names packages rather than individual extensions or tools; and it carries no tool-permission semantics" ([ADR-0002] amendment).

- **New generative provider seams without a concrete consumer ("no vacant hooks")** — the architecture must *admit* a seam without *shipping* it until a real consumer exists.
  Durable citation: [ADR-0002] "The governing rule: no vacant hooks" — "A provider seam with no consumer is not extensibility — it is a speculative abstraction that taxes every reader, and `fallow` flags it as dead"; restated in `architecture.md` "Two extension surfaces."
  Applied in anger in the [ADR-0002] amendment, which **declined** a prevent-load provider seam even after a real OOM reproducer arrived, on the grounds that "no extension wants to supply a prevent-load policy" and the only policy source was the operator's configuration.
  External-pressure citation: PR #614 proposed exactly such a seam (ordered lifecycle interceptors, plus a would-be ADR-0005), explicitly framed as "extend[ing] ADR 0002's provider-seam model."
  **Caveat worth carrying:** #614 was closed by its own author (`nklisch`) with no maintainer comment, so it is evidence of a request withdrawn, not of a recorded decline.
  The durable citation carries this boundary on its own.

- **In-viewer steering or interactive child-session takeover** — the session navigator is strictly read-only.
  Durable citation: [ADR-0004] Addendum Criterion 2 — "steering already has a home (`steer_subagent` tool / the widget).
  Adding in-session steering would create a second, redundant steering surface"; and Criterion 1's rejection of `switchSession` because "the root's in-flight turn does **not** survive the takeover."
  Also stated in the README's `/subagents:sessions` section ("Read-only: no steering, no session takeover").
  No external-pressure citation: PRs #670 and #690 improved the viewer's scrolling and performance without asking for interactivity.

- **Bespoke transcript rendering in the core** — the viewer composes Pi's own public entry components rather than hand-rolling formatting.
  Durable citation: [ADR-0004] Decision B ("keep the core free of transcript-rendering code") and Addendum Finding 1, which verifies the whole render pipeline exists in Pi's public barrel.
  External-pressure citation: PR #690 (closed unmerged, capability adopted) stayed inside this boundary and named the one place it holds: "`custom`-role messages are still skipped (rendering them needs the child session's message-renderer registry)."

- **Agent-definition authoring UI (creation wizard, in-app config editor, an `/agents` menu)** — removed, not deferred.
  Durable citation: [ADR-0004] Decision C — "Create new agent (wizard) → **remove.**
  An operator generates a new agent `.md` by asking a Pi agent directly … or by writing the file in an editor"; "Agent types (list + config editor) → **remove.**
  " The ADR closes the question explicitly: "The agent create/edit surfaces are **not** open questions: both are removed."
  Also stated in the README's Commands section.
  No external-pressure citation.

- **Extracting the surviving UI to a separate package (now)** — the widget, settings command, and session-navigation glue stay in-core as a reactive consumer.
  Durable citation: [ADR-0004] Decision D — "Extraction to a separate `@gotgenes/pi-subagents-ui` package is **not** chosen now," with named revisit criteria ("a second, materially different UI consumer appears, or … the in-core UI starts to pull SDK or rendering concerns back into core modules").
  This is a *not now with criteria*, not a permanent decline; the README should reflect that shading.
  No external-pressure citation.

- **Duplicating foreground progress in the above-editor widget** — the widget exists only as the background-agent surface.
  Durable citation: [ADR-0004] Decision A — "The above-editor widget duplicates the foreground tool's inline `onUpdate` stream.
  The widget survives **only** as the background-agent status surface."
  External-pressure citation: PRs #747 and #748 (both open) push against the *consequence* of this design — an SDK-spawned agent is filtered out of the widget because the roster gate is `record.invocation?.runInBackground === true`, and #748 additionally asks whether the `UICtx`-capture-on-tool-start invariant (#423, pinned by [ADR-0004]) is protecting something specific.
  Neither has a maintainer answer.

- **Propagating the parent's `pi -e <path>` ephemeral extensions into children** — accepted as a standing limitation with a stated revisit criterion.
  Durable citation: [ADR-0001] "Patch 1 is deferred" and its Negative consequence — "The `pi -e <path>` ephemeral-extension case in subagents will not work until Patch 1 lands.
  We accept this because no consumer in scope uses that pattern."
  **Weak durability:** ADR-0001 is marked `status: superseded`, so a README citation to it is citing a superseded document; the limitation is not restated anywhere current.
  No external-pressure citation.

- **Merging third-party pull requests directly** — the repo adopts the capability and reimplements it through its own TDD cycle, closing the PR with credit and a `Co-authored-by` trailer.
  **This boundary rests on no ADR and no design principle.**
  Its only evidence is the close comments themselves, stated near-verbatim across PRs #594, #661, #662, #665, #670, #681, #690, and #697 — e.g. "This repo reimplements adopted third-party changes through its own TDD cycle rather than merging directly, so I'm closing this without merging" (#670, #690) and "Closing this in favor of the independent re-implementation, per the review triage" (#661).
  Eight consistent applications make this the most-exercised boundary in the package's history and the one with the least durable basis.
  It is also a **contribution-process** boundary rather than a capability non-goal, so it may belong in a CONTRIBUTING note rather than a scope charter — flagging the choice for the operator.

- **Flipping the default run mode to background globally** — resisted by inaction across two independent requests.
  **This rests on no ADR and no design principle.**
  External-pressure citation only: PR #613 (open, `defaultRunInBackground` global setting) and PR #740 (open, background-by-default plus a rich non-blocking status kick-back), neither with a maintainer comment.
  The only durable adjacent fact is that per-agent control already exists — `run_in_background` is a documented agent-frontmatter key defaulting to `false` (`packages/pi-subagents/docs/configuration.md`, frontmatter table) — which is a mechanism, not a rationale.
  The README cannot assert this boundary with a citation today; the operator must supply the reason or drop the candidate.

#### Already stated in the README

These candidates are present in the README today and should be **cross-referenced, not restated**, by the charter section.

| Candidate                                                                  | README section                                  |
| -------------------------------------------------------------------------- | ----------------------------------------------- |
| Persistent agent memory (`memory:`)                                        | `## Removed: agent memory and skill preloading` |
| Skill preloading (`skills:`)                                               | `## Removed: agent memory and skill preloading` |
| Per-agent extension lifecycle control (`isolated`, `extensions`, `skills`) | `## Removed: agent memory and skill preloading` |
| Per-agent tool restriction (`disallowed_tools`)                            | `## Migrating from disallowed_tools`            |
| Scheduling                                                                 | `## Relationship to upstream`                   |
| Cross-extension RPC                                                        | `## Relationship to upstream`                   |
| Model-scope enforcement                                                    | `## Relationship to upstream`                   |
| Built-in tool denylist                                                     | `## Relationship to upstream`                   |
| Worktree isolation in the core                                             | `## Worktree Isolation`                         |
| In-viewer steering / session takeover                                      | `### /subagents:sessions`                       |
| Agent-definition authoring UI                                              | `## Commands` (closing sentence)                |

Everything else in the candidate list above is **not** currently asserted in the README.

### Adjacent routing signal

| Capability                                                                             | Owning package or surface                                                                                    | Evidence                                                                                                                                                  |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool restriction, allow/ask/deny policy, per-agent permission                          | `@gotgenes/pi-permission-system`                                                                             | README `## Migrating from disallowed_tools`; [ADR-0002]; `architecture.md` "Child tool selection"                                                         |
| Worktree / workspace isolation, git plumbing, save-to-branch                           | `@gotgenes/pi-subagents-worktrees`                                                                           | README `## Worktree Isolation`; [ADR-0002] "What leaves the core"; the worktrees README's own "Worktrees are one *workspace strategy*, not core behavior" |
| Timed / cron dispatch                                                                  | Any extension calling `spawn()` on the published service                                                     | design principle 4                                                                                                                                        |
| Telemetry, OTel, auditing, cost tracking                                               | A consumer subscribing to the lifecycle events                                                               | design principle 10; `architecture.md` "Composition model"                                                                                                |
| Replacement or alternate UI                                                            | A downstream package targeting the public broadcast-plus-query surface                                       | [ADR-0004] Decision D                                                                                                                                     |
| Batteries-included alternative (scheduling, RPC, model-scope, denylist in one package) | Upstream `@tintinweb/pi-subagents`                                                                           | `docs/comparison-with-upstream.md` "Which should I use?"                                                                                                  |
| Preventing a package's extensions from loading in children                             | The `excludedExtensionPackages` setting — deliberately *not* per-agent frontmatter and *not* a provider seam | [ADR-0002] amendment; `docs/configuration.md` "Excluding package extensions from children"                                                                |
| Giving a child an extension's tool                                                     | The agent's own `tools:` frontmatter list                                                                    | `architecture.md` "Child tool selection"; `docs/configuration.md` "Tool selection"; issue #725 resolution                                                 |
| Approve-and-steer in the permission dialog                                             | Filed against `pi-permission-system`, closed not-planned                                                     | issue #328                                                                                                                                                |
| Live remote viewing / operator interaction with a child session                        | Blocked on Pi's own client-server split; recorded as an opportunity, not owned here                          | `docs/architecture/client-server-opportunities.md`                                                                                                        |

Three issues closed as not-planned (#257 "Extract ChildSessionFactory from runner", #258 "Agent owns session lifecycle", #259 "Dissolve runner concept") route internally rather than to another package: they were the "agent collaborator architecture" of Phase 16, abandoned by [ADR-0002] ("#256 is superseded (worktree was placed in the wrong layer); #257 is parked (it polished a subsystem slated for eviction)").
They are evidence of a rejected *internal* direction, not of a scope boundary against outside requests.

### Gaps

- **The foreground default.**
  Nothing in any ADR, design principle, or doc explains why `run_in_background` defaults to `false` at the tool level, or whether a global override is undesirable. #613 and #740 have sat open without a stated position.
  The operator must supply this boundary or concede it.

- **The additive-settings-key line.**
  `architecture.md` forbids the *core* widening a child's allowlist "on the agent's behalf," and [ADR-0002]'s amendment blesses a user-authored settings key for the subtractive case.
  Issue #768 argues, in the maintainer's own vocabulary, that an additive user-authored key is the same shape.
  No artifact answers whether the boundary is "the core does not decide" (which #769 satisfies) or "the allowlist is per-agent-file only" (which it does not).
  This is the single most likely place a charter sentence will be tested next.

- **The status of the SDK spawn path.**
  Issue #724 and PRs #747 / #748 all report that `getSubagentsService().spawn()` is second-class relative to the `subagent` tool path (no `invocation`, no `parentSession`, permanently invisible to the widget).
  No artifact states whether the SDK path is intended to be at parity with the tool path.
  Given that the typed service is design principle 3's headline deliverable, its parity status is a scope question, not a bug backlog item.

- **Stability policy for the public DTO surface.**
  PR #748 explicitly flags that widening `SubagentRecord` with required fields breaks external implementors, and asks for direction.
  Nothing states what compatibility guarantee `SubagentRecord`, `SubagentsService`, or the event payloads carry — even though [ADR-0003] built a whole `dist/public.d.ts` pipeline to make them externally consumable.

- **Parent-data redaction / privacy projections.**
  PR #615 proposes an opt-in `parentResultMode: "redacted"` for SDK-spawned children.
  No doc takes a position on whether controlling what a child sees of its parent belongs in this core or in a consumer.
  Under the [ADR-0002] discriminator it looks generative (the core would consume the projection), which would make it a provider-seam question — but the artifacts never say so.

- **Result-presentation ownership.**
  Issue #636 and PR #729 ask for collapsed/expanded rendering of `get_subagent_result`, and PR #740's second half enriches the running-agent kick-back.
  [ADR-0004] decided the *widget* and the *viewer* from first principles but never the tool-result renderer, so there is no stated line between "the core renders enough for the LLM" and "the core renders for the operator."

- **The contribution-process boundary.**
  Reimplement-not-merge is applied with total consistency and written down nowhere.
  Whether it belongs in the scope charter, a `CONTRIBUTING.md`, or the issue templates is an operator decision this brief cannot make.

- **Deferral versus decline.**
  `client-server-opportunities.md` is explicit that Pi's client-server split "is **not on the near-term roadmap**" while recording what it would unlock (live session watching, operator interaction with a subagent through an editor).
  That is a deferral pending an upstream capability, not a boundary, and it should not be written as a non-goal.

[ADR-0001]: ../../../packages/pi-subagents/docs/decisions/0001-deferred-patches.md
[ADR-0002]: ../../../packages/pi-subagents/docs/decisions/0002-extensions-on-a-minimal-core.md
[ADR-0003]: ../../../packages/pi-subagents/docs/decisions/0003-publish-bundled-type-declarations.md
[ADR-0004]: ../../../packages/pi-subagents/docs/decisions/0004-reconsider-ui-direction.md
