/**
 * `git diff` wrapper.
 *
 * Uses NUL-delimited output (`-z`) for `--name-status` and `--numstat`
 * so paths containing spaces, quotes, non-ASCII characters, or newlines
 * are handled safely and unambiguously.
 *
 * Combines three Git invocations to produce structured file-level diffs:
 *  - `-z --name-status` for per-file change kind and old path for renames
 *  - `-z --numstat` for additions / deletions and binary detection
 *  - `--patch` for unified diff hunk headers
 *
 * Validates failures from EVERY command.
 */

import { assertRepo, runGit } from "./runner.js";
import {
  GitError,
  type GitDiffFile,
  type GitDiffHunk,
  type GitDiffOptions,
  type GitDiffResult,
} from "./types.js";

const DEFAULT_RENAME_THRESHOLD = 50;

function mapDiffStatus(code: string): GitDiffFile["status"] {
  if (code === "A") return "added";
  if (code === "M" || code === "T" || code === "C") return "modified";
  if (code === "D") return "deleted";
  if (code.startsWith("R")) return "renamed";
  return "unknown";
}

function buildPathArgs(options: GitDiffOptions): string[] {
  if (!options.paths || options.paths.length === 0) return [];
  return ["--", ...options.paths];
}

function buildDiffCommand(options: GitDiffOptions): string[] {
  const staged = options.staged === true;
  const findRenames = options.findRenames !== false;
  const args: string[] = [
    "diff",
    staged ? "--cached" : "--no-color",
    "-z",
    "--name-status",
  ];
  if (findRenames) {
    args.push(`--find-renames=${DEFAULT_RENAME_THRESHOLD}`);
  }
  args.push(...buildPathArgs(options));
  return args;
}

function buildNumstatCommand(options: GitDiffOptions): string[] {
  const staged = options.staged === true;
  const args: string[] = [
    "diff",
    staged ? "--cached" : "--no-color",
    "-z",
    "--numstat",
  ];
  if (options.findRenames !== false) {
    args.push(`--find-renames=${DEFAULT_RENAME_THRESHOLD}`);
  }
  args.push(...buildPathArgs(options));
  return args;
}

function buildRawCommand(options: GitDiffOptions): string[] {
  const staged = options.staged === true;
  const args: string[] = [
    "diff",
    staged ? "--cached" : "--no-color",
    "--patch",
  ];
  if (options.findRenames !== false) {
    args.push(`--find-renames=${DEFAULT_RENAME_THRESHOLD}`);
  }
  args.push(...buildPathArgs(options));
  return args;
}

/**
 * Parse NUL-delimited output from `git diff -z --numstat`.
 *
 * Regular entry: `<adds>\t<dels>\t<path>\0`
 * Rename entry: `<adds>\t<dels>\t\0<oldPath>\0<newPath>\0`
 */
function parseNumstatZ(
  stdout: string,
): Map<string, { additions?: number; deletions?: number }> {
  const result = new Map<string, { additions?: number; deletions?: number }>();
  const tokens = stdout.split("\0");

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    const parts = token.split("\t");
    if (parts.length >= 3) {
      const adds = parts[0] ?? "";
      const dels = parts[1] ?? "";
      const filePath = parts[2] ?? "";

      const entry: { additions?: number; deletions?: number } = {};
      if (adds !== "-" && dels !== "-") {
        const a = Number.parseInt(adds, 10);
        const d = Number.parseInt(dels, 10);
        if (Number.isFinite(a)) entry.additions = a;
        if (Number.isFinite(d)) entry.deletions = d;
      }

      if (filePath === "") {
        // Rename: next two tokens are oldPath then newPath
        i++; // skip oldPath
        const newPath = tokens[++i];
        if (newPath) {
          result.set(newPath, entry);
        }
      } else {
        result.set(filePath, entry);
      }
    }
  }
  return result;
}

/**
 * Parse NUL-delimited output from `git diff -z --name-status`.
 *
 * Regular entry: `<status>\0<path>\0`
 * Rename entry: `<statusR...>\0<oldPath>\0<newPath>\0`
 */
function parseNameStatusZ(
  stdout: string,
): Map<string, { status: GitDiffFile["status"]; oldPath?: string }> {
  const result = new Map<
    string,
    { status: GitDiffFile["status"]; oldPath?: string }
  >();
  const tokens = stdout.split("\0");

  for (let i = 0; i < tokens.length; i++) {
    const code = tokens[i];
    if (!code) continue;

    if (code.startsWith("R") || code.startsWith("C")) {
      const oldPath = tokens[++i] ?? "";
      const newPath = tokens[++i] ?? "";
      if (newPath) {
        result.set(newPath, {
          status: mapDiffStatus(code),
          ...(oldPath.length > 0 ? { oldPath } : {}),
        });
      }
    } else {
      const filePath = tokens[++i] ?? "";
      if (filePath) {
        result.set(filePath, {
          status: mapDiffStatus(code),
        });
      }
    }
  }
  return result;
}

const HUNK_HEADER_RE =
  /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

function parseHunks(stdout: string): Map<string, GitDiffHunk[]> {
  const result = new Map<string, GitDiffHunk[]>();
  let currentPath: string | null = null;

  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      currentPath = m ? (m[2] ?? m[1] ?? null) : null;
      continue;
    }
    if (line.startsWith("rename from ")) {
      currentPath = line.slice("rename from ".length).trim();
      continue;
    }
    if (line.startsWith("rename to ")) {
      currentPath = line.slice("rename to ".length).trim();
      continue;
    }
    if (
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }
    const match = line.match(HUNK_HEADER_RE);
    if (!match || currentPath === null) continue;

    const oldStart = Number.parseInt(match[1] ?? "0", 10);
    const oldLines = match[2] ? Number.parseInt(match[2], 10) : 1;
    const newStart = Number.parseInt(match[3] ?? "0", 10);
    const newLines = match[4] ? Number.parseInt(match[4], 10) : 1;
    const header = (match[5] ?? "").trim();
    const hunk: GitDiffHunk = {
      oldStart,
      oldLines,
      newStart,
      newLines,
      ...(header.length > 0 ? { header } : {}),
    };
    const list = result.get(currentPath) ?? [];
    list.push(hunk);
    result.set(currentPath, list);
  }
  return result;
}

/**
 * Compute a structured diff for a repository.
 *
 * Returns the files that changed between the index and the working tree
 * (or between HEAD and the index when `options.staged` is `true`).
 *
 * Validates failures from every underlying Git command (`--name-status`,
 * `--numstat`, and `--patch`).
 */
export async function getDiff(
  repoRoot: string,
  options: GitDiffOptions = {},
): Promise<GitDiffResult> {
  await assertRepo(repoRoot);

  const [nameStatus, numstat, raw] = await Promise.all([
    runGit(buildDiffCommand(options), repoRoot),
    runGit(buildNumstatCommand(options), repoRoot),
    runGit(buildRawCommand(options), repoRoot),
  ]);

  if (nameStatus.isGitMissing || numstat.isGitMissing || raw.isGitMissing) {
    throw new GitError("git-missing", "Git executable not found in PATH");
  }

  if (nameStatus.exitCode !== 0) {
    throw new GitError(
      "command-failed",
      `git diff --name-status failed: ${nameStatus.stderr.trim() || `exit code ${nameStatus.exitCode}`}`,
    );
  }

  if (numstat.exitCode !== 0) {
    throw new GitError(
      "command-failed",
      `git diff --numstat failed: ${numstat.stderr.trim() || `exit code ${numstat.exitCode}`}`,
    );
  }

  if (raw.exitCode !== 0) {
    throw new GitError(
      "command-failed",
      `git diff --patch failed: ${raw.stderr.trim() || `exit code ${raw.exitCode}`}`,
    );
  }

  const statuses = parseNameStatusZ(nameStatus.stdout);
  const stats = parseNumstatZ(numstat.stdout);
  const hunks = parseHunks(raw.stdout);

  const files: GitDiffFile[] = [];
  for (const [path, info] of statuses.entries()) {
    const stat = stats.get(path);
    const fileHunks = hunks.get(path);
    const file: GitDiffFile = {
      path,
      status: info.status,
      ...(info.oldPath ? { oldPath: info.oldPath } : {}),
      ...(stat?.additions !== undefined ? { additions: stat.additions } : {}),
      ...(stat?.deletions !== undefined ? { deletions: stat.deletions } : {}),
      ...(fileHunks && fileHunks.length > 0 ? { hunks: fileHunks } : {}),
    };
    files.push(file);
  }

  return { files };
}
