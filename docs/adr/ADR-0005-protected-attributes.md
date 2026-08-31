# ADR-0005: Security, safety and privacy have no bypass

Status: Accepted
Date: 2025-01-01
Deciders: maintainers
Enforced-by: attributes | catalog-lint | fitness

## Context

Every exception mechanism is eventually used on the thing it was least meant for.
A waiver system with no reserved set becomes a way to ship an unreviewed
authentication change on a deadline.

## Decision

`security`, `safety` and `privacy` are protected attributes. A check that claims
one of them may not set `allowFastSkip`. A waiver that names one of them, in either
its `reason` or its `scope`, fails validation, so the exception is not merely
discouraged, it is unexpressible. A module that declares one of them at `critical`
or `high` blocks the gate until a claiming check actually passes for it.

## Consequences

- Deadline pressure cannot silently move these three.
- Opting out is still possible, but only by declaring the tier as `minimal` or
  `none` with a written `attributeReasons` entry, which is a recorded decision that
  a reviewer can see in the diff.
- Teams occasionally have to install a tool rather than defer it. That is the point.

## Alternatives rejected

- **Allow a signed, time-boxed waiver for security.** Rejected: an expiry is only a
  control if something enforces it under pressure, and the pressure is precisely
  when the expiry gets extended.
- **Make all attributes waivable and rely on review.** Rejected: it reintroduces the
  failure mode that the tiering exists to remove.
