# Hazard analysis - <system name>

<!-- rule: copy to docs/safety/HAZARD-ANALYSIS.md. Safety asks what harm this system can
     cause when nobody attacks it and every component works as specified. Security is a
     different document: docs/security/THREAT-MODEL.md. -->
<!-- rule: a hazard is a system state that leads to harm ("valve stays open while the tank is
     full", "the same refund is issued twice"), never a defect ("off-by-one in the loop"). -->
<!-- rule: keep HAZ- ids inside docs/safety/ and pair each hazard with an `NFR-SAFE-<NNN>`
     carrying the numeric reaction budget, because `trace` resolves only REQ-/NFR- ids and
     reports a HAZ- id found in code or tests as dangling. -->
<!-- rule: safety is a protected attribute: never waivable, never fast-skippable. A safety
     check reported BLOCKED is an uncovered hazard, not a pass. -->

Version: <n> | Date: <YYYY-MM-DD> | Owner: <name> | Modules: <ids>

## 1. Actuation and decision surfaces

<!-- rule: ask of every module - what can it move, energize, dispense, dispatch, publish,
     delete, notify or bill? Read the code that issues the command; do not infer from names.
     A decision surface counts when a human or another system acts on its output without
     review. -->

| Surface | Module | Command issued | Effect | Reversible? |
|---|---|---|---|---|
| S1 EXAMPLE | refund-core | provider refund call | moves money to a customer | only by a manual finance case |
| S2 EXAMPLE | notify-core | bulk email send | contacts every account holder once | no |

## 2. Hazard register

<!-- rule: id `HAZ-<AREA>-<NNN>`, append-only. Ratings: Severity S0 none / S1 light /
     S2 severe but reversible / S3 life-threatening or irreversible; Exposure E0 improbable
     .. E4 high; Controllability C0 controllable .. C3 uncontrollable. Any hazard with
     S >= 2 forces the module's `safety` tier to high; S3 with C >= 2 forces critical. -->
<!-- rule: the safe state is written in observable outputs ("solenoid de-energized, pump
     off, alarm raised"), and it is the default on ANY failure: unknown input, timeout,
     crash, restart, partial write, dependency down. Fail safe, never fail open. -->
<!-- rule: reaction budget is detection latency + reaction latency, and the total must stay
     below the tolerable exposure time. Numbers with units, or the row is not analysed. -->

| HAZ id | Surface | Hazard state | Cause | S | E | C | Safe state | Detection | Reaction budget | Verification point | NFR |
|---|---|---|---|---|---|---|---|---|---|---|---|
| HAZ-REFD-001 EXAMPLE | S1 | the same refund is issued twice | retry after an ambiguous provider timeout | S2 | E3 | C2 | no provider call is made; the request is refused and the case is queued for review | idempotency key lookup before every call | detect 50 ms + react 100 ms = 150 ms, tolerable 1 s | test `refund-interlock-test` case `ambiguous-timeout` | NFR-SAFE-001 |
| HAZ-NOTF-002 EXAMPLE | S2 | a campaign is sent to the full list instead of a segment | segment filter silently empty | S2 | E2 | C3 | send is refused; batch is held; operator alerted | recipient-count guard against the expected segment size | detect 0 ms (pre-send) + react 0 ms | test `notify-guard-test` | NFR-SAFE-002 |

## 3. FMEA

<!-- rule: one row per function on each surface. S/O/D are 1-10, RPN = S x O x D. RPN >= 100,
     or S >= 8 at any RPN, requires an action with an owner and a due date. -->

| Function | Failure mode | Local effect | System effect | Cause | Current control | Detection | S | O | D | RPN | Action | Owner | Due |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EXAMPLE issue refund | call repeated after timeout | duplicate provider call | duplicate money movement | ambiguous timeout | idempotency key | key lookup | 8 | 3 | 2 | 48 | keep interlock test in the gate | @payments | 2026-03-31 |

## 4. Interlocks and residual risk

| HAZ id | Interlock | Check id | Residual risk | Owner | Expiry | Monitoring |
|---|---|---|---|---|---|---|
| HAZ-REFD-001 EXAMPLE | key lookup before provider call | refund-interlock-test | provider may still double-settle server-side | s.novak | 2026-09-30 | daily settlement reconciliation |

<!-- rule: an interlock with no test does not exist. Prefer a test that drives the system
     into the hazardous precondition and asserts the safe state, over a unit test of the
     guard function alone. -->

## 5. Non-applicability declaration

<!-- rule: use this block ONLY when section 1 is genuinely empty. Do not invent hazards to
     fill a template, and do not delete this section - a recorded "none" is evidence; a
     silent absence is not. Copy the same sentence into the catalog. -->

This system has no functional-safety surface.

Basis: EXAMPLE no module moves, energizes, dispenses, dispatches, deletes in bulk, publishes
irreversibly or bills. Every output is advisory text reviewed by a human before it has any
effect, and the system holds no actuator credential.
Reviewed by: <name> | Date: <YYYY-MM-DD> | Re-review when: a new outbound write, dispatch,
deletion or payment path is added.

Catalog entry that must accompany this declaration, for every module:

```json
"attributes":       { "safety": "none" },
"attributeReasons": { "safety": "No actuation, dispatch, deletion or billing surface; all outputs are advisory and human-reviewed before effect." }
```

## Verification

```sh
node .dsh/base/dsb.mjs catalog-lint  # UNJUSTIFIED_TIER when safety none/minimal has no reason
node .dsh/base/dsb.mjs attributes    # a blocking safety tier with no claiming check is exit 1
node .dsh/base/dsb.mjs fitness --all # no-unreferenced-deferral fires inside safety modules
node .dsh/base/dsb.mjs gate          # interlock tests actually executed and PASSED
```
