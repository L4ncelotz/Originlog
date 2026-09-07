/**
 * Minimal Zod schemas for Claude Code discovery.
 *
 * Validates untrusted Claude Code configuration and history entries
 * encountered during detection.
 *
 * Uses `.passthrough()` so unknown or newly introduced fields
 * by Anthropic do not cause validation failures.
 */

import { z } from "zod";

/**
 * Schema for an entry in ~/.claude/history.jsonl.
 * Matches actual Claude Code history records observed on disk.
 */
export const ClaudeHistoryEntrySchema = z
  .object({
    display: z.string().optional(),
    pastedContents: z.unknown().optional(),
    timestamp: z.union([z.number(), z.string()]).optional(),
    project: z.string().optional(),
    sessionId: z.string().optional(),
  })
  .passthrough();

export type ClaudeHistoryEntry = z.infer<typeof ClaudeHistoryEntrySchema>;

/**
 * Minimal schema for candidate session file headers/metadata if probed.
 */
export const ClaudeSessionFileHeaderSchema = z
  .object({
    sessionId: z.string().optional(),
    id: z.string().optional(),
    type: z.string().optional(),
    timestamp: z.union([z.number(), z.string()]).optional(),
    project: z.string().optional(),
  })
  .passthrough();

export type ClaudeSessionFileHeader = z.infer<
  typeof ClaudeSessionFileHeaderSchema
>;

/**
 * Safely parse a history.jsonl line.
 * Returns null if malformed, empty, or not an object.
 */
export function parseHistoryEntry(line: unknown): ClaudeHistoryEntry | null {
  if (typeof line === "string") {
    const trimmed = line.trim();
    if (trimmed.length === 0) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return null;
      }
      const result = ClaudeHistoryEntrySchema.safeParse(parsed);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }
  if (typeof line === "object" && line !== null && !Array.isArray(line)) {
    const result = ClaudeHistoryEntrySchema.safeParse(line);
    return result.success ? result.data : null;
  }
  return null;
}
