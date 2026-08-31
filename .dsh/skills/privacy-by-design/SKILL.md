---
name: privacy-by-design
description: Use when a change collects, derives, stores, logs, exports, shares or deletes personal data, or when a module declares privacy at high or critical.
whenToUse: Before introducing or altering any processing of personal data, and when a DPIA trigger is hit.
---

## Purpose

Make personal-data processing explicit, minimal, purposeful and reversible. Produces `docs/privacy/DATA-INVENTORY.md` (every data element with lawful basis, retention and deletion mechanism) and, when a trigger fires, `docs/privacy/DPIA-<NNN>.md`. The inventory is the input to deletion tests, logging rules and subject-rights endpoints.

## When this fires

- A change adds a field, table, event, log line, export or third-party call that carries data about an identifiable person.
- A change adds a processor, a sub-processor, or a cross-border transfer.
- `node .dsh/base/dsb.mjs fitness --all` reports `no-pii-in-logs` (exit 1).
- A retention period, deletion path or consent flow changes.
- A module declares `privacy` at `critical` or `high` and the inventory does not cover it.
- The user invokes `/privacy-by-design`.

## Procedure

1. Inventory before design. For each data element record eleven columns (see output contract). Derive the list from code and schema, not from a product document: read migrations, event payloads, log statements and outbound request bodies.
2. Classify the element: identifier (direct), quasi-identifier, content, derived/inferred, or special category (health, biometric, ethnicity, political, sexual orientation, criminal). Special category forces `privacy` at `critical` or `high` and forces a DPIA.
3. Apply minimisation, in this order: do not collect it; collect it coarser (age band, not birth date; region, not GPS); collect it shorter (session-only); collect it pseudonymised. Record which option you rejected and why - "the product asked for it" is not a reason, name the purpose it serves.
4. Fix the lawful basis per purpose, not per element. One element serving two purposes needs two rows. If the basis is consent, the row must name the consent record location and the withdrawal path; if legitimate interest, the row must name the balancing note.
5. Distinguish pseudonymisation from anonymisation, decidably:

   | Property | Pseudonymised | Anonymised |
   | --- | --- | --- |
   | Re-identification key exists anywhere | Yes | No |
   | Still personal data under law | Yes | No |
   | Example | HMAC of email with a held key; user_id | k-anonymous aggregate, k >= 20, no free-text |

   A SHA-256 of an email is pseudonymous, not anonymous: the input space is enumerable, so the hash is a stable identifier that re-identifies by dictionary attack. Treat every such value as personal data in logs, exports and retention.
6. Enforce purpose limitation: a new use of existing data is a new purpose and needs its own row, basis and (if consent-based) a fresh consent. Reusing a support-ticket email for marketing is a violation even though no new data was collected.
7. Map the seven privacy-by-design principles to tactics you can point at:

   | Principle | Engineering tactic | Evidence |
   | --- | --- | --- |
   | Proactive not reactive | Inventory row exists before the field ships | Row + PR link |
   | Privacy as default | Opt-in defaults, narrowest scope, shortest TTL | Config default in code |
   | Embedded in design | Storage schema carries retention metadata | Migration file |
   | Full functionality | Degraded-but-working path when consent is withheld | Test id |
   | End-to-end security | Encryption at rest and in transit, key owner named | Check id claiming `security` |
   | Visibility and transparency | Published notice matches the inventory, diffed each release | Notice path + diff check |
   | User-centric | Self-service rights endpoints, no support ticket required | Endpoint path + test id |

8. Implement subject rights as endpoints with budgets: access, rectification, erasure, portability (machine-readable export), objection/restriction. Record acknowledgement budget (<= 72 h) and fulfilment budget (<= 30 days) as an `NFR-PRIV-<NNN>` with numbers so `spec-lint` accepts it (NFR rows without a metric are an error, exit 1).
9. Enforce the logging rule: never log a raw identifier (email, phone, national id, passport, address, full name, card, IBAN). Log a stable pseudonymous id plus a correlation id. Enforced by `no-pii-in-logs` via `node .dsh/base/dsb.mjs fitness --all` (exit 1). The rule allows lines containing `hash`, `mask`, `redact` or `pseudonym` - use those helpers rather than a suppression comment.
10. Make deletion provable. Write an erasure test that: creates a subject with data in every store named in the inventory; issues erasure; asserts absence in primary store, replicas, search index, cache, analytics/warehouse, object storage and outbound processor; then restores the newest backup into a scratch environment and asserts absence there or asserts the backup is beyond its own retention horizon. Name that test id in the inventory's Deletion mechanism column and cite the paired `NFR-PRIV-<NNN>` so `node .dsh/base/dsb.mjs trace` resolves it (exit 1 if unresolved or uncovered).
11. Run the DPIA triggers. Write a DPIA when any is true: special-category data; systematic monitoring of a public area; large-scale profiling with legal or similarly significant effect; automated decision-making without human review; children's data; biometric identification; data matching across previously separate datasets; a new cross-border transfer; a new processor with access to raw identifiers.
12. Close: `node .dsh/base/dsb.mjs attributes` (exit 1 if `privacy` is blocking with no wired claiming check) then `node .dsh/base/dsb.mjs gate` (exit 2). A privacy check reported `BLOCKED` is uncovered processing.

## Output contract

`docs/privacy/DATA-INVENTORY.md` - one row per (element, purpose):

| Data element | Category | Subject | Lawful basis | Purpose | Collection point | Storage location(s) | Retention | Deletion mechanism | Processors | Cross-border transfer |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| email | direct identifier | customer | contract | account login | POST /signup | pg.users, search idx, backups | 30 d after closure | `test-erasure-email` | SendGrid | US, SCC |

Plus sections: `## Minimisation decisions`, `## Consent and withdrawal` (capture point, record location, withdrawal path, propagation deadline), `## Subject rights` (right | endpoint | authn of requester | ack budget | fulfil budget | test id), `## Logging rule` (allowed fields list), `## Deletion proof` (store | erasure path | test id | backup horizon).

`docs/privacy/DPIA-<NNN>.md`: processing description, necessity and proportionality, risks to subjects (likelihood/severity), mitigations with owners, residual risk, decision and reviewer, review date.

## Stop conditions

Halt and ask the human when:

- Special-category data is proposed and no DPIA exists. Do not implement the field first.
- A lawful basis cannot be named for a purpose already shipping. That is a live compliance issue for a human, not a code change.
- Erasure cannot propagate to a store (an immutable ledger, an append-only analytics table, a third party without a delete API). Escalate: the options are architectural, not incidental.
- A retention period is unset or "forever" for personal data.
- A cross-border transfer has no named mechanism.
- Someone proposes suppressing `no-pii-in-logs` with `dsb-fitness:ignore` to ship faster.

## Anti-patterns

| Failure mode | Correction |
| --- | --- |
| "We hash the email, so it is anonymous" | Hashing an enumerable input is pseudonymisation; the value stays personal data everywhere it flows. |
| Retention written as "as long as necessary" | A number with a unit, plus the job that enforces it and the test that proves it. |
| Deletion tested only in the primary database | Assert absence in replicas, caches, search, warehouse, object storage, processors and the newest backup. |
| Debug logging of a whole request body | Log an allow-list of fields; whole-object logging leaks fields added later by someone else. |
| Consent captured but withdrawal unimplemented | Withdrawal must be as easy as consent and must propagate to processors within a stated deadline. |
| New purpose served by existing data, no new row | Purpose limitation binds by purpose; add the row, the basis and the notice update. |
| Inventory written from the product spec | Derive it from migrations, event payloads and outbound calls; specs omit the derived data. |
| NFR-PRIV row with no number | `spec-lint` rejects an NFR without a measurable target (exit 1); state the budget in hours or days. |
