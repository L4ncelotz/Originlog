/**
 * `git blame` wrapper for a single line.
 *
 * Distinguishes author-time from committer-time, and handles uncommitted
 * (zero-OID) lines safely without inventing commit metadata or pseudo timestamps.
 *
 * Returns `null` when the file/line is not available (e.g. not tracked,
 * line out of range, or empty repository).
 *
 * Throws `git-missing` when Git is not installed, or `not-a-repository`
 * when the working tree itself is not a Git repository.
 */

import { assertRepo, runGit } from "./runner.js";
import { GitError, type GitBlameLine } from "./types.js";

function parseBlamePorcelain(
  stdout: string,
): Omit<GitBlameLine, "line"> | null {
  const lines = stdout.split(/\r?\n/);
  if (lines.length === 0) return null;
  const header = lines[0] ?? "";
  const parts = header.split(" ");
  const commitHash = parts[0];
  if (!commitHash) return null;

  const isZeroOid = /^0+$/.test(commitHash);

  let rawAuthor: string | undefined;
  let authorTime: Date | undefined;
  let committedAt: Date | undefined;
  let content: string | undefined;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.startsWith("author ")) {
      rawAuthor = line.slice("author ".length);
    } else if (line.startsWith("author-time ")) {
      const seconds = Number.parseInt(line.slice("author-time ".length), 10);
      if (Number.isFinite(seconds)) {
        authorTime = new Date(seconds * 1000);
      }
    } else if (line.startsWith("committer-time ")) {
      const seconds = Number.parseInt(line.slice("committer-time ".length), 10);
      if (Number.isFinite(seconds)) {
        committedAt = new Date(seconds * 1000);
      }
    } else if (line.startsWith("\t")) {
      content = line.slice(1);
      break;
    }
  }

  // For uncommitted/zero-OID blame, do NOT expose pseudo timestamps or fake authors
  if (isZeroOid) {
    return {
      commitHash,
      uncommitted: true,
      ...(content !== undefined ? { content } : {}),
    };
  }

  const author =
    rawAuthor === "Not Committed Yet" ? undefined : rawAuthor;

  const out: Omit<GitBlameLine, "line"> = {
    commitHash,
    uncommitted: false,
  };
  if (author !== undefined) out.author = author;
  if (authorTime !== undefined) out.authorTime = authorTime;
  if (committedAt !== undefined) out.committedAt = committedAt;
  if (content !== undefined) out.content = content;
  return out;
}

/**
 * Get the blame information for a single line in a tracked file.
 *
 * Returns `null` when the file is not tracked, the line is out of range,
 * or the repository is empty.
 *
 * Throws `git-missing` when Git is not installed, or `not-a-repository`
 * when the path is not inside a Git working tree.
 */
export async function getBlame(
  repoRoot: string,
  file: string,
  line: number,
): Promise<GitBlameLine | null> {
  if (!Number.isInteger(line) || line < 1) return null;
  await assertRepo(repoRoot);

  const result = await runGit(
    [
      "blame",
      "--line-porcelain",
      `-L${line},${line}`,
      "--",
      file,
    ],
    repoRoot,
  );

  if (result.isGitMissing) {
    throw new GitError("git-missing", "Git executable not found in PATH");
  }

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toLowerCase();
    if (
      stderr.includes("no such ref") ||
      stderr.includes("no such path") ||
      stderr.includes("no such file") ||
      stderr.includes("has only") ||
      stderr.includes("out of range") ||
      stderr.includes("cannot stat")
    ) {
      return null;
    }
    throw new GitError(
      "file-not-found",
      `git blame failed for ${file}:${line}: ${result.stderr.trim() || `exit code ${result.exitCode}`}`,
    );
  }

  const parsed = parseBlamePorcelain(result.stdout);
  if (!parsed) return null;
  return { ...parsed, line };
}
