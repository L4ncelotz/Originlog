# 06 — Phase Plan

## 1. Purpose

This file defines **release phases, scope boundaries, and exit criteria**.

It is intentionally different from `05-IMPLEMENTATION.md`:

- `IMPLEMENTATION` = engineering task order
- `PHASE-PLAN` = what must be complete before each release milestone

## 2. Phase Overview

| Phase | Target | Theme | Public? |
|---|---|---|---|
| 0 | `v0.0.x` | Foundation | optional |
| 1 | `v0.1.0` | Session Explorer | yes |
| 2 | `v0.2.0` | Git Correlation | yes |
| 3 | `v0.3.0` | Provenance / `why` | major launch candidate |
| 4 | `v0.4.0` | Multi-Agent | yes |
| 5 | `v0.5.0` | Visual Report | yes |
| 6 | `v0.6.x` | OSS Growth | yes |
| 7 | `v0.7+` | Integrations | selective |
| 8 | `v1.0.0` | Stable Core | yes |

---

# Phase 0 — Foundation

## Goal

Create a repository that is safe to iterate on.

## Deliverables

- TypeScript/Node project
- CLI entrypoint
- lint/format/typecheck
- Vitest
- Git wrapper foundation
- core normalized types
- CI
- docs committed

## Commands that must work

```bash
originlog --help
originlog --version
```

## Exit Criteria

- [ ] `npm run build` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] Git repository root detection is tested
- [ ] no agent-specific format exists outside adapters
- [ ] CI runs on pull requests

## Do Not Build Yet

- SQLite
- HTML UI
- Codex adapter
- `why`
- VS Code extension

---

# Phase 1 — Session Explorer

## Target

`v0.1.0`

## Goal

Make Originlog useful as a local viewer of Claude Code sessions.

## Features

```bash
originlog doctor
originlog sessions
originlog show <session-id>
```

## Supported Agent

- Claude Code only

## Deliverables

- Claude detector
- Claude parser
- sanitized fixtures
- repository/session matching
- timeline renderer
- readable diagnostics

## Exit Criteria

- [ ] `doctor` detects Git repository
- [ ] `doctor` detects Claude history when present
- [ ] `sessions` excludes clearly unrelated repositories
- [ ] `show` renders a deterministic event timeline
- [ ] unknown event records do not crash parsing
- [ ] all tests use fixtures, not personal logs
- [ ] package can be installed locally and run from another repository

## Release Message

At this stage the project can be described as:

> Inspect coding agent activity and touched files locally.

Do not yet oversell line-level provenance.

---

# Phase 2 — Git Correlation

## Target

`v0.2.0`

## Goal

Connect normalized agent activity to repository changes.

## Feature

```bash
originlog diff <session-id>
```

## Deliverables

- file-touch extraction
- Git diff parser
- session time-window correlation
- commit proximity evidence
- local SQLite index if needed for performance
- confidence/evidence primitives

## Exit Criteria

- [ ] known fixture edits map to the correct files
- [ ] Git diff statistics are correct
- [ ] timestamps are normalized consistently
- [ ] evidence objects are unit-tested
- [ ] correlation can return “insufficient evidence”
- [ ] cache can be deleted and rebuilt

## Quality Gate

Do not start line-level `why` if file-level correlation is unreliable.

---

# Phase 3 — Provenance

## Target

`v0.3.0`

## Goal

Deliver the product-defining feature.

## Feature

```bash
originlog why <file>:<line>
```

## Deliverables

- target parser
- Git blame integration
- candidate-session ranking
- exact/approximate line overlap
- human-readable evidence
- confidence classification
- alternative candidate handling

## Exit Criteria

- [ ] exact fixture edit is identified as strongest candidate
- [ ] nearby unrelated session is not ranked above exact edit
- [ ] timestamp-only evidence cannot produce confirmed or strong confidence
- [ ] output shows prompt/task where available
- [ ] output shows evidence
- [ ] output shows confidence
- [ ] no-match case is clear and non-fatal
- [ ] `--json` is available or planned immediately after release

## Public Launch Positioning

This is the first version that can confidently use:

> **Git tells you what changed. Originlog tells you where it came from and why.**

Tagline:

> **Know where a code change came from, and why.**

This is the best point for a polished public launch, demo GIF, and social distribution.

---

# Phase 4 — Multi-Agent

## Target

`v0.4.0`

## Goal

Prove that Originlog is not a Claude-specific viewer.

## Add

- Codex adapter
- adapter registry polish
- mixed-agent session output
- adapter-specific diagnostics

## Exit Criteria

- [ ] Claude and Codex use the same normalized core
- [ ] core correlation contains no Codex/Claude conditionals
- [ ] same CLI commands work for both
- [ ] fixtures exist for both
- [ ] adapter failure does not break other adapters

## Architectural Gate

If the second adapter forces repeated exceptions in core code, stop and redesign the adapter boundary before adding a third agent.

---

# Phase 5 — Visual Report

## Target

`v0.5.0`

## Goal

Make sessions easy to share, understand, and demo visually.

## Feature

```bash
originlog report <session-id>
```

## Output

```text
originlog-report.html
```

## Include

- prompt/task
- timeline
- file changes
- diff summary
- command/test events
- retries
- provenance evidence

## Exit Criteria

- [ ] report works offline
- [ ] report is portable
- [ ] sensitive-data warning is clear
- [ ] no server is required to view it
- [ ] README contains a strong screenshot/GIF

---

# Phase 6 — OSS Growth

## Target

`v0.6.x`

## Goal

Reduce friction for users and contributors.

## Deliverables

- npm package polished
- `npx originlog` flow
- demo repository
- issue templates
- PR template
- adapter contribution guide
- `good first issue` labels
- release automation
- changelog/release notes discipline

## Exit Criteria

- [ ] fresh-machine install instructions work
- [ ] README explains value within the first screen
- [ ] contribution path is clear
- [ ] one external contributor can add/fix an adapter without understanding all internals

---

# Phase 7 — Integrations

## Target

`v0.7+`

## Possible Features

Only build based on real demand:

- OpenCode adapter
- Cursor adapter if local history is technically suitable
- VS Code extension
- CI provenance report
- machine-readable export
- repository-level activity summaries

## Rule

Do not add integrations simply to increase the logo count in README.

---

# Phase 8 — v1.0

## Goal

Declare the core data and CLI model stable enough for downstream tooling.

## v1.0 Requirements

- [ ] at least 2 mature agent adapters
- [ ] stable normalized data model
- [ ] stable JSON output for key commands
- [ ] migration/reset policy documented
- [ ] provenance limitations documented
- [ ] privacy model documented
- [ ] test matrix covers Windows/macOS/Linux where practical
- [ ] no known critical data-loss/privacy issues
- [ ] CLI command names are unlikely to change

## Not Required for v1.0

- cloud service
- team accounts
- enterprise dashboard
- every coding agent
- perfect attribution

---

# Scope Control Rules

Before accepting a feature into the current phase, ask:

1. Does it directly improve the phase goal?
2. Is it required to validate the product thesis?
3. Can it wait without blocking users?
4. Does it introduce a new platform, UI framework, backend, or service?

If it is useful but not phase-critical, move it to `08-ROADMAP.md`.
