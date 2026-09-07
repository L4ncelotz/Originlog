/**
 * Claude Code agent adapter.
 *
 * Implements the {@link AgentAdapter} contract for Claude Code, integrating
 * discovery, listing, and session parsing without leaking Claude-specific
 * structures into the core model.
 *
 * Guarantees:
 * - Metadata/config files (history.jsonl, settings.json) are never treated as session transcripts.
 * - Summaries are computed from complete session data, never partial estimates.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  AdapterContext,
  AgentAdapter,
} from "../types.js";
import type {
  NormalizedSession,
  NormalizedSessionSummary,
} from "../../core/sessions.js";
import {
  detectClaude,
  getClaudeCandidatePaths,
  isCandidateSessionFile,
  scanSessionFiles,
  toPosixPath,
} from "./detector.js";
import {
  parseClaudeSession,
  parseClaudeSessionSummary,
} from "./parser.js";

/**
 * Scan a list of source paths for all candidate session files.
 * Rejects non-session files like history.jsonl, settings, and metadata files.
 */
async function findAllSessionFiles(
  context: AdapterContext,
  warnings: string[],
): Promise<string[]> {
  const candidatePaths = getClaudeCandidatePaths(context);
  const sessionFiles: string[] = [];

  for (const candidate of candidatePaths) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) {
        const baseName = path.basename(candidate);
        // Only scan directories that actually hold session transcripts
        if (baseName === "sessions" || baseName === "projects") {
          const files = await scanSessionFiles(candidate, warnings);
          sessionFiles.push(...files);
        } else if (baseName === ".claude") {
          // Inside .claude root, look only in sessions/ and projects/ subdirectories.
          // Top-level files in .claude/ (e.g. history.jsonl, settings.json) are not transcripts.
          for (const sub of ["sessions", "projects"]) {
            const subDir = path.join(candidate, sub);
            try {
              const subStat = await fs.stat(subDir);
              if (subStat.isDirectory()) {
                const files = await scanSessionFiles(subDir, warnings);
                sessionFiles.push(...files);
              }
            } catch {
              // Subdirectory does not exist
            }
          }
        }
      }
    } catch {
      // Path missing or inaccessible — detector already records warnings
    }
  }

  return [...new Set(sessionFiles.filter(isCandidateSessionFile))];
}

/**
 * List summaries for all Claude Code sessions discovered on disk.
 *
 * Reads complete transcript files so startedAt, endedAt, eventCount,
 * and promptPreview are accurate facts, not partial estimates.
 */
async function listSessions(
  context: AdapterContext,
): Promise<NormalizedSessionSummary[]> {
  const detection = await detectClaude(context);
  if (!detection.detected) {
    return [];
  }

  const warnings: string[] = [];
  const files = await findAllSessionFiles(context, warnings);
  const summariesMap = new Map<string, NormalizedSessionSummary>();

  for (const file of files) {
    try {
      const content = await fs.readFile(file, "utf8");
      const summary = parseClaudeSessionSummary(
        path.basename(file),
        content,
        toPosixPath(file),
        context.repoRoot,
      );
      if (summary) {
        summariesMap.set(summary.id, summary);
      }
    } catch {
      // Skip unreadable files
    }
  }

  const summaries = [...summariesMap.values()];

  // Sort descending by startedAt (most recent first; undefined at end)
  summaries.sort((a, b) => {
    if (!a.startedAt && !b.startedAt) return 0;
    if (!a.startedAt) return 1;
    if (!b.startedAt) return -1;
    return b.startedAt.getTime() - a.startedAt.getTime();
  });

  return summaries;
}

/**
 * Load a full normalized session by its ID.
 *
 * Throws an Error if the session file is not found on disk.
 * Explicitly rejects metadata/config files from being loaded as sessions.
 */
async function loadSession(
  sessionId: string,
  context: AdapterContext,
): Promise<NormalizedSession> {
  const warnings: string[] = [];
  const files = await findAllSessionFiles(context, warnings);

  let targetFile: string | undefined;

  // 1. Check exact match on file basename (without extension)
  for (const f of files) {
    const base = path.basename(f, path.extname(f));
    if (base === sessionId) {
      targetFile = f;
      break;
    }
  }

  // 2. If not matched by filename, probe files by reading header sessionId
  if (!targetFile) {
    for (const f of files) {
      try {
        const content = await fs.readFile(f, "utf8");
        const lines = content.split(/\r?\n/).slice(0, 20).join("\n");
        const summary = parseClaudeSessionSummary(
          path.basename(f),
          lines,
        );
        if (summary && summary.id === sessionId) {
          targetFile = f;
          break;
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  if (!targetFile) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const fullContent = await fs.readFile(targetFile, "utf8");
  return parseClaudeSession(
    sessionId,
    fullContent,
    toPosixPath(targetFile),
    context.repoRoot,
  );
}

/**
 * Claude Code agent adapter implementation.
 */
export const claudeAdapter: AgentAdapter = {
  id: "claude",
  displayName: "Claude Code",
  detect: detectClaude,
  listSessions,
  loadSession,
};
