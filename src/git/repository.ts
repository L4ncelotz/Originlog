/**
 * Repository detection helpers.
 *
 * Both functions are designed to never throw for the common case of
 * "not a Git repository" so callers can probe freely.
 */

import { runGit } from "./runner.js";

/**
 * Return `true` if `cwd` is inside a Git working tree.
 *
 * Never throws. Returns `false` if `cwd` is not a repository or if
 * Git is not installed.
 */
export async function isGitRepository(cwd: string): Promise<boolean> {
  const result = await runGit(["rev-parse", "--is-inside-work-tree"], cwd);
  return result.exitCode === 0;
}

/**
 * Return the absolute path of the Git repository containing `cwd`,
 * or `null` when `cwd` is not inside a repository.
 *
 * Never throws.
 */
export async function getRepoRoot(cwd: string): Promise<string | null> {
  const result = await runGit(["rev-parse", "--show-toplevel"], cwd);
  if (result.exitCode !== 0) return null;
  const root = result.stdout.trim();
  return root.length > 0 ? root : null;
}
