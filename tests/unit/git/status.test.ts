import { describe, it, expect } from "vitest";
import { execa } from "execa";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getStatus } from "../../../src/git/status.js";
import {
  withTempRepo,
  commitFile,
  modifyFile,
} from "../../helpers/temp-repo.js";

describe("getStatus", () => {
  it("returns a clean status for an empty repository", async () => {
    await withTempRepo(async (repoRoot) => {
      const status = await getStatus(repoRoot);
      expect(status.clean).toBe(true);
      expect(status.entries).toEqual([]);
    });
  });

  it("detects a modified tracked file in the worktree", async () => {
    await withTempRepo(async (repoRoot) => {
      await commitFile(repoRoot, "src/auth.ts", "export const x = 1;\n", "init");
      await modifyFile(repoRoot, "src/auth.ts", "export const x = 2;\n");
      const status = await getStatus(repoRoot);
      expect(status.clean).toBe(false);
      expect(status.entries).toHaveLength(1);
      const entry = status.entries[0]!;
      expect(entry.path).toBe("src/auth.ts");
      expect(entry.worktreeStatus).toBe("modified");
    });
  });

  it("detects a staged added file", async () => {
    await withTempRepo(async (repoRoot) => {
      const filePath = path.join(repoRoot, "src/new.ts");
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, "export const y = 1;\n", "utf8");
      await execa("git", ["add", "src/new.ts"], { cwd: repoRoot });

      const status = await getStatus(repoRoot);
      expect(status.clean).toBe(false);
      const entry = status.entries.find((e) => e.path === "src/new.ts");
      expect(entry).toBeDefined();
      expect(entry!.indexStatus).toBe("added");
      expect(entry!.untracked).toBe(false);
    });
  });

  it("detects an untracked file, including filenames with spaces", async () => {
    await withTempRepo(async (repoRoot) => {
      const filePath = path.join(repoRoot, "my scratch file.ts");
      await fs.writeFile(filePath, "// wip\n", "utf8");

      const status = await getStatus(repoRoot);
      const entry = status.entries.find((e) => e.path === "my scratch file.ts");
      expect(entry).toBeDefined();
      expect(entry!.untracked).toBe(true);
      expect(entry!.indexStatus).toBe("untracked");
      expect(entry!.worktreeStatus).toBe("untracked");
    });
  });

  it("detects a deleted file in the worktree", async () => {
    await withTempRepo(async (repoRoot) => {
      await commitFile(repoRoot, "src/old.ts", "export const z = 0;\n", "init");
      await fs.rm(path.join(repoRoot, "src/old.ts"));
      const status = await getStatus(repoRoot);
      const entry = status.entries.find((e) => e.path === "src/old.ts");
      expect(entry).toBeDefined();
      expect(entry!.worktreeStatus).toBe("deleted");
    });
  });

  it("detects a rename and exposes oldPath", async () => {
    await withTempRepo(async (repoRoot) => {
      await commitFile(repoRoot, "src/old-name.ts", "export const a = 1;\n", "init");
      await execa("git", ["mv", "src/old-name.ts", "src/new-name.ts"], {
        cwd: repoRoot,
      });

      const status = await getStatus(repoRoot);
      const entry = status.entries.find((e) => e.path === "src/new-name.ts");
      expect(entry).toBeDefined();
      expect(entry!.oldPath).toBe("src/old-name.ts");
      expect(entry!.indexStatus).toBe("renamed");
    });
  });
});
