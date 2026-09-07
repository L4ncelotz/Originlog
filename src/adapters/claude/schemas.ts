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

/**
 * Content block schemas for Claude Code JSONL transcripts.
 */
export const ClaudeContentBlockSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string() }).passthrough(),
  z
    .object({
      type: z.literal("tool_use"),
      id: z.string(),
      name: z.string(),
      input: z.record(z.string(), z.unknown()),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("tool_result"),
      tool_use_id: z.string(),
      content: z.unknown().optional(),
      is_error: z.boolean().optional(),
    })
    .passthrough(),
  z
    .object({ type: z.literal("thinking"), thinking: z.string() })
    .passthrough(),
  z.object({ type: z.string() }).passthrough(),
]);

export type ClaudeContentBlock = z.infer<typeof ClaudeContentBlockSchema>;

/**
 * Message payload schema for user and assistant transcript lines.
 */
export const ClaudeMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]).optional(),
    id: z.string().optional(),
    content: z.union([z.string(), z.array(ClaudeContentBlockSchema)]).optional(),
    usage: z
      .object({
        input_tokens: z.number().optional(),
        output_tokens: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type ClaudeMessage = z.infer<typeof ClaudeMessageSchema>;

/**
 * Schema for a single line in a Claude Code session .jsonl transcript.
 */
export const ClaudeTranscriptLineSchema = z
  .object({
    type: z.enum(["user", "assistant", "system", "progress"]).optional(),
    sessionId: z.string().optional(),
    uuid: z.string().optional(),
    timestamp: z.union([z.number(), z.string()]).optional(),
    cwd: z.string().optional(),
    promptId: z.string().optional(),
    requestId: z.string().optional(),
    isSidechain: z.boolean().optional(),
    isMeta: z.boolean().optional(),
    isCompactSummary: z.boolean().optional(),
    message: ClaudeMessageSchema.optional(),
  })
  .passthrough();

export type ClaudeTranscriptLine = z.infer<typeof ClaudeTranscriptLineSchema>;

/**
 * Safely parse a single line from a Claude Code .jsonl transcript.
 * Returns null if malformed, empty, or not a JSON object.
 */
export function parseTranscriptLine(line: string): ClaudeTranscriptLine | null {
  if (typeof line !== "string") return null;
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
    const result = ClaudeTranscriptLineSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
