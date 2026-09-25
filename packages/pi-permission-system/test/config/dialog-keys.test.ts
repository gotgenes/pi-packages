import { Key, type KeyId, matchesKey } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
  BINDABLE_DIALOG_KEY_CHARACTERS,
  DEFAULT_DIALOG_KEYS,
  type DialogKeyOverrides,
  isBindableDialogKey,
  resolveDialogKeys,
} from "#src/config/dialog-keys";

/**
 * pi-tui's symbol vocabulary, read from the dependency rather than remembered.
 *
 * `Key` enumerates every special and symbol key as a runtime value; the
 * single-character ones are exactly its symbols, since every special key's
 * name (`escape`, `f1`, `pageUp`) is longer than one character.
 */
function piTuiSymbolKeys(): string[] {
  const values: unknown[] = Object.values(Key);
  return values.filter(
    (value): value is string => typeof value === "string" && value.length === 1,
  );
}

describe("BINDABLE_DIALOG_KEY_CHARACTERS", () => {
  it("admits every lowercase letter and digit", () => {
    for (const character of "abcdefghijklmnopqrstuvwxyz0123456789") {
      expect(BINDABLE_DIALOG_KEY_CHARACTERS.has(character)).toBe(true);
    }
  });

  it("admits exactly pi-tui's symbol keys, minus the one its matcher cannot see", () => {
    const symbols = piTuiSymbolKeys();
    // Guard the derivation itself: an empty list would make the claim vacuous.
    expect(symbols.length).toBeGreaterThan(20);
    const admitted = symbols.filter((symbol) =>
      BINDABLE_DIALOG_KEY_CHARACTERS.has(symbol),
    );
    expect(admitted).toEqual(symbols.filter((symbol) => symbol !== "+"));
  });

  it("excludes `+` because pi-tui reads it as a modifier separator", () => {
    // `parseKeyId` splits the identifier on `+`, leaving no key name behind, so
    // a `+` binding would match nothing at all.
    expect(matchesKey("+", "+")).toBe(false);
    expect(BINDABLE_DIALOG_KEY_CHARACTERS.has("+")).toBe(false);
  });

  it("holds only characters pi-tui's matcher accepts", () => {
    for (const character of BINDABLE_DIALOG_KEY_CHARACTERS) {
      // A bindable character is by definition a `KeyId`; the cast is what the
      // assertion is proving.
      expect(matchesKey(character, character as KeyId)).toBe(true);
    }
  });
});

describe("isBindableDialogKey", () => {
  it.each([
    ["a digit", "1"],
    ["a letter", "q"],
    ["a symbol", "/"],
  ])("accepts %s", (_name, value) => {
    expect(isBindableDialogKey(value)).toBe(true);
  });

  it.each([
    ["the empty string", ""],
    ["two characters", "yy"],
    ["an uppercase letter", "A"],
    ["a non-ASCII character", "é"],
    ["the modifier separator", "+"],
    ["a named key", "escape"],
    ["a modifier combination", "ctrl+g"],
    ["a space", " "],
  ])("rejects %s", (_name, value) => {
    expect(isBindableDialogKey(value)).toBe(false);
  });
});

describe("resolveDialogKeys", () => {
  function resolve(permissionDialogKeys?: DialogKeyOverrides) {
    return resolveDialogKeys({ permissionDialogKeys });
  }

  describe("with nothing configured", () => {
    it("returns the shipped bindings with no issues", () => {
      expect(resolve()).toEqual({ keys: DEFAULT_DIALOG_KEYS, issues: [] });
    });

    it("treats an empty map the same way", () => {
      expect(resolve({})).toEqual({ keys: DEFAULT_DIALOG_KEYS, issues: [] });
    });
  });

  describe("with usable bindings", () => {
    it("applies every configured decision", () => {
      expect(
        resolve({
          approve: "1",
          approveSession: "2",
          approveSessionBoth: "3",
          deny: "4",
          denyWithReason: "5",
          editPatterns: "6",
          persistProject: "7",
          persistGlobal: "8",
        }),
      ).toEqual({
        keys: {
          approve: "1",
          approveSession: "2",
          approveSessionBoth: "3",
          deny: "4",
          denyWithReason: "5",
          editPatterns: "6",
          persistProject: "7",
          persistGlobal: "8",
        },
        issues: [],
      });
    });

    it("leaves an unnamed decision on its default", () => {
      expect(resolve({ approve: "1" })).toEqual({
        keys: { ...DEFAULT_DIALOG_KEYS, approve: "1" },
        issues: [],
      });
    });

    it("accepts a symbol its matcher can see", () => {
      expect(resolve({ deny: "/" }).keys.deny).toBe("/");
    });

    it("applies a swap, since neither decision keeps the other's key", () => {
      expect(resolve({ approve: "n", deny: "y" })).toEqual({
        keys: { ...DEFAULT_DIALOG_KEYS, approve: "n", deny: "y" },
        issues: [],
      });
    });
  });

  describe("with an unusable binding", () => {
    it.each([
      ["the empty string", ""],
      ["more than one character", "yy"],
      ["an uppercase letter", "A"],
      ["a non-ASCII character", "é"],
      ["the modifier separator", "+"],
      ["a named key", "escape"],
    ])("keeps the default and reports %s", (_name, value) => {
      const resolution = resolve({ approve: value });
      expect(resolution.keys).toEqual(DEFAULT_DIALOG_KEYS);
      expect(resolution.issues).toEqual([
        `permissionDialogKeys.approve: "${value}" is not a bindable key. ` +
          'Use one lowercase letter, digit, or symbol; keeping the default "y".',
      ]);
    });
  });

  describe("with the summary-toggle character", () => {
    it("refuses the binding and keeps the default", () => {
      const resolution = resolveDialogKeys({
        permissionDialogKeys: { approve: "t" },
      });
      expect(resolution.keys).toEqual(DEFAULT_DIALOG_KEYS);
      expect(resolution.issues).toEqual([
        'permissionDialogKeys.approve: "t" is reserved for toggling the ' +
          'save summary; keeping the default "y".',
      ]);
    });
  });

  describe("with a binding the dialog reserves", () => {
    it.each([["j"], ["k"]])(
      "keeps the default and reports %s, which moves the highlight",
      (value) => {
        const resolution = resolve({ deny: value });
        expect(resolution.keys).toEqual(DEFAULT_DIALOG_KEYS);
        expect(resolution.issues).toEqual([
          `permissionDialogKeys.deny: "${value}" is reserved for moving the ` +
            'dialog\'s highlight; keeping the default "n".',
        ]);
      },
    );
  });

  describe("with colliding bindings", () => {
    it("drops both overrides when two decisions claim one character", () => {
      const resolution = resolve({ approve: "1", deny: "1" });
      expect(resolution.keys).toEqual(DEFAULT_DIALOG_KEYS);
      expect(resolution.issues).toEqual([
        'permissionDialogKeys.approve: "1" is already bound to another ' +
          'decision; keeping the default "y".',
        'permissionDialogKeys.deny: "1" is already bound to another ' +
          'decision; keeping the default "n".',
      ]);
    });

    it("drops an override that claims another decision's default", () => {
      const resolution = resolve({ approve: "n" });
      expect(resolution.keys).toEqual(DEFAULT_DIALOG_KEYS);
      expect(resolution.issues).toEqual([
        'permissionDialogKeys.approve: "n" is already bound to another ' +
          'decision; keeping the default "y".',
      ]);
    });

    it("re-checks after a restored default collides in its turn", () => {
      // `approve: "b"` collides with the untouched `approveSessionBoth`
      // default; dropping it restores `approve: "y"`, which then collides with
      // the surviving `deny: "y"`. One pass would leave that duplicate bound.
      const resolution = resolve({ approve: "b", deny: "y" });
      expect(resolution.keys).toEqual(DEFAULT_DIALOG_KEYS);
      expect(resolution.issues).toEqual([
        'permissionDialogKeys.approve: "b" is already bound to another ' +
          'decision; keeping the default "y".',
        'permissionDialogKeys.deny: "y" is already bound to another ' +
          'decision; keeping the default "n".',
      ]);
    });

    it("keeps an override whose collision was resolved by a sibling move", () => {
      // `approve` takes deny's letter, but `deny` moves off it in the same map.
      expect(resolve({ approve: "n", deny: "4" }).issues).toEqual([]);
    });
  });
});
