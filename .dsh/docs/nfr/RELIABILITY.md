# Reliability

Attribute id `reliability`.
Related: [RESILIENCE.md](./RESILIENCE.md) · [SECURITY.md](./SECURITY.md) · [SAFETY.md](./SAFETY.md) · [PRIVACY.md](./PRIVACY.md) · [../LARGE-REPO-GUIDE.md](../LARGE-REPO-GUIDE.md) · [../QUALITY-ATTRIBUTES.md](../QUALITY-ATTRIBUTES.md) · [../../AGENTS.md](../../AGENTS.md)

## 1. Definition

Reliability is the probability that the system performs its required function correctly and continuously over a stated interval, under stated conditions. It is measured as a ratio of good events to valid events over a rolling window, not as an opinion about code quality.

Reliability is **not**:

| Not this | Because |
|---|---|
| Resilience | Resilience is behaviour under disturbance ([RESILIENCE.md](./RESILIENCE.md)). Reliability is the outcome over time, including undisturbed time. |
| Uptime of a process | A process that is up and returning wrong answers is unreliable and looks available. |
| Test pass rate | Tests measure what was exercised. Reliability is measured in production. |
| 100 % | A target of 100 % removes the error budget, which removes the ability to ship. State a target below 100 % and mean it. |

## 2. Failure modes defended against

1. Silent corruption: an error swallowed, a partial write committed, an empty result treated as success.
2. Duplicate effects from at-least-once delivery: double charge, double dispatch, double email.
3. Partial failure treated as total success (fan-out where three of five calls failed).
4. Invariant drift: balances that no longer sum, orphaned rows, counters that only grow.
5. Flaky tests that train the team to re-run until green, hiding a real race.
6. Alerts without runbooks, producing a paging load nobody can act on.
7. Change-induced failure: a release that only fails for 2 % of traffic and is never noticed.
8. Unbounded degradation: latency growing over weeks until a threshold is crossed.

## 3. SLIs, SLOs and error budgets

1. **SLI** is a ratio: `good events / valid events`. Define both sets precisely. "Valid" excludes events the service is not responsible for (client aborts, malformed requests already rejected at the edge), and that exclusion is written down.
2. **SLO** is an SLI target over a rolling window: `availability-sli ≥ 99.9 % over 28 rolling days`. A target without a window is not an SLO.
3. **Error budget** = `(1 − target) × window`. At 99.9 % over 28 days the budget is roughly 40 minutes of bad events.
4. **Freeze rule**: when the budget is exhausted, feature releases stop; only reliability work, rollbacks and security fixes ship until the rolling window recovers. The rule is written into the release procedure and is prompt-only here.
5. Alert on **burn rate** (fast and slow windows), never on raw error count.

| Family | Signals | Use for |
|---|---|---|
| Four golden signals | Latency, traffic, errors, saturation | Any service |
| RED | Rate, Errors, Duration per endpoint | Request-driven services |
| USE | Utilisation, Saturation, Errors per resource | Pools, queues, disks, CPU |

## 4. Tactics

| Tactic | What it prevents | How to implement | How to verify | Cost |
|---|---|---|---|---|
| Errors handled or propagated with context | Silent corruption | No empty catch; wrap with cause, operation and correlation id; typed error taxonomy | `fitness` `no-silent-failure` (error, exit 1); test asserting the error surfaces | low |
| Idempotent effects | Duplicate charges and dispatches | Idempotency key persisted with the effect inside one transaction; dedupe window declared | Replay test: N identical requests produce one effect | medium |
| Transactional outbox | Lost or duplicated events between DB and broker | Write event and state in one transaction; a relay publishes and marks sent | Crash-injection test between commit and publish | medium |
| Typed partial results | Partial failure read as success | Fan-out returns per-item status; the caller must handle a partial enum | Test with one injected failure asserting a partial verdict | low |
| Invariant assertions | Invisible data drift | Express invariants (sums, referential integrity, monotonic counters) and assert them continuously in a scheduled job | Job alerts on a seeded violation | medium |
| Reconciliation job | Divergence between systems of record | Periodic compare of the two ledgers with a repair or alert path | Test with an injected divergence | medium |
| Deterministic tests | Flake and false confidence | Injected clock, seeded randomness, no `sleep`, no shared mutable fixtures, no network | Repeat the suite 20× in CI; zero variance | medium |
| Contract tests | Integration breakage at deploy | Consumer-driven contracts verified in both pipelines | Contract check in both repos' gates | medium |
| Progressive delivery | Whole-fleet failure from one release | Canary a small share, compare SLI against baseline, auto-rollback on breach | Rehearsed rollback with measured duration | medium |
| Correlation ids end to end | Untraceable incidents | Id generated at ingress, propagated through every hop, present in every log line and span | Trace test asserting one id across all boundaries | low |
| One runbook per alert | Pages nobody can action | Alert links to a runbook with symptom, diagnosis, mitigation, escalation | Review: an alert without a runbook is deleted or given one | low |

## 5. Correctness under partial failure

1. Every operation declares its delivery semantics: at-most-once, at-least-once, or at-least-once with idempotent effect ("exactly-once effect"). Exactly-once **delivery** is not available; do not claim it.
2. Every multi-step effect declares its atomicity strategy: single transaction, outbox, saga with compensations, or explicit manual repair with an alert.
3. Every compensation is itself idempotent and tested against double execution.
4. A read that fans out declares whether a partial answer is acceptable, and marks partial answers in the response so callers cannot mistake them for complete ones.

## 6. Flake policy

1. A flaky test is a **defect**, filed against the code under test until proven otherwise. The default hypothesis is a real race, not a bad test.
2. Quarantine requires an owner, a linked defect id and an expiry date. A quarantined test past expiry fails the build.
3. Never re-run to green. A re-run that passes is one sample, not a refutation.
4. Flake rate is tracked per suite; over target, suite work outranks feature work.

## 7. Hard rules

`M` = machine-enforced, `P` = prompt-only.

1. **M** (`fitness` / `no-silent-failure`, error, exit 1) — no empty catch block, no bare `except: pass`, no ignored `err != nil`.
2. **M** (`attributes`, exit 2) — `reliability: high|critical` requires a passing check claiming `reliability`.
3. **M** (`catalog-lint`, exit 1) — `reliability: minimal|none` requires an `attributeReasons.reliability` entry.
4. **M** (`trace`) — every `NFR-RELIABILITY-<NNN>` is referenced by at least one test.
5. **M** (`spec-lint`) — every reliability NFR is normative (SHALL/MUST), EARS-triggered, metric-bearing and carries acceptance criteria.
6. **P** — every user-facing journey has one SLI defined as good/valid events, with the exclusion set written down.
7. **P** — every SLI has an SLO with a target and a rolling window, and an owner.
8. **P** — every state-changing operation declares delivery semantics and, if at-least-once, an idempotency key.
9. **P** — every alert links to a runbook; every runbook names the mitigation and the escalation.
10. **P** — every data invariant is asserted by a scheduled job, not only by unit tests.
11. **P** — a quarantined test has an owner and an expiry date.
12. **P** — releases are progressive with an automated rollback trigger bound to the SLI.
13. **P** — an incident produces a postmortem with an action item that changes a mechanism, not a reminder to be careful.

## 8. Measurable targets

Metrics for `NFR-RELIABILITY-<NNN>`. Placeholders, not measurements.

| Metric | Unit | Placeholder |
|---|---|---|
| Availability SLI | percent of valid requests | ≥ 99.9 |
| Latency SLI | percent under threshold | ≥ 99 under 300 ms |
| SLO window | rolling days | 28 |
| Error budget | minutes per window | ≈ 40 |
| Burn-rate alert thresholds | × budget over window | 14.4× / 1h, 6× / 6h |
| Duplicate effects | count per million operations | 0 |
| Invariant violations detected | count per day | 0 |
| Change-failure rate | percent of deployments | ≤ 15 |
| MTTR | minutes | ≤ 30 |
| Rollback duration | minutes | ≤ 10 |
| Test flake rate | percent of runs | ≤ 0.5 |
| Alerts with a runbook | percent | 100 |
| Trace coverage across service boundaries | percent of hops | 100 |

EARS form example: *While the payment journey is serving traffic, the `billing` module SHALL keep the availability SLI ≥ 99.9 % over a 28-day rolling window, and SHALL page on a 14.4× burn rate within a one-hour window.*

## 9. How it is gated here

| Mechanism | Command | Effect |
|---|---|---|
| Anti-pattern scan | `node .dsh/base/dsb.mjs fitness --all` | `no-silent-failure` is error severity: exit 1 on any finding. The allow window (`intentional`, `deliberate`, `best-effort`) requires the comment to state why |
| Tier gate | `node .dsh/base/dsb.mjs attributes` | `BLOCKED_BY_ATTRIBUTES` on an unclaimed blocking tier |
| Spec quality | `node .dsh/base/dsb.mjs spec-lint` / `trace` | Rejects non-metric NFRs; proves each id has a test |
| Never-failing controls | `node .dsh/base/dsb.mjs gate-audit` | Names checks that have never failed: cost plus false confidence |
| Decay | `node .dsh/base/dsb.mjs risk` | Flags a three-failure streak, stale tasks, broken ledger |
| Proof | `node .dsh/base/dsb.mjs gate` | Exit 2 blocking, 3 degraded, 4 stale evidence |

Candidate external tools (none shipped): Prometheus or OpenTelemetry for SLI collection, Grafana or an equivalent for burn-rate alerting, Pact for consumer-driven contracts, a flake tracker in the CI provider, and a chaos or crash-injection harness for outbox and idempotency tests.

Module declaration in `catalog.json`:

```json
{
  "id": "billing",
  "paths": ["src/billing/**"],
  "layer": "domain",
  "riskTier": "high",
  "attributes": { "reliability": "critical", "security": "high", "privacy": "high" },
  "verification": ["unit", "integration", "idempotency-replay", "invariant-check"]
}
```

with, for example, `"idempotency-replay": { "command": "npm run test:replay", "class": "test", "attributes": ["reliability"] }`.

## 10. Anti-patterns

<!-- dsb-fitness:ignore — this table quotes the anti-patterns it forbids -->

| Anti-pattern | Why it fails |
|---|---|
| `catch (e) {}` to "keep it running" | Converts a loud failure into silent corruption; caught by `no-silent-failure` | <!-- dsb-fitness:ignore quoted anti-pattern -->
| SLO of 100 % | No error budget, so every change is a violation and the SLO is ignored |
| Alerting on raw error count | Fires on traffic growth, silent during a low-traffic outage |
| Re-running CI until green | Selects for luck; the race ships |
| Exactly-once delivery claimed in a design doc | Not available across a network; specify exactly-once **effect** via idempotency |
| Dashboards instead of SLIs | Pretty, unactionable, and nobody agrees what "bad" means |
| Health check that only pings the process | Reports healthy while every dependency is down |
| Retry as the fix for a correctness bug | Multiplies the wrong effect (see [RESILIENCE.md](./RESILIENCE.md)) |
| Postmortem action item "be more careful" | Not a mechanism; nothing changes |
