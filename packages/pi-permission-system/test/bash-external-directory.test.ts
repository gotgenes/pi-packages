import { afterEach, describe, expect, test, vi } from "vitest";

// Mock node:os so tilde-expansion is deterministic across platforms.
vi.mock("node:os", () => {
  const homedir = vi.fn(() => "/mock/home");
  return {
    homedir,
    default: { homedir },
  };
});

// Mock node:fs with an identity realpathSync so canonicalizePath
// (used by BashProgram.externalPaths) leaves test paths unchanged and
// existing expected-value literals remain accurate across platforms.
vi.mock("node:fs", () => ({
  realpathSync: (p: string) => p,
  default: { realpathSync: (p: string) => p },
}));

import { extractExternalPathsFromBashCommand as extractWithNormalizer } from "#src/handlers/gates/bash-path-extractor";
import { pathFlavorForPlatform, win32PathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path-normalizer";
import { renderPolicyDenial } from "#src/presentation/agent-renderer";
import type { ExternalPathDisclosure } from "#src/presentation/path-ask-payload";
import { buildBashExternalDirectoryAskPayload } from "#src/presentation/path-ask-payload";

afterEach(() => {
  vi.restoreAllMocks();
});

// The production facade now takes a PathNormalizer (platform + cwd baked in);
// this wrapper preserves the (command, cwd) call shape the suite uses
// throughout so the projection-correctness assertions stay unchanged.
function extractExternalPathsFromBashCommand(
  command: string,
  cwd: string,
): Promise<string[]> {
  return extractWithNormalizer(
    command,
    new PathNormalizer(pathFlavorForPlatform(process.platform), cwd),
  );
}

describe("extractExternalPathsFromBashCommand", () => {
  const cwd = "/projects/my-app";

  describe("absolute paths", () => {
    test("detects absolute path outside CWD", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "cat /etc/hosts",
        cwd,
      );
      expect(result).toContain("/etc/hosts");
    });

    test("detects multiple absolute paths outside CWD", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "diff /etc/hosts /var/log/syslog",
        cwd,
      );
      expect(result).toContain("/etc/hosts");
      expect(result).toContain("/var/log/syslog");
    });

    test("does not flag absolute path within CWD", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "cat /projects/my-app/src/index.ts",
        cwd,
      );
      expect(result).toHaveLength(0);
    });
  });

  // The reported bypass (#821): a shell glob is expanded by the shell, so a
  // path-shaped token carrying one names a real access. It is gated by its
  // literal text, exactly as `?` and `*` tokens already were.
  describe("glob-bearing paths (#821)", () => {
    test("detects a bracket glob in an absolute path", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "cat /etc/[p]asswd",
        cwd,
      );
      expect(result).toEqual(["/etc/[p]asswd"]);
    });

    test("detects a bracket glob inside a directory name", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "ls /et[c]/pa*",
        cwd,
      );
      expect(result).toEqual(["/et[c]/pa*"]);
    });

    test("detects a dot-star glob in an absolute path", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "rm -rf /tmp/tmp.*",
        cwd,
      );
      expect(result).toEqual(["/tmp/tmp.*"]);
    });

    test("detects a bracket glob in a home-relative path", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "cat ~/.ssh/[i]d_rsa",
        cwd,
      );
      expect(result).toEqual(["/mock/home/.ssh/[i]d_rsa"]);
    });

    test("does not flag a glob resolving within CWD", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "cat /projects/my-app/src/[i]ndex.ts",
        cwd,
      );
      expect(result).toHaveLength(0);
    });
  });

  describe("home-relative paths", () => {
    test("detects ~/path outside CWD", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "cat ~/documents/secret.txt",
        cwd,
      );
      expect(result).toContain("/mock/home/documents/secret.txt");
    });

    test("does not flag ~/path that resolves within CWD", async () => {
      // CWD is under /mock/home for this test
      const result = await extractExternalPathsFromBashCommand(
        "cat ~/myproject/file.ts",
        "/mock/home/myproject",
      );
      expect(result).toHaveLength(0);
    });
  });

  describe("operands a statement names directly (#839)", () => {
    test("detects a for loop's word-list operand outside CWD", async () => {
      // The body carries only `$f`, which ADR 0009 declines to resolve, so the
      // word list is the sole place the literal appears.
      const result = await extractExternalPathsFromBashCommand(
        "for f in ~/other/secret; do cat $f; done",
        cwd,
      );
      expect(result).toEqual(["/mock/home/other/secret"]);
    });

    test("detects a select statement's word-list operand outside CWD", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "select f in /etc/shadow; do echo $f; done",
        cwd,
      );
      expect(result).toEqual(["/etc/shadow"]);
    });

    test("does not flag a word-list operand that stays within CWD", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "for f in src/a.ts src/b.ts; do echo $f; done",
        cwd,
      );
      expect(result).toHaveLength(0);
    });
  });

  describe("dot-dot relative paths", () => {
    test("detects ../ path that resolves outside CWD", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "cat ../../other-project/secrets.env",
        cwd,
      );
      expect(result).toContain("/other-project/secrets.env");
    });

    test("does not flag ../ path that stays within CWD", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "cat src/../lib/utils.ts",
        cwd,
      );
      expect(result).toHaveLength(0);
    });
  });

  describe("commands within CWD only", () => {
    test("returns empty for relative paths within CWD", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "cat src/index.ts",
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("returns empty for bare command with no path arguments", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "git status",
        cwd,
      );
      expect(result).toHaveLength(0);
    });
  });

  describe("flags are skipped", () => {
    test("does not treat flags as paths", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "ls -la --color=auto",
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("detects path after flags", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "ls -la /etc/passwd",
        cwd,
      );
      expect(result).toContain("/etc/passwd");
    });
  });

  describe("env assignments are skipped", () => {
    test("does not treat FOO=/bar as a path", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "FOO=/usr/local/bin command",
        cwd,
      );
      expect(result).toHaveLength(0);
    });
  });

  describe("shell metacharacters split correctly", () => {
    test("detects path after pipe", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "echo hello | tee /tmp/output.txt",
        cwd,
      );
      expect(result).toContain("/tmp/output.txt");
    });

    test("detects path after semicolon", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "echo done; cat /etc/hosts",
        cwd,
      );
      expect(result).toContain("/etc/hosts");
    });

    test("detects path after &&", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "true && cat /etc/hosts",
        cwd,
      );
      expect(result).toContain("/etc/hosts");
    });

    test("detects path in redirect target", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "echo hello > /tmp/out.txt",
        cwd,
      );
      expect(result).toContain("/tmp/out.txt");
    });
  });

  describe("URLs are skipped", () => {
    test("does not treat http:// URL as a path", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "curl http://example.com/path",
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("does not treat https:// URL as a path", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "curl https://example.com/etc/hosts",
        cwd,
      );
      expect(result).toHaveLength(0);
    });
  });

  describe("@scope/package patterns are skipped", () => {
    test("does not treat @scope/package as a path", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "npm install @types/node",
        cwd,
      );
      expect(result).toHaveLength(0);
    });
  });

  describe("quoted strings are ignored", () => {
    test("does not flag path inside double-quoted string", async () => {
      const result = await extractExternalPathsFromBashCommand(
        'git commit -m "fix: update /etc/hosts handler"',
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("does not flag path inside single-quoted string", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "echo 'see /usr/local/docs for info'",
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("still flags unquoted path alongside quoted content", async () => {
      const result = await extractExternalPathsFromBashCommand(
        'cat /etc/hosts && echo "done"',
        cwd,
      );
      expect(result).toContain("/etc/hosts");
    });

    test("does not flag path when adjacent quoted segments form one word", async () => {
      // tree-sitter parses adjacent quoted/unquoted segments as a concatenation node
      // whose resolved text is 'path is /etc/hosts' (one token, not a path candidate).
      const result = await extractExternalPathsFromBashCommand(
        'echo "path is "/etc/hosts""',
        cwd,
      );
      expect(result).toHaveLength(0);
    });
  });

  describe("safe system paths are filtered", () => {
    test("does not flag /dev/null in stderr redirect", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "command 2>/dev/null",
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("does not flag /dev/null as a redirect target", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "echo hello > /dev/null",
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("does not flag /dev/stdin", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "cat /dev/stdin",
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("does not flag /dev/stdout", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "cat /dev/stdout",
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("does not flag /dev/stderr", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "cat /dev/stderr",
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("still flags a real external path alongside /dev/null", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "cat /etc/hosts 2>/dev/null",
        cwd,
      );
      expect(result).toContain("/etc/hosts");
      expect(result).not.toContain("/dev/null");
    });

    test("does not flag /dev/null/subdir (not a safe path)", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "cat /dev/null/subdir",
        cwd,
      );
      expect(result).toContain("/dev/null/subdir");
    });
  });

  describe("bare-slash tokens resolve to external root", () => {
    test("find / scans the whole filesystem → flags root (#583)", async () => {
      const result = await extractExternalPathsFromBashCommand("find /", cwd);
      expect(result).toEqual(["/"]);
    });

    test("find / with search predicates → flags root (#583)", async () => {
      const result = await extractExternalPathsFromBashCommand(
        'find / -path "*/pi-coding-agent/*.d.ts"',
        cwd,
      );
      expect(result).toContain("/");
    });

    test("bare / token → flags root", async () => {
      const result = await extractExternalPathsFromBashCommand("echo /", cwd);
      expect(result).toEqual(["/"]);
    });

    test("bare // token normalizes to root", async () => {
      const result = await extractExternalPathsFromBashCommand("echo //", cwd);
      expect(result).toEqual(["/"]);
    });

    test("bare /// token normalizes to root", async () => {
      const result = await extractExternalPathsFromBashCommand("echo ///", cwd);
      expect(result).toEqual(["/"]);
    });

    test("bare / among other args → flags root once", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "echo // hello",
        cwd,
      );
      expect(result).toEqual(["/"]);
    });

    test("flags root alongside another external path", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "cat /etc/hosts; echo //",
        cwd,
      );
      expect(result).toContain("/etc/hosts");
      expect(result).toContain("/");
      expect(result).toHaveLength(2);
    });
  });

  describe("node -e and multi-line commands", () => {
    test("does not flag path inside single-quoted string in node -e argument", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "node -e \"const p = '/etc/hosts'; console.log(p);\"",
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("does not flag path inside multi-line node -e argument", async () => {
      // Actual newlines inside the double-quoted -e argument.
      const cmd =
        "node -e \"\nimport('x').then(() => {\n  console.log('/etc/hosts');\n});\n\"";
      const result = await extractExternalPathsFromBashCommand(cmd, cwd);
      expect(result).toHaveLength(0);
    });

    test("does not flag path that appears after escaped quote in multi-line node -e argument", async () => {
      // This is the shape of the command that triggered a prompt during dog-fooding.
      // The outer \"...\" arg contains both actual newlines and \\" escape sequences,
      // with /etc/hosts appearing after a \\" boundary.
      const cmd = [
        'node -e "',
        "import('shell-quote').then(({ parse }) => {",
        "  const cmd = \\\"cat << 'EOF'\\n/etc/hosts\\nsome content\\nEOF\\\";",
        "  console.log(JSON.stringify(parse(cmd)));",
        "});",
        '"',
      ].join("\n");
      const result = await extractExternalPathsFromBashCommand(cmd, cwd);
      expect(result).toHaveLength(0);
    });
  });

  describe("tokenizer edge cases", () => {
    test("does not flag path inside string when escaped quote is present", async () => {
      // tree-sitter correctly parses the escaped quote and keeps the path inside the string.
      const result = await extractExternalPathsFromBashCommand(
        'git commit -m "fix: update \\"the /etc/hosts\\" handler"',
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("does not flag path appearing only in a shell comment", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "echo hello # /etc/shadow",
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("flags real path before comment but not path inside comment", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "cat /etc/hosts # see also /etc/shadow",
        cwd,
      );
      expect(result).toContain("/etc/hosts");
      expect(result).not.toContain("/etc/shadow");
      expect(result).toHaveLength(1);
    });
  });

  describe("heredoc handling", () => {
    test("does not flag path inside single-quoted heredoc delimiter", async () => {
      const cmd = "cat << 'EOF'\n/etc/hosts\nEOF";
      const result = await extractExternalPathsFromBashCommand(cmd, cwd);
      expect(result).toHaveLength(0);
    });

    test("does not flag path inside double-quoted heredoc delimiter", async () => {
      const cmd = 'cat << "EOF"\n/etc/hosts\nEOF';
      const result = await extractExternalPathsFromBashCommand(cmd, cwd);
      expect(result).toHaveLength(0);
    });

    test("does not flag path inside unquoted heredoc delimiter", async () => {
      const cmd = "cat << EOF\n/etc/hosts\nEOF";
      const result = await extractExternalPathsFromBashCommand(cmd, cwd);
      expect(result).toHaveLength(0);
    });

    test("flags real path alongside heredoc but not heredoc content", async () => {
      const cmd = "cat /etc/hosts << 'EOF'\nsome content\nEOF";
      const result = await extractExternalPathsFromBashCommand(cmd, cwd);
      expect(result).toContain("/etc/hosts");
      expect(result).toHaveLength(1);
    });

    test("does not flag path inside indented heredoc (<<-)", async () => {
      const cmd = "cat <<- 'EOF'\n\t/etc/hosts\nEOF";
      const result = await extractExternalPathsFromBashCommand(cmd, cwd);
      expect(result).toHaveLength(0);
    });
  });

  describe("defense-in-depth guards with tree-sitter", () => {
    test("env assignment is a variable_assignment node, not a command argument", async () => {
      // tree-sitter parses FOO=/usr/local/bin as a variable_assignment node.
      // The walker skips variable_assignment, so the env-assignment guard in
      // classifyTokenAsPathCandidate is defense-in-depth.
      const result = await extractExternalPathsFromBashCommand(
        "FOO=/usr/local/bin command",
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("URL is a word argument, classifyTokenAsPathCandidate rejects it", async () => {
      // tree-sitter emits the URL as a plain word argument.
      // classifyTokenAsPathCandidate's URL pattern must still reject it.
      const result = await extractExternalPathsFromBashCommand(
        "curl https://example.com/etc/hosts",
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("flag arguments are word nodes, classifyTokenAsPathCandidate rejects them", async () => {
      // tree-sitter emits '-la' as a word argument.
      // classifyTokenAsPathCandidate's flag check must still reject it.
      const result = await extractExternalPathsFromBashCommand(
        "ls -la --color=auto",
        cwd,
      );
      expect(result).toHaveLength(0);
    });
  });

  describe("command substitution", () => {
    test("detects path inside command substitution", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "echo $(cat /etc/hosts)",
        cwd,
      );
      expect(result).toContain("/etc/hosts");
    });

    test("detects path inside nested command substitution", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "echo $(echo $(cat /etc/hosts))",
        cwd,
      );
      expect(result).toContain("/etc/hosts");
    });

    test("does not flag command substitution inside single-quoted heredoc", async () => {
      // Single-quoted heredoc delimiter prevents expansion — content is literal.
      const cmd = "cat << 'EOF'\n$(cat /etc/hosts)\nEOF";
      const result = await extractExternalPathsFromBashCommand(cmd, cwd);
      expect(result).toHaveLength(0);
    });

    test("detects path in subshell", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "(cat /etc/hosts)",
        cwd,
      );
      expect(result).toContain("/etc/hosts");
    });
  });

  describe("redirect targets", () => {
    test("detects path in output redirect", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "echo hello > /tmp/out.txt",
        cwd,
      );
      expect(result).toContain("/tmp/out.txt");
    });

    test("detects path in append redirect", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "echo hello >> /tmp/out.txt",
        cwd,
      );
      expect(result).toContain("/tmp/out.txt");
    });

    test("detects path in input redirect", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "sort < /etc/hosts",
        cwd,
      );
      expect(result).toContain("/etc/hosts");
    });

    test("detects path in stderr redirect", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "command 2>/tmp/errors.log",
        cwd,
      );
      expect(result).toContain("/tmp/errors.log");
    });
  });

  describe("deduplication", () => {
    test("returns deduplicated paths", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "cat /etc/hosts; grep foo /etc/hosts",
        cwd,
      );
      const etcHostsCount = result.filter((p) => p === "/etc/hosts").length;
      expect(etcHostsCount).toBe(1);
    });
  });

  describe("command-aware extraction", () => {
    describe("sed", () => {
      test("issue #91 reproducer: sed address pattern is not flagged", async () => {
        const cmd = `sed -i '' '/source: "tool",/{/origin:/!s/source: "tool",/source: "tool",\n      origin: "builtin",/;}' tests/tool-input-preview.test.ts`;
        const result = await extractExternalPathsFromBashCommand(cmd, cwd);
        expect(result).toHaveLength(0);
      });

      test("sed script is skipped but file argument is extracted", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "sed 's/foo/bar/g' /etc/hosts",
          cwd,
        );
        expect(result).toContain("/etc/hosts");
      });

      test("sed address pattern starting with / is skipped", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "sed '/pattern/d' /etc/hosts",
          cwd,
        );
        expect(result).toContain("/etc/hosts");
        expect(result).toHaveLength(1);
      });

      test("sed with only in-CWD file returns empty", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "sed 's/foo/bar/' src/index.ts",
          cwd,
        );
        expect(result).toHaveLength(0);
      });

      test("sed -e: script consumed by flag, file extracted", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "sed -e 's/foo/bar/' /etc/hosts",
          cwd,
        );
        expect(result).toContain("/etc/hosts");
        expect(result).toHaveLength(1);
      });

      test("sed -n: regular flag does not consume next arg", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "sed -n '/pattern/p' /etc/hosts",
          cwd,
        );
        expect(result).toContain("/etc/hosts");
        expect(result).toHaveLength(1);
      });

      test("sed -f: script file is extracted as path", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "sed -f /etc/sed-script.sed input.txt",
          cwd,
        );
        expect(result).toContain("/etc/sed-script.sed");
        expect(result).toHaveLength(1);
      });

      test("sed -i '': extension consumed, script skipped, file extracted", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "sed -i '' 's/foo/bar/' /etc/hosts",
          cwd,
        );
        expect(result).toContain("/etc/hosts");
        expect(result).toHaveLength(1);
      });
    });

    describe("grep", () => {
      test("grep: pattern skipped, file extracted", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "grep '/etc/' /var/log/syslog",
          cwd,
        );
        expect(result).toContain("/var/log/syslog");
        expect(result).toHaveLength(1);
      });

      test("grep -e: pattern consumed by flag, file extracted", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "grep -e '/etc/' /var/log/syslog",
          cwd,
        );
        expect(result).toContain("/var/log/syslog");
        expect(result).toHaveLength(1);
      });
    });

    describe("awk", () => {
      test("awk: program skipped, file extracted", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "awk '{print}' /etc/hosts",
          cwd,
        );
        expect(result).toContain("/etc/hosts");
        expect(result).toHaveLength(1);
      });

      test("awk -F: separator consumed, program skipped, file extracted", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "awk -F: '{print $1}' /etc/passwd",
          cwd,
        );
        expect(result).toContain("/etc/passwd");
        expect(result).toHaveLength(1);
      });
    });

    describe("rg", () => {
      test("rg: pattern skipped, path extracted", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "rg '/usr/local' /etc/profile.d/",
          cwd,
        );
        expect(result).toContain("/etc/profile.d");
        expect(result).toHaveLength(1);
      });

      test("rg -e: pattern consumed by flag, path extracted", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "rg -e '/usr/local' /etc/profile.d/",
          cwd,
        );
        expect(result).toContain("/etc/profile.d");
        expect(result).toHaveLength(1);
      });
    });

    describe("sd", () => {
      test("sd: both pattern positionals skipped, file extracted", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "sd '/usr/local/bin' '/opt/bin' /etc/profile",
          cwd,
        );
        expect(result).toContain("/etc/profile");
        expect(result).toHaveLength(1);
      });

      test("sd with only in-CWD file returns empty", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "sd 'foo' 'bar' src/index.ts",
          cwd,
        );
        expect(result).toHaveLength(0);
      });
    });

    describe("unknown commands", () => {
      test("unknown command: all args go through generic extraction", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "some-tool /etc/hosts",
          cwd,
        );
        expect(result).toContain("/etc/hosts");
      });
    });

    describe("edge cases", () => {
      test("full-path command invocation: /usr/bin/sed", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "/usr/bin/sed 's/foo/bar/' /etc/hosts",
          cwd,
        );
        expect(result).toContain("/etc/hosts");
        expect(result).toHaveLength(1);
      });

      test("-- end-of-flags: all remaining args are positional files", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "grep -- '/etc/' /var/log/syslog",
          cwd,
        );
        // After --, '/etc/' is the pattern positional, /var/log/syslog is a file
        expect(result).toContain("/var/log/syslog");
        expect(result).toHaveLength(1);
      });

      test("redirect target still extracted for pattern-first command", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "sed 's/foo/bar/' input.txt > /tmp/output.txt",
          cwd,
        );
        expect(result).toContain("/tmp/output.txt");
      });

      test("pipeline: sed piped to cat with external path", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "sed 's/foo/bar/' src/file.ts | cat /etc/hosts",
          cwd,
        );
        expect(result).toContain("/etc/hosts");
        expect(result).toHaveLength(1);
      });

      test("command substitution inside pattern-first command", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "grep 'pattern' $(cat /etc/file-list)",
          cwd,
        );
        // /etc/file-list is an argument to cat inside command substitution
        expect(result).toContain("/etc/file-list");
      });
    });

    describe("sed -i, whose argument is separate on BSD and glued on GNU (#823)", () => {
      test("GNU spelling: /etc/hosts is detected", async () => {
        // GNU sed reads -i as a flag whose suffix must be attached, so
        // 's/foo/bar/' is the inline script and /etc/hosts is the input file.
        // Treating -i as unconditionally arg-consuming (correct only for BSD
        // `sed -i ''`) consumed the script as the suffix and left /etc/hosts
        // as the first positional, which was skipped as the inline script — a
        // write target that reached no path surface.  The flag now consumes a
        // following argument only when it is empty, which no GNU spelling
        // produces.
        const result = await extractExternalPathsFromBashCommand(
          "sed -i 's/foo/bar/' /etc/hosts",
          cwd,
        );
        expect(result).toEqual(["/etc/hosts"]);
      });

      test("BSD spelling: /etc/hosts is detected", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "sed -i '' 's/foo/bar/' /etc/hosts",
          cwd,
        );
        expect(result).toEqual(["/etc/hosts"]);
      });

      test("glued suffix: /etc/hosts is detected", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "sed -i.bak 's/foo/bar/' /etc/hosts",
          cwd,
        );
        expect(result).toEqual(["/etc/hosts"]);
      });
    });

    describe("flag spellings of a pattern-first command (#823)", () => {
      test("the issue's repro: grep -A 3 root /etc/passwd", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "grep -A 3 root /etc/passwd",
          cwd,
        );
        expect(result).toEqual(["/etc/passwd"]);
      });

      test("an =-embedded pattern flag does not hide the operand", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "grep --regexp=harmless /etc/passwd",
          cwd,
        );
        expect(result).toEqual(["/etc/passwd"]);
      });

      test("an =-embedded pattern flag's value is not a path candidate", async () => {
        const result = await extractExternalPathsFromBashCommand(
          "grep --regexp=/etc/passwd file.txt",
          cwd,
        );
        expect(result).toHaveLength(0);
      });
    });
  });

  // These arguments reach no path surface because `PATTERN_FIRST_COMMANDS`
  // (token-collection.ts) skips a pattern-first command's inline pattern
  // positional — not because the classifier inspects the token's characters.
  // The character-level regex heuristic was deleted in #821; this block pins
  // that the command-aware collector is what keeps these quiet.
  describe("regex arguments of pattern-first commands are not mistaken for paths", () => {
    test("grep -v with //.*pattern is not flagged", async () => {
      const result = await extractExternalPathsFromBashCommand(
        'grep -n "glob" src/foo.ts 2>/dev/null | grep -v "//.*glob\\|globalConfig" | head -30',
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("grep -v with //.*pattern without backslash-pipe is not flagged", async () => {
      const result = await extractExternalPathsFromBashCommand(
        'grep -v "//.*foo" file.txt',
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("grep with backslash-pipe alternation is not flagged", async () => {
      const result = await extractExternalPathsFromBashCommand(
        'grep "foo\\|bar\\|baz" src/file.ts',
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("grep -E with ^/ anchored regex is not flagged", async () => {
      const result = await extractExternalPathsFromBashCommand(
        'grep -E "^/usr/bin" file.txt',
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("sed with regex containing slashes is not flagged", async () => {
      const result = await extractExternalPathsFromBashCommand(
        'sed "s/foo.*/bar/g" file.txt',
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("awk pattern containing an escaped absolute path is not flagged", async () => {
      const result = await extractExternalPathsFromBashCommand(
        'awk "/\\/etc\\/.*/" file.txt',
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("rg pattern shaped like an absolute path is not flagged", async () => {
      const result = await extractExternalPathsFromBashCommand(
        'rg "/etc/.*passwd" -l',
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("real external paths are still detected alongside regex args", async () => {
      const result = await extractExternalPathsFromBashCommand(
        'grep -v "//.*pattern" /etc/hosts',
        cwd,
      );
      expect(result).toContain("/etc/hosts");
    });
  });

  describe("leading cd prefix", () => {
    test("regression: cd to subdir with relative path traversing back into cwd is not flagged", async () => {
      // Real-world command that triggered a false-positive external-directory
      // prompt. The relative path .pi/../../../.pi/skills/... resolves inside
      // cwd when resolved from the cd target, but outside cwd when resolved
      // from cwd itself.
      const result = await extractExternalPathsFromBashCommand(
        'cd /projects/my-app/packages/sub && grep -n "pattern" .pi/../../../.pi/skills/pkg/SKILL.md',
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("cd to subdir: still flags genuinely external paths after cd", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "cd /projects/my-app/packages/sub && cat /etc/hosts",
        cwd,
      );
      expect(result).toContain("/etc/hosts");
    });

    test("cd to subdir: relative path that stays inside cwd is not flagged", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "cd /projects/my-app/src && cat ../README.md",
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("cd to external dir: subsequent paths resolve against the (external) effective directory", async () => {
      // The effective directory is tracked faithfully: `cd /tmp` makes /tmp the
      // base, so the cd target itself is flagged AND ../etc/hosts resolves to
      // /etc/hosts (both outside cwd).
      const result = await extractExternalPathsFromBashCommand(
        "cd /tmp && cat ../etc/hosts",
        cwd,
      );
      expect(result).toContain("/tmp");
      expect(result).toContain("/etc/hosts");
    });

    test("cd with relative target: resolves inside cwd", async () => {
      const result = await extractExternalPathsFromBashCommand(
        'cd packages/sub && grep -n "x" .pi/../../../.pi/skills/pkg/SKILL.md',
        cwd,
      );
      expect(result).toHaveLength(0);
    });

    test("no cd prefix: ../ path that escapes cwd is flagged", async () => {
      // Without the cd prefix, the path resolves against cwd and escapes.
      const result = await extractExternalPathsFromBashCommand(
        'grep -n "pattern" .pi/../../../.pi/skills/pkg/SKILL.md',
        cwd,
      );
      expect(result.length).toBeGreaterThan(0);
    });

    test("sequential fold: a cd that is not the first command still updates the base", async () => {
      // The current-shell `cd` folds even though it is not the first command;
      // ../../outside.txt resolves against /projects/my-app/src → /projects/outside.txt.
      const result = await extractExternalPathsFromBashCommand(
        "echo hello && cd /projects/my-app/src && cat ../../outside.txt",
        cwd,
      );
      expect(result).toContain("/projects/outside.txt");
    });

    test("cd with semicolon separator", async () => {
      const result = await extractExternalPathsFromBashCommand(
        "cd /projects/my-app/src ; cat ../README.md",
        cwd,
      );
      expect(result).toHaveLength(0);
    });
  });
});

describe("the bash external-directory ask payload", () => {
  /** The payload the gate emits for a command that reached outside the tree. */
  function buildAsk(facts: {
    command: string;
    externalPaths: ExternalPathDisclosure[];
    cwd: string;
    agentName?: string;
  }) {
    return buildBashExternalDirectoryAskPayload({
      ...facts,
      agentName: facts.agentName ?? null,
      toolName: "bash",
      surface: "external_directory",
    });
  }

  test("carries the command, the boundary, and the path it reached", () => {
    const payload = buildAsk({
      command: "cat /etc/hosts",
      externalPaths: [{ path: "/etc/hosts" }],
      cwd: "/projects/my-app",
    });

    expect(payload.request.value).toBe("cat /etc/hosts");
    expect(payload.evidence).toEqual([
      { label: "working directory", text: "/projects/my-app", detail: null },
      { label: "external path", text: "/etc/hosts", detail: null },
    ]);
  });

  test("names the requesting agent when one is known", () => {
    expect(
      buildAsk({
        command: "cat /etc/hosts",
        externalPaths: [{ path: "/etc/hosts" }],
        cwd: "/projects/my-app",
        agentName: "my-agent",
      }).request.requester.agentName,
    ).toBe("my-agent");
  });

  test("lists every external path the command reached", () => {
    expect(
      buildAsk({
        command: "diff /etc/hosts /var/log/syslog",
        externalPaths: [{ path: "/etc/hosts" }, { path: "/var/log/syslog" }],
        cwd: "/projects/my-app",
      }).evidence,
    ).toEqual([
      { label: "working directory", text: "/projects/my-app", detail: null },
      { label: "external path", text: "/etc/hosts", detail: null },
      { label: "external path", text: "/var/log/syslog", detail: null },
    ]);
  });

  test("binds a resolved target to the path it belongs to", () => {
    expect(
      buildAsk({
        command: "cat demo-symlink-passwd /etc/hosts",
        externalPaths: [
          { path: "demo-symlink-passwd", resolvedPath: "/etc/passwd" },
          { path: "/etc/hosts" },
        ],
        cwd: "/projects/my-app",
      }).evidence,
    ).toEqual([
      { label: "working directory", text: "/projects/my-app", detail: null },
      {
        label: "external path",
        text: "demo-symlink-passwd",
        detail: "/etc/passwd",
      },
      { label: "external path", text: "/etc/hosts", detail: null },
    ]);
  });
});

describe("Windows drive-letter paths (win32 semantics)", () => {
  const windowsCwd = "C:/projects/app";

  async function extractWin32(command: string): Promise<string[]> {
    return extractWithNormalizer(
      command,
      new PathNormalizer(win32PathFlavor, windowsCwd),
    );
  }

  test("forward-slash drive path outside CWD is flagged", async () => {
    const result = await extractWin32("cat C:/Windows/win.ini");
    expect(result).not.toHaveLength(0);
  });

  test("different drive letter outside CWD is flagged", async () => {
    const result = await extractWin32("cat D:/secrets/password.txt");
    expect(result).not.toHaveLength(0);
  });

  test("drive path inside CWD is not flagged (known base)", async () => {
    const result = await extractWin32("cat C:/projects/app/inside.txt");
    expect(result).toHaveLength(0);
  });

  test("drive path inside CWD is not flagged after non-literal cd (unknown base)", async () => {
    // Before the isRelativeCandidate conversion, the hand-rolled startsWith("/")
    // check treats C:/ as relative on win32, so the unknown-base conservative
    // branch fires and over-flags an inside-CWD drive path.
    // After the conversion (!normalizer.isAbsolute), C:/ is absolute on win32
    // and routes to the resolved branch with its inside-CWD check.
    const result = await extractWin32(
      'cd "$D" && cat C:/projects/app/inside.txt',
    );
    expect(result).toHaveLength(0);
  });
});

describe("Git Bash POSIX device paths (win32 semantics)", () => {
  const windowsCwd = "C:/projects/app";

  async function extractWin32(command: string): Promise<string[]> {
    return extractWithNormalizer(
      command,
      new PathNormalizer(win32PathFlavor, windowsCwd),
    );
  }

  test("a /dev/null redirect target is not flagged", async () => {
    const result = await extractWin32("echo hi > /dev/null");
    expect(result).toHaveLength(0);
  });

  test("all four safe device paths are excluded", async () => {
    const result = await extractWin32(
      "cat /dev/stdin /dev/stdout /dev/stderr /dev/null",
    );
    expect(result).toHaveLength(0);
  });
});

describe("Git Bash MSYS drive mounts (win32 semantics)", () => {
  const windowsCwd = "C:/projects/app";

  async function extractWin32(command: string): Promise<string[]> {
    return extractWithNormalizer(
      command,
      new PathNormalizer(win32PathFlavor, windowsCwd),
    );
  }

  test("an in-cwd drive mount is not flagged", async () => {
    const result = await extractWin32("cat /c/projects/app/inside.txt");
    expect(result).toHaveLength(0);
  });

  test("an out-of-cwd drive mount is flagged as its translated Windows path", async () => {
    const result = await extractWin32("cat /c/Other/secret.txt");
    expect(result).toEqual(["c:\\other\\secret.txt"]);
  });

  test("a different-drive mount is flagged as its translated Windows path", async () => {
    const result = await extractWin32("cat /d/secrets/pw.txt");
    expect(result).toEqual(["d:\\secrets\\pw.txt"]);
  });
});

describe("Git Bash POSIX absolute paths (win32 semantics)", () => {
  const windowsCwd = "C:/projects/app";

  async function extractWin32(command: string): Promise<string[]> {
    return extractWithNormalizer(
      command,
      new PathNormalizer(win32PathFlavor, windowsCwd),
    );
  }

  test("a /tmp path is flagged as typed, not fabricated into C:\\tmp", async () => {
    const result = await extractWin32("ls /tmp");
    expect(result).toEqual(["/tmp"]);
  });

  test("a /usr path is flagged as typed", async () => {
    const result = await extractWin32("cat /usr/bin/tool");
    expect(result).toEqual(["/usr/bin/tool"]);
  });

  test("distinct literal-only POSIX absolutes are not deduplicated together", async () => {
    const result = await extractWin32("cat /tmp/a /tmp/b");
    expect(result).toEqual(["/tmp/a", "/tmp/b"]);
  });
});

describe("the bash external-directory denial the agent sees", () => {
  test("names the escaping paths and the boundary, never the command", () => {
    const result = renderPolicyDenial(
      buildBashExternalDirectoryAskPayload({
        command: "cat /etc/hosts",
        externalPaths: [{ path: "/etc/hosts" }],
        cwd: "/projects/my-app",
        agentName: null,
        toolName: "bash",
        surface: "external_directory",
        matchedPattern: "*",
      }),
      null,
    );
    expect(result).toBe(
      "[pi-permission-system] Denied by policy: 'external_directory' for tool 'bash' for path '/etc/hosts' (rule '*'): outside working directory '/projects/my-app'.",
    );
  });
});
