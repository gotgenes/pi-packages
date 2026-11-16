import { describe, expect, it, vi } from "vitest";
import type { Authorizer, AuthorizerVerdict } from "#src/authority/authorizer";
import { encloseInDelegationEnvelope } from "#src/authority/delegation-envelope";
import type { ForwardedAccessFacts } from "#src/authority/permission-forwarding";
import type { PromptPermissionDetails } from "#src/authority/permission-prompter";
import type { PermissionQuery } from "#src/service";
import { makeAuthorizerLog } from "#test/helpers/authorizer-log-fixtures";
import { makePromptDetails } from "#test/helpers/prompt-details-fixtures";

function makeQuery(): PermissionQuery {
  return { checkPermission: vi.fn(), getToolPermission: vi.fn() };
}

/**
 * Build details whose gate-computed surface is `accessIntentSurface`, with any
 * further access facts spread over the defaults.
 */
function makeDetails(
  accessIntentSurface: string | undefined,
  displaySurface?: string | null,
  facts: Partial<ForwardedAccessFacts> = {},
): PromptPermissionDetails {
  return makePromptDetails({
    surface: displaySurface,
    accessIntent:
      accessIntentSurface === undefined
        ? undefined
        : {
            surface: accessIntentSurface,
            matchValues: ["/some/value"],
            boundaryValue: null,
            ...facts,
          },
  });
}

/** A link whose fixed verdict the envelope may cap. */
function makeLink(verdict: AuthorizerVerdict): Authorizer["authorize"] {
  return vi.fn<Authorizer["authorize"]>().mockResolvedValue(verdict);
}

describe("encloseInDelegationEnvelope", () => {
  const query = makeQuery();
  const log = makeAuthorizerLog();

  describe("caps an allow verdict on an excluded surface to defer", () => {
    it("downgrades an allow on external_directory", async () => {
      const enclosed = encloseInDelegationEnvelope(
        "judge",
        makeLink({ kind: "allow" }),
      );
      const verdict = await enclosed(
        makeDetails("external_directory"),
        query,
        log,
      );
      expect(verdict).toEqual({ kind: "defer" });
    });

    it("downgrades an allow on the path surface", async () => {
      const enclosed = encloseInDelegationEnvelope(
        "judge",
        makeLink({ kind: "allow" }),
      );
      const verdict = await enclosed(makeDetails("path"), query, log);
      expect(verdict).toEqual({ kind: "defer" });
    });

    it.each([
      "path_read",
      "path_write",
      "external_directory_read",
      "external_directory_write",
    ])(
      "downgrades an allow on %s, a member of an excluded family",
      async (surface) => {
        const enclosed = encloseInDelegationEnvelope(
          "judge",
          makeLink({ kind: "allow" }),
        );
        const verdict = await enclosed(makeDetails(surface), query, log);
        expect(verdict).toEqual({ kind: "defer" });
      },
    );

    it("downgrades an allow when the surface is undetermined (fail-safe)", async () => {
      const enclosed = encloseInDelegationEnvelope(
        "judge",
        makeLink({ kind: "allow" }),
      );
      const verdict = await enclosed(makeDetails(undefined, null), query, log);
      expect(verdict).toEqual({ kind: "defer" });
    });
  });

  describe("passes verdicts through unchanged", () => {
    it("keeps an allow on a non-excluded surface (bash)", async () => {
      const enclosed = encloseInDelegationEnvelope(
        "judge",
        makeLink({ kind: "allow" }),
      );
      const verdict = await enclosed(makeDetails("bash"), query, log);
      expect(verdict).toEqual({ kind: "allow" });
    });

    it("keeps an allow on a per-tool surface (read)", async () => {
      const enclosed = encloseInDelegationEnvelope(
        "judge",
        makeLink({ kind: "allow" }),
      );
      const verdict = await enclosed(makeDetails("read"), query, log);
      expect(verdict).toEqual({ kind: "allow" });
    });

    it("never caps a deny, even on an excluded surface", async () => {
      const enclosed = encloseInDelegationEnvelope(
        "judge",
        makeLink({ kind: "deny", reason: "wrong path" }),
      );
      const verdict = await enclosed(
        makeDetails("external_directory"),
        query,
        log,
      );
      expect(verdict).toEqual({ kind: "deny", reason: "wrong path" });
    });

    it("never caps a defer", async () => {
      const enclosed = encloseInDelegationEnvelope(
        "judge",
        makeLink({ kind: "defer" }),
      );
      const verdict = await enclosed(makeDetails("path"), query, log);
      expect(verdict).toEqual({ kind: "defer" });
    });
  });

  describe("honors an allow the nothing-on-disk license covers", () => {
    const licensed = { delegationLicense: "nothing-on-disk" as const };

    it.each([
      "external_directory",
      "external_directory_read",
      "external_directory_write",
    ])(
      "passes a licensed allow on %s and records what licensed it",
      async (surface) => {
        const licenseLog = makeAuthorizerLog();
        const enclosed = encloseInDelegationEnvelope(
          "judge",
          makeLink({ kind: "allow" }),
        );
        const details = makeDetails(surface, undefined, licensed);
        const verdict = await enclosed(details, query, licenseLog);
        expect(verdict).toEqual({ kind: "allow" });
        expect(licenseLog.review).toHaveBeenCalledWith(
          "authorizer_allow_licensed",
          {
            requestId: details.requestId,
            link: "judge",
            license: "nothing-on-disk",
          },
        );
      },
    );

    it.each(["path", "path_write"])(
      "still caps a licensed allow on %s, a path-family surface",
      async (surface) => {
        const licenseLog = makeAuthorizerLog();
        const enclosed = encloseInDelegationEnvelope(
          "judge",
          makeLink({ kind: "allow" }),
        );
        const verdict = await enclosed(
          makeDetails(surface, undefined, licensed),
          query,
          licenseLog,
        );
        expect(verdict).toEqual({ kind: "defer" });
        expect(licenseLog.review).not.toHaveBeenCalled();
      },
    );

    it("caps an unlicensed external_directory allow without recording a license", async () => {
      const licenseLog = makeAuthorizerLog();
      const enclosed = encloseInDelegationEnvelope(
        "judge",
        makeLink({ kind: "allow" }),
      );
      const verdict = await enclosed(
        makeDetails("external_directory"),
        query,
        licenseLog,
      );
      expect(verdict).toEqual({ kind: "defer" });
      expect(licenseLog.review).not.toHaveBeenCalled();
    });

    it.each([
      ["deny", { kind: "deny", reason: "wrong path" }],
      ["defer", { kind: "defer" }],
    ] as const)(
      "passes a licensed %s unchanged without a record",
      async (_, verdict) => {
        const licenseLog = makeAuthorizerLog();
        const enclosed = encloseInDelegationEnvelope(
          "judge",
          makeLink(verdict),
        );
        expect(
          await enclosed(
            makeDetails("external_directory", undefined, licensed),
            query,
            licenseLog,
          ),
        ).toEqual(verdict);
        expect(licenseLog.review).not.toHaveBeenCalled();
      },
    );
  });

  it("prefers the gate-computed accessIntent surface over the display surface", async () => {
    // accessIntent.surface (external_directory) is authoritative even when the
    // display-surface override says otherwise.
    const enclosed = encloseInDelegationEnvelope(
      "judge",
      makeLink({ kind: "allow" }),
    );
    const verdict = await enclosed(
      makeDetails("external_directory", "bash"),
      query,
      log,
    );
    expect(verdict).toEqual({ kind: "defer" });
  });

  it("forwards details, the injected query, and the review-log seam to the wrapped link", async () => {
    const link = makeLink({ kind: "defer" });
    const enclosed = encloseInDelegationEnvelope("judge", link);
    const details = makeDetails("bash");
    await enclosed(details, query, log);
    expect(link).toHaveBeenCalledWith(details, query, log);
  });
});
