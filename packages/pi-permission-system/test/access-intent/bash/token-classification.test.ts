import { describe, expect, test } from "vitest";

import {
  classifyBareTokenCandidate,
  classifyTokenAsPathCandidate,
  classifyTokenAsRuleCandidate,
} from "#src/access-intent/bash/token-classification";
import { posixPathFlavor, win32PathFlavor } from "#src/path/path-flavor";

// ── Shared rejection behaviour ─────────────────────────────────────────────
//
// Both classifiers delegate to the private `rejectNonPathToken` predicate for
// the five shared rejection cases tested below.  Testing via both exports
// pins that predicate through each caller.

describe("classifyTokenAsPathCandidate", () => {
  describe("shared rejection: rejectNonPathToken", () => {
    test("empty string → null", () => {
      expect(classifyTokenAsPathCandidate("")).toBeNull();
    });

    test("flag (leading dash) → null", () => {
      expect(classifyTokenAsPathCandidate("-r")).toBeNull();
      expect(classifyTokenAsPathCandidate("--recursive")).toBeNull();
    });

    test("env assignment (= before any /) → null", () => {
      expect(classifyTokenAsPathCandidate("FOO=/bar")).toBeNull();
      expect(classifyTokenAsPathCandidate("HOME=/home/user")).toBeNull();
    });

    test("env-like token where = comes after / is NOT rejected as assignment", () => {
      // /foo=bar: slashIndex (0) < eqIndex (4) → not an assignment → continues
      // Starts with /, so path candidate accepts it.
      expect(classifyTokenAsPathCandidate("/foo=bar")).toBe("/foo=bar");
    });

    test("URL → null", () => {
      expect(classifyTokenAsPathCandidate("https://example.com")).toBeNull();
      expect(classifyTokenAsPathCandidate("http://localhost:3000")).toBeNull();
      expect(classifyTokenAsPathCandidate("file:///tmp/foo")).toBeNull();
      expect(
        classifyTokenAsPathCandidate("git+ssh://github.com/a/b"),
      ).toBeNull();
    });

    test("@scope/package → null", () => {
      expect(classifyTokenAsPathCandidate("@foo/bar")).toBeNull();
      expect(classifyTokenAsPathCandidate("@scope/pkg")).toBeNull();
    });

    test("@/ prefix is NOT rejected (it looks like an absolute-rooted scoped path)", () => {
      // @/ passes the @ guard; then for path candidate it doesn't start with /
      // or ~/, and doesn't contain .., so it returns null anyway from the
      // acceptance gate — but the rejection is not due to the @ guard.
      // This test documents that @/ is not rejected by the shared rejection.
      // The path classifier then rejects it for not matching any acceptance shape.
      expect(classifyTokenAsPathCandidate("@/foo/bar")).toBeNull();
    });

    test("shapeless regex-like token → null (acceptance gate, not the prelude)", () => {
      // The prelude no longer inspects metacharacters (#821). These stay null
      // because none carries a path shape the strict gate accepts — no leading
      // `/`, no `~/`, no `..`, no drive letter.
      expect(classifyTokenAsPathCandidate("foo.*")).toBeNull();
      expect(classifyTokenAsPathCandidate("bar.+")).toBeNull();
      expect(classifyTokenAsPathCandidate("a\\|b")).toBeNull();
      expect(classifyTokenAsPathCandidate("\\(group\\)")).toBeNull();
      expect(classifyTokenAsPathCandidate("[abc]")).toBeNull();
      expect(classifyTokenAsPathCandidate("^/start")).toBeNull();
    });
  });

  describe("path-candidate acceptance gate", () => {
    test("absolute path (starts with /) → returned as-is", () => {
      expect(classifyTokenAsPathCandidate("/etc/hosts")).toBe("/etc/hosts");
      expect(classifyTokenAsPathCandidate("/tmp")).toBe("/tmp");
      expect(classifyTokenAsPathCandidate("/home/user/file.txt")).toBe(
        "/home/user/file.txt",
      );
    });

    test("bare-slash token (filesystem root) → returned as-is", () => {
      // `find /` scans the whole filesystem from root — a deliberate
      // external-directory access the gate must see, not drop (#583).
      expect(classifyTokenAsPathCandidate("/")).toBe("/");
      expect(classifyTokenAsPathCandidate("//")).toBe("//");
      expect(classifyTokenAsPathCandidate("///")).toBe("///");
    });

    test("home-relative path (starts with ~/) → returned as-is", () => {
      expect(classifyTokenAsPathCandidate("~/Documents")).toBe("~/Documents");
      expect(classifyTokenAsPathCandidate("~/.ssh/config")).toBe(
        "~/.ssh/config",
      );
    });

    test("parent-traversal (contains ..) → returned as-is", () => {
      expect(classifyTokenAsPathCandidate("../../etc/passwd")).toBe(
        "../../etc/passwd",
      );
      expect(classifyTokenAsPathCandidate("../foo")).toBe("../foo");
      expect(classifyTokenAsPathCandidate("..")).toBe("..");
    });

    test("plain word with no path shape → null", () => {
      expect(classifyTokenAsPathCandidate("hello")).toBeNull();
      expect(classifyTokenAsPathCandidate("myfile.txt")).toBeNull();
    });

    test("dot-file (starts with .) → null (strict path gate)", () => {
      // Path candidate does NOT accept dot-files; rule candidate does.
      expect(classifyTokenAsPathCandidate(".env")).toBeNull();
      expect(classifyTokenAsPathCandidate(".gitignore")).toBeNull();
    });

    test("relative path with / but no leading / or ~/ → null (strict path gate)", () => {
      // Path candidate does NOT accept bare relative paths; rule candidate does.
      expect(classifyTokenAsPathCandidate("src/foo.ts")).toBeNull();
      expect(classifyTokenAsPathCandidate("./build")).toBeNull();
    });
  });

  describe("Windows drive-letter acceptance gate", () => {
    test("forward-slash drive path → returned as-is", () => {
      expect(classifyTokenAsPathCandidate("C:/Windows/win.ini")).toBe(
        "C:/Windows/win.ini",
      );
      expect(classifyTokenAsPathCandidate("D:/secrets/password.txt")).toBe(
        "D:/secrets/password.txt",
      );
    });

    test("backslash drive path → returned as-is", () => {
      expect(classifyTokenAsPathCandidate("C:\\Windows\\win.ini")).toBe(
        "C:\\Windows\\win.ini",
      );
      expect(classifyTokenAsPathCandidate("D:\\secrets\\password.txt")).toBe(
        "D:\\secrets\\password.txt",
      );
    });

    test("lowercase drive letter → returned as-is", () => {
      expect(classifyTokenAsPathCandidate("c:/foo")).toBe("c:/foo");
    });

    test("single-letter scheme with double-slash (c://x) → null (URL_PATTERN fires first)", () => {
      // c:// matches URL_PATTERN before the drive-letter check runs.
      expect(classifyTokenAsPathCandidate("c://x")).toBeNull();
    });

    test("drive-relative path without separator (C:foo) → null", () => {
      // No / or \ after the colon — not an absolute drive path per node:path.
      expect(classifyTokenAsPathCandidate("C:foo")).toBeNull();
    });
  });

  describe("glob-bearing path shapes (#821)", () => {
    // A shell glob is syntax, not evidence against path-hood: the shell
    // expands `[p]` and `.*` against the filesystem, so a path-shaped token
    // carrying them names a real access the gates must see.
    test("bracket glob in an absolute path → returned as-is", () => {
      expect(classifyTokenAsPathCandidate("/etc/[p]asswd")).toBe(
        "/etc/[p]asswd",
      );
      expect(classifyTokenAsPathCandidate("/et[c]/pa*")).toBe("/et[c]/pa*");
    });

    test("dot-star glob in an absolute path → returned as-is", () => {
      expect(classifyTokenAsPathCandidate("/tmp/tmp.*")).toBe("/tmp/tmp.*");
      expect(classifyTokenAsPathCandidate("/var/log/sys.+")).toBe(
        "/var/log/sys.+",
      );
    });

    test("bracket glob in a home-relative path → returned as-is", () => {
      expect(classifyTokenAsPathCandidate("~/.ssh/[i]d_rsa")).toBe(
        "~/.ssh/[i]d_rsa",
      );
    });

    test("bracket glob in a parent-traversal path → returned as-is", () => {
      expect(classifyTokenAsPathCandidate("../[e]tc/passwd")).toBe(
        "../[e]tc/passwd",
      );
    });
  });
});

describe("classifyTokenAsRuleCandidate", () => {
  describe("shared rejection: rejectNonPathToken", () => {
    test("empty string → null", () => {
      expect(classifyTokenAsRuleCandidate("", posixPathFlavor)).toBeNull();
    });

    test("flag (leading dash) → null", () => {
      expect(classifyTokenAsRuleCandidate("-r", posixPathFlavor)).toBeNull();
      expect(
        classifyTokenAsRuleCandidate("--recursive", posixPathFlavor),
      ).toBeNull();
    });

    test("env assignment (= before any /) → null", () => {
      expect(
        classifyTokenAsRuleCandidate("FOO=/bar", posixPathFlavor),
      ).toBeNull();
      expect(
        classifyTokenAsRuleCandidate("HOME=/home/user", posixPathFlavor),
      ).toBeNull();
    });

    test("env-like token where = comes after / is NOT rejected as assignment", () => {
      // /foo=bar: slashIndex (0) < eqIndex (4) → not an assignment → continues.
      // Contains /, so rule candidate accepts it.
      expect(classifyTokenAsRuleCandidate("/foo=bar", posixPathFlavor)).toBe(
        "/foo=bar",
      );
    });

    test("URL → null", () => {
      expect(
        classifyTokenAsRuleCandidate("https://example.com", posixPathFlavor),
      ).toBeNull();
      expect(
        classifyTokenAsRuleCandidate("http://localhost:3000", posixPathFlavor),
      ).toBeNull();
      expect(
        classifyTokenAsRuleCandidate("file:///tmp/foo", posixPathFlavor),
      ).toBeNull();
    });

    test("@scope/package → null", () => {
      expect(
        classifyTokenAsRuleCandidate("@foo/bar", posixPathFlavor),
      ).toBeNull();
      expect(
        classifyTokenAsRuleCandidate("@scope/pkg", posixPathFlavor),
      ).toBeNull();
    });

    test("shapeless regex-like token → null (acceptance gate, not the prelude)", () => {
      // The prelude no longer inspects metacharacters (#821); these carry no
      // separator, no leading `.`, and no `..`, so the broad gate rejects them.
      expect(classifyTokenAsRuleCandidate("foo.*", posixPathFlavor)).toBeNull();
      expect(classifyTokenAsRuleCandidate("bar.+", posixPathFlavor)).toBeNull();
      expect(classifyTokenAsRuleCandidate("a\\|b", posixPathFlavor)).toBeNull();
      expect(classifyTokenAsRuleCandidate("[abc]", posixPathFlavor)).toBeNull();
    });

    test("separator-bearing regex-like token → accepted for the rules to judge", () => {
      // `^/start` carries a `/`, so the broad gate accepts it. A rule candidate
      // that matches no explicit `path` rule is unrestricted (ADR 0009), and
      // admitting it is the fail-closed direction: a token this shape can also
      // be a real operand.
      expect(classifyTokenAsRuleCandidate("^/start", posixPathFlavor)).toBe(
        "^/start",
      );
    });
  });

  describe("rule-candidate acceptance gate (broader than path)", () => {
    test("absolute path (starts with /) → returned as-is", () => {
      expect(classifyTokenAsRuleCandidate("/etc/hosts", posixPathFlavor)).toBe(
        "/etc/hosts",
      );
    });

    test("bare-slash token (filesystem root) → returned as-is", () => {
      // Root is a path-shaped token via `hasPathSeparator`; a `path` rule for
      // `/` must be able to match it, same as any other absolute (#583).
      expect(classifyTokenAsRuleCandidate("/", posixPathFlavor)).toBe("/");
      expect(classifyTokenAsRuleCandidate("//", posixPathFlavor)).toBe("//");
    });

    test("home-relative path (starts with ~/) → returned as-is", () => {
      expect(classifyTokenAsRuleCandidate("~/Documents", posixPathFlavor)).toBe(
        "~/Documents",
      );
    });

    test("parent-traversal (contains ..) → returned as-is", () => {
      expect(classifyTokenAsRuleCandidate("../foo", posixPathFlavor)).toBe(
        "../foo",
      );
      expect(classifyTokenAsRuleCandidate("..", posixPathFlavor)).toBe("..");
    });

    test("dot-file (starts with .) → returned as-is", () => {
      // Rule candidate accepts dot-files; path candidate does not.
      expect(classifyTokenAsRuleCandidate(".env", posixPathFlavor)).toBe(
        ".env",
      );
      expect(classifyTokenAsRuleCandidate(".gitignore", posixPathFlavor)).toBe(
        ".gitignore",
      );
    });

    test("current-dir relative (starts with ./) → returned as-is", () => {
      expect(classifyTokenAsRuleCandidate("./src", posixPathFlavor)).toBe(
        "./src",
      );
      expect(
        classifyTokenAsRuleCandidate("./build/output.js", posixPathFlavor),
      ).toBe("./build/output.js");
    });

    test("relative path containing / → returned as-is", () => {
      // Rule candidate accepts any token with / (not already rejected).
      expect(classifyTokenAsRuleCandidate("src/foo.ts", posixPathFlavor)).toBe(
        "src/foo.ts",
      );
      expect(
        classifyTokenAsRuleCandidate(
          "packages/pi-foo/index.ts",
          posixPathFlavor,
        ),
      ).toBe("packages/pi-foo/index.ts");
    });

    test("plain word with no path shape → null", () => {
      expect(classifyTokenAsRuleCandidate("hello", posixPathFlavor)).toBeNull();
      expect(
        classifyTokenAsRuleCandidate("myfile.txt", posixPathFlavor),
      ).toBeNull();
    });
  });

  describe("Windows drive-letter acceptance gate", () => {
    test("forward-slash drive path → returned as-is", () => {
      // Forward-slash form was already accepted via token.includes("/").
      // The explicit branch makes it first-class and order-independent.
      expect(
        classifyTokenAsRuleCandidate("C:/Windows/win.ini", posixPathFlavor),
      ).toBe("C:/Windows/win.ini");
    });

    test("backslash drive path → returned as-is (new: no forward slash)", () => {
      // Previously dropped by both classifiers; the backslash form has no /
      // so the includes("/") branch could not catch it.
      expect(
        classifyTokenAsRuleCandidate(
          "D:\\secrets\\password.txt",
          posixPathFlavor,
        ),
      ).toBe("D:\\secrets\\password.txt");
      expect(
        classifyTokenAsRuleCandidate("C:\\Windows\\win.ini", posixPathFlavor),
      ).toBe("C:\\Windows\\win.ini");
    });

    test("lowercase drive letter (backslash) → returned as-is", () => {
      expect(classifyTokenAsRuleCandidate("c:\\foo", posixPathFlavor)).toBe(
        "c:\\foo",
      );
    });

    test("drive-relative path without separator (C:foo) → null", () => {
      expect(classifyTokenAsRuleCandidate("C:foo", posixPathFlavor)).toBeNull();
    });
  });

  describe("glob-bearing path shapes (#821)", () => {
    test("bracket glob in a relative path → returned as-is", () => {
      expect(
        classifyTokenAsRuleCandidate("src/[s]ecret.env", posixPathFlavor),
      ).toBe("src/[s]ecret.env");
    });

    test("bracket glob in a dot-file → returned as-is", () => {
      expect(classifyTokenAsRuleCandidate(".[e]nv", posixPathFlavor)).toBe(
        ".[e]nv",
      );
    });

    test("dot-star glob in a relative path → returned as-is", () => {
      expect(classifyTokenAsRuleCandidate("logs/app.*", posixPathFlavor)).toBe(
        "logs/app.*",
      );
    });
  });

  describe("Windows backslash-relative acceptance gate (win32 flavor, #520)", () => {
    test("backslash-relative token accepted under the win32 flavor", () => {
      expect(classifyTokenAsRuleCandidate("dir\\file", win32PathFlavor)).toBe(
        "dir\\file",
      );
    });

    test("backslash-relative token rejected under the posix flavor", () => {
      expect(
        classifyTokenAsRuleCandidate("dir\\file", posixPathFlavor),
      ).toBeNull();
    });

    test("backslash-bearing token accepted under the win32 flavor, whatever else it contains", () => {
      // The win32 flavor counts `\` as a separator, and the prelude no longer
      // second-guesses that on metacharacters (#821): under win32 these are
      // `dir\file`-shaped tokens like any other.
      expect(classifyTokenAsRuleCandidate("a\\|b", win32PathFlavor)).toBe(
        "a\\|b",
      );
      expect(classifyTokenAsRuleCandidate("\\(group\\)", win32PathFlavor)).toBe(
        "\\(group\\)",
      );
    });

    test("backslash traversal accepted regardless of flavor (already via ..)", () => {
      expect(classifyTokenAsRuleCandidate("..\\secret", posixPathFlavor)).toBe(
        "..\\secret",
      );
      expect(classifyTokenAsRuleCandidate("..\\secret", win32PathFlavor)).toBe(
        "..\\secret",
      );
    });
  });

  describe("rule-vs-path divergence", () => {
    const dotFiles = [".env", ".gitignore", ".eslintrc"];
    const relPaths = ["src/index.ts", "lib/utils.js", "config/settings.json"];

    for (const tok of dotFiles) {
      test(`dot-file "${tok}": rule accepts, path rejects`, () => {
        expect(classifyTokenAsRuleCandidate(tok, posixPathFlavor)).toBe(tok);
        expect(classifyTokenAsPathCandidate(tok)).toBeNull();
      });
    }

    for (const tok of relPaths) {
      test(`relative path "${tok}": rule accepts, path rejects`, () => {
        expect(classifyTokenAsRuleCandidate(tok, posixPathFlavor)).toBe(tok);
        expect(classifyTokenAsPathCandidate(tok)).toBeNull();
      });
    }

    const sharedAccepted = ["/etc/hosts", "~/docs", "../sibling"];
    for (const tok of sharedAccepted) {
      test(`"${tok}": both classifiers accept`, () => {
        expect(classifyTokenAsRuleCandidate(tok, posixPathFlavor)).toBe(tok);
        expect(classifyTokenAsPathCandidate(tok)).toBe(tok);
      });
    }

    const winDrivePaths = [
      "C:/Windows/win.ini",
      "D:\\secrets\\password.txt",
      "c:/foo",
    ];
    for (const tok of winDrivePaths) {
      test(`Windows drive path "${tok}": both classifiers accept`, () => {
        expect(classifyTokenAsRuleCandidate(tok, posixPathFlavor)).toBe(tok);
        expect(classifyTokenAsPathCandidate(tok)).toBe(tok);
      });
    }

    const sharedRejected = ["hello", "--flag", "FOO=/bar", "https://x.com"];
    for (const tok of sharedRejected) {
      test(`"${tok}": both classifiers reject`, () => {
        expect(classifyTokenAsRuleCandidate(tok, posixPathFlavor)).toBeNull();
        expect(classifyTokenAsPathCandidate(tok)).toBeNull();
      });
    }
  });
});

describe("classifyBareTokenCandidate", () => {
  // Prelude-only: returns the token when nothing about its *shape* rules out
  // being a path. Whether it names a real entry is the existence probe's
  // question, decided by the resolver (ADR 0009), not by this classifier.

  test("bare word → returned unchanged", () => {
    expect(classifyBareTokenCandidate("id_rsa")).toBe("id_rsa");
    expect(classifyBareTokenCandidate("key.pem")).toBe("key.pem");
    expect(classifyBareTokenCandidate("outside-link")).toBe("outside-link");
  });

  test("bare word that names no file is still returned — existence is not its question", () => {
    expect(classifyBareTokenCandidate("status")).toBe("status");
    expect(classifyBareTokenCandidate("build")).toBe("build");
  });

  test("consults no policy — identical result for every token of the same shape", () => {
    expect(classifyBareTokenCandidate("anything")).toBe("anything");
  });

  test("glob-bearing bare token → returned for the probe to settle (#821)", () => {
    expect(classifyBareTokenCandidate("[a]bc")).toBe("[a]bc");
    expect(classifyBareTokenCandidate("tmp.*")).toBe("tmp.*");
  });

  describe("shared rejection prelude", () => {
    test("flag (leading dash) → null", () => {
      expect(classifyBareTokenCandidate("-r")).toBeNull();
      expect(classifyBareTokenCandidate("--recursive")).toBeNull();
    });

    test("env assignment → null", () => {
      expect(classifyBareTokenCandidate("FOO=/bar")).toBeNull();
    });

    test("URL → null", () => {
      expect(classifyBareTokenCandidate("https://example.com")).toBeNull();
    });

    test("@scope/package → null", () => {
      expect(classifyBareTokenCandidate("@foo/bar")).toBeNull();
    });

    test("metacharacters are not a rejection — the probe settles it (#821)", () => {
      // The bare classifier has no acceptance gate beyond the prelude, so a
      // token carrying `.*` is returned and the resolver's existence probe
      // decides whether it names anything.
      expect(classifyBareTokenCandidate("foo.*")).toBe("foo.*");
    });

    test("empty string → null", () => {
      expect(classifyBareTokenCandidate("")).toBeNull();
    });
  });
});
