# .dsh/templates — document skeletons

## Purpose

Copy-ready skeletons for every governed document, with the authoring rules embedded
as HTML comments so the rule travels with the artifact instead of living only in a
skill that may not be loaded.

## Boundaries

1. A template is a skeleton, never a finished document. It is never referenced as
   evidence and never satisfies a gate.
2. Templates carry example rows. Every example is marked as an example so it is
   never mistaken for a real requirement, hazard or decision.
3. A template must produce a document that passes its own gate:
   `PRODUCT-SPEC.md` must survive `spec-lint`, `ADR.md` must survive `adr-check`,
   `MODULE-AGENTS.md` must survive `agents-lint`.
4. Filenames here are uppercase and hyphenless so they are obviously templates.

## Invariants

1. Changing a template that a gate parses requires re-running that gate against a
   document generated from it, in the same change.
2. `spec-lint` rejects placeholder tokens. Templates therefore use bracketed
   guidance in comments rather than the literal strings `TBD` or `TODO` in body
   text, and any template placed under a requirement directory is skipped by name.
3. Templates state units. A metric without a unit is not a metric.

## Verification

```sh
node .dsh/base/dsb.mjs spec-lint   # after generating a spec from PRODUCT-SPEC.md
node .dsh/base/dsb.mjs adr-check   # after generating an ADR from ADR.md
node .dsh/base/dsb.mjs agents-lint # after generating a module contract
```
