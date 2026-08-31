---
name: safety-analysis
description: Use when a change can move, energize, dispense, dispatch, publish, delete or bill something, or when declaring or altering a module's safety tier.
whenToUse: Before changing any actuation or decision surface, and when a module's safety attribute is set or downgraded.
---

## Purpose

Establish whether the system can harm people, environment or equipment, and if so bound that harm with declared safe states and proven interlocks. Produces `docs/safety/HAZARD-ANALYSIS.md` - actuation and decision surfaces, hazards with `HAZ-<AREA>-<NNN>`, S/E/C ratings, safe states, detection means, reaction budgets, verification points - or a recorded, reasoned declaration that the system has no functional-safety surface.

## When this fires

- A change touches code that commands physical actuation, energy, dispensing, dispatch, irreversible publication, mass deletion, or money movement.
- A module declares `safety` at `critical` or `high`, or someone proposes lowering that tier.
- `node .dsh/base/dsb.mjs fitness --all` reports `no-unreferenced-deferral` (this rule fires only inside modules whose `safety` tier is `high` or `critical`).
- A new `HAZ-` id is proposed, or an existing interlock is modified or removed.
- The user invokes `/safety-analysis`.

## Procedure

1. Enumerate actuation and decision surfaces. Ask of every module: what can it move, energize, dispense, dispatch, publish, delete, notify or bill? Record surface id, owning module id, the command it issues, and the physical or financial effect. Read the code that issues the command; do not infer from names.
2. If the enumeration is empty, say so explicitly and record it: set `attributes.safety: "none"` on each module and write the matching `attributeReasons.safety` sentence, for example `"No actuation, dispensing, dispatch or billing surface; output is advisory text consumed by a human."` Tiers `none` and `minimal` require a written reason. Verify with `node .dsh/base/dsb.mjs catalog-lint` (exit 1) and stop here - do not invent hazards to fill a template.
3. For each surface, derive hazards. A hazard is a system state that leads to harm, not a defect: "valve stays open while tank is full", not "off-by-one in the loop". Assign `HAZ-<AREA>-<NNN>`, append-only.
4. Rate each hazard on three axes and derive the tier:

   | Axis | Scale | Meaning |
   | --- | --- | --- |
   | Severity S | S0 none, S1 light, S2 severe/reversible, S3 life-threatening or irreversible | Worst credible outcome |
   | Exposure E | E0 improbable .. E4 high probability | How often the system is in the situation |
   | Controllability C | C0 controllable .. C3 uncontrollable | Can a human or a supervisor avert the harm |

   Rule: any hazard with S >= 2 forces `safety` at `high`; S3 with C >= 2 forces `critical`. Blocking tiers require at least one PASSING check claiming `safety`, otherwise `node .dsh/base/dsb.mjs attributes` exits 1.
5. For each hazard define the safe state in one sentence, in terms of observable outputs: "solenoid de-energized, pump off, alarm raised". The safe state is the default on any failure: unknown input, timeout, crash, restart, partial write, dependency down. Fail-safe, never fail-open.
6. Define detection and the reaction time budget as numbers: detection means (sensor, watchdog, heartbeat, invariant assertion), detection latency budget in ms, reaction latency budget in ms, and the worst-case total that must remain below the hazard's tolerable exposure time.
7. Name the verification point for every hazard: the test id or check id that proves the interlock fires. An interlock with no test does not exist. Prefer a test that drives the system into the hazardous precondition and asserts the safe state, not a unit test of the guard function alone.
8. Fill the FMEA table (step 4 of the output contract) per function on each surface: failure mode, local effect, system effect, cause, current control, detection, S/O/D 1-10, RPN = S x O x D. RPN >= 100, or S >= 8 at any RPN, requires an action with an owner and a due date.
9. Handle deferred work: inside a safety module every `TODO/FIXME/HACK/XXX` must name a tracking anchor (`REQ-`, `NFR-`, `ADR-`, `HAZ-`, `THR-` or an issue id). Enforced by `no-unreferenced-deferral`; run `node .dsh/base/dsb.mjs fitness --all` (exit 1). Do not silence it with `dsb-fitness:ignore` in a safety module.
10. Make hazards traceable. `node .dsh/base/dsb.mjs trace` resolves only `REQ-`/`NFR-` ids declared under `trace.requirementDirs`; a `HAZ-` id appearing in scanned code or tests is reported dangling (exit 1). Keep `HAZ-` ids in `docs/safety/`, add that directory to `trace.requirementDirs`, and pair each hazard with an `NFR-SAFE-<NNN>` carrying the numeric reaction budget for code and tests to cite.
11. Record the safe-state decision as an ADR with `Enforced-by:` naming the interlock check id; `node .dsh/base/dsb.mjs adr-check` exits 1 on a phantom enforcement reference.
12. Close: `node .dsh/base/dsb.mjs gate` (exit 2 = blocking failure). A safety check reported `BLOCKED` is an uncovered hazard, not a pass.

## Output contract

`docs/safety/HAZARD-ANALYSIS.md`:

```
# Hazard analysis - <system>
Version: <n> | Date: <ISO> | Owner: <name> | Applies to modules: <ids>

## 1. Safety surfaces        (surface id | module | command issued | physical/financial effect)
## 2. Hazard log             (HAZ-id | surface | hazard state | cause | S | E | C | tier forced)
## 3. Safe states            (HAZ-id | safe state | trigger conditions | who can override | override audit)
## 4. FMEA                   (function | failure mode | effect | cause | control | detection | S | O | D | RPN | action | owner | due)
## 5. Timing budgets         (HAZ-id | detection means | detect ms | react ms | total ms | tolerable ms)
## 6. Interlocks             (HAZ-id | interlock | test id | last run | check id)
## 7. Residual risk          (HAZ-id | residual | owner | expiry | monitoring)
## 8. Non-applicability      (only when there is no safety surface: statement + catalog reason text)
```

Declaration of no safety surface, in `catalog.json`:

```
"attributes":       { "safety": "none" },
"attributeReasons": { "safety": "No actuation, dispatch, deletion or billing surface; all outputs are advisory and human-reviewed before effect." }
```

## Stop conditions

Halt and ask the human when:

- A hazard rates S3 and you cannot name a safe state that the code can actually reach (for example the process can die before de-energizing).
- Someone asks to lower `safety` below `high` on a module that still commands a surface listed in section 1. Tier changes need the named owner, not a subagent.
- An interlock exists but no test drives the hazardous precondition; write the test or escalate - do not mark the hazard verified.
- The reaction budget cannot be met by the current architecture (total exceeds tolerable). That is a design decision, not a code change.
- A waiver is proposed for a `safety` check. The engine rejects it: protected attributes are never waivable and waiver text naming safety is refused.
- Removing an existing interlock is requested. Removal requires the hazard to be retired in writing with the owner's name.

## Anti-patterns

| Failure mode | Correction |
| --- | --- |
| Hazards written as defects ("null pointer in driver") | State the harmful system state and its effect; the defect is a cause, listed in the cause column. |
| Fail-open default: on error, continue with last command | Default to the declared safe state on every failure path including timeout, restart and partial write. |
| Interlock proven by unit-testing the guard function | Drive the system to the hazardous precondition and assert the observable safe state. |
| Reaction budget written as "fast" or "immediately" | Numbers with units, and a test that measures them. |
| `TODO` in a safety module with no anchor | Name `HAZ-`/`REQ-`/issue id; `no-unreferenced-deferral` exists precisely to catch this. |
| Suppressing the deferral rule with `dsb-fitness:ignore` | Suppression inside a safety module hides the only automated signal you have; add the anchor instead. |
| Claiming `safety: none` without a written reason | `none` and `minimal` require an `attributeReasons` sentence; `catalog-lint` exits 1 without it. |
| Copying an FMEA from another system | Every row must name this system's function and this repository's control; unowned rows are noise. |
