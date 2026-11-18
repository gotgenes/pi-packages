/**
 * Acceptance: a path rule keyed on a file's on-disk spelling applies to every
 * spelling the filesystem opens as that file.
 *
 * On a case-insensitive, normalization-insensitive filesystem (APFS, the macOS
 * default), `upper.txt` opens `Upper.txt` and an NFC spelling opens an
 * NFD-stored name. Exercised end-to-end with real files and the real
 * `PermissionManager` + `PermissionResolver`; skipped on a filesystem that
 * keeps those spellings apart (ext4 on Linux CI), where they are distinct
 * files and nothing is aliased.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BashProgram } from "#src/access-intent/bash/program";
import { describeBashPathGate } from "#src/handlers/gates/bash-path";
import {
  type GateDescriptor,
  type GateResult,
  isGateDescriptor,
} from "#src/handlers/gates/descriptor";
import { describeExternalDirectoryGate } from "#src/handlers/gates/external-directory";
import { describePathGate } from "#src/handlers/gates/path";
import { ToolCallGatePipeline } from "#src/handlers/gates/tool-call-gate-pipeline";
import type { ToolCallContext } from "#src/handlers/gates/types";
import { pathFlavorForPlatform } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path/path-normalizer";
import { PermissionResolver } from "#src/policy/permission-resolver";
import { SessionRules } from "#src/session/session-rules";
import type { ScopeConfig } from "#src/types";
import { makeGateInputs, makeGateRunner } from "#test/helpers/gate-fixtures";
import { createManager } from "#test/helpers/manager-harness";

const NFD_NAME = "cafe\u0301.txt";
const NFC_NAME = "caf\u00e9.txt";

/** Whether the tmpdir's filesystem opens a case variant and an NFC spelling as the stored file. */
function probeFilesystemAliasing(): boolean {
  const dir = mkdtempSync(join(tmpdir(), "fs-alias-probe-"));
  try {
    writeFileSync(join(dir, "Probe.txt"), "x");
    writeFileSync(join(dir, NFD_NAME), "x");
    return (
      existsSync(join(dir, "probe.txt")) && existsSync(join(dir, NFC_NAME))
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ALIASING_FILESYSTEM = probeFilesystemAliasing();

let cwd: string;
let normalizer: PathNormalizer;
const cleanups: Array<() => void> = [];

beforeEach(() => {
  cwd = realpathSync(mkdtempSync(join(tmpdir(), "fs-alias-acc-")));
  normalizer = new PathNormalizer(pathFlavorForPlatform(process.platform), cwd);
  cleanups.push(() => {
    rmSync(cwd, { recursive: true, force: true });
  });
});

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function onDisk(dir: string, name: string): string {
  const file = join(dir, name);
  writeFileSync(file, "x");
  return file;
}

function outsideDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "fs-alias-out-")));
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function makeResolver(config: ScopeConfig): PermissionResolver {
  const { manager, cleanup } = createManager(config);
  cleanups.push(cleanup);
  manager.configureForCwd(cwd);
  return new PermissionResolver(manager, new SessionRules());
}

function readCall(path: string): ToolCallContext {
  return {
    toolName: "read",
    agentName: null,
    input: { path },
    toolCallId: "tc-1",
    cwd,
  };
}

async function bashPathGate(
  path: string,
  resolver: PermissionResolver,
): Promise<GateResult> {
  const command = `cat ${path}`;
  const program = await BashProgram.parse(command, normalizer);
  return describeBashPathGate(
    {
      toolName: "bash",
      agentName: null,
      input: { command },
      toolCallId: "tc-1",
      cwd,
    },
    program,
    resolver,
    normalizer,
  );
}

function stateOf(result: GateResult): string | undefined {
  return isGateDescriptor(result) ? result.preCheck?.state : undefined;
}

function denyOnly(file: string): ScopeConfig {
  return {
    permission: { "*": "allow", path: { "*": "allow", [file]: "deny" } },
  };
}

/** Case variants of the on-disk name `Upper.txt`. */
const CASE_VARIANTS = ["upper.txt", "UPPER.TXT"];

describe.runIf(ALIASING_FILESYSTEM)(
  "a path rule on the on-disk spelling applies to an aliased spelling",
  () => {
    describe("a case variant", () => {
      it.each(CASE_VARIANTS)("the path gate denies %s", (typed) => {
        const resolver = makeResolver(denyOnly(onDisk(cwd, "Upper.txt")));

        const result = describePathGate(
          readCall(join(cwd, typed)),
          resolver,
          normalizer,
        );

        expect(stateOf(result)).toBe("deny");
      });

      it.each(CASE_VARIANTS)(
        "the bash path gate denies cat %s",
        async (typed) => {
          const resolver = makeResolver(denyOnly(onDisk(cwd, "Upper.txt")));

          const result = await bashPathGate(join(cwd, typed), resolver);

          expect(stateOf(result)).toBe("deny");
        },
      );

      it.each(CASE_VARIANTS)(
        "the per-tool gate blocks %s under a read deny",
        async (typed) => {
          const file = onDisk(cwd, "Upper.txt");
          const resolver = makeResolver({
            permission: {
              "*": "allow",
              read: { "*": "allow", [file]: "deny" },
            },
          });
          const pipeline = new ToolCallGatePipeline(
            resolver,
            makeGateInputs({ getPathNormalizer: () => normalizer }),
          );
          const { runner } = makeGateRunner();

          const outcome = await pipeline.evaluate(
            readCall(join(cwd, typed)),
            runner,
          );

          expect(outcome.action).toBe("block");
        },
      );

      it("the external_directory gate denies a variant of an outside file", () => {
        const outside = outsideDir();
        const resolver = makeResolver({
          permission: {
            "*": "allow",
            external_directory: {
              "*": "allow",
              [onDisk(outside, "Upper.txt")]: "deny",
            },
          },
        });

        const result = describeExternalDirectoryGate(
          readCall(join(outside, "upper.txt")),
          { dirs: [], excludedDirs: [] },
          resolver,
          normalizer,
        );

        expect(stateOf(result)).toBe("deny");
      });

      it("an external_directory allow on the on-disk spelling applies to a variant", () => {
        const outside = outsideDir();
        const resolver = makeResolver({
          permission: {
            "*": "allow",
            external_directory: {
              "*": "ask",
              [onDisk(outside, "Upper.txt")]: "allow",
            },
          },
        });

        const result = describeExternalDirectoryGate(
          readCall(join(outside, "upper.txt")),
          { dirs: [], excludedDirs: [] },
          resolver,
          normalizer,
        );

        expect(stateOf(result)).toBe("allow");
      });

      it("judges a case-variant spelling of the cwd as inside it", () => {
        const variantCwd = join(dirname(cwd), basename(cwd).toUpperCase());
        onDisk(cwd, "Upper.txt");
        const resolver = makeResolver({
          permission: { "*": "allow", external_directory: { "*": "ask" } },
        });

        const result = describeExternalDirectoryGate(
          readCall(join(variantCwd, "Upper.txt")),
          { dirs: [], excludedDirs: [] },
          resolver,
          normalizer,
        );

        expect(result).toBeNull();
      });

      it("discloses the on-disk spelling in the ask", () => {
        const file = onDisk(cwd, "Upper.txt");
        const resolver = makeResolver({
          permission: { "*": "allow", path: { "*": "ask" } },
        });

        const result = describePathGate(
          readCall(join(cwd, "upper.txt")),
          resolver,
          normalizer,
        ) as GateDescriptor;

        expect(result.payload.evidence).toEqual([
          { label: "resolves to", text: file, detail: null },
        ]);
      });

      it("resolves a variant directory to its on-disk spelling", () => {
        mkdirSync(join(cwd, "Secrets"));
        const file = onDisk(join(cwd, "Secrets"), "key.txt");
        const resolver = makeResolver(denyOnly(file));

        const result = describePathGate(
          readCall(join(cwd, "secrets", "key.txt")),
          resolver,
          normalizer,
        );

        expect(stateOf(result)).toBe("deny");
      });
    });

    describe("a Unicode-normalization variant", () => {
      it("the path gate denies the NFC spelling of an NFD-stored name", () => {
        const resolver = makeResolver(denyOnly(onDisk(cwd, NFD_NAME)));

        const result = describePathGate(
          readCall(join(cwd, NFC_NAME)),
          resolver,
          normalizer,
        );

        expect(stateOf(result)).toBe("deny");
      });

      it("the bash path gate denies the NFC spelling of an NFD-stored name", async () => {
        const resolver = makeResolver(denyOnly(onDisk(cwd, NFD_NAME)));

        const result = await bashPathGate(join(cwd, NFC_NAME), resolver);

        expect(stateOf(result)).toBe("deny");
      });
    });

    describe("a rule in a spelling the filesystem does not store", () => {
      it("matches only that spelling, typed exactly: a case variant", () => {
        onDisk(cwd, "Upper.txt");
        const resolver = makeResolver(denyOnly(join(cwd, "upper.txt")));

        const result = describePathGate(
          readCall(join(cwd, "UPPER.TXT")),
          resolver,
          normalizer,
        );

        expect(result).toBeNull();
      });

      it("matches only that spelling, typed exactly: an NFC rule for an NFD-stored name", () => {
        onDisk(cwd, NFD_NAME);
        const resolver = makeResolver(denyOnly(join(cwd, NFC_NAME)));

        const result = describePathGate(
          readCall(join(cwd, NFD_NAME)),
          resolver,
          normalizer,
        );

        expect(result).toBeNull();
      });
    });
  },
);
