# ADR-0009: The fleet layer governs the contract surface

Status: Accepted
Date: 2026-09-01
Deciders: maintainers
Enforced-by: fleet | cochange | manual:maintainers review the fleet manifest at each contract change

## Context

Keeping each repository small enough that one agent holds its whole model is a
good answer to the context constraint: a 40-50k-line service has a bounded recap,
a narrow impact fan-out and a fast gate. Nothing in this scaffold argued against
splitting a large system that way.

But the complexity does not disappear when a monolith is split. It moves from
file-to-file dependencies, which a compiler and `arch-check` can both see, to
repo-to-repo contracts, which neither can. That surface is unowned by
construction: every repository governs itself and none of them can observe the
version matrix, the deprecation that nobody acted on, or the cycle that means
three services must be released together. This is exactly how a distributed
monolith forms — every cost of splitting paid, none of the independence gained.

Two facts also argue against treating size as the criterion. Splitting is only
profitable when the parts change independently, and the honest measurement of
that is co-change frequency in git history, not line count. And a monolith has a
real advantage a fleet cannot recover: a cross-cutting refactor is atomic there,
while across repositories it becomes N pull requests, N deploys and a
compatibility window.

## Decision

Governance is three layers, not one.

1. **Inside a repository** — the existing engine: catalog, modules, layers,
   forbidden edges, quality attributes, gate, three-file synchronisation.
2. **Contracts** — each repository declares what it `provides` and `consumes`,
   with version, status, sunset date and the ADR that published it.
3. **The fleet** — `fleet.json` at the group root lists the repositories and is
   linted, measured and recapped as one system.

`fleet impact <contract>` answers the only question that matters before a
breaking change: how many repositories must be released together. `cochange`
measures whether the boundaries were drawn where the code actually changes, and
lets a coupling be accepted with a written reason rather than nagged about
forever.

## Consequences

- A contract change is visibly a coordinated release with a stated cost, before
  it is attempted rather than after it breaks a consumer.
- A deprecation must carry a sunset date, so it is an event rather than a label.
- A contract cycle is reported as what it is: repositories that cannot be
  released independently.
- The manifest is a declaration and can drift from reality. `fleet status` proves
  each repository is installed and governed; it cannot prove the manifest lists
  every contract that exists. That gap is stated rather than hidden.
- `cochange` needs history. Below the configured sample it reports
  `LOW_CONFIDENCE` instead of a conclusion.

## Alternatives rejected

- **Keep only per-repository governance and coordinate contracts by convention.**
  Rejected: the convention holds until the first deadline, and the failure is
  silent until a consumer breaks in production.
- **Put every service back into one repository so the compiler sees everything.**
  Rejected on its own terms: it restores atomic refactors but destroys the
  property that made per-repository agents work, namely a bounded model per unit
  of ownership.
- **Infer the contract graph from code by scanning clients and servers.**
  Rejected: inference is silently incomplete across languages and transports, and
  an incomplete contract graph is more dangerous than an explicit one, because it
  reads as authoritative. The manifest is declared, and `fleet lint` makes the
  declaration answerable.
