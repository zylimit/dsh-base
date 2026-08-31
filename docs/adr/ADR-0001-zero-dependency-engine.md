# ADR-0001: The governance engine is a zero-dependency Node program

Status: Accepted
Date: 2025-01-01
Deciders: maintainers
Enforced-by: selftest | manual:maintainers at each release

## Context

The engine is most needed exactly where the environment is least prepared: a fresh
clone, a CI image without a package manager, a machine where `npm install` is
blocked by policy. Any dependency creates a state in which governance is skipped
"just this once", and that state becomes permanent.

## Decision

The engine uses the Node standard library only, targets Node 20 or later, and ships
no lockfile of its own. `package.json` declares an empty `dependencies` and an
empty `devDependencies`. External analysers are wired in as catalog checks, never
imported.

## Consequences

- The engine runs from a bare checkout with no install step.
- Capabilities that a library would provide (YAML parsing, schema validation, a test
  framework) are either hand-written and covered by `selftest`, or deliberately
  absent. Frontmatter parsing is intentionally minimal and rejects what it cannot
  interpret rather than guessing.
- The cost is carried by the maintainers of the engine, not by every adopter.

## Alternatives rejected

- **Publish the engine as an npm package.** Rejected: adoption then requires a
  registry, a version resolution step and a supply-chain review, which is exactly
  the friction that causes a team to defer governance.
- **Ship a compiled single-file runtime beside its TypeScript source.** Rejected:
  two artifacts of the same program need their own parity gate, and the parity gate
  becomes another thing that can silently fail. Ship one artifact.
