import { describe, expect, it, vi } from "vitest";

import { retryOnTransientFsError } from "#src/authority/transient-fs-retry";

// ── helpers ────────────────────────────────────────────────────────────────

/** An `fs`-shaped error: a plain `Error` carrying an errno `code`. */
function errnoError(code: string): Error {
  return Object.assign(new Error(`${code}: operation not permitted`), { code });
}

/**
 * An operation that throws `code` for its first `failures` attempts.
 *
 * Returned alongside a counter so a test can assert how many attempts the
 * retry actually made, independently of the record it reports.
 */
function failingOperation(
  code: string,
  failures: number,
): { operation: () => void; attempts: () => number } {
  let calls = 0;
  return {
    operation: () => {
      calls += 1;
      if (calls <= failures) {
        throw errnoError(code);
      }
    },
    attempts: () => calls,
  };
}

// ── retryOnTransientFsError ────────────────────────────────────────────────

describe("retryOnTransientFsError", () => {
  describe("an operation that succeeds", () => {
    it("reports a single attempt and never sleeps when it succeeds outright", () => {
      const sleep = vi.fn();

      const record = retryOnTransientFsError(() => undefined, { sleep });

      expect(record).toEqual({ attempts: 1, code: null });
      expect(sleep).not.toHaveBeenCalled();
    });

    it("retries a transient EPERM and reports the attempts it took", () => {
      const sleep = vi.fn();
      const { operation, attempts } = failingOperation("EPERM", 1);

      const record = retryOnTransientFsError(operation, { sleep });

      expect(record).toEqual({ attempts: 2, code: "EPERM" });
      expect(attempts()).toBe(2);
      expect(sleep).toHaveBeenCalledExactlyOnceWith(10);
    });

    it.each(["EBUSY", "EACCES"])(
      "retries a transient %s the same way",
      (code) => {
        const sleep = vi.fn();
        const { operation } = failingOperation(code, 2);

        const record = retryOnTransientFsError(operation, { sleep });

        expect(record).toEqual({ attempts: 3, code });
        expect(sleep.mock.calls).toEqual([[10], [20]]);
      },
    );
  });

  describe("an operation that keeps failing", () => {
    it("exhausts the budget, rethrows the last error, and sleeps between attempts", () => {
      const sleep = vi.fn();
      const { operation, attempts } = failingOperation("EPERM", 10);

      expect(() => retryOnTransientFsError(operation, { sleep })).toThrow(
        "EPERM: operation not permitted",
      );

      expect(attempts()).toBe(4);
      expect(sleep.mock.calls).toEqual([[10], [20], [30]]);
    });
  });

  describe("an error the retry cannot help", () => {
    it("rethrows a non-transient errno immediately", () => {
      const sleep = vi.fn();
      const { operation, attempts } = failingOperation("ENOENT", 10);

      expect(() => retryOnTransientFsError(operation, { sleep })).toThrow(
        "ENOENT: operation not permitted",
      );

      expect(attempts()).toBe(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    it("rethrows a thrown value carrying no errno code", () => {
      const sleep = vi.fn();
      let calls = 0;

      expect(() =>
        retryOnTransientFsError(
          () => {
            calls += 1;
            throw new Error("something else");
          },
          { sleep },
        ),
      ).toThrow("something else");

      expect(calls).toBe(1);
      expect(sleep).not.toHaveBeenCalled();
    });
  });

  describe("a caller-supplied budget", () => {
    it("honors an injected delay sequence", () => {
      const sleep = vi.fn();
      const { operation } = failingOperation("EBUSY", 1);

      const record = retryOnTransientFsError(operation, {
        sleep,
        delaysMs: [5],
      });

      expect(record).toEqual({ attempts: 2, code: "EBUSY" });
      expect(sleep).toHaveBeenCalledExactlyOnceWith(5);
    });
  });
});
