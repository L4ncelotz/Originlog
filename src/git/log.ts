/**
 * `git log` wrapper.
 *
 * Uses the `-z` flag so commits are separated by NUL bytes, which
 * guarantees correct parsing even when commit messages contain
 * unusual characters or newlines.
 *
 * Implements documented revision range semantics:
 *  - `from` and `to` provided: queries `from..to`
 *  - `from` provided alone: queries `from..HEAD`
 *  - `to` provided alone: queries commits reachable from `to`
 *  - neither provided: queries default history (`HEAD`)
 */

import { assertRepo, runGit } from "./runner.js";
import { GitError, type GitCommit, type GitLogOptions } from "./types.js";

function buildLogCommand(options: GitLogOptions): string[] {
  const args: string[] = [
    "log",
    "-z",
    "--format=%H%n%h%n%an%n%ae%n%aI%n%cI%n%s",
  ];

  if (options.maxCount !== undefined && options.maxCount > 0) {
    args.push(`--max-count=${options.maxCount}`);
  }

  if (options.from && options.to) {
    args.push(`${options.from}..${options.to}`);
  } else if (options.from) {
    args.push(`${options.from}..HEAD`);
  } else if (options.to) {
    args.push(options.to);
  }

  if (options.paths && options.paths.length > 0) {
    args.push("--", ...options.paths);
  }

  return args;
}

function parseCommitBlock(block: string): GitCommit | null {
  const lines = block.split("\n");
  if (lines.length < 7) return null;
  const [
    hash,
    shortHash,
    authorName,
    authorEmail,
    authoredAt,
    committedAt,
    ...rest
  ] = lines;
  if (!hash || !shortHash || !authorName || !authoredAt || !committedAt) {
    return null;
  }
  const subject = rest.join("\n").trim();

  const authoredDate = new Date(authoredAt);
  const committedDate = new Date(committedAt);
  if (Number.isNaN(authoredDate.getTime())) return null;
  if (Number.isNaN(committedDate.getTime())) return null;

  const trimmedEmail = authorEmail ?? "";
  return {
    hash,
    shortHash,
    authorName,
    ...(trimmedEmail.length > 0 ? { authorEmail: trimmedEmail } : {}),
    authoredAt: authoredDate,
    committedAt: committedDate,
    subject,
  };
}

/**
 * Return parsed commits for a repository, in reverse-chronological order.
 *
 * Throws {@link GitError} with `git-missing` when Git is not installed,
 * or `not-a-repository` when `repoRoot` is not inside a Git working tree.
 * Returns `[]` when the repository has no commits yet and no explicit
 * revision was requested.
 * Throws `command-failed` when an invalid revision or range is specified.
 */
export async function getLog(
  repoRoot: string,
  options: GitLogOptions = {},
): Promise<GitCommit[]> {
  await assertRepo(repoRoot);
  const result = await runGit(buildLogCommand(options), repoRoot);

  if (result.isGitMissing) {
    throw new GitError("git-missing", "Git executable not found in PATH");
  }

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toLowerCase();
    const isExplicitRevision = Boolean(options.from || options.to);
    if (
      !isExplicitRevision &&
      (stderr.includes("does not have any commits yet") ||
        stderr.includes("bad default revision 'head'"))
    ) {
      return [];
    }
    throw new GitError(
      "command-failed",
      `git log failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`,
    );
  }
  if (result.stdout.length === 0) return [];

  const blocks = result.stdout.split("\0");
  const commits: GitCommit[] = [];
  for (const block of blocks) {
    if (block.length === 0) continue;
    const parsed = parseCommitBlock(block);
    if (parsed) commits.push(parsed);
  }
  return commits;
}
