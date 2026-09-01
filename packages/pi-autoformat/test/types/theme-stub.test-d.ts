// fallow-ignore-file unused-file
/**
 * Type-only test: Pi's real `Theme` class must reject the duck-typed
 * `{ fg: (name, text) => text }` stub shape that hid the
 * `themed()` `this`-binding regression (commits 6a6ec16 / 6ba7576,
 * retro 0016).
 *
 * After issue #22 lands, `src/extension.ts` consumes the real `Theme`
 * type from `@mariozechner/pi-coding-agent`, so any test stub built as
 * a plain object literal will be rejected at compile time.
 *
 * This file is intentionally not run as a vitest test — it exists for
 * `tsc --noEmit` to assert the type relationship.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, it } from "vitest";

describe("Theme stub-shape expectations", () => {
  it("rejects plain-arrow-function `fg` stubs as assignable to Theme", () => {
    // @ts-expect-error - A plain object with only `fg` is missing the rest of
    // the Theme class surface (fgColors, bgColors, instance methods, etc.) and
    // must not be assignable to the real Theme type.
    const _badStub: Theme = {
      fg: (_name: string, text: string) => text,
    };
  });

  it("accepts a real Theme instance shape via class-based stubs", () => {
    // A class-based stub that structurally mirrors Theme's shape
    // (including private-ish fgColors map referenced by `this`) is the
    // pattern tests must use. We don't construct Theme directly here —
    // its constructor pulls in TUI dependencies — but we record the
    // requirement.
    type RequiredKeys = "fg";
    const _proof: RequiredKeys = "fg" satisfies keyof Theme;
  });
});
