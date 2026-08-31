# ADR-0002: Enforcement lives in git hooks and CI, not in the harness

Status: Accepted
Date: 2025-01-01
Deciders: maintainers
Enforced-by: manifest | manual:maintainers review the hook set at each release

## Context

Several donor scaffolds place their gates in a host hook system: `PreToolUse`,
`Stop`, `PostToolUse`. The DeepSeek Harness has no hook system, no project settings
file, and no markdown-defined commands or subagents. A gate written as prompt text
is advice, not enforcement.

## Decision

Machine enforcement lives in three places only:

1. `git` hooks under `.dsh/base/githooks`, activated by
   `git config core.hooksPath .dsh/base/githooks`.
2. CI (`.github/workflows/gate.yml`).
3. The engine itself, which every other layer calls.

Agent-side discipline lives in `AGENTS.md` and skills, and is labelled prompt-only
wherever it is not backed by a command.

## Consequences

- A developer who bypasses with `--no-verify` is not stopped locally, so CI runs the
  same gate and is the authority for a merge.
- Hooks degrade explicitly: a missing catalog or a missing `node` exits 0 with a
  printed statement that checks were skipped and that skipping is not a pass.
- Nothing in this repository claims that the harness enforces a rule it cannot.

## Alternatives rejected

- **Wait for a harness hook API.** Rejected: the scaffold has to work with the
  harness that exists today.
- **Enforce only in CI.** Rejected: the feedback arrives after the work is pushed,
  which is the most expensive moment to learn that a boundary was crossed.
