---
name: resilience-engineering
description: Use when a change adds an outbound call, a queue, a cache, a retry, a background worker, or when a module declares resilience or availability at high or critical.
whenToUse: When designing or reviewing failure behaviour, capacity headroom or recovery for a dependency-crossing path.
---

## Purpose

Keep the system serving under attack, fault, surge and disaster, and make recovery a measured procedure rather than an improvisation. Produces the resilience section of `docs/nfr/` (`docs/nfr/RESILIENCE.md`): a tactics table per dependency, hard limits with numbers, a surge target with the load test that proves it, and RTO/RPO with the restore drill that proves them.

## When this fires

- A change adds or modifies an outbound call, retry, queue, cache, connection pool, thread pool, background worker or cron.
- `node .dsh/base/dsb.mjs fitness --all` reports `no-unbounded-retry` or `no-unbounded-resource` (these fire only in modules whose `resilience` tier is `high` or `critical`).
- An incident postmortem names saturation, retry amplification, cascading failure or an unbounded buffer.
- A dependency is added, replaced, or its SLA changes.
- The user invokes `/resilience-engineering`.

## Procedure

1. List the dependency graph for the affected modules: `node .dsh/base/dsb.mjs impact` (exit 3 = no catalog). For each edge leaving the process, record: dependency, call site `path:line`, criticality (required / degradable / optional), current timeout, current retry policy, current concurrency limit.
2. Apply the tactics catalog. Each cell you claim must name a mechanism in code, not an intention:

   | Stage | Tactics | Question it answers |
   | --- | --- | --- |
   | Detect | Health checks, heartbeats, timeouts, anomaly thresholds, synthetic probes, saturation signals (queue depth, pool waits) | How fast do we know? |
   | Resist | Bulkheads, circuit breakers, rate limits and quotas, admission control, load shedding, backpressure, idempotency keys, hedged requests with a cap | How do we stay up while it is broken? |
   | Recover | Retry with bound + exponential backoff + full jitter, failover, replication and quorum, replay from durable log, restore from backup, reconciliation jobs | How do we get back? |
   | Adapt | Feature flags and kill switches, autoscaling policy, capacity review cadence, chaos experiments, postmortem actions with owners | How do we stop repeating it? |

3. Enforce the hard rules. Each is decidable and each has an owner check:

   | # | Rule | How it is checked |
   | --- | --- | --- |
   | R1 | Every outbound call sets an explicit timeout (connect and read) | `no-unbounded-resource` + review |
   | R2 | Every retry has a max attempt count, exponential backoff and full jitter | `no-unbounded-retry` + review |
   | R3 | Retries are only for idempotent operations, or carry an idempotency key | prompt-only, reviewer checks the call site |
   | R4 | Every queue, channel and buffer has a declared maximum size and an overflow policy | prompt-only, reviewer checks the constructor |
   | R5 | Every cache has a maximum size and a TTL | prompt-only, reviewer checks the constructor |
   | R6 | Every dependency declares a degraded mode (what the caller returns when it is down) | table row in `docs/nfr/RESILIENCE.md` |
   | R7 | Retry budget: total retries capped as a fraction of request volume (for example 10 percent) | metric + alert, named in the runbook |
   | R8 | Every breaker declares open threshold, half-open probe rate and reset condition | table row |

   Run `node .dsh/base/dsb.mjs fitness --all` (exit 1). If the module's `resilience` tier is below `high`, R1/R2 are not machine-checked - say "prompt-only" in the review note rather than implying coverage.
4. Backoff formula, stated once: `sleep = random(0, min(cap, base * 2^attempt))` (full jitter). Deadline propagation overrides attempts: when the caller's remaining deadline is under the next sleep, stop retrying and fail fast.
5. Size the surge target as numbers, not adjectives: steady-state RPS, peak RPS, burst factor (peak/steady), concurrent connections, payload p99 size, and the duration the peak must be sustained. Write them as an `NFR-RES-<NNN>` with units so `node .dsh/base/dsb.mjs spec-lint` accepts it (an NFR without a metric is an error, exit 1).
6. Prove the surge target with a load test that asserts: p99 latency below target, error rate below target, no unbounded queue growth, and recovery to steady state within a stated time after the burst ends. Register it as a check claiming `resilience` and `performance` so `node .dsh/base/dsb.mjs attributes` stops reporting a gap (exit 1).
7. Declare recovery targets per data store and per capability: RTO (time to restore service) and RPO (tolerable data loss window). A target with no drill is an aspiration.
8. Run the restore drill and record it: restore the newest backup into a scratch environment, measure wall-clock time to a working read path, verify integrity against a checksum or row-count invariant, and record actual RTO/RPO against target. Schedule the cadence and name the owner. A backup that has never been restored is not a backup.
9. Design chaos experiments as hypotheses: "with dependency X returning 500 for 5 minutes, checkout continues at reduced functionality and error budget burn stays under Y". State steady-state metric, blast radius, abort condition and rollback before running. Never run one without an abort condition.
10. Close: `node .dsh/base/dsb.mjs gate` (exit 2 = blocking failure). Record the degraded-mode table in the module's `AGENTS.md` under `Invariants` so the next agent that touches the module loads it automatically.

## Output contract

`docs/nfr/RESILIENCE.md`:

```
# Resilience - <system>
Owner: <name> | Date: <ISO> | Modules: <catalog ids>

## 1. Dependency table
   dependency | call site | criticality | timeout (connect/read) | retries (max/base/cap/jitter) | breaker (open/half-open/reset) | bulkhead limit | degraded mode | NFR id
## 2. Limits table
   resource | max size | overflow policy | TTL | owner
## 3. Capacity target
   steady RPS | peak RPS | burst factor | concurrency | sustain duration | p99 latency target | error-rate target | load test id
## 4. Recovery
   capability/store | RTO target | RPO target | last drill date | measured RTO | measured RPO | drill owner
## 5. Chaos experiments
   hypothesis | steady-state metric | blast radius | abort condition | last run | outcome
## 6. Degradation matrix
   dependency down | user-visible behaviour | feature flag | alert | runbook path
```

Every row in section 1 must have a non-empty timeout and degraded mode; an empty cell is a defect, not a gap in documentation.

## Stop conditions

Halt and ask the human when:

- A required dependency has no viable degraded mode: the capability simply stops. That is a product decision about acceptable downtime.
- The measured RTO exceeds the target by more than 2x, or a restore drill fails integrity verification.
- A load test cannot be run against a representative environment; do not substitute a laptop benchmark and call the target proven.
- Adding a limit (queue bound, rate limit) would start rejecting traffic that is currently accepted. Rejection policy is a business decision.
- An incident is in progress. Stabilise first with the humans; write the analysis afterwards.

## Anti-patterns

| Failure mode | Correction |
| --- | --- |
| Retry loop with no cap ("it will succeed eventually") | Bound attempts, add exponential backoff with full jitter, and propagate the caller's deadline. |
| Retry without jitter | Synchronised clients retry in lockstep and re-saturate the dependency; use full jitter. |
| Retrying a non-idempotent write | Attach an idempotency key with a server-side dedupe window, or do not retry. |
| Unbounded in-memory queue as a buffer | Bound it and choose an explicit overflow policy: shed, block with backpressure, or spill to durable storage. |
| Timeout longer than the caller's own deadline | Derive inner timeouts from the remaining deadline; otherwise the caller is already gone. |
| Circuit breaker with no half-open probe | Define open threshold, probe rate and reset condition, or it becomes a permanent outage. |
| Health check that returns 200 whenever the process is alive | Check the dependencies the request path needs; a liveness probe is not a readiness probe. |
| Capacity target stated as "should scale" | Numbers with units and a load test id; `spec-lint` rejects unmeasurable NFRs (exit 1). |
