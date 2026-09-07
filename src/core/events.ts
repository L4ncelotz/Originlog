/**
 * Core event model and event-related operations.
 *
 * Every {@link NormalizedEvent} carries exactly the information needed for
 * downstream correlation and provenance analysis, regardless of the
 * source agent.
 */

/**
 * Coarse-grained event types used by the correlation engine.
 *
 * Values are intentionally conservative: a vendor event that does not
 * clearly map to one of these categories is normalized as `"unknown"`
 * and the original payload may be preserved in {@link NormalizedEvent.metadata}.
 */
export type EventType =
  | "prompt"
  | "read"
  | "write"
  | "command"
  | "result"
  | "error"
  | "test"
  | "unknown";

/**
 * Inclusive 1-based line range within a file.
 *
 * Line numbers follow the public API convention: the first line of a file
 * is line `1`. `startLine` must be `<= endLine`.
 */
export interface LineRange {
  startLine: number;
  endLine: number;
}

/**
 * Agent-agnostic representation of a single event within a session.
 *
 * Missing or unparseable timestamps remain `undefined`; timestamps MUST NEVER
 * be fabricated with `new Date()`, as doing so corrupts correlation and provenance.
 */
export interface NormalizedEvent {
  /** Stable event identifier within the session. */
  id: string;
  /** Owning session id. */
  sessionId: string;
  /**
   * Event timestamp when recorded by the agent; `undefined` when the
   * agent log lacks reliable timing.
   */
  timestamp?: Date;
  type: EventType;

  /** Absolute or repo-relative path to the file the event targets. */
  file?: string;
  /** Shell command text for `command` events. */
  command?: string;
  /** Free-form payload (file diff, tool output, etc.). */
  content?: string;
  /** Whether a command, test, write, or other tool action succeeded. */
  success?: boolean;
  /** Line range touched by the event (for `read` and `write` events). */
  range?: LineRange;
  /** Escape hatch for vendor-specific fields the core model doesn't model. */
  metadata?: Record<string, unknown>;
}

/**
 * Aggregated per-file activity within a session.
 *
 * Built from {@link NormalizedEvent} records by {@link extractFileTouches}.
 */
export interface FileTouch {
  sessionId: string;
  /** Normalized file path (see `normalizePath` in `./sessions`). */
  file: string;
  /** Earliest event timestamp touching the file in this session, if known. */
  firstTouchedAt?: Date;
  /** Latest event timestamp touching the file in this session, if known. */
  lastTouchedAt?: Date;
  /** True if any event on this file was a `read`. */
  read: boolean;
  /** True if any event on this file was a `write`. */
  written: boolean;
  /** All line ranges touched across the session, in encounter order. */
  ranges: LineRange[];
}

/**
 * Git-correlated change record produced by the correlation engine.
 *
 * Populated in later correlation steps.
 */
export interface FileChange {
  sessionId: string;
  file: string;
  linesAdded?: number;
  linesRemoved?: number;
  beforeHash?: string;
  afterHash?: string;
  firstChangedAt?: Date;
  lastChangedAt?: Date;
}

/**
 * Create a {@link NormalizedEvent} with safe defaults.
 *
 * Required fields are taken from `params`; optional fields pass through
 * verbatim. Missing timestamps remain `undefined` to preserve provenance integrity.
 */
export function createNormalizedEvent(
  params: Partial<NormalizedEvent> & {
    id: string;
    sessionId: string;
    type: EventType;
  },
): NormalizedEvent {
  return {
    id: params.id,
    sessionId: params.sessionId,
    timestamp: params.timestamp,
    type: params.type,
    file: params.file,
    command: params.command,
    content: params.content,
    success: params.success,
    range: params.range,
    metadata: params.metadata,
  };
}

/**
 * Sort a list of events chronologically (ascending) with a stable
 * tie-break on event id.
 *
 * - Returns a new array; the input is not mutated.
 * - Events with known valid timestamps are placed first, ordered chronologically.
 * - Events with unknown (`undefined` or invalid) timestamps are placed after
 *   known events, ordered deterministically by `id`.
 * - Events with identical valid timestamps are ordered by `id`
 *   (locale-aware ascending), preserving stability.
 */
export function sortEvents(events: NormalizedEvent[]): NormalizedEvent[] {
  const toMillis = (d: Date | undefined): number | undefined => {
    if (!d) return undefined;
    const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
    return Number.isNaN(t) ? undefined : t;
  };

  return [...events].sort((a, b) => {
    const timeA = toMillis(a.timestamp);
    const timeB = toMillis(b.timestamp);

    if (timeA !== undefined && timeB !== undefined) {
      if (timeA !== timeB) return timeA - timeB;
      return a.id.localeCompare(b.id);
    }
    if (timeA !== undefined && timeB === undefined) {
      return -1;
    }
    if (timeA === undefined && timeB !== undefined) {
      return 1;
    }
    return a.id.localeCompare(b.id);
  });
}

/**
 * Aggregate {@link NormalizedEvent} records into per-file touch records.
 *
 * - Events without a `file` field are ignored.
 * - `read: true` if any event on the file was `type === "read"`.
 * - `written: true` if any event on the file was `type === "write"`.
 * - `firstTouchedAt` and `lastTouchedAt` are computed from valid timestamps only;
 *   missing timestamps remain `undefined`.
 * - All non-empty `range` values are accumulated in encounter order.
 * - The result is sorted alphabetically by `file` for deterministic output.
 */
export function extractFileTouches(
  sessionId: string,
  events: NormalizedEvent[],
): FileTouch[] {
  type Mutable = {
    firstTouchedAt?: Date;
    lastTouchedAt?: Date;
    read: boolean;
    written: boolean;
    ranges: LineRange[];
  };

  const touchesByFile = new Map<string, Mutable>();

  for (const event of events) {
    if (!event || !event.file) continue;
    const file = event.file;

    let touch = touchesByFile.get(file);
    if (!touch) {
      touch = {
        read: false,
        written: false,
        ranges: [],
      };
      touchesByFile.set(file, touch);
    }

    if (event.type === "read" && event.success !== false) {
      touch.read = true;
    } else if (event.type === "write" && event.success !== false) {
      touch.written = true;
    }

    if (event.timestamp) {
      const eventTime =
        event.timestamp instanceof Date
          ? event.timestamp
          : new Date(event.timestamp);
      if (!Number.isNaN(eventTime.getTime())) {
        if (!touch.firstTouchedAt || eventTime < touch.firstTouchedAt) {
          touch.firstTouchedAt = eventTime;
        }
        if (!touch.lastTouchedAt || eventTime > touch.lastTouchedAt) {
          touch.lastTouchedAt = eventTime;
        }
      }
    }

    if (event.range && event.success !== false) {
      touch.ranges.push({ ...event.range });
    }
  }

  const result: FileTouch[] = [];
  for (const [file, touch] of touchesByFile.entries()) {
    result.push({
      sessionId,
      file,
      firstTouchedAt: touch.firstTouchedAt,
      lastTouchedAt: touch.lastTouchedAt,
      read: touch.read,
      written: touch.written,
      ranges: touch.ranges,
    });
  }

  return result.sort((a, b) => a.file.localeCompare(b.file));
}
