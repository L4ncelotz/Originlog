/**
 * Claude Code agent adapter.
 *
 * Implements the {@link AgentAdapter} contract for Claude Code, integrating
 * discovery, listing, and session parsing without leaking Claude-specific
 * structures into the core model.
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
  scanSessionFiles,
  toPosixPath,
} from "./detector.js";
import {
  parseClaudeSession,
  parseClaudeSessionSummary,
} from "./parser.js";

/**
 * Scan a list of source paths for all candidate session files.
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
        if (
          baseName === "sessions" ||
          baseName === "projects" ||
          baseName === ".claude"
        ) {
          const files = await scanSessionFiles(candidate, warnings);
          sessionFiles.push(...files);
        }
      }
    } catch {
      // Path missing or inaccessible — detector already records warnings
    }
  }

  return [...new Set(sessionFiles)];
}

/**
 * List summaries for all Claude Code sessions discovered on disk.
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
      // Read first 50 lines for summary
      const lines = content.split(/\r?\n/).slice(0, 50).join("\n");
      const summary = parseClaudeSessionSummary(
        path.basename(file),
        lines,
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
