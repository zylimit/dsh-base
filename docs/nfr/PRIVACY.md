# Privacy

Attribute id `privacy`. Protected attribute: never waivable, never fast-skippable.
Related: [SECURITY.md](./SECURITY.md) · [SAFETY.md](./SAFETY.md) · [RESILIENCE.md](./RESILIENCE.md) · [RELIABILITY.md](./RELIABILITY.md) · [../LARGE-REPO-GUIDE.md](../LARGE-REPO-GUIDE.md) · [../QUALITY-ATTRIBUTES.md](../QUALITY-ATTRIBUTES.md) · [../../AGENTS.md](../../AGENTS.md)

**Scope.** This document defines **engineering obligations**. It is not legal advice and does not determine which regime applies to a deployment. Where a number below is regime-dependent, it is written as a configured internal budget; the adopting team replaces it with the value its counsel states.

## 1. Definition

Privacy is the property that personal data is collected only for a stated lawful purpose, held only as long as that purpose requires, exposed only to parties with a stated basis, and removable on request — provably, including derived copies.

Privacy is **not**:

| Not this | Because |
|---|---|
| Security | Security keeps unauthorised parties out ([SECURITY.md](./SECURITY.md)). Fully authorised use for an undeclared purpose is a privacy breach with no security event. |
| Encryption | Encryption at rest protects the disk, not the query that exports a million rows to an analyst. |
| A consent banner | Consent is one lawful basis among several and is worthless without a withdrawal path that actually stops processing. |

## 2. Failure modes defended against

1. Collection without a declared purpose ("we might need it later").
2. Personal data reaching a lower-trust sink: logs, traces, crash reports, analytics, context packs, prompts sent to a third-party model.
3. Purpose creep: support data reused for marketing or model training.
4. Undeletable copies in backups, search indices, caches, warehouses, dead-letter queues, exported CSVs.
5. Re-identification of a "hashed" or "aggregated" dataset.
6. Silent cross-border transfer through a CDN, a support tool or a new sub-processor; a data-subject request answered from one store while five others keep the record; retention rules written in a policy and implemented nowhere.

## 3. Data inventory

No personal data element ships without a row. The inventory lives with the module and is reviewed on every change that touches it.

| Element | Category | Subject | Lawful basis | Purpose | Collection point | Storage | Retention | Deletion mechanism | Processors | Cross-border | Owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `email` | Contact / identifier | Customer | Contract | Account login, service mail | Signup form | `users` table, encrypted column | Account life + 30 d | `erase-subject` job, cascade to index and warehouse | Mail vendor | EU→US, standard clauses | Accounts team |
| `ip_address` | Network identifier | Visitor | Legitimate interest | Abuse prevention | Edge proxy | Access log, truncated | 30 d | Log retention policy, automated | Log vendor | none | Platform team |

Categories that raise the tier to `critical`: health, biometrics, genetics, sexual life, religion, political opinion, trade-union membership, criminal records, precise location, children's data, financial account data.

## 4. Privacy by design — seven principles, seven tactics

| Principle | Engineering tactic | How to verify |
|---|---|---|
| Proactive, not reactive | Privacy review is part of the task envelope, not a pre-release step | Task envelope names the inventory rows touched |
| Privacy as the default | Opt-in collection; new fields default to not collected, not exported | Config test: a new field is absent from exports until listed |
| Privacy embedded in design | Personal data confined to a named module with a typed accessor | `arch-check`: no undeclared edge into the personal-data module |
| Full functionality | Pseudonymous ids in analytics instead of dropping analytics | Analytics test asserting no raw identifier in the event schema |
| End-to-end lifecycle protection | Encryption in transit and at rest plus enforced deletion path | `no-insecure-transport`; deletion test across every store |
| Visibility and transparency | Machine-readable inventory plus an audit trail of access and export | Inventory lint; audit-record assertion on export |
| Respect for the user | Self-service access, export and erasure with a tracked SLA | End-to-end DSR test measuring elapsed time |

## 5. Pseudonymisation vs anonymisation

| Property | Pseudonymisation | Anonymisation |
|---|---|---|
| Definition | Identifier replaced by a token; re-identification possible with additional information | Re-identification not reasonably possible by anyone, including the holder |
| Still personal data? | **Yes** | No |

A hashed email is personal data. The input space of email addresses is small and enumerable, so an unsalted or globally salted digest is reversible by dictionary attack; and even where it is not reversible, the digest is a **stable linkage key** that joins records across systems, which is exactly the function an identifier performs. Use an HMAC with a per-purpose secret held outside the analytics store, rotate it, and never publish the mapping.

## 6. Tactics

| Tactic | What it prevents | How to implement | How to verify | Cost |
|---|---|---|---|---|
| Data minimisation | Unbounded exposure surface | Collect the fields the stated purpose needs; delete the rest at ingestion | Schema test: undeclared fields are rejected, not stored | low |
| Purpose tagging | Purpose creep | Every field carries a purpose tag; readers declare a purpose and the accessor enforces the intersection | Access test: reading with the wrong purpose fails | medium |
| Log redaction at the sink | Personal data in logs | Structured logging with an allow-list of loggable fields; redaction in the logger, not at call sites | `fitness` `no-pii-in-logs` (error, exit 1); log-schema test | low |
| Field-level encryption / tokenisation | Bulk readability of a dump | Encrypt or tokenise sensitive columns with a separately held key | Test: raw store read returns ciphertext or token | medium |
| Consent ledger | Unprovable and unwithdrawable consent | Append-only record of grant and withdrawal with timestamp, version, scope; processing consults it | Test: withdrawal stops processing on the next request | medium |
| DSR pipeline | Manual, partial, late answers | One job that fans out across every store listed in the inventory and reports per-store completion | End-to-end DSR test asserting all stores respond | high |
| Deletion propagation | Ghost copies | Deletion writes a tombstone consumed by index, cache, warehouse, DLQ and exports; backups covered by expiry, not surgery | Test: after erasure, each store returns not-found | high |
| Retention job | Policy without implementation | Scheduled per-element expiry driven by the inventory | Job report per element; assertion on record age distribution | medium |
| Transfer control | Silent cross-border flow | Explicit region pinning, allow-list of sub-processors, egress inventory | Config test asserting region; processor register diff in review | medium |

## 7. Data-subject rights

Response budgets are internal engineering budgets and must be at least as strict as the applicable regime.

| Right | Engineering obligation | Ack budget | Completion budget |
|---|---|---|---|
| Access | Machine-generated copy of all stored elements per the inventory | 24 h | 7 d |
| Rectification | Correction propagates to derived stores | 24 h | 7 d |
| Erasure | Tombstone plus fan-out; backups expire on schedule with a written window | 24 h | 30 d (backups: state the window) |
| Restriction | Processing flag honoured by every reader | 24 h | 3 d |
| Portability | Structured, machine-readable export in a documented format | 24 h | 7 d |
| Objection | Stop the named processing; record the decision | 24 h | 3 d |

## 8. Hard rules

`M` = machine-enforced, `P` = prompt-only.

1. **M** (`fitness` / `no-pii-in-logs`, error, exit 1) — no personal identifier reaches a log, print or trace call; log a pseudonymous id.
2. **M** (`attributes`, exit 2) — `privacy: high|critical` requires a passing check claiming `privacy`.
3. **M** (`catalog-lint`, exit 1) — `privacy: minimal|none` requires an `attributeReasons.privacy` entry naming why no personal data is handled.
4. **M** (`waiver check`) — privacy is protected; no waiver is expressible.
5. **P** — every personal data element has an inventory row before the code that stores it merges.
6. **P** — every element has a lawful basis, a purpose, a retention period and a deletion mechanism; "indefinite" is not a retention period.
7. **P** — a new sub-processor, a new export destination or a new region is a HIGH approval action.
8. **P** — deletion is proven per store by a test, not asserted by the deleting service.
9. **P** — analytics, ML training sets and prompts sent to third-party models contain pseudonymous ids only, and the mapping stays out of those systems.
10. **P** — a DPIA is written before implementation when any trigger in §9 applies.
11. **P** — breach handling follows an internal budget: triage ≤ 2 h, scope assessment ≤ 12 h, notification decision ≤ 24 h, external notification within the regime's deadline stated in the runbook.
12. **P** — test fixtures contain synthetic data only; a production dump never enters the repository or a context pack.

## 9. DPIA trigger list

Write a DPIA when the change involves any of: special-category data; children's data; systematic monitoring of a public space; large-scale profiling or scoring; automated decisions with legal or similarly significant effect; biometric identification; precise location tracking; combining datasets from separate sources; a new cross-border transfer; a new sub-processor with access to raw personal data; or personal data used to train or fine-tune a model.

## 10. Measurable targets

Metrics for `NFR-PRIVACY-<NNN>`. Placeholders, not measurements.

| Metric | Unit | Placeholder |
|---|---|---|
| Personal-data fields in logs | count | 0 |
| Inventory coverage of stored elements | percent | 100 |
| DSR access completion | days | ≤ 7 |
| Erasure propagation to online stores | hours | ≤ 24 |
| Erasure propagation to backups | days | ≤ 35 |

EARS form example: *When a verified erasure request is accepted, the `accounts` module SHALL remove or tombstone the subject's records in every store listed in the inventory within 24 h and report per-store completion.*

## 11. How it is gated here

| Mechanism | Command | Effect |
|---|---|---|
| Log scan | `node .dsh/base/dsb.mjs fitness --all` | `no-pii-in-logs` is error severity: any finding sets exit 1. Allow patterns (`hash`, `mask`, `redact`, `pseudonym`, `***`) suppress within a five-line window, so the rule screens and does not prove |
| Tier gate | `node .dsh/base/dsb.mjs attributes` | `BLOCKED_BY_ATTRIBUTES` when a blocking tier has no passing claiming check |
| Delegation hygiene | `node .dsh/base/dsb.mjs context-pack --focus "src/x/**"` | Deny list keeps secrets and engine state out of the pack; `.env.example` is allowed back |
| Traceability | `node .dsh/base/dsb.mjs trace` | Each `REQ`/`NFR` privacy id must be referenced by a test |
| Proof | `node .dsh/base/dsb.mjs gate` | Exit 2 blocking, 3 degraded, 4 stale evidence |

Candidate external tools (none shipped; register the adopted one as a check claiming `privacy`): a PII detector such as Microsoft Presidio in CI over fixtures and log samples, a log-schema linter, a data-catalog or lineage tool to keep the inventory honest, and a scheduled retention/erasure verifier.

Module declaration in `catalog.json`:

```json
{
  "id": "accounts",
  "paths": ["src/accounts/**"],
  "layer": "domain",
  "riskTier": "high",
  "attributes": { "privacy": "critical", "security": "high" },
  "verification": ["unit", "pii-scan", "dsr-e2e", "retention-check"]
}
```

with, for example, `"pii-scan": { "command": "npm run scan:pii", "class": "security", "attributes": ["privacy"] }`. Never set `allowFastSkip` on a privacy check.

## 12. Anti-patterns

| Anti-pattern | Why it fails |
|---|---|
| "We hash the email, so it is anonymous" | Enumerable input space and a stable linkage key: still personal data |
| Logging the whole request object in an error path | The highest-volume PII leak in practice, and it lands in the lowest-trust store |
| Deleting from the primary store only | Search index, cache, warehouse, DLQ and exports keep the record |
