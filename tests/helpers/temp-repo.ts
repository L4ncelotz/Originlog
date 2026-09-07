/**
 * Shared test helpers for the Git layer.
 *
 * These helpers create ephemeral Git repositories under `os.tmpdir()`
 * and clean them up after each test, regardless of pass/fail status.
 */

import { execa } from "execa";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_USER = "Originlog Test";
const TEST_EMAIL = "test@originlog.local";

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function initRepo(repoRoot: string): Promise<void> {
  await execa("git", ["init", "--initial-branch=main"], { cwd: repoRoot });
  await execa("git", ["config", "user.name", TEST_USER], { cwd: repoRoot });
  await execa("git", ["config", "user.email", TEST_EMAIL], { cwd: repoRoot });
  await execa("git", ["config", "commit.gpgsign", "false"], {
    cwd: repoRoot,
  });
  await execa("git", ["config", "core.hooksPath", "/dev/null"], {
    cwd: repoRoot,
  });
}

/**
 * Run `callback` with a fresh empty Git repository, then delete it.
 * Resolves 8.3 short paths on Windows via `fs.realpath` so path comparisons
 * are deterministic across environments.
 */
export async function withTempRepo(
  callback: (repoRoot: string) => Promise<void>,
): Promise<void> {
  const rawRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "originlog-test-"),
  );
  const repoRoot = await fs.realpath(rawRoot);
  try {
    await initRepo(repoRoot);
    await callback(repoRoot);
  } finally {
    await fs.rm(rawRoot, { recursive: true, force: true });
  }
}

/**
 * Write a file (creating parent directories as needed) and create a
 * commit containing it. Returns the new commit hash.
 */
export async function commitFile(
  repoRoot: string,
  relativePath: string,
  contents: string,
  message: string,
): Promise<string> {
  const absolute = path.join(repoRoot, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, contents, "utf8");
  await execa("git", ["add", "--", relativePath], { cwd: repoRoot });
  await execa("git", ["commit", "-m", message], { cwd: repoRoot });
  const rev = await execa("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
  return rev.stdout.trim();
}

/**
 * Overwrite a tracked file without committing.
 */
export async function modifyFile(
  repoRoot: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  const absolute = path.join(repoRoot, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, contents, "utf8");
}

/**
 * Create a non-repo temporary directory (no `git init`).
 * Cleaned up after the callback returns.
 */
export async function withTempDir(
  callback: (dir: string) => Promise<void>,
): Promise<void> {
  const rawDir = await fs.mkdtemp(path.join(os.tmpdir(), "originlog-norepo-"));
  const dir = await fs.realpath(rawDir);
  try {
    await callback(dir);
  } finally {
    await fs.rm(rawDir, { recursive: true, force: true });
  }
}

export { pathExists };
