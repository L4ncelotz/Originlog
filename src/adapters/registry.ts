/**
 * Multi-agent adapter registry.
 *
 * Provides a single, agent-agnostic boundary to enumerate, locate,
 * and probe installed coding agent adapters.
 *
 * Core principles:
 * - Depends strictly on the {@link AgentAdapter} contract.
 * - Agent-specific logic remains fully encapsulated inside each adapter.
 * - Deterministic ordering across all queries.
 * - Detection failures in one adapter never crash or impede discovery of others.
 * - Pure and stateless — no mutable global registry state required.
 */

import { claudeAdapter } from "./claude/index.js";
import type {
  AdapterContext,
  AgentAdapter,
  AgentDetection,
  DetectedAgent,
} from "./types.js";

/**
 * Built-in agent adapters in canonical, deterministic order.
 */
const DEFAULT_ADAPTERS: readonly AgentAdapter[] = Object.freeze([
  claudeAdapter,
]);

/**
 * Enumerate all registered coding agent adapters.
 *
 * Returns a new array in deterministic order.
 */
export function getAdapters(): AgentAdapter[] {
  return [...DEFAULT_ADAPTERS];
}

/**
 * Find a registered adapter by its stable identifier.
 *
 * Matching is case-insensitive, with exact-match precedence.
 *
 * @param id The adapter id (e.g. `"claude"`, `"codex"`).
 * @param adapters Optional custom adapter list (defaults to registered adapters).
 */
export function findAdapter(
  id: string,
  adapters: readonly AgentAdapter[] = DEFAULT_ADAPTERS,
): AgentAdapter | undefined {
  if (!id || typeof id !== "string") return undefined;
  const trimmed = id.trim();
  if (trimmed.length === 0) return undefined;

  // 1. Exact match
  const exact = adapters.find((a) => a.id === trimmed);
  if (exact) return exact;

  // 2. Case-insensitive match
  const lower = trimmed.toLowerCase();
  return adapters.find((a) => a.id.toLowerCase() === lower);
}

/**
 * Safely probe a single adapter. Never throws or rejects.
 */
async function probeAdapterSafely(
  adapter: AgentAdapter,
  context: AdapterContext,
): Promise<DetectedAgent> {
  try {
    const detection = await adapter.detect(context);
    return {
      adapter,
      detection: {
        detected: Boolean(detection?.detected),
        sourcePaths: Array.isArray(detection?.sourcePaths)
          ? [...detection.sourcePaths]
          : [],
        sessionCount: detection?.sessionCount,
        warnings: detection?.warnings ? [...detection.warnings] : undefined,
      },
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err ?? "Unknown error");
    const failureReport: AgentDetection = {
      detected: false,
      sourcePaths: [],
      warnings: [`Adapter '${adapter.id}' detection failed: ${message}`],
    };
    return {
      adapter,
      detection: failureReport,
    };
  }
}

/**
 * Probe available adapters in deterministic order to detect active agents on disk.
 *
 * Detection failures in any individual adapter are caught and recorded
 * as warnings, ensuring other adapters are always probed successfully.
 *
 * @param context The adapter context (cwd, repoRoot, homeDir).
 * @param adapters Optional list of adapters to probe (defaults to all registered adapters).
 * @returns Array of {@link DetectedAgent} results in deterministic order.
 */
export async function detectAgents(
  context: AdapterContext,
  adapters: readonly AgentAdapter[] = DEFAULT_ADAPTERS,
): Promise<DetectedAgent[]> {
  const results: DetectedAgent[] = [];

  for (const adapter of adapters) {
    const result = await probeAdapterSafely(adapter, context);
    results.push(result);
  }

  return results;
}

/**
 * Probe adapters and return only those that detected session data in the environment.
 *
 * @param context The adapter context.
 * @param adapters Optional list of adapters to probe.
 * @returns Array of {@link AgentAdapter} instances that detected session data.
 */
export async function getDetectedAdapters(
  context: AdapterContext,
  adapters: readonly AgentAdapter[] = DEFAULT_ADAPTERS,
): Promise<AgentAdapter[]> {
  const results = await detectAgents(context, adapters);
  return results.filter((r) => r.detection.detected).map((r) => r.adapter);
}
