# ADR-0007: Architectural debt ratchets in one direction

Status: Accepted
Date: 2025-01-01
Deciders: maintainers
Enforced-by: arch-trend | arch-check

## Context

A repository adopting boundary enforcement for the first time has existing
violations. A gate that fails on all of them is switched off within a day, and a
gate that ignores all of them never turns back on.

## Decision

`arch-check --record` appends a metrics snapshot (forbidden edges, layer
violations, undeclared edges, cycles) to `.dsh/base/trend/arch-trend.jsonl`, which
is committed. `arch-trend --gate` fails only when the newest measurement exceeds
the best value ever recorded. Existing debt is tolerated; new debt is not.

## Consequences

- A brownfield repository can enable the gate on day one.
- Paying debt down lowers the ceiling permanently, so improvement is not reversible
  by a later change.
- The ledger is committed on purpose: a per-machine baseline would let each
  developer measure against a different best.

## Alternatives rejected

- **Fail on any violation immediately.** Rejected: it is correct and unusable, and
  an unusable gate protects nothing.
- **Freeze an explicit allow-list of violations.** Rejected: an allow-list needs its
  own staleness audit and grows silently. A monotone metric needs neither.
