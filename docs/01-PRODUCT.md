# 01 — Product Definition

## 1. Product Statement

AgentTrace is a **local-first provenance tool for AI-assisted coding**.

It answers four questions:

1. **Which agent changed this code?**
2. **What prompt/task caused the change?**
3. **What did the agent do before and after the edit?**
4. **How confident are we that this session caused the current line/file state?**

The primary positioning is:

> **Git tells you what changed. AgentTrace tells you why.**

Alternative short positioning:

> **`git blame` for AI coding agents.**

## 2. Problem

Developers increasingly let coding agents read, edit, test, and refactor large portions of a repository. Git preserves the final code history, but it usually does not preserve the full operational context that led to the change.

After several sessions, common questions become difficult to answer:

- Which agent touched this file?
- Was this code generated during a bug fix or refactor?
- What was the original prompt?
- Did tests fail and cause a retry?
- Was the edit made by the agent or by a human afterward?
- Can the attribution be trusted?

The raw information may exist in local agent logs, shell output, session metadata, and Git history, but it is fragmented.

AgentTrace combines those sources into one local view.

## 3. Target Users

### Primary

Developers who regularly use:

- Claude Code
- Codex
- OpenCode
- other terminal/IDE coding agents with local session history

### Secondary

- maintainers reviewing AI-heavy contributions
- developers returning to an old AI-assisted branch
- teams evaluating coding-agent workflows
- tool authors building around agent provenance

## 4. Jobs to Be Done

### JTBD-1 — Understand a suspicious line

```bash
agenttrace why src/auth/token.ts:47
```

Expected result:

- likely agent
- session id
- prompt/task
- related edits and commands
- Git evidence
- confidence

### JTBD-2 — Review what an agent did

```bash
agenttrace show 8d7fa921
```

Expected result:

- prompt
- chronological timeline
- files read/edited
- commands executed
- failures/retries
- final status where inferable

### JTBD-3 — Find recent AI work in the repository

```bash
agenttrace sessions
```

Expected result:

- recent sessions
- agent name
- time
- touched files
- coarse status

### JTBD-4 — Diagnose installation or missing data

```bash
agenttrace doctor
```

Expected result:

- repo detection
- supported agent detection
- session count
- permission/path problems
- useful next action

## 5. MVP Feature Set

### Required

- repository detection
- Claude Code adapter
- normalized session/event model
- session listing
- timeline rendering
- Git status/diff/log/blame wrapper
- file/session correlation
- confidence model
- `why <file>:<line>`

### Important but not required for first release

- persistent local index
- Codex adapter
- HTML report
- machine-readable JSON output

### Explicitly Deferred

- SaaS
- accounts
- team cloud sync
- hosted storage
- IDE extensions
- real-time session streaming
- LLM-generated explanations
- automatic code review
- enterprise policy enforcement

## 6. Command Surface

```text
agenttrace doctor
agenttrace sessions [--all] [--agent <id>]
agenttrace show <session-id> [--json]
agenttrace diff <session-id> [--stat] [--patch]
agenttrace why <file>:<line> [--json]
```

Do not expand the CLI until these commands are coherent.

## 7. UX Requirements

### Output must be explainable

Bad:

```text
Claude changed this line.
```

Good:

```text
Likely changed by Claude Code
Confidence: High

Evidence
- Session explicitly edited src/auth/token.ts
- Edit range overlaps line 47
- Session occurred 3 minutes before commit a83cb21
```

### Unknown must remain unknown

If evidence is weak:

```text
No reliable agent provenance found.
Confidence: Low
```

Never fabricate certainty to make output look impressive.

## 8. Product Principles

1. **Local-first by default**
2. **No API key required for core functionality**
3. **Source data remains authoritative**
4. **Evidence is visible to the user**
5. **Agent-specific formats stay behind adapters**
6. **Graceful parsing beats strict failure**
7. **Fast CLI workflow before rich UI**

## 9. Success Metrics

### Technical MVP

- Parse a real Claude Code session without manual conversion.
- Associate repository sessions correctly.
- Produce a readable timeline.
- Produce a `why` result with evidence and confidence.
- Rebuild local index from source data.

### Public Release

Useful metrics after launch:

- GitHub stars
- npm weekly downloads
- unique contributors
- new adapter pull requests
- issue-to-resolution ratio
- percentage of users successfully completing `agenttrace doctor`

Stars are an adoption signal, not the only product metric.

## 10. MVP Acceptance Scenario

A developer runs an agent to fix an authentication bug. The agent edits two files, runs tests, fails once, edits again, and succeeds.

Later the developer runs:

```bash
agenttrace why src/auth/token.ts:47
```

AgentTrace must show:

- the correct session as the strongest candidate
- the original task/prompt where available
- the relevant edit/test sequence
- Git/session evidence
- an honest confidence rating

If that works reliably, the product thesis is validated.
