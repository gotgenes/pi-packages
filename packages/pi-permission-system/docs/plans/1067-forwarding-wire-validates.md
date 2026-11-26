---
issue: 1067
issue_title: "pi-permission-system: path traversal and arbitrary JSON file write via unvalidated forwarded request.id"
---

# The forwarding wire validates what it reads

## Release Recommendation

**Release:** ship independently

The roadmap step (Phase 16, "The forwarding wire validates what it reads (with [#1068], [#1069])") is tagged `Release: independent`, and the `Release batches` subsection lists it among the independently releasable steps as a `fix:`.

## Problem Statement

The forwarding tree under `~/.pi/agent/sessions/permission-forwarding/` is a trust boundary, and its reader trusts what it reads.
Three third-party reports from the same author describe one weakness, and the maintainer's 2026-10-18 comment on this issue commits to fixing them together:

- This issue: a serving session writes its response to `` join(responsesDir, `${request.id}.json`) ``, and `readForwardedPermissionRequest` checks `id` only as a string.
  A planted request with `"id": "../../escape-test"` makes the parent write its decision two levels above `responses/` (traced, not run).
  The file's content is the parent's own decision, not attacker-chosen; the path is what escapes.
  A second shape, traced: an id longer than about 250 characters makes the response write fail with `ENAMETOOLONG`, the request file stays in place, and the human is re-prompted on every poll.
- [#1068]: `encodeSessionIdForPath` is a bare `encodeURIComponent`.
  The report says `../../escaped` survives it; measured, it does not (`..%2F..%2Fescaped`).
  The two inputs that do survive are exactly `.` and `..`: `createPermissionForwardingLocation(root, "..").sessionRootDir` resolves to the forwarding root itself instead of a directory under `sessions/`.
  Pi itself never mints such an id (Pi 1.0.0's `assertValidSessionId` requires an alphanumeric first and last character), so the reachable trigger is a parent-session env var such as `PI_SUBAGENT_PARENT_SESSION=..`.
- [#1069]: `PermissionGateHandler.handleToolCall` reads `toolCallId` through a double `as Record<string, unknown>` cast, and the request reader hand-rolls `typeof` checks over a subset of fields instead of a schema.

## Goals

- A forwarded request whose `id` is not filename-safe is dropped, deleted, and logged; it never reaches the serving node's policy, prompt, or response write.
- The serving node names its response after the request file it drained, so no wire value chooses a filesystem path.
- `encodeSessionIdForPath` yields a path segment that cannot be `.` or `..` for any input, so a session's forwarding tree always resolves under `sessions/` and its heartbeat under `serving/`.
- The request reader is one Zod schema with today's tolerance preserved field for field (ADR 0008 §4).
- The `toolCallId` read uses a type-guarded helper instead of a cast.
- Not breaking: every id and session id any producer has ever minted is unaffected.

## Non-Goals

- Who may write into the forwarding tree, and a forged *response* approving a pending ask: ADR 0016 §9 traces it, and [#1121] owns it.
  The response reader (`readForwardedPermissionResponse`) keeps its hand-rolled checks apart from reusing the grant schema in `asNarrowedGrants`.
- The forwarding directory's location under a relocated session store: [#1115], with third-party PR [#1107] open against `extension-paths.ts` and `index.ts`, files this plan does not touch.
- Inferring the wire types from the schema (as `config-schema.ts` does for config, ADR 0004).
  The hand-written `ForwardedPermissionRequest` family in `permission-forwarding.ts` keeps its doc comments; the schema is type-checked against it instead.
- Migrating the existing temp-file reader tests to pure schema tests.
  They stay as the characterization net; only the new behavior gets pure schema tests.
- `asPromptPayload` (`src/presentation/prompt-payload.ts`): the schema delegates `payload` to it unchanged.
- A repository security-disclosure policy, which the reporter asked about in a comment; it is not part of this fix.

## Background

- `src/authority/forwarding-io.ts` (688 lines) holds the forwarding filesystem helpers and both wire readers.
  Lines ~39–275 are the request reader's hand-rolled guards: `asUiPromptSource`, `asNullableDisplayString`, `asApprovalGrant` (shared with the response reader's `asNarrowedGrants`), `asForwardedSessionApproval`, `asForwardedAccessIntent`, `isWellFormedAskingUnits`, `isWellFormedAskingUnit`, `isNonEmptyStringList`, `copyAskingUnits`.
  The roadmap's Smell names the asking-unit field list written three times (the `AskingBashUnit` type, the guard, the copier).
- `src/authority/forwarded-request-server.ts`: `processInbox` lists `requests/*.json`, reads each with `readForwardedPermissionRequest`, deletes an unreadable one, and otherwise calls `processSingleForwardedRequest`, which ends in `recordForwardedDecision` (`` responsePath = join(location.responsesDir, `${request.id}.json`) ``).
  `requestPath` is already in scope there.
- `src/authority/approval-escalator.ts`: `ParentAuthorizer` writes `` join(requestsDir, `${request.id}.json`) `` and polls `` join(responsesDir, `${request.id}.json`) ``.
  At a relay hop it adopts an inbound id only when `FILENAME_SAFE_REQUEST_ID` (`/^[A-Za-z0-9._-]+$/`, module-private) accepts it, minting a fresh one otherwise (added by `3f8d3fd6`, Refs [#752]).
- `src/permission-request-id.ts` (root leaf) mints `perm-<uuid>` (41 characters).
  Before [#752] the escalator minted `<Date.now()>-<base36 ×8>-<pid>`, about 30 characters.
  Both fit `[A-Za-z0-9_-]`; every request-id fixture in `test/` does too except the escalator's deliberate `"../../escape"`.
- `src/authority/permission-forwarding.ts`: `encodeSessionIdForPath` has two callers, `createPermissionForwardingLocation` and `forwarding-liveness.ts`'s `servingHeartbeatPath`.
  `HeartbeatReader.servingIds()` reads the session id from each record's contents, not by decoding its filename, so a changed encoding does not affect it.
- `src/handlers/permission-gate-handler.ts`: `getEventInput(event: unknown)` already reads the event through `toRecord`; `toolCallId` is the one field read through a cast.
- Zod `^4.6.7` is already a dependency (`config/`).
  `fallow guard` on `forwarding-io.ts`: the `authority` zone may import `core` (the root leaves), `presentation`, `service`, and `session`, so the new module's imports are all allowed.
- Package skill: run package-scoped commands from the repo root; `#src/` for cross-directory imports, `./` within one.

## Design Overview

### Measured Zod 4 behavior (probe run from the package, `zod@4.6.7`)

| Input to the probe schema                                     | Output                              |
| ------------------------------------------------------------- | ----------------------------------- |
| Unknown keys on the intent and on a unit                      | stripped                            |
| `accessIntent.floor: 3` (no `.catch` on `floor`)              | whole `accessIntent` dropped        |
| `accessIntent.delegationLicense: "yes"` (`.catch(undefined)`) | only the license dropped            |
| `askingUnits: []` with `.min(1)`                              | whole `accessIntent` dropped        |
| `source: 7` with `.optional().catch(undefined)`               | `source` dropped                    |
| `id: "../../x"` with a pattern                                | request rejected                    |
| JSON `null`                                                   | request rejected                    |
| Malformed optional key, caught                                | key **present** with `undefined`    |
| Absent optional key                                           | key absent                          |

The last two rows matter: `forwarding-io.test.ts` asserts `accessIntent` with `toStrictEqual` (the "drops %s but keeps the intent" cases), which fails on a present-but-`undefined` key.

### 1. One filename-safety rule for a request id

`src/permission-request-id.ts` gains the predicate beside the mint, so "every minted id is forwardable" is a test about one module:

```typescript
const FILENAME_SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Whether `id` can name a forwarding request or response file as-is. */
export function isFilenameSafeRequestId(id: string): boolean {
  return FILENAME_SAFE_REQUEST_ID.test(id);
}
```

It is narrower than the relay hop's current rule in two ways: it drops `.` (no producer mints one, and without it no id can be a dot segment), and it bounds the length so `<id>.json` plus the atomic write's `.<pid>.<ts>.tmp` suffix stays far below a 255-byte name limit.
`forwardableRequestId` in `approval-escalator.ts` calls it, and its local regex is deleted.

### 2. The request reader is a schema

New pure module `src/authority/forwarded-request-schema.ts` exports `forwardedPermissionRequestSchema` and `approvalGrantSchema`, following `config-schema.ts`'s precedent of exporting schemas the I/O module `safeParse`s.

```typescript
export const approvalGrantSchema = z.object({
  surface: z.string().min(1),
  pattern: z.string(),
});

const askingUnitSchema = z.object({
  command: z.string(),
  spellings: z.array(z.string()).min(1).optional(),
  matchedPattern: z.string().optional(),
  floor: z.string().optional(),
});

const forwardedAccessIntentSchema = z
  .object({
    surface: z.string(),
    matchValues: z.array(z.string()),
    boundaryValue: z.string().nullable(),
    floor: z.string().optional(), // malformed → whole intent fails
    askingUnits: z.array(askingUnitSchema).min(1).optional(),
    delegationLicense: z.literal("nothing-on-disk").optional().catch(undefined),
    requesterCwd: z.string(),
    principal: z.object({ sessionId: z.string(), agentName: z.string() }),
  })
  .transform(withoutUndefinedKeys);

export const forwardedPermissionRequestSchema = z
  .object({
    id: z.string().refine(isFilenameSafeRequestId, "not a filename-safe request id"), // step 6
    createdAt: z.number(),
    requesterSessionId: z.string(),
    targetSessionId: z.string(),
    requesterAgentName: z.string(),
    payload: z.unknown().transform(asPromptPayload),
    source: z.enum(UI_PROMPT_SOURCES).optional().catch(undefined),
    surface: z.string().nullable().optional().catch(undefined),
    value: z.string().nullable().optional().catch(undefined),
    sessionApproval: z.object({ grants: z.array(approvalGrantSchema).min(1) }).optional().catch(undefined),
    accessIntent: forwardedAccessIntentSchema.optional().catch(undefined),
  })
  .transform(withoutUndefinedKeys);
```

The sketch is the shape, not the final text: the implementing session settles the typing (the exported schema is checked against `ForwardedPermissionRequest`, e.g. `satisfies z.ZodType<ForwardedPermissionRequest>` or an explicit output annotation, so `tsc` pins conformity to the hand-written wire type).
`withoutUndefinedKeys` is a private helper in the module that drops `undefined`-valued keys, so the parsed request never carries one whether a field was absent or malformed; applying it at both levels states the key-absence invariant once instead of per field.
`UI_PROMPT_SOURCES` moves into this module with `asUiPromptSource`'s other duties.

Tolerance mapping against today's reader (each row is pinned by a test named in the TDD Order):

| Field                                                                            | Today                       | Schema                         |
| -------------------------------------------------------------------------------- | --------------------------- | ------------------------------ |
| `id`, `createdAt`, `requesterSessionId`, `targetSessionId`, `requesterAgentName` | reject request              | reject request                 |
| `payload`                                                                        | `asPromptPayload`           | `asPromptPayload`              |
| `source` / `surface` / `value`                                                   | malformed → `undefined`     | `.catch(undefined)`            |
| `sessionApproval`                                                                | malformed or empty → absent | `.min(1)`, `.catch(undefined)` |
| `accessIntent`                                                                   | malformed → absent          | `.catch(undefined)`            |
| `accessIntent.floor` / `.askingUnits`                                            | malformed → intent absent   | no inner catch                 |
| `accessIntent.delegationLicense`                                                 | unrecognized → only itself  | inner `.catch(undefined)`      |
| unknown keys at every level                                                      | not copied                  | stripped                       |

`readForwardedPermissionRequest` keeps the I/O half: `readFileSync`, `JSON.parse`, `safeParse`, and on failure the existing "Ignoring invalid forwarded permission request format" warning with `z.prettifyError(result.error)` as its error detail, so the log names the failing field (an unsafe id logs `id`).
The response reader's `asNarrowedGrants` parses each entry with `approvalGrantSchema`, keeping its "malformed list reads as empty" rule; `asApprovalGrant` is deleted.

### 3. The response answers the file it drained

`recordForwardedDecision` derives `responsePath = join(location.responsesDir, basename(requestPath))`.
`requestPath` comes from `readdirSync`, a single path segment ending in `.json`, so the response is contained by construction and no extra assertion is needed.
For every legitimate requester the name is unchanged: `ParentAuthorizer` writes `` join(requestsDir, `${request.id}.json`) `` (`approval-escalator.ts`), so the request's file stem and its id are equal and the child still finds its response at `${id}.json`.
A planted file whose name and id disagree is answered under its file name, where no waiting child looks.

### 4. A dot-only session id is escaped

```typescript
export function encodeSessionIdForPath(sessionId: string): string {
  const encoded = encodeURIComponent(sessionId);
  return /^\.+$/.test(encoded) ? encoded.replaceAll(".", "%2E") : encoded;
}
```

Injective: `encodeURIComponent` never emits `%2E` and encodes a literal `%` as `%25`, so `%2E…` can only come from dots.
Only all-dot ids change, and Pi never mints one, so a parent and child on different versions still agree on every real session's directory.
The class is all-dot rather than exactly `.`/`..` because no all-dot string is a Pi session id, so escaping the whole class costs nothing and needs no per-platform argument about how a run of dots resolves.
With `PI_SUBAGENT_PARENT_SESSION=..` the child now files under `sessions/%2E%2E/`; no session serves that, so it abandons after the serving grace window as today, with its files under `sessions/`.

### 5. `toolCallId` through a guard

```typescript
export function getEventToolCallId(event: unknown): string {
  const toolCallId = toRecord(event).toolCallId;
  return typeof toolCallId === "string" ? toolCallId : "";
}
```

It sits beside `getEventInput`, and `handleToolCall` calls it; behavior is unchanged.

### Edge cases and where each is tested

- A traversal id (`../escape-test`), a separator (`a/b`, `a\b`), a dot segment (`.`, `..`), a dotted id (`req.1`), the empty string, and a 129-character id are rejected: step 2 (predicate) and step 6 (reader and server).
- A minted `perm-<uuid>`, a pre-[#752] `<ts>-<base36>-<pid>`, and a 128-character id are accepted: step 2.
- A request whose file name and id disagree is answered under its file name: step 7.
- `.`, `..`, `...` encode to all-`%2E`; `a.b` and a UUID are unchanged; `../../escaped` stays `..%2F..%2Fescaped`: step 8.

## Module-Level Changes

- `src/permission-request-id.ts`: add `isFilenameSafeRequestId`.
- `test/permission-request-id.test.ts`: new `describe("isFilenameSafeRequestId")`.
- `src/authority/approval-escalator.ts`: `forwardableRequestId` uses `isFilenameSafeRequestId`; delete `FILENAME_SAFE_REQUEST_ID`.
- `src/authority/forwarded-request-schema.ts` (new): `approvalGrantSchema`, `forwardedPermissionRequestSchema`, private `askingUnitSchema`, `forwardedAccessIntentSchema`, `withoutUndefinedKeys`, `UI_PROMPT_SOURCES`.
- `test/authority/forwarded-request-schema.test.ts` (new): the id rule as pure value tests.
- `src/authority/forwarding-io.ts`: `readForwardedPermissionRequest` parses with the schema; `asNarrowedGrants` uses `approvalGrantSchema`; delete `UI_PROMPT_SOURCES`, `asUiPromptSource`, `asNullableDisplayString`, `asApprovalGrant`, `asForwardedSessionApproval`, `asForwardedAccessIntent`, `isWellFormedAskingUnits`, `isWellFormedAskingUnit`, `isNonEmptyStringList`, `copyAskingUnits`, and the now-unused imports (`asPromptPayload`, `PermissionUiPromptSource`, `AskingBashUnit`, `ForwardedAccessIntent`, `ForwardedSessionApproval`).
  All are module-private (none exported), so no other `src/` or `test/` file imports them.
- `test/authority/forwarding-io.test.ts`: merge the three request-reader describes under one `writeAndRead(raw, logger)` helper (step 3), add characterization pins (step 4), add the unsafe-id warning test (step 6).
- `src/authority/forwarded-request-server.ts`: `recordForwardedDecision`'s `responsePath` from `basename(requestPath)`.
- `test/authority/forwarded-request-server.test.ts`: planted-traversal test (step 6), name-mismatch test (step 7); `readResponse`'s `requestId` parameter renamed to `fileStem` (step 7).
- `src/authority/permission-forwarding.ts`: `encodeSessionIdForPath` escapes an all-dot id; its doc comment says why.
- `test/authority/permission-forwarding.test.ts`: new `describe("encodeSessionIdForPath")` and a location test.
- `test/authority/forwarding-liveness.test.ts`: a heartbeat-path test for `..`.
- `src/handlers/permission-gate-handler.ts`: add `getEventToolCallId`; `handleToolCall` calls it.
- `test/handlers/tool-call.test.ts`: new `describe("getEventToolCallId")`.
- `docs/architecture/architecture.md`:
  - Module tree: `permission-request-id.ts` (line ~926) names the predicate; `permission-forwarding.ts` (~1063) says the encoder escapes an all-dot id; `approval-escalator.ts` (~1064) says the relay hop shares the reader's id rule; `forwarded-request-server.ts` (~1065) says the response is named after the drained request file; `forwarding-io.ts` (~1066) says the request reader parses with `forwarded-request-schema.ts`, and its allowlist Constraint names the schema as the list; add a `forwarded-request-schema.ts` entry.
  - Roadmap: `✅` on the `#### [#1067] …` heading and on Mermaid node `S1067`, plus a `Landed:` note under the step.

Predicted unchanged, and the claim each rests on:

- `src/authority/forwarding-liveness.ts`: it calls `encodeSessionIdForPath` and inherits the fix; `servingIds()` reads ids from record contents.
- `test/helpers/forwarding-fixtures.ts`: `writeRequest` writes `${id}.json`, so file stem and id agree and step 7 changes no existing server test's response location (the assessor found no server test that writes a mismatched name).
- `test/composition-root.test.ts`: its forwarding round trips read the request's `id` and answer at `${id}.json`, equal to the file stem; its two `toStrictEqual` checks on `askingUnits` see no undefined-valued key.
- `docs/decisions/0006-forwarded-grant-scope-selection.md` line 75: a historical statement about v29.3.0's required set.
- `.pi/skills/package-pi-permission-system/SKILL.md`: names none of the altered symbols (grepped).

## Test Impact Analysis

1. New tests the change enables: the id rule as pure value tests on `isFilenameSafeRequestId` and on `forwardedPermissionRequestSchema.safeParse`, without temp files; direct tests of `encodeSessionIdForPath`, which today is covered only through `servingHeartbeatPath`.
2. Redundant tests: none removed.
   The temp-file reader tests could later move to pure schema tests; that is deferred (Non-Goals).
3. Tests that stay as-is because they exercise the layer being replaced: every `readForwardedPermissionRequest` test in `forwarding-io.test.ts` (accessIntent, askingUnits, delegationLicense, sessionApproval, payload, version-skew cases).
   They are the refactor's characterization net, made complete by step 4.

## Invariants at risk

| Invariant                                                                         | Constituency                        | Pinned by                                                                                                        |
| --------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| An older child's missing optional field never becomes a hard deny (ADR 0008 §4)   | users upgrading mid-session         | the "version skew" reader tests (no access intent, no session approval, no payload, legacy message-only request) |
| A malformed `floor` or `askingUnits` drops the whole intent, so the ask escalates | serving-node policy                 | "drops an access intent whose floor is not a string"; the askingUnits malformed cases                            |
| An unrecognized license drops only itself, with the key absent                    | bounded delegation                  | "drops %s but keeps the intent" (`toStrictEqual`)                                                                |
| No unread key rides through                                                       | `toAccessFacts` disclosure boundary | step 4's unknown-key pins; `forwarded-request-server.test.ts`'s `details.accessIntent` `toStrictEqual`           |
| The pre-#810 session-approval shape is rejected, not normalized                   | serving dialog scope choice         | "rejects the pre-#810 shape rather than normalizing it"                                                          |
| A relay hop never adopts an unsafe inbound id                                     | the next hop's filesystem           | `approval-escalator.test.ts` "mints a fresh id when the requester's is not filename-safe"                        |
| A child finds its response where it polls                                         | every forwarded ask                 | the composition-root file-based round trips; the server tests' `readResponse`                                    |
| The session tree and the heartbeat share one encoding                             | out-of-process liveness             | step 8's location and heartbeat tests                                                                            |

## TDD Order

Steps 1, 2, 5, 6, and 8 adopt mechanisms from the reports (a type guard for `toolCallId`, a filename-safe id rule at the reader, a schema at the wire, dot-segment handling in the encoder), so each commit ends with this trailer paragraph, below any `Refs` line:

```text
Co-authored-by: Dezső BICZÓ <1755573+mxr576@users.noreply.github.com>
```

1. `refactor(pi-permission-system): read a tool call's id through a type guard`.
   Extract `getEventToolCallId` in `permission-gate-handler.ts` and call it from `handleToolCall`.
   Tests (`test/handlers/tool-call.test.ts`, new `describe("getEventToolCallId")`): a string id is returned as-is; an absent id, a numeric id, and a `null` event each read as `""`.
   Killing mutations: return `""` unconditionally (kills the string case); return `String(toolCallId ?? "")` (kills the numeric case).

2. `refactor(pi-permission-system): share one filename-safe request id rule`.
   Add `isFilenameSafeRequestId` to `permission-request-id.ts`; `forwardableRequestId` uses it; delete the escalator's local regex.
   Tests (`test/permission-request-id.test.ts`): `createPermissionRequestId()` satisfies it; `1723750000000-k3j5h2a9-4242` and a 128-character id are accepted; `""`, `../../escape`, `a/b`, `a\b`, `.`, `..`, `req.1`, and a 129-character id are rejected.
   The existing relay-hop test in `approval-escalator.test.ts` stays green.
   Killing mutations: `{1,128}` → `+` (kills the 129-character case); add `.` to the class (kills `.`, `..`, `req.1`); class → `[^/]` (kills `a\b`).

3. `test(pi-permission-system): read forwarded requests through one helper`.
   Merge the three `readForwardedPermissionRequest — …` describes in `forwarding-io.test.ts` under one parent whose `writeAndRead(raw, logger = null)` helper accepts a logger, replacing the per-describe `writeAndRead`/`readSessionApproval` copies.
   Keep each describe's own base-request differences (`surface: "read"` vs `"bash"` vs none) as overrides; one test reads `parsed?.surface` as `"read"`.
   No new assertions; the suite stays green.

4. `test(pi-permission-system): pin the forwarded request reader's tolerance`.
   Add pins, green on today's code, for behavior the schema must match and no test asserts yet:
   - a non-string `id`, `requesterSessionId`, `targetSessionId`, or `requesterAgentName`, a non-number `createdAt`, JSON `null`, and a top-level array each return `null` and log the "Ignoring invalid forwarded permission request format" warning (asserted with `expect.stringContaining`, since step 5 appends the issue summary);
   - unparseable JSON returns `null` and logs the "Failed to read forwarded permission request" warning;
   - an unknown `source` reads as `undefined`, `surface: null` stays `null`, `surface: 42` reads as `undefined`;
   - unknown keys on `accessIntent`, on `principal`, and on an asking unit are absent from the result (`toStrictEqual`);
   - an `accessIntent` without `boundaryValue` is dropped.

   Each pin is mutation-checked against today's code before commit: delete the `typeof parsed.createdAt` check (required-field pin red); spread the unit in `copyAskingUnits` instead of rebuilding it (unknown-key pin red); accept `undefined` in the `boundaryValue` check (missing-boundary pin red).

5. `refactor(pi-permission-system): parse a forwarded request with one schema`.
   Add `src/authority/forwarded-request-schema.ts` per Design §2, with `id: z.string()` for now; `readForwardedPermissionRequest` uses `safeParse` and logs `z.prettifyError` as the warning's error detail; `asNarrowedGrants` uses `approvalGrantSchema`; delete the hand-rolled helpers and orphaned imports listed in Module-Level Changes.
   The step-3/4 reader tests and the existing response-reader tests are the net; run the whole package suite, since `forwarded-request-server.test.ts` and `composition-root.test.ts` read through the reader.
   Killing mutations, each run against this step's code: remove `.catch(undefined)` from `delegationLicense` ("drops %s but keeps the intent" red); remove `.min(1)` from `askingUnits` (the empty-units case red); remove the intent's `withoutUndefinedKeys` transform (the `toStrictEqual` license cases red); make the intent object loose (step 4's unknown-key pin red); `boundaryValue` → `.nullish()` (step 4's missing-boundary pin red); remove `.min(1)` from `sessionApproval.grants` (the empty-grants rejection red).

6. `fix(pi-permission-system): drop a forwarded request whose id could name a path outside the inbox`.
   Refine the schema's `id` with `isFilenameSafeRequestId`.
   Tests:
   - `test/authority/forwarded-request-schema.test.ts`: `../../escape-test` and a 129-character id are rejected with an issue at path `id`; a minted `perm-<uuid>` is accepted.
   - `forwarding-io.test.ts`: a request with `id: "../escape-test"` reads as `null` and the warning's detail names `id`.
   - `forwarded-request-server.test.ts`: plant `requests/planted.json` (written inline with `writeFileSync`, not through `writeRequest`, which would itself escape) holding a well-formed request with `id: "../escape-test"`; after `processInbox`, the escalator was never called, `planted.json` is gone, `join(location.sessionRootDir, "escape-test.json")` does not exist, and `responses/` is empty.

   Killing mutation: revert `id` to `z.string()` (all three tests red; the server test through the escalator call and the escaped file).

7. `fix(pi-permission-system): answer a forwarded request in the file it arrived in`.
   `recordForwardedDecision` names the response `basename(requestPath)`.
   Test (`forwarded-request-server.test.ts`): plant `requests/req-b.json` holding a well-formed request with `id: "req-a"`; the response is at `responses/req-b.json` and `responses/req-a.json` does not exist.
   Rename `readResponse`'s `requestId` parameter to `fileStem`.
   Killing mutation: restore `` join(location.responsesDir, `${request.id}.json`) `` (the test red).

8. `fix(pi-permission-system): keep a dot-only session id's forwarding files under sessions/`.
   `encodeSessionIdForPath` escapes an all-dot id (Design §4).
   Tests:
   - `permission-forwarding.test.ts`, new `describe("encodeSessionIdForPath")`: `.` → `%2E`, `..` → `%2E%2E`, `...` → `%2E%2E%2E`; `a.b` and a UUID are unchanged; `../../escaped` → `..%2F..%2Fescaped`; `createPermissionForwardingLocation(root, "..").sessionRootDir` equals `join(root, "sessions", "%2E%2E")`.
   - `forwarding-liveness.test.ts`: `servingHeartbeatPath(root, "..")` equals `join(root, "serving", "%2E%2E.json")`.

   Killing mutations: `return encodeURIComponent(sessionId)` (every all-dot case red); `/^\.+$/` → `/^\.{1,2}$/` (the `...` case red).

9. `docs(pi-permission-system): record the forwarding wire's validation`.
   The `architecture.md` module-tree entries, the new `forwarded-request-schema.ts` entry, the roadmap `✅` heading and `S1067` node, and the `Landed:` note listed in Module-Level Changes.
   Re-read the edited tree entries against the `markdown-conventions` architecture-doc rule (current behavior, no provenance trail).

At ship time, close [#1068] and [#1069] with this issue and reply to the reporter.

## Risks and Mitigations

- **A Zod output shape the old reader never produced.**
  A caught malformed key comes back present with `undefined` (measured).
  `withoutUndefinedKeys` at both levels removes it; the `toStrictEqual` license cases and step 4's unknown-key pins fail if it is dropped.
- **Tolerance drift in the rewrite.**
  Step 4 pins every tolerance class the design table lists before step 5 replaces the guards, and step 5 names a mutation per class.
- **Typing friction between the schema output and the hand-written wire types** (`readonly ApprovalGrant[]`, optional fields).
  `tsc` is the check; run `pnpm --filter @gotgenes/pi-permission-system run check` right after step 5.
- **A log detail that echoes wire content.**
  `z.prettifyError` prints issue messages and paths; the refine's custom message carries no value.
  Forwarding logs are already owner-only.
- **Concurrent work on the same tree.**
  PR [#1107] ([#1115]) edits `extension-paths.ts`, `index.ts`, `subagent-integration.md`, and their tests, none of which this plan touches.

## Open Questions

None.

[#752]: https://github.com/gotgenes/pi-packages/issues/752
[#1068]: https://github.com/gotgenes/pi-packages/issues/1068
[#1069]: https://github.com/gotgenes/pi-packages/issues/1069
[#1107]: https://github.com/gotgenes/pi-packages/pull/1107
[#1115]: https://github.com/gotgenes/pi-packages/issues/1115
[#1121]: https://github.com/gotgenes/pi-packages/issues/1121
