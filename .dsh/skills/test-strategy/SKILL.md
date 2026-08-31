---
name: test-strategy
description: Use when deciding what to test, writing a test for a fix, judging whether a suite is adequate, or classifying a test failure.
whenToUse: Before writing tests for a change or a defect fix, and when triaging any failing test.
---

## Purpose

Spend scarce test effort where failure is most likely and most expensive, and make every test accountable to something. Produces the test plan for a change: anchored tests in ladder order, a red-then-green record for every fix, and requirement coverage that `node .dsh/base/dsb.mjs trace` can verify.

## When this fires

- A defect is being fixed (the red-locks-the-bug rule applies before any fix is written).
- A new capability, boundary, parser or state machine is added.
- `node .dsh/base/dsb.mjs trace` exits 1 with unverified requirement ids.
- A reviewer asks whether the tests are adequate, or a test fails and must be classified.
- The user invokes `/test-strategy`.

## Procedure

1. Apply iron rule 1 - red locks the bug. For a defect: write the failing test first, run it, and show the failing output (assertion text, not just a non-zero exit). Only then write the fix, then show the same test green. A fix whose test was never observed red proves nothing: it may be asserting on the new implementation rather than the bug.
2. Apply iron rule 2 - independence. The test author is not the implementation author. In an agent workflow that means a separate subagent writes the test, seeded with the requirement and the reproduction, and explicitly not with the implementation diff. If the same agent must do both, write the test first from the requirement text alone and record that ordering in the result envelope.
3. Apply iron rule 3 - anchoring. Every test names an anchor in its name or a comment on the test: a `REQ-`/`NFR-`/`HAZ-`/`THR-` id, or a defect id. A test with no anchor does not enter the suite - it has no owner, no reason to exist, and no reason to be deleted when the requirement dies. Note that `trace` resolves only `REQ-` and `NFR-` ids declared under `trace.requirementDirs`; cite those ids in test names, and keep `HAZ-`/`THR-` ids in their own documents to avoid a dangling-id failure (exit 1).
4. Allocate effort by the ladder. Test budget is finite; spend it top-down and stop when the budget is gone, not when the code is uniformly covered:

   | Rank | Target | Why it is first |
   | --- | --- | --- |
   | 1 | Cross-boundary contracts and serialisation round-trips (API schemas, events, persistence, config) | Both sides change independently; the failure is silent and reaches users |
   | 2 | Parsing, normalisation and state transitions | Dense branching over untrusted input; where injections and corrupt states start |
   | 3 | Authorization, transactions and concurrency | Failures are security or integrity incidents and rarely reproduce by accident |
   | 4 | Pure functions with high branch density | Cheapest assertions per branch; fast feedback |
   | 5 | End-to-end journeys, one per critical capability | Proves the wiring; too slow and too flaky to carry the suite |

5. Write assertions on observable behaviour: return values, emitted events, persisted state, status codes. Do not assert on call counts of internal collaborators unless the interaction is the contract (for example "the payment provider is called exactly once per idempotency key").
6. Make tests deterministic: injected clock, seeded randomness, no wall-clock sleeps, no shared mutable fixtures, no network to a live third party. Where waiting is unavoidable, wait on a condition with a timeout, never on a duration.
7. Classify every failure before touching code:

   | Class | Meaning | Obligation |
   | --- | --- | --- |
   | Product | The system is wrong | Fix the system; keep the test |
   | Test | The assertion is wrong or over-specified | Fix the test; explain why the old assertion was wrong |
   | Environment | Missing tool, credential, port, disk | Report as `BLOCKED`; never rerun until it passes |
   | Prerequisite | Fixture, migration or seed not applied | Fix the setup and make the dependency explicit |
   | Suspected flaky | Same commit, both outcomes | Do not rerun to green: quarantine with an owner and an expiry, and open the defect |

8. Treat coverage correctly. Line coverage is a diagnostic for finding untested branches; requirement coverage is the gate. Run `node .dsh/base/dsb.mjs trace` (exit 1 when a declared requirement has no test referencing it, or an id is dangling). Chasing a line-coverage percentage produces assertion-free tests that raise the number and prove nothing.
9. Verify the suite runs as a registered check: the test command belongs in `catalog.checks` with the attributes it actually claims, so `node .dsh/base/dsb.mjs attributes` can map it to module tiers (exit 1 on a gap) and `node .dsh/base/dsb.mjs gate` can run it (exit 2 on a blocking failure). A test suite that only exists in a developer's terminal proves nothing at the gate.
10. Record the outcome in the result envelope: Verified (with the command and its exit code), Not verified (explicitly), and the anchors covered.

## Output contract

Test plan block, attached to the change:

```
Anchors: REQ-ORD-014, NFR-REL-003
Ladder allocation:
  1 contracts        | 3 tests | order-event schema round-trip, api 400 on unknown field, migration up/down
  2 parsing/state    | 4 tests | quantity normalisation, state machine illegal transitions
  3 authz/concurrency| 2 tests | non-owner cannot cancel; concurrent cancel is idempotent
  4 pure functions   | 5 tests | price rounding branch table
  5 e2e              | 1 test  | place order -> pay -> confirm
Red-then-green (defects only):
  defect D-231 | test: cancel_after_ship_rejected | red output: "expected 409, got 200" | green after fix
Not tested (with reason):
  retry backoff timing - covered by NFR-RES-002 load test, not by unit test
```

Every test name or docstring contains its anchor id, for example `test_cancel_after_ship_rejected_REQ_ORD_014`.

## Stop conditions

Halt and ask the human when:

- A defect cannot be reproduced by any test you can write. Report it: an unreproduced defect must not be "fixed" speculatively.
- The requirement the test would anchor to does not exist. Requirements are authored, not inferred - ask for the id or write the requirement first through `spec-lint` (exit 1 while it is not decidable).
- A test would need production credentials or live third-party data.
- The ladder's rank 1 and 2 items cannot be tested because the boundary has no seam and refactoring it is out of scope.
- Someone asks to delete a failing test to unblock a merge.

## Anti-patterns

| Failure mode | Correction |
| --- | --- |
| Fix written first, test added afterwards | Write the test first and observe it red; otherwise it may assert the implementation, not the bug. |
| Test author is the implementation author | Delegate the test to a separate subagent seeded with the requirement, not the diff. |
| Test with no anchor id | Add the `REQ-`/`NFR-`/defect id, or do not add the test. |
| Chasing a line-coverage target | Line coverage is a diagnostic; `trace` requirement coverage is the gate. |
| Rerunning a failing test until it passes | Classify first; a suspected flake is a defect with an owner and an expiry. |
| `sleep(2)` to fix a race | Wait on a condition with a timeout, or inject the clock. |
| Mock returns exactly what the code expects | Assert observable behaviour and include at least one contract test against the real schema. |
| One giant e2e test as the whole suite | Rank 5 proves wiring only; the ladder's top four carry the failure detection. |
