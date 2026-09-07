import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import { isGitRepository, getRepoRoot } from "../../../src/git/repository.js";
import {
  withTempRepo,
  withTempDir,
  pathExists,
} from "../../helpers/temp-repo.js";

describe("isGitRepository", () => {
  it("returns true for a real Git repository", async () => {
    await withTempRepo(async (repoRoot) => {
      expect(await isGitRepository(repoRoot)).toBe(true);
    });
  });

  it("returns true for a subdirectory of a real repository", async () => {
    await withTempRepo(async (repoRoot) => {
      const sub = `${repoRoot}/packages/nested`;
      await fs.mkdir(sub, { recursive: true });
      expect(await isGitRepository(sub)).toBe(true);
    });
  });

  it("returns false for a directory that is not a repository", async () => {
    await withTempDir(async (dir) => {
      expect(await isGitRepository(dir)).toBe(false);
    });
  });

  it("returns false for a path that does not exist", async () => {
    expect(
      await isGitRepository("/this/path/does/not/exist/12345"),
    ).toBe(false);
  });
});

describe("getRepoRoot", () => {
  it("returns the absolute path inside a repository", async () => {
    await withTempRepo(async (repoRoot) => {
      const root = await getRepoRoot(repoRoot);
      expect(root).not.toBeNull();
      expect(await pathExists(root!)).toBe(true);
      expect(root!.length).toBeGreaterThan(0);
    });
  });

  it("returns the repository root when called from a subdirectory", async () => {
    await withTempRepo(async (repoRoot) => {
      const sub = `${repoRoot}/src/nested`;
      await fs.mkdir(sub, { recursive: true });
      const root = await getRepoRoot(sub);
      expect(root).not.toBeNull();

      // Resolve realpath on both sides to eliminate Windows 8.3 short filename
      // aliases (e.g. runner~1 vs runneradmin in GitHub Actions CI runners).
      const [realActual, realExpected] = await Promise.all([
        fs.realpath(root!),
        fs.realpath(repoRoot),
      ]);
      const norm = (s: string) => s.replace(/\\/g, "/").toLowerCase();
      expect(norm(realActual)).toBe(norm(realExpected));
    });
  });

  it("returns null for a non-repo directory", async () => {
    await withTempDir(async (dir) => {
      expect(await getRepoRoot(dir)).toBeNull();
    });
  });

  it("returns null for a non-existent path", async () => {
    expect(await getRepoRoot("/this/path/does/not/exist/12345")).toBeNull();
  });
});
