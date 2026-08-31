# Architecture Decision Records

One file per decision: `ADR-<NNNN>-<slug>.md`. Numbers are append-only and never
reused. A decision that is replaced is marked `Superseded by ADR-NNNN` and stays.

Every ADR whose `Status` is not retired MUST carry an `Enforced-by:` line that
resolves to at least one of:

| Kind | Example |
|---|---|
| a check id in `catalog.checks` | `arch`, `fitness`, `secrets` |
| a fitness rule id | `no-secret-literal` |
| an engine capability | `arch-check`, `agents-lint`, `attributes` |
| an explicit human control | `manual:maintainers at each release` |

`node .dsh/base/dsb.mjs adr-check` fails on a live ADR with no such line, and on a
reference that resolves to nothing. A phantom reference is worse than none: it reads
as enforced while enforcing nothing.

Retired statuses recognised by the audit: Superseded, Deprecated, Rejected,
Withdrawn, Retired.
