/**
 * `originlog sessions` command.
 *
 * Discovers, filters, and lists coding-agent sessions associated with
 * the current Git repository in deterministic reverse-chronological order.
 *
 * Core principles:
 * - Evidence-driven: only shows sessions whose working directory equals or is
 *   inside the repository root.
 * - Multi-agent: queries all registered coding-agent adapters in an agent-agnostic way.
 * - Fault-tolerant: failure in one adapter or missing session data does not crash the command.
 * - Clean terminal output: compact table with human-readable timestamps and counts.
 */

import { Command } from "commander";
import os from "node:os";
import pc from "picocolors";
import { isGitRepository, getRepoRoot } from "../../git/index.js";
import { getAdapters, findAdapter } from "../../adapters/registry.js";
import {
  filterSessionsForRepository,
  type NormalizedSessionSummary,
} from "../../core/sessions.js";
import type { AdapterContext, AgentAdapter } from "../../adapters/types.js";

/**
 * An individual session item prepared for display and downstream reference.
 */
export interface SessionItem {
  /** Full, unambiguous session identifier. */
  id: string;
  /** Shortened identifier for compact table display (guaranteed unique in this listing). */
  shortId: string;
  /** Machine-readable adapter identifier (e.g. `"claude"`). */
  agent: string;
  /** Human-readable adapter display name (e.g. `"Claude Code"`). */
  agentDisplayName: string;
  /** Working directory / project path recorded in the session. */
  projectPath?: string;
  /** Start timestamp of the session, if known. */
  startedAt?: Date;
  /** End timestamp of the session, if known. */
  endedAt?: Date;
  /** Short text preview of the initial prompt. */
  promptPreview?: string;
  /** Total number of recorded events in this session. */
  eventCount?: number;
  /** Number of unique files touched in this session. */
  touchedFileCount?: number;
}

/**
 * Complete report returned by {@link collectSessionsReport}.
 */
export interface SessionsReport {
  /** Whether the queried working directory is inside a valid Git repository. */
  isRepo: boolean;
  /** Resolved repository root path. */
  repoRoot?: string;
  /** Sessions matching the repository, sorted deterministically. */
  sessions: SessionItem[];
  /** Non-fatal diagnostic warnings encountered during discovery. */
  warnings?: string[];
}

/**
 * Options controlling session collection.
 */
export interface CollectSessionsOptions {
  /** Optional custom adapters to use instead of the registered defaults. */
  adapters?: readonly AgentAdapter[];
}

/**
 * Options controlling terminal formatting.
 */
export interface FormatSessionsOptions {
  /** Whether to use ANSI terminal colors (default: true). */
  color?: boolean;
  /** Whether to format timestamps in UTC (default: false, uses local timezone). */
  utc?: boolean;
}

/**
 * Format a session ID into a readable shortened string (default 8 characters).
 *
 * If multiple sessions share the same 8-character prefix, returns the full ID
 * to ensure unambiguous identity.
 *
 * @param id The full session ID.
 * @param allIds All candidate session IDs to check for prefix collisions.
 */
export function formatSessionId(id: string, allIds: readonly string[] = []): string {
  if (!id) return "";
  if (id.length <= 8) return id;

  const prefix = id.slice(0, 8);
  const hasCollision = allIds.some(
    (otherId) => otherId !== id && otherId.startsWith(prefix),
  );

  return hasCollision ? id : prefix;
}

/**
 * Sort session summaries deterministically:
 * 1. Newest known start time first (`b.startedAt - a.startedAt`)
 * 2. Sessions with known start time before sessions with unknown start time
 * 3. Stable tie-breaker: `a.agent` then `a.id`
 */
export function sortSessionsDeterministically<
  T extends Pick<NormalizedSessionSummary, "id" | "agent" | "startedAt">,
>(sessions: readonly T[]): T[] {
  return [...sessions].sort((a, b) => {
    const aTime =
      a.startedAt instanceof Date && !isNaN(a.startedAt.getTime())
        ? a.startedAt.getTime()
        : undefined;
    const bTime =
      b.startedAt instanceof Date && !isNaN(b.startedAt.getTime())
        ? b.startedAt.getTime()
        : undefined;

    if (aTime !== undefined && bTime !== undefined) {
      if (aTime !== bTime) {
        return bTime - aTime; // Newest first
      }
    } else if (aTime !== undefined) {
      return -1; // a has timestamp, b does not -> a comes first
    } else if (bTime !== undefined) {
      return 1; // b has timestamp, a does not -> b comes first
    }

    // Deterministic fallback: agent then id
    const agentCmp = a.agent.localeCompare(b.agent);
    if (agentCmp !== 0) return agentCmp;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Format a timestamp into `YYYY-MM-DD HH:mm`.
 */
export function formatTimestamp(
  date?: Date,
  options: { utc?: boolean } = {},
): string {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return "unknown";
  }

  const pad = (n: number) => String(n).padStart(2, "0");

  if (options.utc) {
    const y = date.getUTCFullYear();
    const m = pad(date.getUTCMonth() + 1);
    const d = pad(date.getUTCDate());
    const h = pad(date.getUTCHours());
    const min = pad(date.getUTCMinutes());
    return `${y}-${m}-${d} ${h}:${min}`;
  }

  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${y}-${m}-${d} ${h}:${min}`;
}

/**
 * Collect session summaries matching the current Git repository.
 *
 * Never throws. Rejects sessions without explicit repository matching evidence.
 */
export async function collectSessionsReport(
  context: AdapterContext,
  options: CollectSessionsOptions = {},
): Promise<SessionsReport> {
  const isRepo = await isGitRepository(context.cwd);
  if (!isRepo) {
    return {
      isRepo: false,
      sessions: [],
    };
  }

  const repoRoot = await getRepoRoot(context.cwd);
  if (!repoRoot) {
    return {
      isRepo: false,
      sessions: [],
    };
  }

  const effectiveContext: AdapterContext = {
    cwd: context.cwd,
    repoRoot,
    homeDir: context.homeDir,
  };

  const adapters = options.adapters ?? getAdapters();
  const allSummaries: NormalizedSessionSummary[] = [];
  const warnings: string[] = [];

  for (const adapter of adapters) {
    try {
      const detection = await adapter.detect(effectiveContext);
      if (detection.warnings && detection.warnings.length > 0) {
        warnings.push(...detection.warnings);
      }

      if (detection.detected) {
        const summaries = await adapter.listSessions(effectiveContext);
        allSummaries.push(...summaries);
      }
    } catch (err) {
      warnings.push(
        `Failed to list sessions for ${adapter.displayName}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // Filter using Step 7 repository matching (strict evidence-driven)
  const matchedSummaries = filterSessionsForRepository(allSummaries, repoRoot);

  // Sort deterministically (newest first, then unknown timestamps, then id)
  const sorted = sortSessionsDeterministically(matchedSummaries);

  // Pre-calculate all full IDs to detect prefix collisions for shortId formatting
  const allIds = sorted.map((s) => s.id);

  const sessions: SessionItem[] = sorted.map((summary) => {
    const adapter = findAdapter(summary.agent, adapters);
    const agentDisplayName = adapter ? adapter.displayName : summary.agent;

    return {
      id: summary.id,
      shortId: formatSessionId(summary.id, allIds),
      agent: summary.agent,
      agentDisplayName,
      projectPath: summary.projectPath,
      startedAt: summary.startedAt,
      endedAt: summary.endedAt,
      promptPreview: summary.promptPreview,
      eventCount: summary.eventCount,
      touchedFileCount: summary.touchedFileCount,
    };
  });

  return {
    isRepo: true,
    repoRoot,
    sessions,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Format a {@link SessionsReport} into a clean, human-readable terminal string.
 */
export function formatSessionsReport(
  report: SessionsReport,
  options: FormatSessionsOptions = {},
): string {
  const useColor = options.color ?? true;
  const lines: string[] = [];

  lines.push("Originlog sessions", "");

  // 1. Not in a git repository
  if (!report.isRepo) {
    const symbolFail = useColor ? pc.red("✕") : "✕";
    lines.push(`${symbolFail} Git repository`);
    const notRepoMsg =
      "Not a git repository (run inside a repository to trace changes)";
    lines.push(`  ${useColor ? pc.dim(notRepoMsg) : notRepoMsg}`);
    return lines.join("\n");
  }

  // 2. Repository header
  const repoLabel = useColor ? pc.bold("Repository:") : "Repository:";
  lines.push(`${repoLabel} ${report.repoRoot ?? "unknown"}`, "");

  // 3. Empty state
  if (report.sessions.length === 0) {
    lines.push("No matching coding-agent sessions found.");

    if (report.warnings && report.warnings.length > 0) {
      lines.push("");
      const warnSymbol = useColor ? pc.yellow("!") : "!";
      for (const w of report.warnings) {
        lines.push(`  ${warnSymbol} ${useColor ? pc.yellow(w) : w}`);
      }
    }

    return lines.join("\n");
  }

  // 4. Tabular session rows
  interface TableRow {
    agent: string;
    session: string;
    started: string;
    events: string;
  }

  const rows: TableRow[] = report.sessions.map((item) => ({
    agent: item.agentDisplayName,
    session: item.shortId,
    started: formatTimestamp(item.startedAt, options),
    events: item.eventCount !== undefined ? String(item.eventCount) : "unknown",
  }));

  const colAgent = "AGENT";
  const colSession = "SESSION";
  const colStarted = "STARTED";
  const colEvents = "EVENTS";

  let maxAgent = colAgent.length;
  let maxSession = colSession.length;
  let maxStarted = colStarted.length;
  let maxEvents = colEvents.length;

  for (const r of rows) {
    if (r.agent.length > maxAgent) maxAgent = r.agent.length;
    if (r.session.length > maxSession) maxSession = r.session.length;
    if (r.started.length > maxStarted) maxStarted = r.started.length;
    if (r.events.length > maxEvents) maxEvents = r.events.length;
  }

  // Minimum spacing between columns
  const padEnd = (str: string, len: number) => str + " ".repeat(Math.max(0, len - str.length));

  const headerStr = `${padEnd(colAgent, maxAgent + 2)}${padEnd(
    colSession,
    maxSession + 2,
  )}${padEnd(colStarted, maxStarted + 2)}${colEvents}`;

  lines.push(useColor ? pc.dim(headerStr) : headerStr);

  for (const r of rows) {
    const rowStr = `${padEnd(r.agent, maxAgent + 2)}${padEnd(
      r.session,
      maxSession + 2,
    )}${padEnd(r.started, maxStarted + 2)}${r.events}`;
    lines.push(rowStr);
  }

  // 5. Total count footer
  const count = report.sessions.length;
  const countLabel = count === 1 ? "1 session" : `${count} sessions`;
  lines.push("", useColor ? pc.dim(countLabel) : countLabel);

  // 6. Warnings (if any)
  if (report.warnings && report.warnings.length > 0) {
    lines.push("");
    const warnSymbol = useColor ? pc.yellow("!") : "!";
    for (const w of report.warnings) {
      lines.push(`  ${warnSymbol} ${useColor ? pc.yellow(w) : w}`);
    }
  }

  return lines.join("\n");
}

/**
 * Register the `sessions` command on a Commander {@link Command} instance.
 */
export function registerSessionsCommand(cmd: Command): void {
  cmd
    .command("sessions")
    .description("List coding-agent sessions associated with the current repository")
    .option("--json", "Output sessions report as JSON")
    .action(async (options: { json?: boolean }) => {
      const context: AdapterContext = {
        cwd: process.cwd(),
        homeDir: os.homedir(),
      };

      const report = await collectSessionsReport(context);

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        const text = formatSessionsReport(report);
        console.log(text);
      }

      if (!report.isRepo) {
        process.exitCode = 1;
      }
    });
}
