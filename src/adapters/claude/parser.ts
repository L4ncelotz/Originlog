/**
 * Claude Code JSONL transcript parser.
 *
 * Translates raw Claude Code session records into the normalized Originlog
 * model (NormalizedSession, NormalizedEvent).
 *
 * Follows core principles:
 * - Tolerant of schema evolution and unknown event types.
 * - Missing data remains unknown (timestamps are never fabricated).
 * - Preserves failed tool attempts as evidence with success=false and metadata.
 * - Resumed session entries are deduplicated by UUID.
 * - Resolves canonical sessionId upfront so every event matches the session ID.
 * - Line ranges are strictly validated as 1-based data (startLine >= 1, endLine >= startLine).
 */

import {
  createNormalizedEvent,
  type EventType,
  type LineRange,
  type NormalizedEvent,
} from "../../core/events.js";
import {
  createNormalizedSession,
  normalizePath,
  summarizeSession,
  type NormalizedSession,
  type NormalizedSessionSummary,
} from "../../core/sessions.js";
import {
  parseTranscriptLine,
  type ClaudeContentBlock,
  type ClaudeTranscriptLine,
} from "./schemas.js";

/** Regex to deterministically identify test command invocations. */
const TEST_COMMAND_PATTERN =
  /\b(npm\s+test|vitest|jest|pytest|cargo\s+test|go\s+test|dotnet\s+test|mix\s+test|ruby\s+-e|rspec|mocha)\b/i;

/** Tools that read files rather than modifying them. */
const FILE_READ_TOOLS = new Set(["Read", "NotebookRead"]);

/**
 * Parse a raw timestamp from a Claude Code line (number epoch-ms or ISO string).
 * Returns undefined if missing or unparseable. Never fabricates Date.
 */
function parseTimestamp(value: number | string | undefined): Date | undefined {
  if (value === undefined || value === null) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Extract human-readable text from a message content field.
 */
function extractTextContent(
  content: string | ClaudeContentBlock[] | undefined,
): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

/**
 * Determine if a user transcript line represents a true human prompt.
 * Skips sidechains, metadata instructions, compaction summaries,
 * and pure tool-result returns.
 */
function isUserPromptLine(line: ClaudeTranscriptLine): boolean {
  if (line.type !== "user") return false;
  if (!line.promptId) return false;
  if (line.isSidechain || line.isMeta || line.isCompactSummary) return false;

  const content = line.message?.content;
  if (!content) return false;

  if (Array.isArray(content)) {
    if (content.length === 0) return false;
    const allToolResults = content.every((b) => b && b.type === "tool_result");
    if (allToolResults) return false;
  }

  if (typeof content === "string" && /^\[Request interrupted/.test(content)) {
    return false;
  }

  return true;
}

/**
 * Safely parse and validate a 1-based line range from tool input.
 * Guarantees startLine >= 1 and endLine >= startLine.
 * Returns undefined if values are missing, non-integer, or invalid.
 */
function parseReadLineRange(
  input: Record<string, unknown>,
): LineRange | undefined {
  // 1. Check offset + limit (Claude Read tool)
  if (
    typeof input.offset === "number" &&
    typeof input.limit === "number" &&
    Number.isInteger(input.offset) &&
    Number.isInteger(input.limit) &&
    input.offset >= 1 &&
    input.limit >= 1
  ) {
    const endLine = input.offset + input.limit - 1;
    if (endLine >= input.offset) {
      return { startLine: input.offset, endLine };
    }
  }

  // 2. Check view_range: [start, end] (Claude View tool / range format)
  if (
    Array.isArray(input.view_range) &&
    input.view_range.length === 2 &&
    typeof input.view_range[0] === "number" &&
    typeof input.view_range[1] === "number" &&
    Number.isInteger(input.view_range[0]) &&
    Number.isInteger(input.view_range[1]) &&
    input.view_range[0] >= 1 &&
    input.view_range[1] >= input.view_range[0]
  ) {
    return {
      startLine: input.view_range[0],
      endLine: input.view_range[1],
    };
  }

  return undefined;
}

/**
 * Parse a Claude Code session .jsonl transcript into a {@link NormalizedSession}.
 *
 * @param sessionId Fallback session ID if not recorded within the transcript.
 * @param jsonlContent The raw string content of the session .jsonl file.
 * @param sourcePath Absolute path to the on-disk record.
 * @param repoRoot Optional repository root to normalize file paths against.
 */
export function parseClaudeSession(
  sessionId: string,
  jsonlContent: string,
  sourcePath: string,
  repoRoot?: string,
): NormalizedSession {
  const lines = jsonlContent.split(/\r?\n/);
  const parsedLines: ClaudeTranscriptLine[] = [];

  // Parse lines and track seen UUIDs to deduplicate resumed session replays
  const seenUuids = new Set<string>();
  for (const rawLine of lines) {
    if (rawLine.trim().length === 0) continue;
    const parsed = parseTranscriptLine(rawLine);
    if (!parsed) continue;

    if (parsed.uuid) {
      if (seenUuids.has(parsed.uuid)) continue;
      seenUuids.add(parsed.uuid);
    }
    parsedLines.push(parsed);
  }

  // Pre-pass 1: collect tool_use IDs that ended in an error and their error messages
  const failedTools = new Map<string, { errorMessage?: string }>();
  for (const line of parsedLines) {
    const content = line.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          block &&
          block.type === "tool_result" &&
          "is_error" in block &&
          block.is_error === true &&
          "tool_use_id" in block &&
          typeof block.tool_use_id === "string"
        ) {
          let errorText: string | undefined;
          if ("content" in block) {
            if (typeof block.content === "string") {
              errorText = block.content;
            } else if (block.content !== undefined) {
              errorText = JSON.stringify(block.content);
            }
          }
          failedTools.set(block.tool_use_id, { errorMessage: errorText });
        }
      }
    }
  }

  // Pre-pass 2: resolve canonical sessionId and projectPath upfront
  let canonicalSessionId = sessionId;
  for (const line of parsedLines) {
    if (line.sessionId && line.sessionId.trim().length > 0) {
      canonicalSessionId = line.sessionId.trim();
      break;
    }
  }

  let projectPath: string | undefined;
  for (const line of parsedLines) {
    if (line.cwd && line.cwd.trim().length > 0) {
      projectPath = line.cwd.trim();
      break;
    }
  }

  let initialPrompt: string | undefined;
  let earliestDate: Date | undefined;
  let latestDate: Date | undefined;

  function updateTimestamps(ts: Date | undefined): void {
    if (!ts) return;
    if (!earliestDate || ts < earliestDate) {
      earliestDate = ts;
    }
    if (!latestDate || ts > latestDate) {
      latestDate = ts;
    }
  }

  const events: NormalizedEvent[] = [];
  let eventSeq = 0;

  for (const line of parsedLines) {
    const lineTs = parseTimestamp(line.timestamp);
    updateTimestamps(lineTs);

    // 1. User prompt
    if (isUserPromptLine(line)) {
      const text = extractTextContent(line.message?.content);
      if (!initialPrompt && text.trim().length > 0) {
        initialPrompt = text.trim();
      }
      const eventId = line.uuid ?? `prompt-${++eventSeq}`;
      events.push(
        createNormalizedEvent({
          id: eventId,
          sessionId: canonicalSessionId,
          type: "prompt",
          content: text,
          timestamp: lineTs,
        }),
      );
      continue;
    }

    // 2. Assistant tool use
    if (line.type === "assistant" && Array.isArray(line.message?.content)) {
      for (const block of line.message.content) {
        if (
          !block ||
          block.type !== "tool_use" ||
          !("id" in block) ||
          typeof block.id !== "string"
        ) {
          continue;
        }

        const failure = failedTools.get(block.id);
        const isFailed = failure !== undefined;

        const name =
          "name" in block && typeof block.name === "string"
            ? block.name
            : "Unknown";
        const input =
          "input" in block &&
          typeof block.input === "object" &&
          block.input !== null
            ? (block.input as Record<string, unknown>)
            : {};

        let eventType: EventType = "unknown";
        let targetFile: string | undefined;
        let command: string | undefined;
        let content: string | undefined;
        let range: LineRange | undefined;
        let metadata: Record<string, unknown> | undefined;

        if (FILE_READ_TOOLS.has(name)) {
          eventType = "read";
          const rawPath = input.file_path ?? input.notebook_path;
          if (typeof rawPath === "string") {
            targetFile = normalizePath(rawPath, repoRoot);
          }
          range = parseReadLineRange(input);
        } else if (name === "Edit" || name === "NotebookEdit") {
          eventType = "write";
          const rawPath = input.file_path ?? input.notebook_path;
          if (typeof rawPath === "string") {
            targetFile = normalizePath(rawPath, repoRoot);
          }
          const rawContent = input.new_string ?? input.new_source;
          if (typeof rawContent === "string") {
            content = rawContent;
          }
        } else if (name === "MultiEdit") {
          eventType = "write";
          const rawPath = input.file_path;
          if (typeof rawPath === "string") {
            targetFile = normalizePath(rawPath, repoRoot);
          }
          if (Array.isArray(input.edits)) {
            const editStrings: string[] = [];
            for (const edit of input.edits) {
              if (
                edit &&
                typeof edit === "object" &&
                "new_string" in edit &&
                typeof edit.new_string === "string"
              ) {
                editStrings.push(edit.new_string);
              }
            }
            content = editStrings.join("\n");
          }
        } else if (name === "Write") {
          eventType = "write";
          const rawPath = input.file_path;
          if (typeof rawPath === "string") {
            targetFile = normalizePath(rawPath, repoRoot);
          }
          if (typeof input.content === "string") {
            content = input.content;
          }
        } else if (name === "Bash") {
          if (typeof input.command === "string") {
            command = input.command;
            if (TEST_COMMAND_PATTERN.test(command)) {
              eventType = "test";
            } else {
              eventType = "command";
            }
          }
        } else if (name === "Glob" || name === "Grep" || name === "LS") {
          eventType = "read";
          command = `${name} ${JSON.stringify(input)}`;
          metadata = { tool: name, ...input };
        } else {
          eventType = "unknown";
          metadata = { tool: name, input };
        }

        if (isFailed) {
          metadata = {
            ...metadata,
            attempted: true,
            failed: true,
            ...(failure?.errorMessage ? { error: failure.errorMessage } : {}),
          };
        }

        events.push(
          createNormalizedEvent({
            id: block.id,
            sessionId: canonicalSessionId,
            type: eventType,
            file: targetFile,
            command,
            content,
            range,
            success: !isFailed,
            timestamp: lineTs,
            metadata,
          }),
        );
      }
      continue;
    }

    // 3. Tool results (user records carrying tool responses)
    if (Array.isArray(line.message?.content)) {
      for (const block of line.message.content) {
        if (
          !block ||
          block.type !== "tool_result" ||
          !("tool_use_id" in block) ||
          typeof block.tool_use_id !== "string"
        ) {
          continue;
        }

        const isError = "is_error" in block && block.is_error === true;
        const resultType: EventType = isError ? "error" : "result";
        let resultContent: string | undefined;
        if ("content" in block) {
          if (typeof block.content === "string") {
            resultContent = block.content;
          } else if (block.content !== undefined) {
            resultContent = JSON.stringify(block.content);
          }
        }

        events.push(
          createNormalizedEvent({
            id: `result-${block.tool_use_id}`,
            sessionId: canonicalSessionId,
            type: resultType,
            success: !isError,
            content: resultContent,
            timestamp: lineTs,
            metadata: { tool_use_id: block.tool_use_id },
          }),
        );
      }
    }
  }

  const title = initialPrompt ? initialPrompt.split("\n")[0]?.trim() : undefined;

  return createNormalizedSession({
    id: canonicalSessionId,
    agent: "claude",
    sourcePath,
    projectPath,
    repoRoot,
    startedAt: earliestDate,
    endedAt: latestDate,
    prompt: initialPrompt,
    title,
    events,
  });
}

/**
 * Summary parser for session listing.
 * Parses the full transcript content into a normalized session and summarizes it,
 * guaranteeing accurate startedAt, endedAt, eventCount, touchedFileCount, and promptPreview.
 * Does not report partial estimates or guesses.
 */
export function parseClaudeSessionSummary(
  fileBasename: string,
  content: string,
  sourcePath?: string,
  repoRoot?: string,
): NormalizedSessionSummary | null {
  const fallbackId = fileBasename.replace(/\.[^/.]+$/, "");
  if (!fallbackId || content.trim().length === 0) return null;

  const session = parseClaudeSession(
    fallbackId,
    content,
    sourcePath ?? fallbackId,
    repoRoot,
  );

  // If session has no events, no prompt, and no timestamps, it's not a usable session
  if (session.events.length === 0 && !session.prompt && !session.startedAt) {
    return null;
  }

  return summarizeSession(session);
}
