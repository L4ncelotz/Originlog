# 08 — Roadmap

## 1. Roadmap Principle

The roadmap is **not a promise** and should not drive MVP scope.

Features move into implementation only when they satisfy at least one of:

- repeated user demand
- clear technical dependency
- strong contribution opportunity
- major improvement to provenance accuracy

---

# Near-Term

## 1. Codex Adapter

Priority: **High**

Reason:

The second adapter validates that the normalized model is genuinely agent-independent.

Success condition:

- no Codex-specific branches in core provenance logic

---

## 2. JSON Output

Priority: **High**

Examples:

```bash
originlog sessions --json
originlog show <id> --json
originlog why src/auth.ts:47 --json
```

Benefits:

- editor integrations
- scripts
- CI
- third-party tooling

Stable JSON should be treated more carefully than terminal formatting.

---

## 3. HTML Session Report

Priority: **High after v0.3**

Command:

```bash
originlog report <session-id>
```

Goal:

A portable single-file report suitable for:

- debugging
- review
- issue attachment
- demo/README

---

## 4. Better Correlation Evidence

Priority: **High**

Potential evidence:

- file content hashes before/after tool calls
- commit message proximity
- exact patch/hunk reconstruction
- tool event IDs
- known agent-generated commit metadata

Every new signal should improve confidence without hiding uncertainty.

---

# Medium-Term

## 5. OpenCode Adapter

Priority: **Medium**

Add only after the adapter model is stable with two agents.

---

## 6. Repository Activity View

Possible command:

```bash
originlog activity
```

Example:

```text
Last 7 days

Claude Code   18 sessions   42 files
Codex          6 sessions   17 files
Human commits  9
```

Avoid turning this into a vanity dashboard. It should answer useful review/debugging questions.

---

## 7. Session Search

Possible commands:

```bash
originlog search "refresh token"
originlog sessions --file src/auth.ts
```

Useful once users have hundreds of sessions.

---

## 8. Export Bundle

Potential:

```bash
originlog export <session-id>
```

Produces sanitized/portable data for bug reports or sharing.

Privacy controls are mandatory before this feature ships.

---

## 9. VS Code Extension

Priority: **Medium/Low until CLI proves demand**

Potential UX:

- gutter indicator for known AI provenance
- command palette: “Originlog: Why this line?”
- open session timeline
- show prompt/evidence panel

The extension should consume the CLI/programmatic core rather than reimplement parsing.

---

# Long-Term

## 10. CI / Pull Request Report

Potential use:

```text
PR #184
AI-assisted changes detected

Claude Code
- src/auth.ts
- src/token.ts

Codex
- tests/auth.test.ts
```

Must be designed carefully to avoid pretending that AI provenance equals code quality.

---

## 11. Team Provenance

Potential capabilities:

- aggregate local provenance into a repository artifact
- share session references alongside commits
- opt-in team audit trail

This introduces privacy/security complexity and may require a separate product mode.

Do not build before strong demand.

---

## 12. Agent Adapter SDK

Potential package:

```text
@originlog/adapter-sdk
```

Only create this once at least 3 adapters reveal a stable contract.

Premature SDK design will freeze bad abstractions.

---

## 13. Plugin/Evidence Providers

Possible future architecture:

```text
Agent adapter
Git evidence
IDE evidence
CI evidence
Custom evidence provider
       ↓
Provenance engine
```

Again: wait until real use cases exist.

---

# Growth-Oriented Features

These features may improve OSS adoption if they remain useful rather than gimmicky.

## 14. One-Command Demo

Example:

```bash
npx originlog demo
```

Creates or opens a synthetic session/report so users understand the product without exposing their history.

---

## 15. Adapter Health Matrix

README table:

```text
Agent         Detect   Sessions   Events   Why
Claude Code   ✓        ✓          ✓        ✓
Codex         ✓        ✓          ✓        ✓
OpenCode      ✓        beta       beta     beta
```

This communicates maturity better than a long logo wall.

---

## 16. `good first adapter`

Make adapter additions contributor-friendly by documenting:

- source discovery
- fixture format
- normalized event mapping
- test requirements

This can create community growth without expanding core complexity.

---

# Explicit Anti-Roadmap

Do not build these unless the project direction changes materially:

- generic AI chat UI
- another coding agent
- autonomous code editing
- paid LLM requirement for core commands
- hosted account system before local product-market fit
- team productivity score
- developer ranking based on AI usage
- opaque “AI contribution percentage” metric
- prompt management system
- token-cost tracker
- team management system

These distract from provenance and make correctness harder to defend.

---

# Suggested Priority Order

```text
1. Claude end-to-end
2. Git correlation
3. `why`
4. Codex
5. JSON output
6. HTML report
7. Search/activity
8. OpenCode
9. editor integration
10. team/CI only if demanded
```

The project wins by being the most understandable and trustworthy tool for code provenance, not by having the largest feature list.
