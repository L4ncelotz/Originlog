import { describe, it, expect } from "vitest";
import { execa } from "execa";
import { promises as fs } from "node:fs";
import { getDiff } from "../../../src/git/diff.js";
import {
  withTempRepo,
  commitFile,
  modifyFile,
} from "../../helpers/temp-repo.js";

describe("getDiff", () => {
  it("returns an empty diff for a clean working tree", async () => {
    await withTempRepo(async (repoRoot) => {
      await commitFile(repoRoot, "src/a.ts", "a\n", "init");
      const result = await getDiff(repoRoot);
      expect(result.files).toEqual([]);
    });
  });

  it("reports additions and deletions for a worktree modification", async () => {
    await withTempRepo(async (repoRoot) => {
      await commitFile(repoRoot, "src/auth.ts", "a\nb\nc\n", "init");
      await modifyFile(repoRoot, "src/auth.ts", "a\nB\nc\nd\n");
      const result = await getDiff(repoRoot);
      expect(result.files).toHaveLength(1);
      const file = result.files[0]!;
      expect(file.path).toBe("src/auth.ts");
      expect(file.status).toBe("modified");
      expect(file.additions).toBe(2);
      expect(file.deletions).toBe(1);
      expect(file.hunks).toBeDefined();
      expect(file.hunks!.length).toBe(1);
      expect(file.hunks![0]!.oldStart).toBe(1);
      expect(file.hunks![0]!.newStart).toBe(1);
    });
  });

  it("reports only staged changes when staged: true", async () => {
    await withTempRepo(async (repoRoot) => {
      await commitFile(repoRoot, "src/a.ts", "a\n", "init");
      await fs.writeFile(`${repoRoot}/src/a.ts`, "a\nb\n");
      await execa("git", ["add", "src/a.ts"], { cwd: repoRoot });
      await fs.writeFile(`${repoRoot}/src/a.ts`, "a\nb\nc\n");

      const worktree = await getDiff(repoRoot);
      const staged = await getDiff(repoRoot, { staged: true });
      expect(worktree.files[0]?.additions).toBe(1);
      expect(staged.files[0]?.additions).toBe(1);
    });
  });

  it("limits the diff to provided paths", async () => {
    await withTempRepo(async (repoRoot) => {
      await commitFile(repoRoot, "src/a.ts", "a\n", "init");
      await commitFile(repoRoot, "src/b.ts", "b\n", "init");
      await modifyFile(repoRoot, "src/a.ts", "A\n");
      await modifyFile(repoRoot, "src/b.ts", "B\n");
      const result = await getDiff(repoRoot, { paths: ["src/a.ts"] });
      expect(result.files).toHaveLength(1);
      expect(result.files[0]!.path).toBe("src/a.ts");
    });
  });

  it("surfaces renames with status renamed and oldPath via NUL parsing", async () => {
    await withTempRepo(async (repoRoot) => {
      await commitFile(repoRoot, "src/old name.ts", "alpha\nbeta\ngamma\n", "init");
      await execa("git", ["mv", "src/old name.ts", "src/new name.ts"], {
        cwd: repoRoot,
      });

      const result = await getDiff(repoRoot, { staged: true });
      const renamed = result.files.find((f) => f.status === "renamed");
      expect(renamed).toBeDefined();
      expect(renamed!.oldPath).toBe("src/old name.ts");
      expect(renamed!.path).toBe("src/new name.ts");
    });
  });

  it("returns undefined additions/deletions for binary files", async () => {
    await withTempRepo(async (repoRoot) => {
      await commitFile(repoRoot, "assets/logo.txt", "placeholder\n", "init");
      await fs.writeFile(`${repoRoot}/assets/logo.txt`, "\u0000\u0001\u0002");
      const result = await getDiff(repoRoot);
      const file = result.files.find((f) => f.path === "assets/logo.txt");
      if (file) {
        expect(file.additions).toBeUndefined();
        expect(file.deletions).toBeUndefined();
      }
    });
  });
});
