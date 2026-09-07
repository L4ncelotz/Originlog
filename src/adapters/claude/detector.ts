/**
 * Claude Code discovery and detection.
 *
 * Locates candidate Claude Code session and history directories, verifies
 * their readability, counts candidate session files, and collects
 * diagnostics for permission or format issues.
 *
 * Centralizes all Claude-specific filesystem path rules so no assumptions
 * leak into other adapters or the core engine.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { AdapterContext, AgentDetection } from "../types.js";
import { parseHistoryEntry } from "./schemas.js";

/**
 * Normalize a path to use forward slashes and strip trailing slashes,
 * handling Windows backslashes cross-platform.
 */
export function toPosixPath(p: string): string {
  if (!p) return "";
  let normalized = p.replace(/\\/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Cross-platform check whether two project paths refer to the same location.
 * Compares normalized paths, treating Windows drive letters case-insensitively.
 */
export function isPathMatchingProject(
  projectPath: string | undefined,
  targetPath: string | undefined,
): boolean {
  if (!projectPath || !targetPath) return false;
  const p1 = toPosixPath(projectPath);
  const p2 = toPosixPath(targetPath);

  const isWindows1 = /^[a-zA-Z]:/.test(p1);
  const isWindows2 = /^[a-zA-Z]:/.test(p2);

  if (isWindows1 || isWindows2) {
    return p1.toLowerCase() === p2.toLowerCase();
  }
  return p1 === p2;
}

/**
 * Enumerate all candidate source paths to inspect for Claude Code data.
 *
 * Centralizes path rules:
 *  1. `~/.claude` (global configuration & session root)
 *  2. `~/.claude/history.jsonl` (prompt history file)
 *  3. `~/.claude/sessions` (session files)
 *  4. `~/.claude/projects` (per-project session files)
 *  5. `<repoRoot>/.claude` or `<cwd>/.claude` (project-local metadata)
 */
export function getClaudeCandidatePaths(
  context: AdapterContext,
): string[] {
  const candidates: string[] = [];

  if (context.homeDir && context.homeDir.trim().length > 0) {
    const globalClaude = path.join(context.homeDir, ".claude");
    candidates.push(toPosixPath(globalClaude));
    candidates.push(toPosixPath(path.join(globalClaude, "history.jsonl")));
    candidates.push(toPosixPath(path.join(globalClaude, "sessions")));
    candidates.push(toPosixPath(path.join(globalClaude, "projects")));
  }

  const projectBase = context.repoRoot ?? context.cwd;
  if (projectBase && projectBase.trim().length > 0) {
    const localClaude = path.join(projectBase, ".claude");
    const posixLocal = toPosixPath(localClaude);
    if (!candidates.includes(posixLocal)) {
      candidates.push(posixLocal);
    }
  }

  return candidates;
}

/**
 * Safely check if a path exists and get its file/directory status.
 * Never throws.
 */
async function checkPath(
  target: string,
): Promise<{
  exists: boolean;
  isDirectory: boolean;
  isFile: boolean;
  error?: string;
}> {
  try {
    const stat = await fs.stat(target);
    return {
      exists: true,
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile(),
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { exists: false, isDirectory: false, isFile: false };
    }
    return {
      exists: false,
      isDirectory: false,
      isFile: false,
      error: (err as Error).message,
    };
  }
}

/**
/** Known metadata, configuration, or non-transcript filenames to ignore as sessions. */
const NON_SESSION_FILE_NAMES = new Set([
  "history.jsonl",
  "settings.json",
  "known_marketplaces.json",
  "stats-cache.json",
]);

/**
 * Check whether a filename corresponds to a candidate session transcript file.
 * Rejects history.jsonl, settings, marketplaces, caches, and *.meta.json files.
 */
export function isCandidateSessionFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (NON_SESSION_FILE_NAMES.has(lower)) {
    return false;
  }
  if (lower.endsWith(".meta.json")) {
    return false;
  }
  const ext = path.extname(lower);
  return ext === ".json" || ext === ".jsonl";
}

/**
 * Safely scan a directory for session files (.json and .jsonl).
 * Recursively scans one level of subdirectories (e.g. projects/<id>/).
 * Automatically excludes configuration and metadata files like history.jsonl.
 */
export async function scanSessionFiles(
  dir: string,
  warnings: string[],
): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile()) {
        if (isCandidateSessionFile(entry.name)) {
          files.push(toPosixPath(fullPath));
        }
      } else if (entry.isDirectory()) {
        // One level down (e.g., project subdirectories)
        try {
          const subEntries = await fs.readdir(fullPath, {
            withFileTypes: true,
          });
          for (const sub of subEntries) {
            if (sub.isFile() && isCandidateSessionFile(sub.name)) {
              files.push(toPosixPath(path.join(fullPath, sub.name)));
            }
          }
        } catch (subErr) {
          warnings.push(
            `Could not read sub-directory ${toPosixPath(fullPath)}: ${(subErr as Error).message}`,
          );
        }
      }
    }
  } catch (err) {
    warnings.push(
      `Could not read directory ${toPosixPath(dir)}: ${(err as Error).message}`,
    );
  }
  return files;
}

/**
 * Parse history.jsonl safely, counting unique session IDs and reporting malformed lines.
 */
async function countHistorySessions(
  historyFile: string,
  warnings: string[],
): Promise<Set<string>> {
  const sessionIds = new Set<string>();
  try {
    const content = await fs.readFile(historyFile, "utf8");
    const lines = content.split(/\r?\n/);
    let lineNumber = 0;
    for (const line of lines) {
      lineNumber++;
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      const entry = parseHistoryEntry(trimmed);
      if (entry) {
        if (entry.sessionId && entry.sessionId.trim().length > 0) {
          sessionIds.add(entry.sessionId.trim());
        }
      } else {
        warnings.push(
          `Malformed entry at line ${lineNumber} in ${toPosixPath(historyFile)}`,
        );
      }
    }
  } catch (err) {
    warnings.push(
      `Could not read history file ${toPosixPath(historyFile)}: ${(err as Error).message}`,
    );
  }
  return sessionIds;
}

/**
 * Probe the environment for Claude Code data.
 *
 * Returns an {@link AgentDetection} report detailing whether Claude Code
 * was detected, existing source paths, estimated session count, and
 * any access or format warnings encountered.
 *
 * Never throws.
 */
export async function detectClaude(
  context: AdapterContext,
): Promise<AgentDetection> {
  const sourcePaths: string[] = [];
  const warnings: string[] = [];
  const sessionIds = new Set<string>();
  let sessionFileCount = 0;

  const candidatePaths = getClaudeCandidatePaths(context);

  for (const candidate of candidatePaths) {
    const check = await checkPath(candidate);

    if (check.error) {
      warnings.push(
        `Permission or filesystem error for ${candidate}: ${check.error}`,
      );
      continue;
    }

    if (!check.exists) {
      continue;
    }

    sourcePaths.push(candidate);

    if (check.isFile && candidate.endsWith("history.jsonl")) {
      const ids = await countHistorySessions(candidate, warnings);
      for (const id of ids) {
        sessionIds.add(id);
      }
    } else if (check.isDirectory) {
      const baseName = path.basename(candidate);
      if (baseName === "sessions" || baseName === "projects") {
        const found = await scanSessionFiles(candidate, warnings);
        sessionFileCount += found.length;
        for (const f of found) {
          const id = path.basename(f, path.extname(f));
          sessionIds.add(id);
        }
      } else if (baseName === ".claude") {
        // Also check if local .claude has session files or history.jsonl
        const subHistory = toPosixPath(path.join(candidate, "history.jsonl"));
        const subCheck = await checkPath(subHistory);
        if (subCheck.exists && subCheck.isFile && !sourcePaths.includes(subHistory)) {
          sourcePaths.push(subHistory);
          const ids = await countHistorySessions(subHistory, warnings);
          for (const id of ids) {
            sessionIds.add(id);
          }
        }
      }
    }
  }

  const uniqueSourcePaths = [...new Set(sourcePaths)];
  const detected = uniqueSourcePaths.length > 0;
  const totalSessions = Math.max(sessionIds.size, sessionFileCount);

  return {
    detected,
    sourcePaths: uniqueSourcePaths,
    sessionCount: detected ? totalSessions : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
