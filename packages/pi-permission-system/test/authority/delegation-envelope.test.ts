import { describe, expect, it, vi } from "vitest";
import type { Authorizer, AuthorizerVerdict } from "#src/authority/authorizer";
import { encloseInDelegationEnvelope } from "#src/authority/delegation-envelope";
import type { PromptPermissionDetails } from "#src/authority/permission-prompter";
import type { PermissionQuery } from "#src/service";
import { makeAuthorizerLog } from "#test/helpers/authorizer-log-fixtures";
import { makePromptDetails } from "#test/helpers/prompt-details-fixtures";

function makeQuery(): PermissionQuery {
  return { checkPermission: vi.fn(), getToolPermission: vi.fn() };
}

/** Build details whose gate-computed surface is `accessIntentSurface`. */
function makeDetails(
  accessIntentSurface: string | undefined,
  displaySurface?: string | null,
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
      const enclosed = encloseInDelegationEnvelope(makeLink({ kind: "allow" }));
      const verdict = await enclosed(
        makeDetails("external_directory"),
        query,
        log,
      );
      expect(verdict).toEqual({ kind: "defer" });
    });

    it("downgrades an allow on the path surface", async () => {
      const enclosed = encloseInDelegationEnvelope(makeLink({ kind: "allow" }));
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
          makeLink({ kind: "allow" }),
        );
        const verdict = await enclosed(makeDetails(surface), query, log);
        expect(verdict).toEqual({ kind: "defer" });
      },
    );

    it("downgrades an allow when the surface is undetermined (fail-safe)", async () => {
      const enclosed = encloseInDelegationEnvelope(makeLink({ kind: "allow" }));
      const verdict = await enclosed(makeDetails(undefined, null), query, log);
      expect(verdict).toEqual({ kind: "defer" });
    });
  });

  describe("passes verdicts through unchanged", () => {
    it("keeps an allow on a non-excluded surface (bash)", async () => {
      const enclosed = encloseInDelegationEnvelope(makeLink({ kind: "allow" }));
      const verdict = await enclosed(makeDetails("bash"), query, log);
      expect(verdict).toEqual({ kind: "allow" });
    });

    it("keeps an allow on a per-tool surface (read)", async () => {
      const enclosed = encloseInDelegationEnvelope(makeLink({ kind: "allow" }));
      const verdict = await enclosed(makeDetails("read"), query, log);
      expect(verdict).toEqual({ kind: "allow" });
    });

    it("never caps a deny, even on an excluded surface", async () => {
      const enclosed = encloseInDelegationEnvelope(
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
      const enclosed = encloseInDelegationEnvelope(makeLink({ kind: "defer" }));
      const verdict = await enclosed(makeDetails("path"), query, log);
      expect(verdict).toEqual({ kind: "defer" });
    });
  });

  describe("with operator trust (authorizerTrust)", () => {
    const trust = {
      link: "judge",
      families: new Set(["external_directory"]),
    };

    it.each(["external_directory", "external_directory_read"])(
      "keeps an allow on %s, a member of a trusted family, and records it",
      async (surface) => {
        const trustLog = makeAuthorizerLog();
        const enclosed = encloseInDelegationEnvelope(
          makeLink({ kind: "allow" }),
          trust,
        );
        const details = makeDetails(surface);
        const verdict = await enclosed(details, query, trustLog);
        expect(verdict).toEqual({ kind: "allow" });
        expect(trustLog.review).toHaveBeenCalledWith(
          "authorizer_trusted_allow",
          {
            requestId: details.requestId,
            link: "judge",
            surfaceFamily: "external_directory",
          },
        );
      },
    );

    it("still caps an allow on an excluded family it does not name", async () => {
      const enclosed = encloseInDelegationEnvelope(
        makeLink({ kind: "allow" }),
        trust,
      );
      const verdict = await enclosed(makeDetails("path_read"), query, log);
      expect(verdict).toEqual({ kind: "defer" });
    });

    it("still caps an allow when the surface is undetermined (fail-safe)", async () => {
      const enclosed = encloseInDelegationEnvelope(
        makeLink({ kind: "allow" }),
        {
          link: "judge",
          families: new Set(["external_directory", "path"]),
        },
      );
      const verdict = await enclosed(makeDetails(undefined, null), query, log);
      expect(verdict).toEqual({ kind: "defer" });
    });

    it("records nothing for an allow on a non-excluded surface", async () => {
      const trustLog = makeAuthorizerLog();
      const enclosed = encloseInDelegationEnvelope(
        makeLink({ kind: "allow" }),
        trust,
      );
      const verdict = await enclosed(makeDetails("bash"), query, trustLog);
      expect(verdict).toEqual({ kind: "allow" });
      expect(trustLog.review).not.toHaveBeenCalled();
    });
  });

  it("prefers the gate-computed accessIntent surface over the display surface", async () => {
    // accessIntent.surface (external_directory) is authoritative even when the
    // display-surface override says otherwise.
    const enclosed = encloseInDelegationEnvelope(makeLink({ kind: "allow" }));
    const verdict = await enclosed(
      makeDetails("external_directory", "bash"),
      query,
      log,
    );
    expect(verdict).toEqual({ kind: "defer" });
  });

  it("forwards details, the injected query, and the review-log seam to the wrapped link", async () => {
    const link = makeLink({ kind: "defer" });
    const enclosed = encloseInDelegationEnvelope(link);
    const details = makeDetails("bash");
    await enclosed(details, query, log);
    expect(link).toHaveBeenCalledWith(details, query, log);
  });
});
