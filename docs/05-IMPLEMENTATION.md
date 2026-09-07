# 05 — Implementation Plan

## 1. Goal

This file defines the **engineering build order**.

Follow it sequentially unless a blocker makes a later step necessary. Do not implement roadmap features while MVP foundations are incomplete.

## 2. Step 0 — Bootstrap Repository

Create:

```text
package.json
tsconfig.json
eslint.config.*
.prettierrc
.gitignore
src/cli/index.ts
tests/
.github/workflows/ci.yml
```

Install the minimum dependencies:

```text
commander
zod
execa
picocolors
vitest
tsup
typescript
eslint
prettier
```

`better-sqlite3` may wait until indexing begins.

### Required scripts

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

### Definition of done

```bash
node dist/cli.js --help
```

works and CI is green.

---

## 3. Step 1 — Core Normalized Types

Implement:

```text
src/adapters/types.ts
src/core/events.ts
src/core/sessions.ts
```

Add types for:

- session
- session summary
- event
- line range
- file touch
- evidence
- provenance result

### Tests

- event sorting
- path normalization
- missing optional values

### Exit condition

No real agent format is referenced outside `src/adapters`.

---

## 4. Step 2 — Git Repository Layer

Implement:

```text
src/git/repository.ts
src/git/status.ts
src/git/diff.ts
src/git/log.ts
src/git/blame.ts
```

Functions:

```ts
isGitRepository(cwd)
getRepoRoot(cwd)
getStatus(repoRoot)
getDiff(repoRoot, options)
getLog(repoRoot, options)
getBlame(repoRoot, file, line)
```

### Important

Use `execa("git", [...args])`.

Do not build shell command strings from user input.

### Tests

Create temporary repositories programmatically and assert:

- root detection
- modified files
- additions/deletions
- commit parsing
- single-line blame

### Exit condition

Git layer works independently from any agent data.

---

## 5. Step 3 — Claude Code Discovery

Implement:

```text
src/adapters/claude/detector.ts
src/adapters/claude/schemas.ts
```

Responsibilities:

- locate candidate Claude Code session/history directories
- report whether data exists
- count/read candidate files safely
- return diagnostics for permission/format issues

### Critical rule

Do not hard-code assumptions in multiple files. Centralize source path rules in the Claude adapter.

### Exit condition

`detect()` works without parsing a full session.

---

## 6. Step 4 — Claude Code Parser

Implement:

```text
src/adapters/claude/parser.ts
src/adapters/claude/adapter.ts
```

Normalize at least:

- session id
- timestamps
- user prompt/task
- file reads
- file writes/edits
- shell commands
- command results
- errors/test results where available

### Parser behavior

- tolerate unknown records
- preserve chronological order
- normalize paths
- report warnings instead of crashing on non-critical records

### Fixtures

Create sanitized fixtures under:

```text
tests/fixtures/claude/
```

Never commit real private session histories.

### Exit condition

A fixture produces a deterministic normalized session.

---

## 7. Step 5 — Adapter Registry

Implement:

```text
src/adapters/registry.ts
```

Initial API:

```ts
getAdapters(): AgentAdapter[]
detectAgents(context): Promise<DetectedAgent[]>
findAdapter(id): AgentAdapter | undefined
```

Only Claude may exist initially, but the registry establishes the multi-agent boundary.

---

## 8. Step 6 — `doctor`

Implement:

```text
src/cli/commands/doctor.ts
```

Output should cover:

- Git installation/repository state
- repository root
- detected agents
- source path issues
- session counts

Example:

```text
AgentTrace Doctor

✓ Git repository detected
✓ Claude Code detected     14 sessions
- Codex not detected

Repository: /home/user/project
```

### Exit condition

A new user can determine whether AgentTrace can see their environment.

---

## 9. Step 7 — Repository Session Matching

Implement pure logic before command rendering.

```text
src/core/sessions.ts
```

Matching evidence order:

1. exact project path
2. repository root
3. working directory under repo
4. referenced repository files

Return:

```ts
interface SessionMatch {
  session: NormalizedSessionSummary;
  confidence: "low" | "medium" | "high";
  reasons: string[];
}
```

### Tests

Include:

- exact match
- nested directory
- unrelated repository
- missing project metadata

---

## 10. Step 8 — `sessions`

Implement:

```text
src/cli/commands/sessions.ts
```

Minimum output:

```text
ID       Agent         Started       Files
8d7fa9   Claude Code   10:42         4
```

Options:

```text
--all
--agent <id>
--json
```

Do not build interactive selection yet.

---

## 11. Step 9 — Timeline Renderer + `show`

Implement:

```text
src/ui/timeline.ts
src/cli/commands/show.ts
```

Map normalized events to stable labels:

```text
READ
EDIT
RUN
PASS
FAIL
PROMPT
```

Unknown events should be optionally visible with `--verbose`, not dominate default output.

### Exit condition

A real session can be understood without opening raw history files.

---

## 12. Step 10 — Local Index

Add:

```text
better-sqlite3
src/storage/database.ts
src/storage/migrations.ts
```

Index:

- sessions
- events
- touched files
- source scan fingerprints

### Requirements

- cache can be rebuilt
- schema version exists
- no destructive writes to source histories

Potential internal command during development:

```bash
agenttrace index --rebuild
```

It does not need to be public in early releases.

---

## 13. Step 11 — Session/File Correlation

Implement:

```text
src/core/correlation.ts
```

Input:

```ts
correlateSessionChanges(session, gitContext)
```

Output:

- files touched by agent
- Git files changed
- overlapping evidence
- timestamps
- possible commit association

The function should not return a single boolean.

---

## 14. Step 12 — Confidence Scoring

Implement:

```text
src/core/confidence.ts
```

Start with explicit rules, not ML.

Example direction:

```text
+ strong: exact edit range overlap
+ strong: explicit write + blame commit association
+ medium: explicit write of target file
+ medium: close commit/session timing
+ weak: filename mentioned in command
```

Keep weights centralized and unit-tested.

---

## 15. Step 13 — `diff`

Implement:

```text
src/cli/commands/diff.ts
```

Default output:

```text
4 files changed · +83 -21

M src/auth/token.ts
M src/auth/session.ts
A tests/refresh-token.test.ts
M package.json
```

Options:

```text
--stat
--patch
--json
```

Avoid dumping huge patches by default.

---

## 16. Step 14 — Provenance Engine

Implement:

```text
src/core/provenance.ts
```

Pipeline:

```text
file:line
  ↓
normalize target
  ↓
Git blame/current diff
  ↓
find sessions touching file
  ↓
collect evidence
  ↓
score candidates
  ↓
rank
  ↓
confidence
```

Return alternatives when top candidates are very close.

---

## 17. Step 15 — `why`

Implement:

```text
src/cli/commands/why.ts
```

Required output:

- target
- best candidate agent
- session id
- prompt/task
- evidence
- confidence

Example:

```text
Likely changed by Claude Code
Session: 8d7fa921
Confidence: High

Prompt
"Fix authentication refresh token"

Evidence
- Agent edited src/auth/token.ts
- Edit overlaps line 47
- Tests failed, then the same region was edited again
```

### Critical behavior

If provenance is weak, say so.

---

## 18. Step 16 — JSON Output

Every main read command should eventually support:

```bash
--json
```

This enables:

- editor integrations
- scripts
- future UI
- CI

Define stable JSON structures only after CLI models stop changing rapidly.

---

## 19. Step 17 — Second Adapter: Codex

Only begin after Claude works end-to-end.

Purpose is architectural validation, not feature count.

If implementing Codex requires changes inside core code specifically for Codex, revisit the adapter contract.

---

## 20. Step 18 — HTML Report

Implement only after `why` works.

Command:

```bash
agenttrace report <session-id>
```

Output:

```text
agenttrace-report.html
```

Include:

- task/prompt
- event timeline
- touched files
- diff summary
- retries/failures
- provenance evidence

Prefer a self-contained file.

---

## 21. Release Checklist

Before each release:

```text
[ ] typecheck passes
[ ] lint passes
[ ] unit tests pass
[ ] integration tests pass
[ ] fixture tests pass
[ ] build passes
[ ] npm package can be packed
[ ] README commands match actual CLI
[ ] no private fixture data exists
[ ] changelog/release notes prepared
```

## 22. Stop Conditions

Do not proceed to richer features if any are true:

- parser crashes on common unknown records
- `sessions` includes unrelated projects regularly
- `why` claims high confidence from timestamp-only evidence
- tests depend on the developer's machine
- adapters leak vendor-specific structures into core

Fix correctness first.
