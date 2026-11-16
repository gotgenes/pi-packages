import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BashPathResolver } from "#src/access-intent/bash/bash-path-resolver";
import { WordReader } from "#src/access-intent/bash/node-text";
import { getParser, type TSNode } from "#src/access-intent/bash/parser";
import { ShellVariables } from "#src/access-intent/bash/shell-variable-expansion";
import { withSalvagedRoots } from "#src/access-intent/bash/unresolved-salvage";
import { pathFlavorForPlatform, win32PathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path/path-normalizer";
import { createTmpFixture } from "#test/helpers/tmp-fixture";

const posix = new PathNormalizer(
  pathFlavorForPlatform(process.platform),
  "/projects/my-app",
);

/** Every node beneath `root`, depth first. */
function nodesOf(root: TSNode): TSNode[] {
  const out: TSNode[] = [root];
  for (let i = 0; i < root.childCount; i++) {
    const child = root.child(i);
    if (child) out.push(...nodesOf(child));
  }
  return out;
}

/** Each node the speller spells, as `[source text, spelling]`. */
function spelledIn(
  roots: readonly TSNode[],
  speller: { absoluteSpellingOf(node: TSNode): string | undefined },
): [string, string][] {
  const spelled: [string, string][] = [];
  for (const node of roots.flatMap(nodesOf)) {
    const spelling = speller.absoluteSpellingOf(node);
    if (spelling !== undefined) spelled.push([node.text, spelling]);
  }
  return spelled;
}

/** The argument spellings the resolver records for `command`'s primary tree. */
async function spellingsOf(
  command: string,
  normalizer: PathNormalizer = posix,
): Promise<[string, string][]> {
  const parser = await getParser();
  const tree = parser.parse(command);
  if (!tree) throw new Error("parse returned null");
  try {
    const words = new WordReader(ShellVariables.scan([tree.rootNode]));
    const { argumentSpellings } = new BashPathResolver(
      normalizer,
      words,
    ).resolve(tree.rootNode, [], command);
    return spelledIn([tree.rootNode], argumentSpellings);
  } finally {
    tree.delete();
  }
}

describe("BashPathResolver argument spellings", () => {
  describe("an argument resolved to an absolute path is spelled", () => {
    it("against the directory a literal cd moved to", async () => {
      expect(await spellingsOf("cd /tmp && rm a/x")).toEqual([
        ["a/x", "/tmp/a/x"],
      ]);
    });

    it("against the working directory with no cd", async () => {
      expect(await spellingsOf("rm a/x")).toEqual([
        ["a/x", "/projects/my-app/a/x"],
      ]);
    });

    it("at every occurrence of the same path", async () => {
      expect(await spellingsOf("cd /tmp && cp a/x a/x")).toEqual([
        ["a/x", "/tmp/a/x"],
        ["a/x", "/tmp/a/x"],
      ]);
    });

    it("for a home-relative argument while HOME is unchanged", async () => {
      expect(await spellingsOf("cat ~/notes")).toEqual([
        ["~/notes", join(homedir(), "notes")],
      ]);
    });

    it("for a slash-bearing word that is not a path, since shape decides", async () => {
      // A branch name looks like a relative path, so it is spelled too; only a
      // rule naming the spelled form (`git push origin /projects/my-app/*`)
      // could match it.
      expect(await spellingsOf("git push origin feature/x")).toEqual([
        ["feature/x", "/projects/my-app/feature/x"],
      ]);
    });

    it("with a parent segment resolved to the file that runs", async () => {
      expect(await spellingsOf("cd /tmp/a && rm ../../etc/x")).toEqual([
        ["../../etc/x", "/etc/x"],
      ]);
    });
  });

  describe("no spelling is invented", () => {
    it("for an argument after a cd whose target is not literal", async () => {
      expect(await spellingsOf('cd "$DIR" && rm ./a/x')).toEqual([]);
    });

    it("for such an argument even when its literal form differs from the token", async () => {
      // The literal form strips a leading quote character, so `'a/x` would be
      // respelled `a/x`: a different, still relative, file.
      expect(await spellingsOf(`cd "$DIR" && rm "'a/x"`)).toEqual([]);
    });

    it("for a glob", async () => {
      expect(await spellingsOf("rm src/*.ts")).toEqual([]);
    });

    it("for an argument already spelled absolute", async () => {
      expect(await spellingsOf("rm /tmp/a/x")).toEqual([]);
    });

    it("for a home-relative argument once HOME is rebound", async () => {
      expect(await spellingsOf("HOME=/x; cat ~/n")).toEqual([]);
    });

    it("for a POSIX-absolute argument under the win32 flavor", async () => {
      const win32 = new PathNormalizer(win32PathFlavor, "C:\\proj");
      expect(await spellingsOf("rm /tmp/../x", win32)).toEqual([]);
    });

    it("for an option's embedded value", async () => {
      expect(await spellingsOf("tool --out=a/b")).toEqual([]);
    });
  });

  describe("a bare token", () => {
    const tmp = createTmpFixture();
    afterEach(() => {
      tmp.cleanup();
    });

    it("is spelled when it names an existing entry", async () => {
      const root = realpathSync(tmp.dir("pi-perm-spell-"));
      tmp.file(root, "config.json", "{}");
      const normalizer = new PathNormalizer(
        pathFlavorForPlatform(process.platform),
        root,
      );
      expect(
        await spellingsOf("rm config.json missing.json", normalizer),
      ).toEqual([["config.json", join(root, "config.json")]]);
    });
  });

  describe("a region the primary parse could not resolve", () => {
    it("spells nothing in the re-parsed fragment", async () => {
      const parser = await getParser();
      const command = "> f <<'M' 2>&1 | rm -rf /tmp/../x a/y";
      const tree = parser.parse(command);
      if (!tree) throw new Error("parse returned null");
      try {
        const spelled = withSalvagedRoots(tree.rootNode, parser, (salvaged) => {
          if (salvaged.length === 0) throw new Error("nothing salvaged");
          const words = new WordReader(
            ShellVariables.scan([tree.rootNode, ...salvaged]),
          );
          const { argumentSpellings } = new BashPathResolver(
            posix,
            words,
          ).resolve(tree.rootNode, salvaged, command);
          return spelledIn(salvaged, argumentSpellings).map(
            ([, spelling]) => spelling,
          );
        });
        // A fragment node can share a span with a primary-tree node the
        // speller did spell (`f` here), so the claim is about the fragment's
        // own token: `/tmp/../x` would resolve to `/x` if its span were kept.
        expect(spelled).not.toContain("/x");
      } finally {
        tree.delete();
      }
    });
  });
});
