# Postmortem - <incident slug>

<!-- rule: copy to docs/incidents/<YYYY-MM-DD>-<slug>.md. Written within 5 working days of
     recovery, while the evidence is still on disk. -->
<!-- rule: blameless means describing systems and decisions with the information available
     at the time. Never name a person as a cause. "The operator ran the wrong command" is
     not a finding; "the command that truncates the table is one character from the command
     that counts it, and neither asks for confirmation" is. -->
<!-- rule: no hedging. Every claim carries an evidence pointer: a log path, a dashboard
     query, a ledger entry, a command with its exit code. A timeline reconstructed from
     memory is a story. -->

Severity: <critical | high | medium | low> | Commander: <name> | Status: <draft | reviewed>
Detected: <YYYY-MM-DDTHH:MM:SSZ> | Mitigated: <UTC> | Closed: <UTC>

## 1. Summary

<!-- rule: five sentences maximum, understandable by someone who was not on the call: what
     broke, what users experienced, what was done, what stopped it, what is now different. -->

## 2. Impact

| Dimension | Value | Source |
|---|---|---|
| Users affected | EXAMPLE 2,140 of 51,000 (4.2%) | analytics query `incident-2026-02-11` |
| Duration | EXAMPLE 68 min from first failed request to full recovery | edge access logs |
| Requests failed | EXAMPLE 31,908 (HTTP 503) | load balancer metrics |
| Data | EXAMPLE no loss; 412 refunds queued and replayed; no personal data exposed | ledger + replay report |
| Money / safety | EXAMPLE no duplicate settlement; interlock held | settlement reconciliation |

<!-- rule: the data row is mandatory even when the answer is "none". "Not investigated" is a
     legitimate value only with an owner and a date to close it. -->

## 3. Timeline

<!-- rule: absolute UTC timestamps from the first signal - not from the first human response
     - to full recovery. One row per observation or action, each with its evidence. The gap
     between the first signal and the first human action is the detection cost, and it is
     the number that produces the best action items. -->

| UTC | Actor | Action or observation | Evidence |
|---|---|---|---|
| EXAMPLE 09:14:02 | system | provider latency p99 crosses 2 s | metric `provider-latency` |
| EXAMPLE 09:31:40 | alert | error-rate alert fires (17 min after first signal) | alert `refund-5xx` |
| EXAMPLE 09:33:10 | on-call | acknowledged; opened incident channel | incident log |
| EXAMPLE 09:52:55 | on-call | reduced provider concurrency to 5 | change `c-8891`, exit 0 |
| EXAMPLE 10:22:11 | on-call | error rate at baseline; recovery confirmed against the original signal | dashboard `refund-5xx` |

## 4. Contributing factors

<!-- rule: plural by construction. A single "root cause" is almost always the last link in a
     chain; list the conditions that had to hold together. Each factor is a mechanism. -->

1. EXAMPLE The provider client had no per-host concurrency limit, so slow responses consumed
   every worker (services/refund/egress/client.ts:57).
2. EXAMPLE The retry policy multiplied load during the degradation: 3 attempts, no jitter.
3. EXAMPLE The alert threshold was a 5-minute error-rate average, which lags a saturation
   failure by design.

## 5. What made detection slow

<!-- rule: answer with a number and a mechanism, not an adjective. -->

EXAMPLE: 17 minutes. The alert measured errors at the edge; saturation showed first as
latency inside the pool, which had no alert.

## 6. What made recovery slow

EXAMPLE: 21 minutes between acknowledgement and mitigation. The concurrency limit was not
runtime-configurable, so the fix required a deploy; the runbook did not name the flag.

## 7. What went right

<!-- rule: not decoration. These are the controls to protect from being optimised away in
     the next refactor. -->

EXAMPLE: the idempotency interlock held under replay, so no refund settled twice
(HAZ-REFD-001 verification point `refund-interlock-test` ran clean during the replay).

## 8. Action items

<!-- rule: every item names an owner, a date, and a literal verification command. -->
<!-- rule: mechanism strength, strongest first:
     1. a new check id wired into .dsh/base/catalog.json checks{} and the module's
        verification (or riskChecks) - it fails the gate for everyone, forever;
     2. a fitness rule in .dsh/base/fitness-rules.json - it fails a scan on a pattern;
     3. a step added to a skill in .dsh/skills/ - it fires only when the skill is loaded;
     4. prose in a document - it fires only when someone reads it.
     Prefer the strongest mechanism the item admits. "Be more careful" is not an action
     item: rewrite it as a mechanism or drop it. -->

| # | Item | Owner | Due | Verification | Strength |
|---|---|---|---|---|---|
| 1 EXAMPLE | bound provider concurrency and add jitter | @payments | 2026-02-25 | `node .dsh/base/dsb.mjs fitness --all` exits 0 with no-unbounded-retry clean | fitness rule |
| 2 EXAMPLE | add check `refund-saturation-test` to catalog and to refund-core verification | @payments | 2026-03-06 | `node .dsh/base/dsb.mjs gate` exits 0 and lists refund-saturation-test as PASS | new check id |
| 3 EXAMPLE | alert on pool saturation, not only edge errors | @sre | 2026-03-06 | alert fires in a game-day injection; link the run | prose + drill |

## 9. Evidence index

| Artifact | Path or query |
|---|---|
| EXAMPLE gate record | .dsh/base/state/ledger.jsonl entry `gate 2026-02-11T10:40Z` |
| EXAMPLE check output | .dsh/base/evidence/refund-interlock-test-<epoch>.log |
