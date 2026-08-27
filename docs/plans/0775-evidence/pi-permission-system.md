# Evidence brief: pi-permission-system

## Purpose signal

The package exists to route a human's attention to consequential agent actions and to record the resulting rulings as deterministic policy.

`packages/pi-permission-system/README.md` states the mechanism: "Permission enforcement extension for the Pi coding agent that provides centralized, deterministic permission gates over tool, bash, MCP, skill, and special operations."

`packages/pi-permission-system/docs/troubleshooting.md` §Threat Model states the goal in one line — "Enforce policy at the host level, not the model level" — and immediately bounds it: "This is a permission decision layer, not a sandbox — for true isolation see [Agent Sandboxes]".

Issue #639 (open, the policy-model ADR) states the purpose most sharply, and it is the maintainer's own framing: "We are never going to beat an agent sandbox at containment.
What we can be is the best at routing human attention to consequential actions — and consequence is about effects (read vs. write vs. exec vs. net), not command spellings."

`packages/pi-permission-system/docs/architecture/architecture.md` §The authority model names the organizing concept: "Every action resolves against an **authority** — an entity empowered to permit or forbid it.
The only questions are *which* authority and how we reach it."
Authority lives in three places — recorded (the ruleset), live (an `Authorizer`, reached only on `ask`), and absent (deny, least privilege) — and a live ruling, once persisted, becomes recorded authority (design principle 8).

The nine numbered design principles in `packages/pi-permission-system/docs/architecture/architecture.md` §Design principles are the compact statement of what the package is: one `Rule` type and one pure evaluation function over all surfaces (1, 2), session approvals and defaults expressed as rules rather than side channels (3, 5), a flat config that *is* the ruleset (6), a two-phase model of tool filtering plus invocation gating (7), and `ask` as a cache miss answered by an oracle whose decision becomes a rule (8).

## In-scope signal

**Closed-unmerged external PRs are overwhelmingly *adopted*, not declined.**
Of the nine closed-unmerged PRs from external contributors, seven were reimplemented on `main` with `Co-authored-by` credit and a comment naming the implementing commits: #292 (UI prompt broadcast contract), #353 (runtime knobs through config merge), #386 (respect Pi's default active tool set), #393 (cwd-normalized path policy inputs), #395 (deny patterns with a custom reason), #643 (preserve `app.tools.expand` during the inline prompt), and #716 (aligned `key : value` dialog layout).
The remaining two, #495 and #496, were closed on a provenance judgment ("This appears to have accidentally been submitted by an agent"), disputed by the author, and their underlying capabilities shipped anyway — symlink resolution before path evaluation (#493, now `docs/decisions/0009-…` "its canonical (symlink-resolved) form is what policy matches") and the indirection-wrapper `allow`→`ask` floor for `sudo`/`bash -c`/`xargs` (#492, #481, #490).
So the accept rate on capability is high; the declines are about *shape and layer*, not about the capability.

**Hardening the gate against bypass is the most-accepted change kind.**
`docs/decisions/0009-bash-path-projection-completeness-contract.md` catalogues five successive bypass fixes accepted into the bash path projection (#494/#509 bare filenames, #520 win32 backslash-relative tokens, #533 MSYS POSIX-absolute tokens, #583 bare `/`, #645 in-project symlinks and `--file=` option values), plus #694 (`$HOME`/`$PWD`) and #741 (substitutions in redirect targets and heredoc bodies).

**Fail-closed changes are accepted even when breaking.**
The README §Upgrading records 16.0.0 (gate errors block; unparseable bash resolves to `ask`) and 22.0.0 (project config requires project trust, per `docs/decisions/0001-project-trust-adoption.md`), and `docs/architecture/architecture.md` §"Fail-closed on an invalid non-global scope" records the `allow`→`ask` clamp for an invalid non-global scope (#646).

**Named, opt-in extension seams are accepted.**
`registerToolAccessExtractor`, `registerToolInputFormatter`, and `registerAuthorizer` (`docs/decisions/0007-model-judge-authorizer-chain-adr.md` §4) are all in-scope; `docs/decisions/0011-prompt-presentation-contract.md` §8 adds annotator and evidence-formatter seams as the sanctioned route for #654 and #648.

**Structural refactoring with a written decision is a first-class change kind.**
Thirteen phases are recorded under `packages/pi-permission-system/docs/architecture/history/`, and internal-only ADRs (0002, 0009) exist purely to pin invariants that no user configures.

## Candidate non-goals

- **Sandboxing or containment** — the package decides and records; it does not isolate.
  `packages/pi-permission-system/docs/troubleshooting.md` §Threat Model: "This is a permission decision layer, not a sandbox — for true isolation see [Agent Sandboxes]", and its Limitations list adds "If a dangerous action is possible via an allowed tool, policy must explicitly restrict it."
  Reinforced in issue #639's framing quoted above.
  No external PR contests this directly, so the durable citation carries it alone.

- **Deciding project trust** — the package observes Pi's trust decision and never makes one.
  `docs/decisions/0001-project-trust-adoption.md` rejected alternative: "the extension is a policy enforcer, not a trust oracle.
  Deciding trust is Pi's and the user's responsibility.
  The extension should observe the decision, not make it."
  No external PR pressure; durable citation only.

- **Sanitizing the config merge so a project scope can only tighten** — trust gating is the chosen lever, not a restrict-only merge.
  `docs/decisions/0001-project-trust-adoption.md` rejected alternative: "the merge semantics are intentional … The right fix is to gate loading on trust, not constrain the merge model."

- **Shipping permissive defaults, trust profiles, or workflow-mode presets** — the operator configures; the package will not guess a risk profile.
  Issue #501 (closed NOT_PLANNED) carries the rationale in full: "I cannot possibly know downstream users' risk profiles, therefore, I try to make sure pi-permission-system ships with conservative, sensible defaults given I don't have that context.
  It *will* create fatigue, unconfigured.
  However, it should be obvious that the solution to that is to start configuring it."
  The same position appears in the #521 close comment — a read-only-bash allowlist shipped as a documented *recipe*, "not a new preset keyword — config stays the source of truth" — and in `docs/opencode-compatibility.md`, which records the deliberate divergence "Default fallback | OpenCode `"*": "allow"` (permissive) | This extension `"*": "ask"` (least privilege)".
  **This boundary rests on no ADR and no numbered design principle.**
  Its only durable-ish citations are a closed-issue comment and a compatibility-doc table row.

- **Built-in secret or sensitive-path denylists** — the user configures `.env`/`~/.ssh` protection; the package ships no hard-coded list.
  `docs/opencode-compatibility.md` divergence table: "`.env` file protection | OpenCode Built-in `read` rules deny/ask `.env` files | This extension No built-in rules; user configures with the cross-cutting `path` surface".
  `docs/decisions/0010-permission-log-secret-exposure.md` gives the reason: "a hard-coded secret denylist was declined because the codebase has no formal secrets model" (referencing #599).

- **Secret *detection* in the logs (value-shape or entropy heuristics)** — redaction is key-name-structural, never predictive.
  `docs/decisions/0010-permission-log-secret-exposure.md`, "Value-shape secret detection — declined", with a measured probe of a live 6.7 MB review log finding "zero true positives", and the decisive argument: "its failure boundary is unstatable: a redactor that silently misses a key is worse than a documented warning, because it invites treating the log as safe to share."
  External-pressure citation: third-party report #647, whose owner-only-mode half was accepted and whose redaction half was reduced to key-name masking.

- **Redacting the permission prompt, or the forwarded request/response files** — the approver must see the real input.
  `docs/decisions/0010-permission-log-secret-exposure.md` §"The prompt is never redacted": "Masking either would blind the approver — a permission regression dressed as a security fix."

- **Disabling the review log by default, or gating `command`/`toolInputPreview` behind an opt-in flag** — reviewability is a stated package priority.
  `docs/decisions/0010-permission-log-secret-exposure.md`, "Making raw payload logging opt-in — declined": "`matchedPattern` without `command` makes 'what exactly did the agent run at 14:32' unanswerable, which is the main reason to read this log."

- **A downstream log-redactor registry** — declined as a seam with no consumer.
  `docs/decisions/0010-permission-log-secret-exposure.md`, "A downstream redactor registry — declined": "it would ship with zero consumers, which is precisely the maintenance trap the package's own guidance warns against."

- **Reading ambient host state to interpret paths** — `cygpath` shell-outs, MSYS environment detection, and `/tmp` → `%TEMP%` mapping are all rejected.
  `docs/decisions/0003-git-bash-posix-path-semantics.md` §Rejected alternatives: "non-deterministic (depends on which bash Pi core resolved and the ambient environment), slow, and it breaks the invariant that the same policy plus the same input always produces the same decision."
  `docs/decisions/0009-bash-path-projection-completeness-contract.md` closes the exception set at two names: "The set is closed: adding a third name is an ADR amendment, not an implementation detail."

- **Per-command argument tables or per-tool option knowledge in the deterministic bash layer** — which positional argument of `grep`/`git`/`kubectl` is a file is not this layer's problem.
  `docs/decisions/0009-bash-path-projection-completeness-contract.md` §"What the projection deliberately omits" and its rejected alternative: "Rejected as a deterministic-layer mechanism: unbounded maintenance surface, and it duplicates in brittle static data what the judge link (#620) does with the command in context."
  The same ADR names glued short-option values (`-f/tmp/x`), nonexistent bare write targets, and computed paths (`$(cmd)`, arbitrary `$VAR`, assignment dataflow) as **accepted residuals, not open bugs**, with measured cost figures for the two declined closures (1.6% reach, 7.0% new prompting).

- **Flooring every unprovable bash token to `ask`** — the package will not buy coverage with a prompt firehose.
  `docs/decisions/0009-bash-path-projection-completeness-contract.md` rejected alternatives: "Promote every bare token to the `path` surface … every bare argument of every command (`git status`, `npm run build`) would prompt", and "Floor to `ask` whenever a bare token cannot be proven safe … defeats any `bash` allow rule under a restrictive path policy."

- **Making the permission manager path-aware** — the evaluation engine stays a string-matching leaf, and the boundary is lint-guarded.
  `docs/decisions/0002-path-values-string-boundary.md`: "The manager is **string-based**: `check()` consumes `ResolvedAccessIntent` … and never imports `AccessPath`", enforced by an ESLint `no-restricted-imports` rule so "collapsing the boundary would then require an explicit, reviewed lint exception."

- **Making an LLM call, or holding model provider/prompt/threshold config** — model mechanism lives downstream; this package owns only policy and enforcement.
  `docs/decisions/0007-model-judge-authorizer-chain-adr.md` §5: "This package declares and *enforces* the safety policy; the downstream extension declares and *uses* the model mechanism … This package holds no model-prompt config it does not read."
  `docs/architecture/architecture.md` §"Discriminating delegation": "this package makes no LLM call itself."

- **Letting a registered authorizer link `allow` on `external_directory` or a secret-shaped `path`** — the bounded-delegation checkpoint downgrades such a verdict to `defer`.
  `docs/decisions/0007-model-judge-authorizer-chain-adr.md` §5: "a link's `allow` on an excluded surface is downgraded to `defer`.
  So the safety envelope lives where it is enforced, and a buggy or over-eager external judge can never exceed the operator's policy", with `external_directory` and secret-shaped `path` "always excluded."
  External-pressure citation: **PR #684** (open) asks for an `allowAuthorizerOnExternalDirectory` opt-in flag that removes `external_directory` from that excluded set.

- **Opt-out authorizer activation, or letting registration alone grant decision authority** — a link decides nothing until the operator names it in `authorizerChain`.
  `docs/decisions/0007-model-judge-authorizer-chain-adr.md` §4 invariant 3 and its rejected alternative: "it lets a loaded extension gain decision authority unless explicitly disabled, and lets load order influence security-relevant chain order.
  Opt-in (config names the chain) is least-privilege by construction."

- **Running authorizer links on a relaying (subagent) node, or a process-global authorizer registry** — one ask is adjudicated by exactly one node's chain.
  `docs/decisions/0007-model-judge-authorizer-chain-adr.md` §7 and its rejected alternative for #727: "it converts every deferring ask into two link runs, and lets a link's verdict short-circuit before the serving node ever sees the request — a privilege change dressed as a plumbing fix."
  External-pressure citation: **PR #702** (open) and issue #699, whose premise ("the child reuses the parent's authorizer") the reporter later withdrew in the #699 thread once one-chain-per-node was made explicit.

- **Re-deriving a forwarded request's facts at the parent** — the child owns the facts, the parent owns the judgment.
  `docs/decisions/0008-cross-session-access-intent.md`: " **No node ever re-derives facts.**
  A node that receives a forwarded request treats the carried facts as given; it never reconstructs them through its own `PathNormalizer`/cwd", with the re-derivation alternative rejected because "it re-introduces the node-of-interpretation flaw the spine exists to remove."

- **A permanently tolerant dual-path wire, or a hard deny on a skewed forwarded request** — a request missing its access-intent field floors to `ask`.
  `docs/decisions/0008-cross-session-access-intent.md` §4 and its two rejected alternatives: a hard reject "breaks a legitimate in-flight request during the rare upgrade window", and a tolerant dual path "carries permanent dual-path complexity for a skew window that is narrow by construction."

- **Truncating or width-capping the assembled prompt message** — bounds belong in a renderer over a complete payload, not in the assembler.
  `docs/decisions/0011-prompt-presentation-contract.md` §2: "A gate emits a **complete** structured payload … It never pre-renders a sentence, never truncates, and never decides what a human will see", and §Alternatives: a width cap "is blind to structure, so it can cut the decision-relevant value while preserving boilerplate, and it bounds the wrong dimension for a viewport complaint."
  External-pressure citations: **PR #656** (open, superseded by the ADR) proposed a 200-character cap on the assembled message; **PR #716** (closed) proposed the aligned layout in the assembler and was closed with "I implemented it as a *render* rather than an assembler change … the assembler version would have made the review log persist unbounded, unredacted tool input as a side effect of the readability fix."

- **Broadcasting evidence or annotations on `permissions:ui_prompt`** — the bus is the narrowest renderer, deliberately narrower than today.
  `docs/decisions/0011-prompt-presentation-contract.md` §6: "Any loaded extension can observe the bus without the operator having named it … So the bus receives the request facts and the verdict, and nothing a renderer would have had to elide", with "Broadcasting the complete payload, or the payload minus annotations" rejected because both "widen what an unconsented observer sees."
  `docs/architecture/architecture.md` §"Reconstruction fidelity at the serving node" states the rule: "Maximum fidelity to the decider; minimum disclosure to the observer."

- **Returning model-generated annotations to the agent** — forbidden outright.
  `docs/decisions/0011-prompt-presentation-contract.md` §7: "A model-generated advisory returned to the agent becomes an instruction, and the agent's model would be reading another model's opinion of its own request as if it were policy."

- **Growing an in-package display for every operator's ideal (edit diffs, natural-language explanations)** — these become downstream packages over the annotator and evidence-formatter seams.
  `docs/decisions/0011-prompt-presentation-contract.md` §8: "a downstream package can supply richer evidence — a diff renderer among them — without this package growing a display for every operator's ideal", and its staging table maps #648 and #654 to that route.
  `packages/pi-permission-system/docs/architecture/history/phase-13-prompt-presentation-seam.md` line 40 records the same disposition.

- **Echoing the agent's own tool input back in denial text** — the agent renderer identifies the call, it does not reproduce it.
  `docs/decisions/0011-prompt-presentation-contract.md` §7: "The agent authored the tool call, so echoing its input back tells it nothing it did not already have … Because the renderer never echoes the input, it needs no separate size bound — the rule bounds it structurally."

- **General agent steering from the permission dialog** — free text is in scope only when it explains the permission decision.
  Issue #328 (closed NOT_PLANNED): "The extension's job is the allow / deny / ask decision for a given operation, and 'tell the agent what to do next' is general steering that's orthogonal to whether a tool call is permitted.
  The one place we capture free text today — the denial reason — is in scope precisely because it explains the permission decision back to the agent."
  **No ADR or numbered design principle states this**; the durable basis is the closed-issue comment plus the `permissions:decision` contract in `docs/cross-extension-api.md`.

- **A yolo mode that overrides explicit denies** — yolo rewrites `ask`→`allow` and is deny-preserving by construction.
  `docs/architecture/architecture.md` §"yolo is recorded authority": "yolo suppresses prompts but **preserves hard denies** … A future 'disable everything' mode — overriding denies too — would be a *different*, deliberately named operation … It is not built, and it would be requested by name, never conflated with yolo."

- **A hard dependency on any one multi-agent extension** — the active agent is learned from a generic signal.
  Design principle 9 (`docs/architecture/architecture.md`): "The package learns the active agent from a generic `<active_agent>` signal (a system-prompt tag or an `active_agent` session entry), never from a hard dependency on any one multi-agent extension, so the bridge works with any tool that emits the signal."
  The same section states the framing: "Pi is single-agent by deliberate design … Per-agent `permission:` frontmatter is therefore an extension bridge layered on this single-agent core, not a core responsibility."

- **Outbound bridges from this core into another named extension's event contract** — a dedicated glue extension is the sanctioned shape.
  `docs/architecture/architecture.md` §"Beyond the target: a pluggable escalation seam": "A dedicated glue extension knowing both ends is the sanctioned complement of the rule against outbound bridges *from a core*."
  External-pressure citation: **PR #693** (open) proposes emitting `herdr:blocked` lifecycle events from this package around every human permission wait (issue #658).
  The durable citation is a rule stated about a *different* direction (this package is the integration owner for pi-subagents, which the same section names as a known one-sidedness), so it supports the boundary by analogy rather than by direct statement.

- **A special evaluation path for MCP, or side-channel fallbacks outside the ruleset** — internal invariants that shape what an accepted change may look like.
  Design principles 4 ("MCP stays special — multi-name target derivation is pre-processing, not a special evaluation path") and 5 ("Defaults are rules … No side-channel fallbacks"), `docs/architecture/architecture.md` §Design principles.

- **Supporting OpenCode's top-level `"permission": "allow"` string shorthand** — a deliberate departure, not an omission.
  `docs/opencode-compatibility.md` divergence table: "Top-level string shorthand | OpenCode `"permission": "allow"` sets all surfaces | This extension Not supported; must use an object", with the porting guide's step 1 giving the translation.

- **A model that classifies access intent *before* `evaluate()`** — explicitly out of scope pending its own decision record.
  `docs/architecture/architecture.md` §"Beyond the target: a non-deterministic access-intent classifier": "Because the classifier changes the *input* to the deterministic core, it weakens the 'same `(toolName, input)` yields the same ruling' property more subtly than the Authorizer does … so it warrants its own decision record and is deliberately out of scope for the current target."
  Restated in `docs/decisions/0007-model-judge-authorizer-chain-adr.md` accepted limitations: "The pre-`evaluate()` classifier stays out of scope."

## Adjacent routing signal

| Capability                                                       | Owning package or venue                               | Citation                                                                                                                                    |
| ---------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| True isolation / containment of a permitted action               | An agent sandbox (external)                           | `docs/troubleshooting.md` §Threat Model links `engine.build/lab/agent-sandboxes`                                                            |
| Model-assisted case-by-case judging of an `ask`                  | `@gotgenes/pi-permission-model-judge`                 | `packages/pi-permission-model-judge/README.md`; `docs/decisions/0007-…` §5 config split and its dogfooding consequence                      |
| Approve-and-steer, and any other post-decision agent instruction | A standalone extension over `permissions:decision`    | Issue #328 close comment, with a worked `pi.events.on("permissions:decision", …)` + `pi.sendUserMessage(…, { deliverAs: "steer" })` example |
| Edit-diff display before approval                                | A downstream package over the evidence-formatter seam | `docs/decisions/0011-…` §8 and its staging table row for #648                                                                               |
| Natural-language risk explanations on the prompt                 | A downstream package over the annotator seam          | `docs/decisions/0011-…` §8 and its staging table row for #654                                                                               |
| Subagent lifecycle and child-session spawning                    | `@gotgenes/pi-subagents`                              | `README.md` "Native `@gotgenes/pi-subagents` integration"; `docs/subagent-integration.md`                                                   |
| Worktree isolation for child sessions                            | `@gotgenes/pi-subagents-worktrees`                    | Root `README.md` packages table; `docs/decisions/0008-…` motivates cross-cwd portability from that arrangement                              |
| Suppressing the `cd $(pwd) &&` habit in the agent's prompt       | `@gotgenes/pi-nocd`                                   | Root `README.md` packages table                                                                                                             |
| TUI over-wide-line crash guard                                   | Upstream `earendil-works/pi`                          | PR #656 maintainer comment endorsing the companion fix `earendil-works/pi#7116` as "the right place for the underlying guard"               |
| Windows shell-flavor path translation                            | Not delegated — declined outright                     | `docs/decisions/0003-…` rejects `cygpath` and MSYS environment detection                                                                    |
| Deciding *whether* a project is trusted                          | Pi core (`project_trust`, `defaultProjectTrust`)      | `docs/decisions/0001-…` "the extension is a policy enforcer, not a trust oracle"                                                            |
| Richer per-server MCP input previews                             | Deferred; no seam yet                                 | `docs/cross-extension-api.md` line 138: "open an issue — that requires a chained-formatter model this seam does not yet provide"            |

## Gaps

**The policy-source channel question is wide open, and it is the largest gap.**
Four open external PRs each propose a *new channel* through which policy or a policy-relaxing signal may enter — **PR #675** (load policy from Pi `settings.json`), **PR #692** (persist approved rules to `config.local.json` at project or global scope, per issue #691 and #603), **PR #671** (a `PI_PERMISSION_SYSTEM_YOLO=1` launcher environment override), and **PR #684** (relax the bounded-delegation envelope by config flag).
No ADR or design principle decides which channels are admissible.
The maintainer said so explicitly on PR #671: "Introducing an environment variable that relaxes the permission policy is a design decision rather than a code review … That decision is tracked in #639, where I'm working out the permission policy model — what's configurable, through which channels, and with what precedence.
Several open requests (#603, #604, #680, and #684) are all asking for related widenings, and I'd rather settle the model once than answer each one ad hoc and end up with an inconsistent surface.
So this is parked pending #639, not declined and not forgotten."
The README's charter cannot assert a boundary here; at most it can name #639 as the open decision.

**Durable persistence of an approval is anticipated, not forbidden.**
Design principle 8 says "Persistence determines lifetime (once / session / config)", and `docs/architecture/architecture.md` §"Authority lives in three places" says "The 'for this session' dialog option writes a session rule; a future 'always' writes config."
So PR #692 / issue #691 must **not** be written up as a non-goal — the artifacts point the other way, and only the channel and confirmation model are undecided.

**Session-approval pattern breadth is undecided.**
Issue #604 asks for a configurable widening of the derived approval pattern (`parent-dir` / `repo-root` / N levels).
No ADR governs pattern derivation breadth; `docs/session-approvals.md` documents the current behavior only.

**Configurable indirection-wrapper floor exemptions are undecided.**
Issue #680 asks to exempt `xargs` and `find -exec` from the `allow`→`ask` floor.
`docs/decisions/0009-…` establishes the floor's *existence* ("a wrapper command that hides its payload … is floored from `allow` to `ask` rather than projected") but says nothing about whether it may be configured off per-wrapper.

**Cancellation is absent from the `Authorizer` contract.**
`docs/decisions/0007-…` fixes three injected parameters (`details`, `query`, `log`) and says nothing about an `AbortSignal`.
Issue #688 and **PR #703** ask for a fourth context argument carrying `ctx.signal`.
There is no boundary to cite either way.

**Log transport and destination are undecided.**
**PR #749** asks for `logging.destination` (`file` / `stdout` / `stderr`) so logging survives a read-only filesystem.
`docs/decisions/0010-…` decides log *content*, *modes*, and *growth bounds*, and is silent on where the bytes go.

**TUI chrome and host-UI parity are undecided.**
**PR #638** (an `overlay` config option) and **PR #757** (a bordered panel plus an inline settings selector matching Pi's native `/settings`) both change presentation *chrome*.
`docs/decisions/0011-…` decides payload completeness, elision rules, and row/width budgets, but says nothing about the dialog's frame, overlay mode, or visual alignment with the host.

**Terminal-replacement registration and non-subagent delegation frameworks are admitted-not-decided.**
`docs/architecture/architecture.md` §"Beyond the target: a pluggable escalation seam" says supporting a chat-approval bot or remote review surface "means editing this package" today, calls the direction "a candidate extension point, not planned work", and states it "warrants its own decision record."
That is a recorded absence, not a boundary.

**Multi-hop escalation and three-way grant scope are admitted-not-shipped.**
`docs/decisions/0006-…` accepted limitations: "Three-way scope (root / parent / requesting subagent) is not shipped.
The tree is depth-2 today"; `docs/architecture/architecture.md` §Resolved direction 2 calls multi-level escalation "admitted, not shipped."

**Windows log hardening is a stated limitation, not a boundary.**
`docs/decisions/0010-…`: "The change is POSIX-effective only.
On Windows `chmod` toggles only the read-only bit and the `mode` options are ignored."

**Whether a capability/effect model (read vs. write vs. exec vs. net) replaces the actor-keyed surface model is undecided.**
Issue #639 is the open ADR for exactly this, and it states "Nothing is locked down going in, including the current config format."
Any README claim about the permanence of the current surface list would contradict it.

**RPC / non-TUI presentation is externally blocked.**
`docs/architecture/history/phase-12-cross-session-intent-authorizer-chain.md` and `phase-13-prompt-presentation-seam.md` both sweep issue #519 as "externally blocked on Pi SDK `UIContext` evolution" — a dependency, not a decision.
