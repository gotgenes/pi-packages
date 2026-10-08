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
import { pathFlavorForPlatform, win32PathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path/path-normalizer";
import { createTmpFixture } from "#test/helpers/tmp-fixture";

describe("BashProgram", () => {
  describe("externalAccesses", () => {
    const cwd = "/projects/my-app";
    const normalizer = new PathNormalizer(
      pathFlavorForPlatform(process.platform),
      cwd,
    );

    beforeEach(() => {
      realpathSync.mockReset();
      realpathSync.mockImplementation((p: string) => p);
    });

    /** The external paths a command reaches, in their as-typed form. */
    async function externalValuesOf(
      command: string,
      at: PathNormalizer = normalizer,
    ): Promise<string[]> {
      return (await BashProgram.parse(command, at))
        .externalAccesses()
        .map(({ path }) => path.value());
    }

    it("returns absolute paths resolving outside cwd", async () => {
      const program = await BashProgram.parse("cat /etc/hosts", normalizer);
      // Subset matcher: the path is normalized before comparison.
      expect(
        program.externalAccesses().map(({ path }) => path.value()),
      ).toContain("/etc/hosts");
    });

    describe("a redirect behind an execution modifier", () => {
      // The modifier exemption drops the floor's redirect refusal because the
      // destination is projected here whatever the floor decides (#963).
      it.each(["timeout 5 pnpm test > /tmp/x", "pnpm test > /tmp/x"])(
        "projects the destination of %s as a syntax-proven write",
        async (command) => {
          const program = await BashProgram.parse(command, normalizer);
          expect(
            program
              .externalAccesses()
              .map(({ path, effect }) => ({ path: path.value(), effect })),
          ).toEqual([
            { path: "/tmp/x", effect: { effect: "write", source: "syntax" } },
          ]);
        },
      );
    });

    describe("the rest of a heredoc's line", () => {
      it("projects a tail redirect's target with its operator's effect", async () => {
        const program = await BashProgram.parse(
          "cat <<EOF > /tmp/o\nb\nEOF",
          normalizer,
        );
        expect(
          program
            .externalAccesses()
            .map(({ path, effect }) => ({ path: path.value(), effect })),
        ).toEqual([
          { path: "/tmp/o", effect: { effect: "write", source: "syntax" } },
        ]);
      });

      it("folds a current-shell cd in a list after a piped tail", async () => {
        // The grammar nests `true && cd /outside && …` inside the pipe; bash
        // runs the `cd` in the current shell, as the `< in` spelling groups it.
        const program = await BashProgram.parse(
          "cat <<EOF | true && cd /outside && cat ../secret\nb\nEOF",
          normalizer,
        );
        // Unfolded, `../secret` would resolve against the cwd instead:
        // `/projects/secret`.
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toEqual(["/outside", "/secret"]);
      });
    });

    describe("the words after a heredoc", () => {
      it("projects a word as the command's own operand", async () => {
        const program = await BashProgram.parse(
          "cat <<EOF ~/x/in\nb\nEOF",
          normalizer,
        );
        expect(
          program
            .externalAccesses()
            .map(({ path, effect }) => ({ path: path.value(), effect })),
        ).toEqual([
          {
            path: join(homedir(), "x/in"),
            effect: { effect: "read", source: "core" },
          },
        ]);
      });
    });

    describe("a redirect's target is projected by its role (#609)", () => {
      /** Each external access's display path and attributed effect. */
      async function externalsOf(command: string) {
        const program = await BashProgram.parse(command, normalizer);
        return program.externalAccesses().map(({ path, effect }) => ({
          path: path.value(),
          effect: effect.effect,
        }));
      }

      it("flags a bare output target after a non-literal cd", async () => {
        expect(await externalsOf('cd "$D" && echo hi > out.txt')).toEqual([
          { path: join(cwd, "out.txt"), effect: "write" },
        ]);
      });

      it("flags a bare input target after a non-literal cd", async () => {
        expect(await externalsOf('cd "$D" && sort < in.txt')).toEqual([
          { path: join(cwd, "in.txt"), effect: "read" },
        ]);
      });

      it("leaves a bare target inside a known working directory alone", async () => {
        expect(await externalsOf("echo hi > out.txt")).toEqual([]);
      });
    });

    describe("a program that reassigns HOME or PWD", () => {
      /** Each external access's display path and attributed effect. */
      async function externalsOf(command: string) {
        const program = await BashProgram.parse(command, normalizer);
        return program.externalAccesses().map(({ path, effect }) => ({
          path: path.value(),
          effect,
        }));
      }

      it.each([
        ['HOME=/etc; cat "$HOME/shadow"', "an assignment"],
        ['export HOME=/etc; cat "$HOME/shadow"', "a declaration"],
        ['unset HOME; cat "$HOME/shadow"', "unset, which empties it"],
        ['cat "$HOME/shadow"; HOME=/etc', "an assignment after the reference"],
        ['PWD=/; cat "$PWD/../shadow"', "an assignment to PWD"],
        [
          "HOME=/etc; cat ~/shadow",
          "a tilde, which bash 3.2 expands from HOME",
        ],
        [
          'read HOME; cat "$HOME/shadow"',
          "read, which binds the name it is given",
        ],
        [
          'source f; cat "$HOME/shadow"',
          "source, which runs code the walk never sees",
        ],
      ])(
        "no longer projects %s under its startup value (%s)",
        async (command) => {
          expect(await externalsOf(command)).toEqual([]);
        },
      );

      it("counts an assignment only a salvaged region holds", async () => {
        // The grammar cannot parse a heredoc followed by `; …` on its line, so
        // the assignment is recovered only by the salvage's re-parse.
        expect(
          await externalsOf(
            'cat <<EOF ; HOME=/etc\nx\nEOF\ncat "$HOME/shadow"',
          ),
        ).toEqual([]);
      });

      it("projects a for loop's word list but not the loop variable's reference", async () => {
        expect(
          await externalsOf('for HOME in /etc; do cat "$HOME/shadow"; done'),
        ).toEqual([
          {
            path: "/etc",
            effect: { effect: "unproven", source: "unproven" },
          },
        ]);
      });

      it("withdraws find's read claim for a reassigned $HOME that may spell an option", async () => {
        expect(await externalsOf('HOME=-delete; find /etc "$HOME"')).toEqual(
          await externalsOf('find /etc "$X"'),
        );
      });

      it("withdraws find's read claim for a tilde once HOME is reassigned", async () => {
        expect(await externalsOf("HOME=-delete; find /etc ~")).toEqual(
          await externalsOf('find /etc "$X"'),
        );
      });

      describe("an inherited HOME that begins with a dash", () => {
        beforeEach(() => {
          vi.stubEnv("HOME", "-delete");
        });
        afterEach(() => {
          vi.unstubAllEnvs();
        });

        it("withdraws find's read claim for a tilde", async () => {
          expect(
            (await externalsOf("find /etc ~")).map(({ effect }) => effect),
          ).toEqual([{ effect: "unproven", source: "retracted" }]);
        });
      });

      describe("a program that leaves both alone", () => {
        it.each([
          ['cat "$HOME/shadow"', join(homedir(), "shadow")],
          ['env -i HOME="$HOME" cat "$HOME/shadow"', join(homedir(), "shadow")],
          ['cat "$PWD/../shadow"', "/projects/shadow"],
          ["grep HOME ~/.bashrc", join(homedir(), ".bashrc")],
        ])("still projects %s", async (command, expected) => {
          expect((await externalsOf(command)).map(({ path }) => path)).toEqual([
            expected,
          ]);
        });

        it("still proves sed's read of a tilde path", async () => {
          expect(await externalsOf("sed -n p ~/x")).toEqual([
            {
              path: join(homedir(), "x"),
              effect: { effect: "read", source: "core" },
            },
          ]);
        });

        it("still proves find's read of $HOME", async () => {
          expect(await externalsOf('find "$HOME/other"')).toEqual([
            {
              path: join(homedir(), "other"),
              effect: { effect: "read", source: "core" },
            },
          ]);
        });
      });
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

    describe("operands of a command hosted in a quoted argument (#945)", () => {
      it("flags the operand of a substitution in a consumed flag argument", async () => {
        const program = await BashProgram.parse(
          'sed -e "$(cat /etc/shadow)" f.txt',
          normalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toEqual(["/etc/shadow"]);
      });

      it("flags the operand of a substitution in a generic command's argument", async () => {
        const program = await BashProgram.parse(
          'echo "$(cat /etc/shadow)"',
          normalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toEqual(["/etc/shadow"]);
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

      it("projects a bracket glob in a home-relative path", async () => {
        expect(await externalValuesOf("cat ~/.ssh/[i]d_rsa")).toEqual([
          join(homedir(), ".ssh/[i]d_rsa"),
        ]);
      });

      it("leaves a glob resolving within cwd alone", async () => {
        expect(
          await externalValuesOf("cat /projects/my-app/src/[i]ndex.ts"),
        ).toEqual([]);
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

      it("flags a symlink whose name carries an in-segment ..", async () => {
        const outsideRoot = canonicalDir("pi-perm-ext-range-");
        const secret = tmp.file(outsideRoot, "secret", "s");
        tmp.symlink(root, "v1..v2", secret);
        const program = await BashProgram.parse("cat v1..v2", probeNormalizer);
        expect(
          program.externalAccesses().map(({ path }) => path.boundaryValue()),
        ).toEqual([secret]);
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

      it("folds a cd whose target follows its redirect", async () => {
        const program = await BashProgram.parse(
          "cd 2>/dev/null a && cat ../b",
          normalizer,
        );
        expect(program.externalAccesses()).toHaveLength(0);
      });

      it("folds a cd whose redirect precedes its target", async () => {
        // The redirect is not cd's operand; `a` is. ../b resolves to cwd/b.
        const program = await BashProgram.parse(
          "2>/dev/null cd a && cat ../b",
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

      it("folds a cd inside a timed subshell for paths within that subshell", async () => {
        // `time ( … )` runs its subshell as a bare `( … )` does: ../x → cwd/x.
        const program = await BashProgram.parse(
          "time ( cd sub && cat ../x )",
          normalizer,
        );
        expect(program.externalAccesses()).toHaveLength(0);
      });

      it("does not leak a timed subshell's cd to following commands", async () => {
        const program = await BashProgram.parse(
          "time ( cd sub ) && cat ../y",
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

      it("does not flag a revision range after a non-literal cd", async () => {
        // `..` inside a segment traverses nothing, so only the cd target is
        // external.
        const program = await BashProgram.parse(
          "cd ~/x && git log HEAD..origin/main",
          normalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toEqual([join(homedir(), "x")]);
      });

      it("flags a whole-segment traversal inside a longer token after a non-literal cd", async () => {
        const program = await BashProgram.parse(
          "cd ~/x && cat a/../../b",
          normalizer,
        );
        expect(
          program.externalAccesses().map(({ path }) => path.value()),
        ).toEqual([join(homedir(), "x"), "/projects/b"]);
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

      it("folds it too when the redirect carries the command's words", async () => {
        // The correction hands `x` back to `pnpm`, leaving the first stage a
        // plain list, which folds its leading `cd a` the same way.
        const program = await BashProgram.parse(
          "cd a && pnpm 2>&1 x | tail ; cat ../b",
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

    describe("plain operands", () => {
      it("leaves an absolute path within cwd alone", async () => {
        expect(
          await externalValuesOf("cat /projects/my-app/src/index.ts"),
        ).toEqual([]);
      });

      it("projects a home-relative path outside cwd", async () => {
        expect(await externalValuesOf("cat ~/documents/secret.txt")).toEqual([
          join(homedir(), "documents/secret.txt"),
        ]);
      });

      it("leaves a home-relative path resolving within cwd alone", async () => {
        const underHome = new PathNormalizer(
          pathFlavorForPlatform(process.platform),
          join(homedir(), "myproject"),
        );
        expect(
          await externalValuesOf("cat ~/myproject/file.ts", underHome),
        ).toEqual([]);
      });

      it("leaves a .. traversal that stays within cwd alone", async () => {
        expect(await externalValuesOf("cat src/../lib/utils.ts")).toEqual([]);
      });

      it("projects the path after a command's flags", async () => {
        expect(await externalValuesOf("ls -la /etc/passwd")).toEqual([
          "/etc/passwd",
        ]);
      });
    });

    describe("statement separators", () => {
      it.each([
        ["a pipe", "echo hello | tee /tmp/output.txt", "/tmp/output.txt"],
        ["a semicolon", "echo done; cat /etc/hosts", "/etc/hosts"],
        ["&&", "true && cat /etc/hosts", "/etc/hosts"],
      ])("projects the path after %s", async (_label, command, expected) => {
        expect(await externalValuesOf(command)).toEqual([expected]);
      });
    });

    describe("quoted strings", () => {
      it("leaves a path inside a double-quoted string alone", async () => {
        expect(
          await externalValuesOf(
            'git commit -m "fix: update /etc/hosts handler"',
          ),
        ).toEqual([]);
      });

      it("leaves a path inside a single-quoted string alone", async () => {
        expect(
          await externalValuesOf("echo 'see /usr/local/docs for info'"),
        ).toEqual([]);
      });

      it("still projects an unquoted path alongside quoted content", async () => {
        expect(await externalValuesOf('cat /etc/hosts && echo "done"')).toEqual(
          ["/etc/hosts"],
        );
      });

      it("leaves a path alone when adjacent quoted segments form one word", async () => {
        // tree-sitter parses adjacent quoted/unquoted segments as one
        // concatenation whose resolved text is 'path is /etc/hosts' (one
        // token, not a path candidate).
        expect(await externalValuesOf('echo "path is "/etc/hosts""')).toEqual(
          [],
        );
      });

      it("leaves a path inside a string with an escaped quote alone", async () => {
        expect(
          await externalValuesOf(
            'git commit -m "fix: update \\"the /etc/hosts\\" handler"',
          ),
        ).toEqual([]);
      });

      it("leaves a path inside a node -e script's single-quoted string alone", async () => {
        expect(
          await externalValuesOf(
            "node -e \"const p = '/etc/hosts'; console.log(p);\"",
          ),
        ).toEqual([]);
      });

      it("leaves a path after an escaped quote in a multi-line node -e script alone", async () => {
        // The shape of a command that prompted during dog-fooding: the outer
        // "..." argument holds real newlines and \" escapes, with /etc/hosts
        // after a \" boundary.
        const command = [
          'node -e "',
          "import('shell-quote').then(({ parse }) => {",
          "  const cmd = \\\"cat << 'EOF'\\n/etc/hosts\\nsome content\\nEOF\\\";",
          "  console.log(JSON.stringify(parse(cmd)));",
          "});",
          '"',
        ].join("\n");
        expect(await externalValuesOf(command)).toEqual([]);
      });

      it("still projects a real operand beside a quoted flag value", async () => {
        expect(
          await externalValuesOf("grep --regexp='/etc/passwd' /etc/hosts"),
        ).toEqual(["/etc/hosts"]);
      });
    });

    describe("safe device paths", () => {
      it.each([
        ["a /dev/null stderr redirect", "command 2>/dev/null"],
        ["a /dev/null redirect target", "echo hello > /dev/null"],
        ["/dev/stdin", "cat /dev/stdin"],
        ["/dev/stdout", "cat /dev/stdout"],
        ["/dev/stderr", "cat /dev/stderr"],
      ])("leaves %s alone", async (_label, command) => {
        expect(await externalValuesOf(command)).toEqual([]);
      });

      it("still projects a real external path alongside /dev/null", async () => {
        expect(await externalValuesOf("cat /etc/hosts 2>/dev/null")).toEqual([
          "/etc/hosts",
        ]);
      });

      it("projects a path under a device, which is no device", async () => {
        expect(await externalValuesOf("cat /dev/null/subdir")).toEqual([
          "/dev/null/subdir",
        ]);
      });
    });

    describe("the filesystem root", () => {
      it("projects the root find / scans", async () => {
        expect(await externalValuesOf("find /")).toEqual(["/"]);
      });

      it("projects the root find / scans behind search predicates", async () => {
        expect(
          await externalValuesOf('find / -path "*/pi-coding-agent/*.d.ts"'),
        ).toEqual(["/"]);
      });

      it.each([
        ["//", "echo //"],
        ["///", "echo ///"],
      ])("normalizes a bare %s to the root", async (_label, command) => {
        expect(await externalValuesOf(command)).toEqual(["/"]);
      });

      it("projects the root once among other arguments", async () => {
        expect(await externalValuesOf("echo // hello")).toEqual(["/"]);
      });

      it("projects the root alongside another external path", async () => {
        expect(await externalValuesOf("cat /etc/hosts; echo //")).toEqual([
          "/etc/hosts",
          "/",
        ]);
      });
    });

    describe("shell comments", () => {
      it("leaves a path appearing only in a comment alone", async () => {
        expect(await externalValuesOf("echo hello # /etc/shadow")).toEqual([]);
      });

      it("projects the path before a comment but not the one inside it", async () => {
        expect(
          await externalValuesOf("cat /etc/hosts # see also /etc/shadow"),
        ).toEqual(["/etc/hosts"]);
      });
    });

    describe("heredocs", () => {
      it.each([
        ["a single-quoted delimiter", "cat << 'EOF'\n/etc/hosts\nEOF"],
        ["a double-quoted delimiter", 'cat << "EOF"\n/etc/hosts\nEOF'],
        ["an indented (<<-) heredoc", "cat <<- 'EOF'\n\t/etc/hosts\nEOF"],
      ])("leaves a path in the body of %s alone", async (_label, command) => {
        expect(await externalValuesOf(command)).toEqual([]);
      });

      it("projects the command's operand but not the heredoc body", async () => {
        expect(
          await externalValuesOf("cat /etc/hosts << 'EOF'\nsome content\nEOF"),
        ).toEqual(["/etc/hosts"]);
      });
    });

    describe("command substitution and subshells", () => {
      it.each([
        ["a command substitution", "echo $(cat /etc/hosts)"],
        ["a nested command substitution", "echo $(echo $(cat /etc/hosts))"],
        ["a subshell", "(cat /etc/hosts)"],
      ])("projects the path inside %s", async (_label, command) => {
        expect(await externalValuesOf(command)).toEqual(["/etc/hosts"]);
      });
    });

    describe("redirect operators", () => {
      it.each([
        ["an append redirect", "echo hello >> /tmp/out.txt", "/tmp/out.txt"],
        ["an input redirect", "sort < /etc/hosts", "/etc/hosts"],
        ["a stderr redirect", "command 2>/tmp/errors.log", "/tmp/errors.log"],
      ])("projects the target of %s", async (_label, command, expected) => {
        expect(await externalValuesOf(command)).toEqual([expected]);
      });
    });

    describe("pattern-first commands", () => {
      it("leaves a sed address pattern alone, whatever it holds", async () => {
        const command = `sed -i '' '/source: "tool",/{/origin:/!s/source: "tool",/source: "tool",\n      origin: "builtin",/;}' tests/tool-input-preview.test.ts`;
        expect(await externalValuesOf(command)).toEqual([]);
      });

      it("skips a sed address pattern starting with / and projects the file", async () => {
        expect(await externalValuesOf("sed '/pattern/d' /etc/hosts")).toEqual([
          "/etc/hosts",
        ]);
      });

      it("leaves a sed whose only file is within cwd alone", async () => {
        expect(await externalValuesOf("sed 's/foo/bar/' src/index.ts")).toEqual(
          [],
        );
      });

      it("reads sed -n as a flag that consumes nothing", async () => {
        expect(
          await externalValuesOf("sed -n '/pattern/p' /etc/hosts"),
        ).toEqual(["/etc/hosts"]);
      });

      it("skips an awk program and projects the file", async () => {
        expect(await externalValuesOf("awk '{print}' /etc/hosts")).toEqual([
          "/etc/hosts",
        ]);
      });

      it("consumes an unquoted awk -F separator and skips the program", async () => {
        expect(
          await externalValuesOf("awk -F: '{print $1}' /etc/passwd"),
        ).toEqual(["/etc/passwd"]);
      });

      it("reads rg -e as consuming the pattern", async () => {
        expect(
          await externalValuesOf("rg -e '/usr/local' /etc/profile.d/"),
        ).toEqual(["/etc/profile.d"]);
      });

      it("leaves an sd whose only file is within cwd alone", async () => {
        expect(await externalValuesOf("sd 'foo' 'bar' src/index.ts")).toEqual(
          [],
        );
      });

      it("reads a path-qualified sed as sed", async () => {
        expect(
          await externalValuesOf("/usr/bin/sed 's/foo/bar/' /etc/hosts"),
        ).toEqual(["/etc/hosts"]);
      });

      it("still projects a pattern-first command's redirect target", async () => {
        expect(
          await externalValuesOf(
            "sed 's/foo/bar/' input.txt > /tmp/output.txt",
          ),
        ).toEqual(["/tmp/output.txt"]);
      });

      it("projects a later pipeline stage's operand", async () => {
        expect(
          await externalValuesOf(
            "sed 's/foo/bar/' src/file.ts | cat /etc/hosts",
          ),
        ).toEqual(["/etc/hosts"]);
      });

      it("projects the operand of a substitution passed to a pattern-first command", async () => {
        expect(
          await externalValuesOf("grep 'pattern' $(cat /etc/file-list)"),
        ).toEqual(["/etc/file-list"]);
      });
    });

    // These arguments reach no path surface because `PATTERN_FIRST_COMMANDS`
    // (token-collection.ts) skips a pattern-first command's inline pattern
    // positional, not because the classifier inspects the token's characters.
    describe("regex arguments of pattern-first commands", () => {
      it.each([
        [
          "a grep -v //.* pattern in a pipeline",
          'grep -n "glob" src/foo.ts 2>/dev/null | grep -v "//.*glob\\|globalConfig" | head -30',
        ],
        ["a grep -v //.* pattern", 'grep -v "//.*foo" file.txt'],
        [
          "a grep backslash-pipe alternation",
          'grep "foo\\|bar\\|baz" src/file.ts',
        ],
        ["a grep -E ^/ anchored regex", 'grep -E "^/usr/bin" file.txt'],
        ["a sed regex containing slashes", 'sed "s/foo.*/bar/g" file.txt'],
        [
          "an awk pattern holding an escaped absolute path",
          'awk "/\\/etc\\/.*/" file.txt',
        ],
        ["an rg pattern shaped like an absolute path", 'rg "/etc/.*passwd" -l'],
      ])("leaves %s alone", async (_label, command) => {
        expect(await externalValuesOf(command)).toEqual([]);
      });

      it("still projects a real external path beside a regex argument", async () => {
        expect(
          await externalValuesOf('grep -v "//.*pattern" /etc/hosts'),
        ).toEqual(["/etc/hosts"]);
      });
    });

    describe("a leading cd", () => {
      it("leaves a traversal back into cwd from a cd'd subdirectory alone", async () => {
        // A real command that prompted as a false positive: the traversal
        // resolves inside cwd from the cd target, but outside it from cwd.
        expect(
          await externalValuesOf(
            'cd /projects/my-app/packages/sub && grep -n "pattern" .pi/../../../.pi/skills/pkg/SKILL.md',
          ),
        ).toEqual([]);
      });

      it("leaves the same traversal alone after a relative cd", async () => {
        expect(
          await externalValuesOf(
            'cd packages/sub && grep -n "x" .pi/../../../.pi/skills/pkg/SKILL.md',
          ),
        ).toEqual([]);
      });

      it("still projects an absolute external path after a cd into a subdirectory", async () => {
        expect(
          await externalValuesOf(
            "cd /projects/my-app/packages/sub && cat /etc/hosts",
          ),
        ).toEqual(["/etc/hosts"]);
      });

      it("resolves a traversal against an external cd target", async () => {
        // `cd /tmp` makes /tmp the base, so the cd target itself is projected
        // and ../etc/hosts resolves to /etc/hosts.
        expect(await externalValuesOf("cd /tmp && cat ../etc/hosts")).toEqual([
          "/tmp",
          "/etc/hosts",
        ]);
      });

      it("resolves an escape against a cd that is not the first command", async () => {
        expect(
          await externalValuesOf(
            "echo hello && cd /projects/my-app/src && cat ../../outside.txt",
          ),
        ).toEqual(["/projects/outside.txt"]);
      });

      it("folds a cd joined by a semicolon", async () => {
        expect(
          await externalValuesOf("cd /projects/my-app/src ; cat ../README.md"),
        ).toEqual([]);
      });
    });

    describe("Git Bash tokens on a win32 host", () => {
      const gitBash = new PathNormalizer(win32PathFlavor, "C:/projects/app");

      it.each([
        [
          "a forward-slash drive path",
          "cat C:/Windows/win.ini",
          "c:\\windows\\win.ini",
        ],
        [
          "a different drive letter",
          "cat D:/secrets/password.txt",
          "d:\\secrets\\password.txt",
        ],
      ])("projects %s outside cwd", async (_label, command, expected) => {
        expect(await externalValuesOf(command, gitBash)).toEqual([expected]);
      });

      it("leaves a drive path inside cwd alone", async () => {
        expect(
          await externalValuesOf("cat C:/projects/app/inside.txt", gitBash),
        ).toEqual([]);
      });

      it("leaves a drive path inside cwd alone after a non-literal cd", async () => {
        // C:/ is absolute on win32, so it takes the resolved branch with its
        // inside-cwd check rather than the unknown-base conservative branch.
        expect(
          await externalValuesOf(
            'cd "$D" && cat C:/projects/app/inside.txt',
            gitBash,
          ),
        ).toEqual([]);
      });

      it("leaves all four safe device paths alone", async () => {
        expect(
          await externalValuesOf(
            "cat /dev/stdin /dev/stdout /dev/stderr /dev/null",
            gitBash,
          ),
        ).toEqual([]);
      });

      it("leaves an in-cwd drive mount alone", async () => {
        expect(
          await externalValuesOf("cat /c/projects/app/inside.txt", gitBash),
        ).toEqual([]);
      });

      it.each([
        [
          "an out-of-cwd drive mount",
          "cat /c/Other/secret.txt",
          "c:\\other\\secret.txt",
        ],
        [
          "a different-drive mount",
          "cat /d/secrets/pw.txt",
          "d:\\secrets\\pw.txt",
        ],
      ])(
        "projects %s as its translated Windows path",
        async (_label, command, expected) => {
          expect(await externalValuesOf(command, gitBash)).toEqual([expected]);
        },
      );

      it("keeps distinct literal-only POSIX absolutes apart", async () => {
        expect(await externalValuesOf("cat /tmp/a /tmp/b", gitBash)).toEqual([
          "/tmp/a",
          "/tmp/b",
        ]);
      });
    });
  });
});
