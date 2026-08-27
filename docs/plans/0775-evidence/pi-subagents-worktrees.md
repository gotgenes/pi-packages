# Evidence brief: pi-subagents-worktrees

## Purpose signal

The package exists to be one *workspace strategy* implementation on `@gotgenes/pi-subagents`'s `WorkspaceProvider` seam: it runs opted-in subagent child sessions in a temporary git worktree and rescues their work to a branch when they finish.
`packages/pi-subagents-worktrees/README.md` opens with exactly that framing — "This extension registers a `WorkspaceProvider` with the subagents core: opted-in agents run in a temporary git worktree (an isolated copy of the repo), and any changes they make are saved to a branch when they finish" — and immediately states the boundary: "Worktrees are one *workspace strategy*, not core behavior — so the git plumbing lives here, outside the minimal subagents core (see [ADR-0002] in the pi-subagents package)."

The origin is a deliberate extraction from the subagents core, not a greenfield idea.
Issue #263 ("Extract worktree isolation to @gotgenes/pi-subagents-worktrees", Phase 16 Step 3) states the motivation in one sentence: "Worktrees are not intrinsic to what makes subagents useful.
They are one workspace strategy and belong outside the core, exactly as Phase 14 evicted tool/extension policy to `@gotgenes/pi-permission-system`."
Its acceptance criteria make the boundary mechanical rather than aspirational: "`git` no longer appears in the pi-subagents core", "the core spawn API and `SubagentsService` no longer expose `isolation`", and "uninstalling it leaves children running in the parent cwd".
The core README records the same event from the other side: `packages/pi-subagents/README.md` § "Worktree Isolation" says "Worktree isolation lives in a companion package, not this core" and "The earlier `isolation: \"worktree\"` spawn flag and `isolation:` frontmatter key were removed from the core."

The scaffold commits carry the same shape (`commit 9a7dcfc5` "scaffold pi-subagents-worktrees with git worktree plumbing", `commit ec563a80` "add worktreeAgents config loader", `commit 0e87505a` "implement git worktree WorkspaceProvider", `commit 18d0db42` "register worktree provider at extension init").
`packages/pi-subagents-worktrees/src/index.ts`'s module docstring restates the division of labor precisely: "The core consults the provider for every child run; this package decides which agents get a worktree (via the worktreeAgents config) and brackets the run with git plumbing." `package.json`'s description is the one-line version: "Git worktree isolation for @gotgenes/pi-subagents — a WorkspaceProvider that runs subagents in isolated worktrees."

A second purpose emerged after the extraction and now carries roughly half the surface: **not losing the child's work**.
`packages/pi-subagents-worktrees/docs/plans/0704-preserve-worktree-on-cleanup-failure.md` states the rule as "Never remove a worktree whose cleanup did not demonstrably succeed", and `packages/pi-subagents-worktrees/docs/plans/0714-surface-preserved-rescue-worktrees.md` extends it to visibility: "[#704] converted immediate silent loss into delayed silent loss.
This issue closes that loop."

## In-scope signal

The 52-commit history shows six kinds of change being accepted.

Git plumbing for the child-run lifecycle — create a detached worktree at `HEAD` before the run, commit-and-branch or remove it after, prune orphans at init (`commit 9a7dcfc5`, `commit 0e87505a`, `commit 18d0db42`; the modules are `src/worktree.ts` and `src/workspace-provider.ts`).

Data-loss hardening on the cleanup path — preserve the worktree when cleanup fails rather than force-removing it, and retry a hook-rejected rescue commit once with `--no-verify` after re-staging (`commit 4a3f8e20` "preserve the worktree when cleanup fails (#704)", `commit b9d17cbc` "retry the rescue commit with --no-verify (#704)").
The plan is explicit that both halves were required: "The worktree must not be destroyed when its fate is uncertain, and the rescue commit must actually succeed in the case that motivates the report — otherwise every run in a hook-using repository merely trades destroyed work for an abandoned worktree" (`docs/plans/0704-preserve-worktree-on-cleanup-failure.md`).

Recovery visibility for preserved worktrees — a live-worktree registry, path-heuristic discovery, a `session_start` warning, and a `/subagents-worktrees` command that lists and (after confirmation) removes one (`commit 06afe431`, `commit 4fe0acdc`, `commit a270e8fe`, `commit a081cbf8`, `commit 9e101e0b`, `commit cd98283f`).

Configuration surface for opt-in — the `worktreeAgents` list, its layered global/project files, and later its migration onto the shared loader published by the core (`commit ec563a80`; `commit 7e89bb83` "consume shared loadLayeredSettings helper (#415)").
`docs/plans/0415-migrate-config-to-loadlayeredsettings.md` frames that migration as consumer-only work: "Do not touch `@gotgenes/pi-subagents` itself — the helper is already published."
Expanding the config's expressiveness is live rather than declined: issue #707 ("Allow wildcards in subagent worktree settings") is **open**, labeled `enhancement` / `pkg:pi-subagents-worktrees`, and is named in both later plans only as out-of-scope-for-that-change ("touches `src/config.ts` only and does not overlap this change").

Internal design work with no user-visible change — extracting git helpers, replacing the ambiguous `{ hasChanges, branch?, path? }` result with a discriminated union, removing an output-argument mutation, and consolidating test fixtures (`commit 7411088c`, `commit e1baca45`, `commit da69cd27`, `commit 83e0ed52`, `commit 7516e614`, `commit 935af78c`).

Packaging and publishing hygiene shared with the rest of the monorepo — a `files` allowlist, exclusion of internal plans and retros from the tarball, and adding the package to the release publish allowlist (`commit 71247673`, `commit 896dc234`; `docs/plans/0001-publish-worktrees-package.md` for issue #369).

## Candidate non-goals

- **Worktree knowledge in the subagents core, or an `isolation` axis on the spawn API** — the extraction's whole point was to make git absent from the core, and the flag that used to request it was deleted rather than deprecated.
  Citations: issue #263 acceptance criteria ("`git` no longer appears in the pi-subagents core"; "The core spawn API and `SubagentsService` no longer expose `isolation`") and its close comment ("feat!: remove git worktree isolation from the subagents core — worktree.ts, worktree-isolation.ts, GitWorktreeManager, and SubagentRecord.worktreeResult deleted"); `packages/pi-subagents-worktrees/README.md` § "Migrating from `isolation: \"worktree\"`"; `packages/pi-subagents/README.md` § "Worktree Isolation".

- **Doing anything at all when `@gotgenes/pi-subagents` is absent or loaded after this package** — the no-op contract is documented, wired as an early return, and pinned by a test that asserts `pi.on` is never called.
  Citations: `packages/pi-subagents-worktrees/README.md` § Install ("If `@gotgenes/pi-subagents` is not loaded first (or not installed at all), this extension does nothing"); `docs/plans/0714-surface-preserved-rescue-worktrees.md` Non-Goals ("No reporting when `@gotgenes/pi-subagents` is absent.
  The package's documented contract is that it does nothing without the core") and Invariants ("Registering the notice or the command before the service check would regress it, so both go after"); `packages/pi-subagents-worktrees/src/index.ts`.

- **Automatic deletion or reclamation of a preserved worktree** — preservation exists precisely because the content is not safe to discard on the extension's judgment, so every removal path requires a human decision.
  Citations: `docs/plans/0704-preserve-worktree-on-cleanup-failure.md` Non-Goals ("No automatic reclamation of preserved worktrees, and no startup reporting of them"); `docs/plans/0714-surface-preserved-rescue-worktrees.md` Non-Goals ("No automatic deletion, and no removal without an explicit confirmation.
  The point of [#704] is that this content is not safe to remove without a human deciding") and Invariant 4; `packages/pi-subagents-worktrees/README.md` § "Recovering preserved worktrees" ("nothing here is ever deleted automatically, because a failed cleanup is exactly the case where the content is not safe to discard on the extension's judgment").

- **An agent-facing tool for worktree inspection or removal** — a slash command and an agent tool were weighed against each other and the command won on the grounds that only one of them hands the model a destructive git operation.
  Citations: `docs/plans/0714-surface-preserved-rescue-worktrees.md` Non-Goals ("No agent-facing tool.
  Removal is destructive and user-confirmed; the slash command already lets the user act without leaving the session, without giving the model a path to a destructive git operation"); `docs/retro/0714-surface-preserved-rescue-worktrees.md` Planning stage ("An agent tool was rejected in favor of a slash command.
  Both let the user act without leaving the session; only one puts a destructive `git worktree remove --force` within the model's reach").

- **Automated recovery of work from a preserved worktree (a retry-the-rescue action)** — recovery is deliberately left as manual git work the user performs however they normally would.
  Citations: `docs/plans/0714-surface-preserved-rescue-worktrees.md` Non-Goals ("No retry-the-rescue action (re-running the rescue commit on a preserved worktree from the command).
  Considered and deliberately rejected for this round; recovery stays manual git work") and Open Question 1; `docs/retro/0704-preserve-worktree-on-cleanup-failure.md` PR Review stage Non-goals ("No automatic reclamation of preserved worktrees; recovery stays manual"); `packages/pi-subagents-worktrees/README.md` § "Recovering preserved worktrees".

- **Retry logic beyond the single `--no-verify` commit attempt** — the retry is scoped to the one failure mode that motivated it, and a failure anywhere else preserves rather than retries.
  Citation: `docs/plans/0704-preserve-worktree-on-cleanup-failure.md` Non-Goals ("No retry beyond the single `--no-verify` attempt, and no retry for `git add` or `git branch` failures").

- **A config key gating the commit-hook bypass** — the security trade-off was examined and resolved toward an unconditional bypass plus an explicit notice, rather than a knob.
  Citations: `docs/plans/0704-preserve-worktree-on-cleanup-failure.md` Non-Goals ("No configuration key gating the hook bypass.
  The bypass is unconditional and announced in the addendum instead") and its risk table; `docs/retro/0704-preserve-worktree-on-cleanup-failure.md` Planning stage ("Rejected a config key in favor of an unconditional bypass plus an explicit addendum notice, on the reasoning that the alternative leaves the same content sitting in `tmpdir` with less visibility, not more safety").

- **Marker files or `git worktree lock` state written at preservation time** — a richer detection mechanism was measured and rejected in favor of a path heuristic, partly so already-shipped preserved worktrees remain findable.
  Citations: `docs/plans/0714-surface-preserved-rescue-worktrees.md` Non-Goals ("No marker file and no `git worktree lock` at preservation time.
  Detection uses the path heuristic only, so worktrees preserved by the already-shipped v0.2.4 are found too"); `docs/retro/0714-surface-preserved-rescue-worktrees.md` Planning stage ("`git worktree lock --reason` was measured to work well … but it only marks worktrees preserved after this ships, and a tmp-reaped locked entry survives `prune` as permanent repo cruft").

- **Arbitrating worktree ownership across concurrent Pi processes** — a worktree belonging to another Pi process against the same repository is knowingly reported as preserved, with the confirmation dialog and documentation as the mitigation.
  Citations: `packages/pi-subagents-worktrees/README.md` § "Recovering preserved worktrees" ("A worktree belonging to a **different** Pi process running against the same repository cannot be told apart from an abandoned one, so it is listed too — check the path before removing anything"); `docs/plans/0714-surface-preserved-rescue-worktrees.md` Design ("A worktree belonging to a **different** Pi process cannot be excluded; that limitation is documented in the README") and its risk table.

- **A public API surface beyond the default extension function** — the package's internals are deliberately unreachable, which is what made the discriminated-union rewrite a non-breaking `fix:`.
  Citations: `docs/plans/0704-preserve-worktree-on-cleanup-failure.md` ("`WorktreeCleanupResult` is internal: the package's `exports` map is `{ \".\": \"./src/index.ts\" }`, `index.ts` exports only the default extension function, and no file outside this package references `cleanupWorktree`, `WorktreeCleanupResult`, or `WorktreeInfo`"); `docs/retro/0704-preserve-worktree-on-cleanup-failure.md` Planning stage ("Deep imports are blocked by the `exports` map, so the union is an internal change"); `packages/pi-subagents-worktrees/package.json` `exports`.

- **Changing the rescue commit's `pi-agent: <description>` subject to satisfy conventional-commit linters** — considered, and rejected because a compliant subject would still lose to hooks that fail for other reasons, which is what the `--no-verify` retry is for.
  Citations: `docs/plans/0704-preserve-worktree-on-cleanup-failure.md` Non-Goals ("No change to the rescue commit's `pi-agent: <description>` subject or the 200-character truncation") and Open Question 2.

## Adjacent routing signal

**Deciding whether a child gets an isolated workspace at all, and the seam that asks -> `@gotgenes/pi-subagents`.**
The core owns the `WorkspaceProvider` seam and consults it for every child run; this package only answers for the agent types listed in `worktreeAgents`.
Requesting isolation through a core spawn flag was removed, not relocated: issue #263 ("Drop `isolation` from the spawn API and `SubagentsService`"), `packages/pi-subagents/README.md` § "Worktree Isolation", and this package's README § "Migrating from `isolation: \"worktree\"`".

**A child's system prompt and its working-directory claim -> `@gotgenes/pi-subagents` (and `@gotgenes/pi-nocd`).**
This is the clearest routing event in the history.
Issue #640 ("Child inherits parent's stale 'working directory' claim, defeats WorkspaceProvider/worktree isolation") was filed *against* worktree isolation, carries the `pkg:pi-subagents-worktrees` label, and reproduces only with this package installed — yet the reporter's own diagnosis records that "`WorkspaceProvider` mechanics worked correctly (each child's session/tool cwd was its own isolated worktree)".
The fix landed entirely elsewhere (`commit 449078d0` in pi-subagents' `buildAgentPrompt`, `commit a1695929` in pi-nocd), and `git log -- packages/pi-subagents-worktrees` contains no commit for #640.
Prompt content is the core's concern even when the symptom is a defeated worktree.

**Layered global/project settings loading -> `@gotgenes/pi-subagents`'s `./settings` subpath.**
The read-sanitize-warn-merge idiom was extracted into the core's shared `loadLayeredSettings<T>` helper (issue #380) and this package became its first cross-package consumer, deleting its local copy (`commit 7e89bb83`; `docs/plans/0415-migrate-config-to-loadlayeredsettings.md`).
The plan explicitly routes the helper's own tests away from here: "`loadLayeredSettings` is tested in `packages/pi-subagents/test/…`; re-testing it here would duplicate that coverage."

**Publish and release mechanics -> repo-root tooling.**
Issue #369's fix was a one-line addition to `scripts/publish-released.sh` with no change under `packages/pi-subagents-worktrees/` at all: "No source, test, or doc files in `packages/pi-subagents-worktrees/` change" (`docs/plans/0001-publish-worktrees-package.md`).

**One external PR, declined as an implementation but adopted as a capability.**
PR #705 (@AndersBennedsgaard) is the package's only closed-unmerged third-party PR.
It was **not** a scope decline — `docs/retro/0704-preserve-worktree-on-cleanup-failure.md` § "Decision and attribution" records "adopt the capability, plan a simplified design", and the close comment on #705 says "We ended up adopting the capability with a simplified design rather than merging this PR directly."
What the decline defended was design and completeness, not territory, and three specific objections are on the record: preserve-only "converts 'silent loss, once' into 'unbounded worktree accumulation, forever, plus an error addendum on every run'"; a fourth optional field on `{ hasChanges, branch?, path?, error? }` should be a discriminated union; and the contributed tests asserted `existsSync(wt.path)` rather than "the property that actually matters, namely that the agent's file content survived in the preserved worktree".
The review also declined to import the contributor's `docs/plans/` and `docs/retro/` files, "partly because the contributor's plan repeats the incorrect `git fsck` claim corrected above", and required a `Co-authored-by` trailer on every implementation commit.

## Gaps

**The boundary against the repo's own peer-session worktree tooling is entirely unrecorded.**
`AGENTS.md` § "Parallel peer sessions (git worktrees)" and root `README.md` § "Parallel worktree workflow" describe `scripts/worktree-new.sh` and the project-local `.pi/extensions/worktree.ts` slash command, which create branch `issue-<N>-<slug>` worktrees under `~/development/pi/pi-packages-worktrees/` for human-driven peer Pi sessions.
A grep of the entire `packages/pi-subagents-worktrees/` tree for `worktree-new`, `peer session`, `parallel peer`, and `.pi/extensions/worktree` returns nothing.
This is **absence, not a boundary**: the two mechanisms differ in every observable (temp-dir detached worktrees for subagent child sessions versus named branches under a stable directory for human sessions; a `WorkspaceProvider` versus a shell launcher), but no artifact states that serving the peer-session workflow is out of scope for this package.
What would confirm it: an operator statement in the charter, or a declined request to generalize `createWorktree` for human sessions.

**No architecture document, no ADR of its own, and no package skill.**
Both `docs/plans/0704-*.md` and `docs/plans/0714-*.md` note "This package has no `docs/architecture/` directory", and root `README.md` line 217 lists it among packages with "no dedicated skill — their READMEs cover everything you need".
The only architectural rationale lives in `pi-subagents`'s ADR-0002, which this package's README links but does not restate.
There is consequently no existing home for a charter, and no roadmap against which release batching or phase scope is decided ("This package has no `docs/architecture/` roadmap, so this issue belongs to no release batch").

**Worktree location and layout are unexamined.**
`createWorktree` places worktrees under `tmpdir()` and the discovery heuristic depends on that (rule 3, "under the resolved temp root"), but no artifact records a decision to keep it there, decline a configurable worktree root, or accept the consequence that "the temp directory is cleared periodically" as the intended retention policy.
The tmp reaping is described as a hazard to mitigate (`docs/plans/0714-*.md` Problem Statement), never as a chosen design.

**Nothing after the branch is written.**
The README's contract ends at "Merge with: `git merge <branch>`".
No artifact accepts or declines merge automation, PR creation, branch naming configuration, or cleanup of the `pi-agent-<id>` branches the package creates.
This is absence; a statement that post-branch workflow belongs to the user would convert it to a boundary.

**Non-git version control is unmentioned.**
The package name, config key, and every mechanism assume git worktrees, but no artifact declines jj, hg, or a copy-based workspace strategy.
The `WorkspaceProvider` seam is explicitly pluralized in the core's framing ("one workspace strategy"), which implies a sibling package rather than an extension of this one — but that inference is the operator's to confirm, not something the artifacts state.
