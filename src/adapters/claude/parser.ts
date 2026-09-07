/**
 * Claude Code JSONL transcript parser.
 *
 * Translates raw Claude Code session records into the normalized Originlog
 * model (NormalizedSession, NormalizedEvent).
 *
 * Follows core principles:
 * - Tolerant of schema evolution and unknown event types.
 * - Missing data remains unknown (timestamps are never fabricated).
 * - Pre-pass excludes failed tool actions so failed edits do not count as work.
 * - Resumed session entries are deduplicated by UUID.
 */

import {
  createNormalizedEvent,
  type EventType,
  type NormalizedEvent,
} from "../../core/events.js";
import {
  createNormalizedSession,
  normalizePath,
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

  // Pre-pass: collect tool_use IDs that ended in an error
  const failedToolIds = new Set<string>();
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
          failedToolIds.add(block.tool_use_id);
        }
      }
    }
  }

  let resolvedSessionId = sessionId;
  let projectPath: string | undefined;
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
    if (
      (!resolvedSessionId || resolvedSessionId === sessionId) &&
      line.sessionId &&
      line.sessionId.trim().length > 0
    ) {
      resolvedSessionId = line.sessionId.trim();
    }

    if (!projectPath && line.cwd && line.cwd.trim().length > 0) {
      projectPath = line.cwd.trim();
    }

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
          sessionId: resolvedSessionId,
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
        if (failedToolIds.has(block.id)) continue;

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
        let range: { startLine: number; endLine: number } | undefined;
        let metadata: Record<string, unknown> | undefined;

        if (FILE_READ_TOOLS.has(name)) {
          eventType = "read";
          const rawPath = input.file_path ?? input.notebook_path;
          if (typeof rawPath === "string") {
            targetFile = normalizePath(rawPath, repoRoot);
          }
          if (
            typeof input.offset === "number" &&
            typeof input.limit === "number"
          ) {
            range = {
              startLine: input.offset,
              endLine: input.offset + input.limit - 1,
            };
          }
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

        events.push(
          createNormalizedEvent({
            id: block.id,
            sessionId: resolvedSessionId,
            type: eventType,
            file: targetFile,
            command,
            content,
            range,
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
            sessionId: resolvedSessionId,
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
    id: resolvedSessionId,
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
 * Fast summary parser for session listing.
 * Reads the first few lines of a transcript to extract summary metadata
 * without reading or parsing the full file.
 */
export function parseClaudeSessionSummary(
  fileBasename: string,
  headerContent: string,
): NormalizedSessionSummary | null {
  const lines = headerContent.split(/\r?\n/).slice(0, 50);
  let resolvedSessionId: string | undefined;
  let projectPath: string | undefined;
  let initialPrompt: string | undefined;
  let earliestDate: Date | undefined;
  let latestDate: Date | undefined;
  let eventCount = 0;

  for (const rawLine of lines) {
    if (rawLine.trim().length === 0) continue;
    const parsed = parseTranscriptLine(rawLine);
    if (!parsed) continue;

    eventCount++;

    if (!resolvedSessionId && parsed.sessionId && parsed.sessionId.trim().length > 0) {
      resolvedSessionId = parsed.sessionId.trim();
    }

    if (!projectPath && parsed.cwd && parsed.cwd.trim().length > 0) {
      projectPath = parsed.cwd.trim();
    }

    const ts = parseTimestamp(parsed.timestamp);
    if (ts) {
      if (!earliestDate || ts < earliestDate) earliestDate = ts;
      if (!latestDate || ts > latestDate) latestDate = ts;
    }

    if (!initialPrompt && isUserPromptLine(parsed)) {
      const text = extractTextContent(parsed.message?.content);
      if (text.trim().length > 0) {
        initialPrompt = text.trim();
      }
    }
  }

  const finalSessionId =
    resolvedSessionId ?? fileBasename.replace(/\.[^/.]+$/, "");
  if (!finalSessionId) return null;

  const promptPreview = initialPrompt
    ? initialPrompt.split("\n")[0]?.trim().slice(0, 100)
    : undefined;

  return {
    id: finalSessionId,
    agent: "claude",
    projectPath,
    startedAt: earliestDate,
    endedAt: latestDate,
    promptPreview,
    eventCount,
  };
}
