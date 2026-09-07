/**
 * Internal Git command runner.
 *
 * All public Git functions in this layer go through {@link runGit} so
 * `execa` is never called from feature code, and error handling is centralized.
 */

import { execa, type ExecaError } from "execa";
import { GitError, type GitErrorCode } from "./types.js";

export interface GitRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  isGitMissing?: boolean;
}

function isMissingGitResult(result: {
  failed?: boolean;
  shortMessage?: string;
  stderr?: string;
  exitCode?: number;
}): boolean {
  if (result.exitCode === 127) return true;
  const msg = `${result.shortMessage ?? ""} ${result.stderr ?? ""}`.toLowerCase();
  return (
    msg.includes("enoent") ||
    msg.includes("not found") ||
    msg.includes("is not recognized as an internal or external command")
  );
}

function isEnoentError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as NodeJS.ErrnoException & { shortMessage?: string };
  const msg = `${err.message ?? ""} ${err.shortMessage ?? ""}`.toLowerCase();
  return (
    err.code === "ENOENT" ||
    msg.includes("enoent") ||
    msg.includes("not found")
  );
}

/**
 * Invoke a Git subcommand with argument-array form (no shell).
 *
 * The promise never rejects; callers inspect `exitCode` to detect failure
 * and translate it into structured errors or graceful fallbacks.
 */
export async function runGit(
  args: string[],
  cwd: string,
): Promise<GitRunResult> {
  try {
    const result = await execa("git", args, {
      cwd,
      reject: false,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
    });

    if (result.failed && isMissingGitResult(result)) {
      return {
        exitCode: 127,
        stdout: "",
        stderr: "git: command not found",
        isGitMissing: true,
      };
    }

    const exitCode = result.exitCode ?? (result.failed ? 1 : 0);
    return {
      exitCode,
      stdout: typeof result.stdout === "string" ? result.stdout : "",
      stderr: typeof result.stderr === "string" ? result.stderr : "",
    };
  } catch (error) {
    if (isEnoentError(error)) {
      return {
        exitCode: 127,
        stdout: "",
        stderr: "git: command not found",
        isGitMissing: true,
      };
    }
    return {
      exitCode: 1,
      stdout: "",
      stderr: (error as Error)?.message ?? "Command failed",
    };
  }
}

/**
 * Throw a {@link GitError} for a given code, using stderr when available
 * for the human-readable message.
 */
export function gitError(
  code: GitErrorCode,
  args: string[],
  stderr: string,
  exitCode: number,
  cause?: unknown,
): GitError {
  const trimmed = stderr.trim();
  const detail = trimmed.length > 0 ? trimmed : `exit code ${exitCode}`;
  return new GitError(
    code,
    `git ${args.join(" ")} failed: ${detail}`,
    cause,
  );
}

/**
 * Verify that `repoRoot` is inside a Git repository.
 *
 * Throws `git-missing` if the Git binary is not found on PATH.
 * Throws `not-a-repository` if the directory is not inside a working tree.
 */
export async function assertRepo(repoRoot: string): Promise<void> {
  const result = await runGit(["rev-parse", "--show-toplevel"], repoRoot);
  if (result.exitCode !== 0) {
    if (result.isGitMissing) {
      throw gitError(
        "git-missing",
        ["rev-parse", "--show-toplevel"],
        result.stderr,
        result.exitCode,
      );
    }
    throw gitError(
      "not-a-repository",
      ["rev-parse", "--show-toplevel"],
      result.stderr,
      result.exitCode,
    );
  }
}

/**
 * Wrap a raw execa-style error from a non-reject run.
 */
export function wrapCommandError(
  args: string[],
  error: ExecaError,
): GitError {
  const code: GitErrorCode = isEnoentError(error)
    ? "git-missing"
    : "command-failed";
  return new GitError(
    code,
    `git ${args.join(" ")} failed: ${error.shortMessage ?? error.message}`,
    error,
  );
}
