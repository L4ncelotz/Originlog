# 03 — Architecture

## 1. Architectural Goal

AgentTrace must support multiple coding agents without letting vendor-specific session formats leak into the rest of the system.

The architecture is therefore split into five boundaries:

1. **Agent adapters** — detect and normalize external session data.
2. **Core model** — agent-independent sessions, events, and evidence.
3. **Git layer** — repository state, diff, log, and blame.
4. **Correlation/provenance engine** — combines agent evidence with Git evidence.
5. **Presentation** — CLI output and later HTML reports.

## 2. High-Level Flow

```text
┌─────────────────────────────┐
│ Local coding-agent history  │
│ Claude / Codex / others     │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ Agent adapter               │
│ detect / parse / normalize  │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ Normalized core model       │
│ Session / Event / FileTouch │
└──────────────┬──────────────┘
               │
       ┌───────┴────────┐
       ▼                ▼
┌──────────────┐  ┌──────────────┐
│ Local index  │  │ Git analyzer │
│ SQLite       │  │ diff/blame   │
└──────┬───────┘  └──────┬───────┘
       │                 │
       └────────┬────────┘
                ▼
┌─────────────────────────────┐
│ Correlation / provenance    │
│ evidence + confidence       │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ CLI / JSON / HTML report    │
└─────────────────────────────┘
```

## 3. Repository Layout

```text
src/
├── cli/
│   ├── index.ts
│   └── commands/
│       ├── doctor.ts
│       ├── sessions.ts
│       ├── show.ts
│       ├── diff.ts
│       └── why.ts
│
├── adapters/
│   ├── types.ts
│   ├── registry.ts
│   ├── claude/
│   │   ├── adapter.ts
│   │   ├── detector.ts
│   │   ├── parser.ts
│   │   └── schemas.ts
│   └── codex/
│       └── ...
│
├── core/
│   ├── sessions.ts
│   ├── events.ts
│   ├── correlation.ts
│   ├── provenance.ts
│   └── confidence.ts
│
├── git/
│   ├── repository.ts
│   ├── status.ts
│   ├── diff.ts
│   ├── log.ts
│   └── blame.ts
│
├── storage/
│   ├── database.ts
│   ├── migrations.ts
│   └── repositories/
│
├── ui/
│   ├── output.ts
│   ├── timeline.ts
│   └── table.ts
│
├── config/
│   └── paths.ts
│
└── index.ts
```

## 4. Boundary Rules

### Rule A — Agent-specific formats stop at adapters

Allowed:

```text
src/adapters/claude/*
```

Not allowed:

```ts
if (session.agent === "claude") {
  // parse Claude-specific JSON here
}
```

inside `core`, `git`, or `ui`.

### Rule B — Git layer knows nothing about agents

The Git layer exposes repository facts only:

- repo root
- working tree status
- diff hunks
- commit metadata
- blame metadata

It must not decide which agent caused a change.

### Rule C — Correlation returns evidence, not truth claims

The correlation engine should return candidates such as:

```ts
{
  sessionId: "8d7fa921",
  score: 0.86,
  evidence: [...]
}
```

The caller decides how to present confidence.

### Rule D — UI never reparses source data

CLI/rendering consumes normalized models only.

## 5. Adapter Contract

```ts
export interface AgentAdapter {
  id: string;
  displayName: string;

  detect(context: AdapterContext): Promise<AgentDetection>;

  listSessions(
    context: AdapterContext,
  ): Promise<NormalizedSessionSummary[]>;

  loadSession(
    sessionId: string,
    context: AdapterContext,
  ): Promise<NormalizedSession>;
}
```

Supporting types:

```ts
export interface AdapterContext {
  cwd: string;
  repoRoot?: string;
  homeDir: string;
}

export interface AgentDetection {
  detected: boolean;
  sourcePaths: string[];
  sessionCount?: number;
  warnings?: string[];
}
```

## 6. Adapter Lifecycle

```text
detect()
   ↓
find candidate source files
   ↓
parse raw records
   ↓
validate tolerant boundary schema
   ↓
normalize events
   ↓
normalize file paths
   ↓
return common model
```

Adapters should preserve unknown raw metadata in a bounded `metadata` object when useful, but core logic must not rely on it.

## 7. Session-to-Repository Matching

Preferred evidence order:

1. exact recorded project/repository path
2. normalized repository root
3. working directory contained by repository root
4. known file references that map into current repository
5. explicit `--all` fallback

Matching should return a confidence/reason rather than silently treating all nearby sessions as belonging to the repo.

## 8. Correlation Pipeline

For:

```bash
agenttrace why src/auth/token.ts:47
```

Use:

```text
Parse target location
      ↓
Resolve repository-relative path
      ↓
Read current Git blame / diff context
      ↓
Find candidate sessions touching file
      ↓
Score exact edit-range overlap
      ↓
Score timestamp proximity
      ↓
Score commit/session association
      ↓
Collect command/test evidence
      ↓
Rank candidates
      ↓
Return best result + alternatives if close
```

## 9. Evidence Model

Example evidence kinds:

```ts
type EvidenceKind =
  | "explicit_file_edit"
  | "line_overlap"
  | "file_touch"
  | "timestamp_proximity"
  | "commit_proximity"
  | "blame_commit_match"
  | "test_reference"
  | "command_reference"
  | "project_path_match";
```

Each evidence item should contain:

```ts
interface Evidence {
  kind: EvidenceKind;
  weight: number;
  description: string;
  metadata?: Record<string, unknown>;
}
```

Weights must remain internal implementation details. User-facing output should show qualitative confidence and human-readable evidence.

## 10. Storage Architecture

SQLite is a rebuildable index.

```text
Raw session files ──┐
                    ├── scan/index ──> SQLite
Git repository ─────┘
```

If schema changes significantly during early development, prefer simple migration/reset logic rather than maintaining complex backward compatibility before v1.0.

## 11. Error Handling

Distinguish:

### User/environment error

```text
Not inside a Git repository.
```

### Adapter unsupported format

```text
Claude session format was recognized but 4 records could not be normalized.
Run with --debug for details.
```

### No provenance

```text
No reliable agent provenance found for src/auth/token.ts:47.
```

These are different states and must not collapse into a generic exception.

## 12. Performance Targets

MVP targets:

- CLI help: effectively instant
- `doctor`: under ~1 second for normal local setups
- `sessions`: under ~2 seconds after indexing
- `show`: under ~1 second for normal sessions
- `why`: ideally under ~2 seconds after indexing

Do not optimize prematurely. Measure before adding caching complexity.

## 13. Privacy Boundary

AgentTrace may read sensitive local history. Therefore:

- default outputs should summarize rather than dump entire raw records
- no network access is required for core commands
- no automatic upload
- HTML reports are generated locally
- debug mode must clearly indicate when raw content may be printed

## 14. Extension Points

Stable extension points to design for:

- new agent adapters
- new provenance evidence providers
- alternative renderers (`text`, `json`, `html`)

Do **not** create a formal plugin SDK before a second real adapter proves the interfaces.
