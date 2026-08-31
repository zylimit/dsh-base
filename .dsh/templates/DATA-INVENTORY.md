# Data inventory - <system name>

<!-- rule: copy to docs/privacy/DATA-INVENTORY.md. Derive rows from code and schema -
     migrations, event payloads, log statements, outbound request bodies - not from a
     product document. What the code stores is the inventory; what the product says it
     stores is a claim. -->
<!-- rule: one row per (element, purpose). One element serving two purposes is two rows with
     two lawful bases, because purpose limitation is enforced per purpose. -->
<!-- rule: a hash of an enumerable identifier (an email, a phone number) is pseudonymous, not
     anonymous: the input space can be enumerated, so the value re-identifies. Treat it as
     personal data in storage, exports and retention. Anonymous means no re-identification
     key exists anywhere. -->
<!-- rule: privacy is a protected attribute - never waivable, never fast-skippable. -->

Version: <n> | Date: <YYYY-MM-DD> | Owner: <name> | Modules: <ids>

## 1. Inventory

| Data element | Category | Subject | Lawful basis | Purpose | Collection point | Storage location(s) | Retention | Deletion mechanism | Processors | Cross-border transfer |
|---|---|---|---|---|---|---|---|---|---|---|
| EXAMPLE email | direct identifier | customer | contract | account login | POST /signup | pg.users, search index, backups | 30 d after account closure | test `erasure-email` | mail provider | US, standard contractual clauses |
| EXAMPLE dispute reason text | content, may contain special category | customer | legitimate interest (balancing note in DPIA-001) | resolve a refund dispute | POST /disputes | pg.disputes | 24 months | test `erasure-dispute` | none | none |

<!-- rule: Category is one of - direct identifier, quasi-identifier, content, derived or
     inferred, special category (health, biometric, ethnicity, political, sexual
     orientation, criminal). Special category forces the module's `privacy` tier to high or
     critical and forces a DPIA. -->
<!-- rule: Deletion mechanism names a TEST id, not a procedure. An erasure path with no test
     is an intention; the test is what proves the data is gone from every store in the row. -->

## 2. Minimisation decisions

<!-- rule: apply in this order - do not collect it; collect it coarser (age band, not birth
     date; region, not GPS); collect it for a shorter time; collect it pseudonymised. Record
     the option you rejected and why. "The product asked for it" is not a purpose. -->

| Element | Option chosen | Options rejected | Why |
|---|---|---|---|
| EXAMPLE location | region code | exact GPS, city | fraud scoring needs country-level signal only; GPS adds re-identification risk with no accuracy gain |

## 3. Consent and withdrawal

| Purpose | Capture point | Consent record | Withdrawal path | Propagation deadline |
|---|---|---|---|---|
| EXAMPLE product emails | signup checkbox, unticked by default | pg.consents (versioned text) | one click in every message | 24 h to every processor |

## 4. Subject rights

<!-- rule: rights are endpoints with budgets, not a support process. Record the budgets as
     an `NFR-PRIV-<NNN>` with numbers so spec-lint accepts them. -->

| Right | Endpoint | Requester authentication | Acknowledgement budget | Fulfilment budget | Test id |
|---|---|---|---|---|---|
| Access | EXAMPLE GET /me/data | session + re-authentication | 72 h | 30 days | `rights-access` |
| Rectification | EXAMPLE PATCH /me | session | 72 h | 30 days | `rights-rectify` |
| Erasure | EXAMPLE DELETE /me | session + re-authentication | 72 h | 30 days | `erasure-email` |
| Portability | EXAMPLE GET /me/export (JSON) | session + re-authentication | 72 h | 30 days | `rights-export` |
| Objection / restriction | EXAMPLE POST /me/restrict | session | 72 h | 30 days | `rights-restrict` |

## 5. DPIA trigger checklist

<!-- rule: any box ticked means write docs/privacy/DPIA-<NNN>.md before the change ships.
     Record the date checked even when nothing is ticked - a negative result is evidence. -->

- [ ] special-category data processed
- [ ] systematic monitoring of a publicly accessible area
- [ ] large-scale profiling with a legal or similarly significant effect
- [ ] automated decision-making without human review
- [ ] children's data
- [ ] biometric identification
- [ ] data matched across previously separate datasets
- [ ] new cross-border transfer
- [ ] new processor with access to raw identifiers

Checked by: <name> | Date: <YYYY-MM-DD> | Result: <no DPIA required | DPIA-NNN>

## 6. Logging rule

<!-- rule: a raw identifier (email, phone, national id, passport, address, full name, card,
     IBAN) never reaches a log sink. Emit a stable pseudonymous id plus a correlation id.
     The `no-pii-in-logs` fitness rule fires on the pattern and accepts lines that hash,
     mask, redact or pseudonymise - use those helpers instead of a suppression comment. -->

Allowed in logs: EXAMPLE `user_ref` (HMAC, key held by the identity service), `request_id`,
`tenant_id`, coarse country code, status codes, durations.

## 7. Deletion proof

<!-- rule: one row per store named anywhere in section 1, including replicas, search index,
     cache, analytics warehouse, object storage, outbound processors and backups. An
     erasure test that checks the primary store only proves nothing about the copies. -->

| Store | Erasure path | Test id | Backup horizon |
|---|---|---|---|
| EXAMPLE pg.users | cascade delete on subject id | `erasure-email` | 35 d; restore test asserts absence or that the backup is past its horizon |

## Verification

```sh
node .dsh/base/dsb.mjs fitness --all # no-pii-in-logs, exit 1 on a raw identifier in a log
node .dsh/base/dsb.mjs attributes    # a blocking privacy tier with no claiming check is exit 1
node .dsh/base/dsb.mjs trace         # the NFR-PRIV ids are cited by code and tests
node .dsh/base/dsb.mjs gate          # BLOCKED on a privacy check means uncovered processing
```
