import { describe, it, expect } from "vitest";
import { getLog } from "../../../src/git/log.js";
import { GitError } from "../../../src/git/types.js";
import { withTempRepo, commitFile } from "../../helpers/temp-repo.js";

describe("getLog", () => {
  it("returns an empty array for a repository with no commits", async () => {
    await withTempRepo(async (repoRoot) => {
      const commits = await getLog(repoRoot);
      expect(commits).toEqual([]);
    });
  });

  it("throws a structured GitError when an invalid revision is provided on an empty repo", async () => {
    await withTempRepo(async (repoRoot) => {
      await expect(
        getLog(repoRoot, { to: "nonexistent-branch" }),
      ).rejects.toThrowError(GitError);
    });
  });

  it("throws a structured GitError when an invalid from revision is requested", async () => {
    await withTempRepo(async (repoRoot) => {
      await commitFile(repoRoot, "a.txt", "a\n", "init");
      await expect(
        getLog(repoRoot, { from: "bad-sha-12345" }),
      ).rejects.toThrowError(GitError);
    });
  });

  it("throws a structured GitError when an invalid to revision is requested", async () => {
    await withTempRepo(async (repoRoot) => {
      await commitFile(repoRoot, "a.txt", "a\n", "init");
      await expect(
        getLog(repoRoot, { to: "bad-sha-67890" }),
      ).rejects.toThrowError(GitError);
    });
  });

  it("returns commits in reverse-chronological order with full metadata", async () => {
    await withTempRepo(async (repoRoot) => {
      await commitFile(repoRoot, "a.txt", "a\n", "first commit");
      await commitFile(repoRoot, "b.txt", "b\n", "second commit");
      await commitFile(repoRoot, "c.txt", "c\n", "third commit");

      const commits = await getLog(repoRoot);
      expect(commits).toHaveLength(3);
      expect(commits[0]!.subject).toBe("third commit");
      expect(commits[1]!.subject).toBe("second commit");
      expect(commits[2]!.subject).toBe("first commit");
      for (const commit of commits) {
        expect(commit.hash.length).toBeGreaterThanOrEqual(7);
        expect(commit.shortHash.length).toBeGreaterThanOrEqual(7);
        expect(commit.hash.startsWith(commit.shortHash)).toBe(true);
        expect(commit.authorName).toBe("Originlog Test");
        expect(commit.authorEmail).toBe("test@originlog.local");
        expect(commit.authoredAt).toBeInstanceOf(Date);
        expect(commit.committedAt).toBeInstanceOf(Date);
        expect(Number.isNaN(commit.authoredAt.getTime())).toBe(false);
        expect(Number.isNaN(commit.committedAt.getTime())).toBe(false);
      }
    });
  });

  it("respects maxCount", async () => {
    await withTempRepo(async (repoRoot) => {
      await commitFile(repoRoot, "a.txt", "a\n", "first");
      await commitFile(repoRoot, "b.txt", "b\n", "second");
      await commitFile(repoRoot, "c.txt", "c\n", "third");
      const commits = await getLog(repoRoot, { maxCount: 2 });
      expect(commits).toHaveLength(2);
      expect(commits[0]!.subject).toBe("third");
      expect(commits[1]!.subject).toBe("second");
    });
  });

  it("filters by path", async () => {
    await withTempRepo(async (repoRoot) => {
      await commitFile(repoRoot, "src/a.ts", "a\n", "add a");
      await commitFile(repoRoot, "docs/readme.md", "doc\n", "add docs");
      await commitFile(repoRoot, "src/b.ts", "b\n", "add b");
      const commits = await getLog(repoRoot, { paths: ["src"] });
      expect(commits).toHaveLength(2);
      expect(commits[0]!.subject).toBe("add b");
      expect(commits[1]!.subject).toBe("add a");
    });
  });

  it("supports range semantics matching API docs", async () => {
    await withTempRepo(async (repoRoot) => {
      const c1 = await commitFile(repoRoot, "a.txt", "1\n", "c1");
      const c2 = await commitFile(repoRoot, "a.txt", "2\n", "c2");
      const c3 = await commitFile(repoRoot, "a.txt", "3\n", "c3");

      // from..to
      const range = await getLog(repoRoot, { from: c1, to: c3 });
      expect(range.map((c) => c.hash)).toEqual([c3, c2]);

      // to only (reachable from c2)
      const upToC2 = await getLog(repoRoot, { to: c2 });
      expect(upToC2.map((c) => c.hash)).toEqual([c2, c1]);

      // from only (reachable from HEAD excluding c2)
      const fromC2 = await getLog(repoRoot, { from: c2 });
      expect(fromC2.map((c) => c.hash)).toEqual([c3]);
    });
  });
});
