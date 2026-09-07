/**
 * Session timeline renderer.
 *
 * Formats a {@link NormalizedSession} into a clean, human-readable terminal
 * timeline, showing events in chronological encounter order with stable labels,
 * timestamps, and brief content previews.
 */

import pc from "picocolors";
import type { NormalizedEvent, LineRange } from "../core/events.js";
import type { NormalizedSession } from "../core/sessions.js";

/**
 * Options controlling timeline rendering.
 */
export interface TimelineRenderOptions {
  /** Whether to use ANSI terminal colors (default: true). */
  color?: boolean;
  /** Whether to include unknown or low-priority events (default: false). */
  verbose?: boolean;
  /** Whether to format timestamps in UTC (default: false, uses local time). */
  utc?: boolean;
  /** Maximum length for single-line detail previews before truncation (default: 80). */
  maxDetailLength?: number;
}

/**
 * Format a 1-based line range into a readable suffix (e.g. `:L10-25` or `:L42`).
 */
export function formatLineRange(range?: LineRange): string {
  if (!range) return "";
  if (range.startLine === range.endLine) {
    return `:L${range.startLine}`;
  }
  return `:L${range.startLine}-${range.endLine}`;
}

/**
 * Collapse multi-line content into a single line, trimming whitespace and
 * truncating to `maxLen` characters with an ellipsis.
 */
export function truncateOneLine(text: string, maxLen = 80): string {
  if (!text) return "";
  const singleLine = text.replace(/[\r\n]+/g, " ").trim();
  if (singleLine.length <= maxLen) return singleLine;
  return singleLine.slice(0, Math.max(0, maxLen - 3)) + "...";
}

/**
 * Map a {@link NormalizedEvent} to a stable human-readable timeline label.
 *
 * Labels:
 * - `PROMPT` — user input or initial session prompt
 * - `READ`   — file inspection
 * - `EDIT`   — file modification
 * - `RUN`    — command execution
 * - `PASS`   — passed test execution
 * - `FAIL`   — failed test execution
 * - `RESULT` — tool output or assistant completion
 * - `ERROR`  — tool or process failure
 * - `EVENT`  — other / unknown event types
 */
export function getEventLabel(event: NormalizedEvent): string {
  switch (event.type) {
    case "prompt":
      return "PROMPT";
    case "read":
      return "READ";
    case "write":
      return "EDIT";
    case "command":
      return "RUN";
    case "test":
      if (event.success === false) return "FAIL";
      if (event.success === true) return "PASS";
      return "TEST";
    case "result":
      return "RESULT";
    case "error":
      return "ERROR";
    default:
      return "EVENT";
  }
}

/**
 * Extract a concise, single-line detail string for an event.
 */
export function getEventDetails(
  event: NormalizedEvent,
  maxLen = 80,
): string {
  switch (event.type) {
    case "prompt":
      return truncateOneLine(event.content ?? "", maxLen);

    case "read":
      return event.file ? `${event.file}${formatLineRange(event.range)}` : "";

    case "write": {
      const suffix = event.success === false ? " (failed)" : "";
      return event.file
        ? `${event.file}${formatLineRange(event.range)}${suffix}`
        : "";
    }

    case "command": {
      const suffix = event.success === false ? " (failed)" : "";
      return `${truncateOneLine(event.command ?? "", maxLen)}${suffix}`;
    }

    case "test": {
      const target = event.command ?? event.content ?? "";
      return truncateOneLine(target, maxLen);
    }

    case "result":
      return truncateOneLine(event.content ?? "", maxLen);

    case "error":
      return truncateOneLine(
        event.content ?? (event.metadata?.error as string) ?? "Action failed",
        maxLen,
      );

    default:
      return truncateOneLine(
        event.content ?? event.command ?? event.file ?? "",
        maxLen,
      );
  }
}

/**
 * Format timestamp into `HH:mm:ss`.
 */
function formatEventTime(date?: Date, utc = false): string {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return "        "; // 8 spaces
  }

  const pad = (n: number) => String(n).padStart(2, "0");

  if (utc) {
    const h = pad(date.getUTCHours());
    const m = pad(date.getUTCMinutes());
    const s = pad(date.getUTCSeconds());
    return `${h}:${m}:${s}`;
  }

  const h = pad(date.getHours());
  const m = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${h}:${m}:${s}`;
}

/**
 * Format full date and time into `YYYY-MM-DD HH:mm:ss`.
 */
function formatFullDateTime(date?: Date, utc = false): string {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return "unknown";
  }

  const pad = (n: number) => String(n).padStart(2, "0");

  if (utc) {
    const y = date.getUTCFullYear();
    const m = pad(date.getUTCMonth() + 1);
    const d = pad(date.getUTCDate());
    const h = pad(date.getUTCHours());
    const min = pad(date.getUTCMinutes());
    const s = pad(date.getUTCSeconds());
    return `${y}-${m}-${d} ${h}:${min}:${s}`;
  }

  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

/**
 * Format a single event row for timeline display.
 */
export function formatTimelineEvent(
  event: NormalizedEvent,
  options: TimelineRenderOptions = {},
): string {
  const useColor = options.color ?? true;
  const maxLen = options.maxDetailLength ?? 80;

  const timeStr = formatEventTime(event.timestamp, options.utc);
  const rawLabel = getEventLabel(event);
  const labelPadded = rawLabel.padEnd(7);

  let coloredLabel = labelPadded;
  if (useColor) {
    switch (rawLabel) {
      case "PROMPT":
        coloredLabel = pc.cyan(labelPadded);
        break;
      case "READ":
        coloredLabel = pc.blue(labelPadded);
        break;
      case "EDIT":
        coloredLabel = pc.yellow(labelPadded);
        break;
      case "RUN":
        coloredLabel = pc.magenta(labelPadded);
        break;
      case "PASS":
        coloredLabel = pc.green(labelPadded);
        break;
      case "FAIL":
      case "ERROR":
        coloredLabel = pc.red(labelPadded);
        break;
      case "RESULT":
      case "EVENT":
      default:
        coloredLabel = pc.dim(labelPadded);
        break;
    }
  }

  const details = getEventDetails(event, maxLen);
  const timeFormatted = useColor ? pc.dim(timeStr) : timeStr;

  return `${timeFormatted}  ${coloredLabel}  ${details}`;
}

/**
 * Render a full session timeline into a human-readable string.
 */
export function renderSessionTimeline(
  session: NormalizedSession,
  options: TimelineRenderOptions = {},
): string {
  const useColor = options.color ?? true;
  const lines: string[] = [];

  const bold = (s: string) => (useColor ? pc.bold(s) : s);
  const dim = (s: string) => (useColor ? pc.dim(s) : s);

  // 1. Session Metadata Header
  lines.push(`${bold("Session:")}  ${session.id}`);
  lines.push(`${bold("Agent:")}    ${session.agent}`);

  if (session.startedAt) {
    lines.push(
      `${bold("Started:")}  ${formatFullDateTime(session.startedAt, options.utc)}`,
    );
  } else {
    lines.push(`${bold("Started:")}  unknown`);
  }

  if (session.projectPath) {
    lines.push(`${bold("Project:")}  ${session.projectPath}`);
  }

  if (session.prompt) {
    lines.push(`${bold("Prompt:")}   ${truncateOneLine(session.prompt, 100)}`);
  }

  lines.push(`${bold("Events:")}   ${session.events.length}`);
  lines.push("");

  // 2. Timeline Header
  lines.push(bold("Timeline:"));

  // Filter events: skip "unknown" events unless verbose is enabled
  const visibleEvents = session.events.filter((e) => {
    if (options.verbose) return true;
    return e.type !== "unknown";
  });

  if (visibleEvents.length === 0) {
    lines.push(dim("(No recorded events in this session)"));
  } else {
    for (const event of visibleEvents) {
      lines.push(formatTimelineEvent(event, options));
    }
  }

  return lines.join("\n");
}
