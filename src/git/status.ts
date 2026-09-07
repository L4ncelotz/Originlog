/**
 * `git status` wrapper.
 *
 * Uses NUL-delimited parsing (`git status --porcelain=v1 -z`) so paths
 * containing spaces, quotes, non-ASCII characters, or newlines are parsed
 * safely and unambiguously without C-style quoting artifacts.
 */

import { assertRepo, runGit } from "./runner.js";
import {
  GitError,
  type GitFileStatus,
  type GitStatus,
  type GitStatusEntry,
} from "./types.js";

const STATUS_CHARS: Record<string, GitFileStatus> = {
  " ": "unmodified",
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  U: "conflicted",
  T: "type-changed",
  "?": "untracked",
  "!": "ignored",
};

function mapStatusChar(ch: string): GitFileStatus {
  if (ch === "" || ch === " ") return "unmodified";
  return STATUS_CHARS[ch] ?? "unknown";
}

/**
 * Get the working tree status of a repository.
 *
 * Throws {@link GitError} with `git-missing` when Git is not installed,
 * or `not-a-repository` when `repoRoot` is not inside a Git working tree.
 */
export async function getStatus(repoRoot: string): Promise<GitStatus> {
  await assertRepo(repoRoot);
  const result = await runGit(
    ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=no"],
    repoRoot,
  );
  if (result.exitCode !== 0) {
    if (result.isGitMissing) {
      throw new GitError(
        "git-missing",
        `git status failed: ${result.stderr.trim() || "Git executable not found"}`,
      );
    }
    throw new GitError(
      "command-failed",
      `git status failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`,
    );
  }

  const entries: GitStatusEntry[] = [];
  const tokens = result.stdout.split("\0");

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token || token.length < 3) continue;

    const indexCh = token[0] ?? " ";
    const worktreeCh = token[1] ?? " ";
    const filePath = token.slice(3); // after "XY "

    if (indexCh === "?" && worktreeCh === "?") {
      entries.push({
        path: filePath,
        indexStatus: "untracked",
        worktreeStatus: "untracked",
        untracked: true,
      });
      continue;
    }

    if (indexCh === "!" && worktreeCh === "!") {
      entries.push({
        path: filePath,
        indexStatus: "ignored",
        worktreeStatus: "ignored",
        untracked: false,
      });
      continue;
    }

    const isRenameOrCopy =
      indexCh === "R" ||
      indexCh === "C" ||
      worktreeCh === "R" ||
      worktreeCh === "C";

    let oldPath: string | undefined;
    if (isRenameOrCopy && i + 1 < tokens.length) {
      // In porcelain -z, rename/copy paths follow immediately as the next NUL token:
      // Token 1: `XY <newPath>`
      // Token 2: `<oldPath>`
      i++;
      oldPath = tokens[i];
    }

    entries.push({
      path: filePath,
      ...(oldPath ? { oldPath } : {}),
      indexStatus: mapStatusChar(indexCh),
      worktreeStatus: mapStatusChar(worktreeCh),
      untracked: false,
    });
  }

  return {
    clean: entries.length === 0,
    entries,
  };
}
