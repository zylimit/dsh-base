# Product specification - <system name>

<!-- rule: copy to docs/requirements/PRODUCT-SPEC.md. Delete every EXAMPLE block before the
     first review; keep the rule comments until the document is stable. -->
<!-- rule: `node .dsh/base/dsb.mjs spec-lint` is the acceptance test for this document.
     Error (exit 1): a placeholder token; a requirement with no normative keyword
     (SHALL / MUST); an `NFR-` with no number and unit; a requirement with no acceptance
     criteria; a duplicate id; a document set that never mentions security, safety, privacy,
     resilience and reliability. Warning: an ambiguous adjective (user-friendly, robust,
     scalable, efficient, appropriate, reasonable, flexible, as needed, best effort,
     if possible, as fast as possible) or a `REQ-` with no EARS trigger.
     Non-normative prose is not a requirement - keep it in sections 1-6. -->
<!-- rule: spec-lint reads the 14 lines that follow an id. Keep the normative sentence, the
     trigger, the metric and the acceptance criteria inside that window or they are unseen. -->
<!-- rule: any edit here updates docs/requirements/PRODUCT-SPEC-CHANGELOG.md in the same turn. -->

Version: <n.n> | Date: <YYYY-MM-DD> | Owner: <name> | Status: <draft | approved>

## 1. Purpose

<!-- rule: one paragraph: the problem, who has it, the workaround this system replaces. -->

EXAMPLE: Support agents reconcile refunds in a spreadsheet and 3% are issued twice. This
service issues and records refunds so that a duplicate is structurally impossible.

## 2. Scope and non-goals

<!-- rule: "Out of scope" is the load-bearing list - it is what a later reader uses to
     reject a request. Each non-goal names the condition that would reverse it. -->

In scope: <capability list>
Out of scope: <item> - reversed when <condition>
EXAMPLE: partial refunds - reversed when finance signs off on the tax rules.

## 3. Target users and jobs

| Role | Job to be done | Trigger | Frequency | Observable outcome |
|---|---|---|---|---|
| EXAMPLE support agent | refund a disputed charge | customer opens a dispute | 40/day | refund visible in the statement within 1 business day |

## 4. Capabilities

<!-- rule: ranked verb-object list. Every capability maps to at least one REQ below; a
     capability with no REQ is a slogan, a REQ with no capability is unrequested scope. -->

1. EXAMPLE Issue a refund against a settled payment -> REQ-REFD-001, REQ-REFD-002

## 5. User journeys

<!-- rule: numbered steps with the state after each, plus the failure path. A journey
     without its failure path hides the requirements that matter most. -->

Journey J1 - EXAMPLE issue a refund
1. Agent submits. State: request persisted `pending`, idempotency key stored.
2. Provider confirms. State: refund `settled`, audit event emitted.
Failure path: provider times out at step 2 - the refund stays `pending` and is retried under
REQ-REFD-004 with the same key, never with a new one.

## 6. Technical constraints

<!-- rule: named versions, named systems, named limits. "Modern stack" is not a constraint. -->

| Constraint | Value | Source |
|---|---|---|
| EXAMPLE upstream | Payments API v3, 20 rps per tenant | provider contract |

## 7. Functional requirements

<!-- rule: EARS form, id `REQ-<AREA>-<NNN>` - AREA is 2-6 uppercase letters, NNN is 3-4
     digits. Ids are append-only: never renumber, never reuse. A superseded requirement
     keeps its id and gains "Status: superseded by REQ-...". EARS patterns: ubiquitous /
     event-driven WHEN / state-driven WHILE / unwanted IF-THEN / optional WHERE. -->
<!-- rule: acceptance criteria are Given/When/Then with observable values - status codes,
     timings, stored state. "Works correctly" is not an acceptance criterion. -->

### REQ-REFD-001 - Refund idempotency (EXAMPLE)
WHEN a refund request carries an idempotency key that was already accepted, the service
SHALL return the original refund record and MUST NOT issue a second provider call.
Priority: P0 | Attributes: safety, reliability | Source: finance review 2026-01-14
Acceptance:
  Given a refund accepted with key `k-1`
  When POST /refunds is called again with key `k-1`
  Then the response is 200, carries the original refund id, and the provider call count
  for that key stays at 1

### REQ-<AREA>-<NNN> - <decision> (copy the block above)

## 8. Non-functional requirements

<!-- rule: id `NFR-<ATTR>-<NNN>`, ATTR exactly one of RES SEC SAFE PRIV REL AVAIL PERF MAINT.
     Every entry carries a number and a unit inside the 14-line window, or spec-lint fails
     with NO_METRIC. A latency number without a load context is noise. -->
<!-- rule: the module owning the behaviour declares the matching attribute tier in
     .dsh/base/catalog.json, and a check claiming that attribute must sit in its
     verification list - otherwise the gate returns BLOCKED_BY_ATTRIBUTES. -->

### NFR-PERF-001 - Refund submission latency (EXAMPLE)
The service SHALL answer POST /refunds within 300 ms at p95 while sustaining 50 concurrent
requests for 10 minutes.
Verification: k6 scenario `refund-submit` against the staging dataset, wired as a check.
Acceptance:
  Given the staging dataset of 100000 charges
  When the scenario runs for 600 s at 50 virtual users
  Then p95 is at most 300 ms and the error rate is at most 0.1%

### NFR-<ATTR>-<NNN> - <target> (copy the block above)

## 9. Success criteria

<!-- rule: outcome metrics with baseline, target, measurement and date. Not a restatement
     of the NFRs. -->

| Metric | Baseline | Target | Measured by | Date |
|---|---|---|---|---|
| EXAMPLE duplicate refunds | 3% of refunds | 0 in 30 days | monthly reconciliation | 2026-06-30 |

## 10. Open questions

<!-- rule: every open question carries an owner and a date; without both it is a silent
     assumption. Never park an item here to dodge a decision - offer 2-3 concrete options
     with tradeoffs and record the rejected one in the changelog. -->

| # | Question | Blocks | Owner | Due |
|---|---|---|---|---|
| Q1 | EXAMPLE which lawful basis covers the dispute reason text | REQ-REFD-005 | privacy officer | 2026-02-20 |
