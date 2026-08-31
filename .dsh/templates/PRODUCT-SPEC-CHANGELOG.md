# Product specification changelog

<!-- rule: copy to docs/requirements/PRODUCT-SPEC-CHANGELOG.md. This file is written in the
     SAME turn as any edit to PRODUCT-SPEC.md. A spec edit without an entry here is an
     incomplete turn (root AGENTS.md section 8). -->
<!-- rule: newest entry first. Entries are append-only: never rewrite one, never delete one.
     A correction is a new entry that names the entry it corrects. -->
<!-- rule: the version bumps by exactly 0.1 per entry. A major bump (x.0) marks a scope
     change approved by a named human, and says so in Rationale. -->
<!-- rule: ids are listed explicitly, never "various". "Updated several requirements" makes
     the changelog unusable for the one job it has: telling a resumed session what moved. -->
<!-- rule: Approver is a person, not a role placeholder and not the agent. An agent-only
     edit is recorded as "proposed by <agent>, pending <name>" and the spec stays draft. -->

Spec: docs/requirements/PRODUCT-SPEC.md
Current version: 0.4

| Version | Date | Added | Changed | Removed | Rationale | Approver |
|---|---|---|---|---|---|---|
| EXAMPLE 0.4 | 2026-02-11 | NFR-PRIV-002 | REQ-REFD-001 (idempotency key TTL 24 h -> 72 h) | - | provider retries up to 48 h, so a 24 h key expiry allowed a duplicate refund | j.okafor |
| EXAMPLE 0.3 | 2026-02-04 | REQ-REFD-004, NFR-RES-001 | - | REQ-REFD-003 (superseded by REQ-REFD-004) | retry policy moved from the caller to the service so the bound is enforced in one place | j.okafor |
| EXAMPLE 0.2 | 2026-01-28 | REQ-REFD-001, REQ-REFD-002, NFR-PERF-001 | - | - | first decidable draft after the finance workshop | m.li |

## Entry format

<!-- rule: one row per turn. Copy this block into the table and fill every column; a column
     with nothing to report carries "-", never an empty cell. -->

```
| <version> | <YYYY-MM-DD> | <ids added, comma separated> | <id (what changed)> | <id (why removed or superseded by)> | <one line: why, not what> | <human name> |
```

## Rejected changes

<!-- rule: a requested change that was NOT made is recorded here with the reason it lost.
     Without this section the same request returns every quarter and is re-litigated. -->

| Date | Requested change | Rejected because | Requested by |
|---|---|---|---|
| EXAMPLE 2026-02-06 | allow a refund without an idempotency key for "urgent" cases | removes the only structural guard against duplicate refunds; the hazard register keeps HAZ-REFD-001 open with no compensating control | support lead |

## Verification

```sh
node .dsh/base/dsb.mjs spec-lint   # exit 0 before the spec is called approved
node .dsh/base/dsb.mjs trace       # exit 0 once code and tests exist for the ids
```
