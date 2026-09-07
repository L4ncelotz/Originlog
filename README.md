# AgentTrace

> `git blame` for AI coding agents.
>
> Git tells you **what** changed. AgentTrace tells you **why**.

AgentTrace is a local-first CLI that reads coding-agent session data, correlates it with Git activity, and explains which agent changed a file or line, what task caused the change, and what happened during the session.

## Status

**Planning / pre-implementation.**

The first supported agent is planned to be **Claude Code**, followed by **Codex** once the adapter boundary has been validated.

## Core Experience

```bash
agenttrace doctor
agenttrace sessions
agenttrace show <session-id>
agenttrace diff <session-id>
agenttrace why src/auth/token.ts:47
```

Example:

```text
$ agenttrace why src/auth/token.ts:47

Changed by
Claude Code

Session
8d7fa921

Prompt
"Fix authentication refresh token"

Evidence
- Agent edited src/auth/token.ts
- Edit range overlaps line 47
- npm test failed after the first edit
- Agent edited the same region again
- npm test passed

Confidence
High
```

## Product Principles

- **Local-first** — no account or cloud backend required.
- **Evidence over guesses** — provenance is reported with confidence and supporting evidence.
- **Agent-agnostic core** — Claude, Codex, OpenCode, and future agents plug in through adapters.
- **CLI-first** — fast to build, automate, script, and distribute.
- **Rebuildable state** — SQLite is only an index/cache; agent session files and Git remain the source of truth.

## MVP Scope

### v0.1

- Detect a Git repository.
- Detect Claude Code local session data.
- Normalize sessions into a common model.
- List sessions for the current repository.
- Show a session timeline.

### v0.2

- Correlate sessions with files and Git diffs.
- Track evidence and confidence.
- Add `agenttrace diff`.

### v0.3

- Add `agenttrace why <file>:<line>`.
- Return the most likely agent session, prompt, evidence, and confidence.

## Planned Stack

- TypeScript
- Node.js 20+
- Commander
- Zod
- better-sqlite3
- execa + native Git
- Vitest
- tsup

See [docs/02-TECH-STACK.md](docs/02-TECH-STACK.md) for decisions and tradeoffs.

## Architecture

```text
Agent session files
       |
       v
Agent adapters
 detect / parse / normalize
       |
       v
Normalized sessions + events
       |
  +----+-----+
  |          |
  v          v
SQLite     Git analyzer
  |          |
  +----+-----+
       v
Correlation + provenance
       |
       v
CLI commands
```

See [docs/03-ARCHITECTURE.md](docs/03-ARCHITECTURE.md).

## Documentation

- [Product](docs/01-PRODUCT.md)
- [Tech Stack](docs/02-TECH-STACK.md)
- [Architecture](docs/03-ARCHITECTURE.md)
- [Data Model](docs/04-DATA-MODEL.md)
- [Implementation](docs/05-IMPLEMENTATION.md)
- [Phase Plan](docs/06-PHASE-PLAN.md)
- [Testing](docs/07-TESTING.md)
- [Roadmap](docs/08-ROADMAP.md)
- [Contributing](CONTRIBUTING.md)
- [Master Project Plan](AGENTTRACE_PROJECT_PLAN.md)

## Non-Goals for MVP

AgentTrace will **not** initially include:

- hosted SaaS dashboard
- accounts/authentication
- team synchronization
- paid LLM summaries
- IDE extensions
- support for every coding agent
- perfect line attribution claims

## License

Choose an open-source license before the first public release. MIT or Apache-2.0 are both suitable defaults; this decision is intentionally left open until repository setup.
