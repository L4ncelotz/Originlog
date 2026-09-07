import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import { getBlame } from "../../../src/git/blame.js";
import {
  withTempRepo,
  commitFile,
  modifyFile,
} from "../../helpers/temp-repo.js";

describe("getBlame", () => {
  it("returns blame metadata for a committed line with authorTime and committedAt", async () => {
    await withTempRepo(async (repoRoot) => {
      await commitFile(
        repoRoot,
        "src/auth.ts",
        "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n",
        "init auth",
      );
      const blame = await getBlame(repoRoot, "src/auth.ts", 2);
      expect(blame).not.toBeNull();
      expect(blame!.line).toBe(2);
      expect(blame!.commitHash.length).toBeGreaterThanOrEqual(7);
      expect(blame!.author).toBe("Originlog Test");
      expect(blame!.authorTime).toBeInstanceOf(Date);
      expect(blame!.committedAt).toBeInstanceOf(Date);
      expect(blame!.uncommitted).toBe(false);
      expect(blame!.content).toBe("export const b = 2;");
    });
  });

  it("handles uncommitted / zero-OID blame lines safely without exposing pseudo timestamps", async () => {
    await withTempRepo(async (repoRoot) => {
      await commitFile(
        repoRoot,
        "src/auth.ts",
        "line 1\nline 2\n",
        "init auth",
      );
      // Append an uncommitted line
      await modifyFile(
        repoRoot,
        "src/auth.ts",
        "line 1\nline 2\nline 3 uncommitted\n",
      );

      const blame = await getBlame(repoRoot, "src/auth.ts", 3);
      expect(blame).not.toBeNull();
      expect(blame!.line).toBe(3);
      expect(blame!.uncommitted).toBe(true);
      expect(/^0+$/.test(blame!.commitHash)).toBe(true);
      // Must NOT expose Git pseudo timestamps or pseudo author
      expect(blame!.author).toBeUndefined();
      expect(blame!.authorTime).toBeUndefined();
      expect(blame!.committedAt).toBeUndefined();
      expect(blame!.content).toBe("line 3 uncommitted");
    });
  });

  it("returns null for a line number out of range", async () => {
    await withTempRepo(async (repoRoot) => {
      await commitFile(repoRoot, "src/a.ts", "a\n", "init");
      const blame = await getBlame(repoRoot, "src/a.ts", 9999);
      expect(blame).toBeNull();
    });
  });

  it("returns null for a file that was not committed", async () => {
    await withTempRepo(async (repoRoot) => {
      await fs.writeFile(`${repoRoot}/scratch.ts`, "scratch\n");
      const blame = await getBlame(repoRoot, "scratch.ts", 1);
      expect(blame).toBeNull();
    });
  });

  it("returns null for a non-positive line number", async () => {
    await withTempRepo(async (repoRoot) => {
      await commitFile(repoRoot, "src/a.ts", "a\n", "init");
      expect(await getBlame(repoRoot, "src/a.ts", 0)).toBeNull();
      expect(await getBlame(repoRoot, "src/a.ts", -3)).toBeNull();
    });
  });
});
