---
name: fallow
description: |
  Load before running `fallow` or reading its output: dead code, duplication, complexity,
  architecture boundaries, coverage, symbol impact, and health trends.
---

# Fallow

Fallow is a static analysis tool for TypeScript/JavaScript installed as a root devDependency.
It finds unused code, duplication, complexity hotspots, architecture-boundary violations, and refactoring targets, and it answers targeted questions about one file or one symbol.
Run it via `pnpm fallow` scripts or `pnpm fallow <subcommand>` from the repo root, never `npx`.
An `invalid boundary configuration` error with `autoDiscover path … did not resolve` means the command ran from a package directory, not that the config is broken.

## Quick reference

```bash
pnpm fallow                # full analysis: dead code + dupes + health
pnpm fallow:audit          # changed-file audit (PR gate)
pnpm fallow:health         # complexity, hotspots, refactoring targets
pnpm fallow:dead-code      # unused code, dependencies, cycles, boundary violations
pnpm fallow:dupes          # duplicated code blocks
```

Question-shaped subcommands, each scoped smaller than a full run:

| Question                                          | Command                                                     |
| ------------------------------------------------- | ----------------------------------------------------------- |
| What may this file import?                        | `fallow guard <file>`                                       |
| What are this file's exports, imports, importers? | `fallow inspect --file <path>`                              |
| Who consumes this symbol?                         | `fallow dead-code --trace <file>:<symbol>`                  |
| What structural decisions does this change embed? | `fallow decision-surface --base <ref> --format json`        |
| Where should a reviewer look in this change?      | `fallow review --brief --base <ref>`                        |
| What moved since the last phase close?            | `fallow health --trend --workspace @gotgenes/<PKG>`         |
| What is untested but reachable?                   | `fallow health --coverage-gaps --workspace @gotgenes/<PKG>` |
| What zones and rules exist?                       | `fallow list --boundaries`                                  |
| Which suppressions are active?                    | `fallow suppressions`                                       |
| What does this finding mean?                      | `fallow explain <issue-type>`                               |

## JSON output for programmatic use

Always invoke via `pnpm --silent fallow … --format json --quiet 2>/dev/null` and append `|| true`.
The `--silent` is load-bearing: fallow exits 1 when issues are found (normal), and without `--silent` pnpm appends `[ELIFECYCLE] Command failed with exit code 1.` to **stdout** after the JSON — `json.load` then fails with "Extra data", and `2>/dev/null` does not strip it.
Only exit code 2 is a real error.

```bash
pnpm --silent fallow dead-code --format json --quiet 2>/dev/null || true
pnpm --silent fallow health --score --targets --format json --quiet 2>/dev/null || true
```

Some subcommands print nothing in human format under `--quiet` (`decision-surface` is one) — read those as JSON.

## Useful flags

| Flag                   | Purpose                                         |
| ---------------------- | ----------------------------------------------- |
| `--unused-exports`     | Filter to only unused exports                   |
| `--unused-files`       | Filter to only unused files                     |
| `--changed-since main` | Only files changed since a ref (alias `--base`) |
| `--workspace <name>`   | Scope to one package                            |
| `--group-by package`   | Group findings by workspace package             |
| `--score`              | Show health score (0-100)                       |
| `--hotspots`           | Riskiest files by churn × complexity            |
| `--targets`            | Ranked refactoring recommendations              |
| `--mode semantic`      | Duplication: catch renamed-variable clones      |

## Architecture boundaries

`.fallowrc.json`'s `boundaries` declares **zones** (named file sets) and **rules** (`{from, allow, allowTypeOnly}`). pi-subagents and pi-permission-system each have one zone per `src/` directory (via `autoDiscover`) plus a `<pkg>/core` zone for root modules; the other packages have no documented layering and no zones.
A zone with no rule is unrestricted, so rules — not zones — are what make a new edge visible.

Each zone's `allow` list is the set of zones it imported when the zones were encoded, so the baseline is zero violations and every **new** cross-zone edge is reported.
Severity is `warn`: `fallow dead-code` and `fallow audit` print the violation and still exit 0, so the `main` gate is unaffected.

- Before adding a cross-directory import, run `pnpm --silent fallow guard <file>` — it prints the file's zone, the zones it may import, and the type-only exceptions.
- When the new edge is intended, extend that zone's `allow` list in the same commit and say why in the commit body.
  That commit is the answer to the `coupling-boundary` question `fallow decision-surface` will ask in review.
- `allowTypeOnly` reads the `import type` **syntax**, not the imported symbol's kind: a plain `import { SomeType }` on a type-only edge is reported.

## The type-aware companion

`fallow-type-aware` (a TypeScript semantic backend) is installed; check it with `fallow type-aware status`.
It is **opt-in per invocation** via `--type-aware`, and it costs time: `dead-code --type-aware` measured 16 s against 2 s syntactic on this repo.
Without the flag, fallow's analysis is structural — it reads the module graph and the syntax, not the type checker.

- `--type-coupling` (on `health`) reports project-local public-signature type coupling, an ISP/DIP lead: a file that "depends on 5, used by 1" is a dependency-bag candidate.
  It reports `no-coupling-found (Unavailable)` unless you also pass `--type-aware-project packages/<PKG>/tsconfig.json`.
- `--symbol-impact` (on `dead-code`) computes exact-symbol consumers, affected files, and targeted tests.

### Proving "nothing else calls this"

Run **both** and trust the union:

```bash
pnpm --silent fallow dead-code --trace <file>:<symbol> --quiet
pnpm --silent fallow dead-code --type-aware --symbol-impact <file>:<symbol> --quiet
```

`--symbol-impact` has a measured false negative on 3.22.0: for `session/prompts.ts:buildAgentPrompt` it reported `consumers-found (complete, confidence: high)` listing only the test, missing `src/index.ts`, which imports the symbol and passes it as an **object-literal shorthand property**.
Syntactic `--trace` lists both.
Upstream has no fix through 3.28.0, so a high-confidence `--symbol-impact` result is not on its own a licence to delete.

## Health snapshots and trends

Each roadmap package commits `packages/<PKG>/docs/fallow-snapshot.json` — eleven vital signs plus score and grade as of the last phase close, written by:

```bash
pnpm --silent fallow health --save-snapshot packages/<PKG>/docs/fallow-snapshot.json --workspace @gotgenes/<PKG> --quiet >/dev/null
```

Never hand-edit it; every field is a number the command produces.
`--save-snapshot` forces file-score, hotspot, and score computation, so its score is the hotspot-inclusive one the architecture docs carry.

Reading a trend needs a copy, because `--trend` reads only `.fallow/snapshots/` (gitignored, no config override) and picks the most recent file there — and a snapshot does **not** record its workspace, so a sibling package's snapshot would be compared silently:

```bash
rm -rf .fallow/snapshots && mkdir -p .fallow/snapshots
cp packages/<PKG>/docs/fallow-snapshot.json .fallow/snapshots/baseline.json
pnpm --silent fallow health --trend --workspace @gotgenes/<PKG> --quiet 2>&1 | grep -A 12 'Trend'
```

## Coverage

CRAP scores are **estimated** from export references unless you feed real coverage.
The estimate is not conservative in one direction: on pi-subagents it put `tools/agent-tool.ts` at 13.8 where real coverage says 42.0, and flagged 12 files above the threshold where real coverage flags 5.

```bash
pnpm --filter @gotgenes/<PKG> exec vitest run --coverage --coverage.provider istanbul \
  --coverage.reporter json --coverage.reportsDirectory /tmp/cov-<PKG>
pnpm --silent fallow health --coverage /tmp/cov-<PKG>/coverage-final.json \
  --score --hotspots --targets --workspace @gotgenes/<PKG> 2>&1 || true
```

Istanbul format is required (not v8/c8 native); `@vitest/coverage-istanbul` is a root devDependency, so no package manifest needs one.
For pi-autoformat add `--project unit` — its acceptance project spawns the real `pi` CLI.

`health --coverage-gaps` is a separate, static question: which runtime files and exports no test dependency path reaches.
Read it as a reachability lead, not a coverage number, and discount barrels — an export re-exported from `index.ts` whose tests import the source module directly reads as untested.

## Change review

```bash
pnpm --silent fallow decision-surface --base <ref> --format json --quiet 2>/dev/null || true
pnpm --silent fallow review --brief --base <ref> --quiet
```

`decision-surface` returns at most five `signal_id`-anchored questions in three categories (`public-api-contract`, `coupling-boundary`, `dependency`); it always exits 0 and gates nothing.
`review --brief` renders the same analysis as an orientation brief ("where do I look?") rather than a verdict.
The `pre-completion-reviewer` runs the first of these over the range it reviews; a judgment it reports must cite a `signal_id` fallow emitted.

## Configuration

Config lives at `.fallowrc.json` in the repo root.
Entry points for `pi.extensions` are declared manually since fallow does not know that convention.
Rules use `"error"` (fail CI), `"warn"` (report only), or `"off"` (skip).
Some rules default to `off` and are inert even at `warn` on 3.22.0 — `coverage-gaps` is one, so use the `--coverage-gaps` flag rather than the rule.

## Suppressing findings

```typescript
// fallow-ignore-next-line unused-export
export const keepThis = 1;

// fallow-ignore-next-line unused-type
export type KeepThisType = string;

// fallow-ignore-file
```

The kind token must be the exact singular issue kind (`unused-class-member`, not `unused-class-members`) and the only text after the directive — fallow parses every space-separated token as a kind, so trailing prose (`-- because …`) produces "stale suppression" noise.
Put rationale on the line above the directive.

Use `/** @public */` or `/** @expected-unused */` JSDoc tags for library API exports.

## Auto-fix cycle

Always dry-run first:

```bash
pnpm fallow fix --dry-run    # preview
pnpm fallow fix --yes        # apply (--yes required in non-TTY)
pnpm fallow dead-code        # verify
```

## Key gotchas

1. The default run resolves the module graph syntactically, so a fully dynamic `import(variable)` is not resolved; `--type-aware` does not change that.
2. Re-export chains through barrel files are resolved correctly.
3. `--changed-since` is additive — only new issues in changed files.
4. Never run `fallow watch` — it is interactive and never exits.
5. The human-readable `health --targets` output omits the "Refactoring targets" section entirely when there are zero targets — to confirm a file dropped off the list, use `--format json` and check the `targets` array is empty rather than grepping the text output.
6. Class-member liveness is keyed off `implements` clauses: a member reached only through a structural type the class does not explicitly `implements` reads as dead once the last `implements` is removed.
   `--type-aware` resolves part of this: with all five of this repo's `unused-class-member` suppressions removed, it cleared three (one confirmed use, two preserved contracts) and abstained on the two reached through a field typed by a structural interface (`SubagentManagerLike`).
   So prefer re-declaring the genuine contract (`implements ThatInterface`), and keep a suppression for the structural-field case.
   If the consumer is wired via an object-literal property (which fallow cannot trace), prefer moving the read into a traced closure body at the composition root (e.g. `getX: () => owner.member`) over a suppression; suppress only when neither is practical.
   A test helper that returns the instance inside an object literal (`return { provider, live }`) hides its call sites the same way — return the instance directly and pass collaborators in as parameters.
7. `similar-code` (semantic overlap `dupes` cannot see) requires an explicit local model download via `fallow similar-code setup`.
   It is opt-in and nothing in this repo's workflow runs it.
