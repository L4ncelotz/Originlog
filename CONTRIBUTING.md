# Contributing to Originlog

Thanks for considering a contribution.

Originlog is designed around one rule:

> Agent-specific formats belong in adapters; provenance logic belongs in the shared core.

Keeping that boundary clean is more important than adding support quickly.

## Development Setup

Prerequisites:

- Node.js 20+
- pnpm
- Git

Install:

```bash
git clone <repository-url>
cd originlog
pnpm install
```

Run checks:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Run CLI during development:

```bash
pnpm dev -- --help
```

## Project Structure

```text
src/
├── adapters/    # agent-specific detection/parsing
├── core/        # normalized logic + provenance
├── git/         # Git facts only
├── storage/     # rebuildable local index
├── cli/         # command handlers
└── ui/          # text/report rendering
```

Read these before substantial changes:

- `docs/03-ARCHITECTURE.md`
- `docs/04-DATA-MODEL.md`
- `docs/05-IMPLEMENTATION.md`
- `docs/07-TESTING.md`
- `docs/09-Git-Workflow.md`

## Contribution Types

Good contributions include:

- parser bug fixes
- sanitized regression fixtures
- Git edge-case fixes
- provenance accuracy improvements
- clearer diagnostics
- documentation
- new adapters after the adapter contract is stable

## Adding or Updating an Adapter

Agent-specific code must live under:

```text
src/adapters/<agent>/
```

Typical structure:

```text
src/adapters/example/
├── adapter.ts
├── detector.ts
├── parser.ts
└── schemas.ts
```

The adapter must return normalized core models.

Do not add checks such as:

```ts
if (agent === "example") {
  // special parsing
}
```

inside `src/core`, `src/git`, or shared UI code.

## Fixture Requirement

Every parser behavior change should include a sanitized fixture when practical.

Never submit:

- personal prompts
- API keys
- tokens
- private repository code
- company source code
- unredacted local paths that identify a person or organization

Synthetic fixtures are preferred.

## Provenance Changes

Changes to scoring/correlation require tests for:

1. positive case
2. ambiguous case
3. negative/no-evidence case

A provenance improvement must not simply increase confidence everywhere.

High confidence requires strong evidence.

## Pull Request Scope

Prefer focused pull requests.

Good:

```text
fix(claude): tolerate missing tool result timestamps
```

Avoid combining:

- parser refactor
- new agent
- CLI redesign
- database migration

in one PR unless they are inseparable.

## Commit Style

Recommended Conventional Commit prefixes:

```text
feat:
fix:
docs:
test:
refactor:
chore:
```

Examples:

```text
feat(cli): add sessions command
fix(git): handle renamed files in diff parser
test(claude): add retry-session fixture
docs: clarify provenance confidence model
```

## Code Style

- keep functions small where it improves readability
- prefer explicit types at module boundaries
- avoid premature abstractions
- do not add dependencies without a clear benefit
- use native Git commands through safe argument arrays
- do not silently swallow parser errors; convert recoverable ones to diagnostics

## Tests

Before opening a PR:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

If your change affects parsing or provenance, include regression coverage.

## Privacy and Security

Originlog handles potentially sensitive local development history.

Contributions must preserve these defaults:

- local-first
- no telemetry
- no automatic upload
- no remote API requirement for core features
- no secret/session dumping in normal logs

If a feature sends data over the network, it requires explicit design discussion before implementation.

## Feature Requests

Before implementing a large feature, check `docs/08-ROADMAP.md` and open an issue describing:

- user problem
- proposed behavior
- why it belongs in Originlog
- privacy implications
- architecture impact

Large features may be useful but still be out of scope for the current phase.

## Definition of Done

A contribution is ready when:

```text
[ ] behavior is implemented
[ ] tests cover important paths
[ ] typecheck/lint/tests/build pass
[ ] docs are updated if public behavior changed
[ ] no sensitive fixture data is included
[ ] architecture boundaries remain intact
```
