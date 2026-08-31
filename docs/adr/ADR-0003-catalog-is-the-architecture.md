# ADR-0003: The module catalog is the authoritative architecture

Status: Accepted
Date: 2025-01-01
Deciders: maintainers
Enforced-by: arch-check | catalog-lint | arch

## Context

Architecture documents drift because nothing reads them. The observable architecture
is the set of import edges that actually exist, and a diagram that disagrees with
those edges misleads every reader who trusts it.

## Decision

`.dsh/base/catalog.json` declares modules, layers, allowed dependencies and
forbidden dependencies. `arch-check` extracts real import edges from source and
compares them with that declaration. When `docs/architecture/ARCHITECTURE.md` and
the catalog disagree, the measured graph wins and the document is corrected.

## Consequences

- Every tracked path must classify as a module, a global path, or an ignored path
  with a written reason; an unmapped path is a `catalog-lint` error because it would
  escape every targeted gate.
- A design that cannot be expressed as modules, layers and forbidden edges is not
  finished.
- Adding a dependency is a visible act: the edge appears as drift until it is
  declared.

## Alternatives rejected

- **Keep the architecture in prose and review it by hand.** Rejected: the failure
  mode being prevented is precisely the one review misses, because a new import line
  looks like an ordinary line.
- **Infer modules from directories.** Rejected: one module per directory produces
  thousands of modules in a large repository and destroys the value of impact
  scoping. Modules are business domains, sized 30 to 150 for a very large tree.
