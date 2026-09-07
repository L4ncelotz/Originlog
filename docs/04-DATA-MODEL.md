# 04 — Data Model

## 1. Design Goal

The normalized model must preserve enough information for provenance analysis without mirroring any single agent's internal schema.

The model should be:

- agent-independent
- tolerant of missing fields
- serializable
- indexable in SQLite
- suitable for deterministic tests

## 2. Core Types

### NormalizedSession

```ts
export interface NormalizedSession {
  id: string;
  agent: string;
  sourcePath?: string;
  projectPath?: string;
  repoRoot?: string;
  startedAt: Date;
  endedAt?: Date;
  prompt?: string;
  title?: string;
  events: NormalizedEvent[];
  metadata?: Record<string, unknown>;
}
```

### NormalizedEvent

```ts
export type EventType =
  | "prompt"
  | "read"
  | "write"
  | "command"
  | "result"
  | "error"
  | "test"
  | "unknown";

export interface NormalizedEvent {
  id: string;
  sessionId: string;
  timestamp: Date;
  type: EventType;
  file?: string;
  command?: string;
  content?: string;
  success?: boolean;
  range?: LineRange;
  metadata?: Record<string, unknown>;
}
```

### LineRange

```ts
export interface LineRange {
  startLine: number;
  endLine: number;
}
```

Line numbers are 1-based at the public API boundary.

## 3. Session Summary

Listings should not load full sessions when avoidable.

```ts
export interface NormalizedSessionSummary {
  id: string;
  agent: string;
  projectPath?: string;
  startedAt: Date;
  endedAt?: Date;
  promptPreview?: string;
  eventCount?: number;
  touchedFileCount?: number;
}
```

## 4. File Touch / Change

```ts
export interface FileTouch {
  sessionId: string;
  file: string;
  firstTouchedAt?: Date;
  lastTouchedAt?: Date;
  read: boolean;
  written: boolean;
  ranges: LineRange[];
}
```

For correlation with Git:

```ts
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
```

Do not assume every adapter provides exact ranges or hashes.

## 5. Git Models

### GitCommit

```ts
export interface GitCommit {
  hash: string;
  authorName: string;
  authorEmail?: string;
  authoredAt: Date;
  committedAt: Date;
  subject: string;
}
```

### GitDiffFile

```ts
export interface GitDiffFile {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "unknown";
  additions?: number;
  deletions?: number;
  hunks?: GitDiffHunk[];
}
```

### GitDiffHunk

```ts
export interface GitDiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header?: string;
}
```

### GitBlameLine

```ts
export interface GitBlameLine {
  line: number;
  commitHash: string;
  author?: string;
  committedAt?: Date;
  content?: string;
}
```

## 6. Provenance Models

### Evidence

```ts
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

export interface Evidence {
  kind: EvidenceKind;
  weight: number;
  description: string;
  metadata?: Record<string, unknown>;
}
```

### Candidate

```ts
export interface ProvenanceCandidate {
  sessionId: string;
  agent: string;
  prompt?: string;
  score: number;
  evidence: Evidence[];
}
```

### Result

```ts
export type Confidence = "low" | "medium" | "high";

export interface ProvenanceResult {
  file: string;
  line?: number;
  best?: ProvenanceCandidate;
  alternatives?: ProvenanceCandidate[];
  confidence: Confidence;
  reason?: string;
}
```

## 7. Confidence Model

Do not expose a fake scientific percentage to users.

Internally, a normalized score can be useful:

```text
0.00 ─────────────── 1.00
```

Initial qualitative mapping may be:

```text
0.00–0.39  Low
0.40–0.69  Medium
0.70–1.00  High
```

These thresholds are provisional and must be tuned against fixtures.

### Example weighting direction

Strong evidence:

- explicit edit of target file
- exact line-range overlap
- associated blame/commit match

Medium evidence:

- file touched during session
- repository/project path match
- close timestamp

Weak evidence:

- same day only
- command text mentions filename without edit

## 8. SQLite Schema

Suggested initial schema:

```sql
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  source_path TEXT,
  project_path TEXT,
  repo_root TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  prompt TEXT,
  title TEXT,
  PRIMARY KEY (agent_id, id)
);

CREATE TABLE events (
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL,
  file TEXT,
  command TEXT,
  content TEXT,
  success INTEGER,
  start_line INTEGER,
  end_line INTEGER,
  metadata_json TEXT,
  PRIMARY KEY (agent_id, session_id, id)
);

CREATE TABLE session_files (
  agent_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  file TEXT NOT NULL,
  first_touched_at INTEGER,
  last_touched_at INTEGER,
  was_read INTEGER NOT NULL DEFAULT 0,
  was_written INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, session_id, file)
);

CREATE TABLE scan_state (
  source_path TEXT PRIMARY KEY,
  fingerprint TEXT,
  scanned_at INTEGER NOT NULL
);
```

Add indexes after profiling actual queries.

Likely useful later:

```sql
CREATE INDEX idx_sessions_repo_started
ON sessions(repo_root, started_at DESC);

CREATE INDEX idx_session_files_file
ON session_files(file);
```

## 9. Timestamp Representation

In memory:

```ts
Date
```

In SQLite:

```text
Unix milliseconds INTEGER
```

In JSON output:

```text
ISO 8601 string
```

Avoid locale-dependent serialization.

## 10. Path Normalization

Store repository files in normalized repository-relative form where possible:

```text
src/auth/token.ts
```

Do not mix:

```text
C:\work\repo\src\auth\token.ts
/home/user/repo/src/auth/token.ts
src/auth/token.ts
```

Core helper responsibilities:

- resolve absolute path
- detect repo root
- convert to repo-relative path
- normalize separators to `/` in persisted normalized records

## 11. Unknown Data

External session formats will evolve.

Rules:

- unknown record types should not crash the whole session
- preserve useful raw fields in `metadata` selectively
- increment diagnostics/warnings for unsupported records
- do not persist arbitrarily huge raw blobs by default

## 12. Data Retention

MVP behavior:

- do not delete source logs
- local cache can be reset
- expose a future command such as `agenttrace cache clear`

No automatic cloud retention exists in MVP.
