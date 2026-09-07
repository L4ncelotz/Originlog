# 07 — Testing Strategy

## 1. Testing Goals

AgentTrace deals with unreliable external session formats and ambiguous provenance. Tests must protect two things above all:

1. **Normalization correctness**
2. **Attribution honesty**

A wrong confident answer is worse than returning “unknown.”

## 2. Test Layers

```text
Unit tests
   ↓
Fixture/parser tests
   ↓
Git integration tests
   ↓
Correlation/provenance tests
   ↓
CLI smoke tests
```

---

# 3. Unit Tests

Test pure functions heavily.

## Required Areas

### Path normalization

Cases:

- POSIX absolute path
- Windows absolute path
- repo-relative path
- nested working directory
- path with spaces
- file outside repository

### Event ordering

- already ordered
- out-of-order timestamps
- equal timestamps
- missing optional event fields

### Project/session matching

- exact repo root
- nested cwd
- unrelated repo
- missing project path
- only file-based evidence

### Confidence scoring

- exact line overlap
- file-only edit
- timestamp-only
- blame/commit match
- conflicting candidates

### CLI input parsing

Examples:

```text
src/auth.ts:47
src/foo:bar.ts:12
C:\repo\src\auth.ts:47
```

The target parser must handle platform-specific paths correctly.

---

# 4. Agent Fixture Tests

Fixtures are the core defense against upstream format changes.

Structure:

```text
tests/fixtures/
├── claude/
│   ├── basic-edit/
│   │   ├── input.jsonl
│   │   └── expected.json
│   ├── failed-test-retry/
│   ├── unknown-record/
│   └── multi-file/
└── codex/
    └── ...
```

Each fixture should specify:

- raw sanitized input
- expected normalized session
- expected files touched
- expected key events
- expected warnings if any

## Fixture Rules

- never commit private real prompts without sanitizing
- never include credentials/tokens
- use synthetic repository names
- keep fixtures small enough to understand manually
- preserve tricky upstream records that caused bugs

When a real-world parser bug is fixed, add a regression fixture.

---

# 5. Git Integration Tests

Create temporary Git repositories during tests.

Example scenario:

```text
1. git init
2. create src/auth.ts
3. commit initial version
4. modify lines 20–30
5. commit fix
6. query diff/log/blame
7. assert parsed model
```

Test:

- repository root
- dirty working tree
- staged changes
- unstaged changes
- added file
- deleted file
- rename
- commit log parsing
- blame on a known line

Use actual Git rather than mocking the Git CLI for integration coverage.

---

# 6. Provenance Test Matrix

This is the most important suite.

## Case A — Exact edit overlap

Agent session explicitly edits lines 40–50.
Target: line 47.

Expected:

```text
candidate = same session
confidence = high
```

## Case B — Same file, wrong range

Session edits lines 10–20.
Target: line 80.

Expected:

- session may remain a candidate
- exact-line evidence must be absent
- confidence should be lower

## Case C — Timestamp only

Session happened near the commit but does not reference the target file.

Expected:

```text
confidence != high
```

## Case D — Two agents touch same file

Claude edits one region, Codex edits another.

Expected:

- target line chooses the overlapping session
- alternative may be shown if evidence is close

## Case E — Human edit after agent

Agent edits line 47, then human changes it manually before commit.

Expected:

- AgentTrace must avoid claiming current line was definitely authored by the agent
- confidence should fall unless stronger commit/session evidence exists

## Case F — No usable evidence

Expected:

```text
No reliable agent provenance found.
```

---

# 7. CLI Tests

Prefer testing command handlers as functions rather than spawning a process for every test.

Use process-level smoke tests for:

```text
agenttrace --help
agenttrace doctor
agenttrace sessions --json
```

## Snapshot Testing

Use snapshots only for stable compact output.

Good:

- help text
- table headers
- small timeline

Avoid snapshotting:

- huge diffs
- absolute temp paths
- timestamps that change every run

---

# 8. Database Tests

When SQLite is added:

Test:

- initial migration
- repeated migration is safe
- insert/update session
- rebuild cache
- delete database and rescan
- duplicate source scan does not duplicate rows

Use temporary database files.

---

# 9. Cross-Platform Testing

At minimum, GitHub Actions should eventually cover:

```text
ubuntu-latest
windows-latest
macos-latest
```

Early MVP may start with Ubuntu plus one additional OS, but path handling must not be designed as Linux-only.

Particularly test:

- path separators
- home directory discovery
- filenames with spaces
- Windows drive letters

---

# 10. Performance Tests

Do not benchmark too early.

Add lightweight benchmarks when real session histories become large.

Measure:

- cold scan time
- warm indexed `sessions`
- `why` candidate search
- memory use on large logs

Potential synthetic data sizes:

```text
100 sessions
1,000 sessions
10,000 sessions
```

Only optimize after identifying actual bottlenecks.

---

# 11. Security/Privacy Tests

Check that:

- debug mode is opt-in
- normal output does not print environment dumps
- reports do not silently upload data
- test fixtures contain no secrets
- shell execution uses argument arrays
- malicious filenames are handled safely

Example filenames to test:

```text
file with spaces.ts
$(echo bad).ts
--weird-option.ts
semi;colon.ts
```

The Git/process layer must treat them as data, not shell syntax.

---

# 12. Release Acceptance Checklist

Before release:

```text
[ ] all unit tests pass
[ ] all fixture tests pass
[ ] Git integration tests pass
[ ] provenance ambiguity tests pass
[ ] CLI smoke tests pass
[ ] typecheck passes
[ ] lint passes
[ ] build passes
[ ] package install smoke test passes
[ ] no fixture contains private data
```

## Special Gate for `v0.3.0`

Before shipping `agenttrace why`, manually verify at least these three scenarios:

1. obvious exact agent edit
2. ambiguous multi-session edit
3. no reliable provenance

The output must look trustworthy in all three, not only the happy path.
