# .dsh/docs — the reference manual

## Purpose

The scaffold's own manual: operating model, machine protocols, quality-attribute
governance, large-repository guide, adoption, the donor absorb/reject ledger, and
the five attribute tactics catalogues. It travels with the engine so an adopting
project can read it without cloning anything.

**The DeepSeek Harness does not read this directory.** Under `.dsh/` the harness
scans exactly one path, `.dsh/skills`, one level deep. Everything else here is
read by humans and by the `dsb` engine, which is why the manual can live inside
the scaffold's namespace instead of claiming the project's `docs/`.

## Boundaries

1. Reference material only. A project's own instance data — its requirements, its
   ADRs, its architecture document — lives in the project's `docs/`, where
   `catalog.trace.requirementDirs` and `catalog.adr.dir` point. The installer
   never ships instance data.
2. `ADR-CONTRACT.md` states the ADR authoring rules; the ADRs themselves are
   instance data and are not here.
3. Links inside this directory are relative to it. A reference to the project root
   is `../../`; a reference to an ADR is `../../docs/adr/`.
4. No document here may claim an automation that does not exist. Every rule is
   marked machine-enforced with its command and exit code, or `prompt-only`.

## Invariants

1. When a document and the engine disagree, the engine is right and the document
   is corrected. `arch-check` beats `ARCHITECTURE.md`; `dsb help` beats any
   command list written here.
2. Adding a subcommand requires an exit-code row in `PROTOCOLS.md` in the same
   change.
3. Performance figures are labelled as targets unless a named test pins them.

## Verification

```sh
node .dsh/base/dsb.mjs agents-lint    # this file and every module contract
node .dsh/base/dsb.mjs adr-check      # decisions still name a real enforcement point
node .dsh/base/dsb.mjs fitness --all  # no anti-pattern quoted without suppression
```
