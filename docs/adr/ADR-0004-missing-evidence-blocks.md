# ADR-0004: A missing tool is BLOCKED, never PASS

Status: Accepted
Date: 2025-01-01
Deciders: maintainers
Enforced-by: gate | selftest | verify

## Context

The most dangerous gate result is a green one produced by a check that never ran. A
scanner that is not installed, a command that is misspelled, or a module with no
resolved verification plan all produce "no failures", which is trivially mistaken for
"no problems".

## Decision

Every check resolves to exactly one of four states: `PASS`, `FAIL`, `BLOCKED`,
`SKIPPED`. An undefined command, an absent executable and a spawn error are
`BLOCKED`. An empty verification plan is `BLOCKED`. A run in which every check was
skipped is `BLOCKED`. Aggregation is: any `FAIL` wins, else any `BLOCKED` wins,
else `PASS`. A capability that cannot establish its facts exits 3, never 0.

## Consequences

- A partially configured repository reports a gap instead of a pass.
- CI cannot go green by having fewer tools installed.
- The words "degraded" and "blocked" appear frequently during adoption. That is the
  intended experience: the gaps were always there, they were merely invisible.

## Alternatives rejected

- **Treat a missing tool as a skip.** Rejected: it makes uninstalling a scanner the
  cheapest way to pass.
- **Warn instead of block.** Rejected: warnings accumulate until they are filtered
  out, at which point they no longer exist.
