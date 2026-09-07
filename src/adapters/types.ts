/**
 * Agent adapter contract — the boundary between vendor-specific session
 * formats and the agent-agnostic core model.
 *
 * Every supported coding agent (Claude Code, Codex, etc.) must provide an
 * implementation of {@link AgentAdapter} that translates its native session
 * format into {@link NormalizedSession} and {@link NormalizedSessionSummary}
 * structures. No agent-specific types, JSON shapes, or conditionals may
 * appear outside `src/adapters/`.
 */

import type {
  NormalizedSession,
  NormalizedSessionSummary,
} from "../core/sessions.js";

/**
 * Environment context passed to every adapter call.
 *
 * The adapter never inspects the filesystem or environment directly; it
 * receives a fully prepared {@link AdapterContext} so its behavior stays
 * deterministic and easy to test.
 */
export interface AdapterContext {
  /** Current working directory at the time of the call. */
  cwd: string;
  /** Resolved repository root for the user's current working tree, if any. */
  repoRoot?: string;
  /** User's home directory; adapters use it to locate vendor data. */
  homeDir: string;
}

/**
 * Result of an adapter probing its data source.
 */
export interface AgentDetection {
  /** Whether the adapter found any usable session data. */
  detected: boolean;
  /** Absolute paths to the source files or directories discovered. */
  sourcePaths: string[];
  /** Number of sessions discovered at the source paths. */
  sessionCount?: number;
  /** Human-readable diagnostic warnings (permission, format, etc.). */
  warnings?: string[];
}

/**
 * The contract every agent adapter must satisfy.
 *
 * Adapters are stateless; the caller provides the {@link AdapterContext}
 * for each operation.
 */
export interface AgentAdapter {
  /** Stable, machine-readable identifier (e.g. `"claude"`, `"codex"`). */
  id: string;
  /** Human-readable display name (e.g. `"Claude Code"`). */
  displayName: string;

  /**
   * Probe for the presence of the agent's session data on disk.
   * Must never throw; instead, return `{ detected: false, sourcePaths: [] }`
   * when data is missing or unreadable.
   */
  detect(context: AdapterContext): Promise<AgentDetection>;

  /**
   * List summary records for every session visible at the source paths.
   * Implementations should avoid loading full events when a summary is
   * sufficient.
   */
  listSessions(
    context: AdapterContext,
  ): Promise<NormalizedSessionSummary[]>;

  /**
   * Load the full normalized session (including all events) by id.
   * Throws if the session id is not found.
   */
  loadSession(
    sessionId: string,
    context: AdapterContext,
  ): Promise<NormalizedSession>;
}
