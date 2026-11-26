# Migration guide: strict config validation

Starting with the release that closes #547, the permission-system config loader validates each config file against a JSON Schema derived from a zod source of truth.
This is a **breaking change** in how malformed config is handled.

## What changed

The loader used to be **tolerant**: it silently discarded a malformed field and loaded the rest.
For example, a config with `"debugLog": "yes"` (a string, not a boolean) simply dropped `debugLog` and kept going; an unknown key like `"debugLo": true` was ignored.

The loader is now **strict and fail-closed**:

- A config file with **any** invalid field is rejected as a whole scope (global or project).
- The rejected scope contributes **no** permission rules.
- Each problem is reported as a clear, path-qualified issue in the permission review log (and the debug log when `debugLog` is on).

Nothing about the config **format** changed — a config that was already valid keeps working unchanged.

## Cross-scope hardening (fail closed on an invalid higher scope)

Rejecting a scope's rules is only half the story.
Because a higher-precedence scope that contributes no rules leaves the **lower** scope's rules in place, an invalid *higher* scope used to silently inherit the lower scope's policy — including a permissive `allow`.
For example, a global `bash: allow` remained effective even when a project config meant to deny bash but contained a typo.

The loader now fails closed across scopes as well: when a **non-global** scope (project config, global agent frontmatter, or project agent frontmatter) is present but invalid, the effective policy is floored so nothing resolves more permissively than `ask`.
Every `allow` — including one inherited from a lower scope — is clamped to `ask`; `deny` and `ask` are unchanged.
Alongside the per-problem validation issues, a distinct notice is reported: `Invalid <scope> configuration detected — failing closed: 'allow' rules are clamped to 'ask' …`.

An invalid **global** scope does not trigger the cross-scope clamp — it is the lowest precedence, so nothing more permissive is inherited when it fails.
The clamp is deny-preserving and applied at composition; a floored `ask` escalates like any other, so [auto-approve](../configuration.md#auto-approve) still answers it when it covers the ask.
Fix the reported problems and reload to restore the intended policy.

## What you need to do

If your config was valid, nothing.

If a scope stops taking effect after upgrading (surfaces start prompting with `ask`), open the permission review log and look for `Invalid config value at '<path>': …` or `Unrecognized config key '<key>'.` messages.
Fix each reported problem, then reload.

Common fixes:

- **Wrong type** — e.g. `"toolInputPreviewMaxLength": "400"` (string) → `400` (number); `"debugLog": "true"` → `true`.
- **Unknown key** — a typo (`"debugLo"` → `"debugLog"`) or a legacy top-level policy key (`defaultPolicy`, `tools`, `bash`, …) that belongs under `permission` (see `legacy-to-flat.md`).
- **Invalid permission action** — an action must be `"allow"`, `"deny"`, or `"ask"` (or a `{ "action": "deny", "reason": "…" }` object).

## Editor support

Add the hosted schema to your config for autocomplete and inline validation, so these problems surface as you type:

```json
"$schema": "https://raw.githubusercontent.com/gotgenes/pi-packages/main/packages/pi-permission-system/schemas/permissions.schema.json"
```
