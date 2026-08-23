---
issue: 639
issue_title: "pi-permission-system: decide the permission policy model — capabilities, config shape, prior art (ADR 0013)"
---

# Pressure test: ADR 0013 — permission policy model

This is an adversarial pre-ship review of `docs/decisions/0013-permission-policy-model.md`, conducted on 2026-08-23 at the operator's request by a fresh-context reviewer running `anthropic/claude-fable-5`.
The reviewer was given the artifacts and the raw review log rather than the ADR's conclusions, and was instructed to re-derive anything load-bearing.

Its verdict was **do not ship as written**.
The dispatcher (the implementing session) independently verified the blocking findings afterward and agrees.

Two notes on provenance.
The reviewer's own scratch scripts did not survive its session, so the appendix contains the **dispatcher's** verification scripts, which reproduce the corrected numbers; where a figure came from the reviewer's script and was not independently re-derived, it is marked as such.
Findings F1, F2, F3, and F9a carry corrections established after the reviewer finished; each is labelled.

## Verified findings

### F1 — The measurement tables are wrong: the classifier missed the log's newer schema

Severity: **blocking**.

Claim attacked: "Over 1141 human-facing `permission_request.waiting` entries… `external_directory` 846 (74.1%)…", and the monthly table's "2026-08 | 146 | 37 | 25%", with the narrative "it has since fallen to 25% … formerly-external paths became in-tree."

The log has two entry schemas.
Older entries carry `message`; entries from roughly 2026-08-17 onward carry `surface`/`matchedPattern` and no `message`.
The ADR's external count of 846 equals exactly the message-keyed external entries.
The surface-keyed `external_directory` entries — all August, all genuine human asks against real paths, zero fixtures — were dropped or mis-binned.

The "boundary pressure has since fallen to 25%" paragraph, and the layout-change causal story attached to it, is a measurement artifact.
The corrected series shows the external share is roughly stable, which strengthens decision 1's warrant while falsifying the written analysis.
The error had already propagated into the retro's build-stage notes.

**Dispatcher verification (confirmed, and figures corrected).**
89 `permission_request.waiting` entries carry no `message` field, all from 2026-08-17 onward, of which **72 are `surface: "external_directory"`** and 17 are `bash`.
Corrected monthly external share:

| Month   | As reported in ADR 0013 | Corrected |
| ------- | ----------------------- | --------- |
| 2026-05 | 77%                     | 77%       |
| 2026-06 | 100%                    | 100%      |
| 2026-07 | 73%                     | 73%       |
| 2026-08 | 25%                     | 72%       |

Corrected totals: 1146 human-facing asks, of which 918 (80.1%) are `external_directory`.
The share is stable at 72–80% across all four months.

Evidence that would settle it: rerun the classification treating `surface: "external_directory"` entries as external, and publish the classifier alongside the ADR.

### F2 — The headline was produced by the rejected mechanism, and it misclassifies writes as reads

Severity: **should-fix-before-ship**.

Claim attacked: "read — bash with read-only command words 484 (57.2%)… [82.4% reads]" and "a ~40-word command table that left 1.8% unclassified."

Decision 7 rejects a read-only command allowlist as an enforcement mechanism because it fails open.
The ADR's headline statistic was produced by exactly such a table, which classified `git`, `node`, `sed`, `awk`, `xargs`, `echo`, and `printf` as read-only words.
The reviewer found provable writes sitting inside the resulting read bucket, including `git add`/`git commit` sequences, a `sed -i`, and package installs — the precise fail-open failure decision 7 cites when rejecting the table for enforcement.

On the circularity charge, the reviewer's judgement was that using a fail-open classifier for measurement while rejecting it for enforcement is defensible in principle — a measurement error inflates a statistic, it does not grant privilege — but only if the ADR states the dependence and bounds the error.
It does neither: it presents the instrument's output as fact and does not preserve the instrument.

**Dispatcher verification (confirmed; strict re-run below supersedes the reviewer's own estimate).**
A strict classifier that excludes `git`, `node`, `sed`, `xargs`, and `pnpm` from the read-only set, and that correctly excludes fd-duplication (`2>&1`) and `/dev/null` discards from redirect detection, yields:

| Direction | Loose table (shipped in ADR 0013) | Strict      |
| --------- | --------------------------------- | ----------- |
| read      | 82.4%                             | 272 (29.6%) |
| write     | 15.8%                             | 163 (17.8%) |
| unknown   | 1.8%                              | 483 (52.6%) |

Reads outnumber writes roughly 63:37 among classifiable asks, so decision 1's direction survives.
The magnitude was overstated, and the finding the ADR buried is that **a majority of external asks have no provable direction at all**.

The dispatcher's first strict attempt was itself wrong in the opposite direction, reporting a 34% read share, because its write regex matched `2>&1` and `2>/dev/null`.
That is recorded here because it is the same class of error as the ADR's: a classifier presented without its source invites nobody to catch it.

Evidence that would settle it: commit the word table and script, and report the strict variant beside the loose one.

### F3 — No mechanism in the ADR delivers the majority of the relief it promises

Severity: **blocking**.

Claims attacked: staging step 1's "Ships the measured prompt relief"; decision 7's "the chain (#620, #698) supplies it… or decision 8 removes the need for it"; and the consequence "A user can permit reading outside the working tree without permitting writing there, which is the measured majority of what the boundary currently stops."

Tracing each channel for the bash-read majority:

1. **Deterministic layer.**
   Decision 7 explicitly refuses to classify reads.
   Step 1's directional keys can therefore relieve only asks whose direction comes from the actor — the read-only tools.
2. **Judge chain.**
   `DELEGATION_EXCLUDED_SURFACES` caps any link's `allow` on `path`/`external_directory` to `defer`, and decision 4 extends this to the whole directional family.
   A chain link cannot retire an external-directory read prompt by allowing it.
3. **Sandbox declaration.**
   Staging step 3, last, with no launcher in existence or committed anywhere.

After all three staged steps the bash majority still prompts unless an unbuilt external launcher materializes.
The ADR's consequence bullet is written in the present tense about a capability none of its stages delivers.

**Dispatcher verification (confirmed, with a measured figure).**
Of 918 external asks: 236 (25.7%) are read-only tools whose direction is known from the actor; 57 (6.2%) are write tools; **620 (67.5%) are bash**, where direction needs command knowledge.
Staging step 1 therefore relieves **20.6% of all 1146 human-facing asks**, not the measured majority.

Evidence that would settle it: a worked trace in the ADR naming, for `cat ~/other-repo/file` under `external_directory_read: {"*": "allow"}`, the component that suppresses the prompt at each stage.
Today the answer is none.

### F4 — The unknown-direction consultation rule is never specified

Severity: **blocking**.

Claim attacked: decisions 3, 4, and 7 jointly — the semantics of the directional surfaces.

After decision 7, a bash path operand is either a write (a redirect destination) or undirected (everything else, the overwhelming majority).
The ADR never states which surface an undirected access consults: `path_read`, `path_write`, both under most-restrictive, or the pre-expansion sugar pair.
This is the most load-bearing rule of the new model and it is absent.

Both candidate answers are damaging.
Consult-both, fail-closed, means `external_directory_read: allow` gives no bash relief, confirming F3.
Consult-read, fail-open, means `sed -i`, `git commit`, and `rm -rf` sail through a read allow.

Under the ADR's own criterion 3 — no config text with two plausible readings — the flagship example in decision 4 has an undefined effect on most of the traffic it is advertised to relieve.

Evidence that would settle it: a decision sentence fixing the rule, plus its consequence for relief accounting.

### F5 — Decision 4's sugar merge semantics are ambiguous, violating criterion 3

Severity: **should-fix-before-ship**.

When a config contains both `path` and `path_write`, or both `external_directory` and `external_directory_read` — the ADR's own idiomatic example — the expanded surface holds rules from two sources.
"Last matching pattern wins" is defined over one map's ordering.
It does not say whether sugar-expanded entries precede or follow explicit directional entries, and for two identical patterns it says nothing at all.

If JSON key order is the tiebreaker, then a config and its key-swapped twin mean different things — config text with two plausible readings, the exact criterion-3 failure the ADR was chartered to prevent.
The obvious intended rule, that explicit directional keys append after sugar expansion regardless of textual order, is never stated, and the ADR's example only works if the reader assumes it.

Cross-scope merge is fine, since decision 9 expands per-source before composition.
The ambiguity is intra-scope.

Evidence that would settle it: one normative sentence in decision 4 fixing the intra-surface merge order, with the key-order-swapped example resolved.

### F6 — The decision-8 probe does not support "verified, not trusted"

Severity: **should-fix-before-ship**.

Claim attacked: "A `read` grant is checked by attempting a write into it and requiring the failure… It is verified, not trusted… falsifiable cheaply."

- **Vacuous pass.**
  A write into a nonexistent path fails `ENOENT`.
  "Requiring the failure" passes a typo'd grant with no enforcement present at all, unless errno discrimination is specified, and it is not.
- **Indistinguishable errno.**
  `EACCES`/`EPERM` from ordinary DAC is identical to a sandbox denial.
  The probe proves that some layer denied one write at one path at launch, not that the declared scope is sandbox-enforced.
- **Side effect on the dangerous branch.**
  The write succeeds precisely when enforcement is absent, so the check mutates the filesystem exactly in the failure case, and the cleanup unlink is itself a write that can fail and strand the artifact.
- **Single-point probe, subtree claim.**
  Seatbelt regex profiles, bind mounts, and nested read-write mounts make enforcement non-uniform per subtree; a probe at the grant root passes while a writable subdirectory gapes.
- **The half that retires prompts is not the half probed.**
  The write probe verifies the write block; the prompt suppression is for reads, which the kernel permits.
  That half rests entirely on trusting the launcher's declaration.

The honest slogan is "spot-checked and operator-trusted", not "verified, not trusted".

Evidence that would settle it: specify probe locations, the required errno set, `ENOENT` handling, and cleanup; downgrade the claim to what one probe proves.

### F7 — Write provability is narrower than the consequences imply; the `rm -rf` concern is unanswered

Severity: **should-fix-before-ship**.

Under decision 7, `path_write: {"*": "ask"}` deterministically governs only output-redirect destinations plus write-tool calls.
Silently escaping it: `rm`, `mv`, `cp`, `touch`, `mkdir`, `sed -i`, `tee`, `ln`, `chmod`, `dd of=`, `git add`/`commit`/`checkout`/`clean`, package installs, and any interpreter script.

Measured by the reviewer over 656 deduplicated human bash asks: 56 (8.5%) contain a non-redirect write form with no redirect at all, and of write-bearing commands only about 70% are redirect-provable — so roughly a third of real writes escape the only write proof the model has.
This figure comes from the reviewer's script and was not independently re-derived by the dispatcher.

For the operator's specific `rm -rf some/dir`: decision 2 defers `delete`, decision 7 never classifies `rm` as a write, the chain routing is envelope-blocked per F3, and #620 is open.
Only the unbuilt step-3 sandbox would stop it.

Decision 7's "This is what #609 needs and no more" is one honest clause, but the consequences bullet and decision 1's framing say the opposite in the sections people will quote.
The ADR nowhere contains the sentence a user needs: `path_write` does not govern `rm`, `mv`, `sed -i`, or `git commit`.

Evidence that would settle it: an explicit "what `path_write` does not cover" list, and a named owner for delete-shaped capability.

### F8 — Two supporting characterizations are false or vacant

Severity: **worth-recording**.

**(a)** The ADR says the wrapper-floored commands are "pure reads", sampling `xargs grep -l` and `xargs wc -l`.
The floor population also contains `time pnpm test`, `time yarn make`, `timeout 180 pi --model …` which launches an agent, two `nohup` app launches, `xargs sed`, `xargs git`, and eleven bare `env`.
The sample is cherry-picked; the population is not pure reads.
This matters because decision 8 uses the floor as its poster child for sandbox relief.

**(b)** The step-3 seam has no committed consumer.
`getPolicyScope()`'s output is rendered by a launcher that no issue, package, or plan commits to build, and #686's author offered a PR for a different design that the ADR declines.
This package's own vacant-seam warning applies verbatim and is not addressed.

### F9 — Prior-art and composition claims

**(a) OpenCode — false positive, but it exposes a real defect.**
The reviewer checked `https://opencode.ai/docs/permissions` and the published config schema, found an actor-keyed object, and concluded the ADR's citation was unreproducible.

**Dispatcher verification: the reviewer checked the wrong URL.**
The ADR's claims come from `https://opencode.ai/v2/docs/permissions`, re-fetched after the report.
The ordered `{action, resource, effect}` array, the wording "The last matching rule wins", and the action-table row giving `shell` as "The complete raw shell command string" are all verbatim on that page.
The ADR's claims are accurate.

The real defect the finding exposes stands: **the ADR cites no URL**, so a reader lands on the v1 page and concludes the record is wrong — which is exactly what happened here.
Fix by citing the v2 URL explicitly and noting the v1/v2 split.

**(b) Landlock — verified.**
kernel.org states verbatim that one layer grants if at least one rule grants, and that a thread may access a path only if all enforced layers grant.
"Union within a layer, intersection across layers" is accurate.
Minor caveat: Landlock layers are temporal attenuation stacks rather than heterogeneous rule kinds in one policy, so the precedent covers the cross-layer half only, which is how the ADR uses it.

**(c) "This does not amend ADR 0007" — subtly wrong.**
Severity: should-fix.
ADR 0007 §5's envelope is operator-configurable, with secret paths always excluded; the shipped whole-`path` exclusion is #599's deliberately conservative stopgap, which #620 is chartered to relax.
Decision 4's "Every member is excluded, and a capability added to a family later is excluded by default" either freezes that stopgap into the decision layer — contradicting the relaxation decision 7 depends on — or is merely a name-resolution rule stated too strongly.
One clarifying sentence decides which.

**Dispatcher verification: confirmed.**
Issue #620's body states that the checkpoint "excludes the **whole** `path` surface… rather than only secret-shaped paths" and that this issue "is where the allow-capable capability — and therefore both of those refinements — actually earns its place."
Decisions 4 and 7 are in direct conflict as written.

### F10 — Evidence base and hedging

Severity: **worth-recording**.

Every number comes from one operator, one monorepo, four months, under an evolving policy — and what was already allowed never appears in the log, which is survivorship bias.
Much of the traffic is this package dogfooding itself against sibling `pi-*` checkouts, a workload maximally likely to read external sibling repositories.

The ADR hedges the external-share aggregate but contains no sentence acknowledging single-operator evidence, and decision 1 generalizes to "a user" unconditionally.
Decision 1's reframing is a plausible reading of this operator's traffic, but "the fact this record is built on" is stated with more confidence than one user's log can carry.

## Suspected but not confirmed

- **Claude Code quotes** (`autoAllowBashIfSandboxed`, the merging of deny rules into the sandbox boundary) and the claim that **`nono run -- pi` already works today** were not verified by the reviewer.
  The ADR flags Seatbelt as unverified, which is the right discipline and should extend to these.
- **Where the ADR's classifier binned the 89 surface-keyed entries.**
  The August artifact is proven; the exact mis-binning of its `bash rule` and `path` buckets was not reconstructed.

## Judgement

Quoted from the reviewer, unedited:

> **Do not ship as written.**
> The ADR's decisions on spelling, sugar, boundary distinctness, and composition are mostly sound and can stand, but the record fails on the two things an ADR exists for: its evidence and its promises.
> The evidence tables are demonstrably wrong (F1) and produced by an uncommitted instance of the mechanism the same document rejects, without sensitivity analysis (F2); the headline consequence — permit the read majority — is not deliverable by any staged mechanism (F3), because the model's central semantic rule (which surface an unproven-direction access consults) was never decided (F4) and the chain route is blocked by the ADR's own family exclusion (F9c); and the sugar expansion violates the ADR's own no-two-readings criterion (F5).
> Required amendments before ship: rerun and correct all measurements with the surface-keyed schema included and the instrument committed; decide F4's unknown-direction rule and F5's merge-order rule as numbered decisions; rewrite staging step 1's and the consequences' relief claims to the ~25% that step 1 actually delivers, naming what delivers the rest and what does not exist yet; add the `path_write` non-coverage list and an honest sentence on `rm -rf`; downgrade the probe claim (F6); and fix or re-source the OpenCode citation.
> F4 and F5 are re-deliberation, not wording — which is why this is "not ship," not "ship with edits": an ADR that ships with an undecided core rule becomes the thing every later decision cites.

## Appendix: verification scripts

These are the **dispatcher's** scripts, written to verify the reviewer's findings after its report.
The reviewer's own scripts did not survive its session and are not recoverable.
Each reads the local review log at `~/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl`.

Confirms F1 — counts entries by schema and shows the dropped surface-keyed externals.

```javascript
const fs = require("node:fs");
const p = process.env.HOME + "/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl";
const isTest = (e) => JSON.stringify(e).includes("/var/folders/");
let withMessage = 0, withoutMessage = 0;
const noMsgByMonth = new Map(), noMsgSurface = new Map();
let firstNoMsg = null;
for (const line of fs.readFileSync(p, "utf8").split("\n")) {
  if (!line.trim()) continue;
  let e; try { e = JSON.parse(line); } catch { continue; }
  if (e.event !== "permission_request.waiting" || isTest(e)) continue;
  if (typeof e.message === "string" && e.message) { withMessage++; continue; }
  withoutMessage++;
  firstNoMsg ??= e.timestamp;
  const m = (e.timestamp ?? "").slice(0, 7);
  noMsgByMonth.set(m, (noMsgByMonth.get(m) ?? 0) + 1);
  const s = e.surface ?? e?.request?.surface ?? "(no surface field)";
  noMsgSurface.set(s, (noMsgSurface.get(s) ?? 0) + 1);
}
console.log(`with message: ${withMessage}`, `without: ${withoutMessage}`, `earliest: ${firstNoMsg}`);
console.log("by month:", [...noMsgByMonth].sort());
console.log("by surface:", [...noMsgSurface].sort((a, b) => b[1] - a[1]));
```

Confirms F1's corrected share and F2's strict direction split — handles both schemas, and excludes fd-duplication and `/dev/null` discards from redirect detection.

```javascript
const fs = require("node:fs");
const p = process.env.HOME + "/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl";
const isTest = (e) => JSON.stringify(e).includes("/var/folders/");
const READ_TOOLS = new Set(["read", "grep", "ls", "find", "glob", "read_session_file"]);
const WRITE_TOOLS = new Set(["write", "edit"]);
const STRICT_READ = /^(cat|head|tail|less|wc|grep|rg|egrep|fgrep|ls|find|fd|file|stat|diff|cmp|sort|uniq|cut|tr|jq|shasum|dirname|basename|realpath|readlink|column|nl|tree|du|df|which|type|date|pwd|whoami|printenv|echo|printf|awk|xargs|gh|git)$/;
const MUTATOR = /^(rm|mv|cp|touch|mkdir|rmdir|tee|dd|truncate|install|ln|chmod|chown|unlink|shred)$/;
const GIT_WRITE = /\bgit\s+(add|commit|checkout|clean|reset|rm|mv|apply|stash|merge|rebase|push|init|tag|worktree)\b/;
const OTHER_WRITE = /\bsed\s+-i|\b(pnpm|npm|yarn)\s+(i|install|add|remove|up|update)\b|\bdd\s+[^|]*\bof=/;
const INTERPRETER = /^(node|python|python3|ruby|perl|sh|bash|zsh|deno|bun|tsx|ts-node|pi|mmdc|vitest|pnpm|npm|yarn|make|cargo|go|sed)$/;

// A real file-writing redirect: not fd-prefixed (2>), not fd-duplication (>&), not a device discard.
function realOutRedirect(cmd) {
  const re = /(^|[^0-9<>&])>>?\s*([^\s&|;()]+)/g;
  let m;
  while ((m = re.exec(cmd))) {
    if (!/^\/dev\/(null|std(out|err|in))$/.test(m[2])) return true;
  }
  return false;
}
const words = (c) => c.split(/[\s;&|()`]+/).filter(Boolean).map((w) => w.replace(/^.*\//, ""));
function classifyBash(cmd) {
  if (realOutRedirect(cmd)) return "write";
  const w = words(cmd);
  if (w.some((x) => MUTATOR.test(x)) || GIT_WRITE.test(cmd) || OTHER_WRITE.test(cmd)) return "write";
  const mean = w.filter((x) => !/^-/.test(x));
  if (mean.some((x) => INTERPRETER.test(x))) return "unknown";
  if (mean.length && mean.every((x) => STRICT_READ.test(x) || !/^[a-z]/i.test(x))) return "read";
  return "unknown";
}

const months = new Map();
let total = 0;
for (const line of fs.readFileSync(p, "utf8").split("\n")) {
  if (!line.trim()) continue;
  let e; try { e = JSON.parse(line); } catch { continue; }
  if (e.event !== "permission_request.waiting" || isTest(e)) continue;
  total++;
  const mo = (e.timestamp ?? "").slice(0, 7);
  if (!months.has(mo)) months.set(mo, { total: 0, ext: 0, read: 0, write: 0, unknown: 0 });
  const b = months.get(mo);
  b.total++;
  const msg = e.message ?? "";
  const surface = e.surface ?? e?.request?.surface ?? "";
  // The F1 fix: both schemas mark an external ask.
  if (!(/outside working directory/.test(msg) || surface === "external_directory")) continue;
  b.ext++;
  const cmd = e.command ?? e?.request?.command ?? "";
  const d = READ_TOOLS.has(e.toolName) ? "read"
    : WRITE_TOOLS.has(e.toolName) ? "write"
    : cmd ? classifyBash(cmd) : "unknown";
  b[d]++;
}
console.log(`total: ${total}`);
for (const [m, b] of [...months].sort()) console.log(m, JSON.stringify(b));
```

Confirms F3 — splits external asks into actor-directed versus bash, giving what staging step 1 can actually relieve.

```javascript
const fs = require("node:fs");
const p = process.env.HOME + "/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl";
const isTest = (e) => JSON.stringify(e).includes("/var/folders/");
const READ_TOOLS = new Set(["read", "grep", "ls", "find", "glob", "read_session_file"]);
const WRITE_TOOLS = new Set(["write", "edit"]);
let ext = 0, readTool = 0, writeTool = 0, bash = 0, other = 0;
for (const line of fs.readFileSync(p, "utf8").split("\n")) {
  if (!line.trim()) continue;
  let e; try { e = JSON.parse(line); } catch { continue; }
  if (e.event !== "permission_request.waiting" || isTest(e)) continue;
  const msg = e.message ?? "";
  const surface = e.surface ?? e?.request?.surface ?? "";
  if (!(/outside working directory/.test(msg) || surface === "external_directory")) continue;
  ext++;
  const cmd = e.command ?? e?.request?.command ?? "";
  if (READ_TOOLS.has(e.toolName)) readTool++;
  else if (WRITE_TOOLS.has(e.toolName)) writeTool++;
  else if (cmd || e.toolName === "bash") bash++;
  else other++;
}
console.log({ ext, readTool, writeTool, bash, other });
```

## Stage: Amendment resolution (2026-08-23T21:13:49Z)

The amendment landed in `f007994d`; every blocking and should-fix finding has a disposition in the amended record:

- **F1, F2, F10** — evidence rewritten: both schemas included, recency-weighted per-month band tables, single-operator hedge, instrument committed below.
  The dispatcher's "strict" classifier in F2 was itself over-strict — it required file-argument basenames to match the read table, so `cat /etc/hosts` binned unknown; the command-position classifier below supersedes it.
- **F3** — relief accounting rewritten cause-jointly: staged mechanisms + read grants relieve a measured 51% of current-month prompts, per band, with the first-firing-cause caveat stated.
- **F4** — decided as the evaluation model's per-token base case: unproven effect consults both directional surfaces (amended §10).
- **F5** — decided as decision 4's normative merge order: sugar first, explicit directional keys append and win on identical patterns.
- **F6** — probe claim downgraded to "spot-checked and operator-trusted"; errno discipline named as implementation contract.
- **F7** — `path_write` non-coverage list and the `rm -rf` sentence added; `delete` has a reserved seat.
- **F8a** — the floor population's mixed character is now measured (40–55% pure-reader inner) and addressed by wrapper transparency (§11, #803) rather than sampled prose.
- **F8b** — the seam has a committed consumer: #802.
- **F9a** — OpenCode cited by v2 URL with the v1/v2 split noted.
- **F9c** — the family exclusion is stated as a name-resolution rule; #620's charter is intact.

The deliberation also moved beyond the findings: effects became sets with scalar sugar, the read mechanism became an audited argument-independent core plus user `commandEffects` declarations in structured (pattern-free) command description, the evaluation model (recursive verdict fold, blame propagation) became decision 10, and the bash surface's migration to structured rules was chartered as #804.

### Amendment appendix: band and joint-relief classifiers

The amended ADR's band tables and cause-joint relief figures come from these two scripts (same log path and test-fixture exclusion as the scripts above).
Both are prototypes approximating the parser-based implementation: segment splitting is regex-based, so band boundaries carry a few points of noise.

Per-month band decomposition (bands A/B/C/D; command-position classification with wrapper skip):

```javascript
const fs = require("node:fs");
const p = process.env.HOME + "/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl";
const isTest = (e) => JSON.stringify(e).includes("/var/folders/");
const READ_TOOLS = new Set(["read", "grep", "ls", "find", "glob", "read_session_file"]);
const WRITE_TOOLS = new Set(["write", "edit"]);
const PURE_READ = new Set(["cat","head","tail","less","more","wc","grep","rg","egrep","fgrep","ls","find","fd","file","stat","diff","cmp","sort","uniq","cut","tr","jq","yq","shasum","md5","sha256sum","dirname","basename","realpath","readlink","column","nl","tree","du","df","which","type","date","pwd","whoami","printenv","env","echo","printf","awk","test","[","true","false","cd","pushd","popd","hexdump","xxd","strings","od"]);
const WRAPPERS = new Set(["time","nohup","command","builtin","exec","sudo"]);
const MUTATOR = new Set(["rm","mv","cp","touch","mkdir","rmdir","tee","dd","truncate","install","ln","chmod","chown","unlink","shred","sed","perl","patch"]);
const GIT_READ = new Set(["log","diff","show","status","branch","blame","rev-parse","remote","describe","shortlog","ls-files","ls-tree","cat-file","config","grep","reflog","tag","interpret-trailers","cherry"]);
function segments(cmd) { return cmd.split(/(?:\|\||&&|;|\||\n)/).map((s) => s.trim()).filter(Boolean); }
function headOf(seg) {
  let toks = seg.split(/\s+/).filter(Boolean);
  while (toks.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[0]) || WRAPPERS.has(toks[0].replace(/^.*\//, "")))) toks.shift();
  if (toks.length && toks[0].replace(/^.*\//, "") === "timeout") { toks.shift(); if (toks.length && /^[0-9]/.test(toks[0])) toks.shift(); }
  if (toks.length && toks[0].replace(/^.*\//, "") === "xargs") { toks.shift(); while (toks.length && /^-/.test(toks[0])) toks.shift(); }
  return toks.length ? { head: toks[0].replace(/^.*\//, ""), rest: toks.slice(1) } : null;
}
function realOutRedirect(cmd) {
  const re = /(^|[^0-9<>&])>>?\s*([^\s&|;()]+)/g;
  let m;
  while ((m = re.exec(cmd))) { if (!/^\/dev\/(null|std(out|err|in))$/.test(m[2])) return true; }
  return false;
}
function classify(cmd) {
  if (realOutRedirect(cmd)) return "write";
  let unk = false;
  for (const seg of segments(cmd)) {
    const h = headOf(seg);
    if (!h) continue;
    if (MUTATOR.has(h.head)) return "write";
    if (h.head === "git") {
      const sub = h.rest.find((t) => !/^-/.test(t));
      if (sub && GIT_READ.has(sub)) continue;
      return "write";
    }
    if (PURE_READ.has(h.head)) {
      if (h.head === "find" && h.rest.some((t) => /^-(exec|execdir|delete|ok|okdir)$/.test(t))) return "write";
      continue;
    }
    unk = true;
  }
  return unk ? "unknown" : "read";
}
const months = new Map();
for (const line of fs.readFileSync(p, "utf8").split("\n")) {
  if (!line.trim()) continue;
  let e; try { e = JSON.parse(line); } catch { continue; }
  if (e.event !== "permission_request.waiting" || isTest(e)) continue;
  const mo = (e.timestamp ?? "").slice(0, 7);
  if (!months.has(mo)) months.set(mo, { all: 0, nonExt: 0, A: 0, B: 0, C: 0, D: 0 });
  const b = months.get(mo);
  b.all++;
  const msg = e.message ?? "";
  const surface = e.surface ?? e?.request?.surface ?? "";
  if (!(/outside working directory/.test(msg) || surface === "external_directory")) { b.nonExt++; continue; }
  const cmd = e.command ?? e?.request?.command ?? "";
  if (READ_TOOLS.has(e.toolName)) { b.A++; continue; }
  if (WRITE_TOOLS.has(e.toolName)) { b.D++; continue; }
  if (!cmd && e.toolName !== "bash") { b.C++; continue; }
  const d = classify(cmd);
  if (d === "read") b.B++;
  else if (d === "write") b.D++;
  else b.C++;
}
for (const [m, b] of [...months].sort()) console.log(m, JSON.stringify(b));
```

Cause-joint relief for the recent months (an ask counts as relieved only when every detected cause is addressed; assumes read grants cover the asked roots):

```javascript
// Reuses classify()/segments()/headOf()/realOutRedirect() and the sets above.
const months2 = new Map();
for (const line of fs.readFileSync(p, "utf8").split("\n")) {
  if (!line.trim()) continue;
  let e; try { e = JSON.parse(line); } catch { continue; }
  if (e.event !== "permission_request.waiting" || isTest(e)) continue;
  const mo = (e.timestamp ?? "").slice(0, 7);
  if (mo < "2026-07") continue;
  if (!months2.has(mo)) months2.set(mo, { all: 0, viaGrant: 0, viaFloor: 0, residual: 0 });
  const b = months2.get(mo);
  b.all++;
  const blob = JSON.stringify(e);
  const msg = e.message ?? "";
  const surface = e.surface ?? e?.request?.surface ?? "";
  const isExt = /outside working directory/.test(msg) || surface === "external_directory";
  const isFloored = blob.includes("bash-wrapper");
  const cmd = e.command ?? e?.request?.command ?? "";
  const provRead = READ_TOOLS.has(e.toolName) || (!WRITE_TOOLS.has(e.toolName) && (cmd || e.toolName === "bash") && classify(cmd) === "read");
  if (!isExt && !isFloored) { b.residual++; continue; }
  if (provRead) { if (isExt) b.viaGrant++; else b.viaFloor++; }
  else b.residual++;
}
for (const [m, b] of [...months2].sort()) console.log(m, JSON.stringify(b), `relieved=${b.viaGrant + b.viaFloor}/${b.all}`);
```

Wrapper-floor share and inner-head census (the §11 warrant) comes from filtering waiting entries for the `bash-wrapper` sentinel substrings and extracting the executed inner head past wrapper words — the same `headOf` walk with `find -exec` resolved to the word after the `-exec` flag.
