# Git Development Workflow

Originlog should maintain a clean, realistic open-source Git history.

Do not develop the entire project directly on `main`.

## Branch Strategy

Create a dedicated branch for each coherent feature, bug fix, refactor, documentation change, or infrastructure task.

Naming convention:

```text
feat/<short-description>
fix/<short-description>
refactor/<short-description>
test/<short-description>
docs/<short-description>
chore/<short-description>
ci/<short-description>
perf/<short-description>
```

Examples:

```text
feat/claude-session-discovery
feat/provenance-engine
fix/missing-session-timestamps
refactor/event-normalizer
test/overlapping-sessions
docs/architecture
chore/project-tooling
ci/github-actions
```

Do not create branches solely to artificially increase activity.

Each branch must represent a meaningful unit of work.

---

## Commit Convention

Use Conventional Commits.

Allowed primary types:

```text
feat
fix
refactor
test
docs
chore
ci
build
perf
```

Examples:

```text
feat: add Claude Code session discovery
feat: normalize agent tool events
fix: handle sessions without timestamps
test: cover overlapping agent sessions
refactor: extract agent adapter interface
docs: document provenance confidence model
ci: run tests on pull requests
chore: configure TypeScript tooling
```

Avoid meaningless commits such as:

```text
update
work
fix stuff
changes
final
fix again
wip
```

A commit should represent one logical change.

Do not create excessive microscopic commits purely to make the repository appear active.

---

## Development Cycle

For each implementation task:

```text
Task
↓
Create branch
↓
Implement logical change
↓
Add/update tests
↓
Commit meaningful milestones
↓
Push branch
↓
Open pull request
↓
Run CI
↓
Review diff
↓
Merge into main
↓
Delete branch
```

Do not push broken code to `main`.

---

## Pull Requests

Use pull requests even during solo development for substantial changes.

A PR should explain:

```text
What changed
Why it changed
Important implementation decisions
Tests performed
Known limitations
```

Prefer small and reviewable PRs.

Do not put an entire release into one giant PR.

Example:

```text
Phase: Claude adapter

PR 1  chore: bootstrap Originlog CLI
PR 2  feat: introduce agent adapter interface
PR 3  feat: discover Claude Code sessions
PR 4  feat: parse Claude Code sessions
PR 5  feat: render session timeline
```

---

## Main Branch

`main` represents the latest stable development state.

Avoid direct commits to `main` except for trivial repository maintenance when appropriate.

Never force-push shared `main`.

CI should run at minimum:

```text
lint
typecheck
unit tests
integration tests
```

before merging important changes.

---

## Debugging

`debug` should not normally be used as a permanent commit type.

A debugging investigation that results in a bug fix should normally become:

```text
fix/<bug-name>
```

with commits such as:

```text
test: reproduce missing timestamp bug
fix: handle missing session timestamps
```

This preserves useful history:

```text
reproduction
↓
fix
↓
regression test
```

instead of recording vague `debug` commits.

---

## Releases

Use Semantic Versioning.

```text
v0.1.0
v0.2.0
v0.2.1
v0.3.0
```

Each meaningful release should have:

* Git tag
* GitHub Release
* concise changelog
* notable features
* upgrade notes when necessary

Do not create meaningless releases solely to generate activity.

---

## Core Principle

Git history should explain how Originlog evolved.

Professional history comes from:

```text
clear tasks
+
focused branches
+
meaningful commits
+
reviewable pull requests
+
reliable tests
+
clean releases
```

not from maximizing the number of commits or branches.
