/**
 * Git layer types.
 *
 * The Git layer exposes repository facts only; it never decides which
 * agent caused a change (architecture Rule B). All types here model
 * what Git itself reports.
 */

/** Per-file state as reported by `git status` or `git diff`. */
export type GitFileStatus =
  | "unmodified"
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed"
  | "untracked"
  | "ignored"
  | "conflicted"
  | "unknown";

/** Single-file status entry from `git status --porcelain=v1`. */
export interface GitStatusEntry {
  /** Repository-relative path using forward slashes. */
  path: string;
  /** Original path for renames; `undefined` when not a rename. */
  oldPath?: string;
  /** Status in the index (staged). */
  indexStatus: GitFileStatus;
  /** Status in the worktree (unstaged). */
  worktreeStatus: GitFileStatus;
  /** True for files not yet tracked by Git. */
  untracked: boolean;
}

/** Repository status summary. */
export interface GitStatus {
  /** True when no entries are reported. */
  clean: boolean;
  entries: GitStatusEntry[];
}

/** A single parsed commit from `git log`. */
export interface GitCommit {
  /** Full commit hash. */
  hash: string;
  /** Abbreviated commit hash. */
  shortHash: string;
  authorName: string;
  authorEmail?: string;
  authoredAt: Date;
  committedAt: Date;
  /** First line of the commit message. */
  subject: string;
}

/** One hunk of a unified diff (`@@ -X,Y +A,B @@`). */
export interface GitDiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Optional hunk header text after the `@@` line. */
  header?: string;
}

/** A single file in a diff. */
export interface GitDiffFile {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "unknown";
  additions?: number;
  deletions?: number;
  hunks?: GitDiffHunk[];
}

/** Result of a diff query. */
export interface GitDiffResult {
  files: GitDiffFile[];
}

/** Blame information for a single line. */
export interface GitBlameLine {
  line: number;
  commitHash: string;
  author?: string;
  /** Author timestamp (when the line was authored). */
  authorTime?: Date;
  /** Committer timestamp (when the commit was recorded in Git). */
  committedAt?: Date;
  content?: string;
  /** True when the line has uncommitted changes in the worktree (zero-OID). */
  uncommitted?: boolean;
}

/** Options accepted by `getDiff`. */
export interface GitDiffOptions {
  /** Diff staged (index) changes instead of the working tree. */
  staged?: boolean;
  /** Limit the diff to specific paths. */
  paths?: string[];
  /** Detect renames; default `true` with a 50% similarity threshold. */
  findRenames?: boolean;
}

/** Options accepted by `getLog`. */
export interface GitLogOptions {
  /** Maximum number of commits to return. If omitted, returns all matching commits. */
  maxCount?: number;
  /**
   * Base revision to exclude (e.g. "main", "v0.1.0", or a commit hash).
   * When provided with `to`, returns commits in `from..to`.
   * When provided alone, returns commits in `from..HEAD`.
   */
  from?: string;
  /**
   * Target revision to inspect (defaults to "HEAD").
   * When provided alone, queries commits reachable from `to`.
   */
  to?: string;
  /** Limit log to commits touching these paths. */
  paths?: string[];
}

/** Stable error codes raised by the Git layer. */
export type GitErrorCode =
  | "not-a-repository"
  | "file-not-found"
  | "git-missing"
  | "command-failed";

/** Error raised by the Git layer. */
export class GitError extends Error {
  readonly code: GitErrorCode;
  readonly cause?: unknown;
  constructor(code: GitErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "GitError";
    this.code = code;
    this.cause = cause;
  }
}
