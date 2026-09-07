# 02 — Tech Stack

## 1. Decision Summary

| Layer | Choice | Status |
|---|---|---|
| Runtime | Node.js 20+ | Required |
| Language | TypeScript 5.x | Required |
| Package manager | pnpm | Recommended |
| CLI | Commander | Required |
| Validation | Zod | Required |
| Process execution | execa | Required |
| Git | native `git` through execa | Required |
| Database | better-sqlite3 | Phase 2+ |
| Terminal colors | picocolors | Recommended |
| Tables | cli-table3 or small custom renderer | Optional |
| Testing | Vitest | Required |
| Build | tsup | Required |
| Lint | ESLint | Required |
| Format | Prettier | Required |
| CI | GitHub Actions | Required before public release |

## 2. Why TypeScript + Node.js

AgentTrace is primarily a filesystem, process, parsing, indexing, and CLI project.

TypeScript is a strong fit because:

- coding-agent histories are usually JSON/JSONL/text heavy
- adapters benefit from explicit normalized types
- npm distribution makes `npx agenttrace` practical
- Node has mature filesystem/process libraries
- development speed is more valuable than low-level optimization for MVP

### Constraint

Keep the code compatible with **Node.js 20+** unless a dependency forces a newer baseline.

## 3. Package Manager

### Recommended: pnpm

Reasons:

- fast installs
- strict dependency resolution
- common in modern TypeScript OSS projects

The project should still publish a normal npm package so users can run:

```bash
npx agenttrace
```

## 4. CLI — Commander

Use Commander for:

- command registration
- options
- help output
- argument parsing

Example:

```ts
program
  .command("why")
  .argument("<location>", "file:line")
  .option("--json", "emit machine-readable JSON")
  .action(runWhyCommand);
```

Avoid building a custom CLI parser.

## 5. Validation — Zod

Raw agent session formats are external inputs and may change.

Zod belongs only at boundaries where data enters the normalized model.

Use it for:

- raw session records
- configuration
- cached database payloads where needed

Do not use Zod as a substitute for normal TypeScript types everywhere.

## 6. Git Integration — Native Git + execa

Prefer Git itself over a large Git abstraction library.

Commands needed:

```text
git rev-parse --show-toplevel
git status --porcelain=v1
git diff
git diff --numstat
git log
git blame --line-porcelain
```

Benefits:

- predictable behavior
- easier debugging
- no abstraction mismatch
- users already need Git installed

### Rule

All process arguments must be passed as argument arrays. Never interpolate untrusted file paths into shell strings.

## 7. Storage — SQLite

Use `better-sqlite3` when indexing becomes useful.

SQLite stores derived data only:

- normalized sessions
- normalized events
- file touches
- scan state
- correlation cache

It is **not the source of truth**.

Deleting the database must not destroy user history.

Suggested location:

```text
~/.agenttrace/agenttrace.db
```

## 8. Build — tsup

Target output:

```text
dist/
├── cli.js
└── index.js
```

The package should expose:

- CLI executable
- optional programmatic API later

Avoid adding a monorepo until there is a real second package.

## 9. Testing — Vitest

Use Vitest for:

- unit tests
- fixture tests
- Git integration tests
- command handler tests

Tests must not depend on the developer's real `~/.claude` or other private history.

## 10. Terminal UI

### MVP

Use simple text output with:

- picocolors
- small table renderer or cli-table3

### Do not use Ink initially

Ink becomes useful only if the product needs:

- keyboard navigation
- persistent terminal layout
- interactive filtering

For MVP, it increases complexity without improving the core thesis.

## 11. HTML Report Stack

Deferred until the CLI provenance flow works.

Preferred options:

### Simple report

- template literal / minimal HTML generator
- inline CSS
- inline JSON data

### Rich report later

- Vite
- React only if interaction justifies it

Goal:

```text
agenttrace-report.html
```

Prefer a single portable file.

## 12. Dependencies to Avoid in MVP

Do not add these without a concrete requirement:

- Next.js
- Express
- Hono
- React
- PostgreSQL
- Redis
- Prisma
- Supabase
- Docker
- authentication libraries
- hosted analytics SDKs
- LLM SDKs

## 13. Security/Privacy Constraints

Agent session data can contain:

- prompts
- source code
- command output
- file paths
- environment details
- secrets accidentally printed by tools

Therefore:

- no telemetry by default
- no remote upload in MVP
- reports should warn users before sharing
- tests and fixtures must be sanitized
- debug logs must avoid dumping entire sessions unless explicitly requested

## 14. Proposed `package.json` Scripts

```json
{
  "scripts": {
    "build": "tsup",
    "dev": "tsx src/cli/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "format": "prettier --write .",
    "typecheck": "tsc --noEmit"
  }
}
```

`tsx` is optional for development convenience.

## 15. Decision Rule for New Dependencies

Before adding a dependency, answer:

1. Does the platform already provide this capability?
2. Is the dependency materially simpler than ~50 lines of maintainable code?
3. Is it actively maintained?
4. Does it add native/build complexity?
5. Does it affect CLI startup time?

Prefer a small dependency surface. AgentTrace should feel like a focused developer utility, not a framework showcase.
