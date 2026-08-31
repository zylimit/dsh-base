# Architecture - <system name>

<!-- rule: copy to docs/architecture/ARCHITECTURE.md. This document carries the reasoning;
     .dsh/base/catalog.json carries the enforced graph. Both change in the same session. -->
<!-- rule: when this document and the catalog disagree, the measured graph wins. `arch-check`
     reads real import edges; correct the document, never the measurement. Deleting a
     forbidden edge from the catalog to make arch-check pass falsifies the map - the edge
     still exists in the code. -->
<!-- rule: a design that cannot be expressed as modules, layers and forbidden edges is not
     finished. Diagrams are optional; the module table is not. -->

Version: <n> | Date: <YYYY-MM-DD> | Owner: <name> | Catalog commit: <sha>

## 1. Context and drivers

<!-- rule: the two or three drivers that actually shaped the structure. A driver with no
     structural consequence is background, not a driver. -->

| Driver | Origin | Structural consequence |
|---|---|---|
| EXAMPLE provider quota 20 rps/tenant | provider contract | one egress module owns rate limiting; no other module calls the provider |

## 2. Quality-attribute drivers

<!-- rule: one row per attribute declared critical or high anywhere in the catalog. A
     blocking tier must name the check that proves it, or the gate returns
     BLOCKED_BY_ATTRIBUTES. Tiers minimal and none need an attributeReasons sentence in the
     catalog; catalog-lint reports UNJUSTIFIED_TIER otherwise. -->

| Attribute | Tier | Modules | Why this tier | Proven by (check id) |
|---|---|---|---|---|
| EXAMPLE safety | critical | refund-core | a duplicate refund moves money, not reversible without a manual case | refund-interlock-test |
| EXAMPLE security | high | refund-api | internet boundary carrying payment intent | sec-semgrep |

## 3. Module map

<!-- rule: this table mirrors .dsh/base/catalog.json modules[] field for field. A row that
     disagrees with the catalog is a defect in this document, not in the catalog. -->

| id | layer | paths | owners | riskTier | dependsOn | forbiddenDependencies | attributes (non-default) | verification |
|---|---|---|---|---|---|---|---|---|
| EXAMPLE refund-api | service | services/refund/api/** | @payments | high | refund-core | reporting-ui | security: high | unit, sec-semgrep |
| EXAMPLE refund-core | core | services/refund/core/** | @payments | critical | - | refund-api | safety: critical | unit, refund-interlock-test |

## 4. Layer model

<!-- rule: catalog layers[] is ordered OUTERMOST FIRST. An inverted list inverts every
     dependency rule and arch-check will happily enforce the inversion. -->

Allowed direction: <outer> -> <inner>, never the reverse.

```
EXAMPLE  ui  ->  service  ->  core  ->  platform
```

| Layer | May import | Must never import | Rationale |
|---|---|---|---|
| EXAMPLE service | core, platform | ui | a handler importing ui makes the domain untestable without a browser |

## 5. Forbidden edges

<!-- rule: one row per entry in any module's forbiddenDependencies, with the failure the
     edge would cause. An edge with no stated reason gets deleted by the next person who
     finds it inconvenient. -->

| From | To | Why forbidden | Detected by |
|---|---|---|---|
| EXAMPLE refund-core | refund-api | the domain would depend on its transport, and a new endpoint could bypass the interlock | arch-check exit 1 |

## 6. Key interfaces and contracts

<!-- rule: one row per boundary another module depends on. Name what may change without a
     coordinated release, and what may not. -->

| Interface | Provider | Consumers | Shape | Compatibility | Contract test |
|---|---|---|---|---|---|
| EXAMPLE POST /refunds | refund-api | support-ui | JSON, idempotency key required | additive fields only | refund-contract |

## 7. Data model and ownership

<!-- rule: exactly one module owns each store; a second writer is a distributed transaction
     nobody designed. Personal data is cross-referenced to docs/privacy/DATA-INVENTORY.md. -->

| Store | Owner module | Written by | Read by | Personal data | Retention |
|---|---|---|---|---|---|
| EXAMPLE pg.refunds | refund-core | refund-core only | refund-api | customer id (pseudonymous) | 7 years, finance |

## 8. Cross-cutting concerns

<!-- rule: the mechanism and where it is enforced, not the intention. Each row names one
     place a reviewer can read. -->

| Concern | Mechanism | Enforced at | Evidence |
|---|---|---|---|
| EXAMPLE authn | signed service token verified at the edge | services/refund/api/auth.ts | sec-semgrep |
| EXAMPLE timeouts | 2 s connect, 5 s total, bounded retry with jitter | services/refund/egress/client.ts | no-unbounded-resource |

## 9. Deployment view

<!-- rule: no failure column means the happy path only. -->

| Unit | Runs | Scaling | State | Fails when it disappears |
|---|---|---|---|---|
| EXAMPLE refund-api | 3 replicas, 2 zones | horizontal on cpu | stateless | no new refunds; queued work continues |

## 10. Decision index

<!-- rule: every structural decision is an ADR under docs/adr/ with an Enforced-by: line;
     adr-check exits 1 on a missing or phantom token. -->

| ADR | Decision | Status | Enforced-by |
|---|---|---|---|
| EXAMPLE ADR-0007 | refund-core owns the idempotency key | Accepted | arch-check |

## 11. Known debt

<!-- rule: existing debt is allowed, new debt is not. Record the baseline with
     `arch-check --record`; `arch-trend --gate` then fails only on a regression past the
     best value ever recorded. Never widen a baseline to absorb a new violation. -->

| Debt | Baseline value | Owner | Condition to repay | Ratchet |
|---|---|---|---|---|
| EXAMPLE 3 undeclared edges into reporting | 3 (recorded 2026-01-30) | @payments | reporting moves behind an interface | arch-trend --gate |

## Verification

```sh
node .dsh/base/dsb.mjs catalog-lint      # the catalog is valid and total
node .dsh/base/dsb.mjs arch-check        # measured edges match the declared graph
node .dsh/base/dsb.mjs arch-trend --gate # no regression past the best ever
node .dsh/base/dsb.mjs agents-lint       # high/critical modules carry a contract
```
