# Originlog

[![codecov](https://codecov.io/gh/L4ncelotz/Originlog/graph/badge.svg)](https://codecov.io/gh/L4ncelotz/Originlog)

**Know where a code change came from, and why.**

```bash
originlog why src/auth.ts:47
```

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

## What It Does

Originlog reads local AI coding-agent session data, correlates it with Git history, and reconstructs the provenance of code changes. Given a file, line, or commit, it explains where a change came from and why.

## Status

Planning / pre-implementation. First supported agent: Claude Code.

## Commands

```bash
originlog                        # help / quick status
originlog sessions               # list recent sessions
originlog show <session>         # session timeline
originlog diff                   # files changed during session
originlog why src/auth.ts:47     # provenance for a line
originlog why <commit>           # provenance for a commit
```

## Principles

- **Local-first** — no account or cloud backend required.
- **Evidence over guesses** — provenance is reported with confidence and supporting evidence.
- **Agent-agnostic core** — adapters normalize session data from Claude Code and future agents into a unified model.
- **CLI-first** — fast to build, automate, script, and distribute.
- **Rebuildable state** — SQLite is only an index/cache; agent session files and Git remain the source of truth.

## Documentation

- [Product](docs/01-PRODUCT.md)
- [Tech Stack](docs/02-TECH-STACK.md)
- [Architecture](docs/03-ARCHITECTURE.md)
- [Data Model](docs/04-DATA-MODEL.md)
- [Implementation](docs/05-IMPLEMENTATION.md)
- [Phase Plan](docs/06-PHASE-PLAN.md)
- [Testing](docs/07-TESTING.md)
- [Roadmap](docs/08-ROADMAP.md)
- [Git Workflow](docs/09-Git-Workflow.md)
- [Contributing](CONTRIBUTING.md)

## License

An open-source license will be chosen before the first public release (MIT or Apache-2.0).
