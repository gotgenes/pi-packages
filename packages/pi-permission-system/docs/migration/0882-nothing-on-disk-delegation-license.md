# Migration guide: the nothing-on-disk delegation license

Starting with the release that closes #882, the bounded-delegation checkpoint no longer caps every authorizer-link `allow` on the `external_directory` surface family.
A link's `allow` on a bash command's `external_directory` ask is honored when the ask carries the **nothing-on-disk license**.
This is a **breaking change** for one narrow configuration.

## Who is affected

You are affected only if **all** of the following hold:

- You name an authorizer chain link in `authorizerChain`, and
- that link is **allow-capable** (it can return `allow`, not only `deny` / `defer`), and
- it returns `allow` on a bash `external_directory` ask.

If you run no chain link, or run only a deny-first link (including the first-party [`@gotgenes/pi-permission-model-judge`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-model-judge), which only ever denies or defers), **nothing changes for you**.

## What changed

The checkpoint downgraded every link `allow` on the `path` and `external_directory` families to `defer`, so the ask fell through to an interactive prompt.
It now makes one exception, decided per ask: a bash command's `external_directory` ask carries the license when the command reads verbatim (it parses without error recovery, so an extglob operand such as `/@(etc|var)` does not, and holds no backslash-newline continuation) and **every** path the ask flags

- names nothing on disk below the filesystem root (the first entry along the path is `/` itself, so `/Sheet1/B1` qualifies and `~/new/file` does not),
- is not the root itself (`rm -rf /` never qualifies),
- is a whole word spelled as the absolute path it names: a token glued to anything else (``/e`echo tc`/passwd``, `--file=/x`), a relative path (`../x`, or anything after a `cd`), a `.` or `..` segment, or a glob, brace, `$` expansion, command substitution, or escape (as in `/e?c/passwd`) never qualifies, and
- is not a proven write (an output redirect such as `> /newtop`, or a `commandEffects` writer).

That is the shape of a token that only looks like a path, such as the spreadsheet cell in `officecli set data.xlsx /Sheet1/B1`.
A link's `allow` on a licensed ask is honored instead of becoming a prompt, and the review log records an `authorizer_allow_licensed` entry naming the request, the link, and the license, beside the `permission_request.approved` entry whose `decidedBy` names the same link.

Unchanged:

- An ask with any flagged path that exists, or that sits under an existing directory, is capped exactly as before.
- A tool's ask (`write`, `edit`, an extension tool's path) never carries the license.
- The `path` family takes no license, and an ask whose surface cannot be determined stays capped.
- `deny` and `defer` verdicts were never capped and still are not.
- A link grant stays non-persistent (`approved`, never `approved_for_session`).

The license crosses the subagent forwarding wire, so a forwarded ask is judged the same way as a local one; a session or subagent running an older version sends or keeps no license, which reads as capped.

## What you need to do

Nothing, unless you run an allow-capable link that returns `allow` on bash `external_directory` asks.

If you do, expect such a link's `allow` to resolve a licensed ask without a prompt.
To keep prompting on these asks, have the link defer on the `external_directory` family, or remove it from `authorizerChain`.
A link can read the license before deciding: it rides the ask details as `accessIntent.delegationLicense`.

## Related

The decision record is `docs/decisions/0007-model-judge-authorizer-chain-adr.md`, amendment 8.
Lifting the cap for a whole surface family, globally or per link, is a different question that this release does not decide.
