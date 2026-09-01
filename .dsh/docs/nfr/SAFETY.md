# Safety

Attribute id `safety`. Protected attribute: never waivable, never fast-skippable.
Related: [SECURITY.md](./SECURITY.md) · [RESILIENCE.md](./RESILIENCE.md) · [RELIABILITY.md](./RELIABILITY.md) · [PRIVACY.md](./PRIVACY.md) · [../LARGE-REPO-GUIDE.md](../LARGE-REPO-GUIDE.md) · [../QUALITY-ATTRIBUTES.md](../QUALITY-ATTRIBUTES.md) · [../../AGENTS.md](../../AGENTS.md)

## 1. Definition

Safety is freedom from unacceptable risk of harm to **people**, the **physical environment**, or **equipment**, caused by the behaviour of the system, including its correct behaviour applied at the wrong time, in the wrong amount, or to the wrong target.

Safety is **not**:

| Not this | Because |
|---|---|
| Security | Security defends against an adversary. Safety defends against consequences, adversary or not. A locked-down system can still open a valve. |
| Reliability | A perfectly reliable system that reliably executes a harmful command is unsafe. Reliability is doing the thing; safety is the thing being allowed. |

## 2. When this attribute does not apply

Most business systems have **no functional-safety surface**. Inventing a hazard analysis for a reporting dashboard produces documents nobody believes and hides the modules that matter.

The correct action is an explicit, recorded opt-out:

```json
{
  "id": "reporting",
  "paths": ["src/reporting/**"],
  "layer": "app",
  "riskTier": "low",
  "attributes": { "safety": "none", "reliability": "medium" },
  "attributeReasons": {
    "safety": "read-only aggregation over stored data; issues no command, actuates nothing, and cannot dispatch, bill or publish"
  }
}
```

`catalog-lint` fails with `UNJUSTIFIED_TIER` (exit 1) when `safety` is `none` or `minimal` without an `attributeReasons.safety` string. The reason must state which actuation surfaces were checked and found absent — not "not applicable".

## 3. Failure modes defended against

1. Actuation on a stale command after a network stall or a controller pause.
2. Actuation at power-on, reset or failover, before invariants are established.
3. A setpoint outside the physical envelope, or applied as a step instead of a ramp.
4. A protective function disabled or suppressed by the same fault that requires it.
5. An interlock that shares the failing component's code path, power supply or clock.
6. An irreversible action (dispense, dispatch, publish, bill, delete) issued twice by a retry.
7. Blind operation continuing after sensor loss, using the last known value indefinitely.
8. A hazard mitigated on paper only, because the implementing work is an unanchored TODO.

## 4. Identifying the safety surface

A module has a safety surface if it can **move, energize, dispense, dispatch, bill, or publish irreversibly**. Ask per module:

1. Does it command an actuator, motor, valve, relay, heater, door, brake or drone?
2. Does it control energy: charging, high voltage, RF power, laser, pressure?
3. Does it dispense: medication, chemicals, fuel, food, cash?
4. Does it dispatch a human or a vehicle to a location?
5. Does it move money or create a binding commitment (billing, ordering, trading)?
6. Does it publish irreversibly (broadcast, notification fan-out, public data release)?
7. Can it *suppress* a protective action: silence an alarm, disable an interlock, veto a shutdown?
8. Does its output drive a human decision that is rarely second-guessed (triage, dosing, alarm suppression)?

Any yes means `safety` is at least `medium`; a yes to 1-5 or 8 normally means `high` or `critical`. The list in §3 is the failure set those surfaces produce.

## 5. Hazard identification and rating

Every identified hazard gets an id `HAZ-<AREA>-<NNN>`, append-only, never reused, referenced from code comments, tests and ADRs.

Rate each hazard on three axes; the combination determines the required control strength.

| Axis | Scale | Meaning |
|---|---|---|
| Severity S | S0 none · S1 minor injury / minor damage · S2 severe injury / major damage · S3 fatal or catastrophic | Worst credible outcome |
| Exposure E | E1 rare · E2 occasional · E3 frequent · E4 continuous | How often the situation exists |
| Controllability C | C1 usually controllable by a person · C2 hard to control · C3 uncontrollable | Ability of an operator to avoid harm |

Rule of composition: `S3` with any `C3`, or `S2`+`E3`+`C2` and worse, requires an interlock independent of the failing component's code path, power supply and clock.

FMEA table format (one row per failure mode, kept next to the module):

| Id | Function | Failure mode | Cause | Local effect | System effect | S | E | C | Detection | Mitigation | Residual | Verified by |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| HAZ-DOSE-003 | Deliver bolus | Over-delivery | Stale setpoint after reconnect | Pump runs long | Overdose | S3 | E2 | C3 | Volume counter vs command | Firmware rate clamp + counter-mismatch interlock | S3/E1/C2, approver named | `test/haz-dose-003.spec` |

## 6. Tactics

| Tactic | What it prevents | How to implement | How to verify | Cost |
|---|---|---|---|---|
| Defined safe state | Undefined behaviour on fault | Write the safe state per actuator (de-energised, closed, held, refusing) and enter it on any unrecoverable error | Fault-injection test asserting safe state within the entry-time budget | medium |
| Fail-safe default | Power-on or reset producing motion | Default outputs are inert until an explicit, validated enable arrives | Cold-boot test with no controller present: no actuation | medium |
| Interlock | A dangerous combination of states | Independent check that blocks actuation when preconditions are unmet; separate code path and, where required, separate hardware | Interlock proving test that drives the forbidden state and asserts no actuation | high |
| Watchdog and command TTL | Actuating after the controller dies, or on a stale command | Watchdog kicked only while invariants hold; every command carries an issue time and TTL and is rejected when expired | Stop kicking, assert safe state within the timeout; delay a command past its TTL, assert rejection | medium |
| Command authority and confirmation | Ambiguous ownership; one-keystroke catastrophes | Single authoritative commander with sequence numbers and explicit handover; two-step confirmation stating the scope | Test: two controllers command at once and exactly one is honoured; no effect without the second step | medium |
| Rate and range limiting | Mechanical shock, thermal runaway, absurd setpoints | Slew-rate limiter plus hard clamp closest to the actuator, cross-checked against a physical model or an independent sensor | Step-command test measuring the applied ramp; boundary test at limit±1; spoofed-sensor test | medium |
| Degraded mode | Blind operation after sensor loss | Named modes with reduced authority (e.g. manual only, reduced speed, read-only) | Sensor-loss test asserting mode entry and the reduced envelope | medium |

## 7. Hard rules

`M` = machine-enforced, `P` = prompt-only.

1. **M** (`catalog-lint`, exit 1) — every module declares `safety`; `none` or `minimal` requires `attributeReasons.safety`.
2. **M** (`attributes`, exit 2) — `safety: high|critical` requires a passing check claiming `safety`; a FAILing or BLOCKED claiming check reopens the gap.
3. **M** (`fitness` / `no-unreferenced-deferral`, warning, applies only where the module declares `safety: high|critical`) — no `TODO`, `FIXME`, `HACK` or `XXX` without an anchor (`REQ-`, `NFR-`, `ADR-`, `HAZ-`, `THR-`, or an issue id).
4. **M** (`waiver check`) — no safety waiver is expressible; a safety gap blocks until it is closed.
5. **P** — every actuation surface identified in §4 has at least one `HAZ-<AREA>-<NNN>` entry or a written statement of why no hazard exists.
6. **P** — every hazard rated `S3`, or `S2` with `C3`, has an interlock that is independent of the failing component's code path and power supply.
7. **P** — every interlock has a proving test that drives the forbidden state and asserts no actuation; an interlock without a proving test is treated as absent.
8. **P** — every actuator has a written safe state and a measured entry-time budget.
9. **P** — every command to an actuator carries a TTL; expired commands are rejected, not queued.
10. **P** — every irreversible action (dispense, dispatch, bill, publish, delete) has a confirmation step or a cancellable hold window, and both are covered by a test.
11. **P** — degraded modes are enumerated with their reduced authority; "keep going with the last good value" is not a mode.
12. **P** — safety-relevant code has no silent failure path; every caught error either enters the safe state or propagates with context (see `no-silent-failure` in [RELIABILITY.md](./RELIABILITY.md)). A change to a safety-relevant module is HIGH approval and stops for explicit human authorization.

**Why an unanchored TODO is a defect here.** In a safety module a deferred item is an undocumented gap between the hazard analysis and the implementation, while the FMEA row still reads "mitigated". An anchored deferral (`// TODO(HAZ-DOSE-003): clamp not cross-checked against the flow sensor`) is visible to `trace` and to review; an unanchored one disappears when its author moves on. `no-unreferenced-deferral` is warning severity and does not by itself set exit 1 — treat any finding in a safety module as a blocking review item.

## 8. Measurable targets

Metrics that must appear in an `NFR-SAFETY-<NNN>`. Placeholders, not measurements.

| Metric | Unit | Placeholder |
|---|---|---|
| Safe-state entry time | milliseconds | ≤ 200 |
| Watchdog timeout | milliseconds | ≤ 500 |
| Command TTL | milliseconds | ≤ 1000 |
| Maximum setpoint slew rate | unit/second | domain-specific, stated |
| Residual risk after mitigation | S/E/C triple | ≤ S2/E1/C1 |
| Hazards with a proving test | percent | 100 |

EARS form example: *When the controller heartbeat is absent for 500 ms, the `dispenser` module SHALL de-energise the pump and enter the safe state within 200 ms.* Acceptance: fault-injection test `haz-dose-003` measures both intervals.

## 9. How it is gated here

| Mechanism | Command | Effect |
|---|---|---|
| Deferral scan | `node .dsh/base/dsb.mjs fitness --all` | `no-unreferenced-deferral`, warning severity, `minimumTier: high` on `safety` |
| Tier gate | `node .dsh/base/dsb.mjs attributes` | `BLOCKED_BY_ATTRIBUTES` on an unclaimed blocking tier |
| Opt-out validity | `node .dsh/base/dsb.mjs catalog-lint` | `UNJUSTIFIED_TIER` when a reason is missing |
| Traceability | `node .dsh/base/dsb.mjs trace` | Proves each `HAZ`/`REQ` id is referenced by at least one test |
| Proof | `node .dsh/base/dsb.mjs gate` | Exit 2 blocking, 3 degraded, 4 stale evidence |

Candidate external tools (none shipped; register what you adopt as a check claiming `safety`): hardware-in-the-loop or simulator rigs, MC/DC coverage tooling for decision surfaces, a model checker (TLA+, Alloy) for interlock logic, a fault-injection proxy for command timing.

Module declaration in `catalog.json`:

```json
{
  "id": "dispenser",
  "paths": ["src/dispenser/**"],
  "layer": "domain",
  "riskTier": "critical",
  "attributes": { "safety": "critical", "reliability": "high", "resilience": "high" },
  "verification": ["unit", "hil-interlock", "fault-injection"]
}
```

with, for example, `"hil-interlock": { "command": "npm run test:hil", "class": "test", "attributes": ["safety"] }`.

## 10. Anti-patterns

| Anti-pattern | Why it fails |
|---|---|
| `safety: none` with the reason "not applicable" | Not decidable; the reason must name the surfaces checked |
| Interlock implemented in the same function as the actuation | Shares the failure; independence is the whole point |
| "Last known good value" on sensor loss | Silent, unbounded extrapolation; declare a degraded mode instead |
| Unanchored TODO in a safety module | The FMEA still claims mitigation that does not exist |
