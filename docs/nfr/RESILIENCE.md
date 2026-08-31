# Resilience

Attribute id `resilience`. Declared per module in `.dsh/base/catalog.json`, gated by `node .dsh/base/dsb.mjs attributes` and `gate`.
Related: [SECURITY.md](./SECURITY.md) · [SAFETY.md](./SAFETY.md) · [PRIVACY.md](./PRIVACY.md) · [RELIABILITY.md](./RELIABILITY.md) · [../LARGE-REPO-GUIDE.md](../LARGE-REPO-GUIDE.md) · [../QUALITY-ATTRIBUTES.md](../QUALITY-ATTRIBUTES.md) · [../../AGENTS.md](../../AGENTS.md)

## 1. Definition

Resilience is the measured ability of a system to keep delivering its required function while under attack, fault, surge or disaster, and to return to nominal function within a stated time. It is evaluated **under disturbance**: injected faults, arrival rates past the knee, a lost dependency, a lost data store.

Resilience is **not**:

| Not this | Because |
|---|---|
| Availability | Availability is the outcome ratio (good time / valid time), see [RELIABILITY.md](./RELIABILITY.md). Resilience is the mechanism set that produces it under disturbance. |
| Reliability | Reliability is correct continuous operation under nominal conditions. Resilience starts where nominal ends. |
| Performance | Performance is latency and throughput at nominal load. Resilience is behaviour past saturation. |
| Redundancy | Two replicas sharing one failure mode (same config push, same expiring certificate, same poison message) are one component. |
| Retry | Unbounded retry is a resilience **defect**: it converts a dependency blip into a self-inflicted outage. |
| A runbook | A recovery procedure that has never been executed is a hypothesis, not a capability. |

## 2. Failure modes defended against

1. Metastable failure: load drops back to nominal, the system stays down because retries sustain the overload.
2. Retry amplification: three layers each retrying three times equals 27 requests per user action.
3. Cascading failure through a shared thread, connection or socket pool.
4. Head-of-line blocking: one slow tenant, partition or message stalls a whole queue.
5. Unbounded queue growth converting a latency problem into an out-of-memory kill.
6. Thundering herd and cache stampede after eviction, restart or coordinated TTL expiry.
7. Timeout inversion: the caller gives up before the callee, so work is done and discarded, then repeated.
8. Slow dependency saturating every worker while returning HTTP 200.
9. Poison message redelivered forever with no dead-letter path; correlated failure from one global change (config, certificate, quota); split brain after failover; a backup that has never been restored.

## 3. Tactics

Cost is engineering plus operational cost, rated low / medium / high.

### 3.1 Detect

| Tactic | What it prevents | How to implement | How to verify | Cost |
|---|---|---|---|---|
| Deadline per call | Indefinite wait, worker exhaustion | Absolute deadline created at ingress, propagated in context/header, decremented per hop | Unit test asserting abort at T±tolerance; `fitness` rule `no-unbounded-resource` | low |
| Liveness / readiness split | Restart loops and mass eviction on a dependency blip | Liveness checks process invariants only; readiness checks capacity to serve | Integration test: kill dependency, assert readiness false and liveness true | low |
| Saturation telemetry | Learning about overload from users | Export queue depth, pool in-use, in-flight count, GC pause, thread starvation | Metric exists and alert rule is unit-tested against a replayed series | low |
| Synthetic transaction | Silent partial outage | External probe running write, read, delete end to end | Fault drill: probe alarms within the declared detection budget | medium |

### 3.2 Resist

| Tactic | What it prevents | How to implement | How to verify | Cost |
|---|---|---|---|---|
| Timeout on every outbound call | Worker pool exhaustion | HTTP, RPC, DB, cache, queue, lock and file calls all take an explicit timeout | `fitness` `no-unbounded-resource`; client contract test | low |
| Bounded retry, exponential backoff, full jitter | Retry storms, synchronised herds | `sleep = random(0, min(cap, base * 2^attempt))`; max attempts; retry only idempotent operations | `fitness` `no-unbounded-retry`; unit test asserting attempt count and jitter distribution | low |
| Retry budget | Amplification across layers | Token bucket: retries capped at a fraction of successes in a rolling window; over budget means fail fast | Load test with an injected 50 % error rate: total attempts stay under the budget | medium |
| Circuit breaker | Hammering a dead dependency | Thresholds for open, cooldown, half-open probe count; per dependency, never global | Fault-injection test: breaker opens within N failures and recovers on the half-open probe | medium |
| Bulkhead | One dependency consuming all capacity | Separate pools and queues per dependency class and per tenant class | Saturate one dependency, assert other endpoints keep serving | medium |
| Load shedding and admission control | Collapse past the knee | Reject early with 429/503 plus `Retry-After` when in-flight or queue depth exceeds a limit; priority classes | Surge test at burst factor: shed rate and p99 stay within target | medium |
| Backpressure | Unbounded buffering | Bounded channels, blocking or dropping producers, consumer-driven pull, flow control | Producer/consumer test: memory stays bounded when the consumer stalls | medium |
| Idempotency keys | Duplicate side effects from retries | Client-supplied key stored with the effect for a declared dedupe window | Replay the same request 100×, assert exactly one effect | medium |
| Single-flight and jittered TTL | Cache stampede | Coalesce concurrent misses to one origin call, randomise TTL, serve stale while revalidating | Concurrency test: N concurrent misses produce one origin call | low |

### 3.3 Recover

| Tactic | What it prevents | How to implement | How to verify | Cost |
|---|---|---|---|---|
| Graceful degradation behind flags | All-or-nothing outage | Named degraded modes; flag flips path to cached, partial or read-only responses | Test asserting the degraded **response**, not an exception (see `no-silent-failure`) | medium |
| Dead-letter queue plus replay | Poison-message loops | Redelivery cap, then move to DLQ with cause; replay tool with dedupe | Inject a poison message: it lands in the DLQ within the cap and replay is idempotent | medium |
| Failover with quorum | Split brain | Odd-sized quorum, fencing tokens, single writer, explicit promotion rule | Partition drill: exactly one writer survives; failover time measured | high |
| Backup with restore drill | A backup that restores nothing | Scheduled restore into an isolated environment, verified by a data assertion | Drill record with measured restore duration and verified row/records count | high |

### 3.4 Adapt

| Tactic | What it prevents | How to implement | How to verify | Cost |
|---|---|---|---|---|
| Capacity model plus periodic load test | Guessed headroom | Open-model load generator, documented saturation point and headroom factor | Load report attached as gate evidence | medium |
| Dependency-failure injection | Untested failure paths | Proxy-level latency, error and partition injection per dependency | Named injection test per declared dependency failure mode | medium |
| Chaos experiment | Unknown correlated failure | Steady-state hypothesis, blast radius, abort condition, scheduled game day | Experiment record: hypothesis, injection, observation, action items | high |

## 4. Hard rules

Each rule is decidable yes/no. `M` = machine-enforced with the named check, `P` = prompt-only (reviewer must answer it).

1. **M** (`fitness` / `no-unbounded-resource`, warning severity, only for modules declaring `resilience: high|critical`) — every outbound call passes an explicit timeout, deadline or abort signal.
2. **P** — timeout budgets decrease inward: a caller's timeout is greater than the sum of the timeouts it awaits, and no callee outlives its caller's deadline.
3. **M** (`fitness` / `no-unbounded-retry`) — no retry loop without a maximum attempt count, exponential backoff and full jitter.
4. **P** — retries are applied only to idempotent operations, or to operations carrying an idempotency key.
5. **P** — every retrying client is covered by a retry budget expressed as a percentage of successful calls in a rolling window.
6. **P** — every remote dependency has a circuit breaker with written open threshold, cooldown and half-open probe count.
7. **P** — no two dependency classes share one connection or thread pool.
8. **M** (`fitness` / `no-unbounded-resource` for buffers reached through the scanned call sites; otherwise **P**) — every queue, cache, buffer and in-memory batch declares a maximum size and a drop-or-block policy.
9. **P** — the service sheds load before saturation and returns a typed rejection with `Retry-After`; it never queues indefinitely to appear healthy.
10. **P** — every state-changing endpoint accepts an idempotency key and declares its dedupe window.
11. **P** — every degraded mode is reachable by a flag and covered by a test asserting the degraded response.
12. **P** — every declared dependency has a written failure mode (fail-closed, fail-open, degraded) and one injection test that exercises it.
13. **P** — a backup counts only after a restore drill at the declared cadence produced a measured restore time and a data assertion.
14. **P** — chaos experiments declare a steady-state hypothesis, a blast radius and an abort condition before execution.
15. **P** — load tests use open-model generation; closed-loop results are rejected because they hide coordinated omission.
16. **M** (`attributes`, exit 2 `BLOCKED_BY_ATTRIBUTES`) — a module declaring `resilience: high` or `critical` has at least one passing check claiming `resilience`.

## 5. Measurable targets

Every `NFR-RESILIENCE-<NNN>` requirement carries at least one metric from this table with a unit, a trigger and an acceptance criterion. Values below are **placeholders**, not measurements.

| Metric | Unit | Placeholder | Note |
|---|---|---|---|
| Peak arrival rate | requests/second | 1500 | Sustained, measured at ingress |
| Concurrency | in-flight requests | 400 | Not thread count |
| Burst factor | × nominal for D seconds | 3× for 120 s | Defines the surge test |
| p99 latency under surge | milliseconds | 400 | Open-model generator |
| Shed rate under surge | percent | ≤ 5 | Typed 503 with `Retry-After` |
| Retry budget | percent of successes | ≤ 10 | Rolling 60 s window |
| MTTR | minutes | ≤ 30 | Detection to nominal |
| RTO | minutes | ≤ 60 | Disaster to service restored |
| RPO | seconds | ≤ 300 | Maximum tolerable data loss |

EARS form example: *When the sustained arrival rate reaches 3× nominal for 120 s, the `api` module SHALL hold p99 ≤ 400 ms and shed at most 5 % of requests with HTTP 503 and `Retry-After`.* Acceptance: open-model load test `load-surge` reports p99 and shed rate inside the target.

## 6. How it is gated here

| Mechanism | Command | Effect |
|---|---|---|
| Anti-pattern scan | `node .dsh/base/dsb.mjs fitness --all` | Reports `no-unbounded-retry` and `no-unbounded-resource`. Both are **warning** severity, so they do not by themselves set exit 1; error-severity rules do. Treat warnings as review items, not as noise. |
| Tier gate | `node .dsh/base/dsb.mjs attributes` | `resilience: high|critical` without a passing claiming check blocks; a claiming check that FAILs or is BLOCKED is counter-evidence and also blocks |
| Proof | `node .dsh/base/dsb.mjs gate` | Exit 2 on a blocking failure, exit 3 when degraded, exit 4 on stale evidence |
| Decay | `node .dsh/base/dsb.mjs risk` | Flags an attribute declared at a blocking tier that no check claims |
| Static composite | `node .dsh/base/dsb.mjs dod` | Runs the static set; behavioural proof still requires `gate` |

Scope note: both resilience fitness rules carry `minimumTier: high`. They scan a file **only** when the file classifies into a module whose `attributes.resilience` is `high` or `critical`. A module that under-declares its tier silences the rules. Suppression comment is `dsb-fitness:ignore` on the finding line or the line above; extra rules may be added in `.dsh/base/fitness-rules.json`.

Candidate external tools (none are shipped or required by this repository; register the one you adopt as a check in `catalog.json`): k6, Vegeta or Locust for open-model load; Toxiproxy for latency and fault injection; Chaos Mesh, LitmusChaos or AWS FIS for chaos experiments; Pumba for container-level faults.

What a module declares in `catalog.json`:

```json
{
  "id": "api",
  "paths": ["src/api/**"],
  "layer": "domain",
  "riskTier": "high",
  "dependsOn": ["store"],
  "attributes": { "resilience": "high", "reliability": "high" },
  "verification": ["unit", "load-surge", "fault-injection"]
}
```

with the claiming checks defined once at catalog level, for example `"load-surge": { "command": "k6 run tests/load/surge.js", "class": "test", "attributes": ["resilience", "performance"] }`. A module that declares `resilience: minimal` or `none` must carry an `attributeReasons.resilience` string; `catalog-lint` fails with `UNJUSTIFIED_TIER` otherwise.

## 7. Anti-patterns

| Anti-pattern | Why it fails |
|---|---|
| `while (true) { reconnect() }` | Metastable failure; the client becomes the outage |
| Caller timeout longer than callee timeout | Work completes and is thrown away, then repeated |
| Unbounded queue "so nothing is lost" | Trades a fast typed rejection for an out-of-memory kill and total loss |
| Health check returning 200 unconditionally | Detection is now impossible; failover never triggers |
| Fallback returning empty results silently | Masks the outage and violates `no-silent-failure`; degrade loudly and label the response |
| Autoscaling as the answer to a stampede | Scaling latency exceeds collapse latency; shed first, scale second |
| Backup job green, restore never attempted | Unproven recovery; RTO and RPO are then guesses |
