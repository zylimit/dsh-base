---
name: reliability-slo
description: Use when defining or changing SLIs, SLOs, error budgets, alerts or runbooks, or when a change affects correctness under partial failure or test flakiness.
whenToUse: When a user-facing capability needs a measurable reliability target, or when an alert, runbook or flaky test is in question.
---

## Purpose

Make reliability a number with a consequence. Produces `docs/nfr/RELIABILITY.md` (SLI/SLO table, error budget policy, observability contract) and one runbook per alert. An SLO without an error-budget consequence is decoration; an alert without a runbook is a pager loop.

## When this fires

- A user-facing capability ships, changes its failure envelope, or gains a new dependency.
- An alert is added, changed or fires without a runbook.
- `node .dsh/base/dsb.mjs fitness --all` reports `no-silent-failure` (exit 1).
- A test is quarantined, or a suite fails intermittently.
- A module declares `reliability` or `availability` at `critical` or `high` with no SLI defined.
- The user invokes `/reliability-slo`.

## Procedure

1. Enumerate user-facing capabilities (what a user is trying to accomplish), not endpoints. "Place an order", not "POST /orders".
2. Define exactly one primary SLI per capability as a ratio: `good events / valid events`. Write both sets explicitly - which events are valid (excluding, for example, malformed client requests) and which are good (status < 500 and latency <= 300 ms). An SLI that cannot be computed from existing telemetry is not yet an SLI; name the metric to add.
3. Cover the four golden signals per capability - latency, traffic, errors, saturation - and state which method you use where: RED (Rate, Errors, Duration) for request-driven services, USE (Utilisation, Saturation, Errors) for resources (CPU, pool, disk, queue).
4. Set the SLO: target plus rolling window, for example `99.5 percent over 28 days`. Derive the error budget: `(1 - target) * valid events`. Record it as `NFR-REL-<NNN>` with numbers so `node .dsh/base/dsb.mjs spec-lint` accepts it (NFR without a metric = error, exit 1).
5. Write the error-budget policy with a consequence that is actually enforced: when the budget is exhausted, feature work on that capability freezes until the trailing window recovers; only reliability work, rollbacks and incident fixes merge. Name who declares the freeze and who lifts it.
6. Alert on burn rate, not on single failures. Use two windows, for example: page at 14.4x burn over 1 h (2 percent of a 28-day budget), ticket at 6x over 6 h. Every alert names its runbook path.
7. Specify correctness under partial failure. For each write path, state the effect model: at-most-once, at-least-once, or exactly-once-effect via idempotency key plus a dedupe store with a stated retention. State what a client sees on a timeout whose write actually landed, and how it reconciles (idempotent retry, status query, or reconciliation job).
8. Declare data-integrity invariants as assertions, not prose: "sum(ledger.debits) == sum(ledger.credits) per account per day", "no order without a payment row", "no event with a timestamp in the future". Each invariant gets a continuous checker (job cadence, alert, owner) and a test. Name the checker in the SLO table.
9. Enforce error visibility: no swallowed exceptions. `no-silent-failure` (exit 1) catches empty catch blocks and bare `except: pass`; the correction is to handle the error or propagate it with context. A caught error that is intentionally ignored must say so in the same line or the line above, with the reason.
10. Apply the flake policy. A flaky test is a defect against the system or the test, never noise:

    | Step | Obligation |
    | --- | --- |
    | Detect | Same commit, both outcomes, or failure not reproducible on re-run |
    | Classify | Product race, test race, environment, prerequisite (see `test-strategy`) |
    | Quarantine | Allowed only with an owner and an expiry date recorded in the test file |
    | Expire | At expiry the test is fixed or deleted; a quarantined test is never renewed silently |

    A quarantined test does not count toward requirement coverage.
11. Enforce determinism: no wall-clock sleeps, no real network, no shared mutable fixtures, seeded randomness, injected clock. A test that needs a sleep to pass is asserting on timing it does not control.
12. Verify: `node .dsh/base/dsb.mjs trace` (exit 1 if any `NFR-REL-` id has no test referencing it) then `node .dsh/base/dsb.mjs gate` (exit 2). `node .dsh/base/dsb.mjs risk` reports `FAIL_STREAK` when a check failed three times in a row - that is a root-cause signal, not a retry signal.

## Output contract

`docs/nfr/RELIABILITY.md`:

```
## 1. SLI/SLO table
   capability | SLI (good/valid) | metric source | SLO target | window | budget | burn alerts | owner | NFR id
## 2. Golden signals
   capability | latency metric | traffic metric | error metric | saturation metric | dashboard
## 3. Error-budget policy
   trigger | consequence | who declares | who lifts | exceptions
## 4. Effect model
   write path | effect semantics | idempotency key | dedupe store + retention | client reconciliation
## 5. Integrity invariants
   invariant | assertion | checker cadence | alert | test id
## 6. Observability contract
   signal | required fields | retention | owner
## 7. Quarantine register
   test id | first seen | classification | owner | expiry
```

Observability contract minimum: structured logs (JSON) carrying `trace_id`, `span_id`, `request_id`, `capability`, `outcome`, and no raw identifiers (see `no-pii-in-logs`); one metric per SLI numerator and denominator; traces propagated across every process boundary listed in the dependency table; one runbook per alert at `docs/runbooks/<alert-name>.md` containing symptom, first diagnostic query, three most likely causes, mitigation, rollback, escalation contact.

## Stop conditions

Halt and ask the human when:

- The error budget is exhausted and the change in hand is feature work. Report the freeze; do not merge around it.
- An SLI cannot be computed because the telemetry does not exist and adding it is out of scope.
- A proposed SLO target implies a dependency SLA the dependency does not offer (for example 99.99 percent on top of a 99.9 percent provider without redundancy).
- An alert exists with no owner willing to be paged for it - remove the alert or find the owner; an unowned page trains people to ignore pages.
- A test has been quarantined past its expiry and someone proposes extending it again.

## Anti-patterns

| Failure mode | Correction |
| --- | --- |
| SLO stated as "high availability" | Ratio, target, window, budget, consequence. |
| Availability measured from the server's own uptime | Measure from the client's valid events; a server that is up and returning 500s is down. |
| Alert on every error | Alert on error-budget burn rate with two windows; single-error alerts train alert blindness. |
| Retry loop that hides a permanent failure | Distinguish retryable from terminal; a terminal error must surface with context (`no-silent-failure`). |
| Exactly-once claimed over an at-least-once transport | Claim exactly-once-effect via idempotency key plus dedupe store, and state the dedupe retention. |
| Flaky test re-run until green in CI | Classify it as a defect, quarantine with owner and expiry, and fix or delete at expiry. |
| Runbook that says "investigate the logs" | Give the exact query, the three likeliest causes and the mitigation with its rollback. |
| Integrity invariant asserted only in a unit test | Run it continuously against production data with a cadence, an alert and an owner. |
