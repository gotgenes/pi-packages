# Migration guide: a session approval carries a surface per pattern

Starting with the release that closes #810, a session-scoped approval records each of its patterns on the surface that pattern's own access was proven on, instead of recording every pattern on one shared surface.

This is a **breaking change** on one surface, with a second, milder effect during a version-skew window.

| Surface                                                           | Break                                            | Who is affected                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------- |
| `ForwardedSessionApproval` (a field of `PromptPermissionDetails`) | `surface` and `patterns` removed; `grants` added | Any extension whose registered `Authorizer` reads `details.sessionApproval` |
| `ForwardedPermissionRequest.sessionApproval` (on-disk wire)       | the old shape is rejected, not normalized        | Anyone running **out-of-process** subagents across mixed versions           |

## What changed, and why it is not just a rename

A permission gate proves a direction for each path it sees: reading `/outside/a.ts` proves a read, redirecting into `/elsewhere/b.ts` proves a write, and an unclassifiable access proves neither.
The bash external-directory gate aggregates every uncovered path into **one** prompt, so it built one approval covering all of them.

Because that approval held a single surface, it could only be as narrow as the whole prompt agreed.
A command touching paths in two directions fell back to the direction-neutral family name, which grants both directions.
So approving

```bash
cat /outside/a.ts > /elsewhere/b.ts
```

for the session also granted writes under `/outside` and reads under `/elsewhere` — wider than the prompt named.

Each pattern now carries its own surface, so that approval grants a read under `/outside` and a write under `/elsewhere`, and nothing else.

Two paths in the **same** directory still grant both directions there.
The recorded pattern is the path's directory scope, so both paths produce the same pattern and the two grants land on the same directory in opposite directions — which is exactly what the prompt showed.

## If you register an `Authorizer`

A chain link receives `PromptPermissionDetails`, whose optional `sessionApproval` field changed shape:

```typescript
// Before
const surface = details.sessionApproval?.surface;
const first = details.sessionApproval?.patterns[0];

// After
const first = details.sessionApproval?.grants[0];
const surface = first?.surface;
const pattern = first?.pattern;
```

`grants` is a non-empty array of `{ surface, pattern }`, in the order the gate produced them.
Read each entry's own `surface` — do not assume the first one describes the rest, which is the assumption this change exists to remove.

Most links never touch this field; it exists so a serving node can offer a whole-session grant scope, and links that only rule on the request are unaffected.

## If you run out-of-process subagents

A subagent with no UI writes its ask to a request file that its parent session reads.
The suggestion travels in that file, and the reader accepts only the new shape — the old one is rejected rather than converted.

That matters only while a parent and a child are running **different** versions of this extension, which happens when an upgrade lands on disk while a parent session is already loaded.
An in-process child shares its parent's loaded extension and can never skew.

The effect is symmetric and bounded:

- The request is still accepted, and the ask still prompts.
  Only the suggestion is dropped.
- With no suggestion, the prompt shows its base four options instead of asking whether the grant covers the whole serving session.
- Choosing "for this session" then records on the **requesting subagent** — the least-privilege default the two-step dialog already pre-selected.

So a skewed pair loses an affordance; it never produces a wider grant, and there is no upgrade ordering to observe.
Restart the serving session after upgrading to restore the scope step.

Carrying the old shape alongside the new was considered and declined.
The wire file turned out to be the smaller of the two breaks: the type is reachable from this package's published type declarations, so replacing its fields breaks a consumer at compile time regardless of what any file on disk contains — and a compatibility shape would have had to be maintained forever to avoid a break that had already happened.

## Related decisions

- [ADR 0006 — Grant-scope selection on forwarded approvals](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0006-forwarded-grant-scope-selection.md), amended by this change.
- [ADR 0013 — The permission policy model](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0013-permission-policy-model.md), §3–§4 for the read/write axis and §9 for a session approval as a policy source.
