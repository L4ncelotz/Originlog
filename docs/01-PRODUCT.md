# 01 — Product Definition

## 1. Product Statement

Originlog is a **local-first code provenance tool**.

It answers four questions:

1. **Where did this code change come from, and why?**
2. **What prompt or task caused the change?**
3. **What happened before and after the edit?**
4. **How confident are we that this session caused the current code state?**

The primary positioning is:

> **Know where a code change came from, and why.**

Secondary positioning:

> **Git tells you what changed. Originlog tells you where it came from and why.**

The product should feel credible even if all references to AI are removed. AI coding agents are data sources, not the product identity.

## 2. Problem

Developers increasingly let coding agents read, edit, test, and refactor large portions of a repository. Git preserves the final code history, but it usually does not preserve the full operational context and intent that led to the change.

After several sessions, common questions become difficult to answer:

- Where did this change originate?
- Was this code generated during a bug fix or refactor?
- What was the original prompt or intent?
- Did tests fail and cause a retry?
- Was the edit made by an agent or by a human afterward?
- Can the attribution and provenance be trusted?

The raw information may exist in local agent logs, shell output, session metadata, and Git history, but it is fragmented across different tools and formats.

Originlog correlates those sources into one coherent local view.

## 3. Target Users

### Primary

Developers who regularly use:

- Claude Code
- Codex
- OpenCode
- other terminal/IDE coding agents with local session history

### Secondary

- maintainers reviewing agent-assisted contributions
- developers returning to an old assisted branch
- teams evaluating coding-agent workflows
- tool authors building around code provenance

## 4. Jobs to Be Done

### JTBD-1 — Understand a suspicious line

```bash
originlog why src/auth.ts:47
```

Expected result:

```text
src/auth.ts:47

Origin
Claude Code · session 8d7fa

Intent
Fix JWT refresh race condition

Evidence
12:41  read   src/auth.ts
12:42  edit   src/auth.ts
12:42  run    npm test
12:42  fail   refresh-token.test.ts
12:43  edit   src/auth.ts
12:43  run    npm test
12:43  pass

Related commit
a83cb21
```

### JTBD-2 — Review what an agent did

```bash
originlog show 8d7fa921
```

Expected result:

- prompt / intent
- chronological timeline
- files read/edited
- commands executed
- failures/retries
- final status where inferable

### JTBD-3 — Find recent agent work in the repository

```bash
originlog sessions
```

Expected result:

- recent sessions
- agent name
- time
- touched files
- coarse status

### JTBD-4 — Diagnose installation or missing data

```bash
originlog doctor
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
- `why <target>` (`<file>`, `<file>:<line>`, `<file>:<range>`, `<commit>`)

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
- token-cost tracker
- productivity score system
- team management system
- prompt management system

## 6. Command Surface

```text
originlog
originlog sessions [--all] [--agent <id>]
originlog show <session-id> [--json]
originlog diff <session-id> [--stat] [--patch]
originlog why <target> [--json]
originlog doctor
```

Target variants for `originlog why`:

- `originlog why src/auth.ts`
- `originlog why src/auth.ts:47`
- `originlog why src/auth.ts:40-60`
- `originlog why <commit>`

Notes:
- Running `originlog` without subcommands displays help text.
- `originlog doctor` remains available for diagnostics, but is no longer the lead command.
- Do not expand the CLI until these core commands are coherent.

## 7. UX Requirements

### Output must be explainable

Bad:

```text
Claude changed this line.
```

Good:

```text
Origin: Claude Code · session 8d7fa921
Confidence: Confirmed

Evidence:
- Session explicitly edited src/auth.ts
- Edit range overlaps line 47
- Session occurred 3 minutes before commit a83cb21
```

### Unknown must remain unknown

If evidence is weak or absent:

```text
No reliable provenance found.
Confidence: Unknown
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
8. **The product should feel credible even if all references to AI are removed**

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
- percentage of users successfully completing `originlog doctor`

Stars are an adoption signal, not the only product metric.

## 10. MVP Acceptance Scenario

A developer runs an agent to fix an authentication bug. The agent edits two files, runs tests, fails once, edits again, and succeeds.

Later the developer runs:

```bash
originlog why src/auth.ts:47
```

Originlog must show:

- the correct session as the strongest candidate
- the original task/prompt where available
- the relevant edit/test sequence
- Git/session evidence
- an honest confidence rating (`confirmed`, `strong`, `possible`, or `unknown`)

If that works reliably, the product thesis is validated.
