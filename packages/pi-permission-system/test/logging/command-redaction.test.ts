import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resetWarmBashParser,
  warmBashParser,
} from "#src/access-intent/bash/parser";
import {
  maskCommandFields,
  redactCommandSecrets,
} from "#src/logging/command-redaction";
import { REDACTED_PLACEHOLDER } from "#src/logging/log-redaction";

const MASK = REDACTED_PLACEHOLDER;

describe("redactCommandSecrets", () => {
  afterEach(() => {
    resetWarmBashParser();
  });

  describe("once the parser is warm", () => {
    beforeEach(async () => {
      resetWarmBashParser();
      await warmBashParser();
    });

    describe("a shell assignment whose name is sensitive", () => {
      it("masks a quoted env-prefix value", () => {
        expect(redactCommandSecrets('KEY="sk-abc123" curl https://x')).toBe(
          `KEY=${MASK} curl https://x`,
        );
      });

      it("masks a bare value", () => {
        expect(redactCommandSecrets("KEY=sk-abc123")).toBe(`KEY=${MASK}`);
      });

      it("masks a value under an export declaration", () => {
        expect(
          redactCommandSecrets('export OPENROUTER_KEY="sk-or-v1-xyz"'),
        ).toBe(`export OPENROUTER_KEY=${MASK}`);
      });

      it("masks a value containing spaces, which the parse keeps whole", () => {
        expect(redactCommandSecrets('TOKEN="a b c" deploy')).toBe(
          `TOKEN=${MASK} deploy`,
        );
      });

      it("leaves an assignment whose name binds no credential", () => {
        expect(redactCommandSecrets('OUT="/tmp/x" deploy')).toBe(
          'OUT="/tmp/x" deploy',
        );
      });

      it("leaves an assignment with no value at all", () => {
        expect(redactCommandSecrets("KEY=")).toBe("KEY=");
      });
    });

    describe("an assignment the grammar classifies as a plain word", () => {
      it("masks the value after an env prefix", () => {
        expect(redactCommandSecrets("env MY_KEY=abc deploy")).toBe(
          `env MY_KEY=${MASK} deploy`,
        );
      });

      it("leaves a long-option argument, which binds no name", () => {
        expect(redactCommandSecrets("deploy --my-key=abc")).toBe(
          "deploy --my-key=abc",
        );
      });
    });

    describe("an argument that names a sensitive header field", () => {
      it("masks a double-quoted header argument", () => {
        expect(
          redactCommandSecrets(
            'curl -sS -H "Authorization: Bearer sk-abc" https://x',
          ),
        ).toBe(`curl -sS -H "Authorization:${MASK}" https://x`);
      });

      it("masks a single-quoted header argument", () => {
        expect(
          redactCommandSecrets(
            "curl --header 'Authorization: Bearer sk-abc' https://x",
          ),
        ).toBe(`curl --header 'Authorization:${MASK}' https://x`);
      });

      it("masks a header argument concatenated onto its flag", () => {
        expect(
          redactCommandSecrets(
            'curl -H"Authorization: Bearer sk-abc" https://x',
          ),
        ).toBe(`curl -H"Authorization:${MASK}" https://x`);
      });

      it("masks a header whose value is an expansion, keeping the quoting balanced", () => {
        expect(
          redactCommandSecrets('curl -H "Authorization: "$TOKEN https://x'),
        ).toBe(`curl -H "Authorization:${MASK}" https://x`);
      });

      it("masks an unquoted header argument", () => {
        expect(redactCommandSecrets("curl -H X-Api-Key:sk-abc https://x")).toBe(
          `curl -H X-Api-Key:${MASK} https://x`,
        );
      });

      it("closes the quote the mask swallowed, not the one the argument opens with", () => {
        // The field name can straddle a quote boundary, so the argument's first
        // character is not always the quote that is open where the mask begins.
        expect(
          redactCommandSecrets('curl -H Auth"orization: "$TOKEN https://x'),
        ).toBe(`curl -H Auth"orization:${MASK}" https://x`);
      });

      it("leaves a header field that binds no credential", () => {
        expect(
          redactCommandSecrets(
            'curl -H "Content-Type: application/json" https://x',
          ),
        ).toBe('curl -H "Content-Type: application/json" https://x');
      });

      it("leaves a camel-cased name, which is no HTTP field name", () => {
        expect(
          redactCommandSecrets('grep -n "legalDirectionalKeys: readonly" x.ts'),
        ).toBe('grep -n "legalDirectionalKeys: readonly" x.ts');
      });
    });

    describe("values no name is bound to", () => {
      it("leaves a secret typed as a search pattern", () => {
        expect(redactCommandSecrets('grep -r "sk-ant-oat01-abc" .')).toBe(
          'grep -r "sk-ant-oat01-abc" .',
        );
      });

      it("leaves an assignment inside another language's source", () => {
        const command = 'python3 -c "print(sorted(d, key=lambda x: x[1]))"';

        expect(redactCommandSecrets(command)).toBe(command);
      });

      it("leaves a flag-separated value", () => {
        expect(redactCommandSecrets("sort --key 2 f.txt")).toBe(
          "sort --key 2 f.txt",
        );
      });
    });

    describe("several secrets in one command", () => {
      it("masks every one, left to right", () => {
        expect(
          redactCommandSecrets(
            'KEY=sk-one curl -H "Authorization: Bearer sk-two" && TOKEN=sk-three deploy',
          ),
        ).toBe(
          `KEY=${MASK} curl -H "Authorization:${MASK}" && TOKEN=${MASK} deploy`,
        );
      });

      it("masks an enclosing span once rather than nesting a second mask inside it", () => {
        expect(
          redactCommandSecrets('KEY="Authorization: Bearer x" deploy'),
        ).toBe(`KEY=${MASK} deploy`);
      });
    });

    describe("a secret inside an inline-shell payload", () => {
      it.each([
        [
          "a single-quoted bash -c payload",
          `bash -c 'TOKEN=sk-secret deploy'`,
          `bash -c 'TOKEN=${MASK} deploy'`,
        ],
        [
          "a double-quoted sh -c payload",
          `sh -c "API_KEY=sk-x curl https://x"`,
          `sh -c "API_KEY=${MASK} curl https://x"`,
        ],
        [
          "an eval payload, which takes no flag",
          `eval "TOKEN=sk-secret deploy"`,
          `eval "TOKEN=${MASK} deploy"`,
        ],
        [
          "a payload whose value is an expansion",
          `bash -c "API_KEY=$SECRET deploy"`,
          `bash -c "API_KEY=${MASK} deploy"`,
        ],
        [
          "a -c cluster carrying other short flags",
          `bash -ec 'export OPENROUTER_KEY="sk-y"'`,
          `bash -ec 'export OPENROUTER_KEY=${MASK}'`,
        ],
        [
          "a path-qualified shell",
          `/bin/bash -c 'MY_KEY=abc deploy'`,
          `/bin/bash -c 'MY_KEY=${MASK} deploy'`,
        ],
        [
          "a payload behind a leading redirect",
          `>/dev/null bash -c 'TOKEN=sk-secret deploy'`,
          `>/dev/null bash -c 'TOKEN=${MASK} deploy'`,
        ],
        [
          "a payload after a redirect between the shell and its flag",
          `bash 2>/dev/null -c 'TOKEN=sk-secret deploy'`,
          `bash 2>/dev/null -c 'TOKEN=${MASK} deploy'`,
        ],
        [
          "a payload after a heredoc between the shell and its flag",
          `bash <<EOF -c 'TOKEN=sk-secret deploy'\nbody\nEOF`,
          `bash <<EOF -c 'TOKEN=${MASK} deploy'\nbody\nEOF`,
        ],
        [
          "an unquoted payload, which the word rule already reached",
          `bash -c TOKEN=sk-x`,
          `bash -c TOKEN=${MASK}`,
        ],
      ])("masks %s", (_label, command, expected) => {
        expect(redactCommandSecrets(command)).toBe(expected);
      });

      it("masks a payload nested inside another payload", () => {
        expect(
          redactCommandSecrets(`bash -c 'bash -c "TOKEN=sk-inner x"'`),
        ).toBe(`bash -c 'bash -c "TOKEN=${MASK} x"'`);
      });

      it("masks the outer assignment and the payload's own, as two spans", () => {
        expect(
          redactCommandSecrets(`TOKEN=sk-outer bash -c 'API_KEY=sk-inner x'`),
        ).toBe(`TOKEN=${MASK} bash -c 'API_KEY=${MASK} x'`);
      });

      it("masks every payload of a chained command", () => {
        expect(
          redactCommandSecrets(`bash -c 'echo hi' && bash -c 'TOKEN=sk2 x'`),
        ).toBe(`bash -c 'echo hi' && bash -c 'TOKEN=${MASK} x'`);
      });

      it("keeps a masked header inside a payload quote-balanced", () => {
        expect(
          redactCommandSecrets(
            `bash -c 'curl -H "Authorization: Bearer sk-z" https://x'`,
          ),
        ).toBe(`bash -c 'curl -H "Authorization:${MASK}" https://x'`);
      });

      it.each([
        [
          "an interpreter payload, which is another language",
          `bash -c 'python3 -c "print(sorted(d, key=lambda x: x[1]))"'`,
        ],
        ["a long option inside a payload", `bash -c 'sort --key 2 f.txt'`],
        [
          "a search pattern inside a payload",
          `bash -c 'grep -r "sk-ant-oat01-abc" .'`,
        ],
        [
          "a header field that binds no credential",
          `bash -c 'curl -H "Content-Type: application/json" https://x'`,
        ],
        ["a shell that runs no inline program", `bash --help`],
        ["a vacant payload position", `bash -c`],
        ["a bare eval", `eval`],
      ])("leaves %s", (_label, command) => {
        expect(redactCommandSecrets(command)).toBe(command);
      });

      it.each([
        [
          "a payload behind sudo",
          `sudo bash -c 'TOKEN=sk-secret deploy'`,
          `sudo bash -c 'TOKEN=${MASK} deploy'`,
        ],
        [
          "a payload behind xargs",
          `xargs -I{} sh -c 'TOKEN=sk-secret deploy'`,
          `xargs -I{} sh -c 'TOKEN=${MASK} deploy'`,
        ],
        [
          "a payload behind timeout, which takes a leading operand",
          `timeout 5 bash -c 'TOKEN=sk-secret deploy'`,
          `timeout 5 bash -c 'TOKEN=${MASK} deploy'`,
        ],
        [
          "a payload behind two wrapper layers",
          `sudo timeout 5 bash -c 'TOKEN=sk-secret deploy'`,
          `sudo timeout 5 bash -c 'TOKEN=${MASK} deploy'`,
        ],
      ])("masks %s", (_label, command, expected) => {
        expect(redactCommandSecrets(command)).toBe(expected);
      });

      it("masks an ANSI-C quoted payload, whose slice skips the dollar too", () => {
        expect(redactCommandSecrets(`bash -c $'TOKEN=sk-x deploy'`)).toBe(
          `bash -c $'TOKEN=${MASK} deploy'`,
        );
      });

      describe("a payload assembled from several quoted segments", () => {
        // A `concatenation` payload's shell value is stitched together across
        // quote boundaries, so no constant offset maps a span in the value back
        // onto the command. The value still decides *whether* a secret is bound
        // there, and the whole argument is masked when one is — coarser than a
        // sliceable payload, and the alternative is writing the secret.
        it("masks the whole argument when a segment boundary splits the value", () => {
          expect(redactCommandSecrets(`bash -c 'TOKEN=sk-a'"bc"`)).toBe(
            `bash -c ${MASK}`,
          );
        });

        it("masks the whole argument when a variable is interpolated into it", () => {
          expect(redactCommandSecrets(`bash -c 'TOKEN='"$SECRET"`)).toBe(
            `bash -c ${MASK}`,
          );
        });

        it("leaves a segmented payload that binds no credential", () => {
          const command = `bash -c 'echo '"$GREETING"`;

          expect(redactCommandSecrets(command)).toBe(command);
        });
      });

      it("leaves a heredoc body, which is data rather than shell", () => {
        const command = `cat > .env <<'EOF'\nAPI_KEY=sk-secret\nEOF`;

        expect(redactCommandSecrets(command)).toBe(command);
      });
    });

    describe("commands with nothing to mask", () => {
      it("returns an ordinary command unchanged", () => {
        expect(redactCommandSecrets("git status --short")).toBe(
          "git status --short",
        );
      });

      it("returns an empty command unchanged", () => {
        expect(redactCommandSecrets("")).toBe("");
      });

      it("masks what a recovering parse still resolved", () => {
        expect(redactCommandSecrets("KEY=sk-abc && echo )")).toBe(
          `KEY=${MASK} && echo )`,
        );
      });
    });
  });

  describe("before the parser is warm", () => {
    beforeEach(() => {
      resetWarmBashParser();
    });

    it("returns the command unchanged rather than raising", () => {
      expect(redactCommandSecrets('KEY="sk-abc123" curl https://x')).toBe(
        'KEY="sk-abc123" curl https://x',
      );
    });
  });
});

describe("maskCommandFields", () => {
  beforeEach(async () => {
    resetWarmBashParser();
    await warmBashParser();
  });
  afterEach(() => {
    resetWarmBashParser();
  });

  it("masks the command-bearing keys and leaves every other value alone", () => {
    expect(
      maskCommandFields({
        toolName: "bash",
        command: 'KEY="sk-abc" curl https://x',
        executedUnit: "TOKEN=sk-def deploy",
        matchedSpelling: 'KEY="sk-abc" curl /tmp/x',
        matchedPattern: "curl *",
      }),
    ).toEqual({
      toolName: "bash",
      command: `KEY=${MASK} curl https://x`,
      executedUnit: `TOKEN=${MASK} deploy`,
      matchedSpelling: `KEY=${MASK} curl /tmp/x`,
      matchedPattern: "curl *",
    });
  });

  it("masks every other asking unit of a bash chain", () => {
    expect(
      maskCommandFields({
        otherAskingUnits: ["API_KEY=sk-abc curl https://x", "npm test"],
      }),
    ).toEqual({
      otherAskingUnits: [`API_KEY=${MASK} curl https://x`, "npm test"],
    });
  });

  it("reaches a command nested inside another record", () => {
    expect(
      maskCommandFields({
        forwarding: { requests: [{ command: "KEY=sk-abc deploy" }] },
      }),
    ).toEqual({
      forwarding: { requests: [{ command: `KEY=${MASK} deploy` }] },
    });
  });

  it("leaves a non-string command value as it found it", () => {
    expect(maskCommandFields({ command: null })).toEqual({ command: null });
  });
});
