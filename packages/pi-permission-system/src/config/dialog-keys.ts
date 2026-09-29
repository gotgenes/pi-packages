/**
 * The inline permission dialog's key bindings, and the defaults they start from.
 *
 * The action ids are the `permissionDialogKeys` config keys, so the config
 * surface and the decision model speak one vocabulary rather than two that a
 * translation layer has to keep in step.
 */

/**
 * The dialog's decisions, named by what they do.
 *
 * Distinct from the character that selects one: a binding is configurable and
 * an identity is not, so a rebound dialog still decides the same things. The
 * three persistence actions are offered only to a direct local ask that
 * carries a rule proposal; a forwarded ask never sees them.
 */
export type PromptAction =
  | "approve"
  | "approveSession"
  | "approveSessionBoth"
  | "editPatterns"
  | "persistProject"
  | "persistGlobal"
  | "deny"
  | "denyWithReason";

/** Every action's bound character, complete. */
export type DialogKeyBindings = Readonly<Record<PromptAction, string>>;

/** What a config file may say: any subset of the actions. */
export type DialogKeyOverrides = Partial<Record<PromptAction, string>>;

/** The config slice the resolver reads. */
export interface DialogKeysConfig {
  readonly permissionDialogKeys?: DialogKeyOverrides;
}

/** The bindings to use, and what had to be refused to arrive at them. */
export interface DialogKeyResolution {
  readonly keys: DialogKeyBindings;
  /** One sentence per refused override; empty when every one applied. */
  readonly issues: readonly string[];
}

/** The decisions in the order a config's overrides are considered. */
const ACTION_ORDER: readonly PromptAction[] = [
  "approve",
  "approveSession",
  "approveSessionBoth",
  "editPatterns",
  "persistProject",
  "persistGlobal",
  "deny",
  "denyWithReason",
];

/** The shipped bindings, unchanged since the dialog was introduced. */
export const DEFAULT_DIALOG_KEYS: DialogKeyBindings = {
  approve: "y",
  approveSession: "s",
  approveSessionBoth: "b",
  editPatterns: "e",
  persistProject: "p",
  persistGlobal: "g",
  deny: "n",
  denyWithReason: "r",
};

const LOWERCASE_LETTERS = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";

/**
 * pi-tui's symbol keys, minus `+`.
 *
 * `+` separates a modifier from its key in a key identifier, so pi-tui's
 * parser splits `"+"` into two empty halves and the binding matches nothing.
 * A parity test in `test/config/dialog-keys.test.ts` derives this roster from
 * pi-tui's exported `Key` constant and fails if the two drift; keeping the
 * literal here is what lets this module stay free of SDK imports.
 */
const SYMBOLS = "`-=[]\\;',./!@#$%^&*()_|~{}:<>?";

/**
 * Every character a decision may be bound to.
 *
 * Uppercase is excluded deliberately rather than normalized: pi-tui lowercases
 * a key identifier, so a `"Y"` binding would answer to a lowercase `y` and
 * never to the keystroke the user asked for.
 */
export const BINDABLE_DIALOG_KEY_CHARACTERS: ReadonlySet<string> = new Set(
  Array.from(LOWERCASE_LETTERS + DIGITS + SYMBOLS),
);

/** Whether `value` is a single character the dialog can bind a decision to. */
export function isBindableDialogKey(value: string): boolean {
  return BINDABLE_DIALOG_KEY_CHARACTERS.has(value);
}

/**
 * The characters the dialog answers to before any decision does.
 *
 * `handleInput` maps these to navigation ahead of the decision table, so a
 * decision bound to one would simply never fire.
 */
export const RESERVED_DIALOG_KEYS: readonly string[] = ["j", "k"];

/**
 * The character that toggles the sticky save-summary preference.
 *
 * Handled by the component ahead of the decision table whenever a persistence
 * choice is on offer, so a decision bound to it would fire only on asks that
 * offer no persistence — a binding that works sometimes is worse than one
 * refused outright.
 */
export const TOGGLE_SUMMARY_KEY = "t";

/**
 * The bindings a config asks for, reconciled against the defaults.
 *
 * Tolerant by design: an unusable, reserved, or colliding override is refused
 * and its decision keeps the shipped letter, so a mistyped hotkey costs the
 * user their remap and nothing else. The refusals come back as sentences for
 * the caller to surface; the permission policy never sees them.
 */
export function resolveDialogKeys(
  config: DialogKeysConfig,
): DialogKeyResolution {
  const overrides = config.permissionDialogKeys;
  const issues: string[] = [];
  const accepted = new Map<PromptAction, string>();

  for (const action of ACTION_ORDER) {
    const value = overrides?.[action];
    if (value === undefined) continue;
    if (!isBindableDialogKey(value)) {
      issues.push(
        refusal(
          action,
          value,
          "is not a bindable key. Use one lowercase letter, digit, or symbol",
        ),
      );
      continue;
    }
    if (RESERVED_DIALOG_KEYS.includes(value)) {
      issues.push(
        refusal(action, value, "is reserved for moving the dialog's highlight"),
      );
      continue;
    }
    if (value === TOGGLE_SUMMARY_KEY) {
      issues.push(
        refusal(action, value, "is reserved for toggling the save summary"),
      );
      continue;
    }
    accepted.set(action, value);
  }

  // Dropping an override restores its default, and that default can collide
  // with an override that survived the previous look — so this settles rather
  // than checks once. Each round drops at least one override and there are
  // finitely many, and the all-defaults state it terminates at is
  // collision-free.
  for (let round = ACTION_ORDER.length; round > 0; round--) {
    const contested = contestedCharacters(accepted);
    if (contested.size === 0) break;
    for (const [action, value] of accepted) {
      if (!contested.has(value)) continue;
      accepted.delete(action);
      issues.push(
        refusal(action, value, "is already bound to another decision"),
      );
    }
  }

  const keys: Record<PromptAction, string> = { ...DEFAULT_DIALOG_KEYS };
  for (const [action, value] of accepted) {
    keys[action] = value;
  }
  return { keys, issues };
}

/** The characters two decisions would answer to, given the accepted overrides. */
function contestedCharacters(
  accepted: ReadonlyMap<PromptAction, string>,
): ReadonlySet<string> {
  const seen = new Set<string>();
  const contested = new Set<string>();
  for (const action of ACTION_ORDER) {
    const value = accepted.get(action) ?? DEFAULT_DIALOG_KEYS[action];
    if (seen.has(value)) contested.add(value);
    seen.add(value);
  }
  return contested;
}

function refusal(action: PromptAction, value: string, why: string): string {
  return `permissionDialogKeys.${action}: "${value}" ${why}; keeping the default "${DEFAULT_DIALOG_KEYS[action]}".`;
}
