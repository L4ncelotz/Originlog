/**
 * Core session model, provenance types, and path / session helpers.
 *
 * No agent-specific data shapes live here. Adapters translate their
 * vendor session formats into {@link NormalizedSession} before any
 * downstream code touches the data.
 */

import type { NormalizedEvent } from "./events.js";

/**
 * Agent-agnostic representation of a single coding session.
 *
 * A session corresponds to a continuous period of agent activity
 * (one CLI run, one IDE interaction, etc.) and contains an ordered list
 * of {@link NormalizedEvent} records.
 *
 * Missing or unparseable timestamps remain `undefined`; timestamps MUST NEVER
 * be fabricated with `new Date()`, as doing so corrupts correlation and provenance.
 */
export interface NormalizedSession {
  /** Stable session identifier (unique within the agent namespace). */
  id: string;
  /** Agent that produced this session (e.g. `"claude"`, `"codex"`). */
  agent: string;
  /** Absolute path to the on-disk source record (debug / provenance). */
  sourcePath?: string;
  /** Project the agent recorded for this session, if any. */
  projectPath?: string;
  /** Repository root the session was associated with, if known. */
  repoRoot?: string;
  /** Time the session began, when known. */
  startedAt?: Date;
  /** Time the session ended, if known. */
  endedAt?: Date;
  /** Initial user prompt / task that kicked off the session. */
  prompt?: string;
  /** Optional short title (often the first line of the prompt). */
  title?: string;
  /** Events in encounter order. Sorting is the caller's responsibility. */
  events: NormalizedEvent[];
  /** Escape hatch for vendor-specific fields the core model doesn't model. */
  metadata?: Record<string, unknown>;
}

/**
 * Compact summary of a session for listings and command output.
 *
 * Avoids loading the full event list when a lightweight representation
 * is enough.
 */
export interface NormalizedSessionSummary {
  id: string;
  agent: string;
  projectPath?: string;
  startedAt?: Date;
  endedAt?: Date;
  /** Truncated single-line preview of the prompt, if any. */
  promptPreview?: string;
  /** Total number of events in the session. */
  eventCount?: number;
  /** Number of distinct files touched by any event in the session. */
  touchedFileCount?: number;
}

/**
 * Categories of evidence the correlation engine can collect.
 */
export type EvidenceKind =
  | "explicit_file_edit"
  | "line_overlap"
  | "file_touch"
  | "timestamp_proximity"
  | "commit_proximity"
  | "blame_commit_match"
  | "test_reference"
  | "command_reference"
  | "project_path_match";

/**
 * A single piece of evidence supporting a provenance claim.
 *
 * Optional `weight` is an internal numeric signal for future scoring;
 * concrete scoring policies are deferred to Step 11/12.
 */
export interface Evidence {
  kind: EvidenceKind;
  /** Optional numeric weight; scoring policy is defined in later steps. */
  weight?: number;
  /** Human-readable explanation suitable for command output. */
  description: string;
  /** Optional structured details. */
  metadata?: Record<string, unknown>;
}

/**
 * Qualitative confidence level for a provenance claim.
 *
 * Step 1 defines the qualitative categories only. Concrete scoring rules,
 * thresholds, and evidence weights are deferred to Step 11/12.
 */
export type Confidence = "confirmed" | "strong" | "possible" | "unknown";

/**
 * A candidate session that may be the origin of a particular file or
 * line change, along with the evidence that supports the claim.
 */
export interface ProvenanceCandidate {
  sessionId: string;
  agent: string;
  prompt?: string;
  /** Optional aggregate score; concrete scoring policy is defined in later steps. */
  score?: number;
  evidence: Evidence[];
}

/**
 * A directed edge in a provenance graph.
 */
export interface ProvenanceLink {
  sourceId: string;
  targetId: string;
  relation: string;
  confidence: Confidence;
  evidence: Evidence[];
}

/**
 * The full result of a `why` query: the target, the strongest candidate,
 * possible alternatives, and the qualitative confidence.
 */
export interface ProvenanceResult {
  /** Repo-relative file path that was queried. */
  file: string;
  /** Optional line number, when the query was about a specific line. */
  line?: number;
  /** Strongest candidate session, if any. */
  best?: ProvenanceCandidate;
  /** Other plausible candidates, when the top result is not conclusive. */
  alternatives?: ProvenanceCandidate[];
  confidence: Confidence;
  /** Human-readable explanation of why this confidence was assigned. */
  reason?: string;
}

/**
 * Create a {@link NormalizedSession} with safe defaults.
 *
 * Missing timestamps remain `undefined` to preserve provenance integrity.
 */
export function createNormalizedSession(
  params: Partial<NormalizedSession> & { id: string; agent: string },
): NormalizedSession {
  return {
    id: params.id,
    agent: params.agent,
    sourcePath: params.sourcePath,
    projectPath: params.projectPath,
    repoRoot: params.repoRoot,
    startedAt: params.startedAt,
    endedAt: params.endedAt,
    prompt: params.prompt,
    title: params.title,
    events: params.events ?? [],
    metadata: params.metadata,
  };
}

/**
 * Build a {@link NormalizedSessionSummary} from a full session.
 *
 * - Safely handles missing `prompt`, `startedAt`, `endedAt`, `events`, and other
 *   optional fields without throwing.
 * - `promptPreview` is the trimmed first line of `session.prompt`,
 *   truncated to 100 characters with a trailing `...` when longer.
 * - `eventCount` reflects the number of events (0 when none).
 * - `touchedFileCount` counts distinct non-empty `file` values
 *   across the events.
 */
export function summarizeSession(
  session: NormalizedSession,
): NormalizedSessionSummary {
  const events = session.events ?? [];
  const uniqueFiles = new Set<string>();
  for (const event of events) {
    if (
      event &&
      typeof event.file === "string" &&
      event.file.length > 0 &&
      event.success !== false
    ) {
      uniqueFiles.add(event.file);
    }
  }

  let promptPreview: string | undefined;
  if (typeof session.prompt === "string") {
    const trimmed = session.prompt.trim();
    if (trimmed.length > 0) {
      const firstLine = trimmed.split(/\r?\n/)[0] ?? "";
      promptPreview =
        firstLine.length > 100 ? `${firstLine.slice(0, 97)}...` : firstLine;
    }
  }

  return {
    id: session.id,
    agent: session.agent,
    projectPath: session.projectPath,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    promptPreview,
    eventCount: events.length,
    touchedFileCount: uniqueFiles.size,
  };
}

/**
 * Normalize a file path for storage and comparison.
 *
 * The returned path is always:
 * - using forward slashes (`/`), even on Windows
 * - without a trailing slash (unless it is the root)
 * - without duplicate consecutive slashes
 * - without a leading `./` (e.g. `./src/auth.ts` → `src/auth.ts`)
 * - with `.` and `..` segments resolved against the current path
 *
 * When `repoRoot` is provided:
 * - `repoRoot` is normalized the same way.
 * - If `filePath` is inside `repoRoot`, the result is the path
 *   relative to `repoRoot`.
 * - On Windows, the drive letter comparison is case-insensitive
 *   (`C:/project` matches `c:/project`).
 *
 * Filenames containing spaces are preserved verbatim.
 */
function cleanPathSegments(pathStr: string): string {
  if (!pathStr) return "";
  let p = pathStr.replace(/\\/g, "/");

  const isWindowsDrive = /^[a-zA-Z]:/.test(p);
  const isUnc = p.startsWith("//") && !p.startsWith("///");
  const isPosixAbsolute = !isUnc && p.startsWith("/");
  let prefix = "";

  if (isWindowsDrive) {
    prefix = p.slice(0, 2);
    p = p.slice(2);
  } else if (isUnc) {
    prefix = "//";
    p = p.slice(2);
  }

  const isAbsolute = isPosixAbsolute || isUnc || (isWindowsDrive && p.startsWith("/"));
  if (isWindowsDrive && p.startsWith("/")) {
    prefix += "/";
    p = p.slice(1);
  } else if (isPosixAbsolute) {
    prefix = "/";
    p = p.slice(1);
  }

  const parts = p.split("/").filter(Boolean);
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      if (isUnc) {
        if (resolved.length > 2) {
          resolved.pop();
        }
      } else if (resolved.length > 0 && resolved[resolved.length - 1] !== "..") {
        resolved.pop();
      } else if (!isAbsolute) {
        resolved.push("..");
      }
    } else {
      resolved.push(part);
    }
  }

  if (isUnc && resolved.length < 2) {
    return "";
  }

  const result = prefix + resolved.join("/");
  if (!result && isAbsolute) return prefix;
  return result;
}

function isWindowsPath(p: string): boolean {
  return /^[a-zA-Z]:/.test(p) || p.startsWith("//");
}

function isValidRepoRoot(normalizedRepo: string): boolean {
  if (!normalizedRepo || normalizedRepo.trim().length === 0) {
    return false;
  }
  if (
    normalizedRepo === "." ||
    normalizedRepo === ".." ||
    normalizedRepo.startsWith("./") ||
    normalizedRepo.startsWith("../")
  ) {
    return false;
  }
  const isWindowsDrive = /^[a-zA-Z]:(\/|$)/.test(normalizedRepo);
  const isUnc = /^\/\/[^/]+\/[^/]+(\/|$)/.test(normalizedRepo);
  const isPosixAbsolute =
    normalizedRepo.startsWith("/") && !normalizedRepo.startsWith("//");

  return isWindowsDrive || isUnc || isPosixAbsolute;
}

export function normalizePath(filePath: string, repoRoot?: string): string {
  if (typeof filePath !== "string" || filePath.length === 0) return "";

  const resolvedPath = cleanPathSegments(filePath);
  if (!resolvedPath) return "";

  if (typeof repoRoot === "string" && repoRoot.length > 0) {
    const resolvedRoot = cleanPathSegments(repoRoot);
    if (resolvedRoot) {
      const isWindows =
        isWindowsPath(resolvedPath) || isWindowsPath(resolvedRoot);
      const pComp = isWindows ? resolvedPath.toLowerCase() : resolvedPath;
      const rComp = isWindows ? resolvedRoot.toLowerCase() : resolvedRoot;

      if (pComp === rComp) {
        return "";
      }
      const rootPrefix = rComp.endsWith("/") ? rComp : `${rComp}/`;
      if (pComp.startsWith(rootPrefix)) {
        return resolvedPath.slice(rootPrefix.length);
      }
    }
  }

  return resolvedPath;
}

/**
 * Match result explaining whether and why a session belongs to a repository.
 */
export interface RepositorySessionMatch {
  /** Whether the session was matched to the repository. */
  matched: boolean;
  /** Human-readable explanation of why the session matched or failed to match. */
  reason: string;
  /** Normalized Git repository root path against which the session was checked. */
  repoRoot: string;
  /** The session's normalized working directory / project path, if available. */
  sessionPath?: string;
}

/**
 * Any session representation that contains working directory / repository evidence.
 */
export type MatchableSession = NormalizedSession | NormalizedSessionSummary;

/**
 * Determine whether a single session belongs to the specified repository.
 *
 * Evidence-driven and conservative:
 * - Matches if session working directory equals repository root.
 * - Matches if session working directory is a descendant of repository root.
 * - Does not match similar path prefixes (/work/app vs /work/application).
 * - Does not match on close timestamps or similar names.
 * - Returns matched=false when path evidence is missing.
 */
export function matchSessionToRepository(
  session: MatchableSession,
  repoRoot: string,
): RepositorySessionMatch {
  if (typeof repoRoot !== "string" || repoRoot.trim().length === 0) {
    const rawProjPath =
      session.projectPath ?? ("repoRoot" in session ? session.repoRoot : undefined);
    return {
      matched: false,
      reason: "Repository root path is required.",
      repoRoot: "",
      sessionPath:
        typeof rawProjPath === "string" && rawProjPath.trim().length > 0
          ? cleanPathSegments(rawProjPath)
          : undefined,
    };
  }

  const normalizedRepo = cleanPathSegments(repoRoot);
  if (!isValidRepoRoot(normalizedRepo)) {
    const rawProjPath =
      session.projectPath ?? ("repoRoot" in session ? session.repoRoot : undefined);
    return {
      matched: false,
      reason: "Repository root path is invalid.",
      repoRoot: normalizedRepo,
      sessionPath:
        typeof rawProjPath === "string" && rawProjPath.trim().length > 0
          ? cleanPathSegments(rawProjPath)
          : undefined,
    };
  }

  const rawPath =
    session.projectPath ?? ("repoRoot" in session ? session.repoRoot : undefined);

  if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
    return {
      matched: false,
      reason: "Session has no working directory or project path evidence.",
      repoRoot: normalizedRepo,
      sessionPath: undefined,
    };
  }

  const normalizedSession = cleanPathSegments(rawPath);
  if (!normalizedSession) {
    return {
      matched: false,
      reason: "Session has no working directory or project path evidence.",
      repoRoot: normalizedRepo,
      sessionPath: undefined,
    };
  }

  const isWindows =
    isWindowsPath(normalizedSession) || isWindowsPath(normalizedRepo);
  const sComp = isWindows ? normalizedSession.toLowerCase() : normalizedSession;
  const rComp = isWindows ? normalizedRepo.toLowerCase() : normalizedRepo;

  // Exact match
  if (sComp === rComp) {
    return {
      matched: true,
      reason: "Working directory exactly matches repository root.",
      repoRoot: normalizedRepo,
      sessionPath: normalizedSession,
    };
  }

  // Descendant subdirectory match (using guarded prefix boundary to prevent prefix substring collision)
  const rootPrefix = rComp.endsWith("/") ? rComp : `${rComp}/`;
  if (sComp.startsWith(rootPrefix)) {
    const relativeSubdir = normalizedSession.slice(rootPrefix.length);
    return {
      matched: true,
      reason: `Working directory is inside repository subdirectory "${relativeSubdir}".`,
      repoRoot: normalizedRepo,
      sessionPath: normalizedSession,
    };
  }

  // Outside repository (different directory, ancestor directory, or prefix collision)
  return {
    matched: false,
    reason: "Working directory is outside repository.",
    repoRoot: normalizedRepo,
    sessionPath: normalizedSession,
  };
}

/**
 * Filter an array of sessions, returning only those that belong to the repository.
 * Preserves the input array order deterministically.
 */
export function filterSessionsForRepository<T extends MatchableSession>(
  sessions: readonly T[],
  repoRoot: string,
): T[] {
  return sessions.filter(
    (session) => matchSessionToRepository(session, repoRoot).matched,
  );
}

/**
 * Match an array of sessions against a repository, returning each session paired with its match report.
 * Preserves the input array order deterministically.
 */
export function matchSessionsToRepository<T extends MatchableSession>(
  sessions: readonly T[],
  repoRoot: string,
): Array<{ session: T; match: RepositorySessionMatch }> {
  return sessions.map((session) => ({
    session,
    match: matchSessionToRepository(session, repoRoot),
  }));
}
