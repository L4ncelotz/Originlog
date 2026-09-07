/**
 * `originlog show <session-id>` command.
 *
 * Resolves a session across all registered adapters, loads the full
 * normalized session, and renders its events in chronological encounter order.
 *
 * Core principles:
 * - Agent-agnostic: resolves and renders sessions from any registered adapter.
 * - ID-resilient: supports exact full IDs and unambiguous shortened prefixes.
 * - Fault-tolerant: displays clean, informative messages on unknown/ambiguous
 *   sessions without stack traces.
 */

import { Command } from "commander";
import os from "node:os";
import { isGitRepository, getRepoRoot } from "../../git/index.js";
import { getAdapters } from "../../adapters/registry.js";
import { renderSessionTimeline } from "../../ui/timeline.js";
import type { AdapterContext, AgentAdapter } from "../../adapters/types.js";
import type {
  NormalizedSession,
  NormalizedSessionSummary,
} from "../../core/sessions.js";

/**
 * Options for resolving a session.
 */
export interface ResolveSessionOptions {
  /** Optional custom adapters to use instead of default registry. */
  adapters?: readonly AgentAdapter[];
}

/**
 * Result of resolving and loading a session.
 */
export interface ResolvedSession {
  /** The full normalized session. */
  session: NormalizedSession;
  /** The adapter that resolved and loaded the session. */
  adapter: AgentAdapter;
}

/**
 * Resolve and load a session across available adapters.
 *
 * Supports:
 * 1. Direct load by exact full ID or filename
 * 2. Prefix matching for shortened IDs
 * 3. Ambiguity detection when a prefix matches multiple sessions
 *
 * @throws Error if session is not found, ambiguous, or malformed.
 */
export async function resolveSession(
  sessionId: string,
  context: AdapterContext,
  options: ResolveSessionOptions = {},
): Promise<ResolvedSession> {
  const trimmedId = sessionId?.trim();
  if (!trimmedId) {
    throw new Error("Session ID is required.");
  }

  const adapters = options.adapters ?? getAdapters();

  // 1. Direct load attempt (exact full ID or exact file basename)
  for (const adapter of adapters) {
    try {
      const session = await adapter.loadSession(trimmedId, context);
      if (session) {
        return { session, adapter };
      }
    } catch {
      // Direct load failed, continue to candidate search
    }
  }

  // 2. Candidate search via listSessions for prefix / partial ID resolution
  const candidateMatches: Array<{
    summary: NormalizedSessionSummary;
    adapter: AgentAdapter;
  }> = [];

  for (const adapter of adapters) {
    try {
      const detection = await adapter.detect(context);
      if (detection.detected) {
        const summaries = await adapter.listSessions(context);
        for (const s of summaries) {
          if (s.id === trimmedId || s.id.startsWith(trimmedId)) {
            candidateMatches.push({ summary: s, adapter });
          }
        }
      }
    } catch {
      // Skip failing adapter
    }
  }

  if (candidateMatches.length === 0) {
    throw new Error(`Session not found: ${trimmedId}`);
  }

  if (candidateMatches.length > 1) {
    const candidateIds = candidateMatches.map((m) => m.summary.id).join(", ");
    throw new Error(
      `Ambiguous session ID "${trimmedId}": matches multiple sessions: ${candidateIds}`,
    );
  }

  const match = candidateMatches[0]!;
  try {
    const session = await match.adapter.loadSession(match.summary.id, context);
    return { session, adapter: match.adapter };
  } catch (err) {
    throw new Error(
      `Failed to load session "${match.summary.id}": ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err },
    );
  }
}

/**
 * Register the `show` command on a Commander {@link Command} instance.
 */
export function registerShowCommand(cmd: Command): void {
  cmd
    .command("show <session-id>")
    .description("Show a readable timeline for one coding-agent session")
    .option("-v, --verbose", "Include unknown and low-level events")
    .option("--json", "Output full normalized session as JSON")
    .action(
      async (
        sessionId: string,
        options: { verbose?: boolean; json?: boolean },
      ) => {
        const repoRoot = (await isGitRepository(process.cwd()))
          ? await getRepoRoot(process.cwd())
          : undefined;

        const context: AdapterContext = {
          cwd: process.cwd(),
          repoRoot: repoRoot ?? undefined,
          homeDir: os.homedir(),
        };

        try {
          const { session } = await resolveSession(sessionId, context);

          if (options.json) {
            console.log(JSON.stringify(session, null, 2));
          } else {
            const output = renderSessionTimeline(session, {
              verbose: options.verbose,
            });
            console.log(output);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(message);
          process.exitCode = 1;
        }
      },
    );
}
