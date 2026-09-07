# AgentTrace — Project Plan

> **Positioning:** `git blame` for AI coding agents.
>
> Git tells you **what** changed. AgentTrace tells you **why**.

---

## 1. Project Goal

AgentTrace is a **local-first CLI developer tool** that reads local AI coding-agent session data, correlates it with Git/file changes, and answers questions such as:

```bash
agenttrace sessions
agenttrace show <session-id>
agenttrace diff <session-id>
agenttrace why src/auth/token.ts:47
```

Primary goals:

- Understand which AI agent changed a file or line.
- Recover the prompt/task that led to the change.
- Show the action timeline: read → edit → test → retry → pass/fail.
- Correlate agent activity with Git history and working-tree diffs.
- Work locally with no account, API key, telemetry, or server.
- Support multiple coding agents through adapters.

Non-goals for the MVP:

- SaaS dashboard.
- Team collaboration.
- Cloud sync.
- AI-generated summaries that require paid APIs.
- Full IDE extension.
- Supporting every coding agent on day one.

---

# 2. Recommended Documentation Structure

Use **8 core Markdown files** plus `README.md`.

```text
agenttrace/
├── README.md
├── docs/
│   ├── 01-PRODUCT.md
│   ├── 02-TECH-STACK.md
│   ├── 03-ARCHITECTURE.md
│   ├── 04-DATA-MODEL.md
│   ├── 05-IMPLEMENTATION.md
│   ├── 06-PHASE-PLAN.md
│   ├── 07-TESTING.md
│   └── 08-ROADMAP.md
└── CONTRIBUTING.md
```

## Why this split?

| File | Purpose |
|---|---|
| `README.md` | Sell the project in 5–10 seconds and show usage |
| `01-PRODUCT.md` | Product scope, users, problem, features, non-goals |
| `02-TECH-STACK.md` | Exact libraries, why they are used, what is intentionally avoided |
| `03-ARCHITECTURE.md` | Components, adapters, data flow, boundaries |
| `04-DATA-MODEL.md` | Normalized session/event/change structures |
| `05-IMPLEMENTATION.md` | Exact build order and engineering tasks |
| `06-PHASE-PLAN.md` | Milestones and release phases |
| `07-TESTING.md` | Unit/integration/fixture strategy and acceptance checks |
| `08-ROADMAP.md` | Post-MVP features and long-term direction |
| `CONTRIBUTING.md` | Makes the repo contribution-ready once public |

**Do not create 20+ docs initially.** Nine focused files are enough to keep humans and coding agents aligned without creating documentation debt.

---

# 3. MVP Product Definition

## Target User

Developers who use AI coding agents such as:

- Claude Code
- Codex
- OpenCode
- Future agent adapters

## Core User Story

> I used an AI coding agent several hours or days ago. I want to know why a specific file or line changed, what task caused it, and what happened during that agent session.

## MVP Commands

### `agenttrace doctor`

Detect available agents and verify configuration.

```text
$ agenttrace doctor

AgentTrace Doctor

✓ Git repository detected
✓ Claude Code detected     14 sessions
✓ Codex detected            6 sessions
- OpenCode not detected

Repository: /home/user/project
```

### `agenttrace sessions`

List recent sessions related to the current repository.

```text
$ agenttrace sessions

ID       Agent         Started       Files   Status
8d7fa9   Claude Code   10:42         4       PASS
1aa210   Codex         09:18         7       FAIL
```

### `agenttrace show <session-id>`

Display the normalized timeline.

```text
Prompt
"Fix authentication refresh token"

10:42:01  READ     src/auth/token.ts
10:42:14  EDIT     src/auth/token.ts     +21 -8
10:42:26  RUN      npm test
10:42:31  FAIL     refresh-token.test.ts
10:43:02  EDIT     src/auth/token.ts     +7 -2
10:43:16  RUN      npm test
10:43:22  PASS
```

### `agenttrace diff <session-id>`

Show files likely changed during a session.

### `agenttrace why <file>:<line>`

The main differentiator.

```text
$ agenttrace why src/auth/token.ts:47

Changed by
Claude Code

Session
8d7fa921

Prompt
"Fix authentication refresh token"

Evidence
- Read src/auth/token.ts
- Edited lines near 31-58
- npm test failed
- Edited lines near 44-51
- npm test passed

Confidence
High
```

---

# 4. Tech Stack

## Language

### TypeScript + Node.js

Reasons:

- Coding-agent session data is usually JSON/JSONL/text-oriented.
- Easy CLI distribution through npm.
- Excellent filesystem/process ecosystem.
- Fast iteration for a solo developer.
- Easy adapter/plugin architecture.

Target:

```text
Node.js >= 20
TypeScript >= 5.x
```

## Core Libraries

| Area | Choice | Reason |
|---|---|---|
| CLI | `commander` | Mature, simple command structure |
| Validation | `zod` | Normalize unreliable external session formats |
| Database | `better-sqlite3` | Local-first, synchronous, fast, no server |
| Git | native `git` via `execa` | Avoid over-abstracting Git behavior |
| Process execution | `execa` | Safe process invocation |
| Terminal output | `picocolors` | Lightweight terminal colors |
| Tables | `cli-table3` or custom | Session listings |
| Tests | `vitest` | Fast TypeScript-native testing |
| Lint/format | `eslint` + `prettier` | Standard tooling |
| Build | `tsup` | Simple CLI bundling |

## Optional Later

| Library | Use |
|---|---|
| `ink` | Rich interactive terminal UI |
| `hono` | Local HTTP server for HTML reports |
| `vite` | Interactive HTML report frontend |
| `react` | Only if report UI becomes complex |

## Explicitly Avoid in MVP

- Next.js
- PostgreSQL
- Redis
- Prisma
- Supabase
- Docker requirement
- Cloud backend
- Authentication

They add complexity without helping the core problem.

---

# 5. Repository Structure

```text
agenttrace/
├── src/
│   ├── cli/
│   │   ├── index.ts
│   │   └── commands/
│   │       ├── doctor.ts
│   │       ├── sessions.ts
│   │       ├── show.ts
│   │       ├── diff.ts
│   │       └── why.ts
│   │
│   ├── adapters/
│   │   ├── types.ts
│   │   ├── registry.ts
│   │   ├── claude/
│   │   │   ├── adapter.ts
│   │   │   ├── detector.ts
│   │   │   └── parser.ts
│   │   ├── codex/
│   │   │   ├── adapter.ts
│   │   │   ├── detector.ts
│   │   │   └── parser.ts
│   │   └── opencode/
│   │       └── ...
│   │
│   ├── core/
│   │   ├── sessions.ts
│   │   ├── events.ts
│   │   ├── correlation.ts
│   │   ├── provenance.ts
│   │   └── confidence.ts
│   │
│   ├── git/
│   │   ├── repository.ts
│   │   ├── blame.ts
│   │   ├── diff.ts
│   │   ├── log.ts
│   │   └── status.ts
│   │
│   ├── storage/
│   │   ├── database.ts
│   │   ├── migrations.ts
│   │   └── repositories/
│   │
│   ├── ui/
│   │   ├── output.ts
│   │   ├── timeline.ts
│   │   └── table.ts
│   │
│   ├── config/
│   │   └── paths.ts
│   │
│   └── index.ts
│
├── tests/
│   ├── fixtures/
│   │   ├── claude/
│   │   ├── codex/
│   │   └── git-repos/
│   ├── unit/
│   └── integration/
│
├── docs/
├── package.json
├── tsconfig.json
└── README.md
```

---

# 6. Architecture

## High-Level Flow

```text
┌──────────────────────────────┐
│ Local Coding Agent Data      │
│                              │
│ Claude / Codex / OpenCode    │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Agent Adapters               │
│                              │
│ detect → parse → normalize   │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Normalized Event Model       │
│                              │
│ Session / Event / Change     │
└──────────────┬───────────────┘
               │
        ┌──────┴──────┐
        │             │
        ▼             ▼
┌─────────────┐ ┌──────────────┐
│ SQLite      │ │ Git Analyzer │
│ Local Cache │ │ diff/blame   │
└──────┬──────┘ └──────┬───────┘
       │               │
       └───────┬───────┘
               ▼
┌──────────────────────────────┐
│ Correlation Engine           │
│                              │
│ Session ↔ file ↔ line ↔ git │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ CLI                          │
│                              │
│ sessions/show/diff/why       │
└──────────────────────────────┘
```

---

# 7. Adapter Contract

Every supported coding agent must map its own session format into a common model.

```ts
export interface AgentAdapter {
  id: string;
  displayName: string;

  detect(): Promise<AgentDetection>;

  listSessions(context: AdapterContext): Promise<NormalizedSession[]>;

  loadSession(
    sessionId: string,
    context: AdapterContext
  ): Promise<NormalizedSession>;
}
```

Important rule:

> Agent-specific parsing must stay inside `src/adapters`.

The rest of AgentTrace must never depend on Claude/Codex-specific JSON structures.

---

# 8. Data Model

## Session

```ts
interface NormalizedSession {
  id: string;
  agent: string;
  projectPath?: string;
  startedAt: Date;
  endedAt?: Date;
  prompt?: string;
  events: NormalizedEvent[];
}
```

## Event

```ts
type EventType =
  | "prompt"
  | "read"
  | "write"
  | "command"
  | "result"
  | "error"
  | "test"
  | "unknown";

interface NormalizedEvent {
  id: string;
  sessionId: string;
  timestamp: Date;
  type: EventType;
  file?: string;
  command?: string;
  content?: string;
  success?: boolean;
  metadata?: Record<string, unknown>;
}
```

## File Change

```ts
interface FileChange {
  sessionId: string;
  file: string;
  firstTouchedAt?: Date;
  lastTouchedAt?: Date;
  linesAdded?: number;
  linesRemoved?: number;
  beforeHash?: string;
  afterHash?: string;
}
```

## Provenance Result

```ts
interface ProvenanceResult {
  file: string;
  line?: number;
  sessionId?: string;
  agent?: string;
  prompt?: string;
  evidence: Evidence[];
  confidence: "low" | "medium" | "high";
}
```

---

# 9. Correlation Strategy

This is the technically important part of AgentTrace.

Do **not** claim perfect attribution.

Use evidence and confidence scores.

## Possible Evidence

1. Agent explicitly wrote the file.
2. Edit happened during the session time window.
3. Git diff overlaps the edited region.
4. Commit timestamp is close to the session.
5. File hash changed between session events.
6. Test failure/retry references the same file.
7. Git blame points to a commit associated with the session.

Example:

```text
High confidence
- Agent write event references src/auth.ts
- Session diff contains src/auth.ts
- Changed line range overlaps line 47

Medium confidence
- File changed during session
- No exact edit range available

Low confidence
- Only timestamp proximity exists
```

The CLI should expose this honestly:

```text
Confidence: High
```

not:

```text
100% definitely changed by Claude
```

---

# 10. SQLite Usage

SQLite is a **cache/index**, not the source of truth.

Source of truth remains:

- agent session files
- Git repository

Suggested tables:

```text
agents
sessions
events
file_changes
session_files
scan_state
```

The database can be deleted and rebuilt at any time.

Example location:

```text
~/.agenttrace/agenttrace.db
```

---

# 11. Implementation Plan

## Step 0 — Repository Bootstrap

Create:

- npm project
- TypeScript
- CLI entrypoint
- Vitest
- ESLint
- Prettier
- CI

Definition of done:

```bash
npm install
npm test
npm run build
node dist/cli.js --help
```

all succeed.

---

## Step 1 — Core Types

Implement normalized models first.

Files:

```text
src/adapters/types.ts
src/core/events.ts
src/core/sessions.ts
```

No real agent parser yet.

Add fixture-based tests.

---

## Step 2 — Git Repository Layer

Implement:

```text
isGitRepository()
getRepoRoot()
getStatus()
getDiff()
getLog()
getBlame(file, line)
```

Use native Git commands.

Tests should use temporary Git repositories.

---

## Step 3 — First Adapter: Claude Code

Implement only enough fields for MVP:

- session id
- timestamps
- prompt/task
- read events
- write/edit events
- commands
- command results
- errors

Unknown fields should not crash parsing.

Use Zod at the adapter boundary.

---

## Step 4 — `doctor`

First user-facing command.

Goals:

- Detect repository.
- Detect agent data.
- Show session count.
- Show unsupported/missing states cleanly.

This validates installation before building complex behavior.

---

## Step 5 — `sessions`

List sessions associated with current project.

Need project matching strategy:

1. Exact recorded project path.
2. Repository root match.
3. Working-directory metadata.
4. Fallback: explicitly supplied `--all`.

---

## Step 6 — `show`

Render a normalized timeline.

Important formatting:

```text
READ
EDIT
RUN
PASS
FAIL
```

Do not create a full TUI yet.

---

## Step 7 — File Change Correlation

Correlate session events and repository changes.

Build:

```ts
correlateSessionChanges(session, repository)
```

Return evidence rather than only a boolean.

---

## Step 8 — `diff`

Display files and Git diff related to a session.

Example:

```text
4 files changed · +83 -21

M src/auth/token.ts
M src/auth/session.ts
A tests/refresh-token.test.ts
M package.json
```

---

## Step 9 — `why`

The killer feature.

Input:

```bash
agenttrace why src/auth/token.ts:47
```

Pipeline:

```text
file + line
    ↓
Git blame / current diff
    ↓
Candidate sessions touching file
    ↓
Event overlap
    ↓
Timestamp evidence
    ↓
Prompt/task
    ↓
Confidence calculation
    ↓
Human-readable explanation
```

This is the point where AgentTrace becomes more than a session viewer.

---

## Step 10 — Second Adapter

Only after Claude support works end-to-end.

Recommended second adapter:

```text
Codex
```

The second adapter tests whether the architecture is actually agent-independent.

---

# 12. Phase Plan

## Phase 0 — Foundation

Target release: `v0.0.x`

Deliverables:

- Repo setup
- CLI skeleton
- Core types
- Git wrapper
- Test infrastructure

Exit criteria:

- CI green.
- Basic Git functions tested.
- No agent-specific code outside adapter layer.

---

## Phase 1 — Session Explorer

Target release: `v0.1.0`

Features:

```bash
agenttrace doctor
agenttrace sessions
agenttrace show <id>
```

Support:

- Claude Code only.

Exit criteria:

- Detect Claude Code.
- Parse real sessions.
- List repository sessions.
- Render event timeline.

This version is already publishable.

---

## Phase 2 — Git Correlation

Target release: `v0.2.0`

Features:

```bash
agenttrace diff <id>
```

Add:

- file-touch tracking
- Git diff correlation
- commit/time correlation
- confidence model

Exit criteria:

- Can identify files changed during known fixture sessions.
- Correlation code has unit tests.

---

## Phase 3 — Provenance

Target release: `v0.3.0`

Feature:

```bash
agenttrace why <file>:<line>
```

This is the first **star-worthy release**.

Exit criteria:

- Returns candidate session.
- Displays original prompt/task.
- Displays evidence.
- Displays confidence level.
- Handles "unknown" honestly.

---

## Phase 4 — Multi-Agent

Target release: `v0.4.0`

Add:

- Codex adapter
- adapter registry
- mixed session list

Example:

```text
Claude Code
Codex
```

Exit criteria:

- Core code does not care which agent generated events.

---

## Phase 5 — Visual Report

Target release: `v0.5.0`

Feature:

```bash
agenttrace report <session-id>
```

Generates:

```text
agenttrace-report.html
```

Content:

- prompt
- timeline
- files
- diff summary
- test failures
- retries
- provenance evidence

Important:

The HTML report should be **single-file and portable** if reasonably possible.

This gives the README a strong GIF/screenshot demo.

---

## Phase 6 — Public Growth

Target release: `v0.6.x`

Focus shifts from code to adoption.

Add:

- npm package
- polished README
- demo GIF
- example repository
- issue templates
- contribution guide
- adapter contribution docs
- good first issues

Potential command:

```bash
npx agenttrace
```

---

# 13. Testing Strategy

## Unit Tests

Test pure logic heavily:

- adapter normalization
- event ordering
- file path normalization
- project matching
- confidence scoring
- correlation rules

## Fixture Tests

Never rely only on the developer's own local agent history.

Store sanitized fixtures:

```text
tests/fixtures/claude/
tests/fixtures/codex/
```

Each fixture should contain:

- input session file
- expected normalized session
- expected touched files
- expected timeline

## Git Integration Tests

Create temporary repositories during tests:

```text
init repo
→ commit initial file
→ edit file
→ commit
→ blame/diff/log
→ assert AgentTrace result
```

## CLI Snapshot Tests

Use sparingly for stable commands:

```text
doctor
sessions
show
```

Avoid snapshotting every character of large diffs.

---

# 14. README Strategy

The README is part of the product.

## First Screen

```text
# AgentTrace

Understand every line your AI coding agent changed.

Git tells you what changed.
AgentTrace tells you why.
```

Then immediately show:

```bash
agenttrace why src/auth.ts:82
```

and its output.

## Badges / Claims

Only include claims that are true:

```text
Local-first
No telemetry
No API key
Claude Code
Codex
```

Do not advertise unsupported agents just to make the README look larger.

## Recommended README Order

1. Hero sentence
2. GIF/demo
3. `agenttrace why`
4. Install
5. Commands
6. Supported agents
7. How it works
8. Privacy
9. Roadmap
10. Contributing

---

# 15. GitHub Star Strategy

Stars should be treated as distribution, not architecture.

The product needs three things before promotion:

## A. Instant Understanding

A visitor should understand AgentTrace within 5–10 seconds.

Best hook:

> **`git blame` for AI coding agents**

Secondary hook:

> Git tells you what changed. AgentTrace tells you why.

## B. Strong Demo

The ideal README GIF:

```bash
agenttrace why src/auth.ts:47
```

→ agent
→ prompt
→ timeline
→ failed test
→ successful fix

## C. Zero-Friction Install

Goal:

```bash
npx agenttrace
```

or

```bash
npm install -g agenttrace
```

No API key.
No database setup.
No account.

---

# 16. Risks

## Risk 1 — Agent session formats change

Mitigation:

- adapter isolation
- Zod parsing
- tolerant unknown fields
- fixture tests

## Risk 2 — Attribution is imperfect

Mitigation:

- evidence-based results
- confidence level
- never claim certainty without evidence

## Risk 3 — Privacy

Agent sessions may contain sensitive prompts or code.

Rules:

- local-first by default
- no telemetry by default
- no automatic upload
- report stays local
- redact command for sharing can come later

## Risk 4 — Scope creep

Do not turn v0.1 into:

- full observability platform
- SaaS
- IDE
- team analytics
- token billing platform

The wedge is:

```text
Why did this AI-generated code change?
```

---

# 17. Post-MVP Roadmap

Prioritize only after usage proves demand.

## Good Candidates

### `agenttrace report`

Interactive local HTML session report.

### VS Code extension

Hover a line:

```text
Changed by Claude Code
Session: 8d7fa
Prompt: Fix refresh token
```

### Git hooks

Attach AgentTrace metadata to commits.

### Commit trailers

Example:

```text
Agent: Claude Code
Agent-Session: 8d7fa921
```

### Shareable sanitized reports

```bash
agenttrace report --redact
```

### Adapter SDK

Let contributors add new agents without editing core code.

### CI mode

Detect AI-modified files in pull requests.

---

# 18. Features to Avoid Until There Is Demand

Do not build these early:

- LLM-generated session summaries
- token cost dashboard
- team leaderboard
- agent quality scoring
- cloud sync
- authentication
- organization accounts
- GitHub App
- VS Code extension before CLI works
- browser dashboard before provenance works

They make the project larger without strengthening its unique value.

---

# 19. Suggested Release Sequence

```text
v0.1
Claude session explorer
        ↓
v0.2
Git correlation
        ↓
v0.3
agenttrace why        ← CORE RELEASE
        ↓
v0.4
Codex / multi-agent
        ↓
v0.5
HTML report
        ↓
v0.6
Contribution / adapters / distribution
        ↓
v1.0
Stable provenance model + mature adapter API
```

---

# 20. Definition of MVP Complete

The MVP is complete when this flow works reliably:

```bash
cd my-project

agenttrace doctor
agenttrace sessions
agenttrace show <id>
agenttrace diff <id>
agenttrace why src/auth/token.ts:47
```

And AgentTrace can answer:

```text
Who changed this?
Which agent?
Which session?
What was the task/prompt?
What happened around the change?
What evidence supports the attribution?
How confident are we?
```

Everything beyond that is post-MVP.

---

# 21. Recommended First Development Sprint

Build in this exact order:

```text
1. Bootstrap TypeScript CLI
2. Define normalized types
3. Git repository detection
4. Claude session detection
5. Claude session parser
6. agenttrace doctor
7. agenttrace sessions
8. agenttrace show
9. Fixture tests
10. Publish v0.1.0
```

Do **not** start `agenttrace why` before session parsing and Git primitives are reliable.

Second sprint:

```text
1. Session ↔ file correlation
2. Git diff correlation
3. Confidence scoring
4. agenttrace diff
5. provenance candidate search
6. agenttrace why
7. Integration tests
8. README GIF
9. Publish v0.3.0
```

---

# 22. Final Project Principles

1. **Local-first.**
2. **No API key required.**
3. **Evidence over guesses.**
4. **Agent-agnostic core.**
5. **CLI before dashboard.**
6. **One excellent command beats ten mediocre commands.**
7. **`agenttrace why` is the product.**
8. **Session parsing is infrastructure, not the selling point.**
9. **Keep installation close to one command.**
10. **Make the README demo impossible to misunderstand.**

