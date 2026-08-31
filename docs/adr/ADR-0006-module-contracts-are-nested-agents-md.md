# ADR-0006: Module boundary contracts live in nested AGENTS.md files

Status: Accepted
Date: 2025-01-01
Deciders: maintainers
Enforced-by: agents-lint | manual:reviewer confirms the four sections during review

## Context

An agent working in a 1,000,000-line repository cannot read the architecture before
every edit, and a root instruction file that tried to describe every module would be
resent on every request at a cost proportional to the repository rather than to the
task.

## Decision

Each module at risk tier `high` or `critical` carries an `AGENTS.md` in its own
directory with the sections **Purpose**, **Boundaries**, **Invariants** and
**Verification**. The DeepSeek Harness loads that file automatically the first time
a first-party read, write or edit touches the directory, so its cost is paid only by
the work that actually enters the module.

## Consequences

- Context cost scales with attention, not with repository size.
- The boundary rule is delivered at the moment it is about to be broken, which is
  the only moment it reliably changes behaviour.
- `agents-lint` reports a missing contract as an error for blocking risk tiers and
  as a warning elsewhere, and reports a contract missing one of the four sections.

## Alternatives rejected

- **A central module-capsule directory.** Rejected: it is not auto-loaded, so it is
  read only by someone who already knows to look for it.
- **Put every boundary rule in the root AGENTS.md.** Rejected: it grows without
  bound and is paid for on every request, including requests that never approach the
  module it describes.
